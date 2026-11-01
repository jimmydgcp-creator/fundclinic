/* 页面内问答：右下角「问一句」抽屉。
 * 只问已经复盘过的那只基金；服务端只喂字段摘要，回答里的数字会被校验，编的数字会被降级标注。 */
(function (window) {
  'use strict';
  var FC = window.FC || (window.FC = {});
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var state = { open: false, busy: false, code: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* 复用页面上已经填过的模型配置（online.js 存在 fundclinic.llm.v1），否则服务端没有 Key 就没法回答 */
  function aiCfg() {
    var cfg = { baseUrl: '', model: '', apiKey: '' };
    try {
      var saved = JSON.parse(localStorage.getItem('fundclinic.llm.v1') || '{}');
      if (saved && saved.apiKey) { cfg.baseUrl = saved.baseUrl || ''; cfg.model = saved.model || ''; cfg.apiKey = saved.apiKey; }
    } catch (e) {}
    if (!cfg.apiKey) {
      var k = document.getElementById('llm-key') || document.getElementById('ai-key');
      var b = document.getElementById('llm-base') || document.getElementById('ai-base');
      var m = document.getElementById('llm-model') || document.getElementById('ai-model');
      if (k && k.value) { cfg.apiKey = k.value.trim(); cfg.baseUrl = (b && b.value || '').trim(); cfg.model = (m && m.value || '').trim(); }
    }
    return cfg;
  }
  function lastCode() {
    try { return localStorage.getItem('fundclinic.lastCode') || ''; } catch (e) { return ''; }
  }

  function buildDom() {
    var wrap = document.createElement('div');
    wrap.className = 'ask';
    wrap.innerHTML =
      '<button class="ask-fab" id="ask-fab" type="button" title="问一句（只答报告里已有的事）">问一句</button>' +
      '<aside class="ask-drawer" id="ask-drawer" aria-hidden="true">' +
      '<header class="ask-hd"><b>问一句</b><span class="muted">只答这份报告里已有的事</span>' +
      '<button class="ask-x" id="ask-x" type="button" aria-label="关闭">×</button></header>' +
      '<div class="ask-meta"><label>基金代码 <input id="ask-code" inputmode="numeric" maxlength="6" placeholder="用最近复盘的那只"></label>' +
      '<span class="ask-hint" id="ask-hint">先跑一次复盘，再问</span></div>' +
      '<div class="ask-log" id="ask-log"></div>' +
      '<div class="ask-quick" id="ask-quick">' +
      '<button type="button" data-q="这只基金区间收益多少，最大回撤多大？">区间收益与回撤</button>' +
      '<button type="button" data-q="为什么判成这个形态？依据是什么？">形态依据</button>' +
      '<button type="button" data-q="前十持仓拟合和实际净值差多少？说明什么？">拟合残差</button>' +
      '</div>' +
      '<form class="ask-form" id="ask-form"><input id="ask-input" placeholder="问报告里的事，例如：单季贡献最大的是哪一季" autocomplete="off">' +
      '<button type="submit" id="ask-send">发送</button></form>' +
      '<p class="ask-foot">不预测涨跌、不推荐买卖、不评价基金经理个人。回答里的数字会被服务端校验，对不上的会被标出来。</p>' +
      '</aside>';
    document.body.appendChild(wrap);
  }

  function open() {
    var d = $('#ask-drawer');
    if (!d) return;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    state.open = true;
    var input = $('#ask-input');
    if (input) setTimeout(function () { input.focus(); }, 120);
    var hint = $('#ask-hint');
    if (hint) hint.textContent = lastCode() ? '默认用最近一次复盘：' + lastCode() : '没找到最近复盘的代码，请手动填';
  }
  function close() {
    var d = $('#ask-drawer');
    if (!d) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    state.open = false;
  }

  function bubble(role, html) {
    var log = $('#ask-log');
    if (!log) return null;
    var el = document.createElement('div');
    el.className = 'ask-b ' + role;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function ask(q) {
    if (state.busy || !q) return;
    var codeEl = $('#ask-code');
    var code = (codeEl && codeEl.value.trim()) || lastCode();
    if (!/^\d{6}$/.test(code)) { bubble('sys', '先填 6 位基金代码，或先跑一次复盘。'); return; }
    state.busy = true;
    bubble('me', esc(q));
    var pending = bubble('bot', '<span class="ask-dots">…</span>');
    try {
      var res = await fetch('api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, question: q, ai: aiCfg() })
      });
      var j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + res.status));
      var html = '<p>' + esc(j.answer).replace(/\n/g, '</p><p>') + '</p>';
      if (j.refs && j.refs.length) html += '<p class="ask-refs">引用字段：' + j.refs.map(esc).join(' · ') + '</p>';
      if (j.degraded) html += '<p class="ask-warn">⚠ 上面这条含有未通过校验的数字，仅作原文引用，别直接采信。</p>';
      if (j.refused) html += '<p class="ask-warn">已按边界拒答。</p>';
      if (j.usage && j.usage.total_tokens) html += '<p class="ask-cost">本次 ' + j.usage.total_tokens + ' tokens</p>';
      pending.innerHTML = html;
    } catch (e) {
      pending.innerHTML = '<p class="ask-warn">问不了：' + esc(e.message) + '</p>';
    } finally {
      state.busy = false;
    }
  }

  function init() {
    buildDom();
    $('#ask-fab') && $('#ask-fab').addEventListener('click', function () { state.open ? close() : open(); });
    $('#ask-x') && $('#ask-x').addEventListener('click', close);
    var codeEl = $('#ask-code');
    if (codeEl) codeEl.value = lastCode();
    $('#ask-quick') && $('#ask-quick').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-q]');
      if (b) ask(b.getAttribute('data-q'));
    });
    $('#ask-form') && $('#ask-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#ask-input');
      var q = input && input.value.trim();
      if (input) input.value = '';
      ask(q);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });
    if (/[?&]ask=1/.test(location.search)) open();
  }

  FC.initAsk = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
