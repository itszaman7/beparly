from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'business', 'actor', 'entity_type', 'action', 'subject')
    list_filter = ('entity_type', 'action')
    search_fields = ('entity_id', 'business__name', 'actor__phone')
    readonly_fields = ('id', 'business', 'actor', 'entity_type', 'entity_id', 'subject', 'product_id',
                       'location_id', 'action', 'changes', 'reference_id', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
