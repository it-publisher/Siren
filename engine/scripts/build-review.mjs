// Собирает статичную галерею запуска или персонажа: показ в чате не гарантирован, а браузер покажет всё.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const SECTIONS = [
  { folder: "candidates", title: "Кандидаты" },
  { folder: "references", title: "Референсы" },
  { folder: "tests", title: "Тесты" },
  { folder: "frames", title: "Кадры" },
  { folder: "clips", title: "Клипы" },
  { folder: "render", title: "Рендер" },
];
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const VIDEO_FILE = /\.(mp4|webm|mov)$/i;

const STYLE = `
  :root { color-scheme: dark; }
  body { background: #0b0f14; color: #e6edf3; font: 16px/1.4 system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  figure { margin: 0; }
  img, video { background: #000; border-radius: 8px; display: block; width: 100%; }
  figcaption { color: #9fb0c0; font-size: 13px; margin-top: 6px; overflow-wrap: anywhere; }
`;

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const renderItem = (folder, name) => {
  const src = escapeHtml(`${folder}/${encodeURIComponent(name)}`);
  const media = VIDEO_FILE.test(name)
    ? `<video src="${src}" controls preload="metadata"></video>`
    : `<img src="${src}" alt="${escapeHtml(name)}" loading="lazy">`;
  return `<figure>${media}<figcaption>${escapeHtml(name)}</figcaption></figure>`;
};

const listMedia = (runDir, folder) => {
  const path = join(runDir, folder);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => IMAGE_FILE.test(name) || VIDEO_FILE.test(name))
    .sort();
};

const buildPage = (runName, sections) => `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(runName)}</title><style>${STYLE}</style></head>
<body>
<h1>${escapeHtml(runName)}</h1>
${sections
  .map(
    ({ folder, title, files }) =>
      `<h2>${title}: ${files.length}</h2><div class="grid">${files.map((name) => renderItem(folder, name)).join("")}</div>`,
  )
  .join("\n")}
</body>
</html>
`;

const main = () => {
  const { values } = parseArgs({ options: { run: { type: "string" } } });
  if (!values.run) throw new Error("Usage: build-review.mjs --run <run-or-character-dir>");
  if (!existsSync(values.run)) throw new Error(`Run folder not found: ${values.run}`);

  const sections = SECTIONS.map((section) => ({ ...section, files: listMedia(values.run, section.folder) })).filter(
    (section) => section.files.length > 0,
  );
  if (sections.length === 0) throw new Error(`No images or videos in ${values.run}`);

  const runName = values.run.replace(/\/+$/, "").split("/").pop();
  const out = join(values.run, "review.html");
  writeFileSync(out, buildPage(runName, sections));
  process.stdout.write(`${JSON.stringify({ out, files: sections.flatMap((section) => section.files).length })}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
}
