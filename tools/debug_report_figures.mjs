/* 调试: 看官方季报里"主要财务指标 / 基金净值表现"段落长什么样, 以便抽「份额净值增长率」。
 * 用法: node tools/debug_report_figures.mjs 519191 2026Q2
 */
import { getReportList, downloadReportPdf, pdfBufferToText } from '../server/official.mjs';

const code = process.argv[2] || '519191';
const period = process.argv[3] || '2026Q2';
const list = await getReportList(code, { pages: 2 });
const rep = list.find(r => r.period === period && r.kind === 'quarterly');
if (!rep) { console.log('未找到 ' + period); process.exit(1); }
const text = pdfBufferToText(await downloadReportPdf(rep.id));
const lines = text.split(/\r?\n/);

const marks = [
  ['主要财务指标', /主要财务指标/],
  ['净值表现', /基金净值表现|净值增长率|份额净值增长率/],
  ['业绩表现', /报告期内基金的业绩表现/],
  ['期末份额净值', /期末基金份额净值|期末份额净值/]
];
for (const [label, re] of marks) {
  const idxs = [];
  lines.forEach((l, i) => { if (re.test(l) && idxs.length < 3) idxs.push(i); });
  console.log('\n===== ' + label + '  行号 ' + JSON.stringify(idxs));
  idxs.forEach(i => {
    for (let k = i; k < Math.min(lines.length, i + 16); k++) console.log('  ' + k + ' | ' + JSON.stringify(lines[k]));
    console.log('  ---');
  });
}
