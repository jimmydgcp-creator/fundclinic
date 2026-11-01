/* 生成今晚两份讲稿 Word：
 *   1) 我讲第 1 页（手机大字版，正文 16pt）
 *   2) 队友讲第 2、3 页（常规字号，正文 11pt）
 * 复用 docxkit 的 runsOf / runXml / writeDocx，只自己加一层「按用途定字号」的段落样式。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runsOf, runXml, writeDocx } from './docxkit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(here, '..', '..', '00_交作业');

function Para(text, o = {}) {
  const runs = runsOf(text, o);
  const body = runs.map(runXml).join('');
  const ppr = '<w:pPr>'
    + (o.align ? `<w:jc w:val="${o.align}"/>` : '')
    + (o.indent ? `<w:ind w:left="${o.indent}"/>` : '')
    + `<w:spacing w:before="${o.before ?? 80}" w:after="${o.after ?? 80}" w:line="${o.line ?? 320}" w:lineRule="auto"/>`
    + (o.shade ? `<w:shd w:val="clear" w:fill="${o.shade}"/>` : '')
    + '</w:pPr>';
  return `<w:p>${ppr}${body}</w:p>`;
}

const STYLES = {
  big: {
    title: { size: 22, bold: true, color: '1F3864', before: 0, after: 90 },
    sub: { size: 12.5, color: '666666', before: 0, after: 60, line: 300 },
    note: { size: 14, color: '8A5A00', shade: 'FFF7E6', before: 60, after: 140, line: 340 },
    h2: { size: 17, bold: true, color: '1F3864', before: 280, after: 110 },
    say: { size: 16, line: 370, before: 130, after: 130 },
    stage: { size: 13, color: '8A8A8A', before: 110, after: 110, line: 300 },
    li: { size: 14, line: 340, before: 60, after: 60, indent: 240 },
    small: { size: 11.5, color: '666666', line: 320, before: 40, after: 40, indent: 180 }
  },
  normal: {
    title: { size: 18, bold: true, color: '1F3864', before: 0, after: 70 },
    sub: { size: 10, color: '666666', before: 0, after: 50, line: 280 },
    note: { size: 10.5, color: '8A5A00', shade: 'FFF7E6', before: 50, after: 110, line: 300 },
    h2: { size: 13.5, bold: true, color: '1F3864', before: 240, after: 90 },
    say: { size: 11, line: 330, before: 100, after: 100 },
    stage: { size: 9.5, color: '8A8A8A', before: 80, after: 80, line: 280 },
    li: { size: 10.5, line: 300, before: 50, after: 50, indent: 220 },
    small: { size: 9, color: '666666', line: 280, before: 30, after: 30, indent: 160 }
  }
};

function render(lines, profile) {
  const S = STYLES[profile];
  return lines.map(([k, t]) => Para(t, { ...S[k] }));
}

function spoken(lines, dropOptional) {
  let txt = '';
  for (const l of lines) {
    if (l[0] !== 'say') continue;
    if (dropOptional) {
      txt += l[1].split(/(?<=[。！？])/).filter(s => !s.includes('【可删】')).join('');
    } else {
      txt += l[1];
    }
  }
  return (txt.replace(/\*\*/g, '').replace(/【可删】/g, '').match(/[\u4e00-\u9fff0-9A-Za-z]/g) || []).length;
}
const at220 = n => `${Math.floor(n / 220)} 分 ${String(Math.round((n % 220) / 220 * 60)).padStart(2, '0')} 秒`;

/* ---------- 1. 我讲第 1 页（大字） ---------- */
const doc1 = [
  ['title', '第 1 页讲稿 · 2 分 30 秒'],
  ['sub', '第 2 组 · 基金复诊台 · 10-14 第 5 次课 · 我讲第 1 页（当前进展）'],
  ['note', '顺序：① 持仓看不出经理在干什么 → ② 换人看不出 → ③ 归因 → ④ AI 不许编。四条都讲要念到 220 字/分钟才刚好 2 分 38 秒；标了【可删】的两句去掉是 2 分 30 秒以内。'],

  ['h2', '口播稿'],
  ['say', '大家好，我们是第 2 组，项目叫基金复诊台。给我一个 6 位基金代码，我给你一份复盘，里面每个数字都能翻回公开季报的原文。'],
  ['stage', '（停一下，等大家抬头）'],
  ['say', '做下来我们发现，普通人看基金，真正卡住的是四件事。'],
  ['stage', '（抬手，开始数）'],
  ['say', '第一，前十大持仓摆在那儿，看着很分散，你不知道这个经理是在坚守一个主题，还是到处乱买。我们把二十多个报告期的前十大连起来，让引擎判形态：519191 判出来是主题坚守型；只有 2 期数据的那只，标签直接写「样本不足」，不硬套。'],
  ['say', '第二，你只看一条收益率曲线，中间换过经理你多半不知道。我们专门抓了经理履历这一类来源，开跑前那张口径确认表，第一格就是「复盘哪一任经理」。比如 005827，现任只覆盖 1 期，引擎会建议换成覆盖 30 期的那一位，换不换由人定。'],
  ['say', '第三，赚的钱是市场给的还是经理赚的。【可删】涨的时候谁都像股神。季报里有业绩比较基准，我们拿区间收益算超额，再拆到逐季，看它是持续赚的，还是某一季冲上去的。519191 的逐季数据和官方季报对过，22 期全部一致。'],
  ['say', '第四件是我们给自己上的锁。AI 做这个，数字一多就危险，它编一个你未必看得出来。所以算数全部归脚本，AI 只负责写话。算完还得跟官方季报 PDF 逐行对账，519191 抽了 4 期全对，最大差 0.000pp。它也真的编过，一次编了 7 个数字，一次编了 39 个，都被拦下来了。'],
  ['stage', '（停一下，手落到「进展」这块）'],
  ['say', '网站 10 月 10 号已经上线，打开 fundclinic.onrender.com 输代码就能用，不用注册，也不用填 Key。到今天实跑了 5 只基金，回归测试 76 项全过。【可删】前面三条我们做成了自动动作，第四条是给 AI 上的锁。剩下两块卡点交给我的队友。'],
  ['stage', '（把话筒递出去，停半拍）'],

  ['h2', '上台前 30 秒'],
  ['li', '1. index.html 双击 → 按 F 全屏 → 按 → 确认能翻页；打不开换 备用_无需脚本版.html，再不行用 中期汇报_展示页.pdf'],
  ['li', '2. 提前 5 分钟打开 https://fundclinic.onrender.com 热机（免费档会休眠，首次请求实测最长约 145 秒）'],
  ['li', '3. 念到「进展」两个字的时候，表上应该还剩 1 分 10 秒'],

  ['h2', '数字出处'],
  ['small', '· 23 / 30 / 26 / 6 / 2 期、五种形态标签：展示页第 1 页对账表'],
  ['small', '· 4/4 期一致、最大差 0.000pp：展示页第 1 页（抽样＝首季、末季、每 4 季）'],
  ['small', '· 22/22 期、最大偏差 0.01pp：README.md §三'],
  ['small', '· 005827 覆盖 1 期 / 张坤 30 期：组内分工_5人上台.md A 段追问预案'],
  ['small', '· selftest 76/76：tools\\selftest.mjs；10/10 上线：展示页第 1 页']
];

/* ---------- 2. 队友讲第 2、3 页 ---------- */
const doc2 = [
  ['title', '第 2、3 页讲稿'],
  ['sub', '第 2 组 · 基金复诊台 · 第 2 页＝遇到的问题，第 3 页＝后续计划（这两页由一个人讲）'],
  ['note', '按 220 字/分钟算：全念约 3 分 05 秒；把三处【可删】去掉约 2 分 35 秒。你只有 2 分 30 秒左右的话，就按去掉的念；有 3 分钟就全念。'],

  ['h2', '第 2 页 · 遇到的问题'],
  ['say', '这一页讲我们还没解决的问题，一共四个。'],
  ['say', '第一个是钱。Key 在服务端，谁点开这个链接，花的都是我们的钱，实测跑一次 0.3 到 0.5 元。我们加了三道闸门：每台 3 次一小时、8 次一天，全站 40 次一天。全站这个数定多少合适，我们想听老师的意见。'],
  ['say', '第二个是数据源。天天基金是网页接口，没有版本承诺，一改版我们就可能抓不到。所以我们只把它当交叉验证，最高权威始终是官方季报 PDF。【可删】自检靠几条「逻辑上不可能」的规则，比如单一个股占净值超过 10%。【可删】另外 ETF、联接基金这类结构的前十大怎么取，还没做适配。'],
  ['say', '第三个是方法边界。季报只披露前十大，还是期末那一天的快照，期间怎么买卖看不见，所以我们只能做期末结构加前后两期对比，做不了真实换手率。'],
  ['say', '第四个问题是我们自己。区间写的是 2020Q4 到 2026Q2，基准点却取成了第一个报告期的期末，第一个季度被整个漏掉，收益从 76.77% 虚增到 85.97%。【可删】我们当时还当成修正写进了文档。最后是官方逐季披露值把它钉死的：改成期初后回到 76.80%，逐季对账 22 期全部一致。所以后来我们定了条规矩：工具算出来的数字比手算的还漂亮的时候，先别高兴，先去核对。'],

  ['h2', '第 3 页 · 后续计划'],
  ['say', '最后是接下来四周，两件事：让别人也能用，多覆盖几种基金形态。'],
  ['say', '10 月 24 号前，每个组员在自己电脑上从零独立复跑两只全新基金，记录卡在哪、花了多久。【可删】这是中期最硬的一条证据，它证明别人也能跑。'],
  ['say', '11 月 5 号前，做结论卡横向对比页，补合规边界页，再补 ETF 和联接基金这类结构的取数适配。'],
  ['say', '11 月 10 号前交终展材料，要有演示视频或者截图，还有组内分工表；11 月 11 号第 9 次课，每组 10 分钟，含问答。'],
  ['say', '主线已经跑通，剩下的是让别人也能用。我们交的不是一份 PPT，是一个别人点开就能用的网页。谢谢大家，网站是 fundclinic.onrender.com。'],
  ['stage', '（全体一起上前）'],

  ['h2', '可能被追问'],
  ['li', '· 一天最多花多少钱？40 次 × 0.3 到 0.5 元 ≈ 12 到 20 元封顶，闸门都是可以调的。'],
  ['li', '· 第三方数据坏了怎么办？只影响交叉验证，报告以官方季报 PDF 为准；自检规则会把可疑字段标出来。'],
  ['li', '· 为什么做不了真实换手？季报是期末快照，期间买卖公开渠道看不见，这条边界每份报告都写明。'],

  ['h2', '数字出处'],
  ['small', '· 0.3 到 0.5 元/次、3 次/小时、8 次/天、40 次/天：展示页第 2 页'],
  ['small', '· 76.77% → 85.97% → 76.80%、22/22 期：README.md §三'],
  ['small', '· 单一个股 ≤10%、前十合计 ≤100% 这类自检：SOP v2.5 §3 第五类'],
  ['small', '· 10/24、11/05、11/10、11/11 四个节点：展示页第 3 页路线图']
];

/* 时间提示按实测字数现算，改稿子不用回来改数字 */
for (const l of doc1) if (l[0] === 'note') {
  l[1] = `顺序：① 持仓看不出经理在干什么 → ② 换人看不出 → ③ 归因 → ④ AI 不许编。正文 ${spoken(doc1)} 字，按 220 字/分钟约 ${at220(spoken(doc1))}；标了【可删】的两句去掉是 ${spoken(doc1, true)} 字，约 ${at220(spoken(doc1, true))}。`;
}
for (const l of doc2) if (l[0] === 'note') {
  l[1] = `正文 ${spoken(doc2)} 字，按 220 字/分钟约 ${at220(spoken(doc2))}；把四处【可删】去掉是 ${spoken(doc2, true)} 字，约 ${at220(spoken(doc2, true))}。你这部分如果只有 2 分 30 秒，就按去掉的念。`;
}

const d1 = render(doc1, 'big');
const d2 = render(doc2, 'normal');
console.log('== 我讲第 1 页（大字版）==');
console.log('  口播字数 ' + spoken(doc1) + '（去掉【可删】' + spoken(doc1, true) + '）');
writeDocx(path.join(OUTDIR, '中期汇报_讲稿_第1页_手机大字版.docx'), d1, {
  must: ['第 1 页讲稿', '基金复诊台', '样本不足', '22 期全部一致', '0.000pp', 'fundclinic.onrender.com', '上台前 30 秒']
});
console.log('== 队友讲第 2、3 页 ==');
console.log('  口播字数 ' + spoken(doc2) + '（去掉【可删】' + spoken(doc2, true) + '）');
writeDocx(path.join(OUTDIR, '中期汇报_讲稿_第2-3页_队友版.docx'), d2, {
  must: ['第 2、3 页讲稿', '0.3 到 0.5 元', '三道闸门', '官方季报 PDF', '10 月 24 号前', '11 月 5 号前', '11 月 10 号前', 'fundclinic.onrender.com']
});
