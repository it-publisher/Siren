import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/update-copy.mjs", import.meta.url));

const writeTree = (root, files) => {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (content.startsWith("link:")) symlinkSync(content.slice(5), target);
    else writeFileSync(target, content);
  }
};

const BASE = {
  "AGENTS.md": "agents v1.0",
  "engine/scripts/old.mjs": "old",
  "engine/package.json": "pkg v1.0",
  "ai/skills/publish-package/SKILL.md": "skill v1.0",
  ".claude/skills/publish-package": "link:../../ai/skills/publish-package",
  "ai/context/stack.md": "stack template v1.0",
  ".env.example": "FAL_KEY=",
};

const NEXT = {
  "AGENTS.md": "agents v1.1",
  "engine/package.json": "pkg v1.1",
  "engine/scripts/publish-package.mjs": "new script",
  "ai/skills/publish-package/SKILL.md": "skill v1.1",
  ".claude/skills/publish-package": "link:../../ai/skills/publish-package",
  "ai/context/stack.md": "stack template v1.1",
  ".env.example": "FAL_KEY=",
  VERSION: "v1.1\n",
};

// Копия = v1.0 после онбординга: свой контент, ключи и зависимости.
const USER_CONTENT = {
  ".env": "FAL_KEY=secret",
  "ai/context/stack.md": "stack filled by the user",
  "characters/luna/bible.md": "luna",
  "published/music/2026-11-20-music-a/card.md": "card",
  "engine/node_modules/x/index.js": "dep",
};

const withCopies = (localChanges, check) => {
  const dir = mkdtempSync(join(tmpdir(), "siren-update-"));
  try {
    const paths = { base: join(dir, "base"), next: join(dir, "next"), copy: join(dir, "copy") };
    writeTree(paths.base, BASE);
    writeTree(paths.next, NEXT);
    writeTree(paths.copy, { ...BASE, ...USER_CONTENT });
    writeTree(paths.copy, localChanges);
    check(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const run = (paths, extra = []) =>
  spawnSync("node", [SCRIPT, "--copy", paths.copy, "--base", paths.base, "--next", paths.next, ...extra], { encoding: "utf-8" });

test("dry run lists changes and touches nothing", () => {
  withCopies({}, (paths) => {
    const result = run(paths);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Обновить \(3\):\n {2}AGENTS.md\n {2}ai\/skills\/publish-package\/SKILL.md\n {2}engine\/package.json/);
    assert.match(result.stdout, /Добавить \(2\):\n {2}VERSION\n {2}engine\/scripts\/publish-package.mjs/);
    assert.match(result.stdout, /Удалить \(1\):\n {2}engine\/scripts\/old.mjs/);
    assert.match(result.stdout, /правка вручную по описанию версии \(1\):\n {2}ai\/context\/stack.md/);
    assert.equal(readFileSync(join(paths.copy, "AGENTS.md"), "utf-8"), "agents v1.0");
  });
});

test("apply updates engine files and keeps user content", () => {
  withCopies({}, (paths) => {
    const result = run(paths, ["--apply"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(paths.copy, "AGENTS.md"), "utf-8"), "agents v1.1");
    assert.equal(readFileSync(join(paths.copy, "VERSION"), "utf-8"), "v1.1\n");
    assert.equal(existsSync(join(paths.copy, "engine/scripts/old.mjs")), false);
    assert.equal(readlinkSync(join(paths.copy, ".claude/skills/publish-package")), "../../ai/skills/publish-package");
    for (const [path, content] of Object.entries(USER_CONTENT)) {
      assert.equal(readFileSync(join(paths.copy, path), "utf-8"), content, path);
    }
  });
});

test("local edits of engine files stop the update", () => {
  withCopies({ "ai/skills/publish-package/SKILL.md": "skill edited by the agent" }, (paths) => {
    const result = run(paths, ["--apply"]);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /Изменены в копии.*\(1\):\n {2}ai\/skills\/publish-package\/SKILL.md/);
    assert.equal(readFileSync(join(paths.copy, "AGENTS.md"), "utf-8"), "agents v1.0", "nothing applied");
  });
});

test("refuses a folder that is not Siren", () => {
  withCopies({}, (paths) => {
    rmSync(join(paths.copy, "AGENTS.md"));
    const result = run(paths);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /не похоже на папку Siren/);
  });
});
