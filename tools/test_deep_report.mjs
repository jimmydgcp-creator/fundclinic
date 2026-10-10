/* 端到端验证 T5 深度报告链路 —— 不需要真 Key。
 *
 * 做法: 起一个本地假的大模型接口(OpenAI 兼容), 让它**读证据包后按骨架回一份报告**。
 * 这样能验证真正会出问题的地方: 提示词组装 / 白名单传递 / 数字回查 / 骨架校验 / 落盘命名。
 * 真 Key 跑的时候走的完全是同一条代码路径, 只是换成真模型来写。
 *
 * 用法: node tools/test_deep_report.mjs [基金代码]
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '519191';

/* ---------- 假模型: 从提示词里抠出证据包, 按 10 节骨架"写"一份报告 ---------- */
/* 注意: 一条流水线会调很多次大模型(T1…T6), 这个 mock 每个请求都会执行。
   如果只写 `sawPrompt = prompt`, 最后留在手上的很可能是**别的任务的提示词** —— T6 逐页写演示稿的
   提示词里当然没有"固定骨架", 于是"提示词含骨架与硬规则"这条断言会假失败(2026-10-10 修)。
   所以只认带特征串的那一份(T5 深度报告的提示词里有 '## 固定骨架')。 */
let sawPrompt = null;
let promptCount = 0;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let prompt = '';
    try { prompt = JSON.parse(body).messages.slice(-1)[0].content; } catch (e) {}
    promptCount++;
    if (/##\s*固定骨架/.test(prompt)) sawPrompt = prompt;

    // 从提示词里截出证据包 JSON
    const i = prompt.indexOf('## 证据包(唯一事实来源)');
    const j = prompt.indexOf('\n\n输出 JSON:');
    let ev = null;
    try { ev = JSON.parse(prompt.slice(i + '## 证据包(唯一事实来源)'.length, j).trim()); } catch (e) {}

    let md = '# 测试报告\n\n(证据包解析失败)';
    if (ev) {
      const P = ev.period, A = ev.annual, Q = ev.quarterly, R = ev.reconciliation;
      const annRows = A.map(a => `| ${a.year} | ${a.nav}% | ${a.bench}% | ${a.excess}pp |`).join('\n');
      const qRows = Q.filter(q => q.nav !== null).map(q => `| ${q.period} | ${q.nav}% | ${q.bench}% | ${q.excess}pp | ${q.top10Sum}% |`).join('\n');
      const talkRows = ev.talkCheck.slice(0, 4).map(t => `- ${t.period}: "${String(t.said).slice(0, 40)}…" → 下期新进 ${t.nextAdded.join('、') || '无'}；退出 ${t.nextDropped.join('、') || '无'}`).join('\n');
      const w = ev.cases.wins.slice(0, 2).map(c => `- ${c.name}: ${c.entryPeriod} 推算价 ${c.entryPrice} → ${c.exitPeriod} ${c.exitPrice}, 持有期 ${c.change}%`).join('\n');
      const f = ev.cases.fails.slice(0, 2).map(c => `- ${c.name}: ${c.entryPeriod} 推算价 ${c.entryPrice} → ${c.exitPeriod} ${c.exitPrice}, 持有期 ${c.change}%`).join('\n');
      const ph = ev.phases.map(p => `| ${p.from}–${p.to} | ${p.theme} | ${p.len} 期 | ${p.navChained}% | ${p.top10SumRange.join('–')}% |`).join('\n');
      const last = Q[Q.length - 1];

      md = `# ${ev.meta.manager}_${ev.meta.name}_${ev.meta.range}_复盘

> 数据截止日: ${ev.meta.dataCutoff} · 复盘区间: ${ev.meta.range}(${ev.meta.quarters} 个报告期)
> 本文为基于公开季报的回溯分析, 不构成投资建议; 过往业绩不代表未来收益。

## 一、先说结论

**核心判断(可证伪)**: ${P.nav}% 的区间收益中, 最大单季(${P.bestQuarter}, ${P.bestQuarterReturn}%)贡献了 ${P.bestQuarterContribution}%; 剔除该季后期间收益降至 ${P.exBestQuarter}%。

**支撑**:
1. 区间基金 ${P.nav}%(分红再投口径)、最大回撤 ${P.maxDrawdown}%。
2. 官方逐季链式口径 ${P.navChainedOfficial}%(因 ${(P.chainedMissingPeriods || []).join('、') || '—'} 报告缺失而偏低), 与头条口径差 ${P.chainedGapPp}pp。

**最大反证**: 若将逆风年份的持续跑输判为能力问题而非风格逆风, 则上述判断需推翻。

## 二、口径与证据边界

- 基金与经理: ${ev.meta.name}(${ev.meta.code}), ${ev.meta.manager}。
- 复盘区间: ${ev.meta.range}, 共 ${ev.meta.quarters} 期。区间依据: ${ev.meta.rangeBasis || '—'}。
- 业绩比较基准: ${ev.meta.benchmark || '—'}。
- 收益口径: ${P.method}。
- 持仓口径: 只看前十大(季报披露口径), 期末快照。
- 措辞禁区: "新进前十大"不等于"刚买入"; "退出前十大"不等于"清仓"。

## 三、绩效总览

**年度(官方披露值)**

| 年度 | 基金 | 基准 | 超额 |
|---|---|---|---|
${annRows}

**逐季**

| 报告期 | 基金 | 基准 | 超额 | 前十合计 |
|---|---|---|---|---|
${qRows}

## 四、持仓结构演变

| 阶段 | 主题 | 长度 | 区间收益 | 前十合计 |
|---|---|---|---|---|
${ph || '| — | — | — | — | — |'}

## 五、方法论拆解

**知行是否合一**(季报原文 × 下一期实际动作):

${talkRows}

## 六、关键调仓案例审计

**表现靠前**

${w}

**表现靠后**

${f}

## 七、最新一期结构与变化

${last.period} 前十合计 ${last.top10Sum}%, 主导主题 ${last.theme}。

## 八、优势与局限

**值得学习的部分**: 持仓与季报表述相互印证, 留存 ${ev.holdings[ev.holdings.length - 1].retained}/10。

**不能被过度解读的部分**: 单季贡献达 ${P.bestQuarterContribution}%, 复利能力存疑; 只看前十大, 完整风险敞口不可见。
## 九、结论与跟踪

核心判断的证伪落点: 下一期前十留存、集中度是否回到 ${ev.holdings[0].top10Sum}% 以上、规模是否继续下降。

## 十、附录

**逐季前十大**

${Q.filter(q => q.top10 && q.top10.length).map(q => `- ${q.period}: ` + q.top10.map(h => h.name + h.weight + '%').join('、')).join('\n')}

**数据来源与对账**

${R.note}。来源共 ${ev.sources.length} 条, 含官方定期报告 PDF(逐份 URL 见来源清单)。
`;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: 'mock-deepseek',
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ markdown: md }) } }],
      usage: { prompt_tokens: prompt.length, completion_tokens: md.length }
    }));
  });
});

/* 端口被占就换一个, 免得因为环境问题误判成链路故障 */
let port = 8899;
for (let i = 0; i < 20; i++) {
  try {
    await new Promise((res, rej) => {
      const onErr = e => { mock.off('listening', onOk); rej(e); };
      const onOk = () => { mock.off('error', onErr); res(); };
      mock.once('error', onErr); mock.once('listening', onOk);
      mock.listen(port + i, '127.0.0.1');
    });
    port = port + i;
    break;
  } catch (e) { if (i === 19) throw e; }
}
console.log('假模型已起在 http://127.0.0.1:' + port + '(仅用于验证链路, 不是真模型)\n');

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

try {
  const { runPipeline } = await import('../server/pipeline.mjs');
  const t0 = Date.now();
  const r = await runPipeline(code, {
    pdf: false, cleanReport: false,
    ai: { enabled: true, baseUrl: 'http://127.0.0.1:' + port, model: 'mock-deepseek', apiKey: 'sk-mock-local-not-a-real-key' },
    onProgress: m => { if (/深度|证据包|全量|采集完成/.test(m)) console.log('  · ' + m); }
  });

  console.log('\n=== 结果 ===');
  const evNum = (r.summary.deepEvidence && r.summary.deepEvidence.nav) || 76.8;
  const deep = r.summary.aiLog.find(x => /T5|深度/.test(x.task));
  ok(!!deep, 'T5 被调用', deep ? deep.task : '未调用');
  ok(!!r.files.deep, '深度报告已落盘');
  if (r.files.deep) {
    const mdPath = r.files.deep.path || r.files.deep;
    const md = fs.readFileSync(mdPath, 'utf8');
    console.log('  文件: ' + path.basename(mdPath) + '  ' + (md.length / 1024).toFixed(1) + ' KB');
    ok(/^[^_]+_[^_]+_[^_]+_复盘\.md$/.test(path.basename(mdPath)), '文件名符合「经理_基金简称_区间_复盘.md」', path.basename(mdPath));
    for (const sec of ['先说结论', '口径与证据边界', '绩效总览', '持仓结构演变', '方法论拆解', '关键调仓案例审计', '最新一期结构与变化', '优势与局限', '结论与跟踪', '附录']) {
      ok(md.includes(sec), '含「' + sec + '」');
    }
    ok(md.includes('2022') && md.includes('43.65'), '年度超额表带入官方值(2022 +43.65%)');
    ok(/53\.13/.test(md), '年度超额(2022 +53.13pp)在场');
    ok(md.includes(String(evNum)), '区间收益头条口径(' + evNum + '%)在场, 且不是被低估的链式值');
    ok(md.includes('22/22') || md.includes('220 行'), '对账记录在场');
    ok(!/\b68\.53\b/.test(md), '没有误用"官方逐季链式"的低估值(68.53%)当头条');
  }
  const ev = r.summary.aiLog.find(x => /T5|深度/.test(x.task));
  if (ev && ev.issues) {
    ev.issues.forEach(i => console.log('     [' + i.level + '] ' + i.msg));
  }
  ok(sawPrompt && sawPrompt.length > 3000, '提示词确实带了证据包', sawPrompt ? (sawPrompt.length / 1024).toFixed(1) + ' KB (' + promptCount + ' 次调用)' : '');
  ok(sawPrompt && sawPrompt.includes('固定骨架') && sawPrompt.includes('一个数字都不许编'), '提示词含骨架与硬规则');
  console.log('  用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
} catch (e) {
  fail++;
  console.log('  FAIL  管道异常: ' + e.message);
  console.log(String(e.stack || '').split('\n').slice(1, 4).join('\n'));
} finally {
  mock.close();
}

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过 —— 深度报告链路可用; 换成真 Key 走的是同一条代码路径。');
if (fail) process.exitCode = 1;
