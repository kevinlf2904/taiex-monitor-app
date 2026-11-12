// 訊號回測（選股條件的歷史勝率）：learner/sigstudy.js 的計算核心與 scripts/signal-study.mjs。全部用固定假資料。
// 重點：不偷看未來、隔天開盤進場、扣成本、一字漲停買不到、缺值與價格異常不算、去重、流動性。
import test from "node:test";
import assert from "node:assert/strict";
import { engine } from "../scripts/_engine.mjs";

const E = engine(), G = E.G || {}, plain = v => JSON.parse(JSON.stringify(v)); // 沙盒（vm）裡產生的物件換成一般物件再比
const day = i => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const flat = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ d: day(i), o: 100, h: 101, l: 99, c: 100, v: 1000, ...f(i) }));
const noInd = () => ({}), always = [{ id: "a", group: "t", name: "每天", hit: () => true }];

test("訊號回測：隔天開盤進場、第 n 根收盤出場、扣成本", () => {
  const D = flat(12, i => (i === 5 ? { o: 110, h: 112, l: 108, c: 111 } : i === 6 ? { o: 104, h: 106, l: 103, c: 105 } : i === 10 ? { c: 120, h: 121 } : {}));
  assert.equal(G.SIG_COST, 0.001425 * 2 + 0.003);
  assert.ok(Math.abs(G.sigForward(D, 5, 5) - (120 / 104 - 1 - G.SIG_COST)) < 1e-12, "第 6 根開盤 104 買、第 10 根收盤 120 賣");
  assert.equal(G.sigForward(D, 5, 20), null, "後面資料不夠");
});
test("訊號回測：一字漲停買不到、價格異常不算", () => {
  const L = flat(12, i => (i === 6 ? { o: 110, h: 110, l: 110, c: 110 } : i > 6 ? { o: 110, h: 111, l: 109, c: 110 } : {}));
  assert.equal(G.sigForward(L, 5, 3), null, "隔天一字漲停");
  const J = flat(12, i => (i >= 8 ? { o: 40, h: 41, l: 39, c: 40 } : {}));
  assert.equal(G.sigForward(J, 5, 5), null, "單日跳動超過 50% 視為未還原的減資／分割");
  assert.notEqual(G.sigForward(flat(12), 5, 5), null, "正常資料算得出來");
});
test("訊號回測：缺值不算、不產生 NaN", () => {
  for (const f of [i => (i === 6 ? { o: null } : {}), i => (i === 10 ? { c: 0 } : {}), i => (i === 8 ? { c: null } : {}), i => (i === 5 ? { c: null } : {})])
    assert.equal(G.sigForward(flat(12, f), 5, 5), null);
  const R = plain(G.sigStudy([{ c: "1111", n: "缺", bars: flat(100, i => (i % 7 === 0 ? { o: null, c: null } : {})) }], always, noInd));
  assert.ok(!JSON.stringify(R).includes("NaN")); for (const n of [5, 10, 20]) assert.ok(R[0].stats[n] === null || Number.isFinite(R[0].stats[n].avg));
});
test("訊號回測：不偷看未來（改掉訊號日之後的 K 棒，訊號不變）", () => {
  const mk = tail => flat(100, i => (i === 70 ? { c: 108, h: 109 } : i > 70 ? tail(i) : {}));
  const defs = [{ id: "up5", hit: P => P.at(-1).c / P.at(-2).c - 1 > 0.05 }];
  const pick = D => plain(G.sigScan(D, defs, noInd)).filter(x => x.i <= 70).map(x => x.i);
  assert.deepEqual(pick(mk(() => ({}))), [70]); assert.deepEqual(pick(mk(i => ({ o: 300 + i, h: 310 + i, l: 290 + i, c: 305 + i }))), [70]);
  const seen = [], inds = []; G.sigScan(flat(100), [{ id: "len", hit: (P, I) => { seen.push(P.length); inds.push(I.len); return false; } }], P => ({ len: P.length }));
  assert.deepEqual(seen, Array.from({ length: 40 }, (_, k) => 61 + k), "第 i 天只收到到那天為止的 i + 1 根"); assert.deepEqual(inds, seen, "指標也只用到那天為止的 K 棒");
});
test("訊號回測：gap 內重複成立只算一次、量不足不算、條件丟例外視為不成立", () => {
  assert.deepEqual(plain(G.sigScan(flat(100), always, noInd)).map(x => x.i), [60, 65, 70, 75, 80, 85, 90, 95]);
  assert.equal(G.sigScan(flat(100, () => ({ v: 100 })), always, noInd).length, 0);
  assert.equal(G.sigScan(flat(100), [{ id: "x", hit: () => { throw new Error("壞掉"); } }], noInd).length, 0);
});
test("訊號回測：sigStudy 的統計、分佈、最近案例；不到 61 根略過", () => {
  const up = flat(100, i => ({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i })), dn = flat(100, i => ({ o: 300 - i, h: 301 - i, l: 299 - i, c: 300 - i }));
  const R = plain(G.sigStudy([{ c: "1111", n: "漲", bars: up }, { c: "2222", n: "跌", bars: dn }], always, noInd));
  const s5 = R[0].stats[5]; assert.equal(s5.n, 14, "每檔 60～90 共 7 次（95 那次後面不夠 5 根）"); assert.equal(s5.win, 0.5); assert.equal(R[0].stats[20].n, 8);
  assert.equal(R[0].hist.length, 10); assert.equal(R[0].hist.reduce((a, b) => a + b, 0), R[0].stats[20].n); assert.equal(R[0].recent[0].length, 6);
  assert.equal(s5.exWin, 0.5, "一漲一跌，贏大盤的機率一半");
  const S = plain(G.sigStudy([{ c: "3333", n: "短", bars: flat(50) }, { c: "4444", n: "空", bars: null }], always, noInd));
  assert.deepEqual(S[0].stats, { 5: null, 10: null, 20: null }); assert.deepEqual(S[0].recent, []);
});
test("訊號回測：贏大盤的基準和個股同一個視窗、同樣扣成本", () => {
  // 全部股票走勢一樣 → 每一筆都和大盤一樣，贏大盤剛好是 0（基準沒扣成本或視窗差一根都不會是 0）
  const gap = flat(100, i => ({ o: 100 + i * 2 + 1, h: 100 + i * 2 + 3, l: 100 + i * 2, c: 100 + i * 2 + 2 })); // 每天跳空開高再走高
  const R = plain(G.sigStudy([{ c: "1111", n: "甲", bars: gap }, { c: "2222", n: "乙", bars: gap.map(x => ({ ...x })) }], always, noInd));
  for (const n of [5, 10, 20]) { assert.equal(R[0].stats[n].ex, 0, `${n} 天`); assert.equal(R[0].stats[n].exWin, 0); }
  // 手算：甲每天開平盤、收漲 1%，乙不動。基準是「同一天開盤等權買進兩檔、持有到出場」＝(1.01^5 + 1)/2 − 1，
  // 不是每天再平衡的 1.005^5 − 1（兩檔走勢差很多，兩種算法才分得出來——獨立審查 R1）
  let p = 100; const A = flat(100, () => { const o = p; p = p * 1.01; return { o, h: p, l: o, c: p }; });
  const M = G.sigMarket([A, flat(100)]), b5 = G.sigBench(M, A, 60, 5);
  assert.ok(Math.abs(b5 - ((1.01 ** 5 + 1) / 2 - 1 - G.SIG_COST)) < 1e-9, "基準：第 61 根開盤等權買兩檔、第 65 根收盤賣，扣成本");
  assert.ok(Math.abs(b5 - (1.005 ** 5 - 1 - G.SIG_COST)) > 1e-4, "不是每天再平衡的指數");
  // 視窗內有一檔一字漲停買不到或沒有那天的資料 → 那一檔不算進基準
  const lock = flat(100, k => (k === 61 ? { o: 110, h: 110, l: 110, c: 110 } : k > 61 ? { o: 110, h: 111, l: 109, c: 110 } : {}));
  assert.ok(Math.abs(G.sigBench(G.sigMarket([A, lock]), A, 60, 5) - (1.01 ** 5 - 1 - G.SIG_COST)) < 1e-9, "買不到的不算");
  assert.ok(Math.abs(G.sigBench(G.sigMarket([A, flat(30)]), A, 60, 5) - (1.01 ** 5 - 1 - G.SIG_COST)) < 1e-9, "沒有那天的不算");
  assert.equal(G.sigBench(M, A, 98, 5), null, "後面資料不夠");
  const S = plain(G.sigStudy([{ c: "1111", n: "甲", bars: A }, { c: "2222", n: "乙", bars: flat(100) }], always, noInd))[0].stats[5];
  assert.equal(S.ex, 0, "只有兩檔、每天都成立：平均剛好等於買進持有的等權基準"); assert.equal(S.exWin, 0.5);
});
test("訊號回測：真實條件接得上（COND、KPAT）", () => {
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; let p = 100;
  const D = Array.from({ length: 200 }, (_, i) => { const o = p; p = Math.max(5, p * (1 + (rnd() - 0.49) * 0.06)); return { d: day(i), o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 1000 + Math.round(rnd() * 3000) }; });
  const C = E.COND.find(x => x[0] === "macdgc"), K = E.KPAT[0];
  const R = plain(G.sigStudy([{ c: "1111", n: "亂數", bars: D }], [{ id: "c:macdgc", group: "tech", name: C[1], hit: (P, I) => C[4](P, I, C[3]) }, { id: "k:" + K.id, group: "kline", side: K.side, name: K.name, desc: K.desc, hit: P => K.hit(P) }], E.indicators));
  assert.equal(R.length, 2); assert.ok(R[0].stats[5]?.n > 0, "200 根亂數走勢一定有 MACD 金叉"); assert.equal(R[1].side, K.side);
  for (const x of R) for (const n of [5, 10, 20]) assert.ok(x.stats[n] === null || x.stats[n].n > 0);
});

/* ---------- scripts/signal-study.mjs ---------- */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sigDefs, build, main } from "../scripts/signal-study.mjs";

const walk = (seed, n = 200) => { let s = seed, p = 100; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, i) => { const o = p; p = Math.max(5, p * (1 + (rnd() - 0.49) * 0.06)); return { d: day(i), o: +o.toFixed(2), h: +(Math.max(o, p) * 1.01).toFixed(2), l: +(Math.min(o, p) * 0.99).toFixed(2), c: +p.toFixed(2), v: 1000 + Math.round(rnd() * 3000) }; }); };
test("訊號回測腳本：條件清單 27 個、id 不重複、沒有策略訊號", () => {
  const L = sigDefs(), ids = L.map(x => x.id);
  assert.equal(L.length, 27); assert.equal(new Set(ids).size, 27); assert.ok(!ids.some(k => k.startsWith("c:s:")));
  assert.equal(ids.filter(k => k.startsWith("k:")).length, 13); assert.ok(L.filter(x => x.group === "kline").every(x => x.side === "bull" || x.side === "bear"));
  assert.ok(L.every(x => x.name && typeof x.hit === "function")); assert.equal(L.find(x => x.id === "c:maup").name, "收盤站上均線 20 天", "有參數的條件名稱帶預設參數"); assert.equal(L.find(x => x.id === "c:hi").name, "創 20 日新高（收盤）"); assert.equal(L.find(x => x.id === "c:rsilt").name, "RSI 低於 30");
});
test("訊號回測腳本：build 只算四碼普通股，輸出格式照規格", () => {
  const H = { date: day(199), s: { 2330: { n: "台積電", b: walk(11) }, "0050": { n: "元大台灣50", b: walk(12) }, "00878": { n: "國泰永續高股息", b: walk(13) }, "030001": { n: "權證", b: walk(14) } } };
  const out = plain(build(H, E, new Date("2026-11-12T08:30:00Z")));
  assert.equal(out.stocks, 1); assert.deepEqual(out.ns, [5, 10, 20]); assert.equal(out.cost, 0.00585); assert.equal(out.minN, 30); assert.equal(out.defs.length, 27);
  assert.equal(out.updated, "2026-11-12T08:30:00.000Z"); assert.equal(out.from, day(0)); assert.equal(out.to, day(199));
  assert.ok(out.defs.every(x => !("hit" in x) && x.hist.length === 10 && Object.keys(x.stats).join() === "5,10,20"));
  assert.ok(out.defs.flatMap(x => x.recent).every(r => r[0] === "2330" && r[1] === "台積電"));
});
test("訊號回測腳本：沒有樣本回傳 null；沒有快取或沒有樣本時保留舊檔", async () => {
  assert.equal(build({ s: { 2330: { n: "台積電", b: walk(11, 30) } } }), null); assert.equal(build({ s: {} }), null); assert.equal(build(null), null);
  const dir = mkdtempSync(join(tmpdir(), "sig-")), out = join(dir, "signal-study.json"), cache = join(dir, "allk.json");
  try {
    writeFileSync(out, '{"old":1}');
    assert.equal(await main({ cache: join(dir, "沒有.json"), out }), null); assert.equal(readFileSync(out, "utf8"), '{"old":1}');
    writeFileSync(cache, JSON.stringify({ s: { 2330: { n: "台積電", b: walk(11, 30) } } }));
    assert.equal(await main({ cache, out }), null); assert.equal(readFileSync(out, "utf8"), '{"old":1}');
    writeFileSync(cache, "{ 壞掉的 JSON"); assert.equal(await main({ cache, out }), null); assert.equal(readFileSync(out, "utf8"), '{"old":1}');
    writeFileSync(cache, JSON.stringify({ s: { 2330: { n: "台積電", b: walk(11) } } }));
    const R = await main({ cache, out }); assert.equal(R.stocks, 1); assert.equal(JSON.parse(readFileSync(out, "utf8")).defs.length, 27);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("訊號回測排程：步驟排在 Telegram 提醒之後，失敗不擋別人", () => {
  const y = readFileSync(new URL("../.github/workflows/market-scan.yml", import.meta.url), "utf8"), at = k => y.indexOf(k);
  assert.ok(at("node scripts/signal-study.mjs") > 0); assert.ok(at("node scripts/signal-study.mjs") > at("node scripts/alerts-push.mjs"), "要幾分鐘的計算不能把收盤提醒往後推");
  assert.ok(y.indexOf("commit-data.sh \"選股：更新訊號回測\" learner/data/signal-study.json") > at("node scripts/signal-study.mjs"));
  const step = y.slice(at("- name: signal study"), at("- name: commit signal study")); assert.match(step, /continue-on-error: true/); assert.match(step, /timeout-minutes: 15/);
});
