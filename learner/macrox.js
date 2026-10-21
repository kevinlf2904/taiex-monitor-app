/* ================= 大盤「總經數據、總經消息、預測市場」的延伸分析 =================
   都是用已經載入的資料在瀏覽器裡算，不另外抓資料：
   - 總經數據（data/macro.json 的 FRED 數列）：景氣循環位置、衰退警訊清單、利率與政策立場、金融壓力、全部指標的歷史位置與方向
   - 總經消息（data/macro-news.json）：主題熱度、新聞語氣、升溫的關鍵字、可能牽動的台股族群
   - 預測市場（/api/poly）：聯準會利率路徑、市場最分歧與幾乎確定的事件、資金注意力分布、重大風險機率
   watch.html 的 renderMacro、renderMnews、renderPoly 把 mxMacroHtml、mxNewsHtml、mxPolyHtml 放在內容最上面（可收合，記住開合）。用到 watch.html 的 esc、cls、store。 */
const mxSec = (key, title, sub, body) => `<details class="mk mkfold mx" data-fold="mx-${key}" ${store.get("watch:fold:mx-" + key, true) ? "open" : ""}><summary><h3>${title}${sub ? `<span class="note">${sub}</span>` : ""}</h3></summary>${body}</details>`;
const mxF = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : (+v.toFixed(d)).toLocaleString());
const mxSign = (v, eps = 0) => (v == null ? 0 : v > eps ? 1 : v < -eps ? -1 : 0);
const mxAvg = L => (L.length ? L.reduce((a, b) => a + b, 0) / L.length : null);

/* ---------- 總經數據 ---------- */
const mxSer = (J, id) => J.series?.find(s => s.id === id);
const mxVals = s => (s?.data || []).map(x => x[1]).filter(v => v != null && Number.isFinite(v));
// 「3 個月前」大約幾筆：月資料 3、週資料 13、日資料 63、季資料 1
const mxLag = s => ({ 月: 3, 週: 13, 日: 63, 季: 1 }[s?.freq] || 3);
const mxChg = s => { const v = mxVals(s), n = mxLag(s); return v.length > n ? v[v.length - 1] - v[v.length - 1 - n] : null; };
// 最新值在資料期間（約 5 年）裡的百分位
const mxPct = s => { const v = mxVals(s); if (v.length < 6) return null; const x = v[v.length - 1]; return Math.round(v.filter(y => y <= x).length / v.length * 100); };
// 景氣循環位置：成長動能 × 通膨動能（各項只看方向，平均成 -1～1）
function mxCycle(J) {
  const S = id => mxSer(J, id), v = id => mxVals(S(id));
  const pay = v("PAYEMS"), icsa = v("ICSA"), avg = (L, a, b) => mxAvg(L.slice(a, b));
  const G = [
    ["非農就業（近 3 月平均 vs 前 3 月）", pay.length >= 6 ? mxSign(avg(pay, -3) - avg(pay, -6, -3), 5) : null],
    ["失業率（3 個月變化，下降＝好）", S("UNRATE") ? -mxSign(mxChg(S("UNRATE")), 0.05) : null],
    ["消費者信心（3 個月變化）", S("UMCSENT") ? mxSign(mxChg(S("UMCSENT")), 1) : null],
    ["GDP 成長率（和上一季比）", v("A191RL1Q225SBEA").length >= 2 ? mxSign(v("A191RL1Q225SBEA").at(-1) - v("A191RL1Q225SBEA").at(-2), 0.1) : null],
    ["初領失業金（4 週平均 vs 3 個月前，下降＝好）", icsa.length >= 17 ? -mxSign(avg(icsa, -4) / avg(icsa, -17, -13) - 1, 0.03) : null],
  ].filter(x => x[1] != null);
  const I = [["核心 CPI（3 個月變化）", "CPILFESL"], ["核心 PCE（3 個月變化）", "PCEPILFE"], ["CPI（3 個月變化）", "CPIAUCSL"]].map(([t, id]) => [t, S(id) ? mxSign(mxChg(S(id)), 0.05) : null]).filter(x => x[1] != null);
  if (!G.length || !I.length) return null;
  const g = mxAvg(G.map(x => x[1])), i = mxAvg(I.map(x => x[1]));
  const Q = g > 0 ? (i > 0 ? ["擴張過熱", "原物料、航運、金融、景氣循環股", "景氣好、物價也在漲，央行可能維持高利率；景氣循環股、金融股通常表現較好。"] : ["復甦", "電子、半導體、成長股", "景氣轉好、通膨降溫，是股市最舒服的階段；成長股、科技股通常領漲。"])
    : (i > 0 ? ["滯脹", "防禦股（電信、民生必需）、黃金、現金", "景氣轉弱但物價還在漲，央行難以降息；股市壓力最大，防禦型資產相對抗跌。"] : ["放緩", "公債、高股息、防禦股", "景氣和通膨都在降溫，市場等待降息；債券和高股息、防禦股通常較穩。"]);
  return { g, i, G, I, Q };
}
// 衰退警訊清單：每項 [名稱, 亮燈 0 正常／1 留意／2 警訊, 現況說明]
function mxRecession(J) {
  const S = id => mxSer(J, id), v = id => mxVals(S(id)), out = [];
  const cv = v("T10Y2Y"); if (cv.length) { const now = cv.at(-1), minPast = Math.min(...cv.slice(-500)); out.push(["殖利率曲線", now < 0 ? 2 : minPast < 0 ? 1 : 0, now < 0 ? `倒掛中（${mxF(now)}）` : minPast < 0 ? `近兩年倒掛過、現在轉正（${mxF(now)}），歷史上衰退常在轉正後出現` : `正常（${mxF(now)}）`]); }
  const ur = v("UNRATE"); if (ur.length >= 15) { const m3 = k => mxAvg(ur.slice(ur.length - 3 - k, ur.length - k)), cur = m3(0), lo = Math.min(...Array.from({ length: 12 }, (_, k) => m3(k + 1))), d = cur - lo;
    out.push(["薩姆規則", d >= 0.5 ? 2 : d >= 0.3 ? 1 : 0, `失業率 3 個月平均比過去一年低點高 ${mxF(d)} 個百分點（≥ 0.5 觸發）`]); }
  const ic = v("ICSA"); if (ic.length >= 30) { const a4 = k => mxAvg(ic.slice(ic.length - 4 - k, ic.length - k)), cur = a4(0), lo = Math.min(...Array.from({ length: Math.min(48, ic.length - 4) }, (_, k) => a4(k + 1))), r = cur / lo - 1;
    out.push(["初領失業金", r >= 0.2 ? 2 : r >= 0.1 ? 1 : 0, `4 週平均比一年內低點高 ${Math.round(r * 100)}%（≥ 20% 警訊）`]); }
  const pay = v("PAYEMS"); if (pay.length >= 3) { const a = mxAvg(pay.slice(-3)); out.push(["非農就業", a < 50 ? 2 : a < 100 ? 1 : 0, `近 3 個月平均每月新增 ${Math.round(a)} 千人`]); }
  const hy = v("BAMLH0A0HYM2"); if (hy.length) { const x = hy.at(-1); out.push(["高收益債利差", x > 5 ? 2 : x > 4 ? 1 : 0, `${mxF(x)} 個百分點（> 5 代表信用緊縮）`]); }
  const cs = v("UMCSENT"); if (cs.length) { const x = cs.at(-1); out.push(["消費者信心", x < 55 ? 2 : x < 65 ? 1 : 0, `${mxF(x, 1)} 點（長期平均約 85）`]); }
  const vx = v("VIXCLS"); if (vx.length) { const x = vx.at(-1); out.push(["VIX 恐慌指數", x > 30 ? 2 : x > 20 ? 1 : 0, `${mxF(x, 1)}（> 30 恐慌）`]); }
  return out;
}
function mxMacroHtml(J) {
  if (!J?.series?.length) return "";
  const S = id => mxSer(J, id), last = id => mxVals(S(id)).at(-1), lv = ["up", "warn", "down"];
  let h = "";
  // 1. 景氣循環位置
  const C = mxCycle(J);
  if (C) { const X = 50 + C.g * 42, Y = 50 - C.i * 42;
    h += mxSec("cycle", "景氣循環位置", "成長動能 × 通膨動能", `<div class="mx-cyc"><div class="mx-q" role="img" aria-label="景氣循環象限：${C.Q[0]}"><span class="q1">擴張過熱</span><span class="q2">滯脹</span><span class="q3">放緩</span><span class="q4">復甦</span><i style="left:${X}%;top:${Y}%"></i><em class="ax-x">成長 →</em><em class="ax-y">通膨 ↑</em></div>
      <div><p class="mx-big">目前偏向「<b>${C.Q[0]}</b>」</p><p>${C.Q[2]}</p><p class="note">歷史上這個階段相對強勢：${C.Q[1]}。</p>
      <ul class="mx-chk">${[...C.G.map(x => ["成長", ...x]), ...C.I.map(x => ["通膨", ...x])].map(([k, t, s]) => `<li><span class="note">${k}</span>${esc(t)}<b class="${k === "通膨" ? (s > 0 ? "down" : s < 0 ? "up" : "") : cls(s)}">${s > 0 ? "↑" : s < 0 ? "↓" : "→"}</b></li>`).join("")}</ul></div></div>
      <p class="note">每一項只看方向（上升、下降、持平）再平均，避免單一數字左右；循環階段是經驗法則，不同週期的領漲族群不一定一樣。</p>`); }
  // 2. 衰退警訊
  const R = mxRecession(J), lit = R.filter(x => x[1] === 2).length, watch = R.filter(x => x[1] === 1).length;
  if (R.length) h += mxSec("rec", "衰退警訊清單", `${lit} 項警訊・${watch} 項留意`, `<p class="mx-big">衰退風險：<b class="${lit >= 3 ? "down" : lit + watch >= 3 ? "warn" : "up"}">${lit >= 3 ? "偏高" : lit + watch >= 3 ? "中等" : "偏低"}</b></p>
    <ul class="mx-chk">${R.map(([t, l, d]) => `<li><i class="mx-dot ${lv[l]}"></i><b>${t}</b><span class="note">${esc(d)}</span></li>`).join("")}</ul>
    <p class="note">這些是歷史上衰退前常出現的訊號，同時亮好幾項時才比較有參考價值；單一指標常有假警報。</p>`);
  // 3. 利率與政策立場
  const ff = last("DFEDTARU"), y2 = last("DGS2"), y10 = last("DGS10"), core = last("PCEPILFE") ?? last("CPILFESL"), rows = [];
  if (ff != null && y2 != null) { const d = y2 - ff, n = Math.round(Math.abs(d) / 0.25); rows.push(["市場預期的利率方向", d < -0.15 ? `2 年期公債比聯邦基金利率低 ${mxF(-d)} 個百分點，市場預期未來兩年<b class="up">降息</b>約 ${n} 碼` : d > 0.15 ? `2 年期公債比聯邦基金利率高 ${mxF(d)}，市場預期還會<b class="down">升息</b>約 ${n} 碼` : "2 年期公債和聯邦基金利率接近，市場預期利率大致持平"]); }
  if (ff != null && core != null) { const r = ff - core; rows.push(["實質政策利率", `聯邦基金利率 − 核心通膨 ＝ <b>${mxF(r)}%</b>，${r > 1.5 ? "明顯緊縮（壓抑景氣，降息空間大）" : r > 0.5 ? "偏緊縮" : r > -0.5 ? "大致中性" : "寬鬆（資金環境有利股市）"}`]); }
  if (y10 != null && core != null) rows.push(["實質 10 年期殖利率（估）", `10 年期 ${mxF(y10)}% − 核心通膨 ${mxF(core)}% ≈ <b>${mxF(y10 - core)}%</b>；越高對高本益比的成長股壓力越大`]);
  const cv = last("T10Y2Y"); if (cv != null) rows.push(["殖利率曲線", `10 年 − 2 年 ＝ <b class="${cls(cv)}">${mxF(cv)}</b>，${cv < 0 ? "倒掛：市場認為未來利率會降、景氣轉弱" : cv < 0.5 ? "偏平：景氣擴張後段常見" : "正常：長天期利率較高"}`]);
  if (rows.length) h += mxSec("rate", "利率與政策立場", "", `<ul class="mx-kv">${rows.map(([k, v]) => `<li><span>${k}</span><p>${v}</p></li>`).join("")}</ul>`);
  // 4. 金融壓力（相對過去 5 年的 z 分數平均）
  const z = id => { const v = mxVals(S(id)); if (v.length < 20) return null; const m = mxAvg(v), sd = Math.sqrt(mxAvg(v.map(x => (x - m) ** 2))) || 1; return (v.at(-1) - m) / sd; };
  const Z = [["VIX 恐慌指數", z("VIXCLS")], ["高收益債利差", z("BAMLH0A0HYM2")], ["經濟政策不確定性", z("GEPUCURRENT")]].filter(x => x[1] != null);
  if (Z.length) { const m = mxAvg(Z.map(x => x[1])), pos = Math.max(0, Math.min(100, 50 + m * 20));
    h += mxSec("stress", "金融壓力", `${m > 0.75 ? "緊張" : m < -0.5 ? "寬鬆" : "中性"}`, `<div class="mx-gauge"><i style="left:${pos}%"></i><span>寬鬆</span><span>中性</span><span>緊張</span></div>
      <ul class="mx-chk">${Z.map(([t, v]) => `<li><b>${t}</b><span class="note">比 5 年平均 ${v >= 0 ? "高" : "低"} ${mxF(Math.abs(v), 1)} 個標準差</span></li>`).join("")}</ul>
      <p class="note">壓力越高，市場越容易出現急跌；壓力低不代表不會跌，只是資金環境比較平靜。</p>`); }
  // 5. 全部指標：5 年百分位、3 個月方向、這個方向的意思
  const T = J.series.filter(s => mxVals(s).length >= 6);
  if (T.length) h += mxSec("all", "全部指標的歷史位置與方向", `${T.length} 項`, `<div class="cotbl-wrap"><table class="tbl mx-tbl"><thead><tr><th>指標</th><th>最新</th><th>5 年位置</th><th>3 個月</th><th>這個方向通常代表</th></tr></thead><tbody>
    ${T.map(s => { const p = mxPct(s), c = mxChg(s), t = c == null || Math.abs(c) < 1e-9 ? "" : c > 0 ? s.up : s.down; return `<tr><td>${esc(s.name)}</td><td>${mxF(mxVals(s).at(-1))}</td><td>${p == null ? "—" : `<span class="mx-pbar"><i style="width:${p}%"></i></span>${p}%`}</td><td class="${c == null ? "" : (s.dir || 1) * c > 0 ? "up" : (s.dir || 1) * c < 0 ? "down" : ""}">${c == null ? "—" : `${c > 0 ? "↑" : c < 0 ? "↓" : "→"} ${mxF(Math.abs(c))}`}</td><td class="note">${esc(t || "")}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="note">5 年位置＝最新值在資料期間裡的百分位（100% 是 5 年最高）；3 個月的紅綠是對股市偏好或偏壞，不是數字本身漲跌。</p>`);
  return h ? `<div class="mxbox">${h}</div>` : "";
}

/* ---------- 總經消息 ---------- */
// 新聞語氣：先把方向相反的詞（降息偏多、升息偏空）換掉，再數正負面字詞
const MX_POS = /上漲|大漲|走揚|反彈|回升|增加|成長|擴張|回溫|暢旺|強勁|創高|新高|優於|上修|樂觀|利多|復甦|升溫|紅燈|超預期|穩健|改善/g;
const MX_NEG = /下跌|大跌|重挫|暴跌|下滑|減少|衰退|萎縮|放緩|疲軟|走弱|創低|新低|低於|下修|悲觀|利空|危機|違約|警訊|藍燈|裁員|失業|通膨升溫|貶值|崩/g;
function mxTone(title) {
  let t = String(title || ""), p = 0, n = 0;
  t = t.replace(/降息|寬鬆/g, () => { p++; return "　"; }).replace(/升息|緊縮|關稅/g, () => { n++; return "　"; });
  p += (t.match(MX_POS) || []).length; n += (t.match(MX_NEG) || []).length;
  return p > n ? 1 : n > p ? -1 : 0;
}
const MX_WORDS = ["降息", "升息", "聯準會", "央行", "通膨", "CPI", "非農", "失業", "關稅", "出口", "外銷訂單", "AI", "半導體", "台積電", "輝達", "台幣", "美元", "日圓", "人民幣", "殖利率", "美債", "油價", "黃金", "銅", "GDP", "PMI", "景氣", "衰退", "財政", "預算", "選舉", "川普", "中國", "日本", "歐洲", "地緣", "戰爭", "停火", "外資", "房市"];
// 主題 → 最可能牽動的台股族群
const MX_SECT = { 利率: "金融股（利差）、高本益比成長股", 通膨: "原物料、民生消費、高股息", 就業: "消費、零售、整體大盤情緒", 景氣: "景氣循環股（塑化、鋼鐵、航運）", 貿易: "出口電子、半導體、傳產外銷", 匯率: "出口電子（匯損益）、外資買賣", 債市: "金融壽險、成長股評價", 原物料: "塑化、航空、油電、黃金相關", 市場: "大盤整體情緒" };
function mxNewsHtml(J) {
  const D = (J?.days || []).slice(0, 7).reverse(); if (!D.length) return "";
  const items = d => ["tw", "us", "world"].flatMap(r => (d[r]?.items || []).map(x => ({ ...x, r })));
  const topics = [...new Set(D.flatMap(d => items(d).map(x => x.topic || "市場")))];
  const cnt = (d, t) => items(d).filter(x => (x.topic || "市場") === t).length, mx = Math.max(1, ...D.flatMap(d => topics.map(t => cnt(d, t))));
  const today = D[D.length - 1], prev = D.slice(0, -1);
  // 1. 主題熱度
  let h = mxSec("heat", "主題熱度", `近 ${D.length} 天・則數`, `<div class="cotbl-wrap"><table class="tbl cxheat mx-heat"><thead><tr><th>主題</th>${D.map(d => `<th>${d.date.slice(5).replace("-", "/")}</th>`).join("")}</tr></thead><tbody>
    ${topics.sort((a, b) => cnt(today, b) - cnt(today, a)).map(t => `<tr><td>${esc(t)}</td>${D.map(d => { const n = cnt(d, t); return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(n / mx * 55)}%, transparent)">${n || ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">顏色越深代表那天這個主題的新聞越多；連續好幾天變深，代表市場正在關注。</p>`);
  // 2. 新聞語氣
  const tone = (d, r) => { const L = (d[r]?.items || []).map(x => mxTone(x.title)), p = L.filter(x => x > 0).length, n = L.filter(x => x < 0).length; return { p, n, s: p + n ? (p - n) / (p + n) : 0, all: L.length }; };
  const R = [["tw", "台灣"], ["us", "美國"], ["world", "世界"]].filter(([r]) => D.some(d => d[r]?.items?.length));
  const lab = s => (s > 0.2 ? ["偏多", "up"] : s < -0.2 ? ["偏空", "down"] : ["中性", ""]);
  h += mxSec("tone", "新聞語氣", "用標題字詞估算", `<div class="mx-tone">${R.map(([r, n]) => { const t = tone(today, r), [l, c] = lab(t.s);
    return `<div><b>${n}</b><span class="mx-big ${c}">${l}</span><small class="note">正面 ${t.p}・負面 ${t.n}・共 ${t.all} 則</small><div class="mx-spark">${D.map(d => { const s = tone(d, r).s; return `<i class="${s > 0 ? "up" : s < 0 ? "down" : ""}" style="height:${Math.round(Math.abs(s) * 100) || 4}%" title="${d.date} ${lab(s)[0]}"></i>`; }).join("")}</div></div>`; }).join("")}</div>
    <p class="note">依標題裡的正、負面字詞計算（例如「成長、暢旺、降息」算正面，「衰退、下修、升息」算負面），長條是近 ${D.length} 天的變化；只是粗略的語氣，不是 AI 判斷。</p>`);
  // 3. 升溫的關鍵字
  const wc = (d, w) => items(d).filter(x => String(x.title).includes(w)).length;
  const W2 = MX_WORDS.map(w => ({ w, n: wc(today, w), p: prev.length ? mxAvg(prev.map(d => wc(d, w))) : 0 })).filter(x => x.n).sort((a, b) => b.n - b.p - (a.n - a.p) || b.n - a.n).slice(0, 14);
  if (W2.length) h += mxSec("words", "今天的熱門關鍵字", "和前幾天平均比", `<div class="mx-words">${W2.map(x => `<span class="${x.n > x.p * 1.5 + 0.5 ? "hot" : ""}">${esc(x.w)}<b>${x.n}</b>${x.n > x.p + 0.5 ? `<small class="up">↑</small>` : ""}</span>`).join("")}</div><p class="note">標紅的是比前幾天明顯變多的字詞。</p>`);
  // 4. 可能牽動的台股族群
  const T = topics.map(t => ({ t, n: cnt(today, t), s: MX_SECT[t] })).filter(x => x.n && x.s).sort((a, b) => b.n - a.n).slice(0, 5);
  if (T.length) h += mxSec("sect", "今天的消息最可能牽動的台股族群", "", `<ul class="mx-kv">${T.map(x => `<li><span>${esc(x.t)} <small class="note">${x.n} 則</small></span><p>${esc(x.s)}</p></li>`).join("")}</ul><p class="note">依主題對應的經驗法則，實際影響要看消息內容是利多還是利空。</p>`);
  return `<div class="mxbox">${h}</div>`;
}

/* ---------- 預測市場 ---------- */
// 聯準會選項的利率變動（基點）：「25 bps decrease」→ -25、「No change」→ 0、「50+ bps increase」→ +50
const mxBps = s => { const t = String(s || ""); if (/no change|hold|unchanged|pause/i.test(t)) return 0; const m = t.match(/(\d+)\+?\s*(?:bps?|basis)/i); if (!m) return null; return /increase|hike|raise/i.test(t) ? +m[1] : /decrease|cut|lower/i.test(t) ? -m[1] : null; };
function mxPolyHtml(J) {
  const E = J?.events || []; if (!E.length) return "";
  const pct = v => `${Math.round((v || 0) * 100)}%`;
  let h = "";
  // 1. 聯準會利率路徑：每場會議的選項換成基點，算機率加權的預期變動
  const F = E.filter(e => e.cat === "聯準會與利率").map(e => { const M = e.markets.map(m => ({ ...m, bp: mxBps(m.label || m.q) })).filter(m => m.bp != null); const s = M.reduce((a, m) => a + m.yes, 0); return M.length >= 2 && s > 0.5 ? { e, M, exp: M.reduce((a, m) => a + m.yes * m.bp, 0) / s, cut: M.filter(m => m.bp < 0).reduce((a, m) => a + m.yes, 0) / s } : null; }).filter(Boolean).sort((a, b) => (a.e.end || "9").localeCompare(b.e.end || "9"));
  if (F.length) h += mxSec("fed", "聯準會利率路徑", "市場用真錢押的機率", `<ul class="mx-kv">${F.slice(0, 4).map(f => `<li><span>${esc(f.e.title)}${f.e.end ? ` <small class="note">${f.e.end.slice(5).replace("-", "/")}</small>` : ""}</span><p>降息機率 <b class="${f.cut > 0.5 ? "up" : ""}">${pct(f.cut)}</b>・預期變動 <b class="${cls(-f.exp)}">${f.exp > 0 ? "+" : ""}${Math.round(f.exp)} 個基點</b>（${f.M.map(m => `${m.bp > 0 ? "+" : ""}${m.bp}bp ${pct(m.yes)}`).join("、")}）</p></li>`).join("")}</ul>
    <p class="note">預期變動＝各選項的利率變動 × 機率加總（各選項機率先換算成合計 100%；100 個基點＝1%，25 個基點＝一碼）。降息機率越高，對成長股、科技股越有利。</p>`);
  // 2. 市場最分歧（機率 35%～65%）與幾乎確定（≥ 90% 或 ≤ 10%）
  const top = e => e.markets[0], split = E.filter(e => { const y = top(e)?.yes; return y != null && y >= 0.35 && y <= 0.65; }).sort((a, b) => b.vol24 - a.vol24).slice(0, 6);
  const sure = E.filter(e => { const y = top(e)?.yes; return y != null && (y >= 0.9 || y <= 0.1); });
  h += mxSec("split", "市場最分歧的事件", `${split.length} 件・另有 ${sure.length} 件幾乎確定`, split.length ? `<ul class="mx-kv">${split.map(e => `<li><span>${esc(e.title)} <small class="note">${esc(e.cat)}</small></span><p>${esc(top(e).label || top(e).q)} <b>${pct(top(e).yes)}</b>・24 小時成交 ${usd(e.vol24)}</p></li>`).join("")}</ul>` : `<p class="note">目前成交量大的事件都有明顯共識。</p>`)
    .replace("</details>", `<p class="note">機率接近一半代表市場還沒有共識，結果揭曉時對股市的衝擊通常最大；幾乎確定的事件多半已經反映在價格裡。</p></details>`);
  // 3. 注意力分布：24 小時成交量依分類
  const C = [...E.reduce((m, e) => m.set(e.cat, (m.get(e.cat) || 0) + e.vol24), new Map())].sort((a, b) => b[1] - a[1]), tot = C.reduce((a, x) => a + x[1], 0) || 1;
  h += mxSec("attn", "資金注意力分布", "24 小時成交量占比", `<ul class="mx-bars">${C.map(([c, v]) => `<li><span>${esc(c)}</span><i style="width:${Math.round(v / tot * 100)}%"></i><b>${Math.round(v / tot * 100)}%</b></li>`).join("")}</ul><p class="note">大家把錢押在哪一類事件，代表市場現在最在意什麼。</p>`);
  // 4. 重大風險機率：衰退、台海與地緣政治
  const risk = E.filter(e => e.cat === "台海與地緣政治" || (e.cat === "經濟數據與衰退" && /recession/i.test(e.title))).sort((a, b) => b.vol - a.vol).slice(0, 6);
  if (risk.length) h += mxSec("risk", "重大風險的機率", "", `<ul class="mx-kv">${risk.map(e => `<li><span>${esc(e.title)}</span><p>${esc(top(e).label || "是")} <b class="${top(e).yes >= 0.3 ? "down" : ""}">${pct(top(e).yes)}</b>${top(e).d1 ? `・24 小時 ${top(e).d1 > 0 ? "▲" : "▼"}${Math.abs(top(e).d1 * 100).toFixed(1)}` : ""}</p></li>`).join("")}</ul><p class="note">這類事件機率突然升高時，台股（尤其外資持股多的權值股）容易出現避險賣壓。</p>`);
  return `<div class="mxbox">${h}</div>`;
}
{ const css = document.createElement("style"); css.textContent = `.mxbox{padding:0 12px}.mx.mkfold{margin:8px 0}.mx-big{font-size:17px;margin:4px 0}.mx-big b{font-weight:600}
.mx-cyc{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start}@media (max-width:600px){.mx-cyc{grid-template-columns:1fr}}
.mx-q{position:relative;width:100%;max-width:220px;aspect-ratio:1;display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:12px}
.mx-q span{display:flex;align-items:flex-start;justify-content:center;padding:6px 4px;color:var(--muted);border:1px dashed var(--line)}.mx-q .q1{order:2}.mx-q .q2{order:1}.mx-q .q3{order:3}.mx-q .q4{order:4}
.mx-q i{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 30%,transparent)}
.mx-q em{position:absolute;font-style:normal;font-size:10.5px;color:var(--muted)}.mx-q .ax-x{right:4px;bottom:50%}.mx-q .ax-y{left:4px;bottom:50%}
.mx-chk{list-style:none;margin:6px 0;padding:0}.mx-chk li{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--line)}.mx-chk li .note{flex:1 1 100%}
.mx-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted)}.mx-dot.up{background:var(--up)}.mx-dot.warn{background:#d9a40b}.mx-dot.down{background:var(--down)}.warn{color:#d9a40b}
.mx-kv{list-style:none;margin:0;padding:0}.mx-kv li{padding:7px 0;border-bottom:1px solid var(--line)}.mx-kv li>span{display:block;font-weight:500}.mx-kv p{margin:3px 0 0;font-size:13.5px;overflow-wrap:anywhere}
.mx-gauge{position:relative;display:flex;justify-content:space-between;height:26px;margin:10px 0 4px;border-radius:13px;background:linear-gradient(90deg,color-mix(in srgb,var(--up) 45%,transparent),transparent,color-mix(in srgb,var(--down) 45%,transparent));font-size:11.5px;align-items:center;padding:0 10px;color:var(--muted)}
.mx-gauge i{position:absolute;top:-3px;width:4px;height:32px;margin-left:-2px;background:var(--ink);border-radius:2px}
.mx-tbl td,.mx-tbl th{font-size:12.5px}.mx-tbl td:first-child,.mx-tbl th:first-child,.mx-tbl td:last-child{text-align:left;white-space:normal;min-width:7em}.mx-pbar{display:inline-block;width:46px;height:5px;margin-right:6px;background:var(--line);border-radius:3px;vertical-align:middle;overflow:hidden}.mx-pbar i{display:block;height:100%;background:var(--accent)}
.mx-tone{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.mx-tone>div{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--line);border-radius:6px}
.mx-spark{display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:4px}.mx-spark i{flex:1;background:var(--muted);border-radius:2px 2px 0 0;min-height:2px}.mx-spark i.up{background:var(--up)}.mx-spark i.down{background:var(--down)}
.mx-words{display:flex;flex-wrap:wrap;gap:6px}.mx-words span{display:inline-flex;gap:4px;align-items:baseline;padding:3px 9px;border:1px solid var(--line);border-radius:12px;font-size:13px}.mx-words span.hot{border-color:var(--up)}.mx-words b{font-size:11px;color:var(--muted)}
.mx-bars{list-style:none;margin:0;padding:0}.mx-bars li{display:grid;grid-template-columns:8.5em 1fr 3em;gap:8px;align-items:center;padding:4px 0;font-size:13px}.mx-bars i{height:8px;background:var(--accent);border-radius:4px;min-width:2px}.mx-bars b{text-align:right;font-weight:500}`; document.head.appendChild(css); }
