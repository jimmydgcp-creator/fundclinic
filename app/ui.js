/* 基金复诊台 · 界面与控制器
 * 三道人机门禁在代码里的落点:
 *   门禁 1 · 口径确认   -> 输入页勾选后才允许开跑
 *   门禁 2 · 判断方向   -> 报告页必须由人确认或改判形态标签
 *   门禁 3 · 终审三查   -> 质检页数字/结论/合规三项打勾后才可标记"可交付"
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var esc = FC.esc;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var state = {
    dataset: null, analysis: null, check: null, source: 'builtin',
    parseIssues: [], gates: { g1: false, g2: false, g2tag: '', g3: { num: false, concl: false, comp: false } },
    llmCfg: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' },
    themeMap: null, manualChecks: {}
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

  function gate1Ok() {
    return $('#g1-a').checked && $('#g1-b').checked && $('#g1-c').checked;
  }
  function syncGate1() {
    var ok = gate1Ok();
    $('#gate1').classList.toggle('done', ok);
    state.gates.g1 = ok;
  }

  /* ============================================================ 运行 */
  function run(dataset, source, parseIssues) {
    dataset._parseIssues = parseIssues || [];
    state.dataset = dataset;
    state.source = source;
    state.parseIssues = parseIssues || [];
    state.gates.g2 = false; state.gates.g2tag = '';
    state.gates.g3 = { num: false, concl: false, comp: false };
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
    if (state.check) bits.push('质检: ' + state.check.summary.verdictText);
    var gates = '门禁 1' + (state.gates.g1 ? '✓' : '✗') + ' / 2' + (state.gates.g2 ? '✓' : '✗') + ' / 3' + ((state.gates.g3.num && state.gates.g3.concl && state.gates.g3.comp) ? '✓' : '✗');
    setStatus(bits.join(' · ') + ' · ' + gates);
  }

  /** 四个视图一起重画(在线模式跑完新基金后调用) */
  FC.renderAll = function () { renderReport(); renderLedger(); renderAudit(); updateStatus(); };

  /** 接收"服务端跑完"的结果: 引擎在服务端算好, 前端只负责画 */
  FC.applyServerResult = function (analysis, check, datasetMeta) {
    if (!analysis || analysis.error) { toast('结果无效: ' + ((analysis && analysis.error) || '空'), 'err'); return; }
    state.analysis = analysis;
    state.check = check;
    state.dataset = datasetMeta || null;
    state.source = 'crawled';
    state.gates.g1 = true;
    state.gates.g2 = false; state.gates.g2tag = '';
    state.gates.g3 = { num: false, concl: false, comp: false };
    state.manualChecks = {};
    FC.ai.clearLog();
    FC.ai.log({
      channel: '规则引擎(服务端)', task: '自动采集 + 全流程计算',
      input: (datasetMeta && datasetMeta.crawlStandard) ? '六类来源' : '爬取数据',
      output: analysis.quarterCount + ' 期 / 形态 ' + analysis.form.tag + ' / 质检 ' + (check ? check.summary.verdictText : '—'),
      latencyMs: 0, valid: true, manual: '门禁 1 由在线模式自动确认'
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

    var gate = '<div class="gate' + (state.gates.g2 ? ' done' : '') + '" id="gate2">' +
      '<h4>门禁 2 · 核心判断方向确认(人主做, 不可让渡)</h4>' +
      '<p class="note" style="margin-top:0">引擎给出形态标签「<strong>' + esc(a.form.tag) + '</strong>」(置信度 ' + a.form.confidence + ')' +
      (a.form.alternatives.length ? ', 次优解释: ' + esc(a.form.alternatives.join(' / ')) : '') + '。请确认或改判:</p>' +
      '<label><input type="radio" name="g2tag" value="keep"' + (state.gates.g2tag === 'keep' ? ' checked' : '') + '> 认可引擎判断, 按此方向成文</label>' +
      '<label><input type="radio" name="g2tag" value="override"' + (state.gates.g2tag === 'override' ? ' checked' : '') + '> 我要改判(请在下方填写人工标签与理由)</label>' +
      '<div style="display:flex;gap:9px;margin-top:9px;flex-wrap:wrap">' +
      '<input type="text" id="g2-custom" placeholder="人工改判后的形态标签" style="max-width:260px" value="' + esc(state.gates.g2Custom || '') + '">' +
      '<input type="text" id="g2-reason" placeholder="改判理由(会写进报告与结论卡)" style="max-width:380px" value="' + esc(state.gates.g2Reason || '') + '">' +
      '<button class="btn btn-sm btn-primary" id="btn-g2">确认判断方向</button>' +
      '</div></div>';

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

  /* ============================================================ 质检页 */
  function renderAudit() {
    var a = state.analysis, ck = state.check;
    if (!a || !ck) return;

    var pills = '<div class="summary-bar">' +
      '<div class="summary-pill pill-verdict"><b>' + esc(ck.summary.verdictText) + '</b><span>总体结论</span></div>' +
      '<div class="summary-pill pill-pass"><b>' + ck.summary.pass + '</b><span>通过</span></div>' +
      '<div class="summary-pill pill-warn"><b>' + ck.summary.warn + '</b><span>提示(需人工确认)</span></div>' +
      '<div class="summary-pill pill-fail"><b>' + ck.summary.fail + '</b><span>阻断(必须处理)</span></div>' +
      '</div>';

    var rules = ck.rules.map(function (r) {
      return '<div class="rule rule-' + r.level + '">' +
        '<div class="rule-head"><span class="rule-id">' + r.id + '</span><span class="rule-name">' + esc(r.name) + '</span>' +
        '<span class="badge badge-' + r.level + '">' + (r.level === 'pass' ? '通过' : r.level === 'warn' ? '提示' : '阻断') + '</span>' +
        '<span class="rule-layer">' + r.layer + '</span></div>' +
        '<p class="rule-detail">' + esc(r.detail) + '</p>' +
        (r.evidence && r.evidence.length ? '<ul class="rule-ev">' + r.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }).join('');

    var sample = '<p class="panel-sub" style="margin-top:-6px">每条都写清了<strong>去哪核、翻到哪一节、核对哪一列、合格判据</strong>。引擎按固定种子抽取, 同一份输入重复运行得到同一份清单, 便于复核留痕。</p>' +
      '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>报告期</th><th>标的</th><th>引擎值</th><th>怎么核(照这个步骤做)</th><th>官方原文</th><th>核完</th></tr></thead><tbody>' +
      ck.manualSample.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + s.period + '</td><td>' + esc(s.item) + '</td><td><strong>' + esc(s.value) + '</strong></td>' +
          '<td style="font-size:12.5px">' + esc(s.howTo || '') + '</td>' +
          '<td>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">打开季报</a>' : '<span class="hint">需自行检索</span>') + '</td>' +
          '<td><input type="checkbox" class="chk-sample" data-i="' + i + '"' + (state.manualChecks[i] ? ' checked' : '') + '></td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="note"><strong>怎么判定通过</strong>: 逐条打开官方 PDF 核对, 全部一致即"数字查"通过; 有任何一条对不上, 停下来查清是抓取错、口径错还是官方口径特殊, 不许带病发布。</p>';

    var defaultLLM = (FC.online && FC.online.health && FC.online.health.llm) || { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };
    var aiTasks = Object.keys(FC.ai.tasks).map(function (k) {
      var t = FC.ai.tasks[k];
      return '<div class="ai-task"><h4>' + esc(t.name) + '</h4>' +
        '<div class="ai-io">' +
        '<div class="io-box"><b>输入</b><p>' + esc(t.input) + '</p></div>' +
        '<div class="io-box"><b>输出(严格 JSON)</b><p>' + esc(t.output) + '</p></div>' +
        '</div>' +
        '<div class="io-box trap"><b>错了怎么发现</b><p>' + esc(t.howToDetectError) + '</p></div>' +
        '<div class="btn-row" style="margin-top:10px">' +
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
        '<div id="validate-' + k + '" class="note"></div></div>' +
        '</div>';
    }).join('');

    var logRows = FC.ai.runLog.length ? FC.ai.runLog.map(function (e) {
      return '<tr><td class="mono">' + e.at.slice(11, 19) + '</td><td>' + esc(e.channel || '—') + '</td><td>' + esc(e.task || '—') + '</td>' +
        '<td>' + esc(String(e.input || '').slice(0, 42)) + '</td><td>' + esc(String(e.output || '').slice(0, 60)) + '</td>' +
        '<td>' + (e.latencyMs !== undefined ? e.latencyMs + ' ms' : '—') + '</td>' +
        '<td>' + (e.valid === undefined ? '—' : (e.valid ? '<span class="pos">通过</span>' : '<span class="neg">未通过</span>')) + '</td>' +
        '<td>' + esc(e.manual || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="8">本次未调用大模型(全部由离线规则引擎完成)。</td></tr>';

    var g3 = state.gates.g3;
    var gate3 = '<div class="gate' + ((g3.num && g3.concl && g3.comp) ? ' done' : '') + '">' +
      '<h4>门禁 3 · 终审三查(人主做, 不可让渡)</h4>' +
      '<label><input type="checkbox" id="g3-num"' + (g3.num ? ' checked' : '') + '> <span><strong>数字查</strong>: 抽检清单已逐条回官方季报核对, 无一处不符</span></label>' +
      '<label><input type="checkbox" id="g3-concl"' + (g3.concl ? ' checked' : '') + '> <span><strong>结论查</strong>: 结论卡与报告正文一致, 无超出底稿的推断; 形态标签已由人确认</span></label>' +
      '<label><input type="checkbox" id="g3-comp"' + (g3.comp ? ' checked' : '') + '> <span><strong>合规查</strong>: 无收益承诺、无违禁词、已声明只看前十大与不构成投资建议</span></label>' +
      '<div style="margin-top:10px"><button class="btn btn-sm btn-primary" id="btn-deliver"' + ((g3.num && g3.concl && g3.comp) ? '' : ' disabled') + '>标记为可交付并导出三份记录</button></div>' +
      '</div>';

    $('#audit-body').innerHTML =
      '<div class="panel"><h3>一、自动质检(错了怎么发现 · ' + ck.summary.total + ' 条规则)</h3>' +
      '<p class="panel-sub">三层检查: 输入层(数据本身对不对) → 计算层(算得对不对) → 输出层(写出来对不对)。每条都给出具体证据, 不是一句"已检查"。</p>' +
      pills + rules +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn btn-sm" id="btn-export-check">导出《错误检查记录》MD</button>' +
      '<button class="btn btn-sm" id="btn-copy-check">复制检查记录</button>' +
      '</div></div>' +

      '<div class="panel"><h3>二、人工抽检清单(12 处, 固定种子可复现)</h3>' +
      '<p class="panel-sub">引擎按固定种子抽取 12 处数字, 需回官方季报原文核对。同一份输入重复运行, 抽检清单完全相同 —— 这是"可复核"的最低要求。</p>' +
      sample + '</div>' +

      '<div class="panel"><h3>三、AI 模块 · 三个任务</h3>' +
      '<p class="panel-sub">分工原则: 抓取/解析/量化/对账/质检交给脚本(确定性); 只有"语言类"任务交给大模型, 且输出必须过校验。' +
      '<br>直连大模型若被浏览器 CORS 拦截, 属环境限制, 改用"手动中转"即可, 课堂演示不会因此失败。</p>' +
      '<div class="grid2" style="margin-bottom:14px">' +
      '<label class="field"><span>API Base(OpenAI 兼容)</span><input type="text" id="llm-base" value="' + esc(defaultLLM.baseUrl) + '"></label>' +
      '<label class="field"><span>模型名</span><input type="text" id="llm-model" value="' + esc(defaultLLM.model) + '"></label>' +
      '</div>' +
      '<label class="field"><span>API Key(仅存在本页内存, 不写入任何文件; 在线模式下由本地服务转发请求)</span><input type="password" id="llm-key" value="' + esc(state.llmCfg.apiKey) + '"></label>' +
      aiTasks +
      '<h4 style="margin-top:18px">运行记录</h4>' +
      '<table class="tbl tbl-compact"><thead><tr><th>时间</th><th>通道</th><th>任务</th><th>输入摘要</th><th>输出摘要</th><th>耗时</th><th>校验</th><th>人工复核</th></tr></thead><tbody>' + logRows + '</tbody></table>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn btn-sm" id="btn-export-log">导出《AI 运行记录》MD</button></div>' +
      '</div>' +

      '<div class="panel"><h3>四、门禁与交付</h3>' + gate3 +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn btn-sm" id="btn-export-report">导出复盘报告(MD)</button>' +
      '<button class="btn btn-sm" id="btn-export-card">导出结论卡(JSON)</button>' +
      '<button class="btn btn-sm" id="btn-export-dataset">导出底稿(JSON)</button>' +
      '</div></div>';
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
        formTag: state.gates.g2 && state.gates.g2tag === 'override' && state.gates.g2Custom ? state.gates.g2Custom : a.form.tag,
        formConfidence: a.form.confidence,
        engineFormTag: a.form.tag,
        humanOverride: !!(state.gates.g2 && state.gates.g2tag === 'override'),
        humanReason: state.gates.g2Reason || '',
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
      gates: { g1_口径确认: state.gates.g1, g2_判断方向: state.gates.g2, g3_终审三查: state.gates.g3 }
    }, null, 2);
  }
  function r2(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null; }

  /* ============================================================ 事件绑定 */
  function bind() {
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.view); }); });

    $('#builtin-list').addEventListener('click', function (e) {
      var b = e.target.closest('.btn-run');
      if (!b) return;
      if (!gate1Ok()) { toast('请先完成门禁 1 的口径确认(三项全勾选)', 'err'); $('#gate1').scrollIntoView({ behavior: 'smooth' }); return; }
      var d = FC.getBuiltin(b.dataset.code);
      if (!d) { toast('未找到内置样例 ' + b.dataset.code, 'err'); return; }
      run(JSON.parse(JSON.stringify(d)), 'builtin', []);
      toast('已载入 ' + d.fund.name + ' 并完成全部计算', 'ok');
    });

    ['#g1-a', '#g1-b', '#g1-c'].forEach(function (s) { $(s).addEventListener('change', syncGate1); });

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

      if (t.id === 'btn-g2') {
        var sel = document.querySelector('input[name=g2tag]:checked');
        if (!sel) { toast('请选择"认可"或"改判"', 'err'); return; }
        state.gates.g2tag = sel.value;
        state.gates.g2Custom = $('#g2-custom').value.trim();
        state.gates.g2Reason = $('#g2-reason').value.trim();
        if (sel.value === 'override' && !state.gates.g2Custom) { toast('改判必须填写人工标签', 'err'); return; }
        state.gates.g2 = true;
        FC.ai.log({
          channel: '人工门禁', task: 'G2 核心判断方向确认',
          input: '引擎标签: ' + state.analysis.form.tag,
          output: sel.value === 'override' ? '改判为: ' + state.gates.g2Custom + ' · 理由: ' + state.gates.g2Reason : '认可引擎判断',
          latencyMs: 0, valid: true, manual: '✔ 已人工确认'
        });
        renderReport(); renderAudit(); updateStatus();
        toast('门禁 2 已确认。' + (sel.value === 'override' ? '已按人工标签改写结论卡。' : ''), 'ok');
        return;
      }

      if (t.id === 'btn-export-check') { download('错误检查记录_' + state.analysis.fund.code + '.md', FC.checkToMarkdown(state.check, state.analysis), 'text/markdown'); return; }
      if (t.id === 'btn-copy-check') { copyText(FC.checkToMarkdown(state.check, state.analysis), '错误检查记录'); return; }
      if (t.id === 'btn-export-log') { download('AI运行记录_' + state.analysis.fund.code + '.md', FC.ai.runLogToMarkdown(state.analysis), 'text/markdown'); return; }
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

    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('chk-sample')) {
        state.manualChecks[e.target.dataset.i] = e.target.checked;
      }
      if (e.target.id === 'g3-num' || e.target.id === 'g3-concl' || e.target.id === 'g3-comp') {
        state.gates.g3 = { num: $('#g3-num').checked, concl: $('#g3-concl').checked, comp: $('#g3-comp').checked };
        var ok = state.gates.g3.num && state.gates.g3.concl && state.gates.g3.comp;
        var b = $('#btn-deliver');
        if (b) b.disabled = !ok;
        e.target.closest('.gate').classList.toggle('done', ok);
        FC.ai.log({ channel: '人工门禁', task: 'G3 终审三查', input: '数字/结论/合规', output: ok ? '三项全部通过' : '进行中', latencyMs: 0, valid: true, manual: ok ? '✔ 已人工确认' : '☐' });
        updateStatus();
      }
    });
  }

  function deliverNote(ck) {
    return ['# 交付说明 · 三份记录齐备', '',
      '本包由「基金复诊台 FundClinic」在门禁 3 通过后生成, 证明这次复盘是"可核验"的而不是"看起来像":', '',
      '| 交付物 | 内容 | 本包数值 |', '| --- | --- | --- |',
      '| 复盘报告 | 11 节固定骨架 + 逐数字证据分级 | ' + state.analysis.quarterCount + ' 期 / ' + state.analysis.report.sections.length + ' 节 |',
      '| 错误检查记录 | ' + ck.summary.total + ' 条规则(输入/计算/输出三层) + 12 处人工抽检清单 | 通过 ' + ck.summary.pass + ' · 提示 ' + ck.summary.warn + ' · 阻断 ' + ck.summary.fail + ' |',
      '| 运行记录 | 规则引擎与大模型的每一次调用(输入/输出/耗时/校验) | ' + FC.ai.runLog.length + ' 条 |',
      '', '## 边界声明', '',
      '- 数据全部来自公开季报与天天基金 F10, 不含任何机构内部数据;',
      '- 只看前十大持仓, 季报为期末快照, 期间买卖不可见;',
      '- 推算价未复权、不含分红, 不代表投资者实际收益;',
      '- 全文为回溯复盘, 不构成投资建议。'].join('\n');
  }

  /* --------------------------------------------------------- LLM 调用 */
  function runDirectLLM(taskId) {
    state.llmCfg.baseUrl = $('#llm-base').value.trim() || state.llmCfg.baseUrl;
    state.llmCfg.model = $('#llm-model').value.trim() || state.llmCfg.model;
    state.llmCfg.apiKey = $('#llm-key').value.trim();
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
    syncGate1();
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
