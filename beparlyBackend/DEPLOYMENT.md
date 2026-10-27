# Django API deployment on a VPS

This deploys the backend only. The frontend runs on Vercel. Run these commands from `beparlyBackend` on a Linux VPS with Docker Compose installed.

## Prepare DNS and Bunny

1. Point `api.example.com` to the VPS with an A record. Open inbound ports 80 and 443; keep PostgreSQL, Redis, and port 8000 closed externally. Caddy obtains and renews the HTTPS certificate.
2. Use the existing Bunny Storage zone. Link a Bunny Pull Zone and set its custom hostname (for example `images.example.com`). Enable advanced HMAC-SHA256 token authentication for the entire Pull Zone. Never configure a bypass for unsigned requests.
3. Add a **Block Request** edge rule for `/private-records/*` on that Pull Zone. This prefix contains purchase and expense documents; no CDN request to it should succeed, even with a valid image token. Django reads documents through the authenticated Storage API and serves authorized downloads at `/api/v1/...`.
4. Confirm the Storage API host matches the zone's primary region. `BUNNY_STORAGE_PASSWORD` is the zone password, while `BUNNY_CDN_TOKEN_KEY` is the distinct Pull Zone token authentication key. Keep both on the VPS only. Back up the entire Storage zone, including `/private-records/`, to an independent destination.

Before allowing document uploads, check a known private-document URL through the CDN and confirm it is blocked. Treat a failing block rule as a deployment failure. Use the exact file token format documented in [Bunny's advanced token authentication guide](https://bunny.net/docs/cdn/security/token-authentication/advanced).

## Configure and start

Copy `.env.production.example` to `.env.production` and replace every example domain and secret. Set `API_ALLOWED_ORIGINS` to the exact HTTPS custom domain used by the Vercel app; do not include a path or trailing slash. Set the Vercel deployment variable `EXPO_PUBLIC_API_URL=https://api.example.com`. The frontend already reads this variable. Outbound email is disabled because this backend has no email feature; `check --deploy` reports `mail.W001` to reflect that choice. Never commit `.env.production`. The example secret key is intentionally weak; `check --deploy` may also warn about HSTS subdomains and preload, which should stay disabled unless every subdomain is HTTPS-only.

Restrict `.env.production` to the deployment account (for example, `chmod 600 .env.production`). Ensure the VPS has enough free disk for the database, image layers, and backup staging. Rotate any credentials previously used in a shared development environment before copying them to the VPS.

```sh
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up -d db redis
docker compose --env-file .env.production -f compose.prod.yaml build api
docker compose --env-file .env.production -f compose.prod.yaml run --rm api python manage.py check --deploy
docker compose --env-file .env.production -f compose.prod.yaml run --rm api python manage.py migrate --plan
docker compose --env-file .env.production -f compose.prod.yaml run --rm api python manage.py migrate
docker compose --env-file .env.production -f compose.prod.yaml up -d
```

Create the initial administrator using the project's administrator registration procedure. Check `https://api.example.com/healthz/` for `{"status":"ok"}`. Then test a Vercel-origin login and Bearer-token API call, a preflight `OPTIONS` request, admin static files, image upload and signed delivery, and an authorized private-document download. Unlisted browser origins must receive no CORS approval. A health response checks PostgreSQL but does not validate Bunny or Redis, so test those separately.

## Update and recover

Before an update, back up PostgreSQL and the Bunny Storage zone to independent storage. Record the image/source revision. Review `migrate --plan`, build the new image, run migrations once, and then start the updated services. Do not run migrations automatically in each Gunicorn worker or on every restart.

Keep automated PostgreSQL backups and periodic restore rehearsals. A database dump can be created on the VPS with:

```sh
docker compose --env-file .env.production -f compose.prod.yaml exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > beparly-$(date +%F).dump
```

Move dumps to independent, access-controlled storage and apply a retention schedule. A restore must include the matching Bunny objects; otherwise database file keys can point to missing images or documents. Use a fresh database volume during a rehearsal, restore with `pg_restore` into an empty database, restore Bunny objects to the same keys, and verify a sale, an image, and a private attachment before directing traffic to the restored stack. Preserve the original `DJANGO_SECRET_KEY` for an existing database; rotating it requires a separate plan. Redis contains short-lived login throttle state and needs no persistent backup.

The Compose configuration uses no published database port. Avoid `docker compose down -v` on production because that removes the PostgreSQL volume. Review application and Caddy logs with `docker compose --env-file .env.production -f compose.prod.yaml logs` and monitor the external health URL, HTTPS expiry, database backups, and Bunny delivery errors.
