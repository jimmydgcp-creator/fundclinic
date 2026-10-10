/* 把一份演示稿的每页可见文字打出来, 供人/模型逐页对照。
 * 用法: node tools/dump_deck_text.mjs <deck.html> [起始页] [结束页]
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const from = Number(process.argv[3] || 1), to = Number(process.argv[4] || 999);
const outFile = process.argv[5] || null;   // 给个路径就直接写 UTF-8 文件
if (!file || !fs.existsSync(file)) { console.error('找不到 ' + file); process.exit(1); }

const html = fs.readFileSync(file, 'utf8');
const slides = [];
const re = /<section[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
let m;
while ((m = re.exec(html))) slides.push(m[1]);

const text = (s) => String(s)
  .replace(/<div class="notes">[\s\S]*?<\/div>/g, '')
  .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|td|th|section)>/g, '\n')
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

const lines = [];
const say = (s) => { if (outFile) lines.push(s); else console.log(s); };

say(`文件: ${path.basename(file)}  (共 ${slides.length} 页)\n`);
slides.forEach((s, i) => {
  const n = i + 1;
  if (n < from || n > to) return;
  const t = text(s);
  say(`\n${'═'.repeat(78)}\nP${n}   可见字 ${t.length}\n${'═'.repeat(78)}`);
  say(t);
});
if (outFile) { fs.writeFileSync(outFile, lines.join('\n'), 'utf8'); console.log('写出 ' + outFile); }
