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
# 推送用的 token（#312、docs/ruleset-setup.md 第二階段前置 3）：
#   有 DATA_PUSH_TOKEN（workflow 在 commit 前一步用排程專用 GitHub App 換發，有效 1 小時）就改用它推送；
#   main 開 ruleset 後只有 bypass 清單裡的 App 能直接推，預設 GITHUB_TOKEN（github-actions[bot]）不能加進 bypass。
#   actions/checkout v5 把 token 存在本機 git 設定的 http.<伺服器>/.extraheader，這裡整個換成 App 的 token。
#   沒有設定 App（repo 變數 DATA_APP_CLIENT_ID 是空的）時沿用 checkout 的 GITHUB_TOKEN，行為和以前一樣。
if [ -n "${DATA_PUSH_TOKEN:-}" ]; then
  key="http.${GITHUB_SERVER_URL:-https://github.com}/.extraheader"
  auth=$(printf 'x-access-token:%s' "$DATA_PUSH_TOKEN" | base64 | tr -d '\n')
  echo "::add-mask::$auth"
  git config --local --unset-all "$key" 2>/dev/null
  git config --local "$key" "AUTHORIZATION: basic $auth"
  echo "用排程專用 GitHub App 的 token 推送"
else
  echo "::notice::沒有 DATA_PUSH_TOKEN（未設定排程專用 GitHub App），用預設 GITHUB_TOKEN 推送"
fi
for i in 1 2 3 4 5; do
  if git pull --rebase -X theirs -q origin "$branch" && git push -q origin "HEAD:$branch"; then echo "已寫回 $branch"; exit 0; fi
  git rebase --abort 2>/dev/null
  wait=$(( i * 5 + RANDOM % 7 )); echo "::warning::第 $i 次寫回失敗，${wait} 秒後重試"; sleep "$wait"
done
echo "::error::寫回 $branch 失敗（重試 5 次）"; exit 1
