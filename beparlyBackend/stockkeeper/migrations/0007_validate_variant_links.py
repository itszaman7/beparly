"""PostgreSQL guards for historical parent links and variant stock ownership."""

from django.db import migrations


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
        CREATE FUNCTION beparly_validate_catalog_variant() RETURNS trigger AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM products_productvariant v
                           WHERE v.id = NEW.variant_id AND v.product_id = NEW.product_id) THEN
                RAISE EXCEPTION 'Catalog variant and product must agree';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table in ('products_productunit', 'products_stockbatch'):
        schema_editor.execute(f"CREATE TRIGGER validate_variant_links BEFORE INSERT OR UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION beparly_validate_catalog_variant()")
    schema_editor.execute("""
        CREATE FUNCTION beparly_validate_stock_variant() RETURNS trigger AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM products_productvariant v
                           WHERE v.id = NEW.variant_id AND v.product_id = NEW.product_id
                             AND v.business_id = NEW.business_id) THEN
                RAISE EXCEPTION 'Stock variant, product and business must agree';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM stockkeeper_stocklocation l
                           WHERE l.id = NEW.location_id AND l.business_id = NEW.business_id) THEN
                RAISE EXCEPTION 'Stock location belongs to another business';
            END IF;
            IF NEW.batch_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM products_stockbatch b WHERE b.id = NEW.batch_id
                 AND b.variant_id = NEW.variant_id AND b.product_id = NEW.product_id) THEN
                RAISE EXCEPTION 'Stock batch belongs to another variant';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table in ('stockkeeper_stockbalance', 'stockkeeper_costlayer', 'stockkeeper_stockmovement'):
        schema_editor.execute(f"CREATE TRIGGER validate_variant_links BEFORE INSERT OR UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION beparly_validate_stock_variant()")


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for table in ('stockkeeper_stockbalance', 'stockkeeper_costlayer', 'stockkeeper_stockmovement',
                  'products_productunit', 'products_stockbatch'):
        schema_editor.execute(f'DROP TRIGGER IF EXISTS validate_variant_links ON {table}')
    schema_editor.execute('DROP FUNCTION IF EXISTS beparly_validate_stock_variant()')
    schema_editor.execute('DROP FUNCTION IF EXISTS beparly_validate_catalog_variant()')


class Migration(migrations.Migration):
    dependencies = [
        ('products', '0006_remove_productunit_unique_package_name_per_product_and_more'),
        ('stockkeeper', '0006_remove_stockbalance_unique_simple_stock_balance_and_more'),
    ]
    operations = [migrations.RunPython(install, uninstall)]
