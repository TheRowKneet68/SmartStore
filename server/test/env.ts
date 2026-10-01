import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const migrationsDir = path.join(repoRoot, 'db', 'migrations');
export const TEMPLATE_DB = 'smartstore_test_template';

/** Reads .env at the repo root into process.env. Variables that are already set win, so CI can inject its own. */
export function loadEnv(): void {
  const file = path.join(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run scripts/db-setup.ps1 to create .env, or set it in the environment (see .env.example).`,
    );
  }
  return value;
}

/** The same server and credentials as `base`, pointed at another database. */
export function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}
