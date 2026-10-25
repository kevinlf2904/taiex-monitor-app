// 盤中監控 M1（P4）：分頁位置、網址、自選＋庫存分批抓報價、事件升級不重開、過期不判斷、來源失敗與休市的狀態、事件詳情、不同步
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, watchFrame } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const TODAY = "2026-10-26";
// 假報價：T00 跌幅由 window.__t0 控制；9999 跌 8%、2330（庫存）漲停、其他 +1%；__fail＝回失敗；__time＝報價時間
async function quotes(ctx) {
  const reqs = [];
  await ctx.route("**/api/quote**", async r => { const u = new URL(r.request().url()), codes = (u.searchParams.get("codes") || "").split(",").filter(Boolean); reqs.push(codes);
    const [fail, t0, time] = await r.request().frame().evaluate(() => [!!window.__fail, window.__t0 ?? -2, window.__time || "10:00:00"]).catch(() => [false, -2, "10:00:00"]);
    if (fail) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "證交所逾時" }) });
    const q = c => { const prev = 100, price = c === "T00" ? 100 * (1 + t0 / 100) : c === "9999" ? 92 : c === "2330" ? 110 : 101; return { code: c, name: "股" + c, price, prev, chg: price - prev, chgPct: +((price / prev - 1) * 100).toFixed(2), date: TODAY, time, market: "上市" }; };
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "open", today: TODAY, quotes: codes.map(q) }) }); });
  return reqs;
}
const setup = async (p, at = `${TODAY}T10:00:00+08:00`) => { await p.clock.setFixedTime(new Date(at)); await p.evaluate(() => { twHolSet([{ date: "2026-01-01", name: "開國紀念日" }]); W.today = "2026-10-26"; W.mon = null; W.monE = null; localStorage.removeItem("kline:watch:mon:v1:2026-10-26"); W.hold = { 2330: { sh: 1000, cost: 500 }, AAPL: { sh: 1, cost: 1 } }; W.groups[0].list = ["9999", "1101", ...Array.from({ length: 44 }, (_, i) => String(3000 + i))]; window.__notes = []; window.notify = (t, b) => __notes.push(t); }); };

for (const width of [390, 1280]) test(`盤中監控：分批抓自選＋庫存、事件升級不重開、通知只推警示、事件詳情 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 }); const reqs = await quotes(ctx); await setup(p);
  const L = await p.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].map(b => b.dataset.l));
  assert.equal(L.indexOf("mon"), L.indexOf("today") + 1, "盤中監控排在今日市場後面");
  reqs.length = 0; await p.evaluate(() => monTick());
  const asked = reqs.flat(); assert.ok(reqs.length >= 2 && reqs.every(x => x.length <= 40), `每批最多 40 檔：${reqs.map(x => x.length)}`);
  for (const c of ["T00", "2330", "9999", "1101", "3043"]) assert.ok(asked.includes(c), `有抓 ${c}`); assert.ok(!asked.includes("AAPL"), "只監控台股庫存");
  let E = await p.evaluate(() => monE("2026-10-26"));
  assert.deepEqual(Object.keys(E).sort(), ["2026-10-26:IDX:T00:dn", "2026-10-26:SYM:2330:up", "2026-10-26:SYM:9999:dn"]);
  assert.deepEqual((await p.evaluate(() => __notes)).sort(), ["庫存 股2330 漲停", "自選 股9999 跌超過 7%"].sort(), "只推警示（大盤跌 2% 是注意，不推）");
  // 大盤再跌：同一件升級，不開新的
  await p.evaluate(() => { window.__t0 = -3.4; }); await p.evaluate(() => monTick());
  E = await p.evaluate(() => monE("2026-10-26")); assert.equal(Object.keys(E).length, 3); assert.equal(E["2026-10-26:IDX:T00:dn"].level, 3); assert.equal(E["2026-10-26:IDX:T00:dn"].snaps.length, 2);
  // 頁面、詳情、網址
  await p.evaluate(() => setLt("mon")); await p.waitForSelector("#lx .mon-ev");
  const t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /^監控中[\s\S]*盤中監控[\s\S]*■ 警示/, "狀態列在最上面（和今日市場一樣）"); assert.match(t, /大盤＋自選 \d+ 檔＋台股庫存 1 檔/);
  await p.click("#lx .mon-ev"); await p.waitForFunction(() => !$("#sheet").hidden && /當時的報價/.test($("#sheetExtra").innerText));
  assert.match(await p.evaluate(() => routeOf()), /^monitor\/[0-9a-f]{8}$/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 不雲端同步
  assert.equal(await p.evaluate(() => Object.keys(syncSnap()).some(k => k.includes(":mon:"))), false);
  await p.evaluate(() => clearTimeout(W.monTimer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("報價過期不判斷；來源連續失敗記一件、畫面說「不代表沒有事件」；休市與待確認不抓 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true }); const reqs = await quotes(ctx); await setup(p);
  await p.evaluate(() => { window.__time = "09:50:00"; }); await p.evaluate(() => monTick());
  assert.deepEqual(Object.keys(await p.evaluate(() => monE("2026-10-26"))), [], "10 分鐘前的報價不判斷");
  await p.evaluate(() => { window.__fail = true; }); await p.evaluate(async () => { await monTick(); await monTick(); setLt("mon"); });
  assert.ok((await p.evaluate(() => Object.keys(monE("2026-10-26")))).includes("2026-10-26:DATA:src:fail"));
  const t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /來源失敗/); assert.doesNotMatch(t, /今天目前沒有觸發事件/);
  // 休市（週日）、交易日待確認（休市日表抓不到）：不抓報價
  reqs.length = 0; await p.clock.setFixedTime(new Date("2026-10-25T10:00:00+08:00")); await p.evaluate(() => { window.__fail = false; return monTick(); }); assert.equal(reqs.length, 0, "休市不抓");
  await p.evaluate(() => renderList()); assert.match(await p.evaluate(() => $("#lx").innerText), /未開盤／休市[\s\S]*今天休市，不監控/);
  await p.clock.setFixedTime(new Date(`${TODAY}T10:00:00+08:00`)); await p.evaluate(() => { Object.assign(TWHOL, { set: null, mark: null, failAt: Date.now() }); return monTick(); }); assert.equal(reqs.length, 0, "待確認不抓");
  await p.evaluate(() => renderList()); assert.match(await p.evaluate(() => $("#lx").innerText), /交易日待確認/);
  await p.evaluate(() => clearTimeout(W.monTimer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("伺服器巡檢（M2）：網頁合併伺服器事件、標「伺服器」、顯示巡檢狀態與 Telegram 推播紀錄；連續失敗顯示中斷 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true }); await quotes(ctx); await setup(p);
  const at = Date.parse(`${TODAY}T09:55:00+08:00`), runs = { cur: { last: at, lastOk: at, ok: 10, fail: 0, streak: 0, err: "" } };
  const ev = { id: `${TODAY}:SYM:2454:dn`, type: "SYM", code: "2454", dir: "dn", level: 3, sev: "alert", title: "股2454 跌停", msg: "股2454 2454 90.0（-10.00%）", px: 90, pct: -10, first: at, last: at, state: "open", snaps: [{ at, px: 90, pct: -10 }], notified: [{ ch: "tg", at, ok: true, n: 3 }], origin: "server" };
  await ctx.route("**/api/sync?op=mon**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, kv: true, events: [ev], runs: runs.cur }) }));
  await p.evaluate(() => monTick()); await p.evaluate(() => setLt("mon")); await p.waitForSelector("#lx .mon-ev");
  let t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /伺服器巡檢正常：最後一次 09:55:00/); assert.match(t, /股2454 跌停[\s\S]*伺服器・09:55:00/);
  assert.ok(await p.evaluate(() => Object.keys(monE("2026-10-26")).includes("2026-10-26:SYM:2454:dn")), "存進這台的事件表");
  await p.click(`#lx .mon-ev[data-mon="${await p.evaluate(id => monHash(id), ev.id)}"]`); await p.waitForFunction(() => !$("#sheet").hidden && /Telegram 推播 3 人/.test($("#sheetExtra").innerText));
  assert.equal((await p.evaluate(() => __notes)).includes("股2454 跌停"), false, "伺服器的事件不在這台再跳一次通知");
  // 連續失敗：顯示中斷（2 分鐘拿一次，測試裡把上次時間清掉）
  runs.cur = { ...runs.cur, streak: 3, err: "證交所逾時" }; await p.evaluate(() => { W.mon.srvAt = 0; $("#sheet").hidden = true; return monTick(); });
  t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /伺服器巡檢中斷（連續 3 次失敗：證交所逾時）/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.evaluate(() => clearTimeout(W.monTimer));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("工具 → 提醒：多了「盤中警示」（只有 Telegram，勾了不跳網頁通知要求）1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => setLt("tools")); await p.waitForSelector('#lx [data-eva="mon"]', { timeout: 15000 });
  assert.match(await p.evaluate(() => $('#lx [data-eva="mon"]').closest("label").innerText), /盤中警示[\s\S]*15 分鐘最多一則、每天最多 20 則/);
  await p.check('#lx [data-eva="mon"]'); assert.equal(await p.evaluate(() => store.get("watch:evalert").mon), true);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("網址 #monitor 打開盤中監控；自訂過分頁順序（沒有盤中監控）的人：排在今日市場後面、不改寫設定 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#monitor", { width: 390, touch: true });
  const f = await watchFrame(p); assert.equal(await p.evaluate(() => CUR_TAB), "intel"); await f.waitForFunction(() => W.lt === "mon");
  await f.evaluate(() => { store.set("watch:tabcfg", { order: ["money", "today", "earn"], hide: [] }); modeUi(); });
  const L = await f.evaluate(() => [...document.querySelectorAll("#lTabs [data-l]")].map(b => b.dataset.l));
  assert.equal(L.indexOf("mon"), L.indexOf("today") + 1, JSON.stringify(L)); assert.ok(L.indexOf("money") < L.indexOf("today"));
  assert.deepEqual(await f.evaluate(() => store.get("watch:tabcfg")), { order: ["money", "today", "earn"], hide: [] });
  await ctx.close(); assert.deepEqual(errs, []);
});
