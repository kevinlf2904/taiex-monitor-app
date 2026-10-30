// 加權、櫃買分 K：成交金額（億元）量能區、分時圖金額；沒有成交金額時價格照畫、量能區寫「暫缺」；個股仍是張（390、1280）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const DAY = "2026-10-05";
const bars = (n, v) => Array.from({ length: n }, (_, k) => ({ d: DAY, t: `${String(9 + Math.floor(k / 60)).padStart(2, "0")}:${String(k % 60).padStart(2, "0")}`, o: 100 + k, h: 101 + k, l: 99 + k, c: 100.5 + k, v: v(k) }));
const route = (ctx, body) => ctx.route(/\/api\/intraday\?(?!.*spark=1)/, r => {
  const u = new URL(r.request().url());
  if (u.searchParams.get("before")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, bars: [], end: true, unit: "億元" }) });
  r.fulfill({ contentType: "application/json", body: JSON.stringify(body(u.searchParams.get("code"))) });
});
const openMinute = async (p, code, timeout = 15000) => {
  await p.evaluate(c => { select(c); }, code); await p.waitForTimeout(600); await p.evaluate(() => setDtab("tech"));
  await p.evaluate(() => document.querySelector('#kSeg [data-k="5"]').click());
  await p.waitForFunction(() => typeof kChart !== "undefined" && kChart?.D?.length && kChart.D[0].d.includes(" "), null, { timeout });
  return p.evaluate(() => ({ n: kChart.D.length, v0: kChart.D[0].v, label: kChart.o.volLabel, name: kChart.o.volName || "量", msg: kChart.o.volMsg || null, noVol: !!kChart.o.noVol, fmt: kChart.o.volFmt ? kChart.o.volFmt(1050.76) : null, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
};

for (const [w, opt] of [[390, { width: 390, touch: true }], [1280, { width: 1280 }]]) {
  test(`加權分 K：富果成交金額畫成「成交金額（億元）」，5 分 K 金額＝5 根相加 ${w}`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", opt);
    await route(ctx, c => ({ ok: true, code: c.toUpperCase(), source: "富果", date: DAY, tf: 1, prev: 100, unit: "億元", amountNa: false, session: { open: "09:00", close: "13:30" }, bars: bars(30, k => 100 + k) }));
    const r = await openMinute(p, "T00");
    assert.equal(r.n, 6); assert.equal(r.v0, 100 + 101 + 102 + 103 + 104);
    assert.equal(r.label, "成交金額（億元）"); assert.equal(r.name, "金額"); assert.equal(r.noVol, false); assert.equal(r.msg, null);
    assert.equal(r.fmt, "1,051 億"); assert.equal(r.overflow, false, "沒有橫向溢出");
    const ts = await p.evaluate(() => { const d = tsData(); return { amt: d.amt, na: d.amtNa, avg: d.pts.some(x => x.a != null) }; });
    assert.deepEqual(ts, { amt: true, na: false, avg: false }, "分時圖畫成交金額、不算均價");
    await ctx.close(); assert.deepEqual(errs, []);
  });

  test(`櫃買分 K：富果失敗改用 Yahoo（沒有成交金額）時價格照畫、量能區寫「成交金額暫缺」 ${w}`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", opt);
    await route(ctx, c => ({ ok: true, code: c.toUpperCase(), source: "Yahoo Finance（可能延遲）", date: DAY, tf: 1, prev: 100, unit: "億元", amountNa: true, session: { open: "09:00", close: "13:30" }, bars: bars(30, () => null) }));
    const r = await openMinute(p, "O00");
    assert.equal(r.n, 6, "價格 K 線照畫"); assert.equal(r.v0, null, "缺值不變成 0");
    assert.equal(r.noVol, false, "量能區不藏起來"); assert.match(r.msg, /成交金額暫缺.*Yahoo/);
    const ts = await p.evaluate(() => tsData().amtNa); assert.equal(ts, true);
    await p.evaluate(() => { W.ftab = "ticks"; renderFlow(); });
    assert.match(await p.textContent("#fBox"), /成交金額（億元）[\s\S]*—/, "每分鐘彙總表也標成交金額、缺值顯示 —");
    await ctx.close(); assert.deepEqual(errs, []);
  });
}

test("個股分 K 仍是「量（張）」，數字不換算 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await route(ctx, c => ({ ok: true, code: c, source: "富果", date: DAY, tf: 1, prev: 100, unit: "張", session: { open: "09:00", close: "13:30" }, bars: bars(30, k => 10 + k) }));
  const r = await openMinute(p, "2454"); // 2330 是頁面預設選的股票，開頁時就載入過分 K（假資料還沒掛上），所以用 2454
  assert.equal(r.label, "量（張）"); assert.equal(r.name, "量"); assert.equal(r.v0, 10 + 11 + 12 + 13 + 14); assert.equal(r.msg, null);
  assert.equal(await p.evaluate(() => tsData().amt), false);
  await ctx.close(); assert.deepEqual(errs, []);
});


test("加權當日分 K：API 延遲超過 20 秒仍能完成載入與繪圖", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route(/\\/api\\/intraday\\?(?!.*spark=1)/, async r => {
    const u = new URL(r.request().url()), code = (u.searchParams.get("code") || "").toUpperCase();
    if (u.searchParams.has("before")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, bars: [], end: true, unit: "億元" }) });
    if (code !== "T00") return r.fallback();
    await new Promise(resolve => setTimeout(resolve, 21000));
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "T00", source: "富果（mock）", date: DAY, tf: 1, prev: 100, unit: "億元", amountNa: false, session: { open: "09:00", close: "13:30" }, bars: bars(30, k => 100 + k) }) });
  });
  const limits = await p.evaluate(() => ({
    index: requestTimeoutMs("/api/intraday?code=T00&tf=1"),
    otc: requestTimeoutMs("/api/intraday?code=O00&tf=1"),
    history: requestTimeoutMs("/api/intraday?code=T00&tf=1&before=2026-10-01"),
    stock: requestTimeoutMs("/api/intraday?code=2330&tf=1"),
    quote: requestTimeoutMs("/api/quote?codes=T00")
  }));
  assert.deepEqual(limits, { index: 35000, otc: 35000, history: 20000, stock: 20000, quote: 20000 });
  const r = await openMinute(p, "T00", 40000);
  assert.equal(r.n, 6); assert.equal(r.v0, 100 + 101 + 102 + 103 + 104);
  assert.equal(r.label, "成交金額（億元）"); assert.equal(r.noVol, false); assert.equal(r.msg, null);
  assert.equal(r.overflow, false); assert.deepEqual(errs, []);
  await ctx.close();
});
