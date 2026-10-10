/* T6 端到端自测: 起一个假的 OpenAI 兼容服务当"大模型", 跑完整链路。
 * 为什么要假服务而不是直接 mock 函数: 这样连 HTTP 调用、JSON 模式开关、超时、错误分支
 * 都一起被验证到。本机没有真 Key, 这是唯一能自动验证 T6 的办法。
 *
 * 用法: node tools/test_deckagent.mjs [基金代码]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/pipeline.mjs';
import { authorDeck, validateDeck } from '../server/deckagent.mjs';

process.env.FUNDCLINIC_ALLOW_NO_AI = '1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '021967';

/* ---------------- 假大模型 ---------------- */
const STORY = {
  deckTitle: '董伟炜 × 西部利得均衡优选混合A 021967 · 回溯复盘 2025Q1–2026Q2',
  theme: 'corporate-clean',
  slides: [
    { kicker: '基金经理回溯复盘 · Fund Manager Review', layout: 'cover', title: '西部利得均衡优选混合A 021967 · 回溯复盘', ask: '封面', sourceHeading: '(开头)', notes: '开场交代这次复盘看什么、用什么口径、结论层级是什么。强调只看前十大。' },
    { kicker: '01 · 先说结论', layout: 'stat-highlight', title: '区间 +123.24%,但一半以上来自单个季度', ask: '这次复盘最重要的一句话是什么', sourceHeading: '三、总成绩也看清代价', notes: '这页是整场的锚点:先给最抓人的数字,再立刻自己拆掉它。' },
    { kicker: '02 · 绩效总览', layout: 'kpi-grid', title: '对照看,不挑好看的数字', ask: '成绩和代价分别是什么', sourceHeading: '三、总成绩也看清代价', notes: '讲这一页要慢,把回撤和集中度放在和收益并列的位置。' },
    { kicker: '03 · 持仓骨架', layout: 'table', title: '前十合计不到三成,是一只很散的组合', ask: '持仓结构长什么样', sourceHeading: '四、持仓集中度与骨架', notes: '用这张表说明它和高集中度基金不是一类东西。' },
    { kicker: '04 · 结论与跟踪', layout: 'todo-checklist', title: '怎么证伪这个判断', ask: '下一步看什么', sourceHeading: '十、跟踪清单与证伪方式', notes: '收尾:把可证伪的观察点讲清楚,不要给预测。' }
  ]
};

function mockSlide(i, kicker, title) {
  return `<section class="slide" data-title="测试页 ${i}">
  <p class="kicker" data-anim="fade-down">${kicker}</p>
  <h2 class="h2c">${title}</h2>
  <div class="concl" data-anim="fade-up">
    这是一段由假模型产生的结论正文, 用来验证版面骨架是否成立。它包含 <b>加粗判断</b>、
    <span class="up">上涨 123.24%</span>、<span class="dn">回撤 -12.48%</span> 这类标注,
    以及 <b class="pnum">30.79%</b> 这样的等宽数字。
  </div>
  <div class="grid g2 mt-m">
    <div class="card"><h4 style="font-size:19px">第一条证据</h4>
      <p class="sec-note" style="margin:8px 0 0;font-size:14px"><b>集中度:</b>前十合计均值 <b>30.79%</b>, 全期位于 26.11%–35.87% 区间。</p>
    </div>
    <div class="card" style="border-left:3px solid var(--warn)"><h4 style="font-size:19px">须警惕</h4>
      <p class="sec-note" style="margin:8px 0 0;font-size:14px"><b>证据级别:</b>本页数字为<b>合理推断</b>, 由披露值推算, 未复权。</p>
    </div>
  </div>
  <table class="tbl mt-m"><thead><tr><th>报告期</th><th class="num">前十合计</th></tr></thead>
    <tbody><tr><td>2025Q1</td><td class="num">26.11%</td></tr><tr><td>2026Q2</td><td class="num">35.87%</td></tr></tbody></table>
  <div class="notes">这是第 ${i} 页的讲者备注, 由假模型生成, 用于验证 notes 抽取与校验规则。</div>
</section>`;
}

let calls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    calls++;
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) { /* ignore */ }
    const wantsJson = !!(payload.response_format && payload.response_format.type === 'json_object');
    let content;
    if (wantsJson) {
      content = JSON.stringify(STORY);
    } else {
      // 从提示词里抠出 kicker / 标题, 让每一页内容真的不一样
      const kick = (/kicker:\s*(.+)/.exec(payload.messages?.[1]?.content || '') || [, '0N · 测试'])[1].trim();
      const title = (/- 主张\(标题\):\s*(.+)/.exec(payload.messages?.[1]?.content || '') || [, '测试标题'])[1].trim();
      content = '```html\n' + mockSlide(calls, kick, title) + '\n```';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock-deepseek', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log('假大模型已起在 127.0.0.1:' + port);

/* ---------------- 跑链路 ---------------- */
console.log('\n[1] 跑 pipeline 拿到真实报告(无需 Key)');
const r = await runPipeline(code, { pdf: false, allowNoAI: true });
console.log('    报告 ' + path.basename(r.files.report) + ' · ' + (r.reportMd.length / 1024).toFixed(1) + ' KB');

console.log('\n[2] 跑 T6 演示稿生成');
const deck = await authorDeck({
  llm: { apiKey: 'mock-key', baseUrl: `http://127.0.0.1:${port}`, model: 'mock-deepseek' },
  reportMd: r.reportMd,
  fund: r.summary,
  analysis: r.analysis,
  dataset: r.dataset,
  onProgress: m => console.log('    · ' + m)
});

console.log('\n[3] 结果');
console.log('    主题 ' + deck.theme + ' · ' + deck.slides.length + ' 页 · ' + (deck.html.length / 1024).toFixed(0) + ' KB · ' + deck.ms + 'ms');
console.log('    大模型调用 ' + deck.usage.calls + ' 次');
console.log('    校验 ' + (deck.check.ok ? '通过' : '失败 ' + deck.check.fails + ' 项') + ' (警告 ' + deck.check.warns + ')');
deck.check.issues.slice(0, 12).forEach(x => console.log('      [' + x.level + '] ' + x.msg));
deck.log.forEach(l => console.log('      · ' + l));

const out = path.join(ROOT, '_runs', code, `演示稿T6_${code}.html`);
fs.writeFileSync(out, deck.html, 'utf8');
console.log('\n[4] 落盘 ' + out + ' (' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB)');

/* ---------------- 独立复验落盘文件 ---------------- */
const saved = fs.readFileSync(out, 'utf8');
const slides = [...saved.matchAll(/<section[^>]*class="[^"]*\bslide\b[\s\S]*?<\/section>/g)].map(m => ({ html: m[0] }));
const recheck = validateDeck(saved, slides, null);
console.log('\n[5] 落盘文件独立复验: ' + (recheck.ok ? '通过' : '失败 ' + recheck.fails + ' 项'));
const probe = {
  '页数': slides.length,
  '含 <link> 外链': /<link[^>]*href="(?!data:)/.test(saved),
  '含 <script src>': /<script[^>]*src=/.test(saved),
  '内联主题数': (saved.match(/:root\[data-theme="/g) || []).length,
  'data-themes 可切换数': ((saved.match(/data-themes="([^"]*)"/) || [, ''])[1].split(',').filter(Boolean).length),
  '讲者备注数': (saved.match(/class="notes"/g) || []).length,
  '加粗 <b> 数': (saved.match(/<b[\s>]/g) || []).length,
  '表格数': (saved.match(/<table/g) || []).length,
  '含 runtime': /slide-number/.test(saved) && /data-themes/.test(saved),
  '打印规则': /@media print/.test(saved)
};
for (const [k, v] of Object.entries(probe)) console.log('    ' + k.padEnd(22) + v);

/* ---------------- 两个"内联之后才会暴露"的问题(2026-10-10 加) ----------------
   ① 主题串味: 36 套主题里有 116 条顶层规则不是 :root 开的(.card/.kicker/.slide/body…)。
      只限定 :root 的话它们会同时生效, 于是"选中的主题"只换了变量、没换骨架。
      这里用两个**只在主题文件里出现**的选择器当探针(.slide::before / .slide>* —— base.css 里没有),
      它们的每一次出现都必须带 [data-theme=...]; 再用作用域总数兜底。
   ② 打印丢内容: 技能的 animations.css 有 `.anim-stagger-list > *{opacity:0;animation:…both}`,
      基础态就不可见; 打印时动画不跑就永远不可见。判据: 打印块里必须有 opacity:1!important 复位。 */
const inlineCss = (saved.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const scopeCount = (inlineCss.match(/\[data-theme="/g) || []).length;
const canary = [...inlineCss.matchAll(/([^{}]*\.slide(?:::before|>|\s*>)[^{}]*)\{/g)].map(x => x[1].trim());
const nakedCanary = canary.filter(s => !s.includes('[data-theme='));
const scopeFloor = 140;   // 36 个 :root + 116 条非 :root 规则 ≈ 152
const printReset = /\.anim-stagger-list\s*>\s*\*[\s\S]{0,200}opacity:1!important/.test(inlineCss)
  || /\[class\*="anim-"\][^{]*\{[^}]*opacity:1!important/.test(inlineCss);
const report = [
  [`主题作用域数 ≥${scopeFloor}`, scopeCount >= scopeFloor ? 0 : 1, `实际 ${scopeCount} 处 [data-theme=`],
  ['主题探针选择器都已限定', nakedCanary.length, nakedCanary.slice(0, 2).join(' | ') || `${canary.length} 条探针全部带作用域`],
  ['打印复位(基础态不可见的动画)', printReset ? 0 : 1, printReset ? '已复位' : '缺 opacity:1!important 复位']
];
console.log('');
let bad = 0;
for (const [name, n, extra] of report) {
  if (n) bad++;
  console.log('    ' + (n ? '✗' : '✓') + ' ' + name.padEnd(22) + (extra || ''));
}
if (bad) { console.log('\n内联后暴露的问题 ' + bad + ' 项。'); process.exitCode = 1; }

server.close();
console.log('\n完成。');
