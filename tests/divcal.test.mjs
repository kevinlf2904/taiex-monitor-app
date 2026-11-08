// 股利現金流行事曆（learner/divcal.js）：已公告用公告金額、過去 12 個月往後推一年、同一次不重複算、二代健保、只算台股、沒資料列出來。期望值手算，固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/divcal.js", import.meta.url), "utf8"), ctx);
const D = ctx.KLDivCal, J = x => JSON.parse(JSON.stringify(x));

test("已公告用公告金額；過去 12 個月往後推一年；同一次（45 天內）不重複；超過 12 個月前的不算", () => {
  const P = D.plan({ today: "2026-11-08", positions: [{ symbol: "2330", market: "tw", shares: 2000 }, { symbol: "0056", market: "tw", shares: 10000 }],
    hist: { 2330: [["2025-09-11", 4], ["2025-12-11", 5], ["2026-03-12", 5], ["2026-06-11", 5], ["2026-09-10", 5]], "0056": [["2026-01-16", 1], ["2026-04-17", 1], ["2026-07-16", 0.8], ["2026-10-16", 0.8]] },
    upcoming: [{ date: "2026-12-10", code: "2330", cash: 6 }, { date: "2026-11-20", code: "9999", cash: 9 }] });
  assert.deepEqual(J(P.events.map(e => [e.date, e.code, e.kind, e.perShare, e.amount])), [
    ["2026-12-10", "2330", "announced", 6, 12000],   // 公告：取代去年 12/11 那次
    ["2027-01-16", "0056", "est", 1, 10000],
    ["2027-03-12", "2330", "est", 5, 10000],
    ["2027-04-17", "0056", "est", 1, 10000],
    ["2027-06-11", "2330", "est", 5, 10000],
    ["2027-07-16", "0056", "est", 0.8, 8000],
    ["2027-09-10", "2330", "est", 5, 10000],
    ["2027-10-16", "0056", "est", 0.8, 8000]]);
  assert.equal(P.total, 78000); assert.equal(P.announced, 12000); assert.equal(P.est, 66000);
  assert.equal(P.months.length, 12); assert.equal(P.months[0].month, "2026-11"); assert.equal(P.months[11].month, "2027-10");
  assert.equal(P.months[1].total, 12000); assert.equal(P.months[1].est, false); assert.equal(P.months[2].est, true); assert.equal(P.months[0].total, 0);
  assert.equal(P.peak.month, "2026-12");
});

test("二代健保：單次 ≥ 2 萬才扣 2.11%；美股不算；沒有配息資料的列出來；日期不對不硬算", () => {
  const P = D.plan({ today: "2026-11-08", positions: [{ symbol: "2330", market: "tw", shares: 5000 }, { symbol: "NVDA", market: "us", shares: 10 }, { symbol: "6669", market: "tw", shares: 100 }, { symbol: "2317", market: "tw", shares: 0 }],
    hist: { 2330: [["2026-03-12", 5], ["2026-06-11", 3.9]], 6669: [] } });
  assert.deepEqual(J(P.events.map(e => [e.amount, e.nhi])), [[25000, 528], [19500, 0]], "25,000 × 2.11% ＝ 527.5 → 528；19,500 不到 2 萬");
  assert.equal(P.nhi, 528); assert.deepEqual(J(P.skipped), ["NVDA"]); assert.deepEqual(J(P.noData), ["6669"], "沒有配息紀錄；股數 0 的不算");
  assert.equal(D.plan({ today: "2026-02-30" }).status, "invalid");
  assert.equal(D.plan({ today: "2026-11-08", positions: [] }).status, "empty");
});

test("閏年 2/29 往後推變 2/28；跨年的月份", () => {
  assert.equal(D.nextYear("2024-02-29"), "2025-02-28"); assert.equal(D.nextYear("2026-03-12"), "2027-03-12");
  assert.equal(D.addMonths("2026-11-08", 2), "2027-01"); assert.equal(D.addMonths("2026-01-31", 11), "2026-12");
});
