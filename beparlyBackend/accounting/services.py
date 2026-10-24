from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from uuid import UUID, uuid4

from django.db import transaction
from django.db.models import Sum

from accounts.models import Business
from stockkeeper.services import business_today

from .models import (AssetDepreciation, BusinessAsset, Contact, Expense, ExpenseCategory, IncomeCategory,
                     InventoryAccountingCutoff, JournalEntry, JournalLine, LedgerAccount,
                     MoneyAccount, MoneyTransaction)


SYSTEM_ACCOUNTS = {
    'OPENING': ('Opening Equity', 'equity'),
    'CAPITAL': ("Owner's Capital", 'equity'),
    'DRAWINGS': ('Owner Drawings', 'equity'),
    'RETAINED': ('Retained Earnings', 'equity'),
    'INVENTORY': ('Inventory Asset', 'asset'),
    'INVENTORY_GAIN': ('Inventory Count Gain', 'income'),
    'INVENTORY_LOSS': ('Inventory Loss', 'expense'),
    'AR': ('Accounts Receivable', 'asset'),
    'AP': ('Accounts Payable', 'liability'),
    'CUSTOMER_ADVANCE': ('Customer Advances', 'liability'),
    'SUPPLIER_ADVANCE': ('Supplier Advances', 'asset'),
    'SALES': ('Sales Revenue', 'income'),
    'DELIVERY_INCOME': ('Delivery Income', 'income'),
    'COGS': ('Cost of Goods Sold', 'expense'),
    'OTHER_INCOME': ('Other Income', 'income'),
    'OPERATING_EXPENSE': ('Operating Expenses', 'expense'),
    'FIXED_ASSET': ('Business Assets', 'asset'),
    'ACCUM_DEPRECIATION': ('Accumulated Depreciation', 'asset'),
    'DEPRECIATION': ('Depreciation Expense', 'expense'),
    'ASSET_GAIN': ('Gain on Asset Sale', 'income'),
    'ASSET_LOSS': ('Loss on Asset Sale', 'expense'),
}


class AccountingError(ValueError):
    pass


def amount(value, *, positive=True, places=2):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise AccountingError('Enter a valid amount.') from None
    if not result.is_finite() or (positive and result <= 0) or (not positive and result < 0):
        raise AccountingError('Enter a positive amount.')
    quantum = Decimal(1).scaleb(-places)
    if result != result.quantize(quantum) or result >= Decimal('100000000000000'):
        raise AccountingError(f'Amount must have at most {places} decimal places.')
    return result


def command_uuid(raw):
    try:
        return UUID(str(raw))
    except (ValueError, TypeError):
        raise AccountingError('Provide a valid command ID.') from None


@transaction.atomic
def setup_business(business):
    Business.objects.select_for_update().get(pk=business.pk)
    for code, (name, kind) in SYSTEM_ACCOUNTS.items():
        LedgerAccount.objects.get_or_create(business=business, code=code,
                                            defaults={'name': name, 'type': kind, 'system_managed': True})
    ledger, _ = LedgerAccount.objects.get_or_create(business=business, code='MONEY-CASH',
        defaults={'name': 'Cash in Shop', 'type': 'asset', 'system_managed': True})
    MoneyAccount.objects.get_or_create(business=business, ledger_account=ledger,
        defaults={'name': 'Cash in Shop', 'kind': 'cash', 'is_default': True})
    if not IncomeCategory.objects.filter(business=business, name__iexact='Miscellaneous income').exists():
        miscellaneous, _ = LedgerAccount.objects.get_or_create(business=business, code='MISC_INCOME',
            defaults={'name': 'Miscellaneous income', 'type': 'income', 'system_managed': True})
        category, created = IncomeCategory.objects.get_or_create(business=business, ledger_account=miscellaneous,
            defaults={'name': 'Miscellaneous income'})
        if created:
            from audit.services import record
            record(business_id=business.pk, actor=None, entity_type='income_category', entity_id=category.pk,
                   action='created', subject=category.name,
                   changes={'name': {'before': None, 'after': category.name},
                            'ledger_account_id': {'before': None, 'after': miscellaneous.pk}})


@transaction.atomic
def create_financial_category(business, actor, name, category_type):
    Business.objects.select_for_update().get(pk=business.pk)
    name = str(name or '').strip()
    if not name or len(name) > 100:
        raise AccountingError('Enter a category name up to 100 characters.')
    if category_type not in ('expense', 'income'):
        raise AccountingError('Choose expense or income category type.')
    model = ExpenseCategory if category_type == 'expense' else IncomeCategory
    if model.objects.filter(business=business, name__iexact=name).exists():
        raise AccountingError('A category with this name already exists.')
    identifier = uuid4()
    code = f'{category_type.upper()}-{identifier.hex[:16]}'
    account = LedgerAccount.objects.create(business=business, code=code, name=name,
        type=category_type, system_managed=False)
    category = model.objects.create(business=business, name=name, ledger_account=account)
    from audit.services import record
    record(business_id=business.pk, actor=actor, entity_type=f'{category_type}_category',
           entity_id=category.pk, action='created', subject=name,
           changes={'name': {'before': None, 'after': name}, 'ledger_account_id': {'before': None, 'after': account.pk}})
    return category


def ledger(business, code):
    account = LedgerAccount.objects.filter(business=business, code=code, is_active=True).first()
    if not account:
        raise AccountingError('Required financial account is unavailable.')
    return account


@transaction.atomic
def ensure_party_accounts(contact):
    """Create stable per-contact control ledgers without removing legacy controls."""
    contact = Contact.objects.select_for_update().get(pk=contact.pk)
    if contact.is_customer and not contact.receivable_account_id:
        account, _ = LedgerAccount.objects.get_or_create(business=contact.business,
            code=f'AR-{contact.pk.hex[:32]}', defaults={'name': f'Accounts Receivable — {contact.name}',
            'type': 'asset', 'system_managed': True})
        contact.receivable_account = account
    if contact.is_supplier and not contact.payable_account_id:
        account, _ = LedgerAccount.objects.get_or_create(business=contact.business,
            code=f'AP-{contact.pk.hex[:32]}', defaults={'name': f'Accounts Payable — {contact.name}',
            'type': 'liability', 'system_managed': True})
        contact.payable_account = account
    contact.save(update_fields=['receivable_account', 'payable_account'])
    return contact


def balance(account):
    totals = JournalLine.objects.filter(account=account).aggregate(debit=Sum('debit'), credit=Sum('credit'))
    return (totals['debit'] or Decimal('0')) - (totals['credit'] or Decimal('0'))


@transaction.atomic
def ensure_inventory_cutoff(business):
    """Reconcile the FIFO snapshot once, before the first financially posted stock write."""
    from stockkeeper.models import CostLayer, StockBalance
    Business.objects.select_for_update().get(pk=business.pk)
    prior = InventoryAccountingCutoff.objects.filter(business=business).first()
    if prior:
        return prior
    setup_business(business)
    balances = {}
    for row in StockBalance.objects.filter(business=business).values('variant_id', 'location_id', 'batch_id', 'quantity'):
        key = row['variant_id'], row['location_id'], row['batch_id']
        balances[key] = balances.get(key, Decimal('0')) + row['quantity']
    layer_quantities = {}
    total_value = Decimal('0')
    for layer in CostLayer.objects.filter(business=business, remaining_quantity__gt=0).values(
            'variant_id', 'location_id', 'batch_id', 'remaining_quantity', 'unit_cost'):
        if layer['unit_cost'] == 0:
            raise AccountingError('Existing stock has zero cost. Review its cost before the accounting cutoff.')
        key = layer['variant_id'], layer['location_id'], layer['batch_id']
        layer_quantities[key] = layer_quantities.get(key, Decimal('0')) + layer['remaining_quantity']
        total_value += layer['remaining_quantity'] * layer['unit_cost']
    if any(value != layer_quantities.get(key, Decimal('0')) for key, value in balances.items()) or any(
            value != balances.get(key, Decimal('0')) for key, value in layer_quantities.items()):
        raise AccountingError('Stock balances and remaining cost layers must reconcile before accounting starts.')
    if any(value > 0 and layer_quantities.get(key, 0) == 0 for key, value in balances.items()):
        raise AccountingError('Stock is missing a reliable cost layer.')
    total_quantity = sum(balances.values(), Decimal('0'))
    journal = None
    if total_value:
        journal = post(business, 'inventory_cutoff', business.pk, 'Opening inventory at FIFO cost',
            [dr(ledger(business, 'INVENTORY'), total_value), cr(ledger(business, 'OPENING'), total_value)])
    return InventoryAccountingCutoff.objects.create(business=business, quantity=total_quantity,
                                                    value=total_value, journal=journal)


def post(business, source_type, source_id, description, lines, *, actor=None, command_id=None,
         event_date=None, reverses=None):
    """Caller holds the business row lock and an atomic transaction."""
    if not transaction.get_connection().in_atomic_block:
        raise AccountingError('Financial posting requires an atomic transaction.')
    prior = JournalEntry.objects.filter(business=business, source_type=source_type, source_id=str(source_id)).first()
    if prior:
        return prior
    if command_id and JournalEntry.objects.filter(business=business, command_id=command_id).exists():
        raise AccountingError('Command ID has already been used for another financial event.')
    if len(lines) < 2:
        raise AccountingError('A financial entry needs at least two lines.')
    debits = credits = Decimal('0')
    for account, debit, credit, contact in lines:
        if account.business_id != business.pk or not account.is_active or (contact and contact.business_id != business.pk):
            raise AccountingError('Financial references belong to another business or are inactive.')
        debit, credit = amount(debit, positive=False, places=7), amount(credit, positive=False, places=7)
        if (debit > 0) == (credit > 0):
            raise AccountingError('Each financial line needs exactly one positive side.')
        debits += debit
        credits += credit
    if debits != credits:
        raise AccountingError('Financial entry is not balanced.')
    entry = JournalEntry.objects.create(business=business, posting_date=business_today(business),
        event_date=event_date or business_today(business), description=description[:240], source_type=source_type,
        source_id=str(source_id), actor=actor, command_id=command_id, reverses=reverses)
    for account, debit, credit, contact in lines:
        JournalLine.objects.create(entry=entry, account=account, debit=debit, credit=credit, contact=contact)
    return entry


def dr(account, value, contact=None):
    return account, value, Decimal('0'), contact


def cr(account, value, contact=None):
    return account, Decimal('0'), value, contact


def reverse(entry, actor, command_id, reason):
    with transaction.atomic():
        Business.objects.select_for_update().get(pk=entry.business_id)
        prior = JournalEntry.objects.filter(reverses=entry).first()
        if prior and prior.command_id == command_id:
            return prior
        if prior:
            raise AccountingError('This transaction was already reversed.')
        lines = [(line.account, line.credit, line.debit, line.contact) for line in entry.lines.select_related('account', 'contact')]
        return post(entry.business, 'reversal', entry.pk, reason, lines, actor=actor,
                    command_id=command_id, reverses=entry)


MONEY_RULES = {
    'owner_contribution': ('in', 'CAPITAL'),
    'customer_advance': ('in', 'CUSTOMER_ADVANCE'),
    'owner_drawing': ('out', 'DRAWINGS'),
    'supplier_advance': ('out', 'SUPPLIER_ADVANCE'),
    'customer_advance_refund': ('out', 'CUSTOMER_ADVANCE'),
    'supplier_advance_refund': ('in', 'SUPPLIER_ADVANCE'),
}


@transaction.atomic
def create_money_account(business, name, kind, reference='', command_id=None):
    Business.objects.select_for_update().get(pk=business.pk)
    if command_id:
        prior = MoneyAccount.objects.filter(business=business, create_command_id=command_id).first()
        if prior:
            if (prior.name, prior.kind, prior.masked_reference) != (name, kind, reference):
                raise AccountingError('Retry this account command with its original details.')
            return prior
    if kind not in dict(MoneyAccount.KINDS):
        raise AccountingError('Choose a valid money account type.')
    if not name or len(name) > 120 or len(reference) > 40:
        raise AccountingError('Enter a money account name and optional masked reference.')
    identifier = uuid4()
    ledger_account = LedgerAccount.objects.create(business=business, code=f'MONEY-{identifier.hex[:16]}',
        name=name, type='asset', system_managed=True)
    return MoneyAccount.objects.create(id=identifier, business=business, ledger_account=ledger_account,
                                       name=name, kind=kind, masked_reference=reference, create_command_id=command_id)


@transaction.atomic
def money_operation(business, actor, command_id, kind, value, account, *, destination=None,
                    contact=None, note='', event_date=None, category=None, income_category=None, allow_opening=False):
    if kind == 'opening_balance' and not allow_opening:
        raise AccountingError('Opening cash can only be set when creating a business.')
    Business.objects.select_for_update().get(pk=business.pk)
    prior = JournalEntry.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if prior.source_type != 'money':
            raise AccountingError('Command ID has already been used.')
        previous = MoneyTransaction.objects.get(journal=prior)
        if (previous.kind, previous.amount, previous.account_id, previous.destination_id,
                previous.contact_id, previous.note) != (kind, amount(value), account.pk,
                destination.pk if destination else None, contact.pk if contact else None, note):
            raise AccountingError('Retry this command with its original details.')
        if kind == 'expense' and (not category or previous.expense.category_id != category.pk):
            raise AccountingError('Retry this expense command with its original category.')
        if kind == 'other_income' and (not income_category or previous.income_category_id != income_category.pk):
            raise AccountingError('Retry this income command with its original category.')
        return previous
    if account.business_id != business.pk or not account.is_active:
        raise AccountingError('Choose an active money account.')
    value = amount(value)
    event_date = event_date or business_today(business)
    if event_date > business_today(business):
        raise AccountingError('Transaction date cannot be in the future.')
    if kind == 'transfer':
        if not destination or destination.business_id != business.pk or not destination.is_active or destination.pk == account.pk:
            raise AccountingError('Choose a different active destination account.')
        lines = [dr(destination.ledger_account, value), cr(account.ledger_account, value)]
    elif kind == 'expense':
        if (not category or category.business_id != business.pk or category.ledger_account.business_id != business.pk
                or category.ledger_account.type != 'expense'):
            raise AccountingError('Choose an expense category.')
        lines = [dr(category.ledger_account, value), cr(account.ledger_account, value)]
    elif kind == 'other_income':
        if (not income_category or income_category.business_id != business.pk
                or income_category.ledger_account.business_id != business.pk or income_category.ledger_account.type != 'income'
                or income_category.name.casefold() == 'sales'):
            raise AccountingError('Choose an income category.')
        lines = [dr(account.ledger_account, value), cr(income_category.ledger_account, value)]
    elif kind == 'opening_balance':
        if MoneyTransaction.objects.filter(account=account, kind='opening_balance').exists():
            raise AccountingError('Opening balance has already been recorded for this account.')
        if JournalLine.objects.filter(account=account.ledger_account).exists():
            raise AccountingError('Set the opening balance before other money movements.')
        lines = [dr(account.ledger_account, value), cr(ledger(business, 'OPENING'), value)]
    elif kind in MONEY_RULES:
        direction, code = MONEY_RULES[kind]
        if kind.startswith('customer_advance') and (not contact or contact.business_id != business.pk or not contact.is_customer or not contact.is_active):
            raise AccountingError('Choose a customer for this advance.')
        if kind.startswith('supplier_advance') and (not contact or contact.business_id != business.pk or not contact.is_supplier or not contact.is_active):
            raise AccountingError('Choose a supplier for this advance.')
        if kind.endswith('_refund') and Decimal(contact_position(contact)[kind.removesuffix('_refund')]) < value:
            raise AccountingError('Refund exceeds the remaining advance.')
        control = ledger(business, code)
        tagged = contact if kind.startswith(('customer_advance', 'supplier_advance')) else None
        lines = [dr(account.ledger_account, value), cr(control, value, tagged)] if direction == 'in' else [dr(control, value, tagged), cr(account.ledger_account, value)]
    else:
        raise AccountingError('Choose a supported money reason.')
    txn_id = uuid4()
    entry = post(business, 'money', txn_id, note or kind.replace('_', ' ').title(), lines,
                 actor=actor, command_id=command_id, event_date=event_date)
    txn = MoneyTransaction.objects.create(id=txn_id, business=business, kind=kind, amount=value,
        account=account, destination=destination, contact=contact, note=note,
        event_date=event_date, journal=entry, income_category=income_category)
    if kind == 'expense':
        Expense.objects.create(business=business, category=category, money_transaction=txn)
    return txn


def contact_position(contact):
    result = {}
    for label, code, sign, field in [('customer_advance', 'CUSTOMER_ADVANCE', -1, None),
                               ('supplier_advance', 'SUPPLIER_ADVANCE', 1, None),
                               ('to_collect', 'AR', 1, 'receivable_account'), ('to_pay', 'AP', -1, 'payable_account')]:
        account = getattr(contact, f'{field}_id', None) if field else None
        if field and not account:
            account = Contact.objects.filter(pk=contact.pk).values_list(f'{field}_id', flat=True).first()
        query = JournalLine.objects.filter(contact=contact, account_id=account) if account else JournalLine.objects.filter(contact=contact, account__code=code)
        sums = query.aggregate(d=Sum('debit'), c=Sum('credit'))
        result[label] = str(((sums['d'] or 0) - (sums['c'] or 0)) * sign)
    return result


def next_month(first):
    return date(first.year + (first.month == 12), first.month % 12 + 1, 1)


def month_offset(first, months):
    index = first.year * 12 + first.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


@transaction.atomic
def purchase_asset(business, actor, command_id, name, cost, residual, months, in_service, account):
    Business.objects.select_for_update().get(pk=business.pk)
    prior = JournalEntry.objects.filter(business=business, command_id=command_id).first()
    if prior:
        if prior.source_type != 'asset_purchase':
            raise AccountingError('Command ID has already been used.')
        previous = BusinessAsset.objects.get(purchase_journal=prior)
        if (previous.name, previous.cost, previous.residual_value, previous.useful_life_months,
                previous.in_service_date) != (name, amount(cost), amount(residual, positive=False), months, in_service):
            raise AccountingError('Retry this asset command with its original details.')
        if previous.purchase_journal.moneytransaction.account_id != account.pk:
            raise AccountingError('Retry this asset command with its original payment account.')
        return previous
    cost, residual = amount(cost), amount(residual, positive=False)
    if residual >= cost or type(months) is not int or not 1 <= months <= 600 or cost - residual < Decimal('0.01') * months:
        raise AccountingError('Choose a valid residual value and useful life.')
    if not name or len(name) > 160 or account.business_id != business.pk or not account.is_active:
        raise AccountingError('Choose an asset name and active payment account.')
    if not in_service or in_service > business_today(business):
        raise AccountingError('Choose an in-service date up to today.')
    asset_id = uuid4()
    entry = post(business, 'asset_purchase', asset_id, f'Purchase {name}',
        [dr(ledger(business, 'FIXED_ASSET'), cost), cr(account.ledger_account, cost)],
        actor=actor, command_id=command_id)
    asset = BusinessAsset.objects.create(id=asset_id, business=business, name=name, cost=cost,
        residual_value=residual, useful_life_months=months, in_service_date=in_service, purchase_journal=entry)
    MoneyTransaction.objects.create(business=business, kind='asset_purchase', amount=cost,
        account=account, event_date=business_today(business), journal=entry, note=f'Purchase {name}')
    return asset


@transaction.atomic
def depreciate(asset, period):
    Business.objects.select_for_update().get(pk=asset.business_id)
    first = next_month(date(asset.in_service_date.year, asset.in_service_date.month, 1))
    if period < first or period > month_offset(first, asset.useful_life_months - 1) or asset.sold_on and period >= asset.sold_on.replace(day=1):
        raise AccountingError('This asset has no depreciation due for that period.')
    prior = AssetDepreciation.objects.filter(asset=asset, period=period).first()
    if prior:
        return prior
    due_months = (period.year - first.year) * 12 + period.month - first.month
    if AssetDepreciation.objects.filter(asset=asset).count() != due_months:
        raise AccountingError('Post earlier depreciation periods first.')
    total = asset.cost - asset.residual_value
    target = (total * (due_months + 1) / asset.useful_life_months).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    already = sum((row.amount for row in AssetDepreciation.objects.filter(asset=asset)), Decimal('0'))
    value = target - already
    if value <= 0:
        raise AccountingError('Depreciation amount is invalid.')
    journal = post(asset.business, 'depreciation', f'{asset.pk}:{period}', f'Depreciation {asset.name}',
        [dr(ledger(asset.business, 'DEPRECIATION'), value), cr(ledger(asset.business, 'ACCUM_DEPRECIATION'), value)],
        event_date=period)
    return AssetDepreciation.objects.create(asset=asset, period=period, amount=value, journal=journal)


@transaction.atomic
def sell_asset(asset, actor, command_id, proceeds, account):
    Business.objects.select_for_update().get(pk=asset.business_id)
    if asset.sale_journal_id:
        if asset.sale_journal.command_id == command_id:
            previous = MoneyTransaction.objects.filter(journal=asset.sale_journal).first()
            if (previous and previous.amount == amount(proceeds, positive=False) and previous.account_id == account.pk) or (
                    not previous and amount(proceeds, positive=False) == 0):
                return asset
            raise AccountingError('Retry this asset sale with its original details.')
        raise AccountingError('This asset was already sold.')
    if account.business_id != asset.business_id or not account.is_active:
        raise AccountingError('Choose an active money account.')
    proceeds = amount(proceeds, positive=False)
    due = next_month(date(asset.in_service_date.year, asset.in_service_date.month, 1))
    last = month_offset(due, asset.useful_life_months - 1)
    current_month = business_today(asset.business).replace(day=1)
    while due < current_month and due <= last:
        depreciate(asset, due)
        due = next_month(due)
    accumulated = sum((item.amount for item in asset.depreciations.all()), Decimal('0'))
    book = asset.cost - accumulated
    lines = [dr(account.ledger_account, proceeds)] if proceeds else []
    if accumulated:
        lines.append(dr(ledger(asset.business, 'ACCUM_DEPRECIATION'), accumulated))
    lines.append(cr(ledger(asset.business, 'FIXED_ASSET'), asset.cost))
    difference = proceeds - book
    if difference > 0:
        lines.append(cr(ledger(asset.business, 'ASSET_GAIN'), difference))
    elif difference < 0:
        lines.append(dr(ledger(asset.business, 'ASSET_LOSS'), -difference))
    if len(lines) < 2:
        raise AccountingError('Asset sale has no financial effect.')
    journal = post(asset.business, 'asset_sale', asset.pk, f'Sale {asset.name}', lines,
                   actor=actor, command_id=command_id)
    if proceeds:
        MoneyTransaction.objects.create(business=asset.business, kind='asset_sale', amount=proceeds,
            account=account, event_date=business_today(asset.business), journal=journal,
            note=f'Sale {asset.name}')
    asset.sale_journal = journal
    asset.sold_on = business_today(asset.business)
    asset.save(update_fields=['sale_journal', 'sold_on'])
    return asset
