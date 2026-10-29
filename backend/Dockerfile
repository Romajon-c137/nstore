FROM python:3.13.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN addgroup --system nstore && adduser --system --ingroup nstore nstore
COPY requirements/base.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt
COPY . /app
RUN mkdir -p /app/staticfiles /app/media && chown -R nstore:nstore /app
USER nstore

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "45", "--access-logfile", "-"]
