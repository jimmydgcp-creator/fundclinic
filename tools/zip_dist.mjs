/* 打 zip —— 自己写, 为了三件 PowerShell 的 Compress-Archive 做不到的事:
 *
 *   1) **保留可执行位**。macOS 上 .command 没有 755 就没法双击(macOS 会提示
 *      "无法执行该文件")。Compress-Archive 是 .NET 在 Windows 上跑的, 不写 Unix 权限,
 *      解压出来一律 644 —— 组员是 Mac, 这一条直接决定能不能用。
 *   2) **文件名标记 UTF-8**。包里全是中文名, 不设 general purpose bit 11 的话,
 *      在某些解压工具下会变乱码。
 *   3) 目录条目要保留(macOS 的解压工具对缺失目录的包处理不一致)。
 *
 * zip 结构: [本地文件头+数据]* [中央目录]* [中央目录结束记录]
 *
 * 用法: node tools/zip_dist.mjs [源目录] [输出zip]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = process.argv[2] || path.join(ROOT, '_dist', '基金复诊台_发给组员');
const OUT = process.argv[3] || path.join(ROOT, '_dist', '基金复诊台_发给组员.zip');

/* 需要可执行位的扩展名 —— 少了它 macOS 双击没反应 */
const EXEC_EXT = /\.(command|sh|bash)$/i;
const MODE_FILE = 0o644, MODE_EXEC = 0o755, MODE_DIR = 0o40755;

function dosTime(d) {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xffff;
  const dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { t, dt };
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      out.push({ rel: rel + '/', dir: true, full });
      out.push(...walk(full, rel));
    } else {
      out.push({ rel, dir: false, full });
    }
  }
  return out;
}

const entries = walk(SRC);
const chunks = [];
const central = [];
let offset = 0;

for (const e of entries) {
  const nameBuf = Buffer.from(e.rel, 'utf8');
  const st = fs.statSync(e.full);
  const { t, dt } = dosTime(st.mtime);
  const mode = e.dir ? MODE_DIR : (EXEC_EXT.test(e.rel) ? MODE_EXEC : MODE_FILE);
  const isExec = !e.dir && EXEC_EXT.test(e.rel);

  let data = Buffer.alloc(0);
  let method = 0, comp = Buffer.alloc(0);
  if (!e.dir) {
    data = fs.readFileSync(e.full);
    comp = zlib.deflateRawSync(data, { level: 9 });
    /* 压不动就用 store —— 小文件上 deflate 偶尔反而更大 */
    if (comp.length >= data.length) { method = 0; comp = data; }
    else method = 8;
  }
  const crc = e.dir ? 0 : zlib.crc32(data);

  /* 本地文件头 */
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);            // bit 11 = 文件名是 UTF-8
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(t, 10);
  lh.writeUInt16LE(dt, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  chunks.push(lh, nameBuf, comp);

  /* 中央目录项 */
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(0x031e, 4);            // 高字节 3 = Unix, 低字节 30 = 3.0
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(t, 12);
  ch.writeUInt16LE(dt, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(mode << 16, 38);       // ← 关键: Unix 权限位
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + comp.length;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

/* 先删目标文件再写。
   坑(真实踩到): 这个 zip 之前由 PowerShell 的 Compress-Archive 生成过(条目带"包名/"前缀),
   之后本工具重写时如果残留旧字节, 包里就会**同时存在两套文件** ——
   解压出来是一个套娃目录, 而 EOCD 里的条目数还是新的那套, 自检根本发现不了。
   直接 unlink 最干净。 */
try { fs.unlinkSync(OUT); } catch (e) { /* 不存在就算了 */ }
fs.writeFileSync(OUT, Buffer.concat([...chunks, cdBuf, eocd]));

/* 重读一遍, 独立验证: 条目数对得上、没有重名、没有多余字节 */
const check = fs.readFileSync(OUT);
let p2 = check.length - 22;
while (p2 >= 0 && check.readUInt32LE(p2) !== 0x06054b50) p2--;
const nRead = p2 < 0 ? -1 : check.readUInt16LE(p2 + 10);
const cdOffRead = p2 < 0 ? -1 : check.readUInt32LE(p2 + 16);
const cdSizeRead = p2 < 0 ? -1 : check.readUInt32LE(p2 + 12);
const seen = new Set();
let dup = null, q2 = cdOffRead;
for (let i = 0; i < nRead; i++) {
  const nl = check.readUInt16LE(q2 + 28), el = check.readUInt16LE(q2 + 30), cl = check.readUInt16LE(q2 + 32);
  const nm = check.subarray(q2 + 46, q2 + 46 + nl).toString('utf8');
  if (seen.has(nm)) dup = nm;
  seen.add(nm);
  q2 += 46 + nl + el + cl;
}
const trailing = p2 >= 0 ? check.length - (p2 + 22) : -1;

const execs = entries.filter(e => !e.dir && EXEC_EXT.test(e.rel));
const total = entries.reduce((a, e) => a + (e.dir ? 0 : fs.statSync(e.full).size), 0);
console.log('写出 ' + OUT);
console.log('  大小     ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB (未压缩 ' + (total / 1024 / 1024).toFixed(2) + ' MB)');
console.log('  条目     ' + entries.length + ' 个(含目录)');
console.log('  可执行   ' + execs.length + ' 个: ' + execs.map(e => e.rel + ' [755]').join(', '));

console.log('\n  独立复读自检:');
console.log('    条目数        ' + nRead + (nRead === entries.length ? ' ✓ 与源目录一致' : ' ✗ 不一致!'));
console.log('    重复条目      ' + (dup ? '✗ 有: ' + dup : '✓ 无'));
console.log('    尾部多余字节  ' + trailing + (trailing === 0 ? ' ✓' : ' ✗ 有残留数据!'));
console.log('    中央目录      ' + cdOffRead + '~' + (cdOffRead + cdSizeRead) + ' / 文件长 ' + check.length + (cdOffRead + cdSizeRead === p2 ? ' ✓ 严丝合缝' : ' ✗ 对不上'));
const allOk = nRead === entries.length && !dup && trailing === 0 && cdOffRead + cdSizeRead === p2;
console.log(allOk ? '\n  → 结构干净。' : '\n  → !! 包有问题, 不要发出去');
