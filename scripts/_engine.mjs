// 在 Node 裡重用網站的技術指標與條件：把 learner/core.js、analysis.js、quant.js、tools.js、brief.js 載進沙盒（vm），
// 讓排程（全市場選股、Telegram 提醒）和網頁用同一套 indicators()、COND、SCOND、策略，結果才會一致。
// 這三個檔案在最上層不碰畫面，只宣告函式與常數；畫面相關的 document、window 用空殼代替。
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const L = f => fileURLToPath(new URL(`../learner/${f}`, import.meta.url));
let ctx = null;
export function engine() {
  if (ctx) return ctx;
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : stub), apply: () => stub, construct: () => stub });
  const c = { console, Math, Date, JSON, Map, Set, WeakMap, Array, Object, Number, String, isFinite, parseFloat, parseInt, setTimeout, clearTimeout, Promise };
  Object.assign(c, { window: c, document: stub, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { userAgent: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, requestAnimationFrame: () => 0, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => "" }) });
  vm.createContext(c);
  for (const f of ["core.js", "analysis.js", "quant.js", "tools.js", "brief.js"]) vm.runInContext(readFileSync(L(f), "utf8"), c, { filename: f });
  const g = n => vm.runInContext(n, c);
  ctx = { indicators: g("indicators"), COND: g("COND"), SCOND: g("SCOND"), condOf: g("condOf"), condName: g("condName"), condCheck: g("condCheck"), stratRun: g("stratRun"), STRAT_DEFS: g("STRAT_DEFS"), backtest: g("backtest"), agg: g("agg"), weekKey: g("weekKey"),
    S: { Signals: g("Signals"), detectPattern: g("detectPattern"), PATTERNS: g("PATTERNS"), CHART_PATTERNS: g("CHART_PATTERNS") }, // K 線型態、型態學、缺口（K線學堂的型態課）
    B: Object.fromEntries(["evScan", "revOf", "briefParts", "briefText", "twDay", "macroBeta", "todayData", "closeText", "sessionStatus", "briefScenarios", "validatePlan", "marketSnapshot", "isValidSnapshot", "evaluateDataStatus", "getBriefSnapshot", "saveBriefSnapshot", "resolveTime", "resolveHolidays", "findLastTradeDate"].map(n => [n, g(n)])), // 事件提醒、早報、決策中心（brief.js）
    Q: Object.fromEntries(["btMetrics", "regimes", "btBreakdown", "btVariants", "btAdvice", "adxCalc", "marketState", "stateAdvice", "atrSetup", "portRisk", "portPlan", "factorRaw", "factorScore", "factorBacktest", "btReportHtml", "stateHtml", "btReportText"].map(n => [n, g(n)])) };
  return ctx;
}
