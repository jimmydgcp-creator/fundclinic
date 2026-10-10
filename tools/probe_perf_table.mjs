/* 探测: 官方季报 3.2.1 表能否稳定抽出「①净值增长率」与「③业绩比较基准收益率」。
 * 这两列是"年度超额表"的全部数据源 —— 抽得出来, 深度归因才做得动。
 * 用法: node tools/probe_perf_table.mjs 519191
 */
import { getReportList, downloadReportPdf, pdfBufferToText } from '../server/official.mjs';

const code = process.argv[2] || '519191';
const list = await getReportList(code, { pages: 2 });
const q = list.filter(r => r.kind === 'quarterly' && r.period).sort((a, b) => (a.period < b.period ? 1 : -1));

const picks = [q[0], q[Math.floor(q.length / 2)], q[q.length - 1]].filter(Boolean);
for (const rep of picks) {
  const text = pdfBufferToText(await downloadReportPdf(rep.id));
  console.log('\n===== ' + rep.period + ' =====');
  const i = text.search(/基金份额净值增长率及其与同期业绩比较基准收益率的比较/);
  if (i < 0) { console.log('  未找到 3.2.1 表'); continue; }
  const chunk = text.slice(i, i + 900);
  console.log(chunk.split('\n').slice(0, 20).join('\n'));

  // 尝试解析
  const rows = {};
  const re = /^\s*(过去三个月|过去六个月|过去一年|过去三年|过去五年|过去七年|过去十年|自基金合同生效起至今)\s+(-?[\d.]+)%\s+([\d.]+)%\s+(-?[\d.]+)%\s+([\d.]+)%\s+(-?[\d.]+)%\s+([\d.]+)%/;
  for (const line of chunk.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) rows[m[1]] = { nav: Number(m[2]), bench: Number(m[4]), excess: Number(m[6]) };
  }
  console.log('  → 解析结果: ' + JSON.stringify(rows));
}
