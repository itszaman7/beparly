"""Line builders for future sale and purchase posting.

The eventual source service must call these inside its stock/document transaction,
then call accounting.services.post with a validated, unique source ID. These
builders do not create invoices, bills, payments, or journals by themselves.
"""

from .services import AccountingError, amount, cr, dr, ledger


def sale_lines(business, contact, sale_total, paid, actual_inventory_cost, money_account=None, income_category=None):
    total, paid, cost = amount(sale_total), amount(paid, positive=False), amount(actual_inventory_cost, positive=False, places=7)
    if paid > total or (paid and (not money_account or money_account.business_id != business.pk)):
        raise AccountingError('Sale payment needs a valid business money account and cannot exceed the sale.')
    due = total - paid
    if due and (not contact or contact.business_id != business.pk or not contact.is_customer):
        raise AccountingError('A credit sale needs a customer.')
    if (not income_category or income_category.business_id != business.pk
            or income_category.ledger_account.business_id != business.pk or income_category.ledger_account.type != 'income'):
        raise AccountingError('Choose an income category for the sale.')
    lines = []
    if paid:
        lines.append(dr(money_account.ledger_account, paid))
    if due:
        lines.append(dr(ledger(business, 'AR'), due, contact))
    lines.append(cr(income_category.ledger_account, total))
    if cost:
        lines.extend([dr(ledger(business, 'COGS'), cost), cr(ledger(business, 'INVENTORY'), cost)])
    return lines


def purchase_lines(business, contact, inventory_cost, paid, money_account=None):
    cost, paid = amount(inventory_cost, places=7), amount(paid, positive=False)
    if paid > cost or (paid and (not money_account or money_account.business_id != business.pk)):
        raise AccountingError('Purchase payment needs a valid business money account and cannot exceed the cost.')
    due = cost - paid
    if due and (not contact or contact.business_id != business.pk or not contact.is_supplier):
        raise AccountingError('A credit purchase needs a supplier.')
    lines = [dr(ledger(business, 'INVENTORY'), cost)]
    if paid:
        lines.append(cr(money_account.ledger_account, paid))
    if due:
        lines.append(cr(ledger(business, 'AP'), due, contact))
    return lines
