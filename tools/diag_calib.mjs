/* 查 021967 逐季校准系统性偏高 ~0.11pp 的原因。
 * 思路: 引擎的逐季收益 = nav(季末)/nav(上季末) - 1, 与官方「过去三个月」应当完全相等。
 * 把两端净值、所用日期、官方值并排列出, 差额落在哪一端一眼可见。 */
const CODE = process.argv[2] || '021967';
const txt = await (await fetch(`https://fund.eastmoney.com/pingzhongdata/${CODE}.js`,
  { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/' } })).text();

/** 从 "var X = [" 起按括号配平取整个数组 —— 不能用 lastIndexOf('];'), 会吃到后面所有变量。 */
function grab(name) {
  const i = txt.indexOf('var ' + name);
  if (i < 0) return null;
  const s = txt.indexOf('[', i);
  let depth = 0, j = s;
  for (; j < txt.length; j++) {
    if (txt[j] === '[') depth++;
    else if (txt[j] === ']') { depth--; if (!depth) break; }
  }
  return JSON.parse(txt.slice(s, j + 1));
}
const unit = grab('Data_netWorthTrend');
const acc = grab('Data_ACWorthTrend');
const cst = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

console.log('单位净值 ' + unit.length + ' 点 · 累计净值 ' + acc.length + ' 点');
const divDays = unit.filter(p => p.unitMoney && String(p.unitMoney).trim());
console.log('分红/拆分事件 ' + divDays.length + ' 次' + (divDays.length ? ': ' + divDays.map(p => cst(p.x) + ' ' + p.unitMoney).join(' | ') : ''));

/* 引擎用的 at(): 取最后一个 t <= 目标日 00:00+08 的点 */
const at = ymdStr => {
  const t = Date.parse(ymdStr + 'T00:00:00+08:00');
  let best = null;
  for (const p of unit) { if (p.x <= t) best = p; else break; }
  return best;
};
const navOn = ymdStr => { const p = at(ymdStr); return p ? { d: cst(p.x), nav: p.y } : null; };

const OFFICIAL = { '2025Q2': 5.77, '2025Q3': 35.30, '2025Q4': 1.19, '2026Q1': -0.11, '2026Q2': 44.95 };
const ENDS = { '2025Q2': '2025-06-30', '2025Q3': '2025-09-30', '2025Q4': '2025-12-31', '2026Q1': '2026-03-31', '2026Q2': '2026-06-30' };
const PREV = { '2025Q2': '2025-03-31', '2025Q3': '2025-06-30', '2025Q4': '2025-09-30', '2026Q1': '2025-12-31', '2026Q2': '2026-03-31' };

console.log('\n期      | 引擎端点            | 区间                  | 引擎     | 官方    | 差');
console.log('-'.repeat(84));
for (const q of Object.keys(OFFICIAL)) {
  const a = navOn(PREV[q]), b = navOn(ENDS[q]);
  const r = (b.nav / a.nav - 1) * 100;
  console.log(q + ' | ' + (a.d + ' ' + a.nav).padEnd(19) + ' | ' + (a.d + '→' + b.d).padEnd(21) + ' | ' +
    (r.toFixed(2) + '%').padStart(7) + ' | ' + (OFFICIAL[q] + '%').padStart(6) + ' | ' + ((r - OFFICIAL[q]).toFixed(2) + 'pp').padStart(7));
}

/* 若官方窗口其实是「季度首个交易日 → 季末」, 差额应当消失 */
console.log('\n假设官方用「季度首个交易日 → 季末」:');
const FIRST = { '2025Q2': '2025-04-01', '2025Q3': '2025-07-01', '2025Q4': '2025-10-01', '2026Q1': '2026-01-01', '2026Q2': '2026-04-01' };
for (const q of Object.keys(OFFICIAL)) {
  const a = at(FIRST[q]), b = navOn(ENDS[q]);
  if (!a) { console.log('  ' + q + ' 无起点数据'); continue; }
  const r = (b.nav / a.y - 1) * 100;
  console.log('  ' + q + ' 起点 ' + cst(a.x) + ' 引擎 ' + r.toFixed(2) + '% 官方 ' + OFFICIAL[q] + '% 差 ' + (r - OFFICIAL[q]).toFixed(2) + 'pp');
}

/* 累计净值 vs 单位净值 是否一致(021967 应无分红, 两者相等) */
const accMap = new Map(acc.map(p => [p.x, p[1]]));
let maxGap = 0, gapDay = '';
for (const p of unit) {
  const ac = accMap.get(p.x);
  if (typeof ac !== 'number') continue;
  const g = Math.abs(ac - p.y);
  if (g > maxGap) { maxGap = g; gapDay = cst(p.x); }
}
console.log('\n单位净值与累计净值最大差 ' + maxGap.toFixed(4) + ' (于 ' + gapDay + ')  → 0 表示全期无分红, 收益率应纯粹等于净值比值');
