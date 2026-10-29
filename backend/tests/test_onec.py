from io import BytesIO
from urllib.parse import unquote

import httpx
from PIL import Image

from apps.integrations.onec import OneCClient
from apps.integrations.onec_sync import _compressed_webp, _source_datetime


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
