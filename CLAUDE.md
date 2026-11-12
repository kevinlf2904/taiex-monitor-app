@AGENTS.md

# Claude Code 專用

- 開發分支用 `claude/…`。
- 日常本機測試：只跑相關檔案，`PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/<相關>.test.mjs tests/e2e/<相關>.test.mjs`；完整測試以同一 head SHA 的 CI `test` 為準（AGENTS.md「測試與品質」）。
- 需要在本機完整重現時才跑 `PW=/opt/node22/lib/node_modules/playwright node scripts/test-summary.mjs`（一樣是跑整套 `tests/run.mjs`，只印通過／失敗數與失敗項目）；要看完整輸出才直接跑 `node tests/run.mjs`。這個開發環境有 1 項已知失敗（Issue #236 第 2 項：手機分頁從 iframe 上觸控捲動；第 1 項已由 #261 修正）。是否通過仍以同一 head SHA 的 CI 實際結果為準，不得預設 CI 一定成功。
- 合併前改版本號：`node scripts/bump-version.mjs "標題" "這次改了什麼"`。
- 「直接幫我合併」的步驟見 AGENTS.md「合併流程」。GitHub GraphQL 在這個環境不能用，開 PR／合併改用 REST：`gh api repos/kevinlf2904/taiex-monitor-app/pulls …`。
- 讀大檔（`learner/watch.html`、`index.html`、`core.js`、`brief.js`）先用 grep 找行號，一次讀 200 行以內，不整檔讀。
- 不讀 `node_modules/`、`*.lock`、`package-lock.json`、Playwright 報表與快照；`learner/data/` 的大檔只用 grep 或 node 取需要的片段。
- 看差異先用 `git diff --stat` 確認範圍，需要時再 `git diff <檔案>`；不要一次輸出整份 diff。
- 回覆精簡：改了什麼、測試結果、是否推送／開 PR／合併、還沒做的事；不貼沒改的程式。回報時機與「一定立即回報」的情況見 AGENTS.md「交接與回報」。
- 等 CI 時用背景指令輪詢同一 head SHA 的 check run，不要反覆手動查；等待用的迴圈不要用 `pgrep -f` 比對會出現在自己指令列裡的字串。
- Modern Web Guidance plugin（`.claude/settings.json` 啟用，來源 GitHub `GoogleChrome/modern-web-guidance`、npm 套件 `modern-web-guidance`，Google Chrome 團隊維護，Apache-2.0）：技能說明寫 `npx -y modern-web-guidance@latest`，本 repo 一律改用固定版本 `npx -y modern-web-guidance@1.0.0 …`，不要用 `@latest`。這個指令會從 npm 下載並執行套件，只用來 `search`／`retrieve`／`legacy-scan` 讀指南，不傳專案程式碼或個人資料出去；查到的指南只是建議，仍以本文件與 AGENTS.md 為準。要升級時先看上游 release 與 npm 版本，在 PR 裡改這裡的版本號並說明原因。
