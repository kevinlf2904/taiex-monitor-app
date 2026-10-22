// 集保股權分散（單一股票、過去約一年每週）：給 learner/watch.html「大戶國會 → 台股個股」的千張大戶走勢，也是 /api/company 股權分散的備援。
// GET /api/tdcc?code=2330[&from=YYYY-MM-DD][&to=YYYY-MM-DD] → { ok, code, rows: [[資料日期, 千張大戶%, 400 張以上%, 50 張以下%, 總人數, 千張大戶人數]…], dist, dates }
// 來源：集保結算所「集保戶股權分散表查詢」（www.tdcc.com.tw/portal/zh/smWeb/qryStock），網站只保留最近一年的週次。
// 每週要送一次表單：先打開查詢頁拿 SYNCHRONIZER_TOKEN 與 cookie，每次回應會帶下一次要用的 token。開幾條連線同時查，一年約 51 週幾秒內查完。
// 欄位和排程（scripts/tdcc.mjs）存的 learner/data/tdcc/*.json 一樣，網頁可以直接接在排程累積的資料前面。

const URL0 = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", UA = "Mozilla/5.0 (compatible; kline-school-learner)";
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(), num = s => { const v = +String(s ?? "").replace(/[,\s]/g, ""); return Number.isFinite(v) ? v : null; };
export const tokenOf = html => (String(html).match(/name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]+)"/) || String(html).match(/value="([^"]+)"[^>]*name="SYNCHRONIZER_TOKEN"/) || [])[1] || "";
// 查詢頁的週次選單（新到舊）→ ["2026-10-16", …]
export const datesOf = html => [...new Set([...String(html).matchAll(/<option[^>]*value="(\d{8})"/g)].map(m => `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`))].sort().reverse();
// 查詢結果的分級表 → { levels: [{ lv, people, shares, pct }]（1～15 級＋17 合計）}；查無資料回 null
export function parseWeek(html) {
  const t = String(html), i = t.indexOf("持股/單位數分級"); if (i < 0 || /查無此資料/.test(t.slice(i, i + 3000))) return null;
  const tb = t.slice(i, t.indexOf("</table>", i)), levels = [];
  for (const r of tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const c = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => strip(m[1])); if (c.length < 5) continue;
    const lv = num(c[0]); if (!(lv >= 1)) continue;
    levels.push({ lv, range: c[1], people: num(c[2]), shares: num(c[3]), pct: num(c[4]) });
  }
  return levels.length ? { levels } : null;
}
// 分級 → [日期, 千張%, 400 張以上%, 50 張以下%, 總人數, 千張人數]（和 scripts/tdcc.mjs 一樣：15 級＝1,000 張以上、12～15 級＝400 張以上、1～8 級＝50 張以下、17 級＝合計）
export function weekRow(date, W) {
  let p1000 = 0, p400 = 0, p50 = 0, people = 0, n1000 = 0;
  for (const x of W.levels) { const p = x.pct || 0; if (x.lv === 15) { p1000 += p; n1000 += x.people || 0; } if (x.lv >= 12 && x.lv <= 15) p400 += p; if (x.lv <= 8) p50 += p; if (x.lv === 17) people = x.people || 0; }
  return [date, +p1000.toFixed(2), +p400.toFixed(2), +p50.toFixed(2), people, n1000];
}
// 一條連線：打開查詢頁 → 依序查 dates 裡的每一週（每次用上一個回應的 token）
async function session(code, dates, out, fetchFn) {
  const r0 = await fetchFn(URL0, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }); if (!r0.ok) throw new Error(`集保查詢頁 HTTP ${r0.status}`);
  let html = await r0.text(), tok = tokenOf(html); const ck = (r0.headers.getSetCookie?.() || [r0.headers.get("set-cookie") || ""]).map(c => String(c).split(";")[0]).filter(Boolean).join("; ");
  for (const d of dates) {
    const body = new URLSearchParams({ SYNCHRONIZER_TOKEN: tok, SYNCHRONIZER_URI: "/portal/zh/smWeb/qryStock", method: "submit", firmNo: "", scaDate: d.replace(/-/g, ""), sqlMethod: "StockNo", stockNo: code, stockName: "" });
    try { const r = await fetchFn(URL0, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: URL0 }, body, signal: AbortSignal.timeout(12000) });
      html = await r.text(); tok = tokenOf(html) || tok; const w = parseWeek(html); if (w) out.set(d, w); } catch {}
  }
}
// 查一檔股票 from～to 之間的每一週；conc 條連線同時查
export async function tdccWeeks(code, { from = "", to = "", conc = 4, fetchFn = fetch } = {}) {
  const r0 = await fetchFn(URL0, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }); if (!r0.ok) throw new Error(`集保查詢頁 HTTP ${r0.status}`);
  const all = datesOf(await r0.text()); if (!all.length) throw new Error("集保查詢頁讀不到週次（網站可能改版）");
  const want = all.filter(d => (!from || d >= from) && (!to || d <= to)), out = new Map(), parts = Array.from({ length: Math.min(conc, want.length) }, (_, k) => want.filter((_, i) => i % conc === k));
  await Promise.all(parts.map(p => session(code, p, out, fetchFn).catch(() => {})));
  const rows = [...out].map(([d, w]) => weekRow(d, w)).sort((a, b) => a[0].localeCompare(b[0])), last = [...out.keys()].sort().pop();
  return { rows, dates: all, dist: last ? { d: last, levels: out.get(last).levels.filter(x => x.lv <= 15) } : null };
}

export default async function handler(req, res) {
  const code = String(req.query?.code || "").trim().toUpperCase(), d = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "");
  if (!/^(\d{4,6}[A-Z]?)$/.test(code)) return res.status(400).json({ ok: false, error: "請給台股代號（4～6 碼）" });
  try {
    const { rows, dates, dist } = await tdccWeeks(code, { from: d(req.query?.from), to: d(req.query?.to) });
    if (!rows.length) return res.status(200).json({ ok: false, error: `集保查不到 ${code} 在這段期間的股權分散（網站只保留最近一年）`, dates });
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, code, source: "集保結算所 集保戶股權分散表查詢", rows, dates, dist });
  } catch (e) { return res.status(200).json({ ok: false, error: `集保網站暫時查不到（${e.message}）` }); }
}
