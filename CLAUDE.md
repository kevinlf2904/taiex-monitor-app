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
- 每次回報結尾附 token 用量與額度使用率：
  1. 雲端 session：用 `get_session`（不給 session_id）取 `ccr.id`，再用 `list_events`（該 id、`kinds: ["rate_limit_event"]`、`limit: 100`）取上次回報後的額度事件；`has_more` 為 true 且最舊一筆仍晚於上次回報時，用 `before_id` 往前翻。把每筆整理成 `{"t":created_at,"h5":five_hour.utilization,"d7":seven_day.utilization,"h5r":five_hour.resetsAt,"d7r":seven_day.resetsAt}` 寫進暫存區的 JSON 檔。
  2. 執行 `node scripts/token-usage.mjs --quota <該檔>`（非雲端或取不到額度事件就不加 `--quota`，並註明「額度：未取得」），把輸出原樣貼在回報最後。
  3. 百分比以 rate_limit_event 回報為準，不從 token 推算。
- 留言自動讀取（AGENTS.md「AI 之間的溝通與留言自動讀取」）：在雲端 session 開始處理、審查或驗證某個 PR 時，馬上用 `subscribe_pr_activity` 訂閱該 PR，不必等使用者提醒；PR 合併或關閉後用 `unsubscribe_pr_activity` 取消。收到 GitHub 事件就用 `ReadNotifications` 讀完，依 AGENTS.md 判斷與處理。
  - 訂閱或通知工具不存在、權限不足或任何一步失敗時，立即改成手動讀取：用 `gh api` 讀該 PR 全部留言、reviews 與 review threads，並以最新 head SHA 核對；之後每次開工或回報前都再手動讀一次。同時在 PR 留言一次「處置（Claude Code）：無法訂閱留言，改為每次開工手動讀取」，不得在沒有實際讀到最新留言時宣稱已自動讀取。
- 等 CI 時用背景指令輪詢同一 head SHA 的 check run，不要反覆手動查；等待用的迴圈不要用 `pgrep -f` 比對會出現在自己指令列裡的字串。
