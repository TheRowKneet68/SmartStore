import { stdout } from 'node:process';
import { z } from 'zod';
import { loadDotEnv } from '../config.ts';
import { createPool } from '../db/pool.ts';

/**
 * `npm run ledger:check`: rebuilds every stock balance from the movement ledger and walks each item's resulting-balance
 * chain with `inventory_ledger_drift()` (`IV-09`, `ADR-22`). It repairs nothing (the drift is the evidence), and it exits
 * non-zero on any disagreement, so a scheduler can alert on it. Running it on a schedule is not built yet.
 */
loadDotEnv();
const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) throw new Error('DATABASE_URL is not set. Run scripts/db-setup.ps1, or see .env.example.');

const pool = createPool(url.data, 1);
try {
  const { rows } = await pool.query<{ variant_id: string; storage_location_id: string; problem: string; recorded: string; expected: string }>(
    'SELECT variant_id, storage_location_id, problem, recorded::text, expected::text FROM inventory_ledger_drift()',
  );
  if (rows.length === 0) {
    stdout.write('Every stock balance agrees with its ledger.\n');
  } else {
    for (const r of rows) {
      stdout.write(`Variant ${r.variant_id} at ${r.storage_location_id}: ${r.problem} (recorded ${r.recorded}, ledger ${r.expected})\n`);
    }
    stdout.write(`${rows.length} disagreement(s). Nothing was changed: drift is evidence.\n`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
