/* 调试: 某只基金的经理履历 + 它最新季报的官方前十表为什么抽不出来。 */
import { getManagerHistory } from '../server/sources.mjs';
import { getReportList, downloadReportPdf, pdfBufferToText, parseOfficialTop10 } from '../server/official.mjs';

const code = process.argv[2] || '005827';

const mh = await getManagerHistory(code);
console.log('=== 经理履历(' + code + ') ===');
mh.rows.slice(0, 8).forEach(r => console.log(`  ${r.start} ~ ${r.end}  [${r.managers.join(' / ')}]  共管=${r.coManaged}  ${r.tenure}  ${r.returnPct}%`));
console.log('  当前 = ' + JSON.stringify(mh.current));

const list = await getReportList(code, { pages: 1 });
const rep = list.find(r => r.kind === 'quarterly');
console.log('\n=== 最新季报: ' + rep.title + ' ===');
const text = pdfBufferToText(await downloadReportPdf(rep.id));
const lines = text.split(/\r?\n/);
let s = -1;
for (let i = 0; i < lines.length; i++) {
  if (/前十名股票投资明细/.test(lines[i]) && !/所有股票投资明细/.test(lines[i])) { s = i; break; }
}
console.log('  "前十名股票投资明细" 行号 = ' + s);
if (s >= 0) for (let i = s; i < Math.min(lines.length, s + 16); i++) console.log('  ' + String(i - s).padStart(3) + ' | ' + JSON.stringify(lines[i]));
else {
  console.log('  未找到该标题, 含"前十"字样的行:');
  lines.forEach((l, i) => { if (/前十/.test(l)) console.log('    ' + i + ' | ' + JSON.stringify(l.slice(0, 100))); });
}
console.log('  解析结果 = ' + parseOfficialTop10(text).length + ' 行');
