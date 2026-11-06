export const MAX_WORDS_PER_CAPTION = 3;
// Дольше этой паузы подпись не висит: на проигрыше поверх музыки текста быть не должно.
export const MAX_CAPTION_HOLD_MS = 600;
const CAPTION_END = /[.,!?…:;]$/;

export type TalkingCloseupFile = {
  format: "talking-closeup";
  videoFile: string;
  audioFile: string;
  wordsFile: string;
};

export type TimedWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type WordsFile = {
  durationMs: number;
  words: TimedWord[];
};

export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
};

const buildCaption = (words: TimedWord[]): Caption => ({
  text: words
    .map((word) => word.text)
    .join(" ")
    .toUpperCase()
    // Подпись и так заканчивается вместе с фразой, а запятая в конце крупного текста выглядит ошибкой.
    .replace(/[.,;:]+$/, ""),
  startMs: words[0].startMs,
  endMs: words[words.length - 1].endMs,
});

export const splitIntoCaptions = (words: TimedWord[]): Caption[] => {
  const captions: Caption[] = [];
  let current: TimedWord[] = [];
  for (const word of words) {
    current.push(word);
    if (current.length === MAX_WORDS_PER_CAPTION || CAPTION_END.test(word.text)) {
      captions.push(buildCaption(current));
      current = [];
    }
  }
  if (current.length > 0) captions.push(buildCaption(current));
  return captions;
};

export const getActiveCaption = (captions: Caption[], timeMs: number): Caption | null => {
  const started = captions.filter((caption) => caption.startMs <= timeMs);
  const caption = started[started.length - 1];
  if (!caption || timeMs >= caption.endMs + MAX_CAPTION_HOLD_MS) return null;
  return caption;
};

const collectFileErrors = (file: TalkingCloseupFile) => {
  const errors: string[] = [];
  if (file.format !== "talking-closeup") errors.push(`Wrong format: ${file.format}`);
  for (const field of ["videoFile", "audioFile", "wordsFile"] as const) {
    if (!file[field]) errors.push(`${field} is required`);
  }
  return errors;
};

const collectWordErrors = ({ durationMs, words }: WordsFile) => {
  const errors: string[] = [];
  if (!(durationMs > 0)) errors.push("durationMs must be positive");
  if (!Array.isArray(words) || words.length === 0) return [...errors, "words must not be empty"];
  words.forEach((word, index) => {
    if (word.endMs <= word.startMs) errors.push(`Word ${index} "${word.text}" has no duration`);
    if (word.endMs > durationMs) errors.push(`Word ${index} "${word.text}" ends after the audio`);
    if (index > 0 && word.startMs < words[index - 1].startMs) errors.push(`Word ${index} "${word.text}" is out of order`);
  });
  return errors;
};

export const validateRun = (file: TalkingCloseupFile, wordsFile: WordsFile) => {
  const errors = [...collectFileErrors(file), ...collectWordErrors(wordsFile)];
  if (errors.length > 0) throw new Error(`scenes.json is invalid:\n${errors.join("\n")}`);
};
