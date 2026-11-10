/* 用本地 API Key 重跑 T3「对外用词清洗」, 生成/更新《复盘报告_*_对外版.md》。
 *
 * 什么时候用: 报告正文改了(例如官方对账补齐期数、某一节重写), 但对外版是上一次
 * T3 的成稿, 文字没跟上 —— 这时用新报告重跑一遍 T3, 比手工改 20KB 文本可靠:
 * 它的校验器会做数字守恒(全文数字逐一比对)、违禁词、删减检查, 不过就拦截不写盘。
 *
 * 用法: node tools/polish_report.mjs [基金代码] [--dry]
 * 前置: llm.local.json(apiKey / baseUrl / model)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask } from '../server/pipeline-llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = (process.argv.slice(2).find(a => /^\d{6}$/.test(a))) || '519191';
const DRY = process.argv.includes('--dry');
const DIR = path.join(ROOT, '_runs', code);

const analysis = JSON.parse(fs.readFileSync(path.join(DIR, 'analysis.json'), 'utf8'));
const cfgPath = path.join(ROOT, 'llm.local.json');
if (!fs.existsSync(cfgPath)) { console.error('缺 llm.local.json(从 llm.local.json.example 复制并填 Key)'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const ai = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model };

console.log('调用 T3 用词清洗 (' + cfg.model + ')…');
const r = await runTask('polish', ai, analysis);
console.log('ok?', r.ok, '| latency', r.latencyMs, 'ms' + (r.repaired ? ' | 按校验意见重写 1 次' : ''));
(r.issues || []).forEach(i => console.log('  [' + i.level + '] ' + i.msg));
if (!r.ok || !r.value || !r.value.cleaned) {
  console.error('未通过校验, 已拦截, 不写盘。');
  process.exit(1);
}
const cleaned = r.value.cleaned;
if (DRY) { console.log('[dry] 清洗后 ' + cleaned.length + ' 字符, 未写盘'); process.exit(0); }
const out = path.join(DIR, '复盘报告_' + analysis.fund.name + '_' + code + '_对外版.md');
fs.writeFileSync(out, cleaned, 'utf8');
console.log('写出 ' + path.basename(out) + '  ' + (Buffer.byteLength(cleaned, 'utf8') / 1024).toFixed(1) + ' KB');
