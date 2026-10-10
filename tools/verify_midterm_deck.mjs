/* 中期展示页的机械体检: 每页内容有没有超出 1280x720、有没有互相压住、有没有被 overflow:hidden 剪掉。
 * 为什么必须量: 上一版流程图就是"XML 合法、浏览器不报错、但一个方框都没画出来"—— 只有量渲染结果才发现。
 * 用法: node tools/verify_midterm_deck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = process.argv[2] || path.resolve('..', '00_交作业', '中期汇报_展示页', 'index.html');
if (!fs.existsSync(SRC)) { console.error('找不到 ' + SRC); process.exit(1); }

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 Edge/Chrome'); process.exit(1); }

const probe = `
<div id="__diag" style="display:none"></div>
<script>
(function(){
  var W = 1280, H = 720;
  /* 坑: getBoundingClientRect 给的是**变换后**的坐标(.stage 上有 scale), 拿它跟 1280/720 比会全部算错。
     所以先读缩放, 再把所有长度除回去。 */
  var SC = parseFloat(getComputedStyle(document.getElementById('stage')).getPropertyValue('--s')) || 1;
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var rows = [];
  slides.forEach(function(s, i){
    s.style.opacity = 1; s.style.pointerEvents = 'auto'; s.style.transform = 'none';
    var box = s.getBoundingClientRect();
    var kids = [].slice.call(s.children).map(function(c){ return c.getBoundingClientRect(); })
      .filter(function(r){ return r.height > 1 && r.width > 1; });
    /* 只量**叶子节点**。量容器没用: .body 是 flex:1, 它永远撑满到 678px,
       于是每一页的"正文底"都会一样, 看不出真正的空白在哪。 */
    var botMain = -Infinity;
    [].slice.call(s.querySelectorAll('*')).forEach(function(el){
      if (el.children.length > 0) return;
      if (el.closest('.pg') || el.closest('.tagbar') || el.closest('.shot')) return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var r = el.getBoundingClientRect();
      if (r.height > 1) botMain = Math.max(botMain, r.bottom - box.top);
    });
    var top = Infinity, bot = -Infinity, lef = Infinity, rig = -Infinity;
    kids.forEach(function(r){
      top = Math.min(top, r.top - box.top); bot = Math.max(bot, r.bottom - box.top);
      lef = Math.min(lef, r.left - box.left); rig = Math.max(rig, r.right - box.left);
    });
    /* 顶层子元素两两重叠 */
    var ov = [];
    for (var a = 0; a < kids.length; a++) for (var b = a + 1; b < kids.length; b++) {
      var ix = Math.min(kids[a].right, kids[b].right) - Math.max(kids[a].left, kids[b].left);
      var iy = Math.min(kids[a].bottom, kids[b].bottom) - Math.max(kids[a].top, kids[b].top);
      if (ix > 2 && iy > 2) ov.push(a + 'x' + b);
    }
    /* 后代里被 overflow:hidden 剪掉内容的 */
    var clipped = [];
    [].slice.call(s.querySelectorAll('*')).forEach(function(el){
      if (el.closest && el.closest('.shot')) return;
      if (el.tagName === 'IMG') return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var dy = el.scrollHeight - el.clientHeight, dx = el.scrollWidth - el.clientWidth;
      if (el.clientHeight > 0 && dy > 2) clipped.push({ t: el.tagName + '.' + (el.className || '').toString().split(' ')[0], dy: dy });
      if (el.clientWidth > 0 && dx > 2) clipped.push({ t: el.tagName + '.' + (el.className || '').toString().split(' ')[0], dx: dx });
    });
    rows.push({
      page: i + 1,
      overflowBottom: Math.round((bot - H * SC) / SC), overflowTop: Math.round(top / SC),
      overflowRight: Math.round((rig - W * SC) / SC), overflowLeft: Math.round(lef / SC),
      contentBottom: Math.round(botMain / SC),
      overlaps: ov, clipped: clipped.slice(0, 4), nClip: clipped.length
    });
    /* 量完必须还原 —— 否则后续截图会把 14 页全叠在一起 */
    s.style.opacity = ''; s.style.pointerEvents = ''; s.style.transform = '';
  });
  document.getElementById('__diag').textContent = JSON.stringify({
    slideCount: slides.length,
    scale: SC,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    rows: rows
  });
})();
</script>`;

let html = fs.readFileSync(SRC, 'utf8');
const at = html.lastIndexOf('</body>');
html = at >= 0 ? html.slice(0, at) + probe + '\n' + html.slice(at) : html + probe;
const tmp = path.join(path.dirname(SRC), '.verify_probe.html');
fs.writeFileSync(tmp, html, 'utf8');

const dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1280,720', '--virtual-time-budget=5000', '--dump-dom',
  'file:///' + tmp.replace(/\\/g, '/')], { encoding: 'utf8', maxBuffer: 1 << 28 });

const m = /<div id="__diag"[^>]*>([\s\S]*?)<\/div>/.exec(dom);
if (!m) { console.error('探针未返回'); process.exit(1); }
const d = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

const ok = b => b ? '✓' : '✗';
console.log('页数 ' + d.slideCount + ' · 缩放 --s=' + d.scale);
let bad = 0;
for (const r of d.rows) {
  const issues = [];
  if (r.overflowBottom > 0) issues.push('下溢出 ' + r.overflowBottom + 'px');
  if (r.overflowRight > 0) issues.push('右溢出 ' + r.overflowRight + 'px');
  if (r.overflowTop < 0) issues.push('上溢出 ' + (-r.overflowTop) + 'px');
  if (r.overflowLeft < 0) issues.push('左溢出 ' + (-r.overflowLeft) + 'px');
  if (r.overlaps.length) issues.push('顶层重叠 ' + r.overlaps.join(','));
  if (r.nClip) issues.push('被剪 ' + r.nClip + ' 处 [' + r.clipped.map(c => c.t + '(' + (c.dy ? 'dy' + c.dy : 'dx' + c.dx) + ')').join(' ') + ']');
  if (issues.length) bad++;
  console.log('  ' + ok(issues.length === 0) + ' 第 ' + String(r.page).padStart(2, '0') + ' 页'
    + '  正文底 ' + String(r.contentBottom).padStart(4) + 'px / 720'
    + '  右边距 ' + String(-r.overflowRight).padStart(4) + 'px'
    + (issues.length ? '   ← ' + issues.join(' | ') : ''));
}
console.log(bad === 0 ? '\n全部通过。' : '\n有 ' + bad + ' 页需要修。');

/* 关键页截图, 人眼看一遍 */
const shots = process.argv[3] ? process.argv[3].split(',').map(Number) : [];
if (shots.length) {
  const outDir = path.join(path.dirname(SRC), '_校验截图');
  fs.mkdirSync(outDir, { recursive: true });
  for (const n of shots) {
    const out = path.join(outDir, 'p' + String(n).padStart(2, '0') + '.png');
    try {
      execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--window-size=1280,720', '--virtual-time-budget=4000',
        '--screenshot=' + out, 'file:///' + tmp.replace(/\\/g, '/') + '#p' + n], { stdio: 'ignore', timeout: 90000 });
      console.log('  截图 p' + n + ' → ' + path.basename(out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
    } catch (e) { console.log('  截图 p' + n + ' 失败: ' + e.message); }
  }
}
fs.unlinkSync(tmp);
