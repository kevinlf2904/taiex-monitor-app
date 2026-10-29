# 整合修復報告（INTEGRATED_REPAIR_REPORT）

- 分支：`claude/stock-technical-analysis-learner-xjl4e9`
- 基準：HEAD `8a96b82`，與遠端分支同步，比 `origin/main` 多 2 個提交，不落後。這就是 PR #181（draft）目前的 head。
- 本次新增的本機提交（**全部未推送**）：`7df13f5`、`d45656c`、`8794b24`、`aa92e2f`、`ba34ba4`、`1fbfdb2`
- 沒有 Push、PR 修改、Merge、Vercel 部署或環境變數變更；沒有讀取或輸出任何密鑰；沒有呼叫付費 AI API；測試全部使用 mock。

> 本報告只代表本機修復與驗證完成，**不代表可以部署上線**。推送、PR、合併、部署與環境設定，都要使用者另外明確授權。

## 0. 規則與基準（Batch 0）

- 已重新讀取 `AGENTS.md` 與 `.agent/rules/klinelab.md`，兩份內容完全相同，沒有互相衝突。
- 需要注意的規則：
  - 改 `watch.html`／`brief.js`／`core.js` 要先有「鎖」draft PR。PR #181 已經是這幾個檔案的鎖，但它寫的修改邊界沒有涵蓋本次的資金雷達、產業即時、`liveTag`、決策中心狀態判斷。
  - 本任務禁止修改 PR，所以我沒有更新 PR #181 的標題或邊界。合併前需要更新。
- 工作目錄乾淨，沒有使用者未提交的修改。
- 測試基準（HEAD `8a96b82`）：`node tests/run.mjs` 485／485 通過，0 失敗。另有 `tests/e2e/gemini-def.test.mjs` 單獨跑 4／4 通過。

## 1. 修復總表

| 編號 | 狀態 | 提交 | 摘要 |
|---|---|---|---|
| P1-01 行情新鮮度 | 已修 | `7df13f5` | 盤中要有新的來源時間（sourceTime）才是 live；瀏覽器收到的時間不能代替來源時間 |
| P1-02 缺值變 0 | 已修 | `d45656c` | `lots()`、漲跌、法人合併都改成缺值是 null；下游資金雷達與排行略過缺值 |
| P1-03 KV／同步／Telegram | 程式部分已修 | `8794b24` | 分清「沒設定／暫時壞掉／正常」；推播失敗不再擋住重送；基礎設施要使用者手動設定（第 3 節） |
| P2-01 Podcast GET 安全 | 已修 | `aa92e2f` | `act=file` 要帶上傳時發的憑證；每 IP 限流；檔名白名單 |
| P2-02 狀態契約 | 已修 | `ba34ba4` | core、brief、watch 共用同一組 state 和來源權威性 |
| P2-03 上市櫃完整度 | **規格待確認** | `1fbfdb2` | 只補測試，沒改判斷邏輯；兩個方案見第 4 節 |
| PR #181 | 已審查 | — | 實際內容見第 5 節 |

## 2. 各項細節

### P1-01 行情新鮮度（`7df13f5`）

**根因（原始程式碼證據）**

- `api/_lib/_live.js` 的 `deriveDataStatus()` 只看交易時段、日期、完整度與日期驗證。MIS 有 `t`、富果有 `lastUpdated`，但沒有拿來判斷是否過期。
- `misAll` 取「全部列裡最晚的時間」，沒成交股票帶的前一天 13:30 也算進去。
- `learner/watch.html` 的 `liveTag()` 把 `J.at`（瀏覽器收到時間）當成 `fetchedAt`，畫面顯示的「更新於」也是收到的時間。

**修改**

- 新增 `api/_lib/_fresh.js`，定義四種時間，彼此不互相代替：
  - `dataDate`：行情所屬交易日。
  - `sourceTime`：來源自己的更新時間（台北）。
  - `fetchedAt`：伺服器抓取時間。
  - `receivedAt`：瀏覽器收到時間。
- `sourceAt`：台北時間換算 UTC，檢查日期、時間是否合法。
- `sourceFresh`：判斷結果分成 missing、invalid、future、old、fresh 五種。
- 各類資料的延遲門檻 `SRC_LAG`：

  | 類別 | 門檻 | 原因 |
  |---|---|---|
  | 指數 | 3 分鐘 | 每 5 秒更新 |
  | 全市場、排行 | 6 分鐘 | 涵蓋 13:25～13:30 收盤集合競價 |
  | 個股 | 不判斷落後 | 時間是最後成交時間，冷門股本來就很久沒成交；只檢查有沒有、合不合法、是不是未來時間 |

- `deriveDataStatus` 盤中規則：
  - 來源時間 fresh 才是 live。
  - 沒有時間、時間過舊：delayed。
  - 未來時間、格式錯：degraded。
  - 呼叫端沒提供來源時間：一律當成沒有證據。
- MIS 與富果只取「那一天」最新的來源時間；回傳多了 `sourceState`、`sourceAgeSec`。
- `learner/core.js` 的 `evalDataStatus`：
  - 新增 `receivedAt`；`fetchedAt` 保留伺服器時間。
  - 判斷「前端是否還在更新」用 receivedAt；判斷「來源新不新」用 sourceTime（`twSourceFresh`，與伺服器同一套規則，測試檢查兩邊門檻一致）。
- `watch.html`：
  - `liveTag` 傳 `receivedAt=J.at`、伺服器 `fetchedAt` 與 `sourceTime`。
  - 「更新於」改為顯示來源時間；收到時間放在 title。
  - 產業即時（W.irt）也改傳來源時間。

**行為差異**

- 以前：盤中只要日期是今天、資料完整，瀏覽器一收到就顯示「盤中即時」。
- 現在：還要來源時間在門檻內。
- 收盤後的確認資料仍是「收盤確認」，不會變成即時。

**測試**

- `tests/live-state.test.mjs` 新增 6 項：
  - 台北時間與 UTC 換算、跨午夜、無效日期時間。
  - 最新、過舊、前一交易日、缺時間、無效時間、未來時間、時鐘誤差。
  - 前後端判斷結果一致。
  - MIS 盤中：來源時間新、過舊、缺時間、未來時間；沒成交股票帶前一天時間不算。
  - 富果 `lastUpdated` 過舊；`fetchedAt` 不能代替來源時間。
  - 前端：瀏覽器剛收到（receivedAt＝現在）的過期資料不是 live；舊快取重新取得一樣是舊的；前一交易日、週六、收盤後都不是 live。
- 已證明：單純更新 receivedAt 不會讓過期資料變成 live。

**修改了既有測試（說明，不是放寬斷言）**

- 有幾個盤中情境原本期待「沒有來源時間也是 live」，這正是本次要修的缺陷。
- 處理方式：
  - 在 fixture 補上真實來源一定會帶的時間（MIS 的 `t`），並改用與 fixture 一致的固定時鐘（`createHarness({ now })`）。原本用的是跑測試當下的真實時間。
  - 每處都另加一條更嚴格的斷言：「同一筆資料沒有來源時間就不是 live」。
- `watch-hot`「舊版相容 C1」原本斷言「只有日期是今天就允許即時」，與規格要求相反。現在改為「有來源時間才是即時」，另加 C1b「只有日期是今天 → delayed」。

**影響範圍**

- 盤中沒有來源時間的資料會顯示「資料延遲」，例如個股當天沒成交、本益比之類的日資料。這是刻意的保守行為。
- 有來源時間的即時行情不受影響。

### P1-02 缺值不轉成 0（`d45656c`）

**根因**

- `api/_lib/daily.js`：
  - `lots()` 解析失敗回 0。
  - 漲跌價差解析不到時用 `|| 0`，漲跌幅變成 0%。
  - `mergeDay` 對法人資料裡沒有的股票補 `[0, 0, 0]`。
- 下游 `learner/flows.js` 用 `f + tr + dl`、`v || 0`，把缺值當成 0。
- `scripts/market-after.mjs` 的 `buildRanks` 加總時也把缺值當 0。

**修改**

- `daily.js`：
  - `lots()` 遇到 null、空字串、`--`、非數字回 null；真正的 0 保留。
  - 漲跌拿不到時漲跌幅是 null；平盤 0.00 照常是 0。
  - `mergeDay` 對沒有法人資料的股票補 `[null, null, null]`。
  - API 格式不變：仍是同樣的陣列，只是值可以是 null。
- `flows.js`：
  - 個股金額 null 表示沒有資料；板塊只加有資料的股票。
  - 異常倍數、情緒的淨買超都略過缺值。
  - `flowFmt(null)` 顯示 —。
- `market-after.mjs`（排程排行）：缺值欄位不輸出、不進排行；部分缺值只加有的。改的是產生資料的程式，沒有手改 `learner/data/`。
- `watch.html`：板塊成員表、產業即時遇到缺值顯示 —、排在最後。
- K 線的 vNa 處理沒有動。

**測試**：unit 新增 2 項。

- 成交量 0、null、`--`、空字串。
- 法人缺失、法人真正 0、部分缺失、整份法人缺失。
- `buildRanks` 略過缺值。
- `flowModel`、`flowStocks`、`flowMood` 遇到 null 的行為。

**影響範圍**：`/api/daily` 的 rows 會出現 null。有讀這些 rows 的地方（資金雷達、排程排行、廣度）都已檢查並處理。

### P1-03 KV、同步、Telegram、限流（`8794b24`）

**程式部分：檢查結果與修改**

- `_limit.js`：
  - 已經是保守的記憶體降級：每 IP 上限減半、每日上限剩十分之一；KV 失敗不放行；容量滿時拒絕。
  - 程式沒改，補了測試。
  - 記憶體限流只在單一執行個體內有效，不是全站統一配額。註解原本就寫清楚，`cfg` 現在也回報 `limiter: "per_instance"`。
- `sync.js`：
  - 沒設定 KV：回 `reason: "not_configured"`。
  - KV 錯誤：回 `reason: "unavailable"`，`ok: false`，不會回報成功（測試確認資料沒寫入）。
  - `tgtest` 原本沒檢查 Telegram 有沒有設定，失敗時回「暫時連不到」，容易誤導。現在 `tgtest`、`tgbind` 沒設定時回 `tg_not_configured`，而且不會呼叫 Telegram。
  - `cfg` 多回 `limiter: shared / per_instance`；只回狀態，不回任何設定值。
- KV 恢復：每次請求都重新讀設定與連線，測試確認恢復後同一種請求馬上成功，不用重新部署。
- `scripts/alerts-push.mjs`（新發現的問題）：
  - 原本先寫「今天已送」記號再送 Telegram，送失敗也不會重送。
  - 改為送失敗就刪掉記號（`markThenSend`；追蹤申報的 seenf 記號一起清），下一次排程會重送；並統計失敗則數。

**測試**：sync.test 新增 3 項。

- 沒設定 KV／KV 失敗／KV 恢復。
- Telegram 沒設定。
- 推播失敗後清掉已送記號。
- 記憶體限流的上限與降級。

### P2-01 Podcast GET 安全性（`aa92e2f`）

**根因**

- `GET /api/podcast?act=file&name=files/xxx` 只檢查檔名格式，沒有限流，也沒有綁定上傳者。
- 只要猜到檔名，就能查到別人上傳檔案的狀態與 `uri`。

**修改**

- `upload` 回傳 `exp`、`tok` 查詢憑證，48 小時內有效：
  - 用伺服器 Gemini 金鑰導出的子密鑰，對「檔名｜到期時間」做 HMAC 簽章。
  - 金鑰本身不外流，不需要新環境變數。
- `act=file` 的處理順序：
  1. 檔名白名單：只收 `files/英數-`，64 字以內，擋掉 `../`、`/`、`?`、`%2F`。
  2. 每 IP 限流：新增 `podcast-file` 限額，每小時 240 次、每天 20000 次；沒有 KV 時照舊減半。
  3. 驗證憑證：沒有、錯誤、過期、改到期時間、拿 A 檔的憑證查 B 檔、用別的金鑰簽的，都回 403，**而且不會打到 Gemini**。
  4. 檔案不存在（404）、Files API 連不到，各自回明確訊息，錯誤訊息不含金鑰。
- `learner/podcast.js` 輪詢時帶上 exp、tok。

**測試**：unit 新增 1 項，涵蓋：

- 正常查詢、缺檔名、非法檔名、路徑穿越。
- 未授權（6 種情況）。
- 不存在的檔案、服務暫停、超過限流。
- mock fetch，沒有呼叫 Gemini。

**剩餘風險**

- `POST act=sum` 帶 `uri` 時還沒要求憑證，知道別人檔案 uri 的人仍可拿來整理。這個請求本身有 AI 限流。
- 沒有一起改的原因：排程 `scripts/podcast-sync.mjs` 用 GitHub secrets 的金鑰自己上傳，再呼叫網站整理。如果兩邊金鑰值不同，加上驗證後排程會壞。
- 建議等使用者確認兩邊用同一把金鑰後再加。

### P2-02 共同資料狀態契約（`ba34ba4`）

**根因**

- `core.js` 用 live／confirmed／delayed／pending，`brief.js` 用 official／verified／unverified／partial／stale，兩套判斷規則不同。
- `brief.js` 的具體問題：
  - 盤中只要沒標 delayed 就是 live，不看來源時間。
  - Yahoo 等第三方來源被設成 `sourceVerified: true`。
  - 法人資料沒有日期也宣稱「官方收盤」。
  - 最後一個 return 把來源字串塞進 `sourceVerified`。
  - 休市日顯示最近交易日收盤時是「stale」，core 卻是「confirmed」，兩邊矛盾。

**修改**

- `core.js` 建立共同契約：
  - `DATA_STATES` 固定優先順序（越前面越嚴重）：

    | 順序 | state | 意思 |
    |---|---|---|
    | 1 | unavailable | 沒有資料 |
    | 2 | unverified | 證據不足（日期不一致、格式錯、未驗證） |
    | 3 | stale | 交易日期過舊 |
    | 4 | partial | 部分資料 |
    | 5 | delayed | 延遲（來源時間落後、抓取失敗） |
    | 6 | pending | 待確認（盤前、盤後待公布） |
    | 7 | confirmed | 收盤確認 |
    | 8 | live | 盤中即時 |

  - `canonDataState`：把各模組原本的詞對應到上表；不認得的一律當成 unverified。
  - `worseState`：合併時取最嚴重的。
  - `sourceAuthority`：official／third_party／unknown。
  - `evalDataStatus` 回傳多了 `state`、`authority`。
- 新鮮度（state）、完整度（completeness）、來源權威性（authority）分開記錄，不互相代替。
- `brief.js` 的 `evaluateDataStatus` 包一層：
  - state 取「core 對加權本身的判斷」與「決策中心另外的條件」中較差的那個，所以不會比看盤頁樂觀。
  - 盤中來源時間不夠新就改成延遲。
  - 第三方來源 `sourceVerified: false`，文字改成「收盤（第三方來源）」。
  - 法人沒有日期不宣稱官方定案。
  - `sourceVerified` 一律是布林。
  - 傳入 `lastTradeDate`：休市日顯示最近交易日收盤時是 confirmed。
- 畫面上的 dataStatus／dataStatusLabel 文字保留。

**測試**：watch-hot 新增 1 項。同一份輸入在 core（evalDataStatus）、brief（evaluateDataStatus）、watch（liveTag）三處比對，涵蓋 5 個情境：

- 盤中新資料。
- 盤中來源時間 20 分鐘前。
- 盤中沒有來源時間。
- 收盤後官方資料。
- 休市日顯示最近交易日。

另外驗證：brief 不比 core 樂觀、法人未公布、第三方來源、法人沒有日期、優先順序。

**尚未做**：伺服器 `_live.js` 的 dataStatus 詞彙沒有改名（degraded 等），由前端 `canonDataState` 對應。

### P2-03 上市櫃完整度（`1fbfdb2`，規格待確認，**行為未改**）

**現行規則**：complete 要同時符合：

- 全市場覆蓋率 ≥ 95%（估計母體：上市 1000＋上櫃 800）。
- 上市 ≥ 800 檔、上櫃 ≥ 600 檔。
- 日期一致而且驗證過。

**會被掩蓋的情況**

- 上櫃只有 720/800＝90%，但全市場 1720/1800＝95.6% → 判成 complete。
- 上市 900/1000＝90% 時也一樣。

**兩個方案**

| | A：維持現狀 | B：上市、上櫃各自 ≥ 95% |
|---|---|---|
| 規則 | 全市場 95%，加上各市場最低檔數 | 各自覆蓋率 ≥ 95%，才是 complete |
| 優點 | 盤中比較少出現「資料延遲」 | 單一市場缺漏不會被掩蓋 |
| 缺點 | 單一市場最多可缺約 10%～25% 仍算完整 | 櫃買 MIS 偶發缺批時，盤中會比較常顯示延遲；資金雷達、選股、熱門股等用到 complete 的地方都受影響 |
| 程式改動 | 無 | `validateMarketRows` 一個條件，加上更新測試 |

**已做**：補了明確情境的測試（雙市場都完整、只有一邊、兩邊都不足、筆數不足、部分批次失敗）。模糊情境用 `todo` 測試記錄現況，不算失敗。請使用者選方案後再改。

## 3. 需要使用者手動設定（我沒有做任何設定）

| 功能 | 環境變數名稱（只列名稱） | 放在哪裡 |
|---|---|---|
| 雲端同步、全站統一 AI 限流、Chat 共用快取、盤中巡檢事件 | `KV_REST_API_URL`、`KV_REST_API_TOKEN`（或 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`） | Vercel 專案 → Storage → 連接 Upstash for Redis，會自動加入。至少要有 **Production**；要在 PR 預覽網址測同步，也要勾 **Preview** |
| Telegram 推播（網頁綁定、測試訊息） | `TELEGRAM_BOT_TOKEN` | Vercel **Production**（Preview 視需要） |
| 收盤後推播排程（`alerts-push.yml`）、盤中巡檢 | `KV_REST_API_URL`、`KV_REST_API_TOKEN`、`TELEGRAM_BOT_TOKEN` | GitHub → Settings → Secrets and variables → Actions（要和 Vercel 用同一個 Upstash） |
| Podcast 聽完整集（已存在，P2-01 的憑證也用它簽） | `GEMINI_API_KEY` | Vercel Production；排程用的 GitHub secret 建議和網站同一把金鑰，之後才能讓 `act=sum` 也驗證憑證 |

- 設定後要重新部署 Vercel。
- 程式會自動恢復：`cfg` 會變成 `kv: true`、`limiter: "shared"`。

## 4. 測試結果

| 檢查 | 指令 | 結果 |
|---|---|---|
| 基準（修改前，HEAD 8a96b82） | `PW=/opt/node22/lib/node_modules/playwright node tests/run.mjs` | 485／485 通過 |
| 單元 | `node tests/unit.test.mjs` | 153 通過、0 失敗 |
| 狀態（伺服器） | `node tests/live-state.test.mjs` | 49 通過、0 失敗、1 todo（P2-03 待確認） |
| 前端狀態 | `node tests/watch-hot.test.mjs` | 70 通過、0 失敗 |
| 同步／限流 | `node tests/sync.test.mjs` | 11 通過、0 失敗 |
| 完整測試（修改後，HEAD 1fbfdb2，含 e2e 瀏覽器測試） | `PW=/opt/node22/lib/node_modules/playwright node tests/run.mjs` | 505 項：504 通過、0 失敗、1 todo（P2-03），結束碼 0 |
| 語法檢查 | `node --check`（api、scripts、learner 全部 .js／.mjs）＋所有 html 內嵌 script | 全部通過 |
| 建置 | — | 不適用：專案沒有 build 步驟（靜態網站＋Vercel 函式；package.json 只有 dev） |

最終完整測試：505 項，504 通過、0 失敗、1 todo（P2-03 規格待確認，不算失敗），結束碼 0；瀏覽器 console 錯誤檢查包含在 e2e 內，全部通過。

另外檢查：本次差異沒有密鑰樣式字串；沒有修改 `learner/data/`；沒有無關檔案（17 個檔案都與 P1-01～P2-03 有關）。新增的 null 處理已有測試涵蓋：缺值顯示 —、排序排最後、加總略過；`flowMood` 不會出現 NaN。

## 5. PR #181 審查與整合建議

**實際狀態**

- draft，`mergeable_state: clean`。
- head `8a96b82`，2 個提交，16 個檔案，+219／−60。

**實際內容，不只 4 個檔**

- 第 1 個提交（DEF-07，去投顧化）：
  - `api/_lib/screen.js`、`learner/analysis.js`、`learner/quant.js`、`learner/watch.html`。
  - K 線型態改成客觀名稱，移除「偏多／偏空」綜合標籤與指標儀表，買賣指示改寫。
- 第 2 個提交（DEF-02、05、06、10、12）：
  - 盤後分析日期落後的提醒。
  - 美股盤後價與時區標示。
  - ⓘ 口徑說明。
  - 三步新手指引。
  - 寬版抽屜、存股參數收合、骨架屏。
  - 另含 `api/_lib/_yahoo.js`、`usmarket.js`、`core.js`、`brief.js`、`tools.js`、`congx.js`、`savings.html`、`scripts/_engine.mjs` 與測試。

**是否解決原始缺陷**

- DEF-07 只處理了個股抽屜的綜合標籤與型態名稱。仍然存在：
  - 選股的「綜合評分」排行（`watch.html` 的 `stockScore`，技術 30%、籌碼 30%、題材 20%、基本 20%），有「強／弱」排序。
  - 個股頁「綜合評分 N」卡片。
  - 「偏多／偏空」字樣約 121 處，大多在 K 線學堂課程（lessons-*.js、index.html）與總經說明（macrox.js、api/_lib/macro.js）。
  - 「買進訊號／賣出訊號」17 處（課程與型態說明）。
- 改掉「看多／看空」用詞，**不等於**已解決投資建議的合規風險。
- 是否構成台灣證券投資顧問業務，需要法律審查。技術上只能提供上面的事實清單，我不做合規保證。

**整合建議**

1. 本機 6 個提交與 #181 屬於同一個分支，沒有重複實作。
   - P2-02 的 brief 狀態包裝與 DEF-02 的日期提醒（`tdStaleNote`）是兩件事，可以並存。
2. 合併前要更新 #181 的「修改邊界」：本次動到 `watch.html` 的資金雷達、產業即時、`liveTag`，以及 `brief.js` 的狀態判斷、`flows.js`、`podcast.js`、`api/_lib/*`、`scripts/*`。
   - 或者把 P1／P2 另開一個 PR，避免一個 PR 做太多事（AGENTS.md：一個 PR 只做一件事）。
3. P1-01、P2-02 屬於「資料狀態」高風險修改，依 AGENTS.md 要另一位獨立審查（建議 Codex）。
4. 後續待辦：
   - 選股綜合評分排行的去投顧化或改名（例如改成「指標統計」而不是評分排序）。
   - 課程與總經用詞需要法律審查。
   - P2-01 `act=sum` 的憑證驗證。
   - P2-03 規格選擇。

## 6. 部署前檢查清單

- [ ] 使用者授權推送本機 6 個提交，並決定是併入 #181 還是另開 PR。
- [ ] 更新鎖 PR 的修改邊界，或另開 PR。
- [ ] 獨立審查 P1-01、P2-02（狀態判斷）與 P2-01（安全）。
- [ ] P2-03 選定規格。
- [ ] Vercel：連接 Upstash（Production／Preview）、設定 `TELEGRAM_BOT_TOKEN`，重新部署；GitHub secrets 同步。
- [ ] 預覽網址實測：盤中「盤中即時／資料延遲」標籤是否合理（注意 13:25～13:30 集合競價）；資金雷達缺值顯示 —；Podcast 整集整理流程（上傳 → 輪詢 → 整理）。
- [ ] 合併前跑 `node scripts/bump-version.mjs`（影響網站）與完整測試；CI `test` 綠燈。

## 7. 後續建議

- 伺服器端也輸出共同 `state`（在 `_fresh.js` 放同一份對照表），減少前端對應。
- 個股的「最後成交時間」與「報價更新時間」分開。MIS 沒有另外提供報價更新時間，可以用 `fetchedAt` 搭配 `sourceAgeSec` 顯示。
- 資金雷達在法人缺值比例高時，加上「X 檔法人資料缺」的提示。
