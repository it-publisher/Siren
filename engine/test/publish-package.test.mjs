import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    check({ root, runDir, remote: `${remote}/`, inbox: join(remote, "inbox", RUN), outbox: join(remote, "outbox") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const run = (args, { root, remote }) => spawnSync("node", [SCRIPT, ...args, "--root", root, "--remote", remote], { encoding: "utf-8" });

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
