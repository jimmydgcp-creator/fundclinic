/* 探测: 官方季报 PDF 里能不能稳定抽到「业绩比较基准」, 以及它会不会中途变。
 * 这决定"基准中途调整要标注"这条 SOP 要求能否自动化。
 * 用法: node tools/probe_benchmark.mjs 519191 [期数上限]
 */
import { getReportList, downloadReportPdf, pdfBufferToText } from '../server/official.mjs';

const code = process.argv[2] || '519191';
const maxN = Number(process.argv[3] || 4);

const list = await getReportList(code, { pages: 2 });
const quarterly = list.filter(r => r.kind === 'quarterly' && r.period).sort((a, b) => (a.period < b.period ? 1 : -1));
console.log('季报总数: ' + quarterly.length);

/* 取样: 最新一期 + 最早一期 + 中间两期 —— 正好能看出会不会变 */
const picks = [];
if (quarterly.length) {
  picks.push(quarterly[0]);
  if (quarterly.length > 1) picks.push(quarterly[quarterly.length - 1]);
  const mid = Math.floor(quarterly.length / 2);
  if (quarterly[mid] && !picks.includes(quarterly[mid])) picks.push(quarterly[mid]);
}
const all = picks.slice(0, maxN);

for (const rep of all) {
  const text = pdfBufferToText(await downloadReportPdf(rep.id));
  console.log('\n===== ' + rep.period + '  ' + rep.title + ' =====');

  // 候选写法: 季报里通常在"基金产品概况"或"投资目标/投资策略"附近
  const patterns = [
    /业绩比较基准[^\n]{0,140}/g,
    /比较基准[^\n]{0,140}/g,
    /本基金的业绩比较基准[^\n]{0,160}/g
  ];
  let hits = [];
  for (const p of patterns) { hits = hits.concat([...text.matchAll(p)].map(m => m[0].trim())); }
  hits = [...new Set(hits)];
  if (!hits.length) { console.log('  ✗ 未抽到任何"基准"字样'); continue; }
  hits.slice(0, 4).forEach(h => console.log('  · ' + JSON.stringify(h.slice(0, 150))));

  // 试着抽成一条干净条款
  const clean = /业绩比较基准\s*[:：]?\s*([^\n。]{4,120})/.exec(text);
  console.log('  抽成条款: ' + (clean ? JSON.stringify(clean[1].trim()) : '（未命中"业绩比较基准：xxx"写法）'));
}
