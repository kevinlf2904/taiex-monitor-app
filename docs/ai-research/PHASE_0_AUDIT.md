# AI 研究室 Phase 0：現況與 PR 交接

稽核日期：2026-11-03（台北）。稽核者：Claude Code。分支：`claude/ai-research`。

## 1. PR 與鎖定狀態

| PR | 狀態 | 分支／HEAD | 說明 |
|---|---|---|---|
| #215 | **已關閉（draft）** | `claude/ai-research` @ 4321e6f | 只是 brief.js 的「鎖」草稿 PR。工具沒有權限把 draft 轉 ready，所以關閉，由 #216 接續；**它本身沒有獨立程式碼**，任務描述裡的「PR #215 的工作」實際在 #216。 |
| #216 | 開啟中，CI `test` 通過（d3bf2de） | `claude/ai-research` | AI 市場研究第一版：四個工作區的文字摘要（researchText）、十段固定格式提問、sessionStorage 保存。本次 Phase 0–2 接著在同一分支改寫。 |
| #214 | 開啟中，CI 通過 | `claude/audit-fixes-c` | 稽核 C 批（watch.html mergeDaily 等），與本任務無重疊檔案區塊。 |

- 開啟中的 PR 只有 #214、#216，兩者都是 Claude Code 的分支，**沒有其他開發者鎖定的檔案**。
- `brief.js`、`market-center.js` 由 #216（本人）持有；`watch.html` 由 #214（本人）持有。本任務**沒有修改 watch.html、core.js**。
- main 自 #216 分出後只有排程資料提交（`[skip ci]`），沒有程式衝突。

## 2. researchText(W) 的實作狀況（#216 第一版，已確認，不是假設）

| 項目 | 證據 | 結論 |
|---|---|---|
| 是否實作 | #216 的 `learner/market-center.js` 有 `function researchText(W)`（d3bf2de 版約 758 行起） | 有 |
| 是否匯出 | `window.KLMarketCenter = Object.freeze({ researchText, … })` | 有 |
| 是否接入 AI | `learner/brief.js` `tdAiContext()` 呼叫 `KLMarketCenter.researchText(W)`，結果和 `todayText()` 接在一起送 `aiChat()` | 有，但只是文字拼接 |

### 第一版的問題（本次已修正，修正位置見各點）

| # | 檔案：行 | 現況證據 | 根本原因 | 影響 | 修正 | 驗收 |
|---|---|---|---|---|---|---|
| P0-1 | `api/_lib/chat.js:14-20` | 一般問答的系統提示是「技術分析助教」，第 17 行寫「回答控制在 300 字以內」 | 今日市場 AI 整理共用一般問答的系統提示 | #216 要求 600～900 字、十段，和系統提示衝突，模型可能截短或忽略格式 | 新增 `SYSTEM_RESEARCH`（`chat.js:26-31`），前端送 `purpose: "research"` 時使用 | `tests/research.test.mjs`「伺服器研究模式」：研究模式的系統提示不含「300 字」，一般問答仍有 |
| P0-2 | #216 `market-center.js` researchText 第一行 | 送出內容第一行是「現在 YYYY-MM-DD HH:MM」 | 把當下時間放進資料 | 每分鐘內容都不同，伺服器的 6 小時回答快取（`chat.js:74-77`，有 KV 時）永遠命中不了，等於每按一次都花一次額度 | 新版 `contextText()`（`learner/research.js:119`）不放現在時間 | 測試 14：只差一分鐘、資料一樣 → 內容完全一樣 |
| P1-1 | #216 `brief.js` tdAiPrompt | 回答是自由文字，只用格式要求 | 沒有結構化輸出、沒有檢查 | AI 編造數字、引用不存在的資料時無從發現 | 改要求 JSON（`responseMimeType: application/json`，`chat.js:32`），前端 `parseReport()` 檢查（`research.js:154`） | 測試 9、10、11 |
| P1-2 | #216 researchText | 每段寫日期，但沒有「狀態」（即時／延遲／盤後／估算／過期） | 沒有統一資料格式 | AI 分不清估算（法人金額、模型價位）和官方數據，也不知道哪些資料過期 | 研究資料契約（`research.js:18-35`、`40-107`） | 測試 1、3、5、6、7 |
| P1-3 | #216 brief.js tdai | 資料不足時仍呼叫 AI | 沒有資料門檻 | 花額度產生沒有依據的報告 | `gate()`（`research.js:110`）：加權必須可用且不過期，另外五類至少 2 類，否則不呼叫 AI | 測試 2、3；e2e「資料不足時不呼叫 AI」 |
| P2-1 | `api/_lib/chat.js:111`（修正後） | Gemini 429／忙線時，`AI_CLAUDE_FALLBACK=1` 會改問 Claude（`claude-opus-5-5`） | 研究報告沿用一般問答的備援 | 研究報告較長，改問 Claude 成本高 | 研究模式不改問 Claude（`!research &&` 條件、第 117 行沒有 Gemini 金鑰時直接回錯誤） | 測試 8 |
| P2-2 | `learner/market-center.js:684` | 按鈕文字只看 `ai.text` | 新版結果放在 `ai.parsed` | 結果出來後按鈕仍顯示「開始 AI 整理」 | 改看 `ai.text || ai.parsed`；失敗顯示「重試 AI 整理」 | e2e 手機版測試、today-market-v2 第 4 項 |

## 3. AI、資料、限流模組盤點（沒有重複 API）

| 模組 | 用途 | 本次是否改動 |
|---|---|---|
| `api/[route].js:45,60` | 單一入口；`chat` 等 AI 路由 POST 先過 `aiLimit` | 否（研究沿用 `/api/chat`，**沒有新增路由**） |
| `api/_lib/_limit.js:11` | `AI_LIMITS.chat = [每 IP 每小時 40, 全站每天 1500]`；KV 開啟後全站共用（2026-11-03 已設定 Upstash，`/api/sync?op=cfg` 回 `limiter: shared`） | 否 |
| `api/_lib/_gemini.js:19-24` | 各用途型號順序；`today` 以 3.1 Flash Lite 為主 | 否（研究用 `today` 順序） |
| `api/_lib/chat.js` | 問答、快取（`cacheKey` 含系統提示＋內容）、Gemini 重試（`WEB_TRIES = 3`）、Claude 備援 | 是：新增研究模式（系統提示、生成設定、不改問 Claude） |
| `learner/market-center.js` | 今日市場五個工作區；`readFlow`、`flowAlignment`、`readTechnicalLevels` | 是：`researchText` 改成 `researchInput`（只收集原始資料，不再組文字） |
| `learner/brief.js` | 今日市場頁、AI 整理按鈕（`data-tx="tdai"`） | 是：改走 research.js 流程 |
| `learner/core.js` `aiChat()`（1000 行） | 共用問 AI | 否（研究改在 brief.js 直接呼叫 `/api/chat`，避免動到上鎖的 core.js） |

行情、法人、全球資料都沿用既有的 `W.quotes`、`W.mkt`、`W.mf`（mfModel）、`W.bf.us`、`W.gl`、`W.mn`，**研究流程不另外抓行情**；唯一的補抓是 `loadMnews()`（靜態檔）與 `loadMoney(10)`（法人，既有函式），最多等 8 秒。

## 4. 測試現況

- 既有：`tests/e2e/today-market-v2.test.mjs`（第 4 項 AI 研究區）、`fixall.test.mjs`、`refresh.test.mjs`、`ai-research.test.mjs`（#216）。
- 這三個既有測試原本斷言 AI 回「測試回覆」純文字。新版會先檢查資料新鮮度，而測試假資料的日期是舊的，所以改成在研究取資料時放入今天的資料，並斷言研究模式、Flash Lite、結果留在研究區、失敗可重試。原本的意圖都保留，沒有刪除任何斷言目的。
