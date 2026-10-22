// 供應鏈：生態群島無框、題材內頁保留上排選單、產業圖解互動（每段詳細說明、名詞解釋、依漲跌上色、找公司、考考自己）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`產業圖解互動、群島無框、內頁選單 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await p.evaluate(() => { showList(); setLt("ind"); W.indS.view = "themes"; W.indS.mk = "tw"; W.indS.sub = "chain"; W.indS.open = null; renderInd(); });
  await p.waitForSelector(".iisl");
  // 群島和全站一樣無框：沒有框線、底色、陰影；選中用細底線
  const st = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.iisl[aria-pressed="true"]') || document.querySelector(".iisl")); return [c.borderTopWidth, c.backgroundColor, c.backgroundImage, getComputedStyle(document.querySelector(".iisl-banner")).borderTopWidth]; });
  assert.deepEqual(st, ["0px", "rgba(0, 0, 0, 0)", "none", "0px"]);
  // 產業圖解 → 點一張圖：上排選單還在
  await p.click('#lx [data-iview="gallery"]'); await p.waitForFunction(() => indFigsLoad.done, null, { timeout: 15000 });
  await p.click(".igcard >> nth=0"); await p.waitForSelector(".ifig .fbadge");
  assert.equal(await p.getAttribute('#lx [data-iview="gallery"]', "aria-pressed"), "true", "題材內頁也有上排選單");
  const id = await p.evaluate(() => W.indS.open);
  // 點編號 → 每一段的詳細說明：位置（上一段／下一段）、跳到某一段
  await p.click('.ifig .fbadge[data-n="2"]'); await p.waitForSelector(".figstep:not([hidden]) .fsdots");
  assert.match(await p.textContent(".figstep"), /→/);
  await p.click('.figstep .fsdots [data-fgo="3"]'); assert.equal(await p.evaluate(() => W.indS.fstep.n), 3);
  await p.click('.figstep .fsflow [data-fgo="2"]'); assert.equal(await p.evaluate(() => W.indS.fstep.n), 2);
  // 名詞解釋：原理說明裡的名詞可以點，再點一次收起
  const g = p.locator(".ihow .gterm").first(); await g.click(); await p.waitForSelector(".gdef"); assert.ok((await p.textContent(".gdef p")).length > 3);
  await g.click(); assert.equal(await p.$(".gdef"), null);
  // 「關鍵名詞」詞條：定義卡放在那條定義後面
  if (await p.$(".ihow .gdl .gterm")) { await p.evaluate(() => document.querySelectorAll(".ihow details").forEach(d => (d.open = true))); await p.click(".ihow .gdl .gterm >> nth=0");
    assert.equal(await p.evaluate(() => document.querySelector(".gdef")?.previousElementSibling?.tagName), "DD"); await p.click(".gdef [data-gterm]"); assert.equal(await p.$(".gdef"), null); }
  // 依今日漲跌上色（記住設定）、找公司
  await p.click(".ifig [data-fheat]"); assert.equal(await p.evaluate(() => [document.querySelector(".ifig svg").classList.contains("fheat"), store.get("watch:fheat")].join()), "true,true");
  const code = await p.evaluate(() => figItems(INDT.get(W.indS.open))[0].c[0][0]);
  await p.fill(".ifig [data-ffind]", code); await p.waitForFunction(() => document.querySelectorAll(".ifig .fbadge.hit").length > 0);
  assert.match(await p.textContent(".ffres"), /1\./);
  // 報價更新整頁重畫：上色、找公司、目前那一段都還在
  await p.evaluate(() => renderInd()); assert.ok(await p.evaluate(() => document.querySelector(".ifig svg").classList.contains("fheat") && document.querySelectorAll(".ifig .fbadge.hit").length > 0 && W.indS.fstep.n === 2));
  // 考考自己：答完圖上跳到正確那一段，可以下一題
  await p.click(".iquiz [data-fq] >> nth=0"); await p.waitForSelector(".iqres");
  assert.match(await p.textContent(".iquiz h4"), /答對 [01]／1/);
  const ans = await p.evaluate(id => figQuizQ(INDT.get(id), W.indQuiz[id].seed).n, id); assert.equal(await p.evaluate(() => W.indS.fstep.n), ans);
  await p.click(".iquiz [data-fqn]"); assert.equal(await p.$(".iqres"), null);
  // 上排選單離開內頁
  await p.click('#lx [data-iview="themes"]'); assert.deepEqual(await p.evaluate(() => [W.indS.open, W.indS.view]), [null, "themes"]);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("名詞詞典：從各題材的「關鍵名詞」整理，別名也查得到", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 1280 });
  await p.evaluate(() => indFigsLoad()); await p.waitForFunction(() => indFigsLoad.done, null, { timeout: 15000 });
  const r = await p.evaluate(() => { const G = figGlossBuild(); return [G.size > 200, !!G.get("矽智財"), !!G.get("IP"), G.get("IP")?.term, /data-gterm="ASIC"/.test(figGl("ASIC 設計服務 ASIC", null)), (figGl("ASIC 和 ASIC", null).match(/class="gterm"/g) || []).length, /gterm/.test(figGl("SHIP", null))]; });
  assert.deepEqual(r, [true, true, true, "矽智財（IP）", true, 1, false]);
  await ctx.close(); assert.deepEqual(errs, []);
});
