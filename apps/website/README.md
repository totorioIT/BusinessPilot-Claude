# BusinessPilot Website

Marketing-Website für BusinessPilot, gebaut mit [Astro](https://astro.build) als statische Seite (kein Server nötig).

## Starten

```bash
npm install
npm run dev      # lokale Entwicklung auf http://localhost:4321
npm run build    # statischer Build nach dist/
npm run preview  # Build lokal ansehen
```

`dist/` kann auf jedem statischen Hosting liegen (Netlify, Vercel, Cloudflare Pages, eigener Webserver).

## Seiten

| Route | Inhalt |
| --- | --- |
| `/` | Startseite: Hero, Ablauf, Branchenauswahl, 13 Bausteine, Reporting, ROI-Rechner, Preise, Kontakt |
| `/branchen/[slug]` | 7 Branchenseiten, komplett aus `src/data/industries.ts` erzeugt |
| `/branche-anfragen` | Formular für Branchen, die (noch) nicht dabei sind |

Branchenseiten stehen bewusst **nicht** in der Hauptnavigation. Sie sind über die Branchenkarten, den Footer, interne Links und die Sitemap erreichbar.

## Inhalte pflegen

- `src/data/industries.ts`: alle Branchentexte (Kundenanfragen, Abläufe, Feature-Beispiele, Beispielrechnung, Paketempfehlung, Reporting, SEO, Rechner-Startwerte)
- `src/data/features.ts`: die 13 Bausteine mit Standard-Beispielen
- `src/data/plans.ts`: Pakete und Preise (fest vorgegeben)
- `src/data/site.ts`: Domain, Kontakt-E-Mail, Formular-Endpunkt
- `src/styles/global.css`: Design-Tokens (Navy, Grün, Radien, Abstände)

## Vor dem Livegang

1. **Branchenfotos** liegen als Pexels-Fotos (800 px) bereit. Für schärfere Darstellung auf Retina-Displays später durch größere Versionen (ab 1600 px Breite) ersetzen:
   `public/images/branchen/werkstatt.jpg`, `beauty-kosmetik.jpg`, `fitnessstudio.jpg`, `handwerk.jpg`, `handel.jpg`, `friseur.jpg`, `restaurant.jpg`
   Empfehlung: Querformat 1600 × 1280 px, JPG oder WebP, unter 300 KB.
2. **Domain und E-Mail** in `src/data/site.ts` und `public/robots.txt` eintragen.
3. **Formular-Backend**: `FORM_ENDPOINT` in `src/data/site.ts` setzen (z. B. Formspree oder eigenes Backend, nimmt JSON per POST an). Ohne Endpunkt öffnet das Formular das E-Mail-Programm mit vorbereiteter Nachricht.
4. **Impressum und Datenschutzerklärung** ergänzen und im Footer verlinken (in Deutschland Pflicht).

## Wichtige Inhaltsregeln

- Alle Zahlen im Reporting, in den Beispielrechnungen und im Rechner sind als Beispielwerte gekennzeichnet.
- Abläufe, die eine externe Software brauchen (Fahrzeugstatus, TÜV-Daten, Check-ins, Warenbestand, Reservierungen), tragen den Hinweis „Mit angebundener …“ bzw. „Bei verfügbarer Integration“.
- BusinessPilot nennt in den Beispielen nur Preise, die der Betrieb selbst hinterlegt hat.
