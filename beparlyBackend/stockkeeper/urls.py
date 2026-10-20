from django.urls import path

from . import views

urlpatterns = [
    path('businesses/<int:business_id>/locations/', views.locations),
    path('businesses/<int:business_id>/locations/<int:location_id>/', views.location_detail),
    path('businesses/<int:business_id>/locations/<int:location_id>/set-default/',
         views.SetDefaultLocation.as_view()),
]
