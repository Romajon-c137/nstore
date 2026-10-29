from django.contrib.auth import authenticate
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Address, Company, CompanyMembership, User


class EmptySerializer(serializers.Serializer):
    pass


class CsrfSerializer(serializers.Serializer):
    csrf_token = serializers.CharField(read_only=True)


class CompanySerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    can_order = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = ["id", "name", "bin", "role", "can_order"]

    def _membership(self, obj):
        return next((m for m in obj.memberships.all() if m.user_id == self.context["request"].user.id), None)

    @extend_schema_field(serializers.ChoiceField(choices=["owner", "buyer", "viewer"], allow_null=True))
    def get_role(self, obj):
        membership = self._membership(obj)
        return membership.role if membership else None

    @extend_schema_field(serializers.BooleanField())
    def get_can_order(self, obj):
        membership = self._membership(obj)
        return bool(membership and membership.can_order)


class UserSerializer(serializers.ModelSerializer):
    companies = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "phone", "companies"]

    @extend_schema_field(CompanySerializer(many=True))
    def get_companies(self, obj):
        companies = Company.objects.filter(memberships__user=obj).prefetch_related("memberships")
        return CompanySerializer(companies, many=True, context=self.context).data


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["email", "password", "first_name", "last_name", "phone"]

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(request=self.context.get("request"), email=attrs["email"], password=attrs["password"])
        if not user or not user.is_active:
            raise serializers.ValidationError("Неверный email или пароль")
        attrs["user"] = user
        return attrs


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = ["id", "company", "label", "city", "line", "comment", "is_default"]

    def validate_company(self, company):
        user = self.context["request"].user
        if company and not CompanyMembership.objects.filter(company=company, user=user).exists():
            raise serializers.ValidationError("Нет доступа к компании")
        return company
