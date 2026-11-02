// learner/core.js 的 esc()／safeUrl()：從原始碼取出這兩行在 vm 裡測（不載入整個 core.js）
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const SRC = await readFile(new URL("../learner/core.js", import.meta.url), "utf8");
const ctx = {}; vm.createContext(ctx);
for (const name of ["esc", "safeUrl"]) vm.runInContext(SRC.match(new RegExp("const " + name + " = [^\\n]+"))[0].replace("const ", "globalThis."), ctx);

test("esc：& < > \" ' 都要轉，單引號包的屬性才不會提早結束", () => {
  assert.equal(ctx.esc(`a'b"<&>`), "a&#39;b&quot;&lt;&amp;&gt;");
  assert.equal(ctx.esc(null), ""); assert.equal(ctx.esc(0), "0");
});

test("safeUrl：只放行 http(s) 與相對路徑，javascript:／data: 等（含大小寫、空白、tab 混淆）換成 #", () => {
  for (const ok of ["https://a.com/x?y=1", "http://a.com", "/learner/data/x.pdf", "data/x.pdf", "//cdn.example/y", ""]) assert.equal(ctx.safeUrl(ok), ok, ok);
  for (const bad of ["javascript:alert(1)", "  JavaScript:alert(1)", "java\tscript:alert(1)", "java\nscript:x", "data:text/html,x", "vbscript:x"]) assert.equal(ctx.safeUrl(bad), "#", JSON.stringify(bad));
});
