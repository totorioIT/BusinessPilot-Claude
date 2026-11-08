import type { EmailProvider } from './types.js';

// Transactional email over Brevo (Sendinblue), servers in the EU.
// Docs: https://developers.brevo.com/reference/sendtransacemail
// The sender address must be verified in Brevo (Senders, Domains & Dedicated IPs).

export type BrevoConfig = { apiKey: string; senderEmail: string; senderName?: string };

const BASE = 'https://api.brevo.com/v3';

function explain(status: number, detail: string): string {
  if (status === 401) return 'Brevo lehnt den API-Schlüssel ab. Ist er vollständig kopiert?';
  if (status === 403) return 'Brevo erlaubt das noch nicht. Ist das Konto freigeschaltet und die IP-Sperre aus?';
  if (status === 429) return 'Brevo meldet zu viele Anfragen. Bitte später erneut versuchen.';
  return `Brevo antwortet mit ${status}${detail ? `: ${detail}` : ''}`;
}

/** Checks the key and returns the account email, so the dashboard can show which account is used. */
export async function brevoAccount(apiKey: string): Promise<{ email: string }> {
  const res = await fetch(`${BASE}/account`, { headers: { 'api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(explain(res.status, (await res.text().catch(() => '')).slice(0, 200)));
  const body = (await res.json().catch(() => ({}))) as { email?: string };
  return { email: body.email ?? '' };
}

export function brevoEmail(cfg: BrevoConfig): EmailProvider {
  return {
    async send(input) {
      try {
        const res = await fetch(`${BASE}/smtp/email`, {
          method: 'POST',
          headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            // The business's name as display name; the verified platform address as sender.
            sender: { email: cfg.senderEmail, name: (input.fromName ?? cfg.senderName ?? 'RufAnna').slice(0, 70) },
            to: [{ email: input.to }],
            subject: input.subject,
            textContent: input.text,
            ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
            ...(input.headers ? { headers: input.headers } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, error: explain(res.status, (await res.text().catch(() => '')).slice(0, 200)) };
        const body = (await res.json().catch(() => ({}))) as { messageId?: string };
        return { ok: true, providerMessageId: body.messageId ?? '' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Brevo ist nicht erreichbar.' };
      }
    },
  };
}
