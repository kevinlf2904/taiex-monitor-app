/* 大戶與國會情報的延伸功能（情報局「大戶國會」）：
   ・大戶共識：美股＝國會議員近 90 天買進＋13F 機構本季加碼，台股＝政治人物持有＋內部人有沒有在申報轉讓，排成一張分數榜
   ・我的追蹤：追蹤國會議員、13F 機構、台灣政治人物；他們有新申報就標「新」，有綁 Telegram 時收盤後的排程也會推播（scripts/alerts-push.mjs）
   ・申報延遲：每位議員從交易到公開平均晚幾天（國會首頁「申報延遲」）
   ・個人勝率卡：議員買進後 1／3／6／12 個月的報酬、勝率和同期 SPY（人物頁）
   ・13F 主題熱圖：本季各機構在每個產業主題新進、加碼、減碼、出清幾檔（13F「主題熱圖」）
   用到 watch.html 的 W、esc、cls、store、getJ、renderList、usd、amtMid、pName、congFrom、congDays、loadCong、IND，tools.js 的 rk*、f13Load、twoLoad、insLoad、twoPeople、myCodes、retPct。 */

// ---------- 追蹤 ----------
const CX_KINDS = { cong: "國會議員", f13: "13F 機構", tw: "台灣政治人物", ins: "內部人" };
const cxFol = () => (W.fol ||= { cong: {}, f13: {}, tw: {}, ins: {}, ...(store.get("watch:follow", null) || {}) });
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
  for (const c of Object.keys(F.ins || {})) { const L = (W.ins?.rows || []).filter(r => r.code === c).sort((a, b) => b.d.localeCompare(a.d)), r = L[0];
    out.push({ k: "ins", id: c, name: `${r?.name || F.ins[c]} ${c}`, d: r?.d, cv: "ins", txt: r ? `${r.d.slice(5).replace("-", "/")} ${esc(r.who)}（${esc(r.role)}）申報轉讓 ${Math.round((r.sh || 0) / 1000).toLocaleString()} 張・${esc(r.how)}${L.length > 1 ? `・資料期間共 ${L.length} 筆` : ""}` : W.ins ? "資料期間內沒有內部人申報轉讓" : "載入中…" }); }
  return out.sort((a, b) => (b.d || "").localeCompare(a.d || ""));
}
const cxNewN = () => cxLatest().filter(x => x.d && x.d > (cxSeen()[`${x.k}:${x.id}`] || "")).length;
function cxFolHtml() {
  if (!W.cong) loadCong(); if (!W.f13) f13Load(); if (!W.two) twoLoad(); if (!W.ins) insLoad();
  const L = cxLatest(), seen = cxSeen(), mine = new Set([...myCodes(), ...Object.keys(W.hold || {})]), R = cxPer("fol"), wTxt = cxWTxt("fol");
  const ins = (W.ins?.rows || []).filter(r => mine.has(r.code) && cxIn(r.d, R)).sort((a, b) => b.d.localeCompare(a.d));
  const tw = W.two?.decl ? twoPeople().filter(p => p.hold.some(h => mine.has(h.code))).map(p => ({ p, h: p.hold.filter(h => mine.has(h.code)) })) : [];
  const h = `<section class="csec tw-home">${rkHead("我的追蹤", `追蹤的人有新申報會標「新」；打開看過就算已讀。綁定 Telegram（工具 → 備份同步）後，收盤後的排程也會把追蹤對象的新申報、你自選與庫存股票的內部人轉讓申報推播給你。`)}
    ${L.length ? rkList(L.map(x => { const nw = x.d && x.d > (seen[`${x.k}:${x.id}`] || ""); return { no: CX_KINDS[x.k].slice(0, 2), attr: `data-cv="${esc(x.cv)}" data-cxread="${x.k}:${esc(x.id)}"`, mono: "", name: `${esc(x.name)}${nw ? ' <span class="tw-tp">新</span>' : ""}`, sub: x.txt, val: "" }; }))
      : `<p class="note">還沒有追蹤任何人。在國會議員、13F 機構、台灣政治人物的頁面按「☆ 追蹤」；內部人在「內部人」分頁輸入公司代號追蹤。</p>`}
    <h4>我的自選與庫存：內部人${wTxt}申報轉讓</h4>${cxPerRow("fol")}${ins.length ? rkList(ins.slice(0, 30).map(r => ({ no: r.d.slice(5).replace("-", "/"), attr: `data-cv="tw:s:${esc(r.code)}"`, mono: "", name: `${esc(r.name)} ${esc(r.code)}`, sub: `${esc(r.who)}（${esc(r.role)}）・${esc(r.how)}`, val: `${Math.round(r.sh / 1000).toLocaleString()} 張`, vc: "down" })), "")
      : `<p class="note">${W.ins ? `${wTxt}沒有你自選或庫存股票的內部人轉讓申報。` : "載入中…"}</p>`}
    <h4>我的自選與庫存：有台灣政治人物申報持有</h4>${tw.length ? rkList(tw.slice(0, 30).map(({ p, h }) => ({ attr: `data-cv="tw:p:${esc(p.pid)}"`, mono: "", name: esc(p.name), sub: esc([p.org, p.title].filter(Boolean).join("・")), val: h.map(x => esc(x.name || x.code)).slice(0, 3).join("、"), vsub: `${h.length} 檔` })), "")
      : `<p class="note">${W.two ? "沒有。" : "載入中…"}</p>`}
    <h4>我的自選與庫存：本週千張大戶動向</h4>${cxTdccFolHtml(mine)}</section>`;
  return h;
}

function cxTdccFolHtml(mine) {
  const codes = [...mine].filter(c => typeof isTW === "function" ? isTW(c) : /^\d{4,6}[A-Z]?$/.test(c));
  if (!codes.length) return `<p class="note">自選股與庫存目前沒有台股標的。</p>`;
  const need = [...new Set(codes.map(c => c.slice(0, 2)))].filter(k => !W.tdcc?.[k]);
  if (need.length && !W.tdccShardBusy && typeof tdccShard === "function") {
    W.tdccShardBusy = true;
    Promise.all(need.map(tdccShard)).finally(() => { W.tdccShardBusy = false; if (W.lt === "cong" && W.cv === "fol") renderList(); });
  }
  const rows = codes.map(c => {
    const hist = W.tdcc?.[c.slice(0, 2)]?.[c];
    if (!hist || !hist.length) return null;
    const cur = hist[hist.length - 1], prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    const chg = prev ? +(cur[1] - prev[1]).toFixed(2) : 0;
    return { c, chg, b1k: cur[1], r50: cur[3], ppl: cur[4], d: cur[0] };
  }).filter(Boolean);
  if (!rows.length) return `<p class="note">${need.length ? "載入自選股集保股權分散資料中…" : "沒有集保股權分散紀錄。"}</p>`;
  rows.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
  return rkList(rows.slice(0, 30).map(r => ({
    star: r.c,
    attr: `data-cv="tw:s:${esc(r.c)}"`,
    mono: "",
    name: `${esc(nameOf(r.c) !== r.c ? nameOf(r.c) : "")} ${esc(r.c)}`,
    sub: `千張大戶 ${r.b1k.toFixed(2)}%・50 張以下散戶 ${r.r50 != null ? r.r50.toFixed(2) + "%" : "—"}・總股東 ${r.ppl?.toLocaleString() || "—"} 人`,
    val: `${r.chg > 0 ? "+" : ""}${r.chg.toFixed(2)}%`,
    vc: r.chg > 0 ? "up" : r.chg < 0 ? "down" : "",
    vsub: r.d ? `集保 ${r.d.slice(5).replace("-", "/")}` : ""
  })), "");
}

// ---------- 大戶共識 ----------
function cxConsHtml() {
  if (!W.cong) loadCong(); if (!W.f13) f13Load(); if (!W.two) twoLoad(); if (!W.ins) insLoad();
  const reg = W.cxReg === "tw" ? "tw" : "us", seg = rkSeg("data-rkset", "cxReg:" + reg, [["cxReg:us", "美股：國會＋13F"], ["cxReg:tw", "台股：政治人物＋內部人"]]), R = cxPer("cons"), wTxt = cxWTxt("cons");
  let body = "";
  if (reg === "us") {
    if (!W.cong?.trades || !W.f13?.funds) body = `<p class="note">載入國會與 13F 資料中…</p>`;
    else {
      const M = new Map(), g = tk => M.get(tk) || M.set(tk, { tk, asset: "", buy: new Set(), sell: new Set(), up: [], dn: [] }).get(tk);
      for (const t of W.cong.trades) if (t.assetType === "股票" && cxIn(t.traded, R) && /^[A-Z][A-Z.]{0,6}$/.test(t.ticker || "")) { const x = g(t.ticker); x.asset ||= t.asset; if (t.k === "buy") x.buy.add(t.pid); else if (t.k === "sell") x.sell.add(t.pid); }
      for (const f of W.f13.funds) for (const r of [...f.rows, ...f.sold]) { if (!r.ticker || r.pc) continue; const x = g(r.ticker); x.asset ||= r.name; const who = f.who.split(" ")[0];
        if (r.chg === "new" || r.chg === "add") x.up.push(who); else if (r.chg === "cut" || r.chg === "sold" || f.sold.includes(r)) x.dn.push(who); }
      const L = [...M.values()].map(x => ({ ...x, sc: x.buy.size * 2 + x.up.length - x.sell.size - x.dn.length })).filter(x => x.buy.size && x.up.length).sort((a, b) => b.sc - a.sc || b.buy.size - a.buy.size).slice(0, 40);
      body = `<h4>議員在買、機構也在加碼（分數＝議員買進人數 ×2 ＋ 加碼機構 − 賣出議員 − 減碼機構）</h4>` + rkList(L.map(x => ({ star: x.tk, attr: `data-cv="stock:${esc(x.tk)}"`, mono: "", name: esc(x.tk), sub: esc(x.asset || ""),
        val: `${x.sc > 0 ? "+" : ""}${x.sc} 分`, vc: cls(x.sc), vsub: `<span class="up">議員買 ${x.buy.size}</span>${x.sell.size ? `／<span class="down">賣 ${x.sell.size}</span>` : ""}・<span class="up">機構加碼 ${x.up.length}</span>${x.dn.length ? `／<span class="down">減碼 ${x.dn.length}</span>` : ""}` })), "目前沒有兩邊同時在買的股票")
        + `<p class="note">議員買進看${wTxt}（交易日）；機構動向是上一季 13F（季底後 45 天才公開）。兩邊時間點不同，只能當研究起點。</p>`;
    }
  } else {
    if (!W.two?.decl || !W.ins) body = `<p class="note">載入台灣政治人物與內部人資料中…</p>`;
    else {
      const M = new Map(), g = (c, n) => M.get(c) || M.set(c, { c, n, ppl: new Set(), add: 0, cut: 0, ins: 0, insSh: 0 }).get(c);
      for (const p of twoPeople()) { for (const h of p.hold) if (h.code) g(h.code, h.name).ppl.add(p.pid); for (const x of p.chg) if (x.code) { if (x.t === "new" || x.t === "add") g(x.code, x.name).add++; else g(x.code, x.name).cut++; } }
      for (const r of W.ins.rows || []) if (cxIn(r.d, R) && M.has(r.code)) { const x = M.get(r.code); x.ins++; x.insSh += r.sh || 0; }
      const L = [...M.values()].map(x => ({ ...x, sc: x.ppl.size + x.add - x.cut - x.ins * 2 })).filter(x => x.ppl.size >= 2).sort((a, b) => b.sc - a.sc || b.ppl.size - a.ppl.size).slice(0, 40);
      const need = [...new Set(L.map(x => x.c.slice(0, 2)))].filter(k => !W.tdcc?.[k]);
      if (need.length && !W.tdccShardBusy && typeof tdccShard === "function") {
        W.tdccShardBusy = true;
        Promise.all(need.map(tdccShard)).finally(() => { W.tdccShardBusy = false; if (W.lt === "cong" && W.cv === "cons") renderList(); });
      }
      body = `<h4>多位政治人物持有、內部人沒有在賣（分數＝持有人數 ＋ 增持 − 減持 − 內部人轉讓 ×2）</h4>` + rkList(L.map(x => {
        const tchg = typeof tdccChg === "function" ? tdccChg(x.c) : null;
        const tdTxt = tchg != null ? `・千張大戶週 <b class="${cls(tchg)}">${tchg > 0 ? "+" : ""}${tchg}%</b>` : "";
        return { star: x.c, attr: `data-cv="tw:s:${esc(x.c)}"`, mono: "", name: `${esc(nameOf(x.c) !== x.c ? nameOf(x.c) : x.n || "")} ${esc(x.c)}`,
          sub: `${x.ppl.size} 位持有${x.add ? `・增持 ${x.add}` : ""}${x.cut ? `・減持 ${x.cut}` : ""}`, val: `${x.sc > 0 ? "+" : ""}${x.sc} 分`, vc: cls(x.sc),
          vsub: (x.ins ? `<span class="down">內部人${wTxt}申報轉讓 ${x.ins} 筆・${Math.round(x.insSh / 1000).toLocaleString()} 張</span>` : `內部人${wTxt}沒有申報轉讓`) + tdTxt };
      }), "沒有資料")
        + `<p class="note">政治人物持股來自最近一次財產申報（可能是一兩年前）；內部人轉讓是事前申報，不一定真的賣出；千張大戶為每週集保變化。</p>`;
    }
  }
  return `<section class="csec tw-home">${rkHead("大戶共識榜", "把不同來源的大戶動向疊在一起：同一檔股票有越多種大戶站在同一邊，分數越高。只是整理公開申報，不是買賣建議。")}${cxRow("市場", seg)}${cxPerRow("cons")}${body}</section>`;
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
  const f = e.target.closest("[data-cxfol]"); if (f) { const [k, id] = f.dataset.cxfol.split(/:(.*)/s); cxToggle(k, id, f.dataset.cxname); if (k === "ins") return renderList(); f.setAttribute("aria-pressed", cxHas(k, id)); f.textContent = cxHas(k, id) ? "★ 追蹤中" : "☆ 追蹤"; return; }
  const r = e.target.closest("[data-cxread]"); if (r) { const S = cxSeen(); S[r.dataset.cxread] = new Date().toISOString().slice(0, 10); store.set("watch:folSeen", S); }
});
{ const css = document.createElement("style"); css.textContent = `.cxbar { display: grid; gap: 6px; margin: 8px 0; } .cxbar > .btn { justify-self: start; } .cxwin h4 { margin: 8px 0 4px; } .cxwin td b { display: block; font-weight: 500; } .cxwin td small { display: block; font-size: 11px; white-space: nowrap; }
.cx-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; min-width: 0; } .cx-lab { flex: none; width: 2.6em; font-size: 12.5px; color: var(--muted); }
.cx-body { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; } .cx-body > .seg { max-width: 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; } .cx-body > .seg::-webkit-scrollbar { display: none; }
.cx-body > .seg button { flex: none; } .cx-q { flex: 1 1 160px; min-width: 0; } .cx-body .cxrng { margin: 0; } .cx-how { margin: 6px 0 0; }
.cxheat td, .cxheat th { text-align: center; white-space: nowrap; } .cxheat td:first-child, .cxheat th:first-child { text-align: left; } .cxheat td:last-child { text-align: left; }`; document.head.appendChild(css); }

// ---------- 自訂區間（國會、內部人、台灣政治人物）與 13F 季度區間 ----------
// 區間存在 watch:cxRng（{ cong: { from, to }, ins: …, tw: … }）；日期是 YYYY-MM-DD，空的代表不限
const cxRng = k => (W.cxRng ||= store.get("watch:cxRng", {}))[k] || {};
const cxIn = (d, r) => !!d && (!r.from || d >= r.from) && (!r.to || d <= r.to);
const cxRngTxt = r => (r.from || r.to ? `${(r.from || "最早").replace(/-/g, "/")}～${(r.to || "最新").replace(/-/g, "/")}` : "全部期間");
const cxRngHtml = (k, on, lab = "自訂區間") => { const r = cxRng(k);
  return `<div class="cxrng${on ? " on" : ""}"><span class="note">${lab}</span><input type="date" data-cxrng="${k}:from" value="${esc(r.from || "")}" aria-label="開始日期"><span class="note">～</span><input type="date" data-cxrng="${k}:to" value="${esc(r.to || "")}" aria-label="結束日期">${r.from || r.to ? `<button type="button" class="linkbtn" data-cxrngx="${k}">清除</button>` : ""}</div>`; };
// 設定區間後切到「自訂」（國會 W.cw、內部人 W.insW、台灣政治人物 W.twoW 都設成 -1）
function cxRngSet(k, f, v) {
  const R = (W.cxRng ||= store.get("watch:cxRng", {})); R[k] = { ...(R[k] || {}), [f]: v || "" }; if (!R[k].from && !R[k].to) delete R[k]; store.set("watch:cxRng", R);
  if (CX_WKEY[k]) { W[CX_WKEY[k]] = -1; store.set("watch:" + CX_WKEY[k], -1); }
  W.twoP = null; renderList();
}
document.addEventListener("change", e => { const t = e.target.closest?.("[data-cxrng]"); if (!t) return; const [k, f] = t.dataset.cxrng.split(":"); cxRngSet(k, f, t.value); });
document.addEventListener("click", e => { const b = e.target.closest("[data-cxrngx]"); if (!b) return; const R = (W.cxRng ||= {}); delete R[b.dataset.cxrngx]; store.set("watch:cxRng", R); cxRngSet(b.dataset.cxrngx, "from", ""); });

// ---------- 四個分類（美國國會、13F、台灣政治人物、內部人）共用的操作列 ----------
// 每一類都一樣：① 期間（同一組選項，自訂才出現日期）② 篩選＋搜尋（打字就篩）③ 重點數字 ④ 看什麼（名稱、順序一致：各自的排行 → 最新申報 → 主題熱圖 → 申報延遲 → 申報後回測）
const CX_PER = [["30", "近 30 天"], ["90", "近 90 天"], ["180", "半年"], ["365", "一年"], ["730", "兩年"], ["1095", "三年"], ["0", "全部"], ["-1", "自訂"]];
// 國會、內部人、台灣政治人物、大戶共識、我的追蹤各記各的期間；台灣政治人物一年才申報一兩次，預設看全部
const CX_WKEY = { cong: "cw", ins: "insW", tw: "twoW", cons: "consW", fol: "folW" }, CX_WDEF = { cong: 30, ins: 30, tw: 0, cons: 90, fol: 30 };
const cxW = k => { const v = W[CX_WKEY[k]]; return v != null && v !== "" && CX_PER.some(p => +p[0] === +v) ? +v : CX_WDEF[k]; };
// 目前期間換成日期區間 { from, to }（空的代表不限）
const cxPer = k => { const w = cxW(k); return w === -1 ? cxRng(k) : w > 0 ? { from: new Date(Date.now() - w * 864e5).toISOString().slice(0, 10) } : {}; };
const cxWTxt = k => { const w = cxW(k); return w === -1 ? cxRngTxt(cxRng(k)) : w ? CX_PER.find(p => +p[0] === w)[1] : "全部期間"; };
const cxRow = (lab, body) => (body ? `<div class="cx-row"><span class="cx-lab">${lab}</span><div class="cx-body">${body}</div></div>` : "");
// 期間列：k 是 cong／ins／tw／cons／fol；13F 傳 per（季度選單）。國會、內部人期間比主檔早時，後面接「更早的資料」（cxMoreHtml）
const cxPerRow = (k, per) => cxRow("期間", per ?? `${rkSeg("data-cxw", `${k}:${cxW(k)}`, CX_PER.map(([v, t]) => [`${k}:${v}`, t]))}${cxW(k) === -1 ? cxRngHtml(k, true, "從") : ""}${cxMoreHtml(k)}`);
// 搜尋框：key 是存關鍵字的 W 欄位
const cxQ = (key, ph) => `<input class="cx-q" type="search" data-cxq="${key}" value="${esc(W[key] || "")}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
const cxTabs = (key, cur, opts) => cxRow("看", rkSeg("data-rkset", `${key}:${cur}`, opts.map(([v, t]) => [`${key}:${v}`, t])));
document.addEventListener("click", e => { const b = e.target.closest("[data-cxw]"); if (!b) return; const [k, v] = b.dataset.cxw.split(":"); W[CX_WKEY[k]] = +v; store.set("watch:" + CX_WKEY[k], +v); W.twoP = null; renderList(); });
// 搜尋：打字停 0.35 秒就篩，重畫後游標留在框裡
document.addEventListener("input", e => { const t = e.target.closest?.("[data-cxq]"); if (!t) return; clearTimeout(W.cxqT);
  W.cxqT = setTimeout(() => { const k = t.dataset.cxq; W[k] = t.value.trim(); renderList(); const n = document.querySelector(`[data-cxq="${k}"]`); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 350); });

// 13F：選兩個季度（起～迄），用 data/f13-hist.json 重算「迄」那一季的持股和相對「起」的變動，首頁各排行都改看這個區間
const cxQs = () => [...new Set([...(W.f13?.funds || []).map(f => f.period), ...Object.values(W.f13H || {}).flatMap(h => (h.periods || []).map(p => p.period))])].sort().reverse();
function cxF13Range(F) {
  f13HLoad();
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
  return `<div class="cxrng${Q.to || Q.from ? " on" : ""}"><span class="note">從</span>${sel("from", from, qs.filter(q => q < to))}<span class="note">→</span>${sel("to", to, qs)}${Q.to || Q.from ? `<button type="button" class="linkbtn" data-f13rx>回到最新一季</button>` : ""}</div>`; };
document.addEventListener("change", e => { const s = e.target.closest?.("[data-f13r]"); if (!s) return; W.f13R = { ...(W.f13R || {}), [s.dataset.f13r]: s.value }; renderList(); });
document.addEventListener("click", e => { if (e.target.closest("[data-f13rx]")) { W.f13R = null; renderList(); } });
{ const css = document.createElement("style"); css.textContent = `.cxrng { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0; } .cxrng input, .cxrng select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-2); color: var(--ink); min-width: 0; max-width: 150px; }
.cxrng.on input, .cxrng.on select { border-color: var(--ink); } .cxrng input[type="date"] { width: 8.6em; padding: 4px; }`; document.head.appendChild(css); }

// ---------- 每一種大戶都有：追蹤、熱圖、申報延遲（補齊美國國會、13F、台灣政治人物、內部人之間缺的功能） ----------
// 代號 → 產業主題（產業地圖裡的分類；美股、台股各一份），對不到的歸「其他」
const cxCat = mk => { const M = new Map(); for (const t of (typeof IND !== "undefined" ? IND.themes : [])) if (t.mk === mk) for (const s of t.segs || []) for (const [c] of s.c || []) if (!M.has(c)) M.set(c, t.cat || t.name); return c => M.get(c) || "其他／未分類"; };
// 熱圖表格：cols＝[[鍵, 標題, 正向?]]，rows＝[{ k, v: {鍵: 數字}, tk: Map(代號→分數) }]
function cxHeatTable(title, note, cols, rows, openAttr) {
  const mx = Object.fromEntries(cols.map(([c]) => [c, Math.max(1, ...rows.map(r => r.v[c] || 0))]));
  const cell = (c, v, up) => `<td style="background:color-mix(in srgb, var(${up ? "--up" : "--down"}) ${Math.round(((v || 0) / mx[c]) * 60)}%, transparent)">${v ? (v >= 1e4 ? Math.round(v / 1e3).toLocaleString() + "K" : Math.round(v).toLocaleString()) : ""}</td>`;
  return `<h4>${title}</h4><div class="cotbl-wrap"><table class="tbl cxheat"><thead><tr><th>主題</th>${cols.map(([, t]) => `<th>${t}</th>`).join("")}<th>代表股</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.k)}</td>${cols.map(([c, , up]) => cell(c, r.v[c], up)).join("")}<td>${[...r.tk].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([t, v]) => `<button class="linkbtn" ${openAttr(t)}><span class="${cls(v)}">${esc(nameOf(t) !== t ? nameOf(t) : t)}</span></button>`).join(" ")}</td></tr>`).join("") || `<tr><td colspan="${cols.length + 2}" class="note">沒有資料</td></tr>`}</tbody></table></div><p class="note">${note}</p>`;
}
const cxRows = (M, key) => [...M.values()].sort((a, b) => (a.k === "其他／未分類") - (b.k === "其他／未分類") || key(b) - key(a));
// 美國國會：期間內每個主題有幾位議員買、賣，金額（估）
function cxCongHeat(trades) {
  const cat = cxCat("us"), M = new Map();
  for (const t of trades) { if (t.assetType !== "股票" || !t.ticker) continue; const k = cat(t.ticker), g = M.get(k) || M.set(k, { k, v: { b: 0, s: 0, ba: 0, sa: 0 }, tk: new Map(), pb: new Set(), ps: new Set() }).get(k), m = amtMid(t.amount);
    if (t.k === "buy") { g.pb.add(t.pid); g.v.ba += m; } else if (t.k === "sell") { g.ps.add(t.pid); g.v.sa += m; } g.v.b = g.pb.size; g.v.s = g.ps.size; g.tk.set(t.ticker, (g.tk.get(t.ticker) || 0) + (t.k === "buy" ? 1 : -1)); }
  return cxHeatTable("主題熱圖：這段期間議員在各產業主題買、賣", "人數＝不同的議員（同一人買很多次算 1 人）；金額用申報區間中間值估算。主題用產業地圖裡的美股分類。", [["b", "買進人數", 1], ["s", "賣出人數", 0], ["ba", "買進金額 $", 1], ["sa", "賣出金額 $", 0]], cxRows(M, r => r.v.b - r.v.s), t => `data-cv="stock:${esc(t)}"`);
}
// 台灣政治人物：各產業主題有幾位持有、最近一次申報的新進／增持／減持／出清
function cxTwHeat() {
  if (!W.two?.decl) return ""; const cat = cxCat("tw"), M = new Map(), g = c => { const k = cat(c); return M.get(k) || M.set(k, { k, v: { n: 0, new: 0, add: 0, cut: 0, sold: 0 }, tk: new Map(), ppl: new Set() }).get(k); };
  for (const p of twoPeople()) { for (const h of p.hold) if (h.code) { const x = g(h.code); x.ppl.add(p.pid); x.v.n = x.ppl.size; x.tk.set(h.code, (x.tk.get(h.code) || 0) + 1); } for (const c of p.chg) if (c.code) g(c.code).v[c.t]++; }
  return cxHeatTable("主題熱圖：政治人物持股集中在哪些產業", "持有人數＝申報持有這個主題股票的人數；新進、增持、減持、出清是和自己前一次申報比。只算有台股代號的持股。", [["n", "持有人數", 1], ["new", "新進", 1], ["add", "增持", 1], ["cut", "減持", 0], ["sold", "出清", 0]], cxRows(M, r => r.v.n), t => `data-cv="tw:s:${esc(t)}"`);
}
// 內部人：各產業主題申報轉讓幾筆、幾張（一般交易＝可能在市場賣出）
function cxInsHeat(rows) {
  const cat = cxCat("tw"), M = new Map(), mkt = r => /一般交易|盤後|鉅額|拍賣/.test(r.how);
  for (const r of rows) { const k = cat(r.code), g = M.get(k) || M.set(k, { k, v: { n: 0, sh: 0, mk: 0 }, tk: new Map() }).get(k); g.v.n++; g.v.sh += (r.sh || 0) / 1000; if (mkt(r)) g.v.mk += (r.sh || 0) / 1000; g.tk.set(r.code, (g.tk.get(r.code) || 0) - (r.sh || 0)); }
  return cxHeatTable("主題熱圖：內部人在哪些產業申報轉讓", "張數＝申報轉讓的股數 ÷ 1000；「市場賣出」是一般交易、盤後、鉅額、拍賣這類可能在市場賣掉的方式，贈與、信託不算。", [["n", "申報筆數", 0], ["sh", "轉讓張數", 0], ["mk", "市場賣出張數", 0]], cxRows(M, r => r.v.sh), t => `data-cv="tw:s:${esc(t)}"`);
}
// 集保千張大戶：各產業主題大戶是增持還是減持（T＝{ up, down } 排行，lab＝期間名稱）
function cxTdccHeat(T, lab = "本週") {
  const cat = cxCat("tw"), M = new Map(), add = (r, k0) => { const k = cat(r[0]), g = M.get(k) || M.set(k, { k, v: { up: 0, dn: 0, chg: 0 }, tk: new Map() }).get(k); g.v[k0]++; g.v.chg += +r[1]; g.tk.set(r[0], (g.tk.get(r[0]) || 0) + +r[1]); };
  for (const r of T?.up || []) add(r, "up"); for (const r of T?.down || []) add(r, "dn");
  return cxHeatTable(`主題熱圖：各產業千張大戶${lab}增減動向`, "依集保結算所千張大戶增減排行統計；千張% 變動合計為各主題前 50 大增減檔數的持股百分點加總。", [["up", "大戶增持檔數", 1], ["dn", "大戶減持檔數", 0], ["chg", "千張% 變動合計", 1]], cxRows(M, r => r.v.up - r.v.dn || r.v.chg), t => `data-cv="tw:s:${esc(t)}"`);
}
// 13F：季底到申報日隔幾天（法規 45 天內）
function cxF13Lag(F) {
  const L = F.funds.map(f => ({ f, d: congDays(f.period, f.filed) })).filter(x => x.d >= 0).sort((a, b) => b.d - a.d), A = L.map(x => x.d).sort((a, b) => a - b);
  return `<h4>申報延遲：季底到公開隔幾天</h4><p class="note">13F 規定季底後 45 天內申報；越晚申報，看到的持股越舊。這一季中位數 ${A[A.length >> 1] ?? "—"} 天。</p>`
    + rkList(L.map(x => ({ attr: `data-cv="f13:${esc(x.f.cik)}"`, mono: "", name: esc(x.f.who), sub: `${x.f.period} 季底・${x.f.filed} 申報`, val: `${x.d} 天`, vc: x.d > 45 ? "down" : x.d <= 20 ? "up" : "" })), "沒有資料");
}
// 台灣政治人物：申報日到刊登在廉政專刊隔幾天
function cxTwLag() {
  const X = W.two; if (!X?.decl) return ""; const iss = new Map((X.issues || []).map(i => [i.no, i.date]));
  const L = X.decl.map(d => ({ d, lag: iss.get(d.issue) ? congDays(d.date, iss.get(d.issue)) : null })).filter(x => x.lag != null && x.lag >= 0), A = L.map(x => x.lag).sort((a, b) => a - b); if (!A.length) return "";
  return `<h4>申報延遲：申報日到刊登在廉政專刊</h4><p class="note">財產申報要等監察院刊登在廉政專刊才公開。全部 ${A.length} 份申報，中位數隔 ${A[A.length >> 1]} 天、最久 ${A.at(-1)} 天；看到的持股是申報日當時的，不是現在的。</p>`;
}
// 內部人：追蹤公司（自選、庫存之外也想追的）
function cxInsFolHtml() {
  const F = cxFol().ins || {};
  return `<div class="cxinsf"><span class="note">追蹤公司的內部人申報</span>${Object.entries(F).map(([c, n]) => `<button type="button" class="ichip" data-cxfol="ins:${esc(c)}" data-cxname="${esc(n)}" aria-pressed="true">★ ${esc(n !== c ? n : nameOf(c))} ${esc(c)}</button>`).join("")}<form data-cxinsadd><input name="c" placeholder="代號" inputmode="numeric" aria-label="追蹤公司代號"><button class="btn sm">☆ 追蹤</button></form></div>`;
}
document.addEventListener("submit", e => { const f = e.target.closest?.("[data-cxinsadd]"); if (!f) return; e.preventDefault(); const c = String(f.c.value || "").trim().toUpperCase(); if (!/^\d{4,6}[A-Z]?$/.test(c)) return toast("請填台股代號"); if (!cxHas("ins", c)) cxToggle("ins", c, nameOf(c)); renderList(); });
{ const css = document.createElement("style"); css.textContent = `.cxinsf { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; } .cxinsf form { display: flex; gap: 4px; } .cxinsf input { width: 6.5em; font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-2); color: var(--ink); }`; document.head.appendChild(css); }

// ---------- 集保千張大戶（大戶國會「千張大戶」分頁） ----------
// 期間：本週、4／13／26／52 週用排程先算好的排行（data/tdcc/rank.json 的 per），自訂兩個週次就讀全部分片現算
const CX_TDCCP = [["1", "本週"], ["4", "4 週"], ["13", "13 週"], ["26", "半年"], ["52", "一年"], ["-1", "自訂"]];
const cxTdccP = () => { const v = +(W.tdccP ?? store.get("watch:tdccP", 1)); return CX_TDCCP.some(p => +p[0] === v) ? v : 1; };
// 一檔在 from～to 之間千張大戶的變化：[代號, 千張變化, 千張%, 50 張以下變化, 總人數變化]；起點離 from 超過 10 天（資料不夠早）就不算
function cxTdPair(c, a, from, to) {
  if (!a?.length) return null; const q = [...a].reverse().find(r => !to || r[0] <= to), p = a.find(r => r[0] >= from);
  if (!p || !q || p[0] >= q[0] || Date.parse(p[0]) - Date.parse(from) > 10 * 864e5) return null;
  return [c, +(q[1] - p[1]).toFixed(2), q[1], +(q[3] - p[3]).toFixed(2), p[4] > 0 && q[4] > 0 ? q[4] - p[4] : null]; // 舊週次沒有總人數就不算人數變化
}
async function cxTdccAll(T) {
  if (W.tdccAll) return; W.tdccAll = "busy"; renderList();
  await Promise.all((T.shards || []).map(k => tdccShard(k).catch(() => {}))); W.tdccAll = "ok"; if (W.lt === "cong" && W.cv === "tdcc") renderList();
}
const cxTdSel = (f, cur, L) => `<select data-tdccd="${f}" aria-label="${f === "from" ? "起始週" : "結束週"}">${L.map(d => `<option value="${d}" ${d === cur ? "selected" : ""}>${d.replace(/-/g, "/")}</option>`).join("")}</select>`;
document.addEventListener("change", e => { const s = e.target.closest?.("[data-tdccd]"); if (!s) return; W.tdccD = { ...(W.tdccD || {}), [s.dataset.tdccd]: s.value }; renderList(); });
function cxTdccHtml() {
  if (!W.tdccR) {
    if (typeof tdccRank === "function") tdccRank().then(() => { if (W.lt === "cong" && W.cv === "tdcc") renderList(); });
    return `<section class="csec tw-home"><p class="note" style="padding:16px">載入集保股權分散表資料中…</p></section>`;
  }
  const T = W.tdccR;
  if (T.err) return `<section class="csec tw-home"><p class="note" style="padding:16px">⚠︎ ${esc(T.err)}</p></section>`;
  const scope = W.tdccScope === "mine" ? "mine" : "all", view = ["up", "down", "high", "heat"].includes(W.tdccV) ? W.tdccV : "up", q = (W.tdccQ || "").trim().toUpperCase();
  const n = cxTdccP(), dates = T.dates || [], dStr = T.date ? T.date.replace(/-/g, "/") : "最新一週";
  // 期間 → 起訖日與這段期間的排行（{ up, down }）
  let from = "", to = T.date || "", set = null, perNote = "";
  if (n === -1) {
    const D = W.tdccD || {}; to = dates.includes(D.to) ? D.to : dates[0] || T.date; from = dates.includes(D.from) && D.from < to ? D.from : dates[dates.indexOf(to) + 1] || "";
    if (!from) perNote = "集保資料還不到兩週，沒辦法選區間。";
    else if (scope === "all") { if (W.tdccAll !== "ok") { cxTdccAll(T); perNote = `讀取全部股票的週資料中（${(T.shards || []).length} 個檔案）…`; }
      else { const L = Object.values(W.tdcc || {}).flatMap(o => Object.entries(o)).filter(([, a]) => a?.at(-1)?.[4] >= 100).map(([c, a]) => cxTdPair(c, a, from, to)).filter(Boolean).sort((x, y) => y[1] - x[1]); set = { up: L.slice(0, 50), down: L.slice(-50).reverse(), n: L.length }; } }
  } else if (n === 1) set = T;
  else { set = T.per?.[n] || null; from = set?.from || new Date(Date.parse(T.date) - n * 7 * 864e5).toISOString().slice(0, 10);
    if (!set) perNote = `要累積到 ${n} 週前的資料才排得出來：目前資料從 ${(dates.at(-1) || T.date || "").replace(/-/g, "/")} 起（排程每週累積，也會向集保網站補最近一年），先看本週。`; }
  if (n !== 1 && n !== -1 && !set) set = T;
  const pTxt = n === 1 || (!T.per?.[n] && n !== -1) ? "本週" : n === -1 ? "區間" : `${n} 週`, pW = pTxt === "本週" ? "週" : ` ${pTxt}`;
  const per = cxRow("期間", `${rkSeg("data-rkset", `tdccP:${n}`, CX_TDCCP.map(([v, t]) => [`tdccP:${v}`, t]))}${n === -1 && dates.length >= 2 ? `<div class="cxrng on"><span class="note">從</span>${cxTdSel("from", from, dates.filter(d => d < to))}<span class="note">→</span>${cxTdSel("to", to, dates)}</div>` : ""}<span class="note">每週五更新・最新 ${dStr}${from && set !== T ? `・比較 ${from.replace(/-/g, "/")} → ${to.replace(/-/g, "/")}` : ""}</span>`);
  // 自選＋庫存：用各自的分片算同一段期間
  let mineRows = null;
  if (scope === "mine") {
    const mineCodes = [...new Set([...myCodes(), ...Object.keys(W.hold || {})])].filter(c => typeof isTW === "function" ? isTW(c) : /^\d{4,6}[A-Z]?$/.test(c));
    const need = [...new Set(mineCodes.map(c => c.slice(0, 2)))].filter(k => !W.tdcc?.[k]);
    if (need.length && !W.tdccShardBusy && typeof tdccShard === "function") { W.tdccShardBusy = true; Promise.all(need.map(tdccShard)).finally(() => { W.tdccShardBusy = false; if (W.lt === "cong" && W.cv === "tdcc") renderList(); }); }
    const f0 = from || (T.date ? new Date(Date.parse(T.date) - 7 * 864e5 - 3 * 864e5).toISOString().slice(0, 10) : "");
    mineRows = mineCodes.map(c => { const a = W.tdcc?.[c.slice(0, 2)]?.[c]; if (!a?.length) return null; if (pTxt === "本週") { const cur = a.at(-1), prev = a.at(-2); return [c, prev ? +(cur[1] - prev[1]).toFixed(2) : 0, cur[1], prev ? +(cur[3] - prev[3]).toFixed(2) : 0, prev?.[4] > 0 && cur[4] > 0 ? cur[4] - prev[4] : null]; } return cxTdPair(c, a, f0, to); }).filter(Boolean);
  }
  let activeList = [];
  if (scope === "mine") { activeList = (mineRows || []).slice(); if (view === "down") activeList.sort((a, b) => a[1] - b[1]); else if (view === "high") activeList.sort((a, b) => b[2] - a[2]); else activeList.sort((a, b) => b[1] - a[1]); }
  else if (set) { if (view === "up") activeList = (set.up || []).slice(); else if (view === "down") activeList = (set.down || []).slice(); else if (view === "high") { const map = new Map(); for (const r of [...(set.up || []), ...(set.down || [])]) map.set(r[0], r); activeList = [...map.values()].sort((a, b) => b[2] - a[2]); } }
  if (q) activeList = activeList.filter(r => r[0].startsWith(q) || (nameOf(r[0]) || "").toUpperCase().includes(q));
  // 輸入完整代號：直接帶去那檔的台股個股頁（千張大戶走勢、內部人、政治人物）
  const one = /^\d{4,6}[A-Z]?$/.test(q) ? `<p><button class="btn sm" data-cv="tw:s:${esc(q)}">看 ${esc(nameOf(q) !== q ? nameOf(q) + " " : "")}${esc(q)} 的大戶全貌（每週走勢、內部人、政治人物）›</button></p>` : "";
  const S = set || {}, upTop = S.up?.[0], dnTop = S.down?.[0];
  const cards = rkCards([
    { t: "集保統計日", sub: set && set !== T && from ? `${from.replace(/-/g, "/")} 起比較` : "每週五收盤後公布", v: dStr },
    { t: "統計上市櫃標的", sub: scope === "mine" ? "自選與庫存" : "集保結算所全市場", v: scope === "mine" ? `${mineRows ? mineRows.length : 0} 檔` : `${S.n || T.n || 3000}+ 檔` },
    { t: `${pTxt}大戶增持冠軍`, sub: upTop ? `${nameOf(upTop[0])} ${upTop[0]}` : "全市場", v: upTop ? `+${upTop[1]}%` : "—", vc: "up", attr: upTop ? `data-cv="tw:s:${esc(upTop[0])}"` : "" },
    { t: "散戶大增/大戶減持", sub: dnTop ? `${nameOf(dnTop[0])} ${dnTop[0]}` : "全市場", v: dnTop ? `${dnTop[1]}%` : "—", vc: "down", attr: dnTop ? `data-cv="tw:s:${esc(dnTop[0])}"` : "" }
  ]);
  const mkItem = r => {
    const c = r[0], chg = +r[1], b1k = +r[2], r50 = +r[3], ppl = r[4] == null ? null : +r[4], nm = nameOf(c) !== c ? nameOf(c) : "";
    const focus = chg > 0 && r50 < 0 ? `<span class="up">籌碼集中（大戶增、散戶退）</span>` : chg < 0 && r50 > 0 ? `<span class="down">籌碼渙散（大戶退、散戶接）</span>` : "";
    return { star: c, attr: `data-cv="tw:s:${esc(c)}"`, mono: rkMono(rkInit(nm || c), chg > 0 ? "#3fa36b" : "#d0643f"), name: `${esc(nm)} <span class="note">${esc(c)}</span>`,
      sub: `千張大戶 ${b1k.toFixed(2)}%・50 張以下散戶${pW} ${r50 > 0 ? "+" : ""}${r50.toFixed(2)}%${ppl == null ? "" : `・總股東人數 ${ppl > 0 ? "+" : ""}${ppl.toLocaleString()} 人`}`,
      val: `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`, vc: chg > 0 ? "up" : chg < 0 ? "down" : "", vsub: focus || (b1k >= 70 ? `<span class="up">千張佔比 > 70%</span>` : "") };
  };
  const titles = { up: `千張大戶持股比例${pW}增加最多（前 50 大）`, down: `千張大戶持股比例${pW}減少最多（前 50 大，散戶接刀）`, high: "千張大戶高度集中持股（千張比例最高排行）" };
  const listHtml = !set && scope === "all" ? "" : view === "heat" ? cxTdccHeat(scope === "mine" ? { up: activeList.filter(r => r[1] > 0), down: activeList.filter(r => r[1] < 0) } : S, pTxt) : `<h4>${titles[view]}</h4>` + rkList(activeList.slice(0, 50).map(mkItem), scope === "mine" ? "自選與庫存中沒有符合的標的" : "沒有符合的股票");
  return `<section class="csec tw-home">
    ${rkHead("集保千張大戶每週動向", `臺灣集中保管結算所（TDCC）每週公布「股權分散表」。統計持有 1,000 張以上的「千張大戶」與 50 張以下「散戶」比例的變化（百分點）；大戶比例上升且散戶人數下降，代表籌碼流向少數主力手中。點股票看那一檔每週走勢、內部人申報、政治人物持股。`)}
    ${per}${perNote ? `<p class="note">${perNote}</p>` : ""}
    ${cxRow("篩選", `<div class="tw-grp seg" role="group">${[["all", "全部"], ["mine", "自選＋庫存"]].map(([k, t]) => `<button type="button" data-rkset="tdccScope:${k}" aria-pressed="${scope === k}">${t}</button>`).join("")}</div>${cxQ("tdccQ", "搜尋代號或名稱")}`)}
    ${cards}${one}
    ${cxTabs("tdccV", view, [["up", "大戶增持榜"], ["down", "大戶減持榜"], ["high", "高度集中"], ["heat", "主題熱圖"]])}
    ${listHtml}
    <p class="note">資料來源：臺灣集中保管結算所（TDCC）集保戶股權分散表開放資料 1-5（排程每週累積，保留約 3 年；更早的週次向集保網站補，網站只保留最近一年）。變化為持股比例的百分點差額，僅供籌碼集中度分析參考，不構成買賣建議。</p>
  </section>`;
}

// ---------- 更早的資料：美國國會、內部人的年份檔 ----------
// 主檔（data/congress.json、data/insider.json）只放最近一段；選的期間比主檔早時，讀排程整理的年份檔（scripts/congress.mjs --year）併進來。
// 年份清單在 data/<資料夾>/index.json：{ years: { 2025: { n, from, to, done } } }；還沒整理的年份不會出現。
const CX_ARCH = {
  cong: { dir: "congress-arch", d: t => t.filed, key: t => [t.pid, t.ticker, t.k, t.traded, t.amount?.join("-"), t.owner, t.doc].join("|"), get: () => W.cong, list: o => o.trades },
  ins: { dir: "insider-arch", d: r => r.d, key: r => [r.d, r.code, r.who, r.sh, r.how].join("|"), get: () => W.ins, list: o => o.rows },
};
async function cxArchIdx(k) {
  const A = (W.cxArch ||= {}); if (A[k]) return A[k]; A[k] = { busy: true, years: {} };
  try { const r = await fetch(`data/${CX_ARCH[k].dir}/index.json`, { cache: "no-cache" }); A[k] = { years: r.ok ? (await r.json()).years || {} : {} }; } catch { A[k] = { years: {} }; }
  if (W.lt === "cong") renderList(); return A[k];
}
// 主檔本身從哪天開始（併進年份檔之前記下來）
const cxMainFrom = k => { const X = CX_ARCH[k], o = X.get(); if (!o || o.err) return null; return (o._from ??= (X.list(o) || []).reduce((m, t) => { const d = X.d(t); return d && d < m ? d : m; }, "9999")); };
const cxOldYears = k => { const I = W.cxArch?.[k], f0 = cxMainFrom(k); return I?.years && f0 ? Object.keys(I.years).filter(y => `${y}-01-01` < f0).sort().reverse() : []; };
async function cxArchGet(k, y) {
  const X = CX_ARCH[k], o = X.get(); if (!o || o.err) return; cxMainFrom(k); const got = (o._arch ||= {}); if (got[y] === "busy" || got[y] === "ok") return; got[y] = "busy";
  try { const r = await fetch(`data/${X.dir}/${y}.json`, { cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(), L = X.list(o), seen = new Set(L.map(X.key));
    for (const t of X.list(j) || []) { const kk = X.key(t); if (!seen.has(kk)) { seen.add(kk); L.push(t); } }
    if (k === "cong") { o.people = { ...(j.people || {}), ...(o.people || {}) }; L.sort((a, b) => b.filed.localeCompare(a.filed) || b.traded.localeCompare(a.traded)); } else L.sort((a, b) => b.d.localeCompare(a.d));
    got[y] = "ok"; } catch { got[y] = "err"; }
  if (W.lt === "cong") renderList();
}
// 選的期間用得到、還沒讀的年份自動讀
const cxAutoArch = (k, from) => { const o = CX_ARCH[k].get(); if (!o || o.err) return; if (!W.cxArch?.[k]) return void cxArchIdx(k); if (W.cxArch[k].busy) return; const got = o._arch || {}; cxOldYears(k).filter(y => !got[y] && (!from || `${y}-12-31` >= from)).forEach(y => cxArchGet(k, y)); };
// 期間列後面：主檔從哪天開始、更早的年份（讀過的打勾、沒讀的可以按）；大戶共識、我的追蹤只在背景讀用得到的年份
function cxMoreHtml(k) {
  if (k === "cons" || k === "fol") { const from = cxPer(k).from; for (const a of k === "cons" ? ["cong", "ins"] : ["ins"]) cxAutoArch(a, from); return ""; }
  const X = CX_ARCH[k], o = X?.get(); if (!X || !o || o.err || !X.list(o)?.length) return "";
  const from = cxPer(k).from; cxAutoArch(k, from); const I = W.cxArch?.[k]; if (!I || I.busy) return "";
  const f0 = cxMainFrom(k), got = o._arch || {}, ys = cxOldYears(k);
  const first = (X.list(o) || []).reduce((m, t) => { const d = X.d(t); return d && d < m ? d : m; }, "9999"), short = (!from || from < f0) && !ys.length;
  return `<span class="note cx-more">已載入 ${first.replace(/-/g, "/")} 起的申報${short ? "（更早的年份還在整理）" : ys.length ? "・更早：" : ""}</span>${ys.map(y => got[y] === "ok" ? `<span class="cx-yr" aria-pressed="true">${y} ✓</span>` : got[y] === "busy" ? `<span class="cx-yr">${y} 載入中…</span>` : `<button type="button" class="cx-yr" data-cxarch="${k}:${y}">${got[y] === "err" ? "重試 " : "＋"}${y}</button>`).join("")}`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-cxarch]"); if (!b) return; const [k, y] = b.dataset.cxarch.split(":"); cxArchGet(k, y); renderList(); });

// ---------- 查個股：台股到「台股個股」（政治人物持有＋內部人申報＋千張大戶），美股到國會個股頁（議員交易＋13F 機構） ----------
const cxIsTw = c => /^\d{4,6}[A-Z]?$/.test(c);
function cxGo(raw) {
  let c = String(raw || "").trim().toUpperCase(); if (!c) return;
  if (!cxIsTw(c) && !/^[A-Z][A-Z.\-]{0,6}$/.test(c)) { const n = String(raw).trim(), N = Object.entries(W.names || {}), hit = N.find(([, v]) => v === n) || N.find(([, v]) => String(v).includes(n)); if (!hit) return toast(`找不到「${n}」，請輸入代號`); c = hit[0]; }
  W.cv = cxIsTw(c) ? `tw:s:${c}` : `stock:${c}`; W.twoTab = "hold"; W.rkMore = ""; renderList(); goY(0); navPush();
}
// 國會分頁的工具列：內容沒變就不重畫（背景資料載入完重畫時，查個股框裡打到一半的字和游標才不會不見）
const cxSetTools = h => { const el = $("#lTools"); if (el._h === h && el.querySelector(".cx-go")) return; el.innerHTML = h; el._h = h; };
const cxGoHtml = () => `<form class="cx-go" data-cxgo role="search"><input name="q" type="search" placeholder="查個股：2330、NVDA" aria-label="查個股（台股、美股代號或名稱）" autocomplete="off" enterkeyhint="search"><button class="btn sm">查</button></form>`;
document.addEventListener("submit", e => { const f = e.target.closest?.("[data-cxgo]"); if (!f) return; e.preventDefault(); cxGo(f.q.value); });
// 大戶國會裡點到台股（千張大戶、大戶共識、我的追蹤、內部人、熱圖…）都先到台股個股頁，那裡再「在看盤開啟」
const cxOpenTw = c => { W.cv = `tw:s:${c}`; W.twoTab = "hold"; renderList(); goY(0); navPush(); };

// ---------- 美股個股頁（國會）：13F 機構這一季持有這檔的有哪些 ----------
function cxF13Of(T) {
  if (!W.f13) { f13Load(); return `<h4>13F 機構</h4><p class="note">載入中…</p>`; } if (W.f13.err) return "";
  const L = []; for (const f of W.f13.funds || []) { const r = f.rows.find(x => x.ticker === T && !x.pc), s = r ? null : f.sold.find(x => x.ticker === T && !x.pc); if (r || s) L.push({ f, r: r || s, chg: r ? r.chg : "sold" }); }
  if (!L.length) return `<h4>13F 機構</h4><p class="note">最新一季 13F 裡，追蹤的機構都沒有持有 ${esc(T)}。</p>`;
  L.sort((a, b) => (b.r.value || 0) - (a.r.value || 0));
  return `<h4>13F 機構：${L.filter(x => x.chg !== "sold").length} 家持有（${esc(L[0].f.period)} 季底）</h4>` + rkList(L.map(({ f, r, chg }) => ({ attr: `data-cv="f13:${esc(f.cik)}"`, mono: "", name: esc(f.who), sub: `${r.pct != null && chg !== "sold" ? `占組合 ${(+r.pct).toFixed(2)}%・` : ""}${(chg === "sold" ? r.psh || r.sh || 0 : r.sh || 0).toLocaleString()} 股`,
    val: chg === "sold" ? "—" : usd(Math.round(r.value || 0)), vc: F13_CHG[chg]?.[1] || "", vsub: F13_CHG[chg]?.[0] || "" })));
}

// ---------- 台股個股（大戶國會 tw:s:代號）：千張大戶走勢、內部人申報、政治人物持有 ----------
const CX_TDP = [["13", "一季"], ["26", "半年"], ["52", "一年"], ["104", "兩年"], ["156", "三年"], ["0", "全部"]];
const cxTdW = () => { const v = +(W.cxTdW ?? store.get("watch:cxTdW", 52)); return CX_TDP.some(p => +p[0] === v) ? v : 52; };
// 一檔的集保週資料：排程累積的（data/tdcc/<前兩碼>.json）＋集保網站補的更早週次（/api/tdcc，網站只留一年）
function cxTdHist(c) { const m = new Map(); for (const r of [...(W.tdccX?.[c]?.rows || []), ...(W.tdcc?.[c.slice(0, 2)]?.[c] || [])]) m.set(r[0], r); return [...m.values()].sort((a, b) => a[0].localeCompare(b[0])); }
async function cxTdMore(c, to) {
  const X = (W.tdccX ||= {}); if (X[c]) return; X[c] = { busy: true, rows: [] };
  try { const j = await getJ(`/api/tdcc?code=${encodeURIComponent(c)}${to ? `&to=${to}` : ""}`, true); X[c] = { rows: j.rows || [] }; } catch (e) { X[c] = { err: e.message, rows: [] }; }
  if (W.lt === "cong" && W.cv === "tw:s:" + c) renderList();
}
const cxTdLine = (H, j, col, lab) => { const P = H.filter(r => r[j] != null); if (P.length < 2) return ""; const v = P.map(r => r[j]), mn = Math.min(...v), mx = Math.max(...v), w = 600, h = 80, y = x => (h - 5 - (mx > mn ? (x - mn) / (mx - mn) : 0.5) * (h - 10)).toFixed(1);
  return `<figure class="cxtd-f"><figcaption><b>${lab}</b><span class="note">最新 ${v.at(-1).toFixed(2)}%・區間 ${mn.toFixed(2)}～${mx.toFixed(2)}%</span></figcaption><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${lab}每週走勢"><polyline fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${P.map((r, i) => `${(i / (P.length - 1) * w).toFixed(1)},${y(r[j])}`).join(" ")}"/></svg><div class="cxtd-x note"><span>${P[0][0].replace(/-/g, "/")}</span><span>${P.at(-1)[0].replace(/-/g, "/")}</span></div></figure>`; };
function cxTwStock(id) {
  if (!W.two) twoLoad(); if (!W.ins) insLoad(); if (W.two?.decl) twoPxLoad();
  const k2 = id.slice(0, 2), sh = W.tdcc?.[k2];
  if (!sh && !W.tdccShardBusy && typeof tdccShard === "function") { W.tdccShardBusy = true; tdccShard(k2).finally(() => { W.tdccShardBusy = false; if (W.lt === "cong" && W.cv === "tw:s:" + id) renderList(); }); }
  const insAll = (W.ins?.rows || []).filter(r => r.code === id), nm = nameOf(id) !== id ? nameOf(id) : insAll[0]?.name || "";
  // 千張大戶：期間比排程累積的資料早，就向集保網站補（網站只留最近一年）
  const H = cxTdHist(id), w = cxTdW(), from = w ? new Date(Date.now() - w * 7 * 864e5).toISOString().slice(0, 10) : "", HS = from ? H.filter(r => r[0] >= from) : H, X = W.tdccX?.[id], loc0 = sh?.[id]?.[0]?.[0];
  if (sh && !X && (!loc0 || !from || from < loc0)) cxTdMore(id, loc0 ? new Date(Date.parse(loc0) - 864e5).toISOString().slice(0, 10) : "");
  const cur = H.at(-1), prev = H.at(-2), d1 = cur && prev ? +(cur[1] - prev[1]).toFixed(2) : null, dP = HS.length >= 2 ? +(HS.at(-1)[1] - HS[0][1]).toFixed(2) : null;
  const tdState = X?.busy ? "向集保網站補抓更早的週資料…" : X?.err ? `集保網站這次查不到更早的週資料（${esc(X.err)}），先顯示排程累積的` : X?.rows?.length ? `已向集保網站補 ${X.rows.length} 週（網站只保留最近一年；更早的靠排程每週累積）` : "";
  const tdTxt = !sh ? "載入中…" : !H.length ? "沒有這檔的集保股權分散資料（ETF、債券或剛上市的股票可能沒有）。" : "";
  // 內部人：用「內部人」分頁同一個期間
  const R = cxPer("ins"), ins = insAll.filter(r => cxIn(r.d, R)).sort((a, b) => b.d.localeCompare(a.d)), mkt = r => /一般交易|盤後|鉅額|拍賣/.test(r.how);
  // 政治人物：最近一次申報持有、和前一次比
  const P = W.two?.decl ? twoPeople() : [], PH = P.map(p => ({ p, h: p.hold.find(x => x.code === id), c: p.chg.find(x => x.code === id) })).filter(x => x.h || x.c).sort((a, b) => (b.h?.sh || 0) - (a.h?.sh || 0));
  const tag = t => `<span class="ctag ${t === "new" || t === "add" ? "many" : "one"}">${{ new: "新進", add: "增持", cut: "減持", sold: "出清" }[t]}</span>`;
  const sgn = v => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
  return `<section class="csec tw-p cxts">${rkPerson("", `${esc(nm)} ${esc(id)}`, `大戶動向一頁看完：千張大戶、內部人申報、政治人物持股${cur ? `　集保 ${cur[0].replace(/-/g, "/")}` : ""}`)}
    <div class="tw-ctl"><button class="btn sm" data-copen="${esc(id)}">在看盤開啟</button>${typeof wStar === "function" ? wStar(id) : ""}${cxFolBtn("ins", id, nm || id)}</div>
    ${rkCards([{ t: "千張大戶", sub: d1 != null ? `週 ${sgn(d1)}` : "每週五更新", v: cur ? `${cur[1].toFixed(2)}%` : "—", vc: cls(d1) }, { t: "50 張以下散戶", sub: cur && prev ? `週 ${sgn(+(cur[3] - prev[3]).toFixed(2))}` : "", v: cur?.[3] != null ? `${cur[3].toFixed(2)}%` : "—" },
      { t: "內部人申報轉讓", sub: cxWTxt("ins"), v: `${ins.length} 筆`, vc: ins.some(mkt) ? "down" : "" }, { t: "政治人物持有", sub: W.two?.decl ? "最近一次財產申報" : "載入中…", v: `${PH.filter(x => x.h).length} 位` }])}
    <h4>千張大戶持股走勢</h4>${cxRow("期間", rkSeg("data-rkset", `cxTdW:${w}`, CX_TDP.map(([v, t]) => [`cxTdW:${v}`, t])) + (dP != null ? `<span class="note">${HS[0][0].replace(/-/g, "/")} 起 <b class="${cls(dP)}">${sgn(dP)}</b></span>` : ""))}
    ${tdState ? `<p class="note">${tdState}</p>` : ""}${tdTxt ? `<p class="note">${tdTxt}</p>` : ""}
    ${HS.length >= 2 ? `<div class="cxtd">${cxTdLine(HS, 1, "var(--ink)", "千張大戶持股比例")}${cxTdLine(HS, 3, "var(--muted)", "50 張以下散戶持股比例")}</div>` : HS.length ? `<p class="note">這段期間只有 ${HS.length} 週資料，至少兩週才畫得出走勢。</p>` : ""}
    ${HS.length ? `<details class="tw-more"${HS.length <= 8 ? " open" : ""}><summary>每週明細（${HS.length} 週）</summary><div class="ctbl"><table><thead><tr><th>集保日</th><th>千張大戶</th><th>週變化</th><th>400 張以上</th><th>50 張以下</th><th>總人數</th></tr></thead><tbody>${HS.slice().reverse().map((r, i, A) => { const p = A[i + 1], d = p ? +(r[1] - p[1]).toFixed(2) : null; return `<tr><td>${r[0].replace(/-/g, "/")}</td><td class="num">${r[1].toFixed(2)}%</td><td class="num ${cls(d)}">${sgn(d)}</td><td class="num">${r[2] != null ? r[2].toFixed(2) + "%" : "—"}</td><td class="num">${r[3] != null ? r[3].toFixed(2) + "%" : "—"}</td><td class="num">${r[4] > 0 ? r[4].toLocaleString() : "—"}</td></tr>`; }).join("")}</tbody></table></div></details>` : ""}
    <h4>內部人申報轉讓</h4>${cxPerRow("ins")}
    ${!W.ins ? `<p class="note">載入中…</p>` : rkList(ins.slice(0, 60).map(r => ({ no: r.d.slice(5).replace("-", "/"), mono: "", name: `${esc(r.who)} <span class="note">${esc(r.role)}</span>`, sub: `${r.d.slice(0, 4)}・${esc(r.how)}${r.to ? `・受讓 ${esc(r.to)}` : ""}`, val: insSh(r.sh), vc: mkt(r) ? "down" : "", vsub: r.hold ? `占持股 ${Math.round((r.sh / r.hold) * 100)}%` : "" })), `${cxWTxt("ins")}沒有內部人申報轉讓`)}
    <h4>政治人物申報持有</h4>${!W.two ? `<p class="note">載入中…</p>` : PH.length ? `<p class="note">${PH.filter(x => x.h).length} 位政治人物最近一次申報持有；${PH.filter(x => x.c && (x.c.t === "new" || x.c.t === "add")).length} 位比上一次申報增加、${PH.filter(x => x.c && (x.c.t === "cut" || x.c.t === "sold")).length} 位減少。</p>
      <div class="ctbl"><table><thead><tr><th>人物</th><th>持股</th><th>市值</th><th>和上次相比</th><th>申報日</th></tr></thead><tbody>${PH.map(x => `<tr><td>${twoWho(x.p)}</td><td>${x.h ? twoLot(x.h.sh) : "0"}</td><td>${x.h && twoPx(id) != null ? twoAmt(x.h.sh * twoPx(id)) : "—"}</td><td>${x.c ? `${tag(x.c.t)} <span class="${x.c.d > 0 ? "up" : "down"}">${x.c.d > 0 ? "+" : ""}${twoLot(x.c.d)}</span>` : `<span class="note">${x.p.prev ? "不變" : "只有一次申報"}</span>`}</td><td>${x.p.last.date}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">沒有政治人物申報持有 ${esc(id)}。</p>`}
  </section>`;
}
{ const css = document.createElement("style"); css.textContent = `.cx-more { font-size: 12px; } .cx-yr { font: inherit; font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--muted); } button.cx-yr { cursor: pointer; color: var(--ink); } .cx-yr[aria-pressed="true"] { color: var(--ink); border-color: var(--ink); }
.cx-go { display: flex; gap: 4px; align-items: center; min-width: 0; } .cx-go input { flex: 1 1 9em; min-width: 0; width: 11em; font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-2); color: var(--ink); }
.cxts .tw-ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; } .cxtd { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 6px 0; }
.cxtd-f { margin: 0; min-width: 0; } .cxtd-f figcaption { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 13px; } .cxtd-f svg { display: block; width: 100%; height: 80px; } .cxtd-x { display: flex; justify-content: space-between; font-size: 11px; }`; document.head.appendChild(css); }
