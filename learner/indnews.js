/* 產業新聞：「產業地圖 → 產業新聞」頁，以及每個題材內頁的「最新消息」。
   - 整理過的重點新聞：data/industry-news.json（{ updated, items: [{ date, themes: [id], title, summary, source, url }] }），每則標出相關題材，點題材進內頁。
   - 即時新聞：題材內頁用題材名稱問 /api/news（Google 新聞），補上最新的標題。
   用到 watch.html 的 W、IND、INDT、esc、getJ、renderInd、indCol、MK_TAG，core.js 的 $、store。 */
const INEWS = { data: null, busy: false, live: new Map() };
// 題材分類 → 新聞分組
const INEWS_GROUPS = [["all", "全部"], ["semi", "半導體"], ["ai", "AI 伺服器與網通"], ["energy", "能源電力"], ["robot", "機器人與汽車"], ["defense", "國防太空"], ["health", "生技醫療"], ["fin", "金融"], ["other", "其他"]];
function inewsGroupOf(T) {
  const c = T?.cat || "";
  if (/半導體|IC 設計|記憶體|PCB|材料|封裝|測試/.test(c)) return "semi";
  if (/AI 伺服器|網通|散熱|電子零組件|雲端|資料中心|光電|電子代工|消費電子|軟體|資安|量子/.test(c)) return "ai";
  if (/能源|電源|電力|原物料|環保/.test(c)) return "energy";
  if (/機器人|汽車|工業/.test(c)) return "robot";
  if (/國防|航太|太空/.test(c)) return "defense";
  if (/醫療|生技/.test(c)) return "health";
  if (/金融|保險|銀行/.test(c)) return "fin";
  return "other";
}
async function inewsLoad() {
  if (INEWS.data || INEWS.busy) return; INEWS.busy = true;
  try { const r = await fetch(`data/industry-news.json?t=${Math.floor(Date.now() / 36e5)}`); if (!r.ok) throw new Error(`讀取失敗（${r.status}）`); INEWS.data = await r.json(); }
  catch (e) { INEWS.data = { items: [], err: e.message }; }
  finally { INEWS.busy = false; }
  if (W.lt === "ind") renderInd();
}
const inewsChip = id => { const T = INDT.get(id); return T ? `<button class="inchip" data-iopen="${T.id}" style="--ic:${indCol(T)}">${esc(T.name)}</button>` : ""; };
const inewsItem = x => `<li class="initem"><div class="inmeta"><span>${esc(x.date.slice(5).replace("-", "/"))}</span><span>${esc(x.source || "")}</span></div>
  <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.title)}</b></a>${x.summary ? `<p>${esc(x.summary)}</p>` : ""}
  <div class="inchips">${(x.themes || []).map(inewsChip).join("")}</div></li>`;
// 「產業新聞」頁
function inewsView() {
  inewsLoad(); const D = INEWS.data, g = W.indS.ngrp || "all";
  if (!D) return `<p class="note gnote">載入中…</p>`;
  if (D.err && !D.items?.length) return `<p class="note gnote">⚠ ${esc(D.err)}</p>`;
  const L = (D.items || []).filter(x => g === "all" || (x.themes || []).some(id => inewsGroupOf(INDT.get(id)) === g)).sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(L.map(x => x.date.slice(0, 7)))];
  return `<p class="note gnote">各產業近期的重點新聞，整理成白話重點並標出相關題材（點題材看產業鏈與圖解）。${D.updated ? `整理於 ${esc(D.updated)}。` : ""}每個題材內頁另有即時新聞。</p>
    <div class="ichips" style="margin:0 12px 6px">${INEWS_GROUPS.map(([k, t]) => `<button class="ichip" data-ingrp="${k}" aria-pressed="${g === k}">${t}</button>`).join("")}</div>
    ${L.length ? months.map(m => `<h3 class="inmonth">${m.slice(0, 4)} 年 ${+m.slice(5)} 月</h3><ul class="inlist">${L.filter(x => x.date.startsWith(m)).map(inewsItem).join("")}</ul>`).join("") : `<p class="note gnote">這個分類目前沒有整理的新聞。</p>`}
    <p class="note gnote">新聞重點是整理摘要，請以原文為準；不是投資建議。</p>`;
}
// 題材內頁的「最新消息」：整理過的＋即時新聞
function inewsTheme(T) {
  inewsLoad();
  const cur = (INEWS.data?.items || []).filter(x => (x.themes || []).includes(T.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const lv = INEWS.live.get(T.id); if (!lv && !W.off) inewsLive(T);
  const ago = t => { if (!t) return ""; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : new Date(t + 8 * 3600e3).toISOString().slice(5, 10).replace("-", "/"); };
  return `<section class="iseg inews"><h4>最新消息</h4>
    ${cur.length ? `<ul class="inlist">${cur.map(x => inewsItem({ ...x, themes: x.themes.filter(id => id !== T.id) })).join("")}</ul>` : ""}
    <h5 class="note">即時新聞</h5>${lv?.items?.length ? `<ul class="inlive">${lv.items.slice(0, 8).map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><small>${esc(x.source || "")}${x.source ? "・" : ""}${ago(x.at)}</small></li>`).join("")}</ul>`
      : `<p class="note">${lv?.err ? "⚠ " + esc(lv.err) : W.off ? "需要部署到網站才有即時新聞。" : "載入中…"}</p>`}</section>`;
}
async function inewsLive(T) {
  INEWS.live.set(T.id, { loading: true });
  const q = T.name.replace(/（.*?）|\(.*?\)/g, "").replace(/[、／/]/g, " ").trim();
  try { const j = await getJ(`/api/news?code=&q=${encodeURIComponent(q)}`); INEWS.live.set(T.id, { items: j.items || [] }); }
  catch (e) { INEWS.live.set(T.id, { err: e.message }); }
  if (W.lt === "ind" && W.indS.open === T.id) renderInd();
}
function inewsInit() {
  $("#lx").addEventListener("click", e => { if (W.lt !== "ind") return; const b = e.target.closest("[data-ingrp]"); if (b) { W.indS.ngrp = b.dataset.ingrp; renderInd(); } });
  const css = document.createElement("style"); css.textContent = `
#lx .scrseg[aria-label="產業地圖"] { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; max-width: calc(100% - 24px); } #lx .scrseg[aria-label="產業地圖"] button { white-space: nowrap; flex: none; }
.inmonth { margin: 18px 12px 6px; font-size: 13px; font-weight: 500; color: var(--muted); letter-spacing: .06em; }
.inlist { list-style: none; margin: 0 12px; padding: 0; } .initem { padding: 12px 0; border-bottom: 1px solid var(--line); }
.initem a { color: var(--ink); text-decoration: none; } .initem a b { font-weight: 500; font-size: 15px; line-height: 1.5; } .initem a:hover b { text-decoration: underline; }
.initem p { margin: 4px 0 6px; color: var(--muted); font-size: 13.5px; line-height: 1.7; }
.inmeta { display: flex; gap: 10px; font-size: 11.5px; color: var(--accent); letter-spacing: .04em; margin-bottom: 2px; }
.inchips { display: flex; gap: 6px; flex-wrap: wrap; } .inchip { border: 0; background: transparent; color: var(--ic, var(--muted)); font: inherit; font-size: 12px; padding: 0; cursor: pointer; box-shadow: inset 0 -1px 0 currentColor; }
.inews .inlist { margin: 0; } .inews h5 { margin: 12px 0 4px; font-weight: 400; }
.inlive { list-style: none; margin: 0; padding: 0; } .inlive li { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; } .inlive a { color: var(--ink); text-decoration: none; } .inlive small { display: block; color: var(--muted); font-size: 11.5px; }`;
  document.head.appendChild(css);
}
