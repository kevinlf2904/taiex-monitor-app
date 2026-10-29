// 雲端同步與 Telegram API 深度測試 (Phase 3 P1/P2: 授權、頻率限制、暴力破解防護、過期資料與機密安全)
import test from "node:test";
import assert from "node:assert/strict";
import handler, { tg, hashId, bindTok, okId, ipOf, sanitizeTelegramError, redactTelegramSecrets, incrTtl } from "../api/_lib/sync.js";

// 建立模擬的 HTTP Request 與 Response 物件
function mockHttp({ method = "POST", body = {}, query = {}, headers = {} } = {}) {
  const req = {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    query,
    headers: { "x-forwarded-for": "203.0.113.195", ...headers }
  };
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    setHeader() {
      return res;
    }
  };
  return {
    req,
    res,
    get status() { return statusCode; },
    get data() { return responseData; }
  };
}

// 模擬 KV 儲存空間
function createMockKv() {
  const store = new Map();
  return async function mockKv(cmd, ...args) {
    if (cmd === "INCR") {
      const k = args[0];
      const cur = +(store.get(k) || 0) + 1;
      store.set(k, String(cur));
      return cur;
    }
    if (cmd === "EXPIRE") {
      return 1;
    }
    if (cmd === "GET") {
      const k = args[0];
      return store.get(k) || null;
    }
    if (cmd === "SET") {
      const [k, v] = args;
      store.set(k, String(v));
      return "OK";
    }
    if (cmd === "DEL") {
      const k = args[0];
      store.delete(k);
      return 1;
    }
    if (cmd === "SADD" || cmd === "SREM") {
      return 1;
    }
    if (cmd === "HSET") {
      return 1;
    }
    return null;
  };
}

test("未授權/非 POST 方法或無效同步碼請求遭拒絕", async () => {
  // 1. GET 請求非 cfg/mon 操作遭拒絕
  const getReq = mockHttp({ method: "GET", body: { op: "pull", id: "valid_id_123456789012345" } });
  await handler(getReq.req, getReq.res);
  assert.equal(getReq.status, 405);
  assert.equal(getReq.data.ok, false);
  assert.match(getReq.data.error, /請用 POST/);

  // 2. 無效同步碼 (過短、特殊符號) 遭拒絕
  for (const badId of ["short", "bad#id*with$symbols", "", null, "a".repeat(100)]) {
    const postBad = mockHttp({
      method: "POST",
      body: { op: "pull", id: badId }
    });
    process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
    process.env.KV_REST_API_TOKEN = "mock_token";
    await handler(postBad.req, postBad.res);
    assert.equal(postBad.status, 400);
    assert.equal(postBad.data.ok, false);
    assert.match(postBad.data.error, /同步碼格式不對/);
  }
});

test("超出資料大小限制與格式不對的請求遭拒絕", async () => {
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ result: 1 })
  });

  try {
    const validId = "valid_sync_token_1234567890";

    // 1. 資料不是物件（傳陣列或字串）
    const badData = mockHttp({
      method: "POST",
      body: { op: "push", id: validId, data: ["not", "an", "object"] }
    });
    await handler(badData.req, badData.res);
    assert.equal(badData.status, 400);
    assert.match(badData.data.error, /沒有資料或資料格式不對/);

    // 2. 資料超過 900KB
    const hugeData = mockHttp({
      method: "POST",
      body: { op: "push", id: validId, data: { big: "x".repeat(950 * 1024) } }
    });
    await handler(hugeData.req, hugeData.res);
    assert.equal(hugeData.status, 413);
    assert.match(hugeData.data.error, /資料太大/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("過期同步資料不會被當成有效資料", async () => {
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";

  const originalFetch = globalThis.fetch;
  const mockKvStore = new Map();
  const validId = "valid_sync_token_expired_999";
  const h = hashId(validId);

  // 存入一筆 401 天前的過期資料 (KEEP = 400 天)
  const expiredAt = Date.now() - 401 * 86400 * 1000;
  mockKvStore.set(`sync:${h}`, JSON.stringify({ at: expiredAt, data: { test: 1 } }));

  globalThis.fetch = async (url, opts) => {
    const cmd = JSON.parse(opts.body);
    const op = cmd[0];
    if (op === "INCR") return { ok: true, json: async () => ({ result: 1 }) };
    if (op === "EXPIRE") return { ok: true, json: async () => ({ result: 1 }) };
    if (op === "GET") {
      const val = mockKvStore.get(cmd[1]) || null;
      return { ok: true, json: async () => ({ result: val }) };
    }
    return { ok: true, json: async () => ({ result: "OK" }) };
  };

  try {
    const pullReq = mockHttp({
      method: "POST",
      body: { op: "pull", id: validId }
    });
    await handler(pullReq.req, pullReq.res);
    assert.equal(pullReq.status, 200);
    assert.equal(pullReq.data.ok, false);
    assert.match(pullReq.data.error, /同步資料已過期/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("暴力嘗試同步碼與高頻率 Telegram 操作受到嚴格限制", async () => {
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";
  process.env.TELEGRAM_BOT_TOKEN = "fake_bot_token_123456";

  const originalFetch = globalThis.fetch;
  const counts = new Map();

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("mock-kv")) {
      const cmd = JSON.parse(opts.body);
      if (cmd[0] === "INCR") {
        const k = cmd[1];
        const n = (counts.get(k) || 0) + 1;
        counts.set(k, n);
        return { ok: true, json: async () => ({ result: n }) };
      }
      if (cmd[0] === "GET") {
        const k = cmd[1];
        if (k.startsWith("pl:fail:")) return { ok: true, json: async () => ({ result: counts.get(k) || 0 }) };
        return { ok: true, json: async () => ({ result: null }) };
      }
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    return { ok: true, json: async () => ({ ok: true, result: [] }) };
  };

  try {
    const validId = "valid_sync_token_rate_test1";

    // 1. 暴力嘗試 pull: 失敗 15 次後應觸發 429
    for (let i = 0; i < 15; i++) {
      const r = mockHttp({ method: "POST", body: { op: "pull", id: validId } });
      await handler(r.req, r.res);
    }
    const pullBlocked = mockHttp({ method: "POST", body: { op: "pull", id: validId } });
    await handler(pullBlocked.req, pullBlocked.res);
    assert.equal(pullBlocked.status, 429);
    assert.match(pullBlocked.data.error, /錯誤嘗試次數過多/);

    // 2. tgtest 高頻操作限制（每 10 分鐘最多 3 次）
    counts.set(`tgt:h:${hashId(validId).slice(0, 16)}:${Math.floor(Date.now() / 600e3)}`, 3);
    const tgtestBlocked = mockHttp({ method: "POST", body: { op: "tgtest", id: validId } });
    await handler(tgtestBlocked.req, tgtestBlocked.res);
    assert.equal(tgtestBlocked.status, 429);
    assert.match(tgtestBlocked.data.error, /測試訊息發送太頻繁/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("錯誤鏈 (message, stack, cause, toJSON) 絕不洩漏 Telegram Bot Token", async () => {
  const secretToken = "123456789:ABCdefGHIjklMNO_secret_token";
  process.env.TELEGRAM_BOT_TOKEN = secretToken;

  const originalFetch = globalThis.fetch;

  // 情境 1: 網路底層錯誤 (TypeError: fetch failed 包含 URL 與 cause 鏈)
  globalThis.fetch = async url => {
    const rootErr = new TypeError(`getaddrinfo ENOTFOUND api.telegram.org at ${url}`);
    const fetchErr = new TypeError(`fetch failed at ${url}`);
    fetchErr.cause = rootErr;
    fetchErr.stack = `TypeError: fetch failed at ${url}\n    at node:internal/deps/undici/undici:13123:13`;
    throw fetchErr;
  };

  try {
    await assert.rejects(
      async () => {
        await tg("sendMessage", { chat_id: 12345 });
      },
      err => {
        // 1. 本體 message 與 stack 檢查
        assert.ok(!err.message.includes(secretToken), "error.message 不得包含真實 Token");
        assert.ok(err.message.includes("[REDACTED_TOKEN]"), "Token 必須被遮蔽為 [REDACTED_TOKEN]");
        if (err.stack) {
          assert.ok(!err.stack.includes(secretToken), "error.stack 不得包含真實 Token");
          assert.ok(err.stack.includes("[REDACTED_TOKEN]"), "error.stack 中的 Token 亦須被遮蔽");
        }

        // 2. 深度 cause 鏈檢查 (不可包含原始未脫敏物件)
        assert.ok(err.cause, "必須保留安全的 cause 診斷資訊");
        assert.ok(!err.cause.message.includes(secretToken), "cause.message 不得包含真實 Token");
        assert.ok(err.cause.message.includes("[REDACTED_TOKEN]"), "cause.message 中的 Token 亦須被遮蔽");
        if (err.cause.stack) {
          assert.ok(!err.cause.stack.includes(secretToken), "cause.stack 不得包含真實 Token");
        }

        // 3. JSON 序列化檢查
        const serialized = JSON.stringify(err);
        assert.ok(!serialized.includes(secretToken), "JSON.stringify 輸出不得包含真實 Token");

        // 4. 字串轉換檢查
        const stringified = String(err);
        assert.ok(!stringified.includes(secretToken), "String(err) 輸出不得包含真實 Token");
        return true;
      }
    );

    // 情境 2: Telegram API 回傳 4xx/5xx 與 API description 包含敏感字串
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        error_code: 401,
        description: `Unauthorized: bot token ${secretToken} is invalid`
      })
    });

    await assert.rejects(
      async () => {
        await tg("getMe");
      },
      err => {
        assert.ok(!err.message.includes(secretToken), "API 錯誤訊息不得洩漏 Token");
        assert.ok(err.message.includes("[REDACTED_TOKEN]"), "Token 應替換為 [REDACTED_TOKEN]");
        return true;
      }
    );

    // 情境 3: Telegram API 回傳非 JSON 格式 (例如 502 Bad Gateway HTML)
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      }
    });

    await assert.rejects(
      async () => {
        await tg("getUpdates");
      },
      err => {
        assert.ok(err.message.includes("Telegram HTTP 502"), "應回傳乾淨的 HTTP 狀態錯誤");
        assert.ok(!err.message.includes(secretToken), "不得包含 Token");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

test("IP 信任邊界：優先信任 x-real-ip，防止攻擊者藉由 x-forwarded-for 偽造 IP 繞過鎖定", async () => {
  // 1. 偽造 x-forwarded-for 企圖繞過 IP 辨識
  const spoofReq = {
    headers: {
      "x-forwarded-for": "100.100.100.100, 101.101.101.101",
      "x-real-ip": "203.0.113.195"
    }
  };
  assert.equal(ipOf(spoofReq), "203.0.113.195", "必須優先以 x-real-ip 作為判定來源");

  // 2. 只有 x-forwarded-for 時正常回退
  const fwdReq = {
    headers: {
      "x-forwarded-for": "198.51.100.55"
    }
  };
  assert.equal(ipOf(fwdReq), "198.51.100.55");

  // 3. 測試暴力嘗試防護在 x-real-ip 存在時不可被偽造標頭繞過
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";

  const originalFetch = globalThis.fetch;
  const store = new Map();
  globalThis.fetch = async (url, opts) => {
    const cmd = JSON.parse(opts.body);
    const op = cmd[0];
    if (op === "INCR") {
      const k = cmd[1];
      const n = (store.get(k) || 0) + 1;
      store.set(k, n);
      return { ok: true, json: async () => ({ result: n }) };
    }
    if (op === "GET") {
      const k = cmd[1];
      return { ok: true, json: async () => ({ result: store.get(k) || null }) };
    }
    return { ok: true, json: async () => ({ result: 1 }) };
  };

  try {
    const attackerRealIp = "198.51.100.99";
    const validId = "valid_sync_token_ip_test99";

    // 攻擊者嘗試 15 次失敗，每次隨機偽造 x-forwarded-for
    for (let i = 0; i < 15; i++) {
      const r = mockHttp({
        method: "POST",
        body: { op: "pull", id: validId },
        headers: {
          "x-real-ip": attackerRealIp,
          "x-forwarded-for": `random.fake.ip.${i}`
        }
      });
      await handler(r.req, r.res);
    }

    // 第 16 次嘗試：即便更換偽造的 x-forwarded-for，仍因真實 x-real-ip 已被鎖定而遭 429 阻擋
    const blockedReq = mockHttp({
      method: "POST",
      body: { op: "pull", id: validId },
      headers: {
        "x-real-ip": attackerRealIp,
        "x-forwarded-for": "another.fake.ip.999"
      }
    });
    await handler(blockedReq.req, blockedReq.res);
    assert.equal(blockedReq.status, 429, "更換偽造的 x-forwarded-for 不得繞過 IP 失敗鎖定");
    assert.match(blockedReq.data.error, /錯誤嘗試次數過多/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("多裝置同步不互相蓋掉（稽核 F-06）：雲端比 base 新就回 409；force 才覆蓋；沒帶 base 的舊版照舊", async () => {
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";
  const originalFetch = globalThis.fetch, store = new Map(), id = "conflict_sync_token_abc_123", key = `sync:${hashId(id)}`;
  globalThis.fetch = async (url, opts) => { const [op, k, v] = JSON.parse(opts.body); const R = result => ({ ok: true, json: async () => ({ result }) });
    if (op === "INCR") return R(1); if (op === "GET") return R(store.get(k) ?? null); if (op === "SET") { store.set(k, v); return R("OK"); } return R(1); };
  const push = async body => { const m = mockHttp({ body: { op: "push", id, data: { "kline:watch:x": "1" }, ...body } }); await handler(m.req, m.res); return m; };
  try {
    store.set(key, JSON.stringify({ at: 2000, dev: "iPhone", data: { "kline:watch:x": "iphone" } }));
    const a = await push({ base: 1000, dev: "iPad" });
    assert.equal(a.status, 409); assert.equal(a.data.conflict, true); assert.equal(a.data.at, 2000); assert.equal(a.data.dev, "iPhone");
    assert.equal(JSON.parse(store.get(key)).data["kline:watch:x"], "iphone", "衝突時雲端資料不變");
    const b = await push({ base: 2000 }); assert.equal(b.status, 200); assert.equal(b.data.ok, true, "base 等於雲端時間：可以上傳");
    assert.equal(JSON.parse(store.get(key)).at, b.data.at, "回傳的 at 和存進雲端的一樣，下次當 base 才對得上");
    store.set(key, JSON.stringify({ at: Date.now() + 1e6, dev: "iPhone", data: {} }));
    const c = await push({ base: 1, force: true }); assert.equal(c.data.ok, true, "force：使用者確認後覆蓋");
    store.set(key, JSON.stringify({ at: Date.now() + 1e6, dev: "iPhone", data: {} }));
    const d = await push({}); assert.equal(d.data.ok, true, "舊版網頁沒帶 base：照舊直接覆蓋（相容）");
  } finally { globalThis.fetch = originalFetch; }
});

test("計數器的過期時間（稽核 F-11）：第一次 EXPIRE 失敗，之後會補上，不會變成永久封鎖", async () => {
  process.env.KV_REST_API_URL = "https://mock-kv.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock_token";
  const originalFetch = globalThis.fetch; let n = 0, ttl = -1, expireCalls = 0;
  globalThis.fetch = async (url, opts) => { const [op] = JSON.parse(opts.body); const R = result => ({ ok: true, json: async () => ({ result }) });
    if (op === "INCR") return R(++n); if (op === "TTL") return R(ttl);
    if (op === "EXPIRE") { expireCalls++; if (expireCalls === 1) return { ok: false, status: 500, json: async () => ({ error: "暫時失敗" }) }; ttl = 3600; return R(1); } return R(1); };
  try {
    await assert.rejects(incrTtl("wl:ip:x", 3600), "第一次 EXPIRE 失敗會丟錯（呼叫的地方照舊處理）");
    for (let i = 2; i <= 20; i++) await incrTtl("wl:ip:x", 3600);
    assert.equal(ttl, 3600, "第 20 次檢查到沒有過期時間，補上");
    const before = expireCalls; for (let i = 21; i <= 40; i++) await incrTtl("wl:ip:x", 3600);
    assert.equal(expireCalls, before, "已經有過期時間就不再重設");
  } finally { globalThis.fetch = originalFetch; }
});

// P1-03：沒有 KV／Telegram 時要明確說「沒設定」或「暫時連不到」，不能回報成功；KV 恢復後自動恢復
test("P1-03 同步：沒設定 KV 回 not_configured、KV 壞掉回 unavailable 且不是成功、KV 恢復後同一個請求就成功", async () => {
  const save = { u: process.env.KV_REST_API_URL, t: process.env.KV_REST_API_TOKEN, uu: process.env.UPSTASH_REDIS_REST_URL, ut: process.env.UPSTASH_REDIS_REST_TOKEN, g: process.env.TELEGRAM_BOT_TOKEN };
  const originalFetch = globalThis.fetch, id = "p103_sync_token_abcdefgh", push = async () => { const m = mockHttp({ body: { op: "push", id, data: { "kline:watch:x": "1" } } }); await handler(m.req, m.res); return m; };
  try {
    for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
    globalThis.fetch = async () => { throw new Error("沒設定時不該連外"); };
    const cfg = mockHttp({ method: "GET", query: { op: "cfg" } }); await handler(cfg.req, cfg.res);
    assert.deepEqual([cfg.data.kv, cfg.data.tg, cfg.data.limiter], [false, false, "per_instance"], "沒有 KV：限流只是每個執行個體各自計算");
    const a = await push(); assert.deepEqual([a.data.ok, a.data.reason], [false, "not_configured"]);
    // 有設定但 KV 連不到
    process.env.KV_REST_API_URL = "https://mock-kv.upstash.io"; process.env.KV_REST_API_TOKEN = "mock_token";
    let up = false; const store = new Map();
    globalThis.fetch = async (url, opts) => { if (!up) return { ok: false, status: 503, json: async () => ({ error: "暫停服務" }) };
      const [op, k, v] = JSON.parse(opts.body), R = result => ({ ok: true, json: async () => ({ result }) });
      if (op === "INCR") return R(1); if (op === "GET") return R(store.get(k) ?? null); if (op === "SET") { store.set(k, v); return R("OK"); } return R(1); };
    const b = await push(); assert.deepEqual([b.data.ok, b.data.reason], [false, "unavailable"], "KV 失敗不能回報成功"); assert.equal(store.size, 0);
    up = true; const c = await push(); assert.equal(c.data.ok, true, "KV 恢復後不用重新部署就能用"); assert.ok(store.get(`sync:${hashId(id)}`));
    const cfg2 = mockHttp({ method: "GET", query: { op: "cfg" } }); await handler(cfg2.req, cfg2.res); assert.equal(cfg2.data.limiter, "shared");
    // Telegram 沒設定：測試訊息明確回 tg_not_configured，不是「暫時連不到」，也沒有呼叫 Telegram
    store.set(`tg:${hashId(id)}`, "12345");
    let tgCalled = false; const f0 = globalThis.fetch; globalThis.fetch = async (url, opts) => { if (String(url).includes("telegram")) tgCalled = true; return f0(url, opts); };
    const t = mockHttp({ body: { op: "tgtest", id } }); await handler(t.req, t.res);
    assert.deepEqual([t.data.ok, t.data.reason, tgCalled], [false, "tg_not_configured", false]);
    const tb = mockHttp({ body: { op: "tgbind", id } }); await handler(tb.req, tb.res); assert.equal(tb.data.reason, "tg_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of [["KV_REST_API_URL", save.u], ["KV_REST_API_TOKEN", save.t], ["UPSTASH_REDIS_REST_URL", save.uu], ["UPSTASH_REDIS_REST_TOKEN", save.ut], ["TELEGRAM_BOT_TOKEN", save.g]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("P1-03 推播：送 Telegram 失敗時清掉「今天已送」記號，下次排程會重送；已送過的不重送", async () => {
  const { markThenSend } = await import("../scripts/alerts-push.mjs");
  const store = new Map(), K = async (op, k) => { if (op === "SET") { if (store.has(k)) return null; store.set(k, "1"); return "OK"; } if (op === "DEL") { store.delete(k); return 1; } };
  await assert.rejects(markThenSend("close:h:2026-10-28", 172800, async () => { throw new Error("Telegram 暫時失敗"); }, K));
  assert.equal(store.has("close:h:2026-10-28"), false, "失敗不能留下已送記號");
  let n = 0; assert.equal(await markThenSend("close:h:2026-10-28", 172800, async () => { n++; }, K), true);
  assert.equal(await markThenSend("close:h:2026-10-28", 172800, async () => { n++; }, K), false, "同一天第二次不重送");
  assert.equal(n, 1);
});

test("P1-03 AI 限流：沒有 KV 用保守的記憶體上限（不是全站統一），KV 失敗也不放行，KV 恢復後改回共用計數", async () => {
  const { aiLimit, limitsOf, mem } = await import("../api/_lib/_limit.js");
  const save = { u: process.env.KV_REST_API_URL, t: process.env.KV_REST_API_TOKEN };
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; mem.clear();
  try {
    const [perIp] = limitsOf("podcast", false), req = { headers: { "x-real-ip": "198.51.100.7" } }, now = Date.parse("2026-10-28T02:00:00Z");
    assert.ok(perIp < limitsOf("podcast", true)[0], "記憶體模式的上限比共用模式低");
    for (let i = 0; i < perIp; i++) assert.equal(await aiLimit(req, "podcast", now), null);
    assert.match(await aiLimit(req, "podcast", now), /太頻繁/, "記憶體模式照樣擋");
    // 共用計數壞掉：退回記憶體，不放行
    const broken = async () => { throw new Error("KV down"); };
    assert.match(await aiLimit(req, "podcast", now, broken), /太頻繁/);
    // 共用計數恢復：用共用的計數
    let n = 0; const ok = async () => ++n;
    assert.equal(await aiLimit({ headers: { "x-real-ip": "198.51.100.8" } }, "podcast", now, ok), null); assert.ok(n >= 2, "有呼叫共用計數器");
  } finally { mem.clear(); if (save.u === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = save.u; if (save.t === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = save.t; }
});
