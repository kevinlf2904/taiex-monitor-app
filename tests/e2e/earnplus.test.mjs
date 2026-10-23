// 財報第二批：體質（存貨、應收、自由現金流）、股利預估、法說會重點（AI 讀簡報）、公布前後股價習慣、美股財測
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const qs = Array.from({ length: 12 }, (_, i) => `${2023 + (i >> 2)}Q${(i % 4) + 1}`);
const CO = { ok: true, code: "2330", source: "測試",
  income: qs.map((q, i) => ({ q, d: q, rev: 6e11 + i * 3e10, gp: 3e11, op: 2.4e11, ni: 2.5e11, nip: 2.5e11, eps: 9.6 + i * 0.4 })),
  balance: qs.map((q, i) => ({ q, d: q, assets: 6e12, liab: 2e12, equity: 4e12, ca: 2.5e12, cl: 1e12, parentEq: 4e12, inv: 2e11 * (i >= 8 ? 1.5 : 1), ar: 3e11 })),
  cash: qs.map((q, i) => ({ q, d: q, ocf: 3.5e11, icf: -2e11, fin: -1e11, capex: -2e11, fcf: i === 10 ? -5e10 : 1.5e11 })),
  dividend: [{ y: 2023, cash: 12, stock: 0, ex: "2024-06-13" }, { y: 2024, cash: 16, stock: 0, ex: "2025-06-12" }, { y: 2025, cash: 18, stock: 0, ex: "2026-06-11" }], holders: [], foreign: [], profile: null };
const INFO = { ok: true, code: "2330", inst: [], margin: [], per: [], revenue: Array.from({ length: 24 }, (_, i) => ({ ym: `${2025 + (i >= 12 ? 1 : 0)}-${String(i % 12 + 1).padStart(2, "0")}`, rev: 2e11 + i * 5e9, mom: 1, yoy: 20 + i })), fin: [] };

for (const width of [390, 1280]) test(`財報第二批：體質、股利預估、法說會 AI ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const posted = [];
  await p.route("**/api/company**", r => J(r, CO)); await p.route("**/api/stockinfo**", r => J(r, INFO));
  await p.route("**/api/oapi?earn=1", r => J(r, { ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7]] }));
  await p.route("**/api/confai**", r => { if (r.request().method() === "POST") { posted.push(JSON.parse(r.request().postData())); return J(r, { ok: true, head: "AI 需求強勁，第四季營收再創新高", outlook: ["第四季營收 330 億美元", "毛利率 59%～61%"], margin: "毛利率優於預期", capex: "全年資本支出 420 億美元", demand: "AI 加速器需求強", risks: ["匯率"], quotes: ["We expect our business to be supported by strong demand"] }); }
    return J(r, { ok: true, code: "2330", list: [{ date: "2099-01-20", time: "15:00", note: "下一季法說會", file: null, en: null }, { date: "2026-10-16", time: "14:00", note: "公布第3季財報及第4季展望", file: "233020261016M001.pdf", en: "233020261016E001.pdf" }, { date: "2026-09-14", time: "08:00", note: "UBS 論壇", file: null, en: null }] }); });
  await p.click('#lTabs [data-l="earn"]'); await p.click('[data-erv="eps"]'); await p.click('.erlist button[data-ertr="2330"]');
  await p.waitForSelector('.ertr [data-frco="2330"]'); await p.click('.ertr [data-frco="2330"]');
  await p.waitForFunction(() => /股利預估/.test(document.querySelector(".ertr")?.innerText || ""));
  const t = await p.textContent(".ertr .epbox");
  assert.match(t, /存貨年增\s*⚠︎ \+50\.0%[\s\S]*存貨堆得比營收快/, "存貨比營收長得快要提醒");
  assert.match(t, /自由現金流（近 8 季）/); assert.match(t, /存貨週轉天數/);
  assert.match(t, /預估全年現金股利\s*17\.31 元/, "近四季 EPS 53.6 × 平均配息率 32.3%"); assert.match(t, /常在幾月除息\s*6 月/);
  // 法說會：不用按，展開就自動找法說會、自動請 AI 讀最近一次（已經開過的）簡報；還沒開的列成「下一場」
  await p.waitForSelector(".ertr .epsum", { timeout: 15000 });
  assert.match(await p.textContent(".ertr"), /10\/16 公布第3季財報及第4季展望/); assert.match(await p.textContent(".ertr"), /下一場：01\/20 15:00/);
  assert.equal(await p.getAttribute('.ertr .epconf a', "href"), "https://mopsov.twse.com.tw/nas/STR/233020261016M001.pdf");
  assert.match(await p.textContent(".ertr .epsum"), /AI 需求強勁[\s\S]*展望與指引[\s\S]*330 億美元[\s\S]*資本支出[\s\S]*簡報原文/);
  assert.deepEqual(posted.map(x => [x.code, x.file]), [["2330", "233020261016M001.pdf"]]);
  // 公布前後股價習慣
  await p.click('.ertr [data-exk="kl:2330"]'); await p.waitForFunction(() => /公布前 5 日平均/.test(document.querySelector(".ertr")?.innerText || ""), null, { timeout: 15000 });
  assert.match(await p.textContent(".ertr"), /公布後 5 日平均波動/);
  if (process.env.SHOT) { await p.evaluate(() => document.querySelectorAll(".fold-s").forEach(x => x.classList.remove("fold-s"))); for (const s of ["epbox", "epsum"]) await p.locator(".ertr ." + s).screenshot({ path: `${process.env.SHOT}/earnplus-${s}-${width}.png` }); }
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "不橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("美股財報：財測上修／下修分頁", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  const d = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  await p.route("**/data/us-earn.json", r => J(r, { ok: true, source: "測試", at: new Date().toISOString(), from: d, to: d, rows: [
    [d, "NVDA", "Nvidia", 4000, 1.3, 1.2, 8, "盤後", "", 1, 51, 50, 1, "Nvidia raises full-year guidance"], [d, "NFLX", "Netflix", 500, 5, 5.2, -3, "盤後", "", 4, 11, 11.2, -1, "Netflix shares fall on soft guidance"], [d, "AAPL", "Apple", 3800, 2, 1.9, 5, "盤後", "", 1.8, null, null, null, ""]] }));
  await p.click('#lTabs [data-l="earn"]'); await p.click('[data-erreg="us"]'); await p.click('[data-erv="guide"]');
  await p.waitForSelector(".erlist");
  const t = await p.textContent(".erlist");
  assert.match(t, /Nvidia[\s\S]*財測上修[\s\S]*raises full-year guidance[\s\S]*Netflix[\s\S]*財測下修/, "上修排前面、列出依據的標題"); assert.doesNotMatch(t, /Apple/, "看不出財測的不列");
  await p.click('[data-erv="recent"]'); assert.match(await p.textContent(".erlist"), /財測上修/, "最近公布也標出財測");
  await ctx.close(); assert.deepEqual(errs, []);
});
