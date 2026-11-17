// 投資組合入口收斂與自動對帳完整 E2E 驗收（390px 手機 ＋ 1280px 桌面、全 mock、24 項必測情境 ＋ WAL／雙分頁鎖）
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, holdGo, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const ALT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACc4AwN4Q7/8AAAAAElFTkSuQmCC", "base64");
const OLD_HOLD = { 2330: { sh: 1000, cost: 500, d: "2025-01-02" } };
const MOCK_STOCKS = [
  ["2330", "台積電", "上市"],
  ["2454", "聯發科", "上市"],
  ["2317", "鴻海", "上市"],
  ["0050", "元大台灣50", "上市"],
];
const KNOWN_US = new Set(["NVDA", "AAPL", "SPY"]);

async function setupRoutes(ctx, importHandler) {
  await ctx.route("**/api/stocks**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, list: MOCK_STOCKS }) }));
  await ctx.route("**/api/quote**", r => {
    const codes = (new URL(r.request().url()).searchParams.get("codes") || "").split(",").filter(Boolean);
    const known = new Set(MOCK_STOCKS.map(x => x[0]));
    const quotes = codes.filter(c => known.has(c) || KNOWN_US.has(c)).map((c, i) => ({
      code: c, name: MOCK_STOCKS.find(x => x[0] === c)?.[1] || c, price: c === "NVDA" ? 130 : 950 + i * 10, prev: 940, open: 945, high: 960, low: 935, vol: 2000, chg: 10, chgPct: 1, date: "2026-10-05", time: "10:30:05", market: /^\d/.test(c) ? "上市" : "美股", bids: [], asks: [],
    }));
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, source: "t", session: "open", today: "2026-10-05", quotes }) });
  });
  await ctx.route("**/api/import**", async r => {
    const body = JSON.parse(r.request().postData() || "{}");
    const out = await importHandler(body);
    r.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.body) });
  });
}

function attachErrCollectors(p, errs) {
  let abortedHttps = 0;
  p.on("requestfailed", req => {
    if (req.url().startsWith("https://")) abortedHttps++;
    else errs.push(`reqfail:${req.url()}:${req.failure()?.errorText || "err"}`);
  });
  p.on("console", m => {
    if (m.type() !== "error") return;
    const txt = m.text(), loc = m.location()?.url || "";
    if (txt === "Failed to load resource: net::ERR_FAILED" && (loc.startsWith("https://") || abortedHttps > 0)) return;
    errs.push(`console:${txt}`);
  });
}

async function pickFile(p, sel, buf = TINY_PNG) {
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click(sel)]);
  await fc.setFiles({ name: "shot.png", mimeType: "image/png", buffer: buf });
}

const ALL_PF_VIEWS = [
  { key: "home", check: async p => /總市值|投資組合|資產/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "perf", check: async p => /台股（台幣）|美股（美元）/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "alloc", check: async p => /配置|再平衡|壓力情境/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "div", check: async p => /股利/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "report", check: async p => /投資組合報告/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "thesis", check: async p => /投資論點/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "margin", check: async p => /融資/.test(await p.evaluate(() => $("#lx").innerText)) },
  { key: "tx", check: async p => /持有中|交易紀錄/.test(await p.evaluate(() => $("#lx").innerText)) },
];

for (const width of [390, 1280]) {
  test(`${width}（Case 1,2,3,4,8,9,16）：空白帳本只匯入庫存快照→8頁正常・早於/晚於快照交易・Level3不擋同批`, async () => {
    const touch = width < 500;
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch, time: "2026-10-05T04:00:00Z", tick: true });
    attachErrCollectors(p, errs);
    let seq = 0;
    await setupRoutes(ctx, body => {
      assert.equal(body.mode, "auto");
      seq++;
      if (seq === 1) {
        return {
          body: {
            ok: true, mode: "auto", kind: "holdings", asOf: "2026-09-10", asOfStatus: "exact",
            rows: [
              { name: "台積電", code: "2330", shares: 1000, avgCost: 800 },
              { name: "輝達", code: "NVDA", shares: 5, avgCost: 120 },
              { name: "無效", code: "9999", shares: 10, avgCost: 50 },
            ],
          },
        };
      }
      if (seq === 2) {
        // Case 2：早於快照日交易
        return {
          body: {
            ok: true, mode: "auto", kind: "trades", asOf: "2026-08-01", asOfStatus: "exact",
            rows: [{ date: "2026-08-01", dateAssumed: null, side: "buy", name: "台積電", code: "2330", shares: 500, price: 750, fee: 0, tax: 0 }],
          },
        };
      }
      if (seq === 3) {
        // Case 3：晚於快照日買進 + 一筆 Level 3 問題列（匯入前取消勾選問題列，有效列正常入帳）
        return {
          body: {
            ok: true, mode: "auto", kind: "trades", asOf: "2026-09-15", asOfStatus: "exact",
            rows: [
              { date: "2026-09-15", dateAssumed: null, side: "buy", name: "台積電", code: "2330", shares: 1000, price: 900, fee: 0, tax: 0 },
              { date: "2026-09-15", dateAssumed: null, side: "sell", name: "無效", code: "BAD!", shares: 100, price: 50, fee: 0, tax: 0 },
            ],
          },
        };
      }
      // Case 4：晚於快照日賣出（以平均成本 850 算已實現損益）
      return {
        body: {
          ok: true, mode: "auto", kind: "trades", asOf: "2026-09-20", asOfStatus: "exact",
          rows: [{ date: "2026-09-20", dateAssumed: null, side: "sell", name: "台積電", code: "2330", shares: 500, price: 950, fee: 0, tax: 0 }],
        },
      };
    });

    await p.evaluate(old => {
      localStorage.setItem("kline:watch:hold", JSON.stringify(old));
      localStorage.removeItem("kline:pf:v1");
      localStorage.removeItem("kline:pf:recon:v1");
    }, OLD_HOLD);
    await p.reload();
    await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
    await p.evaluate(() => { W.holdMkt = "tw"; setLt("hold"); });
    await p.waitForSelector("#hvSeg");
    await holdGo(p, "tx");
    await p.waitForSelector('#lx [data-lg="imp"]');

    // Case 1 + 8 + 9：首次匯入含 2330、NVDA 與 9999（Level 3 失敗不擋其他列，取消勾選 9999 後正常建立快照）
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    assert.match(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-lvl]').textContent), /Level 1/);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => /查不到代號：9999/.test($("#impLive")?.textContent || ""));
    await p.uncheck('#lgImpTbody tr[data-row="2"] [data-lgimp-k="on"]');
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已儲存對帳快照（確認 2 檔/.test($("#lx").innerText));

    const s1 = await p.evaluate(() => ({
      pf: localStorage.getItem("kline:pf:v1"),
      recon: JSON.parse(localStorage.getItem("kline:pf:recon:v1")),
      hold: JSON.parse(localStorage.getItem("kline:watch:hold")),
      wHold: W.hold,
    }));
    assert.equal(s1.pf, null, "不寫入空 kline:pf:v1");
    assert.equal(s1.recon.snapshots.filter(s => s.status === "confirmed").length, 2);
    assert.deepEqual(s1.hold, OLD_HOLD, "舊庫存不動");
    assert.equal(s1.wHold["2330"]?.sh, 1000);
    assert.equal(s1.wHold["NVDA"]?.sh, 5);

    // Case 16：空白純快照在所有投資組合頁面＋持股（台股/美股）都正常顯示且不退回介紹頁
    await holdGo(p, "pnl");
    await p.waitForFunction(() => W.holdLg && /台積電|2330/.test($("#wl").innerText));
    assert.ok(await noHOverflow(p), `${width} pnl 純快照無水平溢出`);
    await holdGo(p, "ana");
    assert.ok(await noHOverflow(p), `${width} ana 純快照無水平溢出`);
    await holdGo(p, "tx");
    for (const v of ALL_PF_VIEWS) {
      await p.evaluate(k => { W.lg = { ...(W.lg || {}), view: k }; renderList(); }, v.key);
      await p.waitForFunction(k => (k !== "perf" || typeof KLPerf !== "undefined") && $("#lx").innerText.trim().length > 20, v.key, { timeout: 15000 });
      assert.equal(await v.check(p), true, `${width} ${v.key} 頁面純快照應正常顯示`);
      assert.doesNotMatch(await p.evaluate(() => $("#lx").innerText), /還沒有交易紀錄|從空白開始/, `${width} ${v.key} 不應退回空白介紹頁`);
      assert.ok(await noHOverflow(p), `${width} ${v.key} 無水平溢出`);
    }

    // Case 2：早於快照日交易（2026-08-01 買 500 股）→ preSnapshot 標記且持股維持 1000
    await p.evaluate(() => { W.lg = { ...(W.lg || {}), view: "tx" }; renderList(); });
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    assert.match(await p.evaluate(() => $("#lgImpTbody").innerText), /快照前歷史/);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 1 筆成交交易/.test($("#lx").innerText));
    assert.equal(await p.evaluate(() => W.hold["2330"]?.sh), 1000, "早於快照日歷史交易不得重複累加持股");
    assert.match(await p.evaluate(() => $(".lgtxs").innerText), /快照前歷史/);

    // Case 3：晚於快照日買進（1000 股 @ 900）＋ 取消勾選同批失敗列 → 2330 變 2000 股、均價 850
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    await p.uncheck('#lgImpTbody tr[data-row="1"] [data-lgimp-k="on"]');
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 1 筆成交交易/.test($("#lx").innerText));
    assert.deepEqual(await p.evaluate(() => ({ sh: W.hold["2330"]?.sh, cost: W.hold["2330"]?.cost })), { sh: 2000, cost: 850 });

    // Case 4：晚於快照日賣出（500 股 @ 950）→ 剩 1500 股、已實現損益 50,000
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 1 筆成交交易/.test($("#lx").innerText));
    assert.equal(await p.evaluate(() => W.hold["2330"]?.sh), 1500);
    assert.match(await p.evaluate(() => $(".lgcurs").innerText), /\+?50,000/);

    await ctx.close();
    assert.deepEqual(errs, []);
  });

  test(`${width}（Case 5,6,11,13,14,24）：同圖指紋／同批與跨批重複・賣光重買與S1→S2晉升・超容差全站8頁待對帳＋市場T+2/T+1提示＋稽核抽屜`, async () => {
    const touch = width < 500;
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch, time: "2026-10-05T04:00:00Z", tick: true });
    attachErrCollectors(p, errs);
    let seq = 0;
    await setupRoutes(ctx, () => {
      seq++;
      if (seq === 1) {
        // S1：2330 1000 @ 800, NVDA 5 @ 120
        return {
          body: {
            ok: true, mode: "auto", kind: "holdings", asOf: "2026-09-01", asOfStatus: "exact",
            rows: [
              { name: "台積電", code: "2330", shares: 1000, avgCost: 800 },
              { name: "輝達", code: "NVDA", shares: 5, avgCost: 120 },
            ],
          },
        };
      }
      if (seq === 2) {
        // 賣光再買回 + 同批兩筆 2454 分批（不誤判重複）
        return {
          body: {
            ok: true, mode: "auto", kind: "trades", asOf: "2026-09-10", asOfStatus: "exact",
            rows: [
              { date: "2026-09-05", dateAssumed: null, side: "sell", name: "台積電", code: "2330", shares: 1000, price: 850, fee: 0, tax: 0 },
              { date: "2026-09-10", dateAssumed: null, side: "buy", name: "台積電", code: "2330", shares: 600, price: 900, fee: 0, tax: 0 },
              { date: "2026-09-10", dateAssumed: null, side: "buy", name: "聯發科", code: "2454", shares: 500, price: 1000, fee: 0, tax: 0 },
              { date: "2026-09-10", dateAssumed: null, side: "buy", name: "聯發科", code: "2454", shares: 500, price: 1000, fee: 0, tax: 0 },
            ],
          },
        };
      }
      if (seq === 3) {
        // S2 在容差內（經過賣光再買回 → 自動晉升 S2）
        return { body: { ok: true, mode: "auto", kind: "holdings", asOf: "2026-09-15", asOfStatus: "exact", rows: [{ name: "台積電", code: "2330", shares: 600, avgCost: 900 }] } };
      }
      if (seq === 4) {
        // S3 超出容差：2330 800股、NVDA 10股（同時製造台股 + 美股開放衝突）
        return {
          body: {
            ok: true, mode: "auto", kind: "holdings", asOf: "2026-09-25", asOfStatus: "exact",
            rows: [
              { name: "台積電", code: "2330", shares: 800, avgCost: 910 },
              { name: "輝達", code: "NVDA", shares: 10, avgCost: 130 },
            ],
          },
        };
      }
      if (seq === 5) {
        // 用同一張圖片重傳（原圖 SHA-256 命中未決批次）+ 跨批重複 2454（2026-09-10 buy 500 @ 1000）
        return {
          body: {
            ok: true, mode: "auto", kind: "trades", asOf: "2026-09-26", asOfStatus: "exact",
            rows: [{ date: "2026-09-10", dateAssumed: null, side: "buy", name: "聯發科", code: "2454", shares: 500, price: 1000, fee: 0, tax: 0 }],
          },
        };
      }
      return { body: { ok: true, mode: "auto", kind: "holdings", asOf: "2026-09-26", asOfStatus: "exact", rows: [{ name: "台積電", code: "2330", shares: 600, avgCost: 900 }] } };
    });

    await p.evaluate(() => {
      localStorage.removeItem("kline:pf:v1");
      localStorage.removeItem("kline:pf:recon:v1");
      W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold");
    });
    await p.waitForSelector('#lx [data-lg="imp"]');

    // S1
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]", TINY_PNG);
    await p.waitForSelector("#lgImpForm");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden);

    // Case 5 + 14：賣光歸零再重買 + 同批兩筆 2454 不誤判重複
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]", ALT_PNG);
    await p.waitForSelector("#lgImpForm");
    assert.equal(await p.evaluate(() => $("#lgImpDupWrap").hidden), true, "同批同價分批兩筆 2454 絕不誤報重複");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /已匯入 4 筆成交交易/.test($("#lx").innerText));

    // Case 13 + 14：S2 跨過賣光重買，自動晉升（S1 superseded）
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]", ALT_PNG);
    await p.waitForSelector("#lgImpForm");
    assert.match(await p.evaluate(() => $("#lgImpTbody").innerText), /Level 1/);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden);
    const afterS2 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")));
    assert.equal(afterS2.snapshots.filter(s => s.symbol === "2330" && s.status === "superseded").length, 1);
    assert.equal(afterS2.snapshots.filter(s => s.symbol === "2330" && s.status === "confirmed")[0]?.shares, 600);

    // Case 6 + 24：S3 超容差（用 TINY_PNG 上傳，之後以 TINY_PNG 重傳測原圖雜湊提醒）
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]", TINY_PNG);
    await p.waitForSelector("#lgImpForm");
    assert.match(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="0"] [data-lgimp-lvl]').textContent), /台股 T\+2/);
    assert.match(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="1"] [data-lgimp-lvl]').textContent), /美股 T\+1/);
    assert.doesNotMatch(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="1"] [data-lgimp-lvl]').textContent), /T\+2/, "美股絕不誤顯示台股 T+2");
    assert.doesNotMatch(await p.evaluate(() => KLRecon.settlementHint(null)), /T\+[12]/, "混合／未指定市場不得套用固定 T+2");
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden);

    // 確認全站 8 頁顯示 ⚠︎ 待對帳 與試算提示，且檢查 2330 台股 T+2 vs NVDA 美股 T+1
    const reconHtml = await p.evaluate(() => $(".lgrecon-center").innerText);
    assert.match(reconHtml, /2330.*差異 \+200 股/);
    assert.match(reconHtml, /台股 T\+2/);
    assert.match(reconHtml, /美股 T\+1/);

    await holdGo(p, "pnl");
    await p.waitForSelector('#lTools [data-hsrc="tx-recon"]');
    await holdGo(p, "tx");
    for (const v of ["home", "perf", "alloc", "div", "report", "thesis"]) {
      await p.evaluate(k => { W.lg = { ...(W.lg || {}), view: k }; renderList(); }, v);
      await p.waitForFunction(() => /⚠︎ 待對帳/.test($("#lx").innerText), null, { timeout: 15000 });
      if (v === "alloc") {
        await p.waitForFunction(() => /用已確認快照的股數試算/.test($("#lx").innerText) && /壓力情境/.test($("#lx").innerText), null, { timeout: 15000 });
      }
      if (v === "report") {
        assert.match(await p.evaluate(() => ($("#lx .rpt")?.innerText || "")), /⚠︎ 待對帳/);
      }
    }

    // Case 5：同原圖 TINY_PNG 再上傳 → 顯示非阻斷「之前已上傳過」警告與前往衝突鈕 + 跨批重複進 Level 2，且仍不擋前往待對帳或儲存
    await p.evaluate(() => { W.lg = { ...(W.lg || {}), view: "tx" }; renderList(); });
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]", TINY_PNG);
    await p.waitForSelector("#lgImpForm");
    assert.match(await p.evaluate(() => $(".lgimp-banner").innerText), /之前已上傳過.*查看待對帳/);
    assert.equal(await p.evaluate(() => $("#lgImpDupWrap").hidden), false, "跨批同簽章進入 Level 2 重複確認");
    await p.click('[data-lg="view-conflicts"]');
    await p.waitForFunction(() => $("#impSheet").hidden && $(".lgrecon-center") !== null);

    // Case 6 解決衝突：[data-lgrecon-keep] 保留 2330 原基準、[data-lgrecon-accept] 採信 NVDA 新快照並寫理由進 audit[]
    const cids = await p.evaluate(() => [...document.querySelectorAll(".lgrecon-item")].map(x => [x.querySelector("[data-lgrecon-keep]")?.getAttribute("data-lgrecon-keep"), x.innerText]));
    const cid2330 = cids.find(([, t]) => /2330/.test(t))[0];
    const cidNvda = cids.find(([, t]) => /NVDA/.test(t))[0];
    await p.click(`[data-lgrecon-keep="${cid2330}"]`);
    await p.waitForFunction(() => !document.querySelector(`[data-lgrecon-keep]`)?.closest(".lgrecon-item")?.innerText?.includes("2330"));
    await p.fill(`[data-lgrecon-reason="${cidNvda}"]`, "已於美股券商核對補入");
    await p.click(`[data-lgrecon-accept="${cidNvda}"]`);
    await p.waitForFunction(() => !document.querySelector(".lgrecon-center"));

    // Case 11：稽核抽屜包含 imports[] 與 audit[]
    await p.click(".lgrecon-hist summary");
    const histTxt = await p.evaluate(() => $(".lgrecon-hist").innerText);
    assert.match(histTxt, /最近匯入/);
    assert.match(histTxt, /對帳稽核軌跡/);
    assert.match(histTxt, /已於美股券商核對補入/);
    assert.ok(await noHOverflow(p));

    await ctx.close();
    assert.deepEqual(errs, []);
  });

  test(`${width}（Case 7,10,12,15,17,20,21,22,23）：缺年跨年與未來日阻擋・unknown原地切換・同日順序(改期失效)・融資隔離・期初標記撤回再標・full/partial清倉・幣別衝突・120KB阻擋`, async () => {
    const touch = width < 500;
    const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch, time: "2026-01-05T04:00:00Z", tick: true });
    attachErrCollectors(p, errs);
    let seq = 0, importReqCount = 0;
    await setupRoutes(ctx, () => {
      importReqCount++;
      seq++;
      if (seq === 1) {
        // Case 21：01/05 看 12/28（asOfStatus: "year" 跨年推為 2025-12-28）與未來日 2026-02-01
        return {
          body: {
            ok: true, mode: "auto", kind: "holdings", asOf: "2025-12-28", asOfStatus: "year", rawAsOf: "12/28",
            rows: [{ name: "台積電", code: "2330", shares: 1000, avgCost: 820 }],
          },
        };
      }
      if (seq === 2) {
        // Case 10 + 15：unknown + 同日買進 2330（在確認基準日 2025-12-28 同日）+ 融資股隔離
        return {
          body: {
            ok: true, mode: "auto", kind: "unknown", asOf: "2025-12-28", asOfStatus: "exact",
            rows: [
              { date: "2025-12-28", side: "buy", name: "台積電", code: "2330", shares: 200, price: 850, fee: 0, tax: 0 },
              { date: "2025-12-28", side: "buy", name: "鴻海", code: "2317", shares: 1000, price: 150, fee: 0, tax: 0, marginType: "margin" },
            ],
          },
        };
      }
      if (seq === 3) {
        // Case 20a & 20b：缺少 2330 的快照（2026-01-03 只有 2454）
        return {
          body: {
            ok: true, mode: "auto", kind: "holdings", asOf: "2026-01-03", asOfStatus: "exact",
            rows: [{ name: "聯發科", code: "2454", shares: 1000, avgCost: 1100 }],
          },
        };
      }
      return {
        body: {
          ok: true, mode: "auto", kind: "holdings", asOf: "2026-01-04", asOfStatus: "exact",
          rows: [{ name: "聯發科", code: "2454", shares: 1000, avgCost: 1100 }],
        },
      };
    });

    await p.evaluate(old => {
      localStorage.setItem("kline:watch:hold", JSON.stringify(old));
      localStorage.removeItem("kline:pf:v1");
      localStorage.removeItem("kline:pf:recon:v1");
      W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold");
    }, OLD_HOLD);
    await p.waitForSelector('#lx [data-lg="imp"]');

    // Case 21：year 跨年 12/28 → 同時顯示 rawAsOf "12/28" 與推定日 "2025-12-28"；改填未來日被擋；改回 2025-12-28 按 [data-lgimp-asof-ok] 才建立 confirmed
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    const msgYear = await p.evaluate(() => $("#lgImpAsOfMsg").innerText);
    assert.match(msgYear, /12\/28/);
    assert.match(msgYear, /2025-12-28/);
    assert.match(await p.evaluate(() => $("#lgImpTbody").innerText), /Level 2/);

    // 嘗試把基準日填成未來 2026-01-10 按確認 → 拒絕確認且不給 confirmed
    await p.fill("[data-lgimp-asof]", "2026-01-10");
    await p.click("[data-lgimp-asof-ok]");
    await p.waitForFunction(() => /晚於今日/.test($("#impLive").innerText));

    // 填回正確 2025-12-28 並按 [data-lgimp-asof-ok] → 升為 Level 1 並建立 confirmed 快照
    await p.fill("[data-lgimp-asof]", "2025-12-28");
    await p.click("[data-lgimp-asof-ok]");
    assert.match(await p.evaluate(() => $("#lgImpTbody").innerText), /Level 1/);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")).snapshots[0].date), "2025-12-28");

    // Case 10 + 15：unknown 原地切換（確認不重呼叫 /api/import）、融資隔離連結、同日交易進待對帳、決策與改日失效（kline:pf:v1 不重寫）
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    const reqN = importReqCount;
    await p.click('[data-lgimp-switch="holdings"]');
    await p.click('[data-lgimp-switch="trades"]');
    assert.equal(importReqCount, reqN, "切換類型不重複呼叫 /api/import");
    assert.match(await p.evaluate(() => $(".lgimp-margin").innerText), /融資／融券部位已隔離/);
    assert.equal(await p.evaluate(() => document.querySelector('#lgImpTbody tr[data-row="1"] [data-lgimp-k="on"]').disabled), true);
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && $(".lgrecon-center") !== null);

    // 解決 same_day_order → 點「快照後才成交」寫入 sameDayRelations，驗證 2330 持股 1000 → 1200 且 pf:v1 未額外異動
    const pfBeforeSd = await p.evaluate(() => localStorage.getItem("kline:pf:v1"));
    await p.click('[data-lgrecon-sameday="after_snapshot"]');
    await p.waitForFunction(() => W.hold["2330"]?.sh === 1200);
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:v1")), pfBeforeSd, "解決 same_day_order 只寫 recon，不寫 pf:v1");

    // 編輯該同日交易改換日期再改回 2025-12-28 → sameDayRelations 因 snapshotId/date 過期重回 unresolved（同日順序未決）
    const txIdSd = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions[0].id);
    await p.click(`.lgtxs [data-lg="edit"][data-id="${txIdSd}"]`);
    await p.fill('#lgForm [name="date"]', "2025-12-29");
    await p.click('#lgForm [type="submit"]');
    await p.waitForFunction(() => !$("#lgForm"));
    await p.click(`.lgtxs [data-lg="edit"][data-id="${txIdSd}"]`);
    await p.fill('#lgForm [name="date"]', "2025-12-28");
    await p.click('#lgForm [type="submit"]');
    await p.waitForFunction(() => !$("#lgForm"));
    // 清除測試該筆交易以便進行 Case 20 清倉驗證
    await p.click(`.lgtxs [data-lg="del"][data-id="${txIdSd}"]`);
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem("kline:pf:v1")).transactions || []).length === 0);

    // Case 20：partial 保留 2330；full 且帳本有股數 → Level 2 確認清倉歸零；kline:watch:hold 維持鎖定不退回
    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    await p.click('[data-lgimp-scope="partial"]');
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden);
    assert.equal(await p.evaluate(() => W.hold["2330"]?.sh), 1000, "partial 不應關閉未出現之 2330");

    await p.click('#lx [data-lg="imp"]');
    await pickFile(p, "[data-lgimp-upload]");
    await p.waitForSelector("#lgImpForm");
    await p.click('[data-lgimp-scope="full"]');
    await p.waitForFunction(() => /2330/.test($("#lgImpFullWarn")?.textContent || ""));
    await p.click("#lgImpSave");
    await p.waitForFunction(() => $("#impSheet").hidden && /2330/.test($(".lgrecon-center")?.innerText || ""));
    const closeCid = await p.evaluate(() => document.querySelector("[data-lgrecon-accept]")?.getAttribute("data-lgrecon-accept"));
    await p.fill(`[data-lgrecon-reason="${closeCid}"]`, "已於券商清倉賣光");
    await p.click(`[data-lgrecon-accept="${closeCid}"]`);
    await p.waitForFunction(() => !W.hold["2330"] && W.holdLg != null);
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:watch:hold"))), OLD_HOLD, "完整清倉歸零後舊庫存仍被鎖住不退回");

    // Case 12 + 17：手動 transfer_in 「標為期初快照 → 撤回 → 再標記」
    await p.click('[data-lg="add"]');
    await p.selectOption("#lgType", "transfer_in");
    await p.fill('#lgForm [name="date"]', "2026-01-02");
    await p.fill('#lgForm [name="symbol"]', "2317");
    await p.fill('#lgForm [name="shares"]', "500");
    await p.fill('#lgForm [name="price"]', "160");
    await p.click('#lgForm [type="submit"]');
    await p.waitForFunction(() => !$("#lgForm") && /2317/.test($(".lgtxs").innerText));
    const pfBeforeTag = await p.evaluate(() => localStorage.getItem("kline:pf:v1"));
    await p.click('[data-lg="tag-init"]');
    await p.waitForSelector('[data-lg="untag-init"]');
    assert.equal(await p.evaluate(() => localStorage.getItem("kline:pf:v1")), pfBeforeTag, "標記期初不應改動 pf:v1");
    await p.click('[data-lg="untag-init"]');
    await p.waitForSelector('[data-lg="tag-init"]');
    await p.click('[data-lg="tag-init"]');
    await p.waitForSelector('[data-lg="untag-init"]');

    // Case 22 + 23：幣別／市場衝突驗證與 120KB 核心超限 Fail-Closed 不覆寫現況
    const guardRes = await p.evaluate(async () => {
      const r0 = JSON.parse(localStorage.getItem("kline:pf:recon:v1"));
      const curConflict = KLRecon.validateStore({
        ...r0,
        snapshots: [...r0.snapshots, { id: "badcur", date: "2026-01-04", symbol: "2454", market: "us", currency: "USD", shares: 10, avgCost: 100, origin: "import", scope: "partial", status: "confirmed" }],
      }, { today: "2026-01-05" });
      const big = KLRecon.cloneStore(r0);
      for (let i = 0; i < 450; i++) {
        big.conflicts.push({ id: "open-" + i, kind: "recon_diff", symbol: "2454", market: "tw", currency: "TWD", status: "open", createdAt: "2026-01-05T00:00:00Z", message: "Z".repeat(260) });
      }
      const saveBig = await lgReconSave(big);
      return { curConflict, saveBig, afterSave: JSON.parse(localStorage.getItem("kline:pf:recon:v1")) };
    });
    assert.equal(guardRes.curConflict.ok, false);
    assert.equal(guardRes.curConflict.code, "currency_conflict");
    assert.equal(guardRes.saveBig.ok, false);
    assert.equal(guardRes.saveBig.code, "core_data_exceeds_limit");
    assert.match(guardRes.saveBig.errors[0], /匯出 JSON 備份/);
    assert.ok(guardRes.afterSave.conflicts.length < 10, "核心超限 Fail-Closed 絕不覆寫現有對帳資料");

    // Case 15 融資連結導覽測試
    await p.evaluate(() => { W.lg = { view: "margin" }; renderList(); });
    await p.waitForFunction(() => /融資/.test($("#lx").innerText));
    assert.ok(await noHOverflow(p));

    await ctx.close();
    assert.deepEqual(errs, []);
  });
}

test("390/1280（Case 18, 19）：雙分頁 Web Locks／storage事件／stale-base 拒寫・WAL Phase 1/2/3 失敗與重開收斂・Halted 雙出口與過期標籤恢復", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: "2026-10-05T04:00:00Z", tick: true });
  attachErrCollectors(p, errs);
  await setupRoutes(ctx, () => ({ body: { ok: true, mode: "auto", kind: "trades", asOf: "2026-10-05", asOfStatus: "exact", rows: [{ date: "2026-10-05", side: "buy", name: "台積電", code: "2330", shares: 100, price: 950, fee: 0, tax: 0 }] } }));

  const initTx = { v: 1, id: "tx-init", date: "2026-09-01", type: "transfer_in", symbol: "2330", market: "tw", currency: "TWD", shares: 1000, price: 800, fee: 0, tax: 0, note: "" };
  await p.evaluate(tx => {
    localStorage.setItem("kline:pf:v1", JSON.stringify({ v: 1, method: "avg", transactions: [tx], at: "2026-09-01T00:00:00Z" }));
    localStorage.removeItem("kline:pf:recon:v1");
    W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold");
  }, initTx);
  await p.waitForSelector('[data-lg="tag-init"]');
  await p.click('[data-lg="tag-init"]');
  await p.waitForSelector('[data-lg="untag-init"]');

  // Case 18：雙分頁開同一頁 → Tab B 寫入新交易後，Tab A storage 事件刷新快取且零寫回；另測 stale-base 與 !navigator.locks Fail-Closed
  const p2 = await ctx.newPage();
  const p2Errs = [];
  p2.on("pageerror", e => p2Errs.push(e.message));
  await p2.clock.setSystemTime("2026-10-05T04:00:00Z");
  await p2.goto(`${S.url}/learner/watch.html`);
  await p2.waitForFunction(() => typeof W !== "undefined" && typeof lazy === "function");
  await p2.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  await p.evaluate(() => {
    window.__case18SetCalls = 0;
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "kline:pf:v1" || k === "kline:pf:recon:v1") window.__case18SetCalls++;
      return origSet.call(this, k, v);
    };
  });
  await p2.evaluate(() => {
    const pf = JSON.parse(localStorage.getItem("kline:pf:v1"));
    pf.transactions.push({ v: 1, id: "tx-tab2", date: "2026-09-10", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 100, price: 900, fee: 0, tax: 0 });
    localStorage.setItem("kline:pf:v1", JSON.stringify(pf));
  });
  await p.waitForFunction(() => W.hold?.["2330"]?.sh === 1100);
  assert.equal(await p.evaluate(() => window.__case18SetCalls), 0, "storage 事件只重算並更新記憶體快取，絕不回寫 localStorage");
  // Restore Storage.prototype.setItem on p and revert tx-tab2 cleanly from p2
  await p2.evaluate(() => {
    const pf = JSON.parse(localStorage.getItem("kline:pf:v1"));
    pf.transactions = pf.transactions.filter(t => t.id !== "tx-tab2");
    localStorage.setItem("kline:pf:v1", JSON.stringify(pf));
  });
  await p.waitForFunction(() => W.hold?.["2330"]?.sh === 1000);
  await p2.close();
  assert.deepEqual(p2Errs, []);

  const lockCheck = await p.evaluate(async () => {
    const stalePf = lgSave({ v: 1, method: "avg", transactions: [] }, { expectedRawPf: "stale" });
    const staleRecon = await lgReconSave(KLRecon.emptyStore(), { expectedRawRecon: "stale" });
    const origLocks = Object.getOwnPropertyDescriptor(Navigator.prototype, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, get: () => undefined });
    const noLock = await withPfCommitLock(() => ({ ok: true }));
    delete navigator.locks;
    if (origLocks) Object.defineProperty(Navigator.prototype, "locks", origLocks);
    return { stalePf, staleRecon, noLock };
  });
  assert.equal(lockCheck.stalePf.code, "stale_write");
  assert.equal(lockCheck.staleRecon.code, "stale_write");
  assert.equal(lockCheck.noLock.code, "cross_tab_lock_unavailable");

  // Case 19a-0：WAL Phase 1 與 Phase 2 setItem 失敗皆原地中止並保持兩鍵與原本完全一致
  const p12Res = await p.evaluate(async () => {
    const pfBefore = localStorage.getItem("kline:pf:v1");
    const reconBefore = localStorage.getItem("kline:pf:recon:v1");
    const origSet = Storage.prototype.setItem;
    const makeTx = id => ({ v: 1, id, date: "2026-09-12", type: "buy", symbol: "2330", market: "tw", currency: "TWD", shares: 50, price: 850, fee: 0, tax: 0 });
    const runFailAt = async (failPhase) => {
      let reconW = 0, pfW = 0;
      Storage.prototype.setItem = function (k, v) {
        if (k === "kline:pf:recon:v1") { reconW++; if (failPhase === 1 && reconW === 1) throw new Error("p1_fail"); }
        if (k === "kline:pf:v1") { pfW++; if (failPhase === 2 && pfW === 1) throw new Error("p2_fail"); }
        return origSet.call(this, k, v);
      };
      try {
        return await lgCommitDualStores({
          planFn: (pf0) => {
            const tx = makeTx("tx-fail-" + failPhase);
            const nextPf = { ...pf0, transactions: [...pf0.transactions, tx] };
            return {
              ok: true,
              nextPf,
              payload: { id: "b-fail-" + failPhase, op: "import_trades", at: "2026-10-05T00:00:00Z", txs: [tx], txHashes: { [tx.id]: KLRecon.txFingerprint(tx) }, pfBaseHash: KLRecon.pfStoreHash(pf0), pfNextHash: KLRecon.pfStoreHash(nextPf), staged: {} },
            };
          },
        });
      } finally {
        Storage.prototype.setItem = origSet;
      }
    };
    const r1 = await runFailAt(1);
    const r2 = await runFailAt(2);
    return {
      r1Ok: r1.ok, r2Ok: r2.ok,
      pfUnchanged: localStorage.getItem("kline:pf:v1") === pfBefore,
      reconUnchanged: localStorage.getItem("kline:pf:recon:v1") === reconBefore,
    };
  });
  assert.equal(p12Res.r1Ok, false);
  assert.equal(p12Res.r2Ok, false);
  assert.equal(p12Res.pfUnchanged, true, "Phase 1/2 失敗不得改動 pf:v1");
  assert.equal(p12Res.reconUnchanged, true, "Phase 1/2 失敗不得留下 pendingCommit");

  // Case 19a：模擬 update_tx_tag（修改已標記期初交易）於 Phase 3 setItem 失敗並故意阻止 rollback → 重開兩次收斂，audit[] 零重複
  await p.evaluate(() => {
    const origSet = Storage.prototype.setItem;
    let reconWrites = 0;
    Storage.prototype.setItem = function (k, v) {
      if (k === "kline:pf:recon:v1") {
        reconWrites++;
        if (reconWrites >= 2) throw new Error("quota_p3"); // Phase 3 與重開前背景持久化皆失敗，強制留待重開恢復
      }
      if (k === "kline:pf:v1" && reconWrites >= 2) throw new Error("quota_p3_rollback"); // rollback also fails so WAL remains for startup recovery
      return origSet.call(this, k, v);
    };
  });
  await p.click('[data-lg="edit"][data-id="tx-init"]');
  await p.fill('#lgForm [name="shares"]', "1200");
  await p.click('#lgForm [type="submit"]');
  await p.waitForFunction(() => /儲存空間不足|寫入保護|失敗/.test($("#lgForm")?.innerText || "") && JSON.parse(localStorage.getItem("kline:pf:recon:v1") || "{}").pendingCommit != null);
  assert.notEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")).pendingCommit), null, "Phase 3 中斷應保留 pendingCommit 待重開恢復");

  // 重開兩次頁面：Roll-Forward 收斂且 audit 不重複
  await p.reload();
  await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  await p.evaluate(() => { W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold"); });
  await p.waitForFunction(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1") || "{}").pendingCommit === null);
  const auditCount1 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")).audit.length);
  assert.equal(await p.evaluate(() => W.hold["2330"]?.sh), 1200, "Phase 3 中斷重開後 Roll-Forward 更新快照為 1200");
  await p.reload();
  await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  const auditCount2 = await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")).audit.length);
  assert.equal(auditCount2, auditCount1, "重複啟動檢查不得產生重複稽核紀錄");

  // Case 19b：注入部分/未知 op WAL → 顯示 [data-lgrecon-halted]、阻擋新寫入、驗證 revert_pre_commit（含 deactivate_tags）與 discard_wal 兩個出口
  await p.evaluate(() => {
    const pf = JSON.parse(localStorage.getItem("kline:pf:v1"));
    const pendingTx = { v: 1, id: "wal-tx-99", date: "2026-10-02", type: "buy", symbol: "2317", market: "tw", currency: "TWD", shares: 300, price: 160, fee: 0, tax: 0 };
    const nextPf = { ...pf, transactions: [...pf.transactions, pendingTx] };
    localStorage.setItem("kline:pf:v1", JSON.stringify(nextPf));
    const recon = JSON.parse(localStorage.getItem("kline:pf:recon:v1"));
    recon.pendingCommit = {
      id: "wal-stuck-1", op: "import_trades", at: "2026-10-05T00:00:00Z",
      txs: [pendingTx],
      txHashes: { [pendingTx.id]: KLRecon.txFingerprint(pendingTx) },
      pfBaseHash: KLRecon.pfStoreHash(pf),
      pfNextHash: "fp1:00000000000000000000000000000000:10", // forced mismatch → inconsistent_halted
      staged: { audit: [{ id: "aud-wal-1", at: "2026-10-05T00:00:00Z", action: "trades_imported", symbol: "2317", reason: "halted test" }] },
    };
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify(recon));
  });
  await p.reload();
  await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  await p.evaluate(() => { W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold"); });
  await p.waitForSelector("[data-lgrecon-halted]");
  const blk = await p.evaluate(async () => await lgReconSave(KLRecon.emptyStore()));
  assert.equal(blk.code, "unrecovered_pending_commit", "halted 狀態必須阻擋一般覆寫寫入");

  // 出口 1：revert_pre_commit 還原到修改前
  await p.click('[data-lgrecon-halt-action="revert_pre_commit"]');
  await p.waitForFunction(() => !document.querySelector("[data-lgrecon-halted]"));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:v1")).transactions.some(t => t.id === "wal-tx-99")), false, "revert_pre_commit 成功回退尚未完成的匯入交易");

  // 出口 1b：deactivate_tags halted 也支援 revert_pre_commit 還原
  const deactCheck = await p.evaluate(() => {
    const pf = JSON.parse(localStorage.getItem("kline:pf:v1"));
    const recon = JSON.parse(localStorage.getItem("kline:pf:recon:v1"));
    const tx0 = pf.transactions[0];
    const plan = KLRecon.planDeactivateTags(recon, tx0);
    const stuck = KLRecon.cloneStore(plan.previewRecon); // recon already transitioned to targetTagState while pf still keeps tx0 -> inconsistent_halted
    stuck.pendingCommit = plan.payload;
    const rec = KLRecon.recoverCommit(pf, stuck);
    const rev = KLRecon.resolveHalted(pf, stuck, "revert_pre_commit", { source: "test" });
    return {
      status: rec.status,
      revOk: rev.ok,
      restoredCount: rev.pfStore?.transactions?.length,
      tagActiveAfter: rev.reconStore?.initialTags?.[tx0.id]?.active === true,
    };
  });
  assert.equal(deactCheck.status, "inconsistent_halted");
  assert.equal(deactCheck.revOk, true);
  assert.equal(deactCheck.restoredCount, 1);
  assert.equal(deactCheck.tagActiveAfter, true);

  // 出口 2：未知 op → 只留 discard_wal → 按下後恢復寫入
  await p.evaluate(() => {
    const recon = JSON.parse(localStorage.getItem("kline:pf:recon:v1"));
    recon.pendingCommit = { id: "wal-unk-2", op: "future_v2_op", at: "2026-10-05T01:00:00Z" };
    localStorage.setItem("kline:pf:recon:v1", JSON.stringify(recon));
  });
  await p.reload();
  await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  await p.evaluate(() => { W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold"); });
  await p.waitForSelector("[data-lgrecon-halted]");
  assert.equal(await p.$('[data-lgrecon-halt-action="revert_pre_commit"]'), null, "未知 op 不得顯示 revert_pre_commit");
  await p.click('[data-lgrecon-halt-action="discard_wal"]');
  await p.waitForFunction(() => !document.querySelector("[data-lgrecon-halted]"));

  // Case 19c：模擬舊版未支援鎖的分頁直接竄改已標期初之 transfer_in → 重載偵測失效標籤並可一鍵清理
  await p.evaluate(() => {
    const pf = JSON.parse(localStorage.getItem("kline:pf:v1"));
    pf.transactions[0].shares = 9999; // tampered directly without updating recon
    localStorage.setItem("kline:pf:v1", JSON.stringify(pf));
  });
  await p.reload();
  await p.evaluate(() => typeof LAZY === "object" && Promise.all(Object.keys(LAZY).map(lazy)));
  await p.evaluate(() => { W.holdView = "tx"; W.lg = { view: "tx" }; setLt("hold"); });
  await p.waitForSelector("[data-lgrecon-clean-stale]");
  await p.click("[data-lgrecon-clean-stale]");
  await p.waitForFunction(() => !document.querySelector("[data-lgrecon-clean-stale]"));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("kline:pf:recon:v1")).initialTags["tx-init"].active), false);

  assert.ok(await noHOverflow(p));
  await ctx.close();
  assert.deepEqual(errs, []);
});
