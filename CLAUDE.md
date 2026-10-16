# K線學堂（taiex-monitor-app）工作規則

使用者用繁體中文溝通，常用 iPhone／iPad，回覆一律用繁體中文。

## 每次收到指令都要自動做（使用者的常駐要求）

除了完成指令本身，每一輪都順便做下面五件事，並在回覆裡簡短交代結果：

1. **優化介面**：檢查這次改到的頁面在手機（390 寬、觸控）與電腦（1280 寬）都沒有橫向溢出、文字重疊、版面跳動。
2. **優化使用**：操作流程是否順手（按鈕位置、預設值、載入提示、記住上次的設定）。
3. **整理重複功能**：發現兩處做同一件事的程式或介面就合併。
4. **回測所有技術線型是否有錯誤**：`tests/unit.test.mjs` 的「所有策略回測合理性」「價格行為策略」會檢查每個策略不偷看未來、停損有效、加成本不會變好；新增策略要能通過。
5. **自動偵錯**：跑完整測試 `PW=/opt/node22/lib/node_modules/playwright node tests/run.mjs`（瀏覽器測試會收集 console 錯誤），有錯就修。

## 版本與發佈

- 版本號同時改 `learner/index.html`、`learner/watch.html`、`learner/version.json`（格式 `YYYY.MM.DD-N`）。
- `learner/README.md` 的更新紀錄：在最新一節前面加 `### 標題（版本）`。
- 使用者要求「直接幫我合併」：推上開發分支 → 開 PR → 等 CI `test` 通過 → 用 merge 方式合併 → 分支重設到最新 main。
- 會寫入資料的排程 workflow 只在 main 上執行；`probe-live.yml` 是唯讀的，可以用分支跑來看真實資料。

## 其他

- 密鑰只放 Vercel 環境變數或 GitHub secrets（repo 是公開的）。
- 開發環境連不到外部網站（證交所、Yahoo、FRED…），要看真實資料用 `probe-live.yml`。
