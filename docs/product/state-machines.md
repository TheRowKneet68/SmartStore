# SmartStore — State Machines

**Phase 1 — Product & Domain Specification.**

The consolidated reference for every state machine in SmartStore. This document **owns nothing**; each machine
is defined in its owning domain document and repeated here in one place so the whole set can be checked for
consistency, illegal transitions, and gaps. Where this document and an owning document disagree, **the owning
document wins** and this one is a defect.

Invariants referenced: BI-08 (documents are immutable), BI-15 (movements are compensated, not reversed), BI-24 (audit entries are immutable), BI-40 (entities are archived, never deleted), BI-25 (reason requirement), BI-28
(`ClientOperationId` idempotence).

---

## 0. The rules that apply to every machine

**Rule SM-01.** A document's **own** state is a **stored fact about that document**, not a value recomputed from
timestamps or from another document. Deriving a document's state from its timestamps means the two can disagree.

**Rule SM-01a — stored does not mean authoritative, and a document's state may still be a projection of a
ledger.** SM-01 is about one field on one document: the document does not recompute its own status from when its
timestamps say it should. It is **not** a claim that every number is stored. Three machines in this document
deliberately *are* projections, and SM-01 must not be read to forbid them:

- a `Sale`'s refund state is a projection of its linked refunds (SM-35, SP-66);
- a `PurchaseOrder`'s receipt state is a projection of its GRNs (SM-21, PR-Q18);
- a customer balance and a supplier balance are projections of their ledgers (SM-44, SU-09).

The distinguishing question is **which entity owns the number**. The sale's refund *status* belongs to the sale
and is stored; the *money already refunded* belongs to the refund ledger and is projected. A single entity may do
both at once, and an earlier revision of this rule stated the stored/derived choice as absolute, which made it
contradict SM-21, SM-35, SM-44, and SM-76 at once.

**Rule SM-02.** A transition is a named, permissioned operation. There is no generic "set status" endpoint.
**A generic setter is a way to make an illegal transition legal**, and illegal transitions are the ones that
corrupt money and stock.

**Rule SM-03.** Every transition records: prior state, new state, actor, timestamp, reason where the domain
requires one (BI-25), and `CorrelationId` (AU-10).

**Rule SM-04 — every transition is idempotent by `ClientOperationId`** (BI-28). A retried request does not
transition twice, and a repeated transition to the state it is already in is a no-op, not an error.

**Rule SM-05.** A **terminal** state has no outgoing edges. Any code that attempts one is a defect, and the
machine's graph is asserted in a test rather than checked at runtime (PY-12's approach, applied to all of them).

**Rule SM-06 — an illegal transition is refused with a named message**, not a generic failure. "Cannot void a
completed sale" tells the user what to do; a constraint violation tells them to contact support.

**Rule SM-07 — a machine is a closed set of states and transitions, defined in the owning document and
versioned.** A state added later is a schema change with a migration, and the change is reviewed (AU-13's
reasoning).

**Rule SM-08 — cancellation and deletion are not the same thing.** A document is cancelled, never deleted
(BI-08, BI-40, AU-32). A machine that offers a delete edge is offering to erase evidence.

**Rule SM-09 — a machine with a `Suspended` or `OnHold` state has a resume edge and a reason** for the hold, and
the hold is visible in the queue (SP-11's suspended sale, PC's held GRN, CD's paused counting).

**Rule SM-10 — where a machine crosses a store boundary — and only `Sale`, `StockMovement`, and `Shift` can — the
boundary is a transaction boundary, not a state** (MS-23, IV-39).

---

## 0a. The eight attributes of a transition

A transition is specified by **eight attributes**. SM-02 names the permission, SM-03 names the audit record, and
SM-08 names the reversal. The remaining five are named here so the set is closed:

| # | Attribute | Rule | Defined by |
|---|---|---|---|
| 1 | **Source** state | SM-07 | the owning document's state set |
| 2 | **Destination** state | SM-07 | the owning document's state set |
| 3 | **Actor** — a role from [actors-and-roles.md](actors-and-roles.md) §3, never "system" | SM-02 | the owning document |
| 4 | **Permission** — one key from the [permission catalogue](actors-and-roles.md) §2, never "none" | SM-02 | the owning document |
| 5 | **Precondition** — the guard the edge tests before it fires | SM-06 | the owning document |
| 6 | **Side effect** — the stock, money, ledger, or projection write | SM-33 | the owning document |
| 7 | **Audit** — the `EventType` recorded, from the [AU-12 set](audit-domain.md) §3 | SM-03, AU-03 | the owning document |
| 8 | **Reversal / cancellation** — how the edge is undone, or that it cannot be | SM-08 | the owning document |

**Rule SM-02a — the eight attributes are specified, or the cell is `OPEN DECISION`.** §22 below carries a row per
transition with these eight attributes filled from the owning document. **A cell reading `OPEN DECISION` is a
known, recorded gap in Phase 1, not a licence to guess.** An implementation that needs a value Phase 1 did not
specify must raise it rather than pick one, because four of the eight (actor, permission, side effect, audit)
change what the ledger and the access-control model do.

**Rule SM-02b — the permission column is never empty and never "any".** If the owning document does not name a
permission for a transition, the cell is `OPEN DECISION`. A machine that "has no permission" is a machine whose
transitions are reachable by anyone who can reach the endpoint, which is precisely what SM-02 forbids.

**Rule SM-02c — an `OPEN DECISION` cell is a Phase 2 blocker only where it names a permission, a side effect, or
an audit type.** A missing precondition guard is a hardening item, not a blocker. §22 marks each cell so the two
are separable.

---

## 1. `Product` — lifecycle

Defined in [product-domain.md](product-domain.md) §11.

```
Draft ──► Active ──► Discontinued ──► Archived
  │         │  ▲          │
  │         └──┘          └──► Archived  (never Archived → Active, PR-47)
  │
  ├──► Hidden ──► Active
  └──► Archived

OutOfStock is not on an edge: it is Active with nothing in stock (PR-).
```

| State | Meaning |
|---|---|
| `Draft` | Being created. Not searchable at a till, not orderable |
| `Active` | Sellable, purchasable, orderable, visible |
| `Discontinued` | Not orderable, still in stock and sellable **if the location holds it** |
| `OutOfStock` | Active, nothing in stock anywhere. **A condition, not a lifecycle step** |
| `Hidden` | Deliberately not sold, e.g. seasonal. Not visible in operational search |
| `Archived` | Terminal. History preserved (BI-40) |

**Rule SM-11.** A `Discontinued` product **can still be sold if stock exists** — otherwise a discontinued
house brand becomes unsellable while it sits on the shelf, and the cashier cannot ring it. This is the single
most surprising rule in the machine, so it is stated here as well as in product-domain.

**Rule SM-12.** Only `Draft` → `Active` requires the completeness check. A `Discontinued` → `Active`
reactivation does not, because nothing about the product changed.

**Rule SM-13.** `Archived` requires a reason and is terminal (BI-25, SM-05, PR-47). **There is no `Archived` →
`Active` edge**: un-archiving is a data-recovery operation, not a business action (PR-47).

**Rule SM-13a — the state set is the owner's, verbatim.** Product states are `Draft`, `Active`, `Discontinued`,
`OutOfStock`, `Hidden`, `Archived` (product-domain §11). An earlier revision of this section used a `Retired`
state that **no owning document defines** and omitted `OutOfStock` and `Hidden`. `OutOfStock` in particular is
not a lifecycle step a user moves through: a product does not get archived because it ran out, and the
`Archived` transition is `Product.Archive` on the owner's own naming. **If this table and product-domain §11 ever
disagree again, product-domain wins and this one is a defect** (SM-07).

---

## 2. `StockItem` — the `StockPolicy`, not a lifecycle

Defined in [inventory-domain.md](inventory-domain.md). **A `StockItem` has no state machine**, and this is
deliberate: policy is a projection of the movements, so a stored state would be a fourth number to disagree
(BI-02, CD-08's rule).

**Rule SM-14.** `AllowNegative` and `BlockNegative` are the only two policies, and a `StockItem` moves between
them **only** by a movement that would breach the current policy. The transition reason is that movement.

**Rule SM-15.** There is no manual override of a policy. An employee cannot "set" a stock item to allow-negative;
a movement either breaches a rule or it does not, and the rule is the store's configuration (IV-16).

---

## 3. `StockBatch` — lifecycle

Defined in [batch-expiry-fefo.md](batch-expiry-fefo.md).

```
Active ──► Quarantined ──► Active
  │            │
  │            ├──► Blocked ──► Quarantined
  │            └──► Depleted (terminal, by quantity)
  ├──► Depleted
  ├──► Expired
  └──► Blocked
```

| State | Meaning |
|---|---|
| `Active` | Usable, subject to FEFO |
| `Quarantined` | Held pending investigation. Not sellable, not issueable |
| `Blocked` | Withheld from sale pending a decision. Not sellable, not issueable |
| `Depleted` | Quantity zero. Terminal |
| `Expired` | Past its expiry. Terminal. Not sellable |

**Rule SM-16.** `Quarantined` is reversible (`Active`); `Depleted` and `Expired` are not.
Reversibility is the difference between a hold and an ending.

**Rule SM-16a — the state set is the owner's, verbatim.** Batch statuses are `Active`, `Expired`, `Quarantined`,
`Depleted`, `Blocked` (batch-expiry-fefo §2). An earlier revision of this section used a `WrittenOff` state that
**the owner does not define** and omitted `Blocked`. The distinction is not cosmetic: `Quarantined` is a hold
pending investigation, whereas `Blocked` is a withhold pending a decision, and collapsing them loses the reason
the batch is unavailable — which is the first thing anyone asks when a batch cannot be sold. **If a write-off is
wanted as a state, that is a new state for the owner to define, not one this document may invent** (SM-07). A
write-off is presently expressible as a `StockAdjustment` with a reason (IV-32, BI-25) against the batch.

**Rule SM-17.** `Depleted` is reached by quantity, never by a manual action. A batch with stock on hand is not
depleted, whatever a user clicks (BE-22's reasoning).

**Rule SM-18.** `Expired` is a **derived** condition reported at read time **and** a stored transition at the
expiry boundary. A batch past its expiry is not sellable even before the job runs; the stored state exists so
the transition is auditable (BE-18).

**Rule SM-19.** A batch with `ExpiryRequired` for its category cannot be created without a date (BE-19), and a
batch with no date is `Active` but sorts last under FEFO (BE-20).

---

## 4. `PurchaseOrder` and `PurchaseOrderLine`

Defined in [procurement-domain.md](procurement-domain.md) §11.

```
Draft ──► PendingApproval ──► Approved ──► PartiallyReceived ──► Received ──► Closed
  │            │                 │                │                  │
  │            └──► Rejected     └──► Cancelled  └──► Closed         │
  └──► Cancelled                     (never received)                  │
```

| State | Meaning |
|---|---|
| `Draft` | Editable. Nothing committed |
| `PendingApproval` | Submitted. Awaiting a decision (AP-22) |
| `Approved` | Committed. Not yet sent |
| `Ordered` | Sent to the supplier. **A GRN requires this state** (PR-Q08) |
| `PartiallyReceived` | Some lines received |
| `Received` | All lines received. Awaiting invoicing |
| `Closed` | Terminal. Invoiced, or the balance written off |
| `Rejected` | Terminal. The approval said no (AP-10) |
| `Cancelled` | Terminal. Withdrawn before receipt |

**Rule SM-20.** Only `Draft` is editable. Editing an `Approved` PO changes what was approved (AP-03's principle),
so an amendment is a new PO or an explicit, audited amendment with re-approval.

**Rule SM-21.** A PO is received by `GRN`, and the PO's receipt state is a **projection of its GRNs** (PR-Q18's
rule). The PO does not gain quantity; the GRN does, and the PO reflects it.

**Rule SM-22.** `Received` → `Closed` requires either an invoice for the balance or an explicit write-off
decision. **A PO that stays `Received` forever is a payable that will be discovered at year end**, and the
open-PO coverage report (PR-Q09) exists to prevent it.

**Rule SM-23.** `Rejected` and `Cancelled` are distinct from `Closed` and from each other. Rejected is a
decision; cancelled is a withdrawal; closed is an ending.

**Rule SM-24.** No PO is ever deleted, in any state, including `Draft` (SM-08, PR-Q06a, RT-117). Deletion is
not offered; a draft is cancelled, which is a reasoned transition that leaves the number and the record visible.

---

## 5. `PurchaseReceipt` (GRN) — lifecycle

Defined in [procurement-domain.md](procurement-domain.md).

```
Draft ──► Received ──► (terminal)
  │           │
  │           └──► (stock is created here; the payable comes from the invoice)
  └──► Cancelled (before receipt only)
```

**Rule SM-25.** A GRN has one meaningful transition: `Draft` → `Received`, which creates **stock only**
(PR-Q20, PR-Q22). **A GRN has no partial state** — a draft is fully editable, and receipt is
atomic. Partial receipt is expressed by receiving twice.

**Rule SM-26.** A GRN cannot be received twice (BI-24, PR-Q20). Receiving an already-received GRN
is refused; the correction is a return to supplier or a stock adjustment, both reason-bearing.

**Rule SM-27.** A GRN creates **stock, never a second payable** if one already exists for the invoice
(procurement-domain §5).
The payable is created by the invoice.

---

## 6. `SupplierInvoice` and three-way match

Defined in [procurement-domain.md](procurement-domain.md).

```
Draft ──► Matched ──► ApprovedForPayment ──► Scheduled ──► Paid
  │          │               │                  │
  │          └──► Disputed   └──► Rejected     └──► Failed ──► (retryable)
  └──► Cancelled
```

| State | Meaning |
|---|---|
| `Draft` | Entered. Not matched |
| `Matched` | Three-way match passed (PR-Q25) |
| `Disputed` | The match failed. **Held, not rejected** — the payable is not created |
| `ApprovedForPayment` | Accepted. The payable exists |
| `Scheduled` | A payment is planned |
| `Paid` | Terminal. Settled |
| `Failed` | The payment attempt failed. Retryable, not terminal |

**Rule SM-28.** `Disputed` is **not** `Rejected`. A disputed invoice is a live negotiation; a rejected one is
closed. Collapsing them loses the negotiation and the evidence.

**Rule SM-29.** The payable is created at `ApprovedForPayment`, not at `Matched` and not at `Paid`
(procurement-domain §5, SU-09). This
is the single most consequential state in procurement, because the payable is the balance the whole AP side
depends on.

**Rule SM-30.** `Failed` is retryable and holds the invoice (PR-Q26). **A failed payment must not be a terminal
state**, because a supplier invoice that cannot be re-attempted is a debt that cannot be settled.

**Rule SM-31.** A partial payment is represented by the payable's balance (SM-04's bound), not by an invoice
state. The invoice is `Scheduled` until its balance is zero, then `Paid`.

---

## 7. `Sale` and `SaleLine`

Defined in [sales-pos-domain.md](sales-pos-domain.md) §13.

```
[Cart] ──(not a Sale)──► Completed ──► PartiallyReturned ──► Returned
                             │                  │
                             │                  └──► Voided is refused while a
                             │                       return is unreversed (SP-55)
                             └──► Voided (terminal, pre-print)
```

| State | Meaning |
|---|---|
| `Completed` | The only state a sale is created in (SP-02) |
| `PartiallyReturned` | Some lines returned, not all. **Derived from the line counters** |
| `Returned` | Every line fully returned. Terminal |
| `Voided` | Cancelled before a receipt printed. Terminal, no stock, no money |
| `SuspendedSale` | A held cart. **Not a `Sale`** (SP-11) |

**Rule SM-32.** There is **no `Draft` sale, no `Pending` sale, and no `Open` sale** (SP-02). A `Cart` is a
terminal-local UI object; a `SuspendedSale` is a persisted held cart. Neither is a `Sale`, and a `Sale` is
immutable once `Completed` (BI-08).

**Rule SM-33.** `Completed` is the creation state and the sale is final from that moment. Every subsequent
change is a compensating document: a refund, a return, a no-sale (SP-20).

**Rule SM-34.** `Voided` is reachable **only** from `Completed` and **only** before a receipt has printed
(SP-20, SP-30). After the print, the only path is refund-and-return. **The print is the point of no return**, and
that is a deliberate physical-world boundary: a customer holding a receipt has a document, and a void would
leave them with one that says nothing happened.

**Rule SM-35 — the post-sale states are a projection of the line counters, and the counters are named by the
owner.** sales-pos-domain §13 defines the states as `Completed`, `PartiallyReturned`, `Returned`, `Voided`, and
SP-66 makes `ReturnedQuantity` and `RefundedAmount` the truth, with the status a **cache of them** that a rebuild
must reproduce exactly. An earlier revision of this section used `PartiallyRefunded` / `Refunded` and called
them a projection of *linked refunds*. Both names were wrong: the owner names the states after **returns**, not
refunds, because a customer can return goods and be issued store credit without any money refund (RR-01, and
returns-refunds §1: a return without a refund is normal). A machine that moved to `PartiallyRefunded` on a
store-credit return would strand the sale in `Completed` while its goods were already back on the shelf.

**Rule SM-35a — a derived status is still stored, and that is not a contradiction.** SP-66 calls the status a
cache, SM-01 says a document's own state is stored, and SM-01a explains why both hold. The counter is the truth;
the status column is the readable copy; SP-66's rebuild test is what keeps them equal.

**Rule SM-36.** A `Sale` has no `Cancelled` state, because "cancelled" is `Voided` and the words mean different
things to a customer (SM-08's rule applied to vocabulary).

**Rule SM-37.** A `NoSale` document is not a `Sale` and has no state (SP-20). It is a drawer record for the
opening float of a transaction with no transaction.

---

## 8. `Return` and `Refund`

Defined in [returns-refunds-domain.md](returns-refunds-domain.md) §12.

```
Return:   Draft ──► Posted ──► Settled ──► Closed
             │          │
             │          └──► Closed   (settled, or remainder written off with a reason)
             └──► Cancelled  (only from Draft; no goods accepted, no money moved)

Refund:   Draft ──► PendingApproval (if required) ──► Approved ──► Processing ──► Completed
                                                          │            │           │
                                                          │            └──► Failed ──retry──► Processing
                                                          │            │
                                                          └──► Cancelled └──► Cancelled
```

| Return state | Meaning |
|---|---|
| `Draft` | Being entered. Lines bounded by RR-14 as it is built |
| `Posted` | Goods accepted and stock moved. Nothing moves before this (BI-27, IV-14) |
| `Settled` | No further refund is expected. Refundable amount is zero, or the remainder is written off with a reason |
| `Closed` | Terminal |
| `Cancelled` | Withdrawn **from `Draft` only**. No goods accepted, no money moved |

| Refund state | Meaning |
|---|---|
| `Draft` | Being entered |
| `PendingApproval` | Submitted. No money effect (BI-27) |
| `Approved` | Cleared to pay. Approval may be skipped where none is required |
| `Processing` | The provider round-trip. Holds its amount for the whole state (RR-24) |
| `Completed` | Terminal. The customer has the money |
| `Failed` | A technical failure. Retryable, and notified. Terminal until retried |
| `Cancelled` | Withdrawn before completion |

**Rule SM-38.** The two machines are **separate and the documents are separate** (RR-01). A return without a
refund is normal (a shop credit). A refund without a return is a goodwill refund (PY-26, RR-35).

**Rule SM-39.** The return and the refund are **linked, not nested**, so a return can be closed with the refund
pending, and two refunds can exist against one return.

**Rule SM-40.** `Processing` holds the amount against the bound (RR-24), so an in-flight refund blocks a second
refund of the same money — the mechanism the bound needs.

**Rule SM-41.** `Failed` is retryable and holds the amount, exactly as `Failed` is in procurement (SM-30).
**A refund that cannot be retried is a customer who was not refunded and cannot be.**

**Rule SM-42.** A refused return needs a reason (BI-25) and the customer is told why in the return outcome.
A refusal with no stated reason is indistinguishable from an error. **The owner's state for a refusal is
`Cancelled` from `Draft`, not a separate `Rejected` state** — see SM-43a.

**Rule SM-43.** `Settled`/`Closed` requires that stock has actually moved (RR-17, RR-31). A return marked
settled with the stock unmoved is a return that has lost goods silently, and this is the transition the
transition-log is verified against.

**Rule SM-43a — the state sets are the owner's, verbatim.** returns-refunds §12.1 defines the return as
`Draft` → `Posted` → `Settled` → `Closed`, plus `Cancelled` from `Draft`; §12.2 defines the refund as `Draft` →
`PendingApproval` → `Approved` → `Processing` → `Completed`, with `Failed` (retryable) and `Cancelled`. An
earlier revision of this section used a return chain of `Received` / `Inspected` / `Dispositioned` and a
`Rejected` state on both machines. **None of those four state names exist in the owner.** The old chain is not
merely renamed — it was a *finer* machine than the owner specifies, and adopting it would have invented a
disposition step the owner does not require. `Dispositioned` in particular duplicates stock movement that RR-17
and IV-14 already place in `Posted`; splitting it out would give the same stock move two states and two chances
to disagree. The refund's `Rejected` state has no owner basis either, and `PendingApproval` / `Approved` /
`Processing` were missing entirely, which is how a large refund could have been paid without an approval step.

---

## 9. `CustomerAccount` — balance, not a state

**Rule SM-44.** A customer account has **no state machine**. Its balance is a projection of the ledger
(CU-11, PY-01). A stored `Current` field would be a second source for the most-argued number in the system.

**Rule SM-45.** What *is* stateful is the **customer status**, and its values are the four the domain defines
(customer-domain §3): `Active`, `OnHold`, `CreditBlocked`, `Closed`. A status change is a transition, it needs a
reason, and it is audited — but the balance is never part of it.

```
Active ──► OnHold ──► Active
   │          │
   │          └──► Closed   (no longer a customer; history retained, CU-10)
   │
   ├──► CreditBlocked ──► (back to Active or OnHold: OPEN DECISION, see SM-45c)
   └──► Closed
```

**Rule SM-45a.** `OnHold` is **not** a credit control. It warns, notifies, and requires a note, and the customer
may still buy (CU-09). `CreditBlocked` is the credit control: goods may be sold, goods may not be taken on
account. Collapsing the two either strands a flagged customer or quietly extends credit to a blocked one.

**Rule SM-45b.** No edge is taken by a payment, a job, or a client. Every transition is a permissioned human
decision with a reason (BI-25), and `Active → OnHold → Active` is a review, not an expiry.

**Rule SM-45c — `CreditBlocked` is a credit control, not a terminal state.** An earlier revision of §21 listed
`CreditBlocked` as terminal. That is wrong twice over. It contradicts the owner, which treats `CreditBlocked` as a
standing control alongside the revisitable `OnHold` and whose stated purpose is to be *lifted* — a credit block
that can never be lifted would make `Closed` the only way out and would strand a customer who has paid. And it
contradicts CU-09's design intent, which reserves a hard block for the credit control precisely so a person, not
a ledger, decides when it applies. **The exact exit edges and their permission are `OPEN DECISION`**: customer
-domain §3 defines the statuses and their meaning but does not enumerate the transitions, and no v1 requirement
names who may lift a credit block. `Customer.Credit.Grant` is the nearest key and is **not assumed to be it**.
Until this is decided, `CreditBlocked` is specified as non-terminal with an unresolved exit, and Phase 2 must not
infer one.

**Rule SM-46.** A `CreditLimitCheck` result is **not a state change**. It is a projection of the balance and the
limit (CU-14). Recording "the limit was checked" as state is how a stale limit becomes authoritative.

---

## 10. `Employee` and login

Defined in [employee-domain.md](employee-domain.md).

```
Active ──► Suspended ──► Active
   │            │
   │            └──► Terminated (terminal, EM-08)
   │
   ├──► OnLeave ──► Active
   ├──► Terminated (terminal)
   └──► Archived
```

| State | Meaning |
|---|---|
| `Active` | May sign in and transact |
| `OnLeave` | On approved leave. May sign in **read-only**, may not transact (EM-07 table) |
| `Suspended` | **Blocked at authentication.** Existing sessions are revoked immediately |
| `Terminated` | Terminal. Irreversible (EM-08). Retained for audit (EM-11) |
| `Archived` | Historical only. Cannot sign in, cannot transact |

**Rule SM-47.** `Suspended` revokes live sessions (EM-13). This is a security transition and it is immediate;
"the next time they log in" is not suspension.

**Rule SM-48.** `Terminated` is terminal and the employee is **retained, not deleted** (EM-11, SM-08, BI-40).
Their past transactions reference them, and deleting the employee breaks BI-12's traceability. **Re-hiring is a
new employee record, not a reversal of this one** (EM-08).

**Rule SM-48a — the state set is the owner's, verbatim.** Employee statuses are `Active`, `OnLeave`,
`Suspended`, `Terminated`, `Archived` (employee-domain §3). An earlier revision of this section used an
`Invited` state that **no owning document defines** and omitted `OnLeave` and `Archived`. `Invited` is worse than
merely unused: an employee is created `Active`, so a machine that requires a second activation step would leave
every newly-created employee unable to work. `OnLeave` is not optional either — it is the state that lets a
manager block a long absence without suspending someone's access, and dropping it would collapse "away" into
"suspended under investigation" (EM-09). `Archived` is the historical tier that `Terminated` alone does not
express. **If this table and employee-domain §3 ever disagree again, employee-domain wins and this one is a
defect** (SM-07).

**Rule SM-49.** There is no `Locked` state for the employee. A lockout is a **login-attempt** record, not an
employee state (RF-19). An employee is not locked out of the business; a credential is throttled. **Conflating
them means a password attack locks a real employee out of their job**, which is a denial-of-service against the
store by an anonymous attacker.

**Rule SM-50.** A reactivation (`Suspended` → `Active`) is audited and reason-bearing. Firing and rehiring the
same person within a week is a legitimate thing, and it leaves a trail.

---

## 11. `Payment`

Defined in [payment-domain.md](payment-domain.md) §4.

```
           ┌──────────► Failed
           │
Pending ───┼──► Authorized ──► Captured ──► (no outgoing edge except a linked Refund)
           │          │
           │          └──► Voided
           │
           └──► Declined (retryable)
```

**Rule SM-51.** `Captured` has **no outgoing edge** except to a linked `Refund`, asserted on the graph (PY-12,
SM-05). A `Refunded` state exists on the *refund* machine, not as an edge out of a payment.

**Rule SM-52.** `Timeout` is **not** a state; a timeout leaves the payment `Pending` and it is reconciled
(PY-11, PY-41). A payment that timed out and became `Failed` is a charge the customer disputes.

**Rule SM-53.** `Declined` and `Failed` payments are retryable by writing a new `Payment`; the `Failed` record
itself is terminal; `Voided` and `Captured` are terminal for the payment machine.

**Rule SM-54.** Payment state is a **reconciliation of provider events and the local record** (PY-15). The local
transition alone does not make a payment captured; a provider confirmation does, and the machine's projection is
the reconciliation of both.

---

## 12. `Shift` (cash)

Defined in [cash-management.md](cash-management.md) §2.

```
Open ──► Reconciling ──► Closed ──► Reopened ──► Reconciling
  ▲            │
  └────────────┘
```

| State | Meaning |
|---|---|
| `Open` | Counting, trading, money present |
| `Reconciling` | Count in progress, drawer opened for counting (CD-21) |
| `Closed` | Counted, balanced or variance accepted |
| `Reopened` | A closed shift revisited for investigation. **A status, not a terminal state** (CD-26) |

**Rule SM-55.** The only forward path is `Open` → `Reconciling` → `Closed`, and the count happens in
`Reconciling` with the expected amount hidden (CD-21, CD-31).

**Rule SM-56.** `Reopened` → `Reconciling` → `Closed` is the only way back into the machine, and reopening
requires a reason and is reported (CD-26). It is a deliberate act against a money record, not a convenience.

**Rule SM-56a — `Reopened` is a state on the machine, not a synonym for "closed".** cash-management §2 lists
`Reopened` among the shift's four statuses, so it is a state this machine occupies. An earlier revision of §21
filed `Reopened` in the **terminal** column with the note "the only way back", which asserted a terminal state
with an outgoing edge — the exact defect SM-05 and SM-75 exist to catch, present in the table performing the
check. The status is non-terminal, and the only edge out of it is to `Reconciling`.

**Rule SM-57.** A `Closed` shift is immutable except for the `Reopened` edge (CD-26, BI-08). The counted
amount, the variance, and the reason are never edited — a new `Reconciling` pass is a new pass with its own
count, and the original count stands as history.

**Rule SM-58.** There is no `Void` state for a shift. A shift is money that was present; it does not get voided,
it gets reconciled. (CD-19's ledger-row rule applied to the machine.)

---

## 13. `PosTerminal` and `Device`

Defined in [hardware-domain.md](hardware-domain.md).

```
PosTerminal mode:  Standard | Training | Maintenance     (a field, not a lifecycle)
PosTerminal reach: OutOfService ⇄ InService               (service state)

Device:   Registered ──► Active ──► Degraded ──► Active
             │            │           │
             │            │           └──► Disabled (Device.Disable)
             │            ├──► Offline (no heartbeat, PT-04 — not a fault, not Disabled)
             │            └──► Retired (terminal, never deleted, HD-08)
             └──► Retired
```

**Rule SM-59.** A `PosTerminal` carries two distinct things that an earlier revision of this section collapsed
into one graph. First a **mode** — `Standard`, `Training`, or `Maintenance` (organization-model §6) — which is a
configuration field, not a lifecycle step: a terminal in `Training` may not complete a real sale, move stock, or
tender (PT-03), and changing mode is audited. Second a **service state**, where out-of-service refuses a sale.
**The `Active` / `InService` / `OutOfService` graph this section used previously corresponds to no owning
document**: `Active` and `InService` are not a `PosTerminal` status in either organization-model §6 or
hardware-domain §2. The owner names the mode field, and the *device* status set below.

**Rule SM-60.** A `Device` is `Registered`, `Active`, `Degraded`, `Offline`, `Disabled`, or `Retired`
(hardware-domain §2). It is **not** a business document and has no bearing on stock, money, or permissions
(HD-02, HD-05). The previous `Provisioned` / `Connected` / `Disconnected` / `Faulty` set this section used is
not the owner's: `Provisioned` is `Registered`, and `Disconnected` is `Offline` — a distinction that matters,
because PT-04 is explicit that a terminal whose power is off overnight is `Offline` and **not** `Disabled`.
Reporting a powered-off store as a device fault pages someone at 03:00 for nothing.

**Rule SM-60a — `Degraded` is a real and necessary state.** A device that still mostly works is `Degraded`, not
`Disabled`, because disabling a jam-prone printer means no receipts at all (HD-07). **Rule SM-60b — `Offline` is
not `Disabled`.** `Offline` is derived from a missed heartbeat and clears when the heartbeat resumes; `Disabled`
is an administrator's decision, is audited, and requires `Device.Disable` (HD-).

**Rule SM-61.** Device state is health telemetry, not a business fact. A `Degraded` scanner does not mark the
transaction it failed to scan as anything; the cashier uses the keyboard (HD-19's graceful-degradation rule).

---

## 14. RFID `ReadEvent` and `Session`

Defined in [rfid-domain.md](rfid-domain.md).

```
Session:  Opened ──► Closed (reason)

ReadEvent: Created ──► (immutable; the tag match, if any, is a separate edge)
```

**Rule SM-62.** A `ReadEvent` is immutable from creation (BI-08), and is never deleted (BI-40). It records a tag read; it does not resolve to
a product, and a read never transitions stock (RF-05, BI-32).

**Rule SM-63.** An RFID `Session` is `Opened` or `Closed`; there is no `Paused`, and a reader that stops
responding closes its session with a reason rather than leaving it open (RF-16).

---

## 15. `OfflineQueue` entry and sync

Defined in [offline-pos-domain.md](offline-pos-domain.md).

```
Queued ──► Uploading ──► (Applied | AppliedWithAdjustment | Rejected)
                    │           │              │                  │
                    │           └──► terminal  └──► terminal       └──► DeadLetter
                    └──► Queued (retryable, backoff)
```

| State | Meaning |
|---|---|
| `Queued` | Held locally, durable, not yet uploaded |
| `Uploading` | An upload is in flight |
| `Applied` | The server accepted it as-is. Terminal |
| `AppliedWithAdjustment` | Accepted, but the server changed something. Terminal, and visible (OF-36) |
| `Rejected` | The server refused it. Terminal, and the cashier is told (OF-35) |
| `DeadLetter` | Retries exhausted. Terminal. Needs a person (OF-26) |

**Rule SM-64.** There is **no `SyncFailed` state that means "try later automatically forever"** — retries are
bounded and a dead-lettered item needs a person (OF-26, HD-19's at-least-once shape).

**Rule SM-64a — `DeadLetter` is a *failure* outcome, not a fourth acceptance outcome, and the two documents now
say so.** offline-pos-domain `OF-29` states that a synced item has exactly three outcomes — `Applied`,
`AppliedWithAdjustment`, `Rejected` — and no fourth. That statement is about the **result of a sync attempt**,
where the server either accepted it, accepted it changed, or refused it. `DeadLetter` is what the *client* does
when retries against an attempt are exhausted, and it is reachable from **any** of those states by the client,
not by the server's verdict. These are two different machines' worth of decision, conflated into one state list
here. **The correction is that `DeadLetter` is a client-side retention state, not a fourth server outcome**, and
the two documents are reconciled on that reading: the server still returns exactly one of three outcomes
(OF-29), and a client entry that exhausts its retries becomes `DeadLetter` and waits for a person (OF-26). The
server **never sees** `DeadLetter` (decided D-07): the server-side synchronization result vocabulary remains
exactly `Applied`, `AppliedWithAdjustment`, `Rejected`, and the `any → DeadLetter` edge audits `—` (D-06),
because it is client-side retention, not a server business event.

**Rule SM-65.** `AppliedWithAdjustment` is a distinct terminal state from `Applied` and it **must be visible to
the staff who made the sale** (OF-36). An offline sale silently altered by the server is a sale the cashier
cannot explain to the customer.

**Rule SM-66.** A `Rejected` item is **not** deleted from the queue; it is retained as evidence with a reason
(OF-35, SM-08). The cashier's copy of a refused sale is how they tell the customer.

**Rule SM-67.** An offline sale that **cannot** be synced because the store is closed and the cache is sealed is
`Queued` until the next online window, and the seal records the count (OF-31).

---

## 16. `ApprovalRequest`

Defined in [approval-workflows.md](approval-workflows.md) §2.

```
Pending ──► Approved (terminal)
   │     ├─► Rejected (terminal)
   │     ├─► Expired (terminal)
   │     └─► Cancelled (terminal)
```

**Rule SM-68.** `Pending` is the only non-terminal state, and every exit is terminal (AP-05's principle, SM-05).

**Rule SM-69.** The request is **immutable once submitted** (AP-03). A `Pending` request's payload never
changes, so an approver reads exactly what was proposed.

**Rule SM-70.** `Expired` is a distinct terminal state from `Rejected` (AP-23). Expiry is not a denial.

**Rule SM-71.** Every edge out of `Pending` records a reason and is audited (AP-10, AP-11).

---

## 17. `Notification`

Defined in [notification-domain.md](notification-domain.md).

```
Unread ──► Read
   │         └──► (may remain Unacknowledged)
   │
   └──► Acknowledged (may or may not have been Read first)
```

**Rule SM-72.** `Read` and `Acknowledged` are **independent**, not a sequence (NT-28). A notification can be
acknowledged unread, and can be read unacknowledged. The inbox is the unacknowledged set (NT-27).

**Rule SM-73.** Acknowledging never performs the action (NT-29). The notification machine has no edge into any
business machine, and this is why the two are separate documents.

**Rule SM-74.** Expiry is **not** a state (NT-30). A notification expires by retention, not by a user action, and
the record it pointed at is the durable one.

---

## 18. `StockTransfer` — two documents, one conserved total

Defined in [inventory-domain.md](inventory-domain.md) §8. A transfer is **not** one entity with a status: it is
a `StockTransfer` header plus an `Out` movement and an `In` movement, and the pair is the invariant.

```
StockTransfer (header)
  Draft ──► PendingApproval (if required) ──► Approved ──► InTransit ──► PartiallyReceived ──► Received ──► Closed
    │            │                │             │               │
    │            │                │             │               └──► Closed  (balance written off, IV-41)
    │            │                └──► Cancelled
    │            └──► Rejected
    └──► Cancelled   (before dispatch only)
```

| State | Meaning |
|---|---|
| `Draft` | Editable. No stock has moved |
| `PendingApproval` | Submitted, awaiting a decision where a threshold applies |
| `Approved` | Cleared to ship |
| `InTransit` | The `Out` movement is written and stock sits in the `Transit` location. **Not cancellable** |
| `PartiallyReceived` | Some lines received. In-transit balance is still non-zero |
| `Received` | All lines received. The `Out`/`In` pair is complete |
| `Closed` | Terminal. Received, or the residual balance written off with a reason |
| `Rejected` | Terminal. The approval said no |
| `Cancelled` | Terminal. `Draft` only |

**Rule SM-77 — conservation is a ledger property, not a check.** The `Out` at the source and the `In` at the
destination always sum to the same organization total (BI-13). A transfer that appears to "lose" stock is a bug,
not a state to be represented.

**Rule SM-77a — the state set is the owner's, verbatim.** IV-43 defines the transfer as `Draft` →
`PendingApproval` (if required) → `Approved` → `InTransit` → `PartiallyReceived` → `Received` → `Closed`, plus
`Cancelled` before dispatch. An earlier revision of this section used `Draft` / `Dispatched` / `Received` /
`Discrepancy` / `Cancelled`. Three of those are the owner's and two are not. `Dispatched` is the owner's
`InTransit`: the rename matters because **the goods are somewhere else**, and IV-39 puts them in a real `Transit`
`StorageLocation` that is counted in valuation. A state named `Dispatched` reads as "we did something" rather
than "it is in the van", and an implementation that treats it as instantaneous gets IV-39's whole two-step
model wrong. `Discrepancy` is **not a state on the transfer at all** — IV-41 resolves a discrepancy with a
separate reason-bearing `StockAdjustment` against the in-transit balance, and then closes the transfer. Making
discrepancy a state would mean the transfer's own state records a condition whose resolution lives in another
document.

**Rule SM-78 — an in-transit transfer is never cancelled.** Cancelling after dispatch would delete an `Out`
movement. The correction is a compensating transfer, or a `StockAdjustment` against the in-transit balance
(IV-41, BI-08).

**Rule SM-79 — no cross-store transfer in v1.** The `In` location is always the same store as the `Out` location
(MS-25). A v2 cross-store transfer needs an inter-store credit and a pricing decision; neither exists.

**Rule SM-80 — the shortfall pseudo-batch travels with the transfer.** If the `Out` draws the designated
shortfall pseudo-batch (IV-19a), the `In` receives the same pseudo-batch, because the destination has no real
batch to attribute that quantity to.

---

## 19. `StockCount` — a count is an observation, then a document

Defined in [inventory-domain.md](inventory-domain.md) §9. Two entities: the `CountSheet` (observation, freely
edited while open) and the `StockCount` (the posting document, immutable once posted).

```
CountSheet   Open ──► Posted ──► (terminal, immutable)
                 └──► Cancelled

StockCount   Open ──► Posted ──► (terminal)
                 │         └──► Reversed (compensating, never edited)
                 └──► Cancelled
```

| State | Meaning |
|---|---|
| `Open` | Counting. Lines added, expected quantities re-read, nothing posted |
| `Posted` | Terminal. Variance movements written, `StockItem` updated |
| `Reversed` | Terminal. A compensating `COUNT_VARIANCE_REVERSAL`, with a reason |
| `Cancelled` | Terminal, `Open` only. The sheet was abandoned; no movement was ever written |

**Rule SM-81 — expected quantity is never an input.** The system reads the ledger balance; the counter reads the
shelf. `Posted` writes the **counted** quantity, and the difference becomes `COUNT_VARIANCE_IN` /
`COUNT_VARIANCE_OUT` (IV-28). A counted quantity is never negative (IV-29).

**Rule SM-82 — a count is never re-posted.** A wrong count is `Reversed` and re-counted. Editing a posted count
would make the ledger disagree with its own history (BI-08, BI-12).

**Rule SM-83 — movements during an open count are flagged on the sheet, not blocked.** The counter is warned that
the shelf may have moved under them; the movement still happened (IV-27).

**Rule SM-84 — a count cannot resolve a negative balance by counting upward.** A count may only observe; where
the resolution is an adjustment that increases stock, IV-38 applies.

---

## 20. `RfidCredential` — a tag's binding, not the person's status

Defined in [rfid-domain.md](rfid-domain.md). The credential is the **binding of a tag to a subject**; the
person's own employment or customer status is owned elsewhere (employee-domain, customer-domain).

```
Unassigned ──► Issued ──► Active ──► Suspended ──► Active
                  │         │            │
                  │         │            └──► Revoked
                  │         └──► Revoked  (lost, replaced, transferred)
                  ├──► Superseded ──► Issued  (a newer credential replaces this one)
                  └──► Revoked
```

| State | Meaning |
|---|---|
| `Unassigned` | The tag exists, bound to no subject. Not usable |
| `Issued` | Bound to a subject, not yet presented |
| `Active` | In service. A read asserts identity and nothing more (BI-33) |
| `Suspended` | Temporarily not valid — a leave, a fraud hold, an investigation. Reversible |
| `Superseded` | A replacement credential has taken over. Retained, not deleted |
| `Revoked` | Terminal. Lost, replaced, transferred, or the subject ended |

**Rule SM-85 — revoking a credential is not revoking the person.** A lost tag ends the tag. The employee
continues to exist, with their attendance, roles, and history intact. The two are separate lifecycles
(BI-40).

**Rule SM-86 — a revoked tag is never re-issued to a different subject.** Tag identity is permanent; a
replacement is a new tag. Re-binding a tag's history is how a former employee's attendance becomes the next
person's.

**Rule SM-87 — a read is never an authorization.** `Active` is required for the read to be *accepted*; whether
the read permits an action is a separate server-side permission check (BI-33, BI-22). No edge in this machine
grants a permission.

**Rule SM-88 — a suspended credential is readable but not usable.** The read is recorded for the investigation;
it does not open a door and it does not clock in. Recording it is what makes a fraud pattern visible.

**Rule SM-88a — the state set is the owner's, verbatim.** RFID credential states are `Unassigned`, `Issued`,
`Suspended`, `Revoked`, `Superseded` (rfid-domain). An earlier revision of this section used an `Active` state
that **the owner does not define**, and omitted `Unassigned` and `Superseded`; §21 then listed only the three it
had invented. `Unassigned` is not a formality — a tag in the box that has never been bound must not read as a
valid credential, and a machine that begins at `Issued` has nowhere to put one. `Superseded` is what keeps
`Superseded` distinct from `Revoked` when a credential is replaced for a routine reason rather than a security
one. RF-26 requires every credential transition to be reason-bearing and audited, so a replacement is recorded
rather than erased.

---

## 21. The consistency check

The whole set, at a glance. Every state name below is the **owning document's** state name (SM-07); where the
two documents disagreed, the owner won and this table was corrected.

| Machine | Non-terminal states | Terminal | Reversible? |
|---|---|---|---|
| `Product` | `Draft`, `Active`, `Discontinued`, `OutOfStock`, `Hidden` | `Archived` | `Discontinued` → `Active` only. **No** `Archived` → `Active` (PR-47) |
| `StockBatch` | `Active`, `Quarantined`, `Blocked` | `Depleted`, `Expired` | `Quarantined` → `Active`, `Blocked` → `Quarantined` |
| `PurchaseOrder` | `Draft`, `PendingApproval`, `Approved`, `Ordered`, `PartiallyReceived`, `Received` | `Closed`, `Rejected`, `Cancelled` | **No** |
| `PurchaseReceipt` | `Draft` | `Received`, `Cancelled` | **No** |
| `SupplierInvoice` | `Draft`, `Matched`, `Disputed`, `ApprovedForPayment`, `Scheduled`, `Failed` | `Paid`, `Rejected`, `Cancelled` | `Failed` retried only |
| `Sale` | `Completed`, `PartiallyReturned` | `Returned`, `Voided` | **No.** Post-sale states are a projection of the line counters (SP-66) |
| `Return` | `Draft`, `Posted`, `Settled` | `Closed`, `Cancelled` | **No** |
| `Refund` | `Draft`, `PendingApproval`, `Approved`, `Processing`, `Failed` | `Completed`, `Cancelled` | `Failed` retried to `Processing` only |
| `Employee` | `Active`, `OnLeave`, `Suspended` | `Terminated`, `Archived` | `Suspended` → `Active`, `OnLeave` → `Active` |
| `Payment` | `Pending`, `Authorized`, `Declined` | `Captured`, `Voided`, `Failed`, `Refunded` | `Declined` retried as a **new** `Payment` (PY-54) |
| `Shift` | `Open`, `Reconciling`, `Closed`, `Reopened` | — none; it is not an ending | `Reopened` → `Reconciling` (CD-26) |
| `PosTerminal` | *mode field* `Standard` \| `Training` \| `Maintenance` | — not a lifecycle | n/a; the service state is the `Device` machine below |
| `Device` | `Registered`, `Active`, `Degraded`, `Offline`, `Disabled` | `Retired` | `Degraded` → `Active`, `Disabled` → `Active` |
| `ReadEvent` | `Created` | Immutable | **No** |
| `RfidSession` | `Opened` | `Closed` | **No** (SM-63) |
| `OfflineQueue` | `Queued`, `Uploading` | `Applied`, `AppliedWithAdjustment`, `Rejected` *(client-side: `DeadLetter`)* | `Uploading` → `Queued` |
| `ApprovalRequest` | `Pending` | `Approved`, `Rejected`, `Expired`, `Cancelled` | **No** |
| `Notification` | `Unread`, `Read`, `Acknowledged` | — none; expires by retention (NT-30) | n/a; `Read` and `Acknowledged` are independent (NT-28) |
| `StockItem` | — | — | **No machine.** Policy projection |
| `StockTransfer` | `Draft`, `PendingApproval`, `Approved`, `InTransit`, `PartiallyReceived` | `Received`, `Closed`, `Rejected`, `Cancelled` | **No** after `InTransit`; the correction is a compensating transfer or an adjustment (IV-41) |
| `StockAdjustment` | `Draft`, `PendingApproval`, `Approved`, `Posted` | `Reversed`, `Cancelled` | `Posted` → `Reversed` only, never edited (IV-32) |
| `StockCount` | `Open` | `Posted`, `Reversed`, `Cancelled` | `Posted` reversed only, never edited |
| `RfidCredential` | `Unassigned`, `Issued`, `Suspended`, `Superseded` | `Revoked` | `Suspended` → `Issued` |
| `CustomerAccount` | `Active`, `OnHold`, `CreditBlocked` | `Closed` | `OnHold` → `Active`. `CreditBlocked` exit is **`OPEN DECISION`** (SM-45c) |

**Rule SM-75 — what this table has actually been checked for, and what it has not.** The four original claims are
restated here as they stand after the Phase 1 correction pass, because an earlier revision claimed all four
passed and **three of them did not**.

| Check | Status after correction |
|---|---|
| A terminal state with an outgoing edge | **Passes, after two corrections.** `Shift`/`Reopened` and `CustomerAccount`/`CreditBlocked` were both filed as terminal with outgoing edges. Both are non-terminal (SM-56a, SM-45c) |
| A machine with no terminal state | **Passes for 18 of 21.** `Shift`, `Notification`, and `PosTerminal` have none — and that is **correct**, not a defect: a shift is reconciled rather than ended (SM-58), a notification expires rather than ending (NT-30), and a terminal's mode is a field. This is a deliberate result, not an unfixed gap |
| An irreversible machine with a deletion path | **Passes.** No machine in this set offers a delete edge. Two documents said otherwise in prose and were corrected: `PR-Q06` permitted deleting a draft PO (now `PR-Q06a`, cancel-not-delete), and OF-29's three-outcome enumeration conflicted with the offline queue's state list (now `SM-64a`) |
| A state reachable only through a deletion | **Passes.** Nothing is reachable by deletion, because nothing is deletable (SM-08) |
| Every state name matches its owning document | **Does not pass; 9 machines corrected in this pass:** `Product` (`Retired` → `Archived`; `OutOfStock`/`Hidden` restored), `StockBatch` (`WrittenOff` removed, `Blocked` added), `Sale` (`PartiallyRefunded`/`Refunded` → `PartiallyReturned`/`Returned`), `Return` (`Received`/`Inspected`/`Dispositioned`/`Rejected` → the owner's four-state chain), `Refund` (`Pending`/`Rejected` → `PendingApproval`/`Approved`/`Processing`), `Employee` (`Invited` removed; `OnLeave`/`Archived` added), `Shift` (`Reopened` reclassified non-terminal), `PosTerminal`/`Device` (invented states replaced with the owner's), `RfidCredential` (`Active` removed; `Unassigned`/`Superseded` added), `StockTransfer` (`Dispatched` → `InTransit`; `Discrepancy` removed as a state). `StockAdjustment` and `RfidSession` were **added** — owner machines this document had omitted entirely. `Notification` and `StockCount` had **no owner state list at all**; both sets are now owned — Notification by D-08 (notification-domain §7) and StockCount by D-09 (inventory-domain §8.3) |
| Every transition has all eight attributes | **Does not pass.** This was never checked before. §22 records the result per transition, and the **permission and side-effect columns still carry `OPEN DECISION` cells** (SM-02a, SM-02c). The audit cells were decided by D-06 and the last one (`OfflineQueue` → `DeadLetter`) by D-07 — **the Audit column has no remaining `OPEN DECISION` cell** |

**Rule SM-75a — a check that has not been performed is not reported as passing.** The last row is the reason this
rule changed. A "consistency check" that asserts its own success in prose is a comment, not a check: it cannot
fail, so it cannot find anything. **The check is the table, and the table now states what failed.**

**Rule SM-76.** Two things deliberately have **no** machine — a `StockItem` and a `CustomerAccount`'s balance —
because each is a projection of a ledger rather than a decision. The customer's **status** does have one (§9);
only the money does not. **The absence of a machine is a design decision, not an omission**, and it is the reason
the numbers in this system cannot disagree with each other.

---

## 22. Transition contracts — the eight attributes, per transition

**Rule SM-02a applies here.** Every transition in §1–§20 is listed with the eight attributes from §0a. `—` means
the attribute genuinely does not apply to that edge and the rule text says why. **`OPEN DECISION` means Phase 1 did
not determine it**, and per SM-02c it blocks Phase 2 only where it sits in the **Permission**, **Side effect**, or
**Audit** column; `OPEN DECISION` in **Precondition** is a hardening item.

### 22.0 How to read the Permission and Actor attributes

**Rule SM-02d applies here.** This section records what was verified about the Permission column, including what
failed.

Checked mechanically against the [permission catalogue](actors-and-roles.md) §2 (**117 atomic permissions**,
2.1–2.12). A previous revision of this section claimed that only catalogue keys appeared in a Permission cell.
**That claim was false and has been withdrawn.** The verified position, over all **118** transition rows in
§22.1–§22.20 (see the note below the table):

| Permission cell | Rows | Status |
|---|---|---|
| Names only keys defined in catalogue §2 | 38 | usable |
| Names a key reachable only through a §4 wildcard template grant | 29 | **resolved (D-01)** — every one of these keys is defined in §2; see §22.0.1 |
| `OPEN DECISION`, no key at all | 27 | open — blocks those transitions' features per SM-02c; see §22.0.2 |
| System edge, no permission | 23 | correct; not user-actionable |
| **Total transition rows** | **118** | the buckets now sum to **117**, one short of the 118-row body. The earlier census read `38+29+29+23 = 119` against the same 118 rows, i.e. one **over**. Correcting `29 → 27` moved the discrepancy from one over to one under, which means one row sits in no bucket. The discrepancy is recorded here rather than closed by adjusting a count to make the arithmetic balance |

> **Correction, 2026-09-29 (Constitution Enforcement Test).** This table previously read `29` for the
> `OPEN DECISION` bucket, and carried a second bucket of `29` rows marked `‡` and described as
> "a key **not defined** in catalogue §2 — **Phase 2 blocker**". **Both of those claims were wrong, in opposite
> directions, and both are corrected here.** The `‡` claim was refuted: all 13 keys the `‡` rows named **are** defined
> in `actors-and-roles.md` §2 (at lines 39, 59, 61, 72, 105, 126, 146, 152) and resolve through the existing
> wildcard template grants; the 29 `‡` markers have been removed from the transition rows. The `OPEN DECISION` count
> was 27, not 29, when counted mechanically over the §22 tables. Neither original count is deleted from this record.

**Actor.** Actor is not given as a per-row column, and that is deliberate. The catalogue maps **role templates to
permission sets** (§4), not permissions to a single role: `Inventory.Adjust` is held by Store Manager, Assistant
Manager, Inventory Manager and Warehouse Manager, so a per-row actor naming one of them would be an invention, and
naming all four on 130 rows would be unreadable. The binding rule is therefore:

> **Actor = the role template that holds the Permission key**, resolved at run time against the signed-in user's
> role assignments. Where the Permission cell is `OPEN DECISION`, the Actor is `OPEN DECISION` too. Where the
> edge is a system edge, the Actor is the System / Device Administrator, never a person acting manually.

Where an owning document *does* name a specific actor for an edge, that is stated in the machine note above the
table and it wins over the template default.

**Rule SM-02d.** A transition whose permission key is required but genuinely absent from the access model is a
`MISSING DEPENDENCY` in the same class as the 18 found by the Phase 1 semantic audit, and it blocks Phase 2 for that
transition. It is not closable by renaming it to a near neighbour: `Product.Edit` is not `Product.View`,
`Employee.Edit` is not `Employee.View`, and `Purchase.Order.Send` is not `Purchase.Order.Create`. An access model
gap is repaired by deciding who holds the capability, and Phase 1 has no basis for that decision. **The 13 keys
once believed to be in this class are not: D-01 confirmed they exist, and the owner kept all 13 exactly as written.**

### 22.0.1 The 13 keys that §22 required — **all defined; resolved by D-01**

*Original heading: "Permission keys required by §22 and absent from catalogue §2". The heading's claim was false and
is retained here only as the historical record of what was believed.*

| Key | Machines needing it | Position in `actors-and-roles.md` (verified 2026-09-29) |
|---|---|---|
| `Product.Edit` | `Product` (5 edges: activate, discontinue, reactivate, hide, unhide) | **Defined in §2** (line 39); held via the `Product.*` template wildcard |
| `Purchase.Order.Submit` | `PurchaseOrder` | **Defined in §2** (line 59); held via the `Purchase.*` wildcard (excluding `.Pay`) |
| `Purchase.Order.Approve` | `PurchaseOrder` (approve, reject) | **Defined in §2** (line 59); `Purchase.Order.*` separation of duties is enforced explicitly by D-01 |
| `Purchase.Order.Send` | `PurchaseOrder` (send to supplier) | **Defined in §2** (line 61); D-01 records the separation-of-duty requirement explicitly rather than assuming it |
| `Customer.Edit` | `CustomerAccount` (place on hold, close) | **Defined in §2** (line 72); held via the `Customer.*` wildcard |
| `Employee.Create` | `Employee` (creation → `Active`) | **Defined in §2** (line 105); held via the `Employee.*` wildcard (excluding `.Terminate`) |
| `Employee.Edit` | `Employee` (leave, suspend, archive) | **Defined in §2** (line 105); held via the `Employee.*` wildcard |
| `Device.Register` | `PosTerminal` (registration → `Registered`) | **Defined in §2** (line 126); held via the `Device.*` wildcard |
| `Device.Edit` | `PosTerminal` (mode change ×3, activate, retire) | **Defined in §2** (line 126); held via the `Device.*` wildcard |
| `Device.Disable` | `PosTerminal` (→ `Disabled`) | **Defined in §2** (line 146); held via the `Device.*` wildcard |
| `Shift.Close` | `Shift` (close, and the two edges into reconciling) | **Defined in §2** (line 152); held via the `Shift.*` wildcard |
| `Inventory.Count.Post` | `StockAdjustment` (post, reverse) | **Defined in §2** (line 146 area, `Inventory.*`); held via the `Inventory.*` wildcard |
| `Inventory.Transfer.Receive` | `StockTransfer` (receive part, receive all) | **Defined in §2** (line 146 area, `Inventory.*`); held via the `Inventory.*` wildcard |

What is true of all 13, and is the only thing D-01 needed to settle: **none is granted as a standalone permission in
the §4 role-template section; each is reachable only through a wildcard template grant.** D-01 chose option (a) —
keep all 13 keys exactly as written and assign them through the existing wildcard grants — and attached binding
separation-of-duty conditions to the `Purchase.Order.*` group. 8 of the 13 machines are affected, and the majority
of the affected edges are lifecycle edges — activate, hide, suspend, archive, post, receive, close, register,
retire. These are not exotic edges, and the effective access model now authorizes all of them.

### 22.0.2 The 27 transitions that name **no** permission key

*This population was never registered anywhere before 2026-09-29. It is distinct from the 13 keys above, and
tracking it as GAP-002 alone left it invisible.*

| Machine (§22) | Rows with an `OPEN DECISION` permission |
|---|---|
| §22.2 `StockBatch` | 2 |
| §22.3 `PurchaseOrder` | 7 |
| §22.4 `PurchaseReceipt` | 1 |
| §22.5 `SupplierInvoice` | 5 |
| §22.7 `Return` / `Refund` | 5 |
| §22.10 `Payment` | 3 |
| §22.11 `Shift` | 1 |
| §22.18 `StockTransfer` | 3 |
| **Total** | **27** |

Each of these rows is complete in every other respect — source, destination, trigger, precondition, side effect, and
audit all populated. Only the permission is undecided, so the architecture's specified fallback applies: the
transition **refuses** (§29.1). These are therefore not a schema blocker, but they do block the features whose
edges they carry: cancelling or closing a purchase order, cancelling a goods receipt, disputing or writing off a
supplier invoice, cancelling a return, issuing a refund, and reversing a payment. The owner must name the keys
(`SM-02d` forbids deriving them from a near neighbour). One of them, the `→ ApprovedForPayment` edge, is already
flagged inside D-02 as "**Not assumed**", because using `Purchase.Invoice.Record` would let the person who typed
the invoice also approve it. Tracked as `GAP-036`.

`Purchase.Order.Send` is the one key of the 13 whose external consequence is strongest — it is the moment a
commitment becomes real for a supplier — which is why D-01 made its separation-of-duty condition binding rather
than assumed.

### 22.1 `Product`

Actor: Catalog Manager. Every edge is reason-bearing; `→ Archived` records `Product.Archive` (PR-47) and the
lifecycle edges record `Product.StateChange` (D-06).

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `Active` | activate | `Product.Edit` | Completeness check passes (SM-12) | Searchable, orderable, sellable | `Product.StateChange` | `Active` → `Draft`: **`OPEN DECISION`** |
| `Active` → `Discontinued` | discontinue | `Product.Edit` | Reason | Not orderable; still sellable from held stock (PR-46) | `Product.StateChange` | — |
| `Discontinued` → `Active` | reactivate | `Product.Edit` | Reason (PR-47) | Orderable again | `Product.StateChange` | — |
| `Active` → `Hidden` | hide | `Product.Edit` | Reason. Seasonal or similar | Hidden from operational search | `Product.StateChange` | — |
| `Hidden` → `Active` | unhide | `Product.Edit` | Reason | Visible again | `Product.StateChange` | — |
| any → `Archived` | archive | `Product.Archive` | Reason. Never a delete (PR-47, BI-40) | History preserved; nothing new may reference it | `Product.Archive` | **None.** No `Archived` → `Active` (PR-47) |

`OutOfStock` is not an edge. It is the derived condition "Active, nothing in stock" and has no actor, no
permission, and no transition (product-domain §11).

### 22.2 `StockBatch`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Active` → `Quarantined` | quarantine | `OPEN DECISION` | Reason | Not sellable, not issueable | `Inventory.BatchStateChange` | `Quarantined` → `Active`, reason |
| `Quarantined` → `Blocked` | withhold | `OPEN DECISION` | Reason | As above | `Inventory.BatchStateChange` | `Blocked` → `Quarantined` |
| `Active`/`Quarantined`/`Blocked` → `Depleted` | deplete | *none — system* | `RemainingQuantity` = 0. **Never a user action** (SM-17) | Excluded from FEFO and stock reports; retained (BE-07) | `Inventory.Movement` | **None** |
| `Active`/`Quarantined`/`Blocked` → `Expired` | expire | *none — system* | Business date > `ExpiryDate` at the expiry boundary (SM-18) | Not sellable from the read-time check onward | `Inventory.Movement` | **None** |
| any → FEFO override | override FEFO | `Inventory.FEFO.Override` | Reason, always (BI-25) | A non-FEFO batch is issued | `Inventory.FEFOOverride` | Compensating movement |

**Note.** The quarantine, withhold, and un-quarantine edges have **no permission key in the catalogue at all** —
the nearest are `Inventory.Adjust` and `Inventory.FEFO.Override`, and neither is a quarantine. This is a
Phase 2 blocker (SM-02c): a batch cannot be quarantined by anyone the access model recognises. The entrance
edges record `Inventory.BatchStateChange` (D-06); the exit is a `Inventory.Movement` (BE-38).

### 22.3 `PurchaseOrder`

Actor: Procurement Officer, with the Accountant or Store Manager as approver per PR-Q02.

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `PendingApproval` | submit | `Purchase.Order.Submit` | Reason if the buyer's limit is exceeded | Commits nothing; the PO waits (BI-27) | `Approval.Decided` on exit | — |
| `PendingApproval` → `Approved` | approve | `Purchase.Order.Approve` | Approver ≠ requester (SEP-07) | Committed, not yet sent | `Approval.Decided` | — |
| `PendingApproval` → `Rejected` | reject | `Purchase.Order.Approve` | **Decider's own reason** (AP-10) | None. Terminal | `Approval.Decided` | — |
| `Draft` → `Cancelled` | cancel | `OPEN DECISION` | Reason | None. **Not a delete** (PR-Q06a) | `Purchase.OrderStateChange` | — |
| `PendingApproval` → `Cancelled` | cancel | `OPEN DECISION` | Reason | None | `Approval.Decided` | — |
| `Approved` → `Ordered` | send to supplier | `Purchase.Order.Send` | Reason not required; a send is a fact | The supplier has the commitment | `Purchase.OrderStateChange` | — |
| `Approved` → `Cancelled` | cancel | `OPEN DECISION` | Reason, **no GRN exists** (PR-Q08) | None | `Purchase.OrderStateChange` | — |
| `Ordered` → `PartiallyReceived` | receive part | `Purchase.Receive` | A GRN exists; counted qty < ordered | Receipt state projects the GRNs (SM-21) | `Inventory.Movement` | — |
| `Ordered` → `Received` | receive all | `Purchase.Receive` | A GRN covers every line | As above | `Inventory.Movement` | — |
| `Ordered` → `Closed` | close short | `OPEN DECISION` | Reason (PR-Q09) | The balance is written off | `Purchase.OrderStateChange` | — |
| `Ordered` → `Cancelled` | cancel | `OPEN DECISION` | **No GRN exists** (PR-Q08, BI-41) | None | `Purchase.OrderStateChange` | — |
| `PartiallyReceived` → `Received` | receive rest | `Purchase.Receive` | A further GRN covers every line | As above | `Inventory.Movement` | — |
| `PartiallyReceived` → `Closed` | close short | `OPEN DECISION` | Reason (PR-Q09) | The balance is written off | `Purchase.OrderStateChange` | — |
| `Received` → `Closed` | close | `OPEN DECISION` | Invoiced, or an explicit write-off (SM-22) | The payable is settled or written off | `Purchase.OrderStateChange` | — |

**No edge deletes the PO, in any state** (PR-Q06a, RT-117). **Note.** The four cancel edges and the two close-short
edges have no catalogue key; the nearest is `Purchase.Order.Create` for a draft, and a cancellation key is
`OPEN DECISION`. Phase 2 blocker.

### 22.4 `PurchaseReceipt` (GRN)

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `Received` | receive | `Purchase.Receive` | The PO is `Ordered` (PR-Q08); not already received (SM-26) | **Creates stock only.** No payable (PR-Q22, RT-106). Atomic: no partial state (SM-25) | `Inventory.Movement` | Supplier return, or a reason-bearing `StockAdjustment` |
| `Draft` → `Cancelled` | cancel | `OPEN DECISION` | Reason; nothing received | None | `Purchase.ReceiptStateChange` | — |

### 22.5 `SupplierInvoice`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `Matched` | match | *none — computed* (PR-Q25) | The three documents are present and within tolerance | Match result stored on the invoice for audit | `Purchase.InvoiceStateChange` | — |
| `Draft`/`Matched` → `Disputed` | dispute | *none — computed* | A quantity, price, description, tax, or terms variance | **No payable is created** (RT-110) | `Purchase.InvoiceStateChange` | — |
| `Disputed` → `Matched`/`ApprovedForPayment` | resolve | `OPEN DECISION` | The variance is explained or accepted | As below | `Purchase.InvoiceStateChange` | — |
| `Matched` → `ApprovedForPayment` | approve | `OPEN DECISION` | Tolerance is satisfied or an override is recorded | **The payable is created here** (SM-29) | `Purchase.PayableCreated` | — |
| `ApprovedForPayment` → `Scheduled` | schedule | `OPEN DECISION` | The Accountant's, not the buyer's (PR-Q35) | A payment is planned | `Purchase.InvoiceStateChange` | — |
| `Scheduled` → `Paid` | pay | `Purchase.Pay` / `Supplier.Payment.Record` | Bounded by the outstanding payable (PR-Q34) | Balance falls; partial payment is a balance, not a state (SM-31) | `Purchase.PayableSettled` | Credit note or write-off, `Supplier.Credit.Adjust` |
| `Scheduled` → `Failed` | fail | *none — provider* | The provider refused | **The invoice is held and retried**, never terminal (SM-30) | `Purchase.InvoiceStateChange` | Retry to `Scheduled` |
| any → `Rejected` | reject | `OPEN DECISION` | Reason | None | `Purchase.InvoiceStateChange` | — |
| `Draft` → `Cancelled` | cancel | `OPEN DECISION` | Reason | None | `Purchase.InvoiceStateChange` | — |

**Note — the payable-timing reading is decided; the permission is not.** The `SM-29`/`procurement-domain §5`
reconcile was answered by D-02: the payable is effective at `ApprovedForPayment` (`Purchase.PayableCreated`,
SM-29). What remains `OPEN DECISION` below is the **permission** for `→ ApprovedForPayment`: the nearest key is
`Purchase.Invoice.Record`, which records the invoice and would let the person who typed it also approve it.
**Not assumed.**

### 22.6 `Sale`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(no document)* → `Completed` | complete | `Sale.Create` | The completion transaction succeeds **whole** (SP-02) | Stock out, payment captured, ledger written, all in one transaction | AU-03 floor: `Inventory.Movement` per line, `Payment.Capture` or `Cash.PayOut` for the tender. **Sale-document completion records `Sale.Completed`** (SP-02, D-06) | A `NoSale` is not a reversal |
| `Completed` → `Voided` | void | `Sale.Void` | **No receipt has printed** (SM-34, SP-30) | A `SaleVoid` document; no stock, no money | `Sale.Void` | **None.** A void is not a reversal of a printed sale |
| `Completed` → `PartiallyReturned` | return part | `Return.Create` | A return is `Posted` against at least one line | Status caches the line counters (SP-66) | `Inventory.Movement` | Compensating return |
| `PartiallyReturned` → `Returned` | return rest | `Return.Create` | Every line fully returned | As above | `Inventory.Movement` | Compensating return |

**`Completed` → `Voided` and `PartiallyReturned` → `Voided` are refused** while any return is unreversed (SP-55).
The post-sale states are projections, not edges anyone fires (SM-35, SM-35a).

### 22.7 `Return` and `Refund`

**Return**

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `Posted` | post | `Return.Create` | Lines bounded by the sold quantity (RR-14); the return is still in its window | **Stock moves here** (RR-17, IV-14). Nothing moves before this (BI-27) | `Inventory.Movement` | **None.** A posted return has goods in the building; the correction is a further reason-bearing movement (SM-38) |
| `Draft` → `Cancelled` | cancel | `OPEN DECISION` | Reason; **no goods accepted, no money moved** | None | `Return.StateChange` | — |
| `Posted` → `Settled` | settle | `OPEN DECISION` | Refundable amount is zero, or the remainder is written off with a reason | The return stops accruing refundable value | `Return.StateChange` | — |
| `Settled` → `Closed` | close | `OPEN DECISION` | — | None. Terminal | `Return.StateChange` | — |

**Refund**

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `PendingApproval` | submit | `Sale.Refund` | Within the permitted amount, or a large refund awaits approval (RR-35) | No money effect (BI-27) | `Approval.Decided` on exit | — |
| `PendingApproval` → `Approved` | approve | `Sale.Refund.Large.Approve` | Approver ≠ issuer | Cleared to pay | `Approval.Decided` | — |
| `Approved` → `Processing` | submit to provider | `OPEN DECISION` | The bound permits it (RR-24) | **The amount is held for the whole state** (SM-40) | `Payment.Refund` on exit | — |
| `Processing` → `Completed` | complete | *none — provider* | The provider confirmed | The customer has the money | `Payment.Refund` | **None.** A completed refund is corrected by a further **linked** refund with a reason (BI-09) |
| `Processing` → `Failed` | fail | *none — provider* | A technical failure | The amount stays held; **retryable, and notified** (SM-41) | `Payment.Refund` | Retry to `Processing` |
| `Approved`/`Processing` → `Cancelled` | cancel | `OPEN DECISION` | Reason; nothing settled | The hold is released | `Refund.StateChange` | — |

### 22.8 `CustomerAccount` **status** (not the balance — SM-44)

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Active` → `OnHold` | hold | `Customer.Edit` | Reason. Suspected fraud, dispute, or debt dispute | Service continues **with a note**; a warning appears and a manager is notified (CU-09) | `Customer.StateChange` | `OnHold` → `Active`, reason |
| `Active` → `CreditBlocked` | block credit | `Customer.Credit.Grant` | Reason. Above the limit, or a risk decision | **Credit refused, cash sales still allowed** (CU-09) | `Customer.StateChange` | **`OPEN DECISION` — blocking.** The exit edge and its permission are unspecified (SM-45c) |
| `Active`/`OnHold` → `Closed` | close | `Customer.Edit` | Reason. **Never a delete** (CU-10, BI-40) | History, statements, and receipts still render | `Customer.StateChange` | **None.** Reopening a closed customer is `OPEN DECISION` |

**No edge is taken by a payment, a job, or a client** (SM-45b). A `CreditLimitCheck` result is not a transition
(SM-46). **The balance is never touched by this machine.**

### 22.9 `Employee`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Active` | create | `Employee.Create` | The employee record is valid | May sign in and transact. **There is no `Invited` step** (SM-48a) | `Employee.StateChange` | — |
| `Active` → `OnLeave` | leave | `Employee.Edit` | Reason; approved leave | Read-only sign-in; may not transact | `Employee.StateChange` | `OnLeave` → `Active` |
| `Active` → `Suspended` | suspend | `Employee.Edit` | Reason. Access control, not a judgement (EM-09) | **Blocked at authentication; live sessions revoked immediately** (SM-47) | `Security.SessionEnded` per revoked session | `Suspended` → `Active`, audited and reason-bearing (SM-50) |
| `Active`/`OnLeave` → `Terminated` | terminate | `Employee.Terminate` | **Blocked while an open shift exists** (EM-10). **The only irreversible employee operation** (EM-08) | Authentication permanently refused; documents immutable (EM-11) | `Employee.Terminate` | **None.** Re-hiring is a **new record** (EM-08) |
| `Terminated` → `Archived` | archive | `Employee.Edit` | Reason. Never a delete (BI-40) | Historical only | `Employee.StateChange` | **None** |

### 22.10 `Payment`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Pending` | submit | `OPEN DECISION` | The provider accepts the request | Submitted; no response yet | `Payment.StateChange` | — |
| `Pending` → `Authorized` | authorize | *none — provider* | The provider reserved funds | Funds reserved, not taken | `Payment.StateChange` | `→ Voided` |
| `Authorized` → `Captured` | capture | `OPEN DECISION` | The provider confirmed | **Funds taken. Money has moved** | `Payment.Capture` | **A linked `Refund` only** (SM-51, PY-12) |
| `Pending`/`Authorized` → `Voided` | void | `OPEN DECISION` | Before capture. Requires a permissioned action (PY-13) | No money moved | `Payment.StateChange` | **None.** A new attempt is a new `Payment` (PY-54) |
| `Pending` → `Declined` | decline | *none — provider* | The provider refused | No money moved | `Payment.StateChange` | **Retry as a new `Payment`**, never a reopen (PY-54) |
| `Pending` → `Failed` | fail | *none — provider* | A technical failure, **not** a decline | No money moved | `Payment.StateChange` | **None.** Terminal for this `Payment` (PY-54) |
| `Captured` → `Refunded` | *(not an edge)* | — | Reached only via a linked `Refund` (BI-09) | Money out | `Payment.Refund` | — |

**A timeout is not a state** (SM-52): it leaves the payment `Pending` for reconciliation. **State is a
reconciliation of provider events and the local record** (SM-54, PY-15) — a local transition alone does not
capture a payment.

### 22.11 `Shift`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Open` | open | `Shift.Open` | The opening float is counted (CD-11); **at most one open shift per drawer and per employee per store** (CD-03) | An `OpeningFloat` `Cash.In` is written | `Cash.In` | — |
| `Open` → `Reconciling` | begin count | `Shift.Close` | The drawer is opened for counting; the expected amount is hidden (CD-21) | Nothing yet; the count is in progress | `Shift.StateChange` | — |
| `Reconciling` → `Closed` | close | `Shift.Close` | Counted, and any variance is balanced or **acknowledged** (CD-23) | A `ClosingFloat` is written; the shift is immutable (SM-57) | `Shift.Close` | — |
| `Closed` → `Reopened` | reopen | `OPEN DECISION` | **Reason, always** (CD-26). Exceptional, audited, standing-reported | None. Revisits a closed money record | `Shift.Reopened` | `Reopened` → `Reconciling` |
| `Reopened` → `Reconciling` | recount | `Shift.Close` | A **new** count pass with its own count | The original count stands as history (SM-57) | `Shift.Close` | — |

**There is no void state** (SM-58). A shift is reconciled, never voided.

### 22.12 `PosTerminal` and `Device`

**Mode** — a field, not a lifecycle. `Standard` | `Training` | `Maintenance` (organization-model §6).

| Change | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| → `Training` | set training mode | `Device.Edit` | **A training terminal may not complete a real sale, move stock, or tender** (PT-03) | Excluded from all financial and inventory reports | `Device.ModeChange` | → `Standard` |
| → `Maintenance` | set maintenance | `Device.Edit` | Reason | — | `Device.ModeChange` | → `Standard` |
| → `Standard` | restore | `Device.Edit` | Reason | — | `Device.ModeChange` | — |

**Device status**

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(registration)* → `Registered` | register | `Device.Register` | Capabilities validated at registration | Known, not yet working | `Device.StateChange` | — |
| `Registered` → `Active` | activate | `Device.Edit` | — | In service | `Device.StateChange` | — |
| `Active` → `Degraded` | degrade | *none — telemetry* | Errors reported. **Still usable** (HD-07) | A feature degrades; the transaction does not (SM-61) | `—` — health telemetry, no business fact (SM-61, D-06) | `Degraded` → `Active` |
| any → `Offline` | heartbeat lost | *none — derived* | No heartbeat within the configured interval (PT-04) | **Not a fault and not `Disabled`** — a store whose power is off is not broken (SM-60b) | `—` — derived telemetry (SM-61, D-06) | Clears when the heartbeat resumes |
| `Active`/`Degraded` → `Disabled` | disable | `Device.Disable` | Reason | Turned off by an administrator | `Device.StateChange` | `Disabled` → `Active`, reason |
| any → `Retired` | retire | `Device.Edit` | Reason. **Never a delete** (HD-08, BI-40) | Permanently out of service; full event history remains | `Device.StateChange` | **None** |

### 22.13 `ReadEvent` and `RfidSession`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Created` | record a read | *none — the reader* | Anti-duplication by event id (RF-) | **Immutable from creation. Resolves to no product, and a read never moves stock** (SM-62, RF-05, BI-32) | `Rfid.Event.View` is the *read* permission, not the event | **None** |
| `Opened` → `Closed` | close a reader session | *none — the reader* | A reason if the reader stopped responding (SM-63) | None | `—` — operational, not a business event (AU-14, D-06) | **None.** No `Paused` state (SM-63) |

**A read is never an authorization** (SM-87, BI-33): `Active` is required for a read to be *accepted*, and whether
it permits an action is a separate server-side check. No edge in this machine grants a permission.

### 22.14 `OfflineQueue` entry

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Queued` | enqueue | *none — the terminal* | The document number was allocated locally | Held locally, durable | — | — |
| `Queued` → `Uploading` | upload | *none — the client* | An online window is available | An upload is in flight | — | — |
| `Uploading` → `Applied` | accepted as-is | *none — the server* | The server accepted it | Terminal. Money and stock move server-side | `Offline.SyncApplied` | **None** |
| `Uploading` → `AppliedWithAdjustment` | accepted changed | *none — the server* | The server changed something | Terminal, **and visible to the staff who made the sale** (SM-65) | `Offline.SyncAppliedWithAdjustment` | **None.** A further document, never a re-sync |
| `Uploading` → `Rejected` | refused | *none — the server* | One of the listed exceptional causes (OF-35) | Terminal, and **retained as evidence, never deleted** (SM-66). The cashier is told why | `Offline.SyncRejected` | **None.** A new document, not a retry |
| `Uploading` → `Queued` | retry | *none — the client* | Within the bounded retry policy (SM-64) | Backoff | — | — |
| any → `DeadLetter` | retries exhausted | `Sale.OfflineQueue.Manage` | **The client** exhausts its retries (SM-64a) | Needs a person (OF-26) | `—` client-side retention, not a server business event (D-07) | Manual resolution, reason-bearing |

**The server returns exactly one of three outcomes** — `Applied`, `AppliedWithAdjustment`, `Rejected` — and no
fourth (OF-29). `DeadLetter` is a **client-side** retention state the server never sees (SM-64a; decided D-07).
A sealed cache's items stay `Queued` for the next online window (SM-67, OF-31).

### 22.15 `ApprovalRequest`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Pending` | submit | *the subject's own request key* | The payload is frozen at submission (SM-69, AP-03) | The subject is suspended or flagged where the domain defines it (AP-04) | — | — |
| `Pending` → `Approved` | approve | *the subject's `.Approve` key* | **Approving is a distinct permission from requesting, always** (AP-29). Requester's reason carried | The subject proceeds | `Approval.Decided`, with before and after (AP-11) | — |
| `Pending` → `Rejected` | reject | *the subject's `.Approve` key* | **The decider's own reason** (AP-10) | None. Terminal | `Approval.Decided` | — |
| `Pending` → `Expired` | expire | *none — clock* | Past its deadline with no decision (AP-23) | None. **Expiry is not a denial** (SM-70) | `Approval.Decided` | — |
| `Pending` → `Cancelled` | cancel | *the requester, or the system* | The requester withdrew it, or the subject became moot | None | `Approval.Decided` | — |

**The approver is a decider, not a role.** AP-29 and the [approval subject table](approval-workflows.md) §1 fix
the *shape*; the specific key is the subject's own `.Approve` key (`CashOut` → `Cash.Out.Approve`,
`StockAdjustment` → `Inventory.Adjust.Large.Approve`, and so on). Where a subject in the table has no `.Approve`
key in the permission catalogue, the cell is `OPEN DECISION` — see `CreditLimitOverride` and `RetentionPolicyChange`.

### 22.16 `Notification`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(creation)* → `Unread` | generate | *none — the event* | Generated in the same transaction as the event, or by a job reading it (NT-05) | Resolved by **role and store scope**, never by person (NT-07) | `Notification.Sent` | — |
| `Unread` → `Read` | read | *the recipient* | Following the link is permission-checked (NT-31) | **Reading is not acknowledging** (NT-28) | `—` — a read, not audited (AU-14, D-06) | — |
| `Unread`/`Read` → `Acknowledged` | acknowledge | *the recipient* | **Acknowledging never performs the action** (SM-73, NT-29) | Leaves the inbox (NT-27) | `—` — a read, not audited (AU-14, D-06) | — |

**`Read` and `Acknowledged` are independent, not a sequence** (SM-72, NT-28). **Expiry is not a state** (SM-74,
NT-30): a notification expires by retention, and the record it pointed at is the durable one. **The three states
are now owned by the domain document** — notification-domain §7 enumerates `Unread`/`Read`/`Acknowledged` (owner
decision D-08); read/acknowledge carry no business audit event (AU-14, D-06).

### 22.17 `StockAdjustment` and `StockCount`

`StockAdjustment` (IV-32) was **absent from this document before the correction pass**; it is added here.

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `PendingApproval` | submit | `Inventory.Adjust` | **A reason code, always** (IV-33, BI-25) | No stock effect (BI-27) | `Approval.Decided` on exit | — |
| `PendingApproval` → `Approved` | approve | `Inventory.Adjust.Large.Approve` | Threshold is on **both** absolute quantity and absolute value, whichever is exceeded first (IV-35) | No stock effect yet | `Approval.Decided` | — |
| `Approved` → `Posted` | post | `Inventory.Adjust` | Reason present | **Stock moves.** One-directional per line, non-negative (IV-34) | `Inventory.Adjustment` | `Posted` → `Reversed` |
| `Draft` → `Cancelled` | cancel | `Inventory.Adjust` | Reason | None | `Inventory.Adjustment` | — |
| `Posted` → `Reversed` | reverse | `Inventory.Adjust` | Reason. **A compensating movement, never an edit** | A movement in the opposite direction | `Inventory.Adjustment` | **None** |

**IV-37 — no self-service adjustment.** `Inventory.Adjust` is not in the Cashier or Senior Cashier templates, and
that is structural rather than configurable.

`StockCount` — the owner defines the count sheet (IV-25, IV-26) and posting (IV-28, IV-30) and now enumerates the
**four states** (owner decision D-09, inventory-domain §8.3): `Open`, `Posted`, `Cancelled`, `Reversed`.

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Open` → `Posted` | post | `Inventory.Count.Post` | A reason code per variance line (IV-28) | `COUNT_VARIANCE_IN` / `COUNT_VARIANCE_OUT` written; **the counted quantity is written, never the expected** (SM-81) | `Inventory.Adjustment` | `Posted` → `Reversed` |
| `Posted` → `Reversed` | reverse | `Inventory.Count.Post` | Reason | A compensating `COUNT_VARIANCE_REVERSAL` | `Inventory.Adjustment` | **None.** Never an edit (SM-82) |
| `Open` → `Cancelled` | cancel | `Inventory.Count.Create` | Reason; the sheet was abandoned, nothing was ever written | None | `Inventory.CountStateChange` | — |
| `Open` → `Open` | add a line, re-read | `Inventory.Count.Create` | Movements since the snapshot are **flagged, never blocked** (IV-27, SM-83) | The snapshot stays frozen at creation (IV-26) | — | — |

**The four state names are now owned by the domain document** — inventory-domain §8.3 enumerates
`Open`/`Posted`/`Cancelled`/`Reversed` (owner decision D-09). `Posted` is immutable; `Reversed` is the compensating-
document edge, never an edit (IV-30, SM-82). IV-28's approval is a **precondition of posting, not a state** — the
`StockCount` machine has no `Approval` state (unlike `StockAdjustment` above, which has `PendingApproval`). The
*behaviour* was already fully specified; the vocabulary is now owned too.

### 22.18 `StockTransfer`

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| `Draft` → `PendingApproval` | submit | `Inventory.Transfer.Create` | Where a threshold applies | No stock effect | `Approval.Decided` on exit | — |
| `PendingApproval` → `Approved` | approve | `OPEN DECISION` | Approver ≠ creator (SEP-08) | No stock effect | `Approval.Decided` | — |
| `Approved` → `InTransit` | dispatch | `Inventory.Transfer.Dispatch` | **The `In` location is in the same organization; the `In` store is the `Out` store in v1** (SM-79) | **`Out` written; the stock sits in the `Transit` location** (IV-39) and is counted in valuation (BI-13) | `Inventory.Movement` | **None.** Not cancellable (SM-78) |
| `InTransit` → `PartiallyReceived` | receive part | `Inventory.Transfer.Receive` | Some lines received; the in-transit balance is non-zero | **`In` written; `Transit` decremented** (IV-39) | `Inventory.Movement` | Compensating transfer |
| `InTransit`/`PartiallyReceived` → `Received` | receive all | `Inventory.Transfer.Receive` | Every line received; **the two sides balance per line** (IV-41) | `Transit` reaches zero | `Inventory.Movement` | — |
| `PartiallyReceived`/`Received` → `Closed` | close | `OPEN DECISION` | Any residual in-transit balance is resolved by a **separate reason-bearing adjustment** (IV-41). A transfer may not close while the balance is non-zero and unreconciled | None | `Inventory.TransferStateChange` | — |
| `Draft` → `Cancelled` | cancel | `Inventory.Transfer.Create` | **Before dispatch only** (SM-78) | None | `Inventory.TransferStateChange` | — |
| `PendingApproval` → `Rejected` | reject | `OPEN DECISION` | The decider's own reason (AP-10) | None | `Approval.Decided` | — |

**Conservation is a ledger property, not a check** (SM-77). Batch identity travels with the transfer, including the
shortfall pseudo-batch (SM-80).

### 22.19 `RfidCredential`

Every edge is reason-bearing and audited (RF-26).

| From → To | Event | Permission | Precondition | Side effect | Audit | Reversal |
|---|---|---|---|---|---|---|
| *(tag creation)* → `Unassigned` | register a tag | `Rfid.Reader.Register` | — | Exists, bound to nothing. **Not usable** (SM-88a) | `Rfid.Credential.StateChange` | — |
| `Unassigned` → `Issued` | issue | `Rfid.Credential.Issue` | Bound to a subject | The tag is valid but unpresented | `Rfid.Credential.StateChange` | — |
| `Issued` → `Suspended` | suspend | `Rfid.Credential.Revoke` | Reason. A leave, a fraud hold, an investigation | **Readable but not usable** (SM-88) | `Rfid.Credential.StateChange` | `Suspended` → `Issued`, reason |
| `Issued`/`Suspended` → `Revoked` | revoke | `Rfid.Credential.Revoke` | Reason. Lost, replaced, transferred, or the subject ended | **Terminal.** The tag is never re-issued to another subject (SM-86) | `Rfid.Credential.StateChange` | **None** |
| `Issued`/`Suspended` → `Superseded` | supersede | `Rfid.Credential.Issue` | A replacement credential has taken over | Retained, not deleted; a new tag carries the binding | `Rfid.Credential.StateChange` | `Superseded` → `Issued` if the replacement is withdrawn (SM-88a) |

**Revoking a credential is not revoking the person** (SM-85): a lost tag ends the tag, and the employee continues
to exist with their attendance, roles, and history intact. **No edge in this machine grants a permission** (SM-87).

### 22.20 `CustomerAccount` **balance** — no machine

Not a transition table, because there is nothing to transition. The balance is a projection of the customer ledger
(CU-11, SM-44, SM-76); a payment, an adjustment, or a job moves the ledger and the balance follows. **The absence
of this machine is a design decision, not an omission** (SM-76).

---

## 23. State machine rules index

| ID | Rule |
|---|---|
| SM-01 | A document's own state is stored, not recomputed from its timestamps |
| SM-01a | Stored does not mean authoritative; a document state may still be a projection of a ledger. The question is which entity owns the number |
| SM-02 | A transition is a named, permissioned operation. No generic setter |
| SM-02a | A transition is specified by eight attributes, or the cell is `OPEN DECISION`. Never guess one |
| SM-02b | The permission column is never empty and never "any" |
| SM-02c | An `OPEN DECISION` cell blocks Phase 2 only in the permission, side-effect, or audit column |
| SM-02d | A transition whose permission key is genuinely absent from catalogue §2 is a `MISSING DEPENDENCY` and blocks that transition. Never rename it to a near neighbour — §22.0.1. **Superseded in part 2026-09-29:** the 13 keys once claimed absent are all defined (D-01) |
| SM-03 | Every transition records prior, new, actor, time, reason, correlation |
| SM-04 | Every transition is idempotent by `ClientOperationId` |
| SM-05 | A terminal state has no outgoing edge. Asserted on the graph |
| SM-06 | An illegal transition is refused with a named message |
| SM-07 | Every machine is a closed, versioned set in its owning document |
| SM-08 | Cancellation and deletion are different; documents are cancelled, never deleted |
| SM-09 | A hold state has a resume edge, a reason, and queue visibility |
| SM-10 | A store boundary is a transaction boundary, not a state |
| SM-11 | A discontinued product is still sellable from existing stock |
| SM-12 | Only `Draft` → `Active` requires the completeness check |
| SM-13 | `Archived` needs a reason and is terminal |
| SM-13a | The `Product` state set is the owner's, verbatim: `Archived` not `Retired`, and `OutOfStock`/`Hidden` are states |
| SM-14 | A stock policy changes only by a movement that breaches it |
| SM-15 | No manual override of a stock policy |
| SM-16 | `Quarantined` is reversible; `Depleted` and `Expired` are not |
| SM-16a | The `StockBatch` state set is the owner's, verbatim: `Blocked` is a state and `WrittenOff` is not |
| SM-17 | `Depleted` is reached by quantity, never manually |
| SM-18 | Expiry is a read-time condition and an auditable stored transition |
| SM-19 | An expiry-required category cannot create a dateless batch; a dateless one sorts last |
| SM-20 | Only `Draft` is editable on a PO; an amendment re-approves |
| SM-21 | A PO's receipt state is a projection of its GRNs |
| SM-22 | `Received` → `Closed` needs an invoice or an explicit write-off |
| SM-23 | `Rejected`, `Cancelled`, and `Closed` are three distinct endings |
| SM-24 | A PO is never deleted, in any state, including `Draft`. A draft is cancelled, never deleted |
| SM-25 | A GRN has one meaningful transition, and it is atomic |
| SM-26 | A GRN is received at most once |
| SM-27 | A GRN creates stock, never a duplicate payable |
| SM-28 | `Disputed` is not `Rejected` |
| SM-29 | The payable is created at `ApprovedForPayment` |
| SM-30 | `Failed` payment is retryable and holds the invoice |
| SM-31 | A partial payment is a balance, not an invoice state |
| SM-32 | There is no draft, pending, or open `Sale` |
| SM-33 | `Completed` is final; changes are compensating documents |
| SM-34 | `Voided` is only before the print; after it, refund and return |
| SM-35 | The post-sale states are a projection of the line counters, and the counters are the owner's names |
| SM-35a | A derived status is still stored; SP-66's rebuild test is what keeps the cache equal to the counters |
| SM-36 | A `Sale` has no `Cancelled` state; "cancelled" is `Voided` |
| SM-37 | A `NoSale` is not a `Sale` and has no state |
| SM-38 | Return and refund are separate machines and separate documents |
| SM-39 | A return and a refund are linked, not nested |
| SM-40 | `Processing` holds a refund's amount against the bound |
| SM-41 | A `Failed` refund is retryable and holds its amount |
| SM-42 | A refused return needs a reason the customer can be told; the owner's state is `Cancelled` from `Draft` |
| SM-43 | `Settled` requires that stock actually moved |
| SM-43a | The `Return` and `Refund` state sets are the owner's, verbatim. A `Dispositioned` step and a `Rejected` state are not the owner's |
| SM-44 | A customer account has no state machine; its balance is a projection |
| SM-45 | The account *standing* is stateful, reason-bearing, and audited |
| SM-45a | `OnHold` warns; `CreditBlocked` is the credit control. They are not the same flag |
| SM-45b | No standing edge is taken by a payment, a job, or a client |
| SM-46 | A credit-limit check is a projection, not a state |
| SM-45c | `CreditBlocked` is a credit control, not a terminal state. Its exit edge and permission are `OPEN DECISION` |
| SM-46 | A credit-limit check is a projection, not a state |
| SM-47 | `Suspended` revokes live sessions immediately |
| SM-48 | `Terminated` is terminal, irreversible, and retains the employee. Re-hiring is a new record |
| SM-48a | The `Employee` state set is the owner's, verbatim: there is no `Invited`, and `OnLeave`/`Archived` are states |
| SM-49 | A lockout is a login-attempt record, not an employee state |
| SM-50 | Reactivation is audited and reason-bearing |
| SM-51 | `Captured` has no outgoing edge except a linked refund |
| SM-52 | A timeout leaves a payment `Pending`; it is never a state |
| SM-53 | `Declined` is retried as a new `Payment`; `Failed`, `Voided`, and `Captured` are terminal |
| SM-54 | Payment state reconciles provider events with the local record |
| SM-55 | A shift's only forward path is open, reconciling, closed |
| SM-56 | Reopening a shift is reasoned, audited, and reported |
| SM-56a | `Reopened` is a state on the shift machine, not a terminal one |
| SM-57 | A closed shift is immutable except for the reasoned reopen edge |
| SM-58 | A shift is never voided |
| SM-59 | A terminal's mode is a field, not a lifecycle; an out-of-service terminal is a refusal, not a broken screen |
| SM-60 | A `Device` status is the owner's set, and is telemetry bearing on no business fact |
| SM-60a | `Degraded` is a real state, and is not `Disabled` |
| SM-60b | `Offline` is derived from a missed heartbeat and is not a fault or a disablement |
| SM-61 | A device failure degrades a feature, not the transaction |
| SM-62 | A read event is immutable and resolves to nothing |
| SM-63 | A reader session closes with a reason, never left open |
| SM-64 | Offline retries are bounded; a dead-lettered item needs a person |
| SM-64a | `DeadLetter` is a client-side retention state, not a fourth server outcome (OF-29) |
| SM-65 | `AppliedWithAdjustment` is distinct, terminal, and visible to staff |
| SM-66 | A rejected sync item is retained as evidence |
| SM-67 | A sealed cache's items stay `Queued` for the next online window |
| SM-68 | `Pending` is the only non-terminal approval state |
| SM-69 | An approval request is immutable once submitted |
| SM-70 | `Expired` is distinct from `Rejected` |
| SM-71 | Every approval exit records a reason and is audited |
| SM-72 | `Read` and `Acknowledged` are independent states |
| SM-73 | Acknowledging a notification never performs its action |
| SM-74 | Notification expiry is retention, not a state |
| SM-75 | The consistency check, restated as what was actually verified. Nine machines had state names their owners do not define |
| SM-75a | A check that has not been performed is not reported as passing |
| SM-76 | The absence of a machine on two things (`StockItem`, a customer balance) is a decision |
| SM-77 | A transfer conserves organization stock as a ledger property, not a check |
| SM-77a | The `StockTransfer` state set is the owner's, verbatim: `InTransit` not `Dispatched`, and `Discrepancy` is not a state |
| SM-78 | An in-transit transfer is never cancelled; the correction is a compensating transfer or an adjustment |
| SM-79 | No cross-store transfer in v1; the `In` location is always the source store |
| SM-80 | The shortfall pseudo-batch travels with the transfer to the destination |
| SM-81 | Expected quantity is never an input to a count; the counted quantity is written |
| SM-82 | A count is never re-posted; a wrong count is reversed and re-counted |
| SM-83 | Movements during an open count are flagged, never blocked |
| SM-84 | A count may not resolve a negative balance by counting upward |
| SM-85 | Revoking a credential is not revoking the person |
| SM-86 | A revoked tag is never re-issued to a different subject |
| SM-87 | A read is never an authorization; the permission check is separate |
| SM-88 | A suspended credential is readable but not usable |
| SM-88a | The `RfidCredential` state set is the owner's, verbatim: no `Active`, and `Unassigned`/`Superseded` are states |
