import { describe, expect, it } from 'vitest';
import { ARGON2ID, hashPassword, needsRehash, verifyPassword } from './password.ts';

describe('password hashing (EM-04, ADR-12, architecture s7.3)', () => {
  it('s7.3: each hash has its own salt, so one password never hashes the same twice', async () => {
    const [a, b] = await Promise.all([hashPassword('TEST-ONLY same'), hashPassword('TEST-ONLY same')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('TEST-ONLY same', a)).toBe(true);
    expect(await verifyPassword('TEST-ONLY same', b)).toBe(true);
  });

  it('EM-04: only the right password matches; anything that is not an Argon2id hash never does', async () => {
    const stored = await hashPassword('TEST-ONLY right');
    expect(await verifyPassword('TEST-ONLY wrong', stored)).toBe(false);
    expect(await verifyPassword('TEST-ONLY right', 'TEST-ONLY right')).toBe(false);
    expect(await verifyPassword('x', '$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234')).toBe(false);
  });

  it('s7.3: a hash at another cost is flagged for rehashing; one at the current cost is not', async () => {
    expect(needsRehash(await hashPassword('TEST-ONLY p'))).toBe(false);
    expect(needsRehash(await hashPassword('TEST-ONLY p', { ...ARGON2ID, passes: 1 }))).toBe(true);
    expect(needsRehash('$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234')).toBe(true);
  });
});
