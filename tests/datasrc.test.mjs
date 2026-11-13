// 排程資料改從 GitHub 讀（learner/datasrc.js）與 Vercel 略過只改資料的部署（scripts/vercel-ignore.mjs）：全部用假 fetch／假 git，不連外部網站
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dataOnly, decide, errLine, fetchPlans } from "../scripts/vercel-ignore.mjs";

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
  const P = "9a8e4c241a57421078f2046c10a358825411e6c3";
  const git = out => a => { if (a[0] !== "diff") return ""; if (out instanceof Error) throw out; return out; };
  assert.equal(decide({ prev: P, git: git("learner/data/x.json\nlearner/data/y/z.json\n") }).skip, true);
  assert.equal(decide({ prev: P, git: git("learner/data/x.json\nscripts/macro.mjs\n") }).skip, false, "排程腳本改了要部署");
  assert.equal(decide({ prev: "", git: git("learner/data/x.json") }).skip, false, "沒有上次部署的 SHA");
  assert.equal(decide({ prev: "--upload-pack=x", git: git("learner/data/x.json") }).skip, false, "SHA 格式不對不交給 git");
  assert.equal(decide({ prev: P, git: git(new Error("bad object")) }).skip, false, "抓不到上次部署的提交");
  let n = 0; const deepen = a => { if (a[0] === "fetch") return ""; if (++n === 1) throw new Error("bad object"); return "learner/data/x.json"; };
  assert.equal(decide({ prev: P, git: deepen }).skip, true, "淺層 clone：抓到上次部署的提交後比得出來");
});

test("vercel-ignore：淺層 clone 依序從 origin、公開 GitHub、往前 200 個提交抓上次部署的提交", () => {
  const P = "9a8e4c241a57421078f2046c10a358825411e6c3";
  const env = { VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_REPO_OWNER: "kevinlf2904", VERCEL_GIT_REPO_SLUG: "taiex-monitor-app" };
  assert.deepEqual(fetchPlans(P, env).map(a => a.slice(-2).join(" ")), [`origin ${P}`, `https://github.com/kevinlf2904/taiex-monitor-app.git ${P}`, "--quiet --deepen=200"]);
  assert.equal(fetchPlans(P, {}).length, 2, "不是 GitHub（或沒有 repo 資訊）就不試公開網址");
  assert.equal(fetchPlans(P, { ...env, VERCEL_GIT_REPO_SLUG: "a b;rm" }).length, 2, "repo 名稱怪異不組網址");
  // origin 抓失敗、公開 GitHub 抓得到：只抓那一個提交就能比
  const calls = []; let have = false;
  const g = a => {
    calls.push(a.join(" "));
    if (a[0] === "diff") { if (!have) throw new Error(`fatal: bad object ${P}`); return "learner/data/a.json\n"; }
    if (a.includes("origin")) throw Object.assign(new Error("x"), { stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n" });
    have = true; return "";
  };
  const r = decide({ prev: P, head: "HEAD", env, git: g });
  assert.equal(r.skip, true, r.why);
  assert.equal(calls.filter(c => c.includes("--deepen")).length, 0, "抓到了就不再往前抓 200 個");
  // 全部失敗：照常部署，原因寫進紀錄，網址遮掉
  const all = decide({ prev: P, env, git: a => { throw Object.assign(new Error("x"), { stderr: "fatal: unable to access 'https://x-access-token:abc@github.com/o/r.git/': 403\n" }); } });
  assert.equal(all.skip, false);
  assert.match(all.why, /從 origin 抓.*從 GitHub 抓.*往前抓 200 個/);
  assert.doesNotMatch(all.why, /abc|x-access-token/, "遠端網址可能帶權杖，不能寫進紀錄");
  assert.equal(errLine(""), "未知錯誤");
  assert.equal(errLine({ stderr: "\nfatal: bad object x\nmore" }), "fatal: bad object x", "只留第一行非空白");
});


const MARKET_CENTER_SRC = await readFile(new URL("../learner/market-center.js", import.meta.url), "utf8");
test("今日市場決策中心：五工作區定義穩定，無效工作區回到總覽", () => {
  const window = {};
  vm.runInNewContext(MARKET_CENTER_SRC, { window });
  const api = window.KLMarketCenter;
  assert.ok(api, "模組應在 window 暴露整合 API");
  assert.deepEqual(Array.from(api.workspaces, x => x.id), ["overview", "capital", "global", "research", "technical"]);
  assert.equal(api.normalizeWorkspace("capital"), "capital");
  assert.equal(api.normalizeWorkspace("unknown"), "overview");
  const W = {};
  const state = api.ensureState(W);
  assert.equal(state.workspace, "overview");
  assert.equal(state.selectedSector, null);
  assert.equal(state.selectedStock, null);
  assert.equal(state.analysisDate, null);
  assert.equal(api.ensureState(W), state, "重複初始化應沿用同一份執行期狀態");
  W.marketCenter.workspace = "not-a-workspace";
  assert.equal(api.ensureState(W).workspace, "overview");
  assert.equal(W.store, undefined, "整合狀態不得自行寫入既有使用者儲存層");
});
