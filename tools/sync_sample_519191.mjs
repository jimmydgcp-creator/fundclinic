/* 把内置样例 519191 从「Q2 / 23 期」同步成「Q3 / 24 期」。
 *
 * 背景: 页面上有两块入口会显示 519191 ——
 *   ① 「用内置样例看完整效果」读的是 data/funds.data.js（10 月定稿, 只到 2026Q2 / 23 期 / +76.77%）
 *   ② 「最近的复盘记录」读的是服务端 _runs/519191（11 月跑批, 到 2026Q3 / 24 期 / +119.36%）
 * 同一只基金在一屏上出两个数字、两个形态标签, 属于数据不同源。
 * 本脚本把 ① 换成 ②的那份底稿, 并把它当时的形态改判结果一并带过去, 两边就只剩一个口径。
 *
 * 用法: node tools/sync_sample_519191.mjs [--dry]
 * 产物: data/funds.data.js（002910 原样保留）· data/519191.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRY = process.argv.includes('--dry');

const RUN = path.join(ROOT, '_runs', '519191');
const draftFile = fs.readdirSync(RUN).find((f) => f.startsWith('底稿_') && f.endsWith('.json'));
if (!draftFile) throw new Error('找不到 _runs/519191 的底稿');

const draft = JSON.parse(fs.readFileSync(path.join(RUN, draftFile), 'utf8'));
const analysis = JSON.parse(fs.readFileSync(path.join(RUN, 'analysis.json'), 'utf8'));

/* 1) 底稿 -> 样例对象
 * 只留报告真正会读的字段; crawlLog / managerHistory 这些调试用的不进样例, 免得单文件版白胖 40KB。 */
const sample = {
  schema: 'fundclinic/2',
  crawledAt: draft.crawledAt,
  crawlStandard: draft.crawlStandard,
  fund: Object.assign({}, draft.fund, {
    range: analysis.range,
    quarterCount: analysis.quarterCount
  }),
  perf: draft.perf,
  perfDetail: draft.perfDetail,
  perfCalibration: draft.perfCalibration,
  quarters: draft.quarters,
  prevTenure: draft.prevTenure,
  rangeInfo: draft.rangeInfo,
  allQuartersCount: draft.allQuartersCount,
  official: draft.official,
  sources: draft.sources,
  cleanLog: draft.cleanLog,
  /* 2) 门禁 2 的改判结果: 引擎判「主题坚守型」, 大模型按证据链改成「个股稳定 + 主题切换型」。
   *    不改这一项的话, 样例会显示引擎原判, 与最近记录里同一次跑批的标签对不上。 */
  formOverride: {
    tag: analysis.form.tag,
    confidence: analysis.form.confidence,
    reasons: analysis.form.reasons,
    alternatives: analysis.form.alternatives || [],
    note: '形态标签取自该次正式跑批（门禁 2: 引擎给候选「主题坚守型」, 大模型按"前十名单稳定但主题归类切换过"改为本条, 人工复核后采纳）'
  }
};

/* 3) 合并进 funds.data.js（002910 不动） */
const dataFile = path.join(ROOT, 'data', 'funds.data.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(dataFile, 'utf8'), sandbox);
const all = sandbox.window.FUNDCLINIC_DATA;

const had002910 = !!all['002910'];
all['519191'] = sample;

const header = '/* 由 tools/extract_data.py 生成, 请勿手改。来源: 公开季报 / 天天基金 F10 */\n';
const body = 'window.FUNDCLINIC_DATA = ' + JSON.stringify(all) + ';\n';

if (DRY) {
  console.log('[dry] 519191 ->', sample.fund.range, sample.quarters.length + ' 期',
    '| perf', sample.perf.cumReturn + '%', '| 形态(改判后)', sample.formOverride.tag,
    '| 002910 保留:', had002910);
} else {
  fs.writeFileSync(dataFile, header + body, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'data', '519191.json'), JSON.stringify(sample, null, 1), 'utf8');
  console.log('已写入 data/funds.data.js');
  console.log('  519191:', sample.fund.range, '·', sample.quarters.length, '期 ·',
    sample.perf.cumReturn + '% ·', sample.formOverride.tag);
  console.log('  002910:', had002910 ? '保留原样' : '⚠ 原文件里就没有');
  console.log('  体积:', (Buffer.byteLength(header + body) / 1024).toFixed(0) + 'KB');
}
