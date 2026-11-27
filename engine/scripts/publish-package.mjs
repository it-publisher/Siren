// Отправка рилса в Siren Publisher и забор результатов: docs/guides/publishing.md.
// Пакет = video.mp4 + manifest.json (+ story.mp4), файл .ready уходит последним: публикатор берёт только готовые папки.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = `Usage:
  publish-package.mjs send --run <run-id> [--story-video <file>] [--publish-at <ISO>] [--dry-run]
  publish-package.mjs sync`;
const DEFAULT_REMOTE = "publisher-siren:";
const SCHEMA_VERSION = 2;
const REEL_ID_RE = /^\d{4}-\d{2}-\d{2}-music-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORMS = ["telegram_story", "instagram", "youtube", "tiktok"];
const PLATFORM_NAMES = { telegram_story: "сторис Telegram", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
// Лимиты — копия валидатора публикатора (app/manifest.py): ошибка ловится до отправки, а не в боте.
const STORY_MAX_SECONDS = 60;
// Запас до лимита сторис: обрезка копией режет по пакетам и может выйти на кадр дальше.
const STORY_CUT_SECONDS = 59.5;
const MIN_SECONDS = 3;
const VIDEO_CODECS = ["h264", "hevc"];
const TELEGRAM_CAPTION_MAX = 2048;
const INSTAGRAM_CAPTION_MAX = 2200;
const INSTAGRAM_HASHTAGS_MAX = 30;
const INSTAGRAM_MENTIONS_MAX = 20;
const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
const YOUTUBE_TAGS_MAX = 500;
const TIKTOK_CAPTION_MAX = 2200;
const LINK_LABEL_MAX = 40;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /@[\p{L}\p{N}_.]+/gu;

const say = (line) => process.stdout.write(`${line}\n`);

const runTool = (tool, args) => {
  const result = spawnSync(tool, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Не запускается ${tool}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${tool} завершился с ошибкой: ${result.stderr.slice(-500)}`);
  return result.stdout;
};

const readOptions = () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      run: { type: "string" },
      "story-video": { type: "string" },
      "publish-at": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      // Для тестов: другой корень репозитория и локальная папка вместо сервера.
      root: { type: "string", default: resolve(dirname(fileURLToPath(import.meta.url)), "../..") },
      remote: { type: "string", default: process.env.PUBLISHER_REMOTE || DEFAULT_REMOTE },
    },
  });
  const [command] = positionals;
  if (command === "sync") return { command, ...values };
  if (command !== "send" || !values.run) throw new Error(USAGE);
  if (!REEL_ID_RE.test(values.run)) throw new Error(`run-id должен иметь вид YYYY-MM-DD-music-<slug>: ${values.run}`);
  const publishAt = values["publish-at"];
  if (publishAt && (Number.isNaN(Date.parse(publishAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(publishAt))) {
    throw new Error(`--publish-at: нужно время ISO с часовым поясом, например 2026-12-01T18:30:00+03:00`);
  }
  return { command, ...values, storyVideo: values["story-video"], publishAt, dryRun: values["dry-run"] };
};

// ---------- Видео ----------

const probeVideo = (path) => {
  const stdout = runTool("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", path]);
  const { streams, format } = JSON.parse(stdout);
  const picture = streams.find((stream) => stream.codec_type === "video");
  if (!picture) throw new Error(`В ${path} нет видеодорожки`);
  return { durationSeconds: Number(format.duration), width: picture.width, height: picture.height, codec: picture.codec_name };
};

const checkVideo = (video) => {
  const errors = [];
  if (!VIDEO_CODECS.includes(video.codec)) errors.push(`${video.file}: кодек ${video.codec}, Instagram принимает H.264 или HEVC`);
  if (video.duration_sec < MIN_SECONDS) errors.push(`${video.file}: ${video.duration_sec.toFixed(1)} с, минимум ${MIN_SECONDS} с`);
  return errors;
};

// Копия без перекодирования: moov в начало файла (без этого Instagram не принимает) и только видео со звуком.
const remux = (source, target, maxSeconds) => {
  const cut = maxSeconds ? ["-t", String(maxSeconds)] : [];
  runTool("ffmpeg", ["-v", "error", "-i", source, ...cut, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-y", target]);
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const describeVideo = (path, file) => {
  const info = probeVideo(path);
  return { file, duration_sec: Math.round(info.durationSeconds * 1000) / 1000, width: info.width, height: info.height, sha256: sha256(path), codec: info.codec };
};

// codec нужен только для проверки до отправки: схема манифеста публикатора его не содержит.
const toManifestVideo = (video) => video && { file: video.file, duration_sec: video.duration_sec, width: video.width, height: video.height, sha256: video.sha256 };

// ---------- Подписи ----------

const utf8Bytes = (text) => Buffer.byteLength(text, "utf-8");
const countMatches = (text, re) => (text.match(re) || []).length;

// Возвращают true, если поле — строка: только тогда его можно проверять дальше без падения.
const checkString = (errors, field, value) => {
  if (typeof value === "string") return true;
  errors.push(`${field}: нужна строка`);
  return false;
};

const checkLength = (errors, field, text, max) => {
  if (!checkString(errors, field, text)) return false;
  if (text.length > max) errors.push(`${field}: ${text.length} символов, максимум ${max}`);
  return true;
};

const checkStory = (block, errors) => {
  checkLength(errors, "telegram_story.caption", block.caption ?? "", TELEGRAM_CAPTION_MAX);
  const areas = block.areas ?? [];
  if (!Array.isArray(areas)) return errors.push("telegram_story.areas: нужен массив");
  for (const area of areas) {
    if (area.type !== "link") continue;
    if (!/^(https?|tg):\/\/\S+$/.test(area.url ?? "")) errors.push(`telegram_story.areas: неверная ссылка ${area.url}`);
    if (!area.label || area.label.length > LINK_LABEL_MAX) errors.push(`telegram_story.areas: label от 1 до ${LINK_LABEL_MAX} символов`);
  }
};

const checkInstagram = (block, errors) => {
  const caption = block.caption ?? "";
  if (!checkLength(errors, "instagram.caption", caption, INSTAGRAM_CAPTION_MAX)) return;
  const hashtags = countMatches(caption, HASHTAG_RE);
  if (hashtags > INSTAGRAM_HASHTAGS_MAX) errors.push(`instagram.caption: хэштегов ${hashtags}, максимум ${INSTAGRAM_HASHTAGS_MAX}`);
  const mentions = countMatches(caption, MENTION_RE);
  if (mentions > INSTAGRAM_MENTIONS_MAX) errors.push(`instagram.caption: упоминаний ${mentions}, максимум ${INSTAGRAM_MENTIONS_MAX}`);
};

const checkYoutubeTags = (tags, errors) => {
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) return errors.push("youtube.tags: нужен массив строк");
  // Правило YouTube: запятые между тегами считаются, тег с пробелом — в кавычках.
  const tagsLength = tags.reduce((sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0), 0) + Math.max(tags.length - 1, 0);
  if (tagsLength > YOUTUBE_TAGS_MAX) errors.push(`youtube.tags: ${tagsLength} символов, максимум ${YOUTUBE_TAGS_MAX}`);
};

const checkYoutube = (block, errors) => {
  const title = block.title ?? "";
  const description = block.description ?? "";
  if (checkLength(errors, "youtube.title", title, YOUTUBE_TITLE_MAX)) {
    if (block.enabled && !title.trim()) errors.push("youtube.title: нужен заголовок");
    if (/[<>]/.test(title)) errors.push("youtube.title: символы < и > запрещены");
  }
  if (checkString(errors, "youtube.description", description)) {
    if (utf8Bytes(description) > YOUTUBE_DESCRIPTION_MAX_BYTES) errors.push(`youtube.description: больше ${YOUTUBE_DESCRIPTION_MAX_BYTES} байт`);
    if (/[<>]/.test(description)) errors.push("youtube.description: символы < и > запрещены");
  }
  checkYoutubeTags(block.tags ?? [], errors);
};

const checkTiktok = (block, errors) => {
  // Длина в единицах UTF-16 — именно так считает TikTok, и так же length у строк JS.
  checkLength(errors, "tiktok.caption", block.caption ?? "", TIKTOK_CAPTION_MAX);
};

const PLATFORM_CHECKS = { telegram_story: checkStory, instagram: checkInstagram, youtube: checkYoutube, tiktok: checkTiktok };

const checkPlatforms = (platforms) => {
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) return ["platforms.json: нужен объект с площадками"];
  const errors = [];
  for (const [name, block] of Object.entries(platforms)) {
    if (!PLATFORMS.includes(name)) {
      errors.push(`platforms.json: неизвестная площадка ${name}, допустимо: ${PLATFORMS.join(", ")}`);
      continue;
    }
    if (block === null) continue;
    if (typeof block !== "object" || Array.isArray(block)) {
      errors.push(`${name}: нужен объект с полями площадки`);
      continue;
    }
    if (typeof block.enabled !== "boolean") errors.push(`${name}.enabled: нужно true или false`);
    PLATFORM_CHECKS[name](block, errors);
  }
  if (!PLATFORMS.some((name) => platforms[name]?.enabled)) errors.push("platforms.json: не включено ни одной площадки");
  return errors;
};

// ---------- Отправка ----------

const readJson = (path) => {
  if (!existsSync(path)) throw new Error(`Нет файла ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`${path}: неверный JSON: ${error.message}`);
  }
};

const readCharacter = (runDir) => {
  const brief = join(runDir, "brief.yaml");
  if (!existsSync(brief)) return "";
  const match = readFileSync(brief, "utf-8").match(/^character:\s*"?([^"#\n]*?)"?\s*(#.*)?$/m);
  return match ? match[1].trim() : "";
};

const isoLocal = (date) => {
  const offset = -date.getTimezoneOffset();
  const pad = (value) => String(Math.floor(Math.abs(value))).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`;
};

const buildStoryVideo = (options, packageDir, main, storyEnabled) => {
  if (options.storyVideo && !storyEnabled) {
    say("⚠️ Сторис выключена в platforms.json, --story-video не используется");
    return { video: null, note: null };
  }
  if (options.storyVideo) {
    remux(options.storyVideo, join(packageDir, "story.mp4"));
    return { video: describeVideo(join(packageDir, "story.mp4"), "story.mp4"), note: "сторис: отдельное видео" };
  }
  if (!storyEnabled || main.duration_sec <= STORY_MAX_SECONDS) return { video: null, note: null };
  remux(join(packageDir, "video.mp4"), join(packageDir, "story.mp4"), STORY_CUT_SECONDS);
  return { video: describeVideo(join(packageDir, "story.mp4"), "story.mp4"), note: `сторис: первые ${STORY_CUT_SECONDS} с ролика` };
};

const buildPackage = (options, runDir, packageDir, platforms) => {
  const source = join(runDir, "render", "final.mp4");
  if (!existsSync(source)) throw new Error(`Нет видео ${source}`);
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });
  remux(source, join(packageDir, "video.mp4"));
  const video = describeVideo(join(packageDir, "video.mp4"), "video.mp4");
  const story = buildStoryVideo(options, packageDir, video, Boolean(platforms.telegram_story?.enabled));
  const errors = [video, story.video].filter(Boolean).flatMap(checkVideo);
  if (story.video && story.video.duration_sec > STORY_MAX_SECONDS) errors.push(`story.mp4: ${story.video.duration_sec} с, максимум ${STORY_MAX_SECONDS} с`);
  if (errors.length > 0) throw new Error(`Пакет не собран:\n- ${errors.join("\n- ")}`);
  const manifest = {
    schema_version: SCHEMA_VERSION,
    reel_id: options.run,
    created_at: isoLocal(new Date()),
    character: readCharacter(runDir),
    video: toManifestVideo(video),
    story_video: toManifestVideo(story.video),
    publish_at: options.publishAt ?? null,
    platforms,
    notes: "",
  };
  writeFileSync(join(packageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, storyNote: story.note };
};

// Подписи отдельными файлами: caption.txt уходит в published/, TikTok владелец выкладывает руками.
const writeCaptionFiles = (runDir, platforms) => {
  if (platforms.instagram?.caption) writeFileSync(join(runDir, "caption.txt"), `${platforms.instagram.caption}\n`);
  if (platforms.tiktok?.caption) writeFileSync(join(runDir, "caption-tiktok.txt"), `${platforms.tiktok.caption}\n`);
};

// Встроенный в macOS openrsync не умеет --remove-source-files, нужен rsync 3 из Homebrew.
const checkRsync = () => {
  const version = runTool("rsync", ["--version"]);
  if (!/rsync\s+version\s+3\./.test(version)) throw new Error("Нужен rsync 3: brew install rsync, затем открыть новый Терминал");
};

const uploadPackage = (remote, packageDir, runId) => {
  const target = `${remote}inbox/${runId}/`;
  // Повторная отправка в ту же папку: старый .ready и лишний story.mp4 удаляются до заливки,
  // иначе публикатор может взять смесь старого и нового пакета.
  runTool("rsync", ["-a", "--partial", "--delete-before", "--delete-excluded", "--exclude", ".ready", `${packageDir}/`, target]);
  writeFileSync(join(packageDir, ".ready"), "");
  runTool("rsync", ["-a", join(packageDir, ".ready"), target]);
};

const send = (options) => {
  const runDir = join(options.root, "work", options.run);
  const platforms = readJson(join(runDir, "platforms.json"));
  const errors = checkPlatforms(platforms);
  if (errors.length > 0) throw new Error(`Подписи не прошли проверку:\n- ${errors.join("\n- ")}`);
  if (!options.dryRun) {
    checkRsync();
    syncSafely(options);
  }
  const packageDir = join(runDir, "package", options.run);
  const { manifest, storyNote } = buildPackage(options, runDir, packageDir, platforms);
  writeCaptionFiles(runDir, platforms);
  const enabled = PLATFORMS.filter((name) => manifest.platforms[name]?.enabled).map((name) => PLATFORM_NAMES[name]);
  say(`✅ Пакет ${options.run} собран: ${manifest.video.duration_sec} с, ${manifest.video.width}×${manifest.video.height}`);
  say(`   площадки: ${enabled.join(", ")}`);
  if (storyNote) say(`   ${storyNote}`);
  if (options.dryRun) {
    say(`   проверка без отправки, пакет: ${packageDir}`);
    return;
  }
  uploadPackage(options.remote, packageDir, options.run);
  rmSync(join(runDir, "package"), { recursive: true, force: true });
  say("✅ Пакет отправлен, карточка придёт в бот");
};

// ---------- Результаты ----------

const formatLocal = (iso) => {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const summarize = (result) => {
  const published = Object.entries(result.platforms ?? {}).filter(([, item]) => item.status === "published");
  const times = published.map(([, item]) => item.published_at).filter(Boolean).sort();
  const links = published.map(([name, item]) => (item.url ? `${PLATFORM_NAMES[name] ?? name} ${item.url}` : PLATFORM_NAMES[name] ?? name));
  return { date: times.length > 0 ? formatLocal(times[0]) : null, links };
};

const updateCard = (path, summary) => {
  if (!existsSync(path) || !summary.date) return;
  const text = readFileSync(path, "utf-8")
    .replace(/^- \*\*Дата публикации:\*\*.*$/m, `- **Дата публикации:** ${summary.date}`)
    .replace(/^- \*\*Ссылка:\*\*.*$/m, `- **Ссылка:** ${summary.links.join(", ")}`);
  writeFileSync(path, text);
};

const applyResult = (root, file) => {
  const result = readJson(file);
  const runId = result.reel_id;
  const publishedDir = join(root, "published", "music", runId ?? "");
  if (!REEL_ID_RE.test(runId ?? "") || !existsSync(publishedDir)) return { runId, applied: false };
  writeFileSync(join(publishedDir, "publish.json"), `${JSON.stringify(result, null, 2)}\n`);
  const summary = summarize(result);
  updateCard(join(publishedDir, "card.md"), summary);
  updateCard(join(root, "work", runId, "card.md"), summary);
  rmSync(file);
  return { runId, applied: true, status: result.status, summary };
};

const sync = (options) => {
  const inbox = join(options.root, "work", ".publisher-outbox");
  mkdirSync(inbox, { recursive: true });
  // Забранные файлы удаляются на сервере (там мало диска). Файлы с точкой — недописанные временные.
  runTool("rsync", ["-a", "--remove-source-files", "--exclude", ".*", `${options.remote}outbox/`, `${inbox}/`]);
  const files = readdirSync(inbox).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  for (const name of files) {
    const outcome = applyResult(options.root, join(inbox, name));
    if (!outcome.applied) {
      say(`⚠️ ${outcome.runId ?? name}: нет папки published/music/${outcome.runId ?? "?"}, результат оставлен в work/.publisher-outbox/`);
      continue;
    }
    const where = outcome.summary.links.length > 0 ? `: ${outcome.summary.links.join(", ")}` : "";
    say(`📥 ${outcome.runId}: ${outcome.status}${where}`);
  }
  if (files.length === 0) say("📥 Новых результатов нет");
};

// Ошибка забора результатов не должна мешать отправке нового рилса.
const syncSafely = (options) => {
  try {
    sync(options);
  } catch (error) {
    say(`⚠️ Результаты прошлых публикаций не забраны: ${error.message}`);
  }
};

try {
  const options = readOptions();
  if (options.command === "sync") {
    checkRsync();
    sync(options);
  } else {
    send(options);
  }
} catch (error) {
  process.stderr.write(`❌ ${error.message}\n`);
  process.exit(1);
}
