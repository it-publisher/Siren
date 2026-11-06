import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { codeFont, headingFont } from "../fonts";
import { CHECK_THEME } from "../reel";

const CODE_LINES = [
  'const рилс = движок("story-clip");',
  'рилс.рендер("1080x1920");',
  "// кириллица и латиница на месте",
];
const CHARS_PER_FRAME = 0.75;
const TYPING_START_FRAME = 15;

const getVisibleText = (line: string, charsTyped: number) => {
  return line.slice(0, Math.max(0, Math.floor(charsTyped)));
};

export const Smoke: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 14 } });
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 100]);

  let charsLeft = (frame - TYPING_START_FRAME) * CHARS_PER_FRAME;
  const visibleLines = CODE_LINES.map((line) => {
    const text = getVisibleText(line, charsLeft);
    charsLeft -= line.length;
    return text;
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: CHECK_THEME.background,
        color: CHECK_THEME.text,
        justifyContent: "center",
        padding: 90,
      }}
    >
      <h1
        style={{
          fontFamily: headingFont,
          fontSize: 110,
          fontWeight: 700,
          margin: 0,
          transform: `scale(${titleScale})`,
          transformOrigin: "left center",
        }}
      >
        Движок <span style={{ color: CHECK_THEME.accent }}>работает</span>
      </h1>
      <div
        style={{
          fontFamily: codeFont,
          fontSize: 40,
          lineHeight: 1.7,
          marginTop: 70,
          minHeight: 300,
        }}
      >
        {visibleLines.map((text, index) => (
          <div key={CODE_LINES[index]}>{text || " "}</div>
        ))}
      </div>
      <div
        style={{
          backgroundColor: CHECK_THEME.accent,
          height: 12,
          marginTop: 60,
          width: `${progress}%`,
        }}
      />
      <div style={{ fontFamily: codeFont, fontSize: 36, marginTop: 30 }}>
        кадр {frame + 1} из {durationInFrames}
      </div>
    </AbsoluteFill>
  );
};
