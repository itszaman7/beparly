# Accounting foundation

The UI records money, contacts, expenses and business assets. Only `accounting.services.post` creates finalized journal entries. Each entry has a unique business/source identity, optional client command UUID, at least two lines, and exactly equal debit and credit totals. Journal balances are authoritative; money accounts do not store running totals.

## Account policy

`setup_business` provisions the hidden chart and a zero-balance Cash in Shop account idempotently. User-created bank and wallet accounts each map to a dedicated asset ledger account. Customer and supplier statements use contact-tagged journal lines against shared receivable, payable and advance control accounts. A contact with both roles keeps the two positions separate.

An optional opening cash amount is accepted only in the business-creation request and posted atomically to Cash in Shop against Opening Equity. Later money accounts start at zero; existing money reaches them through a recorded transfer or another classified money event. The public Money transaction endpoint rejects new opening-balance commands. Existing opening journals remain in the audit history.

Ledger accounts carry a unique, stable business-scoped `code` and a separate `type` (asset, liability, equity, income, expense). The code drives posting rules; the type drives classification. Codes are currently mnemonic rather than display numbers. A future numbered chart can add a separate per-business number without changing posted journal references or these machine codes. Bank and wallet accounts remain assets, so their eventual numbers belong in the asset range.

Money input uses two decimal places. Inventory-derived postings retain up to seven places. Negative money-account balances are allowed and displayed. Posting dates use the current business date; entered event dates remain on source records. The backend never treats a receipt as revenue without a selected source reason.

## Existing inventory rollout

Do not apply the migrations to the live database before rehearsing on a populated PostgreSQL copy and verifying backups. Stock writes must be paused for the copy and live cutoff. Run `python manage.py setup_accounting` to inspect quantity and remaining FIFO value, then `python manage.py setup_accounting --apply` after review. The cutoff reconciles balances against remaining cost layers by variant, location and batch and posts Inventory Asset against Opening Equity once. Historical stock rows and movements remain in place. Zero-cost historical layers require review before cutoff. A stock write also checks for a cutoff, so a business cannot silently bypass reconciliation.

Manual opening stock posts to Opening Equity. Manual receipts and positive adjustments use owner contribution or inventory count gain. Negative adjustments and manually posted waste use actual FIFO cost against Inventory Loss. A correction of opening stock is owner-only, links to its original opening movement, and is allowed only while that stock has no later movements. Transfers keep overall inventory value unchanged. Reaching an expiry date does not create a loss.

## Business assets and future documents

Asset purchase and sale currently settle immediately through a money account. Depreciation is straight-line from the month after the in-service date; run `python manage.py post_depreciation` after each month closes. The command is idempotent. An asset sale posts any due prior months before computing gain or loss. No Celery worker is needed.

`accounting.contracts` provides line builders for future Sales and Purchases. Those modules must validate and post their source document, stock movement, payment/allocation and journal in one transaction using a unique source ID. No invoice, bill, payment allocation, tax calculation or freight UI is implemented here. A future Purchase form can accept optional directly attributable extra cost and include it in inventory cost.

Financial actions in the mobile UI are online-first. Android offline financial outbox and conflict recovery remain future work; do not label an unconfirmed financial action as posted.
