# SmartStore — Offline POS Domain

**Phase 1 — Product & Domain Specification.**

Owner of: the edge agent, the offline caches, the transaction queue, synchronisation, idempotency, and conflict
resolution. Four invariants govern everything here: **BI-28** (idempotent), **BI-29** (never applied twice),
**BI-30** (server authority), **BI-31** (nothing silently discarded).

---

## 1. The premise, and the constraint it creates

> **SmartStore must still sell when the network is down.** That sentence is the product.

**Rule OF-01.** A store's connectivity is assumed to fail. Not "rarely" — routinely, and always at the worst
moment: Friday evening with a queue, a card that will not work, a router that reboots.

**Rule OF-02 — the consequence that shapes everything.** Offline means **the server was asked later**, never
"the terminal decided" (BI-30). A terminal may complete a sale, may display cached prices, and may use local
stock figures to warn a cashier. It may not decide a price, a tax rate, a discount, or a credit limit, because
three terminals deciding independently is three answers and no way to know which is right.

**Rule OF-03 — offline requires `AllowNegative`.** A store may enable offline operation on a terminal only where
the store's negative-stock policy is `AllowNegative` (SP-63). The rationale, and the alternative it avoids, is in
SP-63: amending BI-36 to carve out offline sync would create a second parallel set of stock rules. A
configuration guard is one rule; an invariant exception is a permanent fork in the most load-bearing invariant in
the product.

**Rule OF-04 — offline is per terminal and explicit.** `PosTerminal.OfflineEnabled` and an offline expiry window,
set at registration and auditable. A terminal is not offline-capable by default, because the capability has
consequences and the consequences should be chosen.

**Rule OF-05 — a training-mode terminal may not operate offline** (PT-03). Training sales are excluded from every
report, and an unsynced training sale is invisible, not excluded.

---

## 2. What is offline, and what is not

The distinction matters, because "offline" is used loosely and the loose usage produces designs that try to
reconcile financial facts they were never going to have.

| Operation | Offline? | Reason |
|---|---|---|
| Complete a sale with cash | **Yes** | The essentials must work |
| Complete a sale with card | **Yes, via a local provider integration** | The terminal talks to the acquirer, not to SmartStore |
| Scan and price from cache | **Yes, labelled unconfirmed** | OF-02 |
| Check local stock and warn | **Yes, as a warning only** | Never a block (OF-03) |
| RFID clock-in | **Yes, as a read** (RF-33) | Resolved on sync |
| Suspend and resume a cart | **Yes** | Terminal-local |
| Print a receipt | **Yes** | The printer is local |
| **Change a price** | **No** | BI-30 |
| **Apply a price override** | **No** | Manager authority, server-validated |
| **Apply a discount** | **Only cached, unconfirmed, and capped** | §4 |
| **Extend credit** | **No** | A credit limit is a server fact |
| **Issue a store credit / refund** | **No** | Money out, bounded by a server fact |
| **Receive stock** | **No** | Procurement is not a floor operation |
| **Stock adjustment** | **No** | Already unavailable to cashiers (IV-37) |
| **Void a completed sale** | **No** | Compensating document, server authority (SP-52) |
| **Approve anything** | **No** | BI-26 needs a server-side identity check |

**Rule OF-06.** "No" above means the operation is **refused at the till with a clear message**, not queued for
later. A cashier who presses "apply discount" during an outage gets "Discounts are unavailable while offline. No
discount has been applied." — never a silent success and a surprise at close.

---

## 3. The caches

**Rule OF-07.** The edge agent caches exactly six things, and the list is closed:

| Cache | Contents | Staleness risk handled by |
|---|---|---|
| `CatalogCache` | Variants, descriptions, units, barcodes, images | `LastSyncedAt` shown in the UI |
| `PriceCache` | Resolved prices per store and customer group | Labelled unconfirmed (OF-02) |
| `TaxCache` | Tax rates effective today | Labelled unconfirmed |
| `PromotionCache` | Active discount rules with their limits | Capped application (§4) |
| `StockCache` | On-hand and available per variant at the store's sellable locations | Warning only |
| `CustomerCache` | Named customers: name, masked contact, loyalty balance, credit standing | Warning only |

**Rule OF-08 — no cost, margin, purchase price, bank detail, or audit data is cached** (PR-36, SU-23, IV-57). A
local disk on a till is a physical, extractable, unencrypted thing in a shop. Caching margin to a local disk
because the network is slow is how cost data leaves a building.

**Rule OF-09 — no PII beyond the masked minimum is cached** (CU-07, CU-37). The `CustomerCache` holds what a
cashier needs to serve the counter and nothing else. A cached customer file with full contact details is a data
breach waiting for someone to steal a till.

**Rule OF-10 — the cache is read-only to the POS application and signed.** A tamper-evident cache means a
modified local price file is detectable rather than merely unlikely. A cache that can be edited by anyone with
filesystem access is not a cache, it is a local override of the price list, and BI-30 says the server decides.

**Rule OF-11 — the cache carries a `LastSyncedAt` and the UI shows it.** A cashier must be able to see that
prices are two hours old, because the customer will ask and the honest answer is available.

---

## 4. Discounts and promotions offline — the narrow concession

**Rule OF-12.** A cached promotion may be applied offline, under **all** of:

- The rule was active in the cache when the last sync occurred
- The rule is not a below-cost rule
- The applied value is within the **cached** rule's own limit
- The applied value is within a configured **offline cap**, per transaction and per day
- The offline discount is **flagged on the sale** as requiring server confirmation

**Rule OF-13.** An over-cap discount is refused offline with a named message. The cashier cannot self-approve
their way past it, and a manager's approval is not available offline (OF-05).

**Rule OF-14 — the promotion use counts are reconciled on sync, and the outcome is visible.** A promotion with a
per-customer or total-use limit may be over-used across terminals while offline. Sync applies what it can, marks
the rest, and **never silently drops a sale** (BI-31).

**Rule OF-15 — price overrides are not available offline at all** (OF-05). This is the one concession refused
outright, and the reason is that a price override is a margin decision by a specific person, and a local record
of "a manager said so" is not the same thing as a permissioned decision.

**Rule OF-16 — the offline discount cap is a store setting with a conservative default**, and setting it requires
`Config.Store`. A store that raises it is accepting that promotions will be reconciled rather than guaranteed. The
recommendation is a low cap (a percentage of the sale total) so that the worst offline case is bounded and known.

---

## 5. The transaction queue

**Rule OF-17.** The queue is **durable, append-only, and on the terminal**. It survives a power cut, an OS crash,
and a restart. A queue held in memory is not an offline design.

**Rule OF-18 — a queue item holds everything needed to apply the sale**, so the terminal does not need the catalog
cache at sync time: the document number, the terminal, the cashier, the customer, every line with its resolved
price, the payments, the receipt rendering, and the `ClientOperationId`.

**Rule OF-19 — the local record of a queue item's outcome is as authoritative as the server's.** For any item,
the local state and the server state agree (BI-31). Where they cannot agree, the item is escalated, not guessed.

**Rule OF-20.** `SyncSession` records a sync run: the terminal, the start and end, the items attempted, the
outcomes by category, and the server's reported clock. `SyncConflict` records an individual item's disagreement.

**Rule OF-21 — the queue is inspectable by the cashier.** `Sale.OfflineQueue.Manage` lets a supervisor see what is
pending, what was applied, what was adjusted, and what was rejected — with reasons. A queue an operator cannot
see is a queue an operator cannot trust, and an untrusted queue gets cleared.

---

## 6. Synchronisation

**Rule OF-22 — the apply step is: identify and apply in one transaction, or not at all** (BI-29). The
implementation is a single insert of `(TerminalId, ClientOperationId)` under a uniqueness constraint, in the same
transaction as the sale. On conflict, the stored original response is returned and **nothing else in the operation
runs**.

**Rule OF-23 — "apply then dedupe" is forbidden.** A timeout between the apply and the response causes a retry,
and the retry applies again. The order of operations is the entire defence (BI-29).

**Rule OF-24 — sync is per store, per terminal, in business-date order**, then in queue order within a business
date. Ordering matters for three things: document-number allocation (a single sequence per store, BI-42), the
FEFO attribution of a shortfall, and the reading of a day that ended 400 sales ago.

**Rule OF-25 — the server's document number is authoritative**, and the terminal's provisional number is replaced.
A terminal's provisional numbers are per-terminal and monotonic; the server's are per-store and are what appear on
the receipt. A customer who is told "your receipt number is 47" at the till and receives `SAL-202609-000412` is
confused, and the reprint is the resolution. **This is stated because it is a real UX consequence, not a rounding
detail.**

**Rule OF-26 — a sync response is per item**, and the terminal applies the per-item outcome. A single
all-or-nothing batch response would mean one bad item blocks a hundred good ones, and a store would stop syncing.

**Rule OF-27 — sync is triggered** on connectivity restoration, on a configurable interval, on a manual request,
and at shift close. It is never triggered only on a timer, because a store that closes with an unsynced queue and
opens the next morning with no network has now stranded yesterday's sales.

**Rule OF-28 — an offline window that exceeds the terminal's configured expiry stops the terminal selling** and
raises a high-severity notification. The store decides the window; a store with an unbacked-up local ledger
decides it wrong.

---

## 7. Conflict resolution

**Rule OF-29.** Every synced transaction ends in exactly one of three states, and there is no fourth
(BI-31):

| Outcome | Meaning | Stock | Money | Visible to staff |
|---|---|---|---|---|
| `Applied` | Applied exactly as the terminal computed it | As computed | As tendered | Yes |
| `AppliedWithAdjustment` | Applied, with recorded differences | Server-correct | Server-correct | **Yes, prominently** |
| `Rejected` | Not applied, with a reason | Unchanged | Unchanged | **Yes, with the reason** |

**Rule OF-30 — stock is never in conflict in a way that loses a sale.** Under `AllowNegative` (OF-03) the sale
always applies; the stock position may go negative, and that is recorded (IV-17). Under `BlockNegative` — which
cannot happen offline (OF-03) — the sale would be refused at the terminal, before the customer pays.

**Rule OF-31 — price differences are `AppliedWithAdjustment`**, never `Rejected`. A customer was served at a
cached price; the server's price governs the ledger, the difference is recorded, and the **price delta is reported
per transaction, per terminal, and in total** (BI-30). A store whose prices changed while it was offline has a
real, small, explainable discrepancy — and one that would otherwise be invisible.

**Rule OF-32 — a tax difference follows the same path.** The tax mode and rate are the server's; the difference is
recorded on the line.

**Rule OF-33 — a promotion that cannot be applied becomes `AppliedWithAdjustment`**, with the promotion removed and
the difference recorded, and the customer-facing line adjusted accordingly. It is never `Rejected`: the goods left
the shop.

**Rule OF-34 — a customer who no longer exists, or whose credit standing changed, is `AppliedWithAdjustment`**
where the sale is otherwise valid, and the adjustment records the credit position. A sale is not retroactively
un-paid.

**Rule OF-35 — `Rejected` is reserved for cases where applying would be wrong.** A training-mode terminal, a
terminal that is not offline-enabled, a store the terminal is no longer assigned to (PT-02), a terminal whose
offline window has expired (OF-28), a duplicate of an already-reversed transaction, and a document number that
cannot be allocated. Every one has a reason a staff member can read, and every one is exceptional.

**Rule OF-36 — rejected items are never deleted from the queue.** They become `Rejected` with a reason, they are
reported, and a supervisor resolves them (a manual sale, a write-off, a reconciliation entry). **BI-31 is the
whole reason: a transaction that vanishes is indistinguishable from a lost sale.**

**Rule OF-37 — the sale is never lost and never re-served.** A `Rejected` sale is a business event requiring a
decision, and a supervisor decision is recorded as such. It is not retried automatically, because the reason it
failed will still be true.

---

## 8. The concurrency that matters

**Rule OF-38 — two terminals offline selling the same last unit.** With `AllowNegative` (OF-03) both sales apply,
the balance goes negative, and the notification fires (IV-17, BI-36). There is no prevention, because there is
nothing to prevent it against: the terminals have not spoken. **The system records the truth and the report
attributes the shortfall**, which is the honest outcome. A warehouse or an online store never has this.

**Rule OF-39 — a shortfall on a batch-tracked variant is absorbed by the shortfall pseudo-batch** (BE-29,
SP-64), and the pseudo-batch raises its `BATCH_SHORTFALL` error (BE-30). A real batch is never made negative
(IV-19) even under an outage, because batch attribution is the thing that must stay clean while everything else
is noisy.

**Rule OF-40 — FEFO offline is advisory.** The terminal can suggest the soonest-expiring batch from its batch
cache, and the sale line records which batch the server later allocated. The server's allocation is authoritative;
the terminal's is a hint. An FEFO override offline is not possible (BI-31, RF-21 — no approval offline), so a
near-expiry batch may be left behind during an outage. That is reported, and the expiry window is a month, not a
minute.

---

## 9. Security offline

**Rule OF-41 — the local ledger is as sensitive as the server's**, because it contains sales, prices, and possibly
masked customer data (OF-08, OF-09). It is encrypted at rest, and the terminal's local key is bound to the
registered device credential (HD-14, HD-15).

**Rule OF-42 — a lost or stolen terminal is a security event, and the response is revocation.** `Device.Disable`
stops the terminal syncing, and a remote credential revocation makes the local store unreadable. A terminal's
offline capability is a real liability and the product treats it as one.

**Rule OF-43 — offline sessions are bound to the authenticated employee** and are short-lived (RF-22). A till left
open in a staff area is a till anyone can use.

**Rule OF-44 — no offline data is written to shared or removable media** by the POS. Diagnostics are exported
through a deliberate, audited action (HD-25).

**Rule OF-45 — the offline queue is included in backup and in the local integrity check** (audit-domain §7). A
queue that silently lost twenty sales would be invisible, and that is the exact failure this domain exists to
prevent.

---

## 10. What the operator sees

**Rule OF-46 — offline is stated plainly, once, at the top of the POS, with the time of last sync** (OF-11). Not
a red banner that reads like an error. A clear status: "Offline — using prices from 14:32. Sales will sync when
the connection returns."

**Rule OF-47 — every offline transaction is marked on its own screen and on its receipt** as offline, with the
provisional number, so nobody is surprised later.

**Rule OF-48 — a sync conflict is surfaced to the terminal, not only to a report.** A sale adjusted by $0.40 is
something the manager should see on the day, not discover in a monthly report. The terminal shows a sync summary
with counts by outcome and the individual adjusted and rejected items.

**Rule OF-49 — the shift cannot be closed with a materially unsynced queue without an explicit decision**, and
that decision is recorded. A manager closing a shift while a hundred sales sit unsynced is making a decision that
should be visible, not a thing the system should let happen by accident.

**Rule OF-50 — the supervisor's queue view shows, per item: state, local time, server time, any delta, and the
reason** (OF-21). No colour-only signalling; state is in text, because colour fails for colour-blind users and
for anyone reading a screenshot in an incident report.

---

## 11. Offline rules index

| ID | Rule |
|---|---|
| OF-01 | Connectivity failure is assumed, not exceptional |
| OF-02 | Offline means the server was asked later, never that the terminal decided |
| OF-03 | Offline requires `AllowNegative`. A configuration guard, not an invariant amendment |
| OF-04 | Offline is per terminal, explicit, and auditable |
| OF-05 | A training-mode terminal may not operate offline |
| OF-06 | An offline-unavailable operation is refused with a clear message, never silently queued |
| OF-07 | The cache is a closed list of six things |
| OF-08 | No cost, margin, bank, or audit data is cached |
| OF-09 | No PII beyond the masked minimum is cached |
| OF-10 | The cache is read-only to the application and tamper-evident |
| OF-11 | `LastSyncedAt` is shown to staff |
| OF-12 | Offline discounts need five conditions, including a cap |
| OF-13 | An over-cap discount is refused offline |
| OF-14 | Promotion use counts are reconciled on sync and never silently drop a sale |
| OF-15 | Price overrides are unavailable offline |
| OF-16 | The offline discount cap is a store setting with a conservative default |
| OF-17 | The queue is durable, append-only, and survives power loss |
| OF-18 | A queue item is self-contained; sync needs no catalog cache |
| OF-19 | Local and server outcomes must agree; disagreement is escalated |
| OF-20 | `SyncSession` and `SyncConflict` record the run and the disagreements |
| OF-21 | A supervisor can inspect the queue, with reasons |
| OF-22 | Identify and apply in one transaction, under a unique constraint |
| OF-23 | "Apply then dedupe" is forbidden |
| OF-24 | Sync is per store, in business-date order, then queue order |
| OF-25 | The server's document number is authoritative; the terminal's is provisional |
| OF-26 | Sync responses are per item, never all-or-nothing |
| OF-27 | Sync triggers on restoration, interval, request, and shift close |
| OF-28 | Exceeding the offline window stops the terminal and notifies |
| OF-29 | Every outcome is `Applied`, `AppliedWithAdjustment`, or `Rejected`. No fourth |
| OF-30 | Stock is never lost in conflict; `AllowNegative` guarantees the sale applies |
| OF-31 | A price difference is an adjustment, never a rejection, and is reported |
| OF-32 | A tax difference follows the same path |
| OF-33 | An inapplicable promotion becomes an adjustment, never a rejection |
| OF-34 | A changed credit position is an adjustment, not a retroactive non-payment |
| OF-35 | `Rejected` is reserved for the five cases where applying would be wrong |
| OF-36 | A rejected item is never deleted; it is reported and resolved by a person |
| OF-37 | A rejected sale is a business event, never auto-retried |
| OF-38 | Two offline terminals selling the last unit both succeed and go negative, recorded |
| OF-39 | A batch shortfall goes to the pseudo-batch; real batches never go negative |
| OF-40 | FEFO offline is advisory; the server allocates |
| OF-41 | The local ledger is encrypted and bound to the device credential |
| OF-42 | A lost terminal is revoked; offline is treated as a liability |
| OF-43 | Offline sessions are bound to the employee and short-lived |
| OF-44 | No offline writes to shared or removable media |
| OF-45 | The offline queue is in backup and in the local integrity check |
| OF-46 | Offline status is stated plainly with the last-sync time |
| OF-47 | Every offline transaction is marked on screen and on its receipt |
| OF-48 | Sync conflicts are surfaced to the terminal, not only to a report |
| OF-49 | Closing a shift with a materially unsynced queue is an explicit, recorded decision |
| OF-50 | The queue view shows state, both times, the delta, and the reason — in text, not colour alone |
