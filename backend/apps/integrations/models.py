from django.db import models
from django.utils import timezone

from apps.common.models import UUIDTimeStampedModel


class SyncRun(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        RUNNING = "running", "Выполняется"
        SUCCEEDED = "succeeded", "Успешно"
        FAILED = "failed", "Ошибка"

    kind = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    counters = models.JSONField(default=dict)
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]


class OutboxEvent(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        PROCESSING = "processing", "Обрабатывается"
        DELIVERED = "delivered", "Доставлено"
        DEAD = "dead", "Остановлено"

    topic = models.CharField(max_length=100, db_index=True)
    aggregate_id = models.UUIDField(db_index=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "available_at"])]


class IntegrationAttempt(UUIDTimeStampedModel):
    event = models.ForeignKey(OutboxEvent, on_delete=models.CASCADE, related_name="attempt_log")
    system = models.CharField(max_length=32)
    succeeded = models.BooleanField(default=False)
    http_status = models.PositiveIntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    error = models.TextField(blank=True)
    response_excerpt = models.CharField(max_length=1000, blank=True)
