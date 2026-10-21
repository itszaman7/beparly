from django.urls import path

from .views import CategoryDetailView, CategoryView, CatalogView, CatalogSummaryView, ProductDetailView, ProductImageView, ProductUnitsView, ProductUnitDetailView, ProductBatchesView, ProductMovementsView, ProductAttributesView, ProductAttributeDetailView, ProductVariantsView, ProductVariantDetailView, VariantBatchesView, VariantMovementsView

urlpatterns = [
    path('businesses/<int:business_id>/categories/', CategoryView.as_view()),
    path('businesses/<int:business_id>/categories/<uuid:category_id>/', CategoryDetailView.as_view()),
    path('businesses/<int:business_id>/products/', CatalogView.as_view()),
    path('businesses/<int:business_id>/products/summary/', CatalogSummaryView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/', ProductDetailView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/attributes/', ProductAttributesView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/attributes/<uuid:attribute_id>/', ProductAttributeDetailView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/variants/', ProductVariantsView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/variants/<uuid:variant_id>/', ProductVariantDetailView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/variants/<uuid:variant_id>/batches/', VariantBatchesView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/variants/<uuid:variant_id>/movements/', VariantMovementsView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/image/', ProductImageView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/units/', ProductUnitsView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/units/<uuid:unit_id>/', ProductUnitDetailView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/batches/', ProductBatchesView.as_view()),
    path('businesses/<int:business_id>/products/<uuid:product_id>/movements/', ProductMovementsView.as_view()),
]
