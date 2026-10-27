import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [('accounts', '0011_business_document_paper'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [migrations.CreateModel(name='MediaAsset', fields=[
        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ('key', models.CharField(max_length=500, unique=True)),
        ('name', models.CharField(max_length=255)),
        ('size', models.PositiveBigIntegerField(default=0)),
        ('upload_command_id', models.UUIDField(blank=True, null=True)),
        ('created_at', models.DateTimeField(auto_now_add=True)),
        ('business', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='media_assets', to='accounts.business')),
        ('uploaded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
    ], options={'ordering': ['-created_at', '-id']}),
        migrations.AddConstraint(model_name='mediaasset', constraint=models.UniqueConstraint(fields=('business', 'upload_command_id'), name='unique_media_upload_command'))]
