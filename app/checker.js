/* 基金复诊台 · 质检模块(对应课程第 6 问「错了怎么发现」)
 * 每条规则输出 pass / warn / fail 三态 + 具体证据, 而不是一句"已检查"。
 * 规则分三层: ① 输入层(数据本身对不对) ② 计算层(算得对不对) ③ 输出层(写出来对不对)
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var STRUCT_CONST = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 100];

  function R(id, layer, name, level, detail, evidence) {
    return { id: id, layer: layer, name: name, level: level, detail: detail, evidence: evidence || [] };
  }

  /* ------------------------------------------------------------ ① 输入层 */
  function inputRules(dataset) {
    var out = [];
    var qs = dataset.quarters || [];

    // A1 单一个股不得超过净值 10%(公募"双十"约束)
    // 分档判断: 轻微超标是"被动超标"(股价上涨导致, 法规允许在 10 个交易日内调整),
    // 属正常现象而非数据错误; 大幅超标才说明权重口径可能不是"占净值比"。
    var soft = [], hard = [];
    qs.forEach(function (q) {
      (q.top10 || []).forEach(function (h) {
        if (h.weight > 10.5) hard.push(q.period + ' ' + h.name + '(' + h.code + ') ' + h.weight + '%');
        else if (h.weight > 10.05) soft.push(q.period + ' ' + h.name + '(' + h.code + ') ' + h.weight + '%');
      });
    });
    out.push(hard.length
      ? R('A1', '输入层', '单一个股权重 ≤10%(双十约束)', 'fail', '发现 ' + hard.length + ' 条超过 10.5% 的记录, 幅度过大, 权重口径很可能不是"占净值比"(也可能是数据串列)。', hard.slice(0, 8))
      : soft.length
        ? R('A1', '输入层', '单一个股权重 ≤10%(双十约束)', 'warn', '发现 ' + soft.length + ' 条轻微超过 10%(最大 ' + Math.max.apply(null, qs.flatMap(function (q) { return (q.top10 || []).map(function (h) { return h.weight; }); })).toFixed(2) + '%)。这类小幅超标通常是<strong>被动超标</strong>——期末股价上涨把权重顶过线, 法规允许在 10 个交易日内调整, 属正常现象; 报告中应作为事实陈述, 不宜写成"违规"。', soft.slice(0, 8))
        : R('A1', '输入层', '单一个股权重 ≤10%(双十约束)', 'pass', '全部 ' + (qs.length * 10) + ' 条记录权重均在 (0,10] 区间内, 符合公募"双十"约束。'));

    // A2 每期前十权重降序
    var unordered = [];
    qs.forEach(function (q) {
      for (var i = 1; i < (q.top10 || []).length; i++) {
        if (q.top10[i].weight > q.top10[i - 1].weight + 0.001) {
          unordered.push(q.period + ': ' + q.top10[i - 1].name + ' ' + q.top10[i - 1].weight + '% < ' + q.top10[i].name + ' ' + q.top10[i].weight + '%');
        }
      }
    });    out.push(unordered.length
      ? R('A2', '输入层', '前十权重按降序排列', 'warn', '有 ' + unordered.length + ' 处权重未按降序, 可能是排名列与权重列口径不一致(排名来自披露顺序, 权重来自净值占比)。引擎已按权重重排后再计算。', unordered.slice(0, 5))
      : R('A2', '输入层', '前十权重按降序排列', 'pass', '每个报告期的前十权重均严格降序。'));

    // A3 期数连续性
    var gaps = [];
    for (var i = 1; i < qs.length; i++) {
      var a = /(\d{4})Q([1-4])/.exec(qs[i - 1].period), b = /(\d{4})Q([1-4])/.exec(qs[i].period);
      if (!a || !b) continue;
      var ai = +a[1] * 4 + (+a[2] - 1), bi = +b[1] * 4 + (+b[2] - 1);
      if (bi - ai !== 1) gaps.push(qs[i - 1].period + ' → ' + qs[i].period + ' 间隔 ' + (bi - ai) + ' 个季度');
    }
    out.push(gaps.length
      ? R('A3', '输入层', '报告期连续无跳跃', 'warn', '存在 ' + gaps.length + ' 处季度跳跃。跳过的季度无法计算留存率与换手, 相邻期的"新进/退出"会失真。', gaps)
      : R('A3', '输入层', '报告期连续无跳跃', 'pass', qs.length + ' 个报告期连续无跳跃。'));

    // A4 股票代码格式
    var badCode = [];
    qs.forEach(function (q) { (q.top10 || []).forEach(function (h) { if (!/^\d{6}$/.test(String(h.code))) badCode.push(q.period + ' ' + h.name + ' → "' + h.code + '"'); }); });
    out.push(badCode.length
      ? R('A4', '输入层', '股票代码为 6 位数字', 'fail', '发现 ' + badCode.length + ' 条代码格式异常。常见原因是 Excel 把前导零吃掉(如 000807 变成 807), 会导致跨期同名匹配失败。', badCode.slice(0, 8))
      : R('A4', '输入层', '股票代码为 6 位数字', 'pass', '全部代码均为 6 位数字, 未发现前导零丢失。'));

    // A5 同一报告期重复个股
    // 必须按股票代码判重, 不能按名称: 同一家公司 A+H 两地上市会同时进前十大
    // (如 招商银行 600036 与 03968), 名称相同但代码不同, 是两笔合法持仓。
    var dup = [], ahPair = 0;
    qs.forEach(function (q) {
      var byCode = {};
      (q.top10 || []).forEach(function (h) {
        var k = h.code || h.name;
        if (byCode[k]) dup.push(q.period + ' 代码重复: ' + k + '(' + h.name + ')');
        byCode[k] = 1;
      });
      var byName = {};
      (q.top10 || []).forEach(function (h) {
        if (byName[h.name]) ahPair++;
        byName[h.name] = 1;
      });
    });
    out.push(dup.length
      ? R('A5', '输入层', '同一报告期无重复个股(按代码判重)', 'fail', '发现 ' + dup.length + ' 条同代码重复记录, 会直接污染留存率与换手统计。', dup.slice(0, 5))
      : R('A5', '输入层', '同一报告期无重复个股(按代码判重)', 'pass',
        '按股票代码判重, 无重复。' + (ahPair
          ? '另检出 ' + ahPair + ' 处"同名不同码"(同一家公司 A+H 两地上市, 如招商银行 600036/03968), 属两笔独立持仓, 引擎已按代码分别统计, 未被合并。'
          : '')));

    // A6 数据完整率(主题归类)
    var noTheme = qs.filter(function (q) { return !q.theme; });
    out.push(noTheme.length
      ? R('A6', '输入层', '主题归类完整率', noTheme.length === qs.length ? 'warn' : 'warn',
        (noTheme.length === qs.length
          ? '全部 ' + qs.length + ' 个报告期都缺主题归类 —— 依赖主题的形态规则(主题坚守/主题漂移)会自动跳过, 这正是 AI 模块"主题归类"任务的输入缺口。'
          : noTheme.length + '/' + qs.length + ' 个报告期缺主题归类, 主题演进链条会有断点。'),
        noTheme.map(function (q) { return q.period; }).slice(0, 10))
      : R('A6', '输入层', '主题归类完整率', 'pass', '全部 ' + qs.length + ' 个报告期都有主题归类。'));

    return out;
  }

  /* ------------------------------------------------------------ ② 计算层 */
  function calcRules(dataset, analysis) {
    var out = [];
    var qs = dataset.quarters || [];

    // B1 前十合计复算 vs 披露值
    var mismatch = [];
    qs.forEach(function (q) {
      var calc = Math.round((q.top10 || []).reduce(function (s, h) { return s + (h.weight || 0); }, 0) * 100) / 100;
      if (q.top10Sum !== null && q.top10Sum !== undefined && Math.abs(calc - q.top10Sum) > 0.05) {
        mismatch.push(q.period + ': 独立复算 ' + calc + '% vs 底稿 ' + q.top10Sum + '%, 差 ' + (calc - q.top10Sum).toFixed(2) + 'pp');
      }
    });
    out.push(mismatch.length
      ? R('B1', '计算层', '前十合计权重独立复算', 'fail', '有 ' + mismatch.length + ' 期复算值与底稿披露值不一致(容差 0.05pp)。说明前十大明细与汇总页不是同一口径, 必须先查清再出报告。', mismatch)
      : R('B1', '计算层', '前十合计权重独立复算', 'pass', '逐期用前十明细独立求和, 与底稿汇总值全部一致(容差 0.05pp)。这是"每个数字可回查"的第一道保证。'));

    // B2 前十合计上限
    var overSum = qs.filter(function (q) { return (q.top10Sum || 0) > 100.001; });
    out.push(overSum.length ? R('B2', '计算层', '前十合计 ≤ 100%', 'fail', '有 ' + overSum.length + ' 期前十合计超过 100%, 逻辑上不可能(权重为占净值比)。', overSum.map(function (q) { return q.period + ' ' + q.top10Sum + '%'; }))
      : R('B2', '计算层', '前十合计 ≤ 100%', 'pass', '全部报告期前十合计均不超过 100%。'));

    // B3 推算价合理区间
    var weird = [], priceCount = 0;
    qs.forEach(function (q) {
      (q.top10 || []).forEach(function (h) {
        var p = FC.impliedPrice(h);
        if (p === null) return;
        priceCount++;
        if (p < 0.3 || p > 3000) weird.push(q.period + ' ' + h.name + ' 推算价 ' + p.toFixed(2) + ' 元');
      });
    });
    out.push(R('B3', '计算层', '披露口径推算价落在合理区间', weird.length ? 'warn' : 'pass',
      priceCount === 0
        ? '输入未包含持股数与持仓市值, 无法推算期末价 —— "关键调仓案例审计"章节会自动降级。'
        : (weird.length ? '推算价 = 持仓市值 ÷ 持股数, 有 ' + weird.length + ' 条落在 0.3–3000 元之外, 通常是单位口径错误(万元/万股混用)。' : priceCount + ' 条推算价全部落在 0.3–3000 元区间, 单位口径自洽。'),
      weird.slice(0, 8)));

    // B4 指标可复现
    var m = analysis.metrics || {};
    var okRepro = m.conc && m.conc.series && m.conc.series.length === qs.length;
    out.push(R('B4', '计算层', '指标可复现(同输入同输出)', okRepro ? 'pass' : 'fail',
      okRepro ? '集中度序列长度(' + m.conc.series.length + ')与报告期数一致; 引擎为纯函数, 同一输入重复运行结果逐位相同。' : '集中度序列与报告期数不匹配, 计算结果不可信。'));

    return out;
  }

  /* ------------------------------------------------------------ ③ 输出层 */
  function outputRules(analysis) {
    var out = [];
    var secs = (analysis.report && analysis.report.sections) || [];
    var card = analysis.card || {};

    // C1 报告骨架完整 —— 第九节(可复制×不可神化)由大模型生成, 无合规输出时整节不出现, 故列为可选
    var must = ['conclusion', 'scope', 'performance', 'conc', 'rotation', 'method', 'cases', 'latest', 'track', 'appendix'];
    var have = secs.map(function (s) { return s.id; });
    var miss = must.filter(function (x) { return have.indexOf(x) < 0; });
    out.push(miss.length ? R('C1', '输出层', '固定章节骨架完整(10 节必需)', 'fail', '缺 ' + miss.length + ' 节: ' + miss.join(', '), miss)
      : R('C1', '输出层', '固定章节骨架完整(10 节必需)', 'pass', '10 节必需章节齐全, 顺序与标准流程一致; 「可复制的方法 × 不能被神化的部分」一节由大模型生成, 本次' + (have.indexOf('strength') >= 0 ? '已生成(共 ' + secs.length + ' 节)' : '未生成, 整节不展示、不用套话填充(共 ' + secs.length + ' 节)') + '。'));

    // C2 结论卡字段完整
    var missing = ['formTag', 'mainQuestion', 'claim', 'falsifier', 'evidenceLevel'].filter(function (k) { return !card[k]; });
    out.push(missing.length ? R('C2', '输出层', '结论卡字段完整', 'fail', '缺字段: ' + missing.join(', ') + ' —— 结论卡是跨基金对比的最小单元, 不许留空。', missing)
      : R('C2', '输出层', '结论卡字段完整', 'pass', '形态标签 / 主线问题 / 可证伪判断 / 推翻条件 / 证据级别 五项齐备。'));

    // C3 可证伪性
    var hasFalsifier = card.falsifier && card.falsifier.length > 20 && card.falsifier.indexOf('未达到') >= 0;
    out.push(R('C3', '输出层', '判断可证伪(带明确推翻条件)', hasFalsifier ? 'pass' : 'warn',
      hasFalsifier ? '推翻条件给出了可量化的观察项(下一期留存数门槛 / 主题切换 / 集中度越界), 下一期报告可直接核对。' : '推翻条件不够具体, 无法在下一期核对。'));

    // C4 措辞红线
    var rawText = secs.map(function (s) { return s.title + ' ' + s.html; }).join(' ');
    var plain = normalizeForCheck(rawText.replace(/<[^>]+>/g, ' '));
    var hits = FC.scanVocab(plain);
    out.push(hits.length ? R('C4', '输出层', '对外用词规范(违禁词扫描)', 'fail', '命中 ' + hits.length + ' 个禁用词: ' + hits.map(function (h) { return h.word + ' → ' + h.suggest; }).join('；'), hits.map(function (h) { return h.word; }))
      : R('C4', '输出层', '对外用词规范(违禁词扫描)', 'pass', '已扫描 ' + FC.vocab.ban.length + ' 个禁用词(含"马后炮 / 抄底 / 逃顶 / 精准预测"类), 报告全文 0 命中。'));

    // C5 证据分级覆盖
    var evCount = evMeasureCount(rawText);
    var measures = measureTokens(plain);
    var coverage = measures.length ? evCount / measures.length * 100 : 0;
    out.push(R('C5', '输出层', '数字的证据分级标注覆盖率', coverage >= 90 ? 'pass' : coverage >= 60 ? 'warn' : 'fail',
      '报告中共 ' + measures.length + ' 个"量化 token"(百分比与小数; 年份/报告期/日期/6 位股票代码属于标识符, 不计入), 其中 ' + evCount + ' 个带"披露事实 / 合理推断 / 事后解读"分级标注(约 ' + coverage.toFixed(0) + '%)。' +
      '标注级别按节适用: 披露口径节为"披露事实", 派生指标节(集中度斜率/留存均值/推算价变动)为"合理推断"。'));

    // C6 数字回查
    var allowed = buildAllowedSet(analysis);
    var untraceable = traceNumbers(plain, allowed);
    out.push(R('C6', '输出层', '数字回查(每个数字可指回底稿)', untraceable.length ? 'warn' : 'pass',
      untraceable.length
        ? '有 ' + untraceable.length + ' 个数字未能在底稿/派生指标集合中直接匹配到 —— 多为引擎计算出的派生值或结构性常数。人工复核建议优先看这几个。'
        : '全部数字都能回查到"底稿原始值"或"引擎派生指标"集合。',
      untraceable.slice(0, 10)));

    // C7 绩效缺失时的降级声明
    var hasPerfSection = /绩效/.test(secs.map(function (s) { return s.title; }).join(''));
    var declared = plain.indexOf('不判定绩效形态') >= 0 || plain.indexOf('未提供净值') >= 0;
    out.push(R('C7', '输出层', '绩效缺失时显式降级(不硬编结论)', (analysis.perf || declared) ? 'pass' : 'fail',
      analysis.perf ? '本次输入含绩效口径, 已按"全期 / 剔除爆季 / 回撤 / 规模"成对呈现。'
        : '本次输入无净值序列, 报告已在第三节显式声明"不判定绩效形态"; 形态标签只描述持仓结构, 未冒充绩效结论。'));

    // C8 免责与边界
    var hasDisclaimer = plain.indexOf('不构成投资建议') >= 0 && plain.indexOf('只看前十大') >= 0;
    out.push(R('C8', '输出层', '边界与免责声明', hasDisclaimer ? 'pass' : 'warn',
      hasDisclaimer ? '已声明"只看前十大、季报为期末快照、推算价未复权、不构成投资建议"。' : '缺边界声明, 对外交付前必须补。'));

    return out;
  }

  /* --------------------------------------------------- 数字回查辅助 */

  /** 把标识符从正文里抹掉, 避免把年份/报告期/日期当成"数字结论"来查。
   *  标识符 = 报告期(2026Q2) / 日期(2020-09-24) / 四位年份 / 6 位股票代码。 */
  function normalizeForCheck(plain) {
    return String(plain)
      .replace(/\d{4}\s*Q\s*[1-4]/gi, ' ')
      .replace(/(^|[^\d])\d{2}\s*Q\s*[1-4](?![\d])/gi, '$1 ')   // 图表轴标签把年份截成了两位, 如 "22Q1"
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/\d{4}-\d{2}(?!\d)/g, ' ')                        // 年月, 如 "2019-01 起管理"
      .replace(/(^|[^\d])(?:19|20)\d{2}(?![\d])/g, '$1 ')
      .replace(/(^|[^\d])\d{6}(?![\d])/g, '$1 ');
  }

  /** 量化 token: 带 % 的数, 或带小数点的数。裸整数多为排名/期数/结构性常数, 不计入覆盖率。 */
  function measureTokens(plain) {
    return (plain.match(/\d+(?:\.\d+)?%|\d+\.\d+/g) || []);
  }

  /** 只统计"量化 token"上的分级标注, 与 measureTokens 的口径对齐, 避免分母分子不同口径。 */
  function evMeasureCount(rawText) {
    var spans = rawText.match(/<span class="ev [^"]*"[^>]*>[^<]*<\/span>/g) || [];
    return spans.filter(function (s) {
      var inner = s.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
      return /\d+(?:\.\d+)?%|\d+\.\d+/.test(inner);
    }).length;
  }

  function buildAllowedSet(analysis) {
    var s = {};
    function add(v) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      [v, Math.abs(v)].forEach(function (x) {
        s[x.toFixed(2)] = 1; s[x.toFixed(1)] = 1; s[x.toFixed(0)] = 1; s[String(Math.round(x))] = 1;
      });
    }
    STRUCT_CONST.forEach(function (c) { s[c] = 1; s[c.toFixed(1)] = 1; s[c.toFixed(2)] = 1; });
    (analysis.quarters || []).forEach(function (q) {
      add(q.top10Sum); add(q.top5Sum); add(q.themeWeight); add(q.aum); add(q.nav); add(q.stockPos);
      add(q.retained); add(q.jaccard);
      (q.top10 || []).forEach(function (h) { add(h.weight); add(FC.impliedPrice(h)); add(h.rank); });
    });
    var m = analysis.metrics || {};
    // 引擎派生指标(非直接来自底稿, 但由底稿确定性算出, 属于可复现的派生值)
    add(analysis.quarterCount);
    add(analysis.quarterCount * 10);          // 前十席位总数
    add(analysis.quarterCount - 1);           // 相邻期对数
    add(m.totalDistinct);
    (m.holders || []).forEach(function (h) { add(h.count); add(h.maxStreak); });
    (m.churn || []).forEach(function (c) { add(c.retained); add(c.added.length); add(c.dropped.length); });
    // 相邻期权重差(最新一期结构变化表里的 pp 变化) —— 按代码配对, 避免 A+H 同名被合并
    var qs = analysis.quarters || [];
    for (var i = 1; i < qs.length; i++) {
      var pm = {}, cm = {};
      (qs[i - 1].top10 || []).forEach(function (h) { pm[h.code || h.name] = h.weight; });
      (qs[i].top10 || []).forEach(function (h) { cm[h.code || h.name] = h.weight; });
      Object.keys(cm).forEach(function (k) { if (pm[k] !== undefined) add(cm[k] - pm[k]); });
    }
    if (m.conc) { add(m.conc.avg); add(m.conc.min); add(m.conc.max); add(m.conc.first); add(m.conc.latest); add(m.conc.slope); }
    add(m.avgRetained); add(m.avgAdded); add(m.avgJaccard); add(m.totalDistinct); add(m.maxStreak);
    if (m.leader) { add(m.leader.avg); add(m.leader.max); add(m.leader.latest); }
    if (m.theme) add(m.theme.switches);
    if (m.scale) { add(m.scale.first); add(m.scale.end); add(m.scale.peak); add(m.scale.trough); add(m.scale.changePct); add(m.scale.peakToEndPct); }
    (analysis.cases ? analysis.cases.wins : []).forEach(function (c) { add(c.change); add(c.entryPrice); add(c.exitPrice); add(c.heldQuarters); add(c.entryWeight); add(c.exitWeight); });
    if (analysis.perf) { add(analysis.perf.cumReturn); add(analysis.perf.exBestQuarter); add(analysis.perf.maxDrawdown); add(analysis.perf.aumPeak); add(analysis.perf.aumEnd); add(analysis.perf.bestQuarterContribution); }
    return s;
  }

  function traceNumbers(plain, allowed) {
    var toks = plain.match(/\d+(?:\.\d+)?/g) || [];
    var bad = {}, out = [];
    toks.forEach(function (t) {
      if (/^(19|20)\d\d$/.test(t)) return;          // 年份
      if (/^\d{6}$/.test(t)) return;                // 股票代码
      if (allowed[t] || bad[t]) return;
      bad[t] = 1;
      var i = plain.indexOf(t);
      var ctx = plain.slice(Math.max(0, i - 16), i + t.length + 12).replace(/\s+/g, ' ').trim();
      out.push(t + '  ← …' + ctx + '…');
    });
    return out;
  }

  /* --------------------------------------------------------- 人工抽检 */
  /** 人工抽检不是"给你个数字自己看着办" —— 每条都要写清**怎么核、去哪核、核什么**。
   *  所以每条都带上: 官方季报 PDF 直链 + 该翻到哪一节 + 核对哪一列 + 合格判据。 */
  FC.sampleForManualCheck = function (analysis, k, official) {
    k = k || 12;
    // 报告期 -> 官方 PDF 链接 + 该期是否有官方报告
    var urlBy = {};
    var checks = (official && official.checks) || [];
    checks.forEach(function (c) {
      if (c.url) urlBy[c.period] = { url: c.url, period: c.period, rows: c.parsedRows, ok: c.reconcile && c.reconcile.ok };
    });

    var pool = [];
    (analysis.quarters || []).forEach(function (q) {
      var off = urlBy[q.period];
      (q.top10 || []).forEach(function (h) {
        pool.push({
          period: q.period, item: h.name + '(' + h.code + ')', rank: h.rank,
          field: '占基金资产净值比例(%)', value: h.weight + '%',
          source: off ? '官方季报 PDF' : '第三方接口(该期无官方报告)',
          url: off ? off.url : '',
          howTo: off
            ? '① 点开下面的官方季报 PDF; ② 翻到「§5.3 报告期末按公允价值占基金资产净值比例大小排序的前十名股票投资明细」; ③ 找序号 ' + h.rank + ' 那一行; ④ 核对"占基金资产净值比例(%)"列是否等于 ' + h.weight + '%(容差 ±0.01pp)。'
            : '该期无可得的官方报告 PDF —— 请到基金公司官网公告区或巨潮资讯搜「' + (analysis.fund.fullName || analysis.fund.name) + ' ' + q.period + ' 季度报告」, 翻到前十名股票投资明细表, 核对序号 ' + h.rank + ' 的权重是否为 ' + h.weight + '%(容差 ±0.01pp)。'
        });
      });
      if (q.top10Sum !== null && q.top10Sum !== undefined) {
        pool.push({
          period: q.period, item: '前十合计', rank: '—', field: '合计占净值(%)', value: q.top10Sum + '%',
          source: '由前十明细求和',
          url: off ? off.url : '',
          howTo: '把该期前十行"占基金资产净值比例(%)"逐个相加, 看是否等于 ' + q.top10Sum + '%(容差 ±0.05pp); 再与报告第三节表格里的披露值对照。'
        });
      }
    });
    if (!pool.length) return [];

    /* 确定性抽样(种子固定): 同输入同清单, 便于复核可复现。
       优先抽"有官方 PDF 可比对"的期 —— 那些才真的能核。 */
    var preferred = pool.filter(function (x) { return x.url; });
    var usePool = preferred.length >= k ? preferred : pool;
    var seed = 20260916, picked = [], used = {};
    for (var i = 0; i < k && i < usePool.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      var idx = seed % usePool.length;
      var guard = 0;
      while (used[idx] && guard++ < usePool.length) { idx = (idx + 1) % usePool.length; }
      used[idx] = 1; picked.push(usePool[idx]);
    }
    return picked;
  };

  FC.runCheck = function (dataset, analysis) {
    var parseIssues = (dataset && dataset._parseIssues) || [];
    var rules = []
      .concat(inputRules(dataset))
      .concat(calcRules(dataset, analysis))
      .concat(outputRules(analysis));

    parseIssues.forEach(function (pi, i) {
      rules.unshift(R('P' + (i + 1), '输入层', '解析提示', pi.level, pi.msg));
    });

    var fails = rules.filter(function (r) { return r.level === 'fail'; });
    var warns = rules.filter(function (r) { return r.level === 'warn'; });
    return {
      rules: rules,
      summary: {
        total: rules.length, pass: rules.filter(function (r) { return r.level === 'pass'; }).length,
        warn: warns.length, fail: fails.length,
        verdict: fails.length ? 'fail' : warns.length ? 'warn' : 'pass',
        verdictText: fails.length ? '有 ' + fails.length + ' 项必须处理(阻断)' : warns.length ? '通过, 有 ' + warns.length + ' 项建议人工确认' : '全部通过'
      },
      manualSample: FC.sampleForManualCheck(analysis, 12, (dataset && dataset.official) || null),
      checkedAt: new Date().toISOString()
    };
  };

  /** 导出为可提交的《错误检查记录》Markdown */
  FC.checkToMarkdown = function (check, analysis) {
    var L = [];
    L.push('# 错误检查记录(自动生成)');
    L.push('');
    L.push('- 生成时间: ' + check.checkedAt);
    L.push('- 检查对象: ' + (analysis.fund.name || '') + '(' + (analysis.fund.code || '') + ') · ' + analysis.range + ' · ' + analysis.quarterCount + ' 个报告期');
    L.push('- 结论: **' + check.summary.verdictText + '**(通过 ' + check.summary.pass + ' / 提示 ' + check.summary.warn + ' / 阻断 ' + check.summary.fail + ')');
    L.push('');
    L.push('## 一、逐条结果');
    L.push('');
    L.push('| 编号 | 层 | 检查项 | 结果 | 说明 |');
    L.push('| --- | --- | --- | --- | --- |');
    check.rules.forEach(function (r) {
      var icon = r.level === 'pass' ? '通过' : r.level === 'warn' ? '提示' : '**阻断**';
      L.push('| ' + r.id + ' | ' + r.layer + ' | ' + r.name + ' | ' + icon + ' | ' + r.detail.replace(/\|/g, '/') + ' |');
    });
    L.push('');
    if (check.rules.some(function (r) { return r.evidence && r.evidence.length; })) {
      L.push('## 二、证据明细');
      L.push('');
      check.rules.forEach(function (r) {
        if (!r.evidence || !r.evidence.length) return;
        L.push('**' + r.id + ' ' + r.name + '**');
        r.evidence.forEach(function (e) { L.push('- ' + e); });
        L.push('');
      });
    }
    L.push('## 三、人工抽检清单(12 处, 需回官方季报原文核对)');
    L.push('');
    L.push('> 每一条都写清了**去哪核、翻到哪一节、核对哪一列、合格判据**。抽检采用固定种子, 同一份输入重复运行得到同一份清单, 便于复核留痕。');
    L.push('');
    L.push('| # | 报告期 | 标的 | 字段 | 引擎值 | 核对步骤 | 官方原文 | 结果 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    check.manualSample.forEach(function (s, i) {
      L.push('| ' + (i + 1) + ' | ' + s.period + ' | ' + s.item + ' | ' + s.field + ' | **' + s.value + '** | ' +
        String(s.howTo || '').replace(/\|/g, '/') + ' | ' + (s.url ? '[季报 PDF](' + s.url + ')' : '（该期无官方 PDF，需自行检索）') + ' | ☐ |');
    });
    L.push('');
    L.push('**怎么判定通过**: 逐条打开官方 PDF 核对, 全部一致即"数字查"通过; 有任何一条对不上, 停下来查清是抓取错、口径错还是官方口径特殊, **不许带病发布**(见标准流程的终审三查)。');
    L.push('');
    L.push('## 四、本次运行的口径边界');
    L.push('');
    L.push('- 仅前十大持仓(季报口径), 期末快照, 期间买卖不可见;');
    L.push('- 推算价 = 期末公允价值 ÷ 期末持股数, 未复权、不含分红;');
    L.push('- 本记录由规则引擎自动生成, 阻断项(如有)必须人工处理后才能对外交付。');
    return L.join('\n');
  };

})(window.FC);
