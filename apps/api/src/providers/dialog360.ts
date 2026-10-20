import type { MessagingProvider, SendResult } from './types.js';

// WhatsApp over 360dialog. The test account ("Sandbox", one fixed recipient, 200 messages) and
// the production Cloud API share the payloads but differ in host and path.
// Docs: https://docs.360dialog.com/docs/waba-messaging/sandbox/how-to-get-started-with-sandbox

export type Dialog360Config = { apiKey: string; testAccount: boolean };

const host = (cfg: Dialog360Config) => (cfg.testAccount ? 'https://waba-sandbox.360dialog.io' : 'https://waba-v2.360dialog.io');
const messagesPath = (cfg: Dialog360Config) => (cfg.testAccount ? '/v1/messages' : '/messages');

async function call(cfg: Dialog360Config, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${host(cfg)}${path}`, {
    method: 'POST',
    headers: { 'D360-API-KEY': cfg.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) throw new Error('360dialog lehnt den API-Schlüssel ab. Ist er vollständig kopiert?');
    if (res.status === 403) throw new Error('360dialog erlaubt diesen Empfänger nicht. Der Testzugang schreibt nur an die eigene Handynummer.');
    if (res.status === 429) throw new Error('Das Nachrichtenlimit des 360dialog-Testzugangs ist aufgebraucht.');
    throw new Error(`360dialog antwortet mit ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json().catch(() => ({}));
}

/** Tells 360dialog where to deliver incoming messages and status updates. */
export async function setDialog360Webhook(cfg: Dialog360Config, url: string): Promise<void> {
  await call(cfg, '/v1/configs/webhook', { url });
}

/** WhatsApp numbers are digits only, without + or leading zeros. */
const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^00/, '');

async function send(cfg: Dialog360Config, to: string, message: Record<string, unknown>): Promise<SendResult> {
  try {
    const body = (await call(cfg, messagesPath(cfg), { messaging_product: 'whatsapp', recipient_type: 'individual', to: waNumber(to), ...message })) as {
      messages?: { id?: string }[];
    };
    const id = body.messages?.[0]?.id;
    return id ? { ok: true, providerMessageId: id } : { ok: false, error: '360dialog hat keine Nachrichten-ID geliefert.' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function dialog360Messaging(cfg: Dialog360Config): MessagingProvider {
  return {
    sendText: ({ to, text }) => send(cfg, to, { type: 'text', text: { body: text } }),
    sendTemplate: ({ to, template, variables }) =>
      send(cfg, to, {
        type: 'template',
        template: {
          name: template,
          language: { code: 'de' },
          components: Object.keys(variables).length
            ? [{ type: 'body', parameters: Object.values(variables).map((text) => ({ type: 'text', text })) }]
            : [],
        },
      }),
  };
}

export type IncomingWhatsApp = { id: string; from: string; name: string | null; text: string };
export type WhatsAppStatus = { id: string; status: string };

/** Pulls text messages and delivery statuses out of a Cloud API webhook body. */
export function parseDialog360Webhook(body: unknown): { messages: IncomingWhatsApp[]; statuses: WhatsAppStatus[] } {
  const out = { messages: [] as IncomingWhatsApp[], statuses: [] as WhatsAppStatus[] };
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of (entry as { changes?: unknown[] }).changes ?? []) {
      const value = (change as { value?: Record<string, unknown> }).value ?? {};
      const contacts = (value.contacts as { wa_id?: string; user_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const from = String(m.from ?? m.from_user_id ?? '');
        const contact = contacts.find((c) => c.wa_id === from || c.user_id === from);
        const text =
          m.type === 'text'
            ? ((m.text as { body?: string })?.body ?? '')
            : m.type === 'button'
              ? ((m.button as { text?: string })?.text ?? '')
              : m.type === 'interactive'
                ? (((m.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } })?.button_reply ??
                    (m.interactive as { list_reply?: { title?: string } })?.list_reply)?.title ?? '')
                : `[${String(m.type ?? 'Nachricht')} empfangen]`;
        if (m.id && from) out.messages.push({ id: String(m.id), from, name: contact?.profile?.name ?? null, text });
      }
      for (const s of (value.statuses as { id?: string; status?: string }[] | undefined) ?? []) {
        if (s.id && s.status) out.statuses.push({ id: s.id, status: s.status });
      }
    }
  }
  return out;
}
