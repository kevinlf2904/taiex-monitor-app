// 財報分析與下載：個股「財務 → 財報分析」（台股、美股）、情報局「財報」展開公司後的分析，CSV 下載內容正確（有 BOM、各張表都在）
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const qs = Array.from({ length: 12 }, (_, i) => `${2023 + (i >> 2)}Q${(i % 4) + 1}`);
const CO = { ok: true, code: "2330", source: "測試",
  income: qs.map((q, i) => ({ q, d: q, rev: 6e11 + i * 3e10, gp: (6e11 + i * 3e10) * (0.5 + i * 0.005), op: (6e11 + i * 3e10) * 0.4, ni: 2.5e11 + i * 1e10, nip: 2.5e11 + i * 1e10, eps: 9.6 + i * 0.4 })),
  balance: qs.map((q, i) => ({ q, d: q, assets: 6e12 + i * 1e11, liab: 2e12, equity: 4e12 + i * 1e11, ca: 2.5e12, cl: 1e12, parentEq: 4e12 + i * 1e11 })),
  cash: qs.map((q, i) => ({ q, d: q, ocf: 3.5e11, icf: -2e11, fin: -1e11, capex: -2e11, fcf: 1.5e11 + i })), dividend: [{ y: 2025, cash: 18, stock: 0 }], holders: [], foreign: [], profile: null };
const INFO = { ok: true, code: "2330", inst: [], margin: [], per: [], revenue: Array.from({ length: 24 }, (_, i) => ({ ym: `${2025 + (i >= 12 ? 1 : 0)}-${String(i % 12 + 1).padStart(2, "0")}`, rev: 2e11 + i * 5e9, mom: 1, yoy: 20 + i })), fin: [] };
async function csvOf(p, sel) { const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]); return { name: d.suggestedFilename(), txt: await readFile(await d.path(), "utf8") }; }

for (const width of [390, 1280]) test(`個股財報分析：台股、美股，CSV 下載 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.route("**/api/company**", r => J(r, CO)); await p.route("**/api/stockinfo**", r => J(r, INFO));
  await p.evaluate(() => { select("2454"); setDtab("fin"); setDsub("fana"); });
  await p.waitForFunction(() => /ROE/.test($("#sxBox").innerText), null, { timeout: 15000 });
  const t = await p.evaluate(() => $("#sxBox").innerText);
  if (process.env.FRDUMP) console.log(t);
  for (const k of ["營收成長", "月營收動能", "EPS 成長", "毛利率", "營業利益率", "ROE", "負債比", "流動比率", "獲利含金量", "自由現金流", "配息率", "財務體質"]) assert.ok(t.includes(k), `缺少 ${k}`);
  assert.match(t, /負債比\s*28.2%/, "負債比 = 2 兆 ÷ 7.1 兆");
  assert.ok(await p.locator('#sxBox a[href*="doc.twse.com.tw"][href*="co_id=2454"]').count() >= 1, "官方財報 PDF 連結");
  const f = await csvOf(p, '#sxBox [data-frdl="2454"]');
  assert.equal(f.name, "2454-financials.csv"); assert.equal(f.txt.charCodeAt(0), 0xfeff, "有 BOM，Excel 中文不亂碼");
  for (const k of ["單季損益", "資產負債（季底）", "現金流（單季）", "月營收", "股利", "2025Q4"]) assert.ok(f.txt.includes(k), `CSV 缺少 ${k}`);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 美股
  await p.evaluate(() => { select("AAPL"); setDtab("fin"); setDsub("fana"); });
  await p.waitForFunction(() => /財報優於預期/.test($("#sxBox").innerText), null, { timeout: 15000 });
  const u = await p.evaluate(() => $("#sxBox").innerText);
  assert.match(u, /ROE[\s\S]*150\.2%/); assert.match(u, /負債權益比[\s\S]*1\.50 倍/);
  assert.ok(await p.locator('#sxBox a[href*="sec.gov"][href*="CIK=0000320193"]').count() === 1, "SEC 連結");
  const g = await csvOf(p, '#sxBox [data-frdl="AAPL"]'); assert.ok(g.txt.includes("單季損益") && g.txt.includes("2026Q2") && g.txt.includes("EPS 實際與預估"));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("情報局「財報」：展開台股公司後按「財報分析與下載」", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  const seen = []; p.on("request", q => seen.push(q.url()));
  await p.route("**/api/company**", r => J(r, CO)); await p.route("**/api/stockinfo**", r => J(r, INFO));
  await p.route("**/api/oapi?earn=1", r => J(r, { ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7]] }));
  await p.click('#lTabs [data-l="earn"]'); await p.click('[data-erv="eps"]'); await p.click('.erlist button[data-ertr="2330"]');
  await p.waitForSelector('.ertr [data-frco="2330"]');
  assert.ok(!seen.some(u => u.includes("/api/company")), "按了才抓財報");
  await p.click('.ertr [data-frco="2330"]'); await p.waitForFunction(() => /ROE/.test(document.querySelector(".ertr")?.innerText || ""));
  const f = await csvOf(p, '.ertr [data-frdl="2330"]'); assert.ok(f.txt.includes("單季損益") && f.txt.includes("月營收"), "CSV 也帶到走勢圖的月營收");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
