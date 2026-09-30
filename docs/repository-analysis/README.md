# SmartStore — Phase 0 Repository Analysis

**Status:** Research only. No SmartStore application code exists. No source code was copied.
**Date:** 2026-09-28
**Method:** All five repositories were cloned into `/research/` and inspected at source level. Findings are
evidenced by file paths and quoted code, not README claims. Where the README contradicts the code, the code wins.

## Repositories analyzed

| # | Repository | Stack | License | Verdict |
|---|---|---|---|---|
| 1 | [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) | PHP 8.2 / CodeIgniter 4 / MySQL | MIT + nonstandard footer clause | **REFERENCE ONLY** (legal review) |
| 2 | [Raktim94/nodedr-pos](https://github.com/Raktim94/nodedr-pos) | Node 20 / Express 5 / Next 16 / SQLite / Prisma | AGPL-3.0-only | **REFERENCE ONLY** (copyleft) |
| 3 | [YourGbDev/pos-system](https://github.com/YourGbDev/pos-system) | PHP 8 hand-rolled REST / React 19 / MySQL | **NONE** | **DO NOT USE** |
| 4 | [heckur08/Retail-Inventory-and-POS-Platform](https://github.com/heckur08/Retail-Inventory-and-POS-Platform) | Laravel 8 / React 17 (vendored template) | **NONE** (README claims MIT, link dead) | **DO NOT USE** |
| 5 | [Pushpendera5/bucket-rfid-store](https://github.com/Pushpendera5/bucket-rfid-store) | .NET 10 / EF Core / React 18 / SQL Server | **NONE** ("all rights reserved") | **REFERENCE ONLY** (no license) |

## Documents

| File | Contents |
|---|---|
| [feature-matrix.md](feature-matrix.md) | Per-capability COMPLETE / PARTIAL / ABSENT / UNKNOWN for all 5 repos |
| [license-matrix.md](license-matrix.md) | Exact license, obligations, compatibility, classification per repo |
| [architecture-comparison.md](architecture-comparison.md) | Layering, transaction integrity, extensibility |
| [database-comparison.md](database-comparison.md) | Schema, inventory representation, ledger analysis |
| [security-comparison.md](security-comparison.md) | Auth, hashing, RBAC, isolation, concrete vulnerabilities |
| [reuse-analysis.md](reuse-analysis.md) | Per-subsystem REUSE / ADAPT / REIMPLEMENT / REFERENCE ONLY / DO NOT USE |
| [missing-features.md](missing-features.md) | What no repository provides adequately |
| [risk-register.md](risk-register.md) | Severity / impact / probability / mitigation |
| [foundation-recommendation.md](foundation-recommendation.md) | The 13 required answers |
| `repository-ospos.md` | Full OSPOS audit |
| `repository-nodedr-pos.md` | Full NodeDR audit |
| `repository-yourgbdev-pos.md` | Full YourGbDev audit |
| `repository-retail-inventory-pos.md` | Full Retail audit |
| `repository-rfid-store.md` | Full RFID reference audit |

## Headline finding

**No candidate repository is a viable foundation for SmartStore.** Three of five have no license at all.
The two that are licensed are both architecturally disqualified for the stated requirements:

- **OSPOS** is the only project with a real test suite, a real schema, and a real security posture — but it is
  single-store, has no suppliers or purchasing at all, no batch/expiry, no terminals or shifts, no credit/AR,
  and no audit log. Its license carries a nonstandard clause no automated tool will detect.
- **NodeDR** is the only project with returns, refunds, customer credit, and loyalty implemented — but it is
  AGPL-3.0, which imposes network copyleft on any deployment, and it is architecturally a single-till kiosk
  with a `products.stock` integer column, no suppliers, and no purchasing.

Recommendation: **Option C — build SmartStore clean**, using OSPOS as a design reference and reimplementing
all business logic. See [foundation-recommendation.md](foundation-recommendation.md).
