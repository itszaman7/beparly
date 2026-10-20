from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AuthSession, Business, BusinessMember, User


@admin.register(User)
class AccountAdmin(UserAdmin):
    list_display = ('phone', 'first_name', 'is_active', 'is_staff')
    search_fields = ('phone', 'first_name')
    ordering = ('phone',)
    fieldsets = (
        (None, {'fields': ('phone', 'password')}),
        ('Personal information', {'fields': ('first_name', 'last_name', 'email')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'fields': ('phone', 'first_name', 'password1', 'password2')}),
    )


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)


@admin.register(BusinessMember)
class BusinessMemberAdmin(admin.ModelAdmin):
    list_display = ('business', 'user', 'role', 'can_manage_locations', 'created_at')
    list_filter = ('role',)
    search_fields = ('business__name', 'user__phone')


@admin.register(AuthSession)
class AuthSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'revoked_at')
    readonly_fields = ('user', 'token_hash', 'created_at', 'expires_at', 'revoked_at')
    search_fields = ('user__phone',)

    def has_add_permission(self, request):
        return False
