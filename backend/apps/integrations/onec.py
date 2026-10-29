from __future__ import annotations

import time
from collections.abc import Iterator
from decimal import Decimal
from urllib.parse import quote

import httpx
from django.conf import settings


class OneCNotConfigured(RuntimeError):
    pass


class OneCClient:
    def __init__(self):
        if not settings.ONEC_BASE_URL or not settings.ONEC_USERNAME or not settings.ONEC_PASSWORD:
            raise OneCNotConfigured("ONEC_BASE_URL/ONEC_USERNAME/ONEC_PASSWORD не настроены")
        self.base_url = settings.ONEC_BASE_URL.rstrip("/") + "/"
        self.client = httpx.Client(
            auth=(settings.ONEC_USERNAME, settings.ONEC_PASSWORD),
            timeout=httpx.Timeout(settings.ONEC_TIMEOUT_SECONDS),
            verify=settings.ONEC_VERIFY_TLS,
            headers={"Accept": "application/json"},
        )
        self.max_attempts = max(1, settings.ONEC_RETRY_ATTEMPTS)
        self.retry_backoff_seconds = max(0.0, settings.ONEC_RETRY_BACKOFF_SECONDS)

    def close(self):
        self.client.close()

    def _request(self, url: str, *, headers: dict | None = None) -> httpx.Response:
        attempts = getattr(self, "max_attempts", 3)
        backoff = getattr(self, "retry_backoff_seconds", 0.5)
        for attempt in range(attempts):
            try:
                response = self.client.get(url, headers=headers)
                if response.status_code != 429 and response.status_code < 500:
                    response.raise_for_status()
                    return response
                response.raise_for_status()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                retryable = isinstance(exc, httpx.TransportError) or exc.response.status_code == 429 or exc.response.status_code >= 500
                if not retryable or attempt + 1 >= attempts:
                    raise
                time.sleep(backoff * (2 ** attempt))
        raise RuntimeError("unreachable")

    def get(self, path: str, params: dict | None = None) -> list[dict]:
        query = str(httpx.QueryParams((params or {}) | {"$format": "json"})).replace("+", "%20")
        response = self._request(self.base_url + path + "?" + query)
        body = response.json()
        return body.get("value", body.get("d", {}).get("results", []))

    def get_bytes(self, path_or_url: str) -> tuple[bytes, str]:
        url = path_or_url if path_or_url.startswith(("http://", "https://")) else self.base_url + path_or_url.lstrip("/")
        response = self._request(url, headers={"Accept": "image/*,application/octet-stream"})
        return response.content, response.headers.get("content-type", "").split(";", 1)[0].lower()

    def pages(self, path: str, *, select: str, filter_: str = "", order_by: str = "", page_size: int = 500) -> Iterator[list[dict]]:
        skip = 0
        while True:
            params = {"$select": select, "$top": page_size, "$skip": skip}
            if filter_:
                params["$filter"] = filter_
            if order_by:
                params["$orderby"] = order_by
            rows = self.get(path, params)
            if not rows:
                return
            yield rows
            if len(rows) < page_size:
                return
            skip += page_size

    @staticmethod
    def condition_for_refs(field: str, refs: list[str]) -> str:
        return " or ".join(f"{field} eq guid'{ref}'" for ref in refs)

    @staticmethod
    def encoded_condition(condition: str) -> str:
        return quote("'" + condition.replace("'", "''") + "'", safe="")

    def availability(self, source_refs: list[str]) -> dict[str, Decimal]:
        result = {ref: Decimal("0") for ref in source_refs}
        for start in range(0, len(source_refs), 40):
            chunk = source_refs[start:start + 40]
            condition = self.condition_for_refs("Номенклатура_Key", chunk)
            literal = self.encoded_condition(condition)
            path = f"AccumulationRegister_ЗапасыНаСкладах/Balance(Condition={literal},Dimensions='Номенклатура,СтруктурнаяЕдиница')"
            rows = self.get(path, {"$select": "Номенклатура_Key,СтруктурнаяЕдиница_Key,КоличествоBalance"})
            for row in rows:
                warehouse = row.get("СтруктурнаяЕдиница_Key")
                if settings.ONEC_WAREHOUSE_IDS and warehouse not in settings.ONEC_WAREHOUSE_IDS:
                    continue
                ref = row["Номенклатура_Key"]
                result[ref] = result.get(ref, Decimal("0")) + Decimal(str(row.get("КоличествоBalance", 0)))
        return result
