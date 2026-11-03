/**
 * Portfolio data contract v1. Read-only adapter for legacy watch:hold.
 * No implicit browser-storage access and no storage writes.
 */
export const PORTFOLIO_MODEL_VERSION = 1;
export const LEGACY_HOLDINGS_KEY = "watch:hold";
const isRecord = v => v !== null && typeof v === "object" && !Array.isArray(v);
const positive = v => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const validDate = v => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const symbolOf = v => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim().toUpperCase();
  return s && s.length <= 16 && /^[A-Z0-9][A-Z0-9.^_-]*$/.test(s) ? s : null;
};
const marketOf = s => /^\d{4,6}[A-Z]?$/.test(s) ? "tw" : "us";

export function normalizePortfolioHoldings(raw, { source = "legacy_watch_hold" } = {}) {
  const issues = [], items = [];
  const emptyQuality = { inputCount: 0, acceptedCount: 0, rejectedCount: 0, missingDateCount: 0, invalidDateCount: 0, marketCounts: { tw: 0, us: 0 } };
  if (!isRecord(raw)) return {
    schemaVersion: PORTFOLIO_MODEL_VERSION, source, status: "invalid", items,
    issues: [{ code: "invalid_root", severity: "error", message: "庫存資料必須是以股票代號為鍵的物件。" }],
    quality: emptyQuality
  };
  const keys = Object.keys(raw), seen = new Set();
  let missingDateCount = 0, invalidDateCount = 0;
  for (const key of keys) {
    const symbol = symbolOf(key);
    if (!symbol) { issues.push({ code: "invalid_symbol", severity: "error", message: "股票代號格式不正確，已略過此筆。" }); continue; }
    if (seen.has(symbol)) { issues.push({ code: "duplicate_symbol", severity: "error", symbol, message: "正規化後出現重複股票代號，已略過後續資料。" }); continue; }
    const row = raw[key];
    if (!isRecord(row)) { issues.push({ code: "invalid_row", severity: "error", symbol, message: "庫存項目格式不正確，已略過此筆。" }); continue; }
    const shares = positive(row.sh), averageCost = positive(row.cost);
    const costBasis = shares !== null && averageCost !== null ? shares * averageCost : null;
    if (shares === null || averageCost === null || !Number.isFinite(costBasis) || costBasis <= 0) {
      issues.push({ code: "invalid_position_values", severity: "error", symbol, message: "股數、平均成本與成本基礎都必須是有限且大於 0 的數值，已略過此筆。" });
      continue;
    }
    // Reserve the symbol only after the row passes position validation; a malformed earlier row must not block a later valid one.
    seen.add(symbol);
    let openedAt = null;
    if (row.d == null || row.d === "") missingDateCount++;
    else if (validDate(row.d)) openedAt = row.d;
    else { invalidDateCount++; issues.push({ code: "invalid_opened_at", severity: "warning", symbol, message: "建倉日期無效，已保留持股但不採用日期。" }); }
    items.push({ symbol, market: marketOf(symbol), marketSource: "symbol_heuristic", shares, averageCost, costBasis, openedAt });
  }
  const rejectedCount = keys.length - items.length, hasErrors = issues.some(x => x.severity === "error");
  const status = items.length === 0 ? (hasErrors ? "invalid" : "empty") : (hasErrors ? "partial" : "ready");
  return {
    schemaVersion: PORTFOLIO_MODEL_VERSION, source, status, items, issues,
    quality: {
      inputCount: keys.length, acceptedCount: items.length, rejectedCount, missingDateCount, invalidDateCount,
      marketCounts: { tw: items.filter(x => x.market === "tw").length, us: items.filter(x => x.market === "us").length }
    }
  };
}

export function readLegacyHoldings(storage) {
  if (!storage || typeof storage.getItem !== "function") return normalizePortfolioHoldings(null, { source: "legacy_local_storage" });
  let serialized;
  try { serialized = storage.getItem(LEGACY_HOLDINGS_KEY); }
  catch { return { ...normalizePortfolioHoldings(null, { source: "legacy_local_storage" }), issues: [{ code: "storage_read_failed", severity: "error", message: "無法讀取舊版庫存資料；原始資料未變更。" }] }; }
  if (serialized == null || serialized === "") return normalizePortfolioHoldings({}, { source: "legacy_local_storage" });
  let raw;
  try { raw = typeof serialized === "string" ? JSON.parse(serialized) : serialized; }
  catch { return { ...normalizePortfolioHoldings(null, { source: "legacy_local_storage" }), issues: [{ code: "invalid_json", severity: "error", message: "舊版庫存資料不是有效 JSON；原始資料未變更。" }] }; }
  return normalizePortfolioHoldings(raw, { source: "legacy_local_storage" });
}
