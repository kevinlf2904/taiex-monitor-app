// 檢查產業圖解原始檔（learner/indpacks/*.js）：欄位齊全、編號圓點對得上產業鏈、代號格式、圖元不超出畫布、文字大概不互相重疊。
//   node scripts/check-indpack.mjs                    檢查全部（只有 INDUSTRY_PACK.push 的新題材做完整檢查）
//   node scripts/check-indpack.mjs learner/indpacks/q14.js [--svg 輸出資料夾]   只檢查指定檔；--svg 會把每張圖存成 SVG（深色底）方便看
// 錯誤（✗）會讓程式失敗；提醒（△）是文字可能太擠，請自己看圖確認。
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../learner");
const args = process.argv.slice(2), svgAt = args.indexOf("--svg"), svgDir = svgAt >= 0 ? args[svgAt + 1] : "";
const only = args.filter((a, i) => a.endsWith(".js") && i !== svgAt + 1).map(f => path.resolve(f));
const order = f => { const m = /^([pq])(\d+)\.js$/.exec(f); return m ? (m[1] === "p" ? 0 : 1000) + +m[2] : 1e9; };
const all = fs.readdirSync(path.join(dir, "indpacks")).filter(f => f.endsWith(".js")).sort((a, b) => order(a) - order(b)).map(f => path.join(dir, "indpacks", f));

// 畫圖用的 figSvg、圖示；題材圖示（IND_ICON）和分類顏色從 watch.html 讀
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, "diagrams.js"), "utf8").replace(/^const (FIG_C|FIG_ICONS|INDUSTRY_FIGS|INDUSTRY_PACK) =/gm, "var $1 ="), ctx, { filename: "diagrams.js" });
const watch = fs.readFileSync(path.join(dir, "watch.html"), "utf8");
const indIcons = new Set([...(watch.match(/const IND_ICON = \{([\s\S]*?)\};/)?.[1] || "").matchAll(/(\w+): "/g)].map(m => m[1]));
const old = vm.runInNewContext(fs.readFileSync(path.join(dir, "industry.js"), "utf8").replace(/^const INDUSTRY_MAP/m, "var INDUSTRY_MAP") + "\nINDUSTRY_MAP", {});
const own = new Map(); // 每個檔案自己 push 的題材
for (const f of all) { const n0 = ctx.INDUSTRY_PACK.length; vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) }); own.set(f, ctx.INDUSTRY_PACK.slice(n0)); }
const ids = new Set([...old.themes.map(t => t.id), ...ctx.INDUSTRY_PACK.map(t => t.id)]);

const COLORS = new Set(["blue", "cyan", "green", "orange", "red", "purple", "yellow", "pink", "gray"]);
const CODE = { tw: /^(\d{4,6}[A-Z]?)$/, us: /^[A-Z][A-Z.\-]{0,6}$/, jp: /^\d{3}[0-9A-Z]\.T$/, kr: /^\d{6}\.K[SQ]$/ };
const anyCode = c => Object.values(CODE).some(r => r.test(c));
// 文字寬度估計：中文全形 1 個字級寬、英數約 0.56
const tw = (s, sz) => [...String(s ?? "")].reduce((w, ch) => w + (/[⺀-￯]/.test(ch) ? sz : /[ ilI.,:;'|!]/.test(ch) ? sz * 0.3 : sz * 0.58), 0);
function textBoxes(fig) {
  const B = [], add = (x, y, s, label, a = "middle", who) => { if (label == null || label === "") return; const w = tw(label, s), x0 = a === "start" ? x : a === "end" ? x - w : x - w / 2; B.push({ x0, x1: x0 + w, y0: y - s * 0.82, y1: y + s * 0.22, label: String(label), who }); };
  fig.items.forEach((it, i) => {
    const who = `#${i} ${it.t}`;
    if (it.t === "text") add(it.x, it.y, it.s || 9, it.label, it.a || "middle", who);
    else if (it.t === "box") { add(it.x + it.w / 2, it.y + it.h / 2 + (it.sub ? -1 : 3.5), it.s || 10, it.label, "middle", who); add(it.x + it.w / 2, it.y + it.h / 2 + 11, 8, it.sub, "middle", who); }
    else if (it.t === "group") add(it.x + 6, it.y + 11, 8.5, it.label, "start", who);
    else if (it.t === "icon") add(it.x + (it.s || 24) / 2, it.y + (it.s || 24) + 10, it.ls || 8.5, it.label, "middle", who);
    else if (it.t === "callout") add(it.tx, it.ty + 3, it.s || 8, it.label, it.a || (it.tx >= it.x ? "start" : "end"), who);
    else if (["cyl", "stack", "rack"].includes(it.t)) add(it.x + it.w / 2, it.y + it.h + 11, it.ls || 8.5, it.label, "middle", who);
    else if (it.t === "wafer") add(it.x, it.y + it.r + 11, it.ls || 8.5, it.label, "middle", who);
    else if (it.t === "circle") add(it.x, it.y + it.r + 10, it.ls || 8.5, it.label, "middle", who);
  });
  return B;
}
function checkFig(id, fig, nChain, err, warn) {
  if (!fig || !Array.isArray(fig.items)) return err(`${id}: 沒有 fig.items`);
  const W = fig.w || 360, H = fig.h || 230; if (!fig.alt || fig.alt.length < 20) err(`${id}: fig.alt 要寫一句完整的圖說（給讀屏與分享）`);
  const out = (x, y, why) => { if (!(x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1)) err(`${id}: ${why} 超出畫布（${x},${y}）`); };
  const seen = new Set();
  fig.items.forEach((it, i) => {
    const w = `${id} #${i} ${it.t}`;
    if (it.c && !COLORS.has(it.c)) err(`${w}: 顏色 ${it.c} 不在 ${[...COLORS].join(" ")}`);
    if (it.t === "icon" && !vm.runInContext("FIG_ICONS", ctx)[it.k]) err(`${w}: 圖示 ${it.k} 不存在`);
    if (it.t === "badge") { if (!(Number.isInteger(it.n) && it.n >= 1 && it.n <= nChain)) err(`${w}: 編號 ${it.n} 對不到產業鏈（共 ${nChain} 段）`); seen.add(it.n); }
    if ("x" in it && "y" in it) out(it.x, it.y, w); if ("w" in it && "h" in it && "x" in it) out(it.x + it.w, it.y + it.h, w + " 右下角");
    for (const p of it.pts || []) out(p[0], p[1], w + " 折線");
    if (it.t === "box" && it.label && tw(it.label, it.s || 10) > it.w - 4) warn(`${w}: 「${it.label}」比方塊寬（${tw(it.label, it.s || 10).toFixed(0)} > ${it.w - 4}）`);
    if (it.t === "box" && it.sub && tw(it.sub, 8) > it.w - 2) warn(`${w}: 小字「${it.sub}」比方塊寬`);
  });
  for (let n = 1; n <= nChain; n++) if (!seen.has(n)) err(`${id}: 產業鏈第 ${n} 段在圖上沒有編號圓點`);
  const B = textBoxes(fig);
  for (const b of B) if (b.x0 < -2 || b.x1 > W + 2 || b.y0 < -2 || b.y1 > H + 2) warn(`${id} ${b.who}: 文字「${b.label}」超出畫布`);
  for (let i = 0; i < B.length; i++) for (let k = i + 1; k < B.length; k++) {
    const a = B[i], b = B[k], ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > 1.5 && oy > 1.5 && a.who !== b.who) warn(`${id}: 文字可能重疊「${a.label}」(${a.who}) 和「${b.label}」(${b.who})`);
  }
  const svg = vm.runInContext("figSvg", ctx)(fig, { id: "c" + id.replace(/\W/g, "") }); if (!/^<svg[\s\S]*<\/svg>\s*$/.test(svg.trim())) err(`${id}: figSvg 畫不出來`);
  if (svgDir) { fs.mkdirSync(svgDir, { recursive: true }); fs.writeFileSync(path.join(svgDir, id + ".svg"), svg.replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" style="--ink:#e7e9ee;--muted:#8a94a3;background:#0b0d12;font-family:'Noto Sans TC',sans-serif"`)); }
}
function checkTheme(t, err, warn) {
  const id = t.id || "(沒有 id)";
  for (const k of ["id", "mk", "cat", "name", "icon", "desc", "flow", "segs", "fig", "how", "trends", "chain"]) if (t[k] == null) err(`${id}: 少了 ${k}`);
  if (!CODE[t.mk]) err(`${id}: mk 要是 tw／us／jp／kr`); else if (!id.startsWith(t.mk + "-")) err(`${id}: id 要用 ${t.mk}- 開頭`);
  if (t.icon && !indIcons.has(t.icon)) err(`${id}: 題材圖示 ${t.icon} 不在 IND_ICON（${[...indIcons].join(" ")}）`);
  if (!(t.flow?.length >= 4 && t.flow.length <= 6)) err(`${id}: flow 要 4～6 步`);
  const pairs = [...(t.segs || []).flatMap(g => g.c || []), ...(t.chain || []).flatMap(g => (g.items || []).flatMap(i => i.c || []))];
  for (const p of pairs) { if (!Array.isArray(p) || p.length !== 2 || !p[1]) err(`${id}: 公司要寫成 [代號, 名稱]：${JSON.stringify(p)}`); else if (!anyCode(p[0])) err(`${id}: 代號 ${p[0]} 格式不對`); }
  for (const g of t.segs || []) if (!g.n || !g.c?.length) err(`${id}: segs 每段要有 n 與公司`);
  if (!(t.how?.length >= 5 && t.how.length <= 6) || !t.how.every(x => Array.isArray(x) && x.length === 2 && x[1].length > 30)) err(`${id}: how 要 5～6 段 [標題, 內容]`);
  const gl = t.how?.find(x => /名詞/.test(x[0])); if (!gl) err(`${id}: how 要有「關鍵名詞」一段`);
  else { const n = String(gl[1]).split("。").filter(s => /^[^：:]{1,28}[：:].+/.test(s.trim())).length; if (n < 3) err(`${id}: 關鍵名詞要寫成「名詞：定義。」至少 3 個（現在 ${n} 個）`); }
  if (t.trends?.length !== 4) err(`${id}: trends 要 4 條`);
  const items = (t.chain || []).flatMap(g => g.items || []);
  for (const g of t.chain || []) if (!["上游", "中游", "下游"].includes(g.tier) || !g.title || !g.items?.length) err(`${id}: chain 每層要有 tier（上游／中游／下游）、title、items`);
  for (const i of items) if (!i.name || !i.desc || !i.c?.length) err(`${id}: 產業鏈「${i.name}」要有 name、desc、c`);
  if (items.length < 4 || items.length > 9) err(`${id}: 產業鏈要 4～9 段（現在 ${items.length}）`);
  if (!t.peers?.length) warn(`${id}: 建議加 peers（相關題材）`);
  for (const p of t.peers || []) if (!ids.has(p)) err(`${id}: peers 裡的 ${p} 不存在`); else if (p === id) err(`${id}: peers 不要放自己`);
  checkFig(id, t.fig, items.length, err, warn);
}

let nErr = 0, nWarn = 0; const files = only.length ? only : all, dup = new Map();
for (const t of [...old.themes, ...ctx.INDUSTRY_PACK]) dup.set(t.id, (dup.get(t.id) || 0) + 1);
for (const [k, n] of dup) if (n > 1) { console.log(`✗ 題材 id ${k} 重複 ${n} 次`); nErr++; }
for (const f of files) {
  const T = own.get(f) || [], E = [], Wn = [];
  for (const t of T) checkTheme(t, s => E.push(s), s => Wn.push(s));
  if (only.length) for (const [id, F] of Object.entries(vm.runInNewContext(`var INDUSTRY_FIGS = {}, INDUSTRY_PACK = [];\n${fs.readFileSync(f, "utf8")}\nINDUSTRY_FIGS`, {})))
    checkFig(id, F.fig, (F.chain || INDT_chain(id)).flatMap(g => g.items || []).length, s => E.push(s), s => Wn.push(s));
  console.log(`${path.basename(f)}：${T.length} 個題材${E.length ? `，${E.length} 個錯誤` : ""}${Wn.length ? `，${Wn.length} 個提醒` : ""}`);
  E.forEach(s => console.log("  ✗ " + s)); Wn.forEach(s => console.log("  △ " + s)); nErr += E.length; nWarn += Wn.length;
}
function INDT_chain(id) { return old.themes.find(t => t.id === id)?.chain || []; }
console.log(nErr ? `共 ${nErr} 個錯誤、${nWarn} 個提醒` : `沒有錯誤${nWarn ? `（${nWarn} 個提醒）` : ""}`);
process.exit(nErr ? 1 : 0);
