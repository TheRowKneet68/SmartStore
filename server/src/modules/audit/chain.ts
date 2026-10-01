import type { Queryable } from '../../db/pool.ts';

export interface ChainBreak {
  organizationId: string;
  chainSeq: string | null;
  auditEventId: string | null;
  problem: string;
}

/**
 * Checks every organization's audit hash chain (`AU-29`, `AU-30`, `RT-302`) with the database's
 * `audit_chain_breaks()`, and returns what it finds: an altered, removed, tail-removed or unlinked event. Nothing is
 * repaired; a break is evidence (`EC-76`).
 */
export async function chainBreaks(db: Queryable): Promise<ChainBreak[]> {
  const { rows } = await db.query<ChainBreak>(
    `SELECT o.id AS "organizationId", b.chain_seq::text AS "chainSeq", b.audit_event_id AS "auditEventId", b.problem
     FROM organization o CROSS JOIN LATERAL audit_chain_breaks(o.id) b
     ORDER BY o.id, b.chain_seq`,
  );
  return rows;
}
