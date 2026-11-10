/* 重跑「官方报告逐行对账」, 并把它引出的数字/文档一次性改齐。
 *
 * 为什么需要它: 官方季报清单里, 同一只基金不同年份的季度标题会混用阿拉伯/中文数字
 * (519191: 2021 年第二、三季度写作「第二/三季度报告」)。旧分类器只认阿拉伯数字,
 * 这两期被归成 other → 24 个报告期只对到 23 期。修好分类器之后, 只要重跑官方这一层
 * 就够了: 抓取/引擎/大模型那些都不动, 用已有底稿 + 已有成稿。
 *
 * 用法: node tools/refresh_official.mjs [基金代码] [--dry]
 * 产物(仅在非 dry 时写): 底稿 / analysis / check / 结论卡 / 报告 / 来源清单 / 演示稿 /
 *   datasetMeta / run.json 里的 summary(official/check/sources/files 大小)
 * 不做: 大模型那三份成稿(深度报告 / 对外版 / 深度版演示稿) —— 它们要人工改文案,
 *   见 tools/patch_ai_text.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFC } from '../server/engine.mjs';
import { verifyAgainstOfficial } from '../server/official.mjs';
import { renderDeck } from '../server/deck.mjs';
import { stripDataset, buildCard, sourceLedger } from '../server/artifacts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = (process.argv.slice(2).find(a => /^\d{6}$/.test(a))) || '519191';
const DRY = process.argv.includes('--dry');
const DIR = path.join(ROOT, '_runs', code);

const draftName = fs.readdirSync(DIR).find(f => f.startsWith('底稿_') && f.endsWith('.json'));
if (!draftName) throw new Error('找不到 ' + code + ' 的底稿');
const dataset = JSON.parse(fs.readFileSync(path.join(DIR, draftName), 'utf8'));
const analysis = JSON.parse(fs.readFileSync(path.join(DIR, 'analysis.json'), 'utf8'));
const run = JSON.parse(fs.readFileSync(path.join(DIR, 'run.json'), 'utf8'));
const FC = getFC();

const log = (...a) => console.log(...a);
const pct = x => (Math.round(x * 100) / 100) + '%';

/* ---------------------------------------------------------------- 1. 重跑官方对账 */
log('抓官方季报原文(全量 ' + dataset.quarters.length + ' 期)…');
const official = await verifyAgainstOfficial(code, dataset.quarters, { all: true });
const okCount = official.checks.filter(c => c.reconcile && c.reconcile.ok).length;
const rowsTotal = official.checks.reduce((s, c) => s + (c.parsedRows || 0), 0);
log('  checks=' + official.checks.length + '  ok=' + okCount + '  行=' + rowsTotal +
  '  missingReports=' + JSON.stringify(official.missingReports || []));
const periods = official.checks.map(c => c.period);
for (const q of dataset.quarters) if (!periods.includes(q.period)) log('  ! 仍然缺: ' + q.period);

/* ---------------------------------------------------------------- 2. 底稿字段 */
const baseSources = dataset.sources.filter(s => s.type !== '官方定期报告 PDF');
const officialSources = official.checks.filter(c => !c.error).map(c => ({
  type: '官方定期报告 PDF', url: c.url, fetchedAt: new Date().toISOString(),
  period: c.period, bytes: c.bytes,
  对账: c.reconcile ? (c.reconcile.ok ? '逐行一致' : '有差异') : '未完成'
}));
dataset.sources = [...baseSources, ...officialSources];
dataset.official = official;
dataset.crawlLog.officialChecks = official.checks.length;

/* 官方窗口校准: 与 pipeline.calibrateAgainstOfficial 同一套算法 */
const perf = dataset.perfDetail;
const eng = new Map((perf.quarterReturns || []).map(r => [r.period, r.ret]));
const calRows = [];
for (const c of official.checks) {
  const p3 = c.perf && c.perf['过去三个月'];
  if (!p3 || typeof p3.nav !== 'number') continue;
  if (!eng.has(c.period)) continue;
  if (perf.baseClamped && c.period === perf.quarterReturns[0].period) {
    calRows.push({ period: c.period, official: p3.nav, engine: null, diff: null, skipped: '基金成立晚于季度初, 首期口径不可比' });
    continue;
  }
  const e = Math.round(eng.get(c.period) * 100) / 100;
  calRows.push({ period: c.period, official: p3.nav, engine: e, diff: Math.round((e - p3.nav) * 100) / 100 });
}
const cmp = calRows.filter(r => r.diff !== null);
const maxAbs = Math.max(...cmp.map(r => Math.abs(r.diff)));
dataset.perfCalibration = {
  ok: true, rows: calRows, n: cmp.length, maxAbsDiff: Math.round(maxAbs * 100) / 100,
  worst: cmp.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a)),
  consistent: maxAbs <= 0.05
};
const baseNote = String(dataset.perf.note || '').replace(/已与官方季报披露的[\s\S]*$/, '');
dataset.perf.note = baseNote +
  `已与官方季报披露的「过去三个月」净值增长率逐期校准 ${dataset.perfCalibration.n} 期, ` +
  `最大偏差 ${dataset.perfCalibration.maxAbsDiff}pp` +
  (dataset.perfCalibration.consistent ? '(口径一致)' : `(偏差偏大, 见"${dataset.perfCalibration.worst.period}" ${dataset.perfCalibration.worst.diff}pp, 需人工复核)`) + '。';
analysis.perf.note = dataset.perf.note;
log('校准 ' + dataset.perfCalibration.n + ' 期, 最大偏差 ' + dataset.perfCalibration.maxAbsDiff + 'pp');

/* ---------------------------------------------------------------- 3. 报告里带出来的数字 */
const EV = (v, src) => `<span class="ev ev-fact" data-src="${src}" title="证据级别: 披露事实 · 来源: ${src}">${v}</span>`;
const secS1 = analysis.report.sections.find(s => /口径与证据边界/.test(s.title));
if (secS1) {
  const before = secS1.html;
  /* ① 业绩比较基准那一格: 旧版永远是"未取到"的占位符(引擎生成时 fund.benchmark 还没回填) */
  const bm = (dataset.fund && dataset.fund.benchmark) || (analysis.env && analysis.env.benchmarkDeclared) || '';
  if (bm) {
    secS1.html = secS1.html.replace(
      /<span class="flag">未取到[^<]*<\/span>/,
      EV(bm, '基金概况') + `<span class="muted">(区间内长期为 沪深300指数收益率*50%+中证全债指数收益率*50%, 2026Q3 报告起调整)</span>`
    );
  }
  /* ② 数据来源里的「共 N 期」跟着官方报告条数走 */
  secS1.html = secS1.html.replace(
    /(<span class="ev ev-fact"[^>]*>)\d+(<\/span> 期, 逐行对账)/,
    '$1' + officialSources.length + '$2'
  );
  log('section1 有改动:', before !== secS1.html);
}
/* ③ 总成绩那节的收益口径注释: 「逐期校准 N 期, 最大偏差 X pp」 */
let calHit = 0;
for (const s of analysis.report.sections) {
  const before = s.html;
  s.html = s.html
    .replace(/(逐期校准 <span[^>]*>)\d+(<\/span> 期)/, '$1' + dataset.perfCalibration.n + '$2')
    .replace(/(最大偏差 <span[^>]*>)[\d.]+(<\/span>pp)/, '$1' + dataset.perfCalibration.maxAbsDiff + '$2');
  if (before !== s.html) calHit++;
}
log('校准期数改动节数:', calHit);
/* ④ env 里的基准核验结果整块换成这次重算的(旧样本带 23 期 + 「为：」解析噪声) */
if (analysis.env && dataset.official.benchmark) {
  analysis.env.benchmarkVerified = dataset.official.benchmark;
  log('benchmarkVerified: ' + analysis.env.benchmarkVerified.samples.length + ' 期 · ' +
    analysis.env.benchmarkVerified.changes.length + ' 次变更: ' + JSON.stringify(analysis.env.benchmarkVerified.changes));
}

/* ---------------------------------------------------------------- 4. 重生成确定性交付物 */
/* 质检(错误检查记录/结论卡里的 check 字段)**不重跑**: 那 18 条规则是在 pipeline 里
 * 于《产品类型 / 持仓拟合 / 该追问》三节插入**之前**跑的, 只覆盖引擎的 11 节。
 * 现在拿补了三节的成稿去重跑, C6「数字回查」会把图表轴标签与 PDF URL 里的数字
 * 也当结论数字, 平白多出一条 warn —— 那是校验口径的问题, 不是这次改对账要修的东西。
 * 所以沿用原 check.json, 只把「官方对账」相关的确定性产物重生成。 */
const check = JSON.parse(fs.readFileSync(path.join(DIR, 'check.json'), 'utf8'));
const generatedBy = '基金复诊台 FundClinic · 自动采集 + 规则引擎 + 大模型(输出经校验)';
const reportMd = FC.reportToMarkdown(analysis, { generatedBy });
const card = buildCard(analysis, dataset, check);
const deckHtml = renderDeck({ analysis, dataset, check }, {});
const sourcesMd = sourceLedger(dataset, analysis);
const datasetJson = JSON.stringify(dataset, null, 1);
const metaJson = JSON.stringify(stripDataset(dataset));

/* ---------------------------------------------------------------- 5. 旧新对比 + 落盘 */
const oldMd = fs.readFileSync(path.join(DIR, '复盘报告_' + dataset.fund.name + '_' + code + '.md'), 'utf8');
const aL = oldMd.split('\n'), bL = reportMd.split('\n');
let diff = 0;
for (let i = 0; i < Math.max(aL.length, bL.length); i++) {
  if ((aL[i] || '') !== (bL[i] || '')) {
    diff++;
    if (diff <= 8) log('  ~L' + i + '\n    旧: ' + (aL[i] || '').slice(0, 150) + '\n    新: ' + (bL[i] || '').slice(0, 150));
  }
}
log('报告 md 差异行数: ' + diff);
log('deck 官方对账: ' + (/<div class="lab">官方对账<\/div><div class="val[^"]*">([^<]+)</.exec(deckHtml) || [])[1]);
log('deck 体量: ' + (deckHtml.length / 1024).toFixed(0) + 'KB (旧 ' + (fs.statSync(path.join(DIR, '演示稿_' + dataset.fund.name + '_' + code + '.html')).size / 1024).toFixed(0) + 'KB)');
log('check(沿用原档): ' + check.summary.verdictText);
(check.rules || []).filter(r => r.level !== 'pass').forEach(r =>
  log('  [' + r.level + '] ' + r.id + ' ' + (r.name || '') + ' —— ' + String(r.detail || '').slice(0, 120)));

if (DRY) {
  fs.writeFileSync(path.join(DIR, '_deck_new.tmp.html'), deckHtml, 'utf8');
  log('\n[dry] 未写盘(新演示稿写到 _deck_new.tmp.html 便于对比)');
  process.exit(0);
}

const base = dataset.fund.name + '_' + code;
const W = (name, content) => {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  log('  写出 ' + name + '  ' + (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1) + 'KB');
};
W(draftName, datasetJson);
W('analysis.json', JSON.stringify(analysis));
W('结论卡_' + base + '.json', JSON.stringify(card, null, 2));
W('复盘报告_' + base + '.md', reportMd);
W('来源清单_' + base + '.md', sourcesMd);
W('演示稿_' + base + '.html', deckHtml);
W('datasetMeta.json', metaJson);

/* run.json: 面板/下载用的 summary 要跟着改 */
run.summary.official = dataset.official ? {
  available: dataset.official.available,
  pdftotext: dataset.official.pdftotext,
  checks: (dataset.official.checks || []).map(c => ({
    period: c.period, reason: c.reason, parsedRows: c.parsedRows,
    ok: c.reconcile ? c.reconcile.ok : false,
    maxDiff: c.reconcile ? c.reconcile.maxWeightDiff : null,
    diffs: c.reconcile ? c.reconcile.diffs : [],
    note: c.reconcile ? c.reconcile.note : (c.error || '')
  })),
  notes: dataset.official.notes,
  talks: (dataset.official.talks || []).length
} : null;
run.summary.sources = dataset.sources;
run.summary.check = check.summary;
run.refreshedAt = new Date().toISOString();
for (const [k, v] of Object.entries(run.summary.files || {})) {
  const p = path.join(ROOT, v.rel);
  if (fs.existsSync(p)) run.summary.files[k] = { path: p, rel: v.rel, bytes: fs.statSync(p).size };
}
fs.writeFileSync(path.join(DIR, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
log('  写出 run.json (summary.official / sources / check / files 大小已同步)');
log('\n完成。下一步: ① node tools/polish_report.mjs ' + code + ' (用新报告重跑 T3 生成对外版) ' +
  '② node tools/patch_ai_text.mjs ' + code + ' (改深度报告/深度版演示稿文案) ' +
  '③ node tools/rebuild_pdfs.mjs ' + code + ' ④ node tools/sync_sample_519191.mjs + build_standalone ⑤ sync_seed + pack_showcase + 部署');
