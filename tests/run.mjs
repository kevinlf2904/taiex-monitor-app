// 全部測試：排程解析（單元測試）＋瀏覽器測試；GitHub Actions 的 ci.yml 也是跑這支
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const files = [`${dir}unit.test.mjs`, `${dir}sim.test.mjs`, `${dir}watch-hot.test.mjs`, `${dir}limit.test.mjs`, `${dir}sync.test.mjs`, `${dir}live-state.test.mjs`, `${dir}market-retry.test.mjs`, `${dir}intraday-amount.test.mjs`, `${dir}datasrc.test.mjs`, `${dir}gemini-models.test.mjs`, `${dir}safe.test.mjs`, `${dir}port-risk.test.mjs`, `${dir}portfolio.test.mjs`, `${dir}adj-price.test.mjs`, `${dir}ledger.test.mjs`, `${dir}perf.test.mjs`, `${dir}overview.test.mjs`, `${dir}pfsrc.test.mjs`, `${dir}acceptance.test.mjs`, `${dir}rebal.test.mjs`, `${dir}report.test.mjs`, `${dir}thesis.test.mjs`, `${dir}divcal.test.mjs`, `${dir}stress.test.mjs`, `${dir}margin.test.mjs`, `${dir}fx.test.mjs`, `${dir}alloc.test.mjs`, `${dir}research.test.mjs`, ...readdirSync(`${dir}e2e`).filter(f => f.endsWith(".test.mjs")).sort().map(f => `${dir}e2e/${f}`)];
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
