/* 自检: 在 Node 里跑通 引擎 / 解析 / 质检 / AI 校验 四层, 断言关键数字与关键行为。
 * 用法: node tools/selftest.mjs
 * 说明: 只加载不依赖 DOM 的四个模块, 用 vm 造一个最小 window。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const sandbox = { console, window: {}, fetch: () => Promise.reject(new Error('no network in selftest')) };
vm.createContext(sandbox);

for (const f of ['data/funds.data.js', 'app/engine.js', 'app/parse.js', 'app/checker.js', 'app/ai.js']) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

const FC = sandbox.window.FC;
let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (extra ? ' -> ' + extra : '')); console.log('  FAIL  ' + label + (extra ? ' -> ' + extra : '')); }
}
function eq(a, b, label) { ok(Math.abs(Number(a) - Number(b)) < 0.011, label, `got ${a}, want ${b}`); }

console.log('\n=== 1. 内置样例载入 ===');
const funds = FC.builtinFunds();
ok(funds.length === 2, '两只内置样例', JSON.stringify(funds.map(f => f.code)));
const raw = FC.getBuiltin('519191');
ok(!!raw, '取到 519191');
ok(raw.quarters.length === 23, '519191 共 23 个报告期', String(raw.quarters.length));
ok(raw.quarters[0].period === '2020Q4' && raw.quarters[22].period === '2026Q2', '区间 2020Q4–2026Q2', raw.quarters[0].period + '–' + raw.quarters[22].period);

console.log('\n=== 2. 引擎: 519191 ===');
const a = FC.analyze(JSON.parse(JSON.stringify(raw)), { source: 'builtin' });
ok(!a.error, '分析无错误', a.error);
ok(a.quarterCount === 23, '期数 23');
eq(a.quarters[22].top10[0].weight, 7.52, '2026Q2 第一大重仓权重 7.52%');
ok(a.quarters[22].top10[0].name === '潞安环能', '2026Q2 第一大重仓=潞安环能', a.quarters[22].top10[0].name);
ok(a.metrics.churn.length === 22, '换手序列 22 条(23 期相邻对)');
ok(a.metrics.conc.avg > 60 && a.metrics.conc.avg < 90, '前十合计均值落在合理区间', a.metrics.conc.avg);
ok(a.metrics.avgRetained > 5 && a.metrics.avgRetained <= 10, '平均留存合理', a.metrics.avgRetained);
ok(a.metrics.totalDistinct > 10, '个股份额集合非空', String(a.metrics.totalDistinct));
ok(!!a.form.tag && a.form.reasons.length > 0, '形态标签 + 理由齐备', a.form.tag);
ok(a.cases.wins.length > 5, '案例审计有样本', String(a.cases.wins.length));
ok(a.cases.wins[0].change >= a.cases.wins[a.cases.wins.length - 1].change, '案例按变动降序');
ok(a.report.sections.length === 10 || a.report.sections.length === 11, '报告 10 节必需(第九节由大模型生成时变 11 节)', String(a.report.sections.length));
const baseOrder = a.report.sections.map(s => s.id).filter(id => id !== 'strength').join(',');
ok(baseOrder === 'conclusion,scope,performance,conc,rotation,method,cases,latest,track,appendix', '章节顺序符合固定骨架', baseOrder);
ok(a.trackers.length >= 5, '跟踪清单 >=5 条', String(a.trackers.length));
ok(a.card.falsifier.length > 30, '推翻条件非空且具体');
ok(a.level.indexOf('绩效层') >= 0, '含绩效层', a.level);
ok(a.perf && a.perf.concentratedInOneQuarter === true, '识别出收益高度集中于单一季度(2022Q1)', JSON.stringify(a.perf && a.perf.bestQuarterContribution));

console.log('\n=== 3. 引擎: 002910(仅结构层, 应自动降级) ===');
const b = FC.analyze(JSON.parse(JSON.stringify(FC.getBuiltin('002910'))), { source: 'builtin' });
ok(!b.error, '分析无错误');
ok(b.quarterCount === 18, '期数 18', String(b.quarterCount));
ok(b.perf === null, '无绩效层');
const perfSec = b.report.sections.find(s => s.id === 'performance');
ok(perfSec.html.indexOf('不判定绩效形态') >= 0, '第三节显式声明不判定绩效形态(降级而非硬编)');
ok(b.form.tag.length > 0, '仍给出结构层形态标签', b.form.tag);

console.log('\n=== 4. 质检: 519191 ===');
const ck = FC.runCheck(JSON.parse(JSON.stringify(raw)), a);
ok(ck.rules.length >= 15, '规则数 >=15', String(ck.rules.length));
ok(ck.summary.fail === 0, '无阻断项', ck.rules.filter(r => r.level === 'fail').map(r => r.id + ':' + r.detail.slice(0, 60)).join(' | '));
ok(ck.manualSample.length === 12, '人工抽检 12 处', String(ck.manualSample.length));
const ck2 = FC.runCheck(JSON.parse(JSON.stringify(raw)), FC.analyze(JSON.parse(JSON.stringify(raw)), { source: 'builtin' }));
ok(JSON.stringify(ck2.manualSample) === JSON.stringify(ck.manualSample), '抽检清单可复现(同输入同结果)');
const ruleB1 = ck.rules.find(r => r.id === 'B1');
ok(ruleB1.level === 'pass', 'B1 前十合计独立复算通过', ruleB1.detail.slice(0, 90));
const ruleA1 = ck.rules.find(r => r.id === 'A1');
ok(ruleA1.level === 'pass', 'A1 双十约束通过');
const ruleC4 = ck.rules.find(r => r.id === 'C4');
ok(ruleC4.level === 'pass', 'C4 违禁词 0 命中', ruleC4.detail.slice(0, 90));

console.log('\n=== 5. 质检: 人工注入错误, 必须被抓到 ===');
const broken = JSON.parse(JSON.stringify(raw));
broken.quarters[5].top10[0].weight = 13.7;                      // 超双十
broken.quarters[7].top10[1].code = '807';                       // 前导零丢失
broken.quarters[3].top10Sum = 1.23;                             // 与明细不一致
broken.quarters[9].top10[2].code = broken.quarters[9].top10[1].code; // 同期同代码重复
const brokenCheck = FC.runCheck(broken, FC.analyze(broken, { source: 'builtin' }));
const failIds = brokenCheck.rules.filter(r => r.level === 'fail').map(r => r.id);
ok(failIds.includes('A1'), '抓到超双十(A1)', failIds.join(','));
ok(failIds.includes('A4'), '抓到代码前导零丢失(A4)', failIds.join(','));
ok(failIds.includes('A5'), '抓到同期同代码重复(A5)', failIds.join(','));
ok(failIds.includes('B1'), '抓到汇总与明细不一致(B1)', failIds.join(','));
ok(brokenCheck.summary.verdict === 'fail', '总体结论=fail');

// A+H 两地上市: 同名不同码是两笔合法持仓, 不能被判成重复, 更不能被合并统计
const ah = JSON.parse(JSON.stringify(raw));
ah.quarters[4].top10[9] = { rank: 10, code: '03968', name: ah.quarters[4].top10[8].name, weight: 3.1, sharesWan: 100, valueWan: 1000 };
const ahCheck = FC.runCheck(ah, FC.analyze(ah, { source: 'builtin' }));
const a5 = ahCheck.rules.find(r => r.id === 'A5');
ok(a5.level === 'pass' && a5.detail.indexOf('A+H') >= 0, 'A+H 同名不同码被识别为合法持仓而非重复', a5.detail.slice(0, 110));
const ahA = FC.analyze(ah, { source: 'builtin' });
const sameName = {};
ahA.metrics.holders.forEach(h => { sameName[h.name] = (sameName[h.name] || 0) + 1; });
const merged = Object.keys(sameName).filter(n => sameName[n] > 1);
ok(merged.length >= 1, 'A+H 两只股票在持仓画像里仍是两个独立主体(未被名称合并)', '同名多主体: ' + JSON.stringify(merged));
const codes = ahA.metrics.holders.filter(h => h.name === merged[0]).map(h => h.code).sort();
ok(codes.length >= 2 && codes[0] !== codes[1], 'A+H 两个主体各自带自己的股票代码', JSON.stringify(codes));
ok(ahA.metrics.totalDistinct >= a.metrics.totalDistinct, '个股总数把 A+H 计为两只', ahA.metrics.totalDistinct + ' vs 原 ' + a.metrics.totalDistinct);

console.log('\n=== 6. 解析: 用户粘贴 ===');
const tpl = FC.pasteTemplate();
const r1 = FC.parsePaste(tpl, { code: 'TEST01', name: '测试基金' });
ok(r1.report.ok, '模板可被解析', JSON.stringify(r1.report.issues));
ok(r1.report.periodCount === 2, '解析出 2 个报告期', String(r1.report.periodCount));
ok(r1.dataset.quarters[0].top10[0].name === '潞安环能', '首行股名正确');
const r2 = FC.parsePaste('', {});
ok(!r2.report.ok, '空输入被拒');
const r3 = FC.parsePaste('随便写点什么\n没有表格', {});
ok(!r3.report.ok, '无表格文本被拒');
// 从 519191 反造一份粘贴文本, 走一遍真实解析
const fakeRows = ['报告期\t排名\t股票代码\t股票名称\t占净值(%)\t持股数(万股)\t持仓市值(万元)\t主题'];
raw.quarters.forEach(q => (q.top10 || []).forEach(h => {
  fakeRows.push([q.period, h.rank, h.code, h.name, h.weight, h.sharesWan, h.valueWan, q.theme].join('\t'));
}));
const r4 = FC.parsePaste(fakeRows.join('\n'), { code: '519191', name: '万家新利灵活配置混合' });
ok(r4.report.ok, '240 行真实数据可解析');
ok(r4.report.periodCount === 23, '解析回 23 期', String(r4.report.periodCount));
const a4 = FC.analyze(r4.dataset, { source: 'paste' });
eq(a4.metrics.conc.avg, a.metrics.conc.avg, '粘贴路径与内置路径的集中度均值一致(往返一致)');
eq(a4.quarters[22].top10[0].weight, 7.52, '粘贴路径末期权重一致');
ok(a4.level.indexOf('仅结构层') >= 0, '粘贴路径无净值 -> 仅结构层', a4.level);

console.log('\n=== 7. AI 模块: 提示词 / 校验 / 拦截 ===');
const payload = FC.ai.buildPayload('theme_classify', a);
ok(payload.stockList.length === a.metrics.totalDistinct, '主题归类输入=去重个股清单', String(payload.stockList.length));
const prompt = FC.ai.buildPrompt('theme_classify', payload);
ok(prompt.indexOf('禁止使用以下表述') >= 0, '提示词含用词红线');
ok(prompt.indexOf('严格输出 JSON') >= 0, '提示词含输出约束');
const pj = FC.ai.buildPayload('judgement', a);
ok(!!pj.metrics['前十合计权重_均值'], '判断任务输入含指标包');
ok(FC.ai.buildPrompt('judgement', pj).indexOf('未归类形态') >= 0, '判断任务提示词含形态库(含兜底条款)');

// 7a 正常输出 -> 通过
const good = { mapping: {} };
payload.stockList.forEach(s => { good.mapping[s.name] = '煤炭'; });
const v1 = FC.ai.validate('theme_classify', good, { stockList: payload.stockList });
ok(v1.ok, '主题归类: 全覆盖输出通过', JSON.stringify(v1.issues));

// 7b 覆盖率不足 -> 拦截
const v2 = FC.ai.validate('theme_classify', { mapping: { 潞安环能: '煤炭' } }, { stockList: payload.stockList });
ok(!v2.ok, '主题归类: 覆盖率不足被拦截');

// 7c 幻觉新增 -> 拦截
const halluc = { mapping: {} };
payload.stockList.forEach(s => { halluc.mapping[s.name] = '煤炭'; });
halluc.mapping['不存在的股票'] = '量子科技';
const v3 = FC.ai.validate('theme_classify', halluc, { stockList: payload.stockList });
ok(!v3.ok && v3.issues.some(i => i.msg.indexOf('幻觉') >= 0), '主题归类: 清单外股票被识别为幻觉并拦截');

// 7d 判断任务: 编造数字 -> 拦截
const allowed = {};
[m_avg(a), a.metrics.avgRetained].forEach(x => { if (x != null) allowed[x.toFixed(2)] = 1; });
const v4 = FC.ai.validate('judgement', { formTag: '主题坚守型', mainQuestion: '赛道判断是否可持续?', claim: '集中度均值 999.9%, 留存 3.3 只。', falsifier: '若下一期留存数未达到 5 只, 则本判断降级。' }, { formLibrary: ['主题坚守型'], allowedNumbers: allowed });
ok(!v4.ok && v4.issues.some(i => i.msg.indexOf('编造') >= 0), '判断任务: 编造数字被拦截');
function m_avg(x) { return x.metrics.conc.avg; }

// 7e 判断任务: 自创标签 -> 拦截
const v5 = FC.ai.validate('judgement', { formTag: '宇宙无敌型', mainQuestion: 'q', claim: 'c', falsifier: '若下一期留存数未达到 5 只, 则降级。' }, { formLibrary: ['主题坚守型'], allowedNumbers: allowed });
ok(!v5.ok && v5.issues.some(i => i.msg.indexOf('形态库') >= 0), '判断任务: 自创形态标签被拦截');

// 7f 判断任务: 违禁词 -> 拦截
const v6 = FC.ai.validate('judgement', { formTag: '主题坚守型', mainQuestion: 'q', claim: '这一波抄底非常精准预测。', falsifier: '若未达到则降级。' }, { formLibrary: ['主题坚守型'], allowedNumbers: allowed });
ok(!v6.ok && v6.issues.some(i => i.msg.indexOf('违禁词') >= 0), '判断任务: 违禁词被拦截');

// 7g 清洗任务: 洗没了 -> 拦截
const v7 = FC.ai.validate('polish', { cleaned: '短', replaced: [] }, { original: '很长的一段原文'.repeat(50) });
ok(!v7.ok, '清洗任务: 长度骤减被拦截');

// 7h JSON 抠取
ok(FC.ai.parseJSON('```json\n{"a":1}\n```').value.a === 1, 'JSON 抠取: 容忍代码块');
ok(FC.ai.parseJSON('前缀 {"a":2} 后缀').value.a === 2, 'JSON 抠取: 容忍前后缀');
ok(!FC.ai.parseJSON('完全不是 JSON').ok, 'JSON 抠取: 非 JSON 被判失败');

console.log('\n=== 8. 对外用词规范 ===');
ok(FC.scanVocab('这是一次马后炮复盘, 成功抄底').length === 2, '违禁词扫描命中 2 个');
ok(FC.cleanVocab('马后炮复盘: 抄底与逃顶').indexOf('马后炮') < 0, '清洗后不含原词', FC.cleanVocab('马后炮复盘: 抄底与逃顶'));
const allText = a.report.sections.map(s => s.html.replace(/<[^>]+>/g, ' ')).join(' ');
ok(FC.scanVocab(allText).length === 0, '519191 报告全文 0 违禁词');

console.log('\n=== 9. 导出物 ===');
const md = FC.checkToMarkdown(ck, a);
ok(md.indexOf('# 错误检查记录') === 0, '错误检查记录 MD 头部正确');
ok(md.indexOf('人工抽检清单') > 0 && md.split('\n').length > 30, 'MD 含抽检清单且篇幅足够', md.split('\n').length + ' 行');
const logMd = FC.ai.runLogToMarkdown(a);
ok(logMd.indexOf('# AI 模块运行记录') === 0, '运行记录 MD 头部正确');

console.log('\n=== 10. 边界 ===');
ok(!!FC.analyze({ quarters: [] }, {}).error, '空数据返回错误而非崩溃');
const oneQ = { fund: { code: 'X' }, quarters: [raw.quarters[0]] };
const oq = FC.analyze(JSON.parse(JSON.stringify(oneQ)), {});
ok(!oq.error && oq.form.tag.indexOf('样本不足') >= 0, '单期数据 -> 样本不足兜底', oq.form.tag);
const noTheme = JSON.parse(JSON.stringify(raw));
noTheme.quarters.forEach(q => { q.theme = ''; });
const nt = FC.analyze(noTheme, {});
ok(!nt.error && nt.metrics.theme.known === false, '无主题归类 -> 形态库跳过主题规则而不报错', nt.form.tag);

console.log('\n==================================================');
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('全部通过。');
