/* 页面冒烟测试: 用无头 Edge 真渲染 index.html, 断言关键内容出现在 DOM 里, 并逐页截图。
 * 用法: node tools/smoke_page.mjs
 * 为什么不用 jsdom: 这里要验的是"双击能不能真的打开", 必须用真浏览器渲染。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOT = path.join(ROOT, 'tools', '_smoke');
fs.mkdirSync(SHOT, { recursive: true });

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe'); process.exit(1); }

const base = pathToFileURL(path.join(ROOT, 'index.html')).href;
const profile = path.join(os.tmpdir(), 'fc-smoke-profile');

function edge(args) {
  return execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--virtual-time-budget=10000', '--allow-file-access-from-files',
    ...args
  ], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

const MARKERS = [
  ['基金复诊台', '品牌名'],
  ['门禁 1 · 口径确认', '门禁1 UI'],
  /* 「路线 B · 粘贴你自己的数据」这一条在 2026-10-10 的界面收敛里被**主动删掉**了:
     页面上一度有在线爬取 / 内置样例 / 粘贴数据三个并行入口, 谁都不知道该点哪个,
     而粘贴那条路是唯一没有对账、没有 AI、没有证据链的。解析器 FC.parsePaste 仍在
     (tools/selftest.mjs 还在测它), 只是不再摆到界面上。 */
  ['没装 Node.js', '离线样例入口'],
  ['开始复盘', '首屏主行动'],
  ['六类公开来源', '首屏事实条'],
  ['先说结论', '报告第 1 节'],
  ['口径与证据边界', '报告第 2 节'],
  ['总成绩也看清代价', '报告第 3 节'],
  ['持仓集中度与骨架', '报告第 4 节'],
  ['持仓轮动主线', '报告第 5 节'],
  ['方法论拆解', '报告第 6 节'],
  ['关键调仓案例审计', '报告第 7 节'],
  ['最新一期结构与变化', '报告第 8 节'],
  ['不能被神化', '报告第 9 节'],
  ['跟踪清单与证伪方式', '报告第 10 节'],
  ['逐期前十大索引', '报告第 11 节'],
  ['门禁 2 · 核心判断方向确认', '门禁2 UI'],
  ['潞安环能', '真实持仓渲染'],
  ['宏桥控股', '真实持仓渲染'],
  ['2020Q4', '区间首期'],
  ['2026Q2', '区间末期'],
  ['错误检查记录', '质检导出按钮'],
  ['人工抽检清单', '抽检清单'],
  ['T1 · 主题归类', 'AI 任务卡 1'],
  ['T2 · 核心判断起草', 'AI 任务卡 2'],
  ['T3 · 对外用词清洗', 'AI 任务卡 3'],
  ['错了怎么发现', 'AI 任务说明'],
  ['门禁 3 · 终审三查', '门禁3 UI'],
  ['只看前十大持仓', '边界声明'],
  ['不构成投资建议', '免责声明']
];

let pass = 0, fail = 0;
console.log('浏览器: ' + EDGE);
console.log('页面:   ' + base + '\n');

console.log('=== A. 渲染后 DOM 内容断言 ===');
const dom = edge(['--dump-dom', base]);
const text = dom.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
fs.writeFileSync(path.join(SHOT, 'rendered_dom.html'), dom, 'utf8');
console.log('DOM 大小: ' + (dom.length / 1024).toFixed(1) + ' KB\n');
for (const [m, label] of MARKERS) {
  if (text.includes(m)) { pass++; console.log('  PASS  ' + label + '  («' + m + '»)'); }
  else { fail++; console.log('  FAIL  ' + label + '  («' + m + '» 未出现)'); }
}

console.log('\n=== B. 逐视图截图 ===');
for (const v of ['input', 'report', 'ledger', 'audit']) {
  const out = path.join(SHOT, 'view_' + v + '.png');
  edge(['--window-size=1440,1200', '--screenshot=' + out, base + '#' + v]);
  const size = fs.statSync(out).size;
  const okShot = size > 20000;
  if (okShot) { pass++; console.log('  PASS  ' + v + ' 截图 ' + (size / 1024).toFixed(0) + ' KB -> ' + path.relative(ROOT, out)); }
  else { fail++; console.log('  FAIL  ' + v + ' 截图过小(' + size + ' B), 页面可能是空白'); }
}

console.log('\n=== C. 无残留占位符 ===');
const bad = ['undefined', 'NaN', '[object Object]', '{{', 'TODO'];
for (const b of bad) {
  // NaN/undefined 只检查正文, 忽略脚本与属性
  const hit = text.includes(b);
  if (hit) { fail++; console.log('  FAIL  正文出现 «' + b + '»'); }
  else { pass++; console.log('  PASS  正文无 «' + b + '»'); }
}

console.log('\n==================================================');
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail) process.exitCode = 1; else console.log('全部通过。截图见 tools/_smoke/');
