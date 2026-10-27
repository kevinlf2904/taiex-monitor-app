// 雲端同步與 Telegram API 深度測試 (Phase 3 P1/P2: 授權、頻率限制、暴力破解防護、過期資料與機密安全)
import test from "node:test";
import assert from "node:assert/strict";
import handler, { tg, hashId, bindTok, okId } from "../api/_lib/sync.js";

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
    // 設定假環境變數
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
    // 預先設定已綁定
    counts.set(`tgt:h:${hashId(validId).slice(0, 16)}:${Math.floor(Date.now() / 600e3)}`, 3);
    const tgtestBlocked = mockHttp({ method: "POST", body: { op: "tgtest", id: validId } });
    await handler(tgtestBlocked.req, tgtestBlocked.res);
    assert.equal(tgtestBlocked.status, 429);
    assert.match(tgtestBlocked.data.error, /測試訊息發送太頻繁/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("錯誤訊息與日誌絕不洩漏 Telegram Bot Token", async () => {
  const secretToken = "123456789:ABCdefGHIjklMNO_secret_token";
  process.env.TELEGRAM_BOT_TOKEN = secretToken;

  const originalFetch = globalThis.fetch;
  // 模擬 fetch 報錯（包含 Token 的完整 URL）
  globalThis.fetch = async url => {
    throw new TypeError(`fetch failed at ${url}`);
  };

  try {
    await assert.rejects(
      async () => {
        await tg("sendMessage", { chat_id: 12345 });
      },
      err => {
        assert.ok(!err.message.includes(secretToken), "錯誤訊息中不得出現真實 Token");
        assert.ok(err.message.includes("[REDACTED_TOKEN]"), "Token 必須被遮蔽為 [REDACTED_TOKEN]");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
});
