# 庫存各分頁改用交易紀錄與對帳基準（第 8 階段後半＋項目一）

目標：有交易紀錄（`kline:pf:v1` 至少一筆交易）**或已確認對帳快照**（`kline:pf:recon:v1`，含 `full_snapshot_close` 清倉結案基準）時，庫存的「持股」（損益、屬性分析）「風險」「總經敏感度」、個股面板的持股列、
以及其他讀持股的地方（晨報、提醒、行事曆的「我的持股」）一律改用 `KLLedger.buildReconciledLedger` 算出來的持股，不再各算各的。

## 資料來源
- 帳本／對帳模式：持股＝`KLLedger.buildReconciledLedger` 的未平倉部位，在記憶體裡換成舊格式 `{ 代號: { sh, cost, d, dv, lg, pending? } }`：
  - `sh` 股數；`cost` 平均成本（含快照基準起點與快照後實際買進手續費與稅，依帳本成本算法）；`d` 這段持有的建倉日（快照或最近一次從 0 股重買日）；`lg: true` 標示來自帳本／對帳；`dv` 快照後帳本記到的已領股息；`pending` 為該標的之待對帳項目或零股未結算提醒。
- 舊庫存 `kline:watch:hold`：**完全不動**，只讀。即使帳本尚未寫入任何交易或經 `full_snapshot_close` 完整清倉歸零，只要存在已確認快照基準（`KLRecon.hasConfirmedSnapshots`），舊庫存仍保持鎖定、不退回舊持股。
  - `store.set` 加保護：帳本／對帳模式下，任何寫入 `watch:hold` 的動作都會被擋下，避免把算出來的持股寫回舊資料。
- 既沒有交易紀錄、也沒有已確認快照基準時，照舊用舊庫存，畫面與行為不變。

## 損益算法差異（避免重複計算）
- 交易紀錄的成本已含實際買進手續費與稅 → 不再估買進手續費；賣出手續費、證交稅照舊依設定估算（還沒賣）。
- 股息：「含股息」時用帳本記到的已領股息，不再用除息資料推估。

## 編輯、待對帳提醒與雙分頁被動同步
- 帳本／對帳模式下，「編輯庫存」（`[data-imp="edit"]`）、「截圖匯入（舊庫存）」（`[data-imp="shot"]`）、「載入範例」、個股面板的持股設定仍改成提示「到交易紀錄新增買賣」，**完全不改動舊庫存 `kline:watch:hold`**。
- 若仍有未決待對帳項目或 `same_day_order`（僅採用**已確認快照基準**計算目前持股，pending 不覆蓋基準），`holdSrcBar` 與 `holdDataCheck` 會顯示 `⚠︎ 待對帳` 與市場對應交割提示（`台股 T+2`／`美股 T+1`）及 `[data-hsrc="tx-recon"]`「前往對帳中心處理」按鈕；受阻 WAL 時亦提供入口。
- 同時在提示條（`holdSrcBar`）提供 `[data-hsrc="tx-imp"]`「截圖匯入」快捷按鈕：開啟統一截圖匯入對話框（`mode: "auto"`）。
- 每個庫存分頁上方顯示：「持股來自交易紀錄（N 筆交易・M 檔快照基準）」或「持股來自交易帳本（M 檔期初快照）」，並提供「改看舊庫存」（只在這次開啟有效，不存檔）。
- `window.addEventListener("storage")` 偵測其他分頁更新 `kline:pf:v1` 或 `kline:pf:recon:v1` 時，僅在記憶體重算 `W.hold`／`W.holdLg` 與更新畫面，**零回寫 `localStorage`**。

## 實作位置與測試
- `learner/watch.html`：`holdFromLedger`（呼叫 `KLLedger.buildReconciledLedger`）、`holdSrcApply`（含 `fromStorage` 防護與 `pendingCommit` 檢查）、`holdSrcBar`（含 `[data-hsrc="tx-imp"]`、`[data-hsrc="tx-recon"]`）、`holdDataCheck`（含 `⚠︎ 待對帳` 清單）、`holdLgBlock`。
- `learner/core.js`：`store.set` 支援 `store.lock`（回傳 false 就不寫），並回傳是否寫入。
- `learner/ledger-ui.js`：`lgSave`、`lgReconWrite`、`lgCommitDualStores` 存檔後通知庫存重算（`at` 是建立時間，不改）；統一截圖匯入與對帳中心負責匯入與裁決。
- 測試：`tests/e2e/hold-source.test.mjs`、`tests/e2e/ledger-import.test.mjs`、`tests/e2e/portfolio-reconcile.test.mjs`。

## 交易紀錄的台股／美股切換（第 8 階段後半之二）
- 「交易紀錄」「績效」上方有「全部／台股／美股」：篩選各幣別小計、持有中／已出清、交易清單（依幣別：台幣＝台股、美元＝美股）與績效卡片。
- 台幣合併（含匯率拆解）只在「全部」顯示。錯誤、待確認與待對帳提醒不分市場都顯示。
- 只在這次開啟有效，不存檔、不新增額外視圖鍵。「總覽」「配置」「融資」本來就是整個投資組合，沒有切換。
- 庫存上方原本的台股／美股切換對交易紀錄沒有作用，在交易紀錄畫面藏起來。
