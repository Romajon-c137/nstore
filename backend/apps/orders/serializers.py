from decimal import Decimal

from rest_framework import serializers

from .models import Order, OrderLine
from .services import LineRequest, create_order


class OrderLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderLine
        fields = ["id", "variant", "sku", "title", "unit", "quantity", "unit_price", "line_total", "currency", "available_quantity", "availability", "availability_checked_at"]


class OrderSerializer(serializers.ModelSerializer):
    lines = OrderLineSerializer(many=True)

    class Meta:
        model = Order
        fields = ["id", "number", "company", "status", "pricing_state", "currency", "subtotal", "total", "contact_name", "contact_phone", "contact_email", "delivery_method", "delivery_address", "comment", "crm_external_id", "created_at", "lines"]


class CheckoutLineSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=18, decimal_places=6, min_value=Decimal("0.000001"))


class CheckoutSerializer(serializers.Serializer):
    company_id = serializers.UUIDField(required=False, allow_null=True)
    contact_name = serializers.CharField(max_length=255)
    contact_phone = serializers.CharField(max_length=32)
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    delivery_method = serializers.ChoiceField(choices=["delivery", "pickup"], default="delivery")
    delivery_address = serializers.CharField(max_length=500, required=False, allow_blank=True)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    lines = CheckoutLineSerializer(many=True, allow_empty=False)

    def validate_lines(self, lines):
        if len(lines) > 100:
            raise serializers.ValidationError("В одном заказе допускается не более 100 строк")
        ids = [line["variant_id"] for line in lines]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Один товар нельзя передавать несколькими строками")
        return lines

    def create(self, validated_data):
        request = self.context["request"]
        guest_token = self.context.get("guest_token")
        lines = [LineRequest(item["variant_id"], item["quantity"]) for item in validated_data.pop("lines")]
        order, created = create_order(
            user=request.user,
            guest_token=guest_token,
            idempotency_key=self.context["idempotency_key"],
            company_id=validated_data.pop("company_id", None),
            contact={"name": validated_data.pop("contact_name"), "phone": validated_data.pop("contact_phone"), "email": validated_data.pop("contact_email", "")},
            delivery={"method": validated_data.pop("delivery_method"), "address": validated_data.pop("delivery_address", ""), "comment": validated_data.pop("comment", "")},
            lines=lines,
        )
        self.context["was_created"] = created
        return order
