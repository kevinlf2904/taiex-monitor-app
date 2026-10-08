// 把 learner/indpacks/*.js（產業圖解原始檔）合併成兩個檔案：
//   learner/industry-pack.js  一打開就載入（小）：新題材的基本資料（名稱、分類、段落、代號），加上每個題材圖解產業鏈裡的代號與相關題材
//   learner/industry-figs.js  打開「產業地圖」才載入（大）：每個題材的圖（fig）、原理說明（how）、趨勢（trends）、產業鏈（chain）
// 改圖請改 indpacks，再跑：node scripts/build-industry-figs.mjs
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../learner");
const order = f => { const m = /^([pq])(\d+)\.js$/.exec(f); return m ? (m[1] === "p" ? 0 : 1000) + +m[2] : 1e9; };
const files = fs.readdirSync(path.join(dir, "indpacks")).filter(f => f.endsWith(".js")).sort((a, b) => order(a) - order(b));
const ctx = { INDUSTRY_FIGS: {}, INDUSTRY_PACK: [] }; vm.createContext(ctx);
for (const f of files) vm.runInContext("var INDUSTRY_FIGS = this.INDUSTRY_FIGS, INDUSTRY_PACK = this.INDUSTRY_PACK;\n" + fs.readFileSync(path.join(dir, "indpacks", f), "utf8"), ctx, { filename: f });
const DETAIL = ["fig", "how", "trends", "chain", "peers"];
const figs = { ...ctx.INDUSTRY_FIGS }, pack = [], xref = {};
for (const t of ctx.INDUSTRY_PACK) {
  const core = {}, det = {}; for (const [k, v] of Object.entries(t)) (DETAIL.includes(k) ? det : core)[k] = v;
  pack.push(core); if (Object.keys(det).length) figs[t.id] = { ...(figs[t.id] || {}), ...det };
}
for (const [id, F] of Object.entries(figs)) {
  const cc = [...new Set((F.chain || []).flatMap(g => (g.items || []).flatMap(i => (i.c || []).map(x => x[0]))))];
  if (cc.length || F.peers) xref[id] = { ...(cc.length ? { cc } : {}), ...(F.peers ? { peers: F.peers } : {}) };
}
const head = src => `/* 自動產生，請勿手改：由 learner/indpacks/${files[0]}～${files.at(-1)} 合併（node scripts/build-industry-figs.mjs）。${src} */\n`;
const lines = o => Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
fs.writeFileSync(path.join(dir, "industry-pack.js"), head("新題材基本資料與圖解產業鏈的代號；頁面一打開就載入") +
  `INDUSTRY_PACK.push(\n${pack.map(t => JSON.stringify(t)).join(",\n")}\n);\nconst INDUSTRY_XREF = {\n${lines(xref)}\n};\n`);
fs.writeFileSync(path.join(dir, "industry-figs.js"), head("每個題材的圖、原理說明、趨勢與產業鏈；打開產業地圖才載入") +
  `Object.assign(INDUSTRY_FIGS, {\n${lines(figs)}\n});\n`);
console.log(`industry-pack.js: ${pack.length} 個新題材；industry-figs.js: ${Object.keys(figs).length} 個圖解`);
