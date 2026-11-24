// 大盤：總經、預測市場、原物料外匯點進去看走勢
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [1280, 390]) test(`總經與預測市場 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await p.evaluate(() => setLt("mkt")); await p.waitForTimeout(600);
  await p.click('#lx [data-mk="mkReg"][data-v="macro"]'); await p.waitForFunction(() => document.querySelector("#lx .mcsig"));
  assert.match(await p.evaluate(() => $("#lx").innerText), /薩姆規則[\s\S]*最近的變化可能對股市造成的影響[\s\S]*美元兌日圓[\s\S]*套利交易[\s\S]*失業率[\s\S]*世界總經/);
  assert.match(await p.evaluate(() => $("#lx").textContent), /景氣循環位置[\s\S]*衰退警訊清單[\s\S]*全部指標的歷史位置與方向/);
  // #333 A6b：總經好壞用獨立的燈號色（綠＝穩定、黃＝留意、紅＝警訊），不沿用台股漲紅跌綠；「通膨 ↑」在縱軸上、不壓象限字；手機歷史表不用橫向捲
  const mx = await p.evaluate(() => {
    const rgb = e => getComputedStyle(e).color.match(/\d+/g).map(Number), bg = e => getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number);
    const sam = [...document.querySelectorAll("#lx .mx-chk li")].find(li => /薩姆規則/.test(li.textContent)), risk = [...document.querySelectorAll("#lx .mx-big b")].find(b => /偏低|中等|偏高/.test(b.textContent));
    const q = document.querySelector("#lx .mx-q"), ay = q.querySelector(".ax-y").getBoundingClientRect(), qr = q.getBoundingClientRect(), ov = [...q.querySelectorAll("span")].some(sp => { const r = sp.firstChild ? (() => { const g = document.createRange(); g.selectNodeContents(sp); return g.getBoundingClientRect(); })() : sp.getBoundingClientRect(); return !(r.right <= ay.left || r.left >= ay.right || r.bottom <= ay.top || r.top >= ay.bottom); });
    const t = document.querySelector("#lx .mx-tbl"), lvl = sam && /低點高 -|≥ 0\.5/.test(sam.textContent);
    return { samDot: sam && bg(sam.querySelector(".mx-dot")), riskTxt: risk?.textContent, riskC: risk && rgb(risk), oldCls: document.querySelectorAll("#lx .mx .mx-dot.up, #lx .mx .mx-dot.down, #lx .mx-chk b.up, #lx .mx-chk b.down").length,
      ayMid: ay.left >= qr.left + qr.width / 2 - 1, ov, tblOver: t.scrollWidth - t.parentElement.clientWidth, chk: [...document.querySelectorAll("#lx .mx-chk b")].map(b => b.textContent).join(" ") };
  });
  assert.equal(mx.oldCls, 0, "總經燈號不再用 up／down"); assert.ok(mx.samDot[1] > mx.samDot[0], `薩姆規則未觸發應是綠燈 ${mx.samDot}`);
  if (mx.riskTxt === "偏低") assert.ok(mx.riskC[1] > mx.riskC[0], "衰退風險偏低是綠色");
  assert.ok(mx.ayMid && !mx.ov, "「通膨 ↑」在縱軸上且不壓到象限文字"); assert.match(mx.chk, /好轉|轉弱|持平/, "成長項目用文字說明好轉或轉弱");
  if (width < 500) assert.ok(mx.tblOver <= 1, `手機歷史表超出 ${mx.tblOver}px`);
  assert.ok(await noHOverflow(p));
  await p.click('#lx [data-mk="mkReg"][data-v="poly"]'); await p.waitForFunction(() => document.querySelector("#lx .pmrows"));
  assert.match(await p.evaluate(() => $("#lx").textContent), /聯準會利率路徑[\s\S]*降息機率 85%[\s\S]*資金注意力分布/);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mk.pm").length), 2);
  await p.click('#lx [data-mk="pmCat"][data-v="台海與地緣政治"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mk.pm").length), 1);
  assert.ok(await noHOverflow(p));
  await p.click('#lx [data-mk="mkReg"][data-v="gl"]'); await p.waitForSelector('#lx [data-sel="CL=F"]');
  assert.equal(await p.evaluate(() => document.querySelectorAll('#lx [data-sel="TWD=X"], #lx [data-sel="DX-Y.NYB"]').length), 2);
  await p.click('#lx [data-sel="CL=F"]'); await p.waitForTimeout(800);
  assert.equal(await p.evaluate(() => W.sel), "CL=F"); assert.match(await p.evaluate(() => nameOf("CL=F")), /原油/);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("每日總經消息", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  const it = (title, topic, h) => ({ title, source: "測試報", link: "https://example.com/" + encodeURIComponent(title), at: Date.parse("2026-10-17T00:00:00Z") - h * 3600e3, topic });
  const day = (date, sum) => ({ date, at: Date.parse(date + "T00:00:00Z"), by: sum ? "m" : null, tw: { sum: sum ? { head: "央行按兵不動", points: ["外銷訂單年增"], impact: "可能支撐電子股" } : null, items: [it("央行利率決議維持不變", "利率", 1), it("9 月外銷訂單創高", "貿易", 2)] }, us: { sum: null, items: [it("美國 CPI 高於預期", "通膨", 3)] }, world: { sum: null, items: [it("日本央行升息 日圓走強", "利率", 4)] } });
  await ctx.route("**/data/macro-news.json", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: 1, days: [day("2026-10-17", true), day("2026-10-16", false)] }) }));
  await p.evaluate(() => { W.mn = null; setLt("mkt"); }); // 開頁時「今日重點」可能已經抓過真的總經消息 await p.waitForTimeout(500);
  await p.click('#lx [data-mk="mkReg"][data-v="news"]'); await p.waitForSelector("#lx .mn-sum");
  const txt = await p.evaluate(() => $("#lx").innerText);
  assert.match(await p.evaluate(() => $("#lx").textContent), /主題熱度[\s\S]*新聞語氣/);
  assert.match(txt, /央行按兵不動[\s\S]*可能影響[\s\S]*外銷訂單創高[\s\S]*美國總經[\s\S]*CPI 高於預期[\s\S]*世界總經[\s\S]*日本央行升息/);
  await p.click('#lx [data-mk="mnDay"][data-v="2026-10-16"]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelectorAll("#lx .mn-sum").length), 0);
  assert.ok(await noHOverflow(p));
  assert.equal(await p.evaluate(() => store.get("watch:mkReg")), "news");
  await ctx.close(); assert.deepEqual(errs, []);
});
