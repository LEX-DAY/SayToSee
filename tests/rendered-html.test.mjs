import assert from "node:assert/strict";
import test from "node:test";

async function fetchApp(path = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the CalltoCall landing page", async () => {
  const response = await fetchApp();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>CalltoCall — лёгкие видеовстречи до 10 человек<\/title>/i,
  );
  assert.match(html, /Созванивайтесь/);
  assert.match(html, /Создать встречу/);
  assert.match(html, /До 10 участников/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("rejects malformed room token requests", async () => {
  const response = await fetchApp("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "bad-room", name: "" }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Проверьте имя и ссылку/);
});
