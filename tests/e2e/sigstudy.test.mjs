// 選股「訊號回測」：排行、樣本不足、切換持有天數、展開明細、K 線格子上的勝率標記、沒有資料檔時的提示
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const st = (n, avg, ex, extra = {}) => ({ n, avg, med: avg / 2, p25: -0.05, p75: 0.08, win: 0.54, ex, exWin: 0.52, ...extra });
const cov = (events, pool, entry, done, ov, avg, min, extra = {}) => ({
  events, pool, entry, done, noEntryBar: pool - entry, entryLock: 0, noExitOrPath: 0, jumpExcl: 0, entryZeroEvents: 0, covEvents: events, covOverall: ov, covAvg: avg, covMin: min, ...extra
});
const aud = (triggered, done, extra = {}) => ({ triggered, pending: 0, lock: 0, noExitOrPath: 0, jumpExcl: 0, done, ...extra });
const DATA = { updated: "2026-11-12T08:30:00Z", from: "2025-10-20", to: "2026-11-12", stocks: 1700, ns: [5, 10, 20], cost: 0.00585, minN: 30, defs: [
  { id: "c:kdgc", group: "tech", side: null, name: "KD 低檔金叉（D<20）", desc: "", stats: { 5: st(12, 0.05, 0.04, { exN: 12 }), 10: st(12, 0.06, 0.05, { exN: 12 }), 20: st(12, 0.09, 0.08, { exN: 12 }) }, hist: [0, 0, 1, 1, 2, 3, 2, 1, 1, 1], recent: [] },
  { id: "k:boom", group: "kline", side: "bull", name: "放量突破盤整", desc: "前 10 天盤整，今天放量突破",
    stats: {
      5: st(330, 0.011, 0.004, { exN: 330, pairedAvg: 0.011, benchAvg: 0.007, signalAudit: aud(335, 330, { pending: 3, lock: 2 }), benchCov: cov(330, 3320, 3300, 3267, 0.99, 0.99, 0.96) }),
      10: st(0, null, null, { exN: 0, pairedAvg: null, benchAvg: null, exWin: null, signalAudit: aud(4, 0, { pending: 4 }), benchCov: cov(0, 0, 0, 0, null, null, null) }),
      20: st(312, 0.034, 0.012, { exN: 310, pairedAvg: 0.032, benchAvg: 0.02, signalAudit: aud(320, 312, { pending: 5, lock: 1, noExitOrPath: 1, jumpExcl: 1 }), benchCov: cov(310, 3150, 3100, 2976, 0.96, 0.94, 0.9, { entryZeroEvents: 1, noExitOrPath: 3, jumpExcl: 2, entryLock: 10, noEntryBar: 40 }) })
    }, hist: [5, 8, 20, 40, 60, 70, 50, 25, 12, 22],
    recent: [["2330", "台積<b class=\"x\">電</b>", "2026-10-30", 0.021, 0.035, null], ["2317", "鴻海", "2026-09-01", -0.012, 0.004, 0.051]] },
  { id: "k:topblack", group: "kline", side: "bear", name: "高檔長黑", desc: "高檔一根長黑", stats: { 5: st(200, -0.01, -0.012, { exN: 200 }), 10: st(190, -0.02, -0.022, { exN: 190 }), 20: st(180, -0.03, -0.032, { exN: 180 }) }, hist: [9, 20, 30, 40, 40, 20, 10, 6, 3, 2], recent: [] },
  { id: "k:zzbear", group: "kline", side: "bear", name: "測試看空", desc: "", stats: { 5: st(60, -0.002, -0.003, { exN: 60 }), 10: st(60, -0.003, -0.004, { exN: 60 }), 20: st(60, -0.004, -0.005, { exN: 60 }) }, hist: [0, 0, 5, 10, 15, 15, 10, 5, 0, 0], recent: [] },
  { id: "c:macdgc", group: "tech", side: null, name: "MACD 金叉", desc: "", stats: { 5: null, 10: st(0, null, null, { exN: 0, pairedAvg: null, benchAvg: null, exWin: null, signalAudit: aud(2, 0, { lock: 1, jumpExcl: 1 }), benchCov: cov(0, 0, 0, 0, null, null, null) }), 20: null }, hist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], recent: [] },
  { id: "c:madn", group: "tech", side: null, name: "收盤跌破均線 20 天", desc: "", stats: { 5: st(900, -0.004, -0.006, { exN: 900 }), 10: st(880, -0.008, -0.01, { exN: 880 }), 20: st(850, -0.015, -0.02, { exN: 850 }) }, hist: [9, 30, 80, 150, 200, 180, 100, 60, 30, 11], recent: [] }] };
const LEGACY_DATA = { updated: "2026-11-12T08:30:00Z", from: "2025-10-20", to: "2026-11-12", stocks: 1700, ns: [5, 10, 20], cost: 0.00585, minN: 30, defs: [
  { id: "k:boom", group: "kline", side: "bull", name: "放量突破盤整", desc: "舊版資料", stats: { 5: st(330, 0.011, 0.004), 10: st(320, 0.02, 0.008), 20: st(312, 0.034, 0.012) }, hist: [5, 8, 20, 40, 60, 70, 50, 25, 12, 22], recent: [] },
  { id: "k:topblack", group: "kline", side: "bear", name: "高檔長黑", desc: "", stats: { 5: st(200, -0.01, -0.012), 10: st(190, -0.02, -0.022), 20: st(180, -0.03, -0.032) }, hist: [9, 20, 30, 40, 40, 20, 10, 6, 3, 2], recent: [] }] };
const goSig = p => p.evaluate(() => { showList?.(); setLt("screen"); W.scrG = "sig"; W.scrOpen = null; renderList(); });

for (const width of [390, 1280]) test(`選股「訊號回測」排行、明細、K 線格子標記 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.route("**/data/signal-study.json", r => J(r, DATA));
  await p.evaluate(() => { showList?.(); setLt("screen"); }); await p.click('[data-sg="sig"]'); await p.waitForSelector(".sgtbl");
  assert.equal(await p.evaluate(() => store.get("watch:scrg")), "sig");
  const rows = () => p.evaluate(() => [...document.querySelectorAll(".sgtbl tbody tr")].map(r => [r.dataset.sgid, r.innerText.replace(/\s+/g, " ")]));
  let R = await rows();
  assert.deepEqual(R.map(r => r[0]), ["k:topblack", "k:boom", "k:zzbear", "c:madn", "c:kdgc", "c:macdgc"],
    "看多（含技術條件）超額（同池）高的在前、看空超額（同池）低的在前（-3.2% 排在 -0.5% 前面），樣本不足的排最後");
  assert.match(R[1][1], /放量突破盤整 看多 312 \+3\.4% 54% \+1\.2% 52%/); assert.match(R[3][1], /850 -1\.5% 54% -2\.0%/);
  assert.match(R[0][1], /高檔長黑 看空 180 -3\.0% 54% -3\.2%/, "看空型態列上標明看空");
  assert.match(R[4][1], /KD 低檔金叉.*12.*樣本不足/); assert.doesNotMatch(R[4][1], /54%/, "樣本不足不顯示機率"); assert.match(R[5][1], /MACD 金叉 0 樣本不足/);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".sgtbl thead th")].map(x => x.textContent)), ["條件", "樣本", "平均報酬", "上漲機率", "超額（同池）", "贏同池機率"]);
  let t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /2025-10-20～2026-11-12・1700 檔/); assert.match(t, /隔天開盤/); assert.match(t, /已下市的股票不在裡面/); assert.match(t, /不是投資建議/);
  assert.match(t, /訊號日成交量 ≥ 500 張的現存上市櫃普通股等權池（含當次訊號股）/);
  assert.match(t, /看空型態僅是買進持有結果的反向解讀，不代表實際放空績效/); assert.match(t, /同樣扣成本/); assert.match(t, /看空的超額越低越前面/);
  assert.match(t, /不是互不相干的交易次數[\s\S]*持有期間可能重疊/, "樣本重疊的說明");
  assert.doesNotMatch(t, /贏大盤/);
  // 切換持有天數
  await p.click('[data-sgn="5"]'); await p.waitForFunction(() => /330/.test($(".sgtbl").innerText));
  // 5 天：看空的高檔長黑（-1.2%）排第一、放量突破盤整（+0.4%）第二
  assert.equal(await p.evaluate(() => store.get("watch:sign")), 5); assert.match((await rows())[1][1], /放量突破盤整 看多 330 \+1\.1%/);
  await p.click('[data-sgn="20"]'); await p.waitForFunction(() => /312/.test($(".sgtbl").innerText));
  // 展開看空與全排除零樣本條件檢查文案
  await p.click('.sgtbl [data-sgid="k:topblack"] .linkbtn'); await p.waitForSelector(".sgdetail");
  assert.match(await p.textContent(".sgdetail h3"), /K 線組合・看空型態（反向解讀）/);
  await p.click('.sgtbl [data-sgid="c:macdgc"] .linkbtn'); await p.waitForFunction(() => /MACD 金叉/.test($(".sgdetail h3")?.innerText || ""));
  assert.match(await p.evaluate(() => $(".sgdetail").innerText.replace(/\s+/g, " ")), /持有 10 天｜訊號端 2（未成熟 0・進場受限 1・成熟缺出場／路徑 0・跳動排除 1・完成 0）；同池基準：無完成訊號事件/);
  // 展開明細（含完整訊號端拆帳、同池覆蓋率、paired vs overall 與 <95% 提示）
  await p.click('.sgtbl [data-sgid="k:boom"] .linkbtn'); await p.waitForFunction(() => /前 10 天盤整/.test($(".sgdetail").innerText));
  assert.equal(await p.evaluate(() => store.get("watch:sigid")), "k:boom");
  t = await p.evaluate(() => $(".sgdetail").innerText.replace(/\s+/g, " "));
  assert.match(t, /前 10 天盤整/); assert.match(t, /5 天 330（配對 330） \+1\.1%/); assert.match(t, /20 天 312（配對 310） \+3\.4%/);
  assert.match(t, /持有 5 天｜訊號端 335（未成熟 3・進場受限 2・成熟缺出場／路徑 0・跳動排除 0・完成 330）；同池基準 330 次（合格池 3320・可進場 3300・進場受限 20・完成 3267；股票數加權 99%；事件等權 99%；最低單次 96%；缺出場／路徑 0・跳動排除 0），配對 330\/330；基準池限現有快取可觀察股票/);
  assert.match(t, /持有 10 天｜訊號端 4（未成熟 4・進場受限 0・成熟缺出場／路徑 0・跳動排除 0・完成 0）；同池基準：尚無成熟事件/);
  assert.match(t, /持有 20 天｜訊號端 320（未成熟 5・進場受限 1・成熟缺出場／路徑 1・跳動排除 1・完成 312）；同池基準 310 次（合格池 3150・可進場 3100・進場受限 50・完成 2976；股票數加權 96%；事件等權 94%；最低單次 90%；無可進場 1 次；缺出場／路徑 3・跳動排除 2），配對 310\/312（配對訊號 \+3\.2% vs 同池 \+2\.0%）；覆蓋低於 95% 提示門檻/);
  assert.match(t, /台積<b class="x">電<\/b> 2330 10\/30 \+2\.1% \+3\.5% 進行中/, "名稱照字面顯示");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".sgdetail b.x").length), 0, "名稱裡的標籤不會變成元素");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".sgdetail .evhist > div").length), 10);
  assert.ok(await noHOverflow(p), "訊號回測不溢出");
  await p.click('.sgdetail [data-sel="2317"]'); assert.equal(await p.evaluate(() => W.sel), "2317", "點最近案例開個股");
  // K 線格子上的勝率標記：資料檔有、樣本夠才顯示，看空標示反向解讀
  await p.evaluate(() => { showList?.(); setLt("screen"); W.scrG = "kline"; W.scrOpen = null; renderList(); });
  await p.waitForSelector('[data-so="k:boom"] .sgbadge');
  assert.match(await p.textContent('[data-so="k:boom"] .sgbadge'), /^之後 20 日：上漲機率 54%・超額（同池）\+1\.2%・312 筆$/);
  assert.match(await p.textContent('[data-so="k:topblack"] .sgbadge'), /^看空型態（反向解讀）・之後 20 日：上漲機率 54%・超額（同池）-3\.2%・180 筆$/, "看空型態格子明確標示反向解讀，不寫勝率");
  assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /勝率|贏大盤/);
  assert.equal(await p.evaluate(() => document.querySelectorAll(".gtile .sgbadge").length), 2, "資料檔沒有的 K 線組合不顯示標記");
  await p.evaluate(() => { W.scrG = "tech"; renderList(); }); assert.equal(await p.evaluate(() => document.querySelectorAll(".sgbadge").length), 0, "技術格子的 id 資料檔不認得，不顯示也不報錯");
  assert.ok(await noHOverflow(p), "K 線格子不溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("選股「訊號回測」：相容舊版 JSON（無 exN、signalAudit、benchCov）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.route("**/data/signal-study.json", r => J(r, LEGACY_DATA));
  await goSig(p); await p.waitForSelector(".sgtbl");
  await p.click('.sgtbl [data-sgid="k:boom"] .linkbtn'); await p.waitForSelector(".sgdetail");
  const t = await p.evaluate(() => $(".sgdetail").innerText.replace(/\s+/g, " "));
  assert.match(t, /5 天 330 \+1\.1%/); assert.match(t, /20 天 312 \+3\.4%/);
  assert.doesNotMatch(t, /配對 0|undefined|NaN/);
  assert.ok(await noHOverflow(p), "舊版資料相容不溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("選股「訊號回測」：還沒有資料檔", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.route("**/data/signal-study.json", r => r.fulfill({ status: 404, body: "nf" }));
  await goSig(p); await p.waitForFunction(() => /還沒有回測資料/.test($("#lx").innerText));
  await p.evaluate(() => { W.scrG = "kline"; renderList(); }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.querySelectorAll(".sgbadge").length), 0); assert.ok(await p.evaluate(() => document.querySelectorAll(".gtile").length > 0), "K 線分類照常");
  await ctx.close(); assert.deepEqual(errs, []);
});
