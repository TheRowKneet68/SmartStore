# C-06 Traceability Review

> **REBUILD REQUIRED - this artifact was damaged on 2026-09-30 and the evidence log is lost.**
>
> While appending the final section, a PowerShell array collapsed to a string and `WriteAllText`
> overwrote this file. Surviving: the traceability work itself, which is complete and verified
> in `requirements-traceability.md`, and the 175-row owner confirmation list below.
> Lost: the per-rule disposition and evidence log for Batches 1, 2, 3a, 3b, 4a, 4b, 5a, and 5b,
> and front-matter sections 1, 2, 4, 5, 6, 7, 13, 14, and 19-22 of the 22 required elements.
>
> There is no git history, backup, or shadow copy, so the lost prose cannot be recovered verbatim.
> It must be rebuilt. The rebuild is mechanical rather than investigative: every final home is
> already recorded in `requirements-traceability.md` Â§26.2, and each RT row carries the citation that
> makes the mapping provable. What is gone is the per-rule *reasoning*, which is why this notice
> stands rather than a silently thinner document.

## Verified state of the traceability work

| Measure | Value |
|---|---|
| Â§26.2 rows | 1161 |
| `mapped` | 1161 |
| `inferred` | 0 |
| `UNMAPPED` | 0 |
| Distinct rules cited by a requirement row | 1161 |
| Requirement rows | 529 |
| Rows drafted by the review | 175 |
| Coverage rows resolving to an `OUT OF SCOPE` row | 48 |
| Rules dispositioned | 342 of 342 |

Integrity: the coverage table and the citation columns are a **bijection** - no rule is `mapped`
without a citing requirement row, and no requirement row cites a rule absent from Â§26.2.

Batches: 1 (41), 2 (32), 3a (34), 3b (30), 4a (33), 4b (32), 5a (33), 5b (32), 5c (33), 5d (42).
Drafted row ranges: RT-355..381, 382..403, 404..421, 422..434, 435..446, 447..457, 458..469,
470..482, 483..502, 503..529. `SM-43a`, `SM-48a`, and `SM-56a` were counted in Batch 3b's
population and adjudicated in Batch 5d (34 + 30 + 3 = 67 `state-machines` rules).

## Owner confirmation list - all 175 proposed rows

Every row below was drafted by the C-06 review and is `PROPOSED - REQUIRES HUMAN CONFIRMATION`.
None is approved. Generated directly from `requirements-traceability.md`, so this list cannot
drift from the file. For each row the owner should answer one of: **accept**, **amend**, or
**reject** - and a rejection needs a replacement home or an explicit `OUT OF SCOPE`.

- Rows: **175** (`RT-355`..`RT-529`), of which **8** are `OUT OF SCOPE`
- Rules closed by these rows: **342**
- Also still needing an owner decision: CON-03 (`PY-54` / `RT-420`), `RT-186` / `SU-22`,
  `GAP-037`, and twelve recorded partial-coverage mappings.

| Row | Section | Requirement as drafted | Priority | Source rules |
|---|---|---|---|---|
| RT-445 | Organization | A store is not deactivated while it holds stock or has an open shift | MUST | EC-39, EC-89 |
| RT-449 | Organization | The business date is a store setting, and changing it handles open transactions and is audited | MUST | EC-64 |
| RT-457 | Organization | A store with no provisioned terminal cannot trade | MUST | EC-86, overview 3 |
| RT-504 | Organization | The organization currency is immutable once any financial document exists | MUST | ORG-01 |
| RT-505 | Organization | The business time zone is immutable once financial documents exist | MUST | ORG-02, overview 3.1 |
| RT-506 | Organization | An organization with financial history is deactivated, never deleted | MUST | ORG-03, BI-40 |
| RT-507 | Organization | A sale cannot be recorded before the organization has a store | MUST | ORG-04 |
| RT-508 | Organization | A store is never deleted while it holds stock, an open shift, or any document, and its stock is resolved to zero with a reason first | MUST | ORG-05 |
| RT-509 | Organization | A storage location can be made unsellable at any time and is never deleted while it holds a balance or a movement | MUST | WH-03 |
| RT-510 | Organization | Quarantine and damaged stock is never merged into sellable stock automatically; release is a discrete, permissioned, audited decision | MUST | WH-04, IV-38 |
| RT-446 | Access | A permission change takes effect on the next request, and the live session is revoked rather than left with stale grants | MUST | EC-45, OF-42 |
| RT-448 | Access | A role's scope is explicit - organization-wide or a named store set - and it never widens by itself | MUST | EC-55, EC-87, EC-88, MS-11 |
| RT-503 | Access | Least privilege: no role template grants a permission that no named retail responsibility requires | MUST | AC-04 |
| RT-444 | Product | A product referenced by a finalized document is deactivated or retired, never deleted | MUST | EC-37 |
| RT-443 | Product | A variant's deactivation is prospective: it blocks new use and never removes stock already on hand | MUST | EC-33 |
| RT-488 | Product | Category ordering is an explicit sort order, not a naming convention | MUST | PR-06 |
| RT-489 | Product | A variant sold by scanner needs at least one active barcode; a search-only variant is an explicit, recorded selection | MUST | PR-11 |
| RT-490 | Product | A barcode is a string normalised per symbology, never an integer | MUST | PR-12 |
| RT-495 | Product | A variant may be archived while its product stays active | MUST | PR-48 |
| RT-491 | Product | `QuantityKind` is immutable once the unit has been used | MUST | PR-14 |
| RT-492 | Tax | Inclusive tax is extracted at line precision and the tax is derived as the difference, never `gross x rate` | MUST | PR-39, SP-34, BI-11, PR-Q40 |
| RT-493 | Tax | Exempt is a zero-rate tax category, never a missing category | MUST | PR-40, SP-38 |
| RT-494 | Discounts | Discounts apply in a fixed documented order, and the order is recorded on the sale | MUST | PR-45, SP-27, BI-11 |
| RT-496 | Product | An import row matches on a stable external key, never on name | MUST | PR-52 |
| RT-483 | Inventory | The negative-stock policy is evaluated inside the movement transaction, against the resulting balance | MUST | IV-16, BI-36, OF-04 |
| RT-484 | Inventory | A negative balance is written to the ledger in full, alarmed, and never clamped or hidden | MUST | IV-17, BI-36 |
| RT-485 | Inventory | A negative balance must be resolved, and resolution is one of a named set of routes with a reason | MUST | IV-18, BI-25 |
| RT-487 | Inventory | An out-of-stock event notifies once, and the restore is the reset condition | MUST | IV-59, BE-20 |
| RT-436 | Inventory | A stock movement is refused while a count is in progress, and a count is never silently merged with one | MUST | EC-04, EC-09 |
| RT-486 | Inventory | A stock adjustment is a document with a state machine and moves no stock until posted | MUST | IV-32, BI-27 |
| RT-475 | Inventory | A quantity supplied as input is never negative, and a reduction is expressed by movement type and direction rather than a signed quantity; a negative stock balance is a store policy decision and is separate from the input rule | MUST | BI-05, IV-34 |
| RT-437 | Batch | FEFO is resolved at commit, not at selection, so a quarantine arriving after selection causes a re-selection | MUST | EC-10 |
| RT-458 | Batch | Receiving a batch-tracked variant captures batch number, expiry date, and manufacturing date when available; missing data is a warning, not a rejection | MUST | BE-10 |
| RT-459 | Batch | A receipt line creates exactly one batch, and accepting already-expired goods into sellable stock still writes an `EXPIRY` notification at `Error` severity | MUST | BE-12, BE-13 |
| RT-460 | Batch | A receipt records the actual supplier-invoice unit cost, not the PO price, and the variance is recorded and reported through the three-way match | MUST | BE-14 |
| RT-461 | Batch | A receipt writes `PURCHASE_RECEIPT` movements against the specific batch and sets `RemainingQuantity`; near-expiry stock is prioritised by FEFO and reported but never blocked; expiry removes stock only through a reason-coded, permissioned, approval-bearing `EXPIRY` write-off | MUST | BE-15, BE-21, BE-22 |
| RT-462 | Batch | Quarantined stock may be consumed by staff with a reason, is never sold to customers, and the staff consumption is reported | MUST | BE-39 |
| RT-463 | Batch | Valuation policy for a batch-tracked variant is explicit and configured - `WeightedAverage` (default), `FIFO`, or `LastCost`; it is applied at valuation time rather than kept as a running total; and a sale line records the actual cost of the batch it consumed, summed across batches when FEFO splits the sale | MUST | BE-41, BE-42, BE-43 |
| RT-469 | Batch | A FEFO override on a large-value sale follows the store's approval policy, as a large discount does | MUST | BE-35 |
| RT-497 | Procurement | A requisition has no effect: no stock, no payable, until it becomes a purchase order | MUST | PR-Q04, BI-27 |
| RT-498 | Procurement | A PO line records the agreed description and price as issued values; neither is recalculated | MUST | PR-Q05, PR-Q07, BI-08 |
| RT-499 | Procurement | A PO has no effect on stock or payable until it is `Approved` and then `Ordered` | MUST | PR-Q06, BI-40 |
| RT-500 | Procurement | PO cancellation is refused once a goods receipt exists, and the resolution is return plus cancel | MUST | PR-Q08, BI-41 |
| RT-501 | Procurement | A PO belongs to one ordering store; cross-store consolidation is out of scope in v1 | OUT OF SCOPE | PR-Q10 |
| RT-455 | Sales | A new cashier's first sale is an ordinary sale gated only by their roles and permissions; there is no production onboarding mode | MUST | EC-83, EM-14 |
| RT-453 | Sales | A session change at a shared terminal preserves the cart, and the sale is attributed to whoever completes it | MUST | EC-79, SP-11 |
| RT-452 | Sales | A cart survives an interruption in memory and on disk for a configured TTL, and is never silently lost | MUST | EC-78, SP-43 |
| RT-435 | Sales | A capture and a void of the same sale are mutually exclusive; one wins and the other is refused naming the winner | MUST | EC-03 |
| RT-502 | Sales | Cash rounding is configured, never hard-coded, and recorded as an adjustment rather than smeared into prices | MUST | SP-25, SP-26 |
| RT-476 | Returns | A return with no sale-line reference is permitted only as a manager-approved goodwill return, requires `Return.Approve` and a reason, creates no stock movement, and is cash-only | MUST | BI-16 |
| RT-522 | Returns | Store credit expiry is per store, and expiry is a documented, reported event rather than a silent deletion | MUST | RR-29, PY-31 |
| RT-523 | Returns | Goodwill movements are reported by actor, value, and reason, with concentration analysis | MUST | RR-37, SP-56, IV-36, BI-25 |
| RT-439 | Customer | Exceeding a credit limit at the till refuses the sale or routes it to an approved override | MUST | EC-18 |
| RT-450 | Customer | No credit due date, dunning, or `CreditOverdue` in v1; a balance is governed only by the credit-limit rules | OUT OF SCOPE | EC-65, NT-37 |
| RT-511 | Customer | `OnHold` warns and notifies; it never refuses service, and the hard block is `CreditBlocked` | MUST | CU-09, SM-45a |
| RT-512 | Customer | A customer is never deleted; `Closed` is a status and the history stays renderable | MUST | CU-10, BI-40 |
| RT-513 | Customer | Available credit is `CreditLimit - Balance`, derived, over a balance that is a rebuildable cache | MUST | CU-12, IV-09 |
| RT-514 | Employee | No sensitive personal data in v1: attendance and leave are the only non-operational personal data | OUT OF SCOPE | EM-05 |
| RT-515 | Employee | `Department` and `Position` are descriptive and grant nothing | MUST | EM-06, AC-01 |
| RT-516 | Employee | Date of birth serves age-restricted sales only, and the pass/fail is recorded rather than the value | MUST | EM-07 |
| RT-519 | RFID | A reader's mode is configured and determines what a read means | MUST | RF-09 |
| RT-520 | RFID | A door open is a request; the controller decides and SmartStore records only the read | MUST | RF-11 |
| RT-521 | RFID | Reader events store both the device's observation timestamp and the server's receipt timestamp | MUST | RF-13, overview 3.3 |
| RT-477 | Hardware | Device identity is authenticated: the server accepts a device's events only after the device is registered and authenticated, and an unregistered or unauthenticated device's events are rejected and recorded as such | MUST | BI-35, RF-12, HD-14 |
| RT-454 | Hardware | A replaced device keeps its history, and its replacement is a new provisioned device | MUST | EC-82, HD-18 |
| RT-517 | Hardware | A device connection is configuration, not architecture | MUST | HD-13, HD-02 |
| RT-518 | Hardware | A device credential cannot assert an employee identity | MUST | HD-15, BI-33 |
| RT-447 | Offline | An offline sale that duplicates an online sale is applied and reported, never auto-merged | MUST | EC-49, OF-31 |
| RT-470 | Offline | Synchronisation is per store and per terminal, in business-date order and then queue order within a business date | MUST | OF-24 |
| RT-471 | Offline | Synchronisation is triggered on connectivity restoration, on a configured interval, on a manual request, and at shift close, never on a timer alone; an offline window exceeding the terminal's configured expiry stops the terminal selling and raises a high-severity notification | MUST | OF-27, OF-28 |
| RT-472 | Offline | FEFO offline is advisory: the terminal may suggest the soonest-expiring batch, the sale line records the batch the server later allocated, and no offline FEFO override is possible; a near-expiry batch left behind is reported | MUST | OF-40 |
| RT-473 | Offline | The local ledger is as sensitive as the server's: it is encrypted at rest and its key is bound to the registered device credential | MUST | OF-41 |
| RT-474 | Offline | No offline data is written to shared or removable media by the POS, and diagnostics leave the terminal only through a deliberate, audited export | MUST | OF-44 |
| RT-525 | Cash | A cash movement is a ledger row and the drawer balance is its projection, never a field update | MUST | CD-19, CD-08, BI-02 |
| RT-526 | Cash | Closing a shift requires `Shift.Close`, a drawer count, a counted denomination breakdown, and a declared closing float for the next shift | MUST | CD-20 |
| RT-527 | Cash | The shift screen answers exactly four questions, and only these four | MUST | CD-30 |
| RT-528 | Cash | The float is a store decision; the system shows the busiest days' expected cash and never recommends a float | MUST | CD-35 |
| RT-529 | Cash | The drawer is not a safe-management feature | OUT OF SCOPE | CD-37 |
| RT-480 | Payment | Payment state is a projection of provider events plus the local record, and the state is the reconciliation of the two; a callback is idempotent by provider transaction reference and a duplicate callback is acknowledged and recorded once | MUST | PY-15 |
| RT-481 | Payment | An overpayment is change, not a payment, and a non-cash overpayment is refused rather than creating a negative tender; where a store allows negative-tender credit it is a configured store setting, carries a reason, and is reported | MUST | PY-19 |
| RT-482 | Payment | No expiry campaigns and no expiry-without-notification in v1 | OUT OF SCOPE | PY-35 |
| RT-440 | Payment | A live store's payment provider configuration is approvaled and audited before it takes effect | MUST | EC-20 |
| RT-394 | Multi-store | Scope is applied to every store-scoped read and write; no store-scoped operation escapes it, including exports, reports, and search suggestions | MUST | MS-10, EC-59 |
| RT-395 | Multi-store | Segregation-of-duties conflicts are evaluated across stores, not per store | MUST | MS-14 |
| RT-396 | Multi-store | The audit log is organization-global and is queryable only with an explicit store filter or organization-wide permission | MUST | MS-29 |
| RT-397 | Multi-store | A chain or store-range catalog is not in v1; the single organization-global catalog is the only one | OUT OF SCOPE | MS-35 |
| RT-382 | Approvals | The request references its subject, and a suspendable subject is suspended or flagged while the request is pending | MUST | AP-04 |
| RT-383 | Approvals | A request carries its reason from submission | MUST | AP-05 |
| RT-384 | Approvals | The request is submitted in the same transaction as the action that triggered it, or immediately after | MUST | AP-06 |
| RT-385 | Approvals | A decision writes an `Approval.Decided` audit event carrying the before and after state, the decider, and the reason | MUST | AP-11 |
| RT-386 | Approvals | A decision is idempotent by request id, and a decided request cannot be decided again | MUST | AP-12, AP-13 |
| RT-387 | Approvals | The decider is resolved by role and store, never by name | MUST | AP-14, AP-15 |
| RT-388 | Approvals | Every policy carries a decision SLA, configurable per subject per store, and a request past its SLA escalates | MUST | AP-21, AP-22 |
| RT-389 | Approvals | A request whose subject no longer exists is `Cancelled` with a reason naming the subject | MUST | AP-25 |
| RT-390 | Approvals | The approval report is a projection of the requests, by state, subject, decider, and store, with the mean wait | SHOULD | AP-30 |
| RT-391 | Approvals | Where a subject cannot proceed without approval, it is refused with a message naming the pending request | MUST | AP-32 |
| RT-392 | Approvals | A request submission is idempotent by `ClientOperationId` | MUST | AP-33 |
| RT-393 | Approvals | A request survives a restart | MUST | AP-34 |
| RT-464 | Audit | An audit event records what happened rather than what was intended; the store is always on the event, derived from the affected entity rather than the request; and `Before`/`After` hold only changed fields, not whole entities | MUST | AU-04, AU-07, AU-08 |
| RT-465 | Audit | `EventType` is a closed, versioned, domain-namespaced set; logout and session end are distinct events (`Security.Logout` versus `Security.SessionEnded` with its cause); the vocabulary is complete against the mandatory event floor; and a new event type is a reviewed change made only when a rule already requires the event | MUST | AU-11, AU-12, AU-12a, AU-12b, AU-12c, AU-13 |
| RT-466 | Audit | A scheduled job records what it did and what it changed in the same event vocabulary; archival moves events to cold storage while preserving the query path; and the retention policy is versioned and audited, with a policy change that shortens retention requiring approval | MUST | AU-16, AU-21, AU-22 |
| RT-467 | Audit | Access to an employee's own actions is not special-cased: supervisors see their store and see their own events like anyone else's, and a request to suppress one's own event is refused; a database administrator with write access to the audit store is a documented, mitigated risk rather than a solved one | MUST | AU-26, AU-31 |
| RT-468 | Audit | No per-field, per-reason audit trail on every entity in v1, and no real-time alerting on audit events in v1; the mandatory event floor and a standing report with threshold notifications are the floor | OUT OF SCOPE | AU-34, AU-35 |
| RT-398 | Reporting | Every report declares which kind it is, and the screen says so where freshness differs materially | MUST | RP-01 |
| RT-399 | Reporting | No report is the system of record | MUST | RP-03 |
| RT-400 | Reporting | A report never mixes currencies in one column, and a converted figure shows its rate and its rate date | MUST | RP-06, RP-07 |
| RT-401 | Reporting | A report's scope is a function of the report, not only of the role | MUST | RP-16 |
| RT-402 | Reporting | The largest-history reports are indexed by their own access pattern, and an expensive query is a background job rather than a scan presented as quick | MUST | RP-23, RP-24 |
| RT-403 | Reporting | The export destination is not a server-side integration in v1 | OUT OF SCOPE | RP-29 |
| RT-451 | Reporting | A report too slow to serve becomes a background job that notifies its requester on completion or failure | MUST | EC-74, RP-20 |
| RT-355 | Notifications | InApp is always on and is the delivery source of truth; other channels are configured per event type and per user, with a store default and no global switch | MUST | NT-13, NT-16 |
| RT-356 | Notifications | Email is a digest for anything non-urgent | SHOULD | NT-15 |
| RT-357 | Notifications | An external channel requires a verified destination and consent | MUST | NT-17 |
| RT-358 | Notifications | A channel failure affects neither the other channels nor the domain | MUST | NT-18, EC-75 |
| RT-359 | Notifications | An event needing a decision has a deadline that escalates, and escalation targets a role | MUST | NT-23, NT-24 |
| RT-360 | Notifications | A notification is retained for a configured short period and then expires; the event is the record | MUST | NT-30, SM-74 |
| RT-361 | Notifications | A notification links to the record it is about, and following the link is permission-checked | MUST | NT-31, UX-45 |
| RT-362 | Notifications | Before and after are separate events, and an event type is added only when a rule requires it | MUST | NT-37 |
| RT-363 | UX | The common path is short; a destructive action is explicit, separately named, and confirmed by what and how much | MUST | UX-02, UX-03 |
| RT-364 | UX | The system reports the outcome, not its internal action, and a user-caused outcome is not styled as a system error | MUST | UX-04, UX-59 |
| RT-365 | UX | The normal sale path is scan, line, running total, payment, confirm, print | MUST | UX-09 |
| RT-366 | UX | Quantity is one control on the line; a hand-entered weight is labelled and reasoned | MUST | UX-13 |
| RT-367 | UX | The payment step shows total due, tenders already taken, and the remainder | MUST | UX-14 |
| RT-368 | UX | An underpayment is named as such and the credit-sale route is explicit | MUST | UX-17 |
| RT-369 | UX | An offline sale accepted with an adjustment is shown to the cashier on reconnect | MUST | UX-20 |
| RT-370 | UX | Resuming a suspended sale does not re-reserve stock | MUST | UX-25 |
| RT-371 | UX | A suspended sale can be discarded with confirmation, and the discard is audited | MUST | UX-26 |
| RT-372 | UX | Opening a shift asks for the counted float by denomination | MUST | UX-32 |
| RT-373 | UX | The variance screen shows counted, expected, variance, and threshold together | MUST | UX-34 |
| RT-374 | UX | The drawer state is visible on the till at all times | MUST | UX-35 |
| RT-375 | UX | A stock adjustment is entered as a counted quantity, not a delta | MUST | UX-36 |
| RT-376 | UX | A low-stock alert names the variant, the quantity, the threshold, and the reorder action | MUST | UX-38 |
| RT-377 | UX | An action needing approval says the request was sent, and the requester can see their own request's state | MUST | UX-42, UX-43, AP-28 |
| RT-378 | UX | Search results and search suggestions are scope-filtered before they are returned | MUST | UX-47, UX-49 |
| RT-379 | UX | A barcode search is exact and a name search is fuzzy; the two never mix | MUST | UX-48 |
| RT-380 | UX | Touch targets are sized for fast, imprecise till work and text meets a published contrast ratio | MUST | UX-53, UX-54 |
| RT-381 | UX | A rejected offline sale is shown with its reason and what to do | MUST | UX-66 |
| RT-456 | UX | The void, return, refund, and escalate paths are each reachable in a few taps | MUST | EC-84 |
| RT-524 | UX | A rejected return carries a customer-facing reason and a separate internal reason | MUST | UX-31, RR-42, SM-42 |
| RT-404 | State | A document's own state is a stored fact, and stored does not mean authoritative: which entity owns the figure decides stored versus projected | MUST | SM-01, SM-01a, SM-35a |
| RT-405 | State | An unspecified transition attribute is `OPEN DECISION` and is raised, never guessed | MUST | SM-02a, SM-02b, SM-02c, SM-02d |
| RT-406 | State | A machine is a closed, versioned set of states and transitions defined in the owning document | MUST | SM-07 |
| RT-407 | State | A `Suspended` or `OnHold` state has a resume edge, a recorded reason, and queue visibility | MUST | SM-09 |
| RT-408 | State | A machine's state set is the owning document's set, verbatim | MUST | SM-13a, SM-16a, SM-60, SM-77a, SM-88a, SM-43a, SM-48a |
| RT-409 | State | `Archived` requires a reason, is terminal, and has no return edge | MUST | SM-13 |
| RT-410 | State | `AllowNegative` and `BlockNegative` are the only two stock policies, they change only by a movement that would breach the current policy, and there is no manual override | MUST | SM-14, SM-15 |
| RT-411 | State | `Quarantined` is reversible; `Depleted` and `Expired` are not, and `Depleted` is reached by quantity alone | MUST | SM-16, SM-17 |
| RT-412 | State | `Expired` is derived at read and stored at the expiry boundary, a required expiry date cannot be omitted, and a dateless batch sorts last under FEFO | MUST | SM-18, SM-19 |
| RT-413 | State | `Rejected`, `Cancelled`, and `Closed` are three distinct endings, and a `Sale` has no `Cancelled` state | MUST | SM-23, SM-36 |
| RT-414 | State | A goods receipt creates stock and never a second payable | MUST | SM-27 |
| RT-415 | State | A sale's post-sale states are a projection of its line counters, and the stored status is a cache a rebuild must reproduce exactly | MUST | SM-35, SP-66 |
| RT-416 | State | A return and a refund are linked, not nested | MUST | SM-39 |
| RT-417 | State | A `Failed` refund is retryable and holds the amount | MUST | SM-41 |
| RT-418 | State | A customer balance is never state; only the status is, and every status edge is a permissioned human decision with a reason | MUST | SM-45, SM-45b, SM-46 |
| RT-419 | State | `OnHold` is not a credit control; `CreditBlocked` is the credit control, and it is liftable | MUST | SM-45a, SM-45c |
| RT-420 | State | `Declined` and `Failed` payments are retryable; `Voided` and `Captured` are terminal | MUST | SM-53, PY-14, PY-54 |
| RT-421 | State | A payment's state is a reconciliation of provider events and the local record | MUST | SM-54, EC-14 |
| RT-422 | State | A shift's only forward path is `Open` → `Reconciling` → `Closed`; there is no `Void` state, and a closed shift is immutable except for `Reopened` | MUST | SM-55, SM-57, SM-58, SM-56a |
| RT-423 | State | A `PosTerminal`'s mode is configuration, not a lifecycle step, and is separate from its service state | MUST | SM-59 |
| RT-424 | State | `Degraded` is a real device state, and `Offline` is not `Disabled` | MUST | SM-60a, SM-60b |
| RT-425 | State | An RFID session is `Opened` or `Closed`; there is no `Paused` | MUST | SM-63 |
| RT-426 | State | A rejected offline item is retained as evidence with a reason, never deleted from the queue | MUST | SM-66 |
| RT-427 | State | An offline sale that cannot be synced while the store is closed and the cache is sealed stays `Queued` for the next online window | MUST | SM-67 |
| RT-428 | State | `Pending` is the only non-terminal approval state, and every exit is terminal, reasoned, and audited | MUST | SM-68, SM-71 |
| RT-429 | State | The state-machine consistency check reports only what it has actually verified | MUST | SM-75, SM-75a |
| RT-430 | State | An in-transit transfer is never cancelled | MUST | SM-78 |
| RT-431 | State | A count posts the counted quantity, and a posted count is never re-posted | MUST | SM-81, SM-82 |
| RT-432 | State | A count may only observe; it cannot resolve a negative balance by counting upward | MUST | SM-84 |
| RT-433 | State | A revoked tag is never re-issued to a different subject | MUST | SM-86 |
| RT-434 | State | A suspended credential is readable but not usable | MUST | SM-88 |
| RT-478 | Edge Cases | A document with a child document cannot be deleted or cancelled out of order: a purchase order with recorded receipts cannot be deleted, no state machine skips a state, and a sale with a recorded return cannot be voided until that return is reversed | MUST | BI-41 |
| RT-479 | Edge Cases | A document number is unique per store per document type, is allocated inside the creating transaction, and is never reused - including after cancellation or void | MUST | BI-42 |
| RT-442 | Edge Cases | The authoritative money amount is the amount applied or settled; a tendered, handed-over, or listed amount is never authoritative | MUST | EC-23 |
| RT-441 | Edge Cases | No computation leaves an unexplained residual: a documented deterministic rule allocates it, and both sides are asserted to sum | MUST | EC-21 |
| RT-438 | Edge Cases | Concurrency is resolved by the business transaction with a bound guarantee, never by an application lock, a retry, or a UI check | MUST | EC-11 |
