import assert from "node:assert/strict";
import { test } from "node:test";
import { getActiveCaption, MAX_CAPTION_HOLD_MS, MAX_WORDS_PER_CAPTION, splitIntoCaptions, validateRun } from "../src/formats/talking-closeup/model.ts";

const buildWords = (texts, stepMs = 500) =>
  texts.map((text, index) => ({ text, startMs: index * stepMs, endMs: (index + 1) * stepMs }));
const validFile = { format: "talking-closeup", videoFile: "clips/a.mp4", audioFile: "audio/a.wav", wordsFile: "timing/words.json" };

test("captions hold at most three upper-case words and break on punctuation", () => {
  const captions = splitIntoCaptions(buildWords(["Listen", "up", "and", "hold", "my", "hands,", "I", "can"]));
  assert.deepEqual(
    captions.map((caption) => caption.text),
    ["LISTEN UP AND", "HOLD MY HANDS", "I CAN"],
  );
  for (const caption of captions) assert.ok(caption.text.split(" ").length <= MAX_WORDS_PER_CAPTION);
});

test("punctuation ends a caption before the word limit", () => {
  const captions = splitIntoCaptions(buildWords(["say", "no,", "I", "can"]));
  assert.deepEqual(
    captions.map((caption) => caption.text),
    ["SAY NO", "I CAN"],
  );
});

test("a caption spans its words", () => {
  const [caption] = splitIntoCaptions(buildWords(["one", "two", "three"]));
  assert.equal(caption.startMs, 0);
  assert.equal(caption.endMs, 1500);
});

test("the active caption is the latest started one and disappears over instrumental gaps", () => {
  const captions = splitIntoCaptions([
    { text: "first,", startMs: 1000, endMs: 1500 },
    { text: "second", startMs: 5000, endMs: 5500 },
  ]);
  assert.equal(getActiveCaption(captions, 999), null);
  assert.equal(getActiveCaption(captions, 1000).text, "FIRST");
  assert.equal(getActiveCaption(captions, 1500 + MAX_CAPTION_HOLD_MS - 1).text, "FIRST");
  assert.equal(getActiveCaption(captions, 1500 + MAX_CAPTION_HOLD_MS), null);
  assert.equal(getActiveCaption(captions, 5100).text, "SECOND");
});

test("validateRun accepts a correct run", () => {
  assert.doesNotThrow(() => validateRun(validFile, { durationMs: 1500, words: buildWords(["one", "two", "three"]) }));
});

test("validateRun rejects missing files and a wrong format", () => {
  const words = { durationMs: 1000, words: buildWords(["one"]) };
  assert.throws(() => validateRun({ ...validFile, format: "other" }, words), /Wrong format/);
  assert.throws(() => validateRun({ ...validFile, videoFile: "" }, words), /videoFile is required/);
});

test("validateRun rejects broken timings", () => {
  assert.throws(() => validateRun(validFile, { durationMs: 1000, words: [] }), /words must not be empty/);
  assert.throws(() => validateRun(validFile, { durationMs: 0, words: buildWords(["one"]) }), /durationMs must be positive/);
  assert.throws(() => validateRun(validFile, { durationMs: 100, words: buildWords(["one"]) }), /ends after the audio/);
  assert.throws(
    () => validateRun(validFile, { durationMs: 1000, words: [{ text: "one", startMs: 200, endMs: 200 }] }),
    /has no duration/,
  );
  assert.throws(
    () =>
      validateRun(validFile, {
        durationMs: 1000,
        words: [
          { text: "one", startMs: 500, endMs: 600 },
          { text: "two", startMs: 100, endMs: 200 },
        ],
      }),
    /out of order/,
  );
});
