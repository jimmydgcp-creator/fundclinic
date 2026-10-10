/* 收益口径校准: 用官方季报披露的「过去三个月/一年/三年/五年」净值增长率,
 * 反过来检验我们自己的收益算法到底对不对 —— 这就是 SOP 说的"叠法定报告复核"。
 * 用法: node tools/calibrate_perf.mjs 519191
 */
import { getReportList, downloadReportPdf, pdfBufferToText } from '../server/official.mjs';
import { getNavSeries, buildTotalReturnIndex } from '../server/sources.mjs';

const code = process.argv[2] || '519191';
const list = await getReportList(code, { pages: 2 });
const rep = list.find(r => r.kind === 'quarterly');
const text = pdfBufferToText(await downloadReportPdf(rep.id));
console.log('校准基准报告: ' + rep.title + '  (' + rep.date + ')\n');

/* 抽 3.2.1 表: 阶段 -> [净值增长率①, ...] */
const official = {};
for (const m of text.matchAll(/^\s*(过去三个月|过去六个月|过去一年|过去三年|过去五年|过去七年|过去十年)\s+(-?[\d.]+)%/gm)) {
  official[m[1]] = Number(m[2]);
}
console.log('官方披露的净值增长率:');
Object.entries(official).forEach(([k, v]) => console.log('  ' + k.padEnd(6) + ' ' + v + '%'));

/* 抽 期末基金份额净值 */
const navEnd = /5\.期末基金份额净值\s+([\d.]+)/.exec(text);
console.log('\n官方披露期末份额净值: ' + (navEnd ? navEnd[1] : '未抽到'));

const nav = await getNavSeries(code);
const ts = s => Date.parse(s + 'T00:00:00+08:00');
const at = (arr, t) => { let best = null; for (const p of arr) { if (p.t <= t) best = p; else break; } return best; };

const endDate = rep.date || new Date().toISOString().slice(0, 10);
// 报告期末(用报告发布日期上溯到季末)
const periodEnd = (() => {
  const m = /(\d{4})年第(\d)季度报告/.exec(rep.title);
  if (!m) return endDate;
  const q = Number(m[2]);
  const mm = q * 3, dd = [31, 30, 30, 31][q - 1];
  return `${m[1]}-${String(mm).padStart(2, '0')}-${String([31, 30, 31][q - 1] === 31 ? 31 : 30).padStart(2, '0')}`;
})();

const windows = { '过去三个月': 0.25, '过去六个月': 0.5, '过去一年': 1, '过去三年': 3, '过去五年': 5, '过去七年': 7, '过去十年': 10 };
const TR = buildTotalReturnIndex(nav.unitWorth, nav.accWorth);
console.log('\n=== 三种口径 vs 官方披露(报告期末 ' + periodEnd + ') ===');
console.log('  窗口        官方      累计净值法   差     单位净值法   差    分红再投指数   差');
let sa = 0, su = 0, st = 0, n = 0;
for (const [label, yrs] of Object.entries(windows)) {
  if (official[label] === undefined) continue;
  const t = ts(periodEnd) - Math.round(yrs * 365.25 * 86400000);
  const a0 = at(nav.accWorth, t), a1 = at(nav.accWorth, ts(periodEnd));
  const u0 = at(nav.unitWorth, t), u1 = at(nav.unitWorth, ts(periodEnd));
  const t0 = at(TR, t), t1 = at(TR, ts(periodEnd));
  if (!a0 || !a1 || !u0 || !u1 || !t0 || !t1) continue;
  const acc = (a1.nav / a0.nav - 1) * 100;
  const unit = (u1.nav / u0.nav - 1) * 100;
  const trr = (t1.nav / t0.nav - 1) * 100;
  const dA = acc - official[label], dU = unit - official[label], dT = trr - official[label];
  sa += Math.abs(dA); su += Math.abs(dU); st += Math.abs(dT); n++;
  console.log('  ' + label.padEnd(10) + String(official[label]).padStart(7) + '%' +
    String(acc.toFixed(2)).padStart(13) + '%' + String(dA.toFixed(2)).padStart(7) +
    String(unit.toFixed(2)).padStart(13) + '%' + String(dU.toFixed(2)).padStart(7) +
    String(trr.toFixed(2)).padStart(14) + '%' + String(dT.toFixed(2)).padStart(7));
}
console.log('\n  平均绝对偏差: 累计净值法 ' + (sa / n).toFixed(3) + 'pp   单位净值法 ' + (su / n).toFixed(3) + 'pp   分红再投指数 ' + (st / n).toFixed(3) + 'pp');
const bestMethod = st <= su ? '分红再投指数(本引擎采用)' : '单位净值法';
console.log('  结论: 采用「' + bestMethod + '」—— 与官方披露最贴近。');
console.log('  说明: 累计净值 = 单位净值 + 累计分红, 是加法累积量, 拿它做比值在数学上就是错的;');
console.log('        这正是 SOP v2.4 §2 第 5 类来源写"用累计净值算区间收益"埋下的口径错误, 已按 SOP 自身规则修正。');

/* 我们复盘区间那一格 */
console.log('\n=== 复盘区间 2020Q4末(2020-12-31) → 2026Q2末 ===');
const s = at(nav.accWorth, ts('2020-12-31')), e = at(nav.accWorth, ts(periodEnd));
const su2 = at(nav.unitWorth, ts('2020-12-31')), eu = at(nav.unitWorth, ts(periodEnd));
const st2 = at(TR, ts('2020-12-31')), et = at(TR, ts(periodEnd));
console.log('  累计净值法:   ' + s.nav + ' → ' + e.nav + '  = ' + ((e.nav / s.nav - 1) * 100).toFixed(2) + '%   (错误口径)');
console.log('  单位净值法:   ' + su2.nav + ' → ' + eu.nav + '  = ' + ((eu.nav / su2.nav - 1) * 100).toFixed(2) + '%');
console.log('  分红再投指数: ' + st2.nav.toFixed(4) + ' → ' + et.nav.toFixed(4) + '  = ' + ((et.nav / st2.nav - 1) * 100).toFixed(2) + '%   (本引擎采用)');
console.log('  期间分红: 2020-12-31 累计分红 ' + (s.nav - su2.nav).toFixed(4) + ' 元/份, 2026-06-30 累计分红 ' + (e.nav - eu.nav).toFixed(4) + ' 元/份');
const divDelta = (e.nav - eu.nav) - (s.nav - su2.nav);
console.log('  → 区间内新增分红 ' + divDelta.toFixed(4) + ' 元/份' + (Math.abs(divDelta) < 0.001 ? '(该区间未分红, 两种口径应一致)' : '(含分红, 必须回加)'));
