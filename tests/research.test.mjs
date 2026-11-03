// AI 研究室：資料契約（buildSnapshot）、資料不足不呼叫 AI（gate）、送出內容（contextText／prompt）、AI 回傳檢查（parseReport）、
// 伺服器研究模式（/api/chat purpose: research）。全部用固定假資料，不連外部服務（node --test tests/research.test.mjs）
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/research.js", import.meta.url), "utf8"), ctx);
const R = ctx.KLResearch;
const NOW = Date.parse("2026-11-03T03:30:00Z"); // 台北 11:30 盤中
const q = (o = {}) => ({ code: "T00", price: 43615.89, chgPct: -2.9, date: "2026-11-03", time: "11:30:00", source: "富果", updateMode: "live", isFallback: false, fetchedAt: "2026-11-03T03:30:00Z", ...o });
const sectors = [{ name: "半導體", net1: -310.4, f1: -280, tr1: -12, net5: -820.2, pct1: -3.1, prev1: 50 }, { name: "航運", net1: 22.5, f1: 10, tr1: 9, net5: 40, pct1: 1.2, prev1: -5 }, { name: "金融", net1: 8, f1: 2, tr1: 5, net5: 30, pct1: 0.4 }];
const base = (o = {}) => ({
  now: NOW, session: "open", expectedDate: "2026-11-03",
  quotes: { T00: q(), O00: q({ code: "O00", price: 347.01, chgPct: -6.02 }) },
  breadth: { date: "2026-11-03", time: "11:30", live: true, breadth: { up: 120, down: 1580, flat: 60, limUp: 3, limDn: 40 }, source: "證交所、櫃買中心" },
  flow: { date: "2026-11-02", mood: { score: 32, net: -520.4, label: "偏恐慌" }, sectors, label: "前一交易日" },
  levels: { pressure: 44900.4, pivot: 44200, support: 43729.2, forDate: "2026-11-03", estimate: false },
  us: { rows: [{ code: "^GSPC", name: "S&P 500", chgPct: -1.2 }, { code: "^SOX", name: "費半", chgPct: -3.4 }], dataStatus: "confirmed", dataDate: "2026-11-02", sourceTime: "16:00", source: "Yahoo Finance" },
  global: { rows: [{ code: "TWD=X", name: "美元／台幣", price: 32.6, chgPct: 0.5 }], fetchedAt: "2026-11-03T03:25:00Z" },
  news: { date: "2026-11-03", tw: { sum: { head: "外資賣超、台幣走弱", points: ["AI 概念股重挫"] } } },
  ...o
});
const get = (s, id) => s.records.find(r => r.id === id);
const FIELDS = ["value", "symbol", "market", "source", "tradeDate", "updatedAt", "dataStatus", "isEstimated", "isPartial", "confidence"];

test("1 正常資料：每筆研究資料都有契約欄位；盤中富果是即時、法人金額與模型價位標估算", () => {
  const s = R.buildSnapshot(base());
  for (const r of s.records) for (const f of FIELDS) assert.ok(f in r, `${r.id} 有 ${f}`);
  assert.equal(get(s, "tw.T00.price").dataStatus, "realtime"); assert.equal(get(s, "tw.T00.price").confidence, "high");
  assert.equal(get(s, "tw.flow.net").isEstimated, true); assert.equal(get(s, "lv.pivot").dataStatus, "estimated");
  assert.equal(get(s, "calc.toLv.support").value, Math.round(43615.89 - 43729.2), "離價位的距離由程式算好");
  assert.equal(get(s, "us.^SOX.chg").market, "US"); assert.equal(get(s, "us.^SOX.chg").tz, "America/New_York");
  assert.deepEqual([...R.STATUSES], ["realtime", "delayed", "after_hours", "estimated", "partial", "stale", "unavailable"]);
  assert.equal(R.gate(s).ok, true);
});

test("2 部分資料缺失：缺的標 unavailable 並列進缺漏，不補數字；資料類別不夠就不產生報告", () => {
  const s = R.buildSnapshot(base({ breadth: null, flow: { label: "法人資料載入中" }, levels: null, global: {}, us: {} }));
  assert.equal(get(s, "tw.breadth.up").value, null); assert.equal(get(s, "tw.breadth.up").dataStatus, "unavailable");
  assert.ok(s.gaps.some(g => /市場廣度/.test(g))); assert.ok(s.gaps.some(g => /法人資金流向/.test(g)));
  const g = R.gate(s); assert.equal(g.ok, false); assert.match(g.reason, /資料不足/);
  assert.ok(!/市場廣度 \|/.test(R.contextText(s)), "未取得的不佔資料行");
  const p = R.buildSnapshot(base({ breadth: { date: "2026-11-03", live: true, breadth: { up: 1, down: 2 } } }));
  assert.equal(get(p, "tw.breadth.up").dataStatus, "partial", "少了平盤家數：部分資料"); assert.equal(get(p, "tw.breadth.up").isPartial, true);
});

test("3 過期行情：加權日期比應有的交易日舊 → stale，資料不足、不呼叫 AI", () => {
  const s = R.buildSnapshot(base({ quotes: { T00: q({ date: "2026-10-30" }) } }));
  assert.equal(get(s, "tw.T00.price").dataStatus, "stale"); assert.equal(R.gate(s).ok, false);
  assert.ok(s.gaps.some(g => /加權指數：資料過期（2026-10-30）/.test(g)));
});

test("4 不同交易日：市場廣度和加權不同日標 stale；法人資料日不同會寫出日期，不說成同一天", () => {
  const s = R.buildSnapshot(base({ breadth: { date: "2026-11-02", live: false, breadth: { up: 900, down: 700, flat: 100 } } }));
  assert.equal(get(s, "tw.breadth.up").dataStatus, "stale"); assert.match(get(s, "tw.breadth.up").note, /不同日/);
  assert.ok(s.warnings.some(w => /法人資料日 2026-11-02，和加權（2026-11-03）不同日/.test(w)));
  assert.match(R.contextText(s), /注意：法人資料日 2026-11-02/);
});

test("5 盤中與盤後：盤中富果 realtime、備援來源 delayed；收盤後 after_hours；盤前看前一交易日收盤不算過期", () => {
  assert.equal(R.twQuoteStatus(q(), "2026-11-03", "open"), "realtime");
  assert.equal(R.twQuoteStatus(q({ source: "Yahoo Finance", isFallback: true }), "2026-11-03", "open"), "delayed");
  assert.equal(R.twQuoteStatus(q(), "2026-11-03", "post"), "after_hours");
  assert.equal(R.twQuoteStatus(q({ date: "2026-11-02" }), "2026-11-02", "pre"), "after_hours");
  assert.equal(R.twQuoteStatus(q({ estimated: true }), "2026-11-03", "open"), "estimated");
  assert.equal(R.twQuoteStatus(null, "2026-11-03", "open"), "unavailable");
});

test("6 美股跨時區：美股保留美東資料日與時區；供應商盤中報價標延遲，收盤確認標盤後", () => {
  const live = R.buildSnapshot(base({ us: { rows: [{ code: "^IXIC", name: "那斯達克", chgPct: 0.8 }], dataStatus: "live", dataDate: "2026-11-02", sourceTime: "14:05" } }));
  const r = get(live, "us.^IXIC.chg"); assert.equal(r.dataStatus, "delayed"); assert.equal(r.tradeDate, "2026-11-02"); assert.match(r.updatedAt, /美東/);
  assert.match(R.contextText(live), /us\.\^IXIC\.chg \| 那斯達克 漲跌幅 \| 0\.8 % \| 2026-11-02（美東）/);
  assert.equal(get(R.buildSnapshot(base()), "us.^GSPC.chg").dataStatus, "after_hours");
});

test("7 法人資料延遲：法人金額一律估算、標實際資料日；外資、投信拆開寫在備註", () => {
  const s = R.buildSnapshot(base());
  const r = get(s, "tw.flow.out1.net1"); assert.equal(r.tradeDate, "2026-11-02"); assert.equal(r.dataStatus, "estimated"); assert.match(r.note, /外資 -280\.0、投信 -12\.0 億/);
  assert.equal(get(s, "tw.flow.in1.net1").label, "航運 法人淨額");
  assert.ok(s.records.filter(x => /^tw\.flow\.(in|out)\d/.test(x.id) && x.id.endsWith(".net1")).length <= 10, "各取前五，雜訊不無限制傳給 AI");
});

const good = { status: "ok", summary: "加權 43615.89 盤中下跌 2.9%。", bull: [{ text: "航運法人買超 22.5 億（估算）", refs: ["tw.flow.in1.net1"] }], bear: [{ text: "下跌家數 1580 家", refs: ["tw.breadth.down"] }],
  sectors: [], levels: [{ text: "加權在支撐下方 113 點", refs: ["calc.toLv.support"] }],
  scenarios: [{ type: "bull", trigger: "站回 44200", watch: "廣度", invalidation: "跌破 43729.2", refs: ["lv.pivot"] }, { type: "neutral", trigger: "在 43729.2～44200 之間", refs: ["lv.support"] }, { type: "bear", trigger: "跌破支撐", refs: ["lv.support"] }],
  risks: [{ text: "費半 -3.4%", refs: ["us.^SOX.chg"] }], unknowns: ["今天的法人資料"], conclusion: { text: "如果站回 44200，則…", refs: ["lv.pivot"] } };

test("9 AI 回應格式錯誤：不是 JSON 就回報格式錯誤，畫面只顯示客觀數據", () => {
  const s = R.buildSnapshot(base()), p = R.parseReport("今天大盤下跌，建議觀望", s);
  assert.equal(p.ok, false); assert.match(p.error, /格式錯誤/);
  const h = R.renderReport(p, s, {}); assert.match(h, /格式錯誤/); assert.match(h, /客觀數據/); assert.match(h, /43,615\.89/);
  assert.equal(R.parseReport("```json\n" + JSON.stringify(good) + "\n```", s).ok, true, "包在 ```json 裡也能解析");
});

test("10 AI 輸出數字驗證：日期、時間、股票代號排除；行情數字保留；負數不再被無條件放行", () => {
  const s = R.buildSnapshot(base());
  const p = R.parseReport(JSON.stringify({ ...good, bear: [{ text: "下跌家數 1,580 家、外資賣超 999 億", refs: ["tw.breadth.down"] }] }), s);
  assert.equal(p.report.bear[0].unverified, true); assert.deepEqual([...p.report.bear[0].badNums], [999]);
  assert.ok(p.issues.some(i => i.type === "number"));
  const ok = R.parseReport(JSON.stringify(good), s);
  assert.equal(ok.report.bull[0].unverified, false); assert.equal(ok.report.summary.unverified, false, "43615.89、2.9（保留正負號後取絕對值比對）對得上");
  assert.equal(R.numberOk(310, [-310.4]), true, "四捨五入到整數");
  assert.equal(R.numberOk(-500, [500]), true, "負數可與資料的絕對值比對");
  assert.equal(R.numberOk(-1200, [1200]), true, "較大的負整數不被錯誤豁免");
  assert.equal(R.numberOk(-500, []), false, "無資料依據的負數不可豁免");
  assert.equal(R.numberOk(-2, []), false, "負的小整數不可套用正數 1～10 豁免");
  assert.equal(R.numberOk(-20, []), false, "負數不可套用常見週期豁免");
  assert.equal(R.numberOk(3, []), true, "正的小整數維持豁免");
  assert.deepEqual([...R.numbersIn("2026-11-03 11:30 費半 ^SOX 下跌 3.4%")], [3.4], "日期、時間、代號不算數字");
  assert.deepEqual([...R.numbersIn("台積電 2330、台積電(2330)、聯發科（2454）、ETF 0050、台泥 1101、2330.TW、代號 2454、2026 年")], [], "股票代號及年份不算行情數字");
  assert.deepEqual([...R.numbersIn("成交量 2330 張、指數上漲 2330 點、外資賣超 2330 億")], [2330, 2330, 2330], "四位數行情數字仍須核對");
  assert.deepEqual([...R.numbersIn("大盤下跌 -2.3%")], [-2.3], "保留負號");
  assert.match(R.renderReport(p, s, {}), /⚠︎ 未能對照資料（999）/);
});

test("10A 引用方向驗證：引用存在但買賣超或漲跌方向相反，該段落必須標未驗證", () => {
  const s = R.buildSnapshot(base());
  const p = R.parseReport(JSON.stringify({
    ...good,
    bull: [{ text: "半導體法人買超 310.4 億", refs: ["tw.flow.out1.net1"] }],
    bear: [{ text: "加權上漲 2.9%", refs: ["tw.T00.chg"] }]
  }), s);
  assert.equal(p.report.bull[0].unverified, true, "負淨額不能支持買超");
  assert.equal(p.report.bear[0].unverified, true, "負漲跌幅不能支持上漲");
  assert.equal(p.issues.filter(i => i.type === "direction").length, 2);
  assert.equal(R.parseReport(JSON.stringify(good), s).issues.some(i => i.type === "direction"), false, "方向一致的既有報告不應誤報");
});

test("11 AI 引用不存在的來源：不存在的編號移除並記錄；沒有任何有效引用的那一點標未驗證", () => {
  const s = R.buildSnapshot(base());
  const p = R.parseReport(JSON.stringify({ ...good, risks: [{ text: "Fed 升息", refs: ["news.fed", "made.up"] }] }), s);
  assert.deepEqual([...p.report.risks[0].refs], []); assert.equal(p.report.risks[0].unverified, true);
  assert.deepEqual([...p.issues.find(i => i.type === "ref").refs], ["news.fed", "made.up"]);
  assert.match(R.renderReport(p, s, { at: NOW }), /引用了不存在的資料編號/);
  const miss = R.parseReport(JSON.stringify({ ...good, scenarios: [good.scenarios[0]] }), s);
  assert.ok(miss.issues.some(i => i.type === "scenario"), "情境少了中性、偏空要記錄");
});

test("自選：取漲跌幅最大的幾檔，台股照報價狀態、美股看自己的時段；報告有「自選與持股」段落", () => {
  const s = R.buildSnapshot(base({ watch: [q({ code: "2330", name: "台積電", chgPct: -3.59 }), { code: "NVDA", name: "輝達", chgPct: -1.26, date: "2026-11-02", source: "Yahoo Finance", session: { state: "closed" } }] }));
  assert.equal(get(s, "watch.2330.chg").dataStatus, "realtime"); assert.equal(get(s, "watch.NVDA.chg").market, "US"); assert.equal(get(s, "watch.NVDA.chg").dataStatus, "after_hours");
  const p = R.parseReport(JSON.stringify({ ...good, watchlist: [{ text: "台積電下跌 3.59%", refs: ["watch.2330.chg"] }] }), s);
  assert.equal(p.report.watchlist[0].unverified, false); assert.match(R.renderReport(p, s, {}), /自選與持股/);
});

test("AI 回報資料不足：status insufficient 時不顯示結論，只列未知事項", () => {
  const s = R.buildSnapshot(base()), p = R.parseReport('{"status":"insufficient","unknowns":["缺今天法人"]}', s);
  assert.equal(p.insufficient, true); const h = R.renderReport(p, s, {});
  assert.match(h, /資料不足/); assert.match(h, /缺今天法人/); assert.doesNotMatch(h, /研究結論/);
});

test("14 成本控制：送出的資料有上限、不含「現在時間」（同樣資料可命中伺服器快取）；提問要求三種情境與條件式結論", () => {
  const big = base({ flow: { ...base().flow, sectors: Array.from({ length: 200 }, (_, i) => ({ name: "族群" + i, net1: i - 100, f1: 1, tr1: 1, net5: 1, pct1: 1 })) } });
  const s = R.buildSnapshot(big), c = R.contextText(s);
  assert.ok(c.length <= 5000, "資料表最多 5000 字：" + c.length); assert.doesNotMatch(c, /11:30（台北）|現在/);
  assert.equal(R.contextText(R.buildSnapshot(base())), R.contextText(R.buildSnapshot(base({ now: NOW + 60000 }))), "只差一分鐘、資料一樣 → 內容一樣");
  const p = R.prompt(s); for (const k of ['"bull"', '"neutral"', '"bear"', "條件式", "refs", "insufficient", "估算"]) assert.ok(p.includes(k), k);
  assert.equal(R.historyRecord(s, R.parseReport(JSON.stringify(good), s), { at: NOW, model: "m" }).followUpStatus, "pending", "研究歷史只定義結構，不存檔");
});

// 伺服器研究模式：假 Google，檢查送出的 generationConfig；429 時不改問 Claude
const M = n => ({ name: "models/" + n, supportedGenerationMethods: ["generateContent"] });
function fakeGoogle(status = 200, text = '{"status":"ok"}') {
  const bodies = [], asked = [];
  const fetchImpl = async (url, init) => {
    url = String(url);
    if (/\/v1beta\/models\?/.test(url)) return { ok: true, json: async () => ({ models: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash"].map(M) }) };
    asked.push(url.match(/models\/([^:]+):/)[1]); bodies.push(JSON.parse(init.body));
    if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: "quota" } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }) };
  };
  return { bodies, asked, fetchImpl };
}
async function callChat(body, g) {
  const { default: handler } = await import("../api/_lib/chat.js"), { _resetGeminiCache } = await import("../api/_lib/_gemini.js"); _resetGeminiCache();
  const env = { ...process.env }; Object.assign(process.env, { GEMINI_API_KEY: "test", ANTHROPIC_API_KEY: "test", AI_CLAUDE_FALLBACK: "1" }); delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
  const real = globalThis.fetch; globalThis.fetch = g.fetchImpl; let out = null;
  const res = { status() { return this; }, setHeader() {}, json(v) { out = v; return this; } };
  try { await handler({ method: "POST", body, headers: {} }, res); } finally { globalThis.fetch = real; process.env = env; }
  return out;
}

test("伺服器研究模式：用研究系統提示、Flash Lite、JSON 輸出、低溫度；一般問答維持原設定", async () => {
  let g = fakeGoogle(); const r = await callChat({ context: "資料表", messages: [{ role: "user", content: "q" }], model: "lite", purpose: "research" }, g);
  assert.equal(r.ok, true); assert.match(g.asked[0], /flash-lite/);
  assert.equal(g.bodies[0].generationConfig.responseMimeType, "application/json"); assert.equal(g.bodies[0].generationConfig.temperature, 0.2);
  assert.match(g.bodies[0].systemInstruction.parts[0].text, /市場研究助理/); assert.doesNotMatch(g.bodies[0].systemInstruction.parts[0].text, /300 字/);
  g = fakeGoogle(); await callChat({ messages: [{ role: "user", content: "q" }] }, g);
  assert.equal(g.bodies[0].generationConfig.temperature, 0.6); assert.match(g.bodies[0].systemInstruction.parts[0].text, /300 字/);
});

test("8 Gemini 429：研究模式回報額度用完，不改問 Claude（成本），最多呼叫 3 次", async () => {
  const g = fakeGoogle(429), r = await callChat({ context: "x", messages: [{ role: "user", content: "q" }], model: "lite", purpose: "research" }, g);
  assert.equal(r.ok, false); assert.match(r.error, /額度/); assert.equal(r.provider, "gemini", "沒有改問 Claude");
  assert.ok(g.asked.length <= 3);
});
