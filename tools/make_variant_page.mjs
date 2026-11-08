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
  /* 文案：顶部横排标签已换成"左栏 + 顶栏分段控件"(2026-11-08), 这里跟着换新外壳上的字。
     每一条找不到都会打警告, 不会静默失败 —— 但允许某条不存在(文案可能再调)。 */
  ['>开工台<', '>复盘台<'],
  ['>复盘报告<', '>报告<'],
  ['>数据底稿<', '>底稿<'],
  ['这个网页做什么<span class="k">↗</span>', '说明<span class="k">↗</span>'],
  // 样式层：接在 shell.css 之后
  ['<link rel="stylesheet" href="app/shell.css">',
    '<link rel="stylesheet" href="app/shell.css">\n<link rel="stylesheet" href="app/variant.css">'],
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
