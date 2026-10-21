import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
// 假的財報總表：[代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]
const ROWS = [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7], ["2317", "鴻海", "其他電子業", "上市", 7800, -3.2, 12.1, 18.0, 3.1, 18000, 430, 6.2, 2.9, 2.4],
  ["1101", "台泥", "水泥工業", "上市", 143, 6.0, 7.6, 3.3, 0.38, 713, 45.7, 18.2, 7.3, 6.4], ["1102", "亞泥", "水泥工業", "上市", 70, -2, -12.5, -5, -0.2, 210, -3, 9, -1, -1.4],
  ["1103", "嘉泥", "水泥工業", "上市", 5, 1, 3, 2, 0.1, 15, 0.5, 8, 2, 3], ["6488", "環球晶", "半導體業", "上櫃", 50, 2, -8.3, -6, 2.5, 160, 12, 30, 20, 7.5],
  ["3105", "穩懋", "半導體業", "上櫃", 15, 8, 45, 22, 1.2, 45, 5, 25, 12, 11], ["9999", "小公司", "其他業", "上櫃", 0.3, 300, 900, 500, 0.01, 1, 0.01, 1, 1, 1]];

for (const width of [1280, 390]) {
  test(`情報局「財報」：總覽、月營收／EPS／獲利能力排行、產業比較，可篩市場 (${width}px)`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
    const seen = []; p.on("request", q => seen.push(q.url()));
    await p.route("**/api/stockinfo**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "2330", inst: [], margin: [], per: [],
      revenue: Array.from({ length: 24 }, (_, i) => ({ ym: `${2024 + (i >= 12 ? 1 : 0)}-${String(i % 12 + 1).padStart(2, "0")}`, rev: 2e11 + i * 5e9, yoy: 20 + i })), fin: Array.from({ length: 8 }, (_, i) => ({ q: `${2024 + (i >> 2)}Q${i % 4 + 1}`, eps: 8 + i, gross: 55 + i / 2 })) }) }));
    await p.route("**/api/oapi?earn=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }) }));
    assert.equal(await p.locator('#lTabs [data-l="earn"]').isVisible(), true, "情報局有財報分頁");
    await p.click('#lTabs [data-l="earn"]');
    await p.waitForSelector(".earn .erlist li");
    let t = await p.textContent(".earn");
    assert.ok(t.includes("2026 年 9 月") && t.includes("2026 年第 2 季"), "民國年月換成西元");
    assert.ok(t.includes("台積電") && !t.includes("小公司"), "預設排除月營收 1 億以下的公司");
    await p.click('[data-erv="rev"]'); await p.waitForSelector(".erchips");
    const first = () => p.evaluate(() => document.querySelector(".erlist .nm")?.firstChild?.textContent);
    assert.equal(await first(), "穩懋", "年增最高");
    await p.click('[data-errk="rev:yoyd"]'); assert.equal(await first(), "亞泥", "年減最多");
    await p.click('[data-ermk="上市"]'); assert.ok(!(await p.textContent(".earn")).includes("環球晶"), "只看上市");
    await p.click('[data-erv="eps"]'); assert.equal(await first(), "台積電");
    await p.click('[data-erv="pm"]'); assert.equal(await first(), "台積電");
    // 分產業排名：選水泥工業 → 只列水泥股，依年增排序；全部排行附「產業第幾名」
    await p.click('[data-ermk="全部"]'); await p.click('[data-erv="rev"]'); await p.click('[data-errk="rev:yoy"]');
    assert.match(await p.textContent(".erlist"), /半導體業第 1／\d/);
    await p.selectOption("[data-erind]", "水泥工業"); assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".erlist .nm")].map(x => x.firstChild.textContent)), ["台泥", "嘉泥", "亞泥"], "產業內排名");
    await p.click('[data-erindset=""]'); assert.equal(await p.evaluate(() => ER().ind), "");
    await p.click('[data-erv="ind"]'); assert.ok((await p.textContent(".erind")).includes("水泥工業"));
    await p.click('.erind [data-erindset="水泥工業"]'); assert.equal(await p.evaluate(() => [ER().view, ER().ind].join()), "rev,水泥工業", "點產業切到產業內排名");
    await p.click('[data-erindset=""]'); await p.click('[data-ermk="上市"]'); await p.click('[data-erv="ind"]');
    assert.deepEqual(await p.evaluate(() => { const x = store.get("watch:er"); return { view: x.view, rk: x.rk, mk: x.mk, min: x.min, reg: x.reg }; }), { view: "ind", rk: { rev: "yoy" }, mk: "上市", min: true, reg: "tw" }, "記住上次的設定");
    assert.ok(await p.evaluate(() => routeOf()) === "earnings/industry", "網址路由");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
    // 點公司展開營收、EPS 走勢圖（有查價線），再點「看個股」才進個股
    await p.click('[data-erv="eps"]'); await p.click(".erlist li button[data-ertr]"); await p.waitForSelector(".ertr .tsbox svg");
    const tt = await p.textContent(".ertr"); assert.ok(tt.includes("月營收") && tt.includes("季 EPS"), tt.slice(0, 80));
    assert.ok(seen.some(u => u.includes("/api/stockinfo?code=2330")));
    await p.click('.ertr [data-sel="2330"]'); await p.waitForFunction(() => W.sel === "2330");
    await ctx.close();
    assert.deepEqual(errs, []);
  });
}

test("情報局「財報 → 美股」：最近公布、即將公布、優於／低於預期，點公司看營收與 EPS 走勢", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await p.route("**/data/us-earn.json**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "Nasdaq 財報行事曆", at: new Date().toISOString(), from: day(-14), to: day(14), rows: [
    [day(-2), "NFLX", "Netflix", 520, 6.1, 5.4, 13, "盤後", "Sep/2026", null], [day(-1), "TSLA", "特斯拉", 1400, 0.5, 0.62, -19.4, "盤後", "Sep/2026", null],
    [day(-3), "JPM", "摩根大通", 800, 5.2, 4.9, 6.1, "盤前", "Sep/2026", null], [day(2), "AAPL", "蘋果", 3800, null, 2.02, null, "盤後", "Sep/2026", 1.85], [day(1), "SMALL", "小公司", 20, null, 1, null, "", "", null]] }) }));
  await p.route("**/api/usinfo**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "TSLA", fin: { q: [{ p: "2025Q3", rev: 2.5e10, ni: 1.4e9 }, { p: "2025Q4", rev: 2.6e10, ni: 1.2e9 }, { p: "2026Q1", rev: 2.2e10, ni: 0.4e9 }] }, earn: [{ y: 2026, q: 1, actual: 0.27, est: 0.43, surp: -37 }, { y: 2026, q: 2, actual: 0.4, est: 0.4, surp: 0 }] }) }));
  await p.click('#lTabs [data-l="earn"]'); await p.click('[data-erreg="us"]');
  await p.waitForSelector(".earn .erlist li");
  const names = () => p.evaluate(() => [...document.querySelectorAll(".erlist .nm")].map(x => x.firstChild.textContent));
  assert.deepEqual(await names(), ["特斯拉", "Netflix", "摩根大通"], "最近公布：新的在前，預設只看大型股");
  await p.click('[data-erv="beat"]'); assert.deepEqual(await names(), ["Netflix", "摩根大通", "特斯拉"]);
  await p.click('[data-erv="miss"]'); assert.equal((await names())[0], "特斯拉");
  await p.click('[data-erv="up"]'); assert.deepEqual(await names(), ["蘋果"], "即將公布（小公司被大型股篩掉）");
  await p.click("[data-erbig]"); assert.deepEqual(await names(), ["小公司", "蘋果"]);
  await p.click('[data-erv="miss"]'); await p.click('.erlist button[data-ertr="TSLA"]'); await p.waitForSelector(".ertr .tsbox svg");
  assert.ok((await p.textContent(".ertr")).includes("EPS 實際 vs 預估"));
  assert.equal(await p.evaluate(() => store.get("watch:er").reg), "us", "記住看美股");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close();
  assert.deepEqual(errs, []);
});
