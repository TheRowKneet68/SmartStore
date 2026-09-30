# SmartStore — Edge Cases

**Phase 1 — Product & Domain Specification.**

The catalogue of the cases that break naive implementations, collected in one place. Each entry names the
mechanism that handles it, because an edge case without a named mechanism is just a worry.

**Ownership:** every entry below is owned by the domain document in its right-hand column. This document does not
create rules; it verifies that each hazard has one, and names the ones that do not.

---

## 1. How to read this

Each case is: **the situation**, **what must happen**, **the mechanism**, **the rule**. Where the answer is "this
cannot happen in v1", the entry is still listed, because the reader needs to know the boundary.

**Severity** is about the consequence of getting it wrong, not the likelihood: `Money`, `Stock`, `Security`,
`Data`, `UX`, or `Scope`.

---

## 2. Concurrency and race conditions

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-01 | Two tills sell the last unit simultaneously | One succeeds, one is refused. Never a negative balance | The movement is a conditional update in the business transaction (BI-02) | Stock |
| EC-02 | Two refunds of the same line arrive together | Both are evaluated against the same committed `SettledAmount`; the loser is refused | Per-line and per-sale bounds with a conditional counter (RR-03, BI-10) | Money |
| EC-03 | A payment is captured while the sale is being voided | One of them wins, the other is refused with a named reason | The void and the capture both take a lock on the sale | Money |
| EC-04 | A stock adjustment runs while a count is in progress | The count is declared void, or the adjustment is refused. **Never silently merge** | The count holds a count-state row; an adjustment during a count is refused (IV-33) | Stock |
| EC-05 | The same request is submitted twice (double tap, retry, timeout) | It applies once | `ClientOperationId` idempotence (`SM-04` every transition, `PY-39` commit; `BI-28` for the offline queue) | All |
| EC-06 | Two employees open the same drawer | One succeeds, one is refused | Uniqueness constraint on the open shift (CD-03) | Money |
| EC-07 | A price is edited while a cart holds the old price | The cart's line price is fixed at add time; the new price applies to the next cart | Cart lines carry the applied price (SP-24) | Money |
| EC-08 | Two suppliers' GRNs arrive for the same PO line | Both are accepted; the PO reflects the sum; over-receipt is flagged | PO state is a projection of GRNs (PR-Q18, SM-21) | Stock |
| EC-09 | A return is being dispositioned while stock is being counted | The count is void (EC-04's rule) | Same count-state mechanism | Stock |
| EC-10 | A batch is quarantined while FEFO is selecting it | The selection re-runs after the quarantine | FEFO excludes quarantined and is applied at commit, not at selection (BE-27) | Stock |

**Rule EC-11.** Every one of these is resolved by the **business transaction**, not by an application lock, a
retry, or a UI check. The test is whether the whole thing holds under two real clients, and only a transaction
with a bound guarantees that.

---

## 3. Money edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-12 | Customer hands £50 for a £13.40 sale | £13.40 applied, £36.60 change disbursed from the drawer | The amount applied, not the amount tendered (SP-39, CD-07) | Money |
| EC-13 | A card payment times out at the acquirer | The sale does **not** complete. The payment is `Pending` and reconciled | Timeout is not a failure (PY-11) | Money |
| EC-14 | The acquirer confirms a capture the cashier never saw | The payment is `Captured` and the sale is reconstructed, or the payment is voided | Provider events reconcile with the local record (PY-15, SM-54) | Money |
| EC-15 | A refund is accepted locally but declined by the acquirer | The refund is `Failed`, queued, retried, and notified | Refund has its own lifecycle (PY-25, RR-23) | Money |
| EC-16 | A cash shift is counted short by £2 | Recorded as a £2 variance with a reason. **Never adjusted away** | Variance is derived and acknowledged (CD-22, CD-24) | Money |
| EC-17 | A sale is part-paid and then the customer returns part of it | The refund is bounded by the settled amount, not the list price | Per-line settled amounts (BI-10, SP-11) | Money |
| EC-18 | A credit sale's customer later exceeds the limit at the till | The sale is refused, or routed to an approved override | Limit check plus approval (CU-15, AP-01) | Money |
| EC-19 | A supplier invoice arrives for a PO never received | `Disputed`. **No payable, no stock** | Three-way match (PR-Q25, SM-28) | Money |
| EC-20 | A payment provider is configured to a test endpoint in a live store | The change is approvaled and audited; the risk is documented | Highest-privilege permission (PY-06) | Security |
| EC-21 | Rounding leaves a penny unreconciled | The residual is allocated by a documented deterministic rule, and both sides are asserted to sum | The residual rule (PR-55, SP-11) | Money |
| EC-22 | A gift card is redeemed on two tills at once | One succeeds | Bounded redemption with a conditional counter (PY-31, BI-19) | Money |

**Rule EC-23.** In every money case above, the rule is the same: **the amount that is authoritative is the
amount that was applied or settled**, and a tendered, handed-over, or listed amount is never authoritative.

---

## 4. Stock edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-24 | A sale is for more than the location holds, and the store allows negative | The sale completes and the stock is negative. It is flagged, not blocked | `AllowNegative` (IV-16, IV-17) | Stock |
| EC-25 | The same, and the store blocks negative | The sale is refused with the shortfall named | `BlockNegative` (IV-10) | Stock |
| EC-26 | A sale needs stock that is quarantined | The FEFO selection skips it. If nothing else qualifies, the sale is refused | Quarantined excluded (BE-24) | Stock |
| EC-27 | A sale needs stock that expires today | It is sold. Expiry is through the end of the business date | Expiry is end-of-day (BE-17) | Stock |
| EC-28 | A sale needs stock whose only batch is a shortfall pseudo-batch | It is **not sellable**. Pseudo-batches are for recording, not for sale | Pseudo-batches are non-sellable (BE-29) | Stock |
| EC-29 | A batch with no expiry date competes with dated batches | The dated one is used first. Null sorts last | FEFO with null last (BE-20) | Stock |
| EC-30 | A transfer is dispatched and never arrives | Stock sits in `Transit` and the report shows it. It is neither origin's nor destination's | Real transit location (IV-44) | Stock |
| EC-31 | A stock count is running and the system is asked for a stock value | The value is as at the count, or flagged as in-progress | Count state (IV-33) | Stock |
| EC-32 | A product is discontinued with stock on the shelf | It is still sellable. `Discontinued` blocks ordering, not selling | Discontinued is sellable from stock (SM-11) | Stock |
| EC-33 | A variant is deactivated with stock on hand | Stock remains. Deactivation blocks new use, not existing stock | Deactivation is prospective (PR rule) | Stock |
| EC-34 | A negative stock item is later replenished to zero | The negative is resolved. No phantom movement | The balance is a projection (BI-02) | Stock |
| EC-35 | A sale is voided after the stock had been moved | The stock returns, via a compensating movement, not a delete | Void is pre-print only; stock reverses (SP-20, SP-30) | Stock |
| EC-36 | A return arrives with more than was sold | The excess is refused or dispositioned to a non-sellable location. **Never silently added to sellable stock** | The disposition is explicit (RR-17) | Stock |

---

## 5. Data integrity edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-37 | A product is deleted while a sale references it | It is deactivated or retired. Never deleted | Finalized records are immutable (BI-08, BI-40, AU-32) | Data |
| EC-38 | A customer is deleted while an open balance exists | Refused | AR and AP are ledger projections (CU-11, SU-09) | Data |
| EC-39 | A store is deactivated while it has stock and open shifts | Refused until they are resolved | Referential guards | Data |
| EC-40 | Two employees have the same PIN | Refused | Uniqueness (EM rule) | Security |
| EC-41 | A barcode is assigned to two variants | Refused | Organization-wide unique (PR rule) | Data |
| EC-42 | A category is moved under itself | Refused. The tree has no cycles | Single-parent tree (PR rule) | Data |
| EC-43 | An invoice's currency differs from the PO's | `Disputed` | The match compares terms (PR-Q25) | Money |
| EC-44 | A stock movement's document is deleted | Never. The movement is a ledger row | Movements are immutable (BI-02) | Data |
| EC-45 | A user's role assignment is removed mid-session | The next request is refused; the session is revoked | Permissions are checked per request (AC-01) | Security |

**Rule EC-46.** In every integrity case, the answer is **refuse**, not repair. A system that repairs these
silently has a data problem it is hiding from the person who needs to know.

---

## 6. Concurrency between offline and online

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-47 | An offline sale is synced and the price has changed online | Accepted with an adjustment, and the difference is shown to the cashier | `AppliedWithAdjustment` (OF-36) | Money |
| EC-48 | An offline sale is synced and the variant is now deactivated | `Rejected`, with the reason | The server is authoritative (OF-31) | Data |
| EC-49 | An offline sale is synced after the customer has paid online for the same basket | Both exist. The customer has a duplicate. It is reported, not auto-merged | The offline queue applies what it holds (OF-31) | Money |
| EC-50 | The same offline sale syncs twice | Applied once | Idempotence on `ClientOperationId` (OF-22, BI-28) | All |
| EC-51 | The terminal's clock is wrong | The server's `OccurredAt` wins; the terminal's time is retained for the discrepancy | Server time is authoritative (OF-25) | Data |
| EC-52 | The offline cache is stale past its declared limit | The sync is refused, or accepted with the staleness flagged | Declared staleness per cache (OF-13) | Data |

**Rule EC-53.** Offline is not a separate system. **Every offline sale is an online sale that arrived late**, and
the server is the only authority on price, permission, and stock (OF-31). An offline terminal that can apply its
own price is a price-integrity hole with a queue in front of it.

---

## 7. Scope and permission edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-54 | A store manager queries Store B's sales by changing a URL parameter | `403` | Scope before query, not after (MS-04, MS-06) | Scope |
| EC-55 | An organization-wide role holder reads a store's data | Allowed, because the role is scoped organization-wide | Role scope (MS-11) | Scope |
| EC-56 | The Owner tries to act without a permission | Refused. The Owner is not a superuser | Owner holds a role (MS-13) | Security |
| EC-57 | An employee with no store access signs in | An empty workspace with an explanation | No store picker (MS-08) | UX |
| EC-58 | A user has the requesting permission but not the approving one | They can request, not approve | Separate permissions (AP-29) | Security |
| EC-59 | An export is run on a store-scoped report | Only that store's data is exported | Export is not a scope escape (RP-28) | Scope |
| EC-60 | A supplier ledger entry from Store A is viewed in Store B | The supplier is global; the entry is store-scoped. It shows under Store A | Store scope on entries (SU rule) | Scope |
| EC-61 | A report aggregates across a store the user cannot see | Refused. The aggregation is scoped, not the rows | Scope before aggregation (MS-04) | Scope |

**Rule EC-62.** Every scope edge is refused, never filtered-and-shown. A user who knows a store exists learns
nothing about it beyond the refusal (MS-07's trade-off, acknowledged).

---

## 8. Time and clock edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-63 | A batch expires at midnight and a sale happens at 23:59 | The sale succeeds | Expiry is end-of-business-date (BE-17) | Stock |
| EC-64 | The business date is changed at 18:00 to close the day early | Open transactions are handled; the change is audited | Business date is a store setting (organization-model) | Data |
| EC-65 | A credit sale is not repaid on a date basis | No due date exists in v1, so no automatic standing change, no dunning, and no `CreditOverdue`: the balance is governed only by the credit-limit rules (CU-12..CU-23) | No credit due date in v1 (CON-06); `CreditOverdue` deliberately absent (NT-37); D-05 | Money |
| EC-66 | A return arrives after the return window | `Rejected` with the reason, unless the store has extended it | The window is per store, per category (RR rule) | Money |
| EC-67 | A timezone is wrong on a terminal | The server's time and date govern all business logic | Server time is authoritative (OF-25) | Data |

**Rule EC-68.** **Every time question has exactly one authority: the server.** Terminals, browsers, and users
display times; they do not decide them. A POS whose business date is its own clock is a POS whose day ends when
its battery dies.

---

## 9. Failure and degradation edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-69 | The scanner dies mid-sale | The cashier types the barcode. The sale continues | Device failure degrades a feature (HD-19) | UX |
| EC-70 | The scale dies | The weight is entered manually, with a reason | Manual weight with a reason (PR-28, SP-18) | UX |
| EC-71 | The card reader is up but the network is down | Offline card payment goes to the acquirer, not to SmartStore (PY-47) | Offline card (PY-47) | Money |
| EC-72 | The provider is down entirely | Payments stay `Pending` with backoff. The till keeps taking cash and offline sales | Never auto-fail (PY-41) | Money |
| EC-73 | The server is down | The terminal runs offline within its cache and policy | Offline POS (offline-pos-domain) | All |
| EC-74 | A report takes too long | It becomes a background job with a notification | Time budget (RP-20) | UX |
| EC-75 | A notification provider is down | The notification is in-app only, and the delivery is recorded | Channel independence (NT-18) | UX |
| EC-76 | The audit chain check fails | It is an incident, escalated | Chain check is a job (AU-30) | Security |

**Rule EC-77.** In every failure case, the **business operation is prioritised over the record of it**, except
where the record *is* the operation. A till that stops selling because a notification provider is down has
misplaced its priorities.

---

## 10. UX and human edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-78 | The cashier is interrupted mid-sale | The cart survives, in memory and on disk, with a TTL | Cart is terminal-local, resilient (SP-43) | UX |
| EC-79 | Two cashiers share a terminal | The second signs in; the cart is not lost; the sale is attributed to whoever completes it | Session change preserves the cart (SP-11) | UX |
| EC-80 | A customer argues at the till | The cashier can void (before print) or issue a return/refund. The system is not the argument | Void and refund paths exist and are fast | UX |
| EC-81 | A blind cashier uses the system | Every action is audible and the confirmation is spoken. Nothing is visual-only | Accessibility baseline (ux-requirements) | UX |
| EC-82 | A screen is smashed and replaced | The new terminal is provisioned. The old one's history is intact | Device provisioning (HD-18) | UX |
| EC-83 | A new cashier's first sale | The shift is opened, the float counted, the sale is ordinary. **There is no training mode in production** | Roles and permissions gate it (EM-14) | UX |

**Rule EC-84.** The customer's dispute is a **process** (void, return, refund, escalate), not a feature. Every
one of those paths must be reachable in a few taps, because the moment they are needed is the moment the shop is
busy.

---

## 11. Cases that cannot occur in v1, and why

These are the edges a reader will look for. They are listed so their absence is deliberate and traceable.

| Situation | Why it cannot happen in v1 | When it can |
|---|---|---|
| A central warehouse is drawn from by a sale | Central warehouses do not sell (MS-15, MS-18) | Never; a transfer is the mechanism |
| A multi-drawer shift | One drawer per terminal in v1 (CD-34) | v2, if a terminal needs two drawers |
| Two stores trade stock directly | Cross-store transfers are configuration-disabled (MS-20) | Phase 3, with the MS-21 prerequisites |
| A customer is deleted | Never; deactivated, and the ledger is retained (EC-38) | Never |
| A payment is voided after capture | `Captured` has no outgoing edge (SM-51) | Never; it is a refund |
| A sale is voided after a receipt printed | The print is the point of no return (SM-34) | Never; it is a return and refund |
| An employee is locked out of the business | Lockout is a login-attempt record, not employee state (SM-49) | Never |
| A stock policy is overridden by hand | No manual override (SM-15) | Never |
| An approval is granted by a link | No approval by link (AP-39) | Never, without a full token design |
| A self-approval happens | Blocked at the data layer (AP-08, AP-40) | Never |

**Rule EC-85.** Each of these is a place where a future version could be tempted to add a shortcut. **The reason
each is closed is written down, so the shortcut has to argue with the reason rather than with memory.**

---

## 12. Multi-store edges

| # | Situation | What must happen | Mechanism | Sev |
|---|---|---|---|---|
| EC-86 | A store is added and immediately used | It needs its own settings, roles, and at least one terminal and drawer. **A store with no terminal cannot trade** | The hierarchy's required children (organization-model §3) | Data |
| EC-87 | A manager's role is organization-wide | They act in every store their access allows | Role scope (MS-11) | Scope |
| EC-88 | A manager's role is store-scoped, and they add a second store | The role does **not** automatically extend. A new assignment is needed | Role scope is explicit (MS-11) | Scope |
| EC-89 | A store is deactivated with open shifts | Refused until the shifts are closed | Referential guards (EC-39) | Money |
| EC-90 | Central-warehouse stock is reported | It is reported by originating store, and labelled as a reconciliation view | The compromise (MS-19) | Data |

**Rule EC-91.** Multi-store v1 is **one store**. Every rule here is about being *ready* for the second store, not
about supporting it. The readiness is the non-null `StoreId` (MS-01); the rest is documentation so that adding a
store is a configuration and a review, not a redesign.

---

## 13. What is deliberately unhandled in v1

| Situation | Decision | Where |
|---|---|---|
| Two currencies in one drawer | Not possible. One currency per drawer | CD-36 |
| A tendered amount that exceeds any possible change | Refused. The drawer has limits | CD rule |
| A sale split across three tenders in three currencies | Not possible. One currency per sale | RP-06 |
| A return of an item bought at a different price | Refunded at what was paid, per line | RR-02 |
| An exchange where the customer wants the price difference in cash | The exchange is a return plus a sale, and the difference is a refund | RR |
| A negative-tender credit note for an overpayment | Store setting, reason-bearing, reported | PY-19 |
| Inter-store credit | Not in v1 | MS-33 |
| A report that mixes cost bases | Refused. The basis is a closed vocabulary | RP-08 |
| An approval with a conditional rule | Not in v1 | AP-37 |
| A batch with a null expiry in an expiry-required category | Cannot be created | BE-19 |
| An offline sale of a product not in the cache | Refused at the terminal, before it is queued | OF |

---

## 14. The test that matters

**Rule EC-92.** For every case in this document marked `Money`, there is an automated test that reproduces it
with **two concurrent actors** where concurrency is possible, and asserts the bound holds. The `Money` cases are
the ones where a bug is discovered by an auditor, and the only defence is a test that would have caught it.

**Rule EC-93.** The cases marked `Scope` are tested at the **API boundary**, not in the UI, because the UI is
where a scope check gets bypassed in practice (EC-54, RP-15).

**Rule EC-94.** The cases in §11 are tested as **regression guards**: each asserts that the forbidden transition
is still refused. They exist so that a later "just this once" change fails a test rather than shipping.
