// 櫃買產業價值鏈抓取器：部分產業抓不到時沿用上一份（標 stale 與原本的時間）、不把舊資料當成新資料、原子寫入
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeWithPrev, writeAtomic, STALE_DAYS } from "../scripts/tpex-ic.mjs";

const NOW = "2026-11-15T01:40:00.000Z", OLD = "2026-11-08T01:40:00.000Z";
const seg = (id, code) => ({ id, name: "段" + id, stage: "上游", codes: [[code, "公司" + code]] });
const ind = (id, name, code) => ({ id, name, segs: [seg(id + "1", code)] });
const inds = [{ id: "A", name: "半導體" }, { id: "B", name: "電動車" }, { id: "C", name: "生技" }];

test("全部抓到：和以前一樣，沒有 stale、沒有 missing", () => {
  const fresh = inds.map((I, k) => ind(I.id, I.name, String(1000 + k)));
  const r = mergeWithPrev(inds, fresh, { updated: OLD, industries: [ind("A", "半導體", "9999")] }, NOW);
  assert.equal(r.updated, NOW); assert.deepEqual(r.industries, fresh); assert.equal(r.missing, undefined);
  assert.ok(r.industries.every(I => !I.stale));
});

test("部分產業抓不到：沿用上一份同一個產業，標 stale 與原本的更新時間，順序照首頁", () => {
  const prev = { updated: OLD, industries: [ind("A", "半導體", "9001"), ind("B", "電動車", "9002"), ind("C", "生技", "9003")] };
  const r = mergeWithPrev(inds, [ind("A", "半導體", "1000"), ind("C", "生技", "1002")], prev, NOW);
  assert.deepEqual(r.industries.map(I => I.id), ["A", "B", "C"]);
  const B = r.industries[1];
  assert.equal(B.stale, true); assert.equal(B.asOf, OLD, "沿用的資料保留原本的時間，不是這次的 updated");
  assert.deepEqual(B.segs, prev.industries[1].segs);
  assert.ok(!r.industries[0].stale && !r.industries[2].stale, "這次抓到的不標 stale");
  assert.equal(r.missing, undefined);
});

test("連續兩次抓不到：asOf 維持最早那份資料的時間，不會被中間那次的 updated 蓋掉", () => {
  const prev = { updated: OLD, industries: [ind("A", "半導體", "1000"), { ...ind("B", "電動車", "9002"), stale: true, asOf: "2026-11-01T01:40:00.000Z" }] };
  const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], prev, NOW);
  assert.equal(r.industries[1].asOf, "2026-11-01T01:40:00.000Z");
});

test(`沿用超過 ${STALE_DAYS} 天就不再沿用，放進 missing`, () => {
  const tooOld = new Date(Date.parse(NOW) - (STALE_DAYS + 1) * 864e5).toISOString();
  const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated: tooOld, industries: [ind("B", "電動車", "9002")] }, NOW);
  assert.deepEqual(r.industries.map(I => I.id), ["A"]); assert.deepEqual(r.missing, [{ id: "B", name: "電動車" }]);
  const ok = new Date(Date.parse(NOW) - (STALE_DAYS - 1) * 864e5).toISOString();
  assert.equal(mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated: ok, industries: [ind("B", "電動車", "9002")] }, NOW).industries[1].stale, true);
});

test("舊檔的時間讀不到、或比這次執行還晚：不沿用，放進 missing（避免時間錯誤讓舊資料一直被當成可用）", () => {
  for (const updated of [undefined, "", "不是日期", "2026-13-40", new Date(Date.parse(NOW) + 2 * 864e5).toISOString()]) {
    const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated, industries: [ind("B", "電動車", "9002")] }, NOW);
    assert.deepEqual(r.industries.map(I => I.id), ["A"], String(updated)); assert.deepEqual(r.missing, [{ id: "B", name: "電動車" }]);
  }
  // 已經是 stale 的產業，asOf 壞掉也一樣
  const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated: OLD, industries: [{ ...ind("B", "電動車", "9002"), stale: true, asOf: "壞掉" }] }, NOW);
  assert.deepEqual(r.missing, [{ id: "B", name: "電動車" }]);
  // 容許 1 天內的時鐘偏差
  const near = new Date(Date.parse(NOW) + 3600e3).toISOString();
  assert.equal(mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated: near, industries: [ind("B", "電動車", "9002")] }, NOW).industries[1].stale, true);
});

test("沒有舊檔、舊檔壞掉、舊檔沒有那個產業：抓不到的放進 missing，不編造資料", () => {
  for (const prev of [null, {}, { updated: OLD, industries: "壞掉" }, { updated: OLD, industries: [ind("A", "半導體", "9001")] }, { updated: OLD, industries: [{ id: "B", name: "電動車", segs: [] }] }]) {
    const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], prev, NOW);
    assert.deepEqual(r.industries.map(I => I.id), ["A"], JSON.stringify(prev)); assert.deepEqual(r.missing, [{ id: "B", name: "電動車" }]);
  }
});

test("舊檔是合法 JSON 但紀錄壞掉：不拋錯、不沿用壞資料，抓不到的放進 missing；好的紀錄照常沿用", () => {
  const bad = [null, "字串", 42, [], {}, { id: 7, segs: [seg("B1", "9002")] }, { id: "B" }, { id: "B", segs: "x" }, { id: "B", segs: [] }, { id: "B", segs: [null] },
    { id: "B", segs: [{ id: "B1", name: "段", codes: [] }] }, { id: "B", segs: [{ id: "B1", name: "段", codes: [["9002"]] }] }, { id: "B", segs: [{ id: "B1", codes: [["9002", "x"]] }] },
    { id: "B", segs: [{ id: "B1", name: "段", codes: [[9002, "x"]] }] }];
  for (const b of bad) {
    const r = mergeWithPrev(inds.slice(0, 2), [ind("A", "半導體", "1000")], { updated: OLD, industries: [b] }, NOW);
    assert.deepEqual(r.industries.map(I => I.id), ["A"], JSON.stringify(b)); assert.deepEqual(r.missing, [{ id: "B", name: "電動車" }], JSON.stringify(b));
  }
  // 壞紀錄和好紀錄混在一起：好的照常沿用
  const r = mergeWithPrev(inds, [ind("A", "半導體", "1000")], { updated: OLD, industries: [null, "x", ind("B", "電動車", "9002"), { id: "C", segs: [null] }] }, NOW);
  assert.deepEqual(r.industries.map(I => [I.id, !!I.stale]), [["A", false], ["B", true]]); assert.deepEqual(r.missing, [{ id: "C", name: "生技" }]);
});

test("首頁上已經沒有的產業：不從舊檔帶回來；名稱用首頁現在的名稱", () => {
  const prev = { updated: OLD, industries: [ind("A", "半導體", "9001"), ind("Z", "已移除", "9009")] };
  const r = mergeWithPrev([{ id: "A", name: "半導體業" }, { id: "B", name: "電動車" }], [ind("B", "電動車", "1001")], prev, NOW);
  assert.deepEqual(r.industries.map(I => I.id), ["A", "B"]); assert.equal(r.industries[0].name, "半導體業");
  assert.ok(!JSON.stringify(r).includes("已移除"));
});

test("原子寫入：成功時正式檔是新內容、沒有留下暫存檔；失敗時正式檔不變、暫存檔清掉", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tpexic-")), file = join(dir, "tpex-ic.json");
  try {
    writeFileSync(file, '{"old":1}');
    await writeAtomic(file, '{"new":1}');
    assert.equal(readFileSync(file, "utf8"), '{"new":1}'); assert.deepEqual(readdirSync(dir), ["tpex-ic.json"]);
    // 正式路徑是資料夾 → rename 失敗；暫存檔要清掉，原本的東西不動
    const blocked = join(dir, "blocked.json"); mkdirSync(blocked);
    await assert.rejects(writeAtomic(blocked, '{"x":1}'));
    assert.deepEqual(readdirSync(dir).sort(), ["blocked.json", "tpex-ic.json"]);
    assert.equal(readFileSync(file, "utf8"), '{"new":1}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
