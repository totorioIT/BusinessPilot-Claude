// The last calls fonio made, kept in memory so the dashboard can show what arrived while a
// tenant sets up its assistant. Nothing here is persisted; a restart clears it.

export type WebhookLogEntry = {
  at: string;
  path: string;
  status: number;
  /** Field names with a short preview of each value; tokens are shortened. */
  fields: Record<string, string>;
  note: string | null;
};

const MAX = 20;
const byTenant = new Map<string, WebhookLogEntry[]>();
const unauthenticated: WebhookLogEntry[] = [];

function preview(key: string, value: unknown): string {
  if (value === null || value === undefined) return '(leer)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.trim() === '') return '(leer)';
  if (/token/i.test(key) && text.length > 12) return `${text.slice(0, 5)}…${text.slice(-4)}`;
  return text.length > 120 ? `${text.slice(0, 120)}… (${text.length} Zeichen)` : text;
}

export function logWebhook(tenantId: string | null, entry: { path: string; status: number; body: unknown; note?: string | null }) {
  const body = entry.body && typeof entry.body === 'object' && !Array.isArray(entry.body) ? (entry.body as Record<string, unknown>) : {};
  const fields = Object.fromEntries(
    Object.entries(body).map(([k, v]) => [k, tenantId ? preview(k, v) : '…']),
  );
  const list = tenantId ? (byTenant.get(tenantId) ?? byTenant.set(tenantId, []).get(tenantId)!) : unauthenticated;
  list.unshift({ at: new Date().toISOString(), path: entry.path, status: entry.status, fields, note: entry.note ?? null });
  list.length = Math.min(list.length, MAX);
}

export function webhookLog(tenantId: string, includeUnauthenticated: boolean) {
  return { entries: byTenant.get(tenantId) ?? [], unauthenticated: includeUnauthenticated ? unauthenticated : [] };
}
