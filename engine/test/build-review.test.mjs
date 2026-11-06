import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../scripts/build-review.mjs", import.meta.url).pathname;

const runScript = (runDir) => spawnSync("node", [SCRIPT, "--run", runDir], { encoding: "utf-8" });

const withRun = (files, check) => {
  const runDir = mkdtempSync(join(tmpdir(), "siren-review-"));
  try {
    for (const path of files) {
      mkdirSync(join(runDir, path.split("/")[0]), { recursive: true });
      writeFileSync(join(runDir, path), "x");
    }
    check(runDir);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

test("gallery lists media by section and skips other files", () => {
  withRun(["frames/shot 1.png", "clips/a.mp4", "render/draft.mp4", "frames/notes.txt"], (runDir) => {
    assert.equal(runScript(runDir).status, 0);
    const html = readFileSync(join(runDir, "review.html"), "utf-8");
    assert.match(html, /<img src="frames\/shot%201\.png"/);
    assert.match(html, /<video src="clips\/a\.mp4"/);
    assert.match(html, /<video src="render\/draft\.mp4"/);
    assert.doesNotMatch(html, /notes\.txt/);
  });
});

test("gallery shows a character folder", () => {
  withRun(["candidates/a.jpg", "references/front.jpg", "tests/singing.mp4"], (runDir) => {
    assert.equal(runScript(runDir).status, 0);
    const html = readFileSync(join(runDir, "review.html"), "utf-8");
    assert.match(html, /<img src="candidates\/a\.jpg"/);
    assert.match(html, /<img src="references\/front\.jpg"/);
    assert.match(html, /<video src="tests\/singing\.mp4"/);
  });
});

test("file names cannot inject markup", () => {
  withRun(["frames/<img onerror=x>.png"], (runDir) => {
    assert.equal(runScript(runDir).status, 0);
    const html = readFileSync(join(runDir, "review.html"), "utf-8");
    assert.doesNotMatch(html, /<img onerror/);
    assert.match(html, /&lt;img onerror=x&gt;\.png/);
  });
});

test("run without media fails loudly", () => {
  withRun(["frames/notes.txt"], (runDir) => {
    const result = runScript(runDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No images or videos/);
  });
});
