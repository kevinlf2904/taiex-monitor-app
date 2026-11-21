# 合併流程、低風險例外與版本號

本文件是 `AGENTS.md`「合併流程」的完整內容，屬於協作規則：修改需使用者授權並經獨立審查，不適用低風險例外（`scripts/pr-guard.mjs` 會把本檔視為協作規則）。只在要合併、升版本或判斷低風險例外時才需要讀。

## 合併流程
開 PR 不代表獲准合併；須有使用者明確授權（例如「直接幫我合併」），下方「低風險例外」除外。Antigravity 的指令版在 `.agent/workflows/merge.md`，步驟相同。
1. 確認沒有其他合併者或版本更新正在進行；`git fetch origin main` 並合入最新 main，解決衝突。
2. 影響網站時，合併前執行 `node scripts/bump-version.mjs "標題" "這次改了什麼"`，再跑 `node tests/unit.test.mjs`；純文件／測試不升版。
3. 本機相關測試通過後推分支、開 PR；原有鎖定 draft PR 轉 ready 並改正式標題。
4. 等同一 head SHA 的 CI `test` 成功（判定方式見 `AGENTS.md`「測試與品質」）；失敗須修復，不跳過或刪測試。CI 受阻不算通過。
5. 使用 **merge**，不可 squash／rebase，並鎖定剛才確認 CI 的 head SHA（GitHub API 的 `sha`／`expectedHeadSha`）。所有分支提交均已進 main、工作目錄乾淨後，才重設分支到最新 main。
6. 回報 PR、版本、測試、推送／合併狀態；PR 合併不代表部署成功。

## 低風險例外
使用者於 2026-11-08 授權：符合下列全部條件的 PR，合併者可以不再等使用者說「合併」，合併後回報 PR、合併的 SHA 與 CI 連結。
- 範圍依 diff 的檔案路徑判定，只要有一個檔案不在範圍內就不適用：`docs/**`（不含本檔 `docs/merge.md`）；一般 `*.md`（不含 `AGENTS.md`、`CLAUDE.md`、`.agent/**`、`.github/**`）；`tests/**` 中只新增測試或在不放寬斷言下修正不穩定測試；`learner/core.css`、`learner/minimal.css` 且 diff 只有 CSS 規則。HTML／JS 裡的 CSS 字串不算。
- 不適用：策略、回測、績效計算；安全與權限；正式資料寫入、`learner/data/**`、localStorage 鍵；協作規則（含本節與本檔）；部署設定、`vercel.json`、`.github/workflows/**`；`api/**`、`scripts/**`、`package*.json`；任何刪除測試或放寬斷言的修改。
- 條件：(1) 至少一則非作者的審查結論為「可以合併」；(2) 改 CSS 時另有 390／1280 驗證（Antigravity；Antigravity 是實作者時由 Claude Code），不以實作者自己的截圖取代；(3) 同一 head SHA 的 CI `test` 成功；(4) 沒有未處理的審查意見，P0／P1 均已修復；(5) 沒有其他合併者或版本更新正在進行；(6) 照上面的合併流程用 merge。

## 版本號
格式 `YYYY.MM.DD-N`，日期採合併當天台北時間，N 接續現有號碼、不每日歸零。腳本會同步更新 `learner/index.html`、`learner/watch.html`、`learner/version.json`，並在 `learner/README.md` 最新紀錄前加 `### 標題（版本）`。若版本衝突，改用 main 上這些檔案再重跑 bump-version。
