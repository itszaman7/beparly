import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ('accounting', '0012_expense_reference'),
        ('purchases', '0003_purchase_due_date_alter_purchaseline_id_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='RecordAttachment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=160)),
                ('content_type', models.CharField(max_length=40)),
                ('size', models.PositiveIntegerField()),
                ('sha256', models.CharField(max_length=64)),
                ('file_key', models.CharField(max_length=500)),
                ('command_id', models.UUIDField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('business', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='accounts.business')),
                ('expense', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                              related_name='attachments', to='accounting.moneytransaction')),
                ('purchase', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                               related_name='attachments', to='purchases.purchase')),
                ('uploaded_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(model_name='recordattachment', constraint=models.UniqueConstraint(
            fields=('business', 'command_id'), name='unique_record_attachment_command')),
        migrations.AddConstraint(model_name='recordattachment', constraint=models.CheckConstraint(
            condition=(Q(expense__isnull=False, purchase__isnull=True) |
                       Q(expense__isnull=True, purchase__isnull=False)), name='one_record_attachment_target')),
    ]
