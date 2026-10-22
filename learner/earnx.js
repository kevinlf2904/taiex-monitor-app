/* ================= 情報局「財報」進階：行事曆、連續成長、三率轉折、我的持股健檢、同業比較、小學堂、財報整體看法；美股財報週（對應台股供應鏈）、營收驚喜 =================
   資料：data/earn-hist.json（排程 scripts/earn-hist.mjs：月營收連續年增與創新高、月營收公布進度、觀測站營益分析算出的單季三率與變化）、
        data/us-earn-hist.json（scripts/us-earn.mjs 累積的美股已公布財報）、/api/calendar（法說會）、/api/kline（公布後股價反應）。
   個股展開（earn.js 的 erTrend）多一段「整體看法」：營收動能、獲利能力、估值位置（/api/stockinfo 的本益比歷史）、公布後股價反應。
   用到 earn.js 的 ER、erPct、erNum、erTrend、erSave，watch.html 的 W、esc、cls、getJ、store、renderList、allWatched、isTW、isUS、nameOf，industry.js 的 INDUSTRY_MAP。 */
const EX = { h: null, uh: null, k: {}, loading: false };
async function exLoad() {
  if (EX.loading || (EX.h && Date.now() - EX.h.got < 30 * 60e3)) return; EX.loading = true;
  const rd = async f => { try { const r = await fetch(f, { cache: "no-cache", signal: tmo(15000) }); return r.ok ? { ...(await r.json()), got: Date.now() } : { err: r.status === 404 ? "排程還沒產生資料，晚上 10:40 後再來看" : `HTTP ${r.status}`, got: Date.now() }; } catch (e) { return { err: e.message, got: Date.now() }; } };
  [EX.h, EX.uh] = await Promise.all([rd("data/earn-hist.json"), rd("data/us-earn-hist.json")]); EX.loading = false;
  if (W.lt === "earn") renderList();
}
const exH = () => { if (!EX.h) setTimeout(exLoad, 0); return EX.h && !EX.h.err ? EX.h : null; };
const exMap = (rows, i = 0) => new Map((rows || []).map(r => [r[i], r]));
const exName = (c, D) => (D?.rows || []).find(r => r[0] === c)?.[1] || (typeof nameOf === "function" ? nameOf(c) : c);
const exMine = () => { const s = new Set([...(typeof allWatched === "function" ? allWatched() : []), ...Object.keys(W.hold || {})]); return [...s]; };
const exNote = (h, t) => `<details class="extip"><summary aria-label="${esc(h)}是什麼">?</summary><p>${t}</p></details>`;
// 小學堂：名詞、怎麼算、怎麼看
const EX_LEARN = [
  ["月營收年增率", "這個月營收和去年同月比。", "台灣上市櫃公司每月 10 號前公布上個月營收，是最早看得到的成績單。年增率連續好幾個月為正，代表生意持續擴張；只看單月容易被基期、工作天數影響。"],
  ["累計年增率", "今年 1 月到這個月的營收合計，和去年同期比。", "比單月年增率穩定，適合看全年趨勢。"],
  ["EPS 每股盈餘", "稅後淨利 ÷ 流通股數（元）。", "一季賺多少錢分到每一股。常和去年同季比，或把近四季加起來看一年的獲利能力。"],
  ["毛利率", "（營收 − 成本）÷ 營收。", "反映產品的定價能力與成本控制。毛利率上升常代表產品組合變好或漲價成功。"],
  ["營業利益率", "營業利益 ÷ 營收。", "毛利再扣掉研發、管銷費用，看的是本業賺不賺錢。"],
  ["淨利率", "稅後淨利 ÷ 營收。", "包含業外收益（匯兌、投資）與稅，最後真正留下來的比例。淨利率大增但營益率沒變，多半是業外貢獻，要看能不能持續。"],
  ["三率三升", "毛利率、營益率、淨利率三個都比上一季（或去年同季）高。", "代表本業和整體獲利同時改善，是法人常用的選股條件之一；只有一季可能是偶發，連續幾季比較可靠。"],
  ["本益比（PE）", "股價 ÷ 近四季 EPS。", "用幾年的獲利可以買回這家公司。要和公司自己的歷史、同業比，不同產業的合理本益比差很多。"],
  ["股價淨值比（PB）", "股價 ÷ 每股淨值。", "適合看金融、景氣循環股；低於 1 代表股價比帳面淨值還低。"],
  ["EPS 驚喜", "實際 EPS 和分析師預估差多少 %。", "美股財報公布後的股價反應，常常看「比預期好或壞」而不是數字本身；財測（下一季展望）也很重要。"],
  ["營收驚喜", "實際營收和分析師預估差多少 %。", "EPS 可以靠省成本、買回庫藏股做出來，營收比較難；營收、EPS 都優於預期的「雙優」更有說服力。"],
  ["財報公布期限", "台股一般公司：第一季 5/15、第二季 8/14、第三季 11/14、年報 3/31；金融業較晚。", "月營收每月 10 號前。法說會通常在季報前後，公司會說明下一季展望。"],
];
// ---------- 台股：行事曆 ----------
function exCal(E, D) {
  const H = exH(), today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), y = +today.slice(0, 4), mine = new Set(exMine().filter(isTW));
  if (!W.cal && !EX.calLoading && !W.off) { EX.calLoading = true; getJ("/api/calendar", true).then(j => { W.cal = j; }).catch(e => { W.cal = { err: e.message }; }).finally(() => { EX.calLoading = false; if (W.lt === "earn") renderList(); }); }
  const DL = [[`${y}-03-31`, "年報（去年第四季）"], [`${y}-05-15`, "第一季季報"], [`${y}-08-14`, "第二季季報"], [`${y}-11-14`, "第三季季報"], [`${y + 1}-03-31`, "年報（今年第四季）"]];
  const nx = DL.find(([d]) => d >= today), days = d => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const m10 = today.slice(8) <= "10" ? `${today.slice(0, 8)}10` : (() => { const t = new Date(Date.UTC(y, +today.slice(5, 7), 10)); return t.toISOString().slice(0, 10); })();
  const P = H?.pub, mineNot = P ? [...mine].filter(c => !P.codes.includes(c)) : [];
  let h = `<section class="mk"><h3>重要日子${exNote("財報公布期限", EX_LEARN[11][1] + EX_LEARN[11][2])}</h3><div class="d-kv sxkv">
    <div><span>月營收公布截止</span><b>${m10.slice(5).replace("-", "/")}</b><small class="note">還有 ${days(m10)} 天</small></div>
    ${nx ? `<div><span>${nx[1]}截止</span><b>${nx[0].slice(5).replace("-", "/")}</b><small class="note">還有 ${days(nx[0])} 天</small></div>` : ""}
    ${P ? `<div><span>${+P.ym.slice(5)} 月營收已公布</span><b>${P.n.toLocaleString()} 家</b><small class="note">共 ${P.total.toLocaleString()} 家・${Math.round(P.n / P.total * 100)}%</small></div>` : ""}</div>
    <p class="note">金融業季報期限比較晚（第二季 8/31、第三季 11/29 左右）；期限遇假日順延。月營收公布進度每天晚上更新。</p></section>`;
  if (mine.size) h += `<section class="mk"><h3>我的自選、庫存<span class="note">${mine.size} 檔台股</span></h3>${P ? (mineNot.length ? `<p>${+P.ym.slice(5)} 月營收還沒公布：${mineNot.map(c => { const n = exName(c, D); return `<button class="linkbtn" data-sel="${esc(c)}">${esc(n)}${n !== c ? ` <small>${esc(c)}</small>` : ""}</button>`; }).join("、")}</p>` : `<p class="note">${+P.ym.slice(5)} 月營收都公布了。</p>`) : ""}
    ${(() => { const L = (W.cal?.conf || []).filter(x => mine.has(x.code) && x.date >= today); return L.length ? `<p>即將開法說會：${L.map(x => `<button class="linkbtn" data-sel="${esc(x.code)}">${esc(x.name || nameOf(x.code))}</button> ${x.date.slice(5).replace("-", "/")}`).join("、")}</p>` : `<p class="note">最近沒有自選股的法說會。</p>`; })()}</section>`;
  const C = (W.cal?.conf || []).filter(x => x.date >= today).slice(0, 60);
  h += `<section class="mk"><h3>法說會<span class="note">${W.cal?.err ? "暫時拿不到" : W.cal ? `接下來 ${C.length} 場` : "載入中…"}</span>${exNote("法說會", "法人說明會：公司向法人說明上一季成績與下一季展望，常在季報前後。展望比過去的數字更影響股價。")}</h3>
    ${C.length ? `<ol class="erlist excal">${C.map(x => `<li${mine.has(x.code) ? ' class="mine"' : ""}><button data-sel="${esc(x.code)}"><span class="rk">${x.date.slice(5).replace("-", "/")}</span><span class="nm">${mine.has(x.code) ? "★ " : ""}${esc(x.name || nameOf(x.code))}<small>${esc(x.code)}・${esc(x.market || "")}${x.time ? "・" + esc(x.time) : ""}</small></span><small class="ersub">${esc(x.place || x.note || "")}</small></button></li>`).join("")}</ol>` : ""}</section>`;
  return h;
}
// ---------- 台股：清單（和 earn.js 的排行同樣外觀，點了展開走勢） ----------
function exList(L, val, sub, cls1 = () => "") {
  const E = ER(), mx = Math.max(...L.map(r => Math.abs(val(r)) || 0), 1e-9);
  return `<ol class="erlist">${L.map((r, i) => { const v = val(r), op = E.open === r[0];
    return `<li${op ? ' class="on"' : ""}><button data-ertr="${esc(r[0])}" aria-expanded="${op}"><span class="rk">${i + 1}</span><span class="nm">${esc(r[1])}<small>${esc(r[0])}・${esc(r[2] || "")}${r[3] === "上櫃" ? "・櫃" : ""}</small></span><i class="${v < 0 ? "neg" : ""}" style="--w:${(Math.abs(v || 0) / mx * 100).toFixed(1)}%"></i><b class="${cls1(r)}">${esc(String(sub.v(r)))}</b><small class="ersub"><span class="ercode">${esc(r[0])}・</span>${sub.t(r)}</small></button>${op ? erTrend(r[0], false) : ""}</li>`; }).join("")}</ol>`;
}
const exChips = (k, cur, L) => `<div class="ichips erchips">${L.map(([v, t]) => `<button class="ichip" data-exk="${k}:${v}" aria-pressed="${cur === v}">${t}</button>`).join("")}</div>`;
function exStreak(E, D, keep) {
  const H = exH(); if (!H?.streak) return `<p class="note gnote">${EX.h?.err ? "⚠︎ " + esc(EX.h.err) : "載入月營收歷史…"}</p>`;
  const S = H.streak, k = E.xs || "s", R = S.rows.filter(keep), L = (k === "hi" ? R.filter(r => r[7]).sort((a, b) => b[7] - a[7] || b[6] - a[6]) : R.slice().sort((a, b) => b[4] - a[4] || (b[5] ?? 0) - (a[5] ?? 0))).slice(0, 80);
  const n = t => R.filter(r => r[4] >= t).length;
  return `<section class="mk"><h3>月營收連續成長<span class="note">${+S.ym.slice(5)} 月為止</span>${exNote("連續年增", "每個月營收都比去年同月高，連續幾個月。連續越久，代表成長不是一兩個月的偶發；創新高是這個月營收比過去 N 個月都高。")}</h3>
    <div class="d-kv sxkv"><div><span>連續 3 個月以上</span><b>${n(3)} 家</b></div><div><span>6 個月以上</span><b>${n(6)} 家</b></div><div><span>12 個月以上</span><b class="up">${n(12)} 家</b></div><div><span>創 12 個月以上新高</span><b>${R.filter(r => r[7]).length} 家</b></div></div></section>
    <div class="erbar">${exChips("xs", k, [["s", "連續年增最久"], ["hi", "營收創新高"]])}</div>
    <section class="mk"><h3>${k === "hi" ? "營收創新高" : "連續年增最久"}<span class="note">前 ${L.length} 家・點公司看走勢</span></h3>${L.length ? exList(L, r => (k === "hi" ? r[7] : r[4]), { v: r => (k === "hi" ? `${r[7] >= 36 ? "36+" : r[7]} 個月高` : `${r[4] >= 36 ? "36+" : r[4]} 個月`), t: r => `年增 ${erPct(r[5])}・營收 ${erNum(r[6], 1)} 億${k === "hi" ? `・連續年增 ${r[4]} 個月` : r[7] ? `・創 ${r[7]} 個月新高` : ""}` }, r => (k === "hi" ? "" : "up")) : `<p class="note">沒有符合的公司</p>`}</section>`;
}
// 三率轉折：單季毛利率、營益率、淨利率和上一季、去年同季比
const EX_TURN = [["3up", "三率三升（季）"], ["gm", "毛利率改善最多"], ["om", "營益率改善最多"], ["y3", "三率三升（年）"], ["k", "毛利率連續改善"], ["down", "毛利率下滑最多"]];
function exTurn(E, D, keep) {
  const H = exH(); if (!H?.pm) return `<p class="note gnote">${EX.h?.err ? "⚠︎ " + esc(EX.h.err) : "載入營益分析…"}</p>`;
  const P = H.pm, k = E.xt || "3up", R = P.rows.filter(keep), up3 = r => r[7] > 0 && r[8] > 0 && r[9] > 0, y3 = r => r[10] > 0 && r[11] > 0 && r[12] > 0;
  const L = (k === "3up" ? R.filter(up3).sort((a, b) => b[7] + b[8] - a[7] - a[8]) : k === "y3" ? R.filter(y3).sort((a, b) => b[10] + b[11] - a[10] - a[11]) : k === "gm" ? R.filter(r => r[7] != null).sort((a, b) => b[7] - a[7]) : k === "om" ? R.filter(r => r[8] != null).sort((a, b) => b[8] - a[8]) : k === "down" ? R.filter(r => r[7] != null).sort((a, b) => a[7] - b[7]) : R.filter(r => r[13] >= 2).sort((a, b) => b[13] - a[13] || b[7] - a[7])).slice(0, 80);
  const q = s => (s ? `${s.slice(0, 4)} Q${s.slice(-1)}` : "—"), dd = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
  const vk = k === "y3" ? 10 : k === "om" ? 8 : k === "k" ? 13 : 7;
  return `<section class="mk"><h3>三率轉折<span class="note">${q(P.q)} 單季</span>${exNote("三率三升", EX_LEARN[6][1] + EX_LEARN[6][2])}</h3>
    <div class="d-kv sxkv"><div><span>三率三升（季）</span><b class="up">${R.filter(up3).length} 家</b></div><div><span>三率三升（年）</span><b>${R.filter(y3).length} 家</b></div><div><span>毛利率季增家數</span><b>${R.filter(r => r[7] != null).length ? Math.round(R.filter(r => r[7] > 0).length / R.filter(r => r[7] != null).length * 100) : "—"}%</b></div></div>
    <p class="note">和上一季（${q(P.qp)}）、去年同季（${q(P.qy)}）比。觀測站的營益分析是當年度累計數，這裡換算成單季（累計毛利相減再除以單季營收）。單位：百分點。</p></section>
    <div class="erbar">${exChips("xt", k, EX_TURN)}</div>
    <section class="mk"><h3>${EX_TURN.find(x => x[0] === k)[1]}<span class="note">前 ${L.length} 家</span></h3>${L.length ? exList(L, r => r[vk] || 0, { v: r => (k === "k" ? `連 ${r[13]} 季` : `${dd(r[vk])}`), t: r => `毛利率 ${r[4] ?? "—"}%（季 ${dd(r[7])}・年 ${dd(r[10])}）・營益率 ${r[5] ?? "—"}%（${dd(r[8])}）・淨利率 ${r[6] ?? "—"}%（${dd(r[9])}）` }, r => cls(r[vk])) : `<p class="note">沒有符合的公司（季報還沒公布完時，家數會比較少）</p>`}</section>`;
}
// 我的持股健檢：自選＋庫存的台股，一次看營收、EPS、三率、連續成長，轉弱的標紅排前面
function exMy(E, D) {
  const mine = exMine().filter(isTW), H = exH(), RW = exMap(D.rows), ST = exMap(H?.streak?.rows), PM = exMap(H?.pm?.rows);
  if (!mine.length) return `<p class="note gnote">還沒有自選或庫存的台股。到「自選」加股票，或在「庫存」輸入持股，這裡就會一次健檢。</p>`;
  const rows = mine.map(c => { const r = RW.get(c), s = ST.get(c), p = PM.get(c), warn = [], good = [];
    if (r?.[6] != null) (r[6] < 0 ? warn : r[6] >= 20 ? good : []).push(`月營收年增 ${erPct(r[6])}`);
    if (r?.[8] != null && r[8] < 0) warn.push("本季虧損"); if (p?.[7] != null) (p[7] <= -2 ? warn : p[7] >= 2 ? good : []).push(`毛利率季${p[7] > 0 ? "增" : "減"} ${Math.abs(p[7]).toFixed(1)} 點`);
    if (s?.[4] >= 6) good.push(`連續年增 ${s[4]} 個月`); if (s?.[7]) good.push(`營收創 ${s[7]} 個月新高`);
    return { c, r, s, p, warn, good, n: r?.[1] || exName(c, D) }; }).sort((a, b) => b.warn.length - a.warn.length || b.good.length - a.good.length);
  const bad = rows.filter(x => x.warn.length).length;
  return `<section class="mk"><h3>我的持股財報健檢<span class="note">自選＋庫存 ${rows.length} 檔台股</span></h3><div class="d-kv sxkv"><div><span>有警訊</span><b class="down">${bad} 檔</b></div><div><span>表現好</span><b class="up">${rows.filter(x => !x.warn.length && x.good.length).length} 檔</b></div><div><span>沒有資料</span><b>${rows.filter(x => !x.r).length} 檔</b></div></div>
    <p class="note">警訊：月營收年減、本季虧損、毛利率比上一季掉 2 個百分點以上。只看財報數字，股價可能早就反映。</p></section>
    <section class="mk"><ol class="erlist exmy">${rows.map((x, i) => { const op = E.open === x.c;
      return `<li class="${x.warn.length ? "warn" : ""}${op ? " on" : ""}"><button data-ertr="${esc(x.c)}" aria-expanded="${op}"><span class="rk">${i + 1}</span><span class="nm">${esc(x.n)}<small>${esc(x.c)}${x.r ? `・${esc(x.r[2] || "")}` : ""}</small></span><i class="exnob" style="--w:0%"></i><b class="${x.warn.length ? "down" : x.good.length ? "up" : ""}">${x.warn.length ? "留意" : x.good.length ? "良好" : x.r ? "普通" : "—"}</b>
        <small class="ersub">${x.r ? [...x.warn.map(t => `<span class="down">${esc(t)}</span>`), ...x.good.map(t => `<span class="up">${esc(t)}</span>`)].join("・") || `月營收年增 ${erPct(x.r[6])}・EPS ${erNum(x.r[8])}` : "這檔不在月營收／季報資料裡（ETF、新上市或興櫃）"}</small></button>${op ? erTrend(x.c, false) : ""}</li>`; }).join("")}</ol></section>`;
}
// 同業比較：最多 4 檔並排
function exCmp(E, D) {
  const RW = exMap(D.rows), H = exH(), ST = exMap(H?.streak?.rows), PM = exMap(H?.pm?.rows);
  let L = (E.cmp || []).filter(c => RW.has(c));
  if (!L.length) { const seed = RW.get(exMine().find(c => RW.has(c))) || RW.get("2330"); if (seed) L = [seed[0], ...D.rows.filter(r => r[2] === seed[2] && r[0] !== seed[0] && r[4] != null).sort((a, b) => b[4] - a[4]).slice(0, 2).map(r => r[0])]; }
  const R = L.map(c => RW.get(c)), F = [["當月營收（億）", r => r[4], v => erNum(v, 1)], ["月營收年增", r => r[6], erPct], ["累計年增", r => r[7], erPct], ["本季 EPS", r => r[8], v => erNum(v)], ["毛利率", r => r[11], v => (v == null ? "—" : v + "%")], ["營益率", r => r[12], v => (v == null ? "—" : v + "%")], ["淨利率", r => r[13], v => (v == null ? "—" : v + "%")],
    ["毛利率季變化", r => PM.get(r[0])?.[7], v => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1))], ["連續年增（月）", r => ST.get(r[0])?.[4] ?? 0, v => v]];
  const best = f => { const v = R.map(r => f[1](r)).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  return `<section class="mk"><h3>同業比較<span class="note">最多 4 檔</span></h3><form class="oaq" data-excmp><input name="c" placeholder="輸入代號，用空白或逗號分開（例 2330 2303 5347）" value="${esc(L.join(" "))}" aria-label="比較的股票代號"><button class="btn sm primary">比較</button></form>
    ${R.length ? `<div class="cotbl-wrap"><table class="tbl excmp"><thead><tr><th></th>${R.map(r => `<th><button class="linkbtn" data-sel="${esc(r[0])}">${esc(r[1])}</button><small class="note"> ${esc(r[0])}</small></th>`).join("")}</tr></thead><tbody>
      ${F.map(f => { const b = best(f); return `<tr><td>${f[0]}</td>${R.map(r => { const v = f[1](r); return `<td class="${v != null && v === b && R.length > 1 ? "exbest" : ""}">${f[2](v)}</td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div>
      <p class="note">粗體是這一列最好的。預設是你的第一檔自選股和同產業營收最大的兩家；不同產業的毛利率標準差很多，同業比才有意義。</p>` : `<p class="note">找不到這些代號的財報資料。</p>`}</section>`;
}
function exLearn() {
  return `<section class="mk"><h3>財報小學堂<span class="note">看懂這頁的數字</span></h3><div class="exlearn">${EX_LEARN.map(([t, a, b]) => `<details class="mkmore"><summary><b>${t}</b><small class="note"> ${esc(a)}</small></summary><p>${esc(b)}</p></details>`).join("")}</div>
    <p class="note">財報是「過去」的成績；股價看的是「未來」，所以好財報不一定漲、壞財報不一定跌，要和市場預期一起看。</p></section>`;
}
// ---------- 台股：財報整體看法（總覽最上面） ----------
function exOverallTw(D, all, big) {
  const H = exH(), Y = all.filter(r => r[6] != null && big(r)), up = Y.filter(r => r[6] > 0).length / (Y.length || 1), hot = Y.filter(r => r[6] >= 30).length / (Y.length || 1);
  const E = all.filter(r => r[8] != null), loss = E.filter(r => r[8] < 0).length / (E.length || 1), keep = new Set(all.map(r => r[0]));
  const S = (H?.streak?.rows || []).filter(r => keep.has(r[0])), PM = (H?.pm?.rows || []).filter(r => keep.has(r[0])), gmUp = PM.filter(r => r[7] != null), gmUpR = gmUp.length ? gmUp.filter(r => r[7] > 0).length / gmUp.length : null;
  const I = erInd(all), pts = [], score = [up >= 0.6 ? 1 : up < 0.45 ? -1 : 0, loss <= 0.15 ? 1 : loss >= 0.3 ? -1 : 0, gmUpR == null ? 0 : gmUpR >= 0.55 ? 1 : gmUpR < 0.45 ? -1 : 0].reduce((a, b) => a + b, 0);
  pts.push(`營收：${Math.round(up * 100)}% 的公司月營收年增${hot >= 0.15 ? `，年增 30% 以上的有 ${Math.round(hot * 100)}%，成長很集中在強勢族群` : ""}。`);
  if (S.length) pts.push(`動能：${S.filter(r => r[4] >= 6).length} 家月營收連續年增半年以上，${S.filter(r => r[7]).length} 家創 12 個月以上新高。`);
  if (gmUpR != null) pts.push(`獲利能力：最新一季毛利率比上一季好的公司占 ${Math.round(gmUpR * 100)}%，三率三升 ${PM.filter(r => r[7] > 0 && r[8] > 0 && r[9] > 0).length} 家。`);
  pts.push(`虧損：本季 EPS 為負的占 ${Math.round(loss * 100)}%。`);
  if (I.length) pts.push(`產業：最強 ${I.slice(0, 3).map(g => `${g.n}（${erPct(g.yoy)}）`).join("、")}；最弱 ${I.slice(-2).map(g => `${g.n}（${erPct(g.yoy)}）`).join("、")}。`);
  const [t, c, m] = score >= 2 ? ["偏強", "up", "多數公司營收、獲利同步成長，基本面對股市有支撐；這時候選股重點在成長最快、毛利率還在往上的族群。"] : score <= -2 ? ["偏弱", "down", "成長的公司不多、虧損比例偏高，基本面支撐較弱；股市比較容易受資金和消息面左右，持股宜挑體質好的。"] : ["中性", "warn", "有成長也有衰退，產業差異大；與其看大盤，不如看產業與個股的營收、毛利率趨勢。"];
  return `<section class="mk exall"><h3>財報整體看法<span class="note">${erYm(D.ym)}營收・${erYq(D.yq)}季報</span></h3><p class="mc-tone"><span>整體</span><b class="${c}">${t}</b>${m}</p><ul class="exall-pts">${pts.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
    <p class="note">依全部上市櫃公司（排除月營收 1 億以下）的月營收、季報與營益分析統計；這是「整體」的溫度計，不代表個股。</p></section>`;
}
// ---------- 美股：財報整體看法、財報週（對應台股供應鏈）、營收驚喜 ----------
function exOverallUs(past) {
  const S = past.filter(r => r[6] != null), beat = S.filter(r => r[6] > 0).length / (S.length || 1), avg = S.length ? S.reduce((a, r) => a + Math.max(-50, Math.min(50, r[6])), 0) / S.length : null;
  const RV = past.filter(r => r[10] != null && r[11]), rb = RV.length ? RV.filter(r => r[10] > r[11]).length / RV.length : null;
  if (!S.length) return "";
  const s = (beat >= 0.75 ? 1 : beat < 0.6 ? -1 : 0) + (rb == null ? 0 : rb >= 0.65 ? 1 : rb < 0.5 ? -1 : 0), [t, c, m] = s >= 1 ? ["偏強", "up", "多數公司財報優於預期，企業獲利對美股有支撐，台股科技供應鏈也較有利。"] : s <= -1 ? ["偏弱", "down", "優於預期的比例偏低，市場容易下修獲利預估，股價波動會變大。"] : ["中性", "warn", "優於預期的比例接近歷史平均（大約七成），重點在個別公司的財測。"];
  return `<section class="mk exall"><h3>財報整體看法<span class="note">最近兩週公布的 ${S.length} 家</span></h3><p class="mc-tone"><span>整體</span><b class="${c}">${t}</b>${m}</p><ul class="exall-pts">
    <li>EPS 優於預期 ${Math.round(beat * 100)}%（歷史平均約 70～75%），平均驚喜 ${avg == null ? "—" : erPct(avg)}。</li>${rb != null ? `<li>營收優於預期 ${Math.round(rb * 100)}%（${RV.length} 家有營收預估）。</li>` : ""}</ul></section>`;
}
// 美股代號 → 台股供應鏈：產業地圖裡這家公司所在的題材，加上產業網絡相連的台股題材，裡面的台股公司
const EX_TW = {};
function exTwOf(sym) {
  if (EX_TW[sym]) return EX_TW[sym]; if (typeof INDUSTRY_MAP === "undefined") return [];
  const T = INDUSTRY_MAP.themes, my = T.filter(t => t.segs?.some(s => s.c.some(x => x[0] === sym))).map(t => t.id), near = new Set(my);
  for (const N of INDUSTRY_MAP.networks || []) for (const [a, b] of N.links || []) { if (my.includes(a)) near.add(b); if (my.includes(b)) near.add(a); }
  const cnt = new Map(); for (const t of T) if (near.has(t.id) && t.mk === "tw") for (const s of t.segs || []) for (const [c, n] of s.c) if (isTW(c)) cnt.set(c, [n, (cnt.get(c)?.[1] || 0) + 1]);
  return (EX_TW[sym] = [...cnt].sort((a, b) => b[1][1] - a[1][1]).slice(0, 6).map(([c, [n]]) => [c, n]));
}
function exWeek(E, U) {
  const today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), end = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const L = U.rows.filter(r => r[0] >= today && r[0] <= end && r[3] >= (E.big ? 100 : 30)).sort((a, b) => a[0].localeCompare(b[0]) || b[3] - a[3]), G = new Map(); for (const r of L) (G.get(r[0]) || G.set(r[0], []).get(r[0])).push(r);
  const hit = new Map(); for (const r of L) for (const [c, n] of exTwOf(r[1])) hit.set(c, [n, [...(hit.get(c)?.[1] || []), r[1]]]);
  const top = [...hit].sort((a, b) => b[1][1].length - a[1][1].length).slice(0, 10), wd = d => "日一二三四五六"[new Date(d + "T00:00:00Z").getUTCDay()];
  return `<section class="mk"><h3>這週公布財報的美股，會牽動哪些台股<span class="note">${L.length} 家</span>${exNote("對應台股", "依產業地圖：這家美股公司所在的題材，以及產業網絡上直接相連的台股題材（例如輝達 → 晶圓代工、CoWoS、伺服器代工）。是常見的連動關係，不代表一定同漲同跌。")}</h3>
    ${top.length ? `<p class="note">最常被牽動：</p><div class="exchips">${top.map(([c, [n, by]]) => `<button class="ichip" data-sel="${esc(c)}">${esc(n)} <small>${by.length} 家</small></button>`).join("")}</div>` : ""}</section>
    ${[...G].map(([d, R]) => `<section class="mk"><h3>${d.slice(5).replace("-", "/")}（${wd(d)}）<span class="note">${R.length} 家</span></h3><ul class="exweek">${R.map(r => { const tw = exTwOf(r[1]);
      return `<li><button class="linkbtn" data-ertr="${esc(r[1])}" data-erus="1"><b>${esc(r[2])}</b> <small class="note">${esc(r[1])}・${r[7] || "時間未定"}・預估 EPS ${erNum(r[5])}${r[11] != null ? `・預估營收 ${erNum(r[11])}B` : ""}</small></button>${tw.length ? `<div class="exchips">${tw.map(([c, n]) => `<button class="ichip" data-sel="${esc(c)}">${esc(n)}</button>`).join("")}</div>` : `<small class="note">產業地圖沒有對應的台股</small>`}${E.open === r[1] ? erTrend(r[1], true) : ""}</li>`; }).join("")}</ul></section>`).join("") || `<p class="note gnote">未來一週沒有符合的財報。</p>`}`;
}
function exUsRev(E, U, past) {
  const L = past.filter(r => r[10] != null && r[11]).map(r => [...r.slice(0, 12), (r[10] / r[11] - 1) * 100]).sort((a, b) => b[12] - a[12]), mx = Math.max(...L.map(r => Math.abs(r[12])), 1);
  return `<section class="mk"><h3>營收驚喜<span class="note">實際營收和預估比・${L.length} 家</span>${exNote("營收驚喜", EX_LEARN[10][1] + EX_LEARN[10][2])}</h3>${L.length ? `<ol class="erlist">${L.map((r, i) => { const op = E.open === r[1], two = r[6] > 0 && r[12] > 0;
    return `<li${op ? ' class="on"' : ""}><button data-ertr="${esc(r[1])}" data-erus="1" aria-expanded="${op}"><span class="rk">${i + 1}</span><span class="nm">${esc(r[2])}<small>${esc(r[1])}${two ? "・雙優" : ""}</small></span><i class="${r[12] < 0 ? "neg" : ""}" style="--w:${(Math.abs(r[12]) / mx * 100).toFixed(1)}%"></i><b class="${cls(r[12])}">${erPct(r[12])}</b>
      <small class="ersub">營收 ${erNum(r[10])}B vs 預估 ${erNum(r[11])}B・EPS 驚喜 ${r[6] == null ? "—" : erPct(r[6])}・${r[0].slice(5).replace("-", "/")}</small></button>${op ? erTrend(r[1], true) : ""}</li>`; }).join("")}</ol>` : `<p class="note">還沒有營收資料（排程每天整理兩次，市值 500 億美元以上的公司才查營收）。</p>`}</section>`;
}
// ---------- 個股：整體看法、估值位置、公布後股價反應、歷史驚喜紀錄 ----------
const exPctile = (L, v) => (L.length < 20 || v == null ? null : Math.round(L.filter(x => x <= v).length / L.length * 100));
async function exKline(c) { const k = "k:" + c; if (EX.k[k]) return; EX.k[k] = { loading: true };
  try { const j = await getJ(`/api/kline?code=${encodeURIComponent(c)}&months=30`); EX.k[k] = { rows: j.data || [] }; } catch (e) { EX.k[k] = { err: e.message }; } if (W.lt === "earn") renderList(); }
// 月營收公布（次月 10 號前）前 5、後 5、後 20 個交易日的漲跌，分成年增、年減兩組
function exRevReact(R, K) {
  const out = []; if (!K?.length) return out;
  for (const r of R.slice(-24)) { if (r.yoy == null) continue; const [y, m] = r.ym.split("-").map(Number), ev = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-10`;
    const i = K.findIndex(x => x.d > ev); if (i < 1 || i + 19 >= K.length) continue; const b = K[i - 1].c;
    out.push({ ym: r.ym, yoy: r.yoy, pre5: i >= 6 ? (b / K[i - 6].c - 1) * 100 : null, r5: (K[i + 4].c / b - 1) * 100, r20: (K[i + 19].c / b - 1) * 100 }); }
  return out;
}
function exReactTw(c, J) {
  const k = EX.k["k:" + c]; if (!k) return `<div class="frdl"><button type="button" class="btn sm" data-exk="kl:${esc(c)}">看公布前後的股價習慣 ›</button></div>`;
  if (k.loading) return `<p class="note">載入股價…</p>`; if (k.err) return `<p class="note">⚠︎ ${esc(k.err)}</p>`;
  const L = exRevReact(J.revenue || [], k.rows); if (L.length < 4) return `<p class="note">資料不夠，算不出公布後的股價反應。</p>`;
  const avg = (A, f) => (A.length ? A.reduce((s, x) => s + f(x), 0) / A.length : null), U = L.filter(x => x.yoy > 0), D = L.filter(x => x.yoy <= 0);
  const pre = L.filter(x => x.pre5 != null), mv = avg(L, x => Math.abs(x.r5)), big = L.filter(x => Math.abs(x.r5) >= 5).length;
  return `<h4>公布前後的股價習慣<span class="note">月營收・近 ${L.length} 個月</span></h4>
    <div class="d-kv sxkv"><div><span>公布前 5 日平均</span><b class="${cls(avg(pre, x => x.pre5))}">${pre.length ? erPct(avg(pre, x => x.pre5)) : "—"}</b><small class="note">上漲 ${pre.filter(x => x.pre5 > 0).length}／${pre.length} 次</small></div><div><span>公布後 5 日平均波動</span><b>${mv.toFixed(1)}%</b><small class="note">不分漲跌；超過 5% 有 ${big} 次</small></div></div>
    <p class="note">${mv >= 6 ? "這檔在營收公布後常大幅波動，公布前要想好部位大小。" : mv <= 3 ? "公布後通常波動不大。" : ""}${pre.length && avg(pre, x => x.pre5) >= 2 ? "公布前常先漲，市場可能提前反映。" : ""}</p>
    <div class="d-kv sxkv"><div><span>年增月 5 日</span><b class="${cls(avg(U, x => x.r5))}">${U.length ? erPct(avg(U, x => x.r5)) : "—"}</b><small class="note">${U.length} 次・上漲 ${U.filter(x => x.r5 > 0).length} 次</small></div><div><span>年減月 5 日</span><b class="${cls(avg(D, x => x.r5))}">${D.length ? erPct(avg(D, x => x.r5)) : "—"}</b><small class="note">${D.length} 次</small></div><div><span>20 日平均</span><b class="${cls(avg(L, x => x.r20))}">${erPct(avg(L, x => x.r20))}</b></div></div>
    ${barLineSvg(L.map(x => ({ label: x.ym.slice(2).replace("-", "/"), v: +x.r5.toFixed(1), y: x.yoy })), { fmtV: v => v + "%", fmtY: v => v + "%" })}<p class="note">以次月 10 號當公布日。柱＝公布後 5 個交易日漲跌、線＝那個月營收年增率。年增時常漲、年減時常跌，代表股價對營收很敏感；反過來常常「利多出盡」。</p>`;
}
function exValTw(J) {
  const P = (J.per || []).filter(x => x.pe > 0), last = P.at(-1); if (!last) return "";
  const pe = exPctile(P.map(x => x.pe), last.pe), pb = exPctile(P.filter(x => x.pb > 0).map(x => x.pb), last.pb), bar = (t, v, p, inv) => p == null ? "" : `<div class="exval"><span>${t} <b>${v}</b></span><i style="--p:${p}%"></i><small class="note">${p}%：比過去 ${p}% 的時間${inv ? "高（殖利率高＝相對便宜）" : "貴"}</small></div>`;
  return `<h4>估值位置<span class="note">現在在自己近 3 年的哪裡</span>${exNote("本益比", EX_LEARN[7][1] + EX_LEARN[7][2])}</h4>${bar("本益比", last.pe.toFixed(1), pe)}${bar("股價淨值比", last.pb?.toFixed(2), pb)}${bar("殖利率", last.dy != null ? last.dy + "%" : "—", exPctile(P.filter(x => x.dy != null).map(x => x.dy), last.dy), true)}
    <p class="note">0% 是近三年最便宜、100% 是最貴。成長加速的公司本益比本來就會往上，要和營收、EPS 趨勢一起看。</p>`;
}
function exUsHist(c, J) {
  const E = (J.earn || []).filter(x => x.surp != null), H = (EX.uh?.rows || []).filter(r => r[1] === c);
  if (!E.length && !H.length) return "";
  const n = E.filter(x => x.surp > 0).length, avg = E.length ? E.reduce((s, x) => s + x.surp, 0) / E.length : null;
  const k = EX.k["k:" + c], K = k?.rows || [], react = H.map(r => { const i = K.findIndex(x => x.d >= r[0]); if (i < 1) return null; const a = r[7] === "盤後" ? i : i - 1, b = r[7] === "盤後" ? i + 1 : i; return K[b] && K[a] ? { d: r[0], s: r[6], v: (K[b].c / K[a].c - 1) * 100 } : null; }).filter(Boolean);
  if (H.length && !k) setTimeout(() => exKline(c), 0);
  return `<h4>歷史驚喜紀錄</h4><div class="d-kv sxkv"><div><span>優於預期</span><b class="${n / (E.length || 1) >= 0.75 ? "up" : ""}">${n}／${E.length} 季</b></div><div><span>平均驚喜</span><b class="${cls(avg)}">${avg == null ? "—" : erPct(avg)}</b></div>${react.length ? `<div><span>隔天平均波動</span><b>${(react.reduce((t, x) => t + Math.abs(x.v), 0) / react.length).toFixed(1)}%</b><small class="note">不分漲跌・上漲 ${react.filter(x => x.v > 0).length}／${react.length} 次</small></div>` : ""}${react.length ? `<div><span>公布後隔天平均</span><b class="${cls(react.reduce((s, x) => s + x.v, 0) / react.length)}">${erPct(react.reduce((s, x) => s + x.v, 0) / react.length)}</b><small class="note">${react.length} 次</small></div>` : ""}</div>
    ${react.length ? `<p class="note">${react.map(x => `${x.d.slice(2).replace(/-/g, "/")}：驚喜 ${x.s == null ? "—" : erPct(x.s)}，股價 ${erPct(x.v)}`).join("；")}</p>` : `<p class="note">公布後股價反應從排程開始記錄的財報算起，會越來越完整。</p>`}`;
}
// 個股「整體看法」：一句話總結，再接估值、反應
function exCompany(c, us, J) {
  if (us) return `<div class="excomp">${exUsHist(c, J)}</div>`;
  const D = ER().data, r = (D?.rows || []).find(x => x[0] === c), H = exH(), s = H?.streak?.rows.find(x => x[0] === c), p = H?.pm?.rows.find(x => x[0] === c), P = (J.per || []).filter(x => x.pe > 0), pe = P.length ? exPctile(P.map(x => x.pe), P.at(-1).pe) : null;
  const pts = [], tone = [0, 0];
  if (r?.[6] != null) { pts.push(`營收${r[6] >= 20 ? "成長強勁" : r[6] > 0 ? "溫和成長" : "衰退"}（月營收年增 ${erPct(r[6])}${s?.[4] >= 3 ? `，已連續 ${s[4]} 個月年增` : ""}${s?.[7] ? `，創 ${s[7]} 個月新高` : ""}）`); tone[r[6] > 0 ? 0 : 1]++; }
  if (p?.[7] != null) { pts.push(`毛利率 ${p[4]}%，比上一季${p[7] > 0.5 ? "改善" : p[7] < -0.5 ? "下滑" : "持平"}${p[7] > 0 && p[8] > 0 && p[9] > 0 ? "，三率三升" : ""}`); if (p[7] > 0.5) tone[0]++; if (p[7] < -0.5) tone[1]++; }
  if (r?.[8] != null) { pts.push(r[8] < 0 ? `本季虧損（EPS ${erNum(r[8])}）` : `本季 EPS ${erNum(r[8])} 元`); if (r[8] < 0) tone[1]++; }
  if (pe != null) pts.push(`本益比在近三年的 ${pe}% 位置（${pe >= 80 ? "偏貴" : pe <= 20 ? "偏便宜" : "中間"}）`);
  const t = tone[0] - tone[1] >= 2 ? ["基本面偏強", "up"] : tone[1] - tone[0] >= 1 ? ["基本面轉弱", "down"] : ["基本面普通", ""];
  return `<div class="excomp">${pts.length ? `<h4>整體看法</h4><p class="frsum ${t[1]}">${t[0]}：${esc(pts.join("；"))}。${pe >= 80 && t[1] === "up" ? "好消息可能已經反映在股價。" : pe != null && pe <= 20 && t[1] === "up" ? "財報轉好但估值還在低檔，值得追蹤。" : ""}</p>` : ""}${exValTw(J)}${exReactTw(c, J)}${typeof epConf === "function" ? epConf(c) : ""}</div>`;
}
// earn.js 的分頁接進來
const EX_TW_VIEWS = { cal: exCal, streak: exStreak, turn: exTurn, my: exMy, cmp: exCmp, learn: exLearn };
$("#lx").addEventListener("click", e => { if (W.lt !== "earn") return; const b = e.target.closest("[data-exk]"); if (!b) return; const [k, v] = b.dataset.exk.split(/:(.*)/), E = ER();
  if (k === "kl") return exKline(v); E[k] = v; store.set("watch:erx", { xs: E.xs, xt: E.xt, cmp: E.cmp }); renderList(); });
$("#lx").addEventListener("submit", e => { const f = e.target.closest?.("[data-excmp]"); if (!f || W.lt !== "earn") return; e.preventDefault(); const E = ER(); E.cmp = String(f.c.value || "").toUpperCase().split(/[\s,，、]+/).filter(isTW).slice(0, 4); store.set("watch:erx", { xs: E.xs, xt: E.xt, cmp: E.cmp }); renderList(); });
{ const css = document.createElement("style"); css.textContent = `.extip { display: inline-block; margin-left: 6px; position: relative; font-weight: 400; } .extip > summary { list-style: none; cursor: pointer; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: var(--surface-2); color: var(--muted); font-size: 12px; } .extip > summary::-webkit-details-marker { display: none; }
.extip[open] > p { position: absolute; z-index: 5; left: 0; top: 22px; width: min(300px, 80vw); margin: 0; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; font-size: 13px; line-height: 1.55; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
.exall-pts { margin: 6px 0; padding-left: 1.2em; line-height: 1.6; } .exall .mc-tone b { margin-right: 6px; }
.excal li.mine button, .exmy li.warn .nm { color: var(--ink); } .excal .rk { min-width: 3.2em; } .exmy .ersub span + span::before { content: ""; }
.exchips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 2px; } .exweek { list-style: none; margin: 0; padding: 0; } .exweek li { padding: 8px 0; border-top: 1px solid var(--line); } .exweek li:first-child { border-top: 0; }
.erlist i.exnob { visibility: hidden; } .excmp td, .excmp th { text-align: right; white-space: nowrap; } .excmp td:first-child, .excmp th:first-child { text-align: left; } .excmp .exbest { font-weight: 700; color: var(--ink); }
.exval { display: grid; grid-template-columns: minmax(0, 9em) minmax(0, 1fr); gap: 2px 10px; align-items: center; margin: 6px 0; } .exval i { position: relative; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--surface-2), color-mix(in srgb, var(--accent) 60%, transparent)); }
.exval i::after { content: ""; position: absolute; left: var(--p); top: -4px; width: 3px; height: 14px; margin-left: -1px; background: var(--ink); border-radius: 2px; } .exval small { grid-column: 1 / -1; }
.exlearn details { border-top: 1px solid var(--line); } .exlearn details:first-child { border-top: 0; } .exlearn p { margin: 4px 0 10px; line-height: 1.6; } .excomp { margin-top: 6px; }`; document.head.appendChild(css); }
