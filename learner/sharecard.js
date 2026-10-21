/* 分享情報圖卡：把一個區塊的重點畫成 PNG（品牌標頭＋網址、底部「僅供研究參考，非投資建議」），可以下載、複製或用手機分享。
   不用 html2canvas／foreignObject（iPhone Safari 會讓畫布無法匯出），改成依資料用 canvas 重畫；圖表用 SVG（把顏色、字型寫進每個元素）畫進去。
   用法：在區塊放 <button class="sharebtn" data-sharecard="key">分享情報圖卡</button>，並在 SHARE[key] 放一個回傳圖卡內容的函式：
   { title, sub, stats: [[名稱, 數值, 顏色]], sections: [{ h, rows: [[左, 右, 右邊顏色, 左邊小字]] }], svg: 元素, text: 段落, name: 檔名 }
   首頁、看盤、存股模擬三頁都載入這支（存股模擬不載 core.js，所以這裡不依賴 core.js）。 */
// 圖示：看盤、首頁有 core.js 的 ico()；存股頁沒有，就用這裡的三個
const SC_ICO = { dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 16V5a1 1 0 0 1 1-1h9"/>', share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>' };
const scIco = n => (typeof ico === "function" ? ico(n) : `<svg width="1.05em" height="1.05em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.16em;margin-right:.32em" aria-hidden="true">${SC_ICO[n]}</svg>`);
const SITE_HOST = "kline-school.vercel.app"; // 換網域只要改這裡
const SHARE = {};
const SCARD = { W: 1080, P: 64, bg: "#09090B", card: "#121215", line: "#27272A", ink: "#FFFFFF", muted: "#A1A1AA", up: "#ef4444", down: "#22c55e",
  font: '"Inter", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif', mono: '"JetBrains Mono", ui-monospace, monospace' };
const scColor = c => { if (!c) return SCARD.ink; if (c === "up") return SCARD.up; if (c === "down") return SCARD.down; if (c === "muted") return SCARD.muted;
  if (/^var\(/.test(c)) { const v = getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1).split(",")[0].trim()).trim(); return v || SCARD.ink; } return c; };
// SVG 轉成可以畫進 canvas 的圖：每個元素的 fill／stroke／字型從畫面上的樣式抄進屬性（CSS 變數在獨立的 SVG 裡讀不到）
function scSvgImage(svg) {
  const c = svg.cloneNode(true), src = [svg, ...svg.querySelectorAll("*")], dst = [c, ...c.querySelectorAll("*")];
  src.forEach((el, i) => { const cs = getComputedStyle(el), d = dst[i]; if (!d) return;
    for (const k of ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "stroke-dasharray", "font-size", "font-weight", "text-anchor", "dominant-baseline", "paint-order", "stroke-linejoin", "letter-spacing"]) { const v = cs.getPropertyValue(k); if (v && v !== "normal" && !(k === "stroke-dasharray" && v === "none")) d.setAttribute(k, v); }
    const tf = cs.transform; if (tf && tf !== "none") d.setAttribute("transform", tf); // 用 CSS 定位的點（例如矩陣的圓點）
    if (el.tagName === "text") d.setAttribute("font-family", SCARD.font); d.removeAttribute("class"); d.removeAttribute("style"); });
  const r = svg.getBoundingClientRect(), vb = svg.viewBox?.baseVal, w = vb?.width || r.width || 600, h = vb?.height || r.height || 300;
  c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); c.setAttribute("width", w); c.setAttribute("height", h);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(c));
  return new Promise(res => { const im = new Image(); im.onload = () => res({ im, w, h }); im.onerror = () => res(null); im.src = url; });
}
const scLogo = () => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = "logo.svg?v=4"; });
function scWrap(x, text, maxW) { const out = []; let line = ""; for (const ch of String(text)) { if (ch === "\n" || x.measureText(line + ch).width > maxW) { out.push(line); line = ch === "\n" ? "" : ch; } else line += ch; } if (line) out.push(line); return out; }
async function shareCardCanvas(spec) {
  const { W, P } = SCARD, inner = W - P * 2, cv = document.createElement("canvas"), x = cv.getContext("2d");
  const [logo, chart] = await Promise.all([scLogo(), spec.svg ? scSvgImage(spec.svg) : null]);
  // 先量高度
  x.font = `600 48px ${SCARD.font}`; const tl = scWrap(x, spec.title || "", inner);
  x.font = `400 28px ${SCARD.font}`; const sl = spec.sub ? scWrap(x, spec.sub, inner) : [], txl = spec.text ? scWrap(x, spec.text, inner) : [];
  const stats = (spec.stats || []).slice(0, 4), secs = (spec.sections || []).filter(s => s.rows?.length).map(s => ({ ...s, rows: s.rows.slice(0, s.max || 8) }));
  const chH = chart ? Math.round(inner * Math.min(1.1, chart.h / chart.w)) : 0;
  let H = 150 + tl.length * 60 + sl.length * 40 + 24 + (stats.length ? 170 : 0) + (chart ? chH + 32 : 0) + txl.length * 42 + (txl.length ? 24 : 0)
    + secs.reduce((t, s) => t + 64 + s.rows.length * 70 + 16, 0) + 130;
  cv.width = W; cv.height = H;
  x.fillStyle = SCARD.bg; x.fillRect(0, 0, W, H);
  // 品牌標頭
  if (logo) x.drawImage(logo, P, 40, 64, 64);
  x.fillStyle = SCARD.ink; x.font = `700 34px ${SCARD.font}`; x.textBaseline = "middle"; x.fillText("KLineLab K線情報局", P + 84, 62);
  x.fillStyle = SCARD.muted; x.font = `400 24px ${SCARD.mono}`; x.fillText(SITE_HOST, P + 84, 94);
  x.strokeStyle = SCARD.line; x.lineWidth = 2; x.beginPath(); x.moveTo(P, 130); x.lineTo(W - P, 130); x.stroke();
  let y = 170; x.textBaseline = "alphabetic";
  x.fillStyle = SCARD.ink; x.font = `600 48px ${SCARD.font}`; tl.forEach(l => { y += 52; x.fillText(l, P, y); y += 8; });
  x.fillStyle = SCARD.muted; x.font = `400 28px ${SCARD.font}`; sl.forEach(l => { y += 36; x.fillText(l, P, y); y += 4; }); y += 28;
  if (stats.length) { const gw = (inner - (stats.length - 1) * 16) / stats.length;
    stats.forEach(([k, v, c], i) => { const gx = P + i * (gw + 16); x.fillStyle = SCARD.card; x.fillRect(gx, y, gw, 140); x.fillStyle = SCARD.muted; x.font = `400 24px ${SCARD.font}`; x.fillText(String(k), gx + 20, y + 42);
      x.fillStyle = scColor(c); let fs = 44; x.font = `600 ${fs}px ${SCARD.mono}`; while (x.measureText(String(v)).width > gw - 40 && fs > 22) { fs -= 2; x.font = `600 ${fs}px ${SCARD.mono}`; } x.fillText(String(v), gx + 20, y + 106); });
    y += 170; }
  if (chart) { x.fillStyle = SCARD.card; x.fillRect(P, y, inner, chH); x.drawImage(chart.im, P, y, inner, chH); y += chH + 32; }
  if (txl.length) { x.fillStyle = SCARD.ink; x.font = `400 28px ${SCARD.font}`; txl.forEach(l => { y += 36; x.fillText(l, P, y); y += 6; }); y += 24; }
  for (const s of secs) {
    x.fillStyle = SCARD.muted; x.font = `500 28px ${SCARD.font}`; x.fillText(String(s.h || ""), P, y + 36); y += 64;
    s.rows.forEach(([l, r, c, ls], i) => {
      x.fillStyle = i % 2 ? SCARD.bg : SCARD.card; x.fillRect(P, y, inner, 64);
      x.fillStyle = SCARD.ink; x.font = `500 28px ${SCARD.font}`; let lt = String(l ?? ""); const rw = (x.font = `600 28px ${SCARD.mono}`, x.measureText(String(r ?? "")).width); x.font = `500 28px ${SCARD.font}`;
      const room = inner - rw - 60 - (ls ? Math.min(260, x.measureText(ls).width + 20) : 0); while (lt.length > 1 && x.measureText(lt).width > room) lt = lt.slice(0, -2) + "…";
      x.fillText(lt, P + 20, y + 42); if (ls) { const lw = x.measureText(lt).width; x.fillStyle = SCARD.muted; x.font = `400 22px ${SCARD.font}`; let t = String(ls); while (t.length > 1 && x.measureText(t).width > 240) t = t.slice(0, -2) + "…"; x.fillText(t, P + 36 + lw, y + 42); }
      x.fillStyle = scColor(c); x.font = `600 28px ${SCARD.mono}`; x.textAlign = "right"; x.fillText(String(r ?? ""), W - P - 20, y + 42); x.textAlign = "left"; y += 70; });
    y += 16;
  }
  // 頁尾
  y = H - 70; x.strokeStyle = SCARD.line; x.beginPath(); x.moveTo(P, y - 24); x.lineTo(W - P, y - 24); x.stroke();
  x.fillStyle = SCARD.muted; x.font = `400 24px ${SCARD.font}`; x.fillText(`僅供研究參考，非投資建議・${spec.date || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}`, P, y + 12);
  return cv;
}
// 預覽視窗：下載、複製、分享（手機）。看盤、存股在 iframe 裡而且 iframe 跟內容一樣高，固定定位的視窗會出現在
// iframe 的正中間（常常在畫面外，看起來像按了沒反應），所以同網域時改畫在最上層頁面（index.html 也載入這支，有樣式）
const scHost = () => { try { if (window.top !== window && window.top.document.body) return window.top; } catch {} return window; };
let scBusy = false;
async function shareCardOpen(key) {
  const f = SHARE[key]; if (!f || scBusy) return; scBusy = true;
  const H = scHost(), D = H.document, wait = scToast("正在產生圖卡…", 0);
  try {
    let spec; try { spec = await f(); } catch (e) { console.error("sharecard", key, e); spec = null; }
    if (!spec) return scToast("這個區塊還沒有資料，等載入完再分享");
    let cv; try { cv = await shareCardCanvas(spec); } catch (e) { console.error("sharecard draw", key, e); return scToast("圖卡產生失敗，請再試一次"); }
    const blob = await new Promise(r => cv.toBlob(r, "image/png")); if (!blob) return scToast("圖卡產生失敗，請再試一次");
    const name = `KLineLab-${spec.name || key}-${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}.png`, url = URL.createObjectURL(blob), N = H.navigator;
    const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null, canShare = !!(file && N.canShare?.({ files: [file] }));
    const canCopy = !!(N.clipboard?.write && H.ClipboardItem);
    const m = D.createElement("div"); m.className = "sc-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "分享情報圖卡");
    m.innerHTML = `<div class="sc-box"><div class="sc-hd"><b>圖卡預覽</b><button type="button" data-sca="x" class="sc-x" aria-label="關閉">✕</button></div><div class="sc-img"><img src="${url}" alt="情報圖卡預覽"></div>
      <p class="sc-tip">${canShare ? "手機：按「分享」可以直接存到相簿或傳給朋友；也可以長按圖片儲存。" : "也可以在圖片上按右鍵另存。"}</p>
      <div class="sc-acts"><button type="button" data-sca="dl" class="pri">${scIco("dl")}下載 PNG 圖片</button>${canCopy ? '<button type="button" data-sca="copy">${scIco("copy")}複製到剪貼簿</button>' : ""}${canShare ? '<button type="button" data-sca="share">分享…</button>' : ""}</div></div>`;
    const close = () => { m.remove(); D.removeEventListener("keydown", k); setTimeout(() => URL.revokeObjectURL(url), 3000); }, k = e => { if (e.key === "Escape") close(); };
    m.addEventListener("click", async e => { const a = e.target.closest("[data-sca]")?.dataset.sca; if (e.target === m || a === "x") return close();
      if (a === "dl") { const l = D.createElement("a"); l.href = url; l.download = name; D.body.append(l); l.click(); l.remove(); scToast("已下載圖卡"); }
      if (a === "copy") { try { await N.clipboard.write([new H.ClipboardItem({ "image/png": blob })]); scToast("已複製圖卡，可以直接貼上"); } catch { scToast("這個瀏覽器不能複製圖片，請改用下載"); } }
      if (a === "share") { try { await N.share({ files: [file], text: `${spec.title}｜KLineLab K線情報局 ${SITE_HOST}` }); } catch {} } });
    D.addEventListener("keydown", k); D.body.append(m); m.querySelector('[data-sca="dl"]').focus({ preventScroll: true });
  } finally { wait.remove(); scBusy = false; }
}
function scToast(t, ms = 1800) { const D = scHost().document, d = D.createElement("div"); d.className = "sc-toast"; d.setAttribute("role", "status"); d.textContent = t; D.body.append(d); if (ms) setTimeout(() => d.remove(), ms); return d; }
document.addEventListener("click", e => { const b = e.target.closest("[data-sharecard]"); if (!b) return; e.preventDefault(); e.stopPropagation(); shareCardOpen(b.dataset.sharecard); }, true);
// 把排行清單（tools.js 的 rkList）讀成圖卡的列
const scRankRows = (ol, n = 8) => [...(ol?.querySelectorAll(":scope > li") || [])].slice(0, n).map(li => { const v = li.querySelector(".tw-v b"), cl = v?.className || "";
  return [`${li.querySelector(".tw-no")?.textContent.trim() || ""}. ${li.querySelector(".tw-who b")?.textContent.trim() || ""}`, v?.textContent.trim() || "", /\bup\b/.test(cl) ? "up" : /\bdown\b/.test(cl) ? "down" : "", li.querySelector(".tw-who small")?.textContent.trim() || ""]; });
const scSectionsFrom = (root, n = 8, maxSec = 2) => [...(root?.querySelectorAll("ol.tw-rank") || [])].slice(0, maxSec).map(ol => { let h = ol.previousElementSibling; while (h && !/^H[2-4]$/.test(h.tagName)) h = h.previousElementSibling; return { h: h?.textContent.trim() || "", rows: scRankRows(ol, n) }; }).filter(s => s.rows.length);
const scBtn = (key, extra = "") => `<button type="button" class="sharebtn${extra}" data-sharecard="${key}">${scIco("share")}分享情報圖卡</button>`;
(() => { const s = document.createElement("style"); s.textContent = `
.sharebtn { border: 0; border-radius: 6px; background: var(--surface-2, #1c1c20); color: var(--ink, #fff); font: 500 12.5px var(--font-body, sans-serif); padding: 5px 10px; cursor: pointer; white-space: nowrap; }
.sharebtn.fr { float: right; margin-left: 8px; }
.sc-modal { position: fixed; inset: 0; z-index: 9999; background: rgba(0, 0, 0, .72); display: flex; align-items: center; justify-content: center; padding: 16px; }
.sc-box { background: #121215; color: #fff; border-radius: 10px; padding: 12px; width: min(520px, 100%); max-height: 100%; display: flex; flex-direction: column; gap: 10px; font: 14px sans-serif; }
.sc-hd { display: flex; align-items: center; justify-content: space-between; } .sc-x { border: 0; background: none; color: #A1A1AA; font-size: 18px; cursor: pointer; padding: 4px 8px; }
.sc-img { min-height: 0; flex: 1; overflow: auto; border-radius: 6px; background: #09090B; } .sc-img img { width: 100%; display: block; }
.sc-tip { margin: 0; color: #A1A1AA; font-size: 12.5px; }
.sc-acts { display: flex; flex-wrap: wrap; gap: 8px; } .sc-acts button { flex: 1 1 auto; border: 0; border-radius: 6px; padding: 10px 12px; background: #27272A; color: #fff; font: 500 14px sans-serif; cursor: pointer; } .sc-acts .pri { background: #fff; color: #09090B; }
.sc-toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 10000; background: #27272A; color: #fff; padding: 8px 14px; border-radius: 6px; font: 14px sans-serif; }`; document.head.append(s); })();
