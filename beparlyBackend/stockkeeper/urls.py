from django.urls import path

from . import views

urlpatterns = [
    path('businesses/<int:business_id>/locations/', views.locations),
    path('businesses/<int:business_id>/locations/<int:location_id>/', views.location_detail),
    path('businesses/<int:business_id>/locations/<int:location_id>/set-default/',
         views.SetDefaultLocation.as_view()),
    path('businesses/<int:business_id>/stock/receipts/', views.ManualReceipt.as_view()),
    path('businesses/<int:business_id>/locations/<int:location_id>/stock/', views.LocationInventory.as_view()),
    path('businesses/<int:business_id>/locations/<int:location_id>/overview/', views.LocationOverview.as_view()),
    path('businesses/<int:business_id>/locations/<int:location_id>/movements/', views.LocationMovements.as_view()),
    path('businesses/<int:business_id>/stock/waste/', views.WasteCommand.as_view()),
    path('businesses/<int:business_id>/stock/adjustments/', views.AdjustmentCommand.as_view()),
    path('businesses/<int:business_id>/stock/transfers/', views.TransferCommand.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/fefo/', views.FefoRecommendation.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/convert-tracking/', views.TrackingConversion.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/batch-selection/', views.BatchSelection.as_view()),
]
