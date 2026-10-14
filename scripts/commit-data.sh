#!/usr/bin/env bash
# 排程把整理好的資料寫回 repo（所有 .github/workflows/*.yml 的資料排程共用）
#   用法：bash scripts/commit-data.sh "<commit 訊息>" <路徑>...
#   - 寫回「觸發這次執行的分支」（GITHUB_REF_NAME，排程時是 main）；不會把別的分支的內容推到 main
#   - 沒有變動就直接結束；路徑不存在（例如第一次執行還沒產生）就略過那個路徑
#   - commit 訊息加 [skip ci]：資料更新不再觸發 GitHub Actions 的 CI
#   - 推送失敗（別的排程剛好先推）時：先 rebase 到最新的遠端，再推；最多 5 次，每次等久一點（含隨機秒數，錯開同時重試）
#     rebase 用 -X theirs：資料檔有衝突時保留這次新產生的內容（rebase 時 theirs＝正在重放的這個 commit）
set -u
msg="$1"; shift
branch="${GITHUB_REF_NAME:-main}"
git config user.name "${COMMIT_NAME:-data-sync}"
git config user.email "${COMMIT_NAME:-data-sync}@users.noreply.github.com"
for p in "$@"; do [ -e "$p" ] && git add -A -- "$p"; done
if git diff --cached --quiet; then echo "沒有新資料"; exit 0; fi
git commit -q -m "$msg [skip ci]"
for i in 1 2 3 4 5; do
  if git pull --rebase -X theirs -q origin "$branch" && git push -q origin "HEAD:$branch"; then echo "已寫回 $branch"; exit 0; fi
  git rebase --abort 2>/dev/null
  wait=$(( i * 5 + RANDOM % 7 )); echo "::warning::第 $i 次寫回失敗，${wait} 秒後重試"; sleep "$wait"
done
echo "::error::寫回 $branch 失敗（重試 5 次）"; exit 1
