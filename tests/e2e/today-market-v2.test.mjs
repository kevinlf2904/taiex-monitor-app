// 今日市場 V2：五工作區皆有對應視覺內容；來源日期與更新狀態可辨識；手機與桌面無水平溢位。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const selectWorkspace = async (page, id) => {
  await page.click('#lx [data-mc-tab="' + id + '"]');
  await page.waitForFunction(key => document.querySelector('#lx [data-mc-tab="' + key + '"]')?.getAttribute("aria-pressed") === "true", id);
};

for (const width of [390, 1280]) test("今日市場 V2：工作區視覺層級與資料標示 " + width, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.clock.setFixedTime(new Date("2026-10-26T10:30:00+08:00"));
  await p.evaluate(() => {
    W.quotes.set("T00", { code: "T00", name: "加權指數", price: 27500, prev: 27380, chg: 120, chgPct: 0.44, date: "2026-10-26", time: "10:30:00", sourceTime: "10:30:00", source: "證交所 MIS", open: 27400, high: 27550, low: 27390 });
    W.quotes.set("O00", { code: "O00", name: "櫃買指數", price: 260, chg: 1.2, chgPct: 0.46, date: "2026-10-26", time: "10:29:50", source: "櫃買中心" });
    W.quotes.set("TXF", { code: "TXF", name: "台指期", price: 27520, chg: 115, chgPct: 0.42, date: "2026-10-26", time: "10:29:40", source: "期交所" });
    W.bf = {
      at: Date.now(),
      us: {
        ok: true, dataStatus: "confirmed", updateMode: "after_close", dataDate: "2026-10-23",
        sourceTime: "16:00", tz: "美東", source: "Yahoo Finance",
        indices: [
          { code: "^DJI", name: "道瓊工業", price: 47000, chgPct: 0.35, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" },
          { code: "^GSPC", name: "S&P 500", price: 6800, chgPct: 0.5, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" },
          { code: "^SOX", name: "費城半導體", price: 6400, chgPct: 1.1, date: "2026-10-23", time: "16:00", source: "Yahoo Finance" }
        ],
        macro: [{ code: "^TNX", name: "美國 10 年期公債殖利率", price: 4.2, chgPct: -0.2, date: "2026-10-23", time: "16:00" }],
        megas: [{ code: "TSM", name: "台積電 ADR", price: 205, chgPct: 0.8, date: "2026-10-23", time: "16:00" }]
      }
    };
    W.tdPh = null;
    setLt("today");
    renderList();
  });

  await p.waitForSelector("#lx .mc-overview-grid", { timeout: 15000 });
  assert.equal(await p.$$eval("#lx .mc-nav [data-mc-tab]", buttons => buttons.length), 5);
  assert.ok(await p.$("#lx .mc-overview-grid .mc-panel"));
  assert.ok(await p.$("#lx .td-hero .td-main"));
  assert.ok(await p.$("#lx .td-hero .dh-core-grid"));
  await selectWorkspace(p, "capital");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-capital-panel")?.hidden), false);
  assert.match(await p.textContent("#lx .mc-capital-panel"), /法人資金流向排行/);
  await selectWorkspace(p, "global");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-global-panel")?.hidden), false);
  assert.match(await p.textContent("#lx .mc-global-panel"), /2026-10-23/);
  assert.match(await p.textContent("#lx .mc-global-panel"), /盤後更新/);
  assert.match(await p.textContent("#lx .mc-global-panel"), /費城半導體/);
  await selectWorkspace(p, "technical");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-tech-panel")?.hidden), false);
  assert.match(await p.textContent("#lx .mc-tech-panel"), /關鍵位階與攻防/);
  await selectWorkspace(p, "research");
  assert.equal(await p.evaluate(() => document.querySelector("#lx .mc-ai-panel")?.hidden), false);
  assert.equal(await p.evaluate(() => document.querySelector("#lx .dh-secs")?.hidden), true);

  const layout = await p.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    navButtons: [...document.querySelectorAll("#lx .mc-tab")].map(button => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    })
  }));
  assert.ok(layout.scrollWidth <= layout.width + 1, "V2 工作區不可造成水平溢位：" + JSON.stringify(layout));
  assert.ok(layout.navButtons.every(button => button.height >= 44 && button.width >= 44), "工作區按鈕須有足夠觸控尺寸");
  await ctx.close();
  assert.deepEqual(errs, []);
});
