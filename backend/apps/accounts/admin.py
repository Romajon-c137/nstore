from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Address, Company, CompanyMembership, User


@admin.register(User)
class NstoreUserAdmin(UserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "phone", "is_staff", "is_active")
    search_fields = ("email", "phone", "first_name", "last_name")
    fieldsets = ((None, {"fields": ("email", "password")}), ("Контакты", {"fields": ("first_name", "last_name", "phone", "external_ref")}), ("Права", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}), ("Даты", {"fields": ("last_login", "date_joined")}))
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2", "is_staff", "is_active")}),)


class MembershipInline(admin.TabularInline):
    model = CompanyMembership
    extra = 0


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "bin", "is_active", "updated_at")
    search_fields = ("name", "bin", "external_ref")
    inlines = [MembershipInline]


admin.site.register(Address)
