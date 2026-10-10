/* 列出 base.css 提供的版式原语 + 参考 PPT 实际用到的类,
 * 用于给大模型一份"可用的积木清单"(不把整个 base.css 塞进提示词)。 */
import fs from 'node:fs';
import path from 'node:path';

const SKILL = process.argv[2] || 'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\04_网页项目_基金复诊台\\skills\\html-ppt';
const base = fs.readFileSync(path.join(SKILL, 'assets', 'base.css'), 'utf8');

const cls = new Set();
for (const m of base.matchAll(/\.([a-z][a-z0-9-]*)/g)) cls.add(m[1]);
console.log('base.css 类总数 ' + cls.size);
console.log([...cls].sort().join(' '));

console.log('\n--- 参考 PPT 用到的类 ---');
const ref = fs.readFileSync('C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\02_现有成果\\基金复盘库\\outputs\\519191_2020Q4-2026Q2\\黄海_万家新利519191_回溯复盘_PPT\\index.html', 'utf8');
const used = new Set();
for (const m of ref.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
console.log([...used].sort().join(' '));

console.log('\n--- 参考 PPT 里的内联样式用法(前 25 条) ---');
const styles = [...ref.matchAll(/style="([^"]+)"/g)].map(m => m[1]);
console.log(styles.slice(0, 25).map(s => '  ' + s).join('\n'));
