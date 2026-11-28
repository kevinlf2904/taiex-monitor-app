// 盤後資料 → 籌碼動向：臺指選擇權各履約價未平倉長條、最大痛點標示、切換到期；固定假資料，390／1280 不溢出
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TXO = { date: "2026-11-24", exps: [
  { exp: "202611W4", label: "11 月第 4 週", mp: 23500, cOI: 30, pOI: 40, pcr: 133.33, cMax: 23500, pMax: 23500, rows: [[23500, 30, 40]] },
  { exp: "202612", label: "12 月（月選）", mp: 23500, cOI: 2100, pOI: 750, pcr: 35.71, cMax: 24000, pMax: 23000, rows: [[23000, 100, 500], [23500, 800, 200], [24000, 1200, 50]] }] };

for (const width of [390, 1280]) test(`臺指選擇權未平倉分佈 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(t => { W.chipx = { date: "2026-11-24", lend: {}, dt: {}, pcr: [], notes: [], txo: t }; W.tdccR = { err: "x" }; W.txoI = 0; W.af = "chipx"; setLt("after"); renderList(); }, TXO);
  await p.click('[data-af="chipx"]').catch(() => {});
  await p.waitForSelector("#lx .txo .txo-r.mp");
  let t = await p.textContent("#lx");
  assert.match(t, /臺指選擇權未平倉分佈與最大痛點/); assert.match(t, /最大痛點\s*23,500[\s\S]*11 月第 4 週/);
  await p.click('#lx [data-txo="1"]'); await p.waitForFunction(() => /12 月（月選）・資料日/.test($("#lx").innerText));
  t = await p.textContent("#lx .txo");
  assert.ok(t.indexOf("24,000") < t.indexOf("23,000"), "履約價由高到低");
  assert.equal(await p.$$eval("#lx .txo-r:not(.txo-h)", r => r.length), 3); assert.match(await p.textContent("#lx .txo-r.mp"), /23,500 ◆/);
  const w = await p.$$eval("#lx .txo-c i", a => a.map(i => i.style.width)); assert.deepEqual(w, ["100%", "67%", "8%"], "買權 1200 最長");
  assert.ok(await noHOverflow(p)); await ctx.close(); assert.deepEqual(errs, []);
});
