// AI 市場研究：送給 AI 的資料包含四個工作區的摘要（附日期）、固定格式的提問；結果標整理時間、推論分開標示、
// 同一天切換或重畫不用重新整理（sessionStorage），換日不還原；盤中超過 30 分鐘提醒重新整理
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, open } from "./_harness.mjs";

const S = await serve(), B = await (await chromium()).launch();
test.after(async () => { await B.close(); S.close(); });
const REPLY = "【結論】推論：盤勢偏空震盪，主要是外資賣超。\n【依據】加權 -2.9%（2026-10-26）。\n【風險與反證】櫃買跌幅較大。\n【接下來觀察】守不守得住支撐。\n【資料限制】無";

test("AI 市場研究：送出的資料有四個工作區的摘要與日期，提問是固定格式；結果分段、標整理時間與推論", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 390, touch: true, time: new Date("2026-10-26T10:00:00+08:00") });
  let body = null;
  await ctx.route("**/api/chat", r => { body = JSON.parse(r.request().postData() || "{}"); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, text: REPLY }) }); });
  await p.evaluate(() => { try { sessionStorage.clear(); } catch {} W.tdPh = null; W.tdAI = null; setLt("today"); renderList(); });
  await p.click('#lx [data-tx="tdai"]');
  await p.waitForFunction(() => /AI 整理於/.test(document.querySelector("#lx .mc-ai-panel .caibox")?.textContent || ""));
  for (const k of ["【資料時間】", "【加權與櫃買】", "【市場廣度】", "【法人資金流向】", "【技術攻防】", "【美股與總經】", "KLineLab 今日重點"]) assert.ok(body.context.includes(k), "資料有 " + k);
  assert.ok(body.context.indexOf("【資料時間】") < body.context.indexOf("KLineLab 今日重點"), "四個工作區的摘要放在前面（伺服器只收前 6000 字）");
  const q = body.messages[0].content; for (const k of ["【結論】", "【依據】", "【風險與反證】", "【接下來觀察】", "【資料限制】", "推論：", "盤中"]) assert.ok(q.includes(k), "提問有 " + k);
  assert.equal(body.model, "lite");
  const r = await p.evaluate(() => { const b = document.querySelector("#lx .mc-ai-panel .caibox"); return { h: b.querySelectorAll(".cai-h").length, inf: b.querySelectorAll(".cai-inf").length, meta: b.querySelector(".cai-meta")?.textContent, old: !!b.querySelector(".cai-old") }; });
  assert.equal(r.h, 5); assert.equal(r.inf, 1); assert.match(r.meta, /AI 整理於 10:00/); assert.equal(r.old, false);
  await ctx.close(); assert.deepEqual(errs, []);
});

test("AI 市場研究：同一天重畫會還原上次結果；盤中超過 30 分鐘提醒重新整理；換日不還原", async () => {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width: 1280, time: new Date("2026-10-26T10:40:00+08:00") });
  await p.evaluate(r => { sessionStorage.setItem("kline:mcai:v1", JSON.stringify({ text: r, at: Date.parse("2026-10-26T10:00:00+08:00"), d: "2026-10-26", basis: "2026-10-26 10:00:00" })); W.tdPh = null; W.tdAI = null; setLt("today"); renderList(); }, REPLY);
  const a = await p.evaluate(() => { const b = document.querySelector("#lx .mc-ai-panel .caibox"); return { ok: /盤勢偏空震盪/.test(b?.textContent || ""), old: !!b?.querySelector(".cai-old"), btn: document.querySelector("#lx [data-mc-ai]")?.textContent }; });
  assert.deepEqual(a, { ok: true, old: true, btn: "重新整理" });
  await p.evaluate(() => { const x = JSON.parse(sessionStorage.getItem("kline:mcai:v1")); x.d = "2026-10-23"; sessionStorage.setItem("kline:mcai:v1", JSON.stringify(x)); W.tdAI = null; renderList(); });
  assert.equal(await p.evaluate(() => /盤勢偏空震盪/.test(document.querySelector("#lx .mc-ai-panel")?.textContent || "")), false, "換日不還原");
  await ctx.close(); assert.deepEqual(errs, []);
});
