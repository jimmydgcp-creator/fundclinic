/* 对比「当前网页生成的演示稿」与「参考 PPT(黄海 519191)」的结构差异。
 * 用法: node tools/compare_ref.mjs <我方deck.html> [参考deck.html] */
import fs from 'node:fs';

const mine = process.argv[2];
const REF = process.argv[3] || 'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\02_现有成果\\基金复盘库\\outputs\\519191_2020Q4-2026Q2\\黄海_万家新利519191_回溯复盘_PPT\\index.html';
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function digest(file, label) {
  const h = fs.readFileSync(file, 'utf8');
  const parts = h.split(/(?=<section[^>]*class="[^"]*\bslide\b)/).slice(1);
  console.log('\n================ ' + label + ' ================');
  console.log('大小 ' + (h.length / 1024).toFixed(0) + ' KB · ' + parts.length + ' 页');
  console.log('主题挂载: ' + ((h.match(/data-themes="([^"]*)"/) || [, '(无多主题)'])[1]).slice(0, 200));
  const feats = {
    '表格 <table>': (h.match(/<table/g) || []).length,
    '列表 <ol>/<ul>': (h.match(/<ol|<ul/g) || []).length,
    '强调 <b>': (h.match(/<b>/g) || []).length,
    '讲者备注 notes': (h.match(/class="notes"/g) || []).length,
    'data-anim': (h.match(/data-anim=/g) || []).length,
    '内联样式 style=': (h.match(/style="/g) || []).length
  };
  for (const [k, v] of Object.entries(feats)) console.log('  ' + k.padEnd(18) + v);
  console.log('--- 逐页 ---');
  parts.forEach((p, i) => {
    const kick = clean((p.match(/class="[^"]*\b(?:kicker|eyebrow)\b[^"]*"[^>]*>([\s\S]*?)<\//) || [, ''])[1]);
    const h1 = clean((p.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
    const h2 = clean((p.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1]);
    const title = h1 || h2 || clean((p.match(/class="[^"]*\b(?:st|ttl|title)\b[^"]*"[^>]*>([\s\S]*?)<\//) || [, ''])[1]);
    console.log('  ' + String(i + 1).padStart(2) + '. ' + (kick ? '[' + kick.slice(0, 34) + '] ' : '') + title.slice(0, 76));
  });
}

digest(REF, '参考: 黄海 519191 回溯复盘 PPT');
if (mine) digest(mine, '当前: 网页生成 ' + mine.split(/[\\/]/).pop());
