# 訊號回測（選股條件的歷史勝率）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選股頁每個技術條件與 K 線組合都能看到「訊號出現後持有 5／10／20 個交易日」的歷史報酬、勝率與贏大盤幅度。

**Architecture:** 純計算函式放在 `learner/sigstudy.js`，網頁與排程（經 `scripts/_engine.mjs` 的 vm 沙盒）共用。`scripts/signal-study.mjs` 在 market-scan 排程裡用 `.cache/allk.json` 算好，寫成 `learner/data/signal-study.json`；網頁只讀這個檔。

**Tech Stack:** 原生 JS（瀏覽器全域函式，無建置）、Node 22 `node:test`、Playwright（E2E）、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-12-signal-study-design.md`

## Global Constraints

- 遵守 `AGENTS.md`：分支 `claude/…`、不推 main、一個 PR 一件事、合併要使用者說「直接幫我合併」。
- 改 `learner/watch.html` 前先開「鎖：」draft PR。
- 測試只用固定假資料，不連外。
- 不新增套件、不改架構。
- 新增的 localStorage 鍵：`watch:sign`（持有天數）、`watch:sigid`（選到的條件），經既有的 `store`。
- 常數：`SIG_NS = [5, 10, 20]`、`SIG_COST = 0.001425 * 2 + 0.003`、`SIG_WARM = 60`、`SIG_GAP = 5`、`SIG_MIN_LOTS = 500`、`SIG_MIN_N = 30`。
- 報酬是小數，四捨五入到 4 位；畫面文字用繁體中文，風格照周邊程式。
- 屬「策略／回測」高風險：PR 說明要請 Codex 獨立審查。

## Review Focus

1. K 棒有缺值（`o`、`c` 為 `null` 或 0）→ 該筆不計入，不丟例外、不產生 `NaN`。（Task 1 測試）
2. 某檔不到 61 根、或整個快取是空的 → 該檔略過；全部沒有樣本時腳本保留舊檔。（Task 1、2 測試）
3. 資料檔裡某個條件三種天數的 `stats` 全是 `null` → 排行表照樣畫出、排在最後、標「樣本不足」。（Task 4 測試）
4. 資料檔裡的條件 id 網頁不認得、或網頁有的 K 線格子資料檔沒有 → 排行照資料檔列；格子不顯示標記，不報錯。（Task 5 測試）
5. 股票名稱、條件名稱含 `<`、`&` → 一律經 `esc()`。（Task 4 測試）

---

## PR ①：`claude/signal-study`（核心＋腳本＋測試＋文件）

### Task 1: 計算核心

**Files:**
- Create: `learner/sigstudy.js`
- Modify: `scripts/_engine.mjs`（載入清單加 `"sigstudy.js"`；`ctx` 加 `KPAT: g("KPAT")` 與 `G`）
- Create: `tests/signal-study.test.mjs`
- Modify: `tests/run.mjs`（`files` 陣列在 `tpex-ic.test.mjs` 後面加 `signal-study.test.mjs`）

**Interfaces:**
- Consumes: `engine().indicators(D)`、K 棒 `{ d, o, h, l, c, v }`（`v` 單位：張）。
- Produces（都是 `learner/sigstudy.js` 最上層的全域函式；排程經 `engine().G.<名稱>` 取用）：
  - `sigForward(D, i, n, cost = SIG_COST) → number | null`
  - `sigScan(D, defs, ind, { warm, gap, minLots } = {}) → [{ id, i }]`，`defs: [{ id, hit(D, I) }]`
  - `sigMarket(all: Bar[][]) → Map<日期, 淨值>`
  - `sigStat(A: number[]) → { n, avg, med, p25, p75, win } | null`
  - `sigStudy(stocks, defs, ind, opts = {}) → [{ id, group, side, name, desc, stats, hist, recent }]`，`stocks: [{ c, n, bars }]`
  - 常數 `SIG_NS`、`SIG_COST`、`SIG_WARM`、`SIG_GAP`、`SIG_MIN_LOTS`、`SIG_MIN_N`

- [ ] **Step 1: 寫失敗的測試** `tests/signal-study.test.mjs`，用 `engine().G` 取函式，沙盒產生的物件先 `JSON.parse(JSON.stringify())` 再比。測試名稱與斷言：
  - 「隔天開盤進場、第 n 根收盤出場、扣成本」：訊號在第 5 根、第 6 根開 104、第 10 根收 120 → `sigForward(D, 5, 5) ≈ 120 / 104 − 1 − SIG_COST`；`sigForward(D, 5, 20) === null`。
  - 「一字漲停買不到、價格異常不算」：第 6 根 `o=h=l=c=110`（前收 100）→ `null`；第 8 根起收盤由 100 變 40 → `null`。
  - 「缺值不算、不產生 NaN」：第 6 根 `o` 為 `null`、或第 10 根 `c` 為 0 → `null`。
  - 「不偷看未來」：兩份資料只有第 70 根之後不同，`i ≤ 70` 的訊號清單相同；另用會記錄 `P.length` 的條件，確認第 i 天收到的長度正好是 `i + 1`。
  - 「去重與流動性」：永遠成立的條件、100 根 → `i` 為 `[60, 65, …, 95]`；量全是 100 張 → 0 筆。
  - 「不到 61 根略過」：`sigStudy` 給一檔 50 根 → 每個 `stats[n]` 都是 `null`、不丟例外。
  - 「sigStudy 統計」：一檔每天 +1、一檔每天 −1、永遠成立的條件 → `stats[5].n === 14`、`stats[5].win === 0.5`、`stats[20].n === 8`、`hist` 加總等於 `stats[20].n`、`recent[0].length === 6`。
  - 「真實條件接得上」：用 `engine().COND` 的 `kdgc` 與 `engine().KPAT[0]` 組成 `defs`，對 200 根固定亂數種子的資料跑 `sigStudy` 不丟例外、每個 `stats[n]` 是 `null` 或 `n > 0` 的物件。

- [ ] **Step 2: 確認失敗**
  Run: `node --test tests/signal-study.test.mjs`　Expected: FAIL（`engine().G` 是 `undefined`）

- [ ] **Step 3: 實作** `learner/sigstudy.js` 的六個常數與五個函式，並改 `scripts/_engine.mjs`。規則照規格「計算規則」表；`sigScan` 每天用 `D.slice(0, i + 1)`，同一天所有條件共用一次 `ind(P)`（第一個需要時才算）；條件丟例外視為不成立；`sigMarket` 與 `event-study.mjs` 的 `marketIndex` 相同算法；`hist` 的分界是 `[-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2]`；`recent` 每筆是 `[代號, 名稱, 訊號日, r5, r10, r20]`，依訊號日新到舊取 30 筆。

- [ ] **Step 4: 確認通過**
  Run: `node --test tests/signal-study.test.mjs && node tests/unit.test.mjs`　Expected: 全部 PASS（`unit.test.mjs` 確認 `_engine.mjs` 改動沒有弄壞別人）

- [ ] **Step 5: Commit**　`git add learner/sigstudy.js scripts/_engine.mjs tests/signal-study.test.mjs tests/run.mjs && git commit -m "訊號回測：計算核心"`

### Task 2: 排程腳本

**Files:**
- Create: `scripts/signal-study.mjs`
- Modify: `tests/signal-study.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `engine().G`、`engine().COND`、`engine().KPAT`、`engine().indicators`。
- Produces:
  - `export function sigDefs(E = engine()) → [{ id, group, side, name, desc, hit }]`：`COND` 中 id 不以 `s:` 開頭的 → `{ id: "c:" + id, group: "tech", side: null, name: condName(id), desc: "", hit: (D, I) => C[4](D, I, C[3]) }`；`KPAT` → `{ id: "k:" + id, group: "kline", side, name, desc, hit: D => k.hit(D) }`。
  - `export function build(H, E = engine(), now = new Date()) → object | null`：`H` 是 `.cache/allk.json` 的內容；回傳規格的資料檔物件；沒有任何樣本回傳 `null`。
  - `export async function main({ cache, out } = {})`：讀檔、呼叫 `build`、寫檔；`--dry` 不寫。
  - 輸出檔 `learner/data/signal-study.json`。

- [ ] **Step 1: 寫失敗的測試**
  - 「條件清單 27 個、id 不重複、沒有策略訊號」：`sigDefs().length === 27`、`new Set(ids).size === 27`、沒有 id 以 `c:s:` 開頭、`k:` 開頭的有 13 個。
  - 「build：只算四碼普通股」：`H.s` 放 `2330`（200 根）、`0050`、`00878`、`030001` → `out.stocks === 1`；`out.ns` 等於 `[5, 10, 20]`、`out.cost === 0.00585`、`out.minN === 30`、`out.defs.length === 27`、`out.from ≤ out.to`。
  - 「build：沒有樣本回傳 null」：`H.s` 只有一檔 30 根。
  - 「main：沒有快取時保留舊檔」：暫存資料夾裡先放一個舊的輸出檔、`cache` 指向不存在的路徑 → 執行後檔案內容不變、不丟例外。

- [ ] **Step 2: 確認失敗**　Run: `node --test tests/signal-study.test.mjs`　Expected: FAIL（找不到 `scripts/signal-study.mjs`）

- [ ] **Step 3: 實作** `scripts/signal-study.mjs`。檔頭註解寫清楚規則與輸出格式（照 `event-study.mjs` 的寫法）；警告用 `console.log("::warning::…")`；結尾 `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(…)`，失敗只印警告、結束碼 0。

- [ ] **Step 4: 確認通過**　Run: `node --test tests/signal-study.test.mjs`　Expected: PASS

- [ ] **Step 5: 用假的全市場快取量時間**
  在暫存資料夾產生 1800 檔 × 260 根的假快取，執行 `node scripts/signal-study.mjs --dry`（`cache` 用環境變數或參數指過去）。Expected: 10 分鐘內完成；把實測秒數寫進 PR 說明。

- [ ] **Step 6: Commit**　`git add scripts/signal-study.mjs tests/signal-study.test.mjs && git commit -m "訊號回測：排程腳本"`

---

## PR ②：`claude/signal-study-cron`（以 ① 為基底）

### Task 3: 接進 market-scan 排程

**Files:**
- Modify: `.github/workflows/market-scan.yml`（「commit event study」之後）

- [ ] **Step 1: 加兩個步驟**，條件與相鄰步驟一致：
  - `run: node scripts/signal-study.mjs`，`if: ${{ github.event.inputs.dry != '1' }}`，`continue-on-error: true`
  - `name: commit signal study`，`if: ${{ github.ref == 'refs/heads/main' && github.event.inputs.dry != '1' }}`，`env: COMMIT_NAME: signal-study`，`run: bash scripts/commit-data.sh "選股：更新訊號回測" learner/data/signal-study.json`
  檔頭註解補一句說明。
- [ ] **Step 2: 檢查** `node tests/unit.test.mjs`（有檢查 workflow 的測試）PASS；`timeout-minutes: 60` 不變（Task 2 Step 5 的實測時間要遠小於它）。
- [ ] **Step 3: Commit**　`git commit -am "訊號回測：接進 market-scan 排程"`

---

## PR ③：`claude/signal-study-ui`（以 ① 為基底；先開「鎖：learner/watch.html 選股分類」draft PR）

### Task 4: 「訊號回測」分類

**Files:**
- Modify: `learner/sigstudy.js`（加畫面函式）
- Modify: `learner/watch.html`（`LAZY` 加 `sig: ["sigstudy.js"]`；`SCR_GROUPS` 在 `rs` 後加 `["sig", "訊號回測"]`；選股渲染在 `combo` 分支旁加 `sig` 分支；點擊處理加 `data-sgn`、`data-sgid`）
- Modify: `learner/core.css`
- Create: `tests/e2e/sigstudy.test.mjs`

**Interfaces:**
- Consumes: `data/signal-study.json`；`watch.html` 的 `W`、`store`、`esc`、`qP`、`$`、`renderList`、`lazy`、`lazyOk`、`LZ_WAIT`、`tmo`、`exNote`。
- Produces:
  - `async function sgLoad()`：抓檔存到 `W.sig`（失敗存 `{ err }`），完成後若還在選股頁就 `renderList()`；`W.sigBusy` 防重複。
  - `function sgHtml() → string`：整個分類的 HTML。
  - 持有天數按鈕 `<button data-sgn="5|10|20">`；排行列 `<tr data-sgid="<id>">`；明細容器 `.sgdetail`；排行表 `.sgtbl`。

- [ ] **Step 1: 寫失敗的 E2E**（390 與 1280 各跑一次；照 `tests/e2e/plus.test.mjs` 的 `open`、`J`、`noHOverflow` 用法；mock `**/data/signal-study.json`，內容含：`k:boom` 樣本 312、`c:kdgc` 樣本 12、`c:macdgc` 三種天數都是 `null`、名稱含 `<b>` 的一筆 recent）：
  - 進選股 → 點「訊號回測」→ 出現 `.sgtbl`；第一列是 `k:boom`，文字含 `312` 與 `+3.4%`。
  - `c:kdgc` 與 `c:macdgc` 那兩列含「樣本不足」，且排在 `k:boom` 之後。
  - 點 `data-sgn="5"` → `store.get("watch:sign") === 5`，表內數字換成 5 日的。
  - 點 `k:boom` 那列 → `.sgdetail` 出現三種天數、分佈長條 10 根、最近案例；`store.get("watch:sigid") === "k:boom"`；頁面上沒有真的 `<b>` 元素被插入（`.sgdetail b.x` 不存在，文字照樣顯示）。
  - 畫面含「已下市的股票不在裡面」。
  - 另一個測試：資料檔回 404 → 顯示「還沒有回測資料」。
  - 兩者都 `noHOverflow` 且 console 錯誤為空。
- [ ] **Step 2: 確認失敗**　Run: `PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/sigstudy.test.mjs`　Expected: FAIL（找不到「訊號回測」）
- [ ] **Step 3: 實作** `sgLoad`、`sgHtml` 與 `watch.html` 的接線，版面照規格「畫面」一節；表格用既有的 `.ctbl` 包住以便手機橫向捲動。
- [ ] **Step 4: 確認通過**　Run: 同 Step 2，再加 `tests/e2e/pf-mobile.test.mjs tests/e2e/pf-tablet-kbd.test.mjs tests/e2e/plus.test.mjs`　Expected: PASS
- [ ] **Step 5: Commit**　`git commit -am "訊號回測：選股分類"`

### Task 5: K 線格子上的勝率標記

**Files:**
- Modify: `learner/sigstudy.js`、`learner/watch.html`（K 線、技術格子的 `tiles` 樣板）、`learner/core.css`、`tests/e2e/sigstudy.test.mjs`

**Interfaces:**
- Produces: `function sgBadge(id) → string`：`W.sig` 有這個 id 且 `stats[20].n ≥ SIG_MIN_N` 時回傳 `<small class="sgbadge">20 日贏大盤 +1.2%・勝率 54%・312 筆</small>`，否則空字串；`W.sig` 還沒載入時在背景呼叫 `sgLoad()`。

- [ ] **Step 1: 寫失敗的 E2E**：進選股「K線」分類 → `[data-so="k:boom"] .sgbadge` 文字符合 `/20 日贏大盤 \+1\.2%・勝率 54%・312 筆/`；資料檔沒有的格子與樣本不足的格子沒有 `.sgbadge`；390 寬度不溢出。
- [ ] **Step 2: 確認失敗**　Run: 同 Task 4 Step 2　Expected: FAIL
- [ ] **Step 3: 實作** `sgBadge` 並接到 `tiles`。
- [ ] **Step 4: 確認通過**　Run: 同 Task 4 Step 4　Expected: PASS
- [ ] **Step 5: Commit**　`git commit -am "訊號回測：K 線格子標記"`

---

## 收尾

- 三個 PR 都照 `.github/pull_request_template.md` 填寫；① 與 ② 的「驗證重點」請 Codex 看未來資料洩漏、成本與排程失敗時的行為；③ 請 Antigravity 驗 390／1280。
- 升版本號（`scripts/bump-version.mjs`）留到合併時做。
