import { buildApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { createPool } from './db/pool.ts';

loadDotEnv();
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp({
  pool,
  logger: true,
  quoteMaxAgeMinutes: config.QUOTE_MAX_AGE_MINUTES,
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
