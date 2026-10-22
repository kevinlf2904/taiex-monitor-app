import { chromium, serve, open } from "./_harness.mjs";
const S = await serve(), B = await (await chromium()).launch(), out = [];
for (const width of [390, 1280]) {
  for (const f of ["index.html", "savings.html", "pro.html", "demo-matrix.html"]) {
    const { ctx, p, errs } = await open(B, S.url, f, { width, touch: width < 500 });
    const cerr = []; p.on("console", m => m.type() === "error" && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && cerr.push(m.text().slice(0, 160)));
    const tabs = f === "index.html" ? await p.$$eval("[data-tab]", L => [...new Set(L.map(x => x.dataset.tab))]) : [""];
    for (const t of tabs) { if (t) { await p.evaluate(t => document.querySelector(`[data-tab="${t}"]`)?.click(), t); } await p.waitForTimeout(1200);
      const r = await p.evaluate(() => ({ ov: document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0, und: /\bundefined\b|\bNaN\b|\[object Object\]/.exec(document.body.innerText)?.[0] }));
      if (r.ov || r.und) out.push(`${width} ${f} ${t}: ${r.ov ? "頁面寬 " + r.ov : ""} ${r.und ? "文字含 " + r.und : ""}`); }
    if (errs.length || cerr.length) out.push(`${width} ${f}: ${[...errs, ...new Set(cerr)].slice(0, 5).join(" | ")}`);
    await ctx.close();
  }
}
console.log(out.join("\n") || "全部正常"); await B.close(); S.close();
