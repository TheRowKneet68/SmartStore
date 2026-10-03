import { spawnSync } from 'node:child_process';
import { stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';

/**
 * `npm run checks:run [-- --older-than <minutes>]`: runs `ledger:check`, `audit:check`, and `payments:check` in
 * sequence and summarises the result. Exits non-zero when any check finds a problem, so a scheduler can alert on
 * the exit code. Running this script on a schedule addresses `BQ-02` for the integrity checks; see
 * `docs/operations/SCHEDULED-CHECKS.md` for cron / Task Scheduler examples.
 *
 * `--older-than <minutes>` (default: env `PAYMENTS_OLDER_THAN_MINUTES`, then 60): how old a Pending or Authorized
 * card payment may be before `payments:check` flags it. The specification calls this value "configured" (OQ-037).
 */
const { values } = parseArgs({ options: { 'older-than': { type: 'string' } } });
const olderThan: string = (values['older-than'] as string | undefined) ?? process.env['PAYMENTS_OLDER_THAN_MINUTES'] ?? '60';

const checks: { label: string; args: string[] }[] = [
  { label: 'ledger:check', args: ['src/cli/ledger-check.ts'] },
  { label: 'audit:check', args: ['src/cli/audit-check.ts'] },
  { label: 'payments:check', args: ['src/cli/payments-check.ts', '--older-than', olderThan] },
];

let anyFailed = false;
for (const { label, args } of checks) {
  const result = spawnSync('node', args, { stdio: 'inherit', shell: false });
  const ok = result.status === 0 && result.error === undefined;
  if (!ok) anyFailed = true;
  stdout.write(`[${ok ? 'OK' : 'FAIL'}] ${label}\n`);
  if (result.error) stderr.write(`  spawn error: ${String(result.error)}\n`);
}

if (anyFailed) process.exitCode = 1;
