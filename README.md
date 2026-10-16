# BusinessPilot

„Dein digitaler Mitarbeiter“: Website, Dashboard und API in einem Repository.

| Ordner | Inhalt | Stack |
|---|---|---|
| `apps/website` | Marketing-Website mit 7 Branchenseiten | Astro (statisch) |
| `apps/api` | Plattform-Kern: Mandanten, CRM, Termine, Automationen, fonio-Webhooks | Node 22, Fastify, Drizzle, PostgreSQL |
| `apps/dashboard` | Kunden-Dashboard | React, Vite |
| `docs/` | API-Vertrag, Technologie-Blueprint, Auslese des alten Prototyps | |

Architektur nach dem Technologie-Blueprint: BusinessPilot besitzt Kundendaten, Terminlogik, Wissen,
Automationen und ROI. fonio, 360dialog, Google, Microsoft, Brevo und das KI-Modell sitzen hinter
Provider-Interfaces (`apps/api/src/providers`). Solange keine echten Zugänge eingetragen sind, laufen alle
Anbieter im Sandbox-Modus: Es wird nichts nach außen gesendet.

## Lokal starten

Voraussetzungen: Node 22, PostgreSQL 16.

```bash
npm install
cp .env.example .env           # DATABASE_URL anpassen
npm run db:migrate
npm run db:seed                # Demo-Werkstatt, Login demo@businesspilot.de / Demo2026!
npm run dev:api                # http://localhost:3001
npm run dev:dashboard          # http://localhost:5173
npm run dev:website            # http://localhost:4321
```

Tests (brauchen eine leere Datenbank `businesspilot_test`, die bei jedem Lauf neu aufgebaut wird):

```bash
npm test
```

## Betrieb

Ein frischer Ubuntu-24.04-Server (beliebiger Anbieter) wird mit einem Befehl eingerichtet:

```bash
curl -fsSL https://raw.githubusercontent.com/totorioIT/BusinessPilot-Claude/main/deploy/install.sh | sudo bash
```

Das Skript fragt nach Login-E-Mail und Passwort des Inhabers, installiert Docker und startet
PostgreSQL, die App (API + Dashboard) und Caddy für HTTPS (`docker-compose.yml`). Ohne `DOMAIN=…`
läuft die App unter `<ip>.sslip.io`. Beim Erststart auf leerer Datenbank legt die App den
Demo-Betrieb mit diesem Login an, ohne den öffentlichen Demo-Zugang und ohne Demo-fonio-Schlüssel.
Ein systemd-Timer holt alle 5 Minuten neue Commits von `main` und baut neu (`deploy/update.sh`);
`/api/health` zeigt den laufenden Commit. Die Website ist statisch und wird mit
`npm run build -w @bp/website` gebaut.

## fonio anbinden

Im Dashboard unter Integrationen „fonio verbinden“ erzeugt einen API-Schlüssel (wird einmal angezeigt).
In fonio wird er als `Authorization: Bearer …` eingetragen. Endpunkte siehe `docs/API.md`, Abschnitt
„Voice webhooks“. Lokal gibt es den Demo-Schlüssel `bp_test_fonio_demo_key`.

## Offen

- Live-Adapter für fonio-Outbound, 360dialog, Google/Microsoft-Kalender (OAuth), Brevo, Azure OpenAI
- Webchat-Widget für die Website, Google-Bewertungen über die Business Profile API
- Embeddings (pgvector) für die Wissenssuche, PDF-Angebote (Gotenberg), E-Signatur
- Impressum, Datenschutz, echte Domain und Kontaktadresse auf der Website
