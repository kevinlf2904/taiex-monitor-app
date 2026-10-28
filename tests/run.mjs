// 全部測試：排程解析（單元測試）＋瀏覽器測試；GitHub Actions 的 ci.yml 也是跑這支
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const files = [`${dir}unit.test.mjs`, `${dir}sim.test.mjs`, `${dir}watch-hot.test.mjs`, `${dir}limit.test.mjs`, `${dir}sync.test.mjs`, `${dir}live-state.test.mjs`, ...readdirSync(`${dir}e2e`).filter(f => f.endsWith(".test.mjs")).map(f => `${dir}e2e/${f}`)];
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) {
  const combined = (r.stdout || "") + "\n" + (r.stderr || "");
  const failMatches = combined.match(/(✖[^\n]+\n(?:\s+[^\n]+\n){1,15})/g) || [];
  for (const m of failMatches.slice(0, 5)) {
    const cleanMsg = m.replace(/[\r\n]+/g, " ").slice(0, 500);
    console.log(`::error title=Test Failure::${cleanMsg}`);
  }
}
process.exit(r.status ?? 1);
