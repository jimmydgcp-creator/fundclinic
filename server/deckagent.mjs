/* T6 · 演示稿生成(html-ppt 技能驱动)
 *
 * 为什么要有这个模块:
 *   原来的 server/deck.mjs 是**模板填充器** —— 版式写死, 大模型只往里塞数字, 出来必然是
 *   一副"报表感", 用户一眼就看出模板化。用户认可的参考稿(519191 回溯复盘 PPT)不是这么做出来的:
 *   它是**按内容选版面、按内容写文案**, 由 html-ppt 技能的设计系统渲染的。
 *
 * 这里复刻的就是那条链路, 分三步、三次 LLM 介入:
 *   ① 分镜(storyboard): 读完整报告 MD → 决定"讲几页、每页主张是什么、用哪个版面"
 *   ② 逐页成文: 每页单独一次调用, 把该页对应的报告章节 + 版面范式 + 组件清单给它 → 输出该页 HTML
 *   ③ 内联打包: base.css + 主题 + deck-kit + runtime.js 全部内联 → 一个能直接发给别人的 HTML
 *
 * 纪律:
 *   - 设计系统由技能提供, 大模型**不允许写 <style>、不允许自造类名** —— 否则版式会散。
 *   - 数字必须落在证据包白名单里, 越界即报(不静默通过)。
 *   - 单文件、零外链、可离线打印, 这是"能发给别人"的硬要求。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLMRaw } from './pipeline-llm.mjs';
import { deckMetrics, checkRubric } from './deckmetrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'html-ppt');
const KIT_FILE = path.join(ROOT, 'skills', 'deck-kit.css');

/* 可切换的主题(全部内联, T 键循环; 第一个是默认)。
   只列适合投研汇报的, 36 套里那些赛博朋克/千禧风的留作彩蛋不放进循环。 */
export const DECK_THEME_NAMES = [
  'corporate-clean', 'minimal-white', 'swiss-grid', 'editorial-serif', 'academic-paper',
  'sharp-mono', 'magazine-bold', 'japanese-minimal', 'news-broadcast', 'pitch-deck-vc',
  'engineering-whiteprint', 'blueprint'
];

/** 版面目录(对应技能 templates/single-page/*.html 的 31 种)。只把名字给大模型, 让它按内容挑。 */
const LAYOUTS = [
  ['cover', '封面: 大标题 + 副标题 + 元信息'],
  ['stat-highlight', '单个巨大数字 + 一句解读, 用来砸最重要的那个数'],
  ['kpi-grid', '三到六个指标卡并排, 适合"总成绩一屏看完"'],
  ['table', '数据表, 适合年度/逐季超额、逐期持仓'],
  ['comparison', '左右对照, 适合"优势 vs 局限""成功 vs 失误"'],
  ['timeline', '时间轴, 适合阶段划分、净值走势的关键节点'],
  ['process-steps', '步骤流程, 适合方法论的执行顺序'],
  ['bullets', '要点列表, 适合清单式结论'],
  ['two-column', '左右分栏, 适合"证据 + 解读"'],
  ['three-column', '三栏, 适合并列的三条线索'],
  ['pros-cons', '正反两面, 适合成对风险'],
  ['big-quote', '大字引语, 用来放基金经理季报原话'],
  ['chart-bar', '柱状图, 适合逐季收益/集中度序列'],
  ['chart-line', '折线图, 适合净值与回撤路径'],
  ['section-divider', '章节分隔页'],
  ['todo-checklist', '跟踪清单, 适合"下一步看什么、怎么证伪"'],
  ['roadmap', '路线图, 适合未来观察窗口'],
  ['diff', '前后差异, 适合"上期 vs 本期持仓变化"'],
  ['mindmap', '结构图, 适合方法论框架'],
  ['thanks', '结尾页']
].map(([n, d]) => `- ${n}: ${d}`).join('\n');

/* 允许大模型使用的类。base.css 的原语 + deck-kit 的组件, 别的都不行。 */
const ALLOWED_BASE = 'deck slide card card-soft card-accent card-outline card-hover grid g2 g3 g4 stack row rowb wrap center tc tl tr h1 h2 h3 h4 kicker lede eyebrow pill pill-accent divider divider-accent num mono serif gradient-text mt-s mt-m mt-l mb-s mb-m mb-l dim dim2 notes';
const ALLOWED_KIT = 'stat n l s up dn wt tag tag-ok tag-bad tag-blue tag-gray phasetag phase case rule lab kb hl cl dot pnum sec-note tbl concl h2c lede-s anim-fade-up anim-fade-down anim-stagger-list';
const ANIM_VALUES = 'fade-up fade-down fade-left fade-right zoom-in';

/* ------------------------------------------------------------ 资源装载 */

let _assets = null;
function assets() {
  if (_assets) return _assets;
  const A = p => fs.readFileSync(path.join(SKILL_DIR, 'assets', p), 'utf8');
  const themes = {};
  for (const f of fs.readdirSync(path.join(SKILL_DIR, 'assets', 'themes'))) {
    if (f.endsWith('.css')) themes[f.replace(/\.css$/, '')] = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'themes', f), 'utf8');
  }
  _assets = {
    fonts: A('fonts.css'),
    base: A('base.css'),
    runtime: A('runtime.js'),
    anims: fs.readFileSync(path.join(SKILL_DIR, 'assets', 'animations', 'animations.css'), 'utf8'),
    themes,
    kit: fs.readFileSync(KIT_FILE, 'utf8')
  };
  return _assets;
}

export function skillsInstalled() {
  try { assets(); return true; } catch (e) { return false; }
}

/** 去掉远程字体引用 —— 单文件要能离线打开, CDN 字体在别人机器上多半加载不出来,
 *  留着只会造成"我这儿好看、他那儿错位"。 */
function stripRemote(css) {
  return css
    .replace(/@import\s+url\([^)]*\)\s*;?/g, '')
    .replace(/@import\s+["'][^"']*["']\s*;?/g, '')
    .replace(/url\(\s*["']?https?:\/\/[^)]*\)/g, 'none');
}

/** 把每套主题的**所有**选择器都限定到 [data-theme="名"] 之下。
 *
 *  原来只把 `:root` 改写成 `:root[data-theme="名"]`, 这不够, 而且后果很隐蔽:
 *  36 套主题里有 **116 条顶层规则不是 :root 开的** —— body / .card / .kicker / h1.title /
 *  .divider-accent / .slide / .slide::before / .pill / .gradient-text / a …
 *  只限定 :root 的话, 单文件版里这 116 条**36 套同时生效**, 谁在源码里靠后就盖住谁
 *  (按文件名字母序, 于是 y2k-chrome 的 chrome 渐变、pitch-deck-vc 的 .slide 内边距、
 *  academic-paper 的 .card 描边全糊在一起)。表现出来是: 分镜选了"瑞士网格", 卡片描边却是
 *  别的主题的 —— 主题切换只换了变量, 没换骨架。2026-10-10 发现并修。
 *
 *  规则: 每条顶层选择器都加作用域; @media/@supports 递归进去; @keyframes/@font-face 原样保留
 *  (关键帧里的 `to{...}` 不是选择器, 加作用域会把动画弄坏)。
 *  注意先去掉注释 —— 主题文件开头都有 `/* theme: xxx *​/`, 不去掉会被当成选择器的一部分。 */
function scopeTheme(name, css) {
  const scope = `[data-theme="${name}"]`;
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const scoped = prelude => prelude.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    if (/^:root\b/.test(s)) return `:root${scope}`;
    if (/^html\b/.test(s)) return s.replace(/^html/, `html${scope}`);   // html 自己带 data-theme, 不能写成后代
    return `${scope} ${s}`;
  }).join(',');
  const walk = text => {
    let res = '', seg = '', i = 0;
    while (i < text.length) {
      if (text[i] === '{') {
        const prelude = seg.trim();
        let depth = 1, k = i + 1;
        while (k < text.length && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
        const body = text.slice(i + 1, k - 1);
        if (/^@(media|supports|layer|container)\b/.test(prelude)) res += `${prelude}{${walk(body)}}`;
        else if (/^@/.test(prelude)) res += `${prelude}{${body}}`;
        else res += `${scoped(prelude)}{${body}}`;
        seg = ''; i = k;
      } else { seg += text[i]; i++; }
    }
    return res + seg;
  };
  return `/* theme: ${name} */\n` + walk(src).trim() + '\n';
}

/* ------------------------------------------------------------ 报告 MD 切分 */

function splitReport(md) {
  const out = [];
  const lines = String(md || '').split(/\r?\n/);
  let cur = { heading: '(开头)', body: [] };
  for (const ln of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(ln);
    if (m) { out.push(cur); cur = { heading: m[1], body: [] }; }
    else cur.body.push(ln);
  }
  out.push(cur);
  return out.filter(s => s.body.join('\n').trim()).map(s => ({ heading: s.heading, text: s.body.join('\n').trim() }));
}

/* 章节的**身份是名字, 不是编号** —— 匹配前先把序号摘掉。
 *
 * 为什么必须这样(2026-10-10): 报告里「可复制的方法 × 不能被神化的部分」这一节由大模型综述生成,
 * 没通过校验时整节不出现, 于是后面所有节的序号都会往前挪(十 → 九、十一 → 十)。
 * 而分镜提示词里的 sourceHeading 是模型从报告里抄的, 抄的是**当时的编号**;
 * 只要编号一挪, 精确匹配就会失败, 那一页的正文就拿不到报告原文, 只能靠硬指标硬写 ——
 * 这种失败是静默的(页面照样出来, 只是内容变空)。
 * 只摘"序号 + 分隔符"这种形态, 所以 "2026Q2 最新季" 这种以数字开头的标题不会被误伤。 */
const stripSecNum = s => String(s == null ? '' : s)
  .replace(/^\s*(?:第)?(?:[一二三四五六七八九十百零]{1,3}|\d{1,2})\s*[、.．,，:：]\s*/, '')
  .trim();

export function pickSection(sections, ref) {
  if (!ref) return null;
  const key = stripSecNum(ref);
  if (!key) return null;
  let hit = sections.find(s => stripSecNum(s.heading) === key);
  if (!hit) hit = sections.find(s => { const h = stripSecNum(s.heading); return h.includes(key) || key.includes(h); });
  if (!hit) {
    // 再退一步: 报告标题常写成 "主旨 · 副标题", 用 · 前面那段实词去撞
    const core = key.split(/[·・:：]/)[0].trim();
    if (core && core !== key) hit = sections.find(s => stripSecNum(s.heading).includes(core));
  }
  return hit || null;
}

/* ------------------------------------------------------------ ① 分镜 */

const STORY_SYSTEM = '你是中文金融演示稿的排版主编。你只输出 JSON。';

function storyboardPrompt({ reportMd, fund, analysis, themeHint, slideHint }) {
  const m = (analysis && analysis.metrics) || {};
  return `下面是一只基金的完整复盘报告(Markdown 全文)。请把它编排成一套演示稿。

## 报告
${reportMd}

## 已知硬指标(编排时用来抓重点, 不要改写)
- 基金: ${fund.name}(${fund.code}) · 经理 ${fund.manager} · 区间 ${fund.range} · ${analysis.quarterCount} 个报告期
- 形态: ${analysis.form.tag}(置信度 ${analysis.form.confidence})
- 集中度均值 ${m.conc ? m.conc.avg.toFixed(2) : '-'}%(区间 ${m.conc ? m.conc.min : '-'}–${m.conc ? m.conc.max : '-'}%)
${analysis.perf ? `- 区间复利 ${analysis.perf.cumReturn}% · 剔除最好一季 ${analysis.perf.exBestQuarter}% · 最大回撤 ${analysis.perf.maxDrawdown}%` : '- 本次无绩效数据'}

## 编排要求
1. 一共 **${slideHint || 8} 页**(7–10 页可接受, 但每多一页都要有理由)。第 1 页是封面, 最后一页是"结论与跟踪"。
2. **页序照下面这份已被用户认可的参照稿骨架来**(同一只基金 519191 的复盘稿, 用户指定的模板)。
   内容按本基金替换, **骨架不要改**; 若报告里确实缺某一类内容(例如无绩效数据、样本期不足),
   就把该页换成报告真正有的东西, 但**不要因此缩成 6 页长得一样的页** —— 页与页必须长得不一样。
     ① **封面**: h1 大标题 + 一行 60–120 字导语(说清"名义上是什么、实质上在做什么、这份复盘回答什么")
        + 3–4 个 pill 元信息(区间与期数 / 数据截止 / 净值参照 / 整理日) + 一行免责说明。
        封面不放卡片、不放指标卡、不写 h2c 主张式标题。
     ② **一页看全(总纲)**: 四块按顺序固定, **缺一块就算没写完** ——
        ⓐ 核心问题: 一个带问号的尖锐问题(例: "2026Q2 起降集中度, 是纠错, 还是又一次风格试探?")
        ⓑ 主张: 一段 **200–290 字**的连续论述, 一条可被检验的判断而不是描述
        ⓒ 三条核心证据: 编号 ①②③, 每条必须带数字
        ⓓ 最大反证: 单独成块, 标题原文就写「最大反证」, 说清"这条判断最可能错在哪"
        这一页信息密度最高, 也是听众唯一可能记住的一页。
     ③ **成绩与代价**: **4 个指标卡**(区间收益 / 剔除最好一季 / 最大回撤 / 规模变化)
        + 一张年度(或逐期)超额表(末列写"备注", 用人话点出该期性质) + 一段分层归因注记。
     ④ **持仓结构演变**: **三到四个阶段卡**(阶段名 + 区间 + 主题占比变化 + 该阶段结果)
        + 一行量化条(集中度均值与峰谷 / 留存均值 / 在榜最多的几只) + 一段"换挡铁证"注记。
     ⑤ **方法论拆解**: 框架卡 + 一张"名实错配 / 预期与结果反差"卡
        + 一张"季报原文要点 → 下一期前十动作 → 判定"的对账表。
     ⑥ **关键调仓案例**: **成对呈现**(成功与失误各 1–2 个, 用边框颜色区分), 每个案例写清
        当时可得信号 / 动作 / 结果 / 复盘一句话; 末尾一段"共同点"注记。
     ⑦ **最新一期结构**: 左侧 2 个指标卡 + 2 个说明块(退出方 / 单季表现), 右侧最新一期前十变化表。
     ⑧ **结论与跟踪**: 证实方向卡 + 证伪方向卡 + 下季观察清单(有序列表 5–6 条) + 一句话收尾(.concl)。
   如果报告缺某一类内容, **替换内容而不是替换骨架**: 例如没有绩效数据, ③ 就换成"证据能到哪一步/不能到哪一步"，
   仍然要有指标卡之外的一段论述与一张带人话列的表。
3. 每页标题必须是一句主张(能下判断的话), 不能是栏目名。
   反例: "绩效总览" / "持仓结构" / "方法论拆解"
   正例: "对照看, 不挑好看的数字" / "23 个季度 = 四次主题换挡" / "框架五年不漂移, 名义与实质长期错配"
4. 每页的 kicker 用 "0N · 中文栏目名" 格式; 封面用 "基金经理回溯复盘 · Fund Manager Review"。
5. 每页从下面挑一个 layout(它只影响版式, 不改变上面定下的页序骨架):
${LAYOUTS}
6. 每页 sourceHeading 填报告里对应的二级标题原文(形如 "三、总成绩也看清代价"), 系统据此把该章正文喂给写手。
7. 每页 ask 用一句话说清这页要回答什么问题, 是给写手的指令, 不是给人看的。
8. notes 是讲者备注, **40–140 字**, 口语, 告诉讲的人这页怎么讲、哪句是重点。
   **不要写成第二份稿子** —— 超过 160 字讲的时候就念不完了。也不要复述页面文字。
9. **密度配额(上一版就是在这里翻车的, 必须遵守; 括号内是参照稿实测值)**:
   - 全篇加粗 **≤70 处**, 单页 **≤16 处**(参照稿 54 处 / 单页最多 14; 我们上一版 184 处 / 单页 30)
   - 全篇卡片 **≤28 张**, 单页 **≤6 张**(参照稿 22 张; 我们上一版 46 张)
   - 全篇指标卡 **≤8 个**, 单页 **≤4 个**, 且**只允许出现在 ③ 成绩页与 ⑦ 最新一期页**
     (参照稿 6 个; 我们上一版 19 个, 几乎每页都堆)
   - 表格 **≤4 张**, 每张表都要有一列写人话(备注 / 判定 / 变化)
   - 每个内容页最长的一段文字 **≥90 字**; 全篇至少 **2 页**有 ≥180 字的连续论述(② 必须有)
   - 每个内容页末尾都要有一段**段末注记**(.sec-note), 交代口径、归因边界或提醒
10. 页序要有叙事: 结论 → 证据 → 拆解 → 案例 → 现状 → 反证与跟踪。不要把同性质的内容连着排三页。
11. theme 从这些里挑一个最贴基金气质的: ${DECK_THEME_NAMES.join(', ')}。${themeHint ? `(用户指定: ${themeHint})` : ''}
## 输出 JSON
{"deckTitle":"不超过 40 字的演示稿标题","theme":"主题名","slides":[{"kicker":"","layout":"","title":"","ask":"","sourceHeading":"","notes":""}]}`;
}

/* ------------------------------------------------------------ ② 逐页成文 */

const SLIDE_SYSTEM = '你是中文演示稿的版面写手。你只输出 HTML 片段, 不输出解释、不输出 Markdown 代码块围栏。';

/* 版面原型 —— 直接把参照稿的每一页写出来给写手看。
 *
 * 为什么不再交给模型自由发挥: 上一版只给了一个"通用骨架"(kicker → h2c → concl → 卡片),
 * 结果 005825 那套 10 页里 8 页都是同一个开头(kicker>h2c>concl>stat…), 而且**第 1 页根本不是封面**
 * —— 模型用了封面的 kicker, 却写了一页正文。参照稿 8 页有 6 种不同骨架, 每页的讲法都不一样,
 * 这份差异就是"不是模板"的来源, 必须显式写进提示词, 不能指望模型自己悟。
 *
 * 另: 上一版让第 2 页的「最大反证」用 .gap-block / .falsifier —— 这两个类名在 base.css 和
 * deck-kit.css 里都不存在(我查过), 写上去等于裸奔。参照稿用的是 card + border-left。 */
function archetype({ index, total, fund, slide }) {
  const last = total - 1;
  if (index === 0) {
    return `【封面 · 参照稿第 1 页】照这个骨架写:
<p class="kicker" data-anim="fade-down">基金经理回溯复盘 · Fund Manager Review</p>
<div class="rule"></div>
<h1 class="h1" data-anim="fade-up" style="font-size:72px">${fund.manager} × ${fund.name} ${fund.code}<br><span class="gradient-text">${fund.range} · 回溯复盘</span></h1>
<p class="lede" data-anim="fade-up" style="max-width:56ch;margin-top:22px">60–120 字导语: 名义上是什么、实质上在做什么、这份复盘要回答什么</p>
<div class="row wrap" style="margin-top:34px;gap:12px">
  <span class="pill pill-accent">复盘区间 …… · N 个报告期</span>
  <span class="pill">数据截止 ……</span>
  <span class="pill">净值参照 ……</span>
  <span class="pill">整理 ……</span>
</div>
<p class="sec-note" style="margin-top:46px;max-width:80ch">基于公开季报/年报数据的回溯分析(证据分级:披露事实/合理推断/事后解读),不构成投资建议;过往业绩不代表未来收益。</p>
<div class="notes">…</div>
**封面不许出现 h2c, 不许放 card / stat。**`;
  }
  if (index === 1) {
    return `【一页看全 · 参照稿第 2 页】四块按顺序, 缺一块就算没写完:
<p class="kicker" data-anim="fade-down">${slide.kicker}</p>
<div class="rowb" style="margin-top:6px"><div class="dot" style="background:var(--warn)"></div><span style="color:var(--text-3);font-size:13px">核心问题: …一个带问号的尖锐问题…</span></div>
<h2 class="h2c">主张式标题</h2>
<div class="concl" data-anim="fade-up">**200–290 字**连续论述, 带 <b>加粗</b> 与数字, 句子之间有因果和转折</div>
<div class="grid g2 mt-m anim-stagger-list">
  <div class="card"><h4 style="font-size:19px">三条核心证据</h4>
    <p class="sec-note" style="font-size:14px"><b>① ……:</b>……<br><b>② ……:</b>……<br><b>③ ……:</b>……</p></div>
  <div class="card" style="border-left:3px solid var(--bad)"><h4 style="font-size:19px">最大反证</h4>
    <p class="sec-note" style="font-size:14px">……这条判断最可能错在哪……</p></div>
</div>
<div class="notes">…</div>
第四块的标题**原文就写「最大反证」**, 容器用 class="card" + style="border-left:3px solid var(--bad)"。
**不要用 .gap-block / .falsifier —— 这两个类名在项目里不存在, 用了等于没有任何样式。**`;
  }
  if (index === last) {
    return `【结论与跟踪 · 参照稿第 8 页】这页是整份复盘的可证伪落点:
<p class="kicker" data-anim="fade-down">${slide.kicker}</p>
<h2 class="h2c">怎么证明"判断对了", 怎么证明"判断错了"</h2>
<div class="grid g2 mt-m anim-stagger-list">
  <div class="card" style="border-top:3px solid var(--good)"><h4 style="font-size:18px;color:var(--good)">证实方向 → …</h4>
    <p class="sec-note" style="font-size:14px;margin-top:6px">…具体到可核对的条件与阈值…</p></div>
  <div class="card" style="border-top:3px solid var(--bad)"><h4 style="font-size:18px;color:var(--bad)">证伪方向 → …</h4>
    <p class="sec-note" style="font-size:14px;margin-top:6px">…如果出现 X, 说明结论要改成 Z…</p></div>
</div>
<div class="card mt-m" style="border-left:3px solid var(--warn);padding:14px 20px"><b style="font-size:16px">失效条件:</b><span class="sec-note" style="font-size:14.5px">…</span></div>
<div class="grid g2 mt-m" style="gap:18px">
  <div class="card-soft" style="padding:16px 20px"><h4 style="font-size:16px;margin-bottom:8px">下季观察清单(预计 …… 披露)</h4>
    <ol class="sec-note" style="font-size:13.5px;margin:0;padding-left:20px;line-height:1.9"><li>…</li><li>…</li></ol></div>
  <div class="stack"><div class="concl" style="font-size:16.5px;line-height:1.75;padding:16px 20px">一句话收尾: ……</div>
    <p class="sec-note" style="margin-top:16px">本报告基于公开定期报告与公开数据回溯分析, 不构成投资建议; 完整证据见同目录复盘 MD 与工作簿。</p></div>
</div>
<div class="notes">…</div>
观察清单 **5–6 条**, 每条都要能被四个月后的下一份季报直接核对 —— 这是下次更新的入口。`;
  }
  return `【内容页 · 参照稿第 3–7 页之一】按本页 ask 与 layout 从下面挑最贴的一种骨架。
挑之前看一眼前后页: **连着两页用同一种骨架就要换一种。**
  · 指标卡 + 表(成绩页): 4 个 <div class="stat"> 并排 + 一张 <table class="tbl">(末列"备注") + 段末注记
  · 阶段卡(结构演变页): 3–4 个 <div class="card phase"> 并排(内含 <span class="phasetag"> + 占比变化 + 该阶段结果) + 一行量化条 + 段末注记
  · 框架卡 + 对账表(方法论页): grid g2 两个 card + 一张"原话要点 → 下一期动作 → 判定"表 + 段末注记
  · 成对案例页: grid g2 铺 4 个 <div class="card case">, 成功用 border-top:3px solid var(--good), 失误用 var(--bad);
    每个案例写清 当时信号 / 动作 / 结果 / 复盘一句话; 末尾一段"共同点"注记
  · 左数右表(最新一期页): 左列 2 个 stat + 2 个 card-soft, 右列一张前十变化表(末列"变化")
指标卡**只能**用在"成绩页"与"最新一期页", 其他页一律改用 card + 论述。`;
}

function slidePrompt({ slide, index, total, section, facts, fund }) {
  return `你在写一套演示稿的第 ${index + 1} / ${total} 页。

## 这一页的任务
- kicker: ${slide.kicker}
- 主张(标题): ${slide.title}
- 要回答的问题: ${slide.ask || '(未指定)'}
- 建议版面: ${slide.layout}
- 讲者备注(由你自己润色后放进 <div class="notes">): ${slide.notes || ''}

## 可用的报告原文(本页内容必须来自这里)
${section ? `【${section.heading}】\n${section.text}` : '(该页对应的章节未匹配到, 请只使用下面的硬指标)'}

## 全篇硬指标(可以引用, 但数字必须逐字照抄)
${facts}

## 允许使用的 class(只能用这些, **不要自造类名, 不要写 <style>**)
base.css: ${ALLOWED_BASE}
deck-kit: ${ALLOWED_KIT}
动效: 在需要入场动画的元素上加 data-anim="${ANIM_VALUES.split(' ').join('|')}", 列表容器可以加 class="anim-stagger-list"

## 版面原型(先看这一页属于哪一种, 再动手)
${archetype({ index, total, fund, slide })}

## 通用写法
- 外层固定 <section class="slide" data-title="短标题"> … </section>, 结尾必须有 <div class="notes">讲者备注</div>。
- **密度配额**(括号里是参照稿实测值; 上一版就是在这里翻车的):
  · 本页总字数 **550–750**(参照稿 616/页)
  · 本页**最长的一段文字 ≥90 字**(参照稿内容页最短 93; 上一版有页只有 86)
  · 加粗 **4–10 处, 单页绝不超过 16**(参照稿全篇 54 处 / 单页最多 14; 上一版 184 处 / 单页 30)
    只加粗**判断句**, 不要加粗数字(数字本身已经够显眼)
  · 卡片(div class="card" 或 card-soft)**单页 ≤6**(参照稿单页最多 5; 上一版到 12)
  · **指标卡(div class="stat")单页 ≤4, 且只有"成绩页"和"最新一期页"可以用**(参照稿全篇仅 6 个; 上一版 19 个)
  · 表格**最多 4 张**, 每张都要有一列写人话(备注/判定/变化) —— 整张裸数字的表不算分析
  · **不要把一段分析拆成四张卡**: 拆了就成清单了, 清单不是分析
- **每个内容页末尾都要有一段段末注记**: <p class="sec-note mt-m"><b>口径 / 归因 / 提醒:</b>…</p>,
  100–290 字, 交代这一页数字的口径边界、归因限制, 或最容易被误读的地方。参照稿每个内容页都有。
- 讲者备注 **40–140 字**, 口语, 告诉讲的人这页怎么讲、哪句是重点。**不要写成第二份稿子**(超过 160 字就念不完)。
- 引用经理原话时用 big-quote 版面, 并在下方用小字标出处(例: "—— 2025Q1 季报「投资策略和运作分析」")。
- 正文 15–19px, 小标题 19–22px, 大数字 42–76px, 用内联 style 控制。
- 涨用 <span class="up">, 跌用 <span class="dn">, 需警惕用 <span class="wt">。
- 关键数字可以包 <b class="pnum"> 让它用等宽数字对齐。
- 允许用 <br> 在卡片内分行; 中文标点用全角, 数字与单位之间不加空格。
- 并排的卡片/指标卡外层写 class="anim-stagger-list" data-anim-target(runtime 会拿这个标记当入场动画的目标,
  参照稿就是这么多写一个属性); 需要入场动画的单个元素加 data-anim="fade-up"。

## 纪律
- 不要写"综上所述""值得注意的是""总而言之"这类空话。
- 不要出现: 马后炮、抄底、逃顶、精准预测、封神、必涨、稳赚、跑赢大盘(无基准时)。
- 只描述已发生的事实, 不做未来收益判断。
- 基金名统一写「${fund.name}」, 经理写「${fund.manager}」。

只输出 <section>...</section> 这一段 HTML。`;
}

/* ------------------------------------------------------------ ③ 内联打包 */

function buildHtml({ deckTitle, fund, theme, slides, factsLine }) {
  const A = assets();
  const themeList = [theme].concat(DECK_THEME_NAMES.filter(t => t !== theme));
  const css = [
    '/* ---- fonts (远程引用已剥离, 回落到系统字体) ---- */', stripRemote(A.fonts),
    '/* ---- base.css (html-ppt 设计系统) ---- */', stripRemote(A.base),
    '/* ---- themes: 全部内联, 用 [data-theme] 切换 ---- */',
    ...Object.keys(A.themes).sort().map(n => scopeTheme(n, stripRemote(A.themes[n]))),
    '/* ---- animations ---- */', stripRemote(A.anims),
    '/* ---- deck-kit: 版面组件 ---- */', A.kit
  ].join('\n');

  const body = slides.map(s => s.html.trim()).join('\n\n');
  const total = slides.length;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}" data-themes="${themeList.join(',')}" data-theme-base="data:text/css,">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deckTitle)}</title>
<!-- 单文件版: 主题已全部内联, 这个 link 只是占位, 让 runtime 的主题逻辑有处可写(落成 data: URI, 不产生任何网络请求) -->
<link rel="stylesheet" id="theme-link" href="data:text/css,">
<style>
${css}
</style>
<style>
/* 打印/导出: 一页一张, 不裁切。
 *
 * 三条都是**必须**的, 每一条都对应一次真实翻车:
 *  ① 拆掉"一次只显示一页"的机制。屏幕态 .deck 是 height:100vh + overflow:hidden, .slide 是
 *     position:absolute + opacity:0。2026-10-10 实测: 只改 .slide 不改 .deck, 一个 8 页的
 *     单文件演示稿用 headless Edge --print-to-pdf **只出 1 页**。所以 .deck / html / body 的
 *     高度与溢出必须一起放开, 且只用一种分页方式(再加 page-break-after 会多出空白页)。
 *  ② 动效复位。内联进来的 animations.css 里写着
 *     「.anim-stagger-list > * {opacity:0; animation:kf-rise … both}」—— 基础样式就是 opacity:0,
 *     靠动画把它抬到 1。屏幕上没问题, 但打印时浏览器对没显示过的页不会真的跑动画, 元素就停在
 *     opacity:0, 于是"打印出来整块内容不见了"。这份教训本项目踩过两次(app/styles.css 的
 *     .view.active): **凡是在打印里关掉动画, 就必须同时把 opacity 顶回 1**。
 *  ③ 渐变字回落。.gradient-text 在 PDF 里会渲染成空白, 封面的区间副标题就挂在这个类上。
 *  (base.css / animations.css 里也各带了一份同样的打印复位, 这里再写一遍是刻意的 ——
 *   生成器不该依赖素材文件有没有被改对。) */
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{height:auto!important;overflow:visible!important;background:#fff}
  .deck{display:block!important;height:auto!important;width:auto!important;overflow:visible!important;position:static!important}
  .anim-stagger-list > *,
  [data-anim],
  [class*="anim-"]{opacity:1!important;animation:none!important;transform:none!important;filter:none!important}
  .gradient-text{-webkit-text-fill-color:var(--accent)!important;background:none!important;color:var(--accent)!important}
  .slide{position:relative!important;display:flex!important;opacity:1!important;transform:none!important;
    width:1280px!important;height:720px!important;break-inside:avoid;page-break-inside:avoid}
  .slide + .slide{break-before:page;page-break-before:always}
  .deck-footer{position:static}
  .notes{display:none!important}
}
</style>
</head>
<body>
<div class="deck">
${body}

  <!-- 全局页脚(runtime 自动刷新页码) -->
  <div class="deck-footer"><span>${esc(fund.name)} ${esc(fund.code)} · ${esc(fund.manager)}任内回溯复盘 · ${esc(fund.range)}</span><span class="slide-number" data-current="1" data-total="${total}"></span></div>
</div>
${factsLine ? `<!-- 数据口径: ${esc(factsLine)} -->\n` : ''}<script>
${A.runtime}
</script>
</body>
</html>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------ 校验 */

const BANNED = ['马后炮', '抄底', '逃顶', '精准预测', '封神', '必涨', '稳赚'];

export function validateDeck(html, slides, allowedNumbers) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });

  // 1. 单文件: 不能有外链
  const ext = [...html.matchAll(/<(?:link|script|img)[^>]*(?:href|src)="((?!#|data:)[^"]+)"/g)].map(m => m[1]);
  if (ext.length) add('fail', '存在外部资源引用(单文件必须自包含): ' + ext.slice(0, 5).join(', '));

  // 2. 违禁词
  BANNED.forEach(w => { if (html.includes(w)) add('fail', `出现禁用词「${w}」`); });

  // 3. 每页必须有 notes
  slides.forEach((s, i) => {
    if (!/<div class="notes">[\s\S]{20,}<\/div>/.test(s.html)) add('warn', `第 ${i + 1} 页缺讲者备注(<div class="notes">)`);
    if (!/<h2[^>]*class="[^"]*h2c/.test(s.html) && i > 0) add('warn', `第 ${i + 1} 页没有 .h2c 主张式标题`);
    /* 加粗下限从 3 改到 1(2026-10-10): 参照稿绩效页只有 1 处加粗 —— 那页靠表格和指标卡说话,
       加粗少是对的。真正该拦的是"一处都没有"(等于整页没有重点)。
       上限不在这里管, 统一交给 checkRubric 的全篇/单页配额。 */
    if ((s.html.match(/<b[\s>]/g) || []).length === 0 && i > 0) add('warn', `第 ${i + 1} 页一处加粗都没有, 整页没有重点`);
    if (/<style[\s>]/i.test(s.html)) add('fail', `第 ${i + 1} 页私自写入了 <style>, 会破坏设计系统`);
  });

  // 4. 数字回查: 页面里每个百分数/亿元级数字都要在证据包里出现过
  if (allowedNumbers && Object.keys(allowedNumbers).length) {
    const seen = new Set();
    for (const s of slides) {
      for (const m of s.html.matchAll(/(-?\d+(?:\.\d+)?)\s*(%|pp|亿元|亿份)/g)) {
        const v = m[1];
        if (allowedNumbers[v] === undefined) seen.add(v + m[2]);
      }
    }
    if (seen.size) add('warn', `以下数字未在证据包白名单中(可能被改写或臆造): ${[...seen].slice(0, 12).join(', ')}`);
  }

  // 5. 标签配平(粗查)
  for (const tag of ['section', 'div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'p', 'span', 'b', 'h2', 'h4']) {
    for (const s of slides) {
      const open = (s.html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
      const close = (s.html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      if (open !== close) add('fail', `第 ${slides.indexOf(s) + 1} 页 <${tag}> 标签不配平(开 ${open} / 闭 ${close})`);
    }
  }

  /* 6. 「模板化」检测 —— 这是本模块最该守住的一条。
     模板填充器的特征不是难看, 而是**每页长得一样**: 同样的骨架、同样的元素组合、同样的信息量。
     用户在网页版上抱怨的正是这个。所以这里量两个东西:
       ① 各页的"结构指纹"(顶层子元素序列)有多少种 —— 全一样就是模板
       ② 各页的组件种类数(表格/卡片/指标卡/列表/引语)是否单调
     只报警告不拦, 因为单页结构雷同有时确实是内容决定的; 但连成一片就该回炉。 */
  const fingerprint = html => (html.match(/<(?:h2|h4|table|div|p|ul|ol)\b[^>]*class="([^"]*)"/g) || [])
    .map(x => (/"([^"]*)"/.exec(x) || [, ''])[1].split(/\s+/).filter(c => /^(tbl|card|stat|concl|grid|rowb|case|tag|phase|bullets)$/.test(c)).sort().join('+'))
    .filter(Boolean).join('>');
  const prints = slides.map(s => fingerprint(s.html));
  const distinctPrints = new Set(prints.filter(Boolean)).size;
  if (slides.length >= 4 && distinctPrints <= Math.ceil(slides.length / 2)) {
    add('warn', `结构指纹只有 ${distinctPrints} 种 / ${slides.length} 页 —— 页面之间长得太像, 有模板化风险, 建议让分镜换更多版面`);
  }
  const kinds = slides.map(s => ['tbl', 'card', 'stat', 'concl', 'grid'].filter(k => new RegExp(`class="[^"]*\\b${k}\\b`).test(s.html)).length);
  if (slides.length >= 4 && new Set(kinds).size === 1) {
    add('warn', `每页都用了同样数量的组件(${kinds[0]} 种), 版式缺少变化`);
  }

  /* 7. 内容形态对齐参照稿 —— 判据在 server/deckmetrics.mjs, 这里只调用。
     由来(2026-10-10): 用户指出"我的模板是这份 519191 回溯复盘 PPT"。我把生成稿和参照稿逐页量了,
     发现我上一轮写的三条判据**会把参照稿本身判成不合格**:
       · "每页必须有一段 ≥170 字连续论述" —— 参照稿 8 页里只有 3 页有(结论页 258 字、最新季页 206、跟踪页 93),
         绩效/轮动/案例三页根本没有, 它们靠"表 + 一组卡 + 段末注记"讲清楚;
       · "每页卡片 ≤3" —— 参照稿轮动页 5 张、案例页 4 张、跟踪页 4 张;
       · "每页加粗 ≤9" —— 参照稿结论页 11 处、案例页 14 处。
     根因是拿**均值**当**逐页硬顶**。均值掩盖了页与页的差异, 而这份参照稿的强项恰恰是"每页形态都不同"。
     现在的判据全部来自逐页实测值, 并且 tools/test_deck_rubric.mjs 会**拿参照稿本身跑一遍,
     要求 0 条告警** —— 判据一旦把参照稿判成不合格, 测试就红。 */
  const metrics = deckMetrics(slides.map(s => s.html));
  checkRubric(metrics).forEach(x => add(x.level, x.msg));

  /* 8. 反证必须成块出现。参照稿把「最大反证」当成必答题, 放在总纲页里单独一块, 而不是塞进结论的一句尾巴。 */
  const anyFalsifier = slides.some(s => /最大反证|最可能错|失效条件|推翻条件/.test(s.html));
  if (!anyFalsifier) add('warn', '整本演示稿里找不到「最大反证 / 最可能错在哪」的成块内容 —— 参照稿把它当必答题');

  const fails = issues.filter(i => i.level === 'fail');
  return { ok: !fails.length, issues, fails: fails.length, warns: issues.length - fails.length, distinctPrints, kinds, metrics: metrics.totals };
}

/* ------------------------------------------------------------ 主流程 */

/**
 * @param {object} o
 * @param {object} o.llm        { apiKey, baseUrl, model }
 * @param {string} o.reportMd   深度复盘报告 Markdown(agent 主笔的那份; 没有就退用引擎版)
 * @param {object} o.fund       { code, name, manager, range }
 * @param {object} o.analysis   引擎分析结果
 * @param {object} o.dataset    采集数据集(用来取官方对账/校准结论)
 * @param {string} [o.theme]    指定主题
 * @param {number} [o.slideHint]
 * @param {function} [o.onProgress]
 */
export async function authorDeck(o) {
  const { llm, reportMd, fund, analysis, dataset } = o;
  const onProgress = o.onProgress || (() => {});
  if (!llm || !llm.apiKey) throw new Error('生成演示稿需要 API Key(AI 模块为必选)');
  if (!skillsInstalled()) throw new Error('未找到 skills/html-ppt, 无法生成演示稿');
  const t0 = Date.now();
  const log = [];
  const usage = { calls: 0, promptChars: 0, completionChars: 0 };

  const sections = splitReport(reportMd);
  const m = analysis.metrics || {};
  const cal = dataset.perfCalibration || {};
  const facts = [
    `- 基金 ${fund.name}(${fund.code}), 经理 ${fund.manager}, 区间 ${fund.range}, ${analysis.quarterCount} 个报告期`,
    `- 形态标签「${analysis.form.tag}」, 置信度 ${analysis.form.confidence}`,
    m.conc ? `- 前十合计权重: 均值 ${m.conc.avg.toFixed(2)}%, 区间 ${m.conc.min.toFixed(2)}%–${m.conc.max.toFixed(2)}%, 趋势「${m.conc.trend}」` : '',
    m.churn ? `- 相邻期平均留存 ${m.avgRetained}/10 只, 平均新进 ${m.avgAdded} 只, Jaccard ${(m.avgJaccard || 0).toFixed(2)}` : '',
    m.totalDistinct ? `- 区间内共出现过 ${m.totalDistinct} 只个股` : '',
    analysis.perf ? `- 区间复利 ${analysis.perf.cumReturn}%, 剔除最好一季(${analysis.perf.bestQuarter})后 ${analysis.perf.exBestQuarter}%, 最大回撤 ${analysis.perf.maxDrawdown}%` : '- 本次无绩效数据',
    dataset.official && dataset.official.checks ? `- 官方定期报告逐行对账: ${dataset.official.checks.filter(c => c.reconcile && c.reconcile.ok).length}/${dataset.official.checks.length} 期一致` : '',
    cal.ok ? `- 官方窗口校准: ${cal.n} 期可比, 最大偏差 ${cal.maxAbsDiff}pp${cal.consistent ? '(口径一致)' : ''}` : `- 官方窗口校准: ${cal.reason || '未做'}`
  ].filter(Boolean).join('\n');

  const allowed = (o.evidence && o.evidence.allowedNumbers) || null;

  /* ---- ① 分镜 ---- */
  onProgress('T6 演示稿 · ① 分镜(读完整报告, 决定讲几页、每页主张)');
  const storyRes = await callLLMRaw(llm, {
    system: STORY_SYSTEM,
    user: storyboardPrompt({ reportMd, fund, analysis, themeHint: o.theme, slideHint: o.slideHint }),
    json: true, temperature: 0.35
  });
  usage.calls++; usage.completionChars += storyRes.content.length;
  let sb;
  try { sb = JSON.parse(storyRes.content); }
  catch (e) { throw new Error('分镜返回的不是合法 JSON: ' + storyRes.content.slice(0, 300)); }
  if (!sb || !Array.isArray(sb.slides) || !sb.slides.length) throw new Error('分镜没有产生任何页面');
  const theme = DECK_THEME_NAMES.includes(sb.theme) ? sb.theme : (DECK_THEME_NAMES.includes(o.theme) ? o.theme : DECK_THEME_NAMES[0]);
  sb.theme = theme;
  log.push(`分镜 ${sb.slides.length} 页 · 主题 ${theme}`);
  onProgress(`T6 演示稿 · 分镜完成: ${sb.slides.length} 页, 主题 ${theme}`);

  /* ---- ② 逐页成文 ---- */
  const slides = [];
  for (let i = 0; i < sb.slides.length; i++) {
    const slide = sb.slides[i];
    const sec = pickSection(sections, slide.sourceHeading);
    if (!sec) log.push(`第 ${i + 1} 页未匹配到报告章节「${slide.sourceHeading}」, 仅用硬指标`);
    onProgress(`T6 演示稿 · ② 第 ${i + 1}/${sb.slides.length} 页: ${slide.title || slide.kicker}`);
    let html = '';
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !html; attempt++) {
      try {
        const r = await callLLMRaw(llm, {
          system: SLIDE_SYSTEM,
          user: slidePrompt({ slide, index: i, total: sb.slides.length, section: sec, facts, fund }) +
            (attempt ? '\n\n【上一次输出有问题, 这次务必只输出 <section>...</section> 一段完整 HTML, 不要任何解释文字或代码围栏】' : ''),
          json: false, temperature: 0.45
        });
        usage.calls++; usage.completionChars += r.content.length;
        html = cleanSlideHtml(r.content);
        if (!html) lastErr = '模型没有返回 <section> 片段';
      } catch (e) { lastErr = e.message; }
    }
    if (!html) {
      log.push(`第 ${i + 1} 页生成失败(${lastErr}), 已跳过`);
      continue;
    }
    if (!/data-title=/.test(html)) html = html.replace('<section ', `<section data-title="${esc(String(slide.title || '').slice(0, 20))}" `);
    slides.push({ index: i, slide, html, section: sec ? sec.heading : null });
  }
  if (!slides.length) throw new Error('所有页面都生成失败, 未产出演示稿');

  /* ---- ③ 内联打包 ---- */
  onProgress('T6 演示稿 · ③ 内联打包(主题/base.css/runtime 全部内联为单文件)');
  const html = buildHtml({
    deckTitle: sb.deckTitle || `${fund.manager} × ${fund.name} ${fund.code} · 回溯复盘 ${fund.range}`,
    fund, theme, slides, factsLine: `${fund.range} · 数据截止 ${(dataset.fund && dataset.fund.range) || ''}`
  });

  const check = validateDeck(html, slides, allowed);
  log.push(...check.issues.slice(0, 20).map(x => `[${x.level}] ${x.msg}`));
  onProgress(`T6 演示稿 · 完成 ${slides.length} 页 · ${(html.length / 1024).toFixed(0)} KB · 校验 ${check.ok ? '通过' : check.fails + ' 项失败'}`);

  return {
    ok: true, html, storyboard: sb, slides: slides.map(s => ({ kicker: s.slide.kicker, title: s.slide.title, layout: s.slide.layout, section: s.section })),
    theme, check, log, usage, ms: Date.now() - t0
  };
}

/** 从模型输出里抠出 <section>...</section>, 容忍代码围栏与前后废话。 */
function cleanSlideHtml(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  const i = s.indexOf('<section');
  if (i < 0) return '';
  const j = s.lastIndexOf('</section>');
  if (j < 0) return '';
  s = s.slice(i, j + '</section>'.length);
  // 设计系统由 CSS 提供, 模型写的 <style> 一律剔除
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  return s.trim();
}
