# SmartStore — Supplier Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Supplier`, `SupplierContact`, `SupplierLedgerEntry`, `SupplierProduct` structure, payment terms, and
supplier performance. The purchasing workflows that consume all of this are in
[procurement-domain.md](procurement-domain.md); the payable consequence of an invoice is §5 there.

---

## 1. Why a supplier is organization-global

**Rule SU-01.** `Supplier` and `SupplierContact` carry **no `StoreId`** (organization-model §8.1). A supplier is a
counterparty to the whole business. A store that creates its own copy of a supplier produces two records, two
balances, and no reliable answer to "what do we owe this company".

**Rule SU-02 — the *transaction* is store-scoped even though the supplier is not** (organization-model §8.2).
`SupplierLedgerEntry` carries the store that transacted. This is CON-08's resolution: the balance is available at
organization scope and at store scope, both as projections of the same entries, and every report states which
scope it is showing.

**Why this needs saying explicitly.** It is the exact shape of the multi-store data leak — a store-scoped
projection next to a global counterparty, and someone assumes the store figure is the whole picture. The report
labels it. That is the whole control.

---

## 2. Supplier record

`Supplier` holds:

| Field | Notes |
|---|---|
| Code | Unique per organization. Immutable once referenced by a document |
| Name, trading name | |
| Status | `Active`, `Dormant`, `Blocked`, `Archived` |
| Tax identifier, registration number | Per jurisdiction |
| Payment terms | Days. Default for invoices raised without explicit terms (PR-Q37) |
| Currency | The currency the organization transacts with them in |
| Bank/settlement details | Permissioned, audit-read |
| Lead time (default) | Days, informational. Per-product lead time lives on `SupplierProduct` |
| Minimum order value | Informational; guides the requisition, never blocks it |
| `IsPreferred` | Preferred among suppliers for nothing in particular. Preference is per variant (PR-49) |
| Tax status | Registered, exempt, reverse-charge, unregistered — a **fact**, recorded, not inferred |
| Rating / notes | Descriptive |

**Rule SU-03 — supplier status semantics are distinct**, and conflating them is the common failure:

| Status | Can order? | Can receive? | Can invoice? | Can pay? |
|---|---|---|---|---|
| `Active` | Yes | Yes | Yes | Yes |
| `Dormant` | No new POs | Yes — stock in flight must land | Yes | Yes |
| `Blocked` | **No** | Refused, except against an existing PO with approval | Refused | Existing payables only, with approval |
| `Archived` | No | No | No | Payables only, until settled |

**Rule SU-04 — `Dormant` exists because a supplier who stopped selling to you still has stock in transit and an
unpaid invoice.** Blocking them outright strands a delivery. The status that says "not buying more" is not the
status that says "ignore everything from them", and one status cannot be both.

**Rule SU-05 — `Archived` is the only terminal state, and a supplier with an outstanding balance may not be
archived** (BI-40). Settle or write off first, with a reason. This is the ledger-side twin of ORG-03.

**Rule SU-06 — deletion is not available.** Ever. A purchase invoice in 2029 renders against this supplier record
(PR-05).

---

## 3. Contacts

`SupplierContact` holds name, role, email, phone, and flags for `IsOrderContact` / `IsAccountsContact` / `IsEscalation`.
**No login, no portal access** (actors-and-roles §3.16).

**Rule SU-07.** Contacts are organization-global, like the supplier. Two stores sharing one supplier share its
contacts; duplicating them per store is the same mistake as duplicating the supplier.

**Rule SU-08 — the contacts on a purchase order are snapshotted** (PR-05). A contact who leaves in 2027 does not
change who a 2026 order went to.

---

## 4. Supplier ledger and payable

### 4.1 The balance is a projection

`SupplierLedgerEntry` types:

| Type | Effect on payable | Created by |
|---|---|---|
| `Invoice` | **Increases** what is owed | A posted purchase invoice (procurement-domain §5) |
| `InvoiceOnly` | Increases | A service or advance invoice, no goods |
| `CreditNote` | **Decreases** | A purchase return (PR-Q31), a price correction |
| `Payment` | **Decreases** | `Purchase.Pay` (PR-Q34) |
| `DebitNote` | Increases | A supplier charging for a cost the store caused |
| `Reversal` | Opposite of the referenced entry | A correction (BI-15 shape) |
| `WriteOff` | Decreases to zero | `Supplier.Credit.Adjust` + reason |
| `Adjustment` | Either | `Supplier.Credit.Adjust` + reason, always flagged |

**Rule SU-09 — the balance is a projection of the entries**, and both organization and store balances are
projections. Never a stored mutable total, for the same reason as stock (BI-02) and receivables (CU-11).

**Rule SU-10 — a payment is bounded by the outstanding payable** (PR-Q34), checked atomically. An overpayment is
either refused or held as an unapplied credit, and it is **reported** — an unapplied credit on a supplier account
is where a duplicate invoice's payment hides.

**Rule SU-11 — a write-off reduces the balance to zero and leaves the entries intact**, with permission and a
reason (BI-25), reported by actor, value, and reason (IV-36 shape).

**Rule SU-12 — a statement is reproducible from the ledger** (BI-11), shows the running balance, the terms, the
due date, and states its scope (SU-02).

### 4.2 Payment terms and due dates

**Rule SU-13 — a due date is computed once, at invoice posting**, from the supplier's terms and the invoice date,
and stored. It does not recompute when terms change — a term change is prospective and affects future invoices
only. The same rule as tax (BI-18) and price (PR-32), applied consistently because the reason is the same: a
historic document's interpretation must not move.

**Rule SU-14 — an early-payment discount is recorded when taken** (PR-Q37). Whether SmartStore *offers* to
calculate the best payment date is an open decision; what is not optional is that the discount actually taken is
recorded so the payable and the payment reconcile exactly.

**Rule SU-15 — aged payables are reported by bucket** (current, 1–30, 31–60, 61–90, over 90), at organization and
store scope, with a **supplier-concentration report** for suppliers carrying an unusual share of overdue value.
Concentration is the practical control: a supplier with 60% of overdue payables is a conversation, and the data to
have it is already there.

---

## 5. Supplier performance

Measured, because procurement is a management function and a system that cannot say "this supplier is late" makes
the manager guess.

**Rule SU-16 — four measures, each from recorded facts only:**

| Measure | Definition | Source |
|---|---|---|
| On-time rate | Delivered on or before the expected date ÷ deliveries | `GoodsReceipt.ReceivedDate` vs the PO's expected date |
| Fill rate | Delivered quantity ÷ ordered quantity, by value | GRN vs PO line (PR-Q17) |
| Acceptance rate | Accepted ÷ received, excluding damage the supplier caused | PR-Q15 |
| Price variance | Invoiced vs ordered unit price | The three-way match (PR-Q25) |

**Rule SU-17 — only committed POs are measured.** A supplier is not penalised for a line cancelled before it was
ever sent. Measuring drafts would make the number meaningless, and a meaningless performance number gets
ignored, which is worse than having none.

**Rule SU-18 — measurements are over a declared period and stated as such.** A supplier with two deliveries this
quarter has a 100% or 0% on-time rate, and the report says "n = 2" so nobody draws a conclusion from it.

**Rule SU-19 — performance is a reporting output, never an input to a workflow.** No automatic PO blocking, no
automatic suspension, no penalty pricing. It informs a human. An automatic action on a computed ratio is a system
making a commercial decision from a sample size of two.

---

## 6. Supplier-facing documents

**Rule SU-20 — the supplier document set is defined** (SU-12 in actors-and-roles, actors §3.16):

| Document | Produced by | Contains |
|---|---|---|
| Purchase order | `Purchase.Order.Send` | Ordered goods, quantities, prices, delivery address, terms |
| Delivery schedule | Purchasing | What is expected, when, per store |
| Debit/credit note | `Purchase.Return.Create` | Returned goods, quantities, reason |
| Statement | Accountant, on request | The ledger, running balance, due date, scope |
| Remittance advice | Accountant | Payments made, by amount, date, method, and which invoices they settle |

**Rule SU-21 — a purchase order reveals what was bought and never what it was sold for** (SU-12 in
actors-and-roles). No cost, no margin, no resale price, no volume-of-sales figures appear on any supplier-facing
document. This is a disclosure control, and it is a hard one: a PO template with a "suggested retail" field is
the leak.

**Rule SU-22 — no supplier portal in v1.** Documents are produced and sent by whatever means the store uses.
A portal is a product, and it is not this one (overview §6).

---

## 7. Privacy and permissions

**Rule SU-23 — bank details are a distinct, permissioned read.** Viewing settlement details is not part of
`Supplier.View`. It is part of payment work, and the actor who needs it is the Accountant, not the person who
enters purchase orders. The permission exists so the entry clerk cannot see where the money goes.

**Rule SU-24 — a bank-details change is reasoned, approvaled, and audited.** Changing where payments go is a
classic payment-fraud vector, and the audit entry is what makes it detectable. **This is a SHOULD-grade control
with real value and near-zero cost: it is one permission and one audit reason on an existing form.**

**Rule SU-25 — supplier data is not customer data.** A supplier may also be a customer (a market trader). The
records are separate, and a supplier statement never exposes customer data and vice versa. The shared legal entity
is a relationship fact, not a join.

**Rule SU-26 — no PII in logs** (CU-35). Supplier contact details and bank details are PII/financial data
and are logged as ids.

---

## 8. Suppliers rules index

| ID | Rule |
|---|---|
| SU-01 | `Supplier` and `SupplierContact` are organization-global, with no `StoreId` |
| SU-02 | Ledger entries are store-scoped; both scopes are projections and reports state which |
| SU-03 | `Active`/`Dormant`/`Blocked`/`Archived` have distinct order, receive, invoice, and pay semantics |
| SU-04 | `Dormant` exists so in-flight stock and unpaid invoices are not stranded |
| SU-05 | `Archived` is terminal, and blocked while a balance is outstanding |
| SU-06 | A supplier is never deleted |
| SU-07 | Contacts are organization-global, like the supplier |
| SU-08 | Contacts on a PO are snapshotted |
| SU-09 | The balance is a projection of entries, never a stored mutable total |
| SU-10 | A payment is bounded by the payable; an overpayment is a reported unapplied credit |
| SU-11 | A write-off leaves the entries intact, with permission and a reason |
| SU-12 | The statement is reproducible and states its scope |
| SU-13 | A due date is computed once at posting and stored |
| SU-14 | An early-payment discount taken is recorded |
| SU-15 | Aged payables are reported by bucket, with a supplier-concentration report |
| SU-16 | Performance uses four measures from recorded facts only |
| SU-17 | Only committed POs are measured |
| SU-18 | Every measurement states its period and n |
| SU-19 | Performance is a report, never an input to an automatic workflow |
| SU-20 | The supplier document set is defined |
| SU-21 | No supplier document discloses resale price, margin, or sales volume |
| SU-22 | No supplier portal in v1 |
| SU-23 | Bank details are a separate permission from `Supplier.View` |
| SU-24 | A bank-details change is reasoned, approvaled, and audited |
| SU-25 | Supplier and customer records stay separate even for a shared legal entity |
| SU-26 | No supplier or bank PII in logs |
