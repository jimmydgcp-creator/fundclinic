/* 横向对比：用户输最多 3 个基金代码，抓净值（服务端 /api/compare）后画归一化曲线 + 对比表。
 * 零依赖：曲线用原生 SVG 拼，不引图表库。 */
(function (window) {
  'use strict';
  var FC = window.FC || (window.FC = {});
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var COLORS = ['#8f6231', '#1b2a3a', '#5b7a8c'];
  var state = { running: false, last: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var pct = function (v, d) { return (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d == null ? 2 : d) + '%'; };

  function svgChart(funds, windowInfo) {
    var W = 760, H = 300, padL = 46, padR = 14, padT = 12, padB = 26;
    var all = [];
    funds.forEach(function (f) { (f.series || []).forEach(function (p) { all.push(p.v); }); });
    if (!all.length) return '<p class="muted">没有可画的点</p>';
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    var span = Math.max(1e-6, max - min);
    min = Math.floor(min - span * 0.06); max = Math.ceil(max + span * 0.06);
    var t0 = new Date(windowInfo.from).getTime(), t1 = new Date(windowInfo.to).getTime();
    var x = function (d) { return padL + (W - padL - padR) * ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)); };
    var y = function (v) { return padT + (H - padT - padB) * (1 - (v - min) / Math.max(1e-6, max - min)); };

    var s = ['<svg class="cmp-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="净值曲线对比">'];
    /* 横向网格 + 纵轴刻度 */
    for (var i = 0; i <= 4; i++) {
      var vv = min + (max - min) * i / 4, yy = y(vv);
      s.push('<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" class="cmp-grid"/>');
      s.push('<text x="' + (padL - 6) + '" y="' + (yy + 3.5).toFixed(1) + '" class="cmp-axis" text-anchor="end">' + vv.toFixed(0) + '</text>');
    }
    /* 100 基准线 */
    if (min <= 100 && max >= 100) {
      s.push('<line x1="' + padL + '" y1="' + y(100).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(100).toFixed(1) + '" class="cmp-base"/>');
    }
    funds.forEach(function (f, idx) {
      var pts = (f.series || []).map(function (p) { return x(p.d).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ');
      s.push('<polyline points="' + pts + '" fill="none" stroke="' + COLORS[idx % COLORS.length] + '" stroke-width="1.8" stroke-linejoin="round"/>');
    });
    /* 横轴首末日期 */
    s.push('<text x="' + padL + '" y="' + (H - 8) + '" class="cmp-axis">' + esc(windowInfo.from) + '</text>');
    s.push('<text x="' + (W - padR) + '" y="' + (H - 8) + '" class="cmp-axis" text-anchor="end">' + esc(windowInfo.to) + '</text>');
    s.push('</svg>');

    var legend = funds.map(function (f, idx) {
      return '<span class="cmp-lg"><i style="background:' + COLORS[idx % COLORS.length] + '"></i>' + esc(f.code) + ' ' + esc(f.name) + '</span>';
    }).join('');
    return '<div class="cmp-legend">' + legend + '</div>' + s.join('');
  }

  function table(funds) {
    var head = '<thead><tr><th>基金</th><th>类型</th><th class="n">区间收益</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">年化波动</th><th>形态标签</th><th class="n">期数</th></tr></thead>';
    var rows = funds.map(function (f) {
      var m = f.metrics || {};
      /* 收益/年化/回撤有方向 -> 红涨绿跌(A 股习惯); 年化波动与期数只是"量", 不上色。
         方向判断统一走 FC.dirCls(<=0 记 green, 零值不上色)。 */
      var dRet = FC.dirCls(m.cumReturn), dAnn = FC.dirCls(m.annualized), dMdd = FC.dirCls(m.maxDrawdown);
      var cell = function (cls, v) { return '<td class="n' + (cls ? ' ' + cls : '') + '">' + v + '</td>'; };
      return '<tr' + (f.insufficient ? ' class="cmp-dim"' : '') + '><td><b>' + esc(f.code) + '</b> ' + esc(f.name) +
        (f.manager ? '<div class="muted">' + esc(f.manager) + '</div>' : '') + '</td>' +
        '<td>' + esc(f.kind && f.kind.label || '—') + '</td>' +
        cell('num' + (dRet ? ' ' + dRet : ''), pct(m.cumReturn)) +
        cell('num' + (dAnn ? ' ' + dAnn : ''), pct(m.annualized)) +
        cell(dMdd, pct(m.maxDrawdown)) +
        cell('', pct(m.volAnnual)) +
        '<td>' + esc(f.form || (f.insufficient ? '样本不足' : '未复盘')) + '</td>' +
        '<td class="n">' + (f.quarters == null ? '—' : f.quarters) + '</td></tr>';
    }).join('');
    return '<table class="tbl cmp-tbl">' + head + '<tbody>' + rows + '</tbody></table>';
  }

  function render(r) {
    var box = $('#cmp-result');
    if (!box) return;
    state.last = r;
    var warns = (r.warnings || []).length
      ? '<div class="cmp-warn">' + r.warnings.map(function (w) { return '<p>· ' + esc(w) + '</p>'; }).join('') + '</div>' : '';
    box.innerHTML = '<div class="cmp-head"><h3>共同区间 ' + esc(r.window.from) + ' 至 ' + esc(r.window.to) +
      '（' + r.window.days + ' 天）</h3><p class="muted">口径：' + esc(r.basis) + '。不同成立时间的基金只比重叠部分。</p></div>' +
      warns + svgChart(r.funds, r.window) + table(r.funds) +
      '<p class="muted">读法：曲线只说明同一起点下的相对走势；年化与回撤按共同区间计算。被动产品与主动产品的"形态标签"不可比，看曲线与回撤即可。</p>';
    box.classList.remove('hidden');
    if (window.FC && FC.show) FC.show('compare');
  }

  async function run() {
    if (state.running) return;
    var inputs = [$('#cmp-code-1'), $('#cmp-code-2'), $('#cmp-code-3')];
    var codes = inputs.map(function (el) { return el ? el.value.trim() : ''; }).filter(Boolean);
    var bad = codes.filter(function (c) { return !/^\d{6}$/.test(c); });
    var msg = $('#cmp-msg');
    if (!codes.length) { if (msg) msg.textContent = '至少输入一个 6 位基金代码'; return; }
    if (bad.length) { if (msg) msg.textContent = '代码格式不对：' + bad.join('、'); return; }
    if (msg) msg.textContent = '抓净值中（三只基金大约 2 到 6 秒）…';
    state.running = true;
    var btn = $('#btn-compare-run');
    if (btn) { btn.disabled = true; btn.textContent = '对比中…'; }
    try {
      var res = await fetch('api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: codes })
      });
      var j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
      if (msg) msg.textContent = '';
      render(j);
    } catch (e) {
      if (msg) msg.textContent = '对比失败：' + e.message;
    } finally {
      state.running = false;
      if (btn) { btn.disabled = false; btn.textContent = '开始对比'; }
    }
  }

  function init() {
    var btn = $('#btn-compare-run');
    if (btn) btn.addEventListener('click', run);
    var inputs = [$('#cmp-code-1'), $('#cmp-code-2'), $('#cmp-code-3')];
    inputs.forEach(function (el) {
      if (!el) return;
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    });
    /* 支持带参数直接对比：/?codes=519191,005827#compare —— 方便把某一组对比发给别人 */
    try {
      var m = /(?:^|[?&])codes=([^&#]+)/.exec(location.search + '&' + location.hash);
      if (m) {
        var list = decodeURIComponent(m[1]).split(/[,\s，、]+/).filter(Boolean).slice(0, 3);
        list.forEach(function (c, i) { if (inputs[i]) inputs[i].value = c; });
        if (list.length) run();
      }
    } catch (e) { /* 参数坏了就忽略 */ }
  }
  FC.initCompare = init;
  FC.compareRun = run;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
