# Quotations API

All endpoints are under `/api/v1/businesses/{business_id}/`, require a bearer session with sales permission, and scope records to that business. Every write requires a stable UUID in `X-Command-ID`; retry the same command ID after a lost response. Errors use the existing `{ "error": { "code", "message" } }` envelope. A draft version conflict returns HTTP 409 and keeps the client's local copy intact.

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `quotations/` | Search and page (30 per page), or create a draft. |
| GET, PATCH | `quotations/{id}/` | Read details, or save a draft with its current `version`. |
| POST | `quotations/{id}/issue/` | Send `{ "version": 1 }`; assigns a `Q-` number and freezes the offer. |
| POST | `quotations/{id}/status/` | Send `accepted`, `rejected`, or `cancelled` status. |
| POST | `quotations/{id}/duplicate/` | Create a new editable, unnumbered draft. |
| POST | `quotations/{id}/convert/` | Return or reopen the one linked sale draft. |
| GET | `quotations/{id}/documents/a4/` or `a5/` | Authenticated issued PDF. |
| GET, POST | `quotation-sale-drafts/{id}/` | Read the draft or complete it with `paid`, optional `account_id`, registered `customer_id`, `batch_ids`, and owner-only `prices`. |

Draft bodies accept `location_id`, `price_tier`, registered `customer_id` or walk-in name/phone/address, `valid_until`, `delivery_address`, `notes`, one amount `discount`, `delivery_fee`, and 1 to 100 `lines`. Each line has `product_id`, optional `variant_id` and `unit_id`, `quantity`, and optional `unit_price`. The server resolves catalog price, validates Decimal precision and package conversions, and calculates totals. Staff may use catalog prices; only the owner may override them. `valid_until` defaults to seven days after issue. Expiry is evaluated in the business timezone.

Quotations and conversion leave stock and financial balances untouched. Conversion checks current items, package factors, and available stock, but makes no reservation. Checkout rechecks stock and posts through `create_sale` atomically. A walk-in checkout must pay in full or select a registered customer before leaving a due. An issued quote can be revised only by duplication. Tax is outside this release.
