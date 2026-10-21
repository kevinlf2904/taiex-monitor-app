// 大盤 → 櫃買：指數、量值、產業營收熱圖、創新高、董監、權證、暫停預告、興櫃、黃金、可轉債每個分頁都畫得出來，手機不橫向溢出
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";
import { IX_COLS } from "../../scripts/tpex-daily.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const ds = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 6, 1) + i * 864e5).toISOString().slice(0, 10));
const ym = i => `${2025 + Math.floor((9 + i) / 12)}-${String((9 + i) % 12 + 1).padStart(2, "0")}`;
export const FIX = {
  updated: "2026-10-21T09:30:00Z",
  ix: { cols: IX_COLS, rows: ds.map((d, i) => [d, ...IX_COLS.slice(1).map((c, j) => +(300 + j * 20 + i * (1 + (j % 3)) * 0.3 + Math.sin(i / 5) * 4).toFixed(2))]) },
  vol: ds.map((d, i) => [d, 10 + (i % 5), 2000 + (i % 9) * 120, 120, 400 + i * 0.3]),
  wt: { cols: ["上櫃權證總數", "上櫃權證發行總數", "上櫃權證交易人數"], rows: ds.map((d, i) => [d, 12000, 80, 5000 + (i % 7) * 300]) },
  gold: ds.flatMap(d => [[d, "AU9901", "臺銀金", 16100, 16200, 16000, 1000], [d, "AU9902", "一銀金", 16090, 16190, 15990, 100]]),
  revm: Array.from({ length: 12 }, (_, i) => ({ ym: ym(i), n: 890, up: 300 + i * 5, ind: { 半導體業: [800 + i * 10, 20 - i, 3, 40], 生技醫療業: [300, -8 + i, -1, 60], 電子零組件業: [500, 5, 1, 80] }, hi: i === 11 ? [["3105", "穩懋", "半導體業", 15.7, 28.4, 24], ["6488", "環球晶", "半導體業", 60.2, 12.1, 24]] : [] })),
  snap: {
    pledge: { date: "2026-08-19", buckets: [["90 以上", 3], ["80 以上", 5], ["20 以下", 30]], top: [["4502", "健信", 99.8], ["7723", "築間", 86.7]] },
    short: { date: "2026-08-19", rows: [["3122", "笙泉", 3600, 2105, 1495, 41.5]] },
    fc: { a: [], b: [] },
    sus: [["00694B", "富邦美債1-3", "2026-10-14", "2026-10-21", "分配收益"], ["00695B", "富邦美債7-10", "2026-10-14", "2026-10-21", "分配收益"], ["8936", "國統", "2026-10-20", "2026-10-28", "股東會"]],
    sss: [["8936", "國統", "2026-10-16", "2026-10-21", ""]],
    esb: { date: "2026-10-21", rows: [[1, "7861", "貝爾威勒", 22.85], [2, "6826", "和淞", 13.94], [3, "6696", "仁新*", -10.53]] },
    gold: [{ d: "2026-10-21", t: "163005", code: "AU9901", name: "臺銀金", buy: 16064, sell: 16120, chg: -1.19, avg: 16185.5, pavg: 16223.4, hi: 16268, lo: 16110, last: 16120, vol: 1069, n: 321 }],
    cb: { date: "2026-10-21", rows: [["1020", "合庫", 0, 0, 41, 4275350], ["9B00", "台新", 1726, 214526850, 1660, 209144950], ["1040", "臺銀證券", 10, 1131300, 14, 1614200]] },
    wtu: { date: "2026-10-21", rows: [["5274", "信驊", 5200, 800, 40, 16515, 615], ["8096", "擎亞", 300, 900, 12, 84.8, 1.4]] },
  },
};

for (const width of [1280, 390]) test(`櫃買圖表 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 }), shot = async v => process.env.SHOT && await p.screenshot({ path: `${process.env.SHOT}/otc-${v}-${width}.png`, fullPage: true });
  await ctx.route("**/data/tpex.json", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(FIX) }));
  await p.evaluate(() => setLt("mkt")); await p.waitForTimeout(500);
  await p.click('#lx [data-mk="mkReg"][data-v="otc"]'); await p.waitForSelector("#lx .otcbox .tschart");
  const wide = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  assert.match(await p.evaluate(() => $("#lx").innerText), /櫃買指數 vs 報酬指數[\s\S]*股息再投入[\s\S]*主題指數比較[\s\S]*富櫃 50[\s\S]*勞工就業 88/);
  await p.click('#lx [data-mk="otcTr"][data-v="r"]'); await p.click('#lx [data-mk="otcRng"][data-v="20"]');
  assert.equal(await p.evaluate(() => W.otc.tr + W.otc.rng), "r20"); assert.ok(await wide(), "指數"); await shot("ix");
  const views = { vol: /上櫃日成交量值[\s\S]*20 日均量/, rev: /產業營收年增率[\s\S]*半導體業[\s\S]*生技醫療業/, hi: /營收創新高家數[\s\S]*穩懋[\s\S]*創 24 個月新高/, fc: /財測達成情形[\s\S]*不公開財務預測/,
    dir: /董監質押比例分布[\s\S]*健信[\s\S]*持股不足[\s\S]*笙泉/, wt: /每日權證交易人數[\s\S]*交易人數[\s\S]*信驊/, sus: /暫停先賣後買當沖預告[\s\S]*暫停融券賣出預告/, esb: /興櫃公司 EPS 分布[\s\S]*貝爾威勒/, gold: /黃金現貨當日行情[\s\S]*臺銀金[\s\S]*每日均價/, cb: /可轉債買賣斷[\s\S]*台新/ };
  for (const [v, re] of Object.entries(views)) {
    await p.$eval(`#lx [data-mk="otcV"][data-v="${v}"]`, b => b.click()); await p.waitForTimeout(150);
    assert.match(await p.evaluate(() => $("#lx .otcbox").innerText), re, v); assert.ok(await wide(), `${v} 橫向溢出`); await shot(v);
  }
  await p.$eval('#lx [data-mk="otcV"][data-v="rev"]', b => b.click()); await p.waitForTimeout(100);
  await p.$eval('#lx [data-mk="otcInd"][data-v="半導體業"]', b => b.click()); await p.waitForTimeout(100);
  assert.match(await p.evaluate(() => $("#lx .otcbox").innerText), /半導體業：逐月營收/);
  await p.$eval('#lx [data-mk="otcV"][data-v="sus"]', b => b.click()); await p.waitForTimeout(100);
  assert.match(await p.evaluate(() => $("#lx .otc-gantt").textContent), /富邦美債1-3 等 2 檔/);
  assert.deepEqual(await p.evaluate(() => [store.get("watch:mkReg"), store.get("watch:otc").view]), ["otc", "sus"]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("櫃買：排程還沒產生檔案", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/data/tpex.json", r => r.fulfill({ status: 404, body: "" }));
  await p.evaluate(() => { W.mkReg = "otc"; setLt("mkt"); }); await p.waitForSelector("#lx .err");
  assert.match(await p.evaluate(() => $("#lx").innerText), /排程還沒跑完第一次/);
  await ctx.close(); assert.deepEqual(errs.filter(e => !/404/.test(e)), []);
});
