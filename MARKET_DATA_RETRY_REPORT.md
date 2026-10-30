# 盤中行情資料延遲與備援機制修復報告

分支：`claude/fix-market-data-retry-fallback`（AGENTS.md 規定 Claude Code 用 `claude/…` 分支，所以沒有用任務名稱 `fix/market-data-retry-fallback`）
基準：main `bde07a1`（PR #181 已合併，工作目錄乾淨，沒有開著的 PR）

## 一、第一階段：唯讀稽核

### 1. 資料流架構（修改前）

```
/api/market ─┐
/api/hot ────┼─→ _live.js marketRows()（每個 Vercel 執行個體一份 memo：live 8 秒、其他 30 秒）
/api/screen ─┘      1. 富果快照 snapshot/quotes（有 FUGLE_API_KEY 才試；目前方案回 403）
                    2. OpenAPI 前一交易日清單（當作 MIS 要查哪些股票的基準）
                    3. 盤中：misAll() → quote.js misFetch()，每批 100 檔、4 批同時、失敗拆半再試兩層
                         今天的列 ≥ 500 檔才算成功
                    4. 失敗 → fetchRecentClose()：13:35 前從「昨天」開始找 → 昨天收盤
                    5. 再失敗 → OpenAPI 前一交易日
/api/quote ───→ quote.js：富果 intraday/quote → MIS（同一個 misFetch）→ 富果指數＋Yahoo 備援
/api/intraday → 富果 candles → Yahoo 1 分 K（只有這兩個來源，沒有用 MIS）
前端 watch.html loadMktLive()：每次成功就整份換掉 W.mkt
```

### 2. 根因（逐項以程式碼確認）

| # | 位置 | 問題 | 影響 |
|---|---|---|---|
| R1 | `quote.js misFetch` | 任何一次網路錯誤或逾時就把 MIS 關 30 秒（`misDownUntil`）。misAll 同時跑 4 批，其中一批逾時，其他還沒查的批次全部直接失敗 | **一次逾時就讓整個 MIS 查詢只剩部分資料**，是「MIS 偶爾只回部分資料」的主因 |
| R2 | `quote.js misFetchRaw` | 第一次請求不管什麼錯（403、429、5xx、逾時、JSON 錯）都吞掉，再拿 cookie、再試一次；每次 6 秒，最壞一批 18 秒 | 錯誤種類不分；403 也重試；時間翻倍 |
| R3 | `_live.js misAll` | 批次失敗拆成兩半、再拆兩半（一批最多 7 次請求），**沒有整體時間上限** | MIS 很慢時一次 marketRows 可能超過 Vercel 60 秒上限 → 函式逾時 |
| R4 | `_live.js misAll` | HTTP 200 但 msgArray 是空的或只回一部分：直接當成功，少掉的股票默默不見 | 問題 A、B：部分資料被當完整成功 |
| R5 | `_live.js marketRows` | MIS 今天的列不到 500 檔 → 直接跳到 fetchRecentClose；13:35 前它從昨天開始找 → **盤中顯示昨天收盤**（畫面「資料延遲 10/29」） | 使用者看到的現象 |
| R6 | `_live.js marketRows` | 沒有「最後一筆有效資料」：8 秒前還有今天的 MIS 完整資料，這次失敗就被昨天收盤蓋掉，而且昨天收盤（live=false）在 memo 留 **30 秒** | 問題 B、D：較舊資料覆蓋較新資料、快取延長錯誤 |
| R7 | `_live.js marketRows` | 同一個執行個體 `/api/market`、`/api/hot`、`/api/screen` 同時進來，memo 還沒寫入前每個請求都各自跑一次全市場 MIS（約 18 批） | 請求風暴，更容易被 MIS 擋 |
| R8 | `watch.html loadMktLive` | 新回應日期比畫面上的舊（例如另一個冷啟動的執行個體回昨天收盤）也照樣整份換掉 | 問題 C：前端把今天的資料換成昨天 |

確認沒有問題的部分：

- **E、F 時段**：`session()` 有休市日表，`fetchRecentClose` 看休市與 13:35，`deriveDataStatus` 盤中要有來源時間才給 live（PR #182 P1-01）。
- **美股**：美股時區用 `_yahoo.js` 的 `usEasternParts`／`sessionOf`／`lastUsTradingDate`（America/New_York，含夏令時間），已有 watch-hot 測試。
- **昨天收盤的標示**：昨天收盤不會被標成 live，`deriveDataStatus` 非今天一律 delayed。不過盤中拿昨天收盤只標 delayed，比實際情況輕；應該標 stale（交易日期過舊）。
- **分時 K**：`/api/intraday` 不經 MIS。
- **個股報價**：`/api/quote` 的 MIS 只查 ≤ 40 檔，沒有拆批問題，但同樣受 R1、R2 影響。

### 3. 現有 fallback 優先順序

富果快照（403）→ MIS 全市場 → 最近收盤（盤中＝昨天）→ OpenAPI。缺「今天最後一筆有效 MIS」這一層。

### 4. 修改方案

1. **新增 `api/_lib/_retry.js`**：負責錯誤分類（fatal 403/401/404、rate 429、server 5xx、timeout、network、bad_json、empty、incomplete、circuit）、指數退避＋jitter、整體期限。403 不重試。
2. **quote.js**：
   - HTTP 錯誤帶 `status`。
   - cookie 只在回應格式不對或第一次 403 時換一次。
   - 斷路器改成「連續 3 次網路錯誤」才開 30 秒，403 開 60 秒。
   - `/api/quote` 的 MIS 最多 2 次、3.5 秒內。
3. **misAll**：
   - 每批最多 3 次（250ms 起跳、最多 2 秒等待）。
   - 每次請求 5 秒逾時。
   - 整體 15 秒上限。
   - 空回應或不到一半判失敗重試；遇到 403 全部停止。
   - 回傳批次統計。
4. **marketRows**：
   - 同一個執行個體同時的請求共用同一次查詢。
   - 盤中保留今天最後一筆有效資料：MIS 失敗時改用它，依來源時間標 delayed 或 stale，排在昨天收盤之前。
   - 部分資料不覆蓋 2 分鐘內的完整資料。
   - 盤中顯示昨天收盤標 stale。
   - 盤中非即時結果 memo 只留 8 秒。
5. **watch.html**：新回應的資料日期比畫面上的舊時，保留畫面上的資料，記錄原因。

### 5. 可能的副作用

- MIS 很慢時大盤回應最多多等約 15 秒（以前可能更久或逾時）。
- 保留最後有效資料時畫面數字不變，但狀態會顯示延遲或停滯和原因。
- 盤中顯示昨天收盤的狀態由「延遲」變成更嚴重的「停滯」。

## 二、修改內容（第二～四階段）

### 修改後資料流

```
marketRows()：同一個執行個體同時的請求共用一次（singleFlight）→ memo（即時或盤中 8 秒、收盤後 30 秒）
  1. 富果快照（照舊；今天的結果也走「部分資料不覆蓋完整資料」）
  2. OpenAPI 清單；拿不到時改用今天最後有效資料的股票清單
  3. 盤中 MIS：misAll（每批有限次重試、403 全部停止、整體 15 秒）
       成功 → 部分資料而且 2 分鐘內有完整的 → 沿用完整的（delayed）；否則用新的並記成最後有效資料
       失敗 → 今天最後有效資料（來源時間 6 分鐘內 delayed，超過 stale）
  4. 最近收盤（盤中拿到的是前一交易日 → stale）
  5. OpenAPI（盤中 → stale，其他 → delayed）
前端 loadMktLive：新回應比畫面上的舊（日期較早；兩邊都有時間時時間較早）→ 保留畫面上的資料，頁尾說明原因
```

### 重試策略

| 項目 | 全市場（misAll） | 個股報價（/api/quote） |
|---|---|---|
| 最多次數 | 每批 3 次，全部失敗再拆兩半各 3 次（一批最多 9 次） | 2 次 |
| 等待 | 250ms 起、每次 ×2、最多 2 秒，乘 0.5～1 的 jitter | 同左 |
| 單次逾時 | 5 秒（cookie 交換另外 5 秒） | 3 秒 |
| 整體上限 | 15 秒（到了不再開始新請求） | 3.5 秒 |
| 403／401／404 | 不重試；整批停止；斷路器 60 秒 | 不重試，改用備援 |
| 429、5xx、逾時、網路、JSON 壞、200 但空、200 但不到一半 | 重試 | 重試 |
| 200 但缺少數（≥ 50%） | 照收，少的列在統計裡 | 照收，少的列在 missing |
| 斷路器 | 連續 3 次網路錯誤或逾時 → 30 秒（以前 1 次） | 同左 |

### 資料狀態（沿用既有的 DATA_STATES，不另造一套）

| 任務要求 | 既有狀態 | 什麼時候 |
|---|---|---|
| realtime | `live` | 盤中、今天、完整、來源時間 ≤ 6 分鐘 |
| delayed | `delayed` | 來源時間沒有或落後；沿用 6 分鐘內的最後有效資料；收盤後的前一交易日資料 |
| after_hours | `confirmed`／`pending` | 收盤後今天的收盤（完整 confirmed，不完整 partial／degraded） |
| stale | `stale` | 盤中卻只有前一交易日的資料；最後有效資料超過 6 分鐘 |
| unavailable | `unavailable`（前端） | 沒有任何資料 |

`/api/market` 新增（只加不改）：`isLastGood`、`lastGoodAt`、`fallbackReason`、`sourceState`、`misStats`（批次數、失敗批數、重試次數、拿到／要求檔數、錯誤種類）。

### 快取保護

- 盤中備援結果在 memo 只留 8 秒（以前昨天收盤留 30 秒）。
- 最後有效資料只存今天、至少 500 檔的盤中資料；跨日自動失效（比 dataDate）。
- 部分資料 2 分鐘內不覆蓋完整資料。
- 自訂時鐘或查詢器（測試）不碰正式 memo 與最後有效資料。
- CDN 的 `Cache-Control` 不變（盤中 s-maxage 10～30 秒）。

### 修改檔案

- `api/_lib/_retry.js`（新）：錯誤分類、退避、withRetry、singleFlight
- `api/_lib/quote.js`：misFetch 斷路器、狀態碼、cookie 時機、/api/quote 的 MIS 重試
- `api/_lib/_live.js`：misAll 重試與統計、marketRows 共用查詢、最後有效資料、部分資料保護、stale 標示
- `api/_lib/market.js`：回應多帶備援欄位
- `learner/watch.html`：舊回應不蓋新資料、頁尾顯示原因（已開 draft PR 上鎖）
- 測試：`tests/market-retry.test.mjs`（新，25 項）、`tests/e2e/mktfresh.test.mjs`（+1）、`tests/live-state.test.mjs`、`tests/run.mjs`

### 既有測試的改動

`live-state` 的 Scenario 4、41 原本要求盤中退回前一交易日時是 `delayed`，改成更嚴格的 `stale`。Scenario 41 另外補了收盤後 OpenAPI 回退仍是 `delayed` 的斷言。沒有刪除測試，也沒有放寬斷言。

## 三、已知限制

- 最後有效資料存在各 Vercel 執行個體的記憶體裡：冷啟動的執行個體沒有它，MIS 失敗時仍會顯示前一交易日收盤（標 stale）。前端的「舊回應不蓋新資料」會擋住這種情況，但第一次打開頁面時擋不了。要跨執行個體共用，需要 KV（Upstash），而 KV 還沒設定。
- 富果快照方案不支援（403），本次沒有新增付費或第三方來源；全市場仍只有 MIS 一個盤中來源。
- 個股報價的 Yahoo 備援本來就標 `delayed`、`isFallback`。
- 分時 K 的 Yahoo 來源沒有修改。
- 整體時間：最壞情況 OpenAPI 12 秒＋MIS 15 秒（最後一個請求可能再 5～10 秒）＋收盤探測，仍在 60 秒內，但大盤回應最慢可能 30 秒以上。
