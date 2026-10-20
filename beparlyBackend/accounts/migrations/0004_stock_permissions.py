from django.db import migrations, models


def grant_existing_employees(apps, schema_editor):
    BusinessMember = apps.get_model('accounts', 'BusinessMember')
    BusinessMember.objects.using(schema_editor.connection.alias).filter(role='employee').update(
        can_manage_locations=True,
        can_post_stock=True,
    )


class Migration(migrations.Migration):
    dependencies = [('accounts', '0003_businessmember_can_manage_locations')]

    operations = [
        migrations.AddField(
            model_name='businessmember', name='can_post_stock',
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name='businessmember', name='can_manage_locations',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(grant_existing_employees, migrations.RunPython.noop),
    ]
