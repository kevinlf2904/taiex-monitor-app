// Claude 總開關（#262 NEW-02、#264 A2）：AI_CLAUDE_ENABLED=1 才允許任何路徑呼叫 Claude（付費），預設關閉。
// 網站主要靠 Gemini；只有 ANTHROPIC_API_KEY、沒開總開關時，問問題、截圖匯入、節目摘要、K 線截圖解讀都不能偷偷用 Claude。
// 全部用假的 fetch 記錄「有沒有打到 api.anthropic.com」，不連外、不呼叫付費 AI。
import test from "node:test";
import assert from "node:assert/strict";
import { claudeEnabled, claudeUsable, claudeFallbackOn } from "../api/_lib/_limit.js";

const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_CLAUDE_ENABLED", "AI_CLAUDE_FALLBACK", "AI_LIMIT_STRICT", "GEMINI_MODEL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
// 在指定的環境變數下跑 fn（先清掉所有相關變數，結束後還原）；假 fetch 記錄 Claude／Gemini 呼叫
async function withEnv(env, fn, { gemini = "ok" } = {}) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])), real = globalThis.fetch, calls = { claude: 0, gemini: 0 };
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    const u = String(url?.url || url);
    if (/api\.anthropic\.com/.test(u)) {
      calls.claude++;
      return new Response(JSON.stringify({ id: "m1", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: '{"rows":[{"name":"台積電","code":"2330","shares":1000}]}' }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/generativelanguage\.googleapis\.com/.test(u)) {
      if (/\/v1beta\/models\?/.test(u)) return new Response("{}", { status: 404 }); // 列出模型：失敗就照原清單
      calls.gemini++;
      if (gemini === "429") return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini 回答" }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("測試不該連外：" + u);
  };
  try { return { out: await fn(calls), calls }; }
  finally { globalThis.fetch = real; for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const call = async (mod, req) => { let out = null; const res = { status() { return this; }, setHeader() {}, json(v) { out = v; return this; } }; await mod.default({ headers: {}, query: {}, ...req }, res); return out; };
const chat = () => import("../api/_lib/chat.js"), imp = () => import("../api/_lib/import.js"), pod = () => import("../api/_lib/podcast.js"), cr = () => import("../api/_lib/chart-read.js");

test("旗標：總開關沒設＝全部關；金鑰沒設也不算可用；改問 Claude 要總開關＋AI_CLAUDE_FALLBACK 兩個都開", async () => {
  await withEnv({}, () => { assert.deepEqual([claudeEnabled(), claudeUsable(), claudeFallbackOn()], [false, false, false]); });
  await withEnv({ ANTHROPIC_API_KEY: "k" }, () => { assert.deepEqual([claudeEnabled(), claudeUsable(), claudeFallbackOn()], [false, false, false], "只有金鑰：不可用"); });
  await withEnv({ AI_CLAUDE_ENABLED: "1" }, () => { assert.deepEqual([claudeEnabled(), claudeUsable(), claudeFallbackOn()], [true, false, false], "只有總開關、沒有金鑰：不可用（金鑰拿掉也安全）"); });
  await withEnv({ AI_CLAUDE_ENABLED: "1", ANTHROPIC_API_KEY: "k" }, () => { assert.deepEqual([claudeEnabled(), claudeUsable(), claudeFallbackOn()], [true, true, false], "可以當主要供應商，還不能當備援"); });
  await withEnv({ AI_CLAUDE_ENABLED: "1", ANTHROPIC_API_KEY: "k", AI_CLAUDE_FALLBACK: "1" }, () => { assert.equal(claudeFallbackOn(), true); });
  await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_FALLBACK: "1" }, () => { assert.equal(claudeFallbackOn(), false, "只開 FALLBACK、沒開總開關：還是不能用（以前這樣就會用）"); });
  for (const v of ["0", "true", "", " 1"]) await withEnv({ AI_CLAUDE_ENABLED: v, ANTHROPIC_API_KEY: "k" }, () => { assert.equal(claudeEnabled(), false, `"${v}" 不算開啟`); });
  await withEnv({ AI_CLAUDE_ENABLED: "1", ANTHROPIC_API_KEY: "   " }, () => { assert.equal(claudeUsable(), false, "金鑰只有空白"); });
});

test("問問題 /api/chat：只有 Anthropic 金鑰、沒開總開關 → 不呼叫 Claude；開了才用；GET 回報的供應商也一致", async () => {
  const body = { messages: [{ role: "user", content: "什麼是 KD？" }] }, M = await chat();
  let r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "POST", body }));
  assert.equal(r.out.ok, false); assert.match(r.out.error, /GEMINI_API_KEY/); assert.equal(r.calls.claude, 0, "沒開總開關：不能打 Claude");
  r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "GET" })); assert.equal(r.out.provider, null, "GET 也不能說是 claude");
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body }));
  assert.equal(r.out.ok, true); assert.equal(r.out.provider, "claude"); assert.equal(r.calls.claude, 1);
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "GET" })); assert.equal(r.out.provider, "claude");
  // 有 Gemini 金鑰：一律用 Gemini，不論 Claude 開不開
  for (const on of [{}, { AI_CLAUDE_ENABLED: "1" }]) { r = await withEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "k", ...on }, () => call(M, { method: "POST", body })); assert.equal(r.out.provider, "gemini"); assert.equal(r.calls.claude, 0); }
  // 金鑰拿掉＋總開關還開著：回明確的錯誤，不會丟例外
  r = await withEnv({ AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body })); assert.equal(r.out.ok, false); assert.equal(r.calls.claude, 0);
});

test("問問題：Gemini 額度用完（429）改問 Claude 要總開關＋AI_CLAUDE_FALLBACK 都開；其中一個沒開就不改問", async () => {
  const body = { messages: [{ role: "user", content: "q" }] }, M = await chat(), base = { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "k" };
  for (const [name, env, want] of [["都沒開", {}, 0], ["只開 FALLBACK（以前會改問）", { AI_CLAUDE_FALLBACK: "1" }, 0], ["只開總開關", { AI_CLAUDE_ENABLED: "1" }, 0], ["兩個都開", { AI_CLAUDE_ENABLED: "1", AI_CLAUDE_FALLBACK: "1" }, 1]]) {
    const r = await withEnv({ ...base, ...env }, () => call(M, { method: "POST", body }), { gemini: "429" });
    assert.equal(r.calls.claude, want, name); assert.ok(r.calls.gemini >= 1, name + "：先問過 Gemini");
    assert.equal(r.out.ok, want === 1, name);
  }
});

test("截圖匯入 /api/import：沒有 Gemini 金鑰時，Claude 要總開關才會用", async () => {
  const M = await imp(), body = { images: ["data:image/png;base64,AAAA"] };
  let r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "POST", body }));
  assert.equal(r.out.ok, false); assert.match(r.out.error, /GEMINI_API_KEY/); assert.equal(r.calls.claude, 0);
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body }));
  assert.equal(r.calls.claude, 1); assert.equal(r.out.ok, true); assert.equal(r.out.rows[0].code, "2330");
  r = await withEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "k", AI_CLAUDE_FALLBACK: "1" }, () => call(M, { method: "POST", body }), { gemini: "429" });
  assert.equal(r.calls.claude, 0, "Gemini 429＋只開 FALLBACK：不改問 Claude");
});

test("節目摘要 /api/podcast：只靠節目說明整理（沒有 Gemini 金鑰）時，Claude 要總開關；cfg 回報一致", async () => {
  const M = await pod(), body = { act: "sum", title: "t", show: "s", desc: "這是一段超過四十個字的節目說明，用來測試沒有 Gemini 金鑰時只靠節目說明整理的路徑會不會呼叫 Claude。".repeat(2) };
  let r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "POST", body }));
  assert.equal(r.out.ok, false); assert.match(r.out.error, /GEMINI_API_KEY/); assert.equal(r.calls.claude, 0);
  r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "GET", query: { act: "cfg" } })); assert.equal(r.out.notes, false); assert.equal(r.out.provider, null);
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body })); assert.equal(r.calls.claude, 1, "總開關開了才會打 Claude");
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "GET", query: { act: "cfg" } })); assert.equal(r.out.notes, true); assert.equal(r.out.provider, "claude");
});

test("K 線截圖解讀 /api/chart-read（只用 Claude）：沒開總開關就不呼叫，開了才用", async () => {
  const M = await cr(), body = { image: "AAAA", mediaType: "image/png" };
  let r = await withEnv({ ANTHROPIC_API_KEY: "k" }, () => call(M, { method: "POST", body }));
  assert.equal(r.out.ok, false); assert.match(r.out.error, /沒有開放/); assert.equal(r.calls.claude, 0);
  r = await withEnv({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, () => call(M, { method: "POST", body })); assert.equal(r.calls.claude, 0, "有 Gemini 金鑰也一樣：這個功能只用 Claude，沒開就是沒開");
  r = await withEnv({ AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body })); assert.equal(r.out.ok, false); assert.match(r.out.error, /ANTHROPIC_API_KEY/); assert.equal(r.calls.claude, 0, "開了但沒有金鑰");
  r = await withEnv({ ANTHROPIC_API_KEY: "k", AI_CLAUDE_ENABLED: "1" }, () => call(M, { method: "POST", body })); assert.equal(r.calls.claude, 1); assert.equal(r.out.ok, true);
});
