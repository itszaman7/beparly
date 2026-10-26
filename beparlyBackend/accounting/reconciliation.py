"""Read-only, source-to-ledger financial diagnostics.

These checks report discrepancies. They never repair or post transactions.
"""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from accounting.models import JournalEntry, JournalLine, MoneyAccount, MoneyTransaction
from purchases.models import OpeningPayable, Purchase, SupplierOperation
from sales.models import Sale, SalePayment, SaleReturn, SaleReturnReceipt, SaleReturnDisposition
from stockkeeper.models import CostLayer, StockBalance, StockMovement


ZERO = Decimal('0')


def _sum(rows, field):
    return rows.aggregate(value=Sum(field))['value'] or ZERO


def _net(lines):
    totals = lines.aggregate(debit=Sum('debit'), credit=Sum('credit'))
    return (totals['debit'] or ZERO) - (totals['credit'] or ZERO)


def reconcile_business(business):
    """Return machine-readable findings for one business, without changing data."""
    findings = []

    def add(category, source, expected, actual, cause, path, remediation, severity='high'):
        expected, actual = Decimal(expected), Decimal(actual)
        if expected == actual:
            return
        findings.append({
            'business_id': business.pk, 'category': category, 'source': str(source),
            'expected': str(expected), 'actual': str(actual),
            'difference': str(actual - expected), 'severity': severity,
            'suspected_root_cause': cause, 'code_path': path,
            'suggested_remediation': remediation,
        })

    entries = JournalEntry.objects.filter(business=business)
    for entry in entries.annotate(total_debit=Sum('lines__debit'), total_credit=Sum('lines__credit')):
        add('journal_integrity', entry.pk, entry.total_debit or ZERO,
            entry.total_credit or ZERO, 'Unbalanced or missing journal line',
            'accounting.services.post', 'Inspect the source and prepare a linked correction journal.', 'critical')
    for line in JournalLine.objects.filter(entry__business=business).select_related('account', 'contact'):
        if line.account.business_id != business.pk or (line.contact_id and line.contact.business_id != business.pk):
            add('journal_integrity', line.pk, 0, 1, 'Cross-business journal reference',
                'accounting.models.JournalLine', 'Investigate tenant isolation and correct under approval.', 'critical')

    # Compare independently stored money transaction direction with the asset ledger.
    inflows = {'opening_balance', 'owner_contribution', 'customer_advance',
               'supplier_advance_refund', 'other_income', 'asset_sale', 'sale_receipt',
               'supplier_payment_refund'}
    outflows = {'owner_drawing', 'supplier_advance', 'customer_advance_refund',
                'expense', 'asset_purchase', 'sale_refund', 'supplier_payment'}
    for account in MoneyAccount.objects.filter(business=business).select_related('ledger_account'):
        expected = ZERO
        for txn in MoneyTransaction.objects.filter(business=business, account=account):
            reversal = txn.kind.endswith('_reversal')
            kind = txn.kind.removesuffix('_reversal') if reversal else txn.kind
            sign = -1 if reversal else 1
            if kind == 'transfer' or kind in outflows:
                expected -= sign * txn.amount
            elif kind in inflows:
                expected += sign * txn.amount
            else:
                add('money_accounts', txn.pk, 0, txn.amount,
                    'Unclassified money transaction kind', 'accounting.services/accounting.views',
                    'Classify this source before relying on the account reconciliation.')
        expected += _sum(MoneyTransaction.objects.filter(business=business,
            destination=account, kind='transfer'), 'amount')
        expected -= _sum(MoneyTransaction.objects.filter(business=business,
            destination=account, kind='transfer_reversal'), 'amount')
        add('money_accounts', account.pk, expected,
            _net(JournalLine.objects.filter(entry__business=business, account=account.ledger_account)),
            'Money transaction history differs from its asset ledger',
            'accounting.services.money_operation', 'Trace each money transaction to its journal.')

    # Per-party controls include legacy AR/AP accounts as well as current party accounts.
    contacts = business.contact_set.select_related('receivable_account', 'payable_account')
    for contact in contacts:
        if contact.receivable_account_id:
            document_due = sum((max(ZERO, sale.total - sale.paid - _sum(sale.returns.all(), 'amount'))
                for sale in Sale.objects.filter(business=business, customer=contact, status='completed')), ZERO)
            actual = _net(JournalLine.objects.filter(entry__business=business,
                account=contact.receivable_account))
            add('customer_accounts', contact.pk, document_due, actual,
                'Sale dues and customer ledger differ; inspect opening dues and returns',
                'sales.services.create_sale/collect_sale/return_sale',
                'Reconcile invoices, receipts, returns and opening balances per customer.')
        if contact.payable_account_id:
            due = sum((p.total - p.paid for p in Purchase.objects.filter(
                business=business, supplier=contact, status='completed')), ZERO)
            due += sum((p.amount - p.paid for p in OpeningPayable.objects.filter(
                business=business, supplier=contact)), ZERO)
            actual = -_net(JournalLine.objects.filter(entry__business=business,
                account=contact.payable_account))
            add('supplier_accounts', contact.pk, due, actual,
                'Purchase/opening payable and supplier ledger differ',
                'purchases.services.complete_purchase/supplier_operation',
                'Trace payable allocations, reversals and opening balances.')

    customer_advance = ZERO
    supplier_advance = ZERO
    for txn in MoneyTransaction.objects.filter(business=business, journal__source_type__in=['money', 'reversal'],
            kind__in=['customer_advance', 'customer_advance_refund',
                      'customer_advance_reversal', 'customer_advance_refund_reversal',
                      'supplier_advance', 'supplier_advance_refund',
                      'supplier_advance_reversal', 'supplier_advance_refund_reversal']):
        sign = -1 if txn.kind.endswith('_reversal') else 1
        if txn.kind.startswith('customer_advance'):
            customer_advance += sign * txn.amount * (-1 if 'refund' in txn.kind else 1)
        else:
            supplier_advance += sign * txn.amount * (-1 if 'refund' in txn.kind else 1)
    for operation in SupplierOperation.objects.filter(business=business,
            kind__in=['advance', 'advance_refund', 'apply_advance', 'allocation_reversal']):
        supplier_advance += operation.amount * (1 if operation.kind in ('advance', 'allocation_reversal') else -1)
    add('customer_advances', 'CUSTOMER_ADVANCE', customer_advance,
        -_net(JournalLine.objects.filter(entry__business=business,
            account__code='CUSTOMER_ADVANCE')), 'Customer advance sources differ from liability control',
        'accounting.services.money_operation', 'Review receipts, refunds and reversals by customer.')
    refund_due = sum((max(ZERO, credit.amount - credit.due_reduction - credit.refund_amount -
        _sum(credit.refund_payments.all(), 'amount')) for credit in SaleReturn.objects.filter(
            sale__business=business).exclude(request_hash='')), ZERO)
    add('customer_refunds', 'CUSTOMER_REFUND', refund_due,
        -_net(JournalLine.objects.filter(entry__business=business, account__code='CUSTOMER_REFUND')),
        'Executed refunds and credit liabilities differ',
        'sales.return_workflow.credit_sale/refund_credited_sale',
        'Trace credit notes, executed refunds and the refund-payable control.')
    add('supplier_advances', 'SUPPLIER_ADVANCE', supplier_advance,
        _net(JournalLine.objects.filter(entry__business=business,
            account__code='SUPPLIER_ADVANCE')), 'Supplier advance sources differ from asset control',
        'purchases.services.supplier_operation/accounting.services.money_operation',
        'Review advances, refunds and allocations by supplier.')

    # Quantity checks are by variant, location and batch to expose misplaced stock.
    balances = defaultdict(lambda: ZERO)
    layers = defaultdict(lambda: ZERO)
    movements = defaultdict(lambda: ZERO)
    for row in StockBalance.objects.filter(business=business):
        balances[(row.variant_id, row.location_id, row.batch_id)] += row.quantity
    valuation = ZERO
    for row in CostLayer.objects.filter(business=business):
        key = row.variant_id, row.location_id, row.batch_id
        layers[key] += row.remaining_quantity
        valuation += row.remaining_quantity * row.unit_cost
    for row in StockMovement.objects.filter(business=business):
        movements[(row.variant_id, row.location_id, row.batch_id)] += row.quantity_change
    for key in balances.keys() | layers.keys() | movements.keys():
        ref = ':'.join(str(piece or 'none') for piece in key)
        add('inventory', ref, balances[key], layers[key],
            'Stock balance and remaining FIFO layers disagree', 'stockkeeper.services.receive/consume',
            'Inspect movement and layer history before any stock correction.', 'critical')
        add('inventory', ref, balances[key], movements[key],
            'Stock balance and append-only movements disagree', 'stockkeeper.services',
            'Review opening backfill and every later stock movement.', 'critical')
    asset = _net(JournalLine.objects.filter(entry__business=business, account__code='INVENTORY'))
    add('inventory_valuation', 'INVENTORY', valuation, asset,
        'FIFO carrying value and Inventory Asset differ', 'stockkeeper.services/accounting.services',
        'Review cutoff, receipts, COGS, returns and write-offs; propose a linked adjustment.', 'critical')

    for sale in Sale.objects.filter(business=business, status='completed'):
        journal = entries.filter(source_type='sale', source_id=str(sale.pk)).first()
        revenue = -_net(JournalLine.objects.filter(entry=journal,
            account=sale.income_category.ledger_account)) if journal else ZERO
        add('sales', sale.pk, sale.total - sale.delivery_fee, revenue,
            'Posted sale revenue differs from document net of delivery', 'sales.services.create_sale',
            'Trace the invoice journal and category mapping.', 'critical')
    for receipt in SaleReturnReceipt.objects.filter(business=business):
        if (receipt.return_line.sale_return.sale.business_id != business.pk or
                receipt.location.business_id != business.pk):
            add('sale_return_receipts', receipt.pk, 0, 1,
                'Physical return references another business',
                'sales.return_workflow.receive_credited_goods',
                'Investigate tenant isolation and prepare an approved correction.', 'critical')
        expected_stock = (receipt.quantity * receipt.return_line.sale_line.conversion_factor
            if receipt.condition == 'sellable' else ZERO)
        actual_stock = receipt.movement.quantity_change if receipt.movement_id else ZERO
        add('sale_return_receipts', receipt.pk, expected_stock, actual_stock,
            'Physical receipt and linked sellable stock movement differ',
            'sales.return_workflow.receive_credited_goods',
            'Inspect the signed receipt, condition and linked movement.', 'critical')
        debit_code = 'INVENTORY' if receipt.condition == 'sellable' else 'INVENTORY_LOSS'
        posted_cost = _net(JournalLine.objects.filter(entry=receipt.journal,
            account__code=debit_code)) if receipt.journal_id else ZERO
        expected_posting = ZERO if receipt.condition == 'inspection' else receipt.inventory_cost
        add('sale_return_receipts', receipt.pk, expected_posting, posted_cost,
            'Physical return FIFO cost and linked journal differ',
            'sales.return_workflow.receive_credited_goods',
            'Inspect original sale FIFO snapshot and prepare a linked correction.', 'critical')
    for decision in SaleReturnDisposition.objects.filter(business=business).select_related(
            'receipt__return_line__sale_line', 'supplier'):
        if (decision.receipt.business_id != business.pk or
                decision.receipt.return_line.sale_return.sale.business_id != business.pk or
                decision.supplier_id and decision.supplier.business_id != business.pk):
            add('sale_return_dispositions', decision.pk, 0, 1,
                'Inspection decision references another business',
                'sales.return_workflow.decide_inspected_goods',
                'Investigate tenant isolation and prepare an approved correction.', 'critical')
        expected_stock = (decision.receipt.quantity *
            decision.receipt.return_line.sale_line.conversion_factor
            if decision.action == 'restocked' else ZERO)
        actual_stock = decision.movement.quantity_change if decision.movement_id else ZERO
        add('sale_return_dispositions', decision.pk, expected_stock, actual_stock,
            'Inspection decision and linked sellable movement differ',
            'sales.return_workflow.decide_inspected_goods',
            'Inspect the custody and restock evidence.', 'critical')
        debit_code = 'INVENTORY' if decision.action == 'restocked' else 'INVENTORY_LOSS'
        posted_cost = _net(JournalLine.objects.filter(entry=decision.journal,
            account__code=debit_code)) if decision.journal_id else ZERO
        expected_cost = (decision.receipt.inventory_cost
            if decision.action != 'returned_to_supplier' else ZERO)
        add('sale_return_dispositions', decision.pk, expected_cost, posted_cost,
            'Inspection decision and linked cost journal differ',
            'sales.return_workflow.decide_inspected_goods',
            'Review original FIFO cost, disposition and journal.', 'critical')
    for purchase in Purchase.objects.filter(business=business, status='completed'):
        journal = entries.filter(source_type='purchase', source_id=str(purchase.pk)).first()
        inventory_debit = _net(JournalLine.objects.filter(entry=journal,
            account__code='INVENTORY')) if journal else ZERO
        add('purchases', purchase.pk, purchase.total, inventory_debit,
            'Purchase document and Inventory Asset debit differ', 'purchases.services.complete_purchase',
            'Trace purchase lines, receipt movements and its journal.', 'critical')
    for movement in StockMovement.objects.filter(business=business, type='waste'):
        journal = entries.filter(source_type='stock_movement', source_id=str(movement.pk)).first()
        loss = _net(JournalLine.objects.filter(entry=journal,
            account__code='INVENTORY_LOSS')) if journal else ZERO
        add('wastage', movement.pk, -movement.inventory_cost, loss,
            'Waste cost differs from inventory loss posting', 'stockkeeper.services.post_waste',
            'Trace the movement, FIFO cost and journal.', 'critical')
    for payment in SalePayment.objects.filter(sale__business=business):
        add('payments', payment.pk, payment.amount,
            _net(JournalLine.objects.filter(entry=payment.journal,
                account=payment.account.ledger_account)) * (1 if payment.kind == 'receipt' else -1),
            'Sale payment amount differs from its money ledger line',
            'sales.services._collect_locked/cancel_sale', 'Inspect payment and linked journal.')
    for operation in SupplierOperation.objects.filter(business=business).exclude(account=None):
        sign = 1 if operation.kind in ('advance_refund', 'payment_refund') else -1
        add('payments', operation.pk, operation.amount,
            _net(JournalLine.objects.filter(entry=operation.journal,
                account=operation.account.ledger_account)) * sign,
            'Supplier money operation differs from its money ledger line',
            'purchases.services.supplier_operation', 'Inspect operation and linked journal.')
    return findings
