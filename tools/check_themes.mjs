/* 主题系统校验: 换肤是不是真的换了, 以及有没有哪套主题把文字变成"看不见"。
 *
 * 为什么要机器验: 我看不到截图。上一份交付物就是"看着没问题、实际丢字"。
 * 这里对每套主题做两件事:
 *   ① 读出该主题实际生效的 CSS 变量(确认变量真的被切换, 而不是某些元素写死了颜色);
 *   ② 逐元素算前景/背景对比度, 抓出任何"文字与背景几乎同色"的元素。
 *
 * 用法: node tools/check_themes.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const deckArg = process.argv[2];
const deckPath = deckArg
  ? path.resolve(deckArg)
  : (() => {
    const dir = path.join(ROOT, '_runs', '519191');
    const f = fs.readdirSync(dir).find(x => /^演示稿_.*\.html$/.test(x));
    return path.join(dir, f);
  })();

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 msedge.exe'); process.exit(1); }
if (!fs.existsSync(deckPath)) { console.error('找不到演示稿: ' + deckPath); process.exit(1); }

const html = fs.readFileSync(deckPath, 'utf8');
const themeIds = [...html.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]);
console.log('演示稿: ' + path.basename(deckPath));
console.log('主题:   ' + themeIds.join(', ') + '\n');

/* 注入审计脚本: 逐主题切换 -> 读变量 -> 逐元素算对比度 */
const AUDIT = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    function lum(c) {
      var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(c);
      if (!m) return null;
      if (m[4] !== undefined && +m[4] < 0.95) return null;   // 半透明背景不参与判断
      var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
    }
    function bgOf(el) {
      var p = el;
      while (p && p !== document.documentElement) {
        var c = getComputedStyle(p).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        p = p.parentElement;
      }
      return 'rgb(255,255,255)';
    }
    var out = { themes: {}, pages: 0 };
    var slides = document.querySelectorAll('.slide');
    out.pages = slides.length;

    var ids = ${JSON.stringify(themeIds)};
    ids.forEach(function (id) {
      document.documentElement.setAttribute('data-theme', id);
      void document.body.offsetHeight;
      var cs = getComputedStyle(document.documentElement);
      var v = function (n) { return cs.getPropertyValue(n).trim(); };
      var rec = { accent: v('--accent'), slideBg: v('--slide-bg'), text1: v('--text-1'), font: v('--font-sans').slice(0, 28) };

      /* 不光看变量, 还读"实际视觉元素"的计算样式 —— 变量切了但元素写死了颜色, 换肤照样不生效 */
      var h2 = document.querySelector('.slide h2');
      /* 注意: 必须取"非负"的柱子 —— .bar.neg 用的是纯色 var(--bad), 它的 background-image 本来就是 none。
         取错元素会误判成"换肤不生效"(实测踩过)。 */
      var bar = document.querySelector('.bar:not(.neg)');
      var card = document.querySelector('.slide .card');
      var chip = document.querySelector('.chip');
      var tag = document.querySelector('.tag');
      var th = document.querySelector('.slide th');
      rec.computed = {
        slideBg: getComputedStyle(document.querySelector('.slide')).backgroundColor,
        h2Border: h2 ? getComputedStyle(h2).borderBottomColor : null,
        barFill: bar ? getComputedStyle(bar).backgroundImage : null,
        cardBorder: card ? getComputedStyle(card).borderTopColor : null,
        cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : null,
        chipBg: chip ? getComputedStyle(chip).backgroundImage : null,
        tagBorder: tag ? getComputedStyle(tag).borderTopColor : null,
        thBg: th ? getComputedStyle(th).backgroundColor : null,
        bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 40)
      };

      var low = [], checked = 0;
      slides.forEach(function (s) {
        s.querySelectorAll('*').forEach(function (el) {
          if (el.children.length) return;
          var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent.trim(); }).join('');
          if (!own) return;
          var st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') return;
          var fgL = lum(st.color), bgL = lum(bgOf(el));
          if (fgL === null || bgL === null) return;
          checked++;
          var ratio = (Math.max(fgL, bgL) + 0.05) / (Math.min(fgL, bgL) + 0.05);
          if (ratio < 1.8) low.push({ t: own.slice(0, 22), ratio: Math.round(ratio * 100) / 100, color: st.color, bg: bgOf(el) });
        });
      });
      rec.checked = checked;
      rec.lowContrast = low;
      out.themes[id] = rec;
    });
    document.documentElement.setAttribute('data-theme', '${themeIds[0]}');
    var pre = document.createElement('pre');
    pre.id = 'THEME_AUDIT';
    pre.textContent = JSON.stringify(out, null, 1);
    document.body.appendChild(pre);
  }, 400);
});
</script>
`;

const tmp = path.join(ROOT, '_theme_audit_tmp.html');
fs.writeFileSync(tmp, html.replace('</body>', AUDIT + '</body>'), 'utf8');

let dom;
try {
  dom = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + path.join(os.tmpdir(), 'fc-theme-audit'),
    '--virtual-time-budget=20000', '--window-size=1440,1200', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}

const m = /<pre id="THEME_AUDIT">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.error('未拿到主题审计结果(页面可能报错)'); process.exit(1); }
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const res = JSON.parse(unesc(m[1]));
fs.writeFileSync(path.join(ROOT, 'tools', '_smoke', 'theme_audit.json'), JSON.stringify(res, null, 2), 'utf8');

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('=== A. 逐主题是否真的切换了 ===');
const accents = new Set(), slideBgs = new Set(), h2b = new Set(), barFills = new Set(), radii = new Set(), fonts = new Set();
Object.entries(res.themes).forEach(([id, r]) => {
  accents.add(r.accent); slideBgs.add(r.slideBg);
  h2b.add(r.computed.h2Border); barFills.add(r.computed.barFill);
  radii.add(r.computed.cardRadius); fonts.add(r.computed.bodyFont);
  console.log(`  ${id.padEnd(20)} accent=${String(r.accent).padEnd(9)} 纸面=${String(r.slideBg).padEnd(9)} h2下边框=${String(r.computed.h2Border).padEnd(20)} 柱=${String(r.computed.barFill).slice(0, 46)}`);
});
ok(accents.size >= 5, 'accent 各不相同', accents.size + ' 种');
ok(slideBgs.size >= 5, '幻灯片纸面底色各不相同', slideBgs.size + ' 种');
ok(h2b.size >= 5, '标题下边框(实测计算样式)随主题变化', h2b.size + ' 种');
ok(barFills.size >= 5, '柱状图填充(实测计算样式)随主题变化', barFills.size + ' 种');
ok(radii.size >= 3, '圆角随主题变化', [...radii].join(' / '));
ok(fonts.size >= 2, '字体栈随主题变化(衬线/黑体)', fonts.size + ' 种');

console.log('\n=== B. 文字可见性(每套主题) ===');
let totalLow = 0;
Object.entries(res.themes).forEach(([id, r]) => {
  totalLow += r.lowContrast.length;
  ok(r.lowContrast.length === 0, `${id} 无"文字与背景同色"`,
    r.lowContrast.length ? r.lowContrast.slice(0, 3).map(x => `«${x.t}» 对比度${x.ratio} (${x.color} on ${x.bg})`).join(' | ') : `对比度全部 ≥1.8(${r.checked} 处)`);
});

console.log('\n=== C. 结构 ===');
ok(res.pages >= 8, '幻灯片数量 ≥8', String(res.pages));
ok(Object.keys(res.themes).length === themeIds.length, '每套主题都测到了', Object.keys(res.themes).length + '/' + themeIds.length);

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项(共 ${totalLow} 处低对比度)` : `全部通过 —— ${themeIds.length} 套主题都能正常换肤且文字均可见。`);
console.log('明细: tools/_smoke/theme_audit.json');
if (fail) process.exitCode = 1;
