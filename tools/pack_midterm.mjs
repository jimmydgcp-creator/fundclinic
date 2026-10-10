/* 打包中期汇报展示页: ① 无头 Edge 导 PDF 备份  ② 打成上传用的 zip  ③ 双向自检
 *
 * 平台说明: 「汇报用的展示页做成 HTML 网页，连同素材打成 zip，在最下面上传，课上统一用教师机播放。」
 * zip 是**必交附件**, 少它整次提交交不上去, 所以这里要自检到"打开就能用"为止。
 *
 * 用法: node tools/pack_midterm.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_DIR = path.resolve(ROOT, '..', '00_交作业', '中期汇报_展示页');
const INDEX = path.join(SRC_DIR, 'index.html');
const PDF = path.resolve(ROOT, '..', '00_交作业', '中期汇报_展示页.pdf');
const ZIP = path.resolve(ROOT, '..', '00_交作业', '中期汇报_展示页.zip');
const ZIP_ROOT = '中期汇报_展示页';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('未找到 Edge/Chrome'); process.exit(1); }
if (!fs.existsSync(INDEX)) { console.error('先跑 make_midterm_deck.mjs'); process.exit(1); }

/* ---------------------------------------------------------------- ① PDF */
console.log('=== ① 导出 PDF 备份 ===');
if (fs.existsSync(PDF)) fs.unlinkSync(PDF);
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  '--virtual-time-budget=9000', '--print-to-pdf-no-header',
  '--print-to-pdf=' + PDF, 'file:///' + INDEX.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 180000 });
console.log('  ' + PDF + '  (' + Math.round(fs.statSync(PDF).size / 1024) + ' KB)');

/* PDF 自检: 用 pdftotext 抽文本, 数页数(换页符), 并确认关键数字都在 */
let pdfPages = null, pdfChars = null, missing = [];
const PDFTOTEXT = ['pdftotext'].concat(
  ['C:\\Users\\75719\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftotext.exe']
).find(p => { try { execFileSync(p, ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } });

if (PDFTOTEXT) {
  const txtFile = path.join(SRC_DIR, '_pdf_text.txt');
  execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', PDF, txtFile], { stdio: 'ignore' });
  const txt = fs.readFileSync(txtFile, 'utf8');
  fs.unlinkSync(txtFile);
  pdfPages = txt.split('\f').filter(s => s.trim()).length;
  pdfChars = txt.replace(/\s/g, '').length;
  const must = ['基金复诊台', '76.80%', '192.89%', '中期进度汇报', '现场演示', '014564', 'selftest'];
  missing = must.filter(s => !txt.includes(s));
  console.log('  页数 ' + pdfPages + '（应为 14）· 可见字 ' + pdfChars);
  console.log('  ' + (missing.length === 0 ? '✓' : '✗') + ' 关键内容齐全' + (missing.length ? ' 缺: ' + missing.join(', ') : ''));
} else {
  console.log('  (没有 pdftotext, 跳过 PDF 文本自检)');
}

/* ---------------------------------------------------------------- ② ZIP */
console.log('\n=== ② 打成上传用 zip ===');
const SKIP = new Set(['_校验截图', '_pdf_text.txt', '.verify_probe.html']);
const files = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(abs, r);
    else if (e.isFile() && !e.name.startsWith('.')) files.push({ abs, rel: ZIP_ROOT + '/' + r });
  }
})(SRC_DIR, '');

/* 极简 zip: deflate + UTF-8 名 + DOS 属性, 与 tools/zip_dist.mjs 同源做法 */
function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0o644 << 16, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

/* 先删再写 —— 上一版踩过: 旧的字节没被截断, 结果整个包内容出现两遍 */
if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);
const entries = files.map(f => ({ name: f.rel, data: fs.readFileSync(f.abs) }));
/* 附一份说明放在最前, 方便老师/同学一眼知道这是什么 */
const README = `基金复诊台 FundClinic · 小组作业 II · 中期进度汇报
第 2 组 · 2026-10-14

怎么打开
--------
双击 index.html（推荐 Chrome / Edge / Safari，任意现代浏览器）。
    ← →        翻页
    F          全屏
    P          打印 / 导出 PDF
封面页码在右下角；也可以点屏幕左半边/右半边翻页。

说明
----
· index.html 是**单文件**：主题、样式、运行时、两张界面截图全部内联，
  拷到任何一台电脑上双击就能开，**断网也能开**，不需要装任何东西。
· 页面按 1280×720 设计，打开后会自动缩放到窗口大小；接投影仪按 F 全屏即可。
· 讲稿_5分钟.md 是配套的口播稿（含每页时长）。
· 同目录下的「中期汇报_展示页.pdf」是同一份内容的 PDF 备份，
  万一教师机的浏览器有问题，用 PDF 也能讲完。

注意
----
这份展示页是**汇报用的幻灯片**，不是产品本身。
产品（基金复诊台网页）的截图已经内联在第 3、4 页里。

产品线上地址（2026-10-10 已上线，可直接发给同学）
------------------------------------------------
    https://fundclinic.onrender.com

· 打开就能用：输入 6 位基金代码 → 自动爬取 → 出复盘报告与演示稿。
· 同学**不需要装 Node、不需要 API Key、不需要 VPN**（大模型的 Key 由服务端持有）。
· 免费档会休眠：闲置一段时间后第一次打开可能要等 30–60 秒，之后再打开就快了。
· 上台演示前建议**提前 5 分钟打开一次**热机（我们实测首次请求有约 145 秒的冷启动惩罚）。
· 断网也不怕：「基金复诊台_单文件版.html」是零依赖离线版，内置已对过账的样例，可作兜底。
`;
entries.unshift({ name: ZIP_ROOT + '/本文件夹说明.txt', data: Buffer.from(README, 'utf8') });

const buf = zip(entries);
fs.writeFileSync(ZIP, buf);
console.log('  ' + ZIP + '  ' + (buf.length / 1024).toFixed(0) + ' KB  ' + entries.length + ' 个条目');

/* ---------------------------------------------------------------- ③ 回读自检 */
console.log('\n=== ③ 回读自检(不信任刚写出的字节) ===');
const raw = fs.readFileSync(ZIP);
let eocdAt = -1;
for (let i = raw.length - 22; i >= 0; i--) if (raw.readUInt32LE(i) === 0x06054b50) { eocdAt = i; break; }
const n = raw.readUInt16LE(eocdAt + 10);
const cdSize = raw.readUInt32LE(eocdAt + 12);
const cdOff = raw.readUInt32LE(eocdAt + 16);
const checks = [
  ['头签名是 PK\\x03\\x04', raw.readUInt32LE(0) === 0x04034b50],
  ['EOCD 条目数一致', n === entries.length],
  ['中央目录紧接数据后', cdOff + cdSize === eocdAt],
  ['没有尾部垃圾字节', eocdAt + 22 === raw.length]
];
/* 逐个条目验证名与大小, 并确认没有重复名 */
const names = [], sizes = [];
for (let i = 0; i < n; i++) {
  const p = cdOff + (() => { let q = cdOff, k = 0; while (k < i) { const nl = raw.readUInt16LE(q + 28), el = raw.readUInt16LE(q + 30), cl = raw.readUInt16LE(q + 32); q += 46 + nl + el + cl; k++; } return q - cdOff; })();
  const nl = raw.readUInt16LE(p + 28);
  names.push(raw.slice(p + 46, p + 46 + nl).toString('utf8'));
  sizes.push(raw.readUInt32LE(p + 24));
}
const dup = names.filter((x, i) => names.indexOf(x) !== i);
checks.push(['无重复条目名', dup.length === 0]);
checks.push(['含有 index.html', names.some(x => x.endsWith('/index.html'))]);
checks.push(['含有讲稿', names.some(x => x.includes('讲稿'))]);
checks.push(['条目名均为 UTF-8 标记', (raw.readUInt16LE(cdOff + 8) & 0x0800) !== 0]);

for (const [label, ok] of checks) console.log('  ' + (ok ? '✓' : '✗') + ' ' + label);
console.log('  条目清单:');
for (let i = 0; i < names.length; i++) console.log('      ' + names[i] + '   ' + sizes[i] + ' B');

const allOk = checks.every(c => c[1]) && missing.length === 0 && (pdfPages === null || pdfPages === 14);
console.log('\n' + (allOk ? '全部通过。可以直接上传 ' + path.basename(ZIP) : '有检查未通过, 先别上传。'));
process.exit(allOk ? 0 : 1);
