/* 生成「复盘台」正式变体页：index_复盘台.html
 * 做法：读原 index.html，只做四处替换（标题、页签文案、样式层、脚本层），
 * 原文件一个字不动 —— 这样中期那版随时能退回去。
 * 用法：node tools/make_variant_page.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'index_复盘台.html');

let html = fs.readFileSync(SRC, 'utf8');
const before = html;

const REPL = [
  [/<title>[^<]*<\/title>/, '<title>基金复诊台 · 复盘台</title>'],
  // 页签文案：去掉序号，改成工作台口径
  ['① 输入与口径', '复盘台'],
  ['② 复盘报告', '报告'],
  ['③ 数据底稿', '底稿'],
  ['④ 质检与 AI 记录', '质检'],
  ['⑥ 横向对比', '横向对比'],
  ['⑤ 这个网页做什么', '说明'],
  // 样式层：接在原有两张表后面
  ['<link rel="stylesheet" href="app/workbench.css">',
    '<link rel="stylesheet" href="app/workbench.css">\n<link rel="stylesheet" href="app/variant.css">'],
  // 脚本层：接在最后
  ['<script src="app/chat.js"></script>',
    '<script src="app/chat.js"></script>\n<script src="app/variant.js"></script>']
];

for (const [from, to] of REPL) {
  if (typeof from === 'string') {
    if (!html.includes(from)) console.warn('! 没找到片段：' + from.slice(0, 40));
    html = html.split(from).join(to);
  } else {
    html = html.replace(from, to);
  }
}

if (html === before) { console.error('没有任何替换生效，检查 index.html 结构'); process.exit(1); }

fs.writeFileSync(OUT, html, 'utf8');
console.log('写出 ' + OUT);
console.log('  ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');

/* 自检：几个关键片段必须在 */
const must = ['app/variant.css', 'app/variant.js', '复盘台', '横向对比'];
const miss = must.filter(s => !html.includes(s));
console.log('  内容自检 ' + (miss.length ? '✗ 缺: ' + miss.join('、') : '✓ ' + must.length + ' 项齐全'));
