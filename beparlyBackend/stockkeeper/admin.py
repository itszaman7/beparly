from django.contrib import admin

from .models import StockLocation


@admin.register(StockLocation)
class StockLocationAdmin(admin.ModelAdmin):
    list_display = ('name', 'business', 'type', 'is_default', 'is_active')
    list_filter = ('type', 'is_default', 'is_active')
    search_fields = ('name', 'business__name')
    readonly_fields = ('business', 'is_default', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj and obj.is_default:
            fields.append('is_active')
        return fields
