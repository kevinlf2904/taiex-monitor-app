# AI 研究室實作計畫與完成狀態

## 已完成（本 PR，分支 `claude/ai-research`）

| 項目 | 檔案 | 狀態 |
|---|---|---|
| Phase 0 現況稽核 | `docs/ai-research/PHASE_0_AUDIT.md` | 完成 |
| Phase 1 資料契約（7 種狀態、10 個必要欄位、跨日／估算／缺值規則） | `learner/research.js`、`market-center.js researchInput` | 完成：涵蓋加權、櫃買、廣度、法人、價位、美股、匯率原物料、新聞摘要、自選 |
| Phase 2 引擎（資料門檻、研究模式、JSON 報告、引用與數字檢查、多空與三種情境、未知事項、客觀數據） | `research.js`、`brief.js`、`api/_lib/chat.js` | 完成 |
| 研究歷史資料結構 | `research.js historyRecord`（不存檔） | 完成設計，**未啟用保存** |
| 測試 1～15 | `tests/research.test.mjs`、`tests/e2e/ai-research.test.mjs`、三個既有測試改為新流程 | 完成 |

## 下一步（需要使用者決定，未做）

| 階段 | 內容 | 前置／依賴 | 修改範圍 | 測試要求 | 預期效益 |
|---|---|---|---|---|---|
| 3 | AI 使用量統計：KV 依用途（chat、research、today）每日計數與輸出 token | KV 已啟用 | `api/_lib/chat.js`（寫 `use:<用途>:<日期>` 計數），可在 `/api/status` 顯示 | 單元測試計數、失敗不影響回答 | 看得到研究功能實際花了多少額度 |
| 4 | 研究歷史保存與事後驗證（收盤後檢查情境是否觸發、結論是否失效） | 使用者同意保存；新 localStorage 鍵 `kline:mcrh:v1`、保留 30 天，或存 KV | brief.js、research.js | 保存上限、換版本、刪除 | 研究可追蹤、可回顧 |
| 5 | 個股研究（同一套契約，symbol 換成個股） | 本 PR 合併 | watch.html 個股頁（上鎖檔案，需先開鎖定 PR） | 契約測試加個股案例 | 重用引擎，不重做 |
| 6 | 法人資料加「外資、投信、自營」各自的官方總額（現在只有族群估算） | 既有 `/api/daily` | flows.js、research.js | 對照證交所假資料 | 減少估算依賴 |

## 合併順序

1. #214（稽核 C 批，CI 已通過）
2. 本 PR（#216）：合併 #214 後升版本號
3. 合併後請 Antigravity 在正式站盤中、盤後各按一次「開始 AI 整理」，用 390／1280 截圖驗證。
