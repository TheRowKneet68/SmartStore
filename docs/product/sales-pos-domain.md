# SmartStore — Sales and POS Domain

**Phase 1 — Product & Domain Specification.**

Owner of: the cart, `Sale`, `SaleLine`, `PriceOverride`, `SuspendedSale`, and the completion path from scan to
receipt. Money settlement structures are in [payment-domain.md](payment-domain.md); goods coming back are in
[returns-refunds-domain.md](returns-refunds-domain.md); the stock effect is governed by
[inventory-domain.md](inventory-domain.md) IV-15.

---

## 1. The single most important structural decision

> **A `Sale` document does not exist until the sale is completed. The cart before that is not a `Sale`.**

There is no `SaleDraft` persisted as a financial document. A cart is either terminal-local state or a
`SuspendedSale` (§9), and it has no number, no ledger effect, and no financial meaning until it commits.

**Why this matters, and it is not tidiness.** If a half-finished cart were a `Sale` document, then "a finalized
sale is never edited" (BI-08) would need a definition of "finalized", and every report would need a filter for
"exclude incomplete sales" — a filter someone will eventually forget. Making the document exist only at commit
means BI-08 has no boundary case, and a `Sale` in the database is always a real sale.

**Rule SP-01.** `Sale` is created in state `Completed`, by the completion transaction (IV-15). It is never
edited afterwards (BI-08).

**This also resolves the two void permissions cleanly:**

| Permission | Applies to | Effect |
|---|---|---|
| `Sale.Void` | A **suspended, unfinalized** cart | Discards it. No ledger, no money, no stock. Nothing happened |
| `Sale.Void.Posted.Approve` | A **completed** `Sale` | Creates a **compensating void document** that reverses movements and refunds payments (BI-08, BI-09) |

The names in the permission catalogue are `Sale.Void` and `Sale.Void.Posted.Approve` (actors-and-roles §2.4). Note
for the consistency sweep: several role templates still write `Sales.*`, which is not a real permission. Those
are corrected to `Sale.*`.

---

## 2. The completion transaction — the whole sale, all at once

**Rule SP-02.** Completing a sale is **one** transaction containing: the `Sale` header, every `SaleLine`, every
resolved price, every discount application, every tax computation, every `Payment`, every `PriceOverride`, every
`SALE` inventory movement, every `StockBalance` update, the document number allocation, the customer and loyalty
entries, the `AuditEntry`, and the notification outbox row.

**Rule SP-03.** Hardware calls happen **before** the transaction and their results are passed in (BI-04, BI-32).
The order is: take payment → get the printer's acknowledgement *request* → commit the transaction → wait for the
print. A printer that dies after the commit produces a completed sale with a failed receipt and a reprint queue
entry. It never produces a rolled-back sale with the customer's money already taken.

**Rule SP-04 — device calls never happen inside the transaction.** A transaction held open across a network call
to a payment gateway is a transaction waiting to time out while holding stock locks (IV-23, IV-24).

**Rule SP-05.** The document number is allocated inside the transaction (overview §3.4, BI-42). A rolled-back
sale leaves a gap in the sequence, which is correct; a reused number is not.

---

## 3. The sale document

`Sale` holds:

| Field | Notes |
|---|---|
| `DocumentNumber` | `SAL-YYYYMM-NNNNNN`, per store, never reused (BI-42) |
| `StoreId` | Non-null. The selling store |
| `TerminalId`, `DrawerId` | Attribution. **Required** (PT-01) |
| `EmployeeId` | The cashier |
| `ShiftId` | The open shift. **Required** (BI-39) |
| `CustomerId` | **Never null.** A walk-in is a `WalkIn` customer record (customer-domain §2) |
| `BusinessDate` | The store-local calendar date (overview §3.3) |
| `CompletedAtUtc` | Server timestamp, authoritative |
| `Status` | `Completed` → `PartiallyReturned` / `Returned` / `Voided` |
| `Subtotal`, `DiscountTotal`, `TaxTotal`, `TotalDue` | Exact decimals, currency on each (BI-01) |
| `TotalTendered` | Sum of applied payments. **Not** what the customer handed over (§6) |
| `ChangeGiven` | Returned to the customer. A drawer effect, not a payment |
| `RoundingAdjustment` | Non-zero only where the store's cash-rounding applies (§5.4) |
| `ClientOperationId` | Present when originated offline. Unique with `TerminalId` (BI-28) |
| `IsOfflineOriginated`, `SyncedAtUtc` | Null while the sale exists only on a terminal |
| `SettingsSnapshot` | The store settings the totals were computed under (organization-model §3.1) |
| `ReceiptStatus` | `Printed`, `Failed`, `Reprinted` |
| `TaxModeAtSale` | `Inclusive` or `Exclusive`. Snapshotted, because it is immutable per store anyway (PR-38) |

`SaleLine` holds: line number, variant, description snapshot, quantity **in base units**, the unit sold and the
base unit, unit price as resolved, gross amount, discount amounts applied, net amount, tax rate id, tax amounts,
cost recorded at sale, batch references consumed, `SoldQuantity`, **`ReturnedQuantity`**, and weight details where
applicable.

**Rule SP-06 — every display value is snapshotted.** Description, unit name, price, tax rate, discount name, and
cost are copied onto the line. A receipt reprinted in 2029 shows the 2029 price names and the original numbers,
not a live re-render (BI-11, PR-05).

**Rule SP-07 — cost is recorded per line at sale** (BE-43). Gross margin on a sale is therefore reproducible
without re-deriving cost from a valuation policy that may have changed.

---

## 4. Scanning and item entry

**Rule SP-08 — a scan resolves to a variant, server-side.** The barcode is normalised per symbology (PR-12),
looked up organization-wide (PR-08), and the server returns the variant with its resolved price, stock position,
unit, and flags. A barcode that resolves to nothing is a **rejection with a clear message**, never a silent
no-op: a barcode that does not work is either a damaged label or the wrong item, and both need a human.

**Rule SP-09 — unknown barcode, three named outcomes, no guessing.**

| Situation | Behaviour |
|---|---|
| Not registered at all | Refuse. Offer manual search and "report a mis-scan" |
| Registered but archived | Refuse, naming the historical product. Never sell from an archived barcode (PR-10) |
| Registered, not sellable (`Hidden`, `Draft`, `Archived` variant) | Refuse, naming the status |

The system never resolves an ambiguity by guessing. If a barcode matched two variants, that is PR-08's
organization-wide uniqueness constraint having been violated, and the correct response is to refuse and report a
data integrity problem.

**Rule SP-10 — scan adds, it does not replace.** Scanning a barcode already in the cart increments its quantity
at its current price. It does not create a second line and it does not reprice it.

**Rule SP-11 — repricing on a second scan does not happen.** A quantity increase on an already-priced line uses
the line's price. If a promotional price takes effect mid-cart, the cart does not silently change under the
customer. Applying the new price requires an explicit action that is visible in the cart.

**Rule SP-12 — search results are permission-filtered, not column-filtered.** The till's product search returns
no cost field to a role without `Product.Cost.View`, because a cashier who can read cost can price-match against
any competitor (UX-14, PR-36).

---

## 5. Quantity, weight, and price at the line

### 5.1 Quantity

**Rule SP-13.** All line quantity is stored in **base units** (PR-15). A sale entered in a packaging unit
("3 boxes") converts to base units at entry and records both.

**Rule SP-14 — lossy entry is rejected** (PR-22). A cashier who types 2.5 of something countable gets a clear
refusal, not a silently rounded 2.

**Rule SP-15 — quantity is never negative** (BI-05). "Minus one" is a void or a return, never a negative line.

### 5.2 Weighted goods

**Rule SP-16 — weight sources are distinguished and recorded** (PR-27): `Scale`, `Manual`, `BarcodeEmbedded`.
The three have very different trust properties and the sale records which one produced the number.

**Rule SP-17 — a scale reading is taken from a settled reading**, not the first value. A settling scale read too
early is the single most common cause of a wrong weight at a till, and a 1.2 kg sale of a $40/kg item is a real
loss.

**Rule SP-18 — manual weight above the store threshold requires `Sale.Create` plus a reason code and is
reported** (PR-28). This is the one input a customer can influence and the cashier cannot verify, so it is
controlled on its own, separate from the general weight model.

**Rule SP-19 — a scale failure is a hard stop for a weighed line.** A weighed variant cannot be rung without a
weight from a source. It may be rung with a manual weight and a reason, never with an assumed one.

**Rule SP-20 — net weight is what is sold; gross is recorded** (PR-26). Tare is applied once, and the receipt
shows net.

### 5.3 Price

**Rule SP-21 — price resolution is server-side and follows the fixed precedence** customer group → store →
organization default (PR-30, PR-31, BI-30).

**Rule SP-22 — a price override is a `PriceOverride` record, not an edit.** It holds the variant, the original
price, the new price, the actor, the reason code, free text, and any approval. The sale line keeps the original
price; the override is a separate linked record (BI-08, BI-20).

**Rule SP-23 — below-cost requires approval by a different employee** (PR-33, BI-20, BI-26), checked at the till
because that is the only moment it is knowable.

**Rule SP-24 — an override is reported** by actor and by value. Nobody notices a margin leak by looking at one
receipt; they notice it by looking at the distribution (IV-36 shape).

### 5.4 Cash rounding

**Rule SP-25 — cash rounding is optional, per store, per currency.** Where enabled, a `RoundingAdjustment` is
recorded on the sale rather than being smeared into line prices. It is visible on the receipt and in the till
variance analysis, because unrecorded rounding is unrecorded money.

**Rule SP-26 — rounding direction favours the retailer** where a jurisdiction requires it, and the mode is a
**configured value, not a hard-coded rule**. Half-up on the money (overview §3.1) is the default; the rounding
*mode* for cash is separate and stored per organization.

---

## 6. Discounts at the till

**Rule SP-27 — the applied order is fixed and recorded on the sale** (PR-45). The order recorded on the sale makes
the total reproducible and makes "why is this total" answerable.

**Rule SP-28 — a discount is applied at application time, with approval if required** (PR-44). There is no later
moment; the goods leave the store immediately. An approval prompt at the till that a manager answers with a code
is the mechanism.

**Rule SP-29 — an over-large discount clamps at zero and is reported** (PR-42, BI-19). The customer is served and
the anomaly is visible, rather than the till showing an error while a queue waits.

**Rule SP-30 — a large discount requires `Discount.Large.Approve` by a different employee** (BI-26). The
threshold is per store and configurable (approval-workflows §3).

**Rule SP-31 — a suspended cart holds no coupon use and no discount** (PR-45 note). A parked cart is an
intention; a coupon consumed by an intention is a coupon the store never sold.

**Rule SP-32 — a loyalty redemption reduces the document total, is bounded by the available points, and is a
single line-level entry** (BI-19). Redemption never exceeds available points and is refused with the balance shown.

---

## 7. Tax at the till

**Rule SP-33 — the tax mode is a store setting** (PR-38), snapshotted on the sale. It cannot change once the
store has a sale, so every later report can rely on it.

**Rule SP-34 — inclusive mode.** The base is extracted per line and the tax derived from the rounded base
(PR-39). `gross × rate` is forbidden: it is wrong on a rounded base, and it makes the receipt disagree with the
total by a minor unit per line, which staff then "fix" by hand.

**Rule SP-35 — exclusive mode.** Tax is computed on the line's net taxable base and the line's tax is the
difference between the gross-inclusive and net figures, so both modes produce the same document shape.

**Rule SP-36 — the document tax equals the sum of the line taxes, always** (BI-18). Where inclusive-mode extraction
leaves a residual against the document total, it is assigned to the largest line deterministically (PR-41).

**Rule SP-37 — tax-inclusive receipt shows a single tax line and the gross total** (PR-41). That is the document
the customer checks, and the customer does not compute net-of-tax totals.

**Rule SP-38 — a tax-exempt customer is a zero-rate tax category, never a missing one** (PR-40).

---

## 8. Payment at the till — what a payment record means

**Rule SP-39 — a `Payment` records the amount *applied to the sale*, never the amount handed over.** Change given
is a separate drawer effect, not a payment. This one rule prevents the most common double-refund bug: a sale where
`TotalTendered` is the cash the customer actually handed over would let a later refund of "the tendered amount"
exceed what was ever kept.

**Rule SP-40 — the sum of applied payments equals `TotalDue`, or the sale has a residual.**

| Situation | Behaviour |
|---|---|
| Overpaid | Change given. `ChangeGiven` recorded; no over-payment record |
| Exact | Normal |
| Underpaid | The sale **cannot complete** as a paid sale. It becomes a **credit sale** with the shortfall on the customer's account, or is refused |
| Underpaid, no customer account | Refused. Named as an underpayment, not as a failed sale |

**Rule SP-41 — a credit sale creates an AR document and a customer ledger entry, plus a zero-value payment**
(overview §3.5). It is never represented as a payment of the full amount. The customer's balance is the real
consequence of a credit sale, and a payment record claiming money was tendered when none was would make the
statement a lie.

**Rule SP-42.** Store credit, gift cards, and loyalty-value tenders are **payment methods**, defined in
[payment-domain.md](payment-domain.md), and each has its own bound. A store-credit tender may not exceed the
customer's credit balance, bounded atomically like BI-06.

**Rule SP-43 — payment failure is a sale failure, not a payment failure.** If no payment succeeds, the sale does
not complete. The cart survives so the cashier can retry. This is why the cart is not a document (§1).

---

## 9. Suspended sales

**Rule SP-44 — a `SuspendedSale` reserves no stock, and this is deliberate.** A parked cart is an intention, not
a commitment, and it may sit for three hours. An implicit hold would lock stock for a customer who may never
return, and the phantom-hold problem that creates is worse than the double-sell it prevents. The store's
negative-stock policy (organization-model §3.2) is the mechanism that handles contention instead (IV-49).

**Rule SP-45.** A `SuspendedSale` holds: terminal, drawer, employee, the cart contents as snapshotted lines,
customer, a reason (`CustomerWaiting`, `PhoneCall`, `ForgotItem`), a wall-clock timestamp, and an expiry.

**Rule SP-46 — resuming re-resolves prices server-side** (BI-30). A resumed cart re-prices, re-checks stock, and
re-validates the customer. A cart resumed after a price change shows the new price, and if that makes the total
unaffordable the cashier and customer are told — a suspended cart is not a price guarantee.

**Rule SP-47 — a suspension is discarded, not edited.** Changing a suspended cart means resuming it, editing, and
suspending again. The audit trail is then a sequence of suspensions rather than a set of ambiguous states.

**Rule SP-48 — suspension expiry is a job, and it is reported.** A suspension past its window is
`Expired` (never deleted), and an expired-but-unrecovered suspension appears on a report with its value. That
report is also the practical way to find shrink at the till.

**Rule SP-49 — a suspension may be handed over.** Where enabled, a suspended cart can be resumed by another
cashier on the same terminal, recorded as a resumption by a different employee. Suspended carts do **not** cross
terminals in v1: a cart on a different till is a new cart, and staff learn that rather than being surprised.

---

## 10. Voids

### 10.1 Unfinalized

**Rule SP-50 — `Sale.Void` discards a `SuspendedSale`.** No document is created, no money moved, no stock moved,
and the audit entry records that a cart was discarded. There is no financial consequence to reverse, which is
exactly why this needs no approval.

**Rule SP-51 — a cashier cannot void another cashier's suspended cart** without `Sale.OfflineQueue.Manage`-class
authority. Discarding a colleague's cart is not a neutral act.

### 10.2 Posted

**Rule SP-52 — a completed sale is voided by a compensating `SaleVoid` document**, never by deletion or edit
(BI-08). It carries: the original sale, the reason code, free text, the approver (a different employee,
BI-26), the reversing movements, and the reversing payments.

**Rule SP-53 — the void reverses movements as `REVERSAL` rows referencing the original `SALE` movements** (IV-12).
No new movement type is introduced; a void is a reversal, and the ledger stays a closed enumeration.

**Rule SP-54 — the void reverses payments as linked refunds** (BI-09). A captured payment has no outgoing
transition except to a linked refund, so voiding a card sale produces a card refund, not a deleted card payment.
Cash returns to the drawer and the drawer count reflects it.

**Rule SP-55 — a void is refused while the sale has unreversed returns** (BI-41). A void reverses the sale's
stock effect; a return already added stock back. Reversing in the wrong order corrupts both. The resolution is to
reverse the returns first, then void.

**Rule SP-56 — a void is reported** by actor, value, and reason, with a concentration report, for the same reason
adjustments have one (IV-36). A void pattern is either a training problem or a theft problem, and the data to tell
them apart already exists.

---

## 11. Receipts

**Rule SP-57 — a receipt is a rendering of the finalized document, not a second source of truth.** The document
is stored; the receipt is produced from it. A receipt reprint reproduces the original numbers exactly (BI-11),
including a reprint banner so the two are distinguishable.

**Rule SP-58 — a print failure does not roll back the sale** (BI-32). The sale completes; the receipt goes to a
reprint queue; the cashier is told, once, without drama, and the customer is not left standing there while a
printer is negotiated with.

**Rule SP-59 — receipt content is per store, and certain items are mandatory**: store identity, document number,
date, the lines with prices, the tax line where tax applies, the total, payment methods, change, and the batch
number and expiry for a batch-tracked short-shelf-life variant (BE-49). A receipt that cannot be used to
reconstruct the transaction is not a receipt.

**Rule SP-60 — a receipt carries no cost, no margin, and no other customer's data.** Not a display concern: the
receipt renderer is permission-independent because it is a customer-facing document, and it has no cost fields to
omit.

---

## 12. Offline sales

**Rule SP-61 — the terminal completes the sale locally; the server confirms it later** (principle 6, BI-28). The
terminal's cached price is used for display and is labelled as unconfirmed offline.

**Rule SP-62 — the server is authoritative** for price, tax, stock, and discount (BI-30). On sync, a differing
price is recorded as an adjustment and the customer-facing truth is the server's.

**Rule SP-63 — enabling offline operation requires `AllowNegative` at that store.** **This is the resolution of
the BI-36 tension, and it is a configuration guard rather than an invariant amendment.**

**Why a guard rather than an exception.** Blocking negative stock offline and blocking it online cannot both
happen: when the terminal cannot ask, the check has nothing to check against, and a completed sale the customer
has already paid for cannot be refused at the counter. Amending BI-36 to carve out offline sync would create a
second, parallel set of stock rules — the exact complexity the invariant exists to prevent. Instead, a store that
has opted into offline operation is, by that choice, a store that tolerates a recorded negative balance. BI-36
stands unamended, and the configuration refuses an impossible combination.

**Consequences, stated plainly:**
- The v1 store default remains `AllowNegative` (organization-model §3.2), so the common case is already
  consistent.
- A store may set `BlockNegative` **only** if offline operation is disabled on all its terminals.
- Changing the negative-stock policy requires **zero unsynced transactions** and all terminals reporting online.
  Otherwise there could be a completed local sale the new policy would have refused.
- Warehouses default to `BlockNegative` and do not sell, so nothing conflicts there.
- The full treatment, including queue behaviour and conflict outcomes, is in
  [offline-pos-domain.md](offline-pos-domain.md).

**Rule SP-64 — a batch shortfall on an offline sale is absorbed by the shortfall pseudo-batch** (BE-29), never by
making a real batch negative (IV-19). This is why the pseudo-batch exists and why it is alarmed on (BE-30).

**Rule SP-65 — a sync outcome is one of `Applied`, `AppliedWithAdjustment`, `Rejected`, and a rejection requires
a reason visible to staff** (BI-31). A transaction never silently disappears from the queue.

---

## 13. Sale state machine

Full detail in [state-machines.md](state-machines.md) §5. In brief:

```
(no document)
    │ completion transaction
    ▼
Completed ──────────────▶ Voided          (SaleVoid document, approval, no unreversed returns)
    │ return(s) posted
    ▼
PartiallyReturned ───────▶ Returned        (all lines fully returned)
```

`Completed → Voided` and `Completed → PartiallyReturned → Returned` are the only paths. `PartiallyReturned →
Voided` is **refused** (SP-55). There is no `Uncompleted` and no `Pending` state, because there is no
uncompleted document (§1).

**Rule SP-66 — a sale's status is derived from its line counters, and the status is a cache of them.** The
counters `ReturnedQuantity` and `RefundedAmount` are the truth; the status is a convenience for querying. A
rebuild from the counters must reproduce the status exactly (the same rule as IV-09).

---

## 14. Reporting inputs a sale must provide

Every one of these is a reason a field exists. A sale that cannot answer these is missing something.

| Question | Field it needs |
|---|---|
| What did we sell, and to whom? | Lines, `CustomerId` |
| Who rang it, on which till, in which shift? | `EmployeeId`, `TerminalId`, `ShiftId` |
| What was the margin? | Per-line cost (SP-07) |
| What tax did we collect, and under which rates? | `TaxRateId` + amounts per line (BI-18) |
| How much cash did this till take? | `Payment` per method, linked to `ShiftId` |
| What was returned, and how much refunded? | Line counters, `Refund` documents |
| Which batch did this come from? | Batch references on the line (BE-43, BE-48) |
| Did this sale happen offline, and did it match? | `IsOfflineOriginated`, `SyncedAtUtc`, adjustment |
| Can this receipt be reproduced exactly? | Every snapshotted value (SP-06) |

---

## 15. Sales rules index

| ID | Rule |
|---|---|
| SP-01 | A `Sale` exists only once complete, born in state `Completed` |
| SP-02 | Completion is one transaction containing every effect of the sale |
| SP-03 | Hardware results are collected before the transaction; a print failure never rolls back a sale |
| SP-04 | No device call inside a transaction |
| SP-05 | The document number is allocated inside the transaction |
| SP-06 | Every display value is snapshotted onto the line |
| SP-07 | Cost is recorded per line at the moment of sale |
| SP-08 | A scan resolves to a variant server-side; a failure is a clear refusal |
| SP-09 | An unknown, archived, or unsellable barcode is refused, never guessed |
| SP-10 | A scan increments an existing line at its current price |
| SP-11 | A quantity increase never silently reprices an existing line |
| SP-12 | Search responses are permission-filtered, not column-filtered |
| SP-13 | Line quantity is stored in base units; the entered unit is recorded alongside |
| SP-14 | Lossy quantity entry is rejected |
| SP-15 | Quantity is never negative on input |
| SP-16 | Weight source is recorded and distinguishable |
| SP-17 | A scale reading is taken settled, not first-value |
| SP-18 | Manual weight above threshold needs a reason and is reported |
| SP-19 | A weighed line cannot be rung without a weight from a source |
| SP-20 | Net weight is sold; gross is recorded |
| SP-21 | Price resolution is server-side, with fixed precedence |
| SP-22 | A price override is a record, never an edit of the line price |
| SP-23 | Below-cost pricing needs approval by a different employee, at the till |
| SP-24 | Overrides are reported by actor and value |
| SP-25 | Cash rounding is per store; the adjustment is recorded, never smeared into prices |
| SP-26 | Rounding mode is configured, not hard-coded |
| SP-27 | Discount order is fixed and recorded on the sale |
| SP-28 | Discount approval happens at application time |
| SP-29 | An over-large discount clamps at zero and is reported |
| SP-30 | A large discount needs a different approver |
| SP-31 | A suspended cart consumes no coupon use and no discount |
| SP-32 | Loyalty redemption is bounded and reduces the total |
| SP-33 | Tax mode is a store setting, snapshotted per sale |
| SP-34 | Inclusive tax is extracted then derived; `gross × rate` is forbidden |
| SP-35 | Exclusive tax derives the same document shape |
| SP-36 | Document tax always equals the sum of line taxes; residuals are assigned deterministically |
| SP-37 | A tax-inclusive receipt shows one tax line and the gross total |
| SP-38 | Exempt is a zero-rate category, never a missing one |
| SP-39 | A payment records the amount **applied**, never the amount handed over |
| SP-40 | Payments must equal the total due; an underpayment is refused or becomes credit |
| SP-41 | A credit sale creates AR plus a ledger entry plus a zero-value payment |
| SP-42 | Store credit, gift, and loyalty tenders are methods with their own bounds |
| SP-43 | If no payment succeeds the sale does not complete, and the cart survives |
| SP-44 | A suspension reserves no stock. Deliberate |
| SP-45 | A suspension holds a snapshot, a reason, and an expiry |
| SP-46 | Resuming re-resolves prices, stock, and customer |
| SP-47 | A suspension is discarded, not edited |
| SP-48 | Suspension expiry is a job; expired suspensions are reported |
| SP-49 | A suspension may be handed over on the same terminal; never across terminals in v1 |
| SP-50 | `Sale.Void` discards an unfinalized cart with no financial effect |
| SP-51 | A cashier cannot void a colleague's suspended cart |
| SP-52 | A completed sale is voided by a compensating document with a different approver |
| SP-53 | A void reverses movements as `REVERSAL` rows; no new movement type |
| SP-54 | A void reverses payments as linked refunds |
| SP-55 | A void is refused while unreversed returns exist |
| SP-56 | Voids are reported by actor, value, and reason, with concentration analysis |
| SP-57 | A receipt renders the stored document; a reprint is exact and banner-marked |
| SP-58 | A print failure queues a reprint and does not block the customer |
| SP-59 | Receipt content is per store with a mandatory core |
| SP-60 | A receipt never carries cost, margin, or another customer's data |
| SP-61 | Offline sales complete locally and are confirmed by the server later |
| SP-62 | The server is authoritative; a price difference is recorded as an adjustment |
| SP-63 | **Enabling offline requires `AllowNegative`. This resolves the BI-36 tension by configuration, not by amendment** |
| SP-64 | An offline batch shortfall goes to the shortfall pseudo-batch, never a negative real batch |
| SP-65 | A sync outcome is `Applied`, `AppliedWithAdjustment`, or `Rejected` with a visible reason |
| SP-66 | A sale's status is a cache of its line counters and must rebuild exactly |
