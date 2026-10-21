/* ================= 情報局「大盤 → 官方公告」：證交所、櫃買中心開放資料的公告類資料 =================
   資料：/api/oapi?official=1（api/_lib/official.js 整理），15 分鐘內不重抓。分頁：重大訊息、風險警示、新股、興櫃、定期定額、融資融券、券商進出、鉅額交易、休市日。
   另外提供：個股徽章（offFlags，watch.html 的 intelData 用）、節目觀點頁的「異常推介個股」提醒（offAbnHtml，podcast.js 用）。
   點擊用 data-mk="off…"，watch.html 的 data-mk 處理交給 offMk()。用到 watch.html 的 W、esc、cls、store、renderList、getJ、mkSeg、nameOf、allWatched，tools.js 的 rkList、rkCards，congx.js 的 cxQ。 */
const OFF_VIEWS = [["news", "重大訊息"], ["risk", "風險警示"], ["ipo", "新股"], ["esb", "興櫃"], ["dca", "定期定額"], ["margin", "融資融券"], ["broker", "券商進出"], ["block", "鉅額交易"], ["holiday", "休市日"]];
const OFFS = () => (W.offs ||= { view: "news", scope: "all", esb: "up", mg: "up", ...(store.get("watch:off", null) || {}) });
const offSave = () => { const O = OFFS(); store.set("watch:off", { view: O.view, scope: O.scope, esb: O.esb, mg: O.mg }); };
async function offLoad(force = false) {
  if (W.off || W.offBusy || (!force && W.offc && Date.now() - W.offc.got < (W.offc.err ? 30e3 : 15 * 60e3))) return W.offc; // 失敗的 30 秒後可以再試
  W.offBusy = true;
  try { const j = await getJ("/api/oapi?official=1"); // 缺的清單補成空的，畫面不用到處判斷
    W.offc = { ...j, ...Object.fromEntries(["news", "abn", "fines", "ctrl", "short3", "alt", "dca", "broker", "block", "holiday"].map(k => [k, Array.isArray(j[k]) ? j[k] : []])), ipo: j.ipo || {}, esb: j.esb || {}, margin: j.margin || {}, got: Date.now() }; } catch (e) { W.offc = { err: e.message, got: Date.now() }; } finally { W.offBusy = false; }
  if ((W.lt === "mkt" && W.mkReg === "off") || W.lt === "pod") renderList(); if (W.sel && typeof renderIntel === "function") renderIntel();
  return W.offc;
}
function offMk(k, v) {
  const O = OFFS();
  if (k === "offV") O.view = v; else if (k === "offScope") O.scope = v; else if (k === "offEsb") O.esb = v; else if (k === "offMg") O.mg = v; else return false;
  offSave(); renderList(); return true;
}
const offMd = d => (d ? d.slice(5).replace("-", "/") : "—"), offYmd = d => (d ? d.replace(/-/g, "/") : "—");
const offSec = (title, sub, body) => `<section class="mk off">${title ? `<h3>${title}${sub ? `<span class="note">${sub}</span>` : ""}</h3>` : ""}${body}</section>`;
const offNone = t => `<p class="note" style="padding:4px 2px">${t}</p>`;
const offNm = (c, n) => `${esc(n || nameOf(c))} <small class="note">${esc(c)}</small>`;
// 篩選：自選＋庫存／全部、搜尋代號或名稱（每一頁共用）
function offFilter(rows, ci = 0, ni = 1) {
  const O = OFFS(), q = (W.offQ || "").trim().toUpperCase(), mine = O.scope === "mine" ? new Set([...allWatched(), ...Object.keys(W.hold || {})]) : null;
  return rows.filter(r => (!mine || mine.has(r[ci])) && (!q || String(r[ci]).startsWith(q) || String(r[ni] || "").toUpperCase().includes(q)));
}

function renderOff(top) {
  const O = OFFS(), D = W.offc;
  const bar = `<div class="mn-days mkseg otcv">${OFF_VIEWS.map(([k, t]) => `<button type="button" data-mk="offV" data-v="${k}" aria-pressed="${O.view === k}">${t}</button>`).join("")}</div>`;
  if (!D) { $("#lx").innerHTML = top + bar + `<p class="note" style="padding:12px">${W.off ? "需要部署到網站才有官方公告。" : "載入證交所、櫃買中心公告…"}</p>`; offLoad(); return; }
  if (D.err || !D.ok) { $("#lx").innerHTML = top + bar + `<p class="note err" style="padding:12px">⚠︎ ${esc(D.err || D.error || "暫時拿不到資料")}</p>`; return; }
  const filt = !["dca", "holiday"].includes(O.view) ? `<div class="cx-row" style="padding:0 12px"><span class="cx-lab">篩選</span><div class="cx-body">${mkSeg("offScope", O.scope, [["all", "全部"], ["mine", "自選＋庫存"]])}${cxQ("offQ", "搜尋代號或名稱")}</div></div>` : "";
  const f = { news: offNewsHtml, risk: offRiskHtml, ipo: offIpoHtml, esb: offEsbHtml, dca: offDcaHtml, margin: offMarginHtml, broker: offBrokerHtml, block: offBlockHtml, holiday: offHolHtml }[O.view] || offNewsHtml;
  $("#lx").innerHTML = top + bar + filt + `<div class="offbox">${f(D)}</div><p class="note" style="padding:4px 12px 12px">資料：證交所、櫃買中心開放資料（${D.at ? `整理於 ${new Date(Date.parse(D.at) + 8 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ")}` : ""}，約 15 分鐘更新）${D.miss?.length ? `；這次有 ${D.miss.length} 份暫時抓不到` : ""}。以官方公告為準。</p>`;
}

// 重大訊息：時間、公司、主旨，點開看說明
function offNewsHtml(D) {
  const L = offFilter(D.news, 2, 3);
  return offSec("上市櫃每日重大訊息", `${L.length} 則`, L.length ? `<ul class="offnews">${L.slice(0, 200).map(r => `<li><details><summary><span class="note">${offMd(r[0])} ${esc(r[1])}</span><button type="button" class="linkbtn" data-sel="${esc(r[2])}">${offNm(r[2], r[3])}</button><span class="offt">${esc(r[5])}</span></summary>
    <p class="note">${esc(r[4])}・${esc(r[6] || "")}</p><p>${esc(r[7])}</p></details></li>`).join("")}</ul>` : offNone("沒有符合的重大訊息（自選、庫存今天沒有發布，或還沒到公告時間）。"))
    + `<p class="note" style="padding:0 12px">重大訊息是公司依規定即時公告的事件（董事會決議、取得處分資產、澄清媒體報導…），主旨只是摘要，請點開看說明或到公開資訊觀測站看全文。</p>`;
}
// 風險警示：裁罰、違反資訊申報、經營權異動、董監持股不足、變更交易／暫停、節目異常推介
function offRiskHtml(D) {
  const fines = offFilter(D.fines, 1, 2), ctrl = offFilter(D.ctrl, 1, 2), s3 = offFilter(D.short3.map(r => [r[0], nameOf(r[0]), r[1], r[2]])), alt = offFilter(D.alt), abn = offFilter(D.abn, 1, 2);
  const li = (c, n, sub, val, vsub, vc = "") => ({ mono: "", attr: `data-sel="${esc(c)}"`, name: offNm(c, n), sub, val, vc, vsub, star: c });
  return offSec("投資理財節目異常推介個股", D.abnDate ? `證交所 ${offYmd(D.abnDate)} 公布` : "", abn.length ? rkList(abn.map(r => li(r[1], r[2], "被證交所點名：節目推介異常", offMd(r[0]), "", "down"))) : offNone("最近一次公布沒有點名個股。"))
    + offSec("變更交易、暫停交易、管理股票", `${alt.length} 檔`, alt.length ? rkList(alt.map(r => li(r[0], r[1], r[2], esc(r[3]), "", "down"))) : offNone("目前沒有。"))
    + offSec("金管會裁罰、違反資訊申報", `${fines.length} 筆`, fines.length ? `<ul class="offnews">${fines.slice(0, 80).map(r => `<li><details><summary><span class="note">${offYmd(r[0])}</span><button type="button" class="linkbtn" data-sel="${esc(r[1])}">${offNm(r[1], r[2])}</button><span class="offt"><b class="down">${esc(r[4])}</b> ${esc(r[7])}</span></summary><p>${esc(r[5])}</p><p class="note">${esc(r[6])}</p></details></li>`).join("")}</ul>` : offNone("沒有符合的裁罰。"))
    + offSec("經營權異動", `${ctrl.length} 家`, ctrl.length ? `<ul class="offnews">${ctrl.map(r => `<li><details><summary><span class="note">${offYmd(r[0])}</span><button type="button" class="linkbtn" data-sel="${esc(r[1])}">${offNm(r[1], r[2])}</button></summary><p>${esc(r[4])}</p></details></li>`).join("")}</ul>` : offNone("沒有。"))
    + offSec("董監持股不足法定成數，連續 3 個月以上", `${s3.length} 家`, s3.length ? rkList(s3.map(r => li(r[0], r[1], r[3], r[2] > 12 ? "1 年以上" : `${r[2]} 個月`, "連續不足", "down"))) : offNone("沒有。"))
    + `<p class="note" style="padding:0 12px">這些是交易所公布的「要多留意」的事件，不代表一定是壞消息；變更交易、管理股票要預收款券，流動性變差。</p>`;
}
// 新股：首五日無漲跌幅、最近上市、申請上市櫃、終止上市
function offIpoHtml(D) {
  const P = D.ipo || {}, f5 = offFilter(P.first5 || []), L = offFilter(P.listed || []), A = offFilter(P.apply || []), X = offFilter(P.delist || []);
  return offSec("首五日無漲跌幅", "剛掛牌的新股", f5.length ? rkList(f5.map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: offNm(r[0], r[1]), sub: `${r[2]}・${offMd(r[3])}～${offMd(r[4])}`, val: r[5] != null ? `承銷價 ${r[5]}` : "", star: r[0] }))) : offNone("目前沒有在首五日的新股。"))
    + offSec("最近上市", `${L.length} 家`, L.length ? rkList(L.slice(0, 40).map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: offNm(r[0], r[1]), sub: `${esc(r[5] || "")}${r[6] ? "・" + esc(r[6]) : ""}`, val: offYmd(r[3]), vsub: r[4] != null ? `承銷價 ${r[4]}` : "", star: r[0] }))) : offNone("沒有。"))
    + offSec("申請上市、上櫃", `${A.length} 家・最近兩年`, A.length ? rkList(A.slice(0, 60).map(r => ({ mono: "", name: offNm(r[0], r[1]), sub: `${r[2]}・申請 ${offYmd(r[3])}${r[4] ? "・" + esc(r[4]) : ""}`, val: esc(r[6]), vsub: r[5] != null ? `承銷價 ${r[5]}` : "" }))) : offNone("沒有。"))
    + offSec("終止上市", `${X.length} 家・最近兩年`, X.length ? rkList(X.map(r => ({ mono: "", name: offNm(r[0], r[1]), val: offYmd(r[2]), vc: "down" }))) : offNone("沒有。"));
}
// 興櫃：漲跌、成交量排行與月營收年增
function offEsbHtml(D) {
  const E = D.esb || {}, O = OFFS(), Q = offFilter(E.quotes || []), R = offFilter(E.rev || []);
  const k = { up: [(a, b) => (b[4] ?? -1e9) - (a[4] ?? -1e9), "漲幅"], dn: [(a, b) => (a[4] ?? 1e9) - (b[4] ?? 1e9), "跌幅"], vol: [(a, b) => (b[5] || 0) - (a[5] || 0), "成交量"] }[O.esb] || [(a, b) => 0, ""];
  return offSec("興櫃行情", `${offYmd(E.date)}・${Q.length} 檔`, `<div class="mksegrow">${mkSeg("offEsb", O.esb, [["up", "漲幅"], ["dn", "跌幅"], ["vol", "成交量"], ["rev", "月營收年增"]])}</div>`
    + (O.esb === "rev" ? rkList([...R].sort((a, b) => (b[4] ?? -1e9) - (a[4] ?? -1e9)).slice(0, 40).map(r => ({ mono: "", name: offNm(r[0], r[1]), sub: esc(r[2]), val: `${r[3]} 億`, vsub: `年增 ${r[4] != null ? (r[4] > 0 ? "+" : "") + r[4] + "%" : "—"}`, vc: cls(r[4]) })))
      : rkList([...Q].sort(k[0]).slice(0, 40).map(r => ({ mono: "", name: offNm(r[0], r[1]), sub: `均價 ${r[2]}（前日 ${r[3] ?? "—"}）`, val: r[4] != null ? `${r[4] > 0 ? "+" : ""}${r[4]}%` : "—", vc: cls(r[4]), vsub: `${Math.round((r[5] || 0) / 1000).toLocaleString()} 張` }))))
    + `<p class="note">興櫃是上市櫃前的市場，沒有漲跌幅限制、由推薦證券商報價，價格波動大、成交量小；漲跌用「均價」和前一日均價比。${E.ym ? `月營收是 ${E.ym.replace("-", " 年 ")} 月。` : ""}</p>`);
}
// 定期定額：最多人定期定額的股票、ETF
function offDcaHtml(D) {
  const L = D.dca || [], mx = (i) => Math.max(1, ...L.map(r => r[i] || 0)), bar = (v, m) => `<i class="offbar" style="width:${Math.round((v || 0) / m * 100)}%"></i>`;
  return offSec("定期定額交易戶數排行", "證交所每月公布", L.length ? `<div class="offdca"><div><h4>股票</h4><ol>${L.map(r => `<li><button type="button" data-sel="${esc(r[1])}">${offNm(r[1], r[2])}<span>${(r[3] || 0).toLocaleString()} 戶</span>${bar(r[3], mx(3))}</button></li>`).join("")}</ol></div>
    <div><h4>ETF</h4><ol>${L.map(r => `<li><button type="button" data-sel="${esc(r[4])}">${offNm(r[4], r[5])}<span>${(r[6] || 0).toLocaleString()} 戶</span>${bar(r[6], mx(6))}</button></li>`).join("")}</ol></div></div>
    <p class="note">「戶數」是在券商設定定期定額買這檔的帳戶數，看得出存股族最常買什麼；不代表報酬好壞。</p>` : offNone("暫時沒有資料。"));
}
// 融資融券：市場合計、增減最多
function offMarginHtml(D) {
  const M = D.margin || {}, O = OFFS(), T = M.tot || [];
  const pick = { up: [M.up, 4, "融資增加最多"], dn: [M.dn, 4, "融資減少最多"], su: [M.sUp, 6, "融券增加最多"] }[O.mg] || [M.up, 4, ""];
  const L = offFilter(pick[0] || []);
  return offSec("融資融券", M.date ? offYmd(M.date) : "張", rkCards(T.map(([m, b, bc, s, sc]) => ({ t: `${m}融資餘額`, v: `${Math.round(b).toLocaleString()} 張`, sub: `增減 ${bc > 0 ? "+" : ""}${Math.round(bc).toLocaleString()}・融券 ${Math.round(s).toLocaleString()}（${sc > 0 ? "+" : ""}${Math.round(sc).toLocaleString()}）`, vc: cls(bc) })))
    + `<div class="mksegrow">${mkSeg("offMg", O.mg, [["up", "融資增加"], ["dn", "融資減少"], ["su", "融券增加"]])}</div>`
    + rkList(L.slice(0, 40).map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: offNm(r[0], r[1]), sub: `${r[2]}・融資 ${(r[3] || 0).toLocaleString()} 張・融券 ${(r[5] || 0).toLocaleString()} 張`, val: `${r[pick[1]] > 0 ? "+" : ""}${(r[pick[1]] || 0).toLocaleString()}`, vc: cls(r[pick[1]]), vsub: "張", star: r[0] })))
    + `<p class="note">融資增加代表散戶借錢買進變多（槓桿升高），融券增加代表放空變多；兩者都是證交所、櫃買中心每天收盤後公布。</p>`);
}
// 券商進出：上櫃熱門股前幾大券商的買賣
function offBrokerHtml(D) {
  const L = offFilter((D.broker || []).map(r => [r[1], r[2], r[0], r[3]]));
  return offSec("上櫃熱門股券商進出", `${L.length} 檔・股數`, L.length ? `<ul class="offnews">${L.map(([c, n, rk, B]) => { const net = B.reduce((a, b) => a + b[1] - b[2], 0), top = [...B].sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 3);
    return `<li><details><summary><span class="note">#${rk}</span><button type="button" class="linkbtn" data-sel="${esc(c)}">${offNm(c, n)}</button><span class="offt">${top.map(b => `${esc(b[0])} <b class="${cls(b[1] - b[2])}">${b[1] - b[2] > 0 ? "+" : ""}${Math.round((b[1] - b[2]) / 1000).toLocaleString()}</b>`).join("・")} 張</span></summary>
      <div class="cotbl-wrap"><table class="tbl otc-t"><thead><tr><th>券商</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead><tbody>${B.map(b => `<tr><td>${esc(b[0])}</td><td>${Math.round(b[1] / 1000).toLocaleString()}</td><td>${Math.round(b[2] / 1000).toLocaleString()}</td><td class="${cls(b[1] - b[2])}">${Math.round((b[1] - b[2]) / 1000).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">前十大券商合計買賣超 ${Math.round(net / 1000).toLocaleString()} 張（張＝1000 股）。</p></details></li>`; }).join("")}</ul>` : offNone("沒有符合的股票。"))
    + `<p class="note" style="padding:0 12px">櫃買中心公布當日成交最熱門的上櫃股，各自前十大券商的買進、賣出股數；上市股票的券商分點要看個股頁的「籌碼 → 券商」。</p>`;
}
// 鉅額交易（上櫃逐筆）
function offBlockHtml(D) {
  const L = offFilter((D.block || []).map(r => [r[1], r[2], ...r]));
  return offSec("上櫃鉅額交易", `${L.length} 筆`, L.length ? rkList(L.map(r => ({ mono: "", attr: `data-sel="${esc(r[0])}"`, name: offNm(r[0], r[1]), sub: `${esc(r[5])}・${offMd(r[2])}`, val: `${r[8].toLocaleString()} 萬`, vsub: `${r[6]} 元・${Math.round((r[7] || 0) / 1000).toLocaleString()} 張`, star: r[0] }))) : offNone("今天沒有鉅額交易。"))
    + `<p class="note" style="padding:0 12px">鉅額交易是法人、大股東之間一次轉讓大量股票，用議定價格成交，不影響盤中價格；常見於持股調整、ETF 申贖。</p>`;
}
// 休市日
function offHolHtml(D) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), L = D.holiday || [], next = L.filter(r => r[0] >= today);
  return offSec("證交所開（休）市日期", `${next.length} 天還沒到`, L.length ? rkList(L.map(r => ({ mono: "", name: esc(r[1]), sub: esc(r[2]), val: offYmd(r[0]), vc: r[0] >= today ? "" : "note", vsub: r[0] >= today ? "" : "已過" }))) : offNone("暫時沒有資料。"))
    + `<p class="note" style="padding:0 12px">休市日也會標在「台股大盤 → 理財行事曆」。</p>`;
}

// 個股徽章：這檔有沒有出現在今天的重大訊息、近一年裁罰／經營權異動、董監持股不足、變更交易、節目異常推介
function offFlags(c) {
  const D = W.offc; if (!D?.ok) return [];
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), out = [];
  const n = D.news.filter(r => r[2] === c); if (n.length) out.push({ k: "off", v: "news", g: "重訊", t: n.length > 1 ? `${n.length} 則重大訊息` : n[0][5].slice(0, 24) });
  const risk = [...D.abn.filter(r => r[1] === c).map(() => "節目異常推介"), ...D.alt.filter(r => r[0] === c).map(r => r[3]), ...D.fines.filter(r => r[1] === c && r[0] >= since).map(r => r[4]),
    ...D.ctrl.filter(r => r[1] === c && r[0] >= since).map(() => "經營權異動"), ...D.short3.filter(r => r[0] === c).map(r => `董監持股不足 ${r[1] > 12 ? "逾 1 年" : r[1] + " 個月"}`)];
  if (risk.length) out.push({ k: "off", v: "risk", g: "警示", t: [...new Set(risk)].slice(0, 2).join("・") });
  return out;
}
// 節目觀點頁：證交所點名的投資理財節目異常推介個股
function offAbnHtml() {
  const D = W.offc; if (!D) { if (!W.off) setTimeout(offLoad, 0); return ""; } if (!D.ok) return "";
  return `<div class="offabn"><b>證交所：投資理財節目異常推介個股</b>${D.abn.length ? D.abn.map(r => `<button type="button" class="linkbtn" data-sel="${esc(r[1])}">${offNm(r[1], r[2])}</button>`).join("、") : `<span class="note">最近一次公布（${offYmd(D.abnDate)}）沒有點名個股</span>`}
    <span class="note">證交所監視節目、社群推介個股與股價成交異常的連動，被點名不一定違法，但要特別小心追高。</span></div>`;
}
