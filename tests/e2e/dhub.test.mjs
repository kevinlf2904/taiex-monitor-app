// 決策中心整理（P2）：休市日推演下一交易日、資金卡只有一張、狀態說明只有一條、顏色用主題色票、推演快照不同步
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const selectWorkspace = async (p, id) => {
  await p.click(`#lx [data-mc-tab="${id}"]`);
  await p.waitForFunction(key => document.querySelector(`#lx [data-mc-tab="${key}"]`)?.getAttribute("aria-pressed") === "true", id);
};


for (const [width, theme] of [[390, "dark"], [1280, "light"]]) test(`週末：推演下一交易日、資金與狀態不重複、色票 ${width} ${theme}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.clock.setFixedTime(new Date("2026-10-25T10:00:00+08:00")); // 週日
  await p.evaluate(t => { document.documentElement.dataset.theme = t; localStorage.removeItem("kline:watch:brief:snap:2026-10-25"); setLt("today"); }, theme);
  await selectWorkspace(p, "technical");
  await p.waitForFunction(() => document.querySelector('#lx details[data-tdbox="plan"]')?.open && /下一交易日/.test($("#lx").innerText), null, { timeout: 15000 }); // 休市日預設展開「盤前推演」（下一交易日的準備）
  const t = await p.evaluate(() => $("#lx").innerText);
  assert.match(t, /今天休市，下面是下一交易日 10\/26（週一）的盤前推演/);
  assert.doesNotMatch(t, /日期不一致/, "不再替休市日產生推演、再說日期對不上");
  assert.equal(await p.evaluate(() => !!localStorage.getItem("kline:watch:brief:snap:2026-10-26") && !localStorage.getItem("kline:watch:brief:snap:2026-10-25")), true, "快照存在下一交易日");
  assert.equal(await p.$$eval("#lx .dh-note-bar", L => L.length), 1); assert.equal(await p.$$eval("#lx .mkclosed", L => L.length), 0, "休市說明只有一條");
  assert.equal(await p.$$eval("#lx style", L => L.length), 0, "樣式在 core.css，不在 JS 裡");
  const C = await p.evaluate(() => { const g = s => getComputedStyle(document.querySelector(s)), ink = getComputedStyle(document.body).color; return { ink, lvl: g("#lx .dh-lvl b").color, badgeBg: g("#lx .dh-badge").backgroundColor, num: g("#lx .dh-lvl b").fontFamily === getComputedStyle(document.querySelector(".num") || document.body).fontFamily || /Song|宋|Serif|PMingLiU/i.test(g("#lx .dh-lvl b").fontFamily) }; });
  assert.equal(C.lvl, C.ink, "壓力、分水嶺、支撐用中性色"); assert.ok(!/37, 99, 235|5, 150, 105|124, 58, 237|99, 102, 241/.test(C.badgeBg), `徽章不是寫死的藍綠紫：${C.badgeBg}`); assert.ok(C.num, "價位用行情數字字型");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 全部展開：資金卡只有一張、資金資料的狀態只說一次、週末不寫「盤中」
  await p.click("#lx [data-tdall]"); await p.waitForFunction(() => document.querySelectorAll("#lx details.dh-sec[open] .dh-sec-b").length === 4);
  await selectWorkspace(p, "capital");
  // 隱藏工作區仍屬於同一頁；以所有工作區的 DOM 文字計數，避免切頁後漏抓重複內容。
  const allWorkspaceText = await p.evaluate(() => [...document.querySelectorAll("#lx [data-mc-section]")].map(el => el.textContent || "").join("\\n"));
  const cnt = re => (allWorkspaceText.match(re) || []).length;
  assert.equal(cnt(/資金雷達・板塊輪動與資金流向/g), 1); assert.equal(cnt(/法人資金資料/g), 1, "所有工作區的資金資料狀態只出現一次");
  await selectWorkspace(p, "technical");
  const t2 = await p.evaluate(() => $("#lx").innerText);
  assert.match(t2, /最近交易日盤後整理/, "週末交易情境明確標示最近交易日盤後整理");
  assert.match(t2, /最近交易日事件回顧/, "週末事件時間軸標示為歷史回顧");
  assert.doesNotMatch(t2, /盤中監控/, "週末不把最近交易日事件誤標為盤中監控");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("推演快照不同步、不匯出；舊雲端資料裡的快照不寫回；其他資料照舊同步 390", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  const r = await p.evaluate(() => {
    localStorage.setItem("kline:watch:brief:snap:2026-10-26", "{}"); localStorage.setItem("kline:watch:notes", '{"2330":[]}');
    const snap = syncSnap(), n = syncApply({ "kline:watch:brief:snap:2026-01-02": "{}", "kline:watch:p2test": "1" });
    return { snapHas: "kline:watch:brief:snap:2026-10-26" in snap, notes: "kline:watch:notes" in snap, n, applied: localStorage.getItem("kline:watch:p2test"), skipped: localStorage.getItem("kline:watch:brief:snap:2026-01-02") };
  });
  assert.deepEqual(r, { snapHas: false, notes: true, n: 1, applied: "1", skipped: null });
  await ctx.close(); assert.deepEqual(errs, []);
});
