from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import UUIDTimeStampedModel


class Category(UUIDTimeStampedModel):
    source_ref = models.CharField(max_length=100, blank=True, db_index=True)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "Категории"

    def __str__(self):
        return self.name


class Product(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        PUBLISHED = "published", "Опубликован"
        ARCHIVED = "archived", "Архив"

    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    title = models.CharField(max_length=500)
    slug = models.SlugField(max_length=500, unique=True)
    brand = models.CharField(max_length=255, blank=True, db_index=True)
    description = models.TextField(blank=True)
    seo_title = models.CharField(max_length=255, blank=True)
    seo_description = models.CharField(max_length=500, blank=True)
    attributes = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "category"]), models.Index(fields=["status", "brand"])]

    def __str__(self):
        return self.title


class ProductVariant(UUIDTimeStampedModel):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="variants")
    source_ref = models.CharField(max_length=100, unique=True)
    sku = models.CharField(max_length=100, blank=True, db_index=True)
    barcode = models.CharField(max_length=100, blank=True, db_index=True)
    source_name = models.CharField(max_length=500)
    unit = models.CharField(max_length=32, default="шт")
    package_label = models.CharField(max_length=255, blank=True)
    package_qty = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("1"), validators=[MinValueValidator(Decimal("0.000001"))])
    min_qty = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("1"), validators=[MinValueValidator(Decimal("0.000001"))])
    qty_step = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal("1"), validators=[MinValueValidator(Decimal("0.000001"))])
    is_active = models.BooleanField(default=True, db_index=True)
    raw_source = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["sku", "source_name"]

    def __str__(self):
        return f"{self.sku or self.source_ref} — {self.source_name}"


class ProductMedia(UUIDTimeStampedModel):
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="media")
    source_ref = models.CharField(max_length=100, blank=True, unique=True, null=True)
    image = models.ImageField(upload_to="products/%Y/%m/", blank=True)
    external_url = models.URLField(max_length=1000, blank=True)
    alt_text = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["sort_order", "created_at"]


class PriceList(UUIDTimeStampedModel):
    code = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    source_ref = models.CharField(max_length=100, blank=True, db_index=True)
    is_retail = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class CompanyPriceList(UUIDTimeStampedModel):
    company = models.OneToOneField("accounts.Company", on_delete=models.CASCADE, related_name="pricing")
    price_list = models.ForeignKey(PriceList, on_delete=models.PROTECT)
    discount_percent = models.DecimalField(max_digits=7, decimal_places=4, default=Decimal("0"))


class Price(UUIDTimeStampedModel):
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="prices")
    price_list = models.ForeignKey(PriceList, on_delete=models.CASCADE, related_name="prices")
    amount = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=3, default="KZT")
    source_period = models.DateTimeField(null=True, blank=True)
    fetched_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["variant", "price_list"], name="unique_variant_price_list")]
        indexes = [models.Index(fields=["price_list", "variant"])]


class Warehouse(UUIDTimeStampedModel):
    source_ref = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)
    is_sellable = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class StockProjection(UUIDTimeStampedModel):
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="stocks")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stocks")
    quantity = models.DecimalField(max_digits=18, decimal_places=6)
    checked_at = models.DateTimeField()
    fetched_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["variant", "warehouse"], name="unique_variant_warehouse_stock")]
        indexes = [models.Index(fields=["variant", "checked_at"])]
