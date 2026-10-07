/* 產業原理圖解：用簡單的圖元（方塊、晶片、晶圓、機櫃、箭頭、圖示…）畫出「這個產業怎麼運作」。
   每張圖是一份資料 fig = { w: 360, h: 230, items: [...] }，由 figSvg() 畫成 SVG（深色、淺色主題都看得清楚）。
   圖元（座標都在 0～w、0～h 之內，單位是 px）：
     box    { t:"box", x, y, w, h, label, sub, c, fill }          圓角方塊；fill:true 填滿淡色
     chip   { t:"chip", x, y, w, h, label, c }                     晶片（四邊有接腳）
     wafer  { t:"wafer", x, y, r, label, c }                       晶圓（圓形＋格線），x,y 是圓心
     cyl    { t:"cyl", x, y, w, h, label, c }                      圓柱（槽、電池、儲存）
     stack  { t:"stack", x, y, w, h, n, label, c }                 疊層（HBM、PCB、電池芯）
     rack   { t:"rack", x, y, w, h, n, label, c }                  機櫃（n 格）
     arrow  { t:"arrow", pts: [[x,y],...], c, dash, label, lx, ly } 折線箭頭；label 放在 (lx,ly)
     line   { t:"line", pts: [[x,y],...], c, dash, w }              折線（不帶箭頭）
     text   { t:"text", x, y, s, c, a, b, label }                   文字；s 字級、a 對齊 start|middle|end、b 粗體
     icon   { t:"icon", x, y, s, k, c, label }                      圖示（k 見 FIG_ICONS），x,y 是左上角、s 邊長
     group  { t:"group", x, y, w, h, label, c }                     虛線框住一區，左上角標題
     legend { t:"legend", x, y, items: [[c, "說明", dash?], ...] }  圖例（橫排）
   細節圖元：
     badge  { t:"badge", x, y, n, c }                              編號圓點（對應價值鏈的第 n 段），x,y 是圓心
     path   { t:"path", d, c, fill, w, dash }                       任意 SVG 路徑；fill 是填色透明度 0～1
     rect   { t:"rect", x, y, w, h, c, fill, r, dash, stroke }      無文字的方塊（零件細節、線路、銅條）
     circle { t:"circle", x, y, r, c, fill, label }                 圓
     coil   { t:"coil", x, y, w, h, n, c, label }                   線圈（電感、變壓器）
     wave   { t:"wave", x, y, w, n, a, c }                          交流電波形
     fan    { t:"fan", x, y, r, c, label }                          風扇
     pcb    { t:"pcb", x, y, w, h, label }                          綠色電路板（含走線）
   c 是顏色名稱：blue cyan green orange red purple yellow pink gray。
   圖的大小可以自訂（建議 { w: 400, h: 280 }）。 */
const FIG_C = { blue: "#4f8cff", cyan: "#22b8cf", green: "#2bb673", orange: "#f08c2e", red: "#ef4d5a", purple: "#8b6cf6", yellow: "#e6b729", pink: "#e2589b", gray: "#8a94a3" };
const FIG_ICONS = {
  car: "M3 15h18l-1.5-5-3-3h-7l-3 3zM7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  phone: "M8 2h8v20H8zM11 19h2", laptop: "M5 5h14v10H5zM3 18h18", cloud: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4 4 0 1 1 17 18z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z", fan: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c0-4 4-6 6-4M14 12c4 0 6 4 4 6M12 14c0 4-4 6-6 4M10 12c-4 0-6-4-4-6",
  plane: "M2 13l20-7-6 14-3-6zM13 14l3-3", ship: "M3 15h18l-3 5H6zM6 15V9h12v6M12 9V4", factory: "M3 21V10l6 4V10l6 4V6l6 4v11z", house: "M3 11l9-7 9 7v9H3z",
  person: "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M5 21c0-5 3-8 7-8s7 3 7 8", shield: "M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z", bank: "M3 9l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18", robot: "M7 8h10v9H7zM12 4v4M10 12h.01M14 12h.01M4 12h3M17 12h3M9 17v4M15 17v4",
  sat: "M9 11l4-4 4 4-4 4zM4 20l4-4M13 7l3-3M17 11l3 3M6 14a4 4 0 0 0 4 4", wind: "M12 21V9M12 9l-6-4M12 9l7-1M12 9l-1 7", sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  battery: "M3 7h16v10H3zM19 10h2v4h-2M6 10v4M10 10v4", gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  db: "M5 6c0-1.7 3-3 7-3s7 1.3 7 3-3 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3 3 7 3s7-1.3 7-3", chart: "M3 20h18M5 16l4-5 4 3 6-8",
  tower: "M12 2L6 22M12 2l6 20M8 14h8M9 9h6M4 22h16", water: "M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z", fire: "M12 22c-4 0-7-3-7-7 0-4 4-6 4-11 3 2 5 5 5 8 1-1 2-2 2-4 2 2 3 5 3 7 0 4-3 7-7 7z",
  pill: "M5 13l6-6a4 4 0 0 1 6 6l-6 6a4 4 0 0 1-6-6zM8 10l6 6", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  truck: "M2 7h12v9H2zM14 10h4l3 3v3h-7M6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3", coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9h4a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9M11 7v2M11 17v2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4", wifi: "M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01", flask: "M9 3h6M10 3v6L4 20h16L14 9V3",
  hospital: "M4 21V5h16v16M10 9h4M12 7v4M9 21v-5h6v5", camera: "M3 8h4l2-3h6l2 3h4v12H3zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6", oil: "M12 2L6 22M12 2l6 20M7 18h10M9 12h6M18 6l3-2",
};
function figSvg(fig, { id = "f" + Math.random().toString(36).slice(2, 7), mini = false } = {}) {
  if (!fig?.items) return "";
  const W = fig.w || 360, H = fig.h || 230, C = k => FIG_C[k] || FIG_C.gray, e = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const T = (x, y, s, label, { c = "var(--ink)", a = "middle", b = false, o = 1 } = {}) => (label == null || label === "" ? "" : `<text x="${x}" y="${y}" font-size="${s}" fill="${c}" text-anchor="${a}" ${b ? 'font-weight="700"' : ""} opacity="${o}">${e(label)}</text>`);
  const lab = (it, x, y) => T(x, y, it.ls || 8.5, it.label, { c: "var(--muted)" }); // 圖元下方的說明字（ls 可指定字級；不要用 s，icon 的 s 是圖示大小）
  const P = pts => pts.map(p => p.join(",")).join(" ");
  let defs = "", body = "";
  const mk = c => { const k = `${id}-a-${c}`; if (!defs.includes(k)) defs += `<marker id="${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="${C(c)}"/></marker>`; return k; };
  for (const it of fig.items) {
    const c = C(it.c), fillA = it.fill ? 0.22 : 0.08;
    if (it.t === "box") body += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.r ?? 6}" fill="${c}" fill-opacity="${fillA}" stroke="${c}" stroke-width="1.4"/>${T(it.x + it.w / 2, it.y + it.h / 2 + (it.sub ? -1 : 3.5), it.s || 10, it.label, { b: true })}${T(it.x + it.w / 2, it.y + it.h / 2 + 11, 8, it.sub, { c: "var(--muted)" })}`;
    else if (it.t === "chip") { let pins = ""; const n = Math.max(3, Math.round(it.w / 9)); for (let k = 1; k < n; k++) { const px = it.x + (it.w * k) / n, py = it.y + (it.h * k) / n; pins += `M${px} ${it.y - 4}V${it.y}M${px} ${it.y + it.h}V${it.y + it.h + 4}M${it.x - 4} ${py}H${it.x}M${it.x + it.w} ${py}H${it.x + it.w + 4}`; }
      body += `<path d="${pins}" stroke="${c}" stroke-width="1.2"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="3" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.4"/>${T(it.x + it.w / 2, it.y + it.h / 2 + 3.5, it.s || 9, it.label, { b: true })}`; }
    else if (it.t === "wafer") { let g = ""; for (let k = -2; k <= 2; k++) { const d = (it.r * k) / 3, hw = Math.sqrt(Math.max(0, it.r * it.r - d * d)) * 0.92; g += `M${it.x - hw} ${it.y + d}H${it.x + hw}M${it.x + d} ${it.y - hw}V${it.y + hw}`; }
      body += `<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.4"/><path d="${g}" stroke="${c}" stroke-opacity=".55" stroke-width=".8"/>${lab(it, it.x, it.y + it.r + 11)}`; }
    else if (it.t === "cyl") { const ry = Math.min(6, it.h / 5); body += `<path d="M${it.x} ${it.y + ry}V${it.y + it.h - ry}A${it.w / 2} ${ry} 0 0 0 ${it.x + it.w} ${it.y + it.h - ry}V${it.y + ry}" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.4"/><ellipse cx="${it.x + it.w / 2}" cy="${it.y + ry}" rx="${it.w / 2}" ry="${ry}" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.4"/>${lab(it, it.x + it.w / 2, it.y + it.h + 11)}`; }
    else if (it.t === "stack") { const n = it.n || 4, lh = it.h / n; for (let k = 0; k < n; k++) body += `<rect x="${it.x + k * 1.5}" y="${it.y + k * lh}" width="${it.w - k * 3}" height="${lh - 1.5}" rx="1.5" fill="${c}" fill-opacity="${0.15 + (k % 2) * 0.2}" stroke="${c}" stroke-width="1"/>`; body += lab(it, it.x + it.w / 2, it.y + it.h + 11); }
    else if (it.t === "rack") { const n = it.n || 6, sh = (it.h - 8) / n; body += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="3" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="1.4"/>`; for (let k = 0; k < n; k++) body += `<rect x="${it.x + 4}" y="${it.y + 4 + k * sh}" width="${it.w - 8}" height="${sh - 2}" rx="1" fill="${c}" fill-opacity=".35"/><circle cx="${it.x + it.w - 8}" cy="${it.y + 4 + k * sh + sh / 2 - 1}" r="1.2" fill="var(--ink)"/>`; body += lab(it, it.x + it.w / 2, it.y + it.h + 11); }
    else if (it.t === "arrow" || it.t === "line") body += `<polyline points="${P(it.pts)}" fill="none" stroke="${c}" stroke-width="${it.w || 1.6}" ${it.dash ? 'stroke-dasharray="4 3"' : ""} ${it.t === "arrow" ? `marker-end="url(#${mk(it.c || "gray")})"` : ""} stroke-linejoin="round"/>${it.label ? T(it.lx ?? it.pts[0][0], it.ly ?? it.pts[0][1] - 4, 8, it.label, { c: "var(--muted)", a: it.la || "middle" }) : ""}`;
    else if (it.t === "text") body += T(it.x, it.y, it.s || 9, it.label, { c: it.c ? c : it.muted ? "var(--muted)" : "var(--ink)", a: it.a || "middle", b: it.b });
    else if (it.t === "icon") { const s = it.s || 24; body += `<g transform="translate(${it.x} ${it.y}) scale(${s / 24})"><path d="${FIG_ICONS[it.k] || FIG_ICONS.gear}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="${1.6 * 24 / s > 2.4 ? 2.4 : 1.6 * 24 / s}" stroke-linejoin="round" stroke-linecap="round"/></g>${lab(it, it.x + s / 2, it.y + s + 10)}`; }
    else if (it.t === "group") body += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="8" fill="none" stroke="${c}" stroke-opacity=".7" stroke-dasharray="4 3"/>${T(it.x + 6, it.y + 11, 8.5, it.label, { c: "var(--muted)", a: "start", b: true })}`;
    // ---- 細節圖元 ----
    else if (it.t === "badge") body += `<circle cx="${it.x}" cy="${it.y}" r="${it.r || 7}" fill="${c}"/><text x="${it.x}" y="${it.y + 3.2}" font-size="${it.s || 8.5}" font-weight="700" fill="#fff" text-anchor="middle">${e(it.n)}</text>`;
    else if (it.t === "path") body += `<path d="${it.d}" fill="${it.fill ? c : "none"}" fill-opacity="${it.fill || 0}" stroke="${it.stroke === false ? "none" : c}" stroke-width="${it.w || 1.4}" ${it.dash ? 'stroke-dasharray="4 3"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    else if (it.t === "rect") body += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.r ?? 2}" fill="${c}" fill-opacity="${it.fill ?? 0.3}" stroke="${it.stroke === false ? "none" : c}" stroke-width="${it.sw || 1}" ${it.dash ? 'stroke-dasharray="3 2"' : ""}/>`;
    else if (it.t === "circle") body += `<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="${c}" fill-opacity="${it.fill ?? 0.25}" stroke="${it.stroke === false ? "none" : c}" stroke-width="${it.sw || 1.2}"/>${lab(it, it.x, it.y + it.r + 10)}`;
    else if (it.t === "coil") { const n = it.n || 5, dx = it.w / n; let d = `M${it.x} ${it.y + it.h / 2}`; for (let k = 0; k < n; k++) d += ` a${dx / 2} ${it.h / 2} 0 1 1 ${dx} 0`; body += `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6"/>${lab(it, it.x + it.w / 2, it.y + it.h + 10)}`; }
    else if (it.t === "wave") { const n = it.n || 2, dx = it.w / n, a = it.a || 4; let d = `M${it.x} ${it.y}`; for (let k = 0; k < n; k++) d += ` q${dx / 4} ${-a * 2} ${dx / 2} 0 t${dx / 2} 0`; body += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${it.sw || 1.8}" stroke-linecap="round"/>`; }
    else if (it.t === "fan") { const r = it.r || 10; let d = ""; for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2, x1 = it.x + Math.cos(a) * r * 0.85, y1 = it.y + Math.sin(a) * r * 0.85, x2 = it.x + Math.cos(a + 0.9) * r * 0.5, y2 = it.y + Math.sin(a + 0.9) * r * 0.5; d += `M${it.x} ${it.y}Q${x2} ${y2} ${x1} ${y1}`; }
      body += `<circle cx="${it.x}" cy="${it.y}" r="${r}" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="1.2"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="${it.x}" cy="${it.y}" r="${r * 0.18}" fill="${c}"/>${lab(it, it.x, it.y + r + 10)}`; }
    else if (it.t === "pcb") { let tr = ""; const n = Math.max(2, Math.round(it.h / 10)); for (let k = 1; k < n; k++) { const y = it.y + (it.h * k) / n; tr += `M${it.x + 6} ${y}h${it.w * 0.3}l6 -4h${it.w * 0.25}`; }
      body += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="3" fill="${FIG_C.green}" fill-opacity=".22" stroke="${FIG_C.green}" stroke-width="1.3"/><path d="${tr}" fill="none" stroke="${FIG_C.yellow}" stroke-opacity=".7" stroke-width=".9"/>${it.label ? T(it.x + it.w / 2, it.y + it.h - 5, 8, it.label, { c: "var(--muted)" }) : ""}`; }
    else if (it.t === "legend") { let x = it.x; for (const [k, t, d] of it.items) { body += `<line x1="${x}" y1="${it.y - 3}" x2="${x + 14}" y2="${it.y - 3}" stroke="${C(k)}" stroke-width="2" ${d ? 'stroke-dasharray="3 2"' : ""}/>${T(x + 18, it.y, 8, t, { c: "var(--muted)", a: "start" })}`; x += 26 + String(t).length * 8; } }
  }
  return `<svg class="figsvg${mini ? " mini" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(fig.alt || "產業原理圖")}"><defs>${defs}</defs>${body}</svg>`;
}
// 每個題材的圖解與說明：INDUSTRY_FIGS[題材 id] = { fig, how: [[小標, 內文], ...], trends: [...], chain: [...] }；
// 新題材放在 INDUSTRY_PACK（格式同 INDUSTRY_MAP.themes，另外帶 fig、how、trends、chain）。
// chain：產業價值鏈 [{ tier: "上游"|"中游"|"下游", title, items: [{ name, desc, c: [[代號, 公司, 角色], ...] }] }]，
//   items 依序編號 1、2、3…（跨 tier 連續），圖上的 badge n 對應這個編號。
const INDUSTRY_FIGS = {};
const INDUSTRY_PACK = [];
