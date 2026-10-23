// K線學堂：型態課與錯題本下面列出「今天收盤出現這個型態」的真實個股（排程 data/pattern-today.json）；點一檔就用它的真實 K 線當範例圖
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const PT = { date: "2026-10-23", n: 1500, hits: { hammer: [["2330", "台積電", 1450, 1.2], ["2317", "鴻海", 210, -0.5]], bullEngulf: [["2454", "聯發科", 1300, 3.4]], dBottom: [["3008", "大立光", 2500, 2.1]] } };

for (const width of [390, 1280]) test(`今日符合型態的個股 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "index.html", { width, touch: width < 500 });
  await ctx.route("**/data/pattern-today.json**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(PT) }));
  await p.evaluate(() => { switchTab("learn"); showLesson(lessonIndex("patterns-rev")); });
  await p.waitForSelector("#lessonToday .ptchip");
  const t = await p.textContent("#lessonToday");
  assert.match(t, /今天收盤出現這些型態的個股[\s\S]*10\/23 收盤[\s\S]*錘子線[\s\S]*台積電[\s\S]*鴻海[\s\S]*多頭吞噬[\s\S]*聯發科/);
  assert.doesNotMatch(t, /大立光/, "別的課的型態不列");
  // 選一個型態卡片：只列那個型態；沒有個股也說明
  await p.click('#lessonGallery [data-pat="shooting"]'); assert.match(await p.textContent("#lessonToday"), /今天沒有個股出現「流星線」/);
  await p.click('#lessonGallery [data-pat="hammer"]');
  await p.click('#lessonToday [data-ptcode="2317"]');
  assert.deepEqual(await p.evaluate(() => [lessonSrc, lessonCode, lessonView.pat]), ["real", "2317", "hammer"], "範例圖換成鴻海的真實 K 線，選好錘子線");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  // 錯題本：題目講到錘子線，測驗結果頁列出今天出現錘子線的個股
  await p.evaluate(() => { const i = QUESTIONS.findIndex(q => /錘子線/.test(q.q + q.e)); store.set("wrongQ", { [i]: { n: 1, at: "2026-10-23", box: 1, due: "2099-01-01" } }); switchTab("quiz"); quiz = { order: [0], k: 1, score: 1 }; quizRender(); });
  await p.waitForSelector("#quiz .ptoday .ptchip");
  assert.match(await p.textContent("#quiz .ptoday"), /錯題講到的型態[\s\S]*錘子線[\s\S]*台積電/);
  await p.click('#quiz .ptoday [data-ptcode="2330"]');
  assert.deepEqual(await p.evaluate(() => [CUR_TAB, LESSONS[lessonIdx].id, lessonCode]), ["learn", "patterns-rev", "2330"], "點了回到那一課");
  await ctx.close(); assert.deepEqual(errs.filter(e => !/mock|載入失敗|500/.test(e)), []);
});
