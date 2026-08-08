// 伺服器端 API Route（在 Vercel 上會變成一個 Serverless Function）。
// 這裡是「伺服器」對「TWSE伺服器」發請求，不是瀏覽器直接發請求，
// 所以完全不受瀏覽器 CORS 政策的限制，也不受 Claude Artifact 沙盒限制。
// 瀏覽器只會呼叫「自己的網域」下的 /api/taiex，這一步永遠不會有 CORS 問題。

const TWSE_FMTQIK = "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK";
const TWSE_BFI82U = "https://openapi.twse.com.tw/v1/fund/BFI82U";

function rocToDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (str.includes("/")) return str;
  if (str.length === 7) {
    const roc = parseInt(str.slice(0, 3), 10);
    const mm = str.slice(3, 5), dd = str.slice(5, 7);
    return `${roc + 1911}/${mm}/${dd}`;
  }
  return str;
}
function toNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[,+]/g, ""));
  return Number.isNaN(n) ? null : n;
}
function pick(row, keywords) {
  const key = Object.keys(row).find((k) => keywords.every((kw) => k.includes(kw)));
  return key ? row[key] : null;
}

export default async function handler(req, res) {
  try {
    const [fmtqikRes, bfiRes] = await Promise.all([
      fetch(TWSE_FMTQIK),
      fetch(TWSE_BFI82U),
    ]);

    if (!fmtqikRes.ok) throw new Error(`FMTQIK HTTP ${fmtqikRes.status}`);
    if (!bfiRes.ok) throw new Error(`BFI82U HTTP ${bfiRes.status}`);

    const fmtqik = await fmtqikRes.json();
    const bfi = await bfiRes.json();

    const taiex = (fmtqik || [])
      .map((row) => ({
        date: rocToDate(pick(row, ["Date"]) ?? row.Date),
        close: toNum(pick(row, ["TAIEX"]) ?? row.TAIEX),
        change: toNum(pick(row, ["Change"]) ?? row.Change),
        volume: toNum(pick(row, ["TradeValue"]) ?? row.TradeValue),
      }))
      .filter((r) => r.close != null);

    const flow = (bfi || []).map((row) => {
      const foreign = toNum(pick(row, ["外資", "買賣超"])) ?? toNum(pick(row, ["外資", "差額"]));
      const trust = toNum(pick(row, ["投信", "買賣超"])) ?? toNum(pick(row, ["投信", "差額"]));
      const dealer = toNum(pick(row, ["自營商", "買賣超", "合計"])) ?? toNum(pick(row, ["自營商", "差額", "合計"]));
      return {
        date: rocToDate(pick(row, ["Date"]) ?? row.Date),
        foreign: foreign != null ? foreign / 1e8 : null,
        trust: trust != null ? trust / 1e8 : null,
        dealer: dealer != null ? dealer / 1e8 : null,
      };
    });

    if (!taiex.length && !flow.length) {
      return res.status(200).json({
        ok: false,
        error: "TWSE 回傳資料為空或欄位格式不符，請查看 raw 欄位確認實際結構",
        raw: { fmtqikSample: fmtqik?.[0] ?? null, bfiSample: bfi?.[0] ?? null },
      });
    }

    // 快取 5 分鐘，減少對 TWSE 的重複請求（每日資料，不需要每次都重抓）
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, taiex, flow, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message || "抓取失敗" });
  }
}
