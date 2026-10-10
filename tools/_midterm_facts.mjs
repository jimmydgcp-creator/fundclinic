import fs from 'node:fs';
import path from 'node:path';

const RUNS = path.resolve('_runs');
const dirs = fs.readdirSync(RUNS).filter(d => /^\d{6}$/.test(d)).sort();
const L = [];
L.push('# _runs 事实核对表(脚本自动生成)\n');

for (const d of dirs) {
  const dir = path.join(RUNS, d);
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  const load = (n) => { const p = path.join(dir, n); if (!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const run = load('run.json');
  const meta = load('datasetMeta.json');
  const s = run?.summary || {};
  const cal = meta?.perfCalibration;
  const off = s.official;
  const q = meta?.quarters || run?.dataset?.quarters;

  L.push(`\n## ${d} · ${s.name || '(无 summary)'}\n`);
  L.push(`- 经理: ${s.manager || '—'}`);
  L.push(`- 区间: ${s.range || '—'}  期数: ${s.quarters ?? '—'}`);
  L.push(`- 形态标签: ${s.formTag || '—'}`);
  L.push(`- 区间收益: ${s.perf ? JSON.stringify(s.perf) : '—'}`);
  L.push(`- 质检: ${s.check ? `${s.check.pass}/${s.check.total} 通过, warn ${s.check.warn}, fail ${s.check.fail} → ${s.check.verdict}` : '—'}`);
  if (cal) L.push(`- 官方窗口校准: ${cal.ok ? `${cal.n} 期, 最大偏差 ${cal.maxAbsDiff}pp, consistent=${cal.consistent}` : `未完成/失败`}`);
  if (off) L.push(`- 官方 PDF 对账: pdftotext=${off.pdftotext}, available=${off.available}, ${off.notes ? off.notes.join(' | ') : ''}`);
  if (off?.checks) for (const c of off.checks) L.push(`    - ${c.period}: ok=${c.ok} 行=${c.parsedRows} maxDiff=${c.maxDiff} 理由=${c.reason}`);
  if (s.aiLog) L.push(`- AI 调用: ${s.aiLog.map(a => `${a.task}=${a.ok ? 'ok' : 'fail'}`).join(' , ')}`);
  if (s.sources) L.push(`- 来源条数: ${s.sources.length}`);
  L.push(`- 产出文件(${files.length}):`);
  for (const f of files) L.push(`    - ${f}  (${fs.statSync(path.join(dir, f)).size} B)`);
}

fs.writeFileSync(path.resolve('tools/_midterm_facts.md'), L.join('\n'), 'utf8');
console.log('written tools/_midterm_facts.md');
