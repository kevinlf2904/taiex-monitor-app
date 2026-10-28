---
description: 直接幫我合併：推分支 → 開 PR → 等 CI test 通過 → merge → 分支重設到最新 main
---

照 AGENTS.md「八、合併與發佈」的規則，把目前 `gemini/…` 分支的工作合併進 main。預設合併窗口是 Claude Code；只有使用者明確授權 Antigravity 合併時才用這個流程。

1. 確認目前在 `gemini/…` 分支，不是 main；工作目錄沒有未提交的變更（有就先提交）。
2. `git fetch origin main` 後把 `origin/main` 合併進目前分支，有衝突就解決。
3. 改版本號：`node scripts/bump-version.mjs "標題" "這次改了什麼"`（依 main 上 `learner/version.json` 的版本加 1，一次改好 `learner/index.html`、`learner/watch.html`、`learner/version.json`，並在 `learner/README.md` 最新一節前面加 `### 標題（版本）`），再跑 `node tests/unit.test.mjs`。只改規則或文件、沒動到網站時跳過這步。
4. 跑完整測試 `node tests/run.mjs`，全部通過才繼續；有錯就修。
5. `git push -u origin <分支>`。
6. 開 PR（目標 main），說明寫清楚改了什麼、還有什麼沒做完。如果這個分支先前開過「鎖：」draft PR，就把它轉成 ready for review，標題改成正式標題。
7. 等 CI 的 `test` 檢查通過；失敗就看錯誤、修好、再推，直到通過。
8. 用 **merge** 方式合併（不要 squash／rebase）。
9. `git fetch origin main && git reset --hard origin/main`，讓分支回到最新 main，準備下一輪。
10. 用繁體中文回報：PR 編號、版本號、測試結果。
