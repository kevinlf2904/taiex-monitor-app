// 淺色、深色模式：投資組合各頁的警示文字（資料狀態、風險連結、融資標籤、交易錯誤）和背景的對比至少 4.5:1（WCAG AA 一般文字）。
// 漲跌紅綠是全站的顏色（不在這裡檢查）。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TX = [{ id: "a", v: 1, date: "2026-01-05", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 90, fee: 20, tax: 0 },
  { id: "x", v: 1, date: "2026-02-01", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 99999, price: 1, fee: 0, tax: 0 }];
const MG = { v: 1, accounts: [{ id: "m", name: "融資", type: "margin", source: "user", loan: 10000, collateral: [{ symbol: "2330", shares: 100, price: 50, priceDate: "2026-01-01" }] }] };

for (const theme of ["light", "dark"]) test(`警示文字對比 ${theme}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, `watch.html?theme=${theme}`, { width: 1280 });
  await p.evaluate(([tx, mg]) => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); store.set("pf:margin:v1", mg); W.lg = null; W.holdView = "tx"; setLt("hold"); }, [TX, MG]);
  // 每一頁指定要檢查的警示元素，而且每一頁都要真的找到（不能用全部加總代替）
  const PAGES = [["tx", "#lx .lgwarn"], ["home", "#lx .hm-high .linkbtn, #lx .hm-warn .linkbtn"], ["margin", "#lx .pfbadge"], ["alloc", "#lx .pfsrc-warn, #lx .pfsrc-error"]];
  for (const [v, sel] of PAGES) {
    await p.evaluate(v => { W.lg.view = v; renderList(); }, v);
    await p.waitForFunction(sel => [...document.querySelectorAll(sel)].some(e => e.offsetParent && e.textContent.trim()), sel, { timeout: 30000 });
    const r = await p.evaluate(sel => {
      // 顏色可能是 rgb(0～255) 或 color(srgb 0～1 …)（color-mix 的結果）：後者要先換成 0～255
      const ch = c => { const n = c.match(/[\d.]+/g).map(Number); return /^color\(/.test(c) ? n.slice(0, 3).map(x => x * 255).concat(n.slice(3)) : n; };
      const L = c => { const [r, g, b] = ch(c).slice(0, 3).map(x => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bg = e => { while (e) { const c = getComputedStyle(e).backgroundColor, a = c.match(/[\d.]+/g) && ch(c); if (a && (a.length < 4 || +a[3] > 0.5)) return c; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
      return [...document.querySelectorAll(sel)].filter(e => e.offsetParent && e.textContent.trim()).map(e => { const a = L(getComputedStyle(e).color), b = L(bg(e)); return { t: e.textContent.trim().slice(0, 12), cr: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
    }, sel);
    assert.ok(r.length >= 1, `${theme} ${v}：有找到要檢查的警示文字（${sel}）`);
    const low = r.filter(x => x.cr < 4.5).map(x => `${x.t}（${x.cr.toFixed(2)}）`);
    assert.deepEqual(low, [], `${theme} ${v}：警示文字對比不足`);
  }
  await ctx.close(); assert.deepEqual(errs, []);
});
