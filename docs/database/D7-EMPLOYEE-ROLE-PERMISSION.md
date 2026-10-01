# Domain 7 — Employee / Role / Permission

**Phase 3 — database design.** Migration: `db/migrations/20261001110000_d7_employee_role_permission.sql`. Conventions:
[CONVENTIONS.md](CONVENTIONS.md). Previous: [D6](D6-AUDIT.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | The migration: employees and their machine, logins and sessions, the permission catalogue, roles, grants, assignments, store access, the permission each transition needs, every actor foreign key, and audit redaction |
| **TESTED** | `server/test/d7-employee.test.ts` (20 tests) plus the schema-wide suites; 273 passing |
| **Not built** | §8, and all application code, above all the one authorization gate and sign-in |

Sources: [employee-domain.md](../product/employee-domain.md) (`EM-*`), [actors-and-roles.md](../product/actors-and-roles.md)
(`AC-*`, `SEP-*`, `PC-*`, the permission catalogue §2 and the templates §4),
[multi-store-domain.md](../product/multi-store-domain.md) (`MS-03`, `MS-11`, `MS-12`), `state-machines.md` §10, §22.0,
§22.9, owner decision `D-01`, architecture §7 and §8, requirements `RT-002`, `RT-009`, `RT-020`, `RT-293`, `RT-295`.

---

## 1. What the database holds, and what it leaves to the gate

Architecture §8.2 puts **one** authorization gate in the application: every request passes it, and it refuses
whenever it cannot decide. §8.1 asks for "explicit, database-backed, named roles with grants". This domain is that
data, plus the rules that are properties of the data itself:

- **What the database holds.** Employees, logins and sessions; the closed permission catalogue; roles and their
  grants; role assignments and store access, each kept as history; the permission each transition needs; and
  `employee_holds_permission()`, the one definition of "this grant set allows this key in this store".
- **What the gate does per request, never skipped** (architecture §7.5, §8.2): the employee's status, the session,
  the permission check through that function, the transition's permission from the table, and binding a document's
  `*_by` columns to the signed-in employee.

## 2. Tables

| Table | Scope | Purpose | Key rules |
|---|---|---|---|
| `employee` | organization | A person the organization employs, with or without a login (`EM-01`). Number unique per organization; descriptive home store, department and position that grant nothing (`EM-06`); the Employee machine. **Never deleted**: documents name employees, and a terminated employee stays answerable (`EM-11`) | `EM-01`..`EM-11` |
| `user_account` | organization | A login, optional, exactly one employee's (`EM-02`). Username unique in the organization whatever its case. **Only an Argon2id hash, or bcrypt of cost 12 or more, is accepted**; a plain password is refused (`EM-04`, architecture §7.3) | `EM-02`, `EM-04` |
| `user_session` | organization | A server-held session (architecture §7.1). Only the SHA-256 of its opaque token is kept, so a copy of the database cannot be replayed as a login. Optionally the till it is at. Ended once, with its cause (`Logout`, `Expired`, `Revoked`, `Rotated`: `AU-12a`), and kept | `ADR-12`, `EM-16` |
| `permission` | reference | The catalogue of actors-and-roles §2: **117 keys**, matched only for equality (`AC-02`). Wildcards are not keys | `AC-02`, `D-01` |
| `role` | organization | A named permission set; custom roles permitted, no nesting. Archived, never deleted | `AC-01`, `AC-04` |
| `role_permission` | organization | One key granted to one role. Revoking records who and when and keeps the row, so a role's permission set at any moment can be rebuilt (`PC-01`) | `AC-02`, `PC-01` |
| `employee_role_assignment` | exception: organization, optional store | A role held organization-wide or in one store (`MS-11`); removed by a recorded revocation | `MS-11`, `MS-12`, `RT-020` |
| `employee_store_access` | store | Access to one store, with optional dates (`EM-12`); revoked by a recorded fact | `EM-12`..`EM-15` |
| `audit_redacted_field` | reference | The personal fields that audit events redact at write time (`AU-09`): an employee's names, email and phone | `AU-09`, `RT-295` |

`state_machine_state` and `state_machine_edge` gain the **permission each creation and edge needs**
(architecture §8.4: "the mapping from transition name to required permission is a single table, and that table is
exactly the §22 Permission column"). An entry is a catalogue key (`Key`), `System` (a provider, telemetry, a derived
state), or `OpenDecision`: the gate refuses it until the owner names a key (`SM-02d`).

## 3. `employee_holds_permission(employee, store, key)`

True only if all of these hold:

- a live assignment,
- of a live, unarchived role,
- which holds the exact key, unrevoked,
- is organization-wide or in that store,
- and the employee has live, in-window access to that store.

Holding a role without store access grants nothing (`EM-13`). An organization-wide role broadens the stores and
bypasses nothing (`MS-12`). An organization-level action, with no store, needs an organization-wide assignment
(OQ-025). No match means no permission (`AC-01`). The function evaluates grants only; the employee's status is the
gate's per-request check (architecture §7.5), since `OnLeave` may still sign in read-only (`EM-09` table).

## 4. The Employee machine (§22.9)

| From → To | Event | Permission | Audit | Reason |
|---|---|---|---|---|
| creation → `Active` | create | `Employee.Create` | `Employee.StateChange` | — |
| `Active` → `OnLeave` | leave | `Employee.Edit` | `Employee.StateChange` | yes |
| `OnLeave` → `Active` | reactivate | **OPEN DECISION** | `Employee.StateChange` | — |
| `Active` → `Suspended` | suspend | `Employee.Edit` | none: the application records `Security.SessionEnded` per revoked session | — |
| `Suspended` → `Active` | reactivate | **OPEN DECISION** | `Employee.StateChange` | yes (`SM-50`) |
| `Active`/`OnLeave` → `Terminated` | terminate | `Employee.Terminate` | `Employee.Terminate` | — |
| `Terminated` → `Archived` | archive | `Employee.Edit` | `Employee.StateChange` | yes |

The two returns to `Active` come from the contract's Reversal column, which names neither a permission nor an event.
"reactivate" is `SM-50`'s word for one of them. Termination is refused while the employee has a till shift that is
not closed (`EM-10`, `SS057`). Nothing leaves `Terminated` except archiving (`EM-08`); a re-hire is a new record. The
§10 diagram's `Suspended → Terminated` and `Active → Archived` are not contracted, so they refuse (OQ-025).

## 5. Who did it, and redaction

- **Actor columns.** Every `*_by` column in the schema, and `sale.employee_id`, now references `employee`. The
  migration adds them all from the catalog, so none can be missed, and a schema test asserts that none lacks one.
  Employees are never deleted, so the references hold for ever.
- **`audit_event.actor_id`.** It is the authenticated principal and deliberately does not reference `employee`. A
  job or a provider callback acts as a system principal, the first employee of an organization is created before
  anyone exists to create them, and a failed sign-in has no actor at all.
- **Personal data (`AU-09`, `CU-35`).** An employee's names, email and phone are redacted in every audit event at
  write time. The event shows that such a field was set or changed, never its value, and a direct read of the
  audit table finds none. Other personal data adds rows to `audit_redacted_field`.
- **Role assignments.** Every assignment and every removal records `Security.Role.Assign` (`RT-020`). That type is
  now the database's, so the application cannot record one for an assignment that did not happen (`SS056`).
- **Store access and role definitions.** Grants, revocations and role changes have no event type in the closed
  vocabulary (OQ-025). Their history lives in the rows themselves: nothing is deleted, and every revocation is a
  recorded fact.

## 6. Error codes

| Code | Meaning |
|---|---|
| `SS057` | The employee has a till shift that is not closed, so cannot be terminated |

Reused: `SS001` (a revocation or a session's end is written once), `SS004`, `SS055` (a reason where the contract needs
one), `SS056`.

## 7. Tests — what proves what

| Rule | Proven by (`d7-employee.test.ts`) |
|---|---|
| `EM-01`, `EM-02`, `SM-48a` | Created `Active`; a login is optional and exactly one employee's, in their organization |
| `EM-05` | Employee numbers unique per organization |
| §22.9, `SM-50`, `EM-08` | Every contracted edge with its reasons; nothing out of `Terminated` but `Archived`; `Archived` terminal; the diagram-only edges refuse |
| `EM-10` | Termination refused with an open till shift |
| `D-06` | Each transition records its event and reason; a suspension records none of its own |
| `AU-09`, `RT-295` | Names and contacts redacted at write time; an absent field stays null; nothing personal in the table |
| `EM-04`, `ADR-12` | A plain password, low-cost bcrypt and Argon2i are refused; Argon2id and bcrypt 12 are accepted; a change is stamped |
| `EM-02` | Usernames unique per organization whatever their case |
| `ADR-12`, `AU-12a`, `EM-16` | A session keeps a 32-byte token hash, once; cannot start expired; is at a till of its organization; ends once with a known cause; is never deleted |
| `AC-02`, `D-01`, `RT-009` | Exactly 117 catalogue keys; a wildcard, or a template name missing from the catalogue, cannot be granted |
| `AC-01`, `EM-13` | No assignment, or an assignment without store access, grants nothing |
| `AC-02` | No prefix, extension or case variant of a key matches |
| `MS-11`, `MS-12` | A store assignment only in its store; an organization-wide one in every store with access, and none without |
| OQ-025 | An organization-level action needs an organization-wide assignment |
| `EM-12`, `EM-15`, `PC-01`, `BI-40` | Revoked keys, revoked access, closed and future windows, archived roles and revoked assignments grant nothing; revoked once; nothing deleted |
| `AC-02`, `MS-11` | One live grant per key, assignment per scope (organization-wide included) and access per store |
| `RT-020`, `AU-03` | Assignment and removal each record `Security.Role.Assign`; the application cannot forge one |
| §22, `SM-02d`, `D-01` | Every creation and edge of the nine built machines names its contracted key, `System` or `OpenDecision` |
| `BI-23`, `EM-11` | A document naming no employee is refused; schema-wide, no actor column lacks its key |

**Mutation check (2026-10-01).** 41 mutations, each removing or weakening one guard, were applied one at a time, and
the migration still applied every time. All 41 turned tests red:

- the Employee machine, its events and the open-shift refusal;
- redaction, and an absent personal field staying null;
- the hash rule and bcrypt cost, one login per employee, the case-blind username, the login's organization and the
  password-change stamp;
- each session rule: the token hash, expiry after start, the end causes, ending once, the end stamp, and a till of its
  organization;
- the catalogue key and the unique employee number;
- each of the ten conditions of `employee_holds_permission`;
- revoking once, and the four live-uniqueness indexes;
- the assignment event and its database origin;
- the actor keys and the sale's employee;
- three samples of the permission mapping, one of them a reason.

The first run turned 38 red:

- **The revoked-assignment condition survived.** The one test that revoked an assignment did so after the
  employee's store access had already gone, so its result never depended on the revocation. A test now revokes an
  assignment and nothing else.
- **Two runs were inconclusive.** They failed before any test, while dropping the test template.
  - The cause: autovacuum visits the freshly seeded template, and `DROP DATABASE … WITH (FORCE)` run by a role that
    is not a superuser cannot end an autovacuum worker (`42501`).
  - The fix: the harness's drops are now plain `DROP DATABASE`, which stops autovacuum by itself.
  - The proof: a probe that waited for a worker inside a database reproduced `42501` with `FORCE`, and dropped the
    database in 251 ms without it.

## 8. Decisions, open questions, and what is not built

- **OQ-025** (new): the permission-less reversal edges (employee reactivation, till re-enable, refund retry); the
  diagram-only edges; a suspension with no session and so no event; store access and role changes having no event
  type; the templates' notation; organization-level actions; usernames. **The owner must name keys before an
  employee can be reactivated, a disabled till re-enabled, or a failed refund retried.**
- **Moved to the gate (CONVENTIONS §12):** binding `*_by` to the signed-in employee (`AU-05`, `BI-33`) belongs to the
  one enforcement point (architecture §8.2), which sets both the audit context and the document's actor from the
  same session.
- **Not built:**
  - The role templates as data (§4, OQ-025).
  - Date of birth, whose one use, age-restricted sales, is outside v1 (`EM-07`).
  - Login throttling (`SM-49`, `RF-19`).
  - The access review and segregation-of-duties report (`REVIEW-01`, §2.13, `MS-14`).
  - Rostered shifts, attendance and leave (`EM-17`..`EM-32`), which are outside the slice.
  - RFID credentials (`RF-*`), deferred with devices.
