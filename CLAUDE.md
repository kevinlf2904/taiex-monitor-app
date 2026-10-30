@AGENTS.md

# Claude Code 專用

- 開發分支用 `claude/…`。
- 完整測試：`PW=/opt/node22/lib/node_modules/playwright node scripts/test-summary.mjs`（跑 `tests/run.mjs`，只印通過／失敗數與失敗項目）；要看完整輸出才直接跑 `node tests/run.mjs`。
- 合併前改版本號：`node scripts/bump-version.mjs "標題" "這次改了什麼"`。
- 「直接幫我合併」的步驟見 AGENTS.md「合併流程」。GitHub GraphQL 在這個環境不能用，開 PR／合併改用 REST：`gh api repos/kevinlf2904/taiex-monitor-app/pulls …`。
- 讀大檔（`learner/watch.html`、`index.html`、`core.js`、`brief.js`）先用 grep 找行號，一次讀 200 行以內，不整檔讀。
- 不讀 `node_modules/`、`*.lock`、`package-lock.json`、Playwright 報表與快照；`learner/data/` 的大檔只用 grep 或 node 取需要的片段。
- 回覆精簡：改了什麼、測試結果、是否推送／開 PR／合併、還沒做的事；不貼沒改的程式。
