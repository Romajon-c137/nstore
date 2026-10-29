from __future__ import annotations

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import ProductMedia, ProductVariant
from apps.integrations.onec_sync import _compressed_webp


class Command(BaseCommand):
    help = "Скачивает фото старого каталога Supabase, сжимает в WebP и сохраняет через Django Storage"

    def add_arguments(self, parser):
        parser.add_argument("--url", default=os.getenv("LEGACY_SUPABASE_URL", ""))
        parser.add_argument("--key", default=os.getenv("LEGACY_SUPABASE_KEY", ""))
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--workers", type=int, default=8)
        parser.add_argument("--limit", type=int, default=0)

    def handle(self, *args, **options):
        base_url = options["url"].rstrip("/")
        api_key = options["key"]
        if not base_url or not api_key:
            raise CommandError("Задайте LEGACY_SUPABASE_URL и LEGACY_SUPABASE_KEY")

        headers = {"apikey": api_key, "Authorization": f"Bearer {api_key}"}
        params = {
            "select": "sku,name,image_url",
            "is_active": "eq.true",
            "image_url": "not.is.null",
        }
        with httpx.Client(timeout=30, follow_redirects=True, headers=headers) as client:
            rows = []
            page_size = 1000
            for offset in range(0, 100_000, page_size):
                response = client.get(
                    f"{base_url}/rest/v1/products",
                    params=params | {"limit": str(page_size), "offset": str(offset)},
                )
                response.raise_for_status()
                page = response.json()
                rows.extend(page)
                if len(page) < page_size:
                    break
            rows = [row for row in rows if (row.get("sku") or "").strip() and (row.get("image_url") or "").strip()]

        variants = {
            variant.sku.strip(): variant
            for variant in ProductVariant.objects.filter(sku__in=[row["sku"].strip() for row in rows]).select_related("product")
            if variant.sku.strip()
        }
        matched = [(row, variants[row["sku"].strip()]) for row in rows if row["sku"].strip() in variants]
        if options["limit"]:
            matched = matched[: options["limit"]]
        self.stdout.write(f"Источник: {len(rows)} фото; совпало по SKU: {len(matched)}")
        if options["dry_run"]:
            return

        jobs = []
        skipped = 0
        for row, variant in matched:
            sku = row["sku"].strip()
            source_ref = f"legacy-{hashlib.sha256(sku.encode()).hexdigest()[:32]}"
            media_path = f"products/legacy/{source_ref}.webp"
            existing = ProductMedia.objects.filter(source_ref=source_ref).first()
            if existing and existing.image.name == media_path and default_storage.exists(media_path):
                skipped += 1
                continue
            jobs.append((row, variant, source_ref, media_path))

        def download(job):
            row, variant, source_ref, media_path = job
            with httpx.Client(timeout=45, follow_redirects=True, headers={"User-Agent": "NstoreMediaImport/1.0"}) as client:
                response = client.get(row["image_url"])
                response.raise_for_status()
                if len(response.content) > 20 * 1024 * 1024:
                    raise ValueError("файл больше 20 МБ")
                compressed = _compressed_webp(
                    response.content,
                    max_side=settings.ONEC_IMAGE_MAX_SIDE,
                    quality=settings.ONEC_IMAGE_WEBP_QUALITY,
                )
            return row, variant, source_ref, media_path, compressed

        imported = failed = 0
        with ThreadPoolExecutor(max_workers=max(1, min(options["workers"], 16))) as pool:
            futures = {pool.submit(download, job): job for job in jobs}
            for future in as_completed(futures):
                try:
                    row, variant, source_ref, media_path, compressed = future.result()
                    if default_storage.exists(media_path):
                        default_storage.delete(media_path)
                    saved_path = default_storage.save(media_path, ContentFile(compressed))
                    ProductMedia.objects.update_or_create(
                        source_ref=source_ref,
                        defaults={
                            "variant": variant,
                            "image": saved_path,
                            "external_url": "",
                            "alt_text": (row.get("name") or variant.source_name)[:255],
                            "sort_order": 0,
                            "is_primary": not variant.media.exclude(source_ref=source_ref).exists(),
                        },
                    )
                    imported += 1
                    if imported % 50 == 0:
                        self.stdout.write(f"Импортировано: {imported}")
                except (httpx.HTTPError, OSError, ValueError) as exc:
                    failed += 1
                    if failed <= 10:
                        self.stderr.write(f"Пропущено: {exc}")

        self.stdout.write(self.style.SUCCESS(f"Готово: импортировано {imported}, уже было {skipped}, ошибок {failed}"))
