/* 在线模式: 输入基金代码 -> 服务端按 SOP §2 爬取 -> 出报告 MD / 结论卡 / 演示稿 HTML+PDF。
 *
 * 为什么必须有服务端: 浏览器从 file:// 页面跨域抓取天天基金会被 CORS 拦死; 把抓取放到本地
 * Node 服务就没有这个限制。本文件只负责跟本地服务对话与画进度, 不做任何抓取。
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var online = { available: false, health: null, summary: null, running: false, keyOk: false, serverKey: false };
  FC.online = online;

  var LS_KEY = 'fundclinic.llm.v1';

  function loadRemembered() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveRemembered(v) {
    try { v ? localStorage.setItem(LS_KEY, JSON.stringify(v)) : localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  /** 探路的前置条件: 6 位代码 + AI 模块可用。
   *  服务端已持有 Key 时(公网部署 / 本机配了 llm.local.json), #ai-key 里放的是占位符 __SERVER_SIDE__,
   *  访客只需要填代码 —— 原来的写法要求"Key 长度 > 8", 公网上按钮会因为一个访客根本看不见的
   *  输入框而被判成"没填好"(实际没坏, 但提示语是错的:"填好基金代码与 API Key 后可点")。 */
  function syncRunButton() {
    var btn = $('#btn-online-probe');
    if (!btn) return;
    var code = ($('#online-code').value || '').trim();
    var key = ($('#ai-key').value || '').trim();
    var base = ($('#ai-base').value || '').trim();
    var model = ($('#ai-model').value || '').trim();
    var keyReady = online.serverKey ? true : (key.length > 8 && !!base && !!model);
    var ready = /^\d{6}$/.test(code) && keyReady;
    btn.disabled = !ready || online.running;
    var hint = $('#probe-hint');
    if (hint) {
      if (ready) hint.textContent = '探路约 1 秒, 只抓元数据(概况/经理/报告期), 不抓持仓与 PDF';
      else hint.textContent = online.serverKey ? '填 6 位基金代码后即可点' : '填好基金代码与 API Key 后可点';
    }
  }

  function setAiStatus(ok, text) {
    var el = $('#ai-status');
    if (!el) return;
    el.className = 'kb-status ' + (ok === true ? 'kb-ok' : ok === false ? 'kb-bad' : '');
    el.textContent = text;
  }

  function log(line, kind) {
    var box = $('#online-log');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'log-line' + (kind ? ' log-' + kind : '');
    div.textContent = line;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() { var b = $('#online-log'); if (b) b.innerHTML = ''; }

  /* ------------------------------------------------------------ 运行步骤条
   * 7 个阶段是**量出来的**, 不是拍的: tools/capture_progress.mjs 跑一次完整流程, 录到 33 条
   * 真实进度消息, 归并出这 7 个阶段(见 index.html 里 #run-steps 的注释)。
   *
   * 消息→阶段的映射放在 app/steps.js, 因为它有独立的断言(tools/test_stepbar.mjs)。
   * 这里只负责画。
   *
   * 两条纪律:
   *   ① 只许前进不许后退。流水线里"官方窗口校准"这类动作会穿插出现, 允许后退进度条会来回跳。
   *   ② 没有匹配到任何规则的进度消息**不改状态** —— 宁可停着, 也不要跳到一个错的阶段。
   */
  var STEP_SEQ = (FC.steps && FC.steps.SEQ) || ['probe', 'crawl', 'parse', 'official', 'engine', 'ai', 'done'];
  var stepAt = -1;

  function stepIndexOf(msg) { return FC.steps ? FC.steps.indexOf(msg) : -1; }
  function stepEl(name) {
    var box = $('#run-steps');
    return box ? box.querySelector('.step[data-step="' + name + '"]') : null;
  }
  function markStep(name, state) {
    var el = stepEl(name);
    if (!el) return;
    el.classList.remove('is-doing', 'is-done', 'is-fail');
    if (state) el.classList.add('is-' + state);
  }
  function resetSteps(show) {
    var box = $('#run-steps');
    if (!box) return;
    box.classList.toggle('hidden', !show);
    STEP_SEQ.forEach(function (n) { markStep(n, null); });
    stepAt = -1;
  }
  function advanceBy(msg) {
    var idx = stepIndexOf(msg);
    if (idx < 0 || idx <= stepAt) return;
    for (var i = 0; i < idx; i++) markStep(STEP_SEQ[i], 'done');
    markStep(STEP_SEQ[idx], 'doing');
    stepAt = idx;
  }
  function finishSteps(ok) {
    if (stepAt >= 0) markStep(STEP_SEQ[stepAt], ok ? 'done' : 'fail');
    if (ok) STEP_SEQ.forEach(function (n) { markStep(n, 'done'); });
    stepAt = -1;
  }

  /* --------------------------------------------------- 当前基金语境条
   * 跑完之后在页面顶部一直挂着"现在看的是哪只基金", 免得翻到报告页就不知道在看谁。
   * 只在结果页/在线面板出现, 不干扰输入区。 */
  function renderCtxbar(s) {
    var host = $('#online-result');
    if (!host || !s) return;
    var old = document.getElementById('ctxbar');
    if (old) old.remove();
    var bits = [];
    bits.push('<span class="ctx-code">' + esc(s.code) + '</span>');
    bits.push('<span class="ctx-name">' + esc(s.name) + '</span>');
    bits.push('<span class="ctx-meta">' + esc(s.manager || '—') + ' · ' + esc(s.range || '—') + ' · ' + (s.quarters || '?') + ' 期</span>');
    bits.push('<span class="ctx-sp"></span>');
    if (s.formTag) bits.push('<span class="ctx-tag">形态 ' + esc(s.formTag) + '</span>');
    if (s.check) bits.push('<span class="ctx-tag">质检 ' + s.check.pass + '/' + s.check.total + '</span>');
    var bar = document.createElement('div');
    bar.className = 'ctxbar';
    bar.id = 'ctxbar';
    bar.innerHTML = bits.join('');
    host.parentNode.insertBefore(bar, host);
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ------------------------------------------------------------ 自检 */
  FC.detectOnline = async function () {
    var panel = $('#online-panel');
    if (!panel) return;
    if (location.protocol === 'file:') {
      panel.classList.add('offline-only');
      $('#online-hint').innerHTML =
        '<strong>当前是离线模式(直接打开 HTML 文件)。</strong><br>' +
        '浏览器不允许网页从本地文件跨域抓取天天基金的数据, 也不允许直连大模型接口(CORS)。' +
        '所以"输入代码 → 自动爬取 → AI 生成报告"需要一个本地小服务:' +
        '双击项目里的 <code>启动_基金复诊台.bat</code>, 再打开 <code>http://127.0.0.1:8787</code>。' +
        '抓取与生成全部在你自己的电脑上跑; 大模型那一步由本地服务转发, Key 只留在你本机, 不上传。<br>' +
        '不想装服务也行 —— 用下面的<strong>内置样例</strong>看完整效果, 计算与质检完全相同。';
      return;
    }
    try {
      var r = await fetch('/api/health');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var h = await r.json();
      online.available = !!h.ok;
      online.health = h;

      /* 代码过期检测: 改过代码但没重启服务时, 页面必须显眼提醒 ——
         否则用户会以为修复没生效(实际踩过: 报告里照样出现 [object Object])。 */
      if (h.staleCode) {
        var banner = document.createElement('div');
        banner.className = 'stale-banner';
        banner.innerHTML = '<strong>⚠ 服务在跑旧代码, 请重启</strong><br>' + FC.esc(h.staleNote || '') +
          '<br><span class="hint">代码最后修改 ' + FC.esc(String(h.newestSourceAt).slice(0, 19).replace('T', ' ')) +
          ' , 服务启动于 ' + FC.esc(String(h.bootAt).slice(0, 19).replace('T', ' ')) + '</span>';
        var host = $('#online-panel');
        if (host && !host.querySelector('.stale-banner')) host.insertBefore(banner, host.children[1] || null);
        FC.toast('服务在跑旧代码, 请重启: 关掉启动窗口再双击「启动_基金复诊台.bat」', 'err');
      }

      /* 服务端已持有 Key —— 这在公网上是**默认情形**, 也是访客唯一会遇到的情形:
         所以整块 Key 表单收掉, 换一句人话, 不再出现"API Key / 申请 / 测试连通性"这些词。
         #ai-key 里塞占位符, 这样 probe / runOnline 的取值逻辑一行都不用改。
         本机没配 Key 时(自带 Key 自己跑)保持原样, 只是状态栏提示改成"需要你自己填"。 */
      if (h.llm) {
        if (!$('#ai-base').value || $('#ai-base').value === 'https://api.deepseek.com') $('#ai-base').value = h.llm.baseUrl;
        if (!$('#ai-model').value || $('#ai-model').value === 'deepseek-v4-flash') $('#ai-model').value = h.llm.model;
        if (h.llm.hasKey) {
          online.serverKey = true;
          if (!$('#ai-key').value) $('#ai-key').value = '__SERVER_SIDE__';
          $('#ai-key').disabled = true;
          setAiStatus(true, '② AI 模块可用(服务端已配置)');
          var ab = $('#ai-block'); if (ab) ab.classList.add('hidden');
          var skn = $('#server-key-note');
          if (skn) {
            skn.classList.remove('hidden');
            skn.innerHTML = 'AI 模块由<strong>本站服务端</strong>提供 —— 你只需要输入基金代码, 不用申请、也不用填写任何 Key。' +
              '大模型只做语言类的事(主题归类 / 判断起草 / 深度报告 / 演示稿编排 / 用词清洗), 抓取、计算、对账、质检全部由脚本完成; ' +
              '它的每一份输出都要过校验(数字回查 / 覆盖率 / 违禁词 / 数字守恒)才允许进报告, 不通过一律拦截。' +
              '你提供的只有那 6 位基金代码, 本站没有你的任何账号信息。';
          }
        } else {
          setAiStatus(null, '② 需要你自己填一个 API Key(见下方)');
        }
      }
      // 本机浏览器记住过就直接填回来
      var saved = loadRemembered();
      if (saved && saved.apiKey && !$('#ai-key').value) {
        $('#ai-base').value = saved.baseUrl || $('#ai-base').value;
        $('#ai-model').value = saved.model || $('#ai-model').value;
        $('#ai-key').value = saved.apiKey;
        $('#ai-remember').checked = true;
        setAiStatus(null, '② 已从本机浏览器载入上次的 Key, 建议先测试连通性');
      }

      /* 公网额度: 让访客在点"开始复盘"之前就知道今天还剩几次、为什么会被拦。
         本机模式(未启用闸门)时这一段整块不显示, 页面看上去和以前一模一样。 */
      if (h.quota && h.quota.enabled) {
        var q = h.quota, L = q.limits;
        var box = $('#quota-note');
        if (box) {
          box.classList.remove('hidden');
          var tight = q.dayLeft <= 5;
          box.innerHTML = '本站在线试用额度: 今天还剩 <b>' + q.dayLeft + '</b> 次(全站 ' + L.maxRunsDay + ' 次/天, 每台机器 '
            + L.perIpHour + ' 次/小时) · 今天已跑 ' + q.dayRuns + ' 次'
            + (tight ? '<br><span style="color:var(--warn)">额度快用完了 —— 想反复试的话, 用下面的内置样例模式, 不消耗额度。</span>' : '');
        }
      }

      var panel2 = $('#online-panel');
      panel2.classList.remove('hidden');
      /* 路径取末段: 不能只按 "\\" 切, macOS 用 "/" —— 否则 Mac 上会把整条路径显示出来。 */
      var base = function (p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''; };
      online.popplerHint = h.popplerHint || '';
      online.env = { pdftotext: !!h.pdftotext, edge: !!h.edge };
      $('#online-hint').innerHTML =
        '数据来源: <strong>六类公开来源</strong>(官方定期报告 PDF 为最高权威, 第三方平台只做交叉验证)。' +
        '<span class="envchk">官方 PDF 解析 ' + (h.pdftotext ? '✓ ' + base(h.pdftotextPath) : '✗ 未安装 Poppler, 官方对账会标记为未完成') + '</span>' +
        '<span class="envchk">PDF 导出 ' + (h.edge ? '✓ ' + base(h.edge) : '✗ 未找到 Edge/Chrome') + '</span>' +
        '<span class="envchk">AI 模块 ' + (online.serverKey ? '由本站服务端提供' : '<strong>需自带 Key</strong>') + '</span>' +
        /* 缺 Poppler 时直接把**本机对应的**安装命令摆出来, 不让用户自己去猜去搜 */
        (!h.pdftotext && h.popplerHint
          ? '<div class="note" style="margin-top:8px">装上它能让报告多出最关键的一栏(官方季报逐行对账)。在' +
            (navigator.platform && /Mac/i.test(navigator.platform) ? '「终端」' : 'PowerShell') +
            '里执行: <code>' + FC.esc(h.popplerHint) + '</code>' +
            (/^brew/.test(h.popplerHint) ? '(需要先装 Homebrew)' : '') +
            ', 然后重启一次服务。</div>'
          : '');
      syncRunButton();
      /* 质检页要按"有没有服务端"决定长什么样(有服务端就整页只读, 见 ui.js renderAudit)。
         页面初始化时还不知道 -- 那时 FC.online.available 还是 false, 会先画成"要人工中转"的样子,
         所以探到服务端之后必须重画一次, 否则公网上会残留一批本不该出现的按钮和输入框。 */
      if (FC.renderAll && FC.state && FC.state.analysis) FC.renderAll();
      // 有历史就自动恢复最近一次 —— 刷新/回退/重开浏览器都不丢结果
      FC.restoreLast();
    } catch (e) {
      panel.classList.add('hidden');
    }
  };

  /* ==================================================== 第一阶段: 探路 */
  var gate1 = null;   // 探路结果 + 用户改动

  FC.probe = async function () {
    if (online.running) return;
    var code = ($('#online-code').value || '').trim();
    if (!/^\d{6}$/.test(code)) { FC.toast('基金代码必须是 6 位数字', 'err'); return; }
    var keyVal = ($('#ai-key').value || '').trim();
    if (!keyVal) { FC.toast('AI 模块为必选: 请先填写 API Key', 'err'); return; }

    online.running = true; syncRunButton();
    $('#gate1-table').classList.add('hidden');
    $('#online-result').innerHTML = '';
    clearLog();
    /* 探路是第 1 步, 但它**不是**流水线发的消息(在服务端 /api/probe 里), 所以手动点亮 */
    resetSteps(true);
    markStep('probe', 'doing');
    stepAt = 0;
    log('探路: ' + code + ' · 只抓元数据(概况/经理履历/报告期清单)', 'head');
    FC.setStatus('探路中 ' + code + ' …');
    try {
      var r = await fetch('/api/probe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, years: Number(($('#online-years') || {}).value || 10) })
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      gate1 = j.probe;
      log('探路完成 · ' + gate1.fund.name + ' · ' + gate1.probeMs + ' ms', 'ok');
      markStep('probe', 'done');
      stepAt = 0;
      renderGate1();
      FC.setStatus('待确认口径: ' + code);
    } catch (e) {
      log('✗ 探路失败: ' + e.message, 'err');
      markStep('probe', 'fail');
      stepAt = -1;
      FC.toast('探路失败: ' + e.message, 'err');
    } finally {
      online.running = false; syncRunButton();
    }
  };

  /* ------------------------------------------- SOP §0 八格口径确认表 */
  function renderGate1() {
    var p = gate1, d = p.gate1Draft;
    var box = $('#gate1-body');
    var opt = function (v, label, cur) { return '<option value="' + FC.esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + FC.esc(label) + '</option>'; };

    var rows = [];

    /* 1 基金代码/全称/简称 */
    rows.push('<tr><th>① 基金代码 / 全称 / 简称</th><td>' +
      '<input type="text" id="g1-code" value="' + FC.esc(d.code) + '" readonly style="max-width:110px;display:inline-block"> ' +
      '<input type="text" id="g1-name" value="' + FC.esc(d.fundName) + '" style="max-width:320px;display:inline-block">' +
      (p.fund.fullName ? '<div class="note">全称: ' + FC.esc(p.fund.fullName) + ' · ' + FC.esc(p.fund.company) + ' · ' + FC.esc(p.fund.type) + ' · 成立 ' + FC.esc(p.fund.inception || '—') + '</div>' : '') +
      '</td></tr>');

    /* 2 基金经理(含历任、共管期)—— 这是原版 AI 一定会问的那一格 */
    var mgrOpts = p.managers.map(function (m, i) {
      var lbl = m.managers.join('+') + '(' + m.start + ' ~ ' + m.end + ')' + (m.coManaged ? '【共管期】' : '') + ' 任职' + (m.tenure || '');
      return opt('m' + i, lbl, d.managerLabel && m.managers.join('+') === d.managerLabel && i === 0 ? lbl : '');
    }).join('');
    rows.push('<tr><th>② 基金经理<span class="req">*</span><div class="note">含历任;共管期操作不能全归功于现任</div></th><td>' +
      '<select id="g1-manager">' + p.managers.map(function (m, i) {
        var lbl = m.managers.join('+') + '(' + m.start + ' ~ ' + m.end + ')' + (m.coManaged ? '【共管期】' : '') + ' 任职' + (m.tenure || '') + (m.returnPct !== null && m.returnPct !== undefined ? ' 任内' + m.returnPct + '%' : '');
        return '<option value="m' + i + '"' + (i === 0 ? ' selected' : '') + '>' + FC.esc(lbl) + '</option>';
      }).join('') + '</select>' +
      (p.managers.some(function (m) { return m.coManaged; }) ? '<div class="flag">检出共管期: ' + p.managers.filter(function (m) { return m.coManaged; }).map(function (m) { return m.managers.join('+') + '(' + m.start + '~' + m.end + ')'; }).join('、') + ' —— 这段时间的操作不能全归功于单人</div>' : '') +
      '</td></tr>');

    /* 3 复盘区间 —— 候选直接列出来让用户点 */
    var candRows = p.candidates.map(function (c) {
      return '<label class="cand' + (c.recommended ? ' cand-rec' : '') + '">' +
        '<input type="radio" name="g1cand" value="' + FC.esc(c.id) + '"' + (c.recommended ? ' checked' : '') + '>' +
        '<span>' + FC.esc(c.label) + '<br><b>' + c.from + ' ~ ' + c.to + '</b> · ' + c.n + ' 期' +
        (c.coManaged ? ' <span class="flag-inline">共管期</span>' : '') + '</span></label>';
    }).join('');
    rows.push('<tr><th>③ 复盘区间(起点季度)<span class="req">*</span><div class="note">SOP: 默认经理上任季度;跨度过长可截断</div></th><td>' +
      '<div class="cands">' + candRows + '</div>' +
      '<div class="note" id="g1-range-reason">推荐理由: ' + FC.esc(p.recommendReason) + '</div>' +
      '<div class="note">也可手工微调: <input type="text" id="g1-from" value="' + FC.esc(d.rangeFrom) + '" style="width:110px"> ~ <input type="text" id="g1-to" value="' + FC.esc(d.rangeTo) + '" style="width:110px"></div>' +
      '</td></tr>');

    /* 4 数据截止日 */
    rows.push('<tr><th>④ 数据截止日<span class="req">*</span></th><td><input type="text" id="g1-cutoff" value="' + FC.esc(d.dataCutoff) + '" readonly></td></tr>');

    /* 5 业绩比较基准 —— SOP 要求"中途调整过要标注" */
    rows.push('<tr><th>⑤ 业绩比较基准<span class="req">*</span><div class="note">SOP: 从季报抄;中途调整过要标注</div></th><td>' +
      '<input type="text" id="g1-benchmark" value="' + FC.esc(d.benchmark) + '">' +
      '<div class="note">初值取自基金概况页。开跑后会下载抽样的官方季报 PDF 再核一遍, 若区间内调整过会在报告里标红 —— 实测 002910 就在 2026Q2 把基准从「沪深300×65%」换成了「中证800×85%」。</div>' +
      '</td></tr>');

    /* 6 收益口径 */
    rows.push('<tr><th>⑥ 收益口径<span class="req">*</span></th><td>' +
      '<select id="g1-return">' +
      '<option value="tr" selected>分红再投总回报指数(单位净值 + 除息日分红回加)【推荐】</option>' +
      '<option value="nav">单位净值口径(不复权, 含分红基金会低估)</option>' +
      '</select><div class="note">SOP v2.5: 不能用累计净值做比值 —— 它是加法累积量, 实测偏差最高 46pp。</div></td></tr>');

    /* 7 只看前十大 */
    rows.push('<tr><th>⑦ 只看前十大 / 全持仓</th><td><input type="text" id="g1-scope" value="' + FC.esc(d.scope) + '" readonly>' +
      '<div class="note">季报只保证披露前十, 其余不可得 —— 这一格没有第二个选项。</div></td></tr>');

    /* 8 产出目录 */
    rows.push('<tr><th>⑧ 产出目录<span class="req">*</span></th><td><input type="text" id="g1-outdir" value="' + FC.esc(d.outputDir) + '" readonly>' +
      '<div class="note">结果按基金代码存在本机项目目录下, 页面上一键下载。</div></td></tr>');

    box.innerHTML = rows.join('');
    $('#probe-summary').innerHTML = '探路结果: <strong>' + FC.esc(p.fund.name) + '(' + p.code + ')</strong> · 报告期网格 ' + p.periods.length +
      ' 期(' + p.periods[0].period + '~' + p.periods[p.periods.length - 1].period + ') · 历任经理 ' + p.managers.length + ' 任 · 用时 ' + p.probeMs + ' ms' +
      '<br>' + p.notes.map(function (n) { return '· ' + FC.esc(n); }).join('<br>');

    // 点候选区间 => 自动回填起止
    document.querySelectorAll('input[name=g1cand]').forEach(function (r) {
      r.addEventListener('change', function () {
        var c = p.candidates.filter(function (x) { return x.id === r.value; })[0];
        if (!c) return;
        $('#g1-from').value = c.from; $('#g1-to').value = c.to;
        var mi = p.managers.findIndex(function (m) { return m.managers.join('+') === (c.managers || []).join('+') && m.start === c.start; });
        if (mi >= 0) $('#g1-manager').value = 'm' + mi;
        $('#g1-range-reason').textContent = (c.recommended ? '推荐理由: ' + p.recommendReason : '已选: ' + c.label + ' · ' + c.n + ' 期' + (c.coManaged ? '【共管期, 业绩归因需谨慎】' : ''));
      });
    });

    $('#gate1-table').classList.remove('hidden');
    $('#gate1-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    syncGate1Table();
  }

  /** 八格全填才放行 —— 这是 SOP 的"任何一格留空不许开跑" */
  function syncGate1Table() {
    var btn = $('#btn-online-run');
    if (!btn || !gate1) return;
    var vals = ['#g1-code', '#g1-name', '#g1-manager', '#g1-from', '#g1-to', '#g1-cutoff', '#g1-benchmark', '#g1-return', '#g1-scope', '#g1-outdir']
      .map(function (s) { var e = $(s); return e ? String(e.value || '').trim() : ''; });
    var empty = vals.filter(function (v) { return !v; }).length;
    var badRange = ($('#g1-from').value || '') > ($('#g1-to').value || '');
    btn.disabled = empty > 0 || badRange;
    var st = $('#gate1-status');
    if (st) st.textContent = empty > 0 ? ('还有 ' + empty + ' 格未填') : (badRange ? '区间起点晚于终点, 请检查' : '口径已齐, 可以开跑');
  }

  /* ------------------------------------------- 下载: 一律走 blob, 不导航 */
  /* 为什么不用 <a href="/api/download?...">: 部分浏览器会把它当普通导航, 直接在内页渲染出来,
     用户按回退时页面被重载, 之前跑的结果就没了(实测踩到)。改成 fetch + Blob + a.download,
     保证是"下载"而不是"跳转", 出错也能给出可读提示。 */
  async function downloadFile(code, key, label) {
    try {
      FC.toast('正在准备 ' + label + ' …');
      const r = await fetch('/api/download?code=' + encodeURIComponent(code) + '&f=' + encodeURIComponent(key));
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { msg = (await r.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      let fname = label;
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      if (m) { try { fname = decodeURIComponent(m[1]); } catch (e) {} }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      FC.toast('已下载 ' + fname + '(' + (blob.size / 1024).toFixed(0) + ' KB)', 'ok');
    } catch (e) {
      FC.toast('下载失败: ' + e.message, 'err');
    }
  }

  /* ------------------------------------------- 历史记录与恢复 */
  var HISTORY = [];

  FC.refreshHistory = async function () {
    try {
      var r = await fetch('/api/history');
      if (!r.ok) return;
      var j = await r.json();
      HISTORY = j.runs || [];
      renderHistory();
    } catch (e) { /* 忽略 */ }
  };

  function renderHistory() {
    var box = $('#online-history');
    if (!box) return;
    if (!HISTORY.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML =
      '<h4 style="margin:0 0 8px;font-size:13.5px;color:var(--navy)">最近的复盘记录(跑过就存下来了, 刷新、关浏览器、重启服务都还在)</h4>' +
      '<table class="tbl tbl-compact"><thead><tr><th>时间</th><th>基金</th><th>区间 / 期数</th><th>形态</th><th>质检</th><th>操作</th></tr></thead><tbody>' +
      HISTORY.slice(0, 12).map(function (h) {
        return '<tr><td class="mono">' + String(h.at || '').slice(0, 16).replace('T', ' ') + '</td>' +
          '<td><strong>' + FC.esc(h.name) + '</strong><br><span class="mono">' + FC.esc(h.code) + '</span></td>' +
          '<td>' + FC.esc(h.range) + ' · ' + h.quarters + ' 期</td>' +
          '<td>' + FC.esc(h.formTag) + '</td>' +
          '<td>' + FC.esc(h.check || '—') + '</td>' +
          '<td><button class="btn btn-sm btn-load-run" data-code="' + FC.esc(h.code) + '">载入</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /** 把某次运行的结果重新画到页面上(不重跑, 直接读服务端存下来的结果) */
  FC.loadRun = async function (code, opts) {
    opts = opts || {};
    try {
      FC.setStatus('载入 ' + code + ' 的历史结果…');
      var r = await fetch('/api/result?code=' + encodeURIComponent(code));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || '读取失败');
      online.summary = j.summary;
      gate1 = null;
      var gt = $('#gate1-table'); if (gt) gt.classList.add('hidden');
      clearLog();
      log('已载入 ' + code + ' 的历史结果(' + String((j.summary && j.summary.range) || '') + ')', 'ok');
      renderResult(j.summary);
      renderCtxbar(j.summary);
      FC.applyServerResult(j.analysis, j.check, j.datasetMeta, j.summary);
      try { localStorage.setItem('fundclinic.lastCode', code); } catch (e) {}
      if (opts.silent) { FC.setStatus('已恢复上次复盘: ' + code + '(' + ((j.summary && j.summary.range) || '') + ')'); }
      else { FC.toast('已恢复 ' + (j.summary && j.summary.name) + ' 的复盘结果', 'ok'); FC.show('report'); }
    } catch (e) {
      if (!opts.silent) FC.toast('载入失败: ' + e.message, 'err');
    }
  };

  /** 页面打开时: 有历史就自动恢复最近一次, 并把代码填回输入框 */
  FC.restoreLast = async function () {
    if (!online.available) return;
    await FC.refreshHistory();
    var last = null;
    try { last = localStorage.getItem('fundclinic.lastCode'); } catch (e) {}
    var code = last || (HISTORY[0] && HISTORY[0].code);
    if (!code) return;
    var box = $('#online-code');
    /* 把上次的代码填回输入框之后**必须重算一次按钮状态**:
       按钮只听 input/change 事件, 而这里是脚本赋值, 不触发事件 ——
       结果是代码明明填好了(还是自动填的), "开始复盘"却一直是灰的, 得先手动碰一下输入框。
       公网形态下更明显: 服务端有 Key, 唯一的前置条件就是这 6 位代码。 */
    if (box && !box.value) { box.value = code; syncRunButton(); }
    await FC.loadRun(code, { silent: true });
  };

  /* --------------------------------------------------- Key 连通性测试 */
  FC.pingAi = async function () {
    var key = ($('#ai-key').value || '').trim();
    if (!key) { FC.toast('请先填 API Key', 'err'); return; }
    var btn = $('#btn-ai-ping');
    btn.disabled = true;
    setAiStatus(null, '② 正在测试 Key …');
    try {
      var r = await fetch('/api/llm/ping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: ($('#ai-base').value || '').trim(), model: ($('#ai-model').value || '').trim(), apiKey: key === '__SERVER_SIDE__' ? '' : key })
      });
      var j = await r.json();
      if (j.ok) {
        online.keyOk = true;
        setAiStatus(true, '② Key 可用 · ' + j.model + ' · ' + j.latencyMs + ' ms');
        FC.toast('Key 测试通过: ' + j.model + '(' + j.latencyMs + ' ms)', 'ok');
        if ($('#ai-remember').checked) {
          saveRemembered({ baseUrl: $('#ai-base').value.trim(), model: $('#ai-model').value.trim(), apiKey: key === '__SERVER_SIDE__' ? '' : key });
        }
      } else {
        online.keyOk = false;
        setAiStatus(false, '② Key 不可用: ' + (j.error || '未知错误'));
        FC.toast('Key 测试失败: ' + (j.error || '') + (j.detail ? ' · ' + j.detail : ''), 'err');
      }
    } catch (e) {
      online.keyOk = false;
      setAiStatus(false, '② 测试失败: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  };

  /* ------------------------------------------------------------ 跑一次 */
  FC.runOnline = async function () {
    if (online.running) return;
    var code = ($('#online-code').value || '').trim();
    if (!/^\d{6}$/.test(code)) { FC.toast('基金代码必须是 6 位数字', 'err'); return; }

    var keyVal = ($('#ai-key').value || '').trim();
    var serverSide = keyVal === '__SERVER_SIDE__';
    if (!keyVal || (!serverSide && keyVal.length <= 8)) { FC.toast('AI 模块为必选: 请先填写 API Key', 'err'); return; }
    // 没测过连通性不拦人, 只在日志里提醒一句(多数人填完就直接点开始)
    if (!online.keyOk && !serverSide) log('  提示: 这次没先测试 Key 连通性。若 Key 不可用, AI 三步会被拦截, 报告会用规则引擎的结论(照常产出)。');
    if ($('#ai-remember').checked && !serverSide) {
      saveRemembered({ baseUrl: ($('#ai-base').value || '').trim(), model: ($('#ai-model').value || '').trim(), apiKey: keyVal });
    }

    var body = {
      code: code,
      years: Number(($('#online-years') || {}).value || 10),
      verifyOfficial: true,
      pdf: true,
      cleanReport: true,
      ai: {
        enabled: true,
        baseUrl: ($('#ai-base').value || '').trim(),
        model: ($('#ai-model').value || '').trim(),
        apiKey: serverSide ? '' : keyVal
      }
    };

    /* 带上人确认过的口径(SOP §0 八格) —— 采集阶段必须按这个区间跑, 不许自己再挑一次 */
    if (gate1) {
      var mi = String($('#g1-manager').value || '').replace(/^m/, '');
      var mgr = gate1.managers[Number(mi)];
      body.fromPeriod = ($('#g1-from').value || '').trim();
      body.toPeriod = ($('#g1-to').value || '').trim();
      body.gate1 = {
        confirmed: true,
        confirmedAt: new Date().toISOString(),
        code: $('#g1-code').value.trim(),
        fundName: $('#g1-name').value.trim(),
        managerLabel: mgr ? mgr.managers.join('+') : '',
        managerStart: mgr ? mgr.start : '',
        managerEnd: mgr ? mgr.end : '',
        managerCoManaged: mgr ? !!mgr.coManaged : false,
        rangeFrom: body.fromPeriod,
        rangeTo: body.toPeriod,
        dataCutoff: $('#g1-cutoff').value.trim(),
        benchmark: $('#g1-benchmark').value.trim(),
        returnBasis: $('#g1-return').value,
        scope: $('#g1-scope').value.trim(),
        outputDir: $('#g1-outdir').value.trim(),
        rangeReason: $('#g1-range-reason').textContent
      };
      log('口径已确认: 经理 ' + body.gate1.managerLabel + ' · 区间 ' + body.fromPeriod + '~' + body.toPeriod + ' · 基准 ' + body.gate1.benchmark);
    } else {
      FC.toast('请先探路并填写口径确认表', 'err');
      return;
    }

    online.running = true;
    syncRunButton();
    $('#online-result').innerHTML = '';
    clearLog();
    /* 探路那一步保持"已完成", 从这里开始等流水线的进度消息推进 */
    if (stepAt < 0) { resetSteps(true); markStep('probe', 'done'); stepAt = 0; }
    log('开始: ' + code + ' · 按六类公开来源采集 · AI 模块 ' + body.ai.model, 'head');
    FC.setStatus('在线模式: 正在采集 ' + code + ' …');
    var t0 = Date.now();

    try {
      var res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        /* 公网模式下最常见的不 ok 是**额度用尽(429)**, 服务端已经写好了给人看的中文原因。
           原来一律拼成 "服务返回 429: {json}", 访客看不懂、还会以为是自己操作错了。
           先把 JSON 里的 error 抠出来, 抠不到才回落成原来的写法。 */
        var errTxt = await res.text();
        var nice = '';
        try { nice = (JSON.parse(errTxt) || {}).error || ''; } catch (e) { /* 不是 JSON 就走下面的回落 */ }
        if (!nice) nice = '服务返回 ' + res.status + ': ' + errTxt.slice(0, 300);
        throw new Error(nice);
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';
      var done = null;
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var ev;
          try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.type === 'progress') { log('  ' + ev.msg); advanceBy(ev.msg); }
          else if (ev.type === 'start') { /* noop */ }
          else if (ev.type === 'ping') { /* 心跳: 服务端还在跑, 只是这段时间没有新进展。不打印, 免得刷屏 */ }
          else if (ev.type === 'error') { log('✗ ' + ev.error, 'err'); if (ev.detail) log('   ' + ev.detail, 'err'); }
          else if (ev.type === 'done') done = ev;
        }
      }
      if (!done) throw new Error('流程未返回结果(详见上方日志)');

      online.summary = done.summary;
      log('完成: ' + done.summary.name + ' · ' + done.summary.range + ' · ' + done.summary.quarters + ' 期 · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', 'ok');
      finishSteps(true);
      renderResult(done.summary);
      renderCtxbar(done.summary);
      FC.applyServerResult(done.analysis, done.check, done.datasetMeta, done.summary);
      FC.toast('复盘完成: ' + done.summary.name + '(' + done.summary.formTag + ')', 'ok');
      FC.show('report');
    } catch (e) {
      /* 连接断了 ≠ 白跑了。
         组员在 macOS/Safari 上遇到过一句光秃秃的 "Load failed"(那是 Safari 的网络层措辞),
         看起来像整件事失败了, 其实服务端很可能还在跑、甚至已经跑完并且落盘了。
         所以这里不再只丢一句原始报错, 而是: 解释 + 去服务端问一次到底成没成。 */
      var msg = String(e && e.message || e);
      var looksLikeDrop = /load failed|failed to fetch|networkerror|network error|terminated|other side closed/i.test(msg);
      log('✗ ' + msg, 'err');
      if (looksLikeDrop) {
        log('  这一句是浏览器的网络层报错, 不是工具本身报的错 —— 多半是连接被中途掐断了。', 'err');
        log('  服务端可能还在继续跑。正在问它一句结果到底出没出...', 'err');
        var recovered = false;
        for (var attempt = 0; attempt < 6 && !recovered; attempt++) {
          try {
            var rr = await fetch('/api/result?code=' + encodeURIComponent(body.code));
            if (rr.ok) {
              var saved = await rr.json();
              /* files 挂在 summary 下面(summary 就是 pipeline 的 summary), 不是顶层 */
              if (saved && saved.summary && saved.summary.files && saved.summary.range) {
                online.summary = saved.summary;
                finishSteps(true);
                renderResult(saved.summary);
                renderCtxbar(saved.summary);
                if (saved.analysis) FC.applyServerResult(saved.analysis, saved.check, saved.datasetMeta, saved.summary);
                log('  ✓ 结果其实已经生成好了(服务端已落盘), 已直接给你载入。', 'ok');
                FC.toast('连接中断, 但结果已生成 —— 已自动载入', 'ok');
                FC.show('report');
                recovered = true;
                break;
              }
            }
          } catch (e2) { /* 服务端可能还在忙, 等下一轮 */ }
          await new Promise(function (r) { setTimeout(r, 2500); });
        }
        if (!recovered) {
          log('  暂时没拿到结果。可能是: ① 服务端还在跑(再等一会儿刷新页面) ② 服务端已经退出', 'err');
          log('  —— 看启动服务的那个终端窗口, 如果它已经关了, 重新双击启动文件再跑一次。', 'err');
          log('  —— 如果窗口里有红色报错, 把那个窗口截图发我; 完整堆栈也写在 _runs/_server-error.log 里。', 'err');
          FC.toast('连接中断, 请稍后刷新页面看「最近的复盘记录」', 'err');
        }
      }
      FC.toast('在线复盘失败: ' + e.message, 'err');
      FC.setStatus('在线模式失败');
      finishSteps(false);
    } finally {
      online.running = false;
      syncRunButton();
    }
  };

  /* ------------------------------------------------------------ 结果面板 */
  function renderResult(s) {
    var box = $('#online-result');
    var dl = function (key, label) {
      return '<button class="btn btn-sm btn-dl" data-key="' + key + '" data-label="' + FC.esc(label) + '">' + label + '</button>';
    };
    var official = s.official;
    var officialHtml = official
      ? (official.pdftotext
        ? (official.checks || []).map(function (c) {
          return '<li>' + c.period + ' · ' + (c.ok
            ? '<span class="pos">逐行一致</span>(' + c.parsedRows + ' 行, 权重最大差 ' + (c.maxDiff === null ? '—' : c.maxDiff.toFixed(3)) + 'pp)'
            : '<span class="neg">有差异</span>' + (c.diffs && c.diffs.length ? ': ' + c.diffs.join('; ') : (c.note || ''))) + '</li>';
        }).join('') || '<li>本次未对到官方报告</li>'
        : '<li class="neg">本机未安装 Poppler(pdftotext), 官方报告 PDF 无法解析 —— 已如实标记为"未完成", 不会假装对过账' +
          (online.popplerHint
            ? '<br>装上它就能补上这一栏。在' + (/Mac/i.test(navigator.platform || '') ? '「终端」' : 'PowerShell') +
              '里执行: <code>' + FC.esc(online.popplerHint) + '</code>' + (/^brew/.test(online.popplerHint) ? '(需要先装 Homebrew)' : '') +
              ', 然后重启一次服务再跑。'
            : '') + '</li>')
      : '<li>未执行</li>';

    /* AI 三步的总体成败横幅: 必选模块出问题时必须在最显眼处说清楚 */
    var aiOk = (s.aiLog || []).filter(function (x) { return x.ok; }).length;
    var aiTotal = (s.aiLog || []).length;
    var aiBanner = '';
    if (aiTotal) {
      aiBanner = aiOk === aiTotal
        ? '<div class="card ok" style="margin-bottom:12px"><strong>AI 模块:' + aiOk + '/' + aiTotal + ' 步通过校验并已并入报告</strong>' +
          '<div class="note" style="margin:6px 0 0">主题归类 / 判断起草 / 用词清洗三步的输出都过了校验(数字回查 · 覆盖率 · 违禁词 · 数字守恒)。</div></div>'
        : '<div class="card bad" style="margin-bottom:12px"><strong>AI 模块:只有 ' + aiOk + '/' + aiTotal + ' 步通过校验</strong>' +
          '<div class="note" style="margin:6px 0 0">未通过的已被拦截(这是设计行为, 不是崩溃)。报告仍然产出, 但用的是规则引擎的结论 —— ' +
          '请检查下面的失败原因(最常见是 Key 无效/余额不足/模型名写错)。</div></div>';
    }

    var rangeBasis = s.rangeInfo ? s.rangeInfo.basis : '';
    var cands = (s.rangeInfo && s.rangeInfo.candidates) || [];

    box.innerHTML =
      '<div class="panel">' +
      '<h3>复盘完成 · ' + FC.esc(s.name) + '(' + s.code + ')</h3>' +
      aiBanner +
      '<div class="grid3" style="margin-bottom:12px">' +
      '<div class="metric"><div class="metric-l">区间 / 期数</div><div class="metric-v" style="font-size:16px">' + FC.esc(s.range) + ' · ' + s.quarters + ' 期</div></div>' +
      '<div class="metric"><div class="metric-l">形态标签</div><div class="metric-v" style="font-size:16px">' + FC.esc(s.formTag) + '</div></div>' +
      '<div class="metric"><div class="metric-l">质检</div><div class="metric-v" style="font-size:16px">' + FC.esc(s.check.verdictText) + '</div></div>' +
      '</div>' +
      (s.perf ? '<p class="note">绩效(' + FC.esc(s.perfMethod || '分红再投总回报指数') + '): 区间 <strong>' + s.perf.cumReturn + '%</strong> · 剔除最好一季 <strong>' + s.perf.exBestQuarter + '%</strong> · 最大回撤 <strong>' + s.perf.maxDrawdown + '%</strong></p>' : '') +
      '<p class="note"><strong>复盘区间怎么定的:</strong> ' + FC.esc(rangeBasis) + '</p>' +
      (cands.length ? '<details><summary style="cursor:pointer;font-size:13px">全部候选区间(可在服务端用 fromPeriod/toPeriod 指定后重跑)</summary><table class="tbl tbl-compact"><thead><tr><th>候选</th><th>区间</th><th>期数</th><th>说明</th></tr></thead><tbody>' +
        cands.map(function (c) {
          return '<tr><td>' + FC.esc(c.label) + '</td><td>' + c.from + '–' + c.to + '</td><td>' + c.n + '</td><td>' + (c.recommended ? '<span class="pos">本次采用</span>' : '') + (c.coManaged ? ' 共管期' : '') + '</td></tr>';
        }).join('') + '</tbody></table></details>' : '') +
      '</div>' +

      '<div class="panel"><h3>官方报告逐行对账(SOP 质检要求)</h3>' +
      '<p class="panel-sub">官方报告与第三方平台至少一期重合, 逐行对账(排名 / 名称 / 权重 ±0.01); 对不上的以官方报告为准, 并把差异记下来。</p>' +
      '<ul class="reason-list">' + officialHtml + '</ul>' +
      (official && official.notes ? official.notes.map(function (n) { return '<p class="note">' + FC.esc(n) + '</p>'; }).join('') : '') +
      '</div>' +

      '<div class="panel"><h3>深度演示稿(AI 按内容编排 · html-ppt 技能)</h3>' +
      (function () {
        var d = s.deckT6;
        if (!d) {
          return '<p class="panel-sub">本次未生成。深度演示稿需要一个 API Key —— 大模型要读完报告、决定讲几页、每页主张什么, 再逐页排版。</p>' +
            '<p class="note">下面那份「演示稿 (.html)」是<strong>规则引擎的模板版</strong>: 版式固定、只替换数字。它能用, 但一眼就是报表, 不适合拿去讲。</p>';
        }
        if (!d.ok) {
          return '<p class="panel-sub" style="color:var(--bad)">生成失败: ' + FC.esc(d.error || '未知原因') + '</p>' +
            '<p class="note">旧的模板版演示稿仍然可用, 不受影响。</p>';
        }
        var c = d.check || {};
        var rows = (d.slides || []).map(function (x, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + FC.esc(x.kicker || '') + '</td><td>' + FC.esc(x.title || '') +
            '</td><td><code>' + FC.esc(x.layout || '') + '</code></td><td>' + FC.esc(x.section || '(未匹配)') + '</td></tr>';
        }).join('');
        return '<p class="panel-sub">这份是<strong>大模型读完报告后逐页编排</strong>的: 先分镜(讲几页、每页主张什么、用哪个版面), 再逐页成文, ' +
            '最后把 36 套主题 + base.css + 版面组件 + 运行时<strong>全部内联成一个 HTML 文件</strong>。发给别人双击就能看, 断网也能看。</p>' +
          '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>kicker</th><th>主张式标题</th><th>版面</th><th>取材章节</th></tr></thead><tbody>' +
          rows + '</tbody></table>' +
          '<p class="note" style="margin-top:8px">共 ' + d.pages + ' 页 · 主题 <code>' + FC.esc(d.theme || '') + '</code> · 大模型调用 ' + d.calls + ' 次 · ' +
          '质检 ' + (c.ok ? '通过' : '<span style="color:var(--bad)">有 ' + c.fails + ' 项失败</span>') +
          (c.warns ? '(警告 ' + c.warns + ' 项)' : '') + '</p>' +
          (c.issues && c.issues.length ? '<ul class="reason-list">' + c.issues.slice(0, 8).map(function (x) {
            return '<li><span class="' + (x.level === 'fail' ? 'neg' : 'tag-alt') + '">[' + x.level + ']</span> ' + FC.esc(x.msg) + '</li>';
          }).join('') + '</ul>' : '') +
          '<div class="btn-row" style="margin-top:10px">' + dl('deckT6', '深度演示稿 (.html)') + '</div>';
      })() +
      '</div>' +

      '<div class="panel"><h3>可下载的交付物</h3>' +
      '<p class="panel-sub">演示稿都是<strong>单文件 HTML</strong>(不引用任何外部资源, 发一个文件给别人就能看), PDF 由服务端调无头浏览器导出, 每页正好一张幻灯片。</p>' +
      '<div class="btn-row">' +
      dl('report', '复盘报告 (.md)') +
      (s.deepReportGenerated && s.files.deep ? dl('deep', '深度复盘报告 (.md)') : '') +
      dl('deck', s.deckT6 && s.deckT6.ok ? '演示稿 · 模板版 (.html)' : '演示稿 (.html)') +
      (s.pdf ? dl('pdf', '演示稿 (.pdf)') : '') +
      dl('card', '结论卡 (.json)') +
      dl('check', '错误检查记录 (.md)') +
      dl('sources', '来源清单 (.md)') +
      dl('dataset', '数据底稿 (.json)') +
      '</div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<a class="btn btn-sm" href="/report/' + s.code + '" target="_blank" rel="noopener">在线看报告(新标签页)</a>' +
      '<a class="btn btn-sm" href="/deck/' + s.code + '" target="_blank" rel="noopener">在线看演示稿(新标签页)</a>' +
      (s.deckT6 && s.deckT6.ok ? '<a class="btn btn-sm" href="/deck/' + s.code + '?v=old" target="_blank" rel="noopener">对照: 旧模板版</a>' : '') +
      '</div>' +
      '<p class="note" style="margin-top:8px">下载走的是浏览器下载(不会跳走页面); 在线预览一律开新标签页 —— 这样你按回退或刷新, 结果都还在(也存进了"最近复盘记录")。</p>' +
      '<p class="note" style="margin-top:10px">生成链路: 采集 → 官方对账 → 官方窗口校准 → 清洗 → 计算 → 质检 → 规则报告 → 深度报告(T5) → 深度演示稿(T6) → PDF。总耗时 ' + (s.totalMs / 1000).toFixed(1) + ' 秒。</p>' +
      '</div>' +

      '<div class="panel"><h3>本次执行步骤(运行记录)</h3>' +
      '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>步骤</th><th>说明</th></tr></thead><tbody>' +
      s.steps.map(function (st, i) { return '<tr><td>' + (i + 1) + '</td><td>' + FC.esc(st.name) + '</td><td>' + FC.esc(st.detail || '') + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (s.aiLog && s.aiLog.length ? '<h4>AI 模块调用</h4><table class="tbl tbl-compact"><thead><tr><th>任务</th><th>结果</th><th>耗时</th><th>校验</th></tr></thead><tbody>' +
        s.aiLog.map(function (x) {
          return '<tr><td>' + FC.esc(x.task) + '</td><td>' + (x.ok ? '<span class="pos">通过并应用</span>' : '<span class="neg">未通过, 已拦截</span>') + (x.error ? ': ' + FC.esc(x.error) : '') + '</td><td>' + (x.latencyMs || 0) + ' ms</td><td>' + (x.issues || []).filter(function (i) { return i.level !== 'info'; }).map(function (i) { return FC.esc(i.msg); }).join('<br>') + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +
      '</div>';
  }

  /* ------------------------------------------------------------ 绑定 */
  FC.initOnline = function () {
    FC.detectOnline();
    var probe = $('#btn-online-probe');
    if (probe) probe.addEventListener('click', FC.probe);
    var again = $('#btn-probe-again');
    if (again) again.addEventListener('click', FC.probe);
    var btn = $('#btn-online-run');
    if (btn) btn.addEventListener('click', FC.runOnline);
    var ping = $('#btn-ai-ping');
    if (ping) ping.addEventListener('click', FC.pingAi);
    ['#online-code', '#ai-key', '#ai-base', '#ai-model', '#online-years'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener('input', syncRunButton);
      if (el) el.addEventListener('change', syncRunButton);
    });
    var t = $('#gate1-table');
    if (t) {
      t.addEventListener('input', syncGate1Table);
      t.addEventListener('change', syncGate1Table);
    }

    /* 下载 / 载入历史 都走事件委托(结果面板是动态生成的) */
    document.addEventListener('click', function (e) {
      var d = e.target.closest('.btn-dl');
      if (d) {
        var code = online.summary && online.summary.code;
        if (!code) { FC.toast('还没有可下载的结果', 'err'); return; }
        downloadFile(code, d.getAttribute('data-key'), d.getAttribute('data-label'));
        return;
      }
      var l = e.target.closest('.btn-load-run');
      if (l) { FC.loadRun(l.getAttribute('data-code')); return; }
    });

    var codeInput = $('#online-code');
    if (codeInput) codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') FC.probe(); });
    var keyInput = $('#ai-key');
    if (keyInput) keyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') FC.pingAi(); });
    syncRunButton();
  };

})(window.FC);
