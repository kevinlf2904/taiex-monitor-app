// 排程程式的解析函式：用固定的範例資料確認欄位對應沒壞（node --test tests/unit.test.mjs）
import test from "node:test";
import assert from "node:assert/strict";
import { normRow } from "../scripts/insider.mjs";
import { mergeRows, compare, parseInfoTable } from "../scripts/sec13f.mjs";
import { parseTdcc } from "../scripts/tdcc.mjs";
import { lendRow } from "../scripts/chipx.mjs";
import { appendDay, shards } from "../scripts/market-scan.mjs";
import { evalDoc } from "../scripts/alerts-push.mjs";
import { engine } from "../scripts/_engine.mjs";

test("內部人：上市中文欄位、上櫃英文欄位", () => {
  const a = normRow({ 出表日期: "1151013", 公司代號: "2884", 公司名稱: "玉山金", 申報人身分: "董事本人", 姓名: "王", "預定轉讓方式及股數-轉讓方式": "贈與", "目前持有股數-自有持股": "1105869", "目前持有股數-保留運用決定權信託股數": "0", "預定轉讓總股數-自有持股": "50000", "預定轉讓總股數-保留運用決定權信託股數": "0", 有效轉讓期間: "1151013~1151015" }, "上市");
  assert.equal(a.d, "2026-10-13"); assert.equal(a.sh, 50000); assert.equal(a.until, "2026-10-15");
  const b = normRow({ Date: "1151013", SecuritiesCompanyCode: "3260", CompanyName: "威剛", 申請人身分: "經理人本人", 姓名: "張", "預定轉讓方式及股數-轉讓方式": "信託", "預定轉讓總股數-自有持股": "24000" }, "上櫃");
  assert.equal(b.code, "3260"); assert.equal(b.name, "威剛"); assert.equal(b.sh, 24000);
});
test("13F：千美元單位換算、排除債券、兩季比較", () => {
  const r = mergeRows([{ name: "A", cusip: "1", value: 864923, sh: 3186306, type: "SH", pc: "" }, { name: "B", cusip: "2", value: 281613, sh: 589680, type: "SH", pc: "" }, { name: "Bond", cusip: "3", value: 1, sh: 9, type: "PRN", pc: "" }]);
  assert.equal(r.length, 2); assert.equal(r[0].value, 864923000);
  const c = compare(r, [{ cusip: "1", pc: "", sh: 4e6 }, { cusip: "9", pc: "", sh: 1, name: "X" }]);
  assert.equal(c.rows[0].chg, "cut"); assert.equal(c.rows[1].chg, "new"); assert.equal(c.sold[0].chg, "sold");
  assert.equal(parseInfoTable("<ns1:infoTable><ns1:nameOfIssuer>X</ns1:nameOfIssuer><ns1:cusip>1</ns1:cusip><ns1:value>5</ns1:value><ns1:sshPrnamt>2</ns1:sshPrnamt></ns1:infoTable>")[0].sh, 2);
});
test("集保：千張、400 張、50 張以下", () => {
  let csv = "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%\n";
  for (let L = 1; L <= 17; L++) csv += `20261009,2330,${L},${L === 17 ? 9000 : 10},1,${L === 17 ? 100 : L === 16 ? 0 : L === 15 ? 60 : 2.5}\n`;
  csv += "20261009,000218,15,1,1,100\n";
  const { date, rows } = parseTdcc(csv); assert.equal(date, "2026-10-09"); assert.deepEqual(rows.get("2330").slice(1, 5), [60, 67.5, 20, 9000]); assert.equal(rows.has("000218"), false);
});
test("借券：上櫃英文欄位（股 → 張）", () => {
  assert.deepEqual(lendRow({ SecuritiesCompanyCode: "6488", SecuritiesBorrowingSale: "76000", SecuritiesBorrowingBalanceOfTheMarketDay: "216000" }), ["6488", 76, 216]);
});
test("全市場：接上當天、分片共同日期軸", () => {
  const H = { s: {} };
  appendDay(H, [{ code: "2330", name: "台積電", market: "上市", date: "2026-10-13", price: 1000, vol: 3 }, { code: "6488", name: "環球晶", market: "上櫃", date: "2026-10-13", price: 400, vol: 1 }]);
  appendDay(H, [{ code: "2330", name: "台積電", market: "上市", date: "2026-10-14", price: 1010, vol: 2 }]);
  const S = shards(H); assert.deepEqual(S[2].d, ["2026-10-13", "2026-10-14"]); assert.deepEqual(S[2].k["2330"][3], [1000, 1010]); assert.deepEqual(S[6].k["6488"][3], [400, null]);
});
test("Node 沙盒載入網站的指標與提醒條件", () => {
  const E = engine(), D = Array.from({ length: 120 }, (_, i) => { const c = 100 + Math.sin(i / 6) * 8; return { d: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 }; });
  assert.ok(E.COND.length > 20); assert.ok(E.indicators(D).kd.K.length === 120);
  const out = evalDoc({ names: { "2330": "台積電" }, rules: [{ code: "2330", cond: "rsigt", p: 1 }], price: [{ code: "2330", up: 50 }] }, c => (c === "2330" ? D : null), E);
  assert.equal(out.length, 2); assert.match(out[0], /台積電 2330：RSI/);
});
import { parseDecls, parseList } from "../scripts/tw-officials.mjs";
test("廉政專刊：列表表格、申報表股票段（括號備註、外幣、名稱含數字）", () => {
  const L = parseList(`<tr><td><span>廉政專刊第321期</span></td><td><span>115-09-22</span></td><td><a href="https://www-ws.cy.gov.tw/Download.ashx?u=A&amp;n=B">x</a></td></tr>`);
  assert.deepEqual([L[0].no, L[0].date, L[0].pdf], [321, "2026-09-22", "https://www-ws.cy.gov.tw/Download.ashx?u=A&n=B"]);
  const D = parseDecls(["公 | 職 | 人 | 員 | 財 | 產 | 申 | 報 | 表", "1. | 立法院 | 1. | 立法委員", "申報人姓名 | 許忠信 | 服 | 務", "115 | 年 | 06 | 月 | 29 | 日 | 就 | ( | 到 | ) | 職申報",
    "1. | 股票（總價額：新臺幣 | 1 | 元）", "名 | 稱 | 所 | 有 | 人 | 股 | 數", "東 和 鋼 鐵 | ( | 未 能 交 付 信 託 原", "施嘉玲 | 67 | 10 | 670", "因：零股遺失 | )", "元大美債 | 20 | 年 | 饒月琴 | 6,000 | 10 | 60,000",
    "Megan Holdings Ltd ( | 未能", "交付信託原因 | 紀淑娟 | 2,300 | 0.1799 | 美元 | 13,129", "市、上櫃股票 | )", "廣達 | 饒月琴 | 3,000 | 10 | 30,000", "2. | 債券（總價額：新臺幣 | 元）"]);
  assert.equal(D[0].date, "2026-06-29"); assert.equal(D[0].org, "立法院");
  assert.deepEqual(D[0].stocks.map(s => [s.name, s.owner, s.sh]), [["東和鋼鐵", "施嘉玲", 67], ["元大美債20年", "饒月琴", 6000], ["MeganHoldingsLtd", "紀淑娟", 2300], ["廣達", "饒月琴", 3000]]);
});

// 價格行為策略（過高破低、123、2B）：每個訊號在「只給到那一天」的資料上也要出現（沒有偷看未來），規則本身也要成立
const series = (seed, n = 400) => { let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); let p = 100; const out = [];
  for (let i = 0; i < n; i++) { const o = p * (1 + (r() - 0.5) * 0.02), c = o * (1 + (r() - 0.5) * 0.05 + 0.0004), h = Math.max(o, c) * (1 + r() * 0.02), l = Math.min(o, c) * (1 - r() * 0.02); out.push({ d: new Date(Date.UTC(2023, 0, 2) + i * 864e5).toISOString().slice(0, 10), o, h, l, c, v: 1000 }); p = c; } return out; };
test("價格行為策略：不偷看未來、符合定義", () => {
  const E = engine(); let n = 0;
  for (const seed of [1, 42, 777, 2024]) { const D = series(seed);
    for (const id of ["hlb", "r123", "b2"]) for (const s of E.stratRun(id, D, E.indicators(D))) { n++;
      const T = D.slice(0, s.i + 1); assert.ok(E.stratRun(id, T, E.indicators(T)).some(x => x.i === s.i && x.side === s.side), `${id} ${seed} 第 ${s.i} 根偷看未來`);
      if (id === "r123") { const [p1, p2, p3] = s.shapes[0].pts, c = D[s.i].c; assert.ok(s.side === "sell" ? p3[1] < p1[1] && c < p2[1] : p3[1] > p1[1] && c > p2[1]); }
      if (id === "hlb") { const hb = s.shapes[1].pts[0][0]; assert.ok(s.side === "sell" ? D[s.i].c < D[hb].l : D[s.i].c > D[hb].h); } } }
  assert.ok(n > 100);
});
