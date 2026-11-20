// scripts/token-usage.mjs：解析 session 紀錄檔的 token 用量（固定假資料，不讀真實紀錄）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSteps, sumSteps, render, loadSteps, findSessionFile } from "../scripts/token-usage.mjs";

// 真實紀錄的最終紀錄都有 stop_reason；測試預設也帶上，缺最終紀錄的情況另外測
const line = (id, time, u, stop = "end_turn") => JSON.stringify({ timestamp: time, message: { id, model: "m", stop_reason: stop, usage: u } });
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
  assert.match(r, /Session 累計\*\*（紀錄檔，不含 Claude Code 背景請求）：2 步.*合計 3,172/);
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
  // 其他專案有較新的紀錄也不能拿來用：目前目錄沒有對應紀錄就回傳 null
  const other = path.join(home, ".claude", "projects", "-other-repo");
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, "s9.jsonl"), line("z", "2026-11-20T03:00:00Z", U1));
  assert.equal(findSessionFile("/work/no-such", home), null, "不改用其他專案的紀錄");
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
  const q = parseQuota([raw, [{ t: "2026-11-20T02:00:10Z", h5: 0.2, d7: 0.38, h5r: 1795147200, d7r: 1795554000 }], raw]);
  assert.deepEqual(q.map(e => e.h5), [0.14, 0.16, 0.2], "合併、去重、依時間排序");
  assert.equal(q[0].h5r, 1795147200);
  assert.deepEqual(parseQuota({ nothing: 1 }), []);
  const steps = parseSteps([line("a", "2026-11-20T02:00:00Z", U1), line("b", "2026-11-20T02:00:05Z", U2), line("c", "2026-11-20T02:00:07Z", U2), line("d", "2026-11-20T02:00:20Z", U2)].join("\n"));
  assert.deepEqual(attachQuota(steps, q).map(s => s.quota && s.quota.h5), [0.14, 0.16, 0.2, 0.2], "沒有新事件就沿用");
  const r = render(steps, 2, q);
  assert.match(r, /額度 5h／7d/);
  assert.match(r, /\| 3 \| 10:00:07 \|.*\| 20%／38% \|/);
  assert.match(r, /5 小時 目前 20%｜本段 \+4｜session \+6｜重置 11\/20 /);
  assert.match(r, /7 天 目前 38%｜本段 \+1｜session \+2/);
  assert.doesNotMatch(render(steps, 0), /額度/, "沒給額度資料就不顯示額度欄");
});

test("額度事件時間戳與下一步相同時，歸給下一步（半開區間）", async () => {
  const { parseQuota, attachQuota } = await import("../scripts/token-usage.mjs");
  const steps = parseSteps([line("a", "2026-11-20T02:00:00Z", U1), line("b", "2026-11-20T02:00:05Z", U2)].join("\n"));
  const q = parseQuota([{ t: "2026-11-20T02:00:01Z", h5: 0.1, d7: 0.3, h5r: 100, d7r: 900 }, { t: "2026-11-20T02:00:05Z", h5: 0.2, d7: 0.3, h5r: 100, d7r: 900 }]);
  assert.deepEqual(attachQuota(steps, q).map(s => s.quota.h5), [0.1, 0.2]);
  assert.match(render(steps, 1, q), /5 小時 目前 20%｜本段 \+10｜/, "本段起點不含第二步同時間戳的事件");
});

test("真實紀錄檔片段（Claude Code 2.1.329，已去除內容）：一則回應多行（思考／文字／工具）usage 相同，取一次", () => {
  const steps = parseSteps(fs.readFileSync(new URL("./fixtures/token-usage-session.jsonl", import.meta.url), "utf8"));
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map(s => s.output), [405, 248, 1088]);
  assert.deepEqual(steps.map(s => s.thinking), [230, 0, 186]);
  const t = sumSteps(steps);
  assert.deepEqual([t.cacheWrite, t.cacheRead, t.output], [51579, 289068, 1741]);
  assert.doesNotMatch(render(steps), /可能低估/);
});

test("輸出 ≤2 的步驟要警告可能是快照；伺服器統計可對照並標明含背景請求", async () => {
  const { parseServerUsage } = await import("../scripts/token-usage.mjs");
  const steps = parseSteps([line("a", "2026-11-20T02:00:00Z", { ...U2, output_tokens: 1 }), line("b", "2026-11-20T02:00:05Z", U2)].join("\n"));
  const srv = parseServerUsage({ ccr: { external_metadata: { usage: { cache_read_tokens: 9000, cache_write_tokens: 50, input_tokens: 40, output_tokens: 700, cost_usd: 1.2 } } } });
  assert.deepEqual(srv, { input: 40, cacheWrite: 50, cacheRead: 9000, output: 700 });
  assert.equal(parseServerUsage({ x: 1 }), null);
  const r = render(steps, 0, [], srv);
  assert.match(r, /有 1 步的輸出 ≤2 token/);
  assert.match(r, /伺服器統計\*\*（含背景請求.*合計 9,790/);
  assert.match(r, /紀錄檔，不含 Claude Code 背景請求/);
});

test("額度跨重置：不相減成負數，改為逐段累計並註明重置次數", async () => {
  const { parseQuota, quotaIncrease } = await import("../scripts/token-usage.mjs");
  const q = parseQuota([
    { t: "2026-11-20T02:00:00Z", h5: 0.14, d7: 0.36, h5r: 100, d7r: 900 },
    { t: "2026-11-20T03:00:00Z", h5: 0.28, d7: 0.38, h5r: 100, d7r: 900 },
    { t: "2026-11-20T04:08:00Z", h5: 0.01, d7: 0.38, h5r: 200, d7r: 900 },
    { t: "2026-11-20T14:04:00Z", h5: 0.00, d7: 0.39, h5r: 300, d7r: 900 },
    { t: "2026-11-20T14:05:00Z", h5: 0.05, d7: 0.39, h5r: 300, d7r: 900 },
  ]);
  assert.deepEqual(quotaIncrease(q, q[0], "h5", "h5r"), { inc: 14 + 1 + 0 + 5, resets: 2, guessed: 0 });
  assert.deepEqual(quotaIncrease(q, q[0], "d7", "d7r"), { inc: 3, resets: 0, guessed: 0 });
  const steps = parseSteps(line("a", "2026-11-20T14:04:30Z", U1));
  const r = render(steps, 0, q);
  assert.match(r, /5 小時 目前 5%｜本段 \+5｜session \+20，中間重置 2 次/);
  assert.doesNotMatch(r, /\+-|（-/, "不會出現負的增量");
});

test("子代理串流中途紀錄（stop_reason:null、輸出偏低）與最終紀錄同 id：取最終 usage；只有中途紀錄時標示不完整", async () => {
  const { loadSteps } = await import("../scripts/token-usage.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tok-sub-"));
  const dir = path.join(home, "s1", "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(home, "s1.jsonl");
  fs.writeFileSync(f, line("main", "2026-11-20T02:00:00Z", U1));
  const mid = { ...U2, output_tokens: 9 }, fin = { ...U2, output_tokens: 640 };
  fs.writeFileSync(path.join(dir, "agent-a.jsonl"), [
    // 中途紀錄先出現、最終紀錄在後
    line("s1", "2026-11-20T02:00:01Z", mid, null), line("s1", "2026-11-20T02:00:02Z", fin, "tool_use"),
    // 最終紀錄先出現、之後又有一行中途紀錄：仍取最終紀錄
    line("s2", "2026-11-20T02:00:03Z", fin, "end_turn"), line("s2", "2026-11-20T02:00:04Z", mid, null),
    // 只有中途紀錄
    line("s3", "2026-11-20T02:00:05Z", mid, null),
  ].join("\n"));
  const steps = loadSteps(f);
  const by = Object.fromEntries(steps.map(s => [s.id, s]));
  assert.equal(by.s1.output, 640);
  assert.equal(by.s2.output, 640);
  assert.equal(by.s3.output, 9);
  assert.deepEqual(steps.filter(s => s.incomplete).map(s => s.id), ["s3"]);
  const r = render(steps);
  assert.match(r, /有 1 步沒有最終紀錄（stop_reason 為空），其中子代理 1 步/);
  assert.doesNotMatch(r, /≤2 token/, "輸出 9 不會被 ≤2 的檢查抓到，要靠 stop_reason");
  fs.rmSync(home, { recursive: true, force: true });
});

test("紀錄來自 2.1.307 之前的 Claude Code 要警告子代理輸出可能低估", async () => {
  const { versionLess } = await import("../scripts/token-usage.mjs");
  assert.equal(versionLess("2.1.306", "2.1.307"), true);
  assert.equal(versionLess("2.1.329", "2.1.307"), false);
  assert.equal(versionLess("2.2.0", "2.1.307"), false);
  const old = JSON.stringify({ timestamp: "2026-11-20T02:00:00Z", version: "2.1.300", message: { id: "x", stop_reason: "end_turn", usage: U1 } });
  assert.match(render(parseSteps(old)), /Claude Code 2\.1\.300（早於 2\.1\.307）/);
  assert.doesNotMatch(render(parseSteps(fs.readFileSync(new URL("./fixtures/token-usage-session.jsonl", import.meta.url), "utf8"))), /早於/);
});

test("額度事件缺重置時間：使用率下降視為重置、沒下降就相減，並註明是推斷", async () => {
  const { parseQuota, quotaIncrease } = await import("../scripts/token-usage.mjs");
  const q = parseQuota([
    { t: "2026-11-20T02:00:00Z", h5: 0.20 },
    { t: "2026-11-20T03:00:00Z", h5: 0.25 },
    { t: "2026-11-20T04:00:00Z", h5: 0.02 },
    { t: "2026-11-20T05:00:00Z", h5: 0.04, h5r: 500 },
  ]);
  assert.deepEqual(quotaIncrease(q, q[0], "h5", "h5r"), { inc: 5 + 2 + 2, resets: 1, guessed: 3 });
  assert.match(render(parseSteps(line("a", "2026-11-20T05:30:00Z", U1)), 0, q), /session \+9，中間重置 1 次（3 段缺重置時間，依使用率是否下降判斷）/);
});

test("真實子代理紀錄（Claude Code 2.1.329，已去除內容）：每行都有最終 stop_reason，去重後取最終 usage、不標示不完整", async () => {
  const { loadSteps } = await import("../scripts/token-usage.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tok-real-"));
  fs.mkdirSync(path.join(home, "s1", "subagents"), { recursive: true });
  const f = path.join(home, "s1.jsonl");
  fs.copyFileSync(new URL("./fixtures/token-usage-session.jsonl", import.meta.url), f);
  fs.copyFileSync(new URL("./fixtures/token-usage-subagent.jsonl", import.meta.url), path.join(home, "s1", "subagents", "agent-a.jsonl"));
  const steps = loadSteps(f);
  const sub = steps.filter(s => s.source !== "主對話");
  assert.equal(steps.length, 6);
  assert.deepEqual(sub.map(s => [s.output, s.thinking, s.final]), [[318, 228, true], [121, 0, true], [73, 0, true]]);
  assert.ok(sub.every(s => s.version === "2.1.329"));
  const r = render(steps);
  assert.match(r, /\| 來源 \|/);
  assert.doesNotMatch(r, /⚠️/, "真實紀錄完整，不應出現任何警告");
  fs.rmSync(home, { recursive: true, force: true });
});
