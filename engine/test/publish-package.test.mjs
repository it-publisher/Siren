import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));
const RUN = "2026-11-27-music-night-city";

const PLATFORMS = {
  telegram_story: { enabled: true, caption: "Новый трек 🎧", post_to_chat_page: false },
  instagram: { enabled: true, caption: "Ночной город\n\n#music #newmusic", share_to_feed: true },
  youtube: { enabled: false, via: "upload_post", title: "Ночной город", description: "Ночной город", tags: ["music"], privacy: "public" },
  tiktok: { enabled: false, caption: "Ночной город #music" },
};

const CARD = "# Карточка\n\n## Основное\n\n- **Аккаунт:** music\n- **Дата публикации:**\n- **Ссылка:**\n";

const makeVideo = (path, seconds) => {
  const inputs = ["-f", "lavfi", "-i", `color=red:size=180x320:rate=30:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`];
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path], { encoding: "utf-8" });
  assert.equal(made.status, 0, made.stderr);
};

const withRepo = (seconds, platforms, check) => {
  const dir = mkdtempSync(join(tmpdir(), "siren-publish-"));
  try {
    const root = join(dir, "repo");
    const runDir = join(root, "work", RUN);
    const remote = join(dir, "server");
    mkdirSync(join(runDir, "render"), { recursive: true });
    mkdirSync(join(remote, "inbox"), { recursive: true });
    mkdirSync(join(remote, "outbox"), { recursive: true });
    makeVideo(join(runDir, "render", "final.mp4"), seconds);
    writeFileSync(join(runDir, "brief.yaml"), 'account: music\ncharacter: "luna"   # имя папки\n');
    writeFileSync(join(runDir, "platforms.json"), JSON.stringify(platforms));
    check({ tmp: dir, root, runDir, remote: `${remote}/`, inbox: join(remote, "inbox", RUN), outbox: join(remote, "outbox") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const run = (args, { root, remote }, env = {}) =>
  spawnSync("node", [SCRIPT, ...args, "--root", root, "--remote", remote], { encoding: "utf-8", env: { ...process.env, ...env } });

const readPackageManifest = (ctx) => JSON.parse(readFileSync(join(ctx.runDir, "package", RUN, "manifest.json"), "utf-8"));

// Встроенный в macOS openrsync: отвечает на --version, но не умеет --remove-source-files.
const withOldRsync = (ctx) => {
  const bin = join(ctx.tmp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "rsync"), '#!/bin/sh\necho "openrsync: protocol version 29"\n', { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}` };
};

test("send builds a manifest, uploads the package and marks it ready last", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const result = run(["send", "--run", RUN], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Пакет отправлен/);
    assert.deepEqual(readdirSync(ctx.inbox).sort(), [".ready", "manifest.json", "video.mp4"]);
    const manifest = JSON.parse(readFileSync(join(ctx.inbox, "manifest.json"), "utf-8"));
    assert.equal(manifest.schema_version, 2);
    assert.equal(manifest.reel_id, RUN);
    assert.equal(manifest.character, "luna");
    assert.equal(manifest.story_video, null);
    assert.deepEqual(manifest.platforms, PLATFORMS);
    assert.equal(manifest.video.width, 180);
    assert.ok(Math.abs(manifest.video.duration_sec - 4) < 0.1);
    assert.match(manifest.video.sha256, /^[0-9a-f]{64}$/);
    assert.equal("codec" in manifest.video, false, "codec is checked locally and stays out of the manifest");
    assert.match(manifest.created_at, /[+-]\d{2}:\d{2}$/);
    assert.equal(readFileSync(join(ctx.runDir, "caption-tiktok.txt"), "utf-8"), "Ночной город #music\n");
    assert.equal(existsSync(join(ctx.runDir, "package")), false);
  });
});

test("send cuts a story copy when the reel is longer than a minute", () => {
  withRepo(62, PLATFORMS, (ctx) => {
    const result = run(["send", "--run", RUN, "--dry-run"], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /сторис: первые 59.5 с/);
    const manifest = JSON.parse(readFileSync(join(ctx.runDir, "package", RUN, "manifest.json"), "utf-8"));
    assert.equal(manifest.story_video.file, "story.mp4");
    assert.ok(manifest.story_video.duration_sec <= 60, `story ${manifest.story_video.duration_sec} s`);
    assert.ok(manifest.video.duration_sec > 61);
    assert.equal(existsSync(ctx.inbox), false, "dry run must not upload");
  });
});

test("send rejects captions over the limits and uploads nothing", () => {
  const hashtags = Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(" ");
  const platforms = {
    instagram: { enabled: true, caption: hashtags },
    youtube: { enabled: true, title: "" },
    instgram: { enabled: true },
  };
  withRepo(4, platforms, (ctx) => {
    const result = run(["send", "--run", RUN], ctx);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /хэштегов 31, максимум 30/);
    assert.match(result.stderr, /youtube.title: нужен заголовок/);
    assert.match(result.stderr, /неизвестная площадка instgram/);
    assert.equal(existsSync(ctx.inbox), false);
  });
});

test("sync stores results in published and fills the card", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const publishedDir = join(ctx.root, "published", "music", RUN);
    mkdirSync(publishedDir, { recursive: true });
    writeFileSync(join(publishedDir, "card.md"), CARD);
    writeFileSync(join(ctx.runDir, "card.md"), CARD);
    const done = {
      reel_id: RUN,
      status: "done",
      platforms: {
        telegram_story: { status: "published", external_id: "7", published_at: "2026-11-27T09:00:05+00:00" },
        instagram: { status: "published", url: "https://www.instagram.com/reel/abc/", published_at: "2026-11-27T09:00:30+00:00" },
        youtube: { status: "skipped" },
      },
      errors: [],
    };
    const stranger = { reel_id: "2026-11-13-music-first-run", status: "done", platforms: {} };
    writeFileSync(join(ctx.outbox, `${RUN}.json`), JSON.stringify(done));
    writeFileSync(join(ctx.outbox, "2026-11-13-music-first-run.json"), JSON.stringify(stranger));
    writeFileSync(join(ctx.outbox, `.${RUN}.json.tmp`), "{");

    const result = run(["sync"], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(publishedDir, "publish.json"), "utf-8")), done);
    for (const card of [join(publishedDir, "card.md"), join(ctx.runDir, "card.md")]) {
      const text = readFileSync(card, "utf-8");
      assert.match(text, /- \*\*Дата публикации:\*\* 2026-11-27 \d{2}:00/);
      assert.match(text, /- \*\*Ссылка:\*\* сторис Telegram, Instagram https:\/\/www.instagram.com\/reel\/abc\//);
    }
    assert.deepEqual(readdirSync(ctx.outbox), [`.${RUN}.json.tmp`], "taken files are removed from the server, temp files stay");
    assert.deepEqual(readdirSync(join(ctx.root, "work", ".publisher-outbox")), ["2026-11-13-music-first-run.json"]);
    assert.match(result.stdout, /нет папки published\/music\/2026-11-13-music-first-run/);
  });
});

test("send removes a stale .ready and story.mp4 from the server folder", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    mkdirSync(ctx.inbox, { recursive: true });
    writeFileSync(join(ctx.inbox, ".ready"), "old");
    writeFileSync(join(ctx.inbox, "story.mp4"), "old story");
    const result = run(["send", "--run", RUN], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(ctx.inbox).sort(), [".ready", "manifest.json", "video.mp4"]);
    assert.equal(readFileSync(join(ctx.inbox, ".ready"), "utf-8"), "", "the marker comes from the new upload");
  });
});

test("--publish-at needs an ISO time with a time zone", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const wrong = run(["send", "--run", RUN, "--dry-run", "--publish-at", "2026-12-01T18:30:00"], ctx);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /нужно время ISO с часовым поясом/);
    const right = run(["send", "--run", RUN, "--dry-run", "--publish-at", "2026-12-01T18:30:00+03:00"], ctx);
    assert.equal(right.status, 0, right.stderr);
    assert.equal(readPackageManifest(ctx).publish_at, "2026-12-01T18:30:00+03:00");
  });
});

test("--story-video goes into the package when the story is on", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const story = join(ctx.tmp, "story-source.mp4");
    makeVideo(story, 3);
    const result = run(["send", "--run", RUN, "--dry-run", "--story-video", story], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /сторис: отдельное видео/);
    const manifest = readPackageManifest(ctx);
    assert.equal(manifest.story_video.file, "story.mp4");
    assert.ok(Math.abs(manifest.story_video.duration_sec - 3) < 0.1, `story ${manifest.story_video.duration_sec} s`);
  });
});

test("--story-video is ignored with a warning when the story is off", () => {
  const platforms = { ...PLATFORMS, telegram_story: { enabled: false, caption: "" } };
  withRepo(4, platforms, (ctx) => {
    const story = join(ctx.tmp, "story-source.mp4");
    makeVideo(story, 3);
    const result = run(["send", "--run", RUN, "--dry-run", "--story-video", story], ctx);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Сторис выключена.*--story-video не используется/);
    assert.equal(readPackageManifest(ctx).story_video, null);
    assert.equal(existsSync(join(ctx.runDir, "package", RUN, "story.mp4")), false);
  });
});

test("send and sync refuse the built-in macOS rsync", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const env = withOldRsync(ctx);
    for (const args of [["send", "--run", RUN], ["sync"]]) {
      const result = run(args, ctx, env);
      assert.equal(result.status, 1, args[0]);
      assert.match(result.stderr, /Нужен rsync 3/, args[0]);
    }
    assert.equal(existsSync(ctx.inbox), false);
  });
});

test("send explains wrong field types instead of crashing", () => {
  const platforms = {
    telegram_story: { enabled: true, caption: 7, areas: { type: "link" } },
    instagram: { enabled: true, caption: ["text"] },
    youtube: { enabled: true, title: 1, description: {}, tags: "music" },
    tiktok: true,
  };
  withRepo(4, platforms, (ctx) => {
    const result = run(["send", "--run", RUN, "--dry-run"], ctx);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /TypeError/);
    for (const message of [
      "telegram_story.caption: нужна строка",
      "telegram_story.areas: нужен массив",
      "instagram.caption: нужна строка",
      "youtube.title: нужна строка",
      "youtube.description: нужна строка",
      "youtube.tags: нужен массив строк",
      "tiktok: нужен объект",
    ]) {
      assert.ok(result.stderr.includes(message), `${message}\n${result.stderr}`);
    }
  });
});

const syncResult = (ctx, result) => {
  const publishedDir = join(ctx.root, "published", "music", RUN);
  mkdirSync(publishedDir, { recursive: true });
  writeFileSync(join(publishedDir, "card.md"), CARD);
  writeFileSync(join(ctx.outbox, `${RUN}.json`), JSON.stringify(result));
  return { publishedDir, sync: run(["sync"], ctx) };
};

test("sync stores a rejected result and leaves the card empty", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const rejected = { reel_id: RUN, status: "rejected", platforms: { telegram_story: { status: "skipped" }, instagram: { status: "skipped" } }, errors: [] };
    const { publishedDir, sync } = syncResult(ctx, rejected);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, new RegExp(`${RUN}: rejected`));
    assert.deepEqual(JSON.parse(readFileSync(join(publishedDir, "publish.json"), "utf-8")), rejected);
    assert.equal(readFileSync(join(publishedDir, "card.md"), "utf-8"), CARD);
  });
});

test("sync of a failed result lists only the platforms that were published", () => {
  withRepo(4, PLATFORMS, (ctx) => {
    const failed = {
      reel_id: RUN,
      status: "failed",
      platforms: {
        telegram_story: { status: "published", url: "https://t.me/test/s/1", published_at: "2026-11-27T09:00:05+00:00" },
        instagram: { status: "failed", error: "media not ready" },
      },
      errors: ["instagram: media not ready"],
    };
    const { publishedDir, sync } = syncResult(ctx, failed);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, new RegExp(`${RUN}: failed`));
    const card = readFileSync(join(publishedDir, "card.md"), "utf-8");
    assert.match(card, /- \*\*Ссылка:\*\* сторис Telegram https:\/\/t.me\/test\/s\/1\n/);
    assert.doesNotMatch(card, /Instagram/);
  });
});
