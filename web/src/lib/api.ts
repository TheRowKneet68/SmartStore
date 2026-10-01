/** The server's error shape (architecture §18.4): branch on `code`, show `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** One call to the versioned API, same origin, with the session cookie (architecture §7.1). */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'The server cannot be reached. Nothing was lost; try again.', {});
  }
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({}))) as { error?: Record<string, unknown> };
  if (!response.ok) {
    const { code, message, ...details } = json.error ?? {};
    throw new ApiError(response.status, String(code ?? 'internal'), String(message ?? 'Something went wrong on the server.'), details);
  }
  return json as T;
}

export interface Workspace {
  employee: { id: string; name: string; readOnly: boolean };
  organization: { id: string; name: string; permissions: string[] };
  stores: { id: string; code: string; name: string; currencyCode: string; minorUnitExponent: number; permissions: string[] }[];
  terminal: { id: string; code: string; label: string; storeId: string } | null;
}

export interface Scanned {
  variantId: string;
  description: string;
  barcode: string;
  price: { amount: number; currencyCode: string; minorUnitExponent: number };
  quote: string;
}

export interface Sale {
  saleId: string;
  documentNumber: number;
  currencyCode: string;
  totalDue: number;
  tendered: number;
  change: number;
}
