// 排程腳本的本機模擬：用假的 fetch 跑 sec13f、congress 的 main()，涵蓋正常、403、5xx、回 HTML 錯誤頁、部分失敗等情況，
// 確認不會丟出未捕獲的錯誤，也不會把原本的資料檔覆寫成空的。輸出寫到暫存資料夾（DATA_DIR），不碰 learner/data。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DIR = await mkdtemp(path.join(tmpdir(), "kline-sim-")); process.env.DATA_DIR = DIR;
const realFetch = globalThis.fetch; let route = () => null; const calls = [];
globalThis.fetch = async (url, opt = {}) => { url = String(url); calls.push({ url, ua: opt.headers?.["User-Agent"], at: Date.now() }); const r = await route(url, opt); if (r) return r; return new Response("not mocked", { status: 404 }); };
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const T = (t, status = 200, ct = "text/html") => new Response(t, { status, headers: { "content-type": ct } });
test.after(async () => { globalThis.fetch = realFetch; await rm(DIR, { recursive: true, force: true }); });
const quiet = async fn => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };
const exists = async f => !!(await stat(f).catch(() => null));

// ---------- sec13f ----------
const sec = await import("../scripts/sec13f.mjs");
const XML = (rows) => `<informationTable>${rows.map(r => `<infoTable><nameOfIssuer>${r.n}</nameOfIssuer>${r.c ? `<cusip>${r.c}</cusip>` : ""}${r.v != null ? `<value>${r.v}</value>` : ""}<shrsOrPrnAmt><sshPrnamt>${r.s}</sshPrnamt><sshPrnamtType>${r.t || "SH"}</sshPrnamtType></shrsOrPrnAmt></infoTable>`).join("")}</informationTable>`;
function secRoutes({ failCik = null, html = false, all = null } = {}) {
  return url => {
    if (all) return all(url);
    if (/api\.openfigi\.com/.test(url)) return J({ error: "down" }, 500);
    if (/company_tickers\.json/.test(url)) return J({ 0: { ticker: "AAPL", title: "Apple Inc." } });
    const cik = (url.match(/CIK(\d{10})\.json/) || url.match(/edgar\/data\/(\d+)\//) || [])[1];
    if (failCik && cik && +cik === +failCik) return html ? T("<html>Undeclared Automated Tool</html>", 200) : T("Forbidden", 403);
    if (/submissions\/CIK/.test(url)) return J({ name: "TEST FUND " + cik, filings: { recent: { form: ["13F-HR/A", "13F-HR", "13F-HR/A", "4"], accessionNumber: ["0001-26-000009", "0001-26-000001", "0001-26-000003", "x"], filingDate: ["2026-08-20", "2026-08-14", "2026-05-15", "2026-01-01"], reportDate: ["2026-06-30", "2026-06-30", "2026-03-31"] } } });
    if (/index\.json$/.test(url)) return J({ directory: { item: [{ name: "primary_doc.xml" }, { name: "infotable.xml" }] } });
    if (/000126000001\/infotable\.xml/.test(url)) return T(XML([{ n: "APPLE INC", c: "037833100", v: 200, s: 1000 }, { n: "BOND", c: "999", v: 5, s: 9000, t: "PRN" }, { n: "NO CUSIP", v: 1, s: 1 }, { n: "NO VALUE", c: "111", s: 50 }, { n: "NVIDIA", c: "67066G104", v: 100, s: 800 }]), 200, "text/xml");
    if (/000126000003\/infotable\.xml/.test(url)) return T(XML([{ n: "APPLE INC", c: "037833100", v: 150, s: 900 }, { n: "OLD CO", c: "222", v: 10, s: 100 }]), 200, "text/xml");
    if (/000126000009\//.test(url)) return T("amendment should not be used", 500);
    return null;
  };
}
test("sec13f：選原始 13F-HR、千美元換算、排除債券與缺欄位、OpenFIGI 失敗不中斷", async () => {
  route = secRoutes(); const o = await quiet(() => sec.main());
  const f = o.funds.find(x => x.rows?.length); assert.ok(f, "有讀到機構");
  assert.equal(f.form, "13F-HR"); assert.equal(f.period, "2026-06-30"); assert.equal(f.prevPeriod, "2026-03-31");
  const aapl = f.rows.find(r => r.cusip === "037833100"); assert.equal(aapl.value, 200000); assert.equal(aapl.chg, "add");
  assert.ok(!f.rows.some(r => r.cusip === "999"), "債券（PRN）排除"); assert.ok(!f.rows.some(r => !r.cusip), "沒有 CUSIP 的列略過");
  assert.ok(f.sold.some(r => r.cusip === "222"), "出清");
  assert.ok(await exists(path.join(DIR, "f13.json")));
});
test("sec13f：User-Agent 合規、請求間隔遵守每秒 10 次以內", async () => {
  const S = calls.filter(c => /sec\.gov/.test(c.url));
  assert.ok(S.every(c => /^\S+\/\d+(\.\d+)* \(\S+@\S+\)$/.test(c.ua) || /\S+@\S+/.test(c.ua)), "每個 sec.gov 請求都有含 email 的 User-Agent");
  assert.match(S[0].ua, /^KlineSchool\/1\.0 \(admin@kline-school\.vercel\.app\)$/);
  let maxIn1s = 0; for (let i = 0; i < S.length; i++) { const n = S.filter(c => c.at >= S[i].at && c.at < S[i].at + 1000).length; maxIn1s = Math.max(maxIn1s, n); }
  assert.ok(maxIn1s <= 10, `任何 1 秒內最多 ${maxIn1s} 次`);
});
test("sec13f：單一機構 403 或回 HTML 錯誤頁 → 沿用上次的資料（stale），不拋錯", async () => {
  route = secRoutes({ failCik: "0001067983", html: true }); const o = await quiet(() => sec.main());
  const b = o.funds.find(x => x.cik === "0001067983"); assert.ok(b?.stale, "巴菲特用上次的資料"); assert.ok(o.notes.some(n => /沿用上次/.test(n)));
});
test("sec13f：全部 403／5xx → 保留原本的資料檔，不覆寫成空的", async () => {
  const before = await readFile(path.join(DIR, "f13.json"), "utf8");
  route = secRoutes({ all: url => (/openfigi/.test(url) ? J({}, 500) : T("Forbidden", 403)) });
  const o = await quiet(() => sec.main()); assert.ok(o, "沒有拋錯");
  assert.equal(await readFile(path.join(DIR, "f13.json"), "utf8"), before, "資料檔沒有被改");
});
test("sec13f：pickFilings 對缺欄位、只有修訂版的季度有預設處理", () => {
  assert.deepEqual(sec.pickFilings(undefined), []); assert.deepEqual(sec.pickFilings({ form: ["13F-HR"] }), []);
  const L = sec.pickFilings({ form: ["13F-HR/A", "13F-HR/A"], accessionNumber: ["a", "b"], filingDate: ["2026-05-20", "2026-05-25"], reportDate: ["2026-03-31", "2026-03-31"] });
  assert.equal(L.length, 1); assert.equal(L[0].acc, "b");
  assert.deepEqual(sec.mergeRows(null), []); assert.deepEqual(sec.compare(), { rows: [], sold: [] });
});

// ---------- congress ----------
const cg = await import("../scripts/congress.mjs");
const PREV = { updated: "2026-10-01T00:00:00Z", cutoff: "2026-09-30", trades: [{ ticker: "NVDA", k: "buy", traded: "2026-09-20", filed: "2026-09-30", pid: "s-x", amount: [1001, 15000], owner: "本人", assetType: "股票" }], people: { "s-x": { name: "X", chamber: "參議院" } } };
test("congress：兩院都 403／5xx → 保留原本的資料，不覆寫、不拋錯", async () => {
  await writeFile(path.join(DIR, "congress.json"), JSON.stringify(PREV)); await writeFile(path.join(DIR, "congress-docs.json"), "{}");
  let n = 0; route = url => { n++; return n % 2 ? T("Forbidden", 403) : T("err", 503); };
  const o = await quiet(() => cg.main({ log: () => {} })); assert.equal(o.skipped, true);
  assert.equal(await readFile(path.join(DIR, "congress.json"), "utf8"), JSON.stringify(PREV), "資料檔沒被改");
});
test("congress：眾議院索引回 HTML（不是 zip）、參議院正常 → 只更新參議院並保留舊交易", async () => {
  route = (url, opt) => {
    if (/financial-pdfs\/\d+FD\.zip/.test(url)) return T("<html>maintenance</html>", 200);
    if (/efdsearch\.senate\.gov\/search\/home\//.test(url)) return opt.method === "POST" ? new Response("", { status: 302, headers: { location: "/search/" } }) : T('<input name="csrfmiddlewaretoken" value="tok123">', 200);
    if (/report\/data\//.test(url)) return J({ data: [["Jane", "Doe", "Doe, Jane (Senator) (CA)", '<a href="/search/view/ptr/abc/">x</a>', "10/10/2026"]] });
    if (/\/search\/view\/ptr\/abc\//.test(url)) return T(`<h2 class="filedReport">The Honorable Jane Doe</h2><table><tbody><tr><td>1</td><td>10/01/2026</td><td>Self</td><td>AAPL</td><td>Apple Inc</td><td>Stock</td><td>Purchase</td><td>$1,001 - $15,000</td><td></td></tr></tbody></table>`, 200);
    return null;
  };
  const o = await quiet(() => cg.main({ log: () => {} }));
  assert.ok(!o.skipped); assert.ok(o.notes.some(n => /眾議院/.test(n)), "記下眾議院沒更新");
  assert.ok(o.trades.some(t => t.ticker === "AAPL"), "參議院新交易"); assert.ok(o.trades.some(t => t.ticker === "NVDA"), "保留舊交易");
});
test("congress：參議院清單回 HTML（工作階段失效）→ 記錄原因、不拋錯", async () => {
  route = (url, opt) => {
    if (/financial-pdfs/.test(url)) return T("down", 500);
    if (/search\/home\//.test(url)) return opt.method === "POST" ? new Response("", { status: 302 }) : T('<input name="csrfmiddlewaretoken" value="t">', 200);
    if (/report\/data\//.test(url)) return T("<html>Please agree</html>", 200);
    return null;
  };
  const o = await quiet(() => cg.main({ log: () => {} })); assert.equal(o.skipped, true); assert.ok(o.notes.some(n => /不是 JSON/.test(n)));
});
