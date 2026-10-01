import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);

/**
 * Argon2id with a per-user salt (architecture §7.3, `EM-04`, `ADR-12`). The cost is the first Argon2id configuration
 * of the OWASP Password Storage Cheat Sheet: 19 MiB, 2 passes, 1 lane (about 30 ms here). Raising it needs no reset:
 * a sign-in rehashes a password stored at an older cost (§7.3).
 */
export const ARGON2ID = { memory: 19_456, passes: 2, parallelism: 1 } as const;
type Cost = { memory: number; passes: number; parallelism: number };

const TAG_BYTES = 32;
const SALT_BYTES = 16;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const unpadded = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

/** The PHC string the database accepts (`ck_user_account_password_hash`). The password itself is never stored. */
export async function hashPassword(password: string, cost: Cost = ARGON2ID): Promise<string> {
  const nonce = randomBytes(SALT_BYTES);
  const tag = await derive('argon2id', { message: password, nonce, tagLength: TAG_BYTES, ...cost });
  return `$argon2id$v=19$m=${cost.memory},t=${cost.passes},p=${cost.parallelism}$${unpadded(nonce)}$${unpadded(tag)}`;
}

/** Whether `password` matches `stored`, compared in constant time. Anything that is not Argon2id never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = PHC.exec(stored);
  if (!parts) return false;
  const expected = Buffer.from(parts[5]!, 'base64');
  const tag = await derive('argon2id', {
    message: password,
    nonce: Buffer.from(parts[4]!, 'base64'),
    memory: Number(parts[1]),
    passes: Number(parts[2]),
    parallelism: Number(parts[3]),
    tagLength: expected.length,
  });
  return tag.length === expected.length && timingSafeEqual(tag, expected);
}

/** Whether `stored` was made at another cost than today's, so that a successful sign-in should rehash it (§7.3). */
export function needsRehash(stored: string, cost: Cost = ARGON2ID): boolean {
  const parts = PHC.exec(stored);
  return (
    parts === null ||
    Number(parts[1]) !== cost.memory ||
    Number(parts[2]) !== cost.passes ||
    Number(parts[3]) !== cost.parallelism
  );
}
