/* 產業圖解（供應鏈 → 題材內頁的原理圖解）的互動與詳細解說：
   ・名詞解釋：每個題材「關鍵名詞」裡的定義收成一本詞典，原理說明、每一段的說明裡出現就可以點，看定義和還有哪些題材用到
   ・每一段的詳細說明：在整條鏈的位置（上一段／下一段）、原理說明裡提到這一段的句子、用到的名詞、今天這一段公司的平均漲跌、最強最弱，點公司看走勢，也可以問 AI 解釋這一段
   ・依今日漲跌上色：圖上每一段的編號依那一段公司今天的平均漲跌變紅（漲）或綠（跌），顏色越深漲跌越大
   ・找公司：輸入代號或名稱，圖上標出這家公司出現在哪幾段
   ・考考自己：隨機出題「這家公司在哪一段」，答完圖上會跳到正確那一段
   用到 watch.html 的 W、esc、cls、store、getJ、nameOf、isMobile、INDT、indFig、indChainData、figItems、figStep、figPlay、indQuotable、MK_NAME、indCol，core.js 的 aiChat。 */

// ---------- 名詞詞典 ----------
// 「關鍵名詞」一段是「名詞：定義。名詞（別名）：定義。」；名詞可能是「SiC（碳化矽）、GaN（氮化鎵）」或「L6／L10／L11」，每個寫法都可以查
function figGlossBuild() {
  const F = typeof INDUSTRY_FIGS !== "undefined" ? INDUSTRY_FIGS : {}, n = Object.keys(F).length;
  if (figGlossBuild.n === n) return figGlossBuild.G; const G = new Map();
  for (const [id, f] of Object.entries(F)) {
    const k = (f.how || []).find(x => /名詞/.test(x[0])); if (!k) continue;
    for (const sent of String(k[1]).split("。").map(x => x.trim()).filter(Boolean)) {
      const m = sent.match(/^([^：:]{1,28})[：:](.+)$/); if (!m) continue;
      const term = m[1].trim(), def = m[2].trim(), names = new Set();
      for (const part of term.split(/[、／/]/)) { const p = part.trim(), base = p.replace(/[（(][^）)]*[）)]/g, "").trim(), al = (p.match(/[（(]([^）)]+)[）)]/) || [])[1]; [base, al].forEach(x => { if (x && x.length >= 2 && !/^\d+$/.test(x)) names.add(x.trim()); }); }
      for (const a of names) { const g = G.get(a) || G.set(a, { term, def, ids: [], defs: {} }).get(a); if (!g.ids.includes(id)) g.ids.push(id); g.defs[id] ||= { term, def }; }
    }
  }
  const keys = [...G.keys()].sort((a, b) => b.length - a.length), rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  figGlossBuild.re = keys.length ? new RegExp(keys.map(k => (/^[A-Za-z0-9]/.test(k) ? "(?<![A-Za-z0-9])" : "") + rx(esc(k)) + (/[A-Za-z0-9]$/.test(k) ? "(?![A-Za-z0-9])" : "")).join("|"), "g") : null;
  figGlossBuild.n = n; return (figGlossBuild.G = G);
}
// 一段文字（還沒跳脫）→ HTML，詞典裡的名詞變成可以點的按鈕；同一段文字每個名詞只標第一次
function figGl(text, T) {
  const G = figGlossBuild(), re = figGlossBuild.re, h = esc(text ?? ""); if (!re) return h; const seen = new Set();
  return h.replace(re, m => { const a = G.get(m.replace(/&amp;/g, "&")); if (!a || seen.has(m)) return m; seen.add(m); return `<button type="button" class="gterm" data-gterm="${m}"${T && a.ids.includes(T.id) ? ' data-own="1"' : ""}>${m}</button>`; });
}
// 定義卡：放在名詞所在的那一段後面；同一個名詞再點一次收起來
function figGlossCard(alias, T) {
  const a = figGlossBuild().get(alias); if (!a) return ""; const d = (T && a.defs[T.id]) || a.defs[a.ids[0]] || a;
  const others = a.ids.filter(id => id !== T?.id && INDT.has(id)).slice(0, 8);
  return `<div class="gdef" data-gdef="${esc(alias)}"><div class="gdh"><b>${esc(d.term)}</b><button type="button" class="linkbtn" data-gterm="${esc(alias)}" aria-label="收起">收起</button></div><p>${esc(d.def)}</p>
    ${others.length ? `<div class="gdo"><small class="note">其他用到這個名詞的題材</small>${others.map(id => { const t = INDT.get(id); return `<button type="button" class="ichip" data-iopen="${id}"><span class="itag">${MK_NAME[t.mk]}</span>${esc(t.name)}</button>`; }).join("")}</div>` : ""}</div>`;
}
function figGlossToggle(btn) {
  const alias = btn.dataset.gterm, T = INDT.get(W.indS?.open), open = document.querySelector(`.gdef[data-gdef="${CSS.escape(alias)}"]`);
  document.querySelectorAll(".gdef").forEach(x => x.remove()); document.querySelectorAll(".gterm[aria-expanded]").forEach(x => x.removeAttribute("aria-expanded"));
  if (open) { W.indS.gt = null; return; }
  let blk = btn.closest("p, li, dd, dt") || btn.parentElement; if (blk.tagName === "DT") blk = blk.nextElementSibling || blk; if (blk.parentElement?.classList.contains("itrc")) blk = blk.parentElement; // 詞條放在定義後面；趨勢放在那一條後面
  blk.insertAdjacentHTML("afterend", figGlossCard(alias, T)); btn.setAttribute("aria-expanded", "true"); W.indS.gt = alias;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-gterm]"); if (!b || !b.closest(".ifig, .ihow, .itrend, .izoom, .gdef, .iquiz")) return; e.stopPropagation(); if (b.closest(".gdef") && !b.classList.contains("gterm")) { const t = document.querySelector(`.gterm[data-gterm="${CSS.escape(b.dataset.gterm)}"][aria-expanded]`); if (t) return figGlossToggle(t); b.closest(".gdef").remove(); W.indS.gt = null; return; } figGlossToggle(b); }, true);
// 原理說明：「關鍵名詞」改成詞條（點了看還有哪些題材用到），其他段落的名詞可以點
function figHowHtml(F, T) {
  return F.how.map(([k, v], i) => /名詞/.test(k)
    ? `<details ${i < 2 ? "open" : ""}><summary>${esc(k)}</summary><dl class="gdl">${String(v).split("。").map(x => x.trim()).filter(Boolean).map(s => { const m = s.match(/^([^：:]{1,28})[：:](.+)$/); if (!m) return `<dd>${figGl(s, T)}</dd>`; const al = m[1].replace(/[（(][^）)]*[）)]/g, "").split(/[、／/]/)[0].trim(); return `<dt><button type="button" class="gterm" data-gterm="${esc(figGlossBuild().has(al) ? al : m[1].trim())}">${esc(m[1].trim())}</button></dt><dd>${esc(m[2].trim())}</dd>`; }).join("")}</dl></details>`
    : `<details ${i < 2 ? "open" : ""}><summary>${esc(k)}</summary><p>${figGl(v, T)}</p></details>`).join("");
}

// ---------- 每一段的詳細說明 ----------
const figQ = c => (indQuotable(c) ? W.quotes.get(c) : null);
const figPct = v => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
// 這一段的公司今天的平均漲跌、最強、最弱（只算有報價的）
function figDay(it) {
  const L = (it.c || []).map(([c, nm]) => ({ c, nm, p: figQ(c)?.chgPct })).filter(x => x.p != null); if (!L.length) return null;
  L.sort((a, b) => b.p - a.p); return { avg: L.reduce((s, x) => s + x.p, 0) / L.length, n: L.length, up: L.filter(x => x.p > 0).length, dn: L.filter(x => x.p < 0).length, best: L[0], worst: L.at(-1) };
}
// 原理說明裡提到這一段的句子：用段名拆出的關鍵字比對，最多 2 句
function figRel(T, it) {
  const F = indFig(T); if (!F?.how) return [];
  const toks = [...new Set([it.name, ...it.name.replace(/[（(][^）)]*[）)]/g, " ").split(/[\s、與及和／/]+/)].map(x => x.trim()).filter(x => x.length >= 2))];
  const S = F.how.filter(([k]) => !/名詞/.test(k)).flatMap(([k, v]) => String(v).split("。").map(x => x.trim()).filter(x => x.length > 6).map(x => ({ k, x, hit: toks.filter(t => x.includes(t)).length })));
  return S.filter(x => x.hit).sort((a, b) => b.hit - a.hit).slice(0, 2);
}
function figStepHtml(T, n) {
  const L = figItems(T), it = L[n - 1]; if (!it) return "";
  const prev = L[n - 2], next = L[n], D = figDay(it), rel = figRel(T, it), G = figGlossBuild(), re = figGlossBuild.re;
  const terms = re ? [...new Set(`${it.name} ${it.desc || ""} ${rel.map(r => r.x).join(" ")}`.match(new RegExp(re.source, "g")) || [])].filter(m => G.has(m)).slice(0, 6) : [];
  const AI = W.indStepAI?.[`${T.id}:${n}`];
  return `<div class="fsh"><span class="icn">${n}</span><b>${esc(it.name)}</b><small>${esc(it.tier)}${it.title ? "・" + esc(it.title) : ""}・${n}／${L.length}</small></div>
    <div class="fsdots" role="group" aria-label="跳到某一段">${L.map((x, i) => `<button type="button" data-fgo="${i + 1}" title="${esc(x.name)}"${i + 1 === n ? ' aria-current="step"' : ""} style="--tc:${TIER_COL[x.tier] || "var(--muted)"}">${i + 1}</button>`).join("")}</div>
    ${it.desc ? `<p class="fsdesc">${figGl(it.desc, T)}</p>` : ""}
    <p class="fsflow note">${prev ? `<button type="button" class="linkbtn" data-fgo="${n - 1}">‹ ${esc(prev.name)}</button>` : "（起點）"} → <b>${esc(it.name)}</b> → ${next ? `<button type="button" class="linkbtn" data-fgo="${n + 1}">${esc(next.name)} ›</button>` : "（終點）"}</p>
    ${rel.length ? `<div class="fsrel"><small class="note">原理說明裡提到這一段</small>${rel.map(r => `<p>${figGl(r.x, T)}。<span class="note">（${esc(r.k)}）</span></p>`).join("")}</div>` : ""}
    ${terms.length ? `<div class="fsterm"><small class="note">相關名詞</small>${terms.map(m => `<button type="button" class="gterm" data-gterm="${m}">${m}</button>`).join("")}</div>` : ""}
    ${D ? `<p class="fsday">今天這一段 <b class="${cls(D.avg)}">${figPct(D.avg)}</b> <span class="note">（${D.n} 檔有報價：漲 ${D.up}、跌 ${D.dn}${D.n > 1 ? `；最強 ${esc(D.best.nm)} ${figPct(D.best.p)}、最弱 ${esc(D.worst.nm)} ${figPct(D.worst.p)}` : ""}）</span></p>` : ""}
    ${it.c?.length ? `<div class="fsc">${it.c.slice(0, 12).map(([c, nm]) => { const q = figQ(c); return indQuotable(c) ? `<button type="button" class="ichip" data-sel="${esc(c)}">${esc(nm)} <small>${esc(c)}</small>${q?.chgPct != null ? ` <b class="${cls(q.chgPct)}">${figPct(q.chgPct)}</b>` : ""}</button>` : `<span class="ichip">${esc(nm)} <small>${esc(c)}</small></span>`; }).join("")}</div>` : ""}
    <div class="fsai">${!AI ? `<button type="button" class="btn sm" data-fai="${n}">問 AI：用白話解釋這一段</button>` : AI.loading ? `<p class="note">${esc(AI.loading)}</p>` : AI.err ? `<p class="note err">⚠︎ ${esc(AI.err)}</p><button type="button" class="btn sm" data-fai="${n}">再試一次</button>` : `<div class="fsaitxt">${esc(AI.text).replace(/\n/g, "<br>")}</div><p class="note">AI 依產業圖解的資料與一般產業知識整理，請自行查證，不是買賣建議。</p>`}</div>`;
}
async function figStepAsk(T, n) {
  const it = figItems(T)[n - 1], A = (W.indStepAI ||= {}), key = `${T.id}:${n}`, F = indFig(T); if (!it) return;
  const redo = () => { document.querySelectorAll(".ifig, .izoom").forEach(b => { if (+b.dataset.fn === n) figStep(b, T, n); }); };
  if (W.off) { A[key] = { err: "需要部署到網站才能使用" }; return redo(); }
  A[key] = { loading: "AI 整理中（約 10～30 秒）…" }; redo();
  try {
    const L = figItems(T), ctx = `題材：${T.cat}｜${T.name}\n說明：${T.desc}\n整條產業鏈：${L.map((x, i) => `${i + 1}. ${x.tier}・${x.name}（${x.desc || ""}）`).join("；")}\n要解釋的這一段：${n}. ${it.tier}・${it.title || ""}・${it.name}：${it.desc || ""}\n這一段的代表公司：${(it.c || []).map(([c, nm]) => `${nm}（${c}）`).join("、") || "—"}\n原理說明：${(F?.how || []).map(([k, v]) => `${k}：${v}`).join("\n")}`;
    A[key] = { text: await aiChat(ctx, `請用一般投資人聽得懂的白話，解釋「${T.name}」產業鏈裡「${it.name}」這一段：① 在做什麼、做出來的東西長什麼樣子 ② 技術門檻與關鍵設備、材料 ③ 在整條鏈的價值與議價能力（和上一段、下一段的關係）④ 列出的代表公司各自扮演什麼角色 ⑤ 景氣好壞要看哪些指標。條列 5～7 點，每點一兩句；資料裡沒有寫到、屬於一般產業知識的請註明「一般知識」，不要編造數字，也不要給買賣建議。`) };
  } catch (e) { A[key] = { err: e.message }; }
  redo();
}

// ---------- 依今日漲跌上色、找公司 ----------
const figTools = T => (W.indS.fheat ??= !!store.get("watch:fheat", false), figItems(T).length) ? `<div class="figtools"><button type="button" class="btn sm" data-fheat aria-pressed="${!!W.indS.fheat}">${W.indS.fheat ? "● 依今日漲跌上色" : "○ 依今日漲跌上色"}</button><label class="ffind"><input type="search" data-ffind placeholder="找公司在哪一段：代號或名稱" aria-label="找公司在哪一段" value="${esc(W.indS.ffind || "")}" autocomplete="off" enterkeyhint="search"></label></div><div class="ffres note"></div>` : "";
// 每一段的編號依那一段公司今天的平均漲跌上色（±3% 以上最深）；沒有報價的段維持原色
function figHeat(box, T) {
  const svg = box?.querySelector("svg"); if (!svg) return; const on = !!W.indS.fheat, L = figItems(T); svg.classList.toggle("fheat", on);
  svg.querySelectorAll(".fbadge").forEach(g => { const D = on ? figDay(L[+g.dataset.n - 1] || {}) : null;
    if (!D) { g.style.removeProperty("--fh"); g.querySelector("title")?.remove(); return; }
    const k = Math.round(35 + Math.min(1, Math.abs(D.avg) / 3) * 65); g.style.setProperty("--fh", D.avg === 0 ? "var(--muted)" : `color-mix(in srgb, var(${D.avg > 0 ? "--up" : "--down"}) ${k}%, #808080)`);
    let t = g.querySelector("title"); if (!t) { t = document.createElementNS("http://www.w3.org/2000/svg", "title"); g.prepend(t); } t.textContent = `${L[+g.dataset.n - 1].name} 今天 ${figPct(D.avg)}`; });
  const lg = box.querySelector(".fhlegend"); if (on && !lg) box.querySelector(".figtools")?.insertAdjacentHTML("afterend", `<p class="fhlegend note">編號顏色＝那一段公司今天的平均漲跌：<b class="up">紅＝漲</b>、<b class="down">綠＝跌</b>，越深漲跌越大；灰色是沒有報價。</p>`); else if (!on) lg?.remove();
}
// 找公司：代號開頭或名稱包含；圖上標出那幾段，下面列出段名（點了跳過去）
function figFind(box, T, q) {
  const svg = box?.querySelector("svg"), out = box?.querySelector(".ffres"); if (!svg || !out) return; q = String(q || "").trim().toUpperCase();
  svg.querySelectorAll(".fbadge.hit").forEach(g => g.classList.remove("hit")); svg.classList.toggle("ffind-on", !!q); if (!q) { out.innerHTML = ""; return; }
  const L = figItems(T), hits = [];
  L.forEach((it, i) => { const m = (it.c || []).filter(([c, nm]) => c.toUpperCase().startsWith(q) || String(nm).toUpperCase().includes(q) || String(nameOf(c) || "").toUpperCase().includes(q)); if (m.length) hits.push({ n: i + 1, it, m }); });
  hits.forEach(h => svg.querySelector(`.fbadge[data-n="${h.n}"]`)?.classList.add("hit"));
  out.innerHTML = hits.length ? hits.map(h => `<button type="button" class="linkbtn" data-fgo="${h.n}">${h.n}. ${esc(h.it.name)}</button><span>：${h.m.slice(0, 3).map(([, nm]) => esc(nm)).join("、")}</span>`).join("　") : `這張圖裡沒有「${esc(q)}」`;
}
document.addEventListener("input", e => { const t = e.target.closest?.("[data-ffind]"); if (!t) return; const box = t.closest(".ifig"), T = INDT.get(W.indS.open); W.indS.ffind = t.value; if (box && T) figFind(box, T, t.value); });

// ---------- 考考自己 ----------
// 從這張圖的公司隨機出題：「X 在哪一段」三選一（只挑只出現在一段的公司，答案才唯一）
function figQuizQ(T, seed) {
  const L = figItems(T), cnt = new Map(); L.forEach(it => (it.c || []).forEach(([c]) => cnt.set(c, (cnt.get(c) || 0) + 1)));
  const pool = L.flatMap((it, i) => (it.c || []).filter(([c]) => cnt.get(c) === 1).map(([c, nm]) => ({ c, nm, n: i + 1 }))); if (pool.length < 2 || L.length < 3) return null;
  let r = (seed * 9301 + 49297) % 233280; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const q = pool[Math.floor(rnd() * pool.length)], others = L.map((_, i) => i + 1).filter(n => n !== q.n).sort(() => rnd() - 0.5).slice(0, 2);
  return { ...q, opts: [q.n, ...others].sort(() => rnd() - 0.5) };
}
function figQuiz(T) {
  const Z = (W.indQuiz ||= {}), S = (Z[T.id] ||= { seed: Math.floor(Math.random() * 1e5), ans: null, ok: 0, all: 0 }), Q = figQuizQ(T, S.seed); if (!Q) return "";
  const L = figItems(T), done = S.ans != null;
  return `<section class="iseg iquiz"><h4>考考自己 <span class="note">${S.all ? `答對 ${S.ok}／${S.all}` : "看完圖解試試看"}</span></h4>
    <p>「<b>${esc(Q.nm)}</b>」<small class="note">${esc(Q.c)}</small> 在這條產業鏈的哪一段？</p>
    <div class="iqopts">${Q.opts.map(n => `<button type="button" class="btn sm" data-fq="${n}"${done ? ` disabled aria-pressed="${n === Q.n || n === S.ans}"` : ""}${done && n === Q.n ? ' data-ok="1"' : done && n === S.ans ? ' data-ok="0"' : ""}>${done && n === Q.n ? "✓ " : done && n === S.ans ? "✗ " : ""}${n}. ${esc(L[n - 1].name)}</button>`).join("")}</div>
    ${done ? `<p class="iqres">${S.ans === Q.n ? `<b>✓ 答對了！</b>` : `<b>✗ 差一點</b>，答案是 ${Q.n}. ${esc(L[Q.n - 1].name)}。`}${L[Q.n - 1].desc ? ` ${esc(L[Q.n - 1].name)}：${figGl(L[Q.n - 1].desc, T)}` : ""}</p><button type="button" class="btn sm primary" data-fqn>下一題</button>` : ""}</section>`;
}
function figQuizClick(e, T) {
  const S = W.indQuiz?.[T.id]; if (!S) return false; const a = e.target.closest("[data-fq]"), nx = e.target.closest("[data-fqn]");
  if (a && S.ans == null) { const Q = figQuizQ(T, S.seed); S.ans = +a.dataset.fq; S.all++; if (S.ans === Q.n) S.ok++; const fb = document.querySelector(".ifig"); if (fb) { figPlay(fb, T, false); figStep(fb, T, Q.n); } }
  else if (nx) { S.seed++; S.ans = null; } else return false;
  const sec = e.target.closest(".iquiz"); if (sec) sec.outerHTML = figQuiz(T); return true;
}

// ---------- 接到 watch.html 的圖解 ----------
// 圖上的互動（點編號、上一段下一段、逐步播放）之外：跳到某一段、問 AI、上色開關
function figxClick(e, box, T) {
  const go = e.target.closest("[data-fgo]"); if (go) { figPlay(box, T, false); figStep(box, T, +go.dataset.fgo); return true; }
  const ai = e.target.closest("[data-fai]"); if (ai) { figStepAsk(T, +ai.dataset.fai); return true; }
  const ht = e.target.closest("[data-fheat]"); if (ht) { W.indS.fheat = !W.indS.fheat; store.set("watch:fheat", W.indS.fheat); ht.setAttribute("aria-pressed", W.indS.fheat); ht.textContent = `${W.indS.fheat ? "●" : "○"} 依今日漲跌上色`; figHeat(box, T); return true; }
  return false;
}
// 整頁重畫後（報價更新）還原：上色、找公司、展開的名詞
function figAfter(box, T, focusFind) {
  if (!box) return; figHeat(box, T); if (W.indS.ffind) figFind(box, T, W.indS.ffind);
  if (focusFind) { const i = box.querySelector("[data-ffind]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  if (W.indS.gt) { const b = document.querySelector(`#lx .gterm[data-gterm="${CSS.escape(W.indS.gt)}"]`); W.indS.gt = null; if (b) figGlossToggle(b); }
}
{ const css = document.createElement("style"); css.textContent = `.gterm { display: inline; padding: 0; margin: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; text-decoration: underline dotted color-mix(in srgb, var(--ink) 45%, transparent); text-underline-offset: 3px; }
.gterm[aria-expanded="true"] { text-decoration-style: solid; text-decoration-color: var(--gold); }
.gdef { margin: 4px 0 10px; padding: 8px 0 8px 12px; box-shadow: inset 2px 0 0 var(--gold); font-size: 13.5px; } .gdef p { margin: 4px 0; line-height: 1.65; } .gdh { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; } .gdo { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; margin-top: 4px; }
.gdl .gdef { grid-column: 1 / -1; } .gdl { margin: 6px 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; font-size: 13.5px; line-height: 1.6; } .gdl dt { font-weight: 500; } .gdl dd { margin: 0; } @media (max-width: 600px) { .gdl { grid-template-columns: 1fr; gap: 2px; } .gdl dd { margin-bottom: 6px; } }
.fsdots { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 4px; } .fsdots button { min-width: 26px; height: 26px; padding: 0 6px; border: 0; border-radius: 13px; background: transparent; color: var(--muted); font: 500 12px var(--font-num); cursor: pointer; box-shadow: inset 0 -1.5px 0 color-mix(in srgb, var(--tc) 55%, transparent); }
.fsdots button[aria-current] { color: var(--ink); background: color-mix(in srgb, var(--tc) 22%, transparent); }
.fsflow { margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: baseline; } .fsrel p { margin: 4px 0; font-size: 13px; line-height: 1.6; } .fsterm { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; margin: 6px 0; font-size: 13px; }
.fsday { margin: 6px 0; font-size: 13px; } .fsc .ichip b { font: 500 11.5px var(--font-num); } .fsai { margin-top: 8px; } .fsaitxt { font-size: 13.5px; line-height: 1.75; }
.figtools { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 2px 0 4px; } .ffind { flex: 1 1 200px; min-width: 0; display: flex; } .ffind input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 4px 2px; color: var(--ink); }
.ffres { margin: 2px 0 6px; font-size: 12.5px; line-height: 1.7; } .fhlegend { margin: 2px 0 6px; font-size: 12px; }
.fheat .fbadge[style*="--fh"] circle { fill: var(--fh); } .ffind-on .fbadge { opacity: .3; } .ffind-on .fbadge.hit { opacity: 1; animation: fpulse 1.1s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.iquiz p { margin: 6px 0; } .iqopts { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; } .iqopts .btn[data-ok="1"], .iqopts .btn[data-ok="1"]:disabled { color: var(--ink); opacity: 1; box-shadow: inset 0 -1.5px 0 var(--gold); font-weight: 500; } .iqopts .btn[data-ok="0"], .iqopts .btn[data-ok="0"]:disabled { color: var(--muted); opacity: 1; text-decoration: line-through; } .iqres { font-size: 13.5px; line-height: 1.65; }
@media (prefers-reduced-motion: reduce) { .ffind-on .fbadge.hit { animation: none; } }`; document.head.appendChild(css); }
