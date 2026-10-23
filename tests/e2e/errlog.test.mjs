// 錯誤紀錄：資料服務失敗會記在這個瀏覽器，「資料來源狀態」裡列出（同一種合併次數），可以清除
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

for (const width of [390, 1280]) test(`錯誤紀錄：資料服務失敗列在資料來源狀態 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  await ctx.route(/\/api\/warn/, r => r.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
  await ctx.route(/\/api\/status/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ set: { FUGLE_API_KEY: true, GEMINI_API_KEY: true }, similar: [], vercelEnv: "test" }) }));
  await p.evaluate(async () => { store.set("watch:errs", []); for (let i = 0; i < 2; i++) await getJ("/api/warn?x=" + i, true).catch(() => {}); });
  assert.deepEqual(await p.evaluate(() => store.get("watch:errs").map(x => [x[1], x[2]])), [["/api/warn", "服務回應 500"], ["/api/warn", "服務回應 500"]], "網址的參數不記");
  await p.evaluate(() => showStatus()); await p.waitForSelector(".errlog");
  assert.match(await p.textContent(".errlog"), /\/api\/warn\s*服務回應 500（2 次）/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "沒有橫向溢出");
  await p.click("[data-errclr]"); assert.deepEqual(await p.evaluate(() => store.get("watch:errs")), []);
  assert.match(await p.textContent("#sheetExtra"), /已清除/);
  await ctx.close(); assert.deepEqual(errs.filter(e => !/500/.test(e)), []);
});
