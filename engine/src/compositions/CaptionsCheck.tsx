import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Html5Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { codeFont, headingFont } from "../fonts";
import { CHECK_THEME, REEL_FPS } from "../reel";

const MAX_WORDS_PER_PHRASE = 4;
const PHRASE_END = /[.,!?…:;»]$/;

type CaptionWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type CaptionsCheckProps = {
  audioFile: string;
  wordsFile: string;
  words: CaptionWord[];
};

export const loadCaptions: CalculateMetadataFunction<CaptionsCheckProps> = async ({ props }) => {
  const response = await fetch(staticFile(props.wordsFile));
  if (!response.ok) {
    throw new Error(`Cannot load ${props.wordsFile}: ${response.status}. Check --public-dir.`);
  }
  const { durationMs, words } = await response.json();
  return {
    durationInFrames: Math.ceil((durationMs / 1000) * REEL_FPS),
    props: { ...props, words },
  };
};

const splitIntoPhrases = (words: CaptionWord[]) => {
  const phrases: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  for (const word of words) {
    current.push(word);
    if (current.length === MAX_WORDS_PER_PHRASE || PHRASE_END.test(word.text)) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
};

const getCurrentPhrase = (phrases: CaptionWord[][], timeMs: number) => {
  const started = phrases.filter((phrase) => phrase[0].startMs <= timeMs);
  return started[started.length - 1] ?? phrases[0];
};

export const CaptionsCheck: React.FC<CaptionsCheckProps> = ({ audioFile, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = (frame / fps) * 1000;
  const phrase = getCurrentPhrase(splitIntoPhrases(words), timeMs);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: CHECK_THEME.background,
        color: CHECK_THEME.text,
        justifyContent: "center",
        padding: 80,
      }}
    >
      <Html5Audio src={staticFile(audioFile)} />
      <div
        style={{
          fontFamily: headingFont,
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 1.25,
          textAlign: "center",
        }}
      >
        {phrase.map((word) => (
          <span
            key={word.startMs + word.text}
            style={{ color: timeMs >= word.startMs && timeMs < word.endMs ? CHECK_THEME.accent : CHECK_THEME.text }}
          >
            {word.text}{" "}
          </span>
        ))}
      </div>
      <div
        style={{
          bottom: 120,
          fontFamily: codeFont,
          fontSize: 34,
          left: 0,
          position: "absolute",
          right: 0,
          textAlign: "center",
        }}
      >
        {(timeMs / 1000).toFixed(2)} с
      </div>
    </AbsoluteFill>
  );
};
