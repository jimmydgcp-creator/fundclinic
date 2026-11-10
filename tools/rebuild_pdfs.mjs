/* 重新打印 519191 的两份演示稿 PDF(模板版 / 深度版)。
 * 生成方式与 pipeline 一致: 无头 Edge 的 --print-to-pdf, 不加页眉页脚。
 * 用法: node tools/rebuild_pdfs.mjs [基金代码]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = (process.argv.slice(2).find(a => /^\d{6}$/.test(a))) || '519191';
const DIR = path.join(ROOT, '_runs', code);
const NAME = '万家新利灵活配置混合';

function findEdge() {
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].find(p => fs.existsSync(p)) || null;
}

const edge = findEdge();
if (!edge) { console.error('未找到 Edge/Chrome, 跳过打印'); process.exit(1); }

const jobs = [
  ['演示稿_' + NAME + '_' + code + '.html', '演示稿_' + NAME + '_' + code + '.pdf'],
  ['演示稿_' + NAME + '_' + code + '_深度版.html', '演示稿_' + NAME + '_' + code + '_深度版.pdf']
];
for (const [srcName, outName] of jobs) {
  const src = path.join(DIR, srcName);
  const out = path.join(DIR, outName);
  if (!fs.existsSync(src)) { console.log('  跳过(没有源文件) ' + srcName); continue; }
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + path.join(os.tmpdir(), 'fc-deck-pdf'),
    '--virtual-time-budget=15000', '--no-pdf-header-footer', '--print-to-pdf-no-header',
    '--print-to-pdf=' + out,
    'file:///' + src.replace(/\\/g, '/')
  ], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000 });
  const kb = fs.existsSync(out) ? (fs.statSync(out).size / 1024).toFixed(0) + ' KB' : '失败';
  console.log('  ' + outName + '  ' + kb);
}
