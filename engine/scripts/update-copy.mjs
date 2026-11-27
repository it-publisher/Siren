// Обновление рабочей копии без git: docs/guides/update.md.
// Сравнивает три состояния — прошлую версию (base), новую (next) и копию — и меняет только файлы движка,
// которые в копии не правили. Контент пользователя не трогается никогда, любое расхождение — остановка.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, copyFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const USAGE = "Usage: update-copy.mjs --copy <папка копии> --base <прошлая версия> --next <новая версия> [--apply]";
// Контент и всё, что создаётся на месте: пользовательские данные, ключи, зависимости, кэши.
const PROTECTED = ["accounts/", "ai/context/", "assets/", "characters/", "published/", "ref/", "trends/", "work/", "engine/node_modules/", "engine/.whisper/", "engine/out/"];
// .env с ключами и его варианты; образец .env.example — часть движка.
const SECRET_FILE_RE = /^\.env(\..+)?$/;
const IGNORED_NAMES = [".DS_Store"];

const say = (line) => process.stdout.write(`${line}\n`);

const isProtected = (path) => PROTECTED.some((prefix) => path.startsWith(prefix)) || (SECRET_FILE_RE.test(path) && path !== ".env.example");

const readOptions = () => {
  const { values } = parseArgs({
    options: { copy: { type: "string" }, base: { type: "string" }, next: { type: "string" }, apply: { type: "boolean", default: false } },
  });
  if (!values.copy || !values.base || !values.next) throw new Error(USAGE);
  for (const key of ["copy", "base", "next"]) {
    if (!existsSync(join(values[key], "AGENTS.md"))) throw new Error(`--${key}: ${values[key]} не похоже на папку Siren, нет AGENTS.md`);
  }
  return values;
};

// Файлы и символические ссылки; ссылки не разворачиваем — в скиллах это ссылки на ai/skills.
const listFiles = (root, dir = root, files = []) => {
  for (const name of readdirSync(dir)) {
    if (IGNORED_NAMES.includes(name) || name === ".git") continue;
    const path = join(dir, name);
    const rel = relative(root, path);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      if (!isProtected(`${rel}/`)) listFiles(root, path, files);
    } else if (!isProtected(rel)) {
      files.push(rel);
    }
  }
  return files;
};

// Содержимое для сравнения: у ссылки — куда она указывает, у файла — байты.
const fingerprint = (path) => {
  if (!existsSync(path) && !isLink(path)) return null;
  return isLink(path) ? `link:${readlinkSync(path)}` : readFileSync(path).toString("base64");
};

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const classify = (state) => {
  const { base, next, local } = state;
  if (local === next) return "same";
  if (base === null) return local === null ? "add" : "conflict";
  if (local === base) return next === null ? "delete" : "update";
  return "conflict";
};

const buildPlan = ({ copy, base, next }) => {
  const paths = new Set([...listFiles(base), ...listFiles(next)]);
  const plan = { update: [], add: [], delete: [], conflict: [], same: [] };
  for (const path of [...paths].sort()) {
    const state = { base: fingerprint(join(base, path)), next: fingerprint(join(next, path)), local: fingerprint(join(copy, path)) };
    plan[classify(state)].push(path);
  }
  return plan;
};

// Защищённые файлы, которые изменились между версиями: их правят вручную по описанию версии.
// В архивах версий нет зависимостей и ключей, поэтому их можно обойти целиком.
const changedProtected = ({ base, next }) => {
  const walk = (root) => readdirSync(root, { recursive: true }).filter((path) => isProtected(path) && !lstatSync(join(root, path)).isDirectory());
  const paths = new Set([...walk(base), ...walk(next)]);
  return [...paths].sort().filter((path) => fingerprint(join(base, path)) !== fingerprint(join(next, path)));
};

const copyEntry = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { force: true });
  if (isLink(from)) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to);
};

const applyPlan = (plan, { copy, next }) => {
  for (const path of [...plan.update, ...plan.add]) copyEntry(join(next, path), join(copy, path));
  for (const path of plan.delete) rmSync(join(copy, path), { force: true });
};

const printList = (title, paths) => {
  if (paths.length === 0) return;
  say(`${title} (${paths.length}):`);
  for (const path of paths) say(`  ${path}`);
};

try {
  const options = readOptions();
  const plan = buildPlan(options);
  printList("Обновить", plan.update);
  printList("Добавить", plan.add);
  printList("Удалить", plan.delete);
  printList("⚠️ Изменены в копии или не совпадают с прошлой версией", plan.conflict);
  printList("Изменились в новой версии, но это контент — правка вручную по описанию версии", changedProtected(options));
  say(`Без изменений: ${plan.same.length}`);
  if (plan.conflict.length > 0) {
    say("❌ Есть расхождения: обновление не применено. Покажи список пользователю и реши с ним по каждому файлу.");
    process.exit(2);
  }
  if (!options.apply) {
    say("Проверка без изменений. Чтобы применить, добавь --apply");
  } else {
    applyPlan(plan, options);
    say(`✅ Применено: обновлено ${plan.update.length}, добавлено ${plan.add.length}, удалено ${plan.delete.length}`);
  }
} catch (error) {
  process.stderr.write(`❌ ${error.message}\n`);
  process.exit(1);
}
