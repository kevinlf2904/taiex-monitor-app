// 瀏覽器測試共用：本機靜態伺服器＋所有 /api 與排程資料檔的假資料（CI 連不到證交所、Yahoo，也不該依賴外部服務）
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
export async function chromium() { const require = createRequire(import.meta.url); return (process.env.PW ? require(process.env.PW) : await import("playwright")).chromium; }
export function serve() {
  return new Promise(res => { const s = http.createServer(async (q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0])); try { const b = await readFile(f); r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(b); } catch { r.writeHead(404); r.end("nf"); } }).listen(0, () => res({ url: `http://localhost:${s.address().port}`, close: () => s.close() })); });
}
export const days = (from, to) => { const out = [], d = new Date(from + "T00:00:00Z"); let p = 500; while (d.toISOString().slice(0, 10) < to) { if (d.getUTCDay() % 6) { const o = p, c = +(o * (1 + Math.sin(out.length / 11) * 0.01)).toFixed(1); out.push({ d: d.toISOString().slice(0, 10), o, h: +(Math.max(o, c) * 1.004).toFixed(1), l: +(Math.min(o, c) * 0.996).toFixed(1), c, v: 15000 }); p = c; } d.setUTCDate(d.getUTCDate() + 1); } return out; };
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
// 所有假資料掛在 context 上（後註冊的路由優先）
export async function mock(ctx) {
  const K = days("2024-06-05", "2026-10-05");
  await ctx.route("**/api/**", r => J(r, { ok: false, error: "mock" }));
  await ctx.route("**/api/quote**", r => { const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean); J(r, { ok: true, source: "t", session: "open", today: "2026-10-05", quotes: codes.map((c, i) => ({ code: c, name: "股" + c, price: 100 + i, prev: 99, open: 99, high: 101, low: 98, vol: 2000, chg: (i % 3) - 1, chgPct: (i % 5) - 2, date: "2026-10-05", time: "10:30:05", market: "上市", bids: [], asks: [] })) }); });
  await ctx.route("**/api/kline**", r => { const c = new URL(r.request().url()).searchParams.get("code") || "x", seed = [...c].reduce((a, x) => a + x.charCodeAt(0), 0);
    J(r, { ok: true, code: c, name: c, market: "上市", source: "t", data: K.map((x, i) => { const cc = +(x.c * (1 + Math.sin(i / (7 + (seed % 5))) * 0.08)).toFixed(1); return { ...x, c: cc, h: +(Math.max(x.o, cc) * 1.01).toFixed(1), l: +(Math.min(x.o, cc) * 0.99).toFixed(1), v: 15000 + (i % 17 === 0 ? 60000 : 0) }; }) }); });
  await ctx.route("**/api/chat", r => J(r, { ok: true, text: "測試回覆" }));
  await ctx.route("**/api/etf**", r => { const c = new URL(r.request().url()).searchParams.get("code");
    J(r, { ok: true, code: c, source: "MoneyDJ 理財網", link: "https://example.com/etf", info: { name: "測試ETF" + c, issuer: "測試投信", index: "測試指數", aum: 2.4e12, cur: "台幣", fee: 0.15, ter: 0.22, freq: "半年配", yield: 1.5, prem: 0.3, sd: 20, n: 3, kind: "股票型", region: "台灣", strategy: "完全複製", kv: [["ETF名稱", "測試ETF"], ["經理費(%)", "0.15"]] },
      hold: { date: "2026-10-16", rows: [{ name: "台積電", code: "2330", pct: 56.6, sh: 5.8e8 }, { name: "聯發科", code: "2454", pct: 6, sh: 3.5e7 }, { name: "台達電", code: "2308", pct: 3, sh: 4.5e7 }] },
      month: { date: "2026-09-30", rows: [{ name: "台積電", code: "2330", sh: 5.6e8, pct: 56.45, chg: -0.9 }, { name: "聯發科", code: "2454", sh: 3.4e7, pct: 6.74, chg: 1.1 }] }, ind: { date: "2026-10-09", rows: [{ name: "半導體", pct: 68.9 }, { name: "金融保險", pct: 8 }] } }); });
  await ctx.route("**/data/etf-hold/**", r => J(r, { code: "0050", name: "元大台灣50", date: "2026-10-16", since: "2026-06-01", rows: [], ev: [{ d: "2026-09-19", t: "in", code: "3017", name: "奇鋐", pct: 0.5 }, { d: "2026-09-19", t: "out", code: "1101", name: "台泥", pct: 0.3 }] }));

  await ctx.route("**/api/usinfo**", r => J(r, { ok: true, code: "AAPL", source: "Finnhub、SEC EDGAR", errors: [], cik: "0000320193", profile: { name: "Apple Inc", exchange: "NASDAQ", industry: "Technology", country: "US", ipo: "1980-12-12", web: "https://www.apple.com/", cap: 3.5e12, shares: 1.5e10, currency: "USD" },
    metric: { pe: 33.2, eps: 6.5, div: 0.45, revG: 6.1, beta: 1.2, hi52: 260, lo52: 170, ret52: 12.3, gm: 46.5, om: 31.2, nm: 24.3, roe: 150.2, roa: 28.1, epsG: 9.8, pb: 50.1, ps: 8.7, de: 1.5, cr: 0.9 },
    rec: [{ period: "2026-10", sb: 12, b: 22, h: 8, s: 1, ss: 0 }, { period: "2026-09", sb: 11, b: 22, h: 9, s: 1, ss: 0 }], earn: [{ period: "2026-03-31", q: 2, y: 2026, actual: 1.6, est: 1.5, surp: 6.67 }, { period: "2026-06-30", q: 3, y: 2026, actual: 1.45, est: 1.43, surp: 1.4 }],
    fin: { q: [{ p: "2026Q1", rev: 9.5e10, ni: 2.4e10, gp: 4.4e10, op: 2.9e10 }, { p: "2026Q2", rev: 9.4e10, ni: 2.3e10, gp: 4.3e10, op: 2.8e10 }], y: [{ p: "2025", rev: 4.1e11, ni: 1.0e11, gp: 1.9e11, op: 1.3e11 }] } }));
  await ctx.route(/\/api\/intraday\?.*spark=1/, r => J(r, { ok: true, source: "t", prev: 100, spark: [["09:00", 100], ["10:00", 101], ["11:30", 102]], session: { open: "09:00", close: "13:30" } }));
  await ctx.route(/\/api\/futures\?.*bars=spark/, r => J(r, { ok: true, quote: { price: 101, chg: 1, chgPct: 1, prev: 100, session: "day" }, spark: [["08:45", 100], ["10:00", 99], ["11:00", 101]] }));
  const IC = ["2330", "2454", "2303", "3711", "2317", "2382", "2308", "2881", "2882", "3037", "3189", "8046", "2412", "1301", "2603", "2002", "1216", "2912"];
  await ctx.route("**/data/tpex-ic.json", r => J(r, { updated: "2026-10-18T00:00:00Z", source: "測試", industries: ["D000:半導體", "L000:印刷電路板", "U000:金融"].map((x, i) => { const [id, name] = x.split(":");
    return { id, name, segs: Array.from({ length: 6 }, (_, j) => ({ id: `${id[0]}${j}00`, name: `${name}細分${j + 1}`, stage: ["上游", "中游", "下游"][j % 3], codes: IC.slice((i * 5 + j) % 12, (i * 5 + j) % 12 + 4).map(c => [c, "股" + c]) })) }; }) }));
  await ctx.route(/\/api\/hot\?.*type=rows/, r => { const q = new URL(r.request().url()).searchParams.get("codes") || "", cs = q === "all" ? IC : q.split(",").filter(Boolean);
    J(r, { ok: true, live: true, date: "2026-10-16", source: "測試行情", rows: cs.map((c, i) => [c, 100 + i, +(((i * 37) % 11) - 5).toFixed(2), 1 + (i % 7)]) }); });
  await ctx.route("**/api/calendar**", r => J(r, { ok: true, rows: [{ date: "2026-10-20", code: "2330", name: "台積電", kind: "除息", cash: 4.5 }], conf: [] }));
  await ctx.route("**/api/yield**", r => { const cs = (new URL(r.request().url()).searchParams.get("codes") || "").split(","); J(r, { ok: true, rows: cs.map(c => ({ code: c, cash12: 5, n: 1, price: 100, yield: 5, divs: [["2025-07-10", 2.5], ["2026-01-10", 3]] })) }); });
  const axis = K.map(x => x.d).slice(-130);
  await ctx.route("**/api/allk**", r => { const s = new URL(r.request().url()).searchParams.get("s"), o = { d: axis, date: axis.at(-1), n: {}, m: {}, k: {} };
    for (let i = 0; i < 20; i++) { const c = s + String(100 + i * 7).padStart(3, "0"), cl = axis.map((_, j) => +(100 * (1 + Math.sin((j + i) / (6 + (i % 5))) * 0.1)).toFixed(2)); o.n[c] = "測試" + c; o.m[c] = 0; o.k[c] = [cl, cl.map(x => x * 1.01), cl.map(x => x * 0.99), cl, cl.map(() => 800)]; }
    J(r, o); });
  const mser = (id, name, group, unit, base) => ({ id, name, group, unit, how: "lvl", note: "說明", freq: "月", last: ["2026-09-01", base], prev: ["2026-08-01", base - 0.1], y1: ["2025-09-01", base - 0.5], data: Array.from({ length: 60 }, (_, i) => [`${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, +(base + Math.sin(i / 6)).toFixed(2)]) });
  await ctx.route(/\/(api\/macro|data\/macro\.json)/, r => J(r, { ok: true, at: "2026-10-15T00:00:00Z", source: "FRED", series: [{ ...mser("DEXJPUS", "美元兌日圓", "世界", "日圓", 150), dir: -1, impact: "日圓急升 → 套利交易平倉風險", up: "日圓貶值", down: "日圓急升 → 套利交易平倉風險" }, mser("CPIAUCSL", "CPI 年增率", "通膨", "%", 2.9), mser("T10Y2Y", "殖利率曲線", "利率", "百分點", 0.4), mser("UNRATE", "失業率", "就業", "%", 4.4), mser("ICSA", "初領失業金人數", "就業", "人", 230000)], signals: [{ k: "殖利率曲線", v: "0.40", lv: 0, t: "正常" }, { k: "薩姆規則", v: "0.32", lv: 1, t: "接近門檻" }], notes: [] }));
  await ctx.route("**/api/poly", r => J(r, { ok: true, at: "2026-10-15T00:00:00Z", source: "Polymarket", events: [{ id: "1", title: "Fed Decision in October?", url: "https://polymarket.com/event/x", cat: "聯準會與利率", vol: 4e7, vol24: 2e6, end: "2026-10-29", markets: [{ q: "25 bps", label: "25 bps decrease", yes: 0.82, d1: 0.03 }, { q: "No change", label: "No change", yes: 0.15, d1: -0.02 }] }, { id: "2", title: "China invades Taiwan in 2026?", url: "https://polymarket.com/event/y", cat: "台海與地緣政治", vol: 9e6, vol24: 1e5, end: "2026-12-31", markets: [{ q: "China invades Taiwan in 2026?", label: "", yes: 0.04, d1: 0 }] }] }));
  await ctx.route("**/api/global", r => J(r, { ok: true, source: "Yahoo", at: "2026-10-15T00:00:00Z", groups: [{ id: "energy", name: "能源", rows: [{ code: "CL=F", name: "西德州原油 WTI", price: 96.2, chg: 2.3, chgPct: 2.4, spark: [94, 95, 96] }] }, { id: "fx", name: "外匯", rows: [{ code: "TWD=X", name: "台幣", price: 31.2, chg: -0.1, chgPct: -0.3 }, { code: "DX-Y.NYB", name: "美元指數", price: 99, chg: 0.1, chgPct: 0.1 }] }] }));
  const KV = new Map();
  await ctx.route("**/api/sync**", r => { const q = r.request(); if (q.method() === "GET") return J(r, { ok: true, kv: true, tg: true, bot: "testbot" }); const b = JSON.parse(q.postData() || "{}");
    if (b.op === "push") { KV.set(b.id, { at: Date.now(), data: b.data }); return J(r, { ok: true, at: KV.get(b.id).at }); } if (b.op === "pull") return J(r, KV.has(b.id) ? { ok: true, ...KV.get(b.id) } : { ok: false, error: "無" }); J(r, { ok: true }); });
  await ctx.route("**/data/f13.json", r => J(r, { funds: [{ cik: "1", who: "測試機構", name: "TEST", period: "2026-06-30", filed: "2026-08-14", total: 1e9, n: 2, doc: "x", rows: [{ name: "NVIDIA", cusip: "2", ticker: "NVDA", value: 1e8, sh: 1e6, psh: 0, pct: 10, chg: "new" }], sold: [] }], notes: [] }));
  await ctx.route("**/data/insider.json", r => J(r, { rows: [{ d: "2026-09-01", code: "2330", name: "台積電", who: "董事", role: "董事本人", how: "一般交易", sh: 500000, hold: 2e6, market: "上市" }] }));
  await ctx.route("**/data/chipx.json", r => J(r, { date: "2026-10-13", lend: { "2330": [120, 5000] }, dt: { "2330": 25.5 }, pcr: [["2026-10-13", 88.76, 68.95]], notes: [] }));
  await ctx.route("**/data/tdcc/*.json", r => J(r, {}));
  await ctx.route("**/data/tw-officials.json", r => J(r, { updated: "2026-10-14T00:00:00Z", issues: [{ no: 321, date: "2026-09-22" }, { no: 300, date: "2026-03-20" }], decl: [
    { pid: "王小明", name: "王小明", org: "立法院", title: "立法委員", date: "2025-11-01", kind: "定期申報", issue: 300, stocks: [{ name: "台積電", code: "2330", owner: "王小明", sh: 1000 }, { name: "鴻海", code: "2317", owner: "配偶", sh: 2000 }] },
    { pid: "王小明", name: "王小明", org: "立法院", title: "立法委員", date: "2026-06-29", kind: "就到職申報", issue: 321, stocks: [{ name: "台積電", code: "2330", owner: "王小明", sh: 3000 }, { name: "廣達", code: "2382", owner: "王小明", sh: 1000 }] },
    { pid: "李大華", name: "李大華", org: "新北市政府", title: "局長", date: "2026-05-01", kind: "就到職申報", issue: 321, stocks: [{ name: "台積電", code: "2330", owner: "李大華", sh: 500 }, { name: "MeganHoldingsLtd", code: "", owner: "李大華", sh: 10, cur: "美元" }] }] }));
  return { KV };
}
// 開一個頁面，收集頁面錯誤
export async function open(browser, base, file, { width = 1180, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: touch, isMobile: touch }), errs = [];
  const m = await mock(ctx), p = await ctx.newPage(); p.on("pageerror", e => errs.push(`${width} ${e.message}`)); p.on("dialog", d => d.accept());
  await p.goto(`${base}/learner/${file}`); await p.waitForTimeout(600); return { ctx, p, errs, ...m };
}
