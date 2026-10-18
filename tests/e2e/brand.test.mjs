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
    assert.match(await p.evaluate(() => $("#hero").innerText), /把複雜的台美股機構籌碼[\s\S]*突破訊號/);
    assert.ok(await p.evaluate(() => !!document.querySelector('#hero a[href="pro.html"]')));
    assert.match(await p.evaluate(() => document.querySelector("footer").innerText), new RegExp(DISC));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "橫向溢出");
    await p.click("#heroX"); assert.ok(await p.evaluate(() => $("#hero").hidden && store.get("heroHide", false)));
    await p.reload(); await p.waitForTimeout(600); assert.ok(await p.evaluate(() => $("#hero").hidden), "收起要記住");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("Pro 方案頁：方案、候補名單送出、免責聲明", async () => {
  const { ctx, p, errs } = await open(B, S.url, "pro.html", { width: 390, touch: true });
  let sent = null; await ctx.route("**/api/sync", r => { sent = JSON.parse(r.request().postData()); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  assert.match(await p.evaluate(() => document.body.innerText), /Free[\s\S]*Pro[\s\S]*Team/);
  await p.click('[data-plan="team"]'); await p.fill("#wlEmail", "me@example.com"); await p.click("#wlForm button[type=submit]");
  await p.waitForFunction(() => /已加入候補名單/.test($("#wlMsg").textContent));
  assert.deepEqual(sent, { op: "waitlist", email: "me@example.com", plan: "team" });
  assert.match(await p.evaluate(() => $("#disc").textContent), new RegExp(DISC));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("去識別化：量價動能矩陣、節目頭像、供應鏈說明與籌碼標籤、大戶與國會情報", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await ctx.route("**/data/podcast/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ shows: [{ feed: "f1", name: "測試節目", author: "主持人", art: "https://example.com/cover.jpg" }], eps: [] }) }));
  const tabs = await p.evaluate(() => $("#lTabs").innerText); assert.match(tabs, /資金雷達[\s\S]*供應鏈[\s\S]*節目觀點[\s\S]*大戶國會/); assert.doesNotMatch(tabs, /名人/);
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
  await p.evaluate(() => { setLt("mkt"); W.mkReg = "tw"; renderList(); }); assert.ok(await p.evaluate(() => !!document.querySelector(".hotmini [data-hotgo]")));
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
