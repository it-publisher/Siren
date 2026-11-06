// Переносит тайминги Whisper на текст сценария: подписи показывают сценарий, а не распознанный текст.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { normalizeWord } from "../src/normalize-word.mjs";

const MIN_SIMILARITY = 0.6;
const MIN_MATCHED_SHARE = 0.6;

const readOptions = () => {
  const { values } = parseArgs({
    options: {
      text: { type: "string" },
      timing: { type: "string" },
      audio: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.text || !values.timing || !values.audio || !values.out) {
    throw new Error("Usage: align-captions.mjs --text <txt> --timing <json> --audio <file> --out <json>");
  }
  for (const path of [values.text, values.timing, values.audio]) {
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  }
  return values;
};

// Отдельно стоящий знак вроде тире не озвучивается и остаётся при предыдущем слове.
const splitScriptWords = (text) => {
  const words = [];
  for (const part of text.split(/\s+/).filter(Boolean)) {
    if (normalizeWord(part) === "" && words.length > 0) {
      words[words.length - 1] += ` ${part}`;
      continue;
    }
    words.push(part);
  }
  return words;
};

const getEditDistance = (first, second) => {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i++) {
    const current = [i];
    for (let j = 1; j <= second.length; j++) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[second.length];
};

const isSimilar = (first, second) => {
  const longest = Math.max(first.length, second.length);
  if (longest === 0) return false;
  return 1 - getEditDistance(first, second) / longest >= MIN_SIMILARITY;
};

// Опорные пары: самая длинная общая последовательность похожих слов.
const findAnchors = (scriptKeys, heardKeys) => {
  const rows = scriptKeys.length;
  const columns = heardKeys.length;
  const table = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      const skip = Math.max(table[i + 1][j], table[i][j + 1]);
      table[i][j] = isSimilar(scriptKeys[i], heardKeys[j]) ? Math.max(skip, table[i + 1][j + 1] + 1) : skip;
    }
  }
  const anchors = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (isSimilar(scriptKeys[i], heardKeys[j]) && table[i][j] === table[i + 1][j + 1] + 1) {
      anchors.push([i++, j++]);
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return anchors;
};

// Слова без опоры делят промежуток пропорционально длине: длинное слово звучит дольше.
const fillGap = ({ scriptWords, heardWords, startMs, endMs }) => {
  const from = heardWords.length > 0 ? heardWords[0].startMs : startMs;
  const to = heardWords.length > 0 ? heardWords[heardWords.length - 1].endMs : endMs;
  const totalLength = scriptWords.reduce((sum, word) => sum + word.length, 0);
  const heard = heardWords.map((word) => word.text.trim()).join(" ");
  let cursor = from;
  return scriptWords.map((text) => {
    const wordEnd = cursor + ((to - from) * text.length) / totalLength;
    const word = { text, startMs: Math.round(cursor), endMs: Math.round(wordEnd), matched: false, heard };
    cursor = wordEnd;
    return word;
  });
};

const alignWords = ({ scriptWords, heardWords, durationMs }) => {
  const anchors = findAnchors(scriptWords.map(normalizeWord), heardWords.map((word) => normalizeWord(word.text)));
  const aligned = [];
  let scriptIndex = 0;
  let heardIndex = 0;
  let cursorMs = 0;
  for (const [anchorScript, anchorHeard] of [...anchors, [scriptWords.length, heardWords.length]]) {
    const next = heardWords[anchorHeard];
    aligned.push(
      ...fillGap({
        scriptWords: scriptWords.slice(scriptIndex, anchorScript),
        heardWords: heardWords.slice(heardIndex, anchorHeard),
        startMs: cursorMs,
        endMs: next ? next.startMs : durationMs,
      }),
    );
    if (next) {
      aligned.push({ text: scriptWords[anchorScript], startMs: next.startMs, endMs: next.endMs, matched: true });
      cursorMs = next.endMs;
    }
    scriptIndex = anchorScript + 1;
    heardIndex = anchorHeard + 1;
  }
  return aligned;
};

// Слово с нулевой длиной никогда не подсветится, поэтому занимает часть времени предыдущего.
const repairEmptyWords = (words) => {
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    const previous = words[index - 1];
    if (word.endMs > word.startMs) continue;
    const share = word.text.length / (word.text.length + previous.text.length);
    word.endMs = previous.endMs;
    word.startMs = Math.round(previous.endMs - (previous.endMs - previous.startMs) * share);
    previous.endMs = word.startMs;
  }
  return words;
};

const getAudioDurationMs = (audioPath) => {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath],
    { encoding: "utf-8" },
  );
  const seconds = Number(result.stdout);
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe failed for ${audioPath}: ${result.stderr || result.error}`);
  }
  return Math.round(seconds * 1000);
};

// На вокале Whisper выдаёт метки вроде ♪ и таймкоды за концом аудио: это не слова и не их время.
const cleanHeardWords = (captions, durationMs) =>
  captions
    .filter((word) => normalizeWord(word.text) !== "")
    .map((word) => ({ ...word, startMs: Math.min(word.startMs, durationMs), endMs: Math.min(word.endMs, durationMs) }));

const main = () => {
  const options = readOptions();
  const scriptWords = splitScriptWords(readFileSync(options.text, "utf-8"));
  const { captions } = JSON.parse(readFileSync(options.timing, "utf-8"));
  const durationMs = getAudioDurationMs(options.audio);
  const heardWords = cleanHeardWords(captions, durationMs);
  if (scriptWords.length === 0) throw new Error(`No words in ${options.text}`);
  if (heardWords.length === 0) throw new Error(`No captions in ${options.timing}`);

  // Номер слова нужен сценам: они начинаются с него в scenes.json.
  const words = repairEmptyWords(alignWords({ scriptWords, heardWords, durationMs })).map((word, index) => ({
    index,
    ...word,
  }));
  const matchedCount = words.filter((word) => word.matched).length;
  // Малое совпадение значит, что аудио не от этого текста, и подписи разъедутся.
  if (matchedCount / words.length < MIN_MATCHED_SHARE) {
    throw new Error(`Only ${matchedCount} of ${words.length} words matched. Is the audio from this script?`);
  }

  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify({ durationMs, words }, null, 2)}\n`);
  const mismatches = words.filter((word) => !word.matched).map((word) => `${word.text} <- ${word.heard || "(не слышно)"}`);
  process.stdout.write(`${JSON.stringify({ out: options.out, words: words.length, matched: matchedCount, mismatches }, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
}
