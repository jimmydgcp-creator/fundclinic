/* 生成首页「对比样例」固定展示块：把三只基金 12.8 年的曲线画成内联 SVG，配指标表。
 *
 * 为什么要预置：横向对比接口一次要抓 2–3 个外部净值序列，实测 3–6 秒。
 * 台上讲这一段时不能等，也不该赌网络；所以把一次真实结果固定下来，
 * 曲线、指标、窗口日期、抓取时间全部写死在页面上，点开即见。
 * 旁边的「开始对比」入口保留，想换代码现场重跑仍然可以。
 *
 * 用法: node tools/make_compare_sample.mjs   （读 data/compare-sample.json，重写 index.html 里的块）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/compare-sample.json'), 'utf8'));
const IDX = path.join(ROOT, 'index.html');

const COLORS = ['#b4472c', '#2e5496', '#6b7a86'];
const W = 1000, H = 320, PAD_L = 46, PAD_R = 96, PAD_T = 16, PAD_B = 30;
const IW = W - PAD_L - PAD_R, IH = H - PAD_T - PAD_B;

const ORDER = ['519191', '110022', '510300'];
const funds = DATA.funds.slice().sort((a, b) => {
  const ia = ORDER.indexOf(a.code), ib = ORDER.indexOf(b.code);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
const from = Date.parse(DATA.window.from + 'T00:00:00+08:00');
const to = Date.parse(DATA.window.to + 'T00:00:00+08:00');
const span = to - from;

const all = funds.flatMap((f) => f.series.map((p) => p.v));
const lo = Math.min(...all), hi = Math.max(...all);
const pad = (hi - lo) * 0.08;
const yLo = Math.max(0, lo - pad), yHi = hi + pad;

const X = (d) => PAD_L + (Date.parse(d + 'T00:00:00+08:00') - from) / span * IW;
const Y = (v) => PAD_T + (1 - (v - yLo) / (yHi - yLo)) * IH;
const f1 = (x) => Math.round(x * 10) / 10;

/* 纵轴：4 条网格线 */
const ticks = [];
for (let i = 0; i <= 4; i++) ticks.push(yLo + (yHi - yLo) * i / 4);

/* 横轴：每两年一条 */
const years = [];
for (let y = 2016; y <= 2026; y += 2) years.push(y);

const svg = [
  `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-label="三只基金 12.8 年净值曲线，起点归一为 100">`,
  `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
  ...ticks.map((t) =>
    `<line x1="${PAD_L}" y1="${f1(Y(t))}" x2="${PAD_L + IW}" y2="${f1(Y(t))}" stroke="#e8e4da" stroke-width="1"/>` +
    `<text x="${PAD_L - 8}" y="${f1(Y(t)) + 4}" text-anchor="end" font-size="12" fill="#8a867e">${Math.round(t)}</text>`),
  ...years.map((y) => {
    const x = X(`${y}-01-01`);
    return `<line x1="${f1(x)}" y1="${PAD_T}" x2="${f1(x)}" y2="${PAD_T + IH}" stroke="#f0ece4" stroke-width="1"/>` +
      `<text x="${f1(x)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#8a867e">${y}</text>`;
  }),
  ...funds.map((f, i) => {
    const pts = f.series.map((p) => `${f1(X(p.d))},${f1(Y(p.v))}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${COLORS[i]}" stroke-width="1.9" stroke-linejoin="round"/>`;
  }),
  /* 右端标注: 终点接近时会把字叠在一起(519191 与 110022 只差 4 点), 这里做一次避让 */
  (() => {
    const items = funds.map((f, i) => {
      const last = f.series[f.series.length - 1];
      return { i, code: f.code, v: Math.round(last.v), y: Y(last.v) };
    }).sort((a, b) => a.y - b.y);
    const GAP = 15;
    for (let k = 1; k < items.length; k++) {
      if (items[k].y - items[k - 1].y < GAP) items[k].y = items[k - 1].y + GAP;
    }
    return items.map((it) =>
      `<text x="${PAD_L + IW + 8}" y="${f1(it.y) + 4}" font-size="12.5" fill="${COLORS[it.i]}" font-weight="600">${it.code} ${it.v}</text>`
    ).join('');
  })(),
  `</svg>`
].join('');

const pct = (x) => (x * 100).toFixed(1) + '%';
const rows = funds.map((f, i) => {
  const m = f.metrics;
  return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${COLORS[i]};margin-right:6px"></span>` +
    `<strong>${f.code}</strong> ${f.name}</td>` +
    `<td class="mono">${pct(m.cumReturn)}</td><td class="mono">${pct(m.annualized)}</td>` +
    `<td class="mono">${pct(m.maxDrawdown)}</td><td class="mono">${pct(m.volAnnual)}</td></tr>`;
}).join('');

const years12 = (DATA.window.days / 365).toFixed(1);
const block = `<!-- CMP-SAMPLE:START 由 tools/make_compare_sample.mjs 生成, 请勿手改 -->
    <div class="cmp-sample" id="cmp-sample">
      <h3>内置样例：三只基金，同一个 ${years12} 年</h3>
      <p class="panel-sub">这组结果预置在页面里，<strong>打开就能看，不用输入任何代码</strong>。起点都归一到 100，口径都是分红再投总回报，区间取三只都有的重叠段（${DATA.window.from} → ${DATA.window.to}）。</p>
      <div class="cmp-chart">${svg}</div>
      <table class="tbl tbl-compact">
        <thead><tr><th>基金</th><th>累计</th><th>年化</th><th>最大回撤</th><th>年化波动</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">
        前两只 ${years12} 年几乎打平：累计 ${pct(funds[0].metrics.cumReturn)} 对 ${pct(funds[1].metrics.cumReturn)}，年化 ${pct(funds[0].metrics.annualized)} 对 ${pct(funds[1].metrics.annualized)}，年化波动 ${pct(funds[0].metrics.volAnnual)} 对 ${pct(funds[1].metrics.volAnnual)}。但最大回撤一个是 ${pct(funds[0].metrics.maxDrawdown)}，一个是 ${pct(funds[1].metrics.maxDrawdown)}。收益一样，要扛的东西不一样。
      </p>
      <p class="muted cmp-tip">数据截至 ${DATA.window.to}，来源：天天基金净值序列。被动 ETF 与主动基金的「形态标签」不可比，这一段只看曲线和回撤。</p>
    </div>
    <!-- CMP-SAMPLE:END -->`;

let html = fs.readFileSync(IDX, 'utf8');
const re = /<!-- CMP-SAMPLE:START[\s\S]*?<!-- CMP-SAMPLE:END -->/;
if (re.test(html)) {
  html = html.replace(re, block);
} else {
  /* 首次插入：放在「横向对比」面板的提示语之前 */
  const anchor = '      <p class="muted cmp-tip">提示：被动 ETF';
  if (!html.includes(anchor)) throw new Error('找不到插入点');
  html = html.replace(anchor, block + '\n' + anchor);
}
fs.writeFileSync(IDX, html, 'utf8');
console.log('已写入对比样例块 · 曲线 ' + svg.length + ' 字符 · 三只基金 · ' + years12 + ' 年');
