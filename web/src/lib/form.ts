import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { problemOf, type Problem } from './Problem.tsx';

/**
 * Reads a list, again after each change made on screen. Every list screen in the back office is the same shape: null
 * while loading, an empty list, or rows, plus whatever the server said (`UX-55`, `UX-59`).
 */
export function useList<T>(path: string | null) {
  const [body, setBody] = useState<{ items: T[]; before?: number | null; next?: string | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (path === null) return;
    setBody(null);
    setProblem(null);
    api<{ items: T[] }>('GET', path).then(setBody, (e: unknown) => setProblem(problemOf(e)));
  }, [path, version]);
  return { items: body?.items ?? null, body, problem, setProblem, reload: () => setVersion((v) => v + 1) };
}

/** Reads one record, again when the path changes. `null` while loading, as `useList` returns null. */
export function useOne<T>(path: string | null) {
  const [body, setBody] = useState<T | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (path === null) return;
    setBody(null);
    setProblem(null);
    api<T>('GET', path).then(setBody, (e: unknown) => setProblem(problemOf(e)));
  }, [path, version]);
  return { body, problem, setProblem, reload: () => setVersion((v) => v + 1) };
}

/** The fields of `next` that differ from `was`: an edit sends only what changed (`D2 §4`). */
export const changesOf = <T extends object>(was: T, next: Partial<T>): Partial<T> =>
  Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== was[key as keyof T])) as Partial<T>;

/** A date and time as this person reads it, wherever they are. */
export const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** An empty option plus the choices, for a `select`. */
export function options(placeholder: string, items: { id: string; name: string }[]) {
  return [{ id: '', name: placeholder }, ...items];
}

export interface ProductHit {
  id: string;
  name: string;
  status: string;
  categoryId: string;
  brandId: string | null;
}

/**
 * Products by name, a page at a time (architecture §18.5, `UX-48`). A name search is a contains match, never mixed with
 * barcodes, and each request carries the cursor the last answer gave. The catalogue is organization-wide, so this path
 * has no store in it.
 */
export function useProductHits() {
  const [items, setItems] = useState<ProductHit[] | null>(null);
  const [cursor, setCursor] = useState<{ search: string; after: string | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const ask = async (search: string, after: string | null) => {
    const query = new URLSearchParams({ ...(search.trim() === '' ? {} : { search: search.trim() }), ...(after === null ? {} : { after }) }).toString();
    try {
      const page = await api<{ items: ProductHit[]; next: string | null }>('GET', `/products${query === '' ? '' : `?${query}`}`);
      setItems((shown) => [...(after === null ? [] : (shown ?? [])), ...page.items]);
      setCursor({ search, after: page.next });
      setProblem(null);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    void ask('', null);
  }, []);

  return {
    items,
    hasMore: cursor?.after !== null && cursor !== null,
    problem,
    find: (text: string) => void ask(text, null),
    more: () => cursor !== null && void ask(cursor.search, cursor.after),
  };
}
