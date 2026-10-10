/* 打包成"一个文件就能用"的版本, 并把报告页导出成 PDF。
 * 用法: node tools/build_standalone.mjs
 * 产物: 基金复诊台_单文件版.html (双击即用, 零依赖) 与 基金复诊台_复盘报告.pdf
 * 为什么要单文件: 交作业/发给组员时, 多文件目录容易漏文件、路径容易断; 单文件最稳。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_HTML = path.join(ROOT, '基金复诊台_单文件版.html');
const OUT_PDF = path.join(ROOT, '基金复诊台_复盘报告_519191.pdf');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) 内联 CSS
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  if (css.includes('</style')) throw new Error('CSS 含 </style, 需转义: ' + href);
  console.log('  内联 CSS  ' + href + '  ' + (css.length / 1024).toFixed(1) + ' KB');
  return '<style>\n' + css + '\n</style>';
});

// 2) 内联 JS
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(ROOT, src), 'utf8');
  if (/<\/script/i.test(js)) throw new Error('JS 含 </script, 需转义: ' + src);
  console.log('  内联 JS   ' + src + '  ' + (js.length / 1024).toFixed(1) + ' KB');
  return '<script>\n' + js + '\n</script>';
});

// 3) 断言: 没有残留的本地外链(只看 HTML 骨架, 不扫描内联进去的 JS 字符串)
const skeleton = html.replace(/<script[\s\S]*?<\/script>/g, '<script></script>').replace(/<style[\s\S]*?<\/style>/g, '<style></style>');
const leftovers = [...skeleton.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map(m => m[1]);
/* 剪掉所有 data: URI 之后再找 url()。
   为什么: 背景纸纹是一条 data:image/svg+xml, 而那个 SVG **内部**还有一层
   filter='url(%23n)' —— 直接全串扫描会把内层这个当成"本地外链"报出来(踩过两次:
   第一次漏报成 %23n, 第二次我把 data URI 换成 "DATA" 这个占位串, 它自己又被当成外链)。
   所以必须**按引号配对**整段摘掉, 且替换成 `url()` 这种不会再被匹配的空壳。 */
const withoutDataUris = html
  .replace(/url\(\s*"data:[^"]*"\s*\)/g, 'url()')
  .replace(/url\(\s*'data:[^']*'\s*\)/g, 'url()')
  .replace(/url\(\s*data:[^)]*\)/g, 'url()');
const cssUrl = [...withoutDataUris.matchAll(/url\(\s*['"]?(?!data:|https?:)([^'")]+)['"]?\s*\)/g)].map(m => m[1]);
if (leftovers.length || cssUrl.length) {
  console.error('仍有本地外链, 单文件版会缺资源: ' + JSON.stringify({ leftovers, cssUrl }));
  process.exit(1);
}
console.log('  外链检查   0 条本地引用(含 CSS url())');

html = html.replace('<title>', '<!-- 单文件版: 由 tools/build_standalone.mjs 生成, 源文件在 index.html + app/ + data/ -->\n<title>');
fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log('  写出       ' + path.basename(OUT_HTML) + '  ' + (fs.statSync(OUT_HTML).size / 1024).toFixed(0) + ' KB\n');

// 4) 导出 PDF(用无头 Edge 打印 #report 视图; 打印样式里已强制只有激活视图可见、无动画)
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe, 跳过 PDF'); process.exit(0); }

execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + path.join(os.tmpdir(), 'fc-pdf-profile'),
  '--virtual-time-budget=12000', '--allow-file-access-from-files',
  '--no-pdf-header-footer', '--print-to-pdf-no-header',
  '--print-to-pdf=' + OUT_PDF,
  pathToFileURL(OUT_HTML).href + '#report'
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

console.log('  写出       ' + path.basename(OUT_PDF) + '  ' + (fs.statSync(OUT_PDF).size / 1024).toFixed(0) + ' KB');
console.log('\n下一步: node tools/check_pdf_text.mjs   (校验 PDF 里没有"看不见/丢失"的文字)');
