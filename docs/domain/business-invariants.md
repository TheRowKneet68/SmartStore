# SmartStore — Business Invariants

**Phase 1 — Product & Domain Specification. This is the most important document in the specification.**

An invariant is a rule that must **never** be violated, by any code path, any user, any hardware failure, any
network failure, and any administrator. If a proposed feature appears to require breaking an invariant, the
feature is wrong — or the invariant needs an explicit, reviewed, documented amendment with a migration story.

**Each invariant below states what it is, why it exists, how it is enforced, and how it is proven.** An invariant
with no stated verification method is an aspiration. The *Verification* column is what makes each of these a test
case in a later phase rather than a paragraph in a document.

**Enforcement vocabulary**

| Term | Meaning |
|---|---|
| **Boundary** | Checked at the application boundary, before any state change is attempted |
| **Transaction** | Guaranteed by the database transaction, not by application discipline |
| **Constraint** | Guaranteed by a database constraint (unique, foreign key, check) |
| **Structural** | Cannot be violated because the model does not permit the violating state to exist |
| **Derived** | Cannot be violated because the value is computed rather than stored |

**Severity of the rule** — every invariant is `MUST`. There is no severity tier for invariants.

---

## 1. Money invariants

### BI-01 — Money is exact; no floating point

> No monetary amount may be represented, computed, or stored in a binary floating-point type. Money uses exact
> decimal representation with a recorded currency minor-unit exponent, and rounding is applied at exactly one
> documented point per document type using a single documented mode (half-up).

**Why.** **[P0: D-17]** Two surveyed systems stored money in `Float` and `Double`. Floating-point addition is
not associative, so `0.1 + 0.2 !== 0.3`, and a day's aggregated totals stop matching the sum of its own
transactions. This is not a rounding nuisance; it is a system that cannot be audited.

**Enforcement.** Type-level: the domain's money type is a fixed-scale decimal, not a primitive. A `double` in a
money field is a compile or schema error, not a review comment. Arithmetic helpers expose only
`add`, `subtract`, `multiply`, `allocate`, and each documents its rounding.

**Verification.** Property test: for 10,000 random carts of up to 200 lines each, the document total equals the
sum of the rounded line totals **exactly**, with zero difference. Second test: no money value in the schema
declares a binary-float type.

**The allocation problem.** When a document-level discount is spread across lines, the residual must be assigned
deterministically, not by floating-point luck. Rule: allocate proportionally at full precision, round each line
down, then assign the remaining minor units to lines in ascending line-number order. The result is exact, sums
correctly, and is the same on every replay.

---

### BI-02 — A stock balance is a projection, never an input

> `StockBalance` is a derived projection of `InventoryMovement`. No business operation may set a stock quantity
> directly. Every change to a balance must be accompanied by the movement that caused it, written in the same
> transaction.

**Why.** **[P0: D-09]** A surveyed system kept stock as a mutable integer column with no history. "Why is stock
3?" was unanswerable: a sale, a theft, a data-entry error, and a stocktake correction were indistinguishable. A
business that cannot explain its own stock cannot make a decision about shrinkage, cannot claim an insurance
loss, and cannot satisfy an auditor.

**Enforcement.** Transaction-level. The only way to change a balance is through the movement-writing operation,
which writes movement and applies the delta in one transaction. There is no application code path that sets a
balance without a movement. Balance rows may be **rebuilt** from movements at any time, and a rebuild must
produce a byte-identical result to the incremental maintenance — that equality is the proof.

**Verification.** Test: take a production-like ledger, zero all balances, rebuild from movements, assert equality
with the original balances. Test: static analysis fails the build if any code assigns to a balance quantity
outside the movement module.

---

### BI-03 — Every movement has a cause, and every cause is a document

> Every `InventoryMovement` references exactly one `InventoryTransaction` (the business reason) and one
> document line. No movement exists without both.

**Why.** A ledger with orphan entries is worse than no ledger, because it looks authoritative while being
unexplainable. Movement without a cause cannot be attributed to a sale, a return, a count, or a decision.

**Enforcement.** Structural — both foreign keys are non-null, and the movement-writing API cannot be called
without them.

**Verification.** Test: every movement joins to a transaction and to a document line; zero orphans.

---

### BI-04 — A business operation is atomic

> Each business operation commits all of its effects in **one** transaction: the document header, its lines, the
> stock movements, the balance updates, the payment records, the audit entry, and the notification outbox row.
> Either all of it is visible or none of it is.

**Why.** Partial application is how phantom stock and phantom money appear. A sale that moved stock but lost the
payment, or a receipt that created stock but not the payable, produces a system that disagrees with itself and
with the physical world.

**Enforcement.** Transaction. The unit of work wraps the operation. Hardware calls, network calls, and file
writes are performed **outside** the transaction and their results passed in — a transaction must never be held
open across a network call to a printer or a payment gateway. This is a real design constraint, not an
oversight: it means the printer result arrives first, and the transaction then records it.

**Verification.** Fault-injection test: kill the process at each of N points inside a sale and assert the
database is either fully before or fully after, never in between.

---

### BI-05 — Entry quantities are never negative

> A quantity supplied as *input* must be greater than or equal to zero. A reduction in stock is expressed by
> movement **type and direction**, never by a signed quantity.

**Why.** Two different bugs collapse into one if sign is overloaded: a caller sending `-5` to "add 5", and a
caller sending `-5` to "remove 5". Forbidding negative input makes an entire class of defect unrepresentable.

**Enforcement.** Boundary, plus a check constraint.

**Verification.** Test: every write path rejects a negative quantity with a validation error, never a silent
`Math.abs`.

**Consequence to accept:** a stock balance **may** be negative, because a balance is a sum of movements and a
sale can legitimately exceed stock when the store's `AllowNegative` policy is set (organization-model §3.2).
Negative *input* is forbidden; negative *balance* is a policy decision. These are different things and are
often conflated.

---

### BI-06 — A return is bounded by the original sale line

> The cumulative returned quantity for a sale line may never exceed that line's sold quantity. The check is made
> atomically at the moment of return, in the same transaction that creates the return.

**Why.** **[P0: S-01]** A surveyed system allowed an anonymous return that added quantity to stock with no
upper bound, no positivity check, no link to a sale, and no state change to prevent replay — so one request
could be repeated indefinitely to manufacture stock. The company's entire inventory was wrong, and nothing in
the system recorded why.

**Enforcement.** Transaction + constraint. The sale line maintains a `ReturnedQuantity` counter. The return
operation performs a single conditional update — increment the counter **where `ReturnedQuantity + requested <=
SoldQuantity`** — and aborts if it affects no row. This is atomic under concurrency without an explicit lock.
As a backstop, a check constraint enforces `0 <= ReturnedQuantity <= SoldQuantity` at the database level.

**Verification.** Concurrency test: fire 50 simultaneous returns of the full quantity for one sale line. **All 50
run concurrently; exactly the permitted number succeed; the total returned equals the total sold; the ledger
and the counters agree.** This is the single most important concurrency test in the product.

---

### BI-07 — A return is processed exactly once

> The same physical return may not be recorded twice. A return is uniquely identified by its document number, and
> a repeated submission of the same return form (retry, double-click, sync replay) produces the original return,
> not a second one.

**Why.** Double-clicking "Return" in a browser, or a flaky connection causing a retry, must not create two
returns. Combined with BI-06, a naive implementation would eventually hit the quantity ceiling and *reject* a
legitimate second return of different goods — turning a duplicate-processing bug into a customer-facing failure.

**Enforcement.** Idempotency. Every return carries a client-generated `ClientOperationId` with a uniqueness
constraint. A repeat returns the original document. A second return against the same sale line but a
**different** `ClientOperationId` is a *genuine* second return and is subject to BI-06, not to this invariant.

**Verification.** Test: submit the same return 10 times concurrently; exactly one return exists.

---

### BI-08 — A finalized financial document is never edited or deleted

> A finalized sale, payment, goods receipt, purchase invoice, customer return, refund, stock transfer, or stock
> adjustment may never be updated or deleted. Corrections are made by creating a **compensating document**.

**Why.** This is the invariant that makes the audit trail worth having. If a finalized document can be edited,
then the audit log records a fiction, and every downstream figure — margin, tax, cash reconciliation, supplier
balance — becomes unverifiable. It also makes BI-01 and BI-02 pointless, because a corrected figure with no
trace of the correction is a lie with extra steps.

**Enforcement.** Three layers, deliberately:
1. **Application** — no update or delete operation exists for a finalized document.
2. **Database** — the application role is granted `INSERT` and `SELECT` only on finalized financial tables. No
   `UPDATE`, no `DELETE`. This is the layer that holds when application code has a bug.
3. **Audit** — every compensating document references the document it compensates, forming a chain.

**Verification.** Test: the application database role cannot execute `UPDATE` or `DELETE` against a finalized
financial table. This is asserted as a schema-privilege test, not a code review.

**Irreversible consequences of this invariant.** Once finalized: a sale's price, line set, and totals are
permanent; a received batch's cost is permanent; a paid invoice's amount is permanent. A sale can be voided
only by a compensating document that reverses its movements and its payments.

---

### BI-09 — A completed payment is never silently modified

> A captured, confirmed, or settled payment may not be changed. A refund is a new, linked transaction. A
> payment may be **voided** only before capture, and only by a role holding that permission.

**Why.** Payment records are the boundary with the outside world — a bank, a card network, a wallet. Silently
editing a captured payment desynchronizes SmartStore from the settlement file, and the discrepancy is
discovered by a customer, not by the system.

**Enforcement.** Layer 1 application, layer 2 database privilege, layer 3 gateway reconciliation. Payment status
is one-way: `Pending → Authorized → Captured`, with `Voided` reachable only from `Pending`/`Authorized`, and
`Failed` terminal. `Captured` has **no** outgoing transition except to a linked `Refund`.

**Verification.** Test: assert the payment state machine has no edge out of `Captured` other than to a refund.
Test: an unlinked refund is rejected.

---

### BI-10 — A refund is bounded by the refundable amount

> The total refunded against a sale may never exceed the sale's total tendered amount. A refund is never negative.
> A refund is always linked to a return, or to an explicit manager-approved goodwill adjustment.

**Why.** A refund bug is a direct cash loss and is the most common real-world retail exploit. An unbounded
refund endpoint is a banknote printer.

**Enforcement.** Transaction + counter, identical in shape to BI-06. The sale maintains a `RefundedAmount`
counter. The refund operation conditionally increments it, aborting if the total would exceed the sale's
tendered amount. A refund with no linked return requires `Refund.Large.Approve` and a reason code, and is
flagged in reporting as a goodwill refund.

**Verification.** Concurrency test: 50 simultaneous refunds of the full amount against one sale; the number that
succeed equals the amount tendered divided by the refund amount; the sum of refunds equals the sum of payments.

---

### BI-11 — Financial totals are deterministic and reproducible

> The same underlying documents must always produce the same totals. A report's figures must be reproducible from
> the documents that produced them, and the sum of lines must equal the document total exactly.

**Why.** Reproducibility is what makes a financial report usable. If a figure moves because of a rounding path
taken differently, or a recomputation, the report is not evidence of anything.

**Enforcement.** Derived computation with a single documented rounding point per document type (BI-01).
Reported figures are computed from documents, never from a separately-maintained total that could disagree.

**Verification.** Test: recompute every document total from its lines and assert exact equality. Test: running
the same report twice over an unchanged dataset returns byte-identical output. Test: a report that sums a
document's lines equals the total stored on the document.

---

## 2. Inventory invariants

### BI-12 — Stock is never created or destroyed by anything except a movement

> Total stock across all locations changes only via `InventoryMovement`. There is no operation that increases total
> stock without a receipt, a found-stock adjustment, an opening balance, or a transfer-in. There is no operation
> that decreases total stock except a sale, issue, damage, expiry, loss, or transfer-out.

**Why.** The generalisation of BI-02 to the whole ledger: **the sum of all movements is the only definition of
"how much stock exists"**, and it must be conserved except where a movement type explicitly creates or destroys
it. Transfer types in particular must conserve total stock.

**Enforcement.** Structural. The movement type enumeration (inventory-domain §4) is closed, and each type is
classified as `Conserves`, `Creates`, or `Destroys`. The classification is part of the type definition. A
transfer-out must have a matching transfer-in; an unmatched transfer-out places stock in `Transit`, which is
still an organization-internal location and still counted.

**Verification.** Test: for any operation sequence, `sum(movement deltas per location) == stockBalance` for every
location, and `sum(all movement deltas)` equals the sum of `Creates` minus the sum of `Destroys` movements.

---

### BI-13 — A transfer moves stock and conserves its total

> A stock transfer must never create stock or destroy stock. Stock leaving the source location equals stock
> arriving at the destination location, within the same organization, for the same movement reason. In-transit
> stock is counted as organization stock until received.

**Why.** A transfer that creates stock is a stock-injection vulnerability. A transfer that destroys stock is
unexplained shrinkage. Both are catastrophic and both are trivially caused by a bug in a two-location write.

**Enforcement.** Transaction for dispatch (source decremented, `Transit` incremented, both movements written);
transaction for receipt (`Transit` decremented, destination incremented). **In-transit is a real location**, so
stock in transit is visible and counted, and a transfer lost in the post is *stock in transit*, not missing
stock. This is the design that makes a lost shipment diagnosable.

**Verification.** Test: after any transfer, `sum(organization stock including Transit)` is unchanged. Test: a
transfer that is dispatched but never received leaves a non-zero, visible `Transit` balance and appears on the
in-transit report.

---

### BI-14 — Store scope is enforced server-side, always

> No request may read or write a store-scoped entity outside the caller's permitted store set. Scope is derived
> from the authenticated session and applied **before** pagination, filtering, sorting, and aggregation.

**Why.** Principle 5. In a multi-store system a scope bug is a data breach between stores that may be
competitors. Applying scope after aggregation leaks aggregates, not just rows.

**Enforcement.** Structural — the data-access layer takes the permitted store set from the session and applies it
as a non-optional predicate. There is no "unscoped" query method available to application code. A store id from
a request body can only *narrow* within the permitted set; a value outside it yields `403`.

**Verification.** Test: for every endpoint, an authenticated employee from Store A requesting Store B's data
receives `403` and the response body contains no Store B data. Test: a report request for Store B returns
`403`, not an empty result set.

---

### BI-15 — A movement cannot be reversed; it can only be compensated

> A stock movement, once written, is permanent. A correction is a new, linked movement of the opposite direction
> with its own reason code and its own document.

**Why.** A deletable ledger is not a ledger. If you can delete the erroneous movement, you have also deleted the
evidence of the error, and the balance no longer explains itself.

**Enforcement.** No update or delete operation exists on `InventoryMovement`. A `MovementReversal` is a new row
that references the original. Reversing a movement that has already been reversed is rejected.

**Verification.** Test: the application database role holds no `UPDATE`/`DELETE` on `InventoryMovement`. Test: a
reversal is itself a movement, and reversing a reversal is rejected as already-reversed.

### BI-15a — Movement immutability, document immutability, and audit-log immutability are three different rules

> **BI-15 governs `InventoryMovement` and nothing else.** A rule that needs a different kind of immutability cites
> the rule for that kind, and cites exactly one.

The three are separate because they have separate scopes, separate enforcement mechanisms, and different answers to
the question that matters most: *what happens when a user is wrong?* A Phase 1 audit found this distinction had
collapsed — BI-15 was cited as the authority for general document immutability in nine state-machine rules and five
requirement rows, **none of which were about stock movements**. The error was propagating: a document rule that
points at a movement rule will eventually be "fixed" by someone who reads BI-15 and concludes documents are
mutable, or by someone who notices the mismatch and deletes the citation and loses the real authority.

| Kind of immutability | Rule | Scope | Enforced by |
|---|---|---|---|
| **Stock movement** | **BI-15** | `InventoryMovement` rows and their reversals | No `UPDATE`/`DELETE` on the movement table at all |
| **Business document** | **BI-08** | Every finalized document: sale, payment, GRN, purchase invoice, return, refund, transfer, adjustment | Three layers: service, schema, and database privilege |
| **Audit log** | **BI-24** | `AuditEntry` rows | Database privilege — `INSERT` and `SELECT` only — plus a privileged, audited, retention-bounded archival path |
| **Entity existence** | **BI-40** | Any entity with history, documents included | Archived with a status, never deleted |

**Why separate, and not merged into one "nothing ever changes" rule.** The three differ in what happens when a
user is wrong, and that difference is the whole point. A wrong movement is compensated by an opposite movement. A
wrong document is compensated by a new document. **A wrong audit entry cannot be compensated at all**, because a
correction to the record of an event is not itself trustworthy — which is why BI-24 has no compensation path while
BI-08 and BI-15 both do. An implementation that treats the three uniformly will either make the audit log
editable, or make the stock ledger impossible to correct, and both failures stay silent until an audit.

**Which to cite.** A movement → BI-15. A finalized document → BI-08. An audit entry → BI-24. "This entity must
never be deleted" → BI-40. A rule needing two of them cites both; one needing all four cites all four. **Where it
is genuinely unclear which applies, that is a defect in the rule's wording, not a licence to cite BI-15 as a
catch-all.**

---

## 3. Returns, pricing, and tax invariants

### BI-16 — A return cannot exceed the eligible sold quantity, per line

*(Restating BI-06 in retail terms, because this is the finding most likely to be re-implemented wrongly.)*

> A customer return line must reference a specific original sale line. Its quantity, plus all prior returns
> against that line, may never exceed the quantity sold on that line. A return with no sale reference is only
> permitted as a manager-approved goodwill return, which creates **no** stock movement and **no** refundable
> credit without `Return.Approve` and a reason.

**Why.** The RFID defect (BI-06) plus the "goodwill return" loophole: if a return can exist without a sale, the
quantity bound is meaningless. Goodwill returns are a real retail need — a customer returns goods bought
elsewhere — and they must be modelled as a **cash-only** exception that a manager approves, not as a hole in the
quantity bound.

**Verification.** Test: a return line with no sale reference is rejected unless approved and reason-bearing. Test:
cumulative returned quantity never exceeds sold quantity under concurrency.

---

### BI-17 — Returned stock is always dispositioned, and disposition is recorded

> Every customer return line resolves to exactly one disposition: `Sellable`, `Quarantine`, `Damaged`, or
> `Expired`. The disposition is mandatory and is written into the resulting movement. No returned stock
> re-enters sellable stock implicitly.

**Why.** **[P0: S-01, §10]** The RFID defect was not the disposition choice — it was unbounded quantity with no
ledger. But disposition still matters: goods that were handled by a customer may be damaged, and returning them
straight to the shelf sells damaged goods to the next customer.

**Enforcement.** Boundary — the disposition is a required field on the return line. The resulting movement
targets the location corresponding to the disposition. `Quarantine` stock is never saleable (`WH-01`).

**The store's default** (`Sellable` or `Quarantine` on receipt) is a *pre-filled* value, not an automatic one;
the operator confirms or changes it. This keeps the fast path fast without losing the safety.

**Verification.** Test: a return line with no disposition is rejected. Test: stock returned as `Quarantine` is
not available to a sale at a sellable location.

---

### BI-18 — Tax is computed from a recorded basis, at a recorded rate

> The tax on a line is computed from an explicit, recorded taxable base and an explicit tax rate with an
> effective date, and the rate used is stored on the line. A tax rate change never reinterprets a historical
> document.

**Why.** Tax rates change. If a report recomputes tax from *today's* rate, last year's tax return is wrong, and
nobody can tell when it became wrong.

**Enforcement.** The rate id and the computed amounts are stored on the line. Reports read stored amounts.
Changing a rate creates a new version with a new effective date.

**Verification.** Test: a document's stored total tax equals the sum of its lines' stored tax, always. Test:
changing a tax rate does not change any historical document.

---

### BI-19 — A price or discount cannot make a line or document negative

> A line's net amount may not be negative. A document's total may not be negative. A discount may not exceed the
> value it is applied to. A loyalty redemption may not exceed the points available.

**Why.** Negative totals propagate into tax, margin, cash reconciliation, and statements, each of which then
produces a plausible-looking wrong answer. This is a quiet failure: nothing errors, the books are just wrong.

**Enforcement.** Boundary validation, plus a check constraint on non-negative amounts.

**Verification.** Test: a 200% discount is rejected. Test: loyalty redemption beyond the available balance is
rejected. Test: a refund or credit note amount may be negative *as a document* (a credit note reduces a
payable) — that is a different concept from a negative **line amount**, which is forbidden. Documented
deliberately, because a credit note is legitimately a negative payable.

---

### BI-20 — Unauthorized users cannot change protected prices

> Price changes, cost changes, and below-cost pricing may only be performed by a role holding the corresponding
> permission, and a below-cost change requires `Price.BelowCost.Approve` by a **different** employee than the
> requester.

**Why.** Margin is the most commercially sensitive number in a retailer. A cashier who can set a price controls
the store's profit. The two-person rule exists because the most common margin-abuse scenario is a manager
setting a price and also approving it.

**Enforcement.** Permission check at the boundary; a requester-approver identity check in the same transaction.
At a till, `Price.Override` records who changed what and why, and a change below cost requires approval at the
time of sale.

**Verification.** Test: a price change without the permission is rejected. Test: the requester and approver
must differ, and the rejection is specific about which rule failed.

---

## 4. Access, approval, and audit invariants

### BI-21 — Default deny

> An authenticated employee with no matching role assignment holds **no** permission. There is no default grant,
> no implicit access, no wildcard, and no fallback policy that permits anything.

**Why.** **[P0: S-06]** A surveyed system failed open on a null permission id. A system that grants access when
it is *unsure* fails open; a system that refuses is safe by construction.

**Enforcement.** Structural. The permission check returns "deny" as its default branch. Role assignment is the
only path to a permission.

**Verification.** Test: an employee with no role, on every endpoint, receives `403` and never a `200` with data.

---

### BI-22 — Permissions are matched exactly

> Permission checks compare a full permission key for **equality**. No prefix, substring, or wildcard matching is
> permitted anywhere in the authorization path.

**Why.** **[P0: S-06]** The surveyed system used prefix matching — so a permission intended for
`Sales.Refund` also granted `Sales.RefundLarge`, and a substring rule granted far more than intended. Prefix
matching on dotted keys is always a privilege-escalation bug waiting for the right key name.

**Enforcement.** Structural — the matching function has no other mode. A test asserts that no permission in the
catalogue is a prefix of another with a different meaning.

**Verification.** Test: holding `Product.View` does not grant `Product.Cost.View`; holding
`Inventory.Transfer.Create` does not grant `Inventory.Transfer.Dispatch`.

---

### BI-23 — Every audited operation records a complete actor

> Every audit entry records who (employee id, resolved at write time, not looked up later), when, what action,
> which entity type, which entity id, and the before and after state where the operation changed data. Actor is
> **never** null for an operation performed by a person or by a device acting for a person.

**Why.** **[P0: S-12]** A surveyed system declared `IpAddress` and `PerformedByUserId` columns and never once
assigned them, so its "audit trail" could not attribute a single event. The columns existed; the truth did not.
An audit entry that cannot answer "who did this" is not an audit entry.

**Enforcement.** The audit-writing function requires the actor. A device-mediated action resolves the human from
the authenticated session, and the device is recorded *in addition*. System-initiated actions
(scheduled jobs, sync) record a system actor **and** the terminal or device that caused them, and are
distinguishable from a human action.

**Verification.** Test: `PerformedByUserId` is non-null on 100% of human-action entries. Test: a query for "all
actions by employee X" returns complete results.

---

### BI-24 — Audit entries are immutable

> An audit entry may never be updated or deleted by any application user. Only a documented, audited, retention-
> bounded archival process may remove them, and only after the retention period.

**Why.** An audit trail that can be edited is not evidence. This is the control an auditor checks first, and it
is the control a rogue administrator checks second.

**Enforcement.** Database privilege: the application role has `INSERT` and `SELECT` on `AuditEntry` and nothing
else. Retention-based removal is a privileged maintenance operation requiring `Backup.Restore`-class authority
and producing its own audit entry.

**Verification.** Test: `UPDATE` and `DELETE` on `AuditEntry` fail for the application role.

---

### BI-25 — A destructive or value-changing operation records a reason

> Any operation that changes stock or money outside an ordinary sale requires a reason code from the
> organization-configured list, plus optional free text. The reason is stored on the document and appears in
> reporting.

**Why.** "Why did stock drop by 40?" is the question every shrinkage investigation starts from. Without a
mandatory reason, the answer is unavailable and the loss is unrecoverable. Free text alone is unqueryable;
reason codes alone lack nuance. Both, with the code mandatory.

**Enforcement.** Boundary. Operations requiring a reason: stock adjustment, stock count posting, stock write-off,
customer return without a sale, refund without a return, supplier return, customer credit limit change,
customer loyalty adjustment, cash in/out beyond a small limit, manual attendance correction, price override,
and any negative-stock resolution.

**Verification.** Test: each of these operations is rejected without a valid reason code.

---

### BI-26 — A requester cannot approve their own request

> A person may not approve a request they raised, where the request type supports approval. This is enforced on
> the action, not on the role assignment.

**Why.** An approval that the requester grants themselves is a rubber stamp. Enforcing it on the *action* rather
than the *role* means a small store can hold both permissions in one role (so it can still trade) while the
separation still holds in practice.

**Enforcement.** Transaction — the approver id is compared against the requester id inside the same transaction
that would apply the approval.

**Verification.** Test: a self-approval is rejected with a specific error naming the rule.

**Applies to:** large discount, large refund, inventory adjustment beyond threshold, customer credit grant,
supplier return, cash withdrawal, price change below cost, attendance correction, cash variance acknowledgement.

---

### BI-27 — Approval gates the state transition, and only approved documents move stock or money

> A document that requires approval takes effect — moves stock, moves money, changes a balance — **only** when
> approved. While pending, it has no effect on stock, money, or balances.

**Why.** The alternative (apply immediately, then reverse on rejection) creates a window in which a pending or
subsequently-rejected transaction has already corrupted stock and cash. Cash drawers in particular are
reconciled continuously, so an "applied then reversed" cash movement makes the drawer count wrong in between.

**Enforcement.** Structural — the movement-writing operation accepts only documents in the approved state. A
pending document is a *request*, not a transaction.

**Verification.** Test: a pending adjustment does not change any balance, and the balance is unchanged at every
point during the approval lifecycle.

---

## 5. Offline, synchronization, and hardware invariants

### BI-28 — Offline transactions are idempotent

> A transaction synchronized from a terminal is applied **at most once**, no matter how many times it is
> submitted, in what order, or after how many retries. Re-submission returns the original result.

**Why.** This is the invariant the entire offline design exists to protect. A flaky connection retrying a
"sale succeeded" request must not create a second sale. Duplicate sales are the failure mode that destroys trust
in offline POS.

**Enforcement.** A unique constraint on `(TerminalId, ClientOperationId)`. The sync handler attempts the insert;
on conflict it returns the stored original response. This is a constraint, not a check-then-act, so it is
correct under any concurrency.

**Verification.** Test: submit the same offline sale 100 times concurrently; exactly one sale exists, and all 100
responses are identical to the original.

---

### BI-29 — The same transaction is never applied twice during synchronization

*(Restating BI-28 in product terms — this is the one that will be implemented wrongly at least once.)*

> Synchronization is **not** implemented by "apply, then check whether it was already applied". A transaction is
> identified, and its application is atomic with that identification.

**Why.** The "apply then dedupe" pattern fails silently under exactly the conditions that matter: a timeout
between apply and response causes a retry, and the retry applies again. The order of operations is the whole
defence.

**Enforcement.** The unique-constraint insert and the business transaction are the same transaction. If the
insert conflicts, nothing else in the operation runs.

**Verification.** Fault-injection test: force a response timeout after commit, then retry, and assert one sale.

---

### BI-30 — The server is authoritative for price, tax, and stock

> Prices, tax rates, discounts, stock quantities, credit limits, and loyalty balances are decided by the server.
> The terminal may decide nothing financial. Offline operation means "the server was asked later", never "the
> terminal decided".

**Why.** If terminals decide prices, a store with three terminals can have three prices for one product and no
way to tell which is correct. Server authority is the only arrangement that survives multi-terminal operation
and a later price change.

**Enforcement.** The terminal's cached prices are used for **display** and are labelled as such offline. The
sale document records the price the server confirmed. If the server's price differs from the displayed price, the
difference is recorded and the customer is informed before the sale is finalized.

**Verification.** Test: a terminal's cached price is never copied into a finalized sale document.

---

### BI-31 — Synchronization never silently discards a transaction

> Every synchronized transaction ends in exactly one of: `Applied`, `AppliedWithAdjustment`, or `Rejected` — and
> `Rejected` requires an explicit reason visible to store staff. Nothing is dropped, and no queue item is
> discarded without a recorded reason.

**Why.** A transaction that vanishes from the queue without explanation is indistinguishable from a lost sale.
Staff lose trust, and the money is unaccounted for.

**Enforcement.** The queue item's terminal state is recorded locally and on the server. A queue item cannot
reach a terminal state that is not one of the three.

**Verification.** Test: for any queue item, the local record and the server record agree on the outcome, and
every `Rejected` has a reason.

---

### BI-32 — A hardware failure never corrupts a business transaction

> A device that fails, disconnects, times out, or returns garbage cannot cause a partially applied sale, a
> duplicated movement, or a mis-stated balance.

**Why.** Hardware is the least reliable component in the system and the one most likely to fail mid-operation:
a drawer that opens when it shouldn't, a scale that reads mid-settling, a printer that dies after the sale is
committed.

**Enforcement.** **Devices never participate in a business transaction.** A device call happens before the
transaction; its result, or its failure, is passed in as data. A printer that fails after the sale commits
produces a **committed sale with a failed receipt** and a reprint queue entry — never a rolled-back sale with
money taken. A failed drawer-open is a logged error; the cash transaction and the sale proceed, and the drawer
state is reconciled at close.

**Verification.** Fault-injection tests across every device type: fail each device at each stage and assert the
resulting data is always one of the defined valid states.

---

### BI-33 — RFID never grants authorization

> An RFID read identifies a credential and may authenticate a session. It grants no permission, and it never
> substitutes for a permission check. No business operation is permitted on the basis of a tag read alone.

**Why.** **[P0: the surveyed RFID system stored a `PermissionsJson` on roles and never once read it for an access
decision]** — the permission system was defined, displayed, and seeded, and enforced by nothing, while 16 of 18
controllers had no authorization at all. The lesson is not that RFID is dangerous; it is that an identity signal
and an authorization decision are different things, and a system that conflates them has no access control at
all.

**Enforcement.** Architectural. The authentication flow is exactly:
`RFID read → credential lookup → employee resolution → session established → PERMISSION CHECK → action`.
The RFID subsystem has no code path to a business operation. A valid tag read produces an **identity
assertion**, never an access grant.

**Verification.** Test: an employee with **zero** permissions whose valid RFID card is read at an authorized
reader still cannot perform any action, and the RFID event is recorded as a successful read with no authorization
consequence.

---

### BI-34 — Hardware is accessed only through the device abstraction

> Business logic may not reference a manufacturer, a protocol, or a device SDK. It issues domain commands
> (`ReadTags`, `PrintReceipt`, `OpenDrawer`, `ReadWeight`, `ReadBarcode`) against a registered `Device`, and the
> implementation is selected by the device's registered type.

**Why.** Principle 12. **[P0: A-15, A-16]** A surveyed RFID system bound its business logic to one
manufacturer's client library, so replacing the reader meant rewriting application code. That is the failure
this invariant exists to prevent permanently.

**Enforcement.** Architectural, and testable: a static check asserts that no file in the business-logic layer
imports or references a device SDK, protocol constant, or manufacturer name.

**Verification.** Test: the business-logic layer has zero references to device SDKs. Test: registering a
different `DeviceType` implementation for `ReceiptPrinter` requires **no** change to any sales code.

---

### BI-35 — Device identity is authenticated

> A device reports its identity, and the server accepts events from it only after the device is registered and
authenticated. An unregistered or unauthenticated device's events are rejected and recorded as such.

**Why.** Without it, anyone who can reach the network can inject a "RFID tag read" event, a weight reading, or a
sale. A weighing scale feeding an unchecked number into a receipt is a direct financial attack.

**Enforcement.** Each device holds a credential established at registration. Device events are accepted only
from an authenticated device, and the device is recorded on every event it produces.

**Verification.** Test: an event from an unregistered device is rejected and appears in the device event log as
`Rejected`.

---

## 6. Concurrency invariants

### BI-36 — Concurrent sales of the last unit resolve deterministically

> When two terminals attempt to sell the same last unit concurrently, the outcome is **deterministic and
recorded**: either exactly one succeeds, or both succeed and the balance is negative and flagged. It is never
the case that both succeed, the balance is non-negative, and stock is wrong.

**Why.** This is the classic oversell race. There is no third option: the system must either prevent oversell or
record it. What is unacceptable is a state where the balance looks fine and the ledger disagrees.

**Enforcement.** Transaction. The balance update is a single atomic statement. The caller then inspects the
resulting balance against the store's negative-stock policy **inside the same transaction**, and aborts if the
policy is `BlockNegative`. Under `AllowNegative`, the negative balance is written, the movement is written, and
a `NEGATIVE_STOCK` notification is raised.

**Verification.** Concurrency test: N terminals sell the final unit simultaneously. Assert (a) no oversell with
`BlockNegative`, (b) a negative balance **and** a matching notification with `AllowNegative`, (c) the ledger and
all balances reconcile in both cases, (d) the outcome is identical on 100 repeated runs.

**There is no lock-free "reserve then sell" dance in v1.** The single atomic statement is correct, simple, and
provable. A reservation system exists (`StockReservation`) for the cases that genuinely need a hold, and is used
explicitly rather than implicitly at the till.

---

### BI-37 — A reservation can never exceed available stock

> A reservation holds stock that is not sellable to anyone else. The total active reservations for a stock item
> may never exceed the available quantity, and expired or released reservations restore availability.

**Why.** Over-reservation silently starves the shelf. Under-reservation oversells. The bound is what makes a
reservation meaningful.

**Enforcement.** Transaction + counter, conditionally incremented like BI-06. Expired reservations are released
by an automated job that runs inside a transaction and writes a `Movement` of type `RESERVATION_RELEASE` **only
if** no corresponding `RESERVATION_HOLD` movement exists — so releasing twice cannot create stock.

**Verification.** Test: concurrent reservations never exceed availability. Test: releasing a reservation twice
does not change the balance twice.

---

### BI-38 — Over-receipt is bounded

> Received quantity on a purchase order line may never exceed the ordered quantity by more than the configured
> tolerance. Beyond the tolerance, receiving is refused or requires explicit approval with a reason.

**Why.** **[P0: D-13]** An unbounded purchase receipt is a stock-injection path: anyone able to post a receipt
can manufacture inventory, and the purchase order is supposed to be the authorization for what arrives.

**Enforcement.** Transaction, with a per-line `ReceivedQuantity` counter and a conditional update. The
tolerance is configured per organization and per purchase order, default zero. Over-receipt within tolerance is
allowed and recorded; beyond it requires `Purchase.Receive` **plus** an approval, and the over-receipt is
reported.

**Verification.** Test: receiving beyond tolerance without approval is refused. Test: `ReceivedQuantity` can
never exceed `OrderedQuantity × (1 + tolerance)` under concurrency.

---

### BI-39 — A shift, and a drawer, admit only one open session

> A cash drawer may have at most one open shift at any time, and an employee may have at most one open shift per
> store.

**Why.** Two open shifts on one drawer make cash reconciliation impossible, and the ambiguity is discovered at
close, when it is expensive.

**Enforcement.** A uniqueness constraint on open shift per drawer, and per employee per store. Not a
check-then-act.

**Verification.** Test: two simultaneous open attempts on the same drawer; exactly one succeeds.

---

## 7. Scope, deletion, and history invariants

### BI-40 — Entities with history are archived, never deleted

> An entity that has ever appeared in a financial or inventory document may never be hard-deleted. It is
**archived**, and archival is a permissioned, audited, reason-bearing operation that removes it from operational
use while preserving every reference to it.

**Why.** Deleting a product that was sold makes historical invoices unrenderable and stock movements
unexplainable. The general rule: **history is append-only; operational availability is a status.**

**Enforcement.** No delete operation exists on these entities. The status `Archived` excludes them from
operational queries and from new transactions, while remaining visible in historical documents.

**Verification.** Test: `DELETE` fails for a product with sales history. Test: a historical invoice still
renders fully after its product is archived.

---

### BI-41 — A document with a child document cannot be deleted or cancelled out of order

> A purchase order with recorded receipts cannot be deleted, and its state machine cannot skip a state. A sale
> with a return cannot be voided without a compensating reversal of that return.

**Why.** The state machines in [state-machines.md](../product/state-machines.md) exist to prevent exactly this: an
operation whose preconditions were established by a child document being applied out of order.

**Enforcement.** State machine validation plus reference checks. Every transition is validated against the
document's current state and its children.

**Verification.** Test: cancelling a received purchase order is refused. Test: voiding a sale that has a
recorded return is refused until the return is reversed.

---

### BI-42 — Document numbers are unique and never reused

> A document number is unique per store per document type, is allocated inside the creating transaction, and is
never reused — including after a document is cancelled or voided.

**Why.** A reused number means two different transactions answer to the same reference. On an audit, that is not
a cosmetic problem: it makes the audit trail ambiguous exactly where it matters.

**Enforcement.** A per-store, per-type sequence counter with a uniqueness constraint. The counter is incremented
inside the transaction; a rolled-back transaction may leave a gap, which is acceptable and preferable to reuse.

**Verification.** Test: after 1,000 sales with 50 cancellations, all 1,000 document numbers are unique.

---

### BI-43 — An out-of-scope store boundary is refused, not filtered

> A request naming a store the caller may not access receives `403`. It is never silently satisfied with an empty
result set, and never redirected to the caller's home store.

**Why.** An empty result set teaches the client "no data" when the truth is "no access", and a client that
treats `403` as "no results" will page forever. Silent redirection is worse: it returns data the user did not
ask for and teaches them nothing.

**Enforcement.** Boundary (MS-03, MS-04).

**Verification.** Test: cross-store access returns `403` with a distinguishable body.

---

## 8. Invariant index by domain

| Invariant | Area | Phase 0 provenance |
|---|---|---|
| BI-01 | Money | **D-17** |
| BI-02 | Inventory | **D-09** |
| BI-03 | Inventory | — |
| BI-04 | Transactions | — |
| BI-05 | Inventory | — |
| BI-06 | Returns | **S-01** |
| BI-07 | Returns | — |
| BI-08 | Documents | — |
| BI-09 | Payments | — |
| BI-10 | Refunds | — |
| BI-11 | Money | **D-17** |
| BI-12 | Inventory | **D-09** |
| BI-13 | Transfers | **D-09** |
| BI-14 | Access | — |
| BI-15 | Inventory | — |
| BI-16 | Returns | **S-01** |
| BI-17 | Returns | — |
| BI-18 | Tax | — |
| BI-19 | Pricing | — |
| BI-20 | Pricing | — |
| BI-21 | Access | **S-06** |
| BI-22 | Access | **S-06** |
| BI-23 | Audit | **S-12** |
| BI-24 | Audit | — |
| BI-25 | Audit | — |
| BI-26 | Approval | — |
| BI-27 | Approval | — |
| BI-28 | Offline | — |
| BI-29 | Offline | — |
| BI-30 | Offline | — |
| BI-31 | Offline | — |
| BI-32 | Hardware | — |
| BI-33 | RFID | **S-12** |
| BI-34 | Hardware | **A-15, A-16** |
| BI-35 | Hardware | — |
| BI-36 | Concurrency | — |
| BI-37 | Concurrency | — |
| BI-38 | Procurement | **D-13** |
| BI-39 | Cash | — |
| BI-40 | Deletion | — |
| BI-41 | Documents | — |
| BI-42 | Documents | — |
| BI-43 | Scope | — |

**43 invariants. 14 of them exist because a surveyed repository got that exact thing wrong.** That is the
justification for the offline, ledger, audit, and device design in this specification — not a general preference
for rigour, but a list of specific, observed failures.

---

## 9. Invariant amendment process

An invariant may be amended only by:

1. A written request naming the invariant, the business reason, and the data-migration consequences
2. Evidence that the invariant is genuinely wrong — not merely inconvenient
3. A design for the historical data that the change would invalidate
4. Sign-off from the Owner and the Architect
5. An amendment record in this document, appended to §10, never an in-place edit

**Invariants that may never be amended without a new product decision:** BI-01, BI-02, BI-06, BI-08, BI-09,
BI-10, BI-14, BI-21, BI-22, BI-23, BI-24, BI-28, BI-29, BI-33, BI-40, BI-42. These are the load-bearing walls.
