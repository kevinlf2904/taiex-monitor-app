import { chromium, serve, open } from "./_harness.mjs";
const S = await serve(), B = await (await chromium()).launch(), out = [];
const LT = ["watch", "hold", "mkt", "rank", "screen", "money", "ind", "etf", "earn", "pod", "cong", "tools", "after"], REG = ["tw", "lst", "otc", "off", "us", "gl", "news", "macro", "poly"];
for (const width of [390, 1280]) {
  const { ctx, p, errs } = await open(B, S.url, "watch.html", { width, touch: width < 500 });
  const cerr = []; p.on("console", m => m.type() === "error" && cerr.push(m.text().slice(0, 140)));
  const chk = async tag => { await p.waitForTimeout(900); const r = await p.evaluate(() => { const W0 = innerWidth, bad = [...document.querySelectorAll("#lx *, #lTools *")].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.right > W0 + 2 && !e.closest("[style*=overflow], .hs, .scrseg, .mkseg, .seg, .cotbl-wrap, .tblwrap, table, .rheat, .ichips, svg, canvas, .tmap") && getComputedStyle(e.parentElement).overflowX === "visible"; }).slice(0, 3).map(e => e.tagName + "." + [...e.classList].join(".") + " " + Math.round(e.getBoundingClientRect().right)); return { ov: document.documentElement.scrollWidth > innerWidth + 1, bad, und: /undefined|NaN|\[object Object\]/.exec(document.getElementById("lx")?.innerText || "")?.[0] }; });
    if (r.ov || r.bad.length || r.und) out.push(`${width} ${tag}: ${r.ov ? "頁面溢出 " : ""}${r.bad.join(", ")} ${r.und ? "文字含 " + r.und : ""}`); };
  for (const lt of LT) { if (lt === "mkt") { for (const g of REG) { await p.evaluate(g => { showList(); W.mkReg = g; setLt("mkt"); }, g); await chk("mkt:" + g); } continue; }
    await p.evaluate(lt => { showList(); setLt(lt); }, lt); await chk(lt); }
  await p.evaluate(() => select("2330")); await chk("個股 2330"); await p.evaluate(() => select("AAPL")); await chk("個股 AAPL");
  out.push(`${width} pageerror: ${errs.join(" | ") || "無"}`); out.push(`${width} console error: ${[...new Set(cerr)].slice(0, 8).join(" | ") || "無"}`);
  await ctx.close();
}
console.log(out.join("\n")); await B.close(); S.close();
