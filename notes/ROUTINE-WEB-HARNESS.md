# Routine work log — web test harness

Owner of this file: the routine-work agent. `BUILD-STATUS.md` is shared with the agent working on `CD-20`..`CD-25` in
`server/`, so both of us log here and the `BUILD-STATUS.md` entry is written once at merge time.

Branch: `v1-build`. Started from `22417f1`.

---

## Step A — a test runner for `web/`, and tests for `money.ts`

**Why.** `web/package.json` had no `test` script and no test runner, so every user-interface change from here on was
unverifiable. Root `npm test` was literally `npm test --workspace server`.

**No new package was needed.** `server/package.json` already pins `vitest: 5.0.1`, and npm workspaces hoist it to the
root `node_modules`, so `web` resolves it without downloading anything. `@playwright/test` 1.63.0 is also installed
but has no config file and no specs: it is a future end-to-end option, not a harness, and it is unused.

Changed:

- `web/vitest.config.ts` — new. Mirrors `server/vitest.config.ts`: `defineConfig` from `vitest/config`, the React
  plugin copied from the existing `web/vite.config.ts`, explicit `include` and timeouts. `web/vite.config.ts` is
  untouched, so the dev proxy config is unaffected.
- `web/src/lib/money.test.ts` — new. 17 tests over the two functions the till actually calls.
- `web/package.json` — added `test: vitest run` (after `build`, before `typecheck`, matching `server`'s order) and
  `vitest: 5.0.1` as a devDependency.
- `package.json` — root `test` is now `npm test --workspace server && npm test --workspace web`, matching how
  `typecheck` already chains.

`package-lock.json` did not change: the version was already resolved in the tree.

**Verified.** `npx vitest run --reporter=dot --maxWorkers=1` in `web` → 17 passed. Root `npm run typecheck` → clean.
Root `npm test` → 22 files / 378 tests (server) then 1 file / 17 tests (web).

**Failed attempt worth keeping.** The three-decimal-currency assertion failed on the first run with
`expected 'BHD 1.234' to be 'BHD 1.234'`. The two strings are not equal: ICU separates a three-letter currency code
from the number with a **non-breaking space, U+00A0**, which renders identically to a space in a console. The fix
normalises `\u00a0` to a space before comparing, so the test asserts the exponent rather than ICU's choice of
separator. Recorded because it will bite any future snapshot of formatted currency.

**Citations.** No `RT-xxx` row covers displaying or keying an amount, so `money.test.ts` cites
`product-overview.md` §3.1 (exact decimal, no binary float, minor-unit exponent recorded rather than assumed to be 2),
`BI-01` (rounding) and `D-17` (why floats were banned). See the open item below.

---

## Open items found, not acted on

- **`web/src/lib/money.ts` line 1 cites `BI-01` for the `Currency` interface.** `BI-01` is business-invariants: it is
  traced to `RT-048` (inclusive-mode tax rounding) and `RT-261` (no full card number stored). It does not cover a
  currency's minor-unit exponent. The governing text for the exponent is `product-overview.md` §3.1, which carries no
  rule ID. The docstring was **not** changed: correcting a citation in an artifact another session may be reading is
  the owner's call, and there is a reasonable chance `BI-01` was meant as "the business invariants in §3.1".
  Recommendation: decide whether §3.1 needs its own rule ID, record it in `OPEN-QUESTIONS.md`, then fix the docstring
  to match.
- **No `RT-xxx` row covers displaying or keying an amount.** `money.test.ts` cites the governing prose instead. A
  requirement row for money display and entry would close this properly.
