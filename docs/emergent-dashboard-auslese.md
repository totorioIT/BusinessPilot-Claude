# totorioOne / BusinessPilot – Auslese der Screenshots (Stand 13.10.2026)

Quelle: 15 Fotos vom Bildschirm, App unter `business-pilot-11.preview.emergentagent.com`.
Werte aus unscharfen Fotos (v. a. Kundennummern, Chart-Werte) sind mit „~“ markiert.

---

## Globales Layout

- **Branding:** totorioOne – „Dein digitaler Mitarbeiter“ (Texte in der App sagen teils noch „BusinessPilot“)
- **Topbar:** Suche „Kunden suchen…“, Glocke mit Badge **2**, User **Philipp Wiedamann (Owner)**
- **Sidebar:**
  - Dashboard
  - POSTEINGANG: Übersicht, Telefon, WhatsApp
  - CRM: Kunden, Leads, Termine, Angebote, Aufgaben
  - AUTOMATISIERUNG: Automationen, Bewertungen
  - SYSTEM: Wissen, Analyse, KI-Mitarbeiter, Integrationen, Einstellungen
  - PLATTFORM: Admin

---

## 1. Dashboard `/dashboard`

- Titel „Guten Tag, Philipp“ / „Was hat Ihr digitaler Mitarbeiter heute für Sie erledigt?“
- **Hero-Banner:** „Anna hat für Sie gearbeitet – 7 Kundeninteraktionen automatisch bearbeitet“ · Zeit gespart **1 Std.** · Geschätzter Wert **40,00 €**
- **KPI-Kacheln (2×4):**
  | Wert | Label |
  |---|---|
  | 4 | Anrufe bearbeitet |
  | 3 | WhatsApp-Chats |
  | 4 | Termine gebucht |
  | 5 | Leads generiert |
  | 7 | Aktive Automationen |
  | 4 | Angebote initiiert |
  | 3 | Bewertungen angefragt |
  | 1 | Übergaben an Team |
- **Aktivitäten (Live-Feed):**
  - WhatsApp-Nachricht gesendet [Mitarbeiter] – „TEST_QA Nachricht vom Automatiktest“ – vor 51 Tagen
  - Lead-Status geändert → qualified [Mitarbeiter] – „TEST_QA Lead“ – vor 51 Tagen
  - Angebot AN-1028 → accepted [Mitarbeiter] – vor 51 Tagen
- **Schnellzugriff:** Posteingang öffnen, Termine ansehen, Leads bearbeiten, ROI & Analyse (abgeschnitten)

## 2. Posteingang / Übersicht `/inbox`

- Untertitel: „Alle Kundenkontakte an einem Ort – Telefon & WhatsApp vereint.“
- KPIs: **4** Anrufe · **3** WhatsApp-Chats · **1** Verpasst · **1** Übernahme nötig
- Liste:
  | Kanal | Kontakt | Status | Vorschau | Zeit |
  |---|---|---|---|---|
  | WA | Stefan Hoffmann | Mitarbeiter nötig | TEST_QA Nachricht vom Automatiktest | vor 53 Tagen |
  | Tel | Unbekannt | Verpasst | Verpasster Anruf. Anna hat automatisch eine WhatsApp-Nachricht gesendet. | vor 51 Tagen |
  | WA | Julia Schmidt | KI bearbeitet | Ich prüfe die Verfügbarkeit für Sie. | vor 52 Tagen |
  | Tel | Andrea Bauer | Abgeschlossen | Rückruf zu Wartungsvertrag. An Thomas Klein übergeben für Angebotserstellung. | vor 52 Tagen |
  | Tel | Peter Wagner | Abgeschlossen | Interessiert sich für eine Wärmepumpe. Anna hat einen Lead erstellt und Infos zur Immobilie gesammelt. | vor 54 Tagen |
  | WA | Max Müller | Abgeschlossen | Perfekt, bis Dienstag! | vor 57 Tagen |
  | Tel | Max Müller | Abgeschlossen | Viessmann-Heizung (Bj. 2018) Wartung, Termin Di 10:30 | vor 57 Tagen |

## 3. Telefon `/inbox/phone`

- Untertitel: „Alle Anrufe mit KI-Zusammenfassung, Transkript und Aktionen.“
- Anrufliste:
  - Max Müller – Wartungsanfrage Heizung – 16. Aug., 18:55 – Abgeschlossen
  - Peter Wagner – Anfrage Wärmepumpe – 19. Aug., 19:55 – Abgeschlossen
  - Andrea Bauer – Wartungsvertrag – 21. Aug., 16:55 – Abgeschlossen
  - Unbekannt – Verpasst – 22. Aug., 15:55 – Verpasst
- **Detail Max Müller:** +49 170 1234567 · Dauer 3:04 · Abgeschlossen · Link „Kundenakte“
  - KI-Zusammenfassung: Max Müller ruft an, weil seine Viessmann-Heizung (Bj. 2018) gewartet werden soll. Anna hat Name, Adresse, Hersteller und Baujahr erfasst und einen Wartungstermin für Dienstag 10:30 Uhr vereinbart.
  - Anliegen: Wartungsanfrage Heizung · Stimmung: Positiv · Bearbeitet von: Anna (KI)
  - Automatische Aktionen (Chips): Kontakt erkannt · Termin gebucht · WhatsApp-Bestätigung
  - Transkript:
    - Anna: Guten Tag, hier ist Anna von Muster Haustechnik. Wie kann ich Ihnen helfen?
    - Kunde: Guten Tag, meine Heizung sollte mal gewartet werden.
    - Anna: Sehr gern. Um welche Anlage handelt es sich?
    - Kunde: Eine Viessmann, eingebaut 2018.
    - Anna: Perfekt. Ich hätte Dienstag um 10:30 Uhr einen Termin frei – passt das?
    - Kunde: Ja, das passt gut.
    - Anna: Wunderbar, ich habe den Termin gebucht und sende Ihnen eine WhatsApp-Bestätigung.

## 4. WhatsApp `/inbox/whatsapp`

- Untertitel: „Kundenkonversationen mit echten KI-Antworten – wie ein moderner Helpdesk.“
- Chatliste: Stefan Hoffmann (TEST_QA…, Mitarbeiter nötig, 1 ungelesen) · Julia Schmidt (KI bearbeitet) · Max Müller (Abgeschlossen)
- Chat-Header Stefan Hoffmann: Button „Aus Chat extrahieren“, Status-Dropdown „Mitarbeiter nötig“
- Verlauf:
  - 17:35 Kunde: Hallo, ich interessiere mich für eine Badsanierung.
  - 17:40 KI: Guten Tag Herr Hoffmann! Gerne. Können Sie mir die Größe des Bades nennen?
  - 17:45 Kunde: Ca. 8 Quadratmeter.
  - 17:55 Kunde: Können Sie mir ein Angebot machen?
  - 21:57 Mitarbeiter: Gerne erstellen wir Ihnen ein Angebot für die Badsanierung. Bitte senden Sie mir kurz ein paar Fotos vom Bad und, wenn möglich, Ihre Wunschvorstellungen – dann gebe ich den Vorgang an eine/n Mitarbeiter/in zur Angebotserstellung weiter.
- Composer: „KI-Antwort vorschlagen“, Placeholder „Antwort schreiben oder von Anna vorschlagen lassen…“, Senden-Button

## 5. Kunden `/customers`

- Untertitel: „Zentrale Kundenkartei – jede Interaktion an einem Ort.“ · Button „Neuer Kunde“
  | Name | Firma | Telefon | E-Mail | Kundennr. (~) | Angelegt |
  |---|---|---|---|---|---|
  | QA | – | – | – | K-D15EEC | 22. Aug. 2026 |
  | Max Müller | Müller GmbH | +49 170 1234567 | max.mueller@example.de | K-7E5E5B | 13. Juli 2026 |
  | Julia Schmidt | Schmidt Immobilien | +49 171 9876543 | j.schmidt@example.de | K-69808F | 13. Juli 2026 |
  | Peter Wagner | – | +49 160 5556677 | p.wagner@example.de | K-DCD57C | 13. Juli 2026 |
  | Andrea Bauer | Bauer & Co KG | +49 175 3334455 | a.bauer@example.de | K-602B08 | 13. Juli 2026 |
  | Stefan Hoffmann | – | +49 152 7778899 | s.hoffmann@example.de | K-F9C7A2 | 13. Juli 2026 |

## 6. Leads `/leads` (Kanban)

- Untertitel: „Verkaufspipeline – BusinessPilot empfiehlt den nächsten Schritt.“
  | Spalte | Anzahl / Summe | Karte | Kunde | Wert | KI-Empfehlung | Kanal |
  |---|---|---|---|---|---|---|
  | Neue Anfrage | 0 / 0,00 € | – | | | | |
  | Qualifiziert | 1 / 18.500 € | Wärmepumpe Einfamilienhaus | Peter Wagner | 18.500,00 € | Beratungstermin durchführen | Tel |
  | Termin | 1 / 2.400 € | Wartung 3 Objekte | Julia Schmidt | 2.400,00 € | Objektbegehung durchführen | WA |
  | Angebot in Arbeit | 1 / 12.000 € | Badsanierung 8 m² | Stefan Hoffmann | 12.000,00 € | Angebot erstellen und senden | WA |
  | Angebot versendet | 1 / 4.800 € | Wartungsvertrag Gewerbe | Andrea Bauer | 4.800,00 € | Nachfassen – Angebot seit 4 Tagen unbeantwortet | Tel |
  | Gewonnen | 320 € | Wartung Heizung | Max Müller | 320,00 € | – | |
- Jede Karte hat ein Status-Dropdown; Board scrollt horizontal.

## 7. Termine `/appointments`

- Untertitel: „Terminverwaltung mit automatischen Bestätigungen & Erinnerungen.“ · Button „Neuer Termin“
  | Datum | Titel | Status | Zeit | Mitarbeiter | Ort | Kanal |
  |---|---|---|---|---|---|---|
  | 22. Aug | Wartungstermin Objekt Leopoldstraße | Bestätigt | 21:58 | – | Objekt Leopoldstraße | WhatsApp |
  | 23. Aug | Wartung Heizung – Müller GmbH | Abgeschlossen | 22:55 | Thomas Klein | Blumenstraße 5, München | Telefon |
  | 25. Aug | Objektbegehung Leopoldstraße | Bestätigt | 21:55 | Sabine Berger | Leopoldstr. 22 | WhatsApp |
  | 28. Aug | Beratung Wärmepumpe | Bestätigt | 00:55 | Thomas Klein | Video-Meeting | Telefon |
- Aktionen pro Zeile: Abschließen / Stornieren (nicht bei abgeschlossenen)

## 8. Angebote `/quotes`

- Untertitel: „BusinessPilot sammelt Infos aus Gesprächen und bereitet Angebote vor.“
  | Nr. | Titel | Kunde | Brutto | Status | KI-Hinweis |
  |---|---|---|---|---|---|
  | AN-1030 | Angebot für Badsanierung | – | 0,00 € | Entwurf | Von Anna aus WhatsApp extrahiert. |
  | AN-1025 | Badsanierung ca. 8 m² | Stefan Hoffmann | 10.400,60 € | Entwurf | Von Anna aus WhatsApp-Konversation vorbereitet. |
  | AN-1026 | Wärmepumpe inkl. Installation | Peter Wagner | 22.015,00 € | Infos fehlen | Fördermittel-Info fehlt noch. |
  | AN-1024 | Wartungsvertrag Gewerbe (jährlich) | Andrea Bauer | 714,00 € | Versendet | Automatisch nach 3 Tagen nachgefasst. |
- Pro Karte: Button „Details“ + Status-Dropdown

## 9. Aufgaben `/tasks`

- Untertitel: „Automatisch von Anna oder manuell erstellt.“ · Button „Neue Aufgabe“
- **Überfällig (3):**
  - Angebot Badsanierung erstellen – Sabine Berger – 23. Aug. 2026 – KI-erstellt – Hoch
  - Ersatzteil für Wartung Müller bestellen – Thomas Klein – 23. Aug. 2026 – Normal
  - Fördermittel Wärmepumpe recherchieren – Thomas Klein – 24. Aug. 2026 – KI-erstellt – Normal
- **Erledigt (2):**
  - QA-UI Aufgabe – Normal
  - Nachfassen Wartungsvertrag Bauer – Thomas Klein – 22. Aug. 2026 – KI-erstellt – Dringend

## 10. Automationen `/automations`

- Untertitel: „Trigger → Bedingung → Aktion → Verzögerung. Einfach wie Zapier – für KMU.“
- **Aktive Automationen:**
  | Name | Toggle | Ausgeführt | Ablauf |
  |---|---|---|---|
  | Kunden-Reaktivierung (#1) | an | 0× | Keine Interaktion seit 6 Monaten → Personalisierte WhatsApp senden → Wenn keine Reaktion → KI-Anruf einplanen |
  | Kunden-Reaktivierung (#2) | an | 0× | identisch |
  | Kunden-Reaktivierung (#3) | an | 0× | identisch |
  | Kunden-Reaktivierung (#4) | aus | 0× | identisch |
  | Verpasster Anruf | an | 3× | Anruf verpasst → 2 Minuten warten → WhatsApp senden: „Wie können wir helfen?“ → Aufgabe für Mitarbeiter erstellen |
  | Angebots-Nachfassen | an | 7× | Angebot versendet → 3 Tage warten → Wenn keine Antwort → Freundliche WhatsApp-Nachfassung → 4 Tage warten → Aufgabe für Vertrieb erstellen |
  | Kundenbewertung | an | 5× | Auftrag abgeschlossen → 2 Stunden warten → WhatsApp: „Waren Sie zufrieden?“ → Wenn positiv → Google-Bewertungslink senden |
  | Terminerinnerung | an | 12× | Termin gebucht → 1 Tag vor Termin → WhatsApp-Erinnerung senden → Wenn keine Bestätigung → Erneut erinnern |
  | Neuer Lead | aus | 0× | Neue Anfrage eingegangen → Lead anlegen → Lead automatisch qualifizieren → Wenn Terminwunsch vorhanden → Termin vorschlagen (WhatsApp) |
- Farbcodes: Trigger blau, Aktion grün, Bedingung gelb/orange, Warten grau
- **Vorlagen:** Neuer Lead, Verpasster Anruf, Terminerinnerung, Angebots-Nachfassen, Kundenbewertung, Kunden-Reaktivierung – alle mit „Bereits aktiv“

## 11. Bewertungen `/reviews`

- Untertitel: „Nach erfolgreichem Auftrag fragt BusinessPilot automatisch nach Feedback.“
- KPIs: **3** Anfragen gesendet · **3** Abgeschlossen · **0** Geplant
  | Kunde | Kanal | Status | Gesendet |
  |---|---|---|---|
  | Max Müller | Whatsapp | Abgeschlossen | – |
  | Andrea Bauer | Whatsapp | Abgeschlossen | 20. Aug. 2026 |
  | Julia Schmidt | Whatsapp | Abgeschlossen | 17. Aug. 2026 |

## 12. Wissen `/knowledge`

- Untertitel: „Anna beantwortet Kundenfragen anhand dieser Informationen.“ · Buttons „Dokument (bald)“, „Neuer Eintrag“
- Öffnungszeiten → Geschäftszeiten: Mo–Fr 07:30–17:00 Uhr. Notdienst 24/7 unter +49 89 12345678.
- Unternehmen → Über uns: Muster Haustechnik GmbH ist Ihr Fachbetrieb für Heizung, Sanitär und Klima in München. Seit 1998.
- Unternehmen → QA Eintrag: „QA Inhalt Text“
- Preise → Richtpreise: Heizungswartung ab 180 €. Anfahrt 60 €. Notdienst-Zuschlag 50 %.
- Leistungen → Unsere Services: Heizungswartung, Wärmepumpen, Badsanierung, Notdienst, Wartungsverträge.

## 13. Analyse & ROI `/analytics`

- Untertitel: „Der geschäftliche Mehrwert Ihres digitalen Mitarbeiters.“
- KPIs: Interaktionen (KI) **7** · Zeit gespart **1 Std.** · Geschätzter Monatswert **40,00 €**
- Balken „Zeitersparnis pro Kanal (Std.)“, Achse 0–1: Anrufe beantwortet ~0,6 · WhatsApp-Chats ~0,3 · Termine gebucht ~0,5 · Leads erfasst ~0,4 · Angebote vorbereitet ~1,0
- Linie „Entwicklung (Interaktionen)“: KW 20 ~24 · KW 21 ~30 · KW 22 ~36 · KW 23 ~3
- Zusammenfassung: „BusinessPilot hat 7 Kundeninteraktionen automatisch bearbeitet und dabei geschätzt 1 Mitarbeiterstunden eingespart – ein Gegenwert von rund 40,00 € pro Monat.“

## 14. KI-Mitarbeiter `/ai-employee`

- Untertitel: „Konfigurieren Sie Persönlichkeit, Sprache und Handlungsspielraum von Anna.“
- Identität: Name **Anna** · Sprache **Deutsch** · Tonalität **Freundlich** · Begrüßung „QA Begrüßung“
- Handlungsspielraum: Assistieren (Anna schlägt vor, Mitarbeiter senden) · Halbautomatisch (einfache Anfragen selbst) · **Autopilot (ausgewählt)** (definierte Abläufe eigenständig)
- Vorschaukarte: Anna – Digitaler Mitarbeiter – „QA Begrüßung“
- Eskalationsregeln: „Bei Notfällen, Beschwerden oder Preisverhandlungen an Mitarbeiter übergeben.“

## 15. Integrationen `/integrations`

- Untertitel: „Modulare Anbindungen – produktionsbereit, aktuell im Sandbox-Modus.“
  | Integration | Beschreibung | Modus | Status |
  |---|---|---|---|
  | Fonio.ai (Telefon) | KI-Telefonassistent für ein- und ausgehende Anrufe | Sandbox | nicht verbunden |
  | Google Business (Bewertungen) | Google-Bewertungslink & Tracking | Sandbox | Verbunden |
  | Google Calendar | Synchronisiert Termine mit Google Kalender | Sandbox | Verbunden |
  | Microsoft 365 / Outlook | Outlook-Kalender-Anbindung | Sandbox | nicht verbunden |
  | WhatsApp Business Cloud | Offizielle Meta WhatsApp Business API | Sandbox | Verbunden |
  | lexoffice | Rechnungen & Angebote exportieren | Sandbox | nicht verbunden |

## 16. Einstellungen (Tab Unternehmen)

- Untertitel: „Unternehmen, Team, Geschäftszeiten und Datenschutz.“ · Tabs: Unternehmen, Team, Geschäftszeiten, Datenschutz
- Firmenname: Muster Haustechnik GmbH
- Branche: Heizung & Sanitär (SHK)
- Adresse: Industriestraße 12, 80939 München
- Telefon: +49 89 12345678
- Google-Bewertungslink: https://g.page/r/muster-haustechnik/review
- Button „Speichern“

---

## Auffälligkeiten / mögliche Bugs (beim Auslesen bemerkt)

1. **QA-/Testdaten sichtbar:** Kunde „QA“, „TEST_QA“-Nachricht bei Stefan Hoffmann, „QA Eintrag“ im Wissen, „QA Begrüßung“ als Annas Begrüßung, „QA-UI Aufgabe“.
2. **4× Kunden-Reaktivierung** als Duplikat in aktiven Automationen; zugleich zeigen alle Vorlagen „Bereits aktiv“, obwohl „Neuer Lead“ ausgeschaltet ist.
3. **Analyse inkonsistent:** Balken summieren sich auf ~2,8 Std., Kachel sagt 1 Std.; Liniendiagramm zeigt ~90 Interaktionen (KW 20–23 = Mai/Juni), Kachel sagt 7, Daten stammen aus August. Grammatik: „1 Mitarbeiterstunden“.
4. **Lead-Werte ≠ Angebotswerte:** Badsanierung 12.000 € vs. AN-1025 10.400,60 €; Wärmepumpe 18.500 € vs. AN-1026 22.015 €; Wartungsvertrag 4.800 € vs. AN-1024 714 €.
5. **AN-1030** ohne Kunde und mit 0,00 € (Duplikat zu AN-1025?); **AN-1028** im Feed „accepted“, taucht in Angebotsliste nicht auf.
6. **Terminzeiten** 21:58 / 22:55 / 21:55 / 00:55 – sieht nach Zeitzonen-/UTC-Fehler aus (Geschäftszeiten 07:30–17:00).
7. **Telefon-Integration (Fonio) nicht verbunden**, aber Anrufe mit Transkript vorhanden (Seed-Daten).
8. **Bewertungen:** Automation „Kundenbewertung“ 5× ausgeführt, Seite zeigt 3 Anfragen; Max Müller ohne Sendedatum.
9. **WhatsApp:** Die Inbox-Vorschau „TEST_QA…“ bei Stefan Hoffmann erscheint nicht im Verlauf; letzte Nachricht ist als „Mitarbeiter“ markiert, liest sich aber wie eine KI-Übergabe.
10. **Branding gemischt:** totorioOne in Logo, „BusinessPilot“ in Seitentexten (Angebote, Leads, Bewertungen, Analyse).
11. Alle „vor 51–57 Tagen“ – Demo-Daten wirken veraltet.
