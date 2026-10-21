/* 大戶與國會情報的延伸功能（情報局「大戶國會」）：
   ・大戶共識：美股＝國會議員近 90 天買進＋13F 機構本季加碼，台股＝政治人物持有＋內部人有沒有在申報轉讓，排成一張分數榜
   ・我的追蹤：追蹤國會議員、13F 機構、台灣政治人物；他們有新申報就標「新」，有綁 Telegram 時收盤後的排程也會推播（scripts/alerts-push.mjs）
   ・申報延遲：每位議員從交易到公開平均晚幾天（國會首頁「申報延遲」）
   ・個人勝率卡：議員買進後 1／3／6／12 個月的報酬、勝率和同期 SPY（人物頁）
   ・13F 主題熱圖：本季各機構在每個產業主題新進、加碼、減碼、出清幾檔（13F「主題熱圖」）
   用到 watch.html 的 W、esc、cls、store、getJ、renderList、usd、amtMid、pName、congFrom、congDays、loadCong、IND，tools.js 的 rk*、f13Load、twoLoad、insLoad、twoPeople、myCodes、retPct。 */

// ---------- 追蹤 ----------
const CX_KINDS = { cong: "國會議員", f13: "13F 機構", tw: "台灣政治人物" };
const cxFol = () => (W.fol ||= { cong: {}, f13: {}, tw: {}, ...(store.get("watch:follow", null) || {}) });
const cxSeen = () => (W.folSeen ||= store.get("watch:folSeen", {}));
const cxHas = (k, id) => !!cxFol()[k]?.[id];
function cxToggle(k, id, name) {
  const F = cxFol(); F[k] ||= {}; if (F[k][id]) delete F[k][id]; else { F[k][id] = name || id; cxSeen()[`${k}:${id}`] = new Date().toISOString().slice(0, 10); store.set("watch:folSeen", cxSeen()); }
  store.set("watch:follow", F); toast(F[k][id] ? `已追蹤 ${name || id}${typeof syncGet === "function" && syncGet().tg ? "，有新申報會用 Telegram 通知" : ""}` : "已取消追蹤");
}
const cxFolBtn = (k, id, name) => `<button type="button" class="btn sm" data-cxfol="${k}:${esc(id)}" data-cxname="${esc(name || id)}" aria-pressed="${cxHas(k, id)}">${cxHas(k, id) ? "★ 追蹤中" : "☆ 追蹤"}</button>`;
// 每位追蹤對象的最新申報：[{ k, id, name, d（申報日）, txt, cv（點了去哪） }]
function cxLatest() {
  const F = cxFol(), out = [];
  for (const pid of Object.keys(F.cong || {})) { const L = (W.cong?.trades || []).filter(t => t.pid === pid).sort((a, b) => b.filed.localeCompare(a.filed)), d = L[0]?.filed;
    out.push({ k: "cong", id: pid, name: W.cong ? pName(pid) : F.cong[pid], d, cv: `person:${pid}`, txt: d ? `${d.slice(5).replace("-", "/")} 申報 ${L.filter(t => t.filed === d).length} 筆：${[...new Set(L.filter(t => t.filed === d).map(t => `${t.k === "buy" ? "買" : t.k === "sell" ? "賣" : "換"} ${t.ticker}`))].slice(0, 5).join("、")}` : W.cong ? "還沒有申報紀錄" : "載入中…" }); }
  for (const cik of Object.keys(F.f13 || {})) { const f = W.f13?.funds?.find(x => x.cik === cik), n = f ? f.rows.filter(r => r.chg === "new" || r.chg === "add").length : 0;
    out.push({ k: "f13", id: cik, name: f?.who || F.f13[cik], d: f?.filed, cv: `f13:${cik}`, txt: f ? `${f.filed.slice(5).replace("-", "/")} 申報 ${f.period} 季底持股：新進或加碼 ${n} 檔、出清 ${f.sold.length} 檔` : W.f13 ? "找不到這家機構" : "載入中…" }); }
  for (const pid of Object.keys(F.tw || {})) { const p = W.two?.decl ? twoPeople().find(x => x.pid === pid) : null;
    out.push({ k: "tw", id: pid, name: p?.name || F.tw[pid], d: p?.last?.date, cv: `tw:p:${pid}`, txt: p ? `${p.last.date.replace(/-/g, "/")} ${esc(p.last.kind || "申報")}：持股 ${p.hold.length} 檔${p.chg.length ? `、和前一次比變動 ${p.chg.length} 檔` : ""}` : W.two ? "找不到這個人" : "載入中…" }); }
  return out.sort((a, b) => (b.d || "").localeCompare(a.d || ""));
}
const cxNewN = () => cxLatest().filter(x => x.d && x.d > (cxSeen()[`${x.k}:${x.id}`] || "")).length;
function cxFolHtml() {
  if (!W.cong) loadCong(); if (!W.f13) f13Load(); if (!W.two) twoLoad(); if (!W.ins) insLoad();
  const L = cxLatest(), seen = cxSeen(), mine = new Set([...myCodes(), ...Object.keys(W.hold || {})]), from = congFrom(30);
  const ins = (W.ins?.rows || []).filter(r => mine.has(r.code) && r.d >= from).sort((a, b) => b.d.localeCompare(a.d));
  const tw = W.two?.decl ? twoPeople().filter(p => p.hold.some(h => mine.has(h.code))).map(p => ({ p, h: p.hold.filter(h => mine.has(h.code)) })) : [];
  const h = `<section class="csec tw-home">${rkHead("我的追蹤", `追蹤的人有新申報會標「新」；打開看過就算已讀。綁定 Telegram（工具 → 備份同步）後，收盤後的排程也會把追蹤對象的新申報、你自選與庫存股票的內部人轉讓申報推播給你。`)}
    ${L.length ? rkList(L.map(x => { const nw = x.d && x.d > (seen[`${x.k}:${x.id}`] || ""); return { no: CX_KINDS[x.k].slice(0, 2), attr: `data-cv="${esc(x.cv)}" data-cxread="${x.k}:${esc(x.id)}"`, mono: "", name: `${esc(x.name)}${nw ? ' <span class="tw-tp">新</span>' : ""}`, sub: x.txt, val: "" }; }))
      : `<p class="note">還沒有追蹤任何人。在國會議員、13F 機構、台灣政治人物的頁面按「☆ 追蹤」。</p>`}
    <h4>我的自選與庫存：內部人近 30 天申報轉讓</h4>${ins.length ? rkList(ins.slice(0, 30).map(r => ({ no: r.d.slice(5).replace("-", "/"), attr: `data-tsel="${esc(r.code)}"`, mono: "", name: `${esc(r.name)} ${esc(r.code)}`, sub: `${esc(r.who)}（${esc(r.role)}）・${esc(r.how)}`, val: `${Math.round(r.sh / 1000).toLocaleString()} 張`, vc: "down" })), "")
      : `<p class="note">${W.ins ? "近 30 天沒有你自選或庫存股票的內部人轉讓申報。" : "載入中…"}</p>`}
    <h4>我的自選與庫存：有台灣政治人物申報持有</h4>${tw.length ? rkList(tw.slice(0, 30).map(({ p, h }) => ({ attr: `data-cv="tw:p:${esc(p.pid)}"`, mono: "", name: esc(p.name), sub: esc([p.org, p.title].filter(Boolean).join("・")), val: h.map(x => esc(x.name || x.code)).slice(0, 3).join("、"), vsub: `${h.length} 檔` })), "")
      : `<p class="note">${W.two ? "沒有。" : "載入中…"}</p>`}</section>`;
  return h;
}

// ---------- 大戶共識 ----------
function cxConsHtml() {
  if (!W.cong) loadCong(); if (!W.f13) f13Load(); if (!W.two) twoLoad(); if (!W.ins) insLoad();
  const reg = W.cxReg === "tw" ? "tw" : "us", seg = rkSeg("data-rkset", "cxReg:" + reg, [["cxReg:us", "美股：國會＋13F"], ["cxReg:tw", "台股：政治人物＋內部人"]]);
  let body = "";
  if (reg === "us") {
    if (!W.cong?.trades || !W.f13?.funds) body = `<p class="note">載入國會與 13F 資料中…</p>`;
    else {
      const from = congFrom(90), M = new Map(), g = tk => M.get(tk) || M.set(tk, { tk, asset: "", buy: new Set(), sell: new Set(), up: [], dn: [] }).get(tk);
      for (const t of W.cong.trades) if (t.assetType === "股票" && t.traded >= from && /^[A-Z][A-Z.]{0,6}$/.test(t.ticker || "")) { const x = g(t.ticker); x.asset ||= t.asset; if (t.k === "buy") x.buy.add(t.pid); else if (t.k === "sell") x.sell.add(t.pid); }
      for (const f of W.f13.funds) for (const r of [...f.rows, ...f.sold]) { if (!r.ticker || r.pc) continue; const x = g(r.ticker); x.asset ||= r.name; const who = f.who.split(" ")[0];
        if (r.chg === "new" || r.chg === "add") x.up.push(who); else if (r.chg === "cut" || r.chg === "sold" || f.sold.includes(r)) x.dn.push(who); }
      const L = [...M.values()].map(x => ({ ...x, sc: x.buy.size * 2 + x.up.length - x.sell.size - x.dn.length })).filter(x => x.buy.size && x.up.length).sort((a, b) => b.sc - a.sc || b.buy.size - a.buy.size).slice(0, 40);
      body = `<h4>議員在買、機構也在加碼（分數＝議員買進人數 ×2 ＋ 加碼機構 − 賣出議員 − 減碼機構）</h4>` + rkList(L.map(x => ({ star: x.tk, attr: `data-cv="stock:${esc(x.tk)}"`, mono: "", name: esc(x.tk), sub: esc(x.asset || ""),
        val: `${x.sc > 0 ? "+" : ""}${x.sc} 分`, vc: cls(x.sc), vsub: `<span class="up">議員買 ${x.buy.size}</span>${x.sell.size ? `／<span class="down">賣 ${x.sell.size}</span>` : ""}・<span class="up">機構加碼 ${x.up.length}</span>${x.dn.length ? `／<span class="down">減碼 ${x.dn.length}</span>` : ""}` })), "目前沒有兩邊同時在買的股票")
        + `<p class="note">議員買進看近 90 天（交易日）；機構動向是上一季 13F（季底後 45 天才公開）。兩邊時間點不同，只能當研究起點。</p>`;
    }
  } else {
    if (!W.two?.decl || !W.ins) body = `<p class="note">載入台灣政治人物與內部人資料中…</p>`;
    else {
      const from = congFrom(90), M = new Map(), g = (c, n) => M.get(c) || M.set(c, { c, n, ppl: new Set(), add: 0, cut: 0, ins: 0, insSh: 0 }).get(c);
      for (const p of twoPeople()) { for (const h of p.hold) if (h.code) g(h.code, h.name).ppl.add(p.pid); for (const x of p.chg) if (x.code) { if (x.t === "new" || x.t === "add") g(x.code, x.name).add++; else g(x.code, x.name).cut++; } }
      for (const r of W.ins.rows || []) if (r.d >= from && M.has(r.code)) { const x = M.get(r.code); x.ins++; x.insSh += r.sh || 0; }
      const L = [...M.values()].map(x => ({ ...x, sc: x.ppl.size + x.add - x.cut - x.ins * 2 })).filter(x => x.ppl.size >= 2).sort((a, b) => b.sc - a.sc || b.ppl.size - a.ppl.size).slice(0, 40);
      body = `<h4>多位政治人物持有、內部人沒有在賣（分數＝持有人數 ＋ 增持 − 減持 − 內部人轉讓 ×2）</h4>` + rkList(L.map(x => ({ star: x.c, attr: `data-cv="tw:s:${esc(x.c)}"`, mono: "", name: `${esc(nameOf(x.c) !== x.c ? nameOf(x.c) : x.n || "")} ${esc(x.c)}`,
        sub: `${x.ppl.size} 位持有${x.add ? `・增持 ${x.add}` : ""}${x.cut ? `・減持 ${x.cut}` : ""}`, val: `${x.sc > 0 ? "+" : ""}${x.sc} 分`, vc: cls(x.sc), vsub: x.ins ? `<span class="down">內部人近 90 天申報轉讓 ${x.ins} 筆・${Math.round(x.insSh / 1000).toLocaleString()} 張</span>` : "內部人近 90 天沒有申報轉讓" })), "沒有資料")
        + `<p class="note">政治人物持股來自最近一次財產申報（可能是一兩年前）；內部人轉讓是事前申報，不一定真的賣出。</p>`;
    }
  }
  return `<section class="csec tw-home">${rkHead("大戶共識榜", "把不同來源的大戶動向疊在一起：同一檔股票有越多種大戶站在同一邊，分數越高。只是整理公開申報，不是買賣建議。")}<div class="tw-ctl">${seg}</div>${body}</section>`;
}

// ---------- 申報延遲（國會首頁） ----------
function cxLagHtml(C) {
  const by = new Map(); for (const t of C.trades || []) { const d = congDays(t.traded, t.filed); if (!(d >= 0)) continue; (by.get(t.pid) || by.set(t.pid, []).get(t.pid)).push(d); }
  const L = [...by].map(([pid, A]) => { A.sort((a, b) => a - b); return { pid, n: A.length, med: A[A.length >> 1], max: A[A.length - 1], late: A.filter(x => x > 45).length / A.length }; }).filter(x => x.n >= 3).sort((a, b) => b.med - a.med);
  const all = [...by.values()].flat().sort((a, b) => a - b);
  return `<h4>申報延遲：從交易到公開的天數（中位數，交易 3 筆以上的人）</h4><p class="note">法律規定 45 天內申報。延遲越久，你看到的資訊越舊，跟單越不準。全部交易的中位數是 ${all[all.length >> 1] ?? "—"} 天、超過 45 天的有 ${all.length ? Math.round((all.filter(x => x > 45).length / all.length) * 100) : 0}%。</p>`
    + rkList(L.slice(0, 50).map(x => ({ attr: `data-cv="person:${esc(x.pid)}"`, mono: "", name: esc(pName(x.pid)), sub: `${x.n} 筆・最久 ${x.max} 天${x.late ? `・逾期 ${Math.round(x.late * 100)}%` : ""}`, val: `${x.med} 天`, vc: x.med > 30 ? "down" : x.med <= 10 ? "up" : "" })), "沒有資料");
}

// ---------- 個人勝率卡（人物頁） ----------
const CX_H = [[21, "1 個月"], [63, "3 個月"], [126, "6 個月"], [252, "12 個月"]];
async function cxWinLoad(pid) {
  const tk = [...new Set((W.cong?.trades || []).filter(t => t.pid === pid && t.k === "buy" && t.assetType === "股票" && /^[A-Z][A-Z.]{0,6}$/.test(t.ticker || "")).map(t => t.ticker))].slice(0, 25);
  W.cxWin = { pid, busy: true }; const need = ["SPY", ...tk].filter(T => !Array.isArray(W.congK[T])); let k = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (k < need.length) { const T = need[k++]; try { const j = await getJ(`/api/kline?code=${encodeURIComponent(T)}&months=24`); W.congK[T] = j.data || []; } catch (e) { W.congK[T] = { err: e.message }; } } }));
  W.cxWin = { pid, done: true }; if (W.lt === "cong" && W.cv === `person:${pid}`) renderList();
}
// 每一筆買進：交易日收盤（議員本人）與申報後第一個交易日收盤（跟單）買進，持有 h 個交易日的報酬，和同期 SPY 比
function cxWinStats(pid) {
  const S = Array.isArray(W.congK.SPY) ? W.congK.SPY : [], sIdx = new Map(S.map((x, i) => [String(x.d).slice(0, 10), i])), out = {};
  const buys = (W.cong?.trades || []).filter(t => t.pid === pid && t.k === "buy" && Array.isArray(W.congK[t.ticker]) && W.congK[t.ticker].length > 5);
  for (const [h] of CX_H) { const r = { t: [], f: [], ex: [] };
    for (const t of buys) { const D = W.congK[t.ticker], ds = D.map(x => String(x.d).slice(0, 10)); if (ds[0] > t.traded) continue;
      const iT = ds.findIndex(d => d >= t.traded), iF = ds.findIndex(d => d > t.filed), ret = i => (i >= 0 && i + h < D.length && D[i].c > 0 ? D[i + h].c / D[i].c - 1 : null);
      const a = ret(iT), b = ret(iF); if (a != null) { r.t.push(a); const s0 = sIdx.get(ds[iT]), s1 = sIdx.get(ds[iT + h]); if (s0 != null && s1 != null) r.ex.push(a - (S[s1].c / S[s0].c - 1)); } if (b != null) r.f.push(b); }
    const st = A => (A.length ? { n: A.length, avg: A.reduce((x, y) => x + y, 0) / A.length, win: A.filter(x => x > 0).length / A.length } : null);
    out[h] = { t: st(r.t), f: st(r.f), ex: st(r.ex) }; }
  return { out, n: buys.length };
}
function cxWinHtml(pid) {
  if (W.cxWin?.pid !== pid) { setTimeout(() => cxWinLoad(pid), 0); return `<div class="cxwin"><h4>勝率卡</h4><p class="note">載入股價、計算這位議員買進後的報酬…</p></div>`; }
  if (W.cxWin.busy) return `<div class="cxwin"><h4>勝率卡</h4><p class="note">計算中…</p></div>`;
  const { out, n } = cxWinStats(pid); if (!n) return `<div class="cxwin"><h4>勝率卡</h4><p class="note">這位議員沒有可以計算的股票買進（或股價拿不到）。</p></div>`;
  const pc = v => (v == null ? "—" : `${Math.round(v * 100)}%`);
  return `<div class="cxwin"><h4>勝率卡 <span class="note">${n} 筆股票買進・買進後持有</span></h4><div class="cotbl-wrap"><table class="tbl sxtbl"><thead><tr><th>持有</th><th>議員本人</th><th>贏 SPY</th><th>申報後跟單</th></tr></thead><tbody>
    ${CX_H.map(([h, t]) => { const o = out[h], c = s => (s ? `<b class="${cls(s.avg)}">${retPct(s.avg)}</b><small class="note">勝率 ${pc(s.win)}・${s.n} 筆</small>` : "—"); return `<tr><td>${t}</td><td>${c(o.t)}</td><td>${o.ex ? pc(o.ex.win) : "—"}</td><td>${c(o.f)}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="note">「議員本人」用交易日收盤買進（實際做不到，只是看他選股準不準）；「申報後跟單」用申報公開後第一個交易日收盤買進。只算最近兩年、最多 25 檔股票；持有天數還不到的不算。</p></div>`;
}

// ---------- 13F 主題熱圖 ----------
function cxHeatHtml(F) {
  const cat = new Map(); for (const t of (typeof IND !== "undefined" ? IND.themes : [])) if (t.mk === "us") for (const s of t.segs || []) for (const [c] of s.c || []) if (!cat.has(c)) cat.set(c, t.cat || t.name);
  const COLS = [["new", "新進"], ["add", "加碼"], ["cut", "減碼"], ["sold", "出清"]], M = new Map();
  for (const f of F.funds) for (const r of [...f.rows.map(r => [r, r.chg]), ...f.sold.map(r => [r, "sold"])]) { const [x, ch] = r; if (!COLS.some(c => c[0] === ch) || x.pc) continue;
    const k = (x.ticker && cat.get(x.ticker)) || "其他／未分類", g = M.get(k) || M.set(k, { k, new: 0, add: 0, cut: 0, sold: 0, tk: new Map() }).get(k); g[ch]++; if (x.ticker) g.tk.set(x.ticker, (g.tk.get(x.ticker) || 0) + (ch === "new" || ch === "add" ? 1 : -1)); }
  const L = [...M.values()].map(g => ({ ...g, net: g.new + g.add - g.cut - g.sold })).sort((a, b) => (a.k === "其他／未分類") - (b.k === "其他／未分類") || b.net - a.net), mx = Math.max(1, ...L.flatMap(g => COLS.map(([c]) => g[c])));
  const cell = (v, up) => `<td style="background:color-mix(in srgb, var(${up ? "--up" : "--down"}) ${Math.round((v / mx) * 60)}%, transparent)">${v || ""}</td>`;
  return `<h4>主題熱圖：本季各產業主題被機構新進、加碼、減碼、出清幾次</h4><div class="cotbl-wrap"><table class="tbl cxheat"><thead><tr><th>主題</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}<th>淨方向</th><th>代表股</th></tr></thead><tbody>
    ${L.map(g => `<tr><td>${esc(g.k)}</td>${cell(g.new, 1)}${cell(g.add, 1)}${cell(g.cut, 0)}${cell(g.sold, 0)}<td class="${cls(g.net)}">${g.net > 0 ? "+" : ""}${g.net}</td><td>${[...g.tk].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([t, v]) => `<button class="linkbtn" data-copen="${esc(t)}"><span class="${cls(v)}">${esc(t)}</span></button>`).join(" ")}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">每一格是「機構 × 股票」的次數（同一家機構加碼一檔算 1 次）。主題分類用產業圖解裡的美股公司，對不到的放在「其他」。</p>`;
}

// ---------- 掛到國會頁 ----------
// 人物頁、13F 機構頁、台灣政治人物頁加「☆ 追蹤」，人物頁另外加申報延遲與勝率卡；看過就算已讀
function cxDecor(v, arg) {
  const box = document.querySelector("#lx .tw-p"); if (!box) return;
  let k = null, id = arg, name = "";
  if (v === "person") { k = "cong"; name = pName(arg); }
  else if (v === "f13" && arg) { k = "f13"; name = W.f13?.funds?.find(f => f.cik === arg)?.who || arg; }
  else if (v === "tw" && arg?.startsWith("p:")) { k = "tw"; id = arg.slice(2); name = W.two?.decl ? twoPeople().find(p => p.pid === id)?.name || id : id; }
  if (!k) return;
  const S = cxSeen(), key = `${k}:${id}`, today = new Date().toISOString().slice(0, 10); if (cxHas(k, id) && S[key] !== today) { S[key] = today; store.set("watch:folSeen", S); }
  let extra = "";
  if (k === "cong") { const L = (W.cong?.trades || []).filter(t => t.pid === id).map(t => congDays(t.traded, t.filed)).filter(d => d >= 0).sort((a, b) => a - b);
    extra = (L.length ? `<p class="note cxlag">申報延遲：中位數 ${L[L.length >> 1]} 天、最久 ${L[L.length - 1]} 天${L.some(d => d > 45) ? `，有 ${L.filter(d => d > 45).length} 筆超過 45 天期限` : ""}。</p>` : "") + cxWinHtml(id); }
  const bar = document.createElement("div"); bar.className = "cxbar"; bar.innerHTML = cxFolBtn(k, id, name) + extra;
  const head = box.querySelector(".tw-lead") || box.firstElementChild; head ? head.after(bar) : box.prepend(bar);
}
document.addEventListener("click", e => {
  const f = e.target.closest("[data-cxfol]"); if (f) { const [k, id] = f.dataset.cxfol.split(/:(.*)/s); cxToggle(k, id, f.dataset.cxname); f.setAttribute("aria-pressed", cxHas(k, id)); f.textContent = cxHas(k, id) ? "★ 追蹤中" : "☆ 追蹤"; return; }
  const r = e.target.closest("[data-cxread]"); if (r) { const S = cxSeen(); S[r.dataset.cxread] = new Date().toISOString().slice(0, 10); store.set("watch:folSeen", S); }
});
{ const css = document.createElement("style"); css.textContent = `.cxbar { display: grid; gap: 6px; margin: 8px 0; } .cxbar > .btn { justify-self: start; } .cxwin h4 { margin: 8px 0 4px; } .cxwin td b { display: block; font-weight: 500; } .cxwin td small { display: block; font-size: 11px; white-space: nowrap; }
.cxheat td, .cxheat th { text-align: center; white-space: nowrap; } .cxheat td:first-child, .cxheat th:first-child { text-align: left; } .cxheat td:last-child { text-align: left; }`; document.head.appendChild(css); }

// ---------- 自訂區間（國會、內部人、台灣政治人物）與 13F 季度區間 ----------
// 區間存在 watch:cxRng（{ cong: { from, to }, ins: …, tw: … }）；日期是 YYYY-MM-DD，空的代表不限
const cxRng = k => (W.cxRng ||= store.get("watch:cxRng", {}))[k] || {};
const cxIn = (d, r) => !!d && (!r.from || d >= r.from) && (!r.to || d <= r.to);
const cxRngTxt = r => (r.from || r.to ? `${(r.from || "最早").replace(/-/g, "/")}～${(r.to || "最新").replace(/-/g, "/")}` : "全部期間");
const cxRngHtml = (k, on, lab = "自訂區間") => { const r = cxRng(k);
  return `<div class="cxrng${on ? " on" : ""}"><span class="note">${lab}</span><input type="date" data-cxrng="${k}:from" value="${esc(r.from || "")}" aria-label="開始日期"><span class="note">～</span><input type="date" data-cxrng="${k}:to" value="${esc(r.to || "")}" aria-label="結束日期">${r.from || r.to ? `<button type="button" class="linkbtn" data-cxrngx="${k}">清除</button>` : ""}</div>`; };
// 設定區間後切到「自訂」：國會 W.cw＝-1、內部人 W.insW＝-1；台灣政治人物直接用區間篩申報
function cxRngSet(k, f, v) {
  const R = (W.cxRng ||= store.get("watch:cxRng", {})); R[k] = { ...(R[k] || {}), [f]: v || "" }; if (!R[k].from && !R[k].to) delete R[k]; store.set("watch:cxRng", R);
  if (k === "cong") { W.cw = R[k] ? -1 : 90; store.set("watch:cw", W.cw); } else if (k === "ins") { W.insW = R[k] ? -1 : 30; store.set("watch:insW", W.insW); }
  W.twoP = null; renderList();
}
document.addEventListener("change", e => { const t = e.target.closest?.("[data-cxrng]"); if (!t) return; const [k, f] = t.dataset.cxrng.split(":"); cxRngSet(k, f, t.value); });
document.addEventListener("click", e => { const b = e.target.closest("[data-cxrngx]"); if (!b) return; const R = (W.cxRng ||= {}); delete R[b.dataset.cxrngx]; store.set("watch:cxRng", R); cxRngSet(b.dataset.cxrngx, "from", ""); });

// 13F：選兩個季度（起～迄），用 data/f13-hist.json 重算「迄」那一季的持股和相對「起」的變動，首頁各排行都改看這個區間
const cxQs = () => [...new Set([...(W.f13?.funds || []).map(f => f.period), ...Object.values(W.f13H || {}).flatMap(h => (h.periods || []).map(p => p.period))])].sort().reverse();
function cxF13Range(F) {
  if (W.f13H === undefined) { W.f13H = null; fetch("data/f13-hist.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(j => { W.f13H = j || {}; if (W.lt === "cong") renderList(); }); }
  const Q = W.f13R || {}, qs = cxQs(); if (!W.f13H || (!Q.to && !Q.from)) return F;
  const to = qs.includes(Q.to) ? Q.to : qs[0], from = qs.includes(Q.from) && Q.from < to ? Q.from : qs[qs.indexOf(to) + 1]; if (!from) return F;
  const per = (f, q) => (f.period === q ? { period: f.period, filed: f.filed, total: f.total, rows: f.rows } : (W.f13H[f.cik]?.periods || []).find(p => p.period === q));
  const funds = F.funds.map(f => { const B = per(f, to), A = per(f, from); if (!B || !A) return null; const am = new Map(A.rows.map(r => [r.cusip, r])), bm = new Set(B.rows.map(r => r.cusip));
    const rows = B.rows.map(r => { const a = am.get(r.cusip), x = a && a.sh ? r.sh / a.sh : null; return { ...r, psh: a?.sh || 0, chg: !a ? "new" : x > 1.02 ? "add" : x < 0.98 ? "cut" : "same" }; });
    return { ...f, period: to, prevPeriod: from, filed: B.filed || f.filed, total: B.total ?? rows.reduce((s, r) => s + (r.value || 0), 0), n: rows.length, rows, sold: A.rows.filter(r => !bm.has(r.cusip)).map(r => ({ ...r, chg: "sold", psh: r.sh, sh: 0 })) }; }).filter(Boolean);
  return { ...F, funds, range: { from, to } };
}
const cxF13RngHtml = () => { const qs = cxQs(), Q = W.f13R || {}; if (qs.length < 2) return W.f13H === null ? `<p class="note">載入歷史季度…</p>` : "";
  const to = qs.includes(Q.to) ? Q.to : qs[0], from = qs.includes(Q.from) && Q.from < to ? Q.from : qs[qs.indexOf(to) + 1] || "";
  const sel = (f, cur, L) => `<select data-f13r="${f}" aria-label="${f === "from" ? "起始季度" : "結束季度"}">${L.map(q => `<option value="${q}" ${q === cur ? "selected" : ""}>${q.slice(0, 4)} Q${Math.ceil(+q.slice(5, 7) / 3)}</option>`).join("")}</select>`;
  return `<div class="cxrng${Q.to || Q.from ? " on" : ""}"><span class="note">比較季度</span>${sel("from", from, qs.filter(q => q < to))}<span class="note">→</span>${sel("to", to, qs)}${Q.to || Q.from ? `<button type="button" class="linkbtn" data-f13rx>回到最新一季</button>` : ""}</div>`; };
document.addEventListener("change", e => { const s = e.target.closest?.("[data-f13r]"); if (!s) return; W.f13R = { ...(W.f13R || {}), [s.dataset.f13r]: s.value }; renderList(); });
document.addEventListener("click", e => { if (e.target.closest("[data-f13rx]")) { W.f13R = null; renderList(); } });
{ const css = document.createElement("style"); css.textContent = `.cxrng { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0; } .cxrng input, .cxrng select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-2); color: var(--ink); min-width: 0; max-width: 150px; }
.cxrng.on input, .cxrng.on select { border-color: var(--ink); } .cxrng input[type="date"] { width: 8.6em; padding: 4px; }`; document.head.appendChild(css); }
