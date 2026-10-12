/* 自建 docx 工具箱：不依赖任何第三方库，直接写 OOXML 再打成 zip。
 *
 * 为什么不用 python-docx / docx 包：这个项目的三份 Word（场景确认 / 中期确认稿 / 这份讲稿）
 * 要长得一样，而字体、字号、表格边框、中文 eastAsia 字体这些细节全部在这里定死。
 * 抽出来的这段与 tools/make_docx_midterm.mjs 里那份是同一套写法（那份历史更久，没动它）。
 *
 * 用法：
 *   import { P, H1, Body, TBL, PageBreak, writeDocx } from './docxkit.mjs';
 *   const doc = []; doc.push(H1('标题')); ...
 *   writeDocx('xxx.docx', doc);
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 稿件是照 Markdown 习惯写的：**强调** 与 `代码`。
   docx 不认这两个语法 —— 只"剥掉标记"会让加粗消失、把反引号原样印出来。
   所以统一在这里切成多个 run：**…** → 加粗，`…` → 等宽字体，其余原样。 */
export function runsOf(text, base = {}) {
  const out = [];
  /* 两层处理：先切 **粗体**，再把每段里的 `代码` 切成等宽 ——
     稿子里常见 **`路径`** 这种"粗体里包着代码"，只剥一层就会把反引号印出来。 */
  for (const seg of String(text == null ? '' : text).split(/(\*\*[^*]+\*\*)/)) {
    if (!seg) continue;
    const bold = seg.startsWith('**') && seg.endsWith('**');
    for (const part of (bold ? seg.slice(2, -2) : seg).split(/(`[^`]+`)/)) {
      if (!part) continue;
      const mono = part.startsWith('`') && part.endsWith('`');
      out.push({
        t: mono ? part.slice(1, -1) : part,
        ...base,
        ...(bold ? { bold: true } : {}),
        ...(mono ? { mono: true } : {})
      });
    }
  }
  return out.length ? out : [{ t: '', ...base }];
}

const rpr = r => {
  const font = r.mono ? 'Consolas' : 'Microsoft YaHei';
  let s = '<w:rPr>';
  s += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="Microsoft YaHei"/>`;
  if (r.bold) s += '<w:b/>';
  if (r.color) s += `<w:color w:val="${r.color}"/>`;
  if (r.size) s += `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`;
  s += '</w:rPr>';
  return s;
};
export const runXml = r => `<w:r>${rpr(r)}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;

/* 一个段落。text 可以是字符串（会自动处理 ** 与 `），也可以是 run 数组 */
export function P(text, opt = {}) {
  const runs = Array.isArray(text) ? text : runsOf(text, opt);
  const body = runs.map(runXml).join('');
  const ppr = '<w:pPr>'
    + (opt.align ? `<w:jc w:val="${opt.align}"/>` : '')
    + (opt.indent ? `<w:ind w:left="${opt.indent}"/>` : '')
    + `<w:spacing w:before="${opt.before === undefined ? 60 : opt.before}" w:after="${opt.after === undefined ? 60 : opt.after}" w:line="300" w:lineRule="auto"/>`
    + (opt.shade ? `<w:shd w:val="clear" w:fill="${opt.shade}"/>` : '')
    + '</w:pPr>';
  return `<w:p>${ppr}${body}</w:p>`;
}

export const H1 = t => P(t, { bold: true, size: 20, color: '1F3864', before: 300, after: 140 });
export const H2 = t => P(t, { bold: true, size: 15, color: '1F3864', before: 220, after: 90 });
export const H3 = t => P(t, { bold: true, size: 12, color: '2E5496', before: 160, after: 60 });
export const Label = t => P(t, { bold: true, size: 10.5, color: '1F3864', before: 100, after: 40 });
export const Body = t => P(t, { size: 10.5 });
export const Small = t => P(t, { size: 9, color: '666666' });
export const Bullet = (t, ind) => P('· ' + t, { size: 10.5, indent: ind || 300 });
export const Blank = () => P('', { size: 8, before: 30, after: 30 });
export const Note = t => P(t, { size: 9.5, color: '8A5A00', shade: 'FFF7E6', indent: 180, before: 90, after: 90 });
/* 要背的话单独一排：小一号、灰底、左缩进 */
export const Say = t => P(t, { size: 11, indent: 200, before: 60, after: 60, shade: 'F2F6FC' });
export const PageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/* 表格：边框手写，不依赖任何样式表 */
export function TBL(headers, rows, weights) {
  const W = 9638;
  const cols = weights.map(w => Math.round(W * w / weights.reduce((a, b) => a + b, 0)));
  const border = c => `<w:${c} w:val="single" w:sz="4" w:space="0" w:color="B7C3D6"/>`;
  const cell = (txt, i, bold, shade) => {
    const base = { size: bold ? 9.5 : 9, bold, color: bold ? '1F3864' : '222222' };
    const runs = runsOf(txt, base).map(runXml).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="${cols[i]}" w:type="dxa"/>`
      + (shade ? `<w:shd w:val="clear" w:fill="${shade}"/>` : '')
      + `<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`
      + `<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="252" w:lineRule="auto"/></w:pPr>`
      + runs + `</w:p></w:tc>`;
  };
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
    + `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols.map(c => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>`;
  x += '<w:tr>' + headers.map((h, i) => cell(h, i, true, 'EDF2FA')).join('') + '</w:tr>';
  for (const row of rows) x += '<w:tr>' + row.map((c, i) => cell(c, i, false)).join('') + '</w:tr>';
  return x + '</w:tbl>';
}

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0o644 << 16, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

/** 把段落数组打包成 docx，并打印结构与自检信息 */
export function writeDocx(outPath, paragraphs, meta = {}) {
  const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraphs.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = zip([['[Content_Types].xml', CT], ['_rels/.rels', RELS], ['word/document.xml', DOC]]);
  /* 目标文件可能正被 Word 打开（同目录会出现 ~$xxx.docx 锁文件），这时删不掉也覆盖不了。
     处理：先等一会儿（人可能马上就关了），实在不行就另存成 "(改版).docx"，
     而不是让整个生成过程崩在 unlink 上。 */
  let target = outPath;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      break;
    } catch (e) {
      if (i === 9) {
        target = outPath.replace(/\.docx$/i, '(改版).docx');
        console.log('  ! ' + path.basename(outPath) + ' 正被占用（Word 开着），改写为 ' + path.basename(target));
      } else {
        console.log('  目标被占用，等 3 秒再试（' + (i + 1) + '/10）…');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      }
    }
  }
  fs.writeFileSync(target, buf);
  const text = DOC.replace(/<[^>]+>/g, '');
  console.log('写出 ' + outPath);
  console.log('  文件大小   ' + (buf.length / 1024).toFixed(1) + ' KB');
  console.log('  正文可见字 ' + text.length + ' 字');
  console.log('  表格数     ' + (DOC.match(/<w:tbl>/g) || []).length
    + ' · 分页符 ' + (DOC.match(/w:type="page"/g) || []).length
    + ' · 段落 ' + (DOC.match(/<w:p>/g) || []).length);
  console.log('  结构自检   头签名 ' + (buf.readUInt32LE(0) === 0x04034b50 ? '✓' : '✗')
    + ' · zip 条目 ' + buf.readUInt16LE(buf.length - 22 + 10));
  if (meta.must) {
    const miss = meta.must.filter(s => !text.includes(s));
    console.log('  内容自检   ' + (miss.length ? '✗ 缺: ' + miss.join('、') : '✓ ' + meta.must.length + ' 个关键内容齐全'));
    return { buf, text, miss };
  }
  return { buf, text, miss: [] };
}
