// 行情時間欄位（四種不可互相替代）：
//   dataDate   行情所屬交易日（台北，YYYY-MM-DD）
//   sourceTime 資料來源自己的更新時間（台北，HH:MM:SS；MIS 的 t、富果的 lastUpdated）
//   fetchedAt  伺服器向來源取得的時間（ISO）
//   receivedAt 瀏覽器收到回應的時間（只在前端，learner/core.js）
// 判斷「是不是即時」要看 sourceTime：伺服器剛抓、瀏覽器剛收到，都不代表來源有更新。
// 前端 learner/core.js 的 twSourceFresh 是同一套規則（tests/unit.test.mjs 檢查兩邊結果一致）。

// 各類資料來源時間允許落後多久還算即時（毫秒）。指數每 5 秒更新；全市場取全部個股裡最新的成交時間，
// 收盤前 13:25～13:30 集合競價期間來源時間不動，所以給 6 分鐘。個股的時間是「最後成交時間」，冷門股本來就會很久沒成交，不拿來判斷過期。
export const SRC_LAG = { index: 180e3, market: 360e3, hot: 360e3, breadth: 360e3, quote: null };
const FUTURE_SKEW = 60e3; // 來源時間比現在晚超過 1 分鐘：時鐘或資料錯誤

// dataDate＋sourceTime（台北）→ 毫秒；格式不對、日期不存在（例 02-30）、時間超過範圍都回 null
export function sourceAt(dataDate, sourceTime) {
  if (typeof dataDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) return null;
  if (typeof sourceTime !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(sourceTime)) return null;
  const [h, m, s = "00"] = sourceTime.split(":");
  if (+h > 23 || +m > 59 || +s > 59) return null;
  const ms = Date.parse(`${dataDate}T${h}:${m}:${s}+08:00`);
  if (!Number.isFinite(ms) || new Date(ms + 8 * 3600e3).toISOString().slice(0, 10) !== dataDate) return null;
  return ms;
}

// state：missing（沒有日期或時間）、invalid（格式錯）、future（比現在晚）、old（超過門檻）、fresh
// maxLagMs 是 null 時只檢查有沒有、格式與未來時間，不判斷落後多久
export function sourceFresh({ dataDate, sourceTime, now = Date.now(), maxLagMs = null } = {}) {
  const nowMs = +now;
  if (!dataDate || !sourceTime) return { state: "missing", ageMs: null, at: null };
  const at = sourceAt(dataDate, sourceTime);
  if (at == null) return { state: "invalid", ageMs: null, at: null };
  const ageMs = nowMs - at;
  if (ageMs < -FUTURE_SKEW) return { state: "future", ageMs, at };
  if (maxLagMs != null && ageMs > maxLagMs) return { state: "old", ageMs, at };
  return { state: "fresh", ageMs, at };
}
