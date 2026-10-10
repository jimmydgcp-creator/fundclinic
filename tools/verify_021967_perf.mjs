/* 核验 021967 的区间收益 123.24% 是否可溯源。
 * 用官方季报披露的「过去三个月」净值增长率逐季连乘, 看能否复现。 */
import fs from 'node:fs';

const dir = process.argv[2] || 'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\04_网页项目_基金复诊台\\_runs\\021967';
const a = JSON.parse(fs.readFileSync(dir + '/analysis.json', 'utf8'));
const d = JSON.parse(fs.readFileSync(dir + '/datasetMeta.json', 'utf8'));

console.log('=== analysis.perf ===');
console.log(JSON.stringify(a.perf, null, 1));

const off = d.official || {};
console.log('\n=== official.perf / talks 可用字段 ===');
console.log(Object.keys(off).join(', '));
const perf = off.perf || off.perfTable || null;
if (perf) console.log(JSON.stringify(perf).slice(0, 1200));
for (const c of (off.checks || [])) {
  if (c.perf) console.log(c.period, JSON.stringify(c.perf).slice(0, 400));
}

console.log('\n=== 逐季官方净值增长率 (checks[].perf) 连乘 ===');
let acc = 1, n = 0;
for (const c of (off.checks || [])) {
  const p = c.perf || {};
  const q = p['过去三个月'];
  if (q === undefined) continue;
  const nav = typeof q === 'object' ? q.nav : q;
  acc *= (1 + nav / 100); n++;
  console.log('  ' + c.period + '  ' + nav + '%  (累计指数 ' + acc.toFixed(4) + ')');
}
console.log('  n=' + n + '  官方逐季连乘 = ' + ((acc - 1) * 100).toFixed(2) + '%');

console.log('\n=== datasetMeta.perfDetail ===');
console.log(JSON.stringify(d.perfDetail || '(空)').slice(0, 900));

console.log('\n=== 报告里的绩效段 ===');
const md = fs.readFileSync(dir + '/复盘报告_西部利得均衡优选混合A_021967.md', 'utf8');
const i = md.indexOf('## 三'), j = md.indexOf('## 四');
console.log(md.slice(i, j).slice(0, 900));
