// 大盤更新時間：抓取失敗不可以把「更新於」刷成現在；離線快取（sw.js）回的舊資料要被當成舊資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const MKT = { ok: true, date: "2026-10-05", dataDate: "2026-10-05", live: true, time: "10:00:00", sourceTime: "10:00:00", fetchedAt: "2026-10-05T02:00:00.000Z", updateMode: "live", source: "t",
  completeness: "complete", coverage: { got: 100, want: 100 }, dataStatus: "live", dateVerified: true, dateConsistent: true, breadth: null, us: [], world: [], indices: [] };
const setHol = p => p.evaluate(() => { Object.assign(TWHOL, { set: null, year: "", mark: null, failAt: Date.now() }); twHolSet([{ date: "2026-01-01", name: "開國紀念日" }]); });
// 盤中、今天是 2026-10-05，量 W.mkt 的狀態標籤
const tagNow = p => p.evaluate(() => { W.session = "open"; W.today = "2026-10-05"; return { at: W.mkt.at, tryAt: W.mkt.tryAt, lastErr: W.mkt.lastErr, tag: liveTag(W.mkt) }; });

test("大盤：抓取失敗時更新時間不刷新，超過期限轉成資料延遲 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  let fail = false;
  await ctx.route("**/api/market", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(fail ? { ok: false, error: "證交所暫時連不到" } : MKT) }));
  await p.clock.setFixedTime(new Date("2026-10-05T10:00:00+08:00")); await setHol(p);
  await p.evaluate(async () => { clearTimeout(W.timer); W.session = "open"; await loadMktLive(); });
  const a = await tagNow(p);
  assert.match(a.tag, /盤中即時/, "剛拿到的資料是盤中即時");
  fail = true; await p.clock.setFixedTime(new Date("2026-10-05T10:01:00+08:00"));
  await p.evaluate(async () => { W.session = "open"; await loadMktLive(); });
  const b = await tagNow(p);
  assert.equal(b.at, a.at, "失敗時 at 留在上次成功的時間");
  assert.ok(b.tryAt > a.at, "tryAt 記最後一次去問的時間");
  assert.match(b.lastErr, /證交所暫時連不到/);
  assert.doesNotMatch(b.tag, /盤中即時/, "一分鐘沒拿到新資料，不能再寫盤中即時");
  assert.match(b.tag, /延遲/);
  // 排下一次更新看 tryAt：剛問過就不會每秒重問
  assert.equal(await p.evaluate(() => { const s = W.mktLoading; W.mktLoading = 0; let n = 0; const f = window.loadMktLive; window.loadMktLive = () => { n++; }; try { W.lt = "mkt"; W.mkReg = "tw"; W.session = "open"; liveRefresh(); } finally { window.loadMktLive = f; W.mktLoading = s; } return n; }), 0);
  fail = false; await p.evaluate(async () => { W.session = "open"; await loadMktLive(); });
  const c = await tagNow(p);
  assert.ok(c.at > a.at, "恢復後 at 更新"); assert.match(c.tag, /盤中即時/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("大盤：連不上伺服器時 sw.js 回的快取帶 swCachedAt，畫面當成舊資料 1280", async () => {
  // service worker 自己發的請求不受 setOffline 影響：另開一個網站伺服器，存好快取後關掉它，模擬連不上
  const S2 = await serve(), { ctx, p, errs } = await open(B, S2.url, "watch.html", { width: 1280, sw: true });
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  const cachedAt = Date.parse("2026-10-05T01:30:00Z"); // 09:30 存的
  await p.evaluate(async b => { const c = await caches.open("klinelab-v1"); await c.put("/api/market", new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json", Date: new Date(Date.parse("2026-10-05T01:30:00Z")).toUTCString() } })); }, MKT);
  S2.close();
  assert.equal(await p.evaluate(async () => (await (await fetch("/api/market")).json()).swCachedAt), cachedAt, "連不上時回快取，標上存起來的時間");
  await p.clock.setFixedTime(new Date("2026-10-05T10:00:00+08:00")); await setHol(p);
  await p.evaluate(async () => { clearTimeout(W.timer); W.session = "open"; await loadMktLive(); });
  const s = await tagNow(p);
  assert.equal(s.at, cachedAt, "at 用快取當時的時間，不是現在");
  assert.doesNotMatch(s.tag, /盤中即時/); assert.match(s.tag, /延遲/);
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
});

test("國際行情、大盤：有幾項拿不到時註明暫缺，不讓空白像沒有資料 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/global", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "Yahoo", at: "2026-10-15T00:00:00Z", failed: ["BZ=F"], groups: [{ id: "energy", name: "能源", rows: [{ code: "CL=F", name: "西德州原油 WTI", price: 96.2, chg: 2.3, chgPct: 2.4 }, { code: "BZ=F", name: "布蘭特原油", price: null }] }] }) }));
  await p.evaluate(async () => { clearTimeout(W.timer); W.mkReg = "gl"; W.gl = null; setLt("mkt"); await loadGlobal(true); renderList(); });
  await p.waitForSelector("#lx .gnote");
  assert.match(await p.textContent("#lx .gnote"), /1 項暫時拿不到（顯示 —）/);
  assert.equal(await p.evaluate(() => mktFailedNote({ failed: ["inst", "us"] })), "法人、美股指數暫時拿不到，稍後自動重試。");
  assert.equal(await p.evaluate(() => mktFailedNote({ failed: [] })), "");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("大盤：新回應比畫面上的舊（前一天收盤、較早的快照）不蓋掉畫面資料；收盤確認沒有時間照常更新 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  let body = MKT;
  await ctx.route("**/api/market", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
  await p.clock.setFixedTime(new Date("2026-10-05T10:00:05+08:00")); await setHol(p);
  const load = () => p.evaluate(async () => { clearTimeout(W.timer); W.session = "open"; await loadMktLive(); return { date: W.mkt.date, time: W.mkt.time, lastErr: W.mkt.lastErr || null }; });
  assert.deepEqual(await load(), { date: "2026-10-05", time: "10:00:00", lastErr: null });
  body = { ...MKT, date: "2026-10-02", dataDate: "2026-10-02", live: false, time: null, sourceTime: null, dataStatus: "stale", note: "今日即時暫未取得" };
  const a = await load();
  assert.equal(a.date, "2026-10-05", "前一天的收盤不蓋掉今天的盤中資料"); assert.match(a.lastErr, /比畫面上的舊/);
  body = { ...MKT, time: "09:58:00", sourceTime: "09:58:00", live: false, dataStatus: "delayed", isLastGood: true };
  assert.equal((await load()).time, "10:00:00", "同一天較早的快照不蓋掉較新的");
  body = { ...MKT, time: "10:00:30", sourceTime: "10:00:30" };
  assert.deepEqual(await load(), { date: "2026-10-05", time: "10:00:30", lastErr: null }, "較新的照常更新、原因清掉");
  body = { ...MKT, live: false, time: null, sourceTime: null, dataStatus: "confirmed", source: "證交所、櫃買中心 今日收盤行情" };
  assert.equal((await load()).time, null, "當天收盤確認沒有來源時間，也要能更新");
  await ctx.close(); assert.deepEqual(errs, []);
});
