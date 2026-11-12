// 選股「訊號回測」：排行、樣本不足、切換持有天數、展開明細、K 線格子上的勝率標記、沒有資料檔時的提示
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const st = (n, avg, ex) => ({ n, avg, med: avg / 2, p25: -0.05, p75: 0.08, win: 0.54, ex, exWin: 0.52 });
const DATA = { updated: "2026-11-12T08:30:00Z", from: "2025-10-20", to: "2026-11-12", stocks: 1700, ns: [5, 10, 20], cost: 0.00585, minN: 30, defs: [
  { id: "c:kdgc", group: "tech", side: null, name: "KD 低檔金叉（D<20）", desc: "", stats: { 5: st(12, 0.05, 0.04), 10: st(12, 0.06, 0.05), 20: st(12, 0.09, 0.08) }, hist: [0, 0, 1, 1, 2, 3, 2, 1, 1, 1], recent: [] },
  { id: "k:boom", group: "kline", side: "bull", name: "放量突破盤整", desc: "前 10 天盤整，今天放量突破", stats: { 5: st(330, 0.011, 0.004), 10: st(320, 0.02, 0.008), 20: st(312, 0.034, 0.012) }, hist: [5, 8, 20, 40, 60, 70, 50, 25, 12, 22],
    recent: [["2330", "台積<b class=\"x\">電</b>", "2026-10-30", 0.021, 0.035, null], ["2317", "鴻海", "2026-09-01", -0.012, 0.004, 0.051]] },
  { id: "k:topblack", group: "kline", side: "bear", name: "高檔長黑", desc: "高檔一根長黑", stats: { 5: st(200, -0.01, -0.012), 10: st(190, -0.02, -0.022), 20: st(180, -0.03, -0.032) }, hist: [9, 20, 30, 40, 40, 20, 10, 6, 3, 2], recent: [] },
  { id: "k:zzbear", group: "kline", side: "bear", name: "測試看空", desc: "", stats: { 5: st(60, -0.002, -0.003), 10: st(60, -0.003, -0.004), 20: st(60, -0.004, -0.005) }, hist: [0, 0, 5, 10, 15, 15, 10, 5, 0, 0], recent: [] },
  { id: "c:macdgc", group: "tech", side: null, name: "MACD 金叉", desc: "", stats: { 5: null, 10: null, 20: null }, hist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], recent: [] },
  { id: "c:madn", group: "tech", side: null, name: "收盤跌破均線 20 天", desc: "", stats: { 5: st(900, -0.004, -0.006), 10: st(880, -0.008, -0.01), 20: st(850, -0.015, -0.02) }, hist: [9, 30, 80, 150, 200, 180, 100, 60, 30, 11], recent: [] }] };
const goSig = p => p.evaluate(() => { showList?.(); setLt("screen"); W.scrG = "sig"; W.scrOpen = null; renderList(); });

for (const width of [390, 1280]) test(`選股「訊號回測」排行、明細、K 線格子標記 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.route("**/data/signal-study.json", r => J(r, DATA));
  await p.evaluate(() => { showList?.(); setLt("screen"); }); await p.click('[data-sg="sig"]'); await p.waitForSelector(".sgtbl");
  assert.equal(await p.evaluate(() => store.get("watch:scrg")), "sig");
  const rows = () => p.evaluate(() => [...document.querySelectorAll(".sgtbl tbody tr")].map(r => [r.dataset.sgid, r.innerText.replace(/\s+/g, " ")]));
  let R = await rows();
  assert.deepEqual(R.map(r => r[0]), ["k:topblack", "k:boom", "k:zzbear", "c:madn", "c:kdgc", "c:macdgc"],
    "看多（含技術條件）贏大盤高的在前、看空贏大盤低的在前（-3.2% 排在 -0.5% 前面），樣本不足的排最後");
  assert.match(R[1][1], /放量突破盤整 看多 312 \+3\.4% 54% \+1\.2% 52%/); assert.match(R[3][1], /850 -1\.5% 54% -2\.0%/);
  assert.match(R[0][1], /高檔長黑 看空 180 -3\.0% 54% -3\.2%/, "看空型態列上標明看空");
  assert.match(R[4][1], /KD 低檔金叉.*12.*樣本不足/); assert.doesNotMatch(R[4][1], /54%/, "樣本不足不顯示機率"); assert.match(R[5][1], /MACD 金叉 0 樣本不足/);
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".sgtbl thead th")].map(x => x.textContent)), ["條件", "樣本", "平均報酬", "上漲機率", "贏大盤（平均）", "贏大盤機率"]);
  let t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /2025-10-20～2026-11-12・1700 檔/); assert.match(t, /隔天開盤/); assert.match(t, /已下市的股票不在裡面/); assert.match(t, /不是投資建議/); assert.match(t, /都是「買進後持有」的結果[\s\S]*看空的型態[\s\S]*數字越低/); assert.match(t, /同樣扣成本/); assert.match(t, /看空的越低越前面/);
  assert.match(t, /不是互不相干的交易次數[\s\S]*持有期間可能重疊/, "樣本重疊的說明");
  // 切換持有天數
  await p.click('[data-sgn="5"]'); await p.waitForFunction(() => /330/.test($(".sgtbl").innerText));
  // 5 天：看空的高檔長黑（-1.2%）排第一、放量突破盤整（+0.4%）第二
  assert.equal(await p.evaluate(() => store.get("watch:sign")), 5); assert.match((await rows())[1][1], /放量突破盤整 看多 330 \+1\.1%/);
  await p.click('[data-sgn="20"]'); await p.waitForFunction(() => /312/.test($(".sgtbl").innerText));
  // 展開明細
  await p.click('.sgtbl [data-sgid="k:boom"] .linkbtn'); await p.waitForSelector(".sgdetail");
  assert.equal(await p.evaluate(() => store.get("watch:sigid")), "k:boom");
  t = await p.evaluate(() => $(".sgdetail").innerText.replace(/\s+/g, " "));
  assert.match(t, /前 10 天盤整/); assert.match(t, /5 天 330 \+1\.1%/); assert.match(t, /20 天 312 \+3\.4%/); assert.match(t, /台積<b class="x">電<\/b> 2330 10\/30 \+2\.1% \+3\.5% 進行中/, "名稱照字面顯示");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".sgdetail b.x").length), 0, "名稱裡的標籤不會變成元素");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".sgdetail .evhist > div").length), 10);
  assert.ok(await noHOverflow(p), "訊號回測不溢出");
  await p.click('.sgdetail [data-sel="2317"]'); assert.equal(await p.evaluate(() => W.sel), "2317", "點最近案例開個股");
  // K 線格子上的勝率標記：資料檔有、樣本夠才顯示
  await p.evaluate(() => { showList?.(); setLt("screen"); W.scrG = "kline"; W.scrOpen = null; renderList(); });
  await p.waitForSelector('[data-so="k:boom"] .sgbadge');
  assert.match(await p.textContent('[data-so="k:boom"] .sgbadge'), /^之後 20 日：上漲機率 54%・贏大盤 \+1\.2%・312 筆$/);
  assert.match(await p.textContent('[data-so="k:topblack"] .sgbadge'), /^之後 20 日：上漲機率 54%・贏大盤 -3\.2%・180 筆$/, "看空型態也用不帶方向的字，不寫勝率");
  assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /勝率/);
  assert.equal(await p.evaluate(() => document.querySelectorAll(".gtile .sgbadge").length), 2, "資料檔沒有的 K 線組合不顯示標記");
  await p.evaluate(() => { W.scrG = "tech"; renderList(); }); assert.equal(await p.evaluate(() => document.querySelectorAll(".sgbadge").length), 0, "技術格子的 id 資料檔不認得，不顯示也不報錯");
  assert.ok(await noHOverflow(p), "K 線格子不溢出");
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
