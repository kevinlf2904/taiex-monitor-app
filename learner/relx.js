/* 供應鏈題材的「關聯」：題材之間除了上下游（產業網絡）以外的關係。
   ・題材內頁「關聯題材」：細分題材／同一家族、成分股重疊、替代技術、股價連動（領先落後）、總經驅動、在誰的供應鏈裡
   ・供應鏈「關聯」分頁：連動熱圖（加上意外的連動）、領先落後、題材強弱、客戶視角、總經驅動、替代技術
   股價連動來自 data/theme-corr.json（scripts/theme-corr.mjs 每個交易日收盤後計算）；總經數字用 data/macro.json（loadMacro）。
   用到 watch.html 的 W、IND、INDT、esc、cls、store、indCodes、indAvg、indCol、indPeers、MK_NAME、loadIndQuotes、renderInd、loadMacro、isMobile。 */

// ---------- 關係資料（人工整理） ----------
// 家族：top 是上一層（大題材），kids 是細分題材；top 為 null 是同一類、彼此平行
const REL_FAMILY = [
  { name: "被動元件", top: "tw-passive", kids: ["tw-cap", "tw-inductor", "tw-resistor", "tw-quartz"] },
  { name: "汽車零組件", top: "tw-auto", kids: ["tw-autoconn", "tw-autoparts"] },
  { name: "機器人", top: "tw-robot", kids: ["tw-humanoid", "tw-automation"] },
  { name: "先進封裝", top: "tw-cowos", kids: ["tw-copos", "tw-pkgtool"] },
  { name: "記憶體", top: "tw-hbm", kids: ["tw-nor"] },
  { name: "醫療器材", top: "tw-meddevice", kids: ["tw-medsupply", "tw-ivd"] },
  { name: "顯示", top: "tw-display", kids: ["tw-microled"] },
  { name: "連接器", top: null, kids: ["tw-interconnect", "tw-conn", "tw-autoconn"] },
  { name: "綠能與儲能", top: null, kids: ["tw-wind", "tw-solar", "tw-ess"] },
  { name: "台灣金融", top: null, kids: ["tw-bank", "tw-insurance", "tw-broker"] },
  { name: "資料中心供電", top: null, kids: ["tw-psu", "tw-bbu", "tw-hvdc"] },
];
// 替代技術或路線之爭：[舊／現有, 新／挑戰者, 說明]
const REL_SUB = [
  ["tw-optical", "tw-cpo", "CPO 把光引擎和交換器晶片封在一起，長期可能取代部分可插拔光模組；短期兩者並存"],
  ["tw-cowos", "tw-copos", "面板級封裝用方形面板取代圓形晶圓做中介層，面積更大、成本更低，是 CoWoS 之後的路線"],
  ["tw-substrate", "tw-glasssub", "玻璃基板可能取代部分 ABF 載板的有機核心層，平整度與高頻訊號更好"],
  ["tw-aircool", "tw-liquid", "AI 晶片功耗越來越高，液冷逐步取代氣冷；一般伺服器仍以氣冷為主"],
  ["us-gpu", "tw-asic", "雲端業者自研 ASIC 分食部分 GPU 需求；訓練仍以 GPU 為主，推論的 ASIC 比重上升"],
  ["tw-psu", "tw-hvdc", "800V 高壓直流讓機櫃改由集中電源供電，改變傳統伺服器電源的設計"],
  ["us-fuelcell", "us-nuclear", "資料中心自備電力：燃料電池與燃氣渦輪蓋得快，小型核電要等到 2030 年前後"],
  ["tw-display", "kr-oled", "OLED 在手機、筆電、平板逐步取代 LCD；電視與大尺寸仍以 LCD 為主"],
  ["tw-display", "tw-microled", "MicroLED 是下一代自發光顯示，先從手錶、車用與大型看板開始"],
  ["us-payment", "us-stablecoin", "穩定幣跨境結算快又便宜，可能分走部分卡組織與匯款業者的生意"],
];
// 客戶視角：大客戶的供應鏈大致涵蓋哪些題材（依常見分工整理，不代表題材裡每家公司都是它的供應商）
const REL_CUST = [
  { c: "NVDA", n: "輝達", d: "GPU 與整櫃 AI 伺服器：從晶圓、封裝、HBM、載板到組裝、散熱、電源、光通訊都要", t: ["tw-foundry", "tw-cowos", "tw-hbm", "kr-memory", "tw-substrate", "tw-test", "tw-odm", "tw-pcb", "tw-ccl", "tw-liquid", "tw-psu", "tw-interconnect", "tw-optical", "tw-cpo", "tw-switch"] },
  { c: "AAPL", n: "蘋果", d: "iPhone、Mac、Vision：晶片、面板、鏡頭與感測、軟板、被動元件、組裝", t: ["tw-foundry", "tw-edgeai", "tw-pc", "tw-fpc", "tw-sensor", "kr-oled", "tw-passive", "tw-conn", "tw-ems", "tw-xr"] },
  { c: "TSLA", n: "特斯拉", d: "電動車、儲能與人形機器人：電池、功率半導體、車用零件、致動器", t: ["kr-battery", "tw-batmat", "tw-auto", "tw-autoconn", "tw-autoparts", "tw-power-semi", "tw-humanoid", "tw-ess", "us-robotaxi"] },
  { c: "GOOGL", n: "Google", d: "自研 TPU 與雲端資料中心：ASIC 設計服務、組裝、光通訊、電力與機房", t: ["tw-asic", "tw-foundry", "tw-cowos", "tw-odm", "tw-optical", "tw-switch", "tw-liquid", "us-build", "us-power", "us-dcreit", "us-nuclear"] },
  { c: "AMZN", n: "亞馬遜", d: "AWS 自研晶片與資料中心：ASIC、伺服器、網通、電力與機房", t: ["tw-asic", "tw-foundry", "tw-odm", "tw-switch", "tw-optical", "us-build", "us-utility", "us-dcreit", "us-nuclear"] },
  { c: "MSFT", n: "微軟", d: "Azure 雲端與 AI 算力：GPU、伺服器、租用 GPU 雲、電力與機房", t: ["us-gpu", "tw-odm", "us-neocloud", "us-build", "us-power", "us-dcreit", "us-nuclear"] },
  { c: "META", n: "Meta", d: "自建 AI 資料中心與自研晶片：GPU、ASIC、伺服器、網通、電力", t: ["us-gpu", "tw-asic", "tw-odm", "tw-switch", "tw-optical", "us-build", "us-utility"] },
];
// 總經驅動：k 是 data/macro.json 的數列代號（null＝沒有現成數列，只有說明）；up＝數字上升時受惠、dn＝數字上升時受壓
const REL_MACRO = [
  { k: "DGS10", n: "10 年期美債殖利率", why: "利率高，未來現金流折現後變少、借錢成本變高；銀行與壽險的利差、投資收益則變好", up: ["us-bank", "tw-insurance", "tw-bank"], dn: ["us-dcreit", "us-housing", "tw-construct", "us-utility", "us-saas"] },
  { k: "DFEDTARU", n: "聯準會政策利率", why: "升息讓存放款利差擴大，但壓抑房市、高估值成長股與加密資產", up: ["us-bank", "tw-bank"], dn: ["us-housing", "us-crypto", "us-altasset", "us-neocloud"] },
  { k: "DCOILBRENTEU", n: "布蘭特原油", why: "油價是油氣業的售價，卻是航空、航運、陸運與紡織原料的成本", up: ["us-oilgas", "jp-trading", "kr-ship"], dn: ["tw-airline", "tw-shipping", "us-transport", "tw-textile"] },
  { k: "PCOPPUSDM", n: "銅價", why: "銅是電線、電網、電路板的原料；銅價高多半代表電網與資料中心需求強，但壓縮加工業者毛利", up: ["us-minerals", "jp-trading", "kr-grid"], dn: ["tw-ccl", "tw-pcb", "tw-conn"] },
  { k: "DEXJPUS", n: "美元兌日圓", why: "數字變大＝日圓貶值，日本出口企業換回的日圓變多", up: ["jp-gameip", "jp-heavyelec", "jp-semi", "jp-trading", "jp-mlcc"], dn: [] },
  { k: "UMCSENT", n: "密大消費者信心", why: "美國消費者願意花錢，品牌就會向台灣代工廠下單、零售通路業績變好", up: ["us-retail", "tw-textile", "tw-bike", "us-housing"], dn: [] },
  { k: "VIXCLS", n: "VIX 恐慌指數", why: "市場越恐慌、交易越熱絡，交易所收入增加；高風險資產通常承壓", up: ["us-exchange"], dn: ["us-crypto", "us-altasset"] },
  { k: "BAMLH0A0HYM2", n: "高收益債利差", why: "利差擴大代表借錢變難，靠舉債擴張的 GPU 雲與私募信貸最敏感", up: [], dn: ["us-altasset", "us-neocloud", "us-bank"] },
  { k: "XTEXVA01CNM664S", n: "中國出口年增率", why: "中國出口熱，貨櫃運量、石化與造船需求跟著增加", up: ["tw-shipping", "tw-petchem", "kr-ship"], dn: [] },
  { k: null, n: "雲端業者 AI 資本支出", why: "四大雲端業者每季財報公布的資本支出，是 AI 供應鏈訂單最直接的領先指標", up: ["us-gpu", "tw-cowos", "tw-odm", "tw-liquid", "tw-optical", "tw-hbm", "tw-pcb", "tw-ccl", "us-power", "us-dcreit"], dn: [] },
  { k: null, n: "記憶體合約價", why: "DRAM、NAND 合約價上漲，記憶體廠營收與毛利直接上升；對品牌與組裝廠是成本", up: ["tw-hbm", "kr-memory", "us-memory", "jp-nand", "tw-nor"], dn: ["tw-pc"] },
  { k: null, n: "面板報價", why: "面板廠是價格接受者，報價決定獲利；對品牌與組裝廠則是成本", up: ["tw-display", "kr-oled"], dn: ["tw-pc"] },
  { k: null, n: "貨櫃運價（SCFI）", why: "運價是航商的售價、貨主的成本", up: ["tw-shipping"], dn: ["us-retail"] },
  { k: null, n: "各國國防預算", why: "國防預算決定未來幾年的訂單與交貨", up: ["us-defprime", "kr-defense", "tw-defense2", "tw-drone", "us-drone", "us-space"], dn: [] },
  { k: null, n: "台股成交量", why: "成交量越大，券商手續費與融資利息收入越多", up: ["tw-broker"], dn: [] },
  { k: null, n: "鋰價", why: "鋰價影響正極材料售價，也影響電芯與儲能系統的成本", up: ["tw-batmat"], dn: ["kr-battery", "tw-ess"] },
];

// ---------- 計算 ----------
const relS = () => (W.relS ||= { sub: "corr", net: "ai-dc", k: "x", per: 1, mk: "", cust: "NVDA", ...(store.get("watch:rel", null) || {}) });
const relSave = () => { const S = relS(); store.set("watch:rel", { sub: S.sub, net: S.net, k: S.k, per: S.per, mk: S.mk, cust: S.cust }); };
// 題材連動資料：第一次需要時下載，下載完重畫（只有在關聯分頁或題材內頁才重畫）
function relLoad() {
  const R = (W.rel ||= {}); if (R.p) return R.p;
  return (R.p = fetch("data/theme-corr.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
    if (j?.ids?.length) { R.tc = j; R.ix = new Map(j.ids.map((id, i) => [id, i])); } R.done = true;
    if (W.lt === "ind" && (W.indS.view === "rel" || W.indS.open)) renderInd(); }));
}
// 兩個題材的相關係數（-1～1）；k＝"x" 扣掉大盤、"c" 原始週報酬
function relCorr(a, b, k = "x") {
  const C = W.rel?.tc, I = W.rel?.ix; if (!C || a === b || !I.has(a) || !I.has(b)) return null;
  const i = I.get(a), j = I.get(b), N = C.ids.length, t = i < j ? (i * (2 * N - i - 1)) / 2 + (j - i - 1) : (j * (2 * N - j - 1)) / 2 + (i - j - 1), v = (C[k] || C.c)?.[t];
  return v == null ? null : v / 100;
}
// 成分股重疊（Jaccard）：共同公司數／兩邊公司聯集
const relCodeSet = t => ((W.relCS ||= new Map()).get(t.id) || W.relCS.set(t.id, new Set(indCodes(t))).get(t.id));
function relOverlap(a, b) { const A = relCodeSet(a), B = relCodeSet(b); let k = 0; for (const c of B) if (A.has(c)) k++; return { k, j: k / (A.size + B.size - k || 1) }; }
function relSimilar(T, n = 6) { return IND.themes.filter(t => t.id !== T.id).map(t => ({ t, ...relOverlap(T, t) })).filter(x => x.k >= 2 && x.j >= 0.12).sort((a, b) => b.j - a.j).slice(0, n); }
// 已經有關係的兩個題材（產業網絡連線、其他市場同主題、家族、替代）：「意外的連動」不列這些
function relLinked() {
  if (W.relLk) return W.relLk; const S = new Set(), add = (a, b) => { S.add(a + "|" + b); S.add(b + "|" + a); };
  IND.networks.forEach(n => n.links.forEach(([a, b]) => add(a, b))); REL_SUB.forEach(([a, b]) => add(a, b));
  REL_FAMILY.forEach(f => { const L = [f.top, ...f.kids].filter(Boolean); L.forEach(a => L.forEach(b => a !== b && add(a, b))); });
  IND.themes.forEach(t => (indPeers(t) || []).forEach(p => add(t.id, p.id)));
  return (W.relLk = S);
}

// ---------- 小元件 ----------
const relChip = (t, extra = "") => `<button class="igchip" data-iopen="${t.id}" style="--ic:${indCol(t)}"><span class="itag">${MK_NAME[t.mk]}</span>${esc(t.name)}${extra}</button>`;
const relR = v => (v == null ? "—" : (v >= 0 ? "" : "−") + Math.abs(v).toFixed(2));
const relRcol = v => (v == null ? "transparent" : v >= 0 ? `color-mix(in srgb, #38bdf8 ${Math.round(Math.min(1, v) * 85)}%, transparent)` : `color-mix(in srgb, #f472b6 ${Math.round(Math.min(1, -v) * 85)}%, transparent)`);
const relT = id => INDT.get(id);
function relMacroNow(k) { const s = k && W.mc?.series?.find(x => x.id === k); if (!s?.last) return ""; const u = s.unit || "", v = s.last[1], y = s.y1?.[1];
  return `<span class="rnow">${esc(String(v))}${esc(u)}${y != null ? `<small>一年前 ${esc(String(y))}${esc(u)}</small>` : ""}</span>`; }
const relNoData = () => `<p class="note gnote">${W.rel?.done ? "題材連動資料每個交易日收盤後由排程計算，現在還沒有資料，明天再來看。" : "載入題材連動資料中…"}</p>`;

// ---------- 題材內頁：關聯題材 ----------
function relTheme(T) {
  relLoad(); if (!W.mc && !W.mcLoading && typeof loadMacro === "function") loadMacro().then(() => { if (W.lt === "ind" && W.indS.open === T.id) renderInd(); });
  const fam = REL_FAMILY.filter(f => f.top === T.id || f.kids.includes(T.id)), parts = [];
  for (const f of fam) {
    if (f.top === T.id) parts.push(`<div class="rrow"><h5>細分題材（${esc(f.name)}）</h5><div class="ichips">${f.kids.map(relT).filter(Boolean).map(t => relChip(t)).join("")}</div></div>`);
    else { const up = f.top && relT(f.top), sib = f.kids.filter(x => x !== T.id).map(relT).filter(Boolean);
      parts.push(`<div class="rrow"><h5>${up ? "上一層" : "同一家族"}（${esc(f.name)}）</h5><div class="ichips">${up ? relChip(up) : ""}${sib.map(t => relChip(t)).join("")}</div></div>`); }
  }
  const sim = relSimilar(T); if (sim.length) parts.push(`<div class="rrow"><h5>成分股重疊 <span class="note">共同公司越多，漲跌越容易一起動</span></h5><div class="ichips">${sim.map(x => relChip(x.t, `<small class="rk">${x.k} 家</small>`)).join("")}</div></div>`);
  const sub = REL_SUB.filter(x => x[0] === T.id || x[1] === T.id);
  if (sub.length) parts.push(`<div class="rrow"><h5>替代技術、路線之爭</h5>${sub.map(([a, b, d]) => { const o = relT(a === T.id ? b : a); return o ? `<div class="rsub">${relChip(o, `<small class="rk">${a === T.id ? "挑戰者" : "被挑戰"}</small>`)}<p class="note">${esc(d)}</p></div>` : ""; }).join("")}</div>`);
  if (W.rel?.tc && W.rel.ix.has(T.id)) {
    const top = IND.themes.filter(t => t.id !== T.id).map(t => ({ t, v: relCorr(T.id, t.id, "x") })).filter(x => x.v != null).sort((a, b) => b.v - a.v).slice(0, 5);
    const ld = W.rel.tc.lead.filter(x => x[1] === T.id && relT(x[0])).slice(0, 3), lg = W.rel.tc.lead.filter(x => x[0] === T.id && relT(x[1])).slice(0, 3);
    parts.push(`<div class="rrow"><h5>股價連動 <span class="note">近一年週報酬，扣掉各自大盤後的相關係數（1＝完全同步）</span></h5><div class="ichips">${top.map(x => relChip(x.t, `<small class="rk" style="background:${relRcol(x.v)}">${relR(x.v)}</small>`)).join("") || `<span class="note">—</span>`}</div>
      ${ld.length ? `<p class="note rlead">常先動：${ld.map(x => `${esc(relT(x[0]).name)}（隔天相關 ${relR(x[2] / 100)}）`).join("、")}</p>` : ""}${lg.length ? `<p class="note rlead">它常先動：${lg.map(x => `${esc(relT(x[1]).name)}（隔天相關 ${relR(x[2] / 100)}）`).join("、")}</p>` : ""}</div>`);
  }
  const mac = REL_MACRO.filter(m => m.up.includes(T.id) || m.dn.includes(T.id));
  if (mac.length) parts.push(`<div class="rrow"><h5>總經驅動</h5><ul class="rmac">${mac.map(m => `<li><b>${esc(m.n)}</b>${relMacroNow(m.k)}<span class="${m.up.includes(T.id) ? "up" : "down"}">${m.up.includes(T.id) ? "上升時受惠" : "上升時受壓"}</span><small>${esc(m.why)}</small></li>`).join("")}</ul></div>`);
  const cu = REL_CUST.filter(c => c.t.includes(T.id));
  if (cu.length) parts.push(`<div class="rrow"><h5>在誰的供應鏈裡</h5><div class="ichips">${cu.map(c => `<button class="ichip" data-rel="cust:${c.c}">${esc(c.n)} ${esc(c.c)} ›</button>`).join("")}</div></div>`);
  return parts.length ? `<section class="iseg irel"><h4>關聯題材</h4>${parts.join("")}</section>` : "";
}

// ---------- 供應鏈「關聯」分頁 ----------
const REL_TABS = [["corr", "連動熱圖"], ["lead", "領先落後"], ["rank", "題材強弱"], ["cust", "客戶視角"], ["macro", "總經驅動"], ["sub", "替代技術"]];
function relView() {
  const S = relS(); relLoad();
  let h = `<p class="note gnote">產業網絡看的是誰供貨給誰；這裡看題材之間其他的關係：股價有沒有一起動、誰先動、被同一個總經數字影響、同一個大客戶、會不會互相取代。</p>
    <div class="seg scrseg rtabs" role="group" aria-label="關聯">${REL_TABS.map(([k, t]) => `<button data-rel="sub:${k}" aria-pressed="${S.sub === k}">${t}</button>`).join("")}</div>`;
  const C = W.rel?.tc;
  if (S.sub === "corr") h += C ? relHeat(S) + relSurprise() : relNoData();
  else if (S.sub === "lead") h += C ? relLeadView() : relNoData();
  else if (S.sub === "rank") h += C ? relRank(S) : relNoData();
  else if (S.sub === "cust") h += relCust(S);
  else if (S.sub === "macro") h += relMacroView();
  else h += `<div class="rlist">${REL_SUB.map(([a, b, d]) => relT(a) && relT(b) ? `<div class="rsub2"><div class="ichips">${relChip(relT(a))}<span class="rvs">→</span>${relChip(relT(b))}</div><p class="note">${esc(d)}</p></div>` : "").join("")}</div>`;
  return h;
}
// 熱圖：選一張產業網絡，畫裡面題材兩兩的相關係數；點格子看那兩個題材
function relHeat(S) {
  const net = IND.networks.find(n => n.id === S.net) || IND.networks[0], ids = [...new Set(net.layers.flatMap(([, L]) => L))].filter(id => INDT.has(id) && W.rel.ix.has(id)), N = ids.length;
  let h = `<div class="ichips" style="margin:0 12px">${IND.networks.map(n => `<button class="ichip" data-rel="net:${n.id}" aria-pressed="${n.id === net.id}">${esc(n.name)}</button>`).join("")}</div>
    <div class="seg scrseg" role="group" aria-label="相關係數"><button data-rel="k:x" aria-pressed="${S.k !== "c"}">扣掉大盤</button><button data-rel="k:c" aria-pressed="${S.k === "c"}">原始報酬</button></div>`;
  if (N < 2) return h + `<p class="note gnote">這張網絡的題材還沒有足夠的股價資料。</p>`;
  const lab = 122, cs = Math.max(8, Math.min(22, Math.floor(((isMobile() ? 360 : 640) - lab) / N))), W0 = lab + N * cs, H0 = 16 + N * cs;
  let g = ""; ids.forEach((a, i) => { const t = INDT.get(a), nm = t.name.length > 8 ? t.name.slice(0, 7) + "…" : t.name;
    g += `<text x="${lab - 4}" y="${16 + i * cs + cs / 2 + 3.5}" text-anchor="end" class="rhl">${i + 1} ${esc(nm)}<title>${esc(t.name)}</title></text><text x="${lab + i * cs + cs / 2}" y="11" text-anchor="middle" class="rhn">${i + 1}</text>`;
    ids.forEach((b, j) => { const v = a === b ? 1 : relCorr(a, b, S.k === "c" ? "c" : "x"), sel = S.cell === `${a}|${b}` || S.cell === `${b}|${a}`;
      g += `<rect data-rel="cell:${a}|${b}" x="${lab + j * cs + 0.5}" y="${16 + i * cs + 0.5}" width="${cs - 1}" height="${cs - 1}" rx="1.5" fill="${a === b ? "var(--line)" : relRcol(v)}"${sel ? ' stroke="var(--gold)" stroke-width="1.5"' : ""}><title>${esc(t.name)} × ${esc(INDT.get(b).name)}：${relR(v)}</title></rect>`; }); });
  h += `<div class="rheat"><svg viewBox="0 0 ${W0} ${H0}" width="${W0}" height="${H0}" role="img" aria-label="${esc(net.name)} 題材股價相關熱圖">${g}</svg></div>
    <p class="note gnote"><span class="rkey" style="background:${relRcol(0.8)}"></span>藍＝一起漲跌　<span class="rkey" style="background:${relRcol(-0.6)}"></span>粉＝反向　顏色越深越明顯。近 ${W.rel.tc.weeks} 週的週報酬，資料到 ${esc(W.rel.tc.to || "")}。點格子看兩個題材的關係。</p>`;
  if (S.cell) { const [a, b] = S.cell.split("|"), A = INDT.get(a), B = INDT.get(b);
    if (A && B && a !== b) { const o = relOverlap(A, B), lk = relLinked().has(a + "|" + b);
      h += `<div class="rcell"><div class="ichips">${relChip(A)}<span class="rvs">×</span>${relChip(B)}</div><p>週報酬相關 <b>${relR(relCorr(a, b, "c"))}</b>，扣掉大盤 <b>${relR(relCorr(a, b, "x"))}</b>；共同公司 ${o.k} 家${lk ? "；產業網絡或題材說明裡本來就有關係" : "；產業網絡裡沒有直接連線"}。</p></div>`; } }
  return h;
}
// 意外的連動：扣掉大盤後仍高度相關，但產業網絡、家族、替代都沒連在一起，而且公司重疊不多
function relSurprise() {
  const C = W.rel.tc, L = relLinked(), out = [];
  for (let i = 0; i < C.ids.length; i++) for (let j = i + 1; j < C.ids.length; j++) {
    const a = C.ids[i], b = C.ids[j], A = INDT.get(a), B = INDT.get(b); if (!A || !B || L.has(a + "|" + b)) continue;
    const v = relCorr(a, b, "x"); if (!(v >= 0.5)) continue; const o = relOverlap(A, B); if (o.j >= 0.2) continue; out.push({ A, B, v, k: o.k });
  }
  out.sort((x, y) => y.v - x.v);
  return `<section class="iseg"><h4>意外的連動 <span class="note">扣掉大盤後仍常一起漲跌，但產業網絡裡沒有連在一起、公司也不太重疊</span></h4>
    ${out.length ? `<div class="rlist">${out.slice(0, 20).map(x => `<div class="rpair"><div class="ichips">${relChip(x.A)}<span class="rvs">×</span>${relChip(x.B)}</div><b class="rv" style="background:${relRcol(x.v)}">${relR(x.v)}</b></div>`).join("")}</div>
      <p class="note">可能是同一批資金在輪動、受同一個總經數字影響，或有還沒畫進網絡的供應關係；相關不代表因果。</p>` : `<p class="note">目前沒有找到。</p>`}</section>`;
}
function relLeadView() {
  const L = W.rel.tc.lead.filter(x => relT(x[0]) && relT(x[1]));
  return `<p class="note gnote">美股收盤時台股、日股、韓股還沒開盤，所以美股題材今晚的漲跌，常反映在亞洲題材隔天。下面是「先動的題材當天漲跌」和「跟著動的題材下一個交易日漲跌」的相關係數（近一年日報酬），反方向的相關明顯比較低才列出。</p>
    ${L.length ? `<div class="rlist">${L.slice(0, 40).map(([a, b, r, back, n]) => `<div class="rpair"><div class="ichips">${relChip(relT(a))}<span class="rvs">→ 隔天</span>${relChip(relT(b))}</div><b class="rv" style="background:${relRcol(r / 100)}">${relR(r / 100)}</b><small class="note">反方向 ${back == null ? "—" : relR(back / 100)}・${n} 天</small></div>`).join("")}</div>`
      : `<p class="note gnote">目前沒有明顯的領先關係。</p>`}`;
}
// 題材強弱：題材等權指數的 1 週／1 月／3 月／1 年報酬
function relRank(S) {
  const C = W.rel.tc, P = [["0", "1 週"], ["1", "1 月"], ["2", "3 月"], ["3", "1 年"]], k = +S.per || 0;
  const L = C.ids.map((id, i) => ({ t: INDT.get(id), v: C.ret[i]?.[k] })).filter(x => x.t && x.v != null && (!S.mk || x.t.mk === S.mk)).sort((a, b) => b.v - a.v), mx = Math.max(1, ...L.map(x => Math.abs(x.v)));
  return `<div class="seg scrseg" role="group" aria-label="期間">${P.map(([v, t]) => `<button data-rel="per:${v}" aria-pressed="${k === +v}">${t}</button>`).join("")}</div>
    <div class="seg scrseg" role="group" aria-label="市場"><button data-rel="mk:" aria-pressed="${!S.mk}">全部</button>${Object.entries(MK_NAME).map(([m, t]) => `<button data-rel="mk:${m}" aria-pressed="${S.mk === m}">${t}</button>`).join("")}</div>
    <p class="note gnote">題材裡同一市場的公司等權平均，資料到 ${esc(C.to || "")}。</p>
    <ol class="rrank">${L.map(x => `<li><button data-iopen="${x.t.id}"><span class="nm"><span class="itag">${MK_NAME[x.t.mk]}</span>${esc(x.t.name)}</span><span class="rbar"><i class="${cls(x.v)}" style="width:${((Math.abs(x.v) / mx) * 100).toFixed(1)}%"></i></span><b class="${cls(x.v)}">${x.v > 0 ? "+" : ""}${x.v.toFixed(1)}%</b></button></li>`).join("")}</ol>`;
}
function relCust(S) {
  const c = REL_CUST.find(x => x.c === S.cust) || REL_CUST[0], T = c.t.map(relT).filter(Boolean); loadIndQuotes(T.flatMap(indCodes));
  return `<div class="ichips" style="margin:0 12px">${REL_CUST.map(x => `<button class="ichip" data-rel="cust:${x.c}" aria-pressed="${x.c === c.c}">${esc(x.n)}</button>`).join("")}</div>
    <p class="note gnote"><b>${esc(c.n)}（${esc(c.c)}）</b>：${esc(c.d)}。依產業常見分工整理，不代表題材裡每家公司都是它的供應商。</p>
    <ul class="slist rcust">${T.map(t => { const a = indAvg(t); return `<li><button data-iopen="${t.id}"><span class="nm"><span class="itag">${MK_NAME[t.mk]}</span>${esc(t.name)}<small>${esc(t.cat)}・${indCodes(t).length} 家公司</small></span><b class="${a ? cls(a.pct) : ""}">${a ? `${a.pct >= 0 ? "+" : ""}${a.pct.toFixed(2)}%` : "—"}<small>今日平均</small></b></button></li>`; }).join("")}</ul>`;
}
function relMacroView() {
  if (!W.mc && !W.mcLoading && typeof loadMacro === "function") loadMacro().then(() => { if (W.lt === "ind" && W.indS.view === "rel") renderInd(); });
  return `<p class="note gnote">同一個總經數字往往同時推動好幾個題材。「受惠」「受壓」指數字上升時的常見方向，實際還要看市場預期。</p>
    <div class="rlist">${REL_MACRO.map(m => { const U = m.up.map(relT).filter(Boolean), D = m.dn.map(relT).filter(Boolean);
      return `<div class="rmacro"><div class="rmh"><b>${esc(m.n)}</b>${relMacroNow(m.k)}</div><p class="note">${esc(m.why)}</p>
        ${U.length ? `<div class="ichips"><span class="rtag up">上升時受惠</span>${U.map(t => relChip(t)).join("")}</div>` : ""}${D.length ? `<div class="ichips"><span class="rtag down">上升時受壓</span>${D.map(t => relChip(t)).join("")}</div>` : ""}</div>`; }).join("")}</div>`;
}

// 點擊：切換分頁、網絡、期間、市場、客戶、熱圖格子（題材內頁的「在誰的供應鏈裡」會跳到客戶視角）
document.addEventListener("click", e => {
  if (typeof W === "undefined" || W.lt !== "ind") return; const b = e.target.closest("[data-rel]"); if (!b || !b.closest("#lx")) return;
  const S = relS(), [k, v] = b.dataset.rel.split(/:(.*)/s);
  if (k === "cell") S.cell = S.cell === v ? null : v;
  else if (k === "cust") { S.cust = v; S.sub = "cust"; if (W.indS.open || W.indS.view !== "rel") { W.indS.open = null; W.indS.view = "rel"; goY(0); } }
  else { S[k] = v; if (k === "net") S.cell = null; }
  relSave(); renderInd();
});
{ const css = document.createElement("style"); css.textContent = `.irel .rrow { margin: 10px 0 14px; } .irel h5 { margin: 0 0 4px; font-size: 13px; font-weight: 500; } .irel h5 .note { font-weight: 400; font-size: 11.5px; }
.igchip .rk { margin-left: 2px; padding: 0 5px; border-radius: 3px; font: 500 11px var(--font-num); color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent); }
.rsub { margin: 4px 0 8px; } .rsub .note { margin: 2px 0 0; } .rlead { margin: 4px 0 0; }
.rmac { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; } .rmac li { display: grid; grid-template-columns: minmax(0, auto) auto 1fr; align-items: baseline; gap: 4px 10px; } .rmac li > small { grid-column: 1 / -1; color: var(--muted); font-size: 12px; line-height: 1.6; }
.rmac .up, .rtag.up { color: var(--up); } .rmac .down, .rtag.down { color: var(--down); } .rmac li > span:not(.rnow) { font-size: 12px; justify-self: end; }
.rnow { font: 500 13px var(--font-num); } .rnow small { margin-left: 6px; font: 400 11px var(--font-body); color: var(--muted); }
.rtabs { flex-wrap: nowrap; } .rheat { margin: 6px 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; } .rheat svg { display: block; max-width: none; } .rheat rect { cursor: pointer; }
.rhl { font-size: 10px; fill: var(--ink); } .rhn { font-size: 8px; fill: var(--muted); font-family: var(--font-num); }
.rkey { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
.rcell { margin: 4px 12px 10px; } .rcell p { margin: 4px 0 0; font-size: 13px; } .rvs { color: var(--muted); font-size: 12px; margin: 0 2px; align-self: center; }
.rlist { display: grid; gap: 8px; margin: 6px 12px; } .rpair { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; } .rpair > small { grid-column: 1 / -1; }
.rpair .ichips, .rsub2 .ichips, .rcell .ichips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0; } .rpair .igchip, .rsub2 .igchip, .rcell .igchip { margin: 0; padding: 3px 7px; font-size: 12.5px; }
.rv { font: 500 13px var(--font-num); padding: 2px 7px; border-radius: 4px; } .rsub2 .note { margin: 2px 0 0; }
.rmacro .rmh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; } .rmacro .note { margin: 2px 0 4px; } .rtag { font-size: 12px; margin-right: 4px; align-self: center; }
.rrank { list-style: none; margin: 6px 12px; padding: 0; display: grid; gap: 2px; } .rrank button { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 64px; align-items: center; gap: 10px; width: 100%; padding: 6px 2px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.rrank .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; } .rrank .nm .itag { margin-right: 6px; font-size: 11px; color: var(--muted); }
.rbar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 6%, transparent); overflow: hidden; } .rbar i { display: block; height: 100%; border-radius: 3px; background: var(--muted); } .rbar i.up { background: var(--up); } .rbar i.down { background: var(--down); }
.rrank b { font: 500 13px var(--font-num); text-align: right; } .rcust { margin: 6px 12px; }`; document.head.appendChild(css); }
