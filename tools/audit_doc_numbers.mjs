/* 核对交作业文档里的数字是否与当前实际产出一致。 */
import fs from 'node:fs';
import path from 'node:path';

const R = 'C:/Users/75719/Desktop/基金复盘_小组作业/04_网页项目_基金复诊台/_runs';
for (const c of ['519191', '005827', '021967', '090007', '005825']) {
  const dir = path.join(R, c);
  if (!fs.existsSync(dir)) { console.log(c + ': 无目录'); continue; }
  let run = {};
  try { run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); } catch (e) { console.log(c + ': run.json 读不了'); continue; }
  const s = run.summary || {};
  const o = s.official || {};
  const ch = o.checks || [];
  const okN = ch.filter(x => x.ok).length;

  // 模板版演示稿页数
  let tpl = '—';
  const df = fs.readdirSync(dir).find(x => /^演示稿_.*\.html$/.test(x) && !/深度版/.test(x));
  if (df) {
    const h = fs.readFileSync(path.join(dir, df), 'utf8');
    tpl = h.split(/(?=<section[^>]*class="[^"]*\bslide\b)/).length - 1;
  }
  // 深度版(T6)页数
  let t6 = '—';
  const d6 = fs.readdirSync(dir).find(x => /深度版\.html$/.test(x));
  if (d6) {
    const h = fs.readFileSync(path.join(dir, d6), 'utf8');
    t6 = h.split(/(?=<section[^>]*class="[^"]*\bslide\b)/).length - 1;
  }
  console.log(
    c.padEnd(8) +
    '期数 ' + String(s.quarters || '?').padStart(2) +
    ' · 官方对账 ' + okN + '/' + ch.length +
    ' · 模板版 ' + tpl + ' 页' +
    ' · T6 深度版 ' + t6 + ' 页' +
    ' · 深度报告 ' + (s.deepReportGenerated ? '有' : '无') +
    ' · 交付文件 ' + Object.keys(run.files || {}).length
  );
}

console.log('\n--- 校准结果(当前实现) ---');
for (const c of ['519191', '021967']) {
  const f = path.join(R, c, 'datasetMeta.json');
  if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const cal = d.perfCalibration;
  if (!cal) { console.log('  ' + c + ': 无校准记录(该次运行早于校准功能)'); continue; }
  console.log('  ' + c + ': ' + (cal.ok ? `可比 ${cal.n} 期, 最大偏差 ${cal.maxAbsDiff}pp ${cal.consistent ? '(口径一致)' : '(需复核)'}` : cal.reason));
}
