import {
  AbsoluteFill,
  type CalculateMetadataFunction,
  Html5Audio,
  interpolate,
  OffthreadVideo,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { REEL_FPS } from "../../reel";
import { getLookSettings, getShotFrames, getSway, getTotalFrames, getVolumeStops, type Shot, type StoryClipFile, validateRun } from "./model";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const VIDEO_STYLE = { height: "100%", objectFit: "cover", width: "100%" } as const;

type LookSettings = ReturnType<typeof getLookSettings>;

export type StoryClipProps = {
  scenesFile: string;
  run: { file: StoryClipFile } | null;
};

export const loadStoryClipRun: CalculateMetadataFunction<StoryClipProps> = async ({ props }) => {
  const response = await fetch(staticFile(props.scenesFile), { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${props.scenesFile}: ${response.status}. Check --public-dir.`);
  const file: StoryClipFile = await response.json();
  validateRun(file);
  return {
    durationInFrames: getTotalFrames(file.shots, REEL_FPS),
    props: { ...props, run: { file } },
  };
};

const ShotVideo: React.FC<{ shot: Shot; look: LookSettings }> = ({ shot, look }) => {
  const frame = useCurrentFrame();
  if (!shot.sway) return <OffthreadVideo muted src={staticFile(shot.videoFile)} style={VIDEO_STYLE} />;

  const { xPx, yPx, rotateDeg } = getSway(frame, look.swayAmount);
  return (
    <AbsoluteFill style={{ transform: `translate(${xPx}px, ${yPx}px) rotate(${rotateDeg}deg) scale(${look.swayScale})` }}>
      <OffthreadVideo muted src={staticFile(shot.videoFile)} style={VIDEO_STYLE} />
    </AbsoluteFill>
  );
};

// Новое зерно на каждом кадре: неподвижный шум выглядел бы как грязь на объективе.
const FilmGrain: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity }}>
      <svg height="100%" width="100%">
        <filter id="grain">
          <feTurbulence baseFrequency="0.9" numOctaves={2} seed={frame} stitchTiles="stitch" type="fractalNoise" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect filter="url(#grain)" height="100%" width="100%" />
      </svg>
    </AbsoluteFill>
  );
};

export const StoryClip: React.FC<StoryClipProps> = ({ run }) => {
  const { durationInFrames, fps } = useVideoConfig();
  if (!run) throw new Error("Run data is missing: calculateMetadata did not load scenes.json");

  const { frames, volumes } = getVolumeStops(durationInFrames, fps);
  const look = getLookSettings(run.file.look);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Звук клипов отключён: в них или шум модели, или сжатая копия трека. Общая дорожка держит синхрон всех планов. */}
      <Html5Audio src={staticFile(run.file.audioFile)} volume={(frame) => interpolate(frame, frames, volumes, CLAMP)} />
      <AbsoluteFill style={look.filter ? { filter: look.filter } : undefined}>
        <Series>
          {run.file.shots.map((shot) => (
            <Series.Sequence key={shot.videoFile} durationInFrames={getShotFrames(shot, fps)}>
              <ShotVideo look={look} shot={shot} />
            </Series.Sequence>
          ))}
        </Series>
      </AbsoluteFill>
      {/* Приподнятый чёрный: как на плёнке, тени не проваливаются в цифровой ноль. */}
      {look.liftOpacity > 0 ? <AbsoluteFill style={{ backgroundColor: "#1c2024", mixBlendMode: "lighten", opacity: look.liftOpacity }} /> : null}
      {look.grainOpacity > 0 ? <FilmGrain opacity={look.grainOpacity} /> : null}
    </AbsoluteFill>
  );
};
