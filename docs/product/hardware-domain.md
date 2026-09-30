# SmartStore — Hardware Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Device`, `DeviceType`, `DeviceConnection`, `DeviceEvent`, capability contracts, connection and failure
behaviour, firmware. RFID readers are devices (rfid-domain §4); terminals and drawers are devices
(organization-model §6, §7).

---

## 1. The abstraction, and the one rule that makes it real

> **Business logic issues a domain command against a registered `Device`. It never names a manufacturer, a
> protocol, or a vendor SDK.**

**Rule HD-01.** The domain commands are:

| Command | What it wants |
|---|---|
| `ReadBarcode` | A decoded barcode string and its symbology |
| `ReadTags` | A list of tag identifiers with signal data |
| `ReadWeight` | A settled weight with its unit and stability indicator |
| `PrintReceipt` | A rendered document, rendered to a printable form, not device-specific |
| `OpenDrawer` | The drawer opened |
| `ReadTemperature` | A temperature reading (pharmacy-adjacent cold chain) |
| `ReadStatus` | The device's own health report |
| `Restart` | A controlled restart |

**Rule HD-02 — enforcement is a static check, not a code review** (BI-34). A build step asserts that no file in
the business-logic layer imports or references a device SDK, a protocol constant, or a manufacturer name.

**Why this is the rule and not an aspiration.** Phase 0 **A-15/A-16**: a surveyed RFID system bound its business
logic to one manufacturer's client library. Replacing the reader meant rewriting application code, and the
resulting schedule pressure is why nobody replaces hardware. The failure is not a bug; it is a consequence that
arrives eighteen months later. **The verification is that registering a different `DeviceType` implementation for
`ReceiptPrinter` requires no change to any sales code at all.**

---

## 2. Devices and types

**Rule HD-03.** A `Device` is one physical unit: a serial or asset number, a `DeviceType`, a store or warehouse,
a label, a status, a last-heartbeat, and a health state.

**Rule HD-04 — a `DeviceType` is a capability contract**, not a model number. The type declares which commands it
supports and what its response shape is. `ReceiptPrinter`, `BarcodeScanner`, `RfidReader`, `Scale`,
`CashDrawer`, `PosTerminal`, and `TemperatureProbe` are types. "Zebra DS2208" is a model, recorded on the device.

**Rule HD-05 — a device's type is immutable once it has produced events** (the same rule as PR-14, RF-07, and
EM-08). A reader that becomes a scale is a history rewrite. A new device is registered instead.

**Rule HD-06 — one device, one role per command.** A device that is both a scanner and a printer is two `Device`
records sharing a physical asset number, because its failure states are independent and one device row with two
lifecycles cannot represent "the scanner is dead and the printer is fine".

**Device status:**

| Status | Meaning |
|---|---|
| `Registered` | Known, not yet working |
| `Active` | In service |
| `Degraded` | Working, with errors. **Still usable** — a printer that jams twice a shift is not offline |
| `Offline` | No heartbeat within the configured interval (PT-04) |
| `Disabled` | Turned off by an administrator. `Device.Disable` |
| `Retired` | Permanently out of service. Never deleted |

**Rule HD-07 — `Degraded` is a real and necessary state.** A two-state model forces operators to disable a device
that still mostly works, and disabling a printer means no receipts at all. Degraded means "still in service, and
here is what is wrong with it", which is the truth most of the time.

**Rule HD-08 — a device is never deleted** (BI-40). It is retired, and its full event history remains. A device
that produced the weight on a disputed sale is evidence.

---

## 3. Capabilities

A device advertises capabilities. A command against a device lacking the capability is a **configuration error at
registration**, not a runtime failure.

**Rule HD-09.** Capabilities are declared at registration and validated: registering a device with
`ReadBarcode` against a `DeviceType` that does not implement it is refused.

**Rule HD-10 — the POS works without every device.** Capability detection is a store configuration concern, not
a hard dependency:

| Device absent | The POS does |
|---|---|
| Barcode scanner | Manual search and code entry. Faster keying, fully functional |
| Scale | Weighted lines need a manual weight, with a reason (PR-28, SP-18) |
| Receipt printer | Receipt goes to the reprint queue and staff tell the customer (SP-58) |
| RFID reader | Nothing RFID-dependent happens. Attendance is manual |
| Cash drawer | Cash is counted and recorded without a drawer-open event |
| Card terminal | Card payments are unavailable and the till says so clearly before the cart is rung |

**Rule HD-11 — a missing device degrades one feature, never the till.** **[P0: S-08 — a surveyed system could
not take a payment because a peripheral was unavailable. Retail does not stop because a printer is broken, and a
POS that stops is a POS that loses sales and trains staff to bypass it.]**

**Rule HD-12 — a "unavailable" card terminal must be known before the sale is rung**, not discovered at payment.
The capability state is on the payment screen. Discovering it after the customer has queued and the cart is full is
a service failure the system could have prevented.

---

## 4. Connections

`DeviceConnection` holds how a device is reached: a connection type, the endpoint, the transport, authentication
reference, and health. Connection types: `Usb`, `Serial`, `Network`, `Bluetooth`, `Virtual` (a driver on the
host), and `Cloud` (a remote provider).

**Rule HD-13 — the connection is configuration, not architecture.** Swapping a USB scanner for a network scanner
is a change to a `DeviceConnection` row. It is not a code change, and no business logic is aware that a change
occurred (HD-02).

**Rule HD-14 — a device credential is established at registration and is per device** (BI-35). Events are accepted
only from an authenticated device.

**Rule HD-15 — credentials are never in configuration that a user can read**, and a device credential is
distinct from an employee credential. A device that can report "I am the front scale" must not be able to report
"I am employee 42".

**Rule HD-16.** Device connectivity is monitored by **heartbeat**, and the absence of a heartbeat means `Offline`
(PT-04). `Offline` is not `Disabled`: a store whose power is off overnight is not a device fault, and a system that
disabled overnight devices would produce a fault notification storm every morning.

---

## 5. Failure behaviour — the part that decides whether hardware is trustworthy

> **A hardware failure may never corrupt a business transaction.** (BI-32)

**Rule HD-17 — a device call is never inside a business transaction** (BI-04, SP-04). The call happens first; its
result or its failure is passed in as data. A transaction held open across a gateway call is a transaction waiting
to time out while holding stock locks (IV-23, IV-24).

**Rule HD-18 — every device failure has a named, tested outcome.** The full matrix:

| Failure point | The system state that results |
|---|---|
| Barcode scan fails | No scan. The cashier is told. Nothing changed |
| Weight read fails | The line is not rung (SP-19) |
| Weight read is unstable | The reading is refused; a settled reading is required (SP-17) |
| Receipt print fails **before** commit | The sale does not complete. Nothing is charged, nothing is printed |
| Receipt print fails **after** commit | **A completed sale with a failed receipt and a reprint queue entry** (SP-58, BI-32) |
| Drawer open fails | Logged. The cash transaction and the sale proceed. Drawer state is reconciled at close |
| RFID read fails | No read. The event is recorded as a device error |
| Card terminal fails mid-transaction | The payment is `Failed`. The sale does not complete; the cart survives (SP-43) |
| Card terminal times out after capture | The payment is `Pending`, then reconciled with the provider. **Never** assumed captured |
| Temperature probe fails | Cold-chain monitoring raises a gap, notified. Not a sale block |

**Rule HD-19 — the print-failure split is the load-bearing one, and the order is deliberate.** Print **before**
commit and a failure means no sale; print **after** commit and a failure means a sale with a missing receipt. A
system that prints first can lose a sale on a paper jam; a system that commits first can lose a receipt. Losing a
receipt is recoverable — reprint it. Losing a completed sale that the customer paid for is not.

**Rule HD-20 — a timeout is never resolved by assumption.** A payment timeout is `Pending` and is reconciled
against the provider. Assuming success loses money; assuming failure double-charges. The system knows which it
does not know, and records that.

**Rule HD-21 — a device error is an event, not an exception.** A device that throws does not propagate into
business logic. It returns a typed failure the business logic handles, because a business transaction must be
completable without any device (HD-11).

**Rule HD-22 — device errors are recorded, rate-limited, and notified by threshold.** A reader failing eight reads
per second is one problem, not eight thousand notifications. A flapping device produces a rate-limited
`DeviceError` series and one notification on transition into `Degraded`.

---

## 6. Device events

`DeviceEvent` holds: device, type (`Heartbeat`, `Error`, `StatusChange`, `FirmwareUpdate`, `ConfigurationChange`,
`PaperLow`, `Disconnect`), the device's own timestamp, the server's receipt timestamp, severity, a code, and
optional diagnostic detail.

**Rule HD-23.** `DeviceEvent` is append-only and is **not** an audit entry. A device error is a fact about a
device; an audit entry is a fact about a person or a system action (BI-23). `ConfigurationChange` and
`FirmwareUpdate` **are** audited as well, because they change a device's behaviour, and a device that starts
misreporting a weight is a security-relevant event.

**Rule HD-24 — diagnostic detail may contain device data, never business or personal data** (CU-35). A
printer's error string is fine. A print job's customer name is not.

**Rule HD-25.** Device events are queryable without `Audit.View` — a technician needs telemetry without
transaction data (actors-and-roles §3.17). Device telemetry is sufficient to diagnose a device, and if it is
not, the fix is a diagnostic counter, not a data permission.

---

## 7. Firmware

**Rule HD-26 — firmware version is recorded per device**, and a version change writes a `DeviceEvent` and an audit
entry.

**Rule HD-27 — firmware updates are a store or device administrator action** (`Device.Edit` or a distinct
`Device.Firmware.Update`; the latter is the cleaner key and is the recommendation), audited, and **never
automatic** in v1. An automatic firmware push is a way to brick a till fleet on a Friday.

**Rule HD-28 — v1 does not manage firmware distribution.** Recording the version, reporting outdated devices, and
supporting a manual update are in scope. An orchestrated update fleet is a device-management product.

**Rule HD-29.** Where a firmware update changes a command's response shape, the `DeviceType` implementation
absorbs it, so no business logic changes (HD-02). **That is the test of whether the abstraction is real.**

---

## 8. Device administration

**Rule HD-30 — registration is permissioned** (`Device.Register`) and records who registered it, when, and where
it is physically installed. A device with no recorded location is a device nobody can find when it fails.

**Rule HD-31 — `Device.Disable` is a high-impact operation** and is a **SHOULD** with approval for a device
attached to an active till. Disabling a live till's printer or scale stops trading. The exception is a
compromised or stolen device, which is exactly why the approval is not absolute.

**Rule HD-32 — disabling is not deleting** (HD-08). A disabled device can be re-enabled, and its history is
intact.

**Rule HD-33 — a device replacement is a new device with a cross-reference**, and the old one is `Retired`. The
cross-reference is what lets a technician answer "did this failure start when we swapped the reader".

**Rule HD-34 — the Technician role is disabled in v1** (actors-and-roles §3.17). Device management is a Store
Manager or Super Admin function. The permission set exists and is ready, so enabling the role later needs no model
change.

---

## 9. Hardware rules index

| ID | Rule |
|---|---|
| HD-01 | The domain commands are `ReadBarcode`, `ReadTags`, `ReadWeight`, `PrintReceipt`, `OpenDrawer`, `ReadTemperature`, `ReadStatus`, `Restart` |
| HD-02 | A build check asserts zero device-SDK references in business logic |
| HD-03 | A `Device` is one physical unit with a type, a location, and health |
| HD-04 | A `DeviceType` is a capability contract, not a model number |
| HD-05 | A device's type is immutable once it has produced events |
| HD-06 | One device, one role per command; a combined device is two records |
| HD-07 | `Degraded` is a real state and the device stays in service |
| HD-08 | A device is retired, never deleted |
| HD-09 | Capabilities are validated at registration, not at first failure |
| HD-10 | The POS works without every device, degrading one feature each |
| HD-11 | A missing device degrades a feature, never the till |
| HD-12 | An unavailable payment device is known before the cart is rung |
| HD-13 | A connection is configuration, not architecture |
| HD-14 | A per-device credential is established at registration |
| HD-15 | A device credential never impersonates an employee |
| HD-16 | Connectivity is a heartbeat; `Offline` is not `Disabled` |
| HD-17 | A device call is never inside a business transaction |
| HD-18 | Every device failure point has a named, tested outcome |
| HD-19 | Print-before-commit risks losing a sale; commit-before-print risks only a receipt |
| HD-20 | A timeout is reconciled, never assumed |
| HD-21 | A device error is a typed event, not an exception in business logic |
| HD-22 | Device errors are rate-limited and notified on transition |
| HD-23 | `DeviceEvent` is not an audit entry; configuration and firmware changes are audited too |
| HD-24 | Diagnostic detail carries no business or personal data |
| HD-25 | Telemetry is sufficient to diagnose a device; no transaction data is needed |
| HD-26 | Firmware version is per device; a change is an event and an audit entry |
| HD-27 | Firmware updates are manual and audited; never automatic in v1 |
| HD-28 | No firmware distribution management in v1 |
| HD-29 | A changed response shape is absorbed by the `DeviceType` implementation |
| HD-30 | Registration records who, when, and where |
| HD-31 | `Device.Disable` is high-impact and approval-gated for an active till |
| HD-32 | Disabling is not deleting |
| HD-33 | A replacement is a new device with a cross-reference; the old one retires |
| HD-34 | The Technician role is disabled in v1; the permission set is ready |
