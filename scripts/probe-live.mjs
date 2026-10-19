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
