import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function syncRules() {
  const source = await fs.readFile(path.join(ROOT, "AGENTS.md"), "utf8");
  const target = path.join(ROOT, ".agent", "rules", "klinelab.md");
  await fs.writeFile(target, source, "utf8");
  return { source: "AGENTS.md", target: ".agent/rules/klinelab.md" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await syncRules();
    console.log(`已同步：${result.source} -> ${result.target}`);
  } catch (err) {
    console.error("同步規則失敗：", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
