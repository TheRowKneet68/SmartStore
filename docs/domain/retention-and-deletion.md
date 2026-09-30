# Retention and Deletion

**What may be deleted, what may never be deleted, and how retention works. Consolidated from the audit, customer,
inventory, and overview rules.**

Status: **DRAFT — PRE-PHASE-3.** Rules only; no retention numbers are invented.

## 1. The deletion model

- **No hard delete** on any entity that has ever appeared in a financial or inventory document (overview §7.10;
  BI-40; BI-08).
- Deletion is a **status change to `Archived`/`Closed`/`Terminated`**, and archival is itself a permissioned,
  audited operation (BI-40; overview §7.10).
- The only entities that may be hard-deleted are those that provably have no dependent rows and no audit events
  (BI-40, overview §7.10).
- Documents are cancelled, never deleted (SM-08); a PO is never deleted in any state, including Draft
  (SM-24, PR-Q06a, RT-117).
- No cascade or bulk delete ever reaches an audit event (AU-32).

## 2. Retention rules

| Rule | Requirement |
|---|---|
| Retention is per-category, configured per organization, with a legal floor and a consent ceiling | AU-17 — both are configuration, neither hardcoded |
| Financial categories (stock, payments, refunds, cash, price changes, voids, adjustments, approval decisions) are not deletable before the configured financial period | AU-18 |
| Personal fields in non-financial events are redacted at write time (AU-09), then expirable | AU-19 |
| Expiry is whole-event and writes an `Audit.EventExpired` event recording the range and the policy | AU-20 |
| The retention policy itself is versioned, audited, and requires approval | AU-22 |
| Customer retention is per-organization configurable; deleting for retention reasons is `Closed`, never a delete | CU-38, CU-10 |
| A batch may never be deleted; it is archived | BE-08 |
| A stock item is never deleted; inactive variants retain record+history | IV-03 |

## 3. Consent and right-to-be-forgotten

- Consent is a stored, timestamped, sourced flag, defaulting to `NotAsked`; absence never blocks a sale (CU-34).
- A customer deletion request routes through retention: expiry is whole-event (AU-20), and the audit store
  records that it forgot (AU-29 chain intact). A financial event is not deletable on request (AU-18).
- "The system that forgets must record that it forgot" — AU-20 is the compliance answer to deletion requests.

## 4. What the retention schedule is

**Not decided here.** The floor/ceiling values are configuration the owner sets per jurisdiction (AU-17, GR-05).
This document asserts no year-count for any category.

## 5. Implementation consequences

- Retention is executed by a scheduled job that records what it did and what it changed (AU-16).
- Purge activity is a standing audit report (AU-27 "Retention or purge activity").
- A restore (backup-and-recovery.md) must not re-animate purged events in a way that contradicts the chain.