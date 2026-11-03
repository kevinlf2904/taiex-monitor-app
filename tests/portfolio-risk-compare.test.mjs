import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { analyzePortfolioRisk } from "../learner/portfolio-risk.js";

function tradingDates(n, start = "2025-01-02") {
  const out=[]; let d=new Date(start+"T00:00:00Z");
  while(out.length<n){const w=d.getUTCDay();if(w!==0&&w!==6)out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}
  return out;
}
function priceSeries(dates, returns, start=100) {
  let p=start; return [{date:dates[0],adjustedClose:p,d:dates[0],c:p},...returns.map((r,i)=>{p*=1+r;return {date:dates[i+1],adjustedClose:p,d:dates[i+1],c:p};})];
}
function buildMock() {
  const dates=tradingDates(121);
  const br=Array.from({length:120},(_,i)=>.0012*Math.sin(i*.37)+.0004*Math.cos(i*.13));
  const ar=br.map((v,i)=>1.25*v+.0003*Math.sin(i*.71));
  const cr=br.map((v,i)=>.65*v+.0005*Math.cos(i*.29));
  const b=priceSeries(dates,br), a=priceSeries(dates,ar,80), c=priceSeries(dates,cr,55);
  return {dates,br,b,a,c,input:{market:"tw",currency:"TWD",benchmarkMarket:"tw",benchmarkCurrency:"TWD",
    benchmark:b.map(x=>({date:x.date,adjustedClose:x.adjustedClose})),
    holdings:[{symbol:"A",market:"tw",currency:"TWD",marketValue:60000,daily:a.map(x=>({date:x.date,adjustedClose:x.adjustedClose}))},
      {symbol:"B",market:"tw",currency:"TWD",marketValue:40000,daily:c.map(x=>({date:x.date,adjustedClose:x.adjustedClose}))}]}};
}
function legacyPortRisk() {
  const source=readFileSync(new URL("../learner/quant.js",import.meta.url),"utf8");
  const sandbox={}; vm.createContext(sandbox); vm.runInContext(source,sandbox,{filename:"learner/quant.js"});
  assert.equal(typeof sandbox.portRisk,"function","quant.js must expose its classic-script portRisk function in a VM context");
  return sandbox.portRisk;
}
const close = (a,b,tol=1e-10) => assert.ok(Math.abs(a-b)<=tol, `expected ${a} ~= ${b}`);

test("Phase 2C：完整同市場 Mock 下舊新引擎核心指標可對照",()=>{
  const x=buildMock(), old=legacyPortRisk()([{c:"A",mv:60000,D:x.a},{c:"B",mv:40000,D:x.c}],x.b,120);
  const fresh=analyzePortfolioRisk(x.input);
  assert.equal(fresh.status,"ready");
  close(old.vol,fresh.metrics.annualizedVolatility);
  close(old.beta,fresh.metrics.beta);
  close(old.hhi,fresh.metrics.hhi);
  close(old.effN,fresh.metrics.effectiveHoldings);
  for(const row of old.rows){const n=fresh.metrics.rows.find(v=>v.symbol===row.c);assert.ok(n);close(row.vol,n.annualizedVolatility);close(row.beta,n.beta);close(row.ctr,n.varianceContribution);}
  close(old.worst.b,fresh.metrics.benchmarkWorst20Days.benchmarkReturn);
  assert.equal(old.worst.from,fresh.metrics.benchmarkWorst20Days.from);
  assert.equal(old.worst.to,fresh.metrics.benchmarkWorst20Days.to);
  assert.equal(fresh.methodology.analysisType,"current_weights_historical_scenario");
  assert.equal(fresh.methodology.varMethod,"historical_simulation_linear_interpolated_quantile");
  assert.notEqual(old.var95,-fresh.metrics.valueAtRiskReturn,"legacy floor quantile and new interpolated quantile are intentionally not identical");
});

test("Phase 2C：缺一個基準交易日的持股不應污染新版單日風險序列",()=>{
  const x=buildMock(), legacy=legacyPortRisk();
  const broken={...x.input,holdings:x.input.holdings.map((h,i)=>i===1?{...h,daily:h.daily.filter((_,j)=>j!==50)}:h)};
  const old=legacy([{c:"A",mv:60000,D:x.a},{c:"B",mv:40000,D:x.c.filter((_,j)=>j!==50)}],x.b,120);
  const fresh=analyzePortfolioRisk(broken);
  assert.equal(old.n,119);
  assert.equal(fresh.status,"partial");
  assert.ok(fresh.excluded.some(v=>v.symbol==="B"&&v.reason==="missing_benchmark_session_observation"));
  assert.equal(fresh.coverage.includedSymbols,1);
  assert.equal(fresh.coverage.observations,120);
});

test("Phase 2C：新版零波動相關係數採 null，與舊版 0 明確區分",()=>{
  const x=buildMock();
  x.input.holdings[1].daily=x.dates.map(date=>({date,adjustedClose:100}));
  const old=legacyPortRisk()([{c:"A",mv:60000,D:x.a},{c:"B",mv:40000,D:x.dates.map(date=>({d:date,c:100}))}],x.b,120);
  const fresh=analyzePortfolioRisk(x.input);
  assert.equal(old.C[0][1],0);
  assert.equal(fresh.metrics.pairs[0].correlation,null);
});
