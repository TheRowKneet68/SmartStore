# SMARTSTORE — MASTER PRODUCT GOAL & IMPLEMENTATION CONTRACT

**Document type:** Master goal / north-star document  
**Purpose:** Tell the human owner and implementation agents exactly what SmartStore is supposed to become, what is already decided, what is intentionally unresolved, what must not be invented, and what "complete" means.

> **This file is a goal document, not a replacement for the detailed Phase 1 and Phase 2 specifications.**
> The detailed specifications remain authoritative for individual domain rules.
> This file is the operational map for the entire project.

---

# 0. THE ONE-SENTENCE GOAL

**SmartStore is a production-grade retail operating platform that becomes the system of record for what a store has, what it sold, who performed the operation, what money moved, what money is owed, and what happened when something went wrong — while remaining usable during network/device failures.**

The goal is not merely to build an inventory CRUD application.

The goal is to build a **retail operating system** covering:

- product/catalog management
- inventory truth
- purchasing
- receiving
- batch and expiry management
- FEFO
- POS/digital billing
- returns/refunds
- customer credit
- supplier payables
- cash management
- employee management
- RBAC
- RFID authentication
- RFID attendance
- hardware/device integration
- offline POS
- synchronization
- approvals
- audit
- notifications
- reporting
- multi-store operation
- backup/recovery
- import/export
- operational administration

The system must be auditable, secure, transactional, recoverable, understandable by store staff, and maintainable by developers.

---

# 1. PROJECT STATUS

Current project state:

- Phase 0 — COMPLETE
- Phase 1 — COMPLETE WITH DOCUMENTED LIMITS
- Phase 1 semantic audit — COMPLETE
- Phase 1 defect correction — COMPLETE
- Phase 2 architecture — COMPLETE, WITH DOCUMENTED GATES
- Application implementation — NOT COMPLETE / NOT STARTED
- Database implementation — NOT COMPLETE
- Production deployment — NOT COMPLETE

Important:

**A completed specification is not a completed system.**

No implementation claim may be made until code is actually built, tested, and verified.

---

# 2. AUTHORITATIVE DOCUMENT HIERARCHY

When implementing SmartStore, use this hierarchy:

1. Explicit approved product/business decisions
2. Phase 1 domain requirements
3. Business invariants
4. Approved state machines
5. Phase 2 architecture
6. Approved architecture decision records
7. Implementation details
8. Agent assumptions

An agent must NEVER use item 8 to override items 1–7.

If two documents conflict:

- identify the conflict
- cite both sources
- do not silently choose
- stop the affected implementation
- request/record a decision

Never "fix" a requirement merely to make code easier.

---

# 3. NON-HALLUCINATION / EVIDENCE CONTRACT

This is mandatory for Claude Code and every future implementation agent.

## 3.1 Never invent

Do not invent:

- database fields
- permissions
- role assignments
- state transitions
- audit event types
- business rules
- tax behavior
- refund rules
- stock ownership
- offline conflict behavior
- hardware behavior
- API contracts
- security guarantees
- external integrations
- regulatory compliance
- payment-provider behavior
- UI requirements

unless the specification explicitly defines them or the owner explicitly approves them.

## 3.2 When information is missing

Use:

`OPEN DECISION`

or:

`UNKNOWN`

or:

`NOT SPECIFIED`

depending on the situation.

Do not silently fill the gap.

## 3.3 When evidence is needed

Inspect the actual source.

Never claim:

- "implemented"
- "secure"
- "transactional"
- "idempotent"
- "covered"
- "tested"
- "complete"

without evidence.

## 3.4 Agent stop rule

Claude Code must stop the affected task and report when:

- a required business decision is missing
- a state transition lacks authorization
- a permission key is undefined
- a schema choice would permanently encode an unresolved gate
- two authoritative documents contradict each other
- a security-sensitive behavior is unspecified
- an implementation would require guessing

The agent may continue unrelated work that is demonstrably independent.

---

# 4. WHAT SMARTSTORE IS

SmartStore targets:

- supermarkets
- grocery stores
- convenience stores
- electronics stores
- clothing stores
- hardware stores
- pharmacies where legally appropriate
- general-purpose retail stores

SmartStore is primarily a **retail operating platform**, not a general ERP.

---

# 5. WHAT SMARTSTORE IS NOT

Do not expand the project into an ERP without an explicit decision.

Out of scope unless separately approved:

- full payroll
- manufacturing/MRP
- general-ledger accounting ERP
- project management
- generic CRM automation
- advanced supply-chain planning
- unrelated HR suites
- arbitrary business workflow engines

Pharmacy/regulatory functionality beyond ordinary retail is a separate expansion because it can introduce:

- prescriptions
- dispensing
- controlled-substance tracking
- regulated reporting
- jurisdiction-specific compliance

---

# 6. CORE PRODUCT MODULES

The finished system is expected to contain these major domains.

## 6.1 Organization and stores

- Organization
- Store
- Warehouse
- Storage Location
- POS Terminal
- Cash Drawer
- multi-store scoping
- central warehouse support
- store settings
- terminal registration

## 6.2 Identity and access

- Employee
- User Account
- Role
- Permission
- Employee Store Access
- Employee Role Assignment
- authentication
- authorization
- session management
- privilege-change invalidation
- default-deny authorization
- server-side enforcement

## 6.3 Catalog

- Product / SPU
- Product Variant / SKU
- Category
- Brand
- Barcode
- multiple barcodes per variant
- Unit
- Unit Conversion
- Product Image
- Price List
- Price List Entry
- Product Cost
- product status
- archive lifecycle

## 6.4 Inventory

- Stock Item
- Storage Location
- Stock Balance
- Inventory Movement
- movement ledger
- Stock Receipt
- Stock Issue
- Stock Adjustment
- Stock Transfer
- Stock Count
- Stock Reservation
- damaged stock
- expired stock
- loss
- found stock
- opening balance
- reconciliation
- valuation

**Critical rule:**

Inventory balance is a projection of an append-only movement ledger.

A product's stock must not be a manually editable number.

## 6.5 Batch / expiry / FEFO

- batch
- manufacturing date
- expiry date
- received date
- supplier
- purchase cost
- remaining quantity
- FEFO selection
- near-expiry reporting
- expiry blocking
- quarantine
- damaged disposition
- authorized FEFO override

## 6.6 Procurement

- Supplier
- Supplier Product
- Purchase Requisition
- Purchase Order
- Goods Receipt / GRN
- Supplier Invoice
- three-way matching
- supplier payment run
- Purchase Return
- partial receiving
- over-receiving
- under-receiving
- damaged/expired receiving
- batch assignment
- purchase tax

Important distinction:

**GRN creates stock. Supplier invoice creates payable.**

## 6.7 POS / Sales

- cart
- barcode scanning
- product search
- quantity
- weighted products
- pricing
- price snapshot
- discount
- tax
- coupon support if approved
- multiple payment methods
- split tender
- cash
- card
- QR
- bank transfer
- customer credit
- change calculation
- receipt
- invoice
- suspend/hold sale
- resume sale
- cancel sale
- manager approval for protected actions

## 6.8 Returns and refunds

- customer return
- supplier return
- return inspection
- disposition
- refund
- exchange
- store credit
- refundable amount
- returned quantity
- partial return
- partial refund
- return-to-sellable
- quarantine
- damaged disposition

Hard protections:

- no over-return
- no duplicate return
- no over-refund
- no stock inflation
- no unauthorized refund

## 6.9 Customers

- walk-in customer
- registered customer
- customer account
- address
- purchase history
- credit ledger
- customer payments
- credit limits
- customer statements
- loyalty ledger
- loyalty points
- redemption

v1 intentionally has no credit due date unless a later decision changes this.

## 6.10 Suppliers

- supplier
- contacts
- supplier products
- supplier pricing
- purchase history
- payable ledger
- supplier balance
- supplier statement
- supplier payments
- organization/store supplier views

## 6.11 Employees

- employee
- department
- position
- role
- permission
- store assignment
- shift
- attendance
- leave
- employee status
- manual attendance correction
- approval workflow

## 6.12 RFID

- RFID card/tag
- credential registration
- credential replacement
- lost credential
- disabled credential
- duplicate credential handling
- RFID reader
- reader registration
- reader location
- reader health
- connectivity
- reader events
- authentication events
- attendance events
- entry/exit
- anti-duplication
- offline events
- synchronization

Critical principle:

`RFID identity -> authenticated employee -> authorization check -> permitted action`

RFID itself never grants authorization.

## 6.13 Hardware

Hardware abstraction for:

- barcode scanner
- RFID reader
- receipt printer
- label printer
- weighing scale
- cash drawer
- customer display
- ESP32 devices
- future device types

Device model includes:

- device type
- identifier
- store
- location
- connection
- status
- firmware
- last seen
- capabilities
- configuration

Business logic must not depend directly on one hardware vendor.

## 6.14 Offline POS

The POS must work during temporary network outages.

Includes:

- local product cache
- local price cache
- permitted customer cache
- local inventory snapshot
- durable local database
- outbox
- transaction queue
- local receipt generation
- synchronization
- retry
- idempotency
- conflict detection
- conflict resolution
- server authority
- dead-letter handling
- offline shift behavior

The POS is a separate local-first surface, not simply a smaller back-office screen.

## 6.15 Cash

- cash drawer
- register
- shift
- opening float
- cash sale
- cash in
- cash out
- withdrawal
- deposit
- expected cash
- actual cash
- variance
- reconciliation
- close-shift controls

## 6.16 Payments

- payment
- payment method
- payment transaction
- split payment
- provider abstraction
- callback handling
- idempotency
- refunds
- retry behavior
- payment failure handling

Do not hard-code one provider into business logic.

## 6.17 Approvals

Configurable approval workflows for appropriate protected operations:

- large discounts
- large refunds
- inventory adjustment
- write-off
- customer credit
- supplier return
- price change
- attendance correction
- cash withdrawal
- cash variance resolution
- other protected transitions

Two-person separation is required where the specification demands it.

## 6.18 Audit

Audit important operations including:

- login
- logout
- authentication failure
- permission changes
- employee changes
- product changes
- price changes
- inventory adjustments
- transfers
- purchasing
- sales
- returns
- refunds
- customer credit
- supplier balances
- payments
- configuration
- device changes
- RFID assignments
- attendance corrections

Audit records need appropriate:

- actor
- timestamp
- action
- entity
- entity ID
- before state where required
- after state where required
- IP/device/session metadata where required
- reason/comment where required

Audit is append-only and must not be silently editable.

## 6.19 Reporting

Sales:

- daily sales
- product
- category
- cashier
- store
- payment method
- refunds
- returns

Inventory:

- current stock
- low stock
- out of stock
- movement
- valuation
- dead stock
- damaged stock
- expired stock
- near expiry
- adjustments
- count variance

Purchasing:

- purchases
- supplier performance
- purchase history
- pending orders
- receiving discrepancies

Financial/operational:

- revenue
- cost
- gross margin
- tax
- refunds
- customer credit
- supplier balances
- cash variance

Employee:

- attendance
- shifts
- cashier activity
- transaction activity

Reports need explicit as-of semantics and export behavior.

## 6.20 Notifications

Potential events:

- low stock
- out of stock
- near expiry
- expired
- approval required
- synchronization failure
- offline terminal
- RFID reader offline
- unusual inventory adjustment
- large refund
- cash variance
- other specification-defined events

Notification state/ownership remains an explicit architecture gate where documented.

---

# 7. CORE DATA MODEL PRINCIPLES

## 7.1 Product vs SKU

`Product` is the SPU.

`ProductVariant` is the stockable/priced/barcoded SKU.

Stock, price, and barcode belong to the variant.

## 7.2 Stock

Stock exists at `StorageLocation`.

A `StockItem` represents a variant/location relationship.

## 7.3 Money

Money uses exact integer minor units end-to-end.

Never use floating point for financial values.

## 7.4 Quantity

Quantity carries a unit.

Stock is stored in the product's base unit.

Countable items use integer quantities.

Measurable items use appropriate decimal precision.

## 7.5 Time

- technical timestamps in UTC
- business date in store timezone
- hardware event time plus server receipt time
- server ordering remains authoritative

## 7.6 IDs

- opaque surrogate IDs
- human-readable document numbers
- never reuse document numbers
- synchronization entities use client operation IDs

## 7.7 Deletion

No hard delete of entities that appear in financial/inventory history.

Use archival/status changes.

Finalized documents are corrected using compensating documents.

---

# 8. NON-NEGOTIABLE BUSINESS INVARIANTS

At minimum:

1. Every inventory balance write has a corresponding movement in the same transaction.
2. Inventory movements cannot be silently deleted.
3. A sale cannot silently mutate after finalization.
4. A finalized document is immutable.
5. Corrections use compensating documents.
6. Return quantity cannot exceed eligible sold quantity.
7. A return cannot be processed twice.
8. Refund cannot exceed refundable amount.
9. Payment cannot silently be duplicated.
10. Synchronization is idempotent.
11. Hardware events are idempotent.
12. Store scope is enforced server-side.
13. Authorization is default-deny.
14. RFID never substitutes for authorization.
15. Protected transitions require their defined permission.
16. Undefined permissions must never be invented.
17. Money arithmetic is deterministic.
18. Entry quantities cannot be negative.
19. Transfers cannot create or destroy stock.
20. Expired stock cannot be sold when expiry blocking applies.
21. Audit records are append-only.
22. Ordinary users cannot edit audit history.
23. A client cannot dictate authoritative store scope.
24. A client cannot dictate authoritative totals.
25. A client cannot dictate authoritative permission.
26. Retried operations must not duplicate effects.
27. Document numbers are never reused.
28. Important state changes are audited.
29. Financial/inventory history remains reconstructable.
30. Finalized documents are never hard-deleted.
31. Supplier and customer balances are ledger/projection based.
32. Derived state must be rebuildable.
33. Reconciliation detects and alerts; it does not silently repair.
34. External device/payment I/O is outside the core business transaction.

The detailed `business-invariants.md` remains authoritative and must be consulted before changing these.

---

# 9. SECURITY GOAL

SmartStore must be designed assuming clients, terminals, devices, and network requests can be untrusted.

Required security properties:

- server-side authorization
- exact permission matching
- default deny
- store/warehouse scope enforcement
- secure sessions
- httpOnly cookies
- secure cookies
- sameSite protection
- session rotation on login
- session invalidation on privilege change
- strong password hashing
- password rehashing support
- no plaintext passwords
- no secrets in source
- no client-controlled authority
- CSRF protection where applicable
- input validation
- output encoding
- parameterized database access
- rate limiting for sensitive operations
- authentication abuse protection
- audit logging
- idempotency
- replay protection
- secure device registration
- secure RFID credential lifecycle
- safe file handling
- safe import handling
- dependency security
- security headers where applicable
- safe error messages
- no sensitive data leakage in logs
- no PII dumping into ordinary logs

Security claims must be verified by tests, not assumed from architecture.

---

# 10. PERFORMANCE / RELIABILITY GOAL

The final system must be designed for real retail use.

Important targets to establish during implementation:

- fast barcode scan-to-line response
- fast product search
- fast checkout
- bounded local POS checkout time when offline
- predictable inventory transaction latency
- safe concurrent sales
- safe concurrent stock updates
- reliable sync retries
- no duplicate synchronization
- no lost completed local sale
- controlled report load
- pagination for large datasets
- indexes based on actual query patterns
- background jobs for expensive work
- health checks
- metrics
- structured logs
- alerting
- database backup verification

Exact numeric SLOs should be explicitly decided rather than invented by an agent.

---

# 11. RELIABILITY / FAILURE GOAL

SmartStore must expect:

- server outage
- database outage
- internet outage
- terminal outage
- RFID reader outage
- scanner disconnect
- printer failure
- scale disconnect
- payment provider timeout
- payment provider success with lost response
- duplicate callback
- device duplicate event
- employee disabled while logged in
- expired credentials
- offline terminal queue
- application restart
- partial deployment
- migration failure
- power loss

The system must fail safely and preserve authoritative history.

---

# 12. OFFLINE POS GOAL

Offline mode is not a convenience feature.

It is a core reliability requirement.

When offline, the terminal must:

- continue supported checkout operations
- store completed transactions durably
- assign idempotency keys
- preserve transaction order where required
- generate receipts according to supported offline rules
- synchronize later
- never apply the same transaction twice
- surface conflicts rather than silently hiding them

The server remains authoritative.

**Open decision remains:** offline inventory ownership/reservation behavior.

Do not invent this.

---

# 13. MULTI-STORE GOAL

The first deployment may be one store.

The architecture must not prevent:

- multiple stores
- multiple warehouses
- central warehouse
- store transfers
- store-specific employees
- cross-store managers
- central administration
- store-specific pricing/configuration
- store-specific stock
- store-specific terminals

A Store A employee must not automatically see or mutate Store B data.

---

# 14. RFID + ATTENDANCE GOAL

RFID should support both authentication and attendance while keeping the concepts separate.

Authentication:

`RFID -> identity -> session/authentication -> authorization`

Attendance:

`RFID event -> employee -> attendance interpretation`

The same RFID event must not automatically be treated as both without explicit business rules.

Need support for:

- registration
- replacement
- lost card
- disabled card
- duplicate card
- reader assignment
- reader health
- offline events
- event idempotency
- attendance correction
- audit

---

# 15. HARDWARE GOAL

Hardware must be replaceable without rewriting business logic.

Use abstractions/interfaces for:

- scanner
- RFID
- printer
- scale
- cash drawer
- display
- ESP32/future devices

Business modules should not contain vendor-specific protocol code.

Hardware I/O should be isolated from financial transactions.

---

# 16. UI / UX GOAL

The final product must look and behave like a serious retail application, not an AI-generated CRUD demo.

Surfaces:

### Back-office

For:

- managers
- inventory staff
- warehouse staff
- buyers
- accountants
- administrators
- auditors

Needs:

- dense but readable data tables
- powerful search
- filters
- sorting
- bulk operations
- exports
- dashboards
- clear status
- clear validation
- confirmation for destructive/protected operations

### POS

Must optimize for:

- speed
- keyboard
- barcode scanner
- touch
- minimal clicks
- large readable totals
- payment clarity
- offline state
- hardware status
- cashier workflow

### Employee self-service

Must be:

- mobile friendly
- simple
- tap-first
- accessible
- useful on intermittent connectivity

### General UX

Required:

- loading states
- empty states
- error states
- success feedback
- permission-denied states
- offline states
- sync states
- confirmation states
- accessible focus
- keyboard operation
- sufficient contrast
- no color-only meaning
- responsive layouts
- consistent terminology

---

# 17. "DO NOT LOOK AI-GENERATED" GOAL

The application should not look like a generic generated admin dashboard.

Avoid:

- meaningless gradients everywhere
- excessive glassmorphism
- giant dashboard cards with fake metrics
- arbitrary animations
- placeholder charts
- random icons
- inconsistent spacing
- fake data presented as real
- excessive rounded containers
- unnecessary dark patterns
- generic "AI SaaS" styling

Instead:

- design around real retail workflows
- use meaningful information hierarchy
- make tables operationally useful
- optimize POS for speed
- use realistic empty/error/loading states
- use consistent domain terminology
- make every screen answer a real operational question
- avoid decorative UI that slows staff down

The UI should feel like software built for an actual store.

---

# 18. REPORTING / ANALYTICS GOAL

Reports must be based on authoritative data.

Never calculate a financial report from a mutable UI cache.

Need:

- filters
- date ranges
- store scope
- warehouse scope where applicable
- as-of semantics
- pagination
- export
- reproducibility
- permission checks
- report audit where appropriate

Analytics may be derived projections.

They must never become a second conflicting source of truth.

---

# 19. IMPORT / EXPORT GOAL

Import/export must be production-grade.

Imports should support:

- validation
- dry run
- preview
- error rows
- duplicate detection
- authorization
- transaction boundaries
- audit
- idempotency where appropriate
- safe rollback behavior

Exports should:

- respect permissions
- respect store scope
- avoid accidental PII exposure
- handle large datasets
- provide clear file formats
- record important export operations when required

---

# 20. BACKUP / RECOVERY GOAL

The production system must eventually have:

- automated database backups
- backup retention
- restore testing
- recovery procedures
- disaster recovery documentation
- database migration recovery strategy
- backup monitoring
- verification that backups are actually restorable

**A backup that has never been restored successfully is not a proven backup.**

Exact RPO/RTO targets must be explicitly chosen rather than invented.

---

# 21. OBSERVABILITY GOAL

Production must eventually provide:

### Logs

- structured logs
- correlation/request IDs
- safe error details
- no secrets
- no unnecessary PII

### Metrics

At minimum consider:

- request latency
- error rate
- DB latency
- transaction failures
- sync backlog
- dead-letter count
- offline terminals
- RFID reader health
- payment failures
- inventory reconciliation alerts
- queue depth
- job failures

### Health

- liveness
- readiness
- database health
- critical dependency health

### Alerting

Alert on meaningful operational failures rather than every warning.

---

# 22. DATABASE GOAL

The database must reflect business truth, not UI convenience.

Expected characteristics:

- PostgreSQL
- migrations
- foreign keys
- unique constraints
- check constraints where appropriate
- indexes based on access patterns
- transaction boundaries
- row locking for contested aggregates
- optimistic versioning where appropriate
- append-only ledgers
- immutable finalized records
- store scoping
- audit relations
- idempotency constraints
- safe migration strategy
- backward-compatible rollout where tills update independently

Never create a mutable `stock` column on Product as the authoritative inventory source.

---

# 23. API GOAL

API design must:

- validate all inputs
- authenticate
- authorize
- enforce scope
- use consistent errors
- use idempotency for retryable operations
- never trust client totals
- never trust client permissions
- never trust client store scope
- use transactions around business invariants
- version from first release
- support independently updated tills
- avoid leaking internal exceptions
- document contracts

The API should expose business operations rather than arbitrary table CRUD where that would bypass invariants.

---

# 24. STATE MACHINE GOAL

Every important lifecycle must explicitly define:

- source state
- destination state
- actor/role basis
- permission
- preconditions
- side effects
- audit requirement
- reversal/cancellation behavior where applicable

An unlisted transition is a bug.

Never add a transition just because a UI needs it.

If the transition is not authorized, the correct behavior is refusal until the product decision is made.

---

# 25. AUDIT GOAL

Audit is not a logging table for debugging.

It is a business control.

It must allow a reviewer to answer:

- who did it?
- what did they do?
- to what?
- when?
- from what state?
- to what state?
- why?
- from which device/session/IP when applicable?
- what business document was involved?
- was approval required?
- who approved it?

Audit event vocabulary must remain closed and reviewed.

Do not invent audit types to make implementation convenient.

---

# 26. APPROVAL GOAL

Approval must be enforceable, not decorative.

A protected operation should not become valid simply because the UI displayed an approval button.

Server-side enforcement must verify:

- who requested
- who approved
- required permission
- separation-of-duties rule
- threshold
- subject
- status
- timing
- audit record

---

# 27. FINANCIAL CORRECTNESS GOAL

Money must be deterministic.

Need:

- exact arithmetic
- integer minor units
- tax handling
- rounding rules
- line snapshots
- payment records
- refund records
- credit ledger
- supplier payable ledger
- cash reconciliation
- gross margin calculation
- reproducible reports

Do not use floating point for financial values.

Do not silently recompute historical totals from current prices/tax configuration.

---

# 28. INVENTORY CORRECTNESS GOAL

The system must always be able to answer:

> "Why is the stock quantity what it is?"

For every stock balance, the system should be able to reconstruct:

- opening balance
- purchases
- sales
- returns
- transfers
- adjustments
- damage
- expiry
- loss
- found stock
- other approved movement types

Stock movement history is authoritative.

---

# 29. CONCURRENCY GOAL

The system must safely handle:

- two cashiers selling the same final unit
- simultaneous stock adjustments
- simultaneous receiving
- simultaneous returns
- simultaneous transfers
- concurrent payment callbacks
- duplicate sync requests
- duplicate hardware events

The implementation must choose explicit locking/versioning strategies.

Do not assume "the database will handle it."

---

# 30. TESTING GOAL

Testing must cover:

### Unit

- domain rules
- calculations
- state transitions
- permission evaluation
- quantity conversion
- tax
- rounding
- FEFO

### Integration

- database transactions
- inventory movements
- sale + payment + stock
- return + refund + stock
- receiving + stock
- supplier invoice + payable
- customer credit
- audit

### Security

- unauthorized endpoint access
- cross-store access
- privilege escalation
- replay
- duplicate operations
- invalid transitions
- malformed input
- session invalidation
- RFID misuse

### Concurrency

- last-unit sale
- duplicate callbacks
- duplicate synchronization
- simultaneous adjustment

### E2E

- purchase -> receive -> stock -> sale -> payment -> receipt
- sale -> return -> refund
- employee -> RFID -> attendance
- offline sale -> reconnect -> synchronization
- transfer between locations/stores
- shift open -> sales -> close -> reconciliation

### Hardware

Use real devices where possible and simulators/mocks where necessary.

---

# 31. CI/CD GOAL

Eventually include:

- formatting
- linting
- static analysis
- unit tests
- integration tests
- security checks
- migration checks
- dependency checks
- build
- frontend build
- API contract checks
- E2E tests
- artifact creation
- deployment validation

A branch should not be considered production-ready merely because the application starts.

---

# 32. DEVELOPMENT ENVIRONMENTS

Maintain:

- development
- test
- staging
- production

Staging should have production-like data shapes without exposing real sensitive data.

Secrets must be injected, not committed.

---

# 33. MIGRATION GOAL

Database migrations must:

- be versioned
- be reproducible
- be reviewed
- preserve data
- support rollback/recovery strategy
- avoid destructive changes without a migration plan
- respect independently updated tills
- remain compatible during deployment windows

Never manually modify production schema outside the migration process.

---

# 34. HARDWARE TESTING GOAL

For every hardware integration:

1. define interface
2. define capabilities
3. define connection states
4. define timeout behavior
5. define retry behavior
6. define duplicate-event behavior
7. define offline behavior
8. define failure reporting
9. test with simulator/mock
10. test with actual device where possible

---

# 35. LOCALIZATION / RETAIL SETTINGS

The system should eventually support configurable:

- currency
- timezone
- business date
- tax categories
- rounding
- units
- receipt format
- document numbering
- store settings
- language/translation where required

Nepal-specific tax/fiscal requirements must not be invented.

Where legal/fiscal compliance is required, it must be explicitly researched and specified before implementation.

---

# 36. PRIVACY / DATA GOVERNANCE

Need explicit policies for:

- customer data
- employee data
- authentication data
- RFID identifiers
- attendance history
- audit history
- payment references
- retention
- export
- deletion/anonymization where legally required
- access to sensitive reports

Do not claim regulatory compliance without identifying the applicable jurisdiction and evidence.

---

# 37. DEVICE / TERMINAL SECURITY

Eventually support:

- terminal registration
- device identity
- device disable
- device replacement
- secure enrollment
- credential rotation
- device health
- last seen
- software/version tracking
- capability reporting

A compromised terminal must not automatically gain administrative authority.

---

# 38. DATA RETENTION

Explicitly define retention for:

- audit records
- sales
- payments
- inventory movements
- attendance
- RFID events
- synchronization records
- failed jobs
- dead letters
- logs
- backups

Retention may vary by legal/business requirement.

Do not invent retention periods without a decision.

---

# 39. ADMINISTRATION GOAL

Back-office administration should eventually support:

- organizations
- stores
- warehouses
- locations
- users
- employees
- roles
- permissions
- devices
- terminals
- configuration
- taxes
- units
- reason codes
- notification rules
- approval thresholds
- price lists
- categories
- brands
- suppliers
- customers

Sensitive configuration changes must be permissioned and audited.

---

# 40. COMPLETENESS CHECKLIST

SmartStore is NOT "complete" merely because these pages exist.

Completion requires all relevant layers:

### Product

- [ ] requirements
- [ ] business rules
- [ ] edge cases
- [ ] state machines
- [ ] approvals
- [ ] permissions
- [ ] audit requirements

### Architecture

- [ ] module boundaries
- [ ] transaction boundaries
- [ ] concurrency strategy
- [ ] offline strategy
- [ ] synchronization
- [ ] hardware abstraction
- [ ] payment abstraction
- [ ] security architecture
- [ ] deployment architecture

### Database

- [ ] entities
- [ ] relationships
- [ ] constraints
- [ ] indexes
- [ ] migrations
- [ ] seed strategy
- [ ] audit structures
- [ ] idempotency structures
- [ ] ledger structures

### Backend

- [ ] authentication
- [ ] authorization
- [ ] domain services
- [ ] validation
- [ ] transactions
- [ ] APIs
- [ ] background jobs
- [ ] notifications
- [ ] reporting
- [ ] imports/exports

### Frontend

- [ ] back-office
- [ ] POS
- [ ] employee self-service
- [ ] responsive design
- [ ] accessibility
- [ ] keyboard/scanner workflow
- [ ] offline UI
- [ ] sync UI
- [ ] error states
- [ ] permission states

### Hardware

- [ ] scanner
- [ ] RFID
- [ ] printer
- [ ] scale
- [ ] cash drawer
- [ ] ESP32/device abstraction
- [ ] simulator/test harness

### Reliability

- [ ] retries
- [ ] idempotency
- [ ] concurrency
- [ ] offline recovery
- [ ] backup
- [ ] restore test
- [ ] disaster recovery
- [ ] monitoring
- [ ] alerting

### Security

- [ ] threat model
- [ ] auth
- [ ] RBAC
- [ ] scope isolation
- [ ] session security
- [ ] CSRF/XSS/SQLi protections
- [ ] rate limiting
- [ ] audit
- [ ] secrets
- [ ] dependency security
- [ ] security testing

### Operations

- [ ] CI
- [ ] CD
- [ ] migrations
- [ ] staging
- [ ] production configuration
- [ ] observability
- [ ] runbooks
- [ ] incident response
- [ ] backup procedures

### Quality

- [ ] unit tests
- [ ] integration tests
- [ ] E2E tests
- [ ] concurrency tests
- [ ] security tests
- [ ] offline tests
- [ ] hardware tests
- [ ] migration tests
- [ ] performance tests

---

# 41. CURRENT ARCHITECTURAL GATES

These are NOT to be silently resolved by Claude Code.

## GATE-Q1

Central warehouse stock attribution:

- one store attribution
- multiple store attribution

Must be decided before the affected schema is frozen.

## GATE-PAYABLE

When does supplier payable legally/business-wise exist?

- matched
- approved for payment

Must be decided before AP ledger semantics are frozen.

## GATE-PERMKEYS

13 permission keys remain undefined across 29 transitions in 8 state machines.

Possible decisions include:

- define missing permission keys
- map them to existing permissions/roles where explicitly justified
- remove affected transitions from v1 scope

Claude must not invent role assignments.

## GATE-OFFLINE-INVENTORY

How is inventory ownership/reservation handled when an offline POS sells stock?

This is closely connected to GATE-Q1.

## GATE-AUDITTYPES

Some audit transition cells still require final event vocabulary decisions.

## GATE-DEADLETTER

Determine whether the server observes a dead-letter state and how it is represented.

## GATE-NOTIFICATION-STATES

Finalize ownership and semantics of notification states.

## GATE-STOCKCOUNT-STATES

Finalize the state owner and transition semantics.

## GATE-Q2-LICENCE

Commercial release gate.

Third-party dependencies must satisfy the project's permissive-license requirement.

## GATE-Q4-DUNNING

Determine whether customer credit has a due date in a future version.

v1 currently has no credit due date.

---

# 42. WHAT CLAUDE CODE MAY DECIDE

Claude may make implementation decisions only when they do not change product/domain behavior.

Examples:

- file organization
- class naming consistent with conventions
- internal helper structure
- test organization
- framework idioms after stack approval
- query optimization that preserves semantics
- UI component structure
- refactoring

Claude must document meaningful architectural implementation decisions.

---

# 43. WHAT CLAUDE CODE MAY NOT DECIDE

Without explicit approval:

- business rules
- permissions
- role privileges
- financial semantics
- stock ownership
- state transitions
- tax rules
- refund rules
- offline inventory policy
- customer credit policy
- supplier payable timing
- audit vocabulary
- regulatory compliance
- release licensing
- security exceptions

---

# 44. DEFINITION OF DONE

A SmartStore feature is DONE only when:

1. Requirement exists.
2. Business rule exists.
3. Permission exists.
4. State transition exists if applicable.
5. Database model exists.
6. Migration exists.
7. Backend/domain logic exists.
8. API exists where required.
9. UI exists where required.
10. Audit behavior exists.
11. Validation exists.
12. Error handling exists.
13. Authorization is enforced server-side.
14. Store scope is enforced.
15. Idempotency exists where required.
16. Transactions preserve invariants.
17. Tests exist.
18. Security tests exist where relevant.
19. Documentation exists.
20. Acceptance criteria pass.
21. No unresolved requirement was silently invented.
22. Evidence supports the completion claim.

---

# 45. PHASE ROADMAP

## Phase 0 — Evidence / reconnaissance

DONE.

## Phase 1 — Product/domain specification

DONE.

## Phase 1 semantic audit and correction

DONE WITH DOCUMENTED GATES.

## Phase 2 — Architecture

DONE WITH DOCUMENTED GATES.

## Phase 3 — Data model + API contracts

Next major engineering phase.

Should produce:

- finalized schema
- ERD
- migrations plan
- constraints
- indexes
- seed model
- API contracts
- error model
- idempotency model
- authorization data model
- audit schema
- synchronization schema

## Phase 4 — Foundation implementation

Expected:

- project structure
- authentication
- authorization
- organization/store model
- database
- migrations
- audit foundation
- permissions
- API foundation
- frontend shell
- design system
- testing infrastructure
- CI

## Phase 5+ — Domain implementation

Recommended incremental order:

1. Catalog
2. Inventory ledger
3. Procurement
4. Suppliers/payables
5. POS
6. Payments
7. Returns/refunds
8. Customers/credit/loyalty
9. Cash management
10. Employees/RBAC
11. RFID/attendance
12. Hardware
13. Offline POS/sync
14. Reporting
15. Notifications
16. Import/export
17. Backup/operations
18. hardening

Exact ordering may change after Phase 3 dependency analysis.

---

# 46. IMPLEMENTATION WORK STYLE

Claude Code should work in small verifiable increments.

For every implementation task:

1. Read relevant specifications.
2. Identify dependencies.
3. Identify unresolved gates.
4. State the intended change.
5. Implement.
6. Run tests.
7. Run static checks.
8. Inspect the diff.
9. Verify against acceptance criteria.
10. Report:
   - changed files
   - tests run
   - tests passed/failed
   - assumptions
   - unresolved questions
   - security implications
11. Stop if an unresolved business decision is encountered.

Do not make hundreds of unrelated changes in one task.

---

# 47. FINAL NORTH STAR

The finished SmartStore should allow a real retailer to answer, reliably:

### Inventory

- What do we have?
- Where is it?
- Which batch is it from?
- When does it expire?
- Why is the quantity what it is?
- Who changed it?

### Sales

- What was sold?
- At what price?
- With what discount/tax?
- Who sold it?
- Which terminal?
- Which payment?
- Was it online or offline?

### Returns

- What was returned?
- Was it actually eligible?
- How much was refunded?
- What happened to the returned stock?
- Who approved it?

### Purchasing

- What did we order?
- What arrived?
- What was damaged?
- What remains outstanding?
- What do we owe the supplier?

### Customers

- What does the customer owe?
- What have they paid?
- What loyalty balance exists?
- What is their transaction history?

### Employees

- Who is this employee?
- What are they allowed to do?
- Which stores can they access?
- When did they attend?
- Which RFID/device event created the attendance?

### Security

- Who performed the operation?
- Was it authorized?
- Was approval required?
- Was it audited?
- Can the operation be replayed?
- Can a user cross store boundaries?

### Resilience

- What happened when the network failed?
- Did the sale survive?
- Did synchronization duplicate it?
- Did inventory remain consistent?
- Can the system recover after a device failure?

### Operations

- Is the system healthy?
- Are terminals online?
- Are RFID readers healthy?
- Are synchronization queues stuck?
- Are backups working?
- Can the database be restored?

---

# 48. THE STANDARD WE ARE BUILDING TO

Do not optimize for:

> "The application runs."

Optimize for:

> **"The application is correct, secure, auditable, recoverable, testable, understandable, and operationally useful in a real retail environment."**

A pretty UI with broken inventory is a failure.

A working POS with broken auditability is a failure.

A secure backend with unusable cashier workflow is a failure.

A feature-complete system with unsafe offline synchronization is a failure.

A technically elegant system that silently invents business behavior is a failure.

A system that works only while the network and hardware behave perfectly is incomplete.

**SmartStore is complete only when the business rules, data, security, UI, hardware, offline behavior, operations, and verification all agree.**

---

# 49. SOURCE DOCUMENTS

The detailed specifications remain authoritative:

- `docs/product/product-overview.md`
- `docs/product/actors-and-roles.md`
- `docs/product/organization-model.md`
- `docs/domain/business-invariants.md`
- `docs/product/product-domain.md`
- `docs/product/inventory-domain.md`
- `docs/product/batch-expiry-fefo.md`
- `docs/product/procurement-domain.md`
- `docs/product/sales-pos-domain.md`
- `docs/product/returns-refunds-domain.md`
- `docs/product/customer-domain.md`
- `docs/product/supplier-domain.md`
- `docs/product/payment-domain.md`
- `docs/product/cash-management.md`
- `docs/product/employee-domain.md`
- `docs/product/rfid-domain.md`
- `docs/product/hardware-domain.md`
- `docs/product/offline-pos-domain.md`
- `docs/product/multi-store-domain.md`
- `docs/product/approval-workflows.md`
- `docs/product/audit-domain.md`
- `docs/product/reporting-domain.md`
- `docs/product/notification-domain.md`
- `docs/product/state-machines.md`
- `docs/product/edge-cases.md`
- `docs/product/ux-requirements.md`
- `docs/product/requirements-traceability.md`
- `docs/product/PHASE-1-REVIEW.md`
- `docs/architecture/PHASE-2-ARCHITECTURE.md`

---

# 50. MASTER RULE

**When in doubt, stop and verify.**

Do not guess.

Do not silently simplify.

Do not silently expand scope.

Do not silently change requirements.

Do not claim implementation without evidence.

Do not claim security without verification.

Do not claim completeness because the UI exists.

Build the system that the specification actually defines.
