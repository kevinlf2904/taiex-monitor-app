// 可點範圍至少 24px（#262 FE-02、#264 E3）：今日市場與大盤分頁，手機 390、桌面 1280。
// 用實際點擊測試（elementFromPoint）量可點範圍，所以透明外框撐大的也算；句子裡的文字連結（WCAG 2.5.8 的 inline 例外）不算。
// 範圍含 onclick／tabindex 標記的自訂互動元素；中心點被蓋住的也列為失敗。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const scan = p => p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll("#lx a[href], #lx button, #lx [role=button], #lx [role=tab], #lx input, #lx select, #lx summary, #lx [onclick], #lx [tabindex]:not([tabindex=\"-1\"])")) {
    let r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || getComputedStyle(e).visibility === "hidden" || (r.width >= 24 && r.height >= 24)) continue;
    if (e.tagName === "A" && /^(P|SPAN|LI|SMALL)$/.test(e.parentElement.tagName) && e.parentElement.textContent.trim().length > e.textContent.trim().length + 4) continue; // 句子裡的連結
    e.scrollIntoView({ block: "center", inline: "center" }); r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
    // 捲到畫面中央後中心點仍點不到＝被其他元素蓋住，使用者也點不到，算失敗（不跳過，#282 審查）
    if (!hit(cx, cy)) { const t = document.elementFromPoint(cx, cy); out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}「${(e.getAttribute("aria-label") || e.textContent).trim().slice(0, 12)}」中心點被 ${t ? t.tagName.toLowerCase() + "." + [...t.classList].join(".") : "（畫面外）"} 蓋住`); continue; }
    const reach = (dx, dy) => { let k = 0; while (k < 30 && hit(cx + dx * (k + 1), cy + dy * (k + 1))) k++; return k; };
    const w = reach(-1, 0) + reach(1, 0) + 1, h = reach(0, -1) + reach(0, 1) + 1;
    if (w < 24 || h < 24) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}「${(e.getAttribute("aria-label") || e.textContent).trim().slice(0, 12)}」可點 ${w}x${h}`);
  }
  return out;
});

for (const width of [390, 1280]) test(`可點範圍至少 24px：今日市場、大盤 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  for (const tab of ["today", "mkt"]) {
    await p.evaluate(t => { setLt(t); renderList(); }, tab); await p.waitForTimeout(2500);
    assert.deepEqual(await scan(p), [], `${tab} ${width}`);
  }
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
});
