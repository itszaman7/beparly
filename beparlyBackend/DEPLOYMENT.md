# Django API deployment on a VPS

This deploys the backend only. The frontend runs on Vercel. Run these commands from `beparlyBackend` on a Linux VPS with Docker Compose installed. This host already runs Caddy and Nginx, so Compose publishes Django only on `127.0.0.1:8003`; the existing host Caddy must proxy the API hostname to that address. Do not start a second Caddy container on ports 80/443.

## Prepare DNS and Bunny

1. Point `api-beparly.pqdeals.com` to the VPS with the correct DNS record and ensure inbound ports 80 and 443 reach the existing host Caddy. Configure the existing Caddy site to proxy `api-beparly.pqdeals.com` to `127.0.0.1:8003`; Caddy obtains and renews the HTTPS certificate. Keep PostgreSQL, Redis, and port 8003 closed externally.
2. Use the existing Bunny Storage zone. Link a Bunny Pull Zone and set its custom hostname (for example `images.example.com`). Enable advanced HMAC-SHA256 token authentication for the entire Pull Zone. Never configure a bypass for unsigned requests.
3. Add a **Block Request** edge rule for `/private-records/*` on that Pull Zone. This prefix contains purchase and expense documents; no CDN request to it should succeed, even with a valid image token. Django reads documents through the authenticated Storage API and serves authorized downloads at `/api/v1/...`.
4. Confirm the Storage API host matches the zone's primary region. `BUNNY_STORAGE_PASSWORD` is the zone password, while `BUNNY_CDN_TOKEN_KEY` is the distinct Pull Zone token authentication key. Keep both on the VPS only. Back up the entire Storage zone, including `/private-records/`, to an independent destination.

Before allowing document uploads, check a known private-document URL through the CDN and confirm it is blocked. Treat a failing block rule as a deployment failure. Use the exact file token format documented in [Bunny's advanced token authentication guide](https://bunny.net/docs/cdn/security/token-authentication/advanced).

## Configure and start

Copy `.env.production.example` to `.env.production`; set `API_DOMAIN` to `api-beparly.pqdeals.com`, `DJANGO_ALLOWED_HOSTS` to that hostname, and replace every example secret and service value, including Bunny settings. Set `API_ALLOWED_ORIGINS` to the exact HTTPS custom domain used by the Vercel app; do not include a path or trailing slash. Set the Vercel deployment variable `EXPO_PUBLIC_API_URL=https://api-beparly.pqdeals.com`. The frontend already reads this variable. Outbound email is disabled because this backend has no email feature; `check --deploy` reports `mail.W001` to reflect that choice. Never commit `.env.production`. The example secret key is intentionally weak; `check --deploy` may also warn about HSTS subdomains and preload, which should stay disabled unless every subdomain is HTTPS-only.

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

After deployment, validate the host Caddy configuration and reload the existing Caddy service using the server's established operations procedure. Do not modify the Nginx listener or stop either existing proxy without checking its current virtual hosts.

Create an admin superuser interactively with `./deployment/create-superuser.sh`. Django prompts for the administrator's Bangladeshi mobile number and password; the password is entered interactively and is not stored in the env file.

Check `https://api-beparly.pqdeals.com/healthz/` for `{"status":"ok"}`. Then test a Vercel-origin login and Bearer-token API call, a preflight `OPTIONS` request, admin static files, image upload and signed delivery, and an authorized private-document download. Unlisted browser origins must receive no CORS approval. A health response checks PostgreSQL but does not validate Bunny or Redis, so test those separately.

## Update and recover

After pulling code, run `./deployment/deploy.sh` from this backend directory. It validates Compose and Django production settings, builds the API image, displays the migration plan and asks before applying migrations, then updates the containers and checks the loopback health endpoint. It does not pull code or modify the shared Caddy/Nginx configuration. Back up PostgreSQL and the Bunny Storage zone before production updates. Do not run migrations in each Gunicorn worker or on every restart.

Keep automated PostgreSQL backups and periodic restore rehearsals. A database dump can be created on the VPS with:

```sh
docker compose --env-file .env.production -f compose.prod.yaml exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > beparly-$(date +%F).dump
```

Move dumps to independent, access-controlled storage and apply a retention schedule. A restore must include the matching Bunny objects; otherwise database file keys can point to missing images or documents. Use a fresh database volume during a rehearsal, restore with `pg_restore` into an empty database, restore Bunny objects to the same keys, and verify a sale, an image, and a private attachment before directing traffic to the restored stack. Preserve the original `DJANGO_SECRET_KEY` for an existing database; rotating it requires a separate plan. Redis contains short-lived login throttle state and needs no persistent backup.

The Compose configuration uses no published database port. Avoid `docker compose down -v` on production because that removes the PostgreSQL volume. Review application and Caddy logs with `docker compose --env-file .env.production -f compose.prod.yaml logs` and monitor the external health URL, HTTPS expiry, database backups, and Bunny delivery errors.
