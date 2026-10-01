import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db.ts';
import { repoRoot } from './env.ts';

/**
 * CLAUDE.md: "Every table, function, and test cites requirement IDs. A constraint cites the rule it enforces. An
 * artifact with no citation is not justified and will be sent back." This test is the mechanical half of that rule:
 * every table, constraint, index, function, trigger and domain in the schema carries a `Cites:` comment, and every
 * ID it cites appears somewhere in /docs. It cannot judge whether the citation is the right one. A reviewer does that.
 *
 * Comment format:   COMMENT ON TABLE store IS 'Cites: RT-001, MS-01. One sentence saying what it is for.';
 * Primary keys are exempt. schema_migrations belongs to dbmate.
 */

const ID_IN_TEXT = /\b[A-Z]+(?:-[A-Z]+)*-Q?\d+[a-z]?\b/g;
const ID_EXACT = /^[A-Z]+(?:-[A-Z]+)*-Q?\d+[a-z]?$/;

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

function idsInDocs(): Set<string> {
  const files = [...markdownFiles(path.join(repoRoot, 'docs')), path.join(repoRoot, 'CLAUDE.md')];
  const ids = new Set<string>();
  for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(ID_IN_TEXT)) ids.add(match[0]);
  return ids;
}

/** Problems with one comment: missing, malformed, or citing an ID that is not in /docs. */
function problemsWith(kind: string, name: string, comment: string | null, known: Set<string>): string[] {
  if (!comment) return [`${kind} ${name}: no COMMENT`];
  const match = /^Cites: (.+?)(?:\.(?:\s|$)|$)/s.exec(comment);
  if (!match) return [`${kind} ${name}: comment must start "Cites: ID, ID."`];
  const problems: string[] = [];
  for (const id of match[1]!.split(',').map((part) => part.trim())) {
    if (!ID_EXACT.test(id)) problems.push(`${kind} ${name}: "${id}" is not a requirement or rule ID`);
    else if (!known.has(id)) problems.push(`${kind} ${name}: ${id} does not appear anywhere in /docs`);
  }
  return problems;
}

interface Row {
  name: string;
  comment: string | null;
}

/** Every citation problem in the `public` schema of the database behind `pool`. */
async function schemaProblems(pool: pg.Pool): Promise<string[]> {
  const known = idsInDocs();
  const q = async (sql: string): Promise<Row[]> => (await pool.query<Row>(sql)).rows;

  const tables = await q(`
    SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'schema_migrations'`);
  const constraints = await q(`
    SELECT cl.relname || '.' || con.conname AS name, obj_description(con.oid, 'pg_constraint') AS comment
    FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname <> 'schema_migrations' AND con.contype IN ('c', 'f', 'u', 'x')`);
  const indexes = await q(`
    SELECT i.relname AS name, obj_description(i.oid, 'pg_class') AS comment
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname <> 'schema_migrations'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)`);
  const functions = await q(`
    SELECT p.proname AS name, obj_description(p.oid, 'pg_proc') AS comment
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'`);
  const triggers = await q(`
    SELECT cl.relname || '.' || t.tgname AS name, obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal`);
  const domains = await q(`
    SELECT ty.typname AS name, obj_description(ty.oid, 'pg_type') AS comment
    FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
    WHERE n.nspname = 'public' AND ty.typtype = 'd'`);

  return [
    ...tables.flatMap((r) => problemsWith('table', r.name, r.comment, known)),
    ...constraints.flatMap((r) => problemsWith('constraint', r.name, r.comment, known)),
    ...indexes.flatMap((r) => problemsWith('index', r.name, r.comment, known)),
    ...functions.flatMap((r) => problemsWith('function', r.name, r.comment, known)),
    ...triggers.flatMap((r) => problemsWith('trigger', r.name, r.comment, known)),
    ...domains.flatMap((r) => problemsWith('domain', r.name, r.comment, known)),
  ];
}

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe('citations: every schema object cites requirement IDs (CLAUDE.md)', () => {
  it('the migrated schema has no uncited object', async () => {
    const applied = await db.owner.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
    expect(Number(applied.rows[0]!.n), 'no migration is recorded: the migrations did not run').toBeGreaterThan(0);
    expect(await schemaProblems(db.owner)).toEqual([]);
  });

  // A check that cannot fail proves nothing (P10). This plants one violation of each kind and expects to be told.
  it('the checker does flag missing, malformed and unknown citations', async () => {
    await db.owner.query(`
      CREATE TABLE zz_probe (a integer NOT NULL, b integer,
        CONSTRAINT ck_zz_probe_a CHECK (a > 0),
        CONSTRAINT ck_zz_probe_b CHECK (b > 0));
      COMMENT ON CONSTRAINT ck_zz_probe_b ON zz_probe IS 'Cites: ZZ-99999. Unknown id.';
      CREATE INDEX ix_zz_probe_a ON zz_probe (a);
      COMMENT ON INDEX ix_zz_probe_a IS 'because I said so';
      CREATE FUNCTION zz_probe_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
    try {
      const problems = await schemaProblems(db.owner);
      expect(problems).toContain('table zz_probe: no COMMENT');
      expect(problems).toContain('constraint zz_probe.ck_zz_probe_a: no COMMENT');
      expect(problems).toContain('constraint zz_probe.ck_zz_probe_b: ZZ-99999 does not appear anywhere in /docs');
      expect(problems).toContain('index ix_zz_probe_a: comment must start "Cites: ID, ID."');
      expect(problems).toContain('function zz_probe_fn: no COMMENT');
    } finally {
      await db.owner.query('DROP FUNCTION zz_probe_fn(); DROP TABLE zz_probe;');
    }
  });
});
