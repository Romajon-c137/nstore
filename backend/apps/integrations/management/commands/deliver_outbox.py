from django.core.management.base import BaseCommand

from apps.integrations.tasks import deliver_pending_outbox


class Command(BaseCommand):
    help = "Синхронно доставляет доступные outbox-события; полезно для восстановления"

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=50)

    def handle(self, *args, **options):
        count = deliver_pending_outbox.run(batch_size=options["batch_size"])
        self.stdout.write(self.style.SUCCESS(f"Обработано: {count}"))
