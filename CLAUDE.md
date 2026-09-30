# CLAUDE.md

Orientation and working rules for this repository. Read this before touching anything.

## What SmartStore is

A retail store management system. This repository currently contains **documentation only** — no application
source code, no schema, no migrations. The spec is the deliverable at this stage.

Start with [README.md](README.md), then [SMARTSTORE-CONSTITUTION.md](SMARTSTORE-CONSTITUTION.md) and
[SMARTSTORE_MASTER_GOAL.md](SMARTSTORE_MASTER_GOAL.md).

## Where things live

| Path | What it is |
|---|---|
| `docs/product/` | The specification. 31 files: domains, state machines, and the requirement catalogue. |
| `docs/product/requirements-traceability.md` | **The spine.** 529 requirement rows (`RT-001..529`) and the rule-coverage table in §26.2. 1,161 rules. |
| `docs/domain/` | Cross-cutting rules: `business-invariants.md` (`BI-*`), `retention-and-deletion.md`. |
| `docs/architecture/` | Gate and decision documents. Gap register, entry criteria, owner decisions, phase reviews. |
| `docs/testing/` | `TEST-STRATEGY.md`. |
| `docs/hardware/`, `docs/repository-analysis/` | Peripheral reference material. |

Rule IDs are prefixed by domain and are cited everywhere: `PY-*` payment, `SM-*` state machines, `SU-*`
supplier, `IV-*` inventory, `NT-*` notification, `BI-*` business invariants, `AU-*` audit, `EC-*` edge cases,
`RR-*` returns/refunds, `AP-*` approvals, `CU-*` customer, `RF-*` security, `HD-*` hardware, `SP-*` sales,
`PR-*`/`PR-Q*` procurement, `AC-*` actors, `ORG-*` organization, `RP-*` reporting, `OF-*` offline,
`CON-*` contradictions, `GAP-*` gaps, `C-06`/`C-13` criteria.

## Current state

**Phase 2 documentation is closed. Phase 3 (database design) MAY START and has not been started.**

- All thirteen entry criteria (C-01..C-13) are met or decided. Current status:
  [docs/architecture/PHASE-3-ENTRY-CRITERIA.md](docs/architecture/PHASE-3-ENTRY-CRITERIA.md) §6.
- No genuine Phase 3 blockers remain. The last one, `CON-03`, was closed by owner decision **D-14**.
- Open items that do **not** gate Phase 3: `GAP-036`..`GAP-043`. **Release** blockers: `GAP-044`
  (jurisdictional tax facts) and `GATE-Q2-LICENCE`. Owner decisions `D-12` and `D-13` are still open and are
  release/config inputs, not schema gates.
- Phase 3 scope is **database design only**. Application code is a later phase.

Decisions are recorded in [docs/architecture/OWNER-DECISIONS.md](docs/architecture/OWNER-DECISIONS.md). That file
is the authority on what the owner has actually decided. Do not infer a decision from the absence of one.

## Working rules

These are not preferences. Breaking them damages the record.

**1. Governance documents are append-only.** `PHASE-3-ENTRY-CRITERIA.md`, `PRE-PHASE-3-GAP-REGISTER.md`,
`PHASE-2-REVIEW.md`, `CONSTITUTION-READINESS-AUDIT.md`, and `OWNER-DECISIONS.md` are a dated historical record.
Correct a past statement by appending a new dated section that explicitly supersedes it. Never rewrite or delete
what an earlier section said. When you append, name the section it supersedes.

**2. Older sections are historical, not current.** A reader who lands mid-file will hit stale status text
(`NOT MET`, `NOT REACHED`). Each such document opens with a `Current status: see §N` line pointing at the
authoritative section. When you append a new authoritative section, **update that pointer line** so it keeps
pointing at the truth.

**3. Encoding is UTF-8, no BOM, LF only, trailing newline.** No `U+FFFD`, no mojibake (`C2`/`C3` byte pairs).
This applies to every file. PowerShell `Get-Content`/`Out-File` will corrupt these files — use
`[System.IO.File]::ReadAllText` / `WriteAllText` with `New-Object System.Text.UTF8Encoding($false)`.

**4. Verify traceability before claiming it.** Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\architecture\measure-c06.ps1
```

All checks must pass. It asserts 529 requirement rows, a 1,161-rule two-way bijection, `inferred 0`, and the
audit element counts. **Copy its output into your report** — do not paraphrase it as "looks good".

**5. Changing a citation can orphan a rule.** Every rule in §26.2 must be cited by at least one requirement row
(`mapped but never cited = 0`) and every cited rule must exist in §26.2 (`cited but absent = 0`). Re-citing a row
away from its only citing row breaks the bijection. Check who else cites a rule before you move it.

**6. Do not start Phase 3 without being asked.** No schema, no migrations, no application code. Zero code files
belong in `docs/`. If a task seems to require them, stop and ask.

**7. Do not invent owner decisions or legal facts.** Jurisdictional tax rates, licence compatibility, and OSS
dependency terms need the owner and counsel. A gap is recorded as a gap, not filled with a plausible guess.

**8. Back up before writing, and check every file you touched for encoding afterwards.** Report the count of
files that failed, even if zero.

## Known limits of the record

Stated plainly so they are not mistaken for resolved:

- The original per-rule reasoning behind the C-06 traceability audit was **lost**. The audit is a mechanical
  rebuild, validated by an independent 42-rule re-sample (29 confirmed, 12 weak, 1 adds-behaviour, 0 wrong-home).
  **49 rule identities remain unrecoverable.** Owner-accepted, permanent disclosure — see
  `docs/architecture/C-06-TRACEABILITY-REVIEW.md` and the worksheet's §7.1.
- The spec is large and internally cross-referenced. A change in one rule can contradict another. When a rule
  changes, grep the tree for statements that depend on it before assuming the change is contained.

## Committing

Commit before and after a unit of work, so the pre-change state is always recoverable. Back up files to a
timestamped directory outside the repo before writing them. Do not commit `.bak` files or scratch output.
