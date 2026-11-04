# 投資組合資料基礎（第 1 階段）

實作：`learner/portfolio.js`（`window.KLPortfolio`，純函式）；測試：`tests/portfolio.test.mjs`。

## 1. 一筆持倉

| 欄位 | 說明 |
|---|---|
| `symbol` | 代號（大寫） |
| `name` | 名稱：股票清單 → 看盤頁記住的名稱 → 報價裡的名稱 |
| `market` | `tw`／`us`；看不出來是 `null` |
| `currency` | `TWD`／`USD`，由市場決定 |
| `exchange` | `twse`（上市）／`tpex`（上櫃）／`taifex`（期貨）／`null` |
| `assetType` | `stock`／`etf`／`future`；之後可加 `cash` 等 |
| `industry` | 股票清單的產業別 |
| `classifiedBy` | `master`（股票清單查到）／`heuristic`（依代號推測）／`unknown` |
| `shares`、`avgCost`、`costBasis` | 股數、平均成本、總成本（股數 × 平均成本） |
| `lastPrice`、`marketValue` | 最新價格、市值；沒有報價時是 `null`，不是 0 |
| `unrealizedPnl`、`unrealizedPct` | 未實現損益、報酬率（不含手續費與稅，含費用的版本在庫存頁「損益」） |
| `priceDate`、`priceTime`、`priceSource` | 報價日期、時間、來源 |
| `openedAt` | 建倉日期（格式不對時是 `null` 並提醒） |
| `isDemo` | 範例投資組合的持股 |
| `status`、`issues` | 資料狀態與原因 |

## 2. 資料狀態

| 狀態 | 條件 | 可以用嗎 |
|---|---|---|
| `valid` 正常 | 股數、成本、報價都正常，市場由股票清單確認 | 可以 |
| `warning` 有提醒 | 市場是推測的、建倉日期不對、範例持股、現價和成本差 50 倍以上 | 可以，但要看提醒 |
| `incomplete` 缺價格 | 沒有報價 | 有成本，沒有市值 |
| `stale` 價格過期 | 報價日期比應有的交易日舊，或來源標示過期 | 市值要標「舊價格」 |
| `invalid` 資料錯誤 | 代號格式不對、大小寫重複、股數或成本不是大於 0 的數字 | 不能用 |

統計時，台幣和美元**分開加總**，不會相加；範例持股和 `invalid` 的不算。

## 3. 舊資料相容與搬移計畫

- 目前的庫存存在瀏覽器的 `localStorage`：鍵是 `kline:watch:hold`，格式是 `{ 代號: { sh, cost, d?, demo? } }`。
- 這個階段**只讀**：`readLegacy()` 不寫入、不刪除、不搬移；壞資料只在畫面標示，不會被改掉。
- 新的存檔位置 `kline:pf:v1` 只先定義，**目前不寫入**。

搬移要等第 4 階段（交易紀錄）。到時候：

1. 先產生「搬移預覽」，列出每筆會變成什麼，以及哪些資料錯誤要先修。
2. 使用者按確認後，才寫入 `kline:pf:v1`，格式是 `{ v: 1, positions, transactions, migratedFrom: "kline:watch:hold", at }`。
3. 舊的 `kline:watch:hold` **保留不刪**；之後至少一個版本仍能讀取，讓使用者可以退回。
4. 雲端同步、備份檔要同時支援新舊兩個鍵。
5. 保留期限：舊鍵在使用者確認搬移後至少保留 180 天，之後才提示可以清除，仍然由使用者決定。

## 4. 還沒做

- 美股沒有代號清單，市場只能依代號格式推測（畫面會標示）。
- 現金、交易紀錄、股息現金流屬於第 4、5 階段。
