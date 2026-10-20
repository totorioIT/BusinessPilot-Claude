import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { integrations } from '../db/schema.js';
import { decrypt } from '../lib/secretbox.js';
import { liveLlm } from '../services/ai-settings.js';
import { dialog360Messaging } from './dialog360.js';
import { sandboxCalendar, sandboxEmail, sandboxLlm, sandboxMessaging, sandboxVoice } from './sandbox.js';
import type { CalendarProvider, EmailProvider, LlmProvider, MessagingProvider, ProviderKey, VoiceProvider } from './types.js';

export type ProviderInfo = {
  provider: ProviderKey;
  name: string;
  description: string;
  category: 'voice' | 'messaging' | 'calendar' | 'reviews' | 'email' | 'ai';
  hasWebhook: boolean;
};

export const PROVIDERS: ProviderInfo[] = [
  { provider: 'fonio', name: 'fonio.ai (Telefon)', description: 'KI-Telefonassistent für ein- und ausgehende Anrufe.', category: 'voice', hasWebhook: true },
  { provider: 'whatsapp_360dialog', name: 'WhatsApp Business (360dialog)', description: 'Offizielle WhatsApp Business API über den Meta-Partner 360dialog.', category: 'messaging', hasWebhook: true },
  { provider: 'google_calendar', name: 'Google Kalender', description: 'Prüft freie Zeiten und trägt gebuchte Termine ein.', category: 'calendar', hasWebhook: false },
  { provider: 'microsoft_365', name: 'Microsoft 365 / Outlook', description: 'Outlook-Kalender über Microsoft Graph.', category: 'calendar', hasWebhook: false },
  { provider: 'google_business', name: 'Google Unternehmensprofil', description: 'Bewertungen abrufen und beantworten.', category: 'reviews', hasWebhook: false },
  { provider: 'brevo', name: 'Brevo (E-Mail & SMS)', description: 'Versand von E-Mails und SMS aus der EU.', category: 'email', hasWebhook: false },
  { provider: 'openai', name: 'KI-Modell (IONOS, Deutschland)', description: 'Sprachmodell für Antworten und Zusammenfassungen, Verarbeitung in deutschen Rechenzentren. Wird zentral unter Plattform-Admin eingerichtet.', category: 'ai', hasWebhook: false },
];

export type Providers = {
  messaging: MessagingProvider;
  email: EmailProvider;
  calendar: CalendarProvider;
  llm: LlmProvider;
  voice: VoiceProvider;
};

/**
 * Resolves the providers for one tenant. The LLM is live as soon as a platform admin has saved
 * a model; WhatsApp is live once the tenant has entered a 360dialog key. Everything else still
 * runs in the sandbox.
 */
export async function providersFor(db: DbOrTx, tenantId: string): Promise<Providers> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.mode, 'live'), eq(integrations.status, 'connected')));
  const whatsapp = rows.find((r) => r.provider === 'whatsapp_360dialog');
  const live = await liveLlm(db);
  return {
    messaging: whatsapp ? dialog360Messaging({ apiKey: decrypt(whatsapp.config.apiKey), testAccount: whatsapp.config.testAccount === 'true' }) : sandboxMessaging,
    email: sandboxEmail,
    calendar: sandboxCalendar,
    llm: live ? withFallback(live) : sandboxLlm,
    voice: sandboxVoice,
  };
}

/** A customer should get an answer even when the model is down, so fall back to the knowledge text. */
function withFallback(llm: LlmProvider): LlmProvider {
  return {
    async complete(input) {
      try {
        return await llm.complete(input);
      } catch (err) {
        console.error('KI-Modell nicht erreichbar, Antwort aus dem Wissen:', err);
        return sandboxLlm.complete(input);
      }
    },
  };
}
