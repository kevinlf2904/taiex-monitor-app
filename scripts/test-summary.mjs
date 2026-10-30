// 跑完整測試（tests/run.mjs），只印摘要：通過／失敗數，以及每個失敗項目的名稱與錯誤前幾行（給 AI 協作者用，減少輸出量）。
// 結束碼和 tests/run.mjs 一樣，CI 仍直接跑 tests/run.mjs。完整輸出存在 os.tmpdir() 的 klinelab-test.log。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = fileURLToPath(new URL("../tests/run.mjs", import.meta.url)), log = join(tmpdir(), "klinelab-test.log");
const p = spawn(process.execPath, [run], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
let out = "";
p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (out += d));
p.on("close", code => {
  writeFileSync(log, out);
  const L = out.split("\n"), sum = L.filter(l => /^# (tests|pass|fail|cancelled|skipped|todo) /.test(l)).slice(-6);
  const fails = [];
  L.forEach((l, i) => { if (/^not ok /.test(l)) fails.push([l, ...L.slice(i + 1, i + 25).filter(x => /error:|expected|actual|Error|at .*test\.mjs/.test(x)).slice(0, 6)].join("\n")); });
  console.log(sum.join("\n") || "（沒有摘要行，可能測試沒跑起來；看完整輸出）");
  if (fails.length) console.log("\n失敗項目：\n" + fails.join("\n\n"));
  console.log(`\n完整輸出：${log}`);
  process.exit(code ?? 1);
});
