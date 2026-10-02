import { stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadDotEnv } from '../config.ts';
import { createPool } from '../db/pool.ts';
import { paymentsNeedingAttention } from '../modules/payments/attention.ts';

/**
 * `npm run payments:check -- --older-than <minutes> [--store <id>]`: the card payments that need a person (`PY-40`), for
 * every store or one. It changes nothing and exits non-zero when there is any, so a scheduler can alert on it, as with
 * `ledger:check`. Running it on a schedule is not built (`BQ-02`). The window is the caller's: the specification calls it
 * "configured" and gives no value (OQ-037).
 */
loadDotEnv();
const args = parseArgs({ options: { 'older-than': { type: 'string' }, store: { type: 'string' } } }).values;
const olderThan = z.coerce.number().int().min(0).safeParse(args['older-than']);
if (!olderThan.success || args['older-than'] === undefined) throw new Error('Say how long a payment may wait: --older-than <minutes>.');
const store = args.store === undefined ? null : z.uuid().parse(args.store);
const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) throw new Error('DATABASE_URL is not set. Run scripts/db-setup.ps1, or see .env.example.');

const pool = createPool(url.data, 1);
try {
  const { summary, items } = await paymentsNeedingAttention(pool, { storeId: store, olderThanMinutes: olderThan.data, limit: 1_000, offset: 0 });
  if (items.length === 0) {
    stdout.write('No card payment needs a person.\n');
  } else {
    for (const i of items) {
      stdout.write(
        `${i.kind}: payment ${i.paymentId}, ${i.amount} ${i.currencyCode}, ${i.status} for ${i.ageMinutes} min` +
          `${i.simulated ? ' (SIMULATED gateway)' : ''}, store ${i.storeId}, sale operation ${i.operationId}\n`,
      );
    }
    stdout.write(
      `${summary.PendingTooLong} pending, ${summary.AuthorizedNotCaptured} authorized and not captured, ${summary.CapturedNoSale} captured with no sale. Nothing was changed.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
