from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

from apps.accounts.models import CompanyMembership

from .models import CompanyPriceList, Price, PriceList, ProductVariant


@dataclass(frozen=True)
class ResolvedPrice:
    amount: Decimal | None
    currency: str
    price_list_code: str | None


@dataclass(frozen=True)
class PricingContext:
    price_list: PriceList | None
    discount: Decimal


def get_pricing_context(user=None, company_id=None) -> PricingContext:
    price_list = None
    discount = Decimal("0")
    if user and user.is_authenticated and company_id:
        if not CompanyMembership.objects.filter(user=user, company_id=company_id, can_order=True).exists():
            raise PermissionError("Нет права оформлять заказ для этой компании")
        assignment = CompanyPriceList.objects.select_related("price_list").filter(company_id=company_id, price_list__is_active=True).first()
        if assignment:
            price_list, discount = assignment.price_list, assignment.discount_percent
    if price_list is None:
        price_list = PriceList.objects.filter(is_retail=True, is_active=True).order_by("created_at").first()
    return PricingContext(price_list, discount)


def resolve_price(variant: ProductVariant, user=None, company_id=None, *, context: PricingContext | None = None) -> ResolvedPrice:
    pricing = context or get_pricing_context(user, company_id)
    price_list = pricing.price_list
    if price_list is None:
        return ResolvedPrice(None, "KZT", None)
    if "prices" in getattr(variant, "_prefetched_objects_cache", {}):
        price = next((item for item in variant.prices.all() if item.price_list_id == price_list.id), None)
    else:
        price = Price.objects.filter(variant=variant, price_list=price_list).first()
    if not price or price.amount is None:
        return ResolvedPrice(None, "KZT", price_list.code)
    amount = price.amount * (Decimal("100") - pricing.discount) / Decimal("100")
    return ResolvedPrice(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), price.currency, price_list.code)


def total_sellable_stock(variant: ProductVariant):
    if "stocks" in getattr(variant, "_prefetched_objects_cache", {}):
        values = [stock.quantity for stock in variant.stocks.all() if stock.warehouse.is_sellable]
        return sum(values, Decimal("0")) if values else None
    value = variant.stocks.filter(warehouse__is_sellable=True).aggregate(value=Sum("quantity"))["value"]
    return value


def availability_state(available: Decimal | None, requested: Decimal | None = None) -> str:
    if available is None:
        return "unknown"
    if available <= 0:
        return "absent"
    if requested is not None and available < requested:
        return "insufficient"
    return "sufficient"
