# Test Strategy

**The verification gates the product already requires, consolidated. Framework selection is Phase 3; the gates
are not.**

Status: **DRAFT — PRE-PHASE-3.** Every gate below exists in the product documentation. This document states the
gates so the implementation cannot omit them; it does not choose a test framework.

## 1. Release gates already required

| Gate | Rule | What it verifies |
|---|---|---|
| Ledger rebuild reproduces every balance and `ResultingBalance` | IV-09 | The ledger is authoritative; a rebuild is a release gate and runs as an automated job, not on demand |
| Payment state-graph assertion | PY-12 | No edge out of `Captured` except a linked `Refund`; asserted on the graph itself |
| Sale status rebuild from line counters | SP-66 | `ReturnedQuantity`/`RefundedAmount` counters reproduce the status exactly |
| Concurrency suite | inventory §7 | N parallel sales over a fixed item set; ledger reconciles, no deadlock escapes, every failure is a clean retry |
| Idempotency of offline apply | OF-22/23 | Identify-and-apply in one transaction; a retry cannot apply twice |
| Atomic bounded redemptions | PY-31, BI-19, BI-06 | Two tills redeeming the same balance cannot both succeed |
| Negative-batch never negative | BI-36, IV-19 | A real batch balance never goes negative under any path |

## 2. Testability of the requirement set

- `GR-02`: acceptance criteria are testable but not yet tested.
- `GR-03`: "measurable" names a mechanism Phase 2/3 must honour.

## 3. What a test strategy must include (required, not invented)

1. **Rebuild tests are release gates** (IV-09): the build fails rather than posts a balance it cannot rebuild.
2. **State-machine assertions** (PY-12, SM-02a-02d shape): transitions behave as the eight-attribute contract
   says; celery cells are never guessed into tests.
3. **Concurrency** as a named suite (inventory §7), run before go-live.
4. **Offline sync** tests: apply-order correctness (OF-22), per-item outcomes (OF-26), and the
   `Applied`/`AppliedWithAdjustment`/`Rejected` three-state contract (OF-29) — never a fourth.
5. **Security tests implied**: no card number in storage (PY-43), no PII in logs (CU-35), a build check for
   vendor SDKs outside the adapter layer (HD-02, PY-08), no `Sales.*` permission tokens, no near-neighbour
   permission renaming (SM-02d).

## 4. Deliberately not here

- No framework, no runner, no coverage tool. Phase 3 decides, against these gates.
- no per-domain harnesses claimed that the rules do not name.