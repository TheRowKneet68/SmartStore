import { stdout } from 'node:process';
import { z } from 'zod';
import { loadDotEnv } from '../config.ts';
import { createPool } from '../db/pool.ts';
import { chainBreaks } from '../modules/audit/chain.ts';

/**
 * `npm run audit:check`: checks every organization's audit chain (`AU-29`, `AU-30`) and exits non-zero on any break, so
 * a scheduler can alert on it. Running it on a schedule is not built (BUILD-STATUS, deferred jobs).
 */
loadDotEnv();
const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) throw new Error('DATABASE_URL is not set. Run scripts/db-setup.ps1, or see .env.example.');

const pool = createPool(url.data, 1);
try {
  const breaks = await chainBreaks(pool);
  if (breaks.length === 0) {
    stdout.write('The audit chain is intact for every organization.\n');
  } else {
    for (const b of breaks) {
      stdout.write(`Organization ${b.organizationId}, event ${b.auditEventId ?? '(none)'}, link ${b.chainSeq ?? '(none)'}: ${b.problem}\n`);
    }
    stdout.write(`${breaks.length} break(s) found. Nothing was changed: a break is evidence.\n`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
