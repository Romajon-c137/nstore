from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="productmedia",
            name="source_ref",
            field=models.CharField(blank=True, max_length=100, null=True, unique=True),
        ),
    ]
