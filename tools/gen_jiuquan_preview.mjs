/* 生成「韭圈风」变体预览页：单个 HTML，数据是现场从本地服务 /api/compare 抓的真数据，
 * 图片与字体全内联/系统字体，双击就能看，不依赖服务器。
 * 用法：node tools/gen_jiuquan_preview.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, '_变体预览');
const OUT = path.join(OUT_DIR, '韭圈风_v1.html');
const API = 'http://127.0.0.1:8788/api/compare';
const CODES = ['519191', '005827', '090007'];

const res = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codes: CODES })
});
const j = await res.json();
if (!j.ok) { console.error('取数失败', j); process.exit(1); }

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';

/* KPI：从数据里现算，不写死 */
const best = j.funds.slice().sort((a, b) => b.metrics.cumReturn - a.metrics.cumReturn)[0];
const worstDd = j.funds.slice().sort((a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown)[0];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>基金复诊台 · 投研工作台（变体预览）</title>
<style>
:root{
  --bg:#f5f7f9; --card:#ffffff; --line:#e5e9ef; --line-2:#eef2f6;
  --ink:#0f1720; --sub:#67717e; --muted:#9aa4b1;
  --brand:#0e9f6e; --brand-soft:#e9f7f1; --brand-line:#bfe8d8;
  --blue:#2f6fed; --orange:#e8833a; --neg:#d92d20; --neg-soft:#fdeceb;
  --r:10px; --r-sm:6px;
  --mono:"Cascadia Mono",ui-monospace,SFMono-Regular,Consolas,monospace;
  --sans:"Segoe UI",-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{font-size:13px;line-height:1.6}
a{color:inherit}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.up{color:var(--neg)}   /* A 股习惯：涨用红 */
.down{color:var(--brand)}

/* ---------- 顶栏 ---------- */
.top{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--line)}
.top-in{max-width:1280px;margin:0 auto;padding:0 22px;height:54px;display:flex;align-items:center;gap:26px}
.logo{display:flex;align-items:baseline;gap:8px;font-weight:700;font-size:15px;letter-spacing:.2px}
.logo i{width:8px;height:16px;border-radius:2px;background:var(--brand);display:inline-block;transform:skewX(-12deg)}
.logo span{font-size:10.5px;color:var(--muted);font-weight:500;letter-spacing:.16em}
nav{display:flex;gap:2px;height:100%}
nav a{display:flex;align-items:center;padding:0 13px;color:var(--sub);text-decoration:none;font-size:13px;border-bottom:2px solid transparent;margin-bottom:-1px}
nav a:hover{color:var(--ink)}
nav a.on{color:var(--ink);border-bottom-color:var(--brand);font-weight:600}
.top-right{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--brand);display:inline-block}

/* ---------- 版心 ---------- */
main{max-width:1280px;margin:0 auto;padding:18px 22px 60px}
.crumbs{font-size:12px;color:var(--muted);margin:2px 0 12px}
.crumbs b{color:var(--sub);font-weight:500}

/* ---------- KPI 条 ---------- */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px}
.kpi .k{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.kpi .v{font-family:var(--mono);font-size:23px;font-weight:600;letter-spacing:-.4px;margin-top:3px}
.kpi .s{font-size:11px;color:var(--muted);margin-top:2px}
.kpi .s b{color:var(--sub);font-weight:600}

/* ---------- 卡片 ---------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin-bottom:14px}
.card-hd{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.card-hd h2{font-size:14.5px;margin:0;font-weight:650;letter-spacing:.1px}
.card-hd .tag{font-size:10.5px;color:var(--brand);background:var(--brand-soft);border:1px solid var(--brand-line);border-radius:999px;padding:1px 8px}
.card-hd .right{margin-left:auto;font-size:11.5px;color:var(--muted)}
.card p.sub{margin:4px 0 12px;font-size:12px;color:var(--sub)}

/* ---------- 输入行 ---------- */
.inputs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 4px}
.inputs input{width:150px;padding:7px 10px;border:1px solid var(--line);border-radius:var(--r-sm);font:inherit;font-family:var(--mono);font-size:12.5px;background:#fff}
.inputs input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.btn{padding:7px 14px;border-radius:var(--r-sm);border:1px solid var(--brand);background:var(--brand);color:#fff;font:inherit;font-size:12.5px;cursor:pointer}
.btn.ghost{background:#fff;color:var(--sub);border-color:var(--line)}
.hint{font-size:11.5px;color:var(--muted);margin-left:2px}

/* ---------- 图 ---------- */
.chart-wrap{margin:6px -4px 0}
svg.chart{width:100%;height:auto;display:block}
.grid{stroke:var(--line-2);stroke-width:1}
.base{stroke:#c9d3de;stroke-dasharray:3 4;stroke-width:1}
.axis{fill:var(--muted);font-size:10px;font-family:var(--mono)}
.lg{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 0;font-size:12px;color:var(--sub)}
.lg i{width:14px;height:3px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle}

/* ---------- 表 ---------- */
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}
th{font-size:11px;color:var(--muted);font-weight:500;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fbfcfd}
td{padding:10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
tbody tr:hover{background:#fafcfe}
th.r,td.r{text-align:right}
td.name b{font-family:var(--mono);font-weight:600}
td.name .sm{font-size:11px;color:var(--muted);display:block;margin-top:1px}
.pill{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:999px;background:#f2f5f8;color:var(--sub);border:1px solid var(--line)}
.pill.pos{background:var(--brand-soft);color:var(--brand);border-color:var(--brand-line)}
.pill.dim{color:var(--muted)}

/* ---------- 报告三节预览 ---------- */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sec{border:1px solid var(--line);border-radius:var(--r-sm);padding:12px 14px;background:#fcfdfe}
.sec h3{margin:0 0 6px;font-size:12.5px;font-weight:650}
.sec p{margin:0 0 6px;font-size:12px;color:var(--sub)}
.sec .ev{font-size:11px;color:var(--muted);font-family:var(--mono)}
.bar{height:6px;border-radius:3px;background:#eef2f6;overflow:hidden;margin:6px 0 2px}
.bar i{display:block;height:100%;background:var(--brand);border-radius:3px}

/* ---------- 问答 ---------- */
.fab{position:fixed;right:22px;bottom:22px;z-index:30;padding:10px 16px;border:0;border-radius:999px;background:var(--ink);color:#fff;font:inherit;font-size:12.5px;cursor:pointer;box-shadow:0 10px 24px rgba(15,23,32,.18)}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(392px,94vw);background:#fff;border-left:1px solid var(--line);z-index:31;display:flex;flex-direction:column;padding:14px;gap:8px;box-shadow:-12px 0 30px rgba(15,23,32,.1);transform:translateX(102%);transition:transform .2s ease}
.drawer.open{transform:translateX(0)}
.dr-hd{display:flex;align-items:baseline;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--line);font-weight:650;font-size:13px}
.dr-hd small{color:var(--muted);font-weight:400;font-size:11px}
.dr-hd button{margin-left:auto;border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}
.dr-log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0}
.msg{max-width:92%;padding:8px 11px;border-radius:8px;font-size:12.5px;line-height:1.65}
.msg.me{align-self:flex-end;background:var(--brand-soft);color:#0b3a2c}
.msg.bot{align-self:flex-start;background:#f5f7f9;color:var(--ink)}
.msg .ref{font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:4px}
.quick{display:flex;gap:6px;flex-wrap:wrap}
.quick button{padding:4px 9px;border:1px solid var(--line);background:#fff;border-radius:999px;font:inherit;font-size:11px;color:var(--sub);cursor:pointer}
.quick button:hover{border-color:var(--brand);color:var(--brand)}
.dr-form{display:flex;gap:8px}
.dr-form input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);font:inherit;font-size:12.5px}
.dr-form button{padding:8px 14px;border:0;border-radius:var(--r-sm);background:var(--brand);color:#fff;font:inherit;font-size:12.5px}
.dr-foot{font-size:10.5px;color:var(--muted);line-height:1.5;margin:0}
.foot{max-width:1280px;margin:0 auto;padding:0 22px 30px;color:var(--muted);font-size:11.5px}
@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}nav{display:none}}
</style>
</head>
<body>

<header class="top">
  <div class="top-in">
    <div class="logo"><i></i>基金复诊台 <span>FUNDCLINIC</span></div>
    <nav>
      <a href="#" class="on">投研工作台</a>
      <a href="#">复盘报告</a>
      <a href="#">数据底稿</a>
      <a href="#">质检记录</a>
      <a href="#">横向对比</a>
    </nav>
    <div class="top-right"><span class="dot"></span>数据截至 ${esc(j.window.to)} · 口径：分红再投总收益指数</div>
  </div>
</header>

<main>
  <div class="crumbs">工作台 / <b>横向对比</b> / ${CODES.length} 只基金</div>

  <section class="kpis">
    <div class="kpi"><div class="k">共同区间</div><div class="v">${j.window.days}<span style="font-size:12px;color:var(--muted)"> 天</span></div><div class="s">${esc(j.window.from)} 至 ${esc(j.window.to)}</div></div>
    <div class="kpi"><div class="k">区间收益最高</div><div class="v up">${pct(best.metrics.cumReturn)}</div><div class="s"><b>${esc(best.code)}</b> ${esc(best.name)}</div></div>
    <div class="kpi"><div class="k">最大回撤最深</div><div class="v">${pct(worstDd.metrics.maxDrawdown)}</div><div class="s"><b>${esc(worstDd.code)}</b> ${esc(worstDd.name)}</div></div>
    <div class="kpi"><div class="k">对比只数 / 上限</div><div class="v">${j.funds.length}<span style="font-size:12px;color:var(--muted)"> / 3</span></div><div class="s">样本不足的会压暗标注</div></div>
  </section>

  <section class="card">
    <div class="card-hd"><h2>横向对比</h2><span class="tag">被动 / 主动自动区分</span><span class="right">口径：起点归一 100 · 区间取交集</span></div>
    <p class="sub">输入 6 位基金代码，最多 3 只。只抓净值，不跑完整复盘 —— 对比要的是曲线和区间指标。</p>
    <div class="inputs">
      <input value="${CODES[0]}" readonly><input value="${CODES[1]}" readonly><input value="${CODES[2]}" readonly>
      <button class="btn">开始对比</button>
      <span class="hint">示例为只读，实际页面可改</span>
    </div>
    <div class="chart-wrap" id="chart"></div>
    <div class="lg" id="legend"></div>

    <table>
      <thead><tr>
        <th>基金</th><th>类型</th><th class="r">区间收益</th><th class="r">年化</th><th class="r">最大回撤</th><th class="r">年化波动</th><th class="r">报告期</th>
      </tr></thead>
      <tbody>
      ${j.funds.map(f => `<tr>
        <td class="name"><b>${esc(f.code)}</b> ${esc(f.name)}<span class="sm">${esc(f.manager || '—')}</span></td>
        <td><span class="pill ${f.kind.isPassive ? 'dim' : ''}">${esc(f.kind.label)}</span></td>
        <td class="r num ${f.metrics.cumReturn >= 0 ? 'up' : 'down'}">${pct(f.metrics.cumReturn)}</td>
        <td class="r num">${pct(f.metrics.annualized)}</td>
        <td class="r num">${pct(f.metrics.maxDrawdown)}</td>
        <td class="r num">${pct(f.metrics.volAnnual)}</td>
        <td class="r num">${f.quarters == null ? '—' : f.quarters}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section class="card">
    <div class="card-hd"><h2>报告里新增的三节（示意）</h2><span class="right">以 519191 为例</span></div>
    <p class="sub">同一套数据，报告多出来三块：产品类型差异、持仓拟合、该追问的三个问题。</p>
    <div class="grid2">
      <div class="sec">
        <h3>产品类型差异说明</h3>
        <p>本基金判定为 <b>主动管理基金</b>，形态标签与调仓解读适用；若是 ETF / 联接，本节会改成跟踪误差、费率与折溢价的读法。</p>
        <p class="ev">依据：名称与基金类型字段</p>
      </div>
      <div class="sec">
        <h3>持仓拟合：如果经理一直没动</h3>
        <div class="bar"><i style="width:94.6%"></i></div>
        <p>R² <b class="num">94.6%</b> · 相关 <b class="num">97.2%</b> · 跟踪误差 <b class="num">6.66%</b> · α 年化 <b class="num">1.89%</b></p>
        <p class="ev">281 周 · 前十平均占净值 73.88% · 剩余部分用沪深300代理</p>
      </div>
      <div class="sec" style="grid-column:1/-1">
        <h3>该追问的三个问题</h3>
        <p>① 2026-05-29 实际 3.46%、理论 6.47%，差 −3.00pp，那一周发生了什么？</p>
        <p>② 区间收益 76.80% 里 53.8% 来自 2022Q1，是能力还是行情？</p>
        <p>③ 前十合计从 73.24% 变为 58.37%，主动减仓还是被稀释？</p>
        <p class="ev">每条附证据行，指回报告具体小节</p>
      </div>
    </div>
  </section>
</main>

<div class="foot">变体预览 · 仅用于比较版式，数据取自本地服务 /api/compare 的真实返回；正式页面仍走 app/ 下的脚本。</div>

<button class="fab" id="fab">问一句</button>
<aside class="drawer" id="drawer">
  <div class="dr-hd">问一句 <small>只答报告里已有的事</small><button id="drx">×</button></div>
  <div class="dr-log" id="drlog">
    <div class="msg bot">报告里区间收益 <b class="num">+76.80%</b>，最大回撤 <b class="num">−32.45%</b>，逐季与官方季报对账 22/22 期一致。<div class="ref">引用：perf.cumReturn · perf.maxDrawdown</div></div>
  </div>
  <div class="quick">
    <button data-q="1">区间收益与回撤</button><button data-q="2">形态依据</button><button data-q="3">拟合残差</button>
  </div>
  <form class="dr-form" id="drform"><input id="drin" placeholder="问报告里的事，例如：单季贡献最大的是哪一季"><button>发送</button></form>
  <p class="dr-foot">不预测涨跌、不推荐买卖、不评价基金经理个人。回答里的数字会被校验，对不上的会被标出来。</p>
</aside>

<script>
var DATA = ${JSON.stringify({ window: j.window, funds: j.funds.map(f => ({ code: f.code, name: f.name, series: f.series })) })};
var COLORS = ['#0e9f6e', '#2f6fed', '#e8833a'];
(function draw() {
  var W = 1160, H = 320, padL = 44, padR = 12, padT = 14, padB = 24;
  var all = [];
  DATA.funds.forEach(function (f) { f.series.forEach(function (p) { all.push(p.v); }); });
  var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  var span = Math.max(1, max - min); min = Math.floor(min - span * 0.08); max = Math.ceil(max + span * 0.08);
  var t0 = new Date(DATA.window.from).getTime(), t1 = new Date(DATA.window.to).getTime();
  function x(d) { return padL + (W - padL - padR) * ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)); }
  function y(v) { return padT + (H - padT - padB) * (1 - (v - min) / Math.max(1, max - min)); }
  var s = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">'];
  var steps = 4;
  for (var i = 0; i <= steps; i++) {
    var v = min + (max - min) * i / steps, yy = y(v);
    s.push('<line class="grid" x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '"/>');
    s.push('<text class="axis" x="' + (padL - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end">' + v.toFixed(0) + '</text>');
  }
  if (min <= 100 && max >= 100) s.push('<line class="base" x1="' + padL + '" y1="' + y(100) + '" x2="' + (W - padR) + '" y2="' + y(100) + '"/>');
  DATA.funds.forEach(function (f, idx) {
    var pts = f.series.map(function (p) { return x(p.d).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ');
    s.push('<polyline points="' + pts + '" fill="none" stroke="' + COLORS[idx % 3] + '" stroke-width="1.7" stroke-linejoin="round"/>');
  });
  s.push('<text class="axis" x="' + padL + '" y="' + (H - 8) + '">' + DATA.window.from + '</text>');
  s.push('<text class="axis" x="' + (W - padR) + '" y="' + (H - 8) + '" text-anchor="end">' + DATA.window.to + '</text>');
  s.push('</svg>');
  document.getElementById('chart').innerHTML = s.join('');
  document.getElementById('legend').innerHTML = DATA.funds.map(function (f, i) {
    return '<span><i style="background:' + COLORS[i % 3] + '"></i>' + f.code + ' ' + f.name + '</span>';
  }).join('');
})();
var drawer = document.getElementById('drawer');
document.getElementById('fab').onclick = function () { drawer.classList.toggle('open'); };
document.getElementById('drx').onclick = function () { drawer.classList.remove('open'); };
document.getElementById('drform').onsubmit = function (e) {
  e.preventDefault();
  var v = document.getElementById('drin').value.trim();
  if (!v) return;
  var log = document.getElementById('drlog');
  log.insertAdjacentHTML('beforeend', '<div class="msg me">' + v.replace(/[<>&]/g, '') + '</div>');
  log.insertAdjacentHTML('beforeend', '<div class="msg bot">这条在变体预览里是静态示意：正式页面会把问题发给 /api/ask，只喂报告字段摘要，回答里的数字逐个校验，答不了会直说。<div class="ref">拒答范围：预测涨跌 / 推荐基金 / 评价个人</div></div>');
  document.getElementById('drin').value = '';
  log.scrollTop = log.scrollHeight;
};
</script>
</body>
</html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('写出 ' + OUT);
console.log('  大小 ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
console.log('  基金 ' + j.funds.map(f => f.code).join(' / ') + ' · 区间 ' + j.window.from + ' → ' + j.window.to);
