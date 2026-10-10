/* template_spec.mjs —— 打印一份演示稿的逐页形态 + 判据结果
 *
 * 度量与判据都在 server/deckmetrics.mjs(唯一口径), 这里只负责显示。
 * 用法: node tools/template_spec.mjs <deck.html> [...]      加 --ref 可测量参照稿
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deckMetrics, checkRubric, RUBRIC, referenceDeckPath } from '../server/deckmetrics.mjs';

const args = process.argv.slice(2);
const files = args.filter(a => a !== '--ref');
if (args.includes('--ref')) {
  const r = referenceDeckPath();
  if (r) files.unshift(r); else console.error('未找到参照稿样本');
}
if (!files.length) { console.error('用法: node tools/template_spec.mjs <deck.html> [...] [--ref]'); process.exit(2); }

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const d = deckMetrics(html);
  const t = d.totals;
  console.log('\n══════ ' + path.basename(f) + ' ══════');
  console.log(`页数 ${t.pages} · 均 ${t.avgChars} 字/页 · 加粗 ${t.bolds}(单页最多 ${t.boldMax}) · 卡片 ${t.cards}(${t.cardMax}/页) · 指标卡 ${t.stats}(${t.statMax}/页) · 表 ${t.tables} · 骨架 ${t.distinctRecipes} 种`);
  console.log('页 | 数据标题       | 字数 | 卡 | stat | 表/行 | 粗 | 最长块 | 注记 | notes | 版式');
  for (const p of d.pages) {
    console.log([
      String(p.n).padStart(2),
      (p.dataTitle || '-').slice(0, 12).padEnd(12),
      String(p.textChars).padStart(4),
      String(p.cards).padStart(2),
      String(p.stats).padStart(4),
      `${p.tables}/${p.tableRows}`.padStart(5),
      String(p.bolds).padStart(2),
      String(p.blockMax).padStart(6),
      String(p.secNotes).padStart(4),
      String(p.notesChars).padStart(5),
      p.recipe.slice(0, 56)
    ].join(' | '));
  }
  const issues = checkRubric(d);
  console.log(`判据: ${issues.length ? issues.length + ' 条提示' : '全部达标 ✓'}`);
  issues.forEach(i => console.log('  [' + i.level + '] ' + i.msg));
}

console.log('\n判据门槛(取自参照稿, 括号内为参照实测值):');
console.log(`  页数 ${RUBRIC.pagesMin}–${RUBRIC.pagesMax}(8) · 均字数 ≥${RUBRIC.avgCharsMin}(616)`);
console.log(`  加粗 总≤${RUBRIC.boldTotalMax} 单页≤${RUBRIC.boldPageMax}(54 / 最多 14)`);
console.log(`  卡片 总≤${RUBRIC.cardTotalMax} 单页≤${RUBRIC.cardPageMax}(22 / 最多 5)`);
console.log(`  指标卡 总≤${RUBRIC.statTotalMax} 单页≤${RUBRIC.statPageMax}(6 / 最多 4)`);
console.log(`  表 ≤${RUBRIC.tableMax}(3) · notes ${RUBRIC.notesMin}–${RUBRIC.notesMax}(74–116)`);
console.log(`  内容页最长文字块 ≥${RUBRIC.contentBlockMin}(最短 93) · ≥${RUBRIC.longProse} 字的页 ≥${RUBRIC.longProsePagesMin}(4)`);
