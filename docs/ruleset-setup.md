# main 分支保護：兩階段設定步驟（#312 ruleset 前置 (c)）

由使用者本人在 GitHub 網頁操作。AI 不代為修改 repo 設定、ruleset、App 或 Secrets（AGENTS.md「核心限制」：權限變更須使用者授權）。
依據：#312 留言 6991405638（Antigravity ruleset 技術驗證）、6999184804（G1–G4）、7000194944（分工與兩階段）。

**完成第二階段之前，不得宣稱 main 已經有分支保護。** 目前「只能 merge」「CI `test` 通過才能合併」「不得直接推 main」都還是靠 AI 自律。

## 現況（2026-11-19，main `648eb5b`）
| 項目 | 現況 |
|---|---|
| ruleset／舊版分支保護 | 都沒有 |
| 合併方式 | merge commit、squash、rebase 全開；auto-merge 開啟 |
| `.github/CODEOWNERS` | 已有（#323），但要 ruleset 開「需要 Code Owner 審查」才生效 |
| 純文件 PR 的 `test` | #322 後每個 ready PR 都會產生 `test`；純文件 PR 不跑 unit／e2e，直接回報 success |
| 寫回 main 的排程 | 24 支，都經 `scripts/commit-data.sh` 用預設 `GITHUB_TOKEN` 推送（含 `workflow_run` 觸發的 `earn-hist.yml`） |

## 第一階段：只留 merge commit（不影響排程，可以馬上做）
1. 到 repo 的 **Settings → General → Pull Requests**。
2. 保留勾選 **Allow merge commits**。
3. 取消勾選 **Allow squash merging**、**Allow rebase merging**。
4. 取消勾選 **Allow auto-merge**。理由：所有 AI 共用 owner 帳號，預先掛上的 auto-merge 會在 CI 綠燈時直接合併，跳過使用者授權與升版步驟；而且 GitHub 的 auto-merge 目前不套用 ruleset bypass。
5. 其他選項（例如 Automatically delete head branches）維持原樣。

**對排程的影響**：沒有。`commit-data.sh` 的 `git pull --rebase` 是本機整理 commit，不是 PR 合併方式。

**設定後的確認**（Claude Code 唯讀查詢，結果貼到 #312）：
`allow_merge_commit: true`、`allow_squash_merge: false`、`allow_rebase_merge: false`、`allow_auto_merge: false`。

## 第二階段：main ruleset（前置條件都完成才做）
### 前置條件
| # | 條件 | 狀態 |
|---|---|---|
| 1 | 純文件 PR 也會產生 `test`（#322） | 已合併；要在第一個純文件 PR 實際確認 `test` 為 success |
| 2 | `.github/CODEOWNERS`（#323） | 已合併 |
| 3 | 24 支排程改用自訂 GitHub App 的 token 推送 | 未開始，見下方 |
| 4 | 第 3 項上線後，24 支排程（含 `earn-hist.yml` 的 `workflow_run`）都實際寫回 main 成功 | 未開始；由 Antigravity 確認 |

為什麼要先做第 3 項：預設 `GITHUB_TOKEN`（`github-actions[bot]`）**不能**加入 ruleset 的 bypass 清單。main 一開「必須透過 PR」，24 支排程的推送就會全部失敗。

### 前置 3：建立排程專用 GitHub App（使用者操作）
1. 到個人 **Settings → Developer settings → GitHub Apps → New GitHub App**。
2. 名稱自訂（例如 `taiex-data-sync`）；Homepage URL 填 repo 網址；**取消勾選 Webhook → Active**。
3. **Repository permissions** 只開 **Contents: Read and write**（Metadata: Read-only 會自動帶入），其他全部 No access。不要開 Workflows、Administration。
4. **Where can this GitHub App be installed?** 選 **Only on this account**，建立。
5. 在 App 頁面按 **Generate a private key**，下載 `.pem`。
6. 左側 **Install App** → 安裝到自己的帳號 → **Only select repositories** → 只選本 repo。
7. 到 repo **Settings → Secrets and variables → Actions**：
   - **Variables** 分頁新增 `DATA_APP_CLIENT_ID`，值是 App 設定頁（General → About）的 **Client ID**（`Iv` 開頭那串，不是數字的 App ID；`create-github-app-token` v3 改用 Client ID）。
   - **Secrets** 分頁新增 `DATA_APP_PRIVATE_KEY`，值是 `.pem` 檔的完整內容（含 `-----BEGIN` 與 `-----END` 兩行）。值只貼在 GitHub 設定頁，不要貼到對話、PR 或留言。
   - 名稱要完全一樣：workflow 只在 `DATA_APP_CLIENT_ID` 有值時才換 App token，沒值就照舊用 `GITHUB_TOKEN`。
8. 在 #312 留言告知「App 已建立、名稱已設定」（只寫名稱，不寫值）。

排程改用 App token 推送的程式由 #312 第二階段 PR 處理（24 支、27 個寫回步驟，各在寫回前一步換 token；`scripts/commit-data.sh` 收到 `DATA_PUSH_TOKEN` 就改用它推送）。這個 PR 可以在 App 建立前合併：變數沒設定時行為和現在一樣。這是 `.github/workflows/**` 的修改，需要獨立審查與使用者授權合併。注意事項（寫在該 PR 裡）：
- App token 推到 main **會**觸發 `on: push` 的 workflow；`commit-data.sh` 已固定加 `[skip ci]`，`ci.yml` 不會跑，但要逐支確認沒有其他 `on: push` 被觸發。
- action 固定到完整 commit SHA（G4 的做法）。
- 能改 main 上 workflow 的人就拿得到這把私鑰，所以這也是要開「需要 Code Owner 審查」的原因。

### 啟用 ruleset（前置 1–4 都完成後，使用者操作）
到 repo **Settings → Rules → Rulesets → New ruleset → New branch ruleset**：
1. **Ruleset name**：`main`；**Enforcement status**：Active。
2. **Target branches**：Add target → **Include default branch**。
3. **Bypass list**：只加入前置 3 的 GitHub App（模式選 Always allow）。是否另外加 owner，見下方「待使用者決定」。
4. 勾選規則：
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging**
     - Required approvals：0
     - **Allowed merge methods：只留 Merge**
     - **Require review from Code Owners**：依下方決定
   - **Require status checks to pass**
     - 加入 `test`，來源選 **GitHub Actions**
     - **不要勾** Require branches to be up to date before merging：排程每天推 main 幾十次，勾了 PR 會一直要求更新
5. **不要勾** Require linear history：它和「只允許 merge commit」互斥。
6. 儲存。

### 待使用者決定：Code Owner 審查與 owner bypass
GitHub 不允許 PR 作者核准自己的 PR；所有 AI 和使用者都用同一個 owner 帳號開 PR，所以一開「需要 Code Owner 審查」，改到 CODEOWNERS 路徑（`.github/`、`AGENTS.md`、`CLAUDE.md`、`.agent/`、`.claude/`、`vercel.json`、`scripts/commit-data.sh`、`scripts/vercel-ignore.mjs`）的 PR 就沒有人能核准。三選一：

| 選項 | 做法 | 代價 |
|---|---|---|
| A. 先不開 Code Owner 審查（建議先用這個） | 第 4 步不勾 Require review from Code Owners；bypass 只放 App | workflow 修改仍靠 AGENTS.md 的使用者授權規則，GitHub 不強制 |
| B. 開 Code Owner 審查＋owner bypass（For pull requests only） | bypass 清單加 Repository admin，模式選 For pull requests only | 共用帳號的 AI 同樣拿到 bypass，可以在 PR 頁略過 `test`；只靠規則約束 AI 不得使用 |
| C. 開 Code Owner 審查＋改由獨立 bot 帳號開 PR | 另建 bot 帳號給 AI 開 PR，使用者本人核准 | 要另外管理帳號與權限，設定最多 |

### 設定後的確認
- Claude Code：唯讀查詢 `rulesets` 與 `rules/branches/main`，核對上面每一項，結果貼到 #312。
- Antigravity：確認 24 支排程（含 `earn-hist.yml`）在 ruleset 啟用後仍寫回 main 成功，結果貼到 #312。
- 出問題時的回復方式：把 ruleset 的 Enforcement status 改成 Disabled（不用刪除），排程就恢復原本的推送方式。

## 不在這份步驟裡的事
- G3：排程用的密鑰改放 GitHub Environment（限定 main 或需核准）。要另外規劃，會動到 24 支 workflow。
- G4：`ci.yml` 與 24 支排程的 action 改固定到 commit SHA。可以併入前置 3 的 PR。
