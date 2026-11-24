// K 線學堂「匯入 CSV」（learner/index.html 的 parseKlineCsv）：沒有成交量欄、或某一列量是空的，量要標成來源沒給（vNa），
// 不能當成真的 0 量，否則均量、OBV、VR、MFI、EMV 都會被拉低（稽核 AUD-19 追查時發現，同 #262 FIN-04）。
// 從 index.html 取出這兩個純函式放進沙盒執行，不開瀏覽器、不連網。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../learner/index.html", import.meta.url), "utf8");
const fn = name => { const m = html.match(new RegExp(`^function ${name}\\(.*?(?=^function |^async function |^const |^let |^//)`, "ms")); assert.ok(m, `index.html 找不到 ${name}`); return m[0]; };
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn("splitCsv") + fn("parseKlineCsv"), ctx);
const parse = t => JSON.parse(JSON.stringify(vm.runInContext("parseKlineCsv", ctx)(t)));

test("CSV 有成交股數欄：換算成張，不標 vNa", () => {
  const r = parse("日期,開盤價,最高價,最低價,收盤價,成交股數\n115/11/02,100,105,99,104,\"2,345,000\"\n115/11/03,104,106,103,105,1000000");
  assert.deepEqual(r.rows, [{ d: "2026-11-02", o: 100, h: 105, l: 99, c: 104, v: 2345 }, { d: "2026-11-03", o: 104, h: 106, l: 103, c: 105, v: 1000 }]);
});

test("CSV 沒有成交量欄：每一列都是 v 0＋vNa（不是真的 0 量）", () => {
  const r = parse("Date,Open,High,Low,Close\n2026-11-02,100,105,99,104\n2026-11-03,104,106,103,105");
  assert.deepEqual(r.rows.map(x => [x.v, x.vNa]), [[0, 1], [0, 1]]);
});

test("CSV 有量欄但某一列是空的：只有那一列標 vNa；真的 0 量照樣是 0、不標 vNa", () => {
  const r = parse("Date,Open,High,Low,Close,Volume\n2026-11-02,100,105,99,104,\n2026-11-03,104,106,103,105,0\n2026-11-04,105,107,104,106,5000");
  assert.deepEqual(r.rows.map(x => [x.v, x.vNa ?? null]), [[0, 1], [0, null], [5, null]], "Volume 是股數，換算成張");
});

test("缺開高低收的列照樣略過", () => {
  const r = parse("Date,Open,High,Low,Close,Volume\n2026-11-02,--,--,--,--,0\n2026-11-03,104,106,103,105,1000");
  assert.equal(r.rows.length, 1);
});
