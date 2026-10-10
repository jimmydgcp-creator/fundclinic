/* 全链路自测: runPipeline 带"大模型"(假服务), 验证 T1/T2/T5/T6 在真实编排下的协同。
 * 假模型只对分镜请求返回合法 JSON, 其余任务返回空对象 —— 于是 T1/T2/T5 会校验失败被拦截,
 * 而 T6 需要能在"深度报告没出来"的情况下回退到引擎版报告继续出稿。这正是要验的韧性。
 * 用法: node tools/test_pipeline_deck.mjs [基金代码]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '021967';

const STORY = {
  deckTitle: '测试演示稿',
  theme: 'swiss-grid',
  slides: [
    { kicker: '基金经理回溯复盘', layout: 'cover', title: '封面页', ask: '封面', sourceHeading: '(开头)', notes: '开场备注, 说明本次复盘的范围与口径, 以及为什么只看前十大持仓。' },
    { kicker: '01 · 先说结论', layout: 'stat-highlight', title: '一句话结论', ask: '最重要的判断', sourceHeading: '三、总成绩也看清代价', notes: '先把最抓人的数字摆出来, 然后自己拆掉它, 这是全场最重要的转折。' },
    { kicker: '02 · 持仓骨架', layout: 'table', title: '结构长什么样', ask: '持仓结构', sourceHeading: '四、持仓集中度与骨架', notes: '用表格说明这只基金与高集中度基金不是一类东西, 注意集中度趋势这一列。' },
    { kicker: '03 · 结论与跟踪', layout: 'todo-checklist', title: '怎么证伪', ask: '下一步看什么', sourceHeading: '十、跟踪清单与证伪方式', notes: '收尾只讲可观察的落点, 不给预测, 让听众知道四个月后怎么复核。' }
  ]
};

function slideHtml(i, kicker, title) {
  return `<section class="slide" data-title="p${i}">
  <p class="kicker" data-anim="fade-down">${kicker}</p>
  <h2 class="h2c">${title}</h2>
  <div class="concl" data-anim="fade-up">正文含 <b>加粗判断</b>、<span class="up">上涨</span>、<span class="dn">回撤</span> 与 <b class="pnum">123.24%</b> 等标注。</div>
  <div class="grid g2 mt-m">
    <div class="card"><h4 style="font-size:19px">证据一</h4><p class="sec-note" style="font-size:14px"><b>说明:</b>由披露值推算。</p></div>
    <div class="card"><h4 style="font-size:19px">证据二</h4><p class="sec-note" style="font-size:14px"><b>说明:</b>期末快照口径。</p></div>
  </div>
  <div class="notes">第 ${i} 页讲者备注, 用于验证 notes 通道。</div>
</section>`;
}

let n = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    n++;
    const p = JSON.parse(body || '{}');
    const user = (p.messages && p.messages[1] && p.messages[1].content) || '';
    let content;
    if (/每页 sourceHeading/.test(user)) content = JSON.stringify(STORY);
    else if (/演示稿的第/.test(user)) {
      const kick = (/kicker:\s*(.+)/.exec(user) || [, '0N'])[1].trim();
      const title = (/- 主张\(标题\):\s*(.+)/.exec(user) || [, '标题'])[1].trim();
      content = slideHtml(n, kick, title);
    } else content = '{}';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log('假大模型 127.0.0.1:' + port);

console.log('\n=== 全链路 runPipeline(带 Key) ===');
const r = await runPipeline(code, {
  pdf: true,
  ai: { apiKey: 'mock', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' },
  allOfficial: false,
  onProgress: m => console.log('  · ' + m)
});

console.log('\n=== 产物清单 ===');
for (const [k, v] of Object.entries(r.files)) {
  console.log('  ' + k.padEnd(12) + path.basename(v) + '  ' + Math.round(fs.statSync(v).size / 1024) + ' KB');
}
if (r.pdf) console.log('  ' + 'pdf'.padEnd(12) + path.basename(r.pdf) + '  ' + Math.round(fs.statSync(r.pdf).size / 1024) + ' KB');

console.log('\n=== T6 摘要 ===');
console.log('  ' + JSON.stringify({ ok: r.summary.deckT6 && r.summary.deckT6.ok, pages: r.summary.deckT6 && r.summary.deckT6.pages, theme: r.summary.deckT6 && r.summary.deckT6.theme, calls: r.summary.deckT6 && r.summary.deckT6.calls, check: r.summary.deckT6 && r.summary.deckT6.check && { ok: r.summary.deckT6.check.ok, warns: r.summary.deckT6.check.warns } }));
console.log('  深度报告生成: ' + r.summary.deepReportGenerated + '  (预期 false —— 假模型不会写报告)');
console.log('  T6 是否仍出稿: ' + !!r.summary.deckT6 && r.summary.deckT6.ok + '  ← 必须为 true, 这是回退韧性');

console.log('\n=== AI 调用日志 ===');
(r.summary.aiLog || []).forEach(a => console.log('  ' + (a.ok ? '✓' : '✗') + ' ' + a.task + (a.error ? ' — ' + String(a.error).slice(0, 60) : '')));

server.close();
console.log('\n完成。');
