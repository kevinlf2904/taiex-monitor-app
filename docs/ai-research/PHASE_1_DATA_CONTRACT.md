# AI 研究室 Phase 1：研究資料契約

實作：`learner/research.js`（`rec`、`twQuoteStatus`、`buildSnapshot`，18–107 行）；原始資料收集：`learner/market-center.js` `researchInput(W)`（763 行）。

## 1. 一筆研究資料

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 資料編號，AI 引用時用這個（例：`tw.T00.price`、`tw.flow.out1.net1`、`lv.pivot`、`us.^SOX.chg`）|
| `label` | string | 中文名稱 |
| `value` | number／string／null | 數值；新聞摘要是文字；**取不到就是 null，不補數字** |
| `unit` | string | 點、%、家、億元… |
| `symbol` | string／null | 代號（T00、^SOX、TWD=X）|
| `market` | `TW`／`US`／`GLOBAL` | 市場 |
| `source` | string | 原始來源（富果、證交所、Yahoo Finance、KLineLab 技術攻防模型、程式計算…）|
| `tradeDate` | `YYYY-MM-DD`／null | 資料所屬交易日（美股是美東日期）|
| `updatedAt` | string／null | 來源時間（台股 ISO＋08:00；美股「日期 時間（美東）」；全球是抓取時間 UTC）|
| `tz` | string | `Asia/Taipei`、`America/New_York`、`UTC` |
| `dataStatus` | 見下表 | |
| `isEstimated` | boolean | 估算或模型推估 |
| `isPartial` | boolean | 欄位不齊 |
| `confidence` | `high`／`medium`／`low` | |
| `kind` | `data`／`model`／`calc`／`news` | 模型價位、程式計算、新聞摘要分開標 |
| `note` | string | 和加權不同日、外資／投信拆分等補充 |

快照：`{ version, generatedAt, session, expectedDate, records[], gaps[], warnings[] }`。`gaps` 是未取得／過期清單，`warnings` 是跨日等提醒，兩者都會送給 AI，也會顯示在「未知事項」。

## 2. 資料狀態

| `dataStatus` | 意思 | 判斷 |
|---|---|---|
| `realtime` | 即時 | 台股盤中，來源是富果／證交所 MIS，且不是備援；市場廣度 `live` 且和加權同日 |
| `delayed` | 延遲 | 台股盤中但是備援（Yahoo）或定時更新；美股供應商盤中報價（可能延遲 15 分鐘）；匯率原物料 |
| `after_hours` | 盤後／收盤 | 台股收盤後同一交易日；盤前看前一交易日收盤；美股收盤確認；族群漲跌 |
| `estimated` | 估算 | 法人金額（張數×收盤價）、技術攻防價位（模型）、離價位的點數（計算）|
| `partial` | 部分資料 | 廣度缺平盤家數、美股 `pending／partial` |
| `stale` | 過期 | 台股報價日期早於應有交易日；廣度和加權不同日；全球抓取超過 6 小時；美股來源標過期 |
| `unavailable` | 未取得 | 沒有數值（`value` 一定是 null，信心一定 low）|

**應有交易日（expectedDate）**：盤前＝前一交易日（看前一天收盤是正常的，不算過期）；盤中、收盤後＝今天；休市＝最近交易日。依 `sessionStatus()` 與休市日曆計算（`market-center.js` researchInput）。

## 3. 規則與對應實作

| 規則 | 實作 | 測試 |
|---|---|---|
| 不同市場、時段不混淆 | 台股、美股、全球分開編號與 `market`；美股 `tz: America/New_York`、資料日是美東日期 | 測試 6 |
| 法人標實際資料日 | `tw.flow.*` 的 `tradeDate` 是法人資料日；和加權不同日時寫進 `note` 與 `warnings` | 測試 4、7 |
| 即時、延遲、盤後分開 | `twQuoteStatus()`（`research.js:30`）| 測試 5 |
| 全球保留來源時間與時區 | `updatedAt` 是來源抓取時間，`tz: UTC`；超過 6 小時標 stale | 測試 1 |
| 缺值不補 | `rec()` 沒有數值就強制 `unavailable`（`research.js:28`）| 測試 2 |
| 不同交易日不相加、不比較 | 不跨日運算；只有「加權 − 模型價位」在**同一交易日**才算（`research.js:84`）| 測試 1、4 |
| 估算不偽裝官方 | 法人金額、模型價位 `isEstimated: true`、`dataStatus: estimated`、`source` 寫明估算／模型；畫面「關鍵價位（模型推估，非實際報價）」| 測試 1、7 |
| 可追溯 | 每筆有 `source`、`tradeDate`、`updatedAt`；報告每一點顯示引用的資料名稱與日期 | e2e |
| AI 知道缺漏與過期 | `contextText()` 結尾列「缺漏與過期」與「注意」| 測試 2、4 |

## 4. 雜訊控制

- 族群：流入、流出**各取前五**，每個族群最多三筆（淨額、近 5 日、族群漲跌），外資／投信寫在備註。
- 美股最多 10 筆，全球只取台幣、原油、黃金、VIX。
- 自選：目前群組漲跌幅最大的 6 檔（`watch.<代號>.chg`），台股照報價狀態判斷，美股看報價自己的時段。
- 新聞摘要只取標題＋第一點，各 80 字內，`kind: news`、信心 low，只能當消息面參考。
- 送出的資料表上限 5000 字（`MAX_CONTEXT`），伺服器另外截 6000 字。
