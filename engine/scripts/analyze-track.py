# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["librosa>=0.10,<1"]
# ///
"""Находит биты трека и предлагает самые энергичные фрагменты. Припев не определяет: решение остаётся за человеком."""
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SAMPLE_RATE = 22050
HOP_LENGTH = 512


def read_options():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--fragment", type=float, help="длина фрагмента в секундах; без неё только биты")
    parser.add_argument("--candidates", type=int, default=3)
    return parser.parse_args()


def pick_candidates(beats, energy, frame_seconds, fragment, count):
    """Окна начинаются на бите: так фрагмент входит в ритм. Близкие окна отбрасываются, иначе все варианты окажутся одним местом."""
    duration = len(energy) * frame_seconds
    windows = []
    for start in beats:
        if start + fragment > duration:
            break
        first = int(start / frame_seconds)
        windows.append((float(np.mean(energy[first : first + int(fragment / frame_seconds)])), float(start)))
    if not windows:
        raise ValueError(f"Track is shorter than the {fragment} s fragment")

    loudest = max(window[0] for window in windows)
    picked = []
    for level, start in sorted(windows, reverse=True):
        if all(abs(start - other["startSeconds"]) >= fragment / 2 for other in picked):
            picked.append({"startSeconds": round(start, 3), "endSeconds": round(start + fragment, 3), "relativeEnergy": round(level / loudest, 3)})
        if len(picked) == count:
            break
    return picked


def main():
    options = read_options()
    if options.fragment is not None and options.fragment <= 0:
        raise ValueError("--fragment must be above 0")
    samples, _ = librosa.load(options.audio, sr=SAMPLE_RATE, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    beats = librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    if len(beats) == 0:
        raise ValueError(f"No beats found in {options.audio}")

    result = {
        "audio": options.audio,
        "durationSeconds": round(len(samples) / SAMPLE_RATE, 3),
        "tempoBpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "beatsSeconds": [round(float(beat), 3) for beat in beats],
    }
    if options.fragment:
        energy = librosa.feature.rms(y=samples, hop_length=HOP_LENGTH)[0]
        result["candidates"] = pick_candidates(beats, energy, HOP_LENGTH / SAMPLE_RATE, options.fragment, options.candidates)

    out = Path(options.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"out": str(out), "tempoBpm": result["tempoBpm"], "beats": len(beats), "candidates": result.get("candidates", [])}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"analyze-track: {error}", file=sys.stderr)
        sys.exit(1)
