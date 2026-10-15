// 總經數據：美國聯準會聖路易分行 FRED 的公開 CSV（不需要金鑰），給 learner/watch.html「大盤 → 總經」使用。
// GET /api/macro → { ok, at, series: [{ id, name, group, unit, freq, how, note, last: [日期, 值], prev, chg1y, data: [[日期, 值]...] }], signals: [...] }
// 數值轉換：yoy＝年增率（%）、diff＝和上一期的差（非農新增就業）、lvl＝原始數值。快取 6 小時（資料一個月才更新一次）。
const SERIES = [
  // [FRED 代號, 名稱, 分組, 單位, 轉換, 說明（對股市的意義）]
  ["CPIAUCSL", "CPI 年增率", "通膨", "%", "yoy", "消費者物價。通膨越高，聯準會越難降息，對股市（尤其高本益比的科技股）不利。"],
  ["CPILFESL", "核心 CPI 年增率", "通膨", "%", "yoy", "扣掉食物與能源的 CPI，聯準會更看重；目標約 2%。"],
  ["PCEPILFE", "核心 PCE 年增率", "通膨", "%", "yoy", "聯準會正式的通膨目標指標（2%）。"],
  ["DFEDTARU", "聯邦基金利率（上限）", "利率", "%", "lvl", "聯準會的政策利率。降息通常有利股市，升息則壓抑評價。"],
  ["DGS2", "2 年期公債殖利率", "利率", "%", "lvl", "反映市場對未來一兩年利率的預期。"],
  ["DGS10", "10 年期公債殖利率", "利率", "%", "lvl", "長期利率，是股票評價的折現率；快速上升時成長股壓力大。"],
  ["T10Y2Y", "殖利率曲線（10 年－2 年）", "利率", "百分點", "lvl", "小於 0 叫倒掛，歷史上常在衰退前 6～24 個月出現；倒掛後「轉正」時常是衰退真正開始。"],
  ["UNRATE", "失業率", "就業", "%", "lvl", "失業率快速上升是衰退的訊號（見下方薩姆規則）。"],
  ["PAYEMS", "非農新增就業", "就業", "千人", "diff", "每月新增的工作數。太強怕通膨、太弱怕衰退，市場常大幅波動。"],
  ["ICSA", "初領失業金人數", "就業", "人", "lvl", "每週公布，是最即時的就業指標；連續上升代表裁員增加。"],
  ["A191RL1Q225SBEA", "實質 GDP 成長率（季增年率）", "景氣", "%", "lvl", "連續兩季負成長常被視為技術性衰退。"],
  ["UMCSENT", "密大消費者信心", "景氣", "點", "lvl", "消費占美國 GDP 約七成，信心下滑會拖累消費。"],
  ["M2SL", "M2 貨幣供給年增率", "資金", "%", "yoy", "市場上的錢多不多；資金寬鬆時股市通常比較好。"],
  ["BAMLH0A0HYM2", "高收益債利差", "資金", "百分點", "lvl", "垃圾債比公債多要的利息。利差急升代表市場擔心違約，是風險升溫的警訊。"],
  ["VIXCLS", "VIX 恐慌指數", "資金", "點", "lvl", "S&P 500 選擇權隱含波動率。20 以下平靜，30 以上恐慌。"],
];
const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; kline-school-learner)", Accept: "text/csv,*/*" };

export function parseCsv(t) {
  return String(t || "").trim().split(/\r?\n/).slice(1).map(l => l.split(",")).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] !== "" && r[1] !== "." && Number.isFinite(+r[1])).map(r => [r[0], +r[1]]);
}
// 年增率：找 12 個月前（±20 天）同一期的值
export function transform(rows, how) {
  if (how === "lvl") return rows;
  if (how === "diff") return rows.slice(1).map((r, i) => [r[0], +(r[1] - rows[i][1]).toFixed(1)]);
  const t = rows.map(r => Date.parse(r[0])), out = [];
  for (let i = 0; i < rows.length; i++) { const want = t[i] - 365 * 864e5; let j = -1; for (let k = i - 1; k >= 0; k--) if (Math.abs(t[k] - want) <= 20 * 864e5) { j = k; break; } else if (t[k] < want - 20 * 864e5) break; if (j >= 0 && rows[j][1]) out.push([rows[i][0], +((rows[i][1] / rows[j][1] - 1) * 100).toFixed(2)]); }
  return out;
}
// 日資料太多：只留每週最後一筆（畫圖用），最新一筆一定保留
export const thin = rows => rows.filter((r, i) => i === rows.length - 1 || new Date(r[0]).getUTCDay() === 5 || (rows[i + 1] && Date.parse(rows[i + 1][0]) - Date.parse(r[0]) > 3 * 864e5));
// 薩姆規則：失業率 3 個月平均，比過去 12 個月內的最低 3 個月平均高 0.5 個百分點以上 → 衰退訊號
export function sahm(un) {
  if (un.length < 15) return null; const m3 = un.map((_, i) => (i < 2 ? null : (un[i][1] + un[i - 1][1] + un[i - 2][1]) / 3)), i = un.length - 1;
  const low = Math.min(...m3.slice(Math.max(2, i - 12), i).filter(v => v != null)); return { v: +(m3[i] - low).toFixed(2), d: un[i][0] };
}

let memo = null;
export default async function handler(req, res) {
  if (memo && Date.now() - memo.at < 3 * 3600e3) { res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400"); return res.status(200).json(memo.v); }
  const since = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  const got = await Promise.allSettled(SERIES.map(async ([id]) => { const r = await fetch(`${FRED}?id=${id}&cosd=${since}`, { headers: UA, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return parseCsv(await r.text()); }));
  const series = [], notes = []; let unRaw = null;
  SERIES.forEach(([id, name, group, unit, how, note], k) => {
    const g = got[k]; if (g.status !== "fulfilled" || !g.value.length) { notes.push(`${name}：${g.reason?.message || "沒有資料"}`); return; }
    if (id === "UNRATE") unRaw = g.value;
    let rows = transform(g.value, how); if (!rows.length) return; const daily = rows.length > 400; if (daily) rows = thin(rows);
    const last = rows[rows.length - 1], prev = rows[rows.length - 2] || null, y1 = rows.filter(r => Date.parse(r[0]) <= Date.parse(last[0]) - 360 * 864e5).pop() || null;
    series.push({ id, name, group, unit, how, note, freq: daily ? "日" : id === "ICSA" ? "週" : id === "A191RL1Q225SBEA" ? "季" : "月", last, prev, y1, data: rows.slice(daily ? -260 : -72) });
  });
  if (!series.length) return res.status(200).json({ ok: false, error: `拿不到總經數據（${notes.join("；")}）` });
  // 重點訊號：殖利率曲線、薩姆規則、通膨方向、VIX、信用利差
  const S = id => series.find(s => s.id === id), signals = [], sm = unRaw ? sahm(unRaw) : null;
  const curve = S("T10Y2Y"); if (curve) signals.push({ k: "殖利率曲線", v: `${curve.last[1].toFixed(2)}`, lv: curve.last[1] < 0 ? 2 : curve.last[1] < 0.3 ? 1 : 0, t: curve.last[1] < 0 ? "倒掛中（衰退前常見）" : curve.data.slice(-130).some(r => r[1] < 0) ? "剛由倒掛轉正，歷史上衰退常在這之後開始" : "正常（長天期高於短天期）" });
  if (sm) signals.push({ k: "薩姆規則", v: sm.v.toFixed(2), lv: sm.v >= 0.5 ? 2 : sm.v >= 0.3 ? 1 : 0, t: sm.v >= 0.5 ? "已觸發衰退訊號（≥ 0.5）" : sm.v >= 0.3 ? "接近門檻，失業率在上升" : "沒有衰退訊號" });
  const cpi = S("CPILFESL"); if (cpi) { const a = cpi.last[1], b = cpi.data[cpi.data.length - 4]?.[1]; signals.push({ k: "核心通膨", v: a.toFixed(1) + "%", lv: a > 3 ? 2 : a > 2.5 ? 1 : 0, t: `${b != null ? (a < b ? "比 3 個月前降溫" : a > b ? "比 3 個月前升溫" : "和 3 個月前持平") : ""}，聯準會目標 2%` }); }
  const vix = S("VIXCLS"); if (vix) signals.push({ k: "VIX", v: vix.last[1].toFixed(1), lv: vix.last[1] >= 30 ? 2 : vix.last[1] >= 20 ? 1 : 0, t: vix.last[1] >= 30 ? "恐慌" : vix.last[1] >= 20 ? "偏緊張" : "平靜" });
  const hy = S("BAMLH0A0HYM2"); if (hy) signals.push({ k: "信用利差", v: hy.last[1].toFixed(2), lv: hy.last[1] >= 5 ? 2 : hy.last[1] >= 4 ? 1 : 0, t: hy.last[1] >= 5 ? "風險升溫" : hy.last[1] >= 4 ? "略偏高" : "正常" });
  const v = { ok: true, at: new Date().toISOString(), source: "FRED（美國聯準會聖路易分行）", series, signals, notes };
  memo = { at: Date.now(), v };
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(v);
}
