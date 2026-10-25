from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounting', '0011_duedatechange')]

    operations = [
        migrations.AddField(
            model_name='expense', name='reference',
            field=models.CharField(blank=True, max_length=80),
        ),
    ]
