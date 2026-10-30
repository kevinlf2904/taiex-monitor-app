# KLineLab K線情報局（taiex-monitor-app）共用工作規則

所有 AI 協作者都照本文件做。TAIEX Monitor 與 KLineLab 是同一個專案（repo `taiex-monitor-app`）；它是原生 HTML／JS，不是 React，不為了套用通用建議而改架構或換圖表套件。

- `.agent/rules/klinelab.md` 必須與本文件完全相同：改完跑 `node scripts/sync-rules.mjs`，`tests/unit.test.mjs` 會檢查。
- `CLAUDE.md` 引用本文件，只另外放 Claude Code 專用的事；`.github/copilot-instructions.md` 指向本文件。
- 使用者用繁體中文溝通，常用 iPhone／iPad；回覆一律用繁體中文。
- 純討論、規劃、審查，不等於授權改檔案、推送或合併。
- 本文件只放每次都要遵守的規則；分工、開工、測試、PR、合併、資料權限、交接的細節在 `docs/agents-detail.md`，用到哪一節再讀哪一節（內容與本文件同等效力）。

> ### 絕對禁令（開工前必讀）
> 1. **只有三個工具改程式**：Claude Code、Codex、Gemini Antigravity；其他工具唯讀。
> 2. **一次只有一個合併者**：合併前先看有沒有別人正在合併；有就等它合完再接著做。
> 3. **大檔先上鎖**：改 `learner/watch.html`、`learner/index.html`、`learner/core.js`、`learner/brief.js` 前，先開 draft PR，標題「鎖：檔名＋區塊」。
> 4. **測試不連外部網站、不花錢**：一律用假資料或 mock，不呼叫證交所、Yahoo、FinMind 等網站，也不呼叫付費 AI API。
> 5. **不手改排程資料**：`learner/data/` 是排程產物，要改就改產生它的 `scripts/*.mjs`。
> 6. **合併前改版本號**：影響網站的 PR，合併前跑 `node scripts/bump-version.mjs "標題" "這次改了什麼"`，不可漏改或跳號。
> 7. **密鑰不外洩**：密鑰只放 Vercel 環境變數或 GitHub secrets（repo 是公開的），絕不寫進程式、測試、提交、PR、留言或回覆。

## 一、每次收到指令都要自動做

除了完成指令本身，每一輪順便做下面五件事，並在回覆裡簡短交代結果：

1. **優化介面**：改到的頁面在手機（390 寬、觸控）與電腦（1280 寬）沒有橫向溢出、文字重疊、版面跳動。
2. **優化使用**：按鈕位置、預設值、載入提示、記住上次的設定是否順手。
3. **整理重複功能**：兩處做同一件事就合併（與任務無關的另開 Issue）。
4. **回測技術線型**：`tests/unit.test.mjs` 的「所有策略回測合理性」「價格行為策略」檢查不偷看未來、停損有效、加成本不會變好；新增策略要能通過。
5. **自動偵錯**：跑完整測試 `node tests/run.mjs`（會收集瀏覽器 console 錯誤），有錯就修。新電腦第一次跑：`npm i --no-save playwright@1.56.1 && npx playwright install chromium`；Playwright 裝在別處時用 `PW=<安裝路徑> node tests/run.mjs`。

沒涉及介面就不宣稱檢查過畫面；沒跑回測就不宣稱策略正確。

## 速查（細節見 `docs/agents-detail.md`）

| 要做的事 | 規則 | 細節 |
|---|---|---|
| 開分支 | Claude Code `claude/…`、Codex `codex/…`、Antigravity `gemini/…`；從最新 `origin/main` 開；一個 PR 一件事 | 二、三 |
| 改大檔 | `learner/watch.html`、`learner/index.html`、`learner/core.js`、`learner/brief.js` 先開 draft PR「鎖：檔名＋區塊」 | 三 |
| 測試 | 只用假資料，不連外部網站；合併前要有 `node tests/run.mjs` 完整結果；沒跑寫「未執行」 | 四 |
| 開 PR、審查 | 照 `.github/pull_request_template.md`；高風險要獨立審查（稽核）；Antigravity 驗證留言開頭寫「驗證：」 | 五 |
| 合併 | 使用者說「直接幫我合併」才合；`scripts/bump-version.mjs` 改 `learner/version.json` 等版本號；只用 merge；Antigravity 照 `.agent/workflows/merge.md` | 六 |
| 資料、權限、費用 | 不啟用新排程、不印 env 值、不動使用者 localStorage、付費與權限要授權 | 七 |
| 交接、回報 | 寫在 Issue／PR；回報改了什麼、測試、推送、合併 | 八 |
