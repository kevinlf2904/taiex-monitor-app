// UI/UX 稽核方案 A：手機上小按鈕的觸控範圍、存股頁標題層級與字型跟著全站設定、輸入框有焦點提示
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// 以按鈕中心往上下各 21px 還點得到自己（約 44px 高）；左右鄰居中心仍點到鄰居自己
const taps = sels => sels.map(sel => {
  const e = document.querySelector(sel); if (!e || !e.offsetParent) return [sel, "看不到"];
  const r = e.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const own = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
  const sib = d => { let n = d < 0 ? e.previousElementSibling : e.nextElementSibling; while (n && !n.offsetParent) n = d < 0 ? n.previousElementSibling : n.nextElementSibling; return n; };
  const nbOk = [sib(-1), sib(1)].filter(Boolean).every(n => { const q = n.getBoundingClientRect(), t = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return !!t && (t === n || n.contains(t)); });
  return [sel, own(cx, cy - 21) && own(cx, cy + 21) ? "44" : "小", nbOk ? "鄰居OK" : "蓋到鄰居"];
});

test("手機：頂部與個股頁小按鈕點擊範圍約 44px 高、不蓋到鄰居；桌面外觀與範圍不變", async () => {
  let { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true }); await p.waitForTimeout(600);
  for (const [sel, h, nb] of await p.evaluate(`(${taps})(["#themeBtn","#fontBtn","#gsTop","#mktChip"])`)) { assert.equal(h, "44", sel); assert.equal(nb, "鄰居OK", sel); }
  assert.equal(await p.evaluate(() => { const h = document.querySelector("header.top").getBoundingClientRect(); return document.elementFromPoint(h.x + h.width / 2, h.bottom + 2)?.closest("header") ? "header" : "內容"; }), "內容", "擴大的範圍不能蓋到標題列下方的內容");
  await ctx.close(); assert.deepEqual(errs, []);
  ({ ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true })); await p.waitForTimeout(600);
  await p.evaluate(() => select("2330")); await p.waitForTimeout(1000);
  for (const [sel, h, nb] of await p.evaluate(`(${taps})(["#backBtn","#menuBtn"])`)) { assert.equal(h, "44", sel); assert.equal(nb, "鄰居OK", sel); }
  await ctx.close(); assert.deepEqual(errs, []);
  ({ ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 })); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#themeBtn"), "::after").content), "none", "桌面滑鼠操作不加擴大範圍");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("存股頁：標題層級不跳號；字型跟著全站設定（預設黑體、設成宋體才用宋體，外層切換即時套用）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390, touch: true }); await p.waitForTimeout(800);
  const levels = await p.evaluate(() => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => +h.tagName[1])); // 文件裡的靜態順序（收合、分頁隱藏的也算）
  assert.equal(levels[0], 1); levels.reduce((a, b) => { assert.ok(b <= a + 1, `標題從 h${a} 跳到 h${b}`); return b; });
  const font = () => p.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
  assert.doesNotMatch(await font(), /SimSun|Songti/, "預設黑體");
  await p.evaluate(() => { localStorage.setItem("kline:font", '"song"'); }); await p.reload(); await p.waitForTimeout(600);
  assert.match(await font(), /SimSun|Songti/, "全站設成宋體時用宋體");
  await p.evaluate(() => window.postMessage({ type: "kline-font", font: "sans" }, "*")); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.font), "song", "只聽外層（parent）的訊息；獨立開啟時 parent 就是自己");
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
});

test("看盤：輸入框鍵盤聚焦時有可見的焦點提示（外框或光暈）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 }); await p.waitForTimeout(600);
  await p.evaluate(() => { document.querySelector("#addForm").hidden = false; }); // 稽核指出的是加入自選的輸入框（input.code），平常收在「＋」後面
  const sel = "#addCode";
  assert.ok(sel, "畫面上有輸入框");
  await p.focus(sel); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Tab");
  const ring = await p.evaluate(s => { const c = getComputedStyle(document.querySelector(s)); return { focused: document.activeElement === document.querySelector(s), outline: c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0, shadow: c.boxShadow !== "none" }; }, sel);
  assert.ok(ring.focused, "Tab 回到輸入框"); assert.ok(ring.outline || ring.shadow, "要有外框或光暈：" + JSON.stringify(ring));
  await ctx.close(); assert.deepEqual(errs, []);
});
