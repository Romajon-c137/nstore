import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.common.models import UUIDTimeStampedModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Email обязателен")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, blank=True)
    external_ref = models.CharField(max_length=100, blank=True, db_index=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
    objects = UserManager()

    def __str__(self):
        return self.email


class Company(UUIDTimeStampedModel):
    name = models.CharField(max_length=255)
    bin = models.CharField("БИН", max_length=32, blank=True, db_index=True)
    external_ref = models.CharField(max_length=100, blank=True, db_index=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class CompanyMembership(UUIDTimeStampedModel):
    class Role(models.TextChoices):
        OWNER = "owner", "Владелец"
        BUYER = "buyer", "Закупщик"
        VIEWER = "viewer", "Просмотр"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="company_memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.BUYER)
    can_order = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company", "user"], name="unique_company_member")]


class Address(UUIDTimeStampedModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="addresses")
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="addresses", null=True, blank=True)
    label = models.CharField(max_length=100)
    city = models.CharField(max_length=100, blank=True)
    line = models.CharField(max_length=500)
    comment = models.CharField(max_length=500, blank=True)
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.label}: {self.line}"
