# SmartStore — Requirements Traceability

**Phase 1 — Product & Domain Specification.**

The master matrix that ties every requirement to a domain rule, an actor, a priority, measurable acceptance
criteria, and the phase that delivers it. **This document contains no requirements of its own** — every row
traces to rules already defined in a domain document, and the domain document is authoritative for the rule's
wording.

**Priority vocabulary** — exactly as mandated, and used strictly:

| Priority | Meaning |
|---|---|
| `MUST` | In scope for v1. **Every MUST carries measurable acceptance criteria.** A MUST with unmeasurable criteria is a defect in this document |
| `SHOULD` | In scope, with a stated fallback if the cost is too high |
| `COULD` | Named, bounded, and deliberately deferred. The boundary is written so Phase 2 does not have to guess |
| `OUT OF SCOPE` | Explicitly not in v1. Recorded so it is not re-litigated and not accidentally built |

**Future Phase** uses the SmartStore phase model: Phase 2 = architecture and data model, Phase 3 = backend
build, Phase 4 = UI/UX build, Phase 5 = integration and hardening, Phase 6 = deployment. `P1` marks work that is
specified in Phase 1 and needs no later phase at all — a rule, a matrix, or a decision.

**How the coverage claim is proven.** §26 is a mechanically generated appendix: every defined rule ID across
every rule-bearing document is listed against the RT requirement that owns it. A rule the matrix cites by id or
by range is `mapped`. A rule no row cites is assigned to its nearest same-namespace row in the same domain and
marked `inferred` — **a proposal, not a decision**. A rule with no home at all is `UNMAPPED` and is a real gap.
Regenerate it with the command in §26.1. Do not describe the `inferred` rows as covered until a human has moved
the id into the row it belongs to.

---

## 1. Foundation and access control

### 1.1 Organization model

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-001 | Organization | Every store-scoped entity carries a non-null `StoreId` | MUST | Platform Owner | MS-01, MS-02, org §8, EC-91 | — | Schema inspection over all 60+ entities in §4 of the overview: zero store-scoped columns that are nullable or absent | P2 |
| RT-002 | Organization | Store access is a first-class entity, not a role attribute; revoking access is immediate at the next request, within the permission cache window | MUST | Super Administrator | EM-12..EM-16, org §4 | RT-001 | An employee with two stores resolves a permitted-store set that is the union of both grants; a third store returns `403` (MS-06) | P3 |
| RT-003 | Organization | A warehouse is either store-attached or central, never both | MUST | Super Administrator | WH-01, org §4 | RT-001 | A warehouse cannot be created with a null store and a null organization scope simultaneously; the constraint rejects it | P2 |
| RT-004 | Organization | A central warehouse is not sellable | MUST | Warehouse Manager | MS-15, MS-18, WH-02 | RT-003 | A sale attempting to draw from a central-warehouse location is refused with a named message; 100% of such attempts refused in the acceptance suite | P3 |
| RT-005 | Organization | A terminal without a drawer has no cash shift | MUST | Store Manager | CD-05, PT-01..PT-04, org §6 | RT-003 | Opening a cash shift against a drawer-less terminal is refused | P3 |
| RT-006 | Organization | The full global-versus-store split is published as a table | MUST | Platform Owner | org §8 | RT-001 | Every entity in the overview's §4 catalogue appears exactly once in the org §8 split table | P1 |
| RT-007 | Organization | No franchise, subsidiary, or legal-entity hierarchy in v1 | OUT OF SCOPE | — | MS-30, org §11 | — | A franchise record cannot be created through any API in the v1 surface | — |
| RT-008 | Organization | No region or geographic grouping in v1 | OUT OF SCOPE | — | MS-31, org §11 | — | No region attribute is exposed on store creation in v1 | — |
| RT-445 | Organization | A store is not deactivated while it holds stock or has an open shift | MUST | Platform Owner | EC-39, EC-89 | RT-001, RT-235 | Deactivation is refused naming the stock and the open shift, and succeeds once both are resolved | P3 |
| RT-449 | Organization | The business date is a store setting, and changing it handles open transactions and is audited | MUST | Store Manager | EC-64 | RT-001, RT-234 | Closing a day early with open transactions either completes or refuses them, and the change records the actor, the old date, and the new date | P3 |
| RT-457 | Organization | A store with no provisioned terminal cannot trade | MUST | Store Manager | EC-86, overview 3 | RT-212, RT-005 | A newly added store refuses a sale until it has a provisioned terminal; settings, roles, and a drawer are prerequisites | P3 |
| RT-504 | Organization | The organization currency is immutable once any financial document exists | MUST | Accountant | ORG-01 | RT-001 | A change is refused and names the first document that would be re-denominated; the only routes are a new organization or a migration carrying a documented conversion | P2, P3 |
| RT-505 | Organization | The business time zone is immutable once financial documents exist | MUST | Platform Owner | ORG-02, overview 3.1 | RT-504, RT-234 | A change is refused once a financial document exists; before that it is settable, and the business date follows the organization zone rather than the server or the terminal | P2, P3 |
| RT-506 | Organization | An organization with financial history is deactivated, never deleted | MUST | Platform Owner | ORG-03, BI-40 | RT-346 | Delete is refused once any document references the organization; deactivation is the route, and the organization stays renderable on every historical document | P2, P3 |
| RT-507 | Organization | A sale cannot be recorded before the organization has a store | MUST | Store Manager | ORG-04 | RT-457 | With zero stores a sale is refused naming the missing store; store, terminal, and drawer are the provisioning chain in that order | P2, P3 |
| RT-508 | Organization | A store is never deleted while it holds stock, an open shift, or any document, and its stock is resolved to zero with a reason first | MUST | Platform Owner | ORG-05 | RT-445, RT-346 | Delete is not offered and is refused naming the stock, the open shift, and the referencing document; the route is deactivation once the stock is transferred out or adjusted to zero with a reason code | P2, P3 |
| RT-509 | Organization | A storage location can be made unsellable at any time and is never deleted while it holds a balance or a movement | MUST | Warehouse Manager | WH-03 | RT-004, RT-346 | `IsSellable` is turned off immediately, which is a sale-visibility change and needs no approval; delete is refused while the location has a non-zero balance or any movement | P2, P3 |
| RT-510 | Organization | Quarantine and damaged stock is never merged into sellable stock automatically; release is a discrete, permissioned, audited decision | MUST | Warehouse Manager | WH-04, IV-38 | RT-031, RT-074 | Nothing moves a quarantined or damaged unit into a sellable location without a reasoned, permissioned release writing its own movement, so returned goods cannot re-enter sellable stock by being received | P3 |

### 1.2 Actors, roles, and permissions

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-009 | Access | 18 actors are defined, each with data they must and must not access | MUST | Platform Owner | actors §3 | — | All 18 actor sections exist and each carries a "should not access" list that is non-empty | P1 |
| RT-010 | Access | Permissions are exact-key, default-deny, and server-enforced | MUST | Platform Owner | actors §1, BI-21, BI-22, BI-05, BI-14, BI-16, BI-17, BI-20, BI-31, BI-35, BI-41, BI-42, AC-01, AC-02, AC-03| RT-009 | An unrecognised permission key is denied; a call with no permission is denied; a client-supplied actor or store is ignored in favour of the authenticated principal | P3 |
| RT-011 | Access | Permission keys are namespaced `<Domain>.<Resource>.<Action>` | MUST | Super Administrator | actors §2 | RT-010 | Every key in the catalogue matches the pattern; zero keys use the plural `Sales.` form (corrected during Phase 1 review) | P2 |
| RT-012 | Access | The Organization Owner is not a superuser | MUST | Organization Owner | MS-13, actors §3.2, EC-56 | RT-010 | The Owner cannot perform an action for which no permission is granted to the Owner's role; each such attempt returns `403` | P3 |
| RT-013 | Access | Scope is applied before pagination, filtering, sorting, and aggregation | MUST | Store Manager | MS-04, BI-43, EC-61, BI-14 | RT-001, RT-010 | A store-scoped aggregate over two stores where the user sees one returns only the permitted store's figure; verified at the API boundary, not the UI (EC-93) | P3 |
| RT-014 | Access | There is no unscoped query method available to application code | MUST | Super Administrator | MS-05, BI-14 | RT-013 | A static-analysis or architecture test fails the build if a repository exposes a method without a mandatory store predicate | P3 |
| RT-015 | Access | `403` for no access, `404` for no existence | MUST | Store Manager| MS-07, UX-58, EC-62, MS-09| RT-013 | A record in an invisible store returns `403`; a nonexistent id returns `404`; both carry distinguishable bodies (MS-09) | P3 |
| RT-016 | Access | An employee with no store access sees an empty workspace, not a store picker | MUST | Employee | MS-08, UX-07, EC-57 | RT-002 | Signing in with zero store grants renders the empty-state explanation naming who to ask; no store list is rendered | P4 |
| RT-017 | Access | Shared login accounts are impossible | MUST | Super Administrator | EM-01..EM-04, BI-33, OF-43 | RT-010 | Login is bound to a single `Employee`; no credential may be attached to a role, a device, or a shared identity (RF-34) | P3 |
| RT-018 | Access | Segregation-of-duties conflicts are advisory, not a hard block | SHOULD | Super Administrator | SEP-01..SEP-12, actors §2.13 | RT-010 | Assignment of a conflicting pair succeeds with a warning; the same-role conflict is rejected at the action boundary. A two-person store can therefore operate | P3 |
| RT-019 | Access | Organization-wide reporting is a separate, audited grant | MUST | Store Manager | MS-25, RP-14, RP-17 | RT-013 | Organization-wide report output is visibly marked as organization-wide and requires `Report.OrganizationWide` | P3 |
| RT-020 | Access | Permission changes are audited with before and after | MUST | Super Administrator | PC-01..PC-05, actors §6, AU-03 | RT-010 | Every role assignment and removal writes an audit event naming the role, the scope, the actor, and the prior state | P3 |
| RT-446 | Access | A permission change takes effect on the next request, and the live session is revoked rather than left with stale grants | MUST | Super Administrator | EC-45, OF-42 | RT-010, RT-189 | Removing a role mid-session refuses the next request and revokes the session; no cached grant survives the change | P2, P3 |
| RT-448 | Access | A role's scope is explicit - organization-wide or a named store set - and it never widens by itself | MUST | Super Administrator | EC-55, EC-87, EC-88, MS-11 | RT-002, RT-270 | An organization-wide role acts in every store the employee may access; adding a store does not extend a store-scoped role, and a new assignment is required | P2, P3 |
| RT-503 | Access | Least privilege: no role template grants a permission that no named retail responsibility requires | MUST | Super Administrator | AC-04 | RT-010 | Every permission in every shipped template traces to a named responsibility; a permission added for a hypothetical future need is refused at review, and a template granting an unlisted permission fails the catalogue check | P2, P3 |

---

## 2. Product and catalog

### 2.1 Product, variant, category

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-021 | Product | `Product` is the SPU; `ProductVariant` is the stockable, priced, barcoded SKU | MUST | Inventory Manager | PR-01..PR-03, SM-11 | — | A sale line cannot reference a `Product`, only a `ProductVariant`; the schema and the API both reject a product reference | P2, P3 |
| RT-022 | Product | A product may have many variants | MUST | Inventory Manager | PR-01 | RT-021 | A product with three variants yields three distinct stock items and three distinct barcodes | P3 |
| RT-023 | Product | One variant may carry multiple barcodes | MUST | Inventory Manager | PR-08, PR-13, overview §5 | RT-021 | A variant with a PLU, a GTIN, and a weight-embedded barcode resolves all three to the same variant | P3 |
| RT-024 | Product | A barcode value is organization-wide unique | MUST | Inventory Manager | PR-08, EC-41 | RT-023 | Assigning a barcode held by another variant is refused; a unique constraint, not a check-then-act (EC-41) | P2 |
| RT-025 | Product | A barcode may not be reassigned; it may be archived and reissued | MUST | Inventory Manager | PR-09, PR-10 | RT-024 | Reassignment is refused; archive-then-reissue succeeds and the archive is audited | P3 |
| RT-026 | Product | A category has exactly one parent and no cycles | MUST | Inventory Manager | PR-04, EC-42 | — | Moving a category beneath itself, or beneath its own descendant, is refused | P3 |
| RT-027 | Product | A category with children or products may be archived but never deleted | MUST | Inventory Manager | PR-05, SM-08 | RT-026 | Archive succeeds and the category disappears from operational search; delete is not offered and is refused if attempted | P3 |
| RT-028 | Product | A product is created as a draft and becomes sellable only when complete | MUST | Inventory Manager | PR-02, SM-12 | RT-021 | A draft product is not sellable, not orderable, and not visible in till search; a non-draft product lacking a barcode cannot be activated | P3 |
| RT-029 | Product | Attributes are descriptive only | MUST | Inventory Manager | PR-07 | RT-021 | No attribute value may drive pricing, tax, stock, or a discount rule; the extension mechanism is data, not behaviour | P2 |
| RT-030 | Product | Variant option values are immutable once referenced | MUST | Inventory Manager | PR-03 | RT-021 | Editing an option value on a variant with any document reference is refused with a named message | P3 |
| RT-031 | Product | Discontinuation is not deletion, and discontinued stock stays sellable | MUST | Store Manager | PR-46, PR-47, SM-11, EC-32 | RT-027 | A discontinued product cannot be ordered or received, but a terminal scan of a variant with stock on hand completes the sale | P3 |
| RT-032 | Product | Supplier products are organization-global, with per-supplier pack size and lead time | MUST | Procurement Officer | PR-49, PR-50 | RT-021 | Two stores see the same supplier product; a pack size used in a movement becomes immutable | P3 |
| RT-444 | Product | A product referenced by a finalized document is deactivated or retired, never deleted | MUST | Platform Owner | EC-37 | RT-031, RT-346 | Deleting a product referenced by a finalized sale is refused, and the historical sale still renders the product | P3 |
| RT-443 | Product | A variant's deactivation is prospective: it blocks new use and never removes stock already on hand | MUST | Inventory Manager | EC-33 | RT-031 | Deactivating a variant with stock leaves the balance intact and refuses new receipts and new issues against it | P3 |
| RT-488 | Product | Category ordering is an explicit sort order, not a naming convention | MUST | Inventory Manager | PR-06 | RT-026 | A merchandiser reorders a category by changing its sort order; no category is renamed to move it, and the order survives a rename | P3 |
| RT-489 | Product | A variant sold by scanner needs at least one active barcode; a search-only variant is an explicit, recorded selection | MUST | Inventory Manager | PR-11 | RT-023, RT-028 | Scanner sale of a variant with no active barcode is refused; a search-only variant with none is sellable, and the till records that the selection was explicit rather than scanned | P3 |
| RT-490 | Product | A barcode is a string normalised per symbology, never an integer | MUST | Platform Owner | PR-12 | RT-024 | A 13-digit code beginning `0` round-trips with its leading zero; check digits are validated where the symbology has one and whitespace is stripped; storing a barcode as a number is a build-check failure | P2, P3 |
| RT-495 | Product | A variant may be archived while its product stays active | MUST | Inventory Manager | PR-48 | RT-443, RT-031 | Archiving one colourway leaves the product sellable and its other variants untouched; archiving a variant never archives the product, which is why variant-level status exists | P3 |

### 2.2 Units, weight, and conversions

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-033 | Product | Stock quantities are stored in the variant's base unit | MUST | Inventory Manager | PR-15, overview §3.2, PR-16| RT-021 | Every `StockItem.Quantity` is in base units; a receipt in 12-pack units converts exactly and the movement records both quantities | P2, P3 |
| RT-034 | Product | Stock entry that cannot convert exactly is rejected | MUST | Inventory Manager | PR-22, BI-11 | RT-033 | A quantity in a non-convertible unit is refused at entry; the refusal names the unit and the required exact quantity | P3 |
| RT-035 | Product | Supplier receipts round once, upward, and visibly | MUST | Procurement Officer | PR-23, PR-20, PR-16| RT-033 | A 2 lb receipt into a kg base stores the rounded-up base quantity and the receipt line shows both the stated and accepted quantity | P3 |
| RT-036 | Product | A calculated conversion must be exact; a packaging conversion may differ; a conversion never carries a price | MUST | Inventory Manager | PR-19, PR-20, PR-21 | RT-033 | A lossy calculated conversion is refused; a packaging conversion at a different price requires the margin guard | P3 |
| RT-037 | Product | A conversion used in any movement is immutable | MUST | Inventory Manager | PR-17, PR-18 | RT-036 | Editing a conversion after its first use is refused | P3 |
| RT-038 | Product | A weighed variant is sold by weight, with PLU and embedded-weight barcodes | MUST | Cashier | PR-24..PR-29, EC-70 | RT-033 | A scale weight populates the line without the cashier keying it; a manual weight above the threshold requires `Sale.Create` plus a reason and is reported | P3 |
| RT-039 | Product | A weight reading records its source | MUST | Store Manager | PR-27 | RT-038 | Every weighed line records scale, manual, or default provenance and the reading | P2 |
| RT-491 | Product | `QuantityKind` is immutable once the unit has been used | MUST | Platform Owner | PR-14 | RT-037 | Changing a unit from measurable to countable after any movement or document reference is refused, and the refusal names the first use | P2, P3 |

### 2.3 Pricing, tax, and discounts

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-040 | Pricing | Price resolution order is customer group, then store, then organization, and is server-side | MUST | Cashier | PR-30, PR-31, BI-30 | RT-021 | Four fixtures covering each precedence tier resolve to the expected price; a client-supplied price is ignored | P3 |
| RT-041 | Pricing | Price changes are prospective and effective-dated | MUST | Store Manager | PR-32 | RT-040 | A price change effective tomorrow does not alter a cart priced today; the cart line's applied price is fixed at add time (EC-07) | P3 |
| RT-042 | Pricing | A price is never negative and is always present on an active variant | MUST | Store Manager | PR-34 | RT-040 | A zero or negative price is refused; activation without a price is refused | P2, P3 |
| RT-043 | Pricing | A below-cost price requires `Price.BelowCost.Approve` | MUST | Store Manager | PR-33, AP-01, BI-20 | RT-040, RT-042 | Pricing below the variant's standard cost routes to approval and cannot be applied by the requester | P3 |
| RT-044 | Pricing | Cost visibility is a separate permission from product visibility | MUST | Store Manager | PR-35, PR-36, actors §2.1 | RT-010 | A role with `Product.View` and not `Product.Cost.View` sees price but not cost or margin, in UI and API alike | P3 |
| RT-045 | Pricing | Batch purchase cost and standard valuation cost are different numbers with different jobs | MUST | Accountant | PR-35, IV-54, BE-40 | RT-021 | Stock valuation reports state which basis is in use; the two are never silently interchangeable | P3 |
| RT-046 | Tax | Tax mode is a store setting: inclusive or exclusive | MUST | Accountant | PR-38, BI-18, PR-39, PR-40| RT-040 | Inclusive-mode extraction is exact by formula and verified against a fixture set including zero-rated and exempt cases (PR-39) | P3 |
| RT-047 | Tax | A tax rate is immutable once any document references it | MUST | Accountant | PR-37 | RT-046 | Editing a referenced rate is refused; a new rate version is created and effective-dated | P3 |
| RT-048 | Tax | Inclusive-mode rounding is deterministic and residual-assigned | MUST | Accountant | PR-41, PR-55, BI-01 | RT-046 | For 10,000 random carts the extracted tax sums exactly to the line-allocated tax with zero residual; the residual is assigned by line order | P3 |
| RT-049 | Discounts | A discount may never take a line or document total below zero | MUST | Cashier | PR-42, BI-19 | RT-040 | A 120% discount is refused; the resulting total is never negative | P3 |
| RT-050 | Discounts | Stacking is a configured, explicit policy | MUST | Store Manager | PR-43, PR-44, PR-45| RT-049 | The configured stacking order is applied deterministically (PR-45); an unconfigured combination is refused, not silently accepted | P3 |
| RT-051 | Discounts | A large discount requires approval | MUST | Store Manager | actors §2.1, AP-01 | RT-050 | A discount beyond the store threshold routes to approval and is not applied by the requester | P3 |
| RT-052 | Discounts | A discount below cost or below margin floor requires approval | MUST | Store Manager | PR-44 | RT-051 | The guard fires on the resulting margin, not only on the discount size | P3 |
| RT-492 | Tax | Inclusive tax is extracted at line precision and the tax is derived as the difference, never `gross x rate` | MUST | Accountant | PR-39, SP-34, BI-11, PR-Q40 | RT-046 | The taxable base is `gross / (1 + rate)` rounded at the line and the tax is `gross - base`; a fixture set proves the two differ from `gross x rate`, and the shared routine is the one PR-Q40 requires | P3 |
| RT-493 | Tax | Exempt is a zero-rate tax category, never a missing category | MUST | Accountant | PR-40, SP-38 | RT-046 | An exempt customer and a zero-rated category both resolve to a zero-rate category; a document line with no tax category is an unclassified validation error, not exempt | P3 |
| RT-494 | Discounts | Discounts apply in a fixed documented order, and the order is recorded on the sale | MUST | Store Manager | PR-45, SP-27, BI-11 | RT-050 | The order is order-level fixed amount, then percentage by rule priority, then free item, then loyalty redemption; the applied order is persisted on the sale and a cart replayed in that order reaches the same total | P3 |

### 2.4 Import and export

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-053 | Product | Every import runs dry-run first | MUST | Inventory Manager | PR-51 | RT-052 | A dry run reports per-row outcome and writes no data; the live run requires a distinct confirm | P3 |
| RT-054 | Product | An import never silently overwrites | MUST | Inventory Manager | PR-53, PR-52| RT-053 | A row that would change a protected field is flagged and skipped; the skip is reported per row (PR-52) | P3 |
| RT-055 | Product | An import job is auditable and is not one transaction | MUST | Inventory Manager | PR-54, PR-55 | RT-053 | A failure at row 5,000 leaves rows 1–4,999 applied and reports the remainder; the job records who ran it and the outcome | P3 |
| RT-496 | Product | An import row matches on a stable external key, never on name | MUST | Inventory Manager | PR-52 | RT-054 | A supplier SKU or `ExternalReference` identifies the row; a renamed product matches its existing record, and two distinct products sharing a name are not merged | P3 |

---

## 3. Inventory

### 3.1 The ledger and the balance

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-056 | Inventory | `StockBalance` is a derived projection; no operation writes a quantity directly | MUST | Platform Owner | BI-02, BI-12, IV-05..IV-07, SM-76 | — | Schema inspection: no API writes `StockItem.Quantity`; every balance change is accompanied by a movement written in the same transaction | P2, P3 |
| RT-057 | Inventory | A stock item is variant plus location, not variant plus store | MUST | Warehouse Manager | MS-17, IV-01..IV-04 | RT-001 | A variant stocked in two locations of one store yields two stock items; a central-warehouse item is one row regardless of how many stores draw on it | P2 |
| RT-058 | Inventory | Movement types are a closed enumeration | MUST | Platform Owner | IV-11..IV-13 | RT-056 | An unlisted movement type cannot be persisted; the enumeration is versioned | P2 |
| RT-059 | Inventory | Movements are immutable and are never deleted | MUST | Platform Owner | BI-15, AU-32, IV-05, EC-44, BE-44, BI-15a | RT-056 | A delete on a movement is refused at every privilege; a cascade cannot reach one | P2, P3 |
| RT-060 | Inventory | Every movement names the document that caused it | MUST | Auditor | BI-12, IV-15, BI-03, IV-14| RT-056 | Every movement resolves to a source document type and id; an orphan movement is impossible by constraint | P2 |
| RT-061 | Inventory | A movement and its balance update share one transaction | MUST | Platform Owner | BI-04, IV-07, IV-08| RT-056 | A fault injected between the two writes leaves no movement and no balance change | P3 |
| RT-062 | Inventory | A reversal is a compensating movement, never an edit | MUST | Inventory Manager | BI-24, IV-15, BI-15a | RT-059 | Reversing a movement creates a linked opposite-signed movement; the original is unchanged | P3 |

### 3.2 Receipt, issue, and negative stock

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-063 | Inventory | Stock receipt and stock issue are the generic pair | MUST | Inventory Manager | IV-51..IV-53 | RT-056 | A generic receipt requires a source; a generic issue requires a destination; `Other` always requires a reason | P3 |
| RT-064 | Inventory | A store may allow negative stock; a warehouse may not | MUST | Store Manager | IV-09, IV-10, BI-36, overview §3.2, EC-24, EC-25, OF-38 | RT-056 | Under `AllowNegative` the sale completes and the balance is negative and flagged; under `BlockNegative` the sale is refused naming the shortfall | P3 |
| RT-065 | Inventory | A real batch balance may never go negative, even under `AllowNegative` | MUST | Inventory Manager | IV-19 | RT-064 | A movement breaching a real batch is rejected and the document flagged | P3 |
| RT-066 | Inventory | The shortfall pseudo-batch is the sole exception to RT-065 | MUST | Inventory Manager | IV-19a, BE-29, BE-30, SM-80, OF-39, SP-64| RT-065 | The designated pseudo-batch absorbs a blocked movement and raises `BATCH_SHORTFALL`; no other batch ever goes negative | P3 |
| RT-067 | Inventory | Concurrent sales of the last unit resolve to one success | MUST | Cashier | BI-37, IV-21..IV-24, EC-01 | RT-064 | Two concurrent checkouts for one remaining unit yield exactly one completed sale and one refusal | P3 |
| RT-068 | Inventory | Organization aggregate may be negative while each location is reported separately | MUST | Inventory Manager | IV-20 | RT-064 | Two locations one over and one under sell net to zero; the negative-stock report is per location | P3 |
| RT-069 | Inventory | A negative item is resolved by receiving, not by an upward adjustment | MUST | Inventory Manager | IV-38, EC-34 | RT-064 | An upward adjustment against a negative item with an outstanding goods receipt is refused and the pending receipt is surfaced | P3 |
| RT-483 | Inventory | The negative-stock policy is evaluated inside the movement transaction, against the resulting balance | MUST | Platform Owner | IV-16, BI-36, OF-04 | RT-064 | A movement that would breach `BlockNegative` is refused where the balance is written, in the same transaction; there is no pre-check and re-check, so two concurrent sales of one unit cannot both pass | P3 |
| RT-484 | Inventory | A negative balance is written to the ledger in full, alarmed, and never clamped or hidden | MUST | Store Manager | IV-17, BI-36 | RT-064, RT-483 | Under `AllowNegative` the ledger holds the true negative quantity, a `NEGATIVE_STOCK` warning is raised, and the negative-stock report shows it; no path rewrites the balance to zero | P3 |
| RT-485 | Inventory | A negative balance must be resolved, and resolution is one of a named set of routes with a reason | MUST | Inventory Manager | IV-18, BI-25 | RT-070, RT-484 | Resolution is receiving, transfer in, a found-stock adjustment, or a write-off; each requires a reason code, and the aged report shows how long the item has been negative | P3 |
| RT-487 | Inventory | An out-of-stock event notifies once, and the restore is the reset condition | MUST | Store Manager | IV-59, BE-20 | RT-070 | Falling to zero raises `OUT_OF_STOCK` once; further movement at zero raises nothing; a restore above zero followed by a fall raises it again. It is distinct from the `LowStock` reorder warning and from `NEGATIVE_STOCK` | P3 |
| RT-070 | Inventory | Negative stock is a reported management problem, aged | MUST | Store Manager | IV-11, IV-15, IV-18| RT-064 | The negative-stock report lists variant, location, magnitude, and age in days | P5 |

### 3.3 Counts, adjustments, transfers, reservations

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-071 | Inventory | A stock count is a document and does not move stock until posted | MUST | Inventory Manager | IV-25..IV-31, SM rule for counts | RT-056 | A count in progress changes no balance; posting writes one adjustment movement per counted line | P3 |
| RT-072 | Inventory | Counting is blind: expected is revealed only after submission | MUST | Inventory Manager | IV-31, CD-21, UX-37 | RT-071 | The count screen withholds the system quantity until the count is submitted, then shows both | P4 |
| RT-073 | Inventory | A count in progress is visible to everyone viewing stock | MUST | Store Manager | IV-26, UX-39, SM-83, EC-31 | RT-071 | A concurrent viewer sees a count-in-progress indicator with the counter and start time | P4 |
| RT-074 | Inventory | A stock adjustment always requires a reason code | MUST | Inventory Manager | IV-33, BI-25 | RT-056 | An adjustment submitted without a configured reason is refused; the reason vocabulary is closed per store | P3 |
| RT-075 | Inventory | A large adjustment requires a different approver, on quantity and value | MUST | Store Manager | IV-35, BI-26, BI-27 | RT-074 | Either threshold triggers approval; the requester cannot approve; the adjustment moves no stock until posted (IV-32) | P3 |
| RT-076 | Inventory | Adjustments are reported by reason, actor, location, value, with concentration analysis | MUST | Store Manager | IV-36 | RT-074 | The report flags an actor or reason carrying an unusual share of total adjustment value | P5 |
| RT-077 | Inventory | A cashier can never adjust stock | MUST | Super Administrator | IV-37 | RT-010, RT-074 | `Inventory.Adjust` is absent from the Cashier and Senior Cashier templates, structurally, not by configuration | P2, P3 |
| RT-078 | Inventory | A transfer conserves organization stock: out and in are paired; batch identity is preserved across a transfer, retaining its batch number, expiry, and cost | MUST | Warehouse Manager | BI-13, IV-39..IV-45, SM-10, SM-77 | RT-056 | Sum of organization on-hand before equals after, for any transfer, including partial dispatch; verified by a property test | P3 |
| RT-079 | Inventory | In-transit stock is a real location belonging to neither end | MUST | Warehouse Manager | IV-44, MS-23, EC-30 | RT-078 | A dispatch places stock in `Transit`; the in-transit report lists it; it is not counted as origin or destination stock, and the destination's stock rises only on receipt | P3 |
| RT-080 | Inventory | Dispatcher and receiver are different people | MUST | Warehouse Manager | IV-42, BI-26 | RT-078 | The receiving employee cannot be the dispatching employee; refusal is at the boundary | P3 |
| RT-081 | Inventory | Cross-store transfer is disabled by configuration in v1 | OUT OF SCOPE | — | IV-40, MS-20, MS-21 | RT-078 | A transfer between two stores is refused; enabling the flag requires all four MS-21 prerequisites, each with an explicit check | P2, P3 |
| RT-082 | Inventory | A reservation affects `Reserved`, never `OnHand` | MUST | Store Manager | IV-46..IV-48 | RT-056 | Reserving 5 of 10 on hand leaves `OnHand = 10` and `Reserved = 5`; available is derived | P3 |
| RT-083 | Inventory | A till cart holds no implicit reservation | MUST | Cashier | IV-49, MS-05 of reservations, UX | RT-082 | A sale in progress creates no reservation; contention is handled by the store's negative-stock policy instead | P3 |
| RT-084 | Inventory | Expired-but-unreleased reservations are reported | MUST | Store Manager | IV-50 | RT-082 | The reservation report lists expired, unreleased holds with age | P5 |
| RT-085 | Inventory | Stock valuation states its cost basis | MUST | Accountant | IV-54..IV-57 | RT-045 | Every valuation output declares standard or batch cost; the report cannot be produced without the basis | P5 |
| RT-436 | Inventory | A stock movement is refused while a count is in progress, and a count is never silently merged with one | MUST | Inventory Manager | EC-04, EC-09 | RT-071 | An adjustment or a return disposition submitted during a count is refused naming the count, and the count's expected figure is unchanged | P3 |
| RT-486 | Inventory | A stock adjustment is a document with a state machine and moves no stock until posted | MUST | Inventory Manager | IV-32, BI-27 | RT-071, RT-074 | An adjustment passes draft, pending approval, approved, posted, reversed; a draft or approved adjustment has changed no balance, and posting writes one movement per line | P3 |
| RT-475 | Inventory | A quantity supplied as input is never negative, and a reduction is expressed by movement type and direction rather than a signed quantity | MUST | Platform Owner | BI-05, IV-34| RT-064 | Every write path rejects `-5` as input with a validation error, never a silent `Math.abs`; a store with `AllowNegative` still reaches a negative balance through a normal sale | P3 |

---

## 4. Batch, expiry, and FEFO

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-086 | Batch | Batch tracking is per variant and required by category policy | MUST | Inventory Manager | BE-01..BE-04 | RT-033 | A category with `ExpiryRequired` refuses a receipt without a batch number and an expiry date | P3 |
| RT-087 | Batch | A batch records lot, manufacturing date, expiry, receipt date, supplier, purchase cost, and quantities | MUST | Procurement Officer | BE-05..BE-09, BE-48, BE-49 | RT-086 | Every batch row carries all eight; `RemainingQuantity` is a projection of its movements | P2, P3 |
| RT-088 | Batch | A dateless batch sorts last under FEFO and is not sellable if the category requires expiry | MUST | Cashier | BE-19, BE-20, EC-29 | RT-086 | A dateless batch is selected only when no dated batch qualifies | P3 |
| RT-089 | Batch | Expiry is end-of-business-date, so same-day stock is sellable | MUST | Cashier | BE-17, EC-63, EC-27 | RT-087 | A batch with today's expiry completes a sale at 23:59; it is unsellable from the following business date | P3 |
| RT-090 | Batch | Expiry blocking is a per-store setting with a default | MUST | Store Manager | BE-16, BE-18 | RT-089 | With blocking enabled, a past-expiry batch is refused from a sale and from a receipt acceptance, each naming the batch | P3 |
| RT-091 | Batch | Near-expiry stock is reported by bucket | MUST | Store Manager | BE-34, NT-03 | RT-089 | The report buckets batches by days-to-expiry with configurable boundaries and a notification fires per bucket | P5 |
| RT-092 | Batch | FEFO applies to every stock issue, not only sales | MUST | Inventory Manager | BE-25..BE-33 | RT-089 | Sales, issues, and transfers all consume earliest-expiry first; a fixture asserts the selection order per issue type | P3 |
| RT-093 | Batch | A FEFO override requires a permission and a reason, and is audited | MUST | Inventory Manager | BE-28 | RT-092 | An override without `Inventory.FEFO.Override` is refused; with it, the reason is mandatory and the event records the batches chosen and skipped | P3 |
| RT-094 | Batch | Quarantined, blocked, and depleted batches are excluded from FEFO | MUST | Inventory Manager | BE-24, EC-26 | RT-092 | A sale whose only qualifying batch is quarantined is refused, naming the reason | P3 |
| RT-095 | Batch | A shortfall pseudo-batch is non-sellable and records `BATCH_SHORTFALL` | MUST | Inventory Manager | BE-29, BE-30, EC-28, OF-38 | RT-066 | The pseudo-batch is never selected by FEFO for a sale; its use raises the event and appears in the shortfall report | P3 |
| RT-096 | Batch | Every disposition writes a movement naming the disposition | MUST | Inventory Manager | BE-36, RR-17 | RT-059 | Sellable, quarantine, damaged, and expired dispositions each produce a movement with the disposition as its reason | P3 |
| RT-097 | Batch | Quarantine stock is valued and aged, not written off on entry | MUST | Store Manager | BE-37, BE-38 | RT-096 | Quarantined stock appears in valuation and in an aged quarantine report; release is an explicit movement | P5 |
| RT-098 | Batch | Expired goods are refused or accepted non-sellable, with a reason | MUST | Procurement Officer | BE-23, RR-18, BE-11 | RT-090 | A receipt of expired stock either fails or lands in a non-sellable location with a recorded reason; it never lands in sellable stock | P3 |
| RT-099 | Batch | A returned batch returns to its original batch record where identifiable | MUST | Store Manager | BE-45..BE-47 | RT-096 | A return with a legible lot number returns to that batch; without one, it enters a fresh batch requiring review | P3 |
| RT-100 | Batch | Serialised stock is named and bounded, not built | COULD | Inventory Manager | BE §9, BE §10 | RT-086 | No serial number entity in v1. The boundary and the future shape are recorded in BE §9 so Phase 2 does not design it in by accident | — |
| RT-101 | Batch | A batch in a quarantine, damaged, or expired location is not sold regardless of FEFO | MUST | Cashier | BE-36, EC-26 | RT-094 | A terminal scan cannot complete a sale from a non-sellable location | P3 |
| RT-437 | Batch | FEFO is resolved at commit, not at selection, so a quarantine arriving after selection causes a re-selection | MUST | Inventory Manager | EC-10 | RT-092, RT-094 | A batch quarantined between selection and commit is not issued; the selection re-runs and the issue takes the next qualifying batch | P3 |
| RT-458 | Batch | Receiving a batch-tracked variant captures batch number, expiry date, and manufacturing date when available; missing data is a warning, not a rejection | MUST | Procurement Officer | BE-10 | RT-086 | A receipt carrying a batch number but no manufacturing date is accepted and raises a warning; it is not refused | P3 |
| RT-459 | Batch | A receipt line creates exactly one batch, and accepting already-expired goods into sellable stock still writes an `EXPIRY` notification at `Error` severity | MUST | Store Manager | BE-12, BE-13 | RT-098 | Two batches of one variant on one receipt line are refused as two lines; with expired goods permitted into sellable stock, the acceptance still writes the `EXPIRY` `Error` | P3 |
| RT-460 | Batch | A receipt records the actual supplier-invoice unit cost, not the PO price, and the variance is recorded and reported through the three-way match | MUST | Procurement Officer | BE-14 | RT-110 | An invoice price differing from the PO price is stored as invoiced and appears in the three-way-match variance; the PO price is never silently adopted | P3 |
| RT-461 | Batch | A receipt writes `PURCHASE_RECEIPT` movements against the specific batch and sets `RemainingQuantity`; near-expiry stock is prioritised by FEFO and reported but never blocked; expiry removes stock only through a reason-coded, permissioned, approval-bearing `EXPIRY` write-off | MUST | Inventory Manager | BE-15, BE-21, BE-22 | RT-087, RT-091, RT-096 | No receipt movement is written to an un-batched balance for a tracked variant; a near-expiry batch is still sellable and appears in the near-expiry report; stock does not disappear because a date passed | P3 |
| RT-462 | Batch | Quarantined stock may be consumed by staff with a reason, is never sold to customers, and the staff consumption is reported | MUST | Store Manager | BE-39 | RT-101 | A staff consumption issue from a quarantine location requires a reason and appears in the report; a customer sale from quarantine is refused | P3 |
| RT-463 | Batch | Valuation policy for a batch-tracked variant is explicit and configured - `WeightedAverage` (default), `FIFO`, or `LastCost`; it is applied at valuation time rather than kept as a running total; and a sale line records the actual cost of the batch it consumed, summed across batches when FEFO splits the sale | MUST | Accountant | BE-41, BE-42, BE-43 | RT-045, RT-085 | With `FIFO` configured, valuation takes value from the oldest batches first; a cached weighted average is never authoritative; a sale split across three batches records the sum of the three portions, and a later revaluation does not change it | P3 |
| RT-469 | Batch | A FEFO override on a large-value sale follows the store's approval policy, as a large discount does | MUST | Store Manager | BE-35 | RT-093, RT-277 | An override consuming the last unit of a high-value batch routes to approval under the store threshold; the requester cannot self-approve | P3 |

---

## 5. Procurement

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-102 | Procurement | A requisition converts to a purchase order without double-ordering | MUST | Procurement Officer | PR-Q01..PR-Q03 | RT-033 | A requisition line tracks converted quantity; converting twice cannot exceed the requisitioned quantity | P3 |
| RT-103 | Procurement | Requisition approval is by total value and configurable per store | MUST | Store Manager | PR-Q02 | RT-102 | A low-value requisition auto-approves; a high-value one needs an approver who is not the requester | P3 |
| RT-104 | Procurement | Only a draft PO is editable; an amendment re-approves | MUST | Procurement Officer | SM-20, PR-Q06| RT-102 | Editing an approved PO is refused; an amendment is a new document or an audited re-approval | P3 |
| RT-105 | Procurement | A PO's receipt state is a projection of its GRNs | MUST | Procurement Officer | PR-Q18, SM-21 | RT-106 | Two partial GRNs sum correctly in the PO's received quantity; the PO never gains quantity directly | P3 |
| RT-106 | Procurement | A goods receipt creates stock only, never a payable; a rejected line may be returned to the supplier without ever entering stock | MUST | Warehouse Manager | PR-Q11..PR-Q21, PR-Q22, SM-25 | RT-063, RT-061 | Receiving a GRN writes stock movements and no payable, in one transaction | P3 |
| RT-107 | Procurement | A GRN is received at most once | MUST | Warehouse Manager | PR-Q20, SM-26 | RT-106 | A second receipt of the same GRN is refused; the correction is a return to supplier or an adjustment, both reason-bearing | P3 |
| RT-108 | Procurement | Over-receipt, under-receipt, and damage are all represented explicitly | MUST | Warehouse Manager | PR-Q15..PR-Q19, EC-36, EC-08 | RT-106 | Over-delivery is accepted with a flag and a tolerance; damage enters a damaged location with a reason | P3 |
| RT-109 | Procurement | A purchase invoice creates the payable, never stock | MUST | Accountant | PR-Q22..PR-Q24, SM-29, BI-38 | RT-106 | An invoice raises a payable and no movement | P3 |
| RT-110 | Procurement | Three-way matching is explicit, configurable, and zero-tolerance by default | MUST | Accountant | PR-Q25..PR-Q28, SM-28, EC-19, EC-43 | RT-105, RT-109 | A quantity, description, tax, or terms mismatch raises `Disputed`; no payable is created; tolerance is configurable and defaulted to zero | P3 |
| RT-111 | Procurement | A disputed invoice is held, not rejected | MUST | Accountant | SM-28 | RT-110 | `Disputed` is a live negotiation state distinct from `Rejected`, and holds the invoice | P3 |
| RT-112 | Procurement | A purchase return is a document that moves stock out and reduces the payable | MUST | Warehouse Manager | PR-Q29..PR-Q33 | RT-106 | A return writes an outbound movement and a payable credit in one transaction | P3 |
| RT-113 | Procurement | Supplier payment is scheduled against a payable and is retryable on failure | MUST | Accountant | PR-Q34..PR-Q37, SM-30, SM-31 | RT-109 | A failed payment holds the invoice and can be retried; a partial payment is a balance, not a state | P3 |
| RT-114 | Procurement | Tax in procurement uses the same rate version as the sale side | MUST | Accountant | PR-Q38..PR-Q40, BI-18 | RT-047 | A tax-rate change between PO and invoice raises a match discrepancy | P3 |
| RT-115 | Procurement | Open PO coverage is reported, so a received-but-uninvoiced PO is visible | MUST | Store Manager | PR-Q09, SM-22 | RT-105 | The report lists ordered, received, and invoiced quantities per line with the expected receipt date | P5 |
| RT-116 | Procurement | Automatic reorder suggestion is named and bounded | COULD | Inventory Manager | PR-Q41 | RT-091 | No automatic ordering in v1. The document records the suggestion inputs and the deliberate boundary | — |
| RT-117 | Procurement | A PO is never deleted | MUST | Accountant | SM-24, PR-Q06a| RT-104 | Delete is not offered; a cancellation is a reasoned state transition | P3 |
| RT-497 | Procurement | A requisition has no effect: no stock, no payable, until it becomes a purchase order | MUST | Procurement Officer | PR-Q04, BI-27 | RT-102, RT-106 | An approved requisition writes no movement and no payable; approving it approves the intent to buy, not a financial commitment | P3 |
| RT-498 | Procurement | A PO line records the agreed description and price as issued values; neither is recalculated | MUST | Procurement Officer | PR-Q05, PR-Q07, BI-08 | RT-106, RT-110 | A PO issued in March still shows what was ordered in September after the product is renamed and the price list changes; the unit price is the negotiated price at receipt and at invoice, never a re-derivation from the current list | P3 |
| RT-499 | Procurement | A PO has no effect on stock or payable until it is `Approved` and then `Ordered` | MUST | Procurement Officer | PR-Q06, BI-40 | RT-104, RT-497 | A `Draft` PO changes no balance and raises no payable; only `Ordered` creates the supplier commitment, and a `Draft` PO is cancelled rather than deleted | P3 |
| RT-500 | Procurement | PO cancellation is refused once a goods receipt exists, and the resolution is return plus cancel | MUST | Store Manager | PR-Q08, BI-41 | RT-117, RT-112 | Cancellation succeeds from `Draft`, `PendingApproval`, `Approved`, and `Ordered` while no goods receipt exists; once one does it is refused, and the route is a purchase return for what was received plus a cancellation for the remainder | P3 |
| RT-501 | Procurement | A PO belongs to one ordering store; cross-store consolidation is out of scope in v1 | OUT OF SCOPE | - | PR-Q10 | RT-106 | One ordering store per PO. Cross-store consolidation is not built and not prevented; which store bears a centrally ordered cost is a recorded open distribution decision, not a v1 requirement | - |

---

## 6. Sales and POS

### 6.1 The completion transaction

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-118 | Sales | A sale exists only after completion; there is no draft, pending, or open sale | MUST | Cashier | SP-01, SP-02, SM-32, SM-33 | — | The `Sale` entity's creation state is `Completed`; no API creates a `Sale` in any other state, and every subsequent change is a compensating document | P2, P3 |
| RT-119 | Sales | The whole sale commits atomically: lines, pricing, tax, payments, stock, receipt | MUST | Cashier | SP-02..SP-05, BI-04, BI-24 | RT-118, RT-061 | A fault injected at any step leaves no partial sale, no stock movement, and no payment record | P3 |
| RT-120 | Sales | Nothing holds a transaction open across a provider or device call | MUST | Cashier | SP-04, PY-36 | RT-119 | A gateway or device call happens before the business transaction opens; no stock lock is held across a network call | P3 |
| RT-121 | Sales | The completion order is authorize, capture, commit, print, each idempotent | MUST | Cashier | SP-03, PY-38, PY-39, EC-05 | RT-119 | Each step retried after a timeout applies once; a commit retry creates no second sale (EC-05) | P3 |
| RT-122 | Sales | A sale is bound to a terminal, a drawer, a shift, and an employee | MUST | Store Manager | SP-06, SP-07, PT-01, BI-39 | RT-119 | Every sale resolves all four; a sale with no shift attribution is impossible by constraint | P2 |
| RT-123 | Sales | A sale carries a correlation id and a client operation id | MUST | Auditor | BI-28, AU-10 | RT-118 | Both are present on the sale, its movements, its payments, and its audit events | P2 |
| RT-455 | Sales | A new cashier's first sale is an ordinary sale gated only by their roles and permissions; there is no production onboarding mode | MUST | Store Manager | EC-83, EM-14 | RT-010, RT-423 | The first sale follows the normal path with the shift open and the float counted, and no training bypass is available in production | P3 |
| RT-453 | Sales | A session change at a shared terminal preserves the cart, and the sale is attributed to whoever completes it | MUST | Cashier | EC-79, SP-11 | RT-141, RT-118 | Two cashiers on one terminal: the second signs in and finds the cart intact, and the completed sale carries the second cashier's id | P3 |
| RT-452 | Sales | A cart survives an interruption in memory and on disk for a configured TTL, and is never silently lost | MUST | Cashier | EC-78, SP-43 | RT-141, RT-223 | A terminal crash mid-sale recovers the cart on restart until the TTL expires; after it the cart is discarded rather than restored stale | P3 |

### 6.2 Lines, quantity, price

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-124 | Sales | A line's price is fixed at add time | MUST | Cashier | SP-24, EC-07 | RT-040 | A mid-cart price change does not alter an existing line; the change applies to the next cart | P3 |
| RT-125 | Sales | Scanning is the keyboard path; a manual entry is equivalent | MUST | Cashier | SP-08..SP-12, UX-01 | RT-023 | Typing a barcode produces the same result as scanning it | P4 |
| RT-126 | Sales | An unknown barcode preserves the cart and offers a route forward | MUST | Cashier | SP-09, UX-11 | RT-125 | The cart is intact after an unknown scan; the message names the barcode and offers price entry or product creation | P4 |
| RT-127 | Sales | A weighted line uses the scale, or a manual weight with a reason | MUST | Cashier | SP-18, PR-28, EC-70 | RT-038 | A manual weight above the threshold requires a reason and is reported | P3 |
| RT-128 | Sales | Quantity and variant substitution are edits on the line | MUST | Cashier | SP-13..SP-23, UX-12 | RT-124 | Substituting a variant keeps the line's position and the cart's total recalculates deterministically | P4 |
| RT-129 | Sales | A discount at the till is permissioned and bounded | MUST | Cashier | SP-27..SP-32 | RT-049, RT-051 | A discount without `Discount.Apply` is refused; a large one routes to approval and is not applied by the requester | P3 |
| RT-130 | Sales | Tax at the till uses the store's mode and the effective rate version; gross x rate is forbidden | MUST | Cashier | SP-33..SP-38, BI-18 | RT-046 | Inclusive and exclusive fixtures each produce the documented tax total; a customer exempt from tax is handled mode-specifically (PR-40) | P3 |
| RT-131 | Sales | A line or document total may never go below zero | MUST | Cashier | PR-42, SP-42 | RT-129 | Any combination producing a negative total is refused before commit | P3 |

### 6.3 Payment at the till, voids, receipts

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-132 | Payment | A payment records the amount applied, never the amount handed over | MUST | Cashier | SP-39, PY-02, CD-07, EC-12 | RT-121 | A £50 tender for a £13.40 sale records a £13.40 payment and a £36.60 change disbursement | P3 |
| RT-133 | Payment | Split tender is permitted and must sum to the total due | MUST | Cashier | SP-40, PY-16 | RT-132 | Two tenders summing to the total complete; a sum short of the total does not complete (PY-17) | P3 |
| RT-134 | Payment | An underpaid sale becomes a credit sale or is refused | MUST | Cashier | SP-41, PY-18, CU-20 | RT-133 | The shortfall goes to the customer's account with a ledger entry and a zero-value payment (PY-01); without an account it is refused | P3 |
| RT-135 | Payment | Change is a drawer disbursement and is recorded | MUST | Cashier | CD-07, CD-18, SP-39 | RT-132 | The change appears in the cash-out report; a shift's expected count is computable from the sales alone | P3 |
| RT-136 | Payment | A timeout is not a decline and never completes a sale | MUST | Cashier | PY-11, PY-41, SP-43, UX-18 | RT-121 | A gateway timeout leaves the payment `Pending` with backoff; the sale does not complete; the cart survives | P3, P4 |
| RT-137 | Payment | A declined payment keeps the cart and the tenders taken | MUST | Cashier | SP-43, UX-16, PY-14 | RT-136 | After a decline the cart and all prior tenders are intact and resumable | P4 |
| RT-138 | Sales | A void is only possible before a receipt prints, and needs a reason | MUST | Store Manager | SP-50..SP-56, SM-34, BI-25 | RT-118 | A void after the print is refused; a void before it reverses stock, reverses payment if voidable, and is audited | P3 |
| RT-139 | Sales | A void returns the stock via a compensating movement | MUST | Inventory Manager | SP-30, EC-35, BI-24 | RT-138 | The stock returns; no movement is deleted or edited | P3 |
| RT-140 | Sales | A print failure is reported and queued for reprint, never swallowed | MUST | Cashier | SP-57..SP-60, UX-22 | RT-121 | A printer fault produces a visible failure and a queued reprint; the sale is not lost | P3, P4 |
| RT-141 | Sales | A suspended sale is a persisted cart, not a sale, and reserves nothing | MUST | Cashier | SP-44..SP-49, IV-49, SM-32 | RT-083 | A suspended sale has no number, no ledger effect, and creates no reservation; resuming does not re-reserve | P3 |
| RT-142 | Sales | A suspended sale is named and aged in the held list | MUST | Store Manager | SP-45, UX-23, UX-24 | RT-141 | Each held cart shows identifier, item count, value, and age | P4 |
| RT-143 | Sales | A no-sale document records drawer activity with no transaction | MUST | Cashier | SP-20, SM-37 | RT-138 | A no-sale is a drawer record, not a `Sale`, and has no sale number | P3 |
| RT-435 | Sales | A capture and a void of the same sale are mutually exclusive; one wins and the other is refused with a named reason | MUST | Store Manager | EC-03 | RT-265, RT-138 | A capture racing a void yields one committed document and one refusal naming which side won | P3 |
| RT-502 | Sales | Cash rounding is configured, never hard-coded, and recorded as an adjustment rather than smeared into prices | MUST | Store Manager | SP-25, SP-26 | RT-132, RT-135 | Rounding is off by default and enabled per store per currency; where on, a `RoundingAdjustment` appears on the sale, the receipt, and till variance analysis, and no line price is altered to absorb it. The mode vocabulary is organization-defined and a store selects from it | P3 |

---

## 7. Returns and refunds

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-144 | Returns | A return and a refund are separate, linked documents | MUST | Cashier | RR-01, SM-38, PY-21, RR-36| RT-118 | A return with no refund is valid; a refund with no return is valid; neither nests the other | P3 |
| RT-145 | Returns | A refund is bounded per line and per sale, checked atomically; a return of an item bought at a different price is refunded at what was paid, per line | MUST | Cashier | RR-02..RR-07, BI-10, PY-22, EC-02, PY-24 | RT-144 | Two concurrent refunds of one line yield one success and one refusal; the per-sale total bound holds (EC-02) | P3 |
| RT-146 | Returns | A settled amount is stored at completion and sums exactly to the total due | MUST | Cashier | BI-10, SP-11, RR-03 | RT-134 | Every line's settled amount sums exactly to the total due; a partial tender reduces only the corresponding line's settled amount | P3 |
| RT-147 | Returns | A part-paid line refunds at the settled amount, never the list price | MUST | Cashier | RR-02, EC, EC-17 | RT-146 | A part-paid line's refundable amount is its settled amount, not its gross | P3 |
| RT-148 | Returns | A return cannot exceed the eligible sold quantity | MUST | Cashier | RR-08..RR-13, BI-06, BI-16 | RT-144 | A return above the sold quantity is refused, naming the eligible remainder | P3 |
| RT-149 | Returns | A return cannot be processed twice for the same quantity | MUST | Cashier | RR-14..RR-16, BI-07, BI-28 | RT-148 | Replaying a return request with the same operation id applies once | P3 |
| RT-150 | Returns | Return eligibility is windowed per store and per category | MUST | Store Manager| RR-08, EC-66, SM-42| RT-148 | A return outside the window is rejected with a reason the customer can be told (SM-42) | P3 |
| RT-151 | Returns | Disposition is mandatory and never implicit | MUST | Cashier| RR-17..RR-21, BE-36, UX-30, BI-17 | RT-148 | No disposition cannot be saved; the screen states each option's stock effect (UX-30) | P4 |
| RT-152 | Returns | A disposition beyond the returned quantity never lands in sellable stock | MUST | Inventory Manager | EC-36, RR-31 | RT-151 | Excess returned goods are refused or moved to a non-sellable location with a reason | P3 |
| RT-153 | Returns | `Dispositioned` requires that stock actually moved | MUST | Auditor | SM-43, RR-17 | RT-151 | A return marked dispositioned with no corresponding movement fails the transition-log verification | P3 |
| RT-154 | Refunds | A refund to a card goes to the provider with its own lifecycle | MUST | Cashier | RR-22..RR-25, PY-25, EC-15, PY-21 | RT-145 | A provider failure is a `Failed` refund that is queued, retried, and notified; it is not a successful refund | P3 |
| RT-155 | Refunds | A pending refund holds its amount against the bound | MUST | Cashier | RR-24, PY-23, SM-40 | RT-145 | A second refund of the same money is refused while the first is pending | P3 |
| RT-156 | Refunds | A cash refund is a drawer disbursement | MUST | Cashier | RR-27, CD-27, PY-27 | RT-135 | The cash refund appears in the drawer reconciliation, so a close-out count is not mysteriously short | P3 |
| RT-157 | Returns | A refund without a return requires large-refund approval and a reason | MUST | Store Manager | RR-35, PY-26 | RT-144 | A goodwill refund routes to approval, needs a reason, and creates no stock | P3 |
| RT-158 | Returns | A store-credit refund returns to the balance, not to cash, by default | MUST | Cashier | RR-26, PY-28 | RT-145 | The customer's credit balance increases; a refund-to-cash exception needs a reason and is reported | P3 |
| RT-159 | Returns | An exchange is a return plus a sale, with a bounded price difference | MUST | Cashier | RR-30..RR-34 | RT-144, RT-118 | The exchange produces a linked return and a linked sale; the difference is a bounded refund, never an untracked credit | P3 |
| RT-160 | Returns | Loyalty accrual reverses on a return | MUST | Store Manager | RR-38..RR-41 | RT-151 | Points earned on the returned quantity are reversed in the same transaction as the disposition | P3 |
| RT-161 | Returns | Tax on a return is computed on what was actually paid | MUST | Accountant | RR-42..RR-44, BI-18 | RT-147 | The refunded tax equals the tax originally applied to the returned quantity | P3 |
| RT-476 | Returns | A return with no sale-line reference is permitted only as a manager-approved goodwill return, requires `Return.Approve` and a reason, creates no stock movement, and is cash-only | MUST | Store Manager | BI-16, RR-09 | RT-148 | An unsourced return is refused without the approval and a reason; when approved it moves no stock and produces no refundable credit | P3 |
| RT-162 | Returns | Store credit redemption is bounded atomically | MUST | Cashier | RR-28, PY-31, BI-19 | RT-158 | Two concurrent redemptions of the same balance yield one success | P3 |
| RT-522 | Returns | Store credit expiry is per store, and expiry is a documented, reported event rather than a silent deletion | MUST | Store Manager | RR-29, PY-31 | RT-165, RT-162 | Expiring a credit balance writes a dated expiry and a report entry and leaves the balance history intact; no path removes an expired balance from the record | P3, P5 |
| RT-523 | Returns | Goodwill movements are reported by actor, value, and reason, with concentration analysis | MUST | Store Manager | RR-37, SP-56, IV-36, BI-25 | RT-157, RT-476, RT-242 | The report flags an actor or reason carrying an unusual share of goodwill value on the same basis as cash adjustments; goodwill is a legitimate tool and concentration is what separates it from misuse | P5 |

---

## 8. Customers, credit, and loyalty

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-163 | Customer | A walk-in uses an organization-level customer record, never a null customer | MUST | Cashier | CU-01..CU-03 | RT-118 | A sale with no identified customer resolves to the walk-in record; `CustomerId` is never null on a `Sale` | P2, P3 |
| RT-164 | Customer | Customer identity is matched, never merged by name | MUST | Store Manager | CU-04..CU-08 | RT-163 | Two customers with the same name remain distinct; a merge is an explicit, audited action | P3 |
| RT-165 | Customer | A customer balance is a ledger projection, never a stored mutable field | MUST | Accountant | CU-11, SM-44 | — | The balance equals the sum of its ledger entries at all times; a rebuild reproduces it | P2, P3 |
| RT-166 | Customer | Credit is authorized by a per-customer limit and a per-transaction ceiling | MUST | Store Manager | CU-13..CU-23 | RT-165, RT-134 | A sale above the limit is refused or routed to an approved override; an override needs `Credit.Limit.Override` and a reason | P3 |
| RT-167 | Customer | A customer with an outstanding balance cannot be deleted | MUST | Store Manager | EC-38 | RT-165 | Deletion is refused while the balance is non-zero; the customer is deactivated instead | P3 |
| RT-168 | Customer | A customer statement is the ledger, with a running balance, the limit, the available credit, and a scope | MUST | Accountant | CU-22, CU-23, RP-18 | RT-165 | The statement's closing balance equals the account balance and its limit and available credit match the account; the scope is stated in the output. `CU-23` states no due date, and `CON-06` records that v1 has none (corrected in the C-06 review) | P3, P5 |
| RT-169 | Customer | A payment against a customer balance is a ledger entry, not a balance edit | MUST | Accountant | CU-19..CU-21 | RT-165 | Recording a payment creates a credit entry; the balance follows | P3 |
| RT-170 | Loyalty | Loyalty points accrue on a configured basis and are a ledger projection; points are awarded on the line, in the completion transaction | MUST | Store Manager | CU-24..CU-32 | RT-118 | Points earned, redeemed, and outstanding are each derivable; the basis is stated on every report (RP-08) | P3 |
| RT-171 | Loyalty | Points redemption is bounded by the balance, atomically | MUST | Cashier | CU-31, BI-19 | RT-170 | A redemption above the balance is refused; two concurrent redemptions yield one success | P3 |
| RT-172 | Loyalty | A manual loyalty adjustment is approvaled and audited | MUST | Store Manager | CU-29, AP-01 | RT-170 | An adjustment needs approval by a different employee and a reason; it is in the notification vocabulary (NT-03) | P3 |
| RT-173 | Customer | A customer statement is a customer-facing document with defined content | MUST | Store Manager | CU-39, CU-40 | RT-168 | The document carries the store's required fields and is reproducible from the ledger | P3 |
| RT-174 | Customer | Customer PII is redacted in every derived surface | MUST | Store Manager | CU-33..CU-38, AU-09 | RT-164 | Contact details appear masked in exports, reports, notifications, and audit details; the full record requires a specific permission | P3 |
| RT-175 | Customer | Customer reporting is store-scoped by default | MUST | Store Manager | MS-28, CU-08 | RT-013 | A cross-store customer report requires `Report.OrganizationWide` and is marked | P5 |
| RT-176 | Customer | Loyalty accrual basis is a configurable business decision | COULD | Store Manager | CU-24, RP-08 | RT-170 | The three bases are supported by the model; the store's choice is configuration, and the decided v1 basis is net of discount excluding tax (D-11) | — |
| RT-439 | Customer | Exceeding a credit limit at the till refuses the sale or routes it to an approved override | MUST | Store Manager | EC-18 | RT-418, RT-134 | A limit-breaching sale is refused naming the limit, or raises an approval request and completes only on approval | P3 |
| RT-450 | Customer | No credit due date, dunning, or `CreditOverdue` in v1; a balance is governed only by the credit-limit rules | OUT OF SCOPE | - | EC-65, NT-37 | RT-165 | No due-date field, no automatic standing change, and no overdue state exist; a credit sale carries a balance and a limit only. Corrected in the C-06 review: `CU-23` states no due date and the Phase 1 conclusion `CON-06` records that v1 has none, so the earlier `RT-168` wording was wrong. `D-05` is the owner decision and `CON-06` is a review conclusion, not a source rule, so neither appears in the citation column | - |
| RT-511 | Customer | `OnHold` warns and notifies; it never refuses service, and the hard block is `CreditBlocked` | MUST | Store Manager | CU-09, SM-45a | RT-419 | A held customer is served, carries a visible note, and triggers a manager notification; only `CreditBlocked` refuses, and only for taking goods on account | P3, P4 |
| RT-512 | Customer | A customer is never deleted; `Closed` is a status and the history stays renderable | MUST | Store Manager | CU-10, BI-40 | RT-167, RT-346 | No delete path exists on a customer at any status, including one with a zero balance; statements, receipts, and tax history from any year still resolve the customer's name | P2, P3 |
| RT-513 | Customer | Available credit is `CreditLimit - Balance`, derived, over a balance that is a rebuildable cache | MUST | Accountant | CU-12, IV-09 | RT-165, RT-168 | The available figure is computed, never stored; a rebuild from the ledger entries reproduces the balance and therefore the available credit, and the statement's figures match the account | P2, P3 |

---

## 9. Suppliers

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-177 | Supplier | A supplier is organization-global; its ledger entries retain store scope | MUST | Accountant | SU-01..SU-02, org §8, EC-60 | RT-001 | A supplier created in Store A is visible in Store B; an entry raised in Store A is reported under Store A | P2, P3 |
| RT-178 | Supplier | A supplier is deactivated, never deleted, and never deleted with purchase history | MUST | Accountant | SU-03..SU-06, EC-38, BI-40 | RT-177 | Deletion is refused; deactivation stops new orders but preserves history and balances | P3 |
| RT-179 | Supplier | The supplier payable is a ledger projection; an early-payment discount is recorded when taken | MUST | Accountant | SU-09..SU-15, SM-76 | RT-177 | The payable equals the sum of its ledger entries; a rebuild reproduces it | P2, P3 |
| RT-180 | Supplier | A supplier code is unique per organization and immutable once referenced | MUST | Procurement Officer | SU-06 | RT-177 | A duplicate code is refused by constraint; editing a referenced code is refused | P2, P3 |
| RT-181 | Supplier | Supplier contacts are separate entities | MUST | Procurement Officer | SU-07, SU-08 | RT-177 | A supplier has many contacts; a contact is not an employee and grants no system access | P3 |
| RT-182 | Supplier | Supplier pricing and pack size are per supplier product | MUST | Procurement Officer | SU-16..SU-19 | RT-032 | A supplier's price and pack size are recorded on the supplier product, not on the variant's standard cost | P3 |
| RT-183 | Supplier | Supplier performance is reported from real receiving data | SHOULD | Procurement Officer | SU-16..SU-19 | RT-108 | The report derives on-time rate, fill rate, and quality from GRNs; it is not manually entered | P5 |
| RT-184 | Supplier | Supplier-facing documents carry the store's required content | MUST | Procurement Officer | SU-20..SU-22 | RT-177 | A purchase order to a supplier is printable in the store's format; the fields are specified | P4 |
| RT-185 | Supplier | Supplier data is permission-scoped and PII-redacted in reports | MUST | Accountant | SU-23..SU-26, AU-09 | RT-179 | Contact details are masked without `Supplier.Contact.View`; a report export is audited | P3 |
| RT-186 | Supplier | A statement to a supplier is the ledger with a running balance and due date | MUST | Accountant | SU-12 | RT-179 | The statement's closing balance equals the payable | P5 |

---

## 10. Employees, attendance, and leave

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-187 | Employee | An employee and a login account are separate | MUST | HR Manager | EM-01..EM-04 | RT-017 | One employee may hold credentials in several places but has one identity; an account without an employee is impossible | P2 |
| RT-188 | Employee | An employee's PIN is unique within the organization | MUST | HR Manager | EC-40 | RT-187 | A duplicate PIN is refused by constraint | P2 |
| RT-189 | Employee | An active employee may sign in and transact; the status gates both | MUST | Store Manager| EM-08..EM-11, SM-47| RT-187 | A suspended or terminated employee cannot sign in; a suspended employee's live sessions are revoked immediately (SM-47) | P3 |
| RT-190 | Employee | A terminated employee is retained for audit, not deleted | MUST | HR Manager | EM-12, SM-48, BI-40 | RT-189 | The record persists and remains referenced by their historical transactions | P2, P3 |
| RT-191 | Employee | Store access is dates-bounded where relevant | MUST | HR Manager | EM-12..EM-16 | RT-002 | An access grant with an end date stops applying at that date; an open-ended grant applies until revoked | P3 |
| RT-192 | Employee | A rostered shift schedules hours and is not a cash shift | MUST | Store Manager | EM-17..EM-20, CD-02 | RT-187 | The two are separate entities with distinct UI names; neither implies the other | P2, P4 |
| RT-193 | Employee | Attendance is recorded from RFID, from manual entry, or from correction | MUST | Store Manager | EM-21..EM-27 | RT-187 | Each attendance record states its source; a manual correction requires a reason | P3 |
| RT-194 | Employee | A manual attendance correction requires approval by a different person | MUST | HR Manager | EM-24, SEP-01, BI-26 | RT-193 | The role may hold both permissions; the correction is rejected at the action boundary (RT-018) | P3 |
| RT-195 | Employee | Attendance is not payroll | OUT OF SCOPE | — | EM-32 | — | No payroll calculation, no salary, no payslip in v1; attendance data is exportable for a payroll system | — |
| RT-196 | Employee | Leave is tracked with a reason and an approval | SHOULD | HR Manager | EM-28..EM-31 | RT-187 | A leave request needs an approver who is not the requester and a reason; it is visible in the roster | P3 |
| RT-197 | Employee | A lockout is a login-attempt record, not an employee state | MUST | Super Administrator | SM-49, RF-19 | RT-189 | A credential throttle never disables the employee's business record | P3 |
| RT-198 | Employee | A reactivation is audited and reason-bearing | MUST | HR Manager | SM-50 | RT-189 | Every `Suspended → Active` transition writes an audit event with a reason | P3 |
| RT-514 | Employee | No sensitive personal data in v1: attendance and leave are the only non-operational personal data | OUT OF SCOPE | - | EM-05 | RT-174 | No medical, disability, bank, national identity, document photograph, or background-check field exists on any entity; every field a person was not asked to expect is absent from the schema | - |
| RT-515 | Employee | `Department` and `Position` are descriptive and grant nothing | MUST | Super Administrator | EM-06, AC-01 | RT-010 | An employee with `Position` = Manager and no role assignment holds no permissions beyond the employee baseline; a permission is granted by a role and never inferred from a job title | P2, P3 |
| RT-516 | Employee | Date of birth serves age-restricted sales only, and the pass/fail is recorded rather than the value | MUST | Cashier | EM-07 | RT-189 | The till compares the date of birth against the restriction and stores the outcome on the sale; the value is not displayed at the till and is readable only behind a specific permission | P3, P4 |

---

## 11. RFID

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-199 | RFID | RFID asserts identity and never determines authorization | MUST | Super Administrator | RF-01..RF-03, BI-33, overview principle 11, SM-87 | RT-010 | A valid read with no permission is refused; a read never grants, elevates, or bypasses a permission | — |
| RT-200 | RFID | The chain is read, then identity, then permission, then action; a tag never satisfies an approval | MUST | Platform Owner | RF-20..RF-24, overview §14 | RT-199 | Every RFID-authenticated action resolves a permission check after the identity, server-side | P3 |
| RT-201 | RFID | A read never moves stock | MUST | Inventory Manager | RF-29..RF-32, BI-32, RF-10| RT-199 | An RFID read produces no inventory movement; stock moves only from a committed document | P3 |
| RT-202 | RFID | A tag and a credential are different entities | MUST | Super Administrator | RF-04..RF-08, SM-85 | RT-199 | A product tag and an employee credential share an identifier space but not an entity | P2 |
| RT-203 | RFID | A tag type declares what it carries | MUST | Super Administrator | RF-07, RF-08 | RT-202 | A product tag resolves to a variant; an employee tag resolves to a credential; an unknown type resolves to nothing | P3 |
| RT-204 | RFID | A read event is immutable and records the raw read | MUST | Auditor | RF-14..RF-19, SM-62 | RT-201 | Every read is stored verbatim and idempotent on repeat; a read cannot be edited or deleted | P3 |
| RT-205 | RFID | Anti-duplication is a debounce, not a de-duplication of truth | MUST | Store Manager | RF-15..RF-19 | RT-204 | A repeated read within the window is recorded once; a genuine second event outside the window is recorded | P3 |
| RT-206 | RFID | A reader's health and connectivity are monitored with last-seen | MUST | Technician | RF-33..RF-38, HD-16 | RT-204 | An unreachable reader raises a fault event within a configured window and appears on a standing report | P5 |
| RT-207 | RFID | A reader offline is a degraded feature, not a till failure | MUST | Store Manager | EC-69, HD-19 | RT-206 | Manual badge entry or password entry remains available; the till completes sales | P3 |
| RT-208 | RFID | The credential lifecycle covers registration, replacement, loss, disablement, and duplicate detection | MUST | HR Manager | RF-25..RF-28 | RT-202 | A lost card is disabled and audited; its replacement is a new credential; a duplicate card is refused | P3 |
| RT-209 | RFID | A stored-value or loyalty tag is never an identity | MUST | Super Administrator | RF-08, PY-34 | RT-202 | A gift card or loyalty tag cannot authenticate or authorize anything | P3 |
| RT-210 | RFID | Offline reader events are queued and synchronised idempotently | MUST | Technician | RF-33..RF-38, BI-29 | RT-204 | A reader that comes back online replays its events with the same operation id and applies each once | P3 |
| RT-519 | RFID | A reader's mode is configured and determines what a read means | MUST | Technician | RF-09 | RT-199, RT-212 | The mode set is closed: `Identify` yields a session requiring a credential confirmation, `Clock` an attendance event, `Door` a logged request, `Inventory` a stock identification and no movement, `IdentifyAndClock` both. No mode yields a business operation without a permission check | P2, P3 |
| RT-520 | RFID | A door open is a request; the controller decides and SmartStore records only the read | MUST | Super Administrator | RF-11 | RT-204 | SmartStore records that tag X was read at door Y at 08:03 and reports it; whether the door opened is the controller's decision and is never asserted by SmartStore, because a system that decides and records its own decision can only report what it already decided | P3 |
| RT-521 | RFID | Reader events store both the device's observation timestamp and the server's receipt timestamp | MUST | Auditor | RF-13, overview 3.3 | RT-204, RT-234 | Both are persisted on every read; the device timestamp is authoritative for what the operator saw, the server timestamp for when the system received it, and neither substitutes for the other | P3 |

---

## 12. Hardware

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-211 | Hardware | No vendor SDK or protocol appears in business logic | MUST | Platform Owner | HD-01, HD-02, PY-08 | — | A build check fails on a vendor SDK import outside the hardware adapter layer | P3, P5 |
| RT-212 | Hardware | A device is an entity with a type, identifier, location, connection, status, capabilities, and firmware | MUST | Technician | HD-03..HD-08, HD-26..HD-29 | — | Every device row carries all eight; a device is provisioned before it can serve a capability | P2 |
| RT-213 | Hardware | Capabilities are declared, not inferred | MUST | Technician | HD-09..HD-12 | RT-212 | A terminal offers only capabilities a connected device declares; an undeclared capability is unavailable | P3 |
| RT-214 | Hardware | A device failure degrades its feature, not the transaction | MUST | Cashier | HD-17..HD-22, EC-69, UX-61, SM-61 | RT-213 | A failed scanner leaves keyboard entry; a failed printer leaves a queued reprint; neither blocks the sale | P3 |
| RT-215 | Hardware | A device call is never inside a business transaction | MUST | Platform Owner | HD-17, BI-04, SP-04 | RT-119 | Device and provider calls happen before the transaction opens | P3 |
| RT-216 | Hardware | A device event records the terminal, store, and correlation | MUST | Auditor | HD-23..HD-25, AU-10 | RT-212 | Every device event resolves to a terminal and a store and correlates to the operation that triggered it | P2 |
| RT-217 | Hardware | Firmware is versioned, and an update is permissioned and audited | MUST | Technician | HD-26..HD-29 | RT-212 | An update records the from and to version, the actor, and the outcome; a failed update does not brick the device silently | P3 |
| RT-218 | Hardware | Device administration is a technician concern, separated from store operations; Device.Disable is a high-impact operation and is a SHOULD with approval for a device attached to an active till | SHOULD | Technician | HD-30..HD-34 | RT-212 | A store manager can view a device's status but provisioning and firmware are technician permissions | P3 |
| RT-219 | Hardware | A customer display is a capability, not a dependency | COULD | Store Manager | HD-03 | RT-213 | The till completes without a display; the display is optional | — |
| RT-477 | Hardware | Device identity is authenticated: the server accepts a device's events only after the device is registered and authenticated, and an unregistered or unauthenticated device's events are rejected and recorded as such | MUST | Technician | BI-35, RF-12, HD-14| RT-212, RT-216 | An event from an unregistered device is rejected and appears in the device event log as `Rejected`; the device is recorded on every event it produces | P3 |
| RT-220 | Hardware | ESP32 and other microcontrollers use the same abstraction | MUST | Technician | HD-01, HD-06, overview principle 12 | RT-211 | An ESP32 device is a `Device` with a declared capability set; replacing it does not touch business logic | P3 |
| RT-454 | Hardware | A replaced device keeps its history, and its replacement is a new provisioned device | MUST | Technician | EC-82, HD-18 | RT-212, RT-216 | A smashed terminal's event history stays queryable against the old device, and the new terminal is provisioned before it serves a capability | P3 |
| RT-517 | Hardware | A device connection is configuration, not architecture | MUST | Technician | HD-13, HD-02 | RT-211, RT-212 | Swapping a USB scanner for a network scanner is a `DeviceConnection` row change with no code change and no business-logic awareness; no business module names a transport | P2, P3 |
| RT-518 | Hardware | A device credential cannot assert an employee identity | MUST | Super Administrator | HD-15, BI-33 | RT-477, RT-017 | A device reporting "I am the front scale" can never present itself as employee 42; device credentials are not readable in configuration a user can open, and the two credential types are not interchangeable at any endpoint | P2, P3 |

---

## 13. Offline POS and synchronisation

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-221 | Offline | The till completes a sale with no server, within a declared cache | MUST | Cashier | OF-01..OF-06, EC-73, SP-61| RT-118 | With the network down, a cached variant scans and completes a sale; the sale is durable locally before acknowledgement | P3, P4 |
| RT-222 | Offline | An offline terminal requires `AllowNegative` | MUST | Store Manager | BI-36, OF-04, overview §3.2, OF-38, SP-63| RT-064 | An offline terminal on a `BlockNegative` store cannot trade; the terminal refuses to go offline | P3 |
| RT-223 | Offline | The offline queue is durable across a restart; a SyncSession records a sync run and a SyncConflict records an individual item's disagreement | MUST | Cashier | OF-17..OF-21, OF-45 | RT-221 | A queued sale survives a terminal restart and is applied on reconnect | P3, P4 |
| RT-224 | Offline | Synchronisation is idempotent per client operation id | MUST | Platform Owner | OF-22, BI-28, BI-29, EC-50 | RT-223 | A replayed sale applies once; a duplicate sync request creates no second sale | P3 |
| RT-225 | Offline | The server is authoritative for price, permission, and stock | MUST | Platform Owner | OF-29..OF-37, EC-47, EC-48, EC-53, SP-62| RT-224 | An offline price is honoured as an adjustment; an offline permission decision is re-checked; an offline sale of a deactivated variant is rejected | P3 |
| RT-226 | Offline | A sync outcome is one of applied, adjusted, or rejected, and each is visible to staff | MUST | Cashier | OF-35, OF-36, SM-65, UX-65, SM-64a, BI-31, SP-65| RT-225 | Every queued sale's outcome is shown on reconnect; an adjustment shows what changed | P4 |
| RT-227 | Offline | An offline cache is closed, signed, and encrypted | MUST | Super Administrator | OF-07..OF-11, CU-35, OF-41 | RT-221 | The cache file carries a signature; a tampered cache is refused; it excludes cost, bank, audit, and unmasked PII | P3 |
| RT-228 | Offline | A stale cache is refused or flagged at its declared limit | MUST | Store Manager | OF-13, EC-52 | RT-227 | Beyond the declared staleness the sync is refused or accepted with the staleness flagged | P3 |
| RT-229 | Offline | Offline discounts are a narrow, configured concession | MUST | Store Manager | OF-12..OF-16 | RT-222 | Only configured promotions validate offline; anything else is priced online-only or applied with an adjustment | P3 |
| RT-230 | Offline | Offline card payment goes to the acquirer, not to SmartStore | MUST | Cashier | OF-05, PY-47, EC-71, PY-48 | RT-136 | The terminal authorises with the acquirer locally; the transaction syncs afterwards; reconciliation is a separate population (PY-48) | P3 |
| RT-231 | Offline | Queue depth and a dead-lettered item are reported; offline retries are bounded and a dead-lettered item needs a person | MUST | Store Manager | OF-23, OF-26, NT-03, SM-64 | RT-223 | A dead-lettered sync item is visible on a standing report and needs a person; retries are bounded | P5 |
| RT-232 | Offline | An offline terminal's state is announced to staff | MUST | Cashier | OF-46..OF-50, UX-63, SP-61| RT-221 | Offline mode is announced once, clearly, persistently, and explains what changes for cards, stock, and prices | P4 |
| RT-233 | Offline | Loyalty cannot be evaluated offline | OUT OF SCOPE | — | OF-06 | — | No offline loyalty accrual or redemption in v1; a loyalty tender is online-only | — |
| RT-234 | Offline | Server time governs all business logic | MUST | Platform Owner | EC-68, OF-25, EC-67, EC-51 | RT-119 | A terminal with a wrong clock cannot change a business date or a timestamp; the discrepancy is retained | P3 |
| RT-447 | Offline | An offline sale that duplicates an online sale is applied and reported, never auto-merged | MUST | Platform Owner | EC-49, OF-31 | RT-224, RT-225 | Two sales of the same basket both exist; the duplicate is listed for staff resolution and no automatic merge or netting occurs | P3 |
| RT-470 | Offline | Synchronisation is per store and per terminal, in business-date order and then queue order within a business date | MUST | Platform Owner | OF-24 | RT-224 | Two terminals queued for the same business date apply in queue order; a later business date never overtakes an earlier one | P3 |
| RT-471 | Offline | Synchronisation is triggered on connectivity restoration, on a configured interval, on a manual request, and at shift close, never on a timer alone; an offline window exceeding the terminal's configured expiry stops the terminal selling and raises a high-severity notification | MUST | Store Manager | OF-27, OF-28 | RT-223, RT-232 | A store closing with an unsynced queue syncs when connectivity returns; a terminal past its offline window refuses a sale and raises the high-severity notification | P3 |
| RT-472 | Offline | FEFO offline is advisory: the terminal may suggest the soonest-expiring batch, the sale line records the batch the server later allocated, and no offline FEFO override is possible; a near-expiry batch left behind is reported | MUST | Inventory Manager | OF-40 | RT-092, RT-225 | The server's allocation overrides the terminal's suggestion on the recorded line; a near-expiry batch left unsold appears in a report | P3 |
| RT-473 | Offline | The local ledger is as sensitive as the server's: it is encrypted at rest and its key is bound to the registered device credential | MUST | Super Administrator | OF-41 | RT-227 | The local store is unreadable without the registered device credential; the key does not transfer to an unregistered device | P3 |
| RT-474 | Offline | No offline data is written to shared or removable media by the POS, and diagnostics leave the terminal only through a deliberate, audited export | MUST | Platform Owner | OF-44 | RT-313 | The POS never writes offline data to removable media; a diagnostic export is an explicit audited action with a recorded destination | P3 |

---

## 14. Cash management

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-235 | Cash | A cash shift has a counted opening float recorded as a cash transaction | MUST | Cashier | CD-10..CD-14, org §7 | RT-005 | Opening a shift writes an `OpeningFloat` cash-in; the amount is a ledger row, not a field (CD-11) | P3 |
| RT-236 | Cash | One open shift per drawer, by constraint | MUST | Cashier | CD-03, EC-06, CD-01| RT-235 | Two concurrent opens of one drawer yield one success; the constraint, not a check, enforces it | P2, P3 |
| RT-237 | Cash | The expected drawer amount is a projection over documents | MUST | Store Manager | CD-06..CD-09, CD-04| RT-132 | The expected amount is recomputable from the shift's documents alone; a rebuild reproduces it (CD-08) | P3 |
| RT-238 | Cash | Only cash methods appear in the drawer | MUST | Cashier | CD-09 | RT-132 | Card, credit, and gift tenders do not appear in the expected count | P3 |
| RT-239 | Cash | Change is a recorded drawer disbursement | MUST | Cashier | CD-18, SP-39 | RT-135 | The change appears in the cash-out report; the expected count is computable from the sales | P3 |
| RT-240 | Cash | A cash movement beyond a threshold needs a different approver | MUST | Store Manager | CD-15, BI-26, AP-01 | RT-235 | A pay-out or adjustment beyond the store threshold routes to approval; the requester cannot approve | P3 |
| RT-241 | Cash | A pay-out and an adjustment always require a reason code | MUST | Cashier | CD-16, BI-25 | RT-240 | Both are refused without a reason from the configured list | P3 |
| RT-242 | Cash | Cash adjustments are reported with concentration analysis | MUST | Store Manager | CD-17 | RT-241 | The report flags an actor or reason carrying an unusual share of adjustment value | P5 |
| RT-243 | Cash | The count is blind; expected is revealed only after submission | MUST | Cashier | CD-21, CD-31, UX-33 | RT-237 | The counting screen withholds expected until submission | P4 |
| RT-244 | Cash | Variance is derived, and never adjusted away | MUST | Store Manager | CD-22..CD-26, EC-16 | RT-237 | Variance equals counted minus expected; a loss is a reasoned adjustment; the counted amount is never edited | P3 |
| RT-245 | Cash | A variance beyond tolerance requires acknowledgement, a reason, and possibly a different approver | MUST | Store Manager | CD-23, BI-26 | RT-244 | Within tolerance it auto-closes and is recorded; beyond it, acknowledgement and a reason are required | P3 |
| RT-246 | Cash | Reopening a closed shift is reasoned, audited, and standing-reported | MUST | Store Manager | CD-25, CD-26, SM-56 | RT-244 | Reopening requires a reason, is audited, and appears on the reopened-shift report | P3, P5 |
| RT-247 | Cash | A count is entered per denomination and the total is derived | MUST | Cashier | CD-27..CD-29 | RT-243 | The total is computed from the denomination counts, never entered alongside them | P3, P4 |
| RT-248 | Cash | Cash reports separate money by method | MUST | Store Manager | CD-32, RP-13 | RT-237 | Reports show cash in, cash out, expected, counted, and variance separately, never a blended "cash" total | P5 |
| RT-249 | Cash | Multi-drawer shifts and multi-currency drawers are out of scope in v1 | OUT OF SCOPE | — | CD-34, CD-36 | — | One drawer per terminal, one currency per drawer in v1; both are recorded as v2 boundaries | — |
| RT-250 | Cash | Cash-office banking and bank reconciliation are out of scope | OUT OF SCOPE | — | CD-33 | — | No banking integration in v1; the domain records what happened in the drawer only | — |
| RT-525 | Cash | A cash movement is a ledger row and the drawer balance is its projection, never a field update | MUST | Platform Owner | CD-19, CD-08, BI-02 | RT-237, RT-056 | A pay-out, drop, retrieval, or adjustment writes a cash-transaction row; the drawer balance is recomputed from those rows and no path updates it directly | P2, P3 |
| RT-526 | Cash | Closing a shift requires `Shift.Close`, a drawer count, a counted denomination breakdown, and a declared closing float for the next shift | MUST | Cashier | CD-20 | RT-235, RT-243, RT-247 | Close is refused without all four; the denomination total is derived from the breakdown, and the declared next float is recorded as a cash row rather than a note | P3 |
| RT-527 | Cash | The shift screen answers exactly four questions, and only these four | MUST | Cashier | CD-30 | RT-237, RT-244, RT-245, RT-373 | The screen shows what should be here, what is here, the variance against its threshold, and why with reason, approver, and next step; no fifth figure replaces one of the four | P4 |
| RT-528 | Cash | The float is a store decision; the system shows the busiest days' expected cash and never recommends a float | MUST | Store Manager | CD-35 | RT-237, RT-248 | No recommendation or automated float calculation exists; the expected-cash report for the busiest days is a report the store reads, and the declared float is the store's | P5 |
| RT-529 | Cash | The drawer is not a safe-management feature | OUT OF SCOPE | - | CD-37 | RT-240 | Drops and retrievals are recorded as cash movements; the safe's contents, its access list, and its own reconciliation are not managed, and the module cannot be pointed at a safe | - |

---

## 15. Payments

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-251 | Payment | A credit sale is an AR document, a ledger entry, and a zero-value payment | MUST | Cashier | PY-01, SP-41, CU-20 | RT-134 | The sale, the ledger entry, and a zero-amount payment with a credit method exist; no full-amount payment is written | P3 |
| RT-252 | Payment | Methods are typed, and the type determines settlement logic | MUST | Platform Owner | PY-03..PY-06 | RT-238 | Each of the nine types resolves to the correct settlement path; an unknown or disabled method is refused (PY-04) | P2, P3 |
| RT-253 | Payment | The provider abstraction is five commands, with no vendor name in business logic | MUST | Platform Owner | PY-07..PY-10 | RT-211 | Only `Authorize`, `Capture`, `Refund`, `Void`, `Query` are called; a build check enforces the boundary (PY-08) | P3, P5 |
| RT-254 | Payment | The provider is per store and per method | MUST | Store Manager | PY-09 | RT-253 | Two stores, or two terminals in one store, may use different acquirers under the same method | P3 |
| RT-255 | Payment | A timeout stays pending and is reconciled; it is never auto-failed | MUST | Cashier | PY-11, PY-41, SM-52, EC-72 | RT-136 | A timed-out payment retries with backoff; only a query or a settlement file resolves it; a failed-and-auto-retried payment cannot double-charge | P3 |
| RT-256 | Payment | A captured payment has no outgoing transition except a linked refund | MUST | Platform Owner | PY-12, SM-51, BI-09, PY-14, PY-54 | RT-253 | A graph assertion fails the build on any other edge out of `Captured` | P3, P5 |
| RT-257 | Payment | A split tender settles in a recorded order, with a defined recovery path | MUST | Cashier | PY-17, PY-13, EC-13, PY-20 | RT-133 | Where one method fails after another succeeds, the succeeded one is voided if voidable and the failure is surfaced | P3 |
| RT-258 | Payment | A refund is bounded by the refundable amount, checked atomically | MUST | Cashier | PY-22, RR-03 | RT-145 | Per-line and per-sale bounds are evaluated in the refund transaction with a conditional counter | P3 |
| RT-259 | Payment | Every non-cash, non-card tender is a ledgered balance, not a number | MUST | Accountant | PY-29..PY-33, BI-19 | RT-165 | Store credit, gift card, voucher, and loyalty balances are each projections of their own entries | P2, P3 |
| RT-260 | Payment | Stored-value redemption is bounded atomically | MUST | Cashier | PY-31, BI-19, EC-22 | RT-259 | Two concurrent redemptions of one card yield one success | P3 |
| RT-261 | Payment | No full card number is ever stored, and card data never reaches logs or audit | MUST | Super Administrator | PY-43, PY-44, BI-01, CU-35 | — | A schema inspection finds no full PAN column; a log scan finds no unmasked card data; a masked reference is present instead | P2, P3, P5 |
| RT-480 | Payment | Payment state is a projection of provider events plus the local record, and the state is the reconciliation of the two; a callback is idempotent by provider transaction reference and a duplicate callback is acknowledged and recorded once | MUST | Platform Owner | PY-15 | RT-255, RT-256 | A local transition alone does not capture a payment; a duplicate callback is acknowledged and stored once | P3 |
| RT-481 | Payment | An overpayment is change, not a payment, and a non-cash overpayment is refused rather than creating a negative tender; where a store allows negative-tender credit it is a configured store setting, carries a reason, and is reported | MUST | Cashier | PY-19 | RT-135, RT-239 | A card overpayment is refused and raises no negative tender; a store that permits one records the reason and reports it | P3 |
| RT-482 | Payment | No expiry campaigns and no expiry-without-notification in v1 | OUT OF SCOPE | - | PY-35 | - | Not exposed; expiry remains a dated, documented, reported event (RT-461) | - |
| RT-262 | Payment | Provider credentials are unreadable in configuration and rotatable without downtime | MUST | Super Administrator | PY-45, PY-06 | RT-253 | Credentials are held in a secret store, not application config; a rotation requires no restart | P2, P3 |
| RT-263 | Payment | A payment is bound to a terminal, drawer, shift, and employee | MUST | Cashier | PY-46, SP-07, BI-39 | RT-122 | Every payment resolves all four; a payment with no shift is impossible | P2 |
| RT-264 | Payment | A provider call is never inside a business transaction | MUST | Platform Owner | PY-36, BI-04 | RT-120 | A gateway call happens before the transaction opens | P3 |
| RT-265 | Payment | The sale commits after capture, not before | MUST | Cashier | PY-37, SP-03 | RT-121 | A committed sale with an uncaptured payment is impossible; a captured payment with no sale is recoverable through the provider | P3 |
| RT-266 | Payment | Payment reconciliation is a job, and unmatched payments are reported, never auto-adjusted | SHOULD | Accountant | PY-40, RP-18 | RT-255 | Pending payments are queried; the settlement file is compared; an unmatched payment is escalated, never auto-corrected | P5 |
| RT-267 | Payment | Every payment attempt, outcome, and retry is recorded and reportable | MUST | Store Manager | PY-42, NT-03 | RT-265 | A failure report by provider, terminal, and time exists | P5 |
| RT-268 | Payment | Surcharging, DCC, BNPL, orchestration, chargeback handling, and multi-currency are out of scope | OUT OF SCOPE | — | PY-49..PY-53 | — | None is exposed in the v1 surface; each is recorded with its boundary | — |
| RT-440 | Payment | A live store's payment provider configuration is approvaled and audited before it takes effect | MUST | Super Administrator | EC-20 | RT-262 | A provider change in a live store requires an approval from another principal and writes an audit event; a test endpoint in a live store is refused without one | P2, P3 |

---

## 16. Multi-store

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-269 | Multi-store | v1 operates one store; the model supports many | MUST | Platform Owner | MS-01, MS-02, overview principle 13 | RT-001 | A second store can be created and configured; every store-scoped row populates `StoreId` without a migration | P2, P3 |
| RT-270 | Multi-store | The permitted store set is access ∩ role ∩ request | MUST | Store Manager | MS-03, MS-06 | RT-002, RT-013 | A store outside the set returns `403`; a request may only narrow within it | P3 |
| RT-271 | Multi-store | An organization-wide role broadens which stores, never which permissions | MUST | Super Administrator | MS-11, MS-12 | RT-010 | An org-wide role grants its permissions in the accessible stores, and nothing outside them | P3 |
| RT-272 | Multi-store | Every report states its scope, currency, and basis in the output | MUST | Store Manager | MS-24, RP-04, RP-05 | RT-019 | Every report and every export carries scope, currency, and basis, including the export header row | P5 |
| RT-273 | Multi-store | No cost allocation across stores in v1 | OUT OF SCOPE | — | MS-26, RP-32 | — | Unattributed margin is reported as unattributed; no spreading rule is applied | — |
| RT-274 | Multi-store | No inter-store pricing, credit, reservation, or approval in v1 | OUT OF SCOPE | — | MS-27, MS-32..MS-34 | — | Each is refused in v1; the enabling prerequisites are recorded in MS-21 | — |
| RT-275 | Multi-store | No cross-store transfer in v1 | OUT OF SCOPE |  | MS-20, MS-22, SM-79 | RT-081 | A transfer between stores is refused; a central-warehouse move is dispatch-and-receive using the single-entity credit model | P3 |
| RT-276 | Multi-store | Central-warehouse stock is store-attributed and reported as a reconciliation view | MUST | Store Manager | MS-16, MS-19, EC-90 | RT-004 | Central-warehouse stock is reportable by originating store and is labelled as a reconciliation view | P5 |
| RT-394 | Multi-store | Scope is applied to every store-scoped read and write; no store-scoped operation escapes it, including exports, reports, and search suggestions | MUST | Super Administrator | MS-10, EC-59 | RT-013, RT-313, RT-309 | An export run by an administrator with no store access returns only permitted stores; organization-wide reporting is the separate, explicit permission | P3 |
| RT-395 | Multi-store | Segregation-of-duties conflicts are evaluated across stores, not per store | MUST | Super Administrator | MS-14 | RT-281 | `Customer.Loyalty.Adjust` granted in one store conflicts with `Sale.Create` granted in another, because both were held by one person | P3 |
| RT-396 | Multi-store | The audit log is organization-global and is queryable only with an explicit store filter or organization-wide permission | MUST | Auditor | MS-29 | RT-299 | An auditor with the organization-wide permission queries across stores; a store manager's query is confined to their store with no implicit widening | P3 |
| RT-397 | Multi-store | A chain or store-range catalog is not in v1; the single organization-global catalog is the only one | OUT OF SCOPE | — | MS-35 | RT-021 | No second catalog and no chain-range versus store-range concept exists; a store-local product is a variant flagged not sellable elsewhere. The rule records this as an open review item, carried to the gap register | — |

---

## 17. Approvals

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-277 | Approvals | One generic approval mechanism serves every subject | MUST | Platform Owner | AP-01, AP-02 | — | Thirteen subjects route through one request, decide, and audit path; no per-subject workflow variant exists | P3 |
| RT-278 | Approvals | A request is immutable once submitted | MUST | Store Manager | AP-03, SM-69 | RT-277 | The payload cannot change; an approver reads exactly what was proposed | P2, P3 |
| RT-279 | Approvals | Self-approval is blocked at the data layer, with no override at any privilege | MUST | Platform Owner | AP-08, AP-40, BI-26 | RT-277 | The decider cannot be the requester; a database or service-layer check enforces it, not the UI; no break-glass exists (EC-94) | P2, P3 |
| RT-280 | Approvals | Approving is a permission distinct from requesting | MUST | Super Administrator | AP-29, AP-07, actors §2, EC-58 | RT-010 | A role with the request permission alone cannot approve; the requester may not decide (RT-279); a single-operator store can still be configured with both | P2, P3 |
| RT-281 | Approvals | A role conflict blocks the decision | MUST | Store Manager | AP-09, SEP-01 | RT-279 | A decider holding both sides of a segregation conflict is refused | P3 |
| RT-282 | Approvals | The highest eligible approver decides; a lower one may not | MUST | Store Manager | AP-16 | RT-277 | A request above a manager's limit escalates rather than being approvable lower | P3 |
| RT-283 | Approvals | Delegation is explicit, dated, and audited | MUST | Store Manager | AP-17..AP-20 | RT-282 | A delegation has a date range, is audited, records both the delegate and the original approver, and cannot reach the delegator's own request | P3 |
| RT-284 | Approvals | A rejection always needs a reason, in the moment | MUST | Store Manager | AP-10, UX-41 | RT-277 | The rejection cannot be saved without a reason | P4 |
| RT-285 | Approvals | An expired request is distinct from a rejected one and performs nothing | MUST | Store Manager | AP-23, AP-24, SM-70 | RT-277 | A past-SLA request expires, takes no action, and is not counted as a denial | P3 |
| RT-286 | Approvals | The queue shows subject, amount, requester, reason, age, and SLA | MUST | Store Manager | AP-26, AP-27, UX-40 | RT-277 | The queue is triageable without opening an item; it is sorted by urgency then amount | P4 |
| RT-287 | Approvals | Thresholds are configurable per store, per subject, per currency | MUST | Store Manager | AP-01, AP-02, overview §23 | RT-277 | Two stores can hold different thresholds for the same subject with no code change | P2, P3 |
| RT-288 | Approvals | Multi-step, quorum, conditional, and cross-store approvals are out of scope in v1 | OUT OF SCOPE | — | AP-35..AP-39 | — | None is exposed; each is recorded with its boundary, and approval by link is refused outright | — |
| RT-289 | Approvals | An approval-notification failure never un-does a completed action | MUST | Platform Owner | AP-31, NT-05 | RT-277 | A failed notification is retried; the business fact is unaffected | P3 |
| RT-382 | Approvals | The request references its subject, and a suspendable subject is suspended or flagged while the request is pending | MUST | Platform Owner | AP-04 | RT-277 | A pending cash-out is unavailable to spend; where the subject cannot be suspended the request is recorded as advisory | P3 |
| RT-383 | Approvals | A request carries its reason from submission | MUST | Store Manager | AP-05 | RT-277 | A request with no reason cannot be submitted; the reason read later is the reason given at submission | P3 |
| RT-384 | Approvals | The request is submitted in the same transaction as the action that triggered it, or immediately after | MUST | Platform Owner | AP-06 | RT-277 | The action and its request are one decision, never two commits | P3 |
| RT-385 | Approvals | A decision writes an `Approval.Decided` audit event carrying the before and after state, the decider, and the reason | MUST | Auditor | AP-11 | RT-290 | The event carries all four; a decision with no such event is refused | P3 |
| RT-386 | Approvals | A decision is idempotent by request id, and a decided request cannot be decided again | MUST | Platform Owner | AP-12, AP-13 | RT-278 | Two taps decide once; a second decision is refused, and correction is a separate approved compensating action | P3 |
| RT-387 | Approvals | The decider is resolved by role and store, never by name | MUST | Super Administrator | AP-14, AP-15 | RT-280, RT-282 | The approver pool is a role assignment; a person with no matching role in that store cannot decide, and replacing the role holder does not break the workflow | P3 |
| RT-388 | Approvals | Every policy carries a decision SLA, configurable per subject per store, and a request past its SLA escalates | MUST | Store Manager | AP-21, AP-22 | RT-285, RT-325 | A policy without an SLA is refused; a past-SLA request escalates to the next approver, then a manager, then the approvals report, and is not left undecided | P3 |
| RT-389 | Approvals | A request whose subject no longer exists is `Cancelled` with a reason naming the subject | MUST | Store Manager | AP-25 | RT-285 | A pending approval for a voided sale is cancelled rather than left pending, and the reason names the subject | P3 |
| RT-390 | Approvals | The approval report is a projection of the requests, by state, subject, decider, and store, with the mean wait | SHOULD | Store Manager | AP-30 | RT-311, RT-312 | The report is rebuildable from the requests; decided, pending, rejected, and expired are each distinguishable | P5 |
| RT-391 | Approvals | Where a subject cannot proceed without approval, it is refused with a message naming the pending request | MUST | Cashier | AP-32 | RT-277, RT-377 | The subject is refused, not left in a dead end, and the message names the request that must be decided | P3 |
| RT-392 | Approvals | A request submission is idempotent by `ClientOperationId` | MUST | Platform Owner | AP-33 | RT-123, RT-277 | A retried submission creates no second request and therefore no second decision to make | P3 |
| RT-393 | Approvals | A request survives a restart | MUST | Platform Owner | AP-34 | RT-277 | The request is a record, not a session; a reboot does not remove a pending approval | P3 |

---

## 18. Audit

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-290 | Audit | An audit event is written in the same transaction as the change | MUST | Platform Owner | AU-01, BI-23, BI-24 | — | A fault injected between the two leaves no change and no event; never a change without an event | P2, P3 |
| RT-291 | Audit | Audit events are append-only at every privilege | MUST | Platform Owner | AU-02, AU-32, BI-23, BI-34 | — | No update or delete path exists on an event for any role, including the Owner; a cascade cannot reach one | P2, P3 |
| RT-292 | Audit | The mandatory event floor covers money and permission | MUST | Auditor | AU-03, overview §20 | RT-290 | Each of the twenty listed categories produces an event; the list is the acceptance checklist | P3 |
| RT-293 | Audit | The actor is the authenticated principal, never a request field | MUST | Platform Owner | AU-05, BI-33 | RT-010 | A request body naming a different actor is ignored; the event records the authenticated identity | P3 |
| RT-294 | Audit | Impersonation is itself an event recording both principals | MUST | Auditor | AU-06 | RT-293 | An impersonated action records the real and the effective principal, the reason, and the approver | P3 |
| RT-295 | Audit | Redaction happens at write time, not at read time | MUST | Super Administrator | AU-09, CU-35, PY-44 | RT-291 | A masked field is masked in the stored event; a direct database read shows no unmasked PII | P2, P3 |
| RT-296 | Audit | Reads are not audited, but exports, sensitive reads, and denials are | MUST | Auditor | AU-14, AU-15 | RT-290 | A normal read writes no event; an export, a bulk read, and every permission denial each write one | P3 |
| RT-297 | Audit | Financial events are not deletable before the retention floor | MUST | Platform Owner | AU-17, AU-18 | RT-291 | A deletion request for a payment event inside the financial period is refused | P3 |
| RT-298 | Audit | Expiry is whole-event and records that it happened | MUST | Platform Owner | AU-19, AU-20 | RT-297 | Expiry removes a row and writes an `Audit.EventExpired` event; the gap is never silent | P3 |
| RT-299 | Audit | Reading the log requires `Audit.View`; no role both reads and remediates | MUST | Auditor | AU-23, AU-24, SEP-09 | RT-010 | A role without `Audit.View` cannot read; no template holds read and remediate together | P3 |
| RT-300 | Audit | Every access to the log is itself audited | MUST | Auditor | AU-25 | RT-299 | Reading the log writes an event naming the reader and the subject read | P3 |
| RT-301 | Audit | Standing investigation reports are rebuildable projections | SHOULD | Store Manager | AU-27, AU-28, RP-02 | RT-290 | Each of the ten standing reports rebuilds from the events; a rebuild reproduces the reported figures | P5 |
| RT-302 | Audit | The event store is append-only at the storage layer and chain-checked | MUST | Platform Owner | AU-29, AU-30, EC-76, BI-15a | RT-291 | A removed or altered event breaks the per-organization chain; the check job reports the break as an incident | P2, P5 |
| RT-303 | Audit | No blockchain, notary, or external timestamping in v1 | OUT OF SCOPE | — | AU-33 | — | Not exposed; the per-organization chain is the stated control | — |
| RT-464 | Audit | An audit event records what happened rather than what was intended; the store is always on the event, derived from the affected entity rather than the request; and `Before`/`After` hold only changed fields, not whole entities | MUST | Platform Owner | AU-04, AU-07, AU-08 | RT-290 | An event can be filtered by store with no join; a single-field change records that field in `Before`/`After` and not the rest of the entity; the actor's intent is not recorded | P3 |
| RT-465 | Audit | `EventType` is a closed, versioned, domain-namespaced set; logout and session end are distinct events (`Security.Logout` versus `Security.SessionEnded` with its cause); the vocabulary is complete against the mandatory event floor; and a new event type is a reviewed change made only when a rule already requires the event | MUST | Platform Owner | AU-11, AU-12, AU-12a, AU-12b, AU-12c, AU-13 | RT-292 | A free-text event type is refused; an explicit logout and an expired or revoked session record different types, the latter with its cause; no type exists without a citing rule, and adding one is treated as a reviewed schema change | P3 |
| RT-466 | Audit | A scheduled job records what it did and what it changed in the same event vocabulary; archival moves events to cold storage while preserving the query path; and the retention policy is versioned and audited, with a policy change that shortens retention requiring approval | MUST | Platform Owner | AU-16, AU-21, AU-22 | RT-292 | A job that changes a balance writes an event naming what it changed; a four-year-old transaction is still answerable, more slowly; shortening retention is refused without approval and writes its own event | P3 |
| RT-467 | Audit | Access to an employee's own actions is not special-cased: supervisors see their store and see their own events like anyone else's, and a request to suppress one's own event is refused; a database administrator with write access to the audit store is a documented, mitigated risk rather than a solved one | MUST | Platform Owner | AU-26, AU-31 | RT-299, RT-302 | A supervisor's own event is visible in the store log and cannot be suppressed; the administrator risk is recorded against this requirement, mitigated by the hash chain and separate credentials | P3 |
| RT-468 | Audit | No per-field, per-reason audit trail on every entity in v1, and no real-time alerting on audit events in v1; the mandatory event floor and a standing report with threshold notifications are the floor | OUT OF SCOPE | - | AU-34, AU-35 | - | Not exposed; the mandatory event floor and the standing report are the stated control | - |

---

## 19. Reporting

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-304 | Reporting | Every figure states scope, currency, and basis | MUST | Store Manager | RP-04, MS-24 | RT-272 | Each of the catalogue's reports declares all three; a report that cannot is not shipped | P5 |
| RT-305 | Reporting | A report uses the authoritative figure, never a re-derivation | MUST | Accountant | RP-10, BI-11 | RT-308 | A report's total is read from the document, not recomputed; a re-implementation with different rounding is a defect | P5 |
| RT-306 | Reporting | A report's total equals its displayed rows, or is labelled | MUST | Store Manager | RP-11, RP-12 | RT-304 | A truncated or sampled report states the counts covered and the population total | P5 |
| RT-307 | Reporting | Voids, refunds, and negatives appear as signed lines, not as a deduction below | SHOULD | Store Manager | RP-13 | RT-305 | A sales report shows the signed net lines; the total matches the sum of what is shown | P5 |
| RT-308 | Reporting | Discount, tax, and cost are attributed at the line, never by ratio | MUST | Accountant | RP-09, PR-55, SP-11 | RT-048 | Line allocations sum exactly to the document figure, with the residual assigned by the documented rule | P5 |
| RT-309 | Reporting | A report may never widen the scope of an input it reads | MUST | Store Manager | RP-15, MS-04 | RT-270 | A joined report with one unscoped input is a build failure, caught by a per-query scope assertion | P3, P5 |
| RT-310 | Reporting | No report runs on the transaction path | MUST | Platform Owner | RP-21, BI-24, UX-62 | RT-119 | A report's failure cannot fail a sale; a slow report becomes a background job, never a hang (RP-20) | P3, P5 |
| RT-311 | Reporting | A projection is maintained with the change or by a job with a documented lag | SHOULD | Platform Owner | RP-22 | RT-056 | Each projection documents its lag; a stale projection is labelled in the output | P5 |
| RT-312 | Reporting | The v1 catalogue ships the named reports, each with a grain and an audience | MUST | Store Manager | RP-18, RP-19, overview §21 | RT-304 | Every report in the catalogue is implemented with a defined grain; a report with no grain is rejected at review | P5 |
| RT-313 | Reporting | Export requires permission, is audited, and is not a scope escape | MUST | Store Manager | RP-25, RP-28, AU-15 | RT-299, RT-270 | An export without `Report.Export` is refused; an export is an audit event; a scoped screen exports only its store | P5 |
| RT-314 | Reporting | An export file carries scope, currency, basis, and generation time | MUST | Store Manager | RP-26 | RT-313 | The export header row carries all four, so the file is interpretable without the screen | P5 |
| RT-315 | Reporting | Export is rate-limited and row-bounded | MUST | Super Administrator | RP-27 | RT-313 | A per-user frequency and row-count limit is enforced | P5 |
| RT-316 | Reporting | A report builder, scheduled email, forecasting, and cross-organization benchmarking are out of scope | OUT OF SCOPE | — | RP-30..RP-34 | — | None is exposed; each is recorded with its boundary | — |
| RT-398 | Reporting | Every report declares which kind it is, and the screen says so where freshness differs materially | MUST | Store Manager | RP-01 | RT-304 | A user comparing a live figure with a projection figure can tell from the screen which is which | P5 |
| RT-399 | Reporting | No report is the system of record | MUST | Platform Owner | RP-03 | — | A report holds no figure that exists nowhere else; a drawer count is a counted fact in cash management, not a report | P5 |
| RT-400 | Reporting | A report never mixes currencies in one column, and a converted figure shows its rate and its rate date | MUST | Store Manager | RP-06, RP-07 | RT-304 | Multi-currency output is per-currency columns or one reporting currency; no total is summed across currencies without conversion, and no converted figure appears without its rate and date | P5 |
| RT-401 | Reporting | A report's scope is a function of the report, not only of the role | MUST | Store Manager | RP-16 | RT-309 | A cashier sees their own sales and voids and not the whole till's takings, even holding the same role as a peer | P5 |
| RT-402 | Reporting | The largest-history reports are indexed by their own access pattern, and an expensive query is a background job rather than a scan presented as quick | MUST | Platform Owner | RP-23, RP-24 | RT-310 | Each large-history report names its access pattern and its index; a query too expensive to serve is a job, with no third option | P5 |
| RT-403 | Reporting | The export destination is not a server-side integration in v1 | OUT OF SCOPE | — | RP-29 | RT-313 | No automatic push to another system exists; the export is a file the user receives. Sending data automatically is a separate feature with its own consent and audit requirements | — |
| RT-451 | Reporting | A report too slow to serve becomes a background job that notifies its requester on completion or failure | MUST | Store Manager | EC-74, RP-20 | RT-310, RT-320 | An expensive report returns a job reference; the requester is notified with the result, and the job never blocks the till | P5 |

---

## 20. Notifications

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-317 | Notifications | A notification is generated from a domain event, not authored | MUST | Store Manager | NT-01, NT-02, NT-04 | RT-290 | The event vocabulary is closed and versioned; every notification's text is templated from its event | P3 |
| RT-318 | Notifications | Recipients are resolved by role and store scope | MUST | Store Manager | NT-07..NT-10, MS-06 | RT-270 | A notification reaches exactly the role-holders in the affected store, once each; a multi-store role is notified once | P3 |
| RT-319 | Notifications | A notification contains no data the recipient could not read directly | MUST | Store Manager | NT-11, NT-12 | RT-318 | Each of the twenty-three events is checked against the recipient's permissions; a notification shows a pointer, not a payload | P3 |
| RT-320 | Notifications | Delivery is at-least-once and never fails the business transaction | MUST | Platform Owner | NT-05, NT-06 | RT-290 | A notification failure is a retried job; the business fact is unaffected (AP-31) | P3 |
| RT-321 | Notifications | SMS is limited to a thresholded critical set | MUST | Store Manager | NT-14 | RT-319 | Only the three named events may send SMS, each with a required threshold; no unthresholded SMS rule is configurable | P3 |
| RT-322 | Notifications | A user may escalate but not silence a critical event | MUST | Store Manager | NT-19, NT-20 | RT-321 | Critical events are not silenceable; a user's preference is a personal filter, never a suppression | P3 |
| RT-323 | Notifications | Non-critical notifications outside business hours are deferred, not dropped | SHOULD | Store Manager | NT-21, NT-22 | RT-320 | A deferred notification is delivered on resumption, in order, and the deferral is visible | P3 |
| RT-324 | Notifications | Read and acknowledged are independent states | MUST | Store Manager| NT-27, NT-28, SM-72, SM-73, NT-29, UX-44, UX-46| RT-320 | The inbox leads with unacknowledged; acknowledging never performs the action it describes (NT-29) | P3, P4 |
| RT-325 | Notifications | An unresolved escalated event appears on a report | MUST | Store Manager | NT-25, NT-26, RP-18 | RT-323 | An escalation chain is bounded; anything unresolved past the bound is on a report, not just an inbox | P5 |
| RT-326 | Notifications | Messaging, broadcast, marketing, and store-editable templates are out of scope | OUT OF SCOPE | — | NT-32..NT-36 | — | None is exposed; a store-editable template is refused as a phishing vector against staff | — |
| RT-355 | Notifications | InApp is always on and is the delivery source of truth; other channels are configured per event type and per user, with a store default and no global switch | MUST | Store Manager | NT-13, NT-16 | RT-317 | InApp cannot be disabled; turning a channel off for one event type does not affect another; no global mute exists | P3 |
| RT-356 | Notifications | Email is a digest for anything non-urgent | SHOULD | Store Manager | NT-15 | RT-317 | Forty non-urgent events in a day produce a digest, not forty emails | P3 |
| RT-357 | Notifications | An external channel requires a verified destination and consent | MUST | Store Manager | NT-17 | RT-318 | An unverified or unconsented destination is refused before any send | P3 |
| RT-358 | Notifications | A channel failure affects neither the other channels nor the domain | MUST | Platform Owner | NT-18, EC-75 | RT-320 | With a push provider down, InApp and email delivery are unchanged and the domain fact is unaffected | P3 |
| RT-359 | Notifications | An event needing a decision has a deadline that escalates, and escalation targets a role | MUST | Store Manager | NT-23, NT-24 | RT-325 | An unacknowledged event past its deadline escalates; the escalation names a role, never an individual | P3 |
| RT-360 | Notifications | A notification is retained for a configured short period and then expires; the event is the record | MUST | Platform Owner | NT-30, SM-74 | RT-320 | An expired notification is removed and its event remains queryable | P3 |
| RT-361 | Notifications | A notification links to the record it is about, and following the link is permission-checked | MUST | Store Manager | NT-31, UX-45 | RT-318 | Following a link the recipient may not open is refused; the record is not disclosed | P3 |
| RT-362 | Notifications | Before and after are separate events, and an event type is added only when a rule requires it | MUST | Store Manager | NT-37 | RT-317 | `LowStock` and `OutOfStock` are distinct types; no event type exists without a citing rule | P3 |

---

## 21. UX

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-327 | UX | The till is keyboard-first, and the scanner is the keyboard | MUST | Cashier | UX-01, overview principle 14 | RT-125 | Every till action is reachable by keyboard; typing a barcode equals scanning it | P4 |
| RT-328 | UX | The workspace shows only what the employee's access and role permit | MUST | Cashier | UX-05, UX-08 | RT-013, RT-018 | A cashier sees no inventory management; an absent permission is hidden, not greyed out | P4 |
| RT-329 | UX | A multi-context user uses a switcher; there is no ambient all-stores mode | MUST | Store Manager | UX-06 | RT-270 | Changing context is always an explicit switch | P4 |
| RT-330 | UX | The running total is visible at all times during a sale | MUST | Cashier | UX-10, SP-24 | RT-124 | The total is on screen from the first line to the receipt | P4 |
| RT-331 | UX | Change is a prominent, distinct figure | MUST | Cashier | UX-15, SP-39 | RT-135 | Change is shown as its own prominent value, not as a negative line in a total | P4 |
| RT-332 | UX | A decline preserves the cart and the tenders taken | MUST | Cashier | UX-16, UX-57, SP-43 | RT-137 | After any user-caused error the cart and prior tenders are intact | P4 |
| RT-333 | UX | A timeout reads as "waiting", not "declined" | MUST | Cashier | UX-18, PY-11 | RT-136 | A gateway timeout is worded and styled as pending | P4 |
| RT-334 | UX | A completion screen does not offer a void | MUST | Cashier | UX-21, SM-34 | RT-138 | The done state shows the outcome and the receipt status, and no void affordance | P4 |
| RT-335 | UX | Void, refund, return, and adjustment are separate, named, confirmed actions | MUST | Store Manager | UX-27, UX-28, EC-80 | RT-138, RT-151 | Four distinct screens; the void confirmation names the sale, the total, and the reason | P4 |
| RT-336 | UX | The refund screen leads with the refundable remainder | MUST | Cashier | UX-29, BI-10 | RT-145 | The remainder, not the original amount, is the prominent figure | P4 |
| RT-337 | UX | An error says what happened, why, and what to do next | MUST | Cashier | UX-55, UX-56 | RT-332 | Every error message in the acceptance suite has all three parts and is specific enough to act on | P4 |
| RT-338 | UX | A 403 says "no access" and a 404 says "not found", and the UI does not blur them | MUST | Store Manager | UX-58, MS-07 | RT-015 | The two render differently in the UI and neither is shown as a missing record | P4 |
| RT-339 | UX | Every till action is keyboard-reachable and announced audibly | MUST | Cashier | UX-50, UX-51, EC-81 | RT-327 | A blind cashier can run a full shift; every confirmation is spoken | P4 |
| RT-340 | UX | Colour is never the only signal | MUST | Cashier | UX-52 | RT-339 | Variance, rejection, offline, and held shift each carry a text label and an icon | P4 |
| RT-341 | UX | A till speed budget exists and is tested | MUST | Cashier | UX-60, UX-61, overview principle 14 | RT-119 | A budget is defined against real hardware and asserted in the acceptance suite; a slow operation never silently waits | P4 |
| RT-342 | UX | Offline mode is announced before it is needed and honest about what changes | MUST | Cashier | UX-63, UX-64, OF-30, UX-19| RT-232 | Offline is persistent on screen and explains the effect on cards, stock, price, and loyalty | P4 |
| RT-343 | UX | Theming, animation, custom dashboards, in-app help, and multi-language are out of scope in v1 | OUT OF SCOPE | — | UX-67..UX-71 | — | None is built; each is recorded with its boundary, and the data model is unaffected by the deferred ones | — |
| RT-363 | UX | The common path is short; a destructive action is explicit, separately named, and confirmed by what and how much | MUST | Cashier | UX-02, UX-03 | RT-335 | Scan, take money, and print is the shortest path; void, refund, adjust, and approve each demand a confirmation naming the subject and the amount | P4 |
| RT-364 | UX | The system reports the outcome, not its internal action, and a user-caused outcome is not styled as a system error | MUST | Cashier | UX-04, UX-59 | RT-337 | A completion message names the sale id, the total, and the tender; a declined card is styled as a normal outcome and a server error is styled differently | P4 |
| RT-365 | UX | The normal sale path is scan, line, running total, payment, confirm, print | MUST | Cashier | UX-09 | RT-330 | Each step is reachable in order and the line shows description, quantity, price, and line total | P4 |
| RT-366 | UX | Quantity is one control on the line; a hand-entered weight is labelled and reasoned | MUST | Cashier | UX-13 | — | A weight entered by hand is marked on the line and carries a reason; a scale-entered weight is not | P4 |
| RT-367 | UX | The payment step shows total due, tenders already taken, and the remainder | MUST | Cashier | UX-14 | RT-330 | The payment step never presents only a total | P4 |
| RT-368 | UX | An underpayment is named as such and the credit-sale route is explicit | MUST | Cashier | UX-17 | RT-136 | An underpayment states the shortfall and offers the credit option rather than leaving the cashier to infer it | P4 |
| RT-369 | UX | An offline sale accepted with an adjustment is shown to the cashier on reconnect | MUST | Cashier | UX-20 | RT-342 | On reconnect the cashier is shown that the sale was applied with an adjustment; it is not only in a report | P4 |
| RT-370 | UX | Resuming a suspended sale does not re-reserve stock | MUST | Cashier | UX-25 | RT-148 | Where stock has gone since the sale was suspended, the shortage is reported at the point of completion, not as a silent negative | P4 |
| RT-371 | UX | A suspended sale can be discarded with confirmation, and the discard is audited | MUST | Cashier | UX-26 | RT-148 | The discard requires confirmation and writes an audit event | P4 |
| RT-372 | UX | Opening a shift asks for the counted float by denomination | MUST | Cashier | UX-32 | — | The float is entered per denomination and the total is shown as counted, not as a digit total | P4 |
| RT-373 | UX | The variance screen shows counted, expected, variance, and threshold together | MUST | Store Manager | UX-34 | RT-347 | The acknowledgement requires a reason; above the higher threshold it routes to approval | P4 |
| RT-374 | UX | The drawer state is visible on the till at all times | MUST | Cashier | UX-35 | — | Open, closed, and held-for-counting are each displayed, so the cashier never has to ask | P4 |
| RT-375 | UX | A stock adjustment is entered as a counted quantity, not a delta | MUST | Store Manager | UX-36 | RT-075 | The field records a counted quantity; a delta is not accepted as input | P4 |
| RT-376 | UX | A low-stock alert names the variant, the quantity, the threshold, and the reorder action | MUST | Store Manager | UX-38 | RT-319 | The alert carries all four and links to the reorder action | P4 |
| RT-377 | UX | An action needing approval says the request was sent, and the requester can see their own request's state | MUST | Store Manager | UX-42, UX-43, AP-28 | RT-277 | The action never appears to work and then fail; the requester sees pending, decided, and by whom | P4 |
| RT-378 | UX | Search results and search suggestions are scope-filtered before they are returned | MUST | Store Manager | UX-47, UX-49 | RT-015 | No result or suggestion is returned for a record the user cannot open; suggestions are limited and scope-filtered | P4 |
| RT-379 | UX | A barcode search is exact and a name search is fuzzy; the two never mix | MUST | Cashier | UX-48 | — | An exact barcode match never returns fuzzy candidates, and a name search never resolves as a barcode | P4 |
| RT-380 | UX | Touch targets are sized for fast, imprecise till work and text meets a published contrast ratio | MUST | Cashier | UX-53, UX-54 | RT-339 | A minimum target size and a published contrast ratio exist and are asserted in the acceptance suite; no number is stated here, as UX-53 defers the minimum to Phase 2 | P4 |
| RT-381 | UX | A rejected offline sale is shown with its reason and what to do | MUST | Cashier | UX-66 | RT-342 | The cashier is shown whether a refund or a re-ring is needed | P4 |
| RT-456 | UX | The void, return, refund, and escalate paths are each reachable in a few taps | MUST | Cashier | EC-84 | RT-335, RT-363 | Each of the four dispute paths is reachable without a menu hunt, measured on a busy till | P4 |
| RT-524 | UX | A rejected return carries a customer-facing reason and a separate internal reason | MUST | Store Manager | UX-31, RR-42, SM-42 | RT-150, RT-347 | The customer sees plain language such as "outside the 30-day window" while the internal reason is stored and shown to staff only; the customer-facing text is never derived from the internal one | P4 |

---

## 22. State machines, edge cases, and cross-cutting

| ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance Criteria | Phase |
|---|---|---|---|---|---|---|---|---|
| RT-344 | State | A transition is a named, permissioned, idempotent operation | MUST | Platform Owner | SM-02, SM-03, SM-04, BI-28 | — | No generic status setter exists; every transition records prior, new, actor, time, reason, correlation; a retry applies once | P2, P3 |
| RT-345 | State | A terminal state has no outgoing edge, asserted on the graph | MUST | Platform Owner | SM-05 | RT-344 | A graph test fails the build on any edge out of a terminal state; run for all twenty-one machines | P3, P5 |
| RT-346 | State | Cancellation and deletion are distinct; documents are cancelled, never deleted | MUST | Platform Owner | SM-08, BI-08, BI-40, BI-15a | RT-291 | No delete path exists on a document; a cancelled document is retained | P2, P3 |
| RT-347 | State | An illegal transition is refused with a named message | MUST | Cashier | SM-06, UX-55 | RT-344 | Each refusal names the attempted transition and why it is illegal | P3, P4 |
| RT-348 | State | Three entities deliberately have no state machine because their state is a projection | MUST | Platform Owner | SM-44, SM-76 | RT-056, RT-165, RT-179 | `StockItem`, `CustomerAccount`, and supplier payable have no state column; their figures are ledger-derived | P2 |
| RT-404 | State | A document's own state is a stored fact, and stored does not mean authoritative: which entity owns the figure decides stored versus projected | MUST | Platform Owner | SM-01, SM-01a, SM-35a | RT-056 | A document never recomputes its own status from its timestamps; a single entity may store a status while projecting its money, and the status column is rebuildable from the counters | P2 |
| RT-405 | State | An unspecified transition attribute is `OPEN DECISION` and is raised, never guessed | MUST | Platform Owner | SM-02a, SM-02b, SM-02c, SM-02d | RT-344 | No cell reads "any" permission; a missing permission, side effect, or audit type is a Phase-2 blocker, while a missing precondition guard is a hardening item, and the two are separately marked | P2 |
| RT-406 | State | A machine is a closed, versioned set of states and transitions defined in the owning document | MUST | Platform Owner | SM-07 | RT-344 | A state added later is a schema change with a migration and a review; no state exists that the owner does not name | P2 |
| RT-407 | State | A `Suspended` or `OnHold` state has a resume edge, a recorded reason, and queue visibility | MUST | Store Manager | SM-09 | RT-344 | A held item names why it is held, can be resumed, and is visible in the queue | P2 |
| RT-408 | State | A machine's state set is the owning document's set, verbatim | MUST | Platform Owner | SM-13a, SM-16a, SM-60, SM-77a, SM-88a, SM-43a, SM-48a| RT-406 | `OutOfStock` and `Hidden` exist on a product and `Blocked` on a batch; a state the owner does not define, such as `Retired` or `WrittenOff`, does not exist | P2 |
| RT-409 | State | `Archived` requires a reason, is terminal, and has no return edge | MUST | Store Manager | SM-13 | RT-345 | Un-archiving is a data-recovery operation, not a business action, and is not a transition | P2 |
| RT-410 | State | `AllowNegative` and `BlockNegative` are the only two stock policies, they change only by a movement that would breach the current policy, and there is no manual override | MUST | Store Manager | SM-14, SM-15 | RT-064 | An employee cannot set a stock item to allow-negative; the transition reason is the breaching movement | P3 |
| RT-411 | State | `Quarantined` is reversible; `Depleted` and `Expired` are not, and `Depleted` is reached by quantity alone | MUST | Store Manager | SM-16, SM-17 | RT-094 | A batch with stock on hand is not `Depleted` whatever a user clicks; reversibility is the difference between a hold and an ending | P3 |
| RT-412 | State | `Expired` is derived at read and stored at the expiry boundary, a required expiry date cannot be omitted, and a dateless batch sorts last under FEFO | MUST | Store Manager | SM-18, SM-19 | RT-088, RT-089 | A batch past expiry is unsellable before the job runs; the stored state exists so the transition is auditable | P3 |
| RT-413 | State | `Rejected`, `Cancelled`, and `Closed` are three distinct endings, and a `Sale` has no `Cancelled` state | MUST | Platform Owner | SM-23, SM-36 | RT-345 | A rejection is a decision, a cancellation a withdrawal, a closure an ending; "cancelled" on a sale is `Voided`, because the words mean different things to a customer | P2 |
| RT-414 | State | A goods receipt creates stock and never a second payable | MUST | Store Manager | SM-27 | RT-106, RT-109 | A GRN against an invoice that already has a payable creates no second payable; the payable is created by the invoice | P3 |
| RT-415 | State | A sale's post-sale states are a projection of its line counters, and the stored status is a cache a rebuild must reproduce exactly | MUST | Platform Owner | SM-35, SP-66| RT-146, RT-161 | A rebuild from `ReturnedQuantity` and `RefundedAmount` reproduces the stored status exactly, or the build fails | P3 |
| RT-416 | State | A return and a refund are linked, not nested | MUST | Store Manager | SM-39 | RT-144 | A return can close with its refund pending, and two refunds can exist against one return | P3 |
| RT-417 | State | A `Failed` refund is retryable and holds the amount | MUST | Store Manager | SM-41 | RT-155 | A refund that cannot be retried is refused, because a customer who was not refunded and cannot be has been failed | P3 |
| RT-418 | State | A customer balance is never state; only the status is, and every status edge is a permissioned human decision with a reason | MUST | Store Manager | SM-45, SM-45b, SM-46 | RT-165, RT-348 | A payment, job, or client takes no edge; a `CreditLimitCheck` result is a projection and is not recorded as state, so a stale limit cannot become authoritative | P3 |
| RT-419 | State | `OnHold` is not a credit control; `CreditBlocked` is the credit control, and it is liftable | MUST | Store Manager | SM-45a, SM-45c | RT-167 | A held customer may still buy and carries a note; goods may not be taken on account while `CreditBlocked`; the block is a standing control, not a terminal state, because a customer who has paid must be able to leave | P3 |
| RT-420 | State | `Declined` and `Failed` payments are retryable by writing a new `Payment`; the `Failed` record itself is terminal; `Voided` and `Captured` are terminal | MUST | Cashier | SM-53, PY-14, PY-54 | RT-256 | A declined or failed payment is retried; a captured payment has no outgoing transition | P3 |
| RT-421 | State | A payment's state is a reconciliation of provider events and the local record | MUST | Platform Owner | SM-54, EC-14 | RT-255, RT-266 | The local transition alone never makes a payment captured; only a provider confirmation does, and the stored state is the reconciliation of both | P3 |
| RT-422 | State | A shift's only forward path is `Open` → `Reconciling` → `Closed`; there is no `Void` state, and a closed shift is immutable except for `Reopened` | MUST | Store Manager | SM-55, SM-57, SM-58, SM-56a| RT-235, RT-246 | The count happens in `Reconciling` with the expected amount hidden; the counted amount, variance, and reason are never edited, a new pass has its own count, and the original stands as history | P3 |
| RT-423 | State | A `PosTerminal`'s mode is configuration, not a lifecycle step, and is separate from its service state | MUST | Store Manager | SM-59 | RT-212 | A terminal in `Training` may not complete a real sale, move stock, or tender; changing mode is audited; a separate service state is what refuses a sale | P3 |
| RT-424 | State | `Degraded` is a real device state, and `Offline` is not `Disabled` | MUST | Platform Owner | SM-60a, SM-60b | RT-213 | A jam-prone printer is `Degraded` rather than `Disabled`, so receipts still print; `Offline` derives from a missed heartbeat and clears when it resumes, while `Disabled` is an audited administrator decision requiring `Device.Disable` | P3 |
| RT-425 | State | An RFID session is `Opened` or `Closed`; there is no `Paused` | MUST | Store Manager | SM-63 | RT-213 | A reader that stops responding closes its session with a reason rather than leaving it open | P3 |
| RT-426 | State | A rejected offline item is retained as evidence with a reason, never deleted from the queue | MUST | Cashier | SM-66 | RT-231 | The cashier's copy of a refused sale exists after the sync attempt, because it is what they tell the customer | P3 |
| RT-427 | State | An offline sale that cannot be synced while the store is closed and the cache is sealed stays `Queued` for the next online window | MUST | Platform Owner | SM-67 | RT-227, RT-223 | The seal records the count, and the item is neither dropped nor attempted against a sealed cache | P3 |
| RT-428 | State | `Pending` is the only non-terminal approval state, and every exit is terminal, reasoned, and audited | MUST | Store Manager | SM-68, SM-71 | RT-277 | Every edge out of `Pending` records a reason and writes an audit event; no state follows `Pending` | P3 |
| RT-429 | State | The state-machine consistency check reports only what it has actually verified | MUST | Platform Owner | SM-75, SM-75a | — | A check that was not performed is recorded as not performed; a check that asserts its own success in prose is a comment, cannot fail, and is reported as no check at all | P2 |
| RT-430 | State | An in-transit transfer is never cancelled | MUST | Warehouse Manager | SM-78 | RT-346 | Cancelling after dispatch would delete an `Out` movement, so the correction is a compensating transfer or an adjustment against the in-transit balance | P3 |
| RT-431 | State | A count posts the counted quantity, and a posted count is never re-posted | MUST | Inventory Manager | SM-81, SM-82 | RT-071, RT-072 | The expected quantity is never an input; the difference becomes `COUNT_VARIANCE_IN` or `COUNT_VARIANCE_OUT`; a wrong count is `Reversed` and re-counted, and a counted quantity is never negative | P3 |
| RT-432 | State | A count may only observe; it cannot resolve a negative balance by counting upward | MUST | Inventory Manager | SM-84 | RT-069 | A count that would increase stock to clear a negative is refused, and the resolution is the receiving or adjustment path instead | P3 |
| RT-433 | State | A revoked tag is never re-issued to a different subject | MUST | Super Administrator | SM-86 | RT-202, RT-208 | Tag identity is permanent and a replacement is a new tag, so a former employee's attendance can never become the next person's | P3 |
| RT-434 | State | A suspended credential is readable but not usable | MUST | Super Administrator | SM-88 | RT-199 | The read is recorded for the investigation; it opens no door and clocks in no one, and recording it is what makes a fraud pattern visible | P3 |
| RT-349 | Edge cases | Every money edge case has a concurrent two-actor test | MUST | Platform Owner | EC-92 | RT-119 | Each of the eleven money cases has an automated test with two concurrent actors where concurrency is possible | P5 |
| RT-478 | Edge Cases | A document with a child document cannot be deleted or cancelled out of order: a purchase order with recorded receipts cannot be deleted, no state machine skips a state, and a sale with a recorded return cannot be voided until that return is reversed | MUST | Store Manager | BI-41 | RT-346 | Cancelling a received purchase order is refused; voiding a sale that has a recorded return is refused until the return is reversed | P3 |
| RT-479 | Edge Cases | A document number is unique per store per document type, is allocated inside the creating transaction, and is never reused - including after cancellation or void | MUST | Platform Owner | BI-42 | RT-234 | After 1,000 sales with 50 cancellations, all 1,000 document numbers are unique; a rolled-back transaction may leave a gap but never a reuse | P3 |
| RT-350 | Edge cases | Every scope edge case is tested at the API boundary | MUST | Store Manager | EC-93, EC-54 | RT-270 | Each scope case is tested against the API, not the UI, because the UI is where scope is bypassed in practice | P5 |
| RT-351 | Edge cases | Every forbidden transition in the catalogue is a regression guard | MUST | Platform Owner | EC-94, EC-85 | RT-345 | Each of the ten cases in EC §11 asserts that the forbidden thing is still refused, so a later shortcut fails a test | P5 |
| RT-352 | Edge cases | Every failure case degrades the feature, not the business operation | MUST | Store Manager | EC-77 | RT-214 | Each of the eight failure cases leaves the till able to trade, except where the record is the operation | P3, P5 |
| RT-353 | Edge cases | Every time question has the server as its single authority | MUST | Platform Owner | EC-68 | RT-234 | A terminal, browser, or user clock cannot set a business date, a timestamp, or an expiry decision | P3 |
| RT-354 | Edge cases | An integrity case is refused, never silently repaired | MUST | Store Manager | EC-46 | RT-056 | Each of the nine integrity cases refuses the operation rather than fixing the data quietly | P3 |
| RT-442 | Edge Cases | The authoritative money amount is the amount applied or settled; a tendered, handed-over, or listed amount is never authoritative | MUST | Platform Owner | EC-23 | RT-132, RT-146 | Refund, change, credit, and report figures each resolve to the applied or settled amount, never to the amount handed over or listed | P3 |
| RT-441 | Edge Cases | No computation leaves an unexplained residual: a documented deterministic rule allocates it, and both sides are asserted to sum | MUST | Platform Owner | EC-21 | RT-048, RT-306 | A sub-cent difference is allocated by the documented rule, and the total of the parts equals the stated total on every rounding path | P3 |
| RT-438 | Edge Cases | Concurrency is resolved by the business transaction with a bound guarantee, never by an application lock, a retry, or a UI check | MUST | Platform Owner | EC-11 | RT-344 | Two real clients against any row citing this produce one success and one refusal; the guard lives in the transaction and the check is absent from the client | P2, P3 |

---

## 23. Priorities in summary

| Priority | Count | Notes |
|---|---|---|
| `MUST` | 325 | Every one carries measurable acceptance criteria above |
| `SHOULD` | 9 | Each names its fallback |
| `COULD` | 4 | Serialised stock, reorder suggestion, loyalty basis, customer display - all named and bounded |
| `OUT OF SCOPE` | 16 | Recorded so it is not re-litigated or accidentally built |
| **Total** | **354** | `RT-001` to `RT-354`, no gaps, no duplicates |

Counts are of requirement rows, not rules, and they are counted from the table rather than asserted. A single
requirement may carry several rules, and a single rule may serve several requirements; the reverse mapping is
generated in §26.

---

## 24. Gaps and known limits of this matrix

**Rule GR-01.** The matrix is at **requirement granularity**, not rule granularity. §26 walks the other
direction and is honest about the result: **819** rules are cited by a requirement row, **320** are not cited
at all and are marked `inferred` with a machine-assigned home, and **0** have no home. **The 320 `inferred` rows
are an open backlog, not coverage.** Until a human moves each id into the requirement row it belongs to, this
document does not claim reverse completeness.

**Rule GR-02.** Acceptance criteria are written to be **testable but not yet tested**. Phase 1 defines what must
be measurable; Phase 3 and Phase 5 implement the tests. **A criterion here is a claim about the future, not
evidence about it.**

**Rule GR-03.** Measurable does not mean implemented. Several criteria name a specific mechanism — a unique
constraint, a graph assertion, a build check, a static-analysis rule — and those mechanisms are themselves
Phase 2 and Phase 3 deliverables that the architecture must honour.

**Rule GR-04.** Licence compatibility is **not** traceable to a rule, because the SmartStore licence is
unresolved. See PHASE-1-REVIEW §6 and §10; this is a real gap in the matrix, not an omission.

**Rule GR-05.** Jurisdictional specifics — tax rates, pharmacy regulation, currency lists, consumer credit
rules — are **not** in this matrix, because they are business decisions not yet taken. They are listed in
PHASE-1-REVIEW §10 as questions that must be answered before architecture.

**Rule GR-06.** The reverse mapping in §26 is **partly generated**. 342 rules were assigned a home by the
generator's nearest-same-namespace heuristic and were labelled `inferred` (335 rule ids plus 7 `PR-Q` question
ids; 320 at audit time, grown by 22 rules added in the Phase 1 correction pass). They are correct in shape - the
rule
exists and a requirement in the right domain plausibly covers it - but **the assignment is a proposal and has not
been reviewed by a person.** This was the largest known defect in Phase 1 and is being closed under C-06; see
`../architecture/C-06-TRACEABILITY-REVIEW.md` for the reviewed batches and the remaining open questions.

---

## 25. Requirement traceability rules index

| ID | Rule |
|---|---|
| GR-01 | The matrix is at requirement granularity; 140 rules are still machine-assigned and unverified |
| GR-02 | Acceptance criteria are testable but not yet tested |
| GR-03 | "Measurable" names a mechanism that Phase 2 and Phase 3 must honour |
| GR-04 | Licence compatibility is absent from the matrix because the licence is unresolved |
| GR-05 | Jurisdictional specifics are absent from the matrix because they are undecided |
| GR-06 | 140 rules are machine-assigned in §26 and await a human confirming the home |


---
---

## 26. Coverage appendix — every rule against the requirement that owns it

**1161 defined rules across 26 rule-bearing documents.** Generated, not hand-written. Three
statuses, and the difference matters:

| Status | Meaning |
|---|---|
| `mapped` | The requirement row cites this rule by id or by range. A human wrote it |
| `inferred` | The rule was **never cited**. The row below is the nearest same-namespace row in the same domain, assigned by the generator. **A human still has to confirm it** |
| `UNMAPPED` | No home could be assigned at all. A real gap |

### 26.1 How this was generated

```
# 1. collect every defined rule id (headings, "**Rule", and first-cell table rows)
# 2. for each RT row, expand N..M ranges and collect the ids it cites  -> explicit map
# 3. for each remaining rule, pick the RT row in the same domain that cites the most
#    ids of the same namespace                                            -> inferred map
# 4. emit this table. Anything in (1) and absent from (2)+(3) is UNMAPPED.
```

### 26.2 Coverage

| Rule | Owning document | Owned by | Status |
|---|---|---|---|
| `AC-01` | actors-and-roles | RT-010 | `mapped` |
| `AC-02` | actors-and-roles | RT-010 | `mapped` |
| `AC-03` | actors-and-roles | RT-010 | `mapped` |
| `AC-04` | actors-and-roles | RT-503 | `mapped` |
| `AP-01` | approval-workflows | RT-043, RT-051, RT-172, RT-240, RT-277, RT-287 | `mapped` |
| `AP-02` | approval-workflows | RT-277, RT-287 | `mapped` |
| `AP-03` | approval-workflows | RT-278 | `mapped` |
| `AP-04` | approval-workflows | RT-382 | `mapped` |
| `AP-05` | approval-workflows | RT-383 | `mapped` |
| `AP-06` | approval-workflows | RT-384 | `mapped` |
| `AP-07` | approval-workflows | RT-280 | `mapped` |
| `AP-08` | approval-workflows | RT-279 | `mapped` |
| `AP-09` | approval-workflows | RT-281 | `mapped` |
| `AP-10` | approval-workflows | RT-284 | `mapped` |
| `AP-11` | approval-workflows | RT-385 | `mapped` |
| `AP-12` | approval-workflows | RT-386 | `mapped` |
| `AP-13` | approval-workflows | RT-386 | `mapped` |
| `AP-14` | approval-workflows | RT-387 | `mapped` |
| `AP-15` | approval-workflows | RT-387 | `mapped` |
| `AP-16` | approval-workflows | RT-282 | `mapped` |
| `AP-17` | approval-workflows | RT-283 | `mapped` |
| `AP-18` | approval-workflows | RT-283 | `mapped` |
| `AP-19` | approval-workflows | RT-283 | `mapped` |
| `AP-20` | approval-workflows | RT-283 | `mapped` |
| `AP-21` | approval-workflows | RT-388 | `mapped` |
| `AP-22` | approval-workflows | RT-388 | `mapped` |
| `AP-23` | approval-workflows | RT-285 | `mapped` |
| `AP-24` | approval-workflows | RT-285 | `mapped` |
| `AP-25` | approval-workflows | RT-389 | `mapped` |
| `AP-26` | approval-workflows | RT-286 | `mapped` |
| `AP-27` | approval-workflows | RT-286 | `mapped` |
| `AP-28` | approval-workflows | RT-377 | `mapped` |
| `AP-29` | approval-workflows | RT-280 | `mapped` |
| `AP-30` | approval-workflows | RT-390 | `mapped` |
| `AP-31` | approval-workflows | RT-289 | `mapped` |
| `AP-32` | approval-workflows | RT-391 | `mapped` |
| `AP-33` | approval-workflows | RT-392 | `mapped` |
| `AP-34` | approval-workflows | RT-393 | `mapped` |
| `AP-35` | approval-workflows | RT-288 | `mapped` |
| `AP-36` | approval-workflows | RT-288 | `mapped` |
| `AP-37` | approval-workflows | RT-288 | `mapped` |
| `AP-38` | approval-workflows | RT-288 | `mapped` |
| `AP-39` | approval-workflows | RT-288 | `mapped` |
| `AP-40` | approval-workflows | RT-279 | `mapped` |
| `AU-01` | audit-domain | RT-290 | `mapped` |
| `AU-02` | audit-domain | RT-291 | `mapped` |
| `AU-03` | audit-domain | RT-020, RT-292 | `mapped` |
| `AU-04` | audit-domain | RT-464 | `mapped` |
| `AU-05` | audit-domain | RT-293 | `mapped` |
| `AU-06` | audit-domain | RT-294 | `mapped` |
| `AU-07` | audit-domain | RT-464 | `mapped` |
| `AU-08` | audit-domain | RT-464 | `mapped` |
| `AU-09` | audit-domain | RT-174, RT-185, RT-295 | `mapped` |
| `AU-10` | audit-domain | RT-123, RT-216 | `mapped` |
| `AU-11` | audit-domain | RT-465 | `mapped` |
| `AU-12` | audit-domain | RT-465 | `mapped` |
| `AU-12b` | audit-domain | RT-465 | `mapped` |
| `AU-12c` | audit-domain | RT-465 | `mapped` |
| `AU-12a` | audit-domain | RT-465 | `mapped` |
| `AU-13` | audit-domain | RT-465 | `mapped` |
| `AU-14` | audit-domain | RT-296 | `mapped` |
| `AU-15` | audit-domain | RT-296, RT-313 | `mapped` |
| `AU-16` | audit-domain | RT-466 | `mapped` |
| `AU-17` | audit-domain | RT-297 | `mapped` |
| `AU-18` | audit-domain | RT-297 | `mapped` |
| `AU-19` | audit-domain | RT-298 | `mapped` |
| `AU-20` | audit-domain | RT-298 | `mapped` |
| `AU-21` | audit-domain | RT-466 | `mapped` |
| `AU-22` | audit-domain | RT-466 | `mapped` |
| `AU-23` | audit-domain | RT-299 | `mapped` |
| `AU-24` | audit-domain | RT-299 | `mapped` |
| `AU-25` | audit-domain | RT-300 | `mapped` |
| `AU-26` | audit-domain | RT-467 | `mapped` |
| `AU-27` | audit-domain | RT-301 | `mapped` |
| `AU-28` | audit-domain | RT-301 | `mapped` |
| `AU-29` | audit-domain | RT-302 | `mapped` |
| `AU-30` | audit-domain | RT-302 | `mapped` |
| `AU-31` | audit-domain | RT-467 | `mapped` |
| `AU-32` | audit-domain | RT-059, RT-291 | `mapped` |
| `AU-33` | audit-domain | RT-303 | `mapped` |
| `AU-34` | audit-domain | RT-468 | `mapped` |
| `AU-35` | audit-domain | RT-468 | `mapped` |
| `BE-01` | batch-expiry-fefo | RT-086 | `mapped` |
| `BE-02` | batch-expiry-fefo | RT-086 | `mapped` |
| `BE-03` | batch-expiry-fefo | RT-086 | `mapped` |
| `BE-04` | batch-expiry-fefo | RT-086 | `mapped` |
| `BE-05` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-06` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-07` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-08` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-09` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-10` | batch-expiry-fefo | RT-458 | `mapped` |
| `BE-11` | batch-expiry-fefo | RT-098 | `mapped` |
| `BE-12` | batch-expiry-fefo | RT-459 | `mapped` |
| `BE-13` | batch-expiry-fefo | RT-459 | `mapped` |
| `BE-14` | batch-expiry-fefo | RT-460 | `mapped` |
| `BE-15` | batch-expiry-fefo | RT-461 | `mapped` |
| `BE-16` | batch-expiry-fefo | RT-090 | `mapped` |
| `BE-17` | batch-expiry-fefo | RT-089 | `mapped` |
| `BE-18` | batch-expiry-fefo | RT-090 | `mapped` |
| `BE-19` | batch-expiry-fefo | RT-088 | `mapped` |
| `BE-20` | batch-expiry-fefo | RT-088 | `mapped` |
| `BE-21` | batch-expiry-fefo | RT-461 | `mapped` |
| `BE-22` | batch-expiry-fefo | RT-461 | `mapped` |
| `BE-23` | batch-expiry-fefo | RT-098 | `mapped` |
| `BE-24` | batch-expiry-fefo | RT-094 | `mapped` |
| `BE-25` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-26` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-27` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-28` | batch-expiry-fefo | RT-092, RT-093 | `mapped` |
| `BE-29` | batch-expiry-fefo | RT-066, RT-092, RT-095 | `mapped` |
| `BE-30` | batch-expiry-fefo | RT-066, RT-092, RT-095 | `mapped` |
| `BE-31` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-32` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-33` | batch-expiry-fefo | RT-092 | `mapped` |
| `BE-34` | batch-expiry-fefo | RT-091 | `mapped` |
| `BE-35` | batch-expiry-fefo | RT-469 | `mapped` |
| `BE-36` | batch-expiry-fefo | RT-096, RT-101, RT-151 | `mapped` |
| `BE-37` | batch-expiry-fefo | RT-097 | `mapped` |
| `BE-38` | batch-expiry-fefo | RT-097 | `mapped` |
| `BE-39` | batch-expiry-fefo | RT-462 | `mapped` |
| `BE-40` | batch-expiry-fefo | RT-045 | `mapped` |
| `BE-41` | batch-expiry-fefo | RT-463 | `mapped` |
| `BE-42` | batch-expiry-fefo | RT-463 | `mapped` |
| `BE-43` | batch-expiry-fefo | RT-463 | `mapped` |
| `BE-44` | batch-expiry-fefo | RT-059 | `mapped` |
| `BE-45` | batch-expiry-fefo | RT-099 | `mapped` |
| `BE-46` | batch-expiry-fefo | RT-099 | `mapped` |
| `BE-47` | batch-expiry-fefo | RT-099 | `mapped` |
| `BE-48` | batch-expiry-fefo | RT-087 | `mapped` |
| `BE-49` | batch-expiry-fefo | RT-087 | `mapped` |
| `BI-01` | business-invariants | RT-048, RT-261 | `mapped` |
| `BI-02` | business-invariants | RT-056 | `mapped` |
| `BI-03` | business-invariants | RT-060 | `mapped` |
| `BI-04` | business-invariants | RT-061, RT-119, RT-215, RT-264 | `mapped` |
| `BI-05` | business-invariants | RT-475 | `mapped` |
| `BI-06` | business-invariants | RT-148 | `mapped` |
| `BI-07` | business-invariants | RT-149 | `mapped` |
| `BI-08` | business-invariants | RT-346 | `mapped` |
| `BI-09` | business-invariants | RT-256 | `mapped` |
| `BI-10` | business-invariants | RT-145, RT-146, RT-336 | `mapped` |
| `BI-11` | business-invariants | RT-034, RT-305 | `mapped` |
| `BI-12` | business-invariants | RT-056, RT-060 | `mapped` |
| `BI-13` | business-invariants | RT-078 | `mapped` |
| `BI-14` | business-invariants | RT-013, RT-014 | `mapped` |
| `BI-15` | business-invariants | RT-059 | `mapped` |
| `BI-15a` | business-invariants | RT-059, RT-062, RT-302, RT-346 | `mapped` |
| `BI-16` | business-invariants | RT-148, RT-476 | `mapped` |
| `BI-17` | business-invariants | RT-151, RT-096 | `mapped` |
| `BI-18` | business-invariants | RT-046, RT-114, RT-130, RT-161 | `mapped` |
| `BI-19` | business-invariants | RT-049, RT-162, RT-171, RT-259, RT-260 | `mapped` |
| `BI-20` | business-invariants | RT-043, RT-010 | `mapped` |
| `BI-21` | business-invariants | RT-010 | `mapped` |
| `BI-22` | business-invariants | RT-010 | `mapped` |
| `BI-23` | business-invariants | RT-290, RT-291 | `mapped` |
| `BI-24` | business-invariants | RT-062, RT-119, RT-139, RT-290, RT-310 | `mapped` |
| `BI-25` | business-invariants | RT-074, RT-138, RT-241 | `mapped` |
| `BI-26` | business-invariants | RT-075, RT-080, RT-194, RT-240, RT-245, RT-279 | `mapped` |
| `BI-27` | business-invariants | RT-075 | `mapped` |
| `BI-28` | business-invariants | RT-123, RT-149, RT-224, RT-344 | `mapped` |
| `BI-29` | business-invariants | RT-210, RT-224 | `mapped` |
| `BI-30` | business-invariants | RT-040 | `mapped` |
| `BI-31` | business-invariants | RT-226 | `mapped` |
| `BI-32` | business-invariants | RT-201 | `mapped` |
| `BI-33` | business-invariants | RT-017, RT-199, RT-293 | `mapped` |
| `BI-34` | business-invariants | RT-291 | `mapped` |
| `BI-35` | business-invariants | RT-477 | `mapped` |
| `BI-36` | business-invariants | RT-064, RT-222 | `mapped` |
| `BI-37` | business-invariants | RT-067 | `mapped` |
| `BI-38` | business-invariants | RT-109 | `mapped` |
| `BI-39` | business-invariants | RT-122, RT-263 | `mapped` |
| `BI-40` | business-invariants | RT-178, RT-190, RT-346 | `mapped` |
| `BI-41` | business-invariants | RT-478 | `mapped` |
| `BI-42` | business-invariants | RT-479 | `mapped` |
| `BI-43` | business-invariants | RT-013 | `mapped` |
| `CD-01` | organization-model | RT-236 | `mapped` |
| `CD-02` | cash-management | RT-192 | `mapped` |
| `CD-03` | cash-management | RT-236 | `mapped` |
| `CD-04` | cash-management | RT-237 | `mapped` |
| `CD-05` | cash-management | RT-005 | `mapped` |
| `CD-06` | cash-management | RT-237 | `mapped` |
| `CD-07` | cash-management | RT-132, RT-135, RT-237 | `mapped` |
| `CD-08` | cash-management | RT-237 | `mapped` |
| `CD-09` | cash-management | RT-237, RT-238 | `mapped` |
| `CD-10` | cash-management | RT-235 | `mapped` |
| `CD-11` | cash-management | RT-235 | `mapped` |
| `CD-12` | cash-management | RT-235 | `mapped` |
| `CD-13` | cash-management | RT-235 | `mapped` |
| `CD-14` | cash-management | RT-235 | `mapped` |
| `CD-15` | cash-management | RT-240 | `mapped` |
| `CD-16` | cash-management | RT-241 | `mapped` |
| `CD-17` | cash-management | RT-242 | `mapped` |
| `CD-18` | cash-management | RT-135, RT-239 | `mapped` |
| `CD-19` | cash-management | RT-525 | `mapped` |
| `CD-20` | cash-management | RT-526 | `mapped` |
| `CD-21` | cash-management | RT-072, RT-243 | `mapped` |
| `CD-22` | cash-management | RT-244 | `mapped` |
| `CD-23` | cash-management | RT-244, RT-245 | `mapped` |
| `CD-24` | cash-management | RT-244 | `mapped` |
| `CD-25` | cash-management | RT-244, RT-246 | `mapped` |
| `CD-26` | cash-management | RT-244, RT-246 | `mapped` |
| `CD-27` | cash-management | RT-156, RT-247 | `mapped` |
| `CD-28` | cash-management | RT-247 | `mapped` |
| `CD-29` | cash-management | RT-247 | `mapped` |
| `CD-30` | cash-management | RT-527 | `mapped` |
| `CD-31` | cash-management | RT-243 | `mapped` |
| `CD-32` | cash-management | RT-248 | `mapped` |
| `CD-33` | cash-management | RT-250 | `mapped` |
| `CD-34` | cash-management | RT-249 | `mapped` |
| `CD-35` | cash-management | RT-528 | `mapped` |
| `CD-36` | cash-management | RT-249 | `mapped` |
| `CD-37` | cash-management | RT-529 | `mapped` |
| `CU-01` | customer-domain | RT-163 | `mapped` |
| `CU-02` | customer-domain | RT-163 | `mapped` |
| `CU-03` | customer-domain | RT-163 | `mapped` |
| `CU-04` | customer-domain | RT-164 | `mapped` |
| `CU-05` | customer-domain | RT-164 | `mapped` |
| `CU-06` | customer-domain | RT-164 | `mapped` |
| `CU-07` | customer-domain | RT-164 | `mapped` |
| `CU-08` | customer-domain | RT-164, RT-175 | `mapped` |
| `CU-09` | customer-domain | RT-511 | `mapped` |
| `CU-10` | customer-domain | RT-512 | `mapped` |
| `CU-11` | customer-domain | RT-165 | `mapped` |
| `CU-12` | customer-domain | RT-513 | `mapped` |
| `CU-13` | customer-domain | RT-166 | `mapped` |
| `CU-14` | customer-domain | RT-166 | `mapped` |
| `CU-15` | customer-domain | RT-166 | `mapped` |
| `CU-16` | customer-domain | RT-166 | `mapped` |
| `CU-17` | customer-domain | RT-166 | `mapped` |
| `CU-18` | customer-domain | RT-166 | `mapped` |
| `CU-19` | customer-domain | RT-166, RT-169 | `mapped` |
| `CU-20` | customer-domain | RT-134, RT-166, RT-169, RT-251 | `mapped` |
| `CU-21` | customer-domain | RT-166, RT-169 | `mapped` |
| `CU-22` | customer-domain | RT-166, RT-168 | `mapped` |
| `CU-23` | customer-domain | RT-166, RT-168 | `mapped` |
| `CU-24` | customer-domain | RT-170, RT-176 | `mapped` |
| `CU-25` | customer-domain | RT-170 | `mapped` |
| `CU-26` | customer-domain | RT-170 | `mapped` |
| `CU-27` | customer-domain | RT-170 | `mapped` |
| `CU-28` | customer-domain | RT-170 | `mapped` |
| `CU-29` | customer-domain | RT-170, RT-172 | `mapped` |
| `CU-30` | customer-domain | RT-170 | `mapped` |
| `CU-31` | customer-domain | RT-170, RT-171 | `mapped` |
| `CU-32` | customer-domain | RT-170 | `mapped` |
| `CU-33` | customer-domain | RT-174 | `mapped` |
| `CU-34` | customer-domain | RT-174 | `mapped` |
| `CU-35` | customer-domain | RT-174, RT-227, RT-261, RT-295 | `mapped` |
| `CU-36` | customer-domain | RT-174 | `mapped` |
| `CU-37` | customer-domain | RT-174 | `mapped` |
| `CU-38` | customer-domain | RT-174 | `mapped` |
| `CU-39` | customer-domain | RT-173 | `mapped` |
| `CU-40` | customer-domain | RT-173 | `mapped` |
| `EC-01` | edge-cases | RT-067 | `mapped` |
| `EC-02` | edge-cases | RT-145 | `mapped` |
| `EC-03` | edge-cases | RT-435 | `mapped` |
| `EC-04` | edge-cases | RT-436 | `mapped` |
| `EC-05` | edge-cases | RT-121 | `mapped` |
| `EC-06` | edge-cases | RT-236 | `mapped` |
| `EC-07` | edge-cases | RT-124 | `mapped` |
| `EC-08` | edge-cases | RT-108 | `mapped` |
| `EC-09` | edge-cases | RT-436 | `mapped` |
| `EC-10` | edge-cases | RT-437 | `mapped` |
| `EC-11` | edge-cases | RT-438 | `mapped` |
| `EC-12` | edge-cases | RT-132 | `mapped` |
| `EC-13` | edge-cases | RT-257 | `mapped` |
| `EC-14` | edge-cases | RT-421 | `mapped` |
| `EC-15` | edge-cases | RT-154 | `mapped` |
| `EC-16` | edge-cases | RT-244 | `mapped` |
| `EC-17` | edge-cases | RT-147 | `mapped` |
| `EC-18` | edge-cases | RT-439 | `mapped` |
| `EC-19` | edge-cases | RT-110 | `mapped` |
| `EC-20` | edge-cases | RT-440 | `mapped` |
| `EC-21` | edge-cases | RT-441 | `mapped` |
| `EC-22` | edge-cases | RT-260 | `mapped` |
| `EC-23` | edge-cases | RT-442 | `mapped` |
| `EC-24` | edge-cases | RT-064 | `mapped` |
| `EC-25` | edge-cases | RT-064 | `mapped` |
| `EC-26` | edge-cases | RT-094, RT-101 | `mapped` |
| `EC-27` | edge-cases | RT-089 | `mapped` |
| `EC-28` | edge-cases | RT-095 | `mapped` |
| `EC-29` | edge-cases | RT-088 | `mapped` |
| `EC-30` | edge-cases | RT-079 | `mapped` |
| `EC-31` | edge-cases | RT-073 | `mapped` |
| `EC-32` | edge-cases | RT-031 | `mapped` |
| `EC-33` | edge-cases | RT-443 | `mapped` |
| `EC-34` | edge-cases | RT-069 | `mapped` |
| `EC-35` | edge-cases | RT-139 | `mapped` |
| `EC-36` | edge-cases | RT-108, RT-152 | `mapped` |
| `EC-37` | edge-cases | RT-444 | `mapped` |
| `EC-38` | edge-cases | RT-167, RT-178 | `mapped` |
| `EC-39` | edge-cases | RT-445 | `mapped` |
| `EC-40` | edge-cases | RT-188 | `mapped` |
| `EC-41` | edge-cases | RT-024 | `mapped` |
| `EC-42` | edge-cases | RT-026 | `mapped` |
| `EC-43` | edge-cases | RT-110 | `mapped` |
| `EC-44` | edge-cases | RT-059 | `mapped` |
| `EC-45` | edge-cases | RT-446 | `mapped` |
| `EC-46` | edge-cases | RT-354 | `mapped` |
| `EC-47` | edge-cases | RT-225 | `mapped` |
| `EC-48` | edge-cases | RT-225 | `mapped` |
| `EC-49` | edge-cases | RT-447 | `mapped` |
| `EC-50` | edge-cases | RT-224 | `mapped` |
| `EC-51` | edge-cases | RT-234 | `mapped` |
| `EC-52` | edge-cases | RT-228 | `mapped` |
| `EC-53` | edge-cases | RT-225 | `mapped` |
| `EC-54` | edge-cases | RT-350 | `mapped` |
| `EC-55` | edge-cases | RT-448 | `mapped` |
| `EC-56` | edge-cases | RT-012 | `mapped` |
| `EC-57` | edge-cases | RT-016 | `mapped` |
| `EC-58` | edge-cases | RT-280 | `mapped` |
| `EC-59` | edge-cases | RT-394 | `mapped` |
| `EC-60` | edge-cases | RT-177 | `mapped` |
| `EC-61` | edge-cases | RT-013 | `mapped` |
| `EC-62` | edge-cases | RT-015 | `mapped` |
| `EC-63` | edge-cases | RT-089 | `mapped` |
| `EC-64` | edge-cases | RT-449 | `mapped` |
| `EC-65` | edge-cases | RT-450 | `mapped` |
| `EC-66` | edge-cases | RT-150 | `mapped` |
| `EC-67` | edge-cases | RT-234 | `mapped` |
| `EC-68` | edge-cases | RT-234, RT-353 | `mapped` |
| `EC-69` | edge-cases | RT-207, RT-214 | `mapped` |
| `EC-70` | edge-cases | RT-038, RT-127 | `mapped` |
| `EC-71` | edge-cases | RT-230 | `mapped` |
| `EC-72` | edge-cases | RT-255 | `mapped` |
| `EC-73` | edge-cases | RT-221 | `mapped` |
| `EC-74` | edge-cases | RT-451 | `mapped` |
| `EC-75` | edge-cases | RT-358 | `mapped` |
| `EC-76` | edge-cases | RT-302 | `mapped` |
| `EC-77` | edge-cases | RT-352 | `mapped` |
| `EC-78` | edge-cases | RT-452 | `mapped` |
| `EC-79` | edge-cases | RT-453 | `mapped` |
| `EC-80` | edge-cases | RT-335 | `mapped` |
| `EC-81` | edge-cases | RT-339 | `mapped` |
| `EC-82` | edge-cases | RT-454 | `mapped` |
| `EC-83` | edge-cases | RT-455 | `mapped` |
| `EC-84` | edge-cases | RT-456 | `mapped` |
| `EC-85` | edge-cases | RT-351 | `mapped` |
| `EC-86` | edge-cases | RT-457 | `mapped` |
| `EC-87` | edge-cases | RT-448 | `mapped` |
| `EC-88` | edge-cases | RT-448 | `mapped` |
| `EC-89` | edge-cases | RT-445 | `mapped` |
| `EC-90` | edge-cases | RT-276 | `mapped` |
| `EC-91` | edge-cases | RT-001 | `mapped` |
| `EC-92` | edge-cases | RT-349 | `mapped` |
| `EC-93` | edge-cases | RT-350 | `mapped` |
| `EC-94` | edge-cases | RT-351 | `mapped` |
| `EM-01` | employee-domain | RT-017, RT-187 | `mapped` |
| `EM-02` | employee-domain | RT-017, RT-187 | `mapped` |
| `EM-03` | employee-domain | RT-017, RT-187 | `mapped` |
| `EM-04` | employee-domain | RT-017, RT-187 | `mapped` |
| `EM-05` | employee-domain | RT-514 | `mapped` |
| `EM-06` | employee-domain | RT-515 | `mapped` |
| `EM-07` | employee-domain | RT-516 | `mapped` |
| `EM-08` | employee-domain | RT-189 | `mapped` |
| `EM-09` | employee-domain | RT-189 | `mapped` |
| `EM-10` | employee-domain | RT-189 | `mapped` |
| `EM-11` | employee-domain | RT-189 | `mapped` |
| `EM-12` | employee-domain | RT-002, RT-190, RT-191 | `mapped` |
| `EM-13` | employee-domain | RT-002, RT-191 | `mapped` |
| `EM-14` | employee-domain | RT-002, RT-191 | `mapped` |
| `EM-15` | employee-domain | RT-002, RT-191 | `mapped` |
| `EM-16` | employee-domain | RT-002, RT-191 | `mapped` |
| `EM-17` | employee-domain | RT-192 | `mapped` |
| `EM-18` | employee-domain | RT-192 | `mapped` |
| `EM-19` | employee-domain | RT-192 | `mapped` |
| `EM-20` | employee-domain | RT-192 | `mapped` |
| `EM-21` | employee-domain | RT-193 | `mapped` |
| `EM-22` | employee-domain | RT-193 | `mapped` |
| `EM-23` | employee-domain | RT-193 | `mapped` |
| `EM-24` | employee-domain | RT-193, RT-194 | `mapped` |
| `EM-25` | employee-domain | RT-193 | `mapped` |
| `EM-26` | employee-domain | RT-193 | `mapped` |
| `EM-27` | employee-domain | RT-193 | `mapped` |
| `EM-28` | employee-domain | RT-196 | `mapped` |
| `EM-29` | employee-domain | RT-196 | `mapped` |
| `EM-30` | employee-domain | RT-196 | `mapped` |
| `EM-31` | employee-domain | RT-196 | `mapped` |
| `EM-32` | employee-domain | RT-195 | `mapped` |
| `HD-01` | hardware-domain | RT-211, RT-220 | `mapped` |
| `HD-02` | hardware-domain | RT-211 | `mapped` |
| `HD-03` | hardware-domain | RT-212, RT-219 | `mapped` |
| `HD-04` | hardware-domain | RT-212 | `mapped` |
| `HD-05` | hardware-domain | RT-212 | `mapped` |
| `HD-06` | hardware-domain | RT-212, RT-220 | `mapped` |
| `HD-07` | hardware-domain | RT-212 | `mapped` |
| `HD-08` | hardware-domain | RT-212 | `mapped` |
| `HD-09` | hardware-domain | RT-213 | `mapped` |
| `HD-10` | hardware-domain | RT-213 | `mapped` |
| `HD-11` | hardware-domain | RT-213 | `mapped` |
| `HD-12` | hardware-domain | RT-213 | `mapped` |
| `HD-13` | hardware-domain | RT-517 | `mapped` |
| `HD-14` | hardware-domain | RT-477 | `mapped` |
| `HD-15` | hardware-domain | RT-518 | `mapped` |
| `HD-16` | hardware-domain | RT-206 | `mapped` |
| `HD-17` | hardware-domain | RT-214, RT-215 | `mapped` |
| `HD-18` | hardware-domain | RT-214 | `mapped` |
| `HD-19` | hardware-domain | RT-207, RT-214 | `mapped` |
| `HD-20` | hardware-domain | RT-214 | `mapped` |
| `HD-21` | hardware-domain | RT-214 | `mapped` |
| `HD-22` | hardware-domain | RT-214 | `mapped` |
| `HD-23` | hardware-domain | RT-216 | `mapped` |
| `HD-24` | hardware-domain | RT-216 | `mapped` |
| `HD-25` | hardware-domain | RT-216 | `mapped` |
| `HD-26` | hardware-domain | RT-212, RT-217 | `mapped` |
| `HD-27` | hardware-domain | RT-212, RT-217 | `mapped` |
| `HD-28` | hardware-domain | RT-212, RT-217 | `mapped` |
| `HD-29` | hardware-domain | RT-212, RT-217 | `mapped` |
| `HD-30` | hardware-domain | RT-218 | `mapped` |
| `HD-31` | hardware-domain | RT-218 | `mapped` |
| `HD-32` | hardware-domain | RT-218 | `mapped` |
| `HD-33` | hardware-domain | RT-218 | `mapped` |
| `HD-34` | hardware-domain | RT-218 | `mapped` |
| `IV-01` | inventory-domain | RT-057 | `mapped` |
| `IV-02` | inventory-domain | RT-057 | `mapped` |
| `IV-03` | inventory-domain | RT-057 | `mapped` |
| `IV-04` | inventory-domain | RT-057 | `mapped` |
| `IV-05` | inventory-domain | RT-056, RT-059 | `mapped` |
| `IV-06` | inventory-domain | RT-056 | `mapped` |
| `IV-07` | inventory-domain | RT-056, RT-061 | `mapped` |
| `IV-08` | inventory-domain | RT-061 | `mapped` |
| `IV-09` | inventory-domain | RT-064 | `mapped` |
| `IV-10` | inventory-domain | RT-064 | `mapped` |
| `IV-11` | inventory-domain | RT-058, RT-070 | `mapped` |
| `IV-12` | inventory-domain | RT-058 | `mapped` |
| `IV-13` | inventory-domain | RT-058 | `mapped` |
| `IV-14` | inventory-domain | RT-060 | `mapped` |
| `IV-15` | inventory-domain | RT-060, RT-062, RT-070 | `mapped` |
| `IV-16` | inventory-domain | RT-483 | `mapped` |
| `IV-17` | inventory-domain | RT-484 | `mapped` |
| `IV-18` | inventory-domain | RT-070, RT-485 | `mapped` |
| `IV-19` | inventory-domain | RT-065 | `mapped` |
| `IV-19a` | inventory-domain | RT-066 | `mapped` |
| `IV-20` | inventory-domain | RT-068 | `mapped` |
| `IV-21` | inventory-domain | RT-067 | `mapped` |
| `IV-22` | inventory-domain | RT-067 | `mapped` |
| `IV-23` | inventory-domain | RT-067 | `mapped` |
| `IV-24` | inventory-domain | RT-067 | `mapped` |
| `IV-25` | inventory-domain | RT-071 | `mapped` |
| `IV-26` | inventory-domain | RT-071, RT-073 | `mapped` |
| `IV-27` | inventory-domain | RT-071 | `mapped` |
| `IV-28` | inventory-domain | RT-071 | `mapped` |
| `IV-29` | inventory-domain | RT-071 | `mapped` |
| `IV-30` | inventory-domain | RT-071 | `mapped` |
| `IV-31` | inventory-domain | RT-071, RT-072 | `mapped` |
| `IV-32` | inventory-domain | RT-486 | `mapped` |
| `IV-33` | inventory-domain | RT-074 | `mapped` |
| `IV-34` | inventory-domain | RT-475 | `mapped` |
| `IV-35` | inventory-domain | RT-075 | `mapped` |
| `IV-36` | inventory-domain | RT-076 | `mapped` |
| `IV-37` | inventory-domain | RT-077 | `mapped` |
| `IV-38` | inventory-domain | RT-069 | `mapped` |
| `IV-39` | inventory-domain | RT-078 | `mapped` |
| `IV-40` | inventory-domain | RT-078, RT-081 | `mapped` |
| `IV-41` | inventory-domain | RT-078 | `mapped` |
| `IV-42` | inventory-domain | RT-078, RT-080 | `mapped` |
| `IV-43` | inventory-domain | RT-078 | `mapped` |
| `IV-44` | inventory-domain | RT-078, RT-079 | `mapped` |
| `IV-45` | inventory-domain | RT-078 | `mapped` |
| `IV-46` | inventory-domain | RT-082 | `mapped` |
| `IV-47` | inventory-domain | RT-082 | `mapped` |
| `IV-48` | inventory-domain | RT-082 | `mapped` |
| `IV-49` | inventory-domain | RT-083, RT-141 | `mapped` |
| `IV-50` | inventory-domain | RT-084 | `mapped` |
| `IV-51` | inventory-domain | RT-063 | `mapped` |
| `IV-52` | inventory-domain | RT-063 | `mapped` |
| `IV-53` | inventory-domain | RT-063 | `mapped` |
| `IV-54` | inventory-domain | RT-045, RT-085 | `mapped` |
| `IV-55` | inventory-domain | RT-085 | `mapped` |
| `IV-56` | inventory-domain | RT-085 | `mapped` |
| `IV-57` | inventory-domain | RT-085 | `mapped` |
| `IV-59` | inventory-domain | RT-487 | `mapped` |
| `MS-01` | multi-store-domain | RT-001, RT-269 | `mapped` |
| `MS-02` | multi-store-domain | RT-001, RT-269 | `mapped` |
| `MS-03` | multi-store-domain | RT-270 | `mapped` |
| `MS-04` | multi-store-domain | RT-013, RT-309 | `mapped` |
| `MS-05` | multi-store-domain | RT-014, RT-083 | `mapped` |
| `MS-06` | multi-store-domain | RT-270, RT-318 | `mapped` |
| `MS-07` | multi-store-domain | RT-015, RT-338 | `mapped` |
| `MS-08` | multi-store-domain | RT-016 | `mapped` |
| `MS-09` | multi-store-domain | RT-015 | `mapped` |
| `MS-10` | multi-store-domain | RT-394 | `mapped` |
| `MS-11` | multi-store-domain | RT-271 | `mapped` |
| `MS-12` | multi-store-domain | RT-271 | `mapped` |
| `MS-13` | multi-store-domain | RT-012 | `mapped` |
| `MS-14` | multi-store-domain | RT-395 | `mapped` |
| `MS-15` | multi-store-domain | RT-004 | `mapped` |
| `MS-16` | multi-store-domain | RT-276 | `mapped` |
| `MS-17` | multi-store-domain | RT-057 | `mapped` |
| `MS-18` | multi-store-domain | RT-004 | `mapped` |
| `MS-19` | multi-store-domain | RT-276 | `mapped` |
| `MS-20` | multi-store-domain | RT-081, RT-275 | `mapped` |
| `MS-21` | multi-store-domain | RT-081 | `mapped` |
| `MS-22` | multi-store-domain | RT-275 | `mapped` |
| `MS-23` | multi-store-domain | RT-079 | `mapped` |
| `MS-24` | multi-store-domain | RT-272, RT-304 | `mapped` |
| `MS-25` | multi-store-domain | RT-019 | `mapped` |
| `MS-26` | multi-store-domain | RT-273 | `mapped` |
| `MS-27` | multi-store-domain | RT-274 | `mapped` |
| `MS-28` | multi-store-domain | RT-175 | `mapped` |
| `MS-29` | multi-store-domain | RT-396 | `mapped` |
| `MS-30` | multi-store-domain | RT-007 | `mapped` |
| `MS-31` | multi-store-domain | RT-008 | `mapped` |
| `MS-32` | multi-store-domain | RT-274 | `mapped` |
| `MS-33` | multi-store-domain | RT-274 | `mapped` |
| `MS-34` | multi-store-domain | RT-274 | `mapped` |
| `MS-35` | multi-store-domain | RT-397 | `mapped` |
| `NT-01` | notification-domain | RT-317 | `mapped` |
| `NT-02` | notification-domain | RT-317 | `mapped` |
| `NT-03` | notification-domain | RT-091, RT-231, RT-267 | `mapped` |
| `NT-04` | notification-domain | RT-317 | `mapped` |
| `NT-05` | notification-domain | RT-289, RT-320 | `mapped` |
| `NT-06` | notification-domain | RT-320 | `mapped` |
| `NT-07` | notification-domain | RT-318 | `mapped` |
| `NT-08` | notification-domain | RT-318 | `mapped` |
| `NT-09` | notification-domain | RT-318 | `mapped` |
| `NT-10` | notification-domain | RT-318 | `mapped` |
| `NT-11` | notification-domain | RT-319 | `mapped` |
| `NT-12` | notification-domain | RT-319 | `mapped` |
| `NT-13` | notification-domain | RT-355 | `mapped` |
| `NT-14` | notification-domain | RT-321 | `mapped` |
| `NT-15` | notification-domain | RT-356 | `mapped` |
| `NT-16` | notification-domain | RT-355 | `mapped` |
| `NT-17` | notification-domain | RT-357 | `mapped` |
| `NT-18` | notification-domain | RT-358 | `mapped` |
| `NT-19` | notification-domain | RT-322 | `mapped` |
| `NT-20` | notification-domain | RT-322 | `mapped` |
| `NT-21` | notification-domain | RT-323 | `mapped` |
| `NT-22` | notification-domain | RT-323 | `mapped` |
| `NT-23` | notification-domain | RT-359 | `mapped` |
| `NT-24` | notification-domain | RT-359 | `mapped` |
| `NT-25` | notification-domain | RT-325 | `mapped` |
| `NT-26` | notification-domain | RT-325 | `mapped` |
| `NT-27` | notification-domain | RT-324 | `mapped` |
| `NT-28` | notification-domain | RT-324 | `mapped` |
| `NT-29` | notification-domain | RT-324 | `mapped` |
| `NT-30` | notification-domain | RT-360 | `mapped` |
| `NT-31` | notification-domain | RT-361 | `mapped` |
| `NT-32` | notification-domain | RT-326 | `mapped` |
| `NT-33` | notification-domain | RT-326 | `mapped` |
| `NT-34` | notification-domain | RT-326 | `mapped` |
| `NT-35` | notification-domain | RT-326 | `mapped` |
| `NT-36` | notification-domain | RT-326 | `mapped` |
| `NT-37` | notification-domain | RT-362 | `mapped` |
| `OF-01` | offline-pos-domain | RT-221 | `mapped` |
| `OF-02` | offline-pos-domain | RT-221 | `mapped` |
| `OF-03` | offline-pos-domain | RT-221 | `mapped` |
| `OF-04` | offline-pos-domain | RT-221, RT-222 | `mapped` |
| `OF-05` | offline-pos-domain | RT-221, RT-230 | `mapped` |
| `OF-06` | offline-pos-domain | RT-221, RT-233 | `mapped` |
| `OF-07` | offline-pos-domain | RT-227 | `mapped` |
| `OF-08` | offline-pos-domain | RT-227 | `mapped` |
| `OF-09` | offline-pos-domain | RT-227 | `mapped` |
| `OF-10` | offline-pos-domain | RT-227 | `mapped` |
| `OF-11` | offline-pos-domain | RT-227 | `mapped` |
| `OF-12` | offline-pos-domain | RT-229 | `mapped` |
| `OF-13` | offline-pos-domain | RT-228, RT-229 | `mapped` |
| `OF-14` | offline-pos-domain | RT-229 | `mapped` |
| `OF-15` | offline-pos-domain | RT-229 | `mapped` |
| `OF-16` | offline-pos-domain | RT-229 | `mapped` |
| `OF-17` | offline-pos-domain | RT-223 | `mapped` |
| `OF-18` | offline-pos-domain | RT-223 | `mapped` |
| `OF-19` | offline-pos-domain | RT-223 | `mapped` |
| `OF-20` | offline-pos-domain | RT-223 | `mapped` |
| `OF-21` | offline-pos-domain | RT-223 | `mapped` |
| `OF-22` | offline-pos-domain | RT-224 | `mapped` |
| `OF-23` | offline-pos-domain | RT-231 | `mapped` |
| `OF-24` | offline-pos-domain | RT-470 | `mapped` |
| `OF-25` | offline-pos-domain | RT-234 | `mapped` |
| `OF-26` | offline-pos-domain | RT-231 | `mapped` |
| `OF-27` | offline-pos-domain | RT-471 | `mapped` |
| `OF-28` | offline-pos-domain | RT-471 | `mapped` |
| `OF-29` | offline-pos-domain | RT-225 | `mapped` |
| `OF-30` | offline-pos-domain | RT-225, RT-342 | `mapped` |
| `OF-31` | offline-pos-domain | RT-225 | `mapped` |
| `OF-32` | offline-pos-domain | RT-225 | `mapped` |
| `OF-33` | offline-pos-domain | RT-225 | `mapped` |
| `OF-34` | offline-pos-domain | RT-225 | `mapped` |
| `OF-35` | offline-pos-domain | RT-225, RT-226 | `mapped` |
| `OF-36` | offline-pos-domain | RT-225, RT-226 | `mapped` |
| `OF-37` | offline-pos-domain | RT-225 | `mapped` |
| `OF-38` | offline-pos-domain | RT-064, RT-222 | `mapped` |
| `OF-39` | offline-pos-domain | RT-066 | `mapped` |
| `OF-40` | offline-pos-domain | RT-472 | `mapped` |
| `OF-41` | offline-pos-domain | RT-473 | `mapped` |
| `OF-42` | offline-pos-domain | RT-446 | `mapped` |
| `OF-43` | offline-pos-domain | RT-017 | `mapped` |
| `OF-44` | offline-pos-domain | RT-474 | `mapped` |
| `OF-45` | offline-pos-domain | RT-223 | `mapped` |
| `OF-46` | offline-pos-domain | RT-232 | `mapped` |
| `OF-47` | offline-pos-domain | RT-232 | `mapped` |
| `OF-48` | offline-pos-domain | RT-232 | `mapped` |
| `OF-49` | offline-pos-domain | RT-232 | `mapped` |
| `OF-50` | offline-pos-domain | RT-232 | `mapped` |
| `ORG-01` | organization-model | RT-504 | `mapped` |
| `ORG-02` | organization-model | RT-505 | `mapped` |
| `ORG-03` | organization-model | RT-506 | `mapped` |
| `ORG-04` | organization-model | RT-507 | `mapped` |
| `ORG-05` | organization-model | RT-508 | `mapped` |
| `PC-01` | actors-and-roles | RT-020 | `mapped` |
| `PC-02` | actors-and-roles | RT-020 | `mapped` |
| `PC-03` | actors-and-roles | RT-020 | `mapped` |
| `PC-04` | actors-and-roles | RT-020 | `mapped` |
| `PC-05` | actors-and-roles | RT-020 | `mapped` |
| `PR-01` | product-domain | RT-021, RT-022 | `mapped` |
| `PR-02` | product-domain | RT-021, RT-028 | `mapped` |
| `PR-03` | product-domain | RT-021, RT-030 | `mapped` |
| `PR-04` | product-domain | RT-026 | `mapped` |
| `PR-05` | product-domain | RT-027 | `mapped` |
| `PR-06` | product-domain | RT-488 | `mapped` |
| `PR-07` | product-domain | RT-029 | `mapped` |
| `PR-08` | product-domain | RT-023, RT-024 | `mapped` |
| `PR-09` | product-domain | RT-025 | `mapped` |
| `PR-10` | product-domain | RT-025 | `mapped` |
| `PR-11` | product-domain | RT-489 | `mapped` |
| `PR-12` | product-domain | RT-490 | `mapped` |
| `PR-13` | product-domain | RT-023 | `mapped` |
| `PR-14` | product-domain | RT-491 | `mapped` |
| `PR-15` | product-domain | RT-033 | `mapped` |
| `PR-16` | product-domain | RT-033, RT-035 | `mapped` |
| `PR-17` | product-domain | RT-037 | `mapped` |
| `PR-18` | product-domain | RT-037 | `mapped` |
| `PR-19` | product-domain | RT-036 | `mapped` |
| `PR-20` | product-domain | RT-035, RT-036 | `mapped` |
| `PR-21` | product-domain | RT-036 | `mapped` |
| `PR-22` | product-domain | RT-034 | `mapped` |
| `PR-23` | product-domain | RT-035 | `mapped` |
| `PR-24` | product-domain | RT-038 | `mapped` |
| `PR-25` | product-domain | RT-038 | `mapped` |
| `PR-26` | product-domain | RT-038 | `mapped` |
| `PR-27` | product-domain | RT-038, RT-039 | `mapped` |
| `PR-28` | product-domain | RT-038, RT-127 | `mapped` |
| `PR-29` | product-domain | RT-038 | `mapped` |
| `PR-30` | product-domain | RT-040 | `mapped` |
| `PR-31` | product-domain | RT-040 | `mapped` |
| `PR-32` | product-domain | RT-041 | `mapped` |
| `PR-33` | product-domain | RT-043 | `mapped` |
| `PR-34` | product-domain | RT-042 | `mapped` |
| `PR-35` | product-domain | RT-044, RT-045 | `mapped` |
| `PR-36` | product-domain | RT-044 | `mapped` |
| `PR-37` | product-domain | RT-047 | `mapped` |
| `PR-38` | product-domain | RT-046 | `mapped` |
| `PR-39` | product-domain | RT-492 | `mapped` |
| `PR-40` | product-domain | RT-493 | `mapped` |
| `PR-41` | product-domain | RT-048 | `mapped` |
| `PR-42` | product-domain | RT-049, RT-131 | `mapped` |
| `PR-43` | product-domain | RT-050 | `mapped` |
| `PR-44` | product-domain | RT-050, RT-052 | `mapped` |
| `PR-45` | product-domain | RT-494 | `mapped` |
| `PR-46` | product-domain | RT-031 | `mapped` |
| `PR-47` | product-domain | RT-031 | `mapped` |
| `PR-48` | product-domain | RT-495 | `mapped` |
| `PR-49` | product-domain | RT-032 | `mapped` |
| `PR-50` | product-domain | RT-032 | `mapped` |
| `PR-51` | product-domain | RT-053 | `mapped` |
| `PR-52` | product-domain | RT-496 | `mapped` |
| `PR-53` | product-domain | RT-054 | `mapped` |
| `PR-54` | product-domain | RT-055 | `mapped` |
| `PR-55` | product-domain | RT-048, RT-055, RT-308 | `mapped` |
| `PR-Q01` | procurement-domain | RT-102 | `mapped` |
| `PR-Q02` | procurement-domain | RT-102, RT-103 | `mapped` |
| `PR-Q03` | procurement-domain | RT-102 | `mapped` |
| `PR-Q04` | procurement-domain | RT-497 | `mapped` |
| `PR-Q05` | procurement-domain | RT-498 | `mapped` |
| `PR-Q06` | procurement-domain | RT-499 | `mapped` |
| `PR-Q06a` | procurement-domain | RT-117 | `mapped` |
| `PR-Q07` | procurement-domain | RT-498 | `mapped` |
| `PR-Q08` | procurement-domain | RT-500 | `mapped` |
| `PR-Q09` | procurement-domain | RT-115 | `mapped` |
| `PR-Q10` | procurement-domain | RT-501 | `mapped` |
| `PR-Q11` | procurement-domain | RT-106 | `mapped` |
| `PR-Q12` | procurement-domain | RT-106 | `mapped` |
| `PR-Q13` | procurement-domain | RT-106 | `mapped` |
| `PR-Q14` | procurement-domain | RT-106 | `mapped` |
| `PR-Q15` | procurement-domain | RT-106, RT-108 | `mapped` |
| `PR-Q16` | procurement-domain | RT-106, RT-108 | `mapped` |
| `PR-Q17` | procurement-domain | RT-106, RT-108 | `mapped` |
| `PR-Q18` | procurement-domain | RT-105, RT-106, RT-108 | `mapped` |
| `PR-Q19` | procurement-domain | RT-106, RT-108 | `mapped` |
| `PR-Q20` | procurement-domain | RT-106, RT-107 | `mapped` |
| `PR-Q21` | procurement-domain | RT-106 | `mapped` |
| `PR-Q22` | procurement-domain | RT-106, RT-109 | `mapped` |
| `PR-Q23` | procurement-domain | RT-109 | `mapped` |
| `PR-Q24` | procurement-domain | RT-109 | `mapped` |
| `PR-Q25` | procurement-domain | RT-110 | `mapped` |
| `PR-Q26` | procurement-domain | RT-110 | `mapped` |
| `PR-Q27` | procurement-domain | RT-110 | `mapped` |
| `PR-Q28` | procurement-domain | RT-110 | `mapped` |
| `PR-Q29` | procurement-domain | RT-112 | `mapped` |
| `PR-Q30` | procurement-domain | RT-112 | `mapped` |
| `PR-Q31` | procurement-domain | RT-112 | `mapped` |
| `PR-Q32` | procurement-domain | RT-112 | `mapped` |
| `PR-Q33` | procurement-domain | RT-112 | `mapped` |
| `PR-Q34` | procurement-domain | RT-113 | `mapped` |
| `PR-Q35` | procurement-domain | RT-113 | `mapped` |
| `PR-Q36` | procurement-domain | RT-113 | `mapped` |
| `PR-Q37` | procurement-domain | RT-113 | `mapped` |
| `PR-Q38` | procurement-domain | RT-114 | `mapped` |
| `PR-Q39` | procurement-domain | RT-114 | `mapped` |
| `PR-Q40` | procurement-domain | RT-114 | `mapped` |
| `PR-Q41` | procurement-domain | RT-116 | `mapped` |
| `PT-01` | organization-model | RT-005, RT-122 | `mapped` |
| `PT-02` | organization-model | RT-005 | `mapped` |
| `PT-03` | organization-model | RT-005 | `mapped` |
| `PT-04` | organization-model | RT-005 | `mapped` |
| `PY-01` | payment-domain | RT-251 | `mapped` |
| `PY-02` | payment-domain | RT-132 | `mapped` |
| `PY-03` | payment-domain | RT-252 | `mapped` |
| `PY-04` | payment-domain | RT-252 | `mapped` |
| `PY-05` | payment-domain | RT-252 | `mapped` |
| `PY-06` | payment-domain | RT-252, RT-262 | `mapped` |
| `PY-07` | payment-domain | RT-253 | `mapped` |
| `PY-08` | payment-domain | RT-211, RT-253 | `mapped` |
| `PY-09` | payment-domain | RT-253, RT-254 | `mapped` |
| `PY-10` | payment-domain | RT-253 | `mapped` |
| `PY-11` | payment-domain | RT-136, RT-255, RT-333 | `mapped` |
| `PY-12` | payment-domain | RT-256 | `mapped` |
| `PY-13` | payment-domain | RT-257 | `mapped` |
| `PY-14` | payment-domain | RT-420, RT-256, RT-137 | `mapped` |
| `PY-15` | payment-domain | RT-480 | `mapped` |
| `PY-16` | payment-domain | RT-133 | `mapped` |
| `PY-17` | payment-domain | RT-257 | `mapped` |
| `PY-18` | payment-domain | RT-134 | `mapped` |
| `PY-19` | payment-domain | RT-481 | `mapped` |
| `PY-20` | payment-domain | RT-257 | `mapped` |
| `PY-21` | payment-domain | RT-144, RT-154 | `mapped` |
| `PY-22` | payment-domain | RT-145, RT-258 | `mapped` |
| `PY-23` | payment-domain | RT-155 | `mapped` |
| `PY-24` | payment-domain | RT-145 | `mapped` |
| `PY-25` | payment-domain | RT-154 | `mapped` |
| `PY-26` | payment-domain | RT-157 | `mapped` |
| `PY-27` | payment-domain | RT-156 | `mapped` |
| `PY-28` | payment-domain | RT-158 | `mapped` |
| `PY-29` | payment-domain | RT-259 | `mapped` |
| `PY-30` | payment-domain | RT-259 | `mapped` |
| `PY-31` | payment-domain | RT-162, RT-259, RT-260 | `mapped` |
| `PY-32` | payment-domain | RT-259 | `mapped` |
| `PY-33` | payment-domain | RT-259 | `mapped` |
| `PY-34` | payment-domain | RT-209 | `mapped` |
| `PY-35` | payment-domain | RT-482 | `mapped` |
| `PY-36` | payment-domain | RT-120, RT-264 | `mapped` |
| `PY-37` | payment-domain | RT-265 | `mapped` |
| `PY-38` | payment-domain | RT-121 | `mapped` |
| `PY-39` | payment-domain | RT-121 | `mapped` |
| `PY-40` | payment-domain | RT-266 | `mapped` |
| `PY-41` | payment-domain | RT-136, RT-255 | `mapped` |
| `PY-42` | payment-domain | RT-267 | `mapped` |
| `PY-43` | payment-domain | RT-261 | `mapped` |
| `PY-44` | payment-domain | RT-261, RT-295 | `mapped` |
| `PY-45` | payment-domain | RT-262 | `mapped` |
| `PY-46` | payment-domain | RT-263 | `mapped` |
| `PY-47` | payment-domain | RT-230 | `mapped` |
| `PY-48` | payment-domain | RT-230 | `mapped` |
| `PY-49` | payment-domain | RT-268 | `mapped` |
| `PY-50` | payment-domain | RT-268 | `mapped` |
| `PY-51` | payment-domain | RT-268 | `mapped` |
| `PY-52` | payment-domain | RT-268 | `mapped` |
| `PY-53` | payment-domain | RT-268 | `mapped` |
| `PY-54` | payment-domain | RT-420, RT-256 | `mapped` |
| `RF-01` | rfid-domain | RT-199 | `mapped` |
| `RF-02` | rfid-domain | RT-199 | `mapped` |
| `RF-03` | rfid-domain | RT-199 | `mapped` |
| `RF-04` | rfid-domain | RT-202 | `mapped` |
| `RF-05` | rfid-domain | RT-202 | `mapped` |
| `RF-06` | rfid-domain | RT-202 | `mapped` |
| `RF-07` | rfid-domain | RT-202, RT-203 | `mapped` |
| `RF-08` | rfid-domain | RT-202, RT-203, RT-209 | `mapped` |
| `RF-09` | rfid-domain | RT-519 | `mapped` |
| `RF-10` | rfid-domain | RT-201 | `mapped` |
| `RF-11` | rfid-domain | RT-520 | `mapped` |
| `RF-12` | rfid-domain | RT-477 | `mapped` |
| `RF-13` | rfid-domain | RT-521 | `mapped` |
| `RF-14` | rfid-domain | RT-204 | `mapped` |
| `RF-15` | rfid-domain | RT-204, RT-205 | `mapped` |
| `RF-16` | rfid-domain | RT-204, RT-205 | `mapped` |
| `RF-17` | rfid-domain | RT-204, RT-205 | `mapped` |
| `RF-18` | rfid-domain | RT-204, RT-205 | `mapped` |
| `RF-19` | rfid-domain | RT-197, RT-204, RT-205 | `mapped` |
| `RF-20` | rfid-domain | RT-200 | `mapped` |
| `RF-21` | rfid-domain | RT-200 | `mapped` |
| `RF-22` | rfid-domain | RT-200 | `mapped` |
| `RF-23` | rfid-domain | RT-200 | `mapped` |
| `RF-24` | rfid-domain | RT-200 | `mapped` |
| `RF-25` | rfid-domain | RT-208 | `mapped` |
| `RF-26` | rfid-domain | RT-208 | `mapped` |
| `RF-27` | rfid-domain | RT-208 | `mapped` |
| `RF-28` | rfid-domain | RT-208 | `mapped` |
| `RF-29` | rfid-domain | RT-201 | `mapped` |
| `RF-30` | rfid-domain | RT-201 | `mapped` |
| `RF-31` | rfid-domain | RT-201 | `mapped` |
| `RF-32` | rfid-domain | RT-201 | `mapped` |
| `RF-33` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RF-34` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RF-35` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RF-36` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RF-37` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RF-38` | rfid-domain | RT-206, RT-210 | `mapped` |
| `RP-01` | reporting-domain | RT-398 | `mapped` |
| `RP-02` | reporting-domain | RT-301 | `mapped` |
| `RP-03` | reporting-domain | RT-399 | `mapped` |
| `RP-04` | reporting-domain | RT-272, RT-304 | `mapped` |
| `RP-05` | reporting-domain | RT-272 | `mapped` |
| `RP-06` | reporting-domain | RT-400 | `mapped` |
| `RP-07` | reporting-domain | RT-400 | `mapped` |
| `RP-08` | reporting-domain | RT-176 | `mapped` |
| `RP-09` | reporting-domain | RT-308 | `mapped` |
| `RP-10` | reporting-domain | RT-305 | `mapped` |
| `RP-11` | reporting-domain | RT-306 | `mapped` |
| `RP-12` | reporting-domain | RT-306 | `mapped` |
| `RP-13` | reporting-domain | RT-248, RT-307 | `mapped` |
| `RP-14` | reporting-domain | RT-019 | `mapped` |
| `RP-15` | reporting-domain | RT-309 | `mapped` |
| `RP-16` | reporting-domain | RT-401 | `mapped` |
| `RP-17` | reporting-domain | RT-019 | `mapped` |
| `RP-18` | reporting-domain | RT-168, RT-266, RT-312, RT-325 | `mapped` |
| `RP-19` | reporting-domain | RT-312 | `mapped` |
| `RP-20` | reporting-domain | RT-310 | `mapped` |
| `RP-21` | reporting-domain | RT-310 | `mapped` |
| `RP-22` | reporting-domain | RT-311 | `mapped` |
| `RP-23` | reporting-domain | RT-402 | `mapped` |
| `RP-24` | reporting-domain | RT-402 | `mapped` |
| `RP-25` | reporting-domain | RT-313 | `mapped` |
| `RP-26` | reporting-domain | RT-314 | `mapped` |
| `RP-27` | reporting-domain | RT-315 | `mapped` |
| `RP-28` | reporting-domain | RT-313 | `mapped` |
| `RP-29` | reporting-domain | RT-403 | `mapped` |
| `RP-30` | reporting-domain | RT-316 | `mapped` |
| `RP-31` | reporting-domain | RT-316 | `mapped` |
| `RP-32` | reporting-domain | RT-273, RT-316 | `mapped` |
| `RP-33` | reporting-domain | RT-316 | `mapped` |
| `RP-34` | reporting-domain | RT-316 | `mapped` |
| `RR-01` | returns-refunds-domain | RT-144 | `mapped` |
| `RR-02` | returns-refunds-domain | RT-145, RT-147 | `mapped` |
| `RR-03` | returns-refunds-domain | RT-145, RT-146, RT-258 | `mapped` |
| `RR-04` | returns-refunds-domain | RT-145 | `mapped` |
| `RR-05` | returns-refunds-domain | RT-145 | `mapped` |
| `RR-06` | returns-refunds-domain | RT-145 | `mapped` |
| `RR-07` | returns-refunds-domain | RT-145 | `mapped` |
| `RR-08` | returns-refunds-domain | RT-148, RT-150 | `mapped` |
| `RR-09` | returns-refunds-domain | RT-148 | `mapped` |
| `RR-10` | returns-refunds-domain | RT-148 | `mapped` |
| `RR-11` | returns-refunds-domain | RT-148 | `mapped` |
| `RR-12` | returns-refunds-domain | RT-148 | `mapped` |
| `RR-13` | returns-refunds-domain | RT-148 | `mapped` |
| `RR-14` | returns-refunds-domain | RT-149 | `mapped` |
| `RR-15` | returns-refunds-domain | RT-149 | `mapped` |
| `RR-16` | returns-refunds-domain | RT-149 | `mapped` |
| `RR-17` | returns-refunds-domain | RT-096, RT-151, RT-153 | `mapped` |
| `RR-18` | returns-refunds-domain | RT-098, RT-151 | `mapped` |
| `RR-19` | returns-refunds-domain | RT-151 | `mapped` |
| `RR-20` | returns-refunds-domain | RT-151 | `mapped` |
| `RR-21` | returns-refunds-domain | RT-151 | `mapped` |
| `RR-22` | returns-refunds-domain | RT-154 | `mapped` |
| `RR-23` | returns-refunds-domain | RT-154 | `mapped` |
| `RR-24` | returns-refunds-domain | RT-154, RT-155 | `mapped` |
| `RR-25` | returns-refunds-domain | RT-154 | `mapped` |
| `RR-26` | returns-refunds-domain | RT-158 | `mapped` |
| `RR-27` | returns-refunds-domain | RT-156 | `mapped` |
| `RR-28` | returns-refunds-domain | RT-162 | `mapped` |
| `RR-29` | returns-refunds-domain | RT-522 | `mapped` |
| `RR-30` | returns-refunds-domain | RT-159 | `mapped` |
| `RR-31` | returns-refunds-domain | RT-152, RT-159 | `mapped` |
| `RR-32` | returns-refunds-domain | RT-159 | `mapped` |
| `RR-33` | returns-refunds-domain | RT-159 | `mapped` |
| `RR-34` | returns-refunds-domain | RT-159 | `mapped` |
| `RR-35` | returns-refunds-domain | RT-157 | `mapped` |
| `RR-36` | returns-refunds-domain | RT-144 | `mapped` |
| `RR-37` | returns-refunds-domain | RT-523 | `mapped` |
| `RR-38` | returns-refunds-domain | RT-160 | `mapped` |
| `RR-39` | returns-refunds-domain | RT-160 | `mapped` |
| `RR-40` | returns-refunds-domain | RT-160 | `mapped` |
| `RR-41` | returns-refunds-domain | RT-160 | `mapped` |
| `RR-42` | returns-refunds-domain | RT-161 | `mapped` |
| `RR-43` | returns-refunds-domain | RT-161 | `mapped` |
| `RR-44` | returns-refunds-domain | RT-161 | `mapped` |
| `SEP-01` | actors-and-roles | RT-018, RT-194, RT-281 | `mapped` |
| `SEP-02` | actors-and-roles | RT-018 | `mapped` |
| `SEP-03` | actors-and-roles | RT-018 | `mapped` |
| `SEP-04` | actors-and-roles | RT-018 | `mapped` |
| `SEP-05` | actors-and-roles | RT-018 | `mapped` |
| `SEP-06` | actors-and-roles | RT-018 | `mapped` |
| `SEP-07` | actors-and-roles | RT-018 | `mapped` |
| `SEP-08` | actors-and-roles | RT-018 | `mapped` |
| `SEP-09` | actors-and-roles | RT-018, RT-299 | `mapped` |
| `SEP-10` | actors-and-roles | RT-018 | `mapped` |
| `SEP-11` | actors-and-roles | RT-018 | `mapped` |
| `SEP-12` | actors-and-roles | RT-018 | `mapped` |
| `SM-01` | state-machines | RT-404 | `mapped` |
| `SM-01a` | state-machines | RT-404 | `mapped` |
| `SM-02` | state-machines | RT-344 | `mapped` |
| `SM-02a` | state-machines | RT-405 | `mapped` |
| `SM-02b` | state-machines | RT-405 | `mapped` |
| `SM-02c` | state-machines | RT-405 | `mapped` |
| `SM-02d` | state-machines | RT-405 | `mapped` |
| `SM-03` | state-machines | RT-344 | `mapped` |
| `SM-04` | state-machines | RT-344 | `mapped` |
| `SM-05` | state-machines | RT-345 | `mapped` |
| `SM-06` | state-machines | RT-347 | `mapped` |
| `SM-07` | state-machines | RT-406 | `mapped` |
| `SM-08` | state-machines | RT-027, RT-346 | `mapped` |
| `SM-09` | state-machines | RT-407 | `mapped` |
| `SM-10` | state-machines | RT-078 | `mapped` |
| `SM-11` | state-machines | RT-021, RT-031 | `mapped` |
| `SM-12` | state-machines | RT-028 | `mapped` |
| `SM-13` | state-machines | RT-409 | `mapped` |
| `SM-13a` | state-machines | RT-408 | `mapped` |
| `SM-14` | state-machines | RT-410 | `mapped` |
| `SM-15` | state-machines | RT-410 | `mapped` |
| `SM-16` | state-machines | RT-411 | `mapped` |
| `SM-16a` | state-machines | RT-408 | `mapped` |
| `SM-17` | state-machines | RT-411 | `mapped` |
| `SM-18` | state-machines | RT-412 | `mapped` |
| `SM-19` | state-machines | RT-412 | `mapped` |
| `SM-20` | state-machines | RT-104 | `mapped` |
| `SM-21` | state-machines | RT-105 | `mapped` |
| `SM-22` | state-machines | RT-115 | `mapped` |
| `SM-23` | state-machines | RT-413 | `mapped` |
| `SM-24` | state-machines | RT-117 | `mapped` |
| `SM-25` | state-machines | RT-106 | `mapped` |
| `SM-26` | state-machines | RT-107 | `mapped` |
| `SM-27` | state-machines | RT-414 | `mapped` |
| `SM-28` | state-machines | RT-110, RT-111 | `mapped` |
| `SM-29` | state-machines | RT-109 | `mapped` |
| `SM-30` | state-machines | RT-113 | `mapped` |
| `SM-31` | state-machines | RT-113 | `mapped` |
| `SM-32` | state-machines | RT-118, RT-141 | `mapped` |
| `SM-33` | state-machines | RT-118 | `mapped` |
| `SM-34` | state-machines | RT-138, RT-334 | `mapped` |
| `SM-35` | state-machines | RT-415 | `mapped` |
| `SM-35a` | state-machines | RT-404 | `mapped` |
| `SM-36` | state-machines | RT-413 | `mapped` |
| `SM-37` | state-machines | RT-143 | `mapped` |
| `SM-38` | state-machines | RT-144 | `mapped` |
| `SM-39` | state-machines | RT-416 | `mapped` |
| `SM-40` | state-machines | RT-155 | `mapped` |
| `SM-41` | state-machines | RT-417 | `mapped` |
| `SM-42` | state-machines | RT-150 | `mapped` |
| `SM-43a` | state-machines | RT-408, RT-416, RT-417 | `mapped` |
| `SM-43` | state-machines | RT-153 | `mapped` |
| `SM-44` | state-machines | RT-165, RT-348 | `mapped` |
| `SM-45` | state-machines | RT-418 | `mapped` |
| `SM-45c` | state-machines | RT-419 | `mapped` |
| `SM-45a` | state-machines | RT-419 | `mapped` |
| `SM-45b` | state-machines | RT-418 | `mapped` |
| `SM-46` | state-machines | RT-418 | `mapped` |
| `SM-47` | state-machines | RT-189 | `mapped` |
| `SM-48` | state-machines | RT-190 | `mapped` |
| `SM-48a` | state-machines | RT-408, RT-189 | `mapped` |
| `SM-49` | state-machines | RT-197 | `mapped` |
| `SM-50` | state-machines | RT-198 | `mapped` |
| `SM-51` | state-machines | RT-256 | `mapped` |
| `SM-52` | state-machines | RT-255 | `mapped` |
| `SM-53` | state-machines | RT-420 | `mapped` |
| `SM-54` | state-machines | RT-421 | `mapped` |
| `SM-55` | state-machines | RT-422 | `mapped` |
| `SM-56` | state-machines | RT-246 | `mapped` |
| `SM-56a` | state-machines | RT-422, RT-345, RT-408 | `mapped` |
| `SM-57` | state-machines | RT-422 | `mapped` |
| `SM-58` | state-machines | RT-422 | `mapped` |
| `SM-59` | state-machines | RT-423 | `mapped` |
| `SM-60a` | state-machines | RT-424 | `mapped` |
| `SM-60b` | state-machines | RT-424 | `mapped` |
| `SM-60` | state-machines | RT-408 | `mapped` |
| `SM-61` | state-machines | RT-214 | `mapped` |
| `SM-62` | state-machines | RT-204 | `mapped` |
| `SM-63` | state-machines | RT-425 | `mapped` |
| `SM-64` | state-machines | RT-231 | `mapped` |
| `SM-64a` | state-machines | RT-226 | `mapped` |
| `SM-65` | state-machines | RT-226 | `mapped` |
| `SM-66` | state-machines | RT-426 | `mapped` |
| `SM-67` | state-machines | RT-427 | `mapped` |
| `SM-68` | state-machines | RT-428 | `mapped` |
| `SM-69` | state-machines | RT-278 | `mapped` |
| `SM-70` | state-machines | RT-285 | `mapped` |
| `SM-71` | state-machines | RT-428 | `mapped` |
| `SM-72` | state-machines | RT-324 | `mapped` |
| `SM-73` | state-machines | RT-324 | `mapped` |
| `SM-74` | state-machines | RT-360 | `mapped` |
| `SM-75` | state-machines | RT-429 | `mapped` |
| `SM-75a` | state-machines | RT-429 | `mapped` |
| `SM-76` | state-machines | RT-056, RT-179, RT-348 | `mapped` |
| `SM-77` | state-machines | RT-078 | `mapped` |
| `SM-77a` | state-machines | RT-408 | `mapped` |
| `SM-78` | state-machines | RT-430 | `mapped` |
| `SM-79` | state-machines | RT-275 | `mapped` |
| `SM-80` | state-machines | RT-066 | `mapped` |
| `SM-81` | state-machines | RT-431 | `mapped` |
| `SM-82` | state-machines | RT-431 | `mapped` |
| `SM-83` | state-machines | RT-073 | `mapped` |
| `SM-84` | state-machines | RT-432 | `mapped` |
| `SM-85` | state-machines | RT-202 | `mapped` |
| `SM-86` | state-machines | RT-433 | `mapped` |
| `SM-87` | state-machines | RT-199 | `mapped` |
| `SM-88` | state-machines | RT-434 | `mapped` |
| `SM-88a` | state-machines | RT-408 | `mapped` |
| `SP-01` | sales-pos-domain | RT-118 | `mapped` |
| `SP-02` | sales-pos-domain | RT-118, RT-119 | `mapped` |
| `SP-03` | sales-pos-domain | RT-119, RT-121, RT-265 | `mapped` |
| `SP-04` | sales-pos-domain | RT-119, RT-120, RT-215 | `mapped` |
| `SP-05` | sales-pos-domain | RT-119 | `mapped` |
| `SP-06` | sales-pos-domain | RT-122 | `mapped` |
| `SP-07` | sales-pos-domain | RT-122, RT-263 | `mapped` |
| `SP-08` | sales-pos-domain | RT-125 | `mapped` |
| `SP-09` | sales-pos-domain | RT-125, RT-126 | `mapped` |
| `SP-10` | sales-pos-domain | RT-125 | `mapped` |
| `SP-11` | sales-pos-domain | RT-125, RT-146, RT-308 | `mapped` |
| `SP-12` | sales-pos-domain | RT-125 | `mapped` |
| `SP-13` | sales-pos-domain | RT-128 | `mapped` |
| `SP-14` | sales-pos-domain | RT-128 | `mapped` |
| `SP-15` | sales-pos-domain | RT-128 | `mapped` |
| `SP-16` | sales-pos-domain | RT-128 | `mapped` |
| `SP-17` | sales-pos-domain | RT-128 | `mapped` |
| `SP-18` | sales-pos-domain | RT-127, RT-128 | `mapped` |
| `SP-19` | sales-pos-domain | RT-128 | `mapped` |
| `SP-20` | sales-pos-domain | RT-128, RT-143 | `mapped` |
| `SP-21` | sales-pos-domain | RT-128 | `mapped` |
| `SP-22` | sales-pos-domain | RT-128 | `mapped` |
| `SP-23` | sales-pos-domain | RT-128 | `mapped` |
| `SP-24` | sales-pos-domain | RT-124, RT-330 | `mapped` |
| `SP-25` | sales-pos-domain | RT-502 | `mapped` |
| `SP-26` | sales-pos-domain | RT-502 | `mapped` |
| `SP-27` | sales-pos-domain | RT-129 | `mapped` |
| `SP-28` | sales-pos-domain | RT-129 | `mapped` |
| `SP-29` | sales-pos-domain | RT-129 | `mapped` |
| `SP-30` | sales-pos-domain | RT-129, RT-139 | `mapped` |
| `SP-31` | sales-pos-domain | RT-129 | `mapped` |
| `SP-32` | sales-pos-domain | RT-129 | `mapped` |
| `SP-33` | sales-pos-domain | RT-130 | `mapped` |
| `SP-34` | sales-pos-domain | RT-130 | `mapped` |
| `SP-35` | sales-pos-domain | RT-130 | `mapped` |
| `SP-36` | sales-pos-domain | RT-130 | `mapped` |
| `SP-37` | sales-pos-domain | RT-130 | `mapped` |
| `SP-38` | sales-pos-domain | RT-130 | `mapped` |
| `SP-39` | sales-pos-domain | RT-132, RT-135, RT-239, RT-331 | `mapped` |
| `SP-40` | sales-pos-domain | RT-133 | `mapped` |
| `SP-41` | sales-pos-domain | RT-134, RT-251 | `mapped` |
| `SP-42` | sales-pos-domain | RT-131 | `mapped` |
| `SP-43` | sales-pos-domain | RT-136, RT-137, RT-332 | `mapped` |
| `SP-44` | sales-pos-domain | RT-141 | `mapped` |
| `SP-45` | sales-pos-domain | RT-141, RT-142 | `mapped` |
| `SP-46` | sales-pos-domain | RT-141 | `mapped` |
| `SP-47` | sales-pos-domain | RT-141 | `mapped` |
| `SP-48` | sales-pos-domain | RT-141 | `mapped` |
| `SP-49` | sales-pos-domain | RT-141 | `mapped` |
| `SP-50` | sales-pos-domain | RT-138 | `mapped` |
| `SP-51` | sales-pos-domain | RT-138 | `mapped` |
| `SP-52` | sales-pos-domain | RT-138 | `mapped` |
| `SP-53` | sales-pos-domain | RT-138 | `mapped` |
| `SP-54` | sales-pos-domain | RT-138 | `mapped` |
| `SP-55` | sales-pos-domain | RT-138 | `mapped` |
| `SP-56` | sales-pos-domain | RT-138 | `mapped` |
| `SP-57` | sales-pos-domain | RT-140 | `mapped` |
| `SP-58` | sales-pos-domain | RT-140 | `mapped` |
| `SP-59` | sales-pos-domain | RT-140 | `mapped` |
| `SP-60` | sales-pos-domain | RT-140 | `mapped` |
| `SP-61` | sales-pos-domain | RT-221, RT-232 | `mapped` |
| `SP-62` | sales-pos-domain | RT-225 | `mapped` |
| `SP-63` | sales-pos-domain | RT-222 | `mapped` |
| `SP-64` | sales-pos-domain | RT-066 | `mapped` |
| `SP-65` | sales-pos-domain | RT-226 | `mapped` |
| `SP-66` | sales-pos-domain | RT-415 | `mapped` |
| `SU-01` | supplier-domain | RT-177 | `mapped` |
| `SU-02` | supplier-domain | RT-177 | `mapped` |
| `SU-03` | supplier-domain | RT-178 | `mapped` |
| `SU-04` | supplier-domain | RT-178 | `mapped` |
| `SU-05` | supplier-domain | RT-178 | `mapped` |
| `SU-06` | supplier-domain | RT-178, RT-180 | `mapped` |
| `SU-07` | supplier-domain | RT-181 | `mapped` |
| `SU-08` | supplier-domain | RT-181 | `mapped` |
| `SU-09` | supplier-domain | RT-179 | `mapped` |
| `SU-10` | supplier-domain | RT-179 | `mapped` |
| `SU-11` | supplier-domain | RT-179 | `mapped` |
| `SU-12` | supplier-domain | RT-179 | `mapped` |
| `SU-13` | supplier-domain | RT-179 | `mapped` |
| `SU-14` | supplier-domain | RT-179 | `mapped` |
| `SU-15` | supplier-domain | RT-179 | `mapped` |
| `SU-16` | supplier-domain | RT-182, RT-183 | `mapped` |
| `SU-17` | supplier-domain | RT-182, RT-183 | `mapped` |
| `SU-18` | supplier-domain | RT-182, RT-183 | `mapped` |
| `SU-19` | supplier-domain | RT-182, RT-183 | `mapped` |
| `SU-20` | supplier-domain | RT-184 | `mapped` |
| `SU-21` | supplier-domain | RT-184 | `mapped` |
| `SU-22` | supplier-domain | RT-184, RT-186 | `mapped` |
| `SU-23` | supplier-domain | RT-185 | `mapped` |
| `SU-24` | supplier-domain | RT-185 | `mapped` |
| `SU-25` | supplier-domain | RT-185 | `mapped` |
| `SU-26` | supplier-domain | RT-185 | `mapped` |
| `UX-01` | ux-requirements | RT-125, RT-327 | `mapped` |
| `UX-02` | ux-requirements | RT-363 | `mapped` |
| `UX-03` | ux-requirements | RT-363 | `mapped` |
| `UX-04` | ux-requirements | RT-364 | `mapped` |
| `UX-05` | ux-requirements | RT-328 | `mapped` |
| `UX-06` | ux-requirements | RT-329 | `mapped` |
| `UX-07` | ux-requirements | RT-016 | `mapped` |
| `UX-08` | ux-requirements | RT-328 | `mapped` |
| `UX-09` | ux-requirements | RT-365 | `mapped` |
| `UX-10` | ux-requirements | RT-330 | `mapped` |
| `UX-11` | ux-requirements | RT-126 | `mapped` |
| `UX-12` | ux-requirements | RT-128 | `mapped` |
| `UX-13` | ux-requirements | RT-366 | `mapped` |
| `UX-14` | ux-requirements | RT-367 | `mapped` |
| `UX-15` | ux-requirements | RT-331 | `mapped` |
| `UX-16` | ux-requirements | RT-137, RT-332 | `mapped` |
| `UX-17` | ux-requirements | RT-368 | `mapped` |
| `UX-18` | ux-requirements | RT-136, RT-333 | `mapped` |
| `UX-19` | ux-requirements | RT-342 | `mapped` |
| `UX-20` | ux-requirements | RT-369 | `mapped` |
| `UX-21` | ux-requirements | RT-334 | `mapped` |
| `UX-22` | ux-requirements | RT-140 | `mapped` |
| `UX-23` | ux-requirements | RT-142 | `mapped` |
| `UX-24` | ux-requirements | RT-142 | `mapped` |
| `UX-25` | ux-requirements | RT-370 | `mapped` |
| `UX-26` | ux-requirements | RT-371 | `mapped` |
| `UX-27` | ux-requirements | RT-335 | `mapped` |
| `UX-28` | ux-requirements | RT-335 | `mapped` |
| `UX-29` | ux-requirements | RT-336 | `mapped` |
| `UX-30` | ux-requirements | RT-151 | `mapped` |
| `UX-31` | ux-requirements | RT-524 | `mapped` |
| `UX-32` | ux-requirements | RT-372 | `mapped` |
| `UX-33` | ux-requirements | RT-243 | `mapped` |
| `UX-34` | ux-requirements | RT-373 | `mapped` |
| `UX-35` | ux-requirements | RT-374 | `mapped` |
| `UX-36` | ux-requirements | RT-375 | `mapped` |
| `UX-37` | ux-requirements | RT-072 | `mapped` |
| `UX-38` | ux-requirements | RT-376 | `mapped` |
| `UX-39` | ux-requirements | RT-073 | `mapped` |
| `UX-40` | ux-requirements | RT-286 | `mapped` |
| `UX-41` | ux-requirements | RT-284 | `mapped` |
| `UX-42` | ux-requirements | RT-377 | `mapped` |
| `UX-43` | ux-requirements | RT-377 | `mapped` |
| `UX-44` | ux-requirements | RT-324 | `mapped` |
| `UX-45` | ux-requirements | RT-361 | `mapped` |
| `UX-46` | ux-requirements | RT-324 | `mapped` |
| `UX-47` | ux-requirements | RT-378 | `mapped` |
| `UX-48` | ux-requirements | RT-379 | `mapped` |
| `UX-49` | ux-requirements | RT-378 | `mapped` |
| `UX-50` | ux-requirements | RT-339 | `mapped` |
| `UX-51` | ux-requirements | RT-339 | `mapped` |
| `UX-52` | ux-requirements | RT-340 | `mapped` |
| `UX-53` | ux-requirements | RT-380 | `mapped` |
| `UX-54` | ux-requirements | RT-380 | `mapped` |
| `UX-55` | ux-requirements | RT-337, RT-347 | `mapped` |
| `UX-56` | ux-requirements | RT-337 | `mapped` |
| `UX-57` | ux-requirements | RT-332 | `mapped` |
| `UX-58` | ux-requirements | RT-015, RT-338 | `mapped` |
| `UX-59` | ux-requirements | RT-364 | `mapped` |
| `UX-60` | ux-requirements | RT-341 | `mapped` |
| `UX-61` | ux-requirements | RT-214, RT-341 | `mapped` |
| `UX-62` | ux-requirements | RT-310 | `mapped` |
| `UX-63` | ux-requirements | RT-232, RT-342 | `mapped` |
| `UX-64` | ux-requirements | RT-342 | `mapped` |
| `UX-65` | ux-requirements | RT-226 | `mapped` |
| `UX-66` | ux-requirements | RT-381 | `mapped` |
| `UX-67` | ux-requirements | RT-343 | `mapped` |
| `UX-68` | ux-requirements | RT-343 | `mapped` |
| `UX-69` | ux-requirements | RT-343 | `mapped` |
| `UX-70` | ux-requirements | RT-343 | `mapped` |
| `UX-71` | ux-requirements | RT-343 | `mapped` |
| `WH-01` | organization-model | RT-003 | `mapped` |
| `WH-02` | organization-model | RT-004 | `mapped` |
| `WH-03` | organization-model | RT-509 | `mapped` |
| `WH-04` | organization-model | RT-510 | `mapped` |

### 26.3 Summary

- Defined rules: **1161**
- `mapped` (cited by a requirement): **1161**
- `inferred` (assigned by the generator, **unverified**): **0**
- `UNMAPPED`: **0**
- Requirement rows: **529**, of which **175** were drafted by this review
- Coverage rows resolving to an `OUT OF SCOPE` requirement row: **48**

The count is 1161 rows, 1161 `mapped`, 0 `inferred`, summing correctly. The rule-id pattern used to
parse 26.2 did not match the `PR-Qnn` form, so 42 `PR-Q` rows were invisible to it. `PR-Q` ids are
now parsed (`PR-Q01`, `PR-Q06a`, and the `PR-Q11..PR-Q21` range form). The pre-Batch-5a figure was
1161 / 1021 / 140.

**The coverage table and the citation columns are now a bijection.** 1161 rules are `mapped` and 1161
distinct rules are cited, and the two sets are identical: no rule is `mapped` without a citing
requirement row, and no requirement row cites a rule absent from 26.2. Ranges are expanded on both
sides (`BE-25..BE-33`, `PR-Q11..PR-Q21`, `IV-19a`, `SM-60b`).

Of the 342 rules the generator left `inferred`, **all 342 have now been reviewed and closed**.
`PR-Q` rules were never phantom rows: 35 were already `mapped` and cited, and 7 (`PR-Q04`, `PR-Q05`,
`PR-Q06`, `PR-Q06a`, `PR-Q07`, `PR-Q08`, `PR-Q10`) are genuine open questions in
`procurement-domain.md`. All seven were reviewed in Batch 5c and are closed.

**Backlog: none.** No rule is left uncited by any requirement row.

**No `inferred` rule points at an `OUT OF SCOPE` row, `RT-344`, or `RT-350`** - no `inferred` rules
remain. The 48 rules that are `mapped` to an `OUT OF SCOPE` row are each themselves exclusion rules
("no franchise in v1", "attendance is not payroll"), so the requirement's `OUT OF SCOPE` marking is
the correct home for them and is not a defect.

**Review complete (C-06).** Every rule the generator left `inferred` has been adjudicated against its
source, in ten batches. The dispositions and their source citations are in
`../architecture/C-06-TRACEABILITY-REVIEW.md`.

- Batch 1 (41 rules, `RT-343` and `RT-326` targets): 37 closed as `mapped` - 2 into existing rows, 35
  into 27 newly drafted rows (RT-355..RT-381) - and **4 held open as unsure** because the candidate row did
  not state the whole rule: `UX-19`, `UX-31`, `UX-44`, `UX-46`. **All four are closed in Batch 5d.**
- Batch 2 (32 rules, `RT-288`, `RT-316`, `RT-274` targets): all 32 closed as `mapped` - 5 into existing
  rows and 27 into 22 newly drafted rows (RT-382..RT-403). No unsure.
- Batch 3a (34 of the 67 `state-machines` rules pointed at `RT-344`): all 34 closed as `mapped` - 3 into
  existing rows and 31 into 18 newly drafted rows (RT-404..RT-421). No unsure.
- Batch 3b (30 of the 67 `state-machines` rules): all 30 closed as `mapped` - 14 into existing rows and
  16 into 13 newly drafted rows (RT-422..RT-434). The remaining 3 (`SM-43a`, `SM-48a`, `SM-56a`) were
  adjudicated in Batch 5d; 34 + 30 + 3 = 67. No unsure.
- Batch 4a (33 of the 65 `edge-cases` rules pointed at `RT-350`): all 33 closed as `mapped` - 20 into
  existing rows and 13 into 12 newly drafted rows (RT-435..RT-446). No unsure.
- Batch 4b (the other 32 `edge-cases` rules): all 32 closed as `mapped` - 19 into existing rows and 13
  into 11 newly drafted rows (RT-447..RT-457), one of them `OUT OF SCOPE`. One defect corrected in an
  existing row (`RT-168` claimed a credit due date that `CU-23` and `CON-06` do not have).
- Batch 5a (`batch-expiry-fefo` 17 + `audit-domain` 16): all 33 closed as `mapped` - 5 into existing
  rows (with the citation added to each) and 28 into 12 newly drafted rows (RT-458..RT-469), one of them
  `OUT OF SCOPE`. Partial-coverage residuals on four of the five existing-row mappings are recorded in
  the review artifact. No unsure.
- Batch 5b (`offline-pos-domain` 11 + `business-invariants` 11 + `payment-domain` 10): 31 of 32 closed
  as `mapped` - 18 into existing rows and 13 into 12 newly drafted rows (RT-470..RT-481) - with `PY-35`
  `OUT OF SCOPE` as RT-482. `PY-54` was escalated as CONTRADICTORY against RT-420 and provisionally
  mapped on the majority reading. Eight residuals recorded. No unsure.
- Batch 5c (`product-domain` 10 + `inventory-domain` 8 + `sales-pos-domain` 8 + `procurement-domain` 7):
  all 33 closed - 12 into existing rows and 21 into 20 newly drafted rows (RT-483..RT-502), where
  `PR-Q05` and `PR-Q07` share RT-498. All four generator homes were wrong. `PR-Q06`'s index row is stale
  and is corrected by `PR-Q06a`'s own body, which is recorded as a source edit for the owner. No unsure.
- Batch 5d (`organization-model` 8 + `cash-management` 6 + `rfid-domain` 5 + `actors-and-roles` 4 +
  `ux-requirements` 4 + `state-machines` 3 + `customer-domain` 3 + `returns-refunds-domain` 3 +
  `hardware-domain` 3 + `employee-domain` 3): all 42 closed - 15 into existing rows and 27 into 27 newly
  drafted rows (RT-503..RT-529), two of them `OUT OF SCOPE`. This batch closed the four Batch 1 unsure
  items and caught a duplicate in Batch 5c: `RT-503` restated `RT-415` and was deleted, with `SP-66`
  remapped to `RT-415`. No unsure.

**Both generator catch-alls are now closed.** Every rule that pointed at `RT-344` or `RT-350` has been
moved to a row that actually states it, and neither catch-all still owns an `inferred` rule. They
remain, unchanged, as the correct generic statements they are.

The pattern behind the backlog is established rather than suspected: the generator's
nearest-same-namespace heuristic assigns an in-scope rule to whichever requirement row cites the most ids
sharing its prefix, and in the `UX`, `AP`, `RP`, `MS`, and `NT` namespaces that row is consistently an
`OUT OF SCOPE` row. Those `OUT OF SCOPE` rows are correct and stay; the rules pointing at them were moved.
The same mechanism explains `RT-344` and `RT-350`, which are correct generic statements about transitions and
edge cases that were made to own 132 specific rules belonging to particular entities.

**`mapped` is not `approved`.** `mapped` means a requirement row states the rule and cites it. It does
not mean the requirement text is agreed. Every row drafted by this review is
`PROPOSED - REQUIRES HUMAN CONFIRMATION`, and a drafted row is a proposal for the owner to accept,
amend, or reject. C-06 closes on the absence of unaddressed rules, not on approval of 175 drafted
requirements.

A review is only a decision if it cites the source: a generator `inferred` row is a proposal, and a
reviewed row names the source file and rule id behind it.
