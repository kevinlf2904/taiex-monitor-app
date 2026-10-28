# GitHub Copilot 專案說明

這個專案的共用工作規則在根目錄的 `AGENTS.md`，所有 AI 都照它做；開工前先讀它。這裡只摘要 Copilot 要注意的事：

- 使用者用繁體中文溝通；PR 標題、說明、留言與審查意見都用繁體中文。
- 角色：編輯器補全、大型 PR 審查；使用者把 Issue 指派給你時，用 coding agent 實作並開 PR。
- 分支：coding agent 自動建立的 `copilot/…` 分支（AGENTS.md 規定的 Copilot 分支）；不要推到 `claude/…`、`codex/…`、`gemini/…` 或 main。
- 只接規格清楚、範圍小的 Issue（單一錯誤、補測試、文件）。要改 `learner/watch.html`、`learner/index.html`、`learner/core.js`、`learner/brief.js` 時，先確認沒有其他 open PR 標題寫「鎖：」同一檔案同一區塊；策略、回測、安全相關的工作不接，留言說明交給 Claude Code。
- PR 說明照 `.github/pull_request_template.md`：誰做的（GitHub Copilot）、改了什麼、還沒做完、測試；寫 `Closes #N`。
- 開 PR 前跑 `node tests/run.mjs`（`copilot-setup-steps.yml` 已裝好 Playwright），結果寫進 PR 說明；跑不了要寫「未執行」和原因，不可寫成通過。
- 不改版本號（`learner/version.json` 等）、不合併；由 Claude Code 合併時處理。
- 本專案是原生 HTML／JS，不是 React／Tailwind；程式要跟周圍的寫法一致（命名、註解密度）。
- 測試只用假資料或 mock，不連外部網站、不呼叫付費 API。
- 不手改 `learner/data/`（排程產物，要改就改產生它的 `scripts/*.mjs`）；密鑰只放 Vercel 環境變數或 GitHub secrets，絕不寫進程式、PR 或留言。
- 改了 `AGENTS.md` 要跑 `node scripts/sync-rules.mjs` 同步 `.agent/rules/klinelab.md`，再跑 `node tests/unit.test.mjs`。
- 審查格式：結論（可以合併／修改後再合併／不建議合併），問題逐項列出嚴重度（P0～P3）、檔案與行號、問題、重現方式、建議。
