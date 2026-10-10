/* 质检页两种形态的对照测试(2026-10-10 界面收敛的守卫)。
 *
 * 背景: 质检页原来到处是"请人打勾/操作"的交互 —— 12 处抽检每条一个"核完"勾选框、
 * 门禁 3 三查三个勾、一整套"复制提示词/粘贴 JSON"的工具箱, 还有一块 API Key 输入区。
 * 勾选框不改数据也不改报告, 只把按钮从灰变亮(证明的是有人点过鼠标, 不是有人核过数),
 * 而公网访客也不该看到 "API Key / 申请 / 测试连通性" 这些词。所以:
 *
 *   有服务端(公网部署 / 本机配了 Key) -> 整页只读: 直接显示核查了什么, AI 由服务端调用;
 *   没有服务端(直接双击 HTML / 单文件版) -> AI 在这条路上真的跑不了, 才保留人工中转工具箱。
 *
 * 本测试同时验这两种形态 —— 只测一种的话, "把交互删干净"和"把功能删干净"看起来一模一样。
 * 用法: node tools/test_audit_mode.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
fs.mkdirSync(path.join(HERE, '_smoke'), { recursive: true });
const PORT = 8797;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); c ? pass++ : fail++; };

function dom(url, budget) {
  return execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'fc-audit-mode'),
    '--virtual-time-budget=' + (budget || 12000), '--window-size=1440,1400', '--dump-dom', url
  ], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}
const toText = h => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** 取某个 id 元素的开始标签, 用来判 hidden 类 —— dump 出来的属性顺序不保证, 所以别用整串正则。 */
const tagOf = (h, id) => (new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>').exec(h) || [''])[0];

/* ================================================== A. 有服务端: 整页只读 */
console.log('=== A. 有服务端(服务端持有 Key)→ 质检页必须是只读的 ===');
const srv = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, FUNDCLINIC_PORT: String(PORT), FUNDCLINIC_LLM_KEY: 'sk-auditmodetest' + 'x'.repeat(24) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });

let health = null;
try {
  for (let i = 0; i < 60 && !health; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) health = await r.json();
    } catch (e) { /* 还没起来 */ }
    if (!health) await new Promise(r => setTimeout(r, 400));
  }
  if (!health) throw new Error('服务没起来(端口被占?)\n' + srvLog.slice(-800));
  ok(health.llm && health.llm.hasKey === true, '健康检查报告服务端已持有 Key', 'keySource=' + (health.llm && health.llm.keySource));

  const H = dom(`http://127.0.0.1:${PORT}/#audit`, 14000);
  const T = toText(H);

  ok(T.includes('本次核查结果'), '质检页显示"本次核查结果"(核查内容直接给结论)');
  ok(T.includes('回原文抽检清单'), '抽检清单仍在(它本身就是"核了什么"的证据)');
  ok(!T.includes('核完'), '抽检清单里没有"核完"勾选框列');
  ok(!T.includes('确认判断方向'), '报告页没有"确认判断方向"按钮');
  ok(!/我要改判/.test(T), '报告页没有"改判"单选框');
  ok(T.includes('AI 由服务端调用, 你不需要做任何操作'), 'AI 段写明"由服务端调用, 不需要你操作"');
  ok(!T.includes('手动中转'), '公网形态不出现"手动中转"工具箱');
  ok(!T.includes('直连大模型执行'), '公网形态不出现"直连大模型执行"');
  ok(!T.includes('粘贴到这里'), '公网形态不出现"粘贴大模型返回的 JSON"');
  ok(tagOf(H, 'ai-block').includes('hidden'), 'Key 表单整块被收掉(元素还在 DOM, 但带上 hidden 类)', tagOf(H, 'ai-block').slice(0, 90));
  ok(T.includes('本站服务端'), '"AI 模块由本站服务端提供"的说明已显示');
  ok(T.includes('不用申请'), '说明了访客不用申请 Key');
  /* 额度提示必须留在 ai-block 外面 —— 否则 Key 表单被收掉的同一次改动会把额度提示一起吞掉
     (它俩原来套在同一个 div 里)。这条是按位置断言的, 不然看不出区别。 */
  ok(H.indexOf('id="quota-note"') > 0 && H.indexOf('id="quota-note"') < H.indexOf('id="ai-block"'),
    '#quota-note 在 #ai-block 之外(不会被一起隐藏)');
  ok(/AI 模块 由本站服务端提供/.test(T), '环境自检栏写的是"AI 模块 由本站服务端提供"');
  /* 2026-10-10 二次收敛: 质检页那张「运行记录」表和它的导出按钮整块删掉了。
     删的理由在公网页上看得最清楚: 没有服务端结果时, 表里只有一行占位符
     「本次未调用大模型(全部由离线规则引擎完成)」—— 而公网形态下大模型确实在跑, 只是跑在服务端;
     表头那列"人工复核"也早就不存在了。与其留一张空的、还会说错话的表, 不如去掉。 */
  ok(!T.includes('本次未调用大模型'), '质检页没有"本次未调用大模型"这类离线占位表');
  ok(!T.includes('导出《AI 运行记录》MD'), '质检页没有《AI 运行记录》导出按钮(整块已删)');

  fs.writeFileSync(path.join(HERE, '_smoke', 'audit_online.html'), H, 'utf8');
} finally {
  srv.kill();
}
ok(true, 'A 段结束(服务端已停)', '');

/* ================================================== B. 没有服务端: 保留人工中转 */
console.log('\n=== B. 没有服务端(直接打开 HTML)→ 保留人工中转, 但不能假装有 AI ===');
const fileUrl = pathToFileURL(path.join(ROOT, 'index.html')).href + '#audit';
const H2 = dom(fileUrl, 10000);
const T2 = toText(H2);
ok(T2.includes('本次核查结果'), '离线形态也有"本次核查结果"(换的是形态, 不是把内容删了)');
ok(T2.includes('手动中转'), '离线形态保留"手动中转"(这条路上 AI 真的跑不了)');
ok(T2.includes('当前没有服务端'), '离线形态写明"当前没有服务端", 不假装 AI 可用');
ok(!T2.includes('本站服务端'), '离线形态不出现"本站服务端"字样');
ok(!T2.includes('核完'), '离线形态同样没有"核完"勾选框');
ok(!T2.includes('确认判断方向'), '离线形态同样没有"确认判断方向"按钮');
ok(!T2.includes('本次未调用大模型') && !T2.includes('导出《AI 运行记录》MD'), '离线形态同样没有那张「运行记录」表与导出按钮');

console.log('\n==================================================');
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail) process.exitCode = 1; else console.log('两种形态都对。DOM 快照: tools/_smoke/audit_online.html');
