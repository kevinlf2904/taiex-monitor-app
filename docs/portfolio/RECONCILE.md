# 投資組合入口收斂與自動對帳引擎（項目一）

實作：`learner/recon.js`（`window.KLRecon`，純函式庫）、`learner/ledger.js`（`KLLedger.buildReconciledLedger` 統一對帳計算入口）、`learner/ledger-ui.js`（雙鍵安全鎖與 WAL 提交、統一截圖匯入對話框與對帳中心）；測試：`tests/recon.test.mjs`、`tests/e2e/portfolio-reconcile.test.mjs`。

## 1. 核心架構與存檔邊界

- **舊庫存 `kline:watch:hold` 唯讀**：不清除、不改寫、不自動搬移；由 `store.lock` 阻擋帳本或對帳模式下的任何回寫。
- **交易帳本 `kline:pf:v1`**：只存真實交易紀錄與使用者確認匯入的交易（`buy`、`sell`、`dividend`、`transfer_in` 等）；匯入庫存快照**絕不虛構寫入 `transfer_in`**。
- **獨立對帳存檔 `kline:pf:recon:v1`**：僅在確有快照、對帳衝突、標記、同日順序、匯入稽核或 WAL 提交需求時寫入，結構包含：
  - `snapshots[]`：持倉快照（`id`, `symbol`, `market`, `currency`, `date`, `shares`, `avgCost`, `scope`, `origin`, `status`: `confirmed | pending | superseded`, `supersededBy`, `tagTxId`）。完整清單（`scope: "full"`）結案歸零之標的會寫入 `shares: 0, full_snapshot_close` 之 `confirmed` 快照，維持帳本模式鎖定不退回舊庫存。
  - `conflicts[]`：未結案／已結案待對帳項目（`recon_diff`、`missing_date`、`ambiguous_date`、`missing_cost`、`same_day_order`、`close_position`）。
  - `initialTags{}`：使用者明確對帳本既有的 `transfer_in` 按「標為期初快照」所建立的 `txId → { snapshotId, txHash, active }` 連結；當該筆 `transfer_in` 被跨分頁／舊程式無鎖竄改導致 `txHash` 不符時，`buildReconciledLedger` 偵測為 `staleTags` 並於介面提供一鍵停用清理。
  - `sameDayRelations{}`：確認快照當日的同日交易（`date === baseline.date`）之順序關係（`before_snapshot`｜`after_snapshot`），僅寫入對帳存檔而不改動 `kline:pf:v1`；綁定 `snapshotId` 與 `snapshotDate`，一旦快照切換或交易日期被編輯即自動失效並重回 `unresolved`。
  - `imports[]`：匯入批次摘要與原圖 SHA-256 指紋（`fileHashes[]`）；重複上傳相同圖片時提供非阻斷提示與前往未決衝突的捷徑。
  - `audit[]`：高風險操作與衝突裁決軌跡（保留採信原因 `reason`、回滾／丟棄紀錄），供 `<details class="lgrecon-hist">` 稽核抽屜檢視。
  - `pendingCommit`：跨鍵異動預寫日誌（WAL）。

## 2. 統一截圖匯入與三級分流

- `api/_lib/import.js` 預設以 `mode: "auto"` 接收券商 App 截圖，自動辨識 `kind: "holdings" | "trades" | "unknown"`，回傳截圖基準日（`asOf`、`asOfStatus: "exact" | "year" | "mdy" | "future" | "missing"`、`rawAsOf`、`altDate`）及信用交易欄位 `marginType: "margin" | "short" | null`。
- 核對畫面支援就地切換「庫存快照 ⇄ 成交明細」，**不重複呼叫 `/api/import`**；庫存快照必選「部分截圖／單頁（`partial`）」或「完整庫存清單（`full`）」。
- 信用交易（融資／融券）列強制隔離不混入現股計算，並提供「配置與風險 → 融資管理」導覽連結。
- 三級對帳分流：
  - **Level 1（自動確認／免打擾）**：新建立基準或新快照與推算部位在容差內（股數與成本差 ≤ 1% 且差額 ≤ 0.1%，且基準日為可驗證之過去／今日）、快照前歷史（`preSnapshot`）、明確快照後交易（`post_snapshot`）。
  - **Level 2（待對帳／警示隔離）**：超出容差之差異（`recon_diff`）、缺年份（`year`）／缺日期／歧義日期確認前、缺成本且無法推算（`missing_cost`）、同日未定序（`same_day_order`）、完整清單漏列原持股（`close_position`）、跨批重複簽章或融資隔離。
  - **Level 3（錯誤阻擋）**：無效代號、未支援市場、非正股數、同標的跨市場／幣別衝突（`currency_conflict`）；錯誤僅阻擋問題列，不阻擋同批有效列（取消勾選或修正即可送出）。
- **依市場區分交割提示（`KLRecon.settlementHint(market)`）**：台股（`tw`）提示「台股 T+2 交割入帳時差」、美股（`us`）提示「美股 T+1 交割時差」，混合或未指定市場則給中性提示，避免美股誤用台股 T+2。

## 3. 統一計算入口 `KLLedger.buildReconciledLedger`

- 所有投資組合頁面（`overview`、`perf`、`pf-home`、`pf-rebal`、`pf-stress`、`pf-divcal`、`pf-report`、`pf-thesis`）與看盤持股列（`watch.html` `holdFromLedger`）一律呼叫 `KLLedger.buildReconciledLedger(pfStore, reconStore, opts)`，禁用旁路自行重播交易：
  - `baseline + 同日 snapshots 後交易` 算得當前各標的真實股數與成本起點，並輸出 `reconcile` 摘要（`hasConfirmedSnapshot`、`hasLedgerActivity`、`openConflicts`、`pendingSymbols`、`unresolvedSameDayCount`、`staleTags`、`closedSymbols`）。
  - **計算邊界**：`pending` 衝突不自動覆蓋已確認持股；頁面橫幅明確標示 `⚠︎ 待對帳` 與「用已確認快照的股數試算」。
  - `KLPerf.analyze`／`analyzeByMarket` 以經 `buildReconciledLedger` 裁切後的有效事件流與期初快照部位計算報酬與損益，確保起始基準日之前已由快照涵蓋的歷史不重複計入報酬。

## 4. 併發安全鎖、WAL 恢復與容量上限保護（Fail-Closed）

- **跨分頁併發控制**：雙鍵異動（匯入成交交易、修改／停用期初交易）透過 `navigator.locks` 取得專屬鎖（不支援 Web Locks 時**拒絕寫入**並回傳 `cross_tab_lock_unavailable`，絕不無鎖寫入），並在寫前比對 `expectedRawPf` 與 `expectedRawRecon`（不符即回 `stale_write`）。
- **跨分頁被動同步**：`window.addEventListener("storage")` 偵測他分頁更新 `kline:pf:v1`／`kline:pf:recon:v1` 後僅重新計算與刷新畫面快取，**嚴禁在事件監聽內回寫 `localStorage`**。
- **三段式 WAL（`pendingCommit`）**：Phase 1 寫入 `pendingCommit` → Phase 2 寫入 `kline:pf:v1` → Phase 3 清空 `pendingCommit` 並寫入正式對帳狀態（`import_trades`、`update_tx_tag`、`deactivate_tags`）。啟動時 `KLRecon.recoverCommit` 自動依兩鍵雜湊指紋判斷 Roll-Forward 或 Roll-Back；若遇不一致或未知操作，進入 `halted` 鎖定寫入，於交易紀錄頁顯示異常回復卡提供「還原至變更前（`revert_pre_commit`）」與「以交易紀錄為準清除 WAL（`discard_wal`）」出口。
- **120KB 核心上限保護（Fail-Closed）**：寫入前由 `KLRecon.pruneStore(store, 120 * 1024)` 依優先順序裁剪舊的已取代快照、已結案衝突、非關鍵匯入批次與非活躍標記；**絕不裁剪 `confirmed` 基準、`open` 衝突、被未結案衝突引用的批次或 `pendingCommit`**。裁剪後仍逾 120KB 則拒絕寫入（`core_data_exceeds_limit`），保持原資料完整並提示先匯出 JSON 備份。
