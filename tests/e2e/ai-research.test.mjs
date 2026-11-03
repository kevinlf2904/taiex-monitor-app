// AI 研究室（今日市場「AI 研究」）：送出研究模式、只送編號資料表；回來的 JSON 畫成多空、情境、未知事項與客觀數據；
// 資料不足時不呼叫 AI；Gemini 429 顯示原因；手機（390）與桌面（1280）版面；同一天重畫還原、盤中 30 分鐘提醒、換日不還原
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const REPORT = { status: "ok", summary: "推論：盤勢偏弱。", bull: [{ text: "航運法人買超（估算）", refs: ["tw.T00.price"] }, { text: "櫃買跌幅較小", refs: ["tw.O00.chg"] }],
  bear: [{ text: "加權下跌", refs: ["tw.T00.chg"] }, { text: "外資賣超 999 億", refs: ["tw.T00.chg"] }], sectors: [{ text: "資金流向未取得時不寫", refs: ["made.up"] }], levels: [],
  scenarios: [{ type: "bull", trigger: "站回分水嶺", watch: "廣度", invalidation: "跌破支撐", refs: ["tw.T00.price"] }, { type: "neutral", trigger: "區間整理", refs: ["tw.T00.price"] }, { type: "bear", trigger: "跌破支撐", refs: ["tw.T00.price"] }],
  risks: [{ text: "美股續跌", refs: ["tw.T00.chg"] }], unknowns: ["今天法人"], conclusion: { text: "如果站回分水嶺，則轉為中性。", refs: ["tw.T00.price"] } };
// 測試環境沒有法人、美股資料：補一點假的全球與廣度資料，讓資料類別夠 2 類（gate 通過）
// 背景輪詢會換掉 W 的報價、國際行情：在「研究取資料的那一刻」才放進去（包一層 researchInput）
const seed = () => { const o = window.KLMarketCenter; window.KLMarketCenter = Object.freeze({ ...o, researchInput: W => {
  for (const c of ["T00", "O00"]) W.quotes.set(c, { ...W.quotes.get(c), date: "2026-10-26", time: "10:00:00", source: "富果", updateMode: "live" });
  W.gl = { ok: true, sourceFetchedAt: new Date().toISOString(), groups: [{ rows: [{ code: "TWD=X", name: "美元／台幣", price: 32.6, chgPct: 0.5 }] }] };
  W.mkt = { date: "2026-10-26", time: "10:00", live: true, breadth: { up: 300, down: 600, flat: 50 } }; return o.researchInput(W); } }); };

async function run(p, ctx, reply) {
  const sent = [];
  await ctx.route("**/api/chat", r => { sent.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ contentType: "application/json", body: JSON.stringify(reply) }); });
  await p.evaluate(seed); await p.evaluate(() => { try { sessionStorage.clear(); } catch {} W.tdPh = null; W.tdAI = null; setLt("today"); renderList(); });
  await p.click('#lx [data-tx="tdai"]');
  await p.waitForFunction(() => !W.tdAI?.loading && /AI|資料不足|⚠︎/.test(document.querySelector("#lx .mc-ai-panel .caibox")?.textContent || ""), null, { timeout: 20000 });
  return sent;
}

test("AI 研究室：研究模式只送編號資料表；報告分多空、情境、未知事項；不存在的編號與數字標出來；客觀數據由程式列出", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, time: new Date("2026-10-26T10:00:00+08:00") });
  const sent = await run(p, ctx, { ok: true, text: JSON.stringify(REPORT), model: "gemini-3.1-flash-lite" });
  assert.equal(sent.length, 1); assert.equal(sent[0].purpose, "research"); assert.equal(sent[0].model, "lite");
  assert.match(sent[0].context, /^資料表（編號/); assert.match(sent[0].context, /tw\.T00\.price \| 加權指數/);
  const r = await p.evaluate(() => { const b = document.querySelector("#lx .mc-ai-panel .rs-report"), t = b?.textContent || "";
    return { secs: [...b.querySelectorAll(".rs-sec h5")].map(h => h.textContent), sc: b.querySelectorAll(".rs-sc-c").length, flag: /未能對照資料（999）/.test(t), ref: /引用了不存在的資料編號/.test(t), facts: !!b.querySelector(".rs-facts .rs-row"), model: /gemini-3\.1-flash-lite/.test(t), two: getComputedStyle(b.querySelector(".rs-two")).gridTemplateColumns.split(" ").length }; });
  for (const k of ["研究摘要", "多方論點", "空方論點", "情境推演", "風險與反證", "研究結論（條件式）", "未知事項"]) assert.ok(r.secs.includes(k), "有 " + k + "：" + r.secs);
  assert.equal(r.sc, 3); assert.equal(r.flag, true); assert.equal(r.ref, true); assert.equal(r.facts, true); assert.equal(r.model, true);
  assert.equal(r.two, 2, "桌面：多空左右並排");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("AI 研究室：手機 390 版面不溢出、多空與情境改成單欄；同一天重畫還原，盤中超過 30 分鐘提醒，換日不還原", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: new Date("2026-10-26T10:00:00+08:00") });
  await run(p, ctx, { ok: true, text: JSON.stringify(REPORT) });
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, two: getComputedStyle(document.querySelector("#lx .rs-two")).gridTemplateColumns.split(" ").length, sc: getComputedStyle(document.querySelector("#lx .rs-sc")).gridTemplateColumns.split(" ").length }));
  assert.ok(r.sw <= 391, "沒有水平溢出：" + r.sw); assert.equal(r.two, 1); assert.equal(r.sc, 1);
  await p.evaluate(() => { const x = JSON.parse(sessionStorage.getItem("kline:mcai:v2")); x.at -= 31 * 60e3; sessionStorage.setItem("kline:mcai:v2", JSON.stringify(x)); W.tdAI = null; renderList(); });
  assert.deepEqual(await p.evaluate(() => [!!document.querySelector("#lx .rs-report"), !!document.querySelector("#lx .cai-old"), document.querySelector("#lx [data-mc-ai]")?.textContent]), [true, true, "重新整理"]);
  await p.evaluate(() => { const x = JSON.parse(sessionStorage.getItem("kline:mcai:v2")); x.d = "2026-10-23"; sessionStorage.setItem("kline:mcai:v2", JSON.stringify(x)); W.tdAI = null; renderList(); });
  assert.equal(await p.evaluate(() => !!document.querySelector("#lx .rs-report")), false, "換日不還原");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("AI 研究室：資料不足時不呼叫 AI，只列未知事項與客觀數據；Gemini 429 顯示額度用完", async () => {
  let { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, time: new Date("2026-10-26T10:00:00+08:00") });
  const calls = []; await ctx.route("**/api/chat", r => { calls.push(1); r.fulfill({ contentType: "application/json", body: '{"ok":true,"text":"{}"}' }); });
  await p.evaluate(() => { W.gl = null; W.mkt = null; W.tdPh = null; W.tdAI = null; setLt("today"); renderList(); });
  await p.click('#lx [data-tx="tdai"]'); await p.waitForFunction(() => /資料不足/.test(document.querySelector("#lx .mc-ai-panel .caibox")?.textContent || ""), null, { timeout: 20000 });
  assert.equal(calls.length, 0, "沒有呼叫 AI");
  assert.match(await p.textContent("#lx .mc-ai-panel .caibox"), /先不產生研究報告.*未知事項|未知事項.*先不產生研究報告/s);
  await ctx.close(); assert.deepEqual(errs, []);
  ({ ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, time: new Date("2026-10-26T10:00:00+08:00") }));
  await run(p, ctx, { ok: false, error: "Gemini 免費額度暫時用完或問得太頻繁，請等一下再試。", provider: "gemini" });
  const t = await p.textContent("#lx .mc-ai-panel .caibox"); assert.match(t, /額度暫時用完/); assert.match(t, /客觀數據/, "失敗時仍列客觀數據");
  await ctx.close(); assert.deepEqual(errs, []);
});
