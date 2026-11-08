---
description: 直接幫我合併：推分支 → 開 PR → 等 CI test 通過 → merge → 分支重設到最新 main
---

照 AGENTS.md「合併流程」的規則，把目前 `gemini/…` 分支的工作合併進 main。Claude 額度不夠、使用者指定 Antigravity 接手並說「直接幫我合併」時用這個流程。

1. 確認目前在 `gemini/…` 分支，不是 main。工作目錄有未提交的變更時先停下來，確認變更屬於哪個任務；不得自行提交不屬於本次任務的內容，屬於本次任務的才提交。看開著的 PR，有別人正在合併或升版本就先等它合完。
2. `git fetch origin main` 後把 `origin/main` 合併進目前分支，有衝突就解決。
3. 改版本號：`node scripts/bump-version.mjs "標題" "這次改了什麼"`（依 main 上 `learner/version.json` 的版本加 1，一次改好 `learner/index.html`、`learner/watch.html`、`learner/version.json`，並在 `learner/README.md` 最新一節前面加 `### 標題（版本）`），再跑 `node tests/unit.test.mjs`。只改規則或文件、沒動到網站時跳過這步。
4. 本機跑涵蓋修改的相關測試（AGENTS.md「測試與品質」），通過才繼續；完整測試以下面第 7 步同一 head SHA 的 CI 為準；CI 失敗、需要在本機完整重現時才跑 `node tests/run.mjs`。
5. `git push -u origin <分支>`。
6. 開 PR（目標 main），說明寫清楚改了什麼、還有什麼沒做完。如果這個分支先前開過「鎖：」draft PR，就把它轉成 ready for review，標題改成正式標題。
7. 等 CI 的 `test` 檢查通過，而且 check run 的 `head_sha` 要等於 PR 目前的 `head.sha`（舊 SHA、cancelled、skipped、未觸發都不算）；只改文件不會觸發 CI 時，用 `workflow_dispatch` 對這個分支手動跑一次。失敗就看錯誤、修好、再推，直到通過。
8. 用 **merge** 方式合併（不要 squash／rebase），並指定剛才確認 CI 的 head SHA。沒有合併權限時，請使用者在 GitHub 按「Create a merge commit」。
9. 確認工作目錄乾淨、分支所有 commit 都已經合進 main 後，才 `git fetch origin main && git reset --hard origin/main`，讓分支回到最新 main，準備下一輪。
10. 用繁體中文回報：PR 編號、版本號、測試結果。
