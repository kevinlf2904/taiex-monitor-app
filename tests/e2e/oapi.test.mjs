import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
// 證交所、櫃買開放資料的假資料：資料集表格、個股常用資料
const mockOapi = async (p, seen) => p.route("**/api/oapi**", r => { const u = new URL(r.request().url()); seen.push(u.search);
  if (u.searchParams.get("stock")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, code: "2330", items: [
    { k: "div", t: "股利分派", src: "twse", path: "/opendata/t187ap45_L", rows: [{ 公司代號: "2330", 公司名稱: "台積電", 股利年度: "114", "股東配發-盈餘分配之現金股利(元/股)": "18.0" }] },
    { k: "mon", t: "月成交資訊", src: "twse", path: "/exchangeReport/FMSRFK_ALL", rows: [{ Month: "11508", Code: "2330", TradeVolume: "500000000" }, { Month: "11509", Code: "2330", TradeVolume: "520000000" }] }] }) });
  const code = u.searchParams.get("code"), rows = [{ 公司代號: "2330", 公司名稱: "台積電", 股利年度: "114", 決議日期: "1150210", 網址: "https://example.com" }, { 公司代號: "2317", 公司名稱: "鴻海", 股利年度: "114", 決議日期: "1150301", 網址: "" }].filter(x => !code || x.公司代號 === code);
  return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, src: u.searchParams.get("src"), path: u.searchParams.get("p"), total: rows.length, all: 2, cols: Object.keys(rows[0] || { 公司代號: 1 }), codeKey: "公司代號", rows, more: false }) }); });

for (const width of [1280, 390]) {
  test(`工具 → 官方資料：挑資料集、看原始表格、只看某一檔 (${width}px)`, async () => {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 }), seen = [];
    await mockOapi(p, seen);
    await p.evaluate(() => { W.tv = "oapi"; setLt("tools"); });
    await p.waitForSelector(".oalist button");
    assert.ok(await p.locator(".oalist button").count() > 300, "列出證交所、櫃買的全部資料集");
    await p.fill(".oas", "股利分派");
    assert.ok(await p.evaluate(() => document.activeElement?.matches(".oas")), "輸入時不會失去焦點");
    const n = await p.locator(".oalist button").count(); assert.ok(n >= 1 && n < 10, `找資料集只剩相關的（${n}）`);
    await p.click('.oalist button[data-oads="上市|/opendata/t187ap45_L"]');
    await p.waitForSelector(".oatbl td");
    assert.equal(await p.locator(".oatbl tbody tr").count(), 2);
    assert.ok((await p.textContent(".oatbl tbody")).includes("115/02/10"), "民國日期轉成 115/02/10");
    if (width < 500) assert.equal(await p.locator("#oaList").isVisible(), false, "手機選了資料集就只看表格");
    await p.fill('.oaq input[name="code"]', "2330"); await p.click(".oaq .btn.primary");
    await p.waitForFunction(() => document.querySelectorAll(".oatbl tbody tr").length === 1);
    assert.ok(seen.some(s => s.includes("code=2330") && s.includes("src=twse")), "查詢帶上代號與市場");
    assert.equal(await p.textContent('.oatbl [data-tsel="2330"]'), "2330", "代號可以點進個股");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "頁面沒有橫向溢出（表格在自己的框裡捲）");
    assert.deepEqual(await p.evaluate(() => store.get("watch:oa").sel), ["上市", "/opendata/t187ap45_L"], "記住上次看的資料集");
    if (width < 500) { await p.click("[data-oaback]"); await p.waitForSelector("#oaList .oalist"); assert.ok(await p.locator("#oaList").isVisible()); }
    await ctx.close();
    assert.deepEqual(errs, []);
  });
}

test("個股「財務 → 官方資料」：顯示這檔的官方資料，可以跳到整份資料", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true }), seen = [];
  await mockOapi(p, seen);
  await p.evaluate(() => { W.dsub.fin = "oapi"; select("2330"); setDtab("fin"); });
  await p.waitForSelector(".oacard");
  assert.equal(await p.locator(".oacard").count(), 2);
  const t = await p.textContent("#sxBox");
  assert.ok(t.includes("股利分派") && t.includes("18.0") && !t.includes("台積電"), "一筆的用欄位卡片、不重複列公司名稱");
  assert.ok(seen.some(s => s.includes("stock=2330")));
  await p.click('[data-oaopen="上市|/exchangeReport/FMSRFK_ALL"]');
  await p.waitForSelector(".oa .oatbl td");
  assert.deepEqual(await p.evaluate(() => [W.lt, W.tv, W.oa.code]), ["tools", "oapi", "2330"]);
  await ctx.close();
  assert.deepEqual(errs, []);
});
