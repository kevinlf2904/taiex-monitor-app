# KLineLab K線情報局（taiex-monitor-app）共用工作規則

這份是所有 AI 協作者（Claude Code、Gemini／Antigravity、ChatGPT）共用的規則。
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

- **角色**（使用者沒另外指定時照這個）：
  - **Claude Code — 主力開發**：改 API、前後端程式與模組、重構、寫測試；照任務開 `claude/…` 分支與 PR；PR 說明回報改了哪些檔案、為什麼改、測試結果。負責合併與發佈（版本號、README 更新紀錄）。
  - **Gemini／Antigravity — 整合與驗證**：在使用者電腦上打開 PR 的 Vercel 預覽網址或正式網站，實際操作頁面與使用者流程，檢查手機／電腦版面、錯誤提示、頁面跳轉、真實資料；協助瀏覽器端測試（要補測試時用 `gemini/…` 分支）。
  - **ChatGPT（GPT-6）— 獨立稽核與技術把關**：不寫要合併的程式，保持獨立。審查 PR 的差異與架構風險；檢查 API 權限、AI 成本、資料正確性、隱私；確認修改真的解決了問題；整合 Antigravity 的驗證結果找出遺漏；給合併／部署的風險判斷。透過 GitHub 連接器讀程式，ChatGPT 不會自己讀規則，開工時要它先讀這個檔案。
- **一個 PR 的流程**：
  1. Claude Code 開 PR（說明照 `.github/pull_request_template.md`）。
  2. Antigravity 用 PR 的預覽網址驗證，結果寫在 PR 留言，開頭寫「驗證：」，列出通過與發現的問題。
  3. ChatGPT 讀 PR 差異與驗證留言，給稽核結論：**可以合併／修改後再合併／不建議合併**，問題逐項寫檔案與行號（或網址）、問題、怎麼重現、嚴重度（P0 最急～P3）。寫在 PR 留言，或由使用者貼給 Claude Code。
  4. Claude Code 逐項驗證後修正，回覆哪些成立、哪些不成立或已經修過；有 P0／P1 就修好再回到第 2、3 步。
  5. CI 的 `test` 通過、沒有未處理的 P0／P1、使用者同意後，Claude Code 合併。使用者說「直接幫我合併」或只改文件、測試、緊急修正時，可以跳過第 2、3 步，合併後再補審。
- **別的 AI 的意見是待驗證的線索**：先在程式裡確認再動手，不要照單全收；判斷不同時把兩邊理由寫給使用者決定。
- **各用各的分支**：Claude Code 用 `claude/…`，Gemini／Antigravity 用 `gemini/…`。不要直接推 main，也不要推到別人的分支。
- **工作清單用 GitHub Issues**：一件事開一張，PR 說明寫 `Closes #N`，三個 AI 都看得到進度。
- **測試不花錢**：測試一律用假資料，不呼叫付費 API（Gemini、Claude）。
- **開工前先更新**：`git fetch origin main` 後合併進自己的分支。排程每天都會往 main 寫資料檔（`learner/data/…`）。
- **合併前才改版本號**：由合併的人看 main 上目前的版本往上加 1，避免兩邊用到同一個 `-N`。
- **一律走 PR**：CI 的 `test` 通過才合併，合併方式用 merge（不要 squash／rebase 別人的提交）。
- **大檔先上鎖**：`learner/watch.html`、`learner/index.html` 很大，容易衝突。要改它們時，先推一個提交並開 **draft PR**，標題寫「鎖：檔名＋區塊」（例：`鎖：watch.html ETF 分頁`），等於上鎖；開工前先看 open 的 PR，同一個檔案的同一區塊已經被鎖就改做別的，或等它合併。合併或放棄後鎖就解除。
- **交接**：PR 說明照 `.github/pull_request_template.md` 寫：誰做的、改了什麼、還有什麼沒做完、測試結果，另一個 AI 從 PR 接手。
- **「直接幫我合併」**：推上自己的開發分支 → 開 PR → 等 CI `test` 通過 → 用 merge 方式合併 → 分支重設到最新 main。Antigravity 用 `/merge`（`.agent/workflows/merge.md`）跑同一套步驟。
- **不要手改** `learner/data/` 裡排程產生的檔案，要改就改產生它的 `scripts/*.mjs`。

## 版本與發佈

- 版本號同時改 `learner/index.html`、`learner/watch.html`、`learner/version.json`（格式 `YYYY.MM.DD-N`）。
- `learner/README.md` 的更新紀錄：在最新一節前面加 `### 標題（版本）`。
- 會寫入資料的排程 workflow 只在 main 上執行；`probe-live.yml` 是唯讀的，可以用分支跑來看真實資料。

## 其他

- 密鑰只放 Vercel 環境變數或 GitHub secrets（repo 是公開的）。絕不寫進程式、測試、提交訊息或回覆。
- 開發環境不一定連得到外部網站（證交所、Yahoo、FRED…），連不到時要看真實資料用 `probe-live.yml`。
- 寫程式要跟周圍的程式風格一致（命名、註解密度、寫法）。
