# Permission-key proposal — for the owner's answer

**Date:** 2026-10-01. **Status:** PROPOSED. Nothing here takes effect until you answer. Working agreement 8 asks for
this list before Domain 5.

**Why you are being asked.** Naming which permission authorizes an action is yours (`SM-02d`, architecture §8.4). The
database marks each action below `OpenDecision`, or leaves its edge out. Until you name a key, the server refuses the
action for everyone, the Owner included.

**No key is invented here.**
- Option A reuses a key already in the 117-key catalogue (actors-and-roles §2).
- Where no catalogue key fits well, option B is a *proposed* new name. It enters the catalogue only if you tick it.
- `Payment.Capture` is the one exception: `/docs` already uses that name (`SEP-06`), but the catalogue lacks it.

**How to answer.** Tick one box per question, in this file or in a reply such as "Q1 A, Q2 B, Q3 A, …". A question you
do not answer stays refused. Your answers are applied in Phase E, and no key is ever renamed without asking you.

## At a glance

| Q | Action | Open question | Today | Recommended | Blocks |
|---|---|---|---|---|---|
| 1 | Card payment: submit | OQ-018 | Refused | A: `Sale.Create` | Card payments |
| 2 | Card payment: capture | OQ-018 | Refused | B: `Payment.Capture` (named by `SEP-06`) | Card payments |
| 3 | Card payment: void | OQ-018 | Refused | A: `Sale.Void` | Voiding a card tender |
| 4 | Employee: back from leave | OQ-025 | Refused | A: `Employee.Edit` | Returning staff to work |
| 5 | Employee: reactivate after suspension | OQ-025 | Refused | A: `Employee.Edit` | Reinstating a suspended employee |
| 6 | Till: re-enable | OQ-025 | Refused | A: `Device.Disable` | Putting a disabled till back in service |
| 7 | Refund: pay it (submit to provider) | OQ-023 | Refused | A: `Sale.Refund` | **Every refund, cash included** |
| 8 | Refund: retry a failed one | OQ-023, OQ-025 | Refused | A: `Sale.Refund` | Retrying a refund |
| 9 | Refund: cancel | OQ-023 | Refused | A: `Sale.Refund` | Cancelling an unpaid refund |
| 10 | Customer return: cancel | OQ-023 | Refused | A: `Return.Create` | Cancelling a draft return |
| 11 | Warehouses and storage locations | OQ-026 | No route | A: `Config.Organization` | Quarantine, Damaged and ExpiredHold locations for returns |
| 12 | Defining roles | OQ-028 | `Role.*` (built) | A: keep `Role.Create`/`Role.Edit` | Nothing |
| 13 | Reading a receipt at the till | D4 §10 | `Sale.View` (built) | B: `Sale.Create` | A plain cashier fetching a receipt |
| 14 | Shift: reopen a closed shift | OQ-014 | No edge | A: `Cash.Variance.Acknowledge` | `CD-26`, reopening |

## The questions

### Q1 — Card payment: submit (creation → `Pending`)
- **Where:** state-machines §22.10, creation. `GAP-036`.
- **Today:** refused, so no card payment can start. A cash tender is created inside the sale's completion under
  `Sale.Create`, as §22.6 lists "payment captured" among its side effects (OQ-018's reading).
- **Reuse:** `Sale.Create`, "ring up a sale and complete it". Starting a tender is part of completing a sale.
- **New, if you prefer a separate key:** `Payment.Submit` (proposal).
- **Recommended:** A. One key for the whole sale at the till, as cash already works.
- [ ] A — `Sale.Create`
- [ ] B — new key `Payment.Submit`
- [ ] C — other: ______

### Q2 — Card payment: capture (`Authorized` → `Captured`)
- **Where:** §22.10. `SEP-06` (actors-and-roles §2.13) already names a key `Payment.Capture`, and advises that one
  person should not hold it together with `Payment.Provider.Configure`.
- **Reuse:** `Sale.Create`.
- **New:** `Payment.Capture`, the name `/docs` already uses, added to the catalogue.
- **Recommended:** B. `SEP-06` names this key, so its advisory separation then applies as written. Under A, there is
  no key for it to separate.
- [ ] A — `Sale.Create`
- [ ] B — add `Payment.Capture`
- [ ] C — other: ______

### Q3 — Card payment: void (`Pending`/`Authorized` → `Voided`)
- **Where:** §22.10. A void releases a card authorization before capture.
- **Reuse:** `Sale.Void`, "void a sale that has not yet been finalized". A tender is voided only before the sale
  completes.
- **New:** `Payment.Void` (proposal).
- **Recommended:** A.
- [ ] A — `Sale.Void`
- [ ] B — new key `Payment.Void`
- [ ] C — other: ______

### Q4 — Employee: back from leave (`OnLeave` → `Active`)
- **Where:** §22.9, the reversal of `leave`, which needs `Employee.Edit`.
- **Reuse:** `Employee.Edit`, "manage employee records".
- **Recommended:** A. Whoever may send someone on leave may bring them back.
- [ ] A — `Employee.Edit`
- [ ] B — other: ______

### Q5 — Employee: reactivate after suspension (`Suspended` → `Active`)
- **Where:** §22.9 and `SM-50`, which says reactivation is audited and needs a reason. The data already requires both.
- **Reuse:** `Employee.Edit`, the key that suspends.
- **New:** `Employee.Reactivate` (proposal), if reinstating access should be narrower than suspending it.
- **Recommended:** A. It mirrors suspension, and the reason and the audit are enforced either way.
- [ ] A — `Employee.Edit`
- [ ] B — new key `Employee.Reactivate`
- [ ] C — other: ______

### Q6 — Till: re-enable (`Disabled` → `Active`)
- **Where:** §22.12, and `HD-32`: "a disabled device can be re-enabled".
- **Reuse:** `Device.Disable`, the high-impact key that takes a till out of service (`HD-31`), or `Device.Edit`, which
  activates a newly registered till.
- **Recommended:** A. Putting a till back into service should take the same authority as taking it out.
- [ ] A — `Device.Disable`
- [ ] B — `Device.Edit`
- [ ] C — other: ______

### Q7 — Refund: pay it (`Approved` → `Processing`, "submit to provider")
- **Where:** §22.7. **This is the step that pays.** Until it has a key, no refund can be paid in v1, not even in cash.
- **Reuse:** `Sale.Refund`, "issue a refund within the permitted amount". Approval beyond the threshold is already
  `Sale.Refund.Large.Approve`.
- **New:** `Refund.Pay` (proposal).
- **Recommended:** A.
- [ ] A — `Sale.Refund`
- [ ] B — new key `Refund.Pay`
- [ ] C — other: ______

### Q8 — Refund: retry a failed one (`Failed` → `Processing`)
- **Where:** §22.7's Reversal column (OQ-025 item 1). A retry pays again after a provider failure.
- **Reuse:** `Sale.Refund`.
- **Recommended:** A. The same authority as paying it.
- [ ] A — `Sale.Refund`
- [ ] B — other: ______

### Q9 — Refund: cancel
- **Where:** §22.7. Cancelling releases the refund's hold on the sale's lines (`RR-24`).
- **Reuse:** `Sale.Refund` (the issuer), or `Sale.Refund.Large.Approve` (a manager).
- **Recommended:** A. A cancelled refund pays nothing, and its reason is required by the data.
- [ ] A — `Sale.Refund`
- [ ] B — `Sale.Refund.Large.Approve`
- [ ] C — other: ______

### Q10 — Customer return: cancel
- **Where:** §22.7.
- **Reuse:** `Return.Create`, "accept a customer return against a sale", or `Return.Approve`.
- **Recommended:** A. The person who accepts a return may withdraw it before it posts.
- [ ] A — `Return.Create`
- [ ] B — `Return.Approve`
- [ ] C — other: ______

### Q11 — Warehouses and storage locations: create, rename, mark sellable
- **Where:** OQ-026, `WH-03`. actors-and-roles §3.3 gives "create warehouses and locations" to the Super Administrator,
  whose template holds `Config.*`.
- **Reuse:** `Config.Organization`, "organization settings, tax, reason codes, approval thresholds"; locations are
  organization-global (D-03). Or `Config.Store`, "store settings".
- **Recommended:** A. Domain 5 needs this for the non-sellable locations that returns go to.
- [ ] A — `Config.Organization`
- [ ] B — `Config.Store`
- [ ] C — other: ______

### Q12 — Defining roles: `Config.Roles` against `Role.Create`/`Role.Edit`
- **Where:** OQ-028. Both describe changing role definitions. `SEP-03` keeps `Config.Roles` apart from `Role.Assign`.
- **As built:** `Role.Create` and `Role.Edit` define roles, `Role.Assign` assigns them, and `Config.Roles` authorizes
  nothing.
- **Recommended:** A. The narrower keys, as built.
- [ ] A — keep `Role.Create`/`Role.Edit`; `Config.Roles` authorizes nothing
- [ ] B — `Config.Roles` defines roles; `Role.Create`/`Role.Edit` authorize nothing
- [ ] C — other: ______

### Q13 — Reading a receipt at the till
- **Where:** D4 §10.
  - As built, recording a print's outcome and reprinting need `Sale.Create`, and reading a receipt needs
    `Sale.View`.
  - But the Cashier template (actors-and-roles §4) has no `Sale.View`, so a plain cashier could not fetch the receipt
    of the sale they just made.
- **Recommended:** B.
  - Reading a receipt is receipt issuance, the cashier's work.
  - The list of sales and one sale's detail stay under `Sale.View`.
- [ ] A — keep `Sale.View` for reading a receipt
- [ ] B — `Sale.Create` for reading a receipt
- [ ] C — other: ______

### Q14 — Shift: reopen a closed shift (`Closed` → `Reopened`)
- **Where:** §22.11 gives it an `OPEN DECISION` permission. `CD-26` makes it exceptional: it needs a reason, is
  audited, and appears on the reopened-shifts report. OQ-014. There is no edge yet, so this also needs building.
- **Reuse:** `Cash.Variance.Acknowledge`, a manager's accountability key for the shift's money, or `Shift.Close`.
- **New:** `Shift.Reopen` (proposal), if reopening should be rarer than acknowledging.
- **Recommended:** A.
- [ ] A — `Cash.Variance.Acknowledge`
- [ ] B — new key `Shift.Reopen`
- [ ] C — leave reopening unbuilt in v1

## Edges that are not key questions

These are recommended to stay as they are:
- **`Reconciling` → `Open` (abandoning a count).** §12 draws it, but §22.11 does not contract it (OQ-014).
  **Recommended:** no edge. A count can always be redone, and a new pass is cheap.
- **A return's `settle` and `close`.** Their meaning is undefined (OQ-023 item 2): how a return's refundable amount is
  prorated, and where a write-off goes. **Recommended:** returns rest at `Posted` in v1.

## Other open questions that block building

Each has an interim in place. Answer when you can:

| OQ | Question | Interim | Recommended |
|---|---|---|---|
| OQ-014 | Reopening a closed shift, and abandoning a count | Both refused | Q14 above; abandoning stays refused |
| OQ-020 | The variance tolerance, and the higher threshold that needs a different approver (`CD-23`) | Tolerance 0; no second approver | Give both as amounts per store, or keep 0 and none |
| OQ-029 | May the declared closing float exceed the counted amount? | Recorded as declared | Refuse a float above the latest count |
| OQ-030 | The minimum touch-target size and text contrast ratio (`UX-53`, `UX-54`, `RT-380`) | WCAG 2.2 AAA (7:1), controls ≥ 3rem | Adopt the interim as the standard |
| OQ-024, item 2 | `AU-25` and `RT-300` require every read of the audit log to be audited itself, but the closed `AU-12` vocabulary has no event type for a read. Adding one is your reviewed change (`AU-12c`, `AU-13`) | **The audit-log read surface is not built.** It would break `AU-25`. | Add an event type for reading the log, for example `Audit.Read` (a proposal, not in `AU-12`) |
