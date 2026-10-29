from django.urls import path

from . import views

urlpatterns = [
    path('auth/login/', views.login),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('auth/profile/', views.account_profile),
    path('auth/profile/image/', views.account_avatar),
    path('businesses/', views.businesses),
    path('businesses/switcher-summary/', views.business_switcher_summary),
    path('businesses/<int:business_id>/dashboard-activity/', views.dashboard_activity),
    path('businesses/<int:business_id>/profile/', views.business_profile),
    path('businesses/<int:business_id>/label-calibration/', views.label_calibration),
    path('businesses/<int:business_id>/logo/', views.business_logo),
    path('businesses/<int:business_id>/employees/', views.employees),
    path('businesses/<int:business_id>/employees/<int:user_id>/permissions/', views.employee_permissions),
    path('businesses/<int:business_id>/inventory-settings/', views.inventory_settings),
]
