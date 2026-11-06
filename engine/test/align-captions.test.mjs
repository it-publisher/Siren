import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../scripts/align-captions.mjs", import.meta.url).pathname;
const AUDIO_SECONDS = 2;

const runAlign = ({ text, captions }) => {
  const dir = mkdtempSync(join(tmpdir(), "siren-align-"));
  try {
    const paths = { text: join(dir, "text.txt"), timing: join(dir, "timing.json"), audio: join(dir, "audio.wav"), out: join(dir, "words.json") };
    writeFileSync(paths.text, text);
    writeFileSync(paths.timing, JSON.stringify({ captions }));
    const audio = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", String(AUDIO_SECONDS), paths.audio]);
    assert.equal(audio.status, 0, "ffmpeg is required for this test");
    const result = spawnSync("node", [SCRIPT, "--text", paths.text, "--timing", paths.timing, "--audio", paths.audio, "--out", paths.out], { encoding: "utf-8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(paths.out, "utf-8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("music marks are not treated as words", () => {
  const { words } = runAlign({
    text: "hold my hands",
    captions: [
      { text: "♪", startMs: 0, endMs: 300 },
      { text: " hold", startMs: 300, endMs: 600 },
      { text: " ♪", startMs: 600, endMs: 700 },
      { text: " my", startMs: 700, endMs: 900 },
      { text: " hands", startMs: 900, endMs: 1200 },
    ],
  });
  assert.deepEqual(
    words.map((word) => [word.text, word.startMs, word.endMs, word.matched]),
    [
      ["hold", 300, 600, true],
      ["my", 700, 900, true],
      ["hands", 900, 1200, true],
    ],
  );
});

test("timings past the end of the audio are clamped", () => {
  const { durationMs, words } = runAlign({
    text: "one two three",
    captions: [
      { text: " one", startMs: 0, endMs: 500 },
      { text: " two", startMs: 500, endMs: 1000 },
      { text: " three", startMs: 1000, endMs: 9000 },
    ],
  });
  assert.equal(durationMs, AUDIO_SECONDS * 1000);
  assert.equal(words.at(-1).endMs, AUDIO_SECONDS * 1000);
});
