# Domain 3 — Inventory ledger (and the batch extension)

**Phase 3 — database design.** Migration: `db/migrations/20260930150000_d3_inventory_ledger.sql`.
Conventions: [CONVENTIONS.md](CONVENTIONS.md). Previous: [D2](D2-PRODUCT-BARCODE-UNIT.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document, including the batch extension in §7 |
| **IMPLEMENTED** | The un-batched ledger: reason codes, movement types, stock adjustments, transactions, movements, balances, reconciliation |
| **TESTED** | `server/test/d3-inventory.test.ts` (41 tests) plus the schema-wide suites; 146 passing on 6 consecutive runs, including the last-unit race and a multi-worker concurrency suite |
| **Not built** | The batch extension (§7), counts, transfers, reservations and notifications (§8). No application code |

Sources: [inventory-domain.md](../product/inventory-domain.md) (`IV-01`..`IV-59`),
[batch-expiry-fefo.md](../product/batch-expiry-fefo.md) (`BE-*`), [business-invariants.md](../domain/business-invariants.md)
(`BI-02`, `BI-03`, `BI-12`, `BI-15`, `BI-27`, `BI-36`), [state-machines.md](../product/state-machines.md) §22.17,
[PHASE-2-ARCHITECTURE.md](../architecture/PHASE-2-ARCHITECTURE.md) §9 and §20 (`ADR-05`, `ADR-22`), requirements
`RT-056`..`RT-070`, `RT-074`, `RT-075`, `RT-483`..`RT-487`.

---

## 1. The write path — the one way stock changes

A balance changes **only** by inserting a movement. The application role can read `stock_balance` and nothing else
(`BI-02`, `IV-08`, `RT-056`). The balance is written by one trigger, `apply_inventory_movement()`, which runs as the
schema owner (`SECURITY DEFINER`, fixed `search_path`) and does the whole of architecture §9.2 inside the insert:

1. Validate the movement: not a service variant; the quantity fits its unit's scale (`PR-22`); Transit is reached
   only by transfers; the store may move stock at that location (`MS-16`, `D-03`); the store is not deactivated; a
   reversal mirrors what it reverses.
2. Choose the policy. A central-warehouse location is always `BlockNegative` (`WH-02`). Otherwise the policy is the
   store's settings version in force; a store with none is refused (`RT-457`).
3. **Apply the delta and read the result in one atomic statement**: `INSERT … ON CONFLICT DO UPDATE … RETURNING`
   (`IV-21`). The balance row stays locked until commit.
4. **Judge the policy on the returned value, in the same transaction** (`IV-16`, `IV-22`, `BI-36`, `RT-483`). Under
   `BlockNegative` an outbound movement that leaves the balance negative is refused (`SS011`, naming what is
   available), and the whole statement, balance included, rolls back. Under `AllowNegative` the negative is written in
   full, never clamped (`IV-17`, `RT-484`).
5. Stamp `resulting_balance` (`IV-06`) and `balance_sequence`, the movement's position in its stock item's history.

`balance_sequence` exists because `seq` is not the application order. Two concurrent transactions can draw `seq` in
one order and take the balance lock in the other. `balance_sequence` is assigned under the lock, so each stock item's
history is one gapless sequence (`UNIQUE (variant, location, balance_sequence)`), and the ledger can check itself
movement by movement.

**Deadlock avoidance** (`IV-24`): a transaction that moves several items inserts its movements sorted by
`(variant_id, storage_location_id)`. The concurrency suite runs that way and reports no deadlock. **Lock timeouts**
(`IV-23`) are set per transaction by the application (`SET LOCAL lock_timeout`), not by the schema.

## 2. Tables

| Table | Scope | Purpose | Rules |
|---|---|---|---|
| `reason_code` | organization | The reason list (overview §3.8). None seeded. Archived once; an archived code takes no new documents (`SS024`) | `BI-25`, `IV-33`, `RT-074` |
| `inventory_movement_type` | reference | 15 types, each with its fixed direction and class, plus `REVERSAL` in both directions with no class (it inherits the inverted class). No set-stock type, no reservation type | `RT-058`, `IV-11`..`IV-13`, `BI-12` |
| `stock_adjustment` | store | The correction document, with machine and numbering (§3) | `IV-32`..`IV-35`, `RT-486`, `BI-42` |
| `stock_adjustment_line` | store | Directional line, positive quantity; optional counted and system quantities as evidence | `IV-34`, `BI-05`, `UX-36`, `UX-37` |
| `inventory_transaction` | store | The business event: store, actor, server time, **business date** (computed by the server in the store's zone, `RT-234`), correlation id (`AU-10`) | `IV-05` |
| `inventory_movement` | store | The ledger (§1). Positive quantity, explicit direction, generated `delta`, `resulting_balance`, `balance_sequence` | `ADR-05`, `BI-03`, `BI-15`, `IV-06` |
| `stock_balance` | organization | The stock item: `(variant, location)`, never a store (`MS-17`, `D-03`), with `on_hand` and `movement_count`. Created by the first movement (`IV-02`) | `BI-02`, `RT-056`, `RT-057` |

**Every movement names its cause** (`BI-03`, `RT-060`): a transaction (non-null FK) and exactly one document line
(`ck_inventory_movement_one_cause`, which later domains extend with their line columns). The line FK is composite,
`(line, document, variant, location)`, so a movement cannot apply one line's cause to another variant or location. A
reversal names the same line as what it reverses, proven by a composite FK back into the ledger. `BI-03` holds for
reversals too.

**Append-only at every privilege** (`BI-15`, `RT-059`). The application has no `UPDATE` or `DELETE` on movements or
transactions, and a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` even for the schema owner (`SS010`). Only
DDL (disabling the trigger) or a superuser gets past it. That is the documented limit, and the reconciliation below
would report the result.

**Reversal** (`IV-12`, `RT-062`): a new `REVERSAL` movement referencing the original, opposite in direction, equal in
store, variant, location and quantity (`SS015`). `UNIQUE (reverses_movement_id)` refuses a second reversal of the same
movement. A reversal may itself be reversed.

## 3. The stock adjustment document (state-machines §22.17)

Machine `StockAdjustment`, as data (D2 §2): `Draft→PendingApproval` (submit), `PendingApproval→Approved` (approve),
`Approved→Posted` (post), `Draft→Cancelled` (cancel), `Posted→Reversed` (reverse).

- Created `Draft` with a **server-allocated document number** (`BI-42`) and a **reason code, always** (`IV-33`,
  `RT-074`). Kind `Adjustment` writes `ADJUSTMENT_IN`/`_OUT`, `DAMAGE`, `EXPIRY`, `LOSS` or `FOUND` lines. Kind
  `OpeningBalance` writes only `OPENING_BALANCE` (`IV-13`).
- **Lines change only in Draft** (`SS018`), and a never-submitted draft line may be deleted: the one `DELETE` the
  schema grants (overview §3.6). The check takes `FOR SHARE` on the adjustment, so a line cannot slip in during
  submission.
- **Separation of duties** (`BI-26`, `RT-075`, `IV-35`): `approved_by <> submitted_by` is a `CHECK`, a data
  constraint on the decision (architecture §8.6). Who submitted and who approved are written once (`SS001`), and each
  transition is stamped with server time.
- **Stock moves only when posted** (`BI-27`, `RT-486`). A movement for an adjustment is accepted only while it is
  `Posted` (or `Reversed`, for reversals) and only with its line's type (`SS016`). At commit, a posted adjustment must
  have written exactly its lines, and a reversed one must have compensated every movement (`SS022`). A line is applied
  at most once (a partial unique index). Posting is therefore all or nothing and cannot be repeated.
- **Approval is always taken.** The contract has no edge from `Draft` to `Posted`, so every adjustment, and every
  opening balance, needs a second person. Inventory-domain §5 says approval applies only "beyond threshold", and no
  threshold is configured anywhere. Also, the contract has no way out of `PendingApproval` or `Approved` except
  forward. Both points are **OQ-013**; each fix is one edge row.
- **The opening balance vehicle.** `data-import.md` loads opening stock through an import job, which is outside the v1
  slice. v1 uses an `OpeningBalance`-kind adjustment instead. It writes the same `OPENING_BALANCE` movement type, needs
  a reason, and takes approval. The application maps its edges to `Config.Organization` and `Import.Approve`
  (inventory-domain §5). This is a design choice made to keep the specified permissions and ledger shape, and it is
  reversible.

## 4. Reconciliation (`IV-09`, `ADR-22`)

`inventory_ledger_drift()` rebuilds every balance from the ledger and walks every `resulting_balance` chain. It returns
each disagreement: a balance that differs from the sum of its movements, a movement count that differs, or a chain
break or gap. It **never repairs**: an empty result is the proof, and anything else is an alert. The scheduled job
that runs it and raises the alert is application work (Step 3). The rebuild test is a release gate (`IV-09`); the
suite runs it after every workload.

## 5. Guards closed from earlier domains

| Rule | Closed by |
|---|---|
| `ORG-05`, `RT-445`, `EC-39`: no store deactivation while its own locations hold stock (`SS019`) | `tg_store_deactivation_stock` |
| A deactivated store moves no stock (`SS020`) | `apply_inventory_movement()` |
| `WH-02`: a central location never goes negative | `apply_inventory_movement()` |
| `MS-16`, `MS-19`, `D-03`: a movement's store is the location's own store or an attributed one (`SS014`) | `apply_inventory_movement()` |
| `PR-14`, `RT-491`: a used unit's quantity kind is frozen, naming the first use (`SS021`) | `tg_unit_quantity_kind` |
| "Service cannot be stocked" (product-domain §6.1) (`SS012`) | `apply_inventory_movement()` |

Still pending: `WH-01`/`RT-004` for sale lines (domain 4); `ORG-05` open shifts (domain 4); `ORG-01`/`ORG-02` with the
first financial document (domain 4). A stock adjustment is a stock document, not a financial one.

## 6. Tests — what proves what

| Rule | Proven by (`d3-inventory.test.ts`) |
|---|---|
| `RT-058`, `BI-12`, `IV-11`, `IV-13` | The 17 rows and their classes; no set-stock or reservation type; an unlisted type (`23514`) and a wrong direction (`23503`) are refused; the application cannot extend the list |
| `BI-02`, `RT-056` | The application cannot insert, update or delete a balance |
| `IV-06`, `IV-21` | Resulting balances 10, 7, 8 at sequences 1, 2, 3 |
| `RT-061`, `BI-04` | A failure after the balance write (a bad transaction id) leaves no movement and an unchanged balance |
| `RT-059`, `BI-15` | Application: `UPDATE`/`DELETE` `42501`. Owner: `UPDATE`, `DELETE`, `TRUNCATE` all `SS010`. Transactions too |
| `RT-060`, `BI-03` | A movement with no line is refused; zero orphans across the ledger |
| `RT-062`, `IV-12`, `BI-15` | A reversal links and opposes; a second reversal refused (`23505`); a non-mirroring reversal refused (`SS015`) |
| `IV-17`, `RT-484` | Under `AllowNegative`: −3, written in full, and the ledger reconciles |
| `IV-16`, `RT-483` | Under `BlockNegative`: refused, balance unchanged; exactly to zero allowed; the policy in force at the time applies |
| `WH-02` | A central location refuses a negative even when the store allows one |
| **`BI-36`, `RT-067`** | **8 concurrent one-unit losses against 1 on hand, 15 times: exactly 1 success and 7 refusals every run** under `BlockNegative`; all 8 succeed with −7 recorded under `AllowNegative`; the ledger reconciles in both |
| `IV-20`, `RT-068` | Negatives are reported per location while the organization total nets to zero |
| **`IV-21`..`IV-24`, inventory §7** | **6 workers × 12 multi-line adjustments over 5 locations in random line order**: no failure, no deadlock, totals exact, zero drift |
| `IV-09`, `ADR-22` | Zero drift after a mixed workload; a corrupted balance is reported and not repaired; a rewritten resulting balance is reported as a chain break |
| `IV-32`..`IV-35`, `RT-074`, `RT-075`, `RT-486`, `BI-26`, `BI-27`, `BI-42` | Numbering; reason required; archived reason refused; lines frozen after Draft; the submitter cannot approve; no path skips approval; nothing moves before posting; incomplete posting and incomplete reversal fail at commit; a line applies once; cancel is terminal; the counted-line evidence is consistent; opening-balance lines are typed |
| `MS-16`, `D-03`, `PR-14`, `PR-22`, `ORG-05`, `BI-14` | Each §5 guard; foreign variant and location refused |

**Mutation check (2026-09-30).** Each of these turned its test red: skipping the `BlockNegative` refusal; dropping
movement immutability; granting the application `UPDATE` on balances; dropping the posting-completeness check; a drift
check that sees nothing; and dropping the central-location attribution check.

**Not yet verified:** `BI-36`'s requirement (b), "a matching notification", waits for notifications (§8). The negative
itself is written and reportable now.

## 7. The batch extension — designed, deferred

Batches are created by goods receipts (`BE-13`, `BE-15`), carry the actual invoice cost (`BE-14`), and are unique per
supplier (`BE-05`). Procurement is outside the v1 slice, so v1 variants are un-batched. The extension is **purely
additive**: nothing above changes shape.

- `product_variant.is_batch_tracked boolean NOT NULL DEFAULT false`. It is frozen once the variant has any movement
  (`BE-02`), by a trigger like `tg_unit_quantity_kind`.
- `stock_batch`: `organization_id`, `store_id` (the receiving store, `MS-19`), `variant_id`, `storage_location_id`
  (one location at a time, `BE-06`), `supplier_id`, `batch_number`, `manufacturing_date`, `expiry_date` (a `date`,
  `BE-04`), `received_date`, `purchase_cost` + currency (immutable once consumed, `BE-44`), `original_quantity`,
  `remaining_quantity`, `status`, `is_shortfall`, and the creating receipt line (`BE-13`).
  - `remaining_quantity >= 0 OR is_shortfall` (`IV-19`, `RT-065`); one shortfall pseudo-batch per variant and location
    (`IV-19a`, `RT-066`), by a partial unique index.
  - Batch-number uniqueness is per supplier. `BE-05` says `(SupplierId, BatchNumber)`, but the §2 table says "per
    supplier per variant". That discrepancy is to be settled when the table is built.
- `inventory_movement.batch_id` (nullable FK). It is required exactly when the variant is batch-tracked.
  `apply_inventory_movement()` then also applies the delta to `stock_batch.remaining_quantity` in the same statement
  pattern, refusing a real batch going negative. `stock_balance` stays the item total. The drift check gains
  "`remaining_quantity` = sum of the batch's movements", and "item total = sum of its batches".
- FEFO (`BE-25`..`BE-35`) is allocation logic at issue time: lock candidate batches in a deterministic order, sort by
  `expiry_date ASC NULLS LAST, received_date`, and consume greedily. Any shortfall under `AllowNegative` goes to the
  pseudo-batch with a `BATCH_SHORTFALL` event (`BE-29`, `BE-30`). A sale line then records the cost of the batches it
  consumed (`BE-43`).
- `ck_inventory_movement_one_cause` and the line unique index relax for FEFO splits: one line may produce several
  movements, one per batch. The posting check already sums quantities per line, so it holds unchanged.

## 8. Deferred, and recorded in BUILD-STATUS

Stock counts (`IV-25`..`IV-31`; v1 corrects stock with counted-quantity adjustment lines, `UX-36`/`UX-37`); transfers
and the Transit flow (`IV-39`..`IV-45`); reservations (`IV-46`..`IV-50`; the till reserves nothing, `IV-49`); the
generic receipt and issue (`IV-51`..`IV-53`); import jobs (`PR-51`..`PR-55`); the `NEGATIVE_STOCK`, `OUT_OF_STOCK` and
`BATCH_SHORTFALL` notifications (`IV-17`, `IV-59`, `BE-30`); and `IV-38` / `RT-069` (resolve by receiving), which needs
goods receipts.
