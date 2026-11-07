# Изображения товаров на production

Эта инструкция описывает текущую схему загрузки изображений для
`nstore.glasscenter.kg`, повторный импорт старых фотографий и подключение новых
фотографий непосредственно из 1С.

> Никогда не добавляйте URL с приватными параметрами, пароли, API-ключи и
> service-role ключи в Git. Передавайте секреты через systemd credentials,
> секреты CI/CD или production-файл `.env` с ограниченными правами.

## Что уже работает

Старые изображения импортируются из legacy-каталога Supabase и сопоставляются с
вариантами товаров по артикулу `SKU`. Команда:

- не создаёт товары;
- меняет только изображения существующих товаров;
- постранично загружает весь каталог, а не только первые 1000 строк;
- пропускает уже сохранённые файлы;
- ограничивает исходный файл размером 20 МБ;
- уменьшает изображение до `ONEC_IMAGE_MAX_SIDE`;
- конвертирует результат в WebP;
- сохраняет файл через Django Storage.

На production используется локальный Django Storage:

```text
/var/lib/nstore/media/products/legacy/
```

Apache публикует его по адресу `/media/` и устанавливает заголовок:

```text
Cache-Control: public, max-age=31536000, immutable
```

Результат последнего полного импорта:

- найдено и сопоставлено по SKU: 798 изображений;
- импортировано: 798;
- ошибок: 0;
- опубликованных товаров: 242;
- опубликованных товаров с изображением: 227;
- опубликованных товаров без изображения в legacy-источнике: 15.

## Повторный импорт на текущем production

На сервере настроен одноразовый systemd-сервис:

```bash
sudo systemctl start nstore-legacy-images-import.service
sudo journalctl -u nstore-legacy-images-import.service -f
```

После успешного повторного запуска в журнале ожидается:

```text
Источник: 798 фото; совпало по SKU: 798
Готово: импортировано 0, уже было 798, ошибок 0
```

Повторный запуск безопасен: существующие записи и файлы не скачиваются заново.
Импорт из legacy-каталога запускается вручную и не входит в часовую синхронизацию
1С.

Anon-key legacy Supabase хранится зашифрованным:

```text
/etc/credstore.encrypted/nstore-legacy-supabase-key
```

Сервис получает ключ через `LoadCredentialEncrypted`. Нельзя копировать его в
unit-файл, репозиторий или командную строку.

## Запуск через Docker Compose

Для другого окружения передайте реквизиты через секреты или `.env` и выполните:

```bash
docker compose run --rm web python manage.py import_legacy_images \
  --url "$LEGACY_SUPABASE_URL" \
  --key "$LEGACY_SUPABASE_KEY" \
  --workers 8
```

Перед реальным импортом можно проверить источник и совпадение SKU:

```bash
docker compose run --rm web python manage.py import_legacy_images \
  --url "$LEGACY_SUPABASE_URL" \
  --key "$LEGACY_SUPABASE_KEY" \
  --dry-run
```

Для тестового импорта небольшого количества файлов используется `--limit`:

```bash
docker compose run --rm web python manage.py import_legacy_images \
  --url "$LEGACY_SUPABASE_URL" \
  --key "$LEGACY_SUPABASE_KEY" \
  --workers 2 \
  --limit 10
```

## Проверка production

Количество записей в БД:

```bash
sudo -u postgres psql -d nstore -Atc \
  "select count(*) from catalog_productmedia;"
```

Количество WebP-файлов:

```bash
find /var/lib/nstore/media/products/legacy \
  -type f -name '*.webp' | wc -l
```

Количество опубликованных товаров с изображением:

```bash
sudo -u postgres psql -d nstore -Atc "
select
  count(*) filter (where status = 'published') as published,
  count(*) filter (
    where status = 'published'
      and exists (
        select 1
        from catalog_productvariant v
        join catalog_productmedia m on m.variant_id = v.id
        where v.product_id = catalog_product.id
      )
  ) as published_with_image
from catalog_product;"
```

Проверка конкретного файла:

```bash
curl -I \
  https://nstore.glasscenter.kg/media/products/legacy/example.webp
```

Ожидаются:

```text
HTTP/1.1 200 OK
Content-Type: image/webp
Cache-Control: public, max-age=31536000, immutable
```

Если Apache возвращает `403`, проверьте право прохода к media-каталогу:

```bash
namei -l /var/lib/nstore/media/products/legacy/example.webp
```

Каталог `/var/lib/nstore/media` должен быть доступен Apache на чтение и проход,
а просмотр списка файлов должен оставаться выключенным через `Options -Indexes`.

## Новые фотографии из 1С

Стандартный OData 1С отдаёт метаданные присоединённых файлов, но в текущей базе
не отдаёт их двоичное содержимое. Поэтому наличие вложения в
`НоменклатураПрисоединенныеФайлы` само по себе недостаточно.

В 1С необходимо опубликовать read-only HTTP-сервис:

```text
GET /UN_JJCO/hs/nstore-media/file/{file_ref}
```

Сервис должен:

1. Принимать идентификатор `file_ref`.
2. Находить запись `НоменклатураПрисоединенныеФайлы`.
3. Читать двоичные данные из хранилища 1С.
4. Возвращать исходные байты файла.
5. Устанавливать правильный `Content-Type`.
6. Работать только на чтение и требовать Basic Auth.
7. Возвращать `404`, если файл не найден.

После публикации задайте в `/etc/nstore/backend.env`:

```env
ONEC_MEDIA_URL_TEMPLATE=https://unf.nstore.keenetic.pro/UN_JJCO/hs/nstore-media/file/{file_ref}
```

Перезапустите процессы, читающие настройки:

```bash
sudo systemctl restart nstore-backend.service
sudo systemctl restart nstore-worker.service nstore-beat.service
```

Первичную синхронизацию можно выполнить существующим полным импортом:

```bash
sudo systemctl start nstore-onec-import.service
sudo journalctl -u nstore-onec-import.service -f
```

После этого часовая задача каталога вызывает
`sync_onec --catalog --prices --images`, поэтому новые доступные вложения будут
проверяться примерно раз в час.
Сейчас `ONEC_MEDIA_URL_TEMPLATE` не настроен, поэтому новые фотографии из 1С
автоматически не появляются.

## Хранение и резервное копирование

Пока используется `MEDIA_STORAGE=filesystem`, каталог `/var/lib/nstore/media`
является постоянными production-данными. Его нужно включить в резервное
копирование и нельзя очищать при деплое.

При Docker-развёртывании нельзя выполнять `docker compose down -v`, если media
хранится в volume. Для нескольких серверов и независимого от сервера хранения
следует перейти на S3-совместимый бакет с CDN.
