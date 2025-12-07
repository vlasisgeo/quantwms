from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_section_is_refrigerated"),
    ]

    operations = [
        # Drop the legacy table if it exists. This operation is intentionally
        # irreversible (we don't recreate the old model/table here).
        migrations.RunSQL(
            sql="DROP TABLE IF EXISTS core_warehouseuser;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
