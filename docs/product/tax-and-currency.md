# Tax and Currency

**What the product does about tax and money units, and the line between what is product configuration and what
is legal compliance that must not be asserted here.**

Status: **DRAFT — PRE-PHASE-3.** This document derives exclusively from existing rules. It adds no tax fact, no
rate, and no jurisdictional assertion. The target market (Nepal, NPR) is stated in the task instruction but is
**not** a documented business decision in the product documents (GR-05: jurisdictional specifics are business
decisions not yet taken) — this is recorded, not assumed as decided.

**Update 2026-10-01 (owner, D-15).** The owner has since decided the **deployment currency: `NPR`, minor-unit
exponent 2** — see `architecture/OWNER-DECISIONS.md` D-15. The paragraph above is left as it was written and is
superseded on that one point only: the currency is now a business decision. Everything the paragraph protects
stands — no tax rate, no taxable-class list, and no receipt obligation is decided, `D-12` and `GAP-044` are still
open, and overview §3.1 still requires each amount's currency and exponent to be recorded rather than assumed.

---

## 1. The distinction this document keeps separate

| | Product configuration | Legal / tax compliance |
|---|---|---|
| What it is | The mechanism: tax modes, rounding, tax-category shape, receipt line | Whether a specific tax applies, at what rate, to whom, and what a seller must print |
| Decidable from the docs? | **Yes** — specified | **No** — a jurisdiction's facts, owner + legal input |
| This document does | Consolidates the mechanism | Stays silent; records the open decision |

No rate, no taxable-class list, and no receipt-mandate statement is asserted here unless an existing SmartStore
rule states it. `GR-05` says jurisdictional specifics are not traceable and are owner questions.

## 2. Constraints set by other documents

- **Tax mode is a store setting, snapshotted per sale** and immutable once the store has a sale (`SP-33`,
  `PR-38`). `TaxModeAtSale` is on the sale (`sales-pos-domain.md` §3).
- **Inclusive mode:** base extracted per line, tax derived from the rounded base (`SP-34`, `PR-39`). `gross ×
  rate` is forbidden.
- **Exclusive mode:** tax computed on the line net, same document shape as inclusive (`SP-35`).
- **Document tax always equals the sum of line taxes** (`SP-36`, `BI-18`); a residual in inclusive extraction is
  assigned to the largest line deterministically (`PR-41`).
- **Exempt is a zero-rate tax category, never a missing one** (`SP-38`, `PR-40`).
- **Rounding:** cash rounding is optional, per store, per currency (`SP-25`); the rounding *mode* for cash is a
  configured value, not hardcoded (`SP-26`). Default half-up on the money (overview §3.1).
- **Tax-inclusive receipt readable**: one tax line, gross total (`SP-37`).
- A receipt shows the tax line where tax applies (`SP-59`).
- Cost is permission-gated in every output (`IV-57`), so margin never leaks to a customer-facing document.

## 3. What "PR-Q39/PR-Q40" are — kept straight here

Repeated from the architecture correction (PHASE-2-ARCHITECTURE §27.3) because they are frequently conflated:

- `PR-Q39` / `PR-Q40` are **purchase-tax separation** and **tax-inclusive extraction** — *line computation*
  rules. They are **not** tax configuration.
- Rounding is cited as `SP-25` / `SP-26`.

## 4. Open decisions (see OWNER-DECISIONS)

| Decision | Recorded in | Gate |
|---|---|---|
| Jurisdictional tax facts for the target market (Nepal/NPR) — rates, classes, receipt mandates | OWNER-DECISIONS D-12 | none — legal facts |
| Rounding mode per currency/stores beyond the default | OWNER-DECISIONS D-12 (config layer) | none |
| Whether multi-currency is in scope | Not in v1 — `PY-52` (no multi-currency payment), overview §3.1 | — |

## 5. Deliberately not in this document

- No tax rate, no tax-registration requirement, no exemption list, no VAT/GST/SDST figure.
- No assertion about what the Nepal/NPR authorities require. That is legal compliance (OWNER-DECISIONS D-12) and
  adding it here without an in-project authority would be inventing a fact.
