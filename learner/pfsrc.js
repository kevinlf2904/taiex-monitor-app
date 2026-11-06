/* 投資組合的資料來源與更新標示（第 9 階段）：把報價、日 K 的回應整理成「來源、即時／盤後、行情日期、取得時間、完整嗎、過期嗎」，
   以及抓失敗時沿用上一次的好資料。純函式，不讀寫存檔、不連網、不輸出 console。瀏覽器裡是 window.KLPfSrc；測試用 node 的 vm 載入。
   口徑（docs/portfolio/DATA_SOURCE.md）：
   · 每一檔各自記住自己的行情日期、來源、即時／盤後、取得時間（at）。沿用時整筆照舊，取得時間永遠是當初真正拿到的時間。
   · 行情時間（資料本身的日期）、取得時間、計算時間分開標，不混在一起。
   · 過期：沒有行情日期；比同市場其他持股最新的行情日舊；或行情日期到今天之間隔了任何一個交易日（台股、美股各用自己的交易日曆）。
     交易日曆不知道的日子（例如休市日表還沒拿到）→「無法確認是不是最新」，不當成正常。
   · 抓失敗或少了幾檔：不覆蓋最後有效資料，沿用上一次的並標示；不把舊資料當成最新行情。 */
(function (root) {
  "use strict";
  const VERSION = 2, DAY = 864e5, MAX_SPAN = 40;
  const MODE_LABEL = { live: "即時", after_close: "盤後", scheduled: "定時更新（可能延遲）", delayed: "延遲", daily: "日收盤" };
  const up = c => String(c || "").toUpperCase(), d10 = v => (v ? String(v).slice(0, 10) : null), mkt = c => (/^\d/.test(c) ? "tw" : "us");
  const uniq = a => [...new Set(a.filter(Boolean))], iso = t => new Date(t).toISOString().slice(0, 10), dn = s => Date.parse(s + "T00:00:00Z");
  const weekendOnly = (m, d) => { const w = new Date(dn(d)).getUTCDay(); return w === 0 || w === 6 ? false : null; }; // 沒有交易日曆時只知道週末

  // 一檔的新鮮度："ok"／"stale"／"unsure"。opts.tradingDay(market, iso) → true／false／null（不知道）；opts.todayOf(market) 或 opts.today
  function freshOf(code, d, opts = {}) {
    if (!d) return "stale";
    const m = mkt(code), today = (opts.todayOf && opts.todayOf(m)) || opts.today; if (!today) return "unsure";
    if (d >= today) return "ok";
    const td = opts.tradingDay || weekendOnly; let unsure = false;
    if ((dn(today) - dn(d)) / DAY > MAX_SPAN) return "stale";
    for (let t = dn(d) + DAY; t < dn(today); t += DAY) { const v = td(m, iso(t)); if (v === true) return "stale"; if (v == null) unsure = true; }
    return unsure ? "unsure" : "ok";
  }

  // /api/quote 的回應（失敗時是 null 或 { ok:false }）→ { ok, error, at, fallback, cachedAt, items: 代號 → { d, source, mode, fallback, at, cachedAt } }
  function quoteItems(resp, now) {
    if (!resp || !resp.ok) return { ok: false, error: (resp && resp.error) || null, items: {} };
    const at = resp.fetchedAt || resp.time || now || null, cachedAt = resp.swCachedAt != null ? new Date(+resp.swCachedAt).toISOString() : null, items = {};
    for (const q of resp.quotes || []) if (q && q.price > 0) items[up(q.code)] = { d: d10(q.dataDate || q.date), source: q.source || resp.source || null, mode: q.updateMode || resp.updateMode || null, fallback: !!(q.isFallback || resp.isFallback), at, cachedAt };
    return { ok: true, at, items };
  }
  // 日 K：代號 → /api/kline 的回應（失敗時 null）
  function klineItems(byCode, now) {
    const items = {};
    for (const [c, R] of Object.entries(byCode || {})) if (R && R.ok !== false && R.data?.length) items[up(c)] = { d: d10(R.data[R.data.length - 1].d), source: R.source || null, mode: "daily", fallback: false, at: now || null, cachedAt: R.swCachedAt != null ? new Date(+R.swCachedAt).toISOString() : null };
    const ok = Object.keys(items).length > 0 || !Object.keys(byCode || {}).length;
    return { ok, error: ok ? null : "拿不到日 K", at: now || null, items };
  }
  // 這次沒有的代號沿用上一次的那一筆（整筆照舊，包括當初的取得時間）
  function mergeItems(prev, items, codes) {
    const out = { ...(items || {}) }, kept = [];
    for (const c of uniq(codes.map(up))) if (!out[c] && prev?.[c]) { out[c] = prev[c]; kept.push(c); }
    return { items: out, kept };
  }
  // 資料本身（價格表）沿用：prev、next 可以是 Map 或一般物件；回傳 { data, kept }
  function keepLast(prev, next, codes) {
    const M = o => !!o && typeof o.get === "function" && typeof o.set === "function", isMap = M(next), get = (o, c) => (M(o) ? o.get(c) : o?.[c]), out = isMap ? new Map(next) : { ...(next || {}) }, kept = [];
    for (const c of uniq(codes.map(up))) { if (get(out, c) != null) continue; const v = get(prev, c); if (v == null) continue; isMap ? out.set(c, v) : (out[c] = v); kept.push(c); }
    return { data: out, kept };
  }
  // 這次的結果（quoteItems／klineItems）＋合併後的每檔紀錄 → 畫面用的狀態
  function summarize(kind, cur, items, codes, opts = {}) {
    const want = uniq(codes.map(up)), fresh = want.filter(c => cur?.items?.[c]), have = want.filter(c => items?.[c]), kept = have.filter(c => !fresh.includes(c));
    const I = c => items[c], ds = have.map(c => I(c).d).filter(Boolean).sort();
    const newest = {}; for (const c of have) { const d = I(c).d; if (d && (!newest[mkt(c)] || d > newest[mkt(c)])) newest[mkt(c)] = d; }
    const stale = [], unsure = [];
    for (const c of have) { const d = I(c).d, f = d && d < newest[mkt(c)] ? "stale" : freshOf(c, d, opts); if (f === "stale") stale.push(c); else if (f === "unsure") unsure.push(c); }
    const cached = have.map(c => I(c).cachedAt).filter(Boolean).sort();
    return { kind, ok: !!cur?.ok, error: cur?.ok ? null : cur?.error || null, want: want.length, got: fresh.length, have: have.length, missing: want.filter(c => !items?.[c]),
      kept: kept.map(c => ({ code: c, at: I(c).at || null })), stale, unsure, dataFrom: ds[0] || null, dataTo: ds[ds.length - 1] || null,
      sources: uniq(have.map(c => I(c).source)), modes: uniq(have.map(c => I(c).mode)), fallback: have.some(c => I(c).fallback), cachedAt: cached[0] || null, fetchedAt: cur?.ok ? cur.at || null : null };
  }
  const hm = s => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ") : null; }; // 台北 MM-DD HH:MM
  // 畫面用的幾段字與等級：ok／warn／error。name：代號 → 顯示名稱
  function describe(meta, opts = {}) {
    if (!meta) return { level: "warn", parts: ["無法確認資料來源與時間"] };
    const name = opts.name || (c => c), list = a => a.slice(0, 5).map(name).join("、") + (a.length > 5 ? ` 等 ${a.length} 檔` : ""), parts = [], what = meta.kind === "kline" ? "日 K" : "報價";
    // 沿用的依當初取得時間分組（最舊的先寫），各自寫出真正的取得時間
    const groups = new Map(); for (const k of [...(meta.kept || [])].sort((x, y) => String(x.at).localeCompare(String(y.at)))) { const t = hm(k.at) || "上一次"; groups.set(t, [...(groups.get(t) || []), k.code]); }
    const keptTxt = [...groups].map(([t, cs]) => `${list(cs)} 沿用 ${t}${t === "上一次" ? "" : " "}取得的資料`).join("；");
    if (!meta.ok) parts.push(`這次拿不到${what}${meta.error && !/^拿不到/.test(meta.error) ? `（${meta.error}）` : ""}${meta.have ? "" : "，也沒有之前的資料"}`);
    if (keptTxt) parts.push(keptTxt);
    if (meta.sources?.length) parts.push(`來源 ${meta.sources.join("、")}`);
    if (meta.modes?.length) parts.push(meta.modes.map(m => MODE_LABEL[m] || m).join("／"));
    if (meta.dataFrom) parts.push(`行情日期 ${meta.dataFrom === meta.dataTo ? meta.dataFrom : `${meta.dataFrom}～${meta.dataTo}`}`);
    if (meta.ok && meta.fetchedAt) parts.push(`取得 ${hm(meta.fetchedAt)}`);
    if (meta.cachedAt) parts.push(`含離線快取（${hm(meta.cachedAt)} 存的），不是最新`);
    if (meta.want) parts.push(meta.have >= meta.want ? `${meta.want} 檔都有` : `${meta.have}/${meta.want} 檔有資料`);
    if (meta.missing?.length) parts.push(`缺 ${list(meta.missing)}`);
    if (meta.stale?.length) parts.push(`${list(meta.stale)} 的行情不是最新的`);
    if (meta.unsure?.length) parts.push(`${list(meta.unsure)} 無法確認是不是最新（沒有交易日曆）`);
    if (meta.fallback) parts.push("用了備援來源，可能延遲");
    const level = !meta.ok ? "error" : meta.missing?.length || meta.kept?.length || meta.stale?.length || meta.unsure?.length || meta.cachedAt || meta.fallback ? "warn" : "ok";
    return { level, parts };
  }
  root.KLPfSrc = Object.freeze({ VERSION, MODE_LABEL, freshOf, quoteItems, klineItems, mergeItems, keepLast, summarize, describe });
})(typeof window !== "undefined" ? window : globalThis);
