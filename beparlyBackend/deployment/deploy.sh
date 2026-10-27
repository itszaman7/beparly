#!/usr/bin/env bash
set -Eeuo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$BACKEND_DIR/compose.prod.yaml"
ENV_FILE="${APP_ENV_FILE:-$BACKEND_DIR/.env.production}"

if [[ "$ENV_FILE" != /* ]]; then
    ENV_FILE="$BACKEND_DIR/$ENV_FILE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Production env file not found: $ENV_FILE" >&2
    exit 1
fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--yes" ) ]]; then
    echo "Usage: $0 [--yes]" >&2
    exit 2
fi

export APP_ENV_FILE="$ENV_FILE"
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
    if ! command -v sudo >/dev/null 2>&1; then
        echo "Docker is unavailable and sudo was not found." >&2
        exit 1
    fi
    DOCKER=(sudo docker)
    "${DOCKER[@]}" info >/dev/null
fi

compose() {
    "${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

cd "$BACKEND_DIR"
echo "Validating production Compose configuration..."
compose config --quiet

echo "Building the API image..."
compose build api

echo "Checking Django production settings..."
compose run --rm api python manage.py check --deploy

echo "Starting PostgreSQL and Redis..."
compose up -d --wait --wait-timeout 120 db redis

echo "Migration plan:"
compose run --rm api python manage.py migrate --plan

if [[ "${1:-}" != "--yes" ]]; then
    read -r -p "Apply these migrations and update the API? [y/N] " answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "Deployment stopped before migrations and API update."
        exit 1
    fi
fi

echo "Applying migrations..."
compose run --rm api python manage.py migrate

echo "Starting the updated API..."
compose up -d --wait --wait-timeout 120 api

echo "Checking the API health endpoint..."
curl --fail --silent --show-error \
    -H 'Host: api-beparly.pqdeals.com' \
    -H 'X-Forwarded-Proto: https' \
    http://127.0.0.1:8003/healthz/
echo
compose ps
