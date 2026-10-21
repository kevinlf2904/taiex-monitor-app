/* ================= 時間序列圖（融資融券、外資持股…）：一張圖分幾層，每層左右兩個軸，手指或滑鼠移上去看那天的數字 =================
   tsChart({ dates, panels: [{ h, series: [{ name, vals, color, type: "line"|"bar", axis: "l"|"r", fmt }] }] }) → HTML 字串。
   數值可以是 null（那天沒資料，線會斷開）。互動由檔案最下面的 pointer 事件處理，資料放在 TS_DATA，用 data-ts 對應。
   其他圖表用 xhWrap(svg, 各點 x 座標, i => 說明 HTML) 加上同樣的查價線。用到 watch.html 的 esc。 */
const TS_DATA = new Map(); let tsSeq = 0;
const tsFmt = v => (v == null ? "—" : Math.abs(v) >= 1e3 ? Math.round(v).toLocaleString() : (+v.toFixed(2)).toLocaleString());
function tsChart({ dates, panels, w = 600 }) {
  const n = dates.length; if (n < 2) return `<p class="note">資料不足，還畫不出走勢。</p>`;
  const L = 48, R = 48, gap = 16, X = i => L + (i / (n - 1)) * (w - L - R), H = panels.reduce((s, p) => s + p.h + gap, 0) + 14, id = "ts" + ++tsSeq;
  let y0 = 6, svg = "";
  for (const P of panels) {
    const top = y0 + 4, bot = y0 + P.h, rng = ax => { const vs = P.series.filter(s => (s.axis || "l") === ax).flatMap(s => s.vals).filter(v => v != null && Number.isFinite(v)); if (!vs.length) return null;
      let lo = Math.min(...vs), hi = Math.max(...vs); if (P.series.some(s => (s.axis || "l") === ax && s.type === "bar")) lo = Math.min(0, lo); if (hi === lo) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1; } const pad = (hi - lo) * 0.06; return [lo - (lo === 0 ? 0 : pad), hi + pad]; };
    const ax = { l: rng("l"), r: rng("r") }, Y = (a, v) => bot - (v - ax[a][0]) / (ax[a][1] - ax[a][0]) * (bot - top);
    svg += `<line x1="${L}" x2="${w - R}" y1="${bot}" y2="${bot}" class="tsax"/>`;
    for (const a of ["l", "r"]) if (ax[a]) { const s = P.series.find(s => (s.axis || "l") === a), f = s.fmt || tsFmt, x = a === "l" ? L - 4 : w - R + 4, anc = a === "l" ? "end" : "start";
      svg += `<text x="${x}" y="${top + 8}" text-anchor="${anc}" class="tsyl" fill="${s.color}">${esc(f(ax[a][1]))}</text><text x="${x}" y="${bot}" text-anchor="${anc}" class="tsyl" fill="${s.color}">${esc(f(ax[a][0]))}</text>`; }
    for (const s of P.series) { const a = s.axis || "l"; if (!ax[a]) continue;
      if (s.type === "bar") { const bw = Math.max(1, (w - L - R) / n * 0.7), z = Y(a, Math.max(0, ax[a][0]));
        svg += s.vals.map((v, i) => (v == null ? "" : `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(Y(a, v), z).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(z - Y(a, v))).toFixed(1)}" fill="${s.neg && v < 0 ? s.neg : s.color}" opacity=".75"/>`)).join(""); }
      else { let d = "", pen = false; s.vals.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(a, v).toFixed(1)}`; pen = true; });
        svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.wide ? 1.8 : 1.3}"${s.dash ? ' stroke-dasharray="3 3"' : ""}/>`; } }
    svg += `<text x="${L + 4}" y="${top + 9}" class="tslg">${P.series.map(s => `<tspan fill="${s.color}">● </tspan><tspan>${esc(s.name)}　</tspan>`).join("")}</text>`;
    y0 = bot + gap;
  }
  const ticks = [0, Math.round((n - 1) / 2), n - 1].map(i => `<text x="${X(i)}" y="${H - 2}" text-anchor="${i ? (i === n - 1 ? "end" : "middle") : "start"}" class="tsyl">${esc(String(dates[i]).slice(5).replace("-", "/"))}</text>`).join("");
  const all = panels.flatMap(p => p.series).filter((s, i, A) => A.findIndex(x => x.name === s.name) === i); // 同一條（例如股價）出現在兩層只列一次
  tsReg(id, dates.map((d, i) => X(i)), i => `<b>${esc(dates[i])}</b>${all.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)} ${esc((s.fmt || tsFmt)(s.vals[i]))}</span>`).join("")}`);
  return `<div class="tsbox" data-ts="${id}"><svg class="tschart" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(panels.flatMap(p => p.series.map(s => s.name)).join("、"))}走勢">${svg}${ticks}<line class="tscur" x1="0" x2="0" y1="6" y2="${H - 14}" visibility="hidden"/></svg><div class="tstip" hidden></div></div>`;
}
// 查價線資料：每個點在 SVG 裡的 x 座標、第 i 點要顯示的文字（HTML）
function tsReg(id, xs, tip) { TS_DATA.set(id, { xs, tip }); if (TS_DATA.size > 60) TS_DATA.delete(TS_DATA.keys().next().value); }
// 其他圖表（長條、營收、本益比、資產曲線…）共用查價線：把畫好的 <svg> 包起來，加一條游標線和數字框
function xhWrap(svg, xs, tip) {
  if (!svg || !xs?.length) return svg || ""; const id = "ts" + ++tsSeq, vb = (svg.match(/viewBox="([^"]+)"/) || [])[1]?.split(/[\s,]+/).map(Number) || [0, 0, 600, 200];
  tsReg(id, xs, tip); const i = svg.lastIndexOf("</svg>");
  return `<div class="tsbox xh" data-ts="${id}">${svg.slice(0, i)}<line class="tscur" x1="0" x2="0" y1="${vb[1]}" y2="${vb[1] + vb[3]}" visibility="hidden" vector-effect="non-scaling-stroke"/>${svg.slice(i)}<div class="tstip" hidden></div></div>`;
}
// 移上去（或手指按著滑）看那一點的數字
function tsHover(e) {
  const box = e.target.closest?.(".tsbox"); if (!box) return; const S = TS_DATA.get(box.dataset.ts), svg = box.querySelector("svg"), tip = box.querySelector(".tstip"); if (!S || !svg) return;
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, vx = vb.x + (e.clientX - r.left) / r.width * vb.width;
  let i = 0; S.xs.forEach((x, k) => { if (Math.abs(x - vx) < Math.abs(S.xs[i] - vx)) i = k; }); const x = S.xs[i];
  const cur = svg.querySelector(".tscur"); cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.setAttribute("visibility", "visible");
  tip.innerHTML = S.tip(i); tip.hidden = false; const px = (x - vb.x) / vb.width * r.width;
  tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, px + (px > r.width / 2 ? -tip.offsetWidth - 10 : 10))) + "px";
}
const tsHide = box => { box.querySelector(".tstip").hidden = true; box.querySelector(".tscur")?.setAttribute("visibility", "hidden"); };
// 滑鼠移出就收起；手指放開時也會觸發 pointerout，所以觸控要等點到圖以外的地方才收
function tsLeave(e) { const box = e.target.closest?.(".tsbox"); if (!box || e.pointerType === "touch" || box.contains(e.relatedTarget)) return; tsHide(box); }
document.addEventListener("pointermove", tsHover); document.addEventListener("pointerout", tsLeave);
document.addEventListener("pointerdown", e => { const box = e.target.closest?.(".tsbox"); document.querySelectorAll(".tsbox").forEach(b => b !== box && tsHide(b)); if (box) tsHover(e); });
