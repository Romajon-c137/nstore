from django.contrib import admin

from .models import Category, CompanyPriceList, Price, PriceList, Product, ProductMedia, ProductVariant, StockProjection, Warehouse


class VariantInline(admin.TabularInline):
    model = ProductVariant
    extra = 0
    fields = ("sku", "source_name", "unit", "min_qty", "qty_step", "is_active")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("title", "brand", "category", "status", "updated_at")
    list_filter = ("status", "category", "brand")
    search_fields = ("title", "variants__sku", "variants__barcode")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [VariantInline]


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = ("sku", "source_name", "product", "unit", "is_active")
    list_filter = ("is_active", "unit")
    search_fields = ("sku", "barcode", "source_name", "source_ref")
    readonly_fields = ("source_ref", "raw_source")


admin.site.register(Category)
admin.site.register(ProductMedia)
admin.site.register(PriceList)
admin.site.register(CompanyPriceList)
admin.site.register(Price)
admin.site.register(Warehouse)
admin.site.register(StockProjection)
