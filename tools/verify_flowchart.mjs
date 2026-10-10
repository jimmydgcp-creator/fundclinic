/* 渲染验证流程图: 用无头 Edge 把 SVG 载入, 量每个 <text> 的实际包围盒,
 * 查三件事 —— ①有没有超出画布 ②有没有文字压到别的文字 ③有没有文字超出所在色块。
 * 另外导出一张 PNG, 方便插进 Word / PPT。
 *
 * 用法: node tools/verify_flowchart.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.resolve(ROOT, '..', '00_交作业');
const SVG = path.join(DIR, '基金复诊台_网页流程图.svg');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('没找到 Edge'); process.exit(1); }

const svg = fs.readFileSync(SVG, 'utf8');
const W = Number(/width="(\d+)"/.exec(svg)[1]);
const H = Number(/height="(\d+)"/.exec(svg)[1]);

/* 包一层 HTML, 探针写在最后(不能用 </body> 定位, 之前踩过) */
const probe = `
<div id="__diag" style="display:none"></div>
<script>
(function(){
  var svg = document.querySelector('svg');
  var rects = svg.querySelectorAll('rect[polygon], rect, polygon');
  var texts = Array.prototype.slice.call(svg.querySelectorAll('text'));
  function bb(el){ var b = el.getBBox(); return {x:b.x, y:b.y, w:b.width, h:b.height, t:(el.textContent||'').trim()}; }
  var out = texts.map(bb);
  var canvasX = ${W}, canvasY = ${H};
  var outside = out.filter(function(b){ return b.x < 0 || b.y < 0 || b.x + b.w > canvasX || b.y + b.h > canvasY; });
  // 文字互相重叠(留 1px 容差)
  var overlaps = [];
  for (var i=0;i<out.length;i++) for (var j=i+1;j<out.length;j++){
    var a=out[i], b=out[j];
    var ox = Math.min(a.x+a.w,b.x+b.w) - Math.max(a.x,b.x);
    var oy = Math.min(a.y+a.h,b.y+b.h) - Math.max(a.y,b.y);
    if (ox > 1 && oy > 1) overlaps.push(a.t.slice(0,18) + ' ⨯ ' + b.t.slice(0,18));
  }
  document.getElementById('__diag').textContent = JSON.stringify({
    textCount: out.length, rectCount: rects.length,
    outside: outside.map(function(b){ return b.t.slice(0,20) + ' @' + Math.round(b.x) + ',' + Math.round(b.y); }),
    overlaps: overlaps.slice(0, 12), overlapCount: overlaps.length,
    maxRight: Math.round(Math.max.apply(null, out.map(function(b){ return b.x+b.w; }))),
    maxBottom: Math.round(Math.max.apply(null, out.map(function(b){ return b.y+b.h; }))),
    canvas: canvasX + 'x' + canvasY
  });
})();
</script>`;

const tmp = path.join(DIR, '.fc_svg_probe.html');
fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}${probe}`, 'utf8');

const dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=' + (W + 80) + ',' + Math.min(H + 80, 4000),
  '--virtual-time-budget=5000', '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 1 << 28 });

const m = /<div id="__diag"[^>]*>([\s\S]*?)<\/div>/.exec(dom);
if (!m) { console.log('探针没返回'); }
else {
  const d = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  console.log('画布        ' + d.canvas);
  console.log('文字块      ' + d.textCount + ' 个 · 色块/箭头容器 ' + d.rectCount + ' 个');
  console.log('内容右下角  ' + d.maxRight + ', ' + d.maxBottom);
  console.log('超出画布    ' + (d.outside.length ? '✗ ' + d.outside.join(' | ') : '✓ 无'));
  console.log('文字重叠    ' + (d.overlapCount ? '✗ ' + d.overlapCount + ' 处: ' + d.overlaps.join(' | ') : '✓ 无'));
  console.log('垂直溢出    ' + (d.maxBottom > H ? '✗ 底部超出 ' + (d.maxBottom - H) + 'px' : '✓ 在画布内'));
}

/* 导出 PNG */
const png = path.join(DIR, '基金复诊台_网页流程图.png');
try {
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + W + ',' + Math.min(H, 4000),
    '--virtual-time-budget=5000', '--screenshot=' + png,
    'file:///' + tmp.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 90000 });
  const sz = fs.statSync(png).size;
  console.log('\nPNG 导出    ' + png + '  ' + (sz / 1024).toFixed(0) + ' KB'
    + (sz > 20000 ? '  ✓ 内容充实(不是空白)' : '  ✗ 疑似空白'));
} catch (e) { console.log('\nPNG 导出失败: ' + e.message); }

fs.unlinkSync(tmp);
