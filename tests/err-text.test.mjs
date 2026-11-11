// 回給前端的錯誤說明（#262 SEC-07、#264 D5）：上游或套件丟出的英文原文（主機名稱、IP、程式內部欄位名稱）不能帶出去。
import test from "node:test";
import assert from "node:assert/strict";
import { errText } from "../api/_lib/_err.js";
import hot from "../api/_lib/hot.js";
import news from "../api/_lib/news.js";

const quiet = fn => async () => { const w = console.warn; const logs = []; console.warn = (...a) => logs.push(a.join(" ")); try { await fn(logs); } finally { console.warn = w; } };

test("errText：中文與 HTTP 狀態碼原樣；逾時、連線錯誤換成固定說法；其他英文原文不帶出去，只記日誌", quiet(logs => {
  assert.equal(errText(new Error("證交所暫時連不到")), "證交所暫時連不到", "我們自己寫的中文原樣");
  assert.equal(errText(new Error("HTTP 503")), "HTTP 503"); assert.equal(errText(new Error("KV HTTP 500")), "HTTP 500");
  assert.equal(errText(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), "逾時");
  assert.equal(errText(new Error("請求逾時")), "請求逾時", "中文原樣");
  assert.equal(errText(new Error("connect ECONNREFUSED 10.1.2.3:443")), "連線失敗");
  assert.equal(errText(new Error("getaddrinfo ENOTFOUND www.twse.com.tw")), "連線失敗");
  assert.equal(errText(new TypeError("fetch failed")), "連線失敗");
  assert.equal(errText(new TypeError("Cannot read properties of undefined (reading 'secretField')")), "暫時無法取得");
  assert.equal(errText("some raw string"), "暫時無法取得"); assert.equal(errText(null), "暫時無法取得"); assert.equal(errText(undefined), "暫時無法取得");
  assert.ok(logs.some(l => /secretField/.test(l)), "原文記在伺服器日誌：" + logs.join("｜"));
  assert.ok(!logs.some(l => /^\[errText\] HTTP 503/.test(l)) && !logs.some(l => /證交所暫時/.test(l)), "狀態碼與中文不用記");
}));

test("路由：熱門排行資料來源丟出程式內部錯誤 → 回「暫時無法取得」，不含原文", quiet(async () => {
  let out = null; const res = { status() { return this; }, setHeader() {}, json(v) { out = v; return this; } };
  await hot({ query: { type: "value" } }, res, { marketFetcher: async () => { throw new TypeError("Cannot read properties of undefined (reading 'rows')"); } });
  assert.equal(out.ok, false); assert.match(out.error, /拿不到成交值資料（暫時無法取得）/); assert.doesNotMatch(out.error, /Cannot read|rows/);
}));

test("路由：新聞抓不到（連線錯誤，訊息含主機名稱）→ 回「連線失敗」，不含主機名稱", quiet(async () => {
  const real = globalThis.fetch; globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND news.google.com"); };
  let out = null; const res = { status() { return this; }, setHeader() {}, json(v) { out = v; return this; } };
  try { await news({ query: { q: "台積電" } }, res); } finally { globalThis.fetch = real; }
  assert.equal(out.ok, false); assert.match(out.error, /拿不到新聞（連線失敗）/); assert.doesNotMatch(out.error, /news\.google|getaddrinfo/);
}));
