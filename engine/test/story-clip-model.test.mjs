import assert from "node:assert/strict";
import { test } from "node:test";
import { getLookSettings, getShotFrames, getSway, getTotalFrames, getVolumeStops, LOOK_SETTINGS, validateRun } from "../src/formats/story-clip/model.ts";

const FPS = 30;
const SHOTS = [
  { videoFile: "clips/a.mp4", seconds: 5 },
  { videoFile: "clips/b.mp4", seconds: 8 },
  { videoFile: "clips/c.mp4", seconds: 8 },
];
const validFile = { format: "story-clip", audioFile: "audio/track.wav", shots: SHOTS };

test("shots are measured in whole frames and add up to the reel", () => {
  assert.equal(getShotFrames(SHOTS[0], FPS), 150);
  assert.equal(getTotalFrames(SHOTS, FPS), 630);
});

test("audio fades in and out without gaps", () => {
  const { frames, volumes } = getVolumeStops(630, FPS);
  assert.deepEqual(volumes, [0, 1, 1, 0]);
  assert.equal(frames[0], 0);
  assert.equal(frames.at(-1), 630);
  for (let index = 1; index < frames.length; index++) assert.ok(frames[index] > frames[index - 1]);
});

for (const [name, look] of Object.entries(LOOK_SETTINGS)) {
  test(`${name}: sway never reveals the frame edge and moves smoothly`, () => {
    const marginX = (1080 * (look.swayScale - 1)) / 2;
    const marginY = (1920 * (look.swayScale - 1)) / 2;
    let previous = getSway(0, look.swayAmount);
    for (let frame = 1; frame < 3000; frame++) {
      const sway = getSway(frame, look.swayAmount);
      assert.ok(Math.abs(sway.xPx) < marginX, `x at ${frame}`);
      assert.ok(Math.abs(sway.yPx) < marginY, `y at ${frame}`);
      assert.ok(Math.abs(sway.xPx - previous.xPx) < 1.5, `x jump at ${frame}`);
      assert.ok(Math.abs(sway.yPx - previous.yPx) < 1.5, `y jump at ${frame}`);
      previous = sway;
    }
  });
}

test("a run without a look has no grain or filter", () => {
  const look = getLookSettings(undefined);
  assert.equal(look.filter, undefined);
  assert.equal(look.grainOpacity, 0);
});

test("validateRun accepts a correct run", () => {
  assert.doesNotThrow(() => validateRun(validFile));
  assert.doesNotThrow(() => validateRun({ ...validFile, look: "film", shots: [{ ...SHOTS[0], sway: true }] }));
  assert.throws(() => validateRun({ ...validFile, look: "vhs" }), /Unknown look/);
});

test("validateRun rejects a broken run", () => {
  assert.throws(() => validateRun({ ...validFile, format: "other" }), /Wrong format/);
  assert.throws(() => validateRun({ ...validFile, audioFile: "" }), /audioFile is required/);
  assert.throws(() => validateRun({ ...validFile, shots: [] }), /shots must not be empty/);
  assert.throws(() => validateRun({ ...validFile, shots: [{ videoFile: "", seconds: 5 }] }), /Shot 0 has no videoFile/);
  assert.throws(() => validateRun({ ...validFile, shots: [{ videoFile: "a.mp4", seconds: 0 }] }), /Shot 0 must last/);
});
