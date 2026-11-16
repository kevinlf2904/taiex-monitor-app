/* ================= 訊號回測（選股條件的歷史勝率）：網頁與排程（scripts/_engine.mjs）共用，最上層不碰畫面 =================
   把過去每一次「條件成立」找出來，看之後持有 5／10／20 個交易日的報酬。排程 scripts/signal-study.mjs 每天收盤後用全市場日 K 算好，
   寫進 data/signal-study.json，網頁只讀那個檔。
   規則：訊號日收盤後才知道條件成立 → 一律「隔天開盤」進場，第 n 根收盤出場，扣來回手續費 0.1425% × 2 與證交稅 0.3%。
   不偷看未來：每一天只拿「到那天為止」的 K 棒（D.slice(0, i + 1)）去算指標與判斷條件。
   限制：日 K 快取只有最近約 260 個交易日（扣掉暖機約 200 天），而且只有現在還在上市櫃的股票（倖存者偏差）。 */
// SIG_COV_WARN：產品覆蓋率提示門檻（僅作資料完整度提醒，非統計檢定標準）
const SIG_NS = [5, 10, 20], SIG_COST = 0.001425 * 2 + 0.003, SIG_WARM = 60, SIG_GAP = 5, SIG_MIN_LOTS = 500, SIG_MIN_N = 30, SIG_COV_WARN = 0.95;
const sigR4 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
const sigPos = v => Number.isFinite(v) && v > 0;
// 第 i 根出訊號 → 第 i+1 根開盤買、第 i+n 根收盤賣；回傳可稽核的排除原因
function sigForwardDetail(D, i, n, cost = SIG_COST) {
  if (i + n >= D.length) return { reason: "pending" };
  const e = D[i + 1], x = D[i + n], p = D[i];
  if (!e || !sigPos(e.o) || !sigPos(p?.c)) return { reason: "noEntryBar" };
  if (e.o === e.h && e.h === e.l && e.l === e.c && e.o >= p.c * 1.095) return { reason: "entryLock" };
  for (let k = i + 1; k <= i + n; k++) {
    if (!D[k] || !sigPos(D[k].c) || !sigPos(D[k - 1]?.c)) return { reason: "noExitOrPath" };
    if (Math.abs(D[k].c / D[k - 1].c - 1) > 0.5) return { reason: "jumpExcl" };
  }
  return { value: x.c / e.o - 1 - cost };
}
function sigForward(D, i, n, cost = SIG_COST) {
  const r = sigForwardDetail(D, i, n, cost); return r.value ?? null;
}
function sigScan(D, defs, ind, { warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS } = {}) {
  const out = [], last = {};
  for (let i = warm; i < D.length; i++) {
    if (!(Number.isFinite(D[i].v) && D[i].v >= minLots)) continue;
    const P = D.slice(0, i + 1); let I = null;
    for (const f of defs) { if (last[f.id] != null && i - last[f.id] < gap) continue; let ok = null; try { ok = f.hit(P, (I ||= ind(P))); } catch {} if (ok) { out.push({ id: f.id, i }); last[f.id] = i; } }
  }
  return out;
}
function sigMarket(all) {
  return { S: all.filter(b => b?.length > 1).map(b => ({ b, j: new Map(b.flatMap((x, k) => (x?.d ? [[x.d, k]] : []))) })), memo: new Map() };
}
function sigBenchDetail(M, D, i, n, minLots = SIG_MIN_LOTS, cost = SIG_COST) {
  const ds = D[i]?.d, da = D[i + 1]?.d, db = D[i + n]?.d;
  if (!ds || !da || !db || !(ds < da && da < db)) return null;
  const key = `${ds}|${da}|${db}|${minLots}`;
  if (!M.memo.has(key)) {
    const c = { pool: 0, entry: 0, done: 0, noEntryBar: 0, entryLock: 0, noExitOrPath: 0, jumpExcl: 0 };
    let sum = 0;
    for (const { b, j } of M.S) {
      const si = j.get(ds);
      if (si == null || !(Number.isFinite(b[si]?.v) && b[si].v >= minLots)) continue;
      c.pool++;
      const a = j.get(da);
      if (a == null || !(a > si)) { c.noEntryBar++; continue; }
      const e = b[a], p = b[a - 1];
      if (!p?.d || !(ds <= p.d && p.d < da) || !sigPos(e?.o) || !sigPos(p.c)) { c.noEntryBar++; continue; }
      // 漲停參考價取基準股進場日前一交易日收盤（可能晚於 ds），與訊號端 D[i] 同語意
      if (e.o === e.h && e.h === e.l && e.l === e.c && e.o >= p.c * 1.095) { c.entryLock++; continue; }
      c.entry++;
      const z = j.get(db);
      if (z == null || !(z > a)) { c.noExitOrPath++; continue; }
      let reason = null;
      for (let k = a; k <= z; k++) {
        if (!b[k] || !sigPos(b[k].c) || !sigPos(b[k - 1]?.c)) { reason = "noExitOrPath"; break; }
        if (Math.abs(b[k].c / b[k - 1].c - 1) > 0.5) { reason = "jumpExcl"; break; }
      }
      if (reason) { c[reason]++; continue; }
      sum += b[z].c / e.o - 1; c.done++;
    }
    M.memo.set(key, { ...c, grossAvg: c.done ? sum / c.done : null });
  }
  const m = M.memo.get(key);
  return { ...m, value: m.grossAvg == null ? null : m.grossAvg - cost };
}
function sigBench(M, D, i, n, cost = SIG_COST, minLots = SIG_MIN_LOTS) {
  return sigBenchDetail(M, D, i, n, minLots, cost)?.value ?? null;
}
function sigStat(A) {
  if (!A.length) return null; const s = [...A].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: A.length, avg: sigR4(A.reduce((x, y) => x + y, 0) / A.length), med: sigR4(q(0.5)), p25: sigR4(q(0.25)), p75: sigR4(q(0.75)), win: sigR4(A.filter(x => x > 1e-9).length / A.length) }; // 1e-9：浮點誤差不算贏
}
// stocks: [{ c, n, bars }]、defs: [{ id, group, side, name, desc, hit }] → 每個條件的統計
function sigStudy(stocks, defs, ind, { ns = SIG_NS, cost = SIG_COST, warm = SIG_WARM, gap = SIG_GAP, minLots = SIG_MIN_LOTS, includeEvents = true } = {}) {
  const M = sigMarket(stocks.map(s => s.bars)), T = Object.fromEntries(defs.map(f => [f.id, {
    r: Object.fromEntries(ns.map(n => [n, []])), pairedR: Object.fromEntries(ns.map(n => [n, []])),
    pairedB: Object.fromEntries(ns.map(n => [n, []])), x: Object.fromEntries(ns.map(n => [n, []])), list: [],
    signal: Object.fromEntries(ns.map(n => [n, { triggered: 0, pending: 0, lock: 0, noExitOrPath: 0, jumpExcl: 0, done: 0 }])),
    bench: Object.fromEntries(ns.map(n => [n, { pool: 0, entry: 0, done: 0, noEntryBar: 0, entryLock: 0, noExitOrPath: 0, jumpExcl: 0, events: 0, entryZeroEvents: 0, covSum: 0, covN: 0, covMin: null }])),
    benchEvents: includeEvents ? Object.fromEntries(ns.map(n => [n, []])) : null
  }]));
  for (const stock of stocks) { const D = stock.bars; if (!D || D.length <= warm) continue;
    for (const { id, i } of sigScan(D, defs, ind, { warm, gap, minLots })) {
      const t = T[id], rec = [stock.c, stock.n, D[i].d];
      for (const n of ns) {
        const sc = t.signal[n]; sc.triggered++;
        const fr = sigForwardDetail(D, i, n, cost); rec.push(sigR4(fr.value));
        if (fr.value == null) {
          if (fr.reason === "pending") sc.pending++;
          else if (fr.reason === "noEntryBar" || fr.reason === "entryLock") sc.lock++;
          else if (fr.reason === "noExitOrPath") sc.noExitOrPath++;
          else if (fr.reason === "jumpExcl") sc.jumpExcl++;
          continue;
        }
        sc.done++; t.r[n].push(fr.value);
        const bm = sigBenchDetail(M, D, i, n, minLots, cost), bc = t.bench[n];
        if (!bm) continue;
        bc.events++;
        for (const k of ["pool", "entry", "done", "noEntryBar", "entryLock", "noExitOrPath", "jumpExcl"]) bc[k] += bm[k];
        if (bm.entry > 0) {
          const cov = bm.done / bm.entry; bc.covSum += cov; bc.covN++;
          bc.covMin = bc.covMin == null ? cov : Math.min(bc.covMin, cov);
        } else bc.entryZeroEvents++;
        const paired = bm.value != null;
        if (includeEvents) t.benchEvents[n].push([D[i].d, bm.pool, bm.entry, bm.done, bm.noEntryBar, bm.entryLock, bm.noExitOrPath, bm.jumpExcl, paired ? 1 : 0]);
        if (paired) { t.pairedR[n].push(fr.value); t.pairedB[n].push(bm.value); t.x[n].push(fr.value - bm.value); }
      }
      t.list.push(rec);
    }
  }
  const nL = ns[ns.length - 1], bins = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2];
  return defs.map(f => { const t = T[f.id];
    const out = { id: f.id, group: f.group, side: f.side || null, name: f.name, desc: f.desc || "",
      stats: Object.fromEntries(ns.map(n => {
        const a = sigStat(t.r[n]), pr = sigStat(t.pairedR[n]), pb = sigStat(t.pairedB[n]), x = sigStat(t.x[n]), b = t.bench[n], q = t.signal[n];
        const benchCov = { ...b, covEvents: b.covN, covAvg: b.covN ? sigR4(b.covSum / b.covN) : null, covMin: b.covMin == null ? null : sigR4(b.covMin), covOverall: b.entry ? sigR4(b.done / b.entry) : null };
        delete benchCov.covSum; delete benchCov.covN;
        return [n, q.triggered ? { ...(a || { n: 0, avg: null, med: null, p25: null, p75: null, win: null }), exN: t.x[n].length, pairedAvg: pr?.avg ?? null, benchAvg: pb?.avg ?? null, ex: x?.avg ?? null, exWin: x?.win ?? null,
          signalAudit: { ...q }, benchCov } : null];
      })),
      hist: [...bins, Infinity].map((b, k) => t.r[nL].filter(v => v < b && (k === 0 || v >= bins[k - 1])).length),
      recent: t.list.sort((a, b) => b[2].localeCompare(a[2])).slice(0, 30) };
    if (includeEvents) out.benchEvents = t.benchEvents;
    return out;
  });
}

/* ---------- 看盤「選股 → 訊號回測」與 K 線格子上的勝率標記（只定義函式；畫面由 watch.html 的 renderList 呼叫） ---------- */
async function sgLoad() {
  if (W.sigBusy || W.off) return; W.sigBusy = true;
  try { const r = await fetch("data/signal-study.json", { cache: "no-cache", signal: tmo(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); W.sig = Array.isArray(j?.defs) ? j : { err: "格式不對" }; } catch (e) { W.sig = { err: e.message }; }
  W.sigBusy = false; if (W.lt === "screen" && (W.scrG === "sig" || W.scrG === "kline")) renderList();
}
const sgWin = v => (v == null ? "—" : `${Math.round(v * 100)}%`), sgEnough = (J, s) => !!s && s.n >= (J.minN || SIG_MIN_N);
// K 線格子下面的一行小字：資料檔有這個條件、20 天樣本夠才顯示。數字都是「買進持有」的結果，所以不寫「勝率」（看空型態會被看反）
function sgBadge(id) {
  const J = W.sig; if (!J) { if (!W.sigBusy && !W.off) setTimeout(sgLoad, 0); return ""; }
  const N = J.ns || SIG_NS, last = N[N.length - 1], F = (J.defs || []).find(x => x.id === id), s = F?.stats?.[last], prefix = F?.side === "bear" ? "看空型態（反向解讀）・" : "";
  return sgEnough(J, s) ? `<small class="sgbadge">${prefix}之後 ${last} 日：上漲機率 ${sgWin(s.win)}・超額（同池）${qP(s.ex)}・${s.n} 筆</small>` : "";
}
function sgHtml() {
  const J = W.sig; if (!J && !W.sigBusy) setTimeout(sgLoad, 0);
  if (!J?.defs) return `<p class="note gnote">${W.off ? "需要部署到網站才有回測資料。" : J?.err ? "還沒有回測資料：每個交易日收盤後由排程用全市場日 K 計算，第一次跑完後就會出現。" : "載入中…"}</p>`;
  const N = J.ns || SIG_NS, n = N.includes(+store.get("watch:sign", 0)) ? +store.get("watch:sign", 0) : N[N.length - 1], last = N[N.length - 1], id = store.get("watch:sigid", ""), T = J.defs.find(x => x.id === id);
  // 排序看「型態準不準」：看多依超額（同池）由高到低；看空的超額越低越前面，所以反過來（獨立審查 R1）
  const key = x => { const s = x.stats?.[n]; return sgEnough(J, s) ? [1, s.ex == null ? -9 : x.side === "bear" ? -s.ex : s.ex] : [0, s?.n || 0]; };
  const L = [...J.defs].sort((a, b) => { const A = key(a), B = key(b); return B[0] - A[0] || B[1] - A[1]; });
  const bins = ["< −20%", "−20～−15", "−15～−10", "−10～−5", "−5～0", "0～5", "5～10", "10～15", "15～20", "≥ 20%"], hm = Math.max(1, ...(T?.hist || []));
  return `<p class="note gnote">${esc(J.from)}～${esc(J.to)}・${J.stocks} 檔上市櫃普通股。把過去每一次條件成立找出來：收盤後才知道訊號，所以一律隔天開盤買進、持有 ${n} 個交易日後收盤賣出，已扣手續費與證交稅（來回 ${((J.cost ?? SIG_COST) * 100).toFixed(3)}%）。同池基準＝訊號日成交量 ≥ ${SIG_MIN_LOTS} 張的現存上市櫃普通股等權池（含當次訊號股），以訊號日、進場日、出場日精確配對（同樣扣成本）；超額（同池）＝訊號股報酬減同池基準報酬。排行依型態準不準：看多的超額（同池）越高越前面，看空的超額越低越前面。</p>
    <div class="seg scrseg" role="group" aria-label="持有天數">${N.map(k => `<button data-sgn="${k}" aria-pressed="${k === n}">持有 ${k} 天</button>`).join("")}</div>
    <div class="ctbl sgwrap"><table class="evtbl sgtbl"><thead><tr><th>條件</th><th>樣本</th><th>平均報酬</th><th>上漲機率</th><th>超額（同池）</th><th>贏同池機率</th></tr></thead><tbody>
      ${L.map(x => { const s = x.stats?.[n], ok = sgEnough(J, s);
        return `<tr data-sgid="${esc(x.id)}"${x.id === id ? ' class="on"' : ""}><td><button class="linkbtn" data-sgid="${esc(x.id)}">${esc(x.name)}</button>${x.group === "kline" ? ` <small class="note sgside">${x.side === "bear" ? "看空" : "看多"}</small>` : ""}</td><td>${s?.n ?? 0}</td>${ok ? `<td class="${cls(s.avg)}">${qP(s.avg)}</td><td>${sgWin(s.win)}</td><td class="${cls(s.ex)}">${qP(s.ex)}</td><td>${sgWin(s.exWin)}</td>` : `<td colspan="4"><span class="note">樣本不足</span></td>`}</tr>`; }).join("")}</tbody></table></div>
    ${T ? `<section class="mk sgdetail"><h3>${esc(T.name)}<span class="note">${T.group === "kline" ? (T.side === "bear" ? "K 線組合・看空型態（反向解讀）" : "K 線組合・看多") : "技術條件"}</span></h3>${T.desc ? `<p class="note">${esc(T.desc)}</p>` : ""}
      <div class="ctbl"><table class="evtbl"><thead><tr><th>持有</th><th>樣本</th><th>平均報酬</th><th>中位數</th><th>上漲機率</th><th>超額（同池）</th><th>贏同池機率</th></tr></thead><tbody>
        ${N.map(k => { const s = T.stats?.[k]; return `<tr><td>${k} 天</td><td>${s?.n ?? 0}${s?.exN != null ? `（配對 ${s.exN}）` : ""}</td><td class="${cls(s?.avg)}">${qP(s?.avg)}</td><td class="${cls(s?.med)}">${qP(s?.med)}</td><td>${sgWin(s?.win)}</td><td class="${cls(s?.ex)}">${qP(s?.ex)}</td><td>${sgWin(s?.exWin)}</td></tr>`; }).join("")}</tbody></table></div>
      ${sgEnough(J, T.stats?.[last]) ? "" : `<p class="note">樣本少於 ${J.minN || SIG_MIN_N} 筆，結果容易被少數股票左右，只能當參考。</p>`}
      ${N.map(k => { const s = T.stats?.[k], v = s?.benchCov, q = s?.signalAudit; if (!v && !q) return "";
        const parts = [];
        if (q) parts.push(`訊號端 ${q.triggered}（未成熟 ${q.pending}・進場受限 ${q.lock}・成熟缺出場／路徑 ${q.noExitOrPath}・跳動排除 ${q.jumpExcl}・完成 ${q.done}）`);
        if (v) {
          if (v.events > 0) {
            const lowCov = (v.covOverall != null && v.covOverall < SIG_COV_WARN) || (v.covMin != null && v.covMin < SIG_COV_WARN);
            const lowPair = s.n > 0 && (s.exN ?? 0) / s.n < SIG_COV_WARN;
            parts.push(`同池基準 ${v.events} 次（合格池 ${v.pool ?? 0}・可進場 ${v.entry}・進場受限 ${(v.noEntryBar ?? 0) + (v.entryLock ?? 0)}・完成 ${v.done}；股票數加權 ${sgWin(v.covOverall)}；事件等權 ${sgWin(v.covAvg)}；最低單次 ${sgWin(v.covMin)}${v.entryZeroEvents ? `；無可進場 ${v.entryZeroEvents} 次` : ""}；缺出場／路徑 ${v.noExitOrPath ?? 0}・跳動排除 ${v.jumpExcl ?? 0}），配對 ${s.exN ?? 0}/${s.n ?? 0}${s.exN !== s.n && s.pairedAvg != null ? `（配對訊號 ${qP(s.pairedAvg)} vs 同池 ${qP(s.benchAvg)}）` : ""}${lowCov || lowPair ? `；覆蓋低於 ${Math.round(SIG_COV_WARN * 100)}% 提示門檻` : ""}`);
          } else parts.push(q?.done ? "同池基準：無有效配對基準事件" : q?.pending ? "同池基準：尚無成熟事件" : "同池基準：無完成訊號事件");
        }
        return `<p class="note">持有 ${k} 天｜${parts.join("；")}；基準池限現有快取可觀察股票。</p>`; }).join("")}
      <h4>${last} 天報酬分佈</h4><div class="evhist">${(T.hist || []).map((v, i) => `<div title="${bins[i]}：${v} 筆"><i class="${i < 5 ? "dn" : "upb"}" style="height:${(v / hm * 100).toFixed(0)}%"></i><small>${bins[i].replace("%", "")}</small></div>`).join("")}</div>
      ${T.recent?.length ? `<h4>最近出現的訊號</h4><div class="ctbl"><table><thead><tr><th>股票</th><th>訊號日</th>${N.map(k => `<th>${k} 天</th>`).join("")}</tr></thead><tbody>
        ${T.recent.slice(0, 20).map(r => `<tr><td><button class="linkbtn" data-sel="${esc(r[0])}">${esc(r[1] || r[0])} ${esc(r[0])}</button></td><td>${esc(String(r[2]).slice(5).replace("-", "/"))}</td>${N.map((k, i) => `<td class="${cls(r[3 + i])}">${r[3 + i] == null ? `<span class="note">進行中</span>` : qP(r[3 + i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>` : `<p class="note gnote">點條件名稱看三種持有天數、報酬分佈與最近出現的股票。</p>`}
    <p class="note gnote">所有數字都是「買進後持有」的結果：看空型態僅是買進持有結果的反向解讀，不代表實際放空績效；其上漲機率與超額（同池）越低，代表反向訊號越符合預期。只有最近約一年的資料，等於只看過一種行情；已下市的股票不在裡面；樣本少於 ${J.minN || SIG_MIN_N} 筆的不列機率。樣本數是訊號次數，不是互不相干的交易次數：同一檔相隔 ${SIG_GAP} 天以上就會再算一次，持有期間可能重疊，同一段行情也會讓很多檔同時出現訊號。過去表現不代表未來，不是投資建議。</p>`;
}
