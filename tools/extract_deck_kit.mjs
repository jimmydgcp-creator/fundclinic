/* 从参考 PPT(黄海 519191)里抽出它的 <style> 块, 存成 deck-kit.css。
 * 目的: T6 生成的演示稿与用户已认可的这份**共用同一套版面组件**, 而不是我另造一套。
 * 用法: node tools/extract_deck_kit.mjs */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\02_现有成果\\基金复盘库\\outputs\\519191_2020Q4-2026Q2\\黄海_万家新利519191_回溯复盘_PPT\\index.html';
const OUT = path.resolve('skills', 'deck-kit.css');

const h = fs.readFileSync(REF, 'utf8');
const styles = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
console.log('找到 ' + styles.length + ' 个 <style> 块, 合计 ' + styles.reduce((s, x) => s + x.length, 0) + ' 字符');

const css = styles.join('\n\n').trim();
fs.writeFileSync(OUT, `/* deck-kit — 版面组件(从用户已认可的 519191 回溯复盘 PPT 中抽取)
 * 这是演示稿的"设计语言": T6 生成时把它内联进单文件, 大模型只允许使用这里定义的类。
 * 抽取来源: 02_现有成果/基金复盘库/outputs/519191_2020Q4-2026Q2/黄海_万家新利519191_回溯复盘_PPT/index.html
 */
${css}
`, 'utf8');

console.log('已写入 ' + OUT + ' (' + fs.statSync(OUT).size + ' 字节)');
console.log('\n--- 组件类清单 ---');
const cls = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9-]*)/g)) cls.add(m[1]);
console.log([...cls].sort().join(' '));
