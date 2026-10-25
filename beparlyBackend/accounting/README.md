# Accounting foundation

The UI records money, contacts and expenses. Only `accounting.services.post` creates finalized journal entries. Each entry has a unique business/source identity, optional client command UUID, at least two lines, and exactly equal debit and credit totals. Journal balances are authoritative; money accounts do not store running totals.

## Account policy

`setup_business` provisions the hidden chart and a zero-balance Cash in Shop account idempotently. User-created bank and wallet accounts each map to a dedicated asset ledger account. Customer and supplier statements use contact-tagged journal lines against shared receivable, payable and advance control accounts. A contact with both roles keeps the two positions separate.

An optional opening cash amount is accepted in the business-creation request. A newly created money account may also receive an optional opening balance, posted atomically on the business day against Opening Equity under its account-creation command ID. An omitted balance starts at zero. Later changes to an existing account use recorded transfers or classified money events. The public Money transaction endpoint rejects new opening-balance commands. Existing opening journals remain in the audit history.

Ledger accounts carry a unique, stable business-scoped `code` and a separate `type` (asset, liability, equity, income, expense). The code drives posting rules; the type drives classification. Codes are currently mnemonic rather than display numbers. A future numbered chart can add a separate per-business number without changing posted journal references or these machine codes. Bank and wallet accounts remain assets, so their eventual numbers belong in the asset range.

Money input uses two decimal places. Inventory-derived postings retain up to seven places. Negative money-account balances are allowed and displayed. Posting dates use the current business date; entered event dates remain on source records. The backend never treats a receipt as revenue without a selected source reason.

Expenses and purchases can have up to ten append-only supporting documents each (JPG, PNG, WebP or PDF, maximum 10 MB per file). Uploads are separate idempotent commands and do not change posted amounts or stock. File downloads require record-level business authorization. In development, files live under `private_attachments` outside the public media route; include this directory in backups. Production requires `ATTACHMENT_STORAGE_BUCKET`, a separate private bucket without a CDN or public access. Include it in backup and restoration procedures. The API never returns a direct object URL.

## Existing inventory rollout

Do not apply the migrations to the live database before rehearsing on a populated PostgreSQL copy and verifying backups. Stock writes must be paused for the copy and live cutoff. Run `python manage.py setup_accounting` to inspect quantity and remaining FIFO value, then `python manage.py setup_accounting --apply` after review. The cutoff reconciles balances against remaining cost layers by variant, location and batch and posts Inventory Asset against Opening Equity once. Historical stock rows and movements remain in place. Zero-cost historical layers require review before cutoff. A stock write also checks for a cutoff, so a business cannot silently bypass reconciliation.

Manual opening stock posts to Opening Equity. Manual receipts and positive adjustments use owner contribution or inventory count gain. Negative adjustments and manually posted waste use actual FIFO cost against Inventory Loss. A correction of opening stock is owner-only, links to its original opening movement, and is allowed only while that stock has no later movements. Transfers keep overall inventory value unchanged. Reaching an expiry date does not create a loss.

## Retired business asset workflow and future documents

The asset purchase, sale and depreciation screens and API routes have been retired. Users record ordinary spending through Expenses and miscellaneous receipts through Other income. Historical asset journals and tables remain for audit integrity; no migration deletes or rewrites them. If a deployment previously enabled an asset depreciation scheduler, disable it during rollout. Existing asset balances need a separate accounting review before they can be reclassified or closed; recording an expense or other income does not alter those historical asset journals.

## Money In classification

The Money In form asks for a business reason and a receiving money account. It never asks the shopkeeper to select journal accounts. `setup_business` provisions a separate Miscellaneous income category for manual receipts. Other income credits that category (or another non-Sales income category chosen in settings); product sales use a Sales income category. Owner contributions and customer advances use their existing control accounts. Customer dues are collected against the sale through its payment workflow, and supplier refunds use the supplier workflow with advance or payment validation. The Money In command ID remains stable on retry.

`accounting.contracts` provides line builders for future Sales and Purchases. Those modules must validate and post their source document, stock movement, payment/allocation and journal in one transaction using a unique source ID. No invoice, bill, payment allocation, tax calculation or freight UI is implemented here. A future Purchase form can accept optional directly attributable extra cost and include it in inventory cost.

Financial actions in the mobile UI are online-first. Android offline financial outbox and conflict recovery remain future work; do not label an unconfirmed financial action as posted.
