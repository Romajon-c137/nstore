import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Company, CompanyMembership, User
from apps.catalog.models import Price, Product, ProductMedia, ProductVariant, StockProjection


@pytest.mark.django_db
def test_catalog_list_shape_and_health(catalog_item):
    client = APIClient()
    health = client.get("/api/v1/health/")
    products = client.get("/api/v1/catalog/products/")
    assert health.status_code == 200
    assert products.status_code == 200, products.data
    assert products.data["count"] == 1
    assert str(products.data["results"][0]["variants"][0]["price"]["amount"]) == "1500.00"
    assert products.data["results"][0]["variants"][0]["availability"] == "sufficient"


@pytest.mark.django_db
def test_storefront_lookup_and_relative_media_url(catalog_item):
    variant, _ = catalog_item
    ProductMedia.objects.create(
        variant=variant,
        image=SimpleUploadedFile("coffee.png", b"not-a-real-image", content_type="image/png"),
        is_primary=True,
    )

    response = APIClient().get("/api/v1/catalog/products/lookup/?slug=testovyy-kofe-sku-1")

    assert response.status_code == 200, response.data
    assert response.data["variants"][0]["sku"] == "SKU-1"
    assert response.data["variants"][0]["images"][0]["url"].startswith("/media/")
    assert "testserver" not in response.data["variants"][0]["images"][0]["url"]


@pytest.mark.django_db
def test_order_history_is_private(catalog_item):
    response = APIClient().get("/api/v1/orders/")
    assert response.status_code in {401, 403}


@pytest.mark.django_db
def test_registration_requires_csrf_and_creates_session():
    client = APIClient(enforce_csrf_checks=True)
    payload = {"email": "new@example.com", "password": "correct-horse-battery-staple"}
    denied = client.post("/api/v1/auth/register/", payload, format="json")
    assert denied.status_code == 403
    csrf = client.get("/api/v1/auth/csrf/").data["csrf_token"]
    created = client.post("/api/v1/auth/register/", payload, format="json", HTTP_X_CSRFTOKEN=csrf)
    assert created.status_code == 201, created.data
    assert client.get("/api/v1/auth/me/").status_code == 200


@pytest.mark.django_db
def test_profile_exposes_company_order_permission():
    user = User.objects.create_user(email="viewer-profile@example.com", password="safe-pass-123")
    company = Company.objects.create(name="Только просмотр")
    CompanyMembership.objects.create(company=company, user=user, role=CompanyMembership.Role.VIEWER, can_order=False)
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["companies"] == [
        {"id": str(company.id), "name": company.name, "bin": "", "role": "viewer", "can_order": False}
    ]


@pytest.mark.django_db
def test_catalog_queries_do_not_grow_per_product(catalog_item, django_assert_max_num_queries):
    base_variant, base_stock = catalog_item
    price_list = base_variant.prices.get().price_list
    warehouse = base_stock.warehouse
    variants = []
    for index in range(10):
        product = Product.objects.create(title=f"Товар {index}", slug=f"product-{index}", status=Product.Status.PUBLISHED)
        variants.append(ProductVariant.objects.create(product=product, source_ref=f"00000000-0000-0000-0000-{index:012d}", sku=f"SKU-{index + 2}", source_name=product.title))
    Price.objects.bulk_create([Price(variant=variant, price_list=price_list, amount=1000, fetched_at=timezone.now()) for variant in variants])
    StockProjection.objects.bulk_create([StockProjection(variant=variant, warehouse=warehouse, quantity=1, checked_at=timezone.now(), fetched_at=timezone.now()) for variant in variants])

    with django_assert_max_num_queries(10):
        response = APIClient().get("/api/v1/catalog/products/?page_size=100")
        assert response.status_code == 200
        assert response.data["count"] == 11
