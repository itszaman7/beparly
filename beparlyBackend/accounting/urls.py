from django.urls import path

from . import views
from . import attachments
from .reports import financial_summary
from .report_views import report
from .due_views import due_report, reschedule
from .sale_reports import report_sales

urlpatterns = [
    path('businesses/<int:business_id>/attachments/<str:kind>/<uuid:target_id>/', attachments.collection),
    path('businesses/<int:business_id>/attachments/<str:kind>/<uuid:target_id>/<uuid:attachment_id>/', attachments.download),
    path('businesses/<int:business_id>/reports/financial-summary/', financial_summary),
    path('businesses/<int:business_id>/reports/sales/', report_sales),
    path('businesses/<int:business_id>/reports/<str:kind>-dues/', due_report),
    path('businesses/<int:business_id>/reports/<slug:name>/', report),
    path('businesses/<int:business_id>/dues/<str:kind>/<uuid:document_id>/reschedule/', reschedule),
    path('businesses/<int:business_id>/money/accounts/', views.money_accounts),
    path('businesses/<int:business_id>/money/transactions/', views.money_transactions),
    path('businesses/<int:business_id>/money/expenses/<uuid:transaction_id>/', views.expense_detail),
    path('businesses/<int:business_id>/money/accounts/<str:account_id>/ledger/', views.money_account_ledger),
    path('businesses/<int:business_id>/money/transactions/<uuid:transaction_id>/reverse/', views.reverse_transaction),
    path('businesses/<int:business_id>/money/expense-categories/', views.expense_categories),
    path('businesses/<int:business_id>/money/income-categories/', views.income_categories),
    path('businesses/<int:business_id>/money/income-categories/<int:category_id>/', views.income_category_detail),
    path('businesses/<int:business_id>/contacts/', views.contacts),
    path('businesses/<int:business_id>/contacts/<uuid:contact_id>/', views.contact_detail),
]
