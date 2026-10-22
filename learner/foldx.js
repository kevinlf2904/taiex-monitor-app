/* 長內容自動收合（K線學堂、看盤共用）：
   ・長文章、長段落：超過 FOLD_LINES 行就先顯示前 FOLD_SHOW 行，下面一顆「展開全文 ▾／收合 ▴」
   ・很長的區塊、文章（article、section…，比螢幕高 1.3 倍以上）：先顯示約四分之三個螢幕高，下面「展開全部 ▾／收合 ▴」；只收最內層那個太長的
   ・長清單（ul、ol）：超過 FOLD_ITEMS 項就先顯示前 FOLD_FIRST 項，下面一顆「展開其餘 N 項 ▾／收合 ▴」；選中的那一項在後面就不收
   ・畫面每秒重畫（報價）也會記住哪些已經展開；不想收的區塊加 data-nofold
   用 MutationObserver 看內容變化，下一個畫面更新前處理，不會閃。 */
const FOLD_LINES = 8, FOLD_SHOW = 5, FOLD_ITEMS = 14, FOLD_FIRST = 8;
const FOLD_TEXT = "p, blockquote, .iaitxt, .qx-aitxt, .fsaitxt, .mn-sum, .yh-sum, .pbody, .cx-body, .lxbody, .msum, .mdesc, .book-sum, .fsdesc";
const FOLD_LIST = "ul, ol";
const FOLD_SEC = "article, section, .iseg, .csec, .scard, .cxwin, .prose";
const FOLD_SEC_SKIP = ".hero, .learn, #lessonList, .izoom, .igal, .iislands, .ithemes, .igal-wrap, .gstage, :has(input:not([type=hidden]), textarea, select, canvas, .chart-fullscreen, [aria-busy=true])";
// 不收：導覽、按鈕列、表單、圖表、浮動視窗、已經有自己「更多」的地方、橫排的晶片
const FOLD_SKIP = "#wl, .wl, #sheetExtra .stlist, nav, header, footer, button, label, select, form, svg, table, details:not([open]), [data-nofold], .seg, .mkseg, .scrseg, .ichips, .gtiles, .mtiles, .tabs, .wtabs, .top, .sheet-h, .figctl, .izoom, .chat, .chat-fab, .gdef, .fold-btn, .foot, .foot-disc, .caldays, .irb, .rrank, .rheat, .hist, .vbars, .secgrid, .tmap, .contrib, .stlist";
const foldOpen = new Set(), foldSeen = new WeakSet(); // foldSeen：量過、不用收的，重畫前不再量（每秒重畫時省效能）
const foldKey = (el, kind) => kind + "|" + (el.closest("section, article, .iseg, .csec, .scard, details, li")?.querySelector("h1, h2, h3, h4, summary, b")?.textContent.trim().slice(0, 30) || "") + "|" + el.textContent.trim().slice(0, 40);
function foldBtn(k, open, txt) { const b = document.createElement("button"); b.type = "button"; b.className = "fold-btn"; b.dataset.foldk = k; b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "收合 ▴" : txt; return b; }
function foldText(el) {
  if (el.dataset.fold || foldSeen.has(el)) return; if (el.closest(FOLD_SKIP) || el.closest(".fold-t")) return foldSeen.add(el);
  const cs = getComputedStyle(el); if (cs.display === "none" || cs.display.startsWith("inline")) return;
  if (!el.offsetHeight) return; // 還沒顯示（收在隱藏區塊裡），之後再量
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6; if (!(el.scrollHeight > lh * FOLD_LINES + 4)) return foldSeen.add(el);
  const k = foldKey(el, "t"), open = foldOpen.has(k); el.dataset.fold = "t"; el.style.setProperty("--fold-h", `${(lh * FOLD_SHOW).toFixed(1)}px`);
  el.classList.toggle("fold-t", !open); el.after(foldBtn(k, open, "展開全文 ▾"));
}
function foldList(el) {
  if (el.dataset.fold || foldSeen.has(el)) return; if (el.closest(FOLD_SKIP)) return foldSeen.add(el);
  const L = [...el.children].filter(x => x.tagName === "LI"); if (L.length <= FOLD_ITEMS) return foldSeen.add(el);
  if (el.nextElementSibling?.matches("button") && /看全部|更多|展開/.test(el.nextElementSibling.textContent)) return foldSeen.add(el); // 已經有自己的「看全部」
  const cs = getComputedStyle(el); if (cs.display.includes("flex") && cs.flexDirection === "row" || cs.display === "none") return; // 橫排的不算
  const sel = L.findIndex(x => x.matches('.sel, .on, .open, [aria-current="true"]') || x.querySelector('[aria-pressed="true"], [aria-current="true"], .sel'));
  if (sel >= FOLD_FIRST) return; // 選中的在後面，不收免得看不到
  const k = foldKey(el, "l"), open = foldOpen.has(k); el.dataset.fold = "l";
  L.slice(FOLD_FIRST).forEach(x => x.classList.toggle("fold-x", !open));
  el.after(foldBtn(k, open, `展開其餘 ${L.length - FOLD_FIRST} 項 ▾`));
}
const foldSecMax = () => Math.max(800, innerHeight * 1.3);
function foldSec(el) {
  if (el.dataset.fold || foldSeen.has(el) || !el.offsetHeight) return; if (el.closest(FOLD_SKIP) || el.matches(FOLD_SEC_SKIP) || el.closest(".fold-s")) return foldSeen.add(el);
  const max = foldSecMax(); if (!(el.scrollHeight > max)) return foldSeen.add(el);
  if ([...el.querySelectorAll(FOLD_SEC)].some(x => !x.matches(FOLD_SEC_SKIP) && x.scrollHeight > max)) return; // 裡面還有更小、也太長的區塊，收那個
  const k = foldKey(el, "s"), open = foldOpen.has(k); el.dataset.fold = "s"; el.style.setProperty("--fold-h", `${Math.round(innerHeight * 0.75)}px`);
  el.classList.toggle("fold-s", !open); el.after(foldBtn(k, open, "展開全部 ▾"));
}
function foldScan(root = document.body) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(FOLD_LIST).forEach(foldList); root.querySelectorAll(FOLD_TEXT).forEach(foldText);
  [...root.querySelectorAll(FOLD_SEC)].reverse().forEach(foldSec); // 由內往外：內層先收，外層就不會再超過
}
document.addEventListener("click", e => {
  const b = e.target.closest(".fold-btn"); if (!b) return; e.preventDefault(); e.stopPropagation();
  const k = b.dataset.foldk, el = b.previousElementSibling, open = b.getAttribute("aria-expanded") !== "true";
  open ? foldOpen.add(k) : foldOpen.delete(k); b.setAttribute("aria-expanded", String(open));
  if (el?.dataset.fold === "t") { el.classList.toggle("fold-t", !open); b.textContent = open ? "收合 ▴" : "展開全文 ▾"; }
  else if (el?.dataset.fold === "s") { el.classList.toggle("fold-s", !open); b.textContent = open ? "收合 ▴" : "展開全部 ▾"; }
  else if (el?.dataset.fold === "l") { const L = [...el.children].filter(x => x.tagName === "LI"); L.slice(FOLD_FIRST).forEach(x => x.classList.toggle("fold-x", !open)); b.textContent = open ? "收合 ▴" : `展開其餘 ${L.length - FOLD_FIRST} 項 ▾`; }
  if (!open) { const r = (el || b).getBoundingClientRect(); if (r.top < 0) (el || b).scrollIntoView({ block: "start" }); } // 收合後若標題已經捲出畫面，捲回這一段開頭
}, true);
{ let q = false; const run = () => { q = false; foldScan(); };
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(run); } }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("toggle", e => { if (e.target.tagName === "DETAILS" && e.target.open) foldScan(e.target); }, true); // 打開 <details> 後裡面的內容才量得到高度
  addEventListener("load", () => foldScan()); }
{ const css = document.createElement("style"); css.textContent = `.fold-s { max-height: var(--fold-h, 600px); overflow: hidden; -webkit-mask-image: linear-gradient(180deg, #000 85%, transparent); mask-image: linear-gradient(180deg, #000 85%, transparent); }
.fold-t { max-height: var(--fold-h, 8em); overflow: hidden; -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent); mask-image: linear-gradient(180deg, #000 60%, transparent); }
.fold-x { display: none !important; }
.fold-btn { display: block; margin: 2px 12px 10px; padding: 4px 0; border: 0; background: none; color: var(--muted); font: 500 12.5px var(--font-body, inherit); cursor: pointer; text-align: left; }
.fold-btn:hover { color: var(--ink); } .fold-btn[aria-expanded="true"] { color: var(--muted); }`; document.head.appendChild(css); }
