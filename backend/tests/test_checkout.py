import uuid
from decimal import Decimal

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Company, CompanyMembership, User
from apps.catalog.models import CompanyPriceList, Price, PriceList
from apps.integrations.models import OutboxEvent
from apps.integrations.tasks import process_event
from apps.orders.models import Order


@pytest.mark.django_db
def test_guest_checkout_accepts_quantity_above_stock_and_is_idempotent(catalog_item):
    variant, _ = catalog_item
    client = APIClient()
    headers = {"HTTP_IDEMPOTENCY_KEY": "checkout-1", "HTTP_X_GUEST_TOKEN": str(uuid.uuid4())}
    payload = {
        "contact_name": "Тест",
        "contact_phone": "+77000000000",
        "delivery_method": "delivery",
        "delivery_address": "Алматы",
        "lines": [{"variant_id": str(variant.id), "quantity": "5"}],
    }

    first = client.post("/api/v1/checkout/", payload, format="json", **headers)
    second = client.post("/api/v1/checkout/", payload, format="json", **headers)

    assert first.status_code == 201, first.data
    assert second.status_code == 200, second.data
    assert first.data["id"] == second.data["id"]
    assert Order.objects.count() == 1
    line = Order.objects.get().lines.get()
    assert line.availability == "insufficient"
    assert line.quantity == Decimal("5")
    assert OutboxEvent.objects.filter(aggregate_id=first.data["id"]).count() == 1


@pytest.mark.django_db
def test_zero_stock_is_absent_but_order_is_accepted(catalog_item):
    variant, stock = catalog_item
    stock.quantity = 0
    stock.save()
    client = APIClient()
    response = client.post(
        "/api/v1/checkout/",
        {"contact_name": "Тест", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-zero",
        HTTP_X_GUEST_TOKEN=str(uuid.uuid4()),
    )
    assert response.status_code == 201, response.data
    assert response.data["lines"][0]["availability"] == "absent"


@pytest.mark.django_db
def test_case_product_cannot_be_ordered_by_single_units(catalog_item):
    variant, _ = catalog_item
    variant.package_label = "Кейс"
    variant.package_qty = Decimal("12")
    variant.min_qty = Decimal("12")
    variant.qty_step = Decimal("12")
    variant.save(update_fields=["package_label", "package_qty", "min_qty", "qty_step"])
    client = APIClient()
    headers = {"HTTP_X_GUEST_TOKEN": str(uuid.uuid4())}
    payload = {"contact_name": "Тест", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]}

    rejected = client.post("/api/v1/checkout/", payload, format="json", HTTP_IDEMPOTENCY_KEY="case-single", **headers)
    accepted = client.post("/api/v1/checkout/", {**payload, "lines": [{"variant_id": str(variant.id), "quantity": "12"}]}, format="json", HTTP_IDEMPOTENCY_KEY="case-full", **headers)

    assert rejected.status_code == 400
    assert "минимум 12" in str(rejected.data)
    assert accepted.status_code == 201, accepted.data


@pytest.mark.django_db
def test_missing_price_is_null_and_does_not_become_zero(catalog_item):
    variant, _ = catalog_item
    variant.prices.all().delete()
    client = APIClient()
    response = client.post(
        "/api/v1/checkout/",
        {"contact_name": "Тест", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-no-price",
        HTTP_X_GUEST_TOKEN=str(uuid.uuid4()),
    )
    assert response.status_code == 201, response.data
    assert response.data["pricing_state"] == "needs_confirmation"
    assert response.data["total"] is None
    assert response.data["lines"][0]["unit_price"] is None


@pytest.mark.django_db(transaction=True)
@override_settings(CRM_MODE="mock", ONEC_BASE_URL="", ONEC_USERNAME="", ONEC_PASSWORD="")
def test_outbox_delivery_marks_order_sent(catalog_item):
    variant, _ = catalog_item
    client = APIClient()
    response = client.post(
        "/api/v1/checkout/",
        {"contact_name": "Тест", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-crm",
        HTTP_X_GUEST_TOKEN=str(uuid.uuid4()),
    )
    event = OutboxEvent.objects.get(aggregate_id=response.data["id"])
    process_event(event.id)
    event.refresh_from_db()
    order = Order.objects.get(id=response.data["id"])
    assert event.status == OutboxEvent.Status.DELIVERED
    assert order.status == Order.Status.SENT
    assert order.crm_external_id.startswith("mock-")


@pytest.mark.django_db
@override_settings(CRM_MODE="disabled", ONEC_BASE_URL="", ONEC_USERNAME="", ONEC_PASSWORD="")
def test_disabled_crm_keeps_event_pending_without_spending_retry(catalog_item):
    variant, _ = catalog_item
    client = APIClient()
    response = client.post(
        "/api/v1/checkout/",
        {"contact_name": "Тест", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-disabled-crm",
        HTTP_X_GUEST_TOKEN=str(uuid.uuid4()),
    )
    event = OutboxEvent.objects.get(aggregate_id=response.data["id"])
    process_event(event.id)
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    assert event.attempts == 0


@pytest.mark.django_db
def test_b2b_price_and_company_order_visibility(catalog_item):
    variant, _ = catalog_item
    user = User.objects.create_user(email="buyer@example.com", password="safe-pass-123")
    viewer = User.objects.create_user(email="viewer@example.com", password="safe-pass-123")
    company = Company.objects.create(name="B2B клиент")
    CompanyMembership.objects.create(company=company, user=user, role=CompanyMembership.Role.BUYER, can_order=True)
    CompanyMembership.objects.create(company=company, user=viewer, role=CompanyMembership.Role.VIEWER, can_order=False)
    b2b = PriceList.objects.create(code="top", name="Топ клиенты")
    CompanyPriceList.objects.create(company=company, price_list=b2b)
    Price.objects.create(variant=variant, price_list=b2b, amount=Decimal("1000"), fetched_at=variant.created_at)

    buyer_client = APIClient()
    buyer_client.force_authenticate(user)
    created = buyer_client.post(
        "/api/v1/checkout/",
        {"company_id": str(company.id), "contact_name": "Закупщик", "contact_phone": "+77000000000", "lines": [{"variant_id": str(variant.id), "quantity": "1"}]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="b2b-order",
    )
    assert created.status_code == 201, created.data
    assert created.data["total"] == "1000.0000"

    viewer_client = APIClient()
    viewer_client.force_authenticate(viewer)
    detail = viewer_client.get(f"/api/v1/orders/{created.data['id']}/")
    assert detail.status_code == 200
