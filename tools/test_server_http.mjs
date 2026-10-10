/* 最终端到端验证: 走真实 HTTP 接口(POST /api/run), 假大模型冒充 DeepSeek。
 * 这条路径 = 用户在网页上填代码 + Key 点"开始复盘"之后真正发生的事。
 * 验证点: NDJSON 流 → T6 出稿 → 落盘 → /api/download?f=deckT6 能下载 → /deck/<code> 能预览。
 * 用法: node tools/test_server_http.mjs [基金代码] [服务端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '021967';
const port = Number(process.argv[3] || 8787);

/* ---------- 假 DeepSeek ---------- */
const STORY = {
  deckTitle: 'HTTP 端到端测试稿', theme: 'corporate-clean',
  slides: [
    { kicker: '基金经理回溯复盘', layout: 'cover', title: '封面', ask: '封面', sourceHeading: '(开头)', notes: '这是封面页的讲者备注, 用于验证 notes 通道在真实 HTTP 路径下也能落地。' },
    { kicker: '01 · 先说结论', layout: 'kpi-grid', title: '一句话结论', ask: '主判断', sourceHeading: '三、总成绩也看清代价', notes: '先亮最抓人的数字, 再自己拆掉它, 这是全场最重要的一次转折, 讲慢一点。' },
    { kicker: '02 · 结论与跟踪', layout: 'todo-checklist', title: '怎么证伪', ask: '下一步', sourceHeading: '十、跟踪清单与证伪方式', notes: '收尾只给可观察的落点, 不做预测, 让听众知道下次怎么复核。' }
  ]
};
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; });
  req.on('end', () => {
    const p = JSON.parse(b || '{}');
    const u = (p.messages && p.messages[1] && p.messages[1].content) || '';
    let content = '{}';
    if (/每页 sourceHeading/.test(u)) content = JSON.stringify(STORY);
    else if (/演示稿的第/.test(u)) {
      const k = (/kicker:\s*(.+)/.exec(u) || [, '0N'])[1].trim();
      const t = (/- 主张\(标题\):\s*(.+)/.exec(u) || [, '标题'])[1].trim();
      content = `<section class="slide" data-title="t">
  <p class="kicker" data-anim="fade-down">${k}</p>
  <h2 class="h2c">${t}</h2>
  <div class="concl" data-anim="fade-up">HTTP 路径验证用正文, 含 <b>加粗判断</b>、<span class="up">正收益</span>、<span class="dn">回撤</span>。</div>
  <div class="grid g2 mt-m">
    <div class="card"><h4 style="font-size:19px">证据一</h4><p class="sec-note" style="font-size:14px"><b>披露事实:</b>来自官方季报。</p></div>
    <div class="card"><h4 style="font-size:19px">证据二</h4><p class="sec-note" style="font-size:14px"><b>合理推断:</b>由披露值推算。</p></div>
  </div>
  <p class="sec-note mt-m"><b>口径:</b>只用官方定期报告披露值; 本页内容基于公开季报/年报数据的回溯分析, 不构成投资建议。</p>
  <div class="notes">HTTP 路径下的讲者备注, 与页面文字不重复。</div>
</section>`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;
console.log('假 DeepSeek 在 127.0.0.1:' + mockPort + ' · 复诊台在 127.0.0.1:' + port);

/* ---------- 健康检查 ---------- */
const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
console.log('\n[1] 服务健康: ok=' + health.ok + ' staleCode=' + health.staleCode + ' version=' + health.version);
if (health.staleCode) { console.error('!! 服务在跑旧代码, 先重启再测'); process.exit(1); }

/* ---------- POST /api/run, 读 NDJSON ---------- */
console.log('\n[2] POST /api/run (NDJSON 流)');
const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, ai: { apiKey: 'mock', baseUrl: `http://127.0.0.1:${mockPort}`, model: 'mock' }, pdf: true })
});
if (!res.ok) { console.error('  HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300)); process.exit(1); }

let done = null, steps = [];
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
while (true) {
  const { value, done: fin } = await reader.read();
  if (fin) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const ln of lines) {
    if (!ln.trim()) continue;
    let ev; try { ev = JSON.parse(ln); } catch (e) { continue; }
    if (ev.type === 'step') { steps.push(ev); console.log('    · ' + (ev.name || '') + ' — ' + String(ev.detail || '').slice(0, 78)); }
    else if (ev.type === 'done') done = ev;
    else if (ev.type === 'error') { console.error('    错误: ' + ev.error); }
  }
}
if (!done) { console.error('  未收到 done 事件'); process.exit(1); }

/* ---------- 结果断言 ---------- */
const s = done.summary;
console.log('\n[3] 结果断言');
const chk = (label, cond, extra) => console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (extra !== undefined ? '  ' + extra : ''));
chk('T6 字段已下发', !!s.deckT6);
chk('T6 出稿成功', s.deckT6 && s.deckT6.ok, s.deckT6 ? (s.deckT6.pages + ' 页 / ' + s.deckT6.theme) : '');
chk('T6 质检通过', s.deckT6 && s.deckT6.check && s.deckT6.check.ok, s.deckT6 && s.deckT6.check ? ('警告 ' + s.deckT6.check.warns) : '');
chk('files.deckT6 在 summary 里', !!(s.files && s.files.deckT6), s.files && s.files.deckT6 ? (Math.round(s.files.deckT6.bytes / 1024) + ' KB') : '');
chk('官方窗口校准通过', !!(done.datasetMeta && done.datasetMeta.perfCalibration), done.datasetMeta && done.datasetMeta.perfCalibration ? JSON.stringify(done.datasetMeta.perfCalibration).slice(0, 90) : '');

/* ---------- 下载与预览 ---------- */
console.log('\n[4] 下载 / 预览接口');
const dl = await fetch(`http://127.0.0.1:${port}/api/download?code=${code}&f=deckT6`);
const cd = dl.headers.get('content-disposition') || '';
const body = await dl.text();
chk('下载 deckT6', dl.ok, 'HTTP ' + dl.status + ' · ' + Math.round(body.length / 1024) + ' KB');
chk('带 attachment 头(不会变成导航)', /attachment/.test(cd), cd.slice(0, 80));
chk('下载内容是单文件演示稿', /data-theme=/.test(body) && /class="slide"/.test(body));
chk('无外部资源引用', !/<(?:link|script|img)[^>]*(?:href|src)="(?!data:|#)/.test(body));

const pv = await fetch(`http://127.0.0.1:${port}/deck/${code}`);
const pvBody = await pv.text();
chk('/deck/ 预览默认给深度版', pv.ok && /HTTP 端到端测试稿/.test(pvBody), 'HTTP ' + pv.status);
const old = await fetch(`http://127.0.0.1:${port}/deck/${code}?v=old`);
const oldBody = await old.text();
chk('/deck/?v=old 给模板版', old.ok && !/HTTP 端到端测试稿/.test(oldBody), 'HTTP ' + old.status);

/* ---------- 落盘核对 ---------- */
console.log('\n[5] 落盘核对');
const dir = path.join(ROOT, '_runs', code);
for (const f of fs.readdirSync(dir).sort()) {
  const st = fs.statSync(path.join(dir, f));
  console.log('    ' + f.padEnd(52) + String(Math.round(st.size / 1024)).padStart(5) + ' KB');
}
const runJson = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
chk('run.json 带 deckT6', !!(runJson.files && runJson.files.deckT6));
chk('run.json summary 带 deckT6', !!(runJson.summary && runJson.summary.deckT6));

mock.close();
console.log('\n完成。');
