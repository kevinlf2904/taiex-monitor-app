// 處置股與注意股：給 learner/watch.html「大盤」與個股「指標」使用。
// GET /api/warn → { ok, punish: [{ code, name, market, period, reason, measure }], notice: [{ code, name, market, reason }] }
// 來源：證交所 OpenAPI announcement/punish（處置）、announcement/notice（注意）；櫃買中心對應的公開資料。欄位名稱用關鍵字找。

import { getJSON } from "./_tw.js";

const keyOf = (r, re) => Object.keys(r).find(k => re.test(String(k).replace(/\s/g, "")));
const s = v => String(v ?? "").replace(/\s+/g, " ").trim();
export function parseWarn(rows, market, kind) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const r0 = rows[0], kC = keyOf(r0, /^(證券代號|有價證券代號|代號|Code|SecuritiesCompanyCode)$/i), kN = keyOf(r0, /^(證券名稱|有價證券名稱|名稱|Name|CompanyName)$/i);
  const kP = keyOf(r0, /處置期間|期間|DispositionPeriod|Period/i), kR = keyOf(r0, /處置條件|注意交易資訊|原因|條件|Reason|TradingInformation|Condition/i), kM = keyOf(r0, /處置措施|措施|Measure/i);
  if (!kC) return [];
  return rows.map(r => ({ code: s(r[kC]), name: s(kN ? r[kN] : ""), market, ...(kind === "punish" ? { period: s(kP ? r[kP] : ""), measure: s(kM ? r[kM] : "") } : {}), reason: s(kR ? r[kR] : "").slice(0, 200) }))
    .filter(x => /^\d{4,6}[A-Z]?$/.test(x.code));
}

export default async function handler(req, res) {
  const src = [
    ["punish", "上市", "https://openapi.twse.com.tw/v1/announcement/punish"],
    ["notice", "上市", "https://openapi.twse.com.tw/v1/announcement/notice"],
    ["punish", "上櫃", "https://www.tpex.org.tw/openapi/v1/tpex_disposal_information"],
    ["notice", "上櫃", "https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information"],
  ];
  const got = await Promise.allSettled(src.map(([k, m, u]) => getJSON(u, 12000).then(j => parseWarn(j, m, k))));
  const out = { punish: [], notice: [] }, errors = [];
  got.forEach((g, i) => { const [k, m] = src[i]; if (g.status === "fulfilled") out[k].push(...g.value); else errors.push(`${m}${k === "punish" ? "處置" : "注意"}：${g.reason?.message}`); });
  if (!out.punish.length && !out.notice.length && errors.length === src.length) return res.status(200).json({ ok: false, error: `拿不到處置與注意股（${errors[0]}）` });
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  return res.status(200).json({ ok: true, source: "證交所、櫃買中心公告", ...out, errors });
}
