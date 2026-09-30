# SmartStore — Employee Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Employee`, `UserAccount`, `EmployeeStoreAccess`, `EmployeeRoleAssignment`, `Shift`,
`AttendanceEvent`, `AttendanceException`, `LeaveRequest`. Access rules and role templates are in
[actors-and-roles.md](actors-and-roles.md); the RFID identity signal is in
[rfid-domain.md](rfid-domain.md); cash shifts are in [cash-management.md](cash-management.md).

---

## 1. Employee and login are different things

> **An `Employee` is a person. A `UserAccount` is a login credential, and it is optional.**

**Rule EM-01.** Every employee may exist without a login. A warehouse picker, a seasonal helper, a cleaner, and
a
full-time store manager are all employees; only some of them need to sign in. A system that makes a login a
prerequisite for employing someone cannot represent its own workforce, and it ends up with a shared "store" login
— at which point the audit trail records an account name instead of a person (BI-23).

**Rule EM-02 — no shared accounts, ever.** A login belongs to exactly one employee. This is stated as a rule
because it is the single most common way an audit trail is destroyed in retail software, and because the exception
request is always reasonable-sounding.

**Rule EM-03 — self-service access is structural, not filtered** (EM-15 in actors-and-roles). Self-service
endpoints take no employee id; the actor is the session. A cashier cannot query a colleague by changing an id,
because there is no id to change.

**Rule EM-04 — an employee's password is never visible to anyone**, including an administrator. `Password.Reset`
sets a new credential; it never reveals the current one. A stored hash that can be displayed was never hashed
properly.

---

## 2. Employee record

`Employee` holds: employee number (unique per organization), first/last name, preferred name, contact details
(phone, email), **date of birth** (needed for payroll-adjacent checks and age-restricted sales), start date,
employment type, home store, department, position, and status.

**Rule EM-05 — no sensitive personal data in v1.** No medical, no disability, no bank details, no national
identity number, no photograph of a document, no background-check results. Attendance and leave are the only
non-operational personal data, and both are needed to do the job. This is a deliberate scope boundary: every
field a person did not expect to be asked for is a privacy obligation, and none of them is required to run a store.

**Rule EM-06 — `Department` and `Position` are descriptive and drive nothing security-relevant.** A permission is
granted by a `Role` (AC-01), never inferred from a job title. A "Manager" position with no role assignment has no
permissions, and that is correct: the person who assigns roles is the person who grants access.

**Rule EM-07 — date of birth is used for one thing: age-restricted sales.** It is compared at the till, the
comparison result is recorded on the sale, and the value is not otherwise exposed at the till. Recording a
pass/fail is better than showing a birth date on a POS screen.

---

## 3. Status lifecycle

| Status | Meaning | Can sign in | Can transact |
|---|---|---|---|
| `Active` | Employed | Yes | Yes |
| `OnLeave` | Currently on approved leave | Yes, read-only | No |
| `Suspended` | Temporarily barred — investigation, disciplinary, medical | **Blocked at authentication** | No |
| `Terminated` | Employment ended | Blocked | No |
| `Archived` | Historical only | No | No |

**Rule EM-08 — `Terminated` is irreversible and is the only employee operation that is.** There is no "un-terminate".
Re-hiring is a **new** employee record, and the new record's history is its own. This is deliberate: an employee
record that can go backwards in time produces attendance and audit records that belong to two employment periods
and cannot be reconciled.

**Rule EM-09 — suspension is for access, not for employment.** `Suspended` is the fastest way to stop someone
doing something without deleting anything, and it is a security control, not a judgement.

**Rule EM-10 — termination requires `Employee.Terminate`, is audited, and is blocked while the employee has an
open shift** (BI-39, CD-01). Terminating someone at 21:00 on a busy Friday with an open drawer leaves an
unreconciled drawer attached to a person who can no longer be asked about it.

**Rule EM-11 — a terminated employee's documents are immutable.** Their sales, their adjustments, and their audit
entries stay exactly as recorded (BI-08, BI-23). A terminated employee remains answerable for what they did while
they worked; that is the entire point of the audit trail.

---

## 4. Store access

**Rule EM-12.** `EmployeeStoreAccess` holds employee, store, and scope, with optional from/to dates. An employee
may have access to several stores; v1 defaults to one.

**Rule EM-13 — the permitted store set is `EmployeeStoreAccess × EmployeeRoleAssignment`** (MS-01). Access to a
store and a role *in* that store are separate facts, and holding a role without store access grants nothing — the
data-access layer takes the intersection (BI-14).

**Rule EM-14 — granting store access is a high-value permission** (EM-16 in actors-and-roles). The HR Manager
*requests*; the Organization Owner *approves* and grants `Employee.StoreAccess.Grant`. It is the highest-value
access grant in the product, because store scope is what stops Store A's manager reading Store B's data (BI-43),
and those stores may be competitors.

**Rule EM-15 — revoking access is immediate at the next request, within the permission cache window**
(PC-04). A revocation writes an audit entry with the exact before/after scope, and PC-05's "revoke everything
now" exists for the case where a minute is too long.

**Rule EM-16 — access may be revoked while the employee is signed in**, and the session is not preserved with the
old scope. A revocation that waits for logout is a revocation that does not happen.

---

## 5. Rostered shifts

`Shift` here is the **rostered working period**: employee, store, planned start and end, position, and
`ShiftStatus` (`Draft`, `Published`, `Acknowledged`, `Cancelled`).

**Rule EM-17 — a rostered shift is not a cash shift.** They are different entities with confusingly similar names,
and the spec keeps them apart deliberately. The cash `Shift` (drawer opening/closing, float, variance) is owned by
[cash-management.md](cash-management.md) and has the one-open-shift-per-drawer constraint (BI-39). A rostered
shift here schedules *people* and has no drawer, no float, and no money. The UI uses different words for each:
**"Rostered shift"** and **"Till shift"**.

**Rule EM-18 — a published roster is a commitment; a draft is a plan.** Editing a published shift is audited and
notified to the employee. Staff plan their lives around a published roster, so silently changing it is a real harm,
not a data-quality nicety.

**Rule EM-19 — no scheduling optimisation in v1** (overview §6). No auto-scheduling, no demand forecasting, no
shift-swap workflow, no availability self-service. The entity exists, the publish/draft distinction exists, and the
optimisation is a different product.

**Rule EM-20 — no payroll.** Hours worked, overtime, and rates are all out of scope (overview §6). Attendance and
rosters exist to answer *who was here*, which is an operational and security question, not a pay question.

---

## 6. Attendance

`AttendanceEvent` holds: employee, store, type (`In`, `Out`, `BreakStart`, `BreakEnd`), the **source**
(`Rfid`, `Manual`, `Terminal`, `System`), the observation timestamp, the reader or terminal that produced it, and
a pairing reference to the open attendance period.

**Rule EM-21 — attendance is an event log, not a state.** `In`, `Out`, `BreakStart`, `BreakEnd` are events; the
current presence is derived. A mutable "currently present" flag on the employee is the alternative design and it
cannot represent two people clocking in twice, or a missed punch.

**Rule EM-22 — an unpaired punch is an `AttendanceException`, not a rejected event** (EM-02 in the overview's
entity table). A clock-out with no clock-in is a real event and is recorded. Discarding it loses information;
accepting it silently loses more. The exception is what a manager works through.

**Rule EM-23 — an RFID read at a clock reader produces an attendance event, and nothing else** (BI-33). A tag
read creates an event; it does not grant anything. A tag read at a till door does not open a session unless the
session flow explicitly asks for one (rfid-domain §4).

**Rule EM-24 — manual attendance correction requires `Attendance.Correct` and a reason, and approval by a
different person** (BI-25, BI-26, SEP-01). This is the only hard-blocked action-level separation in the access
model, because attendance is the record a staff member disputes about their pay and their hours, and self-approval
would make the record worthless.

**Rule EM-25 — corrections are compensating events, never edits** (BI-08 shape). The original punch stands; the
correction references it.

**Rule EM-26 — the attendance record is visible to the employee for their own attendance** (EM-15 in
actors-and-roles). A record a person cannot see is a record they cannot check. A **reason** on a correction is
visible to the employee; the internal approval discussion is not, and that separation is deliberate.

**Rule EM-27 — attendance is not a performance score.** Attendance data feeds no scoring, no ranking, and no
automatic sanction in v1. The data is there, and the temptation to use it as a productivity metric is exactly why
the access boundary (EM-15 in actors §3.13: HR sees attendance, not transaction detail) is drawn where it is.

---

## 7. Leave

`LeaveRequest` is a **SHOULD in v1**, and the scope is deliberately narrow.

**Rule EM-28.** A leave request holds employee, type, from, to, reason (optional, free text), status
(`Draft`, `Pending`, `Approved`, `Rejected`, `Cancelled`), approver, and a decision note. It carries **no** pay
calculation, no entitlement balance, and no accrual. Those are payroll, and payroll is out of scope (overview §6,
EM-20).

**Rule EM-29 — a requester cannot approve their own leave** (BI-26).

**Rule EM-30 — approved leave has two real effects**, and only two: the employee is `OnLeave` (EM-01's status,
which is read-only), and a rostered shift overlapping it is flagged for the manager. Both are operational. Neither
is a payroll event.

**Rule EM-31 — leave requests are HR-and-manager data, and the separation is enforced.** An employee's leave detail
is not visible to a cashier or an accountant (actors-and-roles §3.11, §3.13). Leave is personal; the store's
operational need is "is this person working", which the roster and the status answer.

---

## 8. Attendance and payroll are not the same thing

The single most common scope failure in retail software is drifting from "who was here" into "how much were they
paid". The boundary is:

| Question | In scope | Source |
|---|---|---|
| Was this person present at 14:00? | **Yes** | `AttendanceEvent` |
| Which shift did they work? | **Yes** | Rostered + actual |
| Did they clock in outside their shift? | **Yes**, as a fact | `AttendanceException` |
| How many hours did they work? | **Yes**, as a fact | Derived from events |
| How much were they paid? | **No** | Payroll |
| What is their holiday entitlement? | **No** | Payroll |
| What is their overtime rate? | **No** | Payroll |

**Rule EM-32.** Total hours worked is a **derived fact** and is reportable. What it is *worth* is not in the system.
The line between these two is the line between a retail platform and an HR product, and it is drawn here, once.

---

## 9. Employee rules index

| ID | Rule |
|---|---|
| EM-01 | An employee need not have a login; a `UserAccount` is optional |
| EM-02 | No shared accounts, ever |
| EM-03 | Self-service access is structural: no employee id in the request |
| EM-04 | A password is never visible, including to an administrator |
| EM-05 | No sensitive personal data in v1: no medical, bank, national id, or check results |
| EM-06 | `Department` and `Position` are descriptive and grant nothing |
| EM-07 | Date of birth serves age-restricted sales; a pass/fail is recorded, not the value displayed |
| EM-08 | `Terminated` is irreversible; re-hiring is a new record |
| EM-09 | `Suspended` is an access control, not an employment status |
| EM-10 | Termination needs `Employee.Terminate`, is audited, and is blocked with an open till shift |
| EM-11 | A terminated employee's documents stay exactly as recorded |
| EM-12 | Store access is a separate entity with optional date bounds |
| EM-13 | The permitted store set is the intersection of store access and role assignment |
| EM-14 | Granting store access is Owner-approved; it is the highest-value access grant |
| EM-15 | Revocation is effective at the next request, within the cache window |
| EM-16 | Revoking access does not preserve a session with the old scope |
| EM-17 | A rostered shift is not a cash shift; the UI uses different words |
| EM-18 | A published roster is a commitment; editing it is audited and notified |
| EM-19 | No scheduling optimisation, forecasting, or shift-swap workflow in v1 |
| EM-20 | No payroll, rates, overtime, or entitlement calculation |
| EM-21 | Attendance is an append-only event log; presence is derived |
| EM-22 | An unpaired punch is an exception record, never a rejected event |
| EM-23 | An RFID read at a clock reader produces an event and nothing else |
| EM-24 | Manual attendance correction needs permission, a reason, and a different approver |
| EM-25 | Corrections are compensating events, never edits |
| EM-26 | An employee can see their own attendance and the reasons for corrections |
| EM-27 | Attendance feeds no score, ranking, or automatic sanction |
| EM-28 | Leave is a request with a status; no pay, entitlement, or accrual |
| EM-29 | A requester cannot approve their own leave |
| EM-30 | Approved leave affects only employee status and roster flags |
| EM-31 | Leave detail is HR and manager data, enforced at the access boundary |
| EM-32 | Hours worked is a derived fact; what they are paid is out of scope |
