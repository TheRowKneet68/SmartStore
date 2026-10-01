# CLAUDE.md

Read this at the start of every session. It is short on purpose.

## Session start

1. Read [SMARTSTORE-CONSTITUTION.md](SMARTSTORE-CONSTITUTION.md). Read all of it, including §35 (owner
   authorization). The Constitution outranks this file.
2. Read [BUILD-STATUS.md](BUILD-STATUS.md). It records the current phase, what is done, what is in progress, and
   what is next.
3. Check [OWNER-DECISIONS.md](docs/architecture/OWNER-DECISIONS.md) for the decisions you must honor.

## Current phase

**Phase 3 — database design.** Authorized by the owner on 2026-09-30 (Constitution §35). Application
implementation follows in later phases.

Phase 3 is **database design only**: schema, entities, keys, constraints, indexes, and the migrations that create
them. Do not start application code during Phase 3.

The backend language/framework is **not chosen**. It must be chosen by an ADR that the owner approves. Until that
ADR exists, do not assume a language, framework, ORM, or driver.

**PostgreSQL is fixed** per `ADR-03` (PostgreSQL as the central store; no SQLite-as-server). Money is integer minor
units end to end per `ADR-04`.

**2026-10-01 — Step 3, v1 implementation, has started on the owner's instruction.** Phase 3's design is complete
(all seven domains). The stack is chosen by ADR-31, which the owner approved. The owner said "start Step 3", so
application code is now in scope, in the order and under the rules in BUILD-STATUS.md working agreements 7 to 12.
The two paragraphs above describe Phase 3 as it was and are superseded by this note only as to application code.

## Rules

**`/docs` is the source of truth. Never invent business behaviour.** The specification lives in
[docs/](docs/): domains, state machines, and the requirement catalogue. If the answer to a business question is not
in `/docs`, you do not know it. Write it to [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) and continue with a different
task. Do not guess, and do not quietly pick a plausible answer.

**Honor owner decisions D-01 through D-14 exactly.** They are recorded in
[OWNER-DECISIONS.md](docs/architecture/OWNER-DECISIONS.md). `D-12` and `D-13` are still open; those are recorded as
open, not decided. Where a decision corrected an earlier premise, the correction is part of the decision.

**Every table, function, and test cites requirement IDs.** A database table cites the `RT-xxx` row and rule IDs
(`PY-*`, `SM-*`, `SU-*`, `IV-*`, `BI-*`, `EC-*`, `RR-*`, and so on) that require it. A constraint cites the rule it
enforces. A test cites the requirement it proves. An artifact with no citation is not justified and will be sent
back.

**Small steps, one module at a time.** Write tests with the code, run them, and commit after each passing step.
Update [BUILD-STATUS.md](BUILD-STATUS.md) after every step, including failed attempts — a step that failed and was
abandoned is information the next session needs.

**Never modify `/research`.** It is the evidence base and is read-only. Never modify Phase-0 frozen files. Never
delete history or data. Append or use verified writes; do not rewrite a record to make it look current.

## Ask the owner only for these

- Choosing the tech stack (the ADR in Phase 3).
- Changing an owner decision.
- Anything needing money, secrets, or real hardware.

Anything else, resolve from `/docs` or record it in `OPEN-QUESTIONS.md` and move on. Do not stop and ask about
something the specification already answers.

## Open items that do not block engineering

`GAP-044` (jurisdictional tax facts), `GAP-038` (RPO/RTO), and `GATE-Q2-LICENCE` (licence naming and OSS terms) are
**release-only**. They need the owner, and for `GAP-044` legal counsel. Record them in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md); do not stall engineering on them, and do not invent tax rates, licence
compatibility, or recovery numbers.

## Repository conventions

- Governance documents in `docs/architecture/` are append-only. Correct a past statement by appending a dated
  section that names what it supersedes. Never rewrite what an earlier section said.
- Every file is UTF-8, no BOM, LF only, trailing newline. PowerShell `Get-Content`/`Out-File` corrupts these; use
  `[System.IO.File]::ReadAllText` / `WriteAllText` with `New-Object System.Text.UTF8Encoding($false)`.
- After changing any citation in
  [docs/product/requirements-traceability.md](docs/product/requirements-traceability.md), run
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\architecture\measure-c06.ps1` and paste its output.
  It asserts a 1,161-rule two-way bijection. Re-citing a row away from a rule's only citing row orphans the rule
  and breaks it.
- Commit before and after each unit of work. Back up any file before overwriting it.
- The original per-rule reasoning behind the C-06 traceability audit was lost; 49 rule identities are permanently
  unrecoverable. The audit is a mechanical rebuild validated by a 42-rule re-sample. See
  `docs/architecture/C-06-TRACEABILITY-REVIEW.md`. Do not present the audit as a clean original.
