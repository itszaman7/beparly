# Financial integrity stabilization

## Report serialization and location API

Financial and quantity **report** values are exact decimal strings in plain notation with no unnecessary trailing fractional zeroes (`20.0000000` → `20`, `0E-7` → `0`, `0.0000001` stays exact). Stored `NUMERIC` precision and arithmetic are unchanged. Posted document fields that use fixed currency precision keep their existing contract. `accounting.formatting.decimal_text` is used by financial reports, inventory reports, and the account-ledger response. The seven failures were caused by exposing PostgreSQL aggregate scale through `str(Decimal)`.

Shop creation requires a billing address. The two StockLocation tests omitted that required field, so validation correctly returned 400 before duplicate-name or permission-success behavior. The fixtures now include addresses and separately assert that an addressless shop is rejected. No location rule was weakened.

## Non-sellable return policy and lifecycle

The existing confirmed `damaged` receipt records physical custody with product, variant, batch, location, quantity, actor, timestamp and evidence reference. It does not create a sellable stock balance or FIFO layer. Its journal replaces reversed COGS with Inventory Loss at the **original recorded cost**; it does not recognize damaged goods as a full-value inventory asset. A `sellable` receipt creates a linked movement and FIFO layer at original sale cost. Neither receipt implies a cash refund, which remains a separate confirmed event.

**Implemented lifecycle:** Received → Inspection → one of Restocked / Written Off / Returned to Supplier. The owner confirmed that inspection custody carries no new Inventory Asset and remains outside sellable stock; original sale COGS stays until an explicit decision. An inspection receipt stores exact variant/batch/location, quantity, actor, timestamp, evidence and original FIFO portions without changing stock or posting a journal. An owner decision restocks at those portions, writes the amount off as Inventory Loss, or records physical dispatch to a selected supplier. All three decisions are immutable, audited and idempotent; restock/write-off post atomically with any stock effect. Supplier dispatch creates no supplier credit, payable reduction or cash effect. The supplier credit/exchange/refund remains a separately evidenced business policy and workflow, so supplier financial recovery is **not** yet supported.

## Historical cancellation evidence review — local development business 1

Sale `8a216f78-fb54-438b-b0fb-0b3c0e047f6c` (`S-000001`) has one item, no batch, recorded invoice and receipt of ৳76,500.00, original FIFO cost ৳65,000.0000000, and a historical full cancellation. The original sale and receipt journals are `d242c4ee-6966-44c0-9cc6-c197192659d8` and `5ac607a3-98f5-4512-9399-56e1d8fe27bd`. Reversal journal `98d2c13d-e660-4915-8b20-01f3aad75887` restored Inventory Asset by ৳65,000.0000000; stock movement `529544a9-ceb9-4d93-b5e8-82ea01aa7b01` restored 1.000 to location 1. Refund payment `a2c5a511-840a-4b0f-bdeb-f72d3b4bf256`, journal `00749a7d-f709-4587-b9b8-928bd0284c81`, and money transaction `2f0134f4-91a8-4359-a380-15418c8fe210` record ৳76,500.00 out of money account `6a920666-83f2-4501-8fff-1dca2d8beb23`. The cancellation audit event `728bed73-883c-4674-a63e-c8adbfac4dd1` records only a brief correction reason and refund amount; the stock audit event `4f8dfef9-6771-4bda-b7f3-7ede3ce73edd` records the quantity and cost. Those records establish what the software posted, not what physically happened.

Actor ID `1` posted the sale, receipt and refund and is linked to all four sale/stock audit events. The original sale/receipt events are dated 2026-10-24 around 06:54 UTC; cancellation, restored stock and refund records are dated around 07:38 UTC. These timestamps establish system sequence only.

Evidence checklist before any correction:

1. Confirm whether this item physically returned, when, to location 1, in what condition, and whether it remains on hand; obtain signed receiving or count evidence tied to its variant.
2. Match the recorded refund to bank/wallet statement or signed cash voucher and customer acknowledgement, including actual date and amount.
3. Compare the physical count and payment proof with the two stock movements, two money transactions, sale/receipt/reversal/refund journals, and audit timestamps.
4. Determine whether the sale credit itself was valid and whether the customer has any remaining obligation.

**Conditional remediation proposal, not executed:** If no goods returned, remove the phantom stock through an auditable correction at the original ৳65,000 FIFO cost; the debit classification requires the verified business cause. If the refund was not executed but remains owed, restore the money-asset balance and recognize Customer Refund liability with a linked correcting journal. If neither was executed, both corrections may be needed. If evidence proves both events, no correction follows solely from this audit. An accountant should approve exact entries, source linkage, and before/after statements after an authorized backup. No posted historical record was edited.

## Verification and blockers

Final PostgreSQL full suite: **158 tests passed** after the account-summary formatting adjustment and inspection implementation. A focused run covering mixed FIFO layers, cross-business supplier dispatch, expired-batch inspection, reconciliation, reports and StockLocation APIs passed **45 tests**. `makemigrations --check --dry-run` and `manage.py check` found no issues. TypeScript checking and focused lint for the changed return screen and API passed. Whole-app Expo lint still reports three errors in unrelated existing `motion.tsx` and `use-color-scheme.web.ts` files.

The read-only local PostgreSQL reconciliation command returned **0 findings** for business 1 after migration `sales.0010`. There are 0 local inspection receipts awaiting a decision and 0 supplier dispatches; these new paths were exercised in isolated PostgreSQL tests. The command cannot validate physical custody or external refund execution. Android validation requires a connected device or emulator; `adb` is not installed on this host. The mobile sale, return, inspection and refund API calls are online requests; there is no durable sales/refunds SQLite outbox. Their command IDs are held in component memory during an active retry, so an app restart before server acknowledgement cannot safely replay the original command. Offline financial support and interruption recovery cannot be claimed. Production reconciliation, evidence review of the historical cancellation, and supplier financial recovery policy remain readiness blockers.
