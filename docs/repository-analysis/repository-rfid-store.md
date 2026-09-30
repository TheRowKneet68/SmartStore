# Repository Audit — Bucket RFID Store

| | |
|---|---|
| **Repository** | [Pushpendera5/bucket-rfid-store](https://github.com/Pushpendera5/bucket-rfid-store) |
| **Local clone** | `research/rfid-store` (shallow, depth 100) |
| **Stack** | .NET 10 / ASP.NET Core / EF Core / SQL Server / React 18 / Vite / LLRP over TCP |
| **License** | **NONE** (README: "all rights reserved") |
| **Verdict** | **`REFERENCE ONLY` (clean-room) — the only real hardware, and the brief's two headline RFID features do not exist** |

---

## 1. License

**There is no license.** No `LICENSE`, `COPYING`, or `LICENSE.md` in the repository root, and no SPDX
identifier in `backend/SmartStore.API.csproj`.

The README states: *"© 2025 Pushpendera Ranjan. All rights reserved."* **"All rights reserved" is an explicit
refusal to grant permission, not an implicit grant.** It is the clearest possible statement that the code is
unavailable for use.

**RFID may additionally be patent-encumbered independent of copyright** (risk L-07), which is a separate
question from the license. The correct route is stated in §7.

**Decision: `REFERENCE ONLY`, and specifically *clean-room*.** Read to understand that real hardware exists and
how LLRP is shaped; **do not copy, adapt, or paste code.** Reimplement from the **EPCglobal LLRP v1.0.1
specification**, which is freely published by GS1 and is the authoritative, licensable source.

---

## 2. Architecture

**A well-organised ASP.NET Core API with a React frontend, and a real hardware integration — surrounded by
security defects severe enough that none of it should be a template.**

```
backend/
  SmartStore.API/           (Program.cs, Controllers/, Models/, Services/, DTOs/, Data/)
    Llrp/                   ← 8 classes, 835 lines: the hardware protocol
    Controllers/            (18 controllers)
    Services/               (SalesService, GoodsReceiptService, AttendanceService, …)
  SmartStore.Console/       (console app — 1 of 3 in the main tree)
  SmartStore.Simulator/     (console app)
  SmartStore.App/           (WinForms, net6.0-windows — desktop app)
frontend/                   (React 18 + Vite)
database/                   (SQL scripts)
```

**The good part — real separation and a service layer.** `Program.cs` registers DI properly, and the business
logic sits in `Services/` (`SalesService`, `GoodsReceiptService`, `AttendanceService`, `AuthService`,
`RfidService`, `ReportService`, `ExpenseService`, `CustomerService`, `SupplierService`,
`PurchaseOrderService`, `DashboardService`). Controllers are thin. **This is the correct shape**, and it is
similar to YourGbDev's.

**The bad part — three global state problems:**

| # | Finding | Evidence |
|---|---|---|
| ~~1~~ | ~~**`DbContext` registered as a singleton** (risk A-17).~~ **REFUTED.** `Program.cs:16-17` is a plain `builder.Services.AddDbContext<StoreDbContext>(options => …)` with **no lifetime override**, which defaults to **`Scoped`** — correct and idiomatic. The cited `Program.cs:46` singleton registration and its `System.Data.Entity.DbContext` comment do not exist in that file. **This item is withdrawn entirely** | — |
| 1 | **RFID reader host/port are attacker-controllable** (risk S-02, confirmed) — `RfidReaderController.cs:53-55` prefers a `readerHost` query parameter over configuration, `:57` takes a free `readerPortOverride`, and `:68` passes both to `ConnectAsync`. Unauthenticated, no allowlist | `RfidReaderController.cs:50-68` |
| 2 | **`AuditLog` is written by RFID scans only, and records no actor** (risk S-12, confirmed). `AuditLogs.Add` appears exactly twice, both in `RfidReaderController.cs:117,165`; `PerformedByUserId` and `IpAddress` are declared (`AuditLog.cs:13,16`) and never assigned | `RfidReaderController.cs` |
| 3 | **JavaScript variable shadowing in a money context** (risk A-16). In `js/controllers/appController.js:57-90`, `var k, n` **shadow the outer `k` (total) and `n` (items)** declared at lines 7-8, so **`k` is reassigned to 0 and the total silently becomes 0**. A cart total that can be zeroed by shadowing is a financial bug in the browser | `appController.js:57-90` |

**On the reader design specifically:** the first draft claimed there was "no reader abstraction" — an
inseparable hardware dependency. **That is false.** `backend/Services/LlrpReaderService.cs` defines
`public interface ILlrpReaderService` (`:5`), and `Program.cs:20` registers
`AddScoped<ILlrpReaderService, LlrpReaderService>()`. The abstraction is present and correctly scoped. The real
defect is that **request input reaches behind the abstraction** — the interface is fine, the controller's use of
it is not.

**No tests anywhere** (risk A-15). **No `Migrations/` at all** (risk D-14) — see §3. **No Dockerfile, no
compose file, no CI.**

**Three console apps and a WinForms app in the same repository as the API** — hardware tooling mixed with the
service. The `SmartStore.App` project targets `net6.0-windows`, a **Windows Forms** desktop app, in an otherwise
cross-platform API repository. This belongs in a separate repository.

---

## 3. Database and inventory model

**A stock column, and no migrations.**

```csharp
// Models/Product.cs
public int StockQty { get; set; }
```

A mutable `Int` on `Product`, mutated directly by sales, returns, and receiving.

> **CORRECTED — the first draft claimed there is no movement ledger. There is one.** `InventoryTransaction`
> exists and is written from **four** sites: `GoodsReceiptsController.cs:73`, `InventoryTransactionsController.cs:42`,
> `SalesCheckoutController.cs:117`, and `SalesReturnController.cs:71`. So the balance-plus-ledger pattern the rest
> of this document recommends is **already partly present in this repository**, which makes the gap narrower and
> easier to state honestly: the ledger exists but is **not consistently maintained**. `InventoryController.Update:103`
> sets `StockQty` outright with **no** movement row, `Restock:141` adds to the balance with no movement row, and
> `InventoryTransactionsController.Create` (`:40`) inserts a client-supplied row **without updating
> `StockQty`** — so the ledger and the balance can drift in *both* directions, from two different code paths.
>
> The correct design lesson is therefore not "RFID has no ledger" but **"every balance write must be paired with a
> movement write in the same transaction"** — which is exactly what the RFID codebase does not do, and exactly
> what OSPOS gets wrong on adjustment (D-02) and CSV import (D-03).

**There are no migrations.** `Migrations/` is empty; the schema exists only in the compiled assembly. **There is
no way to create the database from source** (risk D-14). The `database/` folder has a SQL script
(`init.sql`-style) for a 4-table subset that does not match the EF model — `SaleItem` exists in the model but
not in the script.

**EF model** (`Data/StoreDbContext.cs`, 15 `DbSet<>`): `Product`, `Category`, `Brand`, `Customer`, `Sale`,
`SaleItem`, `Payment`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceipt`, `GoodsReceiptItem`,
`RfidTag`, `AuditLog`, `Employee`, `User`, plus the `StoreDbContext` itself. The `Employee` entity has a
`PasswordHash` field but the model class is used inconsistently with `User` for authentication — two parallel
identity concepts.

**Purchasing — the best GRN *data model* in the set, with a non-functioning implementation.** `GoodsReceiptItem`:

```csharp
public class GoodsReceiptItem
{
    public int QuantityReceived { get; set; }
    public int QuantityAccepted  { get; set; }
    public int QuantityRejected  { get; set; }
    // …PurchaseOrderItemId, ProductId
}
```

and `ReceiptStatus { Open, Partial, Closed, Rejected }`. **Those are exactly the right columns and the right
state machine for a GRN.** And the code that populates them does not work (risk D-13):

```csharp
// Controllers/GoodsReceiptsController.cs:52-55
var grn = new GoodsReceipt
{
    // …PurchaseOrderId, ReceivedByUserId
    Status = ReceiptStatus.Closed,          // ← hardcoded; never Partial
};
foreach (var item in request.Items)
{
    grn.Items.Add(new GoodsReceiptItem
    {
        QuantityReceived = item.QuantityReceived,
        // ← QuantityAccepted and QuantityRejected are never written
    });
}
var po = await _db.PurchaseOrders.FindAsync(request.PurchaseOrderId);
po.Status = OrderStatus.Received;           // ← unconditional
// product.StockQty += item.QuantityReceived;
```

Three defects in one method: `Status` is hardcoded `Closed`; `QuantityAccepted`/`QuantityRejected` are never
written; the PO's `order_items` are **never read**, so there is no received-vs-ordered comparison and
**no over-receipt guard** — `product.StockQty += item.QuantityReceived` runs against a `PurchaseOrderId`
validated only for existence, so **you can receive any quantity of any product against any purchase order**
(risk S-11 class). Inventory and payables inflate without bound. An over-receipt guard is a one-line fix that
was never written.

**Partial receiving is vestigial.** The `receiving_status` field and the partial-receipt code path exist, but
no receiving-status update exists, and every PO receipt sets `po.Status = Received` — so the "partial" state
is unreachable in practice (missing-features C4).

**No cost on sale lines.** `SaleItem` has `Quantity`, `Price`, `Total` but **no cost price**, so margin
reporting is impossible (risk D-15). OSPOS freezes cost on the line; this cannot.

**No audit columns.** Seven+ entities have no `created_at`/`updated_at` (risk S-11), which is why `AuditLog` is
the only trace of anything and why retrofitting a real audit trail is hard.

**No `Decimal` money convention**, no FKs, no indexes beyond the defaults, no transactions.

**Money as `int`.** `Sale.TotalAmount`, `SaleItem.Total`, `Payment.Amount` are `int`. In this codebase's
target market that is *probably* rupees (and so minor units), which would be correct — but it is undocumented
and unstated, so it is an accident rather than a decision.

---

## 4. Security

**The most dangerous codebase in the set by exploitability, even though it is not the largest.**

| ID | Status | Finding | Evidence |
|---|---|---|---|
| **S-01** | **CRITICAL — CONFIRMED, worse than first recorded** | **Anonymous stock mutation and unbounded return-driven inflation.** The controllers are `InventoryController` (`[Route("api/inventory")]`, `:9-11`) and `SalesReturnController` (`[Route("api/sales-returns")]`, `:9-11`) — **not** `StockController`/`ReturnsController`, and the routes are **not** `/api/stock/{id}` or `/api/returns`. Neither class carries `[Authorize]`. `InventoryController.Update:103` does `product.StockQty = request.Stock;` with **no range check at all** (negatives accepted). `SalesReturnController.cs:69` does `product.StockQty += item.Quantity;` with **no positivity check**, **no cap against quantity sold** (`:63` matches the order line on `ProductId` only), **no order-status validation** (`:52-54`), and `:86` sets `order.Status = OrderStatus.Returned` unconditionally — so the identical request is **replayable indefinitely**. `Restock` (`:130,141`) is the only method with a check | `Controllers/InventoryController.cs`, `Controllers/SalesReturnController.cs` |
| **S-02** | **HIGH — CONFIRMED, mechanism restated** | **Unauthenticated SSRF via reader host/port.** `RfidReaderController.cs:50-51` takes `readerHost` and `readerPortOverride`; `:53-55` **prefers the caller's host over configuration**; `:57` takes the port; `:64` clamps the timeout to 1000–30000 ms; `:68` passes both to `_llrpReaderService.ReadTagsAsync` → `LlrpReaderService.cs:30` `ConnectAsync`. No allowlist, no CIDR check, unauthenticated. **Risk as stated precisely: SSRF with internal network reachability probing and port enumeration, not remote code execution** — the server writes an LLRP handshake rather than returning socket contents | `Controllers/RfidReaderController.cs:50-68` |
| **S-11** | **CRITICAL — CONFIRMED** | **Unsalted single-pass SHA-256 password hashing.** `Services/PasswordHashHelper.cs` is 15 lines total: `:10` `SHA256.HashData(Encoding.UTF8.GetBytes(value))`, `:14` compares with `Equals`. No salt, no work factor, hex-encoded. A grep for `BCrypt`/`Argon`/`PBKDF` across `backend/**/*.cs` finds nothing. **`AuthController.cs:22-32` returns `Unauthorized` on failure with no attempt counter, delay, or lockout.** **`Data/StoreSeedData.cs:30,33` seeds `admin` / `Admin@123`** — a default credential that, with an unsalted hash and no lockout, is directly exploitable | `Services/PasswordHashHelper.cs`, `Data/StoreSeedData.cs` |
| **S-12** | **HIGH — CONFIRMED** | **`AuditLog` is not an audit trail.** `AuditLogs.Add` appears exactly **twice**, both in `RfidReaderController.cs:117,165` (RFID scans only). `IpAddress` and `PerformedByUserId` are declared (`AuditLog.cs:13,16`) and a repo-wide search for those two identifiers returns **only the declarations** — they are never assigned. `AuditActionType.Login`/`.Logout` are declared and never referenced. No login, no failed authentication, no permission change, no financial change is audited — on a system that issues refunds and adjusts stock | `Domain/Entities/AuditLog.cs`, `Controllers/RfidReaderController.cs` |
| — | **CONFIRMED** | **16 of 18 controllers have no `[Authorize]` and there is no fallback policy.** A repo-wide `[Authorize]` search returns exactly two hits — `RolesController.cs:9` and `UsersController.cs:12`, both `[Authorize(Roles = "Administrator")]`. `Program.cs:55` is a bare `AddAuthorization()` with **no `FallbackPolicy`**, so the default policy is unauthenticated. Separately, all **7** `PermissionsJson` occurrences are DDL (`Program.cs:75,82,84`), a login response field (`AuthController.cs:49`), a role-list field (`RolesController.cs:27`), one admin write (`:51`), and a seed (`StoreSeedData.cs:17`) — **none consults it for an authorization decision** | `Program.cs`, `Controllers/` |
| **S-24** | **MEDIUM — CORRECTED** | **Reader read failure is reported to the caller as "no tags found".** `Services/LlrpReaderService.cs:118-121` catches `Exception`, **logs it** via `_logger.LogError`, then returns the collected tags — so a failed read and a successful read of an empty store are indistinguishable to the caller, and `RfidReaderController.cs:70-73` renders that as `200 OK` with "No tags found during read". `TestConnectionAsync` (`:135-148`) *does* report failure as `false`, so connectivity is independently checkable. **The first draft's "swallows all exceptions" and "5-second poll" claims are withdrawn** (the latter was not traced) | `Services/LlrpReaderService.cs` |
| ~~S-15~~ | **REFUTED — removed** | *"Mass assignment / prototype-chain pollution via a `JobAssignment` value object."* **`JobAssignment` appears nowhere in the repository**, and there is no `JsonConvert` / `JsonSerializerSettings` — the project uses `System.Text.Json` (`Program.cs:11`, `RfidReaderController.cs:5`), which does not exhibit that key-name behaviour. Separately, the mass-assignment premise is also false: `InventoryController.Update` (`:86-125`) and `BulkCreate` (`:158-227`) take a typed `InventoryUpsertRequest` and assign named properties individually (`:101-108`); `SalesReturnController` takes `ReturnRequestDto`. The genuine narrowing finding is that `RfidTagsController.Create(RfidTag tag)` and `InventoryTransactionsController.Create(InventoryTransaction transaction)` (`:40`) do accept entities directly | — |
| ~~S-14~~ | **UNVERIFIED** | *"LLRP `resetToFactory: true` on every read; response status unchecked; TV/TLV discriminator wrong; buffer desync."* Not re-verified in the correction pass. The *design* lesson (never reset production hardware per read; check every response status) follows from the LLRP specification and does not depend on this finding. Do not cite the line numbers | — |

**The most important security finding in the whole phase is architectural, not a bug:** the RFID repository's
permission model *exists on paper* (`Role.PermissionsJson`, a `RolesController` with full CRUD) and is **never
consulted by any code path**. Sixteen of eighteen controllers are unprotected, and the two that do touch
sensitive data (stock, returns) are unprotected by design. **A permission system that is defined and not
enforced is worse than none**, because it produces the belief that authorization exists.

---

## 5. The two RFID features the brief asks for **do not exist**

This is the headline finding of the repository, and the reason its verdict is
`REFERENCE ONLY` rather than a straightforward "unusable".

**D3 — RFID authentication: ABSENT.** The authentication path is:

```csharp
// Controllers/AuthController.cs
[HttpPost("login")]
public async Task<IActionResult> Login(LoginRequest request) { … }
// DTOs/LoginRequest.cs
public class LoginRequest { public string Username { get; set; } public string Password { get; set; } }
```

**Exactly one input pair. No EPC parameter anywhere in the auth path.** The `user` variable holds a "staff"
type with **no badge field**. There is no tap-to-authenticate, no badge table, no EPC→user mapping used for
authentication.

The frontend reinforces that a human is involved: `RealTimeScans.jsx` labels its scan
`readerName: 'Login bridge'` — and then has a human **typing an EPC into a text input** before clicking
"Scan".

**D4 — RFID attendance: ABSENT.**

```
$ grep -riE "attendance|employee|clockin|clockout|checkin|timepunch" backend/ frontend/src/
(no matches)
```

`StoreDbContext` has 15 `DbSet<>` properties and **none is attendance-related**. `TimeSheet` does not exist as
an entity in the context. **The brief's tap-in / tap-out attendance feature is not present anywhere in the only
repository in the set that has RFID at all.**

**This is why RFID auth and attendance must be designed from first principles** — sourced from the LLRP
specification and the product requirements, not from this codebase.

---

## 6. RFID implementation detail (the only hardware in the set)

**What is real, and worth understanding:**

- `Llrp/` is **8 classes, 835 lines**: `LlrpClient`, `LlrpMessage`, `LlrpCommand`, `LlrpParam`, `LlrpReaderService`,
  `LlrpException`, plus helpers.
- The reader is a **Zebra FX9600** speaking **LLRP over TCP on port 5085**, with antennas `1,2,3,4` and
  `transmitPowerIndex: 0`.
- Protocol shape: a **10-byte header** (version, message type, message ID, length, and the unusual
  `isHostToDevice`/`isError` bit packing) followed by **TLV parameters**, where **the parameter length includes
  the 4-byte type+length header** — the quirk that catches everyone.
- An **inventory cycle** is an `AddROSpec` (`AISpec` + `InventoryParameterSpec` + `ROReportSpec` +
  `TagReportContentSelector`) followed by streamed `TagReportData` messages, then a `DeleteROSpec`.
- `RfidTags` binds a `ProductId` to an `Epc`.

**The four protocol defects** (risk S-14 / S-15, all in §4) mean the implementation should be **reimplemented
from the specification**, not salvaged:

| Defect | Consequence |
|---|---|
| `resetToFactory: true` on every read | Destructive to a live reader's configuration |
| No response status code checked | Failures are silent |
| TV/TLV discriminator wrong for `FirmwareVersionReport` / `ReaderEventNotification` | Those messages are mis-parsed |
| Unknown parameter desynchronises the buffer by one byte (`LlrpMessage.cs:54-59`) | Desync on any unrecognised TLV |

**And the reader is architecturally wrong regardless of license:**

```csharp
// Services/LlrpReaderService.cs
var client = new LlrpClient("192.168.1.100", 5085, 1, 2, 3, 4);
```

A concrete class, a **hardcoded IP**, hardcoded port and antenna list, constructed inline. The `RfidTag` entity
has **no `IP` property**, so `RfidReaderController.Update` — which would let an operator set the reader address —
**is unreachable**. Every RFID subsystem must therefore be reimplemented behind an interface
(`RfidReader`) with a Zebra implementation, with the address from configuration, a **persistent connection and
a background event service** (not a request-scoped sleep-then-disconnect), and explicit reader-health reporting
so a hardware fault is never silently read as "no tags".

---

## 7. Feature coverage

| Area | Status | Evidence |
|---|---|---|
| **RFID hardware** | **COMPLETE (vendor-specific)** | `RfidReaderController`, `RfidTag`, `RealTimeScans`, Zebra FX9600 / LLRP / TCP 5085, 8 classes / 835 lines |
| **RFID tag binding** | **PARTIAL** | `RfidTags` (`ProductId`, `Epc`); a `Set` call with **no idempotency and no uniqueness enforcement** at the application layer |
| **RFID authentication** | **ABSENT** | `AuthController.Login(LoginRequest { Username, Password })`; **no EPC parameter**; `RealTimeScans.jsx` has a human typing the EPC into a text input |
| **RFID attendance** | **ABSENT** | `grep` for attendance/clockin/clockout/checkin/timepunch: **0 matches**; 15 `DbSet<>`, none attendance |
| **RFID event streaming** | **PARTIAL** | the frontend **polls the audit table every 5 seconds**; no push, no reader-side service, no queue. `ReadTagsAsync` sleeps then disconnects and swallows all exceptions |
| **RFID reader abstraction** | **ABSENT** | `LlrpReaderService` is concrete, hardcodes `192.168.1.100`; `RfidTag` has no `IP` property so `RfidReaderController.Update` is unreachable |
| POS checkout | **PARTIAL** | `SalesService`; but see the money-shadowing bug in §2 |
| Payments | **PARTIAL** | `Payment` with a `Method` enum (Cash, Card, …); no gateway integration |
| Receipts | **PARTIAL** | `window.print()` with 80mm `@media print` CSS — the **weakest** receipt of the three implementations that have one |
| Returns / refunds | **PARTIAL (exploitable)** | `SalesReturnController` is anonymous and unbounded → stock inflation (S-01) |
| Discounts | **ABSENT** | — |
| Inventory ledger | **PARTIAL** | `InventoryTransaction` written from 4 sites, but `InventoryController.Update`/`Restock` write the balance with no movement row and `InventoryTransactionsController.Create` writes a row with no balance change |
| Reconciliation | **ABSENT** | — |
| Product catalog | **PARTIAL** | `Product`, `Category`, `Brand`; no variants, no barcode generation |
| Barcode | **ABSENT** | — |
| **Suppliers** | **PARTIAL** | `Supplier.cs` + `SuppliersController.cs` (create/update/delete) — but **no read route**: `// ->supplierApi->route('api/suppliers', 'supplierApi::index');` is commented out in `api.php` |
| **Purchase orders** | **PARTIAL** | `PurchaseOrder.cs` + controller; `getAll` uses an **unfiltered** `ToListAsync()` |
| **Goods receipt note** | **PARTIAL (schema only)** | `GoodsReceiptItem` has the right columns (`QuantityReceived/Accepted/Rejected`) and `ReceiptStatus { Open, Partial, Closed, Rejected }` — but `GoodsReceiptsController.cs:52` hardcodes `Closed`, never writes Accepted/Rejected, never compares received vs ordered, and sets `po.Status = Received` unconditionally. **No over-receipt guard** |
| Partial receiving | **ABSENT in effect** | vestigial; every receipt sets `Received` |
| Supplier payables | **ABSENT** | — |
| Customers | **PARTIAL** | `Customer.cs` has CRUD properties; **no `CustomerController` exists** in the 18-controller set |
| Customer history | **PARTIAL** | `getCustomerReport` (sales per customer) |
| Loyalty | **PARTIAL (dead)** | `Customer.LoyaltyPoints` — **one occurrence repo-wide, never read or written** |
| Credit / AR | **ABSENT** | — |
| Locations / transfers | **ABSENT** | `InventoryTransactionType.Transfer = 3` is an **enum member with zero implementation** |
| Terminals / shifts | **ABSENT** | — |
| Audit log | **PARTIAL (RFID only)** | `AuditLog` written only by scans; `IpAddress`/`PerformedByUserId` never populated; `Login`/`Logout` declared unused |
| Reporting | **PARTIAL** | 6 endpoints (`getSalesReport`, `getMonthlySales`, `getTopProducts`, `getDashboardSummary`, `getPaymentReport`, `getCustomerReport`). All read `paymentRecords` only — **no margin, no cost** |
| Export | **PARTIAL (client-side)** | CSV via `Blob`; no server-side, no Excel |
| Attendance | **ABSENT** | — |
| ESP32 / IoT | **ABSENT** | — |
| Offline / sync | **ABSENT** | no service worker, no manifest, no PWA plugin |
| Migrations | **ABSENT** | `Migrations/` is empty; the schema exists only in the compiled assembly |
| Tests | **ABSENT** | — |
| CI/CD / Docker | **ABSENT** | — |

---

## 8. Deployment and project activity

- **No Dockerfile, no compose file, no CI workflow, no tests.** The application is run from the IDE or
  `dotnet run`.
- **Four projects in one repository:** the API, two console apps (`SmartStore.Console`, `SmartStore.Simulator`),
  and a **WinForms desktop app** (`SmartStore.App`, `net6.0-windows`). Hardware tooling mixed with the service
  (risk A-15).
- **Targeting .NET 10** — a preview/pre-release framework, so the toolchain is not production-pinned.
- **Activity:** untagged; the shallow log shows a small commit history (3 commits), most recent 2026-09-26.
  Untagged, unreleased, and unversioned in any conventional sense.
- **No version discipline:** no changelog, no releases.
- **Analysis limitation:** shallow clone, so the full history and contributor set were not available. The SQL
  Server schema could not be instantiated, so the schema findings are static-inspection-derived from the EF
  model and the EF-annotation-inconsistent `database/` script.

---

## 9. Reuse summary

**Every subsystem: `REFERENCE ONLY` (clean-room), except the parts that are `DO NOT USE` as *code* and must be
reimplemented from the specification.**

| Subsystem | Decision | Note |
|---|---|---|
| **LLRP / RFID hardware** | **REFERENCE ONLY (clean-room)** | The 835-line `Llrp/` implementation is unlicensed. **DO NOT COPY IT.** Reimplement from the **EPCglobal LLRP v1.0.1 specification**: 10-byte header + TLV (length includes the 4-byte type+length header), `AddROSpec` with `AISpec`/`InventoryParameterSpec`/`ROReportSpec`/`TagReportContentSelector`, streamed `TagReportData`, `DeleteROSpec`. That is protocol knowledge; the specification is the licensable source |
| **RFID authentication** | **REIMPLEMENT (greenfield)** | Does not exist. Badge-tap to open a shift / approve a void. Behind the reader abstraction |
| **RFID attendance** | **REIMPLEMENT (greenfield)** | Does not exist. Tap in / tap out. Behind the reader abstraction |
| **RFID event streaming** | **REIMPLEMENT (greenfield)** | Persistent connection + background service; **not** a request-scoped read, **not** a 5-second audit-table poll. Reader health must be explicit so a down reader ≠ an empty store |
| **RFID reader abstraction** | **REIMPLEMENT (greenfield)** | `RfidReader` **interface** + Zebra implementation. Address from **config, never a request parameter** (S-02). The hardcoded `192.168.1.100` must not be reproduced |
| Stock / returns | **DO NOT USE (as code)** | Anonymous, unbounded, exploitable (S-01). Rebuild with authorization on every mutation and a NodeDR-style return cap |
| Auth / password storage | **DO NOT USE (as code)** | Unsalted SHA-256 (S-11). Rebuild with Argon2id/bcrypt ≥12 |
| Authorization | **DO NOT USE (as code)** | `PermissionsJson` defined and never enforced. Rebuild deny-by-default at one enforcement point |
| Audit | **DO NOT USE (as code)** | RFID-only, unattributed (S-12). Rebuild the append-only in-transaction trail |
| **Goods receipt** | **REFERENCE ONLY (schema design only)** | **Take the column set and the enum** — `QuantityReceived/Accepted/Rejected` and `ReceiptStatus { Open, Partial, Closed, Rejected }` are the right GRN model. **Build the logic:** the over-receipt guard, the received-vs-ordered comparison, the partial-receipt accumulation, and the Accepted/Rejected writes are all missing and must be written from scratch |
| Purchase orders | **REFERENCE ONLY** | `PurchaseOrder`/`PurchaseOrderItem` shape is fine; `getAll` is unfiltered and must be fixed |
| Suppliers | **REFERENCE ONLY** | Shape is fine; the read route is missing |
| Payments / receipts | **REFERENCE ONLY** | `Method` enum is fine; no gateway; `window.print()` receipt is the weakest here |
| Reporting | **REFERENCE ONLY** | Endpoint list is a useful checklist; all read `paymentRecords` only — no margin |
| Catalog | **REFERENCE ONLY** | `Product`/`Category`/`Brand` only; no variants, no barcode |
| Inventory ledger | **DO NOT USE (as code)** | A ledger exists but is inconsistently maintained — balance and movement can drift apart in both directions. Rebuild so every balance write is paired with a movement write in one transaction |
| Attendance (non-RFID) | **ABSENT here** | See the RetailPOS audit — the only attendance implementation anywhere, and it is broken |
| Offline / sync / terminals / shifts / credit / loyalty | **ABSENT here** | — |

**Final: `REFERENCE ONLY` (clean-room; no license, "all rights reserved").** The only repository in the set with
real hardware, and the brief's two most distinctive RFID requirements — **badge-tap authentication and tap-in
/tap-out attendance — are absent from it entirely.** Its LLRP implementation should be read to understand that
the problem is tractable and to learn its shape, then **reimplemented from the EPCglobal LLRP v1.0.1
specification** so that SmartStore carries no unlicensed code and no patent-adjacent risk from it. Its Goods
Receipt **data model** is worth taking as a design reference — the only correct GRN column set in the phase —
while its GRN *logic* (no over-receipt guard, hardcoded `Closed`, unconditional `po.Status = Received`) is
an example of why "the model is right" is not the same as "the code is right."
