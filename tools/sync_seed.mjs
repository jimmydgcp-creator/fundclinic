/* 把 _runs/<code> 的成果同步到 _seed/<code>(展台打包只读 _seed)。
 * 只同步"成品"文件, 不带 PDF 与临时文件。
 * 用法: node tools/sync_seed.mjs <code>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = process.argv[2] || '519191';
const SRC = path.join(ROOT, '_runs', code);
const DST = path.join(ROOT, '_seed', code);
const list = fs.readdirSync(SRC).filter(n =>
  /^(analysis|check|datasetMeta|fit|navSeries|run)\.json$/.test(n) ||
  /^(底稿_|复盘报告_|来源清单_|演示稿_|结论卡_|错误检查记录_).*\.(json|md|html)$/.test(n)
);
fs.mkdirSync(DST, { recursive: true });
for (const n of list) {
  fs.copyFileSync(path.join(SRC, n), path.join(DST, n));
  console.log('  ' + n + '  ' + (fs.statSync(path.join(DST, n)).size / 1024).toFixed(1) + ' KB');
}
console.log('同步 ' + list.length + ' 个文件 -> _seed/' + code);
