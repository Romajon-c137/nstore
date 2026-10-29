from decimal import Decimal

import pytest
from django.utils import timezone

from apps.catalog.models import Price, PriceList, Product, ProductVariant, StockProjection, Warehouse


@pytest.fixture
def catalog_item(db):
    product = Product.objects.create(title="Тестовый кофе", slug="test-coffee", status=Product.Status.PUBLISHED)
    variant = ProductVariant.objects.create(product=product, source_ref="11111111-1111-1111-1111-111111111111", sku="SKU-1", source_name=product.title)
    price_list = PriceList.objects.create(code="retail", name="Розница", is_retail=True)
    Price.objects.create(variant=variant, price_list=price_list, amount=Decimal("1500.00"), fetched_at=timezone.now())
    warehouse = Warehouse.objects.create(source_ref="22222222-2222-2222-2222-222222222222", name="Основной", is_sellable=True)
    stock = StockProjection.objects.create(variant=variant, warehouse=warehouse, quantity=Decimal("2"), checked_at=timezone.now(), fetched_at=timezone.now())
    return variant, stock
