# TAIEX Monitor 產品架構、UI／UX 與功能升級規劃

> 階段：研究、設計、規劃（未修改任何既有程式碼）
> 撰寫：Claude Code，2026-10-25（台北）
> 依據：`kevinlf2904/taiex-monitor-app` main `6617908`（最後一個程式變更是 PR #155 合併 `cddd82e`），網站版本 `2026.10.24-158`
> 標記：**EXISTS** 已確認實作／**PARTIAL** 部分實作／**MISSING** 確認不存在／**UNKNOWN** 證據不足

---

## 0. 一頁摘要

**最重要的三個發現**

1. **後端目前沒有任何盤中背景工作。** 所有排程都在收盤後或盤前（07:40 早報、14:05 之後）。盤中的偵測全靠「頁面開著時」的前端輪詢（`learner/watch.html:1528` `schedule()`：開盤時每 1 秒更新報價、每 5 秒完整更新；頁面隱藏就停）。
2. **正式網站的雲端儲存與 Telegram 都沒啟用。** 唯讀查詢 `GET /api/sync?op=cfg` 回 `{"kv":false,"tg":false}`。所以事件持久化、跨裝置同步、伺服器推播目前都不能用，是盤中監控的硬性前置條件。
3. **今日重點（PR #153–#155 改成「每日市場決策中心」）資訊很完整，但版面是「盤前＋盤後全部堆疊」。** 手機上很長；資金流向在同一頁出現兩次；自帶一套行內 CSS 與色彩（靛藍 `#6366f1` 等），偏離全站黑白灰＋紅綠的設計系統。

**建議方案（首選）**

- 四大主導覽不變。情報局分頁改成：**今日市場**（由「今日重點」改名，沿用 `#daily`）→ **盤中監控**（新分頁 `#monitor`）→ 專業工具（資金雷達、財報、供應鏈、大戶國會、節目）。ETF 留在看盤。
- **今日市場**改成「摘要層固定在上方、時段面板三選一、細節收合」的三層結構。時段面板用全站已有的 `.seg` 分段鈕（盤前／盤中／盤後），預設跳到目前時段。內容不再全部堆疊。
- **盤中監控**分兩步：
  - **M1（不需要新服務）**：前端監控＋事件模型＋本機持久化，畫面上明講「頁面開著才監控」。
  - **M2（需要接上 Upstash）**：伺服器每 1～2 分鐘掃一次，事件寫入 KV，Telegram 推播。排程首選 **Upstash QStash**，備案是 GitHub Actions 每 5 分鐘。
- 共用基礎先做：交易時段判斷統一（目前有 4 套）、資料新鮮度標籤統一、決策中心樣式搬進 `core.css` 並對齊色彩規範。

---

## 1. 專案現況與版本

| 項目 | 狀態 | 證據 |
|---|---|---|
| Repository | `kevinlf2904/taiex-monitor-app`（公開） | git remote |
| 產品名稱 | 網站品牌是「**KLineLab K線情報局**」，Repo 名稱是 taiex-monitor-app；指令中的「TAIEX Monitor」沒有出現在網站上 | `learner/index.html` 標題、`AGENTS.md` |
| 分支／HEAD | `claude/stock-technical-analysis-learner-xjl4e9` = `origin/main` = `6617908`，工作目錄乾淨（本文件除外） | `git status` |
| 版本 | `2026.10.24-158`（`learner/version.json`、`index.html`、`watch.html` 一致）；正式網站 `/learner/version.json` 也回 -158 | 唯讀 GET |
| 部署 | Vercel 專案 `klinelab`（團隊 minj），正式網域 `kline-school.vercel.app`，最新正式部署 READY | Vercel API 唯讀查詢 |
| 未合併分支 | `gemini/*`（4 條，都已合入 main）、`vercel/install-vercel-web-analytics-*`（PR #149 已關閉）、`gemini/project-optimization`、`claude/agent-collab-workflow`（舊） | `git branch -r` |
| CI | GitHub Actions `ci.yml` 跑 `tests/run.mjs`（單元＋Playwright）；main 最新一次成功 | Actions 紀錄 |
| 本機測試 | 2026-10-24 在 main 跑完整測試：232 通過、0 失敗 | `PW=… node tests/run.mjs` |

**程式規模**：`watch.html` 5,944 行、`index.html` 5,095 行、`brief.js` 1,795 行、`core.js` 1,369 行、`tools.js` 1,016 行，另有約 40 支延後載入的分頁 JS；`api/_lib/` 47 支 API；`scripts/` 39 支；排程 workflow 26 支。

---

## 2. 掃描範圍與限制

**已檢查**
- 主導覽與路由：`index.html`（`TABS`、`goTab`、`switchTab`、`INTEL_RE`）、`watch.html`（`INTEL_LT`、`ltMode`、`ROUTES`、`applyRoute`、`routeOf`、`setLt`、`WIDE_TABS`）。
- 今日重點／決策中心：`brief.js` 全部函式清單，`todayPage`、`briefScenarios`、`sessionStatus`、`evaluateDataStatus`、`validatePlan` 細讀。
- 更新機制：`watch.html` 的 `tick`、`fastTick`、`schedule`、`checkAlerts`、`notify`；`tools.js` 的 `irCheck`、`irStart`；`brief.js` 的 `evCheck`、`evStart`。
- 後端：`api/_lib/_live.js`、`quote.js`、`intraday.js`、`futures.js`、`market.js`、`news.js`、`official.js`、`sync.js`、`status.js`、`_limit.js` 的開頭與介面。
- 排程：26 支 workflow 的 cron；`market-scan.yml`、`morning-brief.yml`、`scripts/alerts-push.mjs`、`scripts/morning-brief.mjs`。
- 設計系統：`core.css` 色彩 token、主題切換；決策中心行內樣式。
- 實際畫面：用測試假資料，在 390 與 1280 寬度截圖檢查今日重點。
- 正式環境：唯讀 GET `/api/status`、`/api/sync?op=cfg`、`/learner/version.json`。

**未檢查或只看到一部分**
- K線學堂 34 個課程與練習的內部邏輯：只盤點入口，沒有逐一追查。
- 存股模擬（`savings.html` 941 行）：只看區塊導覽與嵌入方式。
- 供應鏈、財報、節目、大戶國會：只確認入口與路由，沒有深入。
- 真實盤中資料：開發環境連不到證交所、Yahoo，今天又是週末，沒看到盤中真實畫面，盤中行為都依程式碼推斷。
- 沒有在實體 iPhone 或 iPad 上測試，只用 Playwright 模擬寬度。

---

## 3. 現有功能清冊

### 3.1 主導覽與入口

| 功能 | 狀態 | 進入方式 | 實作位置 |
|---|---|---|---|
| 四大主導覽 情報局／看盤／K線學堂／存股 | EXISTS | 頂部 `nav.tabs` | `index.html:600-604` |
| 情報局（嵌入 `watch.html?mode=intel`） | EXISTS | `#intel`、`#daily`、`#radar/…` 等 | `index.html:4922,4946`；`watch.html:1238` |
| 看盤（嵌入 `watch.html?mode=watch`） | EXISTS | `#watch` | 同上 |
| K線學堂子導覽：課程、AI 截圖診斷、圖表實驗室、判讀挑戰、觀念測驗、畫線練習 | EXISTS | `#schoolNav` | `index.html:642` |
| 存股（嵌入 `savings.html`） | EXISTS | `#savings` | `index.html:913-919` |
| 首頁簡介（手機預設收合） | EXISTS | 情報局上方 | `index.html:5020-5068` |
| 分頁自訂順序與隱藏 | EXISTS | 分頁列「⚙ 自訂」 | `tests/e2e/tabcfg.test.mjs` |

### 3.2 情報局（mode=intel）

| 分頁 | 狀態 | 路由 | 主要資料 |
|---|---|---|---|
| 今日重點（決策中心） | EXISTS | `#daily` | `brief.js` `todayPage`；`/api/usmarket`、`/api/futures`、`/api/calendar`、`/api/quote`、`/api/daily`（法人） |
| 資金雷達（今日／動能矩陣／排行／回放） | EXISTS | `#radar/…` | `flows.js`、`/api/daily` |
| 財報 | EXISTS | `#earnings/…` | `earn.js`、`earnplus.js`、`finrep.js` |
| 大戶國會（美國國會、台灣、13F、內部人、回測） | EXISTS | `#congress/…` | `congx.js`、`learner/data/*` |
| 供應鏈（題材、網路、圖解、新聞、收藏） | EXISTS | `#supply/…` | `industry*.js`、`figx.js` |
| 節目 | EXISTS | `#podcast/…` | `podcast.js` |
| 盤中監控 | **MISSING** | — | — |

### 3.3 看盤（mode=watch）

| 分頁 | 狀態 | 備註 |
|---|---|---|
| 自選（含今日重點卡 `#todayCard`、自選異動） | EXISTS | `watch.html:1052`、`brief.js:1686 renderToday` |
| 庫存（風險分析、匯入） | EXISTS | `hold.test.mjs` |
| 工具：提醒、筆記追蹤、模擬交易、交易日記、多圖並排、官方資料、備份同步 | EXISTS | `tools.js:5 TOOLS_VIEWS` |
| 大盤：台股大盤、上市、櫃買、官方公告、美股大盤、原物料外匯、總經消息、總經數據、預測市場、行事曆 | EXISTS | `watch.html:4431` `mkReg` |
| 選股（條件、RS、多因子、全市場） | EXISTS | `screen` |
| ETF | EXISTS | 屬於看盤模式，不在情報局 |
| 排行 | EXISTS | `rank` |
| 個股頁：走勢、技術、籌碼、財務、新聞＋AI 影響、市場狀態卡 | EXISTS | `watch.html` 個股詳情 |

### 3.4 早報、今日重點、每日市場資訊（本次整合的候選範圍）

| 項目 | 狀態 | 證據與說明 |
|---|---|---|
| 早報（網頁） | EXISTS | `brief.js:48 briefParts`、`:132 briefBody`；資料由 `briefLoad` 抓 |
| 早報（Telegram 07:40） | PARTIAL | `morning-brief.yml`＋`scripts/morning-brief.mjs`，程式完整，但正式環境 `kv:false, tg:false`，**目前送不出去** |
| 每日摘要（盤後） | EXISTS | `tools.js` `sumBody`、`sumBuild`、`sumFlowHtml` |
| 決策中心：狀態列、核心市場卡、結論、情境推演、盤後驗證、資金雷達摘要、下一步 | EXISTS（PR #153–155） | `brief.js:1109-1395`、`1423 todayPage` |
| 盤前預測快照 | EXISTS（只存本機） | `brief.js:210/224`，localStorage `watch:brief:snap:<日期>` |
| 交易時段判斷 | PARTIAL（**4 套並存**） | `api/_lib/quote.js:20 session()`、`watch.html:1508 twClosedNote`、`brief.js:141 tdAfter`、`brief.js:241 sessionStatus` |
| 國際市場與總經 | EXISTS | 看盤→大盤（美股、原物料外匯、總經消息、總經數據、預測市場）；今日重點的核心卡與早報也各有一份 |
| 重要新聞 | PARTIAL | `api/_lib/news.js` 是逐檔查 Google News RSS 標題，沒有全市場新聞流 |
| 公司公告（重大訊息） | PARTIAL | `api/_lib/official.js` 讀 OpenAPI 每日重大訊息，**不是即時** |
| 族群強弱 | EXISTS | 大盤的產業熱度 `irt`（`watch.html:1489-1496`）、資金雷達 |
| 法人資金流向 | EXISTS（收盤後） | `/api/daily`、`flows.js`；當日法人資料 17:40 後才完整 |
| 自選／持股重要變化 | EXISTS | 今日重點卡、`todayParts`、`evScan` |
| 下一交易日觀察清單 | PARTIAL | `nextActionHtml` 只有文字建議，沒有可勾選、可帶到隔天的清單 |

### 3.5 盤中監控相關能力

| 能力 | 狀態 | 證據 |
|---|---|---|
| 前端即時報價輪詢 | EXISTS | `watch.html:1528 schedule()`：開盤時每 1 秒（`fastTick`）、每 5 秒完整（`tick`）；收盤後每 5 分鐘；頁面隱藏就暫停 |
| 全市場快照（上市櫃每檔） | EXISTS | `api/_lib/_live.js`（富果快照 → MIS → 收盤行情 → OpenAPI） |
| 加權／櫃買分時 | EXISTS | `api/_lib/intraday.js`（`code=t00`、`spark=1`） |
| 台指期日盤／夜盤 | EXISTS | `api/_lib/futures.js` |
| 價格提醒（到價） | EXISTS（前端） | `watch.html:5797 checkAlerts()`，每次 tick 檢查 |
| 指標提醒 | EXISTS（前端每 5 分鐘、伺服器收盤後） | `tools.js:44 irCheck`、`:52 irStart`；`alerts-push.mjs` |
| 事件提醒（營收、三率、法說會、ETF 換股） | EXISTS（前端每 2 小時、伺服器收盤後） | `brief.js:101-112`；`alerts-push.mjs` |
| 本機通知 | EXISTS | `watch.html:5791 notify()`：toast＋震動＋Service Worker 通知（加到主畫面的 iOS 也可以用） |
| Telegram 推播 | PARTIAL | `api/_lib/sync.js` `tg()`；正式環境 `tg:false` |
| 伺服器盤中排程 | **MISSING** | 26 支 workflow 沒有任何一支在 09:00–13:30 執行 |
| 事件模型、事件持久化、事件生命週期 | **MISSING** | 提醒只有「送過了」的去重（`sent:<id>:<日期>`），沒有事件物件 |
| 資料源健康度 | PARTIAL | `W.err`、`W.lastOk`、錯誤紀錄（`watch.html:1330`）、「資料來源狀態」只檢查金鑰（`watch.html:4077`）；沒有逐來源的最後成功時間與延遲 |
| 期現貨背離 | PARTIAL | 有期貨與現貨報價，沒有偵測邏輯 |
| 成交量異常 | PARTIAL | 有即時量；沒有「同一時間點的歷史平均量」，只能跟前幾日全天均量粗略比較 |
| 盤後驗證 | PARTIAL | 決策中心的 `validatePlan` 只驗證盤前情境，不驗證盤中事件 |
| 歷史回放、跨日追蹤 | MISSING（事件）；資金雷達有自己的 20 日回放 | — |

### 3.6 K線學堂與存股

| 項目 | 狀態 | 備註 |
|---|---|---|
| 課程（含型態、指標、趨勢理論；今日符合型態的個股） | EXISTS | `lessons-*.js`、`scripts/pattern-today.mjs` |
| 圖表實驗室、判讀挑戰、觀念測驗、畫線練習、AI 截圖診斷 | EXISTS | `index.html:642` |
| 存股模擬：總覽、部位明細、淨值走勢、里程碑、壓力測試與配置、標的比較、股息計算機 | EXISTS | `savings.html:337` |
| 真實持倉 vs 模擬的區分 | PARTIAL | 庫存（看盤）是使用者輸入的真實持倉；存股是試算。畫面有分開，但「庫存」的範例組合（`demo`）與真實持倉混在同一份資料，要靠 `demo` 旗標區分（`brief.js:74`） |

---

## 4. 現況資訊架構

```
首頁（index.html）
├─ 情報局（iframe watch.html?mode=intel）
│   ├─ [首頁簡介 抽屜]
│   ├─ 今日重點 #daily ── 決策中心（狀態列、核心卡、盤前區、盤後區、資金雷達摘要、Telegram）
│   ├─ 資金雷達 #radar ── 今日｜動能矩陣｜排行｜回放
│   ├─ 財報 #earnings
│   ├─ 供應鏈 #supply
│   ├─ 大戶國會 #congress
│   └─ 節目 #podcast
├─ 看盤（iframe watch.html?mode=watch）
│   ├─ 自選（＋今日重點卡、自選異動）
│   ├─ 庫存
│   ├─ 工具 ── 提醒｜筆記追蹤｜模擬交易｜交易日記｜多圖並排｜官方資料｜備份同步
│   ├─ 大盤 ── 台股大盤｜上市｜櫃買｜官方公告｜美股｜原物料外匯｜總經消息｜總經數據｜預測市場（＋行事曆）
│   ├─ 選股、ETF、排行
│   └─ 個股頁（走勢、技術、籌碼、財務、新聞）
├─ K線學堂 ── 課程｜AI 截圖診斷｜圖表實驗室｜判讀挑戰｜觀念測驗｜畫線練習
└─ 存股（iframe savings.html）
```

---

## 5. 現有 UI／UX 設計分析

### 5.1 沿用的設計語言（應保留）

- **色彩**：黑白灰分層（`--bg`、`--surface`、`--surface-2`、`--surface-3`、`--line`、`--ink`、`--muted`），主色是灰。只有漲跌用顏色：台股慣例**紅漲綠跌**（`--up`、`--down`）。深色、淺色兩套主題（`core.css:2-41`、`144-156`）。
- **字型**：宋體（`--font-song`）同時用於內文與數字；數字搭配 tabular-nums。英數代碼用 `--font-mono`。
- **形狀**：圓角小（`--radius: 4px`），走「無框」的扁平風格（任務紀錄 #27）。
- **元件**：
  - `.seg` 分段鈕（23 處）、`.mkseg` 加分組標籤 `tgrp`（`watch.html:4171`）；
  - `.btn`／`.btn sm`、`.linkbtn` 文字鈕；
  - `.note` 次要文字（32 處）、`.csec` 區塊、`.mcard` 卡片、`.ichip` 小晶片；
  - `foldx.js` 長內容收合與「展開全部」；
  - `openSheet` 底部抽屜、`toast` 提示；
  - `liveTag` 即時或收盤標籤（`watch.html:1516`）、骨架屏（`.skel`）；
  - 錯誤時給「重試」（`.wl-err`）。
- **導覽**：上方分頁列可以橫向滑動、自訂順序；子頁籤用 `.seg`。手機有底部快捷列 `#qbar`（清單、走勢、技術、籌碼、更多）。
- **狀態保存**：分頁、子頁籤、篩選都存在 `store`（localStorage，`kline:` 開頭）；網址 hash 路由可以分享、回上一頁（`navPush`）。

### 5.2 發現的問題

| # | 嚴重度 | 問題 | 證據 |
|---|---|---|---|
| U1 | 中 | **決策中心自帶一套樣式**：在 JS 裡輸出 `<style>`，色彩寫死成 `#2563eb`、`#059669`、`#7c3aed`、`#d97706` 與靛藍 `#6366f1`。這些不在 `core.css` 的 token 裡，換主題、調色盤時不會跟著變，也打破「只有漲跌用顏色」的規範 | `brief.js:1489-1560`、`index.html` `.hero-toggle-btn` |
| U2 | 中 | **今日重點太長**：盤前區＋盤後區＋資金雷達＋早報全文全部展開堆疊。假資料在 390 寬就有 1,424px，真實資料會更長；週末還會同時出現「盤前推演」和「日期不一致無法驗證」 | 截圖、`brief.js:1471-1475` |
| U3 | 中 | **同一頁資金流向出現兩次**：決策中心的「資金雷達」卡（`flowsDecisionHtml`）＋盤後總結（`sumFlowHtml`），抓不到資料時一個寫「載入中」、一個寫「暫時拿不到」 | `brief.js:1347`、`tools.js:290` |
| U4 | 中 | **兩條狀態列**：`.dh-status-bar`（交易狀態＋資料時間）下面又有 `.mkclosed`（休市說明），說的是同一件事；頁首右上角還有第三個狀態（盤中即時紅點） | 截圖 |
| U5 | 低 | **壓力位用綠色、支撐位用紅色**（`.dh-lvl.pres b { color: var(--down) }`），在紅漲綠跌的語境下容易誤讀 | `brief.js` 樣式 |
| U6 | 低 | 決策中心的數字用 `--font-mono`，全站行情數字用宋體 `--font-num`，字型不一致 | 同上 |
| U7 | 低 | 浮動的「‹ 返回」在 390 與 1280 寬都蓋住頁尾的資料來源文字 | 截圖 |
| U8 | 低 | 週末時，今日重點下半段的標題寫「盤中・」（`tdAfter` 只看時間不看是否交易日） | `brief.js:141` |
| U9 | 低 | 情報局分頁列 6 個、看盤 7 個，加上「盤中監控」就是 7 個；手機上靠橫向滑動，第 5 個之後看不到 | 截圖 |

### 5.3 重複的功能與資料

| 重複項 | 出現位置 | 建議 |
|---|---|---|
| 交易時段判斷 | 4 套（見 3.4） | 合併成一個共用函式（前端放 `core.js`）；伺服器保留 `quote.js session()`，但改用同一份休市日曆 |
| 國際指數、美股、台指期夜盤 | 今日重點核心卡、早報、看盤→大盤→美股大盤 | 今日市場只放摘要卡，點了跳到大盤看完整；資料共用 `W.bf`，不要各抓一次 |
| 法人資金摘要 | 今日重點兩處、資金雷達「今日」 | 今日市場盤後面板只留一張摘要卡，連到資金雷達；`sumFlowHtml` 和 `flowsDecisionHtml` 合併成一個 |
| 今日重點卡（自選上方）vs 今日市場 | 看盤、情報局 | 保留：卡片是摘要入口，點「看完整」切到情報局（已實作）。卡片內容改成直接用今日市場的摘要層，不要另外計算 |
| 提醒（工具）vs 盤中監控 | 工具→提醒是使用者自己設的規則；監控是系統偵測 | 責任邊界見 7.1：規則的設定留在工具，觸發後的「事件」統一進監控事件流 |
| 早報全文 vs 決策中心結論 | 今日重點同一頁 | 早報全文收進「詳細」層，預設收合 |

---

## 6. 目標資訊架構

### 6.1 方案比較：盤中監控放哪裡

| 方案 | 優點 | 缺點 | 結論 |
|---|---|---|---|
| A. 情報局新分頁「盤中監控」 | 責任清楚、有自己的網址 `#monitor`、可以單獨分享與通知直達 | 分頁列多一個 | **首選** |
| B. 今日市場裡的「盤中」面板 | 不用新分頁 | 事件列表、事件詳情、健康度塞不下，正好是指令要避免的「換名字再呈現一次」 | 不採用；今日市場的盤中面板只放事件**摘要**，連到 A |
| C. 新的第五主導覽 | 最顯眼 | 違反「四大主導覽不變」，手機頂部擠不下 | 不採用 |

### 6.2 目標架構

```
情報局（mode=intel）
├─ 第一層：市場決策
│   └─ 今日市場 #daily（原「今日重點」改名；#today、#market 也導到這裡）
│        ├─ 摘要層（固定）：狀態與新鮮度｜一句話結論｜核心市場卡｜3 個下一步
│        ├─ 時段面板（三選一，預設目前時段）：盤前｜盤中｜盤後
│        └─ 詳細層（收合）：早報全文｜新聞與公告｜自選訊號｜來源與免責
├─ 第二層：盤中事件
│   └─ 盤中監控 #monitor
│        ├─ 監控狀態與健康度（固定）
│        ├─ 事件列表（篩選：進行中｜全部｜我的股票；嚴重度）
│        ├─ 事件詳情 #monitor/<事件ID>（底部抽屜或右欄）
│        └─ 歷史 #monitor/history（依日期，含盤後驗證結果）
└─ 第三層：專業工具（分頁列用分組標籤「工具」隔開）
     資金雷達｜財報｜供應鏈｜大戶國會｜節目
看盤：不變（自選、庫存、工具、大盤、選股、ETF、排行、個股頁）
     ・自選上方的今日重點卡改名「今日市場」，多一行「盤中監控：N 件進行中」
     ・工具→提醒新增「盤中監控通知」設定
K線學堂：不變；事件詳情可以連到對應課程（例如「爆量長紅」→ 量價課）
存股：不變
```

**變更理由**
- 「今日重點」改名「今日市場」：內容已經是整個市場的決策中心，不只是重點。網址 `#daily` 和存檔鍵 `watch:lt:intel="today"` 都不變，舊連結不會壞。
- 「盤中監控」排第二：盤中最常用；收盤後也要看「今天發生過什麼」。
- 專業工具不搬家：沿用現有路由與使用者習慣，只在分頁列加分組標籤（`.mkseg` 已支援 `tgrp`）。
- ETF 不搬到情報局：它以個股報價與成分股為主，跟看盤的清單、個股頁共用最多元件，搬過去會打斷「點代號 → 個股頁」的流程。

---

## 7. 今日市場（市場決策中心）完整規劃

### 7.1 頁面任務與責任邊界

| 今日市場負責 | 盤中監控負責 |
|---|---|
| 市場全貌、結論、關鍵價位、時段重點 | 「發生了什麼事」的事件流：偵測、證據、演變、驗證 |
| 給事件**摘要**（前 3 件、數量）並連過去 | 事件本體、生命週期、通知紀錄 |
| 盤前情境與盤後驗證（對假設） | 盤中事件的盤後驗證（對事件） |

### 7.2 版面三層結構

**摘要層（一進來就看到，手機約一屏）**
1. **狀態列**：把 `.dh-status-bar` 和 `.mkclosed` 合成一條。
   - 左邊：時段徽章（盤前、盤中、盤後、休市、待確認）＋交易日。
   - 右邊：資料新鮮度標籤（見 9.3）。
   - 休市時加一句「顯示 10/23 收盤；下一交易日 10/26」。
2. **一句話結論**：沿用 `dailyBriefSummaryHtml` 的結論句。資料不足時照現在寫「暫不判定」，不硬下結論。
3. **核心市場卡**：沿用 `coreMarketCardsHtml`。手機改成兩欄小卡加橫向捲動：加權、台指期、費半、那斯達克、TSM；缺資料的卡片縮成一行「資料暫缺」，不佔一整張卡。
4. **下一步**：最多 3 個可點的動作，例如「看盤中監控 2 件進行中」「資金雷達：半導體流入」「你的 2330 跌 3%」。沿用 `nextActionHtml`，改成按鈕。

**時段面板（`.seg`：盤前｜盤中｜盤後，預設目前時段，選擇記在 `store`）**

| 面板 | 內容（依序） | 沿用的函式 |
|---|---|---|
| 盤前（07:00–09:00，或休市日看下一交易日） | 國際市場與夜盤（3 行摘要＋「看大盤」連結）、今天的行事曆（除權息、法說會，★ 我的優先）、關鍵價位與三種情境、持股新消息 | `briefBody`、`briefScenariosHtml`、`briefNear` |
| 盤中（09:00–13:30） | 即時摘要（加權、櫃買、量能對比昨日同時間；資料不足就顯示「無同時段資料」）、族群強弱前 3 與後 3（來自 `irt`）、**盤中事件摘要**（前 3 件＋「看全部」到 #monitor）、自選與庫存異動、情境追蹤（目前在分水嶺上或下） | `todayParts`、`irt`、新的 `monSummary()` |
| 盤後（13:30 之後） | 收盤結構（漲跌家數、量）、族群與資金（**只放一張**，合併 `flowsDecisionHtml` 和 `sumFlowHtml`）、盤前情境驗證、盤中事件驗證摘要、**明日觀察清單**（可勾選、帶到下一交易日的盤前面板） | `validateHtml`、`sumBody` |

**詳細層（`foldx` 收合，預設全收）**：早報全文、新聞與公告（逐檔新聞＋官方重大訊息）、自選股觸發的技術訊號、資料來源、時間與免責。

### 7.3 交易時段與例外

| 情況 | 預設面板 | 處理 |
|---|---|---|
| 交易日 07:00 前 | 盤後（前一交易日） | 狀態列寫「盤前準備中，早報 07:40 更新」 |
| 07:00–09:00 | 盤前 | 推演以**今天**為交易日 |
| 09:00–13:30 | 盤中 | 盤前快照鎖定，不可覆寫（沿用 `saveBriefSnapshot` 的規則） |
| 13:30–17:40 | 盤後 | 法人資料未齊時，資金卡顯示「法人資料 17:40 後公布」，不顯示空白 |
| 週末、國定假日 | 盤後（最近交易日）＋盤前（下一交易日） | **修正**：推演改以下一交易日為目標日，不再替休市日產生快照（現在的問題見 U2） |
| 行事曆抓不到 | 待確認 | 沿用 `sessionStatus` 的「待確認」降級 |
| 颱風假等臨時休市 | 盤後 | 報價日期停在前一日時，判定休市（已有 `twClosedNote` 的邏輯） |

### 7.4 與現有 UI 的相容

- 「重新整理」「AI 整理」「複製文字」三顆按鈕位置不變，複製文字改成只複製目前面板加摘要層。
- 分享圖卡（`sharecard.js`）的路由不變（`routeOf` 回 `daily`），之後可以加 `daily/pre|live|post`。
- Telegram 一鍵綁定（`tgOneHtml`）保留，只在 `kv && tg` 時出現（現狀）。
- 舊網址 `#daily` 不變；`W.tv` 舊值「today、brief、sum」照樣帶到這頁（PR #151 已實作）。

---

## 8. 盤中監控完整規劃

### 8.1 可監控項目（依現有資料判斷）

| 監控項目 | 資料來源 | 可行性 | 說明 |
|---|---|---|---|
| 加權指數異常波動（漲跌幅跨越 ±1%／±2%、5 分鐘內變動超過門檻） | `/api/quote`（T00）、`/api/intraday?code=t00&spark=1` | **立即可用** | 只需要閾值與去重 |
| 自選、庫存異常（漲跌幅、漲跌停、打開漲跌停） | `/api/quote`、`market.js` 的 `limits` | **立即可用** | 漲跌停價計算已經修正為依升降單位 |
| 使用者到價、指標條件 | `checkAlerts`、`irCheck` | **立即可用** | 觸發後改為產生事件 |
| 今日市場關鍵價位觸發（跌破分水嶺、站上壓力） | 盤前快照＋即時報價 | **立即可用** | 價位是推估值，事件要標示「推估價位」 |
| 族群強弱與輪動（排名大幅變化） | `_live.js` 全市場快照＋產業分類 | 需補強 | 要保存每 5 分鐘的排名快照才能比較「變化」 |
| 成交量異常 | 即時累計量 | 需補強 | 缺「歷史同時段累計量」；最小做法是存近 5 日分時量（`intraday` 1 分 K）算同時段平均 |
| 期現貨背離（基差急變） | `/api/futures`＋T00 | 需補強 | 有資料，缺邏輯與換月處理（決策中心已有合約代碼驗證可以沿用） |
| 重大訊息 | `official.js`（OpenAPI，每日） | **暫時不可用（即時）** | 要做盤中公告得另接公開資訊觀測站的即時頁，有格式與頻率限制，先列為 M3 |
| 新聞 | `news.js` 逐檔 Google News | 需補強 | 只能對「已觸發事件的股票」補查新聞當作線索；**不推論因果**，查不到也不代表沒有新聞 |
| 資料源失效、延遲、不一致 | `W.err`、`W.lastOk`、報價 `time`、錯誤紀錄 | **立即可用（前端）** | 要整理成逐來源的健康度 |

### 8.2 監控總覽畫面

- **監控狀態**，三種要分清楚：
  - 「本機監控中（這個頁面開著時才會偵測）」；
  - 「伺服器監控中・最後執行 10:42:10」；
  - 「監控未執行（休市、未開盤、伺服器未設定）」。
- **資料健康度**：每個來源一行，寫最後成功時間、延遲、狀態（見 9.3）。來源包括加權報價、全市場快照、台指期、分時。
- **涵蓋範圍**：今天監控了幾檔、哪些類型；伺服器模式下寫掃描次數與成功率。
- **空狀態要分三種**：
  - 「今天目前沒有觸發事件」：監控正常，只是沒事；
  - 「目前沒有資料」：來源失敗；
  - 「監控沒有執行」。
- **事件列表**：卡片列（沿用 `.mcard` 與 `liveTag` 樣式），每張卡寫類型、嚴重度（用文字標籤加圖示，不只靠顏色）、標的、觸發時間、最新狀態、更新次數。
- **通知結果**：每件事件寫「已通知：本機／Telegram」或「通知失敗」。

### 8.3 事件模型（最小可行版）

```js
{
  id: "2026-10-26:IDX_MOVE:T00:dn2",  // 交易日＋類型＋標的＋分桶，同時也是去重鍵
  tradeDate: "2026-10-26",
  type: "IDX_MOVE" | "SYM_MOVE" | "LIMIT" | "LEVEL" | "RULE" | "SECTOR" | "BASIS" | "VOLUME" | "DATA",
  severity: "info" | "watch" | "alert",
  subject: { codes: ["T00"], sector: null },
  rule: { key: "idx_pct", threshold: -2, text: "加權跌幅超過 2%" },
  state: "OPEN" | "UPDATED" | "CLOSED" | "DATA_INSUFFICIENT" | "DISMISSED",
  verdict: null | "CONFIRMED" | "REVERSED" | "UNRESOLVED",   // 盤後驗證
  firstAt, lastAt,          // observed_at
  sourceAt,                 // source_timestamp（報價自己的時間）
  snapshots: [{ at, price, chgPct, vol, note }],  // 最多 20 筆，證據
  evidence: [{ kind: "fact" | "hint", text, src, at }],  // fact＝行情事實；hint＝新聞標題等線索，不寫因果
  notified: [{ ch: "local" | "tg", at, ok, err }],
  origin: "client" | "server"
}
```

**生命週期（指令建議的 8 個狀態，簡化成 5 個加 1 個盤後結論）**
- `OPEN`（偵測到）→ `UPDATED`（證據更新，例如跌幅擴大到下一個分桶）→ 收盤後 `CLOSED`，同時寫入 `verdict`：
  - `CONFIRMED`：收盤仍成立；
  - `REVERSED`：收盤已反轉；
  - `UNRESOLVED`：資料不足以判斷。
- `DATA_INSUFFICIENT`：觸發當下資料過期或不完整，只記錄，**不通知**。
- `DISMISSED`：使用者自己標示「不用理」，只影響本機顯示。
- 不採用 INVESTIGATING、AWAITING_VALIDATION、REOPENED：這三個需要人工流程。這個產品沒有分析師處理事件，用不到。「重新開啟」用分桶表達：同一天跌幅回到門檻內再跌破，視為同一事件的 `UPDATED`，不會產生新事件。

**事件品質**
- 去重：`id` 由交易日、類型、標的、分桶組成，同一桶當天只會有一個事件。
- 頻率限制：同一標的 15 分鐘內最多通知一次；每人每天的 Telegram 上限可設定（預設 20）。
- 版本：`snapshots` 保留最近 20 筆；`UPDATED` 只在進入新分桶或證據新增時才寫。
- 誤報檢查：盤後統計每種類型的觸發數與 `REVERSED` 比例，在監控歷史頁顯示。
- 事實和線索分開寫：新聞放在 `evidence.kind = "hint"`，畫面固定寫「同時段的新聞標題（不代表原因）」。

### 8.4 持續監控與通知：方案比較

| 方案 | 頻率 | 需要什麼 | 成本、風險 | 結論 |
|---|---|---|---|---|
| M1 前端監控 | 每 1–5 秒（沿用 `schedule`） | 不需要新服務 | 頁面關掉就停；iOS 背景也會停 | **先做**，畫面明講限制 |
| M2-a Upstash QStash 排程呼叫 `/api/monitor` | 每 1–2 分鐘 | 接上 Upstash（KV 本來就要接，見 A1）、QStash 簽章密鑰 | 免費額度約每天 500 則；盤中每 2 分鐘約 135 次，夠用。和 KV 同一家廠商 | **M2 首選** |
| M2-b GitHub Actions cron `*/5 1-5 * * 1-5` | 名目每 5 分鐘，實際常延遲 3–15 分鐘、偶爾跳過 | 不需要新服務 | 公開 repo 免費；延遲大，不適合「即時」 | 備案；或作為 QStash 失效的補漏 |
| M2-c Vercel Cron | Hobby 方案一天只能一次 | 升級 Pro | 有月費 | 不建議 |
| 自建常駐主機 | 秒級 | 主機、維運 | 成本最高 | 不建議 |

**M2 最小補強（不另起獨立服務）**
1. 新 API `api/_lib/monitor.js`（由 `[route].js` 分派）：
   - 驗證 QStash 簽章，或與 `STATUS_KEY` 同類的密鑰；
   - 讀 `_live.js`、`quote.js`、`futures.js`；
   - 套用和前端**同一份**偵測規則；
   - 寫 KV：`mon:<日期>:ev`（hash）、`mon:<日期>:runs`（最後執行、成功、失敗），保留 30 天。
2. 偵測規則放 `learner/monitor.js`，用 `scripts/_engine.mjs` 同一種方式在伺服器載入（現在 `alerts-push.mjs` 就是這樣共用 `tools.js` 的 `COND`）。前後端判斷才會一致。
3. 通知沿用 `sync.js` 的 `tg()` 與使用者文件 `alert:<id>`：在 `ev.on` 加一個 `"intraday"` 選項；冪等鍵 `monsent:<id>:<事件ID>`，重跑不會重送。
4. 前端讀 `/api/monitor?date=`；有伺服器事件就以伺服器為主，本機事件併入時標示 `origin`。

**成本標示（未來商業化評估用）**

| 能力 | 成本 |
|---|---|
| M1 前端監控、今日市場 | 低：只有既有 API 呼叫 |
| M2 伺服器每 1–2 分鐘掃全市場 | 中：Vercel 函式執行時間、富果 API 次數（要確認方案上限）、QStash 則數 |
| 盤中即時重大訊息 | 中：要處理資料授權與頻率限制 |
| 新聞線索 | 低～中：Google News RSS 有頻率限制 |
| Telegram 推播 | 低 |

---

## 9. 資料流、狀態與時間

### 9.1 目前資料流

```
前端 watch.html
  schedule() ─ 每 1 秒 fastTick ─ /api/quote（自選、清單）
             └ 每 5 秒 tick ─ /api/quote、/api/intraday、/api/futures、各分頁資料 ─ checkAlerts() ─ notify()
  irStart  每 5 分鐘 ─ 指標規則
  evStart  每 2 小時 ─ 營收、法說會、ETF 換股事件
  briefLoad ─ /api/usmarket、/api/futures、/api/calendar、新聞 ─ W.bf ─ todayPage()
  loadMoney ─ /api/daily（逐日）─ W.mf ─ 資金雷達、今日重點
排程（GitHub Actions）
  07:40 morning-brief ─ Telegram（需要 KV＋TG，目前未啟用）
  14:05～21:55 各資料排程 ─ learner/data/*.json（commit 到 main）
  16:10、21:40 market-scan ─ alerts-push ─ Telegram（需要 KV＋TG，目前未啟用）
```

### 9.2 建議資料流

```
learner/monitor.js（偵測規則，前後端共用）
  前端：tick 結束 → monTick(quotes, ctx) → 事件存本機 store "watch:mon:<日期>" → 監控頁、今日市場摘要、今日市場卡
  伺服器：QStash → /api/monitor → monTick(同一份規則) → KV mon:<日期>:ev → tg()
  盤後：market-scan（16:10）之後 → monVerify(收盤資料) → 寫 verdict
今日市場只「讀」事件，不自己偵測；資金與族群摘要只算一次（共用 W.mf、W.irt）
```

### 9.3 時間欄位與資料狀態

**時間欄位**

| 欄位 | 建議 | 現況 |
|---|---|---|
| `source_timestamp` | 採用，存成 `sourceAt`（報價自己的日期與時間） | quote 有 `date`、`time` |
| `observed_at` | 採用，存成 `at`（我們拿到資料的時間） | `liveTag` 用 `J.at`、`W.lastOk` |
| `published_at` | 只用在新聞與公告 | `news.js` 有 `at` |
| `processed_at` | 不另外加：伺服器寫 KV 的時間就是 `runs.at` | — |
| `last_success_at` | 採用，每個來源一個（健康度要用） | 只有全域 `W.lastOk` |

所有交易日判斷一律用台北時間：沿用 `twDay()`（`brief.js:10`），也就是 UTC＋8 換算，不依賴裝置時區。伺服器（Vercel 在美東 iad1）也用同一套換算。

**資料狀態**（建議 7 個，沿用 `liveTag` 擴充成 `freshTag(state)`）

| 狀態 | 用途 | 判斷 |
|---|---|---|
| LIVE | 盤中、來源時間 30 秒內 | `sourceAt` 與現在相差 ≤ 30s |
| DELAYED | 盤中但延遲（Yahoo 15 分鐘、MIS 塞車） | 30s–5 分鐘，或來源本身就標示延遲 |
| STALE | 盤中超過 5 分鐘沒更新 | **不可當最新行情使用**：數字變灰、事件偵測暫停並記錄 DATA 事件 |
| PARTIAL | 部分來源缺（例如費半沒有） | 沿用 `evaluateDataStatus` |
| CLOSED | 休市或收盤後的收盤值 | 沿用 `twClosedNote` |
| ERROR | 來源失敗 | 沿用 `W.err` |
| LOADING | 第一次載入 | 骨架屏 |

`UNAVAILABLE` 併入 ERROR；`UNKNOWN` 只用在「交易日曆待確認」，沿用 `sessionStatus` 已有的 `unknown`，不另外做成資料狀態。

---

## 10. 桌面、平板、手機布局規格

| 畫面 | 手機（≤640） | 平板（641–1024） | 桌面（≥1025） |
|---|---|---|---|
| 今日市場摘要層 | 狀態列一行；結論；核心卡兩欄可橫捲；下一步按鈕垂直 | 核心卡 3 欄 | 核心卡 5 欄一列（現狀） |
| 時段面板 | `.seg` 黏在標題下方（sticky），三個按鈕平分寬度 | 同手機 | 左邊主內容；右欄放「盤中事件摘要」與「明日觀察清單」（`WIDE_TABS` 已是全寬模式） |
| 盤中監控列表 | 單欄卡片，點了開底部抽屜（`openSheet`）看詳情 | 兩欄：列表＋詳情 | 三欄：健康度與篩選｜事件列表｜事件詳情 |
| 事件詳情 | 抽屜；圖表用 `tschart.js` 迷你分時；返回關閉抽屜不跳頁 | 右側面板 | 右側面板 |
| 分頁列 | 7 個分頁橫捲；「工具」分組標籤 | 可以全部顯示 | 全部顯示 |

**觸控與安全區域**：按鈕高度 ≥ 40px（沿用全站 coarse-pointer 的 `::after` 擴大點擊區）；黏住的 `.seg` 要避開 iOS 瀏海（`env(safe-area-inset-top)`）；浮動「‹ 返回」改成在內容底部留出空間（修正 U7）。

**狀態保存**：
- 時段面板選擇記在 `kline:watch:today:phase`，但只保留到當天，隔天回到「目前時段」；
- 監控篩選記在 `kline:watch:mon:filter`；
- 事件詳情可以用網址 `#monitor/<事件ID>` 直達（通知點進來就是這頁）。

---

## 11. 共用設計系統規劃

| 項目 | 建議 | 類型 |
|---|---|---|
| 決策中心行內樣式 | 搬進 `core.css`（或 `minimal.css` 的同一層），class 前綴保留 `dh-` 以免動到渲染程式 | 整理 |
| 寫死的顏色 | 交易時段徽章改用中性的 `--surface-3`＋文字；**只新增一個語意色 `--warn`**（琥珀色，取自 `--s1` 色系），給「延遲、過期、部分資料」用；靛藍 `#6366f1` 一律換成 `--accent` | 整理＋補強 |
| 壓力、支撐色彩 | 改成中性底色＋文字標籤（壓力、分水嶺、支撐），不用紅綠 | 整理 |
| 數字字型 | 決策中心改回 `--font-num` | 整理 |
| `freshTag(state)` | 由 `liveTag` 擴充，7 種狀態都有文字＋圖示，**不只靠顏色** | 補強 |
| 嚴重度標籤 | `info`、`watch`、`alert` 用「● ▲ ■」形狀＋文字，紅綠只保留給漲跌 | 新建（小） |
| 空、錯誤、過期狀態 | 統一用 `.wl-err` 的「原因＋重試」樣式 | 沿用 |
| 卡片、分段鈕、抽屜 | `.mcard`、`.seg`、`openSheet` | 沿用 |

不另外建立第二套設計系統。

---

## 12. 例外狀態與無障礙

- 載入中：骨架屏；超過 10 秒顯示「還在載入，來源可能較慢」。
- 資料延遲或過期：`freshTag`；STALE 時數字變灰並加刪除線樣式，監控暫停並說明。
- 部分資料：卡片縮成「資料暫缺」一行，不留大塊空白。
- 無資料、API 錯誤：原因＋重試。
- 休市：狀態列說明＋最近交易日。
- 監控未執行：監控頁頂部清楚標示，並寫原因。
- 鍵盤：`.seg` 用 `role="tablist"` 與方向鍵切換（沿用分頁列的做法）；事件卡可以 Tab 聚焦、Enter 開詳情。
- 螢幕閱讀器：狀態列用 `aria-live="polite"`，只在「時段改變」或「新事件」時宣告，不要每秒宣告報價。
- 對比：`--muted` 文字在 `--surface-2` 上的對比要 ≥ 4.5:1（實作時用工具量測）。
- 減少動態：`prefers-reduced-motion` 時關閉首頁簡介與抽屜動畫、即時紅點閃爍。

---

## 13. 現有能力與缺口對照

| 需求 | 現有 | 缺口 | 階段 |
|---|---|---|---|
| 今日市場三時段 | 決策中心（堆疊式） | 時段面板、休市目標日、合併資金卡、明日清單 | C |
| 統一交易時段 | 4 套 | 合併成一套 | B |
| 資料新鮮度 | `liveTag`、`evaluateDataStatus` | `freshTag`、逐來源 `last_success_at` | B |
| 盤中事件（頁面開著） | 到價、指標提醒、通知 | 事件模型、規則、列表、詳情、本機持久化 | D（M1） |
| 盤中事件（頁面關著） | 無 | KV、QStash、`/api/monitor`、規則共用 | D（M2） |
| 通知 | 本機通知、Telegram 程式 | 正式環境未啟用 KV 與 TG；監控通知選項與冪等 | E |
| 盤後驗證 | 盤前情境驗證 | 事件驗證、誤報統計 | E |
| 跨日與歷史 | 資金雷達回放 | 事件歷史頁（本機 20 天、KV 30 天） | E |
| 量能異常 | 即時量 | 歷史同時段量 | D 之後 |
| 即時公告 | 每日重大訊息 | 盤中來源 | M3（另案） |

---

## 14. 實作順序與依賴

| 階段 | 內容 | 前置 | 主要檔案 | 工作量 | 驗收 |
|---|---|---|---|---|---|
| **A** 架構定稿 | 本文件審核；確認 4 個待確認事項（第 17 節） | — | 本文件 | 小 | 使用者同意 |
| **B** 共用基礎 | ①交易時段函式統一（`core.js` 新增 `twSession()`，`brief.js`、`watch.html` 改用）②`freshTag` ③決策中心樣式搬進 `core.css`、色彩對齊 ④修 U5–U8 | A | `core.js`、`core.css`、`brief.js`、`watch.html`、`tools.js` | 中 | 既有 232 項測試全過；新增時段判斷單元測試（週末、國定假日、颱風假、07:00、09:00、13:30 邊界） |
| **C** 今日市場 | 改名；摘要層；時段面板；合併資金卡；休市目標日；明日觀察清單；詳細層收合 | B | `brief.js`（`todayPage` 拆成 3 個面板函式）、`watch.html`（分頁名稱）、`tools.js`（`sumFlowHtml` 合併） | 中～大 | 390 與 1280 寬無溢出；手機首屏有結論＋核心卡；三時段與休市各有一個 e2e |
| **D** 盤中監控 M1 | `learner/monitor.js`（規則＋事件模型）；情報局分頁 `mon`、路由 `#monitor`；列表、詳情、健康度；本機持久化；tick 接上 | B | 新 `monitor.js`；`watch.html`（`INTEL_LT`、`ROUTES`、`WIDE_TABS`、`tick`）；`core.css` | 大 | 規則單元測試（觸發、去重、分桶、STALE 不觸發）；e2e 用假報價觸發事件 |
| **D2** 盤中監控 M2 | 接上 Upstash KV（使用者在 Vercel 操作）；QStash；`api/_lib/monitor.js`；KV 結構；前端合併伺服器事件 | D＋使用者設定 KV 與 QStash | `api/[route].js`、新 `api/_lib/monitor.js`、`vercel.json`（若需要） | 大 | 用假的 QStash 簽章在本機呼叫；KV 用記憶體替身測冪等；**不在正式環境觸發** |
| **E** 通知與驗證 | 監控通知選項、Telegram 冪等、頻率上限；盤後 `monVerify`；歷史頁；誤報統計 | D（本機）、D2（伺服器） | `tools.js`（提醒設定）、`scripts/alerts-push.mjs`、`market-scan.yml`（加一步） | 中 | 重跑不重送；通知失敗有紀錄；`--dry` 模式跑得通 |
| **F** 跨模組 | 今日市場卡（自選上方）顯示事件數；個股頁顯示當天事件；事件詳情連到資金雷達、個股、課程 | C、D | `brief.js`、`watch.html`、`stockx.js` | 小～中 | 每個連結有返回路徑；事件只有一個主要入口 |
| **G** 驗收 | 見第 15 節 | 全部 | `tests/` | 中 | CI 綠；Antigravity 用預覽網址驗證；ChatGPT 稽核 |

依賴關係：A → B →（C、D 可以並行）→ E、F；D2 另外依賴使用者接上 Upstash。

**涉及的大檔**（照 AGENTS.md 要先開 draft PR 上鎖）：`watch.html`（C、D、F）、`index.html`（只有在首頁文案要改時）。

---

## 15. 測試與驗收計畫

> 以下都是**待執行**。本階段沒有執行任何新測試。

**UI／UX（Playwright e2e，390 與 1280）**
- 四個主導覽仍是情報局、看盤、K線學堂、存股（擴充現有 `nav.test.mjs`）。
- 情報局分頁順序：today、mon、money、earn、ind、cong、pod；`#daily`、`#monitor`、`#monitor/<id>` 直達。
- 今日市場：
  - 三個時段面板切換並記住選擇；
  - 休市日不產生當天推演；
  - 資金摘要只出現一次；
  - 摘要層在 390 寬的第一屏內。
- 沒有橫向溢出；浮動返回不蓋住內容；鍵盤可以操作 `.seg` 與事件卡。

**資料（單元）**
- 時段判斷的邊界：週末、國定假日、颱風假（報價日期停在前一日）、07:00、08:30、09:00、13:30、13:45、17:40、跨午夜。
- `freshTag`：LIVE、DELAYED、STALE 的門檻；STALE 時事件偵測暫停。
- 舊資料不會被當成最新：報價日期不是今天時，盤中面板改成顯示「無今日資料」。

**事件（單元）**
- 觸發、同分桶去重、進入下一分桶變 UPDATED、跨日不沿用、DATA_INSUFFICIENT 不通知、盤後驗證三種結論。
- 跨日追蹤：事件歷史依交易日讀取。

**排程與通知（單元＋dry run）**
- `/api/monitor`：簽章錯誤回 401；同一分鐘重跑不產生重複事件或重複通知（KV 用記憶體替身）。
- Telegram：`--dry` 印出內容；失敗寫入 `notified[].err`。
- 休市日：`/api/monitor` 直接回「休市不掃」。
- **不在正式環境發送真實通知。**

**回歸**：既有 232 項全過；`#daily`、`#radar/…` 等舊網址不變。

---

## 16. 風險、相容性與成本

| 風險 | 影響 | 對策 |
|---|---|---|
| 證交所 MIS 不是正式 API，伺服器每 1–2 分鐘掃全市場可能被擋 | 監控中斷 | 優先用富果快照（已設金鑰）；MIS 只當備援；失敗記成 DATA 事件 |
| 富果方案的次數上限 | 同上 | 實作前確認方案；伺服器掃描只抓快照一次，前端不要重複抓 |
| QStash 或 GitHub Actions 延遲、跳過 | 事件晚到 | 監控頁顯示「最後執行時間」，超過 5 分鐘標為 STALE |
| 本機事件與伺服器事件重複 | 同一件事出現兩次 | 用同一個 `id` 規則，合併時以伺服器為主 |
| `brief.js` 已經 1,795 行，再加會更難維護 | 改壞既有功能 | C 階段把決策中心拆成獨立的 `todaymkt.js`（延後載入，沿用 `lazy()`） |
| 大檔衝突（多個 AI 協作） | 合併困難 | 照 AGENTS.md 先開「鎖：」draft PR |
| 誤報太多導致通知疲勞 | 使用者關掉通知 | 預設只推 `alert` 等級；頻率上限；誤報統計回饋閾值 |
| 推估價位被當成建議 | 合規 | 全部標示「推估」「不是買賣建議」（現有免責沿用） |
| 舊 localStorage 資料 | 相容性 | 鍵名不變；新增的鍵加日期，保留 20 天自動清除 |

---

## 17. 待確認事項

1. **產品名稱**：網站品牌是「KLineLab K線情報局」，指令裡是「TAIEX Monitor」。這次只是內部代號，還是要改品牌？本規劃先**沿用 KLineLab**，不改任何品牌文字。
2. **接上 Upstash（KV）與 Telegram**：M2、伺服器通知、跨裝置同步都需要。要在 Vercel 後台操作，屬於使用者的設定。
3. **QStash 或 GitHub Actions**：首選 QStash（每 1–2 分鐘、同一家廠商），需要申請簽章密鑰。不想多一個服務就用 Actions 每 5 分鐘，但要接受延遲。
4. **今日重點改名為「今日市場」**：網址與存檔不變，只改顯示文字。

---

## 18. 下一階段任務清單（使用者同意後）

1. Phase B：共用基礎（時段、`freshTag`、樣式整理、U5–U8）—— 開 PR，CI＋Antigravity 驗證＋ChatGPT 稽核。
2. Phase C：今日市場改版 —— 先開 draft PR「鎖：watch.html 情報局分頁、brief.js 決策中心」。
3. Phase D：盤中監控 M1。
4. 使用者接上 Upstash 後：Phase D2、E。
5. Phase F、G。

每一階段都可以單獨合併、單獨驗收。不會一次重寫全站。
