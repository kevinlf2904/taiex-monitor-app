// #333 A5／A6／A10：切換主題當下圖表要拿到新主題的顏色；行事曆選中日、相關係數表的字要看得清楚
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// WCAG 相對亮度與對比（rgb()/rgba() 為 0–255；color-mix 算出來的 color(srgb …) 為 0–1）
const contrast = (a, b) => {
  const L = s => { const k = s.startsWith("color(") ? 1 : 255; const [r, g, bl] = s.replace(/^color\(srgb/, "").match(/[\d.]+/g).slice(0, 3).map(v => { v /= k; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05);
};

for (const width of [390, 1280]) test(`主題切換：同步重繪讀到新主題色（${width}px）`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  for (const t of ["light", "dark", "light"]) {
    const r = await p.evaluate(t => {
      cssVar("--ink"); // 先把舊主題的值放進快取
      let seen = null; const orig = Chart.all.forEach; // 攔截重繪當下讀到的顏色
      Chart.all.forEach = function (f) { seen = cssVar("--ink"); return orig.call(this, f); };
      try { applyTheme(t); } finally { Chart.all.forEach = orig; }
      return { seen, real: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() };
    }, t);
    assert.equal(r.seen, r.real, `切到 ${t} 時重繪拿到舊主題色`);
  }
  // 籌碼分佈 #costCv：區塊顯示時切主題要重繪，而且重繪當下拿到新主題色；區塊隱藏時不重繪
  for (const [t, shown] of [["dark", true], ["light", true], ["dark", false]]) {
    const r = await p.evaluate(([t, shown]) => {
      const sec = $("#secCost"), was = sec.hidden, orig = window.renderCost; sec.hidden = !shown;
      cssVar("--up"); let calls = 0, seen = null;
      window.renderCost = () => { calls++; seen = cssVar("--up"); };
      try { applyTheme(t); } finally { window.renderCost = orig; sec.hidden = was; }
      return { calls, seen, real: getComputedStyle(document.documentElement).getPropertyValue("--up").trim() };
    }, [t, shown]);
    assert.equal(r.calls, shown ? 1 : 0, `籌碼分佈${shown ? "顯示" : "隱藏"}時切到 ${t}，重繪次數不對`);
    if (shown) assert.equal(r.seen, r.real, `籌碼分佈重繪時拿到舊主題色（${t}）`);
  }
  await ctx.close(); assert.deepEqual(errs, []);
});

test("行事曆選中日、相關係數表：深淺主題都有足夠對比", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  for (const t of ["dark", "light"]) {
    const r = await p.evaluate(async t => {
      applyTheme(t);
      // 相關係數表的底色比例直接從 watch.html 原始碼取（v=1 時最深），避免測試和實作各寫一份數字
      const pct = +((await (await fetch("watch.html")).text()).match(/var\(--accent\) \$\{Math\.round\(Math\.max\(0, v\) \* (\d+)\)\}%/) || [])[1];
      if (!pct) throw new Error("找不到相關係數表的底色比例");
      const host = document.createElement("div"); host.style.background = "var(--surface)"; document.body.append(host);
      host.innerHTML = `<div class="caldays"><button aria-pressed="true"><span><i class="cc">說1</i></span></button></div>
        <table class="qx-heat"><tr><td class="c" style="background:color-mix(in srgb, var(--accent) ${pct}%, var(--surface))">1.00</td></tr></table>`;
      const i = host.querySelector("i"), td = host.querySelector("td.c");
      const strong = getComputedStyle(document.documentElement).getPropertyValue("--grad-strong");
      // 選中日底色是漸層：兩端的色標都要檢查；color-mix 要整段當一個色標（不能拆出裡面的 #hex）
      const stops = strong.match(/color-mix\([^()]*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
      if (!stops.length) throw new Error("讀不到 --grad-strong 的色標：" + strong);
      const probe = document.createElement("b"); host.append(probe);
      const toRgb = c => { probe.style.color = c; return getComputedStyle(probe).color; };
      const out = { iColor: getComputedStyle(i).color, stops: stops.map(toRgb), tdColor: getComputedStyle(td).color, tdBg: getComputedStyle(td).backgroundColor };
      host.remove(); return out;
    }, t);
    for (const s of r.stops) assert.ok(contrast(r.iColor, s) >= 4.5, `${t}：選中日的字 ${r.iColor} 對底色 ${s} 對比不足`);
    assert.ok(contrast(r.tdColor, r.tdBg) >= 4.5, `${t}：相關係數格 ${r.tdColor} / ${r.tdBg} 對比不足`);
  }
  await ctx.close(); assert.deepEqual(errs, []);
});
