// Provider interfaces from the technology blueprint. BusinessPilot logic only talks to these,
// so fonio, 360dialog, Google, Microsoft, Brevo or the LLM vendor can be swapped later.

export type ProviderKey =
  | 'fonio'
  | 'whatsapp_360dialog'
  | 'google_calendar'
  | 'microsoft_365'
  | 'google_business'
  | 'brevo'
  | 'openai';

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: string };

export interface MessagingProvider {
  sendText(input: { to: string; text: string }): Promise<SendResult>;
  /** Messages outside the 24h service window must use an approved template. */
  sendTemplate(input: { to: string; template: string; variables: Record<string, string> }): Promise<SendResult>;
}

export interface EmailProvider {
  send(input: { to: string; subject: string; text: string }): Promise<SendResult>;
}

export type BusyInterval = { start: Date; end: Date };

export interface CalendarProvider {
  freeBusy(input: { calendarIds: string[]; from: Date; to: Date }): Promise<Record<string, BusyInterval[]>>;
  createEvent(input: { calendarId: string; title: string; start: Date; end: Date; description?: string }): Promise<{ eventId: string }>;
  cancelEvent(input: { calendarId: string; eventId: string }): Promise<void>;
}

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LlmProvider {
  complete(input: { messages: LlmMessage[]; maxTokens?: number }): Promise<string>;
}

export interface ReviewProvider {
  listReviews(input: { locationId: string }): Promise<{ id: string; rating: number; text: string; createdAt: Date }[]>;
}

export interface VoiceProvider {
  /** Outbound calls (e.g. reactivation). Inbound calls arrive via webhooks. */
  startOutboundCall(input: { to: string; assistantId: string; variables: Record<string, string> }): Promise<{ callId: string }>;
}
