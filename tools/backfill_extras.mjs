/* backfill_extras.mjs —— 给"补建出来的"历史复盘补上服务端才有的三节
 *
 * 背景: tools/backfill_runs.mjs 是直接从底稿反推 analysis 的, 它只跑规则引擎,
 * 所以补出来的报告**没有**服务端在 runPipeline 里插的三节:
 *   ① 产品类型(主动 / 被动指数 / ETF / 联接)   ② 持仓拟合(前十理论净值 vs 实际)   ③ 该追问的三个问题
 * 结果是同一站上两只基金, 一只 13 节、另一只 11 节 —— 页面上看起来像"第二只报告写漏了"。
 *
 * 这个工具只做那三节: 不重爬、不调大模型、不改数字。默认**在已有 analysis 上插**(保住该次运行里
 * 由大模型写进去的章节), 只有 --rebuild 才从头重算引擎(会丢掉大模型那部分, 慎用)。
 *
 * 用法:
 *   node tools/backfill_extras.mjs --code 090007                      # 用 _runs/<code>/fit.json(没有就插一节说明)
 *   node tools/backfill_extras.mjs --code 090007 --fit                 # 先算一遍持仓拟合(联网, 约 1~2 分钟)
 *   node tools/backfill_extras.mjs --code 090007 --rebuild             # 从底稿重算引擎(无大模型内容)
 *
 * 注意: 代码必须用 --code 传, 不要写成位置参数 —— server/fit.mjs 和 server/pipeline.mjs 在 import 时
 * 会读 process.argv, 位置参数是一个 6 位代码就会触发它们的 CLI 自测(白算一次拟合, 约 1 分钟)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFC } from '../server/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(ROOT, '_runs');
const SEED = path.join(ROOT, '_seed');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const code = String(arg('code', '')).replace(/\D/g, '');
const wantFit = process.argv.includes('--fit');
const rebuild = process.argv.includes('--rebuild');
const patchText = process.argv.includes('--patch-text');
if (!/^\d{6}$/.test(code)) { console.error('用法: node tools/backfill_extras.mjs --code <6位代码> [--fit] [--rebuild]'); process.exit(2); }

const dir = path.join(RUNS, code);
if (!fs.existsSync(dir)) { console.error('没有 ' + dir); process.exit(2); }
const files = fs.readdirSync(dir);
const datasetFile = files.find(f => /^底稿_.*\.json$/.test(f));
if (!datasetFile) { console.error('找不到底稿 JSON'); process.exit(2); }

const FC = getFC();
const dataset = JSON.parse(fs.readFileSync(path.join(dir, datasetFile), 'utf8'));
console.log('底稿: ' + dataset.fund.name + ' · ' + dataset.fund.range + ' · ' + dataset.fund.quarterCount + ' 期');

/* ---- 1. 拿 analysis: 默认沿用盘上那份(保住大模型写进去的章节), --rebuild 才重算 ---- */
const analysisPath = path.join(dir, 'analysis.json');
let analysis;
if (rebuild || !fs.existsSync(analysisPath)) {
  analysis = FC.analyze(dataset, { source: 'crawled' });
  if (analysis.error) { console.error('引擎报错: ' + analysis.error); process.exit(1); }
  console.log('引擎重算: ' + analysis.report.sections.length + ' 节');
} else {
  analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  console.log('沿用已有 analysis: ' + analysis.report.sections.length + ' 节');
}
const sections = analysis.report.sections;
const has = re => sections.some(s => re.test(String((s && s.title) || '')));

/* ---- 2.5 修补"旧引擎留下的脏文本" ----
 * 踩过的实例: 090007 这份是 2026-09 的旧引擎产物, 第 2 节把 dataset.sources(对象数组)直接拼进 HTML,
 * 页面上就是「数据来源: [object Object] ； [object Object] …」。旧报告里看不出, 一上网页就露馅。
 * 用当前引擎对同一份底稿重算一遍, 只把**同名且含脏字段**的那一节换掉, 其余(含大模型写的章节)一律不动。 */
if (patchText) {
  const fresh = FC.analyze(dataset, { source: 'crawled' });
  const dirty = /\[object Object\]|>NaN<|undefined/;
  let fixed = 0;
  sections.forEach((s, i) => {
    if (!dirty.test(JSON.stringify(s))) return;
    const f = fresh.report.sections.find(x => x.title === s.title);
    if (f) { sections[i] = f; fixed++; console.log('~ 修补脏文本章节: ' + s.title); }
    else console.log('! 这一节含脏文本但当前引擎不产出同名章节, 跳过: ' + s.title);
  });
  console.log('修补 ' + fixed + ' 节');
}

/* ---- 2. 产品类型 ---- */
const kind = analysis.kind && analysis.kind.label ? analysis.kind : FC.detectFundKind(dataset.fund);
analysis.kind = kind;
if (!has(/^产品类型/)) {
  if (FC.kindSection) insertAfterTitle(sections, '口径与证据边界', FC.kindSection(kind));
  console.log('+ 产品类型: ' + kind.label);
} else console.log('= 产品类型已有');

/* ---- 3. 持仓拟合 ---- */
let fit = null;
if (wantFit) {
  const { fitHoldings } = await import('../server/fit.mjs');
  console.log('算持仓拟合(联网, 约 1~2 分钟)…');
  fit = await fitHoldings({ code, quarters: dataset.quarters, onProgress: m => console.log('  · ' + m) });
  if (fit && fit.ok) fs.writeFileSync(path.join(dir, 'fit.json'), JSON.stringify(fit, null, 1), 'utf8');
} else if (fs.existsSync(path.join(dir, 'fit.json'))) {
  fit = JSON.parse(fs.readFileSync(path.join(dir, 'fit.json'), 'utf8'));
}
if (!has(/^持仓拟合/)) {
  if (fit && fit.ok) {
    analysis.fit = fit;
    if (FC.fitSection) insertBeforeAppendix(sections, FC.fitSection(fit, analysis.kind));
    console.log('+ 持仓拟合: 完成 · 相关性 ' + (fit.fit.corr * 100).toFixed(1) + '% · ' + fit.window.weeks + ' 周');
  } else {
    if (FC.fitSectionFailed) insertBeforeAppendix(sections, FC.fitSectionFailed(fit || { ok: false, reason: '这次运行没有算持仓拟合(缺 fit.json)' }));
    console.log('+ 持仓拟合: 未完成 —— ' + ((fit && fit.reason) || '缺 fit.json'));
  }
} else console.log('= 持仓拟合已有');

/* ---- 4. 该追问的三个问题 ---- */
if (!has(/^该追问/)) {
  if (FC.followupSection) {
    const sec = FC.followupSection(analysis);
    if (sec) { insertBeforeAppendix(sections, sec); console.log('+ 该追问的三个问题'); }
  }
} else console.log('= 该追问已有');

const check = FC.runCheck(dataset, analysis);
console.log('\n插入后: ' + sections.length + ' 节 · 质检 ' + check.summary.verdictText);
sections.forEach((s, i) => console.log('   ' + String(i + 1).padStart(2) + '. ' + s.title));

/* ---- 5. 落盘(_runs + _seed 两份) ---- */
const { stripDataset } = await import('../server/pipeline.mjs');
const runPath = path.join(dir, 'run.json');
const run = fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, 'utf8')) : { code };
if (run.summary) {
  run.summary.formTag = analysis.form.tag;
  run.summary.check = check.summary;
}

const out = {
  'analysis.json': JSON.stringify(analysis),
  'check.json': JSON.stringify(check),
  'datasetMeta.json': JSON.stringify(stripDataset(dataset)),
  'run.json': JSON.stringify(run, null, 1)
};
if (fit && fit.ok) out['fit.json'] = JSON.stringify(fit, null, 1);
for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(dir, name), text, 'utf8');
console.log('\n已写 _runs/' + code + ': ' + Object.keys(out).join(' '));

const seedDir = path.join(SEED, code);
if (fs.existsSync(seedDir)) {
  for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(seedDir, name), text, 'utf8');
  console.log('已同步 _seed/' + code + '(展台包从这里烤)');
} else {
  console.log('提示: 没有 _seed/' + code + ', 只更新了 _runs');
}

/* 与 pipeline.mjs 同一套插入位置: 产品类型紧跟"口径与证据边界", 拟合与追问插在附录前 */
function insertAfterTitle(list, part, sec) {
  const i = list.findIndex(s => String((s && s.title) || '').indexOf(part) >= 0);
  if (i < 0) list.push(sec); else list.splice(i + 1, 0, sec);
  return list;
}
function insertBeforeAppendix(list, sec) {
  const i = list.findIndex(s => /附录/.test(String((s && s.title) || '')));
  if (i < 0) list.push(sec); else list.splice(i, 0, sec);
  return list;
}
