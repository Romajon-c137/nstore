import logging
import time
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.catalog.services import availability_state
from apps.orders.models import Order

from .crm import CRMClient, CRMNotConfigured
from .models import IntegrationAttempt, OutboxEvent
from .onec import OneCClient, OneCNotConfigured

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 12


def _refresh_availability(order):
    try:
        client = OneCClient()
    except OneCNotConfigured:
        return
    try:
        refs = [line.source_ref for line in order.lines.all()]
        values = client.availability(refs)
        checked_at = timezone.now()
        for line in order.lines.all():
            line.available_quantity = values.get(line.source_ref)
            line.availability = availability_state(line.available_quantity, line.quantity)
            line.availability_checked_at = checked_at
            line.save(update_fields=["available_quantity", "availability", "availability_checked_at", "updated_at"])
    except Exception:
        logger.exception("1C availability refresh failed for order %s; submitting with local snapshot", order.id)
    finally:
        client.close()


def process_event(event_id):
    with transaction.atomic():
        event = OutboxEvent.objects.select_for_update().get(pk=event_id)
        if event.status == OutboxEvent.Status.DELIVERED:
            return
        if event.topic != "order.submit_to_crm":
            event.status = OutboxEvent.Status.DEAD
            event.last_error = f"Unknown topic: {event.topic}"
            event.save(update_fields=["status", "last_error", "updated_at"])
            return
        event.status = OutboxEvent.Status.PROCESSING
        event.locked_at = timezone.now()
        event.attempts += 1
        event.save(update_fields=["status", "locked_at", "attempts", "updated_at"])

    started = time.monotonic()
    http_status = None
    excerpt = ""
    try:
        order = Order.objects.prefetch_related("lines").get(pk=event.aggregate_id)
        _refresh_availability(order)
        external_id, http_status, excerpt = CRMClient().submit_order(order)
        now = timezone.now()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            order.status = Order.Status.SENT
            order.crm_external_id = external_id
            order.crm_sent_at = now
            order.save(update_fields=["status", "crm_external_id", "crm_sent_at", "updated_at"])
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            event.status = OutboxEvent.Status.DELIVERED
            event.delivered_at = now
            event.last_error = ""
            event.save(update_fields=["status", "delivered_at", "last_error", "updated_at"])
        IntegrationAttempt.objects.create(event_id=event_id, system="crm", succeeded=True, http_status=http_status, duration_ms=int((time.monotonic() - started) * 1000), response_excerpt=excerpt)
    except CRMNotConfigured as exc:
        logger.warning("CRM is not configured; event %s remains pending", event_id)
        with transaction.atomic():
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            event.attempts = max(0, event.attempts - 1)
            event.status = OutboxEvent.Status.PENDING
            event.last_error = str(exc)[:4000]
            event.available_at = timezone.now() + timedelta(hours=1)
            event.save(update_fields=["attempts", "status", "last_error", "available_at", "updated_at"])
        IntegrationAttempt.objects.create(event_id=event_id, system="crm", succeeded=False, duration_ms=int((time.monotonic() - started) * 1000), error=str(exc)[:4000])
    except Exception as exc:
        logger.exception("CRM delivery failed for event %s", event_id)
        with transaction.atomic():
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            event.last_error = str(exc)[:4000]
            if event.attempts >= MAX_ATTEMPTS:
                event.status = OutboxEvent.Status.DEAD
                Order.objects.filter(pk=event.aggregate_id).update(status=Order.Status.NEEDS_ATTENTION)
            else:
                event.status = OutboxEvent.Status.PENDING
                delay = min(3600, 15 * (2 ** min(event.attempts, 8)))
                event.available_at = timezone.now() + timedelta(seconds=delay)
            event.save(update_fields=["status", "last_error", "available_at", "updated_at"])
        IntegrationAttempt.objects.create(event_id=event_id, system="crm", succeeded=False, http_status=http_status, duration_ms=int((time.monotonic() - started) * 1000), error=str(exc)[:4000], response_excerpt=excerpt)


@shared_task(ignore_result=True)
def deliver_pending_outbox(batch_size=50):
    stale = timezone.now() - timedelta(minutes=5)
    with transaction.atomic():
        events = list(
            OutboxEvent.objects.select_for_update(skip_locked=True)
            .filter(Q(status=OutboxEvent.Status.PENDING, available_at__lte=timezone.now()) | Q(status=OutboxEvent.Status.PROCESSING, locked_at__lt=stale))
            .order_by("created_at")[:batch_size]
        )
        ids = [event.id for event in events]
    for event_id in ids:
        process_event(event_id)
    return len(ids)
