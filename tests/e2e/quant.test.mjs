// 量化分析（learner/quant.js）在畫面上的用法：市場狀態、回測完整報告、庫存風險、多因子排行、交易日記規則、新聞影響、實驗室報告
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const clean = async p => { const t = await p.evaluate(() => document.body.innerText); assert.doesNotMatch(t, /NaN|undefined|Infinity%/, "畫面有 NaN／undefined"); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "橫向溢出"); };

test("個股市場狀態：日線、週線、ATR 參考設定、部位大小、AI、套用策略", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(() => { select("2330"); setDtab("ovw"); setDsub("state"); });
    await p.waitForFunction(() => document.querySelectorAll("#sxBox .qx-state").length === 2 && !/載入更長/.test($("#sxBox").innerText), null, { timeout: 20000 });
    const t = await p.evaluate(() => $("#sxBox").innerText);
    assert.match(t, /日線・(多頭|空頭|盤整)/); assert.match(t, /週線・(多頭|空頭|盤整)/); assert.match(t, /適合的策略類型[\s\S]*現在應避免/);
    // 假資料的即時報價（100）和日 K（約 500）差很多，最後一根 ATR 很大：停損會變負的，這時不能顯示設定
    const X = await p.evaluate(() => { const S = marketState(W.daily.data), X = atrSetup(S, W.stCap, W.stRisk / 100); return X && { stop: X.stop, sh: X.sh }; });
    if (X) { assert.ok(X.stop > 0); assert.match(t, /報酬風險比/); await p.selectOption("#sxBox [data-strisk]", "2"); await p.waitForTimeout(150);
      assert.ok((await p.evaluate(() => atrSetup(marketState(W.daily.data), W.stCap, 0.02).sh)) >= X.sh); } else assert.doesNotMatch(t, /ATR 參考設定/);
    // 正常的資料：停損在進場價下方且大於 0、部位大小照每筆風險
    const Y = await p.evaluate(() => { const D = W.daily.data.slice(0, -1), X = atrSetup(marketState(D), 1e6, 0.01); return X && [X.stop > 0, X.stop < X.entry, X.loss <= 10000 + 1e-6]; });
    assert.deepEqual(Y, [true, true, true]);
    await p.click('#sxBox [data-qai^="state:"]'); await p.waitForSelector("#sxBox .qx-aitxt"); assert.match(await p.evaluate(() => $("#sxBox .qx-aitxt").innerText), /測試回覆/);
    await clean(p);
    await p.click("#sxBox [data-qstrat]"); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => W.dtab), "tech"); assert.ok(await p.evaluate(() => !!STRATS[W.strat]?.fn));
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("策略回測的完整報告：指標、行情拆解、改善試算、AI", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { select("2330"); setDtab("tech"); });
  await p.waitForFunction(() => W.daily?.data?.length > 100);
  await p.evaluate(() => { $("#klStrat").open = true; const s = $("#stratSel"); s.value = "ma"; s.dispatchEvent(new Event("change")); });
  await p.waitForFunction(() => !$("#btRep").hidden);
  await p.evaluate(() => { $("#btRep").open = true; }); await p.waitForSelector("#btRepBox .qx-cards");
  const t = await p.evaluate(() => $("#btRepBox").innerText);
  assert.match(t, /年化報酬[\s\S]*夏普比率[\s\S]*獲利因子/); assert.match(t, /在不同行情的表現/); assert.match(t, /改善試算[\s\S]*原始設定[\s\S]*停損/);
  assert.ok(await p.evaluate(() => $("#btRepBox .qx-tbl").scrollWidth > 0));
  // 報告的原始設定和 K 線下方寫的回測報酬一致
  const same = await p.evaluate(() => { const r = W.btRep.V[0].m.total, note = $("#stratNote").textContent.match(/照做回測 ([+-]?[\d.]+)%/); return [r, note && +note[1]]; });
  assert.ok(Math.abs(same[0] * 100 - same[1]) < 0.06, String(same));
  await p.click('#btRepBox [data-qai]'); await p.waitForSelector("#btRepBox .qx-aitxt");
  await clean(p); await ctx.close(); assert.deepEqual(errs, []);
});

test("庫存風險：相關係數、Beta、壓力測試、再平衡", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 90 }, 2317: { sh: 3000, cost: 100 }, 2454: { sh: 200, cost: 100 }, "0050": { sh: 500, cost: 80 } }; W.holdMkt = "tw"; W.holdView = "risk"; setLt("hold"); });
    await p.waitForSelector(".hrisk", { timeout: 20000 });
    const t = await p.evaluate(() => $("#lx").innerText);
    assert.match(t, /組合年化波動[\s\S]*Beta[\s\S]*大盤跌 20% 試算/); assert.match(t, /每一檔的風險/); assert.match(t, /相關係數表/); assert.match(t, /再平衡與避險試算/);
    await p.click('[data-hrtol="low"]'); await p.waitForTimeout(150); assert.equal(await p.evaluate(() => W.hrTol), "low");
    assert.match(await p.evaluate(() => $("#lx").innerText), /單一持股上限\s*15%/);
    await p.click('#lx [data-qai="hrisk:tw"]'); await p.waitForSelector("#lx .qx-aitxt");
    await clean(p); await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("多因子排行：權重、ATR 參考、回測、全市場", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/api/screen?bw=1", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: { 2330: [20, 5, 2], 2317: [12, 1.5, 4] } }) }));
  await p.evaluate(() => { setLt("screen"); W.scrG = "score"; W.scoreMode = "factor"; renderList(); });
  await p.click("[data-mfrun]"); await p.waitForFunction(() => W.mfRes && !W.mfRes.busy && W.mfRes.rows.length >= 4, null, { timeout: 30000 });
  let t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /多因子排行[\s\S]*總分[\s\S]*ATR 參考停損／目標/); assert.match(t, /本益比來自/); assert.match(t, /投資組合範例/);
  // 權重：動能拉到 0，總分就不受動能影響
  await p.evaluate(() => { const r = $('[data-mfw="mom"]'); r.value = "0"; r.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.equal(await p.evaluate(() => W.mfx.w.mom), 0);
  await p.click("[data-mfbt]"); await p.waitForFunction(() => W.mfBt && !W.mfBt.busy, null, { timeout: 30000 });
  assert.ok(await p.evaluate(() => W.mfBt.per?.length >= 5), "自選範圍用 2 年日 K 回測，至少 5 期");
  t = await p.evaluate(() => $("#lx").innerText); assert.match(t, /勝過同範圍/);
  await clean(p);
  await p.click('[data-mfu="market"]'); await p.click("[data-mfrun]"); await p.waitForFunction(() => W.mfRes && !W.mfRes.busy && W.mfRes.mk, null, { timeout: 30000 });
  assert.ok(await p.evaluate(() => W.mfRes.rows.length > 50));
  await clean(p); await ctx.close(); assert.deepEqual(errs, []);
});

test("交易日記：AI 檢討最近 20 筆、存成規則、模擬交易提醒", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await ctx.route("**/api/chat", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, text: "1) 常追高\n【規則】\n1. RSI 超過 75 不追買\n2. 單筆虧損 7% 一定停損\n3. **獲利 15% 先賣一半**" }) }));
  await p.evaluate(() => { W.journal = [{ id: "a", d: "2026-03-02", code: "2330", side: "buy", px: 100, sh: 1000, tags: ["突破"] }, { id: "b", d: "2026-04-01", code: "2330", side: "sell", px: 110, sh: 1000, tags: [] }, { id: "c", d: "2026-05-04", code: "2317", side: "buy", px: 100, sh: 1000, tags: ["均線"] }, { id: "d", d: "2026-06-01", code: "2317", side: "sell", px: 90, sh: 1000, tags: [] }]; W.jrules = []; setLt("tools"); W.tv = "journal"; renderList(); });
  await p.click('[data-tx="jai"]'); await p.waitForSelector('[data-tx="jrsave"]', { timeout: 20000 });
  await p.click('[data-tx="jrsave"]'); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate(() => W.jrules.map(r => r.t)), ["RSI 超過 75 不追買", "單筆虧損 7% 一定停損", "獲利 15% 先賣一半"]);
  await p.fill("#jrIn", "不在開盤 5 分鐘內下單"); await p.click("#jrForm button"); await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => W.jrules.length), 4);
  await p.evaluate(() => { W.tv = "paper"; renderList(); }); assert.match(await p.evaluate(() => $(".jrules").innerText), /RSI 超過 75 不追買/);
  await clean(p); await ctx.close(); assert.deepEqual(errs, []);
});

test("個股新聞：AI 整理可能的影響", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  let ctxText = ""; await ctx.route("**/api/news**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "測試", items: [{ title: "台積電法說會上修全年營收", link: "https://example.com/1", source: "測試報", at: Date.now() - 3600e3 }] }) }));
  await ctx.route("**/api/chat", r => { ctxText = JSON.parse(r.request().postData()).context; r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, text: "短期偏多（第 1 則）" }) }); });
  await p.evaluate(() => { select("2330"); setDtab("news"); }); await p.waitForSelector('#newsAI [data-qai]');
  await p.waitForFunction(() => W.daily?.data?.length > 72); await p.click('#newsAI [data-qai]'); await p.waitForSelector("#newsAI .qx-aitxt");
  assert.match(ctxText, /台積電法說會上修全年營收/); assert.match(ctxText, /【日線】/);
  await clean(p); await ctx.close(); assert.deepEqual(errs, []);
});

test("K線學堂實驗室：回測完整報告、最佳化前後比較", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  await p.evaluate(() => { lab.strat = "ma"; lab.repOpen = true; if (!lab.D) labData(); labDraw(); });
  await p.waitForFunction(() => /夏普比率/.test($("#btPanel").innerHTML));
  assert.match(await p.evaluate(() => $("#btPanel").innerText), /改善試算/);
  await p.evaluate(() => $("#btPanel [data-qai]").click()); await p.waitForFunction(() => /測試回覆/.test($("#btPanel").innerHTML));
  await p.evaluate(() => { LX.tab = "opt"; LX.opt = "ma"; return lxOptimize(); });
  await p.waitForFunction(() => LX.res?.cmp?.length === 2);
  const h = await p.evaluate(() => document.querySelector("#advPanel")?.innerHTML || "");
  assert.match(h, /最佳化前後比較/); assert.doesNotMatch(h, /NaN|undefined/);
  await ctx.close(); assert.deepEqual(errs, []);
});
