# SmartStore — Reporting Domain

**Phase 1 — Product & Domain Specification.**

Owner of: the report catalogue, the query/projection rules, scope and currency, and the export rules. The
invariants are BI-16 and BI-43; the scope rules are in [multi-store-domain.md](multi-store-domain.md) §6; the
standing investigation reports are in [audit-domain.md](audit-domain.md) §7.

---

## 1. Two kinds of report, and they are not the same thing

| | **Derived query** | **Stored projection** |
|---|---|---|
| Where it lives | The source tables, read at request time | A separate structure, maintained on change |
| Freshness | Exact now | As fresh as the last write |
| Cost | Grows with history | Constant |
| Risk | Slow on large data | A bug in the maintenance path |
| Used for | Today, this shift, this month | Year-to-date, trends, all-time |

**Rule RP-01.** Every report declares which kind it is, and the UI says so where freshness differs materially.
A user comparing a live figure with a projection figure and finding a difference must be able to find out why
from the screen.

**Rule RP-02 — a projection is rebuildable.** The same rule as stock, cash, and audit (BI-02, CD-08, AU-28). A
projection that cannot be rebuilt from source is a number nobody can defend in a dispute.

**Rule RP-03 — no report is the system of record.** A report never holds a figure that exists nowhere else. A
"total sales" report is a read; a "drawer count" is not a report at all, it is a counted fact (cash-management).

---

## 2. The rule that makes reports trustworthy

> **A number is only reportable if its scope, currency, and basis are all stated. A number without those three is
> an opinion.**

**Rule RP-04.** Every report, every column, and every total states: **scope** (store, multi-store,
organization), **currency**, and **basis** (gross, net of discount, net of tax). MS-24 and PY-52 depend on this,
and so does every margin figure a manager will ever argue about.

**Rule RP-05 — the scope is in the output, not only in the filter** (MS-24). A downloaded CSV carries its scope
in the header row, because a spreadsheet outlives the screen it came from and a spreadsheet with no scope is a
rumour.

**Rule RP-06 — a report never mixes currencies in a single column.** Multi-currency output is either per-currency
columns or a single reporting currency with the rate and the rate date shown. A summed total across currencies
without conversion is arithmetic fraud.

**Rule RP-07 — where a rate is applied, the rate and its date are shown with the figure.** A converted total
without its rate is unverifiable, and exchange rates move.

---

## 3. Basis, and the arithmetic behind every number

**Rule RP-08 — the basis vocabulary is closed**: `Gross`, `NetOfDiscount`, `NetOfTax`, `NetOfAll`. A report uses
these names, not a custom meaning. The bases are the same ones the loyalty accrual question turns on
(cross-store §6 / CU-24), which is the point: one vocabulary, used consistently.

**Rule RP-09 — discount, tax, and cost allocations are attributed once, at the document line.** Every figure is
computed from allocated line values, never by multiplying a document total by a ratio. The rounding must land
where the accounting already puts it (PR-55, SP-11).

**Rule RP-10 — a report never recomputes an authoritative figure with a different rule.** If a sale's
`TotalDue` is authoritative, a report uses it. A report that re-derives `TotalDue` from lines with a slightly
different rounding is a second implementation of the sale, and the two will disagree by a penny and cost an
afternoon.

**Rule RP-11 — a report's total is the sum of its displayed rows, or it is labelled as not being so.** A total
that does not add up to the rows above it is the fastest way to lose a manager's trust in the whole system. Where
rows are truncated or sampled, the total is labelled as covering the full population (RP-12).

**Rule RP-12 — a truncated or sampled report says so, in the output, and gives the count covered and the count
total.** A partial figure presented as a whole is worse than no figure.

**Rule RP-13 — voids, refunds, and negative documents appear in the report, not as a deduction applied
afterwards.** A sales report that shows gross sales and then subtracts refunds at the bottom is hard to audit; one
that shows signed net lines is easy. Both are the same number, and the second is the one people can check.

---

## 4. Scope, and the one that is easy to get wrong

**Rule RP-14.** Reporting is subject to the full scope rules: scope before pagination and aggregation (MS-04),
`403` outside the permitted set (MS-06), organization-wide only with `Report.OrganizationWide` (MS-25),
customer data store-scoped by default (MS-28).

**Rule RP-15 — a report may never widen the scope of its own inputs.** If a report reads sales, customers, and
stock, all three are scope-checked. One unscoped input in a joined report leaks the entire organization through a
report that looked careful.

**Rule RP-16 — an employee's own-performance report is a report about data they may not otherwise see.** A
cashier's own sales and voids are visible to them; a cashier's view of the whole till's takings is not theirs to
have (SP-12). The report's scope is a function of the report, not just the role.

**Rule RP-17 — cross-store comparison requires the organization-wide permission and is marked**
(MS-25). Comparing your store to a sibling's takings without that permission is a scope violation, and the
comparison report is a scope violation even though the underlying figures are not secret.

---

## 5. The catalogue

**Rule RP-18.** v1 ships the reports a store actually runs, and each names its type (RP-01), scope (RP-04), and
audience.

### Sales

| Report | Type | Basis | Audience |
|---|---|---|---|
| Z-report / end-of-day | Derived | Gross, NetOfDiscount, NetOfTax | Manager |
| Sales by hour | Derived | NetOfDiscount | Manager |
| Sales by category / product / variant | Derived | NetOfAll | Manager |
| Sales by payment method | Derived | Gross | Manager, cashier (own shift) |
| Sales by employee | Derived | NetOfDiscount | Manager |
| Voids and refunds | Derived | NetOfAll | Manager |
| Discount analysis | Derived | Gross vs NetOfDiscount | Manager |
| Sales tax summary | Derived | NetOfTax | Accountant |
| Margin by product | Derived | NetOfAll, with cost | Manager |
| Basket size distribution | Derived | NetOfAll | Manager |

### Stock and inventory

| Report | Type | Notes |
|---|---|---|
| Stock on hand by location | Derived | Location, not store (MS-17) |
| Stock valuation | Derived | Standard or batch cost, labelled (IV-54) |
| Low stock / reorder | Derived | Threshold per variant |
| Stock movement history | Derived | Every movement, filterable (IV-07) |
| Batch and expiry status | Derived | Expiry buckets (BE-34) |
| Stock count variance | Derived | The counted-versus-expected report (IV-31) |
| Dead and slow-moving stock | Derived | No movement in N days, N configurable |

### Customers and suppliers

| Report | Type | Notes |
|---|---|---|
| Customer balance | Derived | The AR projection (CU-11) |
| Customer statement | Derived | For a single customer, with period |
| Ageing buckets | Derived | 0–30, 31–60, 61–90, 90+ days |
| Loyalty enrolment and liability | Derived | Points issued, redeemed, and outstanding (CU-33) |
| Customer purchase history | Derived | Store-scoped by default (MS-28) |
| Supplier balance | Derived | The AP projection (SU-09) |
| Payables ageing | Derived | By due date |
| Goods received versus invoiced | Derived | The three-way match report (PR-Q25) |

### Cash

| Report | Type | Notes |
|---|---|---|
| Shift and drawer variance | Derived | (CD-32) |
| Cash in / out by reason | Derived | (CD-17) |
| Safe drops and retrievals | Derived | (CD-15) |
| Variance by employee | Derived | Concentration (CD-26) |

### Operations and audit

| Report | Type | Notes |
|---|---|---|
| Daily takings reconciliation | Derived | Sales vs cash vs payments |
| Stock adjustment log | Projection of events | (AU-27) |
| Permission denials | Projection of events | (AU-27) |
| Offline sync outcomes | Projection of events | (OF-13) |
| Approval outcomes and pending queue | Projection | (AP-12) |
| Employee activity | Projection of events | (EM-21) |
| Audit chain integrity | Derived | (AU-30) |

**Rule RP-19.** Each report has a named owner, a defined grain ("one row per sale", "one row per variant per
location"), and a stated refresh characteristic. A report with no defined grain is a spreadsheet someone built
inside the product.

---

## 6. Performance, and the honest limit

**Rule RP-20.** A derived report is executed against the source data within a configurable time budget, and the
budget is enforced. Beyond it, the report is offered as a background job with a notification (NT-09) rather than
hanging a till.

**Rule RP-21 — no report runs on the transaction path.** A report is never a side effect of a sale, and a
report's failure never fails a business transaction (BI-04, BI-24).

**Rule RP-22 — a projection is maintained in the same transaction as the change it summarises**, where the
projection is authoritative for display, and otherwise by a job with a documented lag. A projection updated after
the fact has a window in which it is wrong, and that window must be documented rather than discovered.

**Rule RP-23 — the largest-history queries are indexed by the report's own access pattern.** This is a Phase 2
concern, recorded here as a requirement: a report set is not implementable on a schema that cannot serve its
access patterns, and the access patterns are known now.

**Rule RP-24 — a report is never a full table scan presented as a "quick" query.** If the data volume makes it
expensive, it is a background job. There is no third option.

---

## 7. Export

**Rule RP-25.** Export requires `Report.Export`, and every export is an audited event (AU-15). Export is the
exfiltration path, and it is treated as one.

**Rule RP-26 — an export carries its scope, currency, basis, and generation time in the file** (RP-05). A CSV
without them is a file nobody can interpret in six months.

**Rule RP-27 — export is rate-limited and bounded.** Row-count and frequency limits exist, because an export of
every customer record with every field is a data breach with a button.

**Rule RP-28 — a report that is already scoped to a store exports only that store's data** (MS-10). Export is
not a scope escape hatch, and a UI that offers "export all" on a scoped screen is a bug.

**Rule RP-29 — the destination is not a server-side integration in v1.** The export is a file the user
receives. Where data is sent automatically to another system, that is a different feature with its own consent
and audit requirements (NT-06).

---

## 8. Deliberately out of scope

**Rule RP-30 — no dashboard builder, no drag-and-drop report designer, no custom calculated fields in v1.** The
catalogue is the product. A report designer is a BI product with its own permission model, its own performance
problems, and its own audit requirements.

**Rule RP-31 — no scheduled report email in v1.** A background export exists (RP-20); sending it somewhere on a
schedule is a notification destination (NT-06) and is a Phase 3 combination.

**Rule RP-32 — no cross-store cost allocation in v1** (MS-26). Where a purchase was allocated to one store,
unattributed margin is reported as unattributed.

**Rule RP-33 — no forecasting, no trend prediction, no anomaly detection in v1.** Exception flags (low stock,
expiring batches, variance, approval backlog) are reports. Prediction is a different product and a different
liability.

**Rule RP-34 — no comparative benchmarking against other organizations.** A store can compare against its own
history and, with the permission, its own stores (MS-25). Comparing to a peer group requires a data-sharing
arrangement that does not exist in v1.

---

## 9. Reporting rules index

| ID | Rule |
|---|---|
| RP-01 | Every report declares derived or projection, and the UI says so where freshness differs |
| RP-02 | A projection is rebuildable from source |
| RP-03 | No report is the system of record |
| RP-04 | Every figure states scope, currency, and basis |
| RP-05 | Scope appears in the output, including exported files |
| RP-06 | No report mixes currencies in one column |
| RP-07 | A converted figure shows its rate and rate date |
| RP-08 | The basis vocabulary is closed: gross, net of discount, net of tax, net of all |
| RP-09 | Discount, tax, and cost are attributed at the line, never re-derived by ratio |
| RP-10 | A report uses the authoritative figure, never a re-implementation of it |
| RP-11 | A total equals its displayed rows, or is labelled as not doing so |
| RP-12 | A truncated or sampled report states the counts covered and total |
| RP-13 | Voids, refunds, and negatives appear as signed lines, not as a deduction below |
| RP-14 | Reporting obeys the full scope rules, including for joined inputs |
| RP-15 | A report may never widen the scope of any input it reads |
| RP-16 | A report's scope is a function of the report, not only the role |
| RP-17 | Cross-store comparison requires the organization-wide permission and is marked |
| RP-18 | v1 ships a named catalogue, each with type, scope, and audience |
| RP-19 | Each report has an owner, a grain, and a refresh characteristic |
| RP-20 | A derived report runs within a time budget, else becomes a background job |
| RP-21 | No report runs on the transaction path |
| RP-22 | A projection is maintained with the change or by a job with a documented lag |
| RP-23 | The schema must serve the reports' access patterns |
| RP-24 | An expensive query is a background job, not a hang |
| RP-25 | Export requires `Report.Export` and is audited |
| RP-26 | An export file carries scope, currency, basis, and generation time |
| RP-27 | Export is rate-limited and row-bounded |
| RP-28 | Export is not a scope escape hatch |
| RP-29 | No server-side report integration in v1 |
| RP-30 | No report designer or calculated fields in v1 |
| RP-31 | No scheduled report email in v1 |
| RP-32 | No cross-store cost allocation in v1 |
| RP-33 | No forecasting or anomaly detection in v1 |
| RP-34 | No cross-organization benchmarking |
