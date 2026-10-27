FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN DB_ENGINE=sqlite3 python manage.py collectstatic --noinput
RUN useradd --system --uid 10001 --home /app appuser
USER appuser

EXPOSE 8000
CMD ["gunicorn", "beparlyBackend.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "90", "--access-logfile", "-", "--error-logfile", "-"]
