# 庫存分頁整併 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 庫存的兩層分頁（5＋7）併成一排 7 個主分頁，其中「持股」「配置與風險」各有一排子分頁；功能、數字、存檔都不變。

**Architecture:** 內部狀態不改（`W.holdView` ＋ `W.lg.view`）。`watch.html` 新增一張對照表 `HOLD_NAV` 與 `holdPage()`／`holdGo(page)`，`#lTools` 裡畫主分頁 `#hvSeg` 與子分頁 `#hsubSeg`；`ledger-ui.js` 的 `lgViewSeg()` 改回傳空字串。分頁按鈕保留舊的 `data-hv` 與 `data-lg="view" data-v` 屬性，既有測試的選擇器大多還能用。

**Tech Stack:** 原生 HTML／JS、`node --test`、Playwright（`PW=/opt/node22/lib/node_modules/playwright`）。

**Spec:** `docs/superpowers/specs/2026-11-13-hold-tabs-merge-design.md`

## Global Constraints

- 不改寫、搬移、清除任何 localStorage；不新增資料鍵。`watch:hv` 的值仍只會是 `pnl｜ana｜risk｜macro｜tx`。
- 不改任何計算；`pf-*.js`、`ledger.js`、`perf.js` 等不動。
- 不刪測試、不放寬斷言；只改「怎麼點到那一頁」。
- 改 `learner/watch.html` 前先開鎖定用 draft PR「鎖：watch.html＋庫存分頁列」。
- 測試只用假資料；本機只跑相關檔案，完整結果以同一 head SHA 的 CI `test` 為準。
- 不合併；等使用者明確說可以。提交訊息與 PR 不寫模型名稱。

## Review Focus

1. 只有舊庫存（沒有 `kline:pf:v1`）的人點「總覽／績效／股利／論點／交易紀錄／配置」：要看到建立說明，不是空白或錯誤。
2. `watch:hv` 存著 `tx`、重新整理：要落在「總覽」，主分頁選取狀態正確。
3. 在「報告（可列印）」頁：主分頁列「總覽」是選取狀態；列印時分頁列不印出來（原本靠 `#lx .lgview` 的列印樣式）。
4. 390 寬：7 個主分頁可橫向捲動、頁面本身不橫向溢出；選到後面的分頁時看得到它。
5. 盤中每秒重畫（`W.ticking`）：分頁列重畫後橫向捲動位置不跳回最左（現有 `hsKeep` 以 `#lTools > .seg` 為對象）。

每一項的測試都放在 Task 2 的新測試檔。

---

### Task 1：鎖定

- [ ] 確認沒有同區塊的 draft PR（已查：目前沒有開啟中的 PR）。
- [ ] 以目前分支開 draft PR，標題「鎖：watch.html＋庫存分頁列」，內文依 `.github/pull_request_template.md`。

### Task 2：新測試（先失敗）

**Files:**
- Modify: `tests/e2e/_harness.mjs`（新增 `holdGo`）
- Create: `tests/e2e/hold-nav.test.mjs`

**Interfaces — Produces:**
- `export async function holdGo(p, page)`：`page` 是 `home｜pnl｜ana｜perf｜alloc｜risk｜macro｜margin｜div｜thesis｜tx` 之一。先點主分頁 `#hvSeg [data-nav="<group>"]`，該頁是子分頁時再點 `#hsubSeg [data-nav="<page>"]`，等 `#hvSeg`／`#hsubSeg` 的 `aria-pressed` 反映後回傳。群組：`pnl、ana → stock`；`alloc、risk、macro、margin → risk`；其餘 group＝page。

- [ ] **寫測試**（照 `tests/e2e/pf-home.test.mjs` 的開頁與假資料方式；各跑 390 與 1280）：
  - `一排主分頁`：`#hvSeg button` 的文字依序為 `總覽、持股、績效、配置與風險、股利、論點、交易紀錄`；`document.querySelectorAll(".lgview").length === 0`。
  - `11 個頁面都到得了`：有交易紀錄時，對每個 page 呼叫 `holdGo` 後斷言該頁的標記元素存在（home `.hmcard`、perf `.pfcard`、alloc `.alcard`、tx `[data-lg=add]`，其餘用該頁現有測試所等的選擇器），並斷言主／子分頁的 `aria-pressed`。
  - `子分頁只在該群組出現`：在 `perf` 時 `#hsubSeg` 不存在或 hidden；`stock` 時子分頁文字為 `損益、屬性分析`；`risk` 時為 `配置、風險、總經敏感度、融資`。
  - `只有舊庫存`（Review Focus 1）：沒有 `kline:pf:v1` 時，`home、perf、alloc、div、thesis、tx` 都顯示建立說明（`[data-lg=migrate]` 或說明頁現有的選擇器），`pnl、ana、risk、macro、margin` 照常；全程沒有 console 錯誤。
  - `重新整理`（Review Focus 2）：到 `perf` 後 reload → 主分頁「總覽」選取；到 `ana` 後 reload → 「持股／屬性分析」選取；`localStorage["kline:watch:hv"]` 的值屬於 `pnl｜ana｜risk｜macro｜tx`。
  - `報告`（Review Focus 3）：從總覽點「報告（可列印）」後主分頁「總覽」選取；`emulateMedia({ media: "print" })` 時 `#hvSeg` 的 `visibility`／`display` 為隱藏。
  - `手機`（Review Focus 4）：390 寬每個 page 都 `noHOverflow`；點「交易紀錄」後該按鈕在 `#hvSeg` 的可視範圍內；分頁按鈕高度 ≥ 現有 `pf-home.test.mjs` 對 `.lgview button` 用的門檻。
  - `重畫不跳`（Review Focus 5）：390 寬到 `tx` 後呼叫 `renderList()`，`#hvSeg.scrollLeft` 不變。
  - `編輯按鈕`：`.imp-btns` 只在 `pnl、ana` 看得到。
  - `存檔沒被動`：整段操作前後 `kline:watch:hold`、`kline:pf:v1` 的字串完全相同；`localStorage` 沒有多出新的鍵（`watch:hv` 除外）。
- [ ] 跑 `PW=/opt/node22/lib/node_modules/playwright node --test --test-concurrency=1 tests/e2e/hold-nav.test.mjs`，預期失敗（找不到 `[data-nav]`）。

### Task 3：實作

**Files:**
- Modify: `learner/watch.html`（約 463 的 `#hvSeg` 樣式、2144–2145 的分頁列、2231–2232 的點擊處理、列印樣式）
- Modify: `learner/ledger-ui.js:177`（`lgViewSeg`）
- Modify: `learner/pf-report.js` 只在列印樣式需要時才動（優先改 CSS，不動 JS）

**Interfaces — Produces（`watch.html`，全域）：**
- `HOLD_NAV`：`[group, 標題, 子分頁?]` 的陣列：
  `["home","總覽"]`、`["stock","持股",[["pnl","損益"],["ana","屬性分析"]]]`、`["perf","績效"]`、`["risk","配置與風險",[["alloc","配置"],["risk","風險"],["macro","總經敏感度"],["margin","融資"]]]`、`["div","股利"]`、`["thesis","論點"]`、`["tx","交易紀錄"]`。
- `holdPage() → string`：`W.holdView !== "tx"` 時回 `W.holdView`；否則回 `W.lg?.view || "home"`，其中 `report` 視為 `home`。
- `holdGo(page)`：`pnl｜ana｜risk｜macro` → `W.holdView = page`；其餘 → `W.holdView = "tx"`，`(W.lg ||= { open: null, form: null, prev: null, msg: "" }).view = page`、`W.lg.form = null`。接著 `store.set("watch:hv", W.holdView)`、`renderList()`。點主分頁時落在該群組的第一個子分頁。

- [ ] 分頁列：`#hvSeg` 畫 7 個主分頁，按鈕帶 `data-nav="<group>"`，並保留相容屬性（落在 `tx` 側的帶 `data-hv="tx" data-lg="view" data-v="<page>"`，落在舊庫存側的帶 `data-hv="<page>"`）；`aria-pressed` 依 `holdPage()` 所屬群組。有子分頁的群組在 `#lTools` 再畫 `#hsubSeg`（class `seg`），按鈕帶 `data-nav="<page>"` 與同樣的相容屬性。
- [ ] 點擊：`#lTools` 的處理先看 `[data-nav]` → `holdGo`；原本的 `[data-hv]` 分支移除（已被取代）。`[data-hsrc="tx"]` 改成 `holdGo("tx")`。
- [ ] `.imp-btns` 只在 `holdPage()` 是 `pnl｜ana` 時畫（維持 `W.holdLg` 時 hidden）。
- [ ] `lgViewSeg()` 回傳 `""`（保留函式，`pf-*.js` 仍會呼叫）。
- [ ] 樣式：`#hvSeg` 佔整列、可橫向捲動（沿用 `#lTools > .seg` 既有做法）；選取的分頁重畫後捲到可視範圍；列印時隱藏 `#lTools`（或 `#hvSeg, #hsubSeg`）。
- [ ] 跑 Task 2 的測試，預期全過。
- [ ] 截圖自查 390 與 1280（每個 page 各一張，`deviceScaleFactor: 1`）：沒有溢出、重疊、跳動。
- [ ] Commit：「庫存：兩層分頁併成一排」。

### Task 4：既有測試的導覽

**Files:** `tests/e2e/*.test.mjs` 中用到 `data-hv`、`.lgview`、`[data-lg=view]` 的檔案（約 29 個）。

- [ ] 跑這批檔案，列出失敗的。
- [ ] 只改導覽：`[data-hv="ana|risk|macro"]`、`[data-lg=view][data-v=margin]` 這類現在在子分頁的，改用 `holdGo`；`.lgview button`、`#lx .lgview` 改成 `#hvSeg`／`#hsubSeg` 對應的選擇器。斷言的內容與門檻不動。
- [ ] 另跑 `tests/e2e/pf-mobile.test.mjs`、`tests/e2e/pf-tablet-kbd.test.mjs`、`node tests/unit.test.mjs`。
- [ ] 全部通過（已知環境失敗只有 Issue #236 第 2 項）後 Commit：「測試：庫存分頁改用新的導覽」。

### Task 5：文件、版本、送審

- [ ] `docs/portfolio/*.md`、`learner/README.md` 內寫到「庫存 → 交易紀錄 → …」操作路徑的句子改成新路徑（`grep -n "交易紀錄 →\|→ 交易紀錄" docs/portfolio learner/README.md`）。
- [ ] `git fetch origin main` 並合入；`node scripts/bump-version.mjs "庫存分頁整併" "庫存的兩層分頁併成一排：總覽、持股、績效、配置與風險、股利、論點、交易紀錄；功能與數字不變"`；`node tests/unit.test.mjs`。
- [ ] 一次推送；draft PR 轉 ready、改正式標題、填範本（驗證重點：390／1280、配置與風險切子分頁時的版面切換、只有舊庫存的情況）。
- [ ] 背景輪詢同一 head SHA 的 CI `test`；失敗就在本機重現並修。
- [ ] 回報：改了什麼、測試與 CI、PR；請使用者安排 Antigravity 驗證，等「直接幫我合併」。
