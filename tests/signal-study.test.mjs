// 訊號回測（選股條件的歷史勝率）：learner/sigstudy.js 的計算核心與 scripts/signal-study.mjs。全部用固定假資料。
// 重點：不偷看未來、隔天開盤進場、扣成本、一字漲停買不到、缺值與價格異常不算、去重、流動性。
import test from "node:test";
import assert from "node:assert/strict";
import { engine } from "../scripts/_engine.mjs";
import { spawnSync } from "node:child_process";

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
  const raw = G.sigStudy([{ c: "1111", n: "缺", bars: flat(100, i => (i % 7 === 0 ? { o: null, c: null } : {})) }], always, noInd), R = plain(raw);
  // 直接走過原始物件檢查每一個數字（JSON.stringify 會把 NaN／Infinity 變成 null，用字串找不到——審查意見）
  const bad = [], finite = (o, k) => { if (typeof o === "number") { if (!Number.isFinite(o)) bad.push(k); } else if (o && typeof o === "object") for (const [j, v] of Object.entries(o)) finite(v, `${k}.${j}`); };
  finite(raw, "R"); assert.deepEqual(bad, [], "沒有 NaN／Infinity"); assert.ok(R[0].stats[5]?.n > 0, "缺值之外的樣本照算");
  finite({ x: NaN, y: [1, Infinity] }, "t"); assert.deepEqual(bad, ["t.x", "t.y.1"], "檢查本身抓得到"); bad.length = 0;
  for (const n of [5, 10, 20]) {
    const s = R[0].stats[n];
    if (s === null) continue;
    assert.equal(s.signalAudit.triggered, s.signalAudit.pending + s.signalAudit.lock + s.signalAudit.noExitOrPath + s.signalAudit.jumpExcl + s.signalAudit.done);
    if (s.n === 0) { assert.equal(s.avg, null); assert.equal(s.exN, 0); assert.equal(s.ex, null); assert.ok(s.signalAudit.triggered > 0 && s.signalAudit.done === 0); }
    else assert.ok(Number.isFinite(s.avg));
  }
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
  for (const x of R) for (const n of [5, 10, 20]) {
    const s = x.stats[n];
    if (s !== null) {
      assert.equal(s.signalAudit.triggered, s.signalAudit.pending + s.signalAudit.lock + s.signalAudit.noExitOrPath + s.signalAudit.jumpExcl + s.signalAudit.done);
      assert.ok(s.n > 0 || (s.n === 0 && s.signalAudit.triggered > 0 && s.avg === null && s.signalAudit.done === 0));
    }
  }
});
test("訊號回測：每個條件在排程引擎裡都不會丟錯（sigScan 會把錯誤吞成不成立，只能在這裡抓）", () => {
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; let p = 100;
  const D = Array.from({ length: 160 }, (_, i) => { const o = p; p = Math.max(5, p * (1 + (rnd() - 0.5) * 0.08)); return { d: day(i), o, h: Math.max(o, p) * 1.02, l: Math.min(o, p) * 0.98, c: p, v: i % 9 === 0 ? 9000 : 1000 }; });
  const err = [];
  for (const f of sigDefs(E)) for (let i = 40; i < D.length; i++) { const P = D.slice(0, i + 1); try { f.hit(P, E.indicators(P)); } catch (e) { err.push(`${f.id}：${e.message}`); break; } }
  assert.deepEqual(err, []);
  // 爆量：之前排程裡沒有 fmtVol，每次都丟錯 → 全市場 0 筆；Telegram 提醒（condCheck）的爆量規則也永遠不成立
  const V = flat(40, i => (i === 39 ? { v: 5000 } : {}));
  assert.match(E.condCheck({ cond: "vol" }, V), /是均量的 5\.0 倍/); assert.equal(E.condCheck({ cond: "vol" }, flat(40)), null);
  // #292：fmtVol 在 core.js，排程引擎不再從 watch.html 擷取；watch.html 也不能再宣告一次（同一頁重複 const 會整段腳本失效）
  assert.match(E.condCheck({ cond: "vol" }, flat(40, i => (i === 39 ? { v: 25000 } : {}))), /量 2\.5 萬 是均量/);
  assert.doesNotMatch(readFileSync(new URL("../scripts/_engine.mjs", import.meta.url), "utf8"), /watch\.html/);
  assert.match(readFileSync(new URL("../learner/core.js", import.meta.url), "utf8"), /^const fmtVol = /m);
  assert.doesNotMatch(readFileSync(new URL("../learner/watch.html", import.meta.url), "utf8"), /^\s*(const|let|var|function)\s+fmtVol\b/m);
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
    // 直接執行（workflow 的用法）：沒有快取 → 結束碼 1、印 ::warning::，workflow 才分得出這次沒更新
    const cli = env => spawnSync(process.execPath, [new URL("../scripts/signal-study.mjs", import.meta.url).pathname, "--dry"], { env: { ...process.env, ...env }, encoding: "utf8" });
    let r = cli({ SIG_CACHE: join(dir, "沒有.json") }); assert.equal(r.status, 1); assert.match(r.stdout, /::warning::沒有全市場日 K 快取/);
    writeFileSync(cache, "{ 壞掉的 JSON"); r = cli({ SIG_CACHE: cache }); assert.equal(r.status, 1);
    writeFileSync(cache, JSON.stringify({ s: { 2330: { n: "台積電", b: walk(11) } } })); r = cli({ SIG_CACHE: cache }); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /訊號回測完成/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("訊號回測排程：步驟排在 Telegram 提醒之後，失敗不擋別人", () => {
  const y = readFileSync(new URL("../.github/workflows/market-scan.yml", import.meta.url), "utf8"), at = k => y.indexOf(k);
  assert.ok(at("node scripts/signal-study.mjs") > 0); assert.ok(at("node scripts/signal-study.mjs") > at("node scripts/alerts-push.mjs"), "要幾分鐘的計算不能把收盤提醒往後推");
  assert.ok(y.indexOf("commit-data.sh \"選股：更新訊號回測\" learner/data/signal-study.json") > at("node scripts/signal-study.mjs"));
  const step = y.slice(at("- name: signal study"), at("- name: commit signal study")); assert.match(step, /continue-on-error: true/); assert.match(step, /timeout-minutes: 15/);
  // 失敗看得出來、失敗不 commit：腳本沒更新會非零結束（上面的腳本測試），這一步有 id，commit 只在 outcome 是 success 時跑
  assert.match(step, /id: sigstudy/); const cm = y.slice(at("- name: commit signal study"), at("- name: commit signal study") + 400);
  assert.match(cm, /if: \$\{\{[^}]*steps\.sigstudy\.outcome == 'success'[^}]*\}\}/);
  assert.ok(at("- name: commit signal study") > at("- name: commit pattern today"), "前面的資料各自 commit，不受訊號回測影響");
});


test("訊號回測：同池基準以訊號日成交量篩選，含訊號股且三日期精確對齊", () => {
  const signal = flat(80, i => i === 60 ? { v: 600 } : {});
  const peer = flat(80, i => i === 60 ? { v: 700 } : {});
  const illiquid = flat(80, i => i === 60 ? { v: 499 } : {});
  const M = G.sigMarket([signal, peer, illiquid]);
  const B = plain(G.sigBenchDetail(M, signal, 60, 5, 500, 0));
  assert.equal(B.pool, 2, "同池包含訊號股及當日達 500 張的合格股票");
  assert.equal(B.entry, 2); assert.equal(B.done, 2); assert.equal(B.value, 0);
  const missingSignalDate = flat(80).filter((_,i)=>i!==60);
  const M2 = G.sigMarket([missingSignalDate, peer]);
  const B2 = plain(G.sigBenchDetail(M2, signal, 60, 5, 500, 0));
  assert.equal(B2.pool, 1, "基準股訊號日缺棒不能用更早一根的成交量補位");
});
test("訊號回測：同進出場日但不同訊號日不得共用 memo", () => {
  const b = flat(80, i => (i === 60 ? { v: 800 } : i === 61 ? { v: 100 } : {}));
  const M = G.sigMarket([b]);
  const D1 = flat(80).filter((_,i)=>i!==61);
  const D2 = flat(80).filter((_,i)=>i!==60);
  const A = plain(G.sigBenchDetail(M, D1, 60, 5, 500, 0));
  const B = plain(G.sigBenchDetail(M, D2, 60, 5, 500, 0));
  assert.equal(A.pool, 1); assert.equal(B.pool, 0);
  assert.equal(M.memo.size, 2, "memo key 必須包含 ds、da、db 與 minLots");
});
test("訊號回測：基準端 pool→entry→done 互斥對帳與覆蓋率", () => {
  const D = flat(100), lock = flat(100, i => i === 61 ? { o:110,h:110,l:110,c:110 } : {});
  const badPath = flat(100, i => i === 63 ? { c: 40 } : {});
  const M = G.sigMarket([D, lock, badPath]);
  const B = plain(G.sigBenchDetail(M, D, 60, 5, 500, 0));
  assert.equal(B.pool, B.entry + B.noEntryBar + B.entryLock);
  assert.equal(B.entry, B.done + B.noExitOrPath + B.jumpExcl);
  assert.equal(B.entry, 2); assert.equal(B.done, 1); assert.equal(B.entryLock, 1); assert.equal(B.jumpExcl, 1);
});
test("訊號回測：訊號端拆帳、exN 配對統計與 benchmark coverage", () => {
  const D = flat(100), R = plain(G.sigStudy([{ c:"1111", n:"甲", bars:D }, { c:"2222", n:"乙", bars:flat(100) }], always, noInd))[0];
  const S = R.stats[5];
  assert.equal(S.signalAudit.triggered, S.signalAudit.pending + S.signalAudit.lock + S.signalAudit.noExitOrPath + S.signalAudit.jumpExcl + S.signalAudit.done);
  assert.equal(S.exN, S.benchCov.events);
  assert.equal(S.exN, S.n);
  assert.equal(S.benchCov.pool, S.benchCov.entry);
  assert.equal(S.benchCov.entry, S.benchCov.done);
  assert.equal(S.benchCov.covOverall, 1); assert.equal(S.benchCov.covAvg, 1); assert.equal(S.benchCov.covMin, 1);
  assert.ok(R.benchEvents[5].length > 0);
});
test("訊號回測：看空卡片文案明確標示反向解讀、基準名稱為同池", () => {
  const src = readFileSync(new URL("../learner/sigstudy.js", import.meta.url), "utf8");
  assert.match(src, /超額（同池）/);
  assert.match(src, /看空型態（反向解讀）/);
  assert.match(src, /現存上市櫃普通股等權池/);
  assert.doesNotMatch(src.slice(src.indexOf("function sgBadge")), /贏大盤/);
});
test("訊號回測：sigForwardDetail 互斥排除原因、Infinity／零價防護與全排除統計", () => {
  assert.deepEqual(plain(G.sigForwardDetail(flat(12), 10, 5)), { reason: "pending" });
  for (const patch of [i => (i === 6 ? { o: Infinity } : {}), i => (i === 5 ? { c: Infinity } : {}), i => (i === 5 ? { c: 0 } : {})])
    assert.deepEqual(plain(G.sigForwardDetail(flat(12, patch), 5, 5)), { reason: "noEntryBar" });
  assert.deepEqual(plain(G.sigForwardDetail(flat(12, i => (i === 6 ? { o: 110, h: 110, l: 110, c: 110 } : {})), 5, 5)), { reason: "entryLock" });
  for (const patch of [i => (i === 6 ? { o: 100, c: null } : {}), i => (i === 8 ? { c: 0 } : {}), i => (i === 10 ? { c: Infinity } : {})])
    assert.deepEqual(plain(G.sigForwardDetail(flat(12, patch), 5, 5)), { reason: "noExitOrPath" });
  assert.deepEqual(plain(G.sigForwardDetail(flat(12, i => (i === 8 ? { c: 40 } : {})), 5, 5)), { reason: "jumpExcl" });

  const bars = flat(86, i => (i === 63 ? { c: 40 } : i === 67 ? { o: 110, h: 110, l: 110, c: 110 } : i === 75 ? { c: null } : {}));
  const defs = [{ id: "pick4", group: "t", name: "4筆全排除或未成熟", hit: P => [61, 67, 73, 84].includes(P.length) }];
  const s5 = plain(G.sigStudy([{ c: "1111", n: "測", bars }], defs, noInd))[0].stats[5];
  assert.deepEqual(s5.signalAudit, { triggered: 4, pending: 1, lock: 1, noExitOrPath: 1, jumpExcl: 1, done: 0 });
  assert.equal(s5.n, 0); assert.equal(s5.avg, null); assert.equal(s5.exN, 0); assert.equal(s5.pairedAvg, null); assert.equal(s5.benchAvg, null); assert.equal(s5.ex, null);
  assert.equal(s5.benchCov.events, 0);
});
test("訊號回測：memo 依 minLots 隔離、不同 cost 共用 grossAvg、缺期與非遞增日期邊界", () => {
  const D = flat(80, i => (i === 60 ? { v: 600 } : {})), P = flat(80, i => (i === 60 ? { v: 1200 } : {}));
  const M = G.sigMarket([D, P]);
  const b500 = plain(G.sigBenchDetail(M, D, 60, 5, 500, 0)), b1000 = plain(G.sigBenchDetail(M, D, 60, 5, 1000, 0));
  const b1000c = plain(G.sigBenchDetail(M, D, 60, 5, 1000, 0.00585));
  assert.equal(b500.pool, 2); assert.equal(b1000.pool, 1); assert.equal(b1000c.pool, 1);
  assert.ok(Math.abs(b1000c.value - (-0.00585)) < 1e-12);
  assert.equal(M.memo.size, 2, "同 ds|da|db 不同 minLots 必須分開快取，不同 cost 共用 grossAvg");

  for (const bad of [flat(80, i => (i === 61 ? { d: day(59) } : {})), flat(80, i => (i === 61 ? { d: day(60) } : {})), flat(80, i => (i === 65 ? { d: "" } : {}))])
    assert.equal(G.sigBenchDetail(M, bad, 60, 5, 500, 0), null, "缺日期或非嚴格遞增時不查表也不污染 memo");
  assert.equal(M.memo.size, 2);

  const jumpPeer = flat(80, i => (i === 63 ? { c: 40 } : {})), missExitPeer = flat(80).filter((_, i) => i !== 65);
  const bZeroDone = plain(G.sigBenchDetail(G.sigMarket([jumpPeer, missExitPeer]), D, 60, 5, 500, 0));
  assert.equal(bZeroDone.pool, 2); assert.equal(bZeroDone.entry, 2); assert.equal(bZeroDone.done, 0);
  assert.equal(bZeroDone.jumpExcl, 1); assert.equal(bZeroDone.noExitOrPath, 1); assert.equal(bZeroDone.value, null);

  const lockPeer = flat(80, i => (i === 61 ? { o: 110, h: 110, l: 110, c: 110 } : {})), noBarPeer = flat(80).filter((_, i) => i !== 61);
  const bZeroEntry = plain(G.sigBenchDetail(G.sigMarket([lockPeer, noBarPeer]), D, 60, 5, 500, 0));
  assert.equal(bZeroEntry.pool, 2); assert.equal(bZeroEntry.entry, 0); assert.equal(bZeroEntry.noEntryBar, 1); assert.equal(bZeroEntry.entryLock, 1);
  assert.equal(bZeroEntry.value, null);
});
test("訊號回測：covAvg 與 covOverall 區分、covMin 與配對子集一致性（exN < n）", () => {
  const sig = flat(90, i => (i === 60 || i === 70 ? { o: 100, h: 120, l: 99, c: 115, v: 1000 } : { v: 100 }));
  const peers60 = Array.from({ length: 9 }, (_, k) => ({ c: String(2000 + k), n: `甲${k}`, bars: flat(90, i => (i === 60 ? { v: 1000 } : { v: 100 })) }));
  const jump70 = flat(90, i => (i === 70 ? { v: 1000 } : i === 73 ? { c: 40, v: 100 } : { v: 100 }));
  const defs = [{ id: "cgt110", group: "t", name: "c>110", hit: P => P.at(-1).c > 110 }];
  const R = plain(G.sigStudy([{ c: "1111", n: "訊號", bars: sig }, ...peers60, { c: "2999", n: "跳", bars: jump70 }], defs, noInd, { cost: 0 }))[0];
  const s5 = R.stats[5];
  assert.equal(s5.n, 2); assert.equal(s5.exN, 2);
  assert.equal(s5.benchCov.events, 2); assert.equal(s5.benchCov.covEvents, 2); assert.equal(s5.benchCov.entryZeroEvents, 0);
  assert.equal(s5.benchCov.pool, 12); assert.equal(s5.benchCov.entry, 12); assert.equal(s5.benchCov.done, 11); assert.equal(s5.benchCov.jumpExcl, 1);
  assert.equal(s5.benchCov.covOverall, 0.9167); assert.equal(s5.benchCov.covAvg, 0.75); assert.equal(s5.benchCov.covMin, 0.5);
  assert.notEqual(s5.benchCov.covOverall, s5.benchCov.covAvg);

  // exN < n：第 70 根出發的 5 日出場日缺失日期 .d（報酬 40% 計入 n 與 avg，但無法配對基準，不進入 pairedAvg／benchAvg／ex）
  const s1 = flat(90, i => (i === 60 || i === 70 ? { c: 108, h: 109 } : i === 65 ? { c: 110, h: 111 } : i === 75 ? { d: "", c: 140, h: 141 } : {}));
  const P = plain(G.sigStudy([{ c: "1111", n: "甲", bars: s1 }, { c: "2222", n: "乙", bars: flat(90) }], [{ id: "e2", group: "t", name: "e2", hit: P => P.at(-1).c === 108 }], noInd, { cost: 0 }))[0].stats[5];
  assert.equal(P.n, 2); assert.equal(P.avg, 0.25);
  assert.equal(P.exN, 1); assert.equal(P.benchCov.events, 1);
  assert.equal(P.pairedAvg, 0.1); assert.equal(P.benchAvg, 0.05); assert.equal(P.ex, 0.05); assert.equal(P.exWin, 1);
  assert.ok(Math.abs((P.pairedAvg - P.benchAvg) - P.ex) <= 1e-4);
});
test("訊號回測腳本：JSON 不含 benchEvents、保留審計欄位且全未完成時回傳 null", () => {
  assert.equal(G.SIG_COV_WARN, 0.95);
  const H = { date: day(199), s: { 2330: { n: "台積電", b: walk(11) }, 2317: { n: "鴻海", b: walk(12) } } };
  const out = plain(build(H, E, new Date("2026-11-16T08:30:00Z")));
  assert.ok(out.defs.every(d => !("benchEvents" in d)), "排程輸出不得包含肥大 benchEvents 陣列");
  const withStat = out.defs.find(d => d.stats[5]);
  assert.ok(withStat && "signalAudit" in withStat.stats[5] && "benchCov" in withStat.stats[5] && "exN" in withStat.stats[5] && "pairedAvg" in withStat.stats[5] && "benchAvg" in withStat.stats[5]);
  const pendOnly = flat(63, i => (i === 62 ? { o: 100, h: 110, l: 99, c: 109, v: 9000 } : {}));
  assert.equal(build({ s: { 2330: { n: "尾段", b: pendOnly } } }, E), null, "只有 pending 觸發（n === 0）時仍回傳 null 保留舊檔");
});
test("訊號回測：進場漲停基準取 b[a-1]（同 sigForward D[i] 語意）與非遞增日期防呆", () => {
  // (a) 基準股只有 ds 與 da（a === si + 1，且中間日都無資料），da 一字漲停應依 ds 收盤計入 entryLock
  const sigSkip = flat(80).filter((_, k) => k !== 61); // sigSkip[60]=day(60), sigSkip[61]=day(62)
  const bNoMid = flat(80, k => (k === 59 ? { c: 150 } : k === 60 ? { c: 100, v: 1000 } : k === 62 ? { o: 110, h: 110, l: 110, c: 110 } : {})).filter((_, k) => k !== 61);
  const Ba = plain(G.sigBenchDetail(G.sigMarket([bNoMid]), sigSkip, 60, 5, 500, 0));
  assert.equal(Ba.pool, 1); assert.equal(Ba.noEntryBar, 0); assert.equal(Ba.entryLock, 1); assert.equal(Ba.entry, 0);
  assert.equal(Ba.pool, Ba.entry + Ba.noEntryBar + Ba.entryLock);

  // (b) 訊號股 ds→da 跳過 d_mid，但基準股有中間交易日 d_mid：以真實前一交易日 b[a-1] 判斷漲停鎖死
  const bDownMid = flat(80, k => (k === 60 ? { c: 100, v: 1000 } : k === 61 ? { o: 95, h: 95, l: 91, c: 91 } : k === 62 ? { o: 100.1, h: 100.1, l: 100.1, c: 100.1 } : {}));
  const Bb1 = plain(G.sigBenchDetail(G.sigMarket([bDownMid]), sigSkip, 60, 5, 500, 0));
  assert.equal(Bb1.pool, 1); assert.equal(Bb1.entryLock, 1, "100→91→100.1 一字漲停相對 d_mid=91 達 +10%，應計入 entryLock");
  assert.equal(Bb1.entry, 0); assert.equal(Bb1.done, 0);

  const bUpMid = flat(80, k => (k === 60 ? { c: 100, v: 1000 } : k === 61 ? { o: 105, h: 110, l: 104, c: 110 } : k === 62 ? { o: 110, h: 110, l: 110, c: 110 } : {}));
  const Bb2 = plain(G.sigBenchDetail(G.sigMarket([bUpMid]), sigSkip, 60, 5, 500, 0));
  assert.equal(Bb2.pool, 1); assert.equal(Bb2.entryLock, 0, "100→110→110 平盤一字線相對 d_mid=110 為 0%，不應誤判 entryLock");
  assert.equal(Bb2.entry, 1); assert.equal(Bb2.done, 1);

  // (c) 基準股日期非遞增或前日缺日期（b[a-1].d 不在 [ds, da)）→ 計入 noEntryBar 且恆等式成立
  const sigNorm = flat(80);
  const insertAt61 = d => [...sigNorm.slice(0, 61), { d, o: 100, h: 101, l: 99, c: 100, v: 1000 }, ...sigNorm.slice(61)];
  const bPrevBeforeDs = insertAt61(day(50)), bPrevAfterDa = insertAt61(day(63)), bPrevEqDa = insertAt61(day(61)), bPrevNoDate = insertAt61(null);
  const Bc = plain(G.sigBenchDetail(G.sigMarket([sigNorm, bPrevBeforeDs, bPrevAfterDa, bPrevEqDa, bPrevNoDate]), sigNorm, 60, 5, 500, 0));
  assert.equal(Bc.pool, 5); assert.equal(Bc.noEntryBar, 4); assert.equal(Bc.entry, 1); assert.equal(Bc.entryLock, 0); assert.equal(Bc.done, 1);
  assert.equal(Bc.pool, Bc.entry + Bc.noEntryBar + Bc.entryLock);
  assert.equal(Bc.entry, Bc.done + Bc.noExitOrPath + Bc.jumpExcl);
});
