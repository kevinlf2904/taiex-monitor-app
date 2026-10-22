// 大盤 → 官方公告：每個分頁都畫得出來、篩選與搜尋、個股徽章、提及標的的異常推介提醒、存股的定期定額熱門、行事曆休市日
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";
import { officialPack } from "../../api/_lib/official.js";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), roc = d => `${+d.slice(0, 4) - 1911}${d.slice(5, 7)}${d.slice(8, 10)}`;
const PACK = { ok: true, at: new Date().toISOString(), source: "測試", miss: [], ...officialPack({
  newsL: [{ "發言日期": roc(today), "發言時間": "143000", "公司代號": "2330", "公司名稱": "台積電", "主旨 ": "公告董事會決議股利", "符合條款": "第14款", "說明": "1.董事會決議日期" }, { "發言日期": roc(today), "發言時間": "090000", "公司代號": "1101", "公司名稱": "台泥", "主旨 ": "澄清媒體報導", "符合條款": "第51款", "說明": "說明" }],
  abn: [{ Number: "1", Code: "2603", Name: "長榮", Date: roc(today) }],
  fineL: [{ "發函日期": roc(today), "股票代號": "2330", "公司名稱": "台積電", "違規事由": "測試事由", "違反法規": "證交法", "裁處情形": "處罰鍰 24 萬元" }],
  ctrlL: [{ "公司代號": "1101", "公司名稱": "台泥", "經營權異動日期": roc(today), "經營權異動說明": "改選" }],
  s3L: [{ "連續不足達3個月": "2317" }], altL: [{ Code: "1213", Name: "大飲", PeriodicCallAuctionTrading: " " }],
  newL: [{ Code: "6467", Company: "泰合", ApprovedListingDate: roc(today), Underwriter: "元大", UnderwritingPrice: "105.6" }],
  first5L: [{ SecurCode: "7689", SecurName: "大鵬科", "1stTradingDate": roc(today), "5thTradingDate": roc(today), PriceUnderwritten: "180.5" }],
  esbQ: [{ Date: roc(today), SecuritiesCompanyCode: "1260", CompanyName: "富味鄉", PreviousAveragePrice: "30", Average: "31.5", TransactionVolume: "10996" }, { SecuritiesCompanyCode: "9957", CompanyName: "燁聯", PreviousAveragePrice: "6", Average: "5.7", TransactionVolume: "137166" }],
  esbRev: [{ "資料年月": "11509", "公司代號": "1260", "公司名稱": "富味鄉", "產業別": "食品工業", "營業收入-當月營收": "467614", "營業收入-去年同月增減(%)": "7", "營業收入-上月比較增減(%)": "3.8" }],
  dca: [{ No: "1", STOCKsSecurityCode: "2330", STOCKsName: "台積電", STOCKsNumberofTradingAccounts: "232850", ETFsSecurityCode: "0050", ETFsName: "元大台灣50", ETFsNumberofTradingAccounts: "1275993" }, { No: "2", STOCKsSecurityCode: "2317", STOCKsName: "鴻海", STOCKsNumberofTradingAccounts: "60000", ETFsSecurityCode: "0056", ETFsName: "元大高股息", ETFsNumberofTradingAccounts: "800000" }],
  broker: [{ StockRanking: "1", SecuritiesCompanyCodeAndCompanyName: "富喬(1815)", SecuritiesFirmsCode: "元大", TotalPurchaseShares: "34117", TotalSellShares: "29079" }],
  blockO: [{ Date: roc(today), TransactionType: "配對交易-單一型", Code: "8069", Name: "元太", TradePrice: "155.87", NumberOfSharesTraded: "736000", TradeValue: "114720320" }],
  marginL: [{ "股票代號": "2330", "股票名稱": "台積電", "融資今日餘額": "1200", "融資前日餘額": "1000", "融券今日餘額": "10", "融券前日餘額": "12" }],
  marginO: [{ Date: roc(today), SecuritiesCompanyCode: "8069", CompanyName: "元太", MarginPurchaseBalance: "500", MarginPurchaseBalancePreviousDay: "800", ShortSaleBalance: "50", ShortSaleBalancePreviousDay: "20" }],
  holiday: [{ Name: "國慶日", Date: roc(today), Description: "依規定放假1日。" }],
}) };

for (const width of [1280, 390]) test(`官方公告 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route(/\/api\/oapi\?official=1/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify(PACK) }));
  await ctx.route("**/api/market", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "測試", date: today, indices: [] }) }));
  await ctx.route("**/api/calendar**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [], conf: [], hol: [{ date: today, name: "國慶日", note: "" }] }) }));
  await p.reload(); await p.waitForTimeout(800); // 假資料要在開頁前掛好（電腦版開頁時個股徽章就會抓一次）
  await p.evaluate(() => setLt("mkt")); await p.waitForTimeout(500);
  await p.click('#lx [data-mk="mkReg"][data-v="off"]'); await p.waitForSelector("#lx .offbox");
  const wide = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), txt = () => p.evaluate(() => $("#lx .offbox").innerText);
  assert.match(await txt(), /上市櫃每日重大訊息[\s\S]*台積電[\s\S]*公告董事會決議股利[\s\S]*澄清媒體報導/);
  // 搜尋：打字就篩
  await p.fill('#lx [data-cxq="offQ"]', "1101"); await p.waitForFunction(() => W.offQ === "1101");
  assert.doesNotMatch(await txt(), /董事會決議股利/); assert.match(await txt(), /澄清媒體報導/);
  await p.fill('#lx [data-cxq="offQ"]', ""); await p.waitForFunction(() => W.offQ === "");
  const views = { risk: /異常推介個股[\s\S]*長榮[\s\S]*變更交易[\s\S]*大飲[\s\S]*金管會裁罰[\s\S]*處罰鍰 24 萬元[\s\S]*經營權異動[\s\S]*台泥[\s\S]*董監持股不足[\s\S]*2317/, ipo: /首五日無漲跌幅[\s\S]*大鵬科[\s\S]*最近上市[\s\S]*泰合/,
    esb: /興櫃行情[\s\S]*富味鄉[\s\S]*\+5%/, dca: /定期定額交易戶數排行[\s\S]*台積電[\s\S]*元大台灣50/, margin: /融資融券[\s\S]*上市融資餘額[\s\S]*台積電[\s\S]*\+200/, broker: /券商進出[\s\S]*富喬/, block: /鉅額交易[\s\S]*元太[\s\S]*11,472 萬/, holiday: /國慶日/ };
  for (const [v, re] of Object.entries(views)) { await p.$eval(`#lx [data-mk="offV"][data-v="${v}"]`, b => b.click()); await p.waitForTimeout(120); assert.match(await txt(), re, v); assert.ok(await wide(), `${v} 橫向溢出`);
    if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}/off-${v}-${width}.png`, fullPage: true }); }
  await p.$eval('#lx [data-mk="offV"][data-v="esb"]', b => b.click()); await p.waitForTimeout(100); await p.$eval('#lx [data-mk="offEsb"][data-v="rev"]', b => b.click()); await p.waitForTimeout(100); assert.match(await txt(), /富味鄉[\s\S]*4\.68 億/);
  // 個股徽章：重訊、警示；點了到官方公告並帶代號
  await p.evaluate(() => select("2330")); await p.waitForFunction(() => /重訊[\s\S]*警示/.test(document.getElementById("dIntel")?.innerText || ""), null, { timeout: 10000 });
  assert.match(await p.evaluate(() => $("#dIntel").innerText), /公告董事會決議股利[\s\S]*金管會裁罰/);
  // 行事曆休市日
  await p.evaluate(() => { showList(); W.mkReg = "tw"; setLt("mkt"); }); await p.waitForFunction(() => document.querySelector(".caldays button.hol"), null, { timeout: 15000 });
  assert.match(await p.evaluate(() => document.querySelector(".caldl")?.textContent || ""), /休市：國慶日/);
  // 提及標的：證交所點名的異常推介個股
  await p.evaluate(() => setLt("pod")); await p.waitForSelector("#lx .offabn"); assert.match(await p.evaluate(() => $("#lx .offabn").innerText), /長榮/);
  assert.deepEqual(await p.evaluate(() => [store.get("watch:off").view, store.get("watch:off").esb]), ["esb", "rev"]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("存股：定期定額熱門、點回測帶到真實歷史回測", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390, touch: true });
  await ctx.route(/\/api\/oapi\?src=twse&p=\/ETFReport\/ETFRank/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: [{ No: "1", STOCKsSecurityCode: "2330", STOCKsName: "台積電", STOCKsNumberofTradingAccounts: "232850", ETFsSecurityCode: "0050", ETFsName: "元大台灣50", ETFsNumberofTradingAccounts: "1275993" }] }) }));
  await p.$eval('[data-sxg="dca"]', b => b.click()); await p.waitForSelector("#dca-out .dca-l");
  assert.match(await p.evaluate(() => document.getElementById("dca-out").innerText), /元大台灣50[\s\S]*1,275,993 戶[\s\S]*台積電/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.$eval('[data-dcabt="0050"]', b => b.click()); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => [document.getElementById("hs-code").value, document.getElementById("sec-hist").hidden].join()), "0050,false");
  await ctx.close(); assert.deepEqual(errs, []);
});
