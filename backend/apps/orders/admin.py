from django.contrib import admin

from .models import Order, OrderLine


class OrderLineInline(admin.TabularInline):
    model = OrderLine
    extra = 0
    can_delete = False
    readonly_fields = [field.name for field in OrderLine._meta.fields]


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("number", "status", "contact_name", "company", "total", "pricing_state", "created_at")
    list_filter = ("status", "pricing_state", "delivery_method")
    search_fields = ("number", "contact_name", "contact_phone", "contact_email", "crm_external_id")
    readonly_fields = [field.name for field in Order._meta.fields]
    inlines = [OrderLineInline]

    def has_delete_permission(self, request, obj=None):
        return False
