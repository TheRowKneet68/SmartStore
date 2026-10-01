import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';

// .env at the repository root, if present; variables already set in the environment win (ADR-31 §6).
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp({
  pool,
  logger: true,
  session: {
    lifetimeMinutes: config.SESSION_LIFETIME_MINUTES,
    failureLimit: config.SIGN_IN_FAILURE_LIMIT,
    failureWindowMinutes: config.SIGN_IN_FAILURE_WINDOW_MINUTES,
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
