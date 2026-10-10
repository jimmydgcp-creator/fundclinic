/* 渲染验证: 把 T6 演示稿放进无头 Edge, ① 截图 ② 把计算样式写回 DOM 再 dump 出来。
 * 为什么要查"计算样式": 主题变量是内联的, 静态看 CSS 存在 ≠ 浏览器真的应用上了。
 * 用法: node tools/render_check.mjs <deck.html> */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('用法: node tools/render_check.mjs <deck.html>'); process.exit(1); }

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 Edge/Chrome'); process.exit(1); }
console.log('浏览器 ' + EDGE);

let html = fs.readFileSync(src, 'utf8');
/* 探针: 量「内容自然高度」而不是 scrollHeight。
   为什么: .slide 是 inset:0 铺满视口的绝对定位块, scrollHeight 只会等于"视口高"或"内容高"里的大者,
   视口一变数字就变, 拿来比两份稿子毫无意义(实测参考稿在这个指标下比新稿还"溢出")。
   真正要问的是: 内容放进 1280×720 的版面够不够 —— 所以直接量最后一个子元素的底边。 */
const probe = `
<div id="__diag" style="display:none"></div>
<script>
(function(){
  var cs = getComputedStyle(document.documentElement);
  var slides = document.querySelectorAll('section.slide');
  var DESIGN_H = 720, DESIGN_W = 1280;
  var rows = [];
  slides.forEach(function(s, i){
    var top = null, bottom = 0, buf = s.getBoundingClientRect();
    Array.prototype.forEach.call(s.children, function(c){
      var r = c.getBoundingClientRect();
      if (r.height < 1) return;
      var t = r.top - buf.top, b = r.bottom - buf.top;
      if (top === null || t < top) top = t;
      if (b > bottom) bottom = b;
    });
    rows.push({ page: i + 1, contentH: Math.round(bottom), padTop: Math.round(top === null ? 0 : top) });
  });
  var first = slides[0] ? slides[0].getBoundingClientRect() : {width:0,height:0};
  var notesEl = document.querySelector('section.slide .notes');
  document.getElementById('__diag').textContent = JSON.stringify({
    themeAttr: document.documentElement.getAttribute('data-theme'),
    varBg: cs.getPropertyValue('--bg').trim(),
    varText1: cs.getPropertyValue('--text-1').trim(),
    varAccent: cs.getPropertyValue('--accent').trim(),
    varRadius: cs.getPropertyValue('--radius').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    slideCount: slides.length,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    slideBox: Math.round(first.width) + 'x' + Math.round(first.height),
    notesDisplay: notesEl ? getComputedStyle(notesEl).display : '(无 .notes)',
    rows: rows,
    contentHeights: rows.map(function(r){ return r.contentH; }),
    maxContentH: Math.max.apply(null, rows.map(function(r){ return r.contentH; })),
    overDesign: rows.filter(function(r){ return r.contentH > DESIGN_H; }).map(function(r){ return r.page + ':' + r.contentH; }),
    DESIGN_H: DESIGN_H
  });
})();
</script>`;
/* 插到**最后一个** </body> 之前。
   坑: 内联的 runtime.js 里含 "</body>" 字面量(演讲者弹窗的 document.write 模板),
   用 replace('</body>') 会插进 script 内部, 直接把整个脚本弄成语法错误。 */
const at = html.lastIndexOf('</body>');
html = at >= 0 ? html.slice(0, at) + probe + '\n' + html.slice(at) : html + probe;
const tmp = path.join(path.dirname(path.resolve(src)), '.fc_render_probe_' + Date.now() + '.html');
fs.writeFileSync(tmp, html, 'utf8');

console.log('\n=== 计算样式 / 布局 ===');
const dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1280,720',
  '--virtual-time-budget=4000', '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = /<div id="__diag"[^>]*>([\s\S]*?)<\/div>/.exec(dom);
if (!m) { console.log('  (探针未返回, 可能脚本被拦截)'); }
else {
  const d = JSON.parse(m[1].replace(/&quot;/g, '"'));
  const ok = (b) => b ? '✓' : '✗';
  console.log('  ' + ok(!!d.varBg) + ' 主题变量 --bg        ' + (d.varBg || '(空! 主题未应用)'));
  console.log('  ' + ok(!!d.varText1) + ' 主题变量 --text-1    ' + (d.varText1 || '(空!)'));
  console.log('  ' + ok(!!d.varAccent) + ' 主题变量 --accent    ' + (d.varAccent || '(空!)'));
  console.log('  ' + ok(!!d.varRadius) + ' 主题变量 --radius    ' + (d.varRadius || '(空!)'));
  console.log('    html[data-theme]   ' + d.themeAttr);
  console.log('    视口 / 版面盒       ' + d.viewport + ' / ' + d.slideBox);
  console.log('    页数               ' + d.slideCount);
  console.log('  ' + ok(d.notesDisplay === 'none') + ' 讲者备注默认隐藏     display:' + d.notesDisplay);
  console.log('  ' + ok(d.overDesign.length === 0) + ' 内容超设计高度720   ' + (d.overDesign.length ? d.overDesign.join(', ') : '无'));
  console.log('    各页内容高度        ' + d.contentHeights.join(', ') + '  (设计高度 ' + d.DESIGN_H + ')');
  console.log('    最高一页            ' + d.maxContentH + 'px  → 版面利用率 ' + (d.maxContentH / 720 * 100).toFixed(0) + '%');
}

console.log('\n=== 截图 ===');
const png = path.resolve('_runs', '_render_' + path.basename(src, '.html') + '.png');
for (const [i, label] of [[1, 'slide1']]) {
  const out = png.replace(/\.png$/, '_' + label + '.png');
  try {
    execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=1280,720', '--virtual-time-budget=4000',
      '--screenshot=' + out, 'file:///' + tmp.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
    console.log('  ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
  } catch (e) { console.log('  截图失败: ' + e.message); }
}
fs.unlinkSync(tmp);
