/* 版面机械体检: 不看图也能发现"文字看不见/被截断/横向溢出"这类问题。
 * 做法: 复制一份 index.html, 追加一段体检脚本, 用无头 Edge 渲染后把结果写进 DOM 再 dump 出来。
 * 生产文件保持干净, 体检代码只存在于 tools/ 下。
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

const AUDIT = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var out = { views: {}, problems: [], counts: {}, hash: location.hash };
    function visible(el) {
      var s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function parseColor(c) {
      var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(c);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    }

    // 1) 每个视图: 元素数 / 是否有内容 / 横向溢出
    ['input', 'report', 'ledger', 'audit'].forEach(function (v) {
      var sec = document.getElementById('view-' + v);
      var r = sec.getBoundingClientRect();
      var txt = (sec.innerText || '').trim();
      out.views[v] = {
        chars: txt.length,
        height: Math.round(r.height),
        scrollW: sec.scrollWidth, clientW: sec.clientWidth,
        hOverflow: sec.scrollWidth > sec.clientWidth + 2,
        descendants: sec.querySelectorAll('*').length
      };
    });

    // 2) 全页横向溢出
    out.pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    out.pageScrollW = document.documentElement.scrollWidth;
    out.pageClientW = document.documentElement.clientWidth;

    // 3) 文字不可见检测: 前景色 == 背景色, 或前景透明
    var skip = ['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE'];
    var all = document.querySelectorAll('body *');
    var invisible = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (skip.indexOf(el.tagName) >= 0) continue;
      if (el.children.length > 0) continue;              // 只看叶子节点
      var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
        .map(function (n) { return n.textContent.trim(); }).join('');
      if (!own) continue;
      if (!visible(el)) continue;
      var s = getComputedStyle(el);
      var fg = parseColor(s.color), bg = null, p = el;
      while (p && p !== document.documentElement) {
        var pb = parseColor(getComputedStyle(p).backgroundColor);
        if (pb && pb.a > 0.05) { bg = pb; break; }
        p = p.parentElement;
      }
      if (!fg) continue;
      if (fg.a < 0.15) { invisible.push({ t: own.slice(0, 26), why: 'foreground alpha=' + fg.a, cls: el.className }); continue; }
      if (bg && Math.abs(fg.r - bg.r) < 12 && Math.abs(fg.g - bg.g) < 12 && Math.abs(fg.b - bg.b) < 12) {
        invisible.push({ t: own.slice(0, 26), why: 'fg==' + s.color + ' bg==rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', cls: el.className });
      }
    }
    out.invisibleText = invisible;

    // 4) 文字被横向截断(容器内文本溢出)
    var clipped = [];
    ['#report-body', '#ledger-body', '#audit-body', '.tbl', '.rule', '.ai-task', '.metric', '.io-box'].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (!visible(el)) return;
        var s = getComputedStyle(el);
        if (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflow === 'auto' || s.overflow === 'scroll') return;
        if (el.scrollWidth > el.clientWidth + 3) clipped.push({ sel: sel, sw: el.scrollWidth, cw: el.clientWidth, head: (el.innerText || '').slice(0, 30) });
      });
    });
    out.clippedText = clipped;

    // 5) 关键元素计数
    /* 注意: 柱状图的柱子 class 是 .cbar(engine.js 的 bar() 生成), 不是 .bar ——
       这里两个都数, 免得以后再改类名时又变成"永远数到 0 却没人发现"。 */
    ['rsec', 'rule', 'rule-pass', 'rule-warn', 'rule-fail', 'bar', 'cbar', 'metric', 'ai-task', 'badge-pass', 'badge-warn', 'badge-fail', 'tbl'].forEach(function (c) {
      out.counts[c] = document.querySelectorAll('.' + c).length;
    });
    out.counts['report-section'] = document.querySelectorAll('.rsec').length;
    out.counts['toc-link'] = document.querySelectorAll('.toc a').length;
    out.counts['ev-fact'] = document.querySelectorAll('.ev-fact').length;
    out.counts['ev-infer'] = document.querySelectorAll('.ev-infer').length;

    // 6) 审计页关键文案是否在场
    var auditTxt = document.getElementById('view-audit').innerText || '';
    out.auditMarkers = {
      规则条数提示: /自动质检\\(错了怎么发现 · (\\d+) 条规则\\)/.exec(auditTxt),
      总体结论: /(全部通过|通过, 有 \\d+ 项建议人工确认|有 \\d+ 项必须处理\\(阻断\\))/.exec(auditTxt),
      抽检行数: (auditTxt.match(/打开季报|需自行检索/g) || []).length
    };

    /* 柱状图定标实测: 最高柱应占画布高度的 80%。
       为什么不靠"算一遍公式就信": 柱高是百分比, 真正决定观感的是它落在多高的画布里 ——
       .cplot 的高度、有没有 padding/border 吃掉一截, 只有量出来才知道。
       2026-10-10 用户要求"最高柱占整个图高度的 80%", 这条断言就是它的验收标准。
       注意: 报告视图默认是 display:none, 隐藏容器里 getBoundingClientRect 全是 0 —— 必须先显示出来
       (第一版没做, 量到"画布 0px"直接假失败)。这一步放在所有其他测量之后, 不影响前面的结论。 */
    var rv = document.getElementById('view-report');
    if (rv && !rv.classList.contains('active')) {
      var cur = document.querySelector('.view.active');
      if (cur) cur.classList.remove('active');
      rv.style.animation = 'none';
      rv.classList.add('active');
    }
    var cplot = document.querySelector('.cplot');
    var bars = [].slice.call(document.querySelectorAll('.cbar'));
    if (cplot && bars.length) {
      var plotH = cplot.getBoundingClientRect().height;
      var hs = bars.map(function (b) { return b.getBoundingClientRect().height; });
      out.chartScale = {
        画布高: Math.round(plotH),
        最高柱高: Math.round(Math.max.apply(null, hs)),
        最低柱高: Math.round(Math.min.apply(null, hs)),
        最高柱占比: plotH ? +(Math.max.apply(null, hs) / plotH * 100).toFixed(1) : 0
      };
    }

    var pre = document.createElement('pre');
    pre.id = 'AUDIT_RESULT';
    pre.textContent = JSON.stringify(out, null, 1);
    document.body.appendChild(pre);
  }, 400);
});
</script>
`;

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inj = src.replace('</body>', AUDIT + '</body>');
// 必须与原页面同目录, 否则 app/ 与 data/ 的相对路径会 404
const tmp = path.join(ROOT, '_audit_tmp.html');
fs.writeFileSync(tmp, inj, 'utf8');
const profile = path.join(os.tmpdir(), 'fc-audit-profile');

let dom;
try {
  dom = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile,
    '--virtual-time-budget=12000', '--allow-file-access-from-files', '--window-size=1440,1200',
    '--dump-dom', pathToFileURL(tmp).href
  ], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
}

const m = /<pre id="AUDIT_RESULT">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.error('未拿到体检结果(页面可能报错)。DOM 大小 ' + dom.length); process.exit(1); }
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const res = JSON.parse(unesc(m[1]));
fs.writeFileSync(path.join(SHOT, 'layout_audit.json'), JSON.stringify(res, null, 2), 'utf8');

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('=== A. 各视图渲染量 ===');
for (const [v, d] of Object.entries(res.views)) {
  ok(d.chars > 200 && d.descendants > 20, v + ' 视图有内容', `${d.chars} 字符 / ${d.descendants} 节点 / 高 ${d.height}px`);
}
console.log('\n=== B. 横向溢出 ===');
ok(!res.pageOverflow, '页面无横向溢出', `scrollW ${res.pageScrollW} vs clientW ${res.pageClientW}`);
for (const [v, d] of Object.entries(res.views)) ok(!d.hOverflow, v + ' 视图无横向溢出', `sw ${d.scrollW} cw ${d.clientW}`);

console.log('\n=== C. 文字不可见检测 ===');
ok(res.invisibleText.length === 0, '无"前景色=背景色/透明"的不可见文字', res.invisibleText.length ? JSON.stringify(res.invisibleText.slice(0, 5)) : '');
if (res.invisibleText.length) res.invisibleText.slice(0, 8).forEach(x => console.log('       · ' + x.t + ' [' + x.why + '] .' + x.cls));

console.log('\n=== D. 文字被截断检测 ===');
ok(res.clippedText.length === 0, '无文本溢出容器', res.clippedText.length ? JSON.stringify(res.clippedText.slice(0, 5)) : '');

console.log('\n=== E. 关键元素计数 ===');
const c = res.counts;
ok(c['report-section'] === 10 || c['report-section'] === 11, '报告章节 10 节必需(第九节由大模型生成时 11 节)', String(c['report-section']));
ok(c['toc-link'] === c['report-section'], '目录条数与章节数一致', String(c['toc-link']));
ok(c.rule >= 15, '质检规则 >=15 条', String(c.rule));
ok(c['badge-pass'] >= 10, '通过徽章 >=10', String(c['badge-pass']));
ok(c.cbar + c.bar >= 20, '集中度柱状图柱数 >=20', `cbar=${c.cbar} bar=${c.bar}`);
/* 最高柱占画布 80%(±2pp) —— 太少显得没长起来, 太多顶到框线上 */
if (res.chartScale) {
  const cs = res.chartScale;
  ok(Math.abs(cs.最高柱占比 - 80) <= 2, '柱状图最高柱占画布高度的 80%(±2pp)',
    `画布 ${cs.画布高}px · 最高柱 ${cs.最高柱高}px = ${cs.最高柱占比}% · 最低柱 ${cs.最低柱高}px`);
  ok(cs.最低柱高 >= 4, '最低柱仍看得见(不会被压成一条线)', cs.最低柱高 + 'px');
} else {
  ok(false, '页面上没量到柱状图', '找不到 .cplot / .cbar');
}
ok(c['ev-infer'] >= 3, '合理推断标注 >=3 处', String(c['ev-infer']));
ok(c['ai-task'] === 5, '5 张 AI 任务卡(T1 主题归类 / T2 判断起草 / T3 用词清洗 / T4 结论提炼 / T5 深度报告)', String(c['ai-task']));
ok(c.tbl >= 8, '表格 >=8 个', String(c.tbl));
console.log('    完整计数: ' + JSON.stringify(c));

console.log('\n=== F. 审计页文案 ===');
ok(!!res.auditMarkers.规则条数提示, '显示规则条数', JSON.stringify(res.auditMarkers.规则条数提示));
ok(!!res.auditMarkers.总体结论, '显示总体结论', JSON.stringify(res.auditMarkers.总体结论));
ok(res.auditMarkers.抽检行数 >= 12, '抽检清单 >=12 行', String(res.auditMarkers.抽检行数));

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。明细: tools/_smoke/layout_audit.json');
if (fail) process.exitCode = 1;
