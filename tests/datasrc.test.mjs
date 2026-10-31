// 排程資料改從 GitHub 讀（learner/datasrc.js）與 Vercel 略過只改資料的部署（scripts/vercel-ignore.mjs）：全部用假 fetch／假 git，不連外部網站
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dataOnly, decide } from "../scripts/vercel-ignore.mjs";

const SRC = await readFile(new URL("../learner/datasrc.js", import.meta.url), "utf8");
const RAW = "https://raw.githubusercontent.com/kevinlf2904/taiex-monitor-app/main/learner/data/";
// 在假瀏覽器裡載入 datasrc.js；fetchImpl(url) 回假回應，calls 記下每次請求的網址
function load(href, fetchImpl) {
  const calls = [], loc = new URL(href);
  const ctx = { URL, location: loc, calls, fetch: async (u, init) => { calls.push(String(u)); return fetchImpl(String(u), init); } };
  ctx.self = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return ctx;
}
const res = (ok, body) => ({ ok, status: ok ? 200 : 404, json: async () => body });

test("datasrc：網站上（https）learner/data/ 改問 GitHub main，其他請求不動", () => {
  const c = load("https://kline-school.vercel.app/learner/watch.html", () => res(true, {}));
  assert.equal(c.dataSrc("data/market/breadth.json?t=1"), RAW + "market/breadth.json?t=1");
  assert.equal(c.dataSrc("/learner/data/f13.json"), RAW + "f13.json");
  assert.equal(c.dataSrc("/api/market"), null, "API 不改");
  assert.equal(c.dataSrc("version.json"), null, "其他靜態檔不改");
  assert.equal(c.dataSrc("https://example.com/learner/data/x.json"), null, "別的網站不改");
});

test("datasrc：本機與測試（http://localhost）照舊讀網站上的檔案", () => {
  for (const h of ["http://localhost:8080/learner/watch.html", "http://127.0.0.1:3000/learner/", "https://localhost/learner/"]) assert.equal(load(h, () => res(true, {})).dataSrc("data/f13.json"), null, h);
});

test("datasrc：先讀 GitHub；GitHub 404 或連不上時退回網站上的那份", async () => {
  const ok = load("https://kline-school.vercel.app/learner/", u => res(true, { from: u.startsWith(RAW) ? "github" : "site" }));
  assert.equal((await (await ok.fetch("data/f13.json")).json()).from, "github"); assert.deepEqual(ok.calls, [RAW + "f13.json"]);
  const miss = load("https://kline-school.vercel.app/learner/", u => res(!u.startsWith(RAW), { from: "site" }));
  assert.equal((await (await miss.fetch("data/new.json")).json()).from, "site"); assert.equal(miss.calls.length, 2, "GitHub 404 → 網站");
  const down = load("https://kline-school.vercel.app/learner/", u => { if (u.startsWith(RAW)) throw new TypeError("Failed to fetch"); return res(true, { from: "site" }); });
  assert.equal((await (await down.fetch("data/f13.json")).json()).from, "site", "GitHub 連不上 → 網站（離線時再由 sw.js 快取接手）");
  const api = load("https://kline-school.vercel.app/learner/", () => res(true, {}));
  await api.fetch("/api/market"); await api.fetch("data/f13.json", { method: "POST" }); assert.deepEqual(api.calls, ["/api/market", "data/f13.json"], "API 與非 GET 不改");
});

test("vercel-ignore：只改 learner/data/ 才略過部署；其他檔、判斷不了都照常部署", () => {
  assert.equal(dataOnly(["learner/data/a.json", "learner/data/market/b.json"]), true);
  assert.equal(dataOnly(["learner/data/a.json", "learner/watch.html"]), false);
  assert.equal(dataOnly(["learner/datasrc.js"]), false, "learner/datasrc.js 不是資料");
  assert.equal(dataOnly([]), false);
  const git = out => a => { if (a[0] !== "diff") return ""; if (out instanceof Error) throw out; return out; };
  assert.equal(decide({ prev: "a", git: git("learner/data/x.json\nlearner/data/y/z.json\n") }).skip, true);
  assert.equal(decide({ prev: "a", git: git("learner/data/x.json\nscripts/macro.mjs\n") }).skip, false, "排程腳本改了要部署");
  assert.equal(decide({ prev: "", git: git("learner/data/x.json") }).skip, false, "沒有上次部署的 SHA");
  assert.equal(decide({ prev: "a", git: git(new Error("bad object")) }).skip, false, "歷史不夠深");
  let n = 0; const deepen = a => { if (a[0] === "fetch") return ""; if (++n === 1) throw new Error("bad object"); return "learner/data/x.json"; };
  assert.equal(decide({ prev: "a", git: deepen }).skip, true, "淺層 clone：往前多抓歷史後比得出來");
});


const MARKET_CENTER_SRC = await readFile(new URL("../learner/market-center.js", import.meta.url), "utf8");
test("今日市場決策中心：五工作區定義穩定，無效工作區回到總覽", () => {
  const window = {};
  vm.runInNewContext(MARKET_CENTER_SRC, { window });
  const api = window.KLMarketCenter;
  assert.ok(api, "模組應在 window 暴露整合 API");
  assert.deepEqual(api.workspaces.map(x => x.id), ["overview", "capital", "global", "research", "technical"]);
  assert.equal(api.normalizeWorkspace("capital"), "capital");
  assert.equal(api.normalizeWorkspace("unknown"), "overview");
  const W = {};
  const state = api.ensureState(W);
  assert.equal(state.workspace, "overview");
  assert.equal(state.selectedSector, null);
  assert.equal(state.selectedStock, null);
  assert.equal(state.analysisDate, null);
  W.marketCenter.workspace = "not-a-workspace";
  assert.equal(api.ensureState(W).workspace, "overview");
  assert.equal(W.store, undefined, "整合狀態不得自行寫入既有使用者儲存層");
});
