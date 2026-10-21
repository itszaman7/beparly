from django.urls import path

from . import views

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('businesses/', views.businesses),
    path('businesses/<int:business_id>/employees/', views.employees),
    path('businesses/<int:business_id>/employees/<int:user_id>/permissions/', views.employee_permissions),
    path('businesses/<int:business_id>/inventory-settings/', views.inventory_settings),
]
