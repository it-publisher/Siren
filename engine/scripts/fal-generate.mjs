// Платный запрос к модели fal.ai через очередь. Подтверждение стоимости остаётся за агентом, см. ai/context/rules.md.
/* global fetch, structuredClone */
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";
import { parseArgs } from "node:util";

const USAGE =
  "Usage: fal-generate.mjs --endpoint <owner/app/path> --input <input.json> --out <path without extension> [--reference <image>]... [--file <field>=<path>]... [--upload <field>=<path>]...\n       fal-generate.mjs --resume --out <path without extension>";
// Часть моделей принимает только ссылку, а не data URI. Вход хранится сутки: повторно он не нужен.
const UPLOAD_LIFETIME_SECONDS = 24 * 60 * 60;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};
// Каждая часть пути начинается с буквы или цифры: `..` не должно менять адрес запроса с ключом.
const ENDPOINT_FORMAT = /^\w[\w.-]*(\/\w[\w.-]*)+$/;
const POLL_INTERVAL_MS = 1000;
// Видео считается минутами, поэтому ждём с запасом. По таймауту запрос на стороне fal не отменяется.
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

const readOptions = () => {
  const { values } = parseArgs({
    options: {
      endpoint: { type: "string" },
      input: { type: "string" },
      out: { type: "string" },
      reference: { type: "string", multiple: true, default: [] },
      file: { type: "string", multiple: true, default: [] },
      upload: { type: "string", multiple: true, default: [] },
      resume: { type: "boolean", default: false },
    },
  });
  if (values.resume && values.out) return values;
  if (!values.endpoint || !values.input || !values.out) throw new Error(USAGE);
  if (!ENDPOINT_FORMAT.test(values.endpoint)) throw new Error(`Invalid endpoint: ${values.endpoint}`);
  return values;
};

const readInput = (path) => {
  const input = JSON.parse(readFileSync(path, "utf-8"));
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error(`${path} must contain a JSON object`);
  return input;
};

const getMediaType = (path) => {
  const type = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`Unsupported file type: ${path}`);
  return type;
};

const readFileAsDataUri = (path) => `data:${getMediaType(path)};base64,${readFileSync(path).toString("base64")}`;

const parseFileFields = (entries) =>
  Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf("=");
      if (separator < 1 || separator === entry.length - 1) throw new Error(`Expected <field>=<path>, got: ${entry}`);
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );

// Поле может быть вложенным, например `elements.0.frontal_image_url` у Kling O3.
const setAtPath = (target, path, value) => {
  const keys = path.split(".");
  if (keys.some((key) => UNSAFE_KEYS.has(key))) throw new Error(`Invalid field: ${path}`);
  let current = target;
  keys.slice(0, -1).forEach((key, index) => {
    current[key] ??= /^\d+$/.test(keys[index + 1]) ? [] : {};
    current = current[key];
  });
  current[keys.at(-1)] = value;
};

// Копия, потому что файлы уходят только в запрос: в записи рядом с результатом достаточно путей, а не мегабайтов base64.
const buildPayload = (input, references, fileFields) => {
  const payload = structuredClone(input);
  if (references.length > 0) payload.image_urls = references.map(readFileAsDataUri);
  for (const [field, path] of Object.entries(fileFields)) setAtPath(payload, field, readFileAsDataUri(path));
  return payload;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`fal.ai responded ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
};

// Ключ уходит только на хост очереди: адреса опроса приходят из ответа внешнего сервиса.
const assertQueueOrigin = (url, queueUrl) => {
  if (new URL(url).origin !== new URL(queueUrl).origin) throw new Error(`Unexpected queue URL: ${url}`);
};

const uploadFile = async ({ restUrl, path, headers }) => {
  const contentType = getMediaType(path);
  const { upload_url: uploadUrl, file_url: fileUrl } = await fetchJson(`${restUrl}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Fal-Object-Lifecycle": JSON.stringify({ expiration_duration_seconds: UPLOAD_LIFETIME_SECONDS }),
    },
    body: JSON.stringify({ content_type: contentType, file_name: basename(path) }),
  });
  if (!uploadUrl || !fileUrl) throw new Error(`Unexpected upload response for ${path}`);
  // Без ключа: адрес загрузки уже подписан и ведёт на отдельный хост.
  const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: readFileSync(path) });
  if (!response.ok) throw new Error(`Upload failed with ${response.status}: ${path}`);
  return fileUrl;
};

const uploadFields = async ({ restUrl, fields, headers }) => {
  const urls = {};
  for (const [field, path] of Object.entries(fields)) urls[field] = await uploadFile({ restUrl, path, headers });
  return urls;
};

const submitRequest = async ({ queueUrl, endpoint, input, headers }) => {
  const submission = await fetchJson(`${queueUrl}/${endpoint}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submission.request_id || !submission.status_url || !submission.response_url) {
    throw new Error(`Unexpected submission response: ${JSON.stringify(submission).slice(0, 500)}`);
  }
  assertQueueOrigin(submission.status_url, queueUrl);
  assertQueueOrigin(submission.response_url, queueUrl);
  return submission;
};

const waitForCompletion = async (statusUrl, headers) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await fetchJson(statusUrl, { headers });
    if (status.status === "COMPLETED") return status;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000} s`);
};

const collectMedia = (result) => {
  // Поле с файлом зависит от модели: images, video, а у Demucs vocals и другие дорожки.
  const media = [...(result.images ?? []), ...Object.values(result)].filter((item) => item?.url);
  if (media.length === 0) throw new Error(`No media in result: ${JSON.stringify(result).slice(0, 500)}`);
  return media;
};

const buildFilePath = (out, url, index, total) => {
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `${out}${suffix}${extname(new URL(url).pathname) || ".bin"}`;
};

// Без заголовка с ключом: файлы лежат на отдельном публичном хосте и со временем истекают.
const downloadFile = async (url, path) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with ${response.status}: ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
};

const getRecordPath = (out) => `${out}.json`;

const saveResult = async ({ out, endpoint, input, references, fileFields, requestId, result }) => {
  const media = collectMedia(result);
  mkdirSync(dirname(out), { recursive: true });
  const files = [];
  for (const [index, item] of media.entries()) {
    const path = buildFilePath(out, item.url, index, media.length);
    await downloadFile(item.url, path);
    files.push(path);
  }
  // Рядом с файлом: по этой записи заполняется расход в карточке и повторяется удачный seed.
  const record = { endpoint, requestId, input, references, fileFields, seed: result.seed, timings: result.timings, files };
  writeFileSync(getRecordPath(out), `${JSON.stringify(record, null, 2)}\n`);
  return files;
};

const getPendingPath = (out) => `${out}.request.json`;

const readPendingRequest = (out, queueUrl) => {
  const path = getPendingPath(out);
  if (!existsSync(path)) throw new Error(`Nothing to resume: ${path} not found`);
  const pending = JSON.parse(readFileSync(path, "utf-8"));
  // Файл можно поправить руками, поэтому адреса проверяются так же, как ответ сервиса: ключ уходит только в очередь.
  assertQueueOrigin(pending.statusUrl, queueUrl);
  assertQueueOrigin(pending.responseUrl, queueUrl);
  return pending;
};

// Запись появляется сразу после приёма запроса: оплаченный результат можно забрать и после обрыва, таймаута или ошибки загрузки.
const submitNewRequest = async ({ options, queueUrl, restUrl, headers }) => {
  const { endpoint, input: inputPath, out, reference: references, file: fileEntries, upload: uploadEntries } = options;
  const pendingPath = getPendingPath(out);
  if (existsSync(pendingPath)) {
    throw new Error(`Unfinished paid request in ${pendingPath}. Use --resume --out ${out}, or delete the file to abandon it.`);
  }
  // Дубль с тем же путём затёр бы оплаченный файл и запись с seed, поэтому останавливаемся до оплаты.
  const recordPath = getRecordPath(out);
  if (existsSync(recordPath)) {
    throw new Error(`Paid result already saved, see ${recordPath}. Use a new --out for another take.`);
  }
  const input = readInput(inputPath);
  const fileFields = parseFileFields(fileEntries);
  const uploadedFields = parseFileFields(uploadEntries);
  const payload = buildPayload(input, references, fileFields);
  const uploadedUrls = await uploadFields({ restUrl, fields: uploadedFields, headers });
  for (const [field, url] of Object.entries(uploadedUrls)) setAtPath(payload, field, url);
  const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } = await submitRequest({ queueUrl, endpoint, input: payload, headers });
  const pending = { endpoint, requestId, statusUrl, responseUrl, input, references, fileFields: { ...fileFields, ...uploadedFields } };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);
  return pending;
};

const finishRequest = async ({ pending, out, headers }) => {
  const { endpoint, requestId, statusUrl, responseUrl, input, references, fileFields } = pending;
  const pendingPath = getPendingPath(out);
  let generationError;
  try {
    generationError = (await waitForCompletion(statusUrl, headers)).error;
    if (!generationError) {
      const result = await fetchJson(responseUrl, { headers });
      const files = await saveResult({ out, endpoint, input, references, fileFields, requestId, result });
      rmSync(pendingPath);
      process.stdout.write(`${JSON.stringify({ requestId, seed: result.seed, files })}\n`);
      return;
    }
  } catch (error) {
    throw new Error(`Request ${requestId}: ${error.message}\nThe request may be paid. Pick up the result: --resume --out ${out}. To abandon it, delete ${pendingPath}.`, { cause: error });
  }
  // Модель сообщила об ошибке: забирать нечего, запись не должна блокировать новый запуск.
  rmSync(pendingPath);
  throw new Error(`Request ${requestId}: Generation failed: ${generationError}`);
};

const main = async () => {
  const options = readOptions();
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set, add it to .env");
  const queueUrl = process.env.FAL_QUEUE_URL ?? "https://queue.fal.run";
  const restUrl = process.env.FAL_REST_URL ?? "https://rest.fal.ai";
  const headers = { Authorization: `Key ${key}` };
  const pending = options.resume ? readPendingRequest(options.out, queueUrl) : await submitNewRequest({ options, queueUrl, restUrl, headers });
  await finishRequest({ pending, out: options.out, headers });
};

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
}
