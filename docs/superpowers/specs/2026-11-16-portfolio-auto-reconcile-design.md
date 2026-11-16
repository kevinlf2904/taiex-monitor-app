# 庫存功能整合項目一：入口收斂與自動對帳（設計規格）

日期：2026-11-16　實作者：Gemini Antigravity　獨立審查：Claude Code（若額度不足改由 ChatGPT）
狀態：Batch 1 設計規格待審　關聯：Part of #308（依 Issue #308 留言 `6912636743` 定案）

---

## 為什麼做

目前投資組合與庫存匯入存在三個核心問題：
1. **入口分散且技術概念外露**：使用者同時面對舊庫存「截圖匯入」（`[data-imp="shot"]`）、資料來源列快捷鈕（`[data-hsrc="tx-imp"]`）與交易紀錄強制二選一卡片（`[data-lgimp-pick="holdings"]` vs `[data-lgimp-pick="trades"]`），難以判斷該傳哪一邊。
2. **截圖類型與時間軸互不對照**：`prepareHoldingsImport` 直接把庫存截圖轉成 `transfer_in` 寫入 `kline:pf:v1`，而 `prepareTradesImport` 又不知道任何庫存快照基準日期；補傳早於或晚於庫存截圖日期的交易明細時，系統容易把整批明細重複加上原本持股或誤判賣超（`oversell`）。
3. **缺少對帳基準與差異保留機制**：當庫存截圖與交易紀錄試算股數、成本出現落差時，沒有保留雙邊證據並提示可能原因（例如 T+2 未交割或漏傳歷史交易），也沒有全站統一的「⚠︎ 待對帳」警示與單一計算真相源。

## 目標

- **入口收斂**：對外提供單一「匯入資料」截圖入口，由 `/api/import` 在單次呼叫內自動辨識截圖為庫存快照或交易明細（並讀取畫面基準日期、識別融資／融券），使用者無須預先理解 `holdings` 或 `trades`。
- **三層資料分離**：將 **交易紀錄（Transactions）**、**庫存快照（Holdings Snapshot）**、**目前持倉（Position）** 嚴格分層，以獨立版本鍵 `kline:pf:recon:v1` 管理快照、差異衝突、手動期初標記與匯入稽核歷程。
- **自動對帳與統一計算真相源**：新增 `KLLedger.buildReconciledLedger`，取代全站所有直接呼叫 `buildLedger(` 的頁面；以「最新已確認快照＋快照後交易」為原則，在同日／歷史補傳／兩張快照更新／空白只匯入快照／T+2 未交割情境下都能正確計算並標示全站待對帳狀態。

## 不做（這次）

- **不做項目二視覺一致化**：不修改 `.pfcard`、`.pftile`、`#stcss`、`watch.html` 或 `core.css` 的無框卡片樣式，留待項目一合併後另開 PR。
- **不做 FIFO 真實歷史批次重算**：先進先出第一版一律把基準快照視為單一批次；若從明細讀入歷史真實批次，只在明細／稽核記錄中展示，不參與 FIFO 批次扣抵（「保留真實批次」另開 Issue）。
- **不自動把舊 `transfer_in` 升級為快照**：預設 `source === "legacy"` 或舊 `note` 仍是一般 `transfer_in` 交易，須由使用者手動標記或撤回。
- **不動空白／純舊庫存時的既有 `kline:watch:hold` 編輯**：沒有交易紀錄也沒有已確認快照時，舊庫存的手動編輯、文字匯入、舊截圖流程與資料完全不變。

## 絕對不能發生

- 清除、重建、覆蓋或自動遷移既有 `localStorage`（`kline:watch:hold` 與 `kline:pf:v1` 格式與資料完全保留）。
- 在 `kline:pf:recon:v1` 內儲存任何圖片資料（base64／`data:image/`），或讓 `localStorage` 單鍵無上限膨脹而靜默被雲端同步（150KB 上限）遺漏。
- 因補傳早於快照日的歷史交易，就重複增加已確認快照的目前持股；或單憑不完整前期交易擅自推翻、覆蓋較新庫存快照。
- 快照缺少均價時補成 `0` 或直接確立為正式基準。
- 任何投資組合頁面或計算引擎直接呼叫 `KLLedger.buildLedger(` 而繞過統一計算入口。
- 備份匯入時因 JSON 鍵序先驗 `kline:pf:v1` 造成誤報賣超，或在沒有 `KLRecon.validateStore` 時降級放行匯入。
- 測試連外網或呼叫真實付費 AI API；為求通過而刪除既有測試或放寬斷言（UI 入口改為統一選擇器時，僅同步遷移對應選擇器與 mock 欄位）。

---

## 做法比較（已定案）

1. **方案 A：三層架構＋自動對帳與差異保留（採用，Issue #308 拍板）**
   - 交易流水帳留在 `kline:pf:v1`，快照基準／待對帳衝突／期初標記／匯入稽核放在 `kline:pf:recon:v1`（`learner/recon.js`）。
   - 衝突未確認前，以最新已確認快照為計算基準，保留兩邊數值與差異 N 股，並於全站顯示 `⚠︎ 待對帳（差異 N 股）`。
   - 優點：原始資料零破壞、可完全追溯與撤回、補傳歷史不會重複加股。缺點：需協調 `ledger.js`、`recon.js`、`perf.js`、`watch.html` 與 8 個投資組合頁面，屬於高風險帳務變更，需 Claude Code（或額度不足時 ChatGPT）獨立審查。
2. **方案 B：新快照直接覆寫或刪除歷史交易**：會破壞成本與已實現損益追溯紀錄，使用者已明確否決。
3. **方案 C：維持雙軌只加切換按鈕**：無法解決補傳明細重複入帳與同日／日期缺失判斷，未解決根因。

---

## 三層資料架構與 `kline:pf:recon:v1` 規格

| 層級 | 儲存位置 | 職責 | 禁制事項 |
|---|---|---|---|
| 主要資料 **Transactions** | `localStorage["kline:pf:v1"]` | 買進、賣出、股息、公司行動、轉入轉出、入金出金（原始流水帳） | 不把庫存截圖寫成無基準關聯的 `transfer_in`；不因標記快照而竄改或刪除原交易 |
| 基準資料 **Holdings Snapshot** | `localStorage["kline:pf:recon:v1"]`（`learner/recon.js`） | 記錄特定日期券商截圖的持股數量、平均成本、狀態、期初標記與對帳稽核 | **不可存圖片（base64／Data URL）**；不得無上限累積超出 150KB 雲端同步上限 |
| 計算結果 **Position** | 記憶體（`KLLedger.buildReconciledLedger`） | 結合已確認快照基準與後續已確認交易，產出全站唯一股數、成本、損益與 `pending` | 不可寫回 `kline:watch:hold`（沿用 `store.lock`） |

### `kline:pf:recon:v1` Schema（`v: 1`）

```js
{
  v: 1,
  snapshots: [
    {
      id: "snap-...",
      symbol: "2330",
      market: "tw",              // "tw" | "us"
      currency: "TWD",           // "TWD" | "USD"
      date: "2026-11-10",        // YYYY-MM-DD 快照基準日
      shares: 1000,              // > 0
      avgCost: 900,              // confirmed 快照必填 > 0（缺均價不可 confirmed）
      status: "confirmed",       // "confirmed" | "pending" | "superseded"
      supersededBy: null,        // 被哪一張較新快照取代
      origin: "import",          // "import" | "tx_tag"
      tagTxId: null,             // origin === "tx_tag" 時對應的交易 id
      sourceBatchId: "imp-...",
      confirmedAt: "2026-11-16T00:00:00.000Z",
      reason: "",                // 例如強制採信原因或自動晉升說明
      note: ""
    }
  ],
  conflicts: [
    {
      id: "conf-...",
      kind: "recon_diff",        // "recon_diff" | "missing_cost" | "missing_date" | "ambiguous_date"
                                 // | "same_day_order" | "possible_duplicate" | "negative_position"
                                 // | "unknown_symbol" | "unknown_side" | "margin_separated"
      level: 2,                  // 2 | 3
      status: "open",            // "open" | "resolved"
      symbol: "2330",
      market: "tw",
      currency: "TWD",
      date: "2026-11-12",        // 可能為 null（例如 missing_date）
      baselineSnapshotId: "snap-...",
      baselineShares: 1000,      // S1＋已確認交易推算或現有基準股數
      baselineAvgCost: 900,
      targetShares: 1200,        // 新匯入截圖或推算目標股數
      targetAvgCost: 920,
      diffShares: 200,           // targetShares - baselineShares
      payload: {},               // 原始待確認列或推算明細（不可含圖片字串）
      resolution: null,          // "keep_both" | "accept_new" | "keep_baseline" | "mark_before_snapshot" | "mark_after_snapshot" | "confirmed_unique" | "discarded"
      resolutionReason: null,
      resolvedAt: null,
      batchId: "imp-..."
    }
  ],
  initialTags: {
    "<txId>": { snapshotId: "snap-...", taggedAt: "ISO", active: true }
  },
  imports: [
    {
      id: "imp-...",
      at: "ISO",
      kind: "holdings",          // "holdings" | "trades" | "unknown"
      asOf: "2026-11-10",        // YYYY-MM-DD | null
      asOfStatus: "exact",       // "exact" | "year" | "mdy" | "invalid" | "missing" | null
      fileHashes: ["<sha256-hex>"], // 由原始 File.arrayBuffer() 於 shrink() 前計算
      totalRows: 3,
      autoApplied: 2,
      level2Count: 1,
      level3Count: 0,
      marginCount: 0,
      status: "open",            // 若仍有任何對應 open conflict 則為 "open"，否則 "resolved"
      rawSummary: [
        { symbol: "2330", name: "台積電", side: null, shares: 1000, avgCost: 900, price: 950, date: "2026-11-10", level: 1, outcome: "applied" }
      ]
    }
  ],
  audit: [
    { id: "aud-...", at: "ISO", action: "snapshot_confirmed", symbol: "2330", snapshotId: "snap-...", conflictId: null, txId: null, batchId: "imp-...", reason: "" }
  ]
}
```

### 容量控管與 150KB 雲端同步限制

`tools.js` 的 `syncSnap(false)` 會略過序列化長度 `>= 150000` 字元的單鍵。因此 `learner/recon.js` 必須提供 `KLRecon.pruneStore(s, maxBytes = 120000)`：
1. **絕對禁存圖片**：`validateStore(s)` 檢查結構時若偵測到任何值符合 `/data:image\//i` 或超過 2000 字元疑似 base64 影像編碼字串，直接回傳 `{ ok: false, code: "image_not_allowed" }`。
2. **保留優先序（裁剪僅動歷史、不動目前權益與未決問題）**：
   - **永不裁剪**：所有 `status === "confirmed"` 與 `status === "pending"` 的 `snapshots`、所有 `status === "open"` 的 `conflicts`、所有啟用中的 `initialTags`、以及與任何 `open` 衝突關聯（同 `batchId`）的 `imports[]`。
   - **優先裁剪**：依時間由舊到新裁剪已結案的 `imports[]`（預設保留最近 40 筆已結案記錄）、已結案的 `audit[]`（預設保留最近 160 筆）、已結案的 `conflicts[]`（保留最近 60 筆）及早於保留門檻的 `superseded` 舊快照（每檔保留最新 3 筆歷史快照；若總長度仍超過 `maxBytes`（預設 120KB）才繼續由最舊裁剪已結案歷史，並以 `tools.js` `syncBigPf()` 作為最後保險警示。

---

## 統一計算入口與備份驗證順序

### 1. `KLLedger.buildReconciledLedger(txStoreOrList, reconStore, opts = {})`

- 簽章：`buildReconciledLedger(txStoreOrList, reconStore, opts = {})`（`opts` 同 `buildLedger`，含 `method`、`today`、`rules`、`prices`）。
- 向下相容：既有 `KLLedger.buildLedger(list, opts)` 函式簽章與語意保留不變，供既有無快照單元測試獨立執行；但**所有瀏覽器模組與頁面一律改呼叫 `KLLedger.buildReconciledLedger`**。
- 全站必須改用的 10 處呼叫點（及須同步放寬「無交易即 return」的 3 處早期攔截）：
  1. `learner/watch.html`：`holdFromLedger(S, recon)`
  2. `learner/ledger-ui.js`：`renderLedger()` 持倉與明細計算；以共用輔助 `lgStoreOrEmpty()` 於「無交易但有已確認快照」時提供虛擬 `{ v: 1, method: "avg", transactions: [] }` 唯讀檢視（不預先寫入 `kline:pf:v1`，僅當使用者手動新增交易或切換成本算法時才由 `lgSave` 落盤），不跳回空介紹頁
  3. `learner/ledger-ui.js`：`#lgForm` 送出前試算（傳入 `recon: lgReconLoad()`）
  4. `learner/ledger-ui.js`：`deleteImpact` 與 `renderAlloc(S)`（同步納入 `recon`；刪除帶有 `initialTags[id]?.active` 之 `transfer_in` 時確認並自動停用對應 `tx_tag` 快照寫 `audit[]`）
  5. `learner/perf.js`：`buildPerf(txs, opts)`（接受 `opts.recon`，並允許僅有已確認快照時產出各幣別績效；另更新 `ledger-ui.js` `lgPerfData(S)` 與 `renderPerf(S)`，自交易與已確認快照聯集取得代號與幣別，不因 `!S.transactions.length` 提前結束）
  6. `learner/pf-home.js`：`renderHomeView(S)` 與 `hmTrendData(S)`（無交易但有已確認快照時正常顯示總資產與趨勢）
  7. `learner/pf-stress.js`：點擊 `[data-pst="beta"]` 載入日 K Beta 時的持股清單計算（改讀 `lgStoreOrEmpty()`＋`buildReconciledLedger`，純快照帳本亦可計算 Beta）
  8. `learner/pf-divcal.js`：`renderDivView(S)`
  9. `learner/pf-report.js`：`renderReportView(S)`（無交易但有已確認快照時仍可產生報告）
  10. `learner/pf-thesis.js`：`renderThesisView(S)`
- `learner/overview.js`：`KLOverview.summarize(L, quotes, opts)` 直接消費統一入口回傳的 `L.positions`（含純快照部位與 `position.pending` 內的 `recon_diff`），於 `alerts`／`issues` 中彙整待對帳警示。
- `KLLedger.previewAdd(list, tx, opts)` 與 `KLLedger.deleteImpact(list, id, opts)` 同步接受 `opts.recon`，於傳入 `opts.recon` 時改呼叫 `buildReconciledLedger` 以維持快照基準前不誤判賣超與影響範圍正確。
- **防繞過靜態測試**：新增單元測試掃描 `learner/*.js` 與 `learner/watch.html`，斷言除 `learner/ledger.js` 本身之外，沒有任何檔案呼叫 `.buildLedger(`。

### 2. `validateStore`、`checkBackup` 與 `tools.js` 順序規則

- `KLLedger.validateStore(s, opts = {})` 支援 `opts.recon`：傳入 `opts.recon` 時改呼叫 `buildReconciledLedger(s, opts.recon, { ...opts, method: s.method })`，確保匯入或儲存「先有快照、後有賣出」的帳本不會被誤判成賣超。
- `KLLedger.checkBackup(data, opts = {})` **鍵序無關但驗證有嚴格先後**：
  1. JSON 物件鍵順序不能依賴，實作時**先檢查 `data` 是否含 `"kline:pf:recon:v1"`**。
  2. 若存在 `"kline:pf:recon:v1"`：先解析 JSON，**必須傳入 `opts.recon && typeof opts.recon.validateStore === "function"`**；缺 `opts.recon` 或無 `validateStore` 時**直接整份拒絕（`ok: false`、「沒有對帳快照的檢查程式，為了安全不匯入」）**，決不降級。通過後保存驗證過的 `reconObj`。
  3. 再以 `validateStore(pfV1, { today: opts.today, recon: reconObj })` 驗證 `"kline:pf:v1"`。
  4. 所有其他鍵（`kline:pf:margin:v1`、`kline:pf:targets:v1`、`kline:pf:thesis:v1`）沿用既有嚴格模組檢查。
- `learner/watch.html`：`LAZY.ledger` 改為 `["ledger.js", "recon.js", "ledger-ui.js"]`。
- `learner/tools.js`：`syncImport` 於有 `pfKeys` 時除了 `await lazy("ledger")`，另外保護檢查若 `pfKeys.includes("kline:pf:recon:v1") && typeof KLRecon === "undefined"` 則明確動態載入 `recon.js`（失敗即整份拒絕不匯入），並將 `recon: typeof KLRecon !== "undefined" ? KLRecon : null` 傳入 `KLLedger.checkBackup`；匯入確認文字亦帶出快照與待確認筆數，150KB 超限提示涵蓋所有超限 `kline:pf:*` 鍵。

---

## 自動對帳引擎核心規則

### 1. 基準快照建立與歷史交易關係（Single Snapshot Baseline）

對每個標的 `symbol`，取 `reconStore.snapshots` 中 `status === "confirmed"` 且 `date`（同一日則以 `confirmedAt` 較新者）最新的快照為正式基準 `B`：
- **缺均價保護**：快照進入正式 `confirmed` 基準前（無論在 `validateStore`、匯入確認或手動標記 `transfer_in`），若 `B.avgCost` 為 `null` 或 `<= 0` 且無法由 `(shares * price - totalPnl) / shares` 或 `(marketValue - totalPnl) / shares` 得出正數均價，**強制導向 Level 2（`missing_cost`），不得補成 `0` 或升級為 `confirmed`**。
- **錨點初始化**：
  - 於 `B.date` 設定期初股數 `shares = B.shares`、`costBasis = r2(B.shares * B.avgCost)`、`firstDate = B.date`。
  - **FIFO V1**：僅產生 **1 筆合成批次**：`{ date: B.date, id: B.id, shares: B.shares, cost: r2(B.shares * B.avgCost), isSnapshot: true }`。後續賣出依 FIFO 先扣抵此合成批次（或後續新買入且更晚賣出），已實現損益正確以 `B.avgCost` 計算。
  - **加權平均**：以 `(B.shares, r2(B.shares * B.avgCost))` 為起點計算後續移動加權平均成本與賣出已實現損益。
- **按日期分類處理該標的交易**：
  - **`t.date < B.date` 或 `t.id === B.tagTxId`（含被標為期初快照之 `transfer_in`）**：
    - 照常執行格式驗證（`checkTx`）、`currency_conflict`、`duplicate_id` 與跨批重複比對，並保留於 `p.history` 標註 `preSnapshot: true`。
    - **不重複加減目前持股、不變動 `costBasis`／`lots`／`realizedPnl`／`cash`／`totals`，不因缺少早期買進紀錄而誤觸快照前 `oversell`**。
  - **`t.date === B.date`（同日交易）**：
    - 若交易尚未經使用者明確標記 `snapshotRelation === "before_snapshot"` 或 `"after_snapshot"`，**不可擅自假設先後順序**！該筆同日交易列為 Level 2 待確認（`same_day_order`），並反映於 `position.pending`；未確認前暫不異動基準持股（或標記未決，防止同日賣出在未釐清快照涵蓋與否時誤算兩次），待使用者於 UI 點「快照前已含（僅存歷史）」或「快照後才成交（納入持倉計算）」並記錄 `audit[]` 后生效。
  - **`t.date > B.date`（晚於快照日）**：
    - 依標準帳本引擎時序套用 `buy`、`sell`、`dividend`、`stock_dividend`、`split`、`fraction_cash`、`transfer_in`、`transfer_out`、`fee`、`other`。
    - 若賣光歸零（`shares <= EPS`），`costBasis = 0`、`lots = []`、`open = false`；之後再買進則從 0 重建成本與新批次，歷史 `realizedPnl`、`dividends`、`fees`、`taxes` 完整保留。
    - 若晚於 `B.date` 發生 `sell > p.shares + EPS` 或 `transfer_out > p.shares + EPS`，維持擋下／標錯（於匯入流程歸入 Level 3 `negative_position` 暫停入帳）。

### 2. 兩張快照的取代、早於基準匯入與差異衝突規則（`S1` → `S2`）

當同一標的存在已確認基準 `S1`，使用者又匯入快照 `S2`（含 `S2.avgCost > 0`）：
- **若 `S2.date < S1.date`（匯入早於現有基準的歷史快照）**：
  - 絕不讓較舊快照取代、降級或覆蓋較新確認基準 `S1`；將 `S2` 存入 `snapshots[]` 並設 `status: "superseded"`, `supersededBy: S1.id`，於 `audit[]` 記錄 `"匯入快照早於現有基準日，僅留存歷史不覆蓋較新基準"`。
- **若 `S2.date >= S1.date`**：
  1. 若在 `S1.date` 或 `S2.date` 存在尚未標明 `snapshotRelation`（`"before_snapshot"` / `"after_snapshot"`）之同日交易，先中止自動晉升並進入 Level 2（`same_day_order` / `recon_diff`），避免在時序未明下覆蓋基準。
  2. 以 `S1` 為基準，重播落於 `(S1.date, S2.date]`（含 `S1.date` 標示 `after_snapshot`、以及 `S2.date` 標示 `before_snapshot` 或已定序之成交，含中間賣光歸零再買回）的所有有效交易，算出截止 `S2.date` 的推算股數 `simShares` 與推算均價 `simAvgCost`。
  3. **自動晉升條件**（同時成立且無未決同日衝突與有效錯誤）：
     - `Math.abs(simShares - S2.shares) <= Math.max(1e-4, S2.shares * 1e-6)`
     - `simShares > EPS && simAvgCost > 0 && S2.avgCost > 0 && Math.abs(simAvgCost - S2.avgCost) <= Math.max(0.5, S2.avgCost * 0.005)`
  4. **結果判定**：
     - **一致**：`S2` 自動晉升為新 `confirmed` 基準；`S1.status = "superseded"`、`S1.supersededBy = S2.id`；`audit[]` 新增 `auto_promoted`。
     - **不一致（股數或均價超出容差）**：
       - 保留 `S1` 為正式計算基準（不覆蓋已確認資料）。
       - `S2` 存為 `status: "pending"`，並於 `conflicts[]` 新增 `open` Level 2 衝突（`kind: "recon_diff"`, `baselineSnapshotId: S1.id`, `baselineShares: simShares`, `targetShares: S2.shares`, `diffShares: S2.shares - simShares`）。
       - `position.pending` 加入 `{ code: "recon_diff", conflictId, baselineShares: simShares, targetShares: S2.shares, diffShares: S2.shares - simShares, message: "⚠︎ 待對帳（差異 ... 股）" }`。

### 3. 舊的 `transfer_in` 手動「標為期初快照／撤回」規則

- 既有 `kline:pf:v1` 內的 `type === "transfer_in"` 交易（包含 `source: "legacy"` 舊庫存搬移），**預設永遠視同一般交易**。
- 在「交易紀錄」清單中，每一筆 `type === "transfer_in"` 且含有效股數與代號的紀錄提供操作按鈕：
  - 未標記：顯示 `標為期初快照`（若該筆 `price <= 0` 或缺成本，點擊時導向補填有效均價或 Level 2 `missing_cost` 提示，不靜默以 `0` 建立基準）。
  - 已標記：顯示 `已標為期初快照` 徽章與 `撤回期初快照標記` 按鈕。
- **不改寫 `kline:pf:v1`**：標記／撤回僅寫入 `kline:pf:recon:v1`（更新 `initialTags[tx.id]`、對應 `origin: "tx_tag"` 快照及 `audit[]`）。當 `initialTags[tx.id]?.active` 為真時，統一計算入口對該筆交易加上 `preSnapshot: true`（不重複計數）：
  - 若該標的沒有更新的確認基準，或此標記為唯一／最新基準，即以該 `tx_tag` 快照為計算基準。
  - 若該標的已存在更晚的確認基準 `B_newer`（`T.date < B_newer.date`），維持 `B_newer` 為 `confirmed` 基準不替換：依第 2 節規則檢核 `tx_tag`＋期間交易與 `B_newer`，若一致則 `tx_tag` 設 `superseded`（`supersededBy: B_newer.id`）且 `T` 仍標 `preSnapshot: true` 避免重複計數；若不一致則保留 `B_newer` 并建立 `recon_diff` 供確認；撤回或刪除該 `transfer_in` 時僅停用該 `tx_tag` 快照，絕不破壞 `B_newer`。

---

## `perf.js` 報酬與現金口徑

- **現金不異動**：快照不會在 `L.cash` 建立任何存入或買進紀錄，避免汙染現金比例與總資產計算。
- **時間加權／資金加權從快照日起算**：
  - `buildPerf(txs, opts)` 支持 `opts.recon`（若有 `LG.buildReconciledLedger` 且傳入 `opts.recon` 時優先使用；無 `opts.recon` 時完全保留原 `buildLedger` 行為以維持既有單元測試相容）。
  - 當某標的具有已確認基準 `B`：
    - `preSnapshot`（早於 `B.date` 或屬期初標記）的交易現金流**不計入** `flows`、`inflow`／`outflow` 與 `lastTradePx`；`sharesAt` 在 `d < B.date` 一律為 `0`（不含未入帳的快照前歷史）。
    - 於 `B.date` 產生一筆初始證券投入現金流 `f = B.shares * initPrice`：若 `books[B.symbol]` 在 `B.date` 有當天收盤價（`px.d === B.date`）則優先使用市價，否則回退以 `B.avgCost` 計算（與 `transfer_in` 一致，回退時加入 `est.add("transfer_at_cost")`）。
    - **重要修正**：因為計算起點直接從各檔有效起點（`B.date`）或最早有效日算起，若股票日 K 第一天早於或等於 `B.date`，即使該檔在 `B.date` 前曾有標記為 `preSnapshot` 的舊交易（例如兩年前 `transfer_in`），也不會誤報 `history_truncated`。
- **`est` 與 `issues` 標示**：
  - 有任一標的採用快照基準時，寫入 `est.add("snapshot_baseline")` 並加入 `issues.push({ k: "snapshot_baseline", codes: [...] })`。
  - 有任一標的帶有 `recon_diff` 未決差異時，寫入 `est.add("recon_pending")` 並加入 `issues.push({ k: "recon_pending", codes: [...], diffs: [...] })`。
  - 無交易紀錄但有已確認快照時，放寬 `perf.js` `!T.some(t => t.symbol)` 及 `ledger-ui.js` `lgPerfData`/`renderPerf` 的空交易攔截，確保只匯入庫存快照的帳本也能完整顯示績效與比較基準。

---

## AI 單次自動辨識（`api/_lib/import.js`）

- **介面與向下相容**：
  - `POST /api/import` 新增 `mode: "auto"`；省略或 `""` 時**仍預設 `"holdings"`**，以確保既有整合測試與外部呼叫相容；不支援的 `mode` 仍回傳 HTTP `400`。
  - 新增 `AUTO_PROMPT` 與 `AUTO_SCHEMA`：單次 AI 請求同時輸出 `{ kind: "holdings" | "trades" | "unknown", asOf: string | null, rows: [...] }`。
  - **回應 JSON（`mode === "auto"`）**：
    ```js
    {
      ok: true,
      mode: "auto",
      kind: "holdings" | "trades" | "unknown",
      asOf: "YYYY-MM-DD" | null,
      asOfStatus: "exact" | "year" | "mdy" | "invalid" | "missing",
      // 僅當 mdy / invalid 時才帶出 altDate / rawAsOf
      rows: [...],
      model: "..."
    }
    ```
- **日期規則（`asOf` 與逐列 `date`）與向下相容**：
  - `parseTradeDate(raw, today, opts = {})` 與 `cleanTradeRows(rows, opts = {})` 在**未傳入 `missingAsNull: true` 時完全保留既有行為**：空白／`null`／純空白仍回傳 `{ date: refToday, dateAssumed: "today" }`，確保既有的直接單元呼叫與 `tests/ledger-import.test.mjs` 斷言完全不中斷。
  - **僅 `mode: "auto"`** 在清理時啟用 `{ missingAsNull: true }`：
    - 對 `kind === "holdings"` 與頂部基準日 `asOf`（`parseAsOf(asOfRaw, today)`）：沿用 `parseTradeDate` 核心解析規則產出 `asOfStatus: "exact" | "year" | "mdy" | "invalid" | "missing"`；若 `asOfRaw` 為空／`null`，回傳 **`asOf: null, asOfStatus: "missing"`**（決不為無日期快照合成今天），並由前端直接觸發 Level 2 要求確認基準日期。
    - 對 `kind === "trades"`：逐列缺日期時回傳 `{ date: "", dateAssumed: "missing" }`；前端收到後若頂部 `asOf` 為有效日期（`asOfStatus === "exact" | "year"`）即自動為空白列預帶 `asOf`（標示「自動帶入截圖基準日」並允許逐列修改），若連頂部 `asOf` 也為 `"missing"`／`"invalid"` 則進入 Level 2 `missing_date` 請使用者補填。
- **融資／融券辨識與條件展開**：
  - `PROMPT`／`TRADES_PROMPT`／`AUTO_PROMPT` 與結構清理函式 `cleanRows`／`cleanTradeRows` 擴充擷取信用交易標記（`融資`、`融券`、`資買`、`資賣`、`券賣`、`券買`、`\bmargin\b`、`\bshort\b` 等）。
  - 一律以條件展開 `...(marginType ? { marginType } : {})` 輸出：僅在實際偵測到信用交易關鍵字時才於回傳物件附上 `marginType: "margin" | "short"`；一般現股完全保持原本鍵集合不變，不破壞既有單元測試 `deepEqual` 契約。
- **Mock 與錯誤處理**：
  - 若 AI 回傳 `kind === "unknown"` 但無可用資料列，回 200 `{ ok: false, kind: "unknown", error: "..." }`；若帶有可讀資料列，則回 `{ ok: true, mode: "auto", kind: "unknown", ... }` 由前端檢視表格直接讓使用者手動點選為「庫存快照」或「交易明細」（不額外重呼叫 AI）。
  - 所有測試一律 mock `fetch`／AI 函式，涵蓋成功、失敗（無金鑰、429、503、422）、`unknown`、缺日期、斜線歧義日期與融資融券隔離。

---

## 去重與原檔 SHA-256

1. **原始檔案 SHA-256 計算位置**：
   - 在 `learner/watch.html` 的 `#impFile` `change` 事件處理內，**於呼叫 `shrink(file)` 縮小轉成 JPEG 之前**，讀取原始檔案二進位位元組 `await file.arrayBuffer()`，使用 Web Crypto `crypto.subtle.digest("SHA-256", buf)` 轉為 64 碼小寫十六進位雜湊。
   - **為什麼一定要在 `shrink()` 之前**：瀏覽器重繪 canvas 再編碼後的 JPEG 位元流會因時間、裝置差異而與原檔不同（或遺失原檔 EXIF／原封包指紋），只有在 `shrink()` 前針對原 `File` 雜湊，同一張截圖重複上傳才會 100% 得出相同指紋。
2. **重複上傳同一張圖的行為**：
   - 記錄 `fileHashes` 於 `kline:pf:recon:v1.imports[]`。
   - **若該圖上次上傳批次仍有 `status === "open"` 的未確認衝突**：只在前台檢查畫面顯示**非阻斷警告橫幅**（「這張圖片之前上傳過，尚有 N 筆待對帳項目未完成」＋「前往該待對帳項目」快捷按鈕），**絕對不擋下使用者繼續檢查或完成確認**。
   - **若該圖上次已完全入帳（無未決衝突）**：提示使用者此圖先前已完整匯入，若仍堅持送出檢視，交易明細依跨批簽章進 Level 2 重複確認；庫存快照依自動對帳比對是否已有完全相同基準。
3. **修復 `prepareTradesImport` 同批 vs 跨批判定**：
   - 現況缺陷：`learner/ledger.js:495` 的 `prepareTradesImport` 呼叫 `buildLedger([...existingArr, ...seq])`，使同一張截圖內的同天、同代號、同價兩筆分批成交互相觸發 `possible_duplicate`。
   - 修正規則：**同批次內部相同成交（如同一張對帳單兩筆同價成交）不判定為重複（`possible_duplicate`）**；僅當該列與既有帳本 `existingArr`（含標示為 `preSnapshot: true` 之已存歷史明細）之核心簽章 `[date, type, symbol, shares, price]`（若有時間／委託書附註且皆有值但明確不相同時亦可輔助排除）相符時，才列為跨批次疑似重複並進入 Level 2 請使用者確認，不直接刪除任何一筆。

---

## 入口收斂、三級分流、T+2 提示與全站 8 頁標示

### 1. 單一主要入口與檢視流程

- 入口整併：
  - `watch.html` 資料來源列「截圖匯入」（`[data-hsrc="tx-imp"]`）、帳本簡介頁（`lgIntroHtml`）與交易紀錄工具列（`[data-lg="imp"]`），**全面導向同一個「匯入資料」統一視窗（`lgOpenImport()`）**。
  - **移除前置二選一關卡**：打開後不先問使用者「你是庫存還是對帳單」，而是直接提供單一「📷 上傳券商截圖（自動辨識庫存／交易明細）」主按鈕（送 `mode: "auto"` 到 `/api/import`），下方輔以次要入口「手動新增空白列」與「待對帳項目（N）」（若有開放衝突）。
  - AI 回傳後於審核表格頂部呈現「系統辨識結果：庫存快照／交易明細＋截圖基準日」（若 `kind === "unknown"` 則亮顯請選擇類型切換鈕），**保留一鍵切換「改為庫存快照／改為交易明細」**。
  - **既有 E2E 遷移說明**：原 `tests/e2e/ledger-import.test.mjs` 使用前置選項卡 `[data-lgimp-pick="holdings"|"trades"]` 與驗證送出 `mode: "holdings"|"trades"`。實作 Batch 2 將同步把該測試遷移至新統一上傳入口與 `mode: "auto"`，原有所有斷言（日期修正、手續費與折扣、FIFO 同日排序、黏滯表頭無水平溢出、代號檢核、舊庫存不動）完整保留，絕不放寬。

### 2. 三級處理分流

| 分級 | 條件 | 系統行為 |
|---|---|---|
| **Level 1（自動處理）** | 代號、方向、精確日期、股數、有效價格／正成本齊全；無重複；非融資融券；與基準快照關係明確（`S1→S2` 在容差內自動晉升、`t.date < B.date` 納入歷史不重加股數、`t.date > B.date` 正常加減） | 在審核清單清楚標示系統自動對帳結論（例如「歷史紀錄：不重複增加持股」、「快照自動更新基準」），確認後直接套用並記錄 `audit[]` |
| **Level 2（顯示差異，請使用者確認）** | ① 快照推算與新快照數量或成本差超出容差（`recon_diff`）；② 快照缺均價（`missing_cost`）；③ 截圖缺基準日或格式歧義（`missing_date`／`ambiguous_date`）；④ 同日交易與快照先後未明（`same_day_order`）；⑤ 跨批疑似重複（`possible_duplicate`）；⑥ 截圖含融資／融券部位（`margin_separated`） | 保留雙邊資訊並暫維持現有已確認快照計算。`recon_diff` 必顯示：**「⚠︎ 待對帳（差異 N 股）— 可能是近 2 個交易日還沒交割，或有交易還沒匯入」**，提供保留兩邊待釐清／補匯入明細／採信新快照（須留原因寫 `audit[]`）三種處理。融資融券列自動隔離且預設不勾選入現股帳本，引導至「配置與風險 → 融資」管理 |
| **Level 3（暫停入帳，不擋其他列）** | 代號無法辨識、方向不明、無效日期／時間、快照後造成負持股（賣超） | 標紅暫停套用該列（使用者可當場修正欄位、取消勾選排除、或僅保留其餘正確列先完成匯入），絕不自行猜測覆蓋 |

### 3. `holdSrcApply`／`holdSrcBar`、跨分頁即時更新與全站 8 頁標示

- **`watch.html` 資料來源判斷**：
  - `holdSrcApply()` 讀取 `kline:pf:v1` 與 `kline:pf:recon:v1`；**有交易（`transactions.length > 0`）或有至少一筆已確認快照（`confirmedSnapshots.length > 0`）**且 `!W.hsrcLegacy` 時，全部改用 `KLLedger.buildReconciledLedger` 計算持倉並鎖定 `kline:watch:hold` 唯讀。
  - 快取鍵改為 `` `${twIso()}|${rawPf}|${rawRecon}` ``（修改交易或更新對帳快照／標記狀態皆立即失效重算）。
  - 監聽 `window.addEventListener("storage", ...)`，於 `kline:pf:v1` 或 `kline:pf:recon:v1` 在其他分頁變動時即時重算並重畫畫面。
- **`holdSrcBar()` 文案規則**：
  - 有交易時保留既有用詞相容既有測試正則 `持股來自交易紀錄（N 筆交易...）`（附加 `・M 檔快照基準` 與有衝突時的 `⚠︎ 待對帳（X 檔）` 按鈕）。
  - 只有快照、尚無交易時顯示：`持股來自交易帳本（M 檔期初快照）`。
  - 保留 `[data-hsrc="legacy"]`「改看舊庫存」與 `[data-hsrc="ledger"]`「改看交易帳本／交易紀錄」雙向切換。
- **全站 8 頁一致顯示「⚠︎ 待對帳（差異 N 股）」**：
  | 頁面／區塊 | 待對帳時顯示內容 | 期初／衝突計算備註 |
  |---|---|---|
  | **1. 總覽**（`pf-home.js`） | 頂部／風險狀態列出 `⚠︎ 待對帳（<標的> 差異 N 股）`（可點擊跳往交易紀錄處理） | 以最新已確認快照顯示資產、報酬與前五大 |
  | **2. 持股（損益／屬性分析）**（`watch.html`） | `holdSrcBar()`＋個股列警示 `⚠︎ 待對帳（差異 N 股）`＋`holdDataCheck()` 提示 | 股數與均價暫用最新已確認快照（鎖 `kline:watch:hold`） |
  | **3. 交易紀錄**（`ledger-ui.js`） | 頂部待對帳專用卡片（列出所有 open `conflicts`、雙邊比對數字、T+2 提示、解決操作＋歷史/稽核抽屜），持倉列同步標示 | `preSnapshot` 交易標示「快照前歷史」；`transfer_in` 顯示「標為期初快照／撤回」 |
  | **4. 績效**（`ledger-ui.js`＋`perf.js`） | 狀態列／卡片標章與原因：`⚠︎ 待對帳（差異 N 股）`、`recon_pending`、`snapshot_baseline` | 從快照日起算，不動現金、不回推快照前 |
  | **5. 配置與再平衡**（`ledger-ui.js`＋`pf-rebal.js`） | 頁面頂部＋再平衡卡片內顯示 `⚠︎ 待對帳（差異 N 股）` | 若有快照基準或待對帳部位，明確標示「**用已確認快照的股數試算**」 |
  | **6. 壓力測試**（`pf-stress.js`） | 壓力情境卡片頂部／試算說明顯示 `⚠︎ 待對帳（差異 N 股）` | 明確標示「**用已確認快照的股數試算**」 |
  | **7. 股利**（`pf-divcal.js`） | 股利卡片頂部警示 `⚠︎ 待對帳（差異 N 股）` | 依已確認快照股數估算未來 12 個月股利 |
  | **8. 報告與論點**（`pf-report.js`／`pf-thesis.js`） | 報告頂部提醒＋明細列標 `⚠︎ 待對帳（差異 N 股）`（含列印報表）；論點頂部警示＋個股卡片標註 | 報告與論點停損/停利皆共用統一計算結果 |

---

## 必測情境與驗收標準（18 項）

| # | 測試情境（全部用固定假資料／Mock `/api/import`） | 預期結果 |
|---|---|---|
| 1 | 首次匯入庫存截圖 | 建立 `confirmed` 庫存基準與基準日；帳本顯示該持股，不改 `kline:watch:hold` |
| 2 | 補傳歷史交易（早於快照日） | 寫入 `kline:pf:v1` 並標記 `preSnapshot: true`；**不重複增加已確認持股** |
| 3 | 補傳最新買進（晚於快照日） | 正確增加持股、調整成本（AVG 或快照後 FIFO），並以已確認快照後之買進估算／記入 |
| 4 | 補傳最新賣出（晚於快照日） | 正確減少持股，已實現損益正確以快照均價計算 |
| 5 | 同張圖片／同批成交重複上傳（含原圖指紋＋跨批／同批） | **同批同價分批兩筆不會誤報重複**；跨批同簽章進 Level 2；未結案同原圖 SHA-256 顯示非阻斷提醒 |
| 6 | 庫存快照與交易明細計算數量不同 | 保留兩邊與差異 N 股，顯示 T+2 交割提示，未確認前暫用已確認快照並於全站 8 頁標示 `⚠︎ 待對帳（差異 N 股）` |
| 7 | 截圖日期缺失或格式歧義 | `asOfStatus: "missing"`／`mdy` 進 Level 2 要求確認，不擅自以今天建立基準或定案入帳 |
| 8 | 多股票混合截圖 | 逐檔獨立辨識與對帳；各檔按自身快照或明細各自判定 Level 1/2/3 |
| 9 | 部分交易辨識失敗（Level 3） | 問題列暫停入帳，同批其餘有效列照常匯入不受阻 |
| 10 | 同日交易與快照基準同日 | 進入 Level 2 請使用者確認發生在快照前（僅存歷史）或快照後（須加減持股），不擅自假設先後 |
| 11 | 完整匯入／對帳歷程可追溯 | `imports[]` 與 `audit[]` 保留來源、原圖雜湊、AI 結果、對帳結論與確認動作，可在頁面檢視並修正 |
| 12 | 舊的 `transfer_in` 加上新快照 | 舊 `transfer_in` 未手動標記前維持一般交易參與推算，與新快照一致時自動升級／不一致進 `recon_diff` |
| 13 | 同一檔先後有兩張快照（`S1` → `S2`） | `S1`＋中間確認交易與 `S2` 股數／成本在容差內 → `S2` 自動晉升、`S1` 設 `superseded`；不符 → 留 `S1` 標 `⚠︎ 待對帳` |
| 14 | 快照後全部賣光再買回 | 中間賣光歸零、`costBasis = 0`、`lots = []`；後續重買由 0 起算（含兩張快照跨過歸零重買情境） |
| 15 | 截圖裡含融資／融券部位 | `/api/import` 輸出 `marginType`；前端隔離並預設不入現股快照，顯示引導前往「配置與風險 → 融資」 |
| 16 | 帳本完全空白（無 `pf:v1` 或 `transactions: []`）、只匯入庫存快照 | `holdSrcApply`、`renderLedger`、`perf`、`pf-home`、`pf-report`、`alloc`、`div`、`thesis` 全正常顯示，不退回空白介紹頁 |
| 17 | `transfer_in` 手動「標為期初快照 → 撤回 → 再標記」 | 標記時不疊加該筆 `transfer_in` 與不動 `kline:pf:v1`；撤回恢復一般計算；再標記回到快照模式並完整留稽核 |
| 18 | `kline:pf:recon:v1` 改變時即時重算（含跨分頁 `storage` 事件）＋備份鍵序驗證＋`perf` 快照起點／無圖片／120KB 裁剪／靜態防繞過 | 寫入或跨分頁變更立即更新 `W.hold`；備份含隨機鍵序 `recon` 缺檢查模組必拒；`perf` 不改現金不回推；全專案除 `ledger.js` 無直接 `.buildLedger(` 呼叫 |

- **共用檔案與跨裝置驗證（`AGENTS.md` 必檢）**：
  - 本項目改動共用檔案 `learner/watch.html`、`learner/ledger-ui.js`（以及 `learner/ledger.js`、`learner/recon.js`、`learner/perf.js`、`learner/tools.js`、`learner/pf-*.js`），實作時必跑 `tests/e2e/pf-mobile.test.mjs`、`tests/e2e/pf-tablet-kbd.test.mjs`、`node tests/unit.test.mjs` 與新／改寫之 E2E 與單元測試，並以同一 head SHA 的 CI `test` 全過為合併門檻；UI 部分另須於 390px 手機與 1280px 桌面完成操作與截圖留證。

---

## 實作分批

- **Batch 1（本批次，僅設計文件＋鎖定 Draft PR）**：
  - 開設分支 `gemini/portfolio-auto-reconcile`，先建鎖定 Draft PR「`鎖：watch.html＋ledger.js＋ledger-ui.js 庫存對帳`」（`Part of #308`）。
  - 僅提交本規格與實作計畫 `docs/superpowers/plans/2026-11-16-portfolio-auto-reconcile.md`，請 Claude Code（或 ChatGPT）完成規格與計畫獨立審查。**不改動任何 `.js`／`.html`／`.mjs` 程式碼。**
- **Batch 2（規格審查通過後才施作程式與測試）**：
  - 按核可後之實作計畫逐任務（TDD 先寫失敗測試 → 最小實作 → 通過）完成後端 `/api/import`、新模組 `learner/recon.js`、`ledger.js`、`perf.js`、`watch.html`、`tools.js`、`ledger-ui.js`、8 個 `pf-*.js`/`overview.js` 頁面、相關單元／E2E 測試、`docs/portfolio/*.md` 更新與版本升級（`bump-version.mjs`），跑完本機受影響測試並做 390/1280 截圖檢視後集中推送一次，待同一 head SHA CI `test` 全過轉 Ready 請獨立審查。
- **Batch 3（依獨立審查意見一次修正）**：
  - 整批處理 P0–P3 審查意見並集中推送一次，通過後才回報使用者，等候使用者明確授權合併。

---

## 影響的檔案

- **後端 AI 解析**：`api/_lib/import.js`
- **前端與計算核心**：`learner/recon.js`（新增）、`learner/ledger.js`、`learner/perf.js`、`learner/overview.js`、`learner/tools.js`、`learner/ledger-ui.js`、`learner/watch.html`、`learner/pf-home.js`、`learner/pf-rebal.js`、`learner/pf-stress.js`、`learner/pf-divcal.js`、`learner/pf-report.js`、`learner/pf-thesis.js`
- **測試**：`tests/run.mjs`、新增 `tests/recon.test.mjs`、更新 `tests/ledger-import.test.mjs`／`tests/ledger.test.mjs`／`tests/perf.test.mjs`、新增 `tests/e2e/portfolio-reconcile.test.mjs`、更新 `tests/e2e/ledger-import.test.mjs` 與 `tests/e2e/hold-source.test.mjs`／`tests/e2e/backup-pf.test.mjs`（必要補充驗證）
- **文件與版本（Batch 2 結束前）**：`docs/portfolio/*.md`、`learner/index.html`、`learner/watch.html`、`learner/version.json`、`learner/README.md`（由 `scripts/bump-version.mjs` 產生）

---

## 留給實作者補齊的細節

1. `learner/recon.js` 的公開常數與內部 helper 命名（全域命名空間固定為 `window.KLRecon` 並以 IIFE＋`Object.freeze` 匯出，與 `KLLedger`／`KLPerf`／`KLMargin` 風格一致）。
2. 自動對帳容差預設參數的細部抽取（如 `QTY_ABS_TOL = 1e-4`, `QTY_REL_TOL = 1e-6`, `COST_ABS_TOL = 0.5`, `COST_REL_TOL = 0.005`）與 UI 提示文案精準用字。
3. 待對帳衝突展開抽屜／卡片內部的 DOM 結構與無障礙 `aria-*` 屬性（延續現有 `.pfcard`、`.lgbar`、`.lgwarn`、`.seg` 與手機 44px 觸控目標規範，不先套用項目二的無框調整）。
4. `api/_lib/import.js` 的 `AUTO_PROMPT` 中文範例與欄位說明設計。
