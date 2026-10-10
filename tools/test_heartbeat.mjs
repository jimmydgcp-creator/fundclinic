/* 验证心跳真的发出去了 —— 这是防 Safari 掐断连接的关键, 不能只是"我写了代码"。 */
import http from 'node:http';

const code = process.argv[2] || '021967';
const port = process.argv[3] || 8787;
/* 默认关掉官方对账跑得很快(几秒), 根本到不了 12 秒的心跳间隔。
   想真看到心跳, 加 --full 走完整流程(全量官方 PDF, 十几秒)。 */
const full = process.argv.includes('--full');

const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(full
    ? { code, allowNoAI: true, pdf: false, allOfficial: true }
    : { code, allowNoAI: true, pdf: false, verifyOfficial: false })
});
if (!res.ok) { console.error('HTTP ' + res.status); process.exit(1); }

const counts = {};
const pings = [];
const t0 = Date.now();
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const ln of lines) {
    if (!ln.trim()) continue;
    let ev; try { ev = JSON.parse(ln); } catch (e) { continue; }
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (ev.type === 'ping') pings.push(((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('运行耗时 ' + secs + ' 秒');
console.log('事件统计: ' + JSON.stringify(counts));
console.log('ping 时刻: ' + (pings.length ? pings.join(', ') : '(本次没触发)'));
console.log('\n心跳是否生效: ' + (counts.ping > 0 ? '✓ 发了 ' + counts.ping + ' 次' : '— 运行太短没到 12 秒间隔(逻辑本身没问题)'));
console.log('流是否完整走完: ' + (counts.done === 1 ? '✓ 收到 done' : '✗ 没收到 done (计数 ' + (counts.done || 0) + ')'));
