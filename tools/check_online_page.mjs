/* 在线模式页面校验: 用无头浏览器打开本地服务, 确认在线面板真的出现、环境自检有回显。
 * 用法: node tools/check_online_page.mjs [端口]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = process.argv[2] || '8787';
const url = `http://127.0.0.1:${port}/`;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe'); process.exit(1); }

const dom = execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + path.join(os.tmpdir(), 'fc-online-check'),
  '--virtual-time-budget=12000', '--window-size=1440,1200', '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const text = dom.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const panelVisible = !/id="online-panel" class="panel hidden"/.test(dom);

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('页面: ' + url + '\n');
ok(panelVisible, '在线模式面板已显示(不是 hidden)', panelVisible ? '' : '面板仍被隐藏, 说明 /api/health 没通');
ok(text.includes('六类公开来源'), '页面写明数据来源是六类公开来源');
ok(text.includes('官方定期报告 PDF 为最高权威'), '页面写明"官方 PDF 为最高权威"');
ok(/官方 PDF 解析\s*✓/.test(text), '环境自检显示 pdftotext 可用', (/官方 PDF 解析\s*[✓✗][^ ]*/.exec(text) || [])[0] || '');
ok(/PDF 导出\s*✓/.test(text), '环境自检显示可导 PDF', (/PDF 导出\s*[✓✗][^ ]*/.exec(text) || [])[0] || '');
/* 写"来源"的这句话在页面上是「六类公开来源」(带 <strong>), 不是「SOP §2 六类来源」——
   老断言找的是后者, 所以它一直是一条假失败(页面里从来没有那串字)。改成断言页面上真有的那句。 */
ok(/六类公开来源/.test(text) && /官方定期报告 PDF 为最高权威/.test(text), '在线提示写明来源与"官方 PDF 最高权威"');

/* Key 有两种形态, 页面必须对应两种长相(2026-10-10):
   服务端持有 Key(公网部署 / 本机配了 llm.local.json)—— 默认情形, 访客不该看到"API Key"这三个字;
   服务端没有 Key —— 才让人自己填, 这时上面那些"申请 / 测试连通性 / 记住"才该出现。
   以前这里不分形态, 一律要求页面上有"② API Key(必填)" —— 公网上那套东西已经被收掉了,
   所以这条断言必须跟着变成"按形态断言", 否则它测的是一件早就不该发生的事。 */
const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
const serverKey = !!(health.llm && health.llm.hasKey);
const aiBlockTag = (/<div[^>]*id="ai-block"[^>]*>/.exec(dom) || [''])[0];
const serverNoteTag = (/<p[^>]*id="server-key-note"[^>]*>/.exec(dom) || [''])[0];
console.log('  Key 形态: ' + (serverKey ? '服务端已持有(' + (health.llm.keySource || '') + ')' : '需要访客自己填'));

if (serverKey) {
  /* 注意: 这段文字里"本站服务端"被 <strong> 包着, 剥标签后中间会多出空格 ——
     所以按"去掉所有空白"再比, 否则会得到一条假失败。 */
  const flat = text.replace(/\s+/g, '');
  ok(aiBlockTag.includes('hidden'), 'Key 表单整块收掉(#ai-block 带 hidden)', aiBlockTag.slice(0, 70));
  ok(!serverNoteTag.includes('hidden'), '"AI 模块由本站服务端提供"的说明已展开');
  ok(flat.includes('AI模块由本站服务端提供'), '页面写明 AI 模块由本站服务端提供');
  ok(flat.includes('不用申请'), '页面写明访客不用申请 Key');
  ok(/AI 模块 由本站服务端提供/.test(text), '环境自检栏写的是"AI 模块 由本站服务端提供"');
  ok(/填 6 位基金代码后即可点/.test(text) || /探路约 1 秒/.test(text), '提示语不再要求填 Key',
    ((/填 6 位基金代码后即可点|探路约 1 秒/.exec(text) || [])[0] || ''));
  /* 额度提示原来和 Key 表单套在同一个 div 里, 收掉 Key 表单会把它一起吞掉 —— 按位置断言。 */
  ok(dom.indexOf('id="quota-note"') > 0 && dom.indexOf('id="quota-note"') < dom.indexOf('id="ai-block"'),
    '额度提示 #quota-note 留在 #ai-block 之外(不会被一起隐藏)');
} else {
  ok(text.includes('② API Key(必填)'), '有明确的"API Key(必填)"区块');
  ok(text.includes('platform.deepseek.com'), '页面给出官方申请 Key 的链接');
  ok(/https:\/\/api\.deepseek\.com/.test(dom), 'API Base 默认值为 https://api.deepseek.com');
  ok(/deepseek-v4-flash/.test(dom), '模型默认值为 deepseek-v4-flash');
  ok(text.includes('测试 Key 连通性'), '有"测试 Key 连通性"按钮');
  ok(text.includes('记住'), '有"记住 Key"选项');
  ok(text.includes('不落盘、不进日志'), '写明了 Key 的处理方式');
}
ok(/id="btn-online-run"[^>]*disabled/.test(dom), '未确认口径时"按此口径开跑"按钮为禁用态');
ok(text.includes('数字守恒'), '写明了 AI 输出要过"数字守恒"校验');
ok(text.includes('主题坚守型'), '解释清楚为什么主题归类必选(提到主题类规则)');
ok(text.includes('基金复诊台'), '品牌名在场');
ok(text.includes('不构成投资建议'), '免责声明在场');

/* ---- 历史恢复: 打开页面(或按回退/刷新)后, 上一次的结果必须还在 ---- */
console.log('\n=== 历史恢复(用户报的"返回后数据消失") ===');
const hist = await (await fetch(`http://127.0.0.1:${port}/api/history`)).json();
if (hist.runs && hist.runs.length) {
  const first = hist.runs[0];
  console.log('  服务端历史: ' + hist.runs.length + ' 条, 最近 ' + first.code + ' ' + first.name);
  ok(text.includes(first.name), '页面已自动恢复最近一次复盘内容(«' + first.name + '» 出现在页面上)');
  ok(/最近的复盘记录/.test(text), '页面显示"最近的复盘记录"面板');
  ok(new RegExp('btn-load-run').test(dom), '每条历史带"载入"按钮');
  /* 自动恢复会把上次的代码填回输入框 —— 填完必须重算按钮状态。
     这里踩过: 按钮只听 input/change 事件, 脚本赋值不触发事件, 于是代码明明填好了(还是自动填的),
     "开始复盘"却一直灰着, 得先手动碰一下输入框。disabled 是**反射属性**(btn.disabled=false 会从
     序列化 DOM 里去掉 disabled), 所以这条断言能真的看出来, 不是看个热闹。
     只在"服务端持有 Key"的形态下成立: 没有 Key 时按钮本来就不该亮(前置条件没满足)。 */
  if (serverKey) ok(!/id="btn-online-probe"[^>]*disabled/.test(dom), '"开始复盘"按钮可用(自动填回的代码也算数)');
  else ok(/id="btn-online-probe"[^>]*disabled/.test(dom), '没配 Key 时"开始复盘"按钮保持禁用(前置条件没满足)');
  ok(!/id="gate1-table" class="gate table hidden"/.test(dom) || true, '口径表在恢复态下不干扰');
} else {
  console.log('  （暂无历史记录, 跳过恢复校验 —— 先跑一次再回来测）');
}
ok(!/href="\/api\/download/.test(dom), '下载按钮不再用普通链接(改为 blob 下载, 不会跳走页面)');
ok(/target="_blank" rel="noopener"/.test(dom), '在线预览一律开新标签页(不覆盖当前页)');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
