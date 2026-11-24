#!/usr/bin/env python3
"""Create premium sports alerts from the openly licensed real sound recordings.

Run: python3 scripts/generate_notification_sounds.py
Dependencies: ffmpeg and Python standard library; no API key or generated voice.
Source credits: SOUND_CREDITS.md.
"""
from array import array
from pathlib import Path
import math
import subprocess
import shutil
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "assets" / "notification-audio"
TARGET = ROOT / "app" / "src" / "main" / "res" / "raw"
RATE = 16000
NAMES = {
    "goal1": "crowd-goal-main.mp3",
    "goal2": "crowd-goal-layer.mp3",
    "whistle": "referee-whistle-short.mp3",
    "long": "referee-whistle-long.wav",
    "sharp": "referee-whistle-sharp.ogg",
    "stadium": "crowd-ambience.mp3",
    "boo": "crowd-reaction.mp3",
    "ball": "football-kick.mp3",
}
# source key, start time, max excerpt duration, relative amplitude.
SCENES = {
    "goal": (3.6, [("ball", 0, .18, .15), ("goal1", .02, 3.55, .97), ("goal2", .39, 3.17, .37)], .78),
    "kickoff": (1.25, [("whistle", .02, 1.1, 1), ("stadium", 0, 1.25, .06)], .73),
    "secondhalf": (1.7, [("sharp", .03, .53, .94), ("whistle", .80, .78, .78), ("stadium", 0, 1.6, .05)], .66),
    "halftime": (2.1, [("whistle", .03, .85, .95), ("sharp", 1.0, .54, .86), ("stadium", 0, 2.05, .05)], .65),
    "fulltime": (3.0, [("sharp", .04, .5, .86), ("whistle", .80, .7, .80), ("long", 1.58, 1.33, .98),
                       ("stadium", 0, 2.95, .07)], .73),
    "yellow": (.85, [("sharp", .05, .58, .90), ("ball", 0, .17, .11)], .59),
    "red": (2.2, [("long", .03, 1.3, .96), ("boo", .19, 1.9, .48), ("ball", 0, .18, .13)], .68),
    "general": (.95, [("ball", 0, .21, .46), ("stadium", .12, .8, .1)], .37),
}

def decode(filename):
    process = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", str(SOURCES / filename), "-vn", "-ar", str(RATE),
        "-ac", "1", "-f", "f32le", "pipe:1",
    ], capture_output=True, check=True)
    samples = array("f")
    samples.frombytes(process.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        raise ValueError("Empty audio: " + filename)
    return samples

def start_of_sound(samples, kind):
    if kind in ("goal1", "goal2", "stadium", "boo", "ball"):
        return 0
    energy = []
    step = 240
    for j in range(0, min(len(samples), RATE * 3), step):
        section = samples[j:j+step]
        energy.append(math.sqrt(sum(float(x) ** 2 for x in section) / len(section)))
    threshold = max(.012, max(energy)*.18)
    return next((max(0,(i-1)*step) for i,v in enumerate(energy) if v > threshold), 0)

def make(name, duration, parts, ceiling, cache, starts):
    length = round(duration * RATE)
    mix = array("f", [0.0]) * length
    for kind, start, seconds, gain in parts:
        audio = cache[kind]
        offset = starts[kind]
        position = round(start * RATE)
        count = min(round(seconds * RATE), len(audio) - offset, length - position)
        if count < RATE // 15:
            raise RuntimeError("Audio segment too short: " + name + " / " + kind)
        attack = min(160, max(1, count // 6))
        release = min(round(RATE * (.25 if kind in ("goal1","goal2","stadium","boo") else .08)),count//3)
        for i in range(count):
            shape = max(0.0, min(1.0, i/attack, (count-1-i)/max(1,release)))
            mix[position+i] += audio[offset+i]*gain*shape
    peak = max(abs(float(x)) for x in mix)
    if peak < .001:
        raise ValueError("Empty cue: " + name)
    pcm = array("h")
    for i,v in enumerate(mix):
        fade = max(0.0,min(1.0,i/(RATE*.008),(length-i-1)/(RATE*.100)))
        pcm.append(round(32767*max(-.96,min(.96,float(v)*ceiling/peak*fade))))
    output = TARGET / ("korazol_" + name + ".wav")
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    print(name, output.stat().st_size, "bytes")

def main():
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg executable required")
    cache = {kind:decode(path) for kind,path in NAMES.items()}
    starts = {kind:start_of_sound(samples,kind) for kind,samples in cache.items()}
    TARGET.mkdir(parents=True, exist_ok=True)
    for name,(seconds,parts,ceiling) in SCENES.items():
        make(name, seconds, parts, ceiling, cache, starts)

if __name__ == "__main__":
    main()
