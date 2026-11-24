// 字體跟著版面風格走（PR #344）：首頁介紹區不寫死 lab 字體；各風格 × 亮暗色，介紹區的字體、漲跌色變數都解析得到
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const first = f => f.split(",")[0].trim().replace(/["']/g, "");

test("首頁介紹區：字體跟著風格（lab／paper／chalk／minimal × 亮／暗），漲跌色有值", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 });
  await p.evaluate(() => goTab("intel")); await p.waitForTimeout(300);
  const seen = {};
  for (const st of ["lab", "paper", "chalk", "minimal"]) for (const th of ["light", "dark"]) {
    const r = await p.evaluate(([st, th]) => {
      applyStyle(st, false); document.documentElement.dataset.theme = th;
      const v = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim(), f = s => getComputedStyle(document.querySelector(s)).fontFamily;
      return { disp: v("--font-display"), body: v("--font-body"), up: v("--up"), down: v("--down"), h: f(".hero-h"), pp: f(".hero-p"), btn: f(".hero-btn") };
    }, [st, th]);
    const tag = `${st}/${th}`;
    assert.ok(r.up && r.down && r.up !== r.down, `${tag} 漲跌色要有值且不同`);
    assert.equal(first(r.h), first(r.disp), `${tag} 大標用 --font-display`);
    assert.equal(first(r.pp), first(r.body), `${tag} 說明用 --font-body`);
    assert.equal(first(r.btn), first(r.body), `${tag} 按鈕用 --font-body`);
    seen[st] = first(r.h);
  }
  assert.equal(seen.lab, "Space Grotesk", "預設 lab 風格維持 Space Grotesk");
  assert.notEqual(seen.paper, "Space Grotesk", "宋體紙本不再是 lab 字體");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("看盤「重設」按鈕的字體變數有定義；儲蓄頁載入數字用的 IBM Plex Mono", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const ff = await p.evaluate(() => { const b = document.createElement("div"); b.className = "gzoom"; b.innerHTML = '<button class="greset">重設</button>'; document.body.append(b); const f = getComputedStyle(b.firstChild).fontFamily; b.remove(); return [f, getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim()]; });
  assert.equal(first(ff[0]), first(ff[1]), "重設按鈕用 --font-body");
  await ctx.close(); assert.deepEqual(errs, []);
  const { ctx: c2, p: p2 } = await open(B, S.url, "savings.html", { width: 390, touch: true });
  assert.ok(await p2.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => /family=IBM\+Plex\+Mono/.test(l.href))), "要載入 IBM Plex Mono");
  await c2.close();
});
