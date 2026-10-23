// 美股的「法說會重點」：美國公司每季公布財報時，會在 SEC 申報 8-K（Item 2.02 Results of Operations），附件 99.1 是財報新聞稿（earnings release，含管理層說法與財測）。
// 這裡找最近幾次的 8-K 2.02，請 AI 讀新聞稿整理成和台股法說會一樣的格式（api/_lib/confai.js 的 /api/confai 用到；代號是英文字母時走這裡）。
// 來源：SEC EDGAR（免金鑰，要帶 User-Agent；data.sec.gov 的申報清單、www.sec.gov/Archives 的申報文件）。
import { sec, cikOf, SEC_UA } from "./usinfo.js";
import { geminiJSON } from "./podcast.js";

export const okAcc = a => typeof a === "string" && /^\d{10}-\d{2}-\d{6}$/.test(a);
const dir = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, "")}/`;
// submissions 的 recent 是一欄一個陣列：只留 8-K 而且 items 有 2.02 的（新到舊）
export function parseUs8k(j, cik, n = 8) {
  const R = j?.filings?.recent || {}, out = [];
  for (let i = 0; i < (R.form || []).length && out.length < n; i++) if (R.form[i] === "8-K" && /(^|,)\s*2\.02/.test(R.items?.[i] || ""))
    out.push({ date: R.filingDate[i], time: "", note: "季度財報新聞稿（8-K Item 2.02）", file: R.accessionNumber[i], en: null, url: dir(cik, R.accessionNumber[i]) });
  return out;
}
export async function usConfList(sym) {
  const cik = await cikOf(sym); if (!cik) throw new Error("SEC 找不到這個代號（外國公司申報 6-K／20-F，這裡沒有）");
  return parseUs8k(await sec(`https://data.sec.gov/submissions/CIK${cik}.json`), cik);
}
// 申報資料夾裡找附件 99.1（檔名常見 ex99-1.htm、ex991.htm、q3fy26pr.htm…）；找不到就用最大的 .htm
export function pickEx99(items) {
  const H = (items || []).filter(x => /\.html?$/i.test(x.name || "") && !/index/i.test(x.name));
  return (H.find(x => /ex-?99[-_.]?0?1\b|ex991|exhibit99/i.test(x.name)) || H.find(x => /99/.test(x.name)) || [...H].sort((a, b) => (+b.size || 0) - (+a.size || 0))[0])?.name || null;
}
export const htmlText = h => String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#822[01];|&[lr]dquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\s*\n+/g, "\n").trim();
const PROMPT = name => `你是美股研究員。這是「${name}」最新一季的財報新聞稿（earnings release，美國公司申報 SEC 8-K 的附件）。請只根據新聞稿內容整理，不要加沒寫的數字或推測，用繁體中文、台灣用語。金額一律照原文的寫法加「美元」（例如 $46.7 billion 寫「46.7 billion 美元」、$950 million 寫「950 million 美元」），不要自己換算成億或萬，避免單位算錯。輸出 JSON：
{"head":"一句話總結這季最重要的訊息（40 字內）",
 "outlook":["公司給的下一季或全年財測（guidance）與展望，3～5 條，每條 50 字內，有數字就寫數字；沒有財測就寫管理層對前景的說法"],
 "margin":"毛利率、營益率的表現與指引（60 字內，沒有就寫空字串）",
 "capex":"資本支出、庫藏股、股利等資本配置（60 字內，沒有就寫空字串）",
 "demand":"各產品線、業務部門或地區的表現與需求（80 字內）",
 "risks":["新聞稿提到的風險或不利因素，最多 3 條"],
 "quotes":["值得注意的管理層原文句子（保留英文原文），最多 3 句"]}`;
export async function summarizeUs(sym, acc, name, key, deadline = Date.now() + 55000, parse) {
  const cik = await cikOf(sym); if (!cik) throw new Error("SEC 找不到這個代號");
  const idx = await sec(dir(cik, acc) + "index.json"), f = pickEx99(idx?.directory?.item); if (!f) throw new Error("這份申報找不到財報新聞稿");
  const r = await fetch(dir(cik, acc) + f, { headers: { "User-Agent": SEC_UA() }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`新聞稿下載失敗（HTTP ${r.status}）`);
  const text = htmlText(await r.text()).slice(0, 150000); if (text.length < 500) throw new Error("新聞稿內容太短，沒辦法整理");
  const out = await geminiJSON([{ text: PROMPT(name) + "\n\n" + text }], key, deadline, {}, "gemini-flash-lite-latest"), s = parse(out.text);
  if (!s) throw new Error("AI 回傳格式不對，請再試一次");
  return { ...s, file: acc, url: dir(cik, acc) + f, model: out.model };
}
