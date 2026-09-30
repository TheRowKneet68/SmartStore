# Open Questions

**Last updated:** 2026-09-30

Unresolved questions and owner inputs. Anything here must not stall engineering: resolve what you can from
`/docs`, work around what you can design around, and keep going.

Each entry: what is unknown, why it cannot be answered from the specification, what is blocked on it, and what to
do meanwhile. Do not fill a gap here with a plausible guess.

## Release-only — not blocking engineering

These need the owner, and for `GAP-044` legal counsel. None of them blocks schema derivation or implementation.

### GAP-044 — Jurisdictional tax facts

- **Unknown:** which taxes apply to a sale, at what rate, the rounding mode, and a shop's printed-receipt
  obligations.
- **Why not answerable from `/docs`:** these are legal facts a jurisdiction imposes, not specification choices. The
  *mechanism* is specified (`SP-33..38`, `PR-38..41`); the rates are not. This is decision **D-12**, still OPEN.
- **Blocked on:** owner **and legal counsel**.
- **Blocked:** release. A shop cannot lawfully issue a receipt without them.
- **Meanwhile:** build the mechanism with rates as data, not as code or schema constants. Do not invent a rate.

### GAP-038 — RPO / RTO and restore window

- **Unknown:** acceptable data loss (RPO) and acceptable restore time (RTO).
- **Why not answerable from `/docs`:** the rules name the requirement and the permissions (`Config.Backup`,
  `Backup.Restore`) but not the numbers. This is decision **D-13**, still OPEN.
- **Blocked on:** owner.
- **Blocked:** release only. Not schema.
- **Meanwhile:** the offline queue is in scope for backup and local integrity (`OF-45`). Design the backup shape;
  leave the numbers as configuration.

### GATE-Q2-LICENCE — Licence naming and OSS terms clearance

- **Unknown:** the specific licence, and whether each selected dependency's terms are compatible with it.
- **Why not answerable from `/docs`:** decision **D-10** settled that SmartStore is sold commercially, and left
  naming and clearance to owner and counsel. Naming a licence is a legal conclusion, not a documentation one.
- **Blocked on:** owner **and legal counsel**.
- **Blocked:** release and distribution. Engineering is not blocked, but licence compatibility and third-party
  dependency review are a pre-release requirement — check every selected dependency's terms and record it before
  distribution.
- **Meanwhile:** record dependency licences as you choose them, so the review is possible later.

## How to use this file

- Add an entry the moment you hit something the specification does not answer. Then continue with a different task.
- Do not ask the owner about anything not listed under **Ask the owner only for** in [CLAUDE.md](CLAUDE.md):
  choosing the tech stack, changing an owner decision, or anything needing money, secrets, or real hardware.
- Resolve from `/docs` first. If `/docs` answers it, it is not an open question and does not belong here.
- Close an entry only by recording the decision and where it is recorded. Do not delete an entry.
