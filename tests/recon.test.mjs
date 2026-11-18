// 對帳引擎 learner/recon.js（KLRecon）單元測試：固定假資料，不連網、不觸碰瀏覽器存檔。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

function loadLedgerAndRecon() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../learner/ledger.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../learner/recon.js", import.meta.url), "utf8"), ctx);
  return { L: ctx.KLLedger, R: ctx.KLRecon };
}

const J = x => JSON.parse(JSON.stringify(x));

test("validateStore：拒絕圖片/base64、壞版本、缺正均價、跨市場衝突與未來確認日；pendingCommit 載入 vs rejectPendingCommit", () => {
  const { R } = loadLedgerAndRecon();
  const base = R.emptyStore();
  assert.equal(R.validateStore(base, { today: "2026-11-16" }).ok, true);
  assert.equal(R.validateStore({ ...base, v: 2 }).ok, false);

  // 禁止 data:image 或 >2000 字元 base64
  const imgStore = R.cloneStore(base);
  imgStore.audit.push({ id: "a1", at: "2026-11-16T00:00:00Z", action: "x", reason: "data:image/png;base64,AAAA" });
  assert.equal(R.validateStore(imgStore).code, "image_not_allowed");

  const b64Store = R.cloneStore(base);
  b64Store.imports.push({ id: "i1", at: "2026-11-16T00:00:00Z", raw: "A".repeat(2100) });
  assert.equal(R.validateStore(b64Store).code, "image_not_allowed");

  // 非 full_snapshot_close 之 confirmed 缺正均價
  const noCost = R.cloneStore(base);
  noCost.snapshots.push({ id: "s1", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-10", shares: 1000, avgCost: 0, status: "confirmed", scope: "partial", origin: "import" });
  assert.equal(R.validateStore(noCost, { today: "2026-11-16" }).ok, false);

  // full_snapshot_close 允許 shares=0, avgCost=null, scope="full"
  const closedSnap = R.cloneStore(base);
  closedSnap.snapshots.push({ id: "s1c", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-15", shares: 0, avgCost: null, status: "confirmed", scope: "full", origin: "full_snapshot_close" });
  assert.equal(R.validateStore(closedSnap, { today: "2026-11-16" }).ok, true);

  // tw/USD 錯配 & 跨快照同 symbol 不同市場
  const mktMismatch = R.cloneStore(base);
  mktMismatch.snapshots.push({ id: "s1", symbol: "2330", market: "tw", currency: "USD", date: "2026-11-10", shares: 1000, avgCost: 900, status: "confirmed", scope: "partial", origin: "import" });
  assert.equal(R.validateStore(mktMismatch, { today: "2026-11-16" }).ok, false);

  const symConflict = R.cloneStore(base);
  symConflict.snapshots.push({ id: "s1", symbol: "NVDA", market: "us", currency: "USD", date: "2026-11-01", shares: 10, avgCost: 120, status: "confirmed", scope: "partial", origin: "import" });
  symConflict.snapshots.push({ id: "s2", symbol: "nvda", market: "tw", currency: "TWD", date: "2026-11-10", shares: 10, avgCost: 3000, status: "pending", scope: "partial", origin: "import" });
  assert.equal(R.validateStore(symConflict, { today: "2026-11-16" }).code, "currency_conflict");

  // 未來 confirmed 快照日被拒
  const futureSnap = R.cloneStore(base);
  futureSnap.snapshots.push({ id: "sf", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-20", shares: 1000, avgCost: 900, status: "confirmed", scope: "partial", origin: "import" });
  assert.equal(R.validateStore(futureSnap, { today: "2026-11-16" }).code, "future_snapshot_date");

  // pendingCommit 一般載入保留未知 op；rejectPendingCommit: true 下拒絕
  const withWal = R.cloneStore(base);
  withWal.pendingCommit = { id: "b1", op: "future_unknown_v2", at: "2026-11-16T00:00:00Z" };
  assert.equal(R.validateStore(withWal, { today: "2026-11-16" }).ok, true);
  assert.equal(R.validateStore(withWal, { today: "2026-11-16", rejectPendingCommit: true }).code, "unrecovered_pending_commit");
});

test("txFingerprint（Spec 五組向量）、deriveAvgCost、withinTolerance 與 settlementHint", () => {
  const { R } = loadLedgerAndRecon();
  const A = { id: "t1", date: "2026-11-10", type: "transfer_in", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 900, fee: 0, tax: 0, note: "" };
  const B = { note: "", tax: 0, fee: 0, price: 900, shares: 1000, currency: "TWD", market: "tw", symbol: "2330", type: "transfer_in", date: "2026-11-10", id: "t1", extra: undefined };
  const C = { ...A, price: 901 };
  const D = { id: "t2", date: "2026-11-12", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 1.5, price: 180.25, fee: 1, tax: 0, note: "分批 #1" };

  assert.equal(R.txFingerprint(A), "fp1:2f0a9972b064eb73ae07271267fa7c14:151");
  assert.equal(R.txFingerprint(B), "fp1:2f0a9972b064eb73ae07271267fa7c14:151");
  assert.equal(R.txFingerprint(C), "fp1:95800b8f131f02d1377fefe8bcfd5446:151");
  assert.equal(R.txFingerprint(D), "fp1:817f348042cc7d1b6fccf93dc8cf279b:150");
  assert.equal(R.txFingerprint({}), "fp1:58e46dc64f30ae7ba2ecdf40d8e8a490:2");

  // deriveAvgCost
  assert.equal(R.deriveAvgCost({ shares: 1000, avgCost: 900 }), 900);
  assert.equal(R.deriveAvgCost({ shares: 1000, avgCost: null, price: 950, totalPnl: 50000 }), 900);
  assert.equal(R.deriveAvgCost({ shares: 1000, avgCost: 0, marketValue: 950000, totalPnl: 50000 }), 900);
  assert.equal(R.deriveAvgCost({ shares: 1000, avgCost: null, price: 50, totalPnl: 60000 }), null, "推導為負值不得回傳");
  assert.equal(R.deriveAvgCost({ shares: 0, avgCost: null, price: 50, totalPnl: 0 }), null);

  // withinTolerance
  assert.equal(R.withinTolerance(1000, 900, 1000, 901).ok, true);
  assert.equal(R.withinTolerance(1000, 900, 1005, 900).ok, false);
  assert.equal(R.withinTolerance(1000, 100, 1000, 102).ok, false);

  // settlementHint
  assert.match(R.settlementHint("tw"), /台股 T\+2/);
  assert.match(R.settlementHint("us"), /美股 T\+1/);
  assert.doesNotMatch(R.settlementHint("us"), /T\+2/);
  assert.doesNotMatch(R.settlementHint(""), /T\+2|T\+1/);
});

test("pruneStore：正常裁剪保留核心與關聯匯入；核心超限強制回傳 core_data_exceeds_limit", () => {
  const { R } = loadLedgerAndRecon();
  const s = R.emptyStore();
  s.snapshots.push({ id: "snap-conf", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-10", shares: 1000, avgCost: 900, status: "confirmed", scope: "partial", origin: "import" });
  s.conflicts.push({ id: "c-open", kind: "recon_diff", symbol: "2330", market: "tw", currency: "TWD", batchId: "imp-linked", status: "open", createdAt: "2026-11-10T00:00:00Z" });
  s.imports.push({ id: "imp-linked", at: "2026-01-01T00:00:00Z", kind: "holdings", snapshotScope: "partial", fileHashes: ["h1"], level1Count: 0, level2Count: 1, level3Count: 0, rows: [] });
  s.initialTags.tx1 = { txId: "tx1", snapshotId: "snap-conf", active: true, txHash: R.txFingerprint({ id: "tx1" }) };
  s.sameDayRelations.tx2 = { relation: "after_snapshot", snapshotId: "snap-conf", snapshotDate: "2026-11-10" };
  for (let i = 0; i < 300; i++) {
    const dt = `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`;
    s.imports.push({ id: "imp-" + i, at: dt, kind: "trades", fileHashes: ["hx" + i], level1Count: 1, level2Count: 0, level3Count: 0, rows: [{ symbol: "2330", note: "N".repeat(200) }] });
    s.audit.push({ id: "aud-" + i, at: dt, action: "note", reason: "R".repeat(200) });
    s.conflicts.push({ id: "c-" + i, kind: "recon_diff", symbol: "2317", market: "tw", currency: "TWD", batchId: "imp-" + i, status: "resolved", createdAt: dt });
  }
  for (let i = 0; i < 20; i++) {
    s.snapshots.push({ id: "sup-" + i, symbol: "2330", market: "tw", currency: "TWD", date: "2026-03-01", shares: 1000, avgCost: 800 + i, status: "superseded", scope: "partial", origin: "import" });
  }
  const pr = R.pruneStore(s, 120000);
  assert.equal(pr.ok, true);
  assert.ok(pr.bytes <= 120000);
  assert.ok(pr.store.snapshots.some(x => x.id === "snap-conf"));
  assert.ok(pr.store.conflicts.some(x => x.id === "c-open"));
  assert.ok(pr.store.imports.some(x => x.id === "imp-linked"), "關聯未決衝突的 import 永不裁剪");
  assert.equal(pr.store.initialTags.tx1.active, true);
  assert.equal(pr.store.sameDayRelations.tx2.relation, "after_snapshot");

  // 不可裁剪核心超過 maxBytes → fail-closed
  const huge = R.emptyStore();
  for (let i = 0; i < 40; i++) {
    huge.conflicts.push({ id: "hc-" + i, kind: "recon_diff", symbol: "S" + i, market: "tw", currency: "TWD", status: "open", createdAt: "2026-11-10T00:00:00Z", reason: "X".repeat(250) });
  }
  const failPr = R.pruneStore(huge, 4000);
  assert.equal(failPr.ok, false);
  assert.equal(failPr.code, "core_data_exceeds_limit");
  assert.equal(failPr.store, null);
  assert.ok(failPr.bytes > 4000);
});

test("WAL Commit Protocol：import_trades / deactivate_tags / update_tx_tag（含只改備註與雙狀態相等）、未知op、resolveHalted（含 P1-2 防護）與雙鍵失敗模擬", () => {
  const { R } = loadLedgerAndRecon();
  const basePf = { v: 1, method: "avg", transactions: [{ id: "old1", date: "2026-11-01", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 1000, price: 150, fee: 0, tax: 0, note: "" }] };
  const txNew1 = { id: "tr1", date: "2026-11-12", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 500, price: 920, fee: 0, tax: 0, note: "" };
  const txNew2 = { id: "tr2", date: "2026-11-12", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 500, price: 920, fee: 0, tax: 0, note: "" };
  const nextPf = { ...basePf, transactions: [...basePf.transactions, txNew1, txNew2] };
  const payloadImp = {
    id: "wal-imp-1",
    op: "import_trades",
    at: "2026-11-12T08:00:00Z",
    txs: [txNew1, txNew2],
    txHashes: { tr1: R.txFingerprint(txNew1), tr2: R.txFingerprint(txNew2) },
    pfBaseHash: R.pfStoreHash(basePf),
    pfNextHash: R.pfStoreHash(nextPf),
    staged: {
      imports: [{ id: "imp-wal-1", at: "2026-11-12T08:00:00Z", kind: "trades", fileHashes: ["fh1"], level1Count: 2, level2Count: 0, level3Count: 0, rows: [] }],
      audit: [{ id: "aud-wal-1", at: "2026-11-12T08:00:00Z", action: "trades_imported", symbol: "2330", batchId: "wal-imp-1" }],
    },
  };

  // 1a. import_trades: prepareCommit + Phase 1 Abort
  const prep1 = R.prepareCommit(R.emptyStore(), payloadImp);
  assert.equal(prep1.ok, true);
  assert.equal(R.prepareCommit(prep1.store, payloadImp).code, "pending_commit_exists", "已有未決 WAL 不可再開新 WAL");
  const ab1 = R.recoverCommit(basePf, prep1.store);
  assert.equal(ab1.changed, true);
  assert.equal(ab1.status, "aborted");
  assert.equal(ab1.reconStore.pendingCommit, null);
  assert.equal(ab1.reconStore.audit.length, 0);

  // 1b. Phase 2->3 Roll-Forward + 重複呼叫冪等零重複
  const rf1 = R.recoverCommit(nextPf, prep1.store);
  assert.equal(rf1.changed, true);
  assert.equal(rf1.status, "rolled_forward");
  assert.equal(rf1.reconStore.pendingCommit, null);
  assert.equal(rf1.reconStore.audit.length, 1);
  assert.equal(rf1.reconStore.imports.length, 1);
  // 若預先已殘留相同 id audit，finalize / recover 必須去重
  const dupAuditWal = R.cloneStore(prep1.store);
  dupAuditWal.audit.push(J(payloadImp.staged.audit[0]));
  const rf1Dup = R.recoverCommit(nextPf, dupAuditWal);
  assert.equal(rf1Dup.reconStore.audit.length, 1);
  assert.equal(R.recoverCommit(nextPf, rf1Dup.reconStore).changed, false);

  // 1c. import_trades 部分存在 / 指紋不符 / pfNextHash 不符 / pfBaseHash 不符 → inconsistent_halted
  const partialPf = { ...basePf, transactions: [...basePf.transactions, txNew1] };
  assert.equal(R.recoverCommit(partialPf, prep1.store).code, "wal_partial_import");
  const mismatchPf = { ...basePf, transactions: [...basePf.transactions, txNew1, { ...txNew2, price: 999 }] };
  assert.equal(R.recoverCommit(mismatchPf, prep1.store).code, "wal_tx_mismatch");
  const extraTxNextPf = { ...nextPf, transactions: [...nextPf.transactions, { id: "ext1", date: "2026-11-12", type: "deposit", symbol: null, market: "tw", currency: "TWD", shares: null, price: null, amount: 1000, fee: 0, tax: 0, note: "" }] };
  const haltPfHash = R.recoverCommit(extraTxNextPf, prep1.store);
  assert.equal(haltPfHash.status, "inconsistent_halted");
  assert.equal(haltPfHash.code, "wal_pf_hash_mismatch");
  assert.ok(haltPfHash.reconStore.pendingCommit != null, "Fail-Closed 保留 WAL");
  const modBasePf = { ...basePf, transactions: [...basePf.transactions, { ...txNew1, id: "other" }] };
  assert.equal(R.recoverCommit(modBasePf, prep1.store).code, "wal_external_modification");

  // 2. deactivate_tags (含與 B_newer 並存 & 單獨存在)
  const txTag = { v: 1, id: "tinit", date: "2026-11-01", type: "transfer_in", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 850, fee: 0, tax: 0, note: "期初" };
  let reconTag = R.emptyStore();
  const taggedRes = R.tagInitialTx(reconTag, txTag, { today: "2026-11-16", snapshotId: "snap-init", at: "2026-11-05T00:00:00Z" });
  assert.equal(taggedRes.ok, true);
  reconTag = taggedRes.store;
  reconTag.snapshots.push({ id: "snap-newer", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-10", shares: 1000, avgCost: 850, status: "confirmed", confirmedAt: "2026-11-10T00:00:00Z", scope: "partial", origin: "import", supersededBy: null });
  const pfWithTag = { v: 1, method: "avg", transactions: [J(txTag)] };
  const pfDelTag = { v: 1, method: "avg", transactions: [] };
  const planDel = R.planDeactivateTags(reconTag, txTag, { batchId: "wal-del-1", at: "2026-11-15T00:00:00Z" });
  assert.equal(planDel.ok, true);
  assert.equal(planDel.needsWal, true);
  const prepDel = R.prepareCommit(reconTag, planDel.payload);
  assert.equal(prepDel.ok, true);
  assert.equal(R.recoverCommit(pfWithTag, prepDel.store).status, "aborted");
  const rfDel = R.recoverCommit(pfDelTag, prepDel.store);
  assert.equal(rfDel.status, "rolled_forward");
  assert.equal(rfDel.reconStore.initialTags.tinit.active, false);
  assert.equal(rfDel.reconStore.snapshots.find(s => s.id === "snap-init").status, "superseded");
  assert.equal(rfDel.reconStore.snapshots.find(s => s.id === "snap-init").avgCost, 850, "停用不得清為 0");
  assert.equal(rfDel.reconStore.snapshots.find(s => s.id === "snap-newer").status, "confirmed", "絕不破壞更晚 B_newer");
  assert.equal(R.recoverCommit(pfWithTag, { ...prepDel.store, initialTags: rfDel.reconStore.initialTags, snapshots: rfDel.reconStore.snapshots }).status, "inconsistent_halted");

  // 3. update_tx_tag: 改價 update / 只改備註（雙態相等）/ 改類型 deactivate / 不一致
  const txUpdated = { ...txTag, price: 880 };
  const planUpd = R.planUpdateTxTag(reconTag, txTag, txUpdated, { batchId: "wal-upd-1", at: "2026-11-15T01:00:00Z", today: "2026-11-16" });
  assert.equal(planUpd.mode, "update");
  const prepUpd = R.prepareCommit(reconTag, planUpd.payload);
  assert.equal(prepUpd.ok, true);
  assert.equal(R.recoverCommit({ v: 1, method: "avg", transactions: [txTag] }, prepUpd.store).status, "aborted");
  const rfUpd = R.recoverCommit({ v: 1, method: "avg", transactions: [txUpdated] }, prepUpd.store);
  assert.equal(rfUpd.status, "rolled_forward");
  assert.equal(rfUpd.reconStore.snapshots.find(s => s.id === "snap-init").avgCost, 880);
  assert.equal(rfUpd.reconStore.initialTags.tinit.txHash, R.txFingerprint(txUpdated));
  // Phase 3 殘留（已更新 targetTagState 但 pendingCommit 未清）：冪等 Roll-Forward 零重複
  const phase3Wal = { ...rfUpd.reconStore, pendingCommit: J(prepUpd.store.pendingCommit) };
  const rfUpd3 = R.recoverCommit({ v: 1, method: "avg", transactions: [txUpdated] }, phase3Wal);
  assert.equal(rfUpd3.status, "rolled_forward");
  assert.equal(rfUpd3.reconStore.audit.length, rfUpd.reconStore.audit.length);

  // 只改備註（prevTagState === targetTagState）
  const txNoteOnly = { ...txTag, note: "備註更新" };
  const planNote = R.planUpdateTxTag(reconTag, txTag, txNoteOnly, { batchId: "wal-note-1", at: "2026-11-15T02:00:00Z", today: "2026-11-16" });
  assert.equal(planNote.needsWal, true);
  assert.deepEqual(planNote.payload.prevTagState, planNote.payload.targetTagState);
  const prepNote = R.prepareCommit(reconTag, planNote.payload);
  assert.equal(R.recoverCommit({ v: 1, method: "avg", transactions: [txTag] }, prepNote.store).status, "aborted");
  const rfNote = R.recoverCommit({ v: 1, method: "avg", transactions: [txNoteOnly] }, prepNote.store);
  assert.equal(rfNote.status, "rolled_forward");
  assert.equal(rfNote.reconStore.initialTags.tinit.txHash, R.txFingerprint(txNoteOnly));

  // 改類型為 buy → mode="deactivate"，保留原正數 avgCost
  const txToBuy = { ...txTag, type: "buy" };
  const planDeact = R.planUpdateTxTag(reconTag, txTag, txToBuy, { batchId: "wal-deact-1", at: "2026-11-15T03:00:00Z", today: "2026-11-16" });
  assert.equal(planDeact.mode, "deactivate");
  const prepDeact = R.prepareCommit(reconTag, planDeact.payload);
  const rfDeact = R.recoverCommit({ v: 1, method: "avg", transactions: [txToBuy] }, prepDeact.store);
  assert.equal(rfDeact.status, "rolled_forward");
  assert.equal(rfDeact.reconStore.initialTags.tinit.active, false);
  assert.equal(rfDeact.reconStore.snapshots.find(s => s.id === "snap-init").avgCost, 850);

  // 不一致：交易消失 / 第三版本指紋 / prevTxHash + targetTagState
  assert.equal(R.recoverCommit({ v: 1, method: "avg", transactions: [] }, prepUpd.store).status, "inconsistent_halted");
  assert.equal(R.recoverCommit({ v: 1, method: "avg", transactions: [{ ...txTag, price: 999 }] }, prepUpd.store).status, "inconsistent_halted");
  assert.equal(R.recoverCommit({ v: 1, method: "avg", transactions: [txTag] }, { ...rfUpd.reconStore, pendingCommit: J(prepUpd.store.pendingCommit) }).status, "inconsistent_halted");

  // 4. 未知 op & 未知指紋前綴 fail-closed
  const unkWal = { ...R.emptyStore(), pendingCommit: { id: "u1", op: "future_unknown_v2", at: "2026-11-16T00:00:00Z" } };
  const unkRec = R.recoverCommit(basePf, unkWal);
  assert.equal(unkRec.changed, false);
  assert.equal(unkRec.status, "unknown_op_halted");
  assert.deepEqual(J(unkRec.reconStore.pendingCommit), unkWal.pendingCommit);

  const badPrefixWal = { ...R.emptyStore(), pendingCommit: { ...payloadImp, pfBaseHash: "sha256:bad" } };
  assert.equal(R.recoverCommit(basePf, badPrefixWal).status, "inconsistent_halted");

  // 5. resolveHalted：discard_wal（含 import_trades missingCount/symbols）與 revert_pre_commit（含 P1-2 第三版本守門）
  const haltedImp = R.resolveHalted(partialPf, prep1.store, "discard_wal", { at: "2026-11-16T01:00:00Z" });
  assert.equal(haltedImp.ok, true);
  assert.equal(haltedImp.pfChanged, false);
  assert.equal(haltedImp.reconStore.pendingCommit, null);
  assert.equal(haltedImp.summary.missingCount, 1);
  assert.deepEqual(J(haltedImp.summary.missingSymbols), ["2330"]);
  assert.equal(haltedImp.reconStore.audit.at(-1).action, "halted_resolved_discard_wal");

  // unknown_op_halted 拒用 revert_pre_commit，但可用 discard_wal
  assert.equal(R.resolveHalted(basePf, unkWal, "revert_pre_commit").code, "revert_not_supported");
  assert.equal(R.resolveHalted(basePf, unkWal, "discard_wal").ok, true);

  // P1-2 revert_pre_commit：第三版本 / 重建 / 第三標籤態 → revert_conflict_modified 且保留 WAL
  const modifiedImpPf = { ...basePf, transactions: [...basePf.transactions, { ...txNew1, note: "使用者已再編輯" }] };
  const revConflictImp = R.resolveHalted(modifiedImpPf, prep1.store, "revert_pre_commit");
  assert.equal(revConflictImp.ok, false);
  assert.equal(revConflictImp.code, "revert_conflict_modified");
  assert.ok(revConflictImp.reconStore.pendingCommit != null, "拒絕回退時必須保留 WAL");

  // import_trades 部分正常回退
  const revOkImp = R.resolveHalted(partialPf, prep1.store, "revert_pre_commit", { at: "2026-11-16T01:05:00Z" });
  assert.equal(revOkImp.ok, true);
  assert.equal(revOkImp.pfChanged, true);
  assert.equal(revOkImp.pfStore.transactions.length, 1);
  assert.equal(revOkImp.reconStore.pendingCommit, null);

  // update_tx_tag 第三版本拒絕回退 vs 合法狀態回退
  const thirdVerUpd = R.resolveHalted({ v: 1, method: "avg", transactions: [{ ...txUpdated, price: 777 }] }, prepUpd.store, "revert_pre_commit");
  assert.equal(thirdVerUpd.code, "revert_conflict_modified");
  const thirdSnapState = R.cloneStore(rfUpd.reconStore);
  thirdSnapState.pendingCommit = J(prepUpd.store.pendingCommit);
  thirdSnapState.snapshots.find(s => s.id === "snap-init").avgCost = 999;
  assert.equal(R.resolveHalted({ v: 1, method: "avg", transactions: [txUpdated] }, thirdSnapState, "revert_pre_commit").code, "revert_conflict_modified");
  const revUpdOk = R.resolveHalted({ v: 1, method: "avg", transactions: [txUpdated] }, { ...rfUpd.reconStore, pendingCommit: J(prepUpd.store.pendingCommit) }, "revert_pre_commit");
  assert.equal(revUpdOk.ok, true);
  assert.equal(revUpdOk.pfStore.transactions[0].price, 850);
  assert.equal(revUpdOk.reconStore.snapshots.find(s => s.id === "snap-init").avgCost, 850);

  // deactivate_tags 重建不同指紋拒絕回退 vs 合法回退
  const recreatedDelPf = { v: 1, method: "avg", transactions: [{ ...txTag, price: 999 }] };
  assert.equal(R.resolveHalted(recreatedDelPf, prepDel.store, "revert_pre_commit").code, "revert_conflict_modified");
  const revDelOk = R.resolveHalted(pfDelTag, { ...rfDel.reconStore, pendingCommit: J(prepDel.store.pendingCommit) }, "revert_pre_commit");
  assert.equal(revDelOk.ok, true);
  assert.equal(revDelOk.pfStore.transactions.length, 1);
  assert.equal(revDelOk.reconStore.initialTags.tinit.active, true);
});

test("planHoldingsSnapshot & applyHoldingsImport：partial vs full 清倉、year/future 嚴格門檻、S1→S2 容差與市場衝突、resolveConflict", () => {
  const { L, R } = loadLedgerAndRecon();
  const s1Store = R.emptyStore();
  const plan0 = R.planHoldingsSnapshot({
    store: s1Store,
    ledgerPositions: [],
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b0",
    asOf: "2026-11-10",
    asOfStatus: "exact",
    snapshotScope: "partial",
    rows: [{ code: "2330", name: "台積電", shares: 1000, avgCost: 900, price: 950 }],
    fileHashes: ["h0"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const app0 = R.applyHoldingsImport(s1Store, plan0, { at: "2026-11-10T09:00:00Z" });
  assert.equal(app0.ok, true);
  assert.equal(app0.appliedCount, 1);
  assert.equal(R.activeBaselines(app0.store).get("2330").shares, 1000);

  // 同圖雜湊命中 findRepeatHash
  assert.equal(R.findRepeatHash(app0.store, ["h0"]).hit, true);

  // 1. snapshotScope="partial" 匯入不含 2330 的新截圖 → 2330 保留
  const planPartial = R.planHoldingsSnapshot({
    store: app0.store,
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b-part",
    asOf: "2026-11-15",
    asOfStatus: "exact",
    snapshotScope: "partial",
    rows: [{ code: "NVDA", name: "輝達", shares: 10, avgCost: 120 }],
    fileHashes: ["hp"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const appPartial = R.applyHoldingsImport(app0.store, planPartial, { at: "2026-11-15T09:00:00Z" });
  assert.equal(R.activeBaselines(appPartial.store).get("2330").shares, 1000, "partial 不得清倉未出現在截圖的舊股");
  assert.equal(R.activeBaselines(appPartial.store).get("NVDA").shares, 10);

  // 2a. snapshotScope="full" 且帳本期間已賣光 2330 → 自動產生 full_snapshot_close 關閉 S1
  const soldOutTx = { id: "s1", date: "2026-11-12", type: "sell", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 960, fee: 0, tax: 0, note: "" };
  const planFullAutoClose = R.planHoldingsSnapshot({
    store: app0.store,
    txStore: { v: 1, method: "avg", transactions: [soldOutTx] },
    batchId: "b-full-1",
    asOf: "2026-11-15",
    asOfStatus: "exact",
    snapshotScope: "full",
    rows: [{ code: "NVDA", name: "輝達", shares: 10, avgCost: 120 }],
    fileHashes: ["hf1"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const appFullClose = R.applyHoldingsImport(app0.store, planFullAutoClose, { at: "2026-11-15T10:00:00Z" });
  assert.equal(R.activeBaselines(appFullClose.store).get("2330").origin, "full_snapshot_close");
  assert.equal(R.activeBaselines(appFullClose.store).get("2330").shares, 0);

  // 2b. snapshotScope="full" 但帳本仍計算出 1000 股 → 留 S1 並建 pending + recon_diff(targetShares:0)，resolveConflict accept_new 后關閉 S1
  const planFullDiff = R.planHoldingsSnapshot({
    store: app0.store,
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b-full-2",
    asOf: "2026-11-15",
    asOfStatus: "exact",
    snapshotScope: "full",
    rows: [{ code: "NVDA", name: "輝達", shares: 10, avgCost: 120 }],
    fileHashes: ["hf2"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const appFullDiff = R.applyHoldingsImport(app0.store, planFullDiff, { at: "2026-11-15T11:00:00Z" });
  assert.equal(R.activeBaselines(appFullDiff.store).get("2330").shares, 1000, "未確認清倉前 S1 續留");
  const closeConf = appFullDiff.store.conflicts.find(c => c.symbol === "2330" && c.kind === "recon_diff");
  assert.equal(closeConf.targetShares, 0);
  assert.equal(closeConf.payload.reason, "missing_in_full_snapshot");
  assert.equal(R.resolveConflict(appFullDiff.store, closeConf.id, "accept_new", { reason: "" }).ok, false, "accept_new 必填原因");
  const resClose = R.resolveConflict(appFullDiff.store, closeConf.id, "accept_new", { reason: "已確認出清", at: "2026-11-15T12:00:00Z", today: "2026-11-16" });
  assert.equal(resClose.ok, true);
  assert.equal(R.activeBaselines(resClose.store).get("2330").origin, "full_snapshot_close");
  assert.equal(R.activeBaselines(resClose.store).get("2330").shares, 0);

  // 3. year & future 嚴格門檻：asOfConfirmed=false 時不建 confirmed；確認且 <= today 才升 Level 1
  const planYear = R.planHoldingsSnapshot({
    store: R.emptyStore(),
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b-yr",
    asOf: "2025-12-28",
    asOfStatus: "year",
    asOfConfirmed: false,
    rawAsOf: "12/28",
    snapshotScope: "partial",
    rows: [{ code: "2330", name: "台積電", shares: 1000, avgCost: 900 }],
    fileHashes: ["hyr"],
    method: "avg",
    today: "2026-01-05",
    ledgerLib: L,
  });
  const appYr = R.applyHoldingsImport(R.emptyStore(), planYear);
  assert.equal(R.hasConfirmedSnapshots(appYr.store), false);
  assert.equal(appYr.conflictCount, 1);

  const planFut = R.planHoldingsSnapshot({
    store: R.emptyStore(),
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b-fut",
    asOf: "2026-12-31",
    asOfStatus: "future",
    asOfConfirmed: true, // 即使勾確認，只要 > today 仍禁止建 confirmed
    rawAsOf: "2026-12-31",
    snapshotScope: "partial",
    rows: [{ code: "2330", name: "台積電", shares: 1000, avgCost: 900 }],
    fileHashes: ["hfut"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const appFut = R.applyHoldingsImport(R.emptyStore(), planFut);
  assert.equal(R.hasConfirmedSnapshots(appFut.store), false);
  assert.equal(appFut.conflictCount, 1);

  // 4. 美股 recon_diff 顯示 T+1；同 symbol 不同市場進 Level 3 currency_conflict
  const usBaselines = appPartial.store;
  const planUsDiff = R.planHoldingsSnapshot({
    store: usBaselines,
    txStore: { v: 1, method: "avg", transactions: [] },
    batchId: "b-us",
    asOf: "2026-11-16",
    asOfStatus: "exact",
    snapshotScope: "partial",
    rows: [
      { code: "NVDA", name: "輝達", shares: 15, avgCost: 125 },
      { code: "2330", market: "us", currency: "USD", name: "錯市場", shares: 100, avgCost: 150 },
    ],
    fileHashes: ["hus"],
    method: "avg",
    today: "2026-11-16",
    ledgerLib: L,
  });
  const nvItem = planUsDiff.items.find(x => x.symbol === "NVDA");
  assert.equal(nvItem.level, 2);
  assert.match(nvItem.conflict.message, /美股 T\+1/);
  const mktItem = planUsDiff.items.find(x => x.symbol === "2330");
  assert.equal(mktItem.level, 3);
  assert.equal(mktItem.reasonCode, "currency_conflict");

  // 5. tagInitialTx missing_cost 與 tag -> untag -> tag
  const txZeroCost = { id: "tz", date: "2026-11-01", type: "transfer_in", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 0, fee: 0, tax: 0 };
  assert.equal(R.tagInitialTx(R.emptyStore(), txZeroCost, { today: "2026-11-16" }).code, "missing_cost");
  const txGood = { ...txZeroCost, price: 800 };
  const t1 = R.tagInitialTx(R.emptyStore(), txGood, { today: "2026-11-16", snapshotId: "s-t1" });
  assert.equal(t1.ok, true);
  assert.equal(t1.store.initialTags.tz.active, true);
  const t2 = R.untagInitialTx(t1.store, "tz");
  assert.equal(t2.ok, true);
  assert.equal(t2.store.initialTags.tz.active, false);
  assert.equal(t2.store.snapshots.find(x => x.id === "s-t1").status, "superseded");
  const t3 = R.tagInitialTx(t2.store, txGood, { today: "2026-11-16", snapshotId: "s-t2" });
  assert.equal(t3.ok, true);
  assert.equal(t3.store.initialTags.tz.snapshotId, "s-t2");
  assert.equal(R.activeBaselines(t3.store).get("2330").id, "s-t2");
});

test("雙鍵寫入 store.set === false 模擬（Phase 1 / Phase 2＋復原也失敗 / Phase 3）與 S2 < S1 不覆蓋新基準", () => {
  const { L, R } = loadLedgerAndRecon();
  // A. S2 < S1 保留 S1
  const p1 = R.planHoldingsSnapshot({
    store: R.emptyStore(), txStore: { v: 1, method: "avg", transactions: [] }, batchId: "bs1",
    asOf: "2026-11-15", asOfStatus: "exact", snapshotScope: "partial",
    rows: [{ code: "2330", name: "台積電", shares: 1000, avgCost: 900 }], today: "2026-11-16", ledgerLib: L,
  });
  const s1Store = R.applyHoldingsImport(R.emptyStore(), p1).store;
  const pOlder = R.planHoldingsSnapshot({
    store: s1Store, txStore: { v: 1, method: "avg", transactions: [] }, batchId: "bs2",
    asOf: "2026-11-01", asOfStatus: "exact", snapshotScope: "partial",
    rows: [{ code: "2330", name: "台積電", shares: 800, avgCost: 850 }], today: "2026-11-16", ledgerLib: L,
  });
  const appOlder = R.applyHoldingsImport(s1Store, pOlder);
  assert.equal(R.activeBaselines(appOlder.store).get("2330").date, "2026-11-15", "較舊快照絕不覆蓋現有基準");

  // B. 模擬 Phase 1 / Phase 2 (含回滾 recon 亦失敗) / Phase 3 store.set === false 後再恢復
  const pf0 = { v: 1, method: "avg", transactions: [] };
  const recon0 = R.emptyStore();
  const tx1 = { id: "imp1", date: "2026-11-12", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 500, price: 900, fee: 0, tax: 0, note: "" };
  const nextPf = { v: 1, method: "avg", transactions: [tx1] };
  const payload = {
    id: "b-sim", op: "import_trades", at: "2026-11-12T10:00:00Z",
    txs: [tx1], txHashes: { imp1: R.txFingerprint(tx1) },
    pfBaseHash: R.pfStoreHash(pf0), pfNextHash: R.pfStoreHash(nextPf),
    staged: { audit: [{ id: "aud-sim-1", at: "2026-11-12T10:00:00Z", action: "trades_imported", symbol: "2330", batchId: "b-sim" }] },
  };

  function runDualSim(failOn) {
    let memPf = J(pf0), memRecon = J(recon0);
    const setPf = v => { if (failOn.pf) return false; memPf = J(v); return true; };
    const setRecon = (v, phase) => { if (failOn[phase]) return false; memRecon = J(v); return true; };
    const prep = R.prepareCommit(memRecon, payload);
    const fin = R.finalizeCommit(prep.store, payload.id);
    if (!setRecon(prep.store, "p1")) return { ok: false, phase: 1, memPf, memRecon };
    if (!setPf(nextPf)) { setRecon(recon0, "p2rollback"); return { ok: false, phase: 2, memPf, memRecon }; }
    if (!setRecon(fin.store, "p3")) return { ok: false, phase: 3, memPf, memRecon };
    return { ok: true, memPf, memRecon };
  }

  // Phase 1 fail → both untouched
  const f1 = runDualSim({ p1: true });
  assert.equal(f1.ok, false);
  assert.equal(f1.memRecon.pendingCommit, null);
  assert.equal(f1.memPf.transactions.length, 0);

  // Phase 2 fail + p2rollback ALSO fail → WAL stays pending, recoverCommit cleanly aborts
  const f2 = runDualSim({ pf: true, p2rollback: true });
  assert.equal(f2.ok, false);
  assert.ok(f2.memRecon.pendingCommit != null);
  const rec2 = R.recoverCommit(f2.memPf, f2.memRecon);
  assert.equal(rec2.status, "aborted");
  assert.equal(rec2.reconStore.pendingCommit, null);
  assert.equal(rec2.reconStore.audit.length, 0);

  // Phase 3 fail → pf has tx, WAL stays pending, recoverCommit rolls forward with zero duplicate audit
  const f3 = runDualSim({ p3: true });
  assert.equal(f3.ok, false);
  const rec3 = R.recoverCommit(f3.memPf, f3.memRecon);
  assert.equal(rec3.status, "rolled_forward");
  assert.equal(rec3.reconStore.pendingCommit, null);
  assert.equal(rec3.reconStore.audit.length, 1);
  assert.equal(R.recoverCommit(f3.memPf, rec3.reconStore).changed, false);
});

test("Task 7 防繞過靜態檢查：learner/*.js 與 learner/watch.html（除 learner/ledger.js 外）不可直接呼叫 .buildLedger(", () => {
  const learnerDir = new URL("../learner/", import.meta.url);
  const files = readdirSync(learnerDir).filter(f => (f.endsWith(".js") && f !== "ledger.js") || f === "watch.html");
  const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  const hits = [];
  for (const f of files) {
    const raw = readFileSync(new URL(f, learnerDir), "utf8");
    const cleaned = stripComments(raw);
    if (/\.buildLedger\s*\(/.test(cleaned)) hits.push(f);
  }
  assert.deepEqual(hits, [], `發現未經 buildReconciledLedger 的直接 .buildLedger( 呼叫：${hits.join(", ")}`);
});

test("已有較新基準時標記較舊股票轉入為期初快照：一致才串接、不一致建 recon_diff，帳本不得因此出錯或鎖死", () => {
  const { L, R } = loadLedgerAndRecon();
  const TODAY = "2026-11-17";
  const tw = o => ({ v: 1, symbol: "2330", market: "tw", currency: "TWD", fee: 0, tax: 0, note: "", ...o });
  const withS1 = () => {
    const s = R.emptyStore();
    s.snapshots.push({ id: "S1", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-10", shares: 1000, avgCost: 900, status: "confirmed", confirmedAt: "2026-11-10T00:00:00Z", scope: "partial", origin: "import", supersededBy: null });
    return s;
  };
  const errIds = (txs, recon) => L.buildReconciledLedger({ v: 1, method: "avg", transactions: txs }, recon, { method: "avg", today: TODAY }).txs.filter(x => x.errors.length).map(x => x.id);

  // A. 前段交易不完整（10/15 賣 500 但期初只有 200 股）→ 不一致：不得串接、建 recon_diff；帳本錯誤不增加、仍可新增交易
  const ti = tw({ id: "ti", date: "2026-10-01", type: "transfer_in", shares: 200, price: 700 });
  const txsA = [ti, tw({ id: "p", date: "2026-10-15", type: "sell", shares: 500, price: 850 }), tw({ id: "q", date: "2026-11-12", type: "sell", shares: 300, price: 950 })];
  const pfA = { v: 1, method: "avg", transactions: txsA };
  assert.deepEqual(errIds(txsA, withS1()), []);
  const tagA = R.tagInitialTx(withS1(), ti, { today: TODAY, snapshotId: "s-ti", txStore: pfA, ledgerLib: L, method: "avg" });
  assert.equal(tagA.ok, true);
  const snapA = tagA.store.snapshots.find(s => s.id === "s-ti");
  assert.equal(snapA.status, "superseded");
  assert.equal(snapA.supersededBy, null, "不一致不得串接到較新基準");
  assert.equal(tagA.store.snapshots.find(s => s.id === "S1").status, "confirmed", "較新基準不得被破壞");
  const confA = tagA.store.conflicts.find(c => c.status === "open" && c.kind === "recon_diff");
  assert.ok(confA, "不一致時建立 recon_diff 待對帳");
  assert.equal(confA.snapshotId, "s-ti");
  assert.equal(confA.previousSnapshotId, "S1");
  assert.equal(confA.payload.reason, "tag_older_than_baseline");
  assert.equal(R.validateStore(tagA.store, { today: TODAY }).ok, true);
  assert.deepEqual(errIds(txsA, tagA.store), [], "標記後帳本不得出現新錯誤");
  assert.equal(L.validateStore({ ...pfA, transactions: [...txsA, tw({ id: "z", date: "2026-11-16", type: "buy", shares: 10, price: 950 })] }, { today: TODAY, recon: tagA.store }).ok, true, "標記後仍可新增交易");
  const posA = L.buildReconciledLedger(pfA, tagA.store, { method: "avg", today: TODAY }).positions.find(p => p.symbol === "2330");
  assert.equal(posA.shares, 700, "仍以較新基準 S1 計算持股");

  // A2. 撤回或重新標記時，舊的 tag_older_than_baseline 待對帳一併結案，不殘留失效項目
  const openTagConfs = st => st.conflicts.filter(c => c.status === "open" && c.payload?.reason === "tag_older_than_baseline" && c.payload?.txId === "ti");
  const untagA = R.untagInitialTx(tagA.store, "ti", { at: "2026-11-17T01:00:00Z" });
  assert.equal(untagA.ok, true);
  assert.equal(openTagConfs(untagA.store).length, 0, "撤回後結案");
  assert.equal(R.validateStore(untagA.store, { today: TODAY }).ok, true);
  const retagA = R.tagInitialTx(tagA.store, ti, { today: TODAY, snapshotId: "s-ti2", txStore: pfA, ledgerLib: L, method: "avg" });
  assert.equal(openTagConfs(retagA.store).length, 1, "重新標記只留最新一筆待對帳");
  assert.equal(openTagConfs(retagA.store)[0].snapshotId, "s-ti2");

  // B. 期間交易完整（10/01 轉入 1200、10/20 賣 200 → 11/10 推算 1000 股、均價 700）但 S1 均價 900 超出容差 → 不一致
  // C. 期間交易完整且一致 → 串接（supersededBy: S1），保留期間已實現損益
  const tiC = tw({ id: "tc", date: "2026-10-01", type: "transfer_in", shares: 1200, price: 900 });
  const txsC = [tiC, tw({ id: "s1", date: "2026-10-20", type: "sell", shares: 200, price: 950 }), tw({ id: "s2", date: "2026-11-12", type: "sell", shares: 300, price: 950 })];
  const pfC = { v: 1, method: "avg", transactions: txsC };
  const tagC = R.tagInitialTx(withS1(), tiC, { today: TODAY, snapshotId: "s-tc", txStore: pfC, ledgerLib: L, method: "avg" });
  assert.equal(tagC.ok, true);
  const snapC = tagC.store.snapshots.find(s => s.id === "s-tc");
  assert.equal(snapC.status, "superseded");
  assert.equal(snapC.supersededBy, "S1", "一致時串接到較新基準");
  assert.equal(tagC.store.conflicts.filter(c => c.status === "open").length, 0);
  const RC = L.buildReconciledLedger(pfC, tagC.store, { method: "avg", today: TODAY });
  assert.deepEqual(RC.txs.filter(x => x.errors.length).map(x => x.id), []);
  const posC = RC.positions.find(p => p.symbol === "2330");
  assert.equal(posC.shares, 700);
  assert.equal(posC.realizedPnl, 10000 + 15000, "串接後保留 10/20 與 11/12 兩筆賣出的已實現損益");

  const tiB = tw({ id: "tb", date: "2026-10-01", type: "transfer_in", shares: 1200, price: 700 });
  const txsB = [tiB, tw({ id: "b1", date: "2026-10-20", type: "sell", shares: 200, price: 950 })];
  const tagB = R.tagInitialTx(withS1(), tiB, { today: TODAY, snapshotId: "s-tb", txStore: { v: 1, method: "avg", transactions: txsB }, ledgerLib: L, method: "avg" });
  assert.equal(tagB.store.snapshots.find(s => s.id === "s-tb").supersededBy, null, "均價超出容差不得串接");
  assert.ok(tagB.store.conflicts.some(c => c.status === "open" && c.snapshotId === "s-tb"));

  // D. 沒傳交易紀錄無法驗證 → 保守處理：不串接、建 recon_diff
  const tagD = R.tagInitialTx(withS1(), tiC, { today: TODAY, snapshotId: "s-td" });
  assert.equal(tagD.store.snapshots.find(s => s.id === "s-td").supersededBy, null);
  assert.ok(tagD.store.conflicts.some(c => c.status === "open" && c.snapshotId === "s-td"));

  // E. 快照鏈只沿 supersededBy 串接：同代號未串接的較早 confirmed 快照不得成為鏈頭
  const recE = withS1();
  recE.snapshots.push({ id: "Old", symbol: "2330", market: "tw", currency: "TWD", date: "2026-10-01", shares: 200, avgCost: 700, status: "confirmed", confirmedAt: "2026-10-01T00:00:00Z", scope: "partial", origin: "import", supersededBy: null });
  assert.deepEqual(errIds(txsA.slice(1), recE), [], "未串接的較早 confirmed 快照不得讓前段交易重算");
});

test("第七輪 P1：已串接的期初轉入改到較新基準之後，該筆轉入須正常入帳（不得因 active tag 被當成期初錨點跳過）", () => {
  const { L, R } = loadLedgerAndRecon();
  const TODAY = "2026-11-17";
  const tw = o => ({ v: 1, symbol: "2330", market: "tw", currency: "TWD", fee: 0, tax: 0, note: "", ...o });
  const s0 = R.emptyStore();
  s0.snapshots.push({ id: "S1", symbol: "2330", market: "tw", currency: "TWD", date: "2026-11-10", shares: 1000, avgCost: 900, status: "confirmed", confirmedAt: "2026-11-10T00:00:00Z", scope: "partial", origin: "import", supersededBy: null });
  const tc = tw({ id: "tc", date: "2026-10-01", type: "transfer_in", shares: 1200, price: 900 });
  const sell = tw({ id: "s1", date: "2026-10-20", type: "sell", shares: 200, price: 950 });
  const tag = R.tagInitialTx(s0, tc, { today: TODAY, snapshotId: "s-tc", txStore: { v: 1, method: "avg", transactions: [tc, sell] }, ledgerLib: L, method: "avg" });
  assert.equal(tag.linkedTo, "S1", "前置條件：期初快照已串接到 S1");

  // A. 改日期跨過 S1：planUpdateTxTag 須解除串接；帳本須把這筆轉入當一般交易入帳
  const next = { ...tc, date: "2026-11-11" };
  const plan = R.planUpdateTxTag(tag.store, tc, next, { today: TODAY });
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "update");
  assert.equal(plan.payload.targetTagState.supersededBy, null, "新日期晚於所串接的 S1 → 解除串接");
  assert.equal(plan.previewRecon.snapshots.find(s => s.id === "s-tc").supersededBy, null);
  const RA = L.buildReconciledLedger({ v: 1, method: "avg", transactions: [next, sell] }, plan.previewRecon, { method: "avg", today: TODAY });
  const xA = RA.txs.find(x => x.id === "tc");
  assert.equal(xA.preSnapshot, false, "S1 之後的轉入不是快照前交易");
  assert.equal(xA.applied, true);
  assert.equal(RA.positions.find(p => p.symbol === "2330").shares, 2200, "持股包含 S1 之後轉入的 1200 股");

  // B. 即使對帳資料仍殘留指向 S1 的串接（例如舊資料），帳本也不得只憑 active tag 就跳過鏈外的交易
  const RB = L.buildReconciledLedger({ v: 1, method: "avg", transactions: [next, sell] }, tag.store, { method: "avg", today: TODAY });
  const xB = RB.txs.find(x => x.id === "tc");
  assert.equal(xB.preSnapshot, false, "期初快照不在目前基準鏈上，就不是期初錨點");
  assert.equal(RB.positions.find(p => p.symbol === "2330").shares, 2200);

  // C. 未串接（與較新基準對不上）的期初標記，改到 S1 之後一樣要入帳
  const tb = tw({ id: "tb", date: "2026-10-01", type: "transfer_in", shares: 200, price: 700 });
  const tagC = R.tagInitialTx(s0, tb, { today: TODAY, snapshotId: "s-tb", txStore: { v: 1, method: "avg", transactions: [tb] }, ledgerLib: L, method: "avg" });
  assert.ok(tagC.conflict, "前置條件：對不上 S1，未串接");
  const nextC = { ...tb, date: "2026-11-12" };
  const RC = L.buildReconciledLedger({ v: 1, method: "avg", transactions: [nextC] }, tagC.store, { method: "avg", today: TODAY });
  assert.equal(RC.txs.find(x => x.id === "tb").applied, true);
  assert.equal(RC.positions.find(p => p.symbol === "2330").shares, 1200);

  // D. 仍在鏈上的期初錨點照舊不重複計算：日期改動但仍早於 S1 → 保持串接、維持期初錨點
  const nextD = { ...tc, date: "2026-10-02" };
  const planD = R.planUpdateTxTag(tag.store, tc, nextD, { today: TODAY });
  assert.equal(planD.payload.targetTagState.supersededBy, "S1", "仍早於 S1 時保留串接");
  const RD = L.buildReconciledLedger({ v: 1, method: "avg", transactions: [nextD, sell] }, planD.previewRecon, { method: "avg", today: TODAY });
  assert.equal(RD.txs.find(x => x.id === "tc").preSnapshot, true, "鏈上的期初錨點不重複入帳");
  assert.equal(RD.positions.find(p => p.symbol === "2330").shares, 1000);

  // E. 單獨存在的期初標記（自己就是目前基準）照舊為錨點
  const tagE = R.tagInitialTx(R.emptyStore(), tc, { today: TODAY, snapshotId: "s-e" });
  const RE = L.buildReconciledLedger({ v: 1, method: "avg", transactions: [tc, sell] }, tagE.store, { method: "avg", today: TODAY });
  assert.equal(RE.txs.find(x => x.id === "tc").preSnapshot, true);
  assert.equal(RE.positions.find(p => p.symbol === "2330").shares, 1000);
});
