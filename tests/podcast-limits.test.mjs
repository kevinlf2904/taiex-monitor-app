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
