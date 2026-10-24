from django.urls import path
from . import views

urlpatterns = [
    path('businesses/<int:business_id>/suppliers/', views.suppliers),
    path('businesses/<int:business_id>/suppliers/<uuid:supplier_id>/', views.supplier_detail),
    path('businesses/<int:business_id>/suppliers/<uuid:supplier_id>/image/', views.supplier_image),
    path('businesses/<int:business_id>/suppliers/<uuid:supplier_id>/operations/', views.supplier_operations),
    path('businesses/<int:business_id>/purchases/', views.purchases),
    path('businesses/<int:business_id>/purchases/payment-accounts/', views.payment_accounts),
    path('businesses/<int:business_id>/purchases/<uuid:purchase_id>/', views.purchase_detail),
    path('businesses/<int:business_id>/purchases/<uuid:purchase_id>/complete/', views.purchase_complete),
    path('businesses/<int:business_id>/purchases/<uuid:purchase_id>/cancel/', views.purchase_cancel),
]
