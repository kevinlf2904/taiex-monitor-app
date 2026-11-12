// Podcast 音檔／RSS 讀取的大小上限（#262 SEC-09、#264 E3）：超過上限要中止並取消下載；Content-Length 準、不準、沒有時內容都正確。
import test from "node:test";
import assert from "node:assert/strict";
import { readCapped } from "../api/_lib/podcast.js";

// 假回應：chunks 逐段送出，記錄讀了幾段、有沒有被取消
function fake(chunks, len) {
  const st = { reads: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream({
    pull(c) { if (i < chunks.length) { st.reads++; c.enqueue(new Uint8Array(Buffer.from(chunks[i++]))); } else c.close(); },
    cancel() { st.cancelled = true; },
  });
  const headers = new Headers(len == null ? {} : { "content-length": String(len) });
  return { r: { body, headers }, st };
}

test("Content-Length 正確：內容完整", async () => {
  const { r } = fake(["abc", "def", "g"], 7);
  assert.equal((await readCapped(r, 100)).toString(), "abcdefg");
});
test("沒有 Content-Length：分段收集，內容完整", async () => {
  const { r } = fake(["ab", "cd", "ef"]);
  assert.equal((await readCapped(r, 100)).toString(), "abcdef");
});
test("Content-Length 比實際短：改成分段收集，不截斷也不出錯", async () => {
  const { r } = fake(["abc", "def", "ghi"], 4);
  assert.equal((await readCapped(r, 100)).toString(), "abcdefghi");
});
test("Content-Length 比實際長：只回實際讀到的部分", async () => {
  const { r } = fake(["abc"], 10);
  const b = await readCapped(r, 100); assert.equal(b.length, 3); assert.equal(b.toString(), "abc");
});
test("Content-Length 宣稱很大、實際很少：回傳的 Buffer 不留著整塊預配空間", async () => {
  const big = 4 * 1048576; // 大於 Buffer 共用池，預配一定是獨立的一塊
  const { r } = fake(["abc"], big);
  const b = await readCapped(r, 8 * 1048576);
  assert.equal(b.toString(), "abc");
  assert.ok(b.buffer.byteLength < 65536, `底層空間 ${b.buffer.byteLength} bytes，應只剩實際內容大小`);
});
test("Content-Length 正確：直接回傳預配空間，不多複製一份", async () => {
  const len = 1048576, half = "x".repeat(len / 2);
  const { r } = fake([half, half], len);
  const b = await readCapped(r, 2 * len);
  assert.equal(b.length, len); assert.equal(b.byteOffset, 0); assert.equal(b.buffer.byteLength, len);
});
// 記錄 readCapped 期間 Buffer.allocUnsafe 配了多大的空間（Content-Length 不可信，不能照它一次配一整塊）
async function allocs(fn) {
  const orig = Buffer.allocUnsafe, sizes = [];
  Buffer.allocUnsafe = n => { sizes.push(n); return orig.call(Buffer, n); };
  try { return { out: await fn(), sizes }; } finally { Buffer.allocUnsafe = orig; }
}
const MiB = 1048576;
test("宣稱接近上限、內容立即結束：不先配接近上限的空間", async () => {
  const { r } = fake([], 140 * MiB);
  const { out, sizes } = await allocs(() => readCapped(r, 150 * MiB));
  assert.equal(out.length, 0);
  assert.ok(Math.max(0, ...sizes) <= MiB, `配了 ${Math.max(...sizes)} bytes`);
});
test("宣稱很大、只慢慢送一點：配置量跟著實際收到的量，最多約兩倍", async () => {
  const chunk = "x".repeat(64 * 1024), { r } = fake(Array.from({ length: 40 }, () => chunk), 140 * MiB); // 實際 2.5 MiB
  const { out, sizes } = await allocs(() => readCapped(r, 150 * MiB));
  assert.equal(out.length, 40 * 64 * 1024);
  assert.ok(Math.max(...sizes) <= 2 * out.length, `最大一次配了 ${Math.max(...sizes)} bytes`);
  assert.ok(out.buffer.byteLength - out.byteOffset >= out.length && out.buffer.byteLength < 2 * out.length + 65536);
});
test("宣稱正確且大於起始配置：邊讀邊擴大，內容正確、最後剛好大小、不超過宣稱長度", async () => {
  const parts = ["a", "b", "c", "d", "e"].map(c => c.repeat(MiB)), len = 5 * MiB, { r } = fake(parts, len);
  const { out, sizes } = await allocs(() => readCapped(r, 8 * MiB));
  assert.equal(out.toString(), parts.join(""));
  assert.equal(out.byteOffset, 0); assert.equal(out.buffer.byteLength, len);
  assert.ok(sizes.every(s => s <= len));
});
test("Content-Length 已超過上限：一段都不讀就中止並取消", async () => {
  const { r, st } = fake(["x".repeat(10)], 2000);
  await assert.rejects(readCapped(r, 1000), /太大/);
  assert.equal(st.cancelled, true); assert.ok(st.reads <= 1);
});
test("沒有 Content-Length、讀到一半超過上限：中止並取消，不繼續下載", async () => {
  const { r, st } = fake(Array.from({ length: 50 }, () => "x".repeat(100)));
  await assert.rejects(readCapped(r, 1000), /太大/);
  assert.equal(st.cancelled, true); assert.ok(st.reads < 50);
});
test("宣稱很小、實際超過上限：一樣中止", async () => {
  const { r, st } = fake(Array.from({ length: 50 }, () => "x".repeat(100)), 10);
  await assert.rejects(readCapped(r, 1000), /太大/);
  assert.equal(st.cancelled, true);
});
test("剛好等於上限可以讀", async () => {
  const { r } = fake(["x".repeat(500), "y".repeat(500)], 1000);
  assert.equal((await readCapped(r, 1000)).length, 1000);
});
