# Configuration Model

**What is configuration in SmartStore, who may change it, and how configuration survives a report or a sale.**

Status: **DRAFT — PRE-PHASE-3.** Derived from existing rules; nothing here configures a value that does not
exist.

## 1. The governing rule

> **A sale is computed under the configuration that existed when the sale completed, and that configuration is
> snapshotted onto the sale** (`SettingsSnapshot`, `organization-model.md` §3.1; `SP-33` tax mode; `SP-06` every
> display value snapshotted). A report run today shows what was true on the day, not a live re-render.

## 2. What is configuration, from the existing documents

| Area | What is configured | Rule |
|---|---|---|
| Store settings | `SettingsSnapshot` captured on the sale; tax mode per store | organization-model §3.1; SP-33 |
| Store currency | Organization currency immutable once a financial document exists (change = new org or documented migration) | ORG-01 |
| Negative-stock policy | `AllowNegative` / `BlockNegative` per store; offline requires AllowNegative | SP-63; organization-model §3.2; IV-16 |
| Payment methods | Per store and per currency, typed, enablement prospective | PY-03/05, PY-04 |
| Provider | Per store and per method | PY-09 |
| Discount thresholds | Per store | SP-30 |
| Offline | Per terminal, explicit; offline discount cap per store; offline window | OF-04, OF-16, OF-28 |
| Approval thresholds | Per store; approver ≠ requester | SP-30, AP-*, SEP-08 |
| Notification channels | Per event type and per user with a store-level default; no global switch; critical not silenceable | NT-16, NT-19 |
| Business hours | Notification deferral | NT-21 |
| Count tolerances | Variances within tolerance post automatically | IV-28 |
| Transfer transit age | Notified against a configured age | IV-44 |
| Rounding | Cash rounding per store/currency; mode per organization | SP-25/26 |
| Retention | Per-category floor/ceiling, configured per organization | AU-17 |
| Loyalty | Accrual basis (**v1 default: net of discount, excluding tax** — D-11); redemption value per point (effective-dated) | CU-25, RR-41, CU-24 |
| Import | Permissioned execute + approve | actors-and-roles §2 |

## 3. Who may change configuration

Configuration changes are permissioned operations, not free text:

- Store-level: `Config.Store` (offline cap, OF-16), `Config.Organization` (opening balance, inventory §5).
- Payment provider change: `Payment.Provider.Configure` — the highest-privilege operational permission; audited
  and approvaled (PY-06, PY-45).
- Method enablement is prospective (PY-05): disabling stops new use, history renders unchanged.
- Import and backup config: `Import.Run`/`Import.Approve`; `Config.Backup`/`Backup.Restore`.
- Retension-policy change: versioned, audited, requires approval (AU-22).

## 4. How configuration is stored

This document does not pick storage (Phase 3 / azd concern). What the rules require: configuration is **data per
store and per currency**, snapshotted into documents at the moment of use (architecture §27.3). Effective-dating
is required where the rules name it: loyalty redemption value (CU-24), method enablement (PY-05), credit-limit
change (CU-18).

## 5. Open decisions

- RPO/RTO (OWNER-DECISIONS D-13) affects whether configuration participates in backups — the rules already put
  it in the backup scope (organization-model §3.1 lists "data-retention and backup policy").