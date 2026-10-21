# Product variant rollout

The migrations are additive, then backfill historical rows, then enforce non-null variant links and variant-keyed balances. Do not edit the applied product or stock migrations.

Read-only check on 2026-10-21: the local PostgreSQL database has one product, one balance of 15.000, one cost layer with 15.000 remaining and value 12,000.0000, one movement of 15.000, and one audit event. Recheck these values immediately before rollout because the database may change.

1. Back up PostgreSQL and verify that the backup can be restored. Put the API in maintenance mode so no catalog or stock commands are accepted during the deployment.
2. Rehearse `python manage.py migrate` against a restored PostgreSQL copy. The automated PostgreSQL migration test creates a historical 15-unit balance, cost layer, batch, movement, and audit event, then verifies their IDs and values after migration.
3. Record pre-migration product count, balance quantities by product/location/batch, cost-layer remaining quantities and value, batch expiry dates, movement IDs, and audit-event count. Apply the migrations. The backfill migration takes exclusive table locks while it attaches default variants.
4. Confirm one default variant per historical product, no null or mismatched variant links, and the same stock quantities, valuation, batches, movement IDs, and audit history. Release maintenance mode only after reconciliation.

2026-10-21 local development rollout: saved a PostgreSQL custom-format backup at `.deps/variant-before-20261021.dump`, restored it to `beparly_variant_rehearsal_20261021`, and successfully ran all six variant migrations there. A row-by-row comparison preserved the product, balance, cost layer, movement, and audit records, with one valid default variant. The development server was stopped while the same migrations were applied to the local database, then restarted. Post-migration reconciliation and `manage.py check` passed; the authenticated catalog view returned HTTP 200 for the previously failing URL.
