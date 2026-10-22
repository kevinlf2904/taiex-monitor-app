// 線上網站即時性檢查：每隔幾秒打一次 /api/quote、/api/market、/api/futures，記錄資料來源、資料時間和現在差多少、回應時間。
// 用法：node scripts/probe-live.mjs [次數=12] [間隔秒=10]；次數填 ext 改成檢查外部資料源（Polymarket、FRED、MIS 槓桿 ETF）的原始回應。由 .github/workflows/probe-live.yml 手動或盤中排程執行（這個容器連不到線上網站）。
const SITE = (process.env.SITE_URL || "https://kline-school.vercel.app").replace(/\/$/, "");
const N = +process.argv[2] || 12, GAP = (+process.argv[3] || 10) * 1000, sleep = ms => new Promise(r => setTimeout(r, ms));
const tpe = ms => new Date(ms + 8 * 3600e3).toISOString().slice(11, 19);
async function hit(path) {
  const t0 = Date.now(); try { const r = await fetch(SITE + path, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(25000) }); const j = await r.json().catch(() => null);
    return { ms: Date.now() - t0, status: r.status, age: r.headers.get("age"), cache: r.headers.get("x-vercel-cache"), j }; } catch (e) { return { ms: Date.now() - t0, err: e.message }; }
}
async function raw(url, n = 600) {
  const t0 = Date.now(); try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: "https://mis.twse.com.tw/stock/index.jsp" }, signal: AbortSignal.timeout(20000) }); const t = await r.text();
    console.log(`\n### ${url}\n${r.status} ${Date.now() - t0}ms ${t.length} bytes\n${t.slice(0, n)}`); return t; } catch (e) { console.log(`\n### ${url}\n錯誤 ${e.message}`); }
}
if (process.argv[2] === "jk") {
  // 日股、韓股：用網站同一套 Yahoo 報價、日 K（產業地圖裡 6981.T、005930.KS 這種代號）
  const { yahooQuote } = await import("../api/_lib/_yahoo.js");
  for (const c of ["6981.T", "8035.T", "005930.KS", "000660.KS", "000990.KS"]) { try { const q = await yahooQuote(c); console.log(c, q.name, q.market, q.currency, q.price, q.chgPct + "%", q.date, q.time, q.session?.state, q.session?.open, q.session?.close); } catch (e) { console.log(c, "錯誤", e.message); } }
  const k = await hit("/api/kline?code=6981.T&months=3"); console.log("網站 /api/kline 6981.T", k.status, k.j?.ok, k.j?.data?.length, k.j?.error || "");
  const q = await hit("/api/quote?codes=6981.T,005930.KS"); console.log("網站 /api/quote", q.status, JSON.stringify(q.j?.quotes?.map(x => [x.code, x.price, x.chgPct]) || q.j).slice(0, 300));
  process.exit(0);
}
if (process.argv[2] === "taifexdl") {
  // 期交所「前 30 個交易日期貨每筆成交資料」：看下載頁的連結、壓縮檔大小、CSV 欄位與台指期（TX）的日期時間寫法（夜盤怎麼標日期）
  const { execFileSync } = await import("node:child_process"), { writeFileSync } = await import("node:fs"), os = await import("node:os");
  const page = await fetch("https://www.taifex.com.tw/cht/3/dlFutPrevious30DataView", { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }).then(r => r.text()).catch(e => "ERR " + e.message);
  const links = [...new Set([...page.matchAll(/(?:https?:\/\/[^"' ]*|\/file[^"' ]*)Daily_\d{4}_\d{2}_\d{2}[^"' ]*\.zip/gi)].map(m => m[0].startsWith("/") ? "https://www.taifex.com.tw" + m[0] : m[0]))];
  console.log("下載頁", page.length, "bytes；zip 連結", links.length, links.slice(0, 4).join("  "), "…", links.slice(-2).join("  "));
  const csv = links.filter(u => /CSV/i.test(u)); let pick = (csv.length ? csv : links).sort().reverse()[0];
  if (!pick) { // 下載頁抓不到連結：直接試最近幾天的固定網址
    console.log(page.slice(0, 300));
    for (let i = 1; i < 8 && !pick; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10).replace(/-/g, "_");
      for (const dir of ["DailydownloadCSV", "Dailydownload"]) { const u = `https://www.taifex.com.tw/file/taifex/Dailydownload/${dir}/Daily_${d}.zip`; const r = await fetch(u, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }).catch(e => ({ status: e.message, headers: new Map() }));
        console.log("試", u, r.status, r.headers.get?.("content-type"), r.headers.get?.("content-length")); if (r.status === 200 && !/html/i.test(r.headers.get("content-type") || "")) { pick = u; break; } } }
  }
  if (!pick) process.exit(0);
  const t0 = Date.now(), buf = Buffer.from(await (await fetch(pick, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) })).arrayBuffer()), f = os.tmpdir() + "/d.zip"; writeFileSync(f, buf);
  console.log("下載", pick, buf.length, "bytes", Date.now() - t0, "ms"); console.log(execFileSync("unzip", ["-l", f]).toString());
  const raw = execFileSync("unzip", ["-p", f], { maxBuffer: 1 << 30 }), txt = new TextDecoder("big5").decode(raw), L = txt.split(/\r?\n/);
  console.log("行數", L.length); console.log(L.slice(0, 4).join("\n"));
  const tx = L.filter(l => /^\s*\d{8}\s*,\s*TX\s*,/.test(l)); console.log("TX 行數", tx.length);
  const show = re => console.log(re.toString(), "\n" + tx.filter(l => re.test(l)).slice(0, 3).join("\n"));
  show(/,\s*0845\d\d\s*,|,\s*84[5-9]\d\d\s*,/); show(/,\s*1500\d\d\s*,/); show(/,\s*0000\d\d\s*,/); show(/,\s*0459\d\d\s*,/); show(/,\s*1344\d\d\s*,/);
  const mon = {}; tx.forEach(l => { const c = l.split(","); const k = c[2].trim(); mon[k] = (mon[k] || 0) + 1; }); console.log("到期月份分佈", JSON.stringify(mon));
  const dates = {}; tx.forEach(l => { const k = l.split(",")[0].trim(); dates[k] = (dates[k] || 0) + 1; }); console.log("日期分佈", JSON.stringify(dates));
  process.exit(0);
}
if (process.argv[2] === "usearn") {
  // 美股財報行事曆：Finnhub /calendar/earnings（要 FINNHUB_API_KEY，只印有沒有、筆數與一筆範例）與 Nasdaq 公開行事曆（不用金鑰）
  const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), key = (process.env.FINNHUB_API_KEY || "").trim();
  console.log("FINNHUB_API_KEY", key ? "有" : "沒有");
  if (key) { try { const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${d(-14)}&to=${d(14)}`, { headers: { "X-Finnhub-Token": key }, signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => null), L = j?.earningsCalendar || [];
    console.log("Finnhub", r.status, "筆數", L.length, "有實際 EPS", L.filter(x => x.epsActual != null).length, "範例", JSON.stringify(L.find(x => ["NFLX", "TSLA", "TSM", "JPM", "AAPL", "MSFT"].includes(x.symbol)) || L[0])); } catch (e) { console.log("Finnhub 失敗", e.message); } }
  for (const day of [d(-3), d(-2), d(-1), d(1), d(2)]) { try { const r = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${day}`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null), L = j?.data?.rows || []; console.log("Nasdaq", day, r.status, "筆數", L.length, "欄位", L[0] ? Object.keys(L[0]).join(",") : "", "範例", JSON.stringify(L[0] || j?.status || null).slice(0, 400)); } catch (e) { console.log("Nasdaq 失敗", day, e.message); } }
  process.exit(0);
}
if (process.argv[2] === "earn") {
  // 情報局「財報」：用真的證交所、櫃買資料跑 /api/oapi?earn=1 的合併邏輯，印出欄位有沒有對上
  const { rowsOf, earnRows } = await import("../api/_lib/oapi.js"), get = (s, p) => rowsOf(s, p).catch(e => (console.log("失敗", s, p, e.message), []));
  const [revL, revO, epsL, epsO, pmL, pmO] = await Promise.all([get("twse", "/opendata/t187ap05_L"), get("tpex", "/mopsfin_t187ap05_O"), get("twse", "/opendata/t187ap14_L"), get("tpex", "/mopsfin_t187ap14_O"), get("twse", "/opendata/t187ap17_L"), get("tpex", "/mopsfin_187ap17_O")]);
  const E = earnRows({ revL, revO, epsL, epsO, pmL, pmO }), n = i => E.rows.filter(r => r[i] != null).length;
  console.log("ym", E.ym, "yq", E.yq, "rows", E.rows.length, "上市", E.rows.filter(r => r[3] === "上市").length, "上櫃", E.rows.filter(r => r[3] === "上櫃").length);
  console.log("有值的筆數：營收", n(4), "年增", n(6), "EPS", n(8), "淨利", n(10), "毛利率", n(11), "營益率", n(12), "淨利率", n(13), "產業", E.rows.filter(r => r[2]).length);
  for (const c of ["2330", "2317", "1101", "6488", "3105"]) console.log(JSON.stringify(E.rows.find(r => r[0] === c)));
  console.log("JSON 大小", JSON.stringify(E).length);
  process.exit(0);
}
if (process.argv[2] === "oapi") {
  // 證交所、櫃買中心 OpenAPI：列出 swagger 裡所有 GET 資料集（分類、名稱），逐一抓一次，印筆數與第一筆的欄位、範例值（截短）
  for (const [nm, base, sw] of [["證交所", "https://openapi.twse.com.tw/v1", "https://openapi.twse.com.tw/v1/swagger.json"], ["櫃買", "https://www.tpex.org.tw/openapi/v1", "https://www.tpex.org.tw/openapi/swagger.json"]]) {
    let S; try { S = await (await fetch(sw, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) })).json(); } catch (e) { console.log(nm, "swagger 失敗", e.message); continue; }
    const paths = Object.entries(S.paths || {}).filter(([, v]) => v.get).map(([k, v]) => [k, (v.get.tags || []).join("/"), v.get.summary || ""]);
    console.log(`\n######## ${nm} ${paths.length} 個資料集`);
    let i = 0; const out = new Array(paths.length);
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < paths.length) { const k = i++, [p, tag, sum] = paths[k];
      try { const r = await fetch(base + p, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); const j = await r.json().catch(() => null);
        const rows = Array.isArray(j) ? j : []; out[k] = `${p}｜${tag}｜${sum}｜${r.status}｜${rows.length} 筆｜${rows[0] ? Object.entries(rows[0]).map(([a, b]) => `${a}=${String(b).slice(0, 14)}`).join("; ").slice(0, 420) : JSON.stringify(j)?.slice(0, 80)}`; }
      catch (e) { out[k] = `${p}｜${tag}｜${sum}｜錯誤 ${e.message}`; } } }));
    out.forEach(x => console.log(x));
  }
  process.exit(0);
}
if (process.argv[2] === "mops") {
  // 公開資訊觀測站上櫃月營收彙總（過去月份的 HTML 表）：看抓不抓得到、表格長怎樣，給櫃買「產業營收」補歷史用
  for (const u of ["https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_115_8_0.html", "https://mops.twse.com.tw/nas/t21/otc/t21sc03_115_8_0.html", "https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_114_9_0.html"]) {
    try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) }); const b = Buffer.from(await r.arrayBuffer()); const t = new TextDecoder(/big5/i.test(r.headers.get("content-type") || "") ? "big5" : "utf-8").decode(b);
      const i = t.indexOf("公司代號"); console.log(`\n### ${u} ${r.status} ${r.headers.get("content-type")} ${b.length} bytes\n${t.slice(0, 300)}\n…\n${t.slice(Math.max(0, i - 600), i + 2500).replace(/\s+/g, " ")}`); } catch (e) { console.log(u, "錯誤", e.message); } }
  process.exit(0);
}
if (process.argv[2] === "histprobe4") {
  // 第四輪：觀測站內部人轉讓日報表的第二步（ajax_t56sb12 step=2、report=SY）實際表格；上櫃（t56sb12_q2）的 report 代碼
  const cut = (s, n = 900) => String(s).replace(/\s+/g, " ").slice(0, n), UA = { "User-Agent": "Mozilla/5.0" };
  const post = async (u, body) => { try { const r = await fetch(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30000) }); const t = await r.text(), i = t.indexOf("<table");
    const trs = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()));
    console.log(`\n### POST ${u.split("/").pop()} ${body} → ${r.status} ${t.length} 表格 ${(t.match(/<table/g) || []).length} 列 ${trs.length}\n${trs.slice(0, 8).map(x => JSON.stringify(x)).join("\n")}\n${i < 0 ? cut(t, 1200) : ""}`); return t; } catch (e) { console.log("錯誤", e.message); return ""; } };
  await post("https://mopsov.twse.com.tw/mops/web/ajax_t56sb12", "encodeURIComponent=1&run=Y&step=2&year=114&month=03&day=03&report=SY&firstin=true");
  await post("https://mopsov.twse.com.tw/mops/web/ajax_t56sb12", "encodeURIComponent=1&step=2&year=114&month=03&day=03&report=SY&firstin=true");
  for (const q of ["t56sb12_q2", "t56sb12_q3"]) {
    try { const t = await (await fetch(`https://mopsov.twse.com.tw/mops/web/${q}`, { headers: UA, signal: AbortSignal.timeout(30000) })).text(); console.log(`\n### ${q} 標題 ${cut((t.match(/id='caption'>([\s\S]*?)<\/div>/) || [])[1] || "", 120)}`); } catch (e) { console.log(q, "錯誤", e.message); }
    const t2 = await post(`https://mopsov.twse.com.tw/mops/web/ajax_${q}`, "encodeURIComponent=1&step=1&firstin=true&off=1&year=114&month=03&day=03"); console.log("report 代碼", (t2.match(/name='report' value='(\w+)'/) || [])[1]);
  }
  await post("https://mopsov.twse.com.tw/mops/web/ajax_t56sb12", "encodeURIComponent=1&step=2&year=110&month=06&day=01&report=SY&firstin=true");
  process.exit(0);
}
if (process.argv[2] === "histprobe3") {
  // 第三輪：觀測站內部人轉讓的查詢表單送到哪裡、月日欄位的值；新版觀測站 JSON API
  const cut = (s, n = 900) => String(s).replace(/\s+/g, " ").slice(0, n), UA = { "User-Agent": "Mozilla/5.0" };
  try { const t = await (await fetch("https://mopsov.twse.com.tw/mops/web/t56sb12_q1", { headers: UA, signal: AbortSignal.timeout(30000) })).text(), i = t.search(/name=['"]?year/);
    console.log(`\n### t56sb12_q1 年月日附近\n${cut(t.slice(Math.max(0, i - 1500), i + 2500), 4000)}`);
    console.log(`\n### ajax／action\n${[...new Set([...t.matchAll(/(ajax_\w+|action=['"][^'"]+['"]|doAction\w*\([^)]*\)|ajax1\([^)]*\))/g)].map(m => m[1]))].slice(0, 30).join("\n")}`); } catch (e) { console.log("錯誤", e.message); }
  const tryMops = async (u, body) => { try { const r = await fetch(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30000) }); const t = await r.text(), i = t.indexOf("<table");
    console.log(`\n### POST ${u.split("/").pop()} ${body} → ${r.status} ${t.length} 表格 ${(t.match(/<table/g) || []).length} 列 ${(t.match(/<tr/g) || []).length}\n${cut(t.slice(i < 0 ? 0 : i, (i < 0 ? 0 : i) + 1500), 1500)}`); } catch (e) { console.log("錯誤", e.message); } };
  for (const u of ["https://mopsov.twse.com.tw/mops/web/ajax_t56sb12_q1", "https://mopsov.twse.com.tw/mops/web/ajax_t56sb12"])
    for (const b of ["encodeURIComponent=1&step=1&firstin=true&off=1&year=114&month=03&day=03", "encodeURIComponent=1&step=1&firstin=true&off=1&TYPEK=sii&year=114&month=3&day=3", "encodeURIComponent=1&step=1&firstin=true&off=1&year=114&month=03&day="]) await tryMops(u, b);
  for (const [u, b] of [["https://mops.twse.com.tw/mops/api/t56sb12", { year: "114", month: "03", day: "03" }], ["https://mops.twse.com.tw/mops/api/t56sb12_q1", { year: "114", month: "03", day: "03" }], ["https://mops.twse.com.tw/mops/api/t56sb12", { marketKind: "sii", year: "114", month: "3", dayStart: "1", dayEnd: "31" }]]) {
    try { const r = await fetch(u, { method: "POST", headers: { ...UA, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(30000) }); console.log(`\n### JSON ${u} ${JSON.stringify(b)} → ${r.status}\n${cut(await r.text(), 1500)}`); } catch (e) { console.log(u, "錯誤", e.message); } }
  process.exit(0);
}
if (process.argv[2] === "histprobe2") {
  // 第二輪：先讀表單欄位名稱，再照欄位送出查詢（觀測站內部人轉讓、集保個股某一週）
  const cut = (s, n = 900) => String(s).replace(/\s+/g, " ").slice(0, n), UA = { "User-Agent": "Mozilla/5.0" };
  const fields = t => [...t.matchAll(/<(input|select)[^>]*name=["']?([\w.]+)["']?[^>]*>/gi)].map(m => `${m[1]}:${m[2]}${(m[0].match(/value=["']([^"']*)["']/) || [])[1] ? "=" + m[0].match(/value=["']([^"']*)["']/)[1].slice(0, 20) : ""}`);
  for (const u of ["https://mopsov.twse.com.tw/mops/web/t56sb12", "https://mopsov.twse.com.tw/mops/web/t56sb12_q1"]) {
    try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const t = await r.text(); console.log(`\n### 表單 ${u} ${r.status} ${t.length}\n${fields(t).join(" ")}\n${cut(t.slice(t.indexOf("<form"), t.indexOf("<form") + 2500), 2500)}`); } catch (e) { console.log(u, "錯誤", e.message); } }
  const tryMops = async (u, body) => { try { const r = await fetch(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30000) }); const t = await r.text(), i = t.indexOf("<table");
    console.log(`\n### POST ${u.split("/").pop()} ${body} → ${r.status} ${t.length} 表格 ${(t.match(/<table/g) || []).length} 列 ${(t.match(/<tr/g) || []).length}\n${cut(t.slice(i < 0 ? 0 : i, (i < 0 ? 0 : i) + 1800), 1800)}`); } catch (e) { console.log("錯誤", e.message); } };
  for (const b of ["encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=sii&sdate=114/03/01&edate=114/03/31", "encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=sii&date1=114/03/01&date2=114/03/31",
    "encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=sii&year=114&month=03&day1=01&day2=31", "encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=sii&s_date=1140301&e_date=1140331"]) await tryMops("https://mopsov.twse.com.tw/mops/web/ajax_t56sb12", b);
  // 集保：拿 token 與 cookie，再查 2330 最近第二個週次、一年前的週次
  try { const r = await fetch("https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", { headers: UA, signal: AbortSignal.timeout(30000) }), t = await r.text(), ck = (r.headers.get("set-cookie") || "").split(";")[0];
    const tok = (t.match(/name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]+)"/) || t.match(/value="([^"]+)"[^>]*name="SYNCHRONIZER_TOKEN"/) || [])[1], D = [...t.matchAll(/<option[^>]*value="(\d{8})"/g)].map(m => m[1]);
    console.log(`\n### 集保表單欄位 ${fields(t.slice(t.indexOf("<form"), t.indexOf("</form>") + 7)).join(" ")}\ntoken ${tok ? tok.length + " 字" : "沒有"} cookie ${ck ? "有" : "沒有"}`);
    for (const d of [D[1], D.at(-1)]) {
      const body = new URLSearchParams({ SYNCHRONIZER_TOKEN: tok || "", SYNCHRONIZER_URI: "/portal/zh/smWeb/qryStock", method: "submit", firmNo: "", scaDate: d, sqlMethod: "StockNo", stockNo: "2330", stockName: "" });
      const r2 = await fetch("https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body, signal: AbortSignal.timeout(30000) }), t2 = await r2.text(), i = t2.indexOf("持股/單位數分級");
      console.log(`\n### 集保 2330 ${d} → ${r2.status} ${t2.length} bytes\n${cut(t2.slice(Math.max(0, i - 200), i + 2200), 2400)}`);
    } } catch (e) { console.log("集保錯誤", e.message); }
  process.exit(0);
}
if (process.argv[2] === "histprobe") {
  // 大戶國會補歷史資料：觀測站內部人持股轉讓事前申報（過去月份）、集保股權分散表過去週次、FinMind 全市場持股分級（看有沒有權限）
  const cut = (s, n = 900) => String(s).replace(/\s+/g, " ").slice(0, n), UA = { "User-Agent": "Mozilla/5.0" };
  const post = async (u, body) => { try { const r = await fetch(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(30000) }); const t = await r.text(), i = Math.max(t.indexOf("申報日期"), t.indexOf("申報人"), t.indexOf("公司代號"));
    console.log(`\n### POST ${u.split("/").pop()} ${body.slice(0, 120)} → ${r.status} ${t.length} bytes 表格 ${(t.match(/<table/g) || []).length}\n${cut(t.slice(Math.max(0, i - 200), i + 1500), 1700)}`); } catch (e) { console.log(u, "錯誤", e.message); } };
  for (const typ of ["sii", "otc"]) for (const u of ["https://mopsov.twse.com.tw/mops/web/ajax_t56sb12_q1", "https://mopsov.twse.com.tw/mops/web/ajax_t56sb12"]) {
    await post(u, `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${typ}&year=114&smonth=3&emonth=3&sday=1&eday=31&co_id=`);
    await post(u, `encodeURIComponent=1&run=Y&step=1&TYPEK=${typ}&year=114&month=03&begin_day=1&end_day=31&co_id=`);
  }
  for (const u of ["https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", "https://www.tdcc.com.tw/smWeb/QryStockAjax.do"]) {
    try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const t = await r.text(), d = [...t.matchAll(/<option[^>]*value="(\d{8})"/g)].map(m => m[1]);
      console.log(`\n### GET ${u} → ${r.status} ${t.length} bytes 週次 ${d.length} 個：${d.slice(0, 3).join(",")}…${d.slice(-2).join(",")} token ${/SYNCHRONIZER_TOKEN/.test(t)} cookie ${(r.headers.get("set-cookie") || "").slice(0, 60)}`); } catch (e) { console.log(u, "錯誤", e.message); } }
  const K = (process.env.FINMIND_TOKEN || "").trim(), fm = async q => { try { const r = await fetch(`https://api.finmindtrade.com/api/v4/data?${q}`, { headers: K ? { Authorization: `Bearer ${K}` } : {}, signal: AbortSignal.timeout(60000) }); const j = await r.json(); console.log(`\n### FinMind ${q} → ${r.status} ${j.msg || ""} ${j.data?.length ?? "?"} 筆 ${JSON.stringify(j.data?.[0] || "")}`); } catch (e) { console.log("FinMind 錯誤", e.message); } };
  console.log("FINMIND_TOKEN", K ? "有設定" : "沒有");
  await fm("dataset=TaiwanStockHoldingSharesPer&start_date=2025-10-17&end_date=2025-10-17");
  await fm("dataset=TaiwanStockHoldingSharesPer&data_id=2330&start_date=2023-01-01&end_date=2023-02-01");
  await fm("dataset=TaiwanStockHoldingSharesPer&data_id=2330&start_date=2019-01-01&end_date=2019-01-31");
  process.exit(0);
}
if (process.argv[2] === "official") {
  // 「全部加入」用到的證交所、櫃買資料集：印筆數、欄位、第一筆（截短）
  const P = [["twse", "/opendata/t187ap04_L"], ["tpex", "/mopsfin_t187ap04_O"], ["twse", "/Announcement/BFZFZU_T"], ["twse", "/opendata/t187ap22_L"], ["tpex", "/mopsfin_t187ap22_O"], ["twse", "/opendata/t187ap23_L"], ["twse", "/opendata/t187ap24_L"], ["tpex", "/mopsfin_t187ap24_O"],
    ["twse", "/opendata/t187ap10_L"], ["tpex", "/mopsfin_t187ap10_O"], ["twse", "/exchangeReport/TWT85U"], ["twse", "/exchangeReport/TWTAWU"], ["tpex", "/tpex_cmode"], ["twse", "/company/applylistingLocal"], ["twse", "/company/newlisting"], ["twse", "/company/suspendListingCsvAndHtml"],
    ["twse", "/exchangeReport/TWT88U"], ["tpex", "/tpex_esb_applicant_companies"], ["tpex", "/tpex_ipo_no_limit"], ["tpex", "/mopsfin_t187ap03_R"], ["tpex", "/t187ap05_R"], ["tpex", "/tpex_esb_latest_statistics"], ["twse", "/ETFReport/ETFRank"], ["tpex", "/tpex_active_broker_volume"],
    ["twse", "/holidaySchedule/holidaySchedule"], ["twse", "/opendata/t187ap06_L_ci"], ["tpex", "/mopsfin_t187ap06_O_ci"], ["twse", "/opendata/t187ap07_L_ci"], ["tpex", "/mopsfin_t187ap07_O_ci"], ["twse", "/exchangeReport/MI_MARGN"], ["tpex", "/tpex_mainboard_margin_balance"],
    ["twse", "/block/BFIAUU_d"], ["tpex", "/tpex_daily_qutoes_block"], ["twse", "/exchangeReport/FMNPTK_ALL"], ["twse", "/opendata/t187ap43_L"], ["twse", "/opendata/t187ap42_L"], ["tpex", "/tpex_warrant_wcb_daily_quts"], ["twse", "/opendata/t187ap46_L_16"], ["tpex", "/t187ap46_O_16"], ["twse", "/opendata/t187ap46_L_2"]];
  const B = { twse: "https://openapi.twse.com.tw/v1", tpex: "https://www.tpex.org.tw/openapi/v1" };
  const cut = r => JSON.stringify(r && Object.fromEntries(Object.entries(r).map(([a, b]) => [a, String(b).replace(/\s+/g, " ").slice(0, 30)]))).slice(0, 900);
  await Promise.all(P.map(async ([s, p], i) => { await sleep(i * 300); let line;
    try { const r = await fetch(B[s] + p, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(90000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} const L = Array.isArray(j) ? j : [];
      line = L.length ? `### ${s}${p} ${r.status} ${L.length} 筆\n${cut(L[0])}\n…${cut(L[L.length - 1])}` : `### ${s}${p} ${r.status} 0 筆 ${t.length} bytes ${t.slice(0, 160)}`; } catch (e) { line = `### ${s}${p} 錯誤 ${e.message}`; }
    P[i].out = line; }));
  for (const x of P) console.log("\n" + x.out);
  process.exit(0);
}
if (process.argv[2] === "twsecharts") {
  // 情報局「上市」圖表：證交所 rwd 的月資料（補歷史用）、類股指數、觀測站上市月營收彙總表，印格式
  const H = { "User-Agent": "Mozilla/5.0", Accept: "*/*" }, cut = (s, n = 700) => String(s).replace(/\s+/g, " ").slice(0, n);
  for (const u of ["https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/indicesReport/MI_5MINS_HIST?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=20240301&response=json",
    "https://www.twse.com.tw/rwd/zh/TAIEX/MFI94U?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/indicesReport/MFI94U?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/FTSE/TAI50I?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/indicesReport/TAI50I?date=20240301&response=json",
    "https://www.twse.com.tw/rwd/zh/indicesReport/FRMSA?date=20240301&response=json", "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20240301&type=IND&response=json"]) {
    try { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(30000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      console.log(`\n### ${u} ${r.status} ${t.length} bytes`); if (!j) { console.log(cut(t, 200)); continue; }
      console.log("stat", j.stat, "fields", JSON.stringify(j.fields), "data", j.data?.length, cut(JSON.stringify(j.data?.slice(0, 2))), "tables", j.tables?.length);
      for (const T of j.tables || []) console.log("  table", T.title, JSON.stringify(T.fields), T.data?.length, cut(JSON.stringify(T.data?.slice(0, 3)), 400)); } catch (e) { console.log(u, "錯誤", e.message); } }
  try { const r = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX", { headers: H, signal: AbortSignal.timeout(60000) }); const L = await r.json(); console.log("\n### openapi MI_INDEX", L.length, "筆"); console.log(L.map(x => x["指數"]).join("、")); } catch (e) { console.log("MI_INDEX 錯誤", e.message); }
  for (const u of ["https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_8_0.html", "https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_112_1_0.html"]) {
    try { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(30000) }); const t = new TextDecoder("big5").decode(await r.arrayBuffer()), i = t.indexOf("公司代號");
      console.log(`\n### ${u} ${r.status} ${t.length}\n${cut(t.slice(Math.max(0, i - 400), i + 1500), 1900)}`); } catch (e) { console.log(u, "錯誤", e.message); } }
  process.exit(0);
}
if (process.argv[2] === "twsedry") {
  // 上市圖表排程用真實資料跑一次（寫到暫存檔，不動 repo），印筆數與最新幾天
  const os = await import("node:os"), { main } = await import("./twse-daily.mjs"), t0 = Date.now();
  const o = await main({ out: os.tmpdir() + "/twse.json", rev: os.tmpdir() + "/twse-rev.json" });
  const C = o.ix.cols, last = o.ix.rows.at(-1), first = o.ix.rows[0];
  console.log("秒", Math.round((Date.now() - t0) / 1000), "指數", o.ix.rows.length, "天", first?.[0], "～", last?.[0]); console.log(C.map((c, i) => `${c}=${last?.[i]}`).join(" "));
  console.log("有值天數", C.slice(1).map((c, i) => `${c}:${o.ix.rows.filter(r => r[i + 1] != null).length}`).join(" "));
  console.log("量值", o.vol.length, "天", JSON.stringify(o.vol.slice(0, 1)), JSON.stringify(o.vol.slice(-2)));
  console.log("類股", o.sec.cols.length, "類", o.sec.rows.length, "天", o.sec.cols.join("、")); console.log(JSON.stringify(o.sec.rows.at(-1)));
  console.log("月營收", o.revm.length, "個月", o.revm.at(-1)?.ym, "家數", o.revm.at(-1)?.n, "創新高", o.revm.at(-1)?.hi.length, JSON.stringify(Object.entries(o.revm.at(-1)?.ind || {}).slice(0, 4)));
  for (const k of ["pledge", "short", "fc", "sus", "sss", "wtu"]) console.log("snap", k, JSON.stringify(o.snap[k])?.slice(0, 400));
  process.exit(0);
}
if (process.argv[2] === "earnprobe") {
  // 財報新功能要用的資料：觀測站營益分析彙總表（各季三率）、Finnhub 財報行事曆（營收實際／預估、歷史公布日）
  const cut = (s, n = 900) => String(s).replace(/\s+/g, " ").slice(0, n);
  for (const [typ, y, s] of [["sii", 115, "02"], ["otc", 115, "02"], ["sii", 114, "04"]]) {
    for (const u of ["https://mopsov.twse.com.tw/mops/web/ajax_t163sb06", "https://mopsov.twse.com.tw/mops/web/ajax_t163sb04"]) {
      try { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" }, body: `encodeURIComponent=1&step=1&firstin=1&off=1&isQuery=Y&TYPEK=${typ}&year=${y}&season=${s}`, signal: AbortSignal.timeout(30000) });
        const t = await r.text(), i = t.indexOf("公司代號"); console.log(`\n### ${u.split("/").pop()} ${typ} ${y}Q${s} ${r.status} ${t.length} bytes 表格 ${(t.match(/<table/g) || []).length}\n${cut(t.slice(Math.max(0, i - 300), i + 1500), 1800)}`); } catch (e) { console.log(u, "錯誤", e.message); } } }
  const K = process.env.FINNHUB_API_KEY; if (!K) { console.log("沒有 FINNHUB_API_KEY"); process.exit(0); }
  const fh = async p => { const r = await fetch("https://finnhub.io/api/v1" + p + (p.includes("?") ? "&" : "?") + "token=" + K, { signal: AbortSignal.timeout(20000) }); return [r.status, await r.json().catch(() => null)]; };
  const d0 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), d1 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  let [st, j] = await fh(`/calendar/earnings?from=${d0}&to=${d1}`); const L = j?.earningsCalendar || []; console.log("\n### finnhub calendar 4 週", st, L.length, "筆", JSON.stringify(L.filter(x => x.revenueActual).slice(0, 2)), JSON.stringify(L.filter(x => !x.revenueActual).slice(0, 1)));
  for (const sym of ["NVDA", "AAPL"]) { [st, j] = await fh(`/calendar/earnings?symbol=${sym}&from=2023-01-01&to=${d1}`); const E = j?.earningsCalendar || []; console.log(`### finnhub ${sym} 歷史`, st, E.length, "筆", JSON.stringify(E.slice(0, 2)), "…", JSON.stringify(E.slice(-1))); }
  [st, j] = await fh(`/stock/earnings?symbol=NVDA&limit=12`); console.log("### stock/earnings NVDA", st, Array.isArray(j) ? j.length : j, JSON.stringify(Array.isArray(j) ? j.slice(-1) : ""));
  process.exit(0);
}
if (process.argv[2] === "earndry") {
  // 財報進階排程用真實資料跑一次（寫到暫存資料夾，不動 repo）
  const os = await import("node:os"), fs = await import("node:fs/promises"), path = await import("node:path"), { main } = await import("./earn-hist.mjs"), dir = await fs.mkdtemp(os.tmpdir() + "/eh-");
  for (const f of ["twse-rev.json", "tpex-rev.json"]) await fs.copyFile(new URL(`../learner/data/${f}`, import.meta.url), path.join(dir, f));
  const o = await main({ dir: f => path.join(dir, f) }), P = o.pm;
  console.log("連續成長", o.streak?.ym, o.streak?.rows.length, JSON.stringify(o.streak?.rows.slice(0, 3)));
  console.log("公布進度", o.pub?.ym, o.pub?.n, "/", o.pub?.total);
  console.log("三率", P?.q, P?.qp, P?.qy, P?.rows.length, "家；三率三升", P?.rows.filter(r => r[7] > 0 && r[8] > 0 && r[9] > 0).length, JSON.stringify(P?.rows.find(r => r[0] === "2330")), JSON.stringify(P?.rows.find(r => r[0] === "1101")));
  process.exit(0);
}
if (process.argv[2] === "tpexcharts") {
  // 情報局「櫃買」圖表用到的資料集：印筆數、欄位、前兩筆與最後一筆（截短），好對欄位名稱
  const P = process.argv[3] === "2" ? ["/mopsfin_t187ap15_O", "/mopsfin_t187ap16_O", "/mopsfin_t187ap08_O", "/tpex_gold_market_highlight", "/tpex_warrant_daily_quts", "/tpex_warrant_statistics", "/tpex_warrant_issue"] : ["/tpex_index", "/tpex_reward_index", "/tpex50_index", "/tpex200_change", "/tphd_index", "/tpcgi_reward_index", "/tpci_reward_index", "/tpex_emp88_reward_index", "/tpex_daily_trading_index", "/mopsfin_t187ap05_OA", "/mopsfin_t187ap05_OB", "/mopsfin_t187ap15_O", "/mopsfin_t187ap16_O", "/mopsfin_t187ap09_O", "/mopsfin_t187ap08_O", "/tpex_warrant_statistics", "/tpex_intraday_trading_pre", "/tpex_margin_trading_term", "/tpex_esb_eps_rank", "/tpex_gold_latest", "/tpex_gold_market_highlight", "/bond_cb_daily"];
  const cut = r => JSON.stringify(r && Object.fromEntries(Object.entries(r).map(([a, b]) => [a, String(b).slice(0, 24)]))).slice(0, 700);
  for (const p of P) { try { const r = await fetch("https://www.tpex.org.tw/openapi/v1" + p, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(90000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} const L = Array.isArray(j) ? j : [];
    if (!L.length) { console.log(`\n### ${p} ${r.status} 0 筆 ${t.length} bytes ${t.slice(0, 200)}`); continue; }
    console.log(`\n### ${p} ${r.status} ${L.length} 筆\n${cut(L[0])}\n${cut(L[1])}\n…${cut(L[L.length - 1])}`); } catch (e) { console.log(`\n### ${p} 錯誤 ${e.message}`); } }
  process.exit(0);
}
if (process.argv[2] === "keys") {
  // 金鑰檢查（GitHub secrets 有沒有設定、能不能用）：只印「有沒有」「狀態碼」「用量」，絕不印金鑰或帶金鑰的網址
  const has = k => !!(process.env[k] && process.env[k].trim()), tk = k => process.env[k].trim();
  console.log("secrets：", ["FRED_API_KEY", "FUGLE_API_KEY", "FINMIND_TOKEN"].map(k => `${k}=${has(k) ? "有（" + tk(k).length + " 字元）" : "沒有"}`).join("、"));
  const call = async (label, url, headers = {}) => { const t0 = Date.now(); try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} console.log(`${label} → HTTP ${r.status} ${Date.now() - t0}ms ${t.length} bytes`); return { r, j, t }; } catch (e) { console.log(`${label} → 錯誤 ${e.name === "TimeoutError" ? "逾時" : "網路錯誤"}`); return {}; } };
  if (has("FRED_API_KEY")) { const { j } = await call("FRED 官方介面 DGS10", `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(tk("FRED_API_KEY"))}&file_type=json&sort_order=desc&limit=3`); console.log("  最近 3 筆：", JSON.stringify((j?.observations || []).map(o => [o.date, o.value])), j?.error_message ? "訊息：" + String(j.error_message).replace(/[0-9a-f]{20,}/gi, "***") : ""); }
  if (has("FINMIND_TOKEN")) { const { j } = await call("FinMind 使用量", "https://api.web.finmindtrade.com/v2/user_info", { Authorization: `Bearer ${tk("FINMIND_TOKEN")}` }); console.log("  已用／上限：", j?.user_count, "/", j?.api_request_limit, "（等級欄位：", Object.keys(j || {}).filter(k => !/token|key|email|password/i.test(k)).join(","), "）"); }
  if (has("FUGLE_API_KEY")) {
    const h = { "X-API-KEY": tk("FUGLE_API_KEY") }, base = "https://api.fugle.tw/marketdata/v1.0";
    await call("富果 股票報價 2330", `${base}/stock/intraday/quote/2330`, h);
    const sym = (await import("../api/_lib/futures.js")).nearMonth().code;
    for (const q of ["timeframe=D&from=2026-09-01&to=2026-10-16", "timeframe=1&from=2026-10-12&to=2026-10-16", "timeframe=5&from=2026-10-12&to=2026-10-16"]) { const { j, t } = await call(`富果 期貨歷史 ${sym} ${q.split("&")[0]}`, `${base}/futopt/historical/candles/${sym}?${q}`, h); console.log("  根數", Array.isArray(j?.data) ? j.data.length : "—", "第一筆", JSON.stringify(j?.data?.[0] || null).slice(0, 160), j?.message ? "訊息 " + String(j.message).slice(0, 120) : ""); }
    await call(`富果 期貨盤中分 K ${sym} timeframe=1`, `${base}/futopt/intraday/candles/${sym}?timeframe=1`, h);
  }
  // 網站（Vercel）那邊：/api/status 只回「有沒有設定」與連線測試結果（部署新版之後才有 FRED、Finnhub 這兩項）
  const st = await hit("/api/status"), J = st.j || {};
  console.log("網站 /api/status →", st.status ?? st.err, "已設定：", JSON.stringify(J.set || null), "連線測試：", JSON.stringify({ fugle: J.fugle?.ok ?? null, fred: J.fred ? J.fred.ok : null, finnhub: J.finnhub ? J.finnhub.ok : null }), J.fred && !J.fred.ok ? "FRED：" + J.fred.hint : "", J.finnhub && !J.finnhub.ok ? "Finnhub：" + J.finnhub.hint : "");
  const mc = await hit("/api/macro"); console.log("網站 /api/macro →", mc.status ?? mc.err, "來源", mc.j?.via ?? "（舊版沒有 via）", "數列", mc.j?.series?.length, "拿不到", mc.j?.notes?.length ?? "—");
  const qu = await hit("/api/quote?codes=AAPL,NVDA"); console.log("網站 /api/quote 美股 →", qu.status ?? qu.err, qu.j?.source, (qu.j?.quotes || []).map(x => `${x.code}=${x.price}`).join(" "));
  process.exit(0);
}
if (process.argv[2] === "tpexdump") { process.argv.push("--dump"); const m = await import("./tpex-ic.mjs"); await m.main(); process.exit(0); } // 產業價值鏈抓取（只印數量，不寫檔）
if (process.argv[2] === "tpexic2") {
  const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school research)" };
  const get = async u => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); return await r.text(); } catch (e) { return "ERR " + e.message; } };
  const home = await get("https://ic.tpex.org.tw/index.php"), H = home.replace(/\s+/g, " ");
  console.log("首頁產業名稱：", [...H.matchAll(/introduce\.php\?ic=(\w+)["'][^>]*>([\s\S]{0,200}?)<\/a>/g)].map(m => m[1] + "=" + m[2].replace(/<[^>]+>/g, "").trim()).join("｜"));
  const t = (await get("https://ic.tpex.org.tw/introduce.php?ic=D000")).replace(/\s+/g, " ");
  const i = t.indexOf("company_basic.php?stk_code=2401"); console.log("\n公司清單前後：\n" + t.slice(i - 2500, i + 600));
  const j = t.indexOf("company_basic.php?stk_code=2337"); console.log("\n記憶體附近：\n" + t.slice(j - 1200, j + 300));
  console.log("\nic_link：", [...t.matchAll(/id="ic_link_(\w+)"[^>]*>([\s\S]{0,80}?)<\/div>/g)].map(m => m[1] + "=" + m[2].replace(/<br\/?>/g, "").replace(/<[^>]+>/g, "")).join("｜"));
  const js = await get("https://ic.tpex.org.tw/js/D000.js"); console.log("\nD000.js", js.length, js.slice(0, 1500));
  process.exit(0);
}
if (process.argv[2] === "tpexic") {
  // 櫃買中心「產業價值鏈資訊平台」：看首頁的產業清單連結、一個產業頁（半導體）的結構、子產業的公司清單怎麼放
  const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school research)", Accept: "text/html,application/json" };
  const get = async u => { const t0 = Date.now(); try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); const t = await r.text(); console.log(`\n### ${u} → ${r.status} ${r.headers.get("content-type")} ${t.length} bytes ${Date.now() - t0}ms`); return t; } catch (e) { console.log(`\n### ${u} → 錯誤 ${e.message}`); return ""; } };
  const links = (t, re) => [...new Set([...t.matchAll(/href=["']([^"']+)["'][^>]*>([^<]{0,40})/g)].filter(m => re.test(m[1])).map(m => `${m[1]} ｜ ${m[2].trim()}`))];
  const home = await get("https://ic.tpex.org.tw/index.php");
  const L = links(home, /introduce|ic=|chain|list/i); console.log("首頁產業連結", L.length); console.log(L.slice(0, 60).join("\n"));
  for (const u of ["https://ic.tpex.org.tw/introduce.php?ic=D000", "https://ic.tpex.org.tw/introduce.php?ic=D000&stk_code=2330"]) {
    const t = await get(u); const K = links(t, /\.php/); console.log("連結", K.length); console.log(K.slice(0, 80).join("\n"));
    const sc = [...t.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1]); console.log("scripts", sc.join(" "));
    const aj = [...new Set([...t.matchAll(/["']([\w/.-]*\.php[^"']*)["']/g)].map(m => m[1]))]; console.log("php 字串", aj.slice(0, 40).join(" "));
    const codes = [...new Set([...t.matchAll(/\b(\d{4})\b/g)].map(m => m[1]))]; console.log("4 碼數字", codes.length, codes.slice(0, 40).join(","));
    console.log("片段", t.replace(/\s+/g, " ").slice(t.replace(/\s+/g, " ").indexOf("上游") - 200, t.replace(/\s+/g, " ").indexOf("上游") + 1500));
  }
  process.exit(0);
}
if (process.argv[2] === "us") {
  // 美股：Yahoo 與 Finnhub 報價速度（網站 /api/status?bench=1），以及新的 /api/usinfo 公司資料、指標、財報
  const b = await hit("/api/status?bench=1"); console.log("bench", b.status ?? b.err, JSON.stringify(b.j?.bench || null));
  for (const c of ["AAPL", "NVDA", "TSM"]) { const u = await hit(`/api/usinfo?code=${c}`), J = u.j || {};
    console.log(`usinfo ${c}`, u.status ?? u.err, `${u.ms}ms`, J.ok, J.error || "", "來源", J.source, "公司", J.profile?.name, J.profile?.industry, "指標", Object.keys(J.metric || {}).length, JSON.stringify(J.metric || {}).slice(0, 200),
      "評等", JSON.stringify(J.rec?.[0] || null), "EPS", J.earn?.length, JSON.stringify(J.earn?.at(-1) || null), "SEC 季", J.fin?.q?.length, JSON.stringify(J.fin?.q?.at(-1) || null), "年", J.fin?.y?.length, "errors", JSON.stringify(J.errors)); }
  const ix = await hit("/api/intraday?code=o00&spark=1"); console.log("櫃買 spark", ix.status ?? ix.err, ix.j?.ok, ix.j?.source, ix.j?.spark?.length, JSON.stringify(ix.j?.spark?.slice(-2)), ix.j?.error || "");
  const fs = await hit("/api/futures?cid=TXF&bars=spark"); console.log("台指 spark", fs.status ?? fs.err, fs.j?.spark?.length, JSON.stringify(fs.j?.spark?.slice(-2)), "prev", fs.j?.quote?.prev);
  process.exit(0);
}
if (process.argv[2] === "fut") {
  // 台指期分 K：網站 /api/futures 回傳幾根、note、錯誤；再直接看期交所 1 分 K（日盤 -F、夜盤 -M）原始回應
  const f = await hit("/api/futures"); const j = f.j || {}, B = j.bars || [];
  console.log("site /api/futures", f.status ?? f.err, `${f.ms}ms`, "session", j.session, "source", j.source, "bars", B.length, "first", JSON.stringify(B[0]), "last", JSON.stringify(B.at(-1)), "note", j.note, "errors", JSON.stringify(j.errors), "symbol", j.symbol);
  console.log("quote", JSON.stringify(j.quote), "\nday", JSON.stringify(j.day), "\nnight", JSON.stringify(j.night));
  const sym = j.symbol || "TXFJ6";
  for (const sid of [sym + "-F", sym + "-M"]) { const t0 = Date.now(); try { const r = await fetch("https://mis.taifex.com.tw/futures/api/getChartData1M", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ SymbolID: sid }), signal: AbortSignal.timeout(20000) }); const t = await r.text(); console.log(`\n### taifex 1M ${sid} ${r.status} ${Date.now() - t0}ms ${t.length} bytes`);
      const j = JSON.parse(t), walk = (o, path, d = 0) => { if (d > 4 || !o || typeof o !== "object") return; if (Array.isArray(o)) { console.log(path, "陣列", o.length, "第一筆", JSON.stringify(o[0]).slice(0, 300), "最後", JSON.stringify(o.at(-1)).slice(0, 200)); return; } console.log(path, "物件 keys", Object.keys(o).join(",").slice(0, 300)); for (const [k, v] of Object.entries(o)) if (v && typeof v === "object") walk(v, path + "." + k, d + 1); };
      walk(j, "$"); const { parseTaifexChart } = await import("../api/_lib/futures.js"); const b = parseTaifexChart(j, sid.endsWith("-M") ? "night" : "day", "2026-10-16"); console.log("parseTaifexChart →", b.length, JSON.stringify(b[0]), JSON.stringify(b.at(-1))); } catch (e) { console.log(`taifex 1M ${sid} 錯誤 ${e.message}`); } }
  const d = await hit("/api/futures?daily=1"); console.log("\nsite daily", d.status ?? d.err, "rows", d.j?.rows?.length ?? d.j?.data?.length, JSON.stringify((d.j?.rows || d.j?.data || []).slice(-2)));
  process.exit(0);
}
if (process.argv[2] === "ext") {
  // 多因子的價值因子：上市 BWIBBU_ALL、上櫃本益比分析（確認欄位名稱）＋解析後的筆數
  for (const u of ["https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"]) await raw(u, 600);
  try { const { valuation } = await import("../api/_lib/screen.js"), v = await valuation(); console.log("valuation 筆數", v.n, "2330", v.rows["2330"], "6488", v.rows["6488"], "8299", v.rows["8299"]); } catch (e) { console.log("valuation 失敗", e.message); }
  process.exit(0);
}
for (let i = 0; i < N; i++) {
  const now = Date.now(), [q, m, f] = await Promise.all([hit("/api/quote?codes=T00,O00,2330&src=mis"), hit("/api/market"), hit("/api/futures?bars=0")]);
  const T = q.j?.quotes?.find(x => x.code === "T00"), S = q.j?.quotes?.find(x => x.code === "2330");
  console.log(`[${tpe(now)}] quote ${q.status ?? q.err} ${q.ms}ms cache=${q.cache} age=${q.age} source=${q.j?.source} session=${q.j?.session} T00=${T?.price} 時間=${T?.time} 2330=${S?.price} ${S?.time}${q.j?.backup ? " 備援原因=" + q.j.backup : ""}${q.j?.ok === false ? " 錯誤=" + q.j.error : ""}`);
  console.log(`           market ${m.status ?? m.err} ${m.ms}ms cache=${m.cache} age=${m.age} live=${m.j?.live} time=${m.j?.time} date=${m.j?.date} source=${m.j?.source}${m.j?.ok === false ? " 錯誤=" + m.j.error : ""}`);
  console.log(`           futures ${f.status ?? f.err} ${f.ms}ms session=${f.j?.session} price=${f.j?.quote?.price} time=${f.j?.quote?.time} source=${f.j?.source}`);
  if (i < N - 1) await sleep(GAP);
}
