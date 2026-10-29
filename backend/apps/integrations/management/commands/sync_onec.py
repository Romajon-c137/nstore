from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.integrations.models import SyncRun
from apps.integrations.onec import OneCClient
from apps.integrations.onec_sync import OneCSyncService


class Command(BaseCommand):
    help = "Синхронизирует каталог, разрешённые прайсы и остатки из 1С только на чтение"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--catalog", action="store_true")
        parser.add_argument("--prices", action="store_true")
        parser.add_argument("--stock", action="store_true")
        parser.add_argument("--images", action="store_true")

    def handle(self, *args, **options):
        selected = any(options[name] for name in ("catalog", "prices", "stock", "images"))
        run = SyncRun.objects.create(kind="onec_full" if not selected else "onec_partial")
        client = None
        try:
            client = OneCClient()
            service = OneCSyncService(client, dry_run=options["dry_run"])
            counters = {"reference_data": service.reference_data()}
            if options["catalog"] or not selected:
                counters["categories"] = service.categories()
                counters["catalog"] = service.catalog()
            if options["prices"] or not selected:
                counters["prices"] = service.prices()
            if options["stock"] or not selected:
                counters["stock"] = service.stock()
            if options["images"] or not selected:
                counters["images"] = service.images()
            run.status = SyncRun.Status.SUCCEEDED
            run.counters = counters
            self.stdout.write(self.style.SUCCESS(str(counters)))
        except Exception as exc:
            run.status = SyncRun.Status.FAILED
            run.error = str(exc)[:4000]
            raise CommandError(str(exc)) from exc
        finally:
            if client:
                client.close()
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "counters", "error", "finished_at", "updated_at"])
