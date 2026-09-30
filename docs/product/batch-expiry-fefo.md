# SmartStore — Batch, Expiry, and FEFO

**Phase 1 — Product & Domain Specification.**

Owner of: `StockBatch`, expiry rules, FEFO allocation, FEFO override, quarantine and damaged stock, and the
valuation cost policy. `StockBalance` and `InventoryMovement` are owned by [inventory-domain.md](inventory-domain.md);
this document specifies the batch dimension of both.

---

## 1. When batch tracking applies

`ProductVariant.IsBatchTracked` is a variant-level flag. It is **not** a category setting, because the same
category routinely mixes tracked and untracked goods — a pharmacy's supplements are tracked, its batteries are not.

**Rule BE-01.** A batch-tracked variant's stock is held **per batch**. Its stock item's `OnHand` is the sum of
its batch balances; the batch balance is what is maintained (IV-10).

**Rule BE-02.** `IsBatchTracked` is **immutable once the variant has any movement.** Switching a tracked product
to untracked would silently merge batches and destroy the expiry position. Switching an untracked product to
tracked requires an **opening stock conversion**: a documented operation that creates an initial batch per
location from the existing balance, with a reason. This is deliberate friction: a mid-life tracking change is a
data migration, and pretending otherwise is how stock becomes unaccountable.

**Rule BE-03 — expiry tracking is separable from batch tracking in one direction only.** A variant may be
batch-tracked **without** expiry dates (hardware, fasteners — batches are tracked for costing or serialisation
but nothing expires). A variant may **never** have expiry dates without being batch-tracked, because an expiry
date with nowhere to store the expiry-date-specific balance is meaningless.

**Rule BE-04.** Expiry dates are stored as a **date**, not a timestamp, and a batch with no expiry date is
permitted (per BE-03). A batch is never "expiring at midnight" — the business date governs (overview §3.3).

---

## 2. The batch

`StockBatch` holds:

| Field | Notes |
|---|---|
| `BatchNumber` | The supplier's number. **Unique per supplier per variant**, not organization-wide |
| `SupplierId` | The supplier it was received from |
| `ProductVariantId` | What it is |
| `LocationId` | Where it is held now. **Changes on transfer** |
| `ManufacturingDate` | Optional. Many suppliers do not provide it |
| `ExpiryDate` | Optional per BE-03 |
| `ReceivedDate` | When SmartStore received it. Always known |
| `PurchaseCost` | Per unit, in the base unit, in the organization's currency. **The actual cost** |
| `OriginalQuantity` | Quantity as received, in base units |
| `RemainingQuantity` | The current balance. Maintained transactionally |
| `Status` | `Active`, `Expired`, `Quarantined`, `Depleted`, `Blocked` |
| `SupplierInvoiceRef` | Traceability to the supplier's paperwork |

**Rule BE-05 — batch numbers are scoped to the supplier, not the organization.** Two suppliers both using batch
`20240115` is normal. Making the number organization-unique would force artificial prefixes and defeat the point
of recording the supplier's own reference. Uniqueness is enforced on `(SupplierId, BatchNumber)`.

**Rule BE-06 — a batch may hold stock at only one location at a time.** A batch moved to another location is the
same batch with an updated `LocationId` and a movement; it is not a new batch. This keeps "where is batch X"
answerable with one query, which is the whole point of tracking batches.

**Rule BE-07.** A depleted batch (`RemainingQuantity` = 0) is retained with status `Depleted`. It is excluded
from FEFO and from stock reports, and it remains as the record of what was received and sold. **[P0: D-09]**
Deleting depleted batches is how traceability dies.

**Rule BE-08.** A batch may not be deleted under any circumstance. It is archived.

**Rule BE-09 — barcode on a batch.** Where a supplier or a store uses per-batch barcodes (common in
pharmacy and electronics), the batch carries an optional `ProductBarcode` on the **batch**, not the variant. A
scan of a batch barcode resolves to a specific batch of a specific variant. This is a distinct concept from
PR-08 and does not violate it: a batch barcode is unique among batch barcodes, and cannot collide with a variant
barcode because the namespace is checked at registration.

---

## 3. Receiving a batch

Batch data is captured on the **goods receipt line**, because that is where the supplier's information arrives
and where an error is cheapest to catch.

**Rule BE-10.** On receipt of a batch-tracked variant, the receiving operator **must** provide, when the
information is available: batch number, expiry date, and manufacturing date. Missing information is a warning,
not an automatic rejection — real supply chains have incomplete paperwork, and refusing the delivery creates a
problem worse than the one being solved.

**Rule BE-11 — expiry validation at receipt.** A batch received already expired is **refused by default** and
may be accepted only into a non-sellable location, with `Return.Dispose` and a reason. Configurable per store.
Goods arriving expired are a supplier failure, and the correct action is to record them where they cannot be
sold, not to add them to sellable stock and hope someone notices.

**Rule BE-12.** A batch received with an expiry date **before** today, under a store configured to allow
expired goods into sellable stock, still writes an `EXPIRY` notification at severity `Error`. The store has
chosen to accept it; the system has recorded that it happened.

**Rule BE-13 — one receipt line, one batch.** A receipt line may create exactly one batch. Receiving two batches
of the same variant on one line is two lines. This is what makes a batch's cost and quantity unambiguous.

**Rule BE-14 — cost is per batch and may differ from the PO.** A receipt records the **actual** unit cost from
the supplier's invoice, which may differ from the PO price. The variance is recorded and reported (three-way
match, [procurement-domain.md](procurement-domain.md) §8). A receipt may not silently adopt the PO price when the
invoice says otherwise, because that is how a margin leak becomes permanent.

**Rule BE-15.** A receipt creates `PURCHASE_RECEIPT` movements against the specific batch, and the batch's
`RemainingQuantity` is set. A receipt never writes to an un-batched balance for a tracked variant.

---

## 4. Expiry

### 4.1 Status is derived, not stored as truth

`StockBatch.Status` is a **cached derivation** from `ExpiryDate` and the current business date, refreshed by a
scheduled job and on every read that matters.

**Rule BE-16 — expiry is a business-date comparison, not a timestamp comparison.** A batch with
`ExpiryDate = 2026-03-15` is:
- **Not expired** on 2026-03-15 — it is usable through the end of that day
- **Expired** from 2026-03-16

**Rule BE-17.** "Expiry date" almost always means "usable until the end of this date". A system that expires
stock at 00:00 on the printed date throws away sellable goods and frustrates staff. The end-of-day reading is the
industry norm and is encoded once, here, so every report agrees.

**Rule BE-18.** A batch with a null `ExpiryDate` is **never** expired and never appears on an expiry report. It
appears on a "batches with no expiry data" report instead, because missing expiry data on a perishable is itself
a finding.

### 4.2 Expiry windows

| Window | Definition | Purpose |
|---|---|---|
| `Expired` | Business date > `ExpiryDate` | Blocked from sale when expiry blocking is on |
| `NearExpiry` | `ExpiryDate` − today ≤ configured window (default 30 days, per store) | Prompt action; drives FEFO and discounting |
| `ShortDated` | A second, tighter window (default 7 days) | Escalation and manager attention |

**Rule BE-19.** The windows are per store, not per organization, because shelf-life expectations differ (a
pharmacy's near-expiry window is not a hardware store's). The `ShortDated` window is always **shorter** than
`NearExpiry`; a configuration where it is not is rejected.

**Rule BE-20.** A near-expiry batch raises a `NEAR_EXPIRY` notification once per window entry, **not** per
re-read. Repeated notification on every scan trains staff to ignore notifications, which destroys the channel.

**Rule BE-21.** Near-expiry stock is **not** blocked. It is prioritised by FEFO, surfaced on reports, and may be
marked down. Blocking near-expiry stock throws away money for no safety benefit; blocking *expired* stock is a
different matter and is store-configurable.

### 4.3 Expiry write-off

**Rule BE-22.** Expiry removes stock through an explicit `EXPIRY` write-off: a reason-coded, permissioned,
approval-bearing adjustment (IV-33, IV-35). Stock does not vanish because a date passed.

**Rule BE-23 — a scheduled job proposes, it does not decide.** A job identifies expired batches with remaining
stock and raises a `BATCH_EXPIRED` notification with a **pre-filled write-off proposal**. A human approves it.
Automatic expiry write-off is available per store as a setting, and when enabled the job writes `EXPIRY` movements
with reason `Expired` and its own system actor. Either way the movement exists and the loss is attributed.
`BATCH_EXPIRED` is a separate event from `NEAR_EXPIRY` (BE-20): the first reports that the window has closed,
the second asks a human to act before it does.

**This is a real trade-off, and it is worth stating.** Automatic write-off saves staff work. Manual proposal
catches the case where expired stock is *still on the shelf and still selling* — which is a bigger problem than
the write-off. **v1 default is manual proposal**, because that case is real and expensive, and the labour is a
few clicks per day.

**Rule BE-24.** Expired stock in a non-sellable `ExpiredHold` or `Damaged` location is not written off
automatically, because it is not being sold and is not at risk. Only **sellable** expired stock needs a write-off.

---

## 5. FEFO — First Expiry, First Out

### 5.1 What it is

When selling a batch-tracked variant, FEFO selects the batch with the **earliest expiry date among batches with
stock**. Not the oldest, not the cheapest, not the first received — the soonest to expire.

**Rule BE-25 — FEFO is a selection, not a rule the user must remember.** The till does not present a batch list
by default. It allocates automatically. Presenting a batch picker to a cashier selling milk is a usability
failure and an operational risk.

### 5.2 When FEFO is applied

| Situation | FEFO applied? |
|---|---|
| Sale of a batch-tracked variant, at a sellable location, expiry blocking off | **Yes, automatically** |
| Sale of a batch-tracked variant, expiry blocking on | **Yes** — but expired batches are excluded, so FEFO effectively becomes FEFO-among-valid |
| Sale of a batch-tracked variant, near-expiry batches exist | **Yes** — the near-expiry batch is chosen, which is the entire point |
| Sale of a non-batch-tracked variant | Not applicable. Single implicit balance |
| Stock issue, transfer dispatch, count variance | **Yes** — same allocation, so a count shortage is charged to the soonest-expiring batch |
| Purchase order | **No** |
| Customer return | **No** — see §8 |

**Rule BE-26 — FEFO applies to every stock issue, not just sales.** Applying it only at the till means a
warehouse pick or a transfer takes whatever is convenient and leaves the short-dated batch to expire. Every
depletion of a tracked batch should consume the soonest-expiring one.

**Rule BE-27 — batches with no expiry date sort last, not first.** A batch with unknown expiry is the *worst*
candidate for remaining in stock, not the best. Sorting nulls first would drain the unknown batches and leave
known-good stock to expire. Nulls sort **after** all dated batches.

**Rule BE-28 — depleted and blocked batches are excluded** from FEFO consideration entirely.

### 5.3 The allocation algorithm

```
For a line of variant V, quantity Q, at sellable location L, under policy P:

1. Exclude batches with RemainingQuantity = 0
2. Exclude batches whose status is Quarantined or Blocked
3. If P.BlockExpired: exclude batches with ExpiryDate < today (business date)
4. Sort remaining by: ExpiryDate ASC NULLS LAST, then ExpiryDate IS NULL, then ReceivedDate ASC
5. Allocate Q greedily across the sorted list, creating one movement per batch consumed
6. If the total available < Q:
   a. Under BlockNegative (P = Block): refuse the line with the available quantity named
   b. Under AllowNegative (P = Allow): allocate what exists, then post the shortfall as
      a single movement against the variant's un-batched shortfall at L
7. Record FEFOOverride on any line where the operator chose otherwise
```

**Rule BE-29 — step 6b is stated explicitly because it is the subtle part.** Under `AllowNegative` with
batch-tracking and an FEFO shortfall, stock must go somewhere. The shortfall is posted as a single movement
against a designated **shortfall pseudo-batch** at that location — not spread arbitrarily across real batches,
which would corrupt every real batch's remaining quantity and its expiry accounting.

**Rule BE-30 — the shortfall pseudo-batch is visible and alarming.** It is named in the negative-stock report and
raises a `BATCH_SHORTFALL` notification at `Error` severity. Its existence means "we sold stock we could not
attribute to a batch", which is a data-quality incident requiring investigation, not a quiet balancing figure.

### 5.4 Override

**Rule BE-31 — a cashier may not override FEFO.** The permission `Inventory.FEFOOverride` is not in the Cashier
or Senior Cashier templates. This is structural, not configurable (IV-37 pattern).

**Rule BE-32.** An override requires a **reason code** and records the batches that were available and the batch
chosen, so the decision is reviewable after the fact. A common reason is `CustomerRequestedOtherBatch` — real
and legitimate, and a gift for someone buying two packs of the same yoghurt and preferring the later date.

**Rule BE-33.** A valid reason is not a rubber stamp. A distribution report of overrides by actor and reason
exists, on the same principle as IV-36. An operator overriding FEFO on most transactions is a problem whether
or not they selected a reason.

**Rule BE-34 — override cannot violate expiry blocking.** With expiry blocking on, an expired batch cannot be
selected by override, by anyone, for any reason. The override applies *within* the eligible set. Safety settings
are not overrideable; this is a hard rule with no permission path.

**Rule BE-35.** An override on a large-value sale follows the store's approval policy, like a large discount.
Taking the last unit of a high-value batch deliberately is a value-relevant act.

---

## 6. Quarantine and damaged stock

Four dispositions, all in [inventory-domain.md](inventory-domain.md) §4 (movement types), §9 (adjustments and
write-offs), and §10 (transfers), and in [returns-refunds-domain.md](returns-refunds-domain.md):

| Disposition | Location | Sellable | Value | Released by |
|---|---|---|---|---|
| `Sellable` | Sellable location | Yes | Yes | Immediately |
| `Quarantine` | `Quarantine` location | **No** | **Yes** | `Return.Dispose` after inspection |
| `Damaged` | `Damaged` location | No | Yes, until written off | `Inventory.Adjust` write-off |
| `Expired` | `ExpiredHold` location | No | Yes, until written off | `Inventory.Adjust` write-off |

**Rule BE-36.** Every disposition writes a movement, and every movement names its disposition as the reason.
There is no "the goods are back" state that is not one of these four.

**Rule BE-37 — quarantine stock is valued and aged.** It is not written off on entry, because writing off on
entry destroys the ability to see how much is being quarantined and why. It ages, it is reported, and it is
released or written off deliberately.

**Rule BE-38 — quarantine release creates a movement.** Moving goods from `Quarantine` to a sellable location
is a `TRANSFER`-class movement within the organization with reason `QuarantineRelease`, so the goods' history
includes the quarantine period and the inspection decision.

**Rule BE-39.** Quarantined stock may be **consumed** (sold to staff, written off, disposed) but never sold to
customers. Staff consumption is an explicit, reasoned, reported issue.

---

## 7. Cost and valuation

**Rule BE-40 — two costs, never conflated.** `StockBatch.PurchaseCost` is what was actually paid for that batch.
`ProductVariant.ProductCost` is the standard cost for margin analysis. They differ whenever a purchase price moves
— which is always — and conflating them makes margin wrong. (PR-35.)

**Rule BE-41 — valuation policy is explicit and configured.** For a batch-tracked variant:

| Policy | Method | Best for |
|---|---|---|
| `WeightedAverage` (default) | Total cost ÷ total quantity, across all batches at a location | Most retail; smooths price variance |
| `FIFO` | Value from the oldest batches first | Matches physical flow; useful with long shelf life |
| `LastCost` | Most recent batch cost | Simple; volatile; **not recommended for reporting** |

`WeightedAverage` is the v1 default. `FIFO` is available because it is the expected answer for a hardware store
with serialised stock. `LastCost` exists and is documented as unsuitable for margin reporting.

**Rule BE-42 — the policy is applied at valuation time, not maintained as a running total.** A running
weighted-average cost is a mutable derived value, and by BI-02's logic a derived value that drifts is a defect.
Recomputing on demand is slower and always correct. Where speed matters, the computed value is a cache that can
be discarded and rebuilt, and it is never authoritative.

**Rule BE-43 — margin on a sale uses the batch's actual cost.** A sale line records the cost of the batch it
consumed at the moment of sale. When FEFO splits a sale across three batches, the line's cost is the sum of the
three portions. A later revaluation does not change a historical sale's recorded margin, and gross-margin
reporting is therefore reproducible (BI-11).

**Rule BE-44 — historical cost is never restated.** A purchase price correction creates a **credit note or a
reversal**, not a rewrite of the batch's cost. A batch's `PurchaseCost` is immutable once the batch has been
consumed by a sale (BI-08).

---

## 8. Returns and batches

**Rule BE-45 — a customer return does not guess a batch.** The returner records which batch the goods came from
when it is known — by scanning a batch barcode, or by the original sale line. The system offers the batch(es) the
original sale consumed as a suggestion.

**Rule BE-46 — an unattributable return into a tracked variant goes to quarantine, not to sellable stock.** A
return of a batch-tracked product where the batch cannot be established creates no batch-level movement, because
there is no batch to move. It is received into `Quarantine` as a **generic receipt** with reason
`CustomerReturnUnattributed`, and the store resolves it by inspection.

**Why this rule exists.** Assigning a returned batch to the "oldest" batch, or to the last-sold batch, silently
corrupts the expiry position of a real batch. A product with the wrong expiry date is sold to a customer; in
pharmacy-adjacent retail that is a safety matter, and everywhere it is a data-integrity matter.

**Rule BE-47.** A return against an original sale line **inherits the cost** of what was sold, so a refund and a
restock are consistent. A goodwill return has no cost basis; it is valued at current standard cost and flagged.

---

## 9. Serialised stock — COULD, and its boundary

Serial-number tracking is a real requirement for electronics, hardware, and pharmacy. It is **not** in v1 scope,
because it is a third quantity dimension on top of batch and it changes the model at the root.

**Design note for the eventual implementation, so v1 does not paint itself into a corner:** serialisation should
be a `StockItem`-level attribute of a `ProductVariant` (`IsSerialised`), exactly parallel to `IsBatchTracked`,
with a `SerialisedUnit` entity whose identity is the serial number and whose lifecycle mirrors a batch's
(remaining = 1 or 0, location, status). Because a serialised unit is *structurally* a batch with
`OriginalQuantity = 1`, implementing it later means adding a narrow specialisation rather than redesigning
stock. **v1's job is to not prevent it**, which `IsSerialised` absent but `IsBatchTracked` present achieves.

If serialisation is confirmed as a v1 requirement for a specific customer, it moves to MUST and this document is
revised before implementation — not improvised during it.

---

## 10. Serial numbers in the receipt and history

**Rule BE-48.** Where a variant is batch-tracked, the **receipt line and the sale line both record the batch
number**. This is what makes a consumer complaint ("this expired, you sold it to me") answerable: the batch is on
the paper. A system that tracks batches internally but prints nothing is tracking batches for its own
convenience.

**Rule BE-49.** The expiry date is printed on the receipt line for a batch-tracked variant with a short shelf
life, configurable by store. Whether to print it is a store decision; whether the system *knows* it is not.

---

## 11. Batch rules index

| ID | Rule |
|---|---|
| BE-01 | A batch-tracked variant's stock is held per batch |
| BE-02 | `IsBatchTracked` is immutable once moved. Untracked → tracked needs an opening conversion |
| BE-03 | Batch tracking without expiry is allowed; expiry without batch tracking is not |
| BE-04 | Expiry is a date; a null expiry is normal and never "expired" |
| BE-05 | Batch numbers are unique per supplier, not per organization |
| BE-06 | A batch holds stock at one location; a move updates the location |
| BE-07 | A depleted batch is retained as `Depleted` |
| BE-08 | A batch is never deleted |
| BE-09 | A batch may carry its own barcode, in a separate namespace |
| BE-10 | Receipt captures batch number and dates; missing data warns rather than blocks |
| BE-11 | Already-expired goods are refused, or accepted only non-sellable with a reason |
| BE-12 | Accepting expired goods still raises an `Error` notification |
| BE-13 | One receipt line creates exactly one batch |
| BE-14 | Receipt records actual invoice cost; a PO price is never silently adopted |
| BE-15 | A receipt writes batch-level `PURCHASE_RECEIPT` movements only |
| BE-16 | `Status` is a cached derivation from expiry and the business date |
| BE-17 | A batch is usable **through the end** of its expiry date |
| BE-18 | A null expiry is never expired and appears on a missing-data report |
| BE-19 | Expiry windows are per store; `ShortDated` < `NearExpiry` is enforced |
| BE-20 | A near-expiry notification fires once per window entry |
| BE-21 | Near-expiry stock is prioritised and reported, never blocked |
| BE-22 | Expiry is a reason-coded, approval-bearing write-off, not an automatic disappearance |
| BE-23 | The expiry job **proposes** write-offs; a human approves (v1 default) |
| BE-24 | Only **sellable** expired stock needs a write-off |
| BE-25 | FEFO allocates automatically; no batch picker is shown by default |
| BE-26 | FEFO applies to every stock depletion, not just sales |
| BE-27 | Batches with no expiry sort **last** |
| BE-28 | Depleted, quarantined, and blocked batches are excluded from FEFO |
| BE-29 | An FEFO shortfall under `AllowNegative` posts to a visible shortfall pseudo-batch |
| BE-30 | The shortfall pseudo-batch raises a `BATCH_SHORTFALL` `Error` and is reported |
| BE-31 | A cashier may never override FEFO. Structural |
| BE-32 | An override requires a reason and records available versus chosen batches |
| BE-33 | Overrides are reported by actor and reason |
| BE-34 | An override cannot select an expired batch under expiry blocking. No permission path |
| BE-35 | A large-value FEFO override follows the approval policy |
| BE-36 | Every disposition writes a named movement |
| BE-37 | Quarantine stock is valued and aged, not written off on entry |
| BE-38 | Quarantine release is its own movement with reason `QuarantineRelease` |
| BE-39 | Quarantined stock may be consumed by staff, with a reason, and is reported |
| BE-40 | Batch cost (actual) and product cost (standard) are never conflated |
| BE-41 | The valuation policy is explicit: weighted average (default), FIFO, or last cost |
| BE-42 | Valuation is computed on demand; a cached figure is never authoritative |
| BE-43 | A sale line records the actual cost of the batch(es) it consumed |
| BE-44 | A batch's cost is immutable once consumed |
| BE-45 | A return does not guess a batch; the original sale's batches are suggested |
| BE-46 | An unattributable return of a tracked variant goes to quarantine |
| BE-47 | A return inherits the sold cost; a goodwill return is valued at standard cost and flagged |
| BE-48 | Batch number is printed on receipt and sale lines for tracked variants |
| BE-49 | The expiry date is printable per store; the system always knows it |
| — | Serialisation is COULD, designed to be added as a `StockItem`-level specialisation |
