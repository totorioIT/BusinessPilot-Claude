# Netzwerk Explorer – Reel (DE)

Deutsches 9:16-Reel (1080×1920, 30 fps, 30,5 s): „So funktioniert das Internet wirklich“.

- `netzwerk-explorer-reel-de.mp4` – fertiges Video mit Soundtrack
- `reel.html` – die Animation (jede Szene über `render(t)` steuerbar, `reel.html?t=12` zeigt Sekunde 12)
- `render.cjs` – rendert Frame für Frame mit Playwright und gibt es an ffmpeg weiter
- `audio.py` – erzeugt Beat und Sound-Effekte (lizenzfrei, synthetisch) aus `cues.json`

Neu bauen:

```bash
node render.cjs /tmp/reel_noaudio.mp4        # schreibt auch /tmp/cues.json
python3 audio.py /tmp/cues.json /tmp/sound.wav
ffmpeg -i /tmp/reel_noaudio.mp4 -i /tmp/sound.wav -c:v copy -c:a aac -b:a 192k -ac 2 -shortest netzwerk-explorer-reel-de.mp4
```

## Ablauf

| Zeit | Szene |
|---|---|
| 0–3 s | Hook: „Was passiert, wenn du eine Webseite öffnest?“ |
| 3–7 s | 1 · Laptop → Router |
| 7–11,5 s | 2 · DNS-Auflösung (8.8.8.8) |
| 11,5–15,5 s | 3 · TCP-Handshake SYN / SYN-ACK / ACK |
| 15,5–19,5 s | 4 · HTTP GET → 200 OK |
| 19,5–21,5 s | 5 · Seite geladen |
| 21,5–28 s | Bonus: Captive Portal im Hotel-WLAN |
| 28–30,5 s | Outro: „Folge für mehr“, Teaser Teil 2 |

## Caption-Vorschlag

So funktioniert das Internet wirklich 🌐 Vom Klick bis zur fertigen Seite in unter 100 ms – und warum dich Hotel-WLAN erst auf eine Login-Seite schickt. Speichern für später! 

#internet #netzwerk #it #techwissen #dns #informatik #lernen
