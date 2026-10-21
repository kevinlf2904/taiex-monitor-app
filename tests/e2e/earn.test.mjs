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
    await p.click('[data-erv="ind"]'); assert.ok((await p.textContent(".erind")).includes("水泥工業"));
    assert.deepEqual(await p.evaluate(() => store.get("watch:er")), { view: "ind", rk: { rev: "yoyd" }, mk: "上市", min: true }, "記住上次的設定");
    assert.ok(await p.evaluate(() => routeOf()) === "earnings/industry", "網址路由");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
    await p.click('[data-erv="eps"]'); await p.click(".erlist li button"); await p.waitForFunction(() => W.sel === "2330");
    await ctx.close();
    assert.deepEqual(errs, []);
  });
}
