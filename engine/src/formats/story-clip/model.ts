export const AUDIO_FADE_IN_SECONDS = 0.3;
export const AUDIO_FADE_OUT_SECONDS = 1.5;
// Запас масштаба: при покачивании за края кадра не должна выглядывать пустота.
export const LOOK_SETTINGS = {
  film: { filter: "saturate(0.88) contrast(0.95) brightness(0.98)", grainOpacity: 0.14, liftOpacity: 0, swayAmount: 1, swayScale: 1.04 },
  "film-strong": { filter: "saturate(0.72) contrast(0.9) brightness(0.95) sepia(0.08)", grainOpacity: 0.3, liftOpacity: 0.07, swayAmount: 1.6, swayScale: 1.06 },
} as const;
export const NO_LOOK = { filter: undefined, grainOpacity: 0, liftOpacity: 0, swayAmount: 1, swayScale: 1.04 };

export type LookName = keyof typeof LOOK_SETTINGS;

export const getLookSettings = (look?: LookName) => (look ? LOOK_SETTINGS[look] : NO_LOOK);

export type Shot = {
  videoFile: string;
  seconds: number;
  sway?: boolean;
};

export type StoryClipFile = {
  format: "story-clip";
  audioFile: string;
  look?: LookName;
  shots: Shot[];
};

export const getShotFrames = (shot: Shot, fps: number) => Math.round(shot.seconds * fps);

export const getTotalFrames = (shots: Shot[], fps: number) =>
  shots.reduce((total, shot) => total + getShotFrames(shot, fps), 0);

// Вход и выход плавные: фрагмент вырезан из середины трека, а резкий обрыв звука слышен как ошибка.
export const getVolumeStops = (totalFrames: number, fps: number) => ({
  frames: [0, AUDIO_FADE_IN_SECONDS * fps, totalFrames - AUDIO_FADE_OUT_SECONDS * fps, totalFrames],
  volumes: [0, 1, 1, 0],
});

// Несколько синусов с некратными частотами: движение не повторяется и похоже на камеру в руках, а не на маятник.
export const getSway = (frame: number, amount = 1) => ({
  xPx: (Math.sin(frame * 0.031) * 9 + Math.sin(frame * 0.083) * 4) * amount,
  yPx: (Math.sin(frame * 0.027 + 1) * 7 + Math.sin(frame * 0.071) * 3) * amount,
  rotateDeg: Math.sin(frame * 0.019 + 2) * 0.18 * amount,
});

export const validateRun = (file: StoryClipFile) => {
  const errors: string[] = [];
  if (file.format !== "story-clip") errors.push(`Wrong format: ${file.format}`);
  if (!file.audioFile) errors.push("audioFile is required");
  if (file.look && !(file.look in LOOK_SETTINGS)) errors.push(`Unknown look: ${file.look}`);
  if (!Array.isArray(file.shots) || file.shots.length === 0) errors.push("shots must not be empty");
  (file.shots ?? []).forEach((shot, index) => {
    if (!shot.videoFile) errors.push(`Shot ${index} has no videoFile`);
    if (!(shot.seconds > 0)) errors.push(`Shot ${index} must last more than 0 seconds`);
  });
  if (errors.length > 0) throw new Error(`scenes.json is invalid:\n${errors.join("\n")}`);
};
