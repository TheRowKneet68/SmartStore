# Hardware Requirements

**The hardware surface the product already commits to, and the owner purchase decisions.** Companion to
`configuration-model.md` (device config is data) and the security rules (device identity is load-bearing).

Status: **DRAFT — PRE-PHASE-3.** No SKU/model/budget is asserted. The device set and its rules are stated; what
to buy and for how much is the owner's decision (budget is not documented anywhere).

## 1. What the product already requires (rules, not models)

- **POS terminals**: per store; a terminal has explicit offline capability (`PosTerminal.OfflineEnabled`,
  OF-04) and a mode (`Standard`/`Training`/`Maintenance`, PT-01..03). A training terminal may never complete a
  real sale, move stock, or tender (PT-03).
- **The till fleet is the operational reality** (architecture §27.2): terminals run the POS, hold encrypted
  local ledgers (OF-41), the caches (OF-07), and the offline queue (OF-17).
- **No vendor SDK in business logic** (HD-02, PY-08, RT-211): hardware is behind an adapter layer; a build check
  fails on a vendor SDK outside it.
- **Device identity is a security control**: the local store is bound to the registered device credential
  (HD-14/15); a lost or stolen terminal is revoked (`Device.Disable` + credential revocation, OF-42).
- **Peripherals**: a scale (weight source `Scale`, SP-16/17), a printer (SP-03/58), a barcode scanner (SD-08..),
  and RFID readers where deployed (`RfidReader`, rfid-domain).
- **Device health is telemetry, not a business fact** (SM-60b/61): `Offline`, `Degraded` are health states; they
  do not change the business transaction. A `Degraded` scanner means the cashier uses the keyboard (with
  graceful degradation, HD-19).

## 2. Interface constraints

- Receipt printing is per store with a mandatory core (SP-59); a print failure queues a reprint, never rolls
  back a sale (SP-58).
- Payment hardware (card) is the same adapter discipline (PY-08); offline card payments go to the acquirer, not
  to SmartStore (PY-47).

## 3. What a hardware requirements doc must capture (recommended content, owner input required)

| Item | Basis |
|---|---|
| Terminal count per store, provisioning | §27.2, OF-04 |
| Peripherals per terminal | device rules above |
| Local storage / RAM minimum for caches + queue | OF-07 (six caches), OF-17 (durable queue) |
| Backup medium and restore path for terminal ledgers | OF-45 |
| Security review of vendor devices (identity binding) | HD-14/15, OF-41 |

## 4. Owner decisions

- Make/model and budget (not documented; owner input).
- Terminal offline window per store (a business choice, OF-28).
- Whether RFID is deployed at all in v1 (RF rules exist; deployment is a product decision).