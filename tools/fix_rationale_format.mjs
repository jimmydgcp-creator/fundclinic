/* 把 项目缘起_为什么做基金复诊台.txt 里的 **加粗** 换成「」。
 * 它是 .txt 不是 .md —— 星号在记事本里只会显示成星号。
 * 用 Node 写, 保证 UTF-8 无 BOM + CRLF, 和别的交付文本一致。
 * 用法: node tools/fix_rationale_format.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGETS = [
  path.join(ROOT, '项目缘起_为什么做基金复诊台.txt'),
  'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\00_交作业\\项目缘起_为什么做基金复诊台.txt'
];

for (const f of TARGETS) {
  if (!fs.existsSync(f)) { console.log('  跳过(不存在): ' + f); continue; }
  const before = fs.readFileSync(f, 'utf8');
  const n = (before.match(/\*\*[^*\n]+\*\*/g) || []).length;
  const after = before.replace(/\*\*([^*\n]+)\*\*/g, '「$1」').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  fs.writeFileSync(f, Buffer.from(after, 'utf8'));
  console.log('  ' + path.basename(f) + ': 替换 ' + n + ' 处 **  → 「」  ·  ' + after.length + ' 字符');
}
