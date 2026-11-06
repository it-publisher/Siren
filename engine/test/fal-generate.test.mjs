import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../scripts/fal-generate.mjs", import.meta.url).pathname;
const API_KEY = "test-key";
const ENDPOINT = "fal-ai/flux-2";
const INPUT = { prompt: "test frame", image_size: { width: 1080, height: 1920 } };

const runScript = (args, env) =>
  new Promise((resolve) => {
    const child = spawn("node", [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

const sendJson = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

// Поддельная очередь fal.ai: тесты не тратят деньги и не требуют сети.
const startFakeFal = async (overrides = {}) => {
  const requests = [];
  let statusCalls = 0;
  let mediaFailures = overrides.mediaFailures ?? 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
      const base = `http://127.0.0.1:${server.address().port}`;
      const queuePath = `/${ENDPOINT}/requests/r1`;
      if (request.url.startsWith("/storage/upload/initiate")) {
        return sendJson(response, 200, { upload_url: `${base}/signed-upload`, file_url: "https://cdn.example/vocal.wav" });
      }
      if (request.url === "/signed-upload") {
        response.writeHead(overrides.uploadStatus ?? 200);
        return response.end();
      }
      if (request.method === "POST") {
        if (overrides.submitStatus) return sendJson(response, overrides.submitStatus, { detail: "rejected" });
        return sendJson(response, 200, {
          request_id: "r1",
          status_url: overrides.statusUrl ?? `${base}${queuePath}/status`,
          response_url: `${base}${queuePath}`,
        });
      }
      if (request.url === `${queuePath}/status`) {
        statusCalls += 1;
        if (statusCalls === 1) return sendJson(response, 200, { status: "IN_PROGRESS" });
        return sendJson(response, 200, { status: "COMPLETED", ...(overrides.statusFields ?? {}) });
      }
      if (request.url === queuePath) {
        if (overrides.resultFromBase) return sendJson(response, 200, overrides.resultFromBase(base));
        if (overrides.resultMedia === "video") return sendJson(response, 200, { video: { url: `${base}/media/a.png` }, duration: 5 });
        return sendJson(response, 200, overrides.result ?? { images: [{ url: `${base}/media/a.png` }], seed: 7, timings: { inference: 1 } });
      }
      if (request.url === "/media/a.png") {
        if (mediaFailures > 0) {
          mediaFailures -= 1;
          response.writeHead(500);
          return response.end();
        }
        response.writeHead(200);
        return response.end("image-bytes");
      }
      return sendJson(response, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
};

const withFixture = async (overrides, check) => {
  const dir = mkdtempSync(join(tmpdir(), "siren-fal-"));
  const fal = await startFakeFal(overrides);
  const inputPath = join(dir, "input.json");
  writeFileSync(inputPath, JSON.stringify(INPUT));
  const args = ["--endpoint", ENDPOINT, "--input", inputPath, "--out", join(dir, "frames", "shot-01")];
  const env = { FAL_KEY: API_KEY, FAL_QUEUE_URL: fal.url, FAL_REST_URL: fal.url };
  try {
    await check({ dir, fal, args, env, inputPath });
  } finally {
    fal.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

test("saves media and a record of the request", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, "frames", "shot-01.png"), "utf-8"), "image-bytes");

    const record = JSON.parse(readFileSync(join(dir, "frames", "shot-01.json"), "utf-8"));
    assert.equal(record.requestId, "r1");
    assert.equal(record.seed, 7);
    assert.deepEqual(record.input, INPUT);

    const submission = fal.requests.find((request) => request.method === "POST");
    assert.equal(submission.url, `/${ENDPOINT}`);
    assert.deepEqual(JSON.parse(submission.body), INPUT);
  });
});

test("sends the key to the queue but never to the media host", async () => {
  await withFixture({}, async ({ fal, args, env }) => {
    assert.equal((await runScript(args, env)).status, 0);
    for (const request of fal.requests) {
      const expected = request.url.startsWith("/media/") ? undefined : `Key ${API_KEY}`;
      assert.equal(request.authorization, expected, request.url);
    }
  });
});

test("sends references as data URIs and records only their paths", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const reference = join(dir, "face.jpg");
    writeFileSync(reference, "face-bytes");
    assert.equal((await runScript([...args, "--reference", reference], env)).status, 0);

    const submission = fal.requests.find((request) => request.method === "POST");
    const expectedUri = `data:image/jpeg;base64,${Buffer.from("face-bytes").toString("base64")}`;
    assert.deepEqual(JSON.parse(submission.body).image_urls, [expectedUri]);

    const record = JSON.parse(readFileSync(join(dir, "frames", "shot-01.json"), "utf-8"));
    assert.deepEqual(record.references, [reference]);
    assert.equal(record.input.image_urls, undefined);
  });
});

test("sends named files as data URIs and records only their paths", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const image = join(dir, "face.png");
    const audio = join(dir, "vocal.wav");
    writeFileSync(image, "face-bytes");
    writeFileSync(audio, "vocal-bytes");
    const result = await runScript([...args, "--file", `image_url=${image}`, "--file", `audio_url=${audio}`], env);
    assert.equal(result.status, 0, result.stderr);

    const body = JSON.parse(fal.requests.find((request) => request.method === "POST").body);
    assert.equal(body.image_url, `data:image/png;base64,${Buffer.from("face-bytes").toString("base64")}`);
    assert.equal(body.audio_url, `data:audio/wav;base64,${Buffer.from("vocal-bytes").toString("base64")}`);

    const record = JSON.parse(readFileSync(join(dir, "frames", "shot-01.json"), "utf-8"));
    assert.deepEqual(record.fileFields, { image_url: image, audio_url: audio });
    assert.doesNotMatch(JSON.stringify(record), /base64/);
  });
});

test("uploads files and sends their URL, without the key on the signed upload", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const audio = join(dir, "vocal.wav");
    writeFileSync(audio, "vocal-bytes");
    const result = await runScript([...args, "--upload", `audio_url=${audio}`], env);
    assert.equal(result.status, 0, result.stderr);

    const initiate = fal.requests.find((request) => request.url.startsWith("/storage/upload/initiate"));
    assert.equal(initiate.authorization, `Key ${API_KEY}`);
    assert.deepEqual(JSON.parse(initiate.body), { content_type: "audio/wav", file_name: "vocal.wav" });

    const upload = fal.requests.find((request) => request.url === "/signed-upload");
    assert.equal(upload.method, "PUT");
    assert.equal(upload.body, "vocal-bytes");
    assert.equal(upload.authorization, undefined);

    const submission = fal.requests.find((request) => request.url === `/${ENDPOINT}`);
    assert.equal(JSON.parse(submission.body).audio_url, "https://cdn.example/vocal.wav");

    const record = JSON.parse(readFileSync(join(dir, "frames", "shot-01.json"), "utf-8"));
    assert.deepEqual(record.fileFields, { audio_url: audio });
  });
});

test("uploads a video with its media type", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const video = join(dir, "clip.mp4");
    writeFileSync(video, "video-bytes");
    const result = await runScript([...args, "--upload", `video_url=${video}`], env);
    assert.equal(result.status, 0, result.stderr);
    const initiate = fal.requests.find((request) => request.url.startsWith("/storage/upload/initiate"));
    assert.equal(JSON.parse(initiate.body).content_type, "video/mp4");
  });
});

test("does not submit a paid request when an upload fails", async () => {
  await withFixture({ uploadStatus: 500 }, async ({ dir, fal, args, env }) => {
    const audio = join(dir, "vocal.wav");
    writeFileSync(audio, "vocal-bytes");
    const result = await runScript([...args, "--upload", `audio_url=${audio}`], env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Upload failed with 500/);
    assert.equal(fal.requests.some((request) => request.url === `/${ENDPOINT}`), false);
  });
});

test("fills nested fields without leaking file data into the record", async () => {
  await withFixture({}, async ({ dir, fal, args, env, inputPath }) => {
    const face = join(dir, "face.png");
    writeFileSync(face, "face-bytes");
    writeFileSync(inputPath, JSON.stringify({ prompt: "@Element1 walks" }));
    const fields = ["--file", `elements.0.frontal_image_url=${face}`, "--file", `elements.0.reference_image_urls.0=${face}`];
    const result = await runScript([...args, ...fields], env);
    assert.equal(result.status, 0, result.stderr);

    const uri = `data:image/png;base64,${Buffer.from("face-bytes").toString("base64")}`;
    const body = JSON.parse(fal.requests.find((request) => request.url === `/${ENDPOINT}`).body);
    assert.deepEqual(body.elements, [{ frontal_image_url: uri, reference_image_urls: [uri] }]);

    const record = readFileSync(join(dir, "frames", "shot-01.json"), "utf-8");
    assert.doesNotMatch(record, /base64/);
  });
});

test("rejects unsafe field names before calling the API", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const face = join(dir, "face.png");
    writeFileSync(face, "face-bytes");
    assert.match((await runScript([...args, "--file", `__proto__.polluted=${face}`], env)).stderr, /Invalid field/);
    assert.equal(fal.requests.length, 0);
  });
});

test("saves a file from any result field", async () => {
  await withFixture({ resultFromBase: (base) => ({ vocals: { url: `${base}/media/a.png` } }) }, async ({ dir, args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, "frames", "shot-01.png"), "utf-8"), "image-bytes");
  });
});

test("saves a video result", async () => {
  await withFixture({ resultMedia: "video" }, async ({ dir, args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, "frames", "shot-01.png"), "utf-8"), "image-bytes");
  });
});

test("rejects bad files before calling the API", async () => {
  await withFixture({}, async ({ dir, fal, args, env }) => {
    const textFile = join(dir, "notes.txt");
    writeFileSync(textFile, "x");
    assert.match((await runScript([...args, "--reference", textFile], env)).stderr, /Unsupported file type/);
    assert.match((await runScript([...args, "--reference", join(dir, "missing.png")], env)).stderr, /ENOENT/);
    assert.match((await runScript([...args, "--file", "no-separator"], env)).stderr, /Expected <field>=<path>/);
    assert.equal(fal.requests.length, 0);
  });
});

test("does not call the API without a key", async () => {
  await withFixture({}, async ({ fal, args }) => {
    const result = await runScript(args, { FAL_QUEUE_URL: fal.url });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAL_KEY is not set/);
    assert.equal(fal.requests.length, 0);
  });
});

test("rejects bad arguments and input before calling the API", async () => {
  await withFixture({}, async ({ fal, env, inputPath, dir }) => {
    const out = join(dir, "out");
    assert.match((await runScript(["--endpoint", ENDPOINT], env)).stderr, /Usage/);
    assert.match((await runScript(["--endpoint", "../evil", "--input", inputPath, "--out", out], env)).stderr, /Invalid endpoint/);

    writeFileSync(inputPath, "[]");
    assert.match((await runScript(["--endpoint", ENDPOINT, "--input", inputPath, "--out", out], env)).stderr, /must contain a JSON object/);
    assert.equal(fal.requests.length, 0);
  });
});

test("reports a rejected request", async () => {
  await withFixture({ submitStatus: 403 }, async ({ args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fal\.ai responded 403/);
    assert.doesNotMatch(result.stderr, new RegExp(API_KEY));
  });
});

test("keeps the request id when generation fails", async () => {
  await withFixture({ statusFields: { error: "model crashed" } }, async ({ dir, args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Request r1: Generation failed: model crashed/);
    assert.equal(existsSync(join(dir, "frames", "shot-01.json")), false);
  });
});

test("removes the pending record after success and after a failed generation", async () => {
  await withFixture({}, async ({ dir, args, env }) => {
    assert.equal((await runScript(args, env)).status, 0);
    assert.equal(existsSync(join(dir, "frames", "shot-01.request.json")), false);
  });
  await withFixture({ statusFields: { error: "model crashed" } }, async ({ dir, args, env }) => {
    assert.equal((await runScript(args, env)).status, 1);
    assert.equal(existsSync(join(dir, "frames", "shot-01.request.json")), false);
  });
});

test("keeps an accepted request and picks up its result without paying again", async () => {
  await withFixture({ mediaFailures: 1 }, async ({ dir, fal, args, env }) => {
    const failed = await runScript(args, env);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Request r1: Download failed with 500/);
    assert.match(failed.stderr, /--resume --out/);

    const pending = JSON.parse(readFileSync(join(dir, "frames", "shot-01.request.json"), "utf-8"));
    assert.equal(pending.requestId, "r1");
    assert.deepEqual(pending.input, INPUT);

    const out = join(dir, "frames", "shot-01");
    const resumed = await runScript(["--resume", "--out", out], env);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(readFileSync(`${out}.png`, "utf-8"), "image-bytes");
    assert.equal(JSON.parse(readFileSync(`${out}.json`, "utf-8")).requestId, "r1");
    assert.equal(existsSync(`${out}.request.json`), false);
    assert.equal(fal.requests.filter((request) => request.url === `/${ENDPOINT}`).length, 1);
  });
});

test("does not submit a second paid request while one is unfinished", async () => {
  await withFixture({ mediaFailures: 1 }, async ({ fal, args, env }) => {
    assert.equal((await runScript(args, env)).status, 1);
    const second = await runScript(args, env);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Unfinished paid request/);
    assert.equal(fal.requests.filter((request) => request.url === `/${ENDPOINT}`).length, 1);
  });
});

test("keeps a saved result and does not pay again with the same --out", async () => {
  await withFixture({}, async ({ dir, fal, args, env, inputPath }) => {
    assert.equal((await runScript(args, env)).status, 0);
    const out = join(dir, "frames", "shot-01");
    const savedRecord = readFileSync(`${out}.json`, "utf-8");
    const requestsAfterFirstRun = fal.requests.length;

    const second = await runScript(args, env);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Paid result already saved/);
    assert.equal(fal.requests.length, requestsAfterFirstRun);
    assert.equal(readFileSync(`${out}.json`, "utf-8"), savedRecord);

    const retake = await runScript(["--endpoint", ENDPOINT, "--input", inputPath, "--out", `${out}-take2`], env);
    assert.equal(retake.status, 0, retake.stderr);
    assert.equal(existsSync(`${out}-take2.png`), true);
    assert.equal(readFileSync(`${out}.json`, "utf-8"), savedRecord);
  });
});

test("resume reports a missing record and refuses a foreign URL in it", async () => {
  await withFixture({}, async ({ dir, fal, env }) => {
    const out = join(dir, "frames-shot");
    assert.match((await runScript(["--resume", "--out", out], env)).stderr, /Nothing to resume/);

    writeFileSync(`${out}.request.json`, JSON.stringify({ requestId: "r1", statusUrl: "http://127.0.0.2:9/status", responseUrl: `${fal.url}/x` }));
    assert.match((await runScript(["--resume", "--out", out], env)).stderr, /Unexpected queue URL/);
    assert.equal(fal.requests.length, 0);
  });
});

test("refuses to send the key to a foreign status URL", async () => {
  await withFixture({ statusUrl: "http://127.0.0.2:9/status" }, async ({ args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unexpected queue URL/);
  });
});

test("fails loudly when the result has no media", async () => {
  await withFixture({ result: { seed: 1 } }, async ({ args, env }) => {
    const result = await runScript(args, env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Request r1: No media in result/);
  });
});
