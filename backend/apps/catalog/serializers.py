from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Category, Product, ProductMedia, ProductVariant
from .services import availability_state, get_pricing_context, resolve_price, total_sellable_stock


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "parent", "sort_order"]


class MediaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ProductMedia
        fields = ["url", "alt_text", "is_primary"]

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_url(self, obj):
        if obj.image:
            # Keep owned media same-origin. Next.js proxies /media to Django in
            # development and production, so browsers never receive an
            # unusable backend-local host such as http://127.0.0.1:8000.
            return obj.image.url
        return obj.external_url or None


class VariantSerializer(serializers.ModelSerializer):
    price = serializers.SerializerMethodField()
    stock = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    images = MediaSerializer(source="media", many=True)

    class Meta:
        model = ProductVariant
        fields = ["id", "sku", "barcode", "source_name", "unit", "package_label", "package_qty", "min_qty", "qty_step", "price", "stock", "availability", "images"]

    def _stock(self, obj):
        cache = self.context.setdefault("stock_cache", {})
        if obj.pk not in cache:
            cache[obj.pk] = total_sellable_stock(obj)
        return cache[obj.pk]

    @extend_schema_field(serializers.DictField())
    def get_price(self, obj):
        request = self.context["request"]
        company_id = request.query_params.get("company") if request.user.is_authenticated else None
        try:
            if "pricing_context" not in self.context:
                self.context["pricing_context"] = get_pricing_context(request.user, company_id)
            price = resolve_price(obj, context=self.context["pricing_context"])
        except PermissionError as exc:
            raise serializers.ValidationError("Нет доступа к прайсу компании") from exc
        return {"amount": price.amount, "currency": price.currency, "price_list": price.price_list_code}

    @extend_schema_field(serializers.DecimalField(max_digits=18, decimal_places=6, allow_null=True))
    def get_stock(self, obj):
        return self._stock(obj)

    @extend_schema_field(serializers.ChoiceField(choices=["sufficient", "insufficient", "absent", "unknown"]))
    def get_availability(self, obj):
        return availability_state(self._stock(obj))


class ProductListSerializer(serializers.ModelSerializer):
    category = CategorySerializer()
    variants = VariantSerializer(many=True)

    class Meta:
        model = Product
        fields = ["id", "title", "slug", "brand", "category", "variants"]


class ProductDetailSerializer(ProductListSerializer):
    class Meta(ProductListSerializer.Meta):
        fields = ProductListSerializer.Meta.fields + ["description", "seo_title", "seo_description", "attributes", "updated_at"]
