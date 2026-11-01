/* 生成「复盘台」变体 v2：
 *   版式/密度 ← 韭圈那版（KPI 条、划线页签、密排表、细线图）
 *   配色/字体 ← 沿用原版（纸感米白 + 黄铜 + 藏青），不采用绿色主题
 *   数字涨跌 ← 红涨绿跌（A 股习惯）
 *   原 index.html / styles.css 一个字不动，这是独立预览文件。
 * 用法：node tools/gen_variant_v2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, '_变体预览');
const OUT = path.join(OUT_DIR, '复盘台_v2.html');
const API = 'http://127.0.0.1:8788/api/compare';
const CODES = ['519191', '005827', '090007'];

const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: CODES }) });
const j = await res.json();
if (!j.ok) { console.error('取数失败', j); process.exit(1); }

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
const best = j.funds.slice().sort((a, b) => b.metrics.cumReturn - a.metrics.cumReturn)[0];
const worstDd = j.funds.slice().sort((a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown)[0];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>基金复诊台 · 复盘台</title>
<style>
:root{
  /* 颜色沿用原版：纸感米白 + 黄铜 + 藏青 */
  --paper:#faf8f4; --surface:#ffffff; --ink:#151b23; --sub:#5b646f; --muted:#8d949d;
  --line:#e7e2d7; --line-2:#efeae0; --line-strong:#d5cec0;
  --navy:#1b2a3a; --brass:#8f6231; --brass-soft:#f5efe4;
  --up:#b3392f; --down:#2f6a4f;          /* 红涨绿跌 */
  --r:10px; --r-sm:6px;
  --mono:"Cascadia Mono",ui-monospace,SFMono-Regular,Consolas,monospace;
  --sans:"Segoe UI",-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{font-size:13px;line-height:1.6}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.up{color:var(--up)} .down{color:var(--down)}

.top{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--line)}
.top-in{max-width:1280px;margin:0 auto;padding:0 22px;height:54px;display:flex;align-items:center;gap:26px}
.logo{display:flex;align-items:baseline;gap:8px;font-weight:700;font-size:15px;letter-spacing:.2px}
.logo i{width:8px;height:16px;border-radius:2px;background:var(--brass);display:inline-block;transform:skewX(-12deg)}
.logo span{font-size:10.5px;color:var(--muted);font-weight:500;letter-spacing:.16em}
nav{display:flex;gap:2px;height:100%}
nav button{display:flex;align-items:center;padding:0 14px;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;color:var(--sub);font:inherit;font-size:13px;cursor:pointer}
nav button:hover{color:var(--ink)}
nav button.on{color:var(--ink);border-bottom-color:var(--brass);font-weight:600}
.top-right{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--down);display:inline-block}

main{max-width:1280px;margin:0 auto;padding:16px 22px 70px}
.view{display:none}
.view.on{display:block}
.crumbs{font-size:12px;color:var(--muted);margin:2px 0 12px}
.crumbs b{color:var(--sub);font-weight:500}

.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px}
.kpi .k{font-size:11.5px;color:var(--muted)}
.kpi .v{font-family:var(--mono);font-size:23px;font-weight:600;letter-spacing:-.4px;margin-top:3px}
.kpi .v small{font-size:12px;color:var(--muted);font-weight:400;letter-spacing:0}
.kpi .s{font-size:11px;color:var(--muted);margin-top:2px}
.kpi .s b{color:var(--sub);font-weight:600}

.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin-bottom:14px}
.card-hd{display:flex;align-items:center;gap:10px}
.card-hd h2{font-size:14.5px;margin:0;font-weight:650}
.card-hd .tag{font-size:10.5px;color:var(--brass);background:var(--brass-soft);border:1px solid #e6dcc9;border-radius:999px;padding:1px 8px}
.card-hd .right{margin-left:auto;font-size:11.5px;color:var(--muted)}
.card p.sub{margin:4px 0 12px;font-size:12px;color:var(--sub)}

.inputs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 4px}
.inputs input{width:150px;padding:7px 10px;border:1px solid var(--line-strong);border-radius:var(--r-sm);font:inherit;font-family:var(--mono);font-size:12.5px;background:var(--surface);color:var(--ink)}
.inputs input:focus{outline:none;border-color:var(--brass);box-shadow:0 0 0 3px var(--brass-soft)}
.btn{padding:7px 14px;border-radius:var(--r-sm);border:1px solid var(--brass);background:var(--brass);color:#fff;font:inherit;font-size:12.5px;cursor:pointer}
.btn.ghost{background:var(--surface);color:var(--sub);border-color:var(--line-strong)}
.hint{font-size:11.5px;color:var(--muted)}

svg.chart{width:100%;height:auto;display:block;margin-top:8px}
.grid{stroke:var(--line-2);stroke-width:1}
.base{stroke:var(--line-strong);stroke-dasharray:3 4;stroke-width:1}
.axis{fill:var(--muted);font-size:10px;font-family:var(--mono)}
.lg{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 0;font-size:12px;color:var(--sub)}
.lg i{width:14px;height:3px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle}

table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}
th{font-size:11px;color:var(--muted);font-weight:500;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fbfaf7}
td{padding:10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
tbody tr:hover{background:#fdfbf7}
th.r,td.r{text-align:right}
td.name b{font-family:var(--mono);font-weight:600}
td.name .sm{font-size:11px;color:var(--muted);display:block;margin-top:1px}
.pill{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:999px;background:#f4f1ea;color:var(--sub);border:1px solid var(--line)}
.pill.pas{background:var(--brass-soft);color:var(--brass);border-color:#e6dcc9}
.pill.dim{color:var(--muted)}

.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sec{border:1px solid var(--line);border-radius:var(--r-sm);padding:12px 14px;background:#fdfcf9}
.sec h3{margin:0 0 6px;font-size:12.5px;font-weight:650}
.sec p{margin:0 0 6px;font-size:12px;color:var(--sub)}
.sec .ev{font-size:11px;color:var(--muted);font-family:var(--mono)}
.bar{height:6px;border-radius:3px;background:#efeae0;overflow:hidden;margin:6px 0 4px}
.bar i{display:block;height:100%;background:var(--brass);border-radius:3px}

.list{display:flex;flex-direction:column}
.row{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--line-2)}
.row:last-child{border-bottom:0}
.row .code{font-family:var(--mono);font-size:12.5px;color:var(--sub);width:64px}
.row .nm{flex:1;font-size:13px}
.row .nm small{display:block;color:var(--muted);font-size:11.5px}
.row .met{font-family:var(--mono);font-size:12.5px;width:96px;text-align:right}
.tag2{font-size:10.5px;color:var(--brass);background:var(--brass-soft);border:1px solid #e6dcc9;border-radius:4px;padding:1px 6px}

.fab{position:fixed;right:22px;bottom:22px;z-index:30;padding:10px 16px;border:0;border-radius:999px;background:var(--navy);color:#fff;font:inherit;font-size:12.5px;cursor:pointer;box-shadow:0 10px 24px rgba(21,27,35,.18)}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(392px,94vw);background:var(--surface);border-left:1px solid var(--line-strong);z-index:31;display:flex;flex-direction:column;padding:14px;gap:8px;box-shadow:-12px 0 30px rgba(21,27,35,.1);transform:translateX(102%);transition:transform .2s ease}
.drawer.open{transform:translateX(0)}
.dr-hd{display:flex;align-items:baseline;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--line);font-weight:650;font-size:13px}
.dr-hd small{color:var(--muted);font-weight:400;font-size:11px}
.dr-hd button{margin-left:auto;border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}
.dr-log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0}
.msg{max-width:92%;padding:8px 11px;border-radius:8px;font-size:12.5px;line-height:1.65}
.msg.me{align-self:flex-end;background:var(--brass-soft);color:#3b2c1a}
.msg.bot{align-self:flex-start;background:#f6f4ef;color:var(--ink)}
.msg .ref{font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:4px}
.quick{display:flex;gap:6px;flex-wrap:wrap}
.quick button{padding:4px 9px;border:1px solid var(--line-strong);background:var(--surface);border-radius:999px;font:inherit;font-size:11px;color:var(--sub);cursor:pointer}
.quick button:hover{border-color:var(--brass);color:var(--brass)}
.dr-form{display:flex;gap:8px}
.dr-form input{flex:1;padding:8px 10px;border:1px solid var(--line-strong);border-radius:var(--r-sm);font:inherit;font-size:12.5px}
.dr-form button{padding:8px 14px;border:0;border-radius:var(--r-sm);background:var(--navy);color:#fff;font:inherit;font-size:12.5px}
.dr-foot{font-size:10.5px;color:var(--muted);line-height:1.5;margin:0}
.foot{max-width:1280px;margin:0 auto;padding:0 22px 30px;color:var(--muted);font-size:11.5px}
@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}nav button:nth-child(n+4){display:none}}
</style>
</head>
<body>

<header class="top">
  <div class="top-in">
    <div class="logo"><i></i>基金复诊台 <span>FUNDCLINIC</span></div>
    <nav>
      <button class="on" data-v="desk">复盘台</button>
      <button data-v="report">报告</button>
      <button data-v="compare">横向对比</button>
      <button data-v="ledger">数据底稿</button>
    </nav>
    <div class="top-right"><span class="dot"></span>已恢复 6 份历史复盘 · 数据截至 ${esc(j.window.to)}</div>
  </div>
</header>

<main>
  <!-- ============ 复盘台 ============ -->
  <section class="view on" id="v-desk">
    <div class="crumbs">复盘台 / <b>今日</b></div>
    <section class="kpis">
      <div class="kpi"><div class="k">可复盘的基金</div><div class="v">6<small> 只</small></div><div class="s">内置样例 + 历史运行</div></div>
      <div class="kpi"><div class="k">最近一次运行</div><div class="v">377<small> 秒</small></div><div class="s">519191 · 23 个报告期 · 成本约 ¥0.49</div></div>
      <div class="kpi"><div class="k">对账结果</div><div class="v down">4/4</div><div class="s">官方季报逐行一致 · 最大差 <b>0.000pp</b></div></div>
      <div class="kpi"><div class="k">质检</div><div class="v">76/76</div><div class="s">自测全过 · 18 条规则结算</div></div>
    </section>

    <section class="card">
      <div class="card-hd"><h2>输入基金代码</h2><span class="tag">六类公开来源 · 官方季报为准</span><span class="right">在线模式</span></div>
      <p class="sub">输入 6 位代码 → 探路 0.5 秒 → 人确认八格口径 → 开跑（真抓六类来源 6 到 7 分钟）。</p>
      <div class="inputs"><input value="519191" readonly><button class="btn">探路</button><button class="btn ghost">按此口径开跑</button><span class="hint">示例为只读，正式页面可改</span></div>
    </section>

    <section class="card">
      <div class="card-hd"><h2>最近的复盘</h2><span class="right">按运行时间倒序</span></div>
      <div class="list">
        <div class="row"><span class="code">519191</span><span class="nm">万家新利灵活配置混合<small>黄海 · 2020Q4–2026Q2 · 23 期</small></span><span class="tag2">主题坚守型</span><span class="met up">+76.80%</span></div>
        <div class="row"><span class="code">005827</span><span class="nm">易方达蓝筹精选混合<small>张坤等 · 30 期</small></span><span class="tag2">低换手长期持有型</span><span class="met up">+86.46%</span></div>
        <div class="row"><span class="code">090007</span><span class="nm">大成策略回报混合A<small>徐彦 · 26 期</small></span><span class="tag2">主题漂移型</span><span class="met up">+112.52%</span></div>
        <div class="row"><span class="code">005825</span><span class="nm">申万菱信智能驱动股票A<small>只覆盖 2 期</small></span><span class="tag2" style="color:var(--muted);background:#f4f1ea;border-color:var(--line)">样本不足</span><span class="met">—</span></div>
      </div>
    </section>
  </section>

  <!-- ============ 报告 ============ -->
  <section class="view" id="v-report">
    <div class="crumbs">报告 / <b>519191 万家新利灵活配置混合</b></div>
    <section class="kpis">
      <div class="kpi"><div class="k">区间收益</div><div class="v up">+76.80%</div><div class="s">2020Q4–2026Q2 · 逐季对账 22/22</div></div>
      <div class="kpi"><div class="k">最大回撤</div><div class="v down">−32.45%</div><div class="s">日频总收益指数口径</div></div>
      <div class="kpi"><div class="k">前十拟合 R²</div><div class="v">94.6%</div><div class="s">281 周 · 跟踪误差 6.66%</div></div>
      <div class="kpi"><div class="k">年化 α</div><div class="v up">+1.89%</div><div class="s">前十与市场之外的超额</div></div>
    </section>

    <section class="card">
      <div class="card-hd"><h2>报告新增的三节</h2><span class="tag">本期新增</span><span class="right">证据行可逐条核</span></div>
      <p class="sub">同一套数据，报告多出来三块：产品类型差异、持仓拟合、该追问的三个问题。</p>
      <div class="grid2">
        <div class="sec">
          <h3>产品类型差异说明</h3>
          <p>本基金判定为 <b>主动管理基金</b>，形态标签与调仓解读适用；若是 ETF / 联接，本节改成跟踪误差、费率与折溢价的读法。</p>
          <p class="ev">依据：名称与基金类型字段</p>
        </div>
        <div class="sec">
          <h3>持仓拟合：如果经理一直没动</h3>
          <div class="bar"><i style="width:94.6%"></i></div>
          <p>R² <b class="num">94.6%</b> · 相关 <b class="num">97.2%</b> · 跟踪误差 <b class="num">6.66%</b> · α 年化 <b class="num up">+1.89%</b></p>
          <p class="ev">281 周 · 前十平均占净值 73.88% · 其余用沪深300代理</p>
        </div>
        <div class="sec" style="grid-column:1/-1">
          <h3>该追问的三个问题</h3>
          <p>① 2026-05-29 实际 3.46%、理论 6.47%，差 <b class="num down">−3.00pp</b>，那一周发生了什么？</p>
          <p>② 区间收益 76.80% 里 53.8% 来自 2022Q1，是能力还是行情？</p>
          <p>③ 前十合计从 73.24% 变为 58.37%，主动减仓还是被稀释？</p>
          <p class="ev">每条附证据行，指回报告具体小节</p>
        </div>
      </div>
    </section>
  </section>

  <!-- ============ 横向对比 ============ -->
  <section class="view" id="v-compare">
    <div class="crumbs">工作区 / <b>横向对比</b> / ${CODES.length} 只基金</div>
    <section class="kpis">
      <div class="kpi"><div class="k">共同区间</div><div class="v">${j.window.days}<small> 天</small></div><div class="s">${esc(j.window.from)} 至 ${esc(j.window.to)}</div></div>
      <div class="kpi"><div class="k">区间收益最高</div><div class="v up">${pct(best.metrics.cumReturn)}</div><div class="s"><b>${esc(best.code)}</b> ${esc(best.name)}</div></div>
      <div class="kpi"><div class="k">最大回撤最深</div><div class="v down">${pct(worstDd.metrics.maxDrawdown)}</div><div class="s"><b>${esc(worstDd.code)}</b> ${esc(worstDd.name)}</div></div>
      <div class="kpi"><div class="k">对比只数</div><div class="v">${j.funds.length}<small> / 3</small></div><div class="s">样本不足会压暗标注</div></div>
    </section>

    <section class="card">
      <div class="card-hd"><h2>横向对比</h2><span class="tag">被动 / 主动自动区分</span><span class="right">口径：起点归一 100 · 区间取交集</span></div>
      <p class="sub">输入 6 位基金代码，最多 3 只。只抓净值，不跑完整复盘。</p>
      <div class="inputs">
        <input value="${CODES[0]}" readonly><input value="${CODES[1]}" readonly><input value="${CODES[2]}" readonly>
        <button class="btn">开始对比</button><span class="hint">示例为只读</span>
      </div>
      <div id="chart"></div>
      <div class="lg" id="legend"></div>
      <table>
        <thead><tr><th>基金</th><th>类型</th><th class="r">区间收益</th><th class="r">年化</th><th class="r">最大回撤</th><th class="r">年化波动</th><th class="r">报告期</th></tr></thead>
        <tbody>
        ${j.funds.map(f => `<tr>
          <td class="name"><b>${esc(f.code)}</b> ${esc(f.name)}<span class="sm">${esc(f.manager || '—')}</span></td>
          <td><span class="pill ${f.kind.isPassive ? 'pas' : ''}">${esc(f.kind.label)}</span></td>
          <td class="r num ${f.metrics.cumReturn >= 0 ? 'up' : 'down'}">${pct(f.metrics.cumReturn)}</td>
          <td class="r num">${pct(f.metrics.annualized)}</td>
          <td class="r num">${pct(f.metrics.maxDrawdown)}</td>
          <td class="r num">${pct(f.metrics.volAnnual)}</td>
          <td class="r num">${f.quarters == null ? '—' : f.quarters}</td>
        </tr>`).join('')}
        </tbody>
      </table>
      <p class="sub" style="margin-top:10px">读法：曲线只说明同一起点下的相对走势；被动产品与主动产品的形态标签不可比，看曲线与回撤即可。</p>
    </section>
  </section>

  <!-- ============ 数据底稿 ============ -->
  <section class="view" id="v-ledger">
    <div class="crumbs">数据底稿 / <b>519191</b></div>
    <section class="card">
      <div class="card-hd"><h2>逐报告期前十合计</h2><span class="right">23 期 · 末值 58.37%</span></div>
      <table>
        <thead><tr><th>报告期</th><th class="r">前十合计</th><th class="r">前五合计</th><th class="r">留存旧股</th><th class="r">新进</th><th class="r">Jaccard</th></tr></thead>
        <tbody>
          <tr><td>2020Q4</td><td class="r num">73.24%</td><td class="r num">45.60%</td><td class="r num">—</td><td class="r num">—</td><td class="r num">—</td></tr>
          <tr><td>2021Q2</td><td class="r num">74.58%</td><td class="r num">46.91%</td><td class="r num">7.0</td><td class="r num">3.0</td><td class="r num">0.62</td></tr>
          <tr><td>2022Q1</td><td class="r num">75.17%</td><td class="r num">47.22%</td><td class="r num">8.0</td><td class="r num">2.0</td><td class="r num">0.71</td></tr>
          <tr><td>2026Q2</td><td class="r num">58.37%</td><td class="r num">38.05%</td><td class="r num">6.0</td><td class="r num">4.0</td><td class="r num">0.48</td></tr>
        </tbody>
      </table>
      <p class="sub" style="margin-top:10px">完整底稿在页面上可下载 JSON / MD；这里只示意表格密度与字号。</p>
    </section>
  </section>
</main>

<div class="foot">变体 v2 · 版式与密度取自投研工作台方向，配色与字体沿用原版，涨跌改为红涨绿跌。原 index.html 未改动。</div>

<button class="fab" id="fab">问一句</button>
<aside class="drawer" id="drawer">
  <div class="dr-hd">问一句 <small>只答报告里已有的事</small><button id="drx">×</button></div>
  <div class="dr-log" id="drlog">
    <div class="msg bot">报告里区间收益 <b class="num up">+76.80%</b>，最大回撤 <b class="num down">−32.45%</b>；逐季与官方季报对账 22/22 期一致。<div class="ref">引用：perf.cumReturn · perf.maxDrawdown</div></div>
  </div>
  <div class="quick"><button>区间收益与回撤</button><button>形态依据</button><button>拟合残差</button></div>
  <form class="dr-form" id="drform"><input id="drin" placeholder="问报告里的事，例如：单季贡献最大的是哪一季"><button>发送</button></form>
  <p class="dr-foot">不预测涨跌、不推荐买卖、不评价基金经理个人。回答里的数字会被校验，对不上的会被标出来。</p>
</aside>

<script>
var DATA = ${JSON.stringify({ window: j.window, funds: j.funds.map(f => ({ code: f.code, name: f.name, series: f.series })) })};
var COLORS = ['#8f6231', '#1b2a3a', '#5b7a8c'];
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
  for (var i = 0; i <= 4; i++) {
    var v = min + (max - min) * i / 4, yy = y(v);
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
function activate(v) {
  document.querySelectorAll('nav button').forEach(function (x) { x.classList.toggle('on', x.dataset.v === v); });
  document.querySelectorAll('.view').forEach(function (el) { el.classList.toggle('on', el.id === 'v-' + v); });
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(function (b) {
  b.addEventListener('click', function () {
    activate(b.dataset.v);
    try { history.replaceState(null, '', '#' + b.dataset.v); } catch (e) { }
  });
});
/* 支持 #compare 之类直达，方便截图与分享 */
(function () {
  var h = (location.hash || '').replace(/^#/, '');
  if (h && document.getElementById('v-' + h)) activate(h);
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
  log.insertAdjacentHTML('beforeend', '<div class="msg bot">这是样式预览里的静态回答：正式页面会把问题发给 /api/ask，只喂报告字段摘要，回答里的数字逐个校验，答不了会直说。<div class="ref">拒答范围：预测涨跌 / 推荐基金 / 评价个人</div></div>');
  document.getElementById('drin').value = '';
  log.scrollTop = log.scrollHeight;
};
</script>
</body>
</html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('写出 ' + OUT);
console.log('  ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB · 基金 ' + j.funds.map(f => f.code).join('/'));
