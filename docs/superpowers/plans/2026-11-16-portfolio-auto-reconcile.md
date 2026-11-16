# 庫存入口收斂與自動對帳實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將分散的庫存與交易明細匯入收斂為單一「匯入資料」入口，後端 `/api/import` 在單次請求自動辨識截圖類型（`holdings`／`trades`／`unknown`）、畫面基準日（`asOf`）與融資／融券標記；前端以獨立鍵 `kline:pf:recon:v1`（`learner/recon.js`）與 `KLLedger.buildReconciledLedger` 建立「交易紀錄 × 庫存快照 × 計算持倉」三層架構與自動對帳中心，消除補傳歷史明細重複入帳與漏算賣超，並讓全站 8 個投資組合頁面、持股頁與 `perf.js` 使用同一個真相源且一致標示 `⚠︎ 待對帳（差異 N 股）`。

**Architecture:** 原始交易流水帳續留 `localStorage["kline:pf:v1"]`；庫存快照基準、對帳差異衝突、同日交易先後標記、舊 `transfer_in` 期初標記、匯入記錄（含 `shrink()` 前的原圖 SHA-256）與不可刪改稽核日誌獨立存於 `localStorage["kline:pf:recon:v1"]`（上限 120KB 自動裁剪歷史，嚴禁存圖片／base64）。計算層由 `KLLedger.buildReconciledLedger(txStoreOrList, reconStore, opts)` 以「各檔最新已確認快照 `B` ＋ 快照後交易」錨定計算（FIFO V1 把快照視作單一合成批次），全站除 `ledger.js` 本身外全面改用統一入口。

**Tech Stack:** 原生 HTML／JS、Vercel Serverless Function（Node 24 ESM）、`node --test`、Playwright（`PW=/opt/node22/lib/node_modules/playwright`）。

**Spec:** `docs/superpowers/specs/2026-11-16-portfolio-auto-reconcile-design.md`

---

## Global Constraints

- **不碰既有用戶存檔**：絕不清除、重建或自動遷移 `kline:watch:hold` 與 `kline:pf:v1`；純舊庫存無交易且無已確認快照時，舊庫存編輯、文字匯入、舊截圖與資料完全不變。
- **獨立對帳鍵與容量上限**：對帳資料僅讀寫 `kline:pf:recon:v1`（`v: 1`）；`KLRecon.validateStore` 遇到 `/data:image\//i` 或超過 2000 字元的疑似 base64 字串直接拒絕；`KLRecon.pruneStore(s, 120000)` 保留全部 `confirmed`/`pending` 快照、全部 `open` 衝突、全部啟用 `initialTags` 與其關聯 `imports[]`，僅由舊到新裁剪已結案歷史，避免觸碰 `tools.js` 150KB 雲端同步門檻。
- **統一計算入口（防繞過）**：除 `learner/ledger.js` 本身以外，全專案 `learner/*.js` 與 `learner/watch.html` **不得出現任何 `.buildLedger(` 呼叫**（以靜態單元測試把關），一律呼叫 `KLLedger.buildReconciledLedger`。
- **備份鍵序無關與 Fail-Closed**：`KLLedger.checkBackup` 先掃描 `data` 是否存在 `kline:pf:recon:v1` 再驗證 `kline:pf:v1`，且缺少 `opts.recon?.validateStore` 或驗證失敗時整份拒絕不降級；`tools.js` `syncImport` 必須動態載入 `recon.js` 並帶入 `recon: KLRecon`。
- **零外部網路／付費 AI 呼叫**：所有單元與 E2E 測試一律使用固定假資料與 mock `/api/import`（或 mock `fetch`／AI 函式），不連外網、不花費額度。
- **範圍與批次紀律**：
  - **Batch 1（本階段）**：只產出規格書與本實作計畫、建立鎖定 Draft PR，**不更動**任何 `.js`／`.html`／`.css`／`.mjs`／版本檔，停止等待 Claude Code（或 ChatGPT）獨立審查。
  - **Batch 2（規格計畫核可後）**：依 Task 1–9 採 TDD 施作、跑齊指定測試與 390／1280 截圖檢視後集中推送並轉 Ready。
  - **不做項目二無框視覺設計**：不調整 `.pfcard`、`.pftile`、`#stcss` 或 `core.css`／`minimal.css` 的無框版面（沿用現有樣式與 44px 觸控高度）。
  - 提交訊息與 PR 內文不出現 AI 工具或模型名稱；未經使用者明確授權不合併。

---

## Review Focus

1. **備份 JSON 鍵序倒置與缺模組 Fail-Closed**（`checkBackup` 收到 `kline:pf:v1` 排在 `kline:pf:recon:v1` 前的先賣後買快照帳本，或未載入 `KLRecon`）：絕不可先驗 `kline:pf:v1` 誤報賣超，也不可在缺少檢查函式時降級放行 → **Task 3** ＋ **Task 5**。
2. **同一截圖同天同價分批兩筆成交 vs 跨批重複 vs 直接呼叫 `buildLedger()`**：同一批內兩筆 `2454 buy 500 @ 1050` 在 `prepareTradesImport` 不可誤報 `possible_duplicate`；跨批比對 `existingArr`（含 `preSnapshot: true`）須標進 Level 2；而直接呼叫 `KLLedger.buildLedger()` 對同陣列重複列仍維持既有提醒 → **Task 3**。
3. **兩張快照跨過「全數賣光歸零再買回」**：`S1` → 賣光 `0` 股（`costBasis = 0, lots = []`）→ 再買進 → `S2`，期間重播與容差（數量 `max(1e-4, S2*1e-6)`、均價 `max(0.5, S2.avgCost*0.005)`）須能正確晉升或偵測差異 → **Task 3**。
4. **純快照空白帳本（無 `kline:pf:v1` 或 `transactions: []`）顯示全站 8 頁＋個股損益**：`holdSrcApply`、`watch.html`、`renderLedger`、`renderAlloc`、`lgPerfData`/`renderPerf`、`pf-home`、`pf-stress` Beta 按鈕、`pf-divcal`、`pf-report`、`pf-thesis`、`perf.js` 一律透過唯讀 `lgStoreOrEmpty()` 正常運算呈現，不退回介紹頁、不預先寫入空 `kline:pf:v1` → **Task 4** ＋ **Task 5** ＋ **Task 6** ＋ **Task 7**。
5. **後端 `api/_lib/import.js` 向下相容**：直接呼叫 `parseTradeDate(null/""/"   ", today)` 與 `cleanTradeRows(rows, opts)`（未傳 `missingAsNull: true`）仍維持 `{ date: refToday, dateAssumed: "today" }`；`marginType` 僅在偵測到信用交易關鍵字時採條件展開附加，一般現股鍵集合與既有 `deepEqual` 測試完全一致 → **Task 1**。

---

### Task 1：後端 `/api/import` 自動辨識、`asOf` 與融資／融券條件標記

**Files:**
- Modify: `api/_lib/import.js:1-251`
- Modify: `tests/ledger-import.test.mjs:1-167`（擴增單元測試，保留 L1–166 既有斷言不動）

**Interfaces — Consumes / Produces:**
- Exported helpers from `api/_lib/import.js`:
  - `parseTradeDate(raw, today = taipeiToday(), opts = {})`: 未傳 `opts.missingAsNull: true` 時，空字串／`null`／純空白續回 `{ date: refToday, dateAssumed: "today" }`；傳入 `{ missingAsNull: true }` 時回 `{ date: "", dateAssumed: "missing" }`。
  - `parseAsOf(raw, today = taipeiToday())` → `{ asOf: string|null, asOfStatus: "exact"|"year"|"mdy"|"invalid"|"missing", altDate?: string, rawAsOf?: string }`。空白／`null` 必回 `{ asOf: null, asOfStatus: "missing" }`；歧義回 `mdy` 並附 `altDate`/`rawAsOf`。
  - `cleanRows(rows)` & `cleanTradeRows(rows, opts = {})`: 新增 `detectMarginType(r)`，僅在匹配 `/融資|融券|資買|資賣|券買|券賣|credit|\bmargin\b|\bshort\b/i`（先判 `/券賣|融券|券買|\bshort\b/i` 為 `"short"`，否則為 `"margin"`）時以條件展開 `...(marginType ? { marginType } : {})` 附加上去；`cleanTradeRows` 透傳 `{ missingAsNull: opts.missingAsNull }` 給 `parseTradeDate`。
  - `MODES.auto` (`AUTO_PROMPT`, `AUTO_SCHEMA`): `viaGemini` / `viaClaude` 除 `rows` 與 `model` 外亦保留 `kind` 與 `asOf`；`POST /api/import`（`handler`）支援 `mode: "auto"`，省略或 `""` 仍預設 `"holdings"`，不支援的 `mode` 仍回 HTTP `400`。當 `r.kind === "unknown"` 時以 `cleanAutoUnknownRows(r.rows, { today, missingAsNull: true })` 同步正規化股票識別欄位、日期（缺日回 `""`/`"missing"`）、方向、股數、價格、均價與條件 `marginType`，讓前端一鍵切換類型時無須重呼 AI。
  - HTTP `200` 回應（`mode === "auto"`）：`{ ok: true, mode: "auto", kind: "holdings"|"trades"|"unknown", asOf, asOfStatus, ...(altDate ? { altDate } : {}), ...(rawAsOf ? { rawAsOf } : {}), rows, model }`；當 `kind === "unknown"` 且清理後 `rows.length === 0` 時回 200 `{ ok: false, kind: "unknown", asOf, asOfStatus, error: "無法辨識這張截圖是庫存還是交易明細，且沒有讀出有效資料列。" }`；有有效列則回 `{ ok: true, mode: "auto", kind: "unknown", ... }` 讓前端於檢視表切換類型，不重呼 AI。

- [ ] **寫失敗測試**（`tests/ledger-import.test.mjs`，全 mock `fetch`／AI 函式，不連外網）：
  - `parseTradeDate` 不傳 `missingAsNull` 時續回 `today`；傳 `{ missingAsNull: true }` 時空白回 `{ date: "", dateAssumed: "missing" }`（Review Focus 5）。
  - `parseAsOf` 分別測精確日期（`exact`）、缺年份 `05/12`（`year`）、斜線歧義 `05/12/2026`（`mdy` ＋ `altDate`/`rawAsOf`）、無效日 `2026/02/30`（`invalid`）與空值（`missing` 且 `asOf: null`）。
  - `cleanRows` 與 `cleanTradeRows` 測現股列維持原物件鍵（`!("marginType" in row)`，既有 `deepEqual` 不破），融資／資買輸出 `marginType: "margin"`、融券／券賣輸出 `marginType: "short"`。
  - `POST /api/import` 設 `mode: "auto"`：
    1. Mock Gemini 回 `kind: "holdings"`, `asOf: "115/11/10"`, 2 檔台股（含 1 檔融資）→ 200 `{ ok: true, mode: "auto", kind: "holdings", asOf: "2026-11-10", asOfStatus: "exact", rows }` 且第二列帶 `marginType: "margin"`。
    2. Mock Gemini 回 `kind: "trades"`, `asOf: null`, 1 列無 `date` → 200 `{ ok: true, kind: "trades", asOf: null, asOfStatus: "missing", rows: [{ date: "", dateAssumed: "missing", ... }] }`。
    3. Mock Gemini 回 `kind: "unknown"` 且有列 vs 空列（各自檢查 200 `ok: true` vs `ok: false`）；`503`、`429`、`422`、無金鑰與備援 Claude（`AI_CLAUDE_ENABLED=1`）皆有覆蓋。
- [ ] **跑測試確認失敗**：`node --test tests/ledger-import.test.mjs`，確認新測試因缺少 `parseAsOf`／`mode: "auto"` 而失敗，既有斷言維持通過。
- [ ] **最小實作**（`api/_lib/import.js`）：
  - 在 `parseTradeDate` 加第三參數 `opts = {}`，僅當 `opts.missingAsNull && !s` 回 `{ date: "", dateAssumed: "missing" }`。
  - 新增 `parseAsOf`、`detectMarginType`、`cleanAutoUnknownRows`、`AUTO_PROMPT`、`AUTO_SCHEMA`，在 `cleanRows`／`cleanTradeRows` 保留現股原鍵並條件展開 `marginType`（`SCHEMA`/`TRADES_SCHEMA`/`AUTO_SCHEMA` 加入 `marginType: { type: "STRING", nullable: true }` 與 `asOf` 屬性）。
  - `MODES` 保留 `holdings` 與 `trades` 的既有文案（含 `其他匯入方式`／`手動表格輸入`）不變，新增 `auto`；`viaGemini`/`viaClaude` 回傳 `kind` 與 `asOf`；`handler` 於 `mode === "auto"` 依 `r.kind` 套用 `cleanRows`、`cleanTradeRows(..., { missingAsNull: true })` 或 `cleanAutoUnknownRows`。
- [ ] **跑測試確認通過**：`node --test tests/ledger-import.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add api/_lib/import.js tests/ledger-import.test.mjs && git commit -m "import: 新增截圖自動辨識類型、基準日與融資融券標記"`

---

### Task 2：對帳儲存與規劃引擎 `learner/recon.js`（`window.KLRecon`）

**Files:**
- Create: `learner/recon.js`
- Create: `tests/recon.test.mjs`
- Modify: `tests/run.mjs:6`（註冊 `tests/recon.test.mjs`）

**Interfaces — Consumes (`KLLedger` optional / plain inputs) & Produces (`window.KLRecon`, `Object.freeze`):**
- Constants:
  - `VERSION = 1`, `STORE_KEY = "kline:pf:recon:v1"`, `MAX_BYTES = 120000`
  - `QTY_ABS_TOL = 1e-4`, `QTY_REL_TOL = 1e-6`, `COST_ABS_TOL = 0.5`, `COST_REL_TOL = 0.005`
  - `CONFLICT_KINDS`: `["recon_diff", "missing_cost", "missing_date", "ambiguous_date", "same_day_order", "possible_duplicate", "negative_position", "unknown_symbol", "unknown_side", "margin_separated"]`
- Functions:
  - `emptyStore()` → `{ v: 1, snapshots: [], conflicts: [], initialTags: {}, imports: [], audit: [] }`
  - `cloneStore(s)`: 深拷貝並規範預設陣列／物件，確保純函式不修改呼叫端輸入物件。
  - `validateStore(s)`: 檢查根物件、`v === 1`、陣列與物件型別、`snapshots` 每筆需含有效 `id`/`symbol`/`market`/`currency`/`date`／正 `shares`／`status`（`confirmed` 時 `avgCost` 必 `> 0`）、`conflicts`/`imports`/`audit`/`initialTags` 結構合法，並遞迴檢查**任何字串不可命中 `/data:image\//i` 或長度超過 2000 字元且符合 base64 字串規範**（命中即回 `{ ok: false, code: "image_not_allowed", ... }`）。
  - `deriveAvgCost(row)`: 當 `avgCost > 0` 直接回傳；否則依 `(shares * price - totalPnl) / shares` 或 `(marketValue - totalPnl) / shares` 推導正數均價（無法得出正數或分母 `<= 0` 一律回 `null`，絕不補 `0`）。
  - `pruneStore(s, maxBytes = MAX_BYTES)`: 永遠保留所有 `confirmed`／`pending` `snapshots`、所有 `status === "open"` `conflicts`、所有 `initialTags[id]?.active === true`、所有被任一 `open` conflict `batchId` 引用的 `imports[]`；優先裁剪超過保留量（`imports` 40 / `audit` 160 / `conflicts` 60 / 每檔 `superseded` 快照最新 3 筆）之最舊已結案記錄；若 `JSON.stringify(out).length > maxBytes`，再遞減保留額度直到小於等於 `maxBytes` 或僅剩不可裁剪核心。
  - `activeBaselines(s)` → `Map<symbol, snapshot>`（對每檔取 `status === "confirmed"` 中 `date` 最新、`date` 相同則 `confirmedAt` 最新，且 `supersededBy == null` 優先）；`hasConfirmedSnapshots(s)` → `boolean`。
  - `findRepeatHash(s, hashes = [])` → `{ hit: boolean, openConflicts: number, openImportIds: string[], resolvedCount: number }`（核對 `imports[].fileHashes`）。
  - `withinTolerance(simShares, simAvgCost, targetShares, targetAvgCost)` → `{ sharesOk, costOk, ok }`。
  - `planHoldingsSnapshot({ store, ledgerPositions, txStore, batchId, asOf, asOfStatus, altDate, rawAsOf, rows, fileHashes, method, today, ledgerLib })`: 為匯入預覽與確認產出三級分類（Level 1：可建 `confirmed` 新基準或容差內自動晉升 `S2`；早於 `S1` 設 `superseded` 留存歷史；Level 2：`missing_cost`、`missing_date`、`ambiguous_date`、`recon_diff`、`margin_separated`；同日已有未定序交易亦擋自動晉升進 Level 2；Level 3：`unknown_symbol`／無效股數）並附上兩邊差異原因訊息「⚠︎ 待對帳（差異 N 股）— 可能是近 2 個交易日還沒交割，或有交易還沒匯入」。
  - `applyHoldingsImport(store, plan, opts)` → `{ ok, store, batchId, appliedCount, conflictCount, errors }`（純函式回傳新 store，寫 `snapshots[]`、`conflicts[]`、`imports[]`、`audit[]`）。
  - `resolveConflict(store, conflictId, action, opts = {})` → `{ ok, store, effect }`：支援 `"keep_both"`（記原因與 `audit[]`，保留現有基準與雙邊數據）、`"accept_new"`（必須有非空 `reason` 才核准並把目標 `pending` 快照轉 `confirmed`、舊基準改 `superseded`）、`"keep_baseline"`（放棄新目標設 `superseded` 並結案衝突）、`"mark_before_snapshot"`／`"mark_after_snapshot"`（更新對應衝突或同日關係紀錄）。
  - `tagInitialTx(store, tx, opts)` / `untagInitialTx(store, txId, opts)` / `deactivateTagsForTx(store, txId, opts)`：對 `transfer_in` 標為期初快照／撤回／刪除停用（僅動 `kline:pf:recon:v1`：`initialTags`、`snapshots`、`conflicts`、`audit`，若有較晚 `B_newer` 依規格保留 `B_newer` 並檢核一致性；`tx.price <= 0` 時拒絕標記 `confirmed` 並要求先補均價／回 `{ ok: false, code: "missing_cost" }`）。

- [ ] **寫失敗測試**（`tests/recon.test.mjs`）：
  - `validateStore` 拒絕 `data:image/png;base64,...`、超過 2000 字元純 base64 字串、`confirmed` 缺正 `avgCost`（`0`／`null`／`-5`）、壞版本 `v: 2`。
  - `deriveAvgCost` 與 `withinTolerance` 精確數值驗證（含 `(shares*price - totalPnl)/shares`、`(marketValue - totalPnl)/shares`、無法推導時回 `null`）。
  - `pruneStore` 塞入 300 筆已結案 `imports`/`audit`/`conflicts` ＋ 20 筆 `superseded` 快照 ＋ 2 筆 `confirmed` ＋ 1 筆 `open` conflict 與關聯 `batchId`，設 `maxBytes: 12000` 斷言輸出 `< 12000`（實作預設上限 120KB）且 `confirmed`、`open` 衝突、啟用中 `initialTags` 與其關聯 `imports[]` 100% 保留。
  - `findRepeatHash` 檢出未決衝突與已結案同圖重傳；`planHoldingsSnapshot`／`applyHoldingsImport`／`resolveConflict` 覆蓋首次匯入、`S2 < S1` 早於基準、`S1→S2` 容差內自動晉升、`S1→S2` 超容差保留 `S1` 建 `recon_diff`、`missing_cost`、`missing_date`、`margin_separated` 隔離、`accept_new` 沒填 `reason` 拒絕、填完升級並寫 `audit[]`。
  - `tagInitialTx` → `untagInitialTx` → `tagInitialTx` 與有 `B_newer` 存在時之不替換＋刪除停用檢查。
- [ ] **跑測試確認失敗**：`node --test tests/recon.test.mjs`，預期因檔案尚未建立而失敗。
- [ ] **最小實作**（`learner/recon.js` ＋ `tests/run.mjs` 註冊 `tests/recon.test.mjs`）。
- [ ] **跑測試確認通過**：`node --test tests/recon.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/recon.js tests/recon.test.mjs tests/run.mjs && git commit -m "recon: 新增對帳快照、衝突、期初標記與容量控管引擎"`

---

### Task 3：統一計算入口 `KLLedger.buildReconciledLedger`、拆單防重複與備份驗證修正

**Files:**
- Modify: `learner/ledger.js:96-578`
- Modify: `tests/ledger.test.mjs:1-304`
- Modify: `tests/ledger-import.test.mjs:168-457`

**Interfaces — Consumes / Produces (`KLLedger` on `learner/ledger.js`):**
- `TYPE_LABEL`: 保留現有 12 種交易類型文案，另於計算歷程呈現時相容 `"snapshot"`（或提供 `TYPE_LABEL.snapshot = "庫存快照"` 而 `TYPES` 維持 12 種手動/匯入交易類型不變，不影響 `TYPES` 既有斷言）。
- `KLLedger.buildReconciledLedger(txStoreOrList, reconStore, opts = {})`:
  - 接收交易陣列或 `{ v: 1, method, transactions }` 及 `reconStore`（可 `null`/空）；回傳與 `buildLedger` 同結構物件，並擴充：
    - 每筆 `txResult` 附帶 `preSnapshot: boolean`、`sameDayRelation: "before_snapshot"|"after_snapshot"|"unresolved"|null`
    - 每個 `position` 附帶 `hasSnapshot: boolean`、`snapshotDate: string|null`、`snapshotId: string|null`、`pending: Array<{ code, shares?, conflictId?, baselineShares?, targetShares?, diffShares?, message }>`（同時保留既有 `fraction_unsettled` 提醒並併入該標的 open `conflicts[]` 如 `recon_diff`、`same_day_order`）；且於 `p.history` 在基準日 `B.date` 插入基準錨點紀錄 `{ date: B.date, id: B.id, type: "snapshot", shares: B.shares, costBasis: r2(B.shares * B.avgCost), avgCost: B.avgCost, isSnapshot: true }`，`preSnapshot` 交易則於 `p.history` 保留 `{ ..., preSnapshot: true, shares: 0, costBasis: 0, avgCost: null }`（使 `watch.html:2351` 建倉日偵測與 `perf.js:89` `sharesAt(d < B.date)` 一致得出 `0`）。
    - 頂層新增 `reconcile: { hasSnapshot: boolean, snapshotCount: number, openConflicts: Array, pendingSymbols: string[], unresolvedSameDayCount: number }`
  - 核心引擎規則：
    1. 有 `confirmed` 基準 `B`（`B.avgCost > 0`, `B.shares > 0`）時，於 `B.date` 先建立期初錨點 `shares = B.shares`, `costBasis = r2(B.shares * B.avgCost)`, `firstDate = B.date`；若 `method === "fifo"` 建立單一合成批次 `{ date: B.date, id: B.id, shares: B.shares, cost: r2(B.shares * B.avgCost), isSnapshot: true }`。
    2. 對該標的交易逐筆依時間判斷：
       - `t.id === B.tagTxId` 或 `initialTags[t.id]?.active === true` 且該標的存在有效確認基準、或 `t.date < B.date`：**照常跑 `checkTx`／`duplicate_id`／`currency_conflict`／另計費用驗證，於 `p.history` 標 `preSnapshot: true`（`shares: 0, costBasis: 0`），決不改變 `shares`／`costBasis`／`lots`／`realizedPnl`／`cash`／`totals`，不於 `< B.date` 觸發 `oversell` 或 `over_transfer`**。
       - `t.date === B.date`（非期初標籤本身）：若 `t.snapshotRelation === "before_snapshot"` 視為 `preSnapshot` 僅留歷史；若 `t.snapshotRelation === "after_snapshot"` 依當天與 `B.date` 後正常參與計算；**若未標明**則暫不異動基準持股（記為 `sameDayRelation: "unresolved"` 並進 `position.pending` 與 `reconcile.unresolvedSameDayCount`）。
       - `t.date > B.date`：完全按既有規則（含賣光歸零 `costBasis=0, lots=[], open=false` 後再買回重建、與之後真實賣超擋下 `oversell`）。
    3. 另計費用 `fee`（透過 `t.ref` 掛到目標交易 `o`）：若 `o` 為 `preSnapshot`，隨 `o` 一起視為 `preSnapshot` 不改寫快照後成本與現金流。
- `previewAdd(list, tx, opts)`、`deleteImpact(list, id, opts)`、`validateStore(s, opts)`、`prepareHoldingsImport(rows, existingTxs, opts)`、`prepareTradesImport(rows, existingTxs, opts)`：傳入 `opts.recon` 時一律改用 `buildReconciledLedger(..., opts.recon, ...)`（未傳時保留原 `buildLedger` 行為不變）。
- `prepareTradesImport` 同批 vs 跨批去重修正（Review Focus 2）：
  - `sim(seq)` 使用 `opts.recon ? buildReconciledLedger(..., opts.recon, ...) : buildLedger(...)`。
  - 只比對新匯入列與 `existingArr`（包含 `preSnapshot: true` 的已存明細）：核心簽章 `[date, type, symbol, shares, price]` 相符且若有明確不相等的 `time`/`note` 不誤判、其餘給 `possible_duplicate`；**移除**來自 `sim([...existingArr, ...seq])` 內部兩個匯入列之間互相比對造成的誤報 `possible_duplicate`（注意 direct `KLLedger.buildLedger()` 本身不動，維持 `tests/ledger.test.mjs:46` 原斷言）。
  - 另外針對匯入列若命中既有已確認基準的 `t.date < B.date` 或 `t.date === B.date` 未定序，標記對應審核資訊（`reconcileHint: "pre_snapshot" | "same_day_order" | "post_snapshot"`），且缺 `t.date` 時標出 `missing_date`。
- `checkBackup(data, opts = {})`（Review Focus 1）：
  - 不依 `Object.keys(data)` 順序：先判斷 `Object.prototype.hasOwnProperty.call(data || {}, "kline:pf:recon:v1")`。
  - 若存在 `kline:pf:recon:v1`：先 JSON 解析，**必須傳入 `opts.recon && typeof opts.recon.validateStore === "function"`**；否則直標 `ok: false`, `problems: ["沒有對帳快照的檢查程式，為了安全不匯入"]`，之後跑 `opts.recon.validateStore(parsed)` 並記錄 item；僅在 `recon` 存在且解析／檢查通過後，帶入 `{ today: opts.today, recon: parsed }` 呼叫 `validateStore(pfV1, ...)`。
  - 若存在 `kline:pf:recon:v1` 且 JSON 壞掉／版本或內容不合法，`items` 中該項標 `ok: false`，驗證 `kline:pf:v1` 時不依賴未驗證壞資料，整份 `checkBackup` 回 `ok: false`。

- [ ] **寫失敗測試**（`tests/ledger.test.mjs` ＋ `tests/ledger-import.test.mjs`）：
  - **Review Focus 1**（`tests/ledger.test.mjs`）：備份 JSON 把 `"kline:pf:v1"`（1/10 有基準 1000 股、1/15 賣出 300 股、無買進交易）故意排在 `"kline:pf:recon:v1"` **之前**：傳 `opts.recon = KLRecon` 必須回 `{ ok: true }`（不誤判 `oversell`）；刻意不傳 `opts.recon` 時**必須拒絕**（`ok: false`、「沒有對帳快照的檢查程式」）。
  - **Review Focus 2**（`tests/ledger-import.test.mjs`）：同一張截圖有兩筆完全同天同代號同股數同價買進（無 `time` 無 `fee`）→ `prepareTradesImport` 不可產生 `duplicates`／`possible_duplicate`；換成與 `existingArr`（含 `< B.date` 的 `preSnapshot` 交易）重複則須進 `duplicates`；而直接呼叫 `KLLedger.buildLedger()` 對同陣列兩筆完全相同列仍保留 `possible_duplicate` 提醒。
  - **Review Focus 3**（`tests/ledger.test.mjs` ＋ `tests/recon.test.mjs`）：`S1`（11/10 1000 股 @900）→ 11/12 賣 1000 股 @950（歸零，`costBasis=0, lots=[]`）→ 11/14 買 500 股 @920（均價與 FIFO 皆由 0 重建）→ 匯入 `S2`（11/15 500 股 @920＋手續費誤差容許內）自動晉升；改用數量 600 股或價差超容差 → 留 `S1` 建 `recon_diff`。
  - 補傳 `t.date < B.date` 買進／賣出不重複增加持股也不報快照前 `oversell`；`t.date === B.date` 未標順序時暫停異動並進 `pending`；標 `before_snapshot` 僅存歷史、標 `after_snapshot` 正常加減；`fifo` 與 `avg` 下賣出快照持股皆正確扣減單一合成批次與計入 `realizedPnl`；現金流與 `totals` 不因快照本身被虛增。
  - 保留空白／無快照行為：直接呼叫 `buildLedger()` 與不傳 `recon` 的既有測試全部維持通過。
- [ ] **跑測試確認失敗**：`node --test tests/ledger.test.mjs tests/ledger-import.test.mjs tests/recon.test.mjs`，確認新測試因缺少 `buildReconciledLedger`、拆單去重與 `checkBackup` 預掃而失敗。
- [ ] **最小實作**（`learner/ledger.js`）：抽取共用帳本執行核心（避免重複拷貝整段 `buildLedger`），實作 `buildReconciledLedger` 並匯出於 `KLLedger`；更新 `previewAdd`／`deleteImpact`／`validateStore`／`prepareHoldingsImport`／`prepareTradesImport`／`checkBackup`。
- [ ] **跑測試確認通過**：`node --test tests/ledger.test.mjs tests/ledger-import.test.mjs tests/recon.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/ledger.js tests/ledger.test.mjs tests/ledger-import.test.mjs && git commit -m "ledger: 新增 buildReconciledLedger 統一對帳入口、修復拆單誤判重複與備份驗證順序"`

---

### Task 4：`perf.js` 快照起點／現金口徑與 `overview.js` 全站警示

**Files:**
- Modify: `learner/perf.js:68-197`
- Modify: `learner/overview.js:13-86`
- Modify: `tests/perf.test.mjs:1-130`
- Modify: `tests/overview.test.mjs:1-82`

**Interfaces — Consumes / Produces:**
- `KLPerf.buildPerf(txs, opts = {})`（`learner/perf.js:70`）：
  - 移除 `.buildLedger(` 直接呼叫，統一改呼叫 `LG.buildReconciledLedger(txs, opts.recon || null, { method: opts.method, today: opts.today })`。
  - 當 `cur` 雖無帶代號交易但 `L.positions.some(p => p.currency === cur && (p.open || p.hasSnapshot))`（純快照無交易）時，**不跳過**（取代第 81 行 `!T.some(t => t.symbol)` 的早退）。
  - 取得該幣別的確認快照清單（`snapPositions`）：
    - 濾除 `preSnapshot` 交易對 `flows`、有效交易清單與 `lastTradePx` 的影響；僅計算自各檔基準日 `B.date`（含 `after_snapshot` 同日與 `t.date > B.date`）之後的交易。
    - `lastTradePx(sym, d)`：優先採用 `B.date <= t.date <= d` 之有效交易成交價；若沒有交易而 `d >= B.date` 則回退基準 `avgCost`（確保純快照於價格缺日有回退值）。
    - 對每個有 `hasSnapshot` 基準 `B` 的標的，於 `B.date` 插入初始投入現金流：若有 `books[B.symbol]` 在 `B.date` 當天收盤價則用 `B.shares * px.c`，否則用 `B.shares * B.avgCost` 並 `est.add("transfer_at_cost")`。
    - `sharesAt(sym, d)`：於 `d < B.date`（基準錨點之前）一律為 `0`；自 `B.date` 起反映快照基準股數加上快照後異動（`p.history` 在 `< B.date` 的 `preSnapshot` 紀錄已保持 `shares: 0`）。
    - `trunc` 檢查：使用該標的的有效起始日 `pos.hasSnapshot ? pos.snapshotDate : (pos.firstDate || start)`，因此早於 `B.date` 的 `preSnapshot` 歷史交易絕不誤觸 `history_truncated`。
    - 加入 `snapshot_baseline` 與 `recon_pending`（當任一持股 `pending.some(x => x.code === "recon_diff" || x.code === "same_day_order")`）至 `est`、`issues`（帶 `codes`／`diffs`）與 `KLPerf.REASON_LABEL`。
- `KLOverview.summarize(L, quotes, opts = {})`（`learner/overview.js:14`）：
  - 從 `L.positions` 與 `L.reconcile` 收集：
    1. 有快照基準（`L.reconcile?.hasSnapshot`）→ `issues.push({ k: "snapshot_baseline", count: L.reconcile.snapshotCount })`。
    2. 有待對帳衝突（`openConflicts` 或 `position.pending` 含 `recon_diff`/`same_day_order`）→ `alerts.push({ k: "recon_pending", codes, diffs, level: "warn" })` 與 `issues.push({ k: "recon_pending", codes, diffs })`；未納入快照或衝突時 `alerts`/`issues` 完全不變（相容既有 `tests/overview.test.mjs:46`）。
  - 更新 `ALERT_LABEL`、`ISSUE_LABEL` 加入 `recon_pending` 與 `snapshot_baseline` 文案。

- [ ] **寫失敗測試**（`tests/perf.test.mjs` ＋ `tests/overview.test.mjs`）：
  - **純快照績效**（無交易，只有 `2026-10-01` 台積電 1000 股均價 900，價格表由 `2026-10-01` 收 910 漲至 `2026-10-30` 收 1000）：`L.cash` 不動、`byCurrency.TWD` 存在且 TWR 與 MWR 從 `2026-10-01` 起算、`est` 含 `snapshot_baseline`（不含 `history_truncated`）。
  - **含補傳快照前歷史明細之績效**：存在 `2024-01-05` `transfer_in`（`preSnapshot: true`）但價格只到最近 24 個月（`2024-11-01` 起），而快照日為 `2026-10-01` → **不可誤報 `history_truncated`**，`flows` 與 `sharesAt` 在 `2026-10-01` 前為 `0`。
  - **缺快照日收盤價回退成本**：標記 `transfer_at_cost` ＋ `snapshot_baseline`；存在未決 `recon_diff` → `est` 與 `issues` 含 `recon_pending`。
  - **`KLOverview.summarize`**：純快照帳本正常算總資產、今日損益、累積損益；存在 `recon_diff` → `alerts` 與 `issues` 出現 `recon_pending`，並有 `ALERT_LABEL.recon_pending`。
- [ ] **跑測試確認失敗**：`node --test tests/perf.test.mjs tests/overview.test.mjs`。
- [ ] **最小實作**：更新 `learner/perf.js` 與 `learner/overview.js`。
- [ ] **跑測試確認通過**：`node --test tests/perf.test.mjs tests/overview.test.mjs`（連同既有測試全數通過）。
- [ ] **Batch 2 Commit**：`git add learner/perf.js learner/overview.js tests/perf.test.mjs tests/overview.test.mjs && git commit -m "perf: 支援對帳快照計算起點與總覽待對帳警示"`

---

### Task 5：`watch.html`（持股來源／跨分頁同步／原圖 SHA-256／`LAZY`）與 `tools.js` 備份預檢

**Files:**
- Modify: `learner/watch.html:1462, 2344-2375, 2398, 2658-2683`
- Modify: `learner/tools.js:793-806`

**Interfaces — Consumes (`KLRecon`, `KLLedger`) & Produces (`watch.html`, `tools.js`):**
- `LAZY.ledger`（`learner/watch.html:1462`）：改為 `["ledger.js", "recon.js", "ledger-ui.js"]`。
- `holdFromLedger(S, recon)`（`learner/watch.html:2346`）：呼叫 `KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: twIso() })`；回傳 `{ H, errors, txCount, snapshotCount, pendingSymbols }`；若 `p.pending.length` 有值（如 `recon_diff`/`same_day_order`），一併存入 `H[c].pending = p.pending` 讓持股明細列與 `holdDataCheck()` 顯示 `⚠︎ 待對帳（差異 N 股）`。
- `holdSrcApply()`（`learner/watch.html:2357`）：
  - 同時讀取 `rawPf = localStorage.getItem("kline:pf:v1")` 與 `rawRecon = localStorage.getItem("kline:pf:recon:v1")`。
  - 當 `(hasTx || hasConfirmedSnapshots)` 且 `!W.hsrcLegacy` 時進入交易帳本模式（確保 `store.lock` 鎖住 `kline:watch:hold` 唯讀）；若僅有快照尚無 `kline:pf:v1`，在記憶體構造虛擬 `S = S0 || { v: 1, method: "avg", transactions: [] }`（**不寫入 `localStorage`**）。
  - 快取鍵改為 `` `${twIso()}|${rawPf}|${rawRecon}` ``（修改交易或更新快照／衝突皆立即重算）。
  - 註冊 `window.addEventListener("storage", e => ...)`：當 `e.key === "kline:pf:v1" || e.key === "kline:pf:recon:v1"`（或 `e.key == null` 全清）時呼叫 `holdSrcApply()` 與 `renderList()`（Review Focus 4 ＋ Scenario 18）。
- `holdSrcBar()`（`learner/watch.html:2368`）：
  - 有交易時**必須保留**字串 `持股來自<b>交易紀錄</b>（${n} 筆交易...）` 相容既有正則 `/持股來自交易紀錄（2 筆交易）/`（並附 `・${snapN} 檔快照基準` 與有未決衝突時 `[data-hsrc="tx-recon"]` `⚠︎ 待對帳（${pendN} 檔）` 按鈕）。
  - 僅有快照尚無交易時顯示：`持股來自<b>交易帳本</b>（${snapN} 檔期初快照）`。
  - 保留 `[data-hsrc="tx-imp"]` 導向統一匯入視窗、`[data-hsrc="legacy"]`「改看舊庫存」與 `[data-hsrc="ledger"]`「改看交易紀錄／帳本」；`holdSrc` 點擊 `[data-hsrc="tx-recon"]` 跳轉 `W.holdView = "tx"; (W.lg ||= {}).view = "tx";` 並捲往頂部衝突中心。
  - 保留 `renderHold()` line 2398 文案 `交易紀錄裡目前沒有...`（相容 `tests/e2e/hold-source.test.mjs:63` 正則 `/交易紀錄裡目前沒有台股持股/`）。
- `#impFile` `change`（`learner/watch.html:2658`）：
  - 當 `ledger = imp.scope === "ledger"`：
    1. **必須在呼叫 `Promise.all(files.map(shrink))` 之前**，讀取原始 `await file.arrayBuffer()` 並用 `crypto.subtle.digest("SHA-256", buf)` 轉成 64 碼小寫十六進位雜湊陣列 `fileHashes`。
    2. 傳送請求 `{ images, mode: "auto" }`（非 ledger 舊庫存截圖仍維持 `{ images, mode: "holdings" }`，不動舊流程）。
    3. 呼叫 `lgOnImportRows(j.rows || [], j.kind || j.mode || "unknown", { asOf: j.asOf ?? null, asOfStatus: j.asOfStatus ?? null, altDate: j.altDate || "", rawAsOf: j.rawAsOf || "", fileHashes })`。
- `tools.js` `syncImport(file)`（`learner/tools.js:793-806`）：
  - 若 `pfKeys.includes("kline:pf:recon:v1") && typeof KLRecon === "undefined"`，明確動態載入 `recon.js`（失敗即拋錯「載入對帳資料的檢查程式失敗，沒有匯入（這台的資料維持原樣）」並中止）。
  - 呼叫 `KLLedger.checkBackup(j.data, { today: toolsDay(), margin, rebal, thesis, recon: typeof KLRecon !== "undefined" ? KLRecon : null })`。
  - `pfTxt` 納入對帳項目摘要（快照數與未決衝突數）；保留既有 `tools.js:816` `交易紀錄或融資資料超過 150KB，雲端同步不會帶到` 提示文案涵蓋所有超過 150KB 的 `kline:pf:*` 鍵（如 `kline:pf:recon:v1`）。

- [ ] **寫／補測試準備**：確認 `hold-source.test.mjs`、`backup-pf.test.mjs` 既有選擇器與訊息不被破壞。
- [ ] **最小實作**：改動 `learner/watch.html`（`LAZY.ledger`、`holdFromLedger`、`holdSrcApply`、`holdSrcBar`、`renderHold` 行內待對帳標籤、`storage` 監聽與 `[data-hsrc="tx-recon"]`、`#impFile` 原圖 SHA-256 ＋ `mode: "auto"`）與 `learner/tools.js`（載入 `recon.js` ＋ `checkBackup` 傳 `recon` ＋ 摘要）。
- [ ] **跑相關 E2E 驗證**：`PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/watch.html learner/tools.js && git commit -m "watch: 整合持股來源對帳快取、跨分頁同步與原圖雜湊檢查"`

---

### Task 6：`learner/ledger-ui.js` 統一匯入入口、三級審核、對帳中心與績效／配置／期初標記

**Files:**
- Modify: `learner/ledger-ui.js:12-105, 152-216, 268-338, 579-625, 1254-1708`

**Interfaces — Consumes (`KLLedger`, `KLRecon`, `KLPerf`, `KLAlloc`) & Produces (`ledger-ui.js` globals / UI handlers):**
- 共用讀寫與唯讀快照帳本輔助：
  - `lgReconLoad()` → `KLRecon.cloneStore(store.get("pf:recon:v1", KLRecon.emptyStore()))`（無 `KLRecon` 時回預設空物件）。
  - `lgReconSave(nextRecon)` → 先跑 `KLRecon.pruneStore(nextRecon, KLRecon.MAX_BYTES)` 與 `KLRecon.validateStore(...)`，失敗即回錯不寫盤；成功寫入 `store.set("pf:recon:v1", pruned)` 並呼叫 `if (typeof holdSrcApply === "function") holdSrcApply()`、`pfExpire?.()`。
  - `lgStoreOrEmpty()` → 回傳 `lgLoad() || { v: 1, method: "avg", transactions: [] }`（**只讀不寫 `kline:pf:v1`**）。
  - `lgSave(s)`：傳入 `recon: lgReconLoad()` 至 `KLLedger.validateStore(s, { today: lgToday(), recon: lgReconLoad() })`（先有基準後有賣出的帳本才不會在編輯／切換算法／刪除時被誤擋）。
- **統一匯入視窗（移除二選一卡片）**：
  - `lgOpenImport()`（`L1254`）直接開單一入口：`[data-lgimp-upload]`「📷 上傳券商截圖（自動辨識庫存／交易明細）」（觸發 `#impFile`），搭配次要按鈕「手動新增空白列」（保留選擇器供手 key）、若有開放衝突則顯示「查看待對帳項目（N）」，**不再出現 `[data-lgimp-pick="holdings"|"trades"]`**。
  - `lgOnImportRows(rows, detectedKind, meta = {})`：
    - 接收 `{ asOf, asOfStatus, altDate, rawAsOf, fileHashes }`；支援 `detectedKind === "holdings" | "trades" | "unknown"`。
    - 頂部顯示識別結果橫幅：「系統辨識結果：庫存快照／交易明細／類型尚未確定＋基準日狀態」，並提供一鍵切換鈕 `[data-lgimp-switch="holdings"|"trades"]`（不重呼 AI 即可就地轉型重排）。
    - **原圖 SHA-256 非阻斷提醒**：呼叫 `KLRecon.findRepeatHash(recon, meta.fileHashes)`，若有未結案衝突則頂部顯示非阻斷黃條（含前往衝突按鈕 `[data-lg="view-conflicts"]`），若先前已完整匯入亦提示供參考，**絕不阻擋**儲存按鈕。
    - **日期預帶與確認**：若 `kind === "trades"` 且有非空有效 `asOf`（`exact`/`year`），空白列自動預帶 `asOf`（加小字標「帶入截圖基準日」並允許逐列修改）；若連 `asOf` 都 `missing` 或 `asOfStatus === "mdy"`／`invalid`，頂部或列內亮起修正框（保持既有 `[data-lgimp-dflip]`／`[data-lgimp-dok]`）。
    - **融資／融券自動隔離**：偵測到 `marginType === "margin" | "short"` 時預設 `on: false`（不勾選入現股），歸入 Level 2 `margin_separated` 並於頂部／列內顯示引導卡片「偵測到融資／融券部位已隔離，避免混入現股成本 → [前往配置與風險 → 融資管理](`[data-lg="view" data-v="margin"]`)」。
    - **三級分流狀態徽章＋部分失敗不擋其他列**：對每列標記 `Level 1（自動處理）／Level 2（請確認差異或補欄位）／Level 3（問題列暫停入帳，取消勾選即不擋其餘有效列）`。當 `recon_diff` 發生時顯示 spec 規定文案「`⚠︎ 待對帳（差異 N 股）— 可能是近 2 個交易日還沒交割，或有交易還沒匯入`」。
    - 保留原本全部鍵盤無障礙（focus trap、`aria-invalid`、IME Enter 防誤送、粘滯首欄與 `.hg-wrap.scrollLeft = 0`）。
  - `lgSaveImport()`：
    - 若 `kind === "holdings"`：經 `KLRecon.planHoldingsSnapshot` 與 `KLRecon.applyHoldingsImport` 將快照／衝突／原圖雜湊／審核歷程存入 `kline:pf:recon:v1`（**不把庫存快照寫成 `transfer_in` 塞進 `kline:pf:v1`**）。若只有快照且尚無 `kline:pf:v1` 亦可正常瀏覽。
    - 若 `kind === "trades"`：先確保通過 `prepareTradesImport(..., { recon })`、寫入有效交易至 `kline:pf:v1`，並同步將該批次的 `imports[]`、`audit[]`（及若觸及 `B.date` 同日交易則產出待定序 `same_day_order` 提醒或衝突）寫進 `kline:pf:recon:v1`。
- **交易紀錄頁頂部「待對帳與衝突中心」＋「匯入與稽核歷史抽屜」＋「標為期初快照／撤回」**：
  - `renderLedger()`（`L40–95`）：
    - 放寬 `L44-51`：只要 `hasTx || hasConfirmedSnapshots || hasOpenConflicts`，直接套用 `lgStoreOrEmpty()` 進入對應子頁（不再退回 `lgIntroHtml()`）。
    - `L60`、`L203`、`L580`（`renderAlloc`）、`L178`（`deleteImpact`）全面改為 `KLLedger.buildReconciledLedger(..., lgReconLoad(), ...)` 與傳入 `recon: lgReconLoad()`。
    - `L76` 持倉歷史列 `KLLedger.TYPE_LABEL[h.type] || (h.type === "snapshot" ? "庫存快照" : h.type)` 與 `h.preSnapshot` 標註「快照前歷史」並顯示 `—` 持股變更，避免出現 `"undefined"`。
    - 頂部若有開放衝突：渲染「待對帳項目（N）」卡片，每筆逐條並列雙邊數值（帳本推算 `baselineShares` / 均價 vs 新截圖 `targetShares` / 均價 ＋ 差異 `N` 股 ＋ T+2 未交割或漏傳提示），按鈕動作：`[data-lgrecon-keep]`（保留兩邊待釐清，寫 `audit`）、`[data-lgrecon-imp]`（補匯入明細 → 直接開 `lgOpenImport()`）、`[data-lgrecon-accept]`（採信新快照，需輸入必填原因並核准晉升）、與同日交易專用的 `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`。
    - 下方設 `<details class="lgrecon-hist"><summary>匯入紀錄與對帳稽核（N 筆）</summary>...</details>` 顯示 `imports[]`（時間、類型、原圖雜湊前 8 碼、`fileHashes`、各級列數、基準日）與 `audit[]`。
    - `transfer_in` 交易列按鈕：未標記顯示 `[data-lg="tag-init"]`「標為期初快照」（缺成本／`price<=0` 引導補均價不建 `0` 基準）；已標記顯示「已標為期初快照」徽章＋`[data-lg="untag-init"]`「撤回期初快照標記」；刪除帶有啟用 `initialTags` 的 `transfer_in` 時於確認對話框提醒並呼叫 `KLRecon.deactivateTagsForTx`。
- **績效與配置整合**（`L268–338` & `L579–608`）：
  - `lgPerfData(S)`：自 `S.transactions` 與 `KLRecon.activeBaselines(lgReconLoad())` 聯集收集 `syms` 與 `curs`（支援純快照抓日 K）。
  - `renderPerf(S)`：當 `!S.transactions.length && !hasConfirmedSnapshots` 才顯示空白訊息；呼叫 `KLPerf.buildPerf(S, { ..., recon: lgReconLoad() })`；`ISS` 新增 `snapshot_baseline` 與 `recon_pending` 中文說明，頁頂加統一 `⚠︎ 待對帳（差異 N 股）` 警示列。
  - `renderAlloc(S)`：若 `hasTx || hasConfirmedSnapshots`，呼叫 `buildReconciledLedger` 並傳遞 `meta: { legacy: false, hasSnapshot: L.reconcile.hasSnapshot, openConflicts: L.reconcile.openConflicts, pendingSymbols: L.reconcile.pendingSymbols }` 至 `renderAllocBody`、`rbSectionHtml`、`stSectionHtml`，且於配置頁頂部顯示一致 `⚠︎ 待對帳（差異 N 股）` 警示條與「用已確認快照的股數試算」說明。

- [ ] **寫／補測試準備**：對照 Spec 六「驗收標準 18 項」確認每個 DOM attribute（`data-lgimp-upload`, `data-lgimp-switch`, `data-lgrecon-*`, `data-lg="tag-init"`, `data-lg="untag-init"`）與現有保留選擇器（`data-lgimp-dflip`, `data-lgimp-dok`, `data-lgimp-mv`, `data-lgimp-rev`, `#lgImpOrderOk`, `#lgImpDup`, `#lgImpSave`, `#impLive`）。
- [ ] **最小實作**（`learner/ledger-ui.js`）：逐一補上 `lgReconLoad`／`lgReconSave`／`lgStoreOrEmpty`、統一匯入 HTML 與事件、對帳中心／稽核抽屜／期初標記操作、`renderLedger`/`lgPerfData`/`renderPerf`/`renderAlloc` 更新並傳 `recon`。
- [ ] **跑單元檢核**：`node --test tests/unit.test.mjs tests/ledger.test.mjs tests/ledger-import.test.mjs tests/recon.test.mjs` 通過。
- [ ] **Batch 2 Commit**：`git add learner/ledger-ui.js && git commit -m "ledger-ui: 統一匯入入口、三級對帳審核表、衝突處理中心與期初標記"`

---

### Task 7：全站其餘投資組合頁面與防繞過靜態檢查

**Files:**
- Modify: `learner/pf-home.js:7-62`
- Modify: `learner/pf-rebal.js:8-54`
- Modify: `learner/pf-stress.js:20-55`
- Modify: `learner/pf-divcal.js:19-43`
- Modify: `learner/pf-report.js:5-38`
- Modify: `learner/pf-thesis.js:67-93`
- Modify: `tests/recon.test.mjs`（加入全專案 `.buildLedger(` 防繞過靜態單元測試）

**Interfaces — Consumes (`KLLedger.buildReconciledLedger`, `lgReconLoad`, `lgStoreOrEmpty`, `KLOverview`, `KLPerf`) & Produces:**
- 統一共用邏輯：各頁面取得 `const recon = typeof lgReconLoad === "function" ? lgReconLoad() : null;` 與 `const L = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: ... });`。
- 若 `L.reconcile?.openConflicts?.length` 或 `L.reconcile?.pendingSymbols?.length`：產出統一待對帳提示 banner HTML（顯示 `⚠︎ 待對帳（${sym} 差異 ${diff} 股）` ＋ 點擊跳往 `[data-lg="view" data-v="tx"]` 按鈕，於 `pf-report.js` 列印區亦保留文字警示列）。
- 各檔具體改動：
  1. `learner/pf-home.js`（`L10, 28, 29, 38, 50, 54`）：`hmTrendData` 傳 `{ ..., recon: lgReconLoad() }` 給 `KLPerf.buildPerf`；`renderHomeView` 改 `buildReconciledLedger`、放寬 `!S.transactions.length && !L.reconcile.hasSnapshot` 才顯示空頁、傳 `recon` 至 `KLOverview.summarize`、渲染 `⚠︎ 待對帳（<標的> 差異 N 股）` 警示按鈕（`goOf = a => a.k === "recon_pending" ? "tx" : ...`）與 `ISSUE_LABEL`。
  2. `learner/pf-rebal.js`（`L8-54`）：若 `meta.hasSnapshot || meta.openConflicts?.length || open.some(p => p.hasSnapshot)`，卡片內顯示 `⚠︎ 待對帳（差異 N 股）` 提醒（若有衝突）及明確標註「**用已確認快照的股數試算**」。
  3. `learner/pf-stress.js`（`L20-55`）：`[data-pst="beta"]` 點擊改讀 `const S = typeof lgStoreOrEmpty === "function" ? lgStoreOrEmpty() : lgLoad()` ＋ 檢查有交易或已確認快照後呼叫 `KLLedger.buildReconciledLedger`；`stSectionHtml(open, X, cashB, meta = {})` 若有待對帳／快照則顯示 `⚠︎ 待對帳（差異 N 股）` 與「**用已確認快照的股數試算**」。
  4. `learner/pf-divcal.js`（`L21-43`）：改用 `buildReconciledLedger`，頂部展示 `⚠︎ 待對帳（差異 N 股）` 警示（如適用）。
  5. `learner/pf-report.js`（`L8-38`）：改用 `buildReconciledLedger`、放寬 `!S.transactions.length && !L.reconcile.hasSnapshot` 才退回空頁；報告頁頂與明細列印內容一併顯示「⚠︎ 待對帳（差異 N 股）」與期初快照基準說明（`report.css` 列印模式 `#lx .rpt` 內呈現）。
  6. `learner/pf-thesis.js`（`L69-93`）：改用 `buildReconciledLedger`、頁頂與對應個股論點卡片顯示 `⚠︎ 待對帳（差異 N 股）`。

- [ ] **寫失敗靜態防繞過測試**（於 `tests/recon.test.mjs`）：讀取所有 `learner/*.js` 與 `learner/watch.html`，移除註解／字串前先檢查 `\.buildLedger\(`（或逐行排除 `learner/ledger.js`），在 6 支 `pf-*.js` 尚有 `.buildLedger(` 時應正確抓出並失敗。
- [ ] **跑測試確認失敗**：`node --test tests/recon.test.mjs` 抓出剩餘 `pf-*.js` 的 `.buildLedger(`。
- [ ] **最小實作**：依上述逐檔更新 `pf-home.js`、`pf-rebal.js`、`pf-stress.js`、`pf-divcal.js`、`pf-report.js`、`pf-thesis.js`。
- [ ] **跑靜態防繞過＋全數單元測試確認通過**：`node --test tests/recon.test.mjs tests/perf.test.mjs tests/overview.test.mjs tests/ledger.test.mjs tests/ledger-import.test.mjs tests/unit.test.mjs` 全數 0 違規通過。
- [ ] **Batch 2 Commit**：`git add learner/pf-home.js learner/pf-rebal.js learner/pf-stress.js learner/pf-divcal.js learner/pf-report.js learner/pf-thesis.js tests/recon.test.mjs && git commit -m "pf: 投資組合全站頁面改用統一對帳計算並加入防繞過檢查"`

---

### Task 8：E2E 測試：18 項驗收與 Review Focus 案例、既有測試遷移與擴展

**Files:**
- Create: `tests/e2e/portfolio-reconcile.test.mjs`
- Modify: `tests/e2e/ledger-import.test.mjs:1-733`（僅遷移入口選擇器 `[data-lgimp-pick]` → `[data-lgimp-upload]`、請求 `mode: "auto"`＋mock `kind`／`asOf` 與 holdings 改驗證寫入 `kline:pf:recon:v1`；保留 100% 原斷言與嚴格門檻）
- Modify: `tests/e2e/hold-source.test.mjs:1-67`（擴增：空白純快照＋跨分頁 `storage` 事件即時更新）
- Modify: `tests/e2e/backup-pf.test.mjs:1-65`（擴增：備份含 `kline:pf:v1` 排 `kline:pf:recon:v1` 之前先賣後買正常匯入、含 base64 圖片／壞 `recon` 整份拒絕）

**Interfaces — Tested UI Selectors & State Keys:**
- Upload & review selectors: `[data-lg="imp"]`, `[data-hsrc="tx-imp"]`, `[data-lgimp-upload]`, `[data-lgimp-switch="holdings"|"trades"]`, `[data-lgrecon-keep]`, `[data-lgrecon-accept]`, `[data-lgrecon-imp]`, `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`, `[data-lg="tag-init"]`, `[data-lg="untag-init"]`.
- Storage keys: `"kline:watch:hold"`, `"kline:pf:v1"`, `"kline:pf:recon:v1"`.

- [ ] **寫／遷移測試（390px 手機 ＋ 1280px 桌面，全 mock `/api/import` 與報價／日 K）**：
  - `tests/e2e/portfolio-reconcile.test.mjs` 完整覆蓋 Spec「必測情境 18 項」與「Review Focus 1–5」：
    - Case 1, 16：完全空白帳本僅匯入庫存快照（有 `asOf`）→ 建立 `kline:pf:recon:v1` `confirmed` 快照，8 個投資組合頁（總覽、持股損益/屬性、交易紀錄、績效、配置再平衡/壓力測試、股利、報告與論點）全正常顯示、不寫入空 `pf:v1`、不動 `kline:watch:hold`、0 console error、無水平溢出。
    - Case 2, 3, 4：匯入早於快照日歷史明細（標 `preSnapshot: true`、持股不重複疊加）、晚於快照日買進、晚於快照日賣出（以快照均價計算已實現損益）。
    - Case 5：同張截圖上傳兩次（原圖 SHA-256 `fileHashes` 未決提醒不擋儲存）；同批兩筆同價成交不誤報重複；跨批同簽章進 Level 2 確認。
    - Case 6, 13, 14：`S1 → S2` 容差內（含中間賣光歸零再買回）自動晉升；超容差保留 `S1` 建 `recon_diff` 與全站 8 頁 `⚠︎ 待對帳（差異 N 股）`、T+2 提示，並測解決衝突（採信新快照須理由並留稽核／保留兩邊／點補明細）。
    - Case 7, 8, 9, 10：缺 `asOf`（`missing`）與歧義日期（`mdy`）進 Level 2；多股混合各分級獨立判定；Level 3 失敗列不擋同批有效列；同日交易與快照先後選擇後才套用；`kind === "unknown"` 就地一鍵切換不重呼 `/api/import`。
    - Case 11, 12, 15, 17, 18：`imports[]`＋`audit[]` 稽核抽屜；融資／融券自動隔離並引導「融資」頁；`transfer_in`「標為期初快照 → 撤回 → 再標記」；兩個 Context 測試跨分頁 `storage` 事件即時重算 `W.hold`。
  - `tests/e2e/ledger-import.test.mjs`：
    - 移除 `[data-lgimp-pick="holdings"]`/`[data-lgimp-pick="trades"]` 前置點擊步驟，改由 `[data-lg="imp"]` 直按 `[data-lgimp-upload]` 並斷言送出 `body.mode === "auto"`；mock 回應傳回對應 `kind` 與明確 `asOf`（並補 1 組缺 `asOf` 測 Level 2 與一鍵切換）；原 holdings 測試最後改驗證 `kline:pf:recon:v1.snapshots`（含 `asOf` 日期與 `confirmed` 均價）與 `W.hold` 一致性及舊庫存不動，其餘所有測試（日期修正、斜線切換、`fee`/`tax` 與折扣、同日序列、FIFO 同日排序、sticky col 1、`scrollLeft === 0`、IME Enter 防誤送、焦點管理與 390/1280 零溢出）完全保留。
  - `tests/e2e/hold-source.test.mjs` ＋ `tests/e2e/backup-pf.test.mjs`：補齊 Review Focus 1 & 4 的瀏覽器端測試（含 390/1280）。
- [ ] **跑相關 E2E 測試**：
  - `PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/portfolio-reconcile.test.mjs tests/e2e/ledger-import.test.mjs tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs tests/e2e/pf-mobile.test.mjs tests/e2e/pf-tablet-kbd.test.mjs`
  - 確認全數通過且 `errs`（console error／pageerror）全空。
- [ ] **Batch 2 Commit**：`git add tests/e2e/ && git commit -m "test: 新增庫存自動對帳 E2E 驗收測試並遷移統一匯入測試"`

---

### Task 9：文件更新、390／1280 截圖檢視、合入 `main` 與升版送審

**Files:**
- Create / Modify: `docs/portfolio/RECONCILE.md`（對帳規範與三層資料口徑文件）、`docs/portfolio/LEDGER.md`、`docs/portfolio/HOLD_SOURCE.md`、`docs/portfolio/BACKUP.md`、`docs/portfolio/PERFORMANCE.md`、`docs/portfolio/OVERVIEW.md`
- Auto-updated via `bump-version.mjs`: `learner/index.html`, `learner/watch.html`, `learner/version.json`, `learner/README.md`

- [ ] **更新 `docs/portfolio/*.md`**：補上 `kline:pf:recon:v1`、三層資料分層、`buildReconciledLedger` 統一計算入口、備份檢查順序、`perf.js` 快照起點口徑與統一匯入流程。
- [ ] **390px 手機與 1280px 桌面截圖實際檢視**：
  - 透過 Playwright 在 390×844 與 1280×800 開啟：統一上傳對話框、含 Level 1/2/3 與融資隔離的三級審核表、交易紀錄頁「待對帳項目卡片＋歷史稽核抽屜」、及「總覽／持股／績效／配置／報告」帶 `⚠︎ 待對帳（差異 N 股）` 狀態，截圖存於 `/tmp/` 並實際開圖檢視確認無溢出、無重疊、文字完整可讀。
- [ ] **執行本機完整受影響測試矩陣**：
  - 單元測試：`node --test tests/recon.test.mjs tests/ledger.test.mjs tests/ledger-import.test.mjs tests/perf.test.mjs tests/overview.test.mjs tests/unit.test.mjs`
  - E2E 測試：`PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/portfolio-reconcile.test.mjs tests/e2e/ledger-import.test.mjs tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs tests/e2e/pf-mobile.test.mjs tests/e2e/pf-tablet-kbd.test.mjs`
  - （如條件允許亦可執行 `node tests/run.mjs` 完整回歸；若只跑上述清單須於 PR 誠實條列。）
- [ ] **同步 `main` 並升版**：
  - `git fetch origin main && git merge origin/main`（解決衝突；不可 rebase／squash）
  - `node scripts/bump-version.mjs "庫存入口收斂與自動對帳" "統一截圖匯入入口自動辨識庫存／明細與日期，新增獨立對帳基準 kline:pf:recon:v1 與全站統一計算與待對帳標示"`
  - `node tests/unit.test.mjs`
- [ ] **集中推送與更新 PR**：
  - 一次 `git push` 更新遠端 `gemini/portfolio-auto-reconcile` 分支，將 Draft PR 改為正式標題（例如 `feat(portfolio): 項目一 入口收斂與自動對帳`）、更新 PR Template（含完整實測清單與 `Closes #308` 或 `Part of #308` 依項目二規劃決定），並轉 `Ready for review`，等候同一 head SHA 的 CI `test` 全綠後通知獨立審查者（Claude Code／ChatGPT）與使用者，未經明確授權不合併。
