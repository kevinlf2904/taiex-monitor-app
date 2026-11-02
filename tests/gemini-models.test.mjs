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

test("問 AI：預設型號每日額度用完（429）時改用查到的其他 Flash；全部失敗時回報 429 而不是「找不到模型」", async () => {
  const { askGemini } = await import("../api/_lib/chat.js");
  const list = { models: [M("gemini-flash-latest"), M("gemini-3-flash"), M("gemini-3.1-flash-lite"), M("gemini-flash-lite-latest")] };
  const real = globalThis.fetch;
  try {
    for (const allLimited of [false, true]) {
      _resetGeminiCache();
      const asked = [];
      globalThis.fetch = async url => {
        const m = String(url).match(/models\/([^:]+):generateContent/)?.[1];
        asked.push(m);
        if (m === "gemini-flash-latest" || allLimited) return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "回覆" }] }, finishReason: "STOP" }] }) };
      };
      const r = await askGemini("sys", [{ role: "user", content: "q" }], "k", undefined, { wait: async () => {}, listOpts: { fetchImpl: async () => ({ ok: true, json: async () => list }), now: 1 } });
      if (!allLimited) {
        assert.equal(r.ok, true); assert.equal(r.model, "gemini-flash-lite-latest");
        assert.deepEqual(asked, ["gemini-flash-latest", "gemini-flash-lite-latest"], "已下架的 2.5 不試，額度用完直接換下一個");
      } else {
        assert.equal(r.ok, false); assert.equal(r.status, 429, "額度用完要說額度，不是找不到模型");
        assert.equal(asked.length, 3, "最多呼叫 WEB_TRIES 次");
      }
    }
  } finally { globalThis.fetch = real; }
});

test("問 AI：AI 整理送 model: lite 時先用 3.1 Flash Lite；沒有這個型號就用 Lite 別名", async () => {
  const { askGemini, GEMINI_LITE } = await import("../api/_lib/chat.js");
  const real = globalThis.fetch;
  try {
    for (const [models, first] of [[["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"], "gemini-3.1-flash-lite"], [["gemini-flash-latest", "gemini-flash-lite-latest"], "gemini-flash-lite-latest"]]) {
      _resetGeminiCache();
      const asked = [];
      globalThis.fetch = async url => { asked.push(String(url).match(/models\/([^:]+):/)[1]); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) }; };
      const r = await askGemini("s", [{ role: "user", content: "q" }], "k", GEMINI_LITE[0], { prefer: GEMINI_LITE, listOpts: { fetchImpl: async () => ({ ok: true, json: async () => ({ models: models.map(n => M(n)) }) }), now: 1 } });
      assert.equal(r.model, first); assert.deepEqual(asked, [first]);
    }
  } finally { globalThis.fetch = real; }
});
