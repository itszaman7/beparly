# Beparly API

The account API uses Django 6.1. Registration creates a user with no business profile. A user can create multiple independent business profiles and choose one in the app. Owners can create employee logins within a selected profile; employees cannot manage users. Bangladeshi mobile numbers entered as `01XXXXXXXXX`, `8801XXXXXXXXX`, or `+8801XXXXXXXXX` are stored as `01XXXXXXXXX`; spaces, hyphens, periods, and parentheses are accepted as separators.

Each business profile has its own ID. Location endpoints require that ID and verify the user's membership. Product, stock, and transaction endpoints added later must do the same. The account API never infers a business from the first membership.

## Local setup with PostgreSQL

The Compose service runs PostgreSQL only; Django runs on the host. From this directory:

```powershell
Copy-Item .env.example .env
# Replace POSTGRES_PASSWORD and DJANGO_SECRET_KEY in .env with unique local values.
docker compose up -d postgres
..\env\Scripts\python.exe -m pip install -r requirements.txt
..\env\Scripts\python.exe manage.py migrate
..\env\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

The ignored `.env` is read by Django and Docker Compose. PostgreSQL is available only at `127.0.0.1:5433` on the host by default, and its data persists in the `postgres_data` Docker volume. Set `DJANGO_ALLOWED_HOSTS` to include the computer's LAN address when testing on a phone. Set `API_ALLOWED_ORIGINS` to the Expo Web origin for browser preview.

The previous `db.sqlite3` file is no longer used by default. `DB_ENGINE=sqlite3` is an explicit temporary option for isolated tests. Data in that file is not automatically copied to PostgreSQL. Set `DJANGO_DEBUG=0`, a strong `DJANGO_SECRET_KEY`, approved hosts, and HTTPS before deployment. The JSON API is at `/api/v1/`.

## Authentication endpoints

- `POST auth/register/`: `phone`, `password`, optional `username`
- `POST auth/login/`: `phone`, `password`
- `POST auth/logout/`: Bearer token
- `GET auth/me/`: Bearer token; returns the user and their business profiles
- `GET/POST businesses/`: Bearer token; POST creates a profile with `name` and owner membership
- `GET/POST businesses/<business_id>/employees/`: owner Bearer token for that business; POST uses `phone`, `password`, optional `username`
- `PATCH businesses/<business_id>/employees/<user_id>/permissions/`: owner sets `can_manage_locations` to `true` or `false`

## Shops and warehouses

`stockkeeper` owns `StockLocation`. Creating a business automatically creates one active default `Main Shop`; migration `stockkeeper.0002` adds it to existing businesses. Shops and warehouses use the same model. The type is a label and does not restrict future inventory flows.

- `GET/POST businesses/<business_id>/locations/`: members can list; owners and authorized employees can create with `name`, `type` (`shop` or `warehouse`), and optional `address`
- `GET/PATCH businesses/<business_id>/locations/<location_id>/`: members can view; owners and authorized employees can edit `name`, `type`, `address`, or `is_active`

Location names are unique within a business, ignoring case. The default location cannot be deactivated. No hard-delete endpoint exists.

## Products and stock

The separate `products` Django app owns products, nested categories, packaging units and batches. `stockkeeper` owns balances, receipt cost layers, append-only movements, receipts, waste and transfers. Product and stock commands require an `X-Command-ID` UUID so retries return the original result. Product and category access requires membership in the URL's business. Stock commands additionally require the owner role or `can_post_stock`.

- `GET/POST businesses/<business_id>/categories/`; `PATCH .../categories/<uuid>/`
- `GET/POST businesses/<business_id>/products/`; `GET/PATCH .../products/<uuid>/`
- `POST/DELETE .../products/<uuid>/image/` using multipart field `image`
- `GET/POST .../products/<uuid>/units/`; `PATCH .../units/<uuid>/`
- `GET/POST .../products/<uuid>/batches/`
- `POST .../products/<uuid>/convert-tracking/`; `GET .../products/<uuid>/fefo/`; `POST .../products/<uuid>/batch-selection/`
- `POST businesses/<business_id>/stock/receipts/`, `/stock/waste/`, `/stock/transfers/`
- `GET .../locations/<id>/stock/`, `/locations/<id>/movements/`
- `GET/PATCH businesses/<business_id>/inventory-settings/` for the expiry warning threshold

## Audit history

The separate `audit` app records successful catalog, location, and stock writes with the business, actor, timestamp, affected record, and field changes. Events are append-only and posted in the same transaction as the operation. StockMovement remains the inventory quantity ledger. Command retries return the original result without another audit event.

- `GET businesses/<business_id>/audit/?page=1`: newest events first, 30 per page
- Optional `product_id`, `location_id`, or `entity_type` filters; membership in that business is required

Migration `audit.0003` copies earlier stock movements into audit history with their original actor and time. Earlier catalog or location edits cannot be reconstructed reliably and are not represented as historical audit events.

Product creation may include `opening_stock` with quantity, explicit unit cost, optional location ID, and batch identifier and expiry date where tracking requires them. It posts atomically with the product. Inventory cost comes from receipt layers, not the editable buying price. Expiry dates remain sellable through that date in the business timezone (default `Asia/Dhaka`). Expiry does not write off physically present stock.

Development images use `MEDIA_ROOT` and Django's debug media URL. Production requires an S3-compatible private bucket, `PRODUCT_CDN_DOMAIN`, `PRODUCT_CDN_KEY_ID`, and `PRODUCT_CDN_PRIVATE_KEY_PATH` for signed CDN URLs. Configure the CDN origin to access the private bucket, and provide storage credentials through the server environment or workload identity. The database stores only storage keys. See [django-storages S3 and CloudFront settings](https://django-storages.readthedocs.io/en/stable/backends/amazon-S3.html).

After installing requirements, review and apply migrations with `python manage.py migrate --plan` and `python manage.py migrate`. Run PostgreSQL tests with `python manage.py test accounts products stockkeeper audit`.

Tokens are random, stored only as hashes, expire after 30 days, and are revoked by logout. Phone ownership is not verified in this first flow. Login throttling uses Django's default local cache; configure a shared cache before multi-worker deployment.
