// 投資論點追蹤與持股催化日曆（learner/thesis.js）：存檔檢查、表單整理、檢視紀錄、近期事件（只列持股、期間內、過期檢視排前面、去重）、摘要。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../learner/thesis.js", import.meta.url), "utf8"), ctx);
const T = ctx.KLThesis, J = x => JSON.parse(JSON.stringify(x));

test("存檔檢查：正確的通過；格式、狀態、日期、長度不對的擋下", () => {
  const ok = { v: 1, items: { 2330: { reason: "AI 需求", watch: ["毛利率"], kill: ["毛利率跌破 50%"], status: "hold", review: "2026-12-01", log: [{ d: "2026-11-01", status: "hold", note: "法說會維持展望" }] } } };
  assert.equal(T.validateStore(ok).ok, true);
  assert.equal(T.validateStore({ v: 2, items: {} }).code, "unsupported_version");
  assert.equal(T.validateStore({ v: 1, items: [] }).code, "invalid_items");
  const bad = T.validateStore({ v: 1, items: { "壞 代號": {}, NVDA: { status: "爆了", review: "2026-13-40", watch: "不是陣列", log: [{ d: "x" }], reason: "x".repeat(2001) } } });
  assert.equal(bad.ok, false); const e = Object.fromEntries(bad.errors.map(x => [x.code, x.errors]));
  assert.deepEqual(J(e["壞 代號"]), ["invalid_code"]); assert.deepEqual(J(e.NVDA).sort(), ["invalid_log", "invalid_reason", "invalid_review", "invalid_status", "invalid_watch"]);
});

test("表單整理：多行拆成清單、去空行；狀態不對沿用原本的；檢視紀錄最新在前並更新狀態與下次檢視日", () => {
  const it = T.fromForm({ reason: "  先進製程  ", watch: "毛利率\n\n 海外廠進度 ", kill: "失去大客戶", status: "watch", review: "2026-12-01" }, {}, "t");
  assert.deepEqual(J(it), { reason: "先進製程", watch: ["毛利率", "海外廠進度"], kill: ["失去大客戶"], status: "watch", review: "2026-12-01", log: [], at: "t", stop: null, take: null });
  assert.equal(T.fromForm({ status: "亂填", review: "不是日期" }, { status: "weak" }).status, "weak"); assert.equal(T.fromForm({ review: "不是日期" }).review, null);
  const a = T.addLog(it, { d: "2026-11-08", status: "weak", note: "毛利率下滑" }, 90), b = T.addLog(a, { d: "2026-11-09", note: "再看一季" });
  assert.equal(a.status, "weak"); assert.equal(a.review, "2027-02-06", "11-08 往後 90 天"); assert.equal(b.log[0].d, "2026-11-09"); assert.equal(b.log.length, 2); assert.equal(b.status, "weak", "沒給狀態就不改");
  assert.equal(T.validateStore({ v: 1, items: { 2330: b } }).ok, true);
});

test("近期事件：只列持股、只列期間內；除權息、法說會、美股財報、論點檢視；過期檢視排最前面；重複的只留一筆", () => {
  const cal = { rows: [{ date: "2026-11-20", code: "2330", kind: "除息", cash: 5 }, { date: "2026-11-20", code: "2330", kind: "除息", cash: 5 }, { date: "2026-11-21", code: "9999", kind: "除息" }, { date: "2027-03-01", code: "2330", kind: "除息" }, { date: "2026-11-01", code: "2330", kind: "除息" }],
    conf: [{ date: "2026-11-15", code: "2454", time: "14:00", place: "台北" }] };
  const us = [["2026-11-19", "NVDA", "NVIDIA", 4000, null, 1.2, null, "盤後", "Q3"], ["2026-11-19", "AAPL", "Apple", 3000, null, 2, null, "盤後", "Q4"]];
  const store = { v: 1, items: { 2330: { reason: "x", review: "2026-11-01" }, NVDA: { reason: "y", review: "2026-12-01" }, AAPL: { reason: "z", review: "2026-11-10" } } };
  const E = T.catalysts({ codes: ["2330", "2454", "nvda"], cal, us, store, today: "2026-11-08", days: 60, name: c => "名" + c });
  assert.deepEqual(J(E.map(e => `${e.date} ${e.code} ${e.kind}${e.overdue ? " 過期" : ""}`)), ["2026-11-01 2330 review 過期", "2026-11-15 2454 conf", "2026-11-19 NVDA earn_us", "2026-11-20 2330 exdiv", "2026-12-01 NVDA review"]);
  assert.match(E[0].text, /已過 7 天/); assert.match(E[3].text, /現金 5 元/); assert.match(E[2].text, /Q3・盤後・預估 EPS 1.2/); assert.equal(E[1].name, "名2454"); assert.equal(E[1].label, "法說會");
  assert.deepEqual(J(T.catalysts({ codes: ["2330"], cal, today: "壞" })), [], "日期不對：不硬算");
  assert.deepEqual(J(T.catalysts({ codes: [], cal, us, store, today: "2026-11-08" })), [], "沒有持股：沒有事件");
});

test("摘要：寫了幾檔、該檢視幾檔、各狀態；沒寫的列出來", () => {
  const S = T.summary({ v: 1, items: { 2330: { reason: "x", status: "weak", review: "2026-11-01" }, 2454: { watch: ["a"] }, 2317: {} } }, ["2330", "2454", "2317", "NVDA"], "2026-11-08");
  assert.equal(S.total, 4); assert.equal(S.written, 2); assert.equal(S.due, 1); assert.equal(S.byStatus.weak, 1); assert.equal(S.byStatus.hold, 1); assert.deepEqual(J(S.missing), ["2317", "NVDA"]);
});

test("停損／停利：表單整理（百分比自動變號、空白不設、沒給欄位沿用原本的）、存檔檢查、價位與狀態", () => {
  assert.deepEqual(J(T.levelFrom("10", "pct", "stop")), { mode: "pct", v: -10 }, "停損打 10 當 −10%");
  assert.deepEqual(J(T.levelFrom("-20", "pct", "take")), { mode: "pct", v: 20 });
  assert.deepEqual(J(T.levelFrom(" 550 ", "price", "stop")), { mode: "price", v: 550 });
  for (const [v, m, k] of [["", "price", "stop"], ["abc", "price", "stop"], ["0", "pct", "stop"], ["-5", "price", "take"], ["100", "pct", "stop"], ["1001", "pct", "take"]]) assert.equal(T.levelFrom(v, m, k), null, `${v} ${m} ${k}`);
  const prev = { reason: "x", stop: { mode: "price", v: 500 } };
  assert.deepEqual(J(T.fromForm({ reason: "x" }, prev).stop), { mode: "price", v: 500 }, "表單沒有這個欄位：沿用");
  assert.equal(T.fromForm({ reason: "x", stop: "" }, prev).stop, null, "清空：不設");
  assert.deepEqual(J(T.fromForm({ stop: "8", stopMode: "pct", take: "700" }).take), { mode: "price", v: 700 });
  assert.equal(T.validateStore({ v: 1, items: { 2330: { stop: { mode: "pct", v: -8 }, take: { mode: "price", v: 700 } } } }).ok, true);
  const bad = T.validateStore({ v: 1, items: { 2330: { stop: { mode: "pct", v: 8 }, take: { mode: "x", v: 1 } } } });
  assert.deepEqual(J(bad.errors[0].errors).sort(), ["invalid_stop", "invalid_take"], "百分比停損要是負的；模式不對");
  const it = { stop: { mode: "pct", v: -10 }, take: { mode: "price", v: 700 } };
  const a = T.levels(it, { avgCost: 600, price: 620 });
  assert.equal(a.stopPrice, 540); assert.equal(a.takePrice, 700); assert.equal(a.state, "ok"); assert.equal(a.toStop, -0.129); assert.equal(a.toTake, 0.129);
  assert.equal(T.levels(it, { avgCost: 600, price: 540 }).state, "stop_hit", "等於停損價算跌破");
  assert.equal(T.levels(it, { avgCost: 600, price: 710 }).state, "take_hit");
  assert.equal(T.levels(it, { avgCost: 600, price: 560 }).state, "near_stop");
  assert.equal(T.levels(it, { avgCost: 600, price: 680 }).state, "near_take");
  assert.equal(T.levels(it, { avgCost: 600, price: null }).state, "no_price");
  assert.equal(T.levels({}, { avgCost: 600, price: 620 }).state, "none");
  assert.equal(T.levels({ stop: { mode: "pct", v: -10 } }, { avgCost: null, price: 620 }).state, "no_cost", "百分比但沒成本：不硬算");
  assert.ok(Object.keys(T.LEVEL_LABEL).length >= 8);
});

test("日期要真的存在：閏年 2/29 可以、2/30、4/31、平年 2/29、13 月都擋；備份匯入也擋", () => {
  for (const d of ["2028-02-29", "2026-01-31", "2026-04-30", "2026-12-31"]) assert.equal(T.isDate(d), true, d);
  for (const d of ["2026-02-29", "2026-02-30", "2026-02-31", "2026-04-31", "2026-06-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-1-1", "", null]) assert.equal(T.isDate(d), false, String(d));
  const bad = T.validateStore({ v: 1, items: { 2330: { review: "2026-02-31", log: [{ d: "2026-04-31", note: "x" }] } } });
  assert.deepEqual(J(bad.errors[0].errors).sort(), ["invalid_log", "invalid_review"]);
  assert.deepEqual(J(T.catalysts({ codes: ["2330"], store: { items: { 2330: { review: "2026-02-31" } } }, today: "2026-02-01" })), [], "不存在的檢視日不列");
});

test("停損／停利邊界：價格與百分比混用、一邊已觸及、沒有成本只算價格那邊、舊版論點（沒有停損停利欄位）照常可用", () => {
  const mix = { stop: { mode: "price", v: 90 }, take: { mode: "pct", v: 50 } };
  const a = T.levels(mix, { avgCost: 100, price: 120 }); assert.equal(a.stopPrice, 90); assert.equal(a.takePrice, 150); assert.equal(a.state, "ok");
  const b = T.levels(mix, { avgCost: 100, price: 85 }); assert.equal(b.state, "stop_hit"); assert.equal(b.takePrice, 150, "一邊觸及，另一邊價位照算");
  const c = T.levels({ stop: { mode: "pct", v: -10 }, take: { mode: "price", v: 700 } }, { avgCost: null, price: 680 });
  assert.equal(c.stopPrice, null); assert.equal(c.takePrice, 700); assert.equal(c.state, "near_take", "沒有成本：百分比那邊不算，價格那邊照算");
  const old = { reason: "舊的", watch: ["a"], status: "hold", review: "2026-12-01", log: [] };
  assert.equal(T.validateStore({ v: 1, items: { 2330: old } }).ok, true, "舊版資料（沒有 stop／take）照常通過");
  assert.equal(T.levels(old, { avgCost: 100, price: 100 }).state, "none");
  const f = T.fromForm({ reason: "改了" }, old); assert.equal(f.stop, null); assert.equal(f.take, null); assert.equal(f.reason, "改了");
});
