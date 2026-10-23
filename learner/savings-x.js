/* 存股的延伸功能（learner/savings.html）：
   ・我的庫存股息：讀看盤「庫存」（同一個網站的 localStorage），算每年、每月領多少、距離目標還差多少
   ・實拿股息試算：二代健保、股利所得稅（合併計稅抵減 8.5% 或分開計稅 28%，自動選划算的）、美股預扣 30%、手續費
   ・真實歷史回測：用真實月線（含息還原與不含息）從某年某月開始定期定額，算到今天
   ・退休提領試算：4% 法則、蒙地卡羅成功率、剛退休就遇到股災的情境
   ・月月配組合：幾檔 ETF 各在哪幾個月配息、每月現金流，空著的月份推薦補哪幾檔
   ・通膨換算：上面的期末金額換算成今天的購買力
   用到 savings.html 的 wan、esc、irrCf、SAV_LAST。資料：/api/yield（配息紀錄）、/api/annual?rows=1（月線）、data/etf-yield.json。 */
(() => {
  const $ = id => document.getElementById(id), KEY = "kline:savx", online = /^https?:$/.test(location.protocol);
  const S = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  const num = (id, d = 0) => { const v = +$(id)?.value; return Number.isFinite(v) ? v : d; };
  const fmt = v => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString());
  const pc = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
  const kpi = (nm, big, sub = "") => `<div class="kpi"><div class="nm">${nm}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;
  const field = (id, label, val, attrs = "") => `<div class="dc-f"><label for="${id}">${label}</label><input id="${id}" value="${esc(S[id] ?? val)}" ${attrs}></div>`;
  const getJ = async url => { if (!online) throw new Error("部署到網站後才能抓資料"); const r = await fetch(url); const j = await r.json().catch(() => null); if (!j) throw new Error(`資料服務回應 ${r.status}`); if (j.ok === false) throw new Error(j.error || "抓取失敗"); return j; };
  const MON = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
  const yieldOf = async codes => (await getJ(`/api/yield?codes=${codes.join(",")}&hist=1`)).rows || [];
  // 近 12 個月每個月每股配多少：{ 1: 0.5, 4: 0.5 … }
  const monthCash = r => { const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), m = {}; for (const [d, c] of r.divs || []) if (d > from) m[+d.slice(5, 7)] = (m[+d.slice(5, 7)] || 0) + c; return m; };
  // 簡單折線圖：series = [{ name, color, pts: [[x, y]] }]
  function lineSvg(series, { w = innerWidth < 600 ? 380 : 760, h = innerWidth < 600 ? 230 : 240, fx = x => x, fy = y => y } = {}) { // 手機用窄的畫布，刻度字才不會縮到看不見
    const P = series.flatMap(s => s.pts); if (!P.length) return "";
    const x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), y0 = Math.min(0, ...P.map(p => p[1])), y1 = Math.max(...P.map(p => p[1])) || 1, L = 58, R = 10, T = 10, B = 26;
    const X = x => L + ((x - x0) / (x1 - x0 || 1)) * (w - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (h - T - B);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => y0 + (y1 - y0) * f), xt = [0, 0.5, 1].map(f => x0 + (x1 - x0) * f);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" style="width:100%;height:auto">${ticks.map(t => `<line x1="${L}" x2="${w - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fy(t)}</text>`).join("")}
      ${xt.map(t => `<text x="${X(t)}" y="${h - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${fx(t)}</text>`).join("")}
      ${series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.w || 1.8}" ${s.dash ? 'stroke-dasharray="4 3"' : ""} points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}</svg>
      <div class="legend">${series.map(s => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join("")}</div>`;
  }
  const tick = t => (Math.abs(t) >= 1e8 ? (t / 1e8).toFixed(1) + "億" : Math.round(t / 1e4).toLocaleString() + "萬");

  /* ---------- 版面：插在「說明與假設」前面 ---------- */
  const notes = document.querySelector("details.notes-d"); if (!notes) return;
  const sec = (id, title, lead, body) => `<section class="sec" id="${id}"><div class="sec-h"><h2 class="h2">${title}</h2><p class="lead">${lead}</p></div><div class="panel dc">${body}</div></section>`;
  notes.insertAdjacentHTML("beforebegin",
    sec("sec-hold", "我的庫存股息", "讀「看盤 → 庫存」裡的台股，用近 12 個月的配息算每年、每月大概領多少，以及距離你的目標還差多少。", `<div class="dc-in">${field("hx-goal", "目標：每月股息（元）", 30000, 'type="number" min="0" step="1000" inputmode="numeric"')}<div class="dc-f"><span class="lbl">&nbsp;</span><button type="button" class="btn" id="hx-go">抓庫存配息</button></div></div><div id="hx-out"><p class="hint">按「抓庫存配息」開始。</p></div>`)
    + sec("sec-tax", "實拿股息試算", "股息要扣二代健保、併入所得稅，美股還有預扣稅。填你的狀況，看實際拿到多少、合併還是分開計稅比較划算。", `<div class="dc-in">
      ${field("tx-div", "台股年股息（元）", 300000, 'type="number" min="0" step="1000" inputmode="numeric"')}
      <div class="dc-f"><label for="tx-n">每年配息次數</label><select id="tx-n">${[1, 2, 4, 12].map(n => `<option value="${n}" ${+(S["tx-n"] || 4) === n ? "selected" : ""}>${n} 次</option>`).join("")}</select></div>
      ${field("tx-inc", "其他所得淨額（扣完免稅額、扣除額）", 800000, 'type="number" min="0" step="10000" inputmode="numeric"')}
      ${field("tx-us", "美股年股息（換成台幣）", 0, 'type="number" min="0" step="1000" inputmode="numeric"')}
      ${field("tx-buy", "每月買進金額（算手續費）", 10000, 'type="number" min="0" step="1000" inputmode="numeric"')}
      ${field("tx-disc", "手續費折扣（2.8 折填 2.8）", 2.8, 'type="number" min="0.1" max="10" step="0.1" inputmode="decimal"')}</div><div class="kpis" id="tx-kpis"></div><p class="hint" id="tx-note"></p>`)
    + sec("sec-hist", "真實歷史回測", "用真實的月線，從你選的年月開始每月定期定額買到今天：「含息」是股息全部再投入（還原股價），「不含息」只看股價。", `<div class="dc-in">
      ${field("hs-code", "代號", "0050", 'autocomplete="off"')}${field("hs-from", "開始年月", `${new Date().getFullYear() - 10}-01`, 'type="month"')}
      ${field("hs-init", "起始本金", 0, 'type="number" min="0" step="10000" inputmode="numeric"')}${field("hs-mon", "每月投入", 10000, 'type="number" min="0" step="1000" inputmode="numeric"')}
      <div class="dc-f"><span class="lbl">&nbsp;</span><button type="button" class="btn" id="hs-go">開始回測</button></div></div><div id="hs-out"><p class="hint">填代號後按「開始回測」（台股、美股、ETF 都可以）。</p></div>`)
    + sec("sec-ret", "退休提領試算", "存到一筆錢之後每年領生活費，能撐多久？用隨機報酬跑 2,000 次（蒙地卡羅），也看「剛退休就遇到股災」的最壞情況。", `<div class="dc-in">
      ${field("rt-asset", "退休時資產", 20000000, 'type="number" min="0" step="100000" inputmode="numeric"')}${field("rt-draw", "每年提領（第一年）", 800000, 'type="number" min="0" step="10000" inputmode="numeric"')}
      ${field("rt-r", "年化報酬 %", 6, 'type="number" step="0.1" inputmode="decimal"')}${field("rt-sd", "每年波動 %", 15, 'type="number" min="0" step="0.5" inputmode="decimal"')}
      ${field("rt-inf", "通膨 %（提領每年跟著調高）", 2, 'type="number" step="0.1" inputmode="decimal"')}${field("rt-yrs", "要撐幾年", 30, 'type="number" min="5" max="60" step="1" inputmode="numeric"')}</div>
      <div class="kpis" id="rt-kpis"></div><div class="chart" id="rt-chart"></div>`)
    + sec("sec-mon", "月月配組合", "幾檔配息月份不同的 ETF 組在一起，每個月都有股息。填代號和每檔金額，看 12 個月的現金流；空著的月份會推薦可以補的 ETF。", `<div class="dc-in">
      <div class="dc-f dc-wide"><label for="mm-codes">代號（空白或逗號分開）</label><input id="mm-codes" value="${esc(S["mm-codes"] ?? "0056 00878 00919")}" autocomplete="off"></div>
      ${field("mm-amt", "每檔投入金額", 1000000, 'type="number" min="0" step="10000" inputmode="numeric"')}<div class="dc-f"><span class="lbl">&nbsp;</span><button type="button" class="btn" id="mm-go">算每月股息</button></div></div><div id="mm-out"><p class="hint">按「算每月股息」。</p></div>`)
    + sec("sec-dca", "定期定額熱門", "證交所每月公布：在券商設定定期定額的帳戶最多的股票與 ETF。看存股族最常買什麼，點「回測」直接用真實股價試算。", `<div id="dca-out"><p class="hint">載入中…</p></div>`));
  document.querySelector("nav.jump")?.insertAdjacentHTML("beforeend", `<a href="#sec-hold">我的庫存</a><a href="#sec-tax">實拿試算</a><a href="#sec-hist">歷史回測</a><a href="#sec-ret">退休提領</a><a href="#sec-mon">月月配</a>`);
  document.querySelectorAll("#sec-hold input,#sec-tax input,#sec-tax select,#sec-hist input,#sec-ret input,#sec-mon input").forEach(el => el.addEventListener("input", () => { S[el.id] = el.value; save(); }));

  /* ---------- 我的庫存股息 ---------- */
  const holdings = () => { try { const H = JSON.parse(localStorage.getItem("kline:watch:hold") || "{}") || {}; return Object.entries(H).filter(([c, h]) => /^\d{4,6}[A-Z]?$/.test(c) && h?.sh > 0).map(([c, h]) => ({ code: c, sh: +h.sh, cost: +h.cost || null })); } catch { return []; } };
  const names = () => { try { return JSON.parse(localStorage.getItem("kline:watch:names") || "{}") || {}; } catch { return {}; } };
  async function holdRun() {
    const H = holdings(), out = $("hx-out"); if (!H.length) { out.innerHTML = `<p class="hint">庫存裡還沒有台股。到「看盤 → 庫存」新增持股（或匯入範例庫存），再回來按一次。</p>`; return; }
    out.innerHTML = `<p class="hint">抓 ${H.length} 檔的配息紀錄…</p>`;
    let R; try { R = await yieldOf(H.map(h => h.code)); } catch (e) { out.innerHTML = `<p class="hint">⚠︎ ${esc(e.message)}</p>`; return; }
    const nm = names(), rows = H.map(h => { const r = R.find(x => x.code === h.code), m = r ? monthCash(r) : {}; return { ...h, r, m, year: r ? r.cash12 * h.sh : 0, mv: r?.price ? r.price * h.sh : null }; });
    const year = rows.reduce((a, x) => a + x.year, 0), mv = rows.reduce((a, x) => a + (x.mv || 0), 0), cost = rows.reduce((a, x) => a + (x.cost ? x.cost * x.sh : 0), 0), goal = num("hx-goal") * 12;
    const byM = MON.map((_, i) => rows.reduce((a, x) => a + (x.m[i + 1] || 0) * x.sh, 0)), mx = Math.max(1, ...byM), y = mv ? year / mv : null, gap = Math.max(0, goal - year);
    $("tx-div").dataset.hold = year; S.holdYear = year; save();
    out.innerHTML = `<div class="kpis">${kpi("一年大約領", fmt(year), `<span>每月平均</span><b>${fmt(year / 12)}</b><span>目前殖利率</span><b>${pc(y, 2)}</b><span>成本殖利率</span><b>${cost ? pc(year / cost, 2) : "—"}</b>`)}
      ${kpi("距離目標", gap ? fmt(gap / 12) + " /月" : "已達成", `<span>目標每年</span><b>${fmt(goal)}</b><span>還要再投入（照目前殖利率）</span><b>${gap && y ? fmt(gap / y) : "—"}</b>`)}
      ${kpi("持股市值", fmt(mv), `<span>${rows.length} 檔</span><b>${rows.filter(x => !x.r).length ? `${rows.filter(x => !x.r).length} 檔抓不到配息` : "都有資料"}</b>`)}</div>
      <div class="mm-bars">${byM.map((v, i) => `<div><i style="height:${Math.round((v / mx) * 100)}%" class="${v ? "" : "zero"}"></i><b>${v ? tick(v) : "—"}</b><small>${MON[i]}</small></div>`).join("")}</div>
      <div class="tablewrap"><table class="tbl dc-tbl"><thead><tr><th class="l">股票</th><th>股數</th><th>近 12 個月每股配息</th><th>殖利率</th><th>一年股息</th><th class="l">配息月份</th></tr></thead><tbody>
      ${rows.sort((a, b) => b.year - a.year).map(x => `<tr><td class="l">${esc(nm[x.code] || "")} ${x.code}</td><td>${fmt(x.sh)}</td><td>${x.r ? x.r.cash12 : "—"}</td><td>${x.r?.yield != null ? x.r.yield + "%" : "—"}</td><td>${fmt(x.year)}</td><td class="l">${Object.keys(x.m).map(m => m + "月").join("、") || "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">用近 12 個月的配息推估，未來配息可能變多或變少。<button type="button" class="sx-link" id="hx-tax">把 ${fmt(year)} 元帶到「實拿股息試算」 ›</button></p>`;
  }
  $("hx-go").addEventListener("click", holdRun);
  document.addEventListener("click", e => { if (e.target.id === "hx-tax") { $("tx-div").value = Math.round(S.holdYear || 0); S["tx-div"] = $("tx-div").value; save(); taxRun(); sxGo("tax", true); } });

  /* ---------- 實拿股息試算 ---------- */
  // 綜合所得稅級距（115 年申報、114 年度所得適用；國稅局每年依物價調整）
  const BR = [[610000, 0.05], [1380000, 0.12], [2770000, 0.2], [5190000, 0.3], [Infinity, 0.4]];
  const taxOf = x => { let t = 0, lo = 0; for (const [hi, r] of BR) { if (x > lo) t += (Math.min(x, hi) - lo) * r; lo = hi; } return t; };
  function taxRun() {
    const div = Math.max(0, num("tx-div")), n = Math.max(1, num("tx-n", 4)), inc = Math.max(0, num("tx-inc")), us = Math.max(0, num("tx-us")), buy = Math.max(0, num("tx-buy")), disc = Math.min(10, Math.max(0.1, num("tx-disc", 2.8)));
    const per = div / n, nhi = per >= 20000 ? per * 0.0211 * n : 0;
    const comb = taxOf(inc + div) - taxOf(inc) - Math.min(div * 0.085, 80000), sep = div * 0.28, best = comb <= sep ? "comb" : "sep", tax = Math.min(comb, sep);
    const usTax = us * 0.3, fee = buy > 0 ? Math.max(20, Math.round(buy * 0.001425 * disc / 10)) * 12 : 0, net = div - nhi - tax + us - usTax - fee;
    const rate = BR.find(([hi]) => inc + div <= hi)?.[1] || 0.4;
    $("tx-kpis").innerHTML = kpi("一年實拿", fmt(net), `<span>稅前股息</span><b>${fmt(div + us)}</b><span>被扣掉</span><b>${fmt(div + us - net)}（${pc(div + us ? 1 - net / (div + us) : 0)}）</b>`)
      + kpi(best === "comb" ? "合併計稅比較划算" : "分開計稅比較划算", fmt(tax), `<span>合併計稅（抵減 8.5%）</span><b>${comb < 0 ? `可退 ${fmt(-comb)}` : fmt(comb)}</b><span>分開計稅（28%）</span><b>${fmt(sep)}</b><span>你的邊際稅率</span><b>${Math.round(rate * 100)}%</b>`)
      + kpi("其他扣款", fmt(nhi + usTax + fee), `<span>二代健保 2.11%</span><b>${nhi ? fmt(nhi) : `每次 ${fmt(per)} 未達 2 萬，不扣`}</b><span>美股預扣 30%</span><b>${fmt(usTax)}</b><span>手續費（${disc} 折、每月 1 筆）</span><b>${fmt(fee)}</b>`);
    $("tx-note").innerHTML = `邊際稅率 20% 以下通常合併計稅較划算（8.5% 抵減還可能退稅），30% 以上選分開計稅。二代健保是單次股息 2 萬元以上才扣，所以月配、季配比較容易避開。美股股息屬海外所得，一年超過 100 萬元要併入最低稅負制計算（這裡沒算）。級距用 114 年度，實際以國稅局公告為準。`;
  }
  ["tx-div", "tx-n", "tx-inc", "tx-us", "tx-buy", "tx-disc"].forEach(id => $(id).addEventListener("input", taxRun)); taxRun();

  /* ---------- 真實歷史回測 ---------- */
  async function histRun() {
    const code = $("hs-code").value.trim().toUpperCase(), from = $("hs-from").value || "2015-01", init = Math.max(0, num("hs-init")), mon = Math.max(0, num("hs-mon")), out = $("hs-out");
    if (!code) return; out.innerHTML = `<p class="hint">抓 ${esc(code)} 的歷史月線…</p>`;
    let j; try { j = await getJ(`/api/annual?code=${encodeURIComponent(code)}&rows=1`); } catch (e) { out.innerHTML = `<p class="hint">⚠︎ ${esc(e.message)}</p>`; return; }
    const A = (j.rows || []).filter(r => r[0] >= from), Px = new Map(j.rowsPx || []); if (A.length < 3) { out.innerHTML = `<p class="hint">⚠︎ ${esc(code)} 在 ${from} 之後的資料太少（最早 ${esc(j.first || "—")}）。</p>`; return; }
    let sa = 0, sp = 0, inv = 0, peak = 0, mdd = 0; const cf = [], va = [], vp = [], vi = [], hasPx = A.every(r => Px.has(r[0]));
    A.forEach(([d, pa], i) => { const pp = Px.get(d), c = (i === 0 ? init : 0) + mon, last = i === A.length - 1;
      if (!last && c > 0) { sa += c / pa; if (pp) sp += c / pp; inv += c; cf.push(-c); } else cf.push(0);
      const v = sa * pa; peak = Math.max(peak, pa); mdd = Math.max(mdd, 1 - pa / peak); va.push([i / 12, v]); vi.push([i / 12, inv]); if (hasPx) vp.push([i / 12, sp * pp]); });
    const fa = sa * A.at(-1)[1], fp = hasPx ? sp * Px.get(A.at(-1)[0]) : null, cfa = [...cf]; cfa[cfa.length - 1] += fa; const irr = irrCf(cfa); let irrP = null; if (fp != null) { const c2 = [...cf]; c2[c2.length - 1] += fp; irrP = irrCf(c2); }
    const yrs = (A.length - 1) / 12;
    out.innerHTML = `<div class="kpis">${kpi(`今天的市值（含息再投入）`, fmt(fa), `<span>累積投入</span><b>${fmt(inv)}</b><span>獲利</span><b>${fmt(fa - inv)}（${pc(inv ? fa / inv - 1 : null)}）</b><span>年化（IRR）</span><b>${pc(irr, 2)}</b>`)}
      ${kpi("不含息（只看股價）", fp != null ? fmt(fp) : "—", fp != null ? `<span>年化（IRR）</span><b>${pc(irrP, 2)}</b><span>股息貢獻</span><b>${fmt(fa - fp)}</b>` : `<span>這檔沒有分開的不含息資料</span><b>—</b>`)}
      ${kpi("過程中最大跌幅", pc(-mdd), `<span>期間</span><b>${A[0][0]}～${A.at(-1)[0]}（${yrs.toFixed(1)} 年）</b><span>資料</span><b>${esc(j.source || "")}${j.adjusted ? "（還原股價）" : ""}</b>`)}</div>
      ${lineSvg([{ name: "市值（含息）", color: "var(--accent)", pts: va }, ...(vp.length ? [{ name: "市值（不含息）", color: "#8b8b8b", pts: vp }] : []), { name: "累積投入", color: "var(--muted)", pts: vi, dash: 1, w: 1.2 }], { fx: t => String(+A[0][0].slice(0, 4) + Math.round(t)), fy: tick })}
      <p class="hint">月底收盤價買進，不含手續費與稅。最大跌幅用月線計算，會比日線的跌幅小一些。過去的報酬不代表未來。</p>`;
  }
  $("hs-go").addEventListener("click", histRun); $("hs-code").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); histRun(); } });

  /* ---------- 退休提領試算 ---------- */
  function retRun() {
    const A0 = Math.max(0, num("rt-asset")), W0 = Math.max(0, num("rt-draw")), mu = num("rt-r", 6) / 100, sd = Math.max(0, num("rt-sd", 15)) / 100, inf = num("rt-inf", 2) / 100, N = Math.min(60, Math.max(5, Math.round(num("rt-yrs", 30))));
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const run = rets => { let a = A0, w = W0, last = N; const path = [a]; for (let y = 0; y < N; y++) { a -= w; if (a <= 0) { a = 0; if (last === N) last = y; } a *= 1 + rets(y); path.push(Math.max(0, a)); w *= 1 + inf; } return { path, last, end: a }; };
    const sims = Array.from({ length: 2000 }, () => run(() => Math.max(-0.9, mu + sd * gauss()))), ok = sims.filter(s => s.last === N).length / sims.length;
    const pct = (y, q) => { const v = sims.map(s => s.path[y]).sort((a, b) => a - b); return v[Math.floor(q * (v.length - 1))]; };
    const crash = run(y => (y === 0 ? -0.3 : y === 1 ? -0.15 : mu)), steady = run(() => mu), ends = sims.map(s => s.end).sort((a, b) => a - b);
    $("rt-kpis").innerHTML = kpi("撐過 " + N + " 年的機率", pc(ok, 0), `<span>提領率</span><b>${pc(A0 ? W0 / A0 : null)}</b><span>4% 法則每年可領</span><b>${fmt(A0 * 0.04)}</b>`)
      + kpi("剛退休就遇到股災", crash.last === N ? "撐得過" : `第 ${crash.last + 1} 年用完`, `<span>前兩年 −30%、−15%，之後照年化</span><b>${crash.last === N ? `期末還有 ${fmt(crash.end)}` : ""}</b><span>每年都照年化</span><b>${steady.last === N ? `期末 ${fmt(steady.end)}` : `第 ${steady.last + 1} 年用完`}</b>`)
      + kpi("期末資產（中位數）", fmt(ends[ends.length >> 1]), `<span>最差 10%</span><b>${fmt(ends[Math.floor(ends.length * 0.1)])}</b><span>最好 10%</span><b>${fmt(ends[Math.floor(ends.length * 0.9)])}</b>`);
    const ys = Array.from({ length: N + 1 }, (_, y) => y);
    $("rt-chart").innerHTML = lineSvg([{ name: "中位數", color: "var(--accent)", pts: ys.map(y => [y, pct(y, 0.5)]) }, { name: "最差 10%", color: "#c0503f", pts: ys.map(y => [y, pct(y, 0.1)]) }, { name: "最好 10%", color: "#3fa36b", pts: ys.map(y => [y, pct(y, 0.9)]) }, { name: "剛退休就股災", color: "var(--muted)", pts: crash.path.map((v, y) => [y, v]), dash: 1 }], { fx: t => `第 ${Math.round(t)} 年`, fy: tick })
      + `<p class="hint">每年年初提領、提領金額每年跟著通膨調高；報酬每年隨機（常態分布，跑 2,000 次）。股災發生在退休初期傷害最大（報酬順序風險），所以很多人會留 1～2 年生活費的現金。只是試算，不是理財建議。</p>`;
  }
  ["rt-asset", "rt-draw", "rt-r", "rt-sd", "rt-inf", "rt-yrs"].forEach(id => $(id).addEventListener("input", retRun)); retRun();

  /* ---------- 月月配組合 ---------- */
  // 排程的 ETF 殖利率表有 months（近 12 個月除息月份）；舊資料沒有時用最近一次除息月份和配息次數推算
  const monthsOf = r => (Array.isArray(r.months) && r.months.length ? r.months : r.last && r.n ? Array.from({ length: Math.min(12, r.n) }, (_, i) => ((+r.last.d.slice(5, 7) - 1 - i * Math.round(12 / r.n) + 120) % 12) + 1) : []);
  let ETFY = null; const etfY = async () => (ETFY ||= fetch("data/etf-yield.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : { rows: [] })).catch(() => ({ rows: [] })));
  async function monRun() {
    const codes = [...new Set($("mm-codes").value.toUpperCase().split(/[\s,，、]+/).filter(c => /^\d{4,6}[A-Z]?$/.test(c)))].slice(0, 12), amt = Math.max(0, num("mm-amt")), out = $("mm-out");
    if (!codes.length) { out.innerHTML = `<p class="hint">請填台股 ETF 代號，例如 0056 00878 00919。</p>`; return; }
    out.innerHTML = `<p class="hint">抓配息紀錄…</p>`;
    let R; try { R = await yieldOf(codes); } catch (e) { out.innerHTML = `<p class="hint">⚠︎ ${esc(e.message)}</p>`; return; }
    const rows = codes.map(c => { const r = R.find(x => x.code === c); if (!r?.price) return { c, r }; const sh = Math.floor(amt / r.price), m = monthCash(r); return { c, r, sh, m, cash: MON.map((_, i) => (m[i + 1] || 0) * sh) }; });
    const ok = rows.filter(x => x.cash), tot = MON.map((_, i) => ok.reduce((a, x) => a + x.cash[i], 0)), year = tot.reduce((a, b) => a + b, 0), empty = MON.map((_, i) => i + 1).filter(m => !tot[m - 1]), mx = Math.max(1, ...tot);
    const Y = await etfY(), nm = Object.fromEntries((Y.rows || []).map(r => [r.code, r.name])), sug = empty.map(m => [m, (Y.rows || []).filter(r => !codes.includes(r.code) && r.yield >= 3 && monthsOf(r).includes(m)).sort((a, b) => b.yield - a.yield).slice(0, 3)]);
    out.innerHTML = `<div class="kpis">${kpi("一年股息", fmt(year), `<span>每月平均</span><b>${fmt(year / 12)}</b><span>總投入</span><b>${fmt(amt * ok.length)}</b>`)}${kpi("有配息的月份", `${12 - empty.length} / 12`, empty.length ? `<span>空著</span><b>${empty.map(m => m + "月").join("、")}</b>` : `<span>每個月都有</span><b>✓</b>`)}${kpi("最少的月份", fmt(Math.min(...tot)), `<span>最多的月份</span><b>${fmt(mx)}</b>`)}</div>
      <div class="mm-bars">${tot.map((v, i) => `<div><i style="height:${Math.round((v / mx) * 100)}%" class="${v ? "" : "zero"}"></i><b>${v ? tick(v) : "—"}</b><small>${MON[i]}</small></div>`).join("")}</div>
      <div class="tablewrap"><table class="tbl mm-tbl"><thead><tr><th class="l">ETF</th><th>股數</th>${MON.map(m => `<th>${m}</th>`).join("")}</tr></thead><tbody>
      ${rows.map(x => `<tr><td class="l">${esc(nm[x.c] || "")} ${x.c}${x.r?.yield != null ? `<br><small class="hint">殖利率 ${x.r.yield}%</small>` : ""}</td><td>${x.cash ? fmt(x.sh) : "—"}</td>${x.cash ? x.cash.map(v => `<td>${v ? tick(v) : ""}</td>`).join("") : `<td colspan="12" class="l">抓不到配息資料</td>`}</tr>`).join("")}</tbody></table></div>
      ${sug.length ? `<h4 style="margin:10px 0 4px;font-size:14px">可以補空月份的 ETF（殖利率 3% 以上，依殖利率排序）</h4><ul class="mm-sug">${sug.map(([m, L]) => `<li><b>${m} 月</b>${L.length ? L.map(r => `<button type="button" class="chip" data-mmadd="${r.code}">${esc(r.name)} ${r.code}・${r.yield}%</button>`).join("") : '<span class="hint">找不到</span>'}</li>`).join("")}</ul>` : ""}
      <p class="hint">用近 12 個月的除息月份與金額推估，以目前股價換算股數（整股）。實際配息金額每次都會變動。</p>`;
  }
  $("mm-go").addEventListener("click", monRun);
  document.addEventListener("click", e => { const b = e.target.closest("[data-mmadd]"); if (b) { $("mm-codes").value = `${$("mm-codes").value.trim()} ${b.dataset.mmadd}`; S["mm-codes"] = $("mm-codes").value; save(); monRun(); } });

  /* ---------- 通膨換算（總覽與股息計算機的期末金額） ---------- */
  const sum = $("sec-sum"); sum?.insertAdjacentHTML("beforeend", `<label class="toggle" style="margin-top:10px"><input type="checkbox" id="if-on" ${S.ifOn ? "checked" : ""}> 換算成今天的購買力，每年通膨 <input type="number" id="if-r" aria-label="每年通膨率（%）" value="${esc(S.ifR ?? 2)}" min="0" max="15" step="0.1" style="width:64px" inputmode="decimal"> %</label>`);
  const today = (v, yrs) => v / Math.pow(1 + (+$("if-r").value || 0) / 100, yrs);
  function inflate() {
    document.querySelectorAll(".if-note").forEach(x => x.remove()); if (!$("if-on")?.checked) return;
    const L = typeof SAV_LAST !== "undefined" && SAV_LAST; if (L) document.querySelectorAll("#kpis .kpi").forEach((k, i) => { const r = L.mains[i]?.res; if (r) k.insertAdjacentHTML("beforeend", `<div class="if-note hint">約等於今天的 ${wan(today(r.v, L.p.yrs))}</div>`); });
    const dk = document.querySelector("#dc-kpis .kpi .big"), yrs = +$("dc-yrs")?.value || 0; if (dk && yrs) { const v = +dk.textContent.replace(/[^\d.-]/g, ""); if (v) dk.parentElement.insertAdjacentHTML("beforeend", `<div class="if-note hint">約等於今天的 ${fmt(today(v, yrs))}</div>`); }
  }
  ["kpis", "dc-kpis"].forEach(id => { const el = $(id); if (el) new MutationObserver(inflate).observe(el, { childList: true }); });
  ["if-on", "if-r"].forEach(id => $(id).addEventListener("input", () => { S.ifOn = $("if-on").checked; S.ifR = $("if-r").value; save(); inflate(); })); inflate();

  /* ---------- 選單：一次只看一個功能（模擬三種做法時才顯示左邊的控制台） ---------- */
  const led = document.getElementById("ledger")?.closest("section"); if (led && !led.id) led.id = "sec-ledger";
  const GROUPS = [["模擬三種做法", [["sim", "總覽與走勢", "三種做法的期末淨值、年化、部位", ["sec-sum", "sec-pos", "sec-ledger", "sec-chart"]], ["ms", "存錢里程碑", "第幾年存到 100 萬、500 萬…", ["sec-ms"]], ["risk", "壓力測試與配置", "崩盤時會不會被追繳、核心衛星比例", ["sec-risk"]], ["etf", "標的比較", "不同 ETF 用同樣條件比", ["sec-etf"]]]],
    ["存股工具", [["div", "股息計算機", "每年領多少、含息與不含息報酬", ["sec-div"]], ["hold", "我的庫存股息", "讀看盤庫存，算每月領多少", ["sec-hold"]], ["tax", "實拿股息試算", "健保、稅、手續費扣完拿多少", ["sec-tax"]], ["hist", "真實歷史回測", "真實股價定期定額到今天", ["sec-hist"]], ["ret", "退休提領試算", "每年領生活費能撐多久", ["sec-ret"]], ["mon", "月月配組合", "每個月都有股息的 ETF 組合", ["sec-mon"]], ["dca", "定期定額熱門", "大家最常定期定額買的股票、ETF", ["sec-dca"]]]]];
  const ALL = GROUPS.flatMap(([, L]) => L), CONSOLE = new Set(["sim", "ms", "risk", "etf"]), lay = document.querySelector(".layout");
  lay?.insertAdjacentHTML("beforebegin", `<nav class="sx-menu" aria-label="存股模擬選單">${GROUPS.map(([t, L]) => `<div class="sx-mg"><h3>${t}</h3><div class="sx-mi">${L.map(([k, n, d]) => `<button type="button" data-sxg="${k}"><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>`).join("")}</nav>`);
  document.querySelector("nav.jump")?.setAttribute("hidden", "");
  function sxGo(k, scroll) {
    const g = ALL.find(x => x[0] === k) || ALL[0], on = new Set(g[3]); S.grp = g[0]; save();
    ALL.flatMap(x => x[3]).forEach(id => { const el = $(id); if (el) el.hidden = !on.has(id); });
    lay?.classList.toggle("sx-noconsole", !CONSOLE.has(g[0]));
    document.querySelectorAll("[data-sxg]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sxg === g[0]));
    if (scroll) { const m = document.querySelector(".sx-menu"); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: "start" }); }
    window.dispatchEvent(new Event("resize")); // 圖表重新量寬度
    if (g[0] === "dca") dcaLoad();
  }
  // 定期定額熱門：證交所 ETFReport/ETFRank（經 /api/oapi），每列 No、股票代號名稱戶數、ETF 代號名稱戶數
  let DCA = null;
  async function dcaLoad() {
    const out = $("dca-out"); if (!out || DCA) return; DCA = true;
    let L; try { L = (await getJ("/api/oapi?src=twse&p=/ETFReport/ETFRank&limit=50")).rows || []; } catch (e) { DCA = null; out.innerHTML = `<p class="hint">⚠︎ ${esc(e.message)}</p>`; return; }
    const n = v => +String(v || 0).replace(/,/g, "") || 0, col = (c, nm, k) => { const R = L.map(r => [String(r[c] || "").trim(), String(r[nm] || "").trim(), n(r[k])]).filter(x => x[0]), mx = Math.max(1, ...R.map(x => x[2]));
      return `<ol class="dca-l">${R.map(([cd, name, v]) => `<li><span><b>${esc(name)}</b> <small class="hint">${esc(cd)}</small></span><span class="num">${v.toLocaleString()} 戶</span><button type="button" class="btn sm" data-dcabt="${esc(cd)}">回測</button><i style="width:${Math.round(v / mx * 100)}%"></i></li>`).join("")}</ol>`; };
    out.innerHTML = L.length ? `<div class="dca-g"><div><h3 class="h3">ETF</h3>${col("ETFsSecurityCode", "ETFsName", "ETFsNumberofTradingAccounts")}</div><div><h3 class="h3">股票</h3>${col("STOCKsSecurityCode", "STOCKsName", "STOCKsNumberofTradingAccounts")}</div></div>
      <p class="hint">戶數是設定定期定額的帳戶數，不代表報酬好壞；熱門也可能代表價格已經被很多人買高。資料：臺灣證券交易所。</p>` : `<p class="hint">暫時沒有資料。</p>`;
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-dcabt]"); if (!b) return; $("hs-code").value = b.dataset.dcabt; S["hs-code"] = b.dataset.dcabt; save(); sxGo("hist", true); histRun(); });
  document.addEventListener("click", e => { const b = e.target.closest("[data-sxg]"); if (b) sxGo(b.dataset.sxg, true); });
  // 網址帶 #sec-tax 之類就直接打開那一個功能
  const fromHash = () => { const id = location.hash.slice(1), g = ALL.find(x => x[3].includes(id)); return g?.[0]; };
  sxGo(fromHash() || S.grp || "sim"); addEventListener("hashchange", () => { const k = fromHash(); if (k) sxGo(k); });

  const css = document.createElement("style"); css.textContent = `.sx-menu{display:grid;gap:10px;margin:14px 0 4px}.sx-mg h3{margin:0 0 6px;font-size:12.5px;font-weight:500;color:var(--muted);letter-spacing:.04em}
.sx-mi{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}.sx-mi button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--ink);cursor:pointer;min-width:0}
.sx-mi button b{font-size:14px;font-weight:500}.sx-mi button small{font-size:11.5px;color:var(--muted);line-height:1.4}.sx-mi button[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.sec[hidden],section[hidden]{display:none!important}.layout.sx-noconsole{grid-template-columns:1fr}.layout.sx-noconsole>.console{display:none}
@media (max-width:560px){.sx-mi{grid-template-columns:1fr 1fr}.sx-mi button{padding:8px 9px}}
.dca-g{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}@media (max-width:640px){.dca-g{grid-template-columns:1fr}}.dca-l{list-style:none;margin:0 0 10px;padding:0}
.dca-l li{position:relative;display:flex;align-items:center;gap:8px;padding:8px 2px 10px;border-bottom:1px solid var(--line)}.dca-l li>span:first-child{flex:1;min-width:0}.dca-l i{position:absolute;left:0;bottom:2px;height:3px;background:var(--accent);opacity:.55;border-radius:2px}
.mm-bars{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;align-items:end;height:120px;margin:6px 0}
.mm-bars>div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;gap:2px}.mm-bars i{display:block;width:70%;background:var(--accent);border-radius:2px 2px 0 0;min-height:2px}.mm-bars i.zero{background:var(--line)}
.mm-bars b{font:500 10.5px var(--f-num);white-space:nowrap}.mm-bars small{font-size:10.5px;color:var(--muted)}.mm-tbl{min-width:760px}.mm-tbl td,.mm-tbl th{padding:6px 5px}
.mm-sug{list-style:none;margin:0;padding:0;display:grid;gap:6px}.mm-sug li{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.mm-sug b{min-width:3em;font-size:13px}.swatch{display:inline-block;width:10px;height:3px;margin-right:5px;vertical-align:middle}
.sx-link{display:block;margin-top:4px;padding:0;border:0;background:none;color:var(--accent);font:inherit;text-align:left;white-space:normal;cursor:pointer}
@media (max-width:560px){.mm-bars b{font-size:9px}}`; document.head.appendChild(css);
})();
