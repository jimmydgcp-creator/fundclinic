/* 找出 index.html 里"有 DOM 元素但没有任何脚本引用"的死 id —— 也就是界面上摆着但不干活的控件。
 * 用法: node tools/audit_dead_ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 坑: 直接用 new URL(import.meta.url).pathname 拿到的是**百分号编码**的路径,
   中文目录名会变成 %E5%9F%BA… 然后 ENOENT。必须走 fileURLToPath。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = ['app/ui.js', 'app/online.js', 'app/engine.js', 'app/checker.js', 'app/ai.js', 'app/parse.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
/* 注意: 引用形式是 $('#btn-x'), 所以 id 前面那个字符是 '#', 不是引号。
   第一版按"前后都是引号"去数, 结果每个按钮都被判成死的 —— 数法要简单直接: 名字出现过就算引用。 */
const countRef = (id) => (js.match(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

const dead = ids.filter(id => countRef(id) === 0 && !/_[\w-]*$/.test(id) );
console.log(`index.html 共 ${ids.length} 个 id`);
console.log(`\n=== 疑似死 id（脚本里一次都没出现）${dead.length} 个 ===`);
for (const d of dead) {
  const i = html.indexOf(`id="${d}"`);
  const line = html.slice(0, i).split('\n').length;
  const ctx = html.slice(Math.max(0, i - 130), i + 90).replace(/\s+/g, ' ');
  console.log(`  line ${String(line).padStart(3)}  ${d}`);
  console.log(`        …${ctx}…`);
}

/* 顺带统计各 view 的体量, 看哪一屏最"重" */
console.log('\n=== 各 view / panel 行数 ===');
const views = [...html.matchAll(/<section class="view[^"]*" id="(view-[\w-]+)"/g)];
for (const [i, v] of views.entries()) {
  const start = v.index;
  const end = i + 1 < views.length ? views[i + 1].index : html.indexOf('</main>');
  const seg = html.slice(start, end);
  console.log(`  ${v[1].padEnd(14)} ${String(seg.split('\n').length).padStart(4)} 行  ${String(seg.length).padStart(6)} 字节`);
}
/* 按钮引用情况 —— 直接看名字出现过几次(bare 形式也算) */
const btns = [...html.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m => m[1]);
console.log('\n=== 按钮引用次数 ===');
for (const b of btns) {
  const n = countRef(b);
  console.log(`  ${n ? '✓' : '✗'} ${b.padEnd(22)} ${n} 次${n ? '' : '   ← 界面上摆着, 没人管'}`);
}

/* 输入控件引用情况 —— 摆着但没人读的输入框, 就是"用户填了也白填" */
const inputs = [...html.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g)].map(m => m[1]);
console.log('\n=== 输入控件引用次数 ===');
for (const b of inputs) {
  const n = countRef(b);
  console.log(`  ${n ? '✓' : '✗'} ${b.padEnd(22)} ${n} 次${n ? '' : '   ← 用户填了也不会有作用'}`);
}
