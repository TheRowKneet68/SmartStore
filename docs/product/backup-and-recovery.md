# Backup and Recovery

**What must be backed up, who may restore, and what recovery rules the product already sets.**

Status: **DRAFT — PRE-PHASE-3.** This document consolidates the existing backup/recovery rules. It does **not**
invent a backup tier, a schedule, an RPO/RTO, or an off-site policy — those are owner inputs (OWNER-DECISIONS
D-13).

## 1. What the documentation already requires

| Requirement | Rule | Consequence |
|---|---|---|
| The offline queue is included in backup and in the local integrity check | OF-45 | A terminal whose local queue lost twenty sales would be invisible; backup includes the local ledger |
| The local ledger is encrypted at rest and bound to the registered device credential | OF-41 | A backup cannot be treated as generic file copy; it is encrypted and device-bound |
| Archival moves audit events to cold storage and preserves the query path | AU-21 | Restore of an archived range answers old queries, slower |
| Retention expiry is whole-event and records `Audit.EventExpired` | AU-20 | An expired event is not "lost by restore"; it is a recorded fact |
| The audit store is append-only at the storage layer with a per-organization chain; a broken chain is an incident | AU-29/30 | A restore must preserve the chain or the restored store is untrustworthy |
| Administrator write access to the audit store is a documented, chain-mitigated risk | AU-31 | Restore of the audit store re-enters that risk; documented |
| Backup policy is named as part of the organization model | organization-model §3.1 | Backup is a configured, per-organization concern |

## 2. Who may manage or restore

`actors-and-roles.md` §3:

- `Config.Backup` / `Backup.Restore`: manage and restore backups. **`Backup.Restore` is called the most
  dangerous permission in the product** — restoring a backup overwrites live data, including any event written
  after the snapshot.
- Restore with approval: organization administrator / platform owner restore is a "sensitive action" requiring
  separation (owner + approver).
- `AU-14` is cited as the reason: the permission is dangerous not because it is common but because its misuse is
  irrecoverable.

## 3. What a recovery design must satisfy (from rules, not invented)

1. Restore of the audit store preserves the append-only chain (AU-29) or the restored store is flagged.
2. The offline queue on each terminal is part of the recovery surface (OF-45) — a server restore that ignores
   unsynced terminal queues strands sales.
3. Archived ranges restore a queryable path, not a black hole (AU-21).
4. Retention-expiry events are not re-derived away by a restore (AU-20): the expiry record is itself a fact.
5. Deleting on the restore path is forbidden for audit events (AU-32, BI-24): a cascade delete must never reach
   an audit event.

## 4. Open decisions (owner)

- **RPO / RTO** and restore window — no rule states them (OWNER-DECISIONS D-13).
- **Off-site / multi-region placement** — an infra decision, out of scope for this boundary doc.
- Whether the audit log ships to an external log shipper (AU-31 names it as an outstanding infra decision).

## 5. Deliberately not in this document

No storage technology, no schedule, no RPO/RTO number, no tooling. Those are Phase 3 decisions made against this
requirement set.