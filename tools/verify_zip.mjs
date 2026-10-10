/* 校验 zip: ① 能被标准工具读 ② .command 的可执行位真的在中央目录里 ③ 中文名标记了 UTF-8 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const zip = process.argv[2] || path.join(path.resolve(HERE, '..'), '_dist', '基金复诊台_发给组员.zip');
const buf = fs.readFileSync(zip);

/* 从尾部找 EOCD */
let p = buf.length - 22;
while (p >= 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
if (p < 0) { console.error('!! 找不到 EOCD, zip 坏了'); process.exit(1); }
const n = buf.readUInt16LE(p + 10);
const cdOff = buf.readUInt32LE(p + 16);
const cdSize = buf.readUInt32LE(p + 12);
console.log('zip: ' + zip);
console.log('  EOCD 位置 ' + p + ' · 条目 ' + n + ' · 中央目录 ' + cdOff + '~' + (cdOff + cdSize) + ' (' + cdSize + ' 字节)');

let q = cdOff, utf8Count = 0, execs = [], dirs = 0;
for (let i = 0; i < n; i++) {
  if (buf.readUInt32LE(q) !== 0x02014b50) { console.error('!! 第 ' + i + ' 个中央目录项签名不对'); process.exit(1); }
  const madeBy = buf.readUInt16LE(q + 4);
  const flags = buf.readUInt16LE(q + 8);
  const nameLen = buf.readUInt16LE(q + 28);
  const extLen = buf.readUInt16LE(q + 30);
  const cmtLen = buf.readUInt16LE(q + 32);
  const extAttr = buf.readUInt32LE(q + 38);
  const name = buf.subarray(q + 46, q + 46 + nameLen).toString('utf8');
  if (flags & 0x0800) utf8Count++;
  const hostOs = madeBy >> 8;
  const mode = (extAttr >>> 16) & 0xffff;
  if (name.endsWith('/')) dirs++;
  if (/\.(command|sh|bash)$/i.test(name)) execs.push({ name, mode: mode.toString(8), hostOs });
  q += 46 + nameLen + extLen + cmtLen;
}

console.log('  UTF-8 文件名标记  ' + utf8Count + '/' + n + (utf8Count === n ? ' ✓ 全部' : '  (部分未标记)'));
console.log('  目录条目          ' + dirs);
console.log('  Unix 宿主标记     ' + ((buf.readUInt16LE(cdOff + 4) >> 8) === 3 ? '✓ (3 = Unix)' : '✗'));

console.log('\n  可执行文件:');
if (!execs.length) console.log('    (无)');
for (const e of execs) {
  const ok = e.mode === '755';
  console.log('    ' + (ok ? '✓' : '✗') + ' ' + e.name + '  权限 ' + e.mode + (ok ? '  ← macOS 双击可用' : '  ← 不是 755, macOS 会拒绝执行'));
}

/* 中文名抽查 */
console.log('\n  中文文件名抽查:');
let shown = 0;
q = cdOff;
for (let i = 0; i < n && shown < 6; i++) {
  const nameLen = buf.readUInt16LE(q + 28), extLen = buf.readUInt16LE(q + 30), cmtLen = buf.readUInt16LE(q + 32);
  const name = buf.subarray(q + 46, q + 46 + nameLen).toString('utf8');
  if (/[\u4e00-\u9fa5]/.test(name)) { console.log('    ' + name); shown++; }
  q += 46 + nameLen + extLen + cmtLen;
}
