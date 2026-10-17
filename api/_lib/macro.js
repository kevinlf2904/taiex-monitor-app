// 總經數據：美國聯準會聖路易分行 FRED 的公開 CSV（不需要金鑰），給 learner/watch.html「大盤 → 總經」使用。
// GET /api/macro → { ok, at, series: [{ id, name, group, unit, freq, how, note, last: [日期, 值], prev, chg1y, data: [[日期, 值]...] }], signals: [...] }
// 數值轉換：yoy＝年增率（%）、diff＝和上一期的差（非農新增就業）、lvl＝原始數值。快取 6 小時（資料一個月才更新一次）。
const SERIES = [
  // [FRED 代號, 名稱, 分組, 單位, 轉換, 說明, 上升時對股市, 下降時對股市]
  ["CPIAUCSL", "CPI 年增率", "通膨", "%", "yoy", "消費者物價。通膨越高，聯準會越難降息，對股市（尤其高本益比的科技股）不利。", "通膨升溫 → 降息延後、利率偏高，成長股（科技、AI）評價承壓，台股電子權值跟著波動", "通膨降溫 → 降息空間變大，有利成長股與債券"],
  ["CPILFESL", "核心 CPI 年增率", "通膨", "%", "yoy", "扣掉食物與能源的 CPI，聯準會更看重；目標約 2%。", "核心通膨黏著 → 聯準會偏鷹，股市常在公布當天下跌", "核心通膨回落 → 市場押注降息，股債常同步上漲"],
  ["PCEPILFE", "核心 PCE 年增率", "通膨", "%", "yoy", "聯準會正式的通膨目標指標（2%）。", "離 2% 目標越遠 → 利率維持高檔更久", "接近 2% → 聯準會有降息理由，對股市偏多"],
  ["DFEDTARU", "聯邦基金利率（上限）", "利率", "%", "lvl", "聯準會的政策利率。降息通常有利股市，升息則壓抑評價。", "升息 → 資金成本上升、評價下修，美元走強、新台幣偏弱，外資可能賣台股", "降息 → 資金寬鬆，股市（尤其中小型、成長股）通常受惠；但若是因為衰退而急降，股市反而先跌"],
  ["DGS2", "2 年期公債殖利率", "利率", "%", "lvl", "反映市場對未來一兩年利率的預期。", "市場預期利率更高 → 股市壓力", "市場預期快降息 → 股市偏多（除非是擔心衰退）"],
  ["DGS10", "10 年期公債殖利率", "利率", "%", "lvl", "長期利率，是股票評價的折現率；快速上升時成長股壓力大。", "殖利率急升（尤其超過 4.5%）→ 科技股、高本益比股票下跌，金融股相對受惠", "殖利率下滑 → 成長股、REITs、高股息受惠"],
  ["T10Y2Y", "殖利率曲線（10 年－2 年）", "利率", "百分點", "lvl", "小於 0 叫倒掛，歷史上常在衰退前 6～24 個月出現；倒掛後「轉正」時常是衰退真正開始。", "曲線變陡（由負轉正）→ 若因降息造成，常是衰退前兆，股市波動變大", "曲線變平或倒掛 → 市場預期景氣轉弱，景氣循環股、銀行股承壓"],
  ["UNRATE", "失業率", "就業", "%", "lvl", "失業率快速上升是衰退的訊號（見下方薩姆規則）。", "失業率上升 → 消費轉弱、衰退風險升高，但也讓降息機率變大（股市常先跌後看降息）", "失業率下降 → 景氣穩，但太熱會讓降息延後"],
  ["PAYEMS", "非農新增就業", "就業", "千人", "diff", "每月新增的工作數。太強怕通膨、太弱怕衰退，市場常大幅波動。", "就業太強 → 怕通膨、降息延後，殖利率上升", "就業轉弱 → 降息預期升溫；大幅低於預期時市場擔心衰退"],
  ["ICSA", "初領失業金人數", "就業", "人", "lvl", "每週公布，是最即時的就業指標；連續上升代表裁員增加。", "連續上升 → 裁員增加，景氣轉弱的早期訊號", "維持低檔 → 就業市場穩"],
  ["A191RL1Q225SBEA", "實質 GDP 成長率（季增年率）", "景氣", "%", "lvl", "連續兩季負成長常被視為技術性衰退。", "成長加速 → 企業獲利預期上修，景氣循環股受惠", "成長放緩甚至負成長 → 衰退疑慮，防禦股（公用、必需消費）相對抗跌"],
  ["UMCSENT", "密大消費者信心", "景氣", "點", "lvl", "消費占美國 GDP 約七成，信心下滑會拖累消費。", "信心回升 → 零售、消費類股受惠", "信心下滑 → 消費支出可能減少，消費類股承壓"],
  ["M2SL", "M2 貨幣供給年增率", "資金", "%", "yoy", "市場上的錢多不多；資金寬鬆時股市通常比較好。", "資金變多 → 股市、風險資產（含加密貨幣）偏多", "資金緊縮 → 估值高的股票壓力較大"],
  ["BAMLH0A0HYM2", "高收益債利差", "資金", "百分點", "lvl", "垃圾債比公債多要的利息。利差急升代表市場擔心違約，是風險升溫的警訊。", "利差擴大 → 市場避險，股市常同步下跌", "利差收斂 → 風險偏好回升，股市偏多"],
  ["VIXCLS", "VIX 恐慌指數", "資金", "點", "lvl", "S&P 500 選擇權隱含波動率。20 以下平靜，30 以上恐慌。", "VIX 飆升 → 市場恐慌、賣壓重；極端高點有時反而是中期低點", "VIX 回落 → 市場情緒平穩，股市偏多"],
  // 世界：主要央行、歐日中、匯率與原物料（台股是出口導向，受歐美需求、中國景氣、日圓與油價影響大）
  ["ECBDFR", "歐洲央行存款利率", "世界", "%", "lvl", "歐元區的政策利率。", "歐洲升息 → 歐元走強、全球資金成本上升", "歐洲降息 → 全球資金偏寬鬆，對股市偏多；也代表歐洲景氣偏弱"],
  ["IRSTCB01JPM156N", "日本央行政策利率", "世界", "%", "lvl", "日本長期維持超低利率，是全球「借日圓買資產」套利交易的來源。", "日本升息 → 日圓走強、套利交易平倉，全球股市（含台股）可能急跌，如 2024 年 8 月", "日本維持低利率 → 套利資金持續流向股市"],
  ["IRLTLT01DEM156N", "德國 10 年期公債殖利率", "世界", "%", "lvl", "歐洲的長期利率指標。", "歐洲長天期利率上升 → 全球債券殖利率連動上升，股市評價承壓", "下滑 → 全球利率環境偏寬鬆"],
  ["IRLTLT01JPM156N", "日本 10 年期公債殖利率", "世界", "%", "lvl", "日本央行放寬殖利率控制後，波動變大。", "日債殖利率上升 → 日本資金可能回流日本，美債與全球股市承壓", "下滑 → 日本資金續留海外"],
  ["CP0000EZ19M086NEST", "歐元區通膨（HICP 年增率）", "世界", "%", "yoy", "歐洲央行的通膨目標是 2%。", "歐洲通膨升溫 → 歐洲央行不降息，歐洲需求受壓抑", "回落 → 歐洲央行有降息空間"],
  ["LRHUTTTTEZM156S", "歐元區失業率", "世界", "%", "lvl", "歐洲景氣的溫度計。", "失業率上升 → 歐洲需求轉弱，台灣出口到歐洲的產業受影響", "下降 → 歐洲需求穩"],
  ["CLVMNACSCAB1GQEA19", "歐元區實質 GDP 年增率", "世界", "%", "yoy", "季資料。", "成長加速 → 全球需求改善，有利出口股", "成長放緩 → 全球需求疑慮"],
  ["CPALTT01CNM659N", "中國 CPI 年增率", "世界", "%", "lvl", "中國物價；長期低於 1% 代表內需疲弱、通縮壓力。", "物價回升 → 中國內需轉強，原物料、傳產股（塑化、鋼鐵）受惠", "物價下滑或負成長 → 通縮壓力，中國削價出口，壓縮台灣傳產利潤"],
  ["XTEXVA01CNM664S", "中國出口年增率", "世界", "%", "yoy", "中國是世界工廠，出口反映全球需求。", "出口成長 → 全球需求好，航運、原物料受惠", "出口衰退 → 全球需求轉弱，供應鏈股承壓"],
  ["BSCICP03CNM665S", "中國企業信心指數", "世界", "點", "lvl", "100 以上偏樂觀，以下偏悲觀。", "信心回升 → 中國景氣回溫，對台灣傳產、原物料股偏多", "信心下滑 → 中國景氣轉弱"],
  ["DEXJPUS", "美元兌日圓", "世界", "日圓", "lvl", "數字越大代表日圓越弱。", "日圓貶值 → 日本出口商受惠，與台灣在部分產業（機械、面板）競爭", "日圓急升 → 套利交易平倉風險，全球股市波動放大"],
  ["DEXCHUS", "美元兌人民幣", "世界", "人民幣", "lvl", "數字越大代表人民幣越弱。", "人民幣貶值 → 中國出口更便宜，資金流出中國，亞洲貨幣（含新台幣）常跟著走弱", "人民幣升值 → 亞洲貨幣偏強，外資較願意流入亞股"],
  ["DCOILBRENTEU", "布蘭特原油", "世界", "美元／桶", "lvl", "國際油價；影響通膨與運輸、塑化成本。", "油價上漲 → 通膨壓力、降息延後；航空、運輸成本上升，塑化、油服類股受惠", "油價下跌 → 通膨降溫、有利降息；航空股受惠，能源股承壓"],
  ["PCOPPUSDM", "銅價", "世界", "美元／噸", "lvl", "「銅博士」：銅用在電線、建築、電動車，被視為全球景氣指標。", "銅價上漲 → 全球景氣與 AI 電力建設需求強，電線電纜、景氣循環股受惠", "銅價下跌 → 全球景氣轉弱的訊號"],
  ["GEPUCURRENT", "全球經濟政策不確定性", "世界", "點", "lvl", "根據新聞報導算出的政策不確定程度（關稅、選舉、戰爭）。", "不確定性升高 → 資金避險，股市波動變大、黃金與美元受惠", "不確定性下降 → 風險偏好回升"],
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

// 最近的方向（和約 3 期前比；日資料用約 3 個月前），配上「上升／下降時對股市的影響」
export function impactOf(rows, up, down) {
  if (!up || rows.length < 4) return {}; const last = rows[rows.length - 1][1], back = rows[Math.max(0, rows.length - 4)][1], d = last - back, tol = Math.max(Math.abs(back) * 0.01, 0.02);
  const dir = d > tol ? 1 : d < -tol ? -1 : 0; return { dir, impact: dir > 0 ? up : dir < 0 ? down : `變化不大。上升時：${up}；下降時：${down}`, up, down };
}
// 整理全部數列與重點訊號；排程（scripts/macro.mjs，GitHub Actions）和 /api/macro 共用。FRED 會擋掉部分雲端主機（Vercel 上常逾時），所以網頁優先讀排程存好的 learner/data/macro.json
export async function buildMacro(timeout = 15000) {
  const since = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  const got = await Promise.allSettled(SERIES.map(async ([id]) => { const r = await fetch(`${FRED}?id=${id}&cosd=${since}`, { headers: UA, signal: AbortSignal.timeout(timeout) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return parseCsv(await r.text()); }));
  const series = [], notes = []; let unRaw = null;
  SERIES.forEach(([id, name, group, unit, how, note, up, down], k) => {
    const g = got[k]; if (g.status !== "fulfilled" || !g.value.length) { notes.push(`${name}：${g.reason?.message || "沒有資料"}`); return; }
    if (id === "UNRATE") unRaw = g.value;
    let rows = transform(g.value, how); if (!rows.length) return; const daily = rows.length > 400; if (daily) rows = thin(rows);
    const last = rows[rows.length - 1], prev = rows[rows.length - 2] || null, y1 = rows.filter(r => Date.parse(r[0]) <= Date.parse(last[0]) - 360 * 864e5).pop() || null;
    const gap = rows.length > 2 ? (Date.parse(last[0]) - Date.parse(rows[Math.max(0, rows.length - 6)][0])) / Math.min(5, rows.length - 1) / 864e5 : 30;
    series.push({ id, name, group, unit, how, note, freq: daily ? "日" : gap > 70 ? "季" : gap > 20 ? "月" : gap > 4 ? "週" : "日", last, prev, y1, data: rows.slice(daily ? -260 : -72), ...impactOf(rows, up, down) });
  });
  if (!series.length) return { ok: false, error: `拿不到總經數據（${notes.join("；")}）` };
  // 重點訊號：殖利率曲線、薩姆規則、通膨方向、VIX、信用利差
  const S = id => series.find(s => s.id === id), signals = [], sm = unRaw ? sahm(unRaw) : null;
  const curve = S("T10Y2Y"); if (curve) signals.push({ k: "殖利率曲線", v: `${curve.last[1].toFixed(2)}`, lv: curve.last[1] < 0 ? 2 : curve.last[1] < 0.3 ? 1 : 0, t: curve.last[1] < 0 ? "倒掛中（衰退前常見）" : curve.data.slice(-130).some(r => r[1] < 0) ? "剛由倒掛轉正，歷史上衰退常在這之後開始" : "正常（長天期高於短天期）" });
  if (sm) signals.push({ k: "薩姆規則", v: sm.v.toFixed(2), lv: sm.v >= 0.5 ? 2 : sm.v >= 0.3 ? 1 : 0, t: sm.v >= 0.5 ? "已觸發衰退訊號（≥ 0.5）" : sm.v >= 0.3 ? "接近門檻，失業率在上升" : "沒有衰退訊號" });
  const cpi = S("CPILFESL"); if (cpi) { const a = cpi.last[1], b = cpi.data[cpi.data.length - 4]?.[1]; signals.push({ k: "核心通膨", v: a.toFixed(1) + "%", lv: a > 3 ? 2 : a > 2.5 ? 1 : 0, t: `${b != null ? (a < b ? "比 3 個月前降溫" : a > b ? "比 3 個月前升溫" : "和 3 個月前持平") : ""}，聯準會目標 2%` }); }
  const vix = S("VIXCLS"); if (vix) signals.push({ k: "VIX", v: vix.last[1].toFixed(1), lv: vix.last[1] >= 30 ? 2 : vix.last[1] >= 20 ? 1 : 0, t: vix.last[1] >= 30 ? "恐慌" : vix.last[1] >= 20 ? "偏緊張" : "平靜" });
  const hy = S("BAMLH0A0HYM2"); if (hy) signals.push({ k: "信用利差", v: hy.last[1].toFixed(2), lv: hy.last[1] >= 5 ? 2 : hy.last[1] >= 4 ? 1 : 0, t: hy.last[1] >= 5 ? "風險升溫" : hy.last[1] >= 4 ? "略偏高" : "正常" });
  return { ok: true, at: new Date().toISOString(), source: "FRED（美國聯準會聖路易分行）", series, signals, notes };
}

let memo = null;
export default async function handler(req, res) {
  if (memo && Date.now() - memo.at < 3 * 3600e3) { res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400"); return res.status(200).json(memo.v); }
  const v = await buildMacro(8000); if (!v.ok) return res.status(200).json(v);
  memo = { at: Date.now(), v };
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(v);
}
