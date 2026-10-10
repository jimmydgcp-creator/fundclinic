/* 补建历史索引: 把"持久化功能上线之前"跑过的基金, 从已落盘的底稿反推出 analysis / check / run.json,
 * 让它们出现在页面的"最近复盘记录"里 —— 不需要重跑、不联网。
 *
 * 用法: node tools/backfill_runs.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFC, ROOT } from '../server/engine.mjs';
import { stripDataset } from '../server/pipeline.mjs';

const dry = process.argv.includes('--dry');
const RUNS = path.join(ROOT, '_runs');
const FC = getFC();

let made = 0, skipped = 0, failed = 0;
const codes = fs.readdirSync(RUNS).filter(n => /^\d{6}$/.test(n));

console.log('扫描 _runs/ 下 ' + codes.length + ' 个基金目录' + (dry ? '(演练模式, 不写文件)' : '') + '\n');

for (const code of codes) {
  const dir = path.join(RUNS, code);
  const files = fs.readdirSync(dir);
  const datasetFile = files.find(f => /^底稿_.*\.json$/.test(f));
  const hasRun = files.includes('run.json');

  if (hasRun) { skipped++; console.log('  跳过 ' + code + ' (已有 run.json)'); continue; }
  if (!datasetFile) { failed++; console.log('  ✗ ' + code + ' 找不到底稿 JSON, 无法补建'); continue; }

  try {
    const dataset = JSON.parse(fs.readFileSync(path.join(dir, datasetFile), 'utf8'));
    const analysis = FC.analyze(dataset, { source: 'crawled' });
    if (analysis.error) throw new Error(analysis.error);
    const check = FC.runCheck(dataset, analysis);

    // 交付物路径(取盘上实际存在的)
    const pick = re => { const f = files.find(x => re.test(x)); return f ? path.join(dir, f) : null; };
    const outFiles = {
      dataset: path.join(dir, datasetFile),
      report: pick(/^复盘报告_.*\.md$/),
      check: pick(/^错误检查记录_.*\.md$/),
      card: pick(/^结论卡_.*\.json$/),
      deck: pick(/^演示稿_.*\.html$/),
      sources: pick(/^来源清单_.*\.md$/)
    };
    const cleanFile = files.find(f => /_对外版\.md$/.test(f));
    if (cleanFile) outFiles.reportClean = path.join(dir, cleanFile);
    const pdfFile = files.find(f => /^演示稿_.*\.pdf$/);
    const pdf = pdfFile ? path.join(dir, pdfFile) : null;

    const summary = {
      code, name: dataset.fund.name, manager: dataset.fund.manager, range: dataset.fund.range,
      quarters: dataset.fund.quarterCount, formTag: analysis.form.tag,
      perf: analysis.perf ? { cumReturn: analysis.perf.cumReturn, exBestQuarter: analysis.perf.exBestQuarter, maxDrawdown: analysis.perf.maxDrawdown } : null,
      check: check.summary,
      official: dataset.official ? {
        available: dataset.official.available, pdftotext: dataset.official.pdftotext,
        checks: (dataset.official.checks || []).map(c => ({ period: c.period, reason: c.reason, parsedRows: c.parsedRows, ok: c.reconcile ? c.reconcile.ok : false, maxDiff: c.reconcile ? c.reconcile.maxWeightDiff : null, diffs: c.reconcile ? c.reconcile.diffs : [], note: c.reconcile ? c.reconcile.note : (c.error || '') })),
        notes: dataset.official.notes, talks: (dataset.official.talks || []).length
      } : null,
      sources: dataset.sources, rangeInfo: dataset.rangeInfo, cleanLog: dataset.cleanLog,
      aiLog: cleanFile ? [{ task: 'T3 · 对外用词清洗', ok: true, issues: [{ level: 'pass', msg: '检测到 _对外版.md, 说明该次运行的用词清洗已通过校验(具体校验明细在补建前的运行日志里)' }] }] : [],
      files: Object.fromEntries(Object.entries(outFiles).filter(([, v]) => v).map(([k, v]) => [k, { path: v, rel: path.relative(ROOT, v), bytes: fs.statSync(v).size }])),
      pdf: pdf ? { path: pdf, rel: path.relative(ROOT, pdf), bytes: fs.statSync(pdf).size } : null,
      steps: [{ name: '补建历史索引', detail: '本次记录由 tools/backfill_runs.mjs 从已落盘底稿反推(原始运行发生在持久化上线之前)', at: new Date().toISOString() }],
      totalMs: null, backfilled: true
    };

    // 时间戳沿用交付物的最后修改时间, 保证排序合理
    const stamps = Object.values(outFiles).filter(Boolean).map(p => fs.statSync(p).mtimeMs);
    const at = new Date(Math.max(...stamps)).toISOString();

    console.log(`  补建 ${code} ${dataset.fund.name} · ${dataset.fund.range} · ${dataset.fund.quarterCount} 期 · 形态 ${analysis.form.tag} · 质检 ${check.summary.verdictText} · 交付物 ${Object.keys(summary.files).length} 个`);

    if (!dry) {
      fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(analysis), 'utf8');
      fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(check), 'utf8');
      fs.writeFileSync(path.join(dir, 'datasetMeta.json'), JSON.stringify(stripDataset(dataset)), 'utf8');
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ code, summary, files: summary.files, pdf, at, backfilled: true }, null, 1), 'utf8');
    }
    made++;
  } catch (e) {
    failed++;
    console.log('  ✗ ' + code + ' 补建失败: ' + e.message);
  }
}

console.log('\n完成: 补建 ' + made + ' 个, 跳过 ' + skipped + ' 个, 失败 ' + failed + ' 个');
if (made && !dry) console.log('重启服务(或刷新页面)即可在"最近的复盘记录"里看到它们。');
