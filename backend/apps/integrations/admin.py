from django.contrib import admin

from .models import IntegrationAttempt, OutboxEvent, SyncRun


@admin.register(SyncRun)
class SyncRunAdmin(admin.ModelAdmin):
    list_display = ("kind", "status", "started_at", "finished_at")
    list_filter = ("kind", "status")
    readonly_fields = [field.name for field in SyncRun._meta.fields]


class AttemptInline(admin.TabularInline):
    model = IntegrationAttempt
    extra = 0
    can_delete = False
    readonly_fields = [field.name for field in IntegrationAttempt._meta.fields]


@admin.register(OutboxEvent)
class OutboxEventAdmin(admin.ModelAdmin):
    list_display = ("topic", "aggregate_id", "status", "attempts", "available_at", "updated_at")
    list_filter = ("topic", "status")
    readonly_fields = [field.name for field in OutboxEvent._meta.fields]
    inlines = [AttemptInline]


admin.site.register(IntegrationAttempt)
