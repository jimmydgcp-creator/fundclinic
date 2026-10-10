/* lint_print_safety.mjs —— 拦"看起来正常、导出 PDF 却没字"的那一类问题
 *
 * 背景: 这个项目栽过两次, 成因是同一条:
 *   关键帧从 opacity:0 起步、规则里又带 `animation: … both`(或 forwards), 于是打印/导 PDF 时
 *   动画不运行, 元素永久停在初始态。实测过一次: 导出的 PDF 有 11 页, 一个字都没有。
 *   还有 `-webkit-text-fill-color: transparent`(渐变字)在 PDF 里渲染成空白,
 *   以及 max-height + overflow 的滚动容器打印时把后面内容整段裁掉。
 *
 * 2026-10-10 两处修正:
 *   ① **原来漏扫了嵌套目录** —— SCAN_DIRS 用的是 readdirSync 只读一层, 于是
 *      skills/html-ppt/assets/animations/animations.css 从来没被扫过。而那里面恰好有一条
 *      `.anim-stagger-list > *{opacity:0;animation:kf-rise … both}` —— 它是**每一份生成的
 *      单文件演示稿都会内联进去**的规则。也就是说: 这个 lint 一直在报"没问题", 但每份演示稿
 *      都带着一个打印会丢内容的规则。改成递归扫描。
 *   ② **原来只要见到 fill-mode 就报警**, 这条太粗: `.anim-rise-in{animation:…both}` 这种
 *      规则**自身不设 opacity:0**(初始态写在 keyframes 的 from 里), 没跑动画时元素是可见的,
 *      是安全的。真正危险的是"**同一条规则里既写 opacity:0, 又写带 fill-mode 的动画**"。
 *      现在按这个更准的特征判, 并进一步要求: 这类危险规则必须在本文件的 @media print 里
 *      被 `opacity:1!important` 顶回来 —— 光关掉动画不管 opacity 才是最致命的组合。
 *
 * 用法: node tools/lint_print_safety.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIR = /[\\/](_dist|_runs|node_modules)[\\/]/;

const problems = [];
const stats = { files: 0, safeFillMode: 0 };

/** 取所有"声明块"。`[^{}]+` 不能跨 `{`, 所以嵌套在 @media 里的规则也能被正确取到;
 *  而 @media 本身那层因为 body 含 `{` 不会被匹配 —— 正是我们要的。 */
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
    line: (css.slice(0, m.index).match(/\n/g) || []).length + 1
  }));
}

/** 取所有 @media print 块(按花括号配平) */
function printBlocks(css) {
  const out = [];
  const re = /@media[^{]*print[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1; let i = re.lastIndex;
    while (i < css.length && depth) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(m.index, i));
  }
  return out;
}

const FILL = /animation(?:-fill-mode)?\s*:[^;}]*\b(both|forwards|backwards)\b/;

function checkCss(rel, css) {
  const prints = printBlocks(css).join('\n');
  const printResetsOpacity = /opacity\s*:\s*1\s*!important/.test(prints);

  for (const r of rules(css)) {
    const hasFill = FILL.test(r.body);
    const startsHidden = /(^|;)\s*opacity\s*:\s*0(?:[;\s]|$)/.test(r.body) || /visibility\s*:\s*hidden/.test(r.body);

    if (hasFill && !startsHidden) { stats.safeFillMode++; continue; }   // 初始态在 keyframes 里, 安全

    if (hasFill && startsHidden) {
      // 危险: 基础态不可见 + 靠动画抬起来。必须在打印里复位。
      const neutral = printResetsOpacity && (
        prints.includes(r.selector) ||
        /\[class\*="anim-"\]/.test(prints) ||
        r.selector.split(/[\s,>+~]+/).some(t => t.startsWith('.') && prints.includes(t))
      );
      if (!neutral) {
        problems.push({
          rel, n: r.line, kind: '基础态不可见 + fill-mode 动画(打印未复位)', text: r.selector,
          why: '打印时动画不运行 → 元素停在 opacity:0 → 导出 PDF 整块内容消失'
        });
      }
    }

    if (/-webkit-text-fill-color\s*:\s*transparent/.test(r.body)) {
      // 渐变字: 打印里必须回落成实色(-webkit-text-fill-color 设成非 transparent 即可)
      const gradNeutral = /-webkit-text-fill-color\s*:\s*(?!transparent)/.test(prints) && (
        prints.includes(r.selector) ||
        r.selector.split(/[\s,>+~]+/).some(t => t.startsWith('.') && prints.includes(t))
      );
      if (!gradNeutral) {
        problems.push({ rel, n: r.line, kind: '渐变字(打印未回落为实色)', text: r.selector, why: 'PDF 里渲染成空白' });
      }
    }
  }

  // 滚动容器: 打印块里必须放开(max-height:none)或干脆隐藏
  const scrollables = [...css.matchAll(/\.([a-zA-Z][\w-]*)\s*\{[^}]*max-height:[^}]*overflow:\s*(auto|scroll|hidden)/g)];
  for (const m of scrollables) {
    const cls = m[1];
    const opened = new RegExp('\\.' + cls + '[^{]*\\{[^}]*max-height:\\s*none').test(prints);
    const hidden = new RegExp('\\.' + cls + '[^{]*\\{[^}]*display:\\s*none').test(prints);
    if (opened || hidden) continue;
    problems.push({
      rel, n: (css.slice(0, m.index).match(/\n/g) || []).length + 1, kind: '滚动容器未在打印时放开',
      text: '.' + cls, why: '打印时会被裁掉后面的内容(或应直接隐藏)'
    });
  }
}

/* 递归收集所有 css + 内联 <style> 的 html(单文件版是把它们拼起来的) */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of ['app', 'skills']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, files);
}
for (const rel of ['index.html']) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) files.push(abs);
}

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  if (/\.html$/.test(f)) checkCss(rel, [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'));
  else checkCss(rel, src);
  stats.files++;
}

console.log(`扫描 ${stats.files} 个样式来源(${stats.safeFillMode} 条 fill-mode 动画判定为安全: 初始态写在 keyframes 里)`);
if (!problems.length) {
  console.log('\n  ✓ 没有打印安全隐患(基础态不可见 / 渐变字 / 未放开的滚动容器)');
  process.exit(0);
}
console.log(`\n  ✗ 发现 ${problems.length} 处:\n`);
for (const p of problems) {
  console.log(`  [${p.kind}] ${p.rel}:${p.n}`);
  console.log(`      ${p.text}`);
  console.log(`      后果: ${p.why}\n`);
}
process.exit(1);
