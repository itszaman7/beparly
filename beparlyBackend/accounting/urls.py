from django.urls import path

from . import views

urlpatterns = [
    path('businesses/<int:business_id>/money/accounts/', views.money_accounts),
    path('businesses/<int:business_id>/money/transactions/', views.money_transactions),
    path('businesses/<int:business_id>/money/accounts/<str:account_id>/ledger/', views.money_account_ledger),
    path('businesses/<int:business_id>/money/transactions/<uuid:transaction_id>/reverse/', views.reverse_transaction),
    path('businesses/<int:business_id>/money/expense-categories/', views.expense_categories),
    path('businesses/<int:business_id>/money/income-categories/', views.income_categories),
    path('businesses/<int:business_id>/contacts/', views.contacts),
    path('businesses/<int:business_id>/contacts/<uuid:contact_id>/', views.contact_detail),
]
