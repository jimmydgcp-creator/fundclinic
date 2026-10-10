/* 验证假设: 季报 §3.2.1 绩效表里 A/C 两类各一行, parsePerfTable 取到了 C 类。
 * 直接下载 021967 的官方季报 PDF, 把「净值增长率及其与同期业绩比较基准收益率的比较」整段原文打出来。 */
import { getReportList, downloadReportPdf } from '../server/official.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const code = process.argv[2] || '021967';
const list = await getReportList(code);
console.log('报告列表 ' + list.length + ' 份, 取最新一份: ' + list[0].title + ' (' + list[0].period + ')');
const buf = await downloadReportPdf(list[0].id);
const tmp = path.join(os.tmpdir(), 'fundclinic_diag_' + code + '.pdf');
fs.writeFileSync(tmp, buf);

let text = '';
try {
  text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
} catch (e) {
  console.error('pdftotext 不可用: ' + e.message);
  process.exit(1);
}

const key = '基金份额净值增长率及其与同期业绩比较基准收益率的比较';
const i = text.indexOf(key);
console.log('\n=== §3.2.1 原文 (' + i + ') ===');
console.log(text.slice(Math.max(0, i - 700), i + 1400));
fs.unlinkSync(tmp);
