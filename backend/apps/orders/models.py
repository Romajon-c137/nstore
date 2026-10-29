from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import UUIDTimeStampedModel


class Order(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        NEW = "new", "Новый"
        QUEUED = "queued", "В очереди CRM"
        SENT = "sent", "Передан в CRM"
        NEEDS_ATTENTION = "needs_attention", "Требует внимания"
        CANCELLED = "cancelled", "Отменён"

    class PricingState(models.TextChoices):
        FINAL = "final", "Рассчитан"
        NEEDS_CONFIRMATION = "needs_confirmation", "Требует подтверждения"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    company = models.ForeignKey("accounts.Company", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    guest_token = models.UUIDField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NEW, db_index=True)
    pricing_state = models.CharField(max_length=32, choices=PricingState.choices, default=PricingState.FINAL)
    currency = models.CharField(max_length=3, default="KZT")
    subtotal = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    total = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    contact_name = models.CharField(max_length=255)
    contact_phone = models.CharField(max_length=32)
    contact_email = models.EmailField(blank=True)
    delivery_method = models.CharField(max_length=32, default="delivery")
    delivery_address = models.CharField(max_length=500, blank=True)
    comment = models.TextField(blank=True)
    crm_external_id = models.CharField(max_length=255, blank=True, db_index=True)
    crm_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["buyer", "created_at"]), models.Index(fields=["company", "created_at"])]

    def __str__(self):
        return self.number


class OrderLine(UUIDTimeStampedModel):
    class Availability(models.TextChoices):
        SUFFICIENT = "sufficient", "В наличии"
        INSUFFICIENT = "insufficient", "Недостаточно"
        ABSENT = "absent", "Отсутствует"
        UNKNOWN = "unknown", "Не подтверждено"

    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="lines")
    variant = models.ForeignKey("catalog.ProductVariant", null=True, blank=True, on_delete=models.SET_NULL, related_name="order_lines")
    source_ref = models.CharField(max_length=100)
    sku = models.CharField(max_length=100, blank=True)
    title = models.CharField(max_length=500)
    unit = models.CharField(max_length=32)
    quantity = models.DecimalField(max_digits=18, decimal_places=6, validators=[MinValueValidator(Decimal("0.000001"))])
    unit_price = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    line_total = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=3, default="KZT")
    price_list_code = models.CharField(max_length=64, blank=True)
    available_quantity = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    availability = models.CharField(max_length=16, choices=Availability.choices)
    availability_checked_at = models.DateTimeField(null=True, blank=True)
    snapshot = models.JSONField(default=dict)

    class Meta:
        ordering = ["created_at"]


class IdempotencyKey(UUIDTimeStampedModel):
    scope = models.CharField(max_length=128)
    key = models.CharField(max_length=128)
    order = models.OneToOneField(Order, null=True, blank=True, on_delete=models.CASCADE, related_name="idempotency")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["scope", "key"], name="unique_order_idempotency_key")]
