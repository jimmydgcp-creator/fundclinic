/* test_theme_scoping.mjs —— 主题内联后不许"串味"
 *
 * 背景(2026-10-10 发现): 单文件演示稿会把 36 套主题全部内联, 靠 [data-theme] 切换。
 * 但原来的改写只把 `:root` 换成了 `:root[data-theme="名"]` —— 而主题文件里有 **116 条顶层规则
 * 不是 :root 开的**(body / .card / .kicker / h1.title / .slide / .slide::before / .pill /
 * .divider-accent / .gradient-text / a …)。这些规则没被限定, 于是 36 套**同时生效**,
 * 谁在源码里靠后谁说了算: 卡片描边是 academic-paper 的、.slide 内边距是 pitch-deck-vc 的、
 * h1 渐变是 y2k-chrome 的 —— 主题切换只换了变量, 没换骨架。
 *
 * 这个测试直接调用产品代码里的 scopeTheme(从 server/deckagent.mjs 里取出函数体执行, 不是复制粘贴),
 * 对 36 个真实主题文件跑一遍, 要求每条规则都带上自己的作用域。
 *
 * 用法: node tools/test_theme_scoping.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME_DIR = path.join(ROOT, 'skills', 'html-ppt', 'assets', 'themes');

let fail = 0;
const ok = (c, label, extra) => { console.log((c ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  ' + extra : '')); if (!c) fail++; };

/* 把 @keyframes / @font-face 整块抠掉 —— 里面的 to/from/0% 不是选择器, 拿它们去判作用域必然误报。 */
function stripAtBlocks(css, names = /@(keyframes|font-face|-webkit-keyframes)/) {
  let out = '', i = 0;
  while (i < css.length) {
    const hit = names.exec(css.slice(i));
    if (!hit) { out += css.slice(i); break; }
    const at = i + hit.index;
    const brace = css.indexOf('{', at);
    if (brace < 0) { out += css.slice(at); break; }
    let depth = 1, k = brace + 1;
    while (k < css.length && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    out += css.slice(i, at) + ' ';
    i = k;
  }
  return out;
}

/* 把 @media/@supports 的**外壳去掉、保留里面的规则**。
   为什么需要: 我的选择器抓取用的是 [^{}@]+, 遇到 `@media print{...}` 会从 `@` 后面的 `print` 开始匹配,
   把 `print` 当成一个选择器 —— 于是"没带作用域"的假失败。**这个假失败是被我自己新增的主题打印块触发的**
   (2026-10-10: 给 pitch-deck-vc / vaporwave / y2k-chrome 加打印回落时才暴露)。 */
function unwrapAtRules(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const m = /@(media|supports|layer|container)\b[^{]*\{/.exec(css.slice(i));
    if (!m) { out += css.slice(i); break; }
    const at = i + m.index;
    out += css.slice(i, at);
    let depth = 1, k = i + m.index + m[0].length;
    while (k < css.length && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    out += css.slice(at + m[0].length, k - 1);
    i = k;
  }
  return out;
}

console.log('=== 用产品代码里的 scopeTheme 逐套改写 36 个主题文件 ===\n');
const src = fs.readFileSync(path.join(ROOT, 'server', 'deckagent.mjs'), 'utf8');
const m = /function scopeTheme\(name, css\)\s*\{([\s\S]*?)\n\}\n/.exec(src);
ok(!!m, '从 deckagent.mjs 里取到 scopeTheme 实现(测的是产品代码, 不是副本)');
if (!m) { console.log('\n无法继续。'); process.exit(1); }
const scopeTheme = new Function('name', 'css', m[1]);

const themes = fs.readdirSync(THEME_DIR).filter(f => f.endsWith('.css'));
let badScope = 0, scopedRules = 0, keyframes = 0;
for (const f of themes) {
  const name = f.replace(/\.css$/, '');
  const plain = fs.readFileSync(path.join(THEME_DIR, f), 'utf8');
  const out = scopeTheme(name, plain);
  const scannable = unwrapAtRules(stripAtBlocks(out));
  const rules = [...scannable.matchAll(/([^{}@]+)\{/g)].map(x => x[1].trim().replace(/\s+/g, ' '));
  for (const sel of rules) {
    for (const part of sel.split(',').map(s => s.trim()).filter(Boolean)) {
      scopedRules++;
      if (!part.includes(`[data-theme="${name}"]`)) {
        badScope++;
        if (badScope <= 5) console.log(`      未加作用域: ${f} → ${part}`);
      }
    }
  }
  keyframes += (out.match(/@keyframes/g) || []).length;
}
ok(badScope === 0, `${themes.length} 套主题 / ${scopedRules} 条选择器全部带上了自己的作用域`, badScope ? badScope + ' 条没带' : '');
ok(keyframes >= 1, `@keyframes 原样保留(${keyframes} 个, 说明关键帧没被加作用域)`);

/* 关键: 光"加了作用域"不够 —— 还要确认**别的主题的选择器不会跑到这一套里**。
   做法: 把 36 套拼起来(与 buildHtml 的做法一致), 抽任意一条 .card 规则, 它必须只属于一个主题。 */
const all = themes.map(f => scopeTheme(f.replace(/\.css$/, ''), fs.readFileSync(path.join(THEME_DIR, f), 'utf8'))).join('\n');
const cardRules = [...unwrapAtRules(stripAtBlocks(all)).matchAll(/([^{}@]*\.card[^{}@]*)\{/g)].map(x => x[1].trim());
const unscopedCard = cardRules.filter(s => !s.includes('[data-theme='));
ok(unscopedCard.length === 0, `${cardRules.length} 条 .card 规则全部挂在某个主题下, 没有裸的`, unscopedCard.slice(0, 3).join(' | '));

/* 反向验证: 这个测试不是空转 —— 旧写法(只换 :root)在同一个最小例子上必须被抓住 */
const MINI = ':root{--accent:#123}\nbody{background:#fff}\n.card{border:1px solid #ccc}\n.kicker{color:#f00}\n@media print{.card{border:0}}\n@keyframes k{to{opacity:1}}';
const scopedMini = scopeTheme('demo', MINI);
ok(scopedMini.includes('[data-theme="demo"] .card'), '.card 被正确加作用域');
ok(scopedMini.includes('@media print{[data-theme="demo"] .card'), '@media 内部的规则也加了作用域');
ok(scopedMini.includes('@keyframes k{to{opacity:1}}'), '@keyframes 原样保留(里面的 to 没被加作用域)');
ok((scopedMini.match(/\[data-theme="demo"\]/g) || []).length >= 4, ':root / body / .card / .kicker 都处理到了');
ok(stripAtBlocks('/**/\n' + scopedMini).split(/\{/).filter(s => /(^|,)\s*\.card\s*$/.test(s)).length === 0, '改写后不再存在裸 .card 选择器');
console.log('\n  作用域样例: ' + scopedMini.replace(/\n/g, ' ').slice(0, 200));

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
