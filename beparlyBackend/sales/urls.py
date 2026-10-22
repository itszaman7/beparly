from django.urls import path

from . import views

urlpatterns = [
    path('businesses/<int:business_id>/sales/options/', views.sales_options),
    path('businesses/<int:business_id>/sales/customers/', views.sales_customers),
    path('businesses/<int:business_id>/sales/', views.sales),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/payments/', views.sale_detail),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/cancel/', views.sale_cancel),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/documents/<str:kind>/', views.sale_document),
]
