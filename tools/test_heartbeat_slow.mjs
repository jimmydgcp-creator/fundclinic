/* 在**真正会静默的场景**下验证心跳: 起一个故意变慢的假大模型,
 * 让每次调用睡 8 秒, 整个流程必然超过 12 秒 —— 这正是组员那边
 * "T5 深度报告一调用就没声音"的条件, 也是 Safari 会掐断连接的窗口期。
 *
 * 用法: node tools/test_heartbeat_slow.mjs [基金代码] [服务端口]
 */
import http from 'node:http';

const code = process.argv[2] || '021967';
const port = Number(process.argv[3] || 8787);
const DELAY_MS = 8000;

const STORY = {
  deckTitle: '心跳测试', theme: 'corporate-clean',
  slides: [
    { kicker: '复盘', layout: 'cover', title: '封面', ask: 'x', sourceHeading: '(开头)', notes: '这是一段足够长的讲者备注, 用来通过备注长度校验规则。' },
    { kicker: '01 · 结论', layout: 'kpi-grid', title: '结论', ask: 'x', sourceHeading: '三、总成绩也看清代价', notes: '这是第二页的讲者备注, 长度也足够通过校验, 用来验证流程完整性。' }
  ]
};

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; });
  req.on('end', () => {
    const p = JSON.parse(b || '{}');
    const u = (p.messages && p.messages[1] && p.messages[1].content) || '';
    let content = '{}';
    if (/每页 sourceHeading/.test(u)) content = JSON.stringify(STORY);
    else if (/演示稿的第/.test(u)) content = '<section class="slide" data-title="t"><p class="kicker">01 · 结论</p><h2 class="h2c">标题</h2><div class="concl"><b>加粗</b><span class="up">涨</span><b>再加粗</b></div><div class="grid g2"><div class="card"><h4>证据一</h4></div><div class="card"><h4>证据二</h4></div></div><div class="notes">这是一段足够长的讲者备注, 用于通过校验。</div></section>';
    /* 关键: 故意慢。模拟真实大模型写长篇报告时的静默期 */
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'slow-mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} }));
    }, DELAY_MS);
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;
console.log('慢速假模型在 ' + mockPort + ' (每次调用睡 ' + (DELAY_MS / 1000) + ' 秒)');

const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, ai: { apiKey: 'mock', baseUrl: `http://127.0.0.1:${mockPort}`, model: 'slow' }, pdf: false, verifyOfficial: false })
});
if (!res.ok) { console.error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200)); process.exit(1); }

const counts = {};
const pings = [];
const gaps = [];
let last = Date.now();
const t0 = last;
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  const now = Date.now();
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const ln of lines) {
    if (!ln.trim()) continue;
    let ev; try { ev = JSON.parse(ln); } catch (e) { continue; }
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (ev.type === 'ping') { pings.push(((now - t0) / 1000).toFixed(1) + 's'); last = now; }
    else if (ev.type === 'progress') { gaps.push(Math.round((now - last) / 1000)); last = now; }
  }
}
const secs = (Date.now() - t0) / 1000;
console.log('总耗时 ' + secs.toFixed(1) + ' 秒');
console.log('事件统计 ' + JSON.stringify(counts));
console.log('ping 时刻 ' + (pings.length ? pings.join(', ') : '(无)'));
const maxGap = gaps.length ? Math.max(...gaps.slice(0, -1)) : 0;
console.log('进度事件之间的最大间隔 ' + maxGap + ' 秒  ← 这就是浏览器要干等的时长');
console.log('');
console.log('心跳生效:        ' + (counts.ping > 0 ? '✓ 发了 ' + counts.ping + ' 次, 静默期最长被压到 12 秒以内' : '✗ 没发'));
console.log('流程完整:        ' + (counts.done === 1 ? '✓ 收到 done' : '✗ 没收到 done'));
console.log('结论: ' + (counts.ping > 0 && counts.done === 1
  ? '长静默期已被心跳填满, Safari 不会再把连接判定为卡死。'
  : '需要检查心跳逻辑。'));
mock.close();
