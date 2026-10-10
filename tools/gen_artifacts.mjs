/* 用引擎真实生成交付物(不是手写的样例):
 *   ../00_交作业/错误检查记录_<code>.md
 *   ../00_交作业/AI运行记录_<code>.md
 *   ../00_交作业/复盘报告_<code>.md
 *   ../00_交作业/结论卡_<code>.json
 *   ../00_交作业/结论卡对比.md      (证明"同一模板跨基金可比")
 * 用法: node tools/gen_artifacts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(ROOT, '..', '00_交作业');
fs.mkdirSync(OUT, { recursive: true });

const sandbox = { console, window: {}, fetch: () => Promise.reject(new Error('no network')) };
vm.createContext(sandbox);
for (const f of ['data/funds.data.js', 'app/engine.js', 'app/parse.js', 'app/checker.js', 'app/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const FC = sandbox.window.FC;

const r2 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const cards = [];

function sha8(s) { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); }

for (const code of ['519191', '002910']) {
  const dataset = JSON.parse(JSON.stringify(FC.getBuiltin(code)));
  const a = FC.analyze(dataset, { source: 'builtin' });
  const ck = FC.runCheck(dataset, a);

  // 运行记录: 只记真实发生的事 —— 离线规则引擎跑完全流程; 大模型通道本次未调用。
  /* 2026-10-10 界面收敛: 原来这里记的是"☐ 待人工打勾" —— 但勾选框已经从页面上拿掉了,
     而且打勾本来就不产生证据(它只把导出按钮从灰变亮)。改成记"实际结算结果"。 */
  FC.ai.clearLog();
  FC.ai.log({ channel: '规则引擎(离线)', task: '全流程确定性计算', input: `${a.quarterCount} 期 × 前十大(${a.metrics.totalDistinct} 只个股)`, output: `指标 ${Object.keys(a.metrics).length} 组 / 报告 ${a.report.sections.length} 节 / 结论卡 1 张`, latencyMs: 0, valid: true, manual: '口径按页面所示直接生效(内置样例口径固定)' });
  FC.ai.log({ channel: '规则引擎(离线)', task: `自动质检(${ck.summary.total} 条规则)`, input: '输入层 6 / 计算层 4 / 输出层 8', output: ck.summary.verdictText, latencyMs: 0, valid: ck.summary.fail === 0, manual: ck.summary.warn ? `${ck.summary.warn} 项提示(报告中已说明)` : '无需额外说明' });
  FC.ai.log({ channel: '规则引擎(离线)', task: '回原文抽检清单生成(固定种子)', input: '底稿全部前十大记录', output: `${ck.manualSample.length} 处(每条给出报告期/标的/引擎值/核哪一列/官方季报链接)`, latencyMs: 0, valid: true, manual: '随报告交付, 固定种子可复现' });
  FC.ai.log({ channel: '大模型', task: 'T1 主题归类 / T2 判断起草 / T3 用词清洗 / T4 结论提炼 / T5 深度报告', input: `${a.metrics.totalDistinct} 只个股清单 / 指标包 / 报告全文`, output: '本次未调用(离线规则引擎已覆盖全流程); 页面另有服务端通道可调用大模型', latencyMs: 0, valid: undefined, manual: '未调用' });
  FC.ai.log({ channel: '引擎结算', task: '判断方向(引擎给候选)', input: `形态库候选 · 本次命中「${a.form.tag}」(置信度 ${a.form.confidence})`, output: '报告按此方向成文; 未发生人工改判', latencyMs: 0, valid: true, manual: 'humanOverride=false' });
  FC.ai.log({ channel: '引擎结算', task: `终审三查(数字/结论/合规)` , input: `${ck.manualSample.length} 处抽检清单 + 结论卡一致性 + 违禁词扫描(${FC.vocab.ban.length} 个词)`, output: `通过 ${ck.summary.pass} / 提示 ${ck.summary.warn} / 阻断 ${ck.summary.fail}`, latencyMs: 0, valid: ck.summary.fail === 0, manual: ck.summary.verdictText });

  const files = {
    [`错误检查记录_${code}.md`]: FC.checkToMarkdown(ck, a),
    [`AI运行记录_${code}.md`]: FC.ai.runLogToMarkdown(a),
    [`复盘报告_${code}.md`]: FC.reportToMarkdown(a, { generatedBy: '基金复诊台 FundClinic v1.0 · 规则引擎(离线确定性计算) · 本次未调用大模型' })
  };

  const card = {
    schema: 'fundclinic/1',
    generatedAt: new Date().toISOString(),
    generatedBy: '基金复诊台 FundClinic v1.0(离线规则引擎)',
    fund: { code: a.fund.code, name: a.fund.name, manager: a.fund.manager || '', range: a.range, quarters: a.quarterCount },
    card: {
      formTag: a.form.tag, formConfidence: a.form.confidence, engineFormTag: a.form.tag,
      humanOverride: false, humanReason: '',
      mainQuestion: a.card.mainQuestion, claim: a.card.claim, falsifier: a.card.falsifier,
      evidenceLevel: a.card.evidenceLevel, trackers: a.trackers, caveats: a.card.caveats
    },
    structure: {
      top10SumAvg: r2(a.metrics.conc.avg), top10SumRange: [r2(a.metrics.conc.min), r2(a.metrics.conc.max)],
      top10SumSlope: r2(a.metrics.conc.slope), avgRetained: r2(a.metrics.avgRetained), avgAdded: r2(a.metrics.avgAdded),
      avgJaccard: r2(a.metrics.avgJaccard), themeSwitches: a.metrics.theme.switches,
      themeChain: a.metrics.theme.known ? a.metrics.theme.runs.map(x => `${x.theme}(${x.len}期)`) : null,
      top1Avg: r2(a.metrics.leader.avg), distinctHoldings: a.metrics.totalDistinct, maxStreak: a.metrics.maxStreak
    },
    performance: a.perf ? { cumReturn: a.perf.cumReturn, exBestQuarter: a.perf.exBestQuarter, bestQuarter: a.perf.bestQuarter, bestQuarterContribution: r2(a.perf.bestQuarterContribution), maxDrawdown: a.perf.maxDrawdown, aumPeak: a.perf.aumPeak, aumEnd: a.perf.aumEnd } : null,
    check: ck.summary,
    /* 核查结果不是勾选框, 这里记的是"谁查的、查出几条" —— 与页面(ui.js cardToJSON)同一套字段。 */
    verification: {
      口径: '内置样例口径固定(数据来源/持仓范围/收益口径/输出性质, 页面直接显示)',
      规则数: ck.summary.total,
      通过: ck.summary.pass, 提示: ck.summary.warn, 阻断: ck.summary.fail,
      抽检清单: ck.manualSample.length + ' 处(固定种子可复现)',
      结算时间: ck.checkedAt
    }
  };
  files[`结论卡_${code}.json`] = JSON.stringify(card, null, 2);

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), content, 'utf8');
    console.log('  写出 ' + name.padEnd(30) + (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1) + ' KB');
  }

  cards.push({ code, a, ck, card });
  console.log(`  ${code}: 形态=${a.form.tag} · 质检=${ck.summary.verdictText}(${ck.summary.pass}通过/${ck.summary.warn}提示/${ck.summary.fail}阻断)\n`);
}

// 结论卡对比: 证明"同一套模板能跨基金产出可比结论"
const L = ['# 结论卡对比(证明同一模板跨基金可比)', '',
  `> 由「基金复诊台 FundClinic」v1.0 对两只基金跑同一套规则生成, 未经人工修改。生成时间: ${new Date().toISOString()}`, ''];
L.push('| 维度 | ' + cards.map(c => `${c.a.fund.name}(${c.code})`).join(' | ') + ' |');
L.push('| --- | ' + cards.map(() => '---').join(' | ') + ' |');
const rows = [
  ['基金经理', c => c.a.fund.manager || '—'],
  ['复盘区间', c => `${c.a.range}(${c.a.quarterCount} 期)`],
  ['形态标签', c => `${c.a.form.tag}(置信度 ${c.a.form.confidence})`],
  ['次优解释', c => c.a.form.alternatives.join(' / ') || '—'],
  ['前十合计均值', c => `${r2(c.a.metrics.conc.avg)}%(区间 ${r2(c.a.metrics.conc.min)}–${r2(c.a.metrics.conc.max)}%)`],
  ['集中度斜率', c => `${r2(c.a.metrics.conc.slope)} pp/期`],
  ['平均留存', c => `${r2(c.a.metrics.avgRetained)}/10`],
  ['平均新进', c => `${r2(c.a.metrics.avgAdded)} 只/期`],
  ['平均 Jaccard', c => r2(c.a.metrics.avgJaccard)],
  ['主题切换次数', c => c.a.metrics.theme.known ? c.a.metrics.theme.switches : '未归类'],
  ['主题链', c => c.a.metrics.theme.known ? c.a.metrics.theme.runs.map(x => `${x.theme}(${x.len})`).join(' → ') : '未归类'],
  ['第一大重仓均值', c => `${r2(c.a.metrics.leader.avg)}%`],
  ['个股总数', c => c.a.metrics.totalDistinct],
  ['最长连续在榜', c => `${c.a.metrics.maxStreak} 期`],
  ['绩效层', c => c.a.perf ? `区间 ${c.a.perf.cumReturn}% / 剔除最好一季 ${c.a.perf.exBestQuarter}% / 回撤 ${c.a.perf.maxDrawdown}%` : '未提供净值, 不判定'],
  ['结论层级', c => c.a.level],
  ['质检结论', c => c.ck.summary.verdictText]
];
for (const [k, fn] of rows) L.push('| ' + k + ' | ' + cards.map(c => fn(c)).join(' | ') + ' |');
L.push('');
L.push('## 为什么要做这张对比表');
L.push('');
L.push('它回答的是"这套方法能不能复制"这个问题: 同一个引擎、同一套规则、同一份模板, 换一只基金就能产出一张字段完全对齐的结论卡。');
L.push('两份卡之间唯一变化的是数值与形态标签, **字段、口径、证据分级规则全部一致** —— 这才叫"可比", 而不是两个人各写一份风格迥异的报告。');
L.push('');
L.push('## 边界声明');
L.push('');
L.push('两份结论卡都只基于公开季报的前十大持仓(期末快照); 推算价未复权、不含分红;');
L.push('002910 样例未附净值序列, 因此不产出任何绩效结论(引擎已自动降级并在报告中显式声明)。');
L.push('全部为回溯复盘, 不含对未来收益的判断, 不构成投资建议。');
fs.writeFileSync(path.join(OUT, '结论卡对比.md'), L.join('\n'), 'utf8');
console.log('  写出 ' + '结论卡对比.md');
console.log('\n全部交付物已生成到 00_交作业\\');
