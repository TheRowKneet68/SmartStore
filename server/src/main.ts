import { buildApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { createPool } from './db/pool.ts';
import { SimulatedGateway } from './modules/payments/simulated-gateway.ts';

loadDotEnv();
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
// ADR-31 §13 item 4: card payments run against a simulated gateway until the owner supplies a real acquirer, which needs
// an account and secrets. It moves no money. Nothing else in the server names it.
const gateway = new SimulatedGateway();
const app = await buildApp({
  pool,
  gateway,
  logger: true,
  quoteMaxAgeMinutes: config.QUOTE_MAX_AGE_MINUTES,
  lockTimeoutMs: config.LOCK_TIMEOUT_MS,
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
if (gateway.simulated) {
  app.log.warn('SIMULATED CARD GATEWAY: card payments and refunds are test doubles. No card is charged and no money moves.');
}
