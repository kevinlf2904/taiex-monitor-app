// 排程程式的解析函式：用固定的範例資料確認欄位對應沒壞（node --test tests/unit.test.mjs）
import test from "node:test";
import assert from "node:assert/strict";
import { normRow } from "../scripts/insider.mjs";
import { mergeRows, compare, parseInfoTable } from "../scripts/sec13f.mjs";
import { parseTdcc } from "../scripts/tdcc.mjs";
import { lendRow } from "../scripts/chipx.mjs";
import { appendDay, shards } from "../scripts/market-scan.mjs";
import { evalDoc, evalFollow } from "../scripts/alerts-push.mjs";
import { alertDoc, docHas } from "../api/_lib/sync.js";
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
test("Telegram 追蹤推播：追蹤的議員、13F 機構新申報與庫存股內部人轉讓", () => {
  const doc = alertDoc({ "kline:watch:follow": JSON.stringify({ cong: { "h-x": "X" }, f13: { "001": "巴菲特" }, tw: {} }), "kline:watch:hold": JSON.stringify({ "2330": { sh: 1000 }, AAPL: { sh: 1 } }) }, "1");
  assert.deepEqual(doc.follow, { cong: ["h-x"], f13: ["001"], ins: ["2330"] }); assert.ok(docHas(doc)); assert.ok(!docHas(alertDoc({}, "1")), "沒有任何設定就不放進推播清單");
  const D = { cong: { people: { "h-x": { name: "Jane X" } }, trades: [{ pid: "h-x", ticker: "NVDA", k: "buy", filed: "2026-10-20" }, { pid: "h-x", ticker: "AAPL", k: "sell", filed: "2026-10-20" }, { pid: "h-x", ticker: "OLD", k: "buy", filed: "2026-09-01" }, { pid: "h-y", ticker: "MSFT", k: "buy", filed: "2026-10-20" }] },
    f13: { funds: [{ cik: "001", who: "巴菲特", period: "2026-09-30", filed: "2026-10-19", rows: [{ chg: "new" }, { chg: "add" }], sold: [{}] }] }, ins: { rows: [{ d: "2026-10-20", code: "2330", name: "台積電", who: "某董事", role: "董事本人", how: "贈與", sh: 5000 }, { d: "2026-10-20", code: "2317", name: "鴻海", who: "x", role: "x", how: "x", sh: 1 }] } };
  const out = evalFollow(doc, D, "2026-10-17");
  assert.equal(out.length, 3); assert.match(out[0].m, /Jane X 10-20 申報：買 NVDA、賣 AAPL/); assert.match(out[1].m, /新進 1、加碼 1、減碼 0、出清 1/); assert.match(out[2].m, /台積電 2330：某董事.*5 張/);
  assert.equal(new Set(out.map(x => x.k)).size, 3, "每一則有自己的去重鍵");
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

// 每一種技術線型策略都跑一次回測：訊號位置合法、不偷看未來、停損有效、加上手續費不會變好、報酬是有限數字
test("所有策略回測合理性", () => {
  const E = engine(), ids = Object.keys(E.STRAT_DEFS); let n = 0;
  assert.ok(ids.length > 20);
  for (const seed of [3, 99, 2026]) { const D = series(seed), I = E.indicators(D);
    for (const id of ids) { const S = E.stratRun(id, D, I) || [];
      for (const s of S) { assert.ok(Number.isInteger(s.i) && s.i >= 0 && s.i < D.length, `${id} 訊號位置 ${s.i}`); assert.ok(["buy", "sell"].includes(s.side), `${id} 方向 ${s.side}`); }
      // 不偷看未來：抽最多 4 個訊號，只給到那一天的資料也要出現
      for (const s of S.filter((_, k) => k % Math.max(1, Math.floor(S.length / 4)) === 0).slice(0, 4)) { const T = D.slice(0, s.i + 1); assert.ok((E.stratRun(id, T, E.indicators(T)) || []).some(x => x.i === s.i && x.side === s.side), `${id} ${seed} 第 ${s.i} 根偷看未來`); }
      const b0 = E.backtest(D, S, {}), b1 = E.backtest(D, S, { fee: 0.001425, minFee: 0, slip: 0.001 }), st = E.backtest(D, S, { stop: 0.05 }); n++;
      assert.ok(Number.isFinite(b0.total ?? 0) && Number.isFinite(b0.mdd ?? 0), `${id} 報酬不是數字`);
      if (b0.trades.length) { const M = E.Q.btMetrics(b0, D); assert.ok([M.cagr, M.vol, M.avg].every(Number.isFinite), `${id} 績效指標不是數字`); }
      if (b1.trades?.length) assert.ok(b1.total <= b0.total + 1e-9, `${id} 加成本後反而較好`);
      for (const t of st.trades || []) { const raw = t.xpx / t.raw - 1, gap = D[t.xi].o < t.raw * 0.95; if (!t.open && t.why !== "訊號" && !gap) assert.ok(raw >= -0.05 - 1e-9, `${id} 停損 5% 但虧 ${(raw * 100).toFixed(2)}%`); if (t.why === "停損") assert.ok(t.xi > t.i, `${id} 進場當根停損`); } } }
  assert.ok(n >= 60);
});

// 量化工具（learner/quant.js）：績效指標算對、行情與因子不偷看未來、ATR 設定合理、投資組合數學正確
test("量化：回測績效指標與改善試算", () => {
  const E = engine(), { btMetrics, btBreakdown, btVariants, btAdvice, btReportHtml } = E.Q;
  for (const seed of [5, 77, 2025]) { const D = series(seed, 500), I = E.indicators(D);
    for (const id of ["ma", "rsi", "macd", "hlb", "b2"]) { const S = E.stratRun(id, D, I), bt = E.backtest(D, S, {}); if (!bt.trades.length) continue;
      const M = btMetrics(bt, D), B = btBreakdown(bt, D);
      assert.ok(M.yrs > 1.2 && M.yrs < 1.5, `年數 ${M.yrs}`); assert.ok(Math.abs(M.ppy - 365) < 5, `每年根數 ${M.ppy}`); // 測試資料每天一根（含週末）
      assert.ok(Math.abs((1 + M.cagr) ** M.yrs - (1 + M.total)) < 1e-6, `${id} 年化換算`);
      assert.equal(M.n, bt.trades.length); assert.ok(M.win >= 0 && M.win <= 1);
      const gw = bt.trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0), gl = -bt.trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
      if (gl > 0) assert.ok(Math.abs(M.pf - gw / gl) < 1e-9); assert.ok(Number.isFinite(M.sharpe), `${id} 夏普`); assert.ok(M.exposure >= 0 && M.exposure <= 1);
      assert.ok(M.mdd >= 0 && M.mdd < 1 && M.uwBars >= 0 && M.lossStreak <= M.n);
      const nReg = Object.values(B.byReg).reduce((s, g) => s + g.n, 0); assert.ok(nReg <= M.n);
      const V = btVariants((s, o) => E.backtest(D, s, o), D, S, {}); assert.equal(V[0].key, "base"); assert.ok(Math.abs(V[0].m.total - M.total) < 1e-12, "原始設定要和回測一樣");
      const st = V.find(x => x.key === "stop"); assert.ok(st, "要有停損試算");
      const half = V.find(x => x.key === "half"); assert.ok(half.m.mdd <= M.mdd + 0.02, `${id} 半倉回撤反而大很多`);
      const A = btAdvice(V); A.risk.forEach(x => assert.ok(x.m.mdd < M.mdd)); A.ret.forEach(x => assert.ok(x.m.total > M.total));
      const h = btReportHtml(bt, M, B, V, { D }); assert.match(h, /夏普比率/); assert.doesNotMatch(h, /NaN|undefined/, `${id} 報告有 NaN`); } }
});
test("量化：行情、市場狀態、多因子都不偷看未來", () => {
  const E = engine(), { regimes, marketState, atrSetup, factorRaw, factorScore, factorBacktest, stateHtml } = E.Q, D = series(11, 420), R = regimes(D);
  for (const k of [80, 150, 260, 419]) { assert.equal(regimes(D.slice(0, k + 1))[k], R[k], `第 ${k} 根的行情偷看未來`);
    assert.deepEqual(factorRaw(D.slice(0, k + 1)), factorRaw(D, k), `第 ${k} 根的因子偷看未來`); }
  // 一路上漲 → 多頭；一路下跌 → 空頭
  const line = (n, g) => Array.from({ length: n }, (_, i) => { const c = 100 * (1 + g) ** i; return { d: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), o: c / (1 + g), h: c * 1.01, l: c / (1 + g) * 0.99, c, v: 1000 + i }; });
  assert.equal(marketState(line(200, 0.004)).trend, "bull"); assert.equal(marketState(line(200, -0.004)).trend, "bear");
  const S = marketState(D); assert.ok(S && ["bull", "bear", "range"].includes(S.trend)); assert.ok(S.volPct >= 0 && S.volPct <= 1);
  const X = atrSetup(S, 1e6, 0.01); assert.ok(X.stop < X.entry && X.tgt > X.entry && X.rr > 0); assert.ok(X.loss <= 1e6 * 0.01 + 1e-6 && X.amt <= 1e6 + 1e-6);
  assert.doesNotMatch(stateHtml(S, "日線", X, { sizeForm: "x" }), /NaN|undefined/);
  const Wk = E.agg(D, E.weekKey); assert.ok(Wk.length > 55 && Wk.length < 65); assert.equal(Wk.at(-1).c, D.at(-1).c);
  // 百分位：最大的值拿最高分，沒有資料給 50
  const rows = factorScore([{ c: "A", f: { mom: 0.3, lowvol: -0.01, trend: 0.1, value: 0.1 } }, { c: "B", f: { mom: -0.1, lowvol: -0.03, trend: -0.05, value: null } }, { c: "C", f: { mom: 0.1, lowvol: -0.02, trend: 0, value: 0.05 } }]);
  assert.equal(rows[0].c, "A"); assert.equal(rows.find(r => r.c === "B").s.value, 50);
  const B = factorBacktest([1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ c: "S" + k, D: series(k * 13, 300) })), undefined, { hold: 21, top: 3 });
  assert.ok(B.per.length >= 8); B.per.forEach(p => { assert.equal(p.codes.length, 3); assert.ok(p.d < p.to); });
});
test("量化：投資組合相關性、Beta、集中度、壓力測試", () => {
  const E = engine(), { portRisk, portPlan } = E.Q, A = series(3, 200), B = series(8, 200), A2 = A.map(x => ({ ...x, c: x.c * 2 }));
  const P = portRisk([{ c: "A", mv: 500, D: A }, { c: "A2", mv: 500, D: A2 }, { c: "B", mv: 1000, D: B }], A, 120);
  assert.equal(P.n, 120); const i = P.codes.indexOf("A"), j = P.codes.indexOf("A2"), k = P.codes.indexOf("B");
  assert.ok(Math.abs(P.C[i][j] - 1) < 1e-9, "同一條走勢相關係數要是 1"); assert.ok(Math.abs(P.rows.find(r => r.c === "A").beta - 1) < 1e-9, "和基準一樣的 Beta 要是 1");
  assert.ok(Math.abs(P.hhi - (0.25 ** 2 * 2 + 0.5 ** 2)) < 1e-12); assert.ok(Math.abs(P.rows.reduce((s, r) => s + r.ctr, 0) - 1) < 1e-9, "風險貢獻加起來要是 100%");
  assert.ok(Math.abs(P.stress - P.beta * -0.2) < 1e-12); assert.ok(P.C[i][k] < 0.9);
  const L = portPlan(P, "low"); assert.equal(L.trims.length, 3 - P.rows.filter(r => r.w <= 0.15).length); L.trims.forEach(t => assert.ok(t.cut > 0));
  assert.ok(portPlan(P, "high").trims.every(t => t.w > 0.4));
});
test("品牌合規：候補名單 email 檢查、產業資料沒有人工個股短評", async () => {
  const { waitlistEntry } = await import("../api/_lib/sync.js"), { readFileSync, readdirSync } = await import("node:fs");
  assert.equal(waitlistEntry(" Me@Example.COM ", "team").email, "me@example.com"); assert.equal(JSON.parse(waitlistEntry("a@b.co", "x").doc).plan, "beta");
  for (const bad of ["", "abc", "a@b", "a b@c.com", "x".repeat(120) + "@a.com"]) assert.equal(waitlistEntry(bad), null, bad);
  const L = f => readFileSync(new URL(`../learner/${f}`, import.meta.url), "utf8");
  for (const f of ["industry.js", "industry-pack.js", "industry-figs.js", ...readdirSync(new URL("../learner/indpacks/", import.meta.url)).map(x => "indpacks/" + x)])
    assert.doesNotMatch(L(f), /\["[0-9A-Z.^=\-]+", ?"[^"]*", ?"[^"]+"\]/, `${f} 還有個股短評`);
});
test("總經：FRED CSV、年增率、薩姆規則", async () => {
  const { parseCsv, transform, sahm } = await import("../api/_lib/macro.js");
  const R = parseCsv("observation_date,CPIAUCSL\n2024-01-01,300\n2024-02-01,.\n2024-03-01,\n" + Array.from({ length: 13 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01,${310 + i}`).join("\n"));
  assert.equal(R.length, 14); assert.deepEqual(R[0], ["2024-01-01", 300]);
  const Y = transform(R, "yoy"); assert.deepEqual(Y[0], ["2025-01-01", 3.33]); assert.equal(Y.at(-1)[0], "2026-01-01");
  assert.deepEqual(transform([["a", 1], ["b", 4]], "diff"), [["b", 3]]);
  const un = Array.from({ length: 16 }, (_, i) => [`2025-${i}`, i < 12 ? 4 : 5]); assert.ok(sahm(un).v >= 0.5);
});
test("Polymarket：分類、機率", async () => {
  const { normEvent } = await import("../api/_lib/poly.js");
  const e = normEvent({ id: 1, title: "Fed Decision in October?", slug: "fed-oct", volume: 4e7, volume24hr: 2e6, endDate: "2026-10-29T03:59:00Z", markets: [
    { question: "Will the Fed decrease rates by 25 bps?", groupItemTitle: "25 bps decrease", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.82\", \"0.18\"]", oneDayPriceChange: 0.03 },
    { question: "No change?", groupItemTitle: "No change", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.15\", \"0.85\"]", closed: false }] });
  assert.equal(e.cat, "聯準會與利率"); assert.equal(e.markets[0].yes, 0.82); assert.equal(e.markets[0].label, "25 bps decrease"); assert.equal(e.url, "https://polymarket.com/event/fed-oct");
  assert.equal(normEvent({ id: 2, title: "Lakers vs Celtics", markets: [{ outcomes: "[\"Yes\",\"No\"]", outcomePrices: "[\"0.5\",\"0.5\"]" }] }), null);
});

test("美股財報行事曆：Nasdaq 欄位解析（$、括號負數、N/A、市值門檻、驚喜% 只用 Nasdaq 的）", async () => {
  const { parseDay } = await import("../api/_lib/usearn.js");
  const R = parseDay("2026-10-20", [{ eps: "$1.66", surprise: "N/A", time: "time-pre-market", symbol: "GE", name: "GE Aerospace", marketCap: "$322,972,451,000", fiscalQuarterEnding: "Sep/2026", epsForecast: "$2.02" },
    { eps: "($0.25)", surprise: "-150", time: "time-after-hours", symbol: "RIVN", name: "Rivian", marketCap: "$15,000,000,000", epsForecast: "$0.10" },
    { symbol: "TINY", marketCap: "$1,000,000", eps: "$1" }, { lastYearEPS: "$1.99", symbol: "PG", name: "Procter & Gamble Company (The)", marketCap: "$366,539,833,000", epsForecast: "$1.89", time: "time-not-supplied" }]);
  assert.equal(R.length, 3, "市值 50 億美元以下不留");
  assert.deepEqual(R[0].slice(1, 8), ["GE", "GE Aerospace", 323, 1.66, 2.02, null, "盤前"], "Nasdaq 沒給驚喜% 時不自己換算（口徑可能不同）");
  assert.equal(R[1][4], -0.25); assert.equal(R[1][6], -150); assert.equal(R[1][7], "盤後");
  assert.deepEqual([R[2][2], R[2][4], R[2][9], R[2][7]], ["Procter & Gamble Company", null, 1.99, ""]);
});
test("財報總表：上市中文欄位、上櫃英文欄位合成一列（營收換成億、EPS、毛利率）", async () => {
  const { earnRows } = await import("../api/_lib/oapi.js");
  const E = earnRows({ revL: [{ 資料年月: "11509", 公司代號: "1101", 公司名稱: "台泥", 產業別: "水泥工業", "營業收入-當月營收": "14321556", "營業收入-上月比較增減(%)": "5.96", "營業收入-去年同月增減(%)": "7.62", "累計營業收入-當月累計營收": "113048525", "累計營業收入-前期比較增減(%)": "3.29" }],
    revO: [{ 資料年月: "11509", 公司代號: "1240", 公司名稱: "茂生農經", 產業別: "農業科技", "營業收入-當月營收": "282821", "營業收入-去年同月增減(%)": "13.0" }],
    epsL: [{ 年度: "115", 季別: "2", 公司代號: "1101", "基本每股盈餘(元)": "0.38", 營業收入: "71289957.00", 稅後淨利: "4569799.00" }], epsO: [{ Year: "115", 季別: "2", SecuritiesCompanyCode: "1240", 基本每股盈餘: "2.85", 營業收入: "1440672", 稅後淨利: "126506" }],
    pmL: [{ 公司代號: "1101", "毛利率(%)(營業毛利)/(營業收入)": "18.22", "營業利益率(%)(營業利益)/(營業收入)": "7.25", "稅後純益率(%)(稅後純益)/(營業收入)": "6.41" }], pmO: [{ SecuritiesCompanyCode: "1240", 毛利率: "15.21", 營業利益率: "6.07", 稅後純益率: "8.78" }] });
  assert.equal(E.ym, "11509"); assert.equal(E.yq, "115Q2");
  assert.deepEqual(E.rows[0], ["1101", "台泥", "水泥工業", "上市", 143.22, 6, 7.6, 3.3, 0.38, 712.9, 45.7, 18.2, 7.3, 6.4]);
  assert.deepEqual(E.rows[1].slice(0, 4), ["1240", "茂生農經", "農業科技", "上櫃"]); assert.equal(E.rows[1][8], 2.85); assert.equal(E.rows[1][11], 15.2);
});
test("證交所、櫃買開放資料：只連固定網域、代號欄位、個股篩選、資料集清單", async () => {
  const { default: h, codeKey, filterRows, STOCK_SETS } = await import("../api/_lib/oapi.js"), { readFileSync } = await import("node:fs");
  const call = async query => { let st, body; await h({ query }, { setHeader() {}, status(c) { st = c; return { json(j) { body = j; } }; } }); return { st, body }; };
  for (const p of ["//evil.com/x", "/../x", "/a?b=1", "/a/b/c/d", "x"]) assert.equal((await call({ src: "twse", p })).st, 400, `擋掉 ${p}`);
  assert.equal((await call({ src: "evil", p: "/opendata/t187ap45_L" })).st, 400);
  assert.equal((await call({ stock: "2330;rm" })).st, 400);
  assert.equal(codeKey({ 出表日期: "1", 公司代號: "2330" }), "公司代號"); assert.equal(codeKey({ Date: "1", SecuritiesCompanyCode: "6488" }), "SecuritiesCompanyCode"); assert.equal(codeKey({ Date: "1" }), null);
  assert.deepEqual(filterRows([{ Code: "2330" }, { Code: "23301" }, { Code: "2317" }], { code: "2330" }), [{ Code: "2330" }]);
  assert.equal(filterRows([{ Code: "2330", N: "台積電" }, { Code: "2317", N: "鴻海" }], { q: "鴻" }).length, 1);
  // 前端的資料集清單：路徑都通過後端的格式檢查、沒有重複；個股常用資料都在清單裡
  const cat = new Function(readFileSync("learner/oapi.js", "utf8").split("const OA_GROUPS")[0] + "; return OAPI_CAT;")();
  assert.ok(cat.length > 300); assert.equal(new Set(cat.map(x => x[0] + x[1])).size, cat.length);
  for (const x of cat) assert.match(x[1], /^\/[A-Za-z0-9_]+(\/[A-Za-z0-9_]+){0,2}$/);
  for (const [, , a, b] of STOCK_SETS) { if (a) assert.ok(cat.some(x => x[0] === "上市" && x[1] === a), a); if (b) assert.ok(cat.some(x => x[0] === "上櫃" && x[1] === b), b); }
});

import { pick, topicOf, merge, parseSum } from "../scripts/macro-news.mjs";
test("總經消息：分類、去重、只留一天內、同日合併、摘要解析", () => {
  assert.equal(topicOf("聯準會宣布降息一碼"), "利率"); assert.equal(topicOf("美國9月CPI年增2.9%"), "通膨"); assert.equal(topicOf("非農新增就業15萬"), "就業"); assert.equal(topicOf("新台幣升值2角"), "匯率");
  const now = Date.parse("2026-10-17T00:00:00Z"), a = (title, h) => ({ title, source: "s", link: "https://x/" + title, at: now - h * 3600e3 });
  const L = pick([[a("央行理監事會維持利率不變 市場關注", 1), a("某藝人結婚", 2), a("〈友達運動會〉集團朝類控股架構轉型", 2), a("加權指數盤後紀錄及早盤當沖選股", 2)], [a("央行理監事會維持利率不變 市場關注（更新）", 3), a("美債殖利率走高", 50)]], now);
  assert.deepEqual(L.map(x => x.topic), ["利率"]);
  const d = (date, t) => ({ date, at: now, tw: { sum: null, items: [{ title: t, at: now }] }, us: { sum: null, items: [] } });
  const m = merge(merge(null, { ...d("2026-10-17", "A"), tw: { sum: { head: "h", points: [] }, items: [{ title: "A", at: now }] } }), d("2026-10-17", "B"));
  assert.equal(m.days.length, 1); assert.deepEqual(m.days[0].tw.items.map(x => x.title).sort(), ["A", "B"]); assert.equal(m.days[0].tw.sum.head, "h");
  const s = parseSum('前言 {"tw":{"head":"台","points":["一","二"],"impact":"可能"},"us":{"head":"美","points":[]}} 結尾');
  assert.equal(s.tw.points.length, 2); assert.equal(s.us.head, "美"); assert.equal(parseSum("沒有 JSON"), null);
});

import { parseInfo, parseAll, parseMonth, splitName } from "../api/_lib/etf.js";
import { diff as etfDiff, update as etfUpdate } from "../scripts/etf-holdings.mjs";
test("ETF：MoneyDJ 基本資料、全部持股、月持股與產業、成分股變動", () => {
  const info = parseInfo(`<table> <tr> <th class="a">ETF名稱</th> <td>元大台灣50</td> <th>交易所代碼</th> <td>0050</td> </tr><tr> <th>發行公司</th> <td><a href="x">元大投信</a></td> </tr><tr> <th>成立日期</th> <td>2003/06/25（已成立<B>23</B>年）</td> <th>成分股數</th> <td>50</td> </tr><tr> <th>ETF規模</th> <td>2,485,259.00(百萬台幣)(2026/10/16)</td> </tr><tr> <th>經理費(%)</th> <td>0.15</td> <th>殖利率(%)</th> <td>1.47（10/16）</td> </tr><tr> <th>總管理費用(%)</th> <td>0.22 (含 0.07 非管理費用)</td> <th>配息頻率</th> <td>半年配</td> </tr><tr> <th>追蹤指數</th> <td>臺灣50指數</td> </tr></table>`);
  assert.deepEqual([info.name, info.issuer, info.since, info.n, info.aum, info.cur, info.fee, info.ter, info.yield, info.freq, info.index], ["元大台灣50", "元大投信", "2003-06-25", 50, 2485259e6, "台幣", 0.15, 0.22, 1.47, "半年配", "臺灣50指數"]);
  const all = parseAll(`<div> 元大台灣50(0050.TW)-全部持股 <div class="d">資料日期：2026/10/16</div> </div><table><thead><tr><th>個股名稱</th><th>投資比例(%)</th><th>持有股數 / 口數</th></tr></thead><tbody><tr> <td class="c"><a href="x">台積電(2330.TW)</a></td><td>56.66</td><td>579,691,139</td> </tr><tr> <td><a>NVIDIA Corp(NVDA.US)</a></td><td>7.5</td><td>1,000</td> </tr></tbody></table>`);
  assert.equal(all.date, "2026-10-16"); assert.deepEqual(all.rows.map(r => [r.name, r.code, r.pct, r.sh]), [["台積電", "2330", 56.66, 579691139], ["NVIDIA Corp", "NVDA", 7.5, 1000]]);
  const m = parseMonth(`<!-- 持股依產業表格 Start --> <div>資料日期：2026/10/09</div> <table><tr><th>顏色</th></tr><tr> <td><div style="x"></div></td><td>半導體</td><td>170,223,186.10</td><td>68.93</td> </tr></table> <!-- 持股依產業表格 End --> <div>元大台灣50-持股明細</div> <div>資料日期：2026/09/30</div> <table> <tr><th>股票名稱</th><th>持股(千股)</th><th>比例</th><th>增減</th></tr> <tr> <td>台積電</td> <td>562,112.00</td> <td>56.45</td> <td><span class="r">-0.90%</span></td> </tr> <tr> <td>國巨*</td> <td>36,051.00</td> <td>0.7</td> <td>0.00%</td> </tr></table>`);
  assert.deepEqual(m.month.rows.map(r => [r.name, r.sh, r.pct, r.chg]), [["台積電", 562112000, 56.45, -0.9], ["國巨", 36051000, 0.7, 0]]); assert.equal(m.month.date, "2026-09-30");
  assert.deepEqual(m.ind.rows, [{ name: "半導體", pct: 68.93 }]); assert.equal(m.ind.date, "2026-10-09");
  assert.deepEqual(splitName("某債券 2030"), { name: "某債券 2030", code: null });
  // 債券 ETF：名稱不是「名稱(代號)」、股數是 N/A；表格後面接著廣告程式碼，不能被吃進名稱
  const bond = parseAll(`全部持股 <div>資料日期：2026/10/15</div><table><tbody><tr><td>T 4.625 02/15/55</td><td>5.90</td><td>N/A</td></tr><tr><td>T 4.5 11/15/54</td><td>5.87</td><td>N/A</td></tr><tr><td colspan="3">合計</td></tr></tbody></table><script>window.googletag = window.googletag || {cmd: []};</script><table><tr><td>附註</td><td>1.00</td><td>2</td></tr></table>`);
  assert.deepEqual(bond.rows.map(r => [r.name, r.pct, r.sh]), [["T 4.625 02/15/55", 5.9, null], ["T 4.5 11/15/54", 5.87, null]]);
  const opt = parseAll(`全部持股<table><tr><td><a>臺指選擇權(TXO)</a></td><td>-2.84</td><td>1,600</td></tr></table>`); assert.equal(opt.rows[0].pct, -2.84);
  // 變動：同一天不重複比對；名單變了才記納入、剔除
  const d1 = { info: { name: "X" }, hold: { date: "2026-10-15", rows: [{ code: "2330", name: "台積電", pct: 50, sh: 1 }, { code: "1101", name: "台泥", pct: 1, sh: 1 }] } };
  const d2 = { info: { name: "X" }, hold: { date: "2026-10-16", rows: [{ code: "2330", name: "台積電", pct: 50, sh: 2 }, { code: "3017", name: "奇鋐", pct: 1, sh: 1 }] } };
  const now = new Date("2026-10-17T00:00:00Z"), a = etfUpdate(null, "0050", d1, now), b = etfUpdate(a, "0050", d2, now), c = etfUpdate(b, "0050", d2, now);
  assert.equal(a.ev.length, 0); assert.deepEqual(b.ev.map(e => [e.t, e.name]), [["in", "奇鋐"], ["out", "台泥"]]); assert.equal(b.prev.date, "2026-10-15"); assert.equal(c.ev.length, 2);
  assert.equal(etfDiff([["2330", "台積電", 50, 1]], [["2330", "台積電", 50, 9]], "d").length, 0);
});

import { impactOf } from "../api/_lib/macro.js";
import { pick as symPick } from "../api/_lib/symbol.js";
test("總經影響方向、代號搜尋結果過濾", () => {
  assert.equal(impactOf([["a", 1], ["b", 1], ["c", 1], ["d", 1.5]], "升", "降").impact, "升");
  assert.equal(impactOf([["a", 2], ["b", 2], ["c", 2], ["d", 1.5]], "升", "降").dir, -1);
  assert.equal(impactOf([["a", 2], ["b", 2], ["c", 2], ["d", 2.001]], "升", "降").dir, 0);
  assert.deepEqual(symPick([{ symbol: "SPCX", name: "Space Exploration Technologies Corp.", exch: "NMS", type: "S" }, { symbol: "XSPCX=F", exch: "CME", type: "F" }, { symbol: "4335.HK", exch: "HKG", type: "S" }, { symbol: "2330.TW", name: "台積電", type: "S" }]).map(x => x.code), ["SPCX", "2330"]);
});

test("節目觀點摘要：新版格式有數字、風險、觀察重點，段落可以更長", async () => {
  const { parseSum, PROMPT, SUM_VER } = await import("../api/_lib/podcast.js");
  assert.ok(SUM_VER >= 2); assert.match(PROMPT({ title: "t" }, "audio"), /facts[\s\S]*risks[\s\S]*watch/);
  const long = "很".repeat(400), j = parseSum(JSON.stringify({ tldr: "x", points: Array(10).fill("重點"), sections: Array(6).fill({ title: "小標", body: long }), facts: ["營收年增 30%"], risks: ["匯率"], watch: ["下週財報"], calls: [], topics: [] }));
  assert.equal(j.points.length, 10); assert.equal(j.sections.length, 6); assert.equal(j.sections[0].body.length, 400);
  assert.deepEqual([j.facts, j.risks, j.watch], [["營收年增 30%"], ["匯率"], ["下週財報"]]);
  assert.deepEqual(parseSum('{"tldr":"x"}').facts, [], "舊格式沒有新欄位也要能讀");
});

test("期交所 1 分 K：Field＋Ticks 陣列格式（日盤、跨午夜的夜盤）", async () => {
  const { parseTaifexChart } = await import("../api/_lib/futures.js");
  const day = parseTaifexChart({ RtData: { Field: ["T", "O", "H", "L", "C", "V"], Ticks: [["084600", "47228.00", "47278.00", "47168.00", "47186.00", "897"], ["134500", "47412.00", "47430.00", "47219.00", "47242.00", "3475"]] } }, "day", "2026-10-16");
  assert.equal(day.length, 2); assert.deepEqual([day[0].d, day[0].t, day[0].o, day[0].c, day[0].v], ["2026-10-16", "08:45", 47228, 47186, 897]); assert.equal(day[1].t, "13:44");
  const night = parseTaifexChart({ RtData: { Field: ["T", "O", "H", "L", "C", "V"], Ticks: [["150100", "47269", "47315", "47239", "47310", "221"], ["000100", "47000", "47010", "46990", "47005", "50"], ["050000", "46114", "46157", "46107", "46140", "77"]] } }, "night", "2026-10-16");
  assert.deepEqual(night.map(b => `${b.d} ${b.t}`), ["2026-10-16 15:00", "2026-10-17 00:00", "2026-10-17 04:59"]);
  assert.ok(night[0].at < night[1].at && night[1].at < night[2].at, "依時間排序");
});

test("期交所報價日期：夜盤 05:00 前算隔天，週末打開時近全取夜盤", async () => {
  const { taifexWhen, pickCurrent } = await import("../api/_lib/futures.js");
  const n = taifexWhen("20261016", "045957", "night"), d = taifexWhen("20261016", "134459", "day");
  assert.deepEqual([n.date, n.sdate], ["2026-10-17", "2026-10-16"]); assert.equal(taifexWhen("20261016", "230000", "night").date, "2026-10-16");
  assert.equal(pickCurrent({ ...d, session: "day" }, { ...n, session: "night" }, "closed").session, "night", "週五夜盤（週六清晨收）比週五日盤新");
});

test("台指期 1 分 K 存檔：依盤別分組（夜盤跨午夜算同一盤）", async () => {
  const { groupSessions } = await import("../scripts/fut-1m.mjs");
  const at = (d, t) => Date.parse(`${d}T${t}:00+08:00`), b = (d, t, s) => ({ at: at(d, t), d, t, o: 1, h: 2, l: 0, c: 1, v: 3, s });
  const S = groupSessions([b("2026-10-16", "08:45", "day"), b("2026-10-16", "13:44", "day"), b("2026-10-16", "15:00", "night"), b("2026-10-17", "04:59", "night")]);
  assert.deepEqual(S.map(x => [x.k, x.n, x.first, x.last]), [["2026-10-16-day", 2, "2026-10-16 08:45", "2026-10-16 13:44"], ["2026-10-16-night", 2, "2026-10-16 15:00", "2026-10-17 04:59"]]);
  assert.deepEqual(S[1].bars[1], ["04:59", 1, 2, 0, 1, 3, "2026-10-17"]);
});

test("台指期補歷史：期交所逐筆成交合成 1 分 K（量除以 2、價差單不算、收盤競價併進最後一根、取主力月份）", async () => {
  const { ticksToBars, groupSessions } = await import("../scripts/fut-1m.mjs");
  const csv = ["成交日期,商品代號,到期月份(週別),成交時間,成交價格,成交數量(B+S),近月價格,遠月價格,開盤集合競價 ",
    "20261015,TX     ,202610     ,150000,46926,118,-,-,*", "20261015,TX     ,202610     ,150030,46930,4,-,-, ", "20261015,TX     ,202611     ,150030,46990,2,-,-, ",
    "20261015,TX     ,202610/202611,150030,60,2,-,-, ", "20261016,TX     ,202610     ,045959,47341,4,-,-, ", "20261016,TX     ,202610     ,050000,47345,20,-,-, ",
    "20261016,TXO    ,202610     ,084500,1,20,-,-, ", "20261016,TX     ,202610     ,084500,47228,298,-,-,*", "20261016,TX     ,202610     ,084559,47200,2,-,-, ", "20261016,TX     ,202610     ,134500,47412,50,-,-, "].join("\r\n");
  const B = ticksToBars(csv);
  assert.deepEqual(B.map(b => [b.d, b.t, b.s, b.o, b.h, b.l, b.c, b.v]), [["2026-10-15", "15:00", "night", 46926, 46930, 46926, 46930, 61], ["2026-10-16", "04:59", "night", 47341, 47345, 47341, 47345, 12],
    ["2026-10-16", "08:45", "day", 47228, 47228, 47200, 47200, 150], ["2026-10-16", "13:44", "day", 47412, 47412, 47412, 47412, 25]]);
  assert.deepEqual(groupSessions(B).map(x => [x.k, x.mon]), [["2026-10-15-night", "202610"], ["2026-10-16-day", "202610"]]);
});

test("美股公司資料：Finnhub 指標、評等、EPS 與 SEC 季報解析（第四季用年度減前三季）", async () => {
  const { parseProfile, parseMetric, parseRec, parseEarn, parseConcept } = await import("../api/_lib/usinfo.js");
  assert.equal(parseProfile({ name: "Apple Inc", marketCapitalization: 3000000, shareOutstanding: 15000 }).cap, 3e12);
  assert.equal(parseProfile({}), null);
  assert.deepEqual(parseMetric({ metric: { peTTM: 30.123, peBasicExclExtraTTM: 99, grossMarginTTM: 46.2, beta: null } }), { pe: 30.12, gm: 46.2 });
  assert.equal(parseMetric({}), null);
  assert.deepEqual(parseRec([{ period: "2026-10-01", strongBuy: 10, buy: 20, hold: 5, sell: 1, strongSell: 0 }]), [{ period: "2026-10", sb: 10, b: 20, h: 5, s: 1, ss: 0 }]);
  assert.deepEqual(parseEarn([{ period: "2026-06-30", quarter: 2, year: 2026, actual: 1.5, estimate: 1.4, surprisePercent: 7.1428 }, { period: "2026-03-31", quarter: 1, year: 2026, actual: 1.6, estimate: 1.6 }]).map(x => [x.q, x.surp]), [[1, null], [2, 7.14]]);
  const C = parseConcept({ units: { USD: [{ frame: "CY2025Q1", val: 10, form: "10-Q" }, { frame: "CY2025Q2", val: 11, form: "10-Q" }, { frame: "CY2025Q3", val: 12, form: "10-Q" }, { frame: "CY2025", val: 50, form: "10-K" }, { val: 99, form: "10-Q" }] } });
  assert.deepEqual(C.q.map(x => [x.p, x.v]), [["2025Q1", 10], ["2025Q2", 11], ["2025Q3", 12], ["2025Q4", 17]]);
  assert.deepEqual(C.y.map(x => [x.p, x.v]), [["2025", 50]]);
});

test("AI 回答快取鍵：同一天同樣內容才相同、不含原文", async () => {
  const { cacheKey } = await import("../api/_lib/chat.js"), t = [{ role: "user", content: "台積電怎麼看" }];
  assert.equal(cacheKey("s", t, "2026-10-18"), cacheKey("s", t, "2026-10-18"));
  assert.notEqual(cacheKey("s", t, "2026-10-18"), cacheKey("s", t, "2026-10-19"));
  assert.notEqual(cacheKey("s", t, "2026-10-18"), cacheKey("s2", t, "2026-10-18"));
  assert.match(cacheKey("s", t), /^ai:[0-9a-f]{40}$/);
});

test("櫃買中心產業價值鏈：首頁產業清單、細分產業與上中下游、只收上市櫃公司", async () => {
  const { parseHome, parseIndustry } = await import("../scripts/tpex-ic.mjs");
  assert.deepEqual(parseHome(`<a href="introduce.php?ic=D000">半導體</a><a href="introduce.php?ic=A300"><span>◈ 電動車</span><br/>◈ LED 照明</a><a href="introduce.php?ic=D000">半導體</a>`), [{ id: "D000", name: "半導體" }, { id: "A300", name: "電動車／LED 照明" }]);
  const html = `<div class="chain-title-panel">上游</div><div id="ic_link_D100" class="company-chain-panel">IC<br/>設計</div><div class="chain-title-panel">中游</div><div id="ic_link_D300" class="company-chain-panel">IC/晶圓製造</div>
    <div id="companyList_D100" title="IC設計"><table><tr><td><b>本國上市公司(2家)</b></td><td><a href="company_basic.php?stk_code=2454" class="c" title="聯發科">聯發科</a></td><td><a href="company_basic.php?stk_code=3034" class="c" title="聯詠">聯詠</a></td></tr>
    <tr><td><b>本國興櫃公司(1家)</b></td><td><a href="company_basic.php?stk_code=7913" class="c" title="通寶半導體">通寶半導體</a></td></tr></table></div>
    <div id="companyList_D300" title="IC/晶圓製造"><b>本國上市公司(1家)</b><a href="company_basic.php?stk_code=2330" class="c" title="台積電">台積電</a><b>外國企業(1家)</b><a href="company_basic.php?stk_code=TSMC" title="x">x</a></div>`;
  assert.deepEqual(parseIndustry(html), [{ id: "D100", name: "IC設計", stage: "上游", codes: [["2454", "聯發科"], ["3034", "聯詠"]] }, { id: "D300", name: "IC/晶圓製造", stage: "中游", codes: [["2330", "台積電"]] }]);
});

test("FRED 官方介面、Finnhub：回應解析與金鑰不外洩", async () => {
  const { parseObs } = await import("../api/_lib/macro.js"), { quoteFromFinnhub, newsFromFinnhub, finnhubOk } = await import("../api/_lib/_finnhub.js");
  assert.deepEqual(parseObs({ observations: [{ date: "2026-10-14", value: "4.05" }, { date: "2026-10-15", value: "." }, { date: "bad", value: "1" }, { date: "2026-10-16", value: "4.1" }] }), [["2026-10-14", 4.05], ["2026-10-16", 4.1]]);
  assert.deepEqual(parseObs(null), []);
  const q = quoteFromFinnhub("AAPL", { c: 230.5, pc: 228, o: 229, h: 231, l: 228.5, t: 1760630400 });
  assert.deepEqual([q.code, q.price, q.prev, q.chg, q.chgPct, q.us, q.src], ["AAPL", 230.5, 228, 2.5, 1.1, true, "Finnhub"]);
  assert.equal(quoteFromFinnhub("ZZZ", { c: 0, pc: 0 }), null, "沒有成交（全 0）不當成報價");
  const N = newsFromFinnhub([{ headline: "A", source: "x", url: "https://a.com", datetime: 100 }, { headline: "A", source: "x", url: "https://b.com", datetime: 200 }, { headline: "B", url: "ftp://c", datetime: 300 }, { headline: "C", source: "y", url: "https://c.com", datetime: 300 }]);
  assert.deepEqual(N.map(x => x.title), ["C", "A"]); assert.equal(N[1].at, 100000);
  assert.ok(finnhubOk("BRK.B") && finnhubOk("NVDA") && !finnhubOk("^GSPC") && !finnhubOk("2330") && !finnhubOk("DX-Y.NYB"));
  const { envReport } = await import("../api/_lib/status.js"), R = envReport({ FRED_API_KEY: "abc", FINNHUB_API_KEY: " ", FUGLE_API_KEY: "k" });
  assert.deepEqual([R.set.FRED_API_KEY, R.set.FINNHUB_API_KEY, R.set.FUGLE_API_KEY], [true, false, true]); assert.ok(!JSON.stringify(R).includes("abc"), "狀態不回傳金鑰");
});

test("AI 協作規則：AGENTS.md 與 Antigravity 規則檔一致，CLAUDE.md 引用它", async () => {
  const { readFile } = await import("node:fs/promises"), rd = p => readFile(new URL(`../${p}`, import.meta.url), "utf8");
  const [a, g, c] = await Promise.all([rd("AGENTS.md"), rd(".agent/rules/klinelab.md"), rd("CLAUDE.md")]);
  assert.equal(g, a, "改了 AGENTS.md 要複製到 .agent/rules/klinelab.md");
  assert.match(c, /^@AGENTS\.md/m);
  for (const k of ["learner/version.json", "gemini/", "claude/", "密鑰", "draft PR", "鎖：", ".agent/workflows/merge.md"]) assert.ok(a.includes(k), `AGENTS.md 缺少「${k}」`);
  const m = await rd(".agent/workflows/merge.md");
  assert.match(m, /^---\r?\ndescription: /, "Antigravity workflow 要有 description");
  for (const k of ["gemini/", "node tests/run.mjs", "merge", "version.json"]) assert.ok(m.includes(k), `merge.md 缺少「${k}」`);
});

test("櫃買圖表排程：指數累積、觀測站月營收解析、產業彙總與創新高、董監質押、權證標的", async () => {
  const T = await import("../scripts/tpex-daily.mjs"), os = await import("node:os"), fs = await import("node:fs/promises"), dir = await fs.mkdtemp(os.tmpdir() + "/tpex-");
  const html = ym => `<th class=tt align=left >產業別：半導體業</th><tr align=right><td align=center>3105</td><td align=left>穩懋</td><td nowrap> ${ym === "2026-09" ? "2,000,000" : "1,000,000"}</td><td nowrap> 1,000,000</td><td nowrap> 900,000</td><td nowrap> 5.00</td><Td nowrap> 11.1</td><td nowrap>1</td></tr>`
    + `<th class=tt align=left >產業別：其他業</th>` + Array.from({ length: 120 }, (_, i) => `<tr align=right><td align=center>${6000 + i}</td><td align=left>公司${i}</td><td nowrap> 100</td><td nowrap> 100</td><td nowrap> 100</td><td nowrap> 0</td><Td nowrap> 0</td></tr>`).join("");
  const R = T.parseMops(html("2026-09"));
  assert.equal(R.length, 121); assert.deepEqual([R[0].c, R[0].ind, R[0].cur, R[0].ly, R[0].mom, R[0].yoy], ["3105", "半導體業", 2e6, 9e5, 5, 11.1]);
  const api = { "/tpex_reward_index": [{ Date: "1151020", TPExIndex: "388", TPExTotalReturnIndex: "720" }, { Date: "1151021", TPExIndex: "395.42", TPExTotalReturnIndex: "735.46" }],
    "/tpex200_change": [{ "資料日期": "1151021", "指數": "富櫃200報酬指數", "收盤指數": "23,025.43" }, { "資料日期": "1151021", "指數": "富櫃200指數", "收盤指數": "18,191.37" }],
    "/tpex_daily_trading_index": [{ Date: "1151021", TradeVolume: "898956732", TradeAmount: "213821883572", NumberOfTransactions: "910619", TPExIndex: "395.42" }],
    "/tpex_warrant_statistics": [{ Date: "1151021", Category: "上櫃權證交易人數", Statistics: "5553" }],
    "/mopsfin_t187ap09_O": [{ Date: "1150819", Percent: "90 以上", CompanyName: "4502      健信  99.80\r\n7723      築間  91.20\r\n" }, { Date: "1150819", Percent: "20 以下", CompanyName: "8431      匯鑽科  19.74\r\n" }],
    "/tpex_warrant_daily_quts": [{ Date: "1151021", Name: "信驊群益5B購01", TradeValue: "300000", UnderlyingStockCode: "5274", UnderlyingStock: "信驊", UnderlyingStockClosePrice: "16515", "UnderlyingStock PriceChange": "615.00" }, { Date: "1151021", Name: "信驊元大5B售01", TradeValue: "100000", UnderlyingStockCode: "5274", UnderlyingStock: "信驊" }, { Date: "1151021", Name: "擎亞購", TradeValue: "0", UnderlyingStockCode: "8096" }] };
  const get = async p => { if (p === "/tpex_gold_latest") throw new Error("逾時"); return api[p] || []; };
  const getMops = async ([y, m]) => T.parseMops(html(`${y}-${String(m).padStart(2, "0")}`));
  const o = await T.main({ get, getMops, now: Date.parse("2026-10-21T10:00:00Z"), gap: 0, out: dir + "/t.json", rev: dir + "/r.json" });
  const C = o.ix.cols, L = o.ix.rows.at(-1);
  assert.deepEqual([L[0], L[C.indexOf("otc")], L[C.indexOf("otcR")], L[C.indexOf("t200")], L[C.indexOf("t200R")]], ["2026-10-21", 395.42, 735.46, 18191.37, 23025.43]);
  assert.deepEqual(o.vol.at(-1), ["2026-10-21", 8.99, 2138.22, 91.1, 395.42]);
  assert.deepEqual(o.wt.rows.at(-1), ["2026-10-21", 5553]);
  assert.equal(o.revm.length, 36); assert.equal(o.revm.at(-1).ym, "2026-09");
  assert.deepEqual(o.revm.at(-1).hi.map(r => r[0]), ["3105"], "9 月營收 200 億高於過去 24 個月"); assert.equal(o.revm.at(-1).hi[0][5], 24);
  assert.equal(o.revm[0].hi.length, 0, "最早的月份沒有 12 個月可以比");
  assert.deepEqual(o.revm.at(-1).ind["半導體業"], [20, 122.2, 100, 1]);
  assert.deepEqual(o.snap.pledge.buckets, [["90 以上", 2], ["20 以下", 1]]); assert.deepEqual(o.snap.pledge.top[0], ["4502", "健信", 99.8]);
  assert.deepEqual(o.snap.wtu.rows, [["5274", "信驊", 30, 10, 2, 16515, 615]]);
  assert.equal(o.snap.gold, undefined, "黃金抓不到不影響其他");
  // 第二天：舊的日子保留、同一天以新的為準
  api["/tpex_reward_index"] = [{ Date: "1151022", TPExIndex: "400", TPExTotalReturnIndex: "744" }];
  const o2 = await T.main({ get, getMops, now: Date.parse("2026-10-22T10:00:00Z"), gap: 0, out: dir + "/t.json", rev: dir + "/r.json" });
  assert.deepEqual(o2.ix.rows.map(r => r[0]), ["2026-10-20", "2026-10-21", "2026-10-22"]); assert.equal(o2.ix.rows[1][C.indexOf("t200")], 18191.37);
  await fs.rm(dir, { recursive: true });
});
