# 庫存入口收斂與自動對帳實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將分散的庫存與交易明細匯入收斂為單一「匯入資料」入口，後端 `/api/import` 在單次請求自動辨識截圖類型（`holdings`／`trades`／`unknown`）、畫面基準日（`asOf`）與融資／融券標記；前端以獨立鍵 `kline:pf:recon:v1`（`learner/recon.js`）與 `KLLedger.buildReconciledLedger` 建立「交易紀錄 × 庫存快照 × 計算持倉」三層架構與自動對帳中心，消除補傳歷史明細重複入帳與漏算賣超，並讓全站 8 個投資組合頁面、持股頁與 `perf.js` 使用同一個真相源且一致標示 `⚠︎ 待對帳（差異 N 股）`。

**Architecture:** 原始交易流水帳續留 `localStorage["kline:pf:v1"]`；庫存快照基準（含 `scope: "full" | "partial"` 與清倉結案 `origin: "full_snapshot_close"`）、對帳差異衝突、同日交易先後標記（`sameDayRelations`）、舊 `transfer_in` 期初標記、匯入記錄（含 `shrink()` 前的原圖 SHA-256）、不可刪改稽核日誌，以及跨鍵寫入 Write-Ahead Journal（`pendingCommit`）獨立存於 `localStorage["kline:pf:recon:v1"]`（`learner/recon.js`；嚴禁存圖片／base64；核心超 120KB fail-closed 拒寫）。計算層由 `KLLedger.buildReconciledLedger(txStoreOrList, reconStore, opts)` 以「各檔最新已確認快照 `B` ＋ 快照後交易」錨定計算（FIFO V1 把快照視作單一合成批次），全站除 `ledger.js` 本身外全面改用統一入口。

**Tech Stack:** 原生 HTML／JS、Vercel Serverless Function（Node 24 ESM）、`node --test`、Playwright（`PW=/opt/node22/lib/node_modules/playwright`）。

**Spec:** `docs/superpowers/specs/2026-11-16-portfolio-auto-reconcile-design.md`

---

## Global Constraints

- **不碰既有用戶存檔**：絕不清除、重建或自動遷移 `kline:watch:hold` 與 `kline:pf:v1`；純舊庫存無交易且無已確認快照時，舊庫存編輯、文字匯入、舊截圖與資料完全不變。
- **獨立對帳鍵、容量 fail-closed 與 `store.set` 檢查**：對帳資料僅讀寫 `kline:pf:recon:v1`（`v: 1`）；`KLRecon.validateStore` 遇到 `/data:image\//i` 或超過 2000 字元的疑似 base64 字串直接拒絕；`KLRecon.pruneStore(s, 120000)` 永遠保留 `confirmed`/`pending` 快照、所有 `status === "open"` 衝突、啟用 `initialTags`、`sameDayRelations`、未結案 `pendingCommit` 與關聯 `imports[]`，僅由舊到新裁剪已結案歷史。若清空可裁剪歷史後仍 `> maxBytes`，強制回傳 `{ ok: false, code: "core_data_exceeds_limit", bytes, maxBytes, store: null }`；寫盤前檢查 `pruneStore().ok` 與 `store.set(...)` 布林回傳值，任一失敗皆中止且不覆寫現有資料。
- **跨雙鍵可恢復提交協議（WAL Commit Protocol）**：凡同時異動 `kline:pf:v1` 與 `kline:pf:recon:v1` 的操作（`kind === "trades"` 匯入、刪除／修改帶有啟用 `initialTags` 之 `transfer_in`），一律經由 `lgCommitDualStores` ＋ `KLRecon.prepareCommit`／`finalizeCommit`／`recoverCommit` 執行 Phase 1（寫 WAL `pendingCommit`）→ Phase 2（寫 `pf:v1`）→ Phase 3（Commit 結案並清除 `pendingCommit`），並於 `lgReconLoad()`／`holdSrcApply()`／`renderLedger()` 啟動時冪等 Roll-Forward 或 Clean Abort。同日定序（`sameDayRelations`）單鍵存於 `kline:pf:recon:v1`。
- **快照完整度、市場與日期安全閘道**：`snapshotScope`（`"full" | "partial"`）必須明確確認，決不自動預設 `"full"`；僅 `asOfStatus === "exact" && asOf <= today`（或使用者明確確認且 `<= today`）可建立 `confirmed` 基準，缺年份 `asOfStatus: "year"` 與未來日 `asOfStatus: "future"` 必進 Level 2。全站以大寫規範 `symbol` 為主鍵並於 `KLRecon.validateStore` 與 `buildReconciledLedger` 雙重強制單一 `(symbol, market, currency)`（`tw/TWD`, `us/USD`）。
- **統一計算入口（防繞過）**：除 `learner/ledger.js` 本身以外，全專案 `learner/*.js` 與 `learner/watch.html` **不得出現任何 `.buildLedger(` 呼叫**（以靜態單元測試把關），一律呼叫 `KLLedger.buildReconciledLedger`。
- **備份鍵序無關與 Fail-Closed**：`KLLedger.checkBackup` 先掃描 `data` 是否存在 `kline:pf:recon:v1`（若 `pendingCommit != null` 或缺 `opts.recon?.validateStore` 或市場衝突即整份拒絕不降級）再驗證 `kline:pf:v1`；`tools.js` `syncImport` 必須動態載入 `recon.js` 並帶入 `recon: KLRecon`。
- **零外部網路／付費 AI 呼叫**：所有單元與 E2E 測試一律使用固定假資料與 mock `/api/import`（或 mock `fetch`／AI 函式），不連外網、不花費額度。
- **範圍與批次紀律**：
  - **Batch 1（本階段）**：只修訂規格書與本實作計畫、維持鎖定 Draft PR，**不更動**任何 `.js`／`.html`／`.css`／`.mjs`／版本檔，停止等待 Claude Code（或 ChatGPT）獨立審查。
  - **Batch 2（規格計畫核可後）**：依 Task 1–9 採 TDD 施作、跑齊指定測試與 390／1280 截圖檢視後集中推送並轉 Ready。
  - **不做項目二無框視覺設計**：不調整 `.pfcard`、`.pftile`、`#stcss` 或 `core.css`／`minimal.css` 的無框版面（沿用現有樣式與 44px 觸控高度）。
  - 提交訊息與 PR 內文不出現 AI 工具或模型名稱；未經使用者明確授權不合併。

---

## Review Focus

1. **備份 JSON 鍵序倒置、未恢復 `pendingCommit` 與缺模組 Fail-Closed**（`checkBackup` 收到 `kline:pf:v1` 排在 `kline:pf:recon:v1` 前的先賣後買快照帳本、含 `pendingCommit != null`、或未載入 `KLRecon`）：絕不可先驗 `kline:pf:v1` 誤報賣超，也不可在缺少檢查函式或未收斂 WAL 時放行 → **Task 3** ＋ **Task 5**。
2. **同一截圖同天同價分批兩筆成交 vs 跨批重複 vs 直接呼叫 `buildLedger()`**：同一批內兩筆 `2454 buy 500 @ 1050` 在 `prepareTradesImport` 不可誤報 `possible_duplicate`；跨批比對 `existingArr`（含 `preSnapshot: true`）須標進 Level 2；而直接呼叫 `KLLedger.buildLedger()` 對同陣列重複列仍維持既有提醒 → **Task 3**。
3. **兩張快照跨過「全數賣光歸零再買回」**：`S1` → 賣光 `0` 股（`costBasis = 0, lots = []`）→ 再買進 → `S2`，期間重播與容差（數量 `max(1e-4, S2*1e-6)`、均價 `max(0.5, S2.avgCost*0.005)`）須能正確晉升或偵測差異 → **Task 3**。
4. **純快照空白帳本（含完整快照結案歸零，無 `kline:pf:v1` 或 `transactions: []`）顯示全站 8 頁＋個股損益**：`holdSrcApply`、`watch.html`、`renderLedger`、`renderAlloc`、`lgPerfData`/`renderPerf`、`pf-home`、`pf-stress` Beta 按鈕、`pf-divcal`、`pf-report`、`pf-thesis`、`perf.js` 一律透過唯讀 `lgStoreOrEmpty()` 正常運算呈現，不退回介紹頁、全數清倉後不誤退回 `kline:watch:hold`、不預寫空 `kline:pf:v1` → **Task 4** ＋ **Task 5** ＋ **Task 6** ＋ **Task 7**。
5. **後端 `api/_lib/import.js` 向下相容**：直接呼叫 `parseTradeDate(null/""/"   ", today)` 與 `cleanTradeRows(rows, opts)`（未傳 `missingAsNull: true`）仍維持 `{ date: refToday, dateAssumed: "today" }`；`marginType` 僅在偵測到信用交易關鍵字時採條件展開附加，一般現股鍵集合與既有 `deepEqual` 測試完全一致 → **Task 1**。
6. **跨雙鍵 WAL 提交協定與 `store.set === false` 防呆**：`lgCommitDualStores` 模擬 Phase 1 失敗、Phase 2 `QuotaExceededError`（`store.set` 回傳 `false`）回滾、Phase 3 中斷後重開頁面冪等 Roll-Forward／Clean Abort，確認最終兩鍵一致且零重複交易；`same_day_order` 寫 `sameDayRelations` 不觸碰 `pf:v1` → **Task 2** ＋ **Task 5** ＋ **Task 6**。
7. **快照 `full` vs `partial` 語意與 `(symbol, market, currency)` 一致性**：`S1` 有 `2330` 時匯入不含 `2330` 之 `S2`：`snapshotScope: "full"` 依推算關閉 `S1`（`full_snapshot_close`）或進 `recon_diff`（`targetShares: 0`）；`snapshotScope: "partial"` 保留 `S1`。同 `symbol` 不同 `market`／`currency` 於 `validateStore`／`planHoldingsSnapshot`／`buildReconciledLedger` 一律拒絕（`currency_conflict`）→ **Task 2** ＋ **Task 3** ＋ **Task 4** ＋ **Task 5** ＋ **Task 6**。
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
    - `sameDayRelations` 與 `pendingCommit` 結構檢查；當 `opts.rejectPendingCommit` 為真且 `s.pendingCommit != null` 回 `{ ok: false, code: "unrecovered_pending_commit" }`（供 `checkBackup` 拒絕未收斂 WAL 備份）；
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
    - `prepareCommit(store, { batchId, op, at, txIds = [], deletedTxIds = [], staged = {} })`：建立寫入 `pendingCommit`（僅含小量 delta `txIds`/`deletedTxIds`/`staged`）之暫存快照，供 Phase 1 寫入 `kline:pf:recon:v1`；
    - `finalizeCommit(store, batchId)`：依 `id` 冪等合併 `pendingCommit.staged`（`imports`/`conflicts`/`audit`/`initialTags`/`sameDayRelations`）或停用 `deletedTxIds` 對應標籤，並清空 `pendingCommit: null`，供 Phase 3 與 Roll-Forward 共用；
    - `recoverCommit(pfStore, reconStore)` → `{ changed, status: "noop"|"rolled_forward"|"aborted"|"partial_recovered", reconStore, failedTxIds? }`：比對 `reconStore.pendingCommit` 與 `pfStore.transactions`，決定 Roll-Forward（全數已在 `pf:v1` → `finalizeCommit`）、Clean Abort（全未寫入 `pf:v1` → 清 `pendingCommit: null`）或部分回復。
  - `planHoldingsSnapshot({ store, ledgerPositions, txStore, batchId, asOf, asOfStatus, asOfConfirmed = false, altDate, rawAsOf, snapshotScope = "partial", rows, fileHashes, method, today, ledgerLib })`:
    - `snapshotScope` 僅接受明確 `"full"` 否則一律視為 `"partial"`（絕不自動猜 `"full"`）；
    - **日期門檻**：僅當 `(asOfStatus === "exact" && asOf <= today) || (asOfConfirmed === true && isValidDate(asOf) && asOf <= today)` 才允許進入 Level 1 建立 `confirmed`；`asOfStatus === "year"`、`"future"`、`"mdy"`、`"invalid"`、`"missing"`（未確認）**一律進 Level 2**；
    - **市場／幣別衝突**：比對同 `symbol` 與既有 `store.snapshots` 及 `txStore?.transactions`（大寫正規化），不一致列直接歸入 Level 3 `currency_conflict`；
    - **完整快照清倉處理（`snapshotScope === "full"` 且日期確認）**：對每個不在本次截圖列正規化 `presentSymbols` 之既有 `activeBaselines` `S1`（`S1.shares > 0 && S1.date < asOf`），重播 `(S1.date, asOf]`：無未定序同日且 `simShares <= EPS` → 排程 `full_snapshot_close` (`status: "confirmed"`, `shares: 0`, `avgCost: null`, `scope: "full"`) 關閉 `S1`；否則（`simShares > EPS` 或有未決同日）→ 排程 `pending` `full_snapshot_close` 快照＋Level 2 `recon_diff`（`targetShares: 0`, `diffShares: -simShares`, `payload: { reason: "missing_in_full_snapshot", previousSnapshotId: S1.id }`），保留 `S1` 不關閉。`snapshotScope === "partial"` 時未出現在截圖列之既有 `S1` 一切不動；
    - 差異文案一律呼叫 `settlementHint(market)`。
  - `applyHoldingsImport(store, plan, opts)` → `{ ok, store, batchId, appliedCount, conflictCount, errors }`（純函式回傳新 store，寫 `snapshots[]`（含 `scope` 與 `full_snapshot_close`）、`conflicts[]`、`imports[]`（含 `snapshotScope`）、`audit[]`）。
  - `resolveConflict(store, conflictId, action, opts = {})` → `{ ok, store, effect }`：支援 `"keep_both"`、`"accept_new"`（必填 `reason`；同時支援一般 `pending` 快照與 `missing_in_full_snapshot` 之 `pending` `full_snapshot_close` 核准關閉 `S1`）、`"keep_baseline"`（放棄新目標設 `superseded` 並結案衝突）、`"mark_before_snapshot"`／`"mark_after_snapshot"`（更新 `sameDayRelations[txId]` 與結案衝突，不修改 `kline:pf:v1`）。
  - `tagInitialTx(store, tx, opts)` / `untagInitialTx(store, txId, opts)` / `deactivateTagsForTx(store, txId, opts)`：對 `transfer_in` 標為期初快照／撤回／刪除停用（僅動 `kline:pf:recon:v1`；檢查 `tx.date <= opts.today` 及市場一致性；`tx.price <= 0` 回 `{ ok: false, code: "missing_cost" }`）。

- [ ] **寫失敗測試**（`tests/recon.test.mjs`）：
  - `validateStore` 拒絕：`data:image/png;base64,...`、超過 2000 字元純 base64 字串、`confirmed` 缺正 `avgCost`（非 `full_snapshot_close`）、壞版本 `v: 2`、**`tw/USD` 錯配與跨快照同 `symbol` 不同 `market/currency`（`currency_conflict`）**、**`confirmed` 日期大於 `today`（`future_snapshot_date`）**、及 `{ rejectPendingCommit: true }` 下含 `pendingCommit != null`。
  - `deriveAvgCost`、`withinTolerance` 與 `settlementHint("tw" | "us" | "")`（T+2 vs T+1 vs 中性文案）精確驗證。
  - `pruneStore`：
    1. 正常裁剪：塞入 300 筆已結案 `imports`/`audit`/`conflicts` ＋ 20 筆 `superseded` 快照 ＋ `confirmed`/`open`/啟用 `initialTags`/`sameDayRelations`/`pendingCommit`/關聯 `imports[]`，斷言 `< maxBytes` 且核心永存；
    2. **不可裁剪核心超限（Review Focus 9）**：塞入大量 `confirmed`／`open` conflicts 使核心資料超出 `maxBytes`（例如 8000），斷言回 `{ ok: false, code: "core_data_exceeds_limit", store: null }` 且不靜默放行。
  - **WAL Commit Protocol 測試（Review Focus 6）**：模擬 `prepareCommit` → Phase 2 未寫入時 `recoverCommit` 執行 Clean Abort；Phase 2 已寫入 `pf:v1` 但未執行 Phase 3 時 `recoverCommit` 冪等 Roll-Forward（連叫兩次亦不生重複 `imports[]`/`audit[]`）；部分存在極端異常修復。
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
    - 頂層新增 `reconcile: { hasSnapshot: boolean, snapshotCount: number, openConflicts: Array, pendingSymbols: string[], unresolvedSameDayCount: number }`
  - 核心引擎規則：
    0. **市場／幣別與大寫 `symbol` 約束**：先以 `reconStore` 各檔規範大寫 `symbol` 建立／檢查 `symMkt`（強制 `CURRENCY[market] === currency`）；若交易清單或快照間同一 `symbol` 出現不同 `market`／`currency`，計入 `errors` `{ code: "currency_conflict" }`（嚴禁繞過 `ledger.js:125` 既有約束）。
    1. **建立期初錨點**：
       - 若 `B.origin === "full_snapshot_close"`（`B.shares === 0`, `B.avgCost === null`）：於 `B.date` 錨定 `shares = 0`, `costBasis = 0`, `lots = []`, `open = false`, `firstDate = B.date`（使基準日前交易保持 `preSnapshot: true` 不回魂，之後新買入則從 0 重建）。
       - 若為有效正數 `confirmed` 基準 `B`（`B.avgCost > 0`, `B.shares > 0`）：於 `B.date` 先建立期初錨點 `shares = B.shares`, `costBasis = r2(B.shares * B.avgCost)`, `firstDate = B.date`；若 `method === "fifo"` 建立單一合成批次 `{ date: B.date, id: B.id, shares: B.shares, cost: r2(B.shares * B.avgCost), isSnapshot: true }`。
    2. 對該標的交易逐筆依時間判斷：
       - `t.id === B.tagTxId` 或 `initialTags[t.id]?.active === true` 且該標的存在有效確認基準、或 `t.date < B.date`：**照常跑 `checkTx`／`duplicate_id`／`currency_conflict`／另計費用驗證，於 `p.history` 標 `preSnapshot: true`（`shares: 0, costBasis: 0`），決不改變 `shares`／`costBasis`／`lots`／`realizedPnl`／`cash`／`totals`，不於 `< B.date` 觸發 `oversell` 或 `over_transfer`**。
       - `t.date === B.date`（非期初標籤本身）：優先查 `reconStore?.sameDayRelations?.[t.id]?.relation`（相容 `t.snapshotRelation`）。`"before_snapshot"` 視為 `preSnapshot` 僅留歷史；`"after_snapshot"` 正常參與計算；**若未標明**則暫不異動基準持股（記為 `sameDayRelation: "unresolved"` 並進 `position.pending` 與 `reconcile.unresolvedSameDayCount`）。
       - `t.date > B.date`：完全按既有規則（含賣光歸零 `costBasis=0, lots=[], open=false` 後再買回重建、與之後真實賣超擋下 `oversell`）。
    3. 另計費用 `fee`（透過 `t.ref` 掛到目標交易 `o`）：若 `o` 為 `preSnapshot`，隨 `o` 一起視為 `preSnapshot` 不改寫快照後成本與現金流。
- `previewAdd(list, tx, opts)`、`deleteImpact(list, id, opts)`、`validateStore(s, opts)`、`prepareHoldingsImport(rows, existingTxs, opts)`、`prepareTradesImport(rows, existingTxs, opts)`：傳入 `opts.recon` 時一律改用 `buildReconciledLedger(..., opts.recon, ...)`（未傳時保留原 `buildLedger` 行為不變）。
- `prepareTradesImport` 同批 vs 跨批去重修正（Review Focus 2）：
  - `sim(seq)` 使用 `opts.recon ? buildReconciledLedger(..., opts.recon, ...) : buildLedger(...)`。
  - 只比對新匯入列與 `existingArr`（包含 `preSnapshot: true` 的已存明細）：核心簽章 `[date, type, symbol, shares, price]` 相符且若有明確不相等的 `time`/`note` 不誤判、其餘給 `possible_duplicate`；**移除**來自 `sim([...existingArr, ...seq])` 內部兩個匯入列之間互相比對造成的誤報 `possible_duplicate`（注意 direct `KLLedger.buildLedger()` 本身不動，維持 `tests/ledger.test.mjs:46` 原斷言）。
  - 另外針對匯入列若命中既有已確認基準的 `t.date < B.date` 或 `t.date === B.date` 未定序，標記對應審核資訊（`reconcileHint: "pre_snapshot" | "same_day_order" | "post_snapshot"`），且缺 `t.date` 時標出 `missing_date`。
- `checkBackup(data, opts = {})`（Review Focus 1）：
  - 不依 `Object.keys(data)` 順序：先判斷 `Object.prototype.hasOwnProperty.call(data || {}, "kline:pf:recon:v1")`。
  - 若存在 `kline:pf:recon:v1`：先 JSON 解析，**必須傳入 `opts.recon && typeof opts.recon.validateStore === "function"`**；否則直標 `ok: false`, `problems: ["沒有對帳快照的檢查程式，為了安全不匯入"]`；之後呼叫 **`opts.recon.validateStore(parsed, { today: opts.today, rejectPendingCommit: true })`**（若備份內 `pendingCommit != null` 亦拒匯），並記錄 item；僅在 `recon` 存在且解析／檢查通過後，帶入 `{ today: opts.today, recon: parsed }` 呼叫 `validateStore(pfV1, ...)`。
  - 若存在 `kline:pf:recon:v1` 且 JSON 壞掉／版本或內容不合法／市場衝突／含 `pendingCommit`，`items` 中該項標 `ok: false`，驗證 `kline:pf:v1` 時不依賴未驗證壞資料，整份 `checkBackup` 回 `ok: false`。

- [ ] **寫失敗測試**（`tests/ledger.test.mjs` ＋ `tests/ledger-import.test.mjs`）：
  - **Review Focus 1**（`tests/ledger.test.mjs`）：備份 JSON 把 `"kline:pf:v1"`（1/10 有基準 1000 股、1/15 賣出 300 股、無買進交易）故意排在 `"kline:pf:recon:v1"` **之前**：傳 `opts.recon = KLRecon` 必須回 `{ ok: true }`（不誤判 `oversell`）；刻意不傳 `opts.recon` 時**必須拒絕**（`ok: false`、「沒有對帳快照的檢查程式」）；**`recon` 含未收斂 `pendingCommit != null` 時必須拒絕**（`ok: false`）。
  - **Review Focus 2**（`tests/ledger-import.test.mjs`）：同一張截圖有兩筆完全同天同代號同股數同價買進（無 `time` 無 `fee`）→ `prepareTradesImport` 不可產生 `duplicates`／`possible_duplicate`；換成與 `existingArr`（含 `< B.date` 的 `preSnapshot` 交易）重複則須進 `duplicates`；而直接呼叫 `KLLedger.buildLedger()` 對同陣列兩筆完全相同列仍保留 `possible_duplicate` 提醒。
  - **Review Focus 3**（`tests/ledger.test.mjs` ＋ `tests/recon.test.mjs`）：`S1`（11/10 1000 股 @900）→ 11/12 賣 1000 股 @950（歸零，`costBasis=0, lots=[]`）→ 11/14 買 500 股 @920（均價與 FIFO 皆由 0 重建）→ 匯入 `S2`（11/15 500 股 @920＋手續費誤差容許內）自動晉升；改用數量 600 股或價差超容差 → 留 `S1` 建 `recon_diff`。
  - **Review Focus 6 & 7**（`tests/ledger.test.mjs`）：
    - `sameDayRelations[t.id]`（記在 `reconStore` 上而非 `t` 本身）正確區分 `before_snapshot`／`after_snapshot`／未決；
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
- Modify: `learner/tools.js:793-806`

**Interfaces — Consumes (`KLRecon`, `KLLedger`) & Produces (`watch.html`, `tools.js`):**
- `LAZY.ledger`（`learner/watch.html:1462`）：改為 `["ledger.js", "recon.js", "ledger-ui.js"]`。
- `holdFromLedger(S, recon)`（`learner/watch.html:2346`）：呼叫 `KLLedger.buildReconciledLedger(S, recon, { method: S.method, today: twIso() })`；回傳 `{ H, errors, txCount, snapshotCount, pendingSymbols }`；若 `p.pending.length` 有值（如 `recon_diff`/`same_day_order`），一併存入 `H[c].pending = p.pending` 讓持股明細列與 `holdDataCheck()` 依標的市場顯示 `⚠︎ 待對帳（差異 N 股）— <T+2 / T+1 / 中性提示>`（透過 `KLRecon.settlementHint`）。
- `holdSrcApply()`（`learner/watch.html:2357`）：
  - 同時讀取 `rawPf = localStorage.getItem("kline:pf:v1")` 與 `rawRecon = localStorage.getItem("kline:pf:recon:v1")`。
  - **啟動／重算 WAL 恢復**：若 `recon?.pendingCommit != null` 且 `typeof KLRecon?.recoverCommit === "function"`，呼叫 `KLRecon.recoverCommit(S0, recon)`；若發生修復，依 `pruneStore` ＋ `store.set` 回傳布林安全寫回 `kline:pf:recon:v1` 後再繼續計算（不重複入帳、失敗不蓋舊檔）。
  - 當 `(hasTx || hasConfirmedSnapshots)`（`hasConfirmedSnapshots` 含 `full_snapshot_close` 結案基準，確保完整清倉歸零後不退回舊 `kline:watch:hold`）且 `!W.hsrcLegacy` 時進入交易帳本模式（確保 `store.lock` 鎖住 `kline:watch:hold` 唯讀）；若僅有快照尚無 `kline:pf:v1`，在記憶體構造虛擬 `S = S0 || { v: 1, method: "avg", transactions: [] }`（**不寫入 `localStorage`**）。
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
  - 呼叫 `KLLedger.checkBackup(j.data, { today: toolsDay(), margin, rebal, thesis, recon: typeof KLRecon !== "undefined" ? KLRecon : null })`（含 `pendingCommit != null` 拒匯與市場約束檢查）。
  - `pfTxt` 納入對帳項目摘要（快照數與未決衝突數）；保留既有 `tools.js:816` `交易紀錄或融資資料超過 150KB，雲端同步不會帶到` 提示文案涵蓋所有超過 150KB 的 `kline:pf:*` 鍵（如 `kline:pf:recon:v1`）。

- [ ] **寫／補測試準備**：確認 `hold-source.test.mjs`、`backup-pf.test.mjs` 既有選擇器與訊息不被破壞。
- [ ] **最小實作**：改動 `learner/watch.html`（`LAZY.ledger`、`holdFromLedger`、`holdSrcApply`＋`recoverCommit`、`holdSrcBar`、`renderHold` 行內待對帳標籤、`storage` 監聽與 `[data-hsrc="tx-recon"]`、`#impFile` 原圖 SHA-256 ＋ `mode: "auto"`）與 `learner/tools.js`（載入 `recon.js` ＋ `checkBackup` 傳 `recon` ＋ 摘要）。
- [ ] **跑相關 E2E 驗證**：`PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/hold-source.test.mjs tests/e2e/backup-pf.test.mjs` 全數通過。
- [ ] **Batch 2 Commit**：`git add learner/watch.html learner/tools.js && git commit -m "watch: 整合持股來源對帳快取、WAL啟動恢復、跨分頁同步與原圖雜湊檢查"`

---

### Task 6：`learner/ledger-ui.js` 統一匯入入口、三級審核、WAL 寫入、對帳中心與績效／配置／期初標記

**Files:**
- Modify: `learner/ledger-ui.js:12-105, 152-216, 268-338, 579-625, 1254-1708`

**Interfaces — Consumes (`KLLedger`, `KLRecon`, `KLPerf`, `KLAlloc`) & Produces (`ledger-ui.js` globals / UI handlers):**
- 共用讀寫、WAL 跨鍵寫入與容量保護輔助：
  - `lgReconLoad()`：讀取 `kline:pf:recon:v1`；若 `recon.pendingCommit != null` 且 `typeof KLRecon?.recoverCommit === "function"`，立即與 `lgLoad()` 執行冪等 `recoverCommit` 並於修復時安全寫回（Roll-Forward 或 Clean Abort），避免帶著殘留 WAL 繼續操作。
  - `lgSave(s)`（`L19` 修正靜默失敗）：傳入 `recon: lgReconLoad()` 至 `KLLedger.validateStore(s, { today: lgToday(), recon: lgReconLoad() })`；**必須檢查 `store.set("pf:v1", ...)` 布林回傳值**，回傳 `false` 時回 `{ ok: false, code: "storage_write_failed", errors: ["瀏覽器儲存空間不足或受鎖定，未寫入交易紀錄"] }`。
  - `lgReconSave(nextRecon, opts = {})`：
    1. 先跑 `KLRecon.validateStore(nextRecon, { today: lgToday() })` 與 `const pr = KLRecon.pruneStore(nextRecon, KLRecon.MAX_BYTES)`；
    2. **Fail-Closed**：若 `!pr.ok`（`pr.code === "core_data_exceeds_limit"`），**絕不呼叫 `store.set`**（保留既有 `kline:pf:recon:v1`），回 `{ ok: false, code: "core_data_exceeds_limit", bytes: pr.bytes, maxBytes: pr.maxBytes }` 並清楚提示使用者「對帳核心資料過大或超過 120KB，本次未覆蓋寫入；請先結案待對帳項目或到『工具 → 備份同步』匯出 JSON 備份」；
    3. 呼叫 `const ok = store.set("pf:recon:v1", pr.store)`；若 `!ok` 回 `{ ok: false, code: "storage_write_failed" }`；成功才通知 `if (typeof holdSrcApply === "function") holdSrcApply()`、`pfExpire?.()`。
  - **`lgCommitDualStores({ buildNextPf, buildFinalRecon, op, batchId, txIds, deletedTxIds, staged })`**（Review Focus 6）：
    - Pre-flight 先行驗證 `nextPf` 與 `finalRecon`（包含 `pruneStore(finalRecon, MAX_BYTES).ok`），任一步不過直接中止不碰任何鍵；
    - Phase 1：`prepared = KLRecon.prepareCommit(recon0, { batchId, op, at, txIds, deletedTxIds, staged })` → 經 `lgReconSave` 寫入 WAL；失敗即中止；
    - Phase 2：寫入 `store.set("pf:v1", nextPf)`；失敗（`false`／例外）立即嘗試復原 `store.set("pf:recon:v1", recon0)` 並回錯；
    - Phase 3：`finalized = KLRecon.finalizeCommit(prepared, batchId)` → 經 `lgReconSave` 清除 `pendingCommit` 並寫入正式 `imports[]`/`audit[]`/`conflicts[]`/停用標記。
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
    - 若 `kind === "holdings"`：帶入使用者選定之 `snapshotScope`（`"partial" | "full"`）與 `asOfConfirmed`，經 `KLRecon.planHoldingsSnapshot` 與 `KLRecon.applyHoldingsImport`，以 `lgReconSave` 寫入 `kline:pf:recon:v1`（若 `pr.ok === false` 或 `store.set === false` 不蓋寫舊檔並保持對話框開啟供處理）。**不把庫存快照寫成 `transfer_in` 塞進 `kline:pf:v1`**。
    - 若 `kind === "trades"`：先通過 `prepareTradesImport(..., { recon })`，再**透過 `lgCommitDualStores` 以 WAL 協議同步寫入 `kline:pf:v1` 與 `kline:pf:recon:v1`**（含 `imports[]`、`audit[]` 與 `same_day_order` 提醒），絕不依序各自獨立存檔。
- **交易紀錄頁頂部「待對帳與衝突中心」＋「匯入與稽核歷史抽屜」＋「標為期初快照／撤回」**：
  - `renderLedger()`（`L40–95`）：
    - 放寬 `L44-51`：只要 `hasTx || hasConfirmedSnapshots || hasOpenConflicts`，直接套用 `lgStoreOrEmpty()` 進入對應子頁（不再退回 `lgIntroHtml()`）。
    - `L60`、`L203`、`L580`（`renderAlloc`）、`L178`（`deleteImpact`）全面改為 `KLLedger.buildReconciledLedger(..., lgReconLoad(), ...)` 與傳入 `recon: lgReconLoad()`。
    - `L76` 持倉歷史列 `KLLedger.TYPE_LABEL[h.type] || (h.type === "snapshot" ? "庫存快照" : h.type)` 與 `h.preSnapshot` 標註「快照前歷史」並顯示 `—` 持股變更，避免出現 `"undefined"`。
    - 頂部若有開放衝突：渲染「待對帳項目（N）」卡片，每筆逐條並列雙邊數值（帳本推算 `baselineShares` / 均價 vs 新截圖 `targetShares` / 均價或「完整截圖已無持股（0 股）」＋ 差異 `N` 股 ＋ **依 `c.market` 分流之交割提示**），按鈕動作：`[data-lgrecon-keep]`（保留兩邊待釐清／保留原基準）、`[data-lgrecon-imp]`（補匯入明細 → 開 `lgOpenImport()`）、`[data-lgrecon-accept]`（採信新快照或確認清倉歸零，需輸入必填原因並核准晉升）、與同日交易專用的 `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`（**僅寫單鍵 `kline:pf:recon:v1.sameDayRelations`，不改 `kline:pf:v1`**）。
    - 下方設 `<details class="lgrecon-hist"><summary>匯入紀錄與對帳稽核（N 筆）</summary>...</details>` 顯示 `imports[]`（時間、類型、`snapshotScope`、原圖雜湊前 8 碼、`fileHashes`、各級列數、基準日）與 `audit[]`。
    - `transfer_in` 交易列按鈕：未標記顯示 `[data-lg="tag-init"]`「標為期初快照」（缺成本／`price<=0` 引導補均價不建 `0` 基準）；已標記顯示「已標為期初快照」徽章＋`[data-lg="untag-init"]`「撤回期初快照標記」；刪除或修改帶有啟用 `initialTags` 的 `transfer_in` 時於確認對話框提醒並走 `lgCommitDualStores` 停用對應標籤與紀錄 `audit[]`。
- **績效與配置整合**（`L268–338` & `L579–608`）：
  - `lgPerfData(S)`：自 `S.transactions` 與 `KLRecon.activeBaselines(lgReconLoad())` 聯集收集 `syms` 與 `curs`（支援純快照抓日 K）。
  - `renderPerf(S)`：當 `!S.transactions.length && !hasConfirmedSnapshots` 才顯示空白訊息；呼叫 `KLPerf.buildPerf(S, { ..., recon: lgReconLoad() })`；`ISS` 新增 `snapshot_baseline` 與 `recon_pending` 中文說明，頁頂加統一 `⚠︎ 待對帳（差異 N 股）` 警示列（依市場別提示）。
  - `renderAlloc(S)`：若 `hasTx || hasConfirmedSnapshots`，呼叫 `buildReconciledLedger` 並傳遞 `meta: { legacy: false, hasSnapshot: L.reconcile.hasSnapshot, openConflicts: L.reconcile.openConflicts, pendingSymbols: L.reconcile.pendingSymbols }` 至 `renderAllocBody`、`rbSectionHtml`、`stSectionHtml`，且於配置頁頂部顯示一致 `⚠︎ 待對帳（差異 N 股）` 警示條與「用已確認快照的股數試算」說明。

- [ ] **寫／補測試準備**：對照 Spec 六「驗收標準 24 項」確認每個 DOM attribute（`data-lgimp-upload`, `data-lgimp-switch`, `data-lgimp-scope`, `data-lgimp-asof`, `data-lgimp-asof-ok`, `data-lgrecon-*`, `data-lg="tag-init"`, `data-lg="untag-init"`）與現有保留選擇器（`data-lgimp-dflip`, `data-lgimp-dok`, `data-lgimp-mv`, `data-lgimp-rev`, `#lgImpOrderOk`, `#lgImpDup`, `#lgImpSave`, `#impLive`）。
- [ ] **最小實作**（`learner/ledger-ui.js`）：逐一補上 `lgReconLoad`／`lgReconSave`／`lgCommitDualStores`／`lgSave` 布林檢查／`lgStoreOrEmpty`、統一匯入 HTML 與範圍／年份閘道、對帳中心／稽核抽屜／期初標記操作、`renderLedger`/`lgPerfData`/`renderPerf`/`renderAlloc` 更新並傳 `recon`。
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
- Modify: `tests/e2e/backup-pf.test.mjs:1-65`（擴增：備份含 `kline:pf:v1` 排 `kline:pf:recon:v1` 之前先賣後買正常匯入；含 base64 圖片／壞 `recon`／`pendingCommit != null`／跨市場衝突整份拒絕）

**Interfaces — Tested UI Selectors & State Keys:**
- Upload & review selectors: `[data-lg="imp"]`, `[data-hsrc="tx-imp"]`, `[data-lgimp-upload]`, `[data-lgimp-switch="holdings"|"trades"]`, `[data-lgimp-scope="partial"|"full"]`, `[data-lgimp-asof]`, `[data-lgimp-asof-ok]`, `[data-lgrecon-keep]`, `[data-lgrecon-accept]`, `[data-lgrecon-imp]`, `[data-lgrecon-sameday="before_snapshot"|"after_snapshot"]`, `[data-lg="tag-init"]`, `[data-lg="untag-init"]`.
- Storage keys: `"kline:watch:hold"`, `"kline:pf:v1"`, `"kline:pf:recon:v1"`.

- [ ] **寫／遷移測試（390px 手機 ＋ 1280px 桌面，全 mock `/api/import` 與報價／日 K）**：
  - `tests/e2e/portfolio-reconcile.test.mjs` 完整覆蓋 Spec「必測情境 24 項」與「Review Focus 1–9」：
    - Case 1, 16：完全空白帳本僅匯入庫存快照（有 `exact` `asOf`）→ 建立 `kline:pf:recon:v1` `confirmed` 快照，8 個投資組合頁（總覽、持股損益/屬性、交易紀錄、績效、配置再平衡/壓力測試、股利、報告與論點）全正常顯示、不寫入空 `pf:v1`、不動 `kline:watch:hold`、0 console error、無水平溢出。
    - Case 2, 3, 4：匯入早於快照日歷史明細（標 `preSnapshot: true`、持股不重複疊加）、晚於快照日買進、晚於快照日賣出（以快照均價計算已實現損益）。
    - Case 5：同張截圖上傳兩次（原圖 SHA-256 `fileHashes` 未決提醒不擋儲存）；同批兩筆同價成交不誤報重複；跨批同簽章進 Level 2 確認。
    - Case 6, 13, 14：`S1 → S2` 容差內（含中間賣光歸零再買回）自動晉升；超容差保留 `S1` 建 `recon_diff` 與全站 8 頁 `⚠︎ 待對帳（差異 N 股）`，並測解決衝突（採信新快照須理由並留稽核／保留兩邊／點補明細）。
    - Case 7, 8, 9, 10：缺 `asOf`（`missing`）與歧義日期（`mdy`）進 Level 2；多股混合各分級獨立判定；Level 3 失敗列不擋同批有效列；同日交易與快照先後選擇後才套用（驗證 `kline:pf:v1` 未額外重寫）；`kind === "unknown"` 就地一鍵切換不重呼 `/api/import`。
    - Case 11, 12, 15, 17, 18：`imports[]`＋`audit[]` 稽核抽屜；融資／融券自動隔離並引導「融資」頁；`transfer_in`「標為期初快照 → 撤回 → 再標記」；兩個 Context 測試跨分頁 `storage` 事件即時重算 `W.hold`。
    - **Case 19（WAL 雙鍵故障與重開頁面恢復）**：模擬 Phase 2 失敗（`Storage.prototype.setItem` 於 `kline:pf:v1` 拋錯 → 自動復原 `kline:pf:recon:v1`、`pf:v1` 無半套殘留）與模擬 Phase 2 已成功、Phase 3 中斷後重載頁面 → `holdSrcApply`／`renderLedger` 自動 Roll-Forward 結案且零重複交易！
    - **Case 20（`full` vs `partial` 快照處理持股歸零）**：`S1` 有 `2330` 時匯入不含 `2330` 之 `S2`：選 `[data-lgimp-scope="partial"]` 保留 `2330`；改選 `[data-lgimp-scope="full"]` 且推算已歸零時自動結案關閉 `S1`，或帳本仍有股數時進 Level 2 確認 `[data-lgrecon-accept]` 後寫入 `full_snapshot_close` 關閉 `S1` 且仍鎖定 `kline:watch:hold` 不退回舊庫存。
    - **Case 21（缺年份 `year` 與未來日 `future` 阻擋）**：截圖 `asOfStatus: "year"`（含 `12/28` 跨年）與 `"future"` 時 UI 並陳 `rawAsOf` 與推定日，未按 `[data-lgimp-asof-ok]` 確認（或修正為未來日後 `<= today`）前**不建立 `confirmed` 快照**。
    - **Case 22（同 `symbol` 不同 `market`／`currency` 約束）**：同 `symbol` 在截圖與既有快照／交易不同市場或幣別時進入 Level 3 `currency_conflict` 並阻擋混入。
    - **Case 23（120KB 核心超限 Fail-Closed）**：注入核心待對帳／確認資料超過上限，儲存被阻擋、既有 `kline:pf:recon:v1` 完好保留，畫面顯示導向匯出／結案提示。
    - **Case 24（依市場區分交割提示）**：台股 `2330` 衝突顯示「台股 T+2」；美股 `NVDA` 衝突顯示「美股 T+1」（無台股 T+2）；混合情境顯示中性提示。
  - `tests/e2e/ledger-import.test.mjs`：
    - 移除 `[data-lgimp-pick="holdings"]`/`[data-lgimp-pick="trades"]` 前置點擊步驟，改由 `[data-lg="imp"]` 直按 `[data-lgimp-upload]` 並斷言送出 `body.mode === "auto"`；mock 回應傳回對應 `kind` 與明確 `asOf`（並補 1 組缺 `asOf` 測 Level 2 與一鍵切換）；原 holdings 測試最後改驗證 `kline:pf:recon:v1.snapshots`（含 `asOf` 日期與 `confirmed` 均價）與 `W.hold` 一致性及舊庫存不動，其餘所有測試（日期修正、斜線切換、`fee`/`tax` 與折扣、同日序列、FIFO 同日排序、sticky col 1、`scrollLeft === 0`、IME Enter 防誤送、焦點管理與 390/1280 零溢出）完全保留。
  - `tests/e2e/hold-source.test.mjs` ＋ `tests/e2e/backup-pf.test.mjs`：補齊 Review Focus 1, 4, 6, 7 的瀏覽器端測試（含 390/1280）。
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
