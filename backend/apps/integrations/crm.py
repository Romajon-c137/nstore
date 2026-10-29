import httpx
from django.conf import settings


class CRMNotConfigured(RuntimeError):
    pass


def order_payload(order) -> dict:
    return {
        "external_id": str(order.id),
        "number": order.number,
        "created_at": order.created_at.isoformat(),
        "buyer": {"id": str(order.buyer_id) if order.buyer_id else None, "company_id": str(order.company_id) if order.company_id else None, "name": order.contact_name, "phone": order.contact_phone, "email": order.contact_email},
        "delivery": {"method": order.delivery_method, "address": order.delivery_address, "comment": order.comment},
        "pricing": {"state": order.pricing_state, "currency": order.currency, "subtotal": str(order.subtotal) if order.subtotal is not None else None, "total": str(order.total) if order.total is not None else None},
        "lines": [{
            "source_ref": line.source_ref, "sku": line.sku, "title": line.title, "unit": line.unit,
            "quantity": str(line.quantity), "unit_price": str(line.unit_price) if line.unit_price is not None else None,
            "line_total": str(line.line_total) if line.line_total is not None else None,
            "availability": line.availability,
            "available_quantity": str(line.available_quantity) if line.available_quantity is not None else None,
            "availability_checked_at": line.availability_checked_at.isoformat() if line.availability_checked_at else None,
        } for line in order.lines.all()],
    }


class CRMClient:
    def submit_order(self, order) -> tuple[str, int, str]:
        if settings.CRM_MODE == "mock":
            return f"mock-{order.id}", 200, "mock accepted"
        if settings.CRM_MODE != "http" or not settings.CRM_BASE_URL or not settings.CRM_TOKEN:
            raise CRMNotConfigured("CRM_MODE=http, CRM_BASE_URL и CRM_TOKEN должны быть настроены")
        response = httpx.post(
            settings.CRM_BASE_URL.rstrip("/") + "/orders",
            json=order_payload(order),
            headers={"Authorization": f"Bearer {settings.CRM_TOKEN}", "Idempotency-Key": str(order.id), "Accept": "application/json"},
            timeout=httpx.Timeout(settings.CRM_TIMEOUT_SECONDS), verify=settings.CRM_VERIFY_TLS,
        )
        response.raise_for_status()
        body = response.json()
        external_id = str(body.get("id") or body.get("external_id") or "")
        if not external_id:
            raise ValueError("CRM не вернула id заказа")
        return external_id, response.status_code, response.text[:1000]
