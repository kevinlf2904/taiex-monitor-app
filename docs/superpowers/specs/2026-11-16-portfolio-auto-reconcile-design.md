# 庫存功能整合項目一：入口收斂與自動對帳（設計規格）

日期：2026-11-16　實作者：Gemini Antigravity　獨立審查：Claude Code（若額度不足改由 ChatGPT）
狀態：Batch 1 設計規格第四輪待審（已納入第三輪複審 P1–P3）　關聯：Part of #308（依 Issue #308 留言 `6912636743` 定案）

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
- 在 `kline:pf:recon:v1` 內儲存任何圖片資料（base64／`data:image/`），或讓核心資料超過 120KB（觸及 150KB 雲端同步上限）時還靜默覆蓋寫入。
- 跨 `kline:pf:v1` 與 `kline:pf:recon:v1` 雙鍵寫入中途失敗後留下無法恢復或重開頁面會重複入帳的半套狀態；亦不得忽略 `store.set` 回傳 `false`。
- 未經使用者確認為「完整庫存清單」就把未出現在截圖裡的舊持股當成已清倉歸零；或對已確認的完整快照遺漏關閉已出清的舊基準。
- 對缺年份（`asOfStatus: "year"`）或未來日期（`> today`）未經確認就直接建立 `confirmed` 庫存基準。
- 讓同一 `symbol` 在快照或交易之間繞過現有帳本的單一 `market`／`currency` 約束。
- 因補傳早於快照日的歷史交易，就重複增加已確認快照的目前持股；或單憑不完整前期交易擅自推翻、覆蓋較新庫存快照。
- 快照缺少均價時補成 `0` 或直接確立為正式基準。
- 對美股部位或無法判斷市場的差異套用「近 2 個交易日（台股 T+2）」誤導提示。
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
      market: "tw",              // "tw" | "us"，且必須滿足 market/currency 一對一與跨檔單一市場約束
      currency: "TWD",           // "TWD" | "USD"
      date: "2026-11-10",        // YYYY-MM-DD 快照基準日（confirmed 不可 > today）
      shares: 1000,              // > 0；僅 origin === "full_snapshot_close" 時可為 0
      avgCost: 900,              // > 0（confirmed 非零快照必填）；origin === "full_snapshot_close" 時為 null
      status: "confirmed",       // "confirmed" | "pending" | "superseded"
      scope: "partial",          // "full" | "partial"（來源批次之完整／部分庫存確認；決不自動預設成 "full"）
      supersededBy: null,        // 被哪一張較新快照取代（或被哪一筆 full_snapshot_close 關閉）
      origin: "import",          // "import" | "tx_tag" | "full_snapshot_close"
      tagTxId: null,             // origin === "tx_tag" 時對應的交易 id
      sourceBatchId: "imp-...",
      confirmedAt: "2026-11-16T00:00:00.000Z",
      reason: "",                // 例如強制採信原因、年份確認紀錄或自動晉升說明
      note: ""
    }
  ],
  conflicts: [
    {
      id: "conf-...",
      kind: "recon_diff",        // "recon_diff" | "missing_cost" | "missing_date" | "ambiguous_date"
                                 // | "same_day_order" | "possible_duplicate" | "negative_position"
                                 // | "unknown_symbol" | "unknown_side" | "margin_separated" | "currency_conflict"
      level: 2,                  // 2 | 3
      status: "open",            // "open" | "resolved"
      symbol: "2330",
      market: "tw",
      currency: "TWD",
      date: "2026-11-12",        // 可能為 null（例如 missing_date）
      baselineSnapshotId: "snap-...",
      baselineShares: 1000,      // S1＋已確認交易推算或現有基準股數
      baselineAvgCost: 900,
      targetShares: 1200,        // 新匯入截圖或推算目標股數（full_snapshot_close 差異時為 0）
      targetAvgCost: 920,
      diffShares: 200,           // targetShares - baselineShares
      payload: {},               // 原始待確認列、年份原始字樣或 reason: "missing_in_full_snapshot"（不可含圖片字串）
      resolution: null,          // "keep_both" | "accept_new" | "keep_baseline" | "mark_before_snapshot" | "mark_after_snapshot" | "confirmed_unique" | "discarded"
      resolutionReason: null,
      resolvedAt: null,
      batchId: "imp-..."
    }
  ],
  initialTags: {
    // txHash：標記當下該筆 transfer_in 的 txFingerprint；交易被刪除或被（含舊版分頁）改成其他內容時，此標籤視為失效（見「孤兒／失效標籤容錯」）
    "<txId>": { snapshotId: "snap-...", taggedAt: "ISO", active: true, txHash: "fp1:..." }
  },
  sameDayRelations: {
    // 將同日交易定序留在 kline:pf:recon:v1，解開 same_day_order 時不必跨寫 kline:pf:v1
    // 只在 snapshotId === 目前基準 B.id、snapshotDate === B.date 且該交易 t.date === B.date 時生效，否則視為 unresolved
    "<txId>": { relation: "before_snapshot", snapshotId: "snap-...", snapshotDate: "2026-11-10", conflictId: "conf-...", decidedAt: "ISO" }
  },
  pendingCommit: null,           // 跨鍵寫入進行中 Write-Ahead Journal：{ id, op: "import_trades"|"deactivate_tags"|"update_tx_tag", at, staged?, ...（各 op 專屬欄位：txs+txHashes+pfBaseHash+pfNextHash / deletedTxIds+prevTxs+prevTxHashes+TagStates / txId+mode+prevTx+prevTxHash+nextTxHash+TagStates）}
  imports: [
    {
      id: "imp-...",
      at: "ISO",
      kind: "holdings",          // "holdings" | "trades" | "unknown"
      snapshotScope: "partial",  // holdings 匯入時記錄 "full" | "partial"，trades 為 null
      asOf: "2026-11-10",        // YYYY-MM-DD | null
      asOfStatus: "exact",       // "exact" | "year" | "mdy" | "future" | "invalid" | "missing" | null
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

### 容量控管與 150KB 雲端同步限制（含失敗契約）

`tools.js` 的 `syncSnap(false)` 會略過序列化長度 `>= 150000` 字元的單鍵。因此 `learner/recon.js` 必須提供 `KLRecon.pruneStore(s, maxBytes = 120000)`，並遵守以下明確契約：
1. **絕對禁存圖片、市場與 WAL 結構驗證**：`KLRecon.validateStore(s, opts = {})` 除結構檢查外，強制檢查：
   - 任何巢狀字串不得命中 `/data:image\//i` 或超過 2000 字元疑似 base64 影像編碼字串（否則回 `{ ok: false, code: "image_not_allowed" }`）；
   - 快照與衝突之 `(symbol, market, currency)` 必須合法配對（`tw/TWD`、`us/USD`），且同一個 `symbol` 在所有快照間不得出現不同 `market/currency`（否則回 `{ ok: false, code: "currency_conflict" | "currency_mismatch" }`）；
   - `confirmed` 快照不得存在 `date > opts.today`（否則 `{ ok: false, code: "future_snapshot_date" }`）；非 `full_snapshot_close` 之 `confirmed` 快照必備 `shares > 0` 且 `avgCost > 0`；
   - 未傳 `opts.rejectPendingCommit` 的一般載入檢查允許非空 `pendingCommit`（含未知 `op` 字串）保留供 `recoverCommit` 檢核，決不因未知 `op` 將整份對帳資料誤判無效而棄置；傳入 `{ rejectPendingCommit: true }`（備份匯入檢核）時，只要 `pendingCommit != null` 一律回 `{ ok: false, code: "unrecovered_pending_commit" }`。
2. **保留優先序（裁剪僅動歷史、不動目前權益與未決問題）**：
   - **永不裁剪**：所有 `status === "confirmed"` 與 `status === "pending"` 的 `snapshots`、所有 `status === "open"` 的 `conflicts`、所有啟用中的 `initialTags`、`sameDayRelations`、正在進行尚未結案的 `pendingCommit`、以及與任何 `open` 衝突關聯（同 `batchId`）的 `imports[]`。
   - **優先裁剪（只留最近滾動視窗；手動或一般流程不得刪改既有紀錄，僅在超出 120KB 容量管理時由最舊起淘汰）**：依時間由舊到新裁剪已結案的 `imports[]`（預設保留最近 40 筆已結案記錄）、已結案的 `audit[]`（預設保留最近 160 筆滾動視窗）、已結案的 `conflicts[]`（保留最近 60 筆）及早於保留門檻的 `superseded` 舊快照（每檔保留最新 3 筆歷史快照）；若仍超過 `maxBytes`（預設 120KB）才繼續縮減已結案歷史至歸零。
3. **不可裁剪核心超限時的明確失敗契約**：
   - `pruneStore(s, maxBytes)` 固定回傳結構化結果：`{ ok: true, store, bytes, maxBytes, trimmed }`；若將所有可裁剪歷史清除後 `JSON.stringify(store).length` **仍大於 `maxBytes`**，不得靜默放行，必須回傳 **`{ ok: false, code: "core_data_exceeds_limit", bytes, maxBytes, store: null }`**。
   - **寫入前阻擋**：`lgReconSave(nextRecon, opts = {})` 與雙鍵交易協議在寫盤前一律先檢查既有 `pendingCommit` 未阻斷、再驗證 `pruneStore().ok` 與 `store.set()` 回傳值；一旦回傳 `{ ok: false, code: "core_data_exceeds_limit" }`、`unrecovered_pending_commit` 或 `store.set === false`（`storage_write_failed`），**立即拒絕覆寫現有 `localStorage["kline:pf:recon:v1"]`**，保留原本資料，並提示使用者「對帳核心資料過大、存在未恢復提交或空間不足，未寫入；請先結案待對帳項目或到『工具 → 備份同步』匯出 JSON 備份後再試」。

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

- `KLLedger.validateStore(s, opts = {})` 支援 `opts.recon`：傳入 `opts.recon` 時改呼叫 `buildReconciledLedger(s, opts.recon, { ...opts, method: s.method })`，確保匯入或儲存「先有快照、後有賣出」的帳本不會被誤判成賣超，並驗證**交易與確認快照之間同 `symbol` 的 `market`／`currency` 一致**（衝突即拒絕）。
- `KLLedger.checkBackup(data, opts = {})` **鍵序無關但驗證有嚴格先後**：
  1. JSON 物件鍵順序不能依賴，實作時**先檢查 `data` 是否含 `"kline:pf:recon:v1"`**。
  2. 若存在 `"kline:pf:recon:v1"`：先解析 JSON，**必須傳入 `opts.recon && typeof opts.recon.validateStore === "function"`**；缺 `opts.recon` 或無 `validateStore` 時**直接整份拒絕（`ok: false`、「沒有對帳快照的檢查程式，為了安全不匯入」）**，決不降級。若備份內的 `pendingCommit != null` 屬未恢復狀態亦拒絕匯入（避免把中斷殘留寫入另一台裝置）；通過 `opts.recon.validateStore(parsed, { today: opts.today, rejectPendingCommit: true })` 後保存驗證過的 `reconObj`。
  3. 再以 `validateStore(pfV1, { today: opts.today, recon: reconObj })` 驗證 `"kline:pf:v1"`。
  4. 所有其他鍵（`kline:pf:margin:v1`、`kline:pf:targets:v1`、`kline:pf:thesis:v1`）沿用既有嚴格模組檢查。
- `learner/watch.html`：`LAZY.ledger` 改為 `["ledger.js", "recon.js", "ledger-ui.js"]`。
- `learner/tools.js`：`syncImport` 於有 `pfKeys` 時除了 `await lazy("ledger")`，另外保護檢查若 `pfKeys.includes("kline:pf:recon:v1") && typeof KLRecon === "undefined"` 則明確動態載入 `recon.js`（失敗即整份拒絕不匯入），並將 `recon: typeof KLRecon !== "undefined" ? KLRecon : null` 傳入 `KLLedger.checkBackup`；匯入確認文字亦帶出快照與待確認筆數，150KB 超限提示涵蓋所有超限 `kline:pf:*` 鍵。
- **備份含未完成提交（`pendingCommit != null`）的明確出口**：`checkBackup` 仍預設拒絕（`unrecovered_pending_commit`）。若這是**唯一**問題，`syncImport` 不直接失敗，而是跳出第一次確認「這份備份含一筆未完成的對帳提交（類型 X、時間 Y）。可以剔除這筆未完成提交後匯入：以備份中的交易紀錄為準，對不上的期初標記會停用並記錄稽核。要繼續嗎？」→ 同意後在記憶體對備份資料呼叫 `KLRecon.resolveHalted(pf, recon, "discard_wal", { source: "backup_import" })`（只動備份副本，不動本機），再以 `rejectPendingCommit: true` 重跑 `checkBackup`；通過後顯示原有的第二次覆蓋確認。任一步失敗整份不匯入，本機資料維持原樣。

#### 2-1. 雲端同步：兩鍵視為同一同步單位（`learner/tools.js:744–783`）

- **上傳快照（`syncSnap(false)`）**：`kline:pf:v1` 與 `kline:pf:recon:v1` 視為一組（`PF_PAIR`）：兩者都 `< 150000` 字元、`recon` 可解析且 `pendingCommit == null` 時才一起放入；任一條件不成立則**兩鍵都不放**（絕不只帶其中一鍵）。`syncBigPf()` 在任一鍵超限時把兩鍵一起列出，提示文案改為「交易紀錄與對帳資料要一起同步，其中一項超過 150KB，雲端同步不會帶到…請用備份檔保存」。`syncSnap(true)`（匯出備份）照舊帶完整兩鍵。
- **暫停上傳**：本機 `recon.pendingCommit != null`（含 halted）時，`syncPush` 與每分鐘自動上傳直接跳過，`W.syncErr = "對帳資料有未完成的提交，暫停上傳；處理完會自動恢復"`，避免把中斷殘留傳到其他裝置。
- **本機未完成提交時暫停下載（`syncPull`／`syncBoot`）**：若本機 `kline:pf:recon:v1` 的 `pendingCommit != null`（含 halted）且雲端資料含有 `PF_PAIR` 任一鍵（`kline:pf:v1` 或 `kline:pf:recon:v1`），**強制暫停下載套用 `PF_PAIR`**（絕不讓雲端正常快照蓋掉本機 WAL 內尚未入帳的 `txs`），設定 `W.syncErr = "本機有尚未完成或受阻的對帳提交，已暫停雲端對帳下載；請先處理卡住的操作"` 並保留本機原樣。
- **下載套用前檢查（`syncPull`／`syncBoot` → `syncApply` 之前）**：若雲端資料含 `PF_PAIR` 任一鍵且本機無未決 `pendingCommit`，先載入 `ledger.js`＋`recon.js`（失敗即不套用），以「雲端有的鍵＋本機對應另一鍵」組成待檢資料，呼叫 `KLLedger.checkBackup(pair, { today, recon: KLRecon })`（含 `rejectPendingCommit: true`）。另外若雲端只帶 `kline:pf:v1`（舊版裝置上傳）而本機 `recon` 有啟用 `initialTags` 或 `confirmed` 快照，仍須通過上述交叉檢查（標籤 `txHash` 對不上即視為失敗）。檢查失敗則**整份不套用**，`W.syncErr` 說明原因並保留本機原樣；實際寫入兩鍵時亦須經 `withPfCommitLock`（若可用）與 CAS 保護。
- 伺服器端 `api/sync` 不改。

### 3. 跨兩個 `localStorage` key 的可恢復寫入協議（Write-Ahead Commit Protocol）

任何同時異動 `kline:pf:v1` 與 `kline:pf:recon:v1` 的操作（包含 `kind === "trades"` 匯入、刪除帶有啟用 `initialTags` 的 `transfer_in`、或修改已標記期初交易），**嚴禁**依序直接呼叫兩次寫入，必須統一經 `lgCommitDualStores`（搭配 `KLRecon` 純函式 `prepareCommit`／`finalizeCommit`／`recoverCommit`）執行三階段協議；另將同日交易定序（`sameDayRelations`）只存於 `kline:pf:recon:v1`，讓解開 `same_day_order` 成為單鍵寫入：

1. **Pre-flight 檢查（動任何存檔之前，必須在取得提交鎖之後才讀取／計算或驗證 base）**：
   - 依預期結果驗證 `nextPf`（`KLLedger.validateStore(nextPf, { today, recon })`）與最終 `finalRecon`（`KLRecon.validateStore` ＋ `KLRecon.pruneStore(..., MAX_BYTES)`）。任一步回報錯誤或 `core_data_exceeds_limit` 立刻終止，不寫任何鍵。
   - **修正 `lgSave` 與 `lgReconSave` 靜默失敗問題**：必須檢查 `store.set(...)` 布林回傳值，回傳 `false`（如 QuotaExceededError）一律視為寫入失敗（`{ ok: false, code: "storage_write_failed" }`）。
2. **三階段可恢復寫入（以 WAL `pendingCommit` 存於 `kline:pf:recon:v1`，只含該批異動交易本身、交易指紋與待提交對帳紀錄，不複製整份 `pf:v1`；`pendingCommit` 不可裁剪，若加上它超過 120KB，Phase 1 即以 `core_data_exceeds_limit` 失敗、兩鍵不動）**：
   - **交易版本指紋（`KLRecon.txFingerprint(tx)`，演算法固定為 `fp1`）**：
     - 正規化 `canon(v)`：`null`／純值用 `JSON.stringify`；陣列保留順序、`undefined` 元素輸出 `null`；物件省略值為 `undefined` 的鍵、其餘鍵以 JS 預設字串排序（`Object.keys(v).sort()`）後輸出 `{"k":canon(v)}`。因此記憶體物件與 `JSON.parse(JSON.stringify(tx))` 得到相同字串。
     - 雜湊：對 `canon(tx)` 的 UTF-16 code unit 跑 **cyrb128**（四個 32-bit 狀態，初值 `1779033703, 3144134277, 1013904242, 2773480762`，乘數 `597399067, 2869860233, 951274213, 2716044179`，結尾混合後各轉 8 碼小寫十六進位），輸出 `` `fp1:${32 碼 hex}:${canon 字串長度}` ``。這不是密碼學雜湊，只用來偵測同一裝置上的版本變動；`fp1` 前綴保留未來換演算法的空間（`recoverCommit` 遇到不認得的前綴一律 Fail-Closed）。
     - **固定測試向量**（`tests/recon.test.mjs` 必須逐字比對）：
       - `A = { id: "t1", date: "2026-11-10", type: "transfer_in", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 900, fee: 0, tax: 0, note: "" }` → `fp1:2f0a9972b064eb73ae07271267fa7c14:151`
       - 同 `A` 但鍵序全部倒過來並多一個 `extra: undefined` → 同上 `fp1:2f0a9972b064eb73ae07271267fa7c14:151`
       - `A` 改 `price: 901` → `fp1:95800b8f131f02d1377fefe8bcfd5446:151`
       - `{ id: "t2", date: "2026-11-12", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 1.5, price: 180.25, fee: 1, tax: 0, note: "分批 #1" }` → `fp1:817f348042cc7d1b6fccf93dc8cf279b:150`
       - `{}` → `fp1:58e46dc64f30ae7ba2ecdf40d8e8a490:2`
     - 同一演算法另用於 `pfStoreHash(pf) = txFingerprint({ v: pf.v, method: pf.method, transactions: pf.transactions })`（整份交易紀錄指紋）。
   - **三種合法操作之 WAL Payload 定義**：
     - `op: "import_trades"`：`{ id: batchId, op: "import_trades", at, txs: Tx[], txHashes: { [txId]: string }, pfBaseHash: string, pfNextHash: string, staged: { imports?, conflicts?, audit? } }`。`txs` 為這批要新增的完整交易（`txIds` 由 `txs.map(t => t.id)` 推得），`pfBaseHash`／`pfNextHash` 為寫入前後整份 `pf:v1` 的 `pfStoreHash`。
     - `op: "deactivate_tags"`（刪除帶有啟用 `initialTags` 之 `transfer_in`）：`{ id: batchId, op: "deactivate_tags", at, deletedTxIds: string[], prevTxs: { [txId]: Tx }, prevTxHashes: { [txId]: string }, prevTagStates: { [txId]: TagSnapshotState }, targetTagStates: { [txId]: TagSnapshotState }, staged: { audit: AuditItem[] } }`，其中 `TagSnapshotState` 為 `{ active: boolean, snapshotId: string, snapshotStatus: "confirmed"|"pending"|"superseded", snapshotDate: string, snapshotShares: number, snapshotAvgCost: number|null, supersededBy: string|null }`。`prevTxs` 只供受阻時「還原到提交前」使用。
     - `op: "update_tx_tag"`（修改帶有啟用 `initialTags` 之 `transfer_in`，例如改股數／單價／日期，或改類型為 `buy`／`price <= 0`／改代號使期初標籤停用；交易無任何欄位變動即 `prevTxHash === nextTxHash` 時不寫入 WAL）：`{ id: batchId, op: "update_tx_tag", at, txId: string, mode: "update"|"deactivate", prevTx: Tx, prevTxHash: string, nextTxHash: string, prevTagState: TagSnapshotState, targetTagState: TagSnapshotState, staged: { conflicts?: ConflictItem[], audit: AuditItem[] } }`（既有的 `tag.snapshotId` 快照依 `targetTagState` 就地更新，`initialTags[txId].txHash` 同步改為 `nextTxHash`；`mode === "deactivate"` 設為 `superseded` 時保留原正數 `avgCost`/`shares` 供歷史稽核，決不寫入 `0` 或破壞 `validateStore`）。所有 `staged` 紀錄皆具確定性 `id`，供冪等合併去重。
   - **Phase 1（寫 WAL Journal）**：呼叫 `KLRecon.prepareCommit(recon0, payload)` 確認結構、必要欄位與目前無未決 `pendingCommit` 後，經 `pruneStore` 與 `store.set("pf:recon:v1", prepared)` 寫入 `kline:pf:recon:v1`。失敗、超限或 `store.set === false` → 立刻中止，兩鍵皆維持原樣。
   - **Phase 2（寫 `kline:pf:v1`）**：將 `nextPf` 寫入 `kline:pf:v1`。若 `store.set("pf:v1", nextPf)` 失敗（回傳 `false` 或拋錯），先以 CAS 確認 `kline:pf:recon:v1` 仍為剛寫入的 `prepared` 原字串後才復原為 `recon0` 並清楚報錯；即使復原寫入也失敗（`store.set` 再回 `false`），`pf:v1` 仍為舊狀態（含 `prevTxHash` 或未含新 `txIds`），重開頁面時可由 `recoverCommit` 安全 Clean Abort。
   - **Phase 3（Commit 結案 `kline:pf:recon:v1`）**：呼叫 `KLRecon.finalizeCommit(reconPrepared, batchId)` 套用目標標籤／快照狀態、依 `id` 去重合併 `staged` 並清除 `pendingCommit: null`，經 `pruneStore` 與 `store.set("pf:recon:v1", finalized)` 寫盤。若此階段 `store.set` 回傳 `false` 或失敗，先以 CAS 確認 `kline:pf:v1` 仍等於 `nextPf` 才復原為 `pf0`；唯有 `pf:v1` 復原成功且 `pf:recon:v1` 仍為 `prepared` 時才可接續將 `kline:pf:recon:v1` 復原為 `recon0`（若 `pf:v1` 已有外界變動、復原失敗或分頁直接關閉／崩潰，則刻意保留 `pendingCommit` 不清，待第 3 點 `recoverCommit` 檢核後決定 Roll-Forward、Clean Abort 或進入 `inconsistent_halted`）。
3. **啟動／讀取時冪等自動恢復與 Fail-Closed 保護（`KLRecon.recoverCommit(pfStore, reconStore)`）**：
   - **`recoverCommit` 是純函式、沒有副作用**（只回傳新物件，不讀寫 `localStorage`）。實際寫回一律由 `lgRecoverPersist()` 在第 4 點的提交鎖內執行：取得鎖 → 重新讀取 `rawPf = localStorage.getItem("kline:pf:v1")` 與 `rawRecon = localStorage.getItem("kline:pf:recon:v1")` → 對新讀到的資料再跑一次 `recoverCommit` → 寫入前比對原始字串未變（CAS）→ 才寫回。
   - `lgReconLoad()`、`holdSrcApply()` 與 `renderLedger()` 遇到 `reconStore?.pendingCommit` 時：先用 `recoverCommit` 的結果在記憶體計算畫面（不寫入），再非同步排程 `lgRecoverPersist()`；**`storage` 事件處理只重算畫面，不直接寫入**（見「多分頁」）。
     - **未知或結構不合法的 `op`（Fail-Closed）**：若 `pendingCommit` 不是合法物件，或 `pendingCommit.op` 不在 `"import_trades" | "deactivate_tags" | "update_tx_tag"` 白名單，或缺少該 `op` 必要欄位（含 `update_tx_tag` 缺 `txId`/`mode`/`prevTx`/`prevTxHash`/`nextTxHash`/合法 `TagSnapshotState` 或 `prevTxHash === nextTxHash`；`import_trades` 缺 `txs`/`txHashes`/`pfBaseHash`/`pfNextHash`；任何指紋不是 `fp1:` 前綴）：**一律拒絕自動恢復並完整保留 `pendingCommit` 原樣，絕不靜默清除 `pendingCommit: null`**，回傳 `{ changed: false, status: "unknown_op_halted" | "inconsistent_halted", code, op, reconStore }`。
     - **若為 `op === "import_trades"`**（`pf:v1` 是單次 `setItem` 整份寫入且 pending WAL 期間新寫入已阻擋，任何整份雜湊異動代表外部／舊版寫入，一律從嚴 Fail-Closed）：令 `curHash = pfStoreHash(pfStore)`，逐筆比對 `txs` 的 id 是否存在、存在者 `txFingerprint` 是否等於 `txHashes[id]`：
       - **Roll-Forward（Phase 2→3 中斷）**：全部 id 都存在、每筆指紋都符合 **且** `curHash === pfNextHash` → 依 `id` 去重合併 `staged.imports[]`/`audit[]`/`conflicts[]`，清空 `pendingCommit: null`，**絕不再次把交易寫進 `pf:v1`**。
       - **Clean Abort（Phase 1→2 中斷）**：全部 id 都不存在**且** `curHash === pfBaseHash` → 清空 `pendingCommit: null`。
       - **其他一律 Fail-Closed（`inconsistent_halted`）**：部分存在（`code: "wal_partial_import"`）、任一已存在交易指紋不符（`wal_tx_mismatch`）、全部 id 都在但 `curHash !== pfNextHash`（`wal_pf_hash_mismatch`），或全部不存在但 `curHash !== pfBaseHash`（`wal_external_modification`）→ 完整保留 `pendingCommit`，交由第 5 點手動處理（WAL 內有完整 `txs`，不會遺失待匯入交易）。
     - **若為 `op === "deactivate_tags"`**：同時比對 `pfStore.transactions` 中各 `deletedTxId` 是否存在及其 `txFingerprint`，與 `reconStore.initialTags`/`snapshots` 是否符合 `prevTagStates` 或 `targetTagStates`：
       - **全部 `deletedTxIds` 仍存在且指紋符合 `prevTxHashes`、且 `recon` 符合 `prevTagStates`**（Phase 1→2 中斷）：**Clean Abort** — 清 `pendingCommit: null` 保留原交易與原標籤，不寫 `staged.audit`。
       - **全部 `deletedTxIds` 已不存在於 `pf:v1`、且 `recon` 符合 `prevTagStates` 或 `targetTagStates`**（Phase 2→3 中斷或重複恢復）：**Roll-Forward 冪等補完** — 依 `targetTagStates` 停用對應 `initialTags` 與 `tx_tag` 快照（**絕不破壞更晚之 `B_newer`**）、依 `id` 去重合併 `staged.audit[]`，清 `pendingCommit: null`。
       - **其他任何部分或不一致狀態**（例如部分已刪部分仍在、交易仍存在但指紋已變、交易仍存在但標籤已先停用、或交易已刪但 `recon` 非前後目標態）：**Fail-Closed（`status: "inconsistent_halted"`, `code: "wal_inconsistent_state"`）**，保留 `pendingCommit` 不清除。
     - **若為 `op === "update_tx_tag"`**：**嚴禁只依 `txId` 存在與否判斷**（因修改交易時 `txId` 在 Phase 2 前後皆存在），必須同時檢查 `actualTx = pfStore.transactions.find(t => t.id === pending.txId)` 之 `actualTxHash = actualTx ? txFingerprint(actualTx) : null` 與 `reconStore` 中 `actualTag`／`actualSnap` 狀態（`matchesTagState` 比對 `active`、`snapshotId`、`snapshotStatus`、`snapshotDate`、`snapshotShares`、`snapshotAvgCost`、`supersededBy`）。**判定順序固定如下**（當只改備註等不影響快照欄位時 `prevTagState` 與 `targetTagState` 可能深度相等，此時只依交易指紋區分 Phase 1 與 Phase 2→3，先比對 `actualTxHash === prevTxHash` 再比對 `actualTxHash === nextTxHash`）：
       1. **Phase 1 中斷（Clean Abort）**：`actualTxHash === prevTxHash` 且 `matchesTagState(actualTag, actualSnap, prevTagState)` → 清空 `pendingCommit: null`，保留原交易與原標籤／快照，不寫 `staged.audit`。
       2. **Phase 2→3 中斷（Roll-Forward）**：`actualTxHash === nextTxHash` 且 `matchesTagState(actualTag, actualSnap, prevTagState)` → 冪等套用 `targetTagState`（更新 `tx_tag` 快照日期／股數／均價／狀態與關係、更新 `initialTags[txId].txHash = nextTxHash`，或停用 `initialTags` 與快照為 `superseded`，且絕不覆蓋更晚基準 `B_newer`）、依 `id` 去重合併 `staged.conflicts[]`/`audit[]`，並清空 `pendingCommit: null`。
       3. **Phase 3 殘留／重複呼叫 `recoverCommit`（Roll-Forward 冪等收斂）**：`actualTxHash === nextTxHash` 且 `matchesTagState(actualTag, actualSnap, targetTagState)` → 僅依 `id` 去重補齊遺漏之 `staged.conflicts[]`/`audit[]` 與 `initialTags[txId].txHash`，並清空 `pendingCommit: null`；連續多次執行亦絕不生重複 `audit`。
       4. **部分或不一致狀態（Fail-Closed）**：若 `actualTx == null`（交易遺失）、`actualTxHash` 既非 `prevTxHash` 也非 `nextTxHash`（被外部改為第三版本）、`actualTxHash === prevTxHash` 但 `recon` 非 `prevTagState`（包含在兩狀態不等時呈現 `targetTagState` 或第三狀態）、或 `actualTxHash === nextTxHash` 但 `recon` 既非 `prevTagState` 亦非 `targetTagState` → **一律拒絕恢復並完整保留 `pendingCommit` 原樣（`status: "inconsistent_halted"`, `code: "wal_inconsistent_state"`），嚴禁靜默清除**。
     - **受阻狀態之全站阻擋（Fail-Closed）**：一旦進入 `unknown_op_halted` 或 `inconsistent_halted`，`pendingCommit` 保留原樣，`lgSave`／`lgReconSave`（非復原或手動解除程序）／`lgCommitDualStores` 拒絕新的覆寫入帳（回 `{ ok: false, code: "unrecovered_pending_commit" }`），`checkBackup`（`rejectPendingCommit: true`）與雲端 `PF_PAIR` 上傳／下載皆暫停，且介面頂部顯示修復卡片（見第 5 點）。
4. **多分頁併發鎖內重讀與 stale-base 防護（`withPfCommitLock` ＋ Compare-And-Swap）**：
   - 凡會寫入 `kline:pf:v1` 或 `kline:pf:recon:v1` 的路徑（`lgCommitDualStores`、`lgSave`、`lgReconSave`、`lgRecoverPersist`、手動解除受阻、`syncApply`/`syncImport`）一律包在共用鎖 `withPfCommitLock(fn)` 內。
   - **跨分頁互斥契約**：優先使用 `navigator.locks.request("kline:pf:commit", fn)` 提供真正的跨分頁互斥鎖；若在瀏覽器環境（`typeof window !== "undefined"`）卻缺少 `navigator.locks`（例如極舊瀏覽器或非安全 HTTP 來源），同頁 promise queue **不可提供跨分頁互斥**，因此預設**拒絕寫入（Fail-Closed，`{ ok: false, code: "cross_tab_lock_unavailable" }`）** 並提示使用支援 `Web Locks` 的安全環境（Node 單一進程單元測試環境 `typeof window === "undefined"` 才使用串列 promise queue）。
   - **鎖內重讀／重算與 `stale_write` 拒寫（嚴禁排隊期間過期覆蓋）**：所有寫入函式（`lgCommitDualStores`、`lgSave`、`lgReconSave`、`lgRecoverPersist`）在取得鎖之後才讀取當前兩鍵原始字串 `rawPf`／`rawRecon`：若為單鍵寫入或雙鍵提交且呼叫端傳入計劃（planner）函式，則於鎖內最新狀態上重新計算並驗證；若傳入預先算好的 `nextPf`/`nextRecon`，必須同時比對呼叫前拍攝之 `expectedRawPf`／`expectedRawRecon`（或預設基準字串），只要與鎖內現況不符一律回 **`{ ok: false, code: "stale_write" }` 並中止寫入**（決不把等待鎖期間另一分頁的新寫入蓋回去）。`lgRecoverPersist()` 亦在鎖內重讀、CAS 比對未變後才寫入。
   - **`storage` 事件不寫入**：另一分頁變動 `kline:pf:v1` 或 `kline:pf:recon:v1` 時，本分頁的 `storage` 監聽只用純 `recoverCommit` 在記憶體重算並重畫畫面，**絕不在 `storage` handler 內寫回 `localStorage`**，防止兩分頁互相蓋寫。
5. **受阻狀態的手動處理出口與回退前現況守門（`KLRecon.resolveHalted` ＋ UI 修復卡片）**：
   - 進入 `unknown_op_halted` 或 `inconsistent_halted` 時，交易紀錄頁頂部顯示 `[data-lgrecon-halted]` 卡片，先提示「建議先按這裡匯出備份」（下載含目前兩鍵原樣的 JSON，另附說明：「這份備份保留現場，之後匯入時會詢問剔除未完成提交」），並**並列顯示兩邊現況**：交易紀錄裡的實際內容 vs 對帳紀錄裡卡住的操作（類型、時間、標的、WAL 留存的原本交易／待匯入明細）。
   - 提供兩個需輸入確認字樣或 `confirm` 二次確認的處理按鈕（於 `withPfCommitLock` 內鎖內重讀核對後執行）：
     1. **`[data-lgrecon-halt-action="discard_wal"]`（「以交易紀錄為準，放棄卡住的操作」）**：保留 `kline:pf:v1` 不動，清空 `pendingCommit: null`，對帳紀錄中對應不到的 `initialTags` 改為 `active: false`、`tx_tag` 快照設 `superseded`。若屬於 `op === "import_trades"` 且 `kline:pf:v1` 缺少其中 `missingCount` 筆 WAL `txs`，**明確定義為「保留 `pf:v1` 現況、從對帳提交佇列放棄這 `missingCount` 筆未入帳明細」**，於確認前明確列出未入帳筆數與標的清單提示使用者（已導出 JSON 留存後可重新上傳截圖或手動補記），並將缺失筆數與代號記於 `audit[]`（`action: "halted_resolved_discard_wal"`）。
     2. **`[data-lgrecon-halt-action="revert_pre_commit"]`（「還原到這次修改／匯入之前」）**：須同時通過**前置現況指紋與標籤狀態守門**（否則拒絕回退並保留 WAL）：
        - `unknown_op_halted` 或缺乏完整回退資料 → 不允許選用。
        - `import_trades`：僅可移除目前仍存在於 `pfStore` **且** `txFingerprint(curTx) === wal.txHashes[id]` 的匯入交易；若同 `id` 交易已被外界改動成其他指紋，**拒絕回退（`{ ok: false, code: "revert_conflict_modified" }`）** 並保留 WAL，絕不刪除較新的修改。
        - `update_tx_tag`：目前 `actualTx` 必須存在且 `actualTxHash === wal.nextTxHash || actualTxHash === wal.prevTxHash`，同時現況標籤／快照必須符合 `wal.prevTagState` 或 `wal.targetTagState`；若交易已失蹤或被改成第三版本、或標籤快照已是第三狀態，**一律拒絕回退（`code: "revert_conflict_modified"`）** 並保留 WAL，於畫面並列差異供人工檢視。
        - `deactivate_tags`：逐筆檢查 `deletedTxIds`，每筆必須在 `pfStore` 中「仍不存在」或「存在且 `txFingerprint === prevTxHashes[id]`」，且對帳標籤／快照為 `prevTagStates[id]` 或 `targetTagStates[id]`；若同 `id` 已出現不同指紋的重建／修改交易或標籤進入第三狀態，**拒絕回退（`code: "revert_conflict_modified"`）** 並保留 WAL。
        - 全數通過守門後，移除吻合之 `txs` 或還原 `prevTxs`/`prevTx`，還原 `prevTagState(s)`、清 `pendingCommit: null` 並寫入 `audit[]`（`action: "halted_resolved_revert"`）。
   - 純函式 `KLRecon.resolveHalted(pfStore, reconStore, choice, opts)` 回傳 `{ ok, pfStore, reconStore, pfChanged, code?, error?, summary? }` 供單元測試與備份匯入共用。
6. **舊版（Service Worker 快取分頁）直寫 `kline:pf:v1` 的孤兒／失效標籤容錯**：
   - 若使用者同時開著未更新的舊版分頁並直接編輯或刪除了已標為期初快照的 `transfer_in`，`initialTags[txId]` 會變成找不到交易（孤兒）或交易內容與 `txHash` 不符（失效）。
   - `buildReconciledLedger`（唯讀計算不改寫 `pf:recon:v1`）檢查 `initialTags[txId]` 時，必須同時滿足「該 `txId` 存在於 `pf.transactions` 且仍為 `transfer_in`」與「若標籤有記錄 `txHash`，`txFingerprint(t) === tag.txHash`」才把該筆交易標成 `preSnapshot: true`；否則該筆交易改依一般交易參與計算，並於 `reconcile.staleTags[]`（及畫面非阻斷警示橫幅）列出「原本標為期初快照的紀錄已被修改或刪除，請在對帳中心確認要撤回期初標記還是保留快照」，讓使用者在對帳中心一鍵確認清理，不阻斷全站讀取或靜默錯算。
   - **測試要求**：必須在單元／E2E 測試分別模擬：`import_trades`（全在且 `curHash === pfNextHash`／全部 `txs` 吻合但 `curHash !== pfNextHash` 轉 halted／全不在含 `pfBaseHash` 不符／部分存在）、`update_tx_tag`（含 `prevTagState` 與 `targetTagState` 相等時）、`deactivate_tags`、Phase 1／2／3 中斷、`recoverCommit` 重複執行、`store.set === false`（含復原亦失敗後的重開恢復）、雙分頁（雙 Playwright Context）`withPfCommitLock` stale-base 拒寫（含 `lgCommitDualStores`/`lgSave`/`lgReconSave`）＋ `!navigator.locks` fail-closed ＋ `storage` 不互相覆蓋、雲端同步本機 `pendingCommit != null` 暫停下載與下載檢查失敗拒套、`resolveHalted` 兩個出口及 **`revert_pre_commit` 遇第三版本／重建／部分回復拒回退**＋備份匯入剔除 `pendingCommit`、舊版孤兒／失效標籤容錯與未知 `op` fail-closed 保留 WAL，證明兩鍵最終一致且 `audit[]` 零重複。

---

## 自動對帳引擎核心規則

### 1. 基準快照建立與歷史交易關係（Single Snapshot Baseline）

對每個標的 `symbol`（統一以大寫正規化 `symbol` 為主鍵，且於 `KLRecon.validateStore` 與 `buildReconciledLedger` 雙重強制 `market`／`currency` 一對一配對及跨快照／跨交易零衝突，與 `ledger.js:125` `currency_conflict` 完全一致），取 `reconStore.snapshots` 中 `status === "confirmed"` 且 `date`（同一日則以 `confirmedAt` 較新者）最新的快照為正式基準 `B`：
- **基準進入門檻（均價、年份與未來日保護）**：
  - 任何快照在成為 `status === "confirmed"` 正式基準前：
    1. **缺均價保護**：若 `B.avgCost` 為 `null` 或 `<= 0`（且 `origin !== "full_snapshot_close"`）又無法由 `(shares * price - totalPnl) / shares` 或 `(marketValue - totalPnl) / shares` 得出正數均價，**強制導向 Level 2（`missing_cost`），不得補成 `0` 或升級為 `confirmed`**。
    2. **缺年份與未來日期保護**：庫存截圖必須具備明確年份與日期（`asOfStatus === "exact"` 且 `asOf <= today`，或經使用者明確確認後之日期 `<= today`）。若 `asOfStatus` 為 `"year"`（只讀出 `MM/DD` 缺年份）、`"mdy"`、`"missing"`、`"invalid"` 或 `"future"`（`date > today`），**一律先導向 Level 2（`ambiguous_date`／`missing_date`），嚴禁在未確認年份或未來日前直接建立 `confirmed` 基準**。
    3. **市場／幣別衝突保護**：`market` 與 `currency` 須配對且不得與同 `symbol` 既有快照或交易衝突（衝突列進 Level 3 `currency_conflict` 並阻擋存檔）。
- **錨點初始化與多期快照鏈（`B0 → ... → B`）重放**：
  - 同一標的若有經 `supersededBy` 串接之歷史確認快照鏈 `chain = [B0, ..., B]`（`pruneStore` 永不裁剪該活躍鏈節點）：
    - **鏈只沿 `supersededBy` 往前串**：同代號但未經晉升／採信／結案明確串接、日期較早的 `confirmed` 快照（例如較新基準存在時才標記的期初快照）**不得納入鏈、不得成為 `B0`**，否則會把從未對過帳的前段交易拿來重算，產生賣超等錯誤並讓整份帳本無法存檔。
    - **期初錨點只認鏈上的 `tx_tag` 快照**：只有其 `tx_tag` 快照位於目前基準鏈上的期初轉入才標 `preSnapshot: true`；`initialTags` 仍為 active 但快照不在鏈上（未串接，或修改日期後晚於所串接的基準）的轉入，依日期當一般交易處理（晚於基準日就照常入帳）。`planUpdateTxTag` 在新日期晚於所串接基準日時，目標狀態一律 `supersededBy: null`（解除串接）。
    - 最早確認快照 `B0` 設定績效與歷史起點 `firstDate = B0.date`、`firstSnapshotDate = B0.date`、`firstSnapshotShares = B0.shares`、`firstSnapshotAvgCost = B0.avgCost`、`firstSnapshotOrigin = B0.origin`。
    - 鏈上各錨點 `Si` 於 `Si.date` 依序設定或校準當時的 `shares`、`costBasis` 與 FIFO 合成批次 `lots`，但**不重設** `(B0.date, B.date]` 期間已套用交易所累計的 `realizedPnl`、`dividends`、`fees`、`taxes`、`bought`、`sold` 與 `cash`。
  - 若 `B.origin === "full_snapshot_close"`（由已確認之完整快照結案歸零，`shares === 0`, `avgCost === null`）：設定於 `B.date` 持股為 `0`、`costBasis = 0`、`open = false`（早於 `B0.date` 的舊交易仍標 `preSnapshot: true` 不回魂，`(B0.date, B.date]` 期間賣出／股息損益完整保留，晚於 `B.date` 若再買進則由 0 重建）。
  - 一般 `B.shares > 0` 快照：於 `B.date` 設定期初／校準股數 `shares = B.shares`、`costBasis = r2(B.shares * B.avgCost)`。
  - **FIFO V1**：於錨點產生 **1 筆合成批次**：`{ date: B.date, id: B.id, shares: B.shares, cost: r2(B.shares * B.avgCost), isSnapshot: true }`。後續賣出依 FIFO 先扣抵此合成批次（或後續新買入且更晚賣出），已實現損益正確以 `B.avgCost` 計算。
  - **加權平均**：以 `(B.shares, r2(B.shares * B.avgCost))` 為起點計算後續移動加權平均成本與賣出已實現損益。
- **按日期分類處理該標的交易**：
  - **`t.date < B0.date` 或 `t.id === s.tagTxId`（含被標為期初快照之 `transfer_in`）**：
    - 照常執行格式驗證（`checkTx`）、`currency_conflict`、`duplicate_id` 與跨批重複比對，並保留於 `p.history` 標註 `preSnapshot: true`。
    - **不重複加減目前持股、不變動 `costBasis`／`lots`／`realizedPnl`／`cash`／`totals`，不因缺少早期買進紀錄而誤觸快照前 `oversell`**。
  - **`t.date === Si.date`（與鏈上快照同日之交易）**：
    - 優先讀取 `rel = reconStore.sameDayRelations?.[t.id]`（相容測試直接傳入的 `t.snapshotRelation`）。套用前必須核對 **`rel.snapshotDate === Si.date`、`t.date === Si.date`，且（若 `rel.snapshotId` 有值）`rel.snapshotId === Si.id`**；若不符（例如交易曾改日期再改回或基準已換成新快照）一律視為失效並當作 `"unresolved"`。若尚未明確標記 `"before_snapshot"` 或 `"after_snapshot"`，**不可擅自假設先後順序**！該筆同日交易列為 Level 2 待確認（`same_day_order`），並反映於 `position.pending`；未確認前暫不異動基準持股（防止同日賣出在未釐清快照涵蓋與否時誤算兩次），待使用者於 UI 點「快照前已含（僅存歷史）」或「快照後才成交（納入持倉計算）」寫入 `kline:pf:recon:v1.sameDayRelations`（連帶覆寫成目前 `snapshotId` 與 `snapshotDate`）與 `audit[]` 後生效。若屬最早快照 `B0` 同日之 `before_snapshot` 則標 `preSnapshot: true`；若屬後續快照 `Si` 同日之 `before_snapshot` 則於 `Si` 錨點前套用並保留損益。另對已關閉的 `conflicts` 亦核對其引用 `txId` 是否仍存在且日期相符，失效者視為已過期不再生效。
  - **`t.date > B0.date`（晚於最早快照日之期間與後續交易）**：
    - 依標準帳本引擎時序套用 `buy`、`sell`、`dividend`、`stock_dividend`、`split`、`fraction_cash`、`transfer_in`、`transfer_out`、`fee`、`other`。
    - 若賣光歸零（`shares <= EPS`），`costBasis = 0`、`lots = []`、`open = false`；之後再買進則從 0 重建成本與新批次，歷史 `realizedPnl`、`dividends`、`fees`、`taxes` 完整保留。
    - 若晚於 `B0.date` 發生 `sell > p.shares + EPS` 或 `transfer_out > p.shares + EPS`，維持擋下／標錯（於匯入流程歸入 Level 3 `negative_position` 暫停入帳）。

### 2. 兩張快照的取代、完整 vs 部分語意（含持股歸零）與差異衝突（`S1` → `S2`）

當同一標的存在已確認基準 `S1`（`S1.shares > 0`），使用者匯入新庫存截圖（已知精確且非未來基準日 `asOf`）：
- **A. 快照範圍語意（`snapshotScope: "full" | "partial"`）與「未出現標的」處理**：
  - 每次匯入庫存截圖必須由使用者明確選擇範圍，**系統不得擅自將任何截圖推斷為 `"full"`**（預設／未指定 `"full"` 一律視為 `"partial"`）：
    - **`snapshotScope === "partial"`（部分截圖／單頁清單）**：僅針對截圖上明確列出的標的進行更新或對帳；**既有 `S1` 中未出現在本次截圖的標的完全維持原狀**（不關閉、不發出歸零衝突）。
    - **`snapshotScope === "full"`（使用者確認為完整庫存清單）**：對於所有既有已確認基準 `S1`（`S1.shares > 0` 且 `S1.date < asOf`）但**未出現在本次截圖列**中的標的（亦即截圖已無該持股）：
      1. 以 `S1` 重播 `(S1.date, asOf]` 期間已確認交易計算截圖日推算股數 `simShares`：
         - **若 `simShares <= EPS`**（帳本交易已推算至 0 股，且無未定序同日交易）：自動（或確認匯入時於 Level 1）建立一筆 `origin: "full_snapshot_close"`, `status: "confirmed"`, `scope: "full"`, `date: asOf`, `shares: 0`, `avgCost: null` 的結案基準，並將 `S1.status = "superseded"`, `S1.supersededBy = closeSnap.id`（同時記錄 `audit[]`），明確關閉該標的。
         - **若 `simShares > EPS`**（新完整截圖已無該股，但帳本推算仍有 `simShares` 股 — 常見於賣出明細尚未匯入）：進入 **Level 2 `recon_diff`**（`baselineShares: simShares`, `targetShares: 0`, `diffShares: -simShares`, `payload: { reason: "missing_in_full_snapshot", previousSnapshotId: S1.id }`），保留 `S1` 為計算基準並在全站顯示 `⚠︎ 待對帳（差異 -simShares 股）`＋「完整庫存截圖已無此檔，可能是尚未匯入賣出明細，請確認是否已清倉歸零」。使用者在對帳中心可選「確認已清倉歸零（填原因後採信新完整快照 → 寫入 `full_snapshot_close` 關閉 `S1`）」、「補匯入賣出明細」、或「保留 `S1`（其實為部分截圖）」。
      2. 若 `asOf <= S1.date`（歷史完整快照早於或等於現有最新基準），**絕不關閉較新的 `S1`**。
- **B. 新快照有列出的標的（`S2.shares > 0`, `S2.avgCost > 0`）**：
  - **若 `S2.date < S1.date`（匯入早於現有基準的歷史快照）**：
    - 絕不讓較舊快照取代、降級或覆蓋較新確認基準 `S1`；將 `S2` 存入 `snapshots[]` 並設 `status: "superseded"`, `supersededBy: S1.id`，於 `audit[]` 記錄 `"匯入快照早於現有基準日，僅留存歷史不覆蓋較新基準"`。
  - **若 `S2.date >= S1.date`**：
    1. 若在 `S1.date` 或 `S2.date` 存在尚未標明 `sameDayRelations`／`snapshotRelation` 之同日交易，先中止自動晉升並進入 Level 2（`same_day_order` / `recon_diff`），避免在時序未明下覆蓋基準。
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
- **不改寫 `kline:pf:v1`**：標記／撤回僅寫入 `kline:pf:recon:v1`（更新 `initialTags[tx.id]`、對應 `origin: "tx_tag"` 快照及 `audit[]`）。**刪除**或**修改**帶有啟用 `initialTags` 之 `transfer_in` 時，必須先以試算模擬新帳本與目標對帳狀態，無錯後透過上述「雙鍵可恢復協議（`op: "deactivate_tags"`／`op: "update_tx_tag"`）」同步提交：
  - 若修改仍維持 `type === "transfer_in"`、同一正規大寫 `symbol`／`market`／`currency`、有效 `date <= today`、`shares > 0` 且 `price > 0`，`mode: "update"` 就地更新該 `tx_tag` 快照之日期／股數／均價並留稽核；若改為其他交易類型（如 `buy`）、改變標的／市場／幣別或 `price <= 0`，`mode: "deactivate"` 同步停用 `initialTags[tx.id]` 並將該 `tx_tag` 快照設為 `superseded`（保留原正數 `avgCost`/`shares` 供歷史追溯，決不寫 `0`）。
  - 當 `initialTags[tx.id]?.active` 為真時，統一計算入口對該筆交易加上 `preSnapshot: true`（不重複計數）：
    - 若該標的沒有更新的確認基準，或此標記為唯一／最新基準，即以該 `tx_tag` 快照為計算基準。
    - 若該標的已存在更晚的確認基準 `B_newer`（`T.date < B_newer.date`），維持 `B_newer` 為 `confirmed` 基準不替換：依第 2 節規則檢核 `tx_tag`＋期間交易與 `B_newer`，若一致則 `tx_tag` 設 `superseded`（`supersededBy: B_newer.id`）且 `T` 仍標 `preSnapshot: true` 避免重複計數；若不一致則保留 `B_newer` 並建立 `recon_diff` 供確認；撤回、修改停用或刪除該 `transfer_in` 時僅更新／停用該 `tx_tag` 快照，絕不破壞 `B_newer`。
      - **實作（`KLRecon.tagInitialTx(store, tx, { txStore, ledgerLib, method })`）**：以「期初標記＋該標的 `<= B_newer.date` 的交易」在只以期初標記為基準的暫存對帳資料上重算；無交易錯誤、無未決同日順序且股數／均價在晉升容差內 → 期初快照設 `superseded`、`supersededBy: B_newer.id`（串接進快照鏈，保留期間損益）並記 `audit[]`（`tag_linked_to_newer_baseline`）。否則（含未傳交易紀錄無法驗證）→ 期初快照設 `superseded`、`supersededBy: null`（不串接），建立 `open` `recon_diff`（`payload.reason: "tag_older_than_baseline"`、`snapshotId` 指向期初快照、`previousSnapshotId: B_newer.id`），`B_newer` 照舊為計算基準。撤回或重新標記同一筆交易時，舊的這類待對帳一併結案。
      - **UI 寫入前試算**：「標為期初快照」只寫 `kline:pf:recon:v1`，但會改變帳本計算；寫入前以 `buildReconciledLedger` 比較標記前後的 `errorCount`，增加就拒寫並提示。

---

## `perf.js` 報酬與現金口徑

- **現金不異動**：快照不會在 `L.cash` 建立任何存入或買進紀錄，避免汙染現金比例與總資產計算。
- **時間加權／資金加權從最初確認快照日（`B0.date`）起算**：
  - `buildPerf(txs, opts)` 支持 `opts.recon`（若有 `LG.buildReconciledLedger` 且傳入 `opts.recon` 時優先使用；無 `opts.recon` 時完全保留原 `buildLedger` 行為以維持既有單元測試相容）。
  - 當某標的具有已確認基準鏈 `B0 → ... → B`（以 `firstSnapshot*` 記錄 `B0` 起點；若 `B0` 本身屬已清倉關閉基準且無交易則為 `0` 股不產生投入現金流）：
    - `preSnapshot`（早於 `B0.date` 或屬期初標記）的交易現金流**不計入** `flows`、`inflow`／`outflow` 與 `lastTradePx`；`sharesAt` 在 `d < B0.date` 一律為 `0`（不含未入帳的快照前歷史），而 `(B0.date, B.date]` 期間交易與損益完整保留。
    - 於 `B0.date` 產生一筆初始證券投入現金流 `f = B0.shares * initPrice`：若 `books[B0.symbol]` 在 `B0.date` 有當天收盤價（`px.d === B0.date`）則優先使用市價，否則回退以 `B0.avgCost` 計算（與 `transfer_in` 一致，回退時加入 `est.add("transfer_at_cost")`）。
    - **重要修正**：因為計算起點直接從各檔有效起點（`B0.date`）或最早有效日算起，若股票日 K 第一天早於或等於 `B0.date`，即使該檔在 `B0.date` 前曾有標記為 `preSnapshot` 的舊交易（例如兩年前 `transfer_in`），也不會誤報 `history_truncated`。
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
      asOfStatus: "exact" | "year" | "mdy" | "future" | "invalid" | "missing",
      // 當 year / mdy / future / invalid 時帶出 rawAsOf（mdy 另帶 altDate），供前端並陳原始日期字樣與推定日
      rows: [...],
      model: "..."
    }
    ```
- **日期規則（`asOf` 與逐列 `date`）與向下相容**：
  - `parseTradeDate(raw, today, opts = {})` 與 `cleanTradeRows(rows, opts = {})` 在**未傳入 `missingAsNull: true` 時完全保留既有行為**：空白／`null`／純空白仍回傳 `{ date: refToday, dateAssumed: "today" }`，確保既有的直接單元呼叫與 `tests/ledger-import.test.mjs` 斷言完全不中斷。
  - **僅 `mode: "auto"`** 在清理時啟用 `{ missingAsNull: true }`：
    - 對 `kind === "holdings"` 與頂部基準日 `asOf`（`parseAsOf(asOfRaw, today)`）：沿用 `parseTradeDate` 核心解析規則（對 `MM/DD` 若今年 cand > today 自動跨年推前一年並保留 `rawAsOf`），並加上明確未來日判定（若解析日 `> today` 回 `{ asOf, asOfStatus: "future", rawAsOf }`），總共產出 `asOfStatus: "exact" | "year" | "mdy" | "future" | "invalid" | "missing"`；若 `asOfRaw` 為空／`null`，回傳 **`asOf: null, asOfStatus: "missing"`**（決不為無日期快照合成今天）。
    - **關鍵安全閘道**：對庫存快照，**只有 `asOfStatus === "exact"`（且 `asOf <= today`）** 才允許未經額外日期確認直接建立 `confirmed` 基準；**`asOfStatus === "year"`（缺少截圖年份）一律與 `missing`/`mdy`/`future`/`invalid` 同樣先進 Level 2**，UI 必須同時展示截圖原始日期（例如 `05/12`）與系統推定日期（例如 `2026-05-12`），唯有使用者明確確認年份或修正正確日期（且 `<= today`）後才可建立 `confirmed` 快照！
    - 對 `kind === "trades"`：逐列缺日期時回傳 `{ date: "", dateAssumed: "missing" }`；前端收到後若頂部 `asOf` 為有效已知年份日期（`asOfStatus === "exact"`）即自動為空白列預帶 `asOf`（標示「自動帶入截圖基準日」並允許逐列修改），若頂部 `asOf` 為 `"year"` 仍標「年份待核對」要求確認，若為 `"missing"`／`"invalid"`／`"future"` 則進入 Level 2 `missing_date` 請使用者補填。
- **融資／融券辨識與條件展開**：
  - `PROMPT`／`TRADES_PROMPT`／`AUTO_PROMPT` 與結構清理函式 `cleanRows`／`cleanTradeRows` 擴充擷取信用交易標記（`融資`、`融券`、`資買`、`資賣`、`券賣`、`券買`、`\bmargin\b`、`\bshort\b` 等）。
  - 一律以條件展開 `...(marginType ? { marginType } : {})` 輸出：僅在實際偵測到信用交易關鍵字時才於回傳物件附上 `marginType: "margin" | "short"`；一般現股完全保持原本鍵集合不變，不破壞既有單元測試 `deepEqual` 契約。
- **Mock 與錯誤處理**：
  - 若 AI 回傳 `kind === "unknown"` 但無可用資料列，回 200 `{ ok: false, kind: "unknown", error: "..." }`；若帶有可讀資料列，則回 `{ ok: true, mode: "auto", kind: "unknown", ... }` 由前端檢視表格直接讓使用者手動點選為「庫存快照」或「交易明細」（不額外重呼叫 AI）。
  - 所有測試一律 mock `fetch`／AI 函式，涵蓋成功、失敗（無金鑰、429、503、422）、`unknown`、缺日期、`year` 跨年與未來日、斜線歧義日期與融資融券隔離。

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

## 入口收斂、三級分流、依市場分流之交割提示與全站 8 頁標示

### 1. 單一主要入口與檢視流程

- 入口整併：
  - `watch.html` 資料來源列「截圖匯入」（`[data-hsrc="tx-imp"]`）、帳本簡介頁（`lgIntroHtml`）與交易紀錄工具列（`[data-lg="imp"]`），**全面導向同一個「匯入資料」統一視窗（`lgOpenImport()`）**。
  - **移除前置二選一關卡**：打開後不先問使用者「你是庫存還是對帳單」，而是直接提供單一「📷 上傳券商截圖（自動辨識庫存／交易明細）」主按鈕（送 `mode: "auto"` 到 `/api/import`），下方輔以次要入口「手動新增空白列」與「待對帳項目（N）」（若有開放衝突）。
  - AI 回傳後於審核表格頂部呈現「系統辨識結果：庫存快照／交易明細＋截圖基準日」（若 `kind === "unknown"` 則亮顯請選擇類型切換鈕），**保留一鍵切換「改為庫存快照／改為交易明細」**。
  - **快照「完整／部分」範圍確認**：當 `kind === "holdings"` 時，頂部呈現明確範圍選擇（`[data-lgimp-scope="partial"]`「部分截圖／單頁（只更新畫面上列出的股票）」vs `[data-lgimp-scope="full"]`「完整庫存清單（未出現且原本持有的標的將進入清倉核對或結案）」）；**預設一律保守不猜 `"full"`**（若已有其他活躍快照且未出現在本次截圖，並明確列出未出現標的提醒使用者確認範圍）。
  - **既有 E2E 遷移說明**：原 `tests/e2e/ledger-import.test.mjs` 使用前置選項卡 `[data-lgimp-pick="holdings"|"trades"]` 與驗證送出 `mode: "holdings"|"trades"`。實作 Batch 2 將同步把該測試遷移至新統一上傳入口與 `mode: "auto"`，原有所有斷言（日期修正、手續費與折扣、FIFO 同日排序、黏滯表頭無水平溢出、代號檢核、舊庫存不動）完整保留，絕不放寬。

### 2. 三級處理分流與依市場交割提示（`KLRecon.settlementHint(market)`）

- **市場區別交割提示文案（嚴禁對美股誤用台股 T+2）**：
  - `market === "tw"`：`⚠︎ 待對帳（差異 N 股）— 可能是近 2 個交易日尚未交割（台股 T+2），或有交易還沒匯入`
  - `market === "us"`：`⚠︎ 待對帳（差異 N 股）— 可能是前 1 個交易日尚未交割（美股 T+1），或有交易還沒匯入`
  - 市場不明／多市場混列摘要：`⚠︎ 待對帳（差異 N 股）— 可能有尚未反映的交割或未匯入交易`

| 分級 | 條件 | 系統行為 |
|---|---|---|
| **Level 1（自動處理）** | 代號、方向、**精確已知年份且非未來日期（`exact` 或已明確確認日期 `<= today`）**、股數、有效價格／正成本齊全；無重複；非融資融券；與基準快照關係明確（`S1→S2` 在容差內自動晉升、完整快照且帳本推算已歸零自動關閉、`t.date < B.date` 納入歷史不重加股數、`t.date > B.date` 正常加減） | 在審核清單清楚標示系統自動對帳結論（例如「歷史紀錄：不重複增加持股」、「快照自動更新基準」、「完整快照確認已清倉歸零」），確認後直接套用並記錄 `audit[]` |
| **Level 2（顯示差異，請使用者確認）** | ① 快照推算與新快照數量或成本差超出容差（`recon_diff`，含**完整庫存快照已無某既有持股但帳本推算仍有股數**）；② 快照缺均價（`missing_cost`）；③ 截圖**缺年份（`year`）**、缺基準日（`missing`）、格式歧義（`mdy`／`invalid`）或未來日（`future`）；④ 同日交易與快照先後未明（`same_day_order`）；⑤ 跨批疑似重複（`possible_duplicate`）；⑥ 截圖含融資／融券部位（`margin_separated`） | 保留雙邊資訊並暫維持現有已確認快照計算。`year` 並陳原始字串與推定日，須明確確認後方可建立正式基準。`recon_diff` 依標的 `market` 套用對應 T+2／T+1／中性交割提示，提供保留兩邊待釐清／補匯入明細／採信新快照或確認清倉（須留原因寫 `audit[]`）等處理。融資融券列自動隔離且預設不勾選入現股帳本，引導至「配置與風險 → 融資」管理 |
| **Level 3（暫停入帳，不擋其他列）** | 代號無法辨識、方向不明、無法解析／未來成交日、同一 `symbol` 與既有快照或帳本之 `market/currency` 衝突（`currency_conflict`）、快照後造成負持股（賣超） | 標紅暫停套用該列（使用者可當場修正欄位、取消勾選排除、或僅保留其餘正確列先完成匯入），絕不自行猜測覆蓋 |

### 3. `holdSrcApply`／`holdSrcBar`、跨分頁即時更新與全站 8 頁標示

- **`watch.html` 資料來源判斷**：
  - `holdSrcApply()` 讀取 `kline:pf:v1` 與 `kline:pf:recon:v1`，若有 `pendingCommit != null`，先用**無副作用**的純函式 `KLRecon.recoverCommit(S0, recon)` 在記憶體產出恢復結果進行計算，並僅在非 `storage` 事件的一般載入路徑才排程鎖內的 `lgRecoverPersist?.()` 落盤；**有交易（`transactions.length > 0`）或有至少一筆已確認快照（`confirmedSnapshots.length > 0`，含完整快照結案歸零基準）**且 `!W.hsrcLegacy` 時，全部改用 `KLLedger.buildReconciledLedger` 計算持倉並鎖定 `kline:watch:hold` 唯讀（確保全部出清後不會誤退回舊 `kline:watch:hold`）。
  - 快取鍵改為 `` `${twIso()}|${rawPf}|${rawRecon}` ``（修改交易或更新對帳快照／標記狀態皆立即失效重算）。
  - 監聽 `window.addEventListener("storage", ...)`，於 `kline:pf:v1` 或 `kline:pf:recon:v1` 在其他分頁變動時**只重算並重畫畫面，絕不在監聽器內執行寫回 `localStorage` 的恢復程序**。
- **`holdSrcBar()` 文案規則**：
  - 有交易時保留既有用詞相容既有測試正則 `持股來自交易紀錄（N 筆交易...）`（附加 `・M 檔快照基準` 與有衝突時的 `⚠︎ 待對帳（X 檔）` 按鈕）。
  - 只有快照、尚無交易時顯示：`持股來自交易帳本（M 檔期初快照）`。
  - 保留 `[data-hsrc="legacy"]`「改看舊庫存」與 `[data-hsrc="ledger"]`「改看交易帳本／交易紀錄」雙向切換。
- **全站 8 頁一致顯示「⚠︎ 待對帳（差異 N 股）」**：
  | 頁面／區塊 | 待對帳時顯示內容 | 期初／衝突計算備註 |
  |---|---|---|
  | **1. 總覽**（`pf-home.js`） | 頂部／風險狀態列出 `⚠︎ 待對帳（<標的> 差異 N 股）`（可點擊跳往交易紀錄處理） | 以最新已確認快照顯示資產、報酬與前五大 |
  | **2. 持股（損益／屬性分析）**（`watch.html`） | `holdSrcBar()`＋個股列警示 `⚠︎ 待對帳（差異 N 股）`＋`holdDataCheck()` 提示 | 股數與均價暫用最新已確認快照（鎖 `kline:watch:hold`） |
  | **3. 交易紀錄**（`ledger-ui.js`） | 頂部待對帳專用卡片（列出所有 open `conflicts`、雙邊比對數字、依市場分流之 T+2／T+1／中性交割提示、解決操作＋歷史/稽核抽屜），持倉列同步標示 | `preSnapshot` 交易標示「快照前歷史」；`transfer_in` 顯示「標為期初快照／撤回」 |
  | **4. 績效**（`ledger-ui.js`＋`perf.js`） | 狀態列／卡片標章與原因：`⚠︎ 待對帳（差異 N 股）`、`recon_pending`、`snapshot_baseline` | 從快照日起算，不動現金、不回推快照前 |
  | **5. 配置與再平衡**（`ledger-ui.js`＋`pf-rebal.js`） | 頁面頂部＋再平衡卡片內顯示 `⚠︎ 待對帳（差異 N 股）` | 若有快照基準或待對帳部位，明確標示「**用已確認快照的股數試算**」 |
  | **6. 壓力測試**（`pf-stress.js`） | 壓力情境卡片頂部／試算說明顯示 `⚠︎ 待對帳（差異 N 股）` | 明確標示「**用已確認快照的股數試算**」 |
  | **7. 股利**（`pf-divcal.js`） | 股利卡片頂部警示 `⚠︎ 待對帳（差異 N 股）` | 依已確認快照股數估算未來 12 個月股利 |
  | **8. 報告與論點**（`pf-report.js`／`pf-thesis.js`） | 報告頂部提醒＋明細列標 `⚠︎ 待對帳（差異 N 股）`（含列印報表）；論點頂部警示＋個股卡片標註 | 報告與論點停損/停利皆共用統一計算結果 |

---

## 必測情境與驗收標準（24 項）

| # | 測試情境（全部用固定假資料／Mock `/api/import`） | 預期結果 |
|---|---|---|
| 1 | 首次匯入庫存截圖 | 建立 `confirmed` 庫存基準與基準日；帳本顯示該持股，不改 `kline:watch:hold` |
| 2 | 補傳歷史交易（早於快照日） | 寫入 `kline:pf:v1` 並標記 `preSnapshot: true`；**不重複增加已確認持股** |
| 3 | 補傳最新買進（晚於快照日） | 正確增加持股、調整成本（AVG 或快照後 FIFO），並以已確認快照後之買進估算／記入 |
| 4 | 補傳最新賣出（晚於快照日） | 正確減少持股，已實現損益正確以快照均價計算 |
| 5 | 同張圖片／同批成交重複上傳（含原圖指紋＋跨批／同批） | **同批同價分批兩筆不會誤報重複**；跨批同簽章進 Level 2；未結案同原圖 SHA-256 顯示非阻斷提醒 |
| 6 | 庫存快照與交易明細計算數量不同 | 保留兩邊與差異 N 股，依市場顯示對應交割提示，未確認前暫用已確認快照並於全站 8 頁標示 `⚠︎ 待對帳（差異 N 股）` |
| 7 | 截圖日期缺失或格式歧義 | `asOfStatus: "missing"`／`mdy` 進 Level 2 要求確認，不擅自以今天建立基準或定案入帳 |
| 8 | 多股票混合截圖 | 逐檔獨立辨識與對帳；各檔按自身快照或明細各自判定 Level 1/2/3 |
| 9 | 部分交易辨識失敗（Level 3） | 問題列暫停入帳，同批其餘有效列照常匯入不受阻 |
| 10 | 同日交易與快照基準同日 | 進入 Level 2 請使用者確認發生在快照前（僅存歷史）或快照後（須加減持股），定序記在 `kline:pf:recon:v1.sameDayRelations`，不擅自假設先後 |
| 11 | 完整匯入／對帳歷程可追溯 | `imports[]` 與 `audit[]` 保留來源、原圖雜湊、AI 結果、對帳結論與確認動作，可在頁面檢視並修正 |
| 12 | 舊的 `transfer_in` 加上新快照 | 舊 `transfer_in` 未手動標記前維持一般交易參與推算，與新快照一致時自動升級／不一致進 `recon_diff` |
| 13 | 同一檔先後有兩張快照（`S1` → `S2`） | `S1`＋中間確認交易與 `S2` 股數／成本在容差內 → `S2` 自動晉升、`S1` 設 `superseded`；不符 → 留 `S1` 標 `⚠︎ 待對帳` |
| 14 | 快照後全部賣光再買回 | 中間賣光歸零、`costBasis = 0`、`lots = []`；後續重買由 0 起算（含兩張快照跨過歸零重買情境） |
| 15 | 截圖裡含融資／融券部位 | `/api/import` 輸出 `marginType`；前端隔離並預設不入現股快照，顯示引導前往「配置與風險 → 融資」 |
| 16 | 帳本完全空白（無 `pf:v1` 或 `transactions: []`）、只匯入庫存快照 | `holdSrcApply`、`renderLedger`、`perf`、`pf-home`、`pf-report`、`alloc`、`div`、`thesis` 全正常顯示，不退回空白介紹頁 |
| 17 | `transfer_in` 手動「標為期初快照 → 撤回 → 再標記」 | 標記時不疊加該筆 `transfer_in` 與不動 `kline:pf:v1`；撤回恢復一般計算；再標記回到快照模式並完整留稽核 |
| 18 | `kline:pf:recon:v1` 改變時即時重算（含跨分頁 `storage` 事件）＋備份鍵序驗證＋`perf` 快照起點／無圖片／靜態防繞過 | 寫入或跨分頁變更立即更新 `W.hold`；備份含隨機鍵序 `recon` 缺檢查模組或含 `pendingCommit` 必拒；`perf` 不改現金不回推；全專案除 `ledger.js` 無直接 `.buildLedger(` 呼叫 |
| 19 | **跨鍵雙寫失敗與重啟恢復（WAL Commit Protocol：`import_trades`／`deactivate_tags`／`update_tx_tag`）** | 涵蓋交易匯入、刪除期初標記 `transfer_in`、修改期初標記 `transfer_in`（更新快照與改類型／`price<=0` 停用）；Phase 1/2/3 中斷與 `store.set === false`（含復原再失敗）重開頁面冪等 Roll-Forward／Clean Abort、重複恢復 `audit[]` 零重複，及部分不一致／未知 `op` fail-closed 完整保留 WAL 並阻擋覆寫 |
| 20 | **完整快照 vs 部分快照處理持股歸零** | `S1` 有 `2330`：`S2` 確認為 `"full"` 且不含 `2330` 時能自動結案或進 Level 2 確認後關閉 `S1`（不再顯示 `2330`）；`S2` 為 `"partial"` 且不含 `2330` 時維持 `S1`（`2330` 保留） |
| 21 | **缺年份（`asOfStatus: "year"`）跨年與未來日期（`future`）防護** | `year`（含 `01/05` 看 `12/28` 跨年）與未來日一律先進 Level 2 並顯示原始與推定日期；未經使用者確認前**不可產生 `confirmed` 快照** |
| 22 | **同 `symbol` 不同 `market`／`currency` 約束** | 快照內部錯配、快照之間不同市場／幣別、或快照與既有交易不同市場／幣別皆被 `KLRecon.validateStore`、`planHoldingsSnapshot` 與 `buildReconciledLedger` 拒絕（`currency_conflict`） |
| 23 | **不可裁剪核心資料超過 120KB 上限失敗契約** | 核心保留物件超過 `maxBytes` 時 `pruneStore` 回 `{ ok: false, code: "core_data_exceeds_limit" }`，寫入前擋下並保留既有 `kline:pf:recon:v1` 不覆蓋 |
| 24 | **依市場區分交割差異提示（TW T+2 vs US T+1 vs 中性）** | 台股衝突顯示 T+2、美股（例如 NVDA）衝突顯示 T+1、市場不明或混合摘要顯示中性交割提示，絕不對美股顯示台股 T+2 |

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
