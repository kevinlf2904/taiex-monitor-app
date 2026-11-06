/* 投資組合的資料來源與更新標示（第 9 階段）：把報價、日 K 的回應整理成「來源、即時／盤後、行情日期、取得時間、完整嗎、過期嗎」，
   以及抓失敗時沿用上一次的好資料。純函式，不讀寫存檔、不連網、不輸出 console。瀏覽器裡是 window.KLPfSrc；測試用 node 的 vm 載入。
   口徑（docs/portfolio/DATA_SOURCE.md）：
   · 行情時間（資料本身的日期、成交時間）和取得時間、計算時間分開標，不混在一起。
   · 過期：沒有行情日期、比同市場其他持股最新的行情日舊、或比今天早超過 STALE_DAYS 天。
   · 抓失敗或少了幾檔：不覆蓋最後有效資料，沿用上一次的並標示「沿用」與當時的取得時間；不把舊資料當成最新行情。 */
(function (root) {
  "use strict";
  const VERSION = 1, DAY = 864e5, STALE_DAYS = 5;
  const MODE_LABEL = { live: "即時", after_close: "盤後", scheduled: "定時更新（可能延遲）", delayed: "延遲", daily: "日收盤" };
  const up = c => String(c || "").toUpperCase(), d10 = v => (v ? String(v).slice(0, 10) : null), mkt = c => (/^\d/.test(c) ? "tw" : "us");
  const uniq = a => [...new Set(a.filter(Boolean))];
  // 每檔一個行情日期 → 過期的代號：沒有日期、比同市場最新的舊、或比今天早超過 STALE_DAYS 天
  function staleOf(dates, today) {
    const newest = {}; for (const [c, d] of dates) if (d && (!newest[mkt(c)] || d > newest[mkt(c)])) newest[mkt(c)] = d;
    const t = today ? Date.parse(today + "T00:00:00Z") : null;
    return dates.filter(([c, d]) => !d || d < newest[mkt(c)] || (t != null && (t - Date.parse(d + "T00:00:00Z")) / DAY > STALE_DAYS)).map(([c]) => c);
  }
  // /api/quote 的回應（失敗時是 null 或 { ok:false }）；codes：想要的代號；opts.today：台北日期
  function quoteMeta(resp, codes, opts = {}) {
    const want = uniq(codes.map(up));
    if (!resp || !resp.ok) return { kind: "quote", ok: false, want: want.length, got: 0, missing: want, stale: [], sources: [], modes: [], error: (resp && resp.error) || "拿不到報價" };
    const Q = new Map((resp.quotes || []).filter(q => q && q.price > 0).map(q => [up(q.code), q])), got = want.filter(c => Q.has(c));
    const dates = got.map(c => [c, d10(Q.get(c).dataDate || Q.get(c).date)]), ds = dates.map(x => x[1]).filter(Boolean).sort();
    const sources = uniq(got.map(c => Q.get(c).source)), modes = uniq(got.map(c => Q.get(c).updateMode));
    return { kind: "quote", ok: true, want: want.length, got: got.length, missing: want.filter(c => !Q.has(c)), stale: staleOf(dates, opts.today),
      dataFrom: ds[0] || null, dataTo: ds[ds.length - 1] || null, sources: sources.length ? sources : uniq([resp.source]), modes: modes.length ? modes : uniq([resp.updateMode]),
      fallback: !!resp.isFallback || got.some(c => Q.get(c).isFallback), fetchedAt: resp.fetchedAt || resp.time || null, cachedAt: resp.swCachedAt != null ? new Date(+resp.swCachedAt).toISOString() : null };
  }
  // 日 K：代號 → /api/kline 的回應（失敗時 null）
  function klineMeta(byCode, codes, opts = {}) {
    const want = uniq(codes.map(up)), R = c => byCode?.[c], has = c => !!(R(c) && R(c).ok !== false && R(c).data?.length);
    const got = want.filter(has), dates = got.map(c => [c, d10(R(c).data[R(c).data.length - 1].d)]), ds = dates.map(x => x[1]).filter(Boolean).sort();
    return { kind: "kline", ok: got.length > 0 || !want.length, want: want.length, got: got.length, missing: want.filter(c => !has(c)), stale: staleOf(dates, opts.today),
      dataFrom: ds[0] || null, dataTo: ds[ds.length - 1] || null, sources: uniq(got.map(c => R(c).source)), modes: ["daily"], fallback: false, fetchedAt: opts.now || null,
      cachedAt: uniq(got.map(c => R(c).swCachedAt)).length ? new Date(Math.min(...got.map(c => +R(c).swCachedAt || Infinity))).toISOString() : null, error: got.length || !want.length ? null : "拿不到日 K" };
  }
  // 這次少了的代號沿用上一次的資料。prev、next 可以是 Map 或一般物件；回傳 { data, kept }
  function keepLast(prev, next, codes) {
    const M = o => !!o && typeof o.get === "function" && typeof o.set === "function", isMap = M(next), get = (o, c) => (M(o) ? o.get(c) : o?.[c]), out = isMap ? new Map(next) : { ...(next || {}) }, kept = [];
    for (const c of uniq(codes.map(up))) { if (get(out, c) != null) continue; const v = get(prev, c); if (v == null) continue; isMap ? out.set(c, v) : (out[c] = v); kept.push(c); }
    return { data: out, kept };
  }
  const hm = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ") : null; }; // 台北 MM-DD HH:MM
  // 畫面用的一行字（陣列，每段一個重點）與等級：ok／warn／error。name：代號 → 顯示名稱
  function describe(meta, opts = {}) {
    if (!meta) return { level: "warn", parts: ["資料來源不明"] };
    const name = opts.name || (c => c), list = a => a.slice(0, 5).map(name).join("、") + (a.length > 5 ? ` 等 ${a.length} 檔` : ""), parts = [];
    const kept = meta.kept || [];
    if (!meta.ok) parts.push(`這次${meta.kind === "kline" ? "拿不到日 K" : "拿不到報價"}${meta.error && !/^拿不到/.test(meta.error) ? `（${meta.error}）` : ""}${kept.length ? `，沿用${meta.keptAt ? ` ${hm(meta.keptAt)} ` : "上一次"}取得的資料` : ""}`);
    if (meta.sources?.length) parts.push(`來源 ${meta.sources.join("、")}`);
    if (meta.modes?.length) parts.push(meta.modes.map(m => MODE_LABEL[m] || m).join("／"));
    if (meta.dataFrom) parts.push(`行情日期 ${meta.dataFrom === meta.dataTo ? meta.dataFrom : `${meta.dataFrom}～${meta.dataTo}`}`);
    if (meta.fetchedAt && meta.ok) parts.push(`取得 ${hm(meta.fetchedAt)}`);
    if (meta.cachedAt) parts.push(`離線快取（${hm(meta.cachedAt)} 存的），不是最新`);
    if (meta.want && meta.ok) parts.push(meta.got >= meta.want ? `${meta.want} 檔都有` : `${meta.got}/${meta.want} 檔`);
    const miss = (meta.missing || []).filter(c => !kept.includes(c));
    if (meta.ok && kept.length) parts.push(`${list(kept)} 這次沒拿到，沿用${meta.keptAt ? ` ${hm(meta.keptAt)} ` : "上一次"}的資料`);
    if (miss.length && meta.ok) parts.push(`缺 ${list(miss)}`);
    if (meta.stale?.length) parts.push(`${list(meta.stale)} 的行情不是最新的`);
    if (meta.fallback) parts.push("用了備援來源，可能延遲");
    const level = !meta.ok ? "error" : miss.length || kept.length || meta.stale?.length || meta.cachedAt || meta.fallback ? "warn" : "ok";
    return { level, parts };
  }
  root.KLPfSrc = Object.freeze({ VERSION, STALE_DAYS, MODE_LABEL, quoteMeta, klineMeta, keepLast, describe });
})(typeof window !== "undefined" ? window : globalThis);
