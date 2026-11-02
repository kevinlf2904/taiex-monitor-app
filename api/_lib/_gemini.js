// Gemini 型號會下架：寫死的型號名稱（gemini-2.5-flash、gemini-flash-latest…）一旦停用就全部回 404，
// 網站上的 AI 整理只會顯示「找不到可用的 Gemini 模型」。
// 這裡用 Google 的「列出模型」API（GET /v1beta/models：免費、不產生文字、不算額度）查這把金鑰目前能用哪些 Flash 型號，
// 把寫死清單裡已經不存在的拿掉、補上查到的新型號；查不到（網路錯誤、權限）就照原清單試，不會比原本差。
// 結果在同一個執行個體快取 6 小時，不會每次問 AI 都多查一次。
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const LIST_TTL = 6 * 3600e3;
let cache = null; // { at, names: Set<string>, flash: string[] }

const BAD = /image|tts|audio|live|embed|thinking|exp|computer|robotics|native/i;
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
  const merged = [...new Set([...want.filter(m => L.names.has(m)), ...L.flash])].slice(0, 6);
  return merged.length ? merged : want;
}
export const _resetGeminiCache = () => { cache = null; };
