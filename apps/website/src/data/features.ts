// Die 13 BusinessPilot-Bausteine mit Standard-Beispiel.
// Branchenseiten überschreiben das Beispiel über industry.featureExamples.

export type FeatureId =
  | 'website-chatbot'
  | 'whatsapp-ki'
  | 'telefon-ki'
  | 'ki-rezeption'
  | 'terminbuchung'
  | 'terminerinnerungen'
  | 'crm'
  | 'follow-up'
  | 'reaktivierung'
  | 'angebote'
  | 'bewertungen'
  | 'ki-mitarbeiter'
  | 'reporting';

export interface FeatureExample {
  /** Kundensatz (isQuote = true) oder auslösendes Ereignis */
  text: string;
  isQuote?: boolean;
  steps: string[];
  outcome?: string;
  /** Hinweis, wenn eine externe Anbindung nötig ist */
  integration?: string;
  /** Kennzeichnung als Beispielwerte */
  sample?: boolean;
}

export interface Feature {
  id: FeatureId;
  title: string;
  icon: string;
  description: string;
  example: FeatureExample;
}

export const features: Feature[] = [
  {
    id: 'website-chatbot',
    title: 'Website-Chatbot',
    icon: 'chat',
    description:
      'Beantwortet Fragen Ihrer Website-Besucher direkt und rund um die Uhr. Der Chatbot kann Interessenten qualifizieren, Kontaktdaten aufnehmen und direkt einen Termin oder Rückruf anstoßen.',
    example: {
      text: 'Was kostet eine Wartung?',
      isQuote: true,
      steps: ['Frage beantworten', 'Interesse erkennen', 'Termin anbieten'],
    },
  },
  {
    id: 'whatsapp-ki',
    title: 'WhatsApp-KI',
    icon: 'whatsapp',
    description:
      'Beantwortet Kundenanfragen automatisch über WhatsApp und führt Gespräche strukturiert weiter. Informationen, Rückfragen und Termine können direkt aus dem Chat verarbeitet werden.',
    example: {
      text: 'Habt ihr Donnerstag noch einen Termin?',
      isQuote: true,
      steps: ['Verfügbarkeit prüfen', 'Buchung', 'Bestätigung'],
    },
  },
  {
    id: 'telefon-ki',
    title: 'Telefon-KI',
    icon: 'phone',
    description:
      'Nimmt Anrufe entgegen, erkennt das Anliegen und startet direkt den passenden nächsten Schritt. Termine, Rückfragen oder Übergaben an Mitarbeiter können automatisch angestoßen werden.',
    example: {
      text: 'Ich brauche neue Bremsen.',
      isQuote: true,
      steps: ['Anliegen erkannt', 'Fahrzeugdaten', 'Termin'],
    },
  },
  {
    id: 'ki-rezeption',
    title: 'KI-Rezeption',
    icon: 'reception',
    description:
      'Die zentrale digitale Anlaufstelle für Ihre Kunden. BusinessPilot verbindet Website, WhatsApp und Telefon und startet abhängig vom Anliegen automatisch den passenden Prozess.',
    example: {
      text: 'Unsere Heizung ist ausgefallen.',
      isQuote: true,
      steps: ['Dringlichkeit erkannt', 'Informationen erfasst', 'Mitarbeiter informiert'],
    },
  },
  {
    id: 'terminbuchung',
    title: 'Terminbuchung',
    icon: 'calendar',
    description:
      'BusinessPilot prüft passende freie Termine und kann diese direkt mit dem Kunden vereinbaren. Änderungen oder Absagen lassen sich ebenfalls zentral organisieren.',
    example: {
      text: 'Ich kann nur Dienstagvormittag.',
      isQuote: true,
      steps: ['Verfügbarkeit prüfen', 'Dienstag, 10:30 Uhr anbieten', 'Buchung'],
    },
  },
  {
    id: 'terminerinnerungen',
    title: 'Terminerinnerungen',
    icon: 'bell',
    description:
      'Kunden werden automatisch an bevorstehende Termine erinnert. Das reduziert manuelle Rückfragen und die Wahrscheinlichkeit vergessener Termine.',
    example: {
      text: 'Termin morgen 10:30 Uhr',
      steps: ['Erinnerung senden', 'Bestätigung erhalten'],
    },
  },
  {
    id: 'crm',
    title: 'CRM / Customer 360',
    icon: 'users',
    description:
      'Alle wichtigen Informationen eines Kunden werden an einem Ort zusammengeführt. Anrufe, WhatsApp, Termine, Angebote und Aktivitäten ergeben eine vollständige Kundenhistorie.',
    example: {
      text: 'Max Müller',
      steps: ['Letzter Anruf', 'WhatsApp-Verlauf', 'Offenes Angebot', 'Nächster Termin'],
    },
  },
  {
    id: 'follow-up',
    title: 'Automatisches Follow-up',
    icon: 'followup',
    description:
      'Offene Anfragen und Angebote geraten nicht mehr in Vergessenheit. BusinessPilot kann nach definierten Regeln automatisch nachfassen oder den zuständigen Mitarbeiter erinnern.',
    example: {
      text: 'Angebot seit 3 Tagen offen',
      steps: ['Automatisch nachfassen', 'Kunde antwortet', 'Prozess läuft weiter'],
    },
  },
  {
    id: 'reaktivierung',
    title: 'Kundenreaktivierung',
    icon: 'reactivate',
    description:
      'BusinessPilot erkennt Kunden, bei denen längere Zeit kein Kontakt oder Auftrag mehr stattgefunden hat. Diese können gezielt wieder angesprochen werden.',
    example: {
      text: 'Letzter Termin vor 12 Wochen',
      steps: ['Kunde wird angeschrieben', 'Termin wird angeboten', 'Kunde reaktiviert'],
    },
  },
  {
    id: 'angebote',
    title: 'Angebotsprozesse',
    icon: 'quote',
    description:
      'BusinessPilot sammelt bereits während der Anfrage wichtige Informationen und bereitet einen strukturierten Angebotsvorgang vor. Offene Angebote können anschließend nachgefasst werden.',
    example: {
      text: 'Ich brauche ein Angebot für eine Wärmepumpe.',
      isQuote: true,
      steps: ['Anforderungen erfassen', 'Kundendaten aufnehmen', 'Angebot vorbereiten'],
    },
  },
  {
    id: 'bewertungen',
    title: 'Bewertungsautomation',
    icon: 'star',
    description:
      'Nach einem abgeschlossenen Termin oder Auftrag kann BusinessPilot automatisch nach Feedback fragen und eine Google-Bewertung anstoßen.',
    example: {
      text: 'Auftrag abgeschlossen',
      steps: ['Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'],
    },
  },
  {
    id: 'ki-mitarbeiter',
    title: 'KI-Mitarbeiter',
    icon: 'employee',
    description:
      'Legen Sie fest, wie Ihr digitaler Mitarbeiter kommuniziert und welche Aufgaben er selbstständig übernehmen darf. Sie bestimmen, wann ein echter Mitarbeiter übernehmen soll.',
    example: {
      text: 'Standardanfrage oder Preisverhandlung?',
      steps: ['Standardanfrage: BusinessPilot übernimmt', 'Preisverhandlung: Übergabe an Mitarbeiter'],
    },
  },
  {
    id: 'reporting',
    title: 'Reporting',
    icon: 'chart',
    description:
      'Sehen Sie auf einen Blick, was BusinessPilot für Ihr Unternehmen erledigt hat. Anrufe, Nachrichten, Termine, Leads und Automationen werden verständlich ausgewertet.',
    example: {
      text: 'Ihre Woche mit BusinessPilot',
      steps: ['37 Telefonate', '14 WhatsApp-Anfragen', '8 Termine', '3 Leads', '4 h 18 min geschätzte Zeitersparnis'],
      sample: true,
    },
  },
];
