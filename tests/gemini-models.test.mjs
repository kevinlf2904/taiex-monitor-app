// Gemini 型號下架：用假的「列出模型」回應（不連 Google、不花額度）檢查型號挑選與退回原清單
import test from "node:test";
import assert from "node:assert/strict";
import { pickFlash, geminiModels, _resetGeminiCache } from "../api/_lib/_gemini.js";

const M = (name, methods = ["generateContent"]) => ({ name: "models/" + name, supportedGenerationMethods: methods });
const LIST = [
  M("gemini-3.5-flash"), M("gemini-3.5-flash-lite"), M("gemini-3-flash"), M("gemini-3.8-flash-preview"),
  M("gemini-flash-latest"), M("gemini-flash-lite-latest"),
  M("gemini-3.5-flash-image"), M("gemini-3.5-flash-tts"), M("gemini-3.5-flash-live"), M("text-embedding-005", ["embedContent"]),
  M("gemini-3.5-pro"), M("gemini-3.5-flash-exp", ["generateContent"]), M("gemini-4-flash", ["countTokens"]),
];
const fakeFetch = (pages, calls = []) => async url => { calls.push(url); const p = pages.shift(); if (p instanceof Error) throw p; return { ok: p.ok !== false, json: async () => p.body }; };

test("Gemini 型號：只挑能 generateContent 的文字 Flash，別名優先、正式版新到舊、預覽版、lite 在後", () => {
  assert.deepEqual(pickFlash(LIST), ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash", "gemini-3.8-flash-preview", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"]);
  assert.deepEqual(pickFlash([]), []);
});

test("Gemini 型號：已下架的型號濾掉、補上查到的；最多 6 個；同一執行個體快取不重查", async () => {
  _resetGeminiCache();
  const calls = [];
  const opts = { fetchImpl: fakeFetch([{ body: { models: LIST } }], calls), now: 1000 };
  const got = await geminiModels("k", ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"], opts);
  assert.equal(got[0], "gemini-flash-latest", "原清單還在的照原順序");
  assert.equal(got[1], "gemini-flash-lite-latest");
  assert.ok(!got.includes("gemini-2.5-flash"), "已下架的不試（免得把重試次數用光）");
  assert.ok(got.includes("gemini-3.5-flash"));
  assert.ok(got.length <= 6);
  await geminiModels("k", ["gemini-flash-latest"], { ...opts, now: 2000 });
  assert.equal(calls.length, 1, "6 小時內不重查");
  assert.match(calls[0], /\/v1beta\/models\?pageSize=200$/);
});

test("Gemini 型號：列出模型失敗（連不上、403、格式怪）就照原清單試；分頁會接著抓", async () => {
  const wanted = ["gemini-flash-latest", "gemini-2.5-flash"];
  for (const page of [new TypeError("fetch failed"), { ok: false, body: {} }, { body: { error: "x" } }, { body: { models: [] } }]) {
    _resetGeminiCache();
    assert.deepEqual(await geminiModels("k", wanted, { fetchImpl: fakeFetch([page]), now: 1 }), wanted);
  }
  _resetGeminiCache();
  assert.deepEqual(await geminiModels("", wanted), wanted, "沒有金鑰不查");
  _resetGeminiCache();
  const calls = [];
  const got = await geminiModels("k", ["gemini-2.5-flash"], { fetchImpl: fakeFetch([{ body: { models: [M("gemini-3-flash")], nextPageToken: "p2" } }, { body: { models: [M("gemini-3.5-flash")] } }], calls), now: 1 });
  assert.equal(calls.length, 2); assert.match(calls[1], /pageToken=p2/);
  assert.deepEqual(got, ["gemini-3.5-flash", "gemini-3-flash"]);
});

// 假 Google：列出模型回 names；generateContent 依 limited（回 429 的型號）決定成敗，asked 記下依序試了哪些型號
function fakeGoogle(names, limited = () => false) {
  const asked = [];
  const fetchImpl = async url => {
    url = String(url);
    if (/\/v1beta\/models\?/.test(url)) return { ok: true, json: async () => ({ models: names.map(n => M(n)) }) };
    const m = url.match(/models\/([^:]+):generateContent/)[1]; asked.push(m);
    if (limited(m)) return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "回覆" }] }, finishReason: "STOP" }] }) };
  };
  return { asked, fetchImpl };
}
const ALL = ["gemini-3.8-flash", "gemini-3.6-flash-001", "gemini-3-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];
async function withFetch(fake, fn) { const real = globalThis.fetch; globalThis.fetch = fake.fetchImpl; try { return await fn(); } finally { globalThis.fetch = real; } }

test("各用途型號順序：問問題 Flash 為主、AI 整理 3.1 Lite、摘要 3.5 Lite、截圖 Flash；名稱可配到 -001／-preview 版本", async () => {
  const { GEMINI_ORDER, resolveName } = await import("../api/_lib/_gemini.js");
  assert.match(GEMINI_ORDER.chat[0], /^gemini-3\.8-flash$/);
  assert.equal(GEMINI_ORDER.today[0], "gemini-3.1-flash-lite");
  assert.equal(GEMINI_ORDER.batch[0], "gemini-3.5-flash-lite", "排程和網站 AI 整理各用一個 Lite，不互搶額度");
  assert.ok(!/lite/.test(GEMINI_ORDER.vision[0]), "讀截圖用 Flash");
  const names = new Set(["gemini-3.6-flash-lite", "gemini-3.6-flash-preview-09", "gemini-3.6-flash-001", "gemini-3.1-flash-lite-preview-10", "gemini-3.6-flash-image"]);
  assert.equal(resolveName("gemini-3.6-flash", names), "gemini-3.6-flash-001", "正式版優先於預覽版，不把 Lite、image 配給 Flash");
  assert.equal(resolveName("gemini-3.1-flash-lite", names), "gemini-3.1-flash-lite-preview-10");
  assert.equal(resolveName("gemini-3-flash", names), null);
});

test("問問題：3.8 Flash 額度用完（429）改用 3.6 Flash；全部用完回報 429 而不是「找不到模型」", async () => {
  const { askGemini } = await import("../api/_lib/chat.js");
  _resetGeminiCache();
  let g = fakeGoogle(ALL, m => m === "gemini-3.8-flash");
  let r = await withFetch(g, () => askGemini("sys", [{ role: "user", content: "q" }], "k", undefined, { wait: async () => {} }));
  assert.equal(r.ok, true); assert.equal(r.model, "gemini-3.6-flash-001");
  assert.deepEqual(g.asked, ["gemini-3.8-flash", "gemini-3.6-flash-001"], "已下架的不試，額度用完直接換下一個");
  _resetGeminiCache();
  g = fakeGoogle(ALL, () => true);
  r = await withFetch(g, () => askGemini("sys", [{ role: "user", content: "q" }], "k", undefined, { wait: async () => {} }));
  assert.equal(r.ok, false); assert.equal(r.status, 429, "額度用完要說額度，不是找不到模型");
  assert.equal(g.asked.length, 3, "最多呼叫 WEB_TRIES 次");
});

test("AI 整理（use: today）先用 3.1 Flash Lite，沒有就用 3.5 Flash Lite；GEMINI_MODEL 不影響 AI 整理", async () => {
  const { askGemini } = await import("../api/_lib/chat.js");
  for (const [names, first] of [[ALL, "gemini-3.1-flash-lite"], [ALL.filter(n => n !== "gemini-3.1-flash-lite"), "gemini-3.5-flash-lite"]]) {
    _resetGeminiCache();
    const g = fakeGoogle(names);
    const r = await withFetch(g, () => askGemini("s", [{ role: "user", content: "q" }], "k", "gemini-3.8-flash", { use: "today" }));
    assert.equal(r.model, first); assert.deepEqual(g.asked, [first]);
  }
});

test("摘要（geminiJSON）先用 3.5 Flash Lite，額度用完換 Lite 別名", async () => {
  const { geminiJSON } = await import("../api/_lib/podcast.js");
  _resetGeminiCache();
  const g = fakeGoogle(ALL, m => m === "gemini-3.5-flash-lite");
  const r = await withFetch(g, () => geminiJSON([{ text: "x" }], "k", Date.now() + 30000));
  assert.deepEqual(g.asked, ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"]); assert.equal(r.model, "gemini-flash-lite-latest");
});
