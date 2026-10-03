# Scheduled integrity checks

SmartStore has three CLI checks that should run on a schedule in every production deployment.
Each exits non-zero when it finds a problem and prints what it found. None changes any data —
findings are evidence for investigation.

## The checks

| Script | npm alias | What it checks | Frequency |
|---|---|---|---|
| `src/cli/ledger-check.ts` | `ledger:check` | Every stock balance agrees with the movement ledger (`IV-09`, `ADR-22`). | Daily (or after any bulk import) |
| `src/cli/audit-check.ts` | `audit:check` | The audit hash chain is unbroken for every organization (`AU-29`, `AU-30`). | Daily |
| `src/cli/payments-check.ts` | `payments:check --older-than <minutes>` | Card payments that have been waiting longer than the given window without completing (`PY-40`). | Hourly (or more often in a busy store) |

## Running all three at once

```
npm run checks:run
# or, with a custom window:
npm run checks:run -- --older-than 30
```

`checks:run` runs all three in sequence and exits non-zero if any fails. It reads
`PAYMENTS_OLDER_THAN_MINUTES` from the environment when `--older-than` is not given (default: 60).

## What to do when a check fails

| Check | Finding | Action |
|---|---|---|
| `ledger:check` | Balance drift | Do not write off — the ledger is evidence. Identify the movement that caused the drift. File a bug. |
| `audit:check` | Chain break | Do not repair the chain — the break is evidence of tampering or data loss. Escalate immediately. |
| `payments:check` | Pending too long | Void it from the Payments Attention screen (requires `Payment.Void`). |
| `payments:check` | Authorized, not captured | Capture or void it. If capture fails repeatedly, void and ask the customer to pay again. |
| `payments:check` | Captured, no sale | Create a refund from the Payments Attention screen (requires `Sale.Refund`). |

## Linux — cron

Add to the deployment user's crontab (`crontab -e`). Replace `/opt/smartstore/server` with the
actual path:

```cron
# Run all integrity checks daily at 02:00.
0 2 * * * cd /opt/smartstore/server && npm run checks:run >> /var/log/smartstore/checks.log 2>&1

# Run payments:check every hour during trading hours (08:00–22:00).
0 8-22 * * * cd /opt/smartstore/server && npm run payments:check -- --older-than 60 >> /var/log/smartstore/payments-check.log 2>&1
```

To alert on failure, pipe through a notifier or check the exit code:

```bash
npm run checks:run || curl -s -X POST "$ALERT_WEBHOOK" -d '{"text":"SmartStore checks failed"}'
```

## Linux — systemd timer (alternative to cron)

```ini
# /etc/systemd/system/smartstore-checks.service
[Unit]
Description=SmartStore integrity checks

[Service]
Type=oneshot
WorkingDirectory=/opt/smartstore/server
ExecStart=/usr/bin/npm run checks:run
User=smartstore
StandardOutput=journal
StandardError=journal
```

```ini
# /etc/systemd/system/smartstore-checks.timer
[Unit]
Description=Run SmartStore checks daily

[Timer]
OnCalendar=02:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with `systemctl enable --now smartstore-checks.timer`.

## Windows — Task Scheduler

1. Open **Task Scheduler** → **Create Basic Task**.
2. Set the trigger to **Daily** at 02:00 (add a second task for `payments:check` hourly).
3. Action: **Start a program**.
   - Program: `node`
   - Arguments: `src/cli/run-checks.ts`
   - Start in: `C:\SmartStore\server` (actual path)
4. In **Settings**, tick **Run task as soon as possible after a scheduled start is missed**.
5. In **Conditions**, untick **Start only if the computer is on AC power** for a server.

Or from PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute 'node' `
  -Argument 'src/cli/run-checks.ts' `
  -WorkingDirectory 'C:\SmartStore\server'
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
Register-ScheduledTask -TaskName 'SmartStore-Checks' -Action $action -Trigger $trigger -RunLevel Highest
```

## Environment

The checks read `DATABASE_URL` from `.env` in the server directory (via `loadDotEnv()`). Ensure the
file is present and readable by the user that runs the scheduled task. `PAYMENTS_OLDER_THAN_MINUTES`
can be set there to override the default window of 60 minutes.

## Background note (BQ-02)

The specification requires scheduling for the integrity checks and the notification outbox. This
document addresses the checks. The outbox and notification delivery remain deferred (`BQ-02`): the
architecture names no broker and ADR-31 adds none. When a broker is chosen, the scheduled-check
pattern here can be replaced with proper job infrastructure.
