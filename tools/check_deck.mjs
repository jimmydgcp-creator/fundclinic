/* 演示稿 PDF 校验: 每一页是否正好一张幻灯片, 以及有没有"看不见/丢失"的文字。
 *
 * 为什么必须机器校验: 上一份交付物(网页幻灯)就是"自己看没问题, 打印/发出去整块文字消失"。
 * 那次的根因是 CSS 动画初始态 opacity:0 被打印快照捕获。所以这里逐页比对, 不靠肉眼。
 *
 * 用法: node tools/check_deck.mjs <演示稿.html> <演示稿.pdf>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const POPPLER = 'C:\\Users\\75719\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin';
const PDFTOTEXT = path.join(POPPLER, 'pdftotext.exe');
const PDFINFO = path.join(POPPLER, 'pdfinfo.exe');

const htmlPath = process.argv[2];
const pdfPath = process.argv[3];
if (!htmlPath || !pdfPath) { console.error('用法: node tools/check_deck.mjs <html> <pdf>'); process.exit(1); }
if (!fs.existsSync(htmlPath) || !fs.existsSync(pdfPath)) { console.error('文件不存在'); process.exit(1); }

/* 先解 HTML 实体再归一化 —— 否则 &quot;/&lt;/&amp; 会被当成"quot/lt/amp"这种不存在的拉丁串,
   在字符多重集里报假缺口(实测踩过: 8 个 quot、2 个 lt 全是这个原因)。 */
const decode = s => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const norm = s => decode(s)
  .replace(/[\s\u00a0]+/g, '')
  .replace(/[，。、；：！？（）()【】《》「」“”‘’·—–\-…,.!?;:%"'`|/\\[\]{}<>+=*&#@$^~]/g, '')
  .toLowerCase();

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('演示稿: ' + path.basename(htmlPath) + '  ' + (fs.statSync(htmlPath).size / 1024).toFixed(0) + ' KB');
console.log('PDF   : ' + path.basename(pdfPath) + '  ' + (fs.statSync(pdfPath).size / 1024).toFixed(0) + ' KB\n');

/* 1) HTML 侧: 逐张幻灯片的文字 */
/* 打印时"故意隐藏"的交互元素, 比对文字完整性时必须排除 —— 否则会误报成丢字。
   实测踩过: 柱状图悬停提示 .bv 里的数值在打印时 display:none, 却仍被算进 HTML 侧, 
   报出"数字缺 14/24/13 个"的假缺口。 */
const PRINT_HIDDEN = [
  [/<div class="ov-wrap"[\s\S]*?<\/div>\s*(?=<div class="themes")/, '概览网格(打印隐藏)'],
  [/<span class="bv">[^<]*<\/span>/g, '柱状图悬停数值(打印隐藏)'],
  /* 讲者备注: 每套演示稿的打印块里都有 .notes{display:none!important} —— 它是给自己提词用的,
     当然不该出现在 PDF 里。不排除的话, 每条备注都会被算成"XML 有而 PDF 没有"的缺失字符。
     2026-10-10 踩到: 新版 T6 演示稿(html-ppt 技能格式)有 <div class="notes">, 于是报出
     "「复」缺3「面」缺3 h缺3 …" 一堆假缺口, 词元覆盖率掉到 69%。 */
  [/<div class="notes">[\s\S]*?<\/div>/g, '讲者备注(打印隐藏)'],
  [/<p class="notes">[\s\S]*?<\/p>/g, '讲者备注(打印隐藏)']
];
const rawHtml = fs.readFileSync(htmlPath, 'utf8');
let htmlForText = rawHtml;
const excluded = [];
for (const [re, label] of PRINT_HIDDEN) {
  const before = htmlForText.length;
  htmlForText = htmlForText.replace(re, ' ');
  if (htmlForText.length !== before) excluded.push(label + '(-' + (before - htmlForText.length) + ')');
}
if (excluded.length) console.log('已按打印样式排除: ' + excluded.join('、') + '\n');

const html = htmlForText;  // 后续比对统一用排除后的版本
/* 两种演示稿格式都要认:
 *   ① 旧模板版 server/deck.mjs —— 每页带 data-page="N";
 *   ② 新版 T6 server/deckagent.mjs(html-ppt 技能驱动) —— 每页只带 data-title, 没有 data-page。
 * 2026-10-10 之前这里只认 data-page, 于是**新版演示稿一页都数不出来**(报 0 张幻灯片),
 * 所有逐页判据静默失效 —— 也正因如此, "导出的 PDF 只有 1 页"这个真 bug 一直没被发现。 */
const slideRe = /<section[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
const slides = [];
for (const m of html.matchAll(slideRe)) {
  const text = m[1].replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const segs = [];
  for (const t of m[1].matchAll(/>([^<]+)</g)) {
    const s = norm(t[1]);
    if (s.length >= 6) segs.push({ s, raw: t[1].trim().slice(0, 40) });
  }
  const pg = /data-page="(\d+)"/.exec(m[0]);
  slides.push({ page: pg ? Number(pg[1]) : slides.length + 1, text: norm(text), segs });
}
/* 取所有 @media print 块(按花括号配平)—— 新版演示稿里"危险样式"是允许存在的,
   前提是打印块把它们复位了。所以判据从"不许出现"改成"出现就必须被复位"。 */
function printBlocks(s) {
  const out = []; const re = /@media[^{]*print[^{]*\{/g; let m;
  while ((m = re.exec(s))) {
    let d = 1, i = re.lastIndex;
    while (i < s.length && d) { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; }
    out.push(s.slice(m.index, i));
  }
  return out.join('\n');
}
const printCss = printBlocks(html);
const opacityReset = /opacity\s*:\s*1\s*!important/.test(printCss);
const gradReset = /-webkit-text-fill-color\s*:\s*(?!transparent)\S/.test(printCss);
/* 新版是不是把"一次只显示一页"的机制拆掉了 —— 不拆的话 --print-to-pdf 只会出 1 页 */
const deckReleased = /\.deck\s*\{[^}]*overflow\s*:\s*visible/.test(printCss) && /\.deck\s*\{[^}]*height\s*:\s*auto/.test(printCss);

console.log('=== A. 结构 ===');
ok(slides.length >= 3, '幻灯片数量 ≥3', String(slides.length));
ok(/@page\s*\{[^}]*size\s*:\s*1280px\s+720px/.test(html), 'CSS 声明了 16:9 的 @page 尺寸');
/* 旧版是"自己在自己的 CSS 里不许写 both/透明字"; 新版会内联 html-ppt 技能的 animations.css,
   那里面**确实**有 `.anim-stagger-list > *{opacity:0;animation:…both}`。
   所以判据改成: 要么没有, 要么打印块必须把 opacity 顶回 1 —— 只关动画不管 opacity 才是最致命的组合。 */
const hasBoth = /animation\s*:[^;"'}]*\bboth\b/.test(html);
ok(!hasBoth || opacityReset, '无 animation…both, 或打印块已复位 opacity', hasBoth && !opacityReset ? '有 both 但打印块没有 opacity:1!important' : '');
const hasTransparentText = /-webkit-text-fill-color\s*:\s*transparent/.test(html);
ok(!hasTransparentText || gradReset, '无透明文字填充, 或打印块已回落为实色', hasTransparentText && !gradReset ? '有透明填充但打印块没回落' : '');
/* "一次只显示一页"的锁定容器只有**新版 T6 演示稿**才有(.deck{height:100vh;overflow:hidden})。
   模板版(server/deck.mjs)根本没有 .deck: 九张 .slide 顺序排下来, 打印块不需要解任何东西。
   所以这条不能无条件要求 —— 否则模板版永远假失败(实测 005825 模板版: PDF 9 页 == 幻灯片 9 张, 打印完全正常)。
   真正的兜底判据是 E 段的"PDF 页数 == 幻灯片数"; 这条只是提前把根因指出来。 */
const deckLocked = /class="deck"/.test(html) && /\.deck\s*\{[^}]*height\s*:\s*100vh/.test(html);
if (deckLocked) {
  ok(deckReleased, '打印块拆掉了"一次只显示一页"的容器(.deck 的 100vh/overflow:hidden)',
    deckReleased ? '' : '不拆的话 --print-to-pdf 只能得到 1 页');
} else {
  console.log('  SKIP  拆 .deck 容器 —— 这份演示稿没有 .deck 锁定容器(模板版按 .slide 顺序排版), 由"PDF 页数==幻灯片数"兜底');
}

/* A2 的这几条是**旧模板版**专有的(主题按钮 / localStorage 记忆 / 视图 CSS 分界标记)。
   新版 T6 演示稿靠 runtime.js 的 T 键换肤、没有按钮也没有那个标记 —— 硬套只会刷一屏假失败。
   所以先判断格式, 不适用就明确 SKIP, 而不是假装通过。 */
const legacyDeck = /class="th-btn"|=== VIEW-CSS-BELOW/.test(html);
console.log('\n=== A2. 主题系统 ===');
if (!legacyDeck) {
  const themeCount = new Set([...html.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1])).size;
  ok(themeCount >= 6, `内置主题 ≥6 套(新版 T6 格式: 主题全部内联, 用 T 键轮换)`, String(themeCount));
  ok(/<html[^>]*data-theme="[a-z-]+"/.test(html), 'html 上带默认 data-theme');
  ok(!/@import|fonts\.googleapis|fonts\.gstatic/.test(html), '不引用任何网络字体(换肤不会因缺字体而变形)');
  ok(!/url\(\s*['"]?(?!data:)/.test(html), 'CSS 里没有外部 url() 引用');
  console.log('  SKIP  主题按钮 / localStorage 记忆 / 视图 CSS 分界标记 —— 这三条只适用于旧模板版');
} else {
  const themeIds = [...html.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]);
  ok(themeIds.length >= 6, `内置主题 ≥6 套`, themeIds.slice(0, 8).join(', '));
  const btnIds = [...html.matchAll(/class="th-btn" data-th="([^"]+)"/g)].map(m => m[1]);
  ok(btnIds.length === themeIds.length, '每套主题都有对应的切换按钮', `${btnIds.length} 按钮 / ${themeIds.length} 主题`);
  ok(themeIds.every(id => btnIds.includes(id)), '按钮与主题 id 一一对应');
  ok(/class="th-btn active"|apply\(/.test(html) && html.includes('fundclinic.deck.theme'), '换肤带本机记忆(localStorage)');
  ok(/data-theme="[a-z-]+"><head>|data-theme="[a-z-]+">/.test(html), 'html 上带默认 data-theme');
  ok(!/@import|fonts\.googleapis|fonts\.gstatic/.test(html), '不引用任何网络字体(换肤不会因缺字体而变形)');
  ok(!/url\(\s*['"]?(?!data:)/.test(html), 'CSS 里没有外部 url() 引用');
  const styleBlock = (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1] || '';
  const MARK = '=== VIEW-CSS-BELOW';
  const markIdx = styleBlock.indexOf(MARK);
  const viewCss = markIdx >= 0 ? styleBlock.slice(styleBlock.indexOf('*/', markIdx) + 2) : '';
  ok(markIdx >= 0, '样式层带"视图 CSS"分界标记(便于机器校验)');
  const hardColors = [...viewCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0])
    .filter(c => !/^#(fff|ffffff|000|000000)$/i.test(c));
  ok(hardColors.length === 0, '视图样式里没有写死的颜色(全部走主题变量)',
    hardColors.length ? '残留: ' + [...new Set(hardColors)].slice(0, 8).join(', ') : '');
}

/* 2) PDF 侧 */
const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(PDFINFO, [pdfPath], { encoding: 'utf8' }))[1]);
console.log('\n=== B. 分页 ===');
ok(pages === slides.length, `PDF 页数 == 幻灯片数(${slides.length})`, String(pages));

const txtPath = path.join(ROOT, '_runs', '.deck-text.txt');
execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-layout', pdfPath, txtPath], { stdio: ['ignore', 'pipe', 'ignore'] });
const full = fs.readFileSync(txtPath, 'utf8');
const pdfNorm = norm(full);
try { fs.unlinkSync(txtPath); } catch (e) {}

console.log('\n=== C. 文字完整性 ===');
/* 逐页分文本, 便于定位是哪一页丢字 */
const pageTexts = full.split('\f');
/* ① 字符多重集: 直接抓"整块被裁掉" */
const count = s => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1); return m; };
const allHtml = norm(slides.map(s => s.text).join(''));
const ch = count(allHtml), cp = count(pdfNorm);
let short = 0; const deficits = [];
for (const [c, n] of ch) { const have = cp.get(c) || 0; if (have < n) { short += n - have; deficits.push(`"${c}"缺${n - have}`); } }
ok(short <= 5, 'PDF 未丢失字符(多重集口径)', short ? deficits.slice(0, 8).join(' ') : '覆盖全部字符');

/* ② 内容词元: 按元素取词, 不受折行影响 */
const tokens = new Set();
slides.forEach(s => s.segs.forEach(x => {
  (x.raw.match(/[\u4e00-\u9fff]{2,6}|\d+(?:\.\d+)?%?/g) || []).forEach(t => tokens.add(t));
}));
const tokList = [...tokens];
const miss = tokList.filter(t => !pdfNorm.includes(norm(t)));
const cov = tokList.length ? (tokList.length - miss.length) / tokList.length * 100 : 100;
ok(cov >= 99, 'PDF 内容词元覆盖率 ≥99%', cov.toFixed(2) + '%  (' + (tokList.length - miss.length) + '/' + tokList.length + ')');
if (miss.length) console.log('    未找到: ' + miss.slice(0, 12).join('、'));

/* ③ 逐页: 每张幻灯片的关键内容必须落在某一页里 */
console.log('\n=== D. 逐页抽查(每页取前 3 个较长文本段) ===');
let pageFail = 0;
slides.forEach(s => {
  const probes = s.segs.filter(x => x.s.length >= 8).slice(0, 3);
  const hit = probes.filter(p => pdfNorm.includes(p.s)).length;
  const good = probes.length === 0 || hit >= Math.max(1, probes.length - 1);
  if (!good) pageFail++;
  console.log((good ? '  PASS  ' : '  FAIL  ') + `第 ${s.page} 页  抽查 ${hit}/${probes.length} 段命中` + (good ? '' : '  ← ' + probes.map(p => p.raw).join(' | ')));
});
ok(pageFail === 0, '每页都有内容落在 PDF 中(无空白页)', pageFail ? pageFail + ' 页异常' : '');

console.log('\n=== E. 关键内容在场 ===');
/* 旧模板版有固定的章节名; 新版 T6 是"按内容选版面", 章节名由分镜决定(而且参照稿用的就是
   主张式标题, 不是栏目名), 所以只对**两种格式都必然出现**的东西下断言。 */
const must = legacyDeck
  ? ['回溯复盘', '先说结论', '推翻条件', '绩效总览', '关键调仓案例审计', '不构成投资建议', '数据来源与质检']
  : ['回溯复盘', '不构成投资建议'];
for (const m of must) ok(pdfNorm.includes(norm(m)), 'PDF 含 «' + m + '»');
if (!legacyDeck) console.log('  SKIP  旧模板版专有的章节名断言(先说结论 / 绩效总览 / 数据来源与质检 …)');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
