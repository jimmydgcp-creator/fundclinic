/* 基金复诊台 · 界面与控制器
 * 三道人机门禁在代码里的落点(2026-10-10 界面收敛后):
 *   门禁 1 · 口径确认   -> 只有这一格留给人: 在线模式下是探路后那张八格表(机器猜不出历任经理/共管期);
 *                          内置样例的口径是定死的, 直接摆出来给人看, 不再要求"勾满三项"。
 *   门禁 2 · 判断方向   -> 引擎给候选与置信度, 报告按此方向成文; 人工改判记进结论卡 humanOverride。
 *   门禁 3 · 终审三查   -> 由 18 条质检规则 + 12 处抽检清单实际结算, 结果直接显示在质检页。
 * 为什么把勾选框都拿掉了: 勾选框不改数据、不改报告, 只把按钮从灰变亮 ——
 * 它证明的是"有人点过鼠标", 不是"有人核过数"。访客也不是这次复盘的负责人(见 renderAudit 注释)。
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var esc = FC.esc;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var state = {
    dataset: null, analysis: null, check: null, source: 'builtin', server: null,
    parseIssues: [], gates: { g1: false },
    llmCfg: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' },
    themeMap: null
  };
  FC.state = state;

  /* ------------------------------------------------------------ 提示条 */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, kind === 'err' ? 9000 : 4200);
  }
  FC.toast = toast;

  function setStatus(s) { $('#topstatus').textContent = s; }

  /* ------------------------------------------------------------ 下载 */
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
      toast('已导出 ' + filename, 'ok');
    } catch (e) {
      toast('导出失败: ' + e.message + '(可改用复制按钮)', 'err');
    }
  }
  function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast((label || '内容') + '已复制到剪贴板', 'ok'); },
        function () { toast('复制失败, 请手动全选复制', 'err'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast((label || '内容') + '已复制', 'ok'); } catch (e) { toast('复制失败', 'err'); }
      document.body.removeChild(ta);
    }
  }

  /** 质检规则的 detail 里带了少量 <strong>(checker.js 用它强调"被动超标"这类词)。
   *  直接 esc 会把标签当字面量显示出来(页面上真的出现过 "<strong>被动超标</strong>");
   *  完全不管又等于把规则文本当 HTML 执行。折中: 先全转义, 再只放回 strong 这一对标签。 */
  function richText(s) {
    return esc(s).replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
  }

  /* ============================================================ 视图切换 */
  var VIEWS = ['input', 'report', 'ledger', 'audit', 'about'];
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'input';
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    if (location.hash.slice(1) !== view) { try { history.replaceState(null, '', '#' + view); } catch (e) { location.hash = view; } }
    window.scrollTo(0, 0);
  }
  FC.show = show;

  function viewFromHash() {
    var h = location.hash.replace(/^#/, '').split('?')[0];
    return VIEWS.indexOf(h) >= 0 ? h : 'input';
  }

  /* ============================================================ 输入页 */
  function renderInput() {
    var funds = FC.builtinFunds();
    var cards = funds.map(function (f) {
      return '<div class="metric" style="margin-bottom:10px">' +
        '<div class="metric-l">' + esc(f.code) + ' · ' + esc(f.range) + ' · ' + f.quarters + ' 期</div>' +
        '<div class="metric-v" style="font-size:15px">' + esc(f.name) + '</div>' +
        '<div class="note" style="margin:6px 0 10px">' + (f.hasPerf ? '含净值/收益口径 → 可做绩效层判断' : '仅持仓结构 → 引擎会自动降级, 不判定绩效形态') + '</div>' +
        '<button class="btn btn-sm btn-run" data-code="' + esc(f.code) + '">载入并复盘</button>' +
        '</div>';
    }).join('');
    $('#builtin-list').innerHTML = cards;
  }

  /** 画完一个视图后, 把它上面那块"还没跑过"的空状态收掉。
   *  为什么需要: 空状态写在 index.html 里(这样断网/没数据时页面不是一片白),
   *  但只要 JS 画出了真内容就得让位, 否则会叠在上面。 */
  function markDrawn(view) {
    var el = $('#view-' + view + ' #' + view + '-empty');
    if (el) el.classList.add('hidden');
    if (view === 'report') { var l = $('#report-layout'); if (l) l.classList.remove('hidden'); }
  }

  /* ============================================================ 运行 */
  function run(dataset, source, parseIssues) {
    dataset._parseIssues = parseIssues || [];
    state.dataset = dataset;
    state.source = source;
    state.parseIssues = parseIssues || [];
    state.server = null;
    /* 内置样例的口径在页面上直接摆着(数据来源/持仓范围/收益口径/输出性质), 不需要人勾选 ——
       "已确认"在这里记录的是口径已按页面所示固定下来, 不再是"某人点过三个复选框"。 */
    state.gates.g1 = true;
    state.themeMap = null;

    var a = FC.analyze(dataset, { source: source });
    if (a.error) { toast(a.error, 'err'); return; }
    state.analysis = a;

    FC.ai.clearLog();
    FC.ai.log({
      channel: '规则引擎(离线)', task: '全流程确定性计算', input: a.quarterCount + ' 期 × 前十大',
      /* 节数不写死: 第九章「可复制的方法 × 不能被神化的部分」由大模型综述生成, 没通过校验时整节不出现,
         所以实际是 10 节或 11 节(2026-10-10: 报告编号已改成按顺序连续生成, 这里也跟着用真实节数)。 */
      output: '指标 ' + Object.keys(a.metrics).length + ' 组 / 报告 ' + ((a.report && a.report.sections) ? a.report.sections.length : 10) + ' 节 / 结论卡 1 张',
      latencyMs: 0, valid: true, manual: '门禁 1 已确认'
    });

    state.check = FC.runCheck(dataset, a);

    renderReport();
    renderLedger();
    renderAudit();
    updateStatus();
    show('report');
  }

  function updateStatus() {
    if (!state.analysis) { setStatus('就绪'); return; }
    var a = state.analysis;
    var bits = [a.fund.code + ' ' + a.range, a.quarterCount + ' 期', '形态: ' + a.form.tag];
    /* 状态条以前显示"门禁 1✓ / 2✗ / 3✗" —— 那是让我们自己看的进度, 访客看到的是三个✗ 却不知道该点哪。
       换成核查结果本身: 质检通过几项、AI 几步过校验。 */
    if (state.check) {
      var c = state.check.summary;
      bits.push('核查: 通过 ' + c.pass + ' / 提示 ' + c.warn + ' / 阻断 ' + c.fail + ' → ' + c.verdictText);
    }
    setStatus(bits.join(' · '));
  }

  /** 四个视图一起重画(在线模式跑完新基金后调用) */
  FC.renderAll = function () { renderReport(); renderLedger(); renderAudit(); updateStatus(); };

  /** 接收"服务端跑完"的结果: 引擎在服务端算好, 前端只负责画。
   *  第 4 个参数是服务端的 summary(执行步骤 / 每一步 AI 调用与校验结果 / 官方对账明细)——
   *  质检页要用它来显示"服务端到底核查了什么", 而不是只显示一句结论。 */
  FC.applyServerResult = function (analysis, check, datasetMeta, serverSummary) {
    if (!analysis || analysis.error) { toast('结果无效: ' + ((analysis && analysis.error) || '空'), 'err'); return; }
    state.analysis = analysis;
    state.check = check;
    state.dataset = datasetMeta || null;
    state.server = serverSummary || null;
    state.source = 'crawled';
    state.gates.g1 = true;
    FC.ai.clearLog();
    FC.ai.log({
      channel: '规则引擎(服务端)', task: '自动采集 + 全流程计算',
      input: (datasetMeta && datasetMeta.crawlStandard) ? '六类来源' : '爬取数据',
      output: analysis.quarterCount + ' 期 / 形态 ' + analysis.form.tag + ' / 质检 ' + (check ? check.summary.verdictText : '—'),
      latencyMs: 0, valid: true, manual: '口径由探路阶段的八格表确定'
    });
    FC.renderAll();
  };

  FC.setStatus = setStatus;

  /* ============================================================ 报告页 */
  function renderReport() {
    var a = state.analysis;
    if (!a) return;
    var secs = a.report.sections;

    $('#report-toc').innerHTML = '<h4>目录</h4>' + secs.map(function (s) {
      return '<a href="#sec-' + s.id + '">' + esc(s.title) + '</a>';
    }).join('');

    /* 门禁 2 原来是"请确认或改判"的单选 + 两个输入框 + 确认按钮 —— 已收掉(见 renderAudit 顶部注释)。
       留下的是判断结果本身: 引擎给了什么标签、置信度多少、证据级别、次优解释是什么,
       以及"报告按哪个方向写"。谁改过判留在结论卡的 humanOverride / humanReason 里, 事后可查。 */
    var gate = '<div class="gate done" id="gate2">' +
      '<h4>门禁 2 · 核心判断方向(引擎给候选, 报告按此方向成文)</h4>' +
      '<p class="note" style="margin-top:0">形态标签「<strong>' + esc(a.form.tag) + '</strong>」· 置信度 ' + esc(a.form.confidence) +
      ' · 证据级别 ' + esc((a.card && a.card.evidenceLevel) || '—') +
      (a.form.alternatives && a.form.alternatives.length ? ' · 次优解释: ' + esc(a.form.alternatives.join(' / ')) : '') +
      '。人工改判会连同理由写进结论卡的 <code>humanOverride</code> / <code>humanReason</code> 字段 —— 不覆盖引擎原判, 两个都留着。</p>' +
      '</div>';

    $('#report-body').innerHTML = gate + secs.map(function (s) {
      return '<section class="rsec" id="sec-' + s.id + '"><h3>' + esc(s.title) + '</h3>' + s.html + '</section>';
    }).join('');
    markDrawn('report');
  }

  function renderLedger() {
    var a = state.analysis;
    if (!a) return;
    var qs = a.quarters;

    var summary = '<table class="tbl tbl-compact"><thead><tr><th>报告期</th><th>前十合计</th><th>前五合计</th><th>留存</th><th>新进</th><th>退出</th><th>主题</th><th>净资产(亿)</th><th>股票仓位</th><th>前十明细</th></tr></thead><tbody>' +
      qs.map(function (q, i) {
        var c = a.metrics.churn[i - 1];
        return '<tr><td><strong>' + q.period + '</strong></td><td>' + FC.util.fx(q.top10Sum) + '%</td><td>' + FC.util.fx(q.top5Sum) + '%</td>' +
          '<td>' + (c ? c.retained + '/10' : '—') + '</td>' +
          '<td class="cell-in">' + (c ? (esc(c.added.join('、')) || '—') : '—') + '</td>' +
          '<td class="cell-out">' + (c ? (esc(c.dropped.join('、')) || '—') : '—') + '</td>' +
          '<td>' + esc(q.theme || '—') + '</td><td>' + FC.util.fx(q.aum) + '</td><td>' + (q.stockPos ? FC.util.fx(q.stockPos) + '%' : '—') + '</td>' +
          '<td>' + (q.top10 || []).map(function (h) { return esc(h.name) + '<sub style="color:#7d8da3">' + FC.util.fx(h.weight, 1) + '</sub>'; }).join(' · ') + '</td></tr>';
      }).join('') + '</tbody></table>';

    var holders = '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>股票</th><th>代码</th><th>在前十大期数</th><th>最长连续</th><th>最高权重</th><th>首次进入</th><th>最后在榜</th></tr></thead><tbody>' +
      a.metrics.holders.slice(0, 40).map(function (h, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(h.name) + '</td><td class="mono">' + esc(h.code) + '</td><td>' + h.count + '/' + a.quarterCount + '</td><td>' + h.maxStreak + '</td><td>' + FC.util.fx(h.maxWeight) + '%</td><td>' + h.periods[0] + '</td><td>' + h.periods[h.periods.length - 1] + '</td></tr>';
      }).join('') + '</tbody></table>';

    var caseTbl = '<table class="tbl tbl-compact"><thead><tr><th>股票</th><th>进入前十</th><th>推算价</th><th>最后在榜</th><th>推算价</th><th>持有期推算价变动</th><th>期数</th><th>仍在前十</th></tr></thead><tbody>' +
      a.cases.wins.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td>' + c.entryPeriod + '</td><td>' + FC.util.fx(c.entryPrice) + '</td><td>' + c.exitPeriod + '</td><td>' + FC.util.fx(c.exitPrice) + '</td><td class="' + (c.change >= 0 ? 'pos' : 'neg') + '">' + (c.change > 0 ? '+' : '') + FC.util.fx(c.change) + '%</td><td>' + c.heldQuarters + '</td><td>' + (c.stillHeld ? '是' : '否') + '</td></tr>';
      }).join('') + '</tbody></table>';

    $('#ledger-body').innerHTML =
      '<div class="panel"><h3>季度汇总</h3><p class="panel-sub">来源: 公开季报 + 天天基金 F10。留存/新进/退出由引擎按相邻期前十名单独立复算。</p>' + summary + '</div>' +
      '<div class="panel"><h3>个体持仓画像(按在榜期数排序, 前 40)</h3><p class="panel-sub">共 ' + a.metrics.totalDistinct + ' 只个股进入过前十大。</p>' + holders + '</div>' +
      '<div class="panel"><h3>案例审计底表(全部标的)</h3><p class="panel-sub">推算价 = 期末公允价值 ÷ 期末持股数, 未复权、不含分红。</p>' + caseTbl + '</div>';
    markDrawn('ledger');
  }

  /* ============================================================ 质检页
   * 这一页只回答一个问题: **已经核查了什么、查出什么**。
   *
   * 2026-10-10 界面收敛 —— 原来这里有四处"请人动手"的交互:
   *   ① 12 处抽检每条挂一个"核完"勾选框;
   *   ② 门禁 3 三查三个勾选框, 不勾满就不让导出;
   *   ③ 一整套"生成提示词 / 复制 / 直连 / 粘贴大模型返回的 JSON / 校验并应用"的工具箱;
   *   ④ 还有一块"API Key"输入区。
   * 问题不在"麻烦", 在于打勾**不产生任何证据**: 它不改数据、不改报告, 只把按钮从灰变亮 ——
   * 证明的是"有人点过鼠标", 不是"有人核过数"。访客也不是这次复盘的负责人, 让他替项目背书没有意义。
   * 所以改成: 每条核查直接把"查了什么、查出什么、证据在哪"摆出来, 导出按钮不再需要先打勾。
   *
   * 唯一按需保留交互的是**没有服务端**的那条路(直接双击 HTML / 单文件版): 那条路上 AI 跑不了,
   * "复制提示词 → 去大模型网页版跑 → 粘回来"是唯一办法, 砍掉等于砍功能, 所以它只在那种场合出现。
   */
  function renderAudit() {
    var a = state.analysis, ck = state.check;
    if (!a || !ck) return;

    var interactive = !(FC.online && FC.online.available);

    var pills = '<div class="summary-bar">' +
      '<div class="summary-pill pill-verdict"><b>' + esc(ck.summary.verdictText) + '</b><span>总体结论</span></div>' +
      '<div class="summary-pill pill-pass"><b>' + ck.summary.pass + '</b><span>通过</span></div>' +
      '<div class="summary-pill pill-warn"><b>' + ck.summary.warn + '</b><span>提示(需要在报告里说明)</span></div>' +
      '<div class="summary-pill pill-fail"><b>' + ck.summary.fail + '</b><span>阻断(必须处理)</span></div>' +
      '</div>';

    var rules = ck.rules.map(function (r) {
      return '<div class="rule rule-' + r.level + '">' +
        '<div class="rule-head"><span class="rule-id">' + r.id + '</span><span class="rule-name">' + esc(r.name) + '</span>' +
        '<span class="badge badge-' + r.level + '">' + (r.level === 'pass' ? '通过' : r.level === 'warn' ? '提示' : '阻断') + '</span>' +
        '<span class="rule-layer">' + r.layer + '</span></div>' +
        '<p class="rule-detail">' + richText(r.detail) + '</p>' +
        (r.evidence && r.evidence.length ? '<ul class="rule-ev">' + r.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }).join('');

    /* ---- 二、回原文抽检清单: 只写"核什么、怎么核、原文在哪", 不再让人打勾 ---- */
    var sample = '<p class="panel-sub" style="margin-top:-6px">引擎按固定种子从全部前十大记录里抽出 ' + ck.manualSample.length +
      ' 处, 每条写清<strong>去哪一节、核哪一列、合格判据</strong>, 并直接给出官方季报链接。同一份输入重复运行得到同一份清单 —— ' +
      '这份清单随报告一起交付, 换谁来核都照着做, 不需要在页面上打勾。</p>' +
      '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>报告期</th><th>标的</th><th>引擎值</th><th>怎么核(照这个步骤做)</th><th>官方原文</th></tr></thead><tbody>' +
      ck.manualSample.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + s.period + '</td><td>' + esc(s.item) + '</td><td><strong>' + esc(s.value) + '</strong></td>' +
          '<td style="font-size:12.5px">' + esc(s.howTo || '') + '</td>' +
          '<td>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">打开季报</a>' : '<span class="hint">需自行检索</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="note"><strong>判据</strong>: 逐条打开官方 PDF 核对, 全部一致才算"数字查"过; 有任何一条对不上, 先查清是抓取错、口径错还是官方口径特殊, 不带病发布。</p>';

    /* ---- 三、AI 每一步做了什么 + 拿什么去校验 ---- */
    var defaultLLM = (FC.online && FC.online.health && FC.online.health.llm) || { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };
    var aiTasks = Object.keys(FC.ai.tasks).map(function (k) {
      var t = FC.ai.tasks[k];
      var card = '<div class="ai-task"><h4>' + esc(t.name) + '</h4>' +
        '<div class="ai-io">' +
        '<div class="io-box"><b>输入</b><p>' + esc(t.input) + '</p></div>' +
        '<div class="io-box"><b>输出(严格 JSON)</b><p>' + esc(t.output) + '</p></div>' +
        '</div>' +
        '<div class="io-box trap"><b>错在哪会被抓到</b><p>' + esc(t.howToDetectError) + '</p></div>';
      if (interactive) {
        card += '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn btn-sm btn-prompt" data-task="' + k + '">生成提示词</button>' +
          '<button class="btn btn-sm btn-copy-prompt" data-task="' + k + '">复制提示词</button>' +
          '<button class="btn btn-sm btn-direct" data-task="' + k + '">直连大模型执行</button>' +
          '<button class="btn btn-sm btn-manual" data-task="' + k + '">手动中转(粘贴回填)</button>' +
          '</div>' +
          '<div class="prompt-box" id="prompt-' + k + '" style="display:none;margin-top:10px"></div>' +
          '<div id="manual-' + k + '" style="display:none;margin-top:10px">' +
          '<label class="field"><span>把大模型返回的 JSON 粘贴到这里, 点"校验并应用" —— 校验不通过一律不写进报告</span>' +
          '<textarea id="manualtext-' + k + '" placeholder=\'{"mapping":{"潞安环能":"煤炭"}}\'></textarea></label>' +
          '<div class="btn-row"><button class="btn btn-sm btn-primary btn-apply" data-task="' + k + '">校验并应用</button></div>' +
          '<div id="validate-' + k + '" class="note"></div></div>';
      }
      return card + '</div>';
    }).join('');

    /* 运行记录两套来源: 在线模式用服务端真跑的那一份(每一步的校验结果), 离线用本地日志。 */
    var serverAi = (state.server && state.server.aiLog) || [];
    var logRows, logHead;
    if (serverAi.length) {
      logHead = '<tr><th>耗时</th><th>任务</th><th>校验结果</th><th>错误</th><th>命中的检查项</th></tr>';
      logRows = serverAi.map(function (x) {
        var issues = (x.issues || []).filter(function (i) { return i.level !== 'info'; })
          .map(function (i) { return esc(i.msg); }).join('<br>');
        return '<tr><td class="mono">' + (x.latencyMs || 0) + ' ms</td><td>' + esc(x.task) + '</td>' +
          '<td>' + (x.ok ? '<span class="pos">通过并并入报告</span>' : '<span class="neg">未通过, 已拦截</span>') + '</td>' +
          '<td>' + (x.error ? esc(x.error) : '—') + '</td><td style="font-size:12.5px">' + (issues || '—') + '</td></tr>';
      }).join('');
    } else {
      logHead = '<tr><th>时间</th><th>通道</th><th>任务</th><th>输入摘要</th><th>输出摘要</th><th>耗时</th><th>校验</th><th>人工复核</th></tr>';
      logRows = FC.ai.runLog.length ? FC.ai.runLog.map(function (e) {
        return '<tr><td class="mono">' + e.at.slice(11, 19) + '</td><td>' + esc(e.channel || '—') + '</td><td>' + esc(e.task || '—') + '</td>' +
          '<td>' + esc(String(e.input || '').slice(0, 42)) + '</td><td>' + esc(String(e.output || '').slice(0, 60)) + '</td>' +
          '<td>' + (e.latencyMs !== undefined ? e.latencyMs + ' ms' : '—') + '</td>' +
          '<td>' + (e.valid === undefined ? '—' : (e.valid ? '<span class="pos">通过</span>' : '<span class="neg">未通过</span>')) + '</td>' +
          '<td>' + esc(e.manual || '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="8">本次未调用大模型(全部由离线规则引擎完成)。</td></tr>';
    }

    /* ---- 四、本次核查结果: 由真实规则结算出来的行, 不是勾选框 ---- */
    function layerRules(layer) { return ck.rules.filter(function (r) { return r.layer === layer; }); }
    function names(rs) { return rs.map(function (r) { return esc(r.name); }).join(' · '); }
    function levelOf(rs) {
      var f = rs.filter(function (r) { return r.level === 'fail'; }).length;
      var w = rs.filter(function (r) { return r.level === 'warn'; }).length;
      var p = rs.filter(function (r) { return r.level === 'pass'; }).length;
      return { p: p, w: w, f: f, n: rs.length };
    }
    function verdictCell(g) {
      if (!g.n) return '<span class="hint">本次未涉及</span>';
      if (g.f) return '<span class="neg">' + g.f + ' 项阻断</span> / 通过 ' + g.p + ' · 提示 ' + g.w;
      if (g.w) return '<span style="color:var(--warn);font-weight:700">通过 ' + g.p + ' · 提示 ' + g.w + '</span>';
      return '<span class="pos">' + g.p + '/' + g.n + ' 全部通过</span>';
    }

    /* 官方对账的字段名是 official.checks(不是 quarters)——
       第一版照着自己想象的形状写, 结果这一行永远显示"—": 实际 4/4 期逐行一致, 页面上却看不出来。
       现在按服务端真实 schema 取, 并把"服务端没装 pdftotext"单独标出来, 不混成一句"未完成"。 */
    var off = state.server && state.server.official;
    var offCell = '—';
    if (off && off.checks && off.checks.length) {
      var bad = off.checks.filter(function (c) { return !c.ok; });
      var maxDiff = null, offRows = 0;
      off.checks.forEach(function (c) {
        if (typeof c.maxDiff === 'number' && (maxDiff === null || c.maxDiff > maxDiff)) maxDiff = c.maxDiff;
        offRows += (c.parsedRows || 0);
      });
      offCell = (bad.length
        ? '<span class="neg">' + bad.length + '/' + off.checks.length + ' 期不一致</span>'
        : '<span class="pos">' + off.checks.length + '/' + off.checks.length + ' 期逐行一致</span>') +
        ' · 共解析官方 ' + offRows + ' 行' +
        (maxDiff !== null ? ' · 权重最大差 ' + maxDiff.toFixed(3) + 'pp' : '') +
        (off.notes && off.notes.length ? '<div class="note" style="margin:4px 0 0">' + esc(off.notes[0]) + '</div>' : '');
    } else if (off && off.pdftotext === false) {
      offCell = '<span class="neg">未完成 —— 服务端没装 pdftotext</span>(如实标记, 不假装对过账)';
    } else if (off && off.available === false) {
      offCell = '<span class="hint">本次未对到官方报告</span>';
    }

    var verify = [
      ['口径 · 复盘谁 / 哪一段 / 什么口径', '探路阶段抓基金概况与报告期网格, 自动填成 SOP §0 八格(经理 / 区间 / 截止日 / 基准 / 收益口径 / 范围), 留一格空就不放行',
        '<strong>' + esc(a.env.managerLabel || a.fund.manager || '—') + '</strong> · ' + esc(a.range) + ' · ' + a.quarterCount + ' 期' +
        (a.env.managerCoManaged ? ' <span class="flag-inline">含共管期</span>' : '') +
        '<div class="note" style="margin:4px 0 0">' + esc(a.env.returnBasis) + (a.perf ? '' : ' · 本次无净值序列 → 不做绩效结论') + '</div>'],
      ['数据本身对不对(输入层)', names(layerRules('输入层')), verdictCell(levelOf(layerRules('输入层')))],
      ['算得对不对(计算层)', names(layerRules('计算层')), verdictCell(levelOf(layerRules('计算层')))],
      ['写出来对不对(输出层)', names(layerRules('输出层')), verdictCell(levelOf(layerRules('输出层')))],
      ['回官方原文抽检', '从全部前十大记录里按固定种子抽 ' + ck.manualSample.length + ' 处, 每条给出报告期 / 标的 / 引擎值 / 去哪一节核 / 官方季报链接',
        '<strong>' + ck.manualSample.length + ' 处</strong> · 同输入同清单(可复现)'],
      ['官方季报逐行对账', '官方定期报告 PDF 与第三方平台逐行比对排名 / 名称 / 权重(容差 0.01pp), 对不上的以官方为准并记差异', offCell]
    ];
    if (!state.server) verify.pop();   // 离线样例没有服务端对账数据, 宁可少一行也不编一行

    var verifyTbl = '<table class="tbl tbl-compact"><thead><tr><th style="width:22%">核查项</th><th style="width:44%">查了什么 / 怎么查</th><th>结果</th></tr></thead><tbody>' +
      verify.map(function (r) {
        return '<tr><th>' + r[0] + '</th><td style="font-size:12.5px">' + r[1] + '</td><td>' + r[2] + '</td></tr>';
      }).join('') + '</tbody></table>';

    $('#audit-body').innerHTML =
      '<div class="panel"><h3>一、本次核查结果(直接给结论, 不需要你打勾)</h3>' +
      '<p class="panel-sub">三道门禁里机器能查的部分, 全部由脚本结算成下面这些行; 数字来自 <code>' + esc(String(ck.checkedAt).slice(0, 19).replace('T', ' ')) + '</code> 那一次运行。</p>' +
      verifyTbl +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn btn-sm" id="btn-export-report">导出复盘报告(MD)</button>' +
      '<button class="btn btn-sm" id="btn-export-card">导出结论卡(JSON)</button>' +
      '<button class="btn btn-sm" id="btn-export-dataset">导出底稿(JSON)</button>' +
      '<button class="btn btn-sm" id="btn-deliver">导出交付说明(MD)</button>' +
      '</div></div>' +

      '<div class="panel"><h3>二、自动质检明细(错了怎么发现 · ' + ck.summary.total + ' 条规则)</h3>' +
      '<p class="panel-sub">三层检查: 输入层(数据本身对不对) → 计算层(算得对不对) → 输出层(写出来对不对)。每条都给出具体证据, 不是一句"已检查"。</p>' +
      pills + rules +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn btn-sm" id="btn-export-check">导出《错误检查记录》MD</button>' +
      '<button class="btn btn-sm" id="btn-copy-check">复制检查记录</button>' +
      '</div></div>' +

      '<div class="panel"><h3>三、回原文抽检清单(' + ck.manualSample.length + ' 处, 固定种子可复现)</h3>' +
      sample + '</div>' +

      '<div class="panel"><h3>四、AI 每一步做了什么, 拿什么校验</h3>' +
      '<p class="panel-sub">分工原则: 抓取/解析/量化/对账/质检交给脚本(确定性); 只有"语言类"任务交给大模型, 且输出必须过校验。' +
      '<br>不通过就<b>拦截</b>, 但拦截不等于崩 —— 规则引擎的结论照用、报告照出, 只在下面记下"哪一步被拦了、为什么"。</p>' +
      (interactive
        ? '<p class="note">当前没有服务端(直接打开的 HTML 文件), AI 这一步在这里跑不起来, 所以保留人工中转: 复制提示词 → 去大模型网页版跑 → 把 JSON 粘回来。校验逻辑与直连完全一样, 不通过照样不写进报告。</p>' +
          '<div class="grid2" style="margin-bottom:14px">' +
          '<label class="field"><span>API Base(OpenAI 兼容)</span><input type="text" id="llm-base" value="' + esc(defaultLLM.baseUrl) + '"></label>' +
          '<label class="field"><span>模型名</span><input type="text" id="llm-model" value="' + esc(defaultLLM.model) + '"></label>' +
          '</div>' +
          '<label class="field"><span>API Key(只存在本页内存, 不写进任何文件)</span><input type="password" id="llm-key" value="' + esc(state.llmCfg.apiKey) + '"></label>'
        : '<p class="note">AI 由服务端调用, 你不需要做任何操作; 下面是每一步的输入 / 输出契约与校验规则, 以及本次真实的调用记录。</p>') +
      aiTasks +
      '<h4 style="margin-top:18px">运行记录</h4>' +
      '<table class="tbl tbl-compact"><thead>' + logHead + '</thead><tbody>' + logRows + '</tbody></table>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn btn-sm" id="btn-export-log">导出《AI 运行记录》MD</button></div>' +
      '</div>';
    markDrawn('audit');
  }

  /* ============================================================ 导出物 */
  function reportToMarkdown() {
    var hasLLM = FC.ai.runLog.some(function (e) { return e.channel && e.channel.indexOf('大模型') >= 0; });
    return FC.reportToMarkdown(state.analysis, {
      generatedBy: '基金复诊台 FundClinic · 规则引擎(离线确定性计算)' + (hasLLM ? ' + 大模型(输出经校验)' : ' · 未调用大模型')
    });
  }

  function cardToJSON() {
    var a = state.analysis;
    return JSON.stringify({
      schema: 'fundclinic/1',
      generatedAt: a.generatedAt,
      generatedBy: '基金复诊台 FundClinic(离线规则引擎)',
      fund: { code: a.fund.code, name: a.fund.name, manager: a.fund.manager || '', range: a.range, quarters: a.quarterCount },
      card: {
        formTag: a.form.tag,
        formConfidence: a.form.confidence,
        engineFormTag: a.form.tag,
        /* 形态标签由引擎给候选、报告按此成文(见 renderReport 门禁 2 块)。
           人工改判不再发生在页面上, 这两格留给人工在导出后自己标注/或在报告里写明 ——
           原来它们的值来自"门禁 2 打勾", 现在默认 false/空, 不做假记录。 */
        humanOverride: false,
        humanReason: '',
        mainQuestion: a.card.mainQuestion,
        claim: a.card.claim,
        falsifier: a.card.falsifier,
        evidenceLevel: a.card.evidenceLevel,
        trackers: a.trackers,
        caveats: a.card.caveats
      },
      structure: {
        top10SumAvg: r2(a.metrics.conc.avg), top10SumRange: [r2(a.metrics.conc.min), r2(a.metrics.conc.max)],
        top10SumSlope: r2(a.metrics.conc.slope), avgRetained: r2(a.metrics.avgRetained),
        avgAdded: r2(a.metrics.avgAdded), avgJaccard: r2(a.metrics.avgJaccard),
        themeSwitches: a.metrics.theme.switches, top1Avg: r2(a.metrics.leader.avg),
        distinctHoldings: a.metrics.totalDistinct, maxStreak: a.metrics.maxStreak
      },
      check: state.check ? state.check.summary : null,
      /* 核查结果不是勾选框, 所以这里记的是"谁查的、查出几条":
         口径来自探路自动填的八格; 其余三项由 18 条规则实际结算。 */
      verification: state.check ? {
        口径: '探路自动填 SOP §0 八格(人可改)',
        规则数: state.check.summary.total,
        通过: state.check.summary.pass, 提示: state.check.summary.warn, 阻断: state.check.summary.fail,
        抽检清单: state.check.manualSample.length + ' 处(固定种子可复现)',
        结算时间: state.check.checkedAt
      } : null
    }, null, 2);
  }
  function r2(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null; }

  /** 导出《AI 运行记录》。
   *  在线模式下 FC.ai.runLog 里只有前端记的那一条(真正的调用发生在服务端),
   *  所以有 state.server.aiLog 时以它为准 —— 否则导出的是"一份只有一行的运行记录",
   *  而页面上明明摆着服务端每一步的校验结果。 */
  function aiLogToMarkdown() {
    var s = state.server;
    if (s && s.aiLog && s.aiLog.length) {
      var L = ['# AI 模块运行记录(服务端调用 · 自动生成)', '',
        '- 生成时间: ' + new Date().toISOString(),
        '- 对象: ' + s.name + '(' + s.code + ') · ' + s.range + ' · ' + s.quarters + ' 期', '',
        '| 任务 | 校验结果 | 耗时 | 错误 | 命中的检查项 |', '| --- | --- | --- | --- | --- |'];
      s.aiLog.forEach(function (x) {
        var issues = (x.issues || []).filter(function (i) { return i.level !== 'info'; })
          .map(function (i) { return i.msg; }).join('; ');
        L.push('| ' + x.task + ' | ' + (x.ok ? '通过并并入报告' : '未通过, 已拦截') + ' | ' + (x.latencyMs || 0) + ' ms | ' +
          (x.error ? String(x.error).replace(/\|/g, '/') : '—') + ' | ' + (issues.replace(/\|/g, '/') || '—') + ' |');
      });
      L.push('', '## 说明', '',
        '- 每一步输出都要过校验(数字回查 / 覆盖率 / 违禁词 / 数字守恒)才允许并入报告;',
        '- 未通过的步骤被拦截, 报告照出(用规则引擎的结论), 原因按步记在上表。');
      return L.join('\n');
    }
    return FC.ai.runLogToMarkdown(state.analysis);
  }

  /* ============================================================ 事件绑定 */
  function bind() {
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.view); }); });

    $('#builtin-list').addEventListener('click', function (e) {
      var b = e.target.closest('.btn-run');
      if (!b) return;
      var d = FC.getBuiltin(b.dataset.code);
      if (!d) { toast('未找到内置样例 ' + b.dataset.code, 'err'); return; }
      run(JSON.parse(JSON.stringify(d)), 'builtin', []);
      toast('已载入 ' + d.fund.name + ' 并完成全部计算', 'ok');
    });

    /* 首屏两个按钮: 一个把人带到输入区, 一个带到"这个网页做什么"。
       原来首屏是六个面板平铺, 没有唯一的主行动 —— 用户不知道该点哪里。 */
    var heroStart = $('#btn-hero-start');
    if (heroStart) heroStart.addEventListener('click', function () {
      var target = $('#online-panel').classList.contains('hidden') ? $('#offline-panel') : $('#online-panel');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var codeIn = $('#online-code');
      if (codeIn && !$('#online-panel').classList.contains('hidden')) setTimeout(function () { codeIn.focus(); }, 320);
    });
    var heroHow = $('#btn-hero-how');
    if (heroHow) heroHow.addEventListener('click', function () { show('about'); });

    /* 空状态里的"去输入基金代码"按钮 */
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.goto); });
    });

    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.id === 'btn-export-check') { download('错误检查记录_' + state.analysis.fund.code + '.md', FC.checkToMarkdown(state.check, state.analysis), 'text/markdown'); return; }
      if (t.id === 'btn-copy-check') { copyText(FC.checkToMarkdown(state.check, state.analysis), '错误检查记录'); return; }
      if (t.id === 'btn-export-log') { download('AI运行记录_' + state.analysis.fund.code + '.md', aiLogToMarkdown(), 'text/markdown'); return; }
      if (t.id === 'btn-export-report') { download('持仓回溯复盘_' + state.analysis.fund.code + '.md', reportToMarkdown(), 'text/markdown'); return; }
      if (t.id === 'btn-export-card') { download('结论卡_' + state.analysis.fund.code + '.json', cardToJSON(), 'application/json'); return; }
      if (t.id === 'btn-export-dataset') { download('数据底稿_' + state.analysis.fund.code + '.json', JSON.stringify(state.dataset, null, 1), 'application/json'); return; }

      if (t.id === 'btn-deliver') {
        var ck = state.check;
        download('交付包_' + state.analysis.fund.code + '_说明.md', deliverNote(ck), 'text/markdown');
        return;
      }

      if (t.classList.contains('btn-prompt') || t.classList.contains('btn-copy-prompt')) {
        var k = t.dataset.task;
        state.llmCfg.baseUrl = ($('#llm-base') || {}).value || state.llmCfg.baseUrl;
        state.llmCfg.model = ($('#llm-model') || {}).value || state.llmCfg.model;
        state.llmCfg.apiKey = ($('#llm-key') || {}).value || '';
        var payload = FC.ai.buildPayload(k, state.analysis);
        var prompt = FC.ai.buildPrompt(k, payload);
        var box = $('#prompt-' + k);
        box.style.display = 'block';
        box.textContent = prompt;
        if (t.classList.contains('btn-copy-prompt')) copyText(prompt, '提示词');
        FC.ai.log({ channel: '规则引擎(离线)', task: '生成提示词 · ' + FC.ai.tasks[k].name, input: k, output: prompt.length + ' 字符', latencyMs: 0, valid: true, manual: '☐' });
        renderAudit();
        return;
      }

      if (t.classList.contains('btn-manual')) {
        var k2 = t.dataset.task;
        var m = $('#manual-' + k2);
        m.style.display = m.style.display === 'none' ? 'block' : 'none';
        return;
      }

      if (t.classList.contains('btn-direct')) {
        runDirectLLM(t.dataset.task);
        return;
      }

      if (t.classList.contains('btn-apply')) {
        applyManual(t.dataset.task);
        return;
      }
    });

    /* 勾选框已全部收掉(见 renderAudit 顶部注释), 所以这个 change 监听不需要了。
       原来它做两件事: 记"抽检核完"的勾, 和用门禁 3 三个勾控制导出按钮的 disabled ——
       两件都不产生证据, 只是把按钮点亮, 已删。 */
  }

  function deliverNote(ck) {
    return ['# 交付说明 · 三份记录齐备', '',
      '本包由「基金复诊台 FundClinic」生成, 证明这次复盘是"可核验"的而不是"看起来像"。', '',
      '核查结果不由勾选框产生, 而是由 18 条质检规则 + 官方原文抽检清单实际结算:',
      '', '| 交付物 | 内容 | 本包数值 |', '| --- | --- | --- |',
      '| 复盘报告 | 固定章节骨架 + 逐数字证据分级 | ' + state.analysis.quarterCount + ' 期 / ' + state.analysis.report.sections.length + ' 节 |',
      '| 错误检查记录 | ' + ck.summary.total + ' 条规则(输入/计算/输出三层) + ' + ck.manualSample.length + ' 处回原文抽检清单 | 通过 ' + ck.summary.pass + ' · 提示 ' + ck.summary.warn + ' · 阻断 ' + ck.summary.fail + ' |',
      '| 运行记录 | 规则引擎与大模型的每一次调用(输入/输出/耗时/校验) | ' + (state.server && state.server.aiLog ? state.server.aiLog.length : FC.ai.runLog.length) + ' 条 |',
      '', '## 边界声明', '',
      '- 数据全部来自公开季报与天天基金 F10, 不含任何机构内部数据;',
      '- 只看前十大持仓, 季报为期末快照, 期间买卖不可见;',
      '- 推算价未复权、不含分红, 不代表投资者实际收益;',
      '- 全文为回溯复盘, 不构成投资建议。'].join('\n');
  }

  /* --------------------------------------------------------- LLM 调用 */
  function runDirectLLM(taskId) {
    /* 这三个输入框只在"没有服务端"的分支里存在(见 renderAudit), 所以取值要容错:
       页面结构一变就不该抛 null.value —— 那会把一句提示变成整页报错。 */
    state.llmCfg.baseUrl = ($('#llm-base') || {}).value || state.llmCfg.baseUrl;
    state.llmCfg.model = ($('#llm-model') || {}).value || state.llmCfg.model;
    state.llmCfg.apiKey = (($('#llm-key') || {}).value || '').trim();
    if (!state.llmCfg.apiKey) { toast('直连需要 API Key; 不想配 Key 就用"手动中转"(零依赖, 效果一样)', 'err'); return; }
    var payload = FC.ai.buildPayload(taskId, state.analysis);
    var prompt = FC.ai.buildPrompt(taskId, payload);
    toast('正在调用大模型…');
    setStatus('大模型调用中…');
    FC.ai.callLLM(state.llmCfg, prompt).then(function (res) {
      if (!res.ok) {
        FC.ai.log({ channel: '大模型(直连)', task: FC.ai.tasks[taskId].name, input: prompt.length + ' 字符', output: '调用失败: ' + res.error.slice(0, 90), latencyMs: res.latencyMs, valid: false, manual: '☐' });
        renderAudit(); updateStatus();
        toast(res.error, 'err');
        return;
      }
      var pj = FC.ai.parseJSON(res.content);
      if (!pj.ok) {
        FC.ai.log({ channel: '大模型(直连)', task: FC.ai.tasks[taskId].name, input: prompt.length + ' 字符', output: 'JSON 解析失败: ' + (pj.error || ''), latencyMs: res.latencyMs, valid: false, manual: '☐' });
        renderAudit(); updateStatus();
        toast('大模型返回的不是合法 JSON, 已拦截: ' + (pj.error || ''), 'err');
        return;
      }
      var v = validateAndApply(taskId, pj.value, res);
      updateStatus();
      toast(v ? '大模型输出已通过校验并应用' : '大模型输出未通过校验, 已拦截(详见质检页)', v ? 'ok' : 'err');
    });
  }

  function applyManual(taskId) {
    var txt = $('#manualtext-' + taskId).value;
    if (!txt.trim()) { toast('请先粘贴大模型返回的 JSON', 'err'); return; }
    var pj = FC.ai.parseJSON(txt);
    if (!pj.ok) {
      $('#validate-' + taskId).innerHTML = '<span class="neg">JSON 解析失败: ' + esc(pj.error || '') + '</span>';
      FC.ai.log({ channel: '大模型(手动中转)', task: FC.ai.tasks[taskId].name, input: txt.length + ' 字符', output: 'JSON 解析失败', latencyMs: 0, valid: false, manual: '☐' });
      renderAudit();
      return;
    }
    var ok = validateAndApply(taskId, pj.value, { latencyMs: 0, manual: true });
    toast(ok ? '校验通过, 已应用到报告' : '校验未通过, 已拦截(详见质检页)', ok ? 'ok' : 'err');
  }

  function validateAndApply(taskId, value, meta) {
    var payload = FC.ai.buildPayload(taskId, state.analysis);
    var ctx = { stockList: payload.stockList, formLibrary: payload.formLibrary, original: payload.text };
    if (taskId === 'judgement') {
      ctx.allowedNumbers = (function () {
        var s = {}, m = state.analysis.metrics;
        [m.conc.avg, m.conc.min, m.conc.max, m.conc.latest, m.conc.slope, m.avgRetained, m.avgAdded, m.avgJaccard, m.leader.avg, m.leader.max, m.totalDistinct, m.maxStreak].forEach(add); 
        if (m.theme) add(m.theme.switches);
        if (state.analysis.perf) [state.analysis.perf.cumReturn, state.analysis.perf.exBestQuarter, state.analysis.perf.maxDrawdown, state.analysis.perf.bestQuarterContribution].forEach(add);
        function add(v) { if (typeof v === 'number' && isFinite(v)) { s[v.toFixed(2)] = 1; s[v.toFixed(1)] = 1; s[String(Math.round(v))] = 1; } }
        return s;
      })();
    }
    var v = FC.ai.validate(taskId, value, ctx);

    FC.ai.log({
      channel: meta && meta.manual ? '大模型(手动中转)' : '大模型(直连)', task: FC.ai.tasks[taskId].name,
      input: taskId === 'theme_classify' ? (payload.stockList || []).length + ' 只个股' : (payload.text ? payload.text.length + ' 字符' : '指标包'),
      output: v.issues.filter(function (i) { return i.level === 'info'; }).map(function (i) { return i.msg; }).join(' ') || '已返回',
      latencyMs: meta ? meta.latencyMs : 0, valid: v.ok, manual: v.ok ? '☐ 待人工确认' : '已拦截'
    });

    var box = $('#validate-' + taskId);
    if (box) {
      box.innerHTML = v.issues.map(function (i) {
        var cls = i.level === 'fail' ? 'neg' : i.level === 'warn' ? '' : 'pos';
        var tag = i.level === 'fail' ? '【拦截】' : i.level === 'warn' ? '【提示】' : i.level === 'pass' ? '【通过】' : '【信息】';
        return '<div class="' + cls + '">' + tag + ' ' + esc(i.msg) + '</div>';
      }).join('');
    }

    if (v.ok && taskId === 'theme_classify') {
      applyThemeMap(value);
      renderAudit(); renderReport(); renderLedger();
    }
    if (v.ok && taskId === 'judgement') {
      state.analysis.card.claim = value.claim;
      state.analysis.card.mainQuestion = value.mainQuestion;
      state.analysis.card.falsifier = value.falsifier;
      state.analysis.form.tag = value.formTag;
      state.analysis.form.reasons = (value.evidenceUsed || []).concat(state.analysis.form.reasons);
      state.analysis.report = FC.buildReport({
        fund: state.analysis.fund, quarters: state.analysis.quarters, m: state.analysis.metrics,
        form: state.analysis.form, perf: state.analysis.perf, cases: state.analysis.cases,
        card: state.analysis.card, trackers: state.analysis.trackers, sources: state.dataset.sources, range: state.analysis.range
      });
      renderReport(); renderLedger(); renderAudit();
    }
    if (v.ok && taskId === 'polish') {
      toast('清洗结果已通过校验(原报告不被覆盖, 请用"导出复盘报告"获取清洗后文本)', 'ok');
    }
    return v.ok;
  }

  function applyThemeMap(value) {
    var map = value.mapping || {}, applied = 0;
    state.dataset.quarters.forEach(function (q) {
      var count = {};
      (q.top10 || []).forEach(function (h) { var t = map[h.name]; if (t) count[t] = (count[t] || 0) + h.weight; });
      var keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
      if (keys.length) { q.theme = keys[0]; q.themeWeight = Math.round(count[keys[0]] * 100) / 100; applied++; }
    });
    state.themeMap = map;
    var a = FC.analyze(state.dataset, { source: state.source });
    state.analysis = a;
    state.check = FC.runCheck(state.dataset, a);
    FC.ai.log({ channel: '规则引擎(离线)', task: '重算(应用 AI 主题归类后)', input: applied + ' 期主题已更新', output: '形态重判: ' + a.form.tag, latencyMs: 0, valid: true, manual: '☐ 待人工确认' });
  }

  /* ============================================================ 启动 */
  FC.init = function () {
    renderInput();
    bind();
    var funds = FC.builtinFunds();
    if (funds.length) {
      var d = FC.getBuiltin(funds[0].code);
      state.analysis = FC.analyze(JSON.parse(JSON.stringify(d)), { source: 'builtin' });
      state.dataset = JSON.parse(JSON.stringify(d));
      state.check = FC.runCheck(state.dataset, state.analysis);
      renderReport(); renderLedger(); renderAudit(); updateStatus();
    } else {
      setStatus('未找到内置样例数据(data/funds.data.js 缺失)');
    }
    show(viewFromHash());
    window.addEventListener('hashchange', function () { show(viewFromHash()); });
    if (FC.initOnline) FC.initOnline();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', FC.init);
  else FC.init();

})(window.FC);
