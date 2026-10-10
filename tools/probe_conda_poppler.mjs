/* 直接下 conda-forge 的 osx-arm64 poppler 包, 解开看里面到到底有没有 pdftotext。
 *
 * 为什么不靠"配方测试命令"推断: 组员的整条路都押在"conda 装完能用"上,
 * 值得花两分钟拿实物验证, 而不是从旁证推断。
 *
 * .conda 格式: 就是一个 zip, 里面装着两个 zstd 压缩的 tar:
 *   pkg-<name>-<ver>-<build>.tar.zst    实际文件
 *   info-<name>-<ver>-<build>.tar.zst   元数据, 其中 info/files 是完整文件清单
 * Node 24 自带 zstd(zlib.zstdDecompressSync), 所以不需要任何依赖。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '_probe');
fs.mkdirSync(TMP, { recursive: true });

const TARGETS = [
  ['osx-arm64', 'poppler-26.09.0-hb6e6627_0.conda'],
  ['osx-64', 'poppler-26.09.0-hb8a767d_0.conda']
];

console.log('Node ' + process.version + ' · zstd 支持: ' + (typeof zlib.zstdDecompressSync === 'function' ? '有 ✓' : '没有 ✗'));
if (typeof zlib.zstdDecompressSync !== 'function') process.exit(1);

/* 极简 tar 解析: 只需要把文件名和内容读出来 */
function readTar(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = buf.subarray(off + 124, off + 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = buf[off + 156];
    const data = buf.subarray(off + 512, off + 512 + size);
    out.push({ name, size, type, data });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/* 从 zip 里抠出某类条目 —— 不引入 zip 库, 自己扫本地文件头 */
function zipEntries(buf) {
  const out = [];
  let i = 0;
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i)) >= 0) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart = i + 30 + nameLen + extraLen;
    if (compSize > 0) {
      const raw = buf.subarray(dataStart, dataStart + compSize);
      out.push({ name, method, raw });
      i = dataStart + compSize;
    } else {
      i = dataStart;
    }
  }
  return out;
}

for (const [plat, file] of TARGETS) {
  const url = `https://anaconda.org/conda-forge/poppler/26.09.0/download/${plat}/${file}`;
  console.log('\n' + '='.repeat(70));
  console.log(plat + '  ' + file);
  console.log('='.repeat(70));
  let buf;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) { console.log('  下载失败 HTTP ' + r.status); continue; }
    buf = Buffer.from(await r.arrayBuffer());
    console.log('  下载 ' + (buf.length / 1024 / 1024).toFixed(2) + ' MB');
  } catch (e) { console.log('  下载异常: ' + e.message); continue; }

  const entries = zipEntries(buf);
  console.log('  zip 内条目: ' + entries.map(e => e.name).join(', '));

  /* 新版 .conda 里只有 metadata.json + pkg-*.tar.zst —— info/ 也打在同一个 tar 里,
     所以直接解 pkg 那个就行。 */
  const tarEntry = entries.find(e => /^pkg-.*\.tar\.zst$/.test(e.name)) || entries.find(e => /\.tar\.zst$/.test(e.name));
  if (!tarEntry) { console.log('  找不到 *.tar.zst'); continue; }

  let tarBuf;
  try {
    const decomp = tarEntry.method === 0 ? tarEntry.raw : zlib.inflateRawSync(tarEntry.raw);
    tarBuf = zlib.zstdDecompressSync(decomp);
  } catch (e) { console.log('  解压失败: ' + e.message); continue; }

  const tarFiles = readTar(tarBuf);
  /* 不走 info/files 清单, 直接把 tar 里所有条目名扫一遍 —— 更直接也更可靠 */
  const filesEntry = tarFiles.find(f => /(^|\/|\b)info\/files$/.test(f.name));
  const list = filesEntry ? filesEntry.data.toString('utf8').split('\n').map(s => s.trim()).filter(Boolean) : null;
  const names = list || tarFiles.map(f => f.name.replace(/^\.\//, '')).filter(n => n && !/@PaxHeader/.test(n));
  console.log('  包内条目总数: ' + names.length + (list ? ' (来自 info/files)' : ' (直接扫 tar)'));

  const bins = names.filter(f => f.includes('/bin/') || /^bin\//.test(f));
  console.log('\n  --- 该包提供的命令行工具 / bin 目录内容 ---');
  if (bins.length) bins.forEach(b => console.log('      ' + b));
  else console.log('      (tar 里没有 bin/ 条目 —— 注意: 新版 conda 包可能把路径信息放在别处)');

  /* 也扫一下 man 手册 —— 有 man 页就说明那个工具确实被装了 */
  const mans = names.filter(f => /man1\/pdf/i.test(f));
  if (mans.length) {
    console.log('\n  --- man 手册(能间接证明工具已安装) ---');
    mans.forEach(m => console.log('      ' + m));
  }

  const hasPdftotext = names.some(f => /(^|\/)pdftotext(\.1)?$/.test(f) || /pdftotext/.test(f));
  console.log('\n  >>> 包内出现 pdftotext: ' + (hasPdftotext ? '✓ 有' : '✗ 没有'));
  const hits = names.filter(f => /pdftotext/i.test(f));
  if (hits.length) hits.forEach(h => console.log('      ' + h));
  else console.log('      名字相近的: ' + (names.filter(f => /pdfto|pdfinfo|pdfimages|pdftoppm/i.test(f)).join(', ') || '(无)'));
}

fs.rmSync(TMP, { recursive: true, force: true });
