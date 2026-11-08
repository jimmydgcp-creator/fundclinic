/* 生成《终展 · 10 分钟 · 5 人分工与逐字稿.docx》
 *
 * 内容**不从零写**：全部读 00_交作业\终展_10分钟_5人分工与讲稿.md（唯一权威），
 * 稿子改了重跑一次这份 Word 就跟着变，不会两边说法不一致。
 * 版式沿用 docxkit（与《场景确认》《中期确认稿》《中期 5 人讲稿》同一套字体字号）。
 *
 * 排版上的两个针对性决定：
 *   ① 每个讲者**单独起一页** —— 打印后一人撕一页带走，台上只看自己那页；
 *   ② 超过 6 列的表（数字口径对照表）不硬塞，改成"一基金一卡片"的竖排键值块，
 *      否则 A4 竖版里 10 列会挤成一条线。
 *
 * 用法: node tools/make_docx_final.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, H1, H2, H3, Label, Body, Small, Bullet, Blank, Note, Say, PageBreak, TBL, writeDocx } from './docxkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HW = path.resolve(ROOT, '..', '00_交作业');
const SRC = path.join(HW, '终展_10分钟_5人分工与讲稿.md');
const OUT = process.argv[2] ? path.join(HW, process.argv[2]) : path.join(HW, '终展_10分钟_5人分工与讲稿.docx');
if (!fs.existsSync(SRC)) { console.error('找不到 ' + SRC); process.exit(1); }

const md = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

/* ---------------------------------------------------------------- 解析 */
const blocks = [];          // {type, ...}
let i = 0;
let inScript = false;       // 是否在「逐人逐字稿」这一节里
while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trim();

  if (!line) { i++; continue; }

  /* 表格: 连续以 | 开头的行 */
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      rows.push(lines[i].trim());
      i++;
    }
    const cells = rows
      .filter(r => !/^\|[\s:|-]+\|$/.test(r))          // 去掉 |---|---| 分隔行
      .map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    if (cells.length >= 2) blocks.push({ type: 'table', head: cells[0], body: cells.slice(1) });
    continue;
  }

  /* 引用块 = 台词。文首那一块是文件头（组号/地址/口径），封面已经讲了，跳过。 */
  if (line.startsWith('>')) {
    const isHeader = !blocks.some(b => b.type === 'h2');
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) {
      const t = lines[i].trim().replace(/^>\s?/, '');
      if (t === '') { if (buf.length) { blocks.push({ type: 'say', text: buf.join('') }); buf.length = 0; } }
      else buf.push(t);
      i++;
    }
    if (buf.length && !isHeader) blocks.push({ type: 'say', text: buf.join('') });
    continue;
  }

  if (line.startsWith('### ')) { blocks.push({ type: 'h3', text: line.slice(4) }); i++; continue; }
  if (line.startsWith('## ')) {
    const t = line.slice(3);
    inScript = /逐人逐字稿/.test(t);
    blocks.push({ type: 'h2', text: t, section: inScript });
    i++; continue;
  }
  if (line.startsWith('# ')) { i++; continue; }        // 顶级标题由封面接管

  if (/^\d+\.\s+/.test(line)) { blocks.push({ type: 'num', text: line }); i++; continue; }
  if (/^[-*]\s+/.test(line)) {
    blocks.push({ type: 'bullet', text: line.replace(/^[-*]\s+/, '') }); i++; continue;
  }
  if (/^---+$/.test(line)) { i++; continue; }

  /* 段落: 合并到空行为止 */
  const buf = [];
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t || t.startsWith('|') || t.startsWith('>') || t.startsWith('#') || /^[-*]\s+/.test(t) || /^\d+\.\s/.test(t) || /^---+$/.test(t)) break;
    buf.push(t); i++;
  }
  if (buf.length) blocks.push({ type: 'p', text: buf.join('') });
}

/* ------------------------------------------------------------ 排版输出 */
const doc = [];
const clean = s => String(s).replace(/\*\*/g, '').replace(/`/g, '');

/* 封面 */
doc.push(P('终展 · 10 分钟', { bold: true, size: 26, color: '1F3864', align: 'center', before: 900, after: 120 }));
doc.push(P('5 人分工与逐字稿', { bold: true, size: 26, color: '1F3864', align: 'center', after: 420 }));
doc.push(P('基金复诊台 FundClinic', { bold: true, size: 15, color: '2E5496', align: 'center', after: 60 }));
doc.push(P('金融AI智能体设计与应用 · 第 2 组', { size: 11, color: '666666', align: 'center', after: 520 }));
doc.push(P('线上地址  fundclinic.onrender.com', { size: 11, align: 'center', after: 40 }));
doc.push(P('总量 1502 字 · 5 人各约 2 分钟 · 语速 150 字/分', { size: 11, align: 'center', after: 40 }));
doc.push(P('讲者 A · B · C · D · E（人员待定，定了把字母换成人名即可）', { size: 11, align: 'center', after: 500 }));
doc.push(Note('打印建议：整份打印后，第三部分每位讲者单独一页，直接撕下来带上台 —— 每人只背自己那一段，外加第四部分那四句衔接。'));
doc.push(PageBreak());

let firstH2 = true;
for (let b = 0; b < blocks.length; b++) {
  const blk = blocks[b];

  if (blk.type === 'h2') {
    if (!firstH2) doc.push(Blank());
    firstH2 = false;
    doc.push(H1(clean(blk.text)));
    continue;
  }

  if (blk.type === 'h3') {
    // 逐人逐字稿里，每个讲者单独起一页
    if (blk.section || /^[A-E] ·/.test(clean(blk.text))) doc.push(PageBreak());
    doc.push(H2(clean(blk.text)));
    continue;
  }

  if (blk.type === 'table') {
    const head = blk.head.map(clean);
    const body = blk.body.map(r => r.map(clean));
    const width = head.length;
    if (width > 8) {
      /* 宽表改成卡片：第一列作标题，其余列名: 值 */
      body.forEach(row => {
        doc.push(Label(row[0] || ''));
        head.slice(1).forEach((h, k) => {
          if (row[k + 1] !== undefined && row[k + 1] !== '') doc.push(Bullet(h + '：' + row[k + 1]));
        });
        doc.push(Blank());
      });
    } else {
      /* 列宽按内容长度分配: 短列(时长/字数)窄, 长句列(讲哪一块)宽,
         否则 7 列挤在 A4 竖版里会每行只剩两三个字。 */
      const weights = head.map((h, k) => {
        const lens = body.map(r => (r[k] || '').length).concat([h.length]);
        const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
        return Math.max(1.1, Math.min(7, avg / 7));
      });
      doc.push(TBL(head, body, weights));
      doc.push(Blank());
    }
    continue;
  }

  if (blk.type === 'say') {
    const t = blk.text.replace(/〔[^〕]*〕/g, '');       // 去掉〔停半秒〕这类舞台提示
    if (t.trim()) doc.push(Say(t));
    continue;
  }

  if (blk.type === 'num') { doc.push(P(clean(blk.text), { size: 10.5, indent: 300 })); continue; }
  if (blk.type === 'bullet') { doc.push(Bullet(blk.text.replace(/\*\*/g, ''))); continue; }

  if (blk.type === 'p') {
    const t = blk.text;
    if (/^(可能被问|操作提示|超时预案|为什么|注意|提醒|收尾动作|口径提醒|点错了怎么办|为什么不用)/.test(clean(t))) {
      doc.push(Note(clean(t)));
    } else if (/^⚠️/.test(t)) {
      doc.push(Note(clean(t)));
    } else {
      doc.push(Body(clean(t)));
    }
    continue;
  }
}

doc.push(PageBreak());
doc.push(Small('本文件由 tools/make_docx_final.mjs 从 00_交作业/终展_10分钟_5人分工与讲稿.md 生成；改稿请改 md 再重跑，不要手改这份 Word。'));

writeDocx(OUT, doc, { title: '终展 · 10 分钟 · 5 人分工与逐字稿' });
console.log('已生成 ' + path.relative(process.cwd(), OUT) + '  ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
console.log('段落数 ' + doc.filter(x => typeof x === 'string' && x.startsWith('<w:p')).length);
