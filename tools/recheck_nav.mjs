/* 独立复算 021967 的区间收益: 直接拉 pingzhongdata 原始净值, 不复用引擎。
 * 目的: 确认演示稿头条 +123.24% 到底对不对。 */
const CODE = process.argv[2] || '021967';
const url = `https://fund.eastmoney.com/pingzhongdata/${CODE}.js`;
const txt = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/' } })).text();

function grab(name) {
  const i = txt.indexOf(name);
  if (i < 0) return null;
  const eq = txt.indexOf('=', i);
  let s = txt.indexOf('[', eq), e = txt.lastIndexOf('];');
  if (s < 0) return null;
  return JSON.parse(txt.slice(s, e + 1));
}
const unit = grab('Data_netWorthTrend');
const acc = grab('Data_ACWorthTrend');
const nameM = /fS_name\s*=\s*"([^"]*)"/.exec(txt);
console.log('基金: ' + (nameM ? nameM[1] : '?') + ' (' + CODE + ')');
console.log('单位净值点数 ' + (unit ? unit.length : 0) + ' · 累计净值点数 ' + (acc ? acc.length : 0));
if (!unit) process.exit(1);

const d0 = new Date(unit[0].x).toISOString().slice(0, 10);
const dN = new Date(unit[unit.length - 1].x).toISOString().slice(0, 10);
console.log('单位净值  首 ' + d0 + ' = ' + unit[0].y + '   末 ' + dN + ' = ' + unit[unit.length - 1].y);
console.log('累计净值  首 ' + (acc ? new Date(acc[0][0]).toISOString().slice(0, 10) + ' = ' + acc[0][1] : '-') +
            '   末 ' + (acc ? new Date(acc[acc.length - 1][0]).toISOString().slice(0, 10) + ' = ' + acc[acc.length - 1][1] : '-'));

// 区间: 2025Q1 期初(2024-12-31/成立日) → 2026-06-30
const tEnd = Date.parse('2026-06-30T23:59:59+08:00');
const upto = unit.filter(p => p.x <= tEnd);
const lastPt = upto[upto.length - 1];
console.log('\n到 2026-06-30 为止最后一点: ' + new Date(lastPt.x).toISOString().slice(0, 10) + ' nav=' + lastPt.y);

// 分红
const divs = unit.filter(p => p && p.unitMoney);
console.log('区间内分红事件 ' + divs.length + ' 次: ' + divs.map(p => new Date(p.x).toISOString().slice(0, 10) + ' ' + p.unitMoney).join(' | '));

// 三种口径对比
const first = unit[0];
const naiveUnit = (lastPt.y / first.y - 1) * 100;
console.log('\n[口径A] 首末单位净值直接相除 = ' + naiveUnit.toFixed(2) + '%   (' + first.y + ' → ' + lastPt.y + ')');

if (acc) {
  const a0 = acc[0], aN = acc.filter(p => p[0] <= tEnd).slice(-1)[0];
  console.log('[口径B] 首末累计净值相除     = ' + ((aN[1] / a0[1] - 1) * 100).toFixed(2) + '%   (' + a0[1] + ' → ' + aN[1] + ')  ← 加法量, 比值无意义, 仅列作对照');
}

// 口径C: 分红再投(引擎口径) —— 独立实现
let tr = 1, prev = null, prevCum = 0, has = false;
const accMap = new Map((acc || []).map(p => [String(p[0]), p[1]]));
for (const p of unit) {
  if (p.x > tEnd) break;
  const a = accMap.get(String(p.x));
  const cum = (typeof a === 'number') ? Math.max(0, a - p.y) : prevCum;
  const d = Math.max(0, cum - prevCum);
  const dc = d >= 0.001 ? d : 0;
  if (!has) { tr = 1; } else { tr = tr * (p.y + dc) / prev; }
  prev = p.y; prevCum = cum; has = true;
}
console.log('[口径C] 分红再投总回报指数     = ' + ((tr - 1) * 100).toFixed(2) + '%   ← 引擎与演示稿用的口径');

console.log('\n=== 与官方季报逐季披露值对账 ===');
console.log('(需要季报"过去三个月"净值增长率; 见下)');
