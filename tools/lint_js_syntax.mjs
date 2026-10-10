/* lint_js_syntax.mjs —— 全仓 .mjs/.js 语法自检
 *
 * 为什么要有这个: 2026-10-10 我在同一个文件里**连续三次**犯同一个错 ——
 * 在模板字符串里写反引号(`` ` ``)包住一段 HTML 示例, 反引号把模板字符串提前闭合了, 于是
 * `server/deckagent.mjs` 直接 SyntaxError。三次里有两次是靠"跑某个恰好 import 它的测试"才发现的。
 * 也就是说: 只要那次忘了跑那个测试, 一个语法坏掉的文件就会进分发包。
 *
 * 所以这里把"能不能解析"单独做成一条检查, 覆盖 server/ 与 tools/ 下所有 js/mjs,
 * 用 `node --check`(只解析、不执行)跑一遍。它不管逻辑, 只管"这个文件根本不是合法 JS"。
 *
 * 用法: node tools/lint_js_syntax.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIR = /[\\/](_dist|_runs|node_modules|skills)[\\/]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of ['server', 'tools', 'app', 'data']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, files);
}

const bad = [];
for (const f of files) {
  try {
    // --check = 只做语法解析。stdio 用 pipe(本机 danger-full-access 下可用; 受限模式下会 EPERM,
    // 那时改成 'inherit' 也只是少一层捕获, 不影响判断)
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    const out = String((e.stderr && e.stderr.toString()) || e.message).split('\n').slice(0, 6).join('\n      ');
    bad.push({ f: path.relative(ROOT, f), out });
  }
}

console.log(`语法自检: ${files.length} 个文件`);
if (bad.length) {
  for (const b of bad) console.log(`  FAIL  ${b.f}\n      ${b.out}`);
  console.log(`\n${bad.length} 个文件语法不合法。`);
  process.exit(1);
}
console.log('全部通过。');
