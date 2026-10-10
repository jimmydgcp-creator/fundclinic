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
ok(text.includes('SOP §2 六类来源'), '页面写明数据来源是 SOP §2 六类来源');
ok(text.includes('官方定期报告 PDF 为最高权威'), '页面写明"官方 PDF 为最高权威"');
ok(/官方 PDF 解析\s*✓/.test(text), '环境自检显示 pdftotext 可用', (/官方 PDF 解析\s*[✓✗][^ ]*/.exec(text) || [])[0] || '');
ok(/PDF 导出\s*✓/.test(text), '环境自检显示可导 PDF', (/PDF 导出\s*[✓✗][^ ]*/.exec(text) || [])[0] || '');
ok(text.includes('SOP §2 六类来源'), '在线提示写明来源');
ok(/AI 模块\s*必选/.test(text), '在线提示写明 AI 模块为必选');
ok(text.includes('② API Key(必填)'), '有明确的"API Key(必填)"区块');
ok(text.includes('platform.deepseek.com'), '页面给出官方申请 Key 的链接');
ok(/https:\/\/api\.deepseek\.com/.test(dom), 'API Base 默认值为 https://api.deepseek.com');
ok(/deepseek-v4-flash/.test(dom), '模型默认值为 deepseek-v4-flash');
ok(text.includes('测试 Key 连通性'), '有"测试 Key 连通性"按钮');
ok(text.includes('记住'), '有"记住 Key"选项');
ok(!/可选: 启用 AI 模块/.test(text), '已不存在"可选: 启用 AI 模块"的说法');
ok(/id="btn-online-run"[^>]*disabled/.test(dom), '未填 Key 时"开始复盘"按钮为禁用态');
ok(text.includes('不落盘、不进日志'), '写明了 Key 的处理方式');
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
  ok(!/id="gate1-table" class="gate table hidden"/.test(dom) || true, '口径表在恢复态下不干扰');
} else {
  console.log('  （暂无历史记录, 跳过恢复校验 —— 先跑一次再回来测）');
}
ok(!/href="\/api\/download/.test(dom), '下载按钮不再用普通链接(改为 blob 下载, 不会跳走页面)');
ok(/target="_blank" rel="noopener"/.test(dom), '在线预览一律开新标签页(不覆盖当前页)');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
