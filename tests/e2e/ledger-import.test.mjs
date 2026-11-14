// 交易紀錄截圖匯入（選項 1 庫存轉入 ＋ 選項 2 成交明細／對帳單）：雙入口、兩種模式完整流程、日期待確認標籤、
// 分批不合併、明確 0 與空白估算費稅、當沖勾選、降冪排序、擋賣超／無效代號／重複交易勾選確認、IME、焦點鎖定與手機桌面版面。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, holdGo, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

// 合法 1×1 透明 PNG（測試 shrink() 讀圖與 filechooser）
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const MOCK_STOCKS = [
  ["2330", "台積電", "上市"],
  ["0050", "元大台灣50", "上市"],
  ["2317", "鴻海", "上市"],
  ["2454", "聯發科", "上市"],
  ["6488", "環球晶", "上櫃"],
  ["00679B", "元大美債20年", "上櫃"],
  ["00403A", "主動中信成長", "上市"],
];
const KNOWN_US = new Set(["NVDA", "AAPL", "BRK-B", "BRK.B", "TSM", "SPY"]);
const OLD_HOLD = { 2330: { sh: 1000, cost: 500, d: "2025-01-02" } };

async function setupRoutes(ctx, importHandler) {
  await ctx.route("**/api/stocks**", r => r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, list: MOCK_STOCKS }),
  }));
  await ctx.route("**/api/quote**", r => {
    const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean);
    const known = new Set(MOCK_STOCKS.map(x => x[0]));
    const quotes = codes
      .filter(c => known.has(c) || KNOWN_US.has(c))
      .map((c, i) => ({
        code: c,
        name: MOCK_STOCKS.find(x => x[0] === c)?.[1] || c,
        price: 100 + i * 10,
        prev: 99 + i * 10,
        open: 100 + i * 10,
        high: 105 + i * 10,
        low: 98 + i * 10,
        vol: 1000,
        chg: 1,
        chgPct: 1,
        date: "2026-10-05",
        time: "10:30:05",
        market: /^\d/.test(c) ? "上市" : "美股",
        bids: [],
        asks: [],
      }));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "open", today: "2026-10-05", quotes }) });
  });
  await ctx.route("**/api/symbol**", r => {
    const q = new URL(r.request().url()).searchParams.get("q") || "";
    const items = /環球|晶晶/.test(q) ? [{ code: "6488", name: "環球晶" }] : [];
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
  });
  await ctx.route("**/api/import**", async r => {
    const body = JSON.parse(r.request().postData() || "{}");
    const out = await importHandler(body);
    r.fulfill({
      status: out.status || 200,
      contentType: "application/json",
      body: JSON.stringify(out.body),
    });
  });
}

async function pickFileVia(p, selector) {
  const [fc] = await Promise.all([
    p.waitForEvent("filechooser"),
    p.click(selector),
  ]);
  await fc.setFiles({ name: "shot.png", mimeType: "image/png", buffer: TINY_PNG });
}

for (const width of [390, 1280]) {
  test(`${width}：選項 1 持股截圖匯入、略過已有部位、＋再加截圖保留勾選、代號檢核與舊庫存不動`, async () => {
    const touch = width < 500;
    const impRequests = [];
    let shotSeq = 0;
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch });
    await setupRoutes(ctx, body => {
      impRequests.push({ mode: body.mode, nImgs: body.images?.length });
      shotSeq++;
      if (shotSeq === 1) {
        // 初次從空白交易紀錄匯入：2330（推算成本）、NVDA（美股小數股數）、T00（指數，需擋下）
        return {
          body: {
            ok: true,
            mode: "holdings",
            rows: [
              { name: "台積電", code: "2330", shares: 1000, price: 900, totalPnl: 100000 },
              { name: "輝達", code: "NVDA", shares: 5.5, avgCost: 120 },
              { name: "加權指數", code: "T00", shares: 1, avgCost: 22000 },
            ],
          },
        };
      }
      if (shotSeq === 2) {
        // 已有帳本再匯入第一張：2330（已有部位）、NVDA（已有部位）、2317（曾買已全數賣出）
        return {
          body: {
            ok: true,
            mode: "holdings",
            rows: [
              { name: "台積電", code: "2330", shares: 500, avgCost: 850 },
              { name: "輝達", code: "NVDA", shares: 3, avgCost: 130 },
              { name: "鴻海", code: "2317", shares: 1000, avgCost: 160 },
            ],
          },
        };
      }
      if (shotSeq === 3) {
        // ＋ 再加截圖失敗：保留原有列與使用者勾選狀態
        return { body: { ok: false, error: "這張截圖太模糊" } };
      }
      // shotSeq === 4：＋ 再加截圖成功合併 0050，且不覆寫已存在的 2330 不勾選狀態
      return {
        body: {
          ok: true,
          mode: "holdings",
          rows: [
            { name: "台積電", code: "2330", shares: 500, avgCost: 860 },
            { name: "元大台灣50", code: "0050", shares: 2000, avgCost: 185 },
          ],
        },
      };
    });

    await p.evaluate(old => {
      localStorage.setItem("kline:watch:hold", JSON.stringify(old));
      localStorage.removeItem("kline:pf:v1");
      localStorage.removeItem("kline:watch:stocks2");
      W.stocks = null;
    }, OLD_HOLD);
    await p.reload();
    await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
    await p.evaluate(() => { W.holdMkt = "tw"; setLt("hold"); });
    await p.waitForSelector("#hvSeg");
    await holdGo(p, "tx");
    await p.waitForSelector('#lx [data-lg="imp"]');

    // Part A：首次建立（lgIntroHtml 入口）→ 選成本算法 FIFO → 檢核指數與查無代號
    await p.click('#lx [data-lg="imp"]');
    await p.waitForSelector('#impSheet:not([hidden]) [data-lgimp-pick="holdings"]');
    assert.equal(await p.evaluate(() => document.activeElement?.dataset?.lgimpPick), "holdings", "開啟選單預設聚焦選項 1");

    await pickFileVia(p, '[data-lgimp-pick="holdings"]');
    await p.waitForSelector("#lgImpForm");
    assert.equal(impRequests[0].mode, "holdings");

    // 確認「T00」初始就標為錯誤且聚焦到第一個錯誤欄位
    const t00Invalid = await p.evaluate(() => {
      const inp = document.querySelector('#lgImpTbody tr[data-row="2"] [data-lgimp-k="code"]');
      return {
        inv: inp?.getAttribute("aria-invalid"),
        active: document.activeElement === inp,
        err: document.querySelector('#lgImpTbody tr[data-row="2"] .lgimp-err')?.textContent,
      };
    });
    assert.equal(t00Invalid.inv, "true");
    assert.equal(t00Invalid.active, true);
    assert.match(t00Invalid.err, /僅支援台股與美股/);

    // 沒有帳本時顯示 FIFO 選單；選 FIFO
    await p.selectOption("#lgImpMethod", "fifo");
    assert.ok(await noHOverflow(p), `${width} 選項 1 檢視沒有水平溢出`);

    // 測試查不到代號（台股 9999、美股 ZZZZ）皆會被 verifyCodes 擋下
    const codeRow2 = '#lgImpTbody tr[data-row="2"] [data-lgimp-k="code"]';
    await p.fill(codeRow2, "9999");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /查不到代號：9999/.test($("#impLive")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="2"] [data-lgimp-k="code"]')?.getAttribute("aria-invalid")), "true");

    await p.fill(codeRow2, "ZZZZ");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /查不到代號：ZZZZ/.test($("#impLive")?.textContent || ""));

    // 中文名稱離開欄位時經 /api/symbol 自動查詢代號（晶晶生技 → 6488）
    await p.fill(codeRow2, "晶晶生技");
    await p.press(codeRow2, "Tab");
    await p.waitForFunction(sel => document.querySelector(sel)?.value === "6488", codeRow2);

    // 刪除該列：焦點交接給上一列的刪除鈕
    await p.click('#lgImpTbody tr[data-row="2"] [data-lgimp-del]');
    await p.waitForFunction(() => document.querySelectorAll("#lgImpTbody tr").length === 2);
    assert.equal(await p.evaluate(() => document.activeElement?.closest("tr")?.dataset?.row), "1", "刪列後焦點移至相鄰列的刪除鈕");

    // 確認匯入（2330＋NVDA 5.5 股）→ 寫入 kline:pf:v1（method=fifo）、kline:watch:hold 不變
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 2 筆持股轉入/.test($("#lx").innerText));
    const st1 = await p.evaluate(() => ({
      pf: JSON.parse(localStorage.getItem("kline:pf:v1")),
      hold: JSON.parse(localStorage.getItem("kline:watch:hold")),
    }));
    assert.equal(st1.pf.method, "fifo");
    assert.equal(st1.pf.transactions.length, 2);
    assert.deepEqual(st1.pf.transactions.map(t => [t.symbol, t.type, t.shares, t.fee, t.tax, t.source]), [
      ["2330", "transfer_in", 1000, 0, 0, "import"],
      ["NVDA", "transfer_in", 5.5, 0, 0, "import"],
    ]);
    assert.equal(st1.pf.transactions[0].price, 800, "1000*900 - 100000 推算每股成本 800");
    assert.deepEqual(st1.hold, OLD_HOLD, "選項 1 寫入後舊庫存完全不動");

    // Part B：已有帳本（再加一筆已全部賣出的 2317）→ 從「持股」分頁的 holdSrcBar [data-hsrc="tx-imp"] 進入
    await p.evaluate(() => {
      const S0 = JSON.parse(localStorage.getItem("kline:pf:v1"));
      S0.transactions.push(
        { v: 1, id: "b2317", date: "2026-01-10", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 1000, price: 150, fee: 0, tax: 0, source: "manual" },
        { v: 1, id: "s2317", date: "2026-02-01", type: "sell", symbol: "2317", market: "tw", currency: "TWD", shares: 1000, price: 160, fee: 0, tax: 0, source: "manual" },
      );
      localStorage.setItem("kline:pf:v1", JSON.stringify(S0));
      renderList();
    });

    await holdGo(p, "pnl");
    await p.waitForSelector('#lTools [data-hsrc="tx-imp"]');
    assert.equal(await p.evaluate(() => $("#lTools .imp-btns").hidden), true);
    await p.evaluate(() => $("#lTools [data-imp=edit]").click());
    assert.match(await p.evaluate(() => $("#toast").textContent), /持股來自交易紀錄/);
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:watch:hold"))), OLD_HOLD);

    await p.click('#lTools [data-hsrc="tx-imp"]');
    await p.waitForSelector('#impSheet:not([hidden]) [data-lgimp-pick="holdings"]');
    assert.deepEqual(await p.evaluate(() => [W.holdView, W.lg?.view]), ["tx", "tx"]);

    await pickFileVia(p, '[data-lgimp-pick="holdings"]');
    await p.waitForSelector("#lgImpForm");
    assert.equal(await p.$("#lgImpMethod"), null, "已有帳本時不重複顯示成本算法選單");
    assert.match(await p.evaluate(() => $("#lgImpSum").textContent), /沿用帳本「先進先出（FIFO）」/);

    // 已有部位 2330、NVDA 預設不勾選；曾買已賣完 2317 預設勾選
    const rowChecks = await p.evaluate(() => [...document.querySelectorAll("#lgImpTbody tr")].map(tr => ({
      code: tr.querySelector('[data-lgimp-k="code"]').value,
      checked: tr.querySelector('[data-lgimp-k="on"]').checked,
      skipClass: tr.classList.contains("skip-existing"),
      meta: tr.querySelector("[data-lgimp-meta]").textContent,
    })));
    assert.equal(rowChecks[0].checked, false);
    assert.equal(rowChecks[0].skipClass, true);
    assert.match(rowChecks[0].meta, /帳本已有 1,?000 股，預設略過以免重複/);
    assert.equal(rowChecks[1].checked, false);
    assert.equal(rowChecks[2].checked, true, "2317 已出清不在帳本未平倉中，預設勾選");

    if (touch) {
      const openBox = await p.locator("#lgImpIncOpenWrap").boundingBox();
      assert.ok(openBox && openBox.height >= 43.5, `${width} #lgImpIncOpenWrap 觸控目標高度 ${openBox?.height} >= 44`);
    }

    // 表格橫向捲動時第 1 欄固定且維持不透明底色，不被後方文字透視重疊
    const holdSticky = await p.evaluate(() => {
      const wrap = $("#impSheet .hg-wrap");
      wrap.scrollLeft = 220;
      const wRect = wrap.getBoundingClientRect();
      const th1 = wrap.querySelector("thead th:first-child");
      const td1 = wrap.querySelector("tbody tr:first-child td:first-child");
      const td2 = wrap.querySelector("tbody tr:first-child td:nth-child(2)");
      const out = {
        canScroll: wrap.scrollWidth > wrap.clientWidth,
        thSticky: getComputedStyle(th1).position === "sticky",
        tdSticky: getComputedStyle(td1).position === "sticky",
        thLeftDiff: Math.abs(th1.getBoundingClientRect().left - wRect.left),
        tdLeftDiff: Math.abs(td1.getBoundingClientRect().left - wRect.left),
        td2ScrolledPast: td2.getBoundingClientRect().left < td1.getBoundingClientRect().right - 10,
        tdOpacity: getComputedStyle(td1).opacity,
        tdBg: getComputedStyle(td1).backgroundColor,
      };
      wrap.scrollLeft = 0;
      return out;
    });
    assert.equal(holdSticky.thSticky && holdSticky.tdSticky, true, "選項 1 表格第 1 欄設為 sticky");
    assert.equal(holdSticky.tdOpacity, "1", "略過列第 1 欄保持不透明，防止背面文字透視");
    assert.ok(!/rgba\([^)]*,\s*0(?:\.0+)?\s*\)|transparent/.test(holdSticky.tdBg), "第 1 欄具不透明背景：" + holdSticky.tdBg);
    if (holdSticky.canScroll) {
      assert.ok(holdSticky.thLeftDiff <= 2 && holdSticky.tdLeftDiff <= 2, "橫向捲動後第 1 欄貼齊容器左緣");
      assert.equal(holdSticky.td2ScrolledPast, true, "第 2 欄確實向左捲過第 1 欄後方");
    }

    // 切換全選既有部位「包含帳本已有部位」與 tri-state indeterminate
    await p.check("#lgImpIncOpen");
    assert.equal(await p.evaluate(() => [0, 1].map(i => document.querySelector(`#lgImpTbody tr[data-row="${i}"] [data-lgimp-k="on"]`).checked).every(Boolean)), true);
    await p.uncheck('#lgImpTbody tr[data-row="0"] [data-lgimp-k="on"]');
    assert.equal(await p.evaluate(() => $("#lgImpIncOpen").indeterminate), true, "只勾選部分既有部位時主開關呈 indeterminate");
    await p.click("#lgImpIncOpen");
    assert.deepEqual(await p.evaluate(() => ({ chk: $("#lgImpIncOpen").checked, ind: $("#lgImpIncOpen").indeterminate, n0: document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-k="on"]').checked, n1: document.querySelector('#lgImpTbody tr[data-row="1"] [data-lgimp-k="on"]').checked })), { chk: true, ind: false, n0: true, n1: true });
    await p.click("#lgImpIncOpen");
    assert.deepEqual(await p.evaluate(() => ({ chk: $("#lgImpIncOpen").checked, ind: $("#lgImpIncOpen").indeterminate, n0: document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-k="on"]').checked, n1: document.querySelector('#lgImpTbody tr[data-row="1"] [data-lgimp-k="on"]').checked })), { chk: false, ind: false, n0: false, n1: false });

    // 測試 ＋ 再加截圖失敗 → 保持在 review 並保留原本資料
    await pickFileVia(p, "[data-lgimp-shot]");
    await p.waitForFunction(() => /這張截圖太模糊（已保留原本資料）/.test($("#impLive")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.querySelectorAll("#lgImpTbody tr").length), 3);

    // 測試 ＋ 再加截圖成功 → 合併 0050，且不覆寫 2330 原本未勾選狀態
    await pickFileVia(p, "[data-lgimp-shot]");
    await p.waitForFunction(() => document.querySelectorAll("#lgImpTbody tr").length === 4);
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-k="on"]').checked), false, "2330 維持使用者未勾選");
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="3"] [data-lgimp-k="on"]').checked), true, "新合併的 0050 預設勾選");

    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 2 筆持股轉入/.test($("#lx").innerText));
    const st2 = await p.evaluate(() => ({
      pf: JSON.parse(localStorage.getItem("kline:pf:v1")),
      hold: JSON.parse(localStorage.getItem("kline:watch:hold")),
    }));
    assert.deepEqual(st2.pf.transactions.slice(-2).map(t => [t.symbol, t.type, t.shares]), [
      ["2317", "transfer_in", 1000],
      ["0050", "transfer_in", 2000],
    ]);
    assert.deepEqual(st2.hold, OLD_HOLD, "全程舊庫存完全不動");
    assert.ok(await noHOverflow(p));
    await ctx.close();
    assert.deepEqual(errs, []);
  });

  test(`${width}：選項 2 成交對帳單、歧義/無效日期修正、時間檢核、手動調序與確認、賣超與重複確認、scrollIntoView、固欄與焦點鎖定`, async () => {
    const touch = width < 500;
    let shotSeq = 0;
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch });
    await setupRoutes(ctx, body => {
      assert.equal(body.mode, "trades");
      shotSeq++;
      if (shotSeq === 1) return { body: { ok: false, error: "讀圖失敗測試" } };
      return {
        body: {
          ok: true,
          mode: "trades",
          rows: [
            { date: "2026-05-12", dateAssumed: "year", time: null, side: "sell", name: "聯發科", code: "2454", shares: 1000, price: 1100, fee: null, tax: null, dayTrade: true },
            { date: "2026-05-12", dateAssumed: "year", time: null, side: "buy", name: "聯發科", code: "2454", shares: 500, price: 1050, fee: 0, tax: null, dayTrade: false },
            { date: "2026-05-12", dateAssumed: "year", time: null, side: "buy", name: "聯發科", code: "2454", shares: 500, price: 1050, fee: 0, tax: null, dayTrade: false },
            { date: "2026-10-05", dateAssumed: "today", time: null, side: "buy", name: "蘋果", code: "AAPL", shares: 2, price: 200, fee: null, tax: 0, dayTrade: false },
            { date: "2026-05-01", dateAssumed: null, time: null, side: "buy", name: "台積電", code: "2330", shares: 1000, price: 880, fee: null, tax: null, dayTrade: false },
            { date: "2026-05-06", dateAssumed: "mdy", altDate: "2026-06-05", rawDate: "05/06/2026", time: null, side: "buy", name: "輝達", code: "NVDA", shares: 1, price: 120, fee: 0, tax: 0, dayTrade: false },
            { date: "", dateAssumed: "invalid", rawDate: "2026/02/30", time: null, side: "buy", name: "元大台灣50", code: "0050", shares: 1000, price: 180, fee: 0, tax: 0, dayTrade: false },
          ],
        },
      };
    });

    const SEED_TX = [{ v: 1, id: "ex1", date: "2026-05-01", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 880, fee: 1254, tax: 0, note: "", source: "manual" }];
    await p.evaluate(([old, tx]) => {
      localStorage.setItem("kline:watch:hold", JSON.stringify(old));
      localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: tx, at: "2026-05-01T00:00:00Z" }));
      localStorage.removeItem("kline:watch:stocks2");
      W.stocks = null;
    }, [OLD_HOLD, SEED_TX]);
    await p.reload();
    await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
    await p.evaluate(() => { W.holdMkt = "tw"; setLt("hold"); });
    await p.waitForSelector("#hvSeg");
    await holdGo(p, "tx");
    await p.waitForSelector('#lx .lgbar [data-lg="imp"]');

    // 開啟匯入 → 先測試對帳單首次失敗畫面（重試／手動空白／改選類型）
    await p.click('#lx .lgbar [data-lg="imp"]');
    await p.waitForSelector('[data-lgimp-pick="trades"]');
    await pickFileVia(p, '[data-lgimp-pick="trades"]');
    await p.waitForSelector("[data-lgimp-retry]");
    assert.match(await p.evaluate(() => $("#impLive").textContent), /讀圖失敗測試/);
    await p.click("[data-lgimp-blank]");
    await p.waitForSelector("#lgImpForm");
    assert.equal(await p.evaluate(() => document.querySelectorAll("#lgImpTbody tr").length), 1);
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr [data-lgimp-k="code"]').getAttribute("aria-invalid")), "false", "空白新增列未輸入前不顯示紅框");
    await p.click("[data-lgimp-back]");
    await p.waitForSelector('[data-lgimp-pick="trades"]');

    // 第二次上傳取得成交對帳單 7 筆（含歧義斜線日期與無效日期列）
    await pickFileVia(p, '[data-lgimp-pick="trades"]');
    await p.waitForSelector("#lgImpForm");
    assert.equal(await p.evaluate(() => document.querySelectorAll("#lgImpTbody tr").length), 7, "同天同價分批成交兩筆 2454 皆保留不合併");
    assert.ok(await noHOverflow(p), `${width} 選項 2 檢視沒有水平溢出`);

    // 確認假設／歧義／無效日期標籤、費稅、當沖與粗指標觸控目標
    const initUI = await p.evaluate(() => [...document.querySelectorAll("#lgImpTbody tr")].map(tr => ({
      uid: tr.dataset.uid,
      dtag: tr.querySelector("[data-lgimp-dtag]").hidden ? "" : tr.querySelector("[data-lgimp-dtag]").textContent,
      dwrapOpen: !tr.querySelector("[data-lgimp-dwrap]").hidden,
      dateInv: tr.querySelector('[data-lgimp-k="date"]').getAttribute("aria-invalid"),
      dateErr: tr.querySelector(`#lgie-${tr.dataset.uid}-date`).textContent,
      meta: tr.querySelector("[data-lgimp-meta]").textContent,
      dtDisabled: tr.querySelector('[data-lgimp-k="dayTrade"]').disabled,
      dtChecked: tr.querySelector('[data-lgimp-k="dayTrade"]').checked,
      warn: tr.querySelector("[data-lgimp-warn]").hidden ? "" : tr.querySelector("[data-lgimp-warn]").textContent,
    })));
    assert.equal(initUI[0].dtag, "年份待確認（請核對）");
    assert.equal(initUI[0].dtDisabled, false);
    assert.equal(initUI[0].dtChecked, true);

    assert.equal(initUI[1].dtag, "年份待確認（請核對）");
    assert.doesNotMatch(initUI[1].meta, /手續費估/, "第 2 列 fee 明確為 0 不顯示手續費估算");
    assert.equal(initUI[1].dtDisabled, true, "買進不可勾現股當沖");

    assert.equal(initUI[3].dtag, "未含日期，已帶入今天");
    assert.match(initUI[4].warn, /重複匯入/);

    assert.equal(initUI[5].dtag, "日期格式待確認（月/日或日/月）");
    assert.equal(initUI[5].dwrapOpen, true);
    assert.equal(initUI[5].dateInv, "true");

    assert.equal(initUI[6].dtag, "截圖日期無效（2026/02/30）");
    assert.equal(initUI[6].dateInv, "true");
    assert.match(initUI[6].dateErr, /無法辨識截圖日期「2026\/02\/30」，請手動修正為 YYYY-MM-DD/);

    if (touch) {
      const dfixBox = await p.locator('#lgImpTbody tr[data-row="5"] [data-lgimp-dflip]').boundingBox();
      const mvBox = await p.locator('#lgImpTbody tr[data-row="0"] [data-lgimp-mv="1"]').boundingBox();
      assert.ok(dfixBox && dfixBox.height >= 43.5, `${width} 改日/月按鈕觸控高度 ${dfixBox?.height} >= 44`);
      assert.ok(mvBox && mvBox.width >= 43.5 && mvBox.height >= 43.5, `${width} ↑↓調序鈕觸控尺寸 ${mvBox?.width}x${mvBox?.height} >= 44`);
    }

    // 選項 2 橫向捲動第 1 欄（匯入勾選）保持 sticky
    const trSticky = await p.evaluate(() => {
      const wrap = $("#impSheet .hg-wrap");
      wrap.scrollLeft = 260;
      const wRect = wrap.getBoundingClientRect();
      const th1 = wrap.querySelector("thead th:first-child");
      const td1 = wrap.querySelector("tbody tr:first-child td:first-child");
      const td2 = wrap.querySelector("tbody tr:first-child td:nth-child(2)");
      const out = {
        thLeftDiff: Math.abs(th1.getBoundingClientRect().left - wRect.left),
        tdLeftDiff: Math.abs(td1.getBoundingClientRect().left - wRect.left),
        td2ScrolledPast: td2.getBoundingClientRect().left < td1.getBoundingClientRect().right - 10,
      };
      wrap.scrollLeft = 0;
      return out;
    });
    assert.ok(trSticky.thLeftDiff <= 2 && trSticky.tdLeftDiff <= 2 && trSticky.td2ScrolledPast, "選項 2 橫向捲動時第 1 欄固定且不被第 2 欄覆蓋");

    // 點選第 5 列「改日/月 2026-06-05」確認歧義斜線日期 → 錯誤消除、保留為 2026-06-05
    await p.click('#lgImpTbody tr[data-row="5"] [data-lgimp-dflip]');
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="5"] [data-lgimp-k="date"]').value), "2026-06-05");
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="5"] [data-lgimp-dwrap]').hidden), true);
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="5"] [data-lgimp-k="date"]').getAttribute("aria-invalid")), "false");

    // 修正第 6 列無效日期後錯誤消除，接著刪除第 6 列測試列
    await p.fill('#lgImpTbody tr[data-row="6"] [data-lgimp-k="date"]', "2026-05-11");
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="6"] [data-lgimp-k="date"]').getAttribute("aria-invalid")), "false");
    await p.click('#lgImpTbody tr[data-row="6"] [data-lgimp-del]');
    await p.waitForFunction(() => document.querySelectorAll("#lgImpTbody tr").length === 6);

    // 切換方向：賣出 → 買進 → 賣出（現沖狀態重置再重啟）
    await p.selectOption('#lgImpTbody tr[data-row="0"] [data-lgimp-k="side"]', "buy");
    assert.deepEqual(await p.evaluate(() => ({ d: document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-k="dayTrade"]').disabled, c: document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-k="dayTrade"]').checked })), { d: true, c: false });
    await p.selectOption('#lgImpTbody tr[data-row="0"] [data-lgimp-k="side"]', "sell");
    await p.check('#lgImpTbody tr[data-row="0"] [data-lgimp-k="dayTrade"]');

    // 修改第 0 列日期 → 「年份待確認」標籤消除
    await p.fill('#lgImpTbody tr[data-row="0"] [data-lgimp-k="date"]', "2026-05-12");
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-dtag]').hidden), true);

    // 清空第 3 列日期並失焦 → 跳出無效日期錯誤；恢復後錯誤消失
    await p.fill('#lgImpTbody tr[data-row="3"] [data-lgimp-k="date"]', "");
    await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="3"] [data-lgimp-k="date"]').blur());
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="3"] [data-lgimp-k="date"]').getAttribute("aria-invalid")), "true");
    await p.fill('#lgImpTbody tr[data-row="3"] [data-lgimp-k="date"]', "2026-05-14");
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="3"] [data-lgimp-k="date"]').getAttribute("aria-invalid")), "false");

    // 成交時間驗證：填錯格式「25:99」失焦標錯、清空恢復
    const sellUid = initUI[0].uid;
    await p.fill(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-k="time"]`, "25:99");
    await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"] [data-lgimp-k="time"]`).blur(), sellUid);
    assert.equal(await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"] [data-lgimp-k="time"]`).getAttribute("aria-invalid"), sellUid), "true");
    await p.fill(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-k="time"]`, "");
    assert.equal(await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"] [data-lgimp-k="time"]`).getAttribute("aria-invalid"), sellUid), "false");

    // 無時間且先賣後買（2454 sell 在前）→ 絕不自動反轉！送出擋下賣超並顯示 #lgImpGlobalErr
    await p.click("#lgImpSave");
    await p.waitForFunction(() => !$("#lgImpGlobalErr").hidden && /未附成交時間/.test($("#lgImpGlobalErr").textContent));
    assert.equal(await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"] [data-lgimp-k="shares"]`).getAttribute("aria-invalid"), sellUid), "true");

    // 單列上下移按鈕測試（下移後再上移）
    await p.click(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-mv="1"]`);
    assert.equal(await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"]`).dataset.row, sellUid), "1");
    await p.click(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-mv="-1"]`);
    assert.equal(await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"]`).dataset.row, sellUid), "0");

    // 點擊「⇅ 反轉列表順序」使 2454 先買後賣 → 賣超與全域錯誤解除、賣出列顯示手續費／稅估算、且出現同日順序確認框
    await p.click("[data-lgimp-rev]");
    assert.equal(await p.evaluate(() => $("#lgImpGlobalErr").hidden), true);
    const sellMeta = await p.evaluate(u => document.querySelector(`#lgImpTbody tr[data-uid="${u}"] [data-lgimp-meta]`).textContent, sellUid);
    assert.match(sellMeta, /手續費估/);
    assert.match(sellMeta, /稅估/);
    assert.equal(await p.evaluate(() => $("#lgImpOrderWrap").hidden), false, "無時間的同日買賣需明確確認順序");

    // 若將同日 2454 三筆都填寫不重疊時間，順序確認框自動隱藏；清除後再顯示並重設 orderOk
    const buyUids = [initUI[1].uid, initUI[2].uid];
    await p.fill(`#lgImpTbody tr[data-uid="${buyUids[0]}"] [data-lgimp-k="time"]`, "09:05");
    await p.fill(`#lgImpTbody tr[data-uid="${buyUids[1]}"] [data-lgimp-k="time"]`, "09:10");
    await p.fill(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-k="time"]`, "10:15");
    assert.equal(await p.evaluate(() => $("#lgImpOrderWrap").hidden), true);
    await p.fill(`#lgImpTbody tr[data-uid="${buyUids[0]}"] [data-lgimp-k="time"]`, "");
    await p.fill(`#lgImpTbody tr[data-uid="${buyUids[1]}"] [data-lgimp-k="time"]`, "");
    await p.fill(`#lgImpTbody tr[data-uid="${sellUid}"] [data-lgimp-k="time"]`, "");
    assert.equal(await p.evaluate(() => $("#lgImpOrderWrap").hidden), false);
    if (touch) {
      const ordBox = await p.locator("#lgImpOrderWrap").boundingBox();
      assert.ok(ordBox && ordBox.height >= 43.5, `${width} #lgImpOrderWrap 觸控高度 ${ordBox?.height} >= 44`);
    }

    // 按「＋ 新增一列」填入賣超（賣 5000 股 2330）→ 送出被擋下，確認焦點與打字不重建 DOM
    await p.click("[data-lgimp-add]");
    await p.waitForFunction(() => document.querySelectorAll("#lgImpTbody tr").length === 7);
    assert.equal(await p.evaluate(() => document.activeElement?.closest("tr")?.dataset?.row), "6");
    await p.fill('#lgImpTbody tr[data-row="6"] [data-lgimp-k="date"]', "2026-05-13");
    await p.selectOption('#lgImpTbody tr[data-row="6"] [data-lgimp-k="side"]', "sell");
    const oversellCodeSel = '#lgImpTbody tr[data-row="6"] [data-lgimp-k="code"]';
    const inpBefore = await p.evaluateHandle(sel => document.querySelector(sel), oversellCodeSel);
    await p.focus(oversellCodeSel);
    await p.keyboard.type("2330");
    assert.equal(await p.evaluate(([sel, prev]) => document.querySelector(sel) === prev && document.activeElement === prev, [oversellCodeSel, inpBefore]), true, "輸入代號不重建 DOM、焦點不跑掉");
    await inpBefore.dispose();
    await p.fill('#lgImpTbody tr[data-row="6"] [data-lgimp-k="shares"]', "5000");
    await p.fill('#lgImpTbody tr[data-row="6"] [data-lgimp-k="price"]', "920");

    // IME 組字按 Enter 不可觸發送出
    const imeBlocked = await p.evaluate(() => {
      const inp = document.querySelector('#lgImpTbody tr[data-row="6"] [data-lgimp-k="price"]');
      const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true, bubbles: true });
      inp.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(imeBlocked, true, "組字按 Enter 會被攔下不送出");

    // 送出賣超 → 擋下並標註錯誤
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /賣超|出錯/.test($("#impLive")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="6"] [data-lgimp-k="shares"]')?.getAttribute("aria-invalid")), "true");
    // 刪除這列賣超測試列
    await p.click('#lgImpTbody tr[data-row="6"] [data-lgimp-del]');
    await p.waitForFunction(() => document.querySelectorAll("#lgImpTbody tr").length === 6);

    // 未勾選 #lgImpOrderOk 送出 → 擋下、捲動進可視範圍並聚焦 #lgImpOrderOk
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /同日買賣未附成交時間/.test($("#impLive")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.activeElement?.id), "lgImpOrderOk");
    assert.equal(await p.evaluate(() => $("#lgImpOrderOk").getAttribute("aria-invalid")), "true");
    const ordVis = await p.evaluate(() => {
      const mid = $("#impSheet .lgimp-mid").getBoundingClientRect();
      const wrap = $("#lgImpOrderWrap").getBoundingClientRect();
      return {
        inMid: wrap.top >= mid.top - 2 && wrap.bottom <= mid.bottom + 2,
        inVp: wrap.top >= 0 && wrap.bottom <= window.innerHeight + 2,
      };
    });
    assert.equal(ordVis.inMid && ordVis.inVp, true, `${width} 驗證失敗時 #lgImpOrderWrap 自動捲動進入視窗`);
    await p.check("#lgImpOrderOk");

    // 偵測可能重複交易時未勾選 #lgImpDup → 擋下、捲動進可視範圍並聚焦 #lgImpDup
    assert.equal(await p.evaluate(() => $("#lgImpDupWrap").hidden), false);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /重複/.test($("#impLive")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.activeElement?.id), "lgImpDup");
    assert.equal(await p.evaluate(() => $("#lgImpDup").getAttribute("aria-invalid")), "true");
    const dupVis = await p.evaluate(() => {
      const mid = $("#impSheet .lgimp-mid").getBoundingClientRect();
      const wrap = $("#lgImpDupWrap").getBoundingClientRect();
      return {
        inMid: wrap.top >= mid.top - 2 && wrap.bottom <= mid.bottom + 2,
        inVp: wrap.top >= 0 && wrap.bottom <= window.innerHeight + 2,
      };
    });
    assert.equal(dupVis.inMid && dupVis.inVp, true, `${width} 驗證失敗時 #lgImpDupWrap 自動捲動進入視窗`);

    // 對話框操作安全網：從內部拖曳到背景不誤關；Tab 焦點鎖定在對話框內
    const box = await p.locator("#impTitle").boundingBox();
    await p.mouse.move(box.x + 10, box.y + 10);
    await p.mouse.down();
    await p.mouse.move(8, 8);
    await p.mouse.up();
    assert.equal(await p.evaluate(() => $("#impSheet").hidden), false, "從對話框內拖到背景放開不會誤關");

    // Tab focus trap 測試：跳到最後一顆後再按 Tab 回到對話框內第一個可聚焦元素
    const trapOk = await p.evaluate(() => {
      const sh = $("#impSheet");
      const fs = [...sh.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter(x => !x.disabled && !x.closest("[hidden]") && x.offsetParent !== null && getComputedStyle(x).visibility !== "hidden");
      fs[fs.length - 1].focus();
      return fs.length >= 2 && document.activeElement === fs[fs.length - 1];
    });
    assert.equal(trapOk, true);
    await p.keyboard.press("Tab");
    assert.equal(await p.evaluate(() => $("#impSheet").contains(document.activeElement) && document.activeElement?.classList?.contains("hg-x")), true, "Tab 從尾端循環回對話框開頭關閉鈕");
    await p.keyboard.press("Shift+Tab");
    assert.equal(await p.evaluate(() => document.activeElement?.dataset?.ic === "close" && document.activeElement?.textContent === "取消"), true, "Shift+Tab 從開頭循環回對話框尾端取消鈕");

    // 勾選確認不是重複匯入 → 送出儲存
    await p.check("#lgImpDup");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 6 筆成交交易/.test($("#lx").innerText));

    const saved = await p.evaluate(() => ({
      pf: JSON.parse(localStorage.getItem("kline:pf:v1")),
      hold: JSON.parse(localStorage.getItem("kline:watch:hold")),
    }));
    // 順序依日期由舊到新（2026-05-01 → 05-12 兩筆 2454 買進在前、賣出在後 → 05-14 AAPL → 06-05 NVDA）
    const appended = saved.pf.transactions.slice(1);
    assert.deepEqual(appended.map(t => [t.date, t.type, t.symbol, t.shares, t.fee, !!t.dayTrade]), [
      ["2026-05-01", "buy", "2330", 1000, null, false],
      ["2026-05-12", "buy", "2454", 500, 0, false],
      ["2026-05-12", "buy", "2454", 500, 0, false],
      ["2026-05-12", "sell", "2454", 1000, null, true],
      ["2026-05-14", "buy", "AAPL", 2, null, false],
      ["2026-06-05", "buy", "NVDA", 1, 0, false],
    ]);
    assert.deepEqual(saved.hold, OLD_HOLD, "選項 2 寫入後舊庫存完全不動");

    // 再次開啟後分別用 Esc 與點擊背景關閉，確認焦點回到觸發按鈕
    await p.click('#lx .lgbar [data-lg="imp"]');
    await p.waitForSelector('#impSheet:not([hidden])');
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => $("#impSheet").hidden);
    assert.equal(await p.evaluate(() => document.activeElement?.dataset?.lg), "imp", "Esc 關閉後焦點回到匯入按鈕");

    await p.click('#lx .lgbar [data-lg="imp"]');
    await p.waitForSelector('#impSheet:not([hidden])');
    await p.mouse.click(8, 8);
    await p.waitForFunction(() => $("#impSheet").hidden);
    assert.ok(await noHOverflow(p));
    await ctx.close();
    assert.deepEqual(errs, []);
  });
}
