import type { AutomationStep } from '../db/schema.js';

export type AutomationTemplate = { key: string; name: string; description: string; steps: AutomationStep[] };

// Templates from the product spec. The review template deliberately sends the Google link to
// every eligible customer; asking "were you happy?" first and only then linking is review gating,
// which Google prohibits.
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'missed_call',
    name: 'Verpasster Anruf',
    description: 'Verpasster Anruf → WhatsApp senden → Aufgabe für Mitarbeiter',
    steps: [
      { type: 'trigger', label: 'Anruf verpasst' },
      { type: 'wait', label: '2 Minuten warten', config: { minutes: 2 } },
      { type: 'action', label: 'WhatsApp senden: „Wie können wir helfen?“' },
      { type: 'action', label: 'Aufgabe für Mitarbeiter erstellen' },
    ],
  },
  {
    key: 'appointment_reminder',
    name: 'Terminerinnerung',
    description: 'Termin gebucht → 1 Tag vorher erinnern',
    steps: [
      { type: 'trigger', label: 'Termin gebucht' },
      { type: 'wait', label: '1 Tag vor Termin', config: { minutesBefore: 1440 } },
      { type: 'action', label: 'WhatsApp-Erinnerung senden' },
    ],
  },
  {
    key: 'review_request',
    name: 'Kundenbewertung',
    description: 'Auftrag abgeschlossen → warten → Google-Bewertungslink an jeden Kunden',
    steps: [
      { type: 'trigger', label: 'Termin abgeschlossen' },
      { type: 'wait', label: '2 Stunden warten', config: { minutes: 120 } },
      { type: 'action', label: 'Dank und Google-Bewertungslink senden' },
      { type: 'condition', label: 'Wenn Kunde Kritik schreibt' },
      { type: 'action', label: 'Aufgabe mit hoher Priorität erstellen' },
    ],
  },
  {
    key: 'quote_followup',
    name: 'Angebots-Nachfassen',
    description: 'Angebot versendet → 3 Tage warten → nachfassen → Aufgabe',
    steps: [
      { type: 'trigger', label: 'Angebot versendet' },
      { type: 'wait', label: '3 Tage warten', config: { minutes: 4320 } },
      { type: 'condition', label: 'Wenn keine Antwort' },
      { type: 'action', label: 'Freundliche WhatsApp-Nachfassung' },
      { type: 'wait', label: '4 Tage warten', config: { minutes: 5760 } },
      { type: 'action', label: 'Aufgabe für Vertrieb erstellen' },
    ],
  },
  {
    key: 'reactivation',
    name: 'Kunden-Reaktivierung',
    description: 'Keine Interaktion seit 6 Monaten → persönliche WhatsApp',
    steps: [
      { type: 'trigger', label: 'Keine Interaktion seit 6 Monaten' },
      { type: 'condition', label: 'Nur mit Marketing-Einwilligung' },
      { type: 'action', label: 'Personalisierte WhatsApp senden' },
      { type: 'condition', label: 'Wenn keine Reaktion' },
      { type: 'action', label: 'Aufgabe für Rückruf erstellen' },
    ],
  },
  {
    key: 'new_lead',
    name: 'Neuer Lead',
    description: 'Neue Anfrage → Lead anlegen → nächsten Schritt vorschlagen',
    steps: [
      { type: 'trigger', label: 'Neue Anfrage eingegangen' },
      { type: 'action', label: 'Lead anlegen' },
      { type: 'condition', label: 'Wenn Terminwunsch vorhanden' },
      { type: 'action', label: 'Termin per WhatsApp vorschlagen' },
    ],
  },
];

export const templateByKey = (key: string) => AUTOMATION_TEMPLATES.find((t) => t.key === key);
