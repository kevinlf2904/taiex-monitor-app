// scripts/token-usage.mjs：解析 session 紀錄檔的 token 用量（固定假資料，不讀真實紀錄）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSteps, sumSteps, render, loadSteps, findSessionFile } from "../scripts/token-usage.mjs";

const line = (id, time, u) => JSON.stringify({ timestamp: time, message: { id, model: "m", usage: u } });
const U1 = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50, output_tokens_details: { thinking_tokens: 20 } };
const U2 = { input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 2000, output_tokens: 7 };

test("同一 message.id 重複出現只算一次；壞行、沒有 usage 的行略過", () => {
  const text = [line("a", "2026-11-20T02:00:00Z", U1), line("a", "2026-11-20T02:00:01Z", U1), "{壞掉", JSON.stringify({ type: "user", message: { content: "hi" } }), line("b", "2026-11-20T02:00:05Z", U2), ""].join("\n");
  const steps = parseSteps(text);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].thinking, 20);
  assert.equal(steps[1].thinking, 0, "沒有 output_tokens_details 時思考算 0");
  const t = sumSteps(steps);
  assert.deepEqual([t.input, t.cacheWrite, t.cacheRead, t.output, t.thinking, t.total, t.steps], [5, 110, 3000, 57, 20, 3172, 2]);
});

test("render：只列起始索引之後的明細，累計仍算全部；沒有新步驟時有提示", () => {
  const steps = parseSteps([line("a", "2026-11-20T02:00:00Z", U1), line("b", "2026-11-20T02:00:05Z", U2)].join("\n"));
  const r = render(steps, 1);
  assert.match(r, /第 2–2 步，共 1 步/);
  assert.match(r, /\| 2 \| 10:00:05 \|/, "時間換成台北時間");
  assert.doesNotMatch(r, /\| 1 \| 10:00:00/);
  assert.match(r, /Session 累計\*\*：2 步.*合計 3,172/);
  assert.match(render(steps, 2), /沒有新步驟/);
});

test("loadSteps 併入子代理紀錄並依時間排序；findSessionFile 找目前目錄對應的最新檔", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
  const cwd = "/work/my.repo";
  const dir = path.join(home, ".claude", "projects", "-work-my-repo");
  fs.mkdirSync(path.join(dir, "s1", "subagents"), { recursive: true });
  const f = path.join(dir, "s1.jsonl");
  fs.writeFileSync(f, line("a", "2026-11-20T02:00:00Z", U1) + "\n" + line("c", "2026-11-20T02:00:09Z", U2));
  fs.writeFileSync(path.join(dir, "s1", "subagents", "agent-x.jsonl"), line("b", "2026-11-20T02:00:05Z", U2));
  assert.equal(findSessionFile(cwd, home), f);
  const steps = loadSteps(f);
  assert.deepEqual(steps.map(s => s.id), ["a", "b", "c"]);
  assert.match(steps[1].source, /^子代理/);
  assert.match(render(steps), /\| 來源 \|/, "有子代理時表格多一欄來源");
  fs.rmSync(home, { recursive: true, force: true });
});
