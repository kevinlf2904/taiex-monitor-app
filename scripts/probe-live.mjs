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
