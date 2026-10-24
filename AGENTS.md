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

- **各用各的分支**：Claude Code 用 `claude/…`，Gemini／Antigravity 用 `gemini/…`，ChatGPT 能推程式時用 `chatgpt/…`。不要直接推 main，也不要推到別人的分支。
- **分工**（使用者沒指定時的預設，同一個區塊同一時間只給一個 AI 做）：
  - Claude Code：跨檔案的功能、API 與排程、合併與發佈。
  - Gemini／Antigravity：使用者指定的頁面或區塊。
  - ChatGPT：審查別人的 PR、整站稽核、Vercel 與外部資料檢查、提出測試案例。透過 GitHub 連接器讀程式；報告由使用者貼給要動手的 AI，或寫在 PR 留言。
- **別的 AI 的報告是待驗證的線索**：先在程式裡確認，再動手；回報時列出哪些成立、哪些不成立或已經修過，不要照單全收。
- **互相審查**：PR 開好後可以請另一個 AI 看（例如把 PR 網址給 ChatGPT）。審查意見由開 PR 的 AI 處理，不要直接推到別人的分支。
- **ChatGPT 的報告格式**：每一項寫檔案與行號（或網址）、問題、怎麼重現、嚴重度（P0 最急～P3），方便另一個 AI 驗證。
- **開工前先更新**：`git fetch origin main` 後合併進自己的分支。排程每天都會往 main 寫資料檔（`learner/data/…`）。
- **合併前才改版本號**：避免兩邊用到同一個 `-N`。合併前看 main 上目前的版本，往上加 1。
- **一律走 PR**：CI 的 `test` 通過才合併，合併方式用 merge（不要 squash／rebase 別人的提交）。
- **大檔先上鎖**：`learner/watch.html`、`learner/index.html` 很大，容易衝突。要改它們時，先推一個提交並開 **draft PR**，標題寫「鎖：檔名＋區塊」（例：`鎖：watch.html ETF 分頁`），等於上鎖；開工前先看 open 的 PR，同一個檔案的同一區塊已經被鎖就改做別的，或等它合併。合併或放棄後鎖就解除。
- **交接**：PR 說明照 `.github/pull_request_template.md` 寫：誰做的、改了什麼、還有什麼沒做完、測試結果，另一個 AI 從 PR 接手。
- **「直接幫我合併」**：推上自己的開發分支 → 開 PR → 等 CI `test` 通過 → 用 merge 方式合併 → 分支重設到最新 main。Antigravity 用 `/merge`（`.agent/workflows/merge.md`）跑同一套步驟。ChatGPT 開的 PR 由使用者或 Claude Code／Antigravity 照這套步驟合併。
- **不要手改** `learner/data/` 裡排程產生的檔案，要改就改產生它的 `scripts/*.mjs`。

## 版本與發佈

- 版本號同時改 `learner/index.html`、`learner/watch.html`、`learner/version.json`（格式 `YYYY.MM.DD-N`）。
- `learner/README.md` 的更新紀錄：在最新一節前面加 `### 標題（版本）`。
- 會寫入資料的排程 workflow 只在 main 上執行；`probe-live.yml` 是唯讀的，可以用分支跑來看真實資料。

## 其他

- 密鑰只放 Vercel 環境變數或 GitHub secrets（repo 是公開的）。絕不寫進程式、測試、提交訊息或回覆。
- 開發環境不一定連得到外部網站（證交所、Yahoo、FRED…），連不到時要看真實資料用 `probe-live.yml`。
- 寫程式要跟周圍的程式風格一致（命名、註解密度、寫法）。
