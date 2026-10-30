// 共用：行情來源的有限次重試。檔名以底線開頭，Vercel 不會把它當成 API 路由。
// 錯誤分類決定要不要重試：
//   fatal（401、403、404：權限或方案不支援，重試也一樣）、circuit（斷路器開著）→ 不重試
//   rate（429）、server（5xx）、timeout、network、bad_json（JSON 壞掉）、empty（200 但沒有資料）、incomplete（200 但缺一大半）→ 有限次重試
// 等待時間：指數退避（baseMs、2×、4×…，最多 maxMs）再乘 0.5～1 的隨機值（jitter），避免很多請求同時重來；整體不超過 deadline。

export const RETRY = { attempts: 3, baseMs: 250, maxMs: 2000 };

export function retryErr(kind, message, status) {
  const e = new Error(message || kind);
  e.kind = kind;
  if (status != null) e.status = status;
  return e;
}

export function errKind(e) {
  if (e?.kind) return e.kind;
  const status = e?.status ?? +(/^HTTP (\d{3})/.exec(e?.message || "")?.[1] || 0);
  if (status === 401 || status === 403 || status === 404) return "fatal";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  if (status >= 400) return "fatal";
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout|逾時/i.test(e?.message || "")) return "timeout";
  if (e instanceof SyntaxError) return "bad_json";
  return "network";
}

export const retryable = e => !["fatal", "circuit"].includes(errKind(e));

// 第 n 次重試前要等多久（n 從 0 開始）
export function backoff(n, { baseMs = RETRY.baseMs, maxMs = RETRY.maxMs, rand = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** n);
  return Math.round(cap / 2 + rand() * (cap / 2));
}

const realSleep = ms => new Promise(r => setTimeout(r, ms));

// fn(第幾次) 成功就回傳；失敗依錯誤種類決定要不要再試。回傳 fn 的結果，用盡次數或期限就丟出最後一個錯誤（帶 attempts）
export async function withRetry(fn, { attempts = RETRY.attempts, baseMs, maxMs, deadline = Infinity, now = Date.now, sleep = realSleep, rand, onRetry } = {}) {
  let last = null, n = 0;
  for (; n < attempts; n++) {
    try { return await fn(n); }
    catch (e) {
      last = e;
      if (!retryable(e) || n === attempts - 1) break;
      const wait = backoff(n, { baseMs, maxMs, rand });
      if (now() + wait >= deadline) break; // 等完就超過整體期限：不再試
      onRetry?.(e, n, wait);
      await sleep(wait);
    }
  }
  if (last && typeof last === "object") last.attempts = Math.min(n + 1, attempts);
  throw last || retryErr("timeout", "超過整體時間上限");
}

// 同一時間只跑一次：還沒結束時再呼叫，拿到同一個 Promise（避免同時進來的請求各自打一輪外部來源）
export function singleFlight(fn) {
  let p = null;
  return (...a) => p || (p = Promise.resolve().then(() => fn(...a)).finally(() => { p = null; }));
}
