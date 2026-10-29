from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Category, Product, ProductMedia, ProductVariant
from .serializers import CategorySerializer, ProductDetailSerializer, ProductListSerializer


TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def storefront_slug(value):
    transliterated = "".join(TRANSLIT.get(char, char) for char in (value or "").lower())
    result = []
    separator = False
    for char in transliterated:
        if char.isascii() and char.isalnum():
            result.append(char)
            separator = False
        elif result and not separator:
            result.append("-")
            separator = True
    return "".join(result).strip("-")[:80]


def variant_storefront_slug(variant):
    name = storefront_slug(variant.source_name or variant.product.title)
    sku = storefront_slug(variant.sku)
    return f"{name}-{sku}" if sku else name


def sellable_variants():
    return ProductVariant.objects.filter(is_active=True).annotate(
        sellable_quantity=Sum("stocks__quantity", filter=Q(stocks__warehouse__is_sellable=True))
    ).filter(sellable_quantity__gt=0)


def product_queryset():
    variants = sellable_variants().prefetch_related(
        Prefetch("media", queryset=ProductMedia.objects.order_by("sort_order")), "prices", "stocks__warehouse"
    )
    return Product.objects.filter(status=Product.Status.PUBLISHED, variants__in=sellable_variants()).distinct().select_related("category").prefetch_related(
        Prefetch("variants", queryset=variants)
    )


class CategoryListView(generics.ListAPIView):
    serializer_class = CategorySerializer
    pagination_class = None
    queryset = Category.objects.filter(is_active=True).select_related("parent")


class ProductListView(generics.ListAPIView):
    serializer_class = ProductListSerializer
    filterset_fields = {"category__slug": ["exact"], "brand": ["exact", "in"], "variants__sku": ["exact"]}
    search_fields = ["title", "brand", "variants__sku", "variants__barcode"]
    ordering_fields = ["title", "created_at", "updated_at"]
    ordering = ["title"]

    def get_queryset(self):
        return product_queryset().distinct()


class ProductLookupView(APIView):
    """Resolve the stable storefront slug without downloading the full catalog."""

    def get(self, request):
        slug = request.query_params.get("slug", "").strip()
        if not slug:
            raise ValidationError({"slug": "Укажите slug товара"})

        candidates = sellable_variants().filter(product__status=Product.Status.PUBLISHED).select_related("product").only(
            "id", "sku", "source_name", "product__id", "product__title"
        )
        variant = next((item for item in candidates.iterator(chunk_size=500) if variant_storefront_slug(item) == slug), None)
        if variant is None:
            try:
                variant = sellable_variants().select_related("product").get(pk=slug, product__status=Product.Status.PUBLISHED)
            except (ProductVariant.DoesNotExist, DjangoValidationError, ValueError) as exc:
                raise NotFound("Товар не найден") from exc

        product = get_object_or_404(product_queryset(), pk=variant.product_id)
        return Response(ProductDetailSerializer(product, context={"request": request}).data)


class ProductDetailView(generics.RetrieveAPIView):
    serializer_class = ProductDetailSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return product_queryset()
