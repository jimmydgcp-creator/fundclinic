/* 调试: 把官方 PDF 里"前十名股票投资明细"区域的原始行打出来, 看解析器为什么漏行。
 * 用法: node tools/debug_official_rows.mjs 519191 2019Q1 2020Q1
 */
import { getReportList, downloadReportPdf, pdfBufferToText } from '../server/official.mjs';

const code = process.argv[2] || '519191';
const periods = process.argv.slice(3);
const list = await getReportList(code, { pages: 2 });

for (const p of periods) {
  const rep = list.find(r => r.period === p && r.kind === 'quarterly');
  if (!rep) { console.log('未找到 ' + p + ' 的季报'); continue; }
  const buf = await downloadReportPdf(rep.id);
  const text = pdfBufferToText(buf);
  const lines = text.split(/\r?\n/);
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/前十名股票投资明细/.test(lines[i]) && !/所有股票投资明细/.test(lines[i])) { s = i; break; }
  }
  console.log('\n########## ' + p + '  ' + rep.title + '  (表头行号 ' + s + ')');
  if (s < 0) { console.log('  未找到表头'); continue; }
  for (let i = s; i < Math.min(lines.length, s + 20); i++) {
    console.log(String(i - s).padStart(3) + ' | ' + JSON.stringify(lines[i]));
  }
}
