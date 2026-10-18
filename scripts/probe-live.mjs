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
