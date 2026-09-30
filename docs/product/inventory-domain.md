# SmartStore — Inventory Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `StockItem`, `StockBalance`, `InventoryMovement`, `InventoryTransaction`, `StockCount`,
`StockAdjustment`, `StockTransfer`, `StockReservation`, `StockReceipt`, `StockIssue`.

**The governing principle of this entire document is BI-02: a stock balance is a projection of the movement
ledger, never an input.** Phase 0 finding **D-09** is the reason: a surveyed system kept a mutable integer and
could not answer "why is stock 3?". Everything below exists to make that question answerable forever.

---

## 1. Stock identity: the stock item

> A `StockItem` is **one `ProductVariant` at one `StorageLocation`**, in one currency-free unit (its base unit).

`StockItem` is a row, not a table of its own complexity: it holds the variant, the location, the store, and the
current `StockBalance` reference.

**Rule IV-01.** Stock exists **only** at a `StorageLocation`. There is no such thing as stock "at a store" or "at
a warehouse" — that is shorthand for the sum across that store's or warehouse's locations, and it is a
convenience for humans, never a stored value.

**Rule IV-02.** A `StockItem` is created implicitly on the first movement for a variant at a location. No
separate "create stock" operation exists, because a stock row with no movement behind it is precisely the defect
D-09 describes.

**Rule IV-03.** `StockItem` is never deleted. A variant/location pair with any movement history persists
forever, holding an archived balance and a full history. A variant and location combination may be marked
`Inactive` (no new stock) but retains its record.

**Rule IV-04.** Reserved and available quantities are both held on the stock item:
`OnHand` (the balance), `Reserved` (held by live reservations), and `Available = OnHand → Reserved` (derived,
never stored as a third mutable number — two stored numbers and one derivation, because three mutable numbers
will disagree).

---

## 2. The ledger

### 2.1 Two levels, deliberately separated

| Level | Entity | Purpose |
|---|---|---|
| **Transaction** (why) | `InventoryTransaction` | The business reason stock moved: "GRN-000123 received 40 against PO-000045" |
| **Movement** (what) | `InventoryMovement` | One row per item-location-quantity-delta effect |

**Why both.** A flat ledger of deltas answers "what changed" but not "why", and a document without a ledger
answer cannot be reconciled. Two levels make both questions answerable and make the document-to-ledger link
explicit, which is what BI-03 requires.

`InventoryTransaction` holds: type, the causing document and line reference, the store, the actor, the
timestamp, an optional reason code, and — when the transaction spans several movements — a group key so they
reconcile.

**Rule IV-05.** A `StockTransfer` is **one** `InventoryTransaction` group with **two** effect sets (dispatch and
receipt), so a transfer reconciles as a single business event. A sale with three lines is three movements in
**one** transaction group. The grouping is what makes "show me everything that happened for GRN-000123" a single
query.

### 2.2 Movement row

A movement records: variant, location, store, quantity (in **base units**), direction, movement type, the
transaction it belongs to, the causing document line, actor, timestamp, batch reference where applicable, and
the resulting balance after application (denormalized for fast reads and for reconciliation checks).

**Rule IV-06.** The `ResultingBalance` field is denormalized, is written in the same transaction, and exists to
make the ledger **self-checking**: for any location, walking the movements and checking that each
`ResultingBalance` equals the previous balance plus the delta is a complete integrity check of the whole history.
This is a deliberately cheap, extremely valuable audit capability.

**Rule IV-07.** A movement is never updated or deleted (BI-15). The `ResultingBalance` on a historical movement is
therefore immutable, and a rebuild from movements must reproduce it exactly.

---

## 3. Stock balance

`StockBalance` holds, per `StockItem` and per batch where batch tracking applies: `OnHand`, `Reserved`, and a
`LastMovementId` for incremental updates.

**Rule IV-08.** A balance may be written **only** by the movement-application operation, in the same transaction
as the movement (BI-02, BI-04).

**Rule IV-09 — the rebuild test is a release gate.** Full rebuild from the ledger must reproduce every balance
exactly, and must reproduce every `ResultingBalance` in the ledger. The build fails if it does not. This is the
cheapest possible proof that the ledger is authoritative, and it should run as an automated job, not on demand.

**Rule IV-10 — balance is per batch when batch tracking is on.** For a batch-tracked variant, the stock item's
balance is the **sum of its batch balances**, and the batch balance is the one that is actually maintained. A
single un-batched balance for a batch-tracked product would make FEFO impossible. See
[batch-expiry-fefo.md](batch-expiry-fefo.md).

---

## 4. Movement types — the closed enumeration

Every movement type is classified as `Conserves`, `Creates`, or `Destroys` **total organization stock**. This
classification is part of the type, is what makes BI-12 checkable, and is not decorative.

| Movement type | Class | Direction | Created by | Reversible by |
|---|---|---|---|---|
| `PURCHASE_RECEIPT` | Creates | In | Goods receipt posting | Purchase return, or a reversing adjustment |
| `PURCHASE_RETURN` | Destroys | Out | Supplier return posting | Reversing adjustment |
| `SALE` | Destroys | Out | Sale completion | Customer return, or sale void |
| `SALE_RETURN` | Creates | In | Customer return posting | Reversing adjustment |
| `ADJUSTMENT_IN` | Creates | In | Stock adjustment (increase) | Reversing adjustment |
| `ADJUSTMENT_OUT` | Destroys | Out | Stock adjustment (decrease) | Reversing adjustment |
| `TRANSFER_OUT` | Conserves | Out | Transfer dispatch | — paired with `TRANSFER_IN` |
| `TRANSFER_IN` | Conserves | In | Transfer receipt | — paired with `TRANSFER_OUT` |
| `DAMAGE` | Destroys | Out | Damage write-off, damaged disposition | Reversing adjustment |
| `EXPIRY` | Destroys | Out | Expiry write-off | Reversing adjustment |
| `LOSS` | Destroys | Out | Loss write-off, count shrinkage | Reversing adjustment |
| `FOUND` | Creates | In | Count surplus, found stock | Reversing adjustment |
| `OPENING_BALANCE` | Creates | In | Initial load, migration, validated stock import | Reversing adjustment |
| `COUNT_VARIANCE_IN` | Creates | In | Stock count posted, surplus | Reversing adjustment |
| `COUNT_VARIANCE_OUT` | Destroys | Out | Stock count posted, shrinkage | Reversing adjustment |
| `RESERVATION_HOLD` | *Not a balance change* | — | Reservation created | — see below |
| `RESERVATION_RELEASE` | *Not a balance change* | — | Reservation released or expired | — see below |
| `REVERSAL` | Opposite of the referenced type | Either | Compensating correction | Another reversal (itself checked) |

**Rule IV-11 — reservations do not move stock.** A reservation changes `Reserved`, **not** `OnHand`, and is not a
stock movement in the balance sense. It is recorded as a `StockReservation` row with hold and release timestamps,
and optionally mirrored to a movement row with a `NoBalanceEffect` flag for query convenience. A reservation
that appears to change `OnHand` breaks BI-02, because nothing physically changed.

**This is a decision worth stating plainly:** a reservation holds stock that is not sellable but is still
*present*. Someone counting the shelf sees it. Someone valuing the organization includes it. That is correct —
reserved stock is owned stock — and it is why a separate `Reserved` figure exists rather than a movement.

**Rule IV-12 — `REVERSAL` is a real type, not an edit.** A reversal movement carries a reference to the movement
it reverses. `Conserves`/`Creates`/`Destroys` are inherited from the reversed movement, inverted. Reversing an
already-reversed movement is rejected (BI-15).

**Rule IV-13 — there is no "set stock" type.** If a requirement appears to need one, it is an opening balance
(new system) or an adjustment with a reason (correction). A type that sets an absolute value would bypass the
ledger entirely.

---

## 5. What creates a movement, and who may do it

| Operation | Permission | Reason required | Approval | Notes |
|---|---|---|---|---|
| Post goods receipt | `Purchase.Receive` | Discrepancy only | Beyond tolerance | Creates `PURCHASE_RECEIPT` |
| Post supplier return | `Purchase.Return.Create` | Yes | `Purchase.Return.Approve` | Creates `PURCHASE_RETURN` |
| Complete sale | `Sale.Create` | No | No | Creates `SALE`. The highest-volume movement by far |
| Post customer return | `Return.Create` | Only if no sale reference | Beyond value threshold | Creates `SALE_RETURN` |
| Post stock adjustment | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `ADJUSTMENT_IN`/`OUT` |
| Post count variance | `Inventory.Count.Post` | Variance above tolerance | Beyond threshold | Creates `COUNT_VARIANCE_IN`/`OUT` |
| Dispatch transfer | `Inventory.Transfer.Dispatch` | No | Beyond value threshold | Creates `TRANSFER_OUT` + transit |
| Receive transfer | `Inventory.Transfer.Receive` | Discrepancy only | No | Creates `TRANSFER_IN` |
| Write off damage | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `DAMAGE` |
| Write off expiry | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `EXPIRY` |
| Record loss | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `LOSS` |
| Record found | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `FOUND` |
| Load opening balance | `Config.Organization` | **Always** | `Import.Approve` | Creates `OPENING_BALANCE` |
| Reverse any movement | `Inventory.Adjust` | **Always** | Beyond threshold | Creates `REVERSAL` |

**Rule IV-14.** A movement can only be created **by a document**, never by a direct API call. The
movement-application operation requires a document reference (BI-03). There is no "adjust stock here" endpoint.

**Rule IV-15 — a sale's movement is not a separate step.** Completing a sale writes the sale, the payments, the
movements, the balances, the audit entries, and the notification, in one transaction (BI-04). There is no window
in which a sale exists without its stock effect, and no operation that could create one.

---

## 6. Negative stock

Fully decided in [organization-model.md](organization-model.md) §3.2. The inventory-side rules:

**Rule IV-16.** The store's `AllowNegative` / `BlockNegative` policy is evaluated **inside the same transaction**
that applies the movement, against the resulting balance. It is not checked before and re-checked after — that is
the oversell race (BI-36).

**Rule IV-59 - a stockout is an event, not a number.** When a variant's available quantity at a store falls to
zero, the store raises an `OUT_OF_STOCK` notification **once**, and does not repeat it until the quantity is
restored above zero and falls again. It is a different event from the `LowStock` reorder warning (BE-20's
threshold work) and from the `NEGATIVE_STOCK` warning above: low is a prompt to buy, out-of-stock is a fact
that has already happened, and negative is a policy breach. A permanent stream of repeated stockout alerts is a
notification nobody reads, which is why the restore is the reset condition.

**Rule IV-17.** Under `AllowNegative`, a negative balance is:
- Written to the ledger, in full, like any other movement
- Reported by the `NEGATIVE_STOCK` notification at severity `Warning`
- Shown on the negative-stock report, per variant and per location
- **Never hidden, never clamped to zero.** Clamping would make the ledger lie.

**Rule IV-18.** A negative balance must be resolved. Resolution is one of: receive stock, transfer in, a
found-stock adjustment, or a write-off. Resolution requires a reason (BI-25) and the "was negative" report
tracks age, so a variant negative for 200 days is visibly a management problem.

**Rule IV-19 — no negative real-batch balance.** A specific **real** batch may not go negative even under
`AllowNegative`. Negative whole-item stock is a data lag; negative *real-batch* stock means the batch
attribution is wrong, which means FEFO and expiry reporting are wrong, which means more damage compounds.
Reject the line and flag the document.

**Rule IV-19a — the shortfall pseudo-batch is the one exception.** The designated per-variant-per-location
shortfall pseudo-batch (BE-29, BE-30) exists precisely to carry the negative balance a blocked movement would
otherwise create, and `BATCH_SHORTFALL` is raised when it is used. **The exception is a mechanism, not a
loophole**: it applies only to that one pseudo-batch, only when no real batch can cover the movement, and the
event says so. Any other negative batch balance is a defect, not a policy outcome.

**Rule IV-20.** The organization-level aggregate may be negative under `AllowNegative` (two locations, one
over- and one under-sold), and the **negative-stock report is per location**, because an organization-level
number would hide both.

---

## 7. Concurrency

**Rule IV-21.** A balance update is a **single atomic statement** that both applies the delta and returns the
resulting balance. Not read-then-write. Under any isolation level, this is correct.

**Rule IV-22.** The policy check happens on the returned value within the same transaction, so there is no window
between the check and the write.

**Rule IV-23.** For high-contention items — a promotion on a popular line, a flash sale — the balance row is
additionally protected by a row-level lock with a short, bounded timeout. On timeout, the operation fails cleanly
and the cashier is told to retry. **A lock timeout is a normal, expected outcome**, not an error to be hidden,
and the retry is safe because the operation is transactional.

**Rule IV-24.** Multi-line operations (a sale with 20 lines) acquire balance locks in a **deterministic order** —
sorted by stock item id — to prevent deadlock between two concurrent sales touching the same items in different
orders. This is not a micro-optimisation; it is a correctness requirement, and it is a classic source of
production deadlocks when omitted.

**Verification.** Concurrency test suite required before go-live: N parallel sales over a fixed item set, asserting
the ledger reconciles, no deadlock escapes, and every failure is a clean retry. See BI-36, BI-37.

---

## 8. Stock counts

### 8.1 Two kinds

| Kind | Description | Use |
|---|---|---|
| **Full count** | Every variant at a location is counted | Annual, or after a known disruption |
| **Cycle count** | A selected subset is counted, on a schedule | The default operating mode. Spreads the work |

**Rule IV-25.** A `StockCount` has a scope (a location, or a set of locations), a snapshot moment, and lines each
with `ExpectedQuantity`, `CountedQuantity`, and `Variance`.

**Rule IV-26 — the snapshot is frozen at creation.** `ExpectedQuantity` is captured when the count sheet is
**created**, not when it is counted or posted. A count sheet is therefore a statement about a specific moment,
and movements after creation appear on a **variance-since-snapshot report** rather than silently changing the
expected figure. This is what makes a count auditable: without it, a count started Friday and posted Monday
compares against a number that moved in between, and the variance is meaningless.

**Rule IV-27.** Movements during an open count are **flagged** on the count sheet, so the counter is warned "this
item moved since the count started" before counting it.

**Rule IV-28 — posting.** Posting a count creates `COUNT_VARIANCE_IN` / `COUNT_VARIANCE_OUT` movements with the
count as the transaction, a reason code per variance line, and requires `Inventory.Count.Post`. Variances within
tolerance may post automatically; beyond tolerance require approval.

**Rule IV-29 — counted quantity is never negative.** A count is an observation, and observations are
non-negative (BI-05). A negative counted quantity is a data-entry error and is rejected.

**Rule IV-30 — the count sheet is a document.** It is never edited after posting, and it is the evidence behind
every shrinkage figure in the shrinkage report. **[P0: D-09 — decided 2026-09-29; the four states are enumerated
in §8.3]** A system where shrinkage is unexplainable cannot be audited, and a count sheet that could be edited
would be worthless as evidence.

### 8.2 Blind counts

**Rule IV-31.** A full count may be run as a **blind count**: the counter is not shown `ExpectedQuantity`. The
point of cycle counting is to detect error, and showing the expected value guarantees the counter confirms it
rather than counting. The variance is still computed, and the expected quantity is revealed only after the line
is submitted.

**COULD (v1):** a configuration flag on the count, defaulting to blind for cycle counts.

### 8.3 StockCount states

**StockCount states (owner decision D-09, 2026-09-29).** This document owns exactly four states, enumerated here
from the rules above (IV-25..31; `SM-81..83`; RT-071/72/73):

| State | Meaning | Source |
|---|---|---|
| `Open` | The working, in-progress count: lines are being entered; the snapshot is frozen; movements are flagged | IV-25, IV-26, IV-27 |
| `Posted` | Posted. Variance movements written; the sheet is now an immutable document | IV-28, IV-29, IV-30 |
| `Cancelled` | Abandoned before posting; nothing was ever written | IV-25 (a sheet that never posted) |
| `Reversed` | The posted count was reversed by a compensating movement; never an edit | IV-30, SM-82 |

- **`Open` → `Posted`** is posting. It writes `COUNT_VARIANCE_IN` / `COUNT_VARIANCE_OUT` with a reason per line and
  `Inventory.Count.Post` (IV-28). **IV-28's approval requirement is an authorization/precondition of posting, not a
  separate persisted state** — there is **no `Approval` state**.
- **`Open` → `Cancelled`** is cancellation before posting. The sheet is abandoned and nothing was ever written.
- **`Posted` is immutable as a document** (IV-30). **`Posted` → `Reversed`** produces the required compensating
  movement; the posted count is never edited.
- No state is added beyond these four, and `Cancelled` is not folded into another status (owner decision D-09).

---

## 9. Stock adjustments

`StockAdjustment` is the general-purpose correction. It is the most abused operation in any inventory system, so
it is the most tightly controlled.

**Rule IV-32.** An adjustment is a **document** with a state machine (draft → pending approval → approved →
posted → reversed). It moves no stock until posted (BI-27).

**Rule IV-33.** An adjustment **always** requires a reason code from the configured list (BI-25). Not "usually".
The reason list is the single most valuable dataset in a retail system, because shrinkage analysis is only as
good as the reasons staff select.

**Rule IV-34.** Adjustments are one-directional per line: a line is an increase or a decrease, with a
non-negative quantity (BI-05). A combined "set to 42" line is not permitted, because it bypasses the ledger
(IV-13).

**Rule IV-35.** A large adjustment requires approval by a different employee (BI-26) and a threshold on **both**
absolute quantity and absolute value, whichever is exceeded first. Quantity alone is insufficient — 1 unit of a
GPU is a bigger event than 500 units of paper.

**Rule IV-36.** Adjustments are reported by reason, by actor, by location, and by value, with a
**concentration report**: a single actor or a single reason carrying an unusual share of total adjustment value
is flagged. This is the practical control on inventory theft, and it works because the data is complete.

**Rule IV-37 — no self-service adjustment.** A cashier cannot adjust stock. Ever. The permission
(`Inventory.Adjust`) is not in the Cashier or Senior Cashier templates, and this is a deliberate structural
choice rather than a matter of configuration.

**Rule IV-38.** A negative stock balance may not be "resolved" by an adjustment that increases it, where the
variant has an outstanding goods receipt. If a receipt is inbound, the resolution is to receive it. The system
surfaces pending receipts when an adjustment is raised against a negative item.

---

## 10. Stock transfers

`StockTransfer` moves stock between `StorageLocation`s **within the same organization**.

**Rule IV-39 — two-step, with real transit.** Dispatch decrements the source and increments the `Transit`
location. Receipt decrements `Transit` and increments the destination. Stock in transit is organization stock,
visible on the in-transit report, and counted in valuation (BI-13).

**Why not one-step.** A one-step transfer that dispatches and arrives atomically cannot represent a transfer that
left the building. The two-step model means a lost shipment is a **known, reportable, non-negative discrepancy**
rather than unexplained shrinkage — which is the difference between a recoverable operational problem and an
auditor's finding.

**Rule IV-40 — a transfer may cross warehouses and, in v2, stores.** Both are `TRANSFER_OUT`/`TRANSFER_IN`
pairs. In v1, cross-store transfers are disabled by configuration, not by the model.

**Rule IV-41 — the two sides must balance per line.** Quantity dispatched must eventually equal quantity
received. Discrepancies (loss in transit, damage) are recorded as a **separate reason-bearing adjustment**
against the in-transit balance, and the transfer is then closed with the discrepancy documented. A transfer may
not be closed while its in-transit balance is non-zero and unreconciled.

**Rule IV-42.** Dispatch requires `Inventory.Transfer.Dispatch`, receipt requires
`Inventory.Transfer.Receive`, and the two may be performed by different people. In practice a goods-in and a
stock-out person are the right pair; permitting the same person to do both removes the check entirely.

**Rule IV-43.** A transfer is a document with the standard state machine: `Draft → PendingApproval (if
required) → Approved → InTransit → PartiallyReceived → Received → Closed`, plus `Cancelled` (only before
dispatch).

**Rule IV-44 — transit age is monitored.** Stock in transit beyond a configured age raises a notification. A
transfer stuck in transit for three weeks is a lost shipment that nobody has noticed.

**Rule IV-45.** Batch identity is preserved across a transfer: the same batch moves, retaining its batch number,
expiry, and cost.

---

## 11. Stock reservations

`StockReservation` holds stock for a purpose — an assembly, a customer order, a layaway — so it is not sold to
someone else.

**Rule IV-46.** A reservation holds quantity against a `StockItem` (or a batch) for a stated duration, with an
expiry. `Reserved` is incremented atomically and can never exceed availability (BI-37).

**Rule IV-47.** Reservations are released on: explicit release, expiry, or consumption by the reserving
document. Release is idempotent — releasing twice changes nothing.

**Rule IV-48.** Expiry is processed by an automated job. **An expired reservation releases availability, and does
not move `OnHand`** (Rule IV-11). It is not a sale and not a movement in the balance sense.

**Rule IV-49 — no implicit reservation at the till.** A sale in progress does **not** reserve stock. This is a
deliberate decision: an implicit reservation held open by a slow cashier locks stock, expires unpredictably, and
creates a class of phantom holds that staff cannot see. The till's `AllowNegative` policy (organization-model
§3.2) is the mechanism that handles the contention instead, and it is far simpler to reason about.

Reservations exist for **explicit, dated, purposeful** holds only. If a future requirement needs soft holds at
the till, that is a new decision with its own specification, not a configuration change.

**Rule IV-50.** Reservations are reported: current holds, expiring within 24 hours, and expired-but-unreleased
items (which indicate a failed job and are actionable).

---

## 12. Stock receipt and stock issue — the generic pair

`StockReceipt` and `StockIssue` are the generic inbound/outbound documents used where a specialised flow does
not apply: a direct return from another shop, a sample, a demonstration unit, a donation out, an internal
transfer between locations that does not need the transfer workflow.

**Rule IV-51.** A generic receipt requires a **source**: `PurchaseReturn`, `CustomerReturn`, `Transfer`,
`OpeningBalance`, `Found`, or `Other` with a mandatory reason. `Other` always requires a reason code, and an
`Other` receipt is reported, because "other" is where unattributable stock enters.

**Rule IV-52.** A generic issue requires a **destination**: `Sale`, `Transfer`, `Damage`, `Loss`, `Expiry`,
`Sample`, or `Other` with a mandatory reason.

**Rule IV-53.** The specialised flows take precedence. You cannot use a generic receipt to receive a purchase —
you post a goods receipt, which creates stock and updates the PO's received quantity, and enforces the
over-receipt tolerance. A generic path that bypassed this would be a hole in BI-38.

**Decision recorded.** This is exactly the kind of "convenience" path that produces unreconciled stock. It exists
for genuinely exceptional cases, it is heavily reason-gated, and the `Other` category is reported weekly. The
specialised flows are never optional.

---

## 13. Stock valuation

Valuation is a **reporting** concern, defined in [reporting-domain.md](reporting-domain.md) §4, but the inventory
inputs are fixed here:

**Rule IV-54.** Valuation uses the **batch's actual purchase cost**, weighted across batches, per the cost policy
in [batch-expiry-fefo.md](batch-expiry-fefo.md) §7. Standard cost (`ProductCost`) is used only for variants with
no batch tracking.

**Rule IV-55.** Stock in transit is included in organization valuation, valued at its source batch cost. Excluding
it would understate inventory during any period when transfers are in flight, which is always.

**Rule IV-56.** Quarantine and damaged stock are included in valuation, and separately reportable. Writing off
damaged goods to zero value immediately would understate the loss at the moment it occurs, making the damage
report meaningless; they are valued until an explicit `DAMAGE` write-off records the loss.

**Rule IV-57.** Cost is permission-gated (`Product.Cost.View`, `Inventory.Ledger.View`). A valuation figure is
never returned to a role that cannot see cost, in a report or an export.

---

## 14. Inventory rules index

| ID | Rule |
|---|---|
| IV-01 | Stock exists only at a `StorageLocation` |
| IV-02 | A `StockItem` is created implicitly by the first movement |
| IV-03 | `StockItem` is never deleted |
| IV-04 | `Available = OnHand → Reserved`, derived not stored |
| IV-05 | One transfer, one `InventoryTransaction` group, two effect sets |
| IV-06 | `ResultingBalance` is stored, denormalized, for ledger self-checking |
| IV-07 | Movements and their `ResultingBalance` are immutable |
| IV-08 | A balance is written only alongside its movement, in one transaction |
| IV-09 | A full rebuild from the ledger must reproduce all balances — a release gate |
| IV-10 | For batch-tracked variants, balance is per batch |
| IV-11 | Reservations change `Reserved`, never `OnHand` |
| IV-12 | `REVERSAL` is a movement type referencing the movement it reverses |
| IV-13 | There is no "set stock" movement type |
| IV-14 | A movement requires a document reference. There is no direct stock-edit endpoint |
| IV-15 | A sale's movement is part of the sale's single transaction |
| IV-16 | The negative-stock policy is evaluated on the resulting balance, in-transaction |
| IV-59 | A stockout notifies once; the restore resets it |
| IV-17 | Negative balances are recorded and reported, never clamped or hidden |
| IV-18 | A negative balance must be resolved; age is tracked |
| IV-19 | A **real** batch balance may never go negative, even under `AllowNegative` |
| IV-19a | The shortfall pseudo-batch is the sole exception, and using it raises `BATCH_SHORTFALL` |
| IV-20 | The negative-stock report is per location, not per organization |
| IV-21 | A balance update is a single atomic statement returning the result |
| IV-22 | Policy check and write share one transaction |
| IV-23 | Contended items use a bounded row lock; timeout is a clean, expected failure |
| IV-24 | Multi-item operations lock in sorted stock-item order to prevent deadlock |
| IV-25 | Counts are full or cycle |
| IV-26 | `ExpectedQuantity` is frozen at count creation, not at posting |
| IV-27 | Movements during an open count are flagged on the sheet |
| IV-28 | Posting writes `COUNT_VARIANCE_*` movements, reason per line, permission + approval |
| IV-29 | Counted quantity is never negative |
| IV-30 | The count sheet is immutable after posting |
| IV-31 | Full counts may run blind; expected is revealed after submission |
| IV-32 | Adjustments are documents; no stock moves until posted |
| IV-33 | Adjustments always require a reason code |
| IV-34 | Adjustment lines are directional with non-negative quantity |
| IV-35 | Large adjustments need approval on quantity **or** value, and a different approver |
| IV-36 | Adjustments are reported by reason/actor/location/value, with a concentration report |
| IV-37 | Cashiers can never adjust stock. Structural, not configurable |
| IV-38 | A negative item with an inbound receipt is resolved by receiving, not adjusting |
| IV-39 | Transfers are two-step, through a real `Transit` location |
| IV-40 | Transfers may cross warehouses; cross-store disabled by config in v1 |
| IV-41 | Dispatched must equal received; discrepancies are separate reason-bearing adjustments |
| IV-42 | Dispatch and receipt may be performed by different people |
| IV-43 | Transfer state machine: Draft → Approved → InTransit → Received → Closed |
| IV-44 | Transit age is monitored and notified |
| IV-45 | Batch identity is preserved across a transfer |
| IV-46 | A reservation holds for a stated duration with an expiry |
| IV-47 | Reservation release is idempotent |
| IV-48 | Reservation expiry releases availability, not `OnHand` |
| IV-49 | No implicit reservation at the till. Deliberate |
| IV-50 | Reservations are reported, including expired-but-unreleased |
| IV-51 | A generic receipt requires a source; `Other` always requires a reason and is reported |
| IV-52 | A generic issue requires a destination |
| IV-53 | Specialised flows take precedence; a generic receipt cannot receive a purchase |
| IV-54 | Valuation uses batch actual cost, weighted |
| IV-55 | Stock in transit is included in valuation |
| IV-56 | Quarantine and damaged stock are valued until explicitly written off |
| IV-57 | Cost is permission-gated in every report and export |
