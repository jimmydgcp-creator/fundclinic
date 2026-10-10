/* test_deck_rubric.mjs —— 演示稿形态判据的回归测试
 *
 * 这个测试的由来是一次真实翻车(2026-10-10):
 *   用户说"我的模板是这份 519191 回溯复盘 PPT"。我把生成稿和参照稿逐页量了一遍, 发现我上一轮
 *   写进 validateDeck 的三条判据**会把参照稿本身判成不合格** ——
 *     "每页必须有一段 ≥170 字连续论述" / "每页卡片 ≤3" / "每页加粗 ≤9"
 *   参照稿 8 页里有 5 页要被报警(轮动页 5 张卡、案例页 14 处加粗、绩效页根本没有长论述块)。
 *   根因: 我拿**均值**(674 字/页 · 7 处加粗/页)当**逐页硬顶**, 而参照稿的强项恰恰是"每页形态都不同"。
 *
 * 所以这里守的第一条不是"判据会不会响", 而是**"判据会不会把参照稿判错"**。
 * 判据一旦误伤参照稿, 这个测试就红 —— 这是唯一能防止同类错误再犯的办法。
 *
 * 用法: node tools/test_deck_rubric.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeck } from '../server/deckagent.mjs';
import { deckMetrics, checkRubric, splitSlides, RUBRIC, referenceDeckPath } from '../server/deckmetrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, label, extra) => { console.log((c ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  ' + extra : '')); if (!c) fail++; };
const hits = (issues, re) => issues.filter(i => re.test(i.msg)).map(i => i.msg);

/* ============================================================ ① 参照稿必须零告警 */
console.log('=== ① 参照稿(用户指定的模板)必须零告警 ===\n');
const refPath = referenceDeckPath();
if (!refPath) {
  console.log('  SKIP  未找到参照稿样本(tools/_fixtures/reference_deck.html)');
} else {
  const ref = deckMetrics(fs.readFileSync(refPath, 'utf8'));
  const t = ref.totals;
  console.log(`  实测: ${t.pages} 页 · 均 ${t.avgChars} 字/页 · 加粗 ${t.bolds}(单页最多 ${t.boldMax}) · ` +
    `卡片 ${t.cards}(${t.cardMax}/页) · 指标卡 ${t.stats}(${t.statMax}/页) · 表 ${t.tables} · 骨架 ${t.distinctRecipes} 种\n`);
  const refIssues = checkRubric(ref);
  ok(refIssues.length === 0, '内容形态判据对参照稿 0 条告警', refIssues.length ? refIssues.map(i => i.msg).join(' | ') : '');
  // 逐条门槛单独再验一遍, 免得某条门槛刚好被别的条件遮住
  ok(t.pages >= RUBRIC.pagesMin && t.pages <= RUBRIC.pagesMax, `页数 ${t.pages} 在 ${RUBRIC.pagesMin}–${RUBRIC.pagesMax} 内`);
  ok(t.avgChars >= RUBRIC.avgCharsMin, `均字数 ${t.avgChars} ≥ ${RUBRIC.avgCharsMin}`);
  ok(t.bolds <= RUBRIC.boldTotalMax && t.boldMax <= RUBRIC.boldPageMax, `加粗 ${t.bolds}≤${RUBRIC.boldTotalMax} 且单页最多 ${t.boldMax}≤${RUBRIC.boldPageMax}`);
  ok(t.cards <= RUBRIC.cardTotalMax && t.cardMax <= RUBRIC.cardPageMax, `卡片 ${t.cards}≤${RUBRIC.cardTotalMax} 且单页最多 ${t.cardMax}≤${RUBRIC.cardPageMax}`);
  ok(t.stats <= RUBRIC.statTotalMax && t.statMax <= RUBRIC.statPageMax, `指标卡 ${t.stats}≤${RUBRIC.statTotalMax} 且单页最多 ${t.statMax}≤${RUBRIC.statPageMax}`);
  ok(t.noNotes.length === 0 && t.longNotes.length === 0, '讲者备注全部落在 40–160 字');
  ok(t.plainPages.length === 0, `每页最长文字块都 ≥${RUBRIC.contentBlockMin} 字`);
  ok(t.noSecNote.length === 0, '每个内容页都有段末注记(.sec-note)');
  ok(ref.pages[0].hasH1 && ref.pages[0].pills >= 2, '第 1 页被认成封面(h1 + ≥2 pill)');
}

/* ============================================================ ② 我们上一版真 Key 跑出来的稿子: 该报的必须报出来 */
console.log('\n=== ② 我们真实生成过的稿子: 该报的必须报出来 ===\n');
const ourPath = path.join(ROOT, '_runs', '005825', '演示稿_申万菱信智能驱动股票A_005825_深度版.html');
if (!fs.existsSync(ourPath)) {
  console.log('  SKIP  未找到 _runs/005825 的生成稿(本机跑过才有)');
} else {
  const our = deckMetrics(fs.readFileSync(ourPath, 'utf8'));
  const ourIssues = checkRubric(our);
  const t = our.totals;
  console.log(`  实测: ${t.pages} 页 · 均 ${t.avgChars} 字/页 · 加粗 ${t.bolds}(单页最多 ${t.boldMax}) · ` +
    `卡片 ${t.cards}(${t.cardMax}/页) · 指标卡 ${t.stats} · 备注最长 ${Math.max(...our.pages.map(p => p.notesChars))} 字\n`);
  for (const [re, label] of [
    [/全篇加粗/, '抓到"加粗过量"(上一版 184 处 vs 参照 54)'],
    [/全篇卡片/, '抓到"卡片摊平"(上一版 46 张 vs 参照 22)'],
    [/全篇指标卡/, '抓到"指标卡堆砌"(上一版 19 个 vs 参照 6)'],
    [/讲者备注超过/, '抓到"备注写成小作文"(最长 310 字 vs 参照 116)'],
    [/不像封面/, '抓到"第 1 页不是封面"'],
    [/没有段末注记/, '抓到"缺段末注记"']
  ]) ok(hits(ourIssues, re).length > 0, label, hits(ourIssues, re)[0] || '未触发');
  ok(ourIssues.every(i => i.level === 'warn'), '这些判据只报警告、不阻断(内容风格是软的, 硬拦会一次都跑不出稿)');
}

/* ============================================================ ③ 人造对照: 好页不报, 烂页全报 */
console.log('\n=== ③ 人造对照: 好页不该报, 烂页该全报 ===\n');
const prose = '黄海任期内约 +77% 的主体来自 2022–2023 资源与红利顺风期, 剔除 2022Q1 单季的 +30.49% 之后, 区间收益只剩 +35.47%。'
  + '顺风期大幅超额, 2022 年 +53.13pp、2023 年 +23.95pp; 逆风期连续两年跑输, 2024 年 −12.39pp、2025 年 −7.44pp。'
  + '组合真正的软肋不是选股, 而是高集中、高波动叠加上规模负反馈: 最大回撤约 −32.45%, 净资产从 16.72 亿缩到 2.92 亿元。';

const GOOD_COVER = `<section class="slide" data-title="封面">
  <p class="kicker">基金经理回溯复盘 · Fund Manager Review</p>
  <div class="rule"></div>
  <h1 class="h1" style="font-size:72px">黄海 × 万家新利 519191<br><span class="gradient-text">2020Q4–2026Q2 · 回溯复盘</span></h1>
  <p class="lede" style="max-width:56ch">一只名义"灵活配置"、实质 90%+ 权益资源红利的基金。</p>
  <div class="row wrap"><span class="pill pill-accent">区间 23 期</span><span class="pill">数据截止 2026-06-30</span><span class="pill">整理 2026-09-08</span></div>
  <p class="sec-note">基于公开季报数据的回溯分析, 不构成投资建议。</p>
  <div class="notes">${'开'.repeat(60)}</div>
</section>`;

// 参照稿形态的内容页: 一段长论述 + 2 张卡 + 段末注记 + 5 处加粗
const GOOD_PAGE = `<section class="slide" data-title="先说结论">
  <p class="kicker">01 · 先说结论</p>
  <h2 class="h2c">收益的顺风含量很高, 软肋在集中度与规模</h2>
  <div class="concl">${prose}</div>
  <div class="grid g2 mt-m anim-stagger-list">
    <div class="card"><h4>三条核心证据</h4><p class="sec-note"><b>① 超额的时间结构:</b>顺风与逆风分明。<br><b>② 剔除爆季敏感性:</b>区间 +76.77% → +35.47%。<br><b>③ 主题轴与言行:</b>能源占比 0→86.4%→44.9%。</p></div>
    <div class="card" style="border-left:3px solid var(--bad)"><h4>最大反证</h4><p class="sec-note">若把两年跑输判为能力问题, 结论应改为质疑选股能力。</p></div>
  </div>
  <p class="sec-note mt-m"><b>口径:</b>只用官方定期报告披露值, 累计净值口径一律不用。</p>
  <div class="notes">${'讲'.repeat(60)}</div>
</section>`;

// 摊平的页: 短论述 + 8 张卡 + 14 处加粗 + 没有段末注记
const BAD_PAGE = `<section class="slide" data-title="绩效总览">
  <p class="kicker">02 · 绩效总览</p>
  <h2 class="h2c">绩效总览</h2>
  <div class="concl">收益很高, 回撤也不小。</div>
  <div class="grid g4">${'<div class="card"><b>数字</b></div>'.repeat(8)}</div>
  <p>${'<b>重点</b>'.repeat(14)}</p>
  <div class="notes">${'短'.repeat(20)}</div>
</section>`;

const good = checkRubric(deckMetrics([GOOD_COVER, GOOD_PAGE, GOOD_PAGE]));
/* 这一段只断言**逐页**判据: 人造稿只有 3 页、均字数必然到不了 550, 拿它去验"全篇页数与均字数"
   是测法不对(会为了凑字数把测试写成假稿)。全篇级门槛钉在真参照稿上, 见 ① 。 */
const goodPage = good.filter(i => /第 \d+ 页/.test(i.msg));
ok(goodPage.length === 0, '参照稿形态的人造页逐页判据零告警', goodPage.map(i => i.msg).join(' | '));
console.log(`         (另有 ${good.length - goodPage.length} 条全篇级提示, 3 页人造稿必然触发, 不计入)`);

const bad = checkRubric(deckMetrics([GOOD_COVER, BAD_PAGE, BAD_PAGE]));
for (const [re, label] of [
  [/第 2 页 8 张卡片/, '抓到"单页卡片超 6"'],
  [/单页最多 14/, '抓到"单页加粗超 16"前先报全篇'],
  [/讲者备注不足 40 字/, '抓到"备注太短"'],
  [/最长的一段文字不到 90 字/, '抓到"内容切得太碎"'],
  [/没有段末注记/, '抓到"缺段末注记"']
]) ok(hits(bad, re).length > 0, label, hits(bad, re)[0] || '未触发');

// 封面缺失 / 不像封面
const noCover = checkRubric(deckMetrics([BAD_PAGE, BAD_PAGE, BAD_PAGE]));
ok(hits(noCover, /不像封面/).length > 0, '抓到"没有封面页"');

/* ============================================================ ④ 与 validateDeck 的接线 */
console.log('\n=== ④ 判据已接进 validateDeck(不是只写在工具里) ===\n');
const whole = '<html><body><div class="deck"></div></body></html>';
const slides = [{ html: GOOD_COVER }, { html: BAD_PAGE }, { html: BAD_PAGE }];
const r = validateDeck(whole, slides, null);
ok(r.metrics && typeof r.metrics.bolds === 'number', 'validateDeck 返回了形态度量', JSON.stringify(r.metrics));
ok(hits(r.issues, /全篇加粗|全篇卡片|第 2 页 8 张卡片/).length > 0, 'validateDeck 会报出形态问题');
ok(r.issues.filter(i => i.level === 'fail').length === 0, '形态问题全是 warn, 不阻断出稿');

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
