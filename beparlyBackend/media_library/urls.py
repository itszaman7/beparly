from django.urls import path

from . import views


urlpatterns = [
    path('businesses/<int:business_id>/media/', views.media_collection),
    path('businesses/<int:business_id>/media/delete/', views.media_delete_many),
    path('businesses/<int:business_id>/media/<uuid:asset_id>/', views.media_detail),
    path('businesses/<int:business_id>/media/<uuid:asset_id>/attach/', views.media_attach),
]
