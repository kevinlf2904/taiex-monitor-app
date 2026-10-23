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

// 財報進階：行事曆、連續成長、三率轉折、我的持股、同業比較、小學堂、整體看法；個股展開的估值與公布後反應
const HIST = { updated: "2026-10-21T14:40:00Z", streak: { ym: "2026-09", rows: [["2330", "台積電", "半導體業", "上市", 18, 36.2, 3300, 36], ["3105", "穩懋", "半導體業", "上櫃", 7, 45, 15, 0], ["1101", "台泥", "水泥工業", "上市", 3, 7.6, 143, 0]] },
  pub: { ym: "2026-09", n: 1700, total: 1859, codes: ["2330", "1101"] },
  pm: { q: "2026Q2", qp: "2026Q1", qy: "2025Q2", rows: [["2330", "台積電", "半導體業", "上市", 59.1, 49.5, 42.7, 1.2, 0.8, 0.5, 5, 4, 3, 4], ["2317", "鴻海", "其他電子業", "上市", 6.2, 2.9, 2.4, -2.5, -0.3, -0.2, -0.1, 0.1, 0.2, 0], ["1101", "台泥", "水泥工業", "上市", 18.2, 7.3, 6.4, 0.5, -0.1, 0.2, 1, 1, 1, 1]] } };
for (const width of [1280, 390]) test(`財報進階：行事曆、連續成長、三率轉折、持股健檢、同業比較、小學堂、整體看法 (${width}px)`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await p.route("**/api/oapi?earn=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }) }));
  await p.route("**/data/earn-hist.json**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(HIST) }));
  await p.route("**/api/calendar**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [], conf: [{ date: "2099-01-05", time: "14:00", code: "2317", name: "鴻海", place: "台北", market: "上市" }] }) }));
  await p.route("**/api/stockinfo**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "2330", inst: [], margin: [],
    per: Array.from({ length: 300 }, (_, i) => ({ d: `2025-${String(1 + (i % 12)).padStart(2, "0")}-01`, pe: 10 + i / 20, pb: 3 + i / 100, dy: 2 })),
    revenue: Array.from({ length: 24 }, (_, i) => ({ ym: `${2024 + (i >= 12 ? 1 : 0)}-${String(i % 12 + 1).padStart(2, "0")}`, rev: 2e11 + i * 5e9, yoy: i % 3 ? 20 : -5 })), fin: [] }) }));
  await p.evaluate(() => { W.groups[0].list = ["2330", "2317"]; W.hold = { "1102": { sh: 1000, cost: 30 } }; });
  await p.click('#lTabs [data-l="earn"]'); await p.waitForSelector(".earn .erlist li");
  await p.waitForFunction(() => /動能：/.test(document.querySelector(".earn")?.textContent || ""), null, { timeout: 15000 }); // 連續成長（earn-hist）比列表晚到，main 上 CI 偶爾在它到之前就比對
  assert.match(await p.textContent(".earn"), /財報整體看法[\s\S]*整體[\s\S]*(偏強|中性|偏弱)[\s\S]*動能：2 家月營收連續年增半年以上/);
  const T = async v => { await p.click(`[data-erv="${v}"]`); await p.waitForTimeout(150); if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}/earn-${v}-${width}.png`, fullPage: true }); return p.textContent(".earn"); };
  assert.match(await T("cal"), /月營收公布截止[\s\S]*9 月營收已公布[\s\S]*1,700 家[\s\S]*還沒公布：[\s\S]*鴻海[\s\S]*即將開法說會：鴻海/);
  assert.match(await T("streak"), /連續 3 個月以上[\s\S]*3 家[\s\S]*台積電[\s\S]*18 個月/);
  await p.click('[data-exk="xs:hi"]'); assert.match(await p.textContent(".earn"), /營收創新高[\s\S]*台積電[\s\S]*36\+ 個月高/);
  assert.match(await T("turn"), /三率三升（季）[\s\S]*2 家[\s\S]*台積電/);
  await p.click('[data-exk="xt:down"]'); assert.equal(await p.evaluate(() => document.querySelector(".erlist .nm").firstChild.textContent), "鴻海", "毛利率下滑最多");
  const my = await T("my"); assert.match(my, /自選＋庫存 3 檔台股[\s\S]*有警訊[\s\S]*2 檔/); assert.ok(my.indexOf("亞泥") < my.indexOf("台積電"), "有警訊的排前面");
  assert.match(await T("cmp"), /同業比較[\s\S]*台積電[\s\S]*毛利率季變化/);
  await p.fill("[data-excmp] input", "1101 1102"); await p.click("[data-excmp] button"); assert.deepEqual(await p.evaluate(() => ER().cmp), ["1101", "1102"]);
  assert.match(await T("learn"), /三率三升[\s\S]*本益比/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 個股展開：整體看法、估值位置、月營收公布後股價反應
  await T("streak"); await p.click('[data-exk="xs:s"]'); await p.click('.erlist button[data-ertr="2330"]'); await p.waitForSelector(".excomp");
  assert.match(await p.textContent(".excomp"), /整體看法[\s\S]*基本面偏強[\s\S]*連續 18 個月年增[\s\S]*估值位置[\s\S]*本益比/);
  await p.click('.excomp [data-exk="kl:2330"]'); await p.waitForFunction(() => /年增月|資料不夠/.test(document.querySelector(".excomp")?.textContent || "")); // 法說會會自動載入（這裡沒 mock 會出現 ⚠︎），所以不能只等 ⚠︎
  assert.match(await p.textContent(".excomp"), /年增月 5 日/); if (process.env.SHOT) await (await p.$(".excomp")).screenshot({ path: `${process.env.SHOT}/earn-comp-${width}.png` });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "展開後沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("美股財報進階：財報週對應台股供應鏈、營收驚喜、整體看法、歷史驚喜紀錄", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await p.route("**/data/us-earn.json**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "Nasdaq", at: new Date().toISOString(), from: day(-14), to: day(14), rows: [
    [day(-2), "NFLX", "Netflix", 520, 6.1, 5.4, 13, "盤後", "", null, 11.5, 11.0], [day(-1), "TSLA", "特斯拉", 1400, 0.5, 0.62, -19.4, "盤後", "", null, 25, 26], [day(2), "NVDA", "輝達", 4000, null, 1.2, null, "盤後", "", 0.8, null, 50]] }) }));
  await p.route("**/data/us-earn-hist.json**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [[day(-1), "TSLA", "特斯拉", 1400, 0.5, 0.62, -19.4, "盤後", 25, 26]] }) }));
  await p.click('#lTabs [data-l="earn"]'); await p.click('[data-erreg="us"]'); await p.waitForSelector(".earn .erlist li");
  assert.match(await p.textContent(".earn"), /財報整體看法[\s\S]*EPS 優於預期 50%[\s\S]*營收優於預期 50%/);
  await p.click('[data-erv="week"]'); await p.waitForTimeout(150);
  assert.match(await p.textContent(".earn"), /會牽動哪些台股[\s\S]*輝達[\s\S]*台積電/, "輝達對應台股供應鏈");
  await p.click('[data-erv="rev"]'); await p.waitForTimeout(150);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".erlist .nm")].map(x => x.firstChild.textContent)), ["Netflix", "特斯拉"]);
  assert.match(await p.textContent(".erlist"), /雙優/);
  await p.click('.erlist button[data-ertr="TSLA"]'); await p.waitForSelector(".excomp");
  assert.match(await p.textContent(".excomp"), /歷史驚喜紀錄[\s\S]*優於預期/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
