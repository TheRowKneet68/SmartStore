# SmartStore — Product Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Product`, `ProductVariant`, `Category`, `Brand`, `ProductBarcode`, `Unit`, `UnitConversion`,
`ProductImage`, `PriceList`, `ProductCost`, `TaxCategory`, `TaxRate`, `DiscountRule`, `Coupon`, and
`SupplierProduct`. Conventions from [product-overview.md](product-overview.md) §3 apply.

---

## 1. The core distinction: product vs variant

Most retail systems get this wrong by making `Product` both the marketing item and the stockable unit. The moment
a shop sells a t-shirt in three sizes and four colours, that model has nowhere to put the difference.

SmartStore separates them:

| | `Product` (SPU) | `ProductVariant` (SKU) |
|---|---|---|
| **Is** | The thing a shopper recognises | The thing that is stocked, priced, barcoded, and bought |
| **Has** | Name, description, category, brand, images, status | Barcodes, prices, cost, stock identity, weight, unit |
| **Cardinality** | 1 : N variants | Many : 1 product |
| **Stocked?** | **Never directly** | **Always** |
| **Priced?** | No | Yes, via price list entries |

**Rule PR-01.** Only a `ProductVariant` may appear on a sale line, a stock item, a purchase order line, or a
stock count line. A `Product` with no variants cannot be sold. The system must prevent the sale of a
variant-less product rather than failing at the till.

**Rule PR-02.** A `Product` may be created as a draft before its variants exist — that is how real merchandising
works. It may not become `Active` until it has at least one active variant.

**Simple product.** A product with exactly one variant is legal and is the common case in a grocery store. The
model does not special-case it. One variant, one barcode, one price.

**Variant option model.** `Product` carries a set of `ProductOption` definitions (Size, Colour), and each
`ProductVariant` carries a value per option. Variants are generated from the option matrix but are **real rows**,
not computed on read — because a variant accumulates barcodes, prices, costs, and stock history over time and a
computed variant cannot. An option value removed from a variant leaves an orphan value that is retained and
marked inactive, so historical lines still resolve.

**Rule PR-03.** A variant's option values may not be changed once the variant has appeared in any document. A new
colour is a **new variant**, not an edit.

---

## 2. Category

A **single-parent tree**. Not multiple categories — that is a deliberate simplification.

**Rule PR-04.** A category has exactly one parent (or is a root). A product belongs to exactly one category.

**Rationale and its cost.** A tree is simpler to navigate, simpler to report on ("sales by category"), and
simpler to explain to staff. The cost is that "this product is both a Bakery item and a Vegan item" is not
expressible. That cost is accepted, and the second dimension is available through **tags** (a flat, non-hierarchical
label set) and **attributes** (§4) without complicating the reporting tree.

**Rule PR-05.** A category with products or children may be archived but not deleted, and its products must be
re-categorised or explicitly left in an archived category, which is visible.

**Rule PR-06.** Category ordering is an explicit sort order plus a name, so a merchandiser can control shelf
navigation without renaming.

---

## 3. Brand

Optional, organization-global, unique by name within the organization (case-insensitive). A product with no
brand has a null brand — a null brand is normal and must not require a placeholder like "N/A", which then pollutes
brand reports.

---

## 4. Product attributes and the extension point

Not every retail need fits category, brand, or variant options. Clothes need collar size; groceries need
allergens; electronics need warranty months; hardware needs compatibility.

`ProductAttribute` (name, unit, data type: text, number, boolean, date, select) and `ProductAttributeValue`
attach to a `Product` (or to a `ProductVariant`, where the difference matters — a shirt's *colour* is a variant;
its *care instructions* are an attribute). Attribute definitions are organization-global and reusable; values are
per product.

**Rule PR-07.** Attributes are **descriptive only**. No attribute may be used for pricing, stock, or tax. Those
have first-class fields. Allowing an attribute to become priceable reintroduces exactly the ambiguity the variant
model exists to remove.

**Why this matters.** A surveyed system had a `PermissionJson` field that was stored, displayed in a UI, seeded
with data, and **never once read to make a decision**. An attribute system that becomes load-bearing without
being designed as such ends the same way. A descriptive field that is silently load-bearing is worse than no
field, because the design documents will not describe it.

**COULD (v1):** attribute sets usable as templates for category-level attribute definitions. **OUT OF SCOPE:**
attributes as custom fields on any transactional document.

---

## 5. Barcodes

### 5.1 One product, many barcodes — yes

> A `ProductVariant` may carry **many** `ProductBarcode` records, with **exactly one** marked primary. A barcode
> value is unique across the whole organization.

**Rule PR-08.** The uniqueness scope is **organization-wide**, not per variant. The same barcode on two variants
is an operational catastrophe: the till cannot know which to sell, and resolving it by "most recently used" makes
the till non-deterministic.

**Rule PR-09.** A barcode value may not be reassigned from one variant to another while a document references it.
To change which product a barcode identifies, issue a **new** barcode on the variant and archive the old one. The
old barcode stays in history and can still be scanned against a historical lookup, but not for a new sale.

**Rule PR-10.** A barcode that is archived may be reissued to a different variant **only** if no un-archived
document references it. Otherwise the old barcode resolves to the historical product, which is the correct
behaviour.

**Rule PR-11.** A `ProductVariant` must have at least one active barcode before it can be sold through a
scanner. Variants sold only by search may have none; the till then requires an explicit selection, which is
recorded.

**Barcode kinds (`ProductBarcode.Kind`)** — the symbology, stored as a value the system can interpret:

| Kind | Use |
|---|---|
| `EAN13` / `EAN8` / `UPC_A` / `UPC_E` | Retail goods |
| `Code128` | Non-retail, weight-embedded, internal, GS1 serial (GTIN + serial) |
| `ITF14` / `GS1-128` | Cases and logistics |
| `QR` | Membership, loyalty, URL, or a weighted PLU payload |
| `PLU` | Price-lookup code for a weighing scale |
| `Internal` | SmartStore-issued; never collides with a retail symbology |

**Rule PR-12.** A scanned symbology is **normalised** to a canonical value before lookup (leading
zeros preserved, check digit validated where the symbology has one, whitespace stripped). Trimming a leading
zero from a code that has one is the classic barcode bug, and it is prevented by treating the barcode as a string
with an explicit normalisation function per symbology — never as a number.

**Why string, emphatically.** An `EAN13` barcode is a 13-digit string that may begin with `0`. Stored as an
integer, that leading zero is lost, the code becomes 12 digits, and the item stops scanning. Barcodes are strings.

### 5.2 Weight-embedded barcodes

Codes 128, ITF-14, and GS1-128 can embed weight and price.

**Rule PR-13.** A weight-embedded barcode is parsed into its item reference and its weight. The embedded weight
becomes the line quantity **without further confirmation**, because the label was printed by a trusted upstream
scale. The `ProductVariant.IsSoldByWeight` flag must be set for this path to be available; a non-weighed variant
with a weight-embedded code is rejected at configuration time, not silently treated as a count.

**COULD (v1):** embedded **price** is parsed, displayed, and compared against the system price. If they differ by
more than a configurable tolerance, the sale pauses for confirmation and the discrepancy is logged. SmartStore
never silently honours a label price that the system does not agree with — the system price is authoritative
(BI-30), and the difference is an operational signal, not a transaction.

---

## 6. Units and conversions — the part that must not be improvised

This is the highest-risk area in the product domain, because a wrong quantity silently becomes wrong money.

### 6.1 Units

`Unit` holds: code, name, plural, and a `QuantityKind`:

| `QuantityKind` | Meaning | Examples | Storage |
|---|---|---|---|
| `Countable` | A discrete number of things | piece, pack, box, bottle, tablet | **Integer** |
| `Measurable` | A continuous quantity | kg, g, l, ml, m | **Decimal**, scale per unit |
| `Service` | Time or units of work | hour, day | Decimal. **Cannot be stocked** |

**Rule PR-14.** `QuantityKind` is immutable once the unit has been used in any movement or document. Changing
kg from measurable to countable would corrupt existing quantities silently.

**Rule PR-15.** The organization defines its base units once. Stock is always stored in the product's base unit.

### 6.2 The base unit rule — the single most important rule in this section

> **Every `ProductVariant` has a `BaseUnit`. All stock quantity is stored in the base unit. All input is converted
> to the base unit before it is written. No balance, no movement, and no order line stores a non-base quantity.**

**Rule PR-16.** A purchase order may be written in the supplier's unit (case of 24). The received quantity is
converted to base units on receipt, and **the received line stores both**: the quantity as ordered in the PO unit,
and the converted base-unit quantity. The PO is a contract with the supplier in their units; stock is ours in ours.

**Why it matters.** If a box is 24 pieces and the store receives 10 boxes, stock increases by 240 pieces — and
that conversion must happen **once**, at receipt, permanently. If the conversion factor is later changed (a
supplier re-packs to a box of 30), historical stock must not move. Storing in base units makes that automatic.

**Rule PR-17.** A `UnitConversion` factor is immutable once it has been used in any movement. A changed factor is
a **new** conversion with a new effective date. The old factor is retained for history.

**Rule PR-18.** A `UnitConversion` that has been used in any movement may not be deleted; it is deactivated.

### 6.3 Conversions are of two kinds, and they are not interchangeable

| Kind | Purpose | Exactness | Used by |
|---|---|---|---|
| **Calculated** | A mathematical factor between units: 1 kg = 1000 g; 1 l = 1000 ml | Must be exact, and the system must be able to prove it | Stock entry, quantity entry |
| **Packaging** | A commercial relationship: 1 box = 24 pieces; 1 packet = 6 cans | A declared business fact, often not mathematically reversible | Sales by box, purchasing by case, packaging display |

**Rule PR-19.** A **calculated** conversion must be exact. The system rejects a non-exact calculated conversion
(for example 1 kg = 3 lb, where 1 lb is 0.45359237 kg) and requires it to be modelled as a
**non-exact** conversion, which may not be used for stock entry and may only be used for display.

**Rule PR-20.** A **packaging** conversion may be used for selling a box, but the **stock effect is always the
exact base-unit effect**. Selling one box of 24 draws 24 base units, whatever the packaging factor says.

**Rule PR-21.** Selling in a packaging unit at a different price from selling in the base unit is a **price list**
concern, not a conversion concern. Conversions never carry a price. A "price per box" is a price on the box as a
sellable quantity, resolved through the price list.

**Rule PR-22 — no lossy stock entry.** A quantity entered in a unit that cannot convert to an exact base-unit
value is rejected. Staff must enter a quantity that converts exactly, or the product must be sold in base units.
Rounding here would create fractional stock out of nothing and would break BI-11.

**Rule PR-23 — receipt in a supplier's unit rounds once, visibly.** Where a supplier ships a measured quantity
that does not convert exactly to the base unit (3.333 kg into a 1 kg base is exact, but 2 lb into a kg base is
not), the received base quantity is rounded **up** to the unit's configured scale, and the rounding is shown on
the receipt line as the supplier's stated quantity **and** the accepted quantity. Stock is never rounded down on
receipt — that manufactures shrinkage that never happened.

---

## 7. Weighted products

**Rule PR-24.** A weighed variant has `IsSoldByWeight = true`, a `BaseUnit` of `Measurable`, and a
`WeightIncrement` — the smallest saleable step, default 0.001 kg. The till may only enter a weight that is a
multiple of the increment.

**Rule PR-25.** Each weighed variant has two barcodes: a **PLU** for scale lookup, and a **variable-weight
barcode** for pre-printed labels. The two are distinguished by `ProductBarcode.Kind`.

**Rule PR-26 — tare.** A weighed variant may declare a `TareWeight` (packaging weight). The **net** weight is the
measured gross minus tare, and **net** is what is sold and what is recorded. Gross is recorded too, for
traceability, because a supplier query about a weight discrepancy needs both numbers.

**Rule PR-27.** A weight reading is stored with its source: `Scale`, `Manual`, or `BarcodeEmbedded`. A manual
weight is a distinct fact — it may be wrong, and the system must be able to find every manual weight entered above
a threshold, because that is how a miscalibrated scale or a dishonest customer gets caught.

**Rule PR-28.** Manual weight entry above a configured threshold requires `Sale.Create` **plus** a reason code
and is reported. The threshold is per store. This is a targeted control on the one input a customer can
influence and cannot verify.

**Rule PR-29 — weight is measured at sale, costed at receipt.** The two are unrelated. A kilo of apples received
at 40 and sold in a 900 g pack is a stock and costing question, not a unit question. Never assume the sale weight
equals the purchase weight.

---

## 8. Pricing

### 8.1 Price lists

`PriceList` is a named, scoped set of variant prices. Scopes:

| Scope | Purpose |
|---|---|
| `Store` | A store-specific price — **yes, price can differ by store** |
| `CustomerGroup` | Wholesale, staff discount, loyalty-tier pricing |
| `Channel` | Reserved for a future online channel. Not used in v1 |

A variant resolves to exactly one price, by a **fixed, documented precedence**:

1. Customer-group price for the customer's group
2. Store price for the store of the transaction
3. Organization default price on the variant

**Rule PR-30.** The resolution order is fixed and is never a configured "which wins" question at the till. A
configurable precedence makes a price unpredictable, and an unpredictable price is a pricing error.

**Rule PR-31.** Price resolution is server-side (BI-30). An offline terminal displays a cached price and labels it
as unconfirmed; the server's price governs the finalized sale.

**Rule PR-32 — price changes are prospective and effective-dated.** A price change takes effect at a stated
time. Sales before it keep the old price. A price change with a **backdated** effective time is permitted only
with `Price.Edit` **plus** approval, is reported, and never silently rewrites history.

**Rule PR-33 — below cost.** A price below the variant's current standard cost requires `Price.BelowCost.Approve`
by a different employee (BI-20, BI-26), and is reported. Deliberately available: clear-the-shelves and
damage-clearance are real retail needs, and forbidding them entirely pushes staff into untracked workarounds.

**Rule PR-34 — price never negative, always present.** Every active variant has a non-negative price. A
free item is modelled as a **100% discount line** (BI-19 forbids a negative line amount), not as a zero or
negative price.

### 8.2 Product cost

`ProductCost` is the variant's **standard** cost — the accounting/valuation cost used for margin reporting.

> **Actual cost is per batch.** `StockBatch.PurchaseCost` is what was actually paid for that batch.

**Rule PR-35.** Stock valuation uses the batch's actual purchase cost (weighted average across batches, per the
policy in [batch-expiry-fefo.md](batch-expiry-fefo.md) §7). `ProductCost` is the *standard* cost used for margin
analysis and for the below-cost check. Conflating the two makes margin wrong whenever actual cost differs from
standard — which is always.

**Rule PR-36.** `ProductCost` is a separate permission from `Product.View` (`Product.Cost.View`). A role that can
see price but not cost cannot compute margin; a role that can see cost but not price is the normal case for
procurement.

---

## 9. Tax

`TaxCategory` groups variants for tax. `TaxRate` holds a percentage, a jurisdiction label, and an **effective
date range**, and is versioned — a change creates a new rate rather than editing the old one.

**Rule PR-37.** A tax rate is never edited once any document references it. This is BI-18 in tax terms: a
historical document must show the rate that applied on the day.

**Rule PR-38.** Tax mode is a store setting: prices are tax-**inclusive** (as most consumer retail displays them)
or tax-**exclusive**, and it is **immutable** once the store has a sale. Changing it would reinterpret every
historic price and total.

**Rule PR-39 — inclusive-price extraction.** For a tax-inclusive store, the taxable base is extracted from the
gross: `base = gross / (1 + rate)`, rounded at the line. The tax charged is then `gross - base`, **not**
`gross × rate`, because those two differ by the rounding and the second is simply wrong on a rounded base. The
extraction is done once per line at the line's precision, and BI-11 holds.

**Rule PR-40.** A tax-exempt customer or a zero-rated category is modelled as a **zero-rate tax category**,
never as "no tax category". "No category" is an unclassified state and must not silently mean exempt.

**Rule PR-41 — inclusive-mode rounding.** In inclusive mode, tax-inclusive totals must reconcile: the sum of
line taxes equals the tax on the document total. Where it does not, the residual is assigned to the largest line,
deterministically (overview §3.1, BI-01 allocation rule). The receipt shows the tax line, so the customer can
check it.

---

## 10. Discounts

`DiscountRule` is organization-global and may be restricted to stores, categories, variants, customer groups, or
loyalty tiers. Types:

| Type | Meaning | Scope |
|---|---|---|
| `Percentage` | X% off | Order or line |
| `FixedAmount` | X off the order, or X off a line | Order or line |
| `FreeItem` | Cheapest eligible line becomes zero-cost | Order |
| `BuyXGetY` | Buy X of A, get Y of A free | Order or line |
| `FixedPrice` | A specific variant at a specific price | Line |
| `LoyaltyRedeem` | Redeem points as value | Order |

**Rule PR-42.** A discount may never take a line or document total below zero (BI-19). An over-large discount is
**clamped at zero** for the line, and the applied-versus-requested difference is reported. Clamping is better than
rejecting at the till: the customer still gets served, and the anomaly is visible.

**Rule PR-43.** Stacking is an explicit, configured policy per discount (`AllowStacking`, `MaxStackDepth`), because
"can these combine?" is the question staff ask most and the question the system must answer once, not per
cashier.

**Rule PR-44.** A discount whose result is below cost, or whose value exceeds the store's threshold, requires
approval (approval-workflows §3). Approval is at the moment of application, because the goods leave the store
immediately — there is no later.

**Rule PR-45.** Discounts are applied **in a fixed, deterministic order**, and the order is documented and
audited on the sale: order-level fixed-amount first (it reduces the base for subsequent percentage discounts),
then percentage discounts in rule priority, then free-item, then loyalty redemption. A sale that applied
discounts in a different order would produce a different total, which BI-11 forbids.

**Coupon** is a `DiscountRule` plus a code, with validity window, per-customer and total-use limits.
**COULD (v1).** Where coupons are enabled, a coupon's use count is incremented in the same transaction as the
sale, and a coupon cannot be applied to a suspended (unfinalized) sale, only a finalized one — otherwise a
suspended cart would hold the coupon.

---

## 11. Product status

| Status | Meaning | Sellable | Purchasable | Visible in operational search |
|---|---|---|---|---|
| `Draft` | Being set up. Incomplete | No | No | No |
| `Active` | On sale | Yes | Yes | Yes |
| `Discontinued` | Supplier no longer supplies it | **Yes, if stock remains** | No | Yes, labelled |
| `OutOfStock` | Active, nothing in stock anywhere | Yes (may go negative) | Yes | Yes |
| `Hidden` | Deliberately not sold, e.g. seasonal | No | No | No |
| `Archived` | Retired. History preserved (BI-40) | No | No | Only in history and reporting |

**Rule PR-46 — discontinuation is not deletion.** A discontinued product with stock in the warehouse must still
be saleable, or the store is throwing away inventory it already paid for. The practical consequence: a
discontinued product's batches still require FEFO handling and still appear in expiry reports until they are gone.

**Rule PR-47.** A product can move `Discontinued → Active` (the supplier resumed). It can move
`Active → Archived` but never `Archived → Active`: un-archiving is a data-recovery operation, not a business
action, and allowing it invites confusion about whether historical documents were ever affected.

**Rule PR-48 — archived variants within an active product.** A variant may be individually archived without
archiving the product, so one colourway can be retired while the shirt stays on sale. This is the main reason
variant-level status exists at all.

---

## 12. Supplier products

`SupplierProduct` links a `ProductVariant` to a `Supplier`, holding the supplier's own reference (their SKU),
their pack size, their unit, lead time in days, minimum order quantity, and whether they are the preferred
supplier.

**Rule PR-49.** A variant may have many supplier products (several sources) with exactly one marked preferred.
The preferred supplier seeds the purchase requisition suggestion; it never constrains what may actually be
purchased.

**Rule PR-50.** A supplier's pack size is a **packaging** conversion, expressed against our base unit. It is not
written into the global conversion table, because a supplier's box of 24 is a fact about that supplier, not about
the product.

---

## 13. Import and export

Catalog and stock data arrives in bulk, from suppliers and from the previous system. This is a high-risk
operation: a bad import silently rewrites a catalog.

**Rule PR-51 — dry run first.** Every import runs in two phases: **validate** (parse and report, changing
nothing), then **apply** (commit, requiring `Import.Approve`). The validation report lists every row as
`Accepted`, `Rejected`, or `Warning`, with the reason. No import may be run in apply-only mode.

**Rule PR-52 — row-level identity.** An import row identifies a product by a **stable external key** — supplier
SKU, or a dedicated `ExternalReference` — never by row order or by matching on name. Name matching creates
duplicates and is a well-known import failure.

**Rule PR-53 — never silently overwrite.** An import that would change a field on an existing product reports
the change as a `Conflict` requiring explicit selection: `Skip`, `Overwrite`, or `CreateNew`. The default is
`Skip`, and the default is safe.

**Rule PR-54 — import is auditable.** `ImportJob` records who ran it, the file identity, the row counts by
outcome, and every applied change with before and after values.

**Rule PR-55 — the whole job is not one transaction.** A 50,000-row import is committed **per batch** (default
500 rows), each batch transactional. A single giant transaction holds locks for minutes and, on failure, rolls
back hours of work. The job is resumable from the last committed batch, and re-running a committed batch is
refused rather than duplicated.

**Stock import is treated differently from catalog import.** A stock import **requires** a reason code, writes
`InventoryMovement` rows of type `OPENING_BALANCE` or `ADJUSTMENT`, and is never a direct balance write.
**[P0: D-03 — a surveyed system imported stock by CSV without validation and without a movement, so its opening
position was an assertion rather than a record.]**

**Export** is available per the reporting domain, requires `Report.Export`, and is itself audited with row
counts. Exports of customer data additionally require `Customer.DataExport`.

---

## 14. Product rules index

| ID | Rule |
|---|---|
| PR-01 | Only variants may be transacted. A variant-less product cannot be sold |
| PR-02 | A product becomes `Active` only with at least one active variant |
| PR-03 | Variant option values are immutable once transacted |
| PR-04 | One category, single-parent tree |
| PR-05 | A populated category is archived, not deleted |
| PR-06 | Category ordering is explicit |
| PR-07 | Attributes are descriptive only — never priceable, stockable, or taxable |
| PR-08 | A barcode value is unique organization-wide |
| PR-09 | A barcode is not reassigned while referenced by an un-archived document |
| PR-10 | An archived barcode may be reissued only if unreferenced |
| PR-11 | A scanner-sold variant needs at least one active barcode |
| PR-12 | Barcodes are strings with per-symbology normalisation. Never integers |
| PR-13 | A weight-embedded barcode populates the weight without confirmation, only on a weighed variant |
| PR-14 | `QuantityKind` is immutable once used |
| PR-15 | Stock is always stored in the base unit |
| PR-16 | Received quantity is stored in both the PO unit and the base unit |
| PR-17 | A used conversion factor is immutable |
| PR-18 | A used conversion is deactivated, never deleted |
| PR-19 | Calculated conversions must be provably exact |
| PR-20 | Stock effect is always the exact base-unit effect |
| PR-21 | Conversions carry no price |
| PR-22 | Lossy stock entry is rejected |
| PR-23 | Receipt rounds up, visibly, never down |
| PR-24 | Weighed variants have a `WeightIncrement` the till must respect |
| PR-25 | A weighed variant has a PLU and a variable-weight barcode |
| PR-26 | Net weight = gross → tare. Both are recorded |
| PR-27 | Every weight records its source: scale, manual, or barcode |
| PR-28 | Manual weight above threshold requires a reason and is reported |
| PR-29 | Sale weight and purchase weight are unrelated |
| PR-30 | Price precedence is fixed: customer group → store → organization default |
| PR-31 | Price resolution is server-side |
| PR-32 | Price changes are prospective and effective-dated |
| PR-33 | Below-cost pricing requires approval by a different employee |
| PR-34 | Price is never negative; free items are 100% discount lines |
| PR-35 | Valuation uses batch actual cost; `ProductCost` is standard cost for margin |
| PR-36 | `Product.Cost.View` is separate from `Product.View` |
| PR-37 | A tax rate is versioned, never edited once referenced |
| PR-38 | Tax mode is a store setting, immutable once a sale exists |
| PR-39 | Inclusive tax is extracted, then derived, never gross × rate |
| PR-40 | Exempt means a zero-rate category, never a missing category |
| PR-41 | Inclusive-mode residual tax is assigned deterministically |
| PR-42 | Over-large discounts clamp at zero and are reported |
| PR-43 | Stacking policy is configured per discount, not decided per cashier |
| PR-44 | Approval happens at application time, because the goods leave immediately |
| PR-45 | Discounts apply in a fixed documented order, recorded on the sale |
| PR-46 | Discontinued stock remains sellable |
| PR-47 | `Archived` is terminal for a product; variant status handles partial retirement |
| PR-48 | A variant may be archived while the product stays active |
| PR-49 | Many supplier products per variant, exactly one preferred |
| PR-50 | Supplier pack size is a supplier fact, not a global conversion |
| PR-51 | Every import validates first, then applies with approval |
| PR-52 | Import rows match on a stable external key, never on name |
| PR-53 | Overwrites are explicit; the default is to skip |
| PR-54 | Every import is audited with before/after values |
| PR-55 | Imports commit per batch and are resumable; committed batches are not re-runnable |
| — | Stock import requires a reason and writes movements, never balances |
