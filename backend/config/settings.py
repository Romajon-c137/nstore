from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    return env(name, str(default)).lower() in {"1", "true", "yes", "on"}


SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-development-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = [x.strip() for x in env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",") if x.strip()]
CSRF_TRUSTED_ORIGINS = [x.strip() for x in env("DJANGO_CSRF_TRUSTED_ORIGINS").split(",") if x.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "apps.common",
    "apps.accounts",
    "apps.catalog",
    "apps.orders",
    "apps.integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

if env("POSTGRES_HOST"):
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "nstore"),
        "USER": env("POSTGRES_USER", "nstore"),
        "PASSWORD": env("POSTGRES_PASSWORD"),
        "HOST": env("POSTGRES_HOST", "postgres"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": int(env("POSTGRES_CONN_MAX_AGE", "60")),
        "OPTIONS": {"connect_timeout": 5},
    }}
else:
    # Local zero-dependency fallback only. CI and production use PostgreSQL.
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru"
TIME_ZONE = "Asia/Almaty"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
if env("MEDIA_STORAGE", "filesystem").lower() == "s3":
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("S3_MEDIA_BUCKET"),
            "access_key": env("S3_ACCESS_KEY_ID"),
            "secret_key": env("S3_SECRET_ACCESS_KEY"),
            "endpoint_url": env("S3_ENDPOINT_URL") or None,
            "region_name": env("S3_REGION", "us-east-1"),
            "custom_domain": env("S3_MEDIA_DOMAIN") or None,
            "default_acl": None,
            "file_overwrite": False,
            "querystring_auth": env_bool("S3_QUERYSTRING_AUTH", False),
        },
    }

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SESSION_COOKIE_SECURE = env_bool("DJANGO_COOKIE_SECURE", False)
CSRF_COOKIE_SECURE = env_bool("DJANGO_COOKIE_SECURE", False)
SECURE_HSTS_SECONDS = int(env("DJANGO_HSTS_SECONDS", "0"))

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.StandardPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend", "rest_framework.filters.SearchFilter", "rest_framework.filters.OrderingFilter"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.common.exceptions.api_exception_handler",
    "COERCE_DECIMAL_TO_STRING": True,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"auth": "20/min", "checkout": "30/min"},
}
SPECTACULAR_SETTINGS = {"TITLE": "Nstore API", "VERSION": "1.0.0", "SERVE_INCLUDE_SCHEMA": False}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BEAT_SCHEDULE = {
    "deliver-pending-outbox": {"task": "apps.integrations.tasks.deliver_pending_outbox", "schedule": 30.0},
}

ONEC_BASE_URL = env("ONEC_BASE_URL")
ONEC_USERNAME = env("ONEC_USERNAME")
ONEC_PASSWORD = env("ONEC_PASSWORD")
ONEC_TIMEOUT_SECONDS = float(env("ONEC_TIMEOUT_SECONDS", "20"))
ONEC_RETRY_ATTEMPTS = int(env("ONEC_RETRY_ATTEMPTS", "4"))
ONEC_RETRY_BACKOFF_SECONDS = float(env("ONEC_RETRY_BACKOFF_SECONDS", "0.75"))
ONEC_VERIFY_TLS = env_bool("ONEC_VERIFY_TLS", True)
ONEC_MEDIA_URL_TEMPLATE = env("ONEC_MEDIA_URL_TEMPLATE")
ONEC_IMAGE_MAX_SIDE = int(env("ONEC_IMAGE_MAX_SIDE", "1600"))
ONEC_IMAGE_WEBP_QUALITY = int(env("ONEC_IMAGE_WEBP_QUALITY", "82"))
ONEC_RETAIL_PRICE_TYPE_ID = env("ONEC_RETAIL_PRICE_TYPE_ID")
ONEC_B2B_PRICE_TYPE_IDS = [x.strip() for x in env("ONEC_B2B_PRICE_TYPE_IDS").split(",") if x.strip()]
ONEC_WAREHOUSE_IDS = [x.strip() for x in env("ONEC_WAREHOUSE_IDS").split(",") if x.strip()]
ONEC_SYNC_ENABLED = env_bool("ONEC_SYNC_ENABLED", False)
if ONEC_SYNC_ENABLED:
    CELERY_BEAT_SCHEDULE.update({
        "sync-onec-stock": {
            "task": "apps.integrations.tasks.sync_onec_stock",
            "schedule": float(env("ONEC_STOCK_SYNC_SECONDS", "300")),
        },
        "sync-onec-catalog": {
            "task": "apps.integrations.tasks.sync_onec_catalog",
            "schedule": float(env("ONEC_CATALOG_SYNC_SECONDS", "3600")),
        },
    })

CRM_MODE = env("CRM_MODE", "disabled")
CRM_BASE_URL = env("CRM_BASE_URL")
CRM_TOKEN = env("CRM_TOKEN")
CRM_TIMEOUT_SECONDS = float(env("CRM_TIMEOUT_SECONDS", "15"))
CRM_VERIFY_TLS = env_bool("CRM_VERIFY_TLS", True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"format": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}'}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
