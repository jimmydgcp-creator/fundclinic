/* 复验本轮三处修复:
 *   ① 次新基金绩效块不再被吞(021967)
 *   ② 日期不再差一天(成立日/回撤日)
 *   ③ 官方窗口校准是真跑的, 报告里的措辞与事实一致
 *
 * 用法: node tools/verify_fixes.mjs [code ...] --all
 *   --all  全量取官方 PDF(校准需要每一期的「过去三个月」)
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.FUNDCLINIC_ALLOW_NO_AI = '1';

const args = process.argv.slice(2);
const all = args.includes('--all');
const codes = args.filter(a => /^\d{6}$/.test(a));
if (!codes.length) codes.push('021967');

for (const code of codes) {
  console.log('\n' + '='.repeat(72));
  console.log('复验 ' + code + (all ? ' (全量官方 PDF)' : ''));
  console.log('='.repeat(72));
  const r = await runPipeline(code, {
    pdf: false, allowNoAI: true, allOfficial: all,
    onProgress: m => { if (/校准|采集完成|官方对账|AI 模块/.test(m)) console.log('  · ' + m); }
  });
  const d = r.dataset, p = d.perfDetail;

  console.log('\n[① 绩效块]');
  if (!p) { console.log('  ✗ perfDetail 为空 —— 绩效块仍然缺失'); }
  else {
    console.log('  区间复利        ' + p.cumReturn + '%');
    console.log('  剔除最好一季    ' + p.exBestQuarter + '%  (最好一季 ' + p.bestQuarter + ' ' + p.bestQuarterReturn + '%)');
    console.log('  最大回撤        ' + p.maxDrawdown + '%');
    console.log('  基点日 baseDate ' + p.baseDate + (p.baseClamped ? '  [已钳制: 基金成立于区间起点之后]' : ''));
    console.log('  回撤区间        ' + (p.drawdownFrom || '?') + ' → ' + (p.maxDrawdownAt || '?'));
    const inc = d.fund.inception || '';
    if (inc) {
      const same = p.baseDate === inc;
      console.log('  成立日对照      ' + inc + (p.baseClamped ? (same ? '  ✓ 基点=成立日, 无差一天' : '  ⚠ 基点与成立日不一致') : '  (非次新基金, 不适用)'));
    }
    console.log('  逐季收益期数    ' + p.quarterReturns.length);
  }

  console.log('\n[③ 官方窗口校准]');
  const c = d.perfCalibration || {};
  console.log('  ok=' + c.ok + '  ' + (c.ok ? `可比 ${c.n} 期, 最大偏差 ${c.maxAbsDiff}pp, ${c.consistent ? '口径一致 ✓' : '⚠ 偏差偏大'}` : (c.reason || '(无)')));
  (c.rows || []).slice(0, 8).forEach(x => console.log('    ' + x.period + '  官方 ' + x.official + '%  引擎 ' + (x.engine === null ? '(跳过: ' + x.skipped + ')' : x.engine + '%  差 ' + x.diff + 'pp')));

  console.log('\n[报告里的原话]');
  const md = fs.readFileSync(r.files.report, 'utf8');
  const m = md.match(/- 收益口径为分红再投总回报指数[^\n]*/);
  console.log('  ' + (m ? m[0] : '(未找到口径句)'));
  console.log('  含"反向校准过": ' + /反向校准过/.test(md) + '   ← 应为 false');
  console.log('  含"校准 N 期"实测值: ' + /逐期校准 \d+ 期/.test(md));

  console.log('\n[summary.perf]');
  console.log('  ' + JSON.stringify(r.summary.perf));
}
