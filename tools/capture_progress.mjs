/* 抓一次真实流水线发出的**全部进度消息**, 用来给界面的步骤条定"该有哪几步"。
 *
 * 为什么先抓再写: 步骤条最怕的是"写死的 8 步里有 2 步永远不亮" —— 用户会以为卡住了。
 * 所以不猜, 直接把 pipeline 的 onProgress 全录下来, 看真实顺序。
 *
 * 用法: node tools/capture_progress.mjs [基金代码]
 * 注意: 会真的去爬公开数据源(约 10 秒)。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const code = process.argv[2] || '021967';

/* 假大模型: 只为了让 T1/T2/T3/T5/T6 都真的被调用一次(内容故意不合法, 走"拦截"分支也照样会发进度) */
const mock = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => { b += c; });
  req.on('end', () => {
    const p = JSON.parse(b || '{}');
    const u = (p.messages && p.messages[1] && p.messages[1].content) || '';
    let content = '{}';
    if (/每页 sourceHeading/.test(u)) {
      content = JSON.stringify({
        deckTitle: '进度抓取用稿', theme: 'corporate-clean',
        slides: [
          { kicker: '基金经理回溯复盘', layout: 'cover', title: '封面', ask: '封面', sourceHeading: '(开头)', notes: '封面页。' },
          { kicker: '01 · 先说结论', layout: 'kpi-grid', title: '结论', ask: '主判断', sourceHeading: '三、总成绩也看清代价', notes: '讲结论。' }
        ]
      });
    } else if (/演示稿的第/.test(u)) {
      content = '<section class="slide" data-title="t"><p class="kicker">K</p><h2 class="h2c">T</h2><div class="concl">正文</div><div class="notes">备注</div></section>';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;

const msgs = [];
console.log('开始跑 ' + code + ' ...\n');
const t0 = Date.now();
let result = null, err = null;
try {
  result = await runPipeline(code, {
    years: 10,
    fromPeriod: '', toPeriod: '',
    ai: { enabled: true, baseUrl: `http://127.0.0.1:${mockPort}`, model: 'mock', apiKey: 'sk-mock', tasks: {} },
    onProgress: m => { msgs.push({ t: Date.now() - t0, m }); }
  });
} catch (e) { err = e; }

mock.close();

console.log('=== 进度消息全序列（' + msgs.length + ' 条，' + ((Date.now() - t0) / 1000).toFixed(1) + 's）===\n');
for (const x of msgs) console.log(`  ${String(x.t).padStart(6)}ms  ${x.m}`);

console.log('\n=== 按前缀归并（这就是步骤条该有的粒度）===\n');
const seen = [];
for (const x of msgs) {
  const head = x.m.split(' · ')[0];
  const last = seen[seen.length - 1];
  if (!last || last.head !== head) seen.push({ head, first: x.t, n: 1 });
  else { last.n++; last.last = x.t; }
}
for (const s of seen) console.log(`  ${String(s.first).padStart(6)}ms  ${s.head}   (${s.n} 条${s.last ? '，持续到 ' + s.last + 'ms' : ''})`);

if (err) console.log('\n流水线报错: ' + err.message);
if (result && result.summary) console.log('\n完成: ' + result.summary.name + ' · ' + result.summary.range);
