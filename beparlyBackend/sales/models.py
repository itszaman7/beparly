import uuid
from django.utils import timezone

from django.db import models
from django.db.models import Q


class Sale(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='sales')
    invoice_number = models.CharField(max_length=40)
    customer = models.ForeignKey('accounting.Contact', null=True, blank=True, on_delete=models.PROTECT)
    customer_name_snapshot = models.CharField(max_length=160, blank=True)
    customer_phone_snapshot = models.CharField(max_length=20, blank=True)
    customer_address_snapshot = models.JSONField(default=dict, blank=True)
    location = models.ForeignKey('stockkeeper.StockLocation', on_delete=models.PROTECT)
    income_category = models.ForeignKey('accounting.IncomeCategory', on_delete=models.PROTECT)
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    command_id = models.UUIDField()
    quotation = models.OneToOneField('Quotation', null=True, blank=True, on_delete=models.PROTECT, related_name='completed_sale')
    mode = models.CharField(max_length=12, choices=[('quick', 'Quick sale'), ('manual', 'Manual sale')])
    price_tier = models.CharField(max_length=12, choices=[('retail', 'Retail'), ('wholesale', 'Wholesale')])
    status = models.CharField(max_length=12, default='completed')
    cancellation_reason = models.CharField(max_length=240, blank=True)
    cancellation_command_id = models.UUIDField(null=True, blank=True)
    payment_status = models.CharField(max_length=12, default='paid')
    subtotal = models.DecimalField(max_digits=18, decimal_places=2)
    discount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    delivery_fee = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=18, decimal_places=2)
    paid = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    billing_address = models.JSONField(default=dict, blank=True)
    delivery_address = models.JSONField(default=dict, blank=True)
    source = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    invoice_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'command_id'], name='unique_sale_command'),
            models.UniqueConstraint(fields=['business', 'invoice_number'], name='unique_sale_invoice'),
            models.UniqueConstraint(fields=['business', 'cancellation_command_id'], condition=Q(cancellation_command_id__isnull=False), name='unique_sale_cancellation_command'),
            models.CheckConstraint(condition=Q(subtotal__gte=0) & Q(discount__gte=0) & Q(delivery_fee__gte=0) & Q(total__gte=0) & Q(paid__gte=0), name='sale_amounts_nonnegative'),
        ]


class SaleLine(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='lines')
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT)
    batch = models.ForeignKey('products.StockBatch', null=True, blank=True, on_delete=models.PROTECT)
    product_name = models.CharField(max_length=180)
    variant_name = models.CharField(max_length=180, blank=True)
    image_url_snapshot = models.CharField(max_length=500, blank=True)
    sku = models.CharField(max_length=64)
    unit_name = models.CharField(max_length=40)
    conversion_factor = models.DecimalField(max_digits=18, decimal_places=3)
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    base_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    line_total = models.DecimalField(max_digits=18, decimal_places=2)
    inventory_cost = models.DecimalField(max_digits=22, decimal_places=7)
    cost_layers = models.JSONField(default=list)


class SalePayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='payments')
    command_id = models.UUIDField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    account = models.ForeignKey('accounting.MoneyAccount', on_delete=models.PROTECT)
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    kind = models.CharField(max_length=12, default='receipt')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['sale', 'command_id'], name='unique_sale_payment_command')]


class SaleReturn(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='returns')
    command_id = models.UUIDField()
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    reason = models.CharField(max_length=240)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    due_reduction = models.DecimalField(max_digits=18, decimal_places=2)
    refund_amount = models.DecimalField(max_digits=18, decimal_places=2)
    refund_account = models.ForeignKey('accounting.MoneyAccount', null=True, blank=True, on_delete=models.PROTECT)
    journal = models.OneToOneField('accounting.JournalEntry', on_delete=models.PROTECT)
    refund_journal = models.OneToOneField('accounting.JournalEntry', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['sale', 'command_id'], name='unique_sale_return_command'),
            models.CheckConstraint(condition=Q(amount__gt=0) & Q(due_reduction__gte=0) & Q(refund_amount__gte=0), name='sale_return_amounts_valid'),
        ]


class SaleReturnLine(models.Model):
    sale_return = models.ForeignKey(SaleReturn, on_delete=models.PROTECT, related_name='lines')
    sale_line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name='return_lines')
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    inventory_cost = models.DecimalField(max_digits=22, decimal_places=7)
    condition = models.CharField(max_length=12, choices=[('sellable', 'Sellable'), ('damaged', 'Damaged')])

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['sale_return', 'sale_line'], name='unique_sale_return_line'),
            models.CheckConstraint(condition=Q(quantity__gt=0) & Q(amount__gt=0) & Q(inventory_cost__gte=0), name='sale_return_line_amounts_valid'),
        ]


class SaleSequence(models.Model):
    business = models.OneToOneField('accounts.Business', primary_key=True, on_delete=models.PROTECT)
    value = models.PositiveBigIntegerField(default=0)


class QuotationSequence(models.Model):
    business = models.OneToOneField('accounts.Business', primary_key=True, on_delete=models.PROTECT)
    value = models.PositiveBigIntegerField(default=0)


class Quotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT, related_name='quotations')
    actor = models.ForeignKey('accounts.User', on_delete=models.PROTECT)
    customer = models.ForeignKey('accounting.Contact', null=True, blank=True, on_delete=models.PROTECT)
    customer_name = models.CharField(max_length=160, blank=True)
    customer_phone = models.CharField(max_length=30, blank=True)
    customer_address = models.CharField(max_length=500, blank=True)
    location = models.ForeignKey('stockkeeper.StockLocation', on_delete=models.PROTECT)
    price_tier = models.CharField(max_length=12, choices=[('retail', 'Retail'), ('wholesale', 'Wholesale')], default='retail')
    number = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=12, default='draft', choices=[(s, s.title()) for s in ('draft', 'pending', 'accepted', 'rejected', 'cancelled')])
    version = models.PositiveIntegerField(default=1)
    valid_until = models.DateField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    delivery_address = models.CharField(max_length=500, blank=True)
    notes = models.TextField(blank=True)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    delivery_fee = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    source_quotation = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'number'], condition=~Q(number=''), name='unique_quotation_number')]


class QuotationLine(models.Model):
    quotation = models.ForeignKey(Quotation, on_delete=models.PROTECT, related_name='lines')
    product = models.ForeignKey('products.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('products.ProductVariant', on_delete=models.PROTECT)
    unit = models.ForeignKey('products.ProductUnit', null=True, blank=True, on_delete=models.PROTECT)
    product_name = models.CharField(max_length=180)
    variant_name = models.CharField(max_length=180, blank=True)
    image_url_snapshot = models.CharField(max_length=500, blank=True, default='')
    sku = models.CharField(max_length=64)
    unit_name = models.CharField(max_length=40)
    conversion_factor = models.DecimalField(max_digits=18, decimal_places=3)
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    base_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    line_total = models.DecimalField(max_digits=18, decimal_places=2)


class QuotationCommand(models.Model):
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    command_id = models.UUIDField()
    quotation = models.ForeignKey(Quotation, on_delete=models.PROTECT)
    action = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['business', 'command_id'], name='unique_quotation_command')]


class QuotationSaleDraft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.OneToOneField(Quotation, on_delete=models.PROTECT, related_name='sale_draft')
    business = models.ForeignKey('accounts.Business', on_delete=models.PROTECT)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
