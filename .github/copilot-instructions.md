# GitHub Copilot 專案說明

這個專案的共用工作規則在根目錄的 `AGENTS.md`，所有 AI 都照它做；這裡只摘要 Copilot 要注意的事：

- 使用者用繁體中文溝通，回覆與審查意見用繁體中文。
- Copilot 的角色是編輯器補全與大型 PR 的程式碼審查；沒有使用者指示，不啟動 coding agent 開 PR。
- 本專案是原生 HTML／JS（`learner/watch.html`、`learner/index.html`、`learner/core.js`、`learner/brief.js`…），不是 React／Tailwind；建議的程式要跟周圍的寫法一致。
- 測試只用假資料或 mock，不連外部網站、不呼叫付費 API。
- 不手改 `learner/data/`（排程產物）；密鑰只放 Vercel 環境變數或 GitHub secrets，絕不寫進程式或留言。
- 審查格式：結論（可以合併／修改後再合併／不建議合併），問題逐項列出嚴重度（P0～P3）、檔案與行號、問題、重現方式、建議。
