// 這一版新增的 9 項：早報、事件提醒、筆記追蹤、選股條件組合、財報事件回測、估值地圖、總經敏感度、大按鈕模式、離線快取
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const J = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const nextWd = d => { const t = new Date(d + "T00:00:00Z"); do t.setUTCDate(t.getUTCDate() + 1); while (t.getUTCDay() % 6 === 0); return t.toISOString().slice(0, 10); };
// [代號, 名稱, 產業, 市場, 當月營收(億), 月增%, 年增%, 累計年增%, EPS, 季營收(億), 稅後淨利(億), 毛利率, 營益率, 淨利率]
const ROWS = [["2330", "台積電", "半導體業", "上市", 3300, 5.1, 36.2, 38.4, 15.2, 9300, 3980, 59.1, 49.5, 42.7], ["2317", "鴻海", "其他電子業", "上市", 7800, -3.2, 12.1, 18.0, 3.1, 18000, 430, 6.2, 2.9, 2.4],
  ["6488", "環球晶", "半導體業", "上櫃", 50, 2, -8.3, -6, 2.5, 160, 12, 30, 20, 7.5], ["3105", "穩懋", "半導體業", "上櫃", 15, 8, 45, 22, 1.2, 45, 5, 25, 12, 11], ["1101", "台泥", "水泥工業", "上市", 143, 6.0, 7.6, 3.3, 0.38, 713, 45.7, 18.2, 7.3, 6.4]];
const EH = { updated: "2026-10-21", streak: { ym: "2026-09", rows: [["2330", "台積電", "半導體業", "上市", 12, 36.2, 3300, 24], ["3105", "穩懋", "半導體業", "上櫃", 6, 45, 15, 0]] },
  pm: { q: "2026Q2", qp: "2026Q1", rows: [["2330", "台積電", "半導體業", "上市", 59.1, 49.5, 42.7, 1.2, 0.8, 0.5, 2, 2, 2, 3], ["3105", "穩懋", "半導體業", "上櫃", 25, 12, 11, -1, 0.5, 0.2, 0, 0, 0, 0]] }, pub: { ym: "2026-09", codes: ["2330"] } };
const BW = { ok: true, rows: { 2330: [25, 6, 1.5], 2317: [14, 1.5, 3.2], 6488: [18, 2, 3], 3105: [12, 2, 4.5], 1101: [14, 1, 5.2] } };
async function fund(p) {
  await p.route("**/api/oapi?earn=1", r => J(r, { ok: true, ym: "11509", yq: "115Q2", source: "測試", rows: ROWS }));
  await p.route("**/data/earn-hist.json", r => J(r, EH));
  await p.route("**/api/screen?bw=1", r => J(r, BW));
  await p.route(/\/api\/daily\?date=/, r => { const d = new URL(r.request().url()).searchParams.get("date"); J(r, { ok: true, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, rows: [["2330", "台積電", 1000, 1.2, 500, 300, 10, 20000], ["3105", "穩懋", 150, 2, -100, -50, 0, 3000], ["1101", "台泥", 30, 0.5, 20, -10, 5, 5000]] }); });
  await p.route("**/api/calendar**", r => J(r, { ok: true, rows: [{ date: TODAY, code: "2330", name: "台積電", kind: "除息", cash: 4.5 }, { date: TODAY, code: "1101", name: "台泥", kind: "除息", cash: 1 }], conf: [{ date: nextWd(TODAY), time: "14:00", code: "2330", name: "台積電", place: "台北" }], hol: [] }));
}
const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

for (const width of [390, 1280]) test(`工具「早報」：昨晚美股、台指期夜盤、除權息、持股新消息、AI 整理 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await fund(p);
  await p.route("**/api/usmarket", r => J(r, { ok: true, date: "2026-10-21", indices: [{ code: "^DJI", name: "道瓊工業", price: 42100, chgPct: 0.8 }, { code: "^SOX", name: "費城半導體", price: 6100, chgPct: -1.2 }], megas: [{ code: "TSM", name: "台積電 ADR", price: 210, chgPct: 1.5 }], macro: [{ code: "^TNX", name: "10 年期公債殖利率", price: 4.2, chgPct: 0.3 }], sectors: [] }));
  await p.route(/\/api\/futures\?bars=0$/, r => J(r, { ok: true, quote: { price: 23000, chg: -50, chgPct: -0.22, session: "night" }, night: { price: 23000, chg: -50, chgPct: -0.22, time: "05:00" }, day: null }));
  await p.route("**/api/news**", r => J(r, { ok: true, items: [{ title: "台積電先進封裝擴產", source: "測試報", link: "https://example.com/a", at: Date.now() - 3600e3 }] }));
  await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 500 } }; showList?.(); W.tdPh = { d: twDay(), ph: "pre" }; setLt("today"); }); // 早報在今日市場的「國際市場與總經」＋「交易情境」（盤前階段）
  await p.waitForFunction(() => /持股新消息/.test($("#lx").innerText), null, { timeout: 15000 });
  const t = await p.evaluate(() => $("#lx").innerText);
  for (const s of ["昨晚美股", "道瓊工業", "費城半導體", "台積電 ADR", "台指期", "夜盤 23,000", "除權息", "2330 除息 現金 4.5 元", "台積電先進封裝擴產", "今天要注意", "法說會"]) assert.ok(t.includes(s), `早報要有「${s}」`);
  assert.ok(t.indexOf("★ ") > 0 && t.indexOf("★ ") < t.indexOf("1101 除息"), "庫存的除權息排前面、有星號");
  assert.equal(await p.evaluate(() => W.lt), "today", "舊的「早報」分頁帶到情報局的「今日市場」");
  assert.match(t, /國際市場與總經[\s\S]*昨晚美股[\s\S]*盤前推演/); assert.equal((t.match(/昨晚美股/g) || []).length, 1, "昨晚美股只在總經儀表板，盤前推演不再列一次");
  await p.waitForFunction(() => !!document.querySelector('#lx details[data-tdbox="plan"] .td-plan-live'));
  const mineBody = await p.evaluate(() => $('#lx details[data-tdbox="mine"] .dh-sec-b')?.innerText || "");
  assert.match(await p.evaluate(() => $("#lx").innerText), /盤後總結[\s\S]*自選漲幅前 5/, "盤後資金摘要在資金區、自選排行在持股區");
  assert.match(mineBody, /自選／庫存漲幅前 5[\s\S]*自選／庫存跌幅前 5/, "持倉與自選排行歸入個人區");
  assert.match(await p.evaluate(() => $('#lx details[data-tdbox="mac"] .dh-sec-b')?.innerText || ""), /美股資料日期[\s\S]*來源時間/, "國際行情就近顯示日期與來源時間");
  assert.doesNotMatch(await p.evaluate(() => $('#lx details[data-tdbox="plan"] .dh-sec-b')?.innerText || ""), /自選漲幅前 5|盤後總結/, "交易情境只呈現盤前／盤中／盤後時間序列");
  assert.equal(await p.$$eval("#lx [data-tx='tdai']", L => L.length), 1, "AI 整理只有一個");
  await p.click('[data-tx="tdai"]'); await p.waitForFunction(() => /測試回覆/.test($("#lx .caibox")?.innerText || ""));
  assert.ok(await noOverflow(p));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("事件提醒：營收公布、三率三升、法說會前一天，同一件事只通知一次；筆記追蹤：記筆記、目標價、徽章", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await fund(p);
  await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 500 } }; W.cal = null; W.tv = "alert"; setLt("tools"); }); // 開頁時「今日重點」可能已經用預設假資料抓過行事曆
  await p.waitForSelector('[data-eva="rev"]');
  for (const k of ["rev", "pm3", "conf"]) await p.click(`[data-eva="${k}"]`);
  assert.deepEqual(await p.evaluate(() => { const S = store.get("watch:evalert"); return [S.rev, S.pm3, S.conf, !!S.brief]; }), [true, true, true, false]);
  await p.evaluate(() => evCheck());
  const hits = await p.evaluate(() => W.evHits.map(x => [x.kind, x.m]));
  assert.deepEqual(hits.map(x => x[0]).sort(), ["conf", "pm3", "rev"]);
  assert.match(hits.find(x => x[0] === "rev")[1], /2330：9 月營收 3300\.00 億，年增 \+36\.2%、月增 \+5\.1%，創 24 個月新高/);
  assert.match(hits.find(x => x[0] === "pm3")[1], /2026 年第 2 季三率三升/);
  assert.match(hits.find(x => x[0] === "conf")[1], /14:00 開法說會（台北）/);
  assert.match(await p.textContent("#toast"), /事件提醒（3 則）/);
  await p.evaluate(() => { $("#toast").textContent = ""; return evCheck(); });
  assert.doesNotMatch(await p.textContent("#toast"), /事件提醒（/, "通知過的不再跳");
  // 筆記追蹤
  await p.evaluate(() => { W.tv = "notes"; renderList(); });
  await p.fill("#ntCode", "2317"); await p.fill("#ntText", "等回測月線再看"); await p.fill("#ntUp", "300"); await p.click("#ntForm button");
  assert.deepEqual(await p.evaluate(() => [store.get("watch:notes")["2317"][0].t, W.alerts["2317"].up]), ["等回測月線再看", 300]);
  await p.waitForFunction(() => /等回測月線再看/.test($("#lx").innerText) && /\+\d/.test($("#lx .nttbl").innerText), null, { timeout: 10000 });
  await p.evaluate(() => select("2317")); await p.waitForFunction(() => /筆記\s*1 則/.test($("#dIntel").innerText), null, { timeout: 10000 });
  await p.evaluate(() => { showList?.(); W.tv = "notes"; setLt("tools"); }); await p.click('[data-ntdel="2317:0"]');
  assert.equal(await p.evaluate(() => store.get("watch:notes")["2317"]), undefined);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`選股「條件組合」：預設組合、法人買超、儲存組合 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await fund(p);
  await p.evaluate(() => { showList?.(); setLt("screen"); W.scrG = "combo"; renderList(); });
  const codes = () => p.evaluate(() => [...document.querySelectorAll(".cbtbl tbody [data-sel]")].map(b => b.dataset.sel));
  await p.waitForSelector(".cbtbl"); assert.deepEqual(await codes(), ["2330"], "成長股：連續年增 6 月＋三率三升");
  await p.click('[data-cbpre="1"]'); await p.waitForSelector(".cbtbl"); assert.deepEqual(await codes(), ["3105"], "價值成長：年增 20%＋本益比 15 以下");
  await p.click('[data-cbpre="3"]'); await p.waitForSelector(".cbtbl"); assert.deepEqual(await codes(), ["3105"], "高殖利率＋成長");
  await p.evaluate(() => { CB().c = { trust: 3 }; renderList(); });
  await p.waitForFunction(() => document.querySelector(".cbtbl"), null, { timeout: 20000 }); assert.deepEqual(await codes(), ["2330"], "投信近 3 日買超");
  assert.match(await p.evaluate(() => $(".cbtbl").innerText), /投信 900/);
  p.removeAllListeners("dialog"); p.on("dialog", d => d.accept("投信認養")); await p.click("[data-cbsave]"); assert.equal(await p.evaluate(() => store.get("watch:cbs").map(x => x.name).join()), "投信認養");
  assert.match(await p.evaluate(() => $(".cbpre").innerText), /我的組合\s*投信認養/);
  assert.ok(await noOverflow(p));
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`財報「事件回測」「估值地圖」 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await fund(p);
  const st = (n, avg) => ({ n, avg, med: avg / 2, p25: -0.05, p75: 0.08, win: 0.58, ex: avg / 3, exWin: 0.55 });
  await p.route("**/data/event-study.json", r => J(r, { updated: "2026-10-21T10:00:00Z", from: "2025-10-01", to: "2026-10-21", stocks: 1800, ns: [5, 10, 20],
    types: [{ t: "high", name: "月營收創新高", desc: "當月營收比過去至少 24 個月都高", stats: { 5: st(320, 0.012), 10: st(310, 0.021), 20: st(300, 0.034) }, hist: [5, 8, 20, 40, 60, 70, 50, 25, 12, 10], ind: [["半導體業", 40, 0.05, 0.6], ["水泥工業", 9, -0.01, 0.4]], recent: [["2330", "台積電", "2026-09", "2026-10-13", 0.02, null, null]] },
      { t: "pm3", name: "三率三升", desc: "毛利率、營益率、淨利率都比上一季高", stats: { 5: st(120, 0.005), 10: st(118, 0.01), 20: st(110, 0.02) }, hist: [1, 2, 5, 10, 20, 30, 20, 10, 5, 7], ind: [], recent: [] }] }));
  await p.evaluate(() => { ER().data = null; showList?.(); setLt("earn"); ER().reg = "tw"; ER().view = "evt"; renderList(); }); // 情報局預設的今日重點可能已經用預設假資料抓過財報
  await p.waitForSelector(".evtbl"); let t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /20 天\s+300\s+\+3\.4%/); assert.match(t, /半導體業/); assert.match(t, /進行中/);
  await p.click('.ichip[data-erevt="pm3"]'); await p.waitForFunction(() => /110/.test($(".evtbl").innerText));
  assert.equal(await p.evaluate(() => store.get("watch:erevt")), "pm3");
  assert.ok(await noOverflow(p));
  await p.click('[data-erv="map"]'); await p.waitForSelector(".fxmap circle", { timeout: 15000 });
  assert.equal(await p.evaluate(() => document.querySelectorAll(".fxmap circle").length), 3, "半導體業 3 家（台積電、環球晶、穩懋）");
  assert.match(await p.evaluate(() => $("#lx").innerText), /便宜＋成長[\s\S]*成長 ÷ 本益比/);
  // 點圓圈 → 旁邊跳出資訊框（不會直接跳走），框裡按「看個股」才切換；資訊框不能超出圖
  await p.click('.fxmap [data-fxpt="3105"] circle'); await p.waitForSelector(".fxtip");
  assert.match(await p.textContent(".fxtip"), /本益比[\s\S]*中位數[\s\S]*同業第 \d 低（共 3 家）[\s\S]*營收年增/); assert.notEqual(await p.evaluate(() => W.sel), "3105");
  assert.ok(await p.evaluate(() => { const b = document.querySelector(".fxmapbox").getBoundingClientRect(), t = document.querySelector(".fxtip").getBoundingClientRect(); return t.left >= b.left - 1 && t.right <= b.right + 1; }), "資訊框在圖裡面");
  assert.ok(await noOverflow(p)); if (process.env.SHOT) await p.locator("section.mk:has(.fxmap)").screenshot({ path: `${process.env.SHOT}/fxmap-${width}.png` });
  await p.click(".fxtip-x"); await p.waitForSelector(".fxtip", { state: "detached" });
  await p.click('.fxmap [data-fxpt="3105"] circle'); await p.click('.fxtip [data-sel="3105"]'); assert.equal(await p.evaluate(() => W.sel), "3105");
  assert.ok(await noOverflow(p));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("庫存「總經敏感度」：每檔對匯率、美債、費半、那指的影響與組合合計", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
  await p.evaluate(() => { W.hold = { 2330: { sh: 1000, cost: 500 }, 2317: { sh: 2000, cost: 100 } }; W.holdMkt = "tw"; W.holdView = "macro"; showList?.(); setLt("hold"); });
  await p.waitForSelector(".mstbl", { timeout: 20000 });
  const t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /台幣貶值 1%[\s\S]*殖利率上升 0\.1 個百分點[\s\S]*費半漲 1%[\s\S]*那指漲 1%/); assert.match(t, /整個組合/); assert.match(t, /情境試算/);
  assert.equal(await p.evaluate(() => document.querySelectorAll(".mstbl tbody tr").length), 3);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("大按鈕模式：首頁和看盤一起換，手機不會撐破畫面", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 390, touch: true });
  await p.click("#styleBtn"); await p.click('[data-spb="1"]');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.big), "1");
  assert.equal(await p.evaluate(() => store.get("big")), true);
  await p.click('[data-sp="x"]'); await p.evaluate(() => goTab("watch"));
  const f = await (await p.waitForSelector("#watchFrame")).contentFrame(); await f.waitForFunction(() => typeof W !== "undefined");
  assert.equal(await f.evaluate(() => document.documentElement.dataset.big), "1", "看盤頁一打開就是大按鈕");
  const h = await f.evaluate(() => getComputedStyle(document.querySelector("#lTabs button[data-l]")).minHeight); assert.equal(h, "40px");
  assert.ok(await noOverflow(p)); assert.ok(await f.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await f.evaluate(() => applyBig(false)); await p.waitForFunction(() => !document.documentElement.dataset.big);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("離線快取：開過一次之後，沒有網路也打得開，並顯示離線提示", async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width: 1280, sw: true });
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await p.waitForTimeout(500); await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector("#hero, .top", { timeout: 15000 });
  assert.match(await p.title(), /KLineLab/);
  await p.waitForFunction(() => /離線中/.test(document.getElementById("netBar")?.textContent || ""), null, { timeout: 10000 });
  await ctx.setOffline(false); await p.evaluate(() => dispatchEvent(new Event("online"))); assert.equal(await p.evaluate(() => !!document.getElementById("netBar")), false);
  await ctx.close(); assert.deepEqual(errs, []);
});

for (const width of [390, 1280]) test(`供應鏈「生態群島」：電腦兩列排完、手機一列兩座，點島切換，不撐破畫面 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await p.evaluate(() => { showList?.(); setLt("ind"); W.indS.view = "themes"; W.indS.open = null; renderList(); });
  await p.waitForSelector(".iisl"); await p.waitForFunction(() => /平均/.test($(".iislands").textContent), null, { timeout: 15000 });
  // offsetTop／offsetWidth 不受進場動畫（transform）影響
  const L = await p.evaluate(() => [...document.querySelectorAll(".iisl")].map(b => [b.offsetTop, b.offsetWidth, b.querySelector(".iisl-name").scrollWidth <= b.querySelector(".iisl-name").clientWidth + 1]));
  assert.ok(L.length >= 10, "AI、半導體、電子、軟體、能源、移動、運輸、國防、金融、醫療、民生各一座");
  const rows = new Set(L.map(x => x[0])).size;
  if (width > 1000) assert.ok(rows <= 2, `電腦版兩列排完（現在 ${rows} 列）`);
  else { assert.equal(rows, Math.ceil(L.length / 2), "手機一列兩座"); assert.ok(L.every(x => x[1] > 160), "手機版卡片各佔一半寬"); }
  assert.ok(L.every(x => x[2]), "島名不會被截斷");
  await p.locator('.iisl[data-iisl="semi"]').click(); // 用 locator：報價回來會重畫，每次點之前重新找
  await p.waitForFunction(() => document.querySelector('.iisl[data-iisl="semi"]')?.getAttribute("aria-pressed") === "true");
  assert.match(await p.textContent(".iisl-banner h3"), /半導體 生態群島/);
  assert.match(await p.textContent(".iisl-stats"), /今日平均[\s\S]*漲／跌題材[\s\S]*最強題材/);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".iisl-top b")).backgroundColor), "rgba(0, 0, 0, 0)", "最強題材沒有被別的樣式套上底色");
  assert.ok(await noOverflow(p));
  await ctx.close(); assert.deepEqual(errs, []);
});
