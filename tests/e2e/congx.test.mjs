// 大戶國會延伸：大戶共識榜、我的追蹤（☆ 追蹤、新申報）、申報延遲、勝率卡、13F 主題熱圖
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`大戶國會延伸功能 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await p.evaluate(() => { showList(); setLt("cong"); });
  await p.waitForFunction(() => W.cong?.trades?.length, null, { timeout: 15000 });
  const lx = () => p.evaluate(() => document.getElementById("lx").innerText);
  // 清單每一列：名稱按鈕要佔滿整列（之前 ☆ 吃掉 width: 100%，點哪裡都變成加自選）
  const bw = await p.evaluate(() => { const li = document.querySelector("#lx .tw-rank li"), b = li.querySelector("button"); return [b.getBoundingClientRect().width, li.getBoundingClientRect().width]; });
  assert.ok(bw[0] > bw[1] * 0.7, `名稱按鈕寬 ${bw[0]}／整列 ${bw[1]}`);
  await p.locator("#lx .tw-rank li > button").first().click(); assert.match(await p.evaluate(() => W.cv), /^(stock|person):/, "點列會打開股票或人物");
  await p.evaluate(() => { W.cv = "home"; renderList(); });
  // 國會自訂區間
  await p.fill('[data-cxrng="cong:from"]', "2025-01-01"); await p.fill('[data-cxrng="cong:to"]', "2025-03-31"); await p.dispatchEvent('[data-cxrng="cong:to"]', "change");
  await p.waitForFunction(() => W.cw === -1); assert.match(await lx(), /2025\/01\/01～2025\/03\/31/);
  assert.ok(await p.evaluate(() => congWin(-1).every(t => t.traded >= "2025-01-01" && t.traded <= "2025-03-31")));
  await p.click("[data-cxrngx]"); assert.equal(await p.evaluate(() => W.cw), 90, "清除區間回到近 90 天");
  // 13F 季度區間（用歷史季度重算變動）
  await p.route("**/data/f13-hist.json", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ "1": { who: "測試機構", periods: [{ period: "2026-03-31", filed: "2026-05-15", total: 5e7, rows: [{ name: "NVIDIA", cusip: "2", ticker: "NVDA", value: 5e7, sh: 5e5 }, { name: "OLD", cusip: "9", ticker: "OLD", value: 1e6, sh: 1e4 }] }] } }) }));
  await p.evaluate(() => { W.f13H = undefined; W.cv = "f13"; W.f13v = "up"; renderList(); }); await p.waitForSelector('[data-f13r="to"]');
  await p.selectOption('[data-f13r="from"]', "2026-03-31"); await p.waitForFunction(() => /比較 2026-03-31 → 2026-06-30/.test(document.getElementById("lx").innerText));
  assert.deepEqual(await p.evaluate(() => { const F = cxF13Range(W.f13).funds[0]; return [F.rows.find(r => r.ticker === "NVDA").chg, F.sold.map(r => r.ticker)]; }), ["add", ["OLD"]]);
  // 內部人、台灣政治人物自訂區間
  await p.evaluate(() => { W.cv = "ins"; W.insF = "all"; renderList(); }); await p.fill('[data-cxrng="ins:from"]', "2026-08-01"); await p.dispatchEvent('[data-cxrng="ins:from"]', "change"); await p.waitForFunction(() => W.insW === -1);
  assert.match(await lx(), /2026\/08\/01～最新申報/);
  await p.evaluate(() => { W.cv = "tw"; renderList(); }); await p.fill('[data-cxrng="tw:from"]', "2026-06-01"); await p.dispatchEvent('[data-cxrng="tw:from"]', "change");
  assert.deepEqual(await p.evaluate(() => twoPeople().map(x => x.name)), ["王小明"], "只看區間內的申報");
  await p.click("[data-cxrngx]"); assert.equal(await p.evaluate(() => twoPeople().length), 2);
  await p.evaluate(() => { W.cv = "home"; renderList(); });
  // 大戶共識：台股（政治人物持有＋內部人）
  await p.click('#lTools [data-cv="cons"]'); await p.waitForFunction(() => /大戶共識榜/.test(document.getElementById("lx").innerText));
  await p.click('[data-rkset="cxReg:tw"]'); await p.waitForFunction(() => /2330/.test(document.getElementById("lx").innerText), null, { timeout: 15000 });
  assert.match(await lx(), /2 位持有[\s\S]*內部人近 90 天申報轉讓 1 筆/);
  // 申報延遲
  await p.evaluate(() => { W.cv = "home"; W.cview = "lag"; renderList(); }); assert.match(await lx(), /申報延遲：從交易到公開的天數/);
  // 人物頁：追蹤、延遲、勝率卡
  const pid = await p.evaluate(() => { const c = new Map(); W.cong.trades.filter(t => t.k === "buy").forEach(t => c.set(t.pid, (c.get(t.pid) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; });
  await p.evaluate(pid => { W.cv = "person:" + pid; renderList(); }, pid);
  await p.waitForSelector('#lx [data-cxfol]'); assert.match(await lx(), /申報延遲：中位數 \d+ 天/);
  await p.click('#lx [data-cxfol]'); assert.equal(await p.getAttribute('#lx [data-cxfol]', "aria-pressed"), "true");
  assert.ok(await p.evaluate(pid => !!store.get("watch:follow").cong[pid], pid), "追蹤存起來");
  await p.waitForFunction(() => /議員本人/.test(document.querySelector(".cxwin")?.innerText || ""), null, { timeout: 20000 });
  // 我的追蹤：列出追蹤的人、自選股的內部人申報
  await p.evaluate(() => { W.cv = "fol"; renderList(); }); await p.waitForFunction(() => /我的追蹤/.test(document.getElementById("lx").innerText));
  assert.ok((await lx()).includes(await p.evaluate(pid => pName(pid), pid)));
  // 每一種大戶都有熱圖、申報延遲、追蹤
  await p.evaluate(() => { W.cv = "home"; W.cview = "heat"; W.cw = 0; renderList(); }); assert.match(await lx(), /主題熱圖：這段期間議員在各產業主題買、賣/);
  await p.evaluate(() => { W.cv = "f13"; W.f13v = "lag"; W.f13R = null; renderList(); }); assert.match(await lx(), /季底到公開隔幾天[\s\S]*測試機構[\s\S]*45 天/);
  await p.evaluate(() => { W.cv = "tw"; renderList(); }); await p.waitForFunction(() => /政治人物持股集中在哪些產業/.test(document.getElementById("lx").innerText)); assert.match(await lx(), /申報日到刊登在廉政專刊/);
  await p.evaluate(() => { W.cv = "ins"; W.insF = "all"; W.insW = 0; W.insv = "heat"; renderList(); }); await p.waitForFunction(() => /內部人在哪些產業申報轉讓/.test(document.getElementById("lx").innerText));
  await p.fill("[data-cxinsadd] input", "2330"); await p.click("[data-cxinsadd] button"); await p.waitForSelector('.cxinsf [data-cxfol="ins:2330"]');
  assert.ok(await p.evaluate(() => !!store.get("watch:follow").ins["2330"]), "追蹤公司");
  await p.evaluate(() => { W.cv = "fol"; renderList(); }); await p.waitForFunction(() => /2330/.test(document.getElementById("lx").innerText) && /申報轉讓/.test(document.getElementById("lx").innerText));
  // 13F 主題熱圖
  await p.evaluate(() => { W.cv = "f13"; W.f13v = "heat"; renderList(); }); await p.waitForSelector(".cxheat");
  assert.match(await lx(), /主題熱圖/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await ctx.close(); assert.deepEqual(errs, []);
});
