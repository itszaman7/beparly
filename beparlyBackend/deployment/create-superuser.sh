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
if [[ $# -ne 0 ]]; then
    echo "Usage: $0" >&2
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

"${DOCKER[@]}" compose \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    run --rm api python manage.py createsuperuser
