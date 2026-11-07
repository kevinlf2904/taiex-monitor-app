// 最終驗收（Antigravity）DEF-01／03／05：手機上融資表格不撐開整頁（表格自己左右滑）；總覽不被自動收折（走勢圖要看得到）；
// 觸控裝置上「展開全部」按鈕至少 44px。溢出用設定的螢幕寬度判斷（手機模擬時 innerWidth 會跟著內容變寬）。固定假資料
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const SYM = ["2330", "2317", "2454", "2303", "2882", "0050", "2603", "2412"];
const TX = [{ id: "d", v: 1, date: "2026-01-02", type: "deposit", market: "tw", currency: "TWD", amount: 5000000 },
  ...SYM.map((s, i) => ({ id: "b" + i, v: 1, date: "2026-01-05", type: "buy", symbol: s, market: "tw", currency: "TWD", shares: 1000, price: 100 + i * 50, fee: 0, tax: 0 })),
  { id: "u", v: 1, date: "2026-01-06", type: "buy", symbol: "NVDA", market: "us", currency: "USD", shares: 10, price: 100, fee: 0, tax: 0 }];
const MG = { v: 1, accounts: [{ id: "m", name: "元大融資帳戶", type: "margin", source: "user", loan: 300000, collateral: ["2330", "2317", "2454"].map(s => ({ symbol: s, shares: 1000 })) },
  { id: "p", name: "股票質押", type: "pledge", source: "user", loan: 100000, collateral: [{ symbol: "0050", shares: 1000 }] }] };
const setup = (p, view) => p.evaluate(([tx, mg, v]) => { store.set("pf:v1", { v: 1, method: "avg", transactions: tx, at: "x" }); store.set("pf:margin:v1", mg); W.lg = { view: v }; W.holdView = "tx"; setLt("hold"); }, [TX, MG, view]);

for (const width of [375, 390, 430]) test(`融資表格 ${width}：整頁不溢出，表格自己可以左右滑`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: true });
  await setup(p, "margin"); await p.waitForSelector("#lx .mgscroll table", { timeout: 30000 }); await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll("#lx .mgscroll")].map(e => ({ right: e.getBoundingClientRect().right, scroll: e.scrollWidth > e.clientWidth, ox: getComputedStyle(e).overflowX })) }));
  assert.ok(r.sw <= width + 1, `整頁寬 ${r.sw}，不能超過 ${width}`);
  assert.ok(r.boxes.length >= 2 && r.boxes.every(b => b.right <= width + 1 && b.ox === "auto"), "表格外框在畫面內、可以左右滑");
  assert.ok(r.boxes.some(b => b.scroll), "表格比畫面寬時，是外框裡面捲動");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("總覽不被自動收折：持股多、畫面矮也看得到走勢圖", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  await p.setViewportSize({ width: 390, height: 640 });
  await setup(p, "home"); await p.waitForSelector(".hmcard .hmtrend path", { timeout: 30000 }); await p.waitForTimeout(800);
  const r = await p.evaluate(() => { const c = $(".hmcard"); return { tall: c.getBoundingClientRect().height > innerHeight * 1.3, folded: /\bfold-/.test(c.className) || !!c.querySelector("[class*=fold-]") || !!c.nextElementSibling?.matches(".fold-btn"), trend: $(".hmcard .hmtrend").getBoundingClientRect().height > 50 }; });
  assert.ok(r.tall, "前提：總覽比畫面高 1.3 倍以上（會觸發自動收折的情況）");
  assert.equal(r.folded, false, "總覽沒有被收折"); assert.ok(r.trend, "走勢圖有高度、看得到");
  await ctx.close(); assert.deepEqual(errs, []);
});

test("觸控裝置：「展開全部」按鈕至少 44px 高", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true });
  // 用網站自己產生按鈕的函式（foldx.js 的 foldBtn），放進頁面量實際高度
  const h = await p.evaluate(() => { const b = foldBtn("probe", false, "展開全部 ▾"); b.id = "foldprobe"; document.body.appendChild(b); return b.getBoundingClientRect().height; });
  assert.ok(h >= 43.5, "高度 " + h);
  await ctx.close(); assert.deepEqual(errs, []);
});
