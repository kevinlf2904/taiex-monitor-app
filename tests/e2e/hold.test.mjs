// 庫存（照券商 App）：含息／不含息、扣費稅、持有成本、均價、損益平衡點、展開明細
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("庫存費稅與股息", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 90, d: "2025-06-01" }, "0050": { sh: 2000, cost: 80 } }; W.holdMkt = "tw"; setLt("hold"); });
  await p.waitForFunction(() => W.quotes.get("2330")?.price && W.hdivs?.["2330"] && document.querySelector(".yh-ring"), null, { timeout: 20000 });
  // 預設：扣費稅、含息
  const a = await p.evaluate(() => { const q = W.quotes.get("2330"), r = holdPnL("2330", q), mv = 1000 * q.price, bf = Math.max(20, Math.round(90000 * 0.001425)), sf = Math.max(20, Math.round(mv * 0.001425)), tax = Math.round(mv * 0.003);
    return { r, hc: 90000 + bf - 5500, pnl: mv - sf - tax - (90000 + bf - 5500), be: (90000 + bf - 5500) / (1000 * (1 - 0.001425 - 0.003)) }; });
  assert.equal(a.r.hc, a.hc); assert.ok(Math.abs(a.r.pnl - a.pnl) < 1e-6); assert.ok(Math.abs(a.r.be - a.be) < 1e-9); assert.ok(Math.abs(a.r.avg - a.hc / 1000) < 1e-9);
  assert.equal(await p.evaluate(() => [holdPnL("0050", W.quotes.get("0050")).tax, Math.round(2000 * W.quotes.get("0050").price * 0.001)].reduce((x, y) => x - y)), 0);
  // 不含息：成本加回股息
  await p.click('#lx [data-hset="hdiv"][data-v="false"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => holdPnL("2330", W.quotes.get("2330")).hc), a.hc + 5500);
  // 展開明細
  await p.click('#wl [data-hx="2330"]'); await p.waitForTimeout(200);
  assert.match(await p.evaluate(() => $(".yh-det").innerText), /持有成本[\s\S]*損益平衡點/);
  await p.click('.yh-det [data-sel="2330"]'); await p.waitForTimeout(400); assert.equal(await p.evaluate(() => W.sel), "2330");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("美股庫存匯入：中文名稱對到代號、打錯的代號不會匯入、版面對齊", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  // 報價：只認得 NVDA、SPCX、INTC（其他代號查無資料）
  await ctx.route("**/api/quote**", r => { const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(c => ["NVDA", "SPCX", "INTC"].includes(c));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "closed", quotes: codes.map((c, i) => ({ code: c, name: { NVDA: "輝達", SPCX: "SpaceX", INTC: "英特爾" }[c], price: 100 + i, prev: 99, chg: 1, chgPct: 1, date: "2026-10-16" })) }) }); });
  await ctx.route("**/api/symbol**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items: [] }) }));
  await p.evaluate(() => { W.hold = {}; W.holdMkt = "us"; setLt("hold"); openImport("text"); });
  await p.fill("#impText", "輝達 5 213.8\n太空探索科技公司 8 156.8\nNVDAX 1 10");
  await p.click("#impParse"); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate(() => imp.rows.map(r => r.code)), ["NVDA", "SPCX", "NVDAX"]);
  await p.click("#impSave"); await p.waitForTimeout(800);
  assert.equal(await p.evaluate(() => Object.keys(W.hold).length), 0, "有查不到的代號時不能存");
  assert.match(await p.evaluate(() => document.body.innerText), /查不到這些代號：NVDAX/);
  await p.click('[data-gdel="2"]'); await p.click("#impSave"); await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(() => Object.keys(W.hold).sort()), ["NVDA", "SPCX"]);
  // 每一列都撐滿整行（以前名稱短的列會縮成一半寬）
  await p.waitForSelector(".yh-row"); const ws = await p.evaluate(() => [...document.querySelectorAll(".yh-row")].map(b => Math.round(b.getBoundingClientRect().width)));
  assert.ok(ws.length === 2 && ws[0] === ws[1] && ws[0] > 300, String(ws));
  await ctx.close(); assert.deepEqual(errs, []);
});
