// 存股模擬：股息計算機（含息再投入、含息領出、不含息）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

test("股息計算機", async () => {
  const { ctx, p, errs } = await open(B, S.url, "savings.html", { width: 390 });
  const r = await p.evaluate(() => { const o = { init: 1e6, mon: 0, yrs: 1, y: 0.05, g: 0, freq: 1, nhi: true }, L = { ...o, yrs: 20, g: 0.03, mon: 10000, freq: 4, nhi: false };
    return { div: dcSim(o, "re").divSum, irr: dcSim(o, "re").irr, px: dcSim(L, "px").irr, re: dcSim(L, "re").irr, out: dcSim(L, "out").irr }; });
  assert.equal(Math.round(r.div), 48945); assert.ok(Math.abs(r.irr - 0.048945) < 1e-6);
  assert.ok(Math.abs(r.px - 0.03) < 1e-4); assert.ok(r.re > 0.079 && r.re < 0.083 && Math.abs(r.re - r.out) < 2e-3);
  await p.fill("#dc-y", "6"); await p.click('[data-dm="px"]'); assert.match(await p.evaluate(() => document.getElementById("dc-kpis").innerText), /不含息[\s\S]*3\.00%/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close(); assert.deepEqual(errs, []);
});
