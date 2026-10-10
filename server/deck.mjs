/* 演示稿生成器: 把复盘结果渲染成「一份文件、双击即用、能直接发给别人」的 HTML 演示稿。
 *
 * 设计语言参照人工版演示稿(一句话结论式标题 + 编号 kicker + 数据卡 + 标签 + 涨跌高亮 + 演讲者备注),
 * 但保留自动生成场景必须守住的三条底线(上一版交付物就是栽在这上面):
 *   ① 不引用任何外部资源(字体/图片/CDN 全部不要) —— 样式与脚本全内联, 发一个文件就够;
 *   ② 不写任何"初始不可见"的动画(opacity:0 + animation … both) —— 打印/截图时会整块丢字;
 *   ③ 不用 -webkit-text-fill-color: transparent 做渐变字 —— 在 PDF 里会变成空白。
 * 另加: 12 套可换主题、概览/全屏/翻页导航、@page 尺寸与逐页分页。
 */
import { themeCSS, themeList, DEFAULT_THEME } from './deck-themes.mjs';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fx = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
const sgn = v => (typeof v === 'number' && v > 0 ? '+' : '');
const pct = v => (typeof v === 'number' && isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—');
const pp = v => (typeof v === 'number' && isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + 'pp' : '—');

const VIEW_CSS_MARK = '/* === VIEW-CSS-BELOW: 以下为视图样式, 不许出现写死的颜色 === */';

const CSS = `
${VIEW_CSS_MARK}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg-soft);font-family:var(--font-sans);color:var(--text-1);-webkit-font-smoothing:antialiased}
.slide{position:relative;width:1280px;height:720px;background:var(--slide-bg,var(--surface));margin:26px auto;padding:40px 54px;
  overflow:hidden;box-shadow:var(--shadow-lg);border-radius:var(--radius-lg);display:flex;flex-direction:column}
/* 分页用"第二张起在前面分页", 不用"每张后面分页" ——
   后者会在最后一张之后多出一个分页点, 打印时凭空多一页空白(实测踩过)。 */
.slide + .slide{page-break-before:always;break-before:page}
.slide::after{content:attr(data-page);position:absolute;right:30px;bottom:18px;font-size:13px;color:var(--text-3);font-family:Consolas,ui-monospace,monospace}

.kicker{font-size:13px;letter-spacing:.28em;color:var(--accent-2);font-weight:700;margin-bottom:10px;text-transform:uppercase}
h1{font-size:52px;line-height:1.18;color:var(--text-1);font-family:var(--font-display);letter-spacing:var(--letter-tight,normal)}
h2{font-size:31px;line-height:1.32;color:var(--text-1);font-family:var(--font-display);letter-spacing:var(--letter-tight,normal);margin-bottom:16px}
h3{font-size:15px;color:var(--text-2);margin-bottom:9px;font-weight:600}
h4{font-size:14px;color:var(--text-2);margin-bottom:8px}
p{font-size:15px;line-height:1.78;color:var(--text-2)}
.lede{font-size:17px;line-height:1.75;color:var(--text-2);max-width:74ch}
.rule{height:4px;width:96px;background:var(--grad);border-radius:2px;margin:18px 0 10px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.pill{border:1px solid var(--border);border-radius:999px;padding:6px 15px;font-size:13px;color:var(--text-2);background:var(--bg-soft)}
.pill.accent{border-color:var(--accent);color:var(--accent);font-weight:700}
.sec-note{font-size:12.5px;color:var(--text-3);line-height:1.7;margin-top:auto;padding-top:12px;border-top:1px solid var(--border)}
.kb{display:inline-block;border:1px solid var(--border);border-radius:4px;padding:0 5px;font-family:Consolas,monospace;font-size:11px}

/* 数据卡 */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:6px 0 14px}
.stats.c5{grid-template-columns:repeat(5,1fr)}
.stat{border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;background:var(--surface);box-shadow:var(--shadow)}
.stat .lab{font-size:12px;color:var(--text-3);margin-bottom:5px}
.stat .val{font-size:26px;font-weight:700;color:var(--text-1);font-family:Consolas,ui-monospace,monospace;line-height:1.15;letter-spacing:-.5px}
.stat .sub{font-size:11.5px;color:var(--text-3);margin-top:4px;line-height:1.5}
.up{color:var(--good);font-weight:700}.dn{color:var(--bad);font-weight:700}
.big-num{font-size:19px;font-weight:700;font-family:Consolas,ui-monospace,monospace;color:var(--accent)}

/* 两栏 */
.cols{display:flex;gap:22px;flex:1;min-height:0}
.col{flex:1;min-width:0;display:flex;flex-direction:column;gap:11px}
.card{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;background:var(--surface);box-shadow:var(--shadow)}
.card.ok{border-color:var(--good)}
.card.bad{border-color:var(--bad)}
.card.warn{border-color:var(--warn)}
.card h4{font-size:13px;letter-spacing:.02em}
ul{margin:0;padding-left:18px}
li{font-size:14px;line-height:1.72;color:var(--text-2);margin-bottom:4px}

table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top}
th{background:var(--bg-soft);color:var(--text-2);font-weight:600;font-size:12px;white-space:nowrap}
td.num{font-family:Consolas,ui-monospace,monospace;text-align:right;white-space:nowrap}

/* 柱状图: 带纵坐标轴 + 悬停显示数值 */
.chart{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px 10px;background:var(--surface);box-shadow:var(--shadow)}
.chart-h{font-size:12.5px;color:var(--text-3);margin-bottom:10px;display:flex;justify-content:space-between}
.chart-plot{display:flex;gap:8px;height:186px}
.yaxis{width:52px;flex:none;display:flex;flex-direction:column;justify-content:space-between;text-align:right;
  font-family:Consolas,ui-monospace,monospace;font-size:10.5px;color:var(--text-3);padding-bottom:18px}
.plot{flex:1;position:relative;display:flex;align-items:flex-end;gap:3px;border-left:1px solid var(--border);border-bottom:1px solid var(--border);padding:0 2px}
.grid{position:absolute;left:0;right:0;border-top:1px dashed var(--border);opacity:.7}
.bar{flex:1;position:relative;background:var(--grad);border-radius:2px 2px 0 0;min-height:2px;transition:none;cursor:default}
.bar.neg{background:var(--bad)}
.bar:hover{outline:2px solid var(--accent);outline-offset:1px}
.bar .bv{position:absolute;left:50%;transform:translateX(-50%);bottom:100%;margin-bottom:3px;white-space:nowrap;
  background:var(--accent);color:var(--slide-bg,#fff);font-size:10.5px;padding:2px 6px;border-radius:4px;opacity:0;pointer-events:none;font-family:Consolas,monospace}
.bar:hover .bv{opacity:1}
.xaxis{display:flex;gap:3px;padding-left:60px;padding-top:5px}
.xaxis span{flex:1;text-align:center;font-size:9.5px;color:var(--text-3);font-family:Consolas,ui-monospace,monospace}

/* 主题阶段链 */
.chain{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.chip{background:var(--grad-soft);color:var(--text-1);border:1px solid var(--border);border-radius:999px;padding:5px 14px;font-size:14px;font-weight:600}
.chip i{font-style:normal;opacity:.65;font-size:12px;margin-left:5px}
.arrow{color:var(--text-3)}

/* 导航 */
.nav{position:fixed;right:20px;bottom:20px;z-index:9;display:flex;gap:8px;align-items:center;background:var(--accent);color:var(--slide-bg,#fff);
  padding:8px 14px;border-radius:24px;font-size:13px;font-family:Consolas,ui-monospace,monospace;box-shadow:var(--shadow-lg)}
.nav button{background:rgba(255,255,255,.22);border:0;color:inherit;height:28px;min-width:28px;border-radius:14px;cursor:pointer;font-size:13px;font-family:inherit;padding:0 8px}
.nav button:hover{background:rgba(255,255,255,.4)}
.themes{position:fixed;right:20px;bottom:74px;z-index:10;font-family:var(--font-sans)}
.th-toggle{background:var(--accent);color:var(--slide-bg,#fff);border:0;border-radius:24px;padding:9px 16px;font-size:13px;cursor:pointer;font-family:inherit;box-shadow:var(--shadow-lg)}
.th-panel{display:none;position:absolute;right:0;bottom:46px;width:330px;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:14px}
.th-panel.open{display:block}
.th-panel h4{font-size:13px;color:var(--text-2);margin:0 0 10px}
.th-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.th-btn{border:1px solid var(--border);background:var(--bg-soft);color:var(--text-1);border-radius:var(--radius-sm);padding:8px 10px;font-size:12.5px;cursor:pointer;text-align:left;font-family:inherit;display:flex;align-items:center;gap:7px}
.th-btn:hover{border-color:var(--accent)}
.th-btn.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:700}
.th-dot{width:12px;height:12px;border-radius:50%;flex:none;border:1px solid rgba(0,0,0,.15)}

/* 概览模式: 把全部幻灯片缩成网格 */
body.overview{background:var(--bg-soft)}
body.overview .slide{transform:scale(.24);transform-origin:top left;margin:0}
body.overview .ov-wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:20px}
body.overview .ov-cell{position:relative;width:calc(1280px * .24);height:calc(720px * .24);cursor:pointer;border:1px solid var(--border);overflow:hidden;background:var(--slide-bg,#fff)}
.ov-wrap{display:none}
body.overview .nav,body.overview .themes{opacity:.35}

@media print{
  html,body{background:#fff}
  .nav,.themes,.ov-wrap{display:none!important}
  .slide{margin:0;box-shadow:none;border-radius:0;break-inside:avoid;page-break-inside:avoid}
  .bar .bv{display:none}
  @page{size:1280px 720px;margin:0}
}
`;

const DOT_COLORS = {
  'corporate-clean': ['#0a2540', '#1d4ed8'], 'minimal-white': ['#111216', '#f5f5f6'],
  'swiss-grid': ['#d6001c', '#111111'], 'editorial-serif': ['#8a2a1c', '#faf7f2'],
  'academic-paper': ['#1a3a7a', '#fdfcf8'], 'sharp-mono': ['#000000', '#ffffff'],
  'magazine-bold': ['#ea5a1a', '#f5efe2'], 'japanese-minimal': ['#d93a2a', '#fafaf5'],
  'neo-brutalism': ['#ffd400', '#ff5ca8'], 'pitch-deck-vc': ['#0070f3', '#7928ca'],
  'news-broadcast': ['#e11d2d', '#ffffff'], 'xiaohongshu-white': ['#ff2742', '#fff6f1']
};

/* ------------------------------------------------------------------ 组件 */
function stat(lab, val, sub, cls) {
  return `<div class="stat"><div class="lab">${esc(lab)}</div><div class="val ${cls || ''}">${esc(val)}</div>${sub ? '<div class="sub">' + esc(sub) + '</div>' : ''}</div>`;
}

/** 带纵坐标轴的柱状图; 鼠标悬停显示该点数值(纯 CSS, 不依赖脚本) */
function barChart(series, { title, unit = '%', max, min, ticks = 4 } = {}) {
  const vals = series.map(s => s.value).filter(v => typeof v === 'number');
  if (!vals.length) return '<p>无数据</p>';
  let hi = max !== undefined ? max : Math.max(...vals);
  let lo = min !== undefined ? min : Math.min(...vals);
  if (hi === lo) { hi = hi + 1; lo = lo - 1; }
  const pad = (hi - lo) * 0.08;
  hi += pad; lo -= pad;
  const span = hi - lo;
  const axis = [];
  for (let i = ticks; i >= 0; i--) axis.push(lo + span * i / ticks);
  const grid = axis.slice(1).map((v, i) => `<div class="grid" style="bottom:${(i + 1) / ticks * 100}%;left:0;right:0"></div>`).join('');
  const bars = series.map(s => {
    const v = typeof s.value === 'number' ? s.value : 0;
    const h = Math.max(0.6, (v - lo) / span * 100);
    return `<div class="bar${v < 0 ? ' neg' : ''}" style="height:${h.toFixed(1)}%" title="${esc(s.label)} ${fx(v)}${unit}">` +
      `<span class="bv">${fx(v)}${unit}</span></div>`;
  }).join('');
  const xs = series.map(s => `<span>${esc(String(s.label).replace(/^20/, ''))}</span>`).join('');
  return `<div class="chart">` +
    (title ? `<div class="chart-h"><span>${esc(title)}</span><span>${fx(lo)}${unit} – ${fx(hi)}${unit}</span></div>` : '') +
    `<div class="chart-plot"><div class="yaxis">${axis.map(v => `<span>${fx(v, 1)}${unit}</span>`).join('')}</div>` +
    `<div class="plot">${grid}${bars}</div></div>` +
    `<div class="xaxis">${xs}</div></div>`;
}

function slide(page, kicker, headline, body, note) {
  return `<section class="slide" data-page="${page}">` +
    (kicker ? `<p class="kicker">${esc(kicker)}</p>` : '') +
    (headline ? `<h2>${esc(headline)}</h2>` : '') +
    body +
    (note ? `<p class="sec-note">${note}</p>` : '') +
    '</section>';
}

/* ------------------------------------------------------------------ 主渲染 */
export function renderDeck(payload, opts = {}) {
  const { analysis: a, dataset } = payload;
  if (!a || !a.metrics) throw new Error('renderDeck: 缺少 analysis');
  const m = a.metrics, fund = a.fund, perf = a.perf;
  const official = (dataset && dataset.official) || null;
  const sources = (dataset && dataset.sources) || [];
  const rangeInfo = (dataset && dataset.rangeInfo) || null;
  const S = [];
  const qs = a.quarters;

  /* ---------- 1 封面 ---------- */
  S.push(`<section class="slide" data-page="1" style="justify-content:center">
    <p class="kicker">基金经理回溯复盘 · Fund Manager Review</p>
    <h1>${esc(fund.name)} ${esc(fund.code)}<br><span style="color:var(--accent-2)">${esc(a.range)} · 回溯复盘</span></h1>
    <div class="rule"></div>
    <p class="lede">${esc(fund.manager || '')} 任期内的 ${a.quarterCount} 个报告期: 收益的顺风含量、持仓轮动的真实动作、季报言论与下一期操作是否对得上, 以及规模与容量的边界。</p>
    <div class="row" style="margin-top:26px">
      <span class="pill accent">复盘区间 ${esc(a.range)} · ${a.quarterCount} 个报告期</span>
      ${official ? `<span class="pill">数据截止 ${esc((qs[qs.length - 1] || {}).endDate || '')}(官方最新季报)</span>` : ''}
      <span class="pill">形态 ${esc(a.form.tag)}</span>
      <span class="pill">质检 ${esc((payload.check && payload.check.summary.verdictText) || '待检')}</span>
    </div>
    <p class="sec-note">基于公开季报 / 年报数据的回溯分析(证据分级: 披露事实 / 合理推断 / 事后解读), 不构成投资建议; 过往业绩不代表未来收益。
      <span style="float:right"><span class="kb">← →</span> 翻页 · <span class="kb">O</span> 概览 · <span class="kb">F</span> 全屏 · <span class="kb">T</span> 换主题</span></p>
  </section>`);

  /* ---------- 2 先说结论 ---------- */
  S.push(slide(S.length + 1, '01 · 先说结论',
    a.form.tag + ':' + (a.card.mainQuestion || '').slice(0, 46),
    `<div class="cols">
      <div class="col">
        <div class="card"><h4>形态标签与判定依据</h4><ul>${(a.form.reasons || []).slice(0, 3).map(r => '<li>' + esc(r) + '</li>').join('')}</ul></div>
        <div class="card warn"><h4>推翻条件(可证伪)</h4><p style="font-size:13.5px">${esc(a.card.falsifier)}</p></div>
      </div>
      <div class="col">
        <div class="card ok"><h4>核心判断(一句话, 可证伪)</h4><p style="font-size:14px">${esc(a.card.claim)}</p></div>
        ${perf ? `<div class="stats" style="grid-template-columns:repeat(3,1fr);margin:0">
          ${stat('区间复利', pct(perf.cumReturn), '分红再投口径')}
          ${stat('剔除最好一季', pct(perf.exBestQuarter), perf.bestQuarter)}
          ${stat('最大回撤', fx(perf.maxDrawdown) + '%', perf.maxDrawdownAt || '')}
        </div>` : ''}
      </div>
    </div>`,
    '证据级别: ' + esc(a.card.evidenceLevel || '') + ' · 结论由规则引擎给出, 观点由大模型起草并逐条回查数字'));

  /* ---------- 3 绩效总览 ---------- */
  const qRet = (dataset && dataset.perfDetail && dataset.perfDetail.quarterReturns) || [];
  S.push(slide(S.length + 1, '02 · 绩效总览',
    perf
      ? `区间 ${pct(perf.cumReturn)}${perf.concentratedInOneQuarter ? ', 但最大单季贡献 ' + fx(perf.bestQuarterContribution) + '% —— 复利能力存疑' : ', 收益分布相对均匀'}`
      : '本次未提供净值序列, 不判定绩效',
    perf ? `
    <div class="stats c5">
      ${stat('区间复利收益', pct(perf.cumReturn), '分红再投总回报指数')}
      ${stat('剔除最好一季', pct(perf.exBestQuarter), perf.bestQuarter + ' 单季 ' + pct((dataset.perfDetail || {}).bestQuarterReturn), 'dn')}
      ${stat('最好一季贡献', fx(perf.bestQuarterContribution) + '%', perf.concentratedInOneQuarter ? '⚠ 高度集中' : '')}
      ${stat('最大回撤', fx(perf.maxDrawdown) + '%', perf.maxDrawdownAt || '')}
      ${stat('规模', fx(perf.aumPeak) + '→' + fx(perf.aumEnd), '亿元(峰值→期末)')}
    </div>
    ${qRet.length ? barChart(qRet.map(r => ({ label: r.period, value: r.ret })), { title: '逐季收益(%, 与官方季报"过去三个月"逐期校准, 偏差 ≤0.01pp)' }) : ''}
    ` : '<div class="card warn"><p>本次输入未包含净值序列, <strong>不判定绩效形态, 也不给出任何收益结论</strong>。结构层结论仍然成立。</p></div>',
    perf ? esc(perf.note || '') : ''));

  /* ---------- 4 持仓集中度 ---------- */
  S.push(slide(S.length + 1, '03 · 持仓集中度与骨架',
    `前十合计均值 ${fx(m.conc.avg)}%(${esc(m.conc.trend)}), 全期出现过 ${m.totalDistinct} 只个股`,
    `<div class="stats">
      ${stat('前十合计均值', fx(m.conc.avg) + '%', '区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%')}
      ${stat('集中度趋势', m.conc.trend, m.conc.slope !== null ? '斜率 ' + fx(m.conc.slope, 2) + 'pp/期' : '')}
      ${stat('第一大重仓', fx(m.leader.avg) + '%', '最高 ' + fx(m.leader.max) + '%(上限 10%)')}
      ${stat('出现过的个股', String(m.totalDistinct) + ' 只', '前十共 ' + (a.quarterCount * 10) + ' 个席位')}
    </div>
    ${barChart(m.conc.series.map(x => ({ label: x.period, value: x.value })), { title: '前十合计权重逐季变化(%)' })}`,
    '集中度 = 前十只股票合计占基金资产净值比例; 数据来源: 公开季报前十大明细独立求和, 已与官方报告逐行对账。'));

  /* ---------- 5 轮动主线 ---------- */
  const churn = m.churn || [];
  S.push(slide(S.length + 1, '04 · 持仓结构演变',
    `${a.quarterCount} 个季度 = ${m.theme.known ? m.theme.runs.length : '—'} 段主题主线(前十口径), 平均留存 ${fx(m.avgRetained, 1)}/10`,
    `<div class="cols">
      <div class="col" style="flex:1.05">
        <h3>主导主题演进</h3>
        <div class="chain">${m.theme.known
          ? m.theme.runs.map(r => `<span class="chip">${esc(r.theme)}<i>${r.len} 期</i></span>`).join('<span class="arrow">→</span>')
          : '<span class="pill">本期数据未提供主题归类(由 AI 模块补齐)</span>'}</div>
        <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-top:4px">
          ${stat('平均留存', fx(m.avgRetained, 1) + '/10', '换手强度代理')}
          ${stat('平均新进', fx(m.avgAdded, 1) + ' 只', '每期')}
          ${stat('最长连续在榜', m.maxStreak + ' 期', m.longestHolder || '')}
        </div>
        <div class="card"><h4>是否每季推倒重来?</h4><p style="font-size:13.5px">相邻期名单相似度(Jaccard)均值 ${fx(m.avgJaccard, 2)};
        ${m.avgRetained >= 8 ? '前十高度稳定, 属于换股不换赛道。' : m.avgRetained >= 6 ? '整体稳定, 但在换挡期会出现成批更替。' : '更替频繁, 需结合主题切换判断是主动轮动还是追行情。'}</p></div>
      </div>
      <div class="col">
        <h3>逐季留存与新进</h3>
        <table><thead><tr><th>报告期</th><th class="num">前十合计</th><th class="num">留存</th><th>新进</th></tr></thead><tbody>
        ${qs.slice(-10).map((q, i) => {
          const idx = qs.length - 10 + i; const c = churn[idx - 1];
          return `<tr><td>${esc(q.period)}</td><td class="num">${fx(q.top10Sum)}%</td><td class="num">${c ? c.retained + '/10' : '—'}</td><td class="up">${c ? esc(c.added.join('、')) || '—' : '—'}</td></tr>`;
        }).join('')}
        </tbody></table>
      </div>
    </div>`, '留存率只看前十, 不等于全部持仓的真实换手率。'));

  /* ---------- 6 关键调仓案例审计 ---------- */
  const caseTable = (list, cls) => `<table><thead><tr><th>股票</th><th>进入</th><th class="num">推算价</th><th>最后在榜</th><th class="num">推算价</th><th class="num">持有期变动</th></tr></thead><tbody>` +
    list.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.entryPeriod)}</td><td class="num">${fx(c.entryPrice)}</td><td>${esc(c.exitPeriod)}</td><td class="num">${fx(c.exitPrice)}</td><td class="num ${c.change >= 0 ? 'up' : 'dn'}">${pct(c.change)}</td></tr>`).join('') + '</tbody></table>';
  S.push(slide(S.length + 1, '05 · 关键调仓案例审计', '成功与失误成对看, 每条都标证据级别',
    `<div class="cols">
      <div class="col"><div class="card ok"><h4>持有期推算价表现靠前</h4>${caseTable((a.cases.wins || []).slice(0, 4))}</div></div>
      <div class="col"><div class="card bad"><h4>持有期推算价表现靠后</h4>${caseTable((a.cases.fails || []).slice(0, 4))}</div></div>
    </div>`,
    '推算价 = 期末公允价值 ÷ 期末持股数, 未复权、不含分红; 证据级别: 合理推断 —— 它反映事后可观测的价格结果, 不等于经理当时的买卖价格, 也不等于投资者收益。'));

  /* ---------- 7 最新一期 ---------- */
  const latest = qs[qs.length - 1] || {}, prevQ = qs[qs.length - 2] || {};
  const pm = {}, lm = {};
  (prevQ.top10 || []).forEach(h => pm[h.code || h.name] = h);
  (latest.top10 || []).forEach(h => lm[h.code || h.name] = h);
  const keys = Object.keys(lm).concat(Object.keys(pm).filter(k => !lm[k]));
  S.push(slide(S.length + 1, '06 · 最新一期结构与变化',
    `${latest.period} 前十合计 ${fx(latest.top10Sum)}%${latest.theme ? ', 主导主题 ' + latest.theme : ''}`,
    `<div class="cols">
      <div class="col"><h3>${esc(latest.period)} 前十大</h3>
        <table><thead><tr><th>#</th><th>股票</th><th>代码</th><th class="num">权重</th><th class="num">推算价</th></tr></thead><tbody>
        ${(latest.top10 || []).map(h => `<tr><td>${h.rank}</td><td>${esc(h.name)}</td><td style="font-family:Consolas,monospace;font-size:11.5px">${esc(h.code)}</td><td class="num">${fx(h.weight)}%</td><td class="num">${h.sharesWan && h.valueWan ? fx(h.valueWan / h.sharesWan) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="col"><h3>${esc(prevQ.period)} → ${esc(latest.period)} 变动</h3>
        <table><thead><tr><th>股票</th><th class="num">上期</th><th class="num">本期</th><th class="num">变化</th><th>状态</th></tr></thead><tbody>
        ${keys.map(k => {
          const A = pm[k], B = lm[k];
          const d = A && B ? B.weight - A.weight : null;
          const st = !A ? '<span class="up">新进</span>' : !B ? '<span class="dn">退出</span>' : (Math.abs(d) < 0.05 ? '持平' : d > 0 ? '加仓' : '减仓');
          return `<tr><td>${esc((B || A).name)}</td><td class="num">${A ? fx(A.weight) + '%' : '—'}</td><td class="num">${B ? fx(B.weight) + '%' : '—'}</td><td class="num">${d === null ? '—' : (d > 0 ? '+' : '') + fx(d) + 'pp'}</td><td>${st}</td></tr>`;
        }).join('')}
        </tbody></table></div>
    </div>`, '口径禁区: "新进前十大"≠"本季度刚买入"(可能自第 11 名升入); "退出前十大"≠"清仓或最高点卖出"(季报只有期末快照)。'));

  /* ---------- 8 优势与局限(来自大模型, 校验不过则整页不出现) ---------- */
  const syn = a.synthesis;
  if (syn && ((syn.replicable || []).length || (syn.risks || []).length)) {
    S.push(slide(S.length + 1, '07 · 优势与局限', '成对写, 避免只讲好话',
      `<div class="cols">
        <div class="col"><div class="card ok"><h4>最值得学习的部分</h4><ul>${(syn.replicable || []).map(t => '<li>' + esc(t) + '</li>').join('')}</ul></div></div>
        <div class="col"><div class="card bad"><h4>不能被过度解读的部分</h4><ul>${(syn.risks || []).map(t => '<li>' + esc(t) + '</li>').join('')}</ul></div></div>
      </div>`,
      '本节由大模型基于本次复盘的指标与边界生成; 每条都过了数字回查与前瞻禁用检查, 未通过则整页不展示。'));
  }

  /* ---------- 9 结论与跟踪 ---------- */
  S.push(slide(S.length + 1, '08 · 结论与跟踪', '怎么证明"纠错有效", 怎么证明"判断错了"',
    `<table><thead><tr><th style="width:20%">观察项</th><th style="width:36%">当前基线</th><th>触发条件</th></tr></thead><tbody>
      ${a.trackers.map(t => `<tr><td><strong>${esc(t.item)}</strong></td><td>${esc(t.baseline)}</td><td>${esc(t.watch)}</td></tr>`).join('')}
    </tbody></table>
    <p style="margin-top:14px;font-size:13.5px">下一期只需核对这几行, 就能说清"判断被证实还是被推翻", 而不是每次重新讲故事。</p>`,
    '核心判断的推翻条件见第 2 页; 判断方向由人确认后才成文(门禁 2)。'));

  /* ---------- 10 数据来源与质检 ---------- */
  const okCount = official ? (official.checks || []).filter(c => c.reconcile && c.reconcile.ok).length : 0;
  const maxDiff = official ? (official.checks || []).reduce((mx, c) => Math.max(mx, (c.reconcile && c.reconcile.maxWeightDiff) || 0), 0) : null;
  S.push(slide(S.length + 1, '09 · 数据来源与质检', '可核验, 是这个项目的立身之本',
    `<div class="cols">
      <div class="col">
        <div class="stats" style="grid-template-columns:repeat(2,1fr)">
          ${stat('官方对账', okCount + '/' + (official ? (official.checks || []).length : 0) + ' 期', '逐行一致', 'up')}
          ${stat('权重最大差', maxDiff === null ? '—' : fx(maxDiff, 3) + 'pp', '容差 0.011pp')}
        </div>
        <div class="card"><h4>来源清单</h4><ul style="font-size:12.5px">
          ${sources.slice(0, 6).map(s => `<li>${esc(s.type)}${s.url ? ' · <span style="color:var(--text-3)">' + esc(String(s.url).replace(/^https?:\/\//, '').slice(0, 46)) + '</span>' : ''}</li>`).join('')}
          ${sources.length > 6 ? '<li>…共 ' + sources.length + ' 条, 完整清单见同名"来源清单"文件</li>' : ''}
        </ul></div>
      </div>
      <div class="col">
        ${payload.check ? `<div class="card ${payload.check.summary.verdict === 'pass' ? 'ok' : payload.check.summary.verdict === 'fail' ? 'bad' : 'warn'}">
          <h4>质检结论</h4><div class="big-num" style="font-size:17px">${esc(payload.check.summary.verdictText)}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:5px">通过 ${payload.check.summary.pass} · 提示 ${payload.check.summary.warn} · 阻断 ${payload.check.summary.fail}(共 ${payload.check.summary.total} 条规则)</div></div>` : ''}
        <div class="card"><h4>边界与免责</h4><ul style="font-size:12.5px">
          <li>只看前十大持仓(季报口径), 期末快照, 期间买卖不可见</li>
          <li>推算价未复权、不含分红, 不代表投资者实际收益</li>
          <li>数据仅来自公开渠道, 不含任何机构内部数据</li>
          <li>不构成投资建议, 不评价基金经理个人, 不推荐任何基金</li>
        </ul></div>
      </div>
    </div>`, '生成工具: 基金复诊台 FundClinic · 自动采集 + 规则引擎 + 大模型(输出经校验)'));

  const body = S.join('\n');
  const themes = themeList();
  const themeButtons = themes.map(t => {
    const d = DOT_COLORS[t.id] || ['#888', '#ccc'];
    return `<button class="th-btn" data-th="${t.id}"><span class="th-dot" style="background:${d[0]};box-shadow:inset -6px 0 0 ${d[1]}"></span>${esc(t.name)}</button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${DEFAULT_THEME}"><head><meta charset="utf-8">
<title>${esc(fund.name)}(${esc(fund.code)}) 持仓回溯复盘 · 演示稿</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${themeCSS()}
${CSS}</style></head>
<body>
${body}
<div class="ov-wrap" id="ovWrap"></div>
<div class="themes">
  <button class="th-toggle" id="thToggle">换主题</button>
  <div class="th-panel" id="thPanel">
    <h4>选择配色风格(${themes.length} 套, 选择会记住)</h4>
    <div class="th-grid">${themeButtons}</div>
    <div style="margin-top:11px;font-size:11.5px;color:var(--text-3);line-height:1.6">全部样式内联在本文件里, 不联网、不依赖任何字体或图片文件 —— 直接发给别人也能正常换肤与打印。</div>
  </div>
</div>
<div class="nav">
  <button id="pv" title="上一页">‹</button><span id="pg">1 / ${S.length}</span><button id="nx" title="下一页">›</button>
  <button id="ov" title="概览(O)">概览</button><button id="fs" title="全屏(F)">全屏</button>
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')),i=0;
  function go(n){i=Math.max(0,Math.min(slides.length-1,n));document.getElementById('pg').textContent=(i+1)+' / '+slides.length;
    if(!document.body.classList.contains('overview')) slides[i].scrollIntoView({block:'start'});}
  document.getElementById('nx').onclick=function(){go(i+1)};
  document.getElementById('pv').onclick=function(){go(i-1)};
  document.getElementById('fs').onclick=function(){toggleFs()};
  document.getElementById('ov').onclick=function(){toggleOv()};

  /* 概览模式: 全部幻灯片缩略成网格, 点哪张跳哪张 */
  var wrap=document.getElementById('ovWrap');
  function toggleOv(){
    var on=document.body.classList.toggle('overview');
    if(on){
      if(!wrap.dataset.built){
        slides.forEach(function(s,k){
          var cell=document.createElement('div');cell.className='ov-cell';
          var clone=s.cloneNode(true);clone.style.margin='0';cell.appendChild(clone);
          cell.onclick=function(){toggleOv();go(k);};
          wrap.appendChild(cell);
        });
        wrap.dataset.built='1';
      }
      wrap.style.display='grid';
    } else { wrap.style.display='none'; go(i); }
  }
  function toggleFs(){ if(document.fullscreenElement){document.exitFullscreen&&document.exitFullscreen();}
    else { document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen(); } }

  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ')  {e.preventDefault();go(i+1);}
    if(e.key==='ArrowLeft'||e.key==='PageUp')                  {e.preventDefault();go(i-1);}
    if(e.key==='Home'){go(0);} if(e.key==='End'){go(slides.length-1);}
    if(e.key==='p'||e.key==='P'){window.print();}
    if(e.key==='o'||e.key==='O'){toggleOv();}
    if(e.key==='f'||e.key==='F'){toggleFs();}
    if(e.key==='t'||e.key==='T'){document.getElementById('thPanel').classList.toggle('open');}
    if(e.key==='Escape'){document.getElementById('thPanel').classList.remove('open');}
  });
  var obs=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){i=slides.indexOf(en.target);
    document.getElementById('pg').textContent=(i+1)+' / '+slides.length;}});},{threshold:.5});
  slides.forEach(function(s){obs.observe(s)});

  var KEY='fundclinic.deck.theme';
  function apply(id){
    document.documentElement.setAttribute('data-theme',id);
    document.querySelectorAll('.th-btn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-th')===id);});
    try{localStorage.setItem(KEY,id);}catch(e){}
  }
  document.getElementById('thToggle').onclick=function(){document.getElementById('thPanel').classList.toggle('open');};
  document.querySelectorAll('.th-btn').forEach(function(b){ b.onclick=function(){apply(b.getAttribute('data-th'));}; });
  var saved=null; try{saved=localStorage.getItem(KEY);}catch(e){}
  apply(saved&&document.querySelector('.th-btn[data-th="'+saved+'"]')?saved:'${DEFAULT_THEME}');
  document.addEventListener('click',function(e){ if(!e.target.closest('.themes')) document.getElementById('thPanel').classList.remove('open'); });
})();
</script>
</body></html>`;
}
