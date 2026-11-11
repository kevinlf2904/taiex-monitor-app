// 盤後排程的來源日期把關（#262 NEW-03、#264 B1）：休市日（國定假日、颱風假）櫃買回的是前一個交易日的資料，
// 只看筆數會把舊價當成當天的存進 learner/data/market/。三支排程（hilo、breadth、after）都要擋下來。
// 全部用假的 fetchDay、寫到暫存目錄，不連外、不動 learner/data/。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDayOk } from "../api/_lib/daily.js";

const iso = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
// 假的 closeToday 結果：tse、otc 是檔數；tseDate、otcDate 是來源自己寫的日期（null＝來源沒給）
function day(d, { tse = 600, otc = 600, tseDate = iso(d), otcDate = iso(d), seed = 0, meta = true } = {}) {
  const m = new Map();
  for (let i = 0; i < tse; i++) m.set(String(1101 + i), { name: "上市" + i, p: 100 + i + seed, pct: i % 3 === 0 ? -1 : 1, v: 1000, market: "上市" });
  for (let i = 0; i < otc; i++) m.set(String(5201 + i), { name: "上櫃" + i, p: 50 + i + seed, pct: i % 2 ? 1 : -1, v: 500, market: "上櫃" });
  if (!meta) return m;
  const dates = [tse ? tseDate : null, otc ? otcDate : null].filter(Boolean), same = dates.length && dates.every(x => x === dates[0]);
  const verified = tse && otc ? !!(tseDate && otcDate && tseDate === otcDate) : !!dates.length, actual = verified && same ? dates[0] : null;
  return Object.assign(m, { tseDate: tse ? tseDate : null, otcDate: otc ? otcDate : null, tseCount: tse, otcCount: otc, date: actual, sourceDate: actual, dateVerified: verified, isSourceDateMatched: !!(verified && actual === iso(d)) });
}

test("closeDayOk：來源日期相符才用；任何一個市場日期不符就不用；來源沒給日期時至少要有上市", () => {
  const D = "20261104";
  assert.equal(closeDayOk(day(D), D).ok, true, "上市、上櫃都是當天");
  assert.equal(closeDayOk(day(D, { otc: 0 }), D).ok, true, "只有上市（上櫃還沒出來）、日期相符");
  const hol = closeDayOk(day(D, { tse: 0, otc: 820, otcDate: "2026-11-03" }), D);
  assert.equal(hol.ok, false, "休市日：上市 0 檔、上櫃 820 檔是前一天的");
  assert.match(hol.why, /上櫃資料日期是 2026-11-03，不是 2026-11-04/);
  assert.equal(closeDayOk(day(D, { otcDate: "2026-11-03" }), D).ok, false, "上市是當天、上櫃還是前一天：整天不用（之後重抓）");
  assert.equal(closeDayOk(day(D, { tseDate: "2026-11-03", otcDate: "2026-11-03" }), D).ok, false, "兩個市場都回前一天");
  assert.equal(closeDayOk(day(D, { tse: 0, otc: 820, otcDate: null }), D).ok, false, "只有上櫃而且來源沒有日期：無法確認");
  assert.equal(closeDayOk(day(D, { tseDate: null, otcDate: null }), D).ok, true, "來源都沒給日期但有上市資料：照舊可用（證交所網址帶日期）");
  assert.equal(closeDayOk(day(D, { meta: false }), D).ok, true, "沒有日期欄位的 Map（舊呼叫端）：有上市資料就可用");
  assert.equal(closeDayOk(new Map(), D).ok, false, "空的");
  assert.equal(closeDayOk(null, D).ok, false);
  assert.equal(closeDayOk(day(D), "2026/11/4").ok, false, "日期格式不對");
  assert.equal(closeDayOk(day(D), "2026-11-04").ok, true, "帶連字號的日期也接受");
});

// 2026-11-04（三）當成休市日：上市 0 檔，櫃買回 11-03 的 820 檔
const NOW = Date.parse("2026-11-05T10:00:00Z"), HOL = "20261104";
const fetchDay = async d => (d === HOL ? day(d, { tse: 0, otc: 820, otcDate: "2026-11-03", seed: 3 }) : day(d, { seed: +d.slice(6) }));

test("market-hilo：休市日的舊資料不存，其他交易日照常", async () => {
  const { main } = await import("../scripts/market-hilo.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "hilo-")), out = path.join(dir, "hilo.json"), log = console.log; console.log = () => {};
  try {
    const r = await main({ fetchDay, now: NOW, gap: 0, out });
    assert.ok(!r.days.includes(HOL), "休市日不在序列裡：" + r.days.slice(0, 4).join(","));
    assert.deepEqual(r.days.slice(0, 2), ["20261105", "20261103"]);
    assert.equal(r.days.length, 21);
    const saved = JSON.parse(await readFile(out, "utf8"));
    assert.ok(!saved.days.includes(HOL)); assert.equal(saved.closes["5201"].length, 21);
    // 第二次執行：上一次存的檔裡沒有休市日，重抓還是被擋，不會因為「沿用上次存的」而混進去
    const r2 = await main({ fetchDay, now: NOW, gap: 0, out });
    assert.ok(!r2.days.includes(HOL));
    // 上市是當天、上櫃還是前一天（傍晚櫃買還沒更新）：今天先不存，等之後重抓
    const late = async d => (d === "20261105" ? day(d, { otcDate: "2026-11-03" }) : fetchDay(d));
    const dir2 = await mkdtemp(path.join(tmpdir(), "hilo-")), r3 = await main({ fetchDay: late, now: NOW, gap: 0, out: path.join(dir2, "hilo.json") });
    assert.equal(r3.days[0], "20261103", "今天的混合日期資料不存");
    await rm(dir2, { recursive: true, force: true });
  } finally { console.log = log; await rm(dir, { recursive: true, force: true }); }
});

test("market-breadth：休市日的舊資料不存；過去的日子連續兩次才記成休市；雙市場都回舊日期也擋", async () => {
  const { main } = await import("../scripts/market-breadth.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "breadth-")), out = path.join(dir, "breadth.json"), log = console.log; console.log = () => {};
  try {
    const now = Date.parse("2026-11-09T10:00:00Z"); // 週一：休市日 11-04 已經是「過去的日子」（k > 1）
    const r = await main({ fetchDay, now, gap: 0, out });
    assert.ok(!r.rows.some(x => x[0] === "2026-11-04"), "休市日沒有漲跌家數");
    assert.ok(r.rows.some(x => x[0] === "2026-11-03") && r.rows.some(x => x[0] === "2026-11-05"));
    assert.deepEqual(r.holes.find(h => h[0] === "2026-11-04"), ["2026-11-04", 1], "第一次：記一次，下次再問");
    const r2 = await main({ fetchDay, now, gap: 0, out });
    assert.deepEqual(r2.holes.find(h => h[0] === "2026-11-04"), ["2026-11-04", 2], "第二次：當成休市，不再問");
    let asked = 0; await main({ fetchDay: async d => { if (d === HOL) asked++; return fetchDay(d); }, now, gap: 0, out });
    assert.equal(asked, 0, "已經確定休市的日子不再重抓");
    // 雙市場同時回前一天的資料（筆數完整、上市櫃都有）：full() 擋不住，要靠日期
    const both = async d => (d === "20261109" ? day(d, { tseDate: "2026-11-06", otcDate: "2026-11-06" }) : fetchDay(d));
    const dir2 = await mkdtemp(path.join(tmpdir(), "breadth-")), r3 = await main({ fetchDay: both, now, gap: 0, out: path.join(dir2, "b.json") });
    assert.ok(!r3.rows.some(x => x[0] === "2026-11-09"), "今天的舊資料不存");
    assert.ok(!r3.holes.some(h => h[0] === "2026-11-09"), "今天、昨天不記成休市（之後還會重抓）");
    await rm(dir2, { recursive: true, force: true });
  } finally { console.log = log; await rm(dir, { recursive: true, force: true }); }
});

test("market-after：休市日的舊資料不當成那一天的排行（回 null，主程式往前找上一個交易日）", async () => {
  const { dayData } = await import("../scripts/market-after.mjs");
  const log = console.log, said = []; console.log = (...a) => said.push(a.join(" "));
  try {
    assert.equal(await dayData(HOL, 0, fetchDay), null);
    assert.ok(said.some(s => /不用這一天/.test(s) && /2026-11-03/.test(s)), "要印出原因：" + said.join("｜"));
    assert.equal(await dayData("20261105", 0, async d => day(d, { tse: 200, otc: 200 })), null, "筆數不夠照舊回 null");
  } finally { console.log = log; }
});
