from django.urls import path

from .views import AuditListView


urlpatterns = [path('businesses/<int:business_id>/audit/', AuditListView.as_view())]
