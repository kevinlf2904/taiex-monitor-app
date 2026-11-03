# AI 研究室 Phase 2：研究引擎規格

## 1. 流程

```
按「開始 AI 整理」（brief.js tdai，2156 行）
→ 補抓總經新聞摘要、法人資料（既有函式，最多等 8 秒）
→ 載入 research.js（用到才載，brief.js tdResearchLib）
→ buildSnapshot(researchInput(W))       研究資料快照
→ gate(snapshot)                         不夠 → 不呼叫 AI，顯示「資料不足」＋未知事項＋客觀數據
→ POST /api/chat { purpose: "research", model: "lite", context: contextText(), messages: [prompt()] }
→ parseReport(text, snapshot)            格式、引用編號、數字檢查
→ renderReport()                         畫報告；客觀數據由程式直接列出
→ sessionStorage「kline:mcai:v2」         當天、這個分頁；換日不還原
```

## 2. 研究報告欄位（AI 輸出 JSON）

| 段落 | JSON | 規則 |
|---|---|---|
| 1 研究摘要 | `summary` | 兩三句；數字要對得上資料 |
| 2 客觀數據 | （不經 AI）| `factsHtml()` 直接從快照列出數值、資料日、狀態、來源 |
| 3 多方論點 | `bull[{text, refs}]` | 2～4 點，每點要有資料編號 |
| 4 空方論點 | `bear[{text, refs}]` | 和多方分開；畫面左右並排（手機上下） |
| 5 產業與資金 | `sectors[]` | 法人金額是估算、要寫資料日 |
| 6 關鍵價位 | `levels[]` | 標題寫「模型推估，非實際報價」；距離由程式算好（`calc.toLv.*`）|
| 自選與持股 | `watchlist[]` | 資料表有 `watch.` 開頭的自選才寫（沿用 main 版 AI 整理會提到自選的功能） |
| 7 情境推演 | `scenarios[{type: bull/neutral/bear, trigger, watch, invalidation, refs}]` | 三種都要有，缺的記錄問題 |
| 8 風險與反證 | `risks[]` | |
| 9 未知事項 | `unknowns[]` ＋快照 `gaps` | 程式把未取得、過期的資料一定加進來 |
| 10 研究結論 | `conclusion{text, refs}` | 條件式；不給買賣建議或目標價 |
| 資料不足 | `status: "insufficient"` | 不顯示結論，只列未知事項 |

## 3. 輸出檢查（parseReport，research.js:154）

| 檢查 | 做法 | 結果 |
|---|---|---|
| 格式 | 去掉 ```json 外框後解析 JSON | 失敗 → 「AI 回應格式錯誤」，只顯示客觀數據、未知事項 |
| 引用 | `refs` 必須是資料表裡**有值**的編號 | 不存在的移除並記錄；整點沒有有效引用 → 標「⚠︎ 未能對照資料」 |
| 數字 | 文字裡的數字要能在資料值或備註找到（允許四捨五入、千分位、正負號）；日期、時間、代號、1～10、20／60／120／240 不檢查 | 對不上的列在 ⚠︎ 後面，例如「⚠︎ 未能對照資料（999）」|
| 完整 | 多方、空方、情境、結論是否存在；情境三種是否齊全 | 記入 issues，報告底部顯示件數 |

有問題的那一點**不默默刪除**，而是標示出來讓使用者自己判斷。

## 4. 成本與可靠性

| 項目 | 設定 | 位置 |
|---|---|---|
| 型號 | `today` 順序：3.1 Flash Lite → 3.5 Flash Lite → Lite latest → 3.6 Flash → 3 Flash | `_gemini.js:21` |
| 輸出上限 | `maxOutputTokens: 3072`、`temperature: 0.2`、JSON | `chat.js:32` `RESEARCH_GEN` |
| 輸入上限 | 資料表 5000 字（前端）＋伺服器截 6000 字 | `research.js:14`、`chat.js:102` |
| 重試 | 一次請求最多呼叫 Gemini 3 次（`WEB_TRIES`）；429 直接換下一個型號、不等待 | `_limit.js:13`、`chat.js:46-52` |
| Claude 備援 | **研究模式不使用**（一般問答維持 `AI_CLAUDE_FALLBACK=1` 才開）| `chat.js:111,117` |
| 限流 | `/api/chat` 每 IP 每小時 40 次、全站每天 1500 次；KV 已啟用，全站共用 | `_limit.js:11` |
| 快取 | 有 KV 時同一天、同系統提示、同資料表 6 小時內直接回快取；資料表不含現在時間 | `chat.js:74-77`；`research.js:119` |
| 逾時 | 前端 65 秒；伺服器整體 57 秒內回應 | `brief.js tdAiAsk`、`chat.js` |
| 資料不足 | 不呼叫 AI | `research.js:110` |
| 使用量統計 | **目前沒有**：只有限流計數器（KV `rl:*`），沒有按用途統計呼叫次數與 token | 見 IMPLEMENTATION_PLAN 第 3 階段 |

**成本變化**：每按一次仍只呼叫一次 AI（Flash Lite）。輸出上限從 4096 降到 3072 token；輸入資料表比 #216 的文字摘要＋今日重點全文短（不再附今日重點全文）。資料不足時不呼叫，快取比以前容易命中。**沒有新增昂貴模型呼叫。**

## 5. 研究歷史（只設計，不存檔）

`historyRecord()`（`research.js:221`）產生：`researchId、researchType、symbol、market、createdAt、dataSnapshot（只存編號、數值、交易日、狀態）、sourceReferences、model、conclusion、bullCase、bearCase、invalidationConditions、followUpStatus: "pending"`。

**目前沒有任何持久化**：只有 sessionStorage 當天一份（分頁關閉就清）。要保存歷史、做事後驗證，需要使用者同意後另開 PR（新的 localStorage 鍵要獨立前綴、版本與保留期限，或存 KV）。
