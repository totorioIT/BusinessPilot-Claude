// Deutsche Bezeichnungen und Badge-Farben für API-Enums.

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'navy';

export const conversationStatus: Record<string, { label: string; tone: Tone }> = {
  ai_handling: { label: 'KI bearbeitet', tone: 'blue' },
  needs_staff: { label: 'Mitarbeiter nötig', tone: 'amber' },
  missed: { label: 'Verpasst', tone: 'red' },
  closed: { label: 'Abgeschlossen', tone: 'gray' },
};

export const channelLabel: Record<string, string> = {
  phone: 'Telefon',
  whatsapp: 'WhatsApp',
  webchat: 'Webchat',
  email: 'E-Mail',
  web: 'Website',
  manual: 'Manuell',
  sms: 'SMS',
};
export const channelShort: Record<string, string> = {
  phone: 'Tel',
  whatsapp: 'WA',
  webchat: 'Web',
  email: 'Mail',
};
export function labelChannel(c: string | null | undefined): string {
  if (!c) return '–';
  return channelLabel[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

export const appointmentStatus: Record<string, { label: string; tone: Tone }> = {
  booked: { label: 'Gebucht', tone: 'blue' },
  confirmed: { label: 'Bestätigt', tone: 'green' },
  completed: { label: 'Abgeschlossen', tone: 'gray' },
  cancelled: { label: 'Storniert', tone: 'red' },
  no_show: { label: 'Nicht erschienen', tone: 'amber' },
};

export const quoteStatus: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Entwurf', tone: 'gray' },
  missing_info: { label: 'Infos fehlen', tone: 'amber' },
  sent: { label: 'Versendet', tone: 'blue' },
  accepted: { label: 'Angenommen', tone: 'green' },
  rejected: { label: 'Abgelehnt', tone: 'red' },
};

export const taskPriority: Record<string, { label: string; tone: Tone }> = {
  low: { label: 'Niedrig', tone: 'gray' },
  normal: { label: 'Normal', tone: 'navy' },
  high: { label: 'Hoch', tone: 'amber' },
  urgent: { label: 'Dringend', tone: 'red' },
};
export const taskSource: Record<string, string> = {
  manual: 'Manuell',
  ai: 'KI-erstellt',
  automation: 'Automation',
};

export const reviewStatus: Record<string, { label: string; tone: Tone }> = {
  planned: { label: 'Geplant', tone: 'gray' },
  sent: { label: 'Gesendet', tone: 'blue' },
  clicked: { label: 'Link geöffnet', tone: 'green' },
  failed: { label: 'Fehlgeschlagen', tone: 'red' },
};

export const roleLabel: Record<string, string> = {
  owner: 'Inhaber',
  admin: 'Administrator',
  staff: 'Mitarbeiter',
};

export const sentimentLabel: Record<string, string> = {
  positive: 'Positiv',
  neutral: 'Neutral',
  negative: 'Negativ',
  mixed: 'Gemischt',
};

export const autonomyOptions = [
  { value: 'assist', title: 'Assistieren', text: 'Schlägt Antworten vor, Mitarbeiter senden.' },
  { value: 'semi', title: 'Halbautomatisch', text: 'Beantwortet einfache Anfragen selbst, übergibt den Rest.' },
  { value: 'autopilot', title: 'Autopilot', text: 'Führt definierte Abläufe eigenständig aus.' },
] as const;

export const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export const actorLabel: Record<string, string> = {
  user: 'Mitarbeiter',
  ai: 'KI',
  system: 'System',
  provider: 'Anbieter',
};
