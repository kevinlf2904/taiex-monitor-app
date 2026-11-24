// 供應鏈「關聯」：連動熱圖（點格子）、意外的連動、領先落後、題材強弱、客戶視角、總經驅動、替代技術；題材內頁的「關聯題材」
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open, noHOverflow } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const noOverflow = noHOverflow;
// 假的題材連動資料：tw-cowos 和 tw-bank 扣掉大盤後高度相關（產業網絡裡沒連在一起）→ 要出現在「意外的連動」
const IDS = ["tw-foundry", "tw-cowos", "tw-hbm", "tw-odm", "us-gpu", "us-cloud", "tw-bank", "us-dcreit"], N = IDS.length;
const tri = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1), c = Array(N * (N - 1) / 2).fill(40), x = Array(N * (N - 1) / 2).fill(10);
x[tri(1, 6)] = 72; c[tri(1, 6)] = 80; x[tri(0, 1)] = 85;
const TC = { updated: "2026-10-22T08:00:00Z", from: "2025-10-22", to: "2026-10-21", weeks: 52, ids: IDS, n: IDS.map(() => 5), ret: IDS.map((_, i) => [i - 3, i * 2 - 5, i * 3, i * 10 - 20]), c, x,
  lead: [["us-gpu", "tw-cowos", 46, 8, 240], ["us-cloud", "tw-odm", 38, 5, 238]] };

for (const width of [390, 1280]) test(`供應鏈「關聯」分頁與題材內頁的關聯題材 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  await ctx.route("**/data/theme-corr.json", r => r.fulfill({ json: TC }));
  await p.evaluate(() => { showList(); setLt("ind"); W.indS.view = "themes"; W.indS.open = null; renderInd(); });
  await p.click('#lx [data-iview="rel"]'); await p.waitForSelector(".rheat svg");
  // 熱圖：AI 資料中心網絡裡有資料的題材；點格子看兩個題材的關係
  await p.click('.rheat rect[data-rel="cell:tw-foundry|tw-cowos"]'); await p.waitForSelector(".rcell");
  assert.match(await p.textContent(".rcell"), /扣掉大盤 0\.85/);
  assert.match(await p.textContent(".iseg"), /意外的連動/); assert.match(await p.textContent(".rlist"), /銀行/);
  assert.ok(await noOverflow(p), "熱圖在自己的框裡左右捲，不撐破畫面");
  // 領先落後：美股 GPU → 隔天台股 CoWoS
  await p.click('[data-rel="sub:lead"]'); await p.waitForSelector(".rpair"); assert.match(await p.textContent(".rlist"), /GPU[\s\S]*隔天[\s\S]*0\.46/);
  // 題材強弱：期間、市場可以切換，記住設定
  await p.click('[data-rel="sub:rank"]'); await p.click('[data-rel="per:3"]'); await p.click('[data-rel="mk:us"]');
  assert.equal(await p.evaluate(() => document.querySelectorAll(".rrank li").length), 3); assert.equal(await p.evaluate(() => store.get("watch:rel").per), "3");
  // 客戶視角、總經驅動、替代技術
  await p.click('[data-rel="sub:cust"]'); await p.click('[data-rel="cust:AAPL"]'); assert.match(await p.textContent(".gnote b"), /蘋果/); assert.ok(await p.evaluate(() => document.querySelectorAll(".rcust li").length >= 5));
  await p.click('[data-rel="sub:macro"]'); assert.match(await p.textContent(".rlist"), /10 年期美債殖利率[\s\S]*上升時受惠/);
  await p.click('[data-rel="sub:sub"]'); assert.match(await p.textContent(".rlist"), /CPO/);
  assert.ok(await noOverflow(p));
  // 題材內頁：細分題材、成分股重疊、替代技術、股價連動、總經驅動、在誰的供應鏈裡
  await p.evaluate(() => { W.indS.open = "tw-cowos"; renderInd(); }); await p.waitForSelector(".irel");
  const t = await p.textContent(".irel");
  assert.match(t, /細分題材/); assert.match(t, /替代技術/); assert.match(t, /股價連動/); assert.match(t, /常先動：.*GPU/); assert.match(t, /在誰的供應鏈裡/);
  await p.click('.irel [data-rel="cust:NVDA"]'); await p.waitForSelector(".rcust");
  assert.equal(await p.evaluate(() => [W.indS.view, W.indS.open, relS().sub].join()), "rel,,cust", "點大客戶跳到客戶視角");
  await p.evaluate(() => { W.indS.open = "tw-cap"; renderInd(); }); assert.match(await p.textContent(".irel"), /上一層（被動元件）/);
  assert.ok(await noOverflow(p));
  await ctx.close(); assert.deepEqual(errs, []);
});

test("橫向滑動的選單列：每秒重畫後不會跳回最左邊；選中的在右邊也會捲進畫面", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width: 390, touch: true });
  await p.evaluate(() => { showList(); setLt("ind"); W.indS.view = "news"; W.indS.open = null; renderInd(); });
  const bar = '#lx .scrseg[aria-label="供應鏈題材地圖"]';
  const vis = () => p.evaluate(s => { const el = document.querySelector(s), a = el.querySelector('[aria-pressed="true"]').getBoundingClientRect(), b = el.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1; }, bar);
  assert.ok(await vis(), "選中的「產業新聞」在右邊，重畫後要捲進畫面");
  const end = await p.evaluate(s => { const el = document.querySelector(s); el.scrollLeft = el.scrollWidth; return Math.round(el.scrollLeft); }, bar); assert.ok(end > 0);
  await p.evaluate(() => renderInd()); // 報價回來時直接重畫
  assert.equal(await p.evaluate(s => Math.round(document.querySelector(s).scrollLeft), bar), end, "重畫後還在原本的位置");
  await ctx.close(); assert.deepEqual(errs, []);
});

// 題材很多（整張網絡都有資料）時：手機格子不能小到編號互相重疊，熱圖在自己的框裡左右捲；相關係數標籤對比夠（#333 A2）
for (const width of [390, 1280]) test(`關聯熱圖：題材多時編號不重疊 ${width}`, async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html?mode=intel", { width, touch: width < 500 });
  const ids = await p.evaluate(() => { const n = IND.networks[0]; return [...new Set(n.layers.flatMap(([, L]) => L))].filter(id => INDT.has(id)); });
  const M = ids.length, t2 = (i, j) => (i * (2 * M - i - 1)) / 2 + (j - i - 1), cc = Array(M * (M - 1) / 2).fill(0).map((_, k) => ((k * 37) % 180) - 90), xx = cc.map(v => Math.round(v * 0.8));
  await ctx.route("**/data/theme-corr.json", r => r.fulfill({ json: { ...TC, ids, n: ids.map(() => 5), ret: ids.map(() => [1, 2, 3, 4]), c: cc, x: xx, lead: [[ids[0], ids[1], 80, 8, 240], [ids[2], ids[3], 50, 8, 240]] } }));
  await p.evaluate(() => { showList(); setLt("ind"); W.indS.view = "themes"; W.indS.open = null; renderInd(); });
  await p.click('#lx [data-iview="rel"]'); await p.waitForSelector(".rheat svg");
  const r = await p.evaluate(() => { const B = [...document.querySelectorAll(".rheat .rhn")].map(t => t.getBoundingClientRect()); let ov = 0; for (let i = 1; i < B.length; i++) if (B[i].left < B[i - 1].right - 0.5) ov++;
    return { n: B.length, ov, cell: document.querySelector(".rheat rect").getBoundingClientRect().width }; });
  assert.ok(r.n >= 20, `測試條件：題材要夠多 ${r.n}`); assert.equal(r.ov, 0, "上方編號重疊"); assert.ok(r.cell >= 13, `格子 ${r.cell}px`);
  assert.ok(await noHOverflow(p), "熱圖在框內捲動，不撐破畫面");
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await p.click('[data-rel="sub:lead"]'); await p.waitForSelector(".rpair .rv");
  // 亮暗主題都算一次：標籤文字和「標籤底色疊在頁面底色上」的對比要 ≥ 4.5
  for (const th of ["dark", "light"]) {
    const cr = await p.evaluate(th => { document.documentElement.dataset.theme = th;
      const rgb = c => { const m = c.match(/[\d.]+/g).map(Number); return c.startsWith("color(") ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : [m[0], m[1], m[2], m[3] ?? 1]; };
      const L = a => { const [r, g, b] = a.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      return Math.min(...[...document.querySelectorAll(".rpair .rv")].map(b => { let e = b.parentElement, base; while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] === 1) { base = c; break; } e = e.parentElement; } base ||= th === "dark" ? [0, 0, 0, 1] : [255, 255, 255, 1];
        const bg = rgb(getComputedStyle(b).backgroundColor), mix = bg.slice(0, 3).map((v, i) => v * bg[3] + base[i] * (1 - bg[3])), [x, y] = [L(rgb(getComputedStyle(b).color).slice(0, 3)), L(mix)].sort((a, b) => b - a); return (x + 0.05) / (y + 0.05); })); }, th);
    assert.ok(cr >= 4.5, `${th} 相關係數標籤對比 ${cr.toFixed(2)}:1`);
  }
  await ctx.close(); assert.deepEqual(errs, []);
});
