/* 清点"JS 会渲染出来的 class"与"CSS 里有规则的 class"的差集。
 *
 * 为什么要这个: 视觉重构要重写 styles.css —— 如果某个 class 只出现在 ui.js 拼的字符串里,
 * 我在 CSS 里漏掉它, 页面不会报错, 只会**默默变丑**(裸元素、丢边框、没了配色)。
 * 这类问题只有机器比对才抓得到, 肉眼看页面很难发现"这里本来应该有个框"。
 *
 * 用法: node tools/audit_css_coverage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const JS_FILES = ['app/ui.js', 'app/online.js', 'app/checker.js', 'app/engine.js', 'app/ai.js', 'app/parse.js'];
const css = read('app/styles.css');
const html = read('index.html');

const cls = new Set();
for (const f of JS_FILES) {
  const t = read(f);
  /* class="a b c" / class='a b' / class=`a b` */
  for (const m of t.matchAll(/class=\\?["'`]([^"'`$]+)["'`]/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) cls.add(c);
  }
  for (const m of t.matchAll(/classList\.(?:add|toggle|remove)\(\s*["'`]([^"'`]+)["'`]/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) cls.add(c);
  }
}
const htmlCls = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) htmlCls.add(c);
}

const has = (c) => new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css);

const jsAll = [...cls].sort();
const htmlAll = [...htmlCls].sort();
const missJs = jsAll.filter(c => !has(c));
const missHtml = htmlAll.filter(c => !has(c));

console.log(`styles.css 规则数(粗略) ${(css.match(/\{/g) || []).length}`);
console.log(`JS 拼串用到 ${jsAll.length} 个 class · index.html 用了 ${htmlAll.length} 个\n`);

console.log('=== JS 用到的、但 CSS 里没有规则的 class（会渲染成裸元素）===');
console.log(missJs.length ? '  ' + missJs.join('\n  ') : '  （无 —— 全覆盖）');

console.log('\n=== index.html 用到的、但 CSS 里没有规则的 class ===');
console.log(missHtml.length ? '  ' + missHtml.join('\n  ') : '  （无 —— 全覆盖）');

console.log(`\n=== JS 依赖的全部 class（重写 CSS 时一个都不能漏）${jsAll.length} 个 ===`);
console.log('  ' + jsAll.join('  '));

console.log(`\n=== index.html 用到的全部 class ${htmlAll.length} 个 ===`);
console.log('  ' + htmlAll.join('  '));

/* 反向: CSS 里定义了却没人用的 class —— 重写时可以放心删掉 */
const cssCls = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) cssCls.add(m[1]);
const used = new Set([...jsAll, ...htmlAll]);
const unused = [...cssCls].filter(c => !used.has(c) && !c.startsWith('anim-')).sort();
console.log(`\n=== CSS 定义了但没有任何地方用到的 class（${unused.length} 个，重构时可删）===`);
console.log('  ' + unused.join('  '));
