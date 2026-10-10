/* 拆解参考 PPT(黄海_万家新利519191_回溯复盘_PPT/index.html)的结构,
 * 作为「网页生成同款 PPT」的复刻目标。用法: node tools/inspect_ref_deck.mjs [目录] */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'C:\\Users\\75719\\Desktop\\基金复盘_小组作业\\02_现有成果\\基金复盘库\\outputs\\519191_2020Q4-2026Q2\\黄海_万家新利519191_回溯复盘_PPT';
const file = path.join(dir, 'index.html');
const h = fs.readFileSync(file, 'utf8');
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

console.log('bytes ' + h.length);
console.log('--- link/script ---');
for (const m of h.matchAll(/<(?:link|script)[^>]*>/g)) console.log('  ' + m[0]);
console.log('--- html/body ---');
console.log('  ' + (h.match(/<html[^>]*>/) || [''])[0]);
console.log('  ' + (h.match(/<body[^>]*>/) || [''])[0]);

// 按 slide 边界切开
const parts = h.split(/(?=<section[^>]*class="[^"]*\bslide\b)/).slice(1);
console.log('--- slides: ' + parts.length + ' ---');
parts.forEach((p, i) => {
  const cls = (p.match(/<section[^>]*class="([^"]*)"/) || [, ''])[1];
  const tpl = (p.match(/class="([^"]*\btpl-[a-z0-9-]+\b[^"]*)"/) || [, ''])[1];
  const h1 = clean((p.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const h2 = clean((p.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1]);
  const kick = clean((p.match(/class="[^"]*\b(?:kicker|eyebrow|label)\b[^"]*"[^>]*>([\s\S]*?)<\//) || [, ''])[1]);
  console.log(String(i + 1).padStart(2) + ' [' + cls + ']' + (tpl ? ' TPL=' + tpl : ''));
  if (kick) console.log('     kicker: ' + kick.slice(0, 60));
  if (h1) console.log('     h1: ' + h1.slice(0, 70));
  if (h2) console.log('     h2: ' + h2.slice(0, 70));
});

console.log('--- 元素统计 ---');
const stat = {
  'section.slide': parts.length,
  'aside.notes': (h.match(/<aside[^>]*class="[^"]*notes/g) || []).length,
  'data-anim': (h.match(/data-anim=/g) || []).length,
  'data-fx': (h.match(/data-fx=/g) || []).length,
  'data-theme': (h.match(/data-theme=/g) || []).length,
  'svg': (h.match(/<svg/g) || []).length,
  'canvas': (h.match(/<canvas/g) || []).length,
  'table': (h.match(/<table/g) || []).length,
  'div.kpi/.stat': (h.match(/class="[^"]*\b(?:kpi|stat)\b/g) || []).length
};
for (const [k, v] of Object.entries(stat)) console.log('  ' + k.padEnd(16) + v);

console.log('--- 主题 id 列表 ---');
console.log('  ' + [...h.matchAll(/data-theme="([^"]+)"/g)].map(m => m[1]).join(', '));

// 输入按钮/runtime 挂载方式
console.log('--- 运行时挂载片段 ---');
const tail = h.slice(-1200);
console.log(tail);
