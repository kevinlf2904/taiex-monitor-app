// AI 限流機制深度測試 (Phase 2 P1: 記憶體限流、容量淘汰、過期重置、併發與 KV 異常降級)
import test from "node:test";
import assert from "node:assert/strict";
import { aiLimit, limitsOf, memIncr, mem, AI_LIMITS } from "../api/_lib/_limit.js";

const req = ip => ({ headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

test("同一使用者達到限制後會被拒絕，不同使用者不受影響", async () => {
  mem.clear();
  const t = Date.parse("2026-10-27T10:00:00Z");

  // chat 本機記憶體限額為 20 (AI_LIMITS.chat[0] = 40，記憶體上限為一半 = 20)
  for (let i = 0; i < 20; i++) {
    const res = await aiLimit(req("192.168.1.10"), "chat", t);
    assert.equal(res, null, `第 ${i + 1} 次應成功通過`);
  }

  // 第 21 次應被拒絕
  const blocked = await aiLimit(req("192.168.1.10"), "chat", t);
  assert.match(blocked, /使用太頻繁了（每小時最多 20 次）/);

  // 不同使用者在同一時段不受影響
  const otherUser = await aiLimit(req("192.168.1.20"), "chat", t);
  assert.equal(otherUser, null, "不同使用者計數互不干擾，應成功通過");
});

test("過期計數可以正常重置", async () => {
  mem.clear();
  const t = Date.parse("2026-10-27T10:00:00Z");

  // 使用者達到上限
  for (let i = 0; i < 20; i++) {
    await aiLimit(req("192.168.1.30"), "chat", t);
  }
  assert.ok(await aiLimit(req("192.168.1.30"), "chat", t) !== null);

  // 跨過一小時（下一個小時）
  const nextHour = t + 3601 * 1000;
  const afterExpired = await aiLimit(req("192.168.1.30"), "chat", nextHour);
  assert.equal(afterExpired, null, "跨小時後限流計數應自動重置並允許請求");
});

test("memIncr: 建立超過 5,000 個不同鍵時，淘汰過期與舊項，絕不清空所有有效限流資料", async () => {
  mem.clear();
  const now = 1700000000000;

  // 1. 建立 100 個即將過期的鍵 (expire 在 now + 10 秒)
  for (let i = 0; i < 100; i++) {
    await memIncr(`exp:${i}`, 10, now);
  }

  // 2. 建立 4,900 個常規有效鍵 (expire 在 1 小時後)
  for (let i = 0; i < 4900; i++) {
    await memIncr(`active:${i}`, 3600, now);
  }

  assert.equal(mem.size, 5000, "當前總數應達到容量上限 5000");

  // 3. 時間推進 15 秒（前 100 個已過期）
  const futureNow = now + 15000;

  // 4. 新增第 5001 個鍵，應觸發過期清理
  await memIncr("newKey:1", 3600, futureNow);

  // 驗證過期項已被刪除，但有效項目完整保留
  assert.ok(!mem.has("exp:0"), "已過期的鍵應被清除");
  assert.ok(mem.has("active:0"), "未過期的有效限流資料不得被清除");
  assert.ok(mem.has("active:4899"), "新加入的有效鍵必須存在");
  assert.ok(mem.has("newKey:1"), "觸發清理後的新鍵必須存在");
  assert.ok(mem.size <= 5000, "Map 容量保持在健康範圍內");

  // 5. 測試極端容量負載：在沒有任何過期項情況下填滿並超過 5,000 鍵
  mem.clear();
  for (let i = 0; i < 5000; i++) {
    await memIncr(`persistent:${i}`, 3600, now);
  }
  assert.equal(mem.size, 5000);

  // 寫入額外 20 個鍵
  for (let i = 0; i < 20; i++) {
    await memIncr(`overflow:${i}`, 3600, now);
  }

  // 驗證最舊的項目被適度淘汰，但絕大部分有效資料與最新的資料都在，絕不是 mem.clear()
  assert.ok(mem.size > 4000, `有效資料數量 (${mem.size}) 不應歸零，絕不可清空全部 Map`);
  assert.ok(mem.has("overflow:19"), "最新寫入的計數必須存在");
  assert.ok(mem.has(`persistent:4999`), "高序號有效計數必須保留");
});

test("併發請求不會因競態條件錯誤計算", async () => {
  mem.clear();
  const k = "concurrent:test:user";
  const now = 1700000000000;

  // 同時發送 50 個併發累加請求
  const promises = Array.from({ length: 50 }, () => memIncr(k, 3600, now));
  const results = await Promise.all(promises);

  // 所有併發請求完成後，計數應精確為 50
  assert.equal(results.length, 50);
  assert.equal(Math.max(...results), 50, "最終計數值應精確反映所有併發增量");
  assert.equal(mem.get(k).count, 50, "記憶體內部計數應為 50");
});

test("KV 服務異常時採取明確且可觀測的安全降級策略", async () => {
  mem.clear();
  const t = Date.parse("2026-10-27T10:00:00Z");

  // 模擬 KV 拋出例外（網路中斷、超時、認證失效）
  let warnLogged = false;
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnLogged = true;
  };

  try {
    const brokenKV = async () => {
      throw new Error("KV connection timeout");
    };

    // 1. 預設模式：退回本機記憶體保守限制（每 IP 20 次）
    for (let i = 0; i < 20; i++) {
      const res = await aiLimit(req("192.168.1.99"), "chat", t, brokenKV);
      assert.equal(res, null);
    }
    const blocked = await aiLimit(req("192.168.1.99"), "chat", t, brokenKV);
    assert.match(blocked, /每小時最多 20 次/);
    assert.ok(warnLogged, "KV 異常時必須輸出可觀測的警示日誌");

    // 2. 嚴格模式 (AI_LIMIT_STRICT=1)：KV 異常時拒絕請求以保護 API 成本
    process.env.AI_LIMIT_STRICT = "1";
    const strictBlocked = await aiLimit(req("192.168.1.100"), "chat", t, brokenKV);
    assert.equal(strictBlocked, "限流服務暫時異常，請稍後再試");
    delete process.env.AI_LIMIT_STRICT;
  } finally {
    console.warn = originalWarn;
  }
});
