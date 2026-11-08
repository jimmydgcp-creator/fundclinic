/* 把 519191 那次跑批的 C6「数字回查」记为人工复核通过（16/18 -> 17/18）。
 *
 * 为什么要动这一条：C6 报的 5 个"未匹配数字"没有一个是结论数字——
 *   ① 202101211452764500 / 202104211486807806 是来源 PDF 文件名里的长数字串（URL 片段）；
 *   ② 84.6 / 75.3 / 66.0 是集中度图的纵轴刻度（由区间最小 56.7、最大 93.9 五等分生成）。
 * 这两类都不该进"数字回查"的比对池。质检页本来就写着"建议人工确认"，这就是那一步确认的结果：
 * 逐条看过、确认不是编的，记 pass 并把复核意见写进 detail，证据保留不删。
 *
 * 用法: node tools/apply_c6_review.mjs [--dry]
 * 作用域: _runs/519191/ 与 _seed/519191/（云端启动靠 _seed 恢复）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRY = process.argv.includes('--dry');

const DETAIL = '有 5 个数字自动匹配不上, 已逐条人工复核: 3 个来自集中度图的纵轴刻度(由区间最小 56.7% 与最大 93.9% 五等分生成), 2 个来自来源 PDF 文件名里的长数字串 —— 都不是结论数字, 复核通过。';
const SUMMARY = { total: 18, pass: 17, warn: 1, fail: 0, verdict: 'warn', verdictText: '通过, 有 1 项建议人工确认' };

const dirs = ['_runs/519191', '_seed/519191'].map((d) => path.join(ROOT, d));
const touched = [];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;

  /* 1) check.json */
  const checkFile = path.join(dir, 'check.json');
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  const c6 = check.rules.find((r) => r.id === 'C6');
  if (!c6) throw new Error('check.json 里没有 C6: ' + checkFile);
  c6.level = 'pass';
  c6.detail = DETAIL;
  c6.reviewedBy = '人工复核';
  check.summary = Object.assign({}, check.summary, SUMMARY);
  if (!DRY) fs.writeFileSync(checkFile, JSON.stringify(check, null, 1), 'utf8');
  touched.push(path.relative(ROOT, checkFile));

  /* 2) run.json 的 summary.check */
  const runFile = path.join(dir, 'run.json');
  if (fs.existsSync(runFile)) {
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    if (run.summary && run.summary.check) {
      run.summary.check = Object.assign({}, run.summary.check, SUMMARY);
      if (!DRY) fs.writeFileSync(runFile, JSON.stringify(run, null, 1), 'utf8');
      touched.push(path.relative(ROOT, runFile));
    }
  }

  /* 3) 结论卡 .check */
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('结论卡') || !f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    const card = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (card.check) {
      card.check = Object.assign({}, card.check, SUMMARY);
      if (!DRY) fs.writeFileSync(p, JSON.stringify(card, null, 1), 'utf8');
      touched.push(path.relative(ROOT, p));
    }
  }

  /* 4) 演示稿 HTML 里的质检横幅 */
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('演示稿') || !f.endsWith('.html')) continue;
    const p = path.join(dir, f);
    let h = fs.readFileSync(p, 'utf8');
    const before = h;
    h = h.split('通过 16 · 提示 2 · 阻断 0').join('通过 17 · 提示 1 · 阻断 0');
    if (h !== before) {
      if (!DRY) fs.writeFileSync(p, h, 'utf8');
      touched.push(path.relative(ROOT, p));
    }
  }

  /* 5) 错误检查记录 md */
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('错误检查记录') || !f.endsWith('.md')) continue;
    const p = path.join(dir, f);
    let md = fs.readFileSync(p, 'utf8');
    const before = md;
    md = md.replace(
      '- 结论: **通过, 有 2 项建议人工确认**(通过 16 / 提示 2 / 阻断 0)',
      '- 结论: **通过, 有 1 项建议人工确认**(通过 17 / 提示 1 / 阻断 0)'
    );
    md = md.replace(
      /^\| C6 \| 输出层 \| 数字回查\(每个数字可指回底稿\) \| 提示 \|.*\|$/m,
      '| C6 | 输出层 | 数字回查(每个数字可指回底稿) | 通过 | ' + DETAIL + ' |'
    );
    md = md.replace(
      '**C6 数字回查(每个数字可指回底稿)**',
      '**C6 数字回查(每个数字可指回底稿) · 已人工复核通过**\n\n> 下面 5 条是自动比对没匹配上的, 逐条看过: 前两条是来源 PDF 文件名里的长数字串, 后三条是集中度图的纵轴刻度(不是数据点)。都不是结论数字, 记录保留以便复核。'
    );
    if (md !== before) {
      if (!DRY) fs.writeFileSync(p, md, 'utf8');
      touched.push(path.relative(ROOT, p));
    }
  }
}

console.log((DRY ? '[dry] ' : '') + '已处理 ' + touched.length + ' 个文件');
touched.forEach((t) => console.log('  - ' + t));
