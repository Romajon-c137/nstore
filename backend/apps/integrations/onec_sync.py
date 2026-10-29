from __future__ import annotations

from io import BytesIO
from decimal import Decimal

from PIL import Image, ImageOps, UnidentifiedImageError
import httpx
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify

from apps.catalog.models import Category, Price, PriceList, Product, ProductMedia, ProductVariant, StockProjection, Warehouse

from .onec import OneCClient


PACKAGE_MARKERS = ("кейс", "упаков", "короб", "блок")


def _package_rules(rows):
    """Return the strict full-package sale rule for each 1C product owner."""
    packages = {}
    scores = {}
    for row in rows:
        label = (row.get("Description") or "").strip()
        owner = row.get("Owner")
        owner_type = row.get("Owner_Type") or ""
        quantity = Decimal(str(row.get("Коэффициент") or 0))
        if (
            row.get("DeletionMark")
            or not owner
            or not owner_type.endswith("Catalog_Номенклатура")
            or quantity <= 1
            or not any(marker in label.casefold() for marker in PACKAGE_MARKERS)
        ):
            continue
        # A case is the outer sale package. If 1C contains several package
        # units, prefer it over an inner pack and then prefer the larger one.
        score = (label.casefold() == "кейс", quantity, label.casefold())
        if owner not in scores or score > scores[owner]:
            scores[owner] = score
            packages[owner] = {
                "package_label": label,
                "package_qty": quantity,
                "min_qty": quantity,
                "qty_step": quantity,
            }
    return packages


def _slug(title: str, source_ref: str) -> str:
    base = slugify(title, allow_unicode=True)[:430] or "product"
    return f"{base}-{source_ref[:8]}"


def _source_datetime(value):
    if not value:
        return None
    parsed = parse_datetime(value) if isinstance(value, str) else value
    if parsed and timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _compressed_webp(data: bytes, *, max_side: int, quality: int) -> bytes:
    if not data:
        raise ValueError("1С вернула пустой файл")
    try:
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            output = BytesIO()
            image.save(output, format="WEBP", quality=quality, method=6, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Полученный файл не является поддерживаемым изображением") from exc


class OneCSyncService:
    def __init__(self, client: OneCClient, *, dry_run=False):
        self.client = client
        self.dry_run = dry_run
        self.now = timezone.now()
        self.unit_names = {}
        self.package_rules = {}

    def categories(self) -> dict:
        rows = self.client.get(
            "Catalog_Номенклатура",
            {"$select": "Ref_Key,Parent_Key,Description", "$filter": "IsFolder eq true and DeletionMark eq false"},
        )
        if self.dry_run:
            return {"seen": len(rows)}
        by_ref = {}
        for row in rows:
            ref = row["Ref_Key"]
            category, _ = Category.objects.update_or_create(
                source_ref=ref,
                defaults={"name": row.get("Description") or "Без названия", "slug": _slug(row.get("Description") or "category", ref), "is_active": True},
            )
            by_ref[ref] = category
        changed = []
        for row in rows:
            category = by_ref[row["Ref_Key"]]
            parent = by_ref.get(row.get("Parent_Key"))
            if category.parent_id != (parent.id if parent else None):
                category.parent = parent
                changed.append(category)
        Category.objects.bulk_update(changed, ["parent", "updated_at"], batch_size=500)
        return {"seen": len(rows), "updated": len(by_ref)}

    def catalog(self) -> dict:
        seen = set()
        created = updated = 0
        pages = self.client.pages(
            "Catalog_Номенклатура",
            select="Ref_Key,Parent_Key,Code,Description,Артикул,ЕдиницаИзмерения_Key,DeletionMark,IsFolder",
            filter_="IsFolder eq false and DeletionMark eq false",
            order_by="Ref_Key",
        )
        for rows in pages:
            with transaction.atomic():
                for row in rows:
                    ref = row["Ref_Key"]
                    if ref in seen:
                        continue
                    seen.add(ref)
                    package = self.package_rules.get(ref, {
                        "package_label": "",
                        "package_qty": Decimal("1"),
                        "min_qty": Decimal("1"),
                        "qty_step": Decimal("1"),
                    })
                    defaults = {
                        "sku": (row.get("Артикул") or row.get("Code") or "").strip(),
                        "source_name": (row.get("Description") or "Без названия").strip(),
                        "unit": self.unit_names.get(row.get("ЕдиницаИзмерения_Key"), "шт"),
                        **package,
                        "raw_source": row,
                        "is_active": True,
                    }
                    if self.dry_run:
                        if ProductVariant.objects.filter(source_ref=ref).exists():
                            updated += 1
                        else:
                            created += 1
                        continue
                    variant = ProductVariant.objects.select_related("product").filter(source_ref=ref).first()
                    if variant:
                        for key, value in defaults.items():
                            setattr(variant, key, value)
                        variant.save(update_fields=[*defaults.keys(), "updated_at"])
                        product = variant.product
                        if not product.description:
                            product.title = defaults["source_name"]
                            product.slug = _slug(product.title, ref)
                            product.category = Category.objects.filter(source_ref=row.get("Parent_Key")).first()
                            product.fetched_at = self.now
                            product.save(update_fields=["title", "slug", "category", "fetched_at", "updated_at"])
                        updated += 1
                    else:
                        product = Product.objects.create(
                            title=defaults["source_name"], slug=_slug(defaults["source_name"], ref),
                            category=Category.objects.filter(source_ref=row.get("Parent_Key")).first(),
                            status=Product.Status.DRAFT, fetched_at=self.now,
                        )
                        ProductVariant.objects.create(product=product, source_ref=ref, **defaults)
                        created += 1
        archived = 0
        if not self.dry_run and seen:
            archived = ProductVariant.objects.exclude(source_ref__in=seen).filter(is_active=True).update(is_active=False)
        return {"created": created, "updated": updated, "archived": archived, "seen": len(seen)}

    def reference_data(self) -> dict:
        price_types = self.client.get("Catalog_ВидыЦен", {"$select": "Ref_Key,Description,Недействителен,DeletionMark", "$filter": "Недействителен eq false and DeletionMark eq false"})
        warehouses = self.client.get("Catalog_СтруктурныеЕдиницы", {"$select": "Ref_Key,Description,ТипСтруктурнойЕдиницы,Недействителен,DeletionMark", "$filter": "Недействителен eq false and DeletionMark eq false"})
        units = self.client.get("Catalog_КлассификаторЕдиницИзмерения", {"$select": "Ref_Key,Description,DeletionMark", "$filter": "DeletionMark eq false"})
        self.unit_names = {row["Ref_Key"]: (row.get("Description") or "шт").strip() for row in units}
        package_rows = []
        for rows in self.client.pages(
            "Catalog_ЕдиницыИзмерения",
            select="Ref_Key,Description,Owner,Owner_Type,Коэффициент,DeletionMark",
            filter_="DeletionMark eq false",
            order_by="Owner,Ref_Key",
        ):
            package_rows.extend(rows)
        self.package_rules = _package_rules(package_rows)
        if not self.dry_run:
            for row in price_types:
                ref = row["Ref_Key"]
                code = "retail" if ref == settings.ONEC_RETAIL_PRICE_TYPE_ID else f"onec-{ref[:8]}"
                PriceList.objects.update_or_create(source_ref=ref, defaults={"code": code, "name": row["Description"], "is_retail": ref == settings.ONEC_RETAIL_PRICE_TYPE_ID, "is_active": True})
            for row in warehouses:
                if row.get("ТипСтруктурнойЕдиницы") != "Склад":
                    continue
                ref = row["Ref_Key"]
                Warehouse.objects.update_or_create(source_ref=ref, defaults={"name": row["Description"], "is_sellable": not settings.ONEC_WAREHOUSE_IDS or ref in settings.ONEC_WAREHOUSE_IDS})
        return {
            "price_lists": len(price_types),
            "warehouses": len(warehouses),
            "units": len(units),
            "package_units": len(self.package_rules),
        }

    def prices(self) -> dict:
        allowed = [x for x in [settings.ONEC_RETAIL_PRICE_TYPE_ID, *settings.ONEC_B2B_PRICE_TYPE_IDS] if x]
        if not allowed:
            return {"skipped": "Не заданы ONEC_RETAIL_PRICE_TYPE_ID/ONEC_B2B_PRICE_TYPE_IDS"}
        condition = self.client.condition_for_refs("ВидЦен_Key", allowed)
        literal = self.client.encoded_condition(condition)
        path = f"InformationRegister_ЦеныНоменклатуры/SliceLast(Condition={literal})"
        count = 0
        seen = set()
        for rows in self.client.pages(
            path,
            select="Номенклатура_Key,ВидЦен_Key,Цена,Period",
            order_by="Номенклатура_Key,ВидЦен_Key,Period",
        ):
            if self.dry_run:
                count += len(rows)
                continue
            variants = {v.source_ref: v for v in ProductVariant.objects.filter(source_ref__in=[r["Номенклатура_Key"] for r in rows])}
            lists = {p.source_ref: p for p in PriceList.objects.filter(source_ref__in=allowed)}
            for row in rows:
                variant, price_list = variants.get(row["Номенклатура_Key"]), lists.get(row["ВидЦен_Key"])
                if not variant or not price_list:
                    continue
                Price.objects.update_or_create(
                    variant=variant,
                    price_list=price_list,
                    defaults={
                        "amount": Decimal(str(row["Цена"])),
                        "source_period": _source_datetime(row.get("Period")),
                        "fetched_at": self.now,
                    },
                )
                seen.add((variant.id, price_list.id))
                count += 1
        cleared = 0
        if not self.dry_run:
            stale = [price for price in Price.objects.filter(price_list__source_ref__in=allowed).only("id", "variant_id", "price_list_id", "amount", "fetched_at") if (price.variant_id, price.price_list_id) not in seen]
            for price in stale:
                price.amount = None
                price.fetched_at = self.now
            Price.objects.bulk_update(stale, ["amount", "fetched_at"], batch_size=500)
            cleared = len(stale)
        return {"updated": count, "cleared": cleared}

    def stock(self) -> dict:
        path = "AccumulationRegister_ЗапасыНаСкладах/Balance(Dimensions='Номенклатура,СтруктурнаяЕдиница')"
        count = 0
        seen = set()
        for rows in self.client.pages(
            path,
            select="Номенклатура_Key,СтруктурнаяЕдиница_Key,КоличествоBalance",
            order_by="Номенклатура_Key,СтруктурнаяЕдиница_Key",
        ):
            selected = [r for r in rows if not settings.ONEC_WAREHOUSE_IDS or r["СтруктурнаяЕдиница_Key"] in settings.ONEC_WAREHOUSE_IDS]
            if self.dry_run:
                count += len(selected)
                continue
            variants = {v.source_ref: v for v in ProductVariant.objects.filter(source_ref__in=[r["Номенклатура_Key"] for r in selected])}
            warehouses = {w.source_ref: w for w in Warehouse.objects.filter(source_ref__in=[r["СтруктурнаяЕдиница_Key"] for r in selected])}
            for row in selected:
                variant, warehouse = variants.get(row["Номенклатура_Key"]), warehouses.get(row["СтруктурнаяЕдиница_Key"])
                if not variant or not warehouse:
                    continue
                StockProjection.objects.update_or_create(variant=variant, warehouse=warehouse, defaults={"quantity": Decimal(str(row["КоличествоBalance"])), "checked_at": self.now, "fetched_at": self.now})
                seen.add((variant.id, warehouse.id))
                count += 1
        zeroed = 0
        if not self.dry_run:
            stale_query = StockProjection.objects.filter(warehouse__is_sellable=True)
            if settings.ONEC_WAREHOUSE_IDS:
                stale_query = stale_query.filter(warehouse__source_ref__in=settings.ONEC_WAREHOUSE_IDS)
            stale = [stock for stock in stale_query.only("id", "variant_id", "warehouse_id", "quantity", "checked_at", "fetched_at") if (stock.variant_id, stock.warehouse_id) not in seen]
            for stock in stale:
                stock.quantity = Decimal("0")
                stock.checked_at = self.now
                stock.fetched_at = self.now
            StockProjection.objects.bulk_update(stale, ["quantity", "checked_at", "fetched_at"], batch_size=500)
            zeroed = len(stale)
        return {"updated": count, "zeroed": zeroed}

    def images(self) -> dict:
        template = settings.ONEC_MEDIA_URL_TEMPLATE
        if not template:
            return {"skipped": "Не задан ONEC_MEDIA_URL_TEMPLATE: стандартный OData БСП не отдаёт содержимое присоединённых файлов"}

        allowed_extensions = {"jpg", "jpeg", "png", "webp", "gif"}
        downloaded = skipped = missing_variants = failed = 0
        primary_owners = set()
        for rows in self.client.pages(
            "Catalog_НоменклатураПрисоединенныеФайлы",
            select="Ref_Key,ВладелецФайла_Key,Description,ИндексКартинки,Расширение,Размер,DeletionMark",
            filter_="DeletionMark eq false",
            order_by="ВладелецФайла_Key,ИндексКартинки,Ref_Key",
        ):
            rows = [row for row in rows if (row.get("Расширение") or "").lower().lstrip(".") in allowed_extensions]
            variants = {
                variant.source_ref: variant
                for variant in ProductVariant.objects.filter(source_ref__in=[row["ВладелецФайла_Key"] for row in rows])
            }
            for row in rows:
                owner_ref = row["ВладелецФайла_Key"]
                file_ref = row["Ref_Key"]
                variant = variants.get(owner_ref)
                if not variant:
                    missing_variants += 1
                    continue
                media_path = f"products/onec/{owner_ref[:2]}/{file_ref}.webp"
                existing = ProductMedia.objects.filter(source_ref=file_ref).first()
                if existing and existing.image.name == media_path and default_storage.exists(media_path):
                    skipped += 1
                    primary_owners.add(owner_ref)
                    continue
                if self.dry_run:
                    downloaded += 1
                    continue
                try:
                    url = template.format(file_ref=file_ref, owner_ref=owner_ref)
                    content, _content_type = self.client.get_bytes(url)
                    compressed = _compressed_webp(
                        content,
                        max_side=settings.ONEC_IMAGE_MAX_SIDE,
                        quality=settings.ONEC_IMAGE_WEBP_QUALITY,
                    )
                    if default_storage.exists(media_path):
                        default_storage.delete(media_path)
                    saved_path = default_storage.save(media_path, ContentFile(compressed))
                    is_primary = owner_ref not in primary_owners
                    ProductMedia.objects.update_or_create(
                        source_ref=file_ref,
                        defaults={
                            "variant": variant,
                            "image": saved_path,
                            "external_url": "",
                            "alt_text": variant.source_name[:255],
                            "sort_order": int(row.get("ИндексКартинки") or 0),
                            "is_primary": is_primary,
                        },
                    )
                    primary_owners.add(owner_ref)
                    downloaded += 1
                except (ValueError, OSError, RuntimeError, httpx.HTTPError):
                    failed += 1
        return {
            "downloaded": downloaded,
            "skipped": skipped,
            "missing_variants": missing_variants,
            "failed": failed,
        }
