// 排程程式的解析函式：用固定的範例資料確認欄位對應沒壞（node --test tests/unit.test.mjs）
import test from "node:test";
import assert from "node:assert/strict";
import { normRow, parseMopsDay } from "../scripts/insider.mjs";
import { mergeRows, compare, parseInfoTable } from "../scripts/sec13f.mjs";
import { parseTdcc, rankOf, addRow, needFix } from "../scripts/tdcc.mjs";
import { parseWeek, weekRow, tokenOf, datesOf, tdccWeeks } from "../api/_lib/tdcc.js";
import { tdccHolders, tdccDist } from "../api/_lib/company.js";
import { lendRow } from "../scripts/chipx.mjs";
import { appendDay, shards } from "../scripts/market-scan.mjs";
import { evalDoc, evalFollow } from "../scripts/alerts-push.mjs";
import { alertDoc, docHas } from "../api/_lib/sync.js";
import { engine } from "../scripts/_engine.mjs";
import { buildDays, futByDate, evalMethods, score } from "../scripts/levels-bt.mjs";

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
test("缺成交量（vNa）：API 標記、均量跳過、週 K 整根標記、判讀不寫量縮", async () => {
  const K = await import("../api/_lib/kline.js");
  const sd = K.parseTwseStockDay({ stat: "OK", fields: ["日期", "成交股數", "開盤價", "最高價", "最低價", "收盤價"], data: [["115/10/05", "1,000,000", "10", "11", "9", "10"], ["115/10/06", "--", "10", "11", "9", "10"]], title: "115年10月 2330 台積電" });
  assert.deepEqual(sd.rows.map(r => [r.v, !!r.vNa]), [[1000, false], [0, true]], "證交所成交股數是 -- 時標 vNa");
  const y = K.parseYahoo({ chart: { result: [{ meta: { gmtoffset: 28800 }, timestamp: [1790000000, 1790086400], indicators: { quote: [{ open: [1, 1], high: [2, 2], low: [0.5, 0.5], close: [1.5, 1.5], volume: [5000, null] }] } }] } });
  assert.deepEqual(y.rows.map(r => !!r.vNa), [false, true], "Yahoo volume 是 null 時標 vNa");
  const amt = K.parseFmtqik({ stat: "OK", fields: ["日期", "成交金額"], data: [["115/10/05", "300,000,000,000"]] });
  const ix = [{ d: "2026-10-05", v: 0, vNa: 1 }, { d: "2026-10-06", v: 0, vNa: 1 }]; ix.forEach(r => K.fillVol(r, amt));
  assert.deepEqual(ix.map(r => [r.v, !!r.vNa]), [[3000, false], [0, true]], "加權指數：FMTQIK 還沒有的日子（例如今天收盤後）標 vNa，不是 0");
  const E = engine(), D = series(7, 80);
  assert.deepEqual(JSON.stringify(E.smaVol(D, 20)), JSON.stringify(E.indicators(D).vma), "全部有量時 vma 和原本 sma 一樣");
  const plain = E.indicators(D).vma, M = D.map((x, i) => (i === 79 ? { ...x, v: 0, vNa: 1 } : x)), vm = E.indicators(M).vma;
  assert.equal(vm[78], plain[78], "缺量之前的均量不變");
  const ok = M.slice(60, 79).map(x => x.v); assert.ok(Math.abs(vm[79] - ok.reduce((s, v) => s + v, 0) / ok.length) < 1e-9, "最後一根沒有量：均量只用其他 19 天");
  assert.ok(vm[79] > plain[79] * 0.9, `均量沒有被缺量拉低（${vm[79]} vs ${plain[79]}）`);
  const half = D.map((x, i) => ((i >= 60 && i % 2) || i === 78 ? { ...x, v: 0, vNa: 1 } : x)); assert.equal(E.indicators(half).vma[79], null, "視窗內有量的不到一半就不算均量");
  const W = E.agg(M, E.weekKey); assert.ok(W.at(-1).vNa, "那週有一天沒有量，週 K 整根標 vNa"); assert.ok(!W[0].vNa);
  const ta = E.trendAnalysis(M, E.indicators(M)); assert.ok(!ta.some(x => x.k === "量能"), "最後一根沒有量：不寫「0.0 倍（量縮）」");
  assert.ok(E.trendAnalysis(D, E.indicators(D)).some(x => x.k === "量能"), "有量時照常寫量能");
});
test("總經排程：只有幾個數列抓不到時沿用上一次的（標 stale），不讓它們消失", async () => {
  const { keepMissing } = await import("../scripts/macro.mjs");
  const old = { series: [{ id: "CPIAUCSL", last: ["2026-09-01", 3] }, { id: "UNRATE", last: ["2026-09-01", 4.4] }] };
  const v = { ok: true, series: [{ id: "CPIAUCSL", last: ["2026-10-01", 2.9] }], notes: ["失業率：HTTP 500"] };
  const out = keepMissing(v, old);
  assert.deepEqual(out.series.map(x => [x.id, x.last[0], !!x.stale]), [["CPIAUCSL", "2026-10-01", false], ["UNRATE", "2026-09-01", true]]);
  assert.deepEqual(out.kept, ["UNRATE"]);
  assert.equal(keepMissing(v, null), v, "沒有舊檔：照原樣");
});
test("盤後外資持股基準：這次 MI_QFIIS 沒抓到時沿用上一次，不把空的寫成今天的基準", async () => {
  const { frState } = await import("../scripts/market-after.mjs");
  const old = { fr: { 2330: 72.1 }, frDate: "2026-10-29", frPrev: { 2330: 72.0 } };
  const ok = frState(old, new Map([["2330", 72.5]]), "2026-10-30");
  assert.deepEqual(ok, { prevFr: { 2330: 72.1 }, fr: { 2330: 72.5 }, frDate: "2026-10-30", frPrev: { 2330: 72.1 } }, "正常：今天的當新基準，增減和上一個交易日比");
  const bad = frState(old, new Map(), "2026-10-30");
  assert.deepEqual(bad.prevFr, { 2330: 72.1 }, "這次沒抓到：增減照樣和上一個交易日比");
  assert.deepEqual([bad.fr, bad.frDate, bad.frPrev], [old.fr, old.frDate, old.frPrev], "存的基準維持上一次，不寫空的");
  assert.deepEqual(frState(ok, new Map([["2330", 72.6]]), "2026-10-30").prevFr, { 2330: 72.1 }, "同一天第二次跑（21:30）：還是和上一個交易日比");
});
test("漲跌家數排程：只拿到上市（上櫃還沒出來）時不算完整，不存成上櫃 0 漲 0 跌", async () => {
  const { full, countDay } = await import("../scripts/market-breadth.mjs");
  const tw = new Map([["2330", { market: "上市", pct: 1 }], ["2317", { market: "上市", pct: -1 }]]);
  assert.equal(full(countDay(tw)), false, "只有上市：不完整");
  tw.set("6488", { market: "上櫃", pct: 2 });
  assert.equal(full(countDay(tw)), true, "上市、上櫃都有：完整");
});
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
  for (const [, , A, B] of STOCK_SETS) { for (const a of [A].flat()) if (a) assert.ok(cat.some(x => x[0] === "上市" && x[1] === a), a); for (const b of [B].flat()) if (b) assert.ok(cat.some(x => x[0] === "上櫃" && x[1] === b), b); } // 財報一個鍵有六種產業格式
});

import { pick, topicOf, merge, parseSum } from "../scripts/macro-news.mjs";
test("總經消息：分類、去重、只留一天內、同日合併、摘要解析", () => {
  assert.equal(topicOf("聯準會宣布降息一碼"), "利率"); assert.equal(topicOf("美國9月CPI年增2.9%"), "通膨"); assert.equal(topicOf("非農新增就業15萬"), "就業"); assert.equal(topicOf("新台幣升值2角"), "匯率"); assert.equal(topicOf("美股重挫 那斯達克跌3% 科技股遭拋售"), "盤勢"); assert.equal(topicOf("美股大跌原因一次看"), "盤勢"); assert.equal(topicOf("加權指數盤後紀錄及早盤當沖選股"), "市場");
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
  // 這次的持股比上次少一半以上（來源只回一部分）：不比對、回 null，不記一堆假的「剔除」
  const many = { info: { name: "X" }, hold: { date: "2026-10-15", rows: Array.from({ length: 20 }, (_, i) => ({ code: String(1000 + i), name: "股" + i, pct: 5, sh: 1 })) } };
  const few = { info: { name: "X" }, hold: { date: "2026-10-16", rows: many.hold.rows.slice(0, 5) } };
  const big = etfUpdate(null, "0050", many, now); assert.equal(etfUpdate(big, "0050", few, now), null);
  assert.equal(etfUpdate(a, "0050", { ...d2, hold: { ...d2.hold, rows: d2.hold.rows.slice(0, 1) } }, now).rows.length, 1, "上次不到 10 檔：照常比對（小型 ETF 正常變動）");
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
  const { parseSum, PROMPT, SUM_VER, timeoutWithinDeadline } = await import("../api/_lib/podcast.js");
  assert.ok(SUM_VER >= 2); assert.match(PROMPT({ title: "t" }, "audio"), /facts[\s\S]*risks[\s\S]*watch/);
  const long = "很".repeat(400), j = parseSum(JSON.stringify({ tldr: "x", points: Array(10).fill("重點"), sections: Array(6).fill({ title: "小標", body: long }), facts: ["營收年增 30%"], risks: ["匯率"], watch: ["下週財報"], calls: [], topics: [] }));
  assert.equal(j.points.length, 10); assert.equal(j.sections.length, 6); assert.equal(j.sections[0].body.length, 400);
  assert.deepEqual([j.facts, j.risks, j.watch], [["營收年增 30%"], ["匯率"], ["下週財報"]]);
  assert.deepEqual(parseSum('{"tldr":"x"}').facts, [], "舊格式沒有新欄位也要能讀");
  assert.equal(timeoutWithinDeadline(60000, 30000, 16000, 0), 30000, "下載不超過請求上限");
  assert.equal(timeoutWithinDeadline(50000, 30000, 16000, 10000), 24000, "下載為後續上傳預留時間");
  assert.equal(timeoutWithinDeadline(50000, 40000, 1000, 10000), 39000, "最後階段服從整體截止時間");
  assert.equal(timeoutWithinDeadline(10000, 40000, 1000, 10000), 0, "截止時間已到時不再啟動新請求");
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
  for (const k of ["learner/version.json", "gemini/", "claude/", "codex/", "稽核", "驗證：", "pull_request_template.md", "密鑰", "draft PR", "鎖：", ".agent/workflows/merge.md", "scripts/bump-version.mjs", "不連外部網站", "learner/core.js", "每次收到指令都要自動做"]) assert.ok(a.includes(k), `AGENTS.md 缺少「${k}」`);
  assert.match(await rd(".github/copilot-instructions.md"), /AGENTS\.md/, "Copilot 的說明要指向 AGENTS.md");
  const m = await rd(".agent/workflows/merge.md");
  assert.match(m, /^---\r?\ndescription: /, "Antigravity workflow 要有 description");
  for (const k of ["gemini/", "node tests/run.mjs", "merge", "version.json"]) assert.ok(m.includes(k), `merge.md 缺少「${k}」`);
  const pt = await rd(".github/pull_request_template.md");
  for (const k of ["誰做的", "改了什麼", "還沒做完", "測試"]) assert.ok(pt.includes(k), `PR 範本缺少「${k}」`);
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

test("上市圖表排程：OpenAPI 當月、網站月報表補歷史、類股指數補日、董監質押、暫停預告、上市權證", async () => {
  const T = await import("../scripts/twse-daily.mjs"), P = await import("../scripts/tpex-daily.mjs"), os = await import("node:os"), fs = await import("node:fs/promises"), dir = await fs.mkdtemp(os.tmpdir() + "/twse-");
  const html = `<th class=tt align=left >產業別：半導體業</th><tr align=right><td align=center>2330</td><td align=left>台積電</td><td nowrap> 300,000,000</td><td nowrap> 250,000,000</td><td nowrap> 200,000,000</td><td nowrap> 20.00</td><td nowrap> 50.00</td></tr>`
    + Array.from({ length: 120 }, (_, i) => `<tr align=right><td align=center>${1100 + i}</td><td align=left>公司${i}</td><td nowrap> 100</td><td nowrap> 100</td><td nowrap> 100</td><td nowrap> 0</td><td nowrap> 0</td></tr>`).join("");
  const api = { "/indicesReport/MI_5MINS_HIST": [{ Date: "1151020", ClosingIndex: "48,000.5" }, { Date: "1151021", ClosingIndex: "48353.49" }], "/indicesReport/MFI94U": [{ Date: "1151021", TAIEXTotalReturnIndex: "111811.08" }],
    "/indicesReport/TAI50I": [{ Date: "1151021", Taiwan50Index: "45041.66", Taiwan50TotalReturnIndex: "104203.60" }], "/indicesReport/FRMSA": [{ Date: "1151021", FormosaIndex: "53622.96", FormosaTotalReturnIndex: "83423.23" }],
    "/exchangeReport/MI_INDEX": [{ "日期": "1151021", "指數": "臺灣高股息指數", "收盤指數": "9,876.5" }, { "日期": "1151021", "指數": "半導體類指數", "收盤指數": "1,234.5" }, { "日期": "1151021", "指數": "半導體類報酬指數", "收盤指數": "2,000" }, { "日期": "1151021", "指數": "臺灣50指數", "收盤指數": "45041.66" }],
    "/exchangeReport/FMTQIK": [{ Date: "1151021", TradeVolume: "10691867330", TradeValue: "874046252416", Transaction: "4715278", TAIEX: "48353.49", Change: "413.36" }],
    "/opendata/t187ap09_L": [{ "出表日期": "1150819", "百分比": "90 以上", "公司名稱": "3040      遠見  " }, { "出表日期": "1150819", "百分比": "20 以下", "公司名稱": "1101 台泥 1102 亞泥" }],
    "/opendata/t187ap08_L": [{ "出表日期": "1150819", "公司代號": "1225", "公司名稱": "福懋油", "全體董事應持有股數": "12000000", "全體董事本人實際持有股數": "6130138", "全體董事不足股數": "5869862" }],
    "/exchangeReport/TWTBAU1": [{ Code: "00406A", Name: "主動中信台灣收益", StartDate: "1151029", EndDate: "1151104", Reason: "分配收益" }], "/exchangeReport/BFI84U": [{ Code: "2330", Name: "台積電", StartDate: "1151028", EndDate: "1151102", Reason: "股東會" }],
    "/opendata/t187ap42_L": [{ "交易日期": "1151020", "權證名稱": "台積電統一5C購05", "成交金額": "500000" }, { "交易日期": "1151020", "權證名稱": "台積電元大5C售01", "成交金額": "200000" }, { "交易日期": "1151020", "權證名稱": "台泥群益5C購01", "成交金額": "100000" }, { "交易日期": "1151020", "權證名稱": "不存在統一購", "成交金額": "9" }],
    "/exchangeReport/MI_MARGN": [{ "股票代號": "2330", "股票名稱": "台積電" }, { "股票代號": "1101", "股票名稱": "台泥" }] };
  const calls = [], get = async p => api[p] || [];
  const getRwd = async p => { calls.push(p); const m = p.match(/date=(\d{4})(\d{2})/);
    if (p.startsWith("afterTrading/FMTQIK") && m[2] === "09") return { stat: "OK", fields: ["日期", "成交股數", "成交金額", "成交筆數", "發行量加權股價指數", "漲跌點數"], data: [["115/09/30", "9,000,000,000", "700,000,000,000", "4,000,000", "47,000.00", "10"]] };
    if (p.startsWith("TAIEX/MI_5MINS_HIST") && m[2] === "09") return { stat: "OK", fields: ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"], data: [["115/09/30", "1", "2", "3", "47,000.00"]] };
    if (p.startsWith("FTSE/TAI50I") && m[2] === "09") return { stat: "OK", fields: ["日期", "臺灣50指數", "臺灣50報酬指數"], data: [["115/09/30", "44,000", "100,000"]] };
    if (p.startsWith("afterTrading/MI_INDEX")) return { stat: "OK", tables: [{ title: "價格指數", fields: ["指數", "收盤指數"], data: [["半導體類指數", "1,200.0"], ["臺灣高股息指數", "9,800"], ["寶島股價指數", "52,000"], ["機電類指數", "1"]] }, { title: "報酬指數", fields: ["報酬指數", "收盤指數"], data: [["寶島股價報酬指數", "80,000"], ["半導體類報酬指數", "2"]] }] };
    return { stat: "很抱歉，沒有符合條件的資料!" }; };
  const o = await T.main({ get, getRwd, getMops: async () => P.parseMops(html), now: Date.parse("2026-10-21T10:00:00Z"), gap: 0, out: dir + "/t.json", rev: dir + "/r.json" });
  const C = o.ix.cols, row = d => o.ix.rows.find(r => r[0] === d), at = (d, k) => row(d)?.[C.indexOf(k)];
  assert.deepEqual(["tx", "txR", "t50", "t50R", "frm", "frmR", "hd"].map(k => at("2026-10-21", k)), [48353.49, 111811.08, 45041.66, 104203.6, 53622.96, 83423.23, 9876.5]);
  assert.deepEqual(["tx", "t50", "t50R", "hd", "frm", "frmR"].map(k => at("2026-09-30", k)), [47000, 44000, 100000, 9800, 52000, 80000], "網站月報表、每日行情補的歷史");
  assert.deepEqual(o.vol.map(r => r[0]), ["2026-09-30", "2026-10-21"]); assert.deepEqual(o.vol.at(-1), ["2026-10-21", 106.92, 8740.46, 471.5, 48353.49]); assert.deepEqual(o.vol[0].slice(1, 3), [90, 7000]);
  assert.deepEqual(o.sec.cols, ["半導體類指數"], "類股只收價格指數"); assert.deepEqual(o.sec.rows, [["2026-09-30", 1200], ["2026-10-21", 1234.5]]);
  assert.ok(!calls.some(p => p.includes("MI_INDEX") && p.includes("20261021")), "今天的類股用 OpenAPI，不再抓網站");
  assert.deepEqual(o.snap.pledge.buckets, [["90 以上", 1], ["20 以下", 2]]); assert.deepEqual(o.snap.pledge.top[0], ["3040", "遠見", null, "90 以上"]);
  assert.deepEqual(o.snap.short.rows[0].slice(0, 5), ["1225", "福懋油", 12000, 6130, 5870]);
  assert.deepEqual(o.snap.sus[0], ["00406A", "主動中信台灣收益", "2026-10-29", "2026-11-04", "分配收益"]); assert.equal(o.snap.sss[0][0], "2330");
  assert.deepEqual(o.snap.wtu.rows.map(r => r.slice(0, 5)), [["2330", "台積電", 50, 20, 2], ["1101", "台泥", 10, 0, 1]], "上市權證用名稱對標的");
  assert.equal(o.revm.at(-1).ym, "2026-09"); assert.deepEqual(o.revm.at(-1).ind["半導體業"].slice(0, 2), [3000.12, 50]);
  // 第二天：已經有的月份不再抓網站
  calls.length = 0; const o2 = await T.main({ get, getRwd, getMops: async () => P.parseMops(html), now: Date.parse("2026-10-22T10:00:00Z"), gap: 0, out: dir + "/t.json", rev: dir + "/r.json" });
  assert.equal(o2.vol.length, 2); assert.ok(calls.filter(p => p.includes("FMTQIK")).length <= 36);
  await fs.rm(dir, { recursive: true });
});

test("財報進階排程：月營收連續年增與創新高、營益分析換算單季三率、美股營收與歷史累積", async () => {
  const T = await import("../scripts/earn-hist.mjs"), U = await import("../scripts/us-earn.mjs");
  const H = {}; for (let i = 0; i < 30; i++) { const y = 2024 + Math.floor(i / 12), m = i % 12 + 1; H[`${y}-${String(m).padStart(2, "0")}`] = 100 + i * 10; } // 一路成長
  const R = T.revStreak({ "2330": ["台積電", "半導體業", H], "1101": ["台泥", "水泥工業", { "2026-06": 50, "2025-06": 60 }] }, "上市", "2026-06");
  assert.deepEqual(R.map(r => r.slice(0, 5)), [["2330", "台積電", "半導體業", "上市", 18]], "連續年增 18 個月（只有 30 個月資料），台泥年減不列");
  assert.equal(R[0][7], 29, "比過去 29 個月都高"); assert.equal(R[0][5], +(((390 / 270) - 1) * 100).toFixed(1));
  const row = (c, rev, gm, om, nm) => `<tr class='even'><td>${c}</td><td>公司${c}</td><td align='right'>${rev}</td><td align='right'>${gm}</td><td align='right'>${om}</td><td align='right'>9</td><td align='right'>${nm}</td></tr>`;
  const pg = (rev, gm) => Array.from({ length: 120 }, (_, i) => row(String(1000 + i), rev.toLocaleString(), gm, 10, 5)).join("");
  const raw = { "2025Q1": T.parsePmHtml(pg(1000, 20)), "2025Q2": T.parsePmHtml(pg(2000, 21)), "2026Q1": T.parsePmHtml(pg(1000, 24)), "2026Q2": T.parsePmHtml(pg(2000, 25)) };
  assert.deepEqual(raw["2025Q2"]["1000"], ["公司1000", 2000, 21, 10, 5]);
  assert.deepEqual(T.singleQ(raw, "2026Q2")["1000"], [1000, 26, 10, 5], "累計 2000×25% − 1000×24% ÷ 單季 1000 = 26%");
  const P = T.pmRows(raw, { "1000": ["半導體業", "上市"] }), r = P.rows.find(x => x[0] === "1000");
  assert.equal(P.q, "2026Q2"); assert.deepEqual(r.slice(0, 5), ["1000", "公司1000", "半導體業", "上市", 26]); assert.deepEqual([r[7], r[10], r[13]], [2, 4, 1], "季增 2 點（24→26）、年增 4 點（22→26）、連續改善 1 季");
  const rows = [["2026-10-20", "NVDA", "輝達", 4000, 1.3, 1.2, 8, "盤後", "", null], ["2026-10-30", "AAPL", "蘋果", 3800, null, 2, null, "盤後", "", 1.8]];
  U.addRevenue(rows, { NVDA: [{ date: "2026-10-21", revenueActual: 51.234e9, revenueEstimate: 50e9 }] });
  assert.deepEqual(rows[0].slice(10), [51.23, 50], "日期差一天也對得上，十億美元");
  const h1 = U.mergeHist({ rows: [["2020-01-01", "OLD", "", 1, 1, 1, 0, "", null, null]] }, rows, Date.parse("2026-10-22"));
  assert.deepEqual(h1.rows.map(x => x[1]), ["NVDA"], "只收已公布的、三年前的丟掉");
  assert.deepEqual(U.guideOf(["Nvidia raises full-year guidance after record quarter", "Nvidia stock jumps"]).g, 1);
  assert.deepEqual(U.guideOf(["Tesla cuts 2027 outlook as demand slows", "Tesla shares fall"]).g, -1);
  assert.deepEqual(U.guideOf(["Netflix reaffirms full-year outlook"]).g, 0);
  assert.equal(U.guideOf(["Netflix shares fall over 4% on soft current-quarter revenue guidance"]).g, -1); assert.equal(U.guideOf(["Record Revenue, Huge Guidance Push NVIDIA to Near All-Time Highs"]).g, 1);
  const C = await import("../api/_lib/confai.js"), td = (...c) => `<tr class='even'>${c.map(x => `<td>${x}</td>`).join("")}</tr>`, a = f => `<a href='#' onclick='document.fm_fileDownload.fileName.value="${f}";document.fm_fileDownload.submit();'>${f}</a>`;
  const cf = C.parseConfRows(`<table>${td("2330", "台積電", "115/07/16", "14:00", "台北", "公布第2季財報及第3季展望", a("233020260716M001.pdf"), a("233020260716E001.pdf"), "", "")}${td("2317", "鴻海", "115/07/20", "", "", "", "", "", "", "")}</table>`, "2330");
  assert.deepEqual(cf, [{ date: "2026-07-16", time: "14:00", note: "公布第2季財報及第3季展望", file: "233020260716M001.pdf", en: "233020260716E001.pdf" }]);
  assert.equal(C.parseConfRows(`<table>${td("2454", "聯發科", "115/10/30", "15:00", "", "&#8206;(1) 公布第3季財報 &amp; 展望 &#8206;", "", "", "", "")}</table>`, "2454")[0].note, "(1) 公布第3季財報 & 展望", "觀測站夾的 &#8206; 要拿掉");
  const UC = await import("../api/_lib/usconf.js");
  const sub = { filings: { recent: { form: ["10-Q", "8-K", "8-K", "4", "8-K"], filingDate: ["2026-08-28", "2026-08-27", "2026-07-01", "2026-06-01", "2026-05-28"], accessionNumber: ["0001045810-26-000100", "0001045810-26-000099", "0001045810-26-000050", "x", "0001045810-26-000040"], items: ["", "2.02,9.01", "5.07", "", "2.02,9.01"] } } };
  assert.deepEqual(UC.parseUs8k(sub, "0001045810").map(x => [x.date, x.file]), [["2026-08-27", "0001045810-26-000099"], ["2026-05-28", "0001045810-26-000040"]], "只留 8-K Item 2.02");
  assert.equal(UC.parseUs8k(sub, "0001045810")[0].url, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000099/");
  assert.equal(UC.pickEx99([{ name: "0001045810-26-000099-index.htm", size: 1 }, { name: "nvda-20260827.htm", size: 30 }, { name: "q2fy27pr.htm", size: 90 }, { name: "ex99-1.htm", size: 80 }]), "ex99-1.htm");
  assert.equal(UC.pickEx99([{ name: "nvda-8k.htm", size: 30 }, { name: "q2fy27pr.htm", size: 90 }]), "q2fy27pr.htm", "沒有 ex99 就用最大的");
  assert.equal(UC.htmlText("<p>Revenue&nbsp;was $46.7&#160;billion</p><script>x()</script><div>NVIDIA&#8217;s</div>"), "Revenue was $46.7 billion\nNVIDIA's");
  assert.ok(C.okFile("NVDA", "0001045810-26-000099") && !C.okFile("NVDA", "../etc") && !C.okFile("2330", "0001045810-26-000099"));
  assert.equal(C.prevConf([{ date: "2026-08-27", file: "a" }, { date: "2026-08-01", file: "b" }, { date: "2026-05-28", file: "c" }], { date: "2026-08-27", file: "a" }, "NVDA").file, "c", "美股用申報日期找上一季");
  const QL = [{ date: "2026-10-15", file: "233020261015M001.pdf" }, { date: "2026-09-14", file: "233020260716M001.pdf" }, { date: "2026-07-20", file: "233020260716M002.pdf" }, { date: "2026-04-16", file: "233020260416M001.pdf" }];
  assert.equal(C.prevConf(QL, QL[0], "2330").file, "233020260716M001.pdf", "上一季：早 40 天以上的另一份簡報"); assert.equal(C.prevConf(QL, QL[3], "2330"), null);
  assert.deepEqual(C.parseConfCmp('{"tone":"整體更保守","head":"下修全年","changes":[{"k":"營收","now":"成長 10%","before":"成長 15%"},{"x":1}]}'), { tone: "更保守", head: "下修全年", changes: [{ k: "營收", now: "成長 10%", before: "成長 15%" }] });
  assert.equal(C.parseConfCmp('{"tone":"不知道"}'), null, "tone 只能是三種之一");
  const today = "2026-10-23", PL = [{ date: "2026-10-30", file: null }, { date: "2026-10-28", file: "x2.pdf" }, { date: "2026-10-15", file: "x1.pdf" }];
  assert.equal(C.pickConf(PL, today).file, "x1.pdf", "還沒開的不選"); assert.equal(C.pickConf(PL.slice(0, 2), today).file, "x2.pdf", "只有還沒開的就用它"); assert.equal(C.pickConf([], today), null);
  const CS = await import("../scripts/confai-sync.mjs");
  assert.deepEqual(CS.bigCodes({ ranks: [{ id: "mcap", tabs: [{ rows: [{ c: "2330" }, { c: "2454" }] }] }] }, [{ 2317: ["鴻海", "", { "2026-08": 5, "2026-09": 9 }], 1101: ["台泥", "", { "2026-09": 1 }], "00878": ["ETF", "", { "2026-09": 99 }] }, { 8299: ["群聯", "", { "2026-09": 3 }] }], 4), ["2330", "2454", "2317", "8299"], "市值排前面，再用最新月營收補，ETF 不算");
  assert.deepEqual(Object.keys(CS.prune({ a: { date: "2026-10-01" }, b: { date: "2024-01-01" } }, Date.parse("2026-10-23"), 400)), ["a"]);
  assert.ok(C.okFile("2330", "233020260716M001.pdf")); assert.ok(!C.okFile("2330", "../../etc/passwd")); assert.ok(!C.okFile("2330", "231720260716M001.pdf"), "只能讀自己公司的簡報");
  assert.equal(C.parseConfSum('{"head":"AI 需求強","outlook":["Q3 營收 300 億美元"],"risks":[1,"匯率"]}').risks.join(), "匯率");
  assert.equal(U.guideOf(["Apple stock rises 2%"]).g, null, "沒提財測的標題不算");
  assert.equal(U.mergeHist(h1, rows, Date.parse("2026-10-22")).rows.length, 1, "同一筆不重複");
});

test("官方公告：重大訊息、裁罰、經營權異動、董監持股不足、變更交易、新股（欄位錯位）、興櫃、定期定額、券商進出、融資融券、休市日", async () => {
  const { officialPack } = await import("../api/_lib/official.js"), { parseHoliday } = await import("../api/_lib/calendar.js");
  const raw = {
    newsL: [{ "發言日期": "1151020", "發言時間": "70004", "公司代號": "2072", "公司名稱": "世紀風電", "主旨 ": "公告本公司名稱變更", "符合條款": "第51款", "說明": "1.事實發生日" }],
    newsO: [{ Date: "1151021", "發言日期": "1151020", "發言時間": "214608", SecuritiesCompanyCode: "8277", CompanyName: "商丞", "主旨": "公告董事長配合調查", "符合條款": "第53款", "說明": "說明文字" }],
    abn: [{ Number: "0", Code: "", Name: "", Date: "1151020" }],
    fineL: [{ "出表日期": "1151020", "發函日期": "1151012", "股票代號": "1589", "公司名稱": "永冠-KY", "違規事由": "未依規定公告", "違反法規": "證交法", "裁處情形": "處罰鍰 72 萬元" }],
    infoL: [{ "發函日期": "1151008", "股票代號": "3494", "公司名稱": "誠研", "違規事由": "子公司", "違反資訊申報作業辦法條款": "", "違反重大訊息之查證暨公開處理程序條款": "4條1項6款", "裁罰金額(萬)": "5.0" }],
    ctrlO: [{ Date: "1151021", SecuritiesCompanyCode: "3489", CompanyName: "森寶", "經營權異動日期": "1150819", "經營權異動說明": "公告收購" }],
    s3L: [{ "出表日期": "1150819", "連續不足達3個月": "2515", "連續不足達4個月": "1225", "連續不足逾1年以上": "1435 2515" }],
    altL: [{ Code: "1213", Name: "大飲", PeriodicCallAuctionTrading: " " }], haltL: [{ Code: "1218", Name: "泰山", TradingHaltDate: "1150813", TradingResumptionDate: "1150814" }],
    cmodeO: [{ SecuritiesCompanyCode: "2067", CompanyName: "嘉鋼", AlteredTrading: "Ｙ", " FinancialAnnouncements": "Ｙ" }],
    applyL: [{ Code: "1", Company: "7909", ApplicationDate: "鈺祥", Chairman: "1151006", Underwriter: "凱基", UnderwritingPrice: "", ApprovedListingDate: "" }, { Code: "701", Company: "2443", ApplicationDate: "利碟", Chairman: "0890310", Underwriter: "", UnderwritingPrice: "10.5" }],
    newL: [{ Code: "6467", Company: "泰合", ListingDate: "", ApprovedListingDate: "1151020", Underwriter: "元大", UnderwritingPrice: "105.60", Note: "科技事業" }],
    first5L: [{ SecurCode: "7689", SecurName: "大鵬科", "1stTradingDate": "1150728", "5thTradingDate": "1150803", PriceUnderwritten: "180.53" }, { SecurCode: "7689", SecurName: "大鵬科" }],
    esbQ: [{ Date: "1151021", SecuritiesCompanyCode: "1260", CompanyName: "富味鄉", PreviousAveragePrice: "30", Average: "31.5", TransactionVolume: "10996" }],
    esbRev: [{ "資料年月": "11509", "公司代號": "1260", "公司名稱": "富味鄉", "產業別": "食品工業", "營業收入-當月營收": "467614", "營業收入-去年同月增減(%)": "6.99961", "營業收入-上月比較增減(%)": "3.7689" }],
    dca: [{ No: "1", STOCKsSecurityCode: "2330", STOCKsName: "台積電", STOCKsNumberofTradingAccounts: "232850", ETFsSecurityCode: "0050", ETFsName: "元大台灣50", ETFsNumberofTradingAccounts: "1275993" }],
    broker: [{ StockRanking: "1", SecuritiesCompanyCodeAndCompanyName: "富喬(1815)", SecuritiesFirmsCode: "元大", TotalPurchaseShares: "34117", TotalSellShares: "29079" }, { StockRanking: "1", SecuritiesCompanyCodeAndCompanyName: "富喬(1815)", SecuritiesFirmsCode: "凱基", TotalPurchaseShares: "100", TotalSellShares: "0" }],
    marginL: [{ "股票代號": "2330", "股票名稱": "台積電", "融資今日餘額": "1200", "融資前日餘額": "1000", "融券今日餘額": "10", "融券前日餘額": "12" }],
    marginO: [{ Date: "1151021", SecuritiesCompanyCode: "8069", CompanyName: "元太", MarginPurchaseBalance: "500", MarginPurchaseBalancePreviousDay: "800", ShortSaleBalance: "50", ShortSaleBalancePreviousDay: "20" }],
    holiday: [{ Name: "國慶日", Date: "1151010", Description: "依規定放假1日。" }],
  };
  const P = officialPack(raw, Date.parse("2026-10-21T10:00:00Z"));
  assert.deepEqual(P.news.map(r => [r[0], r[1], r[2], r[4], r[5]]), [["2026-10-20", "21:46", "8277", "上櫃", "公告董事長配合調查"], ["2026-10-20", "07:00", "2072", "上市", "公告本公司名稱變更"]]);
  assert.deepEqual(P.abn, []); assert.equal(P.abnDate, "2026-10-20");
  assert.deepEqual(P.fines.map(r => [r[1], r[4], r[7]]), [["1589", "金管會裁罰", "處罰鍰 72 萬元"], ["3494", "違反資訊申報", "罰 5 萬元"]]);
  assert.deepEqual(P.ctrl[0].slice(0, 4), ["2025-08-19".replace("2025", "2026"), "3489", "森寶", "上櫃"]);
  assert.deepEqual(P.short3, [["1435", 13, "上市"], ["2515", 13, "上市"], ["1225", 4, "上市"]], "同一家取最長的月數");
  assert.deepEqual(P.alt.map(r => [r[0], r[3]]), [["1213", "變更交易"], ["1218", "暫停交易 2026-08-13～2026-08-14"], ["2067", "變更交易、財報異常"]]);
  assert.deepEqual(P.ipo.apply.map(r => r.slice(0, 4)), [["7909", "鈺祥", "上市", "2026-10-06"]], "申請上市欄位錯位一格，只留最近兩年");
  assert.deepEqual(P.ipo.listed[0].slice(0, 5), ["6467", "泰合", "上市", "2026-10-20", 105.6]);
  assert.equal(P.ipo.first5.length, 1);
  assert.deepEqual(P.esb.quotes[0], ["1260", "富味鄉", 31.5, 30, 5, 10996]); assert.deepEqual(P.esb.rev[0], ["1260", "富味鄉", "食品工業", 4.68, 7, 3.8]); assert.equal(P.esb.ym, "2026-09");
  assert.deepEqual(P.dca[0], [1, "2330", "台積電", 232850, "0050", "元大台灣50", 1275993]);
  assert.deepEqual(P.broker, [[1, "1815", "富喬", [["元大", 34117, 29079], ["凱基", 100, 0]]]]);
  assert.deepEqual([P.margin.up[0][0], P.margin.up[0][4], P.margin.dn[0][0], P.margin.dn[0][4], P.margin.sUp[0][0]], ["2330", 200, "8069", -300, "8069"]);
  assert.deepEqual(P.margin.tot, [["上市", 1200, 200, 10, -2], ["上櫃", 500, -300, 50, 30]]);
  assert.deepEqual(P.holiday, [["2026-10-10", "國慶日", "依規定放假1日。"]]);
  assert.deepEqual(parseHoliday([{ Name: "國慶日", Date: "1151010", Description: "x" }]), [{ date: "2026-10-10", name: "國慶日", note: "x" }]);
  assert.deepEqual(officialPack({}).news, [], "全部抓不到也不會出錯");
});
import { aiLimit, AI_LIMITS, limitsOf } from "../api/_lib/_limit.js";
import { privIp, safeFetch, safeUrl, readCapped, pinnedGet } from "../api/_lib/podcast.js";
import { themesOf, queryOf, mergeNews } from "../scripts/industry-news.mjs";
test("AI 次數限制：每 IP 每小時、全站每天", async () => {
  const M = new Map(), store = async k => { const n = (M.get(k) || 0) + 1; M.set(k, n); return n; }, req = ip => ({ headers: { "x-forwarded-for": ip + ", 10.0.0.1" } }), t = Date.parse("2026-10-22T03:00:00Z");
  for (let i = 0; i < AI_LIMITS.podcast[0]; i++) assert.equal(await aiLimit(req("1.2.3.4"), "podcast", t, store), null);
  assert.match(await aiLimit(req("1.2.3.4"), "podcast", t, store), /每小時最多 6 次/);
  assert.equal(await aiLimit(req("5.6.7.8"), "podcast", t, store), null, "別的 IP 不受影響");
  assert.equal(await aiLimit(req("1.2.3.4"), "podcast", t + 3600e3, store), null, "下一個小時重新計算");
  assert.equal(await aiLimit(req("1.2.3.4"), "quote", t, store), null, "不是 AI 服務不限制");
  const bad = async () => { throw new Error("KV 壞了"); };
  for (let i = 0; i < 20; i++) assert.equal(await aiLimit(req("4.4.4.4"), "chat", t, bad), null);
  assert.match(await aiLimit(req("4.4.4.4"), "chat", t, bad), /每小時最多 20 次/, "計數器壞掉時改用記憶體的保守上限（每 IP 一半），不直接放行");
  assert.deepEqual(limitsOf("chat", false), [20, 150], "沒有 KV：每 IP 一半、每天十分之一");
  process.env.AI_DAILY_CAP = "5000"; process.env.AI_HOURLY_PER_IP_CHART_READ = "3";
  assert.deepEqual(limitsOf("chat"), [40, 1500], "舊的全站變數只能調低，不會放寬");
  assert.deepEqual(limitsOf("chart-read"), [3, 300], "每個服務分開設");
  process.env.AI_DAILY_CAP = "100"; assert.deepEqual(limitsOf("chat"), [40, 100]);
  delete process.env.AI_DAILY_CAP; delete process.env.AI_HOURLY_PER_IP_CHART_READ;
  M.clear(); let day = 0; const big = async k => (k.includes(":day:") ? ++day + AI_LIMITS.chat[1] : 1);
  assert.match(await aiLimit(req("9.9.9.9"), "chat", t, big), /今天的 AI 使用量已達上限/);
  assert.ok(![...M.keys()].some(k => k.includes("1.2.3.4")), "IP 只存雜湊");
});
test("API 稽核修正：比較快取鍵含內容、錯誤訊息不帶外部原文、狀態頁擋多餘參數、選股漲停價", async () => {
  const { cmpKey } = await import("../api/_lib/confai.js"), { userMsg } = await import("../api/_lib/_err.js");
  const a = { head: "營收成長" }, b = { head: "毛利率下滑" };
  assert.equal(cmpKey("2330x.pdf", "2330y.pdf", a, b), cmpKey("2330x.pdf", "2330y.pdf", { ...a }, { ...b }), "同樣內容同一個鍵");
  assert.notEqual(cmpKey("2330x.pdf", "2330y.pdf", a, b), cmpKey("2330x.pdf", "2330y.pdf", { head: "假的" }, b), "送假的整理結果不會蓋掉別人的快取");
  const err = console.error; console.error = () => {};
  try { assert.equal(userMsg(new Error("簡報太大（50MB）"), "x"), "簡報太大（50MB）", "自己寫的中文訊息照回"); assert.equal(userMsg(new Error("WRONGPASS invalid token"), "雲端暫時連不到"), "雲端暫時連不到", "外部原文不帶出去"); }
  finally { console.error = err; }
  const { default: status } = await import("../api/_lib/status.js"), res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(n) { this.code = n; return this; }, end() { return this; }, json(j) { this.j = j; return this; } };
  await status({ query: { x: "123" } }, res); assert.equal(res.code, 308); assert.equal(res.h.Location, "/api/status", "多帶亂數參數就轉回標準網址（CDN 快取才對得到）");
  const { limitPrice } = await import("../api/_lib/screen.js"); assert.deepEqual([limitPrice(2420), limitPrice(2420, false), limitPrice(9.5)], [2660, 2180, 10.45]);
});
test("節目匯入：擋內網位址與跳轉到內網", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(privIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::8888"]) assert.equal(privIp(ip), false, ip);
  assert.equal(safeUrl("http://169.254.169.254/latest"), null); assert.equal(safeUrl("file:///etc/passwd"), null); assert.equal(safeUrl("https://u:p@a.com/"), null);
  const DNS = { "feed.example.com": "93.184.216.34", "evil.example.com": "127.0.0.1" }, lookup = async h => (DNS[h] ? [{ address: DNS[h] }] : Promise.reject(new Error("ENOTFOUND")));
  const seen = [], get = async (u, a) => { seen.push([u, a.address]); return u.includes("/go") ? new Response("", { status: 302, headers: { location: "http://evil.example.com/x" } }) : new Response("ok"); };
  assert.equal(await (await safeFetch("https://feed.example.com/rss", {}, { lookup, get })).text(), "ok");
  assert.deepEqual(seen[0], ["https://feed.example.com/rss", "93.184.216.34"], "連線用剛檢查過的 IP（不再查一次 DNS）");
  await assert.rejects(safeFetch("https://evil.example.com/rss", {}, { lookup, get }), /不允許/);
  await assert.rejects(safeFetch("https://feed.example.com/go", {}, { lookup, get }), /不允許/, "跳轉到內網也要擋");
  await assert.rejects(safeFetch("https://nope.example.com/", {}, { lookup, get }), /找不到/);
  // 真的連線：本機伺服器，lookup 直接回 127.0.0.1（測 pinnedGet 本身；safeFetch 會擋內網，所以直接呼叫）
  const srv = (await import("node:http")).createServer((q, r) => { r.writeHead(200, { "x-host": q.headers.host }); r.end("pinned"); });
  await new Promise(r => srv.listen(0, r));
  try { const r = await pinnedGet(`http://pinned.example.com:${srv.address().port}/a`, { address: "127.0.0.1" }); assert.equal(await r.text(), "pinned"); assert.match(r.headers.get("x-host"), /^pinned\.example\.com:/, "Host 標頭還是原本的網域"); }
  finally { srv.close(); }
  await assert.rejects(readCapped(new Response("x".repeat(2000)), 1000), /太大/); assert.equal((await readCapped(new Response("abc"), 10)).toString(), "abc");
});
test("產業新聞：題材搜尋字、同一則合併題材、保留 60 天", async () => {
  const T = themesOf(await (await import("node:fs/promises")).readFile(new URL("../learner/industry.js", import.meta.url), "utf8"));
  assert.ok(T.length > 10 && T.every(t => t.id && t.name));
  assert.equal(queryOf({ name: "AI 先進封裝（CoWoS）", mk: "tw" }), "AI 先進封裝 CoWoS"); assert.equal(queryOf({ name: "量子電腦", mk: "us" }), "量子電腦 美股");
  const now = Date.parse("2026-10-22T00:00:00Z"), old = { items: [{ date: "2026-10-20", themes: ["a"], title: "台積電先進封裝擴產 - 經濟日報", summary: "s", url: "u" }, { date: "2026-07-01", themes: ["a"], title: "舊新聞", url: "u" }] };
  const N = mergeNews(old, [{ date: "2026-10-21", themes: ["b"], title: "台積電先進封裝擴產 - 經濟日報", url: "u2" }, { date: "2026-10-21", themes: ["c"], title: "新的一則", url: "u3" }], now);
  assert.deepEqual(N.map(x => x.title), ["新的一則", "台積電先進封裝擴產 - 經濟日報"]); assert.deepEqual(N[1].themes, ["a", "b"]); assert.equal(N[1].summary, "s", "已經有的重點不重做");
  assert.deepEqual(old.items[0].themes, ["a"], "不改到舊資料");
});
import { revEvents, pmEvents, entryIdx, marketIndex, study, revAnn, qAnn } from "../scripts/event-study.mjs";
const plain = v => JSON.parse(JSON.stringify(v)); // 沙盒（vm）裡產生的物件換成一般物件再比
test("事件提醒 evScan：營收公布、三率三升、法說會只提醒前一個交易日", () => {
  const { B } = engine(), rev = { 2330: { ...plain(B.revOf({ ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2025-${String(i + 1).padStart(2, "0")}`, 100])), "2025-09": 200, "2026-08": 250, "2026-09": 300 })), name: "台積電" } };
  assert.equal(rev[2330].ym, "2026-09"); assert.equal(Math.round(rev[2330].yoy), 50); assert.equal(Math.round(rev[2330].mom), 20);
  const D = { rev, pm: { q: "2026Q2", rows: [["2330", "台積電", "半導體業", "上市", 59, 49, 42, 1, 0.5, 0.2], ["2317", "鴻海", "", "上市", 6, 3, 2, 1, -1, 1]] },
    conf: [{ date: "2026-10-26", time: "14:00", code: "2330", name: "台積電" }, { date: "2026-10-27", code: "2317", name: "鴻海" }] };
  const H = plain(B.evScan(["2330", "2317"], D, "2026-10-23")); // 10/23 是週五，下一個交易日是 10/26 週一
  assert.deepEqual(H.map(x => x.kind).sort(), ["conf", "pm3", "rev"]); assert.ok(H.every(x => x.code === "2330"), "鴻海三率沒有全升、法說會還太遠");
  assert.equal(H.find(x => x.kind === "conf").k, "c:2330:2026-10-26"); assert.match(H.find(x => x.kind === "rev").m, /9 月營收 0\.00 億，年增 \+50\.0%、月增 \+20\.0%/);
  assert.deepEqual(plain(B.evScan([], D, "2026-10-23")), [], "沒有代號就沒有事件");
  // ETF 換股：只看近 7 天、有股票代號的（期貨換月不算），同一天合成一則
  const E = { etf: { "0050": { name: "元大台灣50", ev: [{ d: "2026-10-20", t: "in", code: "2345", name: "智邦" }, { d: "2026-10-20", t: "out", code: "1101", name: "台泥" }, { d: "2026-10-20", t: "in", code: null, name: "臺股期貨 202611" }, { d: "2026-09-01", t: "in", code: "2330", name: "台積電" }] } } };
  const EH = plain(B.evScan(["0050"], E, "2026-10-23"));
  assert.deepEqual(EH.map(x => [x.kind, x.k]), [["etf", "e:0050:2026-10-20"]]); assert.match(EH[0].m, /元大台灣50 0050 換股：10\/20 新增 智邦，剔除 台泥$/);
});
test("早報 briefParts／briefText：沒有資料的段落不放，庫存排前面", () => {
  const { B } = engine(), G = { us: { ok: true, date: "2026-10-21", indices: [{ code: "^SOX", name: "費半", price: 6000, chgPct: -2.1 }], megas: [], macro: [] }, fut: { ok: true, night: { price: 23000, chg: -40, chgPct: -0.17 } }, cal: { rows: [{ date: "2026-10-22", code: "1101", kind: "除息", cash: 1 }, { date: "2026-10-22", code: "2330", kind: "除息", cash: 4.5 }], conf: [] } };
  const P = plain(B.briefParts(G, { codes: ["2330"], names: { 2330: "台積電", 1101: "台泥" } }, "2026-10-22"));
  assert.deepEqual(P.map(p => p.t), ["昨晚美股（美東 10/21）", "台指期", "今天的除權息、法說會"]);
  assert.match(P[2].L[0].s, /^★ 台積電 2330 除息 現金 4\.5 元/); assert.equal(P[0].L[0].k, "down");
  const T = B.briefText(P, "2026-10-22"); assert.match(T, /^☀️ KLineLab 早報（10\/22 週四）/); assert.match(T, /【台指期】\n• 夜盤 23,000（-40 點，-0\.2%）/); assert.match(T, /不是買賣建議/);
  assert.deepEqual(plain(B.briefParts({}, {})), [], "全部拿不到就是空的（排程不會送出空的早報）");
});
test("總經敏感度 macroBeta：Beta 正確、美股因子對齊前一晚、不用到未來", () => {
  const { B } = engine(), days = [], d = new Date("2026-01-05T00:00:00Z"); while (days.length < 160) { if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  let s = 1, f = 100; const F = [], noise = i => Math.sin(i * 7.3) * 0.002, fr = i => Math.sin(i * 1.7) * 0.01 + Math.cos(i * 0.9) * 0.006;
  days.forEach((dd, i) => { F.push({ d: dd, c: f }); f *= 1 + fr(i + 1); });
  const S0 = [], S1 = []; let a = 1, b = 1; days.forEach((dd, i) => { S0.push({ d: dd, c: a }); S1.push({ d: dd, c: b }); a *= 1 + 0.6 * fr(i + 1) + noise(i); b *= 1 + 0.6 * fr(i) + noise(i); });
  const same = B.macroBeta(S0, F, { lag: 0 }), late = B.macroBeta(S1, F, { lag: 1 }), wrong = B.macroBeta(S1, F, { lag: 0 });
  assert.ok(Math.abs(same.beta - 0.6) < 0.05 && same.corr > 0.95, `同一天：${same.beta}`);
  assert.ok(Math.abs(late.beta - 0.6) < 0.05 && late.corr > 0.95, `前一晚：${late.beta}`);
  assert.ok(Math.abs(wrong.corr) < 0.5, "時間沒對齊時相關性低");
  let yv = 4, px = 100; const T = [], Y = []; days.forEach((dd, i) => { T.push({ d: dd, c: yv }); Y.push({ d: dd, c: px }); const dy = Math.sin(i * 2.1) * 0.05; yv += dy; px *= 1 - 0.3 * Math.sin((i - 1) * 2.1) * 0.05 + noise(i); });
  assert.ok(B.macroBeta(Y, T, { kind: "diff", lag: 1 }).beta < 0, "殖利率上升、股價下跌 → Beta 為負");
  assert.equal(B.macroBeta(S0.slice(0, 20), F, {}), null, "資料不到 40 天不算");
});
test("財報事件回測：事件判斷、公布後才進場、超額報酬", () => {
  assert.equal(revAnn("2026-09"), "2026-10-11"); assert.equal(revAnn("2026-12"), "2027-01-11"); assert.equal(qAnn("2026Q2"), "2026-08-15"); assert.equal(qAnn("2026Q4"), "2027-04-01");
  const H = {}; for (let i = 0; i < 30; i++) { const y = 2024 + Math.floor(i / 12), m = (i % 12) + 1; H[`${y}-${String(m).padStart(2, "0")}`] = i < 26 ? 100 + (i % 3) : i === 26 ? 90 : 200; }
  const E = revEvents(H), kinds = E.map(e => `${e.t}:${e.p}`);
  assert.ok(kinds.includes("high:2026-04"), "2026-04 營收創新高"); assert.ok(kinds.includes("turn:2026-04") && kinds.includes("yoy30:2026-04"), "年減轉年增、年增衝過 30%");
  assert.ok(!kinds.some(k => k.startsWith("high:2024")), "資料不到 24 個月不算新高"); assert.ok(E.every(e => e.ann > `${e.p}-31`), "公布日都在該月之後");
  assert.deepEqual(pmEvents({ "2026Q1": [30, 10, 8], "2026Q2": [31, 11, 9], "2026Q4": [20, 5, 4] }).map(e => `${e.t}:${e.p}`), ["pm3:2026Q2"], "Q2→Q4 不連續不算");
  const bars = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"].map((d, i) => ({ d, c: 100 + i }));
  assert.equal(entryIdx(bars, "2026-10-11"), 1, "公布日 10/11 是週日，10/12 收盤進場"); assert.equal(entryIdx(bars, "2026-11-11"), -1, "超過 7 天沒有資料不算");
  // 兩檔：A 公布後漲、B 是基準；未來的價格改變不會影響是否進場與進場價
  const days = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
  const A = { c: "1111", n: "甲", ind: "測試業", bars: days.map((d, i) => ({ d, c: d < "2026-10-11" ? 100 : 100 + (i - 10) })), rev: H, pm: {} }, Bm = { c: "2222", n: "乙", bars: days.map(d => ({ d, c: 50 })) };
  const M = marketIndex([A.bars, Bm.bars]), T = study([A, Bm], M, [5]).find(x => x.t === "high");
  assert.equal(T.stats[5], null, "2026-04 的事件不在這段日 K 裡");
  const H2 = { ...H, "2026-09": 999 }, A2 = { ...A, rev: H2 }, T2 = study([A2, Bm], marketIndex([A2.bars, Bm.bars]), [5]).find(x => x.t === "high");
  assert.equal(T2.stats[5].n, 1); assert.equal(T2.recent[0][3], "2026-10-11", "10/11 收盤進場"); assert.ok(Math.abs(T2.stats[5].avg - 0.05) < 1e-9, "進場價 100、5 天後 105");
  assert.ok(T2.stats[5].ex < T2.stats[5].avg && T2.stats[5].ex > 0, "超額報酬扣掉大盤（等權平均也被甲拉高）");
});
test("事件提醒設定寫進推播清單：只看庫存或加上自選；只勾早報也算", () => {
  const data = { "kline:watch:evalert": JSON.stringify({ rev: true, brief: true, scope: "hold" }), "kline:watch:hold": JSON.stringify({ 2330: { sh: 1 }, AAPL: { sh: 1 }, 9999: { sh: 1, demo: true } }), "kline:watch:groups": JSON.stringify([{ list: ["2317", "NVDA"] }]) };
  assert.deepEqual(alertDoc(data, "1").ev, { on: ["rev", "brief"], codes: ["2330"], mine: [], mon: [] });
  assert.deepEqual(alertDoc({ ...data, "kline:watch:evalert": JSON.stringify({ pm3: true, scope: "all" }) }, "1").ev, { on: ["pm3"], codes: ["2330", "2317"], mine: [], mon: [] });
  // ETF 換股、收盤重點也要寫進去（收盤重點看自選＋庫存全部，含美股）
  const cl = alertDoc({ ...data, "kline:watch:evalert": JSON.stringify({ etf: true, close: true }) }, "1").ev;
  assert.deepEqual(cl.on, ["etf", "close"]); assert.deepEqual(cl.mine, ["2330", "AAPL", "2317", "NVDA"]);
  assert.equal(docHas(alertDoc({ "kline:watch:evalert": JSON.stringify({ close: true }), "kline:watch:groups": JSON.stringify([{ list: ["NVDA"] }]) }, "1")), true, "只勾收盤重點、自選有股票就推");
  assert.equal(docHas(alertDoc({ "kline:watch:evalert": JSON.stringify({ brief: true }) }, "1")), true, "沒有庫存也可以收早報");
  assert.equal(docHas(alertDoc({ "kline:watch:evalert": JSON.stringify({ rev: true }) }, "1")), false, "勾了營收但沒有庫存就不用檢查");
});

test("收盤重點：今日重點卡和 Telegram 用同一套內容（漲跌家數、大漲跌、今明兩天、ETF 換股）", () => {
  const { todayData, closeText } = engine().B, pct = { 2330: 3.5, 2317: -1, NVDA: -4.2, "0050": 0.2 };
  const D = todayData({ mine: new Set(["2330", "2317", "NVDA", "0050", "T00"]), pct: c => pct[c] ?? null, today: "2026-10-23",
    cal: { rows: [{ date: "2026-10-26", code: "2317", kind: "除息" }, { date: "2026-10-30", code: "2330" }], conf: [{ date: "2026-10-23", code: "0050" }] },
    etf: { "0050": { ev: [{ d: "2026-10-22", t: "in", code: "3017", name: "奇鋐" }, { d: "2026-10-01", t: "out", code: "1101", name: "台泥" }] } } });
  const J = x => JSON.parse(JSON.stringify(x)); // 沙盒裡的陣列和這裡的不是同一個 Array，比較前轉一次
  assert.deepEqual([D.n, D.up, D.dn], [4, 2, 2], "指數沒有漲跌不算");
  assert.deepEqual(J(D.mv.map(x => x[0])), ["NVDA", "2330"], "超過 3% 才算大漲跌，依幅度排序");
  assert.deepEqual(J(D.cal.map(([x, w]) => [x.code, w])), [["2317", "除息"], ["0050", "法說會"]], "10/23 是週五，下一個平日是 10/26");
  const t = closeText(D, { 2330: "台積電", 2317: "鴻海" });
  assert.match(t, /今日收盤重點（10\/23）[\s\S]*上漲 2、下跌 2[\s\S]*NVDA -4\.2%、台積電 \+3\.5%[\s\S]*明天 鴻海 除息、今天 0050 法說會[\s\S]*0050 10\/22 新增 奇鋐/);
  assert.doesNotMatch(t, /台泥/, "ETF 換股只看近 3 天");
  assert.equal(closeText(todayData({ mine: new Set(), pct: () => null, today: "2026-10-23" })), "", "沒有內容就不送");
});

test("今日符合型態的個股：和課程範例圖用同一套判斷、只看今天、成交值排序、每型態最多 12 檔", async () => {
  const { patternHits } = await import("../scripts/pattern-today.mjs"), E = engine();
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, H = { date: "2026-10-23", s: {} };
  for (let k = 0; k < 400; k++) { let c = 50 + rnd() * 100; const b = [];
    for (let i = 0; i < 120; i++) { const o = c * (1 + (rnd() - 0.5) * 0.03); c = o * (1 + (rnd() - 0.5) * 0.06);
      b.push({ d: i === 119 ? "2026-10-23" : new Date(Date.UTC(2026, 3, 1) + i * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, c) * (1 + rnd() * 0.02), l: Math.min(o, c) * (1 - rnd() * 0.02), c, v: k % 10 ? 600 + Math.round(rnd() * 5000) : 100 }); }
    H.s[String(1000 + k)] = { n: "股" + k, b }; }
  H.s["0050"] = { n: "ETF", b: H.s["1001"].b }; H.s["1001"].b = H.s["1001"].b.slice(0, -1); // ETF 不算；今天沒有資料的不算
  const R = patternHits(H, E); assert.equal(R.n, 359, "成交不到 500 張、ETF、今天沒資料的都略過");
  assert.ok(Object.keys(R.hits).length >= 10);
  for (const [id, L] of Object.entries(R.hits)) { assert.ok(L.length <= 12);
    const tv = L.map(([c]) => { const b = H.s[c].b.at(-1); return b.c * b.v; }); assert.deepEqual(tv, [...tv].sort((a, b) => b - a), `${id} 依成交值排序`);
    for (const [c] of L) { const D = H.s[c].b, I = E.indicators(D), last = D.length - 1;
      const ok = E.S.detectPattern(D, last) === id || E.S.Signals.chartPat(D, I).some(m => m.i === last && m.pat === id) || E.S.Signals.gaps(D, I).some(m => m.i === last && m.pat === id);
      assert.ok(ok, `${c} 今天真的有 ${id}`); } }
});

test("集保網站查詢：解析分級表、週資料欄位和排程一樣、token 每次換新", async () => {
  const lv = [[1, "1-999", 2459344, 287438824, 1.1], [2, "1,000-5,000", 446137, 853315544, 3.29], [8, "40,001-50,000", 1000, 1e6, 0.61], [12, "400,001-600,000", 300, 2e8, 1.5], [15, "1,000,001以上", 1476, 2.2e10, 84.56], [16, "差異數調整（說明4）", 0, 0, 0], [17, "合　計", 3098860, 2.59e10, 100]];
  const page = (tok, rows) => `<form><input type="hidden" name="SYNCHRONIZER_TOKEN" value="${tok}"><select name="scaDate"><option value="20261016">20261016</option><option value="20261008">20261008</option><option value="20251023">20251023</option></select></form>
    <table class="table"><thead><tr><th>序</th><th>持股/單位數分級</th><th>人數</th><th>股數/單位數</th><th>占集保庫存數比例 (%)</th></tr></thead>${rows ? lv.map(r => `<tr><td align="center">${r[0]}</td><td>${r[1]}</td><td align="right">${r[2].toLocaleString()}</td><td>${r[3].toLocaleString()}</td><td>${r[4].toFixed(2)}</td></tr>`).join("") : `<tr><td colspan="5"><span>查無此資料</span></td></tr>`}</table>`;
  assert.equal(tokenOf(page("abc-123", 0)), "abc-123");
  assert.deepEqual(datesOf(page("t", 0)), ["2026-10-16", "2026-10-08", "2025-10-23"]);
  assert.equal(parseWeek(page("t", 0)), null, "查無此資料");
  const W = parseWeek(page("t", 1)); assert.equal(W.levels.length, 7);
  assert.deepEqual(weekRow("2026-10-16", W), ["2026-10-16", 84.56, 86.06, 5, 3098860, 1476]);
  // 網站的合計列有時沒有序號：用「合計」認；真的沒有合計列就把 1～15 級人數加起來
  const W2 = parseWeek(page("t", 1).replace('<td align="center">17</td>', '<td align="center"></td>')); assert.equal(W2.levels.at(-1).lv, 17);
  assert.equal(weekRow("d", { levels: W.levels.filter(x => x.lv !== 17) })[4], 2459344 + 446137 + 1000 + 300 + 1476);
  assert.ok(needFix([["2026-01-02", 1, 1, 1, 0, 1], ...Array(55).fill(["d", 1, 1, 1, 5, 1])]), "有週次沒有總人數要重查"); assert.ok(!needFix(Array(55).fill(["d", 1, 1, 1, 5, 1])));
  // 每條連線先開查詢頁，之後每次送出都用上一個回應給的 token；查無資料的週次跳過
  const seen = []; let n = 0;
  const fetchFn = async (u, o = {}) => { if (o.method !== "POST") return new Response(page(`t${n++}`, 0), { headers: { "set-cookie": "JSESSIONID=x; Path=/" } });
    const b = new URLSearchParams(o.body); seen.push([b.get("scaDate"), b.get("SYNCHRONIZER_TOKEN"), o.headers.Cookie, b.get("stockNo")]); return new Response(page(`t${n++}`, b.get("scaDate") !== "20251023")); };
  const r = await tdccWeeks("2330", { from: "2025-01-01", to: "2026-10-10", conc: 1, fetchFn });
  assert.deepEqual(r.rows.map(x => x[0]), ["2026-10-08"], "只查 from～to 之間、查無資料的不放");
  assert.deepEqual(seen.map(x => x[0]), ["20261008", "20251023"]); assert.ok(seen.every(x => x[2] === "JSESSIONID=x" && x[3] === "2330"));
  assert.notEqual(seen[0][1], seen[1][1], "第二次用新的 token");
  assert.equal(r.dist.d, "2026-10-08"); assert.ok(r.dist.levels.every(x => x.lv <= 15));
  // /api/company 股權分散備援：換成 FinMind 一樣的欄位
  assert.deepEqual(tdccHolders(r.rows), [{ d: "2026-10-08", b400: 86.06, b1000: 84.56, people1000: 1476, r50: 5 }]);
  assert.deepEqual(tdccDist(r.dist).levels.map(x => x.lo), [1, 1000, 40001, 400001, 1000001]);
});

test("集保排程：每檔每週一列、保留 156 週，4／13 週排行用最接近 n 週前的那週", () => {
  const a = []; for (let i = 0; i < 160; i++) addRow(a, [new Date(Date.parse("2023-09-01") + i * 7 * 864e5).toISOString().slice(0, 10), 50 + i * 0.1, 60, 20 - i * 0.01, 1000 + i, 10]);
  assert.equal(a.length, 156); assert.equal(a[0][0], "2023-09-29"); addRow(a, [a.at(-1)[0], 99, 60, 20, 1000, 10]); assert.equal(a.length, 156, "同一週取代不重複");
  const d = a.at(-1)[0], b = a.map((r, i) => [r[0], 40 - i * 0.05, 60, 30, 500, 5]).slice(-10), small = [[d, 50, 60, 20, 50, 1]];
  const R4 = rankOf([["2330", a], ["2317", b], ["9999", small]], d, 4);
  assert.equal(R4.from, a.at(-5)[0]); assert.deepEqual(R4.up.map(x => x[0]), ["2330", "2317"], "人數不到 100 的不排");
  assert.equal(R4.up[0][1], +(99 - a.at(-5)[1]).toFixed(2)); assert.equal(R4.down[0][0], "2317");
  assert.equal(rankOf([["2317", b]], d, 13), null, "歷史不夠 13 週就沒有排行");
});

test("觀測站持股轉讓日報表（補更早年份）：欄位和 OpenAPI 的列一樣", () => {
  const td = a => `<tr>${a.map(x => `<td>${x}</td>`).join("")}</tr>`;
  const html = `<table><tr><th>異動情形</th><th>申報日期</th><th>公司代號</th></tr>${td(["轉讓方式", "轉讓股數", "自有持股"])}
    ${td(["110/06/01", "2426", "鼎元", "董事配偶", "許敏川之配偶", "一般交易(每日得轉讓股數限制)", "250,000", "330,622", "&nbsp;", "1,336,560", "0", "250,000", "0", "1,086,560", "0", "110/06/04 ~ 110/07/03", ""])}
    ${td(["", "110/06/01", "2801", "彰銀", "大股東本人", "台新金融控股股份有限公司", "鉅額逐筆交易", "400,000,000", "", "", "2,341,359,234", "100", "400,000,000", "0", "1,941,359,234", "100", "110/06/04 ~ 110/07/03", "是"])}
    ${td(["(1) 以上資料係由各公司自行建檔提供參考"])}</table>`;
  const L = parseMopsDay(html, "上市");
  assert.equal(L.length, 2, "說明列、表頭不算");
  assert.deepEqual(L[0], { d: "2021-06-01", code: "2426", name: "鼎元", who: "許敏川之配偶", role: "董事配偶", how: "一般交易(每日得轉讓股數限制)", sh: 250000, hold: 1336560, after: 1086560, to: "", from: "2021-06-04", until: "2021-07-03", market: "上市" });
  assert.deepEqual([L[1].code, L[1].sh, L[1].hold, L[1].after], ["2801", 400000000, 2341359334, 1941359334], "前面多一格（異動情形）也對得上，自有＋信託相加");
});
test("題材連動：週報酬、相關係數、領先落後、上三角索引；產業圖解原始檔檢查通過", async () => {
  const { dailyRet, themeRet, weekly, corr, leadCorr, triIdx, compute, mkOf, ySym } = await import("../scripts/theme-corr.mjs");
  assert.equal(mkOf("2330"), "tw"); assert.equal(mkOf("8058.T"), "jp"); assert.equal(mkOf("329180.KS"), "kr"); assert.equal(mkOf("NVDA"), "us"); assert.equal(ySym("BRK.B"), "BRK-B");
  assert.ok(Math.abs(corr([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9); assert.ok(Math.abs(corr([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
  assert.equal(dailyRet([["a", 10], ["b", 11], ["c", 30]]).size, 1, "一天漲超過 50% 當資料錯誤");
  const W = weekly(new Map([["2026-10-19", 0.1], ["2026-10-20", 0.1], ["2026-10-26", -0.5]])); assert.ok(Math.abs(W.get("2026-10-19") - 0.21) < 1e-9); assert.equal(W.get("2026-10-26"), -0.5);
  const N = 5, seen = new Set(); for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const k = triIdx(i, j, N); assert.equal(k, triIdx(j, i, N)); seen.add(k); } assert.deepEqual([...seen].sort((a, b) => a - b), [...Array(10).keys()]);
  // B 每天照抄 A 前一天的漲跌 → A 領先 B
  const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)), r = days.map((_, i) => Math.sin(i * 1.7) * 0.02);
  const A = new Map(days.map((d, i) => [d, r[i]])), B = new Map(days.map((d, i) => [d, i ? r[i - 1] : 0]));
  assert.ok(leadCorr(A, B).r > 0.9); assert.ok(leadCorr(B, A).r < 0.5);
  const R = compute([{ id: "a", mk: "us", codes: ["X"] }, { id: "b", mk: "tw", codes: ["1"] }], new Map([["X", A], ["1", B]]));
  assert.deepEqual(R.ids, ["a", "b"]); assert.equal(R.lead[0][0], "a"); assert.equal(R.lead[0][1], "b"); assert.equal(R.c.length, 1);
  assert.equal(themeRet([new Map([["d", 0.1]]), new Map([["d", 0.3]])]).get("d"), 0.2);
  const { execFileSync } = await import("node:child_process"); execFileSync("node", [(await import("node:url")).fileURLToPath(new URL("../scripts/check-indpack.mjs", import.meta.url))], { stdio: "pipe" }); // 有 ✗ 會丟錯
});
test("YouTube：頻道影片 RSS、搜尋結果、頻道網址解析，影片交給 Gemini 看", async () => {
  const P = await import("../api/_lib/podcast.js");
  const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>M觀點</title><link rel="alternate" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"/><author><name>M觀點</name></author>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>台積電法說會重點 &amp; AI 需求</title><published>2026-10-20T10:00:00+00:00</published><media:group><media:description>今天聊台積電</media:description><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/></media:group></entry>
    <entry><yt:videoId>zyxwvutsrqp</yt:videoId><title>一分鐘看懂 #shorts</title><published>2026-10-21T10:00:00+00:00</published></entry></feed>`;
  const R = P.parseRss(xml);
  assert.equal(R.show.name, "M觀點"); assert.ok(R.show.yt); assert.equal(R.eps.length, 1, "#shorts 不收");
  assert.deepEqual([R.eps[0].guid, R.eps[0].video, R.eps[0].title, R.eps[0].audio, R.eps[0].desc], ["yt:abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk", "台積電法說會重點 & AI 需求", "", "今天聊台積電"]);
  assert.ok(P.isYtVideo(R.eps[0].video)); assert.ok(!P.isYtVideo("https://evil.example.com/watch?v=abcdefghijk"));
  const html = `..."channelRenderer":{"channelId":"UCabcdefghijklmnopqrstuv","title":{"simpleText":"M觀點"},"thumbnail":{"thumbnails":[{"url":"//yt3.ggpht.com/a.jpg"}]},"subscriberCountText":{}...`;
  assert.deepEqual(P.ytSearchParse(html)[0], { id: "UCabcdefghijklmnopqrstuv", name: "M觀點", author: "M觀點", art: "https://yt3.ggpht.com/a.jpg", feed: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv", yt: true });
  assert.equal(P.ytChannelParse(`<meta property="og:title" content="柴鼠兄弟"><script>{"externalId":"UCzzzzzzzzzzzzzzzzzzzzzz"}</script>`).name, "柴鼠兄弟");
  assert.deepEqual(P.ytInput("@miulaviewpoint"), { path: "/@miulaviewpoint" }); assert.equal(P.ytInput("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv").id, "UCabcdefghijklmnopqrstuv"); assert.equal(P.ytInput("https://evil.example.com"), null);
  const parts = P.ytParts("https://www.youtube.com/watch?v=abcdefghijk", "x"); assert.equal(parts[0].fileData.fileUri, "https://www.youtube.com/watch?v=abcdefghijk"); assert.ok(parts[0].videoMetadata.fps < 1);
  assert.match(P.PROMPT({ title: "t" }, "video"), /YouTube 影片/);
});

test("每日市場決策中心 Round 2：交易日曆、時間注入、嚴格資料可信度與客觀驗證", () => {
  const B = engine().B;
  assert.ok(typeof B.sessionStatus === "function");
  assert.ok(typeof B.briefScenarios === "function");
  assert.ok(typeof B.validatePlan === "function");
  assert.ok(typeof B.marketSnapshot === "function");
  assert.ok(typeof B.isValidSnapshot === "function");
  assert.ok(typeof B.evaluateDataStatus === "function");
  assert.ok(typeof B.saveBriefSnapshot === "function");
  assert.ok(typeof B.getBriefSnapshot === "function");
  assert.ok(typeof B.resolveTime === "function");
  assert.ok(typeof B.resolveHolidays === "function");
  assert.ok(typeof B.findLastTradeDate === "function");

  // ==========================================
  // A. 交易日與休市日測試（10 個案例）
  // ==========================================

  // A1. 正常交易日且行事曆已確認
  const a1 = B.sessionStatus("2026-10-27T02:00:00Z", { holidays: [], calendarStatus: "confirmed" });
  assert.equal(a1.session, "live");
  assert.equal(a1.calendarVerified, true);
  assert.equal(a1.isClosed, false);

  // A2. 週末（週六、週日）
  const a2Sat = B.sessionStatus("2026-10-24T06:00:00Z", { holidays: [] });
  assert.equal(a2Sat.session, "closed");
  assert.equal(a2Sat.label, "週末休市");
  assert.equal(a2Sat.isWeekend, true);
  assert.equal(a2Sat.isClosed, true);
  const a2Sun = B.sessionStatus("2026-10-25T06:00:00Z", { holidays: [] });
  assert.equal(a2Sun.session, "closed");
  assert.equal(a2Sun.label, "週末休市");
  assert.equal(a2Sun.isWeekend, true);

  // A3. 官方公告休市日（國定假日／補假）
  const a3 = B.sessionStatus("2026-10-26T06:00:00Z", { holidays: [{ date: "2026-10-26", name: "光復節補假" }] });
  assert.equal(a3.session, "closed");
  assert.equal(a3.label, "今日休市");
  assert.equal(a3.holidayName, "光復節補假");
  assert.equal(a3.isClosed, true);

  // A4. 臨時停市日（如颱風假）
  const a4 = B.sessionStatus("2026-10-02T02:00:00Z", { holidays: [{ date: "2026-10-02", name: "颱風停市" }] });
  assert.equal(a4.session, "closed");
  assert.equal(a4.reason, "颱風停市");
  assert.equal(a4.holidayName, "颱風停市");

  // A5. 明確傳入空行事曆（holidays: []）且未確認開市狀態
  const a5 = B.sessionStatus("2026-10-27T02:00:00Z", { holidays: [] });
  assert.equal(a5.session, "live");

  // A6. 完全沒有傳入行事曆（holidays: undefined）降級為待確認
  const a6 = B.sessionStatus("2026-10-27T02:00:00Z");
  assert.equal(a6.session, "unknown", "無任何日曆來源時降級為 unknown");
  assert.equal(a6.status, "pending");
  assert.equal(a6.calendarVerified, false);

  // A7. 沒有官方行事曆且無法確認當日是否交易
  const a7 = B.sessionStatus("2026-10-27T02:00:00Z", { calendarStatus: "unknown" });
  assert.equal(a7.session, "unknown");
  assert.equal(a7.isClosed, null);
  assert.match(a7.warning, /安全降級/);

  // A8. 休市日使用最近一個已確認交易日的行情
  const a8 = B.sessionStatus("2026-10-26T06:00:00Z", {
    holidays: [{ date: "2026-10-26", name: "光復節補假" }],
    lastTradeDate: "2026-10-23"
  });
  assert.match(a8.displayNote, /顯示最近交易日 10\/23 收盤/);
  assert.equal(a8.lastTradeDate, "2026-10-23");

  // A9. 行情來源日期與最近交易日不符
  const a9 = B.evaluateDataStatus({
    market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.1, date: "2026-10-20" } },
    session: "closed",
    tradeDate: "2026-10-26"
  });
  assert.equal(a9.dataStatus, "stale");
  assert.match(a9.reason, /2026-10-20/);

  // A10. 跨年、跨月及台灣時區日期邊界
  // UTC 2026-12-31 16:30 = TW 2027-01-01 00:30 (跨年且元旦休市)
  const a10 = B.sessionStatus("2026-12-31T16:30:00Z", { holidays: [{ date: "2027-01-01", name: "元旦" }] });
  assert.equal(a10.tradeDate, "2027-01-01");
  assert.equal(a10.session, "closed");
  assert.equal(a10.holidayName, "元旦");

  // ==========================================
  // B. 時間注入與時區一致性測試（5 個案例）
  // ==========================================

  // B1. 使用固定 now 可以得到可重現的結果
  const fixedNow = 1793088000000;
  const snapB1_1 = B.marketSnapshot({ now: fixedNow, holidays: [], calendarStatus: "confirmed" });
  const snapB1_2 = B.marketSnapshot({ now: fixedNow, holidays: [], calendarStatus: "confirmed" });
  assert.equal(snapB1_1.meta.asOf, snapB1_2.meta.asOf);
  assert.equal(snapB1_1.meta.tradeDate, snapB1_2.meta.tradeDate);

  // B2. 同一次計算中的 session 與 asOf 使用一致的時間基準
  const snapB2 = B.marketSnapshot({ now: "2026-10-27T00:30:00Z", holidays: [], calendarStatus: "confirmed" });
  assert.equal(snapB2.meta.session, "pre");
  assert.equal(snapB2.meta.asOf, "08:30:00");

  // B3. UTC 日期與台灣日期不同時，結果仍正確
  // UTC 2026-10-26 23:30 = TW 2026-10-27 07:30
  const snapB3 = B.marketSnapshot({ now: "2026-10-26T23:30:00Z", holidays: [], calendarStatus: "confirmed" });
  assert.equal(snapB3.meta.tradeDate, "2026-10-27");
  assert.equal(snapB3.meta.session, "pre");

  // B4. 歷史日期不會被當作目前交易日
  const snapB4 = B.marketSnapshot({ now: "2026-10-27T08:00:00Z", date: "2026-10-01", holidays: [], calendarStatus: "confirmed" });
  assert.equal(snapB4.meta.tradeDate, "2026-10-01");

  // B5. 日期跨日時，不會因重複讀取系統時間而產生矛盾（由 resolveTime 單次注入）
  const tResolved = B.resolveTime("2026-10-27T15:59:59.999Z");
  assert.equal(tResolved.twDate, "2026-10-27");
  assert.equal(tResolved.hm, "23:59");

  // ==========================================
  // C. 資料完整性與可信度評定測試（15 個案例）
  // ==========================================

  // C1. 完整且日期一致的官方資料
  const c1 = B.evaluateDataStatus({
    market: {
      taiex: { price: 23500, close: 23500, high: 23600, low: 23400, chgPct: 0.5, vol: 3500, date: "2026-10-27", source: "twse" },
      inst: { date: "2026-10-27", foreign: 100, trust: 20 }
    },
    session: "post",
    tradeDate: "2026-10-27"
  });
  assert.equal(c1.dataStatus, "official");
  assert.equal(c1.sourceVerified, true);

  // C2. 缺少加權指數
  const c2 = B.evaluateDataStatus({ market: {} });
  assert.equal(c2.dataStatus, "missing");
  assert.equal(c2.completeness, "none");

  // C3. 缺少行情日期
  const c3 = B.evaluateDataStatus({ market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0 } } });
  assert.equal(c3.dataStatus, "insufficient");
  assert.equal(c3.completeness, "missing_date");

  // C4. 行情日期格式錯誤
  const c4 = B.evaluateDataStatus({ market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0, date: "115/10/27" } } });
  assert.equal(c4.dataStatus, "corrupted");
  assert.equal(c4.completeness, "invalid_date");

  // C5. 漲跌幅缺失 (null / undefined)
  const c5 = B.evaluateDataStatus({ market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: null, date: "2026-10-27" } } });
  assert.equal(c5.dataStatus, "partial");
  assert.equal(c5.completeness, "missing_fields");

  // C6. 收盤價缺失或為 0
  const c6_1 = B.evaluateDataStatus({ market: { taiex: { high: 23100, low: 22900, chgPct: 0.1, date: "2026-10-27" } } });
  assert.equal(c6_1.dataStatus, "insufficient");
  const c6_2 = B.evaluateDataStatus({ market: { taiex: { price: 0, high: 23100, low: 22900, chgPct: 0.1, date: "2026-10-27" } } });
  assert.equal(c6_2.dataStatus, "insufficient");

  // C7. 成交量為負數
  const c7 = B.evaluateDataStatus({ market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.1, vol: -50, date: "2026-10-27" } } });
  assert.equal(c7.dataStatus, "corrupted");
  assert.equal(c7.completeness, "corrupted_volume");

  // C8. 高低價關係不合理 (high < low 或 close > high)
  const c8_1 = B.evaluateDataStatus({ market: { taiex: { price: 23000, high: 22800, low: 22900, chgPct: 0.5, date: "2026-10-27" } } });
  assert.equal(c8_1.dataStatus, "corrupted");
  const c8_2 = B.evaluateDataStatus({ market: { taiex: { price: 23500, high: 23400, low: 23300, chgPct: 0.5, date: "2026-10-27" } } });
  assert.equal(c8_2.dataStatus, "corrupted");

  // C9. 法人資料日期與指數日期不一致
  const c9 = B.evaluateDataStatus({
    market: {
      taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.2, date: "2026-10-27", source: "twse" },
      inst: { date: "2026-10-26", foreign: 50 }
    },
    session: "post",
    tradeDate: "2026-10-27"
  });
  assert.equal(c9.dataStatus, "partial");
  assert.equal(c9.completeness, "inst_date_mismatch");

  // C10. 法人資料過期（同 C9 標籤）
  assert.match(c9.reason, /籌碼日期（2026-10-26）與指數日期（2026-10-27）不一致/);

  // C11. 只有法人資料，但缺少必要指數資料
  const c11 = B.evaluateDataStatus({ market: { inst: { foreign: 50, date: "2026-10-27" } } });
  assert.equal(c11.dataStatus, "missing");

  // C12. 官方來源存在，但必要欄位不完整
  const c12 = B.evaluateDataStatus({ market: { taiex: { price: 23000, date: "2026-10-27", source: "twse" } }, session: "post", tradeDate: "2026-10-27" });
  assert.equal(c12.dataStatus, "partial");

  // C13. 第三方資料完整，但來源尚未驗證
  const c13 = B.evaluateDataStatus({
    market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.5, date: "2026-10-27", source: "some_unverified_api" }, inst: { foreign: 50 } },
    session: "post",
    tradeDate: "2026-10-27"
  });
  assert.equal(c13.dataStatus, "unverified");

  // C14. 沒有更新時間戳記 -> 仍保留未知，不編造
  const c14 = B.marketSnapshot({
    now: "2026-10-27T08:00:00Z",
    market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.5, date: "2026-10-27", source: "twse" } },
    holidays: [],
    calendarStatus: "confirmed"
  });
  assert.equal(c14.meta.updatedAt, null, "無更新時間時不編造時間戳");

  // C15. 使用最近交易日資料，但今日為休市日
  const c15 = B.evaluateDataStatus({
    market: { taiex: { price: 23000, high: 23100, low: 22900, chgPct: 0.5, date: "2026-10-23" } },
    session: "closed",
    tradeDate: "2026-10-24"
  });
  assert.equal(c15.dataStatus, "stale");
  assert.equal(c15.dataStatusLabel, "休市資料");

  // ==========================================
  // D. 快照保存與客觀情境驗證測試（12 個案例）
  // ==========================================
  const planD = B.briefScenarios({}, "2026-10-27", 23400);

  // D1. 當日有效快照
  assert.ok(B.isValidSnapshot(planD, "2026-10-27"));

  // D2. 日期不符的快照
  assert.equal(B.isValidSnapshot(planD, "2026-10-28"), false);

  // D3. 缺少日期的快照
  assert.equal(B.isValidSnapshot({ keyLevels: planD.keyLevels, scenarios: planD.scenarios }), false);

  // D4. 快照欄位不完整
  assert.equal(B.isValidSnapshot({ tradeDate: "2026-10-27", keyLevels: { pressure: 100 } }), false);

  // D5. 快照儲存失敗時不假裝成功
  const failingStore = { get: () => null, set: () => { throw new Error("quota exceeded"); } };
  assert.equal(B.saveBriefSnapshot("2026-10-27", planD, failingStore), false);

  // D6. 預判日期與行情日期不符
  const d6 = B.validatePlan(planD, { price: 23500, high: 23600, low: 23400, date: "2026-10-26" });
  assert.equal(d6.status, "date_mismatch");

  // D7. 缺少收盤價
  const d7 = B.validatePlan(planD, { high: 23600, low: 23400, date: "2026-10-27" });
  assert.equal(d7.status, "insufficient_data");

  // D8. 缺少高低點
  const d8 = B.validatePlan(planD, { price: 23500, date: "2026-10-27" });
  assert.equal(d8.status, "insufficient_data");

  // D9. 漲跌幅未知 -> 正常驗證但標註漲跌幅未知，不預設為 0
  const d9 = B.validatePlan(planD, { price: planD.keyLevels.pivot + 20, high: planD.keyLevels.pressure - 10, low: planD.keyLevels.pivot - 10, chgPct: null, date: "2026-10-27" });
  assert.equal(d9.status, "verified");
  assert.match(d9.analysisText, /漲跌幅未知/);

  // D10. 僅部分情境條件成立（收盤過分水嶺但未達壓力）
  const d10 = B.validatePlan(planD, { price: planD.keyLevels.pivot + 20, high: planD.keyLevels.pressure - 10, low: planD.keyLevels.pivot - 10, chgPct: 0.3, date: "2026-10-27" });
  assert.equal(d10.metKey, "bull");
  assert.equal(d10.pressureHit, false);
  assert.match(d10.outcomeLabel, /多方觀察/);

  // D11. 完整情境成立（收盤高於分水嶺且觸及壓力）
  const d11 = B.validatePlan(planD, { price: planD.keyLevels.pivot + 50, high: planD.keyLevels.pressure + 20, low: planD.keyLevels.pivot, chgPct: 0.8, date: "2026-10-27" });
  assert.equal(d11.pressureHit, true);
  assert.match(d11.outcomeLabel, /部分符合/);

  // D12. 情境條件不成立（跌破支撐）
  const d12 = B.validatePlan(planD, { price: planD.keyLevels.support - 30, high: planD.keyLevels.pivot - 10, low: planD.keyLevels.support - 50, chgPct: -1.2, date: "2026-10-27" });
  assert.equal(d12.metKey, "bear");
  assert.equal(d12.supportHit, true);
});



test("Phase 5 最終缺陷修正：早報結論真實資料、量能驗證、資料完整度、日曆快照防護", () => {
  const B = engine().B;

  // ==========================================
  // E. 早報結論必須由有效資料產生 (dailyBriefSummaryHtml)
  // ==========================================
  const planE = B.briefScenarios({}, "2026-10-27", 23000);

  // E1. 全部缺失 (G 為空或缺少美股與期貨)
  const hE1 = B.dailyBriefSummaryHtml({}, planE);
  assert.match(hE1, /資料不足，暫不判定/);
  assert.match(hE1, /缺少必要行情：費半指數行情、台指期夜盤行情/);
  assert.doesNotMatch(hE1, /行情已更新/);
  assert.doesNotMatch(hE1, /國際半導體指數強勢/);
  assert.doesNotMatch(hE1, /夜盤期貨維持正向溢價/);

  // E2. 費半缺失、期貨存在
  const hE2 = B.dailyBriefSummaryHtml({
    fut: { night: { price: 23100, chg: 80 } }
  }, planE);
  assert.match(hE2, /資料不足，暫不判定/);
  assert.match(hE2, /缺少必要行情：費半指數行情/);
  assert.doesNotMatch(hE2, /台指期夜盤走揚/);

  // E3. 期貨缺失、費半存在
  const hE3 = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 1.5 }] }
  }, planE);
  assert.match(hE3, /資料不足，暫不判定/);
  assert.match(hE3, /缺少必要行情：台指期夜盤行情/);
  assert.doesNotMatch(hE3, /費城半導體上漲/);

  // E4. 過期資料 (stale = true)
  const hE4 = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 1.5, stale: true }] },
    fut: { night: { price: 23100, chg: 80 } }
  }, planE);
  assert.match(hE4, /資料不足，暫不判定/);
  assert.match(hE4, /費半指數過期資料/);

  // E5. 真實零漲跌 (費半 0.00%、期貨 0 點)
  const hE5 = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5000, chgPct: 0.0 }] },
    fut: { night: { price: 23000, chg: 0 } }
  }, planE);
  assert.doesNotMatch(hE5, /資料不足/);
  assert.match(hE5, /平盤（0\.00% \/ 0 點）/);
  assert.match(hE5, /費城半導體收在平盤（0.00%）/);

  // E6. 走勢矛盾 (費半大漲 +1.8%，夜盤期貨重挫 -150 點)
  const hE6 = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5200, chgPct: 1.8 }] },
    fut: { night: { price: 22850, chg: -150 } }
  }, planE);
  assert.match(hE6, /美股與期貨走勢分歧/);
  assert.match(hE6, /訊號相互抵銷/);

  // E7. 有效完整資料 (費半上漲 +1.2%，期貨上漲 +80 點)
  const hE7 = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5150, chgPct: 1.2 }] },
    fut: { night: { price: 23080, chg: 80 } }
  }, planE);
  assert.match(hE7, /台指期夜盤走揚 \+80 點/);
  assert.match(hE7, /費城半導體上漲 \+1.20%/);

  // ==========================================
  // F. 成交量必須真正參與驗證，或明確標示未驗證 (validatePlan)
  // ==========================================
  const planF = B.briefScenarios({}, "2026-10-27", 23000);

  // F1. 缺失成交量數據
  const f1 = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27" });
  assert.equal(f1.volumeStatus, "missing");
  assert.equal(f1.volumeConfirmed, false);
  assert.match(f1.volumeLabel, /缺少成交量數據/);

  // F2. 成交量為 0
  const f2 = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, volume: 0, date: "2026-10-27" });
  assert.equal(f2.volumeStatus, "zero_volume");
  assert.equal(f2.volumeConfirmed, false);
  assert.match(f2.volumeLabel, /成交量為 0/);

  // F3. 成交量無效 (負數、NaN、Infinity)
  const f3a = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, volume: -100, date: "2026-10-27" });
  assert.equal(f3a.volumeStatus, "invalid");
  assert.equal(f3a.volumeConfirmed, false);
  const f3b = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, volume: NaN, date: "2026-10-27" });
  assert.equal(f3b.volumeStatus, "invalid");

  // F4. 有成交量但無均量比較基準 -> 明確標示「量能未驗證（缺少均量比較基準）」
  const f4 = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, volume: 350000, date: "2026-10-27" });
  assert.equal(f4.volumeStatus, "unverified");
  assert.equal(f4.volumeConfirmed, false);
  assert.match(f4.volumeLabel, /缺少均量比較基準/);

  // F4b. 雖有名稱如 avgVolume 但缺少中繼資料 (單位/期間/來源/時間) -> 安全降級為未驗證
  const f4b = B.validatePlan(planF, { price: 23100, high: 23200, low: 22950, chgPct: 0.4, volume: 4000, avgVolume: 3000, date: "2026-10-27" });
  assert.equal(f4b.volumeStatus, "unverified");
  assert.equal(f4b.volumeConfirmed, false);
  assert.match(f4b.volumeLabel, /缺少單位中繼資料/);

  // F5. 成交量達標量能確認 (實際 4000 億，5 日均量 3000 億 -> 133%，且單位與期間中繼資料齊全驗證)
  const f5 = B.validatePlan(planF, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4,
    volume: 4000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma",
    date: "2026-10-27"
  });
  assert.equal(f5.volumeStatus, "confirmed");
  assert.equal(f5.volumeConfirmed, true);
  assert.equal(f5.volumeRatio, 1.33);
  assert.match(f5.volumeLabel, /量能已確認（達.*基準量 133%）/);

  // F6. 成交量未達標量能不足 (實際 2000 億，5 日均量 3000 億 -> 67%)
  const f6 = B.validatePlan(planF, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4,
    volume: 2000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma",
    date: "2026-10-27"
  });
  assert.equal(f6.volumeStatus, "below_average");
  assert.equal(f6.volumeConfirmed, false);
  assert.equal(f6.volumeRatio, 0.67);
  assert.match(f6.volumeLabel, /量能未確認（量能不足，僅達.*基準量 67%）/);

  // F7. 價格結構與量能確認分開呈現：突破壓力但量能不足
  const f7 = B.validatePlan(planF, {
    price: planF.keyLevels.pressure + 10, high: planF.keyLevels.pressure + 20, low: planF.keyLevels.pivot, chgPct: 1.1,
    volume: 2000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma",
    date: "2026-10-27"
  });
  assert.equal(f7.metKey, "bull");
  assert.equal(f7.pressureHit, true);
  assert.equal(f7.volumeConfirmed, false);
  assert.match(f7.analysisText, /多方推進情境/);
  assert.match(f7.analysisText, /量能未確認/);

  // F8. validateHtml 畫面渲染量能狀態
  const valHtml = B.validateHtml(f5, planF);
  assert.match(valHtml, /量能判定：/);
  assert.match(valHtml, /量能已確認/);

  // ==========================================
  // G. 統一資料完整度定義 (briefScenarios, coreMarketCardsHtml)
  // ==========================================

  // G1. coreMarketCardsHtml: price 為 0、負數、NaN、Infinity -> 顯示「資料暫缺」
  const badCardsHtml = B.coreMarketCardsHtml({
    taiex: { price: 0, date: "2026-10-27" }
  }, {
    fut: { night: { price: NaN, chg: 50 } },
    us: { indices: [{ code: "^SOX", price: Infinity, chgPct: 1.2 }, { code: "^IXIC", price: -100, chgPct: 0.5 }] }
  }, { isClosed: false }, { dataStatusLabel: "即時資料" });

  assert.match(badCardsHtml, /data-dhcode="T00"[^]*?資料暫缺/);
  assert.match(badCardsHtml, /data-dhcode="TXF"[^]*?資料暫缺/);
  assert.match(badCardsHtml, /data-dhcode="\^SOX"[^]*?資料暫缺/);
  assert.match(badCardsHtml, /data-dhcode="\^IXIC"[^]*?資料暫缺/);

  // G2. coreMarketCardsHtml: 價格有效但漲跌幅缺失 -> 顯示「漲跌幅未知」，不可預設為 0%
  const noChgCardHtml = B.coreMarketCardsHtml({
    taiex: { price: 23200, chgPct: null, date: "2026-10-27" }
  }, {}, { isClosed: false }, { dataStatusLabel: "即時資料" });
  assert.match(noChgCardHtml, /漲跌幅未知/);
  assert.doesNotMatch(noChgCardHtml, /\+0\.00%/);

  // G3. briefScenarios: 必要指標缺失時 macroStatus 絕不能為 complete_macro
  const bsNoSox = B.briefScenarios({
    us: { indices: [{ code: "^IXIC", price: 18000, chgPct: 1.0 }] },
    fut: { night: { price: 23000, chg: 50 } }
  }, "2026-10-27", 23000);
  assert.equal(bsNoSox.macroStatus, "partial_macro");
  assert.match(bsNoSox.macroNote, /部分必要美股\/期貨資料缺失/);

  // G4. briefScenarios: 必要指標齊全但缺少選配 TSM -> partial_macro
  const bsNoTsm = B.briefScenarios({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 1.5 }, { code: "^IXIC", price: 18000, chgPct: 1.0 }] },
    fut: { night: { price: 23000, chg: 50 } }
  }, "2026-10-27", 23000);
  assert.equal(bsNoTsm.macroStatus, "partial_macro");
  assert.match(bsNoTsm.macroNote, /缺少 TSM 選配行情/);

  // G5. briefScenarios: 必要指標 + 選配 TSM 全數齊全 -> complete_macro
  const bsComplete = B.briefScenarios({
    us: {
      indices: [{ code: "^SOX", price: 5100, chgPct: 1.5 }, { code: "^IXIC", price: 18000, chgPct: 1.0 }],
      megas: [{ code: "TSM", price: 195, chgPct: 2.0 }]
    },
    fut: { night: { price: 23000, chg: 50 } }
  }, "2026-10-27", 23000);
  assert.equal(bsComplete.macroStatus, "complete_macro");
  assert.match(bsComplete.macroNote, /國際行情與選配指標完整/);

  // ==========================================
  // H. 官方交易日曆與快照防護
  // ==========================================

  // H1. 交易日曆連線失敗 (failed) -> sessionStatus 回傳 unknown，採安全降級處理，不假定為正常交易日
  const sessCalFail = B.sessionStatus("2026-10-27T02:00:00Z", {
    calendarStatus: "failed"
  });
  assert.equal(sessCalFail.session, "unknown");
  assert.equal(sessCalFail.calendarVerified, false);
  assert.equal(sessCalFail.calendarStatus, "failed");
  assert.match(sessCalFail.warning, /官方交易日曆連線失敗/);

  // H2. 特殊休市（如颱風假動態休市日傳入） -> 正確判定今日休市，不硬編碼
  const sessTyphoon = B.sessionStatus("2026-10-27T02:00:00Z", {
    holidays: [{ date: "2026-10-27", name: "颱風天然災害停止上班" }],
    calendarStatus: "confirmed"
  });
  assert.equal(sessTyphoon.session, "closed");
  assert.equal(sessTyphoon.isClosed, true);
  assert.equal(sessTyphoon.reason, "颱風天然災害停止上班");

  // H3. 快照覆寫防護：已存在有效快照時，拒絕二次寫入
  const mockStore = new Map();
  const storeAdapter = {
    get: (k) => mockStore.get(k) || null,
    set: (k, v) => { mockStore.set(k, v); }
  };
  const snap1 = B.briefScenarios({}, "2026-10-27", 23000);
  const save1 = B.saveBriefSnapshot("2026-10-27", snap1, storeAdapter);
  assert.equal(save1, true, "首次儲存原始快照成功");

  // 試圖用另一個快照覆寫
  const snap2 = B.briefScenarios({}, "2026-10-27", 23800);
  const save2 = B.saveBriefSnapshot("2026-10-27", snap2, storeAdapter);
  assert.equal(save2, false, "已存在原始快照時拒絕覆寫");
  assert.equal(storeAdapter.get("watch:brief:snap:2026-10-27").keyLevels.pivot, snap1.keyLevels.pivot, "原始快照維持不變");

  // H4. 跨交易日快照防護：若快照日期與分析交易日不符，拒絕儲存
  const crossDaySnap = B.briefScenarios({}, "2026-10-26", 23000);
  const saveCrossDay = B.saveBriefSnapshot("2026-10-27", crossDaySnap, storeAdapter);
  assert.equal(saveCrossDay, false, "跨交易日快照拒絕儲存");
});

test('Phase 6 最終修正：台指期漲跌點數真實依據、成交量比較基準驗證與安全降級', () => {
  const B = engine().B;
  const plan = B.briefScenarios({}, "2026-10-27", 23000);

  // ==========================================
  // 1. 修正 A：台指期漲跌點數真實依據（禁止固定乘數、優先實際點數、基準缺失安全降級）
  // ==========================================

  // 1a. 只有漲跌幅 (chgPct: 1.0) 但無實際點數且無有效基準價 -> 不得使用 1.0 * 200 = 200 點推算，必須顯示「夜盤漲跌點數未知」
  const summaryNoPrev = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23200, chgPct: 1.0, chg: null, prev: null } }
  }, plan);
  assert.match(summaryNoPrev, /夜盤漲跌點數未知/);
  assert.doesNotMatch(summaryNoPrev, /200\s*點/);
  assert.doesNotMatch(summaryNoPrev, /走揚 \+200/);

  // 1b. 只有漲跌幅但有有效現價與可對應前收基準價 (現價 23150, 前收 23000) -> 正確推算點數差 +150 點
  const summaryWithPrev = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: "TXF202611", prevContract: "TXF202611" } }
  }, plan);
  assert.match(summaryWithPrev, /台指期夜盤走揚 \+150 點/);

  // 1c. 前收基準無效 (prev: 0, prev: NaN, prev: -100) -> 顯示夜盤漲跌點數未知
  const summaryInvalidPrev = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 0 } }
  }, plan);
  assert.match(summaryInvalidPrev, /夜盤漲跌點數未知/);

  // 1d. 合約不符 (換月合約，contract != prevContract) -> 拒絕逕行相減，顯示夜盤漲跌點數未知
  const summaryContractMismatch = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: "TXF202612", prevContract: "TXF202611" } }
  }, plan);
  assert.match(summaryContractMismatch, /夜盤漲跌點數未知/);

  // 1e. 優先採用來源提供之實際有限漲跌點數 (fut.chg: -85)
  const summaryActualChg = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23000, chg: -85, chgPct: -0.37 } }
  }, plan);
  assert.match(summaryActualChg, /台指期夜盤走跌 -85 點/);

  // ==========================================
  // 2. 修正 B：成交量比較基準驗證（單位一致性、期間相容性、時間有效性、來源可靠性）
  // ==========================================

  // 2a. 單位不一致：實際量以股數（shares）提供，均量以張數（lots）提供 -> 拒絕直接比對，安全降級為未驗證
  const vUnitMismatch = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 350000000, volumeUnit: "shares", volumePeriod: "full_day",
    baselineVolume: 350000, baselineUnit: "lots", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma"
  });
  assert.equal(vUnitMismatch.volumeStatus, "unverified");
  assert.equal(vUnitMismatch.volumeConfirmed, false);
  assert.match(vUnitMismatch.volumeLabel, /實際量與均量單位不一致：shares vs lots/);
  assert.match(vUnitMismatch.volumeReason, /實際量單位（shares）與均量單位（lots）不符/);

  // 2b. 比較期間不相容：盤中累積量（intraday）直接與全日均量（full_day）比較 -> 拒絕直接判定，安全降級為未驗證
  const vPeriodMismatch = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 1500, volumeUnit: "billion", volumePeriod: "intraday",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma"
  });
  assert.equal(vPeriodMismatch.volumeStatus, "unverified");
  assert.equal(vPeriodMismatch.volumeConfirmed, false);
  assert.match(vPeriodMismatch.volumeLabel, /盤中累積量不可直接與全日均量比較/);
  assert.match(vPeriodMismatch.volumeReason, /盤中累積量未換算，不可直接與全日均量比較/);

  // 2c. 均量基準缺少時間或來源不明 -> 安全降級為未驗證
  const vNoTimeSource = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 4000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: null, baselineSource: null
  });
  assert.equal(vNoTimeSource.volumeStatus, "unverified");
  assert.equal(vNoTimeSource.volumeConfirmed, false);
  assert.match(vNoTimeSource.volumeLabel, /缺少均量基準有效日期/);

  const vNoSource = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 4000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: null
  });
  assert.equal(vNoSource.volumeStatus, "unverified");
  assert.match(vNoSource.volumeLabel, /缺少均量基準來源/);
  assert.match(vNoSource.volumeReason, /缺少均量計算來源/);

  // 2d. 均量基準日期異常（基準日期晚於實際行情日期，存在未來偷看風險） -> 拒絕採用
  const vFutureBaseline = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 4000, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-28", baselineSource: "twse_5ma"
  });
  assert.equal(vFutureBaseline.volumeStatus, "unverified");
  assert.equal(vFutureBaseline.volumeConfirmed, false);
  assert.match(vFutureBaseline.volumeLabel, /均量基準日期晚於行情日期/);

  // 2e. 有效且同單位、同期間、來源與日期驗證通過之比較基準 -> 正確計算比率並判定已確認
  const vConfirmed = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 4500, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma"
  });
  assert.equal(vConfirmed.volumeStatus, "confirmed");
  assert.equal(vConfirmed.volumeConfirmed, true);
  assert.equal(vConfirmed.volumeRatio, 1.5);
  assert.match(vConfirmed.volumeLabel, /量能已確認（達.*基準量 150%）/);

  // 2f. UI validateHtml 明確呈現狀態標籤與未驗證樣式
  const htmlUnverified = B.validateHtml(vUnitMismatch, plan);
  assert.match(htmlUnverified, /class="note"[^>]*>量能未驗證（實際量與均量單位不一致/);

  const htmlConfirmed = B.validateHtml(vConfirmed, plan);
  assert.match(htmlConfirmed, /class="up"[^>]*>量能已確認（達.*基準量 150%）/);

  const vBelow = B.validatePlan(plan, {
    price: 23100, high: 23200, low: 22950, chgPct: 0.4, date: "2026-10-27",
    volume: 2400, volumeUnit: "billion", volumePeriod: "full_day",
    baselineVolume: 3000, baselineUnit: "billion", baselinePeriod: "full_day",
    baselineDate: "2026-10-26", baselineSource: "twse_5ma"
  });
  const htmlBelow = B.validateHtml(vBelow, plan);
  assert.match(htmlBelow, /class="down"[^>]*>量能未確認（量能不足，僅達.*基準量 80%）/);
});

test('Phase 6.1 獨立驗收缺口修正：合約代碼完整驗證、均量有效期限政策與中繼嚴格性', () => {
  const B = engine().B;
  const plan = B.briefScenarios({}, "2026-10-27", 23000);

  // ==========================================
  // 1. 台指期合約代碼嚴格驗證 (Section 2)
  // ==========================================

  // 1a. 合約代碼兩者皆存在且相同 -> 正確相減計算點數差 (+150 點)
  const sContractSame = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: "TXF202611", prevContract: "TXF202611" } }
  }, plan);
  assert.match(sContractSame, /台指期夜盤走揚 \+150 點/);

  // 1b. 合約代碼兩者不一致 (換月合約 TXF202612 vs TXF202611) -> 拒絕相減，回傳夜盤漲跌點數未知
  const sContractMismatch = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: "TXF202612", prevContract: "TXF202611" } }
  }, plan);
  assert.match(sContractMismatch, /夜盤漲跌點數未知/);
  assert.doesNotMatch(sContractMismatch, /走揚 \+150/);

  // 1c. 現價合約代碼缺失 (contract 為 null 或空字串) -> 拒絕相減，回傳夜盤漲跌點數未知
  const sCurContractMissing = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: null, prevContract: "TXF202611" } }
  }, plan);
  assert.match(sCurContractMissing, /夜盤漲跌點數未知/);

  // 1d. 前收合約代碼缺失 (prevContract 為 null 或空字串) -> 拒絕相減，回傳夜盤漲跌點數未知
  const sPrevContractMissing = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 23000, contract: "TXF202611", prevContract: "" } }
  }, plan);
  assert.match(sPrevContractMissing, /夜盤漲跌點數未知/);

  // 1e. 前收價格無效 (prev 為 0, NaN, -100) -> 拒絕相減，回傳夜盤漲跌點數未知
  const sPrevPriceZero = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: 0, contract: "TXF202611", prevContract: "TXF202611" } }
  }, plan);
  assert.match(sPrevPriceZero, /夜盤漲跌點數未知/);

  const sPrevPriceNaN = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23150, chgPct: 0.65, prev: NaN, contract: "TXF202611", prevContract: "TXF202611" } }
  }, plan);
  assert.match(sPrevPriceNaN, /夜盤漲跌點數未知/);

  // 1f. 真實點數有效 (chg: -85 或 changePoints: +120) -> 優先直接採用真實點數
  const sDirectChg = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23000, chg: -85, chgPct: -0.37 } }
  }, plan);
  assert.match(sDirectChg, /台指期夜盤走跌 -85 點/);

  const sChangePoints = B.dailyBriefSummaryHtml({
    us: { indices: [{ code: "^SOX", price: 5100, chgPct: 0.8 }] },
    fut: { night: { price: 23120, changePoints: 120, chgPct: 0.52 } }
  }, plan);
  assert.match(sChangePoints, /台指期夜盤走揚 \+120 點/);

  // ==========================================
  // 2. 成交量基準有效期限政策與中繼嚴格性 (Section 3)
  // ==========================================

  // 2a. 有效基準 (twse_5ma 在 7 天內，同為 full_day，單位同為 billion) -> 驗證通過，確認量能
  const vValid = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vValid.volumeStatus, "confirmed");
  assert.equal(vValid.volumeConfirmed, true);
  assert.equal(vValid.volumeRatio, 1.2);
  assert.match(vValid.volumeLabel, /量能已確認（達全日基準量 120%）/);

  // 2b. 過期基準 (twse_5ma 基準日 2026-10-15 距離行情日 2026-10-27 達 12 天 > 7 天) -> 回傳 unverified
  const vExpired5ma = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-15", source: "twse_5ma" }
  });
  assert.equal(vExpired5ma.volumeStatus, "unverified");
  assert.equal(vExpired5ma.volumeConfirmed, false);
  assert.match(vExpired5ma.volumeLabel, /量能未驗證（均量基準已過期）/);
  assert.match(vExpired5ma.volumeReason, /已超過 5日均量基準 之 7 天上限/);

  // 2c. 未來日期 (基準日 2026-10-28 晚於行情日 2026-10-27) -> 回傳 unverified
  const vFutureDate = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-28", source: "twse_5ma" }
  });
  assert.equal(vFutureDate.volumeStatus, "unverified");
  assert.match(vFutureDate.volumeLabel, /均量基準日期晚於行情日期/);

  // 2d. 缺少來源 (source 為 null 或空字串) -> 回傳 unverified
  const vMissingSource = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: null }
  });
  assert.equal(vMissingSource.volumeStatus, "unverified");
  assert.match(vMissingSource.volumeLabel, /缺少均量基準來源/);

  // 2e. 來源不明 (source 不在受信政策清單中，如 random_blog) -> 回傳 unverified
  const vUntrustedSource = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "random_blog" }
  });
  assert.equal(vUntrustedSource.volumeStatus, "unverified");
  assert.match(vUntrustedSource.volumeLabel, /均量基準來源不明/);
  assert.match(vUntrustedSource.volumeReason, /未在受信基準來源清單中/);

  // 2f. 缺少期間 (未提供 baselinePeriod，且不得自動預設為 full_day) -> 回傳 unverified
  const vMissingPeriod = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vMissingPeriod.volumeStatus, "unverified");
  assert.match(vMissingPeriod.volumeLabel, /缺少期間中繼資料/);
  assert.match(vMissingPeriod.volumeReason, /不可逕行假定為全日成交量/);

  // 2g. 缺少單位 (未提供 baselineUnit) -> 回傳 unverified
  const vMissingUnit = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vMissingUnit.volumeStatus, "unverified");
  assert.match(vMissingUnit.volumeLabel, /缺少單位中繼資料/);

  // 2h. 盤中對全日 (intraday vs full_day) -> 回傳 unverified
  const vIntradayVsFull = B.verifyVolumeStatus({
    volume: 1800, volumeUnit: "billion", volumePeriod: "intraday", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vIntradayVsFull.volumeStatus, "unverified");
  assert.match(vIntradayVsFull.volumeLabel, /盤中累積量不可直接與全日均量比較/);

  // 2i. 全日對全日 (full_day vs full_day，且未達均量) -> 正確判定 below_average
  const vBelowFull = B.verifyVolumeStatus({
    volume: 2400, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vBelowFull.volumeStatus, "below_average");
  assert.equal(vBelowFull.volumeConfirmed, false);
  assert.equal(vBelowFull.volumeRatio, 0.8);
  assert.match(vBelowFull.volumeLabel, /量能未確認（量能不足，僅達全日基準量 80%）/);

  // 2j. 20日均量有效期限政策 (twse_20ma 上限 14 天：10 天有效，16 天過期)
  const v20maValid = B.verifyVolumeStatus({
    volume: 3300, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-17", source: "twse_20ma" }
  });
  assert.equal(v20maValid.volumeStatus, "confirmed");

  const v20maExpired = B.verifyVolumeStatus({
    volume: 3300, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-10", source: "twse_20ma" }
  });
  assert.equal(v20maExpired.volumeStatus, "unverified");
  assert.match(v20maExpired.volumeLabel, /量能未驗證（均量基準已過期）/);
  assert.match(v20maExpired.volumeReason, /已超過 20日均量基準 之 14 天上限/);

  // 2k. 來源白名單防護：含有受信字串（如 twse 或 5ma）但非白名單識別碼者一律拒絕
  const vFakeTwse = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_unauthorized_scraper" }
  });
  assert.equal(vFakeTwse.volumeStatus, "unverified");
  assert.match(vFakeTwse.volumeLabel, /均量基準來源不明/);
  assert.match(vFakeTwse.volumeReason, /未在受信基準來源清單中/);

  const vFake5ma = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "unverified_5ma" }
  });
  assert.equal(vFake5ma.volumeStatus, "unverified");
  assert.match(vFake5ma.volumeLabel, /均量基準來源不明/);

  // 2l. 白名單來源期間相容性限制：twse_5ma 不支援 intraday 期間
  const vTwse5maIntraday = B.verifyVolumeStatus({
    volume: 1800, volumeUnit: "billion", volumePeriod: "intraday", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 1500, unit: "billion", period: "intraday", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vTwse5maIntraday.volumeStatus, "unverified");
  assert.match(vTwse5maIntraday.volumeLabel, /比較期間不相容/);
  assert.match(vTwse5maIntraday.volumeReason, /不支援期間「intraday」/);

  // 2m. 白名單來源 snapshot 支援 intraday 期間
  const vSnapshotIntraday = B.verifyVolumeStatus({
    volume: 1800, volumeUnit: "billion", volumePeriod: "intraday", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 1500, unit: "billion", period: "intraday", date: "2026-10-27", source: "snapshot" }
  });
  assert.equal(vSnapshotIntraday.volumeStatus, "confirmed");
  assert.equal(vSnapshotIntraday.volumeConfirmed, true);
  assert.equal(vSnapshotIntraday.volumeRatio, 1.2);

  // 2n. 過期精確邊界測試 (Boundary Tests)
  // 5ma: 正好 7 天有效 (2026-10-20 至 2026-10-27)
  const v5maBoundaryValid = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-20", source: "twse_5ma" }
  });
  assert.equal(v5maBoundaryValid.volumeStatus, "confirmed");

  // 5ma: 超過 7 天 (8 天即過期, 2026-10-19 至 2026-10-27)
  const v5maBoundaryExpired = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-19", source: "twse_5ma" }
  });
  assert.equal(v5maBoundaryExpired.volumeStatus, "unverified");
  assert.match(v5maBoundaryExpired.volumeLabel, /均量基準已過期/);

  // snapshot: 正好 4 天有效 (涵蓋週末或連假跨期, 2026-10-23 至 2026-10-27)
  const vSnapBoundaryValid = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-23", source: "snapshot" }
  });
  assert.equal(vSnapBoundaryValid.volumeStatus, "confirmed");

  // snapshot: 超過 4 天 (5 天即過期, 2026-10-22 至 2026-10-27)
  const vSnapBoundaryExpired = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-22", source: "snapshot" }
  });
  assert.equal(vSnapBoundaryExpired.volumeStatus, "unverified");
  assert.match(vSnapBoundaryExpired.volumeLabel, /均量基準已過期/);

  // official: 正好 7 天有效 (2026-10-20 至 2026-10-27)
  const vOfficialBoundaryValid = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-20", source: "twse_official" }
  });
  assert.equal(vOfficialBoundaryValid.volumeStatus, "confirmed");

  // official: 超過 7 天 (8 天即過期)
  const vOfficialBoundaryExpired = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-19", source: "twse_official" }
  });
  assert.equal(vOfficialBoundaryExpired.volumeStatus, "unverified");

  // 20ma: 正好 14 天有效 (2026-10-13 至 2026-10-27)
  const v20maBoundaryValid = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-13", source: "twse_20ma" }
  });
  assert.equal(v20maBoundaryValid.volumeStatus, "confirmed");

  // 20ma: 超過 14 天 (15 天即過期, 2026-10-12 至 2026-10-27)
  const v20maBoundaryExpired = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-12", source: "twse_20ma" }
  });
  assert.equal(v20maBoundaryExpired.volumeStatus, "unverified");

  // 2o. 無效日期測試 (Invalid Date)
  // 行情日期為非法日期 (2026-99-99)
  const vInvalidActualDate = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-99-99"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vInvalidActualDate.volumeStatus, "unverified");
  assert.match(vInvalidActualDate.volumeLabel, /日期格式無效/);

  // 基準日期為無效字串 (invalid-date)
  const vInvalidBaseDate = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "invalid-date", source: "twse_5ma" }
  });
  assert.equal(vInvalidBaseDate.volumeStatus, "unverified");
  assert.match(vInvalidBaseDate.volumeLabel, /缺少均量基準有效日期/);

  // 2p. 缺少單位測試 (Missing Units)
  // 實際行情缺少單位
  const vMissingActualUnit = B.verifyVolumeStatus({
    volume: 3600, volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vMissingActualUnit.volumeStatus, "unverified");
  assert.match(vMissingActualUnit.volumeLabel, /缺少單位中繼資料/);

  // 基準量缺少單位
  const vMissingBaseUnit = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vMissingBaseUnit.volumeStatus, "unverified");
  assert.match(vMissingBaseUnit.volumeLabel, /缺少單位中繼資料/);

  // 單位不一致 (shares vs billion)
  const vUnitMismatch2 = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "shares", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "twse_5ma" }
  });
  assert.equal(vUnitMismatch2.volumeStatus, "unverified");
  assert.match(vUnitMismatch2.volumeLabel, /實際量與均量單位不一致/);

  // 2q. 期間不相容測試 (Period Incompatibility)
  // actual full_day vs base intraday
  const vFullVsIntraday = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "intraday", date: "2026-10-27", source: "snapshot" }
  });
  assert.equal(vFullVsIntraday.volumeStatus, "unverified");
  assert.match(vFullVsIntraday.volumeLabel, /比較期間不相容/);

  // 2r. 不可信來源防護 (Untrusted Source)
  const vUntrustedOther = B.verifyVolumeStatus({
    volume: 3600, volumeUnit: "billion", volumePeriod: "full_day", date: "2026-10-27"
  }, {
    volumeBaseline: { volume: 3000, unit: "billion", period: "full_day", date: "2026-10-26", source: "5ma_unofficial" }
  });
  assert.equal(vUntrustedOther.volumeStatus, "unverified");
  assert.match(vUntrustedOther.volumeLabel, /均量基準來源不明/);
});

test("休市日判斷：前端 mktSession／twDayState 與伺服器 session 一致，休市日表抓不到時是「不知道」", async () => {
  const vm = await import("node:vm"), { readFileSync } = await import("node:fs");
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : stub), apply: () => stub, construct: () => stub }); // 和 scripts/_engine.mjs 一樣：畫面相關的全域用空殼
  const c = { console, Math, Date, JSON, Map, Set, Array, Object, Number, String, isFinite, parseFloat, parseInt, setTimeout, clearTimeout, Promise, document: stub, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: { userAgent: "" }, location: { protocol: "file:" } };
  c.window = c; vm.createContext(c); vm.runInContext(readFileSync(new URL("../learner/core.js", import.meta.url), "utf8") + ";this.F={mktSession,twDayState,twHolSet,twDayMark,TWHOL};", c);
  const { mktSession, twDayState, twHolSet, twDayMark, TWHOL } = c.F, at = (d, hm) => new Date(`${d}T${hm}:00+08:00`);
  const reset = () => Object.assign(TWHOL, { set: null, year: "", at: 0, mark: null });
  const { session } = await import("../api/_lib/quote.js"), { holLoad, holState, holOk, closedHol } = await import("../api/_lib/calendar.js");
  const HOL = [{ date: "2026-01-01", name: "開國紀念日", note: "" }, { date: "2026-10-27", name: "測試假日", note: "" }, { date: "2026-10-28", name: "國曆新年開始交易日", note: "" }, { date: "2026-10-29", name: "", note: "農曆春節前最後交易日" }];
  // 1. 還沒拿到表：平日是「不知道」，mktSession 照舊只看時間（回傳格式不變）；週末一定休市
  reset();
  assert.equal(twDayState(at("2026-10-26", "10:00")), "unknown"); assert.equal(mktSession(at("2026-10-26", "10:00")), "open");
  assert.equal(twDayState(at("2026-10-25", "10:00")), "closed"); assert.equal(mktSession(at("2026-10-25", "10:00")), "closed");
  // 2. 表抓失敗（空的）、格式錯（沒有日期）、過期（沒有今年）：都不算拿到
  for (const bad of [[], null, [{ name: "x" }], [{ date: "2025-01-01", name: "去年" }]]) { assert.equal(twHolSet(bad, at("2026-10-26", "10:00")), false); assert.equal(twDayState(at("2026-10-26", "10:00")), "unknown"); }
  assert.equal(holOk([], "2026"), false); assert.equal(holOk([{ date: "2025-12-31" }], "2026"), false);
  // 3. 拿到表：平日交易日 trade；表上的休市日 closed；「開始交易日」「最後交易日」是有開盤的日子
  assert.equal(twHolSet(HOL, at("2026-10-26", "10:00")), true);
  assert.equal(twDayState(at("2026-10-26", "10:00")), "trade"); assert.equal(twDayState(at("2026-10-27", "10:00")), "closed");
  assert.equal(twDayState(at("2026-10-28", "10:00")), "trade"); assert.equal(twDayState(at("2026-10-29", "10:00")), "trade");
  assert.deepEqual(closedHol(HOL).map(x => x.date), ["2026-01-01", "2026-10-27"]);
  // 4. 交易時段邊界（程式定義：08:30–09:00 試撮、09:00–13:35 盤中，13:35 這一分鐘還算盤中）
  const B = { "08:29": "closed", "08:30": "pre", "08:59": "pre", "09:00": "open", "13:25": "open", "13:30": "open", "13:35": "open", "13:36": "closed", "14:00": "closed" };
  for (const [hm, want] of Object.entries(B)) { assert.equal(mktSession(at("2026-10-26", hm)), want, `交易日 ${hm}`); assert.equal(mktSession(at("2026-10-27", hm)), "closed", `休市日 ${hm}`); }
  // 5. 伺服器 session() 用同一份表，對同一個時間的判斷和前端一樣（週末、交易日、休市日、開始交易日、各個邊界）
  assert.equal(holLoad(HOL, +at("2026-10-26", "10:00")), true); assert.equal(holState("2026-10-27"), "closed"); assert.equal(holState("2026-10-26"), "trade");
  for (const d of ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]) for (const hm of Object.keys(B)) assert.equal(session(at(d, hm)), mktSession(at(d, hm)), `${d} ${hm}`);
  // 6. 報價佐證：表抓不到時，加權的日期是今天就確定開盤；跨日不沿用前一天的佐證
  reset(); twDayMark("2026-10-26", "trade");
  assert.equal(twDayState(at("2026-10-26", "11:00")), "trade"); assert.equal(twDayState(at("2026-10-27", "09:00")), "unknown");
  twDayMark("2026-10-27", "closed"); assert.equal(twDayState(at("2026-10-27", "10:00")), "closed"); assert.equal(mktSession(at("2026-10-27", "10:00")), "closed");
  // 7. 表上的休市日不會被報價佐證蓋掉（休市日不會有「今天」的加權報價）
  twHolSet(HOL, at("2026-10-27", "10:00")); twDayMark("2026-10-27", "trade"); assert.equal(twDayState(at("2026-10-27", "10:00")), "closed");
});

test("決策中心：盤後分析跟報價不同一天時提醒結論依據哪一天（Gemini DEF-02）", () => {
  const { tdStaleNote } = engine().B;
  assert.match(tdStaleNote("2026-10-29", "2026-10-28", "post"), /盤後分析更新中：目前結論依據 2026-10-28 收盤資料，最新報價為 2026-10-29/);
  assert.match(tdStaleNote("2026-10-29", "2026-10-28", "closed"), /盤後分析更新中/, "週末打開也要提醒");
  assert.equal(tdStaleNote("2026-10-29", "2026-10-29", "post"), "", "同一天不提醒");
  assert.equal(tdStaleNote("2026-10-29", "2026-10-28", "live"), "", "盤中的盤後分析本來就是前一天的");
  assert.equal(tdStaleNote("2026-10-29", "2026-10-28", "pre"), "");
  assert.equal(tdStaleNote(null, "2026-10-28", "post"), "", "沒有報價日期不亂提醒");
  assert.equal(tdStaleNote("2026-10-29", undefined, "post"), "");
});

test("決策中心整理：下一交易日、開始交易日不算休市、只清過期的推演快照", () => {
  const { findNextTradeDate, findLastTradeDate, sessionStatus, briefSnapGc } = engine().B;
  const HOL = [{ date: "2026-10-26", name: "測試假日" }, { date: "2026-10-28", name: "國曆新年開始交易日" }];
  assert.equal(findNextTradeDate("2026-10-23", []), "2026-10-26", "週五的下一交易日是週一");
  assert.equal(findNextTradeDate("2026-10-24", HOL), "2026-10-27", "週一休市就跳到週二");
  assert.equal(findNextTradeDate("2026-10-27", HOL), "2026-10-28", "「開始交易日」有開盤");
  assert.equal(findLastTradeDate("2026-10-27", HOL), "2026-10-23");
  const at = (d, hm) => new Date(`${d}T${hm}:00+08:00`).getTime();
  assert.equal(sessionStatus(at("2026-10-28", "10:00"), { holidays: HOL }).session, "live", "開始交易日不是休市");
  assert.equal(sessionStatus(at("2026-10-26", "10:00"), { holidays: HOL }).session, "closed");
  // 快照清理：只刪鍵名格式完全符合、超過 20 天的；其他資料（筆記、自選、格式不符的鍵）都不動
  const M = new Map([["kline:watch:brief:snap:2026-09-01", "{}"], ["kline:watch:brief:snap:2026-10-20", "{}"], ["kline:watch:brief:snap:2026-09-01x", "{}"], ["kline:watch:notes", "{}"], ["kline:watch:list", "[]"], ["other:brief:snap:2026-09-01", "{}"]]);
  const ls = { get length() { return M.size; }, key: i => [...M.keys()][i], removeItem: k => M.delete(k) };
  briefSnapGc.done = false; assert.equal(briefSnapGc(at("2026-10-25", "10:00"), ls), 1);
  assert.deepEqual([...M.keys()].sort(), ["kline:watch:brief:snap:2026-09-01x", "kline:watch:brief:snap:2026-10-20", "kline:watch:list", "kline:watch:notes", "other:brief:snap:2026-09-01"]);
  assert.equal(briefSnapGc(at("2026-10-25", "10:00"), ls), 0, "一次載入只清一次");
});

test("盤中監控 M1：偵測規則、同一件事升級不重開、資料過期不判斷、通知節流、只清自己的資料", () => {
  const { monFresh, monScan, monMerge, monRule, monData, monShouldNotify, monHash, monGc, monStatus } = engine().M, today = "2026-10-26", now = Date.parse("2026-10-26T10:00:30+08:00");
  const q = (code, price, prev, x = {}) => ({ code, price, prev, chgPct: +((price / prev - 1) * 100).toFixed(2), date: today, time: "10:00:00", ...x });
  // 報價可不可以用：今天、有成交、不是估價、3 分鐘內
  assert.equal(monFresh(q("2330", 100, 99), today, now), true);
  assert.equal(monFresh(q("2330", 100, 99, { date: "2026-10-23" }), today, now), false, "前一天的報價");
  assert.equal(monFresh(q("2330", 100, 99, { estimated: true }), today, now), false, "估價");
  assert.equal(monFresh(q("2330", 100, 99, { time: "09:55:00" }), today, now), false, "超過 3 分鐘");
  const Q = new Map([["T00", q("T00", 97.7, 100)], ["9999", q("9999", 92, 100)], ["2330", q("2330", 110, 100)], ["1101", q("1101", 101, 100)], ["0050", q("0050", 95, 100, { time: "09:50:00" })]]);
  const codes = [{ c: "2330", hold: true }, { c: "9999", hold: false }, { c: "1101", hold: false }, { c: "0050", hold: false }];
  const cand = monScan(Q, { today, codes, now, names: { 2330: "台積電" } }), by = Object.fromEntries(cand.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(by).sort(), ["2026-10-26:IDX:T00:dn", "2026-10-26:SYM:2330:up", "2026-10-26:SYM:9999:dn"], "1101 只漲 1%、0050 報價過期都不算");
  assert.equal(by["2026-10-26:IDX:T00:dn"].level, 2); assert.equal(by["2026-10-26:IDX:T00:dn"].sev, "watch");
  assert.match(by["2026-10-26:SYM:2330:up"].title, /庫存 台積電 漲停/); assert.equal(by["2026-10-26:SYM:2330:up"].sev, "alert");
  assert.equal(by["2026-10-26:SYM:9999:dn"].level, 2, "跌 8%＝超過 7%"); assert.equal(by["2026-10-26:SYM:9999:dn"].sev, "alert", "個股超過 7% 是警示");
  // 合併：新的開一件；同一件同等級不重複；升級更新同一件
  const E = {}; assert.equal(monMerge(E, cand, now).length, 3); assert.equal(monMerge(E, cand, now + 20e3).length, 0, "同等級不重複");
  Q.set("T00", q("T00", 96.5, 100)); const up = monMerge(E, monScan(Q, { today, codes, now }), now + 40e3);
  assert.equal(up.length, 1); assert.equal(Object.keys(E).length, 3, "升級不開新事件"); assert.equal(E["2026-10-26:IDX:T00:dn"].level, 3); assert.equal(E["2026-10-26:IDX:T00:dn"].snaps.length, 2);
  // 關鍵價位：穿越才算（上一輪在另一邊）
  const plan = { tradeDate: today, keyLevels: { pressure: 23300, pivot: 23200, support: 23100 } };
  assert.equal(monScan(new Map([["T00", q("T00", 23150, 23300)]]), { today, plan, prevPx: { T00: 23210 }, now }).some(x => x.id.endsWith("LEVEL:T00:pivot-dn")), true);
  assert.equal(monScan(new Map([["T00", q("T00", 23150, 23300)]]), { today, plan, prevPx: { T00: 23160 }, now }).some(x => x.type === "LEVEL"), false, "沒有穿越");
  assert.equal(monScan(new Map([["T00", q("T00", 23150, 23300)]]), { today, plan: { ...plan, tradeDate: "2026-10-23" }, prevPx: { T00: 23210 }, now }).some(x => x.type === "LEVEL"), false, "不拿別天的推演");
  // 提醒與資料異常
  assert.ok(monRule(E, today, "2330", "到價提醒：台積電漲到 110", "110", now)); assert.equal(monRule(E, today, "2330", "到價提醒：台積電漲到 110", "110", now), null, "同一個提醒只記一次");
  monData(E, today, true, "證交所逾時", now); assert.equal(E["2026-10-26:DATA:src:fail"].state, "open"); monData(E, today, false, "", now + 1); assert.equal(E["2026-10-26:DATA:src:fail"].state, "closed");
  // 通知：只推警示、同一檔 15 分鐘一則、一天最多 20 則
  const e1 = E["2026-10-26:SYM:2330:up"]; assert.equal(monShouldNotify(E["2026-10-26:IDX:T00:dn"], E, now), true, "跌 3%＝警示");
  assert.equal(monShouldNotify({ ...e1, sev: "watch" }, E, now), false);
  e1.notified.push({ ch: "local", at: now, ok: true }); assert.equal(monShouldNotify({ ...e1, id: "x" }, E, now + 60e3), false, "15 分鐘內同一檔"); assert.equal(monShouldNotify({ ...e1, id: "x" }, E, now + 16 * 60e3), true);
  const F = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, { code: String(i), notified: [{ ch: "local", at: now, ok: true }] }])); assert.equal(monShouldNotify({ code: "9", sev: "alert" }, F, now + 3600e3), false, "一天 20 則");
  for (const x of Object.values(F)) x.notified[0].ch = "tg"; assert.equal(monShouldNotify({ code: "9", sev: "alert" }, F, now + 3600e3), true, "伺服器的 Telegram 推播不算這台的次數");
  assert.match(monHash("a"), /^[0-9a-f]{8}$/); assert.notEqual(monHash("a"), monHash("b"));
  // 狀態：七種文字都不同
  const S = [{ day: "closed" }, { day: "unknown" }, { day: "trade", sess: "pre" }, { day: "trade", sess: "open", hidden: true }, { day: "trade", sess: "open", err: "x" }, { day: "trade", sess: "open", staleN: 2, lastOk: 1 }, { day: "trade", sess: "open" }, { day: "trade", sess: "open", lastOk: 1 }].map(o => monStatus(o)[0]);
  assert.deepEqual(S, ["closed", "unknown", "closed", "paused", "error", "stale", "loading", "on"]);
  // 清理：只刪 kline:watch:mon:v1:日期、超過 20 天的
  const M = new Map([["kline:watch:mon:v1:2026-09-01", "{}"], ["kline:watch:mon:v1:2026-10-20", "{}"], ["kline:watch:mon:v2:2026-09-01", "{}"], ["kline:watch:alerts", "{}"], ["kline:watch:list", "[]"]]);
  assert.equal(monGc(now, { get length() { return M.size; }, key: i => [...M.keys()][i], removeItem: k => M.delete(k) }), 1);
  assert.deepEqual([...M.keys()].sort(), ["kline:watch:alerts", "kline:watch:list", "kline:watch:mon:v1:2026-10-20", "kline:watch:mon:v2:2026-09-01"]);
});

import { memKv, monNotify, runOnce, scrub } from "../scripts/monitor.mjs";
import { monPublic, monRuns } from "../api/_lib/sync.js";
// 伺服器巡檢的測試環境：記憶體 KV、假的 Telegram、假的報價（時間跟著這一輪的 now）、假的休市日表；全部不連網
const J = x => JSON.parse(JSON.stringify(x)); // 沙盒（vm）裡建的陣列和這裡的原型不同，比對前先轉成一般資料
const M2_HOL = [{ date: "2026-01-01", name: "開國紀念日" }, { date: "2026-10-09", name: "國慶日補假" }];
const at8 = s => Date.parse(`${s}+08:00`);
function m2World({ users: U, hol = M2_HOL, px: P } = {}) {
  const users = U || { u1: { chat: "c1", ev: { on: ["mon"], mon: ["2330"] } }, u2: { chat: "c2", ev: { on: ["mon"], mon: ["9999"] } }, u3: { chat: "c3", ev: { on: ["close"], mon: [] } } };
  const base = memKv(), W = { users, sent: [], qCalls: 0, hCalls: 0, cur: 0, px: P || { T00: 97.5, 2330: 110, 9999: 101 }, bad: new Set(), hol, quoteOf: null };
  W.kv = async (cmd, k, ...a) => (cmd === "SMEMBERS" && k === "alerts" ? Object.keys(users) : cmd === "GET" && /^alert:/.test(k) ? JSON.stringify(users[k.slice(6)]) : base(cmd, k, ...a));
  W.tg = async (m, b) => { if (W.bad.has(b.chat_id)) throw new Error("Forbidden: bot was blocked by the user"); W.sent.push(b.chat_id); };
  W.q = c => { const p = W.px[c] ?? 100; return { code: c, name: "股" + c, price: p, prev: 100, chgPct: +((p / 100 - 1) * 100).toFixed(2), date: engine().T.twIso(new Date(W.cur)), time: engine().M.monTime(W.cur) }; };
  W.quotes = async codes => { W.qCalls++; return codes.map(c => (W.quoteOf ? W.quoteOf(c) : W.q(c))).filter(Boolean); };
  W.holidays = async () => { W.hCalls++; if (W.hol instanceof Error) throw W.hol; return W.hol; };
  W.run = (now, o = {}) => { W.cur = now; return runOnce({ kv: W.kv, tg: W.tg, quotes: W.quotes, holidays: W.holidays, now, log: () => {}, ...o }); };
  W.runs = async (d = "2026-10-26") => monRuns(await W.kv("HGETALL", `mon:${d}:runs`));
  return W;
}

test("盤中監控 M2：推播範圍、重跑不重複、升級、只通知持有的人、Telegram 失敗後重試、來源失敗、公開資料不含使用者", async () => {
  const t0 = at8("2026-10-26T10:00:30");
  // 推播清單：盤中警示的範圍是庫存台股＋自選台股（範例庫存、美股不算）；沒勾就沒有
  const doc = alertDoc({ "kline:watch:evalert": JSON.stringify({ mon: true }), "kline:watch:hold": JSON.stringify({ 2330: { sh: 1 }, 2454: { demo: true }, AAPL: { sh: 1 } }), "kline:watch:groups": JSON.stringify([{ list: ["9999", "TSLA"] }]) }, "c1");
  assert.deepEqual(doc.ev.mon.sort(), ["2330", "9999"]); assert.equal(docHas(doc), true);
  assert.deepEqual(alertDoc({ "kline:watch:hold": JSON.stringify({ 2330: { sh: 1 } }) }, "c1").ev.mon, []);
  await assert.rejects(memKv()("SADD", "x"), /不支援/, "記憶體替身遇到沒寫的指令要丟錯，不能默默忽略");
  const W = m2World();
  // 第一輪：大盤跌 2.5%（注意，不推）、2330 漲停（警示，只推給 u1；u3 沒勾盤中警示）
  let r = await W.run(t0);
  assert.deepEqual(J(r.up.map(e => e.id).sort()), ["2026-10-26:IDX:T00:dn", "2026-10-26:SYM:2330:up"]); assert.deepEqual(W.sent, ["c1"]);
  assert.match(r.up.find(e => e.code === "2330").title, /^股2330 漲停$/, "伺服器的標題不分庫存／自選");
  // 同一事件重複巡檢（排程重送、重試）：不開新事件、不重複通知
  r = await W.run(t0 + 60e3); assert.equal(r.up.length, 0); assert.deepEqual(W.sent, ["c1"]);
  // 大盤升級到跌 3%（警示）：人人都收；同一件只升級
  W.px.T00 = 96.8; r = await W.run(t0 + 120e3);
  assert.deepEqual(J(r.up.map(e => e.id)), ["2026-10-26:IDX:T00:dn"]); assert.deepEqual([...W.sent].sort(), ["c1", "c1", "c2"]);
  const E = monPublic(await W.kv("HGETALL", "mon:2026-10-26")); assert.equal(E.length, 2, "存起來的只有事件（上一輪價格不算）");
  const ix = E.find(e => e.id.endsWith("IDX:T00:dn")); assert.equal(ix.level, 3); assert.equal(ix.snaps.length, 2); assert.deepEqual(ix.notified.map(n => [n.ch, n.ok, n.n]), [["tg", true, 2]]);
  assert.ok(!/c1|c2|u1|u2/.test(JSON.stringify(E)), "公開的事件不含 chat id 或使用者");
  assert.equal(await W.kv("TTL", "mon:2026-10-26"), 30 * 86400, "事件 30 天過期");
  // Telegram 失敗：記在事件的 notified、不扣額度、不佔冷卻；下一輪自動重試，成功後不再送
  W.bad.add("c2"); W.px[9999] = 91; r = await W.run(t0 + 30 * 60e3);
  const e9 = r.up.find(x => x.code === "9999"); assert.equal(e9.sev, "alert"); assert.deepEqual(J(e9.notified.map(n => [n.ok, n.err])), [[false, "Forbidden: bot was blocked by the user"]]);
  assert.equal(r.stat.retry, 1); assert.equal(await W.kv("GET", "moncnt:u2:2026-10-26"), "1", "失敗不扣額度（只有之前大盤那一則）"); assert.equal(await W.kv("GET", "moncd:u2:9999"), null, "失敗不佔冷卻");
  W.bad.delete("c2"); r = await W.run(t0 + 31 * 60e3);
  assert.equal(r.up.length, 0, "沒有新事件"); assert.equal(r.stat.ok, 1, "重試名單裡的那則送出去了"); assert.equal(W.sent.filter(c => c === "c2").length, 2);
  assert.equal(await W.kv("GET", "moncnt:u2:2026-10-26"), "2"); assert.deepEqual(J(monPublic(await W.kv("HGETALL", "mon:2026-10-26")).find(e => e.code === "9999").notified.map(n => n.ok)), [false, true]);
  r = await W.run(t0 + 32 * 60e3); assert.equal(W.sent.filter(c => c === "c2").length, 2, "送成功後不再重送"); assert.deepEqual(r.stat, {});
  // 來源失敗：不產生事件，連續失敗次數往上加；成功後歸零
  const fail = async () => { throw new Error("證交所逾時"); };
  for (let i = 0; i < 3; i++) assert.equal((await W.run(t0 + (40 + i) * 60e3, { quotes: fail })).error, "證交所逾時");
  let R = await W.runs(); assert.equal(R.streak, 3); assert.equal(R.err, "證交所逾時");
  assert.equal(engine().M.monSrvState(R, t0 + 43 * 60e3)[0], "down"); assert.match(engine().M.monSrvState(R, t0 + 43 * 60e3)[1], /最後成功 10:32:30/);
  await W.run(t0 + 45 * 60e3); R = await W.runs(); assert.equal(R.streak, 0); assert.equal(engine().M.monSrvState(R, t0 + 46 * 60e3)[0], "ok");
  assert.equal(engine().M.monSrvState(R, t0 + 70 * 60e3)[0], "late"); assert.equal(engine().M.monSrvState(null)[0], "off");
  // 網頁合併伺服器事件：沒有的加進來、等級高的升級、這台已有的不重複
  const { monSrvMerge } = engine().M, L = { [ix.id]: { ...ix, level: 2, sev: "watch", origin: "client" } };
  assert.equal(monSrvMerge(L, [...E, { id: "bad", sev: "evil" }]), 2); assert.equal(L[ix.id].level, 3); assert.equal(L[ix.id].origin, "client", "這台原本就有的保留來源");
  assert.equal(Object.values(L).find(x => x.code === "2330").origin, "server"); assert.equal(monSrvMerge(L, E), 0, "重複合併沒有變動");
});

test("盤中監控 M2 通知：去重、15 分鐘冷卻、每天 20 則（算成功的）、失敗重試最多 3 次、並行只送一次、KV 出錯不送", async () => {
  const d = "2026-10-26", e = { id: "x", code: "2330", level: 2, sev: "alert" };
  let n = 0; const ok = async () => { n++; }, boom = async () => { n++; throw new Error("Telegram HTTP 502"); };
  // 成功、同一件同等級不再送、注意等級不推
  let kv = memKv(); assert.equal(await monNotify(kv, "h", e, d, ok), "ok"); assert.equal(await monNotify(kv, "h", e, d, ok), "dup"); assert.equal(n, 1);
  assert.equal(await monNotify(kv, "h", { ...e, id: "w", sev: "watch" }, d, ok), "skip");
  // 升級到更高等級：是新的一則，但同一檔 15 分鐘內只送一則；冷卻過了才送
  assert.equal(await monNotify(kv, "h", { ...e, level: 3 }, d, ok), "cd"); assert.equal(await monNotify(kv, "h", { ...e, level: 3 }, d, ok), "dup", "被冷卻擋下的不會之後補送");
  assert.equal(await monNotify(kv, "h", { ...e, id: "y" }, d, ok), "cd", "同一檔別的事件也擋"); assert.equal(await monNotify(kv, "h2", { ...e, id: "y" }, d, ok), "ok", "冷卻是每個人各自算");
  assert.equal(await kv("TTL", "moncd:h:2330"), 900); await kv("DEL", "moncd:h:2330"); // 15 分鐘到了（記憶體 KV 不會自己過期）
  assert.equal(await monNotify(kv, "h", { ...e, id: "z", level: 3 }, d, ok), "ok"); assert.equal(n, 3);
  // 每天 20 則，算送成功的：失敗不扣額度；第 21 則擋下
  kv = memKv(); n = 0; const many = i => ({ ...e, id: "q" + i, code: "c" + i });
  for (let i = 0; i < 3; i++) assert.equal(await monNotify(kv, "h", many(100 + i), d, boom), "retry");
  assert.equal(await kv("GET", "moncnt:h:2026-10-26"), "0", "失敗的都退回額度");
  let okN = 0; for (let i = 0; i < 25; i++) if ((await monNotify(kv, "h", many(i), d, ok)) === "ok") okN++;
  assert.equal(okN, 20); assert.equal(await kv("GET", "moncnt:h:2026-10-26"), "20", "滿了就退回，停在 20"); assert.equal(await monNotify(kv, "h", many(99), d, ok), "quota");
  assert.equal(await kv("TTL", "moncnt:h:2026-10-26"), 2 * 86400); assert.equal(await kv("GET", "moncd:h:c99"), null, "額度滿了不佔冷卻");
  // 失敗重試：最多 3 次，之後記成 fail 不再送；每次失敗都放掉冷卻與額度
  kv = memKv(); n = 0;
  assert.deepEqual([await monNotify(kv, "h", e, d, boom), await monNotify(kv, "h", e, d, boom), await monNotify(kv, "h", e, d, boom), await monNotify(kv, "h", e, d, ok)], ["retry", "retry", "fail", "dup"]);
  assert.equal(n, 3, "重試不會無限送"); assert.equal(await kv("GET", "monsent:h:x:2"), "fail"); assert.equal(await kv("GET", "moncnt:h:2026-10-26"), "0"); assert.deepEqual(await kv("HGETALL", "monretry:h:2026-10-26"), [], "放棄後離開重試名單");
  assert.equal(await monNotify(kv, "h", { ...e, id: "x2" }, d, ok), "ok", "失敗沒有佔住同一檔的冷卻");
  // 並行：同一個人同一件事件同時處理 5 次，只送 1 次
  kv = memKv(); n = 0; const slow = async () => { n++; await new Promise(r => setTimeout(r, 5)); };
  assert.deepEqual((await Promise.all(Array.from({ length: 5 }, () => monNotify(kv, "h", e, d, slow)))).sort(), ["dup", "dup", "dup", "dup", "ok"]); assert.equal(n, 1);
  // 兩次巡檢同時跑：每個人每件只收到一次
  const W = m2World(); W.cur = at8("2026-10-26T10:00:30"); await Promise.all([W.run(W.cur), W.run(W.cur)]); assert.deepEqual(W.sent, ["c1"]);
  // KV 出錯（逾時）：不送出；佔住的都放掉，修好後可以送
  const flaky = (bad) => { const k = memKv(); return async (cmd, ...a) => { if (bad(cmd, a[0])) throw new Error("KV HTTP 504"); return k(cmd, ...a); }; };
  n = 0; let down = true; kv = flaky((c, k) => down && c === "INCR");
  assert.equal(await monNotify(kv, "h", e, d, ok), "kverr"); assert.equal(n, 0); assert.equal(await kv("GET", "moncd:h:2330"), null, "冷卻放掉"); assert.equal(await kv("GET", "monsent:h:x:2"), null, "處理鎖放掉");
  down = false; assert.equal(await monNotify(kv, "h", e, d, ok), "ok"); assert.equal(n, 1);
  kv = flaky(c => c === "SET"); assert.equal(await monNotify(kv, "h", e, d, ok), "kverr", "拿不到處理鎖就不送"); assert.equal(n, 1);
  // 送出去之後才記錄失敗：不重送（不在重試名單）
  kv = flaky((c, k) => c === "SET" && /^monsent/.test(k) && down); const k0 = kv; down = false; n = 0;
  const kvAfter = async (cmd, k, ...a) => { if (cmd === "SET" && /^monsent/.test(k) && String(a[0]).startsWith("ok:")) throw new Error("KV HTTP 504"); return k0(cmd, k, ...a); };
  assert.equal(await monNotify(kvAfter, "h", e, d, ok), "ok"); assert.equal(await monNotify(kvAfter, "h", e, d, ok), "dup"); assert.equal(n, 1);
  // 錯誤訊息不帶 Bot Token
  assert.equal(scrub(new Error("fetch https://api.telegram.org/bot123456:ABCdef_ghi-jkl/sendMessage failed")), "fetch https://api.telegram.org/bot***/sendMessage failed");
});

test("盤中監控 M2 交易日：和 P1 同一套休市判斷；休市、日表拿不到、不在盤中都不抓報價；加權報價不是今天的不算成功", async () => {
  const W = m2World(), run = async (s, o) => { const q = W.qCalls; const r = await W.run(at8(s), o); return { ...r, q: W.qCalls - q }; };
  // 正常交易日盤中：抓報價、記一次成功
  let r = await run("2026-10-26T10:00:30"); assert.equal(r.q, 1); assert.equal(r.skipped, undefined); assert.ok((await W.runs()).lastOk);
  // 開盤前、收盤後、週六、週日：連休市日表都不抓
  const h0 = W.hCalls;
  for (const [s, why] of [["2026-10-26T08:45:00", "session"], ["2026-10-26T13:40:00", "session"], ["2026-10-24T10:00:00", "weekend"], ["2026-10-25T10:00:00", "weekend"]]) { r = await run(s); assert.equal(r.skipped, why, s); assert.equal(r.q, 0, s); }
  assert.equal(W.hCalls, h0, "非盤中不必抓休市日表");
  // 平日國定休市日：不抓報價，記下略過原因
  r = await run("2026-10-09T10:00:00"); assert.equal(r.skipped, "closed"); assert.equal(r.q, 0); assert.equal((await W.runs("2026-10-09")).skip, "closed");
  assert.match(engine().M.monSrvState(await W.runs("2026-10-09"), at8("2026-10-09T10:01:00"))[1], /伺服器巡檢暫停：今天休市/);
  // 休市日表不存在、拿不到、只有去年的（過期）、格式不對：交易日待確認，保守不巡檢
  for (const hol of [null, [], new Error("HTTP 503"), [{ date: "2025-12-31", name: "去年" }], "壞掉的", [{ name: "沒有日期" }], [{ date: 20260101 }]]) {
    W.hol = hol; r = await run("2026-10-27T10:00:00"); assert.equal(r.skipped, "unknown", JSON.stringify(String(hol))); assert.equal(r.q, 0);
  }
  assert.equal((await W.runs("2026-10-27")).skip, "unknown"); assert.match(engine().M.monSrvState(await W.runs("2026-10-27"), at8("2026-10-27T10:01:00"))[1], /交易日待確認/);
  // 日表把「開始交易日」列進去：那天有開盤
  W.hol = [...M2_HOL, { date: "2026-10-28", name: "國曆新年開始交易日" }]; r = await run("2026-10-28T10:00:00"); assert.equal(r.skipped, undefined); assert.equal(r.q, 1);
  // 加權報價缺失：整輪失敗、不產生事件；加權報價不是今天的：當成休市，不算成功
  W.hol = M2_HOL; W.quoteOf = c => (c === "T00" ? null : W.q(c)); r = await run("2026-10-29T10:00:00"); assert.match(r.error, /加權指數沒有報價/); assert.equal(r.up, undefined);
  assert.equal((await W.runs("2026-10-29")).streak, 1); assert.equal((await W.runs("2026-10-29")).lastOk, 0);
  W.quoteOf = c => ({ ...W.q(c), date: "2026-10-29" }); r = await run("2026-10-30T10:00:00"); assert.equal(r.skipped, "notoday"); assert.equal((await W.runs("2026-10-30")).lastOk, 0, "不算成功巡檢");
  assert.deepEqual(monPublic(await W.kv("HGETALL", "mon:2026-10-30")), [], "沒有事件"); W.quoteOf = null;
  // 和網頁（core.js）、伺服器報價 API（quote.js 的 session）判斷一致
  const { T } = engine(), { session } = await import("../api/_lib/quote.js"), { holLoad, holState } = await import("../api/_lib/calendar.js");
  Object.assign(T.TWHOL, { set: null, year: "", mark: null }); assert.equal(T.twHolSet(M2_HOL, new Date(at8("2026-10-26T10:00:00"))), true); assert.equal(holLoad(M2_HOL, at8("2026-10-26T10:00:00")), true);
  for (const s of ["2026-10-08T10:00:00", "2026-10-09T10:00:00", "2026-10-09T08:40:00", "2026-10-10T10:00:00", "2026-10-12T08:45:00", "2026-10-12T09:00:00", "2026-10-12T13:35:00", "2026-10-12T13:36:00"]) {
    const t = new Date(at8(s)), wd = t.getUTCDay();
    assert.equal(T.mktSession(t), session(t), `網頁與伺服器的時段一致 ${s}`);
    if (wd % 6) assert.equal(T.twDayState(t), holState(s.slice(0, 10)), `休市日一致 ${s}`);
  }
  Object.assign(T.TWHOL, { set: null, year: "", mark: null });
});

test("盤中監控 報價完整度：每一檔都要檢查；缺漏、過期、非今日、價格無效的不判斷也不通知；部分成功和整輪失敗分開", async () => {
  const { monCheck, monAudit, monAuditTxt, monScan, monStatus } = engine().M, d = "2026-10-26", now = at8("2026-10-26T10:00:30");
  const q = (x = {}) => ({ code: "2330", price: 110, prev: 100, chgPct: 10, date: d, time: "10:00:00", ...x });
  const C = [[q(), "ok"], [null, "missing"], [q({ date: null }), "nodate"], [q({ time: null }), "notime"], [q({ time: "abc" }), "notime"], [q({ time: "09:56:00" }), "stale"], [q({ date: "2026-10-23" }), "notoday"],
    [q({ price: null }), "price"], [q({ price: "110" }), "price"], [q({ price: NaN }), "price"], [q({ price: 0 }), "price"], [q({ price: -5 }), "price"], [q({ prev: 0 }), "price"], [q({ estimated: true }), "estimated"]];
  for (const [x, want] of C) assert.equal(monCheck(x, d, now), want, JSON.stringify(x));
  // 一輪的完整度：缺一檔、過期一檔
  const Q = new Map([["T00", q({ code: "T00", price: 96, chgPct: -4 })], ["2330", q()], ["9999", q({ code: "9999", price: 90, chgPct: -10, time: "09:50:00" })]]);
  const A = monAudit(Q, ["T00", "2330", "9999", "1101"], d, now); assert.deepEqual(J(A), { n: 4, ok: 2, badN: 2, bad: { stale: ["9999"], missing: ["1101"] }, t00: "ok" });
  assert.equal(monAuditTxt(A), "超過 3 分鐘沒更新 1 檔、沒有報價 1 檔");
  // 過期的 9999 跌 10% 也不判斷（不會變成警示或通知）
  assert.deepEqual(J(monScan(Q, { today: d, codes: [{ c: "2330" }, { c: "9999" }, { c: "1101" }], now }).map(x => x.code)).sort(), ["2330", "T00"]);
  // 狀態列：寫出受影響的檔數，不說「監控中」
  const st = monStatus({ day: "trade", sess: "open", lastOk: 1, audit: A, staleN: 2 }); assert.equal(st[0], "stale"); assert.match(st[1], /2／4 檔報價有問題（超過 3 分鐘沒更新 1 檔、沒有報價 1 檔），這些先不判斷，不代表它們沒有事件/);
  assert.match(monStatus({ day: "trade", sess: "open", lastOk: 1, audit: monAudit(new Map(), ["T00"], d, now) })[1], /加權指數報價沒有報價，大盤先不判斷/);
  assert.equal(monStatus({ day: "trade", sess: "open", lastOk: 1, audit: monAudit(Q, ["T00", "2330"], d, now) })[0], "on", "全部有效才是監控中");
  // 伺服器：一批失敗＝那批代號算缺漏（部分成功），其他照樣判斷；執行紀錄寫出檔數
  const many = Array.from({ length: 45 }, (_, i) => String(3000 + i)), W = m2World({ users: { u1: { chat: "c1", ev: { on: ["mon"], mon: ["2330", ...many] } } } });
  let call = 0; const quotes = async codes => { if (call++ === 1) throw new Error("證交所逾時"); return codes.map(W.q); };
  const r = await W.run(now, { quotes }); assert.equal(r.audit.badN, 7, "第二批 7 檔（47 檔分成 40＋7）"); assert.deepEqual(J(r.up.map(e => e.code)).sort(), ["2330", "T00"]);
  const R = await W.runs(); assert.equal(R.badN, 7); assert.equal(R.streak, 0); assert.ok(R.lastOk, "部分成功也記最後成功時間"); assert.match(R.badTxt, /沒有報價 7 檔/);
  const S = engine().M.monSrvState(R, now + 60e3); assert.equal(S[0], "partial"); assert.match(S[1], /7 檔報價有問題/);
  // 過期的報價重跑也不會變成事件或通知
  const W2 = m2World(); W2.quoteOf = c => ({ ...W2.q(c), time: "09:00:00" }); assert.match((await W2.run(now)).error, /加權指數超過 3 分鐘沒更新/); assert.deepEqual(W2.sent, []);
  W2.quoteOf = c => (c === "2330" ? { ...W2.q(c), time: "09:00:00" } : W2.q(c)); for (let i = 0; i < 3; i++) await W2.run(now + i * 60e3); assert.deepEqual(W2.sent, [], "2330 漲停但報價過期：不通知");
});

test("位置燈號回測：每天只用開盤前的資料、換月不相減、配係數只用訓練期", () => {
  const tw = []; let p = 20000;
  for (let i = 0; i < 80; i++) { const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o = p + ((i * 37) % 9 - 4) * 15, c = o + ((i * 53) % 11 - 5) * 12; tw.push({ d, o, h: Math.max(o, c) + 30, l: Math.min(o, c) - 30, c }); p = c; }
  const fut = {}; tw.forEach((b, i) => { fut[b.d] = { day: { c: b.c, contract: "202602" }, night: i ? { c: tw[i - 1].c + (b.o - tw[i - 1].c), contract: i === 40 ? "202603" : "202602" } : undefined }; });
  const us = tw.map(b => ({ d: b.d, c: b.c / 10 })), A = { tw, sox: us, ixic: us, tsm: us, fut }, D = buildDays(A);
  // 改掉某一天自己和之後的收盤、高低，那天的特徵（昨收、ATR、夜盤、美股）不能變
  const i = 30, A2 = { ...A, tw: tw.map((b, k) => (k >= i + 15 ? { ...b, c: b.c + 999, h: b.h + 999, l: b.l - 999 } : b)) }, D2 = buildDays(A2);
  const pick = x => ({ prev: x.prev, atr: x.atr, futChg: x.futChg, sox: x.sox });
  assert.deepEqual(pick(D2[i]), pick(D[i]), "不偷看當天與未來");
  assert.equal(D.find(x => x.d === tw[40].d).futChg, null, "換月那天夜盤和前一天日盤不是同一個合約，不相減");
  assert.equal(D.find(x => x.d === tw[41].d).futChg, tw[41].o - tw[40].c, "夜盤漲跌＝夜盤收－前一天日盤收");
  // 近月：同一天取成交量最大的月合約，跳過週合約
  assert.deepEqual(futByDate([{ date: "2026-01-05", contract_date: "202601", trading_session: "position", close: 100, volume: 5 }, { date: "2026-01-05", contract_date: "202602", trading_session: "position", close: 101, volume: 9 }, { date: "2026-01-05", contract_date: "202601W2", trading_session: "position", close: 99, volume: 99 }])["2026-01-05"].day, { v: 9, c: 101, contract: "202602" });
  // 測試期的成績不受測試期資料影響係數：把測試期收盤全改掉，訓練期配出來的方法在訓練期的成績不變
  const R = evalMethods(D), D3 = D.map((x, k) => (k >= Math.floor(D.length * 0.6) ? { ...x, c: x.c + 500 } : x)), R3 = evalMethods(D3);
  for (let k = 0; k < R.length; k++) assert.deepEqual(R3[k].train, R[k].train, R[k].name);
  // 成績欄位
  const s = score([{ prev: 100, o: 105, h: 112, l: 99, c: 108 }], () => ({ pivot: 104, band: 6 }));
  assert.deepEqual(s, { n: 1, mae: 4, gapMae: 1, dir: 100, keep: 100, inBand: 100, hitP: 100, hitS: 0, band: 6 });
});

test("位置燈號：壓力、支撐用近 14 日平均波動 × 校準倍數；只用目標日以前的日 K；抓不到才用固定 0.6%", () => {
  const B = engine().B, D = [];
  for (let i = 0; i < 20; i++) D.push({ d: `2026-10-${String(i + 1).padStart(2, "0")}`, o: 20000, h: 20100, l: 19900, c: 20000 }); // 每天波幅 200
  assert.equal(B.briefAtr14(D, "2026-10-21"), 200);
  assert.equal(B.briefAtr14([...D, { d: "2026-10-21", o: 20000, h: 25000, l: 15000, c: 20000 }], "2026-10-21"), 200, "目標日當天（還沒發生）的 K 不算");
  assert.equal(B.briefAtr14(D.slice(0, 10), "2026-10-21"), null, "不到 15 根不算");
  const G = { us: { indices: [{ code: "^SOX", price: 5000, chgPct: 1 }, { code: "^IXIC", price: 18000, chgPct: 0.5 }] }, fut: { night: { price: 20100, chg: 100 } } };
  const a = B.briefScenarios(G, "2026-10-27", 20000, { atr: 200 }), k = a.keyLevels;
  assert.equal(k.pivot, 20090); assert.equal(k.pressure - k.pivot, Math.round(0.607 * 200)); assert.equal(k.pivot - k.support, Math.round(0.511 * 200));
  assert.equal(JSON.stringify(a.band), JSON.stringify({ basis: "atr14", atr: 200, up: 0.607, dn: 0.511 }));
  const f = B.briefScenarios(G, "2026-10-27", 20000);
  assert.equal(f.keyLevels.pressure - f.keyLevels.pivot, 120); assert.equal(f.band.basis, "fixed");
});

import "./watch-hot.test.mjs";

test("改版本號腳本：日期用台北時間、號碼接著加 1、README 加一節、找不到舊版本就停", async () => {
  const V = await import("../scripts/bump-version.mjs");
  assert.equal(V.twToday(Date.parse("2026-10-28T17:00:00Z")), "2026-10-29", "台北已經過午夜");
  assert.equal(V.nextVersion("2026.10.26-162", "2026-10-28"), "2026.10.28-163");
  assert.throws(() => V.nextVersion("1.2.3", "2026-10-28"));
  const md = "# 說明\n\n## 更新\n\n### 舊功能（2026.10.26-162）\n- 舊\n";
  const out = V.addSection(md, "新功能", "2026.10.28-163", "改了 A");
  assert.match(out, /### 新功能（2026\.10\.28-163）\n- 改了 A\n\n### 舊功能（2026\.10\.26-162）/);
  assert.equal(V.addSection(out, "新功能", "2026.10.28-163"), out, "同一版不重複加");
  assert.equal(V.swap('<p>版本 2026.10.26-162</p>', "2026.10.26-162", "2026.10.28-163", "x"), "<p>版本 2026.10.28-163</p>");
  assert.throws(() => V.swap("<p>沒有版本</p>", "2026.10.26-162", "2026.10.28-163", "x"), /找不到目前的版本/);
});

// ---------- 大盤分 K 成交量：指數沒有可靠的量就是 null（缺失），不能當成真的 0；個股的量（張）維持原樣。全部用固定的假資料，不呼叫外部網站 ----------
import * as IDV from "../api/_lib/intraday.js";
import idvHandler from "../api/_lib/intraday.js";
import { parseYahooBars as idvYahooBars } from "../api/_lib/_yahoo.js";

// 假的 Yahoo 1 分 K 回應：從台北 09:00 起連續 n 根，量是 vol(k)（股），價格只是測試用的假數字
const idvYahoo = (day, n, vol, { shortName = "TEST" } = {}) => {
  const t0 = Date.parse(`${day}T09:00:00+08:00`) / 1000, ts = Array.from({ length: n }, (_, k) => t0 + k * 60);
  return { chart: { result: [{ meta: { gmtoffset: 28800, chartPreviousClose: 100, shortName, exchangeTimezoneName: "Asia/Taipei" }, timestamp: ts, indicators: { quote: [{ open: ts.map((_, k) => 100 + k), high: ts.map((_, k) => 101 + k), low: ts.map((_, k) => 99 + k), close: ts.map((_, k) => 100.5 + k), volume: ts.map((_, k) => vol(k)) }] } }] } };
};
const idvSlot = (i, tf) => Math.floor(i / tf) * tf; // 第 i 根 1 分 K（09:00 起算）落在哪個分桶

test("分 K 成交量：Yahoo 指數的量（欄位全 0、或有數字）都不是可靠的量，一律 null，OHLC 與時間照舊", () => {
  for (const vol of [() => 0, k => 123456 + k, () => null]) {
    const p = IDV.parseYahooIntraday(idvYahoo("2026-10-05", 5, vol), true);
    assert.equal(p.bars.length, 5);
    assert.ok(p.bars.every(b => b.v === null), "指數的量必須是 null，不是 0");
    assert.deepEqual(p.bars.map(b => [b.t, b.o, b.h, b.l, b.c]), [0, 1, 2, 3, 4].map(k => [`09:0${k}`, 100 + k, 101 + k, 99 + k, 100.5 + k]));
    assert.equal(p.date, "2026-10-05"); assert.equal(p.prev, 100);
  }
});
test("分 K、台指期的缺量（稽核 F-03 後續）：來源沒給量標 vNa，真的 0 不標；日盤沒給量整天標 vNa", async () => {
  const row = (volume, k = 0) => ({ date: `2026-10-05T09:0${k}:00.000+08:00`, open: 10, high: 11, low: 9, close: 10.5, ...(volume === undefined ? {} : { volume }) });
  const stk = IDV.parseFugleCandles({ date: "2026-10-05", data: [row(undefined, 0), row(0, 1), row(7, 2)] });
  assert.deepEqual(stk.bars.map(b => [b.v, !!b.vNa]), [[0, true], [0, false], [7, false]], "個股：缺量欄位標 vNa；那一分鐘沒成交（0）不標");
  const idx = IDV.parseFugleCandles({ date: "2026-10-05", data: [row(null, 0), row(321, 1)] }, true);
  assert.deepEqual(idx.bars.map(b => [b.v, !!b.vNa]), [[null, true], [321, false]], "指數：沒有量照舊是 null，另外標 vNa");
  assert.deepEqual(IDV.parseYahooIntraday(idvYahoo("2026-10-05", 2, k => [null, 3000][k]), false).bars.map(b => !!b.vNa), [true, false]);
  const F = await import("../api/_lib/futures.js");
  const R = F.fromFinmindRows([{ date: "2026-10-05", contract_date: "202610", trading_session: "position", open: 1, max: 2, min: 1, close: 2, volume: null }, { date: "2026-10-06", contract_date: "202610", trading_session: "position", open: 1, max: 2, min: 1, close: 2, volume: 500 }]);
  assert.deepEqual(R.map(r => !!r.vNa), [true, false]);
  assert.deepEqual(F.nearFullDaily(R).map(r => [r.d, !!r.vNa]), [["2026-10-05", true], ["2026-10-06", false]], "日盤沒給量：那天的日 K 標 vNa");
});
test("分 K 成交量：個股的 Yahoo 量維持原本的處理（股 ÷ 1000 四捨五入成張、缺值為 0）", () => {
  const p = IDV.parseYahooIntraday(idvYahoo("2026-10-05", 4, k => [5000000, null, 1500, 0][k]), false);
  assert.deepEqual(p.bars.map(b => b.v), [5000, 0, 2, 0]);
});
test("分 K 成交量：富果指數的量缺失、null、不合法、0 或負數都是 null，有效的正數照原值保留；個股維持 num(volume) || 0", () => {
  const row = (volume, k = 0) => ({ date: `2026-10-05T09:0${k}:00.000+08:00`, open: 10, high: 11, low: 9, close: 10.5, ...(volume === undefined ? {} : { volume }) });
  const idx = IDV.parseFugleCandles({ date: "2026-10-05", data: [row(undefined, 0), row(null, 1), row("abc", 2), row(0, 3), row(-5, 4), row(321, 5)] }, true);
  assert.deepEqual(idx.bars.map(b => b.v), [null, null, null, null, null, 321]);
  const stk = IDV.parseFugleCandles({ date: "2026-10-05", data: [row(undefined, 0), row(null, 1), row("abc", 2), row(0, 3), row(7, 4)] });
  assert.deepEqual(stk.bars.map(b => b.v), [0, 0, 0, 0, 7]);
  assert.ok(idx.bars.every(b => b.o === 10 && b.h === 11 && b.l === 9 && b.c === 10.5), "價格不受影響");
});
test("分 K 成交量：1 分 K 的量依原規則加總成 5、15、30、60 分 K（以獨立算式驗證分桶總和）", () => {
  const N = 60, one = IDV.parseYahooIntraday(idvYahoo("2026-10-05", N, k => (k + 1) * 1000 * 3), false).bars.map(b => ({ d: "2026-10-05", ...b }));
  assert.deepEqual(one.map(b => b.v), Array.from({ length: N }, (_, k) => (k + 1) * 3));
  for (const tf of [5, 15, 30, 60]) {
    const out = IDV.aggregate(one, tf), want = new Map();
    one.forEach((b, i) => want.set(idvSlot(i, tf), (want.get(idvSlot(i, tf)) || 0) + b.v));
    assert.equal(out.length, N / tf);
    assert.deepEqual(out.map(b => b.v), [...want.values()]);
    assert.equal(out.reduce((s, b) => s + b.v, 0), one.reduce((s, b) => s + b.v, 0), `${tf} 分合計等於 1 分合計`);
    out.forEach((b, j) => { const i0 = j * tf; assert.equal(b.o, one[i0].o); assert.equal(b.c, one[i0 + tf - 1].c); assert.equal(b.h, Math.max(...one.slice(i0, i0 + tf).map(x => x.h))); assert.equal(b.l, Math.min(...one.slice(i0, i0 + tf).map(x => x.l))); });
  }
});
test("分 K 成交量：指數 null 的 1 分 K 合成 5、15、30、60 分 K 後仍是 null（不變成 0），OHLC 與分桶不變；桶內有一根缺值就整桶缺值", () => {
  const one = IDV.parseYahooIntraday(idvYahoo("2026-10-05", 60, () => 0), true).bars.map(b => ({ d: "2026-10-05", ...b }));
  for (const tf of [5, 15, 30, 60]) {
    const out = IDV.aggregate(one, tf);
    assert.equal(out.length, 60 / tf); assert.ok(out.every(b => b.v === null));
    assert.deepEqual(out.map(b => b.t), Array.from({ length: 60 / tf }, (_, j) => `${String(9 + Math.floor(j * tf / 60)).padStart(2, "0")}:${String((j * tf) % 60).padStart(2, "0")}`));
  }
  const mixed = [{ d: "x", t: "09:00", o: 1, h: 2, l: 0, c: 1, v: 5 }, { d: "x", t: "09:01", o: 1, h: 3, l: 1, c: 2, v: null }, { d: "x", t: "09:05", o: 2, h: 2, l: 2, c: 2, v: 4 }];
  const out = IDV.aggregate(mixed, 5);
  assert.deepEqual(out.map(b => [b.t, b.v]), [["09:00", null], ["09:05", 4]], "有缺值的桶不能只加有值的那幾根冒充完整的量");
});
test("分 K 成交量：歷史（parseYahooBars）與即時（parseYahooIntraday）使用相同口徑", () => {
  for (const [isIdx, vol] of [[true, k => (k + 1) * 1000], [true, () => 0], [false, k => (k + 1) * 1000], [false, k => (k ? null : 2500)]]) {
    const j = idvYahoo("2026-10-05", 6, vol), live = IDV.parseYahooIntraday(j, isIdx).bars, hist = idvYahooBars(j, isIdx).bars;
    assert.deepEqual(hist.map(b => [b.d, b.t, b.o, b.h, b.l, b.c, b.v]), live.map(b => [b.d, b.t, b.o, b.h, b.l, b.c, b.v]));
  }
  assert.deepEqual(idvYahooBars(idvYahoo("2026-10-05", 3, k => (k + 1) * 1000), false, true).bars.map(b => b.v), [1000, 2000, 3000], "shares 模式（美股千股用）維持原值");
});
test("分 K 成交量：/api/intraday 的指數即時與往前載入都回價格 K 線、量是 null；個股照常有量（mock fetch）", async () => {
  const realFetch = globalThis.fetch, key = process.env.FUGLE_API_KEY, today = new Date(Date.now() + 8 * 3600e3), ymd = d => d.toISOString().slice(0, 10);
  const yesterday = ymd(new Date(today.getTime() - 86400e3)), before = ymd(today); delete process.env.FUGLE_API_KEY;
  const calls = [];
  globalThis.fetch = async url => { url = String(url); calls.push(url); if (!url.includes("query1.finance.yahoo.com")) throw new Error("不該呼叫其他網站：" + url); return { ok: true, status: 200, json: async () => idvYahoo(yesterday, 10, k => (k + 1) * 1000) }; };
  const call = async query => { let body, hdr = {}; await idvHandler({ query }, { setHeader: (k, v) => (hdr[k] = v), status: () => ({ json: b => (body = JSON.parse(JSON.stringify(b))) }) }); return body; };
  try {
    const live = await call({ code: "t00", tf: "5" });
    assert.equal(live.ok, true); assert.equal(live.bars.length, 2); assert.deepEqual(live.bars.map(b => b.t), ["09:00", "09:05"]);
    assert.ok(live.bars.every(b => b.v === null && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0), "JSON 序列化後量仍是 null、價格仍在");
    const hist = await call({ code: "t00", tf: "5", before });
    assert.equal(hist.ok, true); assert.ok(hist.bars.length === 10 && hist.bars.every(b => b.v === null && b.c > 0), "往前載入的歷史分 K 與即時一致");
    const stock = await call({ code: "2330", tf: "5" });
    assert.deepEqual(stock.bars.map(b => b.v), [1 + 2 + 3 + 4 + 5, 6 + 7 + 8 + 9 + 10]);
    assert.ok(calls.length >= 3);
  } finally { globalThis.fetch = realFetch; if (key === undefined) delete process.env.FUGLE_API_KEY; else process.env.FUGLE_API_KEY = key; }
});

test("美股大盤：權值股、類股 ETF 附盤後價（正規收盤另列），指數不抓延長時段（mock fetch，Gemini DEF-05）", async () => {
  const { usItem } = await import("../api/_lib/usmarket.js");
  const realFetch = globalThis.fetch, urls = [];
  const start = Date.parse("2026-10-28T13:30:00Z") / 1000, end = Date.parse("2026-10-28T20:00:00Z") / 1000;
  const ts = [start, end - 300, end + 3600]; // 開盤、收盤前、盤後一小時
  const body = { chart: { result: [{ meta: { regularMarketPrice: 200, chartPreviousClose: 196, regularMarketDayHigh: 0, regularMarketDayLow: 195, regularMarketTime: end, gmtoffset: -14400, exchangeTimezoneName: "America/New_York", currentTradingPeriod: { regular: { start, end, gmtoffset: -14400 } } },
    timestamp: ts, indicators: { quote: [{ open: [196, 199, 197], high: [201, 201, 197], low: [195, 198, 196], close: [199, 200, 196], volume: [1000, 1000, 1000] }] } }] } };
  globalThis.fetch = async url => { url = String(url); urls.push(url); if (!url.startsWith("https://query1.finance.yahoo.com/")) throw new Error("不該呼叫其他網站：" + url); return { ok: true, status: 200, json: async () => body }; };
  try {
    const smh = await usItem(["SMH", "半導體"], false);
    assert.match(urls.at(-1), /includePrePost=true/);
    assert.equal(smh.price, 200, "主價格仍是正規盤收盤");
    assert.deepEqual([smh.high, smh.low], [null, 195], "上游回 0 的最高價當成沒有資料（畫面顯示 —）");
    assert.deepEqual([smh.ext.label, smh.ext.price, smh.ext.chgPct], ["盤後", 196, -2]);
    const sox = await usItem(["^SOX", "費城半導體"], true);
    assert.match(urls.at(-1), /includePrePost=false/); assert.equal(sox.ext, undefined, "指數沒有盤後交易");
  } finally { globalThis.fetch = realFetch; }
});

test("P1-02 daily.js：缺值（null、空字串、--、非數字）不轉成 0，真正的 0 保留；下游金額與排行略過缺值", async () => {
  const D = await import("../api/_lib/daily.js");
  for (const v of [null, undefined, "", "--", "abc", " "]) assert.equal(D.lots(v), null, JSON.stringify(v));
  assert.equal(D.lots("0"), 0); assert.equal(D.lots(0), 0); assert.equal(D.lots("1,234,000"), 1234); assert.equal(D.lots("-5,000"), -5);
  // 法人：真正 0、缺值、部分缺值
  const inst = D.parseInst({ fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數"], data: [["2330", "台積電", "0", "0", "0"], ["2317", "鴻海", "--", "", "3,000"], ["2454", "聯發科", "12,000", "--", "-1,000"]] });
  assert.deepEqual(inst.get("2330"), [0, 0, 0], "真正的 0 保留");
  assert.deepEqual(inst.get("2317"), [null, null, 3]);
  assert.deepEqual(inst.get("2454"), [12, null, -1]);
  // 收盤：成交股數缺值、漲跌缺值、平盤 0
  const q = D.parseQuotes({ fields: ["證券代號", "證券名稱", "成交股數", "收盤價", "漲跌(+/-)", "漲跌價差"], data: [["2330", "台積電", "0", "1000", " ", "0.00"], ["2317", "鴻海", "--", "200", "+", "2.00"], ["2454", "聯發科", "", "1500", "", "--"], ["1101", "台泥", "5,000", "--", "", "--"]] });
  assert.deepEqual([q.get("2330").v, q.get("2330").pct], [0, 0], "成交量真正 0、平盤 0%");
  assert.deepEqual([q.get("2317").v, q.get("2317").pct], [null, 1.01], "成交量缺值是 null");
  assert.deepEqual([q.get("2454").v, q.get("2454").pct], [null, null], "漲跌缺值不寫成 0%");
  assert.equal(q.has("1101"), false, "沒有收盤價的不列");
  // 合併：法人資料裡沒有的股票是 null，不是 0 張
  const rows = D.mergeDay(q, new Map([["2330", [0, 0, 0]]]));
  assert.deepEqual(rows.find(r => r[0] === "2330").slice(4), [0, 0, 0, 0]);
  assert.deepEqual(rows.find(r => r[0] === "2317").slice(4), [null, null, null, null]);
  // 整份法人缺失：全部 null
  assert.ok(D.mergeDay(q, new Map()).every(r => r[4] === null && r[5] === null && r[6] === null));
  // 排程排行：缺值的欄位不放、不排進法人排行；真正 0 張照算
  const { buildRanks } = await import("../scripts/market-after.mjs");
  const quotes = new Map([["2330", { name: "台積電", p: 1000, pct: 1, v: 100, market: "上市" }], ["2317", { name: "鴻海", p: 200, pct: 1, v: null, market: "上市" }], ["2454", { name: "聯發科", p: 1500, pct: -1, v: 50, market: "上市" }]]);
  const R = buildRanks({ quotes, inst: new Map([["2330", [5, 0, 0]], ["2317", [null, null, null]], ["2454", [12, null, -1]]]) });
  const T0 = Object.fromEntries(R.flatMap(r => r.tabs).map(t => [t.id, t.rows])), tabs = new Proxy(T0, { get: (o, k) => o[k] || [] }); // 沒有資料的分頁不會輸出
  assert.deepEqual(tabs.fb.map(x => x.c), ["2454", "2330"], "外資買超只列有資料的");
  assert.ok(!tabs.ab.some(x => x.c === "2317") && !tabs.as.some(x => x.c === "2317"), "法人全缺的股票不當成 0 張出現");
  assert.equal(tabs.ab.find(x => x.c === "2454").a, 11, "部分缺值：只加有的（12 + −1）");
});

test("P1-02 flows.js：法人缺值的股票金額是 null，板塊加總只算有資料的，畫面顯示 —", async () => {
  const vm = await import("node:vm"), fs = await import("node:fs");
  const c = { Math, Array, Map, Set, Object, Number, JSON, Infinity }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(new URL("../learner/flows.js", import.meta.url), "utf8"), c);
  const g = n => vm.runInContext(n, c);
  const days = [{ date: "2026-10-28", rows: [["2330", "台積電", 1000, 1, 10, 0, 0, 100], ["2317", "鴻海", 200, 2, null, null, null, null], ["2454", "聯發科", 1500, -1, 0, 0, 0, 0]] }];
  const M = g("flowModel")(days, [{ id: "x", name: "測試", kind: "題材", codes: ["2330", "2317", "2454"] }]);
  assert.equal(M.stocks.get("2317").amt[0], null, "缺值不是 0 億");
  assert.equal(M.stocks.get("2317").v[0], null);
  assert.equal(M.stocks.get("2454").amt[0], 0, "真正的 0 張是 0");
  assert.equal(M.secs[0].net[0], 10 * 1000 / 1e5, "板塊只加有資料的");
  const S = g("flowStocks")(M); assert.equal(S.find(x => x.code === "2317").mult, null);
  assert.equal(g("flowFmt")(null), "—"); assert.equal(g("flowFmt")(NaN), "—"); assert.equal(g("flowFmt")(0), "+0.0億");
  assert.ok(Number.isFinite(g("flowMood")(M).net), "情緒的淨買超不會變 NaN");
});

test("P2-01 Podcast GET act=file：要有上傳時的憑證、檔名驗證、限流、404 與服務暫停（mock fetch，不呼叫 Gemini）", async () => {
  const P = await import("../api/_lib/podcast.js"), L = await import("../api/_lib/_limit.js");
  const save = { g: process.env.GEMINI_API_KEY, u: process.env.KV_REST_API_URL, t: process.env.KV_REST_API_TOKEN }, realFetch = globalThis.fetch, calls = [];
  process.env.GEMINI_API_KEY = "test-only-fake-key"; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; L.mem.clear();
  let mode = "ok";
  globalThis.fetch = async url => { url = String(url); calls.push(url); if (!url.startsWith("https://generativelanguage.googleapis.com/")) throw new Error("不該連其他網站：" + url);
    if (mode === "down") throw new Error("fetch failed");
    if (url.endsWith("/files/nope")) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ state: "ACTIVE", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123", mimeType: "audio/mpeg" }) }; };
  const call = async (query, ip = "198.51.100.20") => { let code = 200, body; await P.default({ method: "GET", query: { act: "file", ...query }, headers: { "x-real-ip": ip } }, { status: c => ((code = c), { json: b => (body = b) }), setHeader() {} }); return { code, body }; };
  try {
    const now = Date.now(), exp = now + P.FILE_TTL, tok = P.fileTok("files/abc123", exp, "test-only-fake-key");
    const ok = await call({ name: "files/abc123", exp: String(exp), tok });
    assert.deepEqual([ok.code, ok.body.ok, ok.body.state], [200, true, "ACTIVE"], "正常查詢");
    assert.equal((await call({})).code, 400, "缺檔名");
    for (const bad of ["files/../secret", "files/a/b", "files%2F..%2Fx", "../files/abc", "files/abc?x=1", "models/gemini", "files/" + "a".repeat(80)]) assert.equal((await call({ name: bad, exp: String(exp), tok })).code, 400, "非法檔名、路徑穿越：" + bad);
    const n0 = calls.length;
    assert.equal((await call({ name: "files/abc123" })).code, 403, "沒有憑證");
    assert.equal((await call({ name: "files/abc123", exp: String(exp), tok: tok.slice(0, -2) + "xx" })).code, 403, "憑證錯");
    assert.equal((await call({ name: "files/other9", exp: String(exp), tok })).code, 403, "拿 A 檔的憑證查 B 檔（別人的檔案）");
    assert.equal((await call({ name: "files/abc123", exp: String(exp + 1000), tok })).code, 403, "改到期時間");
    const old = now - 1000; assert.equal((await call({ name: "files/abc123", exp: String(old), tok: P.fileTok("files/abc123", old, "test-only-fake-key") })).code, 403, "過期");
    assert.equal((await call({ name: "files/abc123", exp: String(exp), tok: P.fileTok("files/abc123", exp, "another-key") })).code, 403, "用別的金鑰簽的");
    assert.equal(calls.length, n0, "沒有權限的請求不會打到 Gemini");
    const nx = P.fileTok("files/nope", exp, "test-only-fake-key"), r404 = await call({ name: "files/nope", exp: String(exp), tok: nx });
    assert.deepEqual([r404.body.ok, /找不到/.test(r404.body.error)], [false, true], "不存在的檔案");
    mode = "down"; const rd = await call({ name: "files/abc123", exp: String(exp), tok });
    assert.deepEqual([rd.code, rd.body.ok, /暫時連不到/.test(rd.body.error)], [200, false, true], "Gemini Files API 暫時不可用");
    assert.doesNotMatch(JSON.stringify(rd.body), /test-only-fake-key/, "錯誤訊息不含金鑰");
    // 超過限流（沒有 KV：記憶體上限是共用上限的一半）
    mode = "ok"; const [perIp] = L.limitsOf("podcast-file", false); let last;
    for (let i = 0; i <= perIp; i++) last = await call({ name: "files/abc123", exp: String(exp), tok }, "198.51.100.99");
    assert.equal(last.code, 429, "同一個 IP 超過上限");
  } finally {
    globalThis.fetch = realFetch; L.mem.clear();
    for (const [k, v] of [["GEMINI_API_KEY", save.g], ["KV_REST_API_URL", save.u], ["KV_REST_API_TOKEN", save.t]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
