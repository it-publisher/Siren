// Снимает тайминги слов из аудио через whisper.cpp и пишет их в JSON.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from "@remotion/install-whisper-cpp";

const WHISPER_VERSION = "1.5.5";
const WHISPER_SAMPLE_RATE = "16000";
const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WHISPER_DIR = join(ENGINE_DIR, ".whisper");

const readOptions = () => {
  const { values } = parseArgs({
    options: {
      audio: { type: "string" },
      out: { type: "string" },
      language: { type: "string", default: "en" },
      model: { type: "string", default: "medium" },
    },
  });
  if (!values.audio || !values.out) {
    throw new Error("Usage: transcribe.mjs --audio <file> --out <json> [--language en] [--model medium]");
  }
  if (!existsSync(values.audio)) {
    throw new Error(`Audio file not found: ${values.audio}`);
  }
  return values;
};

// whisper.cpp принимает только 16 кГц WAV.
const convertToWhisperWav = (audioPath, wavPath) => {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", audioPath, "-ar", WHISPER_SAMPLE_RATE, "-ac", "1", "-c:a", "pcm_s16le", wavPath],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.error}`);
  }
};

// Whisper режет слова на токены («науч» + «ились»). Новое слово начинается с пробела,
// а знаки препинания приходят без него и остаются при предыдущем слове.
const mergeTokensIntoWords = (tokens) => {
  const words = [];
  for (const token of tokens) {
    const previous = words.at(-1);
    if (!previous || token.text.startsWith(" ")) {
      words.push({ ...token });
      continue;
    }
    previous.text += token.text;
    previous.endMs = token.endMs;
    if (token.confidence !== null && previous.confidence !== null) {
      previous.confidence = Math.min(previous.confidence, token.confidence);
    }
  }
  return words;
};

const main = async () => {
  const options = readOptions();
  const whisperPath = join(WHISPER_DIR, "whisper.cpp");
  const modelFolder = join(WHISPER_DIR, "models");
  mkdirSync(modelFolder, { recursive: true });

  await installWhisperCpp({ to: whisperPath, version: WHISPER_VERSION, printOutput: false });
  await downloadWhisperModel({ model: options.model, folder: modelFolder, printOutput: false });

  const tempDir = mkdtempSync(join(tmpdir(), "siren-whisper-"));
  try {
    const wavPath = join(tempDir, "input.wav");
    convertToWhisperWav(options.audio, wavPath);

    const startedAt = Date.now();
    const output = await transcribe({
      inputPath: wavPath,
      whisperPath,
      whisperCppVersion: WHISPER_VERSION,
      model: options.model,
      modelFolder,
      language: options.language,
      tokenLevelTimestamps: true,
      printOutput: false,
    });
    const captions = mergeTokensIntoWords(toCaptions({ whisperCppOutput: output }).captions);

    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(
      options.out,
      `${JSON.stringify({ language: options.language, model: options.model, captions }, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ out: options.out, words: captions.length, seconds: (Date.now() - startedAt) / 1000 })}\n`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
