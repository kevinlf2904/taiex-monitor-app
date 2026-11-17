# 庫存入口收斂與自動對帳實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將分散的庫存與交易明細匯入收斂為單一「匯入資料」入口，後端 `/api/import` 在單次請求自動辨識截圖類型（`holdings`／`trades`／`unknown`）、畫面基準日（`asOf`）與融資／融券標記；前端以獨立鍵 `kline:pf:recon:v1`（`learner/recon.js`）與 `KLLedger.buildReconciledLedger` 建立「交易紀錄 × 庫存快照 × 計算持倉」三層架構與自動對帳中心，消除補傳歷史明細重複入帳與漏算賣超，並讓全站 8 個投資組合頁面、持股頁與 `perf.js` 使用同一個真相源且一致標示 `⚠︎ 待對帳（差異 N 股）`。

**Architecture:** 原始交易流水帳續留 `localStorage["kline:pf:v1"]`；庫存快照基準（含 `scope: "full" | "partial"` 與清倉結案 `origin: "full_snapshot_close"`）、對帳差異衝突、同日交易先後標記（`sameDayRelations`）、舊 `transfer_in` 期初標記、匯入記錄（含 `shrink()` 前的原圖 SHA-256）、唯加寫的稽核滾動視窗（超過 120KB 容量上限才依時間由舊起淘汰，一般操作不得刪改），以及跨鍵寫入 Write-Ahead Journal（`pendingCommit`）獨立存於 `localStorage["kline:pf:recon:v1"]`（`learner/recon.js`；嚴禁存圖片／base64；核心超 120KB fail-closed 拒寫）。計算層由 `KLLedger.buildReconciledLedger(txStoreOrList, reconStore, opts)` 以「各檔最新已確認快照 `B` ＋ 快照後交易」錨定計算（FIFO V1 把快照視作單一合成批次），全站除 `ledger.js` 本身外全面改用統一入口。

**Tech Stack:** 原生 HTML／JS、Vercel Serverless Function（Node 24 ESM）、`node --test`、Playwright（`PW=/opt/node22/lib/node_modules/playwright`）。

**Spec:** `docs/superpowers/specs/2026-11-16-portfolio-auto-reconcile-design.md`

---

## Global Constraints

- **不碰既有用戶存檔**：絕不清除、重建或自動遷移 `kline:watch:hold` 與 `kline:pf:v1`；純舊庫存無交易且無已確認快照時，舊庫存編輯、文字匯入、舊截圖與資料完全不變。
- **獨立對帳鍵、容量 fail-closed 與 `store.set` 檢查**：對帳資料僅讀寫 `kline:pf:recon:v1`（`v: 1`）；`KLRecon.validateStore` 遇到 `/data:image\//i` 或超過 2000 字元的疑似 base64 字串直接拒絕；`KLRecon.pruneStore(s, 120000)` 永遠保留 `confirmed`/`pending` 快照、所有 `status === "open"` 衝突、啟用 `initialTags`、`sameDayRelations`、未結案 `pendingCommit` 與關聯 `imports[]`，僅由舊到新裁剪已結案歷史。若清空可裁剪歷史後仍 `> maxBytes`，強制回傳 `{ ok: false, code: "core_data_exceeds_limit", bytes, maxBytes, store: null }`；寫盤前檢查 `pruneStore().ok` 與 `store.set(...)` 布林回傳值，任一失敗皆中止且不覆寫現有資料。
- **跨雙鍵可恢復提交協議＋併發鎖＋stale-base＋受阻出口**：凡同時異動 `kline:pf:v1` 與 `kline:pf:recon:v1` 的操作（`import_trades`、`deactivate_tags` 刪除期初標記 `transfer_in`、`update_tx_tag` 修改期初標記 `transfer_in`），一律包在 `withPfCommitLock` 內（瀏覽器採 `navigator.locks.request("kline:pf:commit", ...)`，若瀏覽器缺 `navigator.locks` 則跨分頁關鍵寫入 fail-closed 回 `cross_tab_lock_unavailable`，僅 Node 單元測試無 `window` 環境才用同進程 promise queue）經 `lgCommitDualStores` ＋ `KLRecon.txFingerprint`（固定 `fp1` cyrb128）／`prepareCommit`／`finalizeCommit`／`recoverCommit` 執行 Phase 1→2→3。`recoverCommit` 保持純函式無副作用；`lgRecoverPersist()`、`lgCommitDualStores`、`lgSave`、`lgReconSave`、`resolveHalted` 與 `syncApply`/`syncImport` 一律在鎖內重讀兩鍵 raw 字串並比對 expected base（不符拒寫 `stale_write`）；`storage` 事件只重算畫面、不寫回。`import_trades` 部分存在、指紋不符或 `curHash !== pfNextHash`／`pfBaseHash` 不符一律 `inconsistent_halted`（不自動清 WAL），受阻時由 `[data-lgrecon-halted]` 提供二次確認的 `discard_wal`／`revert_pre_commit`（含回退前現況指紋＋標籤狀態守門 `revert_conflict_modified`）出口。同日定序（`sameDayRelations`）單鍵存於 `kline:pf:recon:v1`，套用前核對 `snapshotId`/`snapshotDate`/`t.date`。
- **快照完整度、市場與日期安全閘道**：`snapshotScope`（`"full" | "partial"`）必須明確確認，決不自動預設 `"full"`；僅 `asOfStatus === "exact" && asOf <= today`（或使用者明確確認且 `<= today`）可建立 `confirmed` 基準，缺年份 `asOfStatus: "year"` 與未來日 `asOfStatus: "future"` 必進 Level 2。全站以大寫規範 `symbol` 為主鍵並於 `KLRecon.validateStore` 與 `buildReconciledLedger` 雙重強制單一 `(symbol, market, currency)`（`tw/TWD`, `us/USD`）。
- **統一計算入口（防繞過）**：除 `learner/ledger.js` 本身以外，全專案 `learner/*.js` 與 `learner/watch.html` **不得出現任何 `.buildLedger(` 呼叫**（以靜態單元測試把關），一律呼叫 `KLLedger.buildReconciledLedger`；舊版快取分頁產生的孤兒／失效 `initialTags` 必須降級為一般交易並提醒而非錯算。
- **備份與雲端同步鍵配對與 Fail-Closed**：`KLLedger.checkBackup` 先掃描 `data` 是否存在 `kline:pf:recon:v1`（若 `pendingCommit != null` 或缺 `opts.recon?.validateStore` 或市場衝突即拒絕）；`tools.js` `syncImport` 遇唯一問題為 `pendingCommit != null` 時提供二次確認後以 `resolveHalted(..., "discard_wal")` 剔除再重驗的出口；雲端同步（`syncSnap`/`syncPush`/`syncPull`/`syncBoot`）將 `kline:pf:v1` 與 `kline:pf:recon:v1` 視為不可拆分的同步單位，本機 `pendingCommit != null` 時**上傳與 `PF_PAIR` 下載套用一併暫停**，下載套用前必跑 `checkBackup` 並於鎖內／CAS 套用。
- **零外部網路／付費 AI 呼叫**：所有單元與 E2E 測試一律使用固定假資料與 mock `/api/import`（或 mock `fetch`／AI 函式），不連外網、不花費額度。
- **範圍與批次紀律**：
  - **Batch 1（已完成）**：設計規格與實作計畫已納入第一至四輪獨立審查 P1–P3 所有修正。
  - **Batch 2（本階段）**：依 Task 1–9 採 TDD 施作（同步執行 `/Modern Web Guidance` 無障礙與表單／對話框最佳實踐）、跑齊指定測試與 390／1280 截圖檢視後集中推送並轉 Ready。
  - **不做項目二無框視覺設計**：不調整 `.pfcard`、`.pftile`、`#stcss` 或 `core.css`／`minimal.css` 的無框版面（沿用現有樣式與 44px 觸控高度）。
  - 提交訊息與 PR 內文不出現 AI 工具或模型名稱；未經使用者明確授權不合併。

---

## Review Focus

1. **備份 JSON 鍵序倒置、含 `pendingCommit` 出口與雲端雙鍵同步配對**（`checkBackup`、`syncImport`、`syncSnap`/`syncPush`/`syncPull`/`syncBoot`）：不可拆開同步 `pf:v1` 與 `pf:recon:v1`、有 `pendingCommit` 時不可上傳或直接套用；備份遇 `pendingCommit != null` 預設拒匯並提供二次確認剔除出口 → **Task 3** ＋ **Task 5**。
2. **同一截圖同天同價分批兩筆成交 vs 跨批重複 vs 直接呼叫 `buildLedger()`**：同一批內兩筆 `2454 buy 500 @ 1050` 在 `prepareTradesImport` 不可誤報 `possible_duplicate`；跨批比對 `existingArr`（含 `preSnapshot: true`）須標進 Level 2；而直接呼叫 `KLLedger.buildLedger()` 對同陣列重複列仍維持既有提醒 → **Task 3**。
3. **兩張快照跨過「全數賣光歸零再買回」**：`S1` → 賣光 `0` 股（`costBasis = 0, lots = []`）→ 再買進 → `S2`，期間重播與容差（數量 `max(1e-4, S2*1e-6)`、均價 `max(0.5, S2.avgCost*0.005)`）須能正確晉升或偵測差異 → **Task 3**。
4. **純快照空白帳本（含完整快照結案歸零，無 `kline:pf:v1` 或 `transactions: []`）顯示全站 8 頁＋個股損益**：`holdSrcApply`、`watch.html`、`renderLedger`、`renderAlloc`、`lgPerfData`/`renderPerf`、`pf-home`、`pf-stress` Beta 按鈕、`pf-divcal`、`pf-report`、`pf-thesis`、`perf.js` 一律透過唯讀 `lgStoreOrEmpty()` 正常運算呈現，不退回介紹頁、全數清倉後不誤退回 `kline:watch:hold`、不預寫空 `kline:pf:v1` → **Task 4** ＋ **Task 5** ＋ **Task 6** ＋ **Task 7**。
5. **後端 `api/_lib/import.js` 向下相容**：直接呼叫 `parseTradeDate(null/""/"   ", today)` 與 `cleanTradeRows(rows, opts)`（未傳 `missingAsNull: true`）仍維持 `{ date: refToday, dateAssumed: "today" }`；`marginType` 僅在偵測到信用交易關鍵字時採條件展開附加，一般現股鍵集合與既有 `deepEqual` 測試完全一致 → **Task 1**。
6. **跨雙鍵 WAL 提交協定、併發鎖與受阻出口**：`txFingerprint` 採固定 `fp1`（cyrb128）並附測試向量；`import_trades` 存完整 `txs`＋`pfBaseHash` 且部分存在／不符一律 `inconsistent_halted`；`update_tx_tag` 依固定順序區分同狀態修改；雙分頁由 `navigator.locks`＋CAS 保護且 `storage` 不寫回；受阻時有 `resolveHalted` 兩個出口與 UI → **Task 2** ＋ **Task 5** ＋ **Task 6** ＋ **Task 8**。
7. **快照 `full` vs `partial` 語意、同日／舊版孤兒標籤與 `(symbol, market, currency)` 一致性**：`sameDayRelations` 須核對 `snapshotId`/`snapshotDate`/`t.date`；舊版分頁改壞的 `initialTags` 降級為一般交易並於 `staleTags[]` 提醒；同 `symbol` 不同市場於 `validateStore`／`planHoldingsSnapshot`／`buildReconciledLedger` 一律拒絕（`currency_conflict`）→ **Task 2** ＋ **Task 3** ＋ **Task 4** ＋ **Task 5** ＋ **Task 6**。
8. **缺年份（`asOfStatus: "year"`）跨年與未來日（`asOfStatus: "future"`）嚴格門檻**：僅 `exact && asOf <= today`（或使用者明確確認且 `<= today`）可建 `confirmed`；`year`（含 `01/05` 掃到 `12/28` 跨年前一年）與 `future` 強制進 Level 2 並陳原始與推定日期 → **Task 1** ＋ **Task 2** ＋ **Task 6**。
9. **120KB 核心超限 fail-closed 契約與依市場分流之交割提示**：核心保留物件超限時 `pruneStore` 回 `{ ok: false, code: "core_data_exceeds_limit" }` 且寫盤前拒寫不蓋舊檔；交割提示區分 `tw`（台股 T+2）、`us`（美股 T+1）、未知／混合（中性文案）→ **Task 2** ＋ **Task 4** ＋ **Task 6** ＋ **Task 7**。

---

### Task 1：後端 `/api/import` 自動辨識、`asOf` 與融資／融券條件標記

**Files:**
- Modify: `api/_lib/import.js:1-251`
- Modify: `tests/ledger-import.test.mjs:1-167`（擴增單元測試，保留 L1–166 既有斷言不動）

**Interfaces — Consumes / Produces:**
- Exported helpers from `api/_lib/import.js`:
  - `parseTradeDate(raw, today = taipeiToday(), opts = {})`: 未傳 `opts.missingAsNull: true` 時，空字串／`null`／純空白續回 `{ date: refToday, dateAssumed: "today" }`；傳入 `{ missingAsNull: true }` 時回 `{ date: "", dateAssumed: "missing" }`。
  - `parseAsOf(raw, today = taipeiToday())` → `{ asOf: string|null, asOfStatus: "exact"|"year"|"mdy"|"future"|"invalid"|"missing", altDate?: string, rawAsOf?: string }`。空白／`null` 必回 `{ asOf: null, asOfStatus: "missing" }`；無年份 `MM/DD` 若當年候選日 `> today` 自動跨年回前一年，回 `year` 並保留 `rawAsOf`；帶年份且規範化後 `> today` 回 `future` 並保留 `rawAsOf`；歧義回 `mdy` 並附 `altDate`/`rawAsOf`。
  - `cleanRows(rows)` & `cleanTradeRows(rows, opts = {})`: 新增 `detectMarginType(r)`，僅在匹配 `/融資|融券|資買|資賣|券買|券賣|credit|\bmargin\b|\bshort\b/i`（先判 `/券賣|融券|券買|\bshort\b/i` 為 `"short"`，否則為 `"margin"`）時以條件展開 `...(marginType ? { marginType } : {})` 附加上去；`cleanTradeRows` 透傳 `{ missingAsNull: opts.missingAsNull }` 給 `parseTradeDate`。
  - `MODES.auto` (`AUTO_PROMPT`, `AUTO_SCHEMA`): `viaGemini` / `viaClaude` 除 `rows` 與 `model` 外亦保留 `kind` 與 `asOf`；`POST /api/import`（`handler`）支援 `mode: "auto"`，省略或 `""` 仍預設 `"holdings"`，不支援的 `mode` 仍回 HTTP `400`。當 `r.kind === "unknown"` 時以 `cleanAutoUnknownRows(r.rows, { today, missingAsNull: true })` 同步正規化股票識別欄位、日期（缺日回 `""`/`"missing"`）、方向、股數、價格、均價與條件 `marginType`，讓前端一鍵切換類型時無須重呼 AI。
  - HTTP `200` 回應（`mode === "auto"`）：`{ ok: true, mode: "auto", kind: "holdings"|"trades"|"unknown", asOf, asOfStatus, ...(altDate ? { altDate } : {}), ...(rawAsOf ? { rawAsOf } : {}), rows, model }`；當 `kind === "unknown"` 且清理後 `rows.length === 0` 時回 200 `{ ok: false, kind: "unknown", asOf, asOfStatus, error: "無法辨識這張截圖是庫存還是交易明細，且沒有讀出有效資料列。" }`；有有效列則回 `{ ok: true, mode: "auto", kind: "unknown", ... }` 讓前端於檢視表切換類型，不重呼 AI。

- [ ] **寫失敗測試**（`tests/ledger-import.test.mjs`，全 mock `fetch`／AI 函式，不連外網）：
  - `parseTradeDate` 不傳 `missingAsNull` 時續回 `today`；傳 `{ missingAsNull: true }` 時空白回 `{ date: "", dateAssumed: "missing" }`（Review Focus 5）。
  - `parseAsOf` 分別測：精確日期（`exact`）、缺年份同年 `05/12`（`year` ＋ `rawAsOf`）、**缺年份跨年** `today = "2026-01-05"` 測 `"12/28"` → `{ asOf: "2025-12-28", asOfStatus: "year", rawAsOf: "12/28" }`（Review Focus 8）、**未來日** `"2026-12-31"`／`"115/12/31"`（`asOfStatus: "future"` ＋ `rawAsOf`）、斜線歧義 `05/12/2026`（`mdy` ＋ `altDate`/`rawAsOf`）、無效日 `2026/02/30`（`invalid`）與空值（`missing` 且 `asOf: null`）。
  - `cleanRows` 與 `cleanTradeRows` 測現股列維持原物件鍵（`!("marginType" in row)`，既有 `deepEqual` 不破），融資／資買輸出 `marginType: "margin"`、融券／券賣輸出 `marginType: "short"`。
  - `POST /api/import` 設 `mode: "auto"`：
    1. Mock Gemini 回 `kind: "holdings"`, `asOf: "115/11/10"`, 2 檔台股（含 1 檔融資）→ 200 `{ ok: true, mode: "auto", kind: "holdings", asOf: "2026-11-10", asOfStatus: "exact", rows }` 且第二列帶 `marginType: "margin"`。
    2. Mock Gemini 回 `kind: "holdings"`, `asOf: "12/28"`（`today` 較早跨年）及 `"2026-12-31"`（未來日）→ 原樣輸出 `asOfStatus: "year" | "future"` 與 `rawAsOf`。
    3. Mock Gemini 回 `kind: "trades"`, `asOf: null`, 1 列無 `date` → 200 `{ ok: true, kind: "trades", asOf: null, asOfStatus: "missing", rows: [{ date: "", dateAssumed: "missing", ... }] }`。
    4. Mock Gemini 回 `kind: "unknown"` 且有列 vs 空列（各自檢查 200 `ok: true` vs `ok: false`）；`503`、`429`、`422`、無金鑰與備援 Claude（`AI_CLAUDE_ENABLED=1`）皆有覆蓋。
- [ ] **跑測試確認失敗**：`node --test tests/ledger-import.test.mjs`，確認新測試因缺少 `parseAsOf`／`mode: "auto"` 而失敗，既有斷言維持通過。
- [ ] **最小實作**（`api/_lib/import.js`）：
  - 在 `parseTradeDate` 加第三參數 `opts = {}`，僅當 `opts.missingAsNull && !s` 回 `{ date: "", dateAssumed: "missing" }`。
  - 新增 `parseAsOf`（含 `year` 跨年回推與 `future` 判定）、`detectMarginType`、`cleanAutoUnknownRows`、`AUTO_PROMPT`、`AUTO_SCHEMA`，在 `cleanRows`／`cleanTradeRows` 保留現股原鍵並條件展開 `marginType`（`SCHEMA`/`TRADES_SCHEMA`/`AUTO_SCHEMA` 加入 `marginType: { type: "STRING", nullable: true }` 與 `asOf` 屬性）。
  - `MODES` 保留 `holdings` 與 `trades` 的既有文案（含 `其他匯入方式`／`手動表格輸入`）不變，新增 `auto`；`viaGemini`/`viaClaude` 回傳 `kind` 與 `asOf`；`handler` 於 `mode === "auto"` 依 `r.kind` 套用 `cleanRows`、`cleanTradeRows(..., { missingAsNull: true })` 或 `cleanAutoUnknownRows`。
- [ ] **跑測試確認通過**：`node --test tests/ledger-import.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add api/_lib/import.js tests/ledger-import.test.mjs && git commit -m "import: 新增截圖自動辨識類型、基準日與融資融券標記"`

---

### Task 2：對帳儲存、容量失敗契約與規劃／WAL 引擎 `learner/recon.js`（`window.KLRecon`）

**Files:**
- Create: `learner/recon.js`
- Create: `tests/recon.test.mjs`
- Modify: `tests/run.mjs:6`（註冊 `tests/recon.test.mjs`）

**Interfaces — Consumes (`KLLedger` optional / plain inputs) & Produces (`window.KLRecon`, `Object.freeze`):**
- Constants:
  - `VERSION = 1`, `STORE_KEY = "kline:pf:recon:v1"`, `MAX_BYTES = 120000`
  - `QTY_ABS_TOL = 1e-4`, `QTY_REL_TOL = 1e-6`, `COST_ABS_TOL = 0.5`, `COST_REL_TOL = 0.005`
  - `CONFLICT_KINDS`: `["recon_diff", "missing_cost", "missing_date", "ambiguous_date", "same_day_order", "possible_duplicate", "negative_position", "unknown_symbol", "unknown_side", "margin_separated", "currency_conflict"]`
- Functions:
  - `emptyStore()` → `{ v: 1, snapshots: [], conflicts: [], initialTags: {}, sameDayRelations: {}, pendingCommit: null, imports: [], audit: [] }`
  - `cloneStore(s)`: 深拷貝並規範預設陣列／物件（包含 `sameDayRelations: {}` 與 `pendingCommit: null`，快照補正規大寫 `symbol` 與預設 `scope: "partial"`、`origin: "import"`），確保純函式不修改呼叫端輸入物件。
  - `validateStore(s, opts = {})`:
    - 檢查根物件、`v === 1`、陣列與物件型別、`snapshots` 每筆需含有效 `id`/正規大寫 `symbol`/`market`（`"tw"|"us"`）/`currency`（`"TWD"|"USD"` 且 `CURRENCY[market] === currency`）/`date`/`scope`（`"full"|"partial"`）/`origin`（`"import"|"tx_tag"|"full_snapshot_close"`）；
    - 當 `origin === "full_snapshot_close"` 時允許 `shares === 0, avgCost === null, scope === "full"`；非 `full_snapshot_close` 一律要求 `shares > 0` 且 `confirmed` 時 `avgCost > 0`；
    - **同一 `symbol` 市場約束**：掃描全部快照（及開放衝突）確保同 `symbol` 不得同時出現不同 `market`／`currency`（否則 `{ ok: false, code: "currency_conflict", symbol }`）；
    - **未來日期保護**：若有 `opts.today`（或預設台北今日），任何 `status === "confirmed"` 快照之 `date > opts.today` 一律拒絕（`{ ok: false, code: "future_snapshot_date", symbol, date }`）；
    - `sameDayRelations` 與 `pendingCommit` 結構檢查：未傳 `opts.rejectPendingCommit`（一般載入）時，只要 `s.pendingCommit` 為含字串 `id`/`op` 之非陣列物件即放行保留（即使 `op` 屬未知操作亦不整份駁回，留待 `recoverCommit` fail-closed）；當 `opts.rejectPendingCommit` 為真且 `s.pendingCommit != null` 回 `{ ok: false, code: "unrecovered_pending_commit" }`（供 `checkBackup` 拒絕未收斂 WAL 備份）；
    - 遞迴檢查**任何字串不可命中 `/data:image\//i` 或長度超過 2000 字元且符合 base64 字串規範**（命中即回 `{ ok: false, code: "image_not_allowed", ... }`）。
  - `settlementHint(market)`: `tw` 回 `"可能是近 2 個交易日尚未交割（台股 T+2），或有交易還沒匯入"`；`us` 回 `"可能是前 1 個交易日尚未交割（美股 T+1），或有交易還沒匯入"`；其他／混合回 `"可能有尚未反映的交割或未匯入交易"`。
  - `deriveAvgCost(row)`: 當 `avgCost > 0` 直接回傳；否則依 `(shares * price - totalPnl) / shares` 或 `(marketValue - totalPnl) / shares` 推導正數均價（無法得出正數或分母 `<= 0` 一律回 `null`，絕不補 `0`）。
  - `pruneStore(s, maxBytes = MAX_BYTES)`:
    - 永遠保留所有 `confirmed`／`pending` `snapshots`、所有 `status === "open"` `conflicts`、所有 `initialTags[id]?.active === true`、所有 `sameDayRelations`、正在進行尚未結案的 `pendingCommit`、以及所有被任一 `open` conflict `batchId` 引用的 `imports[]`。
    - 優先裁剪超過保留量（`imports` 40 / `audit` 160 / `conflicts` 60 / 每檔 `superseded` 快照最新 3 筆）之最舊已結案記錄；若仍 `> maxBytes`，遞減保留額度直到全清已結案歷史；
    - **結構化成功／失敗結果**：達標回 `{ ok: true, store, bytes, maxBytes, trimmed }`；若將所有可裁剪歷史清除後 `JSON.stringify(out).length > maxBytes`，**不得靜默放行**，強制回傳 `{ ok: false, code: "core_data_exceeds_limit", bytes, maxBytes, store: null }`。
  - `activeBaselines(s)` → `Map<symbol, snapshot>`（以大寫 `symbol` 為鍵取 `status === "confirmed"` 中 `date` 最新、`date` 相同則 `confirmedAt` 最新，且 `supersededBy == null` 優先；**包含** `origin === "full_snapshot_close"` 的 `shares: 0` 結案基準以錨定出清日）；`hasConfirmedSnapshots(s)` → `boolean`（任一 `status === "confirmed"` 即為 `true`）。
  - `findRepeatHash(s, hashes = [])` → `{ hit: boolean, openConflicts: number, openImportIds: string[], resolvedCount: number }`（核對 `imports[].fileHashes`）。
  - `withinTolerance(simShares, simAvgCost, targetShares, targetAvgCost)` → `{ sharesOk, costOk, ok }`。
  - **WAL Commit Helpers（純函式）**：
    - `txFingerprint(tx)` → `string`：依 Spec 固定 `fp1`（`canon(v)` 遞迴省 `undefined` 鍵並字典序排鍵 ＋ cyrb128 UTF-16 code unit 雜湊 → `` `fp1:${32 hex}:${len}` ``）與 `pfStoreHash(pfStore)`；附帶 Spec 5 組固定測試向量。
    - `planDeactivateTags(store, prevTxsOrSingle, opts = {})` → `{ ok, needsWal, payload?, previewRecon?, errors? }`：檢查待刪交易是否帶有 `initialTags[tx.id]?.active`，產生 `{ batchId, op: "deactivate_tags", at, deletedTxIds, prevTxs, prevTxHashes, prevTagStates, targetTagStates, staged: { audit } }`（其中 `TagSnapshotState` 為 `{ active, snapshotId, snapshotStatus, snapshotDate, snapshotShares, snapshotAvgCost, supersededBy }`）與模擬完成後之 `previewRecon`（保留原正數 `avgCost`/`shares`、不動更晚 `B_newer`）。
    - `planUpdateTxTag(store, prevTx, nextTx, opts = {})` → `{ ok, needsWal, mode?: "update"|"deactivate", payload?, previewRecon?, errors? }`：若 `prevTx` 無啟用 `initialTags` 或 `txFingerprint(prevTx) === txFingerprint(nextTx)` 則回 `{ ok: true, needsWal: false, previewRecon }`；否則依 `nextTx` 是否仍為合法 `transfer_in`（同正規大寫 `symbol`/`market`/`currency`、`date <= today`、`shares > 0`、`price > 0`）決定 `mode: "update"` 或 `"deactivate"`，產生包含 `txId`, `mode`, `prevTx`, `prevTxHash`, `nextTxHash`, `prevTagState`, `targetTagState`, `staged: { conflicts?, audit }`（均具確定性 `id`，若存在更晚基準 `B_newer` 亦僅更新／停用該 `tx_tag` 並於必要時建立 `recon_diff`，決不破壞 `B_newer`）與模擬 `previewRecon`。
    - `prepareCommit(store, payload)` → `{ ok: true, store }` 或 `{ ok: false, code: "pending_commit_exists" | "unknown_wal_op" | "invalid_wal_payload" | "wal_noop", error }`：驗證 `store.pendingCommit == null`、`op` 屬白名單（`"import_trades" | "deactivate_tags" | "update_tx_tag"`）與各 `op` 必要欄位（`import_trades` 必備 `txs`、`txHashes`、`pfBaseHash`、`pfNextHash`；`deactivate_tags` 必備 `deletedTxIds`、`prevTxs`、`prevTxHashes`、`prevTagStates`、`targetTagStates`；`update_tx_tag` 必備 `prevTx`、`prevTxHash !== nextTxHash` 與完整前後 `TagSnapshotState`；所有雜湊須為 `fp1:` 前綴），寫入 `pendingCommit` 回傳 `{ ok: true, store }`。
    - `finalizeCommit(store, batchId)` → `{ ok: true, store }` 或 `{ ok: false, code }`：核對 `pendingCommit.id === batchId` 與合法 `op`/欄位；套用 `targetTagStates` / `targetTagState`（`update_tx_tag` 更新既有關聯 `tag.snapshotId` 快照及 `initialTags[txId].txHash = nextTxHash` 或停用標籤＋快照、`deactivate_tags` 停用標籤＋快照）、依 `id` 去重冪等合併 `staged`（`imports`/`conflicts`/`audit`/`initialTags`/`sameDayRelations`）、並設 `pendingCommit: null`。
    - `recoverCommit(pfStore, reconStore)`（純函式無副作用）→ `{ changed: boolean, status: "noop"|"rolled_forward"|"aborted"|"inconsistent_halted"|"unknown_op_halted", code?, op?, reconStore }`：
      1. **非白名單／壞結構／未知指紋前綴 Fail-Closed**：`pendingCommit` 非純物件或缺失必要結構（或指紋非 `fp1:`）回 `status: "inconsistent_halted"`；`op` 非 `"import_trades"|"deactivate_tags"|"update_tx_tag"` 回 `status: "unknown_op_halted"` — **兩者一律完整保留原 `pendingCommit` 不動（`changed: false`），絕不靜默設為 `null`**；
      2. **`import_trades`（預設 Fail-Closed，不再自動 partial_recovered）**：計算 `curHash = pfStoreHash(pfStore)` 並逐筆核對 `txs` 存在與 `txFingerprint === txHashes[id]`：全在且逐筆指紋符合 → Roll-Forward (`finalizeCommit`，若 `curHash !== pfNextHash` 於 `audit[]` 註記 `pf_changed_after_commit`)；全不在且 `curHash === pfBaseHash` → Clean Abort（`pendingCommit: null`）；部分存在（`wal_partial_import`）、任一存在交易指紋不符（`wal_tx_mismatch`）或全不在但 `curHash !== pfBaseHash`（`wal_external_modification`）→ 一律 `inconsistent_halted`（完整保留 `pendingCommit` 與內含 `txs`）；
      3. **`deactivate_tags`**：比對 `pfStore.transactions`（需同時檢核存在與 `txFingerprint === prevTxHashes[id]`）及 `recon` 之 `matchesTagState`（對照 `prevTagStates` / `targetTagStates`）：全仍在且指紋＋標籤為 `prevTagStates` → Clean Abort（不動交易／標籤／audit）；全已刪且標籤為 `prevTagStates` 或 `targetTagStates` → 冪等 Roll-Forward；其餘部分或指紋不符 → `inconsistent_halted`（保留 WAL）；
      4. **`update_tx_tag`**：禁止僅依 `txId` 存在與否判定；以 `actualTx` 之 `actualTxHash` 與 `matchesTagState(actualTag, actualSnap, ...)` 對照，**固定先比對 `prevTxHash` 再比對 `nextTxHash`**（解決只改備註時 `prevTagState` 與 `targetTagState` 相等的衝突）：
         - `actualTxHash === prevTxHash` 且 `matchesTagState(..., prevTagState)` → Phase 1 Clean Abort（清 WAL、不寫 `staged`）；
         - `actualTxHash === nextTxHash` 且 `matchesTagState(..., prevTagState)` → Phase 2→3 Roll-Forward（更新／停用標籤、更新 `txHash = nextTxHash` 與快照、去重合併 `staged`、清 WAL）；
         - `actualTxHash === nextTxHash` 且 `matchesTagState(..., targetTagState)` → Phase 3 殘留／重複執行冪等 Roll-Forward（去重補齊 `staged`、清 WAL，重複執行 `audit[]` 零重複）；
         - 其餘一切狀態（交易消失、第三版本指紋、`prevTxHash`＋不符 `prevTagState`、`nextTxHash`＋第三標籤態）→ `inconsistent_halted`（`code: "wal_inconsistent_state"`，完整保留 `pendingCommit` 不清）。
    - `resolveHalted(pfStore, reconStore, choice, opts = {})` → `{ ok, pfStore, reconStore, pfChanged, code?, error? }`：實作受阻狀態（及備份匯入剔除 `pendingCommit`）的兩個明確出口：`choice === "discard_wal"`（保留 `pfStore` 不動、清 `pendingCommit: null`、將對應不到的 `initialTags` 停用為 `superseded` 並寫 `halted_resolved_discard_wal` 稽核）與 `choice === "revert_pre_commit"`（若 WAL 含完整回退資料，還原 `pfStore` 移除新 `txs` 或回復 `prevTxs`/`prevTx`、還原 `prevTagState(s)`、清 `pendingCommit: null` 並寫 `halted_resolved_revert` 稽核；`unknown_op_halted` 不允許 `revert_pre_commit`）。
  - `planHoldingsSnapshot({ store, ledgerPositions, txStore, batchId, asOf, asOfStatus, asOfConfirmed = false, altDate, rawAsOf, snapshotScope = "partial", rows, fileHashes, method, today, ledgerLib })`:
    - `snapshotScope` 僅接受明確 `"full"` 否則一律視為 `"partial"`（絕不自動猜 `"full"`）；
    - **日期門檻**：僅當 `(asOfStatus === "exact" && asOf <= today) || (asOfConfirmed === true && isValidDate(asOf) && asOf <= today)` 才允許進入 Level 1 建立 `confirmed`；`asOfStatus === "year"`、`"future"`、`"mdy"`、`"invalid"`、`"missing"`（未確認）**一律進 Level 2**；
    - **市場／幣別衝突**：比對同 `symbol` 與既有 `store.snapshots` 及 `txStore?.transactions`（大寫正規化），不一致列直接歸入 Level 3 `currency_conflict`；
    - **完整快照清倉處理（`snapshotScope === "full"` 且日期確認）**：對每個不在本次截圖列正規化 `presentSymbols` 之既有 `activeBaselines` `S1`（`S1.shares > 0 && S1.date < asOf`），重播 `(S1.date, asOf]`：無未定序同日且 `simShares <= EPS` → 排程 `full_snapshot_close` (`status: "confirmed"`, `shares: 0`, `avgCost: null`, `scope: "full"`) 關閉 `S1`；否則（`simShares > EPS` 或有未決同日）→ 排程 `pending` `full_snapshot_close` 快照＋Level 2 `recon_diff`（`targetShares: 0`, `diffShares: -simShares`, `payload: { reason: "missing_in_full_snapshot", previousSnapshotId: S1.id }`），保留 `S1` 不關閉。`snapshotScope === "partial"` 時未出現在截圖列之既有 `S1` 一切不動；
    - 差異文案一律呼叫 `settlementHint(market)`。
  - `applyHoldingsImport(store, plan, opts)` → `{ ok, store, batchId, appliedCount, conflictCount, errors }`（純函式回傳新 store，寫 `snapshots[]`（含 `scope` 與 `full_snapshot_close`）、`conflicts[]`、`imports[]`（含 `snapshotScope`）、`audit[]`）。
  - `resolveConflict(store, conflictId, action, opts = {})` → `{ ok, store, effect }`：支援 `"keep_both"`、`"accept_new"`（必填 `reason`；同時支援一般 `pending` 快照與 `missing_in_full_snapshot` 之 `pending` `full_snapshot_close` 核准關閉 `S1`）、`"keep_baseline"`（放棄新目標設 `superseded` 並結案衝突）、`"mark_before_snapshot"`／`"mark_after_snapshot"`（更新 `sameDayRelations[txId]` 並連帶記錄 `snapshotId`/`snapshotDate` 與結案衝突，不修改 `kline:pf:v1`）。
  - `tagInitialTx(store, tx, opts)` / `untagInitialTx(store, txId, opts)` / `deactivateTagsForTx(store, txId, opts)`：對 `transfer_in` 標為期初快照（連帶寫入 `txHash: txFingerprint(tx)`）／撤回／停用（僅動 `kline:pf:recon:v1`；檢查 `tx.date <= opts.today` 及市場一致性；`tx.price <= 0` 回 `{ ok: false, code: "missing_cost" }`）。

- [ ] **寫失敗測試**（`tests/recon.test.mjs`）：
  - `validateStore` 拒絕：`data:image/png;base64,...`、超過 2000 字元純 base64 字串、`confirmed` 缺正 `avgCost`（非 `full_snapshot_close`）、壞版本 `v: 2`、**`tw/USD` 錯配與跨快照同 `symbol` 不同 `market/currency`（`currency_conflict`）**、**`confirmed` 日期大於 `today`（`future_snapshot_date`）**、一般載入允許未知 `op` 之 `pendingCommit` 保留、`{ rejectPendingCommit: true }` 下任何 `pendingCommit != null` 一律拒絕。
  - `txFingerprint`：Spec 五組固定向量逐字比對（含鍵序重排＋`undefined` 屬性＋中文 `note`＋`{}`）；任一交易屬性異動指紋改變。
  - `deriveAvgCost`、`withinTolerance` 與 `settlementHint("tw" | "us" | "")`（T+2 vs T+1 vs 中性文案）精確驗證。
  - `pruneStore`：
    1. 正常裁剪：塞入 300 筆已結案 `imports`/`audit`/`conflicts` ＋ 20 筆 `superseded` 快照 ＋ `confirmed`/`open`/啟用 `initialTags`/`sameDayRelations`/`pendingCommit`/關聯 `imports[]`，斷言 `< maxBytes` 且核心永存；
    2. **不可裁剪核心超限（Review Focus 9）**：塞入大量 `confirmed`／`open` conflicts 使核心資料超出 `maxBytes`（例如 8000），斷言回 `{ ok: false, code: "core_data_exceeds_limit", store: null }` 且不靜默放行。
  - **WAL Commit Protocol 全情境測試（Review Focus 6）**：
    1. `import_trades`：Phase 1 Clean Abort（`pfBaseHash` 相符）；Phase 2→3 Roll-Forward（全部 `txs` 指紋相符）；連叫兩次 `recoverCommit` 零重複 `imports[]`/`audit[]`；**部分 ID 存在、同 ID 內容指紋不同、全部不存在但 `pfBaseHash` 不符**皆回 `inconsistent_halted` 且保留 `pendingCommit`＋完整 `txs`（不遺失交易）；
    2. `deactivate_tags`（刪除已標記期初 `transfer_in`，含無 `B_newer` 與另有較晚 `B_newer` 兩種狀況）：Phase 1 Clean Abort；Phase 2→3 Roll-Forward（不破壞 `B_newer`）；重複執行 `recoverCommit` 零重複 `audit[]`；部分或指紋不符之 `inconsistent_halted`；
    3. `update_tx_tag`（修改已標記期初 `transfer_in`）：
       - **模式 `"update"`**（含與 `B_newer` 並存）：Phase 1 Clean Abort、Phase 2→3 Roll-Forward、Phase 3 殘留＋連叫兩次 `recoverCommit`（零重複 `audit[]`）；
       - **只改備註（`prevTagState` 與 `targetTagState` 深度相等）**：`actualTxHash === prevTxHash` 走 Clean Abort，`actualTxHash === nextTxHash` 走 Roll-Forward，不誤判 Fail-Closed；
       - **模式 `"deactivate"`**（改為 `buy`／`price: 0`／改代號）：Clean Abort、Roll-Forward（原正 `avgCost` 不被寫為 `0`）、重複恢復零重複 `audit[]`；
       - **部分／不一致 Fail-Closed**：`actualTx` 遺失、`actualTxHash` 被改成第三版本、`actualTxHash === prevTxHash` 但 `recon` 已成不等之 `targetTagState`、`actualTxHash === nextTxHash` 但 `recon` 成第三狀態 → 全回 `status: "inconsistent_halted"` 且 `reconStore.pendingCommit` 原樣保留；
    4. **未知／壞結構／未知指紋前綴 `op` Fail-Closed**：`op: "future_unknown_v2"` 或指紋非 `fp1:` 或缺少必要欄位 → `recoverCommit` 回 `unknown_op_halted` / `inconsistent_halted` 且**原封保留 `pendingCommit`**；`prepareCommit` 遇到尚未恢復 `pendingCommit != null` 拒絕建立新 WAL；
    5. **`resolveHalted` 兩個手動出口**：對卡住的 `import_trades`/`update_tx_tag`/`deactivate_tags`/`unknown_op_halted` 分別測 `discard_wal`（清理 WAL＋無效標籤停用＋記 `audit`）與 `revert_pre_commit`（還原兩鍵＋記 `audit`，`unknown_op` 拒用 `revert_pre_commit`）；
    6. **`store.set === false` 模擬雙鍵失敗恢復**：mock `store` 在 Phase 1 / Phase 2 / Phase 3 及「Phase 2 回滾 `pf:recon:v1` 也失敗」「Phase 3 回滾後留 WAL 重試」回傳 `false`，隨後放行重新載入呼叫 `recoverCommit`，驗證兩鍵最終一致且 `audit[]` 零重複。
  - **`snapshotScope` `"full"` vs `"partial"` 兩個相反測試（Review Focus 7）**：`S1` 有 `2330`（1000 股），匯入不含 `2330` 之 `S2`：
    - `snapshotScope: "partial"` → `S1` 完整保留、`2330` 仍在 `activeBaselines`；
    - `snapshotScope: "full"`（期間已賣光 1000 股）→ 自動產出 `full_snapshot_close` 關閉 `S1`，`2330` 持倉為 `0`；
    - `snapshotScope: "full"`（帳本仍有 1000 股）→ `S1` 保留並建 `recon_diff`（`targetShares: 0`）；執行 `resolveConflict(..., "accept_new", { reason: "已確認清倉" })` 後 `S1` 關閉。
  - **`asOfStatus: "year"` 與 `"future"` 嚴格門檻測試（Review Focus 8）**：`asOfStatus: "year"`（含 `today = "2026-01-05"` `"12/28"` 跨年推 `"2025-12-28"`）與 `"future"` 在 `asOfConfirmed: false` 時必進 Level 2 且產生 `0` 筆 `confirmed` 快照；傳 `asOfConfirmed: true`（且 `<= today`）才升 Level 1 建 `confirmed`。
  - 其餘既有案例：`findRepeatHash`、`S2 < S1`、`S1→S2` 容差晉升與 `recon_diff`（含 `us` T+1 文案）、同 `symbol` 不同市場進 Level 3 `currency_conflict`、`tagInitialTx` → `untagInitialTx` → `tagInitialTx`。
- [ ] **跑測試確認失敗**：`node --test tests/recon.test.mjs`，預期因檔案尚未建立而失敗。
- [ ] **最小實作**（`learner/recon.js` ＋ `tests/run.mjs` 註冊 `tests/recon.test.mjs`）。
- [ ] **跑測試確認通過**：`node --test tests/recon.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/recon.js tests/recon.test.mjs tests/run.mjs && git commit -m "recon: 新增對帳快照、衝突、WAL協議與容量失敗控制引擎"`

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
    - 每個 `position` 附帶 `hasSnapshot: boolean`、`snapshotDate: string|null`、`snapshotId: string|null`、`snapshotOrigin: string|null`、`snapshotScope: string|null`、`pending: Array<{ code, shares?, conflictId?, baselineShares?, targetShares?, diffShares?, market?, message }>`（同時保留既有 `fraction_unsettled` 提醒並併入該標的 open `conflicts[]` 如 `recon_diff`、`same_day_order`）；且於 `p.history` 在基準日 `B.date` 插入基準錨點紀錄（`shares > 0` 為 `{ date: B.date, id: B.id, type: "snapshot", shares: B.shares, costBasis: r2(B.shares * B.avgCost), avgCost: B.avgCost, isSnapshot: true }`；`origin === "full_snapshot_close"` 為 `{ date: B.date, id: B.id, type: "snapshot", origin: "full_snapshot_close", shares: 0, costBasis: 0, avgCost: null, isSnapshot: true }`），`preSnapshot` 交易則於 `p.history` 保留 `{ ..., preSnapshot: true, shares: 0, costBasis: 0, avgCost: null }`（使 `watch.html:2351` 建倉日偵測與 `perf.js:89` `sharesAt(d < B.date)` 一致得出 `0`）。
    - 頂層新增 `reconcile: { hasSnapshot: boolean, snapshotCount: number, openConflicts: Array, pendingSymbols: string[], unresolvedSameDayCount: number, staleTags: Array<{ txId, symbol, reason }> }`
  - 核心引擎規則：
    0. **市場／幣別與大寫 `symbol` 約束**：先以 `reconStore` 各檔規範大寫 `symbol` 建立／檢查 `symMkt`（強制 `CURRENCY[market] === currency`）；若交易清單或快照間同一 `symbol` 出現不同 `market`／`currency`，計入 `errors` `{ code: "currency_conflict" }`（嚴禁繞過 `ledger.js:125` 既有約束）。
    1. **建立期初錨點**：
       - 若 `B.origin === "full_snapshot_close"`（`B.shares === 0`, `B.avgCost === null`）：於 `B.date` 錨定 `shares = 0`, `costBasis = 0`, `lots = []`, `open = false`, `firstDate = B.date`（使基準日前交易保持 `preSnapshot: true` 不回魂，之後新買入則從 0 重建）。
       - 若為有效正數 `confirmed` 基準 `B`（`B.avgCost > 0`, `B.shares > 0`）：於 `B.date` 先建立期初錨點 `shares = B.shares`, `costBasis = r2(B.shares * B.avgCost)`, `firstDate = B.date`；若 `method === "fifo"` 建立單一合成批次 `{ date: B.date, id: B.id, shares: B.shares, cost: r2(B.shares * B.avgCost), isSnapshot: true }`。
    2. 對該標的交易逐筆依時間判斷：
       - `t.id === B.tagTxId` 或（`initialTags[t.id]?.active === true` 且該交易仍為 `transfer_in` 且若有 `txHash` 須與 `KLRecon.txFingerprint(t)` 相符；孤兒或指紋不符的舊標籤列入 `reconcile.staleTags[]`、該筆交易依一般交易計算不誤加 `preSnapshot`）、或 `t.date < B.date`：**照常跑 `checkTx`／`duplicate_id`／`currency_conflict`／另計費用驗證，於 `p.history` 標 `preSnapshot: true`（`shares: 0, costBasis: 0`），決不改變 `shares`／`costBasis`／`lots`／`realizedPnl`／`cash`／`totals`，不於 `< B.date` 觸發 `oversell` 或 `over_transfer`**。
       - `t.date === B.date`（非有效期初標籤本身）：優先查 `rel = reconStore?.sameDayRelations?.[t.id]`（相容 `t.snapshotRelation`），套用前**必須核對 `rel.snapshotDate === B.date`、`t.date === B.date` 及（若 `rel.snapshotId` 存在）`rel.snapshotId === B.id`**，不符視為 `"unresolved"`。`"before_snapshot"` 視為 `preSnapshot` 僅留歷史；`"after_snapshot"` 正常參與計算；**若未標明**則暫不異動基準持股（記為 `sameDayRelation: "unresolved"` 並進 `position.pending` 與 `reconcile.unresolvedSameDayCount`）。
       - `t.date > B.date`：完全按既有規則（含賣光歸零 `costBasis=0, lots=[], open=false` 後再買回重建、與之後真實賣超擋下 `oversell`）。
    3. 另計費用 `fee`（透過 `t.ref` 掛到目標交易 `o`）：若 `o` 為 `preSnapshot`，隨 `o` 一起視為 `preSnapshot` 不改寫快照後成本與現金流。
- `previewAdd(list, tx, opts)`、`deleteImpact(list, id, opts)`、`validateStore(s, opts)`、`prepareHoldingsImport(rows, existingTxs, opts)`、`prepareTradesImport(rows, existingTxs, opts)`：傳入 `opts.recon` 時一律改用 `buildReconciledLedger(..., opts.recon, ...)`（未傳時保留原 `buildLedger` 行為不變）。
- `prepareTradesImport` 同批 vs 跨批去重修正（Review Focus 2）：
  - `sim(seq)` 使用 `opts.recon ? buildReconciledLedger(..., opts.recon, ...) : buildLedger(...)`。
  - 只比對新匯入列與 `existingArr`（包含 `preSnapshot: true` 的已存明細）：核心簽章 `[date, type, symbol, shares, price]` 相符且若有明確不相等的 `time`/`note` 不誤判、其餘給 `possible_duplicate`；**移除**來自 `sim([...existingArr, ...seq])` 內部兩個匯入列之間互相比對造成的誤報 `possible_duplicate`（注意 direct `KLLedger.buildLedger()` 本身不動，維持 `tests/ledger.test.mjs:46` 原斷言）。
  - 另外針對匯入列若命中既有已確認基準的 `t.date < B.date` 或 `t.date === B.date` 未定序，標記對應審核資訊（`reconcileHint: "pre_snapshot" | "same_day_order" | "post_snapshot"`），且缺 `t.date` 時標出 `missing_date`。
- `checkBackup(data, opts = {})`（Review Focus 1）：
  - 不依 `Object.keys(data)` 順序：先判斷 `Object.prototype.hasOwnProperty.call(data || {}, "kline:pf:recon:v1")`。
  - 若存在 `kline:pf:recon:v1`：先 JSON 解析，**必須傳入 `opts.recon && typeof opts.recon.validateStore === "function"`**；否則直標 `ok: false`, `problems: ["沒有對帳快照的檢查程式，為了安全不匯入"]`；之後呼叫 **`opts.recon.validateStore(parsed, { today: opts.today, rejectPendingCommit: true })`**（若備份內 `pendingCommit != null` 亦標為 `unrecovered_pending_commit` 供 `syncImport` 決定是否提示剔除），並記錄 item；僅在 `recon` 存在且解析／檢查通過後，帶入 `{ today: opts.today, recon: parsed }` 呼叫 `validateStore(pfV1, ...)`。
  - 若存在 `kline:pf:recon:v1` 且 JSON 壞掉／版本或內容不合法／市場衝突／含 `pendingCommit`，`items` 中該項標 `ok: false`，驗證 `kline:pf:v1` 時不依賴未驗證壞資料，整份 `checkBackup` 回 `ok: false`。

- [ ] **寫失敗測試**（`tests/ledger.test.mjs` ＋ `tests/ledger-import.test.mjs`）：
  - **Review Focus 1**（`tests/ledger.test.mjs`）：備份 JSON 把 `"kline:pf:v1"`（1/10 有基準 1000 股、1/15 賣出 300 股、無買進交易）故意排在 `"kline:pf:recon:v1"` **之前**：傳 `opts.recon = KLRecon` 必須回 `{ ok: true }`（不誤判 `oversell`）；刻意不傳 `opts.recon` 時**必須拒絕**（`ok: false`、「沒有對帳快照的檢查程式」）；**`recon` 含未收斂 `pendingCommit != null` 時必須拒絕**（`ok: false`）。
  - **Review Focus 2**（`tests/ledger-import.test.mjs`）：同一張截圖有兩筆完全同天同代號同股數同價買進（無 `time` 無 `fee`）→ `prepareTradesImport` 不可產生 `duplicates`／`possible_duplicate`；換成與 `existingArr`（含 `< B.date` 的 `preSnapshot` 交易）重複則須進 `duplicates`；而直接呼叫 `KLLedger.buildLedger()` 對同陣列兩筆完全相同列仍保留 `possible_duplicate` 提醒。
  - **Review Focus 3**（`tests/ledger.test.mjs` ＋ `tests/recon.test.mjs`）：`S1`（11/10 1000 股 @900）→ 11/12 賣 1000 股 @950（歸零，`costBasis=0, lots=[]`）→ 11/14 買 500 股 @920（均價與 FIFO 皆由 0 重建）→ 匯入 `S2`（11/15 500 股 @920＋手續費誤差容許內）自動晉升；改用數量 600 股或價差超容差 → 留 `S1` 建 `recon_diff`。
  - **Review Focus 6 & 7**（`tests/ledger.test.mjs`）：
    - `sameDayRelations[t.id]`（記在 `reconStore` 上而非 `t` 本身）正確區分 `before_snapshot`／`after_snapshot`／未決；**把交易日期改走再改回同日或換新 `snapshotId` 時，舊 `sameDayRelations` 不再自動生效而重回 `unresolved`**；
    - 孤兒／失效 `initialTags`（交易已刪或 `txHash` 不符，模擬舊版分頁寫入）降級為一般交易並記入 `reconcile.staleTags`；
    - `full_snapshot_close` 關閉基準錨定 `shares: 0, open: false`，基準前舊交易標 `preSnapshot` 不回魂，之後新買入正常從 `0` 重建；
    - 同一 `symbol` 在快照（`tw/TWD`）與交易（`us/USD`）間混用市場／幣別時，`buildReconciledLedger` 與 `validateStore` 報出 `currency_conflict` 並拒絕。
  - 補傳 `t.date < B.date` 買進／賣出不重複增加持股也不報快照前 `oversell`；`fifo` 與 `avg` 下賣出快照持股皆正確扣減單一合成批次與計入 `realizedPnl`；現金流與 `totals` 不因快照本身被虛增。
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
  - 當 `cur` 雖無帶代號交易但 `L.positions.some(p => p.currency === cur && (p.open || p.hasSnapshot))`（純快照或已結案快照）時，**不跳過**（取代第 81 行 `!T.some(t => t.symbol)` 的早退）。
  - 取得該幣別的確認快照清單（`snapPositions`）：
    - 濾除 `preSnapshot` 交易對 `flows`、有效交易清單與 `lastTradePx` 的影響；僅計算自各檔基準日 `B.date`（含 `after_snapshot` 同日與 `t.date > B.date`）之後的交易。
    - `lastTradePx(sym, d)`：優先採用 `B.date <= t.date <= d` 之有效交易成交價；若沒有交易而 `d >= B.date` 且 `pos.snapshotShares > 0` 則回退基準 `avgCost`（確保純快照於價格缺日有回退值）。
    - 對每個具 `hasSnapshot` 且 `snapshotOrigin !== "full_snapshot_close"`（`snapshotShares > 0`）的標的，於 `B.date` 插入初始投入現金流：若有 `books[B.symbol]` 在 `B.date` 當天收盤價則用 `B.shares * px.c`，否則用 `B.shares * B.avgCost` 並 `est.add("transfer_at_cost")`；**`full_snapshot_close`（`shares === 0`）不產生期初買入現金流**。
    - `sharesAt(sym, d)`：於 `d < B.date`（基準錨點之前）一律為 `0`；自 `B.date` 起反映快照基準股數加上快照後異動（`full_snapshot_close` 自結案日起為 `0`；`p.history` 在 `< B.date` 的 `preSnapshot` 紀錄已保持 `shares: 0`）。
    - `trunc` 檢查：使用該標的的有效起始日 `pos.hasSnapshot ? pos.snapshotDate : (pos.firstDate || start)`，因此早於 `B.date` 的 `preSnapshot` 歷史交易絕不誤觸 `history_truncated`。
    - 加入 `snapshot_baseline` 與 `recon_pending`（當任一持股 `pending.some(x => x.code === "recon_diff" || x.code === "same_day_order")`）至 `est`、`issues`（帶 `codes`／`diffs`）與 `KLPerf.REASON_LABEL`。
- `KLOverview.summarize(L, quotes, opts = {})`（`learner/overview.js:14`）：
  - 從 `L.positions` 與 `L.reconcile` 收集：
    1. 有快照基準（`L.reconcile?.hasSnapshot`）→ `issues.push({ k: "snapshot_baseline", count: L.reconcile.snapshotCount })`。
    2. 有待對帳衝突（`openConflicts` 或 `position.pending` 含 `recon_diff`/`same_day_order`）→ 依衝突標的 `market` 彙整提示摘要（單一台股為台股 T+2、單一美股為美股 T+1、多市場混合或不明採中性提示）並加入 `alerts.push({ k: "recon_pending", codes, diffs, markets, hint, level: "warn" })` 與 `issues.push({ k: "recon_pending", codes, diffs, hint })`；未納入快照或衝突時 `alerts`/`issues` 完全不變（相容既有 `tests/overview.test.mjs:46`）。
  - 更新 `ALERT_LABEL`、`ISSUE_LABEL` 加入 `recon_pending` 與 `snapshot_baseline` 文案。

- [ ] **寫失敗測試**（`tests/perf.test.mjs` ＋ `tests/overview.test.mjs`）：
  - **純快照績效**（無交易，只有 `2026-10-01` 台積電 1000 股均價 900，價格表由 `2026-10-01` 收 910 漲至 `2026-10-30` 收 1000）：`L.cash` 不動、`byCurrency.TWD` 存在且 TWR 與 MWR 從 `2026-10-01` 起算、`est` 含 `snapshot_baseline`（不含 `history_truncated`）。
  - **`full_snapshot_close` 歸零基準**：`2026-10-15` 完整快照歸零結案後不產生額外投入現金流，且結案日後 `sharesAt === 0`。
  - **含補傳快照前歷史明細之績效**：存在 `2024-01-05` `transfer_in`（`preSnapshot: true`）但價格只到最近 24 個月（`2024-11-01` 起），而快照日為 `2026-10-01` → **不可誤報 `history_truncated`**，`flows` 與 `sharesAt` 在 `2026-10-01` 前為 `0`。
  - **缺快照日收盤價回退成本**：標記 `transfer_at_cost` ＋ `snapshot_baseline`；存在未決 `recon_diff` → `est` 與 `issues` 含 `recon_pending`。
  - **`KLOverview.summarize`**：純快照帳本正常算總資產、今日損益、累積損益；存在台股 `2330` vs 美股 `NVDA` vs 混合未決衝突 → `alerts` 與 `issues` 各自輸出正確 T+2／T+1／中性交割提示且絕不混淆。
- [ ] **跑測試確認失敗**：`node --test tests/perf.test.mjs tests/overview.test.mjs`。
- [ ] **最小實作**：更新 `learner/perf.js` 與 `learner/overview.js`。
- [ ] **跑測試確認通過**：`node --test tests/perf.test.mjs tests/overview.test.mjs`（連同既有測試全數通過）。
- [ ] **Batch 2 Commit**：`git add learner/perf.js learner/overview.js tests/perf.test.mjs tests/overview.test.mjs && git commit -m "perf: 支援對帳快照計算起點與總覽依市場待對帳警示"`

---

### Task 5：`watch.html`（持股來源／跨分頁同步／原圖 SHA-256／`LAZY`）與 `tools.js` 備份預檢

**Files:**
- Modify: `learner/watch.html:1462, 2344-2375, 2398, 2658-2683`
- Modify: `learner/tools.js:744-820`

**Interfaces — Consumes (`KLRecon`, `KLLedger`) & Produces (`watch.html`, `tools.js`):**
- `LAZY.ledger`（`learner/watch.html:1462`）：改為 `["ledger.js", "recon.js", "ledger-ui.js"]`。
- `holdFromLedger(S, recon)`（`learner/watch.html:2346`）：呼叫 `KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: twIso() })`；回傳 `{ H, errors, txCount, snapshotCount, pendingSymbols }`；若 `p.pending.length` 有值（如 `recon_diff`/`same_day_order`），一併存入 `H[c].pending = p.pending` 讓持股明細列與 `holdDataCheck()` 依標的市場顯示 `⚠︎ 待對帳（差異 N 股）— <T+2 / T+1 / 中性提示>`（透過 `KLRecon.settlementHint`）。
- `holdSrcApply(opts = {})`（`learner/watch.html:2357`）：
  - 同時讀取 `rawPf = localStorage.getItem("kline:pf:v1")` 與 `rawRecon = localStorage.getItem("kline:pf:recon:v1")`。
  - **無副作用 WAL 檢查＋鎖內非同步落盤**：若 `recon?.pendingCommit != null` 且 `typeof KLRecon?.recoverCommit === "function"`，先在記憶體用純函式 `KLRecon.recoverCommit(S0, recon)` 得出畫面計算用的 `effectiveRecon`（**不直接寫入 `localStorage`**）；唯有非 `storage` 事件的一般載入（`!opts.fromStorage`）且 `rec.changed === true` 時，才非同步呼叫 `lgRecoverPersist?.()` 於 `withPfCommitLock`＋CAS 內安全落盤；若為 `unknown_op_halted` / `inconsistent_halted`，完整保留 `pendingCommit` 不覆寫並於 `holdSrcBar`/`holdDataCheck` 顯示警示。
  - 當 `(hasTx || hasConfirmedSnapshots)`（`hasConfirmedSnapshots` 含 `full_snapshot_close` 結案基準，確保完整清倉歸零後不退回舊 `kline:watch:hold`）且 `!W.hsrcLegacy` 時進入交易帳本模式（確保 `store.lock` 鎖住 `kline:watch:hold` 唯讀）；若僅有快照尚無 `kline:pf:v1`，在記憶體構造虛擬 `S = S0 || { v: 1, method: "avg", transactions: [] }`（**不寫入 `localStorage`**）。
  - 快取鍵改為 `` `${twIso()}|${rawPf}|${rawRecon}` ``（修改交易或更新快照／衝突皆立即重算）。
  - 註冊 `window.addEventListener("storage", e => ...)`：當 `e.key === "kline:pf:v1" || e.key === "kline:pf:recon:v1"`（或 `e.key == null` 全清）時呼叫 `holdSrcApply({ fromStorage: true })` 與 `renderList()`（**只重算畫面，絕不寫入 `localStorage`**）。
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
- `tools.js` 備份匯入與雲端雙鍵同步配對（`learner/tools.js:744-820`）：
  - `syncImport(file)`：若 `pfKeys.includes("kline:pf:recon:v1") && typeof KLRecon === "undefined"`，明確動態載入 `recon.js`（失敗即拋錯「載入對帳資料的檢查程式失敗，沒有匯入（這台的資料維持原樣）」並中止）。呼叫 `KLLedger.checkBackup(j.data, { today: toolsDay(), margin, rebal, thesis, recon: typeof KLRecon !== "undefined" ? KLRecon : null })`。**若唯一錯誤為 `unrecovered_pending_commit`**，跳出確認「這份備份含未完成的對帳提交，剔除它並以交易紀錄為準後才能匯入；要繼續嗎？」→ 確認後在記憶體呼叫 `KLRecon.resolveHalted(pf, recon, "discard_wal", { source: "backup_import" })` 產生副本並重跑 `checkBackup(..., { rejectPendingCommit: true })`，通過才進入原有覆蓋確認。
  - **雲端同步雙鍵綁定（`syncSnap(false)`／`syncBigPf`／`syncPush`／`syncPull`／`syncBoot`）**：
    - `syncSnap(false)` 將 `kline:pf:v1` 與 `kline:pf:recon:v1` 視為同組：必須兩者都 `< 150000` 字元、且 `recon.pendingCommit == null` 才一起收錄；任一超限、壞結構或 `pendingCommit != null` 則兩鍵都不帶。`syncBigPf()` 任一鍵超限即並列兩鍵並更新文案說明兩鍵必須一起同步。
    - `syncPush` 與每分鐘自動上傳偵測到本機 `recon.pendingCommit != null` 時暫停上傳，`W.syncErr` 顯示提示。
    - `syncPull` 與 `syncBoot`：若本機 `recon.pendingCommit != null` 且雲端含有 `PF_PAIR` 任一鍵，**強制暫停套用 `PF_PAIR`（`W.syncErr` 提示，不讓雲端正常資料蓋掉本機 WAL `txs`）**；本機無未決提交且雲端帶 `PF_PAIR` 任一鍵（或帶 `kline:pf:v1` 而本機有對帳資料）時，載入 `ledger.js`＋`recon.js`，將「雲端帶來的鍵＋本機另一鍵」交給 `KLLedger.checkBackup(..., { rejectPendingCommit: true })` 驗證；失敗則整份不套用、設 `W.syncErr` 並維持本機原樣，通過後於鎖內／CAS 套用。
  - `pfTxt` 納入對帳項目摘要（快照數與未決衝突數）；保留既有 `tools.js:816` `交易紀錄或融資資料超過 150KB...` 涵蓋 `PF_PAIR` 與其他 `kline:pf:*` 鍵。

- [ ] **寫／補測試準備**：確認 `hold-source.test.mjs`、`backup-pf.test.mjs` 既有選擇器與訊息不被破壞。
- [ ] **最小實作**：改動 `learner/watch.html`（`LAZY.ledger`、`holdFromLedger`、`holdSrcApply`＋純 `recoverCommit`＋`storage` 不寫回、`holdSrcBar`、`renderHold` 行內待對帳標籤與 `[data-hsrc="tx-recon"]`、`#impFile` 原圖 SHA-256 ＋ `mode: "auto"`）與 `learner/tools.js`（載入 `recon.js`、`checkBackup` 傳 `recon`＋剔除未完成提交確認、雲端同步雙鍵配對與下載預檢）。
- [ ] **跑相關 E2E 驗證**：`PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/watch.html learner/tools.js && git commit -m "watch: 整合持股來源對帳快取、WAL啟動恢復、跨分頁同步與原圖雜湊檢查"`

---

### Task 6：`learner/ledger-ui.js` 統一匯入入口、三級審核、WAL 寫入、對帳中心與績效／配置／期初標記

**Files:**
- Modify: `learner/ledger-ui.js:12-105, 152-216, 268-338, 579-625, 1254-1708`

**Interfaces — Consumes (`KLLedger`, `KLRecon`, `KLPerf`, `KLAlloc`) & Produces (`ledger-ui.js` globals / UI handlers):**
- 共用讀寫、併發鎖＋CAS、WAL 跨鍵寫入與容量保護輔助：
  - `withPfCommitLock(fn)`：在瀏覽器採 `navigator.locks.request("kline:pf:commit", fn)`（若瀏覽器缺 `navigator.locks` 則回 `{ ok: false, code: "cross_tab_lock_unavailable" }` fail-closed；僅 Node 無 `window` 環境用串列 promise queue）序列化所有會寫入 `kline:pf:v1` 或 `kline:pf:recon:v1` 的流程（`lgCommitDualStores`、`lgSave`、`lgReconSave`、`lgRecoverPersist`、受阻手動處理）。
  - `lgReconLoad()`：**純讀取＋無副作用記憶體檢查**：讀取 `kline:pf:recon:v1`；若 `recon?.pendingCommit != null` 且 `typeof KLRecon?.recoverCommit === "function"`，呼叫純函式 `recoverCommit(lgLoad(), recon)`；
    - 若 `rec.changed === true`（`rolled_forward` / `aborted`），僅先回傳 `rec.reconStore` 供畫面正確計算（並排程 `lgRecoverPersist()` 在鎖內檢查＋落盤，**不在 `lgReconLoad()` 直接同步覆寫**）；
    - 若為 `unknown_op_halted` / `inconsistent_halted`，記於 `W.lgReconHalted` 供頂部修復卡片顯示，並回傳原 `reconStore`。
  - `lgRecoverPersist()`：於 `withPfCommitLock` 內重讀 `rawPf` 與 `rawRecon` 原始字串，對新讀到的資料跑 `KLRecon.recoverCommit`；若 `rec.changed === true`，在寫回前核對 `localStorage` 中兩鍵 raw 字串仍等於剛讀取時之 `rawPf`/`rawRecon`（CAS），相符才執行 `pruneStore` ＋ `store.set` 寫盤並更新畫面；不相符代表有並發寫入，中止本次寫回並重排一次檢查。
  - `lgSave(s, opts = {})`（`L19` 修正靜默失敗＋WAL/stale-base fail-closed）：在鎖內重讀目前 `rawPf`／`rawRecon`（若有傳 `expectedRawPf`/`expectedRawRecon` 不符即拒寫 `stale_write`）並檢核 `pf:recon:v1` `pendingCommit != null`；若存在且 `!opts.allowPendingCommitWrite` 一律拒寫（回 `{ ok: false, code: "unrecovered_pending_commit", errors: ["存在未恢復或未知的對帳提交紀錄，請先處理或匯出 JSON 備份後再修改"] }`）。通過後以 `recon: opts.reconOverride || recon` 呼叫 `KLLedger.validateStore`，並**檢查 `store.set("pf:v1", s)` 布林回傳值**，回傳 `false` 時回 `{ ok: false, code: "storage_write_failed", errors: ["瀏覽器儲存空間不足或受鎖定，未寫入交易紀錄"] }`。
  - `lgReconSave(nextRecon, opts = {})`：
    1. 檢核鎖內重讀之 `rawRecon`（若傳 `expectedRawRecon` 不符即回 `{ ok: false, code: "stale_write" }`）及現存 `pf:recon:v1` 是否仍有未決 `pendingCommit != null`（或 `nextRecon?.pendingCommit != null`）：若 `!opts.allowPendingCommitWrite` 一律 Fail-Closed 回 `{ ok: false, code: "unrecovered_pending_commit" }`；
    2. 跑 `KLRecon.validateStore(nextRecon, { today: lgToday() })` 與 `const pr = KLRecon.pruneStore(nextRecon, KLRecon.MAX_BYTES)`；
    3. **Fail-Closed**：若 `!pr.ok`（`pr.code === "core_data_exceeds_limit"`），**絕不呼叫 `store.set`**（保留既有 `kline:pf:recon:v1`），回 `{ ok: false, code: "core_data_exceeds_limit", bytes: pr.bytes, maxBytes: pr.maxBytes }` 並清楚提示使用者「對帳核心資料過大或超過 120KB，本次未覆蓋寫入；請先結案待對帳項目或到『工具 → 備份同步』匯出 JSON 備份」；
    4. 呼叫 `const ok = store.set("pf:recon:v1", pr.store)`；若 `!ok` 回 `{ ok: false, code: "storage_write_failed" }`（既有 `kline:pf:recon:v1` 維持原樣）；成功才清 `W.lgReconHalted = null` 並通知 `holdSrcApply?.()`、`pfExpire?.()`。
  - **`lgCommitDualStores({ expectedRawPf, expectedRawRecon, planFn, pf0, recon0, nextPf, payload })`**（於 `withPfCommitLock` 內執行，Review Focus 6）：
    - Pre-flight：在鎖內重讀兩鍵 raw 字串與 parse 狀態，若無 `planFn` 且傳入之 `expectedRawPf`/`expectedRawRecon` 與鎖內現況不符回 `{ ok: false, code: "stale_write" }`；確認目前 `pf:recon:v1` 無未決 `pendingCommit`（若有未決 WAL 先嘗試 `recoverCommit`，仍受阻則回 `unrecovered_pending_commit`）；執行 `const prep = KLRecon.prepareCommit(curRecon, payload)` 與 `const fin = prep.ok ? KLRecon.finalizeCommit(prep.store, payload.id || payload.batchId) : prep`；檢核 `prep.ok && fin.ok`、`KLLedger.validateStore(nextPf, { today: lgToday(), recon: fin.store }).ok`、`KLRecon.validateStore(fin.store, { today: lgToday() }).ok` 及 `KLRecon.pruneStore(prep.store).ok && KLRecon.pruneStore(fin.store).ok`。任一步不過直接中止不碰任何鍵；
    - Phase 1：`lgReconSave(prep.store, { allowPendingCommitWrite: true })` 寫入 WAL；失敗（`storage_write_failed` / `core_data_exceeds_limit`）即中止，兩鍵皆原樣；
    - Phase 2：寫入 `store.set("pf:v1", nextPf)`（包 `try/catch`）；失敗（回傳 `false` 或拋錯）立即以 CAS 確認 `kline:pf:recon:v1` 仍為 `prepared` 後復原 `store.set("pf:recon:v1", recon0)` 並回 `{ ok: false, code: "storage_write_failed", walPending: !restoreOk }`（即使復原 `pf:recon:v1` 也回 `false`，`pf:v1` 仍為舊狀態，重啟 `recoverCommit` 安全 Clean Abort）；
    - Phase 3：`lgReconSave(fin.store, { allowPendingCommitWrite: true })` 清除 `pendingCommit` 並寫入正式 `imports[]`/`audit[]`/`conflicts[]`/標籤快照更新；若失敗（`store.set === false` 或拋錯），**先以 CAS 確認 `pf:v1` 仍為 `nextPf` 才嘗試**復原為 `pf0`（`const pfOk = ...`），**唯有 `pfOk === true` 且 `pf:recon:v1` 仍為 `prepared` 才接續復原** `kline:pf:recon:v1` 為 `recon0`（否則刻意保留 `pendingCommit`，由下次載入之 `recoverCommit` 依兩鍵實況安全 Roll-Forward 或 Clean Abort）。
  - `lgStoreOrEmpty()` → 回傳 `lgLoad() || { v: 1, method: "avg", transactions: [] }`（**只讀不寫 `kline:pf:v1`**）。
- **統一匯入視窗（移除二選一卡片，加入完整／部分範圍與年份日期閘道）**：
  - `lgOpenImport()`（`L1254`）直接開單一入口：`[data-lgimp-upload]`「📷 上傳券商截圖（自動辨識庫存／交易明細）」（觸發 `#impFile`），搭配次要按鈕「手動新增空白列」（保留選擇器供手 key）、若有開放衝突則顯示「查看待對帳項目（N）」，**不再出現 `[data-lgimp-pick="holdings"|"trades"]`**。
  - `lgOnImportRows(rows, detectedKind, meta = {})`：
    - 接收 `{ asOf, asOfStatus, altDate, rawAsOf, fileHashes }`；支援 `detectedKind === "holdings" | "trades" | "unknown"`。
    - 頂部顯示識別結果橫幅：「系統辨識結果：庫存快照／交易明細／類型尚未確定＋基準日狀態」，並提供一鍵切換鈕 `[data-lgimp-switch="holdings"|"trades"]`（不重呼 AI 即可就地轉型重排）。
    - **快照「完整／部分」明確範圍選擇（Review Focus 7）**：當 `kind === "holdings"` 時，頂部渲染範圍單選 `[data-lgimp-scope="partial"]`（「部分截圖／單頁（僅更新畫面有列出的標的）」，**預設唯一安全選取，絕不自動預選 `"full"`**）與 `[data-lgimp-scope="full"]`（「完整庫存清單（未出現在此截圖且原有持股將進入清倉核對或結案）」），並若有舊確認持股未出現在本次截圖時明確列出清單提醒。
    - **缺年份／未來日期確認閘道（Review Focus 8）**：若 `asOfStatus === "year"` 或 `"future"` 或 `"mdy"`／`"invalid"`／`"missing"`，明確顯示截圖原始字串 `rawAsOf` 與系統推定日期 `asOf`（如「截圖顯示 12/28，系統暫推為 2025-12-28」），提供確認按鈕 `[data-lgimp-asof-ok]` 與修改框 `[data-lgimp-asof]`；在未明確確認（且 `<= lgToday()`）之前禁止升級為 `confirmed` 快照，一併保有原 `[data-lgimp-dflip]`／`[data-lgimp-dok]` 機制。
    - **原圖 SHA-256 非阻斷提醒**：呼叫 `KLRecon.findRepeatHash(recon, meta.fileHashes)`，若有未結案衝突則頂部顯示非阻斷黃條（含前往衝突按鈕 `[data-lg="view-conflicts"]`），若先前已完整匯入亦提示供參考，**絕不阻擋**儲存按鈕。
    - **日期預帶**：若 `kind === "trades"` 且有精確有效 `asOf`（`asOfStatus === "exact" && asOf <= lgToday()`，或使用者確認 `"year"` 後日期 `<= lgToday()`），空白列自動預帶 `asOf`（加小字標「帶入截圖基準日」並允許逐列修改）；其餘狀態亮起待補或待確認提示。
    - **融資／融券自動隔離**：偵測到 `marginType === "margin" | "short"` 時預設 `on: false`（不勾選入現股），歸入 Level 2 `margin_separated` 並於頂部／列內顯示引導卡片「偵測到融資／融券部位已隔離，避免混入現股成本 → [前往配置與風險 → 融資管理](`[data-lg="view" data-v="margin"]`)」。
    - **三級分流狀態徽章＋市場別交割提示＋市場衝突阻擋**：每列標記 Level 1／Level 2／Level 3（含 `currency_conflict` 擋下跨市場混用，取消勾選即不擋其餘有效列）。發生 `recon_diff` 時呼用 `KLRecon.settlementHint(market)`，台股顯示 T+2、美股顯示 T+1、不明／混合顯示中性提示。
    - 保留原本全部鍵盤無障礙（focus trap、`aria-invalid`、IME Enter 防誤送、粘滯首欄與 `.hg-wrap.scrollLeft = 0`）。
  - `lgSaveImport()`：
    - 若 `kind === "holdings"`：帶入使用者選定之 `snapshotScope`（`"partial" | "full"`）與 `asOfConfirmed`，經 `KLRecon.planHoldingsSnapshot` 與 `KLRecon.applyHoldingsImport`，以 `lgReconSave` 寫入 `kline:pf:recon:v1`（若 `pr.ok === false`、`unrecovered_pending_commit` 或 `store.set === false` 不蓋寫舊檔並保持對話框開啟供處理）。**不把庫存快照寫成 `transfer_in` 塞進 `kline:pf:v1`**。
    - 若 `kind === "trades"`：先通過 `prepareTradesImport(..., { recon })`，再**透過 `lgCommitDualStores`（`op: "import_trades"`）以 WAL 協議同步寫入 `kline:pf:v1` 與 `kline:pf:recon:v1`**（含 `txs`、`txHashes`、`pfBaseHash`、`pfNextHash`、`imports[]`、`audit[]` 與 `same_day_order` 提醒），絕不依序各自獨立存檔。
- **交易紀錄頁頂部「待對帳與衝突中心」＋「受阻修復卡片」＋「匯入與稽核歷史抽屜」＋「標為期初快照／撤回／編輯刪除」**：
  - `renderLedger()`（`L40–95`）：
    - 放寬 `L44-51`：只要 `hasTx || hasConfirmedSnapshots || hasOpenConflicts || recon?.pendingCommit != null`，直接套用 `lgStoreOrEmpty()` 進入對應子頁（不再退回 `lgIntroHtml()`）。
    - **受阻修復卡片（`[data-lgrecon-halted]`）**：若存在 halted `pendingCommit`（`unknown_op_halted` / `inconsistent_halted`），頂部顯示 `[data-lgrecon-halted]`：提供一鍵匯出現場 JSON 備份鈕（`syncExport()`）、並列「交易紀錄實況 vs WAL 卡住操作」、並渲染二次確認修復按鈕 `[data-lgrecon-halt-action="discard_wal"]`（「以交易紀錄為準，放棄卡住的操作」）與（在 WAL 含完整回退資料時啟用的）`[data-lgrecon-halt-action="revert_pre_commit"]`（「還原到這次修改／匯入之前」），於 `withPfCommitLock` 內呼叫 `KLRecon.resolveHalted` 寫回並記 `audit[]`。
    - 若 `L.reconcile.staleTags?.length > 0`（舊版快取分頁產生的孤兒／失效標籤），頂部顯示非阻斷提醒橫幅供一鍵停用過期標籤（單鍵寫 `kline:pf:recon:v1`）。
    - `L60`、`L203`（`#lgForm`）、`L580`（`renderAlloc`）、`L178`（`deleteImpact`）全面改為 `KLLedger.buildReconciledLedger(..., recon, ...)` 與傳入對應模擬 `recon`。
    - `L76` 持倉歷史列 `KLLedger.TYPE_LABEL[h.type] || (h.type === "snapshot" ? "庫存快照" : h.type)` 與 `h.preSnapshot` 標註「快照前歷史」並顯示 `—` 持股變更，避免出現 `"undefined"`。
    - 頂部若有開放衝突：渲染「待對帳項目（N）」卡片，每筆逐條並列雙邊數值（帳本推算 `baselineShares` / 均價 vs 新截圖 `targetShares` / 均價或「完整截圖已無持股（0 股）」＋ 差異 `N` 股 ＋ **依 `c.market` 分流之交割提示**），按鈕動作：`[data-lgrecon-keep]`（保留兩邊待釐清／保留原基準）、`[data-lgrecon-imp]`（補匯入明細 → 開 `lgOpenImport()`）、`[data-lgrecon-accept]`（採信新快照或確認清倉歸零，需輸入必填原因並核准晉升）、與同日交易專用的 `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`（**僅寫單鍵 `kline:pf:recon:v1.sameDayRelations`，含 `snapshotId` 與 `snapshotDate`，不改 `kline:pf:v1`**）。
    - 下方設 `<details class="lgrecon-hist"><summary>匯入紀錄與對帳稽核（N 筆）</summary>...</details>` 顯示 `imports[]`（時間、類型、`snapshotScope`、原圖雜湊前 8 碼、`fileHashes`、各級列數、基準日）與 `audit[]`。
    - `transfer_in` 交易列按鈕與編輯／刪除雙鍵 WAL：
      - 未標記顯示 `[data-lg="tag-init"]`「標為期初快照」（缺成本／`price<=0` 引導補均價不建 `0` 基準）；已標記顯示「已標為期初快照」徽章＋`[data-lg="untag-init"]`「撤回期初快照標記」；
      - `[data-lg="del"]` 刪除時先跑 `KLRecon.planDeactivateTags(recon0, targetTx, ...)`，傳 `plan.previewRecon` 進 `KLLedger.deleteImpact` 驗證刪後不賣超；若 `plan.needsWal` 提醒將同步停用期初快照標記並走 `lgCommitDualStores`（`op: "deactivate_tags"`）；
      - `#lgForm` 送出修改（`F.id`）時先跑 `KLRecon.planUpdateTxTag(recon0, F.orig, tx, ...)`，以 `plan.previewRecon` 呼叫 `KLLedger.buildReconciledLedger` 檢核無誤；若 `plan.needsWal`（即原有啟用 `initialTags` 且交易有實質欄位異動），依 `plan.mode`（`"update"` 同步更新 `tx_tag` 快照或 `"deactivate"` 停用期初標籤）提示確認並走 `lgCommitDualStores`（`op: "update_tx_tag"`），不改動無實質異動則免無謂寫入。
- **績效與配置整合**（`L268–338` & `L579–608`）：
  - `lgPerfData(S)`：自 `S.transactions` 與 `KLRecon.activeBaselines(lgReconLoad())` 聯集收集 `syms` 與 `curs`（支援純快照抓日 K）。
  - `renderPerf(S)`：當 `!S.transactions.length && !hasConfirmedSnapshots` 才顯示空白訊息；呼叫 `KLPerf.buildPerf(S, { ..., recon: lgReconLoad() })`；`ISS` 新增 `snapshot_baseline` 與 `recon_pending` 中文說明，頁頂加統一 `⚠︎ 待對帳（差異 N 股）` 警示列（依市場別提示）。
  - `renderAlloc(S)`：若 `hasTx || hasConfirmedSnapshots`，呼叫 `buildReconciledLedger` 並傳遞 `meta: { legacy: false, hasSnapshot: L.reconcile.hasSnapshot, openConflicts: L.reconcile.openConflicts, pendingSymbols: L.reconcile.pendingSymbols }` 至 `renderAllocBody`、`rbSectionHtml`、`stSectionHtml`，且於配置頁頂部顯示一致 `⚠︎ 待對帳（差異 N 股）` 警示條與「用已確認快照的股數試算」說明。

- [ ] **寫／補測試準備**：對照 Spec 六「驗收標準 24 項」確認每個 DOM attribute（`data-lgimp-upload`, `data-lgimp-switch`, `data-lgimp-scope`, `data-lgimp-asof`, `data-lgimp-asof-ok`, `data-lgrecon-halted`, `data-lgrecon-halt-action`, `data-lgrecon-*`, `data-lg="tag-init"`, `data-lg="untag-init"`）與現有保留選擇器（`data-lgimp-dflip`, `data-lgimp-dok`, `data-lgimp-mv`, `data-lgimp-rev`, `#lgImpOrderOk`, `#lgImpDup`, `#lgImpSave`, `#impLive`）。
- [ ] **最小實作**（`learner/ledger-ui.js`）：逐一補上 `withPfCommitLock`／`lgReconLoad`／`lgRecoverPersist`／`lgReconSave`／`lgCommitDualStores`／`lgSave` 布林檢查／`lgStoreOrEmpty`、統一匯入 HTML 與範圍／年份閘道、對帳中心／受阻修復卡片／稽核抽屜／期初標記與 `#lgForm`/`del` WAL 整合、`renderLedger`/`lgPerfData`/`renderPerf`/`renderAlloc` 更新並傳 `recon`。
- [ ] **跑單元檢核**：`node --test tests/unit.test.mjs tests/ledger.test.mjs tests/ledger-import.test.mjs tests/recon.test.mjs` 通過。
- [ ] **Batch 2 Commit**：`git add learner/ledger-ui.js && git commit -m "ledger-ui: 統一匯入入口、三級對帳審核表、WAL寫入與衝突處理中心"`

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

**Interfaces — Consumes (`KLLedger.buildReconciledLedger`, `KLRecon.settlementHint`, `lgReconLoad`, `lgStoreOrEmpty`, `KLOverview`, `KLPerf`) & Produces:**
- 統一共用邏輯：各頁面取得 `const recon = typeof lgReconLoad === "function" ? lgReconLoad() : null;` 與 `const L = KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: ... });`。
- 若 `L.reconcile?.openConflicts?.length` 或 `L.reconcile?.pendingSymbols?.length`：產出統一待對帳提示 banner HTML（顯示 `⚠︎ 待對帳（${sym} 差異 ${diff} 股）` ＋ 依衝突市場 `KLRecon.settlementHint` 提示 ＋ 點擊跳往 `[data-lg="view" data-v="tx"]` 按鈕，於 `pf-report.js` 列印區亦保留文字警示列）。
- 各檔具體改動：
  1. `learner/pf-home.js`（`L10, 28, 29, 38, 50, 54`）：`hmTrendData` 傳 `{ ..., recon: lgReconLoad() }` 給 `KLPerf.buildPerf`；`renderHomeView` 改 `buildReconciledLedger`、放寬 `!S.transactions.length && !L.reconcile.hasSnapshot` 才顯示空頁、傳 `recon` 至 `KLOverview.summarize`、渲染 `⚠︎ 待對帳（<標的> 差異 N 股）` 警示按鈕（帶市場別提示，`goOf = a => a.k === "recon_pending" ? "tx" : ...`）與 `ISSUE_LABEL`。
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

### Task 8：E2E 測試：24 項驗收與 Review Focus 1–9 案例、既有測試遷移與擴展

**Files:**
- Create: `tests/e2e/portfolio-reconcile.test.mjs`
- Modify: `tests/e2e/ledger-import.test.mjs:1-733`（僅遷移入口選擇器 `[data-lgimp-pick]` → `[data-lgimp-upload]`、請求 `mode: "auto"`＋mock `kind`／`asOf` 與 holdings 改驗證寫入 `kline:pf:recon:v1`；保留 100% 原斷言與嚴格門檻）
- Modify: `tests/e2e/hold-source.test.mjs:1-67`（擴增：空白純快照＋完整快照歸零保持帳本模式＋跨分頁 `storage` 事件即時更新）
- Modify: `tests/e2e/backup-pf.test.mjs:1-65`（擴增：備份含 `kline:pf:v1` 排 `kline:pf:recon:v1` 之前先賣後買正常匯入；含 base64 圖片／壞 `recon`／跨市場衝突整份拒絕；**含 `pendingCommit != null` 預設拒匯並測二次確認剔除後匯入成功**；**雲端同步（mock `/api/sync`）雙鍵同帶／超限雙鍵皆不帶／`pendingCommit != null` 暫停上傳／下載錯配拒絕套用**）

**Interfaces — Tested UI Selectors & State Keys:**
- Upload & review selectors: `[data-lg="imp"]`, `[data-hsrc="tx-imp"]`, `[data-lgimp-upload]`, `[data-lgimp-switch="holdings"|"trades"]`, `[data-lgimp-scope="partial"|"full"]`, `[data-lgimp-asof]`, `[data-lgimp-asof-ok]`, `[data-lgrecon-halted]`, `[data-lgrecon-halt-action="discard_wal"|"revert_pre_commit"]`, `[data-lgrecon-keep]`, `[data-lgrecon-accept]`, `[data-lgrecon-imp]`, `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`, `[data-lg="tag-init"]`, `[data-lg="untag-init"]`.
- Storage keys: `"kline:watch:hold"`, `"kline:pf:v1"`, `"kline:pf:recon:v1"`.

- [ ] **寫／遷移測試（390px 手機 ＋ 1280px 桌面，全 mock `/api/import`、`/api/sync` 與報價／日 K）**：
  - `tests/e2e/portfolio-reconcile.test.mjs` 完整覆蓋 Spec「必測情境 24 項」與「Review Focus 1–9」：
    - Case 1, 16：完全空白帳本僅匯入庫存快照（有 `exact` `asOf`）→ 建立 `kline:pf:recon:v1` `confirmed` 快照，8 個投資組合頁（總覽、持股損益/屬性、交易紀錄、績效、配置再平衡/壓力測試、股利、報告與論點）全正常顯示、不寫入空 `pf:v1`、不動 `kline:watch:hold`、0 console error、無水平溢出。
    - Case 2, 3, 4：匯入早於快照日歷史明細（標 `preSnapshot: true`、持股不重複疊加）、晚於快照日買進、晚於快照日賣出（以快照均價計算已實現損益）。
    - Case 5：同張截圖上傳兩次（原圖 SHA-256 `fileHashes` 未決提醒不擋儲存）；同批兩筆同價成交不誤報重複；跨批同簽章進 Level 2 確認。
    - Case 6, 13, 14：`S1 → S2` 容差內（含中間賣光歸零再買回）自動晉升；超容差保留 `S1` 建 `recon_diff` 與全站 8 頁 `⚠︎ 待對帳（差異 N 股）`，並測解決衝突（採信新快照須理由並留稽核／保留兩邊／點補明細）。
    - Case 7, 8, 9, 10：缺 `asOf`（`missing`）與歧義日期（`mdy`）進 Level 2；多股混合各分級獨立判定；Level 3 失敗列不擋同批有效列；同日交易與快照先後選擇後才套用（**且改走日期再改回後重回未定序**；驗證 `kline:pf:v1` 未額外重寫）；`kind === "unknown"` 就地一鍵切換不重呼 `/api/import`。
    - Case 11, 12, 15, 17, 18：`imports[]`＋`audit[]` 稽核抽屜；融資／融券自動隔離並引導「融資」頁；`transfer_in`「標為期初快照 → 撤回 → 再標記」；**兩個 Playwright Context 同時開啟並在分頁 A 執行雙鍵提交／分頁 B 觸發 `storage` 事件，驗證 B 只重算畫面、不寫回蓋掉 A 的新版 `recon`**。
    - **Case 19（WAL 雙鍵故障、重開恢復與受阻手動出口）**：
      1. 模擬 `import_trades`／`update_tx_tag`（修改已標記期初 `transfer_in`：更新股數／單價、只改備註或改類型為 `buy` 停用）／`deactivate_tags`（刪除已標記期初 `transfer_in`）之 Phase 1 失敗（`Storage.prototype.setItem` 於 `kline:pf:recon:v1` 回錯）、Phase 2 失敗（`kline:pf:v1` 拋錯，復原 `pf:recon:v1` 或保留 WAL 待重啟 Clean Abort）與 Phase 3 中斷（含 `store.set` 回 `false`）；重載頁面與再次重載驗證自動收斂兩鍵一致且 `audit[]` 零重複；
      2. 注入未知 `op` 與不一致 `update_tx_tag`／部分 `import_trades` `pendingCommit` → 重載顯示 `[data-lgrecon-halted]` 卡片、原樣保留 `pendingCommit` 且新寫入被阻擋；**實測按 `[data-lgrecon-halt-action="discard_wal"]` 與 `[data-lgrecon-halt-action="revert_pre_commit"]`（含二次確認）成功脫困恢復寫入並記錄 `audit[]`**！
      3. 模擬舊版分頁刪除／竄改已標期初的 `transfer_in`，重開後確認不誤套 `preSnapshot` 並顯示失效標籤提示供清理。
    - **Case 20（`full` vs `partial` 快照處理持股歸零）**：`S1` 有 `2330` 時匯入不含 `2330` 之 `S2`：選 `[data-lgimp-scope="partial"]` 保留 `2330`；改選 `[data-lgimp-scope="full"]` 且推算已歸零時自動結案關閉 `S1`，或帳本仍有股數時進 Level 2 確認 `[data-lgrecon-accept]` 後寫入 `full_snapshot_close` 關閉 `S1` 且仍鎖定 `kline:watch:hold` 不退回舊庫存。
    - **Case 21（缺年份 `year` 與未來日 `future` 阻擋）**：截圖 `asOfStatus: "year"`（含 `12/28` 跨年）與 `"future"` 時 UI 並陳 `rawAsOf` 與推定日，未按 `[data-lgimp-asof-ok]` 確認（或修正為未來日後 `<= today`）前**不建立 `confirmed` 快照**。
    - **Case 22（同 `symbol` 不同 `market`／`currency` 約束）**：同 `symbol` 在截圖與既有快照／交易不同市場或幣別時進入 Level 3 `currency_conflict` 並阻擋混入。
    - **Case 23（120KB 核心超限 Fail-Closed）**：注入核心待對帳／確認資料超過上限，儲存被阻擋、既有 `kline:pf:recon:v1` 完好保留，畫面顯示導向匯出／結案提示。
    - **Case 24（依市場區分交割提示）**：台股 `2330` 衝突顯示「台股 T+2」；美股 `NVDA` 衝突顯示「美股 T+1」（無台股 T+2）；混合情境顯示中性提示。
  - `tests/e2e/ledger-import.test.mjs`：
    - 移除 `[data-lgimp-pick="holdings"]`/`[data-lgimp-pick="trades"]` 前置點擊步驟，改由 `[data-lg="imp"]` 直按 `[data-lgimp-upload]` 並斷言送出 `body.mode === "auto"`；mock 回應傳回對應 `kind` 與明確 `asOf`（並補 1 組缺 `asOf` 測 Level 2 與一鍵切換）；原 holdings 測試最後改驗證 `kline:pf:recon:v1.snapshots`（含 `asOf` 日期與 `confirmed` 均價）與 `W.hold` 一致性及舊庫存不動，其餘所有測試（日期修正、斜線切換、`fee`/`tax` 與折扣、同日序列、FIFO 同日排序、sticky col 1、`scrollLeft === 0`、IME Enter 防誤送、焦點管理與 390/1280 零溢出）完全保留。
  - `tests/e2e/hold-source.test.mjs` ＋ `tests/e2e/backup-pf.test.mjs`：補齊 Review Focus 1, 4, 6, 7 的瀏覽器端測試（含雙 Context 併發保護、備份剔除 `pendingCommit`、雲端同步配對與 390/1280）。
- [ ] **跑相關 E2E 測試**：
  - `PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/portfolio-reconcile.test.mjs tests/e2e/ledger-import.test.mjs tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs tests/e2e/pf-mobile.test.mjs tests/e2e/pf-tablet-kbd.test.mjs`
  - 確認全數通過且 `errs`（console error／pageerror）全空。
- [ ] **Batch 2 Commit**：`git add tests/e2e/ && git commit -m "test: 新增庫存自動對帳 24 項 E2E 驗收測試並遷移統一匯入測試"`

---

### Task 9：文件更新、390／1280 截圖檢視、合入 `main` 與升版送審

**Files:**
- Create / Modify: `docs/portfolio/RECONCILE.md`（對帳規範與三層資料口徑文件）、`docs/portfolio/LEDGER.md`、`docs/portfolio/HOLD_SOURCE.md`、`docs/portfolio/BACKUP.md`、`docs/portfolio/PERFORMANCE.md`、`docs/portfolio/OVERVIEW.md`
- Auto-updated via `bump-version.mjs`: `learner/index.html`, `learner/watch.html`, `learner/version.json`, `learner/README.md`

- [ ] **更新 `docs/portfolio/*.md`**：補上 `kline:pf:recon:v1`（含 `scope`、`full_snapshot_close`、`sameDayRelations`、WAL `pendingCommit`）、120KB 核心失敗契約、市場別交割提示、`buildReconciledLedger` 統一計算入口、備份檢查順序、`perf.js` 快照起點口徑與統一匯入流程。
- [ ] **390px 手機與 1280px 桌面截圖實際檢視**：
  - 透過 Playwright 在 390×844 與 1280×800 開啟：統一上傳對話框（含完整／部分切換＋缺年份雙日期確認）、含 Level 1/2/3 與融資隔離的三級審核表、交易紀錄頁「待對帳項目卡片＋歷史稽核抽屜」、及「總覽／持股／績效／配置／報告」帶 `⚠︎ 待對帳（差異 N 股）` 狀態，截圖存於 `/tmp/` 並實際開圖檢視確認無溢出、無重疊、文字完整可讀。
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
