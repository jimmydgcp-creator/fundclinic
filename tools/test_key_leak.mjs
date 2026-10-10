/* 密钥不落盘验证: 用一个**带标记的假 Key** 跑完整流程, 然后在整个项目里搜它。
 *
 * 为什么这样做: "我读代码觉得不会存"不算证据。用一个独一无二的串跑一遍,
 * 再去磁盘上找它 —— 找得到就是泄露, 找不到才叫没有。
 * 搜索范围: _runs/(所有落盘产物) + 项目根 + dist 包 + 服务端 stdout/stderr。
 *
 * 用法: node tools/test_key_leak.mjs [基金代码]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '021967';

/* 独一无二的标记, 保证不会和任何真实内容巧合撞上 */
const MARK = 'sk-LEAKCANARY' + Date.now().toString(36).toUpperCase() + 'ZZZ';

/* ---------- 假大模型(不校验 Key, 只回合法内容) ---------- */
const STORY = {
  deckTitle: 'F', theme: 'corporate-clean',
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
    else if (/演示稿的第/.test(u)) content = `<section class="slide" data-title="t"><p class="kicker">01 · 结论</p><h2 class="h2c">标题</h2><div class="concl"><b>加粗</b><span class="up">涨</span><b>再加粗</b></div><div class="grid g2"><div class="card"><h4>证据一</h4></div><div class="card"><h4>证据二</h4></div></div><div class="notes">这是一段足够长的讲者备注, 用于通过校验。</div></section>`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: {} }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;

/* ---------- 记录扫描前的时间戳, 只查这次跑出来的东西 ---------- */
const t0 = Date.now();
fs.mkdirSync(path.join(ROOT, 'tools', '_leak'), { recursive: true });
const stdoutFile = path.join(ROOT, 'tools', '_leak', 'server_stdout.txt');
const stderrFile = path.join(ROOT, 'tools', '_leak', 'server_stderr.txt');

/* ---------- 起一个干净的服务实例, 把 stdout 落盘供搜 ---------- */
process.env.FUNDCLINIC_PORT = '8911';
delete process.env.FUNDCLINIC_ALLOW_NO_AI;
const out = fs.openSync(stdoutFile, 'w');
const err = fs.openSync(stderrFile, 'w');
const { spawn } = await import('node:child_process');
const srv = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT, stdio: ['ignore', out, err], env: { ...process.env }
});
await new Promise(r => setTimeout(r, 4000));

console.log('标记密钥: ' + MARK);
console.log('假大模型端口: ' + mockPort + ' · 服务端口: 8911');

/* ---------- 带标记密钥跑一次完整复盘 ---------- */
console.log('\n[1] POST /api/run (带标记密钥)');
const res = await fetch('http://127.0.0.1:8911/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, ai: { apiKey: MARK, baseUrl: `http://127.0.0.1:${mockPort}`, model: 'mock' }, pdf: false })
});
const text = await res.text();
const sawInResponse = text.includes(MARK);
console.log('    HTTP ' + res.status + ' · 响应 ' + Math.round(text.length / 1024) + ' KB');
console.log('    响应体里出现标记密钥: ' + sawInResponse + (sawInResponse ? '   ← 这是正常的(回显给前端用), 关键看落盘' : ''));

await new Promise(r => setTimeout(r, 1500));
srv.kill();
await new Promise(r => setTimeout(r, 1000));
fs.closeSync(out); fs.closeSync(err);
mock.close();

/* ---------- 全盘搜索 ---------- */
console.log('\n[2] 全盘搜索标记密钥');
function walk(p, acc = []) {
  let st; try { st = fs.statSync(p); } catch (e) { return acc; }
  if (st.isFile()) { acc.push(p); return acc; }
  if (!st.isDirectory()) return acc;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    walk(path.join(p, e.name), acc);
  }
  return acc;
}
const roots = ['_runs', '_dist', 'app', 'server', 'data', 'skills', 'tools/_leak'];
const files = [];
for (const r of roots) files.push(...walk(path.join(ROOT, r)));
for (const f of ['index.html', 'server.mjs', 'README.md']) files.push(path.join(ROOT, f));

const hits = [];
for (const f of files) {
  let st; try { st = fs.statSync(f); } catch (e) { continue; }
  if (st.size > 8 * 1024 * 1024) continue;
  let buf; try { buf = fs.readFileSync(f); } catch (e) { continue; }
  if (buf.includes(MARK)) hits.push(path.relative(ROOT, f));
}
console.log('    扫描 ' + files.length + ' 个文件');
if (!hits.length) {
  console.log('    ✓ 未在任何落盘文件中找到标记密钥');
} else {
  console.log('    ✗ 以下文件含有标记密钥:');
  hits.forEach(h => console.log('        ' + h));
}

/* ---------- 单独确认几个最可疑的位置 ---------- */
console.log('\n[3] 重点位置逐项确认');
const checks = [
  ['_runs/<code>/run.json (含 summary.aiLog)', path.join(ROOT, '_runs', code, 'run.json')],
  ['_runs/<code>/analysis.json', path.join(ROOT, '_runs', code, 'analysis.json')],
  ['_runs/<code>/datasetMeta.json', path.join(ROOT, '_runs', code, 'datasetMeta.json')],
  ['_runs/<code>/底稿_*.json', null],
  ['分发包 _dist/基金复诊台_发给组员', path.join(ROOT, '_dist', '基金复诊台_发给组员')],
  ['服务端 stdout', stdoutFile],
  ['服务端 stderr', stderrFile]
];
for (const [label, p] of checks) {
  if (!p) { console.log('    ' + label.padEnd(42) + ' (跳过: 通配路径, 已在全盘搜索里覆盖)'); continue; }
  let sm = '(不存在)';
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) sm = '(目录, 已在全盘搜索里覆盖)';
    else sm = fs.readFileSync(p, 'utf8').includes(MARK) ? '!! 含标记密钥' : '干净 ✓';
  } catch (e) { sm = '(不存在)'; }
  console.log('    ' + label.padEnd(42) + ' ' + sm);
}

/* ---------- 顺带确认分发包整体也没被污染 ---------- */
console.log('\n[4] 分发包复扫');
const dist = path.join(ROOT, '_dist', '基金复诊台_发给组员');
if (fs.existsSync(dist)) {
  const df = walk(dist);
  const bad = df.filter(f => fs.readFileSync(f).includes(MARK));
  console.log('    文件 ' + df.length + ' 个, 含标记密钥的: ' + (bad.length ? bad.join(', ') : '0 个 ✓'));
} else {
  console.log('    (还没打包)');
}

fs.rmSync(path.join(ROOT, 'tools', '_leak'), { recursive: true, force: true });
console.log('\n结论: ' + (hits.length ? '!! 有泄露, 必须修' : '密钥不会被落盘, 也不会被打进分发包。'));
