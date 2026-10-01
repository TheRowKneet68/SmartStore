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

## Step B — the DOM harness, proved on the smallest component

**Why this component.** `Sale.tsx` is 164 lines and needs the API mocked. `Announcer.tsx` is 8 lines, so it proves the
rendering harness end to end at the lowest possible cost, and it happens to guard the contract that breaks most
silently: drop `aria-live`, or swap the class for `display: none`, and every screen in the till goes quiet for exactly
the users `RT-339` (MUST, "every till action is keyboard-reachable and announced audibly") is about.

Packages added, all exact pins, all past the 7-day release-age window in `.npmrc`:

| Package | Version | Age at install |
| --- | --- | --- |
| `happy-dom` | 20.14.5 | 19 days |
| `@testing-library/react` | 16.3.3 | 34 days |
| `@testing-library/dom` | 10.4.2 | 17 days |

`jsdom` was not used: its current release (30.1.1) was 9 days old, inside double the safety margin, and happy-dom is
faster. `@testing-library/jest-dom` was skipped entirely; without it the assertions use plain `getAttribute` and
`textContent`, which is all these guards need.

Config: `environment: 'happy-dom'` and `globals: true` in `web/vitest.config.ts`. `globals: true` is what makes
Testing Library's automatic cleanup register, through a global `afterEach`. Without it the second render finds the
first test's elements still in the document.

**Failed attempt worth keeping — environment cost.** The suite ran in **27.24s**, of which vitest reported
`happy-dom was created 2 times · 18.74s total, 69% of tracked time`: the DOM environment was being built once per
file. Setting `pool: 'vmThreads'`, which vitest's own hint recommends and which builds the environment once per
worker while keeping per-file isolation, took the same 20 tests to **832ms**. The alternative vitest suggests,
`isolate: false`, was rejected because it shares one environment across the whole run, and a leaf-level unit suite
should not be able to leak state from one file into the next.

**Verified.** `npm test --workspace web` → 2 files, 20 tests passed in 793ms. Root `npm run typecheck` → clean.

**Not verified here, on purpose.** The root `npm test` run at this point failed in `server/`, not `web/`:
`src/modules/sales/shift-close.test.ts` had three failing tests. That file belongs to the agent building
`CD-20`..`CD-25`, which is working in parallel and is test-first, so three red tests is that work mid-flight rather
than a regression. It was not touched. The web slice was run on its own to confirm this step.

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

---

## 2026-10-01 — Step 3, Domain 4, Part B: the API client and the sale screen

Work moved into the separate worktree `D:\smartstore-routine` on branch `routine/web-tests`, branched at `faa3115`.
Rationale: Claude owns `server/**` and was mid-flight on shift-close step 6, and a shared index made even disjoint files
risky to commit. This branch touches only `web/**` and this log.

**`web/src/lib/api.test.ts` (`3c40d6e`), 11 tests.** Errors carry the server's extra fields through to `ApiError.details`,
because that is what lets a screen name the shift it should mention instead of showing a bare message.

**`web/src/pos/Sale.test.tsx` (`b042e3c`), 17 tests.** Driven through a stubbed `globalThis.fetch`, not a stubbed `api`
module. Mocking `api` would only prove the screen calls a function the test replaced; stubbing the network exercises
screen, client and response shape together, which is where the real failures live.

**Verified.** `npm test --workspace web` 48/48 passed across three consecutive runs, no flakes. `npm run typecheck`
clean for server and web. `npm test` at this worktree's root was deliberately **not** used: the worktree has no `.env`
and no database, so the server half cannot run here. Full root tests belong to `D:\SmartStore`, after the shift-close
sources are restored.

### Failures hit, and what each one actually was

1. **Committed while typecheck was failing.** Ten strict-null errors from `noUncheckedIndexedAccess`, all of them
   indexing `savedBodies()[n]` or `cartLines()[n]`. Green tests were not sufficient; I should have run typecheck before
   committing. Fixed by routing every index through `sent(n)` and `cartLine(n)`, which raise on a missing element
   instead of answering about `undefined`, then amended. History does not hold the broken state.
2. **`toHaveTextContent` does not exist here.** It is a `@testing-library/jest-dom` matcher and that package is
   deliberately not installed. I used it anyway. Replaced with plain `.textContent` assertions. Do not add the
   dependency; `toContain` on `textContent` is enough.
3. **Two assertions were wrong about the code, not the screen.**
   - I expected `9999` units at `$2.50` to read `$24,975.00`. It reads **`$24,997.50`**. The clamp is correct; my
     arithmetic was not.
   - I asserted that an empty scan field never reaches the network. It never does, but the hand-off to the cash field
     only happens once a cart exists to pay for; with an empty cart focus correctly stays put. The test now scans
     first, then asserts the call count is unchanged.

   Both were corrected in the test. Neither needed a code change.
4. **`getByText(/Sale \d+ completed/)` was ambiguous**, because the outcome heading and the `role="status"` live region
   both report that the sale completed. That repetition is the point of `RT-339`/`UX-51`, so the query became
   role-scoped to the heading instead of the screen being changed to suit a test.

### Findings handed back, not fixed here

- **Two cart lines of the same product are indistinguishable to a screen reader.** Both quantity inputs carry
  `aria-label="Quantity of Oat milk 1 L"`, so `getByLabelText` throws "found multiple elements". Nothing in the
  reviewed rules requires a position in the label, so this was not changed unilaterally. Recommend the label carry the
  line's position. The tests work around it with `within(cartLine(n))`.
- **`web/src/lib/money.ts` citation.** Still open and unchanged; see the section above.

### How a stray file reached the other worktree

A PowerShell fix-up script called `[System.IO.File]::ReadAllText($p)` with a relative path. The .NET API resolves
relative paths against the **process** working directory, not the PowerShell location, so the read failed, `$t` became
`$null`, and the following `WriteAllText` created a **0-byte** `web/src/pos/Sale.test.tsx` inside `D:\SmartStore` —
the other worktree, owned by Claude. It was untracked and empty, so it was deleted and nothing was lost. Had Claude
run `git add -A`, that stray file would have landed in the shift-close commit. Use absolute paths for .NET file calls,
and prefer the file tools over shell text substitution.
