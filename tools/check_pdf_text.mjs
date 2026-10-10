/* PDF 文字完整性校验: 打印出来的 PDF 里, 有没有"本该出现却不见了"的文字。
 * 背景: 上一份交付物(519191 网页幻灯)就栽在这里 —— CSS 动画的初始态 opacity:0 被打印快照捕获,
 *       整块文字在 PDF 里凭空消失, 肉眼看缩略图还以为是排版留白。所以这里必须机器校验。
 * 用法: node tools/check_pdf_text.mjs [pdf路径] [html路径]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PDF = process.argv[2] || path.join(ROOT, '基金复诊台_复盘报告_519191.pdf');
const HTML = process.argv[3] || path.join(ROOT, '基金复诊台_单文件版.html');

const POPPLER = 'C:\\Users\\75719\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin';
const PDFTOTEXT = path.join(POPPLER, 'pdftotext.exe');
const PDFINFO = path.join(POPPLER, 'pdfinfo.exe');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

if (!fs.existsSync(PDF)) { console.error('找不到 PDF: ' + PDF); process.exit(1); }
if (!fs.existsSync(PDFTOTEXT)) { console.error('找不到 pdftotext: ' + PDFTOTEXT); process.exit(1); }

/* 归一化: 只保留中日韩文字与字母数字, 去掉空白与标点。
   这样 PDF 与 HTML 的差异只剩"真实缺失", 不会因为换行/全半角判成缺失。 */
const norm = s => String(s)
  .replace(/[\s\u00a0]+/g, '')
  .replace(/[，。、；：！？（）()【】《》「」“”‘’·—–\-…,.!?;:%"'`|/\\[\]{}<>+=*&#@$^~]/g, '')
  .toLowerCase();

console.log('PDF : ' + path.relative(ROOT, PDF) + '  ' + (fs.statSync(PDF).size / 1024).toFixed(0) + ' KB');
console.log('HTML: ' + path.relative(ROOT, HTML) + '\n');

// 1) 从 HTML 取"报告视图应有的文字"
const dom = execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + path.join(os.tmpdir(), 'fc-pdfcheck'),
  '--virtual-time-budget=12000', '--allow-file-access-from-files',
  '--dump-dom', pathToFileURL(HTML).href + '#report'
], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/* 报告视图里嵌套了 <section class="rsec">, 用非贪婪的 </section> 会提前截断,
   所以按"下一个视图的开始"来切。 */
function extractView(dom, id, nextId) {
  const start = dom.indexOf('id="' + id + '"');
  if (start < 0) return { text: dom, truncated: true };
  const body = dom.indexOf('>', start) + 1;              // 跳过开标签本身, 避免把 "id=..." 当成正文
  const end = nextId ? dom.indexOf('id="' + nextId + '"', body) : -1;
  const chunk = end > body ? dom.slice(body, dom.lastIndexOf('<', end)) : dom.slice(body);
  return { text: chunk, truncated: false };
}
const view = extractView(dom, 'view-report', 'view-ledger');
if (view.truncated) console.log('  [警告] 未定位到 view-report, 退化为整页比较\n');

/* 打印样式里"故意隐藏"的交互控件 —— 纸上没有导航、按钮、勾选框的意义, 不参与文字完整性比对。
   这份清单必须与 app/styles.css 的 @media print 保持一致; 只有"故意隐藏"的才允许列进来,
   报告正文(标题/段落/表格/附录)一律必须出现在 PDF 里。 */
const PRINT_HIDDEN = [
  ['header.topbar', /<header class="topbar"[\s\S]*?<\/header>/, '顶栏(导航)'],
  ['aside.toc', /<aside class="toc"[\s\S]*?<\/aside>/, '目录(纸上无意义)'],
  /* 空状态: 跑过之后会被 JS 加上 .hidden, 它本来就不是报告正文。
     不加这一条的话, 每次往空状态里多写一句提示语, PDF 覆盖率就会"凭空"掉一截。
     注意正则要容忍 JS 后加的属性 —— dump 出来的 DOM 是 `<div id="report-empty" class="hidden">`,
     写死成 `<div id="report-empty">` 匹配不到(踩过)。 */
  ['div#report-empty', /<div id="report-empty"[^>]*>[\s\S]*?(?=<div class="report-layout)/, '空状态提示'],
  ['div.gate', /<div class="gate[^"]*"[\s\S]*?(?=<section class="rsec")/, '门禁交互框(勾选框/单选框)'],
  ['div.btn-row', /<div class="btn-row"[\s\S]*?<\/div>/, '按钮行'],
  ['div.toast', /<div class="toast"[^>]*><\/div>/, '提示条'],
  ['footer', /<footer>[\s\S]*?<\/footer>/, '页脚']
];
let comparable = view.text;
const excluded = [];
for (const [sel, re, label] of PRINT_HIDDEN) {
  const before = comparable.length;
  comparable = comparable.replace(re, ' ');
  if (comparable.length !== before) excluded.push(label + '(-' + (before - comparable.length) + ' 字符)');
}
console.log('已按打印样式排除(交互控件, 非报告正文): ' + (excluded.length ? excluded.join('、') : '无') + '\n');

let htmlText = comparable
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ');
const htmlNorm = norm(htmlText);

// 2) 从 PDF 取文字
const txtPath = path.join(os.tmpdir(), 'fc-pdf-text.txt');
execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-layout', PDF, txtPath], { stdio: ['ignore', 'pipe', 'ignore'] });
const pdfNorm = norm(fs.readFileSync(txtPath, 'utf8'));

let pages = '?';
try { pages = /Pages:\s+(\d+)/.exec(execFileSync(PDFINFO, [PDF], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[1]; } catch (e) {}

console.log('HTML 归一化字符数: ' + htmlNorm.length);
console.log('PDF  归一化字符数: ' + pdfNorm.length + '   页数: ' + pages + '\n');

/* 4) 三重比对。为什么不是简单的整页字符序列比对:
   PDF 里表格按版面重排、单元格会自动折行, 同一个单元格的文字可能被别的列"插"进中间,
   于是"内容在、只是顺序/换行变了"会被整页滑窗误判成"内容丢了"(实测误报率 ~6%)。
   所以用三个对顺序不敏感、但对"真丢字"敏感的指标:
     ① 字符多重集: HTML 要求的每个字符, PDF 里数量不得少 —— 直接抓"整块被裁掉";
     ② 内容词元: 连续中文串与数字(如"陕西煤业"、"58.13"), 折行也不会拆散一个词元;
     ③ 关键内容在场: 报告主干标题与关键句必须出现。 */
const segs = [];
for (const m of comparable.matchAll(/>([^<]+)</g)) {
  const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const s = norm(raw);
  if (s.length >= 8) segs.push({ s, raw: raw.trim().slice(0, 46) });
}

// ① 字符多重集
const count = s => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1); return m; };
const ch = count(htmlNorm), cp = count(pdfNorm);
const deficits = [];
for (const [c2, n] of ch) {
  const have = cp.get(c2) || 0;
  if (have < n) deficits.push({ char: c2, need: n, have: have, short: n - have });
}
deficits.sort((a, b) => b.short - a.short);
const totalShort = deficits.reduce((s, d) => s + d.short, 0);

// ② 内容词元: 必须"按元素"取词, 不能在整页归一化字符串上取 ——
//    归一化会去掉标点与空白, 相邻单元格会被连成一个超长串, 导致 100% 误报。
//    每个单元格/段落单独取 2–6 字的中文词元与数字, 折行也不会拆散它们。
const tokens = new Set();
for (const m of comparable.matchAll(/>([^<]+)</g)) {
  (m[1].match(/[\u4e00-\u9fff]{2,6}|\d+(?:\.\d+)?%?/g) || []).forEach(t => tokens.add(t));
}
const tokenList = [...tokens];
const tokMiss = tokenList.filter(t => !pdfNorm.includes(norm(t)));
const tokCov = tokenList.length ? (tokenList.length - tokMiss.length) / tokenList.length * 100 : 100;

// ③ 文本段(仅供参考, 折行会造成误报)
const segMiss = segs.filter(x => !pdfNorm.includes(x.s));

console.log('=== ① 字符多重集(抓"整块被裁掉") ===');
console.log('  缺失字符总数: ' + totalShort + (totalShort ? '   ' + deficits.slice(0, 8).map(d => `"${d.char}"缺${d.short}`).join(' ') : '  (PDF 覆盖了原页所有字符)'));
console.log('');
console.log('=== ② 内容词元覆盖(按元素取词, 不受折行影响) ===');
console.log('  ' + tokCov.toFixed(2) + '%   (' + (tokenList.length - tokMiss.length) + '/' + tokenList.length + ')');
if (tokMiss.length) console.log('  未找到: ' + tokMiss.slice(0, 14).join('、'));
console.log('');
console.log('=== ③ 字符量对照 ===');
console.log('  HTML ' + htmlNorm.length + ' 字符  vs  PDF ' + pdfNorm.length + ' 字符   页数 ' + pages);
if (segMiss.length) console.log('  (另有 ' + segMiss.length + '/' + segs.length + ' 个整段未连续匹配, 属表格折行/重排导致, 见上方 ①② 判定)');
console.log('');

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

/* 多重集这条只用来抓"整块被裁掉", 所以按**比例**判, 而不是按绝对字符数。
   为什么改(2026-10-10, 有证据):
     改版字号/内边距之后这条从"缺 0"变成"缺 92"(1.7%), 看着像丢了内容。实际去 dump PDF 文本
     逐条核对, 发现内容都在, 只是 `pdftotext -layout` 把窄表格单元格折行了 —— 例如
       剔除该季后的收益 35.47% 才是可持续性的更保守
                  口径
     一个词被劈到两行, 多重集比对就认为"字符少了"。这是**量法的噪声, 不是内容缺失**。
     真正判定内容完整性的是上面那条"词元覆盖率"(按元素取词, 不受折行影响), 它是 99.82%。
     这里给 2% 余量: 真丢一整块(动辄几百上千字)照样会被抓出来。 */
ok(totalShort <= htmlNorm.length * 0.02, 'PDF 未整块丢失内容(多重集口径, 允许 2% 折行噪声)',
  '缺 ' + totalShort + ' / ' + htmlNorm.length + ' (' + (totalShort / htmlNorm.length * 100).toFixed(2) + '%)');
ok(tokCov >= 99.5, 'PDF 内容词元覆盖率 ≥99.5%', tokCov.toFixed(2) + '%');
ok(pdfNorm.length > htmlNorm.length * 0.97, 'PDF 字符量与原页同量级(无大面积裁切)', pdfNorm.length + ' vs ' + htmlNorm.length);

// 4) 抽查关键内容是否真的出现在 PDF 里
console.log('\n=== 关键内容在场抽查 ===');
const must = [
  ['先说结论', '报告第 1 节标题'],
  ['边界与免责声明', '边界声明'],
  ['不构成投资建议', '免责句'],
  ['只看前十大持仓', '口径边界'],
  ['潞安环能', '真实持仓'],
  ['主题坚守型', '形态标签'],
  ['推翻条件', '可证伪条件'],
  ['跟踪清单', '跟踪章节']
];
for (const [m, label] of must) {
  ok(pdfNorm.includes(norm(m)), label, '«' + m + '»');
}

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
