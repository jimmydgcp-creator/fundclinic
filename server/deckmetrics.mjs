/* deckmetrics.mjs —— 演示稿形态的**唯一**度量口径
 *
 * 由来(2026-10-10, 一次真实的翻车):
 *   用户指出"我的模板是这份(519191 回溯复盘 PPT)"。我把生成稿和参照稿量了一遍, 发现
 *   我上一轮写的三条内容判据**会把用户认可的参照稿本身判成不合格**:
 *     · "每页必须有一段 ≥170 字连续论述" —— 参照稿 8 页里只有 3 页有这种块(结论页 258 字、
 *       最新季页 206 字、跟踪页 93 字); 绩效页/轮动页/案例页**根本没有**, 它们靠"表格 + 一组
 *       卡片 + 段末注记"讲清楚。按那条判据, 7 个内容页里有 5 个要被报警。
 *     · "每页卡片 ≤3" —— 参照稿轮动页 5 张、案例页 4 张、跟踪页 4 张。
 *     · "每页加粗 ≤9" —— 参照稿结论页 11 处、案例页 14 处。
 *   根因是我用了**均值**(674 字/页 · 7 处加粗/页)去定**逐页硬顶**。均值掩盖了页与页的差异,
 *   而这份参照稿恰恰是"每页形态都不一样"的 —— 拿均值当上限, 等于把它的强项判成违规。
 *
 *   所以这个模块只做两件事: ① 老老实实逐页量; ② 把判据写成"从参照稿量出来的数 + 明确留白",
 *   每一条都注明参照值。tools/template_spec.mjs 只做打印, 判据和度量都从这里取, 避免两处漂移。
 *
 * 实测基准(参照稿 8 页 / 4931 字):
 *   均 616 字/页 · 加粗 54 处(均 6.8, 单页 0–14) · 卡片 22 张(2.8/页, 单页最多 5)
 *   · 指标卡 6 个(只出现在绩效页 4 个、最新季页 2 个) · 表格 3 张 · 讲者备注 74–116 字
 *   · 每页骨架都不同(封面 / 长论述 / 指标卡+表 / 四阶段卡 / 框架+对账表 / 成对案例 / 左数右表 / 证实证伪+清单)
 *
 * 对照: 我们自己生成的 005825 深度版(真 Key 跑出来的)10 页
 *   均 598 字/页(不差) · **加粗 184 处(均 18.4, 2.7 倍)** · **卡片 87 处(8.7/页, 3 倍)**
 *   · **指标卡 19 个(3 倍)** · 讲者备注最长 310 字(写成小作文了) · **没有封面页**
 *   所以真正要治的是"加粗上瘾 + 卡片摊平 + 指标卡堆砌 + 备注过长 + 缺封面", 不是"字不够"。
 */

/* ------------------------------------------------------------ 度量 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCK = new Set(['p', 'div', 'table', 'ul', 'ol', 'section', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote']);
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'source']);

export const stripTags = s => String(s)
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const nospace = s => stripTags(s).replace(/\s+/g, '');

/** 拆出一份演示稿里的每一页。
 *  只认带 class="slide" 的 section —— 参照稿和生成稿都遵守这个约定。 */
export function splitSlides(html) {
  return [...String(html).matchAll(/<section\b[^>]*class="[^"]*\bslide\b[^"]*"[\s\S]*?<\/section>/g)].map(m => m[0]);
}

/** 叶子文本块: 内部不再嵌 p/div/table/ul/ol 的元素。
 *  这是"一段连续论述"的正确定义 —— 卡片里的短句、表格单元格在此口径下可比。
 *  **必须排除 .notes**: 讲者备注往往最长, 不排除的话"最长文本块"量到的是备注而不是页面论证,
 *  于是加一段 300 字备注就能假装页面论证充分。 */
export function leafBlocks(html) {
  const stack = []; const out = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (VOID.has(tag) || /\/$/.test(attrs)) continue;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { const n = stack.splice(i, 1)[0]; n.end = m.index; out.push(n); break; }
      }
    } else {
      if (BLOCK.has(tag)) for (const n of stack) n.hasBlock = true;
      stack.push({ tag, attrs, openEnd: re.lastIndex, hasBlock: false });
    }
  }
  return out.filter(n => !n.hasBlock).map(n => ({
    tag: n.tag,
    cls: (/class="([^"]*)"/.exec(n.attrs) || [, ''])[1],
    len: nospace(html.slice(n.openEnd, n.end)).length,
    text: stripTags(html.slice(n.openEnd, n.end)).replace(/\s+/g, ' ').trim()
  })).filter(n => n.len && !/\bnotes\b/.test(n.cls));
}

/* 计数一律按"元素"而不是"类名出现次数" —— 注意 `class="card card-soft"` 是一个元素挂两个
 * card 系类名, 按类名数会重复计一次(踩过: 生成的稿子里这种写法很多, 卡片数被虚增近一倍)。 */
const countEls = (s, re) => [...s.matchAll(/class="([^"]*)"/g)].filter(m => re.test(m[1])).length;
const RE_CARD = /\bcard(-(?:soft|accent|outline|hover))?\b/;
const RE_STAT = /\bstat\b/;
const RE_TAG = /\btag(-(?:ok|bad|blue|gray))?\b/;
const RE_PILL = /\bpill(-accent)?\b/;

/** 表格质量: 每张表至少要有一列是"人话列"(备注/判定/变化那种), 不能整张表都是裸数字。
 *  参照稿三张表的末列分别是 备注(官方季报口径) / 判定 / 变化 —— 都是文字列。 */
function tableTextCols(s) {
  const out = [];
  for (const t of s.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const tbl = t[0];
    const rows = [...tbl.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(r => [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => nospace(c[1])));
    if (rows.length < 2) { out.push({ cols: 0, textCols: 0 }); continue; }
    const cols = Math.max(...rows.map(r => r.length));
    let textCols = 0;
    for (let c = 0; c < cols; c++) {
      const cells = rows.slice(1).map(r => r[c]).filter(x => x != null);
      if (!cells.length) continue;
      // "人话"= 不是纯数字/百分数/破折号, 且有 2 个字以上
      const words = cells.filter(x => x.length >= 2 && !/^[−+\-–—]?[\d.,]+%?(pp)?$/.test(x));
      if (words.length / cells.length >= 0.6) textCols++;
    }
    out.push({ cols, textCols });
  }
  return out;
}

export function pageMetrics(slideHtml, idx = 0) {
  const s = String(slideHtml);
  const blocks = leafBlocks(s);
  const noNotes = s.replace(/<div class="notes">[\s\S]*?<\/div>/g, '');
  const notesM = /<div class="notes">([\s\S]*?)<\/div>/.exec(s);
  const proseBlocks = blocks.filter(b => /\b(concl|lede-s|lede)\b/.test(b.cls));
  const tables = tableTextCols(s);
  const recipes = blocks
    .map(b => (b.cls.match(/\b(kicker|h1|h2c|concl|lede-s|lede|stat|tbl|card-soft|card|rowb|row|grid|pill|case|phase)\b/) || [, null])[1])
    .filter(Boolean)
    .filter((v, i, a) => !(i && a[i - 1] === v));
  return {
    n: idx + 1,
    dataTitle: (/data-title="([^"]*)"/.exec(s) || [, ''])[1],
    kicker: stripTags((/<p class="kicker"[^>]*>([\s\S]*?)<\/p>/.exec(s) || [, ''])[1]).replace(/\s+/g, ' ').trim(),
    title: stripTags((/<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(s) || [, ''])[1]).replace(/\s+/g, ' ').trim(),
    hasH1: /<h1[\s>]/.test(s),
    textChars: nospace(noNotes).length,
    blocks: blocks.length,
    cards: countEls(s, RE_CARD),
    stats: countEls(s, RE_STAT),
    pills: countEls(s, RE_PILL),
    tags: countEls(s, RE_TAG),
    tables: tables.length,
    tableRows: (s.match(/<tr[\s>]/g) || []).length,
    tablesWithoutTextCol: tables.filter(t => t.cols >= 2 && t.textCols === 0).length,
    bolds: (s.match(/<b[\s>]/g) || []).length,
    blockMax: Math.max(0, ...blocks.map(b => b.len)),
    proseMax: Math.max(0, ...proseBlocks.map(b => b.len)),
    notesChars: notesM ? nospace(notesM[1]).length : 0,
    secNotes: countEls(s, /\bsec-note\b/),
    recipe: recipes.join('>')
  };
}

export function deckMetrics(slides) {
  const list = Array.isArray(slides) ? slides : splitSlides(slides);
  const pages = list.map((s, i) => pageMetrics(typeof s === 'string' ? s : s.html, i));
  const sum = k => pages.reduce((a, p) => a + p[k], 0);
  const max = k => Math.max(0, ...pages.map(p => p[k]));
  const content = pages.filter(p => p.n > 1);
  return {
    pages,
    totals: {
      pages: pages.length,
      textChars: sum('textChars'),
      avgChars: pages.length ? Math.round(sum('textChars') / pages.length) : 0,
      cards: sum('cards'), cardMax: max('cards'),
      stats: sum('stats'), statMax: max('stats'),
      bolds: sum('bolds'), boldMax: max('bolds'),
      tables: sum('tables'), tableRows: sum('tableRows'),
      badTables: sum('tablesWithoutTextCol'),
      longProsePages: content.filter(p => p.blockMax >= RUBRIC.longProse).length,
      plainPages: content.filter(p => p.blockMax < RUBRIC.contentBlockMin).map(p => p.n),
      noNotes: pages.filter(p => p.notesChars < RUBRIC.notesMin).map(p => p.n),
      longNotes: pages.filter(p => p.notesChars > RUBRIC.notesMax).map(p => p.n),
      noSecNote: content.filter(p => p.secNotes === 0).map(p => p.n),
      distinctRecipes: new Set(pages.map(p => p.recipe)).size
    }
  };
}

/* ------------------------------------------------------------ 判据
 *
 * 每一条都写着"参照稿实测值", 门槛都给参照稿留了余量(通常 25–30%)。
 * 唯一的例外是 contentBlockMin=90: 参照稿内容页最短的一段是 93 字(跟踪页),
 * 我们自己那版最短 86 字(轮动页) —— 90 这条线刚好把"最弱的那页"点出来而放过参照稿, 是有意的。
 *
 * 全部只报 warn: 内容形态是软的, 硬拦会导致一次跑不出演示稿, 那比稿子差点更糟。
 */
export const RUBRIC = {
  pagesMin: 7, pagesMax: 10,              // 参照 8
  avgCharsMin: 550,                       // 参照 616
  boldTotalMax: 70, boldPageMax: 16,      // 参照 54, 单页最多 14
  cardTotalMax: 28, cardPageMax: 6,       // 参照 22, 单页最多 5
  statTotalMax: 8, statPageMax: 4,        // 参照 6,  单页最多 4
  tableMax: 4,                            // 参照 3
  notesMin: 40, notesMax: 160,            // 参照 74–116
  contentBlockMin: 90,                    // 参照内容页最短 93
  longProse: 180, longProsePagesMin: 2,   // 参照 4 页(258/290/220/206)
  wantCover: true                         // 参照第 1 页: h1 + ≥2 pill + 免责说明, 且没有 h2c
};

export function checkRubric(deck, R = RUBRIC) {
  const issues = [];
  const add = (msg) => issues.push({ level: 'warn', msg });
  const t = deck.totals;

  if (t.pages < R.pagesMin || t.pages > R.pagesMax) {
    add(`共 ${t.pages} 页(参照 8 页, 允许 ${R.pagesMin}–${R.pagesMax}) —— 页数失控通常意味着没有取舍`);
  }
  if (t.avgChars < R.avgCharsMin) {
    add(`均 ${t.avgChars} 字/页(参照 616, 下限 ${R.avgCharsMin}) —— 页面内容偏薄`);
  }
  if (t.bolds > R.boldTotalMax) {
    add(`全篇加粗 ${t.bolds} 处(参照 54, 上限 ${R.boldTotalMax}) —— 到处都是重点等于没有重点`);
  }
  if (t.boldMax > R.boldPageMax) {
    const p = deck.pages.find(x => x.bolds === t.boldMax);
    add(`第 ${p.n} 页加粗 ${t.boldMax} 处(上限 ${R.boldPageMax}, 参照单页最多 14)`);
  }
  if (t.cards > R.cardTotalMax) {
    add(`全篇卡片 ${t.cards} 张(参照 22, 上限 ${R.cardTotalMax}) —— 卡片堆出来的是清单, 不是分析`);
  }
  if (t.cardMax > R.cardPageMax) {
    const p = deck.pages.find(x => x.cards === t.cardMax);
    add(`第 ${p.n} 页 ${t.cardMax} 张卡片(上限 ${R.cardPageMax}, 参照单页最多 5)`);
  }
  if (t.stats > R.statTotalMax) {
    add(`全篇指标卡 ${t.stats} 个(参照 6, 上限 ${R.statTotalMax}) —— 指标卡只该用在"成绩"和"最新一期"两类页`);
  }
  if (t.statMax > R.statPageMax) {
    const p = deck.pages.find(x => x.stats === t.statMax);
    add(`第 ${p.n} 页 ${t.statMax} 个指标卡(上限 ${R.statPageMax})`);
  }
  if (t.tables > R.tableMax) add(`全篇 ${t.tables} 张表(参照 3, 上限 ${R.tableMax})`);
  if (t.badTables) add(`有 ${t.badTables} 张表整张都是裸数字 —— 参照稿每张表都带一列人话(备注/判定/变化)`);
  if (t.noNotes.length) add(`第 ${t.noNotes.join(',')} 页讲者备注不足 ${R.notesMin} 字`);
  if (t.longNotes.length) {
    const p = deck.pages.filter(x => t.longNotes.includes(x.n)).sort((a, b) => b.notesChars - a.notesChars)[0];
    add(`第 ${t.longNotes.join(',')} 页讲者备注超过 ${R.notesMax} 字(最长 ${p.notesChars}; 参照 74–116) —— 备注是给自己提词, 不是第二份稿子`);
  }
  if (t.plainPages.length) {
    add(`第 ${t.plainPages.join(',')} 页最长的一段文字不到 ${R.contentBlockMin} 字 —— 内容被切得太碎, 读不出分析`);
  }
  if (t.longProsePages < R.longProsePagesMin) {
    add(`只有 ${t.longProsePages} 页有 ≥${R.longProse} 字的连续论述(参照 4 页, 下限 ${R.longProsePagesMin})`);
  }
  if (t.noSecNote.length) {
    add(`第 ${t.noSecNote.join(',')} 页没有段末注记(.sec-note) —— 参照稿每个内容页都用它交代口径/归因/提醒`);
  }
  if (R.wantCover) {
    const p1 = deck.pages[0];
    if (!p1 || !p1.hasH1 || p1.pills < 2) {
      add(`第 1 页不像封面(参照稿: h1 大标题 + ≥2 个 pill 元信息 + 一行免责) —— 现在的第 1 页是 ${p1 && p1.hasH1 ? '' : '没有 h1, '}${p1 ? p1.pills : 0} 个 pill`);
    }
  }
  return issues;
}

/** 参照稿路径(用户认可的 519191 回溯复盘 PPT)。
 *  优先用环境变量指定的真迹, 否则回落到仓库内的测试样本 tools/_fixtures/reference_deck.html
 *  (tools/ 不进分发包, 所以这份样本只服务于本机回归测试)。找不到返回 null, 调用方跳过而不是报错。 */
export function referenceDeckPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cands = [
    process.env.FUNDCLINIC_REF_DECK,
    path.resolve(here, '..', 'tools', '_fixtures', 'reference_deck.html')
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch { /* 忽略 */ } }
  return null;
}
