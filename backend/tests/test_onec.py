from io import BytesIO
from decimal import Decimal
from urllib.parse import unquote

import httpx
from PIL import Image

from apps.integrations.onec import OneCClient
from apps.integrations.onec_sync import _compressed_webp, _package_rules, _source_datetime


def test_onec_condition_uses_guid_literals():
    condition = OneCClient.condition_for_refs("Номенклатура_Key", ["a", "b"])
    assert condition == "Номенклатура_Key eq guid'a' or Номенклатура_Key eq guid'b'"
    assert unquote(OneCClient.encoded_condition(condition)) == "'Номенклатура_Key eq guid''a'' or Номенклатура_Key eq guid''b'''"


def test_onec_get_uses_percent20_not_plus():
    def handler(request):
        assert "+" not in str(request.url)
        assert "%20" in str(request.url)
        return httpx.Response(200, json={"value": [{"ok": True}]})

    client = object.__new__(OneCClient)
    client.base_url = "https://onec.example/odata/"
    client.client = httpx.Client(transport=httpx.MockTransport(handler))
    assert client.get("Catalog_Номенклатура", {"$filter": "IsFolder eq false"}) == [{"ok": True}]
    client.close()


def test_onec_retries_temporary_server_errors(monkeypatch):
    attempts = 0

    def handler(request):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"value": [{"ok": True}]})

    monkeypatch.setattr("apps.integrations.onec.time.sleep", lambda _: None)
    client = object.__new__(OneCClient)
    client.base_url = "https://onec.example/odata/"
    client.max_attempts = 4
    client.retry_backoff_seconds = 0
    client.client = httpx.Client(transport=httpx.MockTransport(handler))

    assert client.get("Catalog_Номенклатура") == [{"ok": True}]
    assert attempts == 3
    client.close()


def test_onec_pages_use_stable_ordering():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"value": []})

    client = object.__new__(OneCClient)
    client.base_url = "https://onec.example/odata/"
    client.client = httpx.Client(transport=httpx.MockTransport(handler))
    list(client.pages("Catalog_Номенклатура", select="Ref_Key", order_by="Ref_Key"))
    client.close()

    assert requests[0].url.params["$orderby"] == "Ref_Key"


def test_onec_source_datetime_becomes_timezone_aware():
    value = _source_datetime("2026-10-28T00:00:00")

    assert value is not None
    assert value.tzinfo is not None


def test_onec_image_is_resized_and_converted_to_webp():
    source = BytesIO()
    Image.new("RGB", (2400, 1200), "red").save(source, format="JPEG", quality=95)

    compressed = _compressed_webp(source.getvalue(), max_side=800, quality=80)

    with Image.open(BytesIO(compressed)) as result:
        assert result.format == "WEBP"
        assert result.size == (800, 400)
    assert len(compressed) < len(source.getvalue())


def test_onec_get_bytes_uses_same_authenticated_client():
    def handler(request):
        assert request.headers["accept"] == "image/*,application/octet-stream"
        return httpx.Response(200, content=b"image", headers={"content-type": "image/png; charset=binary"})

    client = object.__new__(OneCClient)
    client.base_url = "https://onec.example/odata/"
    client.client = httpx.Client(transport=httpx.MockTransport(handler))
    content, content_type = client.get_bytes("https://onec.example/hs/media/1")
    client.close()

    assert content == b"image"
    assert content_type == "image/png"


def test_onec_package_rules_require_full_outer_case():
    rows = [
        {"Owner": "product-1", "Owner_Type": "StandardODATA.Catalog_Номенклатура", "Description": "Упаковка", "Коэффициент": 6, "DeletionMark": False},
        {"Owner": "product-1", "Owner_Type": "StandardODATA.Catalog_Номенклатура", "Description": "Кейс", "Коэффициент": 12, "DeletionMark": False},
        {"Owner": "product-2", "Owner_Type": "StandardODATA.Catalog_Номенклатура", "Description": "Кейс", "Коэффициент": 24, "DeletionMark": False},
        {"Owner": "product-3", "Owner_Type": "StandardODATA.Catalog_Номенклатура", "Description": "Штука", "Коэффициент": 1, "DeletionMark": False},
        {"Owner": "deleted", "Owner_Type": "StandardODATA.Catalog_Номенклатура", "Description": "Кейс", "Коэффициент": 10, "DeletionMark": True},
    ]

    rules = _package_rules(rows)

    assert rules["product-1"] == {"package_label": "Кейс", "package_qty": Decimal("12"), "min_qty": Decimal("12"), "qty_step": Decimal("12")}
    assert rules["product-2"]["qty_step"] == Decimal("24")
    assert "product-3" not in rules
    assert "deleted" not in rules
