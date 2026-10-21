// 這一版的 UX 串聯：分享圖卡在 iframe 裡也看得到預覽、全域搜尋、以股查人、隨處加自選、個股情報徽章、矩陣成分股、範例投資組合、畫線磁吸
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`首頁：全域搜尋、分享圖卡預覽畫在最上層 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  await p.evaluate(() => goTab("school")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => !!document.querySelector("#gsTop") && getComputedStyle(document.querySelector("#gsTop")).display !== "none"), true);
  await p.click("#gsTop");
  await p.waitForFunction(() => { const f = document.querySelector("#watchFrame"); return f?.contentWindow?.document?.querySelector("#gsearch") && !f.contentWindow.document.querySelector("#gsearch").hidden; }, null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => CUR_TAB), "watch");
  // 情報局的大戶國會：在 iframe 裡按「分享情報圖卡」，預覽視窗出現在最上層頁面（看得到），有下載與複製
  const f = p.frame({ url: /watch\.html/ });
  await f.evaluate(() => { gsHide(); setLt("cong"); W.cv = "tw"; renderList(); });
  await f.waitForFunction(() => document.querySelector("#lx ol.tw-rank li"), null, { timeout: 15000 });
  await f.click('[data-sharecard="cong"]');
  await p.waitForSelector(".sc-modal img", { timeout: 15000 });
  const box = await p.evaluate(() => { const r = document.querySelector(".sc-modal .sc-box").getBoundingClientRect(); return [r.top >= 0, r.bottom <= innerHeight + 1, document.querySelector(".sc-modal").innerText]; });
  assert.ok(box[0] && box[1], "預覽視窗要在畫面內"); assert.match(box[2], /下載 PNG 圖片/);
  assert.equal(await f.evaluate(() => !!document.querySelector(".sc-modal")), false, "不是畫在 iframe 裡");
  await p.click('.sc-modal [data-sca="x"]'); assert.equal(await p.evaluate(() => !!document.querySelector(".sc-modal")), false);
  assert.match(await p.evaluate(() => $("#schoolNav").innerText), /AI 截圖診斷/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`看盤：以股查人、☆ 自選、情報徽章、矩陣成分股、範例庫存 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  // 以股查人：搜尋「台積電」或 2330 列出兩位申報持有的人
  await p.evaluate(() => { setLt("cong"); W.cv = "tw"; W.twoQ = "台積電"; renderList(); });
  await p.waitForFunction(() => /持有 \S+ 2330 的政治人物（2 位）/.test($("#lx").innerText), null, { timeout: 15000 });
  assert.match(await p.evaluate(() => $("#lx").innerText), /王小明[\s\S]*立法委員[\s\S]*3 張[\s\S]*李大華/);
  await p.evaluate(() => { W.twoQ = "2317"; renderList(); });
  assert.match(await p.evaluate(() => $("#lx").innerText), /沒有符合的人（也沒有人申報持有這檔股票）/); // 2317 是上一次申報的，最新一次沒有
  // ☆：台灣政治人物表格裡的股票旁可以直接加自選
  await p.evaluate(() => { W.twoQ = "2382"; renderList(); });
  const had = await p.evaluate(() => inWatch("2382"));
  await p.click('#lx [data-wstar="2382"]');
  assert.equal(await p.evaluate(() => inWatch("2382")), !had);
  assert.equal(await p.evaluate(() => document.querySelector('#lx [data-wstar="2382"]').textContent), had ? "☆" : "★");
  // 個股情報徽章：2330 有 2 位政治人物持有、動能矩陣的區塊
  await p.evaluate(() => { const A = [{ id: "s1", name: "半導體", kind: "產業", n: 2, q: "up", q1: "up", net1: 1e8, prev1: 0, accel1: 1e8, net5: 5e9, prev5: 0, accel: 1e9, pct1: 1, pct5: 2, f1: 0, tr1: 0, f5: 0, tr5: 0, buy1: 2, buy5: 2 }];
    const mem = c => ({ code: c, name: "股" + c, pct: [1], px: [100], amt: [3], f: [1], tr: [1] });
    W.mf.days = [{ date: "2026-10-16", rows: [] }]; W.mf.model = { T: 1, dates: ["2026-10-16"], secs: [{ id: "s1", name: "半導體", kind: "產業", mem: [mem("2330"), mem("2454")] }] }; window.flowAt = () => A; });
  await p.evaluate(() => select("2330")); await p.waitForFunction(() => /2 位政治人物申報持有/.test($("#dIntel").innerText) && /半導體：↗ 強勢突破區/.test($("#dIntel").innerText), null, { timeout: 15000 });
  // 動能矩陣點圓點：下面直接列出成分股（含 ☆）
  await p.evaluate(() => { window.flowStocks = () => []; window.flowMood = () => null; showList(); setLt("money"); W.mf.view = "bubble"; W.mf.bsel = "s1"; W.mf.bw = "5"; renderList(); });
  assert.match(await p.evaluate(() => $("#lx .binfo").innerText), /成分股[\s\S]*股2330[\s\S]*完整成分股與排序/);
  assert.equal(await p.evaluate(() => document.querySelectorAll('#lx .binfo [data-wstar]').length), 2);
  // 範例投資組合：空的庫存一鍵載入、看得到範例提示、可以清除
  await p.evaluate(() => { W.hold = {}; W.holdMkt = "tw"; setLt("hold"); });
  await p.click('[data-hdemo="load"]'); await p.waitForTimeout(400);
  assert.ok(await p.evaluate(() => Object.keys(W.hold).length >= 5 && Object.values(W.hold).every(h => h.demo)));
  await p.waitForFunction(() => /目前是範例投資組合/.test($("#lx").innerText), null, { timeout: 15000 });
  await p.click('[data-hdemo="clear"]'); assert.equal(await p.evaluate(() => Object.keys(W.hold).length), 0);
  // 自選左欄：選中的個股有明顯底色
  await p.evaluate(() => { setLt("watch"); select(curList()[0]); });
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('#wl .row[aria-current="true"]')).backgroundColor);
  assert.notEqual(bg, "rgba(0, 0, 0, 0)");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`大盤：產業即時（細分產業漲跌、領漲股、資金流向）${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => { W.mkReg = "tw"; setLt("mkt"); });
  // 預設：最強 6 個＋最弱 6 個的長條，中間省略
  await p.waitForFunction(() => document.querySelectorAll("#lx .irb li button").length === 12, null, { timeout: 15000 });
  const t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /產業即時[\s\S]*\d+ 個細分產業：\d+ 漲/); assert.match(t, /中間 \d+ 個/);
  const v = await p.evaluate(() => [...document.querySelectorAll("#lx .irb em")].map(e => parseFloat(e.textContent)));
  assert.ok(v[0] >= v[1] && v[1] >= v[5] && v[5] >= v[6], JSON.stringify(v));
  // 展開看全部
  const n = await p.evaluate(() => irtModel("seg").length);
  await p.click('#lx [data-mk="irtAll"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .irb li button").length), n);
  // 資金流向排序、題材層級，選擇會記住
  await p.click('#lx [data-mk="irtK"][data-v="flow"]'); await p.waitForTimeout(150);
  assert.match(await p.evaluate(() => $("#lx .irb em").textContent), /億/);
  await p.click('#lx [data-mk="irtL"][data-v="theme"]'); await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .irb li button").length), await p.evaluate(() => irtModel("theme").length));
  assert.deepEqual(await p.evaluate(() => [store.get("watch:irtK"), store.get("watch:irtL")]), ["flow", "theme"]);
  // 官方產業價值鏈：產業層級的名稱、點一列展開成分股
  assert.match(await p.evaluate(() => $("#lx").innerText), /櫃買中心 產業價值鏈資訊平台[\s\S]*3 個產業、18 個上中下游細分產業/);
  await p.click("#lx .irb li button"); await p.waitForTimeout(200);
  assert.ok(await p.evaluate(() => document.querySelectorAll("#lx .irb-mem [data-sel]").length >= 3));
  await p.click("#lx .irb-mem [data-sel]"); await p.waitForTimeout(300);
  assert.ok(await p.evaluate(() => !!W.sel));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("畫線練習：點在低點附近會吸到 K 棒低點、畫好後提示看答案", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280 });
  await p.evaluate(() => { dr.mode = "sup"; dr.src = "sim"; goTab("draw"); }); await p.waitForFunction(() => dr.D, null, { timeout: 15000 });
  // 吸到點擊位置左右 3 根內、離點擊價格最近的低點（不一定是第 20 根）
  const r = await p.evaluate(() => { dr.type = "sup"; const i = 20, low = dr.D[i].l; drTap(i + 0.5, low * 1.004); return [dr.pts[0][1], dr.D.slice(17, 24).map(k => k.l), low * 1.004, $("#drHint").textContent, $("#drCheck").disabled]; });
  assert.ok(r[1].includes(r[0]), `應該吸到附近的低點：${r[0]} 不在 ${r[1]}`); assert.ok(Math.abs(r[0] - r[2]) / r[2] < 0.008); assert.match(r[3], /畫好了/); assert.equal(r[4], false);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("產業網絡星系：預設窗格跟著圓點＋原子軌道＋弧線，三組可切換並記住；點圓點看資訊、換到中心", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.emulateMedia({ reducedMotion: "reduce" }); // 不自轉，量位置和點擊時圓點才不會動
  await p.evaluate(() => { setLt("ind"); W.indS.view = "network"; W.indS.nstyle = null; W.indS.focus = null; W.indS.gxo = null; renderList(); });
  await p.waitForSelector("canvas.igalaxy"); await p.waitForTimeout(1500); // 等報價載完重畫
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('[data-gxo][aria-pressed="true"]')].map(b => b.dataset.gxo)), ["tip:A", "lay:B", "line:B"]);
  // 上游在中心上方、下游在下方
  const dir = await p.evaluate(() => { const S = W.gxS, y = id => S.screen[id].y, c = y(S.core), up = S.links.filter(l => l[1] === S.core).map(l => l[0]), dn = S.links.filter(l => l[0] === S.core).map(l => l[1]);
    return { n: up.length + dn.length, bad: [...up.filter(id => y(id) >= c), ...dn.filter(id => y(id) <= c)], hits: S.hits.length, ids: S.ids.length }; });
  assert.ok(dir.n > 0); assert.deepEqual(dir.bad, [], "上游要在中心上方、下游在下方"); assert.equal(dir.hits, dir.ids);
  // 名稱不重疊
  assert.equal(await p.evaluate(() => { const B = W.gxS.labels; let n = 0; for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (B[i][0] < B[j][2] && B[j][0] < B[i][2] && B[i][1] < B[j][3] && B[j][1] < B[i][3]) n++; return n; }), 0);
  // 左右拖曳會轉動，且不會誤觸成點擊
  await p.evaluate(() => document.querySelector(".gstage").scrollIntoView({ block: "center" }));
  const th0 = await p.evaluate(() => W.gx.th), bb = await p.locator(".gstage").boundingBox(), yy = bb.y + bb.height * 0.85;
  await p.mouse.move(bb.x + 40, yy); await p.mouse.down(); await p.mouse.move(bb.x + 170, yy, { steps: 6 }); await p.mouse.up();
  assert.ok(Math.abs((await p.evaluate(() => W.gx.th)) - th0) > 0.3, "拖曳要轉動");
  assert.equal(await p.evaluate(() => document.querySelector(".gcard").hidden), true);
  // 手指點正面的圓點 → 資訊窗格；按「換到中心」
  const h = await p.evaluate(() => { const S = W.gxS; return S.hits.filter(x => x.id !== S.core && x.z > 0.1).sort((a, b) => b.z - a.z)[0]; });
  const b2 = await p.locator(".gstage").boundingBox(); await p.touchscreen.tap(b2.x + h.x, b2.y + h.y);
  await p.waitForSelector(".gcard:not([hidden])"); assert.match(await p.textContent(".gcard"), /上游|下游|相關/);
  assert.ok(await p.evaluate(id => W.gxS.labIds.includes(id), h.id), "被點到的圓點要標名稱");
  // 縮放：按鈕放大、回到 100%；滾輪也能縮放
  await p.click('[data-gxz="+"]'); assert.ok(Math.abs((await p.evaluate(() => W.gx.zoom)) - 1.3) < 0.01); assert.equal(await p.textContent(".gzv"), "130%");
  await p.click('[data-gxz="0"]'); assert.equal(await p.evaluate(() => W.gx.zoom), 1);
  await p.mouse.move(b2.x + 20, b2.y + b2.height - 20); await p.mouse.wheel(0, -300); await p.waitForTimeout(100); // 避開打開的資訊窗格
  assert.ok((await p.evaluate(() => W.gx.zoom)) > 1.2, "滾輪放大");
  await p.click('[data-gxz="0"]');
  await p.click(".gcard [data-ifocus]"); await p.waitForFunction(id => W.gxS?.core === id, h.id);
  // 三組樣式都能切換，並記在瀏覽器
  for (const k of ["tip:B", "lay:A", "lay:C", "line:A", "line:C"]) { await p.click(`[data-gxo="${k}"]`); await p.waitForTimeout(80); }
  assert.deepEqual(await p.evaluate(() => store.get("watch:inds").gxo), { tip: "B", lay: "C", line: "C" });
  await p.click('[data-instyle="layer"]'); await p.waitForSelector(".inetwrap .inode2");
  assert.equal(await p.evaluate(() => store.get("watch:inds").nstyle), "layer");
  // 分層：直式（手機不會橫向捲動），點題材聚焦，只畫它的上下游連線，再點一次取消
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
  if (await p.evaluate(() => !!W.indS.focus)) await p.evaluate(() => { W.indS.focus = null; renderInd(); });
  const fid = await p.evaluate(() => (IND.networks.find(n => n.id === W.indS.net) || IND.networks[0]).layers[1][1][0]);
  await p.click(`.inode2[data-ifocus="${fid}"]`); await p.waitForSelector(".inode2.on");
  const fx = await p.evaluate(id => { const net = IND.networks.find(n => n.id === W.indS.net) || IND.networks[0];
    return { n: net.links.filter(l => l.includes(id)).length, paths: document.querySelectorAll(".inet2 path").length, rel: document.querySelectorAll(".inode2.up, .inode2.dn").length, dim: document.querySelectorAll(".inode2.dim").length, focus: W.indS.focus }; }, fid);
  assert.equal(fx.focus, fid); assert.equal(fx.paths, fx.n); assert.ok(fx.rel > 0 && fx.dim > 0, JSON.stringify(fx));
  await p.click(`.inode2[data-ifocus="${fid}"]`); assert.equal(await p.evaluate(() => W.indS.focus), null);
  await ctx.close(); assert.deepEqual(errs, []);
});
