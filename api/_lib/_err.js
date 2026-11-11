// 回給使用者的錯誤訊息：我們自己寫的（中文）原樣回；外部服務、套件丟出的英文原文只記在伺服器日誌，畫面上換成固定說明，不把內部細節帶出去
export function userMsg(e, fallback, where = "") {
  const m = String(e?.message || "");
  if (/[一-鿿]/.test(m)) return m;
  console.error(`[${where}]`, m || e);
  return fallback;
}

// 回給前端的錯誤說明（要放進 error／errors 欄位的）：我們自己寫的中文、"HTTP 503" 這類狀態碼原樣；逾時、連線錯誤換成固定說法；
// 其他（套件丟出的英文原文：主機名稱、IP、程式內部的欄位名稱…）不帶出去，只記在伺服器日誌（#262 SEC-07）
export function errText(e) {
  const m = String(e?.message ?? e ?? ""), name = String(e?.name || "");
  if (/[一-鿿]/.test(m)) return m;
  const h = m.match(/\bHTTP \d{3}\b/); if (h) return h[0];
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted|逾時/i.test(m)) return "逾時";
  console.warn("[errText]", m);
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|network|socket|certificate/i.test(m)) return "連線失敗";
  return "暫時無法取得";
}
