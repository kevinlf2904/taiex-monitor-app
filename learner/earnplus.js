/* ================= 情報局「財報」第二批：體質（存貨、應收帳款、自由現金流）、股利預估、法說會重點（AI 讀簡報）、公布前後的股價習慣 =================
   台股公司展開後：finrep.js 的財報分析下面接 epTW（體質＋股利預估，用 /api/company），earnx.js 的整體看法下面接 epConf（法說會，/api/confai）。
   股價習慣在 earnx.js 的 exReactTw（月營收公布前後）、exUsHist（美股財報公布隔天）；美股財測在 earn.js 的「財測」分頁。
   全部只用公開財報數字照公式算，AI 只整理公司自己的簡報；不是投資建議。
   用到 finrep.js 的 frYi、frPctTxt，earn.js 的 erNum，watch.html 的 W、esc、cls、renderList、barLineSvg、tmo。 */
const EP = { conf: {}, sum: {}, cmp: {}, pre: null };
const epYoY = (L, k) => { const a = L.at(-1)?.[k], b = L.at(-5)?.[k]; return a != null && b ? (a / b - 1) * 100 : null; };
// 體質：存貨、應收帳款跟營收比誰長得快；存貨週轉天數（用營收估）；近 8 季自由現金流
function epHealth(C) {
  const Q = (C.income || []).filter(x => x.rev != null), B = C.balance || [], Cs = (C.cash || []).slice(-8), out = [];
  const rv = Q.length >= 5 && Q.at(-5).rev ? (Q.at(-1).rev / Q.at(-5).rev - 1) * 100 : null, days = b => (b?.inv != null && Q.find(x => x.q === b.q)?.rev ? b.inv / Q.find(x => x.q === b.q).rev * 91 : null);
  for (const [k, name, what] of [["inv", "存貨", "存貨堆得比營收快，可能賣不動或在備貨，要看下一季營收有沒有跟上"], ["ar", "應收帳款", "應收帳款增加得比營收快，代表收錢變慢，要留意客戶付款狀況"]]) {
    const g = epYoY(B, k); if (g == null) continue; const gap = rv != null ? g - rv : null;
    out.push(`<li class="${gap > 20 ? "warn" : ""}"><span>${name}年增</span><b class="${gap > 20 ? "epwarn" : ""}">${gap > 20 ? "⚠︎ " : ""}${frPctTxt(g)}</b><small class="note">${rv != null ? `營收年增 ${frPctTxt(rv)}・${gap > 20 ? what : gap < -10 ? `${name}比營收增加得慢，體質變好` : "和營收差不多"}` : ""}</small></li>`); }
  const d0 = days(B.at(-1)), d1 = days(B.at(-5));
  if (d0 != null) out.push(`<li><span>存貨週轉天數</span><b>${Math.round(d0)} 天</b><small class="note">${d1 != null ? `一年前 ${Math.round(d1)} 天・${d0 > d1 * 1.2 ? "變慢，存貨要更久才賣得掉" : d0 < d1 * 0.85 ? "變快，賣得比較順" : "差不多"}` : ""}（存貨 ÷ 單季營收 × 91 天，粗估）</small></li>`);
  if (!out.length && Cs.length < 4) return "";
  const fcf = Cs.filter(x => x.fcf != null);
  return `<h4>體質：存貨、應收、現金流<span class="note">${esc(B.at(-1)?.q || "")}</span></h4>${out.length ? `<ul class="epkv">${out.join("")}</ul>` : ""}
    ${fcf.length >= 4 ? `<h4>自由現金流（近 ${fcf.length} 季）</h4>${barLineSvg(fcf.map(x => ({ label: x.q.slice(2), v: +(x.fcf / 1e8).toFixed(1), y: x.ocf != null ? +(x.ocf / 1e8).toFixed(1) : null })), { fmtV: v => v + " 億", fmtY: v => v + " 億" })}
      <p class="note">柱＝自由現金流（營業現金流 − 資本支出），線＝營業現金流。${fcf.slice(-4).every(x => x.fcf > 0) ? "近四季都是正的，有餘力配息、還債。" : fcf.slice(-4).filter(x => x.fcf < 0).length >= 2 ? "近四季有兩季以上是負的：擴廠期間常見，但要確認營業現金流本身是正的。" : ""}</p>` : ""}`;
}
// 股利預估：近四季 EPS × 過去三年平均配息率；殖利率用最新股價
function epDiv(c, C) {
  const Q = (C.income || []).filter(x => x.eps != null), D = (C.dividend || []).filter(x => x.cash > 0); if (Q.length < 4 || !D.length) return "";
  const epsY = y => { const L = Q.filter(x => x.q.startsWith(y + "Q")); return L.length === 4 ? L.reduce((s, x) => s + x.eps, 0) : null; };
  const P = D.map(x => ({ y: x.y, cash: x.cash, eps: epsY(x.y) })).filter(x => x.eps > 0).slice(-3).map(x => ({ ...x, r: x.cash / x.eps }));
  const eps4 = Q.slice(-4).reduce((s, x) => s + x.eps, 0); if (!P.length || eps4 <= 0) return `<h4>股利預估</h4><p class="note">${eps4 <= 0 ? "近四季虧損，沒辦法用配息率估算。" : "過去的配息和 EPS 對不起來，沒辦法估算。"}</p>`;
  const avg = P.reduce((s, x) => s + x.r, 0) / P.length, est = eps4 * avg, px = W.quotes?.get(c)?.price ?? EX.k["k:" + c]?.rows?.at(-1)?.c ?? null;
  const mon = D.map(x => x.ex?.slice(5, 7)).filter(Boolean), m = mon.length ? Object.entries(mon.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0][0] : null;
  return `<h4>股利預估<span class="note">近四季 EPS × 平均配息率</span></h4><div class="d-kv sxkv"><div><span>預估全年現金股利</span><b>${est.toFixed(2)} 元</b></div><div><span>預估殖利率</span><b>${px ? (est / px * 100).toFixed(2) + "%" : "—"}</b>${px ? `<small class="note">股價 ${erNum(px)}</small>` : ""}</div><div><span>平均配息率</span><b>${(avg * 100).toFixed(0)}%</b><small class="note">${P.map(x => `${x.y}：${(x.r * 100).toFixed(0)}%`).join("、")}</small></div>${m ? `<div><span>常在幾月除息</span><b>${+m} 月</b></div>` : ""}</div>
    <p class="note">近四季 EPS ${eps4.toFixed(2)} 元。配息率大於 100% 代表配的比賺的多，難持續；公司實際配多少由董事會決定，這只是照過去習慣的估算。</p>`;
}
const epTW = (c, C) => `<div class="epbox">${epHealth(C)}${epDiv(c, C)}</div>`;
// 法說會：展開公司就自動到觀測站找今年和去年的法說會，最近一次有簡報的直接請 AI 讀簡報整理重點（同一份簡報整理過伺服器會記住，第二個人打開是秒回）
// 大公司的簡報排程每天先整理好（scripts/confai-sync.mjs → data/confai.json），有的話直接用，不用等 AI
async function epConfLoad(c) {
  EP.conf[c] = { loading: true };
  const pre = EP.pre ? null : fetch("data/confai.json", { cache: "no-cache", signal: tmo(15000) }).then(r => (r.ok ? r.json() : { sums: {} })).catch(() => ({ sums: {} }));
  try { EP.conf[c] = await getJ(`/api/confai?code=${encodeURIComponent(c)}`, true); } catch (e) { EP.conf[c] = { err: e.message }; } if (pre) EP.pre = await pre; if (W.lt === "earn") renderList();
}
async function epSum(c, file) {
  EP.sum[file] = { loading: true };
  try { const r = await fetch("/api/confai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c, file, name: typeof nameOf === "function" ? nameOf(c) : c }), signal: tmo(65000) });
    const j = await r.json().catch(() => null); EP.sum[file] = j?.ok ? j : { err: j?.error || (r.status === 404 ? "需要部署到網站才能使用" : `服務回應 ${r.status}`) }; }
  catch (e) { EP.sum[file] = { err: e.name === "TimeoutError" || e.name === "AbortError" ? "AI 太久沒回應，請再試一次" : "連不到伺服器" }; }
  if (W.lt === "earn") renderList();
}
// 跟上一季比：上一季（比這份早 40 天以上的另一份簡報，和 api/_lib/confai.js 的 prevConf 一樣）也整理好時，請 AI 比較兩份重點；排程比過的直接用
const epDay = (c, f) => Date.parse(String(f).slice(c.length, c.length + 8).replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3"));
const epPrev = (L, f, c) => (f?.file ? L.find(x => x.file && x.file !== f.file && epDay(c, f.file) - epDay(c, x.file) >= 40 * 864e5) || null : null);
async function epCmpRun(c, f, p, a, b) {
  const k = f + "|" + p; EP.cmp[k] = { loading: true };
  try { const r = await fetch("/api/confai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "cmp", code: c, file: f, prev: p, a, b, name: typeof nameOf === "function" ? nameOf(c) : c }), signal: tmo(50000) });
    const j = await r.json().catch(() => null); EP.cmp[k] = j?.ok ? j : { err: j?.error || `服務回應 ${r.status}` }; }
  catch (e) { EP.cmp[k] = { err: e.name === "TimeoutError" || e.name === "AbortError" ? "AI 太久沒回應，請再試一次" : "連不到伺服器" }; }
  if (W.lt === "earn") renderList();
}
function epCmpHtml(c, f, p, R) {
  const B = EP.sum[p.file] || EP.pre?.sums?.[p.file], k = f.file + "|" + p.file, pre = EP.pre?.cmps?.[f.file], C = EP.cmp[k] || (pre?.prev === p.file ? pre : null), d = p.date.replace(/-/g, "/"), H = `<div class="pkh">跟上一季比<span class="note">${d} 的簡報</span></div>`;
  if (!C) {
    if (B?.head) { setTimeout(() => !EP.cmp[k] && epCmpRun(c, f.file, p.file, R, B)); return `${H}<p class="note">AI 比較兩季中…</p>`; }
    return B?.loading ? `${H}<p class="note">AI 讀上一季的簡報中…</p>` : `${H}${B?.err ? `<p class="note">⚠︎ ${esc(B.err)}</p>` : ""}<button type="button" class="btn sm" data-epsum="${esc(c)}|${esc(p.file)}">跟上一季比（AI 讀 ${d} 的簡報）</button>`;
  }
  if (C.loading) return `${H}<p class="note">AI 比較兩季中…</p>`;
  if (C.err) return `${H}<p class="note">⚠︎ ${esc(C.err)} <button type="button" class="btn sm" data-epcmp="${esc(c)}|${esc(f.file)}|${esc(p.file)}">再試一次</button></p>`;
  return `<div class="epcmp">${H}<p><b class="eptone ${C.tone === "更樂觀" ? "up" : C.tone === "更保守" ? "down" : ""}">${esc(C.tone)}</b> ${esc(C.head || "")}</p>
    ${C.changes?.length ? `<ul>${C.changes.map(x => `<li><b>${esc(x.k)}</b><span>這一季：${esc(x.now || "—")}</span><small class="note">上一季：${esc(x.before || "—")}</small></li>`).join("")}</ul>` : ""}</div>`;
}
function epConf(c) {
  const S = EP.conf[c], H = `<h4>法說會重點</h4>`; if (!S && !W.off) setTimeout(() => !EP.conf[c] && epConfLoad(c)); // 畫完再開始載入（避免在畫面組字串時又重畫）
  if (!S || S.loading) return `${H}<p class="note">找今年和去年的法說會…</p>`;
  if (S.err || S.ok === false) return `${H}<p class="note">⚠︎ ${esc(S.err || S.error)} <button type="button" class="btn sm" data-epconf="${esc(c)}">再試一次</button></p>`;
  const L = S.list || []; if (!L.length) return `${H}<p class="note">今年和去年都沒有法說會的紀錄（不是每家公司都會開）。</p>`;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), next = L.filter(x => x.date > today).at(-1);
  const f = L.find(x => x.file && x.date <= today) || L.find(x => x.file), R = f ? EP.sum[f.file] || EP.pre?.sums?.[f.file] : null, pdf = x => `https://mopsov.twse.com.tw/nas/STR/${x}`; // 選哪一場和 api/_lib/confai.js 的 pickConf 一樣
  if (f && !R && !W.off) setTimeout(() => !EP.sum[f.file] && epSum(c, f.file)); // 有簡報就直接請 AI 整理
  const sum = !f ? `<p class="note">最近幾次都沒有上傳簡報檔，AI 沒辦法整理。</p>` : !R || R.loading ? `<p class="note">AI 讀 ${f.date.replace(/-/g, "/")} 的簡報中（第一次約 20～60 秒，整理過的會直接顯示）…</p>`
    : R.err ? `<p class="note">⚠︎ ${esc(R.err)} <button type="button" class="btn sm" data-epsum="${esc(c)}|${esc(f.file)}">再試一次</button></p>`
    : `<div class="epsum"><p class="frsum"><b>${esc(R.head)}</b></p>${R.outlook.length ? `<div class="pkh">展望與指引</div><ul>${R.outlook.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${[["毛利率、營益率", R.margin], ["資本支出、擴產", R.capex], ["需求", R.demand]].filter(x => x[1]).map(([t, v]) => `<p><span class="note">${t}</span><br>${esc(v)}</p>`).join("")}
      ${R.risks.length ? `<div class="pkh">風險</div><ul>${R.risks.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${R.quotes.length ? `<div class="pkh">簡報原文</div><ul class="epq">${R.quotes.map(x => `<li>「${esc(x)}」</li>`).join("")}</ul>` : ""}
      ${(p => (p ? epCmpHtml(c, f, p, R) : ""))(epPrev(L, f, c))}
      <p class="note">AI 只根據公司簡報整理，可能有誤，數字請以簡報為準；不是投資建議。</p></div>`;
  return `<h4>法說會重點<span class="note">${f ? `${f.date.replace(/-/g, "/")} 的簡報` : ""}</span></h4>${next ? `<p class="note">下一場：${next.date.slice(5).replace("-", "/")} ${esc(next.time || "")}</p>` : ""}${sum}
    <ul class="epconf">${L.slice(0, 4).map(x => `<li><b>${x.date.slice(5).replace("-", "/")}</b> ${esc(x.note || "")}${x.file ? ` <a href="${pdf(x.file)}" target="_blank" rel="noopener">簡報</a>` : ""}${x.en ? ` <a href="${pdf(x.en)}" target="_blank" rel="noopener">英文</a>` : ""}</li>`).join("")}</ul>`;
}
$("#lx").addEventListener("click", e => {
  if (W.lt !== "earn") return; const a = e.target.closest("[data-epconf]"), b = e.target.closest("[data-epsum]");
  const m = e.target.closest("[data-epcmp]");
  if (a) epConfLoad(a.dataset.epconf); else if (b) { const [c, f] = b.dataset.epsum.split("|"); epSum(c, f); }
  else if (m) { const [c, f, p] = m.dataset.epcmp.split("|"); delete EP.cmp[f + "|" + p]; renderList(); }
});
{ const css = document.createElement("style"); css.textContent = `.epbox { margin-top: 6px; } .epkv { list-style: none; margin: 4px 0; padding: 0; } .epkv li { display: grid; grid-template-columns: minmax(0, 8em) auto; gap: 0 10px; padding: 6px 0; border-top: 1px solid var(--line); } .epkv li:first-child { border-top: 0; } .epkv small { grid-column: 1 / -1; }
.epsum ul, .epconf { margin: 4px 0 8px; padding-left: 1.2em; line-height: 1.6; } .epsum p { margin: 6px 0; line-height: 1.6; } .epconf { list-style: none; padding: 0; font-size: 13px; } .epconf li { padding: 4px 0; border-top: 1px solid var(--line); } .epconf a { margin-left: 4px; } .epq li { color: var(--muted); } .epbox .d-kv small { display: block; }
.epcmp ul { list-style: none; padding: 0; } .epcmp li { display: grid; gap: 2px; padding: 6px 0; border-top: 1px solid var(--line); } .epcmp li b { font-size: 13px; } .eptone { padding: 1px 6px; border-radius: 4px; border: 1px solid currentColor; font-size: 12px; } .epwarn { color: var(--ink); }`; document.head.appendChild(css); }
