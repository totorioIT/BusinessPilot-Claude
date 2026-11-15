"""Erzeugt einen lizenzfreien Soundtrack (Beat + Sound-Effekte) passend zu cues.json.

Aufruf: python3 audio.py <cues.json> <out.wav>
"""
import json
import sys
import wave

import numpy as np

SR = 44100
cues = json.load(open(sys.argv[1]))
DUR = cues["dur"]
n = int(DUR * SR)
mix = np.zeros(n)
t_all = np.arange(n) / SR


def place(sig, at, gain=1.0):
    i = int(at * SR)
    if i >= n:
        return
    j = min(n, i + len(sig))
    mix[i:j] += sig[: j - i] * gain


def env(length, a=0.005, r=None):
    m = int(length * SR)
    e = np.ones(m)
    ai = max(1, int(a * SR))
    e[:ai] = np.linspace(0, 1, ai)
    rr = np.linspace(0, 1, m)
    e *= np.exp(-rr * (r if r else 6))
    return e


def kick():
    L = 0.35
    tt = np.arange(int(L * SR)) / SR
    f = 50 + 110 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(L, 0.001, 7)


def hat():
    L = 0.06
    s = np.random.default_rng(1).standard_normal(int(L * SR))
    s = np.diff(s, prepend=0)  # Hochpass
    return s * env(L, 0.001, 9) * 0.25


def clap():
    L = 0.18
    s = np.random.default_rng(2).standard_normal(int(L * SR))
    return s * env(L, 0.002, 10) * 0.35


def tone(freq, L, wave_="sine", a=0.01, r=5):
    tt = np.arange(int(L * SR)) / SR
    if wave_ == "sine":
        s = np.sin(2 * np.pi * freq * tt)
    elif wave_ == "tri":
        s = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * freq * tt))
    else:  # weicher Saw
        s = sum(np.sin(2 * np.pi * freq * k * tt) / k for k in range(1, 7))
    return s * env(L, a, r)


# ---- Beat: 120 BPM, Am – F – C – G ----
BPM = 120
beat = 60 / BPM
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (130.81, 164.81, 196.0), (196.0, 246.94, 293.66)]
roots = [110.0, 87.31, 65.41, 98.0]
beats_total = int(28 / beat)
for b in range(beats_total):
    at = b * beat
    intro = at < 3.0
    if not intro or b % 2 == 0:
        place(kick(), at, 0.55 if not intro else 0.35)
    place(hat(), at + beat / 2, 0.5)
    if b % 4 in (1, 3) and not intro:
        place(clap(), at, 0.35)
    bar = (b // 4) % 4
    if b % 4 == 0:
        for f in chords[bar]:
            place(tone(f, beat * 4, "tri", a=0.3, r=1.2), at, 0.05)
    # Bass auf Achteln
    place(tone(roots[bar], beat / 2 * 0.9, "saw", a=0.005, r=4), at, 0.10)
    place(tone(roots[bar], beat / 2 * 0.9, "saw", a=0.005, r=4), at + beat / 2, 0.07)

# ---- Sound-Effekte ----
for s in cues["send"]:
    place(tone(1320, 0.12, "sine", 0.002, 8), s, 0.22)
    place(tone(1760, 0.10, "sine", 0.002, 8), s + 0.05, 0.16)
for a in cues["arrive"]:
    place(tone(660, 0.16, "tri", 0.002, 7), a, 0.25)
for sc in cues["scenes"][1:]:
    L = 0.35
    w = np.random.default_rng(3).standard_normal(int(L * SR))
    w = np.convolve(w, np.ones(40) / 40, mode="same")
    shape = np.sin(np.linspace(0, np.pi, len(w)))
    place(w * shape, sc - 0.2, 0.5)
for bl in cues["blocked"]:
    place(tone(110, 0.35, "saw", 0.005, 5), bl, 0.25)
    place(tone(116, 0.35, "saw", 0.005, 5), bl, 0.25)
# Outro: Riser + Akkord
o = cues["outro"]
L = 1.0
tt = np.arange(int(L * SR)) / SR
riser = np.sin(2 * np.pi * np.cumsum(300 + 900 * tt / L) / SR) * (tt / L) ** 2
place(riser, o - 1.0, 0.12)
for f in (440, 554.37, 659.25, 880):
    place(tone(f, 2.4, "tri", 0.01, 2.2), o, 0.09)
place(kick(), o, 0.6)

# Master: sanftes Fade-out, Normalisierung
fade = np.clip((DUR - t_all) / 1.2, 0, 1)
mix *= fade
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
mix *= 0.85 / np.max(np.abs(mix))
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[2], "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    wf.writeframes(pcm.tobytes())
print("ok", sys.argv[2])
