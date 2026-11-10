/* 重打完 PDF / 改完文件之后, 把 run.json 里记的文件体积(下载按钮上显示的大小)对齐。
 * 用法: node tools/fix_run_sizes.mjs <code>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = process.argv[2] || '519191';
const DIR = path.join(ROOT, '_runs', code);
const p = path.join(DIR, 'run.json');
const run = JSON.parse(fs.readFileSync(p, 'utf8'));
let n = 0;
for (const [k, v] of Object.entries(run.summary.files || {})) {
  const f = path.isAbsolute(v.path) ? v.path : path.join(ROOT, v.rel || v.path);
  if (fs.existsSync(f)) { run.summary.files[k].bytes = fs.statSync(f).size; n++; }
}
if (run.summary.pdf) {
  const f = path.isAbsolute(run.summary.pdf.path) ? run.summary.pdf.path : path.join(ROOT, run.summary.pdf.rel);
  if (fs.existsSync(f)) { run.summary.pdf.bytes = fs.statSync(f).size; n++; }
}
fs.writeFileSync(p, JSON.stringify(run, null, 2), 'utf8');
console.log('已同步 ' + n + ' 个文件体积 -> run.json');
for (const [k, v] of Object.entries(run.summary.files || {})) console.log('  ' + k.padEnd(12) + (v.bytes / 1024).toFixed(0) + ' KB  ' + (v.name || v.rel || ''));
if (run.summary.pdf) console.log('  pdf         ' + (run.summary.pdf.bytes / 1024).toFixed(0) + ' KB');
