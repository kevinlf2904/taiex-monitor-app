// 全部測試：排程解析（單元測試）＋瀏覽器測試；GitHub Actions 的 ci.yml 也是跑這支
// 用法：node tests/run.mjs            全部（本機完整重現用）
//       node tests/run.mjs --unit     只跑單元測試（不需要瀏覽器）
//       node tests/run.mjs --e2e=2/3  只跑瀏覽器測試的第 2 份（共 3 份）；CI 把瀏覽器測試分成幾份平行跑（#312 PR C）
// 分份規則：tests/e2e/ 的檔案依檔名排序後輪流分配，每個檔案剛好落在一份；新加的檔案自動分到某一份，不會漏跑。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
export const UNIT = [`${dir}unit.test.mjs`, `${dir}sim.test.mjs`, `${dir}watch-hot.test.mjs`, `${dir}limit.test.mjs`, `${dir}t86-columns.test.mjs`, `${dir}podcast-limits.test.mjs`, `${dir}adx-shared.test.mjs`, `${dir}bfi82u.test.mjs`, `${dir}vol-indicators.test.mjs`, `${dir}err-text.test.mjs`, `${dir}chat-context.test.mjs`, `${dir}flow-trades.test.mjs`, `${dir}claude-switch.test.mjs`, `${dir}sync.test.mjs`, `${dir}live-state.test.mjs`, `${dir}market-retry.test.mjs`, `${dir}market-date-guard.test.mjs`, `${dir}intraday-amount.test.mjs`, `${dir}datasrc.test.mjs`, `${dir}gemini-models.test.mjs`, `${dir}safe.test.mjs`, `${dir}port-risk.test.mjs`, `${dir}portfolio.test.mjs`, `${dir}adj-price.test.mjs`, `${dir}recon.test.mjs`, `${dir}ledger.test.mjs`, `${dir}ledger-import.test.mjs`, `${dir}perf.test.mjs`, `${dir}overview.test.mjs`, `${dir}pfsrc.test.mjs`, `${dir}acceptance.test.mjs`, `${dir}rebal.test.mjs`, `${dir}report.test.mjs`, `${dir}taxrpt.test.mjs`, `${dir}thesis.test.mjs`, `${dir}divcal.test.mjs`, `${dir}stress.test.mjs`, `${dir}margin.test.mjs`, `${dir}fx.test.mjs`, `${dir}alloc.test.mjs`, `${dir}research.test.mjs`, `${dir}tpex-ic.test.mjs`, `${dir}signal-study.test.mjs`, `${dir}pr-guard.test.mjs`, `${dir}run-shard.test.mjs`, `${dir}pr-guard-run.test.mjs`, `${dir}version-guard.test.mjs`, `${dir}codeowners.test.mjs`, `${dir}data-push-token.test.mjs`, `${dir}token-usage.test.mjs`, `${dir}csv-import.test.mjs`];
export const e2eFiles = () => readdirSync(`${dir}e2e`).filter(f => f.endsWith(".test.mjs")).sort().map(f => `${dir}e2e/${f}`);
// 第 k 份（1 起算，共 n 份）：排序後第 i 個檔案給第 (i mod n) + 1 份
export function shard(list, k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 1 || k > n) throw new Error(`分份參數不對：${k}/${n}`);
  return list.filter((_, i) => i % n === k - 1);
}
// tests/ 底下的單元測試檔一定要登記在 UNIT（AGENTS.md「測試與品質」）；沒登記就失敗，避免漏跑
export const unregistered = () => readdirSync(dir).filter(f => f.endsWith(".test.mjs")).map(f => `${dir}${f}`).filter(f => !UNIT.includes(f));
// 參數只接受 --unit 或一個 --e2e=<正整數>/<正整數>；打錯（例如 --e2e=1/3/4、--unti）直接失敗，不會默默跑別的份
export function pick(argv) {
  const bad = argv.filter(a => a !== "--unit" && !a.startsWith("--e2e="));
  if (bad.length) throw new Error(`不認得的參數：${bad.join(" ")}（只接受 --unit 或 --e2e=<第幾份>/<共幾份>）`);
  const es = argv.filter(a => a.startsWith("--e2e=")), unit = argv.includes("--unit");
  if (unit && es.length) throw new Error("--unit 和 --e2e= 不能同時用");
  if (es.length > 1 || argv.filter(a => a === "--unit").length > 1) throw new Error("同一個參數只能給一次");
  if (unit) return UNIT;
  if (es.length) {
    const m = es[0].match(/^--e2e=([1-9]\d*)\/([1-9]\d*)$/);
    if (!m) throw new Error(`分份參數不對：${es[0].slice(6)}（格式 <第幾份>/<共幾份>）`);
    return shard(e2eFiles(), Number(m[1]), Number(m[2]));
  }
  return [...UNIT, ...e2eFiles()];
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const miss = unregistered();
  if (miss.length) { console.error(`這些單元測試檔沒有登記在 tests/run.mjs 的 UNIT：${miss.join("、")}`); process.exit(1); }
  const files = pick(process.argv.slice(2));
  if (!files.length) { console.error("這一份沒有任何測試檔"); process.exit(1); }
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
