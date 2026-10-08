/* 名人 Podcast（看盤的「名人」分頁）：追蹤財經 Podcast，AI 整理單集重點，記錄主持人對個股的看多／看空（觀點紀錄），
   用真實股價追蹤之後的表現（相對大盤的超額報酬：台股比 0050、美股比 SPY），算出往績評分、強項時間框架、跟單模擬與排行榜。
   - 節目與單集：/api/podcast（Apple Podcasts 目錄＋節目 RSS）
   - 重點與觀點：有 GEMINI_API_KEY 時 AI 聽完整集音檔；否則讀節目說明（show notes）；整理結果只存在這個瀏覽器（localStorage）
   - 股價：/api/kline（日 K）。進場價＝節目上架後下一個交易日的開盤價；檢查點 7／30／60／90／180／365 天。
   這裡用到 watch.html 的 W、getJ、select、loadStocks、nameOf、okCode、esc、cls 與 core.js 的 $、store。 */
const POD_SEED = [["股癌", "股癌"], ["兆華與股惑仔", "股惑仔"], ["游庭皓的財經皓角", "皓角"], ["理財達人秀", "理財達人秀"], ["Money&Love 投資頻道", "Money"], ["金唬男", "金唬男"]];
const POD_CK = [7, 30, 60, 90, 180, 365];
const POD = { view: "home", feed: null, key: null, hist: [], rank: "expert", sim: { m: 3, mode: "follow", hold: 30 }, cfg: null, feeds: new Map(), px: new Map(), pxBusy: false, job: null, q: "", found: null, qErr: null, busy: 0, booted: false, sid: 0, err: null };
const podSums = () => (POD.sums ||= store.get("pod:sums", {}) || {});
const podSave = () => { try { store.set("pod:sums", podSums()); } catch { POD.err = "瀏覽器的儲存空間滿了，舊的整理結果可能存不下。"; } };
const podFollows = () => store.get("pod:follows", null) || [];
const podHash = s => { let h = 5381; for (const ch of String(s)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
const podKey = (feed, guid) => podHash(feed + "|" + guid);
const twDate = iso => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
const podToday = () => twDate(new Date().toISOString());
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const podPct = (x, d = 1) => (x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const podAvg = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const podSd = a => { const m = podAvg(a); return Math.sqrt(podAvg(a.map(x => (x - m) ** 2))); };
const podSleep = ms => new Promise(r => setTimeout(r, ms));
function podRel(iso) {
  const d = twDate(iso), t = podToday(), n = Math.round((Date.parse(t) - Date.parse(d)) / 864e5);
  return n <= 0 ? "今天" : n === 1 ? "昨天" : n < 7 ? `${n} 天前` : d.slice(5).replace("-", "/");
}
async function podPost(body) {
  let r; try { r = await fetch("/api/podcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch { throw new Error("連不到伺服器"); }
  const j = await r.json().catch(() => null); if (!j) throw new Error(r.status === 404 ? "這個環境沒有資料服務，部署到網站後才能用" : `服務回應 ${r.status}`);
  if (!j.ok) throw new Error(j.error || "處理失敗"); return j;
}
function podRender() { if (W.lt === "pod") renderList(); }

/* ---------- 資料：節目、單集、股價 ---------- */
async function podBoot() {
  if (POD.booted || W.off) return; POD.booted = true;
  getJ("/api/podcast?act=cfg", true).then(j => { POD.cfg = j; podRender(); }).catch(() => { POD.cfg = { audio: false, notes: false }; });
  if (!store.get("pod:follows", null)) { // 第一次：從 Apple Podcasts 找預設的幾個節目
    POD.busy++; podRender(); const out = [];
    await Promise.all(POD_SEED.map(async ([q, must]) => { try { const j = await getJ(`/api/podcast?q=${encodeURIComponent(q)}`, true); const s = j.shows.find(x => x.name.includes(must)); if (s) out.push({ ...s, seed: POD_SEED.findIndex(x => x[0] === q) }); } catch {} }));
    out.sort((a, b) => a.seed - b.seed); store.set("pod:follows", out.map(({ seed, ...s }) => s)); POD.busy--;
  }
  await podLoadFeeds(); podLoadPx();
}
async function podLoadFeeds(force = false) {
  const F = podFollows(); POD.busy++; podRender();
  let k = 0; const worker = async () => { while (k < F.length) { const s = F[k++]; await podFeed(s.feed, force).catch(() => {}); podRender(); } };
  await Promise.all([worker(), worker(), worker()]); POD.busy--; podRender();
}
async function podFeed(feed, force = false) {
  const mem = POD.feeds.get(feed) || store.get("pod:feed:" + podHash(feed), null);
  if (mem) { POD.feeds.set(feed, mem); podIndex(feed, mem); if (!force && Date.now() - mem.at < 15 * 60e3) return mem; }
  const j = await getJ(`/api/podcast?feed=${encodeURIComponent(feed)}&n=30`, true);
  const v = { at: Date.now(), show: j.show, eps: j.eps.map(e => ({ ...e, desc: e.desc.slice(0, 3000) })) };
  POD.feeds.set(feed, v); podIndex(feed, v); try { store.set("pod:feed:" + podHash(feed), v); } catch {}
  return v;
}
function podShowOf(feed) { const f = podFollows().find(s => s.feed === feed), v = POD.feeds.get(feed); return { feed, name: f?.name || v?.show?.name || Object.values(podSums()).find(s => s.feed === feed)?.show || "節目", art: f?.art || v?.show?.art || "", author: f?.author || v?.show?.author || "" }; }
function podIndex(feed, v) { (POD.idx ||= new Map()); for (const e of v.eps) POD.idx.set(podKey(feed, e.guid), { e, feed }); }
function podEp(key) {
  const it = POD.idx?.get(key); if (it) return { e: it.e, s: podShowOf(it.feed) };
  const m = podSums()[key]; return m ? { e: { guid: m.guid, title: m.title, date: m.date, desc: "", audio: m.audio || "" }, s: podShowOf(m.feed) } : null;
}
// 全部的觀點（只有整理過、而且代號確定的）
function podCalls(feed) {
  return Object.entries(podSums()).filter(([, s]) => !feed || s.feed === feed).flatMap(([key, s]) => (s.calls || []).filter(c => c.code).map(c => ({ ...c, key, feed: s.feed, show: s.show, title: s.title, date: twDate(s.date) })));
}
async function podLoadPx() {
  if (POD.pxBusy || W.off) return; const calls = podCalls(); if (!calls.length) return;
  const need = [...new Set([...calls.map(c => c.code), ...(calls.some(c => /^\d/.test(c.code)) ? ["0050"] : []), ...(calls.some(c => !/^\d/.test(c.code)) ? ["SPY"] : [])])]
    .filter(c => { const p = POD.px.get(c); return !p || (Date.now() - p.at > 30 * 60e3 && !p.err); });
  if (!need.length) return; POD.pxBusy = true;
  let k = 0, last = 0; const worker = async () => { while (k < need.length) { const c = need[k++];
    try { const j = await getJ(`/api/kline?code=${encodeURIComponent(c)}&months=24`, true); POD.px.set(c, { at: Date.now(), data: j.data }); } catch (e) { POD.px.set(c, { at: Date.now(), data: null, err: e.message }); }
    if (Date.now() - last > 600) { last = Date.now(); podRender(); } } };
  await Promise.all([worker(), worker(), worker(), worker()]); POD.pxBusy = false; POD.perf = new Map(); podRender();
}

/* ---------- 計算：每個觀點的表現、主持人的往績、跟單模擬 ---------- */
// 進場：上架後下一個交易日的開盤價（美股：上架當天（台北日期）或之後的第一個美股交易日，因為美股晚上才開盤）
function podPerf(c) {
  const ck = c.code + "|" + c.date + "|" + c.dir; (POD.perf ||= new Map()); if (POD.perf.has(ck)) return POD.perf.get(ck);
  const tw = /^\d/.test(c.code), P = POD.px.get(c.code), B = POD.px.get(tw ? "0050" : "SPY");
  if (P?.err || B?.err) return { err: P?.err || B?.err }; if (!P?.data || !B?.data) return null;
  const out = podPerfCalc(P.data, B.data, c.date, c.dir, tw, podToday()); POD.perf.set(ck, out); return out;
}
function podPerfCalc(P, B, date, dir, tw, today) {
  const i0 = P.findIndex(x => (tw ? x.d > date : x.d >= date)); if (i0 < 0) return { pending: true };
  const e = P[i0], ep = e.o || e.c, bj = B.findIndex(x => x.d >= e.d); if (bj < 0 || !ep) return { pending: true };
  const bp = B[bj].o || B[bj].c, sg = dir === "bear" ? -1 : 1, end = addDays(e.d, 365), smap = new Map(P.map(x => [x.d, x.c]));
  let lastS = e.c; const series = [];
  for (let k = bj; k < B.length && B[k].d <= end; k++) { const d = B[k].d; if (smap.has(d)) lastS = smap.get(d); series.push({ d, r: lastS / ep - 1, ex: sg * ((lastS / ep - 1) - (B[k].c / bp - 1)) }); }
  const lastD = series[series.length - 1]?.d || e.d;
  const cks = POD_CK.map(n => { const t = addDays(e.d, n), settled = lastD >= t || (today > t && lastD >= addDays(t, -4)), s = [...series].reverse().find(x => x.d <= t); return { n, settled: settled && !!s, ex: s ? s.ex : null }; });
  const latest = [...cks].reverse().find(k => k.settled) || null;
  return { entry: e.d, px: ep, series, map: new Map(series.map(s => [s.d, s.ex])), cks, latest, cur: series[series.length - 1] || null };
}
function podStats(calls) {
  const P = calls.map(c => ({ c, p: podPerf(c) })), ok = P.filter(x => x.p && !x.p.pending && !x.p.err), settled = ok.filter(x => x.p.latest);
  const loading = P.some(x => !x.p);
  if (!settled.length) return { n: calls.length, settled: 0, loading };
  const v = settled.map(x => x.p.latest.ex), all = settled.flatMap(x => x.p.cks.filter(k => k.settled).map(k => k.ex));
  const mean = podAvg(v), acc = (100 * all.filter(x => x > 0).length) / all.length, win = (100 * v.filter(x => x > 0).length) / v.length;
  const exS = 50 + 50 * Math.tanh(mean / 0.08), cons = 100 * (1 - Math.min(1, podSd(v) / 0.25));
  const fr = ns => { const xs = settled.flatMap(x => x.p.cks.filter(k => k.settled && ns.includes(k.n)).map(k => k.ex)); return xs.length ? { avg: podAvg(xs), n: xs.length } : null; };
  return { n: calls.length, settled: v.length, loading, mean, acc, win, exS, cons, score: 0.4 * acc + 0.4 * exS + 0.2 * cons, few: v.length < 5, frames: { s: fr([7, 30]), m: fr([60, 90]), l: fr([180, 365]) } };
}
// 跟單：每個觀點上架後隔天進場、持有 hold 天，每天的超額報酬取所有持有中部位的平均，累加起來
function podSim(calls, { m, mode, hold }) {
  const start = addDays(podToday(), -Math.round(m * 30.44)), sg = mode === "rev" ? -1 : 1;
  const pos = calls.filter(c => mode !== "bull" || c.dir === "bull").map(c => ({ c, p: podPerf(c) })).filter(x => x.p && x.p.series && x.p.entry >= start);
  const days = [...new Set(pos.flatMap(x => x.p.series.map(s => s.d)))].sort(), prev = new Map(), pts = [{ d: start, v: 0 }]; let cum = 0;
  for (const d of days) {
    let sum = 0, k = 0;
    for (const x of pos) { if (d < x.p.entry || d > addDays(x.p.entry, hold)) continue; const s = x.p.map.get(d); if (s == null) continue; sum += sg * (s - (prev.get(x) ?? 0)); prev.set(x, s); k++; }
    if (k) cum += sum / k; pts.push({ d, v: cum });
  }
  return { pts, total: cum, n: pos.length };
}

/* ---------- AI 整理 ---------- */
async function podResolve(calls) {
  const list = (await loadStocks().catch(() => null)) || [], out = [];
  for (const c of calls || []) {
    let code = c.code, name = c.name;
    if (code && /^\d/.test(code) && list.length && !list.some(r => r[0] === code)) code = "";
    if (!code && name) { const n = name.replace(/\s/g, ""), hit = list.find(r => r[1] === n) || list.find(r => r[1].length >= 2 && (n.includes(r[1]) || r[1].includes(n))) || US_HINT.find(([, nm]) => nm === n); if (hit) { code = hit[0]; name = name || hit[1]; } }
    out.push({ id: Math.random().toString(36).slice(2, 9), code: code && okCode(code) ? code : "", name: name || (code ? nameOf(code) : ""), dir: c.dir === "bear" ? "bear" : "bull", quote: c.quote || "" });
  }
  return out;
}
async function podSum(key, mode) {
  const it = podEp(key); if (!it || POD.job?.busy) return;
  const { e, s } = it; POD.job = { key, busy: true, mode, step: mode === "audio" ? "下載音檔、上傳給 AI…" : "AI 讀節目說明中…" }; podRender();
  try {
    let body = { act: "sum", title: e.title, show: s.name, date: twDate(e.date), desc: e.desc };
    if (mode === "audio") {
      if (!e.audio) throw new Error("這集沒有音檔網址");
      const up = await podPost({ act: "upload", audio: e.audio, name: e.title });
      POD.job.step = `音檔 ${up.mb}MB 已上傳，等 AI 處理音檔…`; podRender();
      let st = up.state; const t0 = Date.now();
      while (st !== "ACTIVE") { if (st === "FAILED" || Date.now() - t0 > 180000) throw new Error("AI 處理音檔失敗，可以改用節目說明整理。"); await podSleep(3000); st = (await getJ(`/api/podcast?act=file&name=${encodeURIComponent(up.file)}`, true)).state; }
      POD.job.step = "AI 聽完整集、整理重點與觀點中（約 20～50 秒）…"; podRender();
      body = { ...body, uri: up.uri, mime: up.mime, file: up.file, desc: "" };
    }
    const j = await podPost(body), calls = await podResolve(j.calls), old = podSums()[key];
    podSums()[key] = { tldr: j.tldr, points: j.points, sections: j.sections, topics: j.topics, calls: [...calls, ...(old?.calls || []).filter(c => c.manual)], mode: j.mode, model: j.model, at: Date.now(), feed: it.s.feed, guid: e.guid, title: e.title, date: e.date, show: s.name, audio: e.audio };
    podSave(); POD.job = null; POD.perf = new Map(); podLoadPx();
  } catch (err) { POD.job = { key, err: err.message || "整理失敗", mode }; }
  podRender();
}
async function podBatch(feed, n, mode) {
  const v = POD.feeds.get(feed); if (!v) return;
  for (const e of v.eps.slice(0, n)) { const key = podKey(feed, e.guid); if (podSums()[key]) continue; await podSum(key, mode); if (POD.job?.err) break; }
}

/* ---------- 畫面 ---------- */
function podSpark(pts, w = 300, h = 56) {
  if (!pts || pts.length < 2) return "";
  const vs = pts.map(p => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), rg = hi - lo || 1, X = i => (i / (pts.length - 1)) * w, Y = v => h - 3 - ((v - lo) / rg) * (h - 6), y0 = Y(0), id = "ps" + ++POD.sid;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  return `<svg class="pspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="${id}a"><rect width="${w}" height="${y0}"/></clipPath><clipPath id="${id}b"><rect y="${y0}" width="${w}" height="${h - y0}"/></clipPath></defs>
    <line x1="0" x2="${w}" y1="${y0}" y2="${y0}" class="pbase"/><path d="${d}" clip-path="url(#${id}a)" class="pl up"/><path d="${d}" clip-path="url(#${id}b)" class="pl down"/></svg>`;
}
const podCkBar = p => `<div class="pcks">${p.cks.map((k, i) => `<span style="flex:${k.n - (i ? POD_CK[i - 1] : 0)}" class="${k.settled ? (k.ex > 0 ? "win" : "lose") : "open"}" title="${k.n} 天：${k.settled ? podPct(k.ex) : "未到期"}"></span>`).join("")}</div>
  <div class="pckl">${p.cks.map((k, i) => `<span style="flex:${k.n - (i ? POD_CK[i - 1] : 0)}">${k.n === 7 ? "" : k.n + "d"}</span>`).join("")}</div>`;
function podBadge(feed) {
  const st = podStats(podCalls(feed)); if (!st.settled) return "";
  return `<span class="pbadge ${st.win >= 60 ? "gold" : st.win >= 40 ? "" : "low"}" title="已結算的觀點裡跑贏大盤的比例（${st.settled} 筆）">🏆 跑贏 ${Math.round(st.win)}%</span>`;
}
function podCallCard(c, showEp = true) {
  const p = podPerf(c), tw = /^\d/.test(c.code);
  const status = !p ? "載入股價…" : p.err ? "拿不到股價" : p.pending ? "等待進場" : p.latest ? (p.latest.n === 365 ? "已結算" : "部分結算") : "未到期";
  const main = p?.latest ? `<b class="pex ${cls(p.latest.ex)}">${podPct(p.latest.ex)}</b><span class="note">對大盤・截至 ${p.latest.n}d 結算</span>`
    : p?.cur ? `<b class="pex">${podPct(p.cur.ex)}</b><span class="note">目前（還沒到 7 天）</span>` : `<b class="pex muted">—</b>`;
  return `<div class="pcall">
    <div class="pch"><button class="pcode" data-sel="${c.code}">${tw ? "TWSE" : "US"}:${c.code}</button><span class="pname">${esc(c.name || nameOf(c.code))}</span><span class="pdir ${c.dir}">${c.dir === "bear" ? "看空" : "看多"}</span><span class="note pst">${status}</span></div>
    <div class="pmain">${main}</div>
    ${c.quote ? `<blockquote class="pq ${c.dir}">${esc(c.quote)}</blockquote>` : ""}
    ${p?.series ? podSpark(p.series.map(s => ({ v: s.ex }))) + podCkBar(p) : ""}
    <div class="pcf note"><span>${c.date}</span>${showEp ? `<button class="linkbtn" data-pep="${c.key}">${esc(c.title)}</button>` : ""}${c.manual ? "<span>手動新增</span>" : ""}<button class="linkbtn pdel" data-pdel="${c.key}|${c.id}">刪除</button></div>
  </div>`;
}
const podArt = (s, cl = "part") => (s.art ? `<img class="${cl}" src="${esc(s.art)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cl} pnoart">${esc((s.name || "?").slice(0, 2))}</span>`);
const podEmpty = msg => `<p class="note pempty">${msg}</p>`;
function podJobHtml(key) {
  const J = POD.job; if (!J || J.key !== key) return "";
  return J.err ? `<div class="pjob err">⚠ ${esc(J.err)}${J.mode === "audio" ? ` <button class="btn sm" data-psum="notes" data-k="${key}">改用節目說明整理</button>` : ""}</div>` : `<div class="pjob"><span class="pspin"></span>${esc(J.step)}</div>`;
}
function podSumBtns(key, e) {
  const c = POD.cfg, busy = POD.job?.busy;
  if (c && !c.notes) return `<p class="note">伺服器還沒設定 AI 金鑰（GEMINI_API_KEY），沒辦法整理重點。在 Vercel 設定後重新部署就能用；觀點也可以自己在下面新增。</p>`;
  return `<div class="row psumbtns">${c?.audio !== false && e.audio ? `<button class="btn primary" data-psum="audio" data-k="${key}" ${busy ? "disabled" : ""}>🎧 AI 聽完整集整理</button>` : ""}<button class="btn" data-psum="notes" data-k="${key}" ${busy ? "disabled" : ""}>📝 用節目說明整理</button></div>
    <p class="note">「聽完整集」最完整（一集約 30～60 秒，會用到 Gemini 額度）；節目說明通常只有大綱，整理出來比較少。</p>`;
}

function podHome() {
  const F = podFollows(), S = podSums();
  if (!F.length) return POD.busy ? podEmpty("正在找節目…") : podEmpty(`還沒有追蹤節目。到「追蹤清單」搜尋節目名稱加入。`);
  const eps = F.flatMap(s => (POD.feeds.get(s.feed)?.eps || []).slice(0, 12).map(e => ({ e, s, key: podKey(s.feed, e.guid) }))).sort((a, b) => b.e.date.localeCompare(a.e.date)).slice(0, 40);
  const av = `<div class="pavs">${F.map(s => `<button class="pav" data-pshow="${esc(s.feed)}">${podArt(s)}<span>${esc(s.name)}</span></button>`).join("")}</div>`;
  const cards = eps.map(({ e, s, key }) => { const m = S[key], chars = m ? (m.points.join("") + m.sections.map(x => x.body).join("")).length : 0;
    return `<article class="pep" data-pep="${key}" role="button" tabindex="0">${podArt(s)}<div class="pepb">
      <div class="pmeta"><b>${esc(s.name)}</b><span class="note">・${podRel(e.date)}</span>${podBadge(s.feed)}</div>
      <h4>${esc(e.title)}</h4>
      ${m ? `<p class="ptl">${esc(m.tldr)}</p>${m.topics?.length ? `<p class="note ptopic">• 你可能感興趣的議題：<span>${esc(m.topics[0])}</span></p>` : ""}<p class="note">閱讀約 ${Math.max(1, Math.round(chars / 350))} 分鐘・${m.calls.filter(c => c.code).length} 個觀點</p>`
        : `<p class="note ptl">${esc((e.desc || "").replace(/\s+/g, " ").slice(0, 70))}${(e.desc || "").length > 70 ? "…" : ""}</p>${podJobHtml(key) || `<p class="note">還沒整理重點・點進去用 AI 整理</p>`}`}
    </div></article>`; }).join("");
  return `<h2 class="ph2">今日摘要</h2>${av}${cards || podEmpty(POD.busy ? "載入單集中…" : "這些節目最近沒有新單集。")}`;
}
function podEpView() {
  const key = POD.key, it = podEp(key); if (!it) return podEmpty("找不到這一集。");
  const { e, s } = it, m = podSums()[key], chars = m ? (m.points.join("") + m.sections.map(x => x.body).join("")).length : 0, calls = podCalls().filter(c => c.key === key);
  const unres = (m?.calls || []).filter(c => !c.code);
  return `<div class="ptop"><button class="linkbtn pback" data-pback>‹ 返回</button>${e.audio ? `<a class="btn sm" href="${esc(e.audio)}" target="_blank" rel="noopener">🎧 收聽</a>` : e.link ? `<a class="btn sm" href="${esc(e.link)}" target="_blank" rel="noopener">開啟原始頁面</a>` : ""}</div>
    <h2 class="ph1">${esc(e.title)}</h2>
    <div class="pmeta"><button class="linkbtn pshowlink" data-pshow="${esc(s.feed)}">${esc(s.name)}</button>${podBadge(s.feed)}</div>
    <p class="note">${twDate(e.date).replace(/-/g, "/")}${e.dur ? `・${Math.round(e.dur / 60)} 分鐘` : ""}${m ? `・閱讀約 ${Math.max(1, Math.round(chars / 350))} 分鐘` : ""}</p>
    ${e.audio ? `<audio class="paudio" controls preload="none" src="${esc(e.audio)}"></audio>` : ""}
    ${m ? `<div class="pkey"><div class="pkh">重點</div><ul>${m.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>
      ${m.sections.map(x => `<h3 class="psec">${esc(x.title)}</h3><p class="pbody">${esc(x.body)}</p>`).join("")}
      ${m.topics?.length ? `<p class="note ptopic">• 你可能感興趣的議題：${m.topics.map(t => `<span>${esc(t)}</span>`).join("、")}</p>` : ""}`
      : `${podJobHtml(key)}${podSumBtns(key, e)}${e.desc ? `<details class="pnotes"><summary>節目說明</summary><p class="pbody">${esc(e.desc)}</p></details>` : ""}`}
    <h2 class="ph2">觀點紀錄</h2>
    ${calls.length ? calls.map(c => podCallCard(c, false)).join("") : podEmpty(m ? "這集沒有整理到明確看多或看空的個股。" : "整理重點後，主持人明確看多／看空的個股會出現在這裡。")}
    ${unres.length ? `<p class="note">代號沒對上的：${unres.map(c => esc(c.name)).join("、")}（可以在下面用代號手動新增）</p>` : ""}
    <form class="padd" data-padd="${key}"><span class="note">手動新增觀點</span><input name="code" placeholder="代號，例 2330、NVDA" autocomplete="off" required><select name="dir"><option value="bull">看多</option><option value="bear">看空</option></select><input name="quote" placeholder="主持人怎麼說（選填）" maxlength="120"><button class="btn sm">新增</button></form>
    ${m ? `<p class="note pfoot">由 AI ${m.mode === "audio" ? "聽完整集" : "讀節目說明"}整理（${esc(m.model || "")}，${new Date(m.at + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}）。AI 可能聽錯或漏掉，引述是接近原話，請以節目為準；觀點表現用真實股價計算，不是投資建議。
      <button class="linkbtn" data-psum="${m.mode}" data-k="${key}">重新整理</button>${m.mode !== "audio" && POD.cfg?.audio && e.audio ? `<button class="linkbtn" data-psum="audio" data-k="${key}">改用 AI 聽完整集</button>` : ""}</p>${podJobHtml(key)}` : ""}`;
}
function podShowView() {
  const s = podShowOf(POD.feed), calls = podCalls(POD.feed).sort((a, b) => b.date.localeCompare(a.date)), st = podStats(calls), v = POD.feeds.get(POD.feed), S = podSums(), sim = podSim(calls, POD.sim), big = podSim(calls, { m: 24, mode: "follow", hold: 30 });
  const info = t => `<span class="pinfo" title="${esc(t)}">ⓘ</span>`, seg = (k, opts) => `<div class="seg" role="group">${opts.map(([val, t]) => `<button data-psim="${k}" data-v="${val}" aria-pressed="${String(POD.sim[k]) === String(val)}">${t}</button>`).join("")}</div>`;
  const frame = (t, d, f) => `<div class="pfr"><div class="note">${t}</div><div class="note">${d}</div>${f ? `<b class="${cls(f.avg)}">${podPct(f.avg)}</b><span class="note">${f.n} 個檢查點平均，與大盤相比</span>${f.avg > 0 ? '<span class="pwin">跑贏大盤</span>' : ""}` : `<b class="muted">—</b><span class="note">還沒有結算</span>`}</div>`;
  return `<div class="ptop"><button class="linkbtn pback" data-pback>‹ 返回</button>${podFollows().some(f => f.feed === POD.feed) ? "" : `<button class="btn sm" data-pfol="${esc(POD.feed)}">＋ 追蹤</button>`}</div>
    <div class="phead">${podArt(s, "part big")}<div><div class="note">往績評分</div><h2 class="ph1">${esc(s.name)}</h2><div class="note">${esc(s.author)}</div></div></div>
    <div class="pcard">
      ${podBadge(POD.feed)}
      ${st.settled ? `<div class="pscore"><b>${st.few ? "—" : st.score.toFixed(1)}</b><span class="note">/ 100 ${info("總分＝準確率 40%＋超額回報 40%＋一致性 20%。至少要 5 筆已結算的觀點才給分。")}</span></div>${st.few ? `<p class="note">樣本不足：已結算 ${st.settled} 筆（至少要 5 筆才給分）。多整理幾集就會有分數。</p>` : ""}`
        : `<p class="note">${calls.length ? (st.loading ? "載入股價中…" : "觀點都還沒到 7 天，還不能結算。") : "還沒有觀點紀錄。整理幾集之後，就會用真實股價追蹤主持人看多／看空的表現。"}</p>`}
      ${big.pts.length > 2 ? podSpark(big.pts, 300, 46) + `<p class="note">跟單累計超額報酬走勢（每個觀點持有 30 天）</p>` : ""}
      ${st.settled ? `<div class="pmet"><span>準確率 ${info("所有已結算檢查點（7／30／60／90／180／365 天）裡，方向對、而且跑贏大盤的比例。")}</span><b>${st.acc.toFixed(1)}</b></div>
        <div class="pmet"><span>超額回報 ${info("已結算觀點相對大盤的平均超額報酬換算成 0～100 分（0% 是 50 分）。目前平均 " + podPct(st.mean) + "。")}</span><b>${st.exS.toFixed(1)}</b></div>
        <div class="pmet"><span>一致性 ${info("每次結果的差異越小越高（超額報酬的標準差 25% 以上是 0 分）。")}</span><b>${st.cons.toFixed(1)}</b></div>` : ""}
      <h4 class="pfh">強項時間框架 ${info("依觀點發出後的持有天數分組，看哪個時間長度最準。")}</h4>
      <div class="pfrs">${frame("短線", "7–30 天", st.frames?.s)}${frame("中線", "60–90 天", st.frames?.m)}${frame("長線", "180–365 天", st.frames?.l)}</div>
    </div>
    <h2 class="ph2">跟單模擬器 <span class="note">假設跟著每個觀點做的累計超額報酬</span></h2>
    <div class="pcard">
      ${seg("m", [[1, "1個月"], [3, "3個月"], [6, "6個月"], [12, "1年"]])}
      ${seg("mode", [["follow", "跟單"], ["bull", "只跟看多"], ["rev", "反向操作"]])}
      <label class="note">每個觀點持有 <select data-psimhold>${[7, 30, 90].map(n => `<option value="${n}" ${POD.sim.hold === n ? "selected" : ""}>${n} 天</option>`).join("")}</select></label>
      <p class="note">${POD.sim.mode === "rev" ? "看多就放空、看空就買進" : POD.sim.mode === "bull" ? "只做看多的觀點" : "看多就買入，看空就放空"}</p>
      ${sim.n ? `<div class="psimr"><b class="${cls(sim.total)}">${podPct(sim.total)}</b><span>較大盤${sim.total >= 0 ? "多賺" : "少賺"}</span></div><p class="note">${sim.n} 個觀點，每個持有 ${POD.sim.hold} 日的累計</p>${podSpark(sim.pts, 300, 90)}`
        : `<p class="note">這段期間沒有可以模擬的觀點${calls.length ? "（或股價還在載入）" : ""}。</p>`}
      <p class="note">圖表是相對大盤的「超額報酬」，大盤本身就是 0% 的虛線；線在上面代表跑贏。台股觀點比加權指數的代表 ETF 0050、美股比 S&P 500 ETF SPY。進場價是節目上架後下一個交易日的開盤價，未計交易成本。這是回顧統計，不是投資建議。</p>
    </div>
    <h2 class="ph2">觀點紀錄</h2>
    ${calls.length ? calls.map(c => podCallCard(c)).join("") : podEmpty("還沒有觀點紀錄。")}
    <h2 class="ph2">單集 ${v ? `<span class="pbatch">${POD.cfg?.notes ? `<button class="btn sm" data-pbatch="notes" ${POD.job?.busy ? "disabled" : ""}>整理最近 5 集（節目說明）</button>${POD.cfg?.audio ? `<button class="btn sm" data-pbatch="audio" ${POD.job?.busy ? "disabled" : ""}>整理最近 3 集（聽完整集）</button>` : ""}` : ""}</span>` : ""}</h2>
    ${v ? `<ul class="peps">${v.eps.map(e => { const key = podKey(POD.feed, e.guid); return `<li data-pep="${key}" role="button" tabindex="0"><span>${esc(e.title)}</span><span class="note">${twDate(e.date).slice(5).replace("-", "/")}${S[key] ? "・✓ 已整理" : ""}</span></li>`; }).join("")}</ul>${POD.job?.busy ? podJobHtml(POD.job.key) : ""}` : podEmpty(POD.busy ? "載入中…" : "沒有單集資料。")}`;
}
function podRankView() {
  const shows = [...new Set([...podFollows().map(s => s.feed), ...Object.values(podSums()).map(s => s.feed)])].map(feed => ({ s: podShowOf(feed), st: podStats(podCalls(feed)) }));
  const ok = shows.filter(x => x.st.settled && !x.st.few), few = shows.filter(x => !(x.st.settled && !x.st.few));
  ok.sort((a, b) => (POD.rank === "expert" ? b.st.score - a.st.score : a.st.score - b.st.score));
  const row = (x, i) => `<tr data-pshow="${esc(x.s.feed)}" role="button"><td class="${i < 3 && x.st.settled && !x.st.few ? "ptop3" : ""}">${x.st.settled && !x.st.few ? i + 1 : ""}</td><td>${podArt(x.s, "part sm")}</td><td>${esc(x.s.name)}</td><td class="num">${x.st.settled && !x.st.few ? x.st.score.toFixed(1) : `<span class="note">${x.st.settled ? `樣本不足（${x.st.settled}）` : x.st.n ? "未結算" : "—"}</span>`}</td></tr>`;
  return `<div class="ptop"><h2 class="ph2" style="margin:0">${POD.rank === "expert" ? "專家排行榜" : "反指標排行榜"}</h2><div class="seg" role="group">${[["expert", "專家排行榜"], ["contra", "反指標排行榜"]].map(([k, t]) => `<button data-prk="${k}" aria-pressed="${POD.rank === k}">${t}</button>`).join("")}</div></div>
    <p class="note">${POD.rank === "expert" ? "依往績評分排名" : "分數最低的排前面：反著做反而可能跑贏"}。只計算你在這個瀏覽器整理過的單集；每個節目至少 5 筆已結算觀點才排名。</p>
    <table class="prank"><thead><tr><th>#</th><th></th><th>節目</th><th>分數</th></tr></thead><tbody>${[...ok, ...few].map(row).join("") || `<tr><td colspan="4" class="note">還沒有資料。</td></tr>`}</tbody></table>`;
}
function podFollowView() {
  const F = podFollows(), has = feed => F.some(s => s.feed === feed);
  const item = (s, act) => `<li class="pfi">${podArt(s, "part sm")}<span><b>${esc(s.name)}</b><span class="note">${esc(s.author || "")}${s.n ? `・${s.n} 集` : ""}</span></span>${act}</li>`;
  return `<form class="psearch" data-psearch><input name="q" placeholder="搜尋 Podcast 節目名稱，例：股癌、財經皓角" value="${esc(POD.q)}" autocomplete="off" enterkeyhint="search"><button class="btn sm primary">搜尋</button></form>
    ${POD.qErr ? `<p class="note">⚠ ${esc(POD.qErr)}</p>` : ""}
    ${POD.found ? `<ul class="pfl">${POD.found.map(s => item(s, has(s.feed) ? `<span class="note">已追蹤</span>` : `<button class="btn sm" data-pfol="${esc(s.feed)}">＋ 追蹤</button>`)).join("") || `<li class="note">找不到。也可以直接貼 RSS 網址。</li>`}</ul>` : ""}
    <h2 class="ph2">追蹤中（${F.length}）</h2>
    <ul class="pfl">${F.map(s => item(s, `<button class="btn sm" data-pshow="${esc(s.feed)}">往績</button><button class="btn sm" data-punf="${esc(s.feed)}">取消追蹤</button>`)).join("") || `<li class="note">還沒有追蹤節目。</li>`}</ul>
    <form class="psearch" data-prss><input name="rss" placeholder="或貼上節目的 RSS 網址（https://…）" autocomplete="off" inputmode="url"><button class="btn sm">加入</button></form>
    <p class="note">節目資料來自 Apple Podcasts 目錄與各節目公開的 RSS。重點整理與觀點紀錄只存在這個瀏覽器；換裝置要重新整理。</p>`;
}
function renderPod() {
  podBoot();
  const tab = ["ep", "show"].includes(POD.view) ? POD.hist.find(h => !["ep", "show"].includes(h.view))?.view || "home" : POD.view;
  $("#lTools").innerHTML = `<div class="seg" role="group" aria-label="名人" id="podSeg">${[["home", "今日摘要"], ["rank", "走勢"], ["follow", "追蹤清單"]].map(([k, t]) => `<button data-pv="${k}" aria-pressed="${tab === k}">${t}</button>`).join("")}</div>${POD.busy || POD.pxBusy ? '<span class="note">更新中…</span>' : `<button class="btn sm" data-prefresh>↻ 更新</button>`}`;
  const body = POD.view === "ep" ? podEpView() : POD.view === "show" ? podShowView() : POD.view === "rank" ? podRankView() : POD.view === "follow" ? podFollowView() : podHome();
  $("#lx").innerHTML = `<div class="pod">${POD.err ? `<p class="note">⚠ ${esc(POD.err)}</p>` : ""}${body}</div>`;
  return "名人 Podcast：AI 整理重點、追蹤主持人看多／看空的真實表現（相對大盤）。只是回顧統計，不是投資建議。";
}
function podGo(view, extra = {}) {
  POD.hist.push({ view: POD.view, feed: POD.feed, key: POD.key }); if (POD.hist.length > 30) POD.hist.shift();
  Object.assign(POD, { view, ...extra }); if (view === "show") podFeed(POD.feed).then(podRender).catch(() => {});
  podRender(); $("#lx").scrollTop = 0; try { window.scrollTo({ top: 0 }); } catch {}
}
function podInit() {
  const lx = $("#lx"), top = $("#lTools");
  top.addEventListener("click", e => {
    if (W.lt !== "pod") return; const b = e.target.closest("[data-pv]");
    if (b) { POD.hist = []; POD.view = b.dataset.pv; podRender(); }
    else if (e.target.closest("[data-prefresh]")) { podLoadFeeds(true); POD.px.clear(); POD.perf = new Map(); podLoadPx(); }
  });
  lx.addEventListener("click", e => {
    if (W.lt !== "pod" || e.target.closest("[data-sel]") || e.target.closest("audio,a,input,select,form button")) return; const t = e.target, g = s => t.closest(s);
    if (g("[data-pback]")) { const h = POD.hist.pop() || { view: "home" }; Object.assign(POD, h); podRender(); }
    else if (g("[data-psum]")) { const b = g("[data-psum]"); podSum(b.dataset.k, b.dataset.psum); }
    else if (g("[data-pdel]")) { const [key, id] = g("[data-pdel]").dataset.pdel.split("|"), s = podSums()[key]; if (s && confirm("刪除這筆觀點？")) { s.calls = s.calls.filter(c => c.id !== id); podSave(); POD.perf = new Map(); podRender(); } }
    else if (g("[data-pfol]")) { const feed = g("[data-pfol]").dataset.pfol, s = POD.found?.find(x => x.feed === feed) || { ...podShowOf(feed), feed }; store.set("pod:follows", [...podFollows().filter(f => f.feed !== feed), { id: s.id || podHash(feed), name: s.name, author: s.author, art: s.art, feed }]); podFeed(feed).then(podRender).catch(() => {}); podRender(); }
    else if (g("[data-punf]")) { const feed = g("[data-punf]").dataset.punf; store.set("pod:follows", podFollows().filter(f => f.feed !== feed)); podRender(); }
    else if (g("[data-prk]")) { POD.rank = g("[data-prk]").dataset.prk; podRender(); }
    else if (g("[data-psim]")) { const b = g("[data-psim]"), k = b.dataset.psim; POD.sim[k] = k === "m" ? +b.dataset.v : b.dataset.v; podRender(); }
    else if (g("[data-pbatch]")) { const m = g("[data-pbatch]").dataset.pbatch; podBatch(POD.feed, m === "audio" ? 3 : 5, m); }
    else if (g("[data-pshow]")) podGo("show", { feed: g("[data-pshow]").dataset.pshow });
    else if (g("[data-pep]")) podGo("ep", { key: g("[data-pep]").dataset.pep });
  });
  lx.addEventListener("keydown", e => { if (W.lt === "pod" && e.key === "Enter" && e.target.matches("[data-pep],[data-pshow]")) e.target.click(); });
  lx.addEventListener("change", e => { if (W.lt === "pod" && e.target.matches("[data-psimhold]")) { POD.sim.hold = +e.target.value; podRender(); } });
  lx.addEventListener("submit", async e => {
    if (W.lt !== "pod") return; const f = e.target; e.preventDefault();
    if (f.matches("[data-psearch]")) { POD.q = f.q.value.trim(); if (!POD.q) return; POD.qErr = null; POD.found = null; podRender();
      try { POD.found = (await getJ(`/api/podcast?q=${encodeURIComponent(POD.q)}`, true)).shows; } catch (err) { POD.qErr = err.message; } podRender(); }
    else if (f.matches("[data-prss]")) { const url = f.rss.value.trim(); if (!/^https?:\/\//.test(url)) return;
      try { const v = await podFeed(url, true); store.set("pod:follows", [...podFollows().filter(x => x.feed !== url), { id: podHash(url), name: v.show.name || url, author: v.show.author, art: v.show.art, feed: url }]); POD.qErr = null; } catch (err) { POD.qErr = err.message; } podRender(); }
    else if (f.matches("[data-padd]")) {
      const key = f.dataset.padd, code = f.code.value.trim().toUpperCase(), it = podEp(key); if (!okCode(code) || !it) { f.code.focus(); return; }
      const S = podSums(); S[key] ||= { tldr: "", points: [], sections: [], topics: [], calls: [], mode: "manual", at: Date.now(), feed: it.s.feed, guid: it.e.guid, title: it.e.title, date: it.e.date, show: it.s.name, audio: it.e.audio };
      S[key].calls.push({ id: Math.random().toString(36).slice(2, 9), code, name: nameOf(code), dir: f.dir.value === "bear" ? "bear" : "bull", quote: f.quote.value.trim().slice(0, 120), manual: true });
      podSave(); POD.perf = new Map(); podRender(); podLoadPx();
    }
  });
  const css = document.createElement("style"); css.textContent = `
.pod { padding: 4px 14px 24px; max-width: 980px; margin: 0 auto; }
.pod .ph1 { font-size: 22px; margin: 6px 0 4px; line-height: 1.35; font-weight: 500; } .pod .ph2 { font-size: 18px; margin: 22px 0 10px; font-weight: 500; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pod .ptop { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 6px 0; }
.pod .pback { font-size: 15px; }
.pod .part { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex: none; background: var(--surface-3); border: 1px solid var(--line); }
.pod .part.big { width: 72px; height: 72px; border-radius: 6px; } .pod .part.sm { width: 36px; height: 36px; }
.pod .pnoart { display: inline-grid; place-items: center; font-size: 13px; color: var(--muted); }
.pod .pavs { display: flex; gap: 14px; overflow-x: auto; padding: 4px 0 12px; scrollbar-width: none; border-bottom: 1px solid var(--line); }
.pod .pav { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer; width: 76px; flex: none; color: var(--ink); }
.pod .pav .part { width: 64px; height: 64px; } .pod .pav > span:last-child { font-size: 12px; text-align: center; line-height: 1.3; max-height: 2.6em; overflow: hidden; }
.pod .pep { display: flex; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.pod .pep:hover h4 { text-decoration: underline; } .pod .pepb { min-width: 0; flex: 1; }
.pod .pep h4 { margin: 4px 0 6px; font-size: 16.5px; font-weight: 500; line-height: 1.45; }
.pod .pmeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13.5px; }
.pod .ptl { margin: 0 0 4px; color: var(--muted); line-height: 1.65; } .pod .ptopic span { color: var(--up); }
.pod .pbadge { font-size: 12px; padding: 1px 9px; border-radius: 99px; background: var(--surface-3); border: 1px solid var(--line); white-space: nowrap; }
.pod .pbadge.gold { background: #f7e7b4; color: #6b4e00; border-color: #e9cf7a; } .pod .pbadge.low { opacity: .75; }
.pod .paudio { width: 100%; margin: 8px 0; }
.pod .pkey { border-left: 3px solid var(--up); padding: 4px 0 4px 14px; margin: 14px 0; } .pod .pkh { color: var(--up); font-size: 13px; margin-bottom: 4px; }
.pod .pkey ul { margin: 0; padding-left: 20px; } .pod .pkey li { margin: 6px 0; line-height: 1.75; } .pod .pkey li::marker { color: var(--up); }
.pod .psec { font-size: 16px; font-weight: 500; margin: 18px 0 6px; } .pod .pbody { line-height: 1.85; margin: 0 0 8px; white-space: pre-wrap; }
.pod .pcall { border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; margin: 10px 0; background: var(--grad-panel, var(--surface)); }
.pod .pch { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .pod .pst { margin-left: auto; }
.pod .pcode { font-family: var(--font-mono); font-size: 15px; border: 0; background: none; color: var(--ink); cursor: pointer; padding: 0; text-decoration: underline dotted; } .pod .pname { font-size: 13px; color: var(--muted); }
.pod .pdir { font-size: 12px; padding: 1px 9px; border-radius: 99px; color: #fff; } .pod .pdir.bull { background: var(--up); } .pod .pdir.bear { background: var(--down); }
.pod .pmain { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; } .pod .pex { font-size: 26px; font-weight: 500; font-family: var(--font-num); }
.pod .pq { margin: 6px 0 8px; padding: 8px 12px; border-left: 3px solid var(--up); background: var(--accent-soft); border-radius: 4px; line-height: 1.7; } .pod .pq.bear { border-left-color: var(--down); }
.pod .pspark { display: block; width: 100%; height: 56px; margin: 4px 0; } .pod .pl { fill: none; stroke-width: 1.7; vector-effect: non-scaling-stroke; } .pod .pl.up { stroke: var(--up); } .pod .pl.down { stroke: var(--down); }
.pod .pbase { stroke: var(--muted); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; opacity: .6; }
.pod .pcks { display: flex; gap: 3px; margin-top: 6px; } .pod .pcks span { height: 6px; border-radius: 3px; min-width: 6px; }
.pod .pcks .win { background: var(--up); } .pod .pcks .lose { background: var(--down); } .pod .pcks .open { background: repeating-linear-gradient(135deg, var(--line) 0 4px, transparent 4px 7px); }
.pod .pckl { display: flex; gap: 3px; font-size: 10.5px; color: var(--muted); } .pod .pckl span { text-align: right; min-width: 6px; white-space: nowrap; overflow: visible; }
.pod .pcf { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 8px; } .pod .pdel { margin-left: auto; color: var(--muted); }
.pod .padd { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 12px 0; } .pod .padd input { flex: 1 1 140px; min-width: 0; }
.pod input, .pod select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-3); color: var(--ink); }
.pod .pjob { margin: 10px 0; padding: 10px 12px; border-radius: 6px; background: var(--accent-soft); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .pod .pjob.err { color: var(--down); }
.pod .pspin { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--ink); border-radius: 50%; animation: pspin 1s linear infinite; } @keyframes pspin { to { transform: rotate(360deg); } }
.pod .psumbtns { gap: 8px; margin: 12px 0 4px; display: flex; flex-wrap: wrap; }
.pod .pnotes summary { cursor: pointer; color: var(--muted); margin: 10px 0; }
.pod .phead { display: flex; gap: 14px; align-items: center; margin: 6px 0 14px; }
.pod .pcard { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--grad-panel, var(--surface)); display: flex; flex-direction: column; gap: 10px; }
.pod .pcard > .pbadge { align-self: flex-start; font-size: 13px; }
.pod .pscore { display: flex; align-items: baseline; gap: 8px; } .pod .pscore b { font-size: 56px; font-weight: 300; line-height: 1; font-family: var(--font-num); }
.pod .pmet { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--line); } .pod .pmet b { font-size: 20px; font-weight: 500; font-family: var(--font-num); }
.pod .pinfo { color: var(--muted); cursor: help; font-size: 13px; }
.pod .pfh { margin: 10px 0 0; font-size: 14px; font-weight: 500; color: var(--muted); }
.pod .pfrs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.pod .pfr { border: 1px solid var(--line); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; } .pod .pfr b { font-size: 20px; font-weight: 500; font-family: var(--font-num); }
.pod .pwin { align-self: flex-start; font-size: 11px; padding: 1px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--up); }
.pod .psimr { display: flex; align-items: baseline; gap: 8px; } .pod .psimr b { font-size: 40px; font-weight: 300; font-family: var(--font-num); }
.pod .pcard .pspark { height: 90px; } .pod .pcard .seg { align-self: flex-start; flex-wrap: wrap; }
.pod .peps { list-style: none; margin: 0; padding: 0; } .pod .peps li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); cursor: pointer; } .pod .peps li:hover { background: var(--surface-2); }
.pod .pbatch { display: inline-flex; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.pod .prank { width: 100%; border-collapse: collapse; } .pod .prank th { text-align: left; font-weight: 400; color: var(--muted); font-size: 12.5px; padding: 8px 6px; border-bottom: 1px solid var(--line); }
.pod .prank td { padding: 10px 6px; border-bottom: 1px solid var(--line); } .pod .prank tr[role="button"] { cursor: pointer; } .pod .prank tbody tr:hover { background: var(--surface-2); }
.pod .prank td:last-child, .pod .prank th:last-child { text-align: right; } .pod .prank td.num { font-size: 20px; font-family: var(--font-num); } .pod .ptop3 { color: var(--up); }
.pod .psearch { display: flex; gap: 6px; margin: 10px 0; } .pod .psearch input { flex: 1; min-width: 0; }
.pod .pfl { list-style: none; margin: 0; padding: 0; } .pod .pfi { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); } .pod .pfi > span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pod .pempty { padding: 18px 0; } .pod .pfoot { margin-top: 18px; line-height: 1.7; }
@media (max-width: 520px) { .pod .pfrs { grid-template-columns: 1fr; } .pod .pex { font-size: 22px; } .pod .pscore b { font-size: 46px; } }`;
  document.head.appendChild(css);
}
