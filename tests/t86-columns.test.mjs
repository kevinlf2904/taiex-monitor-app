// T86（三大法人買賣超）欄位解析（#262 FIN-03、#264 C1）：真實表頭有 19 欄，「外資自營商買賣超股數」和「自營商買賣超股數」只差幾個字；
// 用「包含」比對會把自營商欄誤配到外資自營商。這裡用 19 欄表頭驗證，並確認缺值是 null、不是 0，hot.js 與 daily.js 兩邊解析一致。
import test from "node:test";
import assert from "node:assert/strict";
import { parseT86 } from "../api/_lib/hot.js";
import { parseInst } from "../api/_lib/daily.js";
import { buildLists } from "../api/_lib/screen.js";

const FIELDS = ["證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)", "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數",
  "投信買進股數", "投信賣出股數", "投信買賣超股數", "自營商買賣超股數", "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)", "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數"];
// 每個買賣超欄位放不同的數字，錯配就會被看出來：外資 5,000、外資自營商 7,000、投信 2,000、自營商 3,000（自行 1,000＋避險 2,000）
const row = (code, name, v) => [code, name, "9,000", "4,000", v.f, "1,000", "0", v.fd, "3,000", "1,000", v.t, v.d, "2,000", "1,000", "1,000", "4,000", "2,000", "2,000", v.a];
const T86 = { stat: "OK", fields: FIELDS, data: [
  row("2330", "台積電", { f: "5,000,000", fd: "7,000,000", t: "2,000,000", d: "3,000,000", a: "17,000,000" }),
  row("0050", "元大台灣50", { f: "-1,500,000", fd: "0", t: "0", d: "-500,000", a: "-2,000,000" }),
  row("2317", "鴻海", { f: "--", fd: "100,000", t: "--", d: "--", a: "100,000" }),
  row("00679B", "元大美債20年", { f: "1,000", fd: "0", t: "0", d: "0", a: "1,000" }),
  row("9999X", "不是股票", { f: "1", fd: "1", t: "1", d: "1", a: "4" })] };

test("19 欄真實表頭：自營商取「自營商買賣超股數」，不會誤配到「外資自營商買賣超股數」", () => {
  const r = Object.fromEntries(parseT86(T86).map(x => [x.code, x]));
  assert.deepEqual([r["2330"].foreign, r["2330"].trust, r["2330"].dealer, r["2330"].total], [5000, 2000, 3000, 17000], "外資 5,000 張（不是外資自營商 7,000）、自營商 3,000 張");
  assert.deepEqual([r["0050"].foreign, r["0050"].trust, r["0050"].dealer], [-1500, 0, -500]);
  assert.ok(r["00679B"], "債券 ETF 代號也收"); assert.equal(r["9999X"], undefined, "不是股票或 ETF 的代號略過");
});

test("缺值（\"--\"、空白、欄位不存在）是 null，不是 0", () => {
  const r = Object.fromEntries(parseT86(T86).map(x => [x.code, x]));
  assert.deepEqual([r["2317"].foreign, r["2317"].trust, r["2317"].dealer], [null, null, null], "來源寫 -- 的不能當成 0 張");
  assert.equal(r["2317"].total, 100, "有值的欄位照常");
  assert.equal(r["0050"].trust, 0, "真的是 0 的照舊是 0");
  const old = parseT86({ stat: "OK", fields: ["證券代號", "證券名稱", "投信買賣超股數"], data: [["2330", "台積電", "2,000"]] })[0];
  assert.deepEqual([old.trust, old.foreign, old.dealer, old.total], [2, null, null, null], "舊格式沒有的欄位是 null，不是 0");
});

test("表頭認不得（沒有證券代號）→ null，不用錯的欄位硬算；非 OK 也是 null", () => {
  assert.equal(parseT86({ stat: "OK", fields: ["a", "b"], data: [["1", "2"]] }), null);
  assert.equal(parseT86({ stat: "很抱歉，沒有符合條件的資料!" }), null); assert.equal(parseT86(null), null);
});

test("hot.js 與 daily.js 兩邊解析一致（外資、投信、自營商）", () => {
  const A = new Map(parseT86(T86).map(x => [x.code, [x.foreign, x.trust, x.dealer]])), B = parseInst(T86);
  for (const code of ["2330", "0050", "2317"]) assert.deepEqual(A.get(code), B.get(code), code);
});

test("選股「籌碼多」：外資或投信缺值的不列入，也不會因為 null 出錯", () => {
  const quotes = [{ code: "2330", name: "台積電", price: 1000, chgPct: 1, vol: 5000 }, { code: "2317", name: "鴻海", price: 100, chgPct: 2, vol: 9000 }, { code: "0050", name: "元大台灣50", price: 150, chgPct: 1, vol: 7000 }];
  const lists = buildLists({ quotes, t86: [parseT86(T86)] }), chips = lists.find(l => l.id === "chips");
  assert.deepEqual(chips.rows.map(r => r.code), ["2330"], "2317 外資、投信都沒資料；0050 外資賣超");
  assert.match(chips.rows[0].note, /外資 5,000・投信 2,000 張/);
});
