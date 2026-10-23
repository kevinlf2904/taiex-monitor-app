// 回給使用者的錯誤訊息：我們自己寫的（中文）原樣回；外部服務、套件丟出的英文原文只記在伺服器日誌，畫面上換成固定說明，不把內部細節帶出去
export function userMsg(e, fallback, where = "") {
  const m = String(e?.message || "");
  if (/[一-鿿]/.test(m)) return m;
  console.error(`[${where}]`, m || e);
  return fallback;
}
