import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 6, 1) + i * 864e5).toISOString().slice(0, 10)).filter(d => new Date(d).getUTCDay() % 6);

for (const width of [1280, 390]) {
  test(`個股「籌碼 → 資券與外資」：融資融券、券資比、外資持股走勢圖，按著看數字 (${width}px)`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.route("**/api/stockinfo**", r => J(r, { ok: true, code: "2330", inst: dates.map((d, i) => ({ d, foreign: 100 - i, trust: 5, dealer: -3 })), margin: dates.map((d, i) => ({ d, marginBal: 20000 + i * 150, shortBal: 800 + (i % 7) * 60, marginLimit: 500000 })), per: [], revenue: [], fin: [] }));
    await p.route("**/api/company**", r => J(r, { ok: true, code: "2330", foreign: dates.map((d, i) => ({ d, ratio: 72 + i * 0.05, limit: 100 })) }));
    await p.evaluate(() => { W.dsub.chips = "mgfr"; select("2454"); setDtab("chips"); }); // 開頁時預設個股已經載入過（用別檔才會走上面的假資料）
    await p.waitForSelector("#sxBox .tschart path");
    const t = await p.textContent("#sxBox");
    assert.ok(t.includes("融資餘額") && t.includes("券資比") && t.includes("外資持股"), "三種資料都有");
    assert.equal(await p.locator("#sxBox .tsbox").count(), 1);
    assert.ok(await p.locator("#sxBox .tschart path").count() >= 3, "融資、股價、外資持股都畫成線");
    assert.ok(await p.locator("#sxBox .tschart rect").count() > 20, "融券畫成柱");
    await p.locator("#sxBox .tschart").scrollIntoViewIfNeeded(); const bb = await p.locator("#sxBox .tschart").boundingBox();
    if (width < 500) await p.touchscreen.tap(bb.x + bb.width * 0.9, bb.y + 40); else await p.mouse.move(bb.x + bb.width * 0.9, bb.y + 40); // 手機用點的
    await p.waitForSelector("#sxBox .tstip:not([hidden])");
    const tip = await p.textContent("#sxBox .tstip");
    assert.match(tip, /2026-0\d-\d\d/); assert.ok(tip.includes("融資餘額") && tip.includes("%"), tip);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
    // 法人與基金：外資持股改成連到走勢圖（不重複放數字表）
    await p.evaluate(() => setDsub("inst")); await p.waitForSelector('[data-sxgo="mgfr"]'); await p.click('[data-sxgo="mgfr"]');
    await p.waitForSelector("#sxBox .tschart"); assert.equal(await p.evaluate(() => W.dsub.chips), "mgfr");
    await ctx.close();
    assert.deepEqual(errs, []);
  });
}

test("盤後「外資持股」：類股比率、前 20 名長條圖，上市／上櫃切換；大盤融資融券改成走勢圖", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.route("**/data/market/after.json**", r => J(r, { updated: "2026-10-20T10:00:00Z", date: "2026-10-20", frDate: "2026-10-20", ranks: [],
    hist: dates.map((d, i) => ({ d, inst: { total: 10 - i }, margin: { finBal: 6000 + i * 5, finChg: i % 3 - 1, shortBal: 200000 + i * 100, shortChg: 100 - i * 4 } })),
    fr: { 2330: 73.2, 2317: 40.1, 2454: 60.5 }, frPrev: { 2330: 73.0, 2317: 40.4, 2454: 60.5 } }));
  await p.route("**/api/oapi**", r => { const u = new URL(r.request().url()), path = u.searchParams.get("p");
    const rows = { "/fund/MI_QFIIS_cat": [{ IndustryCat: "半導體業", Numbers: "160", Percentage: "65.10" }, { IndustryCat: "水泥工業", Numbers: "7", Percentage: "12.30" }],
      "/fund/MI_QFIIS_sort_20": [{ Rank: "1", Code: "2923", Name: "鼎固-KY", SharesHeldPer: "99.49", Upperlimit: "100.00" }],
      "/tpex_3insti_qfii_industry": [{ Industry: "光電業", NumberOfCompanies: "48", "PercentageOfSharesOC/FMIHeld": "16.62%" }],
      "/tpex_3insti_qfii": [{ SecuritiesCompanyCode: "8455", CompanyName: "大拓-KY", "PercentageOfSharesOC/FMIHeld": "87.84%" }] }[path] || [];
    J(r, { ok: true, total: rows.length, all: rows.length, cols: [], rows }); });
  await p.evaluate(() => { W.afView = "fr"; setLt("after"); });
  await p.waitForSelector(".afbars li");
  let t = await p.textContent(".after");
  assert.ok(t.includes("半導體業") && t.includes("65.10%") && t.includes("鼎固-KY"), "上市類股與前 20 名");
  assert.ok(t.includes("外資持股增加最多") && t.includes("+0.20"), "個股外資持股增減");
  await p.click('[data-affrm="上櫃"]'); await p.waitForFunction(() => document.querySelector(".after").textContent.includes("光電業"));
  t = await p.textContent(".after"); assert.ok(t.includes("16.62%") && t.includes("大拓-KY"), "上櫃");
  assert.equal(await p.evaluate(() => store.get("watch:affrm")), "上櫃", "記住上市／上櫃");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.evaluate(() => { W.afView = "margin"; renderList(); });
  await p.waitForSelector(".after .tschart");
  assert.ok((await p.textContent(".after .tschart")).includes("融券餘額"));
  await ctx.close();
  assert.deepEqual(errs, []);
});
