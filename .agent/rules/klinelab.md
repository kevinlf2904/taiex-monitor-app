# KLineLab K線情報局（taiex-monitor-app）共用工作規則

這份是所有 AI 協作者（Claude Code、Gemini／Antigravity、ChatGPT）共用的規則。ChatGPT 不會自己讀，開工時要它先讀這個檔案。
`.agent/rules/klinelab.md` 是給 Antigravity 讀的同一份內容，兩個檔案必須完全一樣（`tests/unit.test.mjs` 會檢查），改一個就要複製到另一個。
`CLAUDE.md` 會引用這份，另外只寫 Claude Code 專用的事。

使用者用繁體中文溝通，常用 iPhone／iPad，回覆一律用繁體中文。

## 每次收到指令都要自動做（使用者的常駐要求）

除了完成指令本身，每一輪都順便做下面五件事，並在回覆裡簡短交代結果：

1. **優化介面**：檢查這次改到的頁面在手機（390 寬、觸控）與電腦（1280 寬）都沒有橫向溢出、文字重疊、版面跳動。
2. **優化使用**：操作流程是否順手（按鈕位置、預設值、載入提示、記住上次的設定）。
3. **整理重複功能**：發現兩處做同一件事的程式或介面就合併。
4. **回測所有技術線型是否有錯誤**：`tests/unit.test.mjs` 的「所有策略回測合理性」「價格行為策略」會檢查每個策略不偷看未來、停損有效、加成本不會變好；新增策略要能通過。
5. **自動偵錯**：跑完整測試 `node tests/run.mjs`（瀏覽器測試會收集 console 錯誤），有錯就修。第一次在新電腦跑：`npm i --no-save playwright@1.56.1 && npx playwright install chromium`（跟 CI 一樣）。Playwright 裝在別處時用 `PW=<playwright 安裝路徑> node tests/run.mjs`。

## 多個 AI 一起協作

- **各用各的分支**：Claude Code 用 `claude/…`，Gemini／Antigravity 用 `gemini/…`，ChatGPT 用 `chatgpt/…`。不要直接推 main，也不要推到別人的分支。
- **分工**（使用者沒指定時的預設；照檔案分區，同一個區塊同一時間只給一個 AI 做）：
  - ChatGPT：後端與防護——`api/`（AI 費用上限、限流、輸入驗證、Podcast、同步）、`scripts/` 的資料處理、對應的單元測試；部署前驗收（設定、回歸風險、回滾方式）；審查別人的 PR、整站稽核。
  - Claude Code：前端功能——`learner/` 的頁面與 JS（含 `watch.html`、`index.html`）、瀏覽器測試（`tests/e2e/`）；CI 失敗修復；**統一合併與發佈**（版本號、README 更新紀錄）。
  - Gemini／Antigravity：畫面細節與真實資料驗證——在使用者電腦上打開正式網站／預覽網址，看手機與電腦版面、資料對不對，小改 CSS 與文字。
  - 跨區的工作（例如新 API＋新頁面）：先做後端的 AI 開 PR，合併後另一個再接前端，PR 說明寫清楚介面（網址、參數、回傳格式）。
- **工作清單用 GitHub Issues**：一件事開一張，標題前面寫給誰（例：`[ChatGPT] 同步 API 加輸入驗證`），開工時在 issue 留言「開始」、PR 說明寫 `Closes #N`。三個 AI 都看得到誰在做什麼。
- **別的 AI 的報告是待驗證的線索**：先在程式裡確認，再動手；回報時列出哪些成立、哪些不成立或已經修過，不要照單全收。
- **互相審查**：PR 開好後可以請另一個 AI 看（例如把 PR 網址給 ChatGPT）。審查意見由開 PR 的 AI 處理，不要直接推到別人的分支。
- **ChatGPT 的報告格式**：每一項寫檔案與行號（或網址）、問題、怎麼重現、嚴重度（P0 最急～P3），方便另一個 AI 驗證。
- **測試不花錢**：測試一律用假資料，不呼叫付費 API（Gemini、Claude）。本機跑不了完整測試（例如沒有瀏覽器）時，至少跑 `node --test tests/unit.test.mjs`，PR 說明寫跑了哪些，其餘靠 CI 的 `test`。
- **開工前先更新**：`git fetch origin main` 後合併進自己的分支。排程每天都會往 main 寫資料檔（`learner/data/…`）。
- **版本號由合併的人改**：開 PR 的 AI 不用改版本號、README 更新紀錄；合併前由 Claude Code（或使用者指定的人）看 main 上目前的版本往上加 1 再合併，避免兩邊用到同一個 `-N`。
- **一律走 PR**：CI 的 `test` 通過才合併，合併方式用 merge（不要 squash／rebase 別人的提交）。
- **大檔先上鎖**：`learner/watch.html`、`learner/index.html` 很大，容易衝突。要改它們時，先推一個提交並開 **draft PR**，標題寫「鎖：檔名＋區塊」（例：`鎖：watch.html ETF 分頁`），等於上鎖；開工前先看 open 的 PR，同一個檔案的同一區塊已經被鎖就改做別的，或等它合併。合併或放棄後鎖就解除。
- **交接**：PR 說明照 `.github/pull_request_template.md` 寫：誰做的、改了什麼、還有什麼沒做完、測試結果，另一個 AI 從 PR 接手。
- **「直接幫我合併」**：推上自己的開發分支 → 開 PR → 等 CI `test` 通過 → 用 merge 方式合併 → 分支重設到最新 main。Antigravity 用 `/merge`（`.agent/workflows/merge.md`）跑同一套步驟。ChatGPT、Antigravity 開的 PR 預設由 Claude Code 驗證後合併；使用者也可以自己按。
- **不要手改** `learner/data/` 裡排程產生的檔案，要改就改產生它的 `scripts/*.mjs`。

## 版本與發佈

- 版本號同時改 `learner/index.html`、`learner/watch.html`、`learner/version.json`（格式 `YYYY.MM.DD-N`）。
- `learner/README.md` 的更新紀錄：在最新一節前面加 `### 標題（版本）`。
- 會寫入資料的排程 workflow 只在 main 上執行；`probe-live.yml` 是唯讀的，可以用分支跑來看真實資料。

## 其他

- 密鑰只放 Vercel 環境變數或 GitHub secrets（repo 是公開的）。絕不寫進程式、測試、提交訊息或回覆。
- 開發環境不一定連得到外部網站（證交所、Yahoo、FRED…），連不到時要看真實資料用 `probe-live.yml`。
- 寫程式要跟周圍的程式風格一致（命名、註解密度、寫法）。
