import { newId } from '../lib/ids.js';
import type {
  CalendarProvider,
  EmailProvider,
  LlmProvider,
  MessagingProvider,
  VoiceProvider,
} from './types.js';

// Sandbox implementations: behave like the real providers but send nothing outside.
// Every call is kept in `sandboxLog` so tests and the dashboard can show what would have happened.

export type SandboxEntry = { provider: string; action: string; payload: unknown; at: Date };
export const sandboxLog: SandboxEntry[] = [];

function log(provider: string, action: string, payload: unknown) {
  sandboxLog.push({ provider, action, payload, at: new Date() });
  if (sandboxLog.length > 500) sandboxLog.shift();
}

export const sandboxMessaging: MessagingProvider = {
  async sendText(input) {
    log('whatsapp', 'sendText', input);
    return { ok: true, providerMessageId: newId('wamid') };
  },
  async sendTemplate(input) {
    log('whatsapp', 'sendTemplate', input);
    return { ok: true, providerMessageId: newId('wamid') };
  },
};

export const sandboxEmail: EmailProvider = {
  async send(input) {
    log('email', 'send', input);
    return { ok: true, providerMessageId: newId('mail') };
  },
};

export const sandboxCalendar: CalendarProvider = {
  async freeBusy({ calendarIds }) {
    return Object.fromEntries(calendarIds.map((id) => [id, []]));
  },
  async createEvent(input) {
    log('calendar', 'createEvent', input);
    return { eventId: newId('cal') };
  },
  async cancelEvent(input) {
    log('calendar', 'cancelEvent', input);
  },
};

/** Without a real model the sandbox answers from the retrieved knowledge text only. */
export const sandboxLlm: LlmProvider = {
  async complete({ messages }) {
    const context = messages.find((m) => m.role === 'system')?.content ?? '';
    const facts = context.split('\nWISSEN:\n')[1]?.trim();
    if (!facts) return 'Vielen Dank für Ihre Nachricht. Ein Mitarbeiter meldet sich in Kürze bei Ihnen.';
    return `Gerne helfe ich Ihnen weiter. ${facts.split('\n')[0]}`;
  },
};

export const sandboxVoice: VoiceProvider = {
  async startOutboundCall(input) {
    log('voice', 'startOutboundCall', input);
    return { callId: newId('call') };
  },
};
