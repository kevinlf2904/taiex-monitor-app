/* ================= 情報局「大盤 → 櫃買」：櫃買中心的指數、量值、產業營收、創新高、財測、董監、權證、暫停預告、興櫃 EPS、黃金、可轉債圖表 =================
   資料：data/tpex.json（排程 scripts/tpex-daily.mjs 每個交易日收盤後累積；櫃買 OpenAPI 只給當月，歷史靠排程存下來，月營收從公開資訊觀測站補）。
   點擊用 data-mk="otc…"，watch.html 的 data-mk 處理交給 otcMk()。
   用到 watch.html 的 W、esc、cls、store、renderList、mkSeg、barLineSvg、tmo，tschart.js 的 tsChart、xhWrap，tools.js 的 rkList、rkCards。 */
const OTC_VIEWS = [["ix", "指數"], ["vol", "量值"], ["rev", "產業營收"], ["hi", "營收創新高"], ["fc", "財測"], ["dir", "董監"], ["wt", "權證"], ["sus", "暫停預告"], ["esb", "興櫃 EPS"], ["gold", "黃金"], ["cb", "可轉債"]];
const OTC_IX = [["otc", "櫃買指數", "var(--accent)"], ["t50", "富櫃 50", "var(--s1)"], ["t200", "富櫃 200", "#3d7be0"], ["hd", "高殖利率", "var(--s3)"], ["cg", "公司治理", "#9b6bd6"], ["ci", "薪酬", "#c24d6d"], ["emp", "勞工就業 88", "#3fa36b"]];
const OTC_RNG = [["20", "1 個月"], ["60", "3 個月"], ["120", "半年"], ["250", "1 年"], ["all", "全部"]];
const OTC = () => (W.otc ||= { view: "ix", rng: "60", tr: "p", ym: "", ind: "", esb: "top", ...(store.get("watch:otc", null) || {}), data: null, loading: false });
const otcSave = () => { const O = OTC(); store.set("watch:otc", { view: O.view, rng: O.rng, tr: O.tr, esb: O.esb }); };
async function otcLoad(force = false) {
  const O = OTC(); if (O.loading || (!force && O.data && Date.now() - O.data.got < 30 * 60e3)) return;
  O.loading = true;
  try { const r = await fetch("data/tpex.json", { cache: "no-cache", signal: tmo(15000) }); if (!r.ok) throw new Error(r.status === 404 ? "排程還沒跑完第一次，收盤後再來看" : `HTTP ${r.status}`); O.data = { ...(await r.json()), got: Date.now() }; }
  catch (e) { O.data = { err: e.message, got: Date.now() }; } finally { O.loading = false; }
  if (W.lt === "mkt" && W.mkReg === "otc") renderList();
}
// data-mk="otc…" 的點擊
function otcMk(k, v) {
  const O = OTC();
  if (k === "otcV") { O.view = v; O.ind = ""; } else if (k === "otcRng") O.rng = v; else if (k === "otcTr") O.tr = v; else if (k === "otcYm") O.ym = v; else if (k === "otcInd") O.ind = O.ind === v ? "" : v; else if (k === "otcEsb") O.esb = v; else return false;
  otcSave(); renderList(); return true;
}
const otcCut = rows => (OTC().rng === "all" ? rows : rows.slice(-+OTC().rng));
const otcPct = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const otcYm = s => (s ? `${+s.slice(0, 4)} 年 ${+s.slice(5)} 月` : "");
const otcMd = d => (d ? d.slice(5).replace("-", "/") : "—");
const otcSec = (title, sub, body) => `<section class="mk otc"><h3>${title}${sub ? `<span class="note">${sub}</span>` : ""}</h3>${body}</section>`;
const otcNone = t => `<p class="note" style="padding:4px 2px">${t}</p>`;

function renderOtc(top) {
  const O = OTC(), D = O.data;
  const bar = `<div class="mn-days mkseg otcv">${OTC_VIEWS.map(([k, t]) => `<button type="button" data-mk="otcV" data-v="${k}" aria-pressed="${O.view === k}">${t}</button>`).join("")}</div>`;
  if (!D) { $("#lx").innerHTML = top + bar + `<p class="note" style="padding:12px">載入櫃買中心資料…</p>`; otcLoad(); return; }
  if (D.err) { $("#lx").innerHTML = top + bar + `<p class="note err" style="padding:12px">⚠︎ ${esc(D.err)}</p>`; return; }
  const f = { ix: otcIxHtml, vol: otcVolHtml, rev: otcRevHtml, hi: otcHiHtml, fc: otcFcHtml, dir: otcDirHtml, wt: otcWtHtml, sus: otcSusHtml, esb: otcEsbHtml, gold: otcGoldHtml, cb: otcCbHtml }[O.view] || otcIxHtml;
  $("#lx").innerHTML = top + bar + `<div class="otcbox">${f(D)}</div><p class="note" style="padding:4px 12px 12px">資料：櫃買中心 OpenAPI、公開資訊觀測站；排程每個交易日 17:25、21:45 更新${D.updated ? `（這份整理於 ${new Date(Date.parse(D.updated) + 8 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ")}）` : ""}。不是投資建議。</p>`;
}
const otcW = () => (innerWidth < 600 ? 400 : 600); // 手機用窄的畫布，軸上的字才不會縮太小
const otcRngSeg = () => mkSeg("otcRng", OTC().rng, OTC_RNG);

// 指數：櫃買指數 vs 報酬指數；主題指數同一起點 = 100 比較
function otcIxHtml(D) {
  const C = D.ix?.cols || [], R = otcCut(D.ix?.rows || []), col = k => C.indexOf(k), O = OTC();
  if (R.length < 2) return otcNone("指數歷史還不夠（排程每天累積，至少要兩個交易日）。");
  const dates = R.map(r => r[0]), v = k => R.map(r => r[col(k)] ?? null), first = vs => vs.find(x => x != null), last = vs => [...vs].reverse().find(x => x != null);
  const chg = vs => { const a = first(vs), b = last(vs); return a && b ? (b / a - 1) * 100 : null; };
  const p = v("otc"), tr = v("otcR"), gap = chg(tr) != null && chg(p) != null ? chg(tr) - chg(p) : null;
  let h = otcSec("櫃買指數 vs 報酬指數", `${otcMd(dates[0])}～${otcMd(dates[dates.length - 1])}`, `<div class="mksegrow">${otcRngSeg()}</div>`
    + tsChart({ w: otcW(), dates, panels: [{ h: 150, series: [{ name: "櫃買指數", vals: p, color: "var(--accent)", axis: "l", wide: true }, { name: "報酬指數（含息）", vals: tr, color: "var(--s1)", axis: "r" }] }] })
    + `<p class="note">這段期間櫃買指數 <b class="${cls(chg(p))}">${otcPct(chg(p))}</b>、報酬指數 <b class="${cls(chg(tr))}">${otcPct(chg(tr))}</b>${gap != null ? `，差距 ${gap.toFixed(1)} 個百分點就是股息再投入的效果` : ""}。報酬指數把除息的股息加回去，長期會越拉越開。</p>`);
  const suf = O.tr === "r" ? "R" : "", S = OTC_IX.map(([k, n, c]) => { const vs = v(k + suf), b = first(vs); return { k, n, c, vs, b, chg: chg(vs) }; }).filter(s => s.b);
  h += otcSec("主題指數比較", "同一天起算 = 100", `<div class="mksegrow">${mkSeg("otcTr", O.tr, [["p", "價格指數"], ["r", "報酬指數"]])}</div>`
    + tsChart({ dates, panels: [{ h: 190, series: S.map(s => ({ name: s.n, color: s.c, vals: s.vs.map(x => (x == null ? null : Math.round(x / s.b * 1e4) / 100)), fmt: x => (x == null ? "—" : x.toFixed(1)) })) }] })
    + `<table class="tbl otc-t"><thead><tr><th>指數</th><th>最新</th><th>區間漲跌</th></tr></thead><tbody>${S.sort((a, b) => (b.chg ?? -1e9) - (a.chg ?? -1e9)).map(s => `<tr><td><i class="otc-dot" style="background:${s.c}"></i>${s.n}</td><td>${last(s.vs).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td class="${cls(s.chg)}">${otcPct(s.chg)}</td></tr>`).join("")}</tbody></table>
    <p class="note">富櫃 50／200：上櫃市值大、流動性好的公司；高殖利率、公司治理、薪酬、勞工就業 88 是依股利、治理評鑑、員工薪酬、聘僱人數挑的成分股。富櫃 200 只有排程開始後每天記下的收盤。</p>`);
  return h;
}

// 量值：成交金額長條＋5／20 日均線，下面是櫃買指數
function otcVolHtml(D) {
  const all = D.vol || [], R = otcCut(all); if (R.length < 2) return otcNone("量值歷史還不夠。");
  const ma = (n, i0) => R.map((_, i) => { const j = all.length - R.length + i, s = all.slice(Math.max(0, j - n + 1), j + 1).map(r => r[2]).filter(x => x != null); return s.length === n ? Math.round(s.reduce((a, b) => a + b, 0) / n) : null; });
  const L = R[R.length - 1], a20 = ma(20)[R.length - 1], ratio = a20 ? L[2] / a20 : null;
  return otcSec("上櫃日成交量值", `${otcMd(L[0])}`, `<div class="mksegrow">${otcRngSeg()}</div>`
    + rkCards([{ t: "成交金額", v: `${L[2]?.toLocaleString()} 億` }, { t: "成交股數", v: `${L[1]?.toLocaleString()} 億股` }, { t: "成交筆數", v: `${L[3]?.toLocaleString()} 萬筆` }, { t: "和 20 日均量比", v: ratio ? `${(ratio * 100).toFixed(0)}%` : "—", vc: ratio > 1.2 ? "up" : ratio && ratio < 0.8 ? "down" : "", sub: ratio > 1.2 ? "放量" : ratio && ratio < 0.8 ? "量縮" : "" }])
    + tsChart({ w: otcW(), dates: R.map(r => r[0]), panels: [{ h: 140, series: [{ name: "成交金額（億）", type: "bar", vals: R.map(r => r[2]), color: "var(--muted)" }, { name: "5 日均", vals: ma(5), color: "var(--s1)" }, { name: "20 日均", vals: ma(20), color: "var(--accent)", dash: true }] }, { h: 80, series: [{ name: "櫃買指數", vals: R.map(r => r[4]), color: "var(--s3)" }] }] })
    + `<p class="note">量價一起看：指數漲、量放大是有人追；指數漲、量縮代表追價意願不高。20 日均線沒有滿 20 天前不畫。</p>`);
}

// 產業營收：產業 × 月份年增率熱圖，點產業看逐月營收
function otcRevHtml(D) {
  const M = (D.revm || []).slice(-12), O = OTC(); if (!M.length) return otcNone("月營收歷史還沒整理好。");
  const L = M[M.length - 1], Mr = [...M].reverse(), inds = Object.keys(L.ind).filter(k => L.ind[k][3] >= 2).sort((a, b) => (L.ind[b][1] ?? -1e9) - (L.ind[a][1] ?? -1e9));
  const cell = v => (v == null ? `<td></td>` : `<td style="background:color-mix(in srgb, var(${v >= 0 ? "--up" : "--down"}) ${Math.round(Math.min(1, Math.abs(v) / 40) * 65)}%, transparent)">${v.toFixed(0)}</td>`);
  let h = otcSec("上櫃各產業營收年增率", `${M.length} 個月・%`, `<div class="cotbl-wrap"><table class="tbl cxheat otc-heat"><thead><tr><th>產業</th>${Mr.map(m => `<th>${+m.ym.slice(5)}月</th>`).join("")}<th>家數</th></tr></thead><tbody>
    ${inds.map(k => `<tr${O.ind === k ? ' class="on"' : ""}><td><button class="linkbtn" data-mk="otcInd" data-v="${esc(k)}">${esc(k)}</button></td>${Mr.map(m => cell(m.ind[k]?.[1])).join("")}<td>${L.ind[k][3]}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">每格是那個月產業內公司營收加總和去年同月比；紅色成長、綠色衰退，顏色越深幅度越大（40% 以上最深）。最新的月份在最左邊，依最新一個月（${otcYm(L.ym)}）排序，點產業名稱看逐月營收。</p>`);
  if (O.ind && L.ind[O.ind]) { const S = (D.revm || []).filter(m => m.ind[O.ind]).slice(-12);
    h += otcSec(`${esc(O.ind)}：逐月營收`, "柱＝營收（億）、線＝年增率", barLineSvg(S.map(m => ({ label: `${+m.ym.slice(5)}月`, v: m.ind[O.ind][0], y: m.ind[O.ind][1] })), { fmtV: v => Math.round(v).toLocaleString() })); }
  return h;
}

// 營收創新高：每月家數長條（線＝月增且年增的家數占比），下面是選定月份的名單
function otcHiHtml(D) {
  const M = (D.revm || []).slice(-12), O = OTC(); if (!M.length) return otcNone("月營收歷史還沒整理好。");
  const cur = M.find(m => m.ym === O.ym) || M[M.length - 1];
  let h = otcSec("營收創新高家數", "創 12～24 個月新高", barLineSvg(M.map(m => ({ label: `${+m.ym.slice(5)}月`, v: m.hi.length, y: m.n ? Math.round(m.up / m.n * 100) : null })), { fmtV: v => v })
    + `<p class="note">柱＝當月營收高於過去 12～24 個月每一個月的上櫃公司家數（至少要有 12 個月的資料才算）；線＝當月月增、年增都是正的家數占比。創新高家數變多，通常代表景氣在擴張。</p>`
    + `<div class="mn-days mkseg">${[...M].reverse().map(m => `<button type="button" data-mk="otcYm" data-v="${m.ym}" aria-pressed="${m === cur}">${+m.ym.slice(0, 4) % 100}/${+m.ym.slice(5)}</button>`).join("")}</div>`);
  h += otcSec(`${otcYm(cur.ym)}創新高名單`, `${cur.hi.length} 家`, rkList(cur.hi.slice(0, 60).map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: `${esc(r[1])} <small class="note">${esc(r[0])}</small>`, sub: `${esc(r[2])}・創 ${r[5]} 個月新高`, val: `${r[3].toLocaleString()} 億`, vsub: `年增 ${otcPct(r[4])}`, star: r[0] })), "這個月沒有公司創新高（或歷史資料還不到 12 個月）"));
  return h;
}

// 財測：櫃買公司公開財務預測的達成情形、差異達 10% 以上（欄位依官方原樣列出）
function otcFcHtml(D) {
  const F = D.snap?.fc || {}, tbl = rows => { if (!rows?.length) return ""; const ks = Object.keys(rows[0]).slice(0, 9);
    return `<div class="cotbl-wrap"><table class="tbl otc-t"><thead><tr>${ks.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 80).map(r => `<tr>${ks.map(k => `<td>${esc(String(r[k] ?? "").trim())}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; };
  const none = "目前沒有資料。台灣多數公司不公開財務預測，只有自願公開或依規定要公開的公司才會出現在這裡。";
  return otcSec("財測達成情形", `${F.a?.length || 0} 筆`, tbl(F.a) || otcNone(none)) + otcSec("財測差異達 10% 以上", `${F.b?.length || 0} 筆`, tbl(F.b) || otcNone(none));
}

// 董監：質押比例分布與排行、持股不足法定成數
function otcDirHtml(D) {
  const P = D.snap?.pledge, S = D.snap?.short;
  let h = P?.buckets?.length ? otcSec("董監質押比例分布", P.date ? `${P.date.replace(/-/g, "/")} 統計` : "", barLineSvg(P.buckets.map(([k, n]) => ({ label: k.replace(/\s+/g, ""), v: n })), { fmtV: v => v })
    + `<p class="note">董監把持股拿去質押借錢，比例越高，股價大跌時越可能被追繳、斷頭賣壓。</p>`
    + rkList(P.top.slice(0, 30).map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: `${esc(r[1])} <small class="note">${esc(r[0])}</small>`, sub: "質押占董監持股", val: `${r[2].toFixed(1)}%`, vc: r[2] >= 50 ? "down" : "", star: r[0] })))) : otcSec("董監質押", "", otcNone("暫時沒有資料。"));
  h += otcSec("董監持股不足法定成數", S?.date ? `${S.date.replace(/-/g, "/")}・${S.rows.length} 家` : "", S?.rows?.length ? rkList(S.rows.map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: `${esc(r[1])} <small class="note">${esc(r[0])}</small>`, sub: `應持有 ${r[2].toLocaleString()} 張・實際 ${r[3].toLocaleString()} 張`, val: `不足 ${r[4].toLocaleString()} 張`, vsub: r[5] != null ? `差 ${r[5]}%` : "", star: r[0] })))
    + `<p class="note">法律規定全體董事要持有一定比例的股份；持股不足代表董監和公司利益綁得比較鬆，要留意。</p>` : otcNone("這次沒有持股不足的公司。"));
  return h;
}

// 權證：交易人數趨勢、今天權證成交值最多的標的
function otcWtHtml(D) {
  const C = D.wt?.cols || [], R = otcCut(D.wt?.rows || []), ki = C.findIndex(c => /交易人數/.test(c)), U = D.snap?.wtu, L = R[R.length - 1];
  let h = otcSec("每日權證交易人數", L ? otcMd(L[0]) : "", (L ? rkCards(C.slice(0, 8).map((c, i) => ({ t: esc(c.replace(/^上櫃/, "")), v: L[i + 1] != null ? L[i + 1].toLocaleString() : "—" }))) : "")
    + (ki >= 0 && R.length >= 2 ? `<div class="mksegrow">${otcRngSeg()}</div>` + tsChart({ w: otcW(), dates: R.map(r => r[0]), panels: [{ h: 130, series: [{ name: "交易人數", type: "bar", vals: R.map(r => r[ki + 1]), color: "var(--accent)" }] }] }) : otcNone("交易人數的歷史還不夠（排程每天記一筆）。"))
    + `<p class="note">權證交易人數暴增常出現在行情熱的時候，散戶槓桿情緒升溫；連續縮小代表追價的人變少。</p>`);
  h += otcSec("權證成交值最多的標的", U?.date ? `${U.date.replace(/-/g, "/")}・萬元` : "", U?.rows?.length ? rkList(U.rows.slice(0, 30).map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: `${esc(r[1])} <small class="note">${esc(r[0])}</small>`, sub: `認購 ${r[2].toLocaleString()}・認售 ${r[3].toLocaleString()}・${r[4]} 檔有成交`, val: (r[2] + r[3]).toLocaleString(), vc: r[2] >= r[3] ? "up" : "down", vsub: r[6] != null ? `標的 ${r[5]}（${r[6] > 0 ? "+" : ""}${r[6]}）` : "", star: r[0] })))
    + `<p class="note">紅字＝認購比較多（看漲）、綠字＝認售比較多（看跌）。只算上櫃掛牌的權證。</p>` : otcNone("暫時沒有資料。"));
  return h;
}

// 暫停當沖、暫停融券預告：同一段期間、同一個原因的合併成一條時間軸
function otcSusHtml(D) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const one = (title, rows, what) => {
    if (!rows?.length) return otcSec(title, "", otcNone("目前沒有預告。"));
    const G = new Map(); for (const r of rows) { const k = `${r[2]}|${r[3] || ""}|${r[4]}`; (G.get(k) || G.set(k, []).get(k)).push(r); }
    const L = [...G.values()].sort((a, b) => a[0][2].localeCompare(b[0][2])), ds = rows.flatMap(r => [r[2], r[3]]).filter(Boolean).sort(), d0 = Date.parse(ds[0]), d1 = Math.max(Date.parse(ds[ds.length - 1]), d0 + 864e5);
    const w = otcW(), lw = Math.round(w * 0.36), X = d => lw + (Date.parse(d) - d0) / (d1 - d0) * (w - lw - 10), rh = 22, H = L.length * rh + 26, tx = Date.parse(today);
    const svg = `<svg class="blsvg otc-gantt" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(title)}時間軸">${L.map((g, i) => { const y = 6 + i * rh, a = X(g[0][2]), b = g[0][3] ? X(g[0][3]) : w - 10, nm = g.length > 1 ? `${g[0][1]} 等 ${g.length} 檔` : `${g[0][1]} ${g[0][0]}`;
      return `<text x="4" y="${y + 13}" class="tsyl">${esc(nm.slice(0, 16))}</text><rect x="${a.toFixed(1)}" y="${y + 3}" width="${Math.max(3, b - a).toFixed(1)}" height="${rh - 8}" rx="3" fill="var(--accent)" opacity=".55"/>`; }).join("")}
      ${tx >= d0 && tx <= d1 ? `<line x1="${X(today).toFixed(1)}" x2="${X(today).toFixed(1)}" y1="0" y2="${H - 18}" stroke="var(--s1)" stroke-dasharray="3 3"/>` : ""}
      <text x="${lw}" y="${H - 4}" class="tsyl">${otcMd(ds[0])}</text><text x="${w - 10}" y="${H - 4}" text-anchor="end" class="tsyl">${otcMd(ds[ds.length - 1])}</text></svg>`;
    return otcSec(title, `${rows.length} 檔`, svg + `<details class="mkmore"><summary>逐檔明細</summary>${rkList(rows.map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: `${esc(r[1])} <small class="note">${esc(r[0])}</small>`, sub: esc(r[4] || what), val: `${otcMd(r[2])}～${otcMd(r[3])}`, star: r[0] })))}</details>`);
  };
  return one("暫停先賣後買當沖預告", D.snap?.sus, "暫停當沖") + one("暫停融券賣出預告", D.snap?.sss, "股東會、除權息前停券")
    + `<p class="note" style="padding:0 12px">虛線是今天。暫停融券多半是股東會或除權息前的「停券」，融券要在期間開始前回補，可能出現軋空；ETF 分配收益前也會暫停當沖先賣。</p>`;
}

// 興櫃 EPS：分布＋排行
function otcEsbHtml(D) {
  const E = D.snap?.esb, O = OTC(); if (!E?.rows?.length) return otcNone("暫時沒有資料。");
  const B = [["≤ -2", -1e9, -2], ["-2～0", -2, 0], ["0～1", 0, 1], ["1～3", 1, 3], ["3～5", 3, 5], ["5～10", 5, 10], ["> 10", 10, 1e9]];
  const L = O.esb === "low" ? [...E.rows].reverse() : E.rows;
  return otcSec("興櫃公司 EPS 分布", `${E.date ? E.date.replace(/-/g, "/") + "・" : ""}${E.rows.length} 家`, barLineSvg(B.map(([t, a, b]) => ({ label: t, v: E.rows.filter(r => r[3] != null && r[3] > a && r[3] <= b).length })), { fmtV: v => v })
    + `<p class="note">興櫃是上櫃前的練習場，股價波動大、成交量小；EPS 是最近公布的累計每股盈餘（元）。</p>`)
    + otcSec("興櫃 EPS 排名", "", `<div class="mksegrow">${mkSeg("otcEsb", O.esb, [["top", "最高"], ["low", "最低"]])}</div>` + rkList(L.slice(0, 40).map(r => ({ mono: "", no: r[0], name: `${esc(r[2])} <small class="note">${esc(r[1])}</small>`, val: `${r[3]} 元`, vc: cls(r[3]) }))));
}

// 黃金現貨：今天的報價卡＋每日均價走勢
function otcGoldHtml(D) {
  const G = D.snap?.gold || [], H = D.gold || [];
  let h = otcSec("黃金現貨當日行情", G[0] ? `${otcMd(G[0].d)} ${G[0].t ? G[0].t.slice(0, 2) + ":" + G[0].t.slice(2, 4) : ""}・元／公克` : "", G.length ? G.map(g => `<div class="otc-gold"><b>${esc(g.name)} <small class="note">${esc(g.code)}</small></b>
    ${rkCards([{ t: "最新成交", v: g.last?.toLocaleString() ?? "—" }, { t: "買價／賣價", v: `${g.buy?.toLocaleString() ?? "—"}／${g.sell?.toLocaleString() ?? "—"}` }, { t: "漲跌", v: otcPct(g.chg), vc: cls(g.chg) }, { t: "均價（前日）", v: `${g.avg?.toLocaleString() ?? "—"}`, sub: g.pavg ? `前日 ${g.pavg.toLocaleString()}` : "" }, { t: "最高／最低", v: `${g.hi?.toLocaleString() ?? "—"}／${g.lo?.toLocaleString() ?? "—"}` }, { t: "成交量", v: `${g.vol?.toLocaleString() ?? "—"}`, sub: g.n ? `${g.n} 筆` : "" }])}</div>`).join("") : otcNone("暫時沒有資料。"));
  const codes = [...new Set(H.map(r => r[1]))], dates = [...new Set(H.map(r => r[0]))].sort().slice(OTC().rng === "all" ? 0 : -+OTC().rng);
  if (dates.length >= 2) h += otcSec("黃金現貨每日均價", "元／公克", `<div class="mksegrow">${otcRngSeg()}</div>` + tsChart({ w: otcW(), dates, panels: [{ h: 140, series: codes.slice(0, 3).map((c, i) => ({ name: H.find(r => r[1] === c)[2], color: ["var(--s1)", "var(--accent)", "var(--s3)"][i], vals: dates.map(d => H.find(r => r[0] === d && r[1] === c)?.[3] ?? null) })) }] }));
  else h += otcNone("均價走勢要等排程累積幾天才畫得出來。");
  return h + `<p class="note" style="padding:0 12px">櫃買中心的黃金現貨是以新台幣計價的實體黃金交易，價格跟著國際金價和匯率走。</p>`;
}

// 可轉債買賣斷：各券商買進、賣出金額
function otcCbHtml(D) {
  const C = D.snap?.cb; if (!C?.rows?.length) return otcNone("暫時沒有資料。");
  const R = C.rows.map(r => ({ c: r[0], n: r[1], b: (r[3] || 0) / 1e4, s: (r[5] || 0) / 1e4 })), tb = R.reduce((a, r) => a + r.b, 0), ts = R.reduce((a, r) => a + r.s, 0);
  const top = [...R].sort((a, b) => b.b + b.s - a.b - a.s).slice(0, 12), net = [...R].sort((a, b) => Math.abs(b.b - b.s) - Math.abs(a.b - a.s)).slice(0, 10);
  return otcSec("可轉債買賣斷（券商）", `${C.date ? C.date.replace(/-/g, "/") + "・" : ""}萬元`, rkCards([{ t: "買進合計", v: Math.round(tb).toLocaleString() }, { t: "賣出合計", v: Math.round(ts).toLocaleString() }, { t: "券商家數", v: R.length }])
    + `<h4>買賣差最大的券商<span class="note">柱＝買進減賣出</span></h4>` + barLineSvg(net.map(r => ({ label: r.n.slice(0, 4), v: Math.round(r.b - r.s) })), { fmtV: v => v.toLocaleString() })
    + rkList(top.map(r => ({ mono: "", name: esc(r.n), sub: `買 ${Math.round(r.b).toLocaleString()}・賣 ${Math.round(r.s).toLocaleString()}`, val: Math.round(r.b + r.s).toLocaleString(), vsub: "買賣合計" })))
    + `<p class="note">可轉債（CB）是可以換成股票的公司債，券商在營業處所買賣斷的金額，反映可轉債市場當天哪些券商最活躍。</p>`);
}
