/* 对比"参照版"演示稿与"自动生成版"演示稿的结构差异。 */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'C:/Users/75719/Desktop/基金复盘_小组作业/03_演示分发/519191_回溯复盘_单文件版.html';
const ref = fs.readFileSync(REF, 'utf8');

console.log('=== 参照版(519191_回溯复盘_单文件版.html) 的幻灯片 ===');
const secs = [...ref.matchAll(/<section[^>]*>/g)];
console.log('  section 数: ' + secs.length);
const titles = [...ref.matchAll(/class="kicker"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
titles.forEach((t, i) => console.log('  ' + (i + 1) + '. [kicker] ' + t));
const h2s = [...ref.matchAll(/<h2[^>]*class="h2c"[^>]*>([\s\S]*?)<\/h2>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
if (h2s.length) { console.log('  --- h2c 标题 ---'); h2s.forEach((t, i) => console.log('  ' + (i + 1) + '. ' + t)); }

console.log('\n--- 里面用到的可视化组件类 ---');
for (const cls of ['stat', 'grid', 'card', 'phase', 'tag', 'rowb', 'pcard', 'num', 'up', 'dn', 'mt-m', 'dot', 'lab', 'cl']) {
  const n = (ref.match(new RegExp('class="[^"]*\\b' + cls + '\\b', 'g')) || []).length;
  console.log('  ' + cls.padEnd(8) + ' × ' + n);
}

console.log('\n--- 取一张幻灯片看它的排版骨架 ---');
const firstSlide = ref.slice(ref.indexOf('class="slide"'), ref.indexOf('class="slide"') + 2200);
console.log(firstSlide.replace(/></g, '>\n<').split('\n').slice(0, 45).join('\n'));

console.log('\n\n=== 自动生成版 ===');
const dir = path.resolve('_runs/519191');
const deckFile = fs.readdirSync(dir).find(f => /^演示稿_.*\.html$/.test(f));
const gen = fs.readFileSync(path.join(dir, deckFile), 'utf8');
console.log('  文件: ' + deckFile + '  ' + (gen.length / 1024).toFixed(0) + ' KB');
[...gen.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
