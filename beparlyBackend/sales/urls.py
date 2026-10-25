from django.urls import path

from . import views, quotation_views

urlpatterns = [
    path('businesses/<int:business_id>/quotations/', quotation_views.quotations),
    path('businesses/<int:business_id>/quotations/<uuid:quote_id>/', quotation_views.quotation_detail),
    path('businesses/<int:business_id>/quotations/<uuid:quote_id>/<str:action>/', quotation_views.quotation_action),
    path('businesses/<int:business_id>/quotations/<uuid:quote_id>/documents/<str:size>/', quotation_views.quotation_document),
    path('businesses/<int:business_id>/quotation-sale-drafts/<uuid:draft_id>/', quotation_views.quotation_checkout),
    path('businesses/<int:business_id>/sales/options/', views.sales_options),
    path('businesses/<int:business_id>/sales/hub-summary/', views.sales_hub_summary),
    path('businesses/<int:business_id>/sales/customers/', views.sales_customers),
    path('businesses/<int:business_id>/sales/', views.sales),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/payments/', views.sale_detail),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/cancel/', views.sale_cancel),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/returns/', views.sale_returns),
    path('businesses/<int:business_id>/sales/<uuid:sale_id>/documents/<str:kind>/', views.sale_document),
]
