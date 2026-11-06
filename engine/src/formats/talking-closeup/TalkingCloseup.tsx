import { useMemo } from "react";
import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Html5Audio,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { headingFont } from "../../fonts";
import { REEL_FPS } from "../../reel";
import { getActiveCaption, splitIntoCaptions, type TalkingCloseupFile, validateRun, type WordsFile } from "./model";

const CAPTION_LEFT_PX = 64;
// Ниже верхней служебной зоны Reels: там лежат подпись аккаунта и кнопки.
const CAPTION_TOP_PX = 300;
const CAPTION_FONT_SIZE_PX = 84;

export type TalkingCloseupProps = {
  scenesFile: string;
  run: { file: TalkingCloseupFile; wordsFile: WordsFile } | null;
};

const fetchJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(staticFile(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${path}: ${response.status}. Check --public-dir.`);
  return response.json();
};

export const loadTalkingCloseupRun: CalculateMetadataFunction<TalkingCloseupProps> = async ({ props }) => {
  const file = await fetchJson<TalkingCloseupFile>(props.scenesFile);
  const wordsFile = await fetchJson<WordsFile>(file.wordsFile);
  validateRun(file, wordsFile);
  return {
    durationInFrames: Math.ceil((wordsFile.durationMs / 1000) * REEL_FPS),
    props: { ...props, run: { file, wordsFile } },
  };
};

export const TalkingCloseup: React.FC<TalkingCloseupProps> = ({ run }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const captions = useMemo(() => splitIntoCaptions(run?.wordsFile.words ?? []), [run]);
  if (!run) throw new Error("Run data is missing: calculateMetadata did not load scenes.json");

  const caption = getActiveCaption(captions, (frame / fps) * 1000);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Звук отдельной дорожкой: у клипа он сжат моделью, а исходник можно заменить без новой генерации. */}
      <OffthreadVideo muted src={staticFile(run.file.videoFile)} style={{ height: "100%", objectFit: "cover", width: "100%" }} />
      <Html5Audio src={staticFile(run.file.audioFile)} />
      {caption ? (
        <div
          style={{
            color: "#FFFFFF",
            fontFamily: headingFont,
            fontSize: CAPTION_FONT_SIZE_PX,
            fontWeight: 700,
            left: CAPTION_LEFT_PX,
            lineHeight: 1.15,
            position: "absolute",
            right: CAPTION_LEFT_PX,
            textShadow: "0 4px 24px rgba(0, 0, 0, 0.75)",
            top: CAPTION_TOP_PX,
          }}
        >
          {caption.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
