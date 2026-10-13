// Branchen-Datenmodell. Jede Branchenseite (/branchen/[slug]) wird vollständig hieraus erzeugt.
import type { FeatureExample, FeatureId } from './features';
import type { PlanId } from './plans';

export const INTEGRATION = {
  branchensoftware: 'Mit angebundener Branchensoftware',
  verfuegbar: 'Bei verfügbarer Integration',
  werkstatt: 'Mit angebundener Werkstattsoftware',
  studio: 'Mit angebundener Studio-/Check-in-Software',
  warenwirtschaft: 'Mit angebundenem Warenwirtschafts- oder Shopsystem',
  reservierung: 'Mit angebundenem Reservierungssystem',
  kundendaten: 'Mit vorhandenen Kunden- und Fahrzeugdaten oder angebundener Werkstattsoftware',
  kalender: 'Mit angebundenem Termin-/Kassensystem',
} as const;

export interface CustomerRequest {
  text: string;
  /** Was BusinessPilot versteht */
  intent: string;
  /** Was BusinessPilot tut */
  steps: string[];
  /** Geschäftliches Ergebnis */
  outcome: string;
  integration?: string;
  /** Alternativer Ablauf, z. B. ohne Integration */
  alternative?: { label: string; steps: string[] };
  plan?: PlanId;
  note?: string;
}

export interface QuickExample {
  text: string;
  result: string;
}

export interface AutopilotFlow {
  title: string;
  steps: string[];
  outcome: string;
  integration?: string;
  message?: string;
}

export interface EconomicExample {
  title: string;
  lines: { label: string; value: string }[];
  result: { value: string; label: string };
  note?: string;
}

export interface Industry {
  slug: string;
  name: string;
  /** Zielgruppe im Plural, z. B. „Werkstätten“ */
  audience: string;
  icon: string;
  productPromise: string;
  autopilotPromise?: string;
  /** Satz, den der Besucher denken soll */
  visitorThought: string;
  heroTitle: string;
  heroSubtitle: string;
  cardTeaser: string;
  image: { src: string; alt: string };
  overlay: { caller: string; channel: 'Anruf' | 'WhatsApp' | 'Website-Chat'; text: string; checks: string[] };
  keyStatement?: string;
  customerRequests: CustomerRequest[];
  quickExamples: QuickExample[];
  autopilotFlows: AutopilotFlow[];
  featureExamples: Record<FeatureId, FeatureExample>;
  economicExample: EconomicExample;
  recommendedPlan: { business: string[]; autopilot: string[]; recommended: PlanId };
  reporting: { items: { value: string; label: string }[]; revenue: string; timeSaved: string };
  roiDefaults: { requests: number; missed: number; orderValue: number; conversion: number; days: number };
  cta: { title: string; text: string };
  seo: { title: string; description: string };
}

export const industries: Industry[] = [
  /* ------------------------------------------------------------------ WERKSTATT */
  {
    slug: 'werkstatt',
    audience: 'Werkstätten',
    name: 'Werkstatt',
    icon: 'wrench',
    productPromise: 'Der digitale Serviceberater für Ihre Werkstatt.',
    visitorThought: 'Das ist mein digitaler Serviceberater.',
    heroTitle: 'Der digitale Serviceberater für Ihre Werkstatt.',
    heroSubtitle:
      'BusinessPilot nimmt Anrufe und WhatsApp-Nachrichten an, erfasst Fahrzeug und Anliegen, bietet Termine an und fasst offene Angebote nach. Ihr Team bleibt in der Halle.',
    cardTeaser: 'Termine, Statusanfragen und Serviceanfragen automatisch annehmen.',
    image: { src: '/images/branchen/werkstatt.jpg', alt: 'Zwei Mechaniker arbeiten in einer Kfz-Werkstatt' },
    overlay: {
      caller: 'Max Müller',
      channel: 'Anruf',
      text: 'Ich brauche neue Bremsen.',
      checks: ['Kunde erkannt', 'Fahrzeug erfasst', 'Service erkannt', 'Termin angeboten'],
    },
    keyStatement: 'Während Ihr Team schraubt, nimmt BusinessPilot das Telefon an.',
    customerRequests: [
      {
        text: 'Ich brauche neue Bremsen.',
        intent: 'Reparaturauftrag: Bremsen',
        steps: [
          'Kunde erkennen oder neu anlegen',
          'Fahrzeugdaten erfassen',
          'Servicebedarf erkennen',
          'Termin prüfen',
          'Termin anbieten',
          'Bestätigung senden',
        ],
        outcome: 'Neuer Werkstattauftrag',
      },
      {
        text: 'Wann ist mein Auto fertig?',
        intent: 'Statusanfrage zu einem laufenden Auftrag',
        steps: ['Kunde identifizieren', 'Fahrzeug und Auftrag zuordnen', 'Status abrufen', 'Kunde informieren'],
        integration: INTEGRATION.werkstatt,
        alternative: {
          label: 'Ohne Anbindung',
          steps: ['Statusanfrage anlegen', 'Mitarbeiter benachrichtigen', 'Rückrufaufgabe erzeugen'],
        },
        outcome: 'Weniger wiederkehrende Statusanrufe',
      },
      {
        text: 'Was kostet ein Reifenwechsel?',
        intent: 'Preisanfrage Reifenservice',
        steps: [
          'Reifenservice erkannt',
          'Hinterlegte Preisinformationen prüfen',
          'Nötige Fahrzeugfragen stellen',
          'Freigegebene Preisinformation nennen',
          'Termin anbieten',
        ],
        outcome: 'Aus einer Preisfrage wird eine Buchungsmöglichkeit',
        note: 'BusinessPilot nennt nur Preise, die Sie selbst hinterlegt und freigegeben haben.',
      },
      {
        text: 'Ich brauche einen Termin.',
        intent: 'Terminwunsch',
        steps: [
          'Gewünschten Service erfragen',
          'Fahrzeugdaten aufnehmen',
          'Verfügbarkeit prüfen',
          'Termin anbieten',
          'Termin buchen',
          'Bestätigung per WhatsApp',
          'Erinnerung vor dem Termin',
        ],
        outcome: 'Werkstatttermin',
      },
      {
        text: 'Wann muss ich wieder zum TÜV?',
        intent: 'Frage zur nächsten Hauptuntersuchung',
        steps: ['Kunde zuordnen', 'Fahrzeug zuordnen', 'TÜV-Termin nennen', 'HU-Termin anbieten'],
        integration: INTEGRATION.kundendaten,
        outcome: 'Wiederkehrenden Umsatz aktivieren',
      },
      {
        text: 'Mein Auto springt nicht an.',
        intent: 'Dringende Anfrage',
        steps: [
          'Dringlichkeit erkennen',
          'Fahrzeuginformationen aufnehmen',
          'Standort erfragen, falls nötig',
          'Problem strukturiert erfassen',
          'Ihre Dringlichkeitsregeln anwenden',
          'Zuständigen Mitarbeiter benachrichtigen',
          'Rückruf- oder Notfallprozess starten',
        ],
        outcome: 'Dringende Anfrage richtig weitergeleitet',
        note: 'BusinessPilot leitet weiter und strukturiert. Eine Pannenhilfe leistet BusinessPilot nicht selbst.',
      },
    ],
    quickExamples: [
      { text: 'Meine Motorkontrollleuchte ist an.', result: 'Reparaturanfrage' },
      { text: 'Ich brauche vier neue Winterreifen.', result: 'Verkaufschance + Termin' },
      { text: 'Kann ich mein Auto morgen früh bringen?', result: 'Terminprüfung' },
      { text: 'Können Sie meine Klimaanlage warten?', result: 'Serviceanfrage' },
      { text: 'Wann kann ich mein Auto abholen?', result: 'Statusanfrage' },
      { text: 'Ich hatte letzte Woche ein Angebot von Ihnen.', result: 'Follow-up' },
      { text: 'Ich möchte meine Rechnung noch einmal haben.', result: 'Dokumenten-/Mitarbeiterprozess' },
    ],
    autopilotFlows: [
      {
        title: 'TÜV-Erinnerung',
        steps: ['TÜV in 30 Tagen', 'Automatische Kontaktaufnahme', 'Terminangebot', 'Buchung'],
        outcome: 'Wiederkehrenden Umsatz aktivieren',
        integration: INTEGRATION.kundendaten,
      },
      {
        title: 'Angebots-Follow-up',
        steps: ['Kostenvoranschlag seit 3 Tagen offen', 'Freundliche Nachfrage per WhatsApp', 'Rückfrage beantworten', 'Auftrag freigegeben'],
        outcome: 'Weniger liegengebliebene Angebote',
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Was kostet eine Inspektion für meinen Golf?', isQuote: true, steps: ['Fahrzeug und Service erfassen', 'Hinterlegte Preisinfo nennen', 'Termin anbieten'] },
      'whatsapp-ki': { text: 'Kann ich mein Auto morgen früh bringen?', isQuote: true, steps: ['Annahmekapazität prüfen', 'Uhrzeit anbieten', 'Bestätigung per WhatsApp'] },
      'telefon-ki': { text: 'Ich brauche neue Bremsen.', isQuote: true, steps: ['Anliegen erkannt', 'Fahrzeugdaten erfasst', 'Termin angeboten'] },
      'ki-rezeption': { text: 'Mein Auto springt nicht an.', isQuote: true, steps: ['Dringlichkeit erkannt', 'Fahrzeug und Standort erfasst', 'Mitarbeiter benachrichtigt'] },
      terminbuchung: { text: 'Ich kann nur Dienstagvormittag.', isQuote: true, steps: ['Hebebühnen-Kalender prüfen', 'Dienstag, 8:30 Uhr anbieten', 'Termin gebucht'] },
      terminerinnerungen: { text: 'Reifenwechsel morgen 8:00 Uhr', steps: ['Erinnerung mit Adresse senden', 'Kunde bestätigt'] },
      crm: { text: 'Max Müller · VW Golf', steps: ['Letzter Service: Inspektion', 'WhatsApp: Frage zu Reifen', 'Offenes Angebot: Bremsen', 'Nächster Termin: Di 8:30'] },
      'follow-up': { text: 'Kostenvoranschlag Bremsen seit 3 Tagen offen', steps: ['Nachricht an Kunden', 'Kunde gibt frei', 'Auftrag eingeplant'] },
      reaktivierung: { text: 'Letzte Inspektion vor 14 Monaten', steps: ['Kunde anschreiben', 'Inspektionstermin anbieten', 'Kunde reaktiviert'] },
      angebote: { text: 'Ich brauche vier neue Winterreifen.', isQuote: true, steps: ['Reifengröße und Fahrzeug erfassen', 'Wunsch zur Marke aufnehmen', 'Angebot vorbereiten'] },
      bewertungen: { text: 'Fahrzeug abgeholt', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Terminanfrage oder Reklamation?', steps: ['Terminanfrage: BusinessPilot übernimmt', 'Reklamation: Übergabe an Meister'] },
      reporting: { text: 'Ihre Werkstattwoche', steps: ['37 Telefonate', '8 Werkstatttermine', '2 Angebote nachgefasst', '4 h 18 min geschätzte Zeitersparnis'], sample: true },
    },
    economicExample: {
      title: 'Werkstattauftrag',
      lines: [
        { label: 'Durchschnittlicher Werkstattauftrag', value: '650 €' },
        { label: 'Verpasste Anfragen', value: '4' },
        { label: 'Rechnung', value: '4 × 650 €' },
      ],
      result: { value: '2.600 €', label: 'potenzielles Auftragsvolumen' },
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Digitaler Serviceberater am Telefon und per WhatsApp', 'Terminbuchung und Erinnerungen', 'Kundenhistorie mit Fahrzeugbezug'],
      autopilot: ['TÜV-Reaktivierung', 'Angebots-Follow-up', 'Kundenreaktivierung', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '37', label: 'Telefonate angenommen' },
        { value: '14', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '8', label: 'Werkstatttermine gebucht' },
        { value: '2', label: 'Termine verschoben' },
        { value: '3', label: 'Leads generiert' },
        { value: '2', label: 'Angebote vorbereitet' },
        { value: '7', label: 'Kunden reaktiviert' },
        { value: '5', label: 'Bewertungen angefragt' },
      ],
      revenue: '2.840 €',
      timeSaved: '4 h 18 min',
    },
    roiDefaults: { requests: 15, missed: 15, orderValue: 650, conversion: 35, days: 5 },
    cta: {
      title: 'Bereit für Ihren digitalen Serviceberater?',
      text: 'Wir zeigen Ihnen in einer kurzen Demo, wie BusinessPilot Anfragen in Ihrer Werkstatt annimmt und in Aufträge verwandelt.',
    },
    seo: {
      title: 'BusinessPilot für Werkstätten – Der digitale Serviceberater',
      description:
        'BusinessPilot nimmt Anrufe und WhatsApp-Anfragen Ihrer Werkstatt an, erfasst Fahrzeugdaten, bucht Termine und fasst Angebote nach. Weniger verpasste Aufträge.',
    },
  },

  /* ------------------------------------------------------------------ BEAUTY */
  {
    slug: 'beauty-kosmetik',
    audience: 'Kosmetikstudios',
    name: 'Beauty & Kosmetik',
    icon: 'sparkles',
    productPromise: 'Ihre digitale Rezeption.',
    visitorThought: 'Das ist meine digitale Rezeption.',
    heroTitle: 'Ihre digitale Rezeption für Beauty & Kosmetik.',
    heroSubtitle:
      'BusinessPilot beantwortet Fragen zu Behandlungen, bucht und verschiebt Termine und holt Stammkundinnen zurück, während Sie behandeln.',
    cardTeaser: 'Behandlungsfragen beantworten, Termine buchen, Kundinnen zurückholen.',
    image: { src: '/images/branchen/beauty-kosmetik.jpg', alt: 'Kosmetikerin in ihrem hellen Behandlungsraum' },
    overlay: {
      caller: 'Anna Schneider',
      channel: 'WhatsApp',
      text: 'Habt ihr Donnerstag noch einen Termin?',
      checks: ['Kundin erkannt', 'Behandlung erkannt', 'Freie Zeiten geprüft', 'Termin angeboten'],
    },
    keyStatement: 'Während Sie behandeln, kümmert sich BusinessPilot um Ihre Anfragen.',
    customerRequests: [
      {
        text: 'Was kostet Microneedling?',
        intent: 'Preis- und Behandlungsfrage',
        steps: ['Behandlung erkennen', 'Hinterlegte Preise und Dauer nennen', 'Häufige Fragen beantworten', 'Termin anbieten'],
        outcome: 'Aus einer Preisfrage wird eine Buchung',
        note: 'BusinessPilot nennt nur Preise, die Sie hinterlegt haben.',
      },
      {
        text: 'Habt ihr Donnerstag noch einen Termin?',
        intent: 'Terminwunsch',
        steps: ['Behandlung erfragen', 'Freie Zeiten am Donnerstag prüfen', 'Termine vorschlagen', 'Buchen und bestätigen'],
        outcome: 'Gebuchter Termin',
      },
      {
        text: 'Ich kann erst ab 16 Uhr.',
        intent: 'Zeitliche Einschränkung',
        steps: ['Nur Zeiten ab 16 Uhr berücksichtigen', 'Passende Termine vorschlagen', 'Buchung bestätigen'],
        outcome: 'Termin, der wirklich passt',
      },
      {
        text: 'Was passiert bei der ersten Behandlung?',
        intent: 'Beratungsfrage',
        steps: ['Ablauf aus Ihren Infos erklären', 'Vorbereitungshinweise geben', 'Erstberatung oder Termin anbieten'],
        outcome: 'Sichere Neukundin statt offener Frage',
      },
      {
        text: 'Kann ich meinen Termin verschieben?',
        intent: 'Terminänderung',
        steps: ['Kundin und Termin finden', 'Alternativen anbieten', 'Termin umbuchen', 'Freien Slot wieder anbieten'],
        outcome: 'Kein Ausfall, sondern ein verschobener Termin',
      },
    ],
    quickExamples: [
      { text: 'Macht ihr auch Wimpernlifting?', result: 'Leistungsfrage + Termin' },
      { text: 'Ich habe einen Gutschein bekommen.', result: 'Gutschein-Einlösung + Buchung' },
      { text: 'Ich bin heute 10 Minuten später.', result: 'Info ans Team' },
      { text: 'Welche Pflege empfehlt ihr danach?', result: 'Nachsorge-Info' },
    ],
    autopilotFlows: [
      {
        title: 'Kundinnen-Reaktivierung',
        steps: ['Bucht sonst alle 6–8 Wochen', 'Seit 12 Wochen kein Termin', 'Persönliche Nachricht', 'Neuer Termin'],
        message: 'Hallo Anna 👋 dein letzter Termin ist schon etwas her. Soll ich dir direkt wieder einen passenden Termin zeigen?',
        outcome: 'Kundin reaktiviert',
      },
      {
        title: 'Abgesagter Termin',
        steps: ['Termin abgesagt', 'Slot wird frei', 'Warteliste anschreiben', 'Slot wieder belegt'],
        outcome: 'Weniger Leerlauf im Kalender',
        integration: INTEGRATION.kalender,
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Was kostet Microneedling?', isQuote: true, steps: ['Hinterlegten Preis nennen', 'Ablauf kurz erklären', 'Termin anbieten'] },
      'whatsapp-ki': { text: 'Habt ihr Donnerstag noch einen Termin?', isQuote: true, steps: ['Verfügbarkeit prüfen', 'Buchung', 'Bestätigung'] },
      'telefon-ki': { text: 'Ich möchte eine Gesichtsbehandlung buchen.', isQuote: true, steps: ['Behandlung erkannt', 'Freie Zeiten genannt', 'Termin gebucht'] },
      'ki-rezeption': { text: 'Ich habe nach der Behandlung eine Rötung.', isQuote: true, steps: ['Anliegen als sensibel erkannt', 'Infos aufnehmen', 'Kosmetikerin informiert'] },
      terminbuchung: { text: 'Ich kann erst ab 16 Uhr.', isQuote: true, steps: ['Zeiten ab 16 Uhr prüfen', 'Mittwoch, 16:30 Uhr anbieten', 'Buchung'] },
      terminerinnerungen: { text: 'Microneedling morgen 16:30 Uhr', steps: ['Erinnerung mit Vorbereitungshinweis', 'Kundin bestätigt'] },
      crm: { text: 'Anna Schneider', steps: ['Letzte Behandlung: Microneedling', 'Hautbild-Notiz', 'Gutschein offen', 'Nächster Termin: Do 16:30'] },
      'follow-up': { text: 'Beratung ohne Buchung vor 2 Tagen', steps: ['Freundlich nachfassen', 'Kundin antwortet', 'Termin gebucht'] },
      reaktivierung: { text: 'Letzter Termin vor 12 Wochen', steps: ['Persönliche Nachricht', 'Termin anbieten', 'Kundin reaktiviert'] },
      angebote: { text: 'Was kostet ein Paket mit 3 Behandlungen?', isQuote: true, steps: ['Wunschbehandlung erfassen', 'Hinterlegte Paketpreise nennen', 'Paketangebot vorbereiten'] },
      bewertungen: { text: 'Behandlung abgeschlossen', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Terminfrage oder Hautreaktion?', steps: ['Terminfrage: BusinessPilot übernimmt', 'Hautreaktion: Übergabe an Kosmetikerin'] },
      reporting: { text: 'Ihre Studiowoche', steps: ['22 Anrufe', '31 WhatsApp-Anfragen', '19 Termine gebucht', '6 Kundinnen reaktiviert'], sample: true },
    },
    economicExample: {
      title: 'Behandlungstermin',
      lines: [
        { label: 'Durchschnittlicher Termin', value: '120 €' },
        { label: 'Unbesetzte Termine pro Woche', value: '3' },
        { label: 'Rechnung', value: '3 × 120 € × 4 Wochen' },
      ],
      result: { value: '1.440 €', label: 'potenzielles Monatsvolumen' },
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Digitale Rezeption für Telefon, WhatsApp und Website', 'Terminbuchung und Erinnerungen', 'Bewertungen nach der Behandlung'],
      autopilot: ['Kundinnen-Reaktivierung', 'Workflows für abgesagte Termine', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '22', label: 'Telefonate angenommen' },
        { value: '31', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '19', label: 'Termine gebucht' },
        { value: '4', label: 'Termine verschoben' },
        { value: '5', label: 'Neukundinnen gewonnen' },
        { value: '2', label: 'Paketangebote vorbereitet' },
        { value: '6', label: 'Kundinnen reaktiviert' },
        { value: '9', label: 'Bewertungen angefragt' },
      ],
      revenue: '1.920 €',
      timeSaved: '5 h 05 min',
    },
    roiDefaults: { requests: 12, missed: 20, orderValue: 120, conversion: 55, days: 5 },
    cta: {
      title: 'Bereit für Ihre digitale Rezeption?',
      text: 'In einer kurzen Demo zeigen wir Ihnen, wie BusinessPilot Termine bucht, Fragen beantwortet und Kundinnen zurückholt.',
    },
    seo: {
      title: 'BusinessPilot für Kosmetikstudios – Ihre digitale Rezeption',
      description:
        'BusinessPilot beantwortet Behandlungsfragen, bucht und verschiebt Termine und reaktiviert Stammkundinnen. Die digitale Rezeption für Beauty- und Kosmetikstudios.',
    },
  },

  /* ------------------------------------------------------------------ FITNESS */
  {
    slug: 'fitnessstudio',
    audience: 'Fitnessstudios',
    name: 'Fitnessstudio',
    icon: 'dumbbell',
    productPromise: 'Ihr digitaler Studioassistent.',
    autopilotPromise: 'Ihr digitaler Retention-Agent.',
    visitorThought: 'Das ist mein digitaler Studioassistent.',
    heroTitle: 'Ihr digitaler Studioassistent.',
    heroSubtitle:
      'BusinessPilot beantwortet Fragen zu Mitgliedschaften, bucht Probetrainings, fasst bei Interessenten nach und hilft, Mitglieder zu halten.',
    cardTeaser: 'Probetrainings buchen, Interessenten nachfassen, Mitglieder halten.',
    image: { src: '/images/branchen/fitnessstudio.jpg', alt: 'Mitglied trainiert an einem Gerät im Fitnessstudio' },
    overlay: {
      caller: 'Lena Hoffmann',
      channel: 'Website-Chat',
      text: 'Ich möchte ein Probetraining machen.',
      checks: ['Interessentin erfasst', 'Trainingsziel erkannt', 'Freie Zeiten geprüft', 'Probetraining gebucht'],
    },
    customerRequests: [
      {
        text: 'Ich möchte ein Probetraining machen.',
        intent: 'Neuer Interessent',
        steps: ['Kontaktdaten erfassen', 'Trainingsziel erfragen', 'Freie Zeiten anbieten', 'Probetraining buchen', 'Erinnerung senden'],
        outcome: 'Neuer Lead mit Termin',
      },
      {
        text: 'Was kostet die Mitgliedschaft?',
        intent: 'Preisfrage',
        steps: ['Hinterlegte Tarife nennen', 'Passenden Tarif zum Ziel empfehlen', 'Probetraining anbieten'],
        outcome: 'Aus der Preisfrage wird ein Probetraining',
        note: 'BusinessPilot nennt nur Tarife, die Sie hinterlegt haben.',
      },
      {
        text: 'Kann ich heute Abend noch zum Probetraining kommen?',
        intent: 'Kurzfristiger Terminwunsch',
        steps: ['Heutige Kapazität prüfen', 'Freie Zeit anbieten', 'Buchen', 'Trainer informieren'],
        outcome: 'Probetraining noch am selben Tag',
      },
      {
        text: 'Ich möchte meinen Termin verschieben.',
        intent: 'Terminänderung',
        steps: ['Termin finden', 'Alternativen anbieten', 'Umbuchen', 'Bestätigung senden'],
        outcome: 'Interessent bleibt im Prozess',
      },
    ],
    quickExamples: [
      { text: 'Habt ihr auch Kurse am Wochenende?', result: 'Kursplan-Info' },
      { text: 'Kann ich meinen Vertrag pausieren?', result: 'Übergabe an Mitarbeiter' },
      { text: 'Gibt es einen Studententarif?', result: 'Tarif-Info + Probetraining' },
      { text: 'Wie lange habt ihr heute offen?', result: 'Öffnungszeiten' },
    ],
    autopilotFlows: [
      {
        title: 'Probetraining-Follow-up',
        steps: ['Probetraining', 'Kein Abschluss', 'Follow-up nach 24 h', 'Neue Abschlusschance'],
        outcome: 'Mehr Abschlüsse aus Probetrainings',
      },
      {
        title: 'Retention',
        steps: ['Mitglied seit 14 Tagen nicht eingecheckt', 'Reaktivierungs-Workflow', 'Persönliche Nachricht'],
        outcome: 'Mitglied bleibt aktiv',
        integration: INTEGRATION.studio,
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Was kostet die Mitgliedschaft?', isQuote: true, steps: ['Tarife nennen', 'Ziel erfragen', 'Probetraining anbieten'] },
      'whatsapp-ki': { text: 'Kann ich heute Abend noch zum Probetraining kommen?', isQuote: true, steps: ['Kapazität prüfen', 'Buchung', 'Bestätigung'] },
      'telefon-ki': { text: 'Ich möchte mich anmelden.', isQuote: true, steps: ['Interesse erkannt', 'Kontaktdaten erfasst', 'Probetraining oder Beratung gebucht'] },
      'ki-rezeption': { text: 'Ich möchte meinen Vertrag kündigen.', isQuote: true, steps: ['Anliegen erkannt', 'Daten aufnehmen', 'Studioleitung informiert'] },
      terminbuchung: { text: 'Ich kann nur morgens vor der Arbeit.', isQuote: true, steps: ['Frühe Zeiten prüfen', 'Mittwoch, 7:00 Uhr anbieten', 'Buchung'] },
      terminerinnerungen: { text: 'Probetraining morgen 18:00 Uhr', steps: ['Erinnerung mit Packliste', 'Interessent bestätigt'] },
      crm: { text: 'Lena Hoffmann', steps: ['Probetraining am Montag', 'Ziel: Rücken stärken', 'Tarifanfrage per WhatsApp', 'Follow-up geplant'] },
      'follow-up': { text: 'Probetraining ohne Abschluss', steps: ['Nachricht nach 24 h', 'Fragen beantworten', 'Mitgliedschaft abgeschlossen'] },
      reaktivierung: { text: 'Mitglied seit 14 Tagen nicht eingecheckt', steps: ['Persönliche Nachricht', 'Trainingstermin anbieten', 'Mitglied wieder aktiv'], integration: INTEGRATION.studio },
      angebote: { text: 'Habt ihr ein Firmenangebot für 10 Mitarbeiter?', isQuote: true, steps: ['Firma und Bedarf erfassen', 'Ansprechpartner aufnehmen', 'Firmenangebot vorbereiten'] },
      bewertungen: { text: 'Erste 4 Wochen Mitgliedschaft', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Tariffrage oder Kündigung?', steps: ['Tariffrage: BusinessPilot übernimmt', 'Kündigung: Übergabe an Studioleitung'] },
      reporting: { text: 'Ihre Studiowoche', steps: ['18 Probetrainings gebucht', '11 Follow-ups', '6 neue Mitglieder', '9 Mitglieder reaktiviert'], sample: true },
    },
    economicExample: {
      title: 'Mitgliedschaft',
      lines: [
        { label: 'Mitgliedschaft', value: '49 € / Monat' },
        { label: 'Wert über 12 Monate', value: '588 €' },
        { label: 'Nicht nachgefasste Probetrainings', value: '5' },
        { label: 'Rechnung', value: '5 × 588 €' },
      ],
      result: { value: '2.940 €', label: 'potenzieller Mitgliedschaftswert' },
    },
    recommendedPlan: {
      recommended: 'AUTOPILOT',
      business: ['Kommunikation über Telefon, WhatsApp und Website', 'Buchung und Erinnerung für Probetrainings', 'Interessenten im CRM'],
      autopilot: ['Retention-Workflows für inaktive Mitglieder', 'Automatisches Lead-Follow-up nach dem Probetraining', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '24', label: 'Telefonate angenommen' },
        { value: '29', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '18', label: 'Probetrainings gebucht' },
        { value: '3', label: 'Termine verschoben' },
        { value: '21', label: 'Leads generiert' },
        { value: '11', label: 'Follow-ups gesendet' },
        { value: '9', label: 'Mitglieder reaktiviert' },
        { value: '4', label: 'Bewertungen angefragt' },
      ],
      revenue: '2.350 €',
      timeSaved: '4 h 40 min',
    },
    roiDefaults: { requests: 10, missed: 25, orderValue: 588, conversion: 30, days: 6 },
    cta: {
      title: 'Bereit für Ihren digitalen Studioassistenten?',
      text: 'Wir zeigen Ihnen, wie BusinessPilot Probetrainings bucht, nachfasst und Mitglieder aktiv hält.',
    },
    seo: {
      title: 'BusinessPilot für Fitnessstudios – Ihr digitaler Studioassistent',
      description:
        'BusinessPilot bucht Probetrainings, beantwortet Tariffragen, fasst bei Interessenten nach und hilft, inaktive Mitglieder zurückzugewinnen.',
    },
  },

  /* ------------------------------------------------------------------ HANDWERK */
  {
    slug: 'handwerk',
    audience: 'Handwerksbetriebe',
    name: 'Handwerk',
    icon: 'hammer',
    productPromise: 'Das digitale Büro für Ihren Handwerksbetrieb.',
    visitorThought: 'Das ist mein digitales Büro.',
    heroTitle: 'Das digitale Büro für Ihren Handwerksbetrieb.',
    heroSubtitle:
      'BusinessPilot nimmt Anrufe an, erkennt Notfälle, plant Wartungstermine und bereitet Angebotsanfragen vor. Sie bleiben auf der Baustelle.',
    cardTeaser: 'Anrufe annehmen, Notfälle erkennen, Angebote vorbereiten.',
    image: { src: '/images/branchen/handwerk.jpg', alt: 'Handwerker bearbeitet Holz an einer Maschine in seiner Werkstatt' },
    overlay: {
      caller: 'Familie Weber',
      channel: 'Anruf',
      text: 'Unsere Heizung ist ausgefallen.',
      checks: ['Notfall erkannt', 'Adresse erfasst', 'Anlage erfasst', 'Monteur benachrichtigt'],
    },
    keyStatement: 'Während Sie arbeiten, kümmert sich BusinessPilot um das Telefon.',
    customerRequests: [
      {
        text: 'Unsere Heizung ist ausgefallen.',
        intent: 'Notfall',
        steps: ['Dringlichkeit erkennen', 'Adresse und Anlage erfassen', 'Ihre Notfallregeln anwenden', 'Bereitschaft benachrichtigen', 'Kunde über nächsten Schritt informieren'],
        outcome: 'Notfall richtig weitergeleitet',
      },
      {
        text: 'Wann kommt Ihr Monteur?',
        intent: 'Statusanfrage zum Einsatz',
        steps: ['Kunde identifizieren', 'Einsatz zuordnen', 'Geplantes Zeitfenster nennen'],
        integration: INTEGRATION.branchensoftware,
        alternative: { label: 'Ohne Anbindung', steps: ['Anfrage erfassen', 'Disposition benachrichtigen', 'Rückruf einplanen'] },
        outcome: 'Weniger Rückfragen im Büro',
      },
      {
        text: 'Ich brauche ein Angebot für eine Wärmepumpe.',
        intent: 'Angebotsanfrage',
        steps: ['Objektdaten erfassen', 'Heizsystem und Fläche aufnehmen', 'Kontaktdaten aufnehmen', 'Vor-Ort-Termin anbieten', 'Angebotsvorgang vorbereiten'],
        outcome: 'Strukturierte Projektanfrage',
      },
      {
        text: 'Können Sie nächste Woche unsere Heizung warten?',
        intent: 'Wartungstermin',
        steps: ['Anlage erfassen', 'Verfügbarkeit nächste Woche prüfen', 'Termin anbieten', 'Buchen und bestätigen'],
        outcome: 'Wartungsauftrag',
      },
      {
        text: 'Wir haben einen Wasserschaden.',
        intent: 'Dringende Anfrage',
        steps: ['Dringlichkeit erkennen', 'Schadensort und Umfang erfassen', 'Zuständigen Mitarbeiter benachrichtigen', 'Rückruf auslösen'],
        outcome: 'Dringender Auftrag gesichert',
      },
      {
        text: 'Was kostet eine Wartung?',
        intent: 'Preisanfrage',
        steps: ['Anlagentyp erfragen', 'Hinterlegte Preisinformation nennen', 'Termin anbieten'],
        outcome: 'Aus der Preisfrage wird ein Wartungstermin',
        note: 'BusinessPilot nennt nur Preise, die Sie hinterlegt haben.',
      },
    ],
    quickExamples: [
      { text: 'Die Steckdose in der Küche funktioniert nicht.', result: 'Reparaturanfrage' },
      { text: 'Haben Sie mein Angebot schon fertig?', result: 'Statusanfrage' },
      { text: 'Können Sie auch Badsanierungen?', result: 'Projektanfrage' },
      { text: 'Ich brauche eine Rechnungskopie.', result: 'Büroprozess' },
    ],
    autopilotFlows: [
      {
        title: 'Angebots-Follow-up',
        steps: ['Angebot seit 5 Tagen offen', 'Freundliche Nachfrage', 'Offene Fragen klären', 'Auftrag erteilt'],
        outcome: 'Mehr Aufträge aus vorhandenen Angeboten',
      },
      {
        title: 'Wartungs-Reaktivierung',
        steps: ['Letzte Wartung vor 11 Monaten', 'Automatische Erinnerung', 'Wartungstermin buchen'],
        outcome: 'Planbare wiederkehrende Aufträge',
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Was kostet eine Wartung?', isQuote: true, steps: ['Anlagentyp erfragen', 'Preisinfo nennen', 'Termin anbieten'] },
      'whatsapp-ki': { text: 'Können Sie nächste Woche unsere Heizung warten?', isQuote: true, steps: ['Verfügbarkeit prüfen', 'Buchung', 'Bestätigung'] },
      'telefon-ki': { text: 'Unsere Heizung ist ausgefallen.', isQuote: true, steps: ['Notfall erkannt', 'Adresse erfasst', 'Bereitschaft informiert'] },
      'ki-rezeption': { text: 'Wir haben einen Wasserschaden.', isQuote: true, steps: ['Dringlichkeit erkannt', 'Schaden erfasst', 'Mitarbeiter informiert'] },
      terminbuchung: { text: 'Ich bin nur Freitagnachmittag zu Hause.', isQuote: true, steps: ['Tourenplan prüfen', 'Freitag, 14:00 Uhr anbieten', 'Buchung'] },
      terminerinnerungen: { text: 'Wartung morgen 8:00–10:00 Uhr', steps: ['Erinnerung mit Zeitfenster', 'Kunde bestätigt Anwesenheit'] },
      crm: { text: 'Familie Weber', steps: ['Anlage: Gasbrennwert, Bj. 2012', 'Letzte Wartung: Oktober', 'Angebot Wärmepumpe offen', 'Nächster Termin: Fr 14:00'] },
      'follow-up': { text: 'Angebot Badsanierung seit 5 Tagen offen', steps: ['Nachfassen', 'Kunde hat Rückfrage', 'Rückruf vom Meister geplant'] },
      reaktivierung: { text: 'Letzte Wartung vor 11 Monaten', steps: ['Erinnerung senden', 'Wartungstermin anbieten', 'Kunde bucht'] },
      angebote: { text: 'Ich brauche ein Angebot für eine Wärmepumpe.', isQuote: true, steps: ['Anforderungen erfassen', 'Kundendaten aufnehmen', 'Angebot vorbereiten'] },
      bewertungen: { text: 'Auftrag abgeschlossen', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Wartungstermin oder Preisverhandlung?', steps: ['Wartungstermin: BusinessPilot übernimmt', 'Preisverhandlung: Übergabe an Chef'] },
      reporting: { text: 'Ihre Woche im Betrieb', steps: ['41 Telefonate', '3 Notfälle weitergeleitet', '4 Angebote vorbereitet', '5 h 10 min geschätzte Zeitersparnis'], sample: true },
    },
    economicExample: {
      title: 'Wartungsauftrag',
      lines: [
        { label: 'Wartungsauftrag', value: '300 €' },
        { label: 'Verpasste Serviceanfragen', value: '5' },
        { label: 'Rechnung', value: '5 × 300 €' },
      ],
      result: { value: '1.500 €', label: 'potenzielles Auftragsvolumen' },
      note: 'Schon eine einzige verpasste Angebotsanfrage, etwa für eine Wärmepumpe oder ein Bad, kann einem deutlich höheren Projektwert entsprechen.',
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Telefon-KI und WhatsApp', 'CRM mit Anlagen- und Kundenhistorie', 'Terminbuchung und Erinnerungen'],
      autopilot: ['Angebots-Follow-up', 'Wartungs- und Kundenreaktivierung', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '41', label: 'Telefonate angenommen' },
        { value: '12', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '9', label: 'Termine gebucht' },
        { value: '2', label: 'Termine verschoben' },
        { value: '6', label: 'Leads generiert' },
        { value: '4', label: 'Angebote vorbereitet' },
        { value: '5', label: 'Kunden reaktiviert' },
        { value: '6', label: 'Bewertungen angefragt' },
      ],
      revenue: '3.100 €',
      timeSaved: '5 h 10 min',
    },
    roiDefaults: { requests: 12, missed: 25, orderValue: 300, conversion: 45, days: 5 },
    cta: {
      title: 'Bereit für Ihr digitales Büro?',
      text: 'Wir zeigen Ihnen, wie BusinessPilot Ihr Telefon übernimmt, Notfälle erkennt und Angebotsanfragen vorbereitet.',
    },
    seo: {
      title: 'BusinessPilot für Handwerksbetriebe – Das digitale Büro',
      description:
        'BusinessPilot nimmt Anrufe Ihres Handwerksbetriebs an, erkennt Notfälle, plant Wartungen und bereitet Angebotsanfragen vor. Während Sie arbeiten.',
    },
  },

  /* ------------------------------------------------------------------ HANDEL */
  {
    slug: 'handel',
    audience: 'Händler',
    name: 'Handel',
    icon: 'bag',
    productPromise: 'Ihr digitaler Kundenberater.',
    visitorThought: 'Das ist mein digitaler Kundenberater.',
    heroTitle: 'Ihr digitaler Kundenberater für den Handel.',
    heroSubtitle:
      'BusinessPilot beantwortet Fragen zu Produkten, Verfügbarkeit und Öffnungszeiten, nimmt Reservierungen auf und informiert Kunden, sobald Ware wieder da ist.',
    cardTeaser: 'Produktfragen beantworten, reservieren, Kunden informieren.',
    image: { src: '/images/branchen/handel.jpg', alt: 'Beleuchtetes Modegeschäft mit offenem Eingang' },
    overlay: {
      caller: 'Julia Becker',
      channel: 'WhatsApp',
      text: 'Kann ich es bis morgen reservieren?',
      checks: ['Kundin erkannt', 'Produkt erkannt', 'Reservierung erfasst', 'Bestätigung gesendet'],
    },
    customerRequests: [
      {
        text: 'Ist das Produkt noch verfügbar?',
        intent: 'Verfügbarkeitsanfrage',
        steps: ['Produkt erkennen', 'Bestand prüfen', 'Verfügbarkeit nennen', 'Reservierung anbieten'],
        integration: INTEGRATION.warenwirtschaft,
        alternative: { label: 'Ohne Anbindung', steps: ['Anfrage erfassen', 'Mitarbeiter benachrichtigen', 'Kunde erhält Rückmeldung'] },
        outcome: 'Kaufinteresse gesichert',
      },
      {
        text: 'Kann ich es bis morgen reservieren?',
        intent: 'Reservierungswunsch',
        steps: ['Produkt und Variante erfassen', 'Kontaktdaten aufnehmen', 'Reservierung an das Team übergeben', 'Bestätigung senden'],
        outcome: 'Reservierter Verkauf',
      },
      {
        text: 'Wo ist meine Bestellung?',
        intent: 'Bestellstatus',
        steps: ['Bestellung zuordnen', 'Versandstatus abrufen', 'Kunde informieren'],
        integration: INTEGRATION.warenwirtschaft,
        alternative: { label: 'Ohne Anbindung', steps: ['Bestellnummer aufnehmen', 'Team benachrichtigen', 'Rückmeldung zusagen'] },
        outcome: 'Weniger Statusanfragen',
      },
      {
        text: 'Welche Größe haben Sie noch?',
        intent: 'Größen- und Variantenfrage',
        steps: ['Artikel erkennen', 'Verfügbare Größen prüfen', 'Größen nennen', 'Reservierung anbieten'],
        integration: INTEGRATION.warenwirtschaft,
        outcome: 'Beratung wie im Laden',
      },
      {
        text: 'Wann haben Sie geöffnet?',
        intent: 'Allgemeine Information',
        steps: ['Öffnungszeiten nennen', 'Besondere Zeiten berücksichtigen', 'Anfahrt anbieten'],
        outcome: 'Kunde kommt vorbei',
      },
      {
        text: 'Können Sie mich informieren, wenn es wieder verfügbar ist?',
        intent: 'Benachrichtigungswunsch',
        steps: ['Produkt und Kontakt erfassen', 'Auf Wareneingang warten', 'Kunde automatisch informieren', 'Reservierung anbieten'],
        integration: INTEGRATION.warenwirtschaft,
        outcome: 'Verkauf statt verlorener Kunde',
      },
    ],
    quickExamples: [
      { text: 'Kann ich das umtauschen?', result: 'Info zu Umtauschregeln' },
      { text: 'Haben Sie Gutscheine?', result: 'Verkaufschance' },
      { text: 'Gibt es Parkplätze?', result: 'Anfahrts-Info' },
      { text: 'Können Sie das liefern?', result: 'Liefer-Anfrage' },
    ],
    autopilotFlows: [
      {
        title: 'Wieder verfügbar',
        steps: ['Ware eingetroffen', 'Wartende Kunden informieren', 'Reservierung anbieten', 'Verkauf'],
        outcome: 'Nachfrage wird zu Umsatz',
        integration: INTEGRATION.warenwirtschaft,
      },
      {
        title: 'Stammkunden-Reaktivierung',
        steps: ['Seit 6 Monaten kein Kauf', 'Persönliche Nachricht zur neuen Kollektion', 'Besuch oder Reservierung'],
        outcome: 'Stammkunden kommen zurück',
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Ist das Produkt noch verfügbar?', isQuote: true, steps: ['Produkt erkennen', 'Bestand prüfen', 'Reservierung anbieten'], integration: INTEGRATION.warenwirtschaft },
      'whatsapp-ki': { text: 'Kann ich es bis morgen reservieren?', isQuote: true, steps: ['Produkt erfassen', 'Reservierung anlegen', 'Bestätigung'] },
      'telefon-ki': { text: 'Wann haben Sie geöffnet?', isQuote: true, steps: ['Öffnungszeiten genannt', 'Weitere Fragen geklärt', 'Besuch angekündigt'] },
      'ki-rezeption': { text: 'Mein Artikel ist beschädigt angekommen.', isQuote: true, steps: ['Reklamation erkannt', 'Fotos und Bestellung erfassen', 'Mitarbeiter informiert'] },
      terminbuchung: { text: 'Ich hätte gern eine Beratung am Samstag.', isQuote: true, steps: ['Beratungszeiten prüfen', 'Samstag, 11:00 Uhr anbieten', 'Buchung'] },
      terminerinnerungen: { text: 'Abholung reservierter Ware morgen', steps: ['Erinnerung senden', 'Kunde bestätigt Abholung'] },
      crm: { text: 'Julia Becker', steps: ['Letzter Kauf: Winterjacke', 'Reservierung: Schuhe Gr. 39', 'WhatsApp-Verlauf', 'Wunschliste'] },
      'follow-up': { text: 'Reservierung nicht abgeholt', steps: ['Kunde erinnern', 'Neuen Abholtermin vereinbaren', 'Verkauf abgeschlossen'] },
      reaktivierung: { text: 'Seit 6 Monaten kein Kauf', steps: ['Nachricht zur neuen Kollektion', 'Besuch anbieten', 'Kunde reaktiviert'] },
      angebote: { text: 'Wir brauchen 30 Stück für unsere Firma.', isQuote: true, steps: ['Menge und Artikel erfassen', 'Firmendaten aufnehmen', 'Angebot vorbereiten'] },
      bewertungen: { text: 'Kauf abgeschlossen', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Produktfrage oder Reklamation?', steps: ['Produktfrage: BusinessPilot übernimmt', 'Reklamation: Übergabe an Filialleitung'] },
      reporting: { text: 'Ihre Woche im Geschäft', steps: ['28 Anrufe', '36 WhatsApp-Anfragen', '12 Reservierungen', '3 h 50 min geschätzte Zeitersparnis'], sample: true },
    },
    economicExample: {
      title: 'Verkauf im Geschäft',
      lines: [
        { label: 'Durchschnittlicher Einkauf', value: '85 €' },
        { label: 'Unbeantwortete Kaufanfragen pro Woche', value: '6' },
        { label: 'Rechnung', value: '6 × 85 € × 4 Wochen' },
      ],
      result: { value: '2.040 €', label: 'potenzielles Monatsvolumen' },
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Digitaler Kundenberater per Telefon, WhatsApp und Website', 'Reservierungen und Abholerinnerungen', 'Kundenhistorie im CRM'],
      autopilot: ['Benachrichtigung bei Wiederverfügbarkeit', 'Stammkunden-Reaktivierung', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '28', label: 'Telefonate angenommen' },
        { value: '36', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '12', label: 'Reservierungen erfasst' },
        { value: '3', label: 'Abholungen verschoben' },
        { value: '7', label: 'Leads generiert' },
        { value: '1', label: 'Firmenangebot vorbereitet' },
        { value: '8', label: 'Kunden reaktiviert' },
        { value: '6', label: 'Bewertungen angefragt' },
      ],
      revenue: '1.760 €',
      timeSaved: '3 h 50 min',
    },
    roiDefaults: { requests: 20, missed: 15, orderValue: 85, conversion: 40, days: 6 },
    cta: {
      title: 'Bereit für Ihren digitalen Kundenberater?',
      text: 'Wir zeigen Ihnen, wie BusinessPilot Kundenfragen beantwortet, Ware reserviert und Kunden zurück in Ihr Geschäft holt.',
    },
    seo: {
      title: 'BusinessPilot für den Handel – Ihr digitaler Kundenberater',
      description:
        'BusinessPilot beantwortet Fragen zu Produkten, Verfügbarkeit und Öffnungszeiten, nimmt Reservierungen auf und informiert Kunden bei Wiederverfügbarkeit.',
    },
  },

  /* ------------------------------------------------------------------ FRISEUR */
  {
    slug: 'friseur',
    audience: 'Friseursalons',
    name: 'Friseur',
    icon: 'scissors',
    productPromise: 'Ihre digitale Rezeption.',
    visitorThought: 'Das ist meine digitale Rezeption.',
    heroTitle: 'Ihre digitale Rezeption für den Salon.',
    heroSubtitle:
      'BusinessPilot bucht, verschiebt und vergibt Termine neu, auch wenn gerade alle Hände voll zu tun haben. Kein Klingeln mehr mitten im Färben.',
    cardTeaser: 'Termine buchen, Absagen neu vergeben, Lücken füllen.',
    image: { src: '/images/branchen/friseur.jpg', alt: 'Friseur schneidet einem Kunden die Haare' },
    overlay: {
      caller: 'Sophie Klein',
      channel: 'WhatsApp',
      text: 'Habt ihr Freitag noch einen Termin für Balayage?',
      checks: ['Kundin erkannt', 'Balayage erkannt (ca. 3 h)', 'Freie Zeiten geprüft', 'Termin angeboten'],
    },
    keyStatement: 'Während Sie schneiden und färben, nimmt BusinessPilot die Termine an.',
    customerRequests: [
      {
        text: 'Habt ihr Freitag noch einen Termin für Balayage?',
        intent: 'Terminwunsch mit Leistung',
        steps: ['Leistung und Dauer erkennen', 'Freie Zeiten am Freitag prüfen', 'Passende Stylistin wählen', 'Termin anbieten und buchen'],
        outcome: 'Gebuchter Färbetermin',
      },
      {
        text: 'Ich muss morgen absagen.',
        intent: 'Absage',
        steps: ['Termin finden', 'Absage bestätigen', 'Neuen Termin anbieten', 'Freien Slot wieder anbieten'],
        outcome: 'Slot wird neu vergeben statt leer zu bleiben',
      },
      {
        text: 'Habt ihr heute spontan noch etwas frei?',
        intent: 'Kurzfristige Anfrage',
        steps: ['Heutige Lücken prüfen', 'Leistung erfragen', 'Freie Zeit anbieten', 'Buchen'],
        outcome: 'Lücke im Kalender gefüllt',
      },
      {
        text: 'Ich möchte wieder denselben Termin wie letztes Mal.',
        intent: 'Wiederholungstermin',
        steps: ['Letzten Termin finden', 'Leistung und Stylistin übernehmen', 'Gleichen Wochentag prüfen', 'Buchen'],
        integration: INTEGRATION.kalender,
        outcome: 'Stammkundin in Sekunden gebucht',
      },
    ],
    quickExamples: [
      { text: 'Was kostet ein Herrenschnitt?', result: 'Preisinfo + Termin' },
      { text: 'Macht ihr auch Hochsteckfrisuren für Hochzeiten?', result: 'Anfrage + Beratungstermin' },
      { text: 'Kann ich bei Lisa buchen?', result: 'Buchung bei Wunsch-Stylistin' },
      { text: 'Ich komme 10 Minuten später.', result: 'Info ans Team' },
    ],
    autopilotFlows: [
      {
        title: 'Absage-Workflow',
        steps: ['Termin abgesagt', 'Slot wird frei', 'Warteliste / Neubuchung', 'Neue Buchung'],
        outcome: 'Weniger leere Stühle',
        integration: INTEGRATION.kalender,
      },
      {
        title: 'Nachschnitt-Erinnerung',
        steps: ['Letzter Schnitt vor 7 Wochen', 'Persönliche Nachricht', 'Wunschtermin buchen'],
        outcome: 'Stammkundinnen kommen regelmäßig',
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Was kostet ein Herrenschnitt?', isQuote: true, steps: ['Hinterlegten Preis nennen', 'Freie Zeiten zeigen', 'Termin anbieten'] },
      'whatsapp-ki': { text: 'Habt ihr Freitag noch einen Termin für Balayage?', isQuote: true, steps: ['Dauer berücksichtigen', 'Buchung', 'Bestätigung'] },
      'telefon-ki': { text: 'Habt ihr heute spontan noch etwas frei?', isQuote: true, steps: ['Lücken geprüft', 'Zeit angeboten', 'Gebucht'] },
      'ki-rezeption': { text: 'Ich bin mit meiner Farbe nicht zufrieden.', isQuote: true, steps: ['Anliegen erkannt', 'Details aufnehmen', 'Salonleitung informiert'] },
      terminbuchung: { text: 'Ich möchte wieder denselben Termin wie letztes Mal.', isQuote: true, steps: ['Letzten Termin finden', 'Gleiche Stylistin prüfen', 'Buchung'] },
      terminerinnerungen: { text: 'Balayage Freitag 9:00 Uhr', steps: ['Erinnerung am Vortag', 'Kundin bestätigt'] },
      crm: { text: 'Sophie Klein', steps: ['Letzte Leistung: Balayage', 'Farbrezeptur hinterlegt', 'Stylistin: Lisa', 'Nächster Termin: Fr 9:00'] },
      'follow-up': { text: 'Brautfrisur-Anfrage ohne Rückmeldung', steps: ['Nachfassen', 'Probetermin anbieten', 'Gebucht'] },
      reaktivierung: { text: 'Letzter Schnitt vor 10 Wochen', steps: ['Persönliche Nachricht', 'Termin anbieten', 'Kundin reaktiviert'] },
      angebote: { text: 'Wir sind 5 Personen für eine Hochzeit.', isQuote: true, steps: ['Personen und Leistungen erfassen', 'Datum aufnehmen', 'Angebot vorbereiten'] },
      bewertungen: { text: 'Termin abgeschlossen', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Terminbuchung oder Beschwerde?', steps: ['Terminbuchung: BusinessPilot übernimmt', 'Beschwerde: Übergabe an Salonleitung'] },
      reporting: { text: 'Ihre Salonwoche', steps: ['26 Anrufe', '23 Termine gebucht', '5 Absagen neu vergeben', '4 h 30 min geschätzte Zeitersparnis'], sample: true },
    },
    economicExample: {
      title: 'Salontermin',
      lines: [
        { label: 'Durchschnittlicher Termin', value: '75 €' },
        { label: 'Nicht neu vergebene Absagen pro Woche', value: '4' },
        { label: 'Rechnung', value: '4 × 75 € × 4 Wochen' },
      ],
      result: { value: '1.200 €', label: 'potenzielles Monatsvolumen' },
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Digitale Rezeption für Telefon und WhatsApp', 'Terminbuchung und Erinnerungen', 'Kundinnenhistorie mit Leistungen'],
      autopilot: ['Absage- und Wartelisten-Workflow', 'Nachschnitt-Reaktivierung', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '26', label: 'Telefonate angenommen' },
        { value: '19', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '23', label: 'Termine gebucht' },
        { value: '5', label: 'Termine verschoben' },
        { value: '4', label: 'Neukundinnen gewonnen' },
        { value: '1', label: 'Hochzeitsangebot vorbereitet' },
        { value: '7', label: 'Kundinnen reaktiviert' },
        { value: '8', label: 'Bewertungen angefragt' },
      ],
      revenue: '1.650 €',
      timeSaved: '4 h 30 min',
    },
    roiDefaults: { requests: 15, missed: 20, orderValue: 75, conversion: 60, days: 5 },
    cta: {
      title: 'Bereit für Ihre digitale Rezeption?',
      text: 'Wir zeigen Ihnen, wie BusinessPilot Termine bucht, Absagen neu vergibt und Ihren Kalender voll hält.',
    },
    seo: {
      title: 'BusinessPilot für Friseure – Ihre digitale Rezeption',
      description:
        'BusinessPilot bucht und verschiebt Salontermine, vergibt Absagen neu und erinnert Stammkundinnen. Die digitale Rezeption für Friseursalons.',
    },
  },

  /* ------------------------------------------------------------------ RESTAURANT */
  {
    slug: 'restaurant',
    audience: 'Restaurants',
    name: 'Restaurant',
    icon: 'utensils',
    productPromise: 'Ihre digitale Reservierungsannahme.',
    visitorThought: 'Das ist meine digitale Reservierungsannahme.',
    heroTitle: 'Ihre digitale Reservierungsannahme.',
    heroSubtitle:
      'BusinessPilot nimmt Reservierungen per Telefon und WhatsApp an, beantwortet Gästefragen und gibt Gruppenanfragen strukturiert an Sie weiter, auch mitten im Service.',
    cardTeaser: 'Reservierungen annehmen, Gästefragen beantworten, Gruppen anfragen.',
    image: { src: '/images/branchen/restaurant.jpg', alt: 'Servicekraft trägt zwei Teller durch ein Restaurant' },
    overlay: {
      caller: 'Thomas Wagner',
      channel: 'Anruf',
      text: 'Haben Sie heute Abend einen Tisch für vier?',
      checks: ['Personenzahl erfasst', 'Uhrzeit erfasst', 'Verfügbarkeit geprüft', 'Reservierung bestätigt'],
    },
    keyStatement: 'Während der Service läuft, nimmt BusinessPilot das Telefon ab.',
    customerRequests: [
      {
        text: 'Haben Sie heute Abend einen Tisch für vier?',
        intent: 'Reservierung',
        steps: ['Personenzahl und Uhrzeit erfassen', 'Verfügbarkeit prüfen', 'Tisch reservieren', 'Bestätigung senden'],
        integration: INTEGRATION.reservierung,
        alternative: { label: 'Ohne Anbindung', steps: ['Reservierungswunsch erfassen', 'Team bestätigt', 'Gast erhält Bestätigung'] },
        outcome: 'Reservierung statt verpasster Anruf',
      },
      {
        text: 'Können wir draußen sitzen?',
        intent: 'Platzwunsch',
        steps: ['Terrassenplätze berücksichtigen', 'Wunsch zur Reservierung notieren', 'Bei Wetterlage Alternative nennen'],
        outcome: 'Zufriedener Gast',
      },
      {
        text: 'Wir kommen 20 Minuten später.',
        intent: 'Verspätung',
        steps: ['Reservierung finden', 'Ihre Halteregeln anwenden', 'Team informieren', 'Gast bestätigen'],
        outcome: 'Tisch bleibt richtig geplant',
      },
      {
        text: 'Kann ich mit Hund kommen?',
        intent: 'Allgemeine Frage',
        steps: ['Hinterlegte Hausregeln nennen', 'Reservierung anbieten'],
        outcome: 'Frage beantwortet, Reservierung angeboten',
      },
      {
        text: 'Wir möchten für 20 Personen reservieren.',
        intent: 'Gruppenanfrage',
        steps: ['Datum, Uhrzeit und Anlass erfassen', 'Menüwünsche aufnehmen', 'Kontaktdaten erfassen', 'An Inhaber übergeben', 'Angebot vorbereiten'],
        outcome: 'Strukturierte Gruppenbuchung',
      },
    ],
    quickExamples: [
      { text: 'Habt ihr vegane Gerichte?', result: 'Speisekarten-Info' },
      { text: 'Bis wann ist die Küche geöffnet?', result: 'Öffnungszeiten' },
      { text: 'Ich muss meine Reservierung stornieren.', result: 'Tisch wieder frei' },
      { text: 'Kann ich einen Gutschein kaufen?', result: 'Verkaufschance' },
    ],
    autopilotFlows: [
      {
        title: 'Stornierung neu vergeben',
        steps: ['Reservierung storniert', 'Tisch wird frei', 'Warteliste informieren', 'Neue Reservierung'],
        outcome: 'Volle Tische an starken Abenden',
        integration: INTEGRATION.reservierung,
      },
      {
        title: 'Gäste-Reaktivierung',
        steps: ['Stammgast seit 3 Monaten nicht da', 'Einladung zur neuen Karte', 'Reservierung'],
        outcome: 'Stammgäste kommen wieder',
      },
    ],
    featureExamples: {
      'website-chatbot': { text: 'Habt ihr vegane Gerichte?', isQuote: true, steps: ['Speisekarte durchsuchen', 'Gerichte nennen', 'Reservierung anbieten'] },
      'whatsapp-ki': { text: 'Wir kommen 20 Minuten später.', isQuote: true, steps: ['Reservierung finden', 'Team informieren', 'Bestätigung'] },
      'telefon-ki': { text: 'Haben Sie heute Abend einen Tisch für vier?', isQuote: true, steps: ['Personen und Uhrzeit', 'Verfügbarkeit', 'Reservierung'], integration: INTEGRATION.reservierung },
      'ki-rezeption': { text: 'Wir möchten für 20 Personen reservieren.', isQuote: true, steps: ['Gruppenanfrage erkannt', 'Details erfasst', 'Inhaber informiert'] },
      terminbuchung: { text: 'Geht auch Samstag um 19 Uhr?', isQuote: true, steps: ['Verfügbarkeit prüfen', '19:30 Uhr anbieten', 'Reservierung'], integration: INTEGRATION.reservierung },
      terminerinnerungen: { text: 'Reservierung heute 19:30 Uhr', steps: ['Erinnerung senden', 'Gast bestätigt oder storniert'] },
      crm: { text: 'Thomas Wagner', steps: ['Stammgast seit 2023', 'Bevorzugt Terrasse', 'Allergie: Nüsse', 'Nächste Reservierung: Sa 19:30'] },
      'follow-up': { text: 'Gruppenangebot seit 4 Tagen offen', steps: ['Nachfassen', 'Menü bestätigt', 'Gruppe gebucht'] },
      reaktivierung: { text: 'Stammgast seit 3 Monaten nicht da', steps: ['Einladung zur neuen Karte', 'Tisch anbieten', 'Gast reserviert'] },
      angebote: { text: 'Wir planen eine Weihnachtsfeier für 25 Personen.', isQuote: true, steps: ['Anlass und Datum erfassen', 'Menüwünsche aufnehmen', 'Angebot vorbereiten'] },
      bewertungen: { text: 'Besuch am Vorabend', steps: ['Google-Bewertungslink an jeden Kunden', 'Kritik sofort intern melden'] },
      'ki-mitarbeiter': { text: 'Reservierung oder Beschwerde?', steps: ['Reservierung: BusinessPilot übernimmt', 'Beschwerde: Übergabe an Inhaber'] },
      reporting: { text: 'Ihre Restaurantwoche', steps: ['52 Anrufe', '38 Reservierungen', '2 Gruppenanfragen', '6 h 05 min geschätzte Zeitersparnis'], sample: true },
    },
    economicExample: {
      title: 'Tischreservierung',
      lines: [
        { label: 'Durchschnittlicher Umsatz pro Gast', value: '45 €' },
        { label: 'Gäste pro Tisch', value: '4' },
        { label: 'Wert einer Reservierung', value: '180 €' },
        { label: 'Verpasste Tischanfragen pro Woche', value: '5' },
        { label: 'Rechnung', value: '5 × 180 € × 4 Wochen' },
      ],
      result: { value: '3.600 €', label: 'potenzielles monatliches Buchungsvolumen' },
    },
    recommendedPlan: {
      recommended: 'BUSINESS',
      business: ['Reservierungsannahme per Telefon und WhatsApp', 'Erinnerungen gegen No-Shows', 'Gästehistorie mit Vorlieben'],
      autopilot: ['Stornierungen neu vergeben', 'Gruppenangebote nachfassen', 'Gäste-Reaktivierung', 'ROI Reporting'],
    },
    reporting: {
      items: [
        { value: '52', label: 'Telefonate angenommen' },
        { value: '27', label: 'WhatsApp-Anfragen beantwortet' },
        { value: '38', label: 'Reservierungen angenommen' },
        { value: '6', label: 'Reservierungen verschoben' },
        { value: '2', label: 'Gruppenanfragen erfasst' },
        { value: '2', label: 'Gruppenangebote vorbereitet' },
        { value: '9', label: 'Gäste reaktiviert' },
        { value: '11', label: 'Bewertungen angefragt' },
      ],
      revenue: '3.240 €',
      timeSaved: '6 h 05 min',
    },
    roiDefaults: { requests: 25, missed: 20, orderValue: 180, conversion: 70, days: 6 },
    cta: {
      title: 'Bereit für Ihre digitale Reservierungsannahme?',
      text: 'Wir zeigen Ihnen, wie BusinessPilot Reservierungen annimmt und Gästefragen beantwortet, während Ihr Service läuft.',
    },
    seo: {
      title: 'BusinessPilot für Restaurants – Ihre digitale Reservierungsannahme',
      description:
        'BusinessPilot nimmt Reservierungen per Telefon und WhatsApp an, beantwortet Gästefragen und erfasst Gruppenanfragen. Auch mitten im Service.',
    },
  },
];

export const getIndustry = (slug: string) => industries.find((i) => i.slug === slug);
