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
  await ctx.route("**/api/calendar**", r => J(r, { ok: true, rows: [{ date: "2026-10-20", code: "2330", name: "台積電", kind: "除息", cash: 4.5 }], conf: [] }));
  await ctx.route("**/api/yield**", r => { const cs = (new URL(r.request().url()).searchParams.get("codes") || "").split(","); J(r, { ok: true, rows: cs.map(c => ({ code: c, cash12: 5, n: 1, price: 100, yield: 5 })) }); });
  const axis = K.map(x => x.d).slice(-130);
  await ctx.route("**/api/allk**", r => { const s = new URL(r.request().url()).searchParams.get("s"), o = { d: axis, date: axis.at(-1), n: {}, m: {}, k: {} };
    for (let i = 0; i < 20; i++) { const c = s + String(100 + i * 7).padStart(3, "0"), cl = axis.map((_, j) => +(100 * (1 + Math.sin((j + i) / (6 + (i % 5))) * 0.1)).toFixed(2)); o.n[c] = "測試" + c; o.m[c] = 0; o.k[c] = [cl, cl.map(x => x * 1.01), cl.map(x => x * 0.99), cl, cl.map(() => 800)]; }
    J(r, o); });
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
  await p.goto(`${base}/learner/${file}`); await p.waitForTimeout(1200); return { ctx, p, errs, ...m };
}
