// 稽核修正 B 批（Gemini Spark／Antigravity 報告查證後）：推估位階中性色、圖表小按鈕觸控範圍、法人「載入中」、
// 收盤後預估說明位置、名詞 ⓘ 說明、AI 無法使用時的退路、存股頁直接開啟時的回主站連結
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const selectWorkspace = async (p, id) => { await p.click('#lx [data-mc-tab="' + id + '"]'); await p.waitForFunction(k => document.querySelector('#lx [data-mc-tab="' + k + '"]')?.getAttribute("aria-selected") === "true", id); };

test("推估位階（壓力、支撐）的線與標籤不用漲跌紅綠；兩種主題都一樣", async () => {
  for (const theme of ["dark", "light"]) {
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280 });
    const c = await p.evaluate(t => {
      document.documentElement.dataset.theme = t;
      document.body.insertAdjacentHTML("beforeend", `<div class="td-ix" id="__lv"><div class="td-ix-lv"><span class="up">壓力</span><span class="down">支撐</span></div><svg><line class="lv up"/><line class="lv down"/></svg></div>`);
      const probe = v => { const i = document.createElement("i"); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
      const q = s => document.querySelector("#__lv " + s);
      return { up: probe("--up"), down: probe("--down"), level: probe("--level"), labUp: getComputedStyle(q(".td-ix-lv .up")).color, labDn: getComputedStyle(q(".td-ix-lv .down")).color, lineUp: getComputedStyle(q("line.up")).stroke, lineDn: getComputedStyle(q("line.down")).stroke, dashUp: getComputedStyle(q("line.up")).strokeDasharray, dashDn: getComputedStyle(q("line.down")).strokeDasharray };
    }, theme);
    for (const k of ["labUp", "labDn", "lineUp", "lineDn"]) { assert.notEqual(c[k], c.up, `${theme} ${k} 不是上漲紅`); assert.notEqual(c[k], c.down, `${theme} ${k} 不是下跌綠`); assert.equal(c[k], c.level, `${theme} ${k} 用 --level`); }
    assert.notEqual(c.dashUp, c.dashDn, "壓力、支撐用不同虛線區分");
    await ctx.close(); assert.deepEqual(errs, []);
  }
});

test("手機：個股技術頁的縮放列與副圖訊號開關，點擊範圍約 44px 高且不蓋到鄰居", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true }); await p.waitForTimeout(600);
  await p.evaluate(() => select("2330")); await p.waitForTimeout(1000); await p.evaluate(() => setDtab?.("tech")); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => [...document.querySelectorAll("#detail .zoombar button, #detail [data-sk]")].filter(x => x.offsetParent).slice(0, 8).map(e => {
    const b = e.getBoundingClientRect(), cx = b.x + b.width / 2, cy = b.y + b.height / 2, own = y => { const t = document.elementFromPoint(cx, y); return !!t && (t === e || e.contains(t)); };
    let n = e.nextElementSibling; while (n && !n.matches("button, [data-sk]")) n = n.nextElementSibling; /* 跳過分隔線等非按鈕元素 */
    const nOk = !n || !n.offsetParent || (() => { const q = n.getBoundingClientRect(), t = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return !!t && (t === n || n.contains(t)); })();
    return [e.textContent.trim(), own(cy - 20) && own(cy + 20), nOk]; }));
  assert.ok(r.length >= 4, "有縮放鈕與訊號開關：" + JSON.stringify(r));
  for (const [name, tall, nb] of r) { assert.ok(tall, name + " 上下各 20px 都點得到"); assert.ok(nb, name + " 不蓋到右邊的按鈕"); }
  await ctx.close(); assert.deepEqual(errs, []);
});

test("今日市場：法人資料還在載入時說「載入中」，不說「日期未提供」；技術攻防有 ⓘ 名詞說明與 AI 退路說明", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: new Date("2026-10-26T08:00:00+08:00") });
  await p.evaluate(() => { W.mf.days = []; W.mf.model = null; W.mf.loading = true; W.mf.sumTry = true; W.tdPh = null; setLt("today"); renderList(); });
  await selectWorkspace(p, "capital");
  const t = await p.textContent("#lx .mc-capital-panel");
  assert.match(t, /法人資料載入中/); assert.doesNotMatch(t, /法人日期未提供/);
  assert.ok(await p.$("#lx .mc-capital-panel h4 .itip"), "法人資金流向有 ⓘ");
  await selectWorkspace(p, "overview"); assert.ok(await p.$("#lx .mc-breadth-panel h4 .itip"), "市場廣度有 ⓘ");
  await selectWorkspace(p, "technical"); assert.ok(await p.$("#lx .mc-level-row.pivot .itip"), "多空分水嶺有 ⓘ");
  await selectWorkspace(p, "research"); assert.match(await p.textContent("#lx .mc-ai-panel"), /AI 暫時不能用.*技術攻防/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("技術攻防：收盤後「下一交易日預估」說明在位階上方", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: new Date("2026-10-26T15:00:00+08:00") });
  await p.evaluate(() => {
    W.cal = { hol: [] };
    W.quotes.set("T00", { code: "T00", name: "加權指數", price: 100, prev: 99, chg: 1, chgPct: 1.01, high: 101, low: 98, vol: 1000, date: "2026-10-26", time: "13:30:00", source: "證交所 MIS" });
    window.getBriefSnapshot = () => null; window.saveBriefSnapshot = () => {}; window.tdAtrFor = t => ({ t, state: "ok", atr: 2 });
    window.briefScenarios = (G, d) => ({ tradeDate: d, keyLevels: { pressure: 110, pivot: 100, support: 90 } });
    W.tdPh = null; setLt("today"); renderList();
  });
  await selectWorkspace(p, "technical");
  const order = await p.evaluate(() => { const est = document.querySelector("#lx .mc-tech-est"), lad = document.querySelector("#lx .mc-tech-ladder"); return est && lad ? !!(est.compareDocumentPosition(lad) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
  assert.equal(order, true, "說明在位階前面");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("存股頁：直接開網址時有「← 回主站」，嵌在主站裡（embed=1）時不顯示；demo-matrix 也有回主站連結", async () => {
  let { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390, touch: true }); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => { const a = document.querySelector(".sav-home"); return !!a?.offsetParent && a.getAttribute("href"); }), "./#savings");
  await ctx.close(); assert.deepEqual(errs.filter(e => !/Failed to load resource/.test(e)), []);
  ({ ctx, p, errs } = await open(B, S.url, "savings.html?embed=1", { width: 390, touch: true })); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => !!document.querySelector(".sav-home")?.offsetParent), false);
  await ctx.close();
  ({ ctx, p } = await open(B, S.url, "demo-matrix.html", { width: 390, touch: true })); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.querySelector('header a[href="./#radar"]')?.textContent.includes("回 KLineLab 主站")), true);
  await ctx.close();
});
