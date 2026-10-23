// 分享情報圖卡：每個有按鈕的區塊都要能畫出 PNG（品牌標頭、網址、底部「僅供研究參考，非投資建議」）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
// 按下按鈕 → 預覽視窗出現、圖片載入、尺寸合理 → 關閉
async function shot(p, key) {
  await p.click(`[data-sharecard="${key}"]`);
  await p.waitForFunction(() => { const i = document.querySelector(".sc-modal img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  const [w, h] = await p.evaluate(() => { const i = document.querySelector(".sc-modal img"); return [i.naturalWidth, i.naturalHeight]; });
  assert.doesNotMatch(await p.textContent(".sc-modal"), /\$\{/, `${key} 按鈕文字不能露出程式碼`);
  assert.equal(w, 1080, key); assert.ok(h > 500 && h < 6000, `${key} 高度 ${h}`);
  await p.click('.sc-modal [data-sca="x"]'); assert.equal(await p.evaluate(() => document.querySelectorAll(".sc-modal").length), 0);
}

test("圖卡畫布：品牌標頭、網址、免責小字都有畫上去", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  const txt = await p.evaluate(async () => { const out = []; const P = CanvasRenderingContext2D.prototype, f = P.fillText; P.fillText = function (t, ...a) { out.push(String(t)); return f.call(this, t, ...a); };
    await shareCardCanvas({ title: "測試", stats: [["a", "1", "up"]], sections: [{ h: "表", rows: [["x", "+1%", "up", "小字"]] }] }); P.fillText = f; return out.join("|"); });
  assert.match(txt, /KLineLab K線情報局/); assert.match(txt, /kline-school\.vercel\.app/); assert.match(txt, /僅供研究參考，非投資建議/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("情報局：動能矩陣、國會、13F、台灣政治人物、供應鏈題材都能匯出圖卡", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { W.mf.days = [{ date: "2026-10-16", rows: [] }]; W.mf.model = null; }); // 沒有真實資料時用假的資金模型
  await p.evaluate(() => { const A = Object.keys(FLOW_Q).flatMap((q, i) => [0, 1].map(j => ({ id: q + j, name: "板塊" + i + j, kind: "產業", n: 5, q, net1: 1e8, net5: (i + 1) * 1e9 * (j ? -1 : 1), pct5: 0.02, acc: 0.1 })));
    W.mf.model = { T: 1, dates: ["2026-10-16"] }; window.flowAt = () => A; window.flowStocks = () => []; window.flowMood = () => null; setLt("money"); W.mf.view = "bubble"; renderList(); });
  await shot(p, "matrix");
  for (const v of ["home", "f13", "tw"]) { await p.evaluate(v => { setLt("cong"); W.cv = v; renderList(); }, v); await p.waitForFunction(() => document.querySelector("#lx ol.tw-rank li"), null, { timeout: 15000 }); await shot(p, "cong"); }
  await p.evaluate(() => { setLt("ind"); W.indS.open = IND.themes[0].id; renderList(); }); await shot(p, "supply");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("個股指標與狀態、回測報告", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { select("2330"); setDtab("ovw"); setDsub("state"); });
  await p.waitForFunction(() => document.querySelector('#sxBox [data-sharecard="state"]'), null, { timeout: 20000 }); await shot(p, "state");
  await p.evaluate(() => { setDtab("tech"); $("#klStrat").open = true; const s = $("#stratSel"); s.value = "ma"; s.dispatchEvent(new Event("change")); });
  await p.waitForFunction(() => !$("#btRep").hidden); await p.evaluate(() => { $("#btRep").open = true; }); await p.waitForSelector('#btRepBox [data-sharecard="bt"]'); await shot(p, "bt");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("K線學堂測驗結算、存股模擬", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html#quiz", { width: 390, touch: true });
  await p.evaluate(() => { quiz.k = quiz.order.length; quiz.score = 7; quizRender(); }); await shot(p, "quiz");
  await ctx.close(); assert.deepEqual(errs, []);
  const o = await open(B, S.url, "savings.html", { width: 390, touch: true });
  await o.p.waitForFunction(() => typeof SAV_LAST !== "undefined" && SAV_LAST); await shot(o.p, "savings");
  await o.ctx.close(); assert.deepEqual(o.errs, []);
});
