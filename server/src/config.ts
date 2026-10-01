import { z } from 'zod';

/**
 * The environment the server needs, read and validated once at start, failing fast (ADR-31 §5). `DATABASE_URL` is the
 * runtime role's URL (ADR-31 §6, `ADR-11`); the server never reads the migration role's URL.
 */
const Environment = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export type Config = z.infer<typeof Environment>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Environment.safeParse(env);
  if (!parsed.success) {
    // Names only, never values: DATABASE_URL carries a password.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid or missing environment variables: ${names}. See .env.example.`);
  }
  return parsed.data;
}
