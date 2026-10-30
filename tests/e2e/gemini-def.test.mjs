// Gemini Spark 使用者稽核（DEF-05、06、12）：口徑說明 ⓘ、開高低 0 顯示 —、電腦版抽屜寬版、存股進階參數收合
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("個股成交量旁的 ⓘ：點了顯示口徑說明，不觸發外層點擊；開高低是 0 顯示 — 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { select("2330"); });
  await p.waitForSelector("#dKv .itip");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.click("#dKv .itip");
  await p.waitForSelector("#toast:not([hidden])");
  assert.match(await p.textContent("#toast"), /整股成交張數[\s\S]*不含零股/);
  // 上游回 0：顯示 —
  await p.evaluate(() => { const q = W.detailQ || W.quotes.get("2330") || {}; W.detailQ = { ...q, open: 0, high: 0, low: 0 }; renderDetailHead(); });
  const kv = await p.evaluate(() => [...document.querySelectorAll("#dKv > div")].slice(0, 3).map(d => d.querySelector("b").textContent));
  assert.deepEqual(kv, ["—", "—", "—"]);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("大盤三大法人、成交金額旁有 ⓘ 口徑說明 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  const B0 = { up: 500, down: 400, flat: 50, limUp: 3, limDn: 1, buckets: Array.from({ length: 11 }, (_, i) => ({ label: `${i}%`, n: 10 + i })) };
  await ctx.route("**/api/market", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, date: "2026-10-28", dataDate: "2026-10-28", time: "13:30:00", live: false, source: "測試", completeness: "complete", dataStatus: "confirmed", dateVerified: true, dateConsistent: true,
    breadth: B0, breadthBy: { twse: B0 }, totalsBy: { twse: { value: 7891.52 } }, us: [], world: [], indices: [], inst: { date: "2026-10-28", dataDate: "2026-10-28", foreign: 159.1, trust: 20.3, dealer: 119.5, total: 298.95, source: "證交所 BFI82U" } }) }));
  await p.evaluate(async () => { clearTimeout(W.timer); W.mkt = null; W.mkReg = "tw"; W.mkM = "twse"; setLt("mkt"); await loadMkt(true); renderList(); });
  await p.waitForFunction(() => document.querySelectorAll("#lx .itip").length >= 1, null, { timeout: 8000 }).catch(() => {});
  const tips = await p.evaluate(() => [...document.querySelectorAll("#lx .itip")].map(t => t.dataset.itip));
  assert.ok(tips.some(t => /外資自營商/.test(t)), "三大法人口徑：" + JSON.stringify(tips));
  assert.ok(tips.some(t => /盤後定價/.test(t)), "成交金額口徑：" + JSON.stringify(tips));
  assert.equal(await p.evaluate(() => infoTip("inst").includes("15:00～16:30")), true);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("電腦版個股抽屜：⤢ 寬版切換、記住設定；手機不顯示按鈕", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { setLt("mkt"); select("2330"); });
  await p.waitForSelector("#dWide", { state: "visible" });
  const w0 = await p.evaluate(() => document.getElementById("detail").getBoundingClientRect().width);
  await p.click("#dWide");
  const w1 = await p.evaluate(() => document.getElementById("detail").getBoundingClientRect().width);
  assert.ok(w1 > w0 + 100, `寬版變寬：${w0} → ${w1}`);
  assert.ok(w1 <= 1280, "不超出視窗");
  assert.equal(await p.evaluate(() => store.get("watch:dwide")), true);
  await p.reload(); await p.evaluate(() => { setLt("mkt"); select("2330"); });
  assert.equal(await p.getAttribute("#dWide", "aria-pressed"), "true", "重新整理後還是寬版");
  await ctx.close(); assert.deepEqual(errs, []);
  const m = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await m.p.evaluate(() => select("2330"));
  assert.equal(await m.p.isVisible("#dWide"), false, "手機抽屜本來就全寬");
  await m.ctx.close();
});

test("存股模擬：電腦版核心衛星（B）、借款結構（C）參數預設收起，其他區塊展開 1280", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 1280 });
  const st = await p.evaluate(() => [...document.querySelectorAll("#console details")].map(d => [d.querySelector("summary").textContent.trim().slice(0, 6), d.open]));
  assert.ok(st.filter(([t]) => /核心衛星|借款結構/.test(t)).every(([, o]) => !o), JSON.stringify(st));
  assert.ok(st.filter(([t]) => !/核心衛星|借款結構/.test(t)).some(([, o]) => o), "其他區塊照常展開");
  await ctx.close(); assert.deepEqual(errs, []);
});
