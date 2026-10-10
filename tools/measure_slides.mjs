/* 量每张幻灯片的实际内容高度: 超过 720px 就会溢出(屏幕上被裁、打印多出一页、数字丢失)。
 * 用法: node tools/measure_slides.mjs [演示稿路径]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const deck = process.argv[2] || path.join(ROOT, '_runs', '519191',
  fs.readdirSync(path.join(ROOT, '_runs', '519191')).find(f => /^演示稿_.*\.html$/.test(f)));

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe'); process.exit(1); }

const AUDIT = `<script>
window.addEventListener('load',function(){setTimeout(function(){
  var out=[];
  document.querySelectorAll('.slide').forEach(function(s,i){
    var kids=[].slice.call(s.children);
    var used=0; kids.forEach(function(k){ var r=k.getBoundingClientRect(); used+=r.height; });
    var cs=getComputedStyle(s);
    var pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
    out.push({page:i+1, box:s.getBoundingClientRect().height, scrollH:s.scrollHeight, contentH:Math.round(used+pad),
      over:Math.round(used+pad-720),
      parts:kids.map(function(k){return (k.className||k.tagName)+':'+Math.round(k.getBoundingClientRect().height);})});
  });
  var pre=document.createElement('pre'); pre.id='MV'; pre.textContent=JSON.stringify(out);
  document.body.appendChild(pre);
},500);});
</script>`;

const tmp = path.join(ROOT, '_measure_tmp.html');
fs.writeFileSync(tmp, fs.readFileSync(deck, 'utf8').replace('</body>', AUDIT + '</body>'), 'utf8');
let dom;
try {
  dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + path.join(os.tmpdir(), 'fc-measure'), '--virtual-time-budget=15000',
    '--window-size=1440,1200', '--dump-dom', pathToFileURL(tmp).href],
    { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} finally { try { fs.unlinkSync(tmp); } catch (e) {} }

const m = /<pre id="MV">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.error('未取到测量结果'); process.exit(1); }
const rows = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
let over = 0;
console.log('幻灯片内容高度测量(容器固定 720px)');
rows.forEach(r => {
  const flag = r.contentH > 720 ? '  ← 溢出 ' + r.over + 'px' : '';
  if (r.contentH > 720) over++;
  console.log(`  第 ${String(r.page).padStart(2)} 页  内容 ${String(r.contentH).padStart(4)}px${flag}`);
  if (r.contentH > 720) console.log('          构成: ' + r.parts.join('  '));
});
console.log('\n' + (over ? over + ' 张溢出 —— 必须减内容或调间距' : '全部在 720px 内 ✓'));
if (over) process.exitCode = 1;
