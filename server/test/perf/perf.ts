/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../../src/app.ts';
import { createPool } from '../../src/db/pool.ts';
import { SimulatedGateway } from '../../src/modules/payments/simulated-gateway.ts';
import { onboard } from '../../src/onboarding.ts';
import { createTestDb } from '../db.ts';
import { employeeWithAccess, onboardingAnswers } from '../fixtures.ts';
import setupTemplate from '../global-setup.ts';

/**
 * `npm run perf` (ADR-31 §8): kept out of the default suite because timing depends on the machine. It builds the
 * template database from the migrations, clones it, seeds a TEST-ONLY catalogue, runs the real server on localhost, and
 * times over real HTTP with keep-alive:
 * 1. scan-to-cart: the till's scan, against the owner's budget of p95 ≤ 100 ms;
 * 2. sale-save: a 10-line cart paid in cash, for which no budget is stated, so the numbers are reported only;
 * 3. scan-to-cart in a real browser (Playwright, headless Chromium), from Enter to the line drawn. PERF_CHROMIUM may
 *    name a Chromium to use instead of Playwright's own; PERF_BROWSER=0 skips this part.
 */
const VARIANTS = Number(process.env.PERF_VARIANTS ?? 100_000);
const SCANS = Number(process.env.PERF_SCANS ?? 1_000);
const SALES = Number(process.env.PERF_SALES ?? 200);
const CARD_SALES = Number(process.env.PERF_CARD_SALES ?? 100);
const BROWSER_SCANS = Number(process.env.PERF_BROWSER_SCANS ?? 200);
const LINES = 10;
const PASSWORD = 'TEST-ONLY perf password';

const ms = (n: number) => `${n.toFixed(1)} ms`;
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1)! };
}

/** EAN-13s in the GS1 in-store range 20, with their check digits (PR-12): a realistic, valid barcode per variant. */
function ean13(n: number): string {
  const body = `20${String(n).padStart(10, '0')}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

const t0 = performance.now();
await setupTemplate();
const db = await createTestDb();
try {
  const owner = await onboard(db.app, onboardingAnswers());
  const org = owner.organizationId;
  const store = owner.storeId;
  const by = owner.ownerEmployeeId;
  process.stdout.write(`Template and onboarding: ${ms(performance.now() - t0)}\n`);

  // The catalogue, in bulk, through the runtime role with the audit context set (every activation is audited).
  const seed = performance.now();
  const c = await db.app.connect();
  try {
    await c.query(`SELECT set_config('smartstore.actor_id', $1, false)`, [by]);
    const unit = (await c.query<{ id: string }>(`INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, 'EA', 'Each', 'Countable', 0) RETURNING id`, [org])).rows[0]!.id;
    const tax = (await c.query<{ id: string }>(`INSERT INTO tax_category (organization_id, code, name) VALUES ($1, 'STD', 'TEST-ONLY standard') RETURNING id`, [org])).rows[0]!.id;
    await c.query(`INSERT INTO tax_rate (organization_id, tax_category_id, jurisdiction, rate_percent, created_by) VALUES ($1, $2, 'TEST-ONLY', 10, $3)`, [org, tax, by]);
    const category = (await c.query<{ id: string }>(`INSERT INTO category (organization_id, name, sort_order) VALUES ($1, 'Perf', 1) RETURNING id`, [org])).rows[0]!.id;
    const CHUNK = 10_000;
    for (let start = 1; start <= VARIANTS; start += CHUNK) {
      const end = Math.min(VARIANTS, start + CHUNK - 1);
      const codes = Array.from({ length: end - start + 1 }, (_, i) => ean13(start + i));
      await c.query('BEGIN');
      await c.query(
        `WITH p AS (
           INSERT INTO product (organization_id, category_id, name, status_changed_by)
           SELECT $1, $2, 'TEST-ONLY item ' || n, $3 FROM generate_series($4::int, $5::int) n RETURNING id, name),
         v AS (
           INSERT INTO product_variant (organization_id, product_id, base_unit_id, tax_category_id)
           SELECT $1, p.id, $6, $7 FROM p RETURNING id, product_id),
         numbered AS (
           SELECT v.id, v.product_id, substring(p.name from 'item (\\d+)')::int AS n FROM v JOIN p ON p.id = v.product_id),
         priced AS (
           INSERT INTO variant_price (organization_id, variant_id, currency_code, amount, created_by)
           SELECT $1, id, 'XTS', 100 + (n % 5000), $3 FROM numbered RETURNING variant_id)
         INSERT INTO product_barcode (organization_id, variant_id, value, kind, is_primary)
         SELECT $1, numbered.id, ($8::text[])[numbered.n - $4 + 1], 'EAN13', true FROM numbered`,
        [org, category, by, start, end, unit, tax, codes],
      );
      await c.query(`UPDATE product SET status = 'Active', status_changed_by = $2 WHERE organization_id = $1 AND status = 'Draft'`, [org, by]);
      await c.query('COMMIT');
    }
    await c.query('ANALYZE');
  } finally {
    await c.query(`SELECT set_config('smartstore.actor_id', '', false)`);
    c.release();
  }
  process.stdout.write(`Seeded ${VARIANTS} variants with barcodes and prices: ${ms(performance.now() - seed)}\n`);

  // The till, the way the slice sets it up: cash enabled, a till registered and active, a cashier with a login.
  const pool = (() => {
    const url = new URL(db.appUrl);
    url.searchParams.delete('options');
    return createPool(url.toString(), 10);
  })();
  const app = await buildApp({
    pool,
    gateway: new SimulatedGateway(),
    session: { lifetimeMinutes: 60, failureLimit: 5, failureWindowMinutes: 15 },
    quoteMaxAgeMinutes: 60,
    lockTimeoutMs: 2_000,
    ownsPool: true,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/v1`;
  try {
    const setup = await db.app.connect();
    let cashier: string;
    let till: string;
    try {
      await setup.query(`SELECT set_config('smartstore.actor_id', $1, false)`, [by]);
      const method = (await setup.query<{ id: string }>(`INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, 'CASH', 'Cash', 'Cash') RETURNING id`, [org])).rows[0]!.id;
      await setup.query('INSERT INTO store_payment_method (store_id, payment_method_id, is_enabled, changed_by) VALUES ($1, $2, true, $3)', [store, method, by]);
      const cardMethod = (await setup.query<{ id: string }>(`INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, 'CARD', 'Card', 'Card') RETURNING id`, [org])).rows[0]!.id;
      await setup.query('INSERT INTO store_payment_method (store_id, payment_method_id, is_enabled, changed_by) VALUES ($1, $2, true, $3)', [store, cardMethod, by]);
      till = (await setup.query<{ id: string }>(
        `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
         VALUES ($1, $2, 'T1', 'Till 1', $3, $4) RETURNING id`,
        [store, org, owner.defaultLocationId, by],
      )).rows[0]!.id;
      await setup.query(`UPDATE pos_terminal SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [till, by]);
      await setup.query(`INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'Drawer 1', 'XTS')`, [store, till]);
      cashier = await employeeWithAccess(setup as never, org, ['Sale.Create', 'Shift.Open'], { assignedStore: store, accessStores: [store] });
    } finally {
      await setup.query(`SELECT set_config('smartstore.actor_id', '', false)`);
      setup.release();
    }
    const { hashPassword } = await import('../../src/modules/identity/password.ts');
    await db.app.query('INSERT INTO user_account (organization_id, employee_id, username, password_hash) VALUES ($1, $2, $3, $4)', [org, cashier, 'perf-cashier', await hashPassword(PASSWORD)]);

    const signIn = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'perf-cashier', password: PASSWORD, terminalId: till }),
    });
    if (signIn.status !== 201) throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0]!;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const opened = await call('POST', `/stores/${store}/shift`, { openingFloat: 0 });
    if (opened.status !== 201) throw new Error(`shift failed: ${opened.status} ${await opened.text()}`);

    const randomCode = () => ean13(1 + Math.floor(Math.random() * VARIANTS));
    const scanOnce = async () => {
      const started = performance.now();
      const response = await call('GET', `/stores/${store}/scan/${randomCode()}`);
      const body = (await response.json()) as { quote: string; price: { amount: number } };
      if (response.status !== 200) throw new Error(`scan failed: ${response.status} ${JSON.stringify(body)}`);
      return { elapsed: performance.now() - started, quote: body.quote, amount: body.price.amount };
    };

    for (let i = 0; i < 50; i += 1) await scanOnce(); // warm-up: connections, plans, caches
    const scanTimes: number[] = [];
    for (let i = 0; i < SCANS; i += 1) scanTimes.push((await scanOnce()).elapsed);

    const saleTimes: number[] = [];
    for (let i = 0; i < SALES; i += 1) {
      const lines = [];
      let total = 0;
      for (let j = 0; j < LINES; j += 1) {
        const scanned = await scanOnce();
        lines.push({ quote: scanned.quote, quantity: 1 });
        total += Math.round(scanned.amount);
      }
      const started = performance.now();
      const response = await call('POST', `/stores/${store}/sales`, { clientOperationId: randomUUID(), lines, cash: { tendered: total } });
      await response.json();
      if (response.status !== 201) throw new Error(`sale failed: ${response.status}`);
      saleTimes.push(performance.now() - started);
    }

    // 3. Card sale: the same 10-line cart paid entirely by card (SimulatedGateway TEST-APPROVE, so authorize + capture
    //    happen inline). The reported time is the full round trip: plan, authorize, capture, persist, reply.
    //    Uses PERF_CARD_SALES (default 100) iterations. No budget is stated; numbers are reported only.
    const cardSaleTimes: number[] = [];
    for (let i = 0; i < CARD_SALES; i += 1) {
      const lines = [];
      for (let j = 0; j < LINES; j += 1) {
        const scanned = await scanOnce();
        lines.push({ quote: scanned.quote, quantity: 1 });
      }
      const started = performance.now();
      const response = await call('POST', `/stores/${store}/sales`, { clientOperationId: randomUUID(), lines, card: { token: 'TEST-APPROVE' } });
      await response.json();
      if (response.status !== 201) throw new Error(`card sale failed: ${response.status}`);
      cardSaleTimes.push(performance.now() - started);
    }

    // 4. In the browser (ADR-31 §8.3): the production build of the till, signed in at the till, and timed in the page
    // from Enter on the scan field (the form's submit) to the new cart row drawn.
    const browserTimes: number[] = [];
    let browserSale = '';
    if (process.env.PERF_BROWSER !== '0') {
      const { build, preview } = await import('vite');
      const { chromium } = await import('@playwright/test');
      const webRoot = path.resolve(import.meta.dirname, '..', '..', '..', 'web');
      await build({ root: webRoot, logLevel: 'warn' });
      const site = await preview({
        root: webRoot,
        logLevel: 'warn',
        preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: new URL(base).origin } } },
      });
      const browser = await chromium.launch({ executablePath: process.env.PERF_CHROMIUM });
      try {
        const page = await browser.newPage();
        await page.addInitScript((id: string) => localStorage.setItem('smartstore.till', id), till);
        await page.goto(site.resolvedUrls!.local[0]!);
        await page.fill('input[autocomplete="username"]', 'perf-cashier');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForSelector('#code');
        for (let i = 0; i < BROWSER_SCANS + 20; i += 1) {
          await page.fill('#code', randomCode());
          const elapsed = await page.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const input = document.querySelector<HTMLInputElement>('#code')!;
                const rows = document.querySelector('table.cart tbody')!;
                const before = rows.children.length;
                const observer = new MutationObserver(() => {
                  if (rows.children.length > before) {
                    observer.disconnect();
                    requestAnimationFrame(() => resolve(performance.now() - started));
                  }
                });
                observer.observe(rows, { childList: true });
                const started = performance.now();
                input.form!.requestSubmit();
              }),
          );
          if (i >= 20) browserTimes.push(elapsed); // the first 20 warm the page up
        }

        // The slice end to end in the browser: a fresh cart of 10 scans, paid in cash, and the outcome on screen.
        await page.reload();
        await page.waitForSelector('#code');
        for (let i = 0; i < LINES; i += 1) {
          await page.fill('#code', randomCode());
          await page.press('#code', 'Enter');
          await page.waitForFunction((n: number) => document.querySelectorAll('[data-testid="cart-line"]').length === n, i + 1);
        }
        const shots = process.env.PERF_SCREENSHOTS;
        if (shots !== undefined) await page.screenshot({ path: path.join(shots, 'till-cart.png'), fullPage: true });
        await page.press('#code', 'Enter'); // Enter on an empty scan field moves to the cash field
        await page.press('#cash', 'Enter'); // Enter on an empty cash field pays the exact total
        await page.waitForSelector('#done-title');
        browserSale = (await page.textContent('#done-title')) ?? '';
        if (shots !== undefined) await page.screenshot({ path: path.join(shots, 'till-done.png'), fullPage: true });
      } finally {
        await browser.close();
        await new Promise((resolve) => site.httpServer.close(resolve));
      }
    }

    const scan = stats(scanTimes);
    const sale = stats(saleTimes);
    const cardSale = stats(cardSaleTimes);
    const seen = browserTimes.length > 0 ? stats(browserTimes) : null;
    process.stdout.write(
      `\nCatalogue: ${VARIANTS} variants. Node ${process.version}. PostgreSQL on localhost.\n` +
        `| Measure | n | p50 | p95 | max | Budget |\n|---|---|---|---|---|---|\n` +
        `| scan-to-cart (HTTP) | ${scan.n} | ${ms(scan.p50)} | ${ms(scan.p95)} | ${ms(scan.max)} | p95 ≤ 100 ms: ${scan.p95 <= 100 ? 'MET' : 'MISSED'} |\n` +
        (seen === null
          ? ''
          : `| scan-to-cart in the browser (Enter to line drawn) | ${seen.n} | ${ms(seen.p50)} | ${ms(seen.p95)} | ${ms(seen.max)} | p95 ≤ 100 ms: ${seen.p95 <= 100 ? 'MET' : 'MISSED'} |\n`) +
        `| sale-save, ${LINES} lines, cash | ${sale.n} | ${ms(sale.p50)} | ${ms(sale.p95)} | ${ms(sale.max)} | none stated |\n` +
        `| sale-save, ${LINES} lines, card (SimulatedGateway, TEST-APPROVE) | ${cardSale.n} | ${ms(cardSale.p50)} | ${ms(cardSale.p95)} | ${ms(cardSale.max)} | none stated |\n` +
        (browserSale === '' ? '' : `\nIn the browser: signed in at the till, scanned ${LINES} items, paid cash: "${browserSale}".\n`),
    );
  } finally {
    await app.close();
  }
} finally {
  await db.drop();
}
