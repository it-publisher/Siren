import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../scripts/analyze-video.mjs", import.meta.url).pathname;

const makeVideo = (path, withAudio) => {
  const audio = withAudio ? ["-f", "lavfi", "-i", "sine=frequency=440:duration=4"] : [];
  const picture = ["-f", "lavfi", "-i", "color=red:size=180x320:rate=30:duration=2", "-f", "lavfi", "-i", "color=blue:size=180x320:rate=30:duration=2"];
  const filter = ["-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", ...(withAudio ? ["-map", "2:a"] : [])];
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", ...picture, ...audio, ...filter, "-pix_fmt", "yuv420p", path], { encoding: "utf-8" });
  assert.equal(made.status, 0, made.stderr);
};

const withVideo = (withAudio, check) => {
  const dir = mkdtempSync(join(tmpdir(), "siren-analyze-"));
  try {
    const video = join(dir, "clip.mp4");
    makeVideo(video, withAudio);
    check({ dir, video, out: join(dir, "out") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const runScript = (args) => spawnSync("node", [SCRIPT, ...args], { encoding: "utf-8" });

test("measures size, cuts, loudness and extracts frames", () => {
  withVideo(true, ({ video, out }) => {
    const result = runScript(["--video", video, "--out", out, "--frame-every", "1"]);
    assert.equal(result.status, 0, result.stderr);
    const metrics = JSON.parse(readFileSync(join(out, "metrics.json"), "utf-8"));
    assert.equal(metrics.width, 180);
    assert.equal(metrics.height, 320);
    assert.equal(metrics.fps, 30);
    assert.equal(metrics.shots, 2);
    assert.ok(Math.abs(metrics.cutsSeconds[0] - 2) < 0.1, `cut at ${metrics.cutsSeconds[0]}`);
    assert.equal(typeof metrics.loudness.integratedLufs, "number");
    assert.ok(existsSync(join(out, "frames", "f001.jpg")));
  });
});

test("a silent video has no loudness", () => {
  withVideo(false, ({ video, out }) => {
    assert.equal(runScript(["--video", video, "--out", out]).status, 0);
    const metrics = JSON.parse(readFileSync(join(out, "metrics.json"), "utf-8"));
    assert.equal(metrics.hasAudio, false);
    assert.equal(metrics.loudness, null);
  });
});

test("rejects bad arguments", () => {
  withVideo(false, ({ dir, video, out }) => {
    assert.match(runScript(["--out", out]).stderr, /Usage/);
    assert.match(runScript(["--video", join(dir, "missing.mp4"), "--out", out]).stderr, /Video not found/);
    assert.match(runScript(["--video", video, "--out", out, "--frame-every", "0"]).stderr, /frame-every/);
  });
});
