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

test("額度：接受 list_events 原始回應與精簡陣列；每步沿用下一步之前最新的使用率；本段與 session 增量", async () => {
  const { parseQuota, attachQuota } = await import("../scripts/token-usage.mjs");
  const ev = (t, h5, d7) => ({ created_at: t, rate_limit_event: { internal_anthropic_catchall: { rate_limit_info: { unifiedWindows: { five_hour: { utilization: h5, resetsAt: 1795147200 }, seven_day: { utilization: d7, resetsAt: 1795554000 } } } } } });
  const raw = { ccr: { data: [ev("2026-11-20T02:00:01Z", 0.14, 0.36), ev("2026-11-20T02:00:06Z", 0.16, 0.37)] } };
  const q = parseQuota([raw, [{ t: "2026-11-20T02:00:10Z", h5: 0.2, d7: 0.38 }], raw]);
  assert.deepEqual(q.map(e => e.h5), [0.14, 0.16, 0.2], "合併、去重、依時間排序");
  assert.equal(q[0].h5r, 1795147200);
  assert.deepEqual(parseQuota({ nothing: 1 }), []);
  const steps = parseSteps([line("a", "2026-11-20T02:00:00Z", U1), line("b", "2026-11-20T02:00:05Z", U2), line("c", "2026-11-20T02:00:07Z", U2), line("d", "2026-11-20T02:00:20Z", U2)].join("\n"));
  assert.deepEqual(attachQuota(steps, q).map(s => s.quota && s.quota.h5), [0.14, 0.16, 0.2, 0.2], "沒有新事件就沿用");
  const r = render(steps, 2, q);
  assert.match(r, /額度 5h／7d/);
  assert.match(r, /\| 3 \| 10:00:07 \|.*\| 20%／38% \|/);
  assert.match(r, /5 小時 20%｜本段 16%→20%（\+4）｜session 14%→20%（\+6）｜重置 11\/20 /);
  assert.match(r, /7 天 38%｜本段 37%→38%（\+1）/);
  assert.doesNotMatch(render(steps, 0), /額度/, "沒給額度資料就不顯示額度欄");
});
