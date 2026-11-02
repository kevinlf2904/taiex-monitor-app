// Gemini 型號會下架：寫死的型號名稱（gemini-2.5-flash、gemini-flash-latest…）一旦停用就全部回 404，
// 網站上的 AI 整理只會顯示「找不到可用的 Gemini 模型」。
// 這裡用 Google 的「列出模型」API（GET /v1beta/models：免費、不產生文字、不算額度）查這把金鑰目前能用哪些 Flash 型號，
// 把寫死清單裡已經不存在的拿掉、補上查到的新型號；查不到（網路錯誤、權限）就照原清單試，不會比原本差。
// 結果在同一個執行個體快取 6 小時，不會每次問 AI 都多查一次。
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const LIST_TTL = 6 * 3600e3;
let cache = null; // { at, names: Set<string>, flash: string[] }

const BAD = /image|tts|audio|live|embed|thinking|exp|computer|robotics|native/i;

// 各用途依序試的型號（免費方案額度：Flash Lite 每天 500 次、每分鐘 15 次；Flash 每天 20 次、每分鐘 5 次）。
// 原則：量大、常按的用 Lite；要求品質的用 Flash；排程和網站各用一個 Lite，彼此不搶額度。
//   chat   右下角「問問題」：品質優先，三個 Flash（共 60 次／天）用完再換 Lite
//   today  今日市場 AI 整理：一天可能按很多次 → 3.1 Flash Lite 為主
//   batch  排程與網站上的摘要（節目、總經新聞、產業新聞、法說會簡報）：量大、內容長 → 3.5 Flash Lite 為主
//   vision 截圖匯入（讀表格）：要準 → Flash 為主
// 名稱不必完全一樣：「gemini-3.6-flash」也會配到清單裡的「gemini-3.6-flash-001」「gemini-3.6-flash-preview-…」；查不到的自動略過。
export const GEMINI_ORDER = Object.freeze({
  chat: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
  today: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.6-flash", "gemini-3-flash"],
  batch: ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3-flash"],
  vision: ["gemini-3.6-flash", "gemini-3-flash", "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
});

// 想要的名稱 → 清單裡實際的名稱：完全一樣優先；否則找「名稱-…」開頭的（正式版優先於預覽版），不把 Lite 配給一般 Flash
export function resolveName(want, names) {
  if (names.has(want)) return want;
  const lite = /-lite\b/.test(want);
  const hits = [...names].filter(n => n.startsWith(want + "-") && !BAD.test(n) && (lite || !/-lite\b/.test(n.slice(want.length))));
  hits.sort((a, b) => (/-preview/.test(a) - /-preview/.test(b)) || a.length - b.length || a.localeCompare(b));
  return hits[0] || null;
}
const FLASH = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(?:-preview(?:-[\w-]+)?)?$/;
const ALIAS = /^gemini-flash(-lite)?-latest$/;

// 從列出模型的結果挑出可以 generateContent 的文字 Flash 型號，排序：別名（-latest）→ 正式版新到舊 → 預覽版 → lite
export function pickFlash(models = []) {
  const out = [];
  for (const m of models) {
    const name = String(m?.name || "").replace(/^models\//, "");
    if (!name || BAD.test(name) || !(m.supportedGenerationMethods || []).includes("generateContent")) continue;
    const a = name.match(ALIAS), f = name.match(FLASH);
    if (a) out.push({ name, rank: [a[1] ? 1 : 0, 0, 0, 0] });
    else if (f) out.push({ name, rank: [f[2] ? 1 : 0, 1, /-preview/.test(name) ? 1 : 0, -parseFloat(f[1])] });
  }
  const cmp = (x, y) => { for (let i = 0; i < 4; i++) if (x.rank[i] !== y.rank[i]) return x.rank[i] - y.rank[i]; return x.name.localeCompare(y.name); };
  return out.sort(cmp).map(x => x.name);
}

export async function listModels(key, { fetchImpl = fetch, now = Date.now(), timeout = 4000 } = {}) {
  if (cache && now - cache.at < LIST_TTL) return cache;
  try {
    const all = []; let token = "";
    for (let page = 0; page < 3; page++) {
      const r = await fetchImpl(`${API}?pageSize=200${token ? "&pageToken=" + encodeURIComponent(token) : ""}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(timeout) });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!Array.isArray(j?.models)) return null;
      all.push(...j.models);
      if (!j.nextPageToken) break;
      token = j.nextPageToken;
    }
    const names = new Set(all.map(m => String(m?.name || "").replace(/^models\//, "")).filter(Boolean));
    if (!names.size) return null;
    cache = { at: now, names, flash: pickFlash(all) };
    return cache;
  } catch { return null; }
}

// wanted：呼叫端原本要依序試的型號。回傳：wanted 裡目前還存在的（保留原順序）＋查到的其他 Flash 型號，最多 6 個
export async function geminiModels(key, wanted, opts) {
  const want = [...new Set(wanted.filter(Boolean))];
  const L = key ? await listModels(key, opts) : null;
  if (!L) return want;
  const merged = [...new Set([...want.map(m => resolveName(m, L.names)).filter(Boolean), ...L.flash])].slice(0, 6);
  return merged.length ? merged : want;
}
export const _resetGeminiCache = () => { cache = null; };
