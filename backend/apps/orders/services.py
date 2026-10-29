import uuid
from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import CompanyMembership
from apps.catalog.models import ProductVariant
from apps.catalog.services import availability_state, get_pricing_context, resolve_price, total_sellable_stock

from .models import IdempotencyKey, Order, OrderLine


@dataclass(frozen=True)
class LineRequest:
    variant_id: uuid.UUID
    quantity: Decimal


def _scope(user, guest_token) -> str:
    if user and user.is_authenticated:
        return f"user:{user.pk}"
    if not guest_token:
        raise ValueError("Для гостевого заказа нужен X-Guest-Token")
    return f"guest:{guest_token}"


@transaction.atomic
def create_order(*, user, guest_token, idempotency_key, company_id, contact, delivery, lines):
    scope = _scope(user, guest_token)
    idem, created = IdempotencyKey.objects.select_for_update().get_or_create(scope=scope, key=idempotency_key)
    if not created and idem.order_id:
        return idem.order, False

    company = None
    if company_id:
        if not user or not user.is_authenticated:
            raise PermissionError("Гостевой заказ не может использовать компанию")
        membership = CompanyMembership.objects.filter(user=user, company_id=company_id, can_order=True).select_related("company").first()
        if not membership:
            raise PermissionError("Нет права оформлять заказ для компании")
        company = membership.company

    variant_ids = [line.variant_id for line in lines]
    variants = {
        v.id: v for v in ProductVariant.objects.filter(id__in=variant_ids, is_active=True, product__status="published")
        .select_related("product").prefetch_related("prices", "stocks__warehouse")
    }
    if len(variants) != len(set(variant_ids)):
        raise ValueError("Один или несколько товаров не найдены или скрыты")

    order = Order(
        number=f"NS-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:8].upper()}",
        buyer=user if user and user.is_authenticated else None,
        company=company,
        guest_token=guest_token if not user or not user.is_authenticated else None,
        contact_name=contact["name"], contact_phone=contact["phone"], contact_email=contact.get("email", ""),
        delivery_method=delivery.get("method", "delivery"), delivery_address=delivery.get("address", ""),
        comment=delivery.get("comment", ""), status=Order.Status.QUEUED,
    )
    order.save()

    subtotal = Decimal("0")
    complete_price = True
    now = timezone.now()
    pricing_context = get_pricing_context(user, company_id)
    order_lines = []
    for requested in lines:
        variant = variants[requested.variant_id]
        if requested.quantity <= 0:
            raise ValueError("Количество должно быть больше нуля")
        if requested.quantity < variant.min_qty or requested.quantity % variant.qty_step != 0:
            raise ValueError(f"Количество для {variant.sku or variant.source_name}: минимум {variant.min_qty}, шаг {variant.qty_step}")
        price = resolve_price(variant, context=pricing_context)
        available = total_sellable_stock(variant)
        state = availability_state(available, requested.quantity)
        line_total = price.amount * requested.quantity if price.amount is not None else None
        if line_total is None:
            complete_price = False
        else:
            subtotal += line_total
        order_lines.append(OrderLine(
            order=order, variant=variant, source_ref=variant.source_ref, sku=variant.sku,
            title=variant.source_name, unit=variant.unit, quantity=requested.quantity,
            unit_price=price.amount, line_total=line_total, currency=price.currency,
            price_list_code=price.price_list_code or "", available_quantity=available,
            availability=state, availability_checked_at=now if available is not None else None,
            snapshot={"product_id": str(variant.product_id), "variant_id": str(variant.id), "product_slug": variant.product.slug},
        ))
    OrderLine.objects.bulk_create(order_lines)
    order.pricing_state = Order.PricingState.FINAL if complete_price else Order.PricingState.NEEDS_CONFIRMATION
    order.subtotal = subtotal if complete_price else None
    order.total = subtotal if complete_price else None
    order.save(update_fields=["pricing_state", "subtotal", "total", "updated_at"])
    idem.order = order
    idem.save(update_fields=["order", "updated_at"])

    from apps.integrations.models import OutboxEvent
    OutboxEvent.objects.create(topic="order.submit_to_crm", aggregate_id=order.id, payload={"order_id": str(order.id)})
    return order, True
