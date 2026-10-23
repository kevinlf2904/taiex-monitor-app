// KLineLab 品牌與合規：配色、Hero、Pro 候補名單、免責聲明、去識別化（沒有潮汐／泡泡字眼、供應鏈個股說明由程式產生）；節目頭像失敗時用徽章
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const DISC = "不構成任何證券投資顧問或個股買賣建議";

test("首頁：品牌、碳黑配色、Hero 可收起、頁尾免責聲明", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
    assert.match(await p.title(), /KLineLab/);
    assert.deepEqual(await p.evaluate(() => [document.documentElement.dataset.style, getComputedStyle(document.body).backgroundColor]), ["lab", "rgb(9, 9, 11)"]);
    // 新訪客預設在 K線學堂：情報局的介紹卡不擋在課程上面；切到情報局才出現
    assert.equal(await p.evaluate(() => [CUR_TAB, $("#hero").hidden].join()), "learn,true", "K線學堂第一個畫面就是課程");
    await p.evaluate(() => goTab("intel")); await p.waitForTimeout(300);
    const hero = await p.evaluate(() => $("#hero").innerText);
    assert.match(hero, /把台美股公開資料[\s\S]*看得懂的研究工具[\s\S]*政府公開資料與市場行情[\s\S]*不是投資建議/);
    assert.doesNotMatch(hero, /突破訊號|全部來自政府公開資料/, "不誇大、不寫成交易訊號");
    assert.ok(await p.evaluate(() => !!document.querySelector('#hero a[href="pro.html"]')));
    assert.match(await p.evaluate(() => document.querySelector("footer").innerText), new RegExp(DISC));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "橫向溢出");
    await p.click("#heroX"); assert.ok(await p.evaluate(() => $("#hero").hidden && store.get("heroHide", false)));
    await p.reload(); await p.waitForTimeout(600); assert.ok(await p.evaluate(() => $("#hero").hidden), "收起要記住");
    await p.evaluate(() => goTab("intel")); assert.ok(await p.evaluate(() => $("#hero").hidden), "收起後切回情報局也不再出現");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("公開測試版 (Beta) 頁：沒有價格方案、收更新通知、免責聲明與資料來源", async () => {
  const { ctx, p, errs } = await open(B, S.url, "pro.html", { width: 390, touch: true });
  let sent = null; await ctx.route("**/api/sync", r => { sent = JSON.parse(r.request().postData()); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const txt = await p.evaluate(() => document.body.innerText);
  assert.match(txt, /公開測試版 \(Beta\)/); assert.doesNotMatch(txt, /NT\$|Team|升級 PRO/);
  assert.match(txt, /政府資料開放授權條款第1版/);
  await p.fill("#wlEmail", "me@example.com"); await p.click("#wlForm button[type=submit]");
  await p.waitForFunction(() => /已登記/.test($("#wlMsg").textContent));
  assert.deepEqual(sent, { op: "waitlist", email: "me@example.com", plan: "beta" });
  assert.match(await p.evaluate(() => $("#disc").textContent), new RegExp(DISC));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("去識別化：量價動能矩陣、節目頭像、供應鏈說明與籌碼標籤、大戶與國會情報", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/data/podcast/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ shows: [{ feed: "f1", name: "測試節目", author: "主持人", art: "https://example.com/cover.jpg" }], eps: [] }) }));
  const tabs = await p.evaluate(() => $("#lTabs").innerText); assert.match(tabs, /資金雷達[\s\S]*供應鏈[\s\S]*節目[\s\S]*大戶國會/); assert.doesNotMatch(tabs, /名人/);
  assert.deepEqual(await p.evaluate(() => Object.values(FLOW_Q).map(x => x[0])), ["強勢突破區", "高檔調節區", "主力吸籌區", "量縮整理區"]);
  await p.evaluate(() => { setLt("money"); W.mf.view = "bubble"; renderList(); });
  assert.doesNotMatch(await p.evaluate(() => document.body.innerText), /潮汐|漲潮|退潮|泡泡/);
  // 節目：用頻道自己的頭像；沒有頭像（或載入失敗）才用 SVG 縮寫徽章
  assert.match(await p.evaluate(() => podArt({ name: "測試節目", art: "https://example.com/x.jpg" })), /<img [^>]*src="https:\/\/example\.com\/x\.jpg"/);
  assert.match(await p.evaluate(() => podArt({ name: "測試節目" })), /<svg class="badge"/);
  const fb = await p.evaluate(async () => { const d = document.createElement("div"); d.innerHTML = podArt({ name: "測試節目", art: "data:image/png;base64,AAAA" }); document.body.append(d); await new Promise(r => setTimeout(r, 300)); const h = d.innerHTML; d.remove(); return h; });
  assert.match(fb, /pbadge[\s\S]*<svg class="badge"/, "頭像載入失敗要換成徽章");
  // 供應鏈：公司旁的說明是「上中下游・環節」，加上籌碼標籤（借券賣出異常）
  await p.evaluate(() => { W.chipx = { lend: { 2330: [5000, 20000] } }; W.ins = { rows: [{ d: new Date().toISOString().slice(0, 10), code: "2330" }] }; const T = IND.themes.find(t => indChainData(t).some(g => g.items.some(i => i.c.some(x => x[0] === "2330")))); W.indS.open = T.id; setLt("ind"); W.indS.exp = {}; indChainData(T).forEach((g, i) => (W.indS.exp[`${T.id}:t${i}`] = true)); renderInd(); });
  const ind = await p.evaluate(() => $("#lx").innerText);
  assert.match(ind, /2330・(上游|中游|下游|產業鏈)/); assert.match(ind, /借券賣出異常 5,000 張/); assert.match(ind, /內部人申報 1 筆/);
  await p.evaluate(() => { setLt("cong"); W.cv = "home"; renderList(); });
  assert.match(await p.evaluate(() => $("#lTools").innerText), /大戶與國會情報/); assert.match(await p.evaluate(() => $(".foot-disc").innerText), new RegExp(DISC));
  // 免責聲明只在頁尾出現一次，不在每個清單、子頁重複
  assert.equal(await p.evaluate(() => (document.body.innerText.match(/不構成任何證券投資顧問/g) || []).length), 1);
  // 台股、美股熱門併進排行：清單分頁沒有獨立的熱門，排行上方可以切換
  assert.doesNotMatch(await p.evaluate(() => $("#lTabs").innerText), /台股熱門|美股熱門/);
  await p.evaluate(() => setLt("rank")); assert.match(await p.evaluate(() => $("#rkHub").innerText), /台股排行[\s\S]*台股熱門[\s\S]*美股熱門/);
  await p.click('#rkHub [data-l="us"]'); assert.equal(await p.evaluate(() => [W.lt, $('#lTabs [data-l="rank"]').getAttribute("aria-pressed")].join()), "us,true");
  // 大盤的熱門股只有一區（台股、美股切換），沒有另外的「前 8 名」
  await p.evaluate(() => { setLt("mkt"); W.mkReg = "tw"; renderList(); }); assert.ok(await p.evaluate(() => !!document.querySelector("[data-hotgo]")));
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#lx section.mk h3")].filter(h => /熱門/.test(h.textContent)).length), 1);
  await p.click('[data-mk="hotM"][data-v="tw:us"]'); assert.equal(await p.evaluate(() => document.querySelector("[data-hotgo]").dataset.hotgo), "us");
  // 選股的數字格：文字和底色要看得清楚（新主題的強調色是白色）
  assert.ok(await p.evaluate(() => { const b = document.createElement("button"); b.className = "gtile"; b.innerHTML = "<span>x</span><b>3</b>"; document.body.append(b); const cs = getComputedStyle(b.querySelector("b")), ok = cs.color !== cs.backgroundColor; b.remove(); return ok; }));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("手機：在清單、分頁列上往上滑，整頁都要能捲動（不被內層捲動區卡住）", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.evaluate(() => { W.groups[0].list = Array.from({ length: 40 }, (_, i) => String(1101 + i)); setLt("watch"); });
  await p.waitForTimeout(800);
  const c = await ctx.newCDPSession(p), swipe = async (x, y) => { await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); for (let i = 1; i <= 10; i++) { await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 20 }] }); await p.waitForTimeout(16); } await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await p.waitForTimeout(400); };
  assert.equal(await p.evaluate(() => getComputedStyle($("#wl")).overflowY), "visible", "手機上清單不要自己捲");
  for (const [x, y] of [[60, 600], [200, 500], [330, 700]]) { const a = await p.evaluate(() => scrollY); await swipe(x, y); assert.ok(await p.evaluate(() => scrollY) > a, `在 (${x},${y}) 往上滑沒有捲動`); }
  await ctx.close(); assert.deepEqual(errs, []);
});

test("合併重複功能：盤後、籌碼動向併進排行，盤後總結＋分享在工具，多空研判併進市場狀態", async () => {
  for (const width of [390, 1280]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
    assert.doesNotMatch(await p.evaluate(() => $("#lTabs").innerText), /盤後/);
    await p.evaluate(() => setLt("rank")); assert.match(await p.evaluate(() => $("#rkHub").innerText), /盤後資料/);
    await p.click('#rkHub [data-l="after"]'); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => [W.lt, $('#lTabs [data-l="rank"]').getAttribute("aria-pressed")].join()), "after,true");
    assert.match(await p.evaluate(() => $("#lx").innerText), /籌碼動向/); assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /主力追蹤/);
    await p.click('[data-af="chipx"]'); await p.waitForFunction(() => /千張大戶/.test($("#lx").innerText));
    assert.ok(await p.evaluate(() => !TOOLS_VIEWS.some(x => x[0] === "chipx")));
    // 舊的「工具 → 籌碼動向」會自動帶到新位置
    await p.evaluate(() => { W.tv = "chipx"; setLt("tools"); }); await p.waitForTimeout(300); assert.equal(await p.evaluate(() => [W.lt, afView()].join()), "after,chipx");
    // 盤後總結＋分享：在情報局 → 今日重點，資金雷達今日只留連結
    await p.evaluate(() => { W.mf.model = { T: 1, dates: ["2026-10-16"] }; window.flowMood = () => null; window.flowSummary = () => "測試盤後總結"; setLt("today"); });
    assert.match(await p.evaluate(() => $("#lx").innerText), /盤後總結[\s\S]*測試盤後總結/);
    assert.equal(await p.evaluate(() => document.querySelectorAll('#lx [data-mshare]').length), 4);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "橫向溢出");
    // 個股總覽：多空研判不再是獨立子頁
    assert.ok(await p.evaluate(() => !DSUB.ovw.some(x => x[0] === "ls") && DSUB.ovw[0][0] === "state"));
    await ctx.close(); assert.deepEqual(errs, []);
  }
});
