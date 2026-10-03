import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { useList } from '../lib/form.ts';
import { problemOf, ProblemNotice } from '../lib/Problem.tsx';

interface AuditRow {
  id: string;
  seq: string;
  occurredAt: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string;
  storeId: string | null;
  reasonCodeId: string | null;
  source: string;
  correlationId: string;
}

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/**
 * Organisation-wide audit log (OQ-024, AU-11, RT-292). Read-only; requires `Audit.View`.
 * Filters: event type, entity type, entity id (partial not supported — an exact UUID filters to
 * one entity), and store. Results are newest-first, a page at a time.
 */
export function AuditLog({ permissions }: { permissions: string[] }) {
  if (!permissions.includes('Audit.View')) {
    return (
      <section className="panel" aria-labelledby="audit-title">
        <h1 id="audit-title">Audit log</h1>
        <p>You do not have permission to view the audit log (Audit.View).</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="audit-title">
      <h1 id="audit-title">Audit log</h1>
      <Listing />
    </section>
  );
}

function Listing() {
  const [eventType, setEventType] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof problemOf> | null>(null);

  const filters = [eventType, entityType, entityId].join('|');

  useEffect(() => {
    setRows(null);
    setNext(null);
    const q = new URLSearchParams();
    if (eventType !== '') q.set('eventType', eventType);
    if (entityType !== '') q.set('entityType', entityType);
    if (entityId !== '') q.set('entityId', entityId);
    api<{ items: AuditRow[]; next: string | null }>('GET', `/audit-events${q.toString() === '' ? '' : `?${q}`}`).then(
      (r) => { setRows(r.items); setHasMore(r.next !== null); setNext(r.next); },
      (e: unknown) => setProblem(problemOf(e)),
    );
  }, [filters]);

  const loadMore = () => {
    if (next === null) return;
    const q = new URLSearchParams();
    if (eventType !== '') q.set('eventType', eventType);
    if (entityType !== '') q.set('entityType', entityType);
    if (entityId !== '') q.set('entityId', entityId);
    q.set('after', next);
    api<{ items: AuditRow[]; next: string | null }>('GET', `/audit-events?${q}`).then(
      (r) => { setRows((prev) => [...(prev ?? []), ...r.items]); setHasMore(r.next !== null); setNext(r.next); },
      (e: unknown) => setProblem(problemOf(e)),
    );
  };

  return (
    <>
      <fieldset className="filters">
        <legend>Filter events</legend>
        <label>
          Event type
          <input type="text" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="e.g. Employee.StateChange" />
        </label>
        <label>
          Entity type
          <input type="text" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. employee" />
        </label>
        <label>
          Entity ID
          <input type="text" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="UUID" />
        </label>
      </fieldset>
      <ProblemNotice problem={problem} />
      {rows === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <p>No events match that filter.</p>
      ) : (
        <>
          <table className="records">
            <caption className="visually-hidden">Audit events, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Entity type</th>
                <th scope="col">Entity ID</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.occurredAt)}</td>
                  <td>{r.eventType}</td>
                  <td>{r.entityType}</td>
                  <td className="hint">{r.entityId}</td>
                  <td>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="actions">
              <button type="button" onClick={loadMore}>
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
