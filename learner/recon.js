/* 對帳與庫存快照引擎：管理 kline:pf:recon:v1、容量裁剪失敗契約（120KB）、
   快照／衝突規劃解決、期初 transfer_in 標記、同日順序與雙鍵 WAL 恢復協議。
   純函式：不直接讀寫 localStorage、不連網、嚴禁存圖片或超過 2000 字元 base64。
   瀏覽器為 window.KLRecon；Node 單元測試由 vm 載入。 */
(function (root) {
  "use strict";

  const VERSION = 1;
  const STORE_KEY = "kline:pf:recon:v1";
  const MAX_BYTES = 120000;
  const QTY_ABS_TOL = 1e-4;
  const QTY_REL_TOL = 1e-6;
  const COST_ABS_TOL = 0.5;
  const COST_REL_TOL = 0.005;
  const EPS = 1e-9;
  const CURRENCY = Object.freeze({ tw: "TWD", us: "USD" });
  const CONFLICT_KINDS = Object.freeze([
    "recon_diff", "missing_cost", "missing_date", "ambiguous_date",
    "same_day_order", "possible_duplicate", "negative_position",
    "unknown_symbol", "unknown_side", "margin_separated", "currency_conflict"
  ]);
  const WAL_OPS = new Set(["import_trades", "deactivate_tags", "update_tx_tag"]);

  const isPlain = v => !!v && typeof v === "object" && !Array.isArray(v);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const isPos = v => isNum(v) && v > EPS;
  const r2 = v => Math.round(v * 100) / 100;
  const deepClone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const validDate = v => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
  };
  const symbolOf = v => {
    const s = typeof v === "string" || typeof v === "number" ? String(v).trim().toUpperCase() : "";
    return s && s.length <= 16 && /^\^?[A-Z0-9][A-Z0-9.=_-]*$/.test(s) ? s : null;
  };
  const inferMarketOfSymbol = sym => {
    const s = symbolOf(sym);
    if (!s) return null;
    if (/^\d{4,6}[A-Z]?$/.test(s)) return "tw";
    if (/^[A-Z][A-Z0-9.-]{0,6}$/.test(s)) return "us";
    return null;
  };

  let _seq = 0;
  const makeId = (prefix, hint = "") => {
    _seq = (_seq + 1) % 1000000;
    const clean = String(hint || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 18);
    return clean ? `${prefix}-${clean}-${_seq}` : `${prefix}-${Date.now().toString(36)}-${_seq}`;
  };

  function emptyStore() {
    return {
      v: VERSION,
      snapshots: [],
      conflicts: [],
      initialTags: {},
      sameDayRelations: {},
      pendingCommit: null,
      imports: [],
      audit: [],
    };
  }

  function cloneStore(s) {
    if (!isPlain(s)) return emptyStore();
    const out = {
      v: s.v,
      snapshots: Array.isArray(s.snapshots) ? s.snapshots.map(x => {
        if (!isPlain(x)) return deepClone(x);
        const c = deepClone(x);
        if (c.symbol != null) c.symbol = symbolOf(c.symbol) || String(c.symbol).trim().toUpperCase();
        if (!c.scope) c.scope = "partial";
        if (!c.origin) c.origin = "import";
        return c;
      }) : [],
      conflicts: Array.isArray(s.conflicts) ? deepClone(s.conflicts) : [],
      initialTags: isPlain(s.initialTags) ? deepClone(s.initialTags) : {},
      sameDayRelations: isPlain(s.sameDayRelations) ? deepClone(s.sameDayRelations) : {},
      pendingCommit: s.pendingCommit == null ? null : deepClone(s.pendingCommit),
      imports: Array.isArray(s.imports) ? deepClone(s.imports) : [],
      audit: Array.isArray(s.audit) ? deepClone(s.audit) : [],
    };
    return out;
  }

  function scanNoImage(val, path = "root") {
    if (typeof val === "string") {
      if (/data:image\//i.test(val)) return { ok: false, code: "image_not_allowed", path, error: "對帳資料不可存放圖片資料" };
      if (val.length > 2000 && /^[A-Za-z0-9+/=_-]+$/.test(val)) {
        return { ok: false, code: "image_not_allowed", path, error: "對帳資料不可存放長編碼字串或圖片" };
      }
      return null;
    }
    if (!val || typeof val !== "object") return null;
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const bad = scanNoImage(val[i], `${path}[${i}]`);
        if (bad) return bad;
      }
    } else {
      for (const k of Object.keys(val)) {
        const bad = scanNoImage(val[k], `${path}.${k}`);
        if (bad) return bad;
      }
    }
    return null;
  }

  function validateStore(s, opts = {}) {
    if (!isPlain(s) || s.v !== VERSION) return { ok: false, code: "invalid_store", error: "對帳資料格式或版本不正確" };
    if (!Array.isArray(s.snapshots) || !Array.isArray(s.conflicts) || !Array.isArray(s.imports) || !Array.isArray(s.audit)) {
      return { ok: false, code: "invalid_store", error: "對帳資料欄位型別不正確" };
    }
    if (!isPlain(s.initialTags) || !isPlain(s.sameDayRelations)) {
      return { ok: false, code: "invalid_store", error: "對帳索引欄位格式不正確" };
    }
    const imgErr = scanNoImage(s);
    if (imgErr) return imgErr;

    if (s.pendingCommit != null) {
      if (opts.rejectPendingCommit) {
        return { ok: false, code: "unrecovered_pending_commit", error: "存在未完成的對帳提交紀錄，請先處理後再試" };
      }
      if (!isPlain(s.pendingCommit) || typeof s.pendingCommit.id !== "string" || !s.pendingCommit.id || typeof s.pendingCommit.op !== "string" || !s.pendingCommit.op) {
        return { ok: false, code: "invalid_wal_structure", error: "pendingCommit 結構不完整" };
      }
    }

    const refToday = opts.today && validDate(opts.today) ? opts.today : taipeiToday();
    const symMkt = new Map();

    for (const snap of s.snapshots) {
      if (!isPlain(snap) || typeof snap.id !== "string" || !snap.id) {
        return { ok: false, code: "invalid_snapshot", error: "快照缺少有效編號" };
      }
      const sym = symbolOf(snap.symbol);
      if (!sym) return { ok: false, code: "invalid_symbol", error: "快照股票代號不正確" };
      const mkt = snap.market === "tw" || snap.market === "us" ? snap.market : null;
      const cur = snap.currency === "TWD" || snap.currency === "USD" ? snap.currency : null;
      if (!mkt || !cur) return { ok: false, code: "invalid_market", symbol: sym, error: "快照市場或幣別不正確" };
      if (CURRENCY[mkt] !== cur) return { ok: false, code: "currency_mismatch", symbol: sym, error: `標的 ${sym} 市場與幣別不一致` };
      const prevMkt = symMkt.get(sym);
      const mkKey = `${mkt}/${cur}`;
      if (!prevMkt) symMkt.set(sym, mkKey);
      else if (prevMkt !== mkKey) return { ok: false, code: "currency_conflict", symbol: sym, error: `標的 ${sym} 前後市場／幣別衝突` };

      if (!validDate(snap.date)) return { ok: false, code: "invalid_date", symbol: sym, error: "快照基準日期不正確" };
      if (!["confirmed", "pending", "superseded"].includes(snap.status)) {
        return { ok: false, code: "invalid_status", symbol: sym, error: "快照狀態不正確" };
      }
      const scope = snap.scope ?? "partial";
      if (scope !== "full" && scope !== "partial") {
        return { ok: false, code: "invalid_scope", symbol: sym, error: "快照範圍標記不正確" };
      }
      const origin = snap.origin ?? "import";
      if (!["import", "tx_tag", "full_snapshot_close"].includes(origin)) {
        return { ok: false, code: "invalid_origin", symbol: sym, error: "快照來源類型不正確" };
      }
      if (origin === "full_snapshot_close") {
        if (snap.shares !== 0 || snap.avgCost !== null || scope !== "full") {
          return { ok: false, code: "invalid_close_snapshot", symbol: sym, error: "清倉結案快照欄位必須為 shares=0, avgCost=null, scope=full" };
        }
      } else {
        if (!isPos(snap.shares)) return { ok: false, code: "invalid_shares", symbol: sym, error: `快照 ${sym} 股數必須大於 0` };
        if (snap.status === "confirmed" && !isPos(snap.avgCost)) {
          return { ok: false, code: "missing_cost", symbol: sym, error: `已確認快照 ${sym} 必須有大於 0 的成本均價` };
        }
      }
      if (snap.status === "confirmed" && snap.date > refToday) {
        return { ok: false, code: "future_snapshot_date", symbol: sym, date: snap.date, error: `已確認快照 ${sym} 日期（${snap.date}）不可晚於今日` };
      }
    }

    for (const c of s.conflicts) {
      if (!isPlain(c) || typeof c.id !== "string" || !c.id) return { ok: false, code: "invalid_conflict", error: "衝突項目格式不正確" };
      if (c.status === "open" && c.symbol && c.market && c.currency) {
        const sym = symbolOf(c.symbol);
        if (sym && (c.market === "tw" || c.market === "us") && (c.currency === "TWD" || c.currency === "USD")) {
          if (CURRENCY[c.market] !== c.currency) return { ok: false, code: "currency_mismatch", symbol: sym, error: `衝突項目 ${sym} 市場幣別不一致` };
          const mkKey = `${c.market}/${c.currency}`;
          const prevMkt = symMkt.get(sym);
          if (!prevMkt) symMkt.set(sym, mkKey);
          else if (prevMkt !== mkKey) return { ok: false, code: "currency_conflict", symbol: sym, error: `標的 ${sym} 市場／幣別衝突` };
        }
      }
    }

    for (const [txId, rel] of Object.entries(s.sameDayRelations)) {
      if (!isPlain(rel) || (rel.relation !== "before_snapshot" && rel.relation !== "after_snapshot") || !validDate(rel.snapshotDate)) {
        return { ok: false, code: "invalid_same_day_relation", txId, error: "同日交易順序標記不正確" };
      }
    }
    return { ok: true };
  }

  function settlementHint(market) {
    if (market === "tw") return "可能是近 2 個交易日尚未交割（台股 T+2），或有交易還沒匯入";
    if (market === "us") return "可能是前 1 個交易日尚未交割（美股 T+1），或有交易還沒匯入";
    return "可能有尚未反映的交割或未匯入交易";
  }

  function deriveAvgCost(row) {
    if (!isPlain(row)) return null;
    if (isPos(row.avgCost)) return row.avgCost;
    const sh = row.shares;
    if (!isPos(sh)) return null;
    if (isPos(row.price) && isNum(row.totalPnl)) {
      const c = (sh * row.price - row.totalPnl) / sh;
      if (isPos(c)) return c;
    }
    if (isPos(row.marketValue) && isNum(row.totalPnl)) {
      const c = (row.marketValue - row.totalPnl) / sh;
      if (isPos(c)) return c;
    }
    return null;
  }

  function withinTolerance(simShares, simAvgCost, targetShares, targetAvgCost) {
    if (!isNum(simShares) || !isNum(targetShares)) return { sharesOk: false, costOk: false, ok: false };
    const sharesTol = Math.max(QTY_ABS_TOL, Math.abs(targetShares) * QTY_REL_TOL);
    const sharesOk = Math.abs(simShares - targetShares) <= sharesTol;
    let costOk = false;
    if (Math.abs(targetShares) <= EPS && Math.abs(simShares) <= EPS) {
      costOk = true;
    } else if (isPos(targetAvgCost) && isPos(simAvgCost)) {
      const costTol = Math.max(COST_ABS_TOL, Math.abs(targetAvgCost) * COST_REL_TOL);
      costOk = Math.abs(simAvgCost - targetAvgCost) <= costTol;
    }
    return { sharesOk, costOk, ok: sharesOk && costOk };
  }

  function pruneStore(s, maxBytes = MAX_BYTES) {
    const out = cloneStore(s);
    const openBatchIds = new Set(out.conflicts.filter(c => c && c.status === "open" && c.batchId).map(c => c.batchId));
    const sortNewestFirst = (a, b, key = "at") => String(b?.[key] || "").localeCompare(String(a?.[key] || ""));

    const trimWithLimits = (base, impCap, audCap, confCap, supPerSymCap, dropInactiveTags) => {
      const res = cloneStore(base);
      // 1. superseded snapshots（confirmed / pending 永不刪）
      const activeSnaps = res.snapshots.filter(x => x && (x.status === "confirmed" || x.status === "pending"));
      const supBySym = new Map();
      for (const x of res.snapshots) {
        if (!x || x.status === "confirmed" || x.status === "pending") continue;
        const k = symbolOf(x.symbol) || "";
        if (!supBySym.has(k)) supBySym.set(k, []);
        supBySym.get(k).push(x);
      }
      const keptSup = [];
      for (const list of supBySym.values()) {
        list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.confirmedAt || "").localeCompare(String(a.confirmedAt || "")));
        keptSup.push(...list.slice(0, supPerSymCap));
      }
      res.snapshots = [...activeSnaps, ...keptSup];

      // 2. conflicts（open 永不刪）
      const openConf = res.conflicts.filter(c => c && c.status === "open");
      const closedConf = res.conflicts.filter(c => c && c.status !== "open").sort((a, b) => sortNewestFirst(a, b, "resolvedAt") || sortNewestFirst(a, b, "createdAt")).slice(0, confCap);
      res.conflicts = [...openConf, ...closedConf];

      // 3. imports（被 open conflict 引用的永不刪）
      const pinnedImps = res.imports.filter(imp => imp && openBatchIds.has(imp.id));
      const freeImps = res.imports.filter(imp => imp && !openBatchIds.has(imp.id)).sort((a, b) => sortNewestFirst(a, b, "at")).slice(0, impCap);
      res.imports = [...pinnedImps, ...freeImps];

      // 4. audit
      res.audit = res.audit.slice().sort((a, b) => sortNewestFirst(a, b, "at")).slice(0, audCap);

      // 5. inactive initialTags
      if (dropInactiveTags) {
        for (const [k, v] of Object.entries(res.initialTags)) {
          if (!v || v.active !== true) delete res.initialTags[k];
        }
      }
      return res;
    };

    const origBytes = JSON.stringify(out).length;
    if (origBytes <= maxBytes) return { ok: true, store: out, bytes: origBytes, maxBytes, trimmed: false };

    const schedules = [
      [40, 160, 60, 3, false],
      [20, 80, 30, 2, false],
      [10, 40, 10, 1, true],
      [3, 10, 3, 0, true],
      [0, 0, 0, 0, true],
    ];
    for (const [ic, ac, cc, sc, dt] of schedules) {
      const cand = trimWithLimits(out, ic, ac, cc, sc, dt);
      const b = JSON.stringify(cand).length;
      if (b <= maxBytes) return { ok: true, store: cand, bytes: b, maxBytes, trimmed: true };
    }
    const minCand = trimWithLimits(out, 0, 0, 0, 0, true);
    const minBytes = JSON.stringify(minCand).length;
    return { ok: false, code: "core_data_exceeds_limit", bytes: minBytes, maxBytes, store: null };
  }

  function activeBaselines(s) {
    const map = new Map();
    if (!s || !Array.isArray(s.snapshots)) return map;
    for (const snap of s.snapshots) {
      if (!snap || snap.status !== "confirmed") continue;
      const sym = symbolOf(snap.symbol);
      if (!sym) continue;
      const prev = map.get(sym);
      if (!prev) {
        map.set(sym, snap);
        continue;
      }
      if (snap.date > prev.date) { map.set(sym, snap); continue; }
      if (snap.date === prev.date) {
        const snapUnSup = snap.supersededBy == null, prevUnSup = prev.supersededBy == null;
        if (snapUnSup && !prevUnSup) { map.set(sym, snap); continue; }
        if (snapUnSup === prevUnSup && String(snap.confirmedAt || "") >= String(prev.confirmedAt || "")) {
          map.set(sym, snap);
        }
      }
    }
    return map;
  }

  function hasConfirmedSnapshots(s) {
    return !!(s && Array.isArray(s.snapshots) && s.snapshots.some(x => x && x.status === "confirmed"));
  }

  function findRepeatHash(s, hashes = []) {
    const set = new Set((Array.isArray(hashes) ? hashes : []).filter(h => typeof h === "string" && h.length > 0));
    if (!set.size || !s || !Array.isArray(s.imports)) return { hit: false, openConflicts: 0, openImportIds: [], resolvedCount: 0 };
    const matched = s.imports.filter(imp => Array.isArray(imp?.fileHashes) && imp.fileHashes.some(h => set.has(h)));
    if (!matched.length) return { hit: false, openConflicts: 0, openImportIds: [], resolvedCount: 0 };
    const openConfs = Array.isArray(s.conflicts) ? s.conflicts.filter(c => c && c.status === "open") : [];
    const openImpIds = matched.filter(imp => openConfs.some(c => c.batchId === imp.id)).map(imp => imp.id);
    const openConfCount = openConfs.filter(c => matched.some(imp => imp.id === c.batchId)).length;
    return {
      hit: true,
      openConflicts: openConfCount,
      openImportIds: openImpIds,
      resolvedCount: matched.length - openImpIds.length,
    };
  }

  // ===== 指紋（固定 fp1：canonical JSON + cyrb128） =====
  const canon = v => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(x => x === undefined ? "null" : canon(x)).join(",") + "]";
    return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  };
  const cyrb128 = str => {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, "0")).join("");
  };
  const fpObj = v => { const s = canon(v ?? {}); return `fp1:${cyrb128(s)}:${s.length}`; };
  function txFingerprint(tx) { return fpObj(tx ?? {}); }
  function pfStoreHash(pf) {
    const p = isPlain(pf) ? pf : {};
    return fpObj({ v: p.v ?? 1, method: p.method ?? "avg", transactions: Array.isArray(p.transactions) ? p.transactions : [] });
  }
  const isFp1 = h => typeof h === "string" && /^fp1:[0-9a-f]{32}:\d+$/.test(h);

  // ===== TagSnapshotState 輔助 =====
  function readTagState(recon, txId) {
    const tag = recon?.initialTags?.[txId] || null;
    const snap = tag?.snapshotId && Array.isArray(recon?.snapshots)
      ? recon.snapshots.find(s => s && s.id === tag.snapshotId) || null
      : null;
    return {
      active: !!tag?.active,
      snapshotId: tag?.snapshotId || null,
      snapshotStatus: snap ? snap.status : null,
      snapshotDate: snap ? snap.date : null,
      snapshotShares: snap ? snap.shares : null,
      snapshotAvgCost: snap ? (snap.avgCost ?? null) : null,
      supersededBy: snap ? (snap.supersededBy ?? null) : null,
    };
  }

  function isValidTagState(st) {
    if (!isPlain(st)) return false;
    if (typeof st.active !== "boolean") return false;
    if (st.snapshotId !== null && (typeof st.snapshotId !== "string" || !st.snapshotId)) return false;
    if (st.snapshotStatus !== null && !["confirmed", "pending", "superseded"].includes(st.snapshotStatus)) return false;
    if (st.snapshotDate !== null && !validDate(st.snapshotDate)) return false;
    if (st.snapshotShares !== null && !isNum(st.snapshotShares)) return false;
    if (st.snapshotAvgCost !== null && !isNum(st.snapshotAvgCost)) return false;
    if (st.supersededBy !== null && typeof st.supersededBy !== "string") return false;
    return true;
  }

  function tagStatesEqual(a, b) {
    if (!a || !b) return false;
    return a.active === b.active
      && a.snapshotId === b.snapshotId
      && a.snapshotStatus === b.snapshotStatus
      && a.snapshotDate === b.snapshotDate
      && a.snapshotShares === b.snapshotShares
      && a.snapshotAvgCost === b.snapshotAvgCost
      && a.supersededBy === b.supersededBy;
  }

  function matchesTagState(recon, txId, expected) {
    return tagStatesEqual(readTagState(recon, txId), expected);
  }

  function applyTagStateToStore(recon, txId, targetState, nextTxHash) {
    if (!targetState) return;
    if (targetState.snapshotId) {
      if (!recon.initialTags[txId]) {
        recon.initialTags[txId] = { txId, snapshotId: targetState.snapshotId, active: targetState.active };
      }
      recon.initialTags[txId].active = targetState.active;
      recon.initialTags[txId].snapshotId = targetState.snapshotId;
      recon.initialTags[txId].date = targetState.snapshotDate;
      recon.initialTags[txId].shares = targetState.snapshotShares;
      recon.initialTags[txId].avgCost = targetState.snapshotAvgCost;
      if (nextTxHash) recon.initialTags[txId].txHash = nextTxHash;

      const snap = recon.snapshots.find(s => s && s.id === targetState.snapshotId);
      if (snap) {
        if (targetState.snapshotStatus != null) snap.status = targetState.snapshotStatus;
        if (targetState.snapshotDate != null) snap.date = targetState.snapshotDate;
        if (targetState.snapshotShares != null) snap.shares = targetState.snapshotShares;
        if (targetState.snapshotAvgCost !== undefined) snap.avgCost = targetState.snapshotAvgCost;
        snap.supersededBy = targetState.supersededBy ?? null;
      }
    } else if (recon.initialTags[txId]) {
      recon.initialTags[txId].active = targetState.active;
      if (nextTxHash) recon.initialTags[txId].txHash = nextTxHash;
    }
  }

  function mergeById(dest, src) {
    if (!Array.isArray(src) || !src.length) return dest;
    const seen = new Set(dest.map(x => x && x.id).filter(Boolean));
    for (const item of src) {
      if (!item) continue;
      if (item.id && seen.has(item.id)) continue;
      if (item.id) seen.add(item.id);
      dest.push(deepClone(item));
    }
    return dest;
  }

  function mergeStaged(recon, staged) {
    if (!isPlain(staged)) return;
    if (Array.isArray(staged.imports)) mergeById(recon.imports, staged.imports);
    if (Array.isArray(staged.conflicts)) mergeById(recon.conflicts, staged.conflicts);
    if (Array.isArray(staged.audit)) mergeById(recon.audit, staged.audit);
    if (isPlain(staged.initialTags)) {
      for (const [k, v] of Object.entries(staged.initialTags)) recon.initialTags[k] = deepClone(v);
    }
    if (isPlain(staged.sameDayRelations)) {
      for (const [k, v] of Object.entries(staged.sameDayRelations)) recon.sameDayRelations[k] = deepClone(v);
    }
  }

  // ===== WAL Planning & Commit / Recovery =====
  function planDeactivateTags(store, prevTxsOrSingle, opts = {}) {
    const recon = cloneStore(store);
    const list = (Array.isArray(prevTxsOrSingle) ? prevTxsOrSingle : [prevTxsOrSingle]).filter(t => t && t.id);
    const tagged = list.filter(t => recon.initialTags?.[t.id]?.active === true);
    if (!tagged.length) return { ok: true, needsWal: false, previewRecon: recon };

    const at = opts.at || new Date().toISOString();
    const batchId = opts.batchId || makeId("waldel", at);
    const deletedTxIds = [];
    const prevTxs = {};
    const prevTxHashes = {};
    const prevTagStates = {};
    const targetTagStates = {};
    const audit = [];

    for (const tx of tagged) {
      const prevSt = readTagState(recon, tx.id);
      const tgtSt = {
        active: false,
        snapshotId: prevSt.snapshotId,
        snapshotStatus: prevSt.snapshotId ? "superseded" : null,
        snapshotDate: prevSt.snapshotDate,
        snapshotShares: prevSt.snapshotShares,
        snapshotAvgCost: prevSt.snapshotAvgCost,
        supersededBy: null,
      };
      deletedTxIds.push(tx.id);
      prevTxs[tx.id] = deepClone(tx);
      prevTxHashes[tx.id] = txFingerprint(tx);
      prevTagStates[tx.id] = prevSt;
      targetTagStates[tx.id] = tgtSt;
      audit.push({
        id: `aud-${batchId}-${tx.id}`,
        at,
        action: "tag_deactivated_on_delete",
        symbol: symbolOf(tx.symbol),
        snapshotId: prevSt.snapshotId,
        conflictId: null,
        txId: tx.id,
        batchId,
        reason: opts.reason || "刪除已標為期初快照的股票轉入紀錄，同步停用其期初快照標記",
      });
    }

    const payload = {
      id: batchId,
      op: "deactivate_tags",
      at,
      deletedTxIds,
      prevTxs,
      prevTxHashes,
      prevTagStates,
      targetTagStates,
      staged: { audit },
    };

    const previewRecon = cloneStore(recon);
    for (const id of deletedTxIds) applyTagStateToStore(previewRecon, id, targetTagStates[id], null);
    mergeStaged(previewRecon, payload.staged);
    return { ok: true, needsWal: true, payload, previewRecon };
  }

  function planUpdateTxTag(store, prevTx, nextTx, opts = {}) {
    const recon = cloneStore(store);
    if (!prevTx?.id || recon.initialTags?.[prevTx.id]?.active !== true) {
      return { ok: true, needsWal: false, previewRecon: recon };
    }
    const prevTxHash = txFingerprint(prevTx);
    const nextTxHash = txFingerprint(nextTx);
    if (prevTxHash === nextTxHash) {
      return { ok: true, needsWal: false, previewRecon: recon };
    }

    const at = opts.at || new Date().toISOString();
    const batchId = opts.batchId || makeId("walupd", at);
    const refToday = opts.today && validDate(opts.today) ? opts.today : taipeiToday();
    const prevTagState = readTagState(recon, prevTx.id);

    const prevSym = symbolOf(prevTx.symbol);
    const nextSym = symbolOf(nextTx?.symbol);
    const stillValid = !!(
      nextTx &&
      nextTx.id === prevTx.id &&
      nextTx.type === "transfer_in" &&
      nextSym && nextSym === prevSym &&
      nextTx.market === prevTx.market &&
      nextTx.currency === prevTx.currency &&
      validDate(nextTx.date) && nextTx.date <= refToday &&
      isPos(nextTx.shares) &&
      isPos(nextTx.price)
    );

    const mode = stillValid ? "update" : "deactivate";
    const targetTagState = mode === "update"
      ? {
          active: true,
          snapshotId: prevTagState.snapshotId,
          snapshotStatus: prevTagState.snapshotStatus || "confirmed",
          snapshotDate: nextTx.date,
          snapshotShares: nextTx.shares,
          snapshotAvgCost: nextTx.price,
          supersededBy: prevTagState.supersededBy,
        }
      : {
          active: false,
          snapshotId: prevTagState.snapshotId,
          snapshotStatus: prevTagState.snapshotId ? "superseded" : null,
          snapshotDate: prevTagState.snapshotDate,
          snapshotShares: prevTagState.snapshotShares,
          snapshotAvgCost: prevTagState.snapshotAvgCost,
          supersededBy: null,
        };

    const audit = [{
      id: `aud-${batchId}-${prevTx.id}`,
      at,
      action: mode === "update" ? "tag_updated_with_tx" : "tag_deactivated_on_edit",
      symbol: prevSym,
      snapshotId: prevTagState.snapshotId,
      conflictId: null,
      txId: prevTx.id,
      batchId,
      reason: mode === "update"
        ? "修改已標為期初快照之交易，同步更新期初快照"
        : "修改交易類型／代號／無有效成本，同步停用期初快照標記（保留原正數成本供稽核）",
    }];

    const payload = {
      id: batchId,
      op: "update_tx_tag",
      at,
      txId: prevTx.id,
      mode,
      prevTx: deepClone(prevTx),
      prevTxHash,
      nextTxHash,
      prevTagState,
      targetTagState,
      staged: { audit },
    };

    const previewRecon = cloneStore(recon);
    applyTagStateToStore(previewRecon, prevTx.id, targetTagState, nextTxHash);
    mergeStaged(previewRecon, payload.staged);
    return { ok: true, needsWal: true, mode, payload, previewRecon };
  }

  function validateWalPayload(p) {
    if (!isPlain(p)) return { ok: false, code: "invalid_wal_structure" };
    const id = p.id || p.batchId;
    if (typeof id !== "string" || !id) return { ok: false, code: "invalid_wal_structure" };
    if (typeof p.op !== "string" || !p.op) return { ok: false, code: "invalid_wal_structure" };
    if (!WAL_OPS.has(p.op)) return { ok: false, code: "unknown_wal_op" };

    if (p.op === "import_trades") {
      if (!Array.isArray(p.txs) || !p.txs.length || !isPlain(p.txHashes)) return { ok: false, code: "invalid_wal_payload" };
      if (!isFp1(p.pfBaseHash) || !isFp1(p.pfNextHash)) return { ok: false, code: "invalid_wal_payload" };
      for (const tx of p.txs) {
        if (!isPlain(tx) || typeof tx.id !== "string" || !tx.id) return { ok: false, code: "invalid_wal_payload" };
        if (!isFp1(p.txHashes[tx.id]) || p.txHashes[tx.id] !== txFingerprint(tx)) return { ok: false, code: "invalid_wal_payload" };
      }
      return { ok: true };
    }
    if (p.op === "deactivate_tags") {
      if (!Array.isArray(p.deletedTxIds) || !p.deletedTxIds.length || !isPlain(p.prevTxs) || !isPlain(p.prevTxHashes) || !isPlain(p.prevTagStates) || !isPlain(p.targetTagStates)) {
        return { ok: false, code: "invalid_wal_payload" };
      }
      for (const txId of p.deletedTxIds) {
        if (typeof txId !== "string" || !txId) return { ok: false, code: "invalid_wal_payload" };
        if (!isPlain(p.prevTxs[txId]) || p.prevTxs[txId].id !== txId) return { ok: false, code: "invalid_wal_payload" };
        if (!isFp1(p.prevTxHashes[txId])) return { ok: false, code: "invalid_wal_payload" };
        if (!isValidTagState(p.prevTagStates[txId]) || !isValidTagState(p.targetTagStates[txId])) return { ok: false, code: "invalid_wal_payload" };
      }
      return { ok: true };
    }
    if (p.op === "update_tx_tag") {
      if (typeof p.txId !== "string" || !p.txId || (p.mode !== "update" && p.mode !== "deactivate")) return { ok: false, code: "invalid_wal_payload" };
      if (!isPlain(p.prevTx) || p.prevTx.id !== p.txId) return { ok: false, code: "invalid_wal_payload" };
      if (!isFp1(p.prevTxHash) || !isFp1(p.nextTxHash)) return { ok: false, code: "invalid_wal_payload" };
      if (p.prevTxHash === p.nextTxHash) return { ok: false, code: "wal_noop" };
      if (!isValidTagState(p.prevTagState) || !isValidTagState(p.targetTagState)) return { ok: false, code: "invalid_wal_payload" };
      return { ok: true };
    }
    return { ok: false, code: "unknown_wal_op" };
  }

  function prepareCommit(store, payload) {
    const out = cloneStore(store);
    if (out.pendingCommit != null) {
      return { ok: false, code: "pending_commit_exists", error: "已有未完成的對帳提交紀錄，請先恢復後再寫入" };
    }
    const v = validateWalPayload(payload);
    if (!v.ok) {
      return { ok: false, code: v.code, error: v.code === "wal_noop" ? "交易未實質異動，無須寫入 WAL" : "WAL 提交內容不合法" };
    }
    const pc = deepClone(payload);
    if (!pc.id && pc.batchId) pc.id = pc.batchId;
    out.pendingCommit = pc;
    return { ok: true, store: out };
  }

  function finalizeCommit(store, batchId) {
    const out = cloneStore(store);
    const p = out.pendingCommit;
    if (!p || p.id !== batchId) return { ok: false, code: "invalid_pending_commit", error: "待結案的提交編號不相符" };
    const v = validateWalPayload(p);
    if (!v.ok) return { ok: false, code: v.code, error: "待結案的提交內容不合法" };

    if (p.op === "deactivate_tags") {
      for (const txId of p.deletedTxIds) applyTagStateToStore(out, txId, p.targetTagStates[txId], null);
    } else if (p.op === "update_tx_tag") {
      applyTagStateToStore(out, p.txId, p.targetTagState, p.nextTxHash);
    }
    mergeStaged(out, p.staged);
    out.pendingCommit = null;
    return { ok: true, store: out };
  }

  function recoverCommit(pfStore, reconStore) {
    const baseRecon = reconStore ? cloneStore(reconStore) : emptyStore();
    const p = baseRecon.pendingCommit;
    if (p == null) return { changed: false, status: "noop", reconStore: baseRecon };

    if (!isPlain(p) || typeof p.op !== "string" || !p.op) {
      return { changed: false, status: "inconsistent_halted", code: "invalid_wal_structure", reconStore: baseRecon };
    }
    if (!WAL_OPS.has(p.op)) {
      return { changed: false, status: "unknown_op_halted", code: "unknown_wal_op", op: p.op, reconStore: baseRecon };
    }
    const v = validateWalPayload(p);
    if (!v.ok) {
      return { changed: false, status: "inconsistent_halted", code: v.code, op: p.op, reconStore: baseRecon };
    }

    const pf = isPlain(pfStore) ? pfStore : { v: 1, method: "avg", transactions: [] };
    const txList = Array.isArray(pf.transactions) ? pf.transactions : [];
    const byId = new Map(txList.map(t => [t?.id, t]));

    if (p.op === "import_trades") {
      const curHash = pfStoreHash(pf);
      let present = 0, mismatch = 0;
      for (const wtx of p.txs) {
        const cur = byId.get(wtx.id);
        if (!cur) continue;
        if (txFingerprint(cur) !== p.txHashes[wtx.id]) mismatch++;
        else present++;
      }
      if (mismatch > 0) {
        return { changed: false, status: "inconsistent_halted", code: "wal_tx_mismatch", op: p.op, reconStore: baseRecon };
      }
      if (present === p.txs.length) {
        if (curHash !== p.pfNextHash) {
          return { changed: false, status: "inconsistent_halted", code: "wal_pf_hash_mismatch", op: p.op, reconStore: baseRecon };
        }
        const fin = finalizeCommit(baseRecon, p.id);
        return { changed: true, status: "rolled_forward", op: p.op, reconStore: fin.store };
      }
      if (present > 0) {
        return { changed: false, status: "inconsistent_halted", code: "wal_partial_import", op: p.op, reconStore: baseRecon };
      }
      if (curHash !== p.pfBaseHash) {
        return { changed: false, status: "inconsistent_halted", code: "wal_external_modification", op: p.op, reconStore: baseRecon };
      }
      baseRecon.pendingCommit = null;
      return { changed: true, status: "aborted", op: p.op, reconStore: baseRecon };
    }

    if (p.op === "deactivate_tags") {
      let present = 0, absent = 0;
      for (const id of p.deletedTxIds) {
        const cur = byId.get(id);
        if (!cur) { absent++; continue; }
        if (txFingerprint(cur) !== p.prevTxHashes[id]) {
          return { changed: false, status: "inconsistent_halted", code: "wal_tx_mismatch", op: p.op, reconStore: baseRecon };
        }
        present++;
      }
      if (present > 0 && absent > 0) {
        return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
      }
      if (present === p.deletedTxIds.length) {
        const allPrev = p.deletedTxIds.every(id => matchesTagState(baseRecon, id, p.prevTagStates[id]));
        if (!allPrev) {
          return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
        }
        baseRecon.pendingCommit = null;
        return { changed: true, status: "aborted", op: p.op, reconStore: baseRecon };
      }
      const allValidPost = p.deletedTxIds.every(id => matchesTagState(baseRecon, id, p.prevTagStates[id]) || matchesTagState(baseRecon, id, p.targetTagStates[id]));
      if (!allValidPost) {
        return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
      }
      const fin = finalizeCommit(baseRecon, p.id);
      return { changed: true, status: "rolled_forward", op: p.op, reconStore: fin.store };
    }

    if (p.op === "update_tx_tag") {
      const actualTx = byId.get(p.txId);
      if (!actualTx) {
        return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
      }
      const actualHash = txFingerprint(actualTx);
      // 固定先比對 prevTxHash 再比對 nextTxHash（處理只改備註時雙態相等）
      if (actualHash === p.prevTxHash) {
        if (matchesTagState(baseRecon, p.txId, p.prevTagState)) {
          baseRecon.pendingCommit = null;
          return { changed: true, status: "aborted", op: p.op, reconStore: baseRecon };
        }
        return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
      }
      if (actualHash === p.nextTxHash) {
        if (matchesTagState(baseRecon, p.txId, p.prevTagState) || matchesTagState(baseRecon, p.txId, p.targetTagState)) {
          const fin = finalizeCommit(baseRecon, p.id);
          return { changed: true, status: "rolled_forward", op: p.op, reconStore: fin.store };
        }
        return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
      }
      return { changed: false, status: "inconsistent_halted", code: "wal_inconsistent_state", op: p.op, reconStore: baseRecon };
    }

    return { changed: false, status: "unknown_op_halted", code: "unknown_wal_op", op: p.op, reconStore: baseRecon };
  }

  function resolveHalted(pfStore, reconStore, choice, opts = {}) {
    const pf = isPlain(pfStore) ? deepClone(pfStore) : { v: 1, method: "avg", transactions: [] };
    if (!Array.isArray(pf.transactions)) pf.transactions = [];
    const recon = reconStore ? cloneStore(reconStore) : emptyStore();
    const p = recon.pendingCommit;
    if (!p) {
      return { ok: false, pfStore: pf, reconStore: recon, pfChanged: false, code: "no_pending_commit", error: "目前沒有受阻的對帳提交紀錄" };
    }
    const at = opts.at || new Date().toISOString();
    const src = opts.source || "manual_halted_resolve";
    const byId = new Map(pf.transactions.map(t => [t?.id, t]));

    if (choice === "discard_wal") {
      // 停用與目前交易紀錄不符之啟用 initialTags（保留原正數成本）
      for (const [txId, tag] of Object.entries(recon.initialTags)) {
        if (!tag || tag.active !== true) continue;
        const cur = byId.get(txId);
        const hashOk = !tag.txHash || (cur && txFingerprint(cur) === tag.txHash);
        if (!cur || cur.type !== "transfer_in" || !hashOk) {
          tag.active = false;
          if (tag.snapshotId) {
            const snap = recon.snapshots.find(s => s && s.id === tag.snapshotId);
            if (snap && snap.status !== "superseded") {
              snap.status = "superseded";
              snap.supersededBy = null;
            }
          }
        }
      }
      let summary = null;
      if (isPlain(p) && p.op === "import_trades" && Array.isArray(p.txs)) {
        const missing = p.txs.filter(wtx => wtx && !byId.has(wtx.id));
        const missingSymbols = [...new Set(missing.map(t => symbolOf(t.symbol)).filter(Boolean))];
        summary = {
          op: "import_trades",
          totalCount: p.txs.length,
          missingCount: missing.length,
          missingSymbols,
        };
      }
      recon.pendingCommit = null;
      const reason = summary
        ? `以交易紀錄為準放棄 WAL：已忽略未入帳 ${summary.missingCount} 筆（${summary.missingSymbols.join("、") || "無標的"}）[來源: ${src}]`
        : `以交易紀錄為準放棄卡住提交（${isPlain(p) ? p.op : "unknown"}）[來源: ${src}]`;
      recon.audit.push({
        id: makeId("aud", at + "_discard"),
        at,
        action: "halted_resolved_discard_wal",
        symbol: isPlain(p) && p.prevTx ? symbolOf(p.prevTx.symbol) : (summary?.missingSymbols?.[0] || null),
        snapshotId: null,
        conflictId: null,
        txId: isPlain(p) ? (p.txId || null) : null,
        batchId: isPlain(p) ? (p.id || null) : null,
        reason,
      });
      return { ok: true, pfStore: pf, reconStore: recon, pfChanged: false, ...(summary ? { summary } : {}) };
    }

    if (choice === "revert_pre_commit") {
      const v = validateWalPayload(p);
      if (!v.ok) {
        return {
          ok: false,
          pfStore: deepClone(pfStore),
          reconStore: cloneStore(reconStore),
          pfChanged: false,
          code: "revert_not_supported",
          error: "未知或結構不完整的操作無法自動還原，請改選「以交易紀錄為準，放棄卡住的操作」",
        };
      }

      let pfChanged = false;
      if (p.op === "import_trades") {
        // P1-2 前置守門：已進入 pf 之同 id 交易不得已被改成其他指紋
        const dropIds = new Set();
        for (const wtx of p.txs) {
          const cur = byId.get(wtx.id);
          if (cur && txFingerprint(cur) !== p.txHashes[wtx.id]) {
            return {
              ok: false,
              pfStore: deepClone(pfStore),
              reconStore: cloneStore(reconStore),
              pfChanged: false,
              code: "revert_conflict_modified",
              error: `交易 ${wtx.symbol || wtx.id} 已出現後續其他修改（指紋不符），拒絕回退覆蓋較新資料`,
            };
          }
          dropIds.add(wtx.id);
        }
        const before = pf.transactions.length;
        pf.transactions = pf.transactions.filter(t => t && !dropIds.has(t.id));
        pfChanged = pf.transactions.length !== before;
      } else if (p.op === "update_tx_tag") {
        const cur = byId.get(p.txId);
        const curHash = cur ? txFingerprint(cur) : null;
        const validTx = !!cur && (curHash === p.nextTxHash || curHash === p.prevTxHash);
        const validTag = matchesTagState(recon, p.txId, p.prevTagState) || matchesTagState(recon, p.txId, p.targetTagState);
        if (!validTx || !validTag) {
          return {
            ok: false,
            pfStore: deepClone(pfStore),
            reconStore: cloneStore(reconStore),
            pfChanged: false,
            code: "revert_conflict_modified",
            error: "該筆期初交易或對帳快照已被外部改成第三版本或刪除，拒絕自動還原",
          };
        }
        if (curHash !== p.prevTxHash) {
          pf.transactions = pf.transactions.map(t => t && t.id === p.txId ? deepClone(p.prevTx) : t);
          pfChanged = true;
        }
        applyTagStateToStore(recon, p.txId, p.prevTagState, p.prevTxHash);
      } else if (p.op === "deactivate_tags") {
        for (const id of p.deletedTxIds) {
          const cur = byId.get(id);
          const okTx = !cur || txFingerprint(cur) === p.prevTxHashes[id];
          const okTag = matchesTagState(recon, id, p.prevTagStates[id]) || matchesTagState(recon, id, p.targetTagStates[id]);
          if (!okTx || !okTag) {
            return {
              ok: false,
              pfStore: deepClone(pfStore),
              reconStore: cloneStore(reconStore),
              pfChanged: false,
              code: "revert_conflict_modified",
              error: `已停用／刪除的期初交易（${id}）已被重建或標籤已成第三狀態，拒絕自動還原`,
            };
          }
        }
        for (const id of p.deletedTxIds) {
          if (!byId.has(id)) {
            pf.transactions.push(deepClone(p.prevTxs[id]));
            pfChanged = true;
          }
          applyTagStateToStore(recon, id, p.prevTagStates[id], p.prevTxHashes[id]);
        }
      }

      recon.pendingCommit = null;
      recon.audit.push({
        id: makeId("aud", at + "_revert"),
        at,
        action: "halted_resolved_revert",
        symbol: p.prevTx ? symbolOf(p.prevTx.symbol) : null,
        snapshotId: null,
        conflictId: null,
        txId: p.txId || null,
        batchId: p.id || null,
        reason: `已還原至卡住操作（${p.op}）之前的雙鍵一致狀態 [來源: ${src}]`,
      });
      return { ok: true, pfStore: pf, reconStore: recon, pfChanged };
    }

    return { ok: false, pfStore: pf, reconStore: recon, pfChanged: false, code: "invalid_choice", error: "不支援的受阻修復選項" };
  }

  // ===== 輔助：單標的期限重播（當未傳 buildReconciledLedger 時備援，供 Task 2 獨立驗證） =====
  function replaySymbolFallback(txs, baseline, upToDate, sameDayRelations, initialTags) {
    let sh = baseline ? baseline.shares : 0;
    let cb = baseline && isPos(baseline.shares) && isPos(baseline.avgCost) ? r2(baseline.shares * baseline.avgCost) : 0;
    let unresolvedSameDay = false;
    const baseDate = baseline ? baseline.date : null;
    const relevant = (Array.isArray(txs) ? txs : []).filter(t => t && t.symbol === (baseline?.symbol || t.symbol) && validDate(t.date) && t.date <= upToDate);
    relevant.sort((a, b) => a.date.localeCompare(b.date));
    for (const t of relevant) {
      if (baseline && baseline.tagTxId === t.id) continue;
      if (initialTags?.[t.id]?.active && (!initialTags[t.id].txHash || initialTags[t.id].txHash === txFingerprint(t))) continue;
      if (baseDate && t.date < baseDate) continue;
      if (baseDate && t.date === baseDate) {
        const rel = sameDayRelations?.[t.id];
        const validRel = rel && rel.snapshotDate === baseDate && (!rel.snapshotId || rel.snapshotId === baseline.id);
        if (!validRel) { unresolvedSameDay = true; continue; }
        if (rel.relation === "before_snapshot") continue;
      }
      const fee = isNum(t.fee) ? t.fee : 0;
      if (t.type === "buy" || t.type === "transfer_in") {
        sh += t.shares;
        cb += t.shares * (t.price || 0) + (t.type === "buy" ? fee : 0);
      } else if (t.type === "sell" || t.type === "transfer_out") {
        if (sh > EPS) {
          const take = Math.min(sh, t.shares);
          cb -= cb * (take / sh);
          sh -= take;
          if (sh <= EPS) { sh = 0; cb = 0; }
        }
      } else if (t.type === "stock_dividend") {
        const add = isNum(t.shares) ? t.shares : (sh * (t.ratio || 0));
        sh += add;
      } else if (t.type === "split" && isPos(t.ratio)) {
        sh *= t.ratio;
      }
    }
    return { shares: sh, avgCost: sh > EPS ? cb / sh : null, unresolvedSameDay };
  }

  function simulateAtDate(sym, baseline, txStore, reconStore, upToDate, ledgerLib, method, today, ledgerPositions) {
    const symTxs = (Array.isArray(txStore?.transactions) ? txStore.transactions : []).filter(t => t && symbolOf(t.symbol) === sym && validDate(t.date) && t.date <= upToDate);
    if (ledgerLib && typeof ledgerLib.buildReconciledLedger === "function") {
      const subRecon = cloneStore(reconStore);
      // 保留 <= upToDate 的已確認快照（僅含此標的當前 baseline）
      const led = ledgerLib.buildReconciledLedger({ v: 1, method: method || "avg", transactions: symTxs }, subRecon, { method: method || "avg", today: today || upToDate });
      const pos = led.positions.find(p => symbolOf(p.symbol) === sym);
      const hasUnresolved = (pos?.pending || []).some(x => x.code === "same_day_order") || (led.reconcile?.unresolvedSameDayCount || 0) > 0;
      return {
        shares: pos ? pos.shares : (baseline ? baseline.shares : 0),
        avgCost: pos ? pos.avgCost : (baseline ? baseline.avgCost : null),
        hasTxUpTo: symTxs.length > 0,
        unresolvedSameDay: hasUnresolved,
      };
    }
    if (symTxs.length > 0 || baseline) {
      if (symTxs.length > 0) {
        const rep = replaySymbolFallback(symTxs.map(t => ({ ...t, symbol: sym })), baseline, upToDate, reconStore?.sameDayRelations, reconStore?.initialTags);
        return { shares: rep.shares, avgCost: rep.avgCost, hasTxUpTo: true, unresolvedSameDay: rep.unresolvedSameDay };
      }
    }
    const lp = Array.isArray(ledgerPositions) ? ledgerPositions.find(p => symbolOf(p?.symbol || p?.code) === sym) : null;
    if (lp) return { shares: lp.shares || 0, avgCost: lp.avgCost ?? null, hasTxUpTo: true, unresolvedSameDay: false };
    return { shares: baseline ? baseline.shares : 0, avgCost: baseline ? baseline.avgCost : null, hasTxUpTo: false, unresolvedSameDay: false };
  }

  // ===== Plan & Apply Holdings Import =====
  function planHoldingsSnapshot(input = {}) {
    const recon = cloneStore(input.store);
    const txStore = input.txStore || { v: 1, method: input.method || "avg", transactions: [] };
    const batchId = input.batchId || makeId("imp");
    const today = input.today && validDate(input.today) ? input.today : taipeiToday();
    const scope = input.snapshotScope === "full" ? "full" : "partial";
    const asOf = input.asOf && validDate(input.asOf) ? input.asOf : null;
    const asOfStatus = input.asOfStatus || (asOf ? "exact" : "missing");
    const asOfConfirmed = input.asOfConfirmed === true;
    const dateConfirmed = !!asOf && asOf <= today && (asOfStatus === "exact" || asOfConfirmed);
    const dateIssueKind = !asOf || asOfStatus === "missing" ? "missing_date" : "ambiguous_date";

    const symMkt = new Map();
    for (const snap of recon.snapshots) {
      const s = symbolOf(snap?.symbol);
      if (s && snap.market && snap.currency) symMkt.set(s, `${snap.market}/${snap.currency}`);
    }
    for (const t of txStore.transactions || []) {
      const s = symbolOf(t?.symbol);
      if (s && t.market && t.currency && !symMkt.has(s)) symMkt.set(s, `${t.market}/${t.currency}`);
    }

    const activeMap = activeBaselines(recon);
    const items = [];
    const presentSymbols = new Set();
    const rawRows = Array.isArray(input.rows) ? input.rows : [];

    rawRows.forEach((r, idx) => {
      if (!r || r.on === false && !r.marginType) return;
      const sym = symbolOf(r.code || r.symbol);
      const name = String(r.name || sym || "").trim();
      const shares = isNum(r.shares) ? r.shares : null;
      const avgCost = deriveAvgCost(r);
      const marginType = r.marginType || null;

      if (!sym) {
        items.push({ rowIndex: idx, symbol: null, name, market: null, currency: null, shares, avgCost, marginType, level: 3, outcome: "error", reasonCode: "unknown_symbol", reasonMessage: "缺少有效股票代號" });
        return;
      }

      let mkt = r.market === "tw" || r.market === "us" ? r.market : null;
      let cur = r.currency === "TWD" || r.currency === "USD" ? r.currency : null;
      if (!mkt && !cur) {
        mkt = inferMarketOfSymbol(sym);
        cur = mkt ? CURRENCY[mkt] : null;
      } else if (mkt && !cur) {
        cur = CURRENCY[mkt];
      } else if (!mkt && cur) {
        mkt = cur === "TWD" ? "tw" : cur === "USD" ? "us" : null;
      }

      if (!mkt || !cur || CURRENCY[mkt] !== cur) {
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType, level: 3, outcome: "error", reasonCode: "currency_conflict", reasonMessage: `標的 ${sym} 市場與幣別不匹配` });
        return;
      }
      const mkKey = `${mkt}/${cur}`;
      const knownMk = symMkt.get(sym);
      if (knownMk && knownMk !== mkKey) {
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType, level: 3, outcome: "error", reasonCode: "currency_conflict", reasonMessage: `標的 ${sym} 與既有紀錄的市場／幣別（${knownMk}）衝突` });
        return;
      }
      symMkt.set(sym, mkKey);

      if (marginType) {
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType, level: 2, outcome: "margin_separated", reasonCode: "margin_separated", reasonMessage: "信用交易（融資／融券）已隔離，不混入現股庫存" });
        return;
      }

      if (!isPos(shares)) {
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 3, outcome: "error", reasonCode: "invalid_shares", reasonMessage: "股數必須大於 0" });
        return;
      }

      presentSymbols.add(sym);
      const baseline = activeMap.get(sym) || null;
      const snapId = makeId("snap", `${batchId}_${sym}_${idx}`);

      // Date gate
      if (!dateConfirmed) {
        const msg = asOfStatus === "year"
          ? `截圖日期（${input.rawAsOf || asOf}）缺少完整年份，暫推定 ${asOf}，確認前不得設為已確認基準`
          : asOfStatus === "future" || (asOf && asOf > today)
            ? `截圖日期（${input.rawAsOf || asOf}）晚於今日（${today}），請修正後再確認`
            : "截圖缺少明確基準日期，請補上或確認後再設為基準";
        const snap = asOf ? { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost: avgCost ?? null, status: "pending", confirmedAt: null, scope, origin: "import", batchId, supersededBy: null } : null;
        const conflict = {
          id: makeId("conf", `${batchId}_${sym}_${idx}`),
          kind: dateIssueKind,
          symbol: sym,
          market: mkt,
          currency: cur,
          batchId,
          snapshotId: snap ? snap.id : null,
          previousSnapshotId: baseline ? baseline.id : null,
          baselineShares: baseline ? baseline.shares : null,
          baselineAvgCost: baseline ? baseline.avgCost : null,
          targetShares: shares,
          targetAvgCost: avgCost ?? null,
          diffShares: null,
          diffCost: null,
          status: "open",
          createdAt: input.at || new Date().toISOString(),
          message: msg,
          payload: { asOf, asOfStatus, rawAsOf: input.rawAsOf || null, altDate: input.altDate || null, scope, row: deepClone(r) },
        };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 2, outcome: "pending", reasonCode: dateIssueKind, reasonMessage: msg, snapshot: snap, conflict });
        return;
      }

      // Cost gate
      if (!avgCost) {
        const msg = `標的 ${sym} 缺少成本均價且無法由損益推導正值，請手動補填均價`;
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost: null, status: "pending", confirmedAt: null, scope, origin: "import", batchId, supersededBy: null };
        const conflict = {
          id: makeId("conf", `${batchId}_${sym}_${idx}`),
          kind: "missing_cost",
          symbol: sym,
          market: mkt,
          currency: cur,
          batchId,
          snapshotId: snap.id,
          previousSnapshotId: baseline ? baseline.id : null,
          baselineShares: baseline ? baseline.shares : null,
          baselineAvgCost: baseline ? baseline.avgCost : null,
          targetShares: shares,
          targetAvgCost: null,
          diffShares: null,
          diffCost: null,
          status: "open",
          createdAt: input.at || new Date().toISOString(),
          message: msg,
          payload: { scope, row: deepClone(r) },
        };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost: null, marginType: null, level: 2, outcome: "pending", reasonCode: "missing_cost", reasonMessage: msg, snapshot: snap, conflict });
        return;
      }

      // S2 < S1
      if (baseline && asOf < baseline.date) {
        const msg = `匯入快照日期（${asOf}）早於目前基準（${baseline.date}），保留現有基準不動`;
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost, status: "pending", confirmedAt: null, scope, origin: "import", batchId, supersededBy: null };
        const conflict = {
          id: makeId("conf", `${batchId}_${sym}_${idx}`),
          kind: "recon_diff",
          symbol: sym,
          market: mkt,
          currency: cur,
          batchId,
          snapshotId: snap.id,
          previousSnapshotId: baseline.id,
          baselineShares: baseline.shares,
          baselineAvgCost: baseline.avgCost,
          targetShares: shares,
          targetAvgCost: avgCost,
          diffShares: shares - baseline.shares,
          diffCost: baseline.avgCost != null ? avgCost - baseline.avgCost : null,
          status: "open",
          createdAt: input.at || new Date().toISOString(),
          message: msg,
          payload: { reason: "older_than_baseline", scope },
        };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 2, outcome: "pending", reasonCode: "older_than_baseline", reasonMessage: msg, snapshot: snap, conflict });
        return;
      }

      // Compare against ledger state up to asOf
      const sim = simulateAtDate(sym, baseline, txStore, recon, asOf, input.ledgerLib, input.method, today, input.ledgerPositions);
      const hasComparableBase = !!baseline || sim.hasTxUpTo;
      if (!hasComparableBase) {
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost, status: "confirmed", confirmedAt: input.at || new Date().toISOString(), scope, origin: "import", batchId, supersededBy: null };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 1, outcome: "confirmed", reasonCode: null, reasonMessage: "建立期初快照基準", snapshot: snap, supersedesId: null });
        return;
      }

      if (sim.unresolvedSameDay) {
        const msg = `${asOf} 當日有未定序交易，請先標明快照前後再對帳`;
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost, status: "pending", confirmedAt: null, scope, origin: "import", batchId, supersededBy: null };
        const conflict = {
          id: makeId("conf", `${batchId}_${sym}_${idx}`),
          kind: "recon_diff",
          symbol: sym,
          market: mkt,
          currency: cur,
          batchId,
          snapshotId: snap.id,
          previousSnapshotId: baseline ? baseline.id : null,
          baselineShares: sim.shares,
          baselineAvgCost: sim.avgCost,
          targetShares: shares,
          targetAvgCost: avgCost,
          diffShares: shares - sim.shares,
          diffCost: sim.avgCost != null ? avgCost - sim.avgCost : null,
          status: "open",
          createdAt: input.at || new Date().toISOString(),
          message: msg,
          payload: { reason: "unresolved_same_day", scope },
        };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 2, outcome: "pending", reasonCode: "same_day_order", reasonMessage: msg, snapshot: snap, conflict });
        return;
      }

      const tol = withinTolerance(sim.shares, sim.avgCost, shares, avgCost);
      if (tol.ok) {
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost, status: "confirmed", confirmedAt: input.at || new Date().toISOString(), scope, origin: "import", batchId, supersededBy: null };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 1, outcome: "confirmed", reasonCode: null, reasonMessage: baseline ? "符合容差，自動晉升新基準" : "與既有交易推算一致，建立快照基準", snapshot: snap, supersedesId: baseline ? baseline.id : null });
      } else {
        const diffShares = shares - sim.shares;
        const msg = `差異 ${diffShares > 0 ? "+" : ""}${Math.round(diffShares * 1e4) / 1e4} 股：${settlementHint(mkt)}`;
        const snap = { id: snapId, symbol: sym, market: mkt, currency: cur, date: asOf, shares, avgCost, status: "pending", confirmedAt: null, scope, origin: "import", batchId, supersededBy: null };
        const conflict = {
          id: makeId("conf", `${batchId}_${sym}_${idx}`),
          kind: "recon_diff",
          symbol: sym,
          market: mkt,
          currency: cur,
          batchId,
          snapshotId: snap.id,
          previousSnapshotId: baseline ? baseline.id : null,
          baselineShares: sim.shares,
          baselineAvgCost: sim.avgCost,
          targetShares: shares,
          targetAvgCost: avgCost,
          diffShares,
          diffCost: sim.avgCost != null ? avgCost - sim.avgCost : null,
          status: "open",
          createdAt: input.at || new Date().toISOString(),
          message: msg,
          payload: { scope },
        };
        items.push({ rowIndex: idx, symbol: sym, name, market: mkt, currency: cur, shares, avgCost, marginType: null, level: 2, outcome: "pending", reasonCode: "recon_diff", reasonMessage: msg, snapshot: snap, conflict, baselineShares: sim.shares, diffShares });
      }
    });

    // Full snapshot closure for baselines omitted in a confirmed full snapshot
    const closures = [];
    if (scope === "full" && dateConfirmed) {
      let cIdx = 0;
      for (const baseline of activeMap.values()) {
        if (presentSymbols.has(baseline.symbol) || !(baseline.shares > EPS) || !(baseline.date < asOf)) continue;
        const sim = simulateAtDate(baseline.symbol, baseline, txStore, recon, asOf, input.ledgerLib, input.method, today, input.ledgerPositions);
        const snapId = makeId("snapclose", `${batchId}_${baseline.symbol}_${cIdx}`);
        if (!sim.unresolvedSameDay && Math.abs(sim.shares) <= QTY_ABS_TOL) {
          const snap = { id: snapId, symbol: baseline.symbol, market: baseline.market, currency: baseline.currency, date: asOf, shares: 0, avgCost: null, status: "confirmed", confirmedAt: input.at || new Date().toISOString(), scope: "full", origin: "full_snapshot_close", batchId, supersededBy: null };
          closures.push({ symbol: baseline.symbol, level: 1, outcome: "closed", snapshot: snap, supersedesId: baseline.id, conflict: null });
        } else {
          const msg = `完整庫存截圖未出現 ${baseline.symbol}（帳本推算尚餘 ${sim.shares} 股）：${settlementHint(baseline.market)}`;
          const snap = { id: snapId, symbol: baseline.symbol, market: baseline.market, currency: baseline.currency, date: asOf, shares: 0, avgCost: null, status: "pending", confirmedAt: null, scope: "full", origin: "full_snapshot_close", batchId, supersededBy: null };
          const conflict = {
            id: makeId("confclose", `${batchId}_${baseline.symbol}_${cIdx}`),
            kind: "recon_diff",
            symbol: baseline.symbol,
            market: baseline.market,
            currency: baseline.currency,
            batchId,
            snapshotId: snap.id,
            previousSnapshotId: baseline.id,
            baselineShares: sim.shares,
            baselineAvgCost: sim.avgCost,
            targetShares: 0,
            targetAvgCost: null,
            diffShares: -sim.shares,
            diffCost: null,
            status: "open",
            createdAt: input.at || new Date().toISOString(),
            message: msg,
            payload: { reason: "missing_in_full_snapshot", previousSnapshotId: baseline.id, scope: "full" },
          };
          closures.push({ symbol: baseline.symbol, level: 2, outcome: "pending_close", snapshot: snap, supersedesId: null, conflict });
        }
        cIdx++;
      }
    }

    return {
      batchId,
      asOf,
      asOfStatus,
      asOfConfirmed,
      dateConfirmed,
      snapshotScope: scope,
      fileHashes: Array.isArray(input.fileHashes) ? input.fileHashes.slice() : [],
      method: input.method || "avg",
      items,
      closures,
    };
  }

  function applyHoldingsImport(store, plan, opts = {}) {
    if (!plan || !Array.isArray(plan.items)) return { ok: false, code: "invalid_plan", errors: ["匯入規劃資料無效"] };
    const out = cloneStore(store);
    const at = opts.at || new Date().toISOString();
    let appliedCount = 0;
    let conflictCount = 0;
    const l1 = [], l2 = [], l3 = [];

    const commitItemSnapshot = (snap, supersedesId, action) => {
      if (supersedesId) {
        const prev = out.snapshots.find(s => s && s.id === supersedesId);
        if (prev) {
          prev.status = "superseded";
          prev.supersededBy = snap.id;
        }
      }
      out.snapshots.push(deepClone(snap));
      appliedCount++;
      out.audit.push({
        id: makeId("aud", `${plan.batchId}_${snap.symbol}`),
        at,
        action,
        symbol: snap.symbol,
        snapshotId: snap.id,
        conflictId: null,
        txId: null,
        batchId: plan.batchId,
        reason: supersedesId ? `取代舊基準 ${supersedesId}` : "",
      });
    };

    for (const it of plan.items) {
      if (it.level === 3) { l3.push(it); continue; }
      if (it.outcome === "margin_separated") { l2.push(it); continue; }
      if (it.level === 1 && it.snapshot) {
        l1.push(it);
        commitItemSnapshot(it.snapshot, it.supersedesId, it.supersedesId ? "snapshot_promoted" : "snapshot_confirmed");
      } else if (it.level === 2) {
        l2.push(it);
        if (it.snapshot) out.snapshots.push(deepClone(it.snapshot));
        if (it.conflict) {
          out.conflicts.push(deepClone(it.conflict));
          conflictCount++;
          out.audit.push({
            id: makeId("audconf", `${plan.batchId}_${it.symbol}`),
            at,
            action: "snapshot_pending_conflict",
            symbol: it.symbol,
            snapshotId: it.snapshot?.id || null,
            conflictId: it.conflict.id,
            txId: null,
            batchId: plan.batchId,
            reason: it.conflict.message || it.reasonMessage || "",
          });
        }
      }
    }

    for (const cl of plan.closures || []) {
      if (cl.level === 1 && cl.snapshot) {
        commitItemSnapshot(cl.snapshot, cl.supersedesId, "full_snapshot_closed");
      } else if (cl.level === 2) {
        if (cl.snapshot) out.snapshots.push(deepClone(cl.snapshot));
        if (cl.conflict) {
          out.conflicts.push(deepClone(cl.conflict));
          conflictCount++;
          out.audit.push({
            id: makeId("audclose", `${plan.batchId}_${cl.symbol}`),
            at,
            action: "full_snapshot_close_pending",
            symbol: cl.symbol,
            snapshotId: cl.snapshot?.id || null,
            conflictId: cl.conflict.id,
            txId: null,
            batchId: plan.batchId,
            reason: cl.conflict.message || "",
          });
        }
      }
    }

    out.imports.push({
      id: plan.batchId,
      at,
      kind: "holdings",
      asOf: plan.asOf || null,
      asOfStatus: plan.asOfStatus || null,
      snapshotScope: plan.snapshotScope || "partial",
      fileHashes: Array.isArray(plan.fileHashes) ? plan.fileHashes.slice() : [],
      level1Count: l1.length,
      level2Count: l2.length,
      level3Count: l3.length,
      rows: plan.items.map(it => ({
        symbol: it.symbol,
        name: it.name,
        shares: it.shares,
        avgCost: it.avgCost,
        marginType: it.marginType || null,
        date: plan.asOf || null,
        level: it.level,
        outcome: it.outcome,
      })),
    });

    const val = validateStore(out, { today: opts.today });
    if (!val.ok) return { ok: false, code: val.code, errors: [val.error], store: null };

    return { ok: true, store: out, batchId: plan.batchId, appliedCount, conflictCount, errors: [] };
  }

  function resolveConflict(store, conflictId, action, opts = {}) {
    const out = cloneStore(store);
    const conf = out.conflicts.find(c => c && c.id === conflictId);
    if (!conf) return { ok: false, code: "conflict_not_found", error: "找不到指定的待對帳衝突項目" };
    if (conf.status !== "open") return { ok: false, code: "already_resolved", error: "該衝突項目已處理完成" };

    const at = opts.at || new Date().toISOString();
    const refToday = opts.today && validDate(opts.today) ? opts.today : taipeiToday();

    if (action === "accept_new") {
      const reason = String(opts.reason || "").trim();
      if (!reason) return { ok: false, code: "reason_required", error: "採信新快照必須填寫原因以供稽核" };

      let snap = conf.snapshotId ? out.snapshots.find(s => s && s.id === conf.snapshotId) : null;
      const newDate = opts.asOf && validDate(opts.asOf) ? opts.asOf : (snap ? snap.date : conf.payload?.asOf || null);
      if (!newDate || !validDate(newDate) || newDate > refToday) {
        return { ok: false, code: "invalid_date", error: "新快照基準日無效或晚於今日，請先修正日期" };
      }
      if (!snap) {
        const avg = isPos(opts.avgCost) ? opts.avgCost : conf.targetAvgCost;
        if (!isPos(avg)) return { ok: false, code: "missing_cost", error: "請補填大於 0 的成本均價後再採信" };
        snap = {
          id: makeId("snapacc", conflictId),
          symbol: symbolOf(conf.symbol),
          market: conf.market,
          currency: conf.currency,
          date: newDate,
          shares: conf.targetShares,
          avgCost: avg,
          status: "confirmed",
          confirmedAt: at,
          scope: conf.payload?.scope || "partial",
          origin: "import",
          batchId: conf.batchId || null,
          supersededBy: null,
        };
        out.snapshots.push(snap);
        conf.snapshotId = snap.id;
      } else {
        snap.date = newDate;
        if (snap.origin !== "full_snapshot_close") {
          const avg = isPos(opts.avgCost) ? opts.avgCost : snap.avgCost;
          if (!isPos(avg)) return { ok: false, code: "missing_cost", error: "請補填大於 0 的成本均價後再採信" };
          snap.avgCost = avg;
        }
        snap.status = "confirmed";
        snap.confirmedAt = at;
      }

      const prevId = conf.previousSnapshotId || conf.payload?.previousSnapshotId;
      for (const s of out.snapshots) {
        if (!s || s.id === snap.id) continue;
        if (symbolOf(s.symbol) === symbolOf(snap.symbol) && s.status === "confirmed") {
          if (s.id === prevId || s.date <= snap.date) {
            s.status = "superseded";
            s.supersededBy = snap.id;
          }
        }
      }

      conf.status = "resolved";
      conf.resolution = "accept_new";
      conf.reason = reason;
      conf.resolvedAt = at;
      out.audit.push({
        id: makeId("audres", conflictId),
        at,
        action: snap.origin === "full_snapshot_close" ? "conflict_accept_full_close" : "conflict_accept_new",
        symbol: symbolOf(conf.symbol),
        snapshotId: snap.id,
        conflictId: conf.id,
        txId: null,
        batchId: conf.batchId || null,
        reason,
      });
      return { ok: true, store: out, effect: "snapshot_confirmed" };
    }

    if (action === "keep_baseline" || action === "keep_both") {
      if (conf.snapshotId) {
        const snap = out.snapshots.find(s => s && s.id === conf.snapshotId);
        if (snap && snap.status === "pending") snap.status = "superseded";
      }
      conf.status = "resolved";
      conf.resolution = action;
      conf.reason = String(opts.reason || (action === "keep_both" ? "保留兩邊待之後補匯明細釐清" : "保留既有基準快照")).trim();
      conf.resolvedAt = at;
      out.audit.push({
        id: makeId("audres", conflictId),
        at,
        action: action === "keep_both" ? "conflict_keep_both" : "conflict_keep_baseline",
        symbol: symbolOf(conf.symbol),
        snapshotId: conf.snapshotId || null,
        conflictId: conf.id,
        txId: null,
        batchId: conf.batchId || null,
        reason: conf.reason,
      });
      return { ok: true, store: out, effect: action };
    }

    if (action === "mark_before_snapshot" || action === "mark_after_snapshot") {
      const txId = opts.txId || conf.txId;
      const snapId = opts.snapshotId || conf.snapshotId || conf.previousSnapshotId || activeBaselines(out).get(symbolOf(conf.symbol))?.id || null;
      const snapDate = opts.snapshotDate || conf.snapshotDate || (snapId ? out.snapshots.find(s => s && s.id === snapId)?.date : null) || conf.payload?.snapshotDate;
      if (!txId || !validDate(snapDate)) {
        return { ok: false, code: "missing_same_day_target", error: "缺少同日交易編號或基準日期，無法標記先後順序" };
      }
      const relation = action === "mark_before_snapshot" ? "before_snapshot" : "after_snapshot";
      out.sameDayRelations[txId] = { relation, snapshotId: snapId, snapshotDate: snapDate, at, source: "conflict_resolve" };
      conf.status = "resolved";
      conf.resolution = relation;
      conf.reason = opts.reason || (relation === "before_snapshot" ? "標記為快照前已涵蓋（僅存歷史）" : "標記為快照後才成交（納入持倉）");
      conf.resolvedAt = at;
      out.audit.push({
        id: makeId("audsd", conflictId),
        at,
        action: "same_day_order_resolved",
        symbol: symbolOf(conf.symbol),
        snapshotId: snapId,
        conflictId: conf.id,
        txId,
        batchId: conf.batchId || null,
        reason: conf.reason,
      });
      return { ok: true, store: out, effect: relation };
    }

    return { ok: false, code: "invalid_action", error: "未知的衝突處理動作" };
  }

  function tagInitialTx(store, tx, opts = {}) {
    if (!isPlain(tx) || typeof tx.id !== "string" || !tx.id || tx.type !== "transfer_in") {
      return { ok: false, code: "invalid_tx", error: "只有有效的「股票轉入（transfer_in）」可標為期初快照" };
    }
    const sym = symbolOf(tx.symbol);
    const mkt = tx.market === "tw" || tx.market === "us" ? tx.market : null;
    const cur = tx.currency === "TWD" || tx.currency === "USD" ? tx.currency : null;
    const refToday = opts.today && validDate(opts.today) ? opts.today : taipeiToday();
    if (!sym || !mkt || !cur || CURRENCY[mkt] !== cur) {
      return { ok: false, code: "invalid_market", error: "交易的代號、市場或幣別不正確" };
    }
    if (!validDate(tx.date) || tx.date > refToday) {
      return { ok: false, code: "invalid_date", error: "交易日期格式無效或晚於今日" };
    }
    if (!isPos(tx.shares)) {
      return { ok: false, code: "invalid_shares", error: "轉入股數必須大於 0" };
    }
    if (!isPos(tx.price)) {
      return { ok: false, code: "missing_cost", error: "轉入交易缺少大於 0 的成本均價，請先編輯補上成本再標為期初快照" };
    }

    const out = cloneStore(store);
    const conflictSnap = out.snapshots.find(s => s && symbolOf(s.symbol) === sym && (s.market !== mkt || s.currency !== cur));
    if (conflictSnap) {
      return { ok: false, code: "currency_conflict", error: `標的 ${sym} 與既有快照市場／幣別衝突` };
    }

    const at = opts.at || new Date().toISOString();
    const snapId = opts.snapshotId || makeId("snaptag", tx.id);
    const existingActiveTag = out.initialTags[tx.id];
    if (existingActiveTag?.active && existingActiveTag.snapshotId) {
      const oldS = out.snapshots.find(s => s && s.id === existingActiveTag.snapshotId);
      if (oldS) { oldS.status = "superseded"; oldS.supersededBy = snapId; }
    }

    const snap = {
      id: snapId,
      symbol: sym,
      market: mkt,
      currency: cur,
      date: tx.date,
      shares: tx.shares,
      avgCost: tx.price,
      status: "confirmed",
      confirmedAt: at,
      scope: "partial",
      origin: "tx_tag",
      tagTxId: tx.id,
      batchId: null,
      supersededBy: null,
    };
    out.snapshots.push(snap);
    out.initialTags[tx.id] = {
      txId: tx.id,
      snapshotId: snap.id,
      symbol: sym,
      market: mkt,
      currency: cur,
      date: tx.date,
      shares: tx.shares,
      avgCost: tx.price,
      txHash: txFingerprint(tx),
      active: true,
      at,
    };
    out.audit.push({
      id: makeId("audtag", tx.id),
      at,
      action: "tag_initial_tx",
      symbol: sym,
      snapshotId: snap.id,
      conflictId: null,
      txId: tx.id,
      batchId: null,
      reason: "使用者將股票轉入標記為期初庫存快照",
    });
    return { ok: true, store: out, snapshot: snap };
  }

  function untagInitialTx(store, txId, opts = {}) {
    const out = cloneStore(store);
    const tag = out.initialTags[txId];
    if (!tag || !tag.active) return { ok: false, code: "tag_not_found", error: "這筆交易沒有啟用中的期初快照標記" };
    const at = opts.at || new Date().toISOString();
    tag.active = false;
    if (tag.snapshotId) {
      const snap = out.snapshots.find(s => s && s.id === tag.snapshotId);
      if (snap) {
        snap.status = "superseded";
        snap.supersededBy = null;
      }
    }
    out.audit.push({
      id: makeId("auduntag", txId),
      at,
      action: opts.action || "untag_initial_tx",
      symbol: symbolOf(tag.symbol),
      snapshotId: tag.snapshotId || null,
      conflictId: null,
      txId,
      batchId: null,
      reason: opts.reason || "撤回期初快照標記（保留原正數成本供稽核）",
    });
    return { ok: true, store: out };
  }

  function deactivateTagsForTx(store, txId, opts = {}) {
    return untagInitialTx(store, txId, { ...opts, action: opts.action || "stale_tag_deactivated", reason: opts.reason || "停用已與交易紀錄脫鉤的期初快照標記" });
  }

  root.KLRecon = Object.freeze({
    VERSION, STORE_KEY, MAX_BYTES,
    QTY_ABS_TOL, QTY_REL_TOL, COST_ABS_TOL, COST_REL_TOL,
    CONFLICT_KINDS,
    emptyStore, cloneStore, validateStore, settlementHint, deriveAvgCost,
    pruneStore, activeBaselines, hasConfirmedSnapshots, findRepeatHash, withinTolerance,
    txFingerprint, pfStoreHash,
    planDeactivateTags, planUpdateTxTag, prepareCommit, finalizeCommit, recoverCommit, resolveHalted,
    planHoldingsSnapshot, applyHoldingsImport, resolveConflict,
    tagInitialTx, untagInitialTx, deactivateTagsForTx,
  });
})(typeof window !== "undefined" ? window : globalThis);
