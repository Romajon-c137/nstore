import uuid

from django.db.models import Q
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response

from .models import Order
from .serializers import CheckoutSerializer, OrderSerializer


class CheckoutView(generics.CreateAPIView):
    serializer_class = CheckoutSerializer
    permission_classes = [permissions.AllowAny]
    throttle_scope = "checkout"

    def create(self, request, *args, **kwargs):
        key = request.headers.get("Idempotency-Key")
        if not key or len(key) > 128:
            raise serializers.ValidationError({"Idempotency-Key": "Обязательный заголовок, максимум 128 символов"})
        guest_token = None
        if not request.user.is_authenticated:
            try:
                guest_token = uuid.UUID(request.headers.get("X-Guest-Token", ""))
            except ValueError as exc:
                raise serializers.ValidationError({"X-Guest-Token": "Для гостя нужен UUID"}) from exc
        context = self.get_serializer_context() | {"idempotency_key": key, "guest_token": guest_token}
        serializer = self.get_serializer(data=request.data, context=context)
        serializer.is_valid(raise_exception=True)
        try:
            order = serializer.save()
        except (ValueError, PermissionError) as exc:
            raise serializers.ValidationError(str(exc)) from exc
        output = OrderSerializer(order, context=self.get_serializer_context())
        code = status.HTTP_201_CREATED if context.get("was_created", True) else status.HTTP_200_OK
        return Response(output.data, status=code)


class OrderListView(generics.ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        company_id = self.request.query_params.get("company")
        queryset = Order.objects.filter(buyer=self.request.user)
        if company_id:
            queryset = Order.objects.filter(company_id=company_id, company__memberships__user=self.request.user)
        return queryset.prefetch_related("lines").distinct()


class OrderDetailView(generics.RetrieveAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        return Order.objects.filter(Q(buyer=self.request.user) | Q(company__memberships__user=self.request.user)).prefetch_related("lines").distinct()
