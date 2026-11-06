// Замеры ролика для разбора трендов и новых форматов: только то, что считается, без оценок.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const USAGE = "Usage: analyze-video.mjs --video <file> --out <dir> [--frame-every <seconds>] [--scene-threshold <0-1>]";
const FRAME_WIDTH = 360;
// Детектор отмечает одну склейку дважды, если смена растянута на пару кадров. На быстром монтаже настоящие склейки идут от 0,13 с.
const MIN_CUT_GAP_SECONDS = 0.1;

const runTool = (tool, args) => {
  const result = spawnSync(tool, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Cannot run ${tool}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr.slice(-500)}`);
  return result;
};

const readOptions = () => {
  const { values } = parseArgs({
    options: {
      video: { type: "string" },
      out: { type: "string" },
      "frame-every": { type: "string", default: "2" },
      "scene-threshold": { type: "string", default: "0.3" },
    },
  });
  if (!values.video || !values.out) throw new Error(USAGE);
  if (!existsSync(values.video)) throw new Error(`Video not found: ${values.video}`);
  const frameEvery = Number(values["frame-every"]);
  const sceneThreshold = Number(values["scene-threshold"]);
  if (!(frameEvery > 0)) throw new Error("--frame-every must be above 0");
  if (!(sceneThreshold > 0 && sceneThreshold < 1)) throw new Error("--scene-threshold must be between 0 and 1");
  return { video: values.video, out: values.out, frameEvery, sceneThreshold };
};

const readStreams = (video) => {
  const { stdout } = runTool("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", video]);
  const { streams, format } = JSON.parse(stdout);
  const picture = streams.find((stream) => stream.codec_type === "video");
  if (!picture) throw new Error(`No video stream in ${video}`);
  const [numerator, denominator] = picture.r_frame_rate.split("/").map(Number);
  return {
    width: picture.width,
    height: picture.height,
    fps: Math.round((numerator / denominator) * 100) / 100,
    durationSeconds: Number(format.duration),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
};

const mergeCloseCuts = (cuts) =>
  cuts.reduce((merged, cut) => (merged.length > 0 && cut - merged.at(-1) <= MIN_CUT_GAP_SECONDS ? merged : [...merged, cut]), []);

const findCuts = (video, threshold) => {
  const { stderr } = runTool("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-filter:v", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"]);
  return mergeCloseCuts([...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1])));
};

const measureLoudness = (video) => {
  const { stderr } = runTool("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const integrated = summary.match(/I:\s+(-?[\d.]+) LUFS/);
  const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/);
  if (!integrated || !peak) throw new Error(`Cannot read loudness of ${video}`);
  return { integratedLufs: Number(integrated[1]), truePeakDbfs: Number(peak[1]) };
};

const extractFrames = (video, out, frameEvery) => {
  const dir = join(out, "frames");
  mkdirSync(dir, { recursive: true });
  runTool("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", video, "-vf", `fps=1/${frameEvery},scale=${FRAME_WIDTH}:-2`, join(dir, "f%03d.jpg")]);
  return dir;
};

const main = () => {
  const { video, out, frameEvery, sceneThreshold } = readOptions();
  mkdirSync(out, { recursive: true });
  const streams = readStreams(video);
  const cutsSeconds = findCuts(video, sceneThreshold);
  const metrics = {
    video,
    ...streams,
    sceneThreshold,
    cutsSeconds,
    shots: cutsSeconds.length + 1,
    averageShotSeconds: Math.round((streams.durationSeconds / (cutsSeconds.length + 1)) * 100) / 100,
    loudness: streams.hasAudio ? measureLoudness(video) : null,
    framesDir: extractFrames(video, out, frameEvery),
    frameEverySeconds: frameEvery,
  };
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ metrics: join(out, "metrics.json"), shots: metrics.shots, durationSeconds: metrics.durationSeconds })}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
}
