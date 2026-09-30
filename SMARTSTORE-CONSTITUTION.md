# SMARTSTORE PROJECT CONSTITUTION

**The highest-level operational contract for every AI agent, developer, coding session,
reviewer, and implementation phase working on SmartStore.**

This is the project constitution. It governs how SmartStore is specified, designed,
implemented, tested, verified, and changed. It applies to every AI tool (including
OpenCode now and Claude Code later) and to every human contributor.

This document is **not** an implementation artifact. It creates no application code, no
database schema, no migration, and no framework selection. It governs the work instead of
performing it.

Status of this document: **APPROVED — authoritative.** Versioned per §32 ("Constitution
Change Rule").

---

## 1. PURPOSE

The constitution is the master operational contract for SmartStore. It defines:

- **what SmartStore is** — the retail operating platform being built clean from Phase 0;
- **what we are trying to build** — a long-term, production-grade platform, phase by phase;
- **what quality level is expected** — production quality, not demo quality (§22);
- **what must never be done** — invent requirements, fabricate evidence, weaken MUST
  requirements, silently choose owner decisions, claim untested behavior works (§3–§8);
- **how requirements are interpreted** — requirements and invariants are authoritative;
  the UI, database, and APIs must reflect them, never override them (§8, §14, §15, §16);
- **how uncertainty is handled** — mark it, never fill it (§3, §5);
- **how evidence is verified** — every factual claim carries a source; unverifiable claims
  are marked UNVERIFIED (§4);
- **how changes are proposed** — through the change-management rule (§20), never silently;
- **how implementation phases are controlled** — phase discipline, no jumping and no
  silent redefinition (§6);
- **how security, inventory, financial correctness, and auditability are protected** —
  as non-negotiable invariants (§9–§12);
- **how future AI agents must behave** — the AI workflow (§26) and the final principle
  (§33).

---

## 2. SOURCE OF TRUTH HIERARCHY

This precedence applies **unless a later approved project decision explicitly changes it**:

1. SMARTSTORE-CONSTITUTION.md *(this document)*
2. Owner-approved decisions — OWNER-DECISIONS.md
3. Current approved phase specifications
4. Domain/business invariants
5. Architecture decisions
6. Requirements traceability
7. Supporting analysis/research
8. Repository reconnaissance
9. AI-generated suggestions

**AI-generated suggestions are NOT facts.** A previous AI statement does not become true
merely because it exists in a document. Never treat generated prose as evidence.

Lower-order sources must not silently override higher-order sources. A conflict between
levels is a problem to be surfaced and resolved, not patched (§27).

---

## 3. ANTI-HALLUCINATION RULE

**NEVER INVENT.**

If information is not supported by:

- an existing requirement,
- an existing business invariant,
- an approved architecture decision,
- an owner decision,
- verified source code / evidence,
- an explicitly documented assumption,

then it must be marked:

- `UNKNOWN`
- `OPEN DECISION`
- `OPEN SPECIFICATION`
- `MISSING DEPENDENCY`
- `UNVERIFIED`

Do not silently fill gaps using general software-development knowledge. Do not convert an
assumption into a requirement. Do not convert a likely behavior into a confirmed behavior.
Do not convert a common industry practice into a SmartStore rule.

---

## 4. EVIDENCE RULE

Whenever an AI makes a factual claim about SmartStore, it must **identify the source when
practical**. Prefer:

- Document
- Section
- Requirement ID
- Rule ID
- Decision ID
- Architecture decision
- Verified source evidence

Examples of such identifiers used across SmartStore documents: `PR-47`, `IV-46`, `SM-02d`,
`D-04`, `GATE-OFFLINE-INVENTORY`.

If the source cannot be reproduced, the claim must **not** be presented as verified. Mark
it:

- `UNVERIFIED`

---

## 5. NO FALSE CERTAINTY

AI agents must never say "this is already implemented" unless implementation evidence
exists. Similarly, never say "the database supports…", "the API guarantees…", "the
frontend handles…", or "the system prevents…" unless the implementation has actually been
inspected or tested.

Distinguish these states — they are **different**:

- `SPECIFIED`
- `DESIGNED`
- `IMPLEMENTED`
- `TESTED`
- `VERIFIED`

Always state which state applies. Never blur the boundary.

---

## 6. PHASE DISCIPLINE

SmartStore development is phase-controlled. An AI must not automatically jump to another
phase.

- **Phase 0** — Repository analysis / evidence
- **Phase 1** — Product and domain specification
- **Phase 2** — Architecture
- **Phase 3** — Database / schema design
- **Phase 4** — UI/UX system
- **Later phases** — Implementation, integration, testing, deployment, hardening,
  operations, etc.

A later phase must **not silently redefine an earlier approved phase**. If a later phase
discovers a contradiction:

1. **STOP.**
2. **Document it.**
3. **Trace it back.**
4. **Request or record the required decision.**

Do not silently patch the specification.

---

## 7. OWNER DECISIONS

Only the project owner can make owner-level product decisions.

The AI may:

- identify decisions,
- explain options,
- explain consequences,
- identify dependencies,
- recommend what must be decided.

The AI must **NOT** silently choose an owner decision.

Owner decisions are recorded in **OWNER-DECISIONS.md**. If an owner decision is
unresolved, it is marked:

- `OPEN DECISION`

Do not code around an unresolved owner decision by inventing a default.

---

## 8. REQUIREMENT INTEGRITY

Never remove, weaken, rewrite, or reinterpret a MUST requirement merely to make
implementation easier. Never change requirements simply to:

- reduce blockers,
- improve statistics,
- reduce complexity,
- make architecture easier,
- make a test pass,
- make a database schema cleaner,
- make an AI-generated report look better.

If a requirement is wrong or contradictory, **identify it explicitly**, then resolve it
through the appropriate decision process (§20, §27). Do not weaken it because it is
difficult (§33).

---

## 9. BUSINESS INVARIANTS

Business invariants are **stronger than implementation convenience**. Inventory
correctness, financial correctness, authorization, auditability, and transaction integrity
must not be sacrificed merely because an implementation is difficult.

Examples of SmartStore invariants (the approved invariant documents remain authoritative):

- no stock creation without a legitimate source;
- no stock destruction without a legitimate reason;
- no over-return;
- no over-refund;
- no duplicate transaction application;
- no unauthorized inventory mutation;
- no unauthorized store access;
- no silent modification of finalized financial records;
- no silent deletion of inventory movements;
- audit records must be protected;
- offline synchronization must be idempotent;
- financial totals must be deterministic.

Do **not** invent additional invariants and call them approved.

---

## 10. SECURITY PRINCIPLES

Security is not an optional feature. At minimum:

- authentication is not authorization;
- RFID is not authorization;
- permissions must be enforced server-side;
- store/warehouse scope must be enforced server-side;
- sensitive operations require explicit authorization;
- destructive operations must be controlled;
- audit-sensitive operations must be traceable;
- tokens/sessions must have explicit lifecycle behavior;
- offline operations must not bypass authorization;
- synchronization must not bypass business invariants;
- user-controlled identifiers must not automatically become trusted infrastructure
  destinations;
- secrets must never be hardcoded into production code.

Never claim a security property without evidence (§4, §5).

---

## 11. INVENTORY AND FINANCIAL INTEGRITY

Inventory and financial domains are high-risk domains. AI agents must treat as
correctness-critical:

- stock,
- payments,
- refunds,
- returns,
- customer credit,
- supplier balances,
- cash drawers,
- inventory movements,
- synchronization.

Never implement a shortcut that can silently create stock, money, credit, payment, refund,
supplier liability, or customer liability without an explicitly defined business event.

---

## 12. AUDITABILITY

Important business operations must remain traceable.

- Do not design systems where important state changes can occur without an appropriate
  audit trail.
- Do not make auditability dependent on frontend behavior.
- Server-side business operations must enforce the required audit rules.
- Do not assume logging equals auditing. Application logs, security logs, and business
  audit records are different concepts unless the specifications explicitly combine them.

---

## 13. STATE MACHINES

State machines are authoritative for lifecycle behavior. A transition must not be
implemented merely because two states exist.

A transition requires, where applicable:

- source state,
- destination state,
- actor,
- permission,
- preconditions,
- side effects,
- audit requirement,
- reversal / cancellation behavior.

If any required transition behavior is unresolved, mark it:

- `OPEN DECISION`

Do not invent it.

---

## 14. DATABASE DESIGN RULE

The database must represent the approved domain. Do not design the domain around whichever
schema is easiest to code.

Do not:

- duplicate sources of truth unnecessarily;
- use manually editable quantities as the sole inventory truth;
- store money using unsafe floating-point representations;
- silently discard historical financial/inventory records;
- create tables merely because a UI screen needs them;
- create columns for hypothetical future features without justification.

Phase 3 must derive from the approved domain and architecture.

---

## 15. API / BACKEND RULE

Backend APIs must enforce business rules. Never rely exclusively on:

- frontend validation,
- hidden UI controls,
- client-side permissions,
- disabled buttons,
- trusted device input.

If a business rule matters, enforce it at the appropriate server-side boundary.

---

## 16. FRONTEND / UI RULE

The UI is not the source of truth. The UI must reflect approved domain behavior.

- Do not create screens merely because they are common in POS software.
- Every major UI workflow should correspond to an approved requirement or domain workflow.
- The UI must communicate permissions, errors, validation, transaction state,
  synchronization state, offline state, and approval state **without misleading the user**.

Detailed UI/UX belongs to the appropriate phase (Phase 4).

---

## 17. OFFLINE-FIRST RULE

Offline behavior must never be invented during implementation. Before implementing offline
workflows, explicitly know:

- what can operate offline;
- what cannot;
- what data is cached;
- how transactions are identified;
- how idempotency works;
- how synchronization works;
- who owns conflicting stock;
- how conflicts are resolved;
- what remains server-authoritative.

If any of these is unresolved: **STOP** and mark `OPEN DECISION`.

---

## 18. HARDWARE ABSTRACTION

Hardware must not leak directly into business logic. RFID readers, barcode scanners,
printers, weighing scales, cash drawers, ESP32 devices, and future devices should be
accessed through appropriate abstractions.

Do not lock SmartStore unnecessarily to a single manufacturer. Actual hardware decisions
belong to the approved hardware requirements and owner decisions.

---

## 19. TESTING RULE

A requirement is not considered implemented merely because code exists. Use the
distinction:

`Specified → Implemented → Tested → Verified`

Important business invariants require automated and/or integration tests where
appropriate. Never claim test success without actually running the relevant tests. Never
fabricate test results.

---

## 20. CHANGE MANAGEMENT

Any meaningful change must identify:

- what changed;
- why;
- source / evidence;
- affected requirements;
- affected domains;
- affected architecture;
- affected database design;
- affected security;
- affected tests;
- whether owner approval is required.

If a change affects an approved MUST requirement or owner decision: **STOP before
implementation** and resolve it through the appropriate decision process.

---

## 21. SMALL BUGS MATTER

The project must account for the small and the ordinary, not only major features:

- validation errors,
- loading states,
- empty states,
- duplicate actions,
- race conditions,
- retry behavior,
- timeouts,
- partial failures,
- network loss,
- printer failure,
- scanner failure,
- device disconnection,
- stale data,
- timezone handling,
- rounding,
- decimal precision,
- localization,
- accessibility,
- keyboard workflows,
- audit metadata,
- error recovery,
- import failures,
- export failures,
- backup failures,
- synchronization failures.

If a small issue affects correctness, security, usability, or operational reliability, it
matters.

---

## 22. PRODUCTION QUALITY

SmartStore is intended to become a real production product. Do not optimize for demo
appearance, hackathon shortcuts, fake completeness, superficial feature count, "works on
my machine", or passing tests through weakened requirements.

Optimize for:

- correctness,
- security,
- maintainability,
- observability,
- recoverability,
- auditability,
- usability,
- testability,
- operational reliability.

---

## 23. SCOPE

SmartStore is primarily a retail operating platform. Do not turn it into an ERP without
explicit approval. Avoid silently adding:

- full payroll,
- manufacturing,
- full accounting ERP,
- project management,
- advanced CRM,
- unrelated enterprise modules.

Features not required by the approved retail domain must be marked `OUT OF SCOPE` or
`FUTURE`.

---

## 24. REUSE OF OLD REPOSITORIES

Phase 0 concluded that SmartStore is being built clean. Existing repositories may provide
evidence, design lessons, domain ideas, implementation lessons, and security lessons. They
are **NOT automatically implementation templates**.

- Do not copy old vulnerabilities.
- Do not assume old repository behavior is correct.
- Do not import old code simply because it exists.

---

## 25. LICENSE / LEGAL

Do not make legal conclusions unless supported by qualified legal input or authoritative
evidence.

Do not claim that code can legally be reused merely because it is publicly available. The
approved license analysis and owner/legal decision remain authoritative.

---

## 26. AI WORKFLOW

Before doing significant work:

1. Read the constitution.
2. Identify the current phase.
3. Read the relevant specification.
4. Identify relevant requirements and invariants.
5. Check for unresolved decisions.
6. Check architecture constraints.
7. Implement only what is authorized.
8. Test the result.
9. Report evidence.
10. Update documentation where required.

Never rely solely on conversation history when authoritative project documents exist.

---

## 27. WHEN YOU DISCOVER A PROBLEM

Do **NOT** hide it. Do **NOT** silently fix it if it changes the specification.

Classify it appropriately:

- `CONFIRMED`
- `REFUTED`
- `UNCONFIRMED`
- `OPEN DECISION`
- `OPEN SPECIFICATION`
- `MISSING DEPENDENCY`
- `OUT OF SCOPE`
- `BLOCKER`
- `NON-BLOCKING`
- `UNKNOWN`

Explain the evidence, impact, affected requirements, affected phase, and recommended next
action.

---

## 28. ANTI-STATISTICS-GAMING RULE

Project metrics are informational. Never modify requirements, classifications, severity,
or documentation just to improve coverage percentage, the number of confirmed rules, the
number of resolved issues, the number of passing tests, the number of completed features,
or the number of documents.

**Correctness always wins over metrics.**

---

## 29. COMPLETENESS RULE

When reviewing a phase, do not ask only "What features are missing?" Also inspect:

- edge cases,
- failure modes,
- security,
- concurrency,
- authorization,
- auditability,
- observability,
- backups,
- recovery,
- migrations,
- imports,
- exports,
- configuration,
- retention,
- deletion,
- localization,
- tax,
- currency,
- rounding,
- hardware failure,
- offline behavior,
- synchronization,
- permissions,
- testing,
- deployment,
- monitoring,
- supportability,
- accessibility.

**A feature is not complete if its failure behavior is undefined.**

---

## 30. FUTURE CLAUDE CODE HANDOFF

When Claude Code begins implementation, it must treat this constitution as mandatory
project governance. Claude Code must not:

- skip phases;
- invent missing requirements;
- silently choose owner decisions;
- rewrite requirements for convenience;
- claim untested behavior works;
- use old repositories as unquestioned source code;
- implement unresolved architecture decisions;
- fabricate test results;
- fabricate security guarantees.

Claude Code should be given the relevant phase specification plus this constitution
before implementation work.

---

## 31. CURRENT PROJECT STATUS

Recorded from the existing project documentation **at the time this constitution was
created**. This section is descriptive, not prescriptive. No numeric counts are repeated
here because the authoritative counts live in the requirements-traceability and review
documents; this constitution must not become stale merely because a number changes.

| Phase | Status |
|---|---|
| Phase 0 — Repository analysis / evidence | COMPLETE |
| Phase 1 — Product and domain specification | COMPLETE |
| Phase 2 — Architecture | COMPLETE |
| Phase 3 — Database / schema design | NOT STARTED |
| Implementation | NOT STARTED |
| Owner decisions | DECIDED (D-01..D-11); owner-input items remain open |

*Updated 2026-09-29 by the final closure pass. This section is descriptive, not prescriptive, and is corrected
only where a status has actually changed.*

**Owner decisions.** `OWNER-DECISIONS.md` records **D-01 through D-11, all taken by the owner** and applied to
the specification. §7's prohibition is intact and was honoured: nothing was chosen on the owner's behalf, and
where a decision's *premise* turned out to be wrong it was recorded as a correction rather than quietly
reinterpreted — that is how D-01 came to keep all 13 permission keys after they were found already to exist.

Three items are **genuinely open and are not owner decisions this project can make**: the jurisdictional tax and
currency facts (owner **and legal counsel**, a release blocker), the recovery objectives RPO/RTO and the
retention/restoration policy (owner), and the hardware fleet, quantities, and budget (owner). They are recorded
as `GAP-044`, `GAP-038`, and `GAP-039`. Naming them here is what §7 requires: an open item is stated as open.

**Phase 3 status.** Not started, and it is **gated**: the traceability backlog `C-06` is a blocker by this
project's own acceptance rule (`GAP-035`). No schema, migration, or code has been created.

---

## 32. CONSTITUTION CHANGE RULE

This document itself must not be casually modified. A constitutional change must document:

- change;
- reason;
- evidence;
- affected project rules;
- affected phases;
- migration impact;
- approval requirement.

Never modify the constitution simply to permit an otherwise blocked implementation.

---

## 33. FINAL PRINCIPLE

The governing principle of SmartStore is:

**DO NOT GUESS.**

- If the evidence supports it — implement/document it.
- If the evidence contradicts it — stop and resolve it.
- If the evidence is incomplete — mark it unknown/open.
- If the owner must decide — ask the owner.
- If implementation reveals a contradiction — surface it instead of hiding it.
- If a requirement is difficult — do not weaken it merely because it is difficult.
- If something is not specified — do not pretend it is.

**Correctness is more important than speed.**

---

## 34. CONSTITUTION VALIDATION

This document was created and validated:

- UTF-8 without BOM;
- LF line endings;
- no fabricated project facts;
- no invented owner decisions;
- no technology/framework selection;
- no contradiction with approved Phase 0–2 documents;
- evidence clearly distinguished from assumptions;
- independently readable by a future Claude Code session.

Per the boundary of this task, no Phase 3 work was started: no schemas, no migrations, no
application code, and no framework selection were created.

---

## 35. ADDENDUM — OWNER AUTHORIZATION FOR PHASE 3 (2026-09-30)

**Append-only.** No existing section of this Constitution is changed by this addendum. Sections 1 through 34 stand
as written, including §31's record that Phase 3 was not started as of 2026-09-29. This addendum is dated later and
supersedes that status only; every other rule in this document remains in force.

**Owner authorization.** Recorded by the owner on 2026-09-30:

> Owner authorizes Phase 3 (database design) and the subsequent v1 implementation. The backend language/framework
> must be chosen by an ADR that the owner approves. PostgreSQL stays per ADR-03. All other Constitution rules still
> apply.

**What this does and does not change.**

| Rule | Effect |
|---|---|
| §6 Phase discipline | Phase 3 is authorized to begin. Scope is database design; application implementation follows in later phases. |
| §14 Database design rule | Unchanged. PostgreSQL is the central store per `ADR-03`; no SQLite-as-server. |
| §15 API / backend rule | Unchanged, and now gated on an owner-approved ADR for the backend language/framework. The ADR is the only place that choice may be made, and the owner must approve it. |
| §7 Owner decisions | Unchanged. Nothing was decided on the owner's behalf. `D-01` through `D-14` stand as recorded in `OWNER-DECISIONS.md`; `D-12` and `D-13` remain open and are release/configuration inputs, not schema gates. |
| §32 Constitution change rule | This addendum is the required record: change (authorize Phase 3 and v1 implementation), reason (all entry criteria met, last blocker `CON-03` closed by D-14), evidence (`PHASE-3-ENTRY-CRITERIA.md` §6, `PRE-PHASE-3-GAP-REGISTER.md` §7.7), affected rules (listed above), affected phases (Phase 3, then v1 implementation), migration impact (none yet, no schema exists), approval requirement (owner, given). |
| Everything else | Unchanged and still binding, including the anti-hallucination rule (§3), the evidence rule (§4), requirement integrity (§8), business invariants (§9), auditability (§12), state machines (§13), and the testing rule (§19). |

**Still not authorized by this addendum:** choosing a backend language or framework. That choice requires an ADR
the owner approves. Authorizing the *work* is not authorizing a *stack*.
