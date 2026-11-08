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
  assert.deepEqual(J(it), { reason: "先進製程", watch: ["毛利率", "海外廠進度"], kill: ["失去大客戶"], status: "watch", review: "2026-12-01", log: [], at: "t" });
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
