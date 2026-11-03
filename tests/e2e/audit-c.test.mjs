// 稽核修正 C 批：加權今日 K 棒的量（不再記成 0）、盤中未收盤 K 棒的訊號標示、指標公式對照獨立算法、更新通知的個資告知與取消
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("加權今日 K 棒：報價沒有量時用分時成交金額加總；沒有分時就標「沒有量」，量能不寫 0.0 倍", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => select("T00")); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const base = W.daily.data.slice(), last = base.at(-1), q = { code: "T00", price: last.c * 1.01, prev: last.c, open: last.c, high: last.c * 1.02, low: last.c * 0.99, vol: null, date: "2099-01-02" };
    W.sel = "T00"; W.intra = { code: "T00", date: "2099-01-02", amountNa: false, bars: [{ d: "2099-01-02", t: "09:00", o: 1, h: 1, l: 1, c: 1, v: 800.5 }, { d: "2099-01-02", t: "09:05", o: 1, h: 1, l: 1, c: 1, v: 199.25 }] };
    mergeDaily(q, false); const a = { ...W.daily.data.at(-1) };
    W.daily.data = base.slice(); W.intra = null; mergeDaily(q, false); const b = { ...W.daily.data.at(-1) }, I = indicators(W.daily.data);
    const ta = trendAnalysis(W.daily.data, I).filter(x => x.k === "量能").map(x => JSON.stringify(x));
    W.daily.data = base; return { a: [a.v, !!a.vNa], b: [b.v, !!b.vNa], ta };
  });
  assert.deepEqual(r.a, [999.75, false], "有分時：成交金額加總（億元）");
  assert.deepEqual(r.b, [0, true], "沒有分時：標沒有量");
  assert.ok(!r.ta.some(t => /0\.0 倍/.test(t)), "量能不寫 0.0 倍：" + r.ta);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("盤中還沒收盤的那一根：標 live，圖上這一根的訊號畫淡並註明「盤中未定」；收盤後就沒有", async () => {
  for (const [time, want] of [["2026-10-26T10:00:00+08:00", true], ["2026-10-26T15:00:00+08:00", false]]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, time: new Date(time) });
    await p.evaluate(() => select("2330")); await p.waitForTimeout(1200); await p.evaluate(() => setDtab?.("tech")); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const last = W.daily.data.at(-1), q = { code: "2330", price: last.c, prev: last.c, open: last.c, high: last.c, low: last.c, vol: 100, date: "2099-01-02" };
      mergeDaily(q, false);
      const k = Object.keys(STRATS).find(x => STRATS[x].fn); W.strat = k; const fn = STRATS[k].fn; STRATS[k].fn = D => [{ i: D.length - 1, side: "buy" }, { i: D.length - 2, side: "sell" }];
      drawK(true); STRATS[k].fn = fn; const m = kChart.o.markers || [];
      return { live: !!W.daily.data.at(-1).live, lastMk: m.find(x => x.i === W.daily.data.length - 1), prevMk: m.find(x => x.i === W.daily.data.length - 2) };
    });
    assert.equal(r.live, want, time);
    if (want) { assert.equal(r.lastMk?.dim, true); assert.match(r.lastMk?.label || "", /盤中未定/); }
    else assert.doesNotMatch(r.lastMk?.label || "", /盤中未定/);
    assert.doesNotMatch(r.prevMk?.label || "", /盤中未定/, "前一根不受影響");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("指標公式：RSI（Wilder）、KD（9,3,3）、MACD（12,26,9）、布林（20,2）和獨立算法一致", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const r = await p.evaluate(() => {
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, D = []; let px = 100;
    for (let i = 0; i < 300; i++) { const o = px, c = +(px * (1 + (rnd() - 0.5) * 0.04)).toFixed(2); D.push({ o, h: Math.max(o, c) * (1 + rnd() * 0.01), l: Math.min(o, c) * (1 - rnd() * 0.01), c }); px = c; }
    const C = D.map(x => x.c), N = C.length - 1, near = (a, b) => Math.abs(a - b) < 1e-6;
    let ag = 0, al = 0; for (let i = 1; i <= 14; i++) { const d = C[i] - C[i - 1]; ag += Math.max(d, 0); al += Math.max(-d, 0); } ag /= 14; al /= 14;
    for (let i = 15; i <= N; i++) { const d = C[i] - C[i - 1]; ag = (ag * 13 + Math.max(d, 0)) / 14; al = (al * 13 + Math.max(-d, 0)) / 14; }
    let k = 50, d = 50; for (let i = 8; i <= N; i++) { const w = D.slice(i - 8, i + 1), hh = Math.max(...w.map(x => x.h)), ll = Math.min(...w.map(x => x.l)); k = (2 * k + (C[i] - ll) / (hh - ll) * 100) / 3; d = (2 * d + k) / 3; }
    const em = (a, n) => { const o = []; let e = null; for (const v of a) { e = e == null ? v : v * 2 / (n + 1) + e * (1 - 2 / (n + 1)); o.push(e); } return o; };
    const e12 = em(C, 12), e26 = em(C, 26), dif = C.map((_, i) => e12[i] - e26[i]), sig = em(dif.slice(25), 9).at(-1);
    const w = C.slice(N - 19), mu = w.reduce((a, b) => a + b) / 20, sd = Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / 20);
    const kd = kdCalc(D), m = macdCalc(C), b = bollCalc(C);
    return [near(rsiCalc(C)[N], 100 - 100 / (1 + ag / al)), near(kd.K[N], k), near(kd.D[N], d), near(m.dif[N], dif[N]), near(m.sig[N], sig), near(b.up[N], mu + 2 * sd), near(b.lo[N], mu - 2 * sd)];
  });
  assert.deepEqual(r, [true, true, true, true, true, true, true]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("更新通知：有個人資料告知（目的、保存期限、取消方式）；「取消通知」送出 remove", async () => {
  const { ctx, p, errs } = await open(B, S.url, "pro.html", { width: 390, touch: true });
  let body = null; await ctx.route("**/api/sync", r => { body = JSON.parse(r.request().postData() || "{}"); r.fulfill({ contentType: "application/json", body: '{"ok":true,"removed":true}' }); });
  assert.match(await p.textContent(".wl-pdpa"), /蒐集目的.*保存期限：登記後最多 1 年.*取消通知/s);
  await p.fill("#wlEmail", "a@b.co"); await p.click("#wlDel"); await p.waitForFunction(() => /已取消/.test(document.getElementById("wlMsg").textContent));
  assert.deepEqual(body, { op: "waitlist", email: "a@b.co", remove: true });
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
});
