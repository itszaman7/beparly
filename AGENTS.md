# AGENTS.md — Bangladesh Retail & Wholesale ERP

> Project guidance for AI coding agents and contributors. Treat this document as the implementation baseline unless an explicit project decision supersedes it.

## 1. Product mission

Build an **Android-first, offline-capable ERP for Bangladeshi retailers and wholesalers**. The application should speak the language of shop owners—not force users to learn accounting terminology.

Users should be able to answer: What do I have in stock? Where is it? Who did I buy it from? Who did I sell it to? Who owes me money (বাকি)? Whom do I owe? How much came in and went out? Can I send an invoice or delivery challan?

This is a **separate product from PQ Commerze**. Do not couple the codebases or assume their user journeys are the same. Potential future integration must happen via deliberate APIs.

**Primary users:** Retailers, wholesalers, and businesses doing both. A configurable business mode controls shortcuts and defaults, **not** separate databases or duplicate implementations.

## 2. Agreed technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Client | React Native, Expo, TypeScript | Android-first app and shared UI logic |
| Web development preview | Expo Web / React Native Web | Fast browser iteration during development |
| Android development | Expo Go initially; development build as needed | Test actual native behavior on Android |
| Local offline database | SQLite on Android (e.g., `expo-sqlite`) | Local records, pending operations, sync metadata |
| Server | Python, Django, Django REST Framework | APIs, authentication, validation, business logic |
| Central database | PostgreSQL | Authoritative shared business data |
| Administration | Django Admin | Internal operations; not the shopkeeper-facing application |
| Background tasks | Add Celery/Redis only when justified | Asynchronous tasks and scheduled jobs |
| Deployment | Production Django hosting + managed/self-hosted PostgreSQL; Android release via EAS Build | Secure backend and Android distribution |

**Important distinction:** `SQLite` is **on the Android client for offline operation**; `PostgreSQL` is **on the server for online, central data**. The local SQLite database does **not** directly replicate into PostgreSQL. All synchronization goes through authenticated, validated Django API endpoints.

## 3. Development and preview workflow

Prioritize a fast **web-based development workflow**, but do not confuse a browser preview with production Android behavior.

### Backend (local development)

```bash
# After creating a virtual environment and installing requirements:
python manage.py makemigrations
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

Prefer PostgreSQL locally as well to minimize database-specific surprises. Django's own development database may be SQLite temporarily for a throwaway prototype, but **do not use the Django development SQLite database as a substitute for Android's offline database**.

### Frontend

```bash
npx create-expo-app@latest mobile
cd mobile
npx expo start --web
```

Expo Web typically starts at `http://localhost:8081` (the terminal output is authoritative). If web dependencies are missing:

```bash
npx expo install react-dom react-native-web @expo/metro-runtime
```

For an actual Android phone:

```bash
npx expo start
```

Scan the QR code using Expo Go when supported. Both devices should be on the same reachable network. For the phone, configure the API base URL to the computer's LAN address (e.g. `http://192.168.x.x:8000`), **not** `localhost`; use HTTPS outside trusted local development. Configure Django's `ALLOWED_HOSTS`, CORS for web preview, and authentication correctly. Never disable production security settings to make local previews work.

**Web-preview rule:** Browser-based SQLite/storage behavior differs from Android. Build reusable UI and API abstractions, and test offline SQLite, camera/barcodes, file access, Android printing and background behavior on a real Android device or emulator. Use Expo development builds if a native feature exceeds Expo Go's capabilities. The browser preview is a productivity tool, not Android acceptance testing.

### Production direction

- Deploy Django behind a production application server and HTTPS reverse proxy, with PostgreSQL, environment-based secrets, migrations, monitoring and backups.
- Use EAS Build or a compatible Android pipeline to produce internal test builds first, then a release APK/AAB as needed. Plan for signing, versioning and Play Store requirements if distributing there.
- Configure a production HTTPS API URL in the Android application; never bundle database credentials or server secrets into it.
- Do **not** ship by treating Expo's browser preview as an installable production Android app.

## 4. Business modules and scope

### Shared modules (retail + wholesale)

1. **Business & staff:** Onboarding, owner/staff, basic role permissions, business settings, language, locations.
2. **Products:** Products, categories, SKU/barcode field, purchase/sale units, retail/wholesale default prices, opening stock, low-stock alerts.
3. **Contacts:** Customers, suppliers, and parties on a **shared contact model** with multiple roles; contact histories and balances.
4. **Purchases:** Supplier purchase, line items, received stock, immediate/partial/credit payments and payables.
5. **Inventory:** Shop/godown locations, receipts, deductions, transfers, adjustments, auditable stock movement history.
6. **Sales:** Fast retail sale or party sale, line items, discounts, payment method, partial/credit payment and receivables.
7. **Money:** Money in/out, customer dues, supplier dues, expenses, cash/bank/mobile-wallet payment recording, underlying financial ledger.
8. **Documents:** Sales invoice, receipt, basic delivery challan, PDF sharing, document numbers; Bangla-capable templates.
9. **Reports:** Daily sales, purchases, stock on hand, low stock, outstanding dues, basic money summary.
10. **Synchronization:** On-device offline records, queued writes, retry, conflict detection, reconciliation and recovery.

### Retail-specific UX

- Quick sale/checkout is the primary action.
- Walk-in customer is optional.
- Quick product selection, retail default pricing and immediate payment are the defaults.
- Fast receipt creation with minimal fields.

### Wholesale-specific UX

- Party selection is prominent; business address and credit history are accessible.
- Support bulk units such as cartons (with explicit, validated conversion to base units).
- Allow a price override / simple wholesale price with authorization where needed.
- Track partial payments, party dues, and one linked challan for a dispatched sale in the initial version.
- Show party transaction statements.

### Post-MVP unless validated as essential by pilot users

Advanced tier/customer-specific pricing, multi-branch administration, multiple partial dispatches, sales/purchase returns workflows, complex taxes, detailed double-entry accounting screens, full POS peripherals, Bluetooth thermal printing, advanced barcode workflows, batch/expiry/serial tracking, sophisticated analytics and integrations.

**Scope rule:** Validate with actual investor-sourced pilot businesses before promoting post-MVP features into the initial release.

## 5. UX and information architecture

Use understandable business labels. Never make a shopkeeper perform bookkeeping just to record a sale.

**Suggested bottom navigation:** `Home`, `Sales`, `Stock`, `More`.

**Home:** Today's sales, money received, expenses, customer dues, supplier dues, low stock, overdue payments, and quick actions (`New Sale`, `Purchase`, `Receive Payment`, `Products`, `Parties`, `Challan`).

**More:** Customers/Parties, Suppliers, Money, Documents, Reports, Settings.

Keep internal terms like journal entries and payment allocations inside the backend. The interface should use familiar Bangladeshi terms, including **বাকি**, and support both Bangla and English. Format monetary values in **BDT (৳)**, with correct decimal arithmetic.

## 6. Domain model (initial proposal, refine through migrations)

Organize the Django backend as a **modular monolith**, not microservices:

```text
backend/
  config/
  apps/
    businesses/
    users/
    contacts/
    products/
    inventory/
    purchases/
    sales/
    payments/
    accounting/
    documents/
    reports/
    sync/
mobile/
  app/                 # Expo Router screens, if chosen
  src/
    components/
    features/
    services/
    storage/
    sync/
    i18n/
```

Possible Django entities:

| Domain | Key entities |
| --- | --- |
| Business | Business, BusinessMember, BusinessSettings |
| Contacts | Contact, ContactRole, ContactAddress |
| Catalog | Product, Category, Unit, UnitConversion, PriceRule |
| Inventory | StockLocation, StockMovement, StockAdjustment |
| Purchases | Purchase, PurchaseLine |
| Sales | Sale, SaleLine |
| Payments | PaymentAccount, Payment, PaymentAllocation |
| Accounting | LedgerAccount, JournalEntry, JournalLine, Expense |
| Documents | DocumentSequence, DocumentRecord |
| Sync | Device, SyncOperation |

Model business parties as contacts with roles rather than creating unrelated `Customer`, `Party` and `Supplier` records. Use appropriate uniqueness constraints scoped to the business.

## 7. Non-negotiable accounting and inventory rules

1. **Business isolation:** Every tenant-owned record is scoped to a business. Verify authorization server-side on every request and object lookup.
2. **Atomic posting:** Confirming a sale/purchase must commit its invoice state, stock effect, payment allocations, and relevant ledger effects as one consistent operation using Django transactions.
3. **Auditability:** Do not silently mutate or delete posted financial/stock history. Use reversal/adjustment operations and maintain actor/time references.
4. **No duplicate writes:** Every client-originated posted command has an idempotency key; retries return the original outcome.
5. **Money precision:** Django `DecimalField` / Python `Decimal`, PostgreSQL `NUMERIC`; no binary floating-point for financial calculations.
6. **Stock precision:** Use validated units, conversions and quantity precision. Transfers must move stock between locations without changing overall stock.
7. **Customer due:** Invoice amount minus valid allocated receipts/credits. Receiving an old due increases cash, **not new sales revenue**.
8. **Supplier due:** Purchase liability minus settled payments/credits.
9. **Reporting:** Distinguish revenue, collections, expenses, profit, stock value and cash balance. Do not label collections as profit.
10. **Operational controls:** Specify whether negative stock is allowed. Handle offline overselling and sync conflict outcomes explicitly; never silently overwrite a posted transaction.
11. **Tax compliance:** Bangladesh NBR invoice/VAT requirements must be verified for the actual business and implementation; do not copy India's GST model blindly or claim compliance without review.

## 8. Offline-first sync design

### Android local database

Store locally needed master data and records in SQLite; keep a persistent **outbox** for locally created operations. Separate local IDs and server IDs (or use stable UUIDs) to avoid mismatches. Record a business scope, device ID, command ID, local creation time, sync status and server result.

### Sync lifecycle

1. User records a sale or payment while offline; local transaction and corresponding outbox command are persisted atomically in SQLite.
2. UI labels it `Pending sync` rather than pretending the cloud has confirmed it.
3. On reconnection, the app sends queued commands to Django with authentication and stable idempotency IDs.
4. Django authorizes the business, validates stock/payment rules, commits transaction(s) atomically, and returns server IDs and versions.
5. Client marks confirmed commands as synchronized and pulls changes since its last valid sync cursor.
6. Conflicts are surfaced with actionable messages and a recoverable workflow. Do not auto-delete or double-post transactions.

**Never** expose PostgreSQL directly to the mobile client. Design synchronization as API-level domain operations; do not attempt blind row-level database copying.

Offline capability is not identical to guaranteed acceptance: a local sale may need user intervention when another device has consumed stock in the cloud. Define reservation/oversell behavior with pilot customers before release.

## 9. API and security conventions

- Use versioned REST endpoints: `/api/v1/...`.
- Validate all monetary, tax, discount, price and stock calculations **on the server**, even when the client also calculates previews.
- Use Django/DRF permissions and business-scoped querysets; do not trust client-supplied business IDs by themselves.
- Use secure authentication with revocable/rotated credentials. Store client secrets/tokens in an appropriate secure mechanism, not plaintext app constants.
- Keep credentials in environment variables; commit an example `.env.example` with dummy keys only.
- Paginate large lists, filter by business, and avoid N+1 queries on transaction screens.
- Introduce structured errors suitable for Bangla/English UI messages.
- Use HTTPS in production, backups and tested restoration procedures.

## 10. Execution phases

**Phase 0 — Discovery and design:** Observe at least three pilot businesses (retail and wholesale), identify checkout, purchase, due and challan flows; decide initial offline and negative-stock rules. Create screen map, database diagram and test scenarios.

**Phase 1 — Foundation:** Project setup, Django/DRF/PostgreSQL, Expo Web and Android previews, authentication/business isolation, product/contact/location masters, language setup.

**Phase 2 — Transactions:** Opening stock, purchases, retail quick sale, party sale, quantities/unit conversions, inventory movements and transaction-safe posting.

**Phase 3 — Money & documents:** Partial payments, customer/supplier dues, expenses, cash/bank/mobile-wallet recording, basic accounting foundation, invoices, receipts and challans.

**Phase 4 — Offline & pilot readiness:** Android SQLite persistence, sync outbox/inbox, idempotent posting, conflicts, migration handling, offline tests, security reviews, data backups, document verification and reports reconciliation.

**Phase 5 — Pilot & iterate:** Run with selected retailers/wholesalers; measure workflow time, data correctness, failed syncs, user mistakes and missing operational features before committing to expansion.

Do not present rough schedules as commitments. Prioritize an end-to-end working vertical slice (add product → purchase → sell → receive partial payment → issue invoice → sync) over dozens of incomplete screens.

## 11. Definition of done for pilot

- Retail checkout works with optional walk-in customer.
- Wholesale party sale supports bulk quantities, partial payment and basic challan.
- Purchases increase stock and create supplier dues when unpaid.
- Multiple stock locations and transfers reconcile correctly (even if the MVP UI exposes only one default location).
- Dues reconcile against invoices, receipts and supplier payments.
- Offline Android transaction survives restart, syncs when online, and does not double-post on retry.
- Conflicting offline edits / insufficient stock have a tested recovery path.
- Cross-business access is blocked and tested.
- Sales/stock/money reports reconcile with underlying records.
- Backup/restore works; Android build and API use production-secure configuration.

## 12. Instructions for coding agents

- **Read this file first** and follow existing repository conventions if already established.
- Before a substantial change, explain the objective, affected files, data model implications, and how it will be tested.
- Implement features as small end-to-end increments rather than massive scaffold dumps.
- **Never invent business requirements** when they affect money, inventory, taxes, permissions, or offline conflicts. State assumptions and request clarification.
- Do not introduce unnecessary microservices, queues, ORMs, state-management libraries or dependencies.
- Use Django migrations (`makemigrations`, `migrate`) and review migration safety; never edit an already-applied production migration without an explicit migration plan.
- Add automated backend tests for business rules, permissions, transactions and idempotency; add client tests for calculations, local storage and sync state handling.
- Keep API contracts and data types explicit. Avoid duplicate financial logic across frontend and backend.
- Support accessible layouts, loading/empty/error/offline states and Bangla-capable fonts and text rendering.
- Run appropriate tests and linting before marking work complete; disclose anything not actually verified.
- Treat **Expo Web as a development preview** and verify Android-specific behavior on Android before calling a feature complete.

---

**Product principle:** Make daily business operations effortless for Bangladeshi retailers and wholesalers while keeping stock, dues, and financial records accurate beneath the surface.
