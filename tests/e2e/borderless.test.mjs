// 無框設計（minimal.css「無框設計（全部風格）」）：區塊、卡片、按鈕、膠囊不畫四邊框線、不疊實心色塊卡片。
// 掃主要畫面，列出還有「四邊框」或「實心底卡片」的元件；浮動面板、輸入框、表格、圖表、庫存區（#308 另案）不算。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// 在頁面裡找有框的元件：回傳「選擇器描述 ×個數」
const scan = () => {
  const SKIP = "svg, canvas, iframe, table, input, select, textarea, dialog, [role=dialog], .scalepop, .sugg, .sheet, .shot-pop, .chat-panel, .stylepick, .sc-modal, .toast, #toTop, .chat-fab, .gcard, .igal-wrap, .gzoom, .tip, [class*=tip], .pf, [id^=pf], [class^=pf], [class*=' pf'], #holdBox, .hold, [id^=hold], [class^=yh], .lg, [id^=lg], [class^=lg], .kbd, kbd, code, pre, .hero-viz, .seal, .logo, .badge, .avatar, img, video";
  const alpha = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const v = m[1].split(/[ ,/]+/).filter(Boolean); return v.length > 3 ? +v[3] : 1; };
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const desc1 = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + [...e.classList].slice(0, 2).map(c => "." + c).join("");
  const desc = e => (e.id || e.classList.length ? "" : desc1(e.parentElement) + " > ") + desc1(e);
  const hits = new Map();
  for (const e of document.querySelectorAll("body *")) {
    if (e.closest(SKIP)) continue;
    const r = e.getBoundingClientRect(); if (r.width < 40 || r.height < 24) continue;
    const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "contents" || +s.opacity === 0) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter(k => parseFloat(s[`border${k}Width`]) >= 0.5 && s[`border${k}Style`] !== "none" && alpha(s[`border${k}Color`]) > 0.05);
    const ring = /(?:^|, )(?:rgba?\([^)]*\) )?0px 0px 0px [1-9]/.test(s.boxShadow) || /inset 0px 0px 0px [1-9]/.test(s.boxShadow);
    let why = sides.length === 4 || ring ? "框" : "";
    // 按鈕、膠囊、可點的列照「按鍵維持無框」規則用淡底色區分，不算實心底卡片
    if (!why && !e.matches("button, [role=button], summary, .hero-bar, .td-ms-item") && r.width >= 120 && r.height >= 48 && alpha(s.backgroundColor) > 0.3 && s.backgroundColor !== bodyBg && !s.backgroundImage.includes("gradient")) why = "底";
    if (!why) continue;
    const k = `${why} ${desc(e)}`; hits.set(k, (hits.get(k) || 0) + 1);
  }
  return [...hits].map(([k, n]) => `${k} ×${n}`);
};

const views = async (p, file) => {
  const out = [];
  const add = async name => { await p.waitForTimeout(500); for (const x of await p.evaluate(scan)) out.push(`${file}:${name} ${x}`); };
  if (file === "index.html") {
    for (const t of ["learn", "intel", "quiz", "lab"]) { await p.evaluate(t => goTab(t), t).catch(() => {}); await add(t); }
  } else {
    for (const lt of ["today", "mkt", "tw", "us", "rank", "screen", "ind", "money", "earn", "etf", "after", "tools", "cong", "pod", "watch"]) { await p.evaluate(lt => setLt(lt), lt).catch(() => {}); await add(lt); }
    await p.evaluate(() => select("2330")).catch(() => {});
    for (const t of ["ovw", "tech", "chips", "fin", "trend", "news"]) { await p.evaluate(t => setDtab(t), t).catch(() => {}); await add("2330/" + t); }
  }
  return out;
};

for (const file of ["index.html", "watch.html"]) {
  test(`無框：${file} 主要畫面沒有四邊框線或實心底卡片（390／1280）`, async () => {
    const bad = new Set();
    for (const width of [390, 1280]) {
      const { ctx, p } = await open(B, S.url, file, { width, touch: width < 500, lazy: file === "watch.html" });
      for (const x of await views(p, file)) bad.add(x);
      await ctx.close();
    }
    assert.deepEqual([...bad], [], "還有框的元件：\n" + [...bad].join("\n"));
  });
}
