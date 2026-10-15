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
if (process.argv[2] === "ext") {
  await raw("https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_00631l.tw|tse_00632r.tw&json=1&delay=0", 400);
  await raw("https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_00631L.tw|tse_00632R.tw|tse_00675L.tw&json=1&delay=0", 1500);
  await raw(SITE + "/api/quote?codes=00631L,00632R,00675L,00676R", 1500);
  await raw(SITE + "/api/kline?code=00631L&months=3", 300);
  await raw(SITE + "/api/global", 1500);
  await raw("https://gamma-api.polymarket.com/tags?limit=300", 4000);
  await raw("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=3&order=volume24hr&ascending=false&tag_slug=economy", 3000);
  await raw("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=2&order=volume24hr&ascending=false&tag_slug=fed-rates", 2500);
  for (const id of ["CPIAUCSL", "UNRATE", "FEDFUNDS", "DGS10", "T10Y2Y", "GDPC1", "PAYEMS", "VIXCLS"]) await raw(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2025-01-01`, 200);
  await raw("https://index.ndc.gov.tw/n/json/data/eco/indicators", 600);
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
