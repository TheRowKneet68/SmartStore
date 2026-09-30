# Data Import

**The import contract for catalog and stock data, consolidated from the product rules.**

Status: **DRAFT — PRE-PHASE-3.** The rules below are complete in the owning documents; this document gathers them
into one place for the implementer. Nothing here adds a rule.

## 1. The import rules (from product-domain and inventory-domain)

| Rule | Requirement |
|---|---|
| Dry run first | Every import validates first, then applies with approval (PR-51). No apply-only mode |
| Row-level identity | Identity is a stable external key (supplier barcode/EAN/UPC), never a reliance on names (PR-52) |
| Never silently overwrite | A row that changes a protected field is flagged and skipped; the skip is reported per row (PR-53) |
| Two-phase + per-row outcome | Rows end `Accepted`, `Rejected`, or `Warning` (PR-51) |
| Auditable | `ImportJob` records who ran it, the file identity, row counts by outcome (PR-54); export is similarly audited (CU-36, `Customer.DataExport`) |
| Not one transaction | A large import commits per batch; a failure at row 5,000 leaves 1..4,999 applied and reports the remainder (PR-55) |
| Permissioned | `Import.Run` / `Import.Approve` (actors-and-roles §2); opening balance requires `Config.Organization` + `Import.Approve` (inventory §5) |

## 2. Stock import is different from catalog import

- A stock import **requires a reason code**, writes **movements**, never balances (inventory §5; the D-03
  constraint: imports are dry-run-first and validated).
- An `OPENING_BALANCE` movement type exists for initial load, migration, and **validated stock import**
  (inventory-domain §4).
- **There is no "set stock" import.** A requirement that appears to need one is an opening balance or a
  reason-bearing adjustment (IV-13).
- A stock receipt/issue needs a source/destination; `Other` always requires a reason and is reported (IV-51/52).
- The specialised flows take precedence: a generic import path can never receive a purchase (IV-53, BI-38).

## 3. Where data enters

| Data | Path | Authority |
|---|---|---|
| Catalog (products, variants, barcodes, prices) | Catalog import (PR-51..55) | `Import.Run` + `Import.Approve` |
| Opening stock | `OPENING_BALANCE` movements | `Config.Organization` + `Import.Approve` |
| Customers | Customer import — permissioned (`Customer.DataExport` is the read-side twin for extract) | actors-and-roles §2.6 |

## 4. Integrity guarantees

- A failed import leaves no partial ledger inconsistency: stock writes are movements in transactions (BI-02/03).
- No billion-row import holds one transaction (PR-55); batching is a stated requirement.
- Import identity reuse is protected: a barcode is not reassigned while referenced (PR-09/10).