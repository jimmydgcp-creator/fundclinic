/* 生成《中期汇报 · 5 人逐人逐页口播稿.docx》
 *
 * 解决的实际问题：5 分钟 5 个人上台，每个人只讲 2–3 页。
 * 发一份"每人在每一页讲什么"的 Word：每人只需要背自己那一节，上台只带自己那几页。
 *
 * 内容**不从零写**，全部从两份已定稿的文件里读：
 *   ① 00_交作业\中期汇报_展示页\讲稿_5分钟.md   —— 逐页口播原文（唯一权威）
 *   ② 00_交作业\组内分工_5人上台.md             —— 角色/秒数/金句/逐页提示/衔接句/掐表/砍段顺序
 * 这样展示页或讲稿再改，重跑一次这份 Word 就跟着更新，不会两边说法不一致。
 *
 * 用法: node tools/make_docx_roles.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, H1, H2, H3, Label, Body, Small, Bullet, Blank, Note, Say, PageBreak, TBL, runsOf, writeDocx } from './docxkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HW = path.resolve(ROOT, '..', '00_交作业');
const SCRIPT_MD = path.join(HW, '中期汇报_展示页', '讲稿_5分钟.md');
const ROLES_MD = path.join(HW, '组内分工_5人上台.md');
const OUT = path.join(HW, '中期汇报_5人讲稿_逐人逐页.docx');
for (const f of [SCRIPT_MD, ROLES_MD]) if (!fs.existsSync(f)) { console.error('找不到 ' + f); process.exit(1); }

/* ------------------------------------------------------------------ 小工具 */
const clean = s => String(s).replace(/\*\*/g, '').replace(/(^|[^`])`([^`]+)`/g, '$1$2').trim();
/* 保留强调：**粗** 与 `代码` 切成不同 run。
   注意用**工具箱里那一份** runsOf —— 这里曾经又抄了一份单层实现，
   结果 **`路径`** 这种"粗体里包代码"只剥一层，反引号照原样印了出来。 */
const Rich = (t, opt = {}) => P(runsOf(t, { size: opt.size || 10.5, color: opt.color }), opt);
/* 中文按行拼接：行尾行首都是 ASCII 字母数字时才补空格（讲稿里那种 40 字换行是排版折行，不是句读） */
function joinLines(lines) {
  let s = '';
  for (const l of lines) {
    if (!s) { s = l; continue; }
    const a = s.slice(-1), b = l.slice(0, 1);
    s += (/[0-9A-Za-z)\]}`]/.test(a) && /[0-9A-Za-z(\[`]/.test(b) ? ' ' : '') + l;
  }
  return s;
}
/* 找一张 markdown 表：表头行里含 headerKey */
function tableBy(lines, headerKey) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith('|') && lines[i].includes(headerKey) && /^\|[\s:\-|]+\|$/.test(lines[i + 1].trim())) {
      const rows = [];
      for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        rows.push(lines[j].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      }
      return rows;
    }
  }
  console.error('找不到表: ' + headerKey);
  process.exit(1);
}

/* ------------------------------------------------- ① 讲稿：逐页口播原文 */
const SL = fs.readFileSync(SCRIPT_MD, 'utf8').split(/\r?\n/);
const pages = [];
for (let i = 0; i < SL.length; i++) {
  const m = /^## P(\d+) · (.+?)（(\d+) 秒｜([A-E])）\s*$/.exec(SL[i]);
  if (!m) continue;
  const paras = [];
  let cur = [];
  for (let j = i + 1; j < SL.length; j++) {
    if (/^## /.test(SL[j])) break;
    const t = SL[j].trim();
    if (!t.startsWith('>')) {
      if (t === '---') break;
      continue;
    }
    const inner = t.replace(/^>\s?/, '');
    if (inner === '') { if (cur.length) { paras.push(cur); cur = []; } continue; }
    cur.push(inner);
  }
  if (cur.length) paras.push(cur);
  const text = paras.map(p => {
    /* 每行开头的引号是口播稿的排版习惯，整段只留一对 */
    const joined = joinLines(p.map(l => l.replace(/^"/, '').replace(/"$/, '')));
    return joined;
  }).filter(Boolean);
  pages.push({ n: Number(m[1]), title: m[2].trim(), sec: Number(m[3]), role: m[4], text });
  i = i; /* 继续扫后面的页 */
}
if (pages.length !== 5) { console.error('讲稿里只解析到 ' + pages.length + ' 段(应为 5：3 页拆成 5 段)'); process.exit(1); }
/* 标题里写着"第 N 页"（三页版一页可能两个人讲），拿它判断要不要翻页 */
const slideOf = p => { const m = /第\s*(\d+)\s*页/.exec(p.title); return m ? Number(m[1]) : p.n; };
const roleOf = n => (pages.find(p => p.n === n) || {}).role;

/* 上台前 60 秒检查（讲稿附录）。
   注意：清单里有**续行**（缩进的第二行，例如"zip 里有 4 样东西"下面那串文件名、
   "三层兜底"下面的 ①②③）—— 只认 "- [ ]" 开头的行会把它们整段丢掉。 */
const checklist = [];
{
  const i = SL.findIndex(l => /^## 附：/.test(l));
  for (let j = i + 1; j < SL.length; j++) {
    const raw = SL[j];
    if (/^## /.test(raw)) break;
    const m = /^- \[ \] (.*)$/.exec(raw.trim());
    if (m) { checklist.push(m[1]); continue; }
    if (!checklist.length) continue;
    const t = raw.trim();
    if (!t || t === '---' || /^[-#>|]/.test(t)) continue;   /* 空行/引用/表格/新条目：不算续行 */
    checklist[checklist.length - 1] += ' ' + t;
  }
}
if (checklist.length < 8) { console.error('上台前检查只抓到 ' + checklist.length + ' 条'); process.exit(1); }

/* --------------------------------------------------- ② 分工稿：角色与机关 */
const RL = fs.readFileSync(ROLES_MD, 'utf8').split(/\r?\n/);
const roleRows = tableBy(RL, '必须说出口').map(r => r.map(clean));
const roles = {};
for (const r of roleRows) {
  const letter = r[0].replace(/[^A-E]/g, '');
  if (!letter) continue;
  roles[letter] = { letter, pages: r[1], sec: r[2], point: r[3], quote: r[4], hint: {}, note: [] };
}
/* 逐人卡片：### A · 标题（P1–P3，55 秒）下面的 bullet，分"逐页提示"和"这一段注意事项" */
let curRole = null;
for (const raw of RL) {
  /* 卡片标题：（P1–P3，55 秒）或（50 秒）两种写法都认 */
  const h = /^### ([A-E]) · (.+?)（(?:P\d+(?:–P\d+)?，)?\d+ 秒）/.exec(raw);
  if (h) { curRole = h[1]; if (roles[curRole]) roles[curRole].cardTitle = h[2]; continue; }
  if (/^## /.test(raw)) { curRole = null; continue; }
  if (!curRole || !roles[curRole]) continue;
  const b = /^- \*\*(.+?)\*\*[：:](.*)$/.exec(raw.trim());
  if (!b) continue;
  const [_, lead, rest] = b;
  const pm = /^P(\d+)/.exec(lead);
  if (pm) roles[curRole].hint[Number(pm[1])] = (lead.match(/（(\d+) 秒）/) ? '' : lead + '：') + rest.trim();
  else roles[curRole].note.push([lead, rest.trim()]);
}
/* 衔接句 */
const transitions = tableBy(RL, '上一段的最后一句').map(r => r.map(clean));
/* 台上的机械动作 */
const machine = tableBy(RL, '事项').map(r => r.map(clean));
/* 超时预案：§4 的 bullet（正文里是 "- **超时 30 秒以上**：…" 这种写法） */
const plans = RL
  .map(l => l.trim())
  .filter(l => /^- \*\*(超时 30 秒|展示页打不开|公网打不开|有人忘词)/.test(l))
  .map(l => l.replace(/^-\s*/, ''));
if (plans.length !== 4) { console.error('超时预案只抓到 ' + plans.length + ' 条(应为 4)'); process.exit(1); }

for (const k of ['A', 'B', 'C', 'D', 'E']) if (!roles[k]) { console.error('分工稿里没有角色 ' + k); process.exit(1); }

/* ================================================================ 组装 */
const doc = [];
doc.push(P('中期汇报 · 5 人逐人逐页口播稿', { bold: true, size: 22, color: '1F3864', align: 'center', before: 0, after: 60 }));
doc.push(P('第 2 组 · 基金复诊台 FundClinic', { bold: true, size: 13, color: '2E5496', align: 'center', after: 120 }));
doc.push(P('金融AI智能体设计与应用 · 中山大学岭南学院 · 张一帆 · 2026-10-14 第 5 次课', { size: 10, color: '666666', align: 'center' }));
doc.push(P('全员上台 · 每组 5 分钟（300 秒）· 13 页展示页 · 5 人一人一段', { size: 10, color: '666666', align: 'center', after: 240 }));

doc.push(H1('零、这份稿子怎么用'));
doc.push(Body('5 个人上台，每人只讲 2–3 页。你只要背自己那一节，上台带着自己那几页就行。'));
doc.push(Bullet('每页的「你说」是逐字稿。按自己的口气改词没问题，页数、顺序、数字别动，数字都是跑出来的。'));
doc.push(Bullet('每节开头那句「金句」要原样说出口，其他随便发挥。'));
doc.push(Bullet('讲完自己最后一句，直接接第七节的衔接句，别停在那儿等主持人。我们没有主持人。'));
doc.push(Bullet('掐表轮流转：你讲的时候，下一个人掐你的表。五个人都在台上，没人专职计时。'));
doc.push(Blank());
doc.push(Note('展示页是一个单文件 HTML。双击 index.html，← → 翻页，F 全屏，P 导出 PDF。万一打不开，就双击同目录的「备用_无需脚本版.html」，内容和页码都一样，这份稿子照用。'));

/* 一、一页速查 */
doc.push(H1('一、一页速查（总 285 秒 + 15 秒机动）'));
doc.push(TBL(
  ['页', '讲什么', '秒', '谁'],
  pages.map(p => ['P' + p.n, p.title, String(p.sec), p.role]),
  [0.5, 3.4, 0.5, 0.5]
));
doc.push(Blank());
doc.push(TBL(
  ['角色', '页面', '秒', '这一段要立住的论点', '金句'],
  ['A', 'B', 'C', 'D', 'E'].map(k => {
    const r = roles[k];
    return [k + (r.cardTitle ? ' · ' + r.cardTitle : ''), r.pages, r.sec, r.point, r.quote];
  }),
  [1.5, 0.7, 0.5, 2.2, 3.0]
));
doc.push(Blank());
doc.push(Small('体检线：讲完第 1 页（A+B）应该还剩三分钟出头，讲完第 2 页还剩一分半左右。超时就按第九节的顺序砍，A 段和 E 段一秒都不砍。'));

/* 二~六 逐人 */
const order = ['A', 'B', 'C', 'D', 'E'];
for (const k of order) {
  const r = roles[k];
  const mine = pages.filter(p => p.role === k).sort((a, b) => a.n - b.n);
  if (!mine.length) { console.error('角色 ' + k + ' 没有分到页'); process.exit(1); }
  doc.push(PageBreak());
  doc.push(H1('角色 ' + k + ' · ' + (r.cardTitle || '') + '（' + r.pages + '，' + r.sec + ' 秒）'));
  doc.push(Note('金句（必须说出口）：' + r.quote));
  for (let idx = 0; idx < mine.length; idx++) {
    const p = mine[idx];
    doc.push(H3('P' + p.n + ' · ' + p.title + '（' + p.sec + ' 秒）'));
    if (r.hint[p.n]) doc.push(Rich('提示：' + r.hint[p.n], { size: 9.5, color: '2E5496', indent: 180 }));
    doc.push(Label('你说：'));
    for (const t of p.text) doc.push(Say(t));
    /* 动作：上台 / 翻页 / 收尾。三页版里一页可能两个人讲 ——
       同一页里后讲的那个人不用翻页，翻页交给这一页最后讲的那位。 */
    const acts = [];
    const next = pages.slice().sort((a, b) => a.n - b.n).find(q => q.n > p.n);
    const slideNo = slideOf(p);
    if (idx === 0) acts.push('**上台**，站定再说第一句');
    acts.push(next && slideOf(next) === slideNo ? '接着讲，**不用翻页**（这一页由最后讲的人翻）' : '讲完按 `→` 翻下一页');
    if (!next) acts.push('**全体上前**站成一排，别急着下台');
    doc.push(Small('动作：' + acts.join('；') + '。'));
  }
  if (r.note.length) {
    doc.push(Label('这一段的注意事项'));
    for (const [lead, rest] of r.note) doc.push(Rich('· ' + lead + '：' + rest, { size: 9.5, indent: 300 }));
  }
  const tr = transitions.find(t => clean(t[0]).startsWith(k + ' →'));
  if (tr) {
    doc.push(Label('交给下一位（衔接句背下来）'));
    doc.push(Bullet('你最后一句：' + tr[1], 300));
    doc.push(Bullet('下一位第一句：' + tr[2], 300));
  }
}

/* 七、衔接总表 */
doc.push(PageBreak());
doc.push(H1('七、换场衔接总表'));
doc.push(Body('上台最难看的一秒是"接下来由我讲"。所以下一段的第一句，直接接着说上一段的最后一句：'));
doc.push(TBL(['交接', '上一段的最后一句', '下一段的第一句'], transitions.map(t => [clean(t[0]), t[1], t[2]]), [0.8, 3.2, 3.2]));

/* 八、台上的机械动作 */
doc.push(H1('八、台上的机械动作（谁按什么）'));
doc.push(TBL(['事项', '谁', '具体'], machine.map(m => [m[0], m[1], m[2]]), [1.0, 0.6, 5.0]));

/* 九、超时 */
doc.push(H1('九、超时了砍哪一段'));
for (const p of plans) doc.push(Rich('· ' + p, { size: 10 }));

/* 十、上台前检查：条目里的 ①②③（三层兜底的顺序）拆成子条，别挤成一堵墙 */
doc.push(H1('十、上台前 60 秒检查'));
for (const c of checklist) {
  const parts = c.split(/(?=[①②③④])/).map(s => s.trim()).filter(Boolean);
  doc.push(Rich('· ' + parts[0], { size: 10.5, indent: 300 }));
  for (const p of parts.slice(1)) doc.push(Rich(p, { size: 10, indent: 640 }));
}
doc.push(Blank());
doc.push(Small('这份文件是 tools/make_docx_roles.mjs 从《讲稿_5分钟.md》和《组内分工_5人上台.md》里读出来拼的。那两份改了，重跑一次这份就跟着更新。'));

writeDocx(OUT, doc, {
  must: ['P1', 'P5', '角色 A', '角色 B', '角色 C', '角色 D', '角色 E',
    '金句', '衔接', '掐表', 'A 段和 E 段一秒都不砍', '5 只基金', '第 1 页', '第 3 页']
});
