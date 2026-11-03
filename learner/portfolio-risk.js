/** Pure portfolio risk calculations; adjusted closes, one market/currency per run. */
export const PORTFOLIO_RISK_VERSION=1;
const rec=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const pos=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const date=x=>{if(typeof x!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const variance=a=>a.length<2?null:a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1);
const cov=(a,b)=>a.length!==b.length||a.length<2?null:a.reduce((s,x,i)=>s+(x-mean(a))*(b[i]-mean(b)),0)/(a.length-1);
const corr=(a,b)=>{const x=variance(a),y=variance(b);return x>0&&y>0?Math.max(-1,Math.min(1,cov(a,b)/Math.sqrt(x*y))):null;};
const quantile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),q=(s.length-1)*p,l=Math.floor(q),h=Math.ceil(q);return s[l]+(s[h]-s[l])*(q-l);};
const compound=a=>a.reduce((p,x)=>p*(1+x),1)-1;
function series(rows,label,asOf,issues){
 const m=new Map();let bad=0,future=0,dups=0;
 if(!Array.isArray(rows)){issues.push({code:"missing_series",severity:"error",subject:label});return m;}
 for(const r of rows){if(!rec(r)||!date(r.date)){bad++;continue;}if(asOf&&r.date>asOf){future++;continue;}if(m.has(r.date)){dups++;continue;}if(!pos(r.adjustedClose)){bad++;continue;}m.set(r.date,r.adjustedClose);}
 if(bad)issues.push({code:"invalid_observations",severity:"warning",subject:label,count:bad});
 if(future)issues.push({code:"future_observations_excluded",severity:"warning",subject:label,count:future});
 if(dups)issues.push({code:"duplicate_dates",severity:"error",subject:label,count:dups});
 return m;
}
export function analyzePortfolioRisk(input){
 const issues=[],excluded=[];
 if(!rec(input)||!["tw","us"].includes(input.market)||!Array.isArray(input.holdings)||!Array.isArray(input.benchmark))
  return {schemaVersion:1,status:"invalid",market:null,metrics:null,coverage:{totalHoldings:0,includedHoldings:0,excludedHoldings:0,observations:0},excluded,issues:[{code:"invalid_input",severity:"error"}]};
 const asOf=input.asOf??null,window=input.window??120,confidence=input.confidenceLevel??.95,shock=input.benchmarkShock??-.2;
 if((asOf!==null&&!date(asOf))||!Number.isInteger(window)||window<30||window>1000||!Number.isFinite(confidence)||confidence<=.5||confidence>=1||!Number.isFinite(shock)||shock>=0||shock< -1)
  return {schemaVersion:1,status:"invalid",market:input.market,metrics:null,coverage:{totalHoldings:input.holdings.length,includedHoldings:0,excludedHoldings:input.holdings.length,observations:0},excluded,issues:[{code:"invalid_parameters",severity:"error"}]};
 const bm=series(input.benchmark,"benchmark",asOf,issues), candidates=[],seen=new Set();
 for(const h of input.holdings){
  const symbol=typeof h?.symbol==="string"?h.symbol.trim().toUpperCase():"";
  const reason=!symbol?"invalid_symbol":seen.has(symbol)?"duplicate_symbol":(h.market!=null&&h.market!==input.market)?"market_mismatch":!pos(h.marketValue)?"invalid_market_value":!Array.isArray(h.daily)?"missing_series":null;
  if(reason){excluded.push({symbol:symbol||null,reason});issues.push({code:reason,severity:"error",subject:symbol||"unknown"});continue;}
  seen.add(symbol);const prices=series(h.daily,symbol,asOf,issues);
  if(prices.size<31){excluded.push({symbol,reason:"insufficient_history",validPrices:prices.size});issues.push({code:"insufficient_history",severity:"warning",subject:symbol});continue;}
  candidates.push({symbol,marketValue:h.marketValue,prices});
 }
 if(!candidates.length||bm.size<31)return {schemaVersion:1,status:"invalid",market:input.market,asOf,metrics:null,coverage:{totalHoldings:input.holdings.length,includedHoldings:0,excludedHoldings:excluded.length,observations:0},excluded,issues};
 let dates=[...candidates[0].prices.keys()].filter(d=>bm.has(d)&&candidates.every(x=>x.prices.has(d))).sort();
 if(dates.length>window+1)dates=dates.slice(-(window+1));
 if(dates.length<31){issues.push({code:"insufficient_common_history",severity:"error"});return {schemaVersion:1,status:"invalid",market:input.market,asOf,metrics:null,coverage:{totalHoldings:input.holdings.length,includedHoldings:0,excludedHoldings:input.holdings.length,observations:dates.length},excluded:[...excluded,...candidates.map(x=>({symbol:x.symbol,reason:"insufficient_common_history"}))],issues};}
 const returns=m=>dates.slice(1).map((d,i)=>m.get(d)/m.get(dates[i])-1);
 const assets=candidates.map(x=>({...x,r:returns(x.prices)})),br=returns(bm);
 if([...br,...assets.flatMap(x=>x.r)].some(x=>!Number.isFinite(x)||x<=-1)){issues.push({code:"invalid_return_observation",severity:"error"});return {schemaVersion:1,status:"invalid",market:input.market,asOf,metrics:null,coverage:{totalHoldings:input.holdings.length,includedHoldings:0,excludedHoldings:input.holdings.length,observations:0},excluded,issues};}
 const extremes=[];assets.forEach(a=>a.r.forEach((v,i)=>{if(Math.abs(v)>.5)extremes.push({symbol:a.symbol,date:dates[i+1],return:v});}));br.forEach((v,i)=>{if(Math.abs(v)>.5)extremes.push({symbol:"benchmark",date:dates[i+1],return:v});});
 if(extremes.length)issues.push({code:"extreme_return_observation",severity:"warning",count:extremes.length,observations:extremes.slice(0,20)});
 const total=assets.reduce((s,x)=>s+x.marketValue,0);
 if(!pos(total)){issues.push({code:"invalid_total_market_value",severity:"error"});return {schemaVersion:1,status:"invalid",market:input.market,asOf,metrics:null,coverage:{totalHoldings:input.holdings.length,includedHoldings:0,excludedHoldings:input.holdings.length,observations:0},excluded,issues};}
 const w=assets.map(x=>x.marketValue/total),pr=br.map((_,i)=>assets.reduce((s,x,j)=>s+w[j]*x.r[i],0)),pv=variance(pr),bv=variance(br);
 const beta=r=>bv>0?cov(r,br)/bv:null,pb=beta(pr),matrix=assets.map(a=>assets.map(b=>corr(a.r,b.r))),pairs=[];
 for(let i=0;i<assets.length;i++)for(let j=i+1;j<assets.length;j++)pairs.push({a:assets[i].symbol,b:assets[j].symbol,correlation:matrix[i][j]});
 const rows=assets.map((a,i)=>({symbol:a.symbol,marketValue:a.marketValue,weight:w[i],annualizedVolatility:Math.sqrt(variance(a.r)*252),beta:beta(a.r),riskContribution:pv>0?w[i]*cov(a.r,pr)/pv:null})).sort((a,b)=>b.weight-a.weight);
 const q=quantile(pr,1-confidence);let worst=null;
 if(br.length>=20)for(let i=0;i+20<=br.length;i++){const b=compound(br.slice(i,i+20));if(!worst||b<worst.benchmarkReturn)worst={from:dates[i],to:dates[i+20],benchmarkReturn:b,portfolioReturn:compound(pr.slice(i,i+20))};}
 const inRange=m=>[...m.keys()].filter(d=>d>=dates[0]&&d<=dates.at(-1)).length;
 const union=new Set([bm,...assets.map(x=>x.prices)].flatMap(m=>[...m.keys()].filter(d=>d>=dates[0]&&d<=dates.at(-1))));
 const dataCoverage=[{symbol:"benchmark",availablePrices:inRange(bm),commonPrices:dates.length,unionPrices:union.size},...assets.map(x=>({symbol:x.symbol,availablePrices:inRange(x.prices),commonPrices:dates.length,unionPrices:union.size}))];
 if(union.size>dates.length)issues.push({code:"non_common_observations",severity:"warning"});
 const status=excluded.length||issues.some(x=>x.severity==="error"||x.severity==="warning")?"partial":"ready";
 const hhi=w.reduce((s,x)=>s+x*x,0),loss=pb===null?null:Math.max(0,-pb*shock)*total;
 return {schemaVersion:1,status,market:input.market,asOf:dates.at(-1),
  methodology:{analysisType:"current_weights_historical_scenario",returnType:"adjusted_close",weightMode:"current_market_value",varMethod:"historical_simulation",confidenceLevel:confidence,holdingPeriodDays:1,annualizationDays:252,benchmarkShock:shock},
  coverage:{totalHoldings:input.holdings.length,includedHoldings:assets.length,excludedHoldings:excluded.length,observations:pr.length,from:dates[0],to:dates.at(-1),dataCoverage},
  metrics:{totalMarketValue:total,annualizedVolatility:pv===null?null:Math.sqrt(pv*252),beta:pb,
   correlationMatrix:assets.map((a,i)=>({symbol:a.symbol,values:matrix[i]})),pairs,
   averagePairCorrelation:pairs.length?mean(pairs.map(x=>x.correlation).filter(Number.isFinite)):null,
   hhi,effectiveHoldings:1/hhi,rows,tailReturnQuantile:q,valueAtRisk:q===null?null:Math.max(0,-q),
   worst20TradingDays:worst,benchmarkShockPortfolioReturn:pb===null?null:pb*shock,benchmarkShockEstimatedLoss:loss},excluded,issues};
}
