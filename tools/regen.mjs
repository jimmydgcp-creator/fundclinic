/* 重新生成某只基金的交付物(演示稿/PDF/报告等), 便于反复调试。
 * 用法: node tools/regen.mjs [基金代码] [--pdf] [--allow-no-ai]
 *   默认走"无 AI"链路(仅用于自测与调样式); 正式出报告请在页面上带 Key 跑。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = (process.argv[2] || '519191').replace(/\D/g, '');
const wantPdf = process.argv.includes('--pdf');
const allowNoAI = process.argv.includes('--allow-no-ai') || true;

const r = await runPipeline(code, {
  pdf: wantPdf,
  allowNoAI,
  onProgress: m => { if (/AI|演示|交付|完成/.test(m)) console.log('  ' + m); }
});

const deckPath = r.files.deck.path || r.files.deck;
const html = fs.readFileSync(deckPath, 'utf8');
const themes = [...html.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]);
const btns = [...html.matchAll(/class="th-btn" data-th="([^"]+)"/g)].map(m => m[1]);

console.log('\n=== ' + r.summary.name + '(' + code + ') ===');
console.log('区间 ' + r.summary.range + ' · ' + r.summary.quarters + ' 期 · 形态 ' + r.summary.formTag);
console.log('质检 ' + r.summary.check.verdictText);
console.log('\n演示稿 ' + (html.length / 1024).toFixed(0) + ' KB');
console.log('  主题 ' + themes.length + ' 套: ' + themes.join(', '));
console.log('  切换按钮 ' + btns.length + ' 个' + (btns.length === themes.length ? ' ✓ 对齐' : ' ✗ 数量不匹配'));
console.log('  无本地外链: ' + (!/(?:src|href)="(?!https?:|data:|#)/.test(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''))));
console.log('  无透明文字: ' + !html.includes('-webkit-text-fill-color: transparent'));
console.log('  无 animation…both: ' + !/animation\s*:[^;"']*\bboth\b/.test(html));
console.log('  网络字体引用: ' + (/@import|fonts\.googleapis/.test(html) ? '有(需修)' : '无 ✓'));
if (r.pdf) console.log('  PDF ' + (fs.statSync(r.pdf).size / 1024).toFixed(0) + ' KB');
console.log('\n演示稿路径: ' + deckPath);
