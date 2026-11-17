/* ================= 庫存「交易紀錄」（投資組合第 4 階段 B） =================
   計算全部在 ledger.js（KLLedger）；這裡只負責畫面與「使用者確認後才寫入」。
   存檔：kline:pf:v1 → { v: 1, method, transactions, migratedFrom?, at }。
     · 第一次使用：「從現有庫存建立」先顯示搬移預覽（哪幾筆會變成股票轉入、哪幾筆不搬與原因），按「確認建立」才寫入；也可以從空白開始。
     · 截圖匯入：選項 1「庫存／持股」匯入為 transfer_in（帳本目前已有部位預設不勾選略過以免重複）；選項 2「成交明細／對帳單」匯入為 buy／sell（保留分批成交、空白手續費／稅依規則估算、0 維持 0、同日／降冪順序正規化並擋下賣超）。
     · 舊的 kline:watch:hold 不刪、不改；即時損益、持股分析、風險三個分頁照舊用它（有交易紀錄時在記憶體切換，舊資料不動）。
     · 每次寫入前都跑 KLLedger.validateStore，有錯誤就不寫（不會留下壞資料）。
   新增、修改：先試算，錯誤（賣超、日期不對、幣別錯…）擋下並說明；提醒（估算費用、可能重複…）要再按一次確認。
   刪除：先算影響範圍（之後哪幾筆會變、會不會讓後面的賣出變成賣超），會出錯就不讓刪，否則確認後刪除。
   雲端同步、備份檔本來就包含所有 kline: 開頭的資料，新存檔會一起同步與備份。不輸出 console、不送到任何外部服務。
   用到 watch.html 的 W、$、esc、store、renderList、nameOf、toast、ico、loadStocks、findCode、lookupCode、verifyCodes、holdSrcApply、showImpDialog、closeImport、impSetLive、imp；ledger.js 的 KLLedger。 */
const LG_KEY = "pf:v1"; // store 會加 kline: 前綴
const LG_RAW_PF = "kline:pf:v1";
const LG_RAW_RECON = "kline:pf:recon:v1";
const lgToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const lgRawGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lgParseRaw = raw => { if (!raw) return null; try { const s = JSON.parse(raw); return s && typeof s === "object" && !Array.isArray(s) ? s : null; } catch { return null; } };
const lgLoad = () => { const s = store.get(LG_KEY, null); return s && typeof s === "object" && !Array.isArray(s) ? s : null; };
const lgStoreOrEmpty = () => lgLoad() || { v: 1, method: "avg", transactions: [] };

let _pfNodeQueue = Promise.resolve();
function withPfCommitLock(fn) {
  if (typeof window !== "undefined") {
    if (typeof navigator === "undefined" || !navigator.locks || typeof navigator.locks.request !== "function") {
      return Promise.resolve({
        ok: false,
        code: "cross_tab_lock_unavailable",
        errors: ["目前瀏覽器不支援跨分頁鎖（navigator.locks），為避免多視窗並發寫入破壞雙鍵一致性，已阻擋這次寫入。"]
      });
    }
    return navigator.locks.request("kline:pf:commit", () => Promise.resolve().then(fn));
  }
  const run = _pfNodeQueue.then(fn, fn);
  _pfNodeQueue = run.catch(() => {});
  return run;
}

function lgRecoverPersist() {
  if (W._lgRecBusy) return W._lgRecBusy;
  W._lgRecBusy = withPfCommitLock(() => {
    const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
    const pf = lgParseRaw(rawPf), recon = lgParseRaw(rawRecon);
    if (!recon || recon.pendingCommit == null || typeof KLRecon?.recoverCommit !== "function") {
      W.lgReconHalted = null;
      return { ok: true, changed: false };
    }
    const rec = KLRecon.recoverCommit(pf, recon);
    if (rec.changed !== true) {
      W.lgReconHalted = (rec.status === "unknown_op_halted" || rec.status === "inconsistent_halted") ? rec : null;
      return { ok: true, changed: false, status: rec.status };
    }
    const pr = KLRecon.pruneStore(rec.reconStore, KLRecon.MAX_BYTES);
    if (!pr.ok) return { ok: false, code: pr.code };
    if (lgRawGet(LG_RAW_PF) !== rawPf || lgRawGet(LG_RAW_RECON) !== rawRecon) {
      setTimeout(() => lgRecoverPersist(), 25);
      return { ok: false, code: "cas_retry" };
    }
    let wrote = false;
    try { wrote = store.set("pf:recon:v1", pr.store); } catch { wrote = false; }
    if (!wrote) return { ok: false, code: "storage_write_failed" };
    W.lgReconHalted = null;
    if (typeof holdSrcApply === "function") holdSrcApply();
    if (typeof pfExpire === "function") pfExpire();
    if (typeof renderList === "function") renderList();
    return { ok: true, changed: true };
  }).finally(() => { W._lgRecBusy = null; });
  return W._lgRecBusy;
}

// 純讀取＋無副作用記憶體 WAL 檢查：絕不在讀取期間直接同步覆寫 localStorage
function lgReconLoad() {
  const s = store.get("pf:recon:v1", null);
  const R0 = s && typeof s === "object" && !Array.isArray(s) ? s : null;
  if (R0?.pendingCommit != null && typeof KLRecon?.recoverCommit === "function") {
    const rec = KLRecon.recoverCommit(lgLoad(), R0);
    if (rec.changed === true) {
      W.lgReconHalted = null;
      Promise.resolve().then(() => lgRecoverPersist());
      return rec.reconStore;
    }
    if (rec.status === "unknown_op_halted" || rec.status === "inconsistent_halted") {
      W.lgReconHalted = rec;
      return R0;
    }
  }
  W.lgReconHalted = null;
  return R0;
}

function lgReconWrite(nextRecon, opts = {}) {
  if (typeof KLRecon === "undefined") return { ok: false, code: "recon_missing", errors: ["對帳模組尚未載入"] };
  const rawRecon = lgRawGet(LG_RAW_RECON), curRecon = lgParseRaw(rawRecon);
  if (opts.expectedRawRecon !== undefined && rawRecon !== opts.expectedRawRecon) {
    return { ok: false, code: "stale_write", errors: ["其他分頁或程序已更新對帳資料，本次未覆蓋寫入，請重新確認畫面"] };
  }
  if (!opts.allowPendingCommitWrite && curRecon?.pendingCommit != null) {
    return { ok: false, code: "unrecovered_pending_commit", errors: ["存在未恢復或未知的對帳提交紀錄，請先處理或匯出 JSON 備份後再修改"] };
  }
  if (!opts.allowPendingCommitWrite && nextRecon?.pendingCommit != null) {
    return { ok: false, code: "unrecovered_pending_commit", errors: ["不可透過一般儲存寫入未結案的 pendingCommit"] };
  }
  const vr = KLRecon.validateStore(nextRecon, { today: lgToday() });
  if (!vr.ok) return { ok: false, code: vr.code, errors: [vr.error || vr.code] };
  const pr = KLRecon.pruneStore(nextRecon, KLRecon.MAX_BYTES);
  if (!pr.ok) {
    const msg = `對帳核心資料超過 ${Math.round(pr.maxBytes / 1024)}KB 上限（目前 ${Math.round(pr.bytes / 1024)}KB），本次未覆蓋寫入；請先結案待對帳項目或到「工具 → 備份同步」匯出 JSON 備份`;
    return { ok: false, code: pr.code, bytes: pr.bytes, maxBytes: pr.maxBytes, errors: [msg] };
  }
  let wrote = false;
  try { wrote = store.set("pf:recon:v1", pr.store); } catch { wrote = false; }
  if (!wrote) return { ok: false, code: "storage_write_failed", errors: ["瀏覽器儲存空間不足或受寫入保護，對帳資料未寫入"] };
  if (pr.store.pendingCommit == null) W.lgReconHalted = null;
  if (typeof holdSrcApply === "function") holdSrcApply();
  if (typeof pfExpire === "function") pfExpire();
  return { ok: true, store: pr.store, trimmed: !!pr.trimmed };
}

function lgReconSave(nextRecon, opts = {}) {
  if (opts.inLock) return Promise.resolve(lgReconWrite(nextRecon, opts));
  return withPfCommitLock(() => lgReconWrite(nextRecon, opts));
}

// 寫入前一定檢查：併發基線、unrecovered_pending_commit 與 store.set 布林失敗防護；有錯絕不寫入
function lgSave(s, opts = {}) {
  const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
  if (opts.expectedRawPf !== undefined && rawPf !== opts.expectedRawPf) {
    return { ok: false, code: "stale_write", errors: ["其他分頁已修改交易紀錄，請重新載入後再操作"] };
  }
  if (opts.expectedRawRecon !== undefined && rawRecon !== opts.expectedRawRecon) {
    return { ok: false, code: "stale_write", errors: ["其他分頁已修改對帳資料，請重新載入後再操作"] };
  }
  const reconNow = opts.reconOverride !== undefined ? opts.reconOverride : lgParseRaw(rawRecon);
  if (!opts.allowPendingCommitWrite && reconNow?.pendingCommit != null) {
    return { ok: false, code: "unrecovered_pending_commit", errors: ["存在未恢復或未知的對帳提交紀錄，請先處理或匯出 JSON 備份後再修改"] };
  }
  const v = KLLedger.validateStore(s, { today: lgToday(), ...(reconNow ? { recon: reconNow } : {}) });
  if (!v.ok) return v;
  let wrote = false;
  try { wrote = store.set(LG_KEY, s); } catch { wrote = false; }
  if (!wrote) return { ok: false, code: "storage_write_failed", errors: ["瀏覽器儲存空間不足或受鎖定，未寫入交易紀錄"] };
  if (typeof holdSrcApply === "function") holdSrcApply();
  if (typeof pfExpire === "function") pfExpire();
  return v; // 庫存各分頁的持股跟著更新（at 是建立時間，不改）
}

async function lgCommitDualStores(spec = {}) {
  if (typeof KLRecon === "undefined") return { ok: false, code: "recon_missing", errors: ["對帳模組尚未載入"] };
  return withPfCommitLock(async () => {
    const rawPf0 = lgRawGet(LG_RAW_PF), rawRecon0 = lgRawGet(LG_RAW_RECON);
    if (spec.expectedRawPf !== undefined && rawPf0 !== spec.expectedRawPf) {
      return { ok: false, code: "stale_write", errors: ["交易紀錄已在其他視窗變動，請重新確認畫面再提交"] };
    }
    if (spec.expectedRawRecon !== undefined && rawRecon0 !== spec.expectedRawRecon) {
      return { ok: false, code: "stale_write", errors: ["對帳快照已在其他視窗變動，請重新確認畫面再提交"] };
    }
    const pf0 = lgParseRaw(rawPf0) || { v: 1, method: "avg", transactions: [] };
    let recon0 = lgParseRaw(rawRecon0) || KLRecon.emptyStore();
    if (recon0.pendingCommit != null) {
      const rec = KLRecon.recoverCommit(pf0, recon0);
      if (rec.changed) {
        const prRec = KLRecon.pruneStore(rec.reconStore, KLRecon.MAX_BYTES);
        if (!prRec.ok) return { ok: false, code: prRec.code, errors: ["恢復前次 WAL 時對帳資料超過上限"] };
        const wRec = lgReconWrite(prRec.store, { allowPendingCommitWrite: true });
        if (!wRec.ok) return wRec;
        recon0 = wRec.store;
      } else {
        W.lgReconHalted = (rec.status === "unknown_op_halted" || rec.status === "inconsistent_halted") ? rec : null;
        return { ok: false, code: "unrecovered_pending_commit", halted: rec, errors: ["存在受阻的對帳提交紀錄，請先透過頁頂修復面板處理"] };
      }
    }
    let nextPf = spec.nextPf, payload = spec.payload;
    if (typeof spec.planFn === "function") {
      const planned = await spec.planFn(pf0, recon0);
      if (!planned || !planned.ok) return planned || { ok: false, code: "plan_failed", errors: ["雙鍵提交規劃失敗"] };
      nextPf = planned.nextPf;
      payload = planned.payload;
    }
    if (!payload) return { ok: false, code: "invalid_wal_payload", errors: ["缺少 WAL 提交內容"] };
    const batchId = payload.id || payload.batchId;
    const prep = KLRecon.prepareCommit(recon0, payload);
    if (!prep.ok) return { ok: false, code: prep.code, errors: [prep.error || prep.code] };
    const fin = KLRecon.finalizeCommit(prep.store, batchId);
    if (!fin.ok) return { ok: false, code: fin.code, errors: [fin.error || fin.code] };

    const pfVal = KLLedger.validateStore(nextPf, { today: lgToday(), recon: fin.store });
    if (!pfVal.ok) {
      const msg = pfVal.errors?.[0]?.errors?.[0]?.message || pfVal.code;
      return { ok: false, code: pfVal.code, errors: [`交易紀錄資料檢查未通過：${msg}`], ledgerErrors: pfVal.errors };
    }
    const recVal = KLRecon.validateStore(fin.store, { today: lgToday() });
    if (!recVal.ok) return { ok: false, code: recVal.code, errors: [recVal.error || recVal.code] };
    const pr1 = KLRecon.pruneStore(prep.store, KLRecon.MAX_BYTES);
    if (!pr1.ok) return { ok: false, code: pr1.code, bytes: pr1.bytes, maxBytes: pr1.maxBytes, errors: [`對帳暫存超過 ${Math.round(pr1.maxBytes / 1024)}KB 上限，請先結案待對帳項目或匯出備份`] };
    const pr3 = KLRecon.pruneStore(fin.store, KLRecon.MAX_BYTES);
    if (!pr3.ok) return { ok: false, code: pr3.code, bytes: pr3.bytes, maxBytes: pr3.maxBytes, errors: [`對帳核心資料超過 ${Math.round(pr3.maxBytes / 1024)}KB 上限，請先結案待對帳項目或匯出備份`] };

    // Phase 1: 寫入 WAL pendingCommit
    const w1 = lgReconWrite(pr1.store, { allowPendingCommitWrite: true });
    if (!w1.ok) return w1;
    const rawPrepStr = lgRawGet(LG_RAW_RECON);

    // Phase 2: 寫入交易紀錄 kline:pf:v1
    let pfWrote = false;
    try { pfWrote = store.set(LG_KEY, nextPf); } catch { pfWrote = false; }
    if (!pfWrote) {
      let restoreOk = false;
      if (lgRawGet(LG_RAW_RECON) === rawPrepStr) {
        try {
          if (rawRecon0 == null) { localStorage.removeItem(LG_RAW_RECON); restoreOk = true; }
          else restoreOk = store.set("pf:recon:v1", recon0);
        } catch { restoreOk = false; }
      }
      if (typeof holdSrcApply === "function") holdSrcApply();
      return { ok: false, code: "storage_write_failed", phase: 2, walPending: !restoreOk, errors: ["儲存交易紀錄失敗（瀏覽器空間不足或受鎖定），未寫入新資料"] };
    }
    const rawNextPfStr = lgRawGet(LG_RAW_PF);

    // Phase 3: 結案清除 pendingCommit 並寫入正式對帳紀錄
    const w3 = lgReconWrite(pr3.store, { allowPendingCommitWrite: true });
    if (!w3.ok) {
      let rolledBack = false;
      if (lgRawGet(LG_RAW_PF) === rawNextPfStr) {
        let pfRevertOk = false;
        try {
          if (rawPf0 == null) { localStorage.removeItem(LG_RAW_PF); pfRevertOk = true; }
          else pfRevertOk = store.set(LG_KEY, pf0);
        } catch { pfRevertOk = false; }
        if (pfRevertOk && lgRawGet(LG_RAW_RECON) === rawPrepStr) {
          try {
            if (rawRecon0 == null) { localStorage.removeItem(LG_RAW_RECON); rolledBack = true; }
            else rolledBack = store.set("pf:recon:v1", recon0);
          } catch { rolledBack = false; }
        }
      }
      if (typeof holdSrcApply === "function") holdSrcApply();
      return { ok: false, code: w3.code || "storage_write_failed", phase: 3, rolledBack, walPending: !rolledBack, errors: w3.errors || ["寫入對帳結案紀錄失敗"] };
    }
    if (typeof holdSrcApply === "function") holdSrcApply();
    if (typeof pfExpire === "function") pfExpire();
    return { ok: true, pfStore: nextPf, reconStore: w3.store, ledger: pfVal.ledger };
  });
}

function lgReconAlertHtml(recon, L, opts = {}) {
  const rawConfs = (L?.reconcile?.openConflicts?.length ? L.reconcile.openConflicts : (recon?.conflicts || []).filter(c => c && c.status === "open")) || [];
  const symF = opts?.symbol ? String(opts.symbol).toUpperCase() : null;
  const confs = symF ? rawConfs.filter(c => String(c.symbol || "").toUpperCase() === symF) : rawConfs;
  const unresTxs = (L?.txs || []).filter(x => x && x.sameDayRelation === "unresolved" && !x.errors?.length && (!symF || String(x.tx?.symbol || "").toUpperCase() === symF));
  if (!confs.length && !unresTxs.length && (symF || !(L?.reconcile?.unresolvedSameDayCount > 0))) return "";
  const seen = new Set(), items = [];
  for (const c of confs) {
    const k = c.id || `${c.kind}:${c.symbol}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const diff = c.diffShares != null ? `差異 ${c.diffShares > 0 ? "+" : ""}${lgN(c.diffShares)} 股` : (c.kind === "same_day_order" ? "同日順序未決" : "待對帳");
    const hint = typeof KLRecon?.settlementHint === "function" ? KLRecon.settlementHint(c.market) : "";
    items.push(`${esc(c.symbol || "")}（${diff}）${hint ? `：${esc(hint)}` : ""}`);
  }
  for (const x of unresTxs) {
    const k = `sd:${x.id}`;
    if (seen.has(k) || confs.some(c => c.kind === "same_day_order" && c.txId === x.id)) continue;
    seen.add(k);
    const hint = typeof KLRecon?.settlementHint === "function" ? KLRecon.settlementHint(x.tx?.market) : "";
    items.push(`${esc(x.tx?.symbol || "")}（同日順序未決）${hint ? `：${esc(hint)}` : ""}`);
  }
  if (!items.length && L?.reconcile?.pendingSymbols?.length) {
    for (const s of L.reconcile.pendingSymbols) {
      if (!symF || s === symF) items.push(`${esc(s)}（待對帳）`);
    }
  }
  if (!items.length) return "";
  const btn = opts?.noButton ? "" : ` <button type="button" class="btn sm" data-lg="view" data-v="tx">前往對帳中心</button>`;
  return `<div class="lgrecon-alert note lgwarn" role="status">⚠︎ 待對帳（${items.slice(0, 3).join("；")}${items.length > 3 ? ` 等 ${items.length} 項` : ""}）${btn}</div>`;
}

const LG_FIELDS = { // 每種交易要填的欄位
  buy: ["symbol", "shares", "price", "fee", "tax"], sell: ["symbol", "shares", "price", "fee", "tax", "dayTrade"], dividend: ["symbol", "amount", "tax"],
  stock_dividend: ["symbol", "shares", "ratio"], split: ["symbol", "ratio"], fraction_cash: ["symbol", "shares", "amount", "fee"],
  transfer_in: ["symbol", "shares", "price", "fee"], transfer_out: ["symbol", "shares"], deposit: ["amount"], withdraw: ["amount"], fee: ["amount", "ref"], other: ["symbol", "shares", "amount"]
};
const LG_LABEL = { symbol: "代號", shares: "股數", price: "價格（每股）", fee: "手續費（空白＝估算）", tax: "交易稅（空白＝估算）", amount: "金額", ratio: "比例", ref: "對應交易", dayTrade: "現股當沖" };
const lgMkt = c => (/^\d{4,6}[A-Z]?$/.test(c) ? "tw" : /^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,3})?$/.test(c) ? "us" : null);
const lgDisc = () => (Number(W?.hdisc) > 0 && Number(W.hdisc) <= 1 ? Number(W.hdisc) : 1);
const lgDiscText = () => { const d = lgDisc(); return d < 1 ? `（台股手續費 ${+(d * 10).toFixed(2)} 折）` : ""; };
const lgRules = () => (KLLedger.DEFAULT_RULES ? { ...KLLedger.DEFAULT_RULES, tw: { ...KLLedger.DEFAULT_RULES.tw, discount: lgDisc() } } : undefined);
const lgMoney = (v, cur) => { if (v == null) return "—"; const x = cur === "USD" ? Math.round(+v * 100) / 100 : Math.round(+v); return (cur === "USD" ? "US$" : "") + (x === 0 ? 0 : x).toLocaleString(undefined, cur === "USD" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}); }; // 四捨五入後是 0 就顯示 0，不顯示 −0
const lgSgn = (v, cur) => (v == null ? "—" : (v > 0 ? "+" : "") + lgMoney(v, cur));
const lgN = v => (v == null ? "—" : (+v).toLocaleString(undefined, { maximumFractionDigits: 4 }));

(function () {
  if (typeof document === "undefined" || document.getElementById("lgreconcss")) return;
  const st = document.createElement("style");
  st.id = "lgreconcss";
  st.textContent = `.lgrecon-alert,.lgrecon-halted,.lgrecon-center,.lgrecon-stale{margin:8px 12px;padding:10px 12px;border:1px solid var(--s1,#d97706);border-radius:6px;background:color-mix(in srgb,var(--s1,#d97706) 8%,var(--surface))}
.lgrecon-halted{border-width:2px}.lgrecon-center h4,.lgrecon-halted h4{margin:0 0 6px;font-size:14px}
.lgrecon-item{padding:8px 0;border-top:1px solid var(--line);display:grid;gap:6px}
.lgrecon-item:first-of-type{border-top:none}
.lgrecon-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.lgrecon-act input[type="text"],.lgrecon-act input[type="date"],.lgrecon-act input[type="number"]{min-height:36px;padding:4px 8px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink)}
.lgrecon-hist{margin:12px;border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:var(--surface)}
.lgrecon-hist summary{cursor:pointer;font-weight:500;font-size:13px}
.lgrecon-hist ul{margin:8px 0 0;padding-left:1.2em;font-size:12px;line-height:1.5}
.lgbadge{display:inline-block;margin-left:4px;padding:1px 6px;font-size:11px;border-radius:3px;border:1px solid var(--accent);color:var(--accent)}
.lgimp-banner{margin:0 0 8px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);display:grid;gap:6px;font-size:12.5px}
.lgimp-scope,.lgimp-asof{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lgimp-margin{margin:6px 0;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);font-size:12.5px}
@media(pointer:coarse){.lgrecon-act .btn,.lgrecon-halted .btn,.lgrecon-stale .btn,#impBody [data-lgimp-upload],#lgImpForm .lgimp-asof .btn,#lgImpForm [data-lgimp-switch]{min-height:44px}}`;
  document.head.appendChild(st);
})();

// 交易紀錄、績效的市場切換：全部／台股／美股（W.lg.mkt，只在這次開啟有效、不存檔）；總覽、配置、融資本來就是看整個投資組合
const LG_MKT = [["all", "全部"], ["tw", "台股"], ["us", "美股"]];
const lgMktSel = () => W.lg?.mkt || "all";
const lgCurOk = c => { const m = lgMktSel(); return m === "all" || (m === "us" ? c === "USD" : c !== "USD"); };
const lgMktSeg = () => `<div class="seg lgmkt" role="group" aria-label="市場">${LG_MKT.map(([k, t]) => `<button type="button" data-lg="mkt" data-v="${k}" aria-pressed="${lgMktSel() === k}">${t}</button>`).join("")}</div>`;

function lgHaltedHtml(halted, recon, S) {
  if (!halted && recon?.pendingCommit == null) return "";
  const pc = recon?.pendingCommit || {};
  const canRevert = halted?.status !== "unknown_op_halted" && ["import_trades", "update_tx_tag", "deactivate_tags"].includes(pc.op);
  return `<section class="lgrecon-halted" data-lgrecon-halted role="region" aria-label="受阻的對帳提交修復">
    <h4>⚠︎ 偵測到未完成且無法自動收斂的對帳提交（${esc(pc.op || "unknown")}）</h4>
    <p class="note">為保護現有交易紀錄與對帳快照，目前暫時鎖定寫入。交易紀錄目前有 ${(S?.transactions || []).length} 筆明細；WAL 卡住操作編號 <code>${esc(pc.id || "—")}</code>（狀態碼：<code>${esc(halted?.code || "pending_commit")}</code>）。請先匯出 JSON 備份，再選擇修復方式：</p>
    <div class="lgrecon-act">
      <button type="button" class="btn sm" data-lg="backup-json">⬇ 匯出現狀 JSON 備份</button>
      <button type="button" class="btn sm" data-lgrecon-halt-action="discard_wal">以交易紀錄為準，放棄卡住的操作</button>
      ${canRevert ? `<button type="button" class="btn sm primary" data-lgrecon-halt-action="revert_pre_commit">還原到這次修改／匯入之前</button>` : `<span class="note">（未知或結構不完整操作不支援自動還原，請選以交易紀錄為準）</span>`}
    </div>
  </section>`;
}

function lgConflictsHtml(recon, R) {
  const openConfs = (recon?.conflicts || []).filter(c => c && c.status === "open");
  const coveredTxIds = new Set(openConfs.filter(c => c.kind === "same_day_order" && c.txId).map(c => c.txId));
  const syntheticSameDay = [];
  for (const x of R.txs || []) {
    if (x.sameDayRelation !== "unresolved" || x.errors.length || coveredTxIds.has(x.id)) continue;
    const sym = String(x.tx?.symbol || "").toUpperCase();
    const pos = R.positions.find(p => p.symbol === sym);
    syntheticSameDay.push({
      id: `syn-sd-${x.id}`,
      synthetic: true,
      kind: "same_day_order",
      symbol: sym,
      market: x.tx?.market || lgMkt(sym),
      txId: x.id,
      snapshotId: pos?.snapshotId || null,
      snapshotDate: pos?.snapshotDate || x.tx?.date || null,
      message: `${x.tx?.date || ""} 同日交易 ${sym}（${KLLedger.TYPE_LABEL[x.tx?.type] || x.tx?.type} ${lgN(x.tx?.shares)} 股）尚未決定在快照前或快照後`,
      tx: x.tx
    });
  }
  const all = [...openConfs, ...syntheticSameDay];
  if (!all.length) return "";
  const cards = all.map(c => {
    const sym = esc(c.symbol || "");
    const hint = typeof KLRecon?.settlementHint === "function" ? KLRecon.settlementHint(c.market) : "";
    if (c.kind === "same_day_order") {
      const snapDate = c.snapshotDate || c.payload?.snapshotDate || "";
      const snapId = c.snapshotId || c.payload?.snapshotId || "";
      const txId = c.txId || c.payload?.txId || "";
      return `<div class="lgrecon-item" data-cid="${esc(c.id)}">
        <div><b>${esc(nameOf(c.symbol || "") || sym)}</b> <small class="note">${sym}・同日順序未決（基準日 ${esc(snapDate)}）</small></div>
        <div class="note">${esc(c.message || "請指定此筆同日交易是否在快照截圖前已經成交")}${hint ? `（${esc(hint)}）` : ""}</div>
        <div class="lgrecon-act">
          <button type="button" class="btn sm" data-lgrecon-sameday="before_snapshot" data-cid="${c.synthetic ? "" : esc(c.id)}" data-txid="${esc(txId)}" data-snapid="${esc(snapId)}" data-snapdate="${esc(snapDate)}">快照前已涵蓋（僅存歷史）</button>
          <button type="button" class="btn sm primary" data-lgrecon-sameday="after_snapshot" data-cid="${c.synthetic ? "" : esc(c.id)}" data-txid="${esc(txId)}" data-snapid="${esc(snapId)}" data-snapdate="${esc(snapDate)}">快照後才成交（納入持倉）</button>
        </div>
      </div>`;
    }
    const isClose = c.targetShares === 0 && c.payload?.reason === "missing_in_full_snapshot";
    const leftTxt = c.baselineShares != null ? `帳本推算 ${lgN(c.baselineShares)} 股${c.baselineAvgCost != null ? ` @ ${lgN(+c.baselineAvgCost.toFixed(4))}` : ""}` : "尚無已確認基準";
    const rightTxt = isClose ? "完整截圖已無持股（0 股）" : `新截圖 ${lgN(c.targetShares)} 股${c.targetAvgCost != null ? ` @ ${lgN(+c.targetAvgCost.toFixed(4))}` : "（缺均價）"}`;
    const diffTxt = c.diffShares != null ? `差異 ${c.diffShares > 0 ? "+" : ""}${lgN(c.diffShares)} 股` : "";
    const needDate = c.kind === "missing_date" || c.kind === "ambiguous_date";
    const snap = c.snapshotId ? recon?.snapshots?.find(s => s && s.id === c.snapshotId) : null;
    const dateVal = snap?.date || c.payload?.asOf || lgToday();
    const needCost = !isClose && (!(c.targetAvgCost > 0) || c.kind === "missing_cost");
    return `<div class="lgrecon-item" data-cid="${esc(c.id)}">
      <div><b>${esc(nameOf(c.symbol || "") || sym)}</b> <small class="note">${sym}${diffTxt ? `・${esc(diffTxt)}` : ""}</small></div>
      <div class="note">雙邊對照：${esc(leftTxt)} ↔ ${esc(rightTxt)}</div>
      <div class="note">${esc(c.message || "")}${hint && !(c.message || "").includes(hint) ? ` — ${esc(hint)}` : ""}</div>
      <div class="lgrecon-act">
        ${needDate ? `<label class="note">基準日 <input type="date" data-lgrecon-date="${esc(c.id)}" value="${esc(dateVal)}" max="${lgToday()}" aria-label="基準日期"></label>` : ""}
        ${needCost ? `<label class="note">均價 <input type="number" inputmode="decimal" min="0" step="any" data-lgrecon-cost="${esc(c.id)}" value="${c.targetAvgCost ?? ""}" placeholder="補填正數均價" aria-label="成本均價"></label>` : ""}
        <input type="text" data-lgrecon-reason="${esc(c.id)}" maxlength="120" placeholder="採信新快照原因（必填）" aria-label="採信原因">
        <button type="button" class="btn sm" data-lgrecon-keep="${esc(c.id)}">保留兩邊／原基準</button>
        <button type="button" class="btn sm" data-lgrecon-imp="${esc(c.id)}">補匯入明細</button>
        <button type="button" class="btn sm primary" data-lgrecon-accept="${esc(c.id)}">${isClose ? "確認清倉歸零" : "採信新快照"}</button>
      </div>
    </div>`;
  }).join("");
  return `<section class="lgrecon-center" role="region" aria-label="待對帳項目中心">
    <h4>⚠︎ 待對帳項目（${all.length} 項）</h4>
    ${cards}
  </section>`;
}

function lgAuditDrawerHtml(recon) {
  const imps = recon?.imports || [], aud = recon?.audit || [];
  if (!imps.length && !aud.length) return "";
  const impLis = imps.slice().reverse().slice(0, 30).map(it => {
    const hs = (it.fileHashes || []).map(h => h.slice(0, 8)).join(", ");
    return `<li><code>${esc(String(it.at || "").slice(0, 16).replace("T", " "))}</code>・${it.kind === "trades" ? "成交明細" : "庫存快照"}（範圍：${esc(it.snapshotScope || "partial")}・基準日：${esc(it.asOf || "—")}・L1:${it.level1Count ?? 0} / L2:${it.level2Count ?? 0} / L3:${it.level3Count ?? 0}${hs ? `・原圖 ${esc(hs)}` : ""}）</li>`;
  }).join("");
  const audLis = aud.slice().reverse().slice(0, 50).map(a => `<li><code>${esc(String(a.at || "").slice(0, 16).replace("T", " "))}</code>・<b>${esc(a.action || "")}</b>${a.symbol ? ` ${esc(a.symbol)}` : ""}${a.reason ? `：${esc(a.reason)}` : ""}</li>`).join("");
  return `<details class="lgrecon-hist"><summary>匯入紀錄與對帳稽核（匯入 ${imps.length} 筆・稽核 ${aud.length} 筆）</summary>
    ${impLis ? `<p class="note" style="margin-top:8px"><b>最近匯入</b></p><ul>${impLis}</ul>` : ""}
    ${audLis ? `<p class="note" style="margin-top:8px"><b>對帳稽核軌跡</b></p><ul>${audLis}</ul>` : ""}
  </details>`;
}

function renderLedger() {
  const L = (W.lg ||= { open: null, form: null, prev: null, msg: "" });
  $("#wl").innerHTML = "";
  const hs = $("#holdSeg"); if (hs) hs.hidden = true; // 上方舊庫存的台股／美股切換對交易紀錄沒有作用：藏起來，改用各頁自己的「全部／台股／美股」
  const S0 = lgLoad(), recon = lgReconLoad();
  const hasTx = !!(S0 && Array.isArray(S0.transactions) && S0.transactions.length);
  const hasSnap = typeof KLRecon !== "undefined" && KLRecon.hasConfirmedSnapshots(recon);
  const hasOpenConf = !!(recon?.conflicts?.some(c => c && c.status === "open"));
  const hasHalted = !!(W.lgReconHalted || recon?.pendingCommit != null);
  if (L.view === "margin") return renderMargin(); // 融資不需要交易紀錄
  if (L.view === "alloc") {
    if ((hasTx || hasSnap) && !W.hsrcLegacy) return renderAlloc(S0 || lgStoreOrEmpty());
    const leg = lgLegacyOpen();
    if (((hasTx || hasSnap) && W.hsrcLegacy) || leg.open.length || leg.skipped.length) return renderAllocLegacy(leg, hasTx || hasSnap);
  }
  if (!S0 && !hasSnap && !hasOpenConf && !hasHalted) return ($("#lx").innerHTML = L.prev ? lgPreviewHtml(L.prev) : lgIntroHtml());
  const S = S0 || lgStoreOrEmpty();
  if (!L.view || L.view === "home") return renderHome(S); // 總覽（預設）：畫面在 pf-home.js，用到時才載入
  if (L.view === "thesis") return renderThesis(S); // 投資論點與近期事件：thesis.js＋pf-thesis.js，用到時才載入
  if (L.view === "report") return renderReport(S); // 可列印的投資組合報告：report.js＋pf-report.js（＋論點狀態用 thesis.js），用到時才載入
  if (L.view === "div") return renderDiv(S); // 股利現金流：divcal.js＋pf-divcal.js，用到時才載入
  if (L.view === "perf") return renderPerf(S);
  if (L.view === "margin") return renderMargin();
  if (L.view === "alloc") return renderAlloc(S);
  const quotes = new Map([...W.quotes].map(([c, q]) => [c, q?.price]).filter(([, p]) => p > 0));
  const R = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: lgToday(), prices: quotes });
  const rawTxById = new Map((S.transactions || []).map(z => [z?.id, z]));
  const staleTagIds = new Set((R.reconcile?.staleTags || []).map(z => z.txId));
  const cur = ["TWD", "USD"].filter(c => (R.totals[c] || R.cash[c]) && lgCurOk(c));
  const open = R.positions.filter(p => p.open && lgCurOk(p.currency)), closed = R.positions.filter(p => !p.open && lgCurOk(p.currency));
  const curBox = c => { const T = R.totals[c] || {}, C = R.cash[c], P = open.filter(p => p.currency === c), miss = P.filter(p => p.marketValue == null).length, un = P.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    return `<div class="lgcur"><h4>${c === "USD" ? "美股（美元）" : "台股（台幣）"}</h4><dl>
      <dt>未實現損益</dt><dd class="${cls(un)}">${!P.length ? "—" : miss === P.length ? `—<small class="note">（還沒有報價）</small>` : lgSgn(un, c) + (miss ? `<small class="note">（${miss} 檔缺價格，沒算進來）</small>` : "")}</dd>
      <dt>已實現損益</dt><dd class="${cls(T.realizedPnl)}">${lgSgn(T.realizedPnl || 0, c)}</dd><dt>股息（稅後）</dt><dd>${lgMoney(T.dividends || 0, c)}</dd>
      <dt>手續費</dt><dd>${lgMoney(T.fees || 0, c)}</dd><dt>稅</dt><dd>${lgMoney(T.taxes || 0, c)}</dd>
      ${C?.tracked ? `<dt>現金</dt><dd class="${C.negative ? "lgwarn" : ""}">${lgMoney(C.balance, c)}${C.negative ? "（負數：可能漏記入金）" : ""}</dd>` : ""}</dl></div>`; };
  const bad = R.txs.filter(x => x.errors.length), pend = R.positions.filter(p => p.pending.some(k => k.code === "fraction_unsettled"));
  const posRow = p => { const o = L.open === p.symbol, hasReconPend = p.pending.some(x => x.code === "recon_diff" || x.code === "same_day_order");
    return `<li class="lgpos${o ? " open" : ""}"><button type="button" class="row lgprow" data-lg="pos" data-c="${esc(p.symbol)}" aria-expanded="${o}">
      <span class="nm">${esc(nameOf(p.symbol))}<span class="cd">${esc(p.symbol)}${p.hasSnapshot ? `・快照 ${esc(p.snapshotDate)}` : ""}</span></span>
      <span><b>${lgN(p.shares)}</b><small>均價 ${p.avgCost == null ? "—" : lgN(+p.avgCost.toFixed(4))}</small></span>
      <span><b class="${cls(p.unrealizedPnl)}">${lgSgn(p.unrealizedPnl, p.currency)}</b><small>已實現 ${lgSgn(p.realizedPnl, p.currency)}</small></span>
      <span><small>股息 ${lgMoney(p.dividends, p.currency)}</small>${hasReconPend ? `<small class="lgwarn">⚠︎ 待對帳</small>` : p.pending.length ? `<small class="lgwarn">⚠︎ 待確認</small>` : ""}</span></button>
      ${o ? `<div class="lghist">${p.pending.map(x => `<p class="note lgwarn">⚠︎ ${esc(x.message)}${x.shares != null ? `（${lgN(x.shares)} 股）` : ""}</p>`).join("")}<table><thead><tr><th>日期</th><th>交易</th><th>持股</th><th>平均成本</th><th>總成本</th><th>已實現</th></tr></thead><tbody>${p.history.map(h => `<tr><td>${h.date}</td><td>${h.type === "snapshot" ? (h.origin === "full_snapshot_close" ? "庫存快照（完整清倉）" : "庫存快照") : (KLLedger.TYPE_LABEL[h.type] || esc(h.type))}${h.preSnapshot ? ` <small class="note">（快照前歷史）</small>` : ""}</td><td>${h.preSnapshot ? "—" : lgN(h.shares)}</td><td>${h.preSnapshot || h.avgCost == null ? "—" : lgN(+h.avgCost.toFixed(4))}</td><td>${h.preSnapshot ? "—" : lgMoney(h.costBasis, p.currency)}</td><td>${h.realized == null ? "" : lgSgn(h.realized, p.currency)}</td></tr>`).join("")}</tbody></table>${p.lots ? `<p class="note">尚未賣出的批次（FIFO）：${p.lots.map(l => `${l.date} ${lgN(l.shares)} 股、成本 ${lgMoney(l.cost, p.currency)}`).join("；") || "無"}</p>` : ""}</div>` : ""}</li>`; };
  const txRow = x => { const t = x.tx || {}, c = t.currency, d = t.type;
    const what = ["buy", "sell", "transfer_in"].includes(d) ? `${lgN(t.shares)} 股 × ${lgN(t.price)}` : ["stock_dividend", "transfer_out"].includes(d) ? `${lgN(t.shares)} 股` : d === "split" ? `比例 ${lgN(t.ratio)}` : d === "fraction_cash" ? `${lgN(t.shares)} 股 → ${lgMoney(t.amount, c)}` : t.amount != null ? lgMoney(t.amount, c) : t.shares != null ? `${lgN(t.shares)} 股` : "";
    const fee = (t.fee || t.tax) ? `<small>費 ${lgMoney(t.fee, c)}・稅 ${lgMoney(t.tax, c)}${t.feeEstimated ? "（估算）" : ""}</small>` : "";
    const tagObj = recon?.initialTags?.[x.id], rawTx = rawTxById.get(x.id) || t;
    const isInitTag = d === "transfer_in" && tagObj?.active === true && !staleTagIds.has(x.id) && (!tagObj.txHash || (typeof KLRecon !== "undefined" && (tagObj.txHash === KLRecon.txFingerprint(rawTx) || tagObj.txHash === KLRecon.txFingerprint(t))));
    const initBtn = d === "transfer_in" && !x.errors.length
      ? (isInitTag
        ? `<span class="lgbadge">已標為期初快照</span><button type="button" class="btn sm" data-lg="untag-init" data-id="${esc(x.id)}">撤回期初快照標記</button>`
        : `<button type="button" class="btn sm" data-lg="tag-init" data-id="${esc(x.id)}">標為期初快照</button>`)
      : "";
    const preTag = x.preSnapshot ? `<small class="note">（快照前歷史）</small>` : x.sameDayRelation === "unresolved" ? `<small class="lgwarn">（同日待對帳）</small>` : "";
    const iss = [...x.errors.map(e => `<li class="lgwarn">✕ ${esc(e.message)}</li>`), ...x.warnings.filter(w => w.code !== "fee_estimated").map(w => `<li>⚠︎ ${esc(w.message)}</li>`)].join("");
    return `<li class="lgtx${x.errors.length ? " err" : ""}"><span class="lgd">${esc(t.date || "")}</span><span><b>${KLLedger.TYPE_LABEL[d] || esc(d)}</b> ${t.symbol ? `${esc(nameOf(t.symbol))} <small class="note">${esc(t.symbol)}</small>` : ""}${x.mergedInto ? `<small class="note">（併入對應交易）</small>` : ""}${preTag}</span>
      <span>${what}${fee}</span><span class="lgact">${initBtn}<button type="button" class="btn sm" data-lg="edit" data-id="${esc(x.id)}">修改</button><button type="button" class="btn sm" data-lg="del" data-id="${esc(x.id)}">刪除</button></span>${iss ? `<ul class="lgiss">${iss}</ul>` : ""}</li>`; };
  // 錯誤、待確認的提醒不分市場都顯示（不能因為切換就藏起來）；清單只列選到的市場
  const txs = R.txs.filter(x => lgCurOk(x.tx?.currency || "TWD")).sort((a, b) => String(b.tx?.date).localeCompare(String(a.tx?.date)) || b.index - a.index);
  const mk = lgMktSel() === "all" ? "" : `，只顯示${lgMktSel() === "us" ? "美股" : "台股"}；全部 ${R.txs.length} 筆`;
  const staleHtml = R.reconcile?.staleTags?.length ? `<div class="lgrecon-stale note lgwarn">⚠︎ 偵測到 ${R.reconcile.staleTags.length} 筆與現有交易脫鉤的期初快照標記（${R.reconcile.staleTags.map(x => esc(x.symbol || x.txId)).join("、")}），已改用一般交易計算。<button type="button" class="btn sm" data-lgrecon-clean-stale>一鍵停用過期標記</button></div>` : "";
  $("#lx").innerHTML = lgViewSeg() + `<div class="lgbar">${lgMktSeg()}<span>成本算法：<b>${R.methodLabel}</b></span><button type="button" class="btn sm" data-lg="method">改用${S.method === "fifo" ? "加權平均" : "先進先出"}</button><button type="button" class="btn sm primary" data-lg="add">＋ 新增交易</button><button type="button" class="btn sm" data-lg="imp">${typeof ico === "function" ? ico("cam") : ""}截圖匯入</button><button type="button" class="btn sm" data-lg="csv">⬇ 匯出 CSV</button></div>
    ${L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : ""}
    ${lgHaltedHtml(W.lgReconHalted, recon, S)}
    ${staleHtml}
    ${lgConflictsHtml(recon, R)}
    ${bad.length ? `<p class="note lgwarn">✕ ${bad.length} 筆交易有錯誤，沒有算進去（下面標紅色的），請修改或刪除。</p>` : ""}${pend.length ? `<p class="note lgwarn">⚠︎ ${pend.map(p => esc(nameOf(p.symbol))).join("、")} 合股後有不足一股的部分還沒結算，股數與成本是暫時的；請新增一筆「零股現金結算」。</p>` : ""}
    ${L.form ? lgFormHtml(L.form, S) : ""}
    <div class="lgcurs">${cur.map(curBox).join("") || `<p class="note">${lgMktSel() === "all" ? "還沒有交易。" : `沒有${lgMktSel() === "us" ? "美股" : "台股"}的交易。`}</p>`}</div>
    <p class="note">台幣和美元分開計算，不相加。未實現損益用目前報價；費用標「估算」的是新增時依費用規則與持股頁「手續費折扣」設定${lgDiscText()}算的（已存交易不會隨設定變更而重算），實際以券商對帳單為準。${S.migratedFrom ? `由舊庫存建立於 ${esc(String(S.at || "").slice(0, 10))}；舊庫存資料仍保留。` : ""}</p>
    ${open.length ? `<h4 class="lgh">持有中（${open.length} 檔）</h4><ul class="lglist">${open.map(posRow).join("")}</ul>` : ""}
    ${closed.length ? `<h4 class="lgh">已出清（${closed.length} 檔）</h4><ul class="lglist">${closed.map(posRow).join("")}</ul>` : ""}
    <h4 class="lgh">交易紀錄（${txs.length} 筆${mk}）</h4><ul class="lglist lgtxs">${txs.map(txRow).join("") || `<li class="note">還沒有交易。</li>`}</ul>
    ${lgAuditDrawerHtml(recon)}`;
}
function lgIntroHtml() {
  const n = Object.keys(W.hold || {}).length;
  return `<div class="lgintro"><h4>交易紀錄</h4><p class="note">記下每一筆買進、賣出、股息、配股、拆股、入金出金，系統會算出平均成本（或先進先出）、已實現損益、股息與費用。資料只存在這台裝置（有開雲端同步的話會一起同步）。</p>
    ${n ? `<button type="button" class="btn primary" data-lg="preview">從現有庫存建立（先預覽，不會馬上改動）</button>` : ""}<button type="button" class="btn" data-lg="imp">${typeof ico === "function" ? ico("cam") : ""}截圖匯入（庫存快照／交易明細）</button><button type="button" class="btn" data-lg="blank">從空白開始</button>
    <p class="note">從現有庫存建立：每一檔變成一筆「股票轉入」，成本用你記的平均成本；舊的庫存資料會保留，不會刪除。</p></div>`;
}
function lgPreviewHtml(P) {
  const ok = P.items.filter(i => i.action === "migrate"), skip = P.items.filter(i => i.action !== "migrate");
  return `<div class="lgprev"><h4>搬移預覽</h4><p class="note">確認後才會建立交易紀錄；舊的庫存資料不會被改動或刪除。</p>
    <table><thead><tr><th>代號</th><th>結果</th><th>內容</th></tr></thead><tbody>${ok.map(i => `<tr><td>${esc(i.symbol)}</td><td>股票轉入</td><td>${esc(i.tx.date)}・${lgN(i.tx.shares)} 股・每股成本 ${lgN(i.tx.price)}${i.problems.length ? `<br><small class="lgwarn">⚠︎ ${esc(i.problems.map(p => p.message).join("；"))}</small>` : ""}</td></tr>`).join("")}
    ${skip.map(i => `<tr class="lgwarn"><td>${esc(i.symbol || i.key)}</td><td>不搬</td><td>${esc(i.problems.map(p => p.message).join("；"))}</td></tr>`).join("")}</tbody></table>
    <p class="note">共 ${ok.length} 筆會建立、${skip.length} 筆不搬。</p>
    <div class="lgbar"><label>成本算法 <select id="lgMethod"><option value="avg">加權平均成本</option><option value="fifo">先進先出（FIFO）</option></select></label>
    <button type="button" class="btn primary" data-lg="commit" ${ok.length && P.ok ? "" : "disabled"}>確認建立</button><button type="button" class="btn" data-lg="cancel">取消</button></div></div>`;
}
function lgFormHtml(F, S) {
  const type = F.type || "buy", fs = LG_FIELDS[type], v = F.v || {};
  const refOpts = S.transactions.filter(t => t.type === "buy" || t.type === "sell" || t.type === "dividend").map(t => `<option value="${esc(t.id)}" ${v.ref === t.id ? "selected" : ""}>${esc(t.date)} ${KLLedger.TYPE_LABEL[t.type]} ${esc(t.symbol || "")}</option>`).join("");
  const inp = k => k === "dayTrade" ? `<label class="chk"><input type="checkbox" name="dayTrade" ${v.dayTrade ? "checked" : ""}> ${LG_LABEL[k]}</label>`
    : k === "ref" ? `<label>${LG_LABEL[k]}<select name="ref"><option value="">（不指定）</option>${refOpts}</select></label>`
    : `<label>${LG_LABEL[k]}${k === "ratio" ? (type === "split" ? "（一拆四填 4，五合一填 0.2）" : "（配 1 元股票股利填 0.1，可空白）") : ""}<input name="${k}" ${k === "symbol" ? `autocapitalize="characters" value="${esc(v.symbol || "")}"` : `inputmode="decimal" value="${esc(v[k] ?? "")}"`}></label>`;
  return `<form class="lgform" id="lgForm"><h4>${F.id ? "修改交易" : "新增交易"}</h4>
    <label>類型<select name="type" id="lgType">${KLLedger.TYPES.map(t => `<option value="${t}" ${t === type ? "selected" : ""}>${KLLedger.TYPE_LABEL[t]}</option>`).join("")}</select></label>
    <label>日期<input type="date" name="date" value="${esc(v.date || lgToday())}" max="${lgToday()}"></label>
    ${fs.includes("symbol") ? "" : `<label>市場<select name="market"><option value="tw" ${v.market !== "us" ? "selected" : ""}>台股（台幣）</option><option value="us" ${v.market === "us" ? "selected" : ""}>美股（美元）</option></select></label>`}
    ${fs.map(inp).join("")}<label class="wide">備註<input name="note" maxlength="200" value="${esc(v.note || "")}"></label>
    ${F.err ? `<ul class="lgiss">${F.err.map(e => `<li class="lgwarn">✕ ${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="lgbar"><button type="submit" class="btn primary">${F.id ? "儲存修改" : "加入"}</button><button type="button" class="btn" data-lg="close">取消</button></div></form>`;
}
// 表單 → 交易（空白的數字欄位不帶，讓引擎估算費用；市場由代號判斷，沒有代號的交易用選的市場）
function lgFromForm(form, F) {
  const fd = new FormData(form), type = fd.get("type"), o = { type, date: fd.get("date"), note: String(fd.get("note") || "").trim(), source: "manual" };
  for (const k of LG_FIELDS[type]) { if (k === "dayTrade") { o.dayTrade = fd.get("dayTrade") === "on"; continue; } const s = String(fd.get(k) ?? "").trim(); if (!s) continue; o[k] = k === "symbol" ? s.toUpperCase() : k === "ref" ? s : Number(s.replace(/,/g, "")); }
  const m = o.symbol ? lgMkt(o.symbol) : fd.get("market") === "us" ? "us" : "tw";
  o.market = m; o.currency = m === "us" ? "USD" : m === "tw" ? "TWD" : null;
  if (F.orig?.feeEstimated || F.orig?.feeEst || F.orig?.taxEst) {
    const sameCost = o.type === F.orig.type && o.symbol === F.orig.symbol && o.shares === F.orig.shares && o.price === F.orig.price && !!o.dayTrade === !!F.orig.dayTrade;
    const hasFieldEst = typeof F.orig.feeEst === "boolean" || typeof F.orig.taxEst === "boolean";
    const feeSame = o.fee !== undefined && o.fee === F.orig.fee, taxSame = (o.tax ?? 0) === (F.orig.tax ?? 0);
    if (hasFieldEst) {
      if (sameCost) {
        if (F.orig.feeEst && feeSame) o.feeEst = true;
        if (F.orig.taxEst && o.tax !== undefined && taxSame) o.taxEst = true;
        if (o.feeEst || o.taxEst) o.feeEstimated = true;
      } else {
        if (F.orig.feeEst) { if (feeSame) delete o.fee; }
        if (F.orig.taxEst) { if (taxSame) delete o.tax; }
      }
    } else if (F.orig.feeEstimated && (feeSame || (o.type === "sell" && o.tax !== undefined && taxSame))) {
      // 舊資料僅有整筆 feeEstimated、未記錄個別欄位來源：採保守策略，不靜默刪除可能是手填的數值
      o.feeEstimated = true;
      if (!sameCost) o.legacyEstAmbiguous = true;
    }
  }
  return F.id ? { ...o, id: F.id, v: 1 } : KLLedger.makeTx(o); // 修改：整筆用表單的內容重建（換了類型時，舊類型的欄位不會留下來），編號不變
}

async function lgHandleReconClick(el, L) {
  if (typeof KLRecon === "undefined") { L.msg = "對帳模組尚未載入"; renderList(); return true; }
  if (el.matches("[data-lgrecon-halt-action]")) {
    const choice = el.dataset.lgreconHaltAction;
    const res = await withPfCommitLock(() => {
      const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
      const pf0 = lgParseRaw(rawPf), recon0 = lgParseRaw(rawRecon);
      const r = KLRecon.resolveHalted(pf0, recon0, choice, { source: "ui_halted_card" });
      if (!r.ok) return { ok: false, code: r.code, errors: [r.error || r.code] };
      const msg = choice === "discard_wal" && r.summary
        ? `將以交易紀錄為準放棄卡住的對帳匯入（本次未入帳 ${r.summary.missingCount} 筆：${r.summary.missingSymbols.join("、") || "無標的"}），要繼續嗎？`
        : choice === "discard_wal"
          ? "將以目前的交易紀錄為準，清除卡住的對帳提交紀錄（不可復原），要繼續嗎？"
          : "將還原到這次修改／匯入之前的雙鍵一致狀態，要繼續嗎？";
      if (!confirm(msg)) return { ok: true, cancelled: true };
      const pr = KLRecon.pruneStore(r.reconStore, KLRecon.MAX_BYTES);
      if (!pr.ok) return { ok: false, code: pr.code, errors: [`對帳核心資料超過 ${Math.round(pr.maxBytes / 1024)}KB 上限，請先匯出 JSON 備份`] };
      if (r.pfChanged) {
        let pw = false; try { pw = store.set(LG_KEY, r.pfStore); } catch { pw = false; }
        if (!pw) return { ok: false, code: "storage_write_failed", errors: ["還原交易紀錄寫入失敗，維持原樣"] };
      }
      const w = lgReconWrite(pr.store, { allowPendingCommitWrite: true });
      if (!w.ok) return w;
      return { ok: true };
    });
    if (res && !res.cancelled) {
      L.msg = res.ok ? "已完成受阻對帳提交修復，寫入功能已恢復。" : (res.errors?.[0] || "修復失敗。");
      if (typeof holdSrcApply === "function") holdSrcApply();
      renderList();
    }
    return true;
  }
  if (el.matches("[data-lgrecon-clean-stale]")) {
    const res = await withPfCommitLock(() => {
      const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
      const pf0 = lgParseRaw(rawPf) || lgStoreOrEmpty(), recon0 = lgParseRaw(rawRecon);
      if (!recon0) return { ok: false, errors: ["找不到對帳資料"] };
      const R0 = KLLedger.buildReconciledLedger(pf0, recon0, { method: pf0.method, today: lgToday() });
      let curRecon = recon0, n = 0;
      for (const st of R0.reconcile?.staleTags || []) {
        const dec = KLRecon.deactivateTagsForTx(curRecon, st.txId);
        if (dec.ok) { curRecon = dec.store; n++; }
      }
      if (!n) return { ok: true, count: 0 };
      const w = lgReconWrite(curRecon, { expectedRawRecon: rawRecon });
      return w.ok ? { ok: true, count: n } : w;
    });
    L.msg = res.ok ? (res.count ? `已停用 ${res.count} 筆過期期初標記。` : "沒有需要停用的過期標記。") : (res.errors?.[0] || "清理失敗。");
    renderList();
    return true;
  }
  if (el.matches("[data-lgrecon-sameday]")) {
    const rel = el.dataset.lgreconSameday;
    const cid = el.dataset.cid, txId = el.dataset.txid, snapId = el.dataset.snapid || null, snapDate = el.dataset.snapdate;
    const res = await withPfCommitLock(() => {
      const rawRecon = lgRawGet(LG_RAW_RECON);
      const recon0 = lgParseRaw(rawRecon) || KLRecon.emptyStore();
      if (cid) {
        const r = KLRecon.resolveConflict(recon0, cid, rel === "before_snapshot" ? "mark_before_snapshot" : "mark_after_snapshot", { txId, snapshotId: snapId, snapshotDate: snapDate, today: lgToday() });
        if (!r.ok) return { ok: false, errors: [r.error || r.code] };
        return lgReconWrite(r.store, { expectedRawRecon: rawRecon });
      }
      const next = KLRecon.cloneStore(recon0);
      next.sameDayRelations[txId] = { relation: rel, snapshotId: snapId, snapshotDate: snapDate, at: new Date().toISOString(), source: "ui" };
      next.audit.push({ id: "aud-sd-" + Date.now(), at: new Date().toISOString(), action: "same_day_order_resolved", symbol: null, snapshotId: snapId, conflictId: null, txId, batchId: null, reason: rel === "before_snapshot" ? "標記為快照前已涵蓋" : "標記為快照後才成交" });
      return lgReconWrite(next, { expectedRawRecon: rawRecon });
    });
    L.msg = res.ok ? (rel === "before_snapshot" ? "已標記為快照前已涵蓋（僅存歷史，不異動交易紀錄）。" : "已標記為快照後才成交（納入持倉計算，不異動交易紀錄）。") : (res.errors?.[0] || "更新同日順序失敗。");
    renderList();
    return true;
  }
  if (el.matches("[data-lgrecon-keep]")) {
    const cid = el.dataset.lgreconKeep;
    const res = await withPfCommitLock(() => {
      const rawRecon = lgRawGet(LG_RAW_RECON), recon0 = lgParseRaw(rawRecon);
      const r = KLRecon.resolveConflict(recon0, cid, "keep_both", { today: lgToday() });
      if (!r.ok) return { ok: false, errors: [r.error || r.code] };
      return lgReconWrite(r.store, { expectedRawRecon: rawRecon });
    });
    L.msg = res.ok ? "已保留既有基準（待之後補明細釐清）。" : (res.errors?.[0] || "操作失敗。");
    renderList();
    return true;
  }
  if (el.matches("[data-lgrecon-imp]")) {
    lgOpenImport();
    return true;
  }
  if (el.matches("[data-lgrecon-accept]")) {
    const cid = el.dataset.lgreconAccept;
    const reasonInp = document.querySelector(`[data-lgrecon-reason="${cid}"]`);
    let reason = String(reasonInp?.value || "").trim();
    if (!reason) reason = String(prompt("採信新快照／確認清倉歸零須填寫原因供稽核：") || "").trim();
    if (!reason) { L.msg = "請填寫採信新快照的原因後再確認。"; renderList(); return true; }
    const dateVal = String(document.querySelector(`[data-lgrecon-date="${cid}"]`)?.value || "").trim();
    const costRaw = document.querySelector(`[data-lgrecon-cost="${cid}"]`)?.value;
    const avgCost = costRaw != null && String(costRaw).trim() !== "" ? Number(costRaw) : undefined;
    const res = await withPfCommitLock(() => {
      const rawRecon = lgRawGet(LG_RAW_RECON), recon0 = lgParseRaw(rawRecon);
      const r = KLRecon.resolveConflict(recon0, cid, "accept_new", { reason, ...(dateVal ? { asOf: dateVal } : {}), ...(avgCost !== undefined ? { avgCost } : {}), today: lgToday() });
      if (!r.ok) return { ok: false, errors: [r.error || r.code] };
      return lgReconWrite(r.store, { expectedRawRecon: rawRecon });
    });
    L.msg = res.ok ? "已採信新快照並記錄稽核。" : (res.errors?.[0] || "採信失敗。");
    renderList();
    return true;
  }
  return false;
}

document.addEventListener("click", async e => {
  const L = (W.lg ||= {});
  const lxEl = document.getElementById("lx");
  const reconEl = e.target.closest("[data-lgrecon-halt-action],[data-lgrecon-clean-stale],[data-lgrecon-sameday],[data-lgrecon-keep],[data-lgrecon-imp],[data-lgrecon-accept]");
  if (reconEl && lxEl?.contains(reconEl)) {
    L.msg = "";
    await lgHandleReconClick(reconEl, L);
    return;
  }
  const b = e.target.closest("[data-lg]");
  if (!b) return;
  const inLx = lxEl?.contains(b), inImp = document.getElementById("impSheet")?.contains(b);
  if (!inLx && !inImp) return;
  const a = b.dataset.lg; L.msg = "";
  if ((a === "view" || a === "view-conflicts") && inImp) {
    if (typeof closeImport === "function") closeImport();
    L.view = a === "view-conflicts" ? "tx" : b.dataset.v;
    L.form = null;
    renderList();
    if (a === "view-conflicts") setTimeout(() => document.querySelector(".lgrecon-center")?.scrollIntoView?.({ block: "nearest" }), 30);
    return;
  }
  if (!inLx) return;
  if (a === "view-conflicts") {
    L.view = "tx"; L.form = null; renderList();
    setTimeout(() => document.querySelector(".lgrecon-center")?.scrollIntoView?.({ block: "nearest" }), 30);
    return;
  }
  if (a === "preview") { L.prev = KLLedger.previewMigration(W.hold || {}, { today: lgToday(), now: new Date().toISOString() }); renderList(); return; }
  if (a === "cancel") { L.prev = null; renderList(); return; }
  if (a === "backup-json") { if (typeof syncExport === "function") syncExport(); return; }
  if (a === "commit") {
    const P = L.prev; if (!P?.store) return;
    const s = { ...P.store, method: $("#lgMethod")?.value === "fifo" ? "fifo" : "avg" };
    const v = await withPfCommitLock(() => lgSave(s));
    if (!v.ok) { L.prev = null; L.msg = v.errors?.[0] || "建立失敗：資料檢查沒有通過，沒有寫入。"; }
    else { L.prev = null; L.view = "tx"; L.msg = `已建立交易紀錄（${s.transactions.length} 筆）。舊的庫存資料仍保留。`; }
    renderList(); return;
  }
  if (a === "blank") {
    const v = await withPfCommitLock(() => lgSave({ v: 1, method: "avg", transactions: [], at: new Date().toISOString() }));
    if (v.ok) { L.view = "tx"; L.msg = "已建立空白的交易紀錄。"; }
    else L.msg = v.errors?.[0] || "建立失敗。";
    renderList(); return;
  }
  if (a === "add") { L.form = { type: "buy", v: { date: lgToday() } }; renderList(); return; }
  if (a === "imp") return lgOpenImport();
  if (a === "close") { L.form = null; renderList(); return; }
  if (a === "view") { L.view = b.dataset.v; L.form = null; renderList(); return; }
  if (a === "hsrcLedger") { W.hsrcLegacy = false; if (typeof holdSrcApply === "function") holdSrcApply(); renderList(); return; }
  if (a === "range") { L.pfRange = b.dataset.v; renderList(); return; }
  if (a === "mkt") { L.mkt = b.dataset.v; renderList(); return; }
  if (a === "pfreload") { W.fresh = Date.now() + 15000; pfExpire(); renderList(); return; }
  if (a === "mgadd") { L.mgForm = { v: {} }; renderList(); return; }
  if (a === "mgclose") { L.mgForm = null; renderList(); return; }
  if (a === "mgedit") { const A = mgLoad().accounts.find(x => x.id === b.dataset.id); if (A) L.mgForm = { id: A.id, v: A }; renderList(); return; }
  if (a === "mgdel") { const S2 = mgLoad(), A = S2.accounts.find(x => x.id === b.dataset.id); if (A && confirm(`刪除「${A.name || "帳戶"}」的融資資料？（只刪這個試算，不影響券商）`)) { const r = mgSave({ ...S2, accounts: S2.accounts.filter(x => x.id !== A.id) }); L.msg = r.ok ? "已刪除。" : "刪除失敗：資料檢查沒有通過。"; } renderList(); return; }
  if (a === "csv") { const S = lgLoad(); if (!S) return; if (!S.transactions.length) { L.msg = "還沒有交易，沒有東西可以匯出。"; renderList(); return; } const url = URL.createObjectURL(new Blob([KLLedger.toCSV(S.transactions)], { type: "text/csv;charset=utf-8" })), el = document.createElement("a"); el.href = url; el.download = `交易紀錄-${lgToday()}.csv`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); L.msg = `已匯出 ${S.transactions.length} 筆交易（CSV）。完整備份（可以匯回）請用「工具 → 備份同步 → 匯出備份檔」。`; renderList(); return; }
  if (a === "pos") { L.open = L.open === b.dataset.c ? null : b.dataset.c; renderList(); return; }
  if (a === "edit") { const t = lgLoad()?.transactions.find(x => x.id === b.dataset.id); if (t) L.form = { id: t.id, orig: t, type: t.type, v: { ...t } }; renderList(); return; }
  if (a === "tag-init") {
    const id = b.dataset.id, t = lgLoad()?.transactions.find(x => x.id === id);
    if (!t || t.type !== "transfer_in") return;
    if (!(t.price > 0)) {
      L.form = { id: t.id, orig: t, type: t.type, v: { ...t } };
      L.msg = "這筆股票轉入缺少大於 0 的成本均價；請先補填每股成本再標為期初快照（不可建立 0 成本基準）。";
      renderList(); return;
    }
    const res = await withPfCommitLock(() => {
      const rawRecon = lgRawGet(LG_RAW_RECON), recon0 = lgParseRaw(rawRecon) || KLRecon.emptyStore();
      const tCur = lgParseRaw(lgRawGet(LG_RAW_PF))?.transactions?.find(x => x.id === id);
      if (!tCur) return { ok: false, errors: ["找不到該筆交易紀錄"] };
      const r = KLRecon.tagInitialTx(recon0, tCur, { today: lgToday() });
      if (!r.ok) return { ok: false, errors: [r.error || r.code] };
      return lgReconWrite(r.store, { expectedRawRecon: rawRecon });
    });
    L.msg = res.ok ? `已將 ${esc(t.symbol)}（${esc(t.date)}）標為期初快照基準。` : (res.errors?.[0] || "標記失敗。");
    renderList(); return;
  }
  if (a === "untag-init") {
    const id = b.dataset.id;
    if (!confirm("確定要撤回這筆「期初快照」標記？（原交易紀錄與正數成本仍會保留）")) return;
    const res = await withPfCommitLock(() => {
      const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
      const pf0 = lgParseRaw(rawPf) || lgStoreOrEmpty(), recon0 = lgParseRaw(rawRecon);
      const r = KLRecon.untagInitialTx(recon0, id);
      if (!r.ok) return { ok: false, errors: [r.error || r.code] };
      const val = KLLedger.validateStore(pf0, { today: lgToday(), recon: r.store });
      if (!val.ok) return { ok: false, errors: [`無法撤回標記：${val.errors?.[0]?.errors?.[0]?.message || val.code}`] };
      return lgReconWrite(r.store, { expectedRawRecon: rawRecon });
    });
    L.msg = res.ok ? "已撤回期初快照標記（該筆轉入恢復依一般交易計算）。" : (res.errors?.[0] || "撤回失敗。");
    renderList(); return;
  }
  if (a === "method") {
    const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON), S = lgParseRaw(rawPf);
    if (S && confirm(`整本帳改用「${S.method === "fifo" ? "加權平均成本" : "先進先出（FIFO）"}」重新計算？已實現損益會跟著改變。`)) {
      const v = await withPfCommitLock(() => lgSave({ ...S, method: S.method === "fifo" ? "avg" : "fifo" }, { expectedRawPf: rawPf, expectedRawRecon: rawRecon }));
      L.msg = v.ok ? "已改用新的成本算法重新計算。" : (v.errors?.[0] || "改不了：資料檢查沒有通過。");
    }
    renderList(); return;
  }
  if (a === "del") {
    const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
    const S = lgParseRaw(rawPf), recon = lgReconLoad(), id = b.dataset.id;
    if (!S) return;
    const targetTx = S.transactions.find(t => t.id === id);
    if (!targetTx) return;
    const plan = typeof KLRecon !== "undefined" ? KLRecon.planDeactivateTags(recon, targetTx, { today: lgToday() }) : { ok: true, needsWal: false, previewRecon: recon };
    const I = KLLedger.deleteImpact(S.transactions, id, { method: S.method, today: lgToday(), reconBefore: recon, reconAfter: plan.previewRecon });
    if (!I.ok) return;
    if (I.newErrors.length) { L.msg = `不能刪除：刪掉後有 ${I.newErrors.length} 筆交易會出錯（例如後面的賣出變成賣超），請先修改或刪除那些交易。`; renderList(); return; }
    const p = I.position, txt = [`刪除這筆交易？`, plan.needsWal ? "（注意：此筆為期初快照交易，刪除後將同步停用其期初快照標記）" : "", I.affected.length ? `之後同一檔還有 ${I.affected.length} 筆交易，成本與已實現損益會重新計算。` : "", p?.before && p?.after ? `持股：${lgN(p.before.shares)} → ${lgN(p.after.shares)} 股；總成本：${lgN(p.before.costBasis)} → ${lgN(p.after.costBasis)}` : ""].filter(Boolean).join("\n");
    if (!confirm(txt)) return;
    const nextPf = { ...S, transactions: S.transactions.filter(t => t.id !== id) };
    let v;
    if (plan.needsWal) v = await lgCommitDualStores({ expectedRawPf: rawPf, expectedRawRecon: rawRecon, nextPf, payload: plan.payload });
    else v = await withPfCommitLock(() => lgSave(nextPf, { expectedRawPf: rawPf, expectedRawRecon: rawRecon }));
    L.msg = v.ok ? (plan.needsWal ? "已刪除交易並同步停用期初快照標記。" : "已刪除。") : (v.errors?.[0] || "刪除失敗：資料檢查沒有通過，沒有改動。");
    renderList(); return;
  }
});
document.addEventListener("change", e => { if (e.target.id !== "lgType" || !W.lg?.form) return; const form = e.target.form, fd = new FormData(form), v = {}; for (const [k, x] of fd) v[k] = x; W.lg.form = { ...W.lg.form, type: e.target.value, v, err: null }; renderList(); });
document.addEventListener("submit", async e => {
  if (e.target.id === "mgForm") return mgSubmit(e);
  if (e.target.id === "lgImpForm") { e.preventDefault(); return lgSaveImport(); }
  if (e.target.id !== "lgForm") return; e.preventDefault();
  const L = W.lg, F = L.form;
  const rawPf = lgRawGet(LG_RAW_PF), rawRecon = lgRawGet(LG_RAW_RECON);
  const S = lgParseRaw(rawPf), recon = lgReconLoad();
  if (!F || !S) return;
  const { legacyEstAmbiguous, ...rawTx } = lgFromForm(e.target, F), cRes = KLLedger.checkTx(rawTx, { today: lgToday(), rules: lgRules() });
  const tx = !cRes.errors.length && cRes.tx ? {
    ...rawTx,
    fee: cRes.tx.fee,
    tax: cRes.tx.tax,
    ...(cRes.tx.feeEstimated ? { feeEstimated: true } : {}),
    ...(cRes.tx.feeEst ? { feeEst: true } : {}),
    ...(cRes.tx.taxEst ? { taxEst: true } : {}),
    ...(cRes.tx.assetType && !rawTx.assetType ? { assetType: cRes.tx.assetType } : {})
  } : rawTx;
  const list = F.id ? S.transactions.map(t => (t.id === F.id ? tx : t)) : [...S.transactions, tx];
  const plan = F.id && F.orig && typeof KLRecon !== "undefined"
    ? KLRecon.planUpdateTxTag(recon, F.orig, tx, { today: lgToday() })
    : { ok: true, needsWal: false, previewRecon: recon };
  const R = KLLedger.buildReconciledLedger(list, plan.previewRecon, { method: S.method, today: lgToday() }), me = R.txs.find(x => x.id === tx.id);
  const newErr = R.txs.filter(x => x.errors.length && x.id !== tx.id);
  const fd = new FormData(e.target), v = {}; for (const [k, x] of fd) v[k] = x;
  if (me?.errors.length || newErr.length) { L.form = { ...F, v, err: [...(me?.errors || []).map(x => x.message), ...newErr.map(x => `會讓 ${x.tx?.date || ""} 的${KLLedger.TYPE_LABEL[x.tx?.type] || "交易"}出錯：${x.errors[0].message}`)] }; return renderList(); }
  const warn = [
    ...(plan.needsWal ? [plan.mode === "update" ? "這筆已標為期初快照，修改後將同步更新期初快照。" : "修改類型／代號／無有效成本後，將同步停用期初快照標記。"] : []),
    ...(legacyEstAmbiguous ? ["這筆舊交易未分別記錄手續費與交易稅的估算來源，已保留原數值（若需重新估算請清空該欄位）"] : []),
    ...(cRes.warnings || []).filter(w => w.code === "fee_estimated" && (!F.orig?.feeEstimated || rawTx.fee === undefined || (tx.type === "sell" && rawTx.tax === undefined))).map(w => w.message),
    ...(me?.warnings || []).filter(w => w.code !== "fee_estimated").map(w => w.message)
  ];
  if (warn.length && !confirm(`請確認：\n${warn.join("\n")}\n\n仍要${F.id ? "儲存" : "加入"}？`)) return;
  const nextPf = { ...S, transactions: list };
  let r;
  if (plan.needsWal) r = await lgCommitDualStores({ expectedRawPf: rawPf, expectedRawRecon: rawRecon, nextPf, payload: plan.payload });
  else r = await withPfCommitLock(() => lgSave(nextPf, { expectedRawPf: rawPf, expectedRawRecon: rawRecon }));
  if (!r.ok) { L.form = { ...F, v, err: r.errors?.length ? r.errors : ["資料檢查沒有通過，沒有儲存。"] }; return renderList(); }
  L.form = null;
  L.msg = F.id ? (plan.needsWal ? "已儲存修改並同步更新對帳快照。" : "已儲存修改。") : "已加入。";
  renderList();
});

/* ================= 績效（投資組合第 5 階段 B）：perf.js 算，這裡畫 =================
   價格：每一檔 /api/kline 原始收盤（最多 24 個月；股息已經是現金流，不用還原價）；比較基準：台幣＝加權指數（價格指數，不含股息）、美元＝SPY 還原價（含息）。
   畫面：重點數字、淨值走勢 vs 比較基準（同一起點＝100）、回撤（另一張圖，不用雙軸）、月報酬表、歸因排行、估算原因與計算口徑。
   日期範圍：3 個月／6 個月／1 年／全部；圖上滑鼠或手指移動顯示當天數值。 */
const lgViewSeg = () => ""; // 分頁列搬到庫存上方的主分頁（watch.html 的 HOLD_NAV），這裡不再畫第二排；各頁仍會呼叫，所以留著
// 績效（perf.js）與匯率合併（fx.js）用到時才載入，照順序（fx.js 要用到 perf.js）
function lgPerfLib() {
  if (typeof KLPerf !== "undefined" && typeof KLFx !== "undefined") return Promise.resolve();
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgPerfP ||= (typeof KLPerf !== "undefined" ? Promise.resolve() : one("perf.js")).then(() => (typeof KLFx !== "undefined" ? null : one("fx.js"))).catch(e => { W.lgPerfP = null; throw e; }));
}
// 價格：同一組代號 10 分鐘內重複用；單一檔失敗不影響其他檔（引擎會標「沒有價格」）
// 資料來源與更新標示（第 9 階段，pfsrc.js）：抓失敗時 3 秒後自動重試一次，之後要按「重新載入」；平常 10 分鐘內共用
const pfTtl = (X, ok = 600000) => (X.failed && !X.retried ? 3000 : ok);
const pfExpire = (ks = ["lgPx", "lgAl", "lgMg"]) => ks.forEach(k => { if (W[k] && !W[k].busy && !W[k].refreshing) W[k] = { ...W[k], at: 0, failed: false, retried: false }; });
const pfRetryLater = X => { if (X.failed && !X.retried) setTimeout(() => { if (W.lt === "hold" && W.holdView === "tx") renderList(); }, 3100); };
// 開始抓：有上一次的資料就先留著顯示（refreshing），沒有才顯示載入中。tok：只有最新一次請求的結果能寫回，晚回來的舊請求不覆蓋新資料
function pfBegin(k, key, n) {
  const X = W[k], prev = X && (X.px || X.prices) ? X : null, tok = (W.lgTok = (W.lgTok || 0) + 1);
  W[k] = prev && prev.key === key ? { ...prev, refreshing: true, tok } : { key, busy: true, at: Date.now(), n, tok, items: prev?.items, px: undefined };
  return { prev, tok, retry: !!(prev?.failed && prev.key === key) };
}
// 交易日曆：週末不開；台股用證交所休市日表（只有今年的），美股用 core.js 的美股休市日；不知道回 null
const pfCal = {
  tradingDay: (m, d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); if (w === 0 || w === 6) return false;
    if (m === "tw") return typeof TWHOL !== "undefined" && TWHOL.set && d.startsWith(TWHOL.year) ? !TWHOL.set.has(d) : null;
    return typeof usHolidayName === "function" ? !usHolidayName(d) : null; },
  todayOf: m => (m === "us" && typeof usIso === "function" ? usIso() : lgToday())
};
// 整理這次的狀態：每檔一筆紀錄，沒拿到的沿用上一次那筆（包括當初的取得時間）
function pfMeta(kind, cur, prevItems, syms) {
  if (typeof KLPfSrc === "undefined") return { items: prevItems || {}, meta: null };
  const M = KLPfSrc.mergeItems(prevItems, cur.items, syms);
  return { items: M.items, meta: KLPfSrc.summarize(kind, cur, M.items, syms, pfCal) };
}
// 這次拿到的價格表＋沿用上一次的（pfsrc.js 沒載入也照樣沿用，不讓畫面卡住）
const pfKeep = (prev, next, syms) => { if (typeof KLPfSrc !== "undefined") return KLPfSrc.keepLast(prev, next, syms).data; const out = next instanceof Map ? new Map(next) : { ...next }; for (const c of syms) { const v = prev instanceof Map ? prev.get(c) : prev?.[c]; if (v != null && (out instanceof Map ? !out.has(c) : out[c] == null)) out instanceof Map ? out.set(c, v) : (out[c] = v); } return out; };
function pfSrcLib() {
  if (typeof KLPfSrc !== "undefined") return Promise.resolve();
  return (W.lgSrcP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "pfsrc.js"; sc.onload = ok; sc.onerror = () => { W.lgSrcP = null; no(new Error("pfsrc.js 載入失敗")); }; document.body.appendChild(sc); }));
}
const pfSrcSafe = () => pfSrcLib().catch(() => null); // 標示模組載入失敗不能讓價格資料一起失效
// 一行資料狀態：label＝哪一種資料（報價／日 K）；計算時間另外寫，不和行情時間混在一起
function pfSrcHtml(meta, label, calc = true) {
  const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16), rl = ` <button type="button" class="linkbtn" data-lg="pfreload">重新載入</button>`;
  if (typeof KLPfSrc === "undefined") return `<p class="note pfsrc pfsrc-warn" role="status">⚠︎ ${esc(label)}：資料狀態標示沒有載入，無法確認資料來源與是不是最新${rl}</p>`;
  if (!meta) return "";
  const D = KLPfSrc.describe(meta, { name: c => nameOf(c) }), icon = { ok: "ⓘ", warn: "⚠︎", error: "✕" }[D.level];
  return `<p class="note pfsrc pfsrc-${D.level}" role="status">${icon} ${esc(label)}：${D.parts.map(esc).join("・")}${calc ? `。計算時間 ${now}` : ""}${D.level !== "ok" ? rl : ""}</p>`;
}
function lgPerfData(S, reconArg) {
  const recon = reconArg !== undefined ? reconArg : lgReconLoad();
  const bases = typeof KLRecon !== "undefined" ? [...KLRecon.activeBaselines(recon).values()] : [];
  const syms = [...new Set([...(S?.transactions || []).map(t => String(t.symbol || "").toUpperCase()), ...bases.map(b => b.symbol)].filter(Boolean))].sort();
  const curs = [...new Set([...(S?.transactions || []).map(t => t.currency), ...bases.map(b => b.currency)].filter(Boolean))];
  const key = syms.join(",") + "|" + curs.join(","), X = W.lgPx;
  if (X && X.key === key && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X))) return X;
  const { prev, tok, retry } = pfBegin("lgPx", key, syms.length);
  const kl = (c, q = "") => getJ(`/api/kline?code=${encodeURIComponent(c)}&months=24${q}`).catch(() => null);
  // 有美股時另外抓美元兌台幣（Yahoo TWD=X 日收盤，市場中間價），用來換成台幣合併
  Promise.all([Promise.all(syms.map(c => kl(c))), curs.includes("TWD") ? kl("加權") : null, curs.includes("USD") ? kl("SPY", "&adj=1") : null, curs.includes("USD") ? kl("TWD=X") : null, pfSrcSafe()]).then(([A, tw, us, fx]) => {
    if (W.lgPx?.tok !== tok) return;
    const fresh = {}; syms.forEach((c, i) => { if (A[i]?.data?.length) fresh[c] = A[i].data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })); });
    // 這次沒拿到的代號、基準、匯率沿用上一次的，不讓好資料被失敗蓋掉
    const now = new Date().toISOString(), cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.klineItems(Object.fromEntries(syms.map((c, i) => [c, A[i]])), now) : { ok: Object.keys(fresh).length > 0 || !syms.length, items: {} };
    const { items, meta } = pfMeta("kline", cur, prev?.items, syms);
    const bench = {}; if (tw?.data?.length) bench.TWD = tw.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })); else if (prev?.bench?.TWD) bench.TWD = prev.bench.TWD;
    if (us?.data?.length) bench.USD = us.data.map(x => ({ d: String(x.d).slice(0, 10), c: us.adj?.ok && x.ac > 0 ? x.ac : x.c })); else if (prev?.bench?.USD) bench.USD = prev.bench.USD;
    const fxs = fx?.data?.length ? fx.data.map(x => ({ d: String(x.d).slice(0, 10), c: x.c })) : prev?.fx || [];
    W.lgPx = { key, busy: false, at: Date.now(), tok, prices: pfKeep(prev?.prices, fresh, syms), bench, usAdj: us ? !!us?.adj?.ok : !!prev?.usAdj, fx: fxs, items, meta, failed: !cur.ok, retried: retry };
    pfRetryLater(W.lgPx); if (W.lt === "hold" && W.holdView === "tx" && ["perf", "home", undefined].includes(W.lg?.view)) renderList(); // 績效與總覽的走勢共用
  });
  return W.lgPx;
}
const pfPct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
function renderPerf(S) {
  const L = W.lg, head = lgViewSeg(), recon = lgReconLoad();
  const hasSnap = typeof KLRecon !== "undefined" && KLRecon.hasConfirmedSnapshots(recon);
  if (W.off) return ($("#lx").innerHTML = head + `<p class="note" style="padding:12px">需要部署到網站才有價格資料。</p>`);
  if (typeof KLPerf === "undefined" || typeof KLFx === "undefined") { $("#lx").innerHTML = head + skel("載入績效模組…"); lgPerfLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  if (!S.transactions.length && !hasSnap) return ($("#lx").innerHTML = head + lgReconAlertHtml(recon, null) + `<p class="note" style="padding:12px">還沒有交易或庫存快照，沒有績效可以算。</p>`);
  const X = lgPerfData(S, recon);
  if (X.busy) return ($("#lx").innerHTML = head + skel(`載入 ${X.n} 檔持股與比較基準的日 K…`));
  const master = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const R = KLPerf.buildPerf(S, { method: S.method, today: lgToday(), recon, prices: X.prices, bench: X.bench, benchName: { TWD: "加權指數（價格指數，不含股息）", USD: X.usAdj ? "S&P 500（SPY，含息還原）" : "S&P 500（SPY，不含息）" },
    classify: c => ({ assetType: /^00\d{2,4}[A-Z]?$/.test(c) || ["SPY", "QQQ", "VOO", "VTI", "SOXX", "TQQQ", "SOXL", "DIA", "IWM", "IVV", "VT", "SMH", "XLK", "SCHD", "VYM", "BND", "TLT", "GLD"].includes(c) ? "etf" : "stock", industry: master.get(c) || null }) });
  const RL = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: lgToday() });
  const reconBanner = lgReconAlertHtml(recon, RL);
  const range = L.pfRange || "all", rg = `<div class="seg pfrange" role="group" aria-label="日期範圍">${[["3m", "3 個月"], ["6m", "6 個月"], ["1y", "1 年"], ["all", "全期間"]].map(([k, t]) => `<button type="button" data-lg="range" data-v="${k}" aria-pressed="${range === k}">${t}</button>`).join("")}</div>`;
  // 台幣合併（含匯率拆解）只在「全部」顯示；台股／美股各看自己的幣別
  const cards = (R.byCurrency.USD && lgMktSel() === "all" ? pfFxCard(KLFx.combine(R, X.fx || [], { fxSource: "Yahoo Finance TWD=X 日收盤" })) : "") + Object.values(R.byCurrency).filter(C => lgCurOk(C.currency)).map(C => pfCard(C, range)).join("");
  $("#lx").innerHTML = head + `<div class="lgbar">${lgMktSeg()}${rg}<button type="button" class="btn sm" data-lg="pfreload">重新載入價格</button></div>` + pfSrcHtml(X.meta, "日 K")
    + reconBanner
    + (R.ledgerErrors ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">✕ 有 ${R.ledgerErrors} 筆交易有錯誤，沒有算進績效；請到「交易紀錄」修改。下面的數字不完整。</p>` : "")
    + (R.status === "needs_confirm" ? `<p class="note lgwarn pfstatus" style="margin:4px 12px">⚠︎ 待確認：有部位合股後的零股未結算或尚有待對帳差異，股數與成本是暫時的，下面的績效也是暫時的。請到「交易紀錄」處理。</p>` : "")
    + (cards || `<p class="note" style="padding:12px">${lgMktSel() === "all" ? "沒有可以計算的持股。" : `沒有${lgMktSel() === "us" ? "美股" : "台股"}的部位。`}</p>`)
    + `<details class="pfbasis"><summary>計算口徑</summary><ul>
      <li>範圍是證券部位（股票、ETF 的市值），不含現金。買進付出的錢算投入；賣出拿回的錢、領到的股息算拿回。</li>
      <li>價格用原始收盤價；股息已經當成現金流，不再用還原價重複計算。台幣、美元分開算，不相加。</li>
      <li>「÷ 累計投入」＝總損益 ÷ 所有買進、轉入的金額加總（不扣掉賣出、股息拿回的錢，也不管投入的時間點），只是損益的相對大小，不是投資報酬率。要看報酬率請看時間加權或資金加權報酬。</li>
      <li>時間加權報酬（TWR）：不受投入時點影響，用來和大盤比。資金加權報酬：考慮投入時點與金額；滿一年才年化，未滿一年只給整段期間的值。</li>
      <li>最大回撤：用 TWR 淨值算從前高跌了多少；恢復天數是谷底到第一次回到前高。</li>
      <li>價格最多抓 24 個月，更早的交易會標「估算」。過去績效不代表未來。</li></ul></details>`;
}
function pfCard(C, range) {
  const cur = C.currency, P = C.pnl, m = C.mwr, B = C.bench, D = C.maxDrawdown;
  const est = m.status === "estimated" ? `<span class="pfbadge">估算</span>` : m.status === "unavailable" ? `<span class="pfbadge">無法計算</span>` : "";
  const cst = C.status === "needs_confirm" ? `<span class="pfbadge">待確認</span>` : C.status === "estimated" ? `<span class="pfbadge">含估算</span>` : "";
  const tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [
    tile("總損益", lgSgn(P.total, cur), `÷ 累計投入 ${pfPct(P.totalPct)}（不扣賣出、不看時點）`, cls(P.total)),
    tile("時間加權報酬", pfPct(C.twr), C.twr == null ? "資料不足，無法計算" : C.annualizable ? `年化 ${pfPct(C.twrAnn)}` : "未滿一年，不年化", cls(C.twr)),
    tile("資金加權報酬" + est, m.status === "unavailable" ? "—" : m.annualized ? pfPct(m.value) : pfPct(m.period), m.status === "unavailable" ? (m.reasons?.includes("multiple_solutions") ? "無法確認是否為唯一解，不顯示" : "現金流算不出來") : m.annualized ? "年化（XIRR）" : "整段期間，未年化", cls(m.annualized ? m.value : m.period)),
    tile("最大回撤", D ? pfPct(D.dd) : "—", !D ? "資料不足，無法計算" : D.peak ? (D.recovered ? `${D.trough.slice(5)} 谷底，${D.recoveryDays} 天後回到前高` : `${D.peak.slice(5)} 前高，尚未回到`) : "期間內沒有回撤"),
    tile("相對比較基準", B ? pfPct(B.excess) : "—", B ? `${esc(B.name || "")} ${pfPct(B.ret)}` : "沒有比較基準資料", B ? cls(B.excess) : "")
  ].join("");
  const reasons = m.reasons?.length && m.status !== "ok" ? `<p class="note lgwarn pfreasons">⚠︎ ${m.status === "unavailable" ? "資金加權報酬無法計算" : "資金加權報酬是估算"}：${m.reasons.map(r => esc(KLPerf.REASON_LABEL[r] || r)).join("；")}。</p>` : "";
  const ISS = { pending: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 合股後的零股還沒結算`, snapshot_baseline: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 以庫存快照為基準起算，快照前歷史未計入報酬`, recon_pending: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 尚有待對帳項目（${(x.diffs || []).map(d => d.diffShares != null ? `差異 ${d.diffShares > 0 ? "+" : ""}${lgN(d.diffShares)} 股` : "同日順序未決").join("、")}），對帳完成前數字僅供參考`, transfer_out_prev_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出用 ${x.priceDate} 的收盤價`, transfer_out_user_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出使用手動填寫的價格`, transfer_out_no_price: x => `${esc(nameOf(x.code))} ${x.d} 轉出沒有市價，依成本估算或停止績效計算`, no_prices: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 拿不到價格`, history_truncated: x => `${x.codes.map(c => esc(nameOf(c))).join("、")} 的價格只抓得到最近 24 個月`, price_fallback: x => `${x.days} 天沒有收盤價，用交易價格代替`, stale_prices: x => `有價格停在 ${x.maxDays} 天前（可能停牌或資料缺漏）` };
  const iss = C.issues.length ? `<p class="note">資料提醒：${C.issues.map(x => (ISS[x.k] ? ISS[x.k](x) : esc(x.k))).join("；")}。</p>` : "";
  return `<section class="pfcard" data-nofold><h4>${cur === "USD" ? "美股（美元）" : "台股（台幣）"}${cst}<small class="note"> ${C.from ? `${C.from}～${C.to}・` : ""}資料到 ${esc(C.asOf || "")}</small></h4>
    <div class="pftiles">${tiles}</div>${reasons}${iss}
    ${pfCharts(C, range)}
    ${pfMonthly(C)}
    ${pfAttr(C)}
    <dl class="pfpnl"><dt>總投入</dt><dd>${lgMoney(P.invested, cur)}</dd><dt>拿回／轉出估值（賣出＋股息＋轉出）</dt><dd>${lgMoney(P.returned, cur)}</dd><dt>目前市值</dt><dd>${lgMoney(P.marketValue, cur)}</dd>
      <dt>已實現損益</dt><dd class="${cls(P.realized)}">${lgSgn(P.realized, cur)}</dd>${P.transferOutPnl ? `<dt>轉出損益（轉出市價 − 成本）</dt><dd class="${cls(P.transferOutPnl)}">${lgSgn(P.transferOutPnl, cur)}</dd>` : ""}<dt>未實現損益</dt><dd class="${cls(P.unrealized)}">${lgSgn(P.unrealized, cur)}</dd><dt>股息（稅後）</dt><dd>${lgMoney(P.dividends, cur)}</dd>
      <dt>手續費＋稅</dt><dd>${lgMoney(P.fees + P.taxes, cur)}</dd>${P.extraFees ? `<dt>其中另計費用</dt><dd>${lgMoney(P.extraFees, cur)}</dd>` : ""}${P.otherCash ? `<dt>其他公司行動現金</dt><dd>${lgSgn(P.otherCash, cur)}</dd>` : ""}</dl></section>`;
}
// 淨值走勢（組合 vs 比較基準，同一起點＝100）＋回撤；一張圖一個軸
function pfCharts(C, range) {
  if (!C.series.length) return `<p class="note" style="padding:8px 0">資料不足，無法計算走勢。</p>`;
  const all = C.series.filter(x => x.v > 0 || x.flow !== 0); if (all.length < 2) return `<p class="note" style="padding:8px 0">交易日太少，還畫不出走勢。</p>`;
  const end = all.at(-1).d, back = { "3m": 92, "6m": 183, "1y": 366 }[range], from = back ? new Date(Date.parse(end) - back * 864e5).toISOString().slice(0, 10) : all[0].d;
  // 起點：範圍前一天的收盤；「全部」或範圍從第一天開始時，用第一天開盤前（淨值 1、第一筆投入前），這樣圖上的報酬和上面的數字一致
  const k0 = all.findIndex(x => x.d >= from), base = k0 > 0 ? all[k0 - 1] : { d: all[0].d, index: 1, v: 0, start: true }, S = [base, ...all.slice(Math.max(0, k0))];
  if (S.length < 2) return `<p class="note">這段期間的資料太少。</p>`;
  const BB = W.lgPx?.bench?.[C.currency] ? KLPerf.priceBook(W.lgPx.bench[C.currency]) : null, bAt = d => BB?.at(d)?.c;
  const b0 = base.start ? (BB?.a.filter(x => x.d < base.d).at(-1)?.c ?? bAt(base.d)) : bAt(base.d);
  const pts = S.map(x => { const b = x.start ? b0 : bAt(x.d); return { d: x.d + (x.start ? "（起點）" : ""), p: 100 * x.index / base.index, b: b0 && b ? 100 * b / b0 : null, v: x.v }; });
  let pk = -Infinity; pts.forEach(x => { pk = Math.max(pk, x.p); x.dd = x.p / pk - 1; });
  const id = "pf" + C.currency; (W.lgPf ||= {})[id] = { pts, cur: C.currency };
  const W0 = 600, H1 = 180, H2 = 70, vals = pts.flatMap(x => [x.p, x.b].filter(v => v != null)), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 1;
  const X = i => (i / (pts.length - 1)) * W0, Y = v => H1 - ((v - lo + pad) / (hi - lo + 2 * pad)) * H1, ddLo = Math.min(-0.01, ...pts.map(x => x.dd)), YD = v => (v / ddLo) * H2;
  const line = k => pts.map((x, i) => (x[k] == null ? null : `${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`)).filter(Boolean).join(" ");
  const ddPath = `M0,0 ${pts.map((x, i) => `L${X(i).toFixed(1)},${YD(x.dd).toFixed(1)}`).join(" ")} L${W0},0 Z`, last = pts.at(-1), y100 = Y(100);
  const bn = C.bench?.name ? esc(C.bench.name) : "比較基準";
  return `<div class="pfchart" data-pf="${id}"><div class="pflegend"><span><i class="pfk"></i>我的組合 <b>${pfPct(last.p / 100 - 1)}</b></span>${last.b != null ? `<span><i class="pfk bm"></i>${bn} <b>${pfPct(last.b / 100 - 1)}</b></span>` : ""}<small class="note">起點＝100</small></div>
    <div class="pfplot" style="height:${H1}px"><svg viewBox="0 0 ${W0} ${H1}" preserveAspectRatio="none" aria-hidden="true">
      ${y100 > 0 && y100 < H1 ? `<line x1="0" x2="${W0}" y1="${y100}" y2="${y100}" class="pfbase"/>` : ""}
      ${last.b != null ? `<polyline points="${line("b")}" class="pfline bm"/>` : ""}<polyline points="${line("p")}" class="pfline"/></svg>
      <span class="pfax hi">${hi.toFixed(0)}</span><span class="pfax lo">${lo.toFixed(0)}</span><i class="pfx" hidden></i><div class="pftip" hidden></div></div>
    <div class="pfdates"><span>${pts[0].d.slice(0, 10)}</span><span>${last.d}</span></div>
    <div class="pfsub">回撤（從前高跌了多少）<small class="note">最深 ${pfPct(Math.min(...pts.map(x => x.dd)))}</small></div>
    <div class="pfplot dd" style="height:${H2}px"><svg viewBox="0 0 ${W0} ${H2}" preserveAspectRatio="none" aria-hidden="true"><path d="${ddPath}" class="pfdd"/></svg><i class="pfx" hidden></i><div class="pftip" hidden></div></div>
    <table class="pfsr"><caption>每日淨值（起點＝100）</caption><thead><tr><th>日期</th><th>我的組合</th><th>${bn}</th><th>回撤</th></tr></thead><tbody>${pts.filter((_, i) => i % Math.ceil(pts.length / 40) === 0 || i === pts.length - 1).map(x => `<tr><td>${x.d}</td><td>${x.p.toFixed(2)}</td><td>${x.b == null ? "—" : x.b.toFixed(2)}</td><td>${pfPct(x.dd)}</td></tr>`).join("")}</tbody></table></div>`;
}
function pfMonthly(C) {
  if (!C.monthly.length) return "";
  const Y = [...new Set(C.monthly.map(m => m.p.slice(0, 4)))], M = new Map(C.monthly.map(m => [m.p, m])), YR = new Map(C.yearly.map(y => [y.p, y]));
  const cell = m => { if (!m) return `<td></td>`; const a = Math.min(1, Math.abs(m.r) / 0.1), col = m.r >= 0 ? "--up" : "--down";
    return `<td style="background:color-mix(in srgb, var(${col}) ${Math.round(a * 45)}%, transparent)" title="${m.p}：${pfPct(m.r)}${m.bench != null ? `，比較基準 ${pfPct(m.bench)}` : ""}${m.days < 15 ? `（只有 ${m.days} 個交易日）` : ""}">${pfPct(m.r, 1)}</td>`; };
  return `<h5 class="pfh">月報酬<small class="note">（時間加權；滑鼠停在格子上看比較基準）</small></h5><div class="pfmon"><table><thead><tr><th>年</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}月</th>`).join("")}<th>全年</th></tr></thead><tbody>
    ${Y.map(y => `<tr><th>${y}</th>${Array.from({ length: 12 }, (_, i) => cell(M.get(`${y}-${String(i + 1).padStart(2, "0")}`))).join("")}${cell(YR.get(y))}</tr>`).join("")}</tbody></table></div>`;
}
function pfAttr(C) {
  const A = C.attribution, cur = C.currency, top = A.bySymbol.filter(x => Math.abs(x.pnl) > 0.004).slice(0, 12), mx = Math.max(1, ...top.map(x => Math.abs(x.pnl)));
  if (!top.length) return "";
  const TY = { stock: "個股", etf: "ETF", unknown: "未分類" };
  return `<h5 class="pfh">誰賺誰賠<small class="note">（已實現＋未實現＋股息＋另計費用／公司行動）</small></h5><ul class="pfattr">${top.map(x => `<li><span class="nm">${esc(nameOf(x.symbol))}<small class="note"> ${esc(x.symbol)}</small></span><span class="pfbar"><i class="${x.pnl >= 0 ? "up" : "dn"}" style="width:${(Math.abs(x.pnl) / mx * 50).toFixed(1)}%"></i></span><b class="${cls(x.pnl)}">${lgSgn(x.pnl, cur)}</b></li>`).join("")}</ul>
    ${A.unattributed ? `<p class="note">沒有對應到個股的費用或現金：${lgSgn(A.unattributed, cur)}（和上面各檔加總＝總損益）</p>` : ""}<p class="note">依類型：${A.byType.map(g => `${TY[g.group] || esc(g.group)} ${lgSgn(g.pnl, cur)}`).join("、")}${A.byIndustry.some(g => g.group !== "unknown") ? `；依產業：${A.byIndustry.slice(0, 5).map(g => `${g.group === "unknown" ? "未分類" : esc(g.group)} ${lgSgn(g.pnl, cur)}`).join("、")}` : ""}；股息 ${lgMoney(A.dividends, cur)}、手續費與稅 ${lgSgn(A.feesAndTaxes, cur)}；匯率影響：${esc(A.fxNote)}。</p>`;
}
// 圖上的十字線與提示：滑鼠移動、手指點一下或左右拖曳，顯示最近那一天的數值（圖設 touch-action: pan-y，上下滑仍然捲動頁面）
function pfTip(e) {
  const plot = e.target.closest?.(".pfplot"); if (!plot) return; const box = plot.closest(".pfchart"), D = W.lgPf?.[box?.dataset.pf]; if (!D) return;
  const r = plot.getBoundingClientRect(), i = Math.max(0, Math.min(D.pts.length - 1, Math.round((e.clientX - r.left) / r.width * (D.pts.length - 1)))), x = D.pts[i];
  box.querySelectorAll(".pfx").forEach(el => { el.hidden = false; el.style.left = (i / (D.pts.length - 1) * 100) + "%"; });
  box.querySelectorAll(".pftip").forEach(el => { el.hidden = true; });
  const tip = plot.querySelector(".pftip"); tip.hidden = false; tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 8)) + "px";
  tip.innerHTML = `<b>${esc(x.d)}</b><br>我的組合 ${x.p.toFixed(2)}（${pfPct(x.p / 100 - 1)}）${x.b != null ? `<br>比較基準 ${x.b.toFixed(2)}（${pfPct(x.b / 100 - 1)}）` : ""}<br>回撤 ${pfPct(x.dd)}<br>市值 ${lgMoney(x.v, D.cur)}`;
}
document.addEventListener("pointermove", pfTip); document.addEventListener("pointerdown", pfTip);
document.addEventListener("pointerleave", e => { const box = e.target.closest?.(".pfchart"); if (!box) return; box.querySelectorAll(".pfx,.pftip").forEach(el => { el.hidden = true; }); }, true);
// 績效頁的樣式（放在這裡，不用改 watch.html）；顏色用網站的變數，深色模式自動跟著變
(function () {
  if (document.getElementById("pfcss")) return; const st = document.createElement("style"); st.id = "pfcss";
  st.textContent = `:root[data-theme="light"] #lx :is(.lgwarn,.pfsrc-warn,.pfsrc-error,.pfbadge,.hm-high .linkbtn,.hm-warn .linkbtn){color:#8a5300;border-color:#8a5300}@media (pointer:coarse){.lgview button,.btn[data-lg],.seg button[data-lg]{min-height:44px}.pfsrc .linkbtn{min-height:44px}}.pfsrc{margin:4px 12px;font-size:12px;overflow-wrap:anywhere}#lx .pfsrc-warn,#lx .pfsrc-error{color:var(--s1,#d98a0b)}.hmcard .pfsrc{margin:6px 0 0}.lgview{margin:8px 12px 0}@media (max-width:520px){.seg.lgview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:visible}.seg.lgview button{padding:5px 4px;border-left:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.seg.lgview button:nth-child(4n){border-right:0}}.pfrange{flex-wrap:wrap}
.pfcard{margin:8px 12px 16px;padding:10px 12px;border-radius:6px;background:var(--surface-2)}.pfcard h4{margin:0 0 8px;font-size:14px}
.pftiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:8px}
.pftile{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:6px;background:var(--surface);min-width:0}.pftile span{font-size:12px;color:var(--muted)}
.pftile b{font-size:18px;font-variant-numeric:tabular-nums}.pftile small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.pfbadge{margin-left:4px;padding:0 4px;border-radius:3px;border:1px solid var(--s1,#d98a0b);color:var(--s1,#d98a0b);font-size:10px}
.pfchart{margin:8px 0}.pflegend{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:12px;margin-bottom:4px}
.pfk{display:inline-block;width:14px;height:2px;margin-right:4px;vertical-align:middle;background:var(--accent)}.pfk.bm{background:none;border-top:2px dashed var(--muted)}
.pfplot{position:relative;touch-action:pan-y}.pfplot svg{display:block;width:100%;height:100%;overflow:visible}
.pfline{fill:none;stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}.pfline.bm{stroke:var(--muted);stroke-dasharray:5 4}
.pfbase{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.pfdd{fill:color-mix(in srgb,var(--muted) 35%,transparent);stroke:var(--muted);stroke-width:1;vector-effect:non-scaling-stroke}
.pfax{position:absolute;right:2px;font-size:10px;color:var(--muted);background:color-mix(in srgb,var(--surface-2) 80%,transparent);padding:0 2px}.pfax.hi{top:0}.pfax.lo{bottom:0}
.pfx{position:absolute;top:0;bottom:0;width:1px;background:var(--muted);pointer-events:none}
.pftip{position:absolute;top:4px;z-index:2;width:142px;padding:6px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line);font-size:11px;line-height:1.5;pointer-events:none;font-variant-numeric:tabular-nums}
.pfdates{display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}.pfsub{margin-top:8px;font-size:12px}
.pfsr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pfh{margin:12px 0 4px;font-size:13px}.pfmon{overflow-x:auto}.pfmon table{border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums;min-width:560px;width:100%}
.pfmon th,.pfmon td{padding:3px 4px;text-align:right;border:1px solid var(--surface-2)}.pfmon thead th{color:var(--muted);font-weight:400}
.pfattr{list-style:none;margin:0;padding:0}.pfattr li{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 0;font-size:12px}
.pfattr .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pfbar{position:relative;height:8px;background:linear-gradient(var(--line),var(--line)) 50% 0/1px 100% no-repeat}
.pfbar i{position:absolute;top:0;height:100%}.pfbar i.up{left:50%;border-radius:0 3px 3px 0;background:var(--up)}.pfbar i.dn{right:50%;border-radius:3px 0 0 3px;background:var(--down)}
.pfattr b{font-variant-numeric:tabular-nums;text-align:right}
.pfpnl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:12px 0 0;font-size:13px}.pfpnl dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.pfbasis{margin:4px 12px 16px;font-size:12px}.pfbasis ul{padding-left:1.2em;margin:4px 0}
#impSheet .lgimp-form{margin:0}
#impSheet .lgimp-method{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;font-size:13px}
#impSheet .lgimp-method select{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;padding:6px 8px;min-height:36px;font:inherit;font-size:max(1rem,1em)}
#impSheet .lgimp-method select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#impSheet .lgimp-card:focus-visible,#impSheet .hg-wrap:focus-visible,#impSheet :is(button,input[type="checkbox"]):focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#impSheet .lgimp-sub:has(input:disabled){opacity:.45;cursor:not-allowed}
#impSheet .hgrid td small[data-lgimp-meta]{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
#impSheet .hgrid th .pfsr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);clip:rect(0 0 0 0);white-space:nowrap}
#impSheet progress{width:100%;height:8px;margin:6px 0;accent-color:var(--accent)}
@media (pointer:coarse){#impSheet .lgimp-method select{min-height:44px}#impSheet .lgimp-sub:not(#lgImpIncOpenWrap){min-height:36px}#impSheet #lgImpIncOpenWrap{min-height:44px;align-items:center}}`;
  document.head.appendChild(st);
})();

/* ================= 融資與擔保品（投資組合第 7 階段）：margin.js 算，這裡畫 =================
   存檔：kline:pf:margin:v1 → { v: 1, accounts: [...] }（和交易紀錄分開；寫入前跑 KLMargin.validateStore，不通過不寫）。
   結果一律是「試算」：每個帳戶標資料來源（券商資料／自己填的／系統估算），門檻寫出來源與日期，畫面寫明不是券商正式追繳通知或可借額度。 */
const MG_KEY = "pf:margin:v1", mgLoad = () => { const s = store.get(MG_KEY, null); return s && s.v === 1 && Array.isArray(s.accounts) ? s : { v: 1, accounts: [] }; };
function mgSave(s) { const v = KLMargin.validateStore(s); if (v.ok) store.set(MG_KEY, s); return v; }
function mgLib() {
  if (typeof KLMargin !== "undefined") return Promise.resolve();
  return (W.lgMgP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "margin.js"; sc.onload = ok; sc.onerror = () => { W.lgMgP = null; no(new Error("margin.js 載入失敗")); }; document.body.appendChild(sc); }));
}
function mgPrices(syms) {
  const key = syms.slice().sort().join(","), X = W.lgMg; if (!syms.length) return { busy: false, px: {} };
  if (X && X.key === key && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X, 300000))) return X;
  const { prev, tok, retry } = pfBegin("lgMg", key, syms.length);
  Promise.all([getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null), pfSrcSafe()]).then(([q]) => {
    if (W.lgMg?.tok !== tok) return;
    const px = {}; for (const x of q?.quotes || []) if (x && x.price > 0) px[String(x.code).toUpperCase()] = { price: x.price, date: x.dataDate || x.date || null, name: x.name || null };
    const cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.quoteItems(q, new Date().toISOString()) : { ok: !!q?.ok && (q.quotes || []).some(x => x && x.price > 0), items: {} }, { items, meta } = pfMeta("quote", cur, prev?.items, syms);
    W.lgMg = { key, busy: false, at: Date.now(), tok, px: pfKeep(prev?.px, px, syms), items, meta, failed: !cur.ok, retried: retry };
    pfRetryLater(W.lgMg); if (W.lt === "hold" && W.holdView === "tx" && ["margin", "home", undefined].includes(W.lg?.view)) renderList();
  });
  return W.lgMg;
}
const MG_TYPE = { margin: "融資（證券金融）", pledge: "不限用途借貸（股票質押）", other: "其他借款" }, MG_STATE = { ok: "正常", near: "接近追繳線", call: "低於追繳線", liquidate: "低於處分線" };
function renderMargin() {
  const head = lgViewSeg(), L = W.lg;
  if (typeof KLMargin === "undefined") { $("#lx").innerHTML = head + skel("載入融資模組…"); mgLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  const S = mgLoad(), syms = [...new Set(S.accounts.flatMap(a => (a.collateral || []).map(c => String(c.symbol).toUpperCase())))], X = W.off ? { busy: false, px: {} } : mgPrices(syms);
  const warn = `<p class="note lgwarn mgnote">⚠︎ 這裡都是<b>試算</b>：用你填的借款、門檻與目前報價計算，不是券商的正式追繳通知或可借額度；實際以券商通知與合約為準。</p>`;
  const form = L.mgForm ? mgFormHtml(L.mgForm) : "";
  if (X.busy) return ($("#lx").innerHTML = head + skel("載入擔保品報價…"));
  const cards = S.accounts.map(a => mgCard(KLMargin.analyze(a, X.px, lgToday()), a)).join("");
  $("#lx").innerHTML = head + `<div class="lgbar"><button type="button" class="btn sm primary" data-lg="mgadd">＋ 新增融資／借款帳戶</button><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button></div>` + (syms.length ? pfSrcHtml(X.meta, "擔保品報價") : "")
    + (L.msg ? `<p class="note lgmsg" role="status">${esc(L.msg)}</p>` : "") + warn + form
    + (cards || `<p class="note" style="padding:12px">還沒有融資或借款資料。按「新增」填入借款金額、擔保品與券商的門檻，就能看維持率與下跌時的風險。</p>`);
}
function mgCard(R, a) {
  const pc = v => (v == null ? "—" : (v * 100).toFixed(1) + "%"), money = v => lgMoney(v, R.currency), tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const st = R.state ? `<span class="pfbadge mg-${R.state}">${MG_STATE[R.state]}</span>` : "", src = `<span class="pfbadge">${KLMargin.SOURCE_LABEL[R.source]}</span>`;
  const done = R.status === "estimated" ? `<span class="pfbadge">含估算</span>` : R.status === "incomplete" ? `<span class="pfbadge mg-call">資料不完整</span>` : "";
  const PS = { quote: "報價", user: "你填的價格" };
  const colTable = R.collateral.length ? `<h5 class="pfh">擔保品<small class="note">（價格、日期、來源）</small></h5><div class="mgscroll"><table class="altable mgtable mgwrapped mgcol"><thead><tr><th>代號</th><th>股數</th><th>價格</th><th>價格日期</th><th>來源</th><th>市值</th><th>占比</th></tr></thead><tbody>
    ${R.collateral.map(c => `<tr><td>${esc(nameOf(c.symbol))}<small class="note"> ${esc(c.symbol)}</small></td><td>${lgN(c.shares)}</td><td>${c.price == null ? "—" : lgN(c.price)}</td><td>${esc(c.priceDate || "—")}</td><td>${c.priceSource ? PS[c.priceSource] : "沒有價格，沒算進市值"}</td><td>${c.value == null ? "—" : money(c.value)}</td><td>${pc(c.weight)}</td></tr>`).join("")}
    ${R.cashCollateral ? `<tr><td>現金擔保</td><td></td><td></td><td></td><td>你填的</td><td>${money(R.cashCollateral)}</td><td>${pc(R.collateralValue ? R.cashCollateral / R.collateralValue : null)}</td></tr>` : ""}</tbody></table></div>` : "";
  const iss = R.issues.map(x => esc(KLMargin.ISSUE_LABEL[x.k] || x.k) + (x.codes ? `：${x.codes.map(esc).join("、")}` : "")).join("；");
  const needTxt = n => (n ? `補現金 ${money(n.cash)} 或還款 ${money(n.repay)}` : "—");
  return `<section class="pfcard mgcard" data-nofold><h4>${esc(R.name || "借款帳戶")}<small class="note"> ${MG_TYPE[R.type]}</small>${src}${st}${done}</h4>
    <div class="pftiles">${[tile("維持率", pc(R.ratio), R.rules.call ? `追繳線 ${pc(R.rules.call)}${R.rules.liquidate ? `・處分線 ${pc(R.rules.liquidate)}` : ""}` : "沒有設定追繳線"),
      tile("借款", money(R.loan), R.interest != null ? `已計利息約 ${money(R.interest)}（${R.days} 天）` : ""), tile("擔保品市值", money(R.collateralValue), R.cashCollateral ? `含現金 ${money(R.cashCollateral)}` : ""),
      tile("再跌多少會追繳", R.dropToCall == null ? "—" : R.dropToCall <= 0 ? "已低於追繳線" : pc(R.dropToCall), R.dropToLiquidate != null ? `跌 ${pc(R.dropToLiquidate)} 會被處分` : ""),
      tile("可用額度（試算）", R.available == null ? "—" : money(R.available), R.rules.maxLtv ? `成數 ${pc(R.rules.maxLtv)}` : "沒有設定成數")].join("")}</div>
    ${R.need ? `<p class="note lgwarn">⚠︎ 目前低於追繳線：試算要${needTxt(R.need)}才回到 ${pc(R.rules.topUpTo || R.rules.call)}。</p>` : ""}${iss ? `<p class="note lgwarn">⚠︎ ${iss}。</p>` : ""}
    ${colTable}
    <h5 class="pfh">壓力測試<small class="note">（股票擔保品同時下跌，現金不跌）</small></h5>
    <div class="mgscroll"><table class="altable mgtable mgwrapped"><thead><tr><th>情境</th><th>擔保品市值</th><th>維持率</th><th>狀態</th><th>要補</th></tr></thead><tbody>
      ${R.stress.map(x => `<tr><td>全部跌 ${(-x.shock * 100).toFixed(0)}%</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}
      ${R.singleLimitDown.slice(0, 3).map(x => `<tr><td>${esc(nameOf(x.symbol))} 連三根跌停（約 −27%）</td><td>${money(x.value)}</td><td>${pc(x.ratio)}</td><td>${x.state ? MG_STATE[x.state] : "—"}</td><td>${needTxt(x.need)}</td></tr>`).join("")}</tbody></table></div>
    ${R.riskiest ? `<p class="note">風險最大的擔保品：${esc(nameOf(R.riskiest.symbol))}（占擔保品 ${pc(R.riskiest.weight)}）。</p>` : ""}
    <p class="note">門檻來源：${esc(R.rules.source || "未填")}${R.rules.asOf ? `（${esc(R.rules.asOf)}）` : ""}${R.rules.isDefault ? "；<b>目前是預設值，請改成你的券商條件</b>" : ""}。資料更新：${esc(a.updatedAt || "—")}。</p>
    <div class="lgbar"><button type="button" class="btn sm" data-lg="mgedit" data-id="${esc(a.id)}">修改</button><button type="button" class="btn sm" data-lg="mgdel" data-id="${esc(a.id)}">刪除</button></div></section>`;
}
function mgFormHtml(F) {
  const v = F.v || {}, r = v.rules || {}, pc = x => (x == null ? "" : +(x * 100).toFixed(2));
  const col = (v.collateral || []).map(c => `${c.symbol} ${c.shares}${c.price ? " " + c.price : ""}`).join("\n");
  const inp = (n, l, val, extra = "") => `<label>${l}<input name="${n}" value="${esc(val ?? "")}" ${extra}></label>`;
  return `<form class="lgform" id="mgForm"><h4>${F.id ? "修改借款帳戶" : "新增借款帳戶"}</h4>
    ${inp("name", "名稱", v.name || "", 'maxlength="30"')}
    <label>類型<select name="type">${Object.entries(MG_TYPE).map(([k, t]) => `<option value="${k}" ${v.type === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>資料來源<select name="source">${Object.entries({ broker: "券商資料（對帳單、App）", user: "自己估的", estimate: "系統估算" }).map(([k, t]) => `<option value="${k}" ${(v.source || "user") === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    ${inp("loan", "借款（融資）金額", v.loan, 'inputmode="decimal"')}${inp("rate", "年利率 %", pc(v.rate), 'inputmode="decimal"')}${inp("startDate", "開始日", v.startDate || "", 'type="date"')}${inp("termDays", "期限（天，可空白）", v.termDays, 'inputmode="numeric"')}
    ${inp("call", "追繳線 %（空白＝預設）", pc(r.call), 'inputmode="decimal"')}${inp("topUpTo", "補足到 %", pc(r.topUpTo), 'inputmode="decimal"')}${inp("liquidate", "處分線 %（可空白）", pc(r.liquidate), 'inputmode="decimal"')}${inp("maxLtv", "最高成數 %（可空白）", pc(r.maxLtv), 'inputmode="decimal"')}
    ${inp("ruleSource", "門檻來源（例如券商名稱、合約）", r.source || "", 'maxlength="60"')}${inp("cashCollateral", "現金擔保（可空白）", v.cashCollateral, 'inputmode="decimal"')}
    <label class="wide">擔保品（一行一檔：代號 股數 [價格]；沒有報價時才用你填的價格）<textarea name="collateral" rows="4">${esc(col)}</textarea></label>
    ${F.err ? `<ul class="lgiss">${F.err.map(e => `<li class="lgwarn">✕ ${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="lgbar"><button type="submit" class="btn primary">${F.id ? "儲存修改" : "加入"}</button><button type="button" class="btn" data-lg="mgclose">取消</button></div></form>`;
}
const MG_ERR = { no_collateral: "至少要有一檔股票擔保品或現金擔保", invalid_loan: "借款金額要大於 0", invalid_rate: "年利率要在 0～100% 之間", topup_below_call: "「補足到」不能低於追繳線", invalid_collateral: "擔保品格式：代號 股數 [價格]，股數要大於 0", duplicate_or_missing_id: "帳戶編號重複" };
function mgSubmit(e) {
  e.preventDefault(); const L = W.lg, F = L.mgForm, fd = new FormData(e.target), n = k => { const t = String(fd.get(k) ?? "").trim().replace(/,/g, ""); return t === "" ? null : Number(t); }, pct = k => (n(k) == null ? null : n(k) / 100);
  const lines = String(fd.get("collateral") || "").split(/\n/).map(l => l.trim()).filter(Boolean);
  const collateral = lines.map(l => { const [c, sh, px] = l.split(/[\s,，]+/); return { symbol: String(c || "").toUpperCase(), shares: Number(sh), ...(px ? { price: Number(px) } : {}) }; });
  const rules = { call: pct("call"), topUpTo: pct("topUpTo"), liquidate: pct("liquidate"), maxLtv: pct("maxLtv"), source: String(fd.get("ruleSource") || "").trim() || null, asOf: lgToday() };
  for (const k of ["call", "topUpTo", "liquidate", "maxLtv"]) if (rules[k] == null) delete rules[k];
  const acct = { id: F.id || (crypto.randomUUID ? crypto.randomUUID() : "mg-" + Date.now()), name: String(fd.get("name") || "").trim() || "借款帳戶", type: fd.get("type"), source: fd.get("source"), currency: "TWD",
    loan: n("loan"), rate: pct("rate"), startDate: fd.get("startDate") || null, termDays: n("termDays"), cashCollateral: n("cashCollateral"), rules: Object.keys(rules).some(k => !["source", "asOf"].includes(k)) || rules.source ? rules : undefined, collateral, updatedAt: lgToday() };
  const S = mgLoad(), next = { ...S, accounts: F.id ? S.accounts.map(x => (x.id === F.id ? acct : x)) : [...S.accounts, acct] }, v = mgSave(next);
  if (!v.ok) { L.mgForm = { ...F, v: acct, err: [...new Set(v.errors.map(x => MG_ERR[x.code] || x.code))] }; return renderList(); }
  L.mgForm = null; L.msg = F.id ? "已儲存。" : "已加入。"; pfExpire(["lgMg"]); renderList();
}
(function () {
  if (document.getElementById("mgcss")) return; const st = document.createElement("style"); st.id = "mgcss";
  st.textContent = `.mgnote{margin:4px 12px}.mgtable td:first-child{text-align:left}.mgtable{min-width:520px}.mgtable th,.mgtable td{white-space:nowrap}.mgscroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}/* 手機上表格比畫面寬：只有表格自己左右滑，不撐開整頁 */.pfbadge.mg-call,.pfbadge.mg-liquidate{background:color-mix(in srgb,var(--s1,#d98a0b) 20%,transparent)}
.altable{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.altable th,.altable td{padding:3px 4px;text-align:right;border-bottom:1px solid var(--line)}.altable th:first-child{text-align:left}
#mgForm textarea{width:100%;min-width:0;font:inherit}`;
  document.head.appendChild(st);
})();
/* ================= 配置（投資組合第 6 階段）：alloc.js 算，這裡畫 =================
   持股：交易紀錄裡還持有的部位；市值用 /api/quote 現價，沒有現價用成本（標估算）；美元用 TWD=X 最新收盤換成台幣；有記入出金時現金也算進總資產。
   ETF 穿透：每一檔 ETF 用 /api/etf 的全部持股與產業分布（各自有資料日期）。產業：股票清單（上市櫃產業別）；美股沒有產業資料就是「未分類」。 */
function lgAllocLib() {
  if (typeof KLAlloc !== "undefined") return Promise.resolve();
  return (W.lgAllocP ||= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "alloc.js"; sc.onload = ok; sc.onerror = () => { W.lgAllocP = null; no(new Error("alloc.js 載入失敗")); }; document.body.appendChild(sc); }));
}
const LG_US_ETF = new Set(["SPY", "QQQ", "VOO", "VTI", "SOXX", "TQQQ", "SOXL", "DIA", "IWM", "IVV", "VT", "SMH", "XLK", "SCHD", "VYM", "VEA", "VWO", "BND", "TLT", "IEF", "GLD", "ARKK"]);
const lgIsEtf = c => /^00\d{2,4}[A-Z]?$/.test(c) || LG_US_ETF.has(c);
const lgAssetType = (c, m = "tw") => { const s = String(c || "").trim().toUpperCase(); return m === "tw" && /^00\d{2,4}B$/.test(s) ? "bond_etf" : lgIsEtf(s) ? "etf" : "stock"; };
function lgLegacyOpen() {
  const raw = W.holdLg ? (W.holdOwn || {}) : (W.hold || W.holdOwn || {});
  if (typeof KLPortfolio === "undefined") return { open: [], skipped: [], demoCount: 0 };
  const R = KLPortfolio.normalizeHoldings(raw, { master: W.stocks, names: W.names }), open = [], skipped = [];
  let demoCount = 0;
  for (const it of R.items) {
    if (it.status === "invalid") { skipped.push({ symbol: it.symbol, msg: it.issues?.[0]?.message || "資料格式不對" }); continue; }
    if (!it.market || !it.currency) { skipped.push({ symbol: it.symbol, msg: "看不出市場，無法換算" }); continue; }
    if (it.isDemo) { demoCount++; continue; }
    if (it.assetType === "future") { skipped.push({ symbol: it.symbol, msg: "期貨不納入配置與再平衡" }); continue; }
    open.push({ symbol: it.symbol, name: it.name, market: it.market, currency: it.currency, shares: it.shares, costBasis: it.costBasis, assetType: lgAssetType(it.symbol, it.market), industry: it.industry });
  }
  return { open, skipped, demoCount };
}
function lgAllocData(P, opts = {}) {
  const syms = P.map(p => p.symbol).sort(), etfs = syms.filter(lgIsEtf), key = syms.join(","), needFx = P.some(p => p.currency === "USD") || !!opts?.needFx, X = W.lgAl;
  if (X && X.key === key && (!needFx || X.hadFxReq) && (X.busy || X.refreshing || Date.now() - X.at < pfTtl(X))) return X;
  const { prev, tok, retry } = pfBegin("lgAl", key, syms.length); // 上一次的資料：代號組合變了也沿用相同代號的報價
  if (!W.stocks && typeof loadStocks === "function") loadStocks().catch(() => {});
  Promise.all([syms.length ? getJ(`/api/quote?codes=${syms.map(encodeURIComponent).join(",")}`).catch(() => null) : null,
    needFx ? getJ(`/api/kline?code=${encodeURIComponent("TWD=X")}&months=1`).catch(() => null) : null,
    Promise.all(etfs.map(c => getJ(`/api/etf?code=${encodeURIComponent(c)}`).catch(() => null))), pfSrcSafe()]).then(([q, fx, E]) => {
    if (W.lgAl?.tok !== tok) return;
    const fresh = new Map((q?.quotes || []).filter(x => x && x.price > 0).map(x => [String(x.code).toUpperCase(), x])), last = fx?.data?.length ? fx.data[fx.data.length - 1] : null;
    const cur = typeof KLPfSrc !== "undefined" ? KLPfSrc.quoteItems(q, new Date().toISOString()) : { ok: !!q?.ok && (q.quotes || []).some(x => x && x.price > 0), items: {} }, { items, meta } = pfMeta("quote", cur, prev?.items, syms);
    const etf = {}; etfs.forEach((c, i) => { const j = E[i]; if (j?.hold?.rows?.length) etf[c] = { date: j.hold.date || null, rows: j.hold.rows.map(r => ({ code: r.code || null, name: r.name || null, pct: r.pct })), ind: j.ind?.rows?.length ? { date: j.ind.date || null, rows: j.ind.rows } : null }; else if (prev?.etf?.[c]) etf[c] = prev.etf[c]; });
    // 匯率：這次沒拿到就沿用上一次的並標示
    const fxv = last ? { rate: last.c, date: String(last.d).slice(0, 10) } : prev?.fx ? { ...prev.fx, kept: true } : null;
    W.lgAl = { key, hadFxReq: needFx, busy: false, at: Date.now(), tok, px: pfKeep(prev?.px, fresh, syms), fx: fxv, etf, items, meta, failed: syms.length ? !cur.ok : false, retried: retry };
    pfRetryLater(W.lgAl); if (W.lt === "hold" && W.holdView === "tx" && ["alloc", "home", "thesis", "report", undefined].includes(W.lg?.view)) renderList(); // 配置、總覽、論點（停損停利）、報告共用
  });
  return W.lgAl;
}
function rbLib() {
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgRbP ||= (typeof KLRebal !== "undefined" ? Promise.resolve() : one("rebal.js")).then(() => one("pf-rebal.js")).then(() => { if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "alloc") renderList(); }).catch(e => { W.lgRbP = null; }));
}
function stLib() {
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  return (W.lgStP ||= (typeof KLStress !== "undefined" ? Promise.resolve() : one("stress.js")).then(() => one("pf-stress.js")).then(() => { if (W.lt === "hold" && W.holdView === "tx" && W.lg?.view === "alloc") renderList(); }).catch(e => { W.lgStP = null; }));
}
function renderAlloc(S) {
  const recon = lgReconLoad();
  const L = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: lgToday() }), open = L.positions.filter(p => p.open);
  const meta = { legacy: false, recon, hasSnapshot: !!L.reconcile?.hasSnapshot, openConflicts: L.reconcile?.openConflicts || [], pendingSymbols: L.reconcile?.pendingSymbols || [], unresolvedSameDayCount: L.reconcile?.unresolvedSameDayCount || 0 };
  if (!open.length) return ($("#lx").innerHTML = lgViewSeg() + lgReconAlertHtml(recon, L) + `<p class="note" style="padding:12px">目前沒有持股，沒有配置可以看。</p>`);
  return renderAllocBody(open, L.cash, meta);
}
function renderAllocLegacy(leg, hasTx) {
  return renderAllocBody(leg.open, {}, { legacy: true, hasTx, skipped: leg.skipped, demoCount: leg.demoCount });
}
function renderAllocBody(open, cashB, meta = {}) {
  const head = lgViewSeg();
  const banner = meta.legacy ? `<div class="lgbar" style="padding-bottom:0"><span class="note lgwarn">目前看的是<b>舊庫存</b>（${meta.hasTx ? "這次切換檢視" : "沒有交易紀錄"}，<b>現金未知，未納入計算</b>；配置基準僅含納入持股）。</span><button type="button" class="btn sm" data-lg="view" data-v="tx">到交易紀錄建立完整帳本</button>${meta.hasTx ? `<button type="button" class="btn sm" data-lg="hsrcLedger">改回交易紀錄</button>` : ""}</div>`
    : (lgReconAlertHtml(meta.recon, { reconcile: meta }) + (meta.hasSnapshot || meta.openConflicts?.length ? `<p class="note lgrecon-snap-note" style="margin:4px 12px">ⓘ 用已確認快照的股數試算${meta.openConflicts?.length ? "（未結案差異不自動套用，請到交易紀錄釐清）" : ""}。</p>` : ""));
  const extraIssues = [
    ...(meta.demoCount > 0 ? [`<li>已略過 ${meta.demoCount} 筆範例持股（不是真實部位）；如不需要請到「持股 → 編輯庫存」移除。</li>`] : []),
    ...(meta.skipped?.length ? [`<li>略過 ${meta.skipped.length} 筆無法算入的舊庫存：${meta.skipped.map(x => `${esc(nameOf(x.symbol) || x.symbol)} ${esc(x.symbol)}（${esc(x.msg)}）`).join("、")}。</li>`] : [])
  ];
  if (!open.length) return ($("#lx").innerHTML = head + banner + (extraIssues.length ? `<ul class="note lgwarn alissues">${extraIssues.join("")}</ul><p class="note" style="padding:12px">目前沒有可納入計算的持股。</p>` : `<p class="note" style="padding:12px">目前沒有持股，沒有配置可以看。</p>`));
  if (W.off) return ($("#lx").innerHTML = head + banner + `<p class="note" style="padding:12px">需要部署到網站才有價格資料。</p>`);
  if (typeof KLAlloc === "undefined") { $("#lx").innerHTML = head + skel("載入配置模組…"); lgAllocLib().then(() => renderList(), e => { $("#lx").innerHTML = head + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; }); return; }
  const X = lgAllocData(open, { needFx: !!(cashB?.USD?.tracked && cashB.USD.balance) });
  if (X.busy) return ($("#lx").innerHTML = head + banner + skel(`載入 ${X.n} 檔的報價${open.some(p => lgIsEtf(p.symbol)) ? "與 ETF 成分股" : ""}…`));
  const ind = new Map((Array.isArray(W.stocks) ? W.stocks : []).map(r => [String(r[0]).toUpperCase(), r[3] || null]));
  const pos = open.map(p => { const q = X.px.get(p.symbol); return { symbol: p.symbol, name: q?.name || p.name || nameOf(p.symbol), market: p.market, currency: p.currency, value: q ? p.shares * q.price : p.costBasis, valueEstimated: !q, assetType: lgIsEtf(p.symbol) ? "etf" : "stock", industry: p.industry || ind.get(p.symbol) || null }; });
  const cash = {}, hasCash = Object.values(cashB || {}).some(v => v.tracked); for (const [c, v] of Object.entries(cashB || {})) if (v.tracked && v.balance > 0) cash[c] = v.balance;
  const R = KLAlloc.build(pos, { fx: X.fx, cash, etf: X.etf, asOf: lgToday(), names: Object.fromEntries(pos.map(p => [p.symbol, p.name])) });
  const issues = extraIssues.concat((R.issues || []).map(x => `<li>${esc(KLAlloc.ISSUE_LABEL[x.k] || x.k)}${x.codes ? `：${x.codes.map(c => (nameOf(c) && nameOf(c) !== c ? `${esc(nameOf(c))} ${esc(c)}` : esc(c))).join("、")}` : x.list ? `：${x.list.map(l => `${esc(l.etf)}${l.date ? " " + l.date : ""}${l.covered != null ? ` 揭露 ${l.covered}%` : ""}`).join("、")}` : x.dates ? `：${x.dates.map(d => `${esc(d.etf)} ${d.date || "—"}`).join("、")}` : ""}</li>`)).join("");
  const body = R.status === "no_fx" ? Object.values(R.byCurrency).map(C => alSection(C, `${C.base === "USD" ? "美股（美元）" : "台股（台幣）"}`, meta)).join("") : alSection(R, meta.legacy ? "全部納入持股（台幣計價・現金未知）" : "全部資產（台幣計價）", meta);
  $("#lx").innerHTML = head + banner + `<div class="lgbar"><button type="button" class="btn sm" data-lg="pfreload">重新載入報價</button>${R.fx ? `<small class="note">美元兌台幣 ${R.fx.rate.toFixed(3)}（${esc(R.fx.date || "")}，Yahoo TWD=X 收盤${X.fx?.kept ? "，這次沒拿到，沿用上一次的" : ""}）</small>` : ""}</div>` + pfSrcHtml(X.meta, "報價")
    + (issues ? `<ul class="note lgwarn alissues">${issues}</ul>` : "") + body
    + (typeof rbSectionHtml === "function" && typeof KLRebal !== "undefined" ? rbSectionHtml(open, X, cashB, meta) : (rbLib(), `<p class="note" style="padding:0 12px">載入再平衡試算…</p>`)) // 目標配置與再平衡（rebal.js＋pf-rebal.js，用到時才載入）
    + (typeof stSectionHtml === "function" && typeof KLStress !== "undefined" ? stSectionHtml(open, X, cashB, meta) : (stLib(), `<p class="note" style="padding:0 12px">載入壓力情境…</p>`)) // 壓力情境（stress.js＋pf-stress.js，用到時才載入）
    + `<details class="pfbasis"><summary>計算口徑</summary><ul><li>權重＝市值 ÷ ${hasCash ? "總資產" : "納入持股合計"}（台幣計價；美元用最新匯率換算）。${hasCash ? "有記入金、出金時，現金也算進總資產。" : "目前沒有現金紀錄，現金未知、未納入計算。"}</li>
      <li>沒有現價的持股用成本估算市值，並標示。美股沒有產業資料，歸「未分類」。</li>
      <li>ETF 穿透：ETF 權重 × 成分股占比＝透過 ETF 持有的曝險；只揭露部分成分股時，剩下的歸「其他（未揭露）」。各 ETF 的成分股日期可能不同，會分開列出。</li>
      <li>重疊度：兩檔 ETF 共同成分股的占比取小的加總。有效檔數＝1 ÷ 權重平方和（不含現金）。市值規模、投資策略的分類還沒有資料。</li>
      <li>費用估算口徑：再平衡試算與交易紀錄新增／截圖匯入（未填手續費時）均套用持股頁「手續費折扣」（<code>watch:hdisc</code>）與債券 ETF 免稅；新交易估算值會在存檔時快照，後續調整折扣不會回溯改寫已保存的歷史交易。</li></ul></details>`;
}
const AL_MKT = { tw: "台股", us: "美股", cash: "現金" }, AL_TYPE = { stock: "個股", etf: "ETF", cash: "現金" };
const alPct = w => (w == null ? "—" : (w * 100).toFixed(1) + "%");
const alBars = (rows, label = g => esc(g)) => `<ul class="albars">${rows.map(r => `<li><span class="nm">${label(r.group)}</span><span class="albar"><i style="width:${Math.max(0.5, r.w * 100).toFixed(1)}%"></i></span><b>${alPct(r.w)}</b></li>`).join("")}</ul>`;
function alSection(R, title, meta = {}) {
  const C = R.concentration, LT = R.lookThrough, cur = R.base;
  const tile = (k, v, sub = "") => `<div class="pftile"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [tile(meta.legacy ? "納入持股市值" : "總資產", lgMoney(R.total, cur), R.cash ? `含現金 ${lgMoney(R.cash, cur)}` : meta.legacy ? "現金未知（未納入）" : "不含現金（沒有記入出金）"),
    tile("最大單一持股", C.top ? alPct(C.top.w) : "—", C.top ? esc(nameOf(C.top.symbol)) : ""), tile("前五大合計", alPct(C.top5)),
    tile("有效檔數", C.effN ? C.effN.toFixed(1) : "—", "權重越集中，數字越小"), tile("現金比重", meta.legacy ? "未知（未納入）" : alPct(R.cashShare))].join("");
  const top = R.top10.map(h => ({ group: h.symbol, w: h.w, h }));
  const lt = LT && LT.top.length && LT.exposure.some(e => e.viaEtf > 0 || e.notLookedThrough) ? `<h5 class="pfh">ETF 穿透後的實際持股<small class="note">（直接持有＋透過 ETF）</small></h5>
    <table class="altable"><thead><tr><th>股票</th><th>合計</th><th>直接</th><th>透過 ETF</th></tr></thead><tbody>${LT.top.map(e => `<tr><td>${esc(e.name || nameOf(e.code))}<small class="note"> ${esc(e.code)}${e.notLookedThrough ? "（ETF，沒有成分股資料，未穿透）" : ""}</small></td><td><b>${alPct(e.w)}</b></td><td>${e.direct ? alPct(e.direct) : "—"}</td><td>${e.viaEtf ? alPct(e.viaEtf) : "—"}</td></tr>`).join("")}</tbody></table>
    ${LT.dupDirect.length ? `<p class="note">重複持有（直接買了，ETF 裡也有）：${LT.dupDirect.slice(0, 6).map(d => `${esc(d.name || d.code)}（直接 ${alPct(d.direct)}＋ETF ${alPct(d.viaEtf)}）`).join("、")}</p>` : ""}
    ${LT.pairs.length ? `<p class="note">ETF 重疊度：${LT.pairs.slice(0, 5).map(p => `${esc(p.a)} × ${esc(p.b)} ${p.overlap.toFixed(1)}%${p.sameDate ? "" : "（資料日期不同）"}`).join("、")}</p>` : ""}
    <p class="note">成分股資料日期：${LT.dates.map(d => `${esc(d.etf)} ${d.date || "—"}（揭露 ${d.covered}%）`).join("、")}</p>` : "";
  return `<section class="pfcard alcard" data-nofold><h4>${title}${R.estimated ? `<span class="pfbadge">含估算</span>` : ""}</h4><div class="pftiles">${tiles}</div>
    <h5 class="pfh">前十大持股</h5>${alBars(top, g => `${esc(nameOf(g))}<small class="note"> ${esc(g)}</small>`)}
    <div class="algrid"><div><h5 class="pfh">市場</h5>${alBars(R.byMarket, g => AL_MKT[g] || esc(g))}</div><div><h5 class="pfh">類型</h5>${alBars(R.byType, g => AL_TYPE[g] || esc(g))}</div>
      <div><h5 class="pfh">幣別</h5>${alBars(R.byCurrency)}</div><div><h5 class="pfh">產業前五大${R.byIndustryLookThrough ? "（ETF 穿透後）" : ""}</h5>${alBars((R.byIndustryLookThrough || R.byIndustry).slice(0, 5), g => (g === "unknown" ? "未分類" : esc(g)))}</div></div>
    ${lt}</section>`;
}
(function () {
  if (document.getElementById("alcss")) return; const st = document.createElement("style"); st.id = "alcss";
  st.textContent = `.albars{list-style:none;margin:0;padding:0}.albars li{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) 3.6em;gap:8px;align-items:center;padding:2px 0;font-size:12px}
.albars .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.albar{height:8px;border-radius:4px;background:var(--surface)}.albar i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.albars b{text-align:right;font-variant-numeric:tabular-nums}.algrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px}
.altable{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.altable th,.altable td{padding:3px 4px;text-align:right;border-bottom:1px solid var(--line)}.altable th:first-child,.altable td:first-child{text-align:left}
.alissues{margin:4px 12px;padding-left:1.2em}`;
  document.head.appendChild(st);
})();
// 合併（台幣計價）：美股部位每天用當天匯率換成台幣，和台股部位加總；損益拆成台股、美股股價與股息、匯率三塊（加總＝合併總損益）
function pfFxCard(F) {
  const head = `<section class="pfcard pffx" data-nofold><h4>合併（台幣計價）`;
  if (F.status === "unavailable") return `${head}<span class="pfbadge">無法計算</span></h4><p class="note lgwarn">⚠︎ ${(F.reasons || []).map(r => esc(KLFx.REASON_LABEL[r] || r)).join("；")}。台股、美股的績效分開看下面。</p></section>`;
  const P = F.pnl, m = F.mwr, est = m.status === "estimated" ? `<span class="pfbadge">估算</span>` : m.status === "unavailable" ? `<span class="pfbadge">無法計算</span>` : "";
  const tile = (k, v, sub = "", c = "") => `<div class="pftile"><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const reasons = F.reasons.length ? `<p class="note lgwarn pfreasons">⚠︎ 含估算：${F.reasons.map(r => esc(KLFx.REASON_LABEL[r] || KLPerf.REASON_LABEL[r] || r)).join("；")}。</p>` : "";
  return `${head}${F.status !== "ok" ? `<span class="pfbadge">含估算</span>` : ""}<small class="note"> ${F.from || ""}～${F.to || ""}</small></h4>
    <div class="pftiles">${[
      tile("總市值", lgMoney(F.marketValue, "TWD"), `美元部位占 ${F.usdShare == null ? "—" : (F.usdShare * 100).toFixed(0) + "%"}`),
      tile("總損益", lgSgn(P.total, "TWD"), `÷ 累計投入 ${pfPct(P.totalPct)}（不扣賣出、不看時點）`, cls(P.total)),
      tile("時間加權報酬", pfPct(F.twr), F.annualizable ? `年化 ${pfPct(F.twrAnn)}` : "未滿一年，不年化", cls(F.twr)),
      tile("資金加權報酬" + est, m.status === "unavailable" ? "—" : m.annualized ? pfPct(m.value) : pfPct(m.period), m.status === "unavailable" ? "現金流證明不了唯一解或算不出來" : m.annualized ? "年化（XIRR）" : "整段期間，未年化", cls(m.annualized ? m.value : m.period)),
      tile("匯率影響", lgSgn(P.usFx, "TWD"), F.fx.change == null ? "" : `美元兌台幣 ${F.fx.first?.toFixed(2)} → ${F.fx.rate?.toFixed(2)}（${pfPct(F.fx.change)}）`, cls(P.usFx))].join("")}</div>${reasons}
    <dl class="pfpnl"><dt>台股損益</dt><dd class="${cls(P.twStocks)}">${lgSgn(P.twStocks, "TWD")}</dd><dt>美股股價與股息（換成台幣）</dt><dd class="${cls(P.usPrice)}">${lgSgn(P.usPrice, "TWD")}</dd>
      <dt>匯率影響</dt><dd class="${cls(P.usFx)}">${lgSgn(P.usFx, "TWD")}</dd><dt>合計</dt><dd class="${cls(P.total)}"><b>${lgSgn(P.total, "TWD")}</b></dd></dl>
    <p class="note">匯率：${F.fx.rate == null ? "—" : F.fx.rate.toFixed(3)}（${esc(F.fx.date || "")}，${esc(F.fx.source || "")}；是市場中間價，不是銀行實際買賣匯率，換匯成本沒有算進去）。美股每天的市值與現金流都用當天匯率換算。</p></section>`;
}

// 總覽（第 8 階段）：畫面與計算在 pf-home.js、overview.js，用到時才依序載入
function renderThesis(S) {
  if (typeof renderThesisView === "function" && typeof KLThesis !== "undefined") return renderThesisView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入投資論點…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgThP ||= (typeof KLThesis !== "undefined" ? Promise.resolve() : one("thesis.js")).then(() => one("pf-thesis.js")).catch(e => { W.lgThP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderReport(S) {
  if (typeof renderReportView === "function" && typeof KLReport !== "undefined" && typeof KLOverview !== "undefined" && typeof KLThesis !== "undefined") return renderReportView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入報告…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  const need = [["KLOverview", "overview.js"], ["KLThesis", "thesis.js"], ["KLReport", "report.js"]].filter(([g]) => typeof window[g] === "undefined").map(([, f]) => f);
  (W.lgRpP ||= need.reduce((p, f) => p.then(() => one(f)), Promise.resolve()).then(() => (typeof renderReportView === "function" ? null : one("pf-report.js"))).catch(e => { W.lgRpP = null; throw e; }))
    .then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderDiv(S) {
  if (typeof renderDivView === "function" && typeof KLDivCal !== "undefined") return renderDivView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入股利現金流…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgDvP ||= (typeof KLDivCal !== "undefined" ? Promise.resolve() : one("divcal.js")).then(() => one("pf-divcal.js")).catch(e => { W.lgDvP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}
function renderHome(S) {
  if (typeof renderHomeView === "function" && typeof KLOverview !== "undefined") return renderHomeView(S);
  $("#lx").innerHTML = lgViewSeg() + skel("載入總覽…");
  const one = f => new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = f; sc.onload = ok; sc.onerror = () => no(new Error(`${f} 載入失敗`)); document.body.appendChild(sc); });
  (W.lgHomeP ||= one("overview.js").then(() => one("pf-home.js")).catch(e => { W.lgHomeP = null; throw e; })).then(() => renderList(), e => { $("#lx").innerHTML = lgViewSeg() + `<p class="note" style="padding:12px">⚠︎ ${esc(e.message)}</p>`; });
}

/* ================= 交易紀錄統一截圖匯入（自動辨識庫存快照／成交明細 ＋ 雙向切換 ＋ 三級對帳分流 ＋ WAL 寫入） ================= */
let _lgImpUid = 0;
function lgImpState() {
  return (W.lgImp ||= {
    step: "choose", kind: null, detectedKind: null, rows: [],
    method: lgLoad()?.method || "avg", busy: false,
    dupOk: false, dupSig: "", orderOk: false, orderSig: "",
    asOf: "", asOfStatus: null, altDate: "", rawAsOf: "", asOfConfirmed: false,
    snapshotScope: "partial", fileHashes: [],
    blurred: new Set(), edited: new Set(), saveTok: 0
  });
}
const lgImpHalf = s => String(s ?? "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, "/").replace(/－/g, "-").trim();
const normImpCode = s => lgImpHalf(s).toUpperCase().replace(/\s+/g, "").replace(/^(\d{4,6}[A-Z]?)\.(?:TW|TWO)$/, "$1");
const okImpCode = c => {
  const s = normImpCode(c);
  return !!s && !!lgMkt(s) && !(typeof isIdx === "function" && isIdx(s));
};
const isBadImpSym = s => {
  const t = lgImpHalf(s).toUpperCase().replace(/\s+/g, "");
  if (!t || okImpCode(t)) return false;
  return !/[\u4e00-\u9fff]/.test(t) && /^[\^A-Z0-9.=_-]{1,20}$/.test(t);
};
function lgStockName(c, fallback = "") {
  const s = normImpCode(c);
  if (!s) return fallback;
  const qn = W.quotes?.get?.(s)?.name;
  if (qn && qn !== s) return qn;
  if (W.names?.[s] && W.names[s] !== s) return W.names[s];
  const st = Array.isArray(W.stocks) ? W.stocks.find(x => String(x[0]).toUpperCase() === s) : null;
  if (st?.[1]) return st[1];
  if (typeof nameOf === "function") {
    const n = nameOf(s);
    if (n && n !== s) return n;
  }
  return fallback;
}
function lgResolveCodeInput(rawCode, rawName) {
  const rawC = String(rawCode ?? "").trim();
  const rawN = String(rawName ?? "").trim();
  for (const s of [rawC, rawN]) {
    if (!s) continue;
    const nc = normImpCode(s);
    if (okImpCode(nc)) return { code: nc, badSym: "", name: lgStockName(nc, rawN && rawN !== nc ? rawN : "") };
  }
  if (rawC && !isBadImpSym(rawC) && typeof findCode === "function") {
    const fc = findCode(rawC, false);
    if (fc && okImpCode(fc)) {
      const nc = normImpCode(fc);
      return { code: nc, badSym: "", name: lgStockName(nc, rawN || rawC) };
    }
  }
  if (!rawC && rawN && typeof findCode === "function") {
    const fc = findCode(rawN, false);
    if (fc && okImpCode(fc)) {
      const nc = normImpCode(fc);
      return { code: nc, badSym: "", name: lgStockName(nc, rawN) };
    }
  }
  if (rawC && isBadImpSym(rawC)) return { code: "", badSym: lgImpHalf(rawC).toUpperCase().replace(/\s+/g, ""), name: rawN || rawC };
  if (!rawC && rawN && isBadImpSym(rawN)) return { code: "", badSym: lgImpHalf(rawN).toUpperCase().replace(/\s+/g, ""), name: rawN };
  return { code: "", badSym: "", name: rawN || rawC };
}
const roundImpTwSh = sh => {
  const r = Math.round(sh);
  if (r >= 1000) {
    const k = Math.round(r / 1000) * 1000;
    if (Math.abs(r - k) / k < 0.015) return k;
  }
  return r;
};
function lgDeriveHoldingRow(raw) {
  const res = lgResolveCodeInput(raw?.code, raw?.name);
  const code = res.code;
  const px = raw?.price != null ? +raw.price : (code ? W.quotes?.get?.(code)?.price : null);
  let sh = raw?.shares != null ? +raw.shares : (raw?.sh != null ? +raw.sh : null);
  let cost = raw?.avgCost != null ? +raw.avgCost : (raw?.cost != null ? +raw.cost : null);
  let how = "", derivedSh = false;
  if (sh > 0 && cost != null && cost >= 0) how = "截圖上的股數與成本";
  else if (sh > 0 && raw?.totalPnl != null && px > 0) { cost = (sh * px - +raw.totalPnl) / sh; how = "用股數與總損益推算成本"; }
  else if (!(sh > 0) && raw?.marketValue > 0 && px > 0) {
    sh = +raw.marketValue / px; derivedSh = true;
    if (cost == null && raw?.totalPnl != null && sh > 0) cost = (+raw.marketValue - +raw.totalPnl) / sh;
    how = "用市值推算股數" + (cost != null && cost >= 0 ? "與成本" : "，請填成本");
  } else if (!(sh > 0) && raw?.totalPnl != null && raw?.totalPnlPct && px > 0) {
    const ct = +raw.totalPnl / (+raw.totalPnlPct / 100), mv = ct + +raw.totalPnl;
    sh = mv / px; derivedSh = true; cost = sh > 0 ? ct / sh : null; how = "用總損益與報酬率推算";
  } else if (!(sh > 0) && raw?.todayPnl != null && raw?.chgPct && px > 0) {
    const chg = px - px / (1 + +raw.chgPct / 100);
    sh = chg ? +raw.todayPnl / chg : null; derivedSh = true; how = "用今日損益推算股數（誤差較大），請填成本";
  } else how = "截圖上看不出股數或成本，請手動填";
  if (derivedSh && sh > 0) sh = lgMkt(code) === "us" ? +sh.toFixed(4) : roundImpTwSh(sh);
  if (raw?.avgCost == null && raw?.cost == null && cost != null && cost >= 0) cost = +cost.toFixed(cost >= 100 ? 1 : 2);
  const dIn = typeof raw?.d === "string" && raw.d.trim() ? raw.d.trim() : typeof raw?.date === "string" && raw.date.trim() ? raw.date.trim() : "";
  const marginType = raw?.marginType === "margin" || raw?.marginType === "short" ? raw.marginType : null;
  return {
    _uid: ++_lgImpUid,
    _raw: raw ? { ...raw } : null,
    on: marginType ? false : (typeof raw?.on === "boolean" ? raw.on : true),
    marginType,
    code, badSym: res.badSym, name: res.name,
    sh: sh != null && Number.isFinite(sh) && sh > 0 ? sh : null,
    cost: cost != null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    d: dIn, dTouched: !!dIn,
    how, verifyErr: null, _fresh: false, _lookingUp: false, _lookupSeq: 0
  };
}
function lgMapTradeRow(raw) {
  const res = lgResolveCodeInput(raw?.code, raw?.name);
  const side = raw?.side === "buy" || raw?.type === "buy" ? "buy" : raw?.side === "sell" || raw?.type === "sell" ? "sell" : "";
  const sh = raw?.shares != null ? +raw.shares : (raw?.sh != null ? +raw.sh : null);
  const px = raw?.price != null ? +raw.price : null;
  const fee = raw?.fee === 0 ? 0 : (raw?.fee != null && Number.isFinite(+raw.fee) ? +raw.fee : null);
  const tax = raw?.tax === 0 ? 0 : (raw?.tax != null && Number.isFinite(+raw.tax) ? +raw.tax : null);
  const da = raw?.dateAssumed;
  const dateAssumed = ["year", "today", "mdy", "invalid", "missing"].includes(da) ? da : null;
  const marginType = raw?.marginType === "margin" || raw?.marginType === "short" ? raw.marginType : null;
  const hasStrDate = typeof raw?.date === "string" && raw.date.trim();
  const dVal = hasStrDate ? raw.date.trim() : (dateAssumed === "invalid" || dateAssumed === "missing" ? "" : lgToday());
  return {
    _uid: ++_lgImpUid,
    _raw: raw ? { ...raw } : null,
    on: marginType ? false : (raw?.on !== false),
    marginType,
    date: dVal,
    dateAssumed: !hasStrDate && !dateAssumed ? "missing" : dateAssumed,
    _fromAsOf: false,
    altDate: typeof raw?.altDate === "string" ? raw.altDate.trim() : "",
    rawDate: typeof raw?.rawDate === "string" ? raw.rawDate.trim() : "",
    time: (typeof raw?.time === "string" && raw.time.trim()) ? raw.time.trim() : (raw?.timeInvalid === true && typeof raw?.rawTime === "string" ? raw.rawTime.trim() : ""),
    side, code: res.code, badSym: res.badSym, name: res.name,
    shares: sh != null && Number.isFinite(sh) ? sh : null,
    price: px != null && Number.isFinite(px) ? px : null,
    fee, tax,
    dayTrade: side === "sell" && !!raw?.dayTrade,
    note: typeof raw?.note === "string" ? raw.note.trim() : "",
    verifyErr: null, _fresh: false, _lookingUp: false, _lookupSeq: 0
  };
}
function lgNewBlankRow(kind) {
  if (kind === "holdings") {
    return { _uid: ++_lgImpUid, _raw: null, on: true, marginType: null, code: "", badSym: "", name: "", sh: null, cost: null, d: lgToday(), dTouched: true, how: "", verifyErr: null, _fresh: true, _lookingUp: false, _lookupSeq: 0 };
  }
  return { _uid: ++_lgImpUid, _raw: null, on: true, marginType: null, date: lgToday(), dateAssumed: null, _fromAsOf: false, altDate: "", rawDate: "", time: "", side: "buy", code: "", badSym: "", name: "", shares: null, price: null, fee: null, tax: null, dayTrade: false, note: "", verifyErr: null, _fresh: true, _lookingUp: false, _lookupSeq: 0 };
}
function lgImpErrField(kind, code) {
  if (code === "invalid_date" || code === "future_date" || code === "date_too_old" || code === "unconfirmed_date_format" || code === "missing_date") return kind === "holdings" ? "d" : "date";
  if (code === "invalid_time") return "time";
  if (code === "invalid_type") return "side";
  if (["invalid_symbol", "invalid_market", "invalid_currency", "currency_mismatch", "currency_conflict", "verify_symbol"].includes(code)) return "code";
  if (["invalid_shares", "fractional_shares", "oversell", "over_transfer"].includes(code)) return kind === "holdings" ? "sh" : "shares";
  if (code === "invalid_price") return kind === "holdings" ? "cost" : "price";
  if (code === "invalid_fee") return "fee";
  if (code === "invalid_tax") return "tax";
  return "code";
}
function lgImpErrMsg(err, r) {
  if (!err) return "";
  if (err.code === "invalid_date" && r?.dateAssumed === "invalid") {
    return r.rawDate ? `無法辨識截圖日期「${r.rawDate}」，請手動修正為 YYYY-MM-DD` : "無法辨識截圖日期，請手動修正為 YYYY-MM-DD";
  }
  if (err.code === "invalid_symbol") return r.name && !r.code && !r.badSym ? `找不到「${r.name}」的代號，請輸入台股或美股代號` : "請輸入台股或美股代號（例如 2330、NVDA）";
  if (err.code === "invalid_market") return "僅支援台股與美股（例如 2330、NVDA，不支援指數、期貨或海外市場）";
  if (err.code === "invalid_type") return "請選擇買進或賣出";
  return err.message || "";
}
function lgPrepare(S, opts = {}) {
  const existing = lgLoad(), recon = lgReconLoad();
  const existingTxs = Array.isArray(existing?.transactions) ? existing.transactions : [];
  const method = existing ? existing.method : (S.method === "fifo" ? "fifo" : "avg");
  const today = lgToday();
  const mktFn = sym => (okImpCode(sym) ? lgMkt(sym) : null);
  const rules = lgRules();
  const idPrefix = opts.finalIds ? undefined : "lgimp-p-";
  let P;
  if (S.kind === "holdings") {
    const snapRows = S.rows.map(r => {
      const sym = r.code || r.badSym || "";
      const m = sym && okImpCode(sym) ? lgMkt(sym) : null;
      return {
        on: r.on !== false,
        code: sym,
        name: r.name,
        market: m,
        currency: m ? (m === "us" ? "USD" : "TWD") : null,
        shares: r.sh,
        avgCost: r.cost,
        marginType: r.marginType || null,
        how: r.how,
        d: r.dTouched ? r.d : (r.d || null),
      };
    });
    const plan = typeof KLRecon !== "undefined" ? KLRecon.planHoldingsSnapshot({
      store: recon || KLRecon.emptyStore(),
      txStore: existing || { v: 1, method, transactions: [] },
      ledgerLib: KLLedger,
      method,
      today,
      rows: snapRows,
      snapshotScope: S.snapshotScope === "full" ? "full" : "partial",
      asOf: S.asOf || null,
      asOfStatus: S.asOfStatus || (S.asOf ? "exact" : "missing"),
      asOfConfirmed: S.asOfConfirmed === true,
      rawAsOf: S.rawAsOf || "",
      altDate: S.altDate || "",
      fileHashes: S.fileHashes || [],
    }) : { items: [], closures: [] };
    const planByIndex = new Map((plan.items || []).map(it => [it.rowIndex, it]));
    const RL = KLLedger.buildReconciledLedger(existingTxs, recon, { method, today, rules });
    const baseMap = new Map(RL.positions.filter(p => p.open || p.hasSnapshot).map(p => [p.symbol, p]));
    let selectedCount = 0, errorCount = 0;
    const items = S.rows.map((r, i) => {
      const sym = (r.code || r.badSym || "").trim().toUpperCase();
      const on = r.marginType ? false : (r.on !== false);
      const pi = planByIndex.get(i) || null;
      const errors = [];
      if (pi?.reasonCode === "currency_conflict") {
        errors.push({ code: "currency_conflict", message: pi.reasonMessage });
      } else if (!r.code && !r.marginType) {
        errors.push({ code: r.badSym ? "invalid_market" : "invalid_symbol", message: r.badSym ? "僅支援台股與美股（例如 2330、NVDA，不支援指數、期貨或海外市場）" : "請輸入台股或美股代號" });
      }
      if (!r.marginType) {
        if (r.sh == null || !Number.isFinite(r.sh) || r.sh <= 0) errors.push({ code: "invalid_shares", message: "股數必須大於 0" });
        else if (r.code && lgMkt(r.code) === "tw" && Math.abs(r.sh - Math.round(r.sh)) > 1e-6) errors.push({ code: "fractional_shares", message: "台股股數必須為整數" });
        if (r.cost != null && (!Number.isFinite(r.cost) || r.cost < 0)) errors.push({ code: "invalid_price", message: "每股成本必須為正數或留空（待補充）" });
      }
      if (r.verifyErr && !errors.some(e => e.code === "verify_symbol")) {
        errors.push({ code: "verify_symbol", message: r.verifyErr });
      }
      if (on) {
        selectedCount++;
        if (errors.length) errorCount++;
      }
      const existingPos = sym ? baseMap.get(sym) || null : null;
      return {
        index: i,
        on,
        symbol: sym,
        marginType: r.marginType || null,
        planItem: pi,
        duplicateOpen: !!existingPos,
        existingShares: existingPos ? existingPos.shares : 0,
        errors,
        warnings: [],
      };
    });
    const canSaveClosures = S.snapshotScope === "full" && (plan.closures?.length || 0) > 0 && S.rows.length === 0;
    P = {
      ok: (selectedCount > 0 || canSaveClosures) && errorCount === 0,
      items,
      plan,
      planByIndex,
      selectedCount,
      errorCount,
      newErrors: [],
      duplicates: [],
      ambiguousSameDay: [],
      needsOrderConfirm: false,
      existingOpenCount: items.filter(it => it.duplicateOpen).length,
    };
  } else {
    const mapped = S.rows.map(r => {
      const sym = r.code || r.badSym || "", m = sym && okImpCode(sym) ? lgMkt(sym) : null;
      return {
        on: r.marginType ? false : (r.on !== false),
        date: r.date ?? "",
        dateAssumed: r.dateAssumed || null,
        ...(r.altDate ? { altDate: r.altDate } : {}),
        ...(r.rawDate ? { rawDate: r.rawDate } : {}),
        time: r.time || "",
        side: r.side || "",
        symbol: sym,
        name: r.name,
        shares: r.shares,
        price: r.price,
        fee: r.fee,
        tax: r.tax,
        ...(m ? { assetType: lgAssetType(sym, m) } : {}),
        dayTrade: r.side === "sell" && !!r.dayTrade,
        note: r.note || "",
        source: "import"
      };
    });
    P = KLLedger.prepareTradesImport(mapped, existingTxs, { method, today, market: mktFn, rules, recon, orderConfirmed: S.orderOk === true, ...(idPrefix ? { idPrefix } : {}) });
    let extraErr = 0;
    for (const it of P.items) {
      const r = S.rows[it.index];
      if (r?.verifyErr && !it.errors.some(e => e.code === "verify_symbol")) {
        it.errors.push({ code: "verify_symbol", message: r.verifyErr });
        if (it.on) extraErr++;
      }
    }
    if (extraErr > 0) {
      P.errorCount += extraErr;
      P.ok = P.selectedCount > 0 && P.errorCount === 0 && !P.needsOrderConfirm;
    }
  }
  return P;
}
function lgImpFieldErrors(kind, errors) {
  const m = new Map();
  for (const e of errors || []) {
    const k = lgImpErrField(kind, e.code);
    if (!m.has(k)) m.set(k, e);
  }
  return m;
}
function lgImpSeedErrors(S, P) {
  for (const it of P.items) {
    const r = S.rows[it.index];
    if (!r || !it.on || r._fresh || !it.errors.length) continue;
    for (const e of it.errors) S.blurred.add(`${r._uid}:${lgImpErrField(S.kind, e.code)}`);
  }
}
function lgImpChooseHtml() {
  const recon = lgReconLoad();
  const openCount = (recon?.conflicts || []).filter(c => c && c.status === "open").length;
  return `<p class="note">上傳券商 App 截圖後，系統會自動辨識「庫存快照」或「成交明細」並核對對帳基準（建立或更新 <code>kline:pf:recon:v1</code>／<code>kline:pf:v1</code>）；舊庫存（<code>kline:watch:hold</code>）完全不動。</p>
    <div class="lgbar" style="margin:10px 0">
      <button type="button" class="btn primary" data-lgimp-upload>📷 上傳券商截圖（自動辨識庫存／交易明細）</button>
      <button type="button" class="btn sm" data-lgimp-blank>手動新增空白列</button>
      ${openCount > 0 ? `<button type="button" class="btn sm" data-lgimp-conflicts>查看待對帳項目（${openCount}）</button>` : ""}
      <button type="button" class="btn sm" data-ic="close">取消</button>
    </div>`;
}
function lgImpRowHtml(r, i, kind, item, today, total = 1) {
  const uid = r._uid;
  const codeVal = r.code || r.badSym || r.name || "";
  const dupWarn = (item?.warnings || []).filter(w => w.code !== "fee_estimated").map(w => w.message).join("；");
  if (kind === "holdings") {
    const pi = item?.planItem;
    let levelTxt = "", levelCls = "ok";
    if (r.marginType) { levelTxt = "Level 2・融資／融券已隔離"; levelCls = ""; }
    else if (!item?.on) { levelTxt = "已略過（不匯入）"; levelCls = "ok"; }
    else if (item?.errors?.length) { levelTxt = "Level 3・阻擋"; levelCls = ""; }
    else if (pi?.level === 3) { levelTxt = "Level 3・阻擋"; levelCls = ""; }
    else if (pi?.level === 2) {
      const hint = pi.reasonCode === "recon_diff" && typeof KLRecon?.settlementHint === "function" ? KLRecon.settlementHint(pi.market) : "";
      levelTxt = `Level 2・待對帳（${pi.reasonMessage || "需確認"}${hint && !(pi.reasonMessage || "").includes(hint) ? `；${hint}` : ""}）`;
      levelCls = "";
    } else if (pi?.level === 1) {
      levelTxt = `Level 1・${pi.reasonMessage || "可確認基準"}`;
      levelCls = "ok";
    }
    const meta = [r._lookingUp ? "查詢代號中…" : "", !r._lookingUp && r.code ? lgStockName(r.code, r.name) : "", !r._lookingUp && item?.duplicateOpen ? `帳本已有 ${lgN(item.existingShares)} 股` : (!r._lookingUp && r.how && r.how !== "截圖上的股數與成本" ? r.how : "")].filter(Boolean).join("・");
    return `<tr data-row="${i}" data-uid="${uid}">
      <td><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="on" aria-label="匯入第 ${i + 1} 列" ${item?.on ? "checked" : ""}${r.marginType ? " disabled" : ""}></td>
      <td><input class="code" data-lgimp-uid="${uid}" data-lgimp-k="code" value="${esc(codeVal)}" placeholder="2330 或 NVDA" autocomplete="off" autocapitalize="characters" aria-label="代號或名稱" aria-invalid="false">
        <small id="lgim-${uid}" data-lgimp-meta="${uid}"${meta ? "" : " hidden"}>${esc(meta)}</small>
        <small id="lgie-${uid}-code" class="lgimp-err" hidden></small></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="sh" value="${r.sh ?? ""}" placeholder="1000" aria-label="股數" aria-invalid="false">
        <small id="lgie-${uid}-sh" class="lgimp-err" hidden></small></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="cost" value="${r.cost ?? ""}" placeholder="均價（可空）" aria-label="每股成本" aria-invalid="false">
        <small id="lgie-${uid}-cost" class="lgimp-err" hidden></small></td>
      <td><span data-lgimp-lvl="${uid}" class="lgimp-tag ${levelCls}">${esc(levelTxt)}</span></td>
      <td><button type="button" class="hg-del" data-lgimp-del="${uid}" aria-label="刪除第 ${i + 1} 列">✕</button></td>
    </tr>`;
  }
  const dTagText = r.dateAssumed === "year" ? "年份待確認（請核對）"
    : r.dateAssumed === "today" ? "未含日期，已帶入今天"
    : r._fromAsOf ? "已帶入截圖基準日"
    : r.dateAssumed === "missing" ? "缺少日期，請補填或確認截圖基準日"
    : r.dateAssumed === "mdy" ? "日期格式待確認（月/日或日/月）"
    : r.dateAssumed === "invalid" ? `截圖日期無效（${r.rawDate || "格式錯誤"}）`
    : "";
  const showDfix = r.dateAssumed === "mdy" && !!r.altDate;
  const est = item?.on && !item?.errors?.length && (r.side === "buy" || r.side === "sell") && item?.computed?.feeEstimated
    ? [r.fee == null ? `手續費估 ${lgN(item.computed.fee)}` : "", r.side === "sell" && r.tax == null ? `稅估 ${lgN(item.computed.tax)}` : ""].filter(Boolean).join("・")
    : "";
  const hintLabel = r.marginType ? "Level 2・融資／融券已隔離"
    : !item?.on ? ""
    : item?.errors?.length ? "Level 3・阻擋"
    : item?.reconcileHint === "pre_snapshot" ? "Level 1・快照前歷史"
    : item?.reconcileHint === "same_day_order" ? "Level 2・同日順序待釐清"
    : item?.warnings?.some(w => w.code === "possible_duplicate") ? "Level 2・可能重複"
    : item?.reconcileHint === "post_snapshot" ? "Level 1・快照後交易"
    : "Level 1・可匯入";
  const meta = [r._lookingUp ? "查詢代號中…" : "", !r._lookingUp && r.code ? lgStockName(r.code, r.name) : "", !r._lookingUp ? est : "", hintLabel].filter(Boolean).join("・");
  return `<tr data-row="${i}" data-uid="${uid}">
    <td><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="on" aria-label="匯入第 ${i + 1} 列" ${item?.on ? "checked" : ""}${r.marginType ? " disabled" : ""}></td>
    <td><input type="date" data-lgimp-uid="${uid}" data-lgimp-k="date" value="${esc(r.date ?? "")}" max="${today}" aria-label="成交日期" aria-invalid="false">
      <small data-lgimp-dtag="${uid}" class="lgimp-tag"${dTagText ? "" : " hidden"}>${esc(dTagText)}</small>
      <div data-lgimp-dwrap="${uid}" class="lgimp-dfix"${showDfix ? "" : " hidden"}>
        <button type="button" data-lgimp-dok="${uid}">採月/日 ${esc(r.date)}</button>
        <button type="button" class="alt" data-lgimp-dflip="${uid}">改日/月 ${esc(r.altDate || "")}</button>
      </div>
      <small id="lgie-${uid}-date" class="lgimp-err" hidden></small>
      <div class="lgimp-trow">
        <input class="lgimp-time" type="text" size="6" data-lgimp-uid="${uid}" data-lgimp-k="time" value="${esc(r.time || "")}" placeholder="時間 09:05" autocomplete="off" inputmode="numeric" aria-label="成交時間" aria-invalid="false">
        <button type="button" class="lgimp-mv" data-lgimp-mv="-1" data-lgimp-uid="${uid}" aria-label="上移第 ${i + 1} 列"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="lgimp-mv" data-lgimp-mv="1" data-lgimp-uid="${uid}" aria-label="下移第 ${i + 1} 列"${i >= total - 1 ? " disabled" : ""}>↓</button>
      </div>
      <small id="lgie-${uid}-time" class="lgimp-err" hidden></small></td>
    <td><select data-lgimp-uid="${uid}" data-lgimp-k="side" aria-label="方向" aria-invalid="false">
        <option value=""${!r.side ? " selected" : ""}>請選擇</option>
        <option value="buy"${r.side === "buy" ? " selected" : ""}>買進</option>
        <option value="sell"${r.side === "sell" ? " selected" : ""}>賣出</option>
      </select>
      <label class="lgimp-sub"><input type="checkbox" data-lgimp-uid="${uid}" data-lgimp-k="dayTrade" ${r.side === "sell" && r.dayTrade ? "checked" : ""} ${r.side === "sell" ? "" : "disabled"}> 現股當沖</label>
      <small id="lgie-${uid}-side" class="lgimp-err" hidden></small></td>
    <td><input class="code" data-lgimp-uid="${uid}" data-lgimp-k="code" value="${esc(codeVal)}" placeholder="2330 或 NVDA" autocomplete="off" autocapitalize="characters" aria-label="代號或名稱" aria-invalid="false">
      <small id="lgim-${uid}" data-lgimp-meta="${uid}"${meta ? "" : " hidden"}>${esc(meta)}</small>
      <small data-lgimp-warn="${uid}" class="lgimp-tag"${dupWarn ? "" : " hidden"}>${dupWarn ? "⚠︎ " + esc(dupWarn) : ""}</small>
      <small id="lgie-${uid}-code" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="shares" value="${r.shares ?? ""}" placeholder="1000" aria-label="股數" aria-invalid="false">
      <small id="lgie-${uid}-shares" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="price" value="${r.price ?? ""}" placeholder="900" aria-label="單價" aria-invalid="false">
      <small id="lgie-${uid}-price" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="fee" value="${r.fee ?? ""}" placeholder="估算" aria-label="手續費" aria-invalid="false">
      <small id="lgie-${uid}-fee" class="lgimp-err" hidden></small></td>
    <td><input type="number" inputmode="decimal" min="0" step="any" data-lgimp-uid="${uid}" data-lgimp-k="tax" value="${r.tax ?? ""}" placeholder="估算" aria-label="交易稅" aria-invalid="false">
      <small id="lgie-${uid}-tax" class="lgimp-err" hidden></small></td>
    <td><input class="lgimp-note" data-lgimp-uid="${uid}" data-lgimp-k="note" maxlength="200" value="${esc(r.note || "")}" placeholder="選填" aria-label="備註"></td>
    <td><button type="button" class="hg-del" data-lgimp-del="${uid}" aria-label="刪除第 ${i + 1} 列">✕</button></td>
  </tr>`;
}
function lgImpBannerHtml(S, today) {
  const recon = lgReconLoad();
  const detLbl = S.detectedKind === "holdings" ? "庫存快照" : S.detectedKind === "trades" ? "成交明細" : "類型尚未確定（請確認或點右側切換）";
  const hashHit = typeof KLRecon !== "undefined" && S.fileHashes?.length ? KLRecon.findRepeatHash(recon, S.fileHashes) : null;
  const hitAt = hashHit?.hit
    ? ((recon?.imports || []).find(imp => Array.isArray(imp?.fileHashes) && imp.fileHashes.some(h => S.fileHashes.includes(h)))?.at || "")
    : "";
  const hashWarn = hashHit?.hit
    ? `<div class="lgimp-tag">⚠︎ 此截圖之前已上傳過${hitAt ? `（${esc(String(hitAt).slice(0, 10))}）` : ""}${hashHit.openConflicts > 0 ? `，尚有 ${hashHit.openConflicts} 項未結案待對帳 <button type="button" class="linkbtn" data-lg="view-conflicts">查看待對帳</button>` : "（仍可補充核對）"}</div>`
    : "";
  const asOfValid = /^\d{4}-\d{2}-\d{2}$/.test(S.asOf || "") && S.asOf <= today;
  let asOfMsg = "";
  if (S.asOfConfirmed && asOfValid) {
    asOfMsg = `基準日已確認：<b>${esc(S.asOf)}</b>`;
  } else if (S.asOfStatus === "year") {
    asOfMsg = `截圖顯示「${esc(S.rawAsOf || S.asOf || "")}」，系統暫推為 <b>${esc(S.asOf || "")}</b>（缺年份，確認前不設為已確認快照）`;
  } else if (S.asOfStatus === "future" || (S.asOf && S.asOf > today)) {
    asOfMsg = `截圖日期「${esc(S.rawAsOf || S.asOf || "")}」晚於今日（${today}），請修正或確認基準日`;
  } else if (S.asOfStatus === "mdy") {
    asOfMsg = `截圖日期「${esc(S.rawAsOf || S.asOf || "")}」可能為月/日（${esc(S.asOf || "")}）或日/月（${esc(S.altDate || "")}），請確認`;
  } else {
    asOfMsg = `截圖未含明確基準日期${S.rawAsOf ? `（${esc(S.rawAsOf)}）` : ""}，請補填並確認基準日（未確認前將進待對帳）`;
  }
  const hasMargin = S.rows.some(r => !!r.marginType);
  const marginCard = hasMargin
    ? `<div class="lgimp-margin">ⓘ 偵測到融資／融券部位已隔離，避免混入現股成本 <button type="button" class="linkbtn" data-lg="view" data-v="margin">前往配置與風險 → 融資管理</button></div>`
    : "";
  const present = new Set(S.rows.filter(r => r.on !== false && !r.marginType && r.code).map(r => r.code));
  const omitted = typeof KLRecon !== "undefined"
    ? [...KLRecon.activeBaselines(recon).values()].filter(b => b.shares > 1e-9 && !present.has(b.symbol) && (!asOfValid || b.date < S.asOf)).map(b => `${b.symbol}(${lgN(b.shares)}股)`)
    : [];
  const scopeHtml = S.kind === "holdings" ? `<div class="lgimp-scope" role="radiogroup" aria-label="庫存截圖範圍">
    <label><input type="radio" name="lgImpScope" value="partial" data-lgimp-scope="partial"${S.snapshotScope !== "full" ? " checked" : ""}> 部分截圖／單頁（僅更新畫面有列出的標的）</label>
    <label><input type="radio" name="lgImpScope" value="full" data-lgimp-scope="full"${S.snapshotScope === "full" ? " checked" : ""}> 完整庫存清單（未出現在此截圖且原有持股將進入清倉核對或結案）</label>
    <small id="lgImpFullWarn" class="lgimp-tag"${S.snapshotScope === "full" && omitted.length ? "" : " hidden"}>${S.snapshotScope === "full" && omitted.length ? `未列於此完整截圖的原持股（將結案或進入清倉核對）：${esc(omitted.join("、"))}` : ""}</small>
  </div>` : "";
  return `<div class="lgimp-banner">
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <span>系統辨識結果：<b>${detLbl}</b></span>
      <button type="button" class="btn sm" data-lgimp-switch="holdings" aria-pressed="${S.kind === "holdings"}">切換為庫存快照</button>
      <button type="button" class="btn sm" data-lgimp-switch="trades" aria-pressed="${S.kind === "trades"}">切換為成交明細</button>
    </div>
    <div class="lgimp-asof">
      <span id="lgImpAsOfMsg">${asOfMsg}</span>
      <input type="date" data-lgimp-asof value="${esc(S.asOf || "")}" max="${today}" aria-label="截圖基準日期">
      <button type="button" class="btn sm${S.asOfConfirmed ? "" : " primary"}" data-lgimp-asof-ok>確認基準日</button>
      ${S.asOfStatus === "mdy" && S.altDate ? `<button type="button" class="btn sm" data-lgimp-asof-flip="${esc(S.altDate)}">改採 ${esc(S.altDate)}</button>` : ""}
    </div>
    ${scopeHtml}
    ${hashWarn}
    ${marginCard}
  </div>`;
}
function lgImpReviewHtml(S, P) {
  const isHold = S.kind === "holdings", today = lgToday(), existing = lgLoad();
  const intro = isHold
    ? "核對後將依對帳規則存入獨立快照基準（<code>kline:pf:recon:v1</code>）：符合容差自動確認、存在差異或缺年份／成本進入待對帳中心；<b>不會寫入</b> <code>transfer_in</code> 到交易紀錄，舊庫存也不動。"
    : `核對每一筆成交明細（依日期與成交時間由舊到新套用；同日買賣未附時間時須確認順序，可用 ↑↓ 或「反轉列表順序」調整）。手續費／稅填 0 維持 0，空白則依費用規則與持股頁「手續費折扣」設定${lgDiscText()}估算。`;
  const cols = isHold
    ? `<th scope="col">匯入</th><th scope="col">代號／名稱</th><th scope="col">股數<small>美股可填小數</small></th><th scope="col">每股成本<small>可留空待補</small></th><th scope="col">對帳分流</th><th scope="col"><span class="pfsr">刪除</span></th>`
    : `<th scope="col">匯入</th><th scope="col">成交日期／時間</th><th scope="col">方向<small>賣出可勾當沖</small></th><th scope="col">代號／名稱</th><th scope="col">股數</th><th scope="col">單價</th><th scope="col">手續費<small>空白＝估算</small></th><th scope="col">交易稅<small>空白＝估算</small></th><th scope="col">備註</th><th scope="col"><span class="pfsr">刪除</span></th>`;
  const rowsHtml = S.rows.map((r, i) => lgImpRowHtml(r, i, S.kind, P.items[i], today, S.rows.length)).join("");
  return `<form class="lgimp-form" id="lgImpForm" novalidate>
    <div class="lgimp-mid">
      <p class="note lgimp-intro">${intro}</p>
      ${lgImpBannerHtml(S, today)}
      <div class="lgimp-msg err" id="lgImpGlobalErr" hidden></div>
      <div class="hg-wrap" tabindex="0" role="region" aria-labelledby="impTitle">
        <table class="hgrid ${isHold ? "lgimp-h" : "lgimp-t"}">
          <thead><tr>${cols}</tr></thead>
          <tbody id="lgImpTbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="row2" style="margin:8px 0">
        <button type="button" class="btn sm" data-lgimp-add>＋ 新增一列</button>
        <button type="button" class="btn sm" data-lgimp-shot>＋ 再加截圖</button>
        ${!isHold ? `<button type="button" class="btn sm" data-lgimp-rev${S.rows.length < 2 ? " disabled" : ""}>⇅ 反轉列表順序</button>` : ""}
      </div>
      ${!existing ? `<label class="lgimp-method">成本算法 <select id="lgImpMethod" data-lgimp-method><option value="avg"${S.method === "avg" ? " selected" : ""}>加權平均成本</option><option value="fifo"${S.method === "fifo" ? " selected" : ""}>先進先出（FIFO）</option></select></label>` : ""}
      ${!isHold ? `<label class="lgimp-order" id="lgImpOrderWrap" hidden><input type="checkbox" id="lgImpOrderOk" data-lgimp-orderok aria-invalid="false"> <span id="lgImpOrderTxt"></span></label>` : ""}
      <label class="lgimp-dup" id="lgImpDupWrap" hidden><input type="checkbox" id="lgImpDup" data-lgimp-dup aria-invalid="false"> <span id="lgImpDupTxt"></span></label>
    </div>
    <div class="lgimp-foot">
      <p class="lgimp-sum" id="lgImpSum"></p>
      <div class="row2"><button type="submit" class="btn primary sm" id="lgImpSave"></button><button type="button" class="btn sm" data-ic="close">取消</button></div>
    </div>
  </form>`;
}
function lgSyncImportUI(opts = {}) {
  const S = lgImpState(), form = $("#lgImpForm");
  if (!form || S.step !== "review") return null;
  const P = lgPrepare(S), isHold = S.kind === "holdings", today = lgToday(), recon = lgReconLoad();
  let visibleErrCount = 0;
  for (let i = 0; i < S.rows.length; i++) {
    const r = S.rows[i], item = P.items[i], tr = form.querySelector(`tr[data-uid="${r._uid}"]`);
    if (!tr) continue;
    tr.dataset.row = String(i);
    const delBtn = tr.querySelector("[data-lgimp-del]");
    if (delBtn) delBtn.setAttribute("aria-label", `刪除第 ${i + 1} 列`);
    const fieldErrs = item ? lgImpFieldErrors(S.kind, item.errors) : new Map();
    const rowShownErrs = [];
    const fields = isHold ? ["code", "sh", "cost"] : ["date", "time", "side", "code", "shares", "price", "fee", "tax"];
    for (const k of fields) {
      const inp = tr.querySelector(`[data-lgimp-k="${k}"]`), errEl = document.getElementById(`lgie-${r._uid}-${k}`);
      const eObj = item?.on && S.blurred.has(`${r._uid}:${k}`) ? fieldErrs.get(k) : null;
      if (eObj) { visibleErrCount++; rowShownErrs.push({ k, msg: lgImpErrMsg(eObj, r) }); }
      if (inp) {
        inp.setAttribute("aria-invalid", eObj ? "true" : "false");
        const desc = [];
        if (eObj) desc.push(`lgie-${r._uid}-${k}`);
        if (k === "code") {
          const m = tr.querySelector(`[data-lgimp-meta="${r._uid}"]`);
          if (m && !m.hidden) desc.push(m.id);
        }
        if (desc.length) inp.setAttribute("aria-describedby", desc.join(" "));
        else inp.removeAttribute("aria-describedby");
      }
      if (errEl) {
        const msg = eObj ? lgImpErrMsg(eObj, r) : "";
        errEl.textContent = msg;
        errEl.hidden = !msg;
      }
    }
    const onInp = tr.querySelector('[data-lgimp-k="on"]');
    if (onInp) {
      const want = !!item?.on;
      if (onInp.checked !== want) onInp.checked = want;
      onInp.disabled = !!r.marginType;
      onInp.setAttribute("aria-label", `匯入第 ${i + 1} 列`);
    }
    if (isHold) {
      const lvlEl = tr.querySelector(`[data-lgimp-lvl="${r._uid}"]`);
      if (lvlEl) {
        const pi = item?.planItem;
        let txt = "", clsNm = "lgimp-tag ok";
        if (r.marginType) { txt = "Level 2・融資／融券已隔離"; clsNm = "lgimp-tag"; }
        else if (!item?.on) { txt = "已略過（不匯入）"; }
        else if (item?.errors?.length || pi?.level === 3) { txt = `Level 3・阻擋（${(item?.errors?.[0]?.message || pi?.reasonMessage || "欄位有誤")}）`; clsNm = "lgimp-tag"; }
        else if (pi?.level === 2) {
          const hint = pi.reasonCode === "recon_diff" && typeof KLRecon?.settlementHint === "function" ? KLRecon.settlementHint(pi.market) : "";
          txt = `Level 2・待對帳（${pi.reasonMessage || "需確認"}${hint && !(pi.reasonMessage || "").includes(hint) ? `；${hint}` : ""}）`;
          clsNm = "lgimp-tag";
        } else if (pi?.level === 1) {
          txt = `Level 1・${pi.reasonMessage || "可確認基準"}`;
        }
        lvlEl.textContent = txt;
        lvlEl.className = clsNm;
      }
    } else {
      const dtInp = tr.querySelector('[data-lgimp-k="dayTrade"]');
      if (dtInp) {
        const canDt = r.side === "sell";
        dtInp.disabled = !canDt;
        const wantDt = canDt && !!r.dayTrade;
        if (dtInp.checked !== wantDt) dtInp.checked = wantDt;
      }
      const dTag = tr.querySelector(`[data-lgimp-dtag="${r._uid}"]`);
      if (dTag) {
        const t = r.dateAssumed === "year" ? "年份待確認（請核對）"
          : r.dateAssumed === "today" ? "未含日期，已帶入今天"
          : r._fromAsOf ? "已帶入截圖基準日"
          : r.dateAssumed === "missing" ? "缺少日期，請補填或確認截圖基準日"
          : r.dateAssumed === "mdy" ? "日期格式待確認（月/日或日/月）"
          : r.dateAssumed === "invalid" ? `截圖日期無效（${r.rawDate || "格式錯誤"}）`
          : "";
        dTag.textContent = t;
        dTag.hidden = !t;
      }
      const dWrap = tr.querySelector(`[data-lgimp-dwrap="${r._uid}"]`);
      if (dWrap) {
        const showDfix = r.dateAssumed === "mdy" && !!r.altDate;
        dWrap.hidden = !showDfix;
        if (showDfix) {
          const okBtn = dWrap.querySelector("[data-lgimp-dok]"), flipBtn = dWrap.querySelector("[data-lgimp-dflip]");
          if (okBtn) okBtn.textContent = `採月/日 ${r.date}`;
          if (flipBtn) flipBtn.textContent = `改日/月 ${r.altDate}`;
        }
      }
      const upBtn = tr.querySelector('[data-lgimp-mv="-1"]'), dnBtn = tr.querySelector('[data-lgimp-mv="1"]');
      if (upBtn) { upBtn.disabled = i === 0; upBtn.setAttribute("aria-label", `上移第 ${i + 1} 列`); }
      if (dnBtn) { dnBtn.disabled = i >= S.rows.length - 1; dnBtn.setAttribute("aria-label", `下移第 ${i + 1} 列`); }
      const wTag = tr.querySelector(`[data-lgimp-warn="${r._uid}"]`);
      if (wTag) {
        const w = (item?.warnings || []).filter(x => x.code !== "fee_estimated").map(x => x.message).join("；");
        wTag.textContent = w ? "⚠︎ " + w : "";
        wTag.hidden = !w;
      }
    }
    const metaEl = tr.querySelector(`[data-lgimp-meta="${r._uid}"]`);
    if (metaEl) {
      const parts = [];
      if (r._lookingUp) parts.push("查詢代號中…");
      else {
        if (r.code) parts.push(lgStockName(r.code, r.name) || r.code);
        if (isHold) {
          if (item?.duplicateOpen) parts.push(`帳本已有 ${lgN(item.existingShares)} 股`);
          else if (r.how && r.how !== "截圖上的股數與成本") parts.push(r.how);
        } else {
          if (item?.on && !item?.errors?.length && (r.side === "buy" || r.side === "sell") && item?.computed?.feeEstimated) {
            const est = [r.fee == null ? `手續費估 ${lgN(item.computed.fee)}` : "", r.side === "sell" && r.tax == null ? `稅估 ${lgN(item.computed.tax)}` : ""].filter(Boolean).join("・");
            if (est) parts.push(est);
          }
          if (r.marginType) parts.push("Level 2・融資／融券已隔離");
          else if (item?.reconcileHint === "pre_snapshot") parts.push("Level 1・快照前歷史");
          else if (item?.reconcileHint === "same_day_order") parts.push("Level 2・同日順序待釐清");
          else if (item?.reconcileHint === "post_snapshot") parts.push("Level 1・快照後交易");
        }
      }
      const mTxt = parts.join("・");
      metaEl.textContent = mTxt;
      metaEl.hidden = !mTxt;
      const codeInp = tr.querySelector('[data-lgimp-k="code"]');
      if (codeInp) {
        const desc = [];
        if (rowShownErrs.some(x => x.k === "code")) desc.push(`lgie-${r._uid}-code`);
        if (mTxt) desc.push(metaEl.id);
        if (desc.length) codeInp.setAttribute("aria-describedby", desc.join(" "));
        else codeInp.removeAttribute("aria-describedby");
      }
    }
    const hasWarn = !rowShownErrs.length && ((item?.warnings || []).some(w => w.code !== "fee_estimated") || item?.planItem?.level === 2 || item?.reconcileHint === "same_day_order");
    tr.classList.toggle("bad", rowShownErrs.length > 0);
    tr.classList.toggle("warn", hasWarn);
    tr.classList.toggle("skip-existing", !item?.on);
  }
  const asOfMsgEl = $("#lgImpAsOfMsg");
  if (asOfMsgEl) {
    const asOfValid = /^\d{4}-\d{2}-\d{2}$/.test(S.asOf || "") && S.asOf <= today;
    asOfMsgEl.innerHTML = S.asOfConfirmed && asOfValid
      ? `基準日已確認：<b>${esc(S.asOf)}</b>`
      : S.asOfStatus === "year"
        ? `截圖顯示「${esc(S.rawAsOf || S.asOf || "")}」，系統暫推為 <b>${esc(S.asOf || "")}</b>（缺年份，確認前不設為已確認快照）`
        : S.asOfStatus === "future" || (S.asOf && S.asOf > today)
          ? `截圖日期「${esc(S.rawAsOf || S.asOf || "")}」晚於今日（${today}），請修正或確認基準日`
          : S.asOfStatus === "mdy"
            ? `截圖日期「${esc(S.rawAsOf || S.asOf || "")}」格式待確認（月/日 ${esc(S.asOf || "")} 或日/月 ${esc(S.altDate || "")}）`
            : `截圖未含明確基準日期${S.rawAsOf ? `（${esc(S.rawAsOf)}）` : ""}，請補填並確認基準日（未確認前將進待對帳）`;
  }
  const fullWarnEl = $("#lgImpFullWarn");
  if (fullWarnEl && isHold) {
    const present = new Set(S.rows.filter(r => r.on !== false && !r.marginType && r.code).map(r => r.code));
    const asOfValid = /^\d{4}-\d{2}-\d{2}$/.test(S.asOf || "") && S.asOf <= today;
    const omitted = typeof KLRecon !== "undefined"
      ? [...KLRecon.activeBaselines(recon).values()].filter(b => b.shares > 1e-9 && !present.has(b.symbol) && (!asOfValid || b.date < S.asOf)).map(b => `${b.symbol}(${lgN(b.shares)}股)`)
      : [];
    const show = S.snapshotScope === "full" && omitted.length > 0;
    fullWarnEl.textContent = show ? `未列於此完整截圖的原持股（將結案或進入清倉核對）：${omitted.join("、")}` : "";
    fullWarnEl.hidden = !show;
  }
  const revBtn = form.querySelector("[data-lgimp-rev]");
  if (revBtn) revBtn.disabled = S.rows.length < 2;
  const amb = P.ambiguousSameDay || [];
  const orderSig = isHold ? "" : amb.map(g => `${g.date}|${g.symbol}|` + g.rowIndices.map(idx => {
    const rr = S.rows[idx];
    return [rr?._uid, rr?.side, rr?.shares, rr?.price, rr?.time, g.affectsFifo ? "fifo" : ""].join(":");
  }).join(",")).join(";");
  const orderChanged = S.orderSig !== orderSig;
  if (orderChanged) {
    S.orderSig = orderSig;
    S.orderOk = false;
  }
  const ordWrap = $("#lgImpOrderWrap"), ordEl = $("#lgImpOrderOk"), ordTxt = $("#lgImpOrderTxt");
  if (ordWrap && ordEl && ordTxt) {
    ordWrap.hidden = amb.length === 0;
    if (amb.length > 0) {
      const syms = amb.map(g => {
        const reasons = [];
        if (g.affectsOversell) reasons.push("顛倒將賣超");
        if (g.affectsFifo) reasons.push("FIFO 批次先後影響成本／損益");
        return `${g.date} ${g.symbol}${reasons.length ? "（" + reasons.join("；") + "）" : ""}`;
      }).join("、");
      const reason = amb.some(g => g.affectsFifo)
        ? "同日交易順序缺乏可驗證成交時間，FIFO 批次先後可能改變成本與已實現損益"
        : "同日買賣未附可驗證時間（或同分鐘重疊）";
      ordTxt.textContent = `${syms}：${reason}。請用 ↑↓／反轉按鈕確認列序，或補填成交時間；確認目前順序正確請勾選後再匯入。`;
      if (ordEl.checked !== S.orderOk) ordEl.checked = S.orderOk;
      if (S.orderOk || orderChanged) ordEl.setAttribute("aria-invalid", "false");
    } else {
      ordEl.checked = false;
      ordEl.setAttribute("aria-invalid", "false");
    }
  }
  const dupWrap = $("#lgImpDupWrap"), dupEl = $("#lgImpDup"), dupTxt = $("#lgImpDupTxt");
  const dupSig = (P.duplicates || []).map(it => [it.tx.date, it.tx.type, it.tx.symbol, it.tx.shares, it.tx.price].join("|")).sort().join(";");
  const dupChanged = S.dupSig !== dupSig;
  if (dupChanged) {
    S.dupSig = dupSig;
    if (!dupSig) S.dupOk = false;
  }
  if (dupWrap && dupEl && dupTxt) {
    const nDup = (P.duplicates || []).length;
    dupWrap.hidden = nDup === 0;
    if (nDup > 0) {
      const syms = [...new Set(P.duplicates.map(it => it.tx.symbol).filter(Boolean))].join("、");
      dupTxt.textContent = `偵測到 ${nDup} 筆可能與帳本重複的交易（${syms}）。若確認不是重複匯入，請勾選確認後再儲存。`;
      if (dupEl.checked !== S.dupOk) dupEl.checked = S.dupOk;
      if (S.dupOk || dupChanged) dupEl.setAttribute("aria-invalid", "false");
    } else {
      dupEl.checked = false;
      dupEl.setAttribute("aria-invalid", "false");
    }
  }
  const globalErr = $("#lgImpGlobalErr");
  if (globalErr) {
    if (P.newErrors?.length) {
      const msgs = P.newErrors.map(x => `${x.date || ""} ${x.symbol || ""}：${x.errors?.[0]?.message || "出錯"}`).join("；");
      globalErr.textContent = `⚠︎ 匯入後會讓帳本既有的交易出錯（${msgs}），請調整日期或股數。`;
      globalErr.hidden = false;
    } else {
      globalErr.textContent = "";
      globalErr.hidden = true;
    }
  }
  const sumEl = $("#lgImpSum");
  if (sumEl) {
    const ex = lgLoad();
    const mNote = ex ? ` 沿用帳本「${KLLedger.METHODS[ex.method] || ex.method}」。` : "";
    if (isHold) {
      const pi = P.plan?.items || [];
      const l1 = pi.filter(x => x.level === 1).length;
      const l2 = pi.filter(x => x.level === 2).length + (P.plan?.closures || []).filter(c => c.level === 2).length;
      const l3 = P.errorCount + pi.filter(x => x.level === 3 && !P.items[x.rowIndex]?.errors?.length).length;
      sumEl.textContent = `共 ${S.rows.length} 列（範圍：${S.snapshotScope === "full" ? "完整清單" : "部分截圖"}）：預計自動確認 ${l1} 筆、待對帳／隔離 ${l2} 筆、阻擋錯誤 ${l3} 筆；不會改動舊庫存或寫入 transfer_in。${mNote}`;
    } else {
      sumEl.textContent = `共 ${S.rows.length} 列，將匯入 ${P.selectedCount} 筆成交交易（依日期／時間排序，無時間之同日交易依目前列序套用）${P.feeEstimatedCount ? `；${P.feeEstimatedCount} 筆空白費用依設定費率${lgDiscText()}估算` : ""}。${mNote}`;
    }
  }
  const saveBtn = $("#lgImpSave");
  if (saveBtn) {
    saveBtn.disabled = !!S.busy;
    saveBtn.textContent = S.busy ? "確認代號中…" : (isHold ? `儲存對帳快照（${P.selectedCount} 檔）` : `匯入 ${P.selectedCount} 筆交易`);
  }
  if (opts.announceRow != null && opts.announceKey) {
    const idx = S.rows.findIndex(r => String(r._uid) === String(opts.announceRow));
    if (idx >= 0) {
      const it = P.items[idx], fe = it?.on ? lgImpFieldErrors(S.kind, it.errors) : new Map();
      const hit = fe.get(opts.announceKey);
      if (hit) impSetLive("⚠︎ " + lgImpErrMsg(hit, S.rows[idx]), "err");
      else lgClearStaleImpLive(P);
    }
  }
  return P;
}
function lgOpenImport() {
  if (typeof loadStocks === "function") loadStocks().catch(() => {});
  const S = (W.lgImp = {
    step: "choose", kind: null, detectedKind: null, rows: [],
    method: lgLoad()?.method || "avg", busy: false,
    dupOk: false, dupSig: "", orderOk: false, orderSig: "",
    asOf: "", asOfStatus: null, altDate: "", rawAsOf: "", asOfConfirmed: false,
    snapshotScope: "partial", fileHashes: [],
    blurred: new Set(), edited: new Set(), saveTok: (W.lgImp?.saveTok || 0) + 1
  });
  impSetLive("");
  showImpDialog("截圖匯入與對帳", lgImpChooseHtml(), { wide: false, scope: "ledger", focus: "[data-lgimp-upload]", forceFocus: true });
  return S;
}
function lgOnImportBusy(count, mode) {
  const S = lgImpState();
  S.step = "busy";
  S.kind = mode === "trades" ? "trades" : mode === "holdings" ? "holdings" : S.kind;
  S.busy = true;
  impSetLive("");
  const lbl = S.kind === "trades" ? "成交明細／對帳單" : S.kind === "holdings" ? "庫存／持股" : "券商";
  const html = `<progress max="100"></progress><p class="note">正在讀取 ${count} 張${lbl}截圖並自動辨識類型與日期…（AI 讀圖約需 10～30 秒）</p>
    <div class="row2"><button type="button" class="btn sm" data-ic="close">取消</button></div>`;
  showImpDialog("自動辨識券商截圖", html, { wide: false, scope: "ledger", focus: '#impBody [data-ic="close"]', forceFocus: true });
}
function lgApplyAsOfToTrades(S) {
  if (!S || S.kind !== "trades" || !S.asOfConfirmed || !S.asOf) return;
  for (const r of S.rows) {
    if (r.dateAssumed === "missing" || r._fromAsOf || (!r.date && r.dateAssumed !== "invalid")) {
      r.date = S.asOf;
      r.dateAssumed = null;
      r._fromAsOf = true;
      const inp = $("#lgImpTbody")?.querySelector(`tr[data-uid="${r._uid}"] [data-lgimp-k="date"]`);
      if (inp && inp.value !== r.date) inp.value = r.date;
    }
  }
}
function lgSwitchKind(nextKind) {
  const S = lgImpState(), target = nextKind === "trades" ? "trades" : "holdings";
  if (S.kind === target) return;
  S.kind = target;
  S.rows = S.rows.map(r => {
    const raw = {
      ...(r._raw || {}),
      code: r.code || r.badSym || r._raw?.code,
      name: r.name || r._raw?.name,
      marginType: r.marginType ?? r._raw?.marginType,
      shares: r.sh ?? r.shares ?? r._raw?.shares,
      avgCost: r.cost ?? r.price ?? r._raw?.avgCost,
      price: r.price ?? r.cost ?? r._raw?.price,
      date: r.date || r.d || r._raw?.date || "",
      dateAssumed: r.dateAssumed ?? r._raw?.dateAssumed,
    };
    return target === "holdings" ? lgDeriveHoldingRow(raw) : lgMapTradeRow(raw);
  });
  if (target === "trades") lgApplyAsOfToTrades(S);
  S.blurred.clear(); S.edited.clear(); S.dupOk = false; S.dupSig = ""; S.orderOk = false; S.orderSig = "";
  const P = lgPrepare(S);
  lgImpSeedErrors(S, P);
  impSetLive("");
  showImpDialog(target === "trades" ? "核對成交明細匯入" : "核對庫存快照與對帳", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: false });
  lgSyncImportUI();
}
function lgOnImportRows(rows, detectedKind, meta = {}) {
  const S = lgImpState(), today = lgToday();
  const det = detectedKind === "holdings" || detectedKind === "trades" ? detectedKind : "unknown";
  const inferred = det !== "unknown"
    ? det
    : ((Array.isArray(rows) ? rows : []).some(r => r && (r.side === "buy" || r.side === "sell" || r.type === "buy" || r.type === "sell")) ? "trades" : "holdings");
  const appendingSameKind = S.step === "busy" && S.rows.length > 0 && S.kind;
  const kind = appendingSameKind && det === "unknown" ? S.kind : inferred;
  const prevRows = S.kind === kind ? S.rows : [];
  S.detectedKind = det;
  S.kind = kind; S.step = "review"; S.busy = false;
  const inAsOf = typeof meta?.asOf === "string" ? meta.asOf.trim() : "";
  const inStatus = meta?.asOfStatus || (/^\d{4}-\d{2}-\d{2}$/.test(inAsOf) ? (inAsOf > today ? "future" : "exact") : "missing");
  if (!prevRows.length || inAsOf) {
    S.asOf = inAsOf;
    S.asOfStatus = inStatus;
    S.altDate = typeof meta?.altDate === "string" ? meta.altDate.trim() : "";
    S.rawAsOf = typeof meta?.rawAsOf === "string" ? meta.rawAsOf.trim() : "";
    S.asOfConfirmed = inStatus === "exact" && /^\d{4}-\d{2}-\d{2}$/.test(inAsOf) && inAsOf <= today;
  }
  if (!prevRows.length) S.snapshotScope = "partial";
  if (Array.isArray(meta?.fileHashes) && meta.fileHashes.length) {
    S.fileHashes = [...new Set([...(S.fileHashes || []), ...meta.fileHashes])];
  }
  if (kind === "holdings") {
    const incoming = (Array.isArray(rows) ? rows : []).map(lgDeriveHoldingRow);
    const merged = prevRows.slice();
    for (const x of incoming) {
      const idx = merged.findIndex(y => (x.code && y.code === x.code) || (x.badSym && y.badSym === x.badSym) || (!x.code && !x.badSym && y.name === x.name));
      if (idx >= 0) {
        const p = merged[idx];
        merged[idx] = {
          ...p,
          code: x.code || p.code, badSym: x.code ? "" : (x.badSym || p.badSym), name: x.name || p.name,
          marginType: x.marginType || p.marginType || null,
          sh: x.sh != null ? x.sh : p.sh, cost: x.cost != null ? x.cost : p.cost,
          d: p.dTouched ? p.d : (x.d || p.d), dTouched: p.dTouched || x.dTouched,
          how: x.how || p.how, on: p.marginType ? false : p.on, verifyErr: null, _fresh: false
        };
      } else merged.push(x);
    }
    S.rows = merged;
  } else {
    S.rows = [...prevRows, ...(Array.isArray(rows) ? rows : []).map(lgMapTradeRow)];
    lgApplyAsOfToTrades(S);
  }
  const P = lgPrepare(S);
  lgImpSeedErrors(S, P);
  impSetLive("");
  showImpDialog(kind === "trades" ? "核對成交明細匯入" : "核對庫存快照與對帳", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: false });
  lgSyncImportUI();
  const invFocus = $('#impBody [aria-invalid="true"]');
  const initFocus = invFocus || $('#impBody input.code') || $('#lgImpSave');
  if (invFocus) {
    try { invFocus.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch {}
  } else {
    const wrap = $("#impBody .hg-wrap");
    if (wrap) wrap.scrollLeft = 0;
  }
  initFocus?.focus?.({ preventScroll: true });
}
function lgOnImportErr(msg) {
  const S = lgImpState();
  S.busy = false;
  const errTxt = msg || "讀圖失敗，請稍後再試";
  if (S.rows.length > 0 && S.kind) {
    S.step = "review";
    const P = lgPrepare(S);
    showImpDialog(S.kind === "trades" ? "核對成交明細匯入" : "核對庫存快照與對帳", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: false });
    lgSyncImportUI();
    $("#lgImpSave")?.focus?.({ preventScroll: true });
    impSetLive("⚠︎ " + errTxt + "（已保留原本資料）", "err");
    return;
  }
  S.step = "err";
  const html = `<p class="note">可以重新上傳清楚一點的截圖，或改用手動表格輸入。</p>
    <div class="row2">
      <button type="button" class="btn primary sm" data-lgimp-retry>重新上傳截圖</button>
      <button type="button" class="btn sm" data-lgimp-blank>改用手動表格輸入</button>
      <button type="button" class="btn sm" data-ic="close">關閉</button>
    </div>`;
  showImpDialog("截圖匯入失敗", html, { wide: false, scope: "ledger", focus: "[data-lgimp-retry]", forceFocus: true });
  impSetLive("⚠︎ " + errTxt, "err");
}
function lgImpReadNum(el) {
  if (!el) return null;
  if (el.validity?.badInput) return NaN;
  const s = String(el.value ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function lgClearStaleImpLive(P) {
  const liveEl = $("#impLive");
  if (!liveEl || liveEl.hidden) return;
  const liveTxt = liveEl.textContent || "";
  if ((!$('#lgImpForm [aria-invalid="true"]') && !P?.newErrors?.length && !P?.sameDayOversell) ||
      (!P?.sameDayOversell && /先賣後買造成賣超/.test(liveTxt)) ||
      (!P?.needsOrderConfirm && /同日買賣未附成交時間|FIFO 模式下/.test(liveTxt)) ||
      (!P?.duplicates?.length && /重複的交易/.test(liveTxt)) ||
      ((P?.selectedCount ?? 0) > 0 && /請至少勾選一列/.test(liveTxt))) {
    impSetLive("");
  }
}
function lgOnImportInput(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review") return;
  if (t.matches("[data-lgimp-asof]")) {
    const v = String(t.value || "").trim(), today = lgToday();
    S.asOf = v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) {
      S.asOfStatus = "exact";
      S.asOfConfirmed = true;
      lgApplyAsOfToTrades(S);
    } else {
      S.asOfStatus = v && v > today ? "future" : "missing";
      S.asOfConfirmed = false;
    }
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  if (t.type === "checkbox" || t.type === "radio" || t.tagName === "SELECT") return;
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  const r = S.rows.find(x => String(x._uid) === String(uid));
  if (!r) return;
  r._fresh = false;
  S.edited.add(`${uid}:${k}`);
  S.blurred.delete(`${uid}:${k}`);
  if (k === "code") {
    const res = lgResolveCodeInput(t.value, "");
    r.code = res.code; r.badSym = res.badSym; r.name = res.name; r.verifyErr = null;
  } else if (k === "d") {
    if (t.value) { r.d = t.value; r.dTouched = true; } else { r.d = ""; r.dTouched = false; }
  } else if (k === "date") {
    r.date = t.value; r.dateAssumed = null; r._fromAsOf = false; r.altDate = ""; r.rawDate = "";
  } else if (k === "time") {
    r.time = t.value;
  } else if (k === "note") {
    r.note = String(t.value || "").trim();
  } else if (["sh", "cost", "shares", "price", "fee", "tax"].includes(k)) {
    r[k] = lgImpReadNum(t);
  }
  lgClearStaleImpLive(lgSyncImportUI());
}
function lgOnImportChange(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review") return;
  if (t.matches("[data-lgimp-scope]")) {
    S.snapshotScope = t.value === "full" ? "full" : "partial";
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  if (t.matches("[data-lgimp-asof]")) {
    const v = String(t.value || "").trim(), today = lgToday();
    S.asOf = v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) {
      S.asOfStatus = "exact";
      S.asOfConfirmed = true;
      lgApplyAsOfToTrades(S);
    } else {
      S.asOfStatus = v && v > today ? "future" : "missing";
      S.asOfConfirmed = false;
    }
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  if (t.matches("[data-lgimp-method]")) { S.method = t.value === "fifo" ? "fifo" : "avg"; lgClearStaleImpLive(lgSyncImportUI()); return; }
  if (t.matches("[data-lgimp-orderok]")) { S.orderOk = !!t.checked; if (S.orderOk && !$("#impLive")?.hidden) impSetLive(""); lgSyncImportUI(); return; }
  if (t.matches("[data-lgimp-dup]")) { S.dupOk = !!t.checked; if (S.dupOk && !$("#impLive")?.hidden) impSetLive(""); lgSyncImportUI(); return; }
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  const r = S.rows.find(x => String(x._uid) === String(uid));
  if (!r) return;
  if (k === "on") {
    if (r.marginType) return;
    r.on = !!t.checked;
    if (!r.on) r.verifyErr = null;
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  if (k === "dayTrade") {
    r.dayTrade = r.side === "sell" && !!t.checked;
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  if (k === "side") {
    r.side = t.value;
    if (r.side !== "sell") r.dayTrade = false;
    r._fresh = false;
    S.edited.add(`${uid}:side`);
    S.blurred.add(`${uid}:side`);
    lgSyncImportUI({ announceRow: uid, announceKey: "side" });
    return;
  }
  if (k === "date" || k === "d" || k === "time") {
    r._fresh = false;
    S.edited.add(`${uid}:${k}`);
    S.blurred.add(`${uid}:${k}`);
    lgSyncImportUI({ announceRow: uid, announceKey: k });
    return;
  }
  if (k === "code") {
    const v = t.value.trim();
    const res = lgResolveCodeInput(v, "");
    r.code = res.code; r.badSym = res.badSym; r.name = res.name; r.verifyErr = null;
    if (res.code && document.activeElement !== t) t.value = res.code;
    if (!res.code && !res.badSym && v && !W.off && typeof lookupCode === "function") {
      r._lookingUp = true;
      const seq = ++r._lookupSeq;
      lgSyncImportUI();
      lookupCode(v).then(x => {
        if ($("#impSheet")?.hidden || r._lookupSeq !== seq || !S.rows.includes(r)) return;
        r._lookingUp = false;
        const nc = x ? normImpCode(x) : "";
        if (nc && okImpCode(nc)) {
          r.code = nc; r.badSym = ""; r.name = lgStockName(nc, v); r.verifyErr = null;
          if (document.activeElement !== t) t.value = nc;
        }
        lgClearStaleImpLive(lgSyncImportUI());
      }, () => {
        if ($("#impSheet")?.hidden || r._lookupSeq !== seq || !S.rows.includes(r)) return;
        r._lookingUp = false;
        lgClearStaleImpLive(lgSyncImportUI());
      });
      return;
    }
    lgClearStaleImpLive(lgSyncImportUI());
  }
}
function lgOnImportBlur(e) {
  const S = lgImpState(), t = e.target;
  if (S.step !== "review" || $("#impSheet")?.hidden || e.relatedTarget?.closest?.("#lgImpSave,[data-lgimp-del],[data-ic],[data-lgimp-dok],[data-lgimp-dflip],[data-lgimp-mv],[data-lgimp-rev],[data-lgimp-asof-ok],[data-lgimp-switch]")) return;
  const uid = t.dataset?.lgimpUid, k = t.dataset?.lgimpK;
  if (!uid || !k) return;
  if (S.edited.has(`${uid}:${k}`) || S.blurred.has(`${uid}:${k}`)) {
    const already = S.blurred.has(`${uid}:${k}`);
    S.blurred.add(`${uid}:${k}`);
    lgSyncImportUI(already ? {} : { announceRow: uid, announceKey: k });
  }
}
function lgOnImportClick(e) {
  const S = lgImpState(), t = e.target;
  if (t.closest("[data-lgimp-upload]")) { $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-retry]")) { $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-conflicts]")) {
    if (typeof closeImport === "function") closeImport();
    const L = (W.lg ||= {});
    L.view = "tx"; L.form = null; renderList();
    setTimeout(() => document.querySelector(".lgrecon-center")?.scrollIntoView?.({ block: "nearest" }), 30);
    return;
  }
  const sw = t.closest("[data-lgimp-switch]");
  if (sw && S.step === "review") {
    lgSwitchKind(sw.dataset.lgimpSwitch);
    return;
  }
  if (t.closest("[data-lgimp-asof-ok]") && S.step === "review") {
    const inp = $("#lgImpForm [data-lgimp-asof]");
    const v = String(inp?.value || S.asOf || "").trim(), today = lgToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > today) {
      S.asOfConfirmed = false;
      impSetLive(v > today ? `⚠︎ 基準日「${v}」晚於今日（${today}），不可確認為有效基準日。` : "⚠︎ 請先填入正確 YYYY-MM-DD 基準日期再按確認。", "err");
      inp?.focus?.();
      lgSyncImportUI();
      return;
    }
    S.asOf = v; S.asOfStatus = "exact"; S.asOfConfirmed = true;
    lgApplyAsOfToTrades(S);
    impSetLive("");
    lgSyncImportUI();
    return;
  }
  const asofFlip = t.closest("[data-lgimp-asof-flip]");
  if (asofFlip && S.step === "review") {
    const v = asofFlip.dataset.lgimpAsofFlip, today = lgToday();
    S.asOf = v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) { S.asOfStatus = "exact"; S.asOfConfirmed = true; lgApplyAsOfToTrades(S); }
    const inp = $("#lgImpForm [data-lgimp-asof]");
    if (inp) inp.value = v;
    lgSyncImportUI();
    return;
  }
  if (t.closest("[data-lgimp-blank]")) {
    const kind = S.kind || "trades";
    S.kind = kind; S.detectedKind = kind; S.step = "review"; S.busy = false; S.dupOk = false; S.dupSig = ""; S.orderOk = false; S.orderSig = ""; S.blurred.clear(); S.edited.clear();
    S.asOf = lgToday(); S.asOfStatus = "exact"; S.asOfConfirmed = true; S.snapshotScope = "partial";
    S.rows = [lgNewBlankRow(kind)];
    const P = lgPrepare(S);
    impSetLive("");
    showImpDialog(kind === "trades" ? "核對成交明細匯入" : "核對庫存快照與對帳", lgImpReviewHtml(S, P), { wide: true, scope: "ledger", focus: '#lgImpTbody input[data-lgimp-k="code"]', forceFocus: true });
    lgSyncImportUI();
    return;
  }
  if (t.closest("[data-lgimp-shot]")) { $("#impFile")?.click(); return; }
  if (t.closest("[data-lgimp-rev]") && S.step === "review" && S.kind === "trades" && S.rows.length > 1) {
    S.rows.reverse();
    const tbody = $("#lgImpTbody");
    if (tbody) {
      const byUid = new Map([...tbody.querySelectorAll("tr[data-uid]")].map(tr => [tr.dataset.uid, tr]));
      for (const r of S.rows) {
        const rowEl = byUid.get(String(r._uid));
        if (rowEl) tbody.appendChild(rowEl);
      }
    }
    lgClearStaleImpLive(lgSyncImportUI());
    return;
  }
  const dok = t.closest("[data-lgimp-dok]"), dflip = t.closest("[data-lgimp-dflip]");
  if ((dok || dflip) && S.step === "review") {
    const uid = (dok || dflip).dataset[dok ? "lgimpDok" : "lgimpDflip"];
    const r = S.rows.find(x => String(x._uid) === String(uid));
    if (!r) return;
    if (dflip && r.altDate) r.date = r.altDate;
    r.dateAssumed = null; r._fromAsOf = false; r.altDate = ""; r.rawDate = ""; r._fresh = false;
    S.edited.add(`${uid}:date`);
    S.blurred.add(`${uid}:date`);
    const inp = $("#lgImpTbody")?.querySelector(`tr[data-uid="${uid}"] [data-lgimp-k="date"]`);
    if (inp && inp.value !== r.date) inp.value = r.date;
    lgSyncImportUI({ announceRow: uid, announceKey: "date" });
    try { inp?.focus({ preventScroll: true }); } catch {}
    return;
  }
  const mv = t.closest("[data-lgimp-mv]");
  if (mv && S.step === "review" && S.kind === "trades") {
    const uid = mv.dataset.lgimpUid, dir = +mv.dataset.lgimpMv;
    const idx = S.rows.findIndex(x => String(x._uid) === String(uid)), targetIdx = idx + dir;
    if (idx < 0 || targetIdx < 0 || targetIdx >= S.rows.length) return;
    [S.rows[idx], S.rows[targetIdx]] = [S.rows[targetIdx], S.rows[idx]];
    const tbody = $("#lgImpTbody");
    const tr = tbody?.querySelector(`tr[data-uid="${uid}"]`);
    const targetTr = tbody?.querySelector(`tr[data-uid="${S.rows[idx]._uid}"]`);
    if (tr && targetTr) {
      if (dir < 0) targetTr.before(tr);
      else targetTr.after(tr);
    }
    lgClearStaleImpLive(lgSyncImportUI());
    const keep = tr?.querySelector(`[data-lgimp-mv="${dir}"]`);
    const fb = keep && !keep.disabled ? keep : tr?.querySelector(`[data-lgimp-mv="${-dir}"]`);
    try { fb?.focus({ preventScroll: true }); } catch {}
    return;
  }
  if (t.closest("[data-lgimp-add]")) {
    if (S.step !== "review") return;
    const r = lgNewBlankRow(S.kind);
    const idx = S.rows.length;
    S.rows.push(r);
    const tbody = $("#lgImpTbody");
    if (tbody) {
      tbody.insertAdjacentHTML("beforeend", lgImpRowHtml(r, idx, S.kind, null, lgToday(), S.rows.length));
      lgSyncImportUI();
      tbody.querySelector(`tr[data-uid="${r._uid}"] input[data-lgimp-k="code"]`)?.focus();
    }
    return;
  }
  const del = t.closest("[data-lgimp-del]");
  if (del && S.step === "review") {
    const uid = del.dataset.lgimpDel, idx = S.rows.findIndex(x => String(x._uid) === String(uid));
    if (idx < 0) return;
    S.rows.splice(idx, 1);
    for (const key of [...S.blurred]) if (key.startsWith(`${uid}:`)) S.blurred.delete(key);
    for (const key of [...S.edited]) if (key.startsWith(`${uid}:`)) S.edited.delete(key);
    const tr = $("#lgImpTbody")?.querySelector(`tr[data-uid="${uid}"]`);
    const nextBtn = tr?.nextElementSibling?.querySelector("[data-lgimp-del]") || tr?.previousElementSibling?.querySelector("[data-lgimp-del]") || $("[data-lgimp-add]");
    tr?.remove();
    lgClearStaleImpLive(lgSyncImportUI());
    try { nextBtn?.focus({ preventScroll: true }); } catch {}
  }
}
async function lgSaveImport() {
  const S = lgImpState();
  if (S.step !== "review" || S.busy) return;
  const P0 = lgPrepare(S);
  const canFullZero = S.kind === "holdings" && S.snapshotScope === "full" && (P0.plan?.closures?.length || 0) > 0;
  if (P0.selectedCount === 0 && !canFullZero) {
    impSetLive("⚠︎ 請至少勾選一列要匯入的資料。", "err");
    try { ($('#lgImpTbody [data-lgimp-k="on"]') || $("[data-lgimp-add]"))?.focus({ preventScroll: true }); } catch {}
    return;
  }
  const myTok = ++S.saveTok;
  S.busy = true;
  const saveBtn = $("#lgImpSave");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "確認代號中…"; }
  try {
    if (!W.off && typeof loadStocks === "function") {
      await loadStocks().catch(() => {});
      if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
    }
    for (const r of S.rows) {
      if (r.on === false || r.marginType || r.code || r.badSym || !r.name) continue;
      if (typeof findCode === "function") {
        const fc = findCode(r.name, false);
        if (fc && okImpCode(fc)) { r.code = normImpCode(fc); r.name = lgStockName(r.code, r.name); r.verifyErr = null; continue; }
      }
      if (!W.off && typeof lookupCode === "function") {
        const c = await lookupCode(r.name);
        if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
        const nc = c ? normImpCode(c) : "";
        if (nc && okImpCode(nc)) {
          r.code = nc; r.name = lgStockName(nc, r.name); r.verifyErr = null;
          const inp = $("#lgImpTbody")?.querySelector(`tr[data-uid="${r._uid}"] [data-lgimp-k="code"]`);
          if (inp && document.activeElement !== inp) inp.value = nc;
        } else if (c && isBadImpSym(c)) {
          r.badSym = lgImpHalf(c).toUpperCase().replace(/\s+/g, "");
        }
      }
    }
    let P = lgPrepare(S);
    if (P.errorCount > 0 || (P.selectedCount === 0 && !(S.kind === "holdings" && S.snapshotScope === "full" && (P.plan?.closures?.length || 0) > 0))) {
      S.busy = false;
      for (const it of P.items) {
        const r = S.rows[it.index];
        if (!r || !it.on) continue;
        for (const e of it.errors) S.blurred.add(`${r._uid}:${lgImpErrField(S.kind, e.code)}`);
      }
      lgSyncImportUI();
      const firstErr = P.newErrors?.length
        ? "匯入後會讓帳本既有的交易出錯，請先調整。"
        : P.sameDayOversell
          ? "同天有多筆買賣未附成交時間，按目前順序會先賣後買造成賣超；請補填時間，或用 ↑↓／反轉按鈕調整順序。"
          : "有欄位格式或數字不對（例如賣超、跨市場衝突、異常日期或缺少代號），請修正標記的欄位後再試。";
      impSetLive("⚠︎ " + firstErr, "err");
      const firstInv = $('#lgImpForm [aria-invalid="true"]');
      try { firstInv?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch {}
      try { firstInv?.focus({ preventScroll: true }); } catch {}
      return;
    }
    if (!W.off && typeof verifyCodes === "function") {
      const codes = [...new Set(P.items.filter(it => it.on && S.rows[it.index]?.code).map(it => S.rows[it.index].code))];
      for (const r of S.rows) r.verifyErr = null;
      if (codes.length) {
        const wrong = await verifyCodes(codes);
        if (myTok !== S.saveTok || $("#impSheet")?.hidden) return;
        if (wrong && wrong.size > 0) {
          S.busy = false;
          for (const it of P.items) {
            const r = S.rows[it.index];
            if (it.on && r?.code && wrong.has(r.code)) {
              r.verifyErr = `查不到代號 ${r.code}，請確認是否為有效的台股或美股代號`;
              S.blurred.add(`${r._uid}:code`);
            }
          }
          lgSyncImportUI();
          impSetLive(`⚠︎ 查不到代號：${[...wrong].join("、")}，請修正後再匯入。`, "err");
          const firstInv = $('#lgImpForm [aria-invalid="true"]');
          try { firstInv?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch {}
          try { firstInv?.focus({ preventScroll: true }); } catch {}
          return;
        }
      }
    }
    if (S.kind === "holdings") {
      const res = await withPfCommitLock(() => {
        const rawRecon = lgRawGet(LG_RAW_RECON);
        const recon0 = lgParseRaw(rawRecon) || KLRecon.emptyStore();
        const pf0 = lgParseRaw(lgRawGet(LG_RAW_PF)) || { v: 1, method: S.method === "fifo" ? "fifo" : "avg", transactions: [] };
        const snapRows = S.rows.map(r => {
          const sym = r.code || r.badSym || "", m = sym && okImpCode(sym) ? lgMkt(sym) : null;
          return { on: r.on !== false, code: sym, name: r.name, market: m, currency: m ? (m === "us" ? "USD" : "TWD") : null, shares: r.sh, avgCost: r.cost, marginType: r.marginType || null, how: r.how };
        });
        const plan = KLRecon.planHoldingsSnapshot({
          store: recon0,
          txStore: pf0,
          ledgerLib: KLLedger,
          method: pf0.method || S.method || "avg",
          today: lgToday(),
          rows: snapRows,
          snapshotScope: S.snapshotScope === "full" ? "full" : "partial",
          asOf: S.asOf || null,
          asOfStatus: S.asOfStatus || (S.asOf ? "exact" : "missing"),
          asOfConfirmed: S.asOfConfirmed === true,
          rawAsOf: S.rawAsOf || "",
          altDate: S.altDate || "",
          fileHashes: S.fileHashes || [],
        });
        const applied = KLRecon.applyHoldingsImport(recon0, plan, { today: lgToday() });
        if (!applied.ok) return applied;
        const w = lgReconWrite(applied.store, { expectedRawRecon: rawRecon });
        return w.ok ? { ok: true, applied, store: w.store } : w;
      });
      if (!res.ok) {
        S.busy = false;
        lgSyncImportUI();
        impSetLive("✕ " + (res.errors?.[0] || res.code || "寫入對帳快照失敗"), "err");
        return;
      }
      const { appliedCount, conflictCount } = res.applied;
      const msg = `已儲存對帳快照（確認 ${appliedCount} 檔${conflictCount ? `，待對帳／確認 ${conflictCount} 項` : ""}；未改動舊庫存）。`;
      S.busy = false;
      W.lg = { ...(W.lg || {}), view: "tx", prev: null, form: null, msg };
      if (typeof pfExpire === "function") pfExpire();
      closeImport();
      renderList();
      const impBtn = document.querySelector('#lx [data-lg="imp"]');
      if (document.activeElement === document.body && impBtn?.isConnected) {
        try { impBtn.focus({ preventScroll: true }); } catch {}
      }
      return;
    }

    if (P.needsOrderConfirm) {
      S.busy = false;
      lgSyncImportUI();
      const fifoOrder = P.ambiguousSameDay?.some(g => g.affectsFifo);
      impSetLive(fifoOrder
        ? "⚠︎ FIFO 模式下，同日多筆同方向交易的批次順序會影響成本與損益；請確認列序或補填成交時間後再匯入。"
        : "⚠︎ 偵測到同日買賣未附成交時間，請確認由早到晚順序（或補填時間）後再匯入。", "err");
      const ordEl = $("#lgImpOrderOk");
      if (ordEl) {
        ordEl.setAttribute("aria-invalid", "true");
        try { (ordEl.closest("label") || ordEl).scrollIntoView?.({ block: "nearest" }); } catch {}
        try { ordEl.focus({ preventScroll: true }); } catch {}
      }
      return;
    }
    if (P.duplicates?.length > 0 && !S.dupOk) {
      S.busy = false;
      lgSyncImportUI();
      impSetLive("⚠︎ 偵測到可能與帳本重複的交易，請先勾選確認後再匯入。", "err");
      const dupEl = $("#lgImpDup");
      if (dupEl) {
        dupEl.setAttribute("aria-invalid", "true");
        try { (dupEl.closest("label") || dupEl).scrollIntoView?.({ block: "nearest" }); } catch {}
        try { dupEl.focus({ preventScroll: true }); } catch {}
      }
      return;
    }

    const res = await lgCommitDualStores({
      planFn: async (pf0, recon0) => {
        const Pchk = KLLedger.prepareTradesImport(
          S.rows.map(r => {
            const sym = r.code || r.badSym || "", m = sym && okImpCode(sym) ? lgMkt(sym) : null;
            return {
              on: r.marginType ? false : (r.on !== false),
              date: r.date ?? "",
              dateAssumed: r.dateAssumed || null,
              ...(r.altDate ? { altDate: r.altDate } : {}),
              ...(r.rawDate ? { rawDate: r.rawDate } : {}),
              time: r.time || "",
              side: r.side || "",
              symbol: sym,
              name: r.name,
              shares: r.shares,
              price: r.price,
              fee: r.fee,
              tax: r.tax,
              ...(m ? { assetType: lgAssetType(sym, m) } : {}),
              dayTrade: r.side === "sell" && !!r.dayTrade,
              note: r.note || "",
              source: "import"
            };
          }),
          pf0.transactions || [],
          { method: pf0?.transactions?.length || lgRawGet(LG_RAW_PF) ? (pf0.method || "avg") : (S.method === "fifo" ? "fifo" : "avg"), today: lgToday(), market: sym => (okImpCode(sym) ? lgMkt(sym) : null), rules: lgRules(), recon: recon0, orderConfirmed: S.orderOk === true }
        );
        if (!Pchk.ok) return { ok: false, code: "prepare_failed", errors: ["交易明細驗證未通過，請重新檢查欄位或順序"] };
        const txs = Pchk.transactions;
        const hasExistingPf = lgRawGet(LG_RAW_PF) != null;
        const nextPf = {
          v: 1,
          method: hasExistingPf ? (pf0.method || "avg") : (S.method === "fifo" ? "fifo" : "avg"),
          transactions: [...(pf0.transactions || []), ...txs],
          at: pf0.at || new Date().toISOString()
        };
        const at = new Date().toISOString();
        const batchId = "wal-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        const txHashes = Object.fromEntries(txs.map(t => [t.id, KLRecon.txFingerprint(t)]));
        const pfBaseHash = KLRecon.pfStoreHash(pf0);
        const pfNextHash = KLRecon.pfStoreHash(nextPf);
        const marginRows = S.rows.filter(r => !!r.marginType);
        const baselines = KLRecon.activeBaselines(recon0);
        const conflicts = [];
        for (const it of Pchk.items) {
          if (!it.on || it.errors.length || it.reconcileHint !== "same_day_order") continue;
          const tx = txs.find(x => x.id === it.tx.id) || it.tx;
          const base = baselines.get(tx.symbol);
          if (!base) continue;
          conflicts.push({
            id: `conf-sd-${batchId}-${tx.id}`,
            kind: "same_day_order",
            symbol: tx.symbol,
            market: tx.market,
            currency: tx.currency,
            batchId,
            snapshotId: base.id,
            previousSnapshotId: null,
            baselineShares: base.shares,
            baselineAvgCost: base.avgCost,
            targetShares: tx.shares,
            targetAvgCost: tx.price,
            diffShares: null,
            diffCost: null,
            txId: tx.id,
            status: "open",
            createdAt: at,
            message: `${tx.date} 同日交易 ${tx.symbol}（${KLLedger.TYPE_LABEL[tx.type] || tx.type} ${tx.shares} 股）尚未決定在快照前或快照後`,
            payload: { snapshotId: base.id, snapshotDate: base.date, txId: tx.id },
          });
        }
        const impRec = {
          id: batchId,
          at,
          kind: "trades",
          asOf: S.asOf || null,
          asOfStatus: S.asOfStatus || null,
          snapshotScope: null,
          fileHashes: Array.isArray(S.fileHashes) ? S.fileHashes.slice() : [],
          level1Count: Pchk.selectedCount - conflicts.length,
          level2Count: conflicts.length + marginRows.length,
          level3Count: Math.max(0, S.rows.length - Pchk.selectedCount - marginRows.length),
          rows: txs.map(t => ({ symbol: t.symbol, shares: t.shares, price: t.price, date: t.date, type: t.type })),
        };
        const audit = [{
          id: `aud-${batchId}`,
          at,
          action: "trades_imported",
          symbol: null,
          snapshotId: null,
          conflictId: null,
          txId: null,
          batchId,
          reason: `匯入 ${txs.length} 筆成交交易${conflicts.length ? `（含 ${conflicts.length} 筆同日順序待釐清）` : ""}`,
        }];
        return {
          ok: true,
          nextPf,
          txCount: txs.length,
          payload: { id: batchId, op: "import_trades", at, txs, txHashes, pfBaseHash, pfNextHash, staged: { imports: [impRec], conflicts, audit } },
        };
      }
    });
    if (!res.ok) {
      S.busy = false;
      lgSyncImportUI();
      impSetLive("✕ " + (res.errors?.[0] || res.code || "資料檢查未通過，沒有寫入"), "err");
      return;
    }
    const txCount = res.pfStore ? P.selectedCount : 0;
    const msg = `已匯入 ${txCount} 筆成交交易到交易紀錄。`;
    S.busy = false;
    W.lg = { ...(W.lg || {}), view: "tx", prev: null, form: null, msg };
    if (typeof pfExpire === "function") pfExpire();
    closeImport();
    renderList();
    const impBtn = document.querySelector('#lx [data-lg="imp"]');
    if (document.activeElement === document.body && impBtn?.isConnected) {
      try { impBtn.focus({ preventScroll: true }); } catch {}
    }
  } finally {
    if (myTok === S.saveTok && !$("#impSheet")?.hidden) {
      S.busy = false;
      lgSyncImportUI();
    }
  }
}
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target?.form?.id === "lgImpForm" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
});
