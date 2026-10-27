// AI 限流機制深度測試 (Phase 2 P1: 記憶體限流、容量飽和 fail-closed、過期重置、防洪水攻擊繞過、併發與 KV 異常降級)
import test from "node:test";
import assert from "node:assert/strict";
import { aiLimit, limitsOf, memIncr, mem, MAX_MEM, ipOf } from "../api/_lib/_limit.js";

const req = (ip, headers = {}) => ({ headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers } });

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

test("容量達上限時優先清理過期計數；無過期項時拒絕新 key (fail-closed)，且絕不抹除既有有效計數", async () => {
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

  // 4. 新增第 5001 個鍵，應觸發過期清理並成功寫入新鍵
  await memIncr("newKey:1", 3600, futureNow);

  // 驗證過期項已被刪除，但有效項目完整保留
  assert.ok(!mem.has("exp:0"), "已過期的鍵應被清除");
  assert.ok(mem.has("active:0"), "未過期的有效限流資料不得被清除");
  assert.ok(mem.has("active:4899"), "未過期的有效鍵必須完整保留");
  assert.ok(mem.has("newKey:1"), "觸發清理後的新鍵必須存在");
  assert.ok(mem.size <= 5000, "Map 容量保持在健康範圍內");

  // 5. 測試容量飽和且無過期項目時：拒絕新增 key (fail-closed)，不得抹除有效計數
  mem.clear();
  for (let i = 0; i < 5000; i++) {
    await memIncr(`full:${i}`, 3600, now);
  }
  assert.equal(mem.size, 5000);

  // 新增第 5001 個未過期鍵時，應拋出 CAPACITY_FULL 錯誤
  await assert.rejects(
    async () => {
      await memIncr("overflow_new_key", 3600, now);
    },
    err => {
      assert.equal(err.code, "CAPACITY_FULL");
      return true;
    }
  );

  // 既有有效鍵全部被保護，絕不被淘汰
  assert.ok(mem.has("full:0"), "最舊的有效計數必須完整保留");
  assert.ok(mem.has("full:4999"), "最新的有效計數必須完整保留");
  assert.equal(mem.size, 5000, "Map 容量精確維持 5000");

  // 透過 aiLimit 呼叫時，回傳友善且安全的繁忙訊息
  const blockedMsg = await aiLimit(req("192.168.99.99"), "chat", now);
  assert.equal(blockedMsg, "系統繁忙（限流容量已滿），請稍後再試");
});

test("持續建立大量不同 key (洪水攻擊) 時，既有使用者的限流計數不會被淘汰或繞過", async () => {
  mem.clear();
  const now = 1700000000000;
  const victimIp = "192.168.1.88";

  // 1. 受限使用者正常累加至 19 次（接近上限 20 次）
  for (let i = 0; i < 19; i++) {
    const res = await aiLimit(req(victimIp), "chat", now);
    assert.equal(res, null);
  }

  // 2. 攻擊者試圖塞入大量偽造 key 填滿容量，企圖淘汰受限使用者的計數
  for (let i = 0; i < 5000; i++) {
    try {
      await memIncr(`flood:${i}`, 3600, now);
    } catch (e) {
      if (e.code === "CAPACITY_FULL") break;
    }
  }

  // 3. 驗證受限使用者的計數仍然被完整保留，並未被淘汰
  const res20 = await aiLimit(req(victimIp), "chat", now);
  assert.equal(res20, null, "第 20 次請求通過");

  // 第 21 次請求應準確被限流阻擋，攻擊者無法藉由灌水洗掉計數來繞過限制
  const res21 = await aiLimit(req(victimIp), "chat", now);
  assert.match(res21, /使用太頻繁了（每小時最多 20 次）/);
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

test("IP 解析優先信任 x-real-ip，並防範 x-forwarded-for 偽造", () => {
  // 1. 邊緣代理注入的 x-real-ip 優先於客戶端偽造的 x-forwarded-for
  const spoofReq = {
    headers: {
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      "x-real-ip": "203.0.113.195"
    }
  };
  assert.equal(ipOf(spoofReq), "203.0.113.195", "必須優先採用 x-real-ip");

  // 2. 當無 x-real-ip 時，回退至 x-forwarded-for
  const normalReq = {
    headers: {
      "x-forwarded-for": "198.51.100.22"
    }
  };
  assert.equal(ipOf(normalReq), "198.51.100.22");

  // 3. 無標頭時回退至 socket remoteAddress
  const socketReq = {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(ipOf(socketReq), "127.0.0.1");
});
