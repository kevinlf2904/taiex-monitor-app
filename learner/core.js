"use strict";
/* K線學堂共用核心：工具函式、技術指標、指標開關、副圖訊號與 K 線圖（Chart）。
   learner/index.html（K線學堂）與 learner/watch.html（看盤）共用；一般 <script> 載入，定義在全域。 */
/* ================= 工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("kline:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kline:" + k, JSON.stringify(v)); } catch {} },
};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 台股升降單位（檔位）
function tickOf(p) { return p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5; }
function roundTick(p) { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2); }
// 漲跌停價：昨收 ×1.1（×0.9）再往內取到升降單位（ETF 的升降單位不同）；和 api/_lib/market.js 的 limits 同一套
function twLimits(prev, etf = false) { const t = p => (etf ? (p < 50 ? 0.01 : 0.05) : tickOf(p)), u = prev * 1.1, d = prev * 0.9; return [+(Math.floor(u / t(u) + 1e-9) * t(u)).toFixed(2), +(Math.ceil(d / t(d) - 1e-9) * t(d)).toFixed(2)]; }
function fmtP(p) { if (p == null) return "—"; const t = tickOf(p); return p.toFixed(t < 0.1 ? 2 : t < 1 ? 1 : 0); }
function fmtPct(x, d = 2) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%"; }
function fmtN(x, d = 1) { return x == null ? "—" : x.toFixed(d); }
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 台股交易時段（台北時間週一到週五：08:30–09:00 試撮 pre、09:00–13:35 盤中 open、其餘 closed）；證交所公布的平日休市日也是 closed
function mktSession(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600e3), day = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (day === 0 || day === 6 || twDayState(now) === "closed") return "closed";
  return m >= 510 && m < 540 ? "pre" : m >= 540 && m <= 815 ? "open" : "closed";
}
/* ---------- 今天有沒有開盤：證交所休市日表（/api/calendar?hol=1）＋報價佐證 ----------
   "trade" 確定開盤、"closed" 確定休市（週末、休市日表、報價佐證）、"unknown" 還不知道（剛打開、表抓不到或過期）。
   不知道的時候 mktSession 照舊只看時間（回傳格式不變），由呼叫的地方決定要不要降頻（看盤頁改成 30 秒一次，不跑每秒的報價）。
   休市日表也列了「開始交易日」「最後交易日」這種有開盤的日子，要排除（和 api/_lib/calendar.js 的 closedHol 同一條規則）。 */
const TWHOL = { set: null, year: "", at: 0, failAt: 0, p: null, mark: null };
const twIso = (now = new Date()) => new Date(+now + 8 * 3600e3).toISOString().slice(0, 10);
function twHolSet(hol, now = new Date()) {
  const year = twIso(now).slice(0, 4), L = Array.isArray(hol) ? hol : [];
  if (!L.some(x => String(x?.date || "").startsWith(year))) return false; // 表裡沒有今年的日期：當成沒拿到，不是「今年沒有假日」
  Object.assign(TWHOL, { set: new Set(L.filter(x => x?.date && !/開始交易|最後交易/.test(`${x.name || ""}${x.note || ""}`)).map(x => x.date)), year, at: +now }); return true;
}
// 報價佐證：加權指數的報價日期是今天＝有開盤；開盤後一段時間還停在前一天（颱風假這類臨時休市）＝沒開盤。只記今天這一筆
const twDayMark = (iso, st) => { TWHOL.mark = { d: iso, st }; };
function twDayState(now = new Date()) {
  const iso = twIso(now), wd = new Date(iso + "T00:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return "closed";
  if (TWHOL.set && iso.startsWith(TWHOL.year) && TWHOL.set.has(iso)) return "closed";
  if (TWHOL.mark?.d === iso) return TWHOL.mark.st;
  return TWHOL.set && iso.startsWith(TWHOL.year) ? "trade" : "unknown";
}
// 載入休市日表：剛打開、過了 12 小時、換日時重抓；失敗 10 分鐘後再試。回傳 true＝這次有新拿到（呼叫的地方可以重排更新頻率）
function twHolEnsure(now = Date.now()) {
  if (!/^https?:$/.test(location.protocol) || TWHOL.p || now - TWHOL.failAt < 600e3) return Promise.resolve(false);
  if (TWHOL.set && now - TWHOL.at < 12 * 3600e3 && twIso(new Date(now)).startsWith(TWHOL.year)) return Promise.resolve(false);
  return (TWHOL.p = fetch("/api/calendar?hol=1", { signal: AbortSignal.timeout?.(12000) }).then(r => r.json()).then(j => { if (!(j?.holOk && twHolSet(j.hol))) { TWHOL.failAt = Date.now(); return false; } return true; })
    .catch(() => { TWHOL.failAt = Date.now(); return false; }).finally(() => { TWHOL.p = null; }));
}
// 品牌（KLineLab K線情報局）：1:1 幾何 K 線圖標（空心 K 棒＋影線、上下都削 45 度的鈦金屬灰光束，兩者同寬對稱，合起來像字母 K）＋Space Grotesk 字標＋PRO 徽章
const BRAND = { name: "KLineLab", zh: "K線情報局", tag: "將複雜的台美股機構籌碼與供應鏈資金，化為一目了然突破訊號的量化研究終端機" };
const brandIcon = (s = 32) => `<svg class="bl-ic" viewBox="0 0 512 512" width="${s}" height="${s}" aria-hidden="true"><defs><linearGradient id="blkc" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="416"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e4e4e7"/><stop offset="1" stop-color="#a1a1aa"/></linearGradient><linearGradient id="blti" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#71717a"/><stop offset=".5" stop-color="#a1a1aa"/><stop offset="1" stop-color="#f4f4f5"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#09090b"/><rect x="4" y="4" width="504" height="504" rx="108" fill="none" stroke="#27272a" stroke-width="8"/><path d="M180 100v68M180 344v68" stroke="url(#blkc)" stroke-width="20" stroke-linecap="round"/><rect x="146" y="178" width="68" height="156" rx="8" fill="none" stroke="url(#blkc)" stroke-width="20"/><path d="M288 188 376 100v312l-88-88z" fill="url(#blti)"/></svg>`;
const brandHtml = ({ pro = true, zh = true, href = "" } = {}) => `<${href ? `a href="${href}"` : "span"} class="bl">${brandIcon()}<span class="bl-t"><b>${BRAND.name}</b>${zh ? `<small>${BRAND.zh}</small>` : ""}</span>${pro ? `<span class="bl-pro" title="公開測試版 (Beta)">Beta</span>` : ""}</${href ? "a" : "span"}>`;
// SVG 縮寫徽章：取名稱前兩個字（英文取字首），單色（底色、字色跟著主題，在 core.css 的 .badge）；不用外部照片或節目封面
function badgeSvg(name, s = 40) {
  const n = String(name || "?").trim(), w = n.split(/[\s\-_.]+/).filter(Boolean), ab = /^[A-Za-z]/.test(n) ? (w.length > 1 ? w[0][0] + w[1][0] : n.slice(0, 2)).toUpperCase() : [...n.replace(/\s/g, "")].slice(0, 2).join("");
  const t = esc(ab);
  return `<svg class="badge" viewBox="0 0 40 40" width="${s}" height="${s}" aria-hidden="true"><rect class="bg" x=".5" y=".5" width="39" height="39" rx="6" fill="#27272a" stroke="rgba(255,255,255,.12)"/><text x="20" y="25.5" text-anchor="middle" font-size="${/^[A-Z]/.test(t) ? 14 : 13}" font-family="Space Grotesk, Inter, Noto Sans TC, sans-serif" font-weight="500" fill="#d4d4d8">${t}</text></svg>`;
}
// 單色線條圖示（取代彩色 emoji，跟著文字顏色）：ico("bell") 等
const ICO_P = { ai: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', case: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5h6v2M3.5 12.5h17"/>', cam: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>', wave: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>', ear: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>', pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 16V5a1 1 0 0 1 1-1h9"/>', chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>', phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>', book: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>', coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>', share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>' };
const ico = n => `<svg class="ico" width="1.05em" height="1.05em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.16em;margin-right:.32em" aria-hidden="true">${ICO_P[n] || ""}</svg>`;
// 全站免責聲明（頁尾與每個回測、籌碼分析頁的底部）
const DISCLAIMER = "本平台提供之所有數據、K線型態辨識、機構與內部人申報彙整及歷史回測模擬，均基於政府公開資訊與客觀統計模型自動計算，僅供投資研究與數據視覺化參考，不構成任何證券投資顧問或個股買賣建議。";
// 資料來源與授權（頁尾）、意見回報（節目主要求移除、資料錯誤）、站名網址（分享圖卡用；換網域只改這裡）
const DATA_NOTE = "部分盤後公開數據取自政府資料開放平臺（依政府資料開放授權條款第1版使用）與公開申報資訊；盤中報價取自交易所公開行情與第三方行情服務，可能延遲。僅供個人研究學習。";
// 社群入口（頂部「加入盤後情報」）：帳號開好後把網址填進來就會出現；沒填就整個藏起來
const SOCIAL = { telegram: "", threads: "" };
const CONTACT_URL = "https://github.com/kevinlf2904/taiex-monitor-app/issues";
// 除錯工具（資料來源狀態、金鑰檢查）只在網址帶 ?debug=1 或本機開發時顯示
const DEBUG = typeof location !== "undefined" && (/[?&]debug=1\b/.test(location.search) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
if (DEBUG && typeof document !== "undefined") document.documentElement.dataset.debug = "1";
const fillDataNote = () => document.querySelectorAll(".data-note").forEach(e => (e.textContent = DATA_NOTE));
if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillDataNote); else fillDataNote(); }
// 全站線條變細：canvas 畫的每一條線（K 棒影線、均線、指標、分時、格線）粗細 × 0.72，最細 0.5px（高解析度螢幕上是 1 個實體像素）
(() => { try { const P = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(P, "lineWidth"); if (!d?.set || P.__thin) return; P.__thin = true;
  Object.defineProperty(P, "lineWidth", { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v > 0 ? Math.max(0.5, v * 0.72) : v); } }); } catch {} })();
// 日 K 合成週 K、月 K：key(日期) 相同的併成一根，日期標示該週（月）最後一個交易日
function agg(D, key) {
  const out = [];
  for (const x of D) { const k = key(x.d), L = out[out.length - 1]; if (L && L.k === k) { L.h = Math.max(L.h, x.h); L.l = Math.min(L.l, x.l); L.c = x.c; L.v += x.v || 0; L.d = x.d; } else out.push({ k, d: x.d, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 }); }
  return out;
}
const weekKey = d => { const t = new Date(String(d).slice(0, 10) + "T00:00:00Z"), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); };
// 問網站的 AI（/api/chat）：context 是畫面上的資料、q 是問題；回傳文字，失敗丟出錯誤（各頁的「問 AI」都用這個）
// 連線逾時：網路卡住時 fetch 不會自己結束，按鈕會一直停在「載入中」（舊版 Safari 沒有 AbortSignal.timeout）
const tmo = ms => { try { return AbortSignal.timeout(ms); } catch { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } };
async function aiChat(context, q) {
  const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, messages: [{ role: "user", content: q }] }), signal: tmo(65000) }).catch(e => { throw new Error(e.name === "TimeoutError" || e.name === "AbortError" ? "AI 回答太久，請再試一次" : "連不上 AI 服務"); });
  const k = await r.json().catch(() => null); if (!k?.ok) throw new Error(k?.error || (r.status === 404 ? "需要部署到網站才能使用" : `AI 沒有回答（${r.status}）`)); return k.text;
}
// CSS 變數讀取會觸發樣式計算，K 線每一格要讀幾十次（手機滑動時很明顯）：快取起來，主題、配色、字型改變（html 的屬性變動）時清掉
const CSSV = new Map(); let cssvAt = 0;
function cssVar(n) { const now = performance.now(); if (now - cssvAt > 1500) { CSSV.clear(); cssvAt = now; } let v = CSSV.get(n); if (v === undefined) { v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); CSSV.set(n, v); } return v; }
try { new MutationObserver(() => CSSV.clear()).observe(document.documentElement, { attributes: true }); } catch {}

/* ================= 指標 ================= */
function sma(a, n) { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(a, n) { const o = Array(a.length).fill(null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? a[i] : a[i] * k + e * (1 - k); o[i] = e; } return o; }
function rsiCalc(c, n = 14) {
  const o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); }
  }
  return o;
}
function kdCalc(D, n = 9, ks = 3, ds = 3) {
  const K = Array(D.length).fill(null), Dd = Array(D.length).fill(null); let k = 50, d = 50;
  for (let i = n - 1; i < D.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, D[j].h); ll = Math.min(ll, D[j].l); }
    const rsv = hh === ll ? 50 : (D[i].c - ll) / (hh - ll) * 100;
    k = k * (ks - 1) / ks + rsv / ks; d = d * (ds - 1) / ds + k / ds; K[i] = k; Dd[i] = d;
  }
  return { K, D: Dd };
}
function macdCalc(c, f = 12, sl = 26, g = 9) {
  const e12 = ema(c, f), e26 = ema(c, sl), w = Math.max(f, sl) - 1;
  const dif = c.map((_, i) => i < w ? null : e12[i] - e26[i]);
  const sig = ema(dif, g).map((v, i) => i < w + g - 1 ? null : v);
  const osc = dif.map((v, i) => sig[i] == null ? null : v - sig[i]);
  return { dif, sig, osc };
}
function bollCalc(c, n = 20, k = 2) {
  const mid = sma(c, n), up = [], lo = [], bw = [];
  for (let i = 0; i < c.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); bw.push(null); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); bw.push(2 * k * sd / mid[i]);
  }
  return { mid, up, lo, bw };
}
// 威廉指標 %R：收盤距離 n 日最高價的位置，0 到 −100
function wrCalc(D, n = 14) {
  const o = Array(D.length).fill(null);
  for (let i = n - 1; i < D.length; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, D[j].h); ll = Math.min(ll, D[j].l); } o[i] = hh === ll ? -50 : (hh - D[i].c) / (hh - ll) * -100; }
  return o;
}
// VWAP（成交量加權平均價）：典型價 (高+低+收)/3 依成交量加權。
// 分 K（日期欄有時間）每天開盤重新累計，就是當日均價線；日／週／月 K 用最近 20 根滾動計算（20 期 VWAP）。
function vwapCalc(D, n = 20) {
  const o = Array(D.length).fill(null), intraday = D.length && /\s\d{1,2}:\d{2}/.test(D[0].d);
  if (intraday) { let day = null, pv = 0, v = 0; D.forEach((x, i) => { const d = x.d.split(" ")[0]; if (d !== day) { day = d; pv = 0; v = 0; } const tp = (x.h + x.l + x.c) / 3, w = x.v || 0; pv += tp * w; v += w; o[i] = v ? pv / v : tp; }); return o; }
  for (let i = n - 1; i < D.length; i++) { let pv = 0, v = 0; for (let j = i - n + 1; j <= i; j++) { const w = D[j].v || 0; pv += (D[j].h + D[j].l + D[j].c) / 3 * w; v += w; } o[i] = v ? pv / v : null; }
  return o;
}
// 籌碼分佈（成本分佈／Volume Profile）：把 [a, b] 每根 K 棒的成交量依典型價附近分到各價位，越早的權重越低（每天衰減 3%）。
// 回傳各價位的量、目前價、獲利比例、平均成本、支撐（目前價以下量最多的價位）、壓力（以上量最多的價位）、70%／90% 籌碼區間。
function costDist(D, b = D.length - 1, n = 120, bins = 60, decay = 0.97) {
  const a = Math.max(0, b - n + 1), L = D.slice(a, b + 1); if (L.length < 10) return null;
  const lo = Math.min(...L.map(x => x.l)), hi = Math.max(...L.map(x => x.h)); if (!(hi > lo)) return null;
  const step = (hi - lo) / bins, w = Array(bins).fill(0), mids = w.map((_, k) => lo + (k + 0.5) * step);
  L.forEach((x, i) => {
    const wt = (x.v || 1) * Math.pow(decay, L.length - 1 - i), ka = Math.max(0, Math.floor((x.l - lo) / step)), kb = Math.min(bins - 1, Math.floor((x.h - lo) / step)), tp = (x.h + x.l + x.c) / 3, half = (x.h - x.l) / 2 || step;
    const fs = []; for (let k = ka; k <= kb; k++) fs.push(1 / (1 + Math.abs(mids[k] - tp) / half)); const tot = fs.reduce((s, f) => s + f, 0) || 1;
    fs.forEach((f, j) => (w[ka + j] += wt * f / tot));
  });
  const px = D[b].c, total = w.reduce((s, x) => s + x, 0) || 1;
  let sup = -1, pre = -1; w.forEach((x, k) => { if (mids[k] <= px) { if (sup < 0 || x > w[sup]) sup = k; } else if (pre < 0 || x > w[pre]) pre = k; });
  // 以平均成本為中心向兩側擴張，直到涵蓋 p 的籌碼
  const avg = w.reduce((s, x, k) => s + x * mids[k], 0) / total;
  const range = p => { let i = Math.max(0, Math.min(bins - 1, Math.floor((avg - lo) / step))), j = i, acc = w[i]; while (acc / total < p && (i > 0 || j < bins - 1)) { if (j >= bins - 1 || (i > 0 && w[i - 1] >= w[j + 1])) acc += w[--i]; else acc += w[++j]; } return [mids[i] - step / 2, mids[j] + step / 2]; };
  const r90 = range(0.9), r70 = range(0.7);
  return { w, mids, step, lo, hi, px, d: D[b].d, profit: w.reduce((s, x, k) => s + (mids[k] <= px ? x : 0), 0) / total, avg, sup: sup >= 0 ? mids[sup] : null, pre: pre >= 0 ? mids[pre] : null, r90, r70, overlap: (r70[1] - r70[0]) / ((r90[1] - r90[0]) || 1) };
}
function indicators(D) {
  const c = D.map(x => x.c), cache = {};
  return {
    c,
    ma: n => cache[n] || (cache[n] = sma(c, n)),
    vma: sma(D.map(x => x.v || 0), 20), // 沒有量的 K 棒算 0，不然之後的均量都變成 NaN
    rsi: rsiCalc(c), kd: kdCalc(D), macd: macdCalc(c), boll: bollCalc(c), wr: wrCalc(D),
    get vwap() { return cache.vwap || (cache.vwap = vwapCalc(D)); },
    ...(() => { if (D[0].ov == null) return { io: null, io5: null }; const io = D.map(x => { const t = x.iv != null ? x.ov + x.iv : x.v; return t ? x.ov / t * 100 : 50; }); /* 外盤比＝外盤 ÷（外盤＋內盤），無法歸類的量不算進分母 */ return { io, io5: sma(io, 5) }; })(),
  };
}


/* ---------- 更多副圖指標（MTM、DMI、PSY、AR／BR、OBV、VR、騰落指標、TAPI） ----------
   每個指標都算成一個「自訂副圖」（{ custom: { title, lines, names, levels… } }），K 線圖照一般副圖畫；
   sigs 是這個指標自己的買賣訊號（例如 PSY 脫離 25／75），會和 KD、MACD 一樣標回主圖（「對應」功能）。
   大盤寬度指標（ADR、OBOS、ADL）要每天的上漲、下跌家數（D[i].adv、D[i].dec），只有加權／櫃買指數才有。 */
// MTM 動量：今天收盤減 n 天前收盤；MA 是 MTM 的 m 日平均
function mtmCalc(c, n = 10, m = 10) { const v = c.map((x, i) => (i >= n ? x - c[i - n] : null)); return { mtm: v, ma: smaN(v, m) }; }
// 有空值的平均（前面還沒有值的部分跳過）
function smaN(a, n) { const o = Array(a.length).fill(null); let s = 0, k = 0, q = []; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) continue; q.push(v); s += v; if (q.length > n) s -= q.shift(); if (q.length === n) o[i] = s / n; } return o; }
// DMI 趨向指標（Wilder，14 日）：+DI、−DI 比較上漲與下跌的力道，ADX 看趨勢強不強（不分方向）
function dmiCalc(D, n = 14) {
  const N = D.length, pdi = Array(N).fill(null), mdi = Array(N).fill(null), adx = Array(N).fill(null);
  let tr = 0, pd = 0, md = 0, dxs = [], ax = null;
  for (let i = 1; i < N; i++) {
    const a = D[i], b = D[i - 1], up = a.h - b.h, dn = b.l - a.l, p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0, t = Math.max(a.h - a.l, Math.abs(a.h - b.c), Math.abs(a.l - b.c));
    if (i <= n) { tr += t; pd += p; md += m; } else { tr = tr - tr / n + t; pd = pd - pd / n + p; md = md - md / n + m; }
    if (i < n || !tr) continue;
    pdi[i] = (100 * pd) / tr; mdi[i] = (100 * md) / tr;
    const dx = pdi[i] + mdi[i] ? (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i]) : 0;
    if (ax == null) { dxs.push(dx); if (dxs.length === n) ax = dxs.reduce((x, y) => x + y, 0) / n; } else ax = (ax * (n - 1) + dx) / n;
    if (ax != null) adx[i] = ax;
  }
  return { pdi, mdi, adx };
}
// PSY 心理線：最近 n 天裡收漲的天數比例（%）
function psyCalc(c, n = 12) { return c.map((_, i) => { if (i < n) return null; let u = 0; for (let k = i - n + 1; k <= i; k++) if (c[k] > c[k - 1]) u++; return (u / n) * 100; }); }
// AR 人氣指標：n 日（最高−開盤）合計 ÷（開盤−最低）合計 × 100；BR 買賣意願：n 日（最高−昨收）合計 ÷（昨收−最低）合計 × 100（負的算 0）
function arbrCalc(D, n = 26) {
  const N = D.length, ar = Array(N).fill(null), br = Array(N).fill(null);
  for (let i = n; i < N; i++) { let a = 0, b = 0, c = 0, d = 0; for (let k = i - n + 1; k <= i; k++) { const x = D[k], pc = D[k - 1].c; a += x.h - x.o; b += x.o - x.l; c += Math.max(0, x.h - pc); d += Math.max(0, pc - x.l); } ar[i] = b ? (a / b) * 100 : null; br[i] = d ? (c / d) * 100 : null; }
  return { ar, br };
}
// OBV 能量潮：收漲加上當天成交量、收跌減掉，累計起來
function obvCalc(D) { let s = 0; return D.map((x, i) => (i ? (s += x.c > D[i - 1].c ? x.v || 0 : x.c < D[i - 1].c ? -(x.v || 0) : 0) : (s = 0))); }
// VR 成交量比率：n 日內（上漲日的量＋平盤日量的一半）÷（下跌日的量＋平盤日量的一半）× 100
function vrCalc(D, n = 26) {
  return D.map((_, i) => { if (i < n) return null; let u = 0, d = 0, f = 0; for (let k = i - n + 1; k <= i; k++) { const v = D[k].v || 0; if (D[k].c > D[k - 1].c) u += v; else if (D[k].c < D[k - 1].c) d += v; else f += v; } return d + f / 2 ? ((u + f / 2) / (d + f / 2)) * 100 : null; });
}
// 大盤寬度：ADR 漲跌比（n 日上漲家數合計 ÷ 下跌家數合計）、OBOS 超買超賣（n 日（上漲−下跌）家數合計）、ADL 騰落線（每天上漲−下跌家數一路累計）
function breadthCalc(D, n = 10) {
  const N = D.length, adr = Array(N).fill(null), obos = Array(N).fill(null), adl = Array(N).fill(null); let cum = 0, any = false;
  for (let i = 0; i < N; i++) {
    const x = D[i]; if (x.adv == null || x.dec == null) continue; any = true; cum += x.adv - x.dec; /* 缺資料的日子跳過，累計不歸零 */ adl[i] = cum;
    let a = 0, d = 0, ok = i >= n - 1; for (let k = i - n + 1; ok && k <= i; k++) { if (D[k].adv == null) { ok = false; break; } a += D[k].adv; d += D[k].dec; }
    if (ok) { adr[i] = d ? a / d : null; obos[i] = a - d; }
  }
  return any ? { adr, obos, adl } : null;
}
// TAPI 每一點指數的成交值：大盤成交值（億元）÷ 加權指數
function tapiCalc(D) { return D.map(x => (x.v && x.c ? x.v / x.c : null)); }
// 一條線穿越門檻（脫離超買超賣）、兩條線交叉 → 訊號
function lvlSigs(a, lo, hi, name, n = a.length) { const o = []; for (let i = 1; i < n; i++) { if (a[i] == null || a[i - 1] == null) continue; if (lo != null && a[i - 1] < lo && a[i] >= lo) o.push({ i, side: "buy", label: `${name}回升 ${lo}`, v: a[i] }); else if (hi != null && a[i - 1] > hi && a[i] <= hi) o.push({ i, side: "sell", label: `${name}跌破 ${hi}`, v: a[i] }); } return o; }
function crossSigs(a, b, up, dn, keep = () => true) { const o = []; for (let i = 1; i < a.length; i++) { if ([a[i], b[i], a[i - 1], b[i - 1]].some(v => v == null)) continue; if (a[i - 1] <= b[i - 1] && a[i] > b[i] && keep("buy", i)) o.push({ i, side: "buy", label: up, v: a[i] }); else if (a[i - 1] >= b[i - 1] && a[i] < b[i] && keep("sell", i)) o.push({ i, side: "sell", label: dn, v: a[i] }); } return o; }
// 交叉要維持 hold 天才算（在確認那天標出來，不偷看之後的資料），減少來回穿越的雜訊
function crossHold(a, b, hold, up, dn) {
  const o = []; let st = 0, run = 0, cur = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] == null || b[i] == null) continue; const sg = Math.sign(a[i] - b[i]) || cur; run = sg === cur ? run + 1 : 1; cur = sg;
    if (!st) { if (run >= hold) st = sg; continue; }
    if (run === hold && sg !== st) { st = sg; o.push({ i, side: sg > 0 ? "buy" : "sell", label: sg > 0 ? up : dn, v: a[i] }); } }
  return o;
}
const fmtBig = v => (v == null ? "—" : Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + "億" : Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(1) + "萬" : fmtN(v));
// id → { label（指標列上的名字）, kind（訊號種類）, params（可自訂的參數：[key, 名稱, 最小, 最大, 間距, 預設]）, extra（「新增線」：同一副圖再畫一條別的週期）, make(D, I, p) → custom 副圖 }
const pct2 = v => (v == null ? "—" : v.toFixed(2) + "%");
const SUBX = {
  mtm: { label: "MTM", kind: "mtm", params: [["n", "週期", 2, 60, 1, 10], ["m", "均線", 2, 60, 1, 10]], extra: (D, I, n) => mtmCalc(I.c, n).mtm,
    make: (D, I, p) => { const { mtm, ma } = mtmCalc(I.c, p.n, p.m); return { title: `MTM ${p.n}・MA ${p.m}`, lines: [mtm, ma], names: ["MTM", "MA"], levels: [0], sigs: crossHold(mtm, mtm.map(v => (v == null ? null : 0)), 3, "MTM轉正", "MTM轉負") }; } },
  dmi: { label: "DMI", kind: "dmi", params: [["n", "週期", 5, 40, 1, 14]],
    make: (D, I, p) => { const { pdi, mdi, adx } = dmiCalc(D, p.n); return { title: `DMI ${p.n}`, lines: [pdi, mdi, adx], names: ["+DI", "−DI", "ADX"], levels: [20, 40], sigs: crossSigs(pdi, mdi, "+DI上穿−DI", "+DI跌破−DI", (s, i) => (adx[i] ?? 0) >= 20) }; } },
  psy: { label: "PSY", kind: "psy", params: [["n", "週期", 3, 40, 1, 12], ["m", "均線", 2, 30, 1, 6]], extra: (D, I, n) => psyCalc(I.c, n),
    make: (D, I, p) => { const v = psyCalc(I.c, p.n); return { title: `PSY ${p.n}・MA ${p.m}`, lines: [v, smaN(v, p.m)], names: ["PSY", "MA"], levels: [25, 75], range: [0, 100], sigs: lvlSigs(v, 25, 75, "PSY") }; } },
  arbr: { label: "AR／BR", kind: "arbr", params: [["n", "週期", 5, 60, 1, 26]],
    make: (D, I, p) => { const { ar, br } = arbrCalc(D, p.n); return { title: `AR・BR ${p.n}`, lines: [ar, br], names: ["AR", "BR"], levels: [50, 100, 150], sigs: lvlSigs(ar, 60, 150, "AR") }; } },
  obv: { label: "OBV", kind: "obv", params: [["m", "均線", 2, 120, 1, 20]],
    make: (D, I, p) => { const o = obvCalc(D), m = smaN(o, p.m); return { title: `OBV・MA ${p.m}`, lines: [o, m], names: ["OBV", "MA" + p.m], fmt: fmtBig, sigs: crossHold(o, m, 3, "OBV站上均線", "OBV跌破均線") }; } },
  vr: { label: "VR", kind: "vr", params: [["n", "週期", 5, 60, 1, 26], ["m", "均線", 2, 30, 1, 6]],
    make: (D, I, p) => { const v = vrCalc(D, p.n); return { title: `VR ${p.n}`, lines: [v, smaN(v, p.m)], names: ["VR", "MA"], levels: [70, 150, 450], sigs: lvlSigs(v, 70, 450, "VR") }; } },
  adr: { label: "ADR", kind: "adr", breadth: true, make: D => { const B = breadthCalc(D); if (!B) return null; return { title: "ADR 漲跌比 10", lines: [B.adr, smaN(B.adr, 6)], names: ["ADR", "MA"], levels: [0.5, 1, 1.5], sigs: lvlSigs(B.adr, 0.5, 1.5, "ADR") }; } },
  obos: { label: "OBOS", kind: "obos", breadth: true, make: D => { const B = breadthCalc(D); if (!B) return null; return { title: "OBOS 超買超賣 10", lines: [B.obos, smaN(B.obos, 6)], names: ["OBOS", "MA"], levels: [0], sigs: crossHold(B.obos, B.obos.map(v => (v == null ? null : 0)), 5, "OBOS轉正", "OBOS轉負") }; } },
  adl: { label: "ADL", kind: "adl", breadth: true, make: D => { const B = breadthCalc(D); if (!B) return null; const m = smaN(B.adl, 10); return { title: "ADL 騰落線・MA 10", lines: [B.adl, m], names: ["ADL", "MA10"], sigs: crossHold(B.adl, m, 5, "ADL站上均線", "ADL跌破均線") }; } },
  bias: { label: "乖離率", kind: "bias", params: [["a", "第一條", 2, 120, 1, 6], ["b", "第二條", 2, 120, 1, 12], ["c", "第三條", 2, 240, 1, 24]], extra: (D, I, n) => biasCalc(I.c, n),
    make: (D, I, p) => { const b1 = biasCalc(I.c, p.a); return { title: `乖離率 BIAS ${p.a}・${p.b}・${p.c}（%）`, lines: [b1, biasCalc(I.c, p.b), biasCalc(I.c, p.c)], names: ["BIAS" + p.a, "BIAS" + p.b, "BIAS" + p.c], levels: [0], fmt: pct2, sigs: lvlSigs(b1, -5, 5, "BIAS" + p.a) }; } },
  atr: { label: "ATR", kind: "atr", params: [["n", "週期", 2, 60, 1, 14]], extra: (D, I, n) => atrCalc(D, n),
    make: (D, I, p) => { const a = atrCalc(D, p.n); return { title: `ATR ${p.n}（平均真實波幅）`, lines: [a], names: ["ATR"], lines2: [a.map((v, i) => (v == null ? null : (v / D[i].c) * 100))], names2: ["ATR%"], fmt: v => fmtN(v, 2), signals: false, sigs: [] }; } },
  cci: { label: "CCI", kind: "cci", params: [["n", "週期", 5, 60, 1, 20]], extra: (D, I, n) => cciCalc(D, n),
    make: (D, I, p) => { const c = cciCalc(D, p.n); return { title: `CCI ${p.n}`, lines: [c], names: ["CCI"], levels: [100, 0, -100], sigs: lvlSigs(c, -100, 100, "CCI") }; } },
  mfi: { label: "MFI", kind: "mfi", params: [["n", "週期", 3, 40, 1, 14]], extra: (D, I, n) => mfiCalc(D, n),
    make: (D, I, p) => { const m = mfiCalc(D, p.n); return { title: `MFI ${p.n}（資金流量）`, lines: [m], names: ["MFI"], levels: [80, 20], range: [0, 100], dull: [80, 20], sigs: lvlSigs(m, 20, 80, "MFI") }; } },
  trix: { label: "TRIX", kind: "trix", params: [["n", "週期", 3, 40, 1, 12], ["m", "訊號線", 2, 30, 1, 9]],
    make: (D, I, p) => { const t = trixCalc(I.c, p.n), m = smaN(t, p.m); return { title: `TRIX ${p.n}・訊號 ${p.m}`, lines: [t, m], names: ["TRIX", "MA" + p.m], levels: [0], fmt: v => (v == null ? "—" : v.toFixed(3)), sigs: crossHold(t, m, 2, "TRIX上穿訊號線", "TRIX跌破訊號線") }; } },
  srsi: { label: "StochRSI", kind: "srsi", params: [["n", "RSI 週期", 3, 40, 1, 14], ["m", "區間", 3, 40, 1, 14], ["k", "K 平滑", 1, 10, 1, 3], ["d", "D 平滑", 1, 10, 1, 3]],
    make: (D, I, p) => { const { K, D: d } = srsiCalc(I.c, p.n, p.m, p.k, p.d); return { title: `StochRSI ${p.n}・${p.m}・${p.k}・${p.d}`, lines: [K, d], names: ["K", "D"], levels: [80, 20], range: [0, 100], sigs: crossSigs(K, d, "StochRSI低檔金叉", "StochRSI高檔死叉", (s, i) => (s === "buy" ? d[i] < 20 : d[i] > 80)) }; } },
  roc: { label: "ROC", kind: "roc", params: [["n", "週期", 2, 120, 1, 12], ["m", "均線", 2, 30, 1, 6]], extra: (D, I, n) => rocCalc(I.c, n),
    make: (D, I, p) => { const r = rocCalc(I.c, p.n), m = smaN(r, p.m); return { title: `ROC ${p.n}・MA ${p.m}（%）`, lines: [r, m], names: ["ROC", "MA" + p.m], levels: [0], fmt: pct2, sigs: crossHold(r, r.map(v => (v == null ? null : 0)), 2, "ROC轉正", "ROC轉負") }; } },
  dma: { label: "DMA", kind: "dma", params: [["s", "短均線", 2, 60, 1, 10], ["l", "長均線", 5, 240, 1, 50], ["m", "AMA", 2, 60, 1, 10]],
    make: (D, I, p) => { const { dif, ama } = dmaCalc(I.c, p.s, Math.max(p.l, p.s + 1), p.m); return { title: `DMA ${p.s}・${p.l}・${p.m}（平行線差）`, lines: [dif, ama], names: ["DIF", "AMA"], levels: [0], sigs: crossHold(dif, ama, 2, "DMA上穿AMA", "DMA跌破AMA") }; } },
  emv: { label: "EMV", kind: "emv", params: [["n", "週期", 3, 60, 1, 14], ["m", "均線", 2, 30, 1, 9]],
    make: (D, I, p) => { const { emv, ma } = emvCalc(D, p.n, p.m); return { title: `EMV ${p.n}・MA ${p.m}（簡易波動）`, lines: [emv, ma], names: ["EMV", "MA" + p.m], levels: [0], fmt: v => (v == null ? "—" : v.toFixed(3)), sigs: crossHold(emv, emv.map(v => (v == null ? null : 0)), 2, "EMV轉正", "EMV轉負") }; } },
  tower: { label: "寶塔線", kind: "tower", params: [["k", "翻色要突破幾座塔", 2, 5, 1, 3]],
    make: (D, I, p) => { const { boxes, state } = towerCalc(D, p.k); return { title: `寶塔線（${p.k} 線翻轉）`, lines: [], names: [], boxes, tower: state, fmt: fmtP, sigs: boxes.map((x, i) => (x && x.flip ? { i, side: x.up ? "buy" : "sell", label: x.up ? "寶塔翻紅" : "寶塔翻綠", v: x.up ? x.t : x.b } : null)).filter(Boolean) }; } },
  tapi: { label: "TAPI", kind: "tapi", index: true, params: [["m", "均線", 2, 60, 1, 10]],
    make: (D, I, p) => { const t = tapiCalc(D), m = smaN(t, p.m); return { title: `TAPI 每點成交值（億元）・MA ${p.m}`, lines: [t, m], names: ["TAPI", "MA" + p.m], fmt: v => (v == null ? "—" : v.toFixed(3)), sigs: [] }; } },
};
// 字串副圖 → 自訂副圖（同一組資料、同一組參數只算一次）；做不出來（例如個股沒有漲跌家數）時給一個只有標題的空副圖
// 參數、「新增線」來自使用者的線型設定（indCfg，教學圖用 noCfg 時一律用預設）
function subxMake(id, D, I, cfgOn = true) {
  const X = SUBX[id]; if (!X) return null; const p = indParams(id, cfgOn), ex = cfgOn ? indExtras(id) : [], key = id + "|" + JSON.stringify(p) + "|" + ex.map(e => e.n).join(",");
  const memo = (I && Object.prototype.hasOwnProperty.call(I, "_subx") ? I._subx : I ? (I._subx = {}) : {}); if (memo[key] !== undefined) return memo[key];
  let C = null; if (!(X.index && !D.isIndex)) try { C = X.make(D, I || indicators(D), p); } catch {}
  if (C) C = { ...C, nBase: C.lines.length };
  if (C && X.extra && ex.length) { C = { ...C, lines: [...C.lines], names: [...C.names] }; ex.forEach(e => { try { C.lines.push(X.extra(D, I, e.n)); C.names.push(X.label.replace(/／.*/, "") + e.n); } catch {} }); }
  return (memo[key] = { id, custom: C ? { ...C, kind: X.kind } : { title: `${X.label}：${X.breadth ? "只有加權、櫃買指數有（要每天的漲跌家數；週、月 K 請切回日 K）" : X.index ? "只有加權指數有（大盤成交金額 ÷ 指數，日 K）" : "資料不夠"}`, lines: [], names: [], range: [0, 1], kind: X.kind, sigs: [] } });
}
/* ---------- 技術線型自訂：每個指標的參數、每條線的顏色、新增線（存在這台裝置；教學範例圖一律用課本的預設） ---------- */
// params：[key, 名稱, 最小, 最大, 間距, 預設]；colors：[線名, 預設顏色變數]；extra(D, I, n)：「新增線」（同一個指標換一個週期再畫一條）
const IND_BUILTIN = {
  ma: { label: "均線", main: true, extra: (D, I, n) => I.ma(n) },
  boll: { label: "布林通道", main: true, params: [["n", "天數", 5, 120, 1, 20], ["k", "標準差倍數", 1, 4, 0.1, 2]], colors: [["通道", "accent"]] },
  vwap: { label: "VWAP", main: true, params: [["n", "天數", 5, 120, 1, 20]], colors: [["VWAP", "vwap"]] },
  sar: { label: "拋物線 SAR", main: true, params: [["st", "加速因子（×0.01）", 1, 5, 1, 2], ["mx", "最大加速（×0.01）", 10, 40, 1, 20]] },
  donch: { label: "唐奇安通道", main: true, params: [["n", "天數", 5, 120, 1, 20]], colors: [["通道", "ma10"]] },
  kelt: { label: "肯特納通道", main: true, params: [["n", "EMA 天數", 5, 120, 1, 20], ["m", "ATR 倍數", 0.5, 5, 0.1, 2], ["a", "ATR 天數", 2, 60, 1, 10]], colors: [["通道", "s2"]] },
  ichi: { label: "一目均衡表", main: true, colors: [["轉換線", "s1"], ["基準線", "s3"], ["遲行線", "s2"]] },
  kd: { label: "KD", params: [["n", "RSV 天數", 3, 60, 1, 9], ["k", "K 平滑", 2, 10, 1, 3], ["d", "D 平滑", 2, 10, 1, 3]], colors: [["K", "s1"], ["D", "s3"]] },
  rsi: { label: "RSI", params: [["n", "天數", 2, 60, 1, 14]], colors: [["RSI", "s2"]], extra: (D, I, n) => rsiCalc(I.c, n) },
  macd: { label: "MACD", params: [["f", "快線 EMA", 2, 60, 1, 12], ["s", "慢線 EMA", 5, 120, 1, 26], ["g", "訊號線", 2, 30, 1, 9]], colors: [["DIF", "s1"], ["MACD", "s3"]] },
  wr: { label: "威廉 %R", params: [["n", "天數", 3, 60, 1, 14]], colors: [["%R", "s2"]], extra: (D, I, n) => wrCalc(D, n) },
};
const EXTRA_PAL = ["#e879f9", "#22c55e", "#f97316", "#38bdf8", "#facc15", "#94a3b8"];
const MA_SLOTS = [["ma5", 5, "s1"], ["ma10", 10, "ma10"], ["ma20", 20, "s2"], ["ma60", 60, "s3"]];
let IND_CFG = store.get("indcfg", {}) || {}, IND_VER = 1;
const isHex = c => /^#[0-9a-f]{6}$/i.test(String(c || ""));
function indSpec(id) { return IND_BUILTIN[id] || (SUBX[id] ? { label: SUBX[id].label, params: SUBX[id].params, extra: SUBX[id].extra } : null); }
function indParams(id, on = true) { const p = {}; (indSpec(id)?.params || []).forEach(([k, , lo, hi, , def]) => { const v = on ? IND_CFG[id]?.p?.[k] : null; p[k] = v == null || !isFinite(v) ? def : Math.min(hi, Math.max(lo, +v)); }); return p; }
function indExtras(id, on = true) { return on ? (IND_CFG[id]?.extra || []).filter(e => e && +e.n >= 1).map(e => ({ n: Math.round(+e.n), c: isHex(e.c) ? e.c : null })) : []; }
function indColor(id, k, on = true) { const c = on ? IND_CFG[id]?.colors?.[k] : null; return isHex(c) ? c : null; }
function maSlots(on = true) { return MA_SLOTS.map(([id, n, ck], k) => { const s = on ? IND_CFG.ma?.slots?.[k] : null; return { id, k, n: s?.n >= 1 ? Math.round(s.n) : n, c: isHex(s?.c) ? s.c : null, ck }; }); }
// 均線顏色：槽或新增線自己設定的顏色；都沒有就用主題色
function maColor(n, col, on = true) { const s = maSlots(on).find(x => x.n === n); if (s) return s.c || col[s.ck] || col.s1; const j = indExtras("ma", on).findIndex(e => e.n === n); return j >= 0 ? indExtras("ma")[j].c || EXTRA_PAL[j % EXTRA_PAL.length] : null; }
function indSave() { store.set("indcfg", IND_CFG); IND_VER++; mainItemsSync(); }
// 有自訂參數時換掉 KD、RSI、MACD、布林、威廉、VWAP（其餘從原本的 I 繼承）；同一組資料、同一版設定只算一次
const IND_MEMO = new WeakMap();
function applyIndCfg(D, I) {
  if (!I || I._cfgOf) return I; const hit = IND_MEMO.get(I); if (hit && hit.v === IND_VER) return hit.I;
  const P = id => [indParams(id), indParams(id, false)], ch = id => { const [a, b] = P(id); return JSON.stringify(a) !== JSON.stringify(b) ? a : null; };
  let I2 = I; const set = (k, v) => { if (I2 === I) { I2 = Object.create(I); I2._cfgOf = I; } I2[k] = v; };
  let p; if ((p = ch("kd"))) set("kd", kdCalc(D, p.n, p.k, p.d)); if ((p = ch("rsi"))) set("rsi", rsiCalc(I.c, p.n)); if ((p = ch("macd"))) set("macd", macdCalc(I.c, p.f, p.s, p.g));
  if ((p = ch("boll"))) set("boll", bollCalc(I.c, p.n, p.k)); if ((p = ch("wr"))) set("wr", wrCalc(D, p.n));
  if ((p = ch("vwap"))) { const n = p.n; set("_vw", null); Object.defineProperty(I2, "vwap", { get() { return this._vw || (this._vw = vwapCalc(D, n)); } }); }
  IND_MEMO.set(I, { v: IND_VER, I: I2 }); return I2;
}
// 線型自訂面板：ids() 回傳目前開著的指標；改了就存起來並呼叫 onChange（重畫）。每個指標一區：參數、各線顏色、新增線、恢復預設
const toHex = c => { c = String(c || "").trim(); if (isHex(c)) return c; const m = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i); if (m) return "#" + m.slice(1).map(x => x + x).join(""); const r = c.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/); return r ? "#" + r.slice(1, 4).map(x => (+x).toString(16).padStart(2, "0")).join("") : "#888888"; };
function indCfgEditor(host, { ids, names = () => null, onChange }) {
  const cfg = id => (IND_CFG[id] ||= {}), save = () => { indSave(); onChange?.(); };
  const num = (attrs, v) => `<input type="number" inputmode="decimal" ${attrs} value="${v}">`;
  const colorIn = (attrs, v) => `<input type="color" ${attrs} value="${toHex(v)}">`;
  const sec = id => {
    const sp = indSpec(id); if (!sp) return ""; const p = indParams(id), ex = indExtras(id);
    let h = `<section class="icfg" data-icfg="${id}"><header><b>${sp.label}</b><button type="button" class="linkbtn" data-icreset="${id}">恢復預設</button></header>`;
    if (id === "ma") h += `<div class="icrow">${maSlots().map(sl => `<label class="icl">${num(`data-icma="${sl.k}" min="1" max="600" step="1" aria-label="第 ${sl.k + 1} 條均線天數"`, sl.n)}${colorIn(`data-icmac="${sl.k}" aria-label="MA${sl.n} 顏色"`, sl.c || cssVar("--" + sl.ck))}</label>`).join("")}</div><p class="note">四條均線的天數與顏色（指標列上的 MA 籤會跟著改名）</p>`;
    if (sp.params?.length) h += `<div class="icrow">${sp.params.map(([k, t, lo, hi, st]) => `<label class="icl"><span>${t}</span>${num(`data-icp="${k}" min="${lo}" max="${hi}" step="${st}"`, p[k])}</label>`).join("")}</div>`;
    const cols = sp.colors || (SUBX[id] ? (names(id) || []).slice(0, 6).map((n, k) => [n, ["s1", "s3", "s2"][k % 3]]) : []);
    if (cols.length) h += `<div class="icrow">${cols.map(([t, ck], k) => `<label class="icl">${colorIn(`data-icc="${k}" aria-label="${t} 顏色"`, indColor(id, k) || cssVar("--" + ck))}<span>${t}</span></label>`).join("")}</div>`;
    if (sp.extra) h += `<div class="icrow">${ex.map((e, j) => `<span class="icl icx">${id === "ma" ? "MA" : sp.label.replace(/[ ／].*/, "")}${num(`data-icxn="${j}" min="1" max="600" step="1" aria-label="新增線天數"`, e.n)}${colorIn(`data-icxc="${j}" aria-label="新增線顏色"`, e.c || EXTRA_PAL[j % 6])}<button type="button" class="linkbtn" data-icxdel="${j}" aria-label="刪除這條線">✕</button></span>`).join("")}<button type="button" class="btn sm" data-icxadd>＋新增線</button></div>`;
    return h + `</section>`;
  };
  const render = () => { const L = [...new Set(ids())].filter(indSpec); host.innerHTML = (L.length ? L.map(sec).join("") : `<p class="note">先在上面開啟指標（均線、KD、RSI…），這裡就會出現它的設定。</p>`) + `<p class="icfoot"><button type="button" class="linkbtn" data-icall>全部恢復預設</button><span class="note">設定存在這台裝置，看盤、圖表實驗室、判讀挑戰、個股判讀都會套用；課程範例圖維持課本的預設。</span></p>`; };
  let tm = 0;
  const upd = (e, live) => { const t = e.target, sc = t.closest("[data-icfg]"); if (!sc) return; const id = sc.dataset.icfg, c = cfg(id), d = t.dataset;
    if (d.icp != null) { if (t.value === "") return; (c.p ||= {})[d.icp] = +t.value; }
    else if (d.icc != null) (c.colors ||= [])[+d.icc] = t.value;
    else if (d.icma != null) { if (t.value === "") return; ((c.slots ||= [])[+d.icma] ||= {}).n = Math.max(1, Math.round(+t.value)); }
    else if (d.icmac != null) ((c.slots ||= [])[+d.icmac] ||= {}).c = t.value;
    else if (d.icxn != null) { if (t.value === "") return; c.extra[+d.icxn].n = Math.max(1, Math.round(+t.value)); }
    else if (d.icxc != null) c.extra[+d.icxc].c = t.value; else return;
    clearTimeout(tm); if (live) tm = setTimeout(save, 250); else save(); };
  host.addEventListener("input", e => upd(e, true)); host.addEventListener("change", e => upd(e, false));
  host.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; const sc = b.closest("[data-icfg]"), id = sc?.dataset.icfg;
    if (b.hasAttribute("data-icall")) { IND_CFG = {}; save(); return render(); }
    if (!id) return; const c = cfg(id);
    if (b.dataset.icreset) delete IND_CFG[id];
    else if (b.hasAttribute("data-icxadd")) { const used = new Set([...(id === "ma" ? maSlots().map(x => x.n) : []), ...indExtras(id).map(x => x.n)]), pick = (id === "ma" ? [120, 240, 30, 10, 100, 200] : [6, 24, 9, 30, 60, 3]).find(n => !used.has(n) && n !== indParams(id).n) || 10; (c.extra ||= []).push({ n: pick, c: EXTRA_PAL[(c.extra.length) % 6] }); }
    else if (b.dataset.icxdel != null) c.extra.splice(+b.dataset.icxdel, 1); else return;
    save(); render(); });
  render(); return { render };
}
// 新增線（RSI、威廉）：同一組資料只算一次
function extraSeries(id, D, I, n) { const m = Object.prototype.hasOwnProperty.call(I, "_xs") ? I._xs : (I._xs = {}), k = id + n; return m[k] || (m[k] = indSpec(id).extra(D, I, n)); }
const SUBX_ITEMS = Object.entries(SUBX).map(([id, x]) => ({ id, label: x.label }));

/* ---------- 延伸指標：乖離率、ATR、CCI、MFI、TRIX（副圖），SAR、唐奇安通道、一目均衡表（主圖） ---------- */
// 乖離率 BIAS：收盤離 n 日均線多遠（%）
function biasCalc(c, n) { const m = sma(c, n); return c.map((x, i) => (m[i] ? ((x - m[i]) / m[i]) * 100 : null)); }
// ATR 平均真實波幅（Wilder 14）：一天平均會動多少，常拿來設停損距離
function atrCalc(D, n = 14) { const o = Array(D.length).fill(null); let a = null, s = 0;
  for (let i = 1; i < D.length; i++) { const t = Math.max(D[i].h - D[i].l, Math.abs(D[i].h - D[i - 1].c), Math.abs(D[i].l - D[i - 1].c)); if (i <= n) { s += t; if (i === n) a = s / n; } else a = (a * (n - 1) + t) / n; if (a != null) o[i] = a; }
  return o; }
// CCI 順勢指標（20）：典型價格離均值幾個「平均偏差」，±100 以外算超買超賣
function cciCalc(D, n = 20) { const tp = D.map(x => (x.h + x.l + x.c) / 3), m = sma(tp, n);
  return tp.map((v, i) => { if (m[i] == null) return null; let md = 0; for (let k = i - n + 1; k <= i; k++) md += Math.abs(tp[k] - m[i]); md /= n; return md ? (v - m[i]) / (0.015 * md) : 0; }); }
// MFI 資金流量指標（14）：把成交量加進 RSI，0～100，80 以上超買、20 以下超賣
function mfiCalc(D, n = 14) { const tp = D.map(x => (x.h + x.l + x.c) / 3);
  return D.map((_, i) => { if (i < n) return null; let p = 0, q = 0; for (let k = i - n + 1; k <= i; k++) { const f = tp[k] * (D[k].v || 0); if (tp[k] > tp[k - 1]) p += f; else if (tp[k] < tp[k - 1]) q += f; } return q ? 100 - 100 / (1 + p / q) : p ? 100 : 50; }); }
// TRIX（12）：收盤取三次 EMA 後的每日變化率（%），濾掉短線雜訊；訊號線是 9 日平均
function trixCalc(c, n = 12) { const e = ema(ema(ema(c, n), n), n); return e.map((v, i) => (i >= 3 * n - 2 && e[i - 1] ? (v / e[i - 1] - 1) * 100 : null)); }
// 拋物線 SAR（Wilder，加速因子 0.02 起、每創新高低加 0.02、最多 0.2）：跟著趨勢移動的停損點，價格穿越就翻轉
function sarCalc(D, step = 0.02, max = 0.2) {
  const N = D.length, o = Array(N).fill(null), dir = Array(N).fill(0); if (N < 3) return { sar: o, dir };
  let up = D[1].c >= D[0].c, af = step, ep = up ? Math.max(D[0].h, D[1].h) : Math.min(D[0].l, D[1].l), sar = up ? Math.min(D[0].l, D[1].l) : Math.max(D[0].h, D[1].h);
  for (let i = 2; i < N; i++) {
    sar = sar + af * (ep - sar);
    if (up) { sar = Math.min(sar, D[i - 1].l, D[i - 2].l); if (D[i].l < sar) { up = false; sar = Math.max(ep, D[i].h, D[i - 1].h); ep = D[i].l; af = step; } else if (D[i].h > ep) { ep = D[i].h; af = Math.min(max, af + step); } }
    else { sar = Math.max(sar, D[i - 1].h, D[i - 2].h); if (D[i].h > sar) { up = true; sar = Math.min(ep, D[i].l, D[i - 1].l); ep = D[i].h; af = step; } else if (D[i].l < ep) { ep = D[i].l; af = Math.min(max, af + step); } }
    o[i] = sar; dir[i] = up ? 1 : -1;
  }
  return { sar: o, dir };
}
// 唐奇安通道（20）：「前」n 根（不含當天）的最高、最低價（海龜交易法的突破通道）；收盤站到上緣外就是創 n 日新高
function donchCalc(D, n = 20) { const up = D.map((_, i) => (i >= n ? Math.max(...D.slice(i - n, i).map(x => x.h)) : null)), lo = D.map((_, i) => (i >= n ? Math.min(...D.slice(i - n, i).map(x => x.l)) : null)); return { up, lo, mid: up.map((v, i) => (v == null ? null : (v + lo[i]) / 2)) }; }
// 一目均衡表（9、26、52）：轉換線、基準線、先行帶 A／B（往後畫 26 根，圖上只畫到最後一根）、遲行線（收盤往前畫 26 根）
function ichiCalc(D) { const mid = (i, n) => { if (i < n - 1) return null; let h = -Infinity, l = Infinity; for (let k = i - n + 1; k <= i; k++) { h = Math.max(h, D[k].h); l = Math.min(l, D[k].l); } return (h + l) / 2; };
  const N = D.length, ten = D.map((_, i) => mid(i, 9)), kij = D.map((_, i) => mid(i, 26)), A = Array(N).fill(null), B = Array(N).fill(null), chi = Array(N).fill(null);
  for (let i = 0; i < N; i++) { const j = i - 26; if (j >= 0) { A[i] = ten[j] != null && kij[j] != null ? (ten[j] + kij[j]) / 2 : null; B[i] = mid(j, 52); } if (i + 26 < N) chi[i] = D[i + 26].c; }
  return { ten, kij, A, B, chi }; }
// 肯特納通道（Raschke 版）：中線 20 日 EMA，上下各 2 倍 ATR（10）；和布林通道一樣是通道，但寬度跟著 ATR（真實波幅）走，比較平滑
function keltCalc(D, n = 20, m = 2, an = 10) { const mid = ema(D.map(x => x.c), n), a = atrCalc(D, an); return { mid: mid.map((v, i) => (a[i] == null ? null : v)), up: mid.map((v, i) => (a[i] == null ? null : v + m * a[i])), lo: mid.map((v, i) => (a[i] == null ? null : v - m * a[i])) }; }
// StochRSI（14、14、3、3）：把 RSI 再做一次隨機指標（RSI 在最近 14 天的高低區間裡的位置），0～100；K＝3 日平均，D＝K 的 3 日平均
function srsiCalc(c, n = 14, m = 14, k = 3, d = 3) { const r = rsiCalc(c, n), raw = r.map((v, i) => { if (v == null || i < n + m - 1) return null; const w = r.slice(i - m + 1, i + 1), hi = Math.max(...w), lo = Math.min(...w); return hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100; }), K = smaN(raw, k); return { K, D: smaN(K, d) }; }
// ROC 變動率（12）：今天收盤比 n 天前漲跌幾 %
function rocCalc(c, n = 12) { return c.map((v, i) => (i >= n && c[i - n] ? (v / c[i - n] - 1) * 100 : null)); }
// DMA 平行線差（10、50、10）：短均線 − 長均線（DIF），AMA 是 DIF 的 10 日平均
function dmaCalc(c, s = 10, l = 50, m = 10) { const a = sma(c, s), b = sma(c, l), dif = c.map((_, i) => (a[i] == null || b[i] == null ? null : a[i] - b[i])); return { dif, ama: smaN(dif, m) }; }
// EMV 簡易波動指標（14、9，台股軟體算法）：中價變動 %×（高低差 ÷ 平均高低差）×（平均量 ÷ 當日量），再取 14 日平均；用很少的量就能推動價格往上＝正值大
function emvCalc(D, n = 14, m = 9) { const N = D.length, hl = D.map(x => x.h - x.l), mhl = sma(hl, n), mv = sma(D.map(x => x.v || 0), n);
  const raw = D.map((x, i) => { if (!i || mhl[i] == null || !mhl[i] || !x.v) return null; const p = D[i - 1].h + D[i - 1].l; return p ? (100 * (x.h + x.l - p) / (x.h + x.l)) * (mv[i] / x.v) * (hl[i] / mhl[i]) : null; });
  const emv = smaN(raw, n); return { emv, ma: smaN(emv, m) }; }
// 寶塔線（三線翻轉）：收盤創新高續畫紅塔、創新低續畫綠塔；要翻色必須突破（跌破）最近三座塔的最高（最低）點，盤整時不翻色
// boxes[i]：當天新畫的塔 { t, b, up, flip }，沒有新塔是 null；state[i]：當天為止最後一座塔
function towerCalc(D, k = 3) { const c = D.map(x => x.c), N = c.length, boxes = Array(N).fill(null), state = Array(N).fill(null), T = []; let dir = 0;
  const add = (i, x) => { T.push(x); boxes[i] = x; };
  for (let i = 1; i < N; i++) {
    if (!T.length) { if (c[i] !== c[0]) { dir = c[i] > c[0] ? 1 : -1; add(i, { t: Math.max(c[0], c[i]), b: Math.min(c[0], c[i]), up: dir > 0, flip: false }); } state[i] = T[T.length - 1] || null; continue; }
    const last = T[T.length - 1], rec = T.slice(-k);
    if (dir > 0) { if (c[i] > last.t) add(i, { t: c[i], b: last.t, up: true, flip: false }); else if (c[i] < Math.min(...rec.map(x => x.b))) { add(i, { t: last.b, b: c[i], up: false, flip: true }); dir = -1; } }
    else { if (c[i] < last.b) add(i, { t: last.b, b: c[i], up: false, flip: false }); else if (c[i] > Math.max(...rec.map(x => x.t))) { add(i, { t: c[i], b: last.t, up: true, flip: true }); dir = 1; } }
    state[i] = T[T.length - 1];
  }
  return { boxes, state }; }

/* ================= 圖表 ================= */
/* ---------- 技術指標開關 ----------
   一排可切換的小籤，分成「主圖」「副圖」兩組；狀態記在瀏覽器裡，下次打開還在。 */
// presets：[[名稱, 指標 id...]] 一鍵套用的組合（新手不用從幾十個指標裡挑）；群組有 more＝n 時只先列前 n 個，其餘收在「更多」（有開著的照樣列出）
function indicatorBar(host, key, groups, defaults, onChange, presets = []) {
  let state = new Set(store.get("ind:" + key, defaults)), more = !!store.get("ind:" + key + ":more", false);
  const chip = it => `<button type="button" class="ichip" data-id="${it.id}" aria-pressed="${state.has(it.id)}">${it.hex || it.color ? `<i style="background:${it.hex || `var(${it.color})`}"></i>` : ""}${it.label}</button>`;
  const render = () => {
    const pre = presets.length ? `<div class="ibar-g ibar-pre" role="group" aria-label="快速組合"><span class="ibar-t">組合</span>${presets.map(([t, ids], i) => `<button type="button" class="ichip" data-pre="${i}" aria-pressed="${ids.length === state.size && ids.every(x => state.has(x))}">${t}</button>`).join("")}</div>` : "";
    const hidden = g => (g.more && !more ? g.items.slice(g.more).filter(it => !state.has(it.id)) : []);
    host.innerHTML = pre + groups.map(g => { const H = new Set(hidden(g));
      return `<div class="ibar-g" role="group" aria-label="${g.title}"><span class="ibar-t">${g.title}</span>${g.items.filter(it => !H.has(it)).map(chip).join("")}${g.more && g.items.length > g.more ? `<button type="button" class="ichip imore" data-more aria-expanded="${more}">${more ? "收起" : `更多 ${H.size} 個 ▾`}</button>` : ""}</div>`; }).join("");
  };
  host.addEventListener("click", e => {
    if (e.target.closest("[data-more]")) { more = !more; store.set("ind:" + key + ":more", more); return render(); }
    const p = e.target.closest("[data-pre]"); if (p) { state = new Set(presets[+p.dataset.pre][1]); store.set("ind:" + key, [...state]); render(); return onChange(state); }
    const b = e.target.closest("[data-id]"); if (!b) return;
    const id = b.dataset.id; state.has(id) ? state.delete(id) : state.add(id);
    store.set("ind:" + key, [...state]); render(); onChange(state);
  });
  render();
  return { has: id => state.has(id), get state() { return state; }, set(id, on) { on ? state.add(id) : state.delete(id); render(); }, setGroups(g) { groups = g; render(); } };
}
const MAIN_ITEMS = [{ id: "ma5", label: "MA5", color: "--s1" }, { id: "ma10", label: "MA10", color: "--ma10" }, { id: "ma20", label: "MA20", color: "--s2" }, { id: "ma60", label: "MA60", color: "--s3" }, { id: "boll", label: "布林", color: "--accent" }, { id: "vwap", label: "VWAP", color: "--vwap" }, { id: "vp", label: "籌碼分佈" }, { id: "sar", label: "SAR", color: "--up" }, { id: "donch", label: "唐奇安通道", color: "--ma10" }, { id: "kelt", label: "肯特納通道", color: "--s2" }, { id: "ichi", label: "一目均衡表", color: "--s3" }];
// 均線籤的名稱、顏色點跟著線型自訂（例如把 MA60 改成 MA120）
function mainItemsSync() { MAIN_ITEMS.forEach(it => { const s = maSlots().find(x => x.id === it.id); if (s) { it.label = "MA" + s.n; it.hex = s.c; } }); }
mainItemsSync();
// 主圖選項：均線、布林、VWAP、籌碼分佈（Volume Profile）
const mainOpts = bar => ({ ma: maFrom(bar), boll: bar.has("boll"), vwap: bar.has("vwap"), vp: bar.has("vp"), mainX: ["sar", "donch", "kelt", "ichi"].filter(id => bar.has(id)) });
// 主圖延伸疊加：SAR（點）、唐奇安通道、一目均衡表（線＋雲帶）；同一組資料只算一次
// lines：[資料, 預設顏色, 粗細, 虛線, ahead, 顏色槽]；vals：[名稱, 資料, 預設顏色, 顏色槽]（顏色槽對應線型自訂裡的第幾個顏色）
function mainXCalc(id, D, I, on = true) { const p = indParams(id, on), key = id + JSON.stringify(p), m = (I._mx ||= {}); if (m[key]) return m[key];
  if (id === "sar") { const { sar, dir } = sarCalc(D, p.st / 100, p.mx / 100); return (m[key] = { dots: sar.map((v, i) => (v == null ? null : { p: v, up: dir[i] > 0 })), vals: [["SAR", sar, "sar"]] }); }
  if (id === "donch") { const d = donchCalc(D, p.n); return (m[key] = { lines: [[d.up, "ma10", 1.4, null, 0, 0], [d.lo, "ma10", 1.4, null, 0, 0], [d.mid, "ma10", 0.9, [3, 3], 0, 0]], vals: [["通道上", d.up, "ma10", 0], ["通道下", d.lo, "ma10", 0]] }); }
  if (id === "kelt") { const k = keltCalc(D, p.n, p.m, p.a); return (m[key] = { lines: [[k.up, "s2", 1.3, null, 0, 0], [k.lo, "s2", 1.3, null, 0, 0], [k.mid, "s2", 0.9, [4, 3], 0, 0]], vals: [["肯特納上", k.up, "s2", 0], ["肯特納下", k.lo, "s2", 0]] }); }
  const k = ichiCalc(D); return (m[key] = { cloud: [k.A, k.B], lines: [[k.ten, "s1", 1.3, null, 0, 0], [k.kij, "s3", 1.5, null, 0, 1], [k.chi, "s2", 1, [2, 3], 26, 2]], vals: [["轉換", k.ten, "s1", 0], ["基準", k.kij, "s3", 1], ["先行A", k.A, "up"], ["先行B", k.B, "down"]] }); }
const SUB_ITEMS = [{ id: "vol", label: "成交量" }, { id: "kd", label: "KD" }, { id: "rsi", label: "RSI" }, { id: "macd", label: "MACD" }, { id: "wr", label: "威廉" }, ...SUBX_ITEMS];
// 均線：四個槽（MA5、MA10、MA20、MA60 的籤）的天數可以改，另外「新增線」的均線一直開著
const maFrom = bar => [...new Set([...maSlots().filter(s => bar.has(s.id)).map(s => s.n), ...indExtras("ma").map(e => e.n)])];
const subsFrom = (bar, ids = ["kd", "rsi", "macd", "wr", "inout", ...Object.keys(SUBX)]) => ids.filter(id => bar.has(id));

// 副圖指標發出的訊號：{ i, si（第幾個副圖）, side, label, v（副圖上的位置） }
// 指標鈍化：連續 n 根在高檔（≥ hi）＝高檔鈍化（強勢延續，不是賣訊），連續 n 根在低檔（≤ lo）＝低檔鈍化（弱勢延續）
// 回傳 [{ side: 1 高檔／−1 低檔, i0 這段開始, ic 確認日（第 n 根）, end 第一根離開的（還沒結束是 null） }]；只看 upto 之前的資料
function dullSpans(a, hi, lo, n = 3, upto = a.length) {
  const out = []; let run = 0, side = 0, i0 = -1;
  for (let i = 0; i < Math.min(upto, a.length); i++) {
    const v = a[i], s = v == null ? 0 : v >= hi ? 1 : v <= lo ? -1 : 0;
    if (s && s === side) run++; else { if (side && run >= n && out.length && out[out.length - 1].end == null) out[out.length - 1].end = i; side = s; run = s ? 1 : 0; i0 = i; }
    if (s && run === n) out.push({ side: s, i0, ic: i, end: null });
  }
  return out;
}
// 哪些副圖看鈍化：KD（K 值 80／20）、RSI（70／30）、威廉（−20／−80）；自訂副圖給 dull: [高, 低] 時看第一條線
function dullOf(S, I) {
  if (S === "kd") return { a: I.kd.K, hi: 80, lo: 20, name: "KD" };
  if (S === "rsi") return { a: I.rsi, hi: 70, lo: 30, name: "RSI" };
  if (S === "wr") return I.wr ? { a: I.wr, hi: -20, lo: -80, name: "威廉" } : null;
  const C = S?.custom; return C?.dull && C.lines?.[0] ? { a: C.lines[0], hi: C.dull[0], lo: C.dull[1], name: C.names?.[0] || "" } : null;
}
// strong：KD 只留低檔（D < 20）的金叉、高檔（D > 80）的死叉（和 KD 課程、策略用的門檻一致）；MACD 只留零軸上方的金叉、零軸下方的死叉（順勢的交叉）
function subSignals(D, I, subs, vis, kinds = {}, strong = false) {
  const out = [], n = Math.min(vis, D.length), st = k => (typeof strong === "object" ? !!strong?.[k] : !!strong); // strong 可以是 { kd, macd } 各自設定
  const cross = (a, b, si, up, dn, keep = () => true) => { for (let i = 1; i < n; i++) { if ([a[i], b[i], a[i - 1], b[i - 1]].some(v => v == null) || D[i].sim) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i] && keep("buy", b[i], a[i])) out.push({ i, si, side: "buy", label: up, v: a[i] });
    else if (a[i - 1] >= b[i - 1] && a[i] < b[i] && keep("sell", b[i], a[i])) out.push({ i, si, side: "sell", label: dn, v: a[i] }); } };
  const exit = (a, lo, hi, si, name) => { for (let i = 1; i < n; i++) { if (a[i] == null || a[i - 1] == null || D[i].sim) continue;
    if (a[i - 1] < lo && a[i] >= lo) out.push({ i, si, side: "buy", label: name + "脫離超賣", v: a[i] });
    else if (a[i - 1] > hi && a[i] <= hi) out.push({ i, si, side: "sell", label: name + "脫離超買", v: a[i] }); } };
  subs.forEach((S, si) => {
    // 高低檔鈍化：確認那天標「高檔鈍化」（偏多，強勢延續）、跌回來那天標「鈍化結束」（偏空）；低檔相反
    if (kinds.dull !== false) { const src = dullOf(S, I); if (src) dullSpans(src.a, src.hi, src.lo, 3, n).forEach(sp => { const hiS = sp.side > 0, nm = src.name + (hiS ? "高檔鈍化" : "低檔鈍化");
      if (!D[sp.ic]?.sim) out.push({ i: sp.ic, si, side: hiS ? "buy" : "sell", label: nm, v: src.a[sp.ic], dull: true });
      if (sp.end != null && sp.end < n && !D[sp.end]?.sim) out.push({ i: sp.end, si, side: hiS ? "sell" : "buy", label: nm + "結束", v: src.a[sp.end], dull: true }); }); }
    if (kinds[typeof S === "string" ? S : S?.custom?.kind || "custom"] === false) return;
    if (S && S.custom && S.custom.sigs) { S.custom.sigs.forEach(g => { if (g.i < n && !D[g.i]?.sim) out.push({ ...g, si }); }); return; }
    if (S === "kd") cross(I.kd.K, I.kd.D, si, "KD金叉", "KD死叉", st("kd") ? (side, d) => (side === "buy" ? d < 20 : d > 80) : undefined);
    else if (S === "macd") cross(I.macd.dif, I.macd.sig, si, "MACD金叉", "MACD死叉", st("macd") ? (side, m, dif) => (side === "buy" ? dif > 0 : dif < 0) : undefined); // 「零軸上金叉」看的是 DIF 本身在零軸上
    else if (S === "rsi") exit(I.rsi, 30, 70, si, "RSI");
    else if (S === "wr") exit(I.wr, -80, -20, si, "威廉");
    else if (S && S.custom && S.custom.lines.length >= 2 && S.custom.signals !== false) { const [a, b] = S.custom.names || []; cross(S.custom.lines[0], S.custom.lines[1], si, a && b ? `${a}上穿${b}` : "副圖金叉", a && b ? `${a}下穿${b}` : "副圖死叉"); }
  });
  return out.sort((a, b) => a.i - b.i);
}
// 要捲動的頁面：嵌在 K線學堂分頁（同網域 iframe、外框依內容長高）時捲動外層頁面
function pageScroller() { try { let w = window; while (w.parent !== w && w.parent.document) w = w.parent; return w; } catch { return window; } }
class Chart {
  // onTap(pos, price, e)：點一下圖（沒有拖曳）時呼叫，pos 是小數的 K 棒位置、price 是那個高度的價格（不在主圖就是 null）；回傳 true 就不固定十字線（畫線練習用）
  constructor(host, { onHover, onRange, onTap } = {}) {
    this.host = host; this.onHover = onHover; this.onRange = onRange; this.onTap = onTap;
    this.legend = document.createElement("div"); this.legend.className = "legend";
    this.canvas = document.createElement("canvas"); this.ctx = this.canvas.getContext("2d");
    this.canvas.setAttribute("role", "img");
    // 縮放工具列：按鈕、Ctrl / ⌘ + 滾輪或雙指縮放，拖曳平移，雙擊還原
    this.bar = document.createElement("div"); this.bar.className = "zoombar";
    // 第二組：縱向（價格軸）放大縮小、圖表高度、對數座標，讓小波動也看得清楚
    this.bar.innerHTML = `<button type="button" data-z="out" aria-label="時間軸縮小" title="時間軸縮小（看更多 K 棒）">−</button><button type="button" data-z="in" aria-label="時間軸放大" title="時間軸放大（看更少 K 棒）">＋</button><button type="button" data-z="reset" aria-label="顯示全部並還原比例">全部</button><span class="zsep" aria-hidden="true"></span><button type="button" data-z="yin" aria-label="價格軸拉長" title="價格軸拉長：波動看起來更大（也可 Shift＋滾輪，或上下拖曳右側價格軸）">↕＋</button><button type="button" data-z="yout" aria-label="價格軸壓縮" title="價格軸壓縮">↕−</button><button type="button" data-z="sig" aria-pressed="true" title="主副圖對應：副圖指標發出訊號時，在主圖 K 線上標出位置（再按一次關閉）">對應</button><button type="button" data-z="expand" aria-label="全螢幕放大" title="放大圖表（全螢幕檢視，或按 Esc 縮小）">⛶ 放大</button><button type="button" data-z="scale" aria-expanded="false" title="主圖與副圖的比例、高度、對數座標、主副圖對應">設定 ▾</button>`;
    // 比例面板：主圖、副圖各自的縮放與高度（觸控裝置也能用按鈕操作）
    this.pop = document.createElement("div"); this.pop.className = "scalepop panel"; this.pop.hidden = true;
    host.append(this.legend, this.bar, this.pop, this.canvas);
    this.hover = null; this.view = null; this.ptrs = new Map(); this.yz = 1; this.yoff = 0; this.yfree = false; this.pz = {};
    Chart.all = Chart.all.filter(c => c.canvas.isConnected); Chart.all.push(this); this.syncBar(); // 多圖、13F 小圖會一直重建：已經不在頁面上的圖表拿掉，才不會越積越多
    this.bar.addEventListener("click", e => {
      const z = e.target.closest("[data-z]")?.dataset.z;
      if (z === "in") this.zoom(0.6); else if (z === "out") this.zoom(1 / 0.6);
      else if (z === "reset") { this.resetScale(); }
      else if (z === "scale") { this.togglePop(); }
      else if (z === "expand") { this.toggleExpand(); }
      else if (z === "sig") { Chart.setPref("sig", !Chart.prefs.sig); }
      else if (z === "yin") this.yZoom(1.5); else if (z === "yout") this.yZoom(1 / 1.5);
    });
    this.pop.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const d = b.dataset;
      if (d.p === "yin") this.yZoom(1.5); else if (d.p === "yout") this.yZoom(1 / 1.5);
      else if (d.p === "sin") this.subZoomAll(1.5); else if (d.p === "sout") this.subZoomAll(1 / 1.5);
      else if (d.p === "reset") this.resetScale();
      else if (d.mk) Chart.setPref("mk", d.mk);
      else if (d.kt) Chart.setPref("kt", d.kt);
      else if (d.h) Chart.setPref("h", +d.h); else if (d.sh) Chart.setPref("sh", +d.sh);
      else if (d.sk) Chart.setPref("sigKinds", { ...Chart.prefs.sigKinds, [d.sk]: !Chart.prefs.sigKinds[d.sk] });
      this.renderPop();
    });
    this.pop.addEventListener("change", e => { const t = e.target; if (t.dataset.pref) Chart.setPref(t.dataset.pref, t.checked); else if (t.dataset.strongall) Chart.setPref("sigStrongK", { ...Chart.prefs.sigStrongK, kd: t.checked, macd: t.checked }); });
    const cv = this.canvas;
    cv.addEventListener("pointerdown", e => {
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 1) {
        const pane = this.paneAt(e.offsetY), onAxis = !!this.geo && e.offsetX > this.geo.L + this.geo.pw;
        if (this.glide) { cancelAnimationFrame(this.glide); this.glide = 0; }
        this.drag = { x: e.offsetX, y: e.offsetY, cx: e.clientX, cy: e.clientY, t: performance.now(), vy: 0, touch: e.pointerType !== "mouse", dir: null, a: this.vw.fa, yz: this.yz, yoff: this.yoff, pane, pz: pane && pane.key !== "main" ? { ...this.paneZoom(pane.key) } : null, axis: onAxis && pane?.key === "main" && e.pointerType === "mouse", subAxis: onAxis && pane && pane.key !== "main" && e.pointerType === "mouse", moved: false }; // 觸控：在價格軸上滑動不再拉伸價格軸（以前上下滑頁面時很容易誤觸，K 棒被拉得很長）
      }
      if (this.ptrs.size === 2 && this.D) { this.tapOk = false; const [p, q] = [...this.ptrs.values()], { a, b } = this.range; this.smoothY = true; const ax = Math.abs(p.x - q.x), ay = Math.abs(p.y - q.y), pane = this.paneAt((p.y + q.y) / 2);
        // 兩指上下張開＝拉長或壓縮（在主圖上是價格軸，在副圖上只縮放那個副圖）；左右張開＝縮放時間軸。
        // 方向看「兩指一開始怎麼移動」（不是手指放的角度）：移動超過 8px 才決定，之後整個手勢都是同一種
        this.pinch = { mode: null, ax, ay, pane, my: (p.y + q.y) / 2, key: pane?.key, pz: pane && pane.key !== "main" ? { ...this.paneZoom(pane.key) } : null, d: Math.max(30, Math.hypot(p.x - q.x, p.y - q.y)), dy: Math.max(30, ay), yz: this.yz, a: this.vw.fa, w: this.vw.w, mid: this.posAt((p.x + q.x) / 2), mx: (p.x + q.x) / 2 }; this.drag = null; try { cv.setPointerCapture(e.pointerId); } catch {} }
      if (this.ptrs.size === 1) this.tapOk = true;
      this.hoverY = e.offsetY; if (e.pointerType === "mouse" && !this.pinned) this.hoverAt(e.offsetX);
    });
    cv.addEventListener("pointermove", e => {
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && this.ptrs.size === 2) {
        // 雙指縮放：用兩指的實際距離（斜著捏也穩定），以一開始兩指中間那根 K 棒為中心，兩指一起移動時順便平移；每個畫面最多重畫一次
        const P = this.pinch, [p, q] = [...this.ptrs.values()], d = Math.max(30, Math.hypot(p.x - q.x, p.y - q.y)), G = this.geo;
        if (!P.mode) {
          const dax = Math.abs(Math.abs(p.x - q.x) - P.ax), day = Math.abs(Math.abs(p.y - q.y) - P.ay); if (Math.max(dax, day) < 8) return;
          P.mode = day > dax * 1.2 ? (P.pane && P.pane.key !== "main" ? "p" : "y") : "x";
          if (P.mode === "y" && this.ysm && G) { // 價格軸拉長時，兩指中間那個價位固定在手指下
            const f = Math.max(0, Math.min(1, (P.my - G.top0) / G.mainH)); P.f = f; P.pm = this.ysm.hi - f * (this.ysm.hi - this.ysm.lo); }
        }
        if (P.mode === "p") { this.pz[P.key] = { z: Math.max(0.5, Math.min(12, P.pz.z * Math.max(30, Math.abs(p.y - q.y)) / P.dy)), off: P.pz.off }; this.req(); return; }
        if (P.mode === "y") { this.yz = Math.max(0.5, Math.min(12, P.yz * Math.max(30, Math.abs(p.y - q.y)) / P.dy)); this.smoothY = false;
          const B = this.ybase; if (this.yz > 1 && B && P.pm != null) { const sp = B.hi - B.lo, half = sp / this.yz / 2, mid = P.pm + P.f * 2 * half - half; this.yfree = true; this.yoff = Math.max(-0.6, Math.min(0.6, (mid - (B.lo + B.hi) / 2) / sp)); }
          else if (this.yz <= 1) this.yoff = 0; this.req(); return; }
        const w = P.w * P.d / d, shift = G ? ((p.x + q.x) / 2 - P.mx) / ((G.pe ?? G.pw) / w) : 0;
        this.view = this.clampView(P.mid - (P.mid - P.a) * w / P.w - shift, w); this.req(); return;
      }
      if (this.drag && this.ptrs.size === 1 && this.geo) {
        const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y, G = this.geo;
        // 圖表鎖定（放大後）時，頁面不會自己捲動：手勢一開始偏上下、又不是在拉價格軸或平移價格，就由這裡代替頁面捲動
        if (this.drag.touch && this.locked) {
          if (!this.drag.dir && Math.hypot(e.clientX - this.drag.cx, e.clientY - this.drag.cy) > 6) this.drag.dir = Math.abs(e.clientY - this.drag.cy) > Math.abs(e.clientX - this.drag.cx) * 1.2 ? "v" : "h";
          const wantsChartY = this.drag.axis || this.drag.subAxis || (this.yz > 1 && this.drag.y < G.top0 + G.mainH) || (this.drag.pz && this.drag.pz.z > 1);
          if (this.drag.dir === "v" && !wantsChartY) {
            const now = performance.now(), step = this.drag.lastCy == null ? e.clientY - this.drag.cy : e.clientY - this.drag.lastCy;
            pageScroller().scrollBy(0, -step); this.drag.vy = step / Math.max(1, now - (this.drag.lt || now - 16)); this.drag.lastCy = e.clientY; this.drag.lt = now; this.drag.moved = true; return;
          }
        }
        // 右側價格軸上下拖曳：拉長或壓縮價格軸
        if (this.drag.axis) { if (Math.abs(dy) > 2) { try { cv.setPointerCapture(e.pointerId); } catch {} this.yz = Math.max(0.5, Math.min(12, this.drag.yz * Math.exp(dy / 120))); this.req(); } return; }
        // 副圖右側刻度上下拖曳：只縮放這一個副圖
        if (this.drag.subAxis) { if (Math.abs(dy) > 2) { try { cv.setPointerCapture(e.pointerId); } catch {} this.pz[this.drag.pane.key] = { z: Math.max(0.5, Math.min(12, this.drag.pz.z * Math.exp(dy / 80))), off: this.drag.pz.off }; this.req(); } return; }
        // 副圖放大後，在副圖上下拖曳可以平移
        const sp = this.drag.pane && this.drag.pane.key !== "main" && this.drag.pz && this.drag.pz.z > 1 && Math.abs(dy) > 4 ? this.drag.pane : null;
        if (sp && Math.abs(dy) > Math.abs(dx)) { this.drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch {} this.pz[sp.key] = { z: this.drag.pz.z, off: Math.max(-1, Math.min(1, this.drag.pz.off + dy / sp.h)) }; this.req(); return; }
        const panX = Math.abs(dx) > 4 && this.view && !(this.drag.touch && this.drag.dir === "v" && this.yz > 1), panY = this.yz > 1 && Math.abs(dy) > 4 && this.drag.y < G.top0 + G.mainH && (!this.drag.touch || this.drag.dir === "v");
        if (panX || panY) {
          if (!this.drag.cap) { this.drag.cap = true; try { cv.setPointerCapture(e.pointerId); } catch {} } this.drag.moved = true;
          if (panX) { this.drag.bw ||= G.bw; this.smoothY = true; const now = performance.now(), fa0 = this.vw.fa; this.view = this.clampView(this.drag.a - dx / this.drag.bw, this.vw.w);
            const dt = now - (this.drag.vt || now - 16); this.drag.vx = 0.7 * (this.drag.vx || 0) + 0.3 * ((this.vw.fa - fa0) / Math.max(1, dt)); this.drag.vt = now; this.drag.panned = true; }
          if (panY) { if (!this.yfree && this.ymid) { this.drag.yoff = this.yoff = this.ymid.off || 0; this.yfree = true; this.drag.y = e.offsetY; } // 從「跟隨」的位置接手
            this.yoff = Math.max(-0.6, Math.min(0.6, this.drag.yoff + (e.offsetY - this.drag.y) / G.mainH / this.yz)); }
          this.req(); return;
        }
      }
      // 滑鼠：十字線跟著游標（固定時不動）；手指：固定十字線後、圖沒有放大時，左右拖曳可以移動十字線
      if (this.drag && Math.hypot(e.offsetX - this.drag.x, e.offsetY - this.drag.y) > 6) this.tapOk = false;
      if (e.pointerType === "mouse" ? !this.pinned : this.pinned && !this.view && this.drag && !this.drag.moved) { if (this.hoverY !== e.offsetY) { this.hoverY = e.offsetY; this.req(); } this.hoverAt(e.offsetX); }
    });
    const up = e => {
      Chart.touchAt = performance.now();
      // 代替頁面捲動時，放開手指後讓頁面再滑一小段（慣性），手感接近一般捲動
      const d = this.drag; if (d && d.dir === "v" && Math.abs(d.vy) > 0.2 && e.type === "pointerup") { let v = d.vy * 16; const glide = () => { if (Math.abs(v) < 0.5) return; pageScroller().scrollBy(0, -v); v *= 0.94; requestAnimationFrame(glide); }; requestAnimationFrame(glide); }
      const wasPinch = !!this.pinch;
      // 橫向拖曳放開後的慣性：依最後的速度繼續滑，每個畫面減速
      if (d && d.panned && e.type === "pointerup" && Math.abs(d.vx || 0) > 0.002 && performance.now() - (d.vt || 0) < 80 && this.view) {
        let v = d.vx * 16, last = performance.now(); const go = now => { const dt = Math.min(40, now - last) / 16; last = now; v *= Math.pow(0.93, dt); const nv = this.clampView(this.vw.fa + v * dt, this.vw.w);
          if (!nv || Math.abs(v) < 0.01 || nv.fa === this.vw.fa) { this.glide = 0; this.smoothY = true; this.req(); return; } this.view = nv; this.draw(); this.glide = requestAnimationFrame(go); };
        this.smoothY = true; this.glide = requestAnimationFrame(go); }
      // 點一下（沒有拖曳）：固定十字線；固定時再點同一根 K 棒就取消
      if (e.type === "pointerup" && this.tapOk && this.drag && !this.drag.moved && this.D && this.ptrs.size === 1 && !this.drag.axis && !this.drag.subAxis) {
        // 手指點兩下（300ms 內、位置相近）＝恢復原本的縮放（iPhone／iPad 上沒有 dblclick）
        if (this.onTap && this.onTap(this.posAt(e.offsetX), this.priceAt(e.offsetY), e) === true) { this.tapOk = false; this.ptrs.delete(e.pointerId); if (!this.ptrs.size) this.drag = null; this.req(); return; }
        const now = performance.now(), dbl = e.pointerType !== "mouse" && this.lastTap && now - this.lastTap.t < 320 && Math.abs(e.offsetX - this.lastTap.x) < 30 && Math.abs(e.offsetY - this.lastTap.y) < 30;
        this.lastTap = dbl ? null : { t: now, x: e.offsetX, y: e.offsetY };
        if (dbl) { this.pinned = false; this.hover = null; this.resetScale(); this.tapOk = false; this.ptrs.delete(e.pointerId); if (!this.ptrs.size) this.drag = null; return; }
        const i = this.indexAt(e.offsetX); if (this.pinned && i === this.hover) { this.pinned = false; if (e.pointerType !== "mouse") this.hover = null; } else { this.pinned = true; this.hover = i; } this.req();
      }
      this.tapOk = false;
      this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; if (!this.ptrs.size) this.drag = null;
      if (wasPinch && this.ptrs.size === 1) { const [r] = [...this.ptrs.values()]; this.drag = { x: r.x, y: r.y, cx: r.x, cy: r.y, t: performance.now(), vy: 0, touch: true, dir: "h", a: this.vw.fa, yz: this.yz, yoff: this.yoff, pane: null, pz: null, moved: true }; }
    };
    // iOS：圖在 iframe 裡時 touch-action: pan-y 不一定有效，左右拖曳到一半瀏覽器會把手勢搶走（pointercancel），每次只滑一小段。
    // 第一個 touchmove 就決定方向：左右（或兩指）＝這次手勢整個不給瀏覽器（preventDefault），上下＝照常原生捲動
    let tdir = null, t0 = null;
    cv.addEventListener("touchstart", e => { tdir = null; t0 = e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    cv.addEventListener("touchmove", e => {
      if (e.touches.length > 1) { tdir = "h"; if (e.cancelable) e.preventDefault(); return; }
      const t = e.touches[0]; if (!t || !t0) return;
      if (!tdir) { const dx = Math.abs(t.clientX - t0.x), dy = Math.abs(t.clientY - t0.y); if (dx + dy < 1) return; tdir = dx >= dy ? "h" : "v"; }
      if (tdir === "h" && (this.view || this.pinned) && e.cancelable) e.preventDefault();
    }, { passive: false });
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", e => { up(e); if (!this.pinned) { this.hover = null; this.draw(); } });
    cv.addEventListener("dblclick", () => this.resetScale());
    cv.addEventListener("wheel", e => {
      if (!this.D) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.004), this.posAt(e.offsetX)); }
      else if (e.shiftKey) {
        e.preventDefault(); const f = Math.exp(-(e.deltaY || e.deltaX) * 0.003), pane = this.paneAt(e.offsetY);
        if (pane && pane.key !== "main") { const z = this.paneZoom(pane.key); this.pz[pane.key] = { z: Math.max(0.5, Math.min(12, z.z * f)), off: z.off }; this.draw(); } else this.yZoom(f);
      }
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && this.view && this.geo) { e.preventDefault(); const { a, b } = this.range; this.smoothY = true; this.view = this.clampView(this.vw.fa + e.deltaX / this.geo.bw, this.vw.w); this.draw(); }
    }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(host);
  }
  static all = [];
  // 有圖表正在被拖曳、縮放或慣性滑動（放開後 800ms 內也算）：頁面其他地方的定時重畫先等一下，手勢才不會掉格
  static busy() { return Chart.all.some(c => c.ptrs.size || c.glide || c.pinch) || performance.now() - (Chart.touchAt || 0) < 800; }
  static LW = 0.6; // 所有指標線的粗細倍數（越小越細，比較好看清楚 K 棒）
  static keepView = false; // 即時報價更新最後一根 K 棒時，保留使用者的縮放與平移
  static PREF_KEYS = { h: "chartH", log: "chartLog", sh: "chartSubH", fit: "chartSubFit", sig: "chartSubSig", sigKinds: "chartSigKinds", sigStrong: "chartSigStrong", sigStrongK: "chartSigStrongK", mk: "chartMk", kt: "chartKt" };
  static prefs = { h: [1, 1.5, 2, 2.5].includes(+store.get("chartH", 1)) ? +store.get("chartH", 1) : 1, log: !!store.get("chartLog", false),
    sh: [1, 1.5, 2].includes(+store.get("chartSubH", 1)) ? +store.get("chartSubH", 1) : 1, fit: !!store.get("chartSubFit", false), sig: store.get("chartSubSig", true) !== false,
    sigStrong: store.get("chartSigStrong", true) !== false, mk: store.get("chartMk", "full") === "icon" ? "icon" : "full", kt: ["candle", "hollow", "ohlc", "line", "area"].includes(store.get("chartKt", "candle")) ? store.get("chartKt", "candle") : "candle",
    sigKinds: { kd: true, macd: true, rsi: true, wr: true, custom: true, mtm: true, dmi: true, psy: true, arbr: true, obv: true, vr: true, adr: true, obos: true, adl: true, bias: true, cci: true, mfi: true, trix: true, dull: true, srsi: true, roc: true, dma: true, emv: true, tower: true, ...(store.get("chartSigKinds", null) || {}) },
    // 「只看重點」每個副圖各自開關（舊版是全部共用一個 sigStrong）
    sigStrongK: { kd: store.get("chartSigStrong", true) !== false, macd: store.get("chartSigStrong", true) !== false, ...(store.get("chartSigStrongK", null) || {}) } };
  // 某個副圖要不要標訊號：「金叉死叉」或「只看重點」任一個開著就標；「只看重點」開著時只標重點交叉
  static sigShow(k) { const P = Chart.prefs; return P.sig && (P.sigKinds[k] !== false || !!P.sigStrongK[k]); }
  static SIG_KINDS = [["kd", "KD 交叉"], ["dull", "高低檔鈍化"], ["macd", "MACD 交叉"], ["rsi", "RSI 30／70"], ["wr", "威廉 −80／−20"], ["mtm", "MTM 零軸"], ["dmi", "DMI 交叉"], ["psy", "PSY 25／75"], ["arbr", "AR 60／150"], ["obv", "OBV 均線"], ["vr", "VR 70／450"], ["adr", "ADR 0.5／1.5"], ["obos", "OBOS 零軸"], ["adl", "ADL 均線"], ["bias", "乖離率 ±5%"], ["cci", "CCI ±100"], ["mfi", "MFI 20／80"], ["trix", "TRIX 交叉"], ["srsi", "StochRSI 交叉"], ["roc", "ROC 零軸"], ["dma", "DMA 交叉"], ["emv", "EMV 零軸"], ["tower", "寶塔翻色"], ["custom", "截圖副圖交叉"]];
  // 高度、對數座標、副圖貼合是全站共用的偏好：改了以後所有圖表一起重畫
  static setPref(k, v) { Chart.prefs[k] = v; store.set(Chart.PREF_KEYS[k], v); Chart.all.forEach(c => { c.syncBar(); c.draw(); if (!c.pop.hidden) c.renderPop(); }); }
  paneZoom(key) { return this.pz[key] || { z: 1, off: 0 }; }
  paneAt(y) { return (this.panes || []).find(p => y >= p.top - 5 && y <= p.top + p.h + 5) || null; }
  subZoomAll(f) { (this.panes || []).filter(p => p.key !== "main").forEach(p => { const z = this.paneZoom(p.key); this.pz[p.key] = { z: Math.max(0.5, Math.min(12, z.z * f)), off: z.off }; }); this.draw(); }
  // 放大或平移過的圖會「鎖定」：所有手勢都交給圖表（touch-action: none），避免拖曳圖表時整個頁面跟著捲動
  get locked() { return !!this.view || this.yz !== 1 || !!this.yoff || Object.values(this.pz).some(x => x.z !== 1 || x.off); }
  resetScale() { this.cmpBase = null; // 按「全部」時比較的基準日也重新取
 this.view = null; this.yz = 1; this.yoff = 0; this.yfree = false; this.pz = {}; this.draw(); if (!this.pop.hidden) this.renderPop(); }
  togglePop(open = this.pop.hidden) {
    Chart.all.forEach(c => { if (c !== this && !c.pop.hidden) c.togglePop(false); });
    this.pop.hidden = !open; this.bar.querySelector('[data-z="scale"]').setAttribute("aria-expanded", open);
    if (open) { this.renderPop(); Chart.closer ||= document.addEventListener("pointerdown", ev => Chart.all.forEach(c => { if (!c.pop.hidden && !c.pop.contains(ev.target) && !c.bar.contains(ev.target)) c.togglePop(false); })) || true; }
  }
  renderPop() {
    const P = Chart.prefs, seg = (k, vals, cur) => `<div class="pseg">${vals.map(v => `<button type="button" data-${k}="${v}" aria-pressed="${cur === v}">${v}×</button>`).join("")}</div>`;
    const sz = Object.values(this.pz).map(x => x.z), szTxt = sz.length ? `${+Math.max(...sz).toFixed(1)}×` : "1×";
    this.pop.innerHTML = `<div class="prow"><strong>主圖（價格）</strong><span class="pval">${+this.yz.toFixed(1)}×</span><div class="pseg"><button type="button" data-p="yout" aria-label="價格軸壓縮">↕−</button><button type="button" data-p="yin" aria-label="價格軸拉長">↕＋</button></div></div>
      <div class="prow"><span>高度</span>${seg("h", [1, 1.5, 2, 2.5], P.h)}</div>
      <label class="prow pchk"><input type="checkbox" data-pref="log" ${P.log ? "checked" : ""}><span>對數座標（同樣的漲跌幅一樣高）</span></label>
      <div class="prow"><strong>副圖（量、指標）</strong><span class="pval">${szTxt}</span><div class="pseg"><button type="button" data-p="sout" aria-label="副圖壓縮">↕−</button><button type="button" data-p="sin" aria-label="副圖拉長">↕＋</button></div></div>
      <div class="prow"><span>高度</span>${seg("sh", [1, 1.5, 2], P.sh)}</div>
      <label class="prow pchk"><input type="checkbox" data-pref="fit" ${P.fit ? "checked" : ""}><span>副圖自動貼合資料（KD、RSI 等固定刻度的指標也放大到填滿）</span></label>
      <div class="prow"><strong>主副圖對應</strong></div>
      <label class="prow pchk"><input type="checkbox" data-pref="sig" ${P.sig ? "checked" : ""}><span>副圖發出訊號時，在主圖 K 線上標出位置（空心圈＋名稱），副圖同一點以虛線對齊</span></label>
      <div class="prow pkinds" ${P.sig ? "" : "aria-disabled=\"true\""}>${Chart.SIG_KINDS.map(([k, t]) => `<button type="button" class="ichip" data-sk="${k}" aria-pressed="${P.sig && P.sigKinds[k]}" ${P.sig ? "" : "disabled"}>${t}</button>`).join("")}</div>
      <label class="prow pchk"><input type="checkbox" data-strongall="1" ${P.sigStrongK.kd && P.sigStrongK.macd ? "checked" : ""} ${P.sig ? "" : "disabled"}><span>只標重點交叉：KD 低檔（D&lt;20）金叉、高檔（D&gt;80）死叉；MACD 零軸上金叉、零軸下死叉。取消勾選則標出全部交叉</span></label>
      <div class="prow"><strong>K 線樣式</strong></div>
      <div class="prow"><div class="pseg kts">${[["candle", "實心K"], ["hollow", "空心K"], ["ohlc", "美國線"], ["line", "收盤線"], ["area", "面積圖"]].map(([k, t]) => `<button type="button" data-kt="${k}" aria-pressed="${P.kt === k}">${t}</button>`).join("")}</div></div>
      <div class="prow"><span>訊號標記</span><div class="pseg"><button type="button" data-mk="full" aria-pressed="${P.mk !== "icon"}">符號＋文字</button><button type="button" data-mk="icon" aria-pressed="${P.mk === "icon"}">只有符號</button></div></div>
      <p class="note" style="margin:0">策略與課程的訊號是 K 棒旁的三角形，文字會自動避開 K 棒；副圖指標的訊號（金叉、死叉等）是 K 棒下方（偏多）或上方（偏空）的半透明圓圈，用虛線連到副圖上的訊號點，點一下那根 K 棒就會加深並顯示名稱；每個副圖右上角可以直接開關。點一下圖表可以固定十字線，再點一次取消。</p>
      <div class="prow"><button type="button" class="btn sm" data-p="reset">全部還原</button></div>
      <p class="note">電腦：Shift＋滾輪縮放游標所在的圖，或上下拖曳右側刻度；放大後可上下拖曳平移。雙擊圖表還原。</p>
      ${this.cfgOn ? `<div class="prow"><strong>線型（顏色、參數、新增線）</strong></div><div class="picfg"></div>` : ""}`;
    // 線型自訂：列出這張圖目前開著的指標；改了就讓每張圖用新設定重算，並通知頁面（看盤更新指標籤名稱、判讀）
    const host = this.pop.querySelector(".picfg");
    if (host) indCfgEditor(host, { ids: () => this.cfgIds(), names: id => { const S = (this.subsN || []).find(x => x.id === id); return S?.custom?.names?.slice(0, S.custom.nBase); },
      onChange: () => { Chart.all.forEach(c => { if (c.D && c.cfgOn) c.set(c.D, { ...c.o, I: c.o.I?._cfgOf || c.o.I }); }); dispatchEvent(new Event("indcfg")); } });
  }
  // 這張圖開著、可以自訂的指標（均線算一個）
  cfgIds() { const o = this.o || {}; return [...(o.ma?.length && !o.maPlain ? ["ma"] : []), ...(o.boll ? ["boll"] : []), ...(o.vwap ? ["vwap"] : []), ...(o.mainX || []), ...(this.subsN || []).map(S => (typeof S === "string" ? S : S.id)).filter(Boolean)]; }
  syncBar() {
    // 每畫一格都會呼叫：狀態沒變就不碰 DOM（重設同樣的屬性也會讓瀏覽器重算樣式，手機滑動時會掉格）
    const scaled = Chart.prefs.h !== 1 || Chart.prefs.log || Chart.prefs.sh !== 1 || Chart.prefs.fit || Object.values(this.pz).some(x => x.z !== 1 || x.off);
    const k = `${this.locked}|${this.yz > 1.01}|${Chart.prefs.sig}|${scaled}`; if (k === this.barKey) return; this.barKey = k;
    this.canvas.style.touchAction = "pan-y"; // 上下滑永遠交給瀏覽器原生捲動（有慣性、不卡）；左右滑與雙指縮放才由圖表處理
    this.host.classList.toggle("chart-locked", this.locked);
    this.bar.querySelector('[data-z="yin"]').setAttribute("aria-pressed", this.yz > 1.01);
    this.bar.querySelector('[data-z="sig"]').setAttribute("aria-pressed", Chart.prefs.sig);
    this.bar.querySelector('[data-z="scale"]').classList.toggle("on", scaled);
  }
  yZoom(f) { this.yz = Math.max(0.5, Math.min(12, this.yz * f)); if (this.yz <= 1) this.yoff = 0; this.draw(); }
  // 線的顏色：線型自訂的顏色 → 沒有就用主題色（畫布要實際顏色；圖例用 CSS 變數，換主題會跟著變）
  // 自訂副圖第 k 條線：原本的線用設定的顏色或 s1、s3、s2 輪流；新增線用自己的顏色或備用色盤
  subColor(S, k, col, css = false) { const C = S.custom, base = C.nBase ?? C.lines.length, id = S.id;
    if (k >= base) { const e = indExtras(id, this.cfgOn)[k - base]; return e?.c || EXTRA_PAL[(k - base) % 6]; }
    const ck = ["s1", "s3", "s2"][k % 3]; return id ? (css ? this.lcss(id, k, ck) : this.lc(id, k, ck, col)) : css ? `var(--${ck})` : col[ck]; }
  lc(id, k, ck, col) { return indColor(id, k, this.cfgOn) || col[ck] || cssVar("--" + ck) || "#888"; }
  lcss(id, k, ck) { return indColor(id, k, this.cfgOn) || `var(--${ck})`; }
  set(D, opts = {}) { if (D !== this.D && !Chart.keepView) { this.ysm = null; this.view = null; this.yz = 1; this.yoff = 0; this.yfree = false; this.pz = {}; } if (!Chart.keepView || this.hover == null || this.hover >= D.length) { this.hover = null; this.pinned = false; } this.D = D; this.I = opts.I || indicators(D); if (!opts.noCfg) this.I = applyIndCfg(D, this.I); this.cfgOn = !opts.noCfg; this.o = opts; this.draw(); return this; }
  // 資料前面插入 n 根（往左拉載入更早的 K 線）：可見範圍、拖曳／雙指的起點、固定的十字線一起往後移 n 根，
  // 正在拖曳的手勢才不會被彈回原處（要在 set() 之前呼叫）
  shiftBy(n) { if (!n) return; const v = this.view; if (v) this.view = { a: v.a + n, b: v.b + n, fa: (v.fa ?? v.a) + n, w: v.w ?? v.b - v.a + 1 };
    if (this.drag && this.drag.a != null) this.drag.a += n; if (this.pinch) { this.pinch.a += n; this.pinch.mid += n; } if (this.hover != null) this.hover += n; }
  get visible() { return this.o.visible ?? this.D.length; }
  get range() { return this.view || { a: 0, b: this.D.length - 1 }; }
  // 可見範圍：fa 是小數的起點（拖曳時一個像素一個像素地跟手，不會一次跳一根 K 棒），a、b 是整數索引（給計算用）
  // 寬度也可以是小數：雙指縮放時 K 棒寬度連續變化，不會一格一格跳
  clampView(a, w) { const N = this.D.length; w = Math.max(Math.min(15, N), Math.min(N, w)); if (w >= N - 1e-6) return null; a = Math.max(0, Math.min(N - w, a)); return { a: Math.floor(a), b: Math.min(N - 1, Math.ceil(a + w) - 1), fa: a, w }; }
  get vw() { const r = this.range; return { fa: r.fa ?? r.a, w: r.w ?? r.b - r.a + 1 }; }
  setWidth(w, anchor) { const { fa, w: ow } = this.vw; anchor = anchor ?? fa + ow / 2; const t = (anchor - fa) / ow; this.view = this.clampView(anchor - t * w, w); this.draw(); }
  zoom(f, anchor) { if (!this.D) return; this.setWidth(this.vw.w * f, anchor); }
  hoverAt(x) { const i = this.indexAt(x); if (i !== this.hover) { this.hover = i; this.req(); } }
  toggleExpand() {
    const sec = this.host.closest(".sec, .panel, .chartbox") || this.host;
    const on = sec.classList.toggle("chart-fullscreen");
    const b = this.bar?.querySelector("[data-z='expand']");
    if (b) { b.textContent = on ? "✕ 縮小" : "⛶ 放大"; b.setAttribute("aria-pressed", on); }
    const ext = sec.querySelector("#kExpandBtn");
    if (ext) { ext.textContent = on ? "✕ 縮小" : "⛶ 放大"; ext.setAttribute("aria-pressed", on); }
    chartFrameSync(); this.draw(); requestAnimationFrame(() => this.draw()); // iframe 改成滿版後下一個畫面尺寸才確定，再畫一次
  }
  // 手勢中的重畫合併到下一個畫面（每個畫面最多畫一次），拖曳、縮放比較順
  req() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  priceAt(y) { return this.geo?.pAt ? this.geo.pAt(y) : null; } // 畫面 y 對應的價格（只在主圖範圍內）
  posAt(x) { if (!this.geo) return null; const { L, bw, fa } = this.geo; return fa + (x - L) / bw; } // 畫面 x 對應的「小數」K 棒位置（縮放的錨點）
  indexAt(x, raw) { if (!this.geo) return null; const { L, bw, fa, a } = this.geo; const i = Math.floor(fa + (x - L) / bw); return raw ? i : Math.max(a, Math.min(Math.min(this.visible - 1, this.range.b), i)); }
  draw() {
    if (!this.D) return;
    const { D, I, o } = this, ctx = this.ctx, dpr = Math.min(2, window.devicePixelRatio || 1); // 手機是 3 倍：畫布像素多一倍多、每格要畫的量也多，2 倍肉眼看不出差別
    const W = this.host.clientWidth; if (!W) return;
    const narrow = W < 560;
    // 副圖可以疊好幾個：o.subs = ["kd", "macd", { custom }]；舊的 o.sub 也支援
    const subs = this.subsN = (o.subs || (o.sub ? [o.sub] : [])).filter(Boolean).map(S => (typeof S === "string" && SUBX[S] ? subxMake(S, D, I, this.cfgOn !== false) : S)).filter(Boolean);
    const isFull = !!(this.host.closest(".chart-fullscreen") || this.host.classList.contains("chart-fullscreen")), gap = 10, axisH = 20;
    let volH = o.noVol ? 0 : Math.round((narrow ? 52 : 66) * Chart.prefs.sh), subH = Math.round((subs.length > 1 ? (narrow ? 80 : 96) : (narrow ? 92 : 112)) * Chart.prefs.sh), mainH;
    if (isFull) {
      // 全螢幕：主圖、成交量、副圖要一起塞進放大框（手機直拿、橫拿都一樣；螢幕矮時成交量和副圖等比例縮小，不會被擠到畫面外）
      // 用放大框本身的高度算（扣掉上面的工具列、下面的留白與安全區），不用 innerHeight：嵌在 iframe 裡時 innerHeight 可能是整頁的高度
      const box = this.host.closest(".chart-fullscreen") || this.host, bh = box.clientHeight, pb = parseFloat(getComputedStyle(box).paddingBottom) || 0;
      const top = Math.min(bh * 0.45, Math.max(0, this.canvas.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop)), avail = bh - pb - top - 4, minMain = narrow || bh < 500 ? 130 : 200;
      const rest = volH + subs.length * (gap + subH), fixed = gap + rest + axisH + 8;
      if (avail - fixed < minMain && rest > 0) { const f = Math.max(0.4, (avail - minMain - gap - subs.length * gap - axisH - 8) / (volH + subs.length * subH)); volH = Math.round(volH * f); subH = Math.round(subH * f); }
      mainH = Math.max(minMain, Math.round(avail - (gap + volH + subs.length * (gap + subH) + axisH + 8)));
    } else mainH = Math.round((narrow ? 230 : 300) * Chart.prefs.h);
    const H = mainH + gap + volH + subs.length * (gap + subH) + axisH + 8;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); this.canvas.style.height = H + "px"; } // 尺寸沒變就不重設（重設畫布很慢，拖曳時會閃）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const col = { ink: cssVar("--ink"), muted: cssVar("--muted"), line: cssVar("--line"), up: cssVar("--up"), down: cssVar("--down"), s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"), accent: cssVar("--accent"), band: cssVar("--band"), shade: cssVar("--shade"), surface: cssVar("--surface"), vwap: cssVar("--vwap") || "#f472b6", ma10: cssVar("--ma10") || "#5b9bff" };
    const n = D.length, vis = this.visible, L = 8, R = narrow ? 48 : 58, pw = W - L - R;
    // 開籌碼分佈時，K 棒右邊留一段空白給分佈長條，最新的 K 棒才不會被蓋住
    const vpW = o.vp ? pw * (narrow ? 0.24 : 0.18) : 0, padR = vpW ? vpW + 6 : 0; // 分佈長條自己一條，不和 K 棒重疊
    const { a: va, b: vb } = this.range, { fa, w: vwid } = this.vw, bw = (pw - padR) / vwid, inV = i => i >= va - 1 && i <= vb + 1;
    this.geo = { L, bw, a: va, fa, pw, pe: pw - padR, H, top0: 8, mainH };
    const pe = pw - padR; // K 棒、均線、指標都只畫到這裡；右邊那一條留給籌碼分佈（不然往左拖時，右邊的均線還在、K 棒卻被分佈蓋住）
    { const vt = 8 + mainH + gap, st = o.noVol ? vt : vt + volH + gap; this.panes = [{ key: "main", top: 8, h: mainH }, ...(o.noVol ? [] : [{ key: "vol", top: vt, h: volH }]), ...subs.map((_, k) => ({ key: "s" + k, top: st + k * (subH + gap), h: subH }))]; }
    this.syncBar();
    const X = i => L + bw * (i - fa + 0.5);
    if (this.zoomedK !== !!this.view) { this.zoomedK = !!this.view; this.bar.classList.toggle("zoomed", this.zoomedK); }
    const top0 = 8, volTop = top0 + mainH + gap, subTop0 = o.noVol ? volTop : volTop + volH + gap; this.paneInv = [];
    const fmtD = o.fmtD || (s => s.slice(5).replace("-", "/"));
    const MA_COL = { 5: col.s1, 10: cssVar("--ma10") || col.accent, 20: col.s2, 60: col.s3 };
    const mas = (o.ma || []).map((n, k) => ({ n, a: I.ma(n), c: (this.cfgOn !== false && !o.maPlain && maColor(n, col)) || MA_COL[n] || [col.s1, col.s2, col.s3][k % 3] }));
    const F = o.future; // { from, p10, p25, p50, p75, p90 }：模擬區的機率帶

    // 比較其他股票：以「基準日」那根為 0%，換算成同樣的漲跌幅畫在價格座標上（at：該日或之前最近的收盤）。
    // 基準日在開始比較（或換了比較的股票、K 線週期）時取畫面最左邊那根，之後左右拖曳都不變，比較線不會跟著上下浮動
    const cmpKey = (o.compare || []).map(cp => cp.name).join("|");
    if (!o.compare?.length) this.cmpBase = null;
    else if (!this.cmpBase || this.cmpBase.key !== cmpKey || !D.some(x => x.d === this.cmpBase.d)) this.cmpBase = { key: cmpKey, d: D[Math.max(0, va)].d };
    const bi = this.cmpBase ? Math.max(0, D.findIndex(x => x.d === this.cmpBase.d)) : 0;
    const cmpS = (o.compare || []).map(cp => {
      const ds = cp.pts, at = d => { let lo = 0, hi = ds.length - 1, r = -1; const key = String(d).slice(0, 10); while (lo <= hi) { const m = (lo + hi) >> 1; if (ds[m][0] <= key) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? ds[r][1] : null; };
      const base = at(D[bi].d); return base ? { ...cp, at, k: D[bi].c / base } : null;
    }).filter(Boolean);
    // 價格範圍
    let lo = Infinity, hi = -Infinity;
    for (let i = va; i < Math.min(vis, vb + 1); i++) {
      lo = Math.min(lo, D[i].l); hi = Math.max(hi, D[i].h);
      for (const cp of cmpS) { const v = cp.at(D[i].d); if (v != null) { lo = Math.min(lo, v * cp.k); hi = Math.max(hi, v * cp.k); } }
      if (o.boll && I.boll.up[i] != null) { lo = Math.min(lo, I.boll.lo[i]); hi = Math.max(hi, I.boll.up[i]); }
      if (o.vwap && I.vwap[i] != null) { lo = Math.min(lo, I.vwap[i]); hi = Math.max(hi, I.vwap[i]); }
      for (const id of o.mainX || []) { const M = mainXCalc(id, D, I, this.cfgOn !== false); for (const [, a] of M.vals) { const v = a[i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } }
      if (F && i >= F.from) { lo = Math.min(lo, F.p25[i - F.from]); hi = Math.max(hi, F.p75[i - F.from]); } // 外圈機率帶超出就裁掉，真實 K 棒才不會被壓扁
    }
    // 對數座標：用 log(價格) 決定高度；縱向放大：以中間為準把價格範圍縮小，可上下平移（yoff）
    const logS = Chart.prefs.log && lo > 0, tf = logS ? Math.log : v => v, itf = logS ? Math.exp : v => v;
    let tlo = tf(lo), thi = tf(hi); const tpad = (thi - tlo) * 0.08 || Math.abs(thi) * 0.01 || 1; tlo -= tpad; thi += tpad;
    // 價格軸拉長（yz > 1）時：預設「跟著最右邊那根 K 棒」——以它的高低點為中心，拖曳左右平移時也一直跟著，K 棒不會跑出畫面；
    // 使用者手動上下平移過（yfree）就改用 yoff，回到 1× 或換資料時恢復跟隨
    this.ybase = { lo: tlo, hi: thi }; // 拉長前的價格範圍（雙指拉長時算錨點用）
    if (this.yz <= 1 && this.yfree) { this.yfree = false; this.yoff = 0; }
    if (this.yz !== 1 || this.yoff) {
      const sp = thi - tlo, half = sp / this.yz / 2; let mid = (tlo + thi) / 2 + this.yoff * sp;
      if (this.yz > 1 && !this.yfree) { const li = Math.max(va, Math.min(vis - 1, vb)), k = D[li]; if (k) { const c = (tf(k.h) + tf(k.l)) / 2; mid = Math.min(thi - half, Math.max(tlo + half, c)); } }
      if (this.yz > 1) this.ymid = { off: (mid - (tlo + thi) / 2) / sp }; // 手動平移時從目前位置接著拖
      tlo = mid - half; thi = mid + half;

    }
    // 拖曳、縮放時價格軸不要一下跳到新範圍：每個畫面往目標靠近 30%，靠近了才停（看起來是平順地伸縮，不會上下抖）
    if (this.ysm && this.smoothY) { const k = 0.3, nlo = this.ysm.lo + (tlo - this.ysm.lo) * k, nhi = this.ysm.hi + (thi - this.ysm.hi) * k;
      if (Math.abs(nlo - tlo) + Math.abs(nhi - thi) > (thi - tlo) * 0.002) { tlo = nlo; thi = nhi; this.needY = true; } else this.smoothY = this.ptrs.size > 0 || !!this.glide; }
    this.ysm = { lo: tlo, hi: thi };
    lo = itf(tlo); hi = itf(thi);
    const Y = p => top0 + (thi - tf(p)) / (thi - tlo) * mainH;
    this.geo.pAt = y => (y < top0 || y > top0 + mainH ? null : itf(thi - (y - top0) / mainH * (thi - tlo))); /* 主圖高度 → 價格（Y 的反函數） */

    ctx.font = `11px ${cssVar("--font-num")}`; ctx.textBaseline = "middle";
    // 未揭曉區
    if (vis < n || o.cutoff != null) {
      const cx = Math.max(L, X((o.cutoff ?? vis) - 0.5));
      ctx.fillStyle = col.shade; ctx.fillRect(cx, top0, L + pw - cx, H - top0 - axisH - 8);
      ctx.strokeStyle = col.muted; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx, top0); ctx.lineTo(cx, H - axisH - 8); ctx.stroke(); ctx.setLineDash([]);
      if (vis < n) { ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.font = `13px ${cssVar("--font-body")}`; ctx.fillText("？", (cx + L + pw) / 2, top0 + mainH / 2); ctx.font = `11px ${cssVar("--font-num")}`; }
    }
    // 格線 + 價格座標
    const step = niceStep((hi - lo) / 5);
    ctx.textAlign = "left";
    // 籌碼分佈（Volume Profile）：疊在主圖右側、半透明；用畫面最右邊那根 K 棒往前 120 根計算，平移時跟著更新
    const VP = this.vpData = o.vp ? costDist(D, Math.min(vis, vb + 1) - 1, o.vpN || 120, 70) : null;
    // 價格軸上的壓力／均成本／支撐標籤先排好位置（彼此不重疊），格線的價格字碰到標籤就不寫
    const vpTags = [];
    if (VP) [[VP.pre, "#f0883e"], [VP.avg, "#8b8f98"], [VP.sup, "#3b82f6"]].filter(([v]) => v != null).map(([v, c]) => [v, c, Y(v)]).sort((a, b) => a[2] - b[2])
      .forEach(([v, c, y]) => { if (y < top0 + 6 || y > top0 + mainH - 6) return; const pv = vpTags.at(-1); if (pv && y < pv.y + 17) y = pv.y + 17; vpTags.push({ v, c, y }); });
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v); ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(L + pw, Math.round(y) + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
      if (!vpTags.some(t => Math.abs(t.y - y) < 13)) { ctx.fillStyle = col.muted; ctx.fillText(fmtP(v), L + pw + 6, y); }
    }
    if (VP) {
      const mx = Math.max(...VP.w), maxW = vpW, bh = Math.max(1, Math.abs(Y(VP.mids[0]) - Y(VP.mids[0] + VP.step)));
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pw, mainH); ctx.clip();
      // 70% 籌碼區間的底色
      // 70% 籌碼區間：左側一條細括號線（不塗底色，深色主題才不會出現一塊白色半透明）
      const y70a = Y(VP.r70[1]), y70b = Y(VP.r70[0]), bx = L + pw - maxW - 4; ctx.strokeStyle = col.muted; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 3, y70a); ctx.lineTo(bx, y70a); ctx.lineTo(bx, y70b); ctx.lineTo(bx + 3, y70b); ctx.stroke();
      VP.w.forEach((x, k) => { const y = Y(VP.mids[k] + VP.step / 2), wd = x / mx * maxW; ctx.fillStyle = VP.mids[k] <= VP.px ? col.up : col.down; ctx.globalAlpha = VP.mids[k] <= VP.px ? 0.2 : 0.15; ctx.fillRect(L + pw - wd, y, wd, Math.max(1, bh - 0.6)); });
      ctx.globalAlpha = 1;
      const tag = (v, c, t) => { if (v == null) return; const y = Y(v); if (y < top0 || y > top0 + mainH) return; ctx.strokeStyle = c; ctx.lineWidth = 0.8; ctx.setLineDash(t === "均" ? [5, 3] : []); ctx.beginPath(); ctx.moveTo(L + pw - maxW - 8, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); };
      tag(VP.pre, "#f0883e", "壓"); tag(VP.avg, col.muted, "均"); tag(VP.sup, "#4e9af1", "撐");
      ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L + pe + 3.5, top0); ctx.lineTo(L + pe + 3.5, top0 + mainH); ctx.stroke(); // K 棒區和分佈欄的分隔線
      ctx.restore();
      // 右側價格軸上的標籤（橘＝壓力、灰＝平均成本、藍＝支撐）
      ctx.font = `500 10.5px ${cssVar("--font-num")}`; ctx.textAlign = "left";
      vpTags.forEach(({ v, c, y }) => { const t = fmtP(v), tw = ctx.measureText(t).width + 8; ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(L + pw + 2, y - 8, tw, 16, 3) : ctx.rect(L + pw + 2, y - 8, tw, 16); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(t, L + pw + 6, y); });
      ctx.font = `11px ${cssVar("--font-num")}`;
    }
    // 布林
    if (o.boll) {
      const { up, lo: lw, mid } = I.boll;
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
      ctx.fillStyle = col.band; ctx.beginPath(); let started = false;
      for (let i = 0; i < vis; i++) if (up[i] != null) { started ? ctx.lineTo(X(i), Y(up[i])) : ctx.moveTo(X(i), Y(up[i])); started = true; }
      for (let i = vis - 1; i >= 0; i--) if (lw[i] != null) ctx.lineTo(X(i), Y(lw[i]));
      ctx.fill(); ctx.restore();
      const bc = this.lc("boll", 0, "accent", col); this.line(up, vis, X, Y, bc, 1, 0.7); this.line(lw, vis, X, Y, bc, 1, 0.7); this.line(mid, vis, X, Y, bc, 1, 0.45, [3, 3]);
    }
    // 延伸疊加：一目均衡表雲帶（先行帶 A 在上偏多＝紅、B 在上偏空＝綠）、各條線、SAR 點
    for (const id of o.mainX || []) {
      const M = mainXCalc(id, D, I, this.cfgOn !== false);
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
      if (M.cloud) { const [A, B] = M.cloud; for (let i = Math.max(1, va); i < Math.min(vis, vb + 2); i++) { if ([A[i], B[i], A[i - 1], B[i - 1]].some(v => v == null)) continue;
          ctx.fillStyle = A[i] >= B[i] ? col.up : col.down; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(X(i - 1), Y(A[i - 1])); ctx.lineTo(X(i), Y(A[i])); ctx.lineTo(X(i), Y(B[i])); ctx.lineTo(X(i - 1), Y(B[i - 1])); ctx.closePath(); ctx.fill(); }
        ctx.globalAlpha = 1; this.line(A, vis, X, Y, col.up, 0.8, 0.6); this.line(B, vis, X, Y, col.down, 0.8, 0.6); }
      // ahead：這條線用到之後 ahead 根的資料（遲行線），只畫到看得到的範圍，判讀挑戰不會洩漏答案
      (M.lines || []).forEach(([a, c, w, dash, ahead, slot]) => this.line(ahead ? a.map((v, i) => (i + ahead < vis ? v : null)) : a, vis, X, Y, (slot != null && indColor(id, slot, this.cfgOn)) || col[c] || col.accent, w, 0.95, dash));
      if (M.dots) { const r = Math.max(1.7, Math.min(3, bw * 0.22)); for (let i = Math.max(0, va); i < Math.min(vis, vb + 1); i++) { const d = M.dots[i]; if (!d) continue; ctx.fillStyle = d.up ? col.up : col.down; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X(i), Y(d.p), r, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
      ctx.restore();
    }
    // 支撐壓力
    (o.hlines || []).forEach(h => {
      const y = Y(h.price); if (y < top0 - 1 || y > top0 + mainH + 1) return; const c = h.color ? col[h.color] || h.color : h.kind === "壓力" ? col.down : col.up;
      ctx.strokeStyle = c; ctx.setLineDash([6, 4]); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(Math.max(L, X(h.i ?? 0)), y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]);
      const t = h.label || `${h.kind} ${fmtP(h.price)}`; ctx.textAlign = "right"; ctx.font = `11px ${cssVar("--font-body")}`; const tw = ctx.measureText(t).width; ctx.fillStyle = col.surface; ctx.globalAlpha = 0.85; ctx.fillRect(L + pw - 6 - tw, y - 19, tw + 4, 14); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, L + pw - 4, y - 8); ctx.font = `11px ${cssVar("--font-num")}`;
    });
    // 區塊（訂單塊、公平價值缺口）：畫在 K 棒後面，只畫到目前可見的範圍
    const cmap = { up: col.up, down: col.down, accent: col.accent, muted: col.muted, s2: col.s2, ink: col.ink };
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
    (o.zones || []).filter(z => z.at == null || z.at < vis).forEach(z => {
      const x1 = X(z.i1) - bw / 2, x2 = X(Math.min(z.i2, vis - 1)) + bw / 2, y1 = Y(z.top), y2 = Y(z.bot), c = z.color ? cmap[z.color] : z.dir > 0 ? col.up : col.down;
      ctx.fillStyle = c; ctx.globalAlpha = z.alpha ?? (z.kind === "FVG" ? 0.08 : 0.16); ctx.fillRect(x1, y1, x2 - x1, Math.max(2, y2 - y1)); ctx.globalAlpha = z.alpha != null ? Math.min(0.7, z.alpha * 4) : 0.7;
      ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(z.kind === "FVG" ? [3, 3] : []); ctx.strokeRect(x1, y1, x2 - x1, Math.max(2, y2 - y1)); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (x2 - x1 > 22) { ctx.fillStyle = c; ctx.textAlign = "left"; ctx.font = `500 10px ${cssVar("--font-body")}`; ctx.fillText(z.kind, x1 + 3, Math.max(y1, Math.min(y2, y1 + 7))); ctx.font = `11px ${cssVar("--font-num")}`; }
    });
    ctx.restore();
    // 模擬區：底色、機率帶（10–90%、25–75%）、中位數
    if (F) {
      const fx = Math.max(L, X(F.from - 0.5));
      ctx.fillStyle = col.shade; ctx.fillRect(fx, top0, L + pw - fx, mainH);
      ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
      const band = (a, b, alpha) => { ctx.fillStyle = col.accent; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(X(F.from - 1), Y(D[F.from - 1].c)); a.forEach((v, t) => ctx.lineTo(X(F.from + t), Y(v))); for (let t = b.length - 1; t >= 0; t--) ctx.lineTo(X(F.from + t), Y(b[t])); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; };
      band(F.p90, F.p10, 0.1); band(F.p75, F.p25, 0.16);
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(F.from - 1), Y(D[F.from - 1].c)); F.p50.forEach((v, t) => ctx.lineTo(X(F.from + t), Y(v))); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle = col.accent; ctx.textAlign = "left"; ctx.font = `500 11px ${cssVar("--font-body")}`; if (fx < L + pw - 40) ctx.fillText("模擬", fx + 6, top0 + 10); ctx.font = `11px ${cssVar("--font-num")}`;
    }
    // K 棒以下到標記為止都裁在價格區內（縱向放大時才不會畫到成交量區）
    ctx.save(); ctx.beginPath(); ctx.rect(0, top0, L + pe + 1, mainH); ctx.clip();
    const cw = Math.max(1, Math.min(14, bw * 0.66)), KT = o.ktype || Chart.prefs.kt, i0 = Math.max(0, va), i1 = Math.min(vis, vb + 1);
    if (KT === "line" || KT === "area") {
      // 收盤線／面積圖：只連收盤價
      const lc = D[i1 - 1] && D[i0] && D[i1 - 1].c >= D[i0].c ? col.up : col.down;
      if (KT === "area") { ctx.fillStyle = col.accent; ctx.globalAlpha = 0.14; ctx.beginPath(); for (let i = i0; i < i1; i++) i === i0 ? ctx.moveTo(X(i), Y(D[i].c)) : ctx.lineTo(X(i), Y(D[i].c)); ctx.lineTo(X(i1 - 1), top0 + mainH); ctx.lineTo(X(i0), top0 + mainH); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = KT === "area" ? col.accent : lc; ctx.lineWidth = 1.1; ctx.beginPath(); for (let i = i0; i < i1; i++) i === i0 ? ctx.moveTo(X(i), Y(D[i].c)) : ctx.lineTo(X(i), Y(D[i].c)); ctx.stroke();
    } else for (let i = i0; i < i1; i++) {
      const k = D[i], x = X(i), rising = k.c > k.o, upc = rising ? col.up : k.c < k.o ? col.down : col.ink;
      ctx.globalAlpha = k.sim ? 0.5 : 1;
      ctx.strokeStyle = upc; ctx.fillStyle = upc; ctx.lineWidth = 1;
      const xm = Math.round(x) + 0.5;
      if (KT === "ohlc") {
        // 美國線：高低一條直線，左邊短橫線是開盤、右邊是收盤
        const t = Math.max(2, Math.round(cw / 2)); ctx.lineWidth = bw > 6 ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, Y(k.l)); ctx.moveTo(xm - t, Math.round(Y(k.o)) + 0.5); ctx.lineTo(xm, Math.round(Y(k.o)) + 0.5); ctx.moveTo(xm, Math.round(Y(k.c)) + 0.5); ctx.lineTo(xm + t, Math.round(Y(k.c)) + 0.5); ctx.stroke();
        continue;
      }
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)), bx = Math.round(x - cw / 2), bwid = Math.max(1, Math.round(cw)), bh = Math.max(1, y2 - y1);
      if (KT === "hollow" && k.c !== k.o && bwid >= 3) {
        // 空心 K 線：紅、綠 K 的實體都只畫外框（顏色照漲跌），影線不穿過實體
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, y1); ctx.moveTo(xm, y1 + bh); ctx.lineTo(xm, Y(k.l)); ctx.stroke();
        ctx.strokeRect(bx + 0.5, Math.round(y1) + 0.5, bwid - 1, Math.max(1, Math.round(bh) - 1));
      } else {
        ctx.beginPath(); ctx.moveTo(xm, Y(k.h)); ctx.lineTo(xm, Y(k.l)); ctx.stroke();
        ctx.fillRect(bx, y1, bwid, bh);
      }
    }
    ctx.globalAlpha = 1;
    this.cmpNow = [];
    cmpS.forEach(cp => {
      ctx.strokeStyle = cp.color; ctx.lineWidth = 1; ctx.beginPath(); let st = false;
      for (let i = i0; i < i1; i++) { const v = cp.at(D[i].d); if (v == null) continue; const y = Y(v * cp.k); st ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); st = true; }
      ctx.stroke();
      const v = cp.at(D[Math.min(this.hover ?? i1 - 1, i1 - 1)].d); this.cmpNow.push({ name: cp.name, color: cp.color, pct: v ? (v * cp.k / D[bi].c - 1) * 100 : null });
    });
    if (cmpS.length) { const hv = Math.min(this.hover ?? i1 - 1, i1 - 1); this.cmpSelf = (D[hv].c / D[bi].c - 1) * 100; this.cmpBaseD = D[bi].d; }
    // 均線
    mas.forEach(m => this.line(m.a, vis, X, Y, m.c, 1.6));
    if (o.vwap) this.line(I.vwap, vis, X, Y, this.lc("vwap", 0, "vwap", col), 1.8);
    // 折線、頸線、目標價、結構線（可來自設定或附在標記上；只畫到可見範圍）
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
    [...(o.shapes || []), ...(o.markers || []).filter(m => m.i < vis).flatMap(m => m.shapes || [])].forEach(sh => {
      if (!sh.pts?.length || sh.pts[0][0] >= vis) return;
      if (sh.pts.length < 40) { let a = Infinity, b = -Infinity; for (const [i] of sh.pts) { if (i < a) a = i; if (i > b) b = i; } if (b < va - 2 || a > vb + 2) return; } // 整條都在畫面外：不畫（滑動時每一格都要跑）
      const pts = sh.pts.map(([i, p]) => [vis < n ? Math.min(i, vis - 1) : i, p]);
      const c = cmap[sh.color] || col.accent;
      ctx.strokeStyle = c; ctx.lineWidth = (sh.width || 1.5) * 0.7; ctx.setLineDash(sh.dash || []); ctx.beginPath();
      pts.forEach(([i, p], k) => { const x = X(Math.min(i, n - 1)) + (i > n - 1 ? (i - n + 1) * bw : 0); k ? ctx.lineTo(x, Y(p)) : ctx.moveTo(x, Y(p)); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c; ctx.font = `500 10.5px ${cssVar("--font-body")}`;
      if (sh.label) { const [i, p] = pts[pts.length - 1]; ctx.textAlign = "right"; ctx.fillText(sh.label, Math.min(X(Math.min(i, vis - 1)), L + pw - 2), Y(p) - 6); }
      (sh.tags || []).filter(t => t.i < vis).forEach(t => { ctx.textAlign = "center"; ctx.fillText(t.text, X(t.i), Y(t.p) + (t.below ? 13 : -7)); });
      ctx.font = `11px ${cssVar("--font-num")}`;
    });
    ctx.restore();
    // 背離連線：價格圖上連兩個轉折點，副圖顯示同一指標時也連起來
    const divs = (o.markers || []).filter(m => m.div && m.i < vis);
    // 一組價格轉折可能同時是好幾個指標的背離（m.divs）：價格線畫一次，每個副圖各畫自己的
    const subDivs = divs.flatMap(m => (m.divs || [m.div]).map(d => ({ d, side: m.side })));
    const divLine = (x1, y1, x2, y2, c) => { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); [[x1, y1], [x2, y2]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b, 3, 0, Math.PI * 2); ctx.fill(); }); };
    ctx.save(); ctx.beginPath(); ctx.rect(L, top0, pe, mainH); ctx.clip();
    divs.forEach(m => divLine(X(m.div.i1), Y(m.div.p1), X(m.div.i2), Y(m.div.p2), m.side === "buy" ? col.up : col.down));
    ctx.restore();
    // 標記
    const showLabels = o.labels !== false && bw >= 2.5 && Chart.prefs.mk !== "icon";
    const placed = [];
    // 文字標籤不能壓到 K 棒：找出標籤橫跨的那幾根 K 棒，買進訊號往下推到它們的最低點以下、賣出訊號往上推到最高點以上；推出主圖範圍就不畫字（滑到那根 K 棒時圖例會顯示）
    const clearY = (tx, tw, ty, down) => {
      const i0 = Math.max(va, Math.floor((tx - tw / 2 - L) / bw + va - 0.5)), i1 = Math.min(Math.min(vis, vb + 1) - 1, Math.ceil((tx + tw / 2 - L) / bw + va - 0.5));
      let ext = down ? -Infinity : Infinity; for (let i = i0; i <= i1; i++) { const k = D[i]; if (!k) continue; ext = down ? Math.max(ext, Y(k.l)) : Math.min(ext, Y(k.h)); }
      const y = down ? Math.max(ty, ext + 9) : Math.min(ty, ext - 8);
      return y > top0 + mainH - 5 || y < top0 + 6 ? null : y;
    };
    const label = (t, tx, ty, c, size) => { ctx.font = `500 ${size}px ${cssVar("--font-body")}`; ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = col.surface; ctx.globalAlpha = 0.85; ctx.strokeText(t, tx, ty); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, tx, ty); };
    // 副圖訊號：在副圖上交叉或離開超買超賣區的那一天，主圖K線也標出來（空心圈，和實心三角的課程／策略訊號區分）
    // 副圖訊號只跟資料、副圖和開關有關，和畫面範圍無關：同一組條件只算一次（滑動時不用每一格重算）
    const sigOn = Chart.prefs.sig && o.subSignals !== false, sigShow = sigOn ? Object.fromEntries(Chart.SIG_KINDS.map(([k]) => [k, Chart.sigShow(k)])) : null;
    const sigKey = sigOn ? JSON.stringify([subs.map(S => (typeof S === "string" ? S : S.id || S.custom?.title || "c")), vis, sigShow, Chart.prefs.sigStrongK]) : "";
    if (!sigOn) this.sigMemo = null; else if (!this.sigMemo || this.sigMemo.D !== D || this.sigMemo.I !== I || this.sigMemo.k !== sigKey) this.sigMemo = { D, I, k: sigKey, v: subSignals(D, I, subs, vis, sigShow, Chart.prefs.sigStrongK) };
    const sigs = this.sigs = sigOn ? this.sigMemo.v : [];
    (o.markers || []).filter(m => m.i < vis && m.i >= va && m.i <= vb).forEach(m => {
      const k = D[m.i], x = X(m.i), buy = m.side === "buy", c = m.note ? col.accent : buy ? col.up : col.down;
      const y = buy ? Y(k.l) + 8 : Y(k.h) - 8, s = 5;
      ctx.globalAlpha = m.dim ? 0.3 : 1; // 回測中被略過的訊號畫淡一點
      ctx.globalAlpha = (m.dim ? 0.3 : 1) * 0.9; ctx.fillStyle = c; ctx.beginPath();
      if (buy) { ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.5); ctx.lineTo(x + s, y + s * 1.5); }
      else { ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.5); ctx.lineTo(x + s, y - s * 1.5); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = m.dim ? 0.3 : 1;
      if (showLabels && m.label) {
        // 標籤互相重疊或會壓到 K 棒時改位置；放不下就不畫字（三角形照畫）
        ctx.font = `500 10.5px ${cssVar("--font-body")}`; const tw = ctx.measureText(m.label).width;
        const tx = Math.min(Math.max(x, L + tw / 2 + 2), L + pw - tw / 2 - 2), ty = clearY(tx, tw, buy ? y + s * 1.5 + 9 : y - s * 1.5 - 8, buy);
        if (ty != null && !placed.some(q => Math.abs(q.x - tx) < (q.w + tw) / 2 + 4 && Math.abs(q.y - ty) < 13)) { label(m.label, tx, ty, c, 10.5); placed.push({ x: tx, y: ty, w: tw }); }
        ctx.font = `11px ${cssVar("--font-num")}`;
      }
      ctx.globalAlpha = 1;
    });
    // 同一天同方向的副圖訊號疊在一起：圈畫一次，標籤合併（例如「KD金叉・MACD金叉」）
    const sigAt = new Map(); sigs.filter(g => g.i >= va && g.i <= vb).forEach(g => { const k = g.i + g.side; sigAt.has(k) ? sigAt.get(k).push(g) : sigAt.set(k, [g]); });
    const marked = new Set((o.markers || []).map(m => m.i + m.side));
    // 副圖訊號：在那根 K 棒下方（偏多）或上方（偏空）畫半透明圓圈，再用虛線連到副圖上的訊號點；名稱在十字線停到那一天時顯示
    this.sigLinks = [];
    sigAt.forEach(gs => {
      if (marked.has(gs[0].i + gs[0].side)) return; // 同一天已有同方向的課程／策略標記（通常就是同一個訊號），不重複畫
      const g = gs[0], k = D[g.i], x = X(g.i), buy = g.side === "buy", c = buy ? col.up : col.down, r = Math.max(3, Math.min(5, bw * 0.45));
      const y = Math.max(top0 + r + 2, Math.min(top0 + mainH - r - 2, buy ? Y(k.l) + r + 5 : Y(k.h) - r - 5)), on = this.hover === g.i;
      ctx.fillStyle = c; ctx.globalAlpha = on ? 0.4 : 0.16; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.globalAlpha = on ? 1 : 0.6; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      if (gs.length > 1) { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
      this.sigLinks.push({ i: g.i, side: g.side, x, y: buy ? y + r : y - r, c, on });
      if (on && Chart.prefs.mk !== "icon") { const t = gs.map(q => q.label).join("・"); ctx.font = `500 10px ${cssVar("--font-body")}`; const tw = ctx.measureText(t).width, tx = Math.min(Math.max(x, L + tw / 2 + 2), L + pw - tw / 2 - 2); label(t, tx, buy ? y + r + 12 : y - r - 6, c, 10); ctx.font = `11px ${cssVar("--font-num")}`; }
    });

    ctx.restore();
    if (logS || this.yz !== 1) { ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `10px ${cssVar("--font-body")}`; ctx.fillText([logS ? "對數座標" : "", this.yz !== 1 ? `價格軸 ${+this.yz.toFixed(1)}×` : ""].filter(Boolean).join("・"), L + 4, top0 + mainH - 8); ctx.font = `11px ${cssVar("--font-num")}`; }
    // 成交量
    if (!o.noVol) {
    let vmax = 1; for (let i = va; i < Math.min(vis, vb + 1); i++) vmax = Math.max(vmax, D[i].v);
    { const vzz = this.paneZoom("vol"); vmax /= vzz.z; } // 成交量放大：從底部往上拉長
    ctx.save(); ctx.beginPath(); ctx.rect(0, volTop, W, volH); ctx.clip();
    ctx.globalAlpha = 0.6;
    for (let i = va; i < Math.min(vis, vb + 1); i++) { const k = D[i]; if (k.sim) continue; ctx.fillStyle = k.c >= k.o ? col.up : col.down; const h = k.v / vmax * (volH - 4); ctx.fillRect(Math.round(X(i) - cw / 2), volTop + volH - h, Math.max(1, Math.round(cw)), h); }
    ctx.globalAlpha = 1;
    this.line(I.vma, vis, X, v => volTop + volH - v / vmax * (volH - 4), col.muted, 1);
    ctx.restore();
    ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `11px ${cssVar("--font-body")}`; ctx.fillText(o.volLabel || "量（張）", L + pw + 6, volTop + 6); ctx.font = `11px ${cssVar("--font-num")}`;
    ctx.strokeStyle = col.line; ctx.beginPath(); ctx.moveTo(L, volTop - gap / 2); ctx.lineTo(L + pw, volTop - gap / 2); ctx.stroke();
    }

    // 副圖（可多個，由上往下排）
    subs.forEach((S, si) => {
      const sub = typeof S === "string" ? S : "custom", C0 = typeof S === "string" ? null : S.custom, subTop = subTop0 + si * (subH + gap);
      ctx.strokeStyle = col.line; ctx.beginPath(); ctx.moveTo(L, subTop - gap / 2); ctx.lineTo(L + pw, subTop - gap / 2); ctx.stroke();
      // 副圖縮放：手動倍數（pz）＋「自動貼合資料」；以可見資料的中心為準，所以 KD 停在高檔時也不會被放大到畫面外
      const pzz = this.paneZoom("s" + si);
      const Z = (sy0, series) => {
        let a = Infinity, b = -Infinity;
        series.forEach(arr => { if (!arr) return; for (let i = Math.max(0, va); i < Math.min(vis, vb + 1, arr.length); i++) { const v = arr[i]; if (v == null) continue; const y = sy0(v); if (y < a) a = y; if (y > b) b = y; } });
        if (!isFinite(a)) return sy0;
        let z = pzz.z; if (Chart.prefs.fit) z *= Math.max(1, Math.min(8, (subH - 14) / Math.max(4, b - a)));
        if (z === 1 && !pzz.off) return sy0;
        const c = (a + b) / 2, mid = subTop + subH / 2 + pzz.off * subH;
        return v => mid + (sy0(v) - c) * z;
      };
      ctx.save(); ctx.beginPath(); ctx.rect(0, subTop, W, subH); ctx.clip();
      const lvl = (v, sy) => { const y = sy(v); if (y < subTop - 2 || y > subTop + subH + 2) return; ctx.strokeStyle = col.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.fillText(String(v), L + pw + 6, y); };
      if (sub === "rsi" || sub === "kd") {
        const sy = Z(v => subTop + (100 - v) / 100 * subH, sub === "rsi" ? [I.rsi] : [I.kd.K, I.kd.D]); this.subY = sy;
        const [a, b] = sub === "rsi" ? [70, 30] : [80, 20];
        ctx.fillStyle = col.band; ctx.fillRect(L, sy(100), pw, sy(a) - sy(100)); ctx.fillRect(L, sy(b), pw, sy(0) - sy(b));
        lvl(a, sy); lvl(b, sy);
        if (sub === "rsi") { this.line(I.rsi, vis, X, sy, this.lc("rsi", 0, "s2", col), 1.5); indExtras("rsi", this.cfgOn).forEach((e, j) => this.line(extraSeries("rsi", D, I, e.n), vis, X, sy, e.c || EXTRA_PAL[j % 6], 1.2)); }
        else { this.line(I.kd.K, vis, X, sy, this.lc("kd", 0, "s1", col), 1.5); this.line(I.kd.D, vis, X, sy, this.lc("kd", 1, "s3", col), 1.5); }
      } else if (sub === "wr") {
        const sy = Z(v => subTop + (-v) / 100 * subH, [I.wr]);
        ctx.fillStyle = col.band; ctx.fillRect(L, sy(0), pw, sy(-20) - sy(0)); ctx.fillRect(L, sy(-80), pw, sy(-100) - sy(-80));
        lvl(-20, sy); lvl(-80, sy);
        this.line(I.wr, vis, X, sy, this.lc("wr", 0, "s2", col), 1.5); indExtras("wr", this.cfgOn).forEach((e, j) => this.line(extraSeries("wr", D, I, e.n), vis, X, sy, e.c || EXTRA_PAL[j % 6], 1.2)); this.subY = sy;
      } else if (sub === "inout" && I.io) {
        let m = 5; for (let i = Math.max(0, va); i < Math.min(vis, vb + 1); i++) m = Math.max(m, Math.abs(I.io[i] - 50));
        const sy = Z(v => subTop + subH / 2 - (v - 50) / m * (subH / 2 - 4), [I.io, I.io5]);
        ctx.globalAlpha = 0.55;
        for (let i = va; i < Math.min(vis, vb + 1); i++) { const v = I.io[i]; ctx.fillStyle = v >= 50 ? col.up : col.down; const y0 = sy(50), y1 = sy(v); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.max(1, Math.abs(y1 - y0))); }
        ctx.globalAlpha = 1; lvl(50, sy);
        this.line(I.io5, vis, X, sy, col.s1, 1.5); this.subY = sy;
      } else if (sub === "custom") {
        // 截圖讀出的副圖：值域依資料自動決定
        // 值域用畫面上看得到的那一段（OBV、ADL 這種累計值，整段歷史的範圍會把最近的線壓平）
        const C = C0, win = a => (a || []).slice(Math.max(0, va), Math.min(vis, vb + 1)), vals = [...C.lines.flatMap(win), ...win(C.bars), ...win(C.boxes).flatMap(x => (x ? [x.t, x.b] : []))].filter(v => v != null);
        let lo = C.range ? C.range[0] : Math.min(...vals, C.bars ? 0 : Infinity), hi = C.range ? C.range[1] : Math.max(...vals, C.bars ? 0 : -Infinity);
        if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; } if (hi === lo) { hi += 1; lo -= 1; }
        const sy = Z(v => subTop + 4 + (hi - v) / (hi - lo) * (subH - 8), [...C.lines, ...(C.bars ? [C.bars] : [])]);
        (C.levels || []).forEach(v => lvl(v, sy));
        if (C.bars) { ctx.globalAlpha = 0.55; C.bars.forEach((v, i) => { if (i >= vis || !v || !inV(i)) return; ctx.fillStyle = C.barColor ? col[C.barColor] : v >= 0 ? col.up : col.down; const y0 = sy(0), y1 = sy(v); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.max(1, Math.abs(y1 - y0))); }); ctx.globalAlpha = 1; if (C.zeroLine) lvl(0, sy); }
        if (C.boxes) for (let i = Math.max(0, va); i < Math.min(vis, vb + 1); i++) { const x = C.boxes[i]; if (!x) continue; const y0 = sy(x.t), y1 = sy(x.b), w = Math.max(2, Math.round(cw)); ctx.fillStyle = x.up ? col.up : col.down; ctx.globalAlpha = x.flip ? 0.95 : 0.7; ctx.fillRect(Math.round(X(i) - w / 2), Math.min(y0, y1), w, Math.max(1, Math.abs(y1 - y0))); ctx.globalAlpha = 1; }
        C.lines.forEach((a, k) => this.line(a, vis, X, sy, this.subColor(S, k, col), k >= (C.nBase ?? 99) ? 1.2 : 1.5));
        // 第二組線（例如累計買超、融資餘額）用自己的刻度，數值標在右側
        if (C.lines2) {
          const v2 = C.lines2.flatMap(win).filter(v => v != null); let lo2 = Math.min(...v2), hi2 = Math.max(...v2); if (!v2.length) { lo2 = 0; hi2 = 1; } if (hi2 === lo2) { hi2 += 1; lo2 -= 1; }
          const sy2 = Z(v => subTop + 4 + (hi2 - v) / (hi2 - lo2) * (subH - 8), C.lines2);
          C.lines2.forEach((a, k) => this.line(a, vis, X, sy2, [col.s2, col.accent][k % 2], 1.5));
          ctx.fillStyle = col.muted; ctx.textAlign = "left"; const f2 = C.fmt || fmtN; ctx.fillText(f2(hi2), L + pw + 4, subTop + 10); ctx.fillText(f2(lo2), L + pw + 4, subTop + subH - 2);
        }
        this.subY = sy;
      } else if (sub === "macd") {
        const { dif, sig, osc } = I.macd; let m = 0;
        for (let i = Math.max(0, va); i < Math.min(vis, vb + 1); i++) if (dif[i] != null) m = Math.max(m, Math.abs(dif[i]), Math.abs(sig[i] ?? 0), Math.abs(osc[i] ?? 0)); // 用看得到的那段定刻度
        m = m || 1; const sy = Z(v => subTop + subH / 2 - v / m * (subH / 2 - 4), [dif, sig, osc]); this.subY = sy;
        lvl(0, sy);
        ctx.globalAlpha = 0.55;
        for (let i = va; i < Math.min(vis, vb + 1); i++) if (osc[i] != null) { ctx.fillStyle = osc[i] >= 0 ? col.up : col.down; const y0 = sy(0), y1 = sy(osc[i]); ctx.fillRect(Math.round(X(i) - cw / 2), Math.min(y0, y1), Math.max(1, Math.round(cw)), Math.abs(y1 - y0)); }
        ctx.globalAlpha = 1;
        this.line(dif, vis, X, sy, this.lc("macd", 0, "s1", col), 1.5); this.line(sig, vis, X, sy, this.lc("macd", 1, "s3", col), 1.5);
      }
      const subY = this.subY || (v => subTop + (100 - v) / 100 * subH);
      { const a0 = subY(0), a1 = subY(1); if (a1 !== a0 && isFinite(a0) && isFinite(a1)) this.paneInv.push({ top: subTop, bot: subTop + subH, inv: y => (y - a0) / (a1 - a0), fmt: C0?.fmt || (v => fmtN(v, Math.abs(v) < 10 ? 2 : 1)) }); }
      ctx.save(); ctx.beginPath(); ctx.rect(L, subTop, pe, subH); ctx.clip();
      // 鈍化區間：副圖底色淡淡塗上（高檔紅、低檔綠），寬度夠時標字
      if (Chart.sigShow("dull")) { const src = dullOf(S, I); if (src) dullSpans(src.a, src.hi, src.lo, 3, vis).forEach(sp => {
        const a0 = Math.max(va, sp.i0), a1 = Math.min(vb, (sp.end ?? vis) - 1); if (a1 < a0) return; const x0 = X(a0) - cw / 2, w = X(a1) - X(a0) + cw;
        ctx.fillStyle = sp.side > 0 ? col.up : col.down; ctx.globalAlpha = 0.1; ctx.fillRect(x0, subTop, w, subH);
        if (w > 44) { ctx.globalAlpha = 0.85; ctx.textAlign = "left"; ctx.font = `10px ${cssVar("--font-body")}`; ctx.fillText(sp.side > 0 ? "高檔鈍化" : "低檔鈍化", x0 + 3, sp.side > 0 ? subTop + 11 : subTop + subH - 4); }
        ctx.globalAlpha = 1; }); }
      subDivs.filter(x => x.d.ind === (typeof S === "string" ? S : S.id || "pane")).forEach(({ d, side }) => divLine(X(d.j1 ?? d.i1), subY(d.v1), X(d.j2 ?? d.i2), subY(d.v2), side === "buy" ? col.up : col.down));
      // 副圖上發出訊號的位置：半透明實心點；記下位置，等所有區塊畫完再用虛線連到主圖的圓圈
      sigs.filter(g => g.si === si && g.i >= va && g.i <= vb).forEach(g => {
        const x = X(g.i), y = subY(g.v), c = g.side === "buy" ? col.up : col.down, on = this.hover === g.i;
        ctx.fillStyle = c; ctx.globalAlpha = on ? 0.95 : 0.55; ctx.beginPath(); ctx.arc(x, y, on ? 4 : 3.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        const ln = (this.sigLinks || []).find(q => q.i === g.i && q.side === g.side); if (ln && ln.y2 == null) ln.y2 = y;
      });
      ctx.restore();
      ctx.restore(); // 副圖裁切結束
      ctx.fillStyle = col.muted; ctx.textAlign = "left"; ctx.font = `11px ${cssVar("--font-body")}`;
      const pp = id => indParams(id, this.cfgOn), xn = id => indExtras(id, this.cfgOn).map(e => "・" + e.n).join("");
      const ttl = sub === "custom" ? C0.title : { rsi: () => `RSI ${pp("rsi").n}${xn("rsi")}`, kd: () => { const q = pp("kd"); return q.k === 3 && q.d === 3 ? `KD ${q.n}` : `KD ${q.n}・${q.k}・${q.d}`; }, macd: () => { const q = pp("macd"); return q.f === 12 && q.s === 26 && q.g === 9 ? "MACD" : `MACD ${q.f}・${q.s}・${q.g}`; }, wr: () => `威廉 %R ${pp("wr").n}${xn("wr")}`, inout: () => "外盤比（%）" }[sub]?.() || "";
      ctx.fillText(ttl, L + 4, subTop + 8);
      // 縮放狀態標在標題旁邊，不壓到線
      if (pzz.z !== 1 || Chart.prefs.fit) { const tx = L + 4 + ctx.measureText(ttl).width + 10; ctx.fillStyle = col.accent; ctx.font = `10px ${cssVar("--font-body")}`; ctx.fillText(Chart.prefs.fit ? "貼合資料" + (pzz.z !== 1 ? `・${+pzz.z.toFixed(1)}×` : "") : `放大 ${+pzz.z.toFixed(1)}×`, tx, subTop + 8); }
      ctx.font = `11px ${cssVar("--font-num")}`;
    });

    // 日期軸
    const axY = H - axisH / 2 - 4, every = Math.max(1, Math.ceil(64 / bw));
    ctx.fillStyle = col.muted; ctx.textAlign = "center";
    for (let i = Math.ceil(va / every) * every; i <= vb; i += every) { if (i >= vis && !o.cutoff) continue; ctx.fillText(fmtD(D[i].d), Math.min(Math.max(X(i), L + 18), L + pw - 18), axY); }

    // 主圖圓圈 ↔ 副圖訊號點：半透明虛線（游標停在那一天時加深）
    (this.sigLinks || []).filter(q => q.y2 != null).forEach(q => {
      ctx.strokeStyle = q.c; ctx.lineWidth = 1; ctx.globalAlpha = q.on ? 0.75 : 0.22; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(q.x) + 0.5, q.y); ctx.lineTo(Math.round(q.x) + 0.5, q.y2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    this.renderSigUi(subs);
    // 十字線
    const hi_ = this.hover != null && this.hover < vis ? this.hover : null;
    if (hi_ != null) {
      // 日期標籤（十字線固定時一直顯示，再點一下圖表取消）
      ctx.font = `500 10.5px ${cssVar("--font-num")}`; const dt = fmtD(D[hi_].d), dw = ctx.measureText(dt).width + 10, dx = Math.min(Math.max(X(hi_) - dw / 2, L), L + pw - dw);
      ctx.fillStyle = this.pinned ? col.accent : col.ink; ctx.fillRect(dx, H - axisH - 6, dw, axisH - 2); ctx.fillStyle = col.surface; ctx.textAlign = "center"; ctx.fillText(dt, dx + dw / 2, H - axisH / 2 - 4); ctx.font = `11px ${cssVar("--font-num")}`;
      ctx.strokeStyle = this.pinned ? col.accent : col.muted; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(Math.round(X(hi_)) + 0.5, top0); ctx.lineTo(Math.round(X(hi_)) + 0.5, H - axisH - 6); ctx.stroke();
      // 查價線：跟著游標（或手指點的位置）的高度，右邊標出那個高度的價格；在副圖上標出指標數值。沒有高度時退回收盤價
      const hy = this.hoverY, inMain = hy != null && hy >= top0 && hy <= top0 + mainH, sp = hy != null && !inMain ? this.paneInv.find(q => hy >= q.top && hy <= q.bot) : null;
      const yLine = inMain ? hy : sp ? null : Y(D[hi_].c), px = inMain ? itf(thi - (hy - top0) / mainH * (thi - tlo)) : D[hi_].c;
      const tag = (y, txt) => { ctx.font = `500 10.5px ${cssVar("--font-num")}`; const w = Math.max(R - 4, ctx.measureText(txt).width + 8); ctx.fillStyle = this.pinned ? col.accent : col.ink; ctx.fillRect(Math.min(L + pw + 2, W - w - 1), y - 9, w, 18); ctx.fillStyle = col.surface; ctx.textAlign = "left"; ctx.fillText(txt, Math.min(L + pw + 6, W - w + 3), y); ctx.font = `11px ${cssVar("--font-num")}`; };
      const hline = y => { ctx.strokeStyle = this.pinned ? col.accent : col.muted; ctx.globalAlpha = 0.7; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L, Math.round(y) + 0.5); ctx.lineTo(L + pw, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; };
      if (yLine != null) { hline(yLine); tag(yLine, fmtP(px)); }
      if (sp) { hline(hy); const v = sp.inv(hy); if (isFinite(v)) tag(hy, sp.fmt(v)); }
    }
    this.canvas.setAttribute("aria-label", `K線圖，共 ${vis} 個交易日，最後收盤 ${fmtP(D[vis - 1].c)}`);
    this.renderLegend(hi_ ?? vis - 1, mas);
    if (this.onHover) this.onHover(hi_ ?? vis - 1);
    if (this.onRange) this.onRange(this.range, this);
    if (fa !== va) ctx.clearRect(0, top0, L - 0.5, H - axisH - 8 - top0); // 小數起點時最左邊那根 K 棒只露出一部分：把超出左邊界的部分擦掉
    if (this.needY) { this.needY = false; this.req(); }
  }
  // 副圖訊號開關：放在圖表上方的一列（不再疊在副圖上擋住線），每個副圖的「金叉死叉」「只看重點」各自獨立開關
  renderSigUi(subs) {
    if (!this.sigUi) {
      this.sigUi = document.createElement("div"); this.sigUi.className = "sigbar"; this.host.insertBefore(this.sigUi, this.canvas);
      this.sigUi.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; e.stopPropagation(); const P = Chart.prefs, k = b.dataset.sk || b.dataset.strongk;
        if (!P.sig) Chart.setPref("sig", true);
        if (b.dataset.sk) Chart.setPref("sigKinds", { ...P.sigKinds, [k]: P.sigKinds[k] === false });
        else if (b.dataset.strongk) Chart.setPref("sigStrongK", { ...P.sigStrongK, [k]: !P.sigStrongK[k] }); });
    }
    if (this.o.subSignals === false) { this.sigUi.innerHTML = ""; this.sigHtml = ""; this.sigUi.hidden = true; return; }
    const P = Chart.prefs, NM = { kd: "KD", macd: "MACD", rsi: "RSI", wr: "威廉", custom: "副圖" };
    const html = subs.map(S => {
      const kind = typeof S === "string" ? S : S?.custom?.kind || "custom";
      if (!["kd", "macd", "rsi", "wr"].includes(kind) && !(S?.custom?.sigs?.length) && !(S?.custom?.lines?.length >= 2 && S.custom.signals !== false && !S.custom.sigs)) return "";
      const on = P.sig && P.sigKinds[kind] !== false, st = P.sig && !!P.sigStrongK[kind], lvl = ["rsi", "wr", "psy", "arbr", "vr", "adr"].includes(kind);
      return `<span class="sg"><em>${NM[kind] || (S?.id && SUBX[S.id]?.label) || "副圖"}</em><button type="button" data-sk="${kind}" aria-pressed="${on}" title="在主圖標出這個副圖的全部訊號">${lvl ? "超買超賣" : kind === "kd" || kind === "macd" || kind === "custom" ? "金叉死叉" : "訊號"}</button>${kind === "kd" || kind === "macd" ? `<button type="button" data-strongk="${kind}" aria-pressed="${st}" title="${kind === "kd" ? "KD 只標低檔（D<20）金叉、高檔（D>80）死叉" : "MACD 只標零軸上金叉、零軸下死叉"}">只看重點</button>` : ""}</span>`;
    }).join("");
    // 高低檔鈍化：開著 KD、RSI、威廉、MFI 任一個時，多一顆開關（底色區間＋鈍化、鈍化結束的訊號）
    const dl = this.I && subs.some(S => dullOf(S, this.I)) ? `<span class="sg"><em>鈍化</em><button type="button" data-sk="dull" aria-pressed="${P.sig && P.sigKinds.dull !== false}" title="連續 3 根在高檔或低檔時塗底色並標出鈍化、鈍化結束">高低檔</button></span>` : "";
    const all = html + dl;
    this.sigUi.hidden = !all; if (this.sigHtml !== all) { this.sigHtml = all; this.sigUi.innerHTML = all; } // 和上次一樣就不動 DOM（讀 innerHTML 也很貴）
  }
  line(a, vis, X, Y, color, w, alpha = 1, dash) {
    const ctx = this.ctx, g = this.geo; ctx.save(); ctx.beginPath(); ctx.rect(g.L, 0, g.pe ?? g.pw, g.H); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.7, w * Chart.LW); ctx.globalAlpha = alpha; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); let s = false;
    for (let i = 0; i < vis; i++) { if (a[i] == null) { s = false; continue; } s ? ctx.lineTo(X(i), Y(a[i])) : ctx.moveTo(X(i), Y(a[i])); s = true; }
    ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.restore();
  }
  renderLegend(i, mas) {
    const { D, I, o } = this, k = D[i], prev = D[i - 1], ch = prev ? (k.c - prev.c) / prev.c : 0, cls = ch > 0 ? "up" : ch < 0 ? "down" : "";
    const parts = [
      `<span><b>${k.sim ? `${k.d}（模擬，不是真實走勢）` : k.d.replace(/-/g, "/")}</b></span>`,
      `<span><b>開</b>${fmtP(k.o)}</span>`, `<span><b>高</b>${fmtP(k.h)}</span>`, `<span><b>低</b>${fmtP(k.l)}</span>`,
      `<span class="${cls}"><b>收</b>${fmtP(k.c)} ${prev ? fmtPct(ch) : ""}</span>`,
      ];
    if (!o.noVol) parts.push(`<span><b>量</b>${o.volLabel ? Math.round(k.v) : k.v.toLocaleString()}</span>`);
    mas.forEach(m => parts.push(`<span style="color:${m.c}"><b style="color:inherit">MA${m.n}</b>${fmtP(m.a[i])}</span>`));
    (this.sigs || []).filter(g => g.i === i).forEach(g => parts.push(`<span class="${g.side === "buy" ? "up" : "down"}"><b style="color:inherit">${g.side === "buy" ? "○ 偏多" : "○ 偏空"}</b>${g.label}</span>`));
    if (o.vwap) parts.push(`<span style="color:${this.lcss("vwap", 0, "vwap")}"><b style="color:inherit">VWAP</b>${fmtP(I.vwap[i])}</span>`);
    if (o.vp && this.vpData) { const V = this.vpData; parts.push(`<span><b>籌碼</b>獲利 ${(V.profit * 100).toFixed(1)}%</span><span style="color:#f0883e"><b style="color:inherit">壓力</b>${fmtP(V.pre)}</span><span style="color:var(--muted)"><b style="color:inherit">均成本</b>${fmtP(V.avg)}</span><span style="color:#3b82f6"><b style="color:inherit">支撐</b>${fmtP(V.sup)}</span>`); }
    if (o.boll) parts.push(`<span style="color:${this.lcss("boll", 0, "accent")}"><b style="color:inherit">布林</b>${fmtP(I.boll.up[i])} / ${fmtP(I.boll.lo[i])}</span>`);
    for (const id of o.mainX || []) mainXCalc(id, D, I, this.cfgOn !== false).vals.forEach(([n, a, c, slot]) => a[i] != null && parts.push(`<span style="color:${c === "sar" ? `var(${mainXCalc(id, D, I, this.cfgOn !== false).dots[i]?.up ? "--up" : "--down"})` : slot != null ? this.lcss(id, slot, c) : `var(--${c})`}"><b style="color:inherit">${n}</b>${fmtP(a[i])}</span>`));
    (this.subsN || []).forEach(S => {
      const sub = typeof S === "string" ? S : "custom", C0 = typeof S === "string" ? null : S.custom;
      const xs = id => indExtras(id, this.cfgOn).map((e, j) => `<span style="color:${e.c || EXTRA_PAL[j % 6]}"><b style="color:inherit">${id === "wr" ? "%R" : "RSI"}${e.n}</b>${fmtN(extraSeries(id, D, I, e.n)[i])}</span>`).join("");
      if (sub === "wr") parts.push(`<span style="color:${this.lcss("wr", 0, "s2")}"><b style="color:inherit">%R</b>${fmtN(I.wr[i])}</span>` + xs("wr"));
      if (sub === "inout" && I.io) parts.push(`<span><b>外盤</b>${D[i].ov.toLocaleString()}</span><span><b>內盤</b>${D[i].iv.toLocaleString()}</span><span style="color:var(--s1)"><b style="color:inherit">外盤比</b>${fmtN(I.io[i])}%（5日 ${fmtN(I.io5[i])}%）</span>`);
      if (sub === "rsi") parts.push(`<span style="color:${this.lcss("rsi", 0, "s2")}"><b style="color:inherit">RSI</b>${fmtN(I.rsi[i])}</span>` + xs("rsi"));
      if (sub === "kd") parts.push(`<span style="color:${this.lcss("kd", 0, "s1")}"><b style="color:inherit">K</b>${fmtN(I.kd.K[i])}</span><span style="color:${this.lcss("kd", 1, "s3")}"><b style="color:inherit">D</b>${fmtN(I.kd.D[i])}</span>`);
      if (sub === "macd") parts.push(`<span style="color:${this.lcss("macd", 0, "s1")}"><b style="color:inherit">DIF</b>${fmtN(I.macd.dif[i], 2)}</span><span style="color:${this.lcss("macd", 1, "s3")}"><b style="color:inherit">MACD</b>${fmtN(I.macd.sig[i], 2)}</span><span><b>OSC</b>${fmtN(I.macd.osc[i], 2)}</span>`);
      if (sub === "custom") {
        const f = C0.fmt || fmtN;
        if (C0.tower && C0.tower[i]) { const x = C0.tower[i]; parts.push(`<span class="${x.up ? "up" : "down"}"><b style="color:inherit">寶塔${x.up ? "紅" : "綠"}</b>${fmtP(x.b)}～${fmtP(x.t)}</span>`); }
        if (C0.bars && C0.barName) parts.push(`<span><b>${C0.barName}</b>${f(C0.bars[i])}</span>`);
        C0.lines.forEach((a, n) => parts.push(`<span style="color:${this.subColor(S, n, null, true)}"><b style="color:inherit">${C0.names[n]}</b>${f(a[i])}</span>`));
        (C0.lines2 || []).forEach((a, n) => parts.push(`<span style="color:var(${["--s2", "--accent"][n % 2]})"><b style="color:inherit">${C0.names2[n]}</b>${f(a[i])}</span>`));
      }
    });
    if (o.compare?.length && this.cmpNow) parts.push(`<span><b>比較（${String(this.cmpBaseD || "").slice(5, 10).replace("-", "/")} 起）</b>本檔 ${fmtPct((this.cmpSelf ?? 0) / 100)}</span>` + this.cmpNow.map(c => `<span style="color:${c.color}"><b style="color:inherit">${c.name}</b>${c.pct == null ? "—" : fmtPct(c.pct / 100)}</span>`).join(""));
    const mk = (o.markers || []).filter(m => m.i === i).map(m => m.label);
    if (mk.length) parts.push(`<span style="color:var(--accent)"><b style="color:inherit">訊號</b>${mk.join("、")}</span>`);
    const lg = parts.join(""); if (this.legHtml !== lg) { this.legHtml = lg; this.legend.innerHTML = lg;
      // 說明列只長不縮（寬度變了才重算）：十字線經過有訊號的 K 棒時多一行，整張圖不會跟著上下跳
      const w = this.host.clientWidth; if (w !== this.legW) { this.legW = w; this.legMin = 0; this.legend.style.minHeight = ""; }
      const h = this.legend.offsetHeight; if (h > (this.legMin || 0)) { this.legMin = h; this.legend.style.minHeight = h + "px"; } }
  }
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

/* ---------- 自動更新到新版本 ----------
   每 5 分鐘（以及切回這個分頁時）看一下 version.json；網站部署了新版本時：
   畫面在背景、或 1 分鐘沒操作就直接重新載入；正在操作、輸入或播音檔時，先在下方顯示「有新版本」，點一下或切回來時再更新。
   嵌在學堂裡的看盤頁（iframe）交給外層處理：iframe 只記下最後操作的時間（klAct），外層判斷「有沒有在操作」時一起看。 */
(function autoUpdate() {
  const acts = ["pointerdown", "keydown", "wheel", "touchstart"];
  if (window.top !== window) { acts.forEach(t => addEventListener(t, () => { window.klAct = Date.now(); }, { passive: true, capture: true })); return; }
  if (!/^https?:$/.test(location.protocol)) return;
  const cur = (document.body.textContent.match(/版本 (\d{4}\.\d{2}\.\d{2}-\d+)/) || [])[1]; if (!cur) return;
  let last = Date.now(), next = null;
  const newer = (a, b) => { const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  acts.forEach(t => addEventListener(t, () => { last = Date.now(); }, { passive: true, capture: true }));
  const wins = () => [...document.querySelectorAll("iframe")].map(f => { try { return f.contentWindow?.document && f.contentWindow; } catch { return null; } }).filter(Boolean);
  const docs = () => [document, ...wins().map(w => w.document)], lastAct = () => Math.max(last, ...wins().map(w => +w.klAct || 0));
  const busy = () => docs().some(d => [...d.querySelectorAll("audio,video")].some(a => !a.paused) || /^(INPUT|TEXTAREA|SELECT)$/.test(d.activeElement?.tagName || ""));
  const go = () => { try { sessionStorage.setItem("kline:updatedFrom", cur); } catch {} location.reload(); };
  const banner = v => { if (document.getElementById("updBar")) return; const b = document.createElement("button"); b.id = "updBar"; b.type = "button";
    b.textContent = `有新版本（${v}），點一下更新`; b.style.cssText = "position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:99px;border:1px solid var(--line);background:var(--ink);color:var(--surface);font:inherit;font-size:13.5px;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer";
    b.onclick = go; document.body.appendChild(b); };
  const decide = () => { if (!next) return; if (document.visibilityState === "hidden" || (Date.now() - lastAct() > 60000 && !busy())) go(); else banner(next); };
  const check = async () => {
    try { const r = await fetch("version.json", { cache: "no-store" }); if (!r.ok) return; const j = await r.json(); if (j?.v && newer(j.v, cur)) { next = j.v; decide(); } } catch {}
  };
  setTimeout(check, 15000); setInterval(check, 5 * 60e3); setInterval(decide, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); else decide(); });
})();

/* ---------- 離線快取（PWA，sw.js）＋離線提示 ----------
   只在網站上（http/https）、最上層頁面註冊；嵌在首頁的看盤頁在同一個範圍裡，一起被照顧到。沒有網路時畫面下方顯示「離線中」，連回來就收起。 */
if (typeof window !== "undefined" && window.top === window && /^https?:$/.test(location.protocol)) {
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  const netBar = () => { let b = document.getElementById("netBar"); if (navigator.onLine) return b?.remove(); if (b || !document.body) return;
    b = document.createElement("div"); b.id = "netBar"; b.setAttribute("role", "status"); b.textContent = "離線中：顯示上次載入的資料，連上網路後會自動更新";
    b.style.cssText = "position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9998;padding:7px 14px;border-radius:99px;background:var(--surface-2);color:var(--ink);border:1px solid var(--line);font-size:13px;max-width:calc(100vw - 32px);text-align:center";
    document.body.appendChild(b); };
  // 只有持續離線 3 秒還是離線才顯示：切換分頁、網路短暫抖動時 navigator.onLine 會一下 false 一下 true，不要一直跳
  // 只看 navigator.onLine（讀快取、靜態 JSON 備援都不算離線）；online 立刻收起；回到頁面（切回 App、從背景回來、bfcache 還原）時重新判斷，不會留著舊的提示
  let netT = 0; const netLater = () => { clearTimeout(netT); if (navigator.onLine) return netBar(); netT = setTimeout(netBar, 3000); };
  addEventListener("offline", netLater); addEventListener("online", netLater); addEventListener("load", netLater); addEventListener("pageshow", netLater);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") netLater(); });
}

/* ---------- 大按鈕模式（html[data-big]，樣式在 core.css；設定記在 kline:big）：學堂、看盤、存股一起換，iframe 之間用 postMessage 通知 ---------- */
function applyBig(on, from = null) {
  on = !!on; const d = document.documentElement; if ((d.dataset.big === "1") === on) return; // 狀態一樣就停，訊息不會在頁面之間來回傳
  if (on) d.dataset.big = "1"; else delete d.dataset.big; store.set("big", on);
  for (const f of document.querySelectorAll("iframe")) if (f.contentWindow && f.contentWindow !== from) try { f.contentWindow.postMessage({ type: "kline-big", on }, "*"); } catch {}
  if (window.top !== window && from !== parent) try { parent.postMessage({ type: "kline-big", on }, "*"); } catch {}
  try { Chart.all.forEach(c => c.draw()); } catch {}
}
if (typeof window !== "undefined") addEventListener("message", e => { if (e.data?.type === "kline-big" && e.origin === location.origin) applyBig(e.data.on, e.source); });

/* ---------- 版面風格（html[data-style]，樣式在 minimal.css；設定記在 kline:style） ---------- */
const KL_STYLES = [
  ["lab", "KLineLab 實驗室", "碳黑底、純白訊號、鈦金屬灰（預設）", { l: ["#fafafa", "#ffffff", "#18181b", "#09090b", 10], d: ["#09090b", "#121215", "#a1a1aa", "#ffffff", 10] }],
  ["layout", "版心留白", "近黑底、大量留白、金色小標", { l: ["#f5f4f0", "#fbfaf7", "#a8863a", "#161616", 6], d: ["#0e0e0e", "#151515", "#cfae62", "#ececea", 6] }],
  ["minimal", "簡約", "灰階磁磚、赭黃重點", { l: ["#ebebe9", "#e0e0de", "#c39b2f", "#3a3a3a", 14], d: ["#171717", "#222221", "#c9a23a", "#e2e2e0", 14] }],
  ["pro", "專業看盤", "深藍黑底、藍色重點，資訊密集", { l: ["#f2f4f7", "#fbfcfd", "#2a6fdb", "#1c2430", 6], d: ["#0b0e14", "#121821", "#3d8bff", "#e6ebf2", 6] }],
  ["blue", "清爽藍白", "白色卡片、海軍藍，明亮乾淨", { l: ["#eaf0f6", "#f8fafd", "#1f5fc4", "#142339", 16], d: ["#0e1626", "#152038", "#4f8df0", "#e5ecf7", 16] }],
  ["paper", "宋體紙本", "黑白灰、宋體、小圓角", { l: ["#e3e3e1", "#f4f4f2", "#2b2b2b", "#151515", 3], d: ["#000000", "#0c0c0c", "#4a4a4a", "#e8e8e8", 3] }],
  ["chalk", "黑板", "綠色黑板、粉筆字（配合 logo）", { l: ["#19281f", "#213529", "#f3d46a", "#eef2e9", 14], d: ["#19281f", "#213529", "#f3d46a", "#eef2e9", 14] }],
];
const klStyle = () => document.documentElement.dataset.style || "minimal";
function applyStyle(id, save = true) {
  if (!KL_STYLES.some(s => s[0] === id)) id = "lab";
  if (id === "minimal") delete document.documentElement.dataset.style; else document.documentElement.dataset.style = id;
  if (save) store.set("style", id);
  dispatchEvent(new CustomEvent("klinestyle", { detail: id }));
}
// 風格選擇視窗：每個風格一張小預覽；setTheme 由各頁提供（切換深色／淺色）
function openStylePicker(setTheme) {
  document.querySelector(".stylepick")?.remove();
  const ov = document.createElement("div"); ov.className = "stylepick"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "版面風格");
  const draw = () => {
    const dark = document.documentElement.dataset.theme === "dark", cur = klStyle();
    // 簡化版：每個風格一列，四個色點（底、面板、重點、文字）＋名稱，不再畫縮圖
    const sw = ([bg, sf, acc, ink]) => `<span class="sp-sw" aria-hidden="true">${[bg, sf, acc, ink].map(c => `<i style="background:${c}"></i>`).join("")}</span>`;
    ov.innerHTML = `<div><h3>版面風格<button class="btn sm" data-sp="x" type="button">完成</button></h3><p class="note" style="margin:0">點一下就套用，學堂、看盤一起換；選擇會記在這台裝置。</p>
      <div class="sp-row" style="margin-top:10px"><span class="note">主題</span><div class="seg" role="group">${[["light", "淺色"], ["dark", "深色"]].map(([t, n]) => `<button type="button" data-spt="${t}" aria-pressed="${(t === "dark") === dark}">${n}</button>`).join("")}</div>${cur === "chalk" ? '<span class="note">（黑板風格固定是深色）</span>' : ""}</div>
      <div class="sp-row"><span class="note">按鈕大小</span><div class="seg" role="group">${[["0", "一般"], ["1", "大按鈕"]].map(([v, n]) => `<button type="button" data-spb="${v}" aria-pressed="${(document.documentElement.dataset.big === "1") === (v === "1")}">${n}</button>`).join("")}</div><span class="note">大按鈕：字和按鈕放大，手機比較好點</span></div>
      <div class="sp-list">${KL_STYLES.map(([id, name, desc, pv]) => `<button type="button" class="sp" data-sps="${id}" aria-pressed="${cur === id}">${sw(dark ? pv.d : pv.l)}<span class="sp-t"><b>${name}</b><small>${desc}</small></span><span class="sp-ok" aria-hidden="true">${cur === id ? "✓" : ""}</span></button>`).join("")}</div></div>`;
  };
  draw();
  ov.addEventListener("click", e => {
    const s = e.target.closest("[data-sps]"), t = e.target.closest("[data-spt]"), b = e.target.closest("[data-spb]");
    if (s) { applyStyle(s.dataset.sps); draw(); } else if (t) { setTheme?.(t.dataset.spt); draw(); } else if (b) { applyBig(b.dataset.spb === "1"); draw(); }
    else if (e.target === ov || e.target.closest('[data-sp="x"]')) ov.remove();
  });
  addEventListener("keydown", function k(e) { if (e.key === "Escape") { ov.remove(); removeEventListener("keydown", k); } });
  document.body.appendChild(ov);
}

// 嵌在別的頁面（iframe：首頁的看盤、存股）裡放大圖表時，把整個 iframe 固定成螢幕大小（避開瀏海與底部橫條）；
// 不然「全螢幕」只會和 iframe 一樣高（整頁內容的高度，好幾千 px），手機直拿、橫拿、電腦都塞不進畫面。縮小時還原，看盤頁再回報一次高度
// 放大時頂部列、分頁列、浮動按鈕藏起來（core.css 的 html:has(.chart-fullscreen)、index.html 的 html:has(iframe[data-prev-style])）
function chartFrameSync() {
  let f = null; try { f = window.frameElement; } catch {} if (!f) return;
  if (document.querySelector(".chart-fullscreen")) {
    if (f.dataset.prevStyle === undefined) f.dataset.prevStyle = f.getAttribute("style") || "";
    const t = "env(safe-area-inset-top, 0px)", r = "env(safe-area-inset-right, 0px)", b = "env(safe-area-inset-bottom, 0px)", l = "env(safe-area-inset-left, 0px)";
    f.style.cssText = `position:fixed !important;top:${t} !important;left:${l} !important;width:calc(100% - ${l} - ${r}) !important;height:calc(100vh - ${t} - ${b}) !important;height:calc(100dvh - ${t} - ${b}) !important;max-height:none !important;margin:0 !important;z-index:9999 !important;border:0 !important;background:var(--bg,#09090b) !important;`;
  } else if (f.dataset.prevStyle !== undefined) { f.setAttribute("style", f.dataset.prevStyle); delete f.dataset.prevStyle; if (typeof postHeight === "function") postHeight(); }
}
// 放大中轉向、或手機網址列收合（高度變了但寬度沒變）：重畫放大的圖
if (typeof window !== "undefined") addEventListener("resize", () => { for (const c of Chart.all || []) if (c.host.closest(".chart-fullscreen")) c.req(); });

if (typeof window !== "undefined" && !window.__chartEscInit) {
  window.__chartEscInit = true;
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const full = document.querySelectorAll(".chart-fullscreen");
      if (full.length) {
        full.forEach(el => el.classList.remove("chart-fullscreen")); chartFrameSync();
        document.querySelectorAll("[data-z='expand'], #kExpandBtn, #tsExpandBtn").forEach(b => {
          b.textContent = "⛶ 放大";
          b.setAttribute("aria-pressed", "false");
        });
        Chart.all.forEach(c => c.draw());
        if (typeof drawTs === "function") drawTs();
      }
    }
  });
}

/* ---------- 無障礙：只有圖示或符號的按鈕（✕、＋、−、↑、☆、SVG…）要有 aria-label，也給同樣的 title（滑鼠停上去看得到說明）
   新畫出來的按鈕也會補上（MutationObserver，閒下來時才處理一批） ---------- */
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const iconOnly = b => !/[\p{Script=Han}A-Za-z0-9]/u.test(b.textContent || "");
  const fix = root => { for (const b of (root.querySelectorAll ? root.querySelectorAll("button:not([title])") : [])) { const a = b.getAttribute("aria-label"); if (a && iconOnly(b)) b.title = a; } };
  let q = false; const later = () => { if (q) return; q = true; (window.requestIdleCallback || (f => setTimeout(f, 50)))(() => { q = false; fix(document); }); };
  addEventListener("DOMContentLoaded", () => { fix(document); new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); });
}
