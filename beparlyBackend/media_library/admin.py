from django.contrib import admin

from .models import MediaAsset


@admin.register(MediaAsset)
class MediaAssetAdmin(admin.ModelAdmin):
    list_display = ('name', 'business', 'size', 'uploaded_by', 'created_at')
    search_fields = ('name', 'key', 'business__name')
    list_filter = ('business',)
    readonly_fields = ('business', 'key', 'name', 'size', 'uploaded_by', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
