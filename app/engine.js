/* 基金复诊台 · 规则引擎
 * 职责: 输入(结构化持仓底稿) -> 确定性计算 -> 指标 / 形态标签 / 结论卡 / 报告骨架
 * 纪律: 引擎只做确定性计算与"披露事实"的复述; 任何判断都带证据级别与反证条件。
 * 本文件不依赖网络与大模型, 可在 file:// 下直接运行。
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  /* ---------------------------------------------------------- 对外用词规范 */
  var VOCAB_BAN = ['马后炮', '抄底', '逃顶', '精准预测', '封神', '必涨', '稳赚', '翻倍',
    '神预测', '低点买入', '高点卖出', '稳赢', '包赚'];
  var VOCAB_MAP = {
    '马后炮': '回溯复盘', '抄底': '低位布局', '逃顶': '高位减持',
    '精准预测': '事后可核验的推断', '封神': '（删除）', '必涨': '（删除，禁止收益承诺）'
  };

  FC.vocab = { ban: VOCAB_BAN, map: VOCAB_MAP };

  FC.scanVocab = function (text) {
    var hits = [];
    var t = String(text || '');
    VOCAB_BAN.forEach(function (w) {
      var idx = t.indexOf(w);
      if (idx >= 0) hits.push({ word: w, suggest: VOCAB_MAP[w] || '删除改写', at: idx });
    });
    return hits;
  };

  FC.cleanVocab = function (text) {
    var t = String(text || '');
    Object.keys(VOCAB_MAP).forEach(function (w) {
      var rep = VOCAB_MAP[w];
      if (rep.indexOf('删除') === 0) {
        t = t.split(w).join('【待改写】');
      } else {
        t = t.split(w).join(rep);
      }
    });
    return t;
  };

  /* ---------------------------------------------------------------- 小工具 */
  function n(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function fx(v, d) { return v === null || v === undefined ? '—' : Number(v).toFixed(d === undefined ? 2 : d); }
  function mean(a) { a = a.filter(function (x) { return x !== null; }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function sum(a) { return a.reduce(function (s, x) { return s + (x || 0); }, 0); }

  /** 最小二乘斜率(每期变化) */
  function slope(series) {
    var pts = [];
    series.forEach(function (v, i) { if (v !== null) pts.push([i, v]); });
    if (pts.length < 3) return null;
    var mx = mean(pts.map(function (p) { return p[0]; }));
    var my = mean(pts.map(function (p) { return p[1]; }));
    var num = 0, den = 0;
    pts.forEach(function (p) { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) * (p[0] - mx); });
    return den === 0 ? null : num / den;
  }

  FC.util = { n: n, fx: fx, mean: mean, sum: sum, slope: slope };

  /** 数据来源要显示成人能读的文本。
   *  爬取来的来源是对象 {type, url, fetchedAt}, 内置样例是字符串 —— 以前直接 join,
   *  对象会被拼成 "[object Object]"(用户实际看到的 bug)。这里统一成 "类型 · URL"。 */
  FC.formatSources = function (list) {
    if (!list || !list.length) return [];
    var seen = {}, out = [];
    list.forEach(function (s) {
      var t;
      if (typeof s === 'string') t = s;
      else if (s && s.url) t = (s.type ? s.type + ' · ' : '') + s.url;
      else if (s && s.type) t = s.type;
      else t = String(s);
      if (seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    // 官方报告 PDF 通常有多条(每期一条), 折成一条更好读
    var pdf = out.filter(function (t) { return /^官方定期报告 PDF/.test(t); });
    var rest = out.filter(function (t) { return !/^官方定期报告 PDF/.test(t); });
    if (pdf.length > 1) {
      var urls = pdf.map(function (t) { return t.split(' · ')[1]; });
      rest.unshift('官方定期报告 PDF(共 ' + pdf.length + ' 期, 逐行对账): ' + urls.slice(0, 2).join('、') + (urls.length > 2 ? ' 等' : ''));
    }
    return rest;
  };

  /** 披露口径推算期末价(元/股) = 持仓市值(万元) / 持股数(万股)
   *  证据级别: 合理推断 —— 公允价值可能非收盘价, 且未做除权除息复权。 */
  function impliedPrice(h) {
    if (h.sharesWan && h.valueWan && h.sharesWan > 0) return h.valueWan / h.sharesWan;
    return null;
  }
  FC.impliedPrice = impliedPrice;

  /** 持仓的唯一键必须用股票代码, 不能用名称。
   *  理由(真实踩到的坑): A+H 两地上市的同一家公司会同时出现在前十大里
   *  (如 招商银行 600036 与 03968、中国平安 601318 与 02318)。
   *  若按名称做键, 这两行会被当成同一只股票合并, 留存率/换手/Jaccard 会全部算错。 */
  function keyOf(h) { return h && (h.code || h.name) ? String(h.code || h.name) : ''; }

  /* ------------------------------------------------------------ 结构指标层 */
  function buildHolderIndex(quarters) {
    var idx = {};
    quarters.forEach(function (q, qi) {
      (q.top10 || []).forEach(function (h) {
        var key = keyOf(h);
        if (!idx[key]) {
          idx[key] = {
            name: h.name, code: h.code, count: 0, maxWeight: null, periods: [],
            firstIdx: qi, lastIdx: qi, maxStreak: 0, streak: 0,
            priceSeries: [], weightSeries: []
          };
        }
        var s = idx[key];
        s.count += 1;
        s.maxWeight = s.maxWeight === null ? h.weight : Math.max(s.maxWeight, h.weight || 0);
        s.periods.push(q.period);
        if (s.lastIdx === qi - 1) { s.streak += 1; } else { s.streak = 1; }
        s.lastIdx = qi;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        s.priceSeries.push({ period: q.period, price: impliedPrice(h), weight: h.weight });
        s.weightSeries.push({ period: q.period, weight: h.weight });
      });
    });
    return idx;
  }

  function churnOf(quarters) {
    var out = [];
    for (var i = 1; i < quarters.length; i++) {
      var prev = {}, cur = {};
      (quarters[i - 1].top10 || []).forEach(function (h) { prev[keyOf(h)] = h; });
      (quarters[i].top10 || []).forEach(function (h) { cur[keyOf(h)] = h; });
      var keys = Object.keys(cur);
      var retained = keys.filter(function (k) { return prev[k]; });
      var added = keys.filter(function (k) { return !prev[k]; });
      var dropped = Object.keys(prev).filter(function (k) { return !cur[k]; });
      var union = {};
      Object.keys(prev).concat(keys).forEach(function (k) { union[k] = 1; });
      var u = Object.keys(union).length;
      out.push({
        period: quarters[i].period,
        retained: retained.length,
        added: added.map(function (k) { return cur[k].name; }),
        dropped: dropped.map(function (k) { return prev[k].name; }),
        addedKeys: added, droppedKeys: dropped,
        jaccard: u ? retained.length / u : null
      });
    }
    return out;
  }

  /** 主题演进: 相邻期主导主题是否变化 */
  function themeOf(quarters) {
    var seq = quarters.map(function (q) { return q.theme || ''; });
    var known = seq.filter(function (t) { return t; });
    if (!known.length) return { known: false, seq: seq, switches: null, runs: [], longestRun: null, latest: '' };
    var runs = [], cur = null;
    seq.forEach(function (t) {
      if (!t) return;
      if (cur && cur.theme === t) { cur.len += 1; }
      else { cur = { theme: t, len: 1 }; runs.push(cur); }
    });
    var switches = Math.max(0, runs.length - 1);
    var longest = runs.reduce(function (m, r) { return Math.max(m, r.len); }, 0);
    return { known: true, seq: seq, switches: switches, runs: runs, longestRun: longest, latest: runs.length ? runs[runs.length - 1].theme : '' };
  }

  /* -------------------------------------------------------------- 形态库 */
  /* 开放形态库(非穷举): 每条规则给出命中理由; 全部未命中时走兜底条款。 */
  var FORMS = [
    {
      tag: '主题坚守型',
      test: function (m) { return m.theme.known && m.theme.switches <= 1 && m.theme.longestRun >= m.n * 0.6; },
      reasons: function (m) {
        return ['主导主题在 ' + m.n + ' 期中仅切换 ' + m.theme.switches + ' 次: ' +
          m.theme.runs.map(function (r) { return r.theme + '(' + r.len + ' 期)'; }).join(' → ') +
          '; 后半段主线未变',
          '相邻期前十平均留存 ' + fx(m.avgRetained, 1) + '/10, 属于换股不换赛道的持有方式'];
      }
    },
    {
      tag: '低换手长期持有型',
      test: function (m) { return m.avgAdded <= 2 && m.avgRetained >= 8 && m.maxStreak >= 6; },
      reasons: function (m) {
        return ['相邻期平均仅新进 ' + fx(m.avgAdded, 1) + ' 只, 平均留存 ' + fx(m.avgRetained, 1) + '/10',
          '最长连续在榜 ' + m.maxStreak + ' 期(' + m.longestHolder + '), 持股周期以年计'];
      }
    },
    {
      tag: '高频轮动型',
      test: function (m) { return m.avgAdded >= 4 || m.avgJaccard <= 0.45; },
      reasons: function (m) {
        return ['相邻期平均新进 ' + fx(m.avgAdded, 1) + ' 只, 平均 Jaccard 相似度 ' + fx(m.avgJaccard, 2),
          '前十名单约每 ' + fx(m.avgRetained ? 10 / Math.max(0.1, m.avgAdded) : null, 1) + ' 期换一遍, 换手显著高于被动持有'];
      }
    },
    {
      tag: '主题漂移型',
      test: function (m) { return m.theme.known && m.theme.switches >= 3 && m.avgAdded >= 2; },
      reasons: function (m) {
        return ['主导主题切换 ' + m.theme.switches + ' 次: ' + m.theme.runs.map(function (r) { return r.theme; }).join(' → '),
          '主题更换伴随前十名单更替(平均新进 ' + fx(m.avgAdded, 1) + ' 只/期), 属于赛道级调仓而非个股微调'];
      }
    },
    {
      tag: '逐步集中型',
      test: function (m) { return m.conc.slope !== null && m.conc.slope >= 0.3; },
      reasons: function (m) {
        return ['前十合计权重最小二乘斜率 ' + fx(m.conc.slope, 2) + 'pp/期(首期 ' + fx(m.conc.first) + '% → 末期 ' + fx(m.conc.latest) +
          '%, 全期区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%)',
          '斜率与端点同向向上, 组合对少数标的的依赖度在上升'];
      }
    },
    {
      tag: '逐步分散型',
      test: function (m) { return m.conc.slope !== null && m.conc.slope <= -0.3; },
      reasons: function (m) {
        return ['前十合计权重最小二乘斜率 ' + fx(m.conc.slope, 2) + 'pp/期(首期 ' + fx(m.conc.first) + '% → 末期 ' + fx(m.conc.latest) +
          '%, 全期区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%)',
          '整体重心下移; 注意斜率与端点可能不同向(末段回升时会出现"首期<末期但斜率为负"), 需结合留存数据区分是主动分散还是规模变化稀释'];
      }
    },
    {
      tag: '高集中赌注型',
      test: function (m) { return m.conc.avg >= 75; },
      reasons: function (m) {
        return ['前十合计权重全期均值 ' + fx(m.conc.avg) + '%(区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%)',
          '组合几乎等于"前十只股票的组合", 个股风险即为组合风险'];
      }
    },
    {
      tag: '均衡分散型',
      test: function (m) { return m.conc.avg <= 55; },
      reasons: function (m) { return ['前十合计权重全期均值仅 ' + fx(m.conc.avg) + '%, 单票权重普遍低于 ' + fx(m.leader.avg) + '%']; }
    },
    {
      tag: '单一重仓依赖型',
      test: function (m) { return m.leader.max >= 9.7 || m.leader.avg >= 9.0; },
      reasons: function (m) {
        return ['第一大重仓权重均值 ' + fx(m.leader.avg) + '%, 最高 ' + fx(m.leader.max) + '%(已贴近公募"双十"约束的单票上限)',
          '第一大重仓接近上限, 单一个股的判断错误会直接体现在净值上'];
      }
    },
    {
      tag: '个股稳定 + 主题切换型',
      test: function (m) { return m.avgRetained >= 8 && m.theme.known && m.theme.switches >= 2; },
      reasons: function (m) {
        return ['前十名单稳定(平均留存 ' + fx(m.avgRetained, 1) + '/10), 但主导主题归类切换 ' + m.theme.switches + ' 次',
          '两种可能: ①同一批公司被重新归类; ②个股不动而赛道叙事变化 —— 需人工复核主题归类口径'];
      }
    }
  ];

  /* ------------------------------------------------------------ 主分析入口 */
  FC.analyze = function (dataset, inputMeta) {
    inputMeta = inputMeta || {};
    var quarters = (dataset.quarters || []).filter(function (q) { return q.top10 && q.top10.length; });
    var fund = dataset.fund || {};
    var perf = dataset.perf || null;
    var nQ = quarters.length;

    if (!nQ) {
      return { error: '没有可用的持仓数据: 至少需要 1 个报告期的前十大持仓。', fund: fund, quarterCount: 0 };
    }

    /* ---- 集中度 */
    var concSeries = quarters.map(function (q) {
      var calc = sum((q.top10 || []).map(function (h) { return h.weight || 0; }));
      return { period: q.period, value: q.top10Sum !== null && q.top10Sum !== undefined ? q.top10Sum : Math.round(calc * 100) / 100, computed: Math.round(calc * 100) / 100 };
    });
    var concVals = concSeries.map(function (x) { return x.value; });
    var conc = {
      series: concSeries, avg: mean(concVals), min: Math.min.apply(null, concVals), max: Math.max.apply(null, concVals),
      first: concVals[0], latest: concVals[concVals.length - 1], slope: slope(concVals)
    };
    conc.trend = conc.slope === null ? '样本不足' : (conc.slope >= 0.3 ? '逐步集中' : conc.slope <= -0.3 ? '逐步分散' : '基本走平');

    /* ---- 换手 / 留存 */
    var churns = churnOf(quarters);
    var holderIdx = buildHolderIndex(quarters);
    var longestHolder = Object.keys(holderIdx).sort(function (a, b) { return holderIdx[b].maxStreak - holderIdx[a].maxStreak; })[0];

    /* ---- 主题 */
    var theme = themeOf(quarters);

    /* ---- 龙头 */
    var top1 = quarters.map(function (q) { var t = (q.top10 || [])[0]; return t ? t.weight : null; });
    var top1v = top1.filter(function (x) { return x !== null; });
    var leader = { series: quarters.map(function (q, i) { var t = (q.top10 || [])[0]; return { period: q.period, name: t ? t.name : '', weight: t ? t.weight : null }; }), avg: mean(top1), max: top1v.length ? Math.max.apply(null, top1v) : null, latest: top1[top1.length - 1] };

    /* ---- 规模 */
    var aumSeries = quarters.map(function (q) { return { period: q.period, value: n(q.aum) }; });
    var aumVals = aumSeries.map(function (x) { return x.value; }).filter(function (x) { return x !== null; });
    var scale = aumVals.length ? {
      series: aumSeries, first: aumVals[0], end: aumVals[aumVals.length - 1],
      peak: Math.max.apply(null, aumVals), trough: Math.min.apply(null, aumVals),
      peakPeriod: (aumSeries.filter(function (x) { return x.value === Math.max.apply(null, aumVals); })[0] || {}).period,
      changePct: aumVals[0] ? (aumVals[aumVals.length - 1] / aumVals[0] - 1) * 100 : null,
      peakToEndPct: Math.max.apply(null, aumVals) ? (aumVals[aumVals.length - 1] / Math.max.apply(null, aumVals) - 1) * 100 : null
    } : null;

    /* ---- 个体持仓画像 */
    var holders = Object.keys(holderIdx).map(function (k) { return holderIdx[k]; })
      .sort(function (a, b) { return b.count - a.count || (b.maxWeight || 0) - (a.maxWeight || 0); });

    var maxStreak = 0;
    Object.keys(holderIdx).forEach(function (k) { maxStreak = Math.max(maxStreak, holderIdx[k].maxStreak); });

    var m = {
      n: nQ,
      conc: conc,
      churn: churns,
      avgRetained: mean(churns.map(function (c) { return c.retained; })),
      avgAdded: mean(churns.map(function (c) { return c.added.length; })),
      avgJaccard: mean(churns.map(function (c) { return c.jaccard; })),
      theme: theme,
      leader: leader,
      scale: scale,
      holders: holders,
      maxStreak: maxStreak,
      longestHolder: longestHolder ? longestHolder + '(连续 ' + holderIdx[longestHolder].maxStreak + ' 期)' : '—',
      totalDistinct: holders.length
    };

    /* ---- 形态判定 */
    var scored = FORMS.map(function (f) {
      var ok = false;
      try { ok = !!f.test(m); } catch (e) { ok = false; }
      return { tag: f.tag, hit: ok, reasons: ok ? f.reasons(m) : [] };
    });
    var hits = scored.filter(function (s) { return s.hit; });
    var form;
    if (nQ < 4) {
      form = { tag: '样本不足(未归类)', confidence: '低', reasons: ['报告期仅 ' + nQ + ' 期, 不足以判定形态; 至少需 4 期'], alternatives: [] };
    } else if (!hits.length) {
      form = {
        tag: '未归类形态(走兜底条款)', confidence: '低',
        reasons: ['没有命中已有形态库的任何一条规则 —— 按 SOP 兜底条款, 不强行套标签, 交由人工判断',
          '当前指标向量: 集中度均值 ' + fx(conc.avg) + '% / 平均留存 ' + fx(m.avgRetained, 1) + '/10 / 平均新进 ' + fx(m.avgAdded, 1) + ' 只 / 主题切换 ' + (theme.known ? theme.switches : '未归类')],
        alternatives: []
      };
    } else {
      form = {
        tag: hits[0].tag,
        confidence: hits.length === 1 ? '中高' : '中',
        reasons: hits[0].reasons,
        alternatives: hits.slice(1).map(function (h) { return h.tag; })
      };
    }

    /* ---- 绩效层(仅在提供了净值/收益口径时) */
    var perfLayer = null;
    if (perf) {
      var singleQuarterShare = (perf.cumReturn && perf.exBestQuarter !== null && perf.cumReturn !== 0)
        ? (perf.cumReturn - perf.exBestQuarter) / perf.cumReturn * 100 : null;
      perfLayer = {
        cumReturn: n(perf.cumReturn), exBestQuarter: n(perf.exBestQuarter), bestQuarter: perf.bestQuarter || '',
        maxDrawdown: n(perf.maxDrawdown), aumPeak: n(perf.aumPeak), aumEnd: n(perf.aumEnd),
        bestQuarterContribution: singleQuarterShare,
        concentratedInOneQuarter: singleQuarterShare !== null && singleQuarterShare >= 40,
        note: perf.note || ''
      };
    }

    /* ---- 案例审计(成功 / 失败各一, 披露推算价口径) */
    var cases = buildCases(quarters, holderIdx);

    /* ---- 结论卡 */
    var card = buildCard(fund, quarters, m, form, perfLayer, cases, inputMeta);

    /* ---- 跟踪清单 */
    var trackers = buildTrackers(m, perfLayer);

    /* ---- 口径环境(SOP §0): 人工确认的经理/区间/基准等, 报告第二节要用 ---- */
    var ri = dataset.rangeInfo || {};
    var env = {
      managerLabel: ri.managerLabel || fund.manager || '',
      managerCoManaged: !!ri.managerCoManaged,
      rangeBasis: ri.basis || '',
      rangeHumanConfirmed: !!ri.humanConfirmed,
      rangeAdjusted: !!ri.adjusted,
      dataCutoff: ri.dataCutoffDeclared || ((quarters[nQ - 1] || {}).endDate || ''),
      returnBasis: ri.returnBasisDeclared === 'nav'
        ? '单位净值口径(不复权)'
        : '分红再投总回报指数(单位净值 + 除息日分红回加, 链式相乘)',
      benchmarkDeclared: ri.benchmarkDeclared || fund.benchmark || '',
      benchmarkVerified: (dataset.official && dataset.official.benchmark) || null
    };

    var report = FC.buildReport({
      fund: fund, quarters: quarters, m: m, form: form, perf: perfLayer, cases: cases,
      card: card, trackers: trackers, sources: dataset.sources || [], env: env,
      synthesis: dataset.synthesis || null,
      range: nQ ? quarters[0].period + '–' + quarters[nQ - 1].period : '—'
    });

    return {
      generatedAt: new Date().toISOString(),
      source: inputMeta.source || 'builtin',
      level: perfLayer ? '结构层 + 绩效层' : '仅结构层',
      fund: fund, range: nQ ? quarters[0].period + '–' + quarters[nQ - 1].period : '—',
      quarterCount: nQ, quarters: quarters, metrics: m, form: form,
      perf: perfLayer, cases: cases, card: card, trackers: trackers,
      env: env, synthesis: dataset.synthesis || null, report: report
    };
  };

  /* ------------------------------------------------------------ 案例审计 */
  function buildCases(quarters, holderIdx) {
    var out = { wins: [], fails: [], note: '价格为披露口径推算价(期末公允价值 ÷ 期末持股数), 未做除权除息复权, 不含分红; 仅用于横向比较, 不等于投资者的实际收益。证据级别: 合理推断。' };
    Object.keys(holderIdx).forEach(function (k) {
      var s = holderIdx[k];
      var ps = s.priceSeries.filter(function (p) { return p.price; });
      if (ps.length < 2) return;
      var entry = ps[0], exit = ps[ps.length - 1];
      var chg = (exit.price / entry.price - 1) * 100;
      if (!isFinite(chg)) return;
      var w = { name: s.name, code: s.code, entryPeriod: entry.period, exitPeriod: exit.period, entryPrice: entry.price, exitPrice: exit.price, change: chg, heldQuarters: ps.length, entryWeight: entry.weight, exitWeight: exit.weight, stillHeld: s.lastIdx === quarters.length - 1 };      out.wins.push(w);
    });
    out.wins.sort(function (a, b) { return b.change - a.change; });
    out.fails = out.wins.slice().sort(function (a, b) { return a.change - b.change; });
    return out;
  }

  /* -------------------------------------------------------------- 结论卡 */
  function QUESTION_BY_FORM(tag) {
    var map = {
      '主题坚守型': '这条赛道判断是能力圈内的持续跟踪, 还是赌对了一次周期? 下一期主题不变的情况下, 选股是否还在创造超额?',
      '低换手长期持有型': '长期持有是"看得懂所以拿得住", 还是"规模锁死 + 懒得动"? 换手低的同时, 个股选择质量是否可验证?',
      '高频轮动型': '高换手带来的收益是否覆盖了交易成本与判断失误? 还是只是追着已经涨过的板块跑?',
      '主题漂移型': '换赛道是能力圈扩张, 还是被行情推着走? 每一次切换发生时, 前一个赛道的退出理由能否写成当时可得的证据?',
      '逐步集中型': '集中度上行是"越想越确定", 还是"越跌越加"的被动结果? 需要看加仓时的价格位置与后续表现。',
      '逐步分散型': '分散是被动稀释(赎回/规模变化)还是主动降风险? 用留存数与规模序列区分。',
      '高集中赌注型': '前十只股票几乎等于整个组合, 这个判断体系的赔率是否配得上这个集中度?',
      '均衡分散型': '分散是否以牺牲判断力为代价? 前十大都这么轻, 真正决定收益的是什么?',
      '单一重仓依赖型': '第一大重仓贴近 10% 上限, 这是最高信念还是路径依赖? 该股判断错了组合会怎样?',
      '个股稳定 + 主题切换型': '同一批公司被反复归类到不同主题, 是持仓真的变了, 还是主题归类口径在变? 这直接影响"风格漂移"的判断。'
    };
    return map[tag] || '本项目形态库未覆盖该组合, 需人工建立判断主线: 先确定"好/差"由什么证据定义, 再找可证伪的观察点。';
  }

  function buildCard(fund, quarters, m, form, perfLayer, cases, inputMeta) {
    var range = m.n ? quarters[0].period + '–' + quarters[m.n - 1].period : '—';
    var latest = quarters[m.n - 1] || {};
    var claim = '本基金在 ' + range + '(' + m.n + ' 个报告期)的持仓结构特征为「' + form.tag + '」:' +
      '前十合计权重均值 ' + fx(m.conc.avg) + '%(区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%),' +
      '相邻期平均留存 ' + fx(m.avgRetained, 1) + '/10、平均新进 ' + fx(m.avgAdded, 1) + ' 只,' +
      (m.theme.known ? '主导主题由 ' + (m.theme.runs[0] || {}).theme + ' 演进到 ' + m.theme.latest + '(切换 ' + m.theme.switches + ' 次)。' : '本期数据未提供主题归类。') +
      '该结论仅描述已发生的持仓行为, 不含对未来收益的判断。';

    var tracker0 = '下一期(' + nextPeriod(latest.period) + ')前十留存数 ≥ ' + fx(Math.floor((m.avgRetained || 0) - 2), 0) + ' 只';
    var falsifier = '若下一期出现以下任一情况, 本判断需推翻或降级: ① ' + tracker0 +
      '未达到; ② ' + (m.theme.known ? '主导主题在无公开逻辑变化的情况下再次切换; ' : '主题归类补全后与本期结构不符; ') +
      '③ 集中度突破历史区间(' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%)之外并连续两期不回。';

    return {
      code: fund.code, name: fund.name, manager: fund.manager || '', range: range, quarters: m.n,
      formTag: form.tag, formConfidence: form.confidence,
      mainQuestion: QUESTION_BY_FORM(form.tag),
      claim: claim,
      falsifier: falsifier,
      evidenceLevel: inputMeta.source === 'paste' ? '用户粘贴数据(结构层, 未经官方季报对账)' : '公开季报 + 天天基金 F10(已对账)',
      caveats: [
        '只看前十大持仓, 不是全部持仓(季报仅披露前十)',
        '季报持仓是期末快照, 期间买卖不可见',
        '推算价未复权、不含分红, 不代表真实收益',
        perfLayer ? '绩效为区间口径, 未做基准调整' : '本次未提供净值序列, 不判定绩效形态',
        '不构成投资建议, 不评价基金经理个人'
      ],
      claimNumbers: (claim.match(/[\d.]+/g) || []).length
    };
  }

  function buildTrackers(m, perfLayer) {
    var t = [];
    t.push({ item: '前十名单稳定性', baseline: '历史平均留存 ' + fx(m.avgRetained, 1) + '/10', watch: '下一期留存数低于 ' + fx(Math.floor((m.avgRetained || 0) - 2), 0) + ' 只即视为结构变化' });
    t.push({ item: '集中度', baseline: fx(m.conc.min) + '–' + fx(m.conc.max) + '%(均值 ' + fx(m.conc.avg) + '%)', watch: '连续两期落在区间外' });
    t.push({ item: '第一大重仓', baseline: '均值 ' + fx(m.leader.avg) + '%, 最高 ' + fx(m.leader.max) + '%', watch: '接近 10% 上限需说明理由' });
    if (m.theme.known) t.push({ item: '主导主题', baseline: '当前 ' + m.theme.latest + ', 历史切换 ' + m.theme.switches + ' 次', watch: '再次切换时须能列出切换时点可得证据' });
    if (m.scale) t.push({ item: '规模', baseline: fx(m.scale.first) + ' → ' + fx(m.scale.end) + ' 亿元(峰值 ' + fx(m.scale.peak) + ')', watch: '规模继续下降会改变策略容量与操作空间' });
    if (perfLayer) t.push({ item: '收益集中度', baseline: '单季(' + perfLayer.bestQuarter + ')贡献约占区间收益 ' + fx(perfLayer.bestQuarterContribution) + '%', watch: '剔除该季后的收益 ' + fx(perfLayer.exBestQuarter) + '% 才是可持续性的更保守口径' });
    return t;
  }

  function nextPeriod(p) {
    if (!p) return '下一期';
    var mt = /(\d{4})Q([1-4])/.exec(p);
    if (!mt) return '下一期';
    var y = +mt[1], q = +mt[2];
    q += 1; if (q > 4) { q = 1; y += 1; }
    return y + 'Q' + q;
  }
  FC.nextPeriod = nextPeriod;

  /* ------------------------------------------------------------ 报告生成器 */
  FC.buildReport = function (ctx) {
    var f = ctx.fund, m = ctx.m, form = ctx.form, perf = ctx.perf, cases = ctx.cases, card = ctx.card, tr = ctx.trackers;
    var qs = ctx.quarters;
    var latest = qs[qs.length - 1] || {};
    var prev = qs[qs.length - 2] || {};
    /* 口径环境(SOP §0)统一取 ctx.env, 兼容旧调用方式 */
    var env = ctx.env || {};
    ctx = Object.assign({}, ctx, {
      managerLabel: env.managerLabel, managerCoManaged: env.managerCoManaged,
      rangeBasis: env.rangeBasis, dataCutoff: env.dataCutoff, returnBasis: env.returnBasis,
      rangeAdjusted: env.rangeAdjusted,
      synthesis: ctx.synthesis || null,
      benchmarkDeclared: env.benchmarkDeclared, benchmarkVerified: env.benchmarkVerified
    });

    function num(v, unit, level, src, d) {
      var cls = 'ev ev-' + (level || 'fact');
      return '<span class="' + cls + '" data-src="' + (src || '底稿') + '" title="证据级别: ' + levelName(level) + ' · 来源: ' + (src || '底稿') + '">' + v + (unit || '') + '</span>';
    }
    function levelName(l) { return l === 'infer' ? '合理推断' : l === 'hindsight' ? '事后解读' : '披露事实'; }

    /* 给整节内容里的数字统一打上"证据级别 + 来源"标注。
     * 规则: 年份 / 报告期 / 日期 / 6 位股票代码 属于标识符, 不打标注;
     *       style 等标签内部一律不动(否则会破坏 HTML);
     *       已经显式标注过的(如绩效节的"合理推断")保持原级别不被覆盖。 */
    function wrapNumsAll(html, level, src) {
      var hold = [];
      html = String(html).replace(/<span class="ev [^"]*"[^>]*>[\s\S]*?<\/span>/g, function (m2) {
        hold.push(m2);
        return '\u0000' + 'X'.repeat(hold.length) + '\u0000';
      });
      html = html.replace(/(<[^>]*>)|([^<]+)/g, function (m2, tag, text) {
        if (tag) return tag;
        return text.replace(/(\d{4}Q[1-4])|(\d{4}-\d{2}(?:-\d{2})?)|\b((?:19|20)\d{2})\b|\b(\d{6})\b|(\d+(?:\.\d+)?%?)/g,
          function (mm, per, ym, yr, code6, val) {
            if (per || ym || yr || code6) return mm;
            return '<span class="ev ev-' + level + '" data-src="' + esc(src) + '" title="证据级别: ' + levelName(level) + ' · 来源: ' + esc(src) + '">' + val + '</span>';
          });
      });
      return html.replace(/\u0000(X+)\u0000/g, function (m3, xs) { return hold[xs.length - 1]; });
    }

    var S = [];

    S.push({
      id: 'conclusion', title: '一、先说结论',
      html:
        '<div class="verdict">' +
        '<p class="verdict-line"><strong>形态标签:</strong> ' + esc(form.tag) + ' <span class="tag-conf">置信度 ' + form.confidence + '</span>' + (form.alternatives.length ? ' <span class="tag-alt">次优解释: ' + form.alternatives.join(' / ') + '</span>' : '') + '</p>' +
        '<p class="verdict-line"><strong>主线问题:</strong> ' + esc(card.mainQuestion) + '</p>' +
        '</div>' +
        '<ul class="reason-list">' + form.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<p class="claim-block"><strong>一句话判断(可证伪):</strong> ' + esc(card.claim) + '</p>' +
        '<div class="falsifier"><strong>推翻条件:</strong> ' + esc(card.falsifier) + '</div>'
    });

    S.push({
      id: 'scope', title: '二、口径与证据边界',
      html:
        '<table class="tbl"><tbody>' +
        row('基金', esc(f.name) + '(' + esc(f.code) + ')· ' + esc(f.manager || '—') + (f.managerSince ? ' · ' + esc(f.managerSince) : '')) +
        row('复盘对象', esc(ctx.managerLabel || f.manager || '—') + (ctx.managerCoManaged ? ' <span class="flag">该任期含共管期, 业绩归因不能全归功于单人</span>' : '')) +
        row('复盘区间', esc(ctx.range) + ', 共 ' + m.n + ' 个报告期' + (ctx.rangeBasis ? '<div class="note">区间依据: ' + esc(ctx.rangeBasis) + '</div>' : '') +
          (ctx.rangeAdjusted ? '<div class="flag">⚠ 口径确认表的区间端点无前十大持仓数据, 实际区间已对齐(详见上方说明)</div>' : '')) +
        row('数据截止日', esc(ctx.dataCutoff || (qs[m.n - 1] || {}).endDate || '—')) +
        row('业绩比较基准', benchmarkRow(ctx)) +
        row('收益口径', esc(ctx.returnBasis || '分红再投总回报指数(单位净值 + 除息日分红回加)')) +
        row('数据粒度', '仅前十大持仓(季报口径), 期末快照; 期间买卖不可见') +
        row('本次能算什么', '集中度、留存/换手、主题演进、个体持仓期限、披露口径推算价') +
        row('本次算不了什么', perf ? '基准调整后超额、组合实际换手率(缺全部持仓)、投资者实际收益' : '一切绩效类结论(本次未提供净值序列)') +
        row('证据分级', '<span class="ev ev-fact">披露事实</span> 季报原文与官方数字 · <span class="ev ev-infer">合理推断</span> 由披露值推算 · <span class="ev ev-hindsight">事后解读</span> 事后才成立的叙述, 必须标注') +
        '</tbody></table>' +
        '<p class="note">数据来源: ' + esc(FC.formatSources(ctx.sources).join(' ； ')) + '</p>' +
        '<div class="boundary"><strong>边界与免责声明</strong><ul>' +
        '<li>本报告<strong>只看前十大持仓</strong>(公募基金季报的披露口径), 不是全部持仓; 季报持仓是<strong>期末快照</strong>, 期间买卖不可见。</li>' +
        '<li>报告中的推算价 = 期末公允价值 ÷ 期末持股数, <strong>未复权、不含分红</strong>, 不代表投资者实际收益。</li>' +
        '<li>全文为<strong>回溯复盘</strong>: 只陈述已发生的事实与可验证推断, 不含对未来收益的任何判断。</li>' +
        '<li>数据仅来自公开渠道, 不含任何机构内部数据; <strong>不构成投资建议, 不评价基金经理个人</strong>, 不推荐任何基金。</li>' +
        '<li>证据级别按节适用: <strong>先说结论 / 总成绩也看清代价 / 持仓集中度与骨架 / 持仓轮动主线 / 附录</strong>等节以披露数字为准(披露事实); <strong>方法论拆解 / 关键调仓案例审计 / 跟踪清单与证伪方式</strong>等节含引擎派生值(合理推断), 已在文内逐处标注。</li>' +
        '</ul></div>'
    });

    S.push({
      id: 'performance', title: '三、总成绩也看清代价',
      html: perf ?
        '<table class="tbl"><tbody>' +
        row('区间复利收益', num(fx(perf.cumReturn), '%', 'fact', '官方季报')) +
        row('剔除最好一季(' + esc(perf.bestQuarter) + ')后', num(fx(perf.exBestQuarter), '%', 'infer', '由区间收益与单季收益推算')) +
        row('最好一季贡献占比', num(fx(perf.bestQuarterContribution), '%', 'infer', '推算') + (perf.concentratedInOneQuarter ? ' <span class="flag">收益高度集中于单一季度, 可持续性需单独论证</span>' : '')) +
        row('区间最大回撤', num(fx(perf.maxDrawdown), '%', 'fact', '净值序列')) +
        row('规模', num(fx(perf.aumPeak), ' 亿元', 'fact', '规模序列') + ' → ' + num(fx(perf.aumEnd), ' 亿元', 'fact', '规模序列')) +
        '</tbody></table>' + '<p class="note">' + esc(perf.note) + '</p>' :
        '<p class="gap-block">本次输入未包含净值/收益序列, <strong>不判定绩效形态, 也不给出任何收益结论</strong>。' +
        '结构层结论仍然成立(见下), 但"由好转差 / 由差转好 / 持续优秀 / 持续不佳"这类绩效形态必须补净值后另行判定。' +
        '<br><span class="hint">补法: 在输入页粘贴净值序列, 或使用 <code>fund.eastmoney.com/pingzhongdata/' + esc(f.code) + '.js</code> 获取。</span></p>'
    });

    S.push({
      id: 'conc', title: '四、持仓集中度与骨架',
      html:
        bar('前十合计权重', m.conc.series.map(function (x) { return { label: x.period, value: x.value }; })) +
        '<table class="tbl"><tbody>' +
        row('前十合计(均值)', num(fx(m.conc.avg), '%', 'fact', '季度汇总') + ' · 区间 ' + fx(m.conc.min) + '–' + fx(m.conc.max) + '%') +
        row('趋势', esc(m.conc.trend) + (m.conc.slope !== null ? '(斜率 ' + fx(m.conc.slope, 2) + 'pp/期)' : '')) +
        row('第一大重仓', '均值 ' + fx(m.leader.avg) + '%, 最高 ' + fx(m.leader.max) + '%') +
        row('全期出现过的个股数', m.totalDistinct + ' 只(前十共 ' + (m.n * 10) + ' 个席位)') +
        '</tbody></table>'
    });

    S.push({
      id: 'rotation', title: '五、持仓轮动主线',
      html:
        (m.theme.known ?
          '<p class="lead">主导主题演进: ' + m.theme.runs.map(function (r) { return '<span class="theme-chip">' + esc(r.theme) + '<sub>' + r.len + '期</sub></span>'; }).join('<span class="arrow">→</span>') + '</p>' : '') +
        '<table class="tbl tbl-compact"><thead><tr><th>报告期</th><th>前十合计</th><th>留存</th><th>新进</th><th>退出</th><th>主题</th></tr></thead><tbody>' +
        qs.map(function (q, i) {
          var c = m.churn[i - 1];
          return '<tr><td>' + q.period + '</td><td>' + fx(q.top10Sum) + '%</td><td>' + (c ? c.retained + '/10' : '—') + '</td><td class="cell-in">' + (c ? esc(c.added.join('、')) || '—' : '—') + '</td><td class="cell-out">' + (c ? esc(c.dropped.join('、')) || '—' : '—') + '</td><td>' + esc(q.theme || '—') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="note">相邻期平均留存 ' + fx(m.avgRetained, 1) + '/10, 平均新进 ' + fx(m.avgAdded, 1) + ' 只, 平均 Jaccard ' + fx(m.avgJaccard, 2) + '。留存率是"换手强度"的代理指标, 但不等于换手率(只看前十)。</p>'
    });

    S.push({
      id: 'method', title: '六、方法论拆解',
      html:
        '<div class="grid2">' +
        methodCard('持股周期', '最长连续在榜 ' + esc(m.longestHolder) + '；前十共出现过 ' + m.totalDistinct + ' 只股票,' +
          '平均每期 ' + fx(m.n ? m.totalDistinct / m.n : null, 1) + ' 只新面孔 —— 持股周期是判断"这套打法靠什么赚钱"的第一把尺子。') +
        methodCard('估值与择时痕迹', '披露口径推算价显示, 退出前十的个股中有 ' + cases.fails.filter(function (c) { return c.change < 0; }).length +
          ' 只在持有期内推算价下跌、' + cases.wins.filter(function (c) { return c.change > 0; }).length + ' 只上涨。' +
          '注意: 这是"事后可观测"的结果, 不等于经理当时在做择时。') +
        methodCard('组合构建', '集中度均值 ' + fx(m.conc.avg) + '%, 方向为「' + esc(m.conc.trend) + '」。' +
          '前十权重分布决定组合是"押注"还是"配置"。') +
        methodCard('能力圈', (m.theme.known ? '主题集中度: ' + esc(m.theme.runs.map(function (r) { return r.theme + '(' + r.len + '期)'; }).join('、')) : '主题归类缺失, 无法评估能力圈边界 —— 这正是 AI 模块"主题归类"任务的用武之地。')) +
        '</div>'
    });

    S.push({
      id: 'cases', title: '七、关键调仓案例审计',
      html:
        '<p class="lead">取持有期推算价变动最高与最低各三例。价格为披露口径推算价(公允价值 ÷ 持股数), 未复权、不含分红, 证据级别: <span class="ev ev-infer">合理推断</span>。</p>' +
        '<h4>持有期推算价表现靠前</h4>' + caseTable(cases.wins.slice(0, 3)) +
        '<h4>持有期推算价表现靠后</h4>' + caseTable(cases.fails.slice(0, 3)) +
        '<p class="note">' + esc(cases.note) + '</p>'
    });

    S.push({
      id: 'latest', title: '八、最新一期结构与变化',
      html:
        '<div class="grid2">' +
        '<div><h4>' + esc(latest.period) + ' 前十大</h4>' + holdingsTable(latest.top10) + '</div>' +
        '<div><h4>' + esc(prev.period) + ' → ' + esc(latest.period) + ' 变动</h4>' + diffTable(prev, latest) + '</div>' +
        '</div>'
    });

    /* 第九节由大模型生成(T4)。没有通过校验的输出时**整节不出现** ——
       不用套话填充, 这是用户明确要求过的。 */
    if (ctx.synthesis && ((ctx.synthesis.replicable || []).length || (ctx.synthesis.risks || []).length)) {
      var syn = ctx.synthesis;
      S.push({
        id: 'strength', title: '九、可复制的方法 × 不能被神化的部分',
        html:
          '<div class="grid2">' +
          '<div class="card-good"><h4>可复制的方法</h4><ul>' +
          (syn.replicable || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
          '</ul></div>' +
          '<div class="card-risk"><h4>不能被神化的部分</h4><ul>' +
          (syn.risks || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
          '</ul></div>' +
          '</div>' +
          (syn.basis ? '<p class="note">本节依据: ' + esc(syn.basis) + '</p>' : '') +
          '<p class="note">本节由大模型基于本次复盘的指标、案例与边界生成; 每条都已通过<strong>数字回查</strong>(条目里的数字必须能在本次指标包里找到)与<strong>前瞻禁用</strong>检查, 未通过则整节不展示。</p>'
      });
    }

    S.push({
      id: 'track', title: '十、跟踪清单与证伪方式',
      html:
        '<table class="tbl"><thead><tr><th>观察项</th><th>当前基线</th><th>触发条件</th></tr></thead><tbody>' +
        tr.map(function (t) { return '<tr><td>' + esc(t.item) + '</td><td>' + esc(t.baseline) + '</td><td>' + esc(t.watch) + '</td></tr>'; }).join('') +
        '</tbody></table>' +
        '<p class="note">跟踪清单的作用是: 下一期报告只需核对这几行, 就能说清"判断被证实还是被推翻", 而不是每次重新讲故事。</p>'
    });

    S.push({
      id: 'appendix', title: '十一、附录 · 逐期前十大索引',
      html: '<div class="appendix">' + qs.map(function (q) {
        return '<div class="apx-q"><div class="apx-h">' + q.period + ' <span>' + fx(q.top10Sum) + '%</span></div>' +
          '<div class="apx-l">' + (q.top10 || []).map(function (h) { return esc(h.name) + '<sub>' + fx(h.weight, 1) + '</sub>'; }).join(' · ') + '</div></div>';
      }).join('') + '</div>'
    });

    /* 逐节默认证据级别: 该节里的数字主要由什么性质的量构成 */
    var SECTION_LEVEL = {
      conclusion: ['fact', '持仓底稿'],
      scope: ['fact', '公开季报'],
      performance: ['fact', '官方季报'],
      conc: ['infer', '由披露值推算'],
      rotation: ['fact', '公开季报'],
      method: ['infer', '由披露值推算'],
      cases: ['infer', '披露口径推算价'],
      latest: ['fact', '公开季报'],
      strength: ['infer', '综合分析'],
      track: ['infer', '由披露值推算'],
      appendix: ['fact', '公开季报']
    };
    S.forEach(function (s) {
      var L = SECTION_LEVEL[s.id] || ['fact', '底稿'];
      s.html = wrapNumsAll(s.html, L[0], L[1]);
      s.evLevel = L[0];
      s.evSource = L[1];
    });

    /* 章节序号一律**按在数组里的顺序生成**, 不认上面每个 title 里手写的序号 —— 2026-10-10 修。
       原因: 第九节「可复制的方法 × 不能被神化的部分」由大模型综述(T4)生成, 没有通过校验时
       **整节不出现**(用户明确要求过: 不用套话填充)。手写序号不会跟着挪, 于是报告里就出现
       「八、最新一期结构与变化」直接跳到「十、跟踪清单与证伪方式」, 看起来像缺了一节。
       现在不管实际几节, 序号都从 一到 N 连续; title 里的中文序号只是源码里的可读写法, 会被这里覆盖。
       s.name 保留"不带序号"的章节名, 给"对序号不敏感"的用途(报错信息、断言语义)。 */
    var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    S.forEach(function (s, i) {
      var name = String(s.title || '').replace(/^\s*(?:第)?(?:[一二三四五六七八九十百零]{1,3}|\d{1,2})\s*[、.．,，:：]\s*/, '');
      s.name = name;
      s.title = (CN_NUM[i] || String(i + 1)) + '、' + name;
    });

    return { sections: S, meta: { generatedAt: new Date().toISOString(), range: ctx.range, quarterCount: m.n } };
  };

  /* --------------------------------------------------------------- 片段 */
  function row(k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }

  /** 业绩比较基准这一行 —— SOP §0 要求"从季报抄;中途调整过要标注"。
   *  以前这一格抓了却没用(报告里 0 次出现), 属于静默丢弃, 现在补上并做变更标注。 */
  function benchmarkRow(ctx) {
    var declared = ctx.benchmarkDeclared || '';      // 人在口径确认表里确认的值
    var verified = ctx.benchmarkVerified || null;    // 从官方季报 PDF 抽到的(含变更检测)
    if (!declared && !verified) return '<span class="flag">未取到 —— 请从季报的"基金产品概况"一节抄录后重跑</span>';

    var out = esc(declared || (verified && verified.latest) || '');
    var notes = [];
    if (verified && verified.samples && verified.samples.length) {
      notes.push('已用 ' + verified.samples.length + ' 期官方季报 PDF 复核: ' +
        verified.samples.map(function (s) { return s.period + '「' + s.value + '」'; }).join('、'));
    }
    if (verified && verified.changed) {
      out += ' <span class="flag">⚠ 区间内调整过</span>';
      notes.push('<strong>调整记录:</strong> ' + (verified.changes || []).map(esc).join('；') +
        ' —— SOP 要求标注: 跨期比较非完全同口径, 报告中的收益/回撤不构成基准调整后的超额。');
    } else if (verified) {
      notes.push('抽样期内基准未发生变化。');
    }
    if (declared && verified && verified.latest && declared.replace(/\s/g, '') !== String(verified.latest).replace(/\s/g, '')) {
      notes.push('<span class="ev ev-infer">人工确认值与季报复核值文字不一致</span>, 已以人工确认值为准并保留季报原文供核对。');
    }
    return out + (notes.length ? '<div class="note">' + notes.join('<br>') + '</div>' : '');
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  FC.esc = esc;

  function holdingsTable(list) {
    return '<table class="tbl tbl-compact"><thead><tr><th>#</th><th>股票</th><th>代码</th><th>权重</th><th>推算期末价</th></tr></thead><tbody>' +
      (list || []).map(function (h) {
        return '<tr><td>' + h.rank + '</td><td>' + esc(h.name) + '</td><td class="mono">' + esc(h.code) + '</td><td>' + fx(h.weight) + '%</td><td>' + (impliedPrice(h) ? fx(impliedPrice(h)) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function diffTable(prev, latest) {
    var pm = {}, lm = {};
    (prev.top10 || []).forEach(function (h) { pm[keyOf(h)] = h; });
    (latest.top10 || []).forEach(function (h) { lm[keyOf(h)] = h; });
    var keys = Object.keys(lm).concat(Object.keys(pm).filter(function (k) { return !lm[k]; }));
    return '<table class="tbl tbl-compact"><thead><tr><th>股票</th><th>代码</th><th>上期</th><th>本期</th><th>变化</th><th>状态</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var a = pm[k], b = lm[k];
        var d = a && b ? b.weight - a.weight : null;
        var st = !a ? '<span class="s-in">新进</span>' : !b ? '<span class="s-out">退出</span>' : (Math.abs(d) < 0.05 ? '持平' : d > 0 ? '<span class="s-up">加仓</span>' : '<span class="s-down">减仓</span>');
        var codeTxt = (b || a).code || '';
        return '<tr><td>' + esc((b || a).name) + '</td><td class="mono">' + esc(codeTxt) + '</td><td>' + (a ? fx(a.weight) + '%' : '—') + '</td><td>' + (b ? fx(b.weight) + '%' : '—') + '</td><td>' + (d === null ? '—' : (d > 0 ? '+' : '') + fx(d) + 'pp') + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function caseTable(list) {
    if (!list.length) return '<p class="note">无可用案例(需要至少两期披露持股数与市值)。</p>';
    return '<table class="tbl tbl-compact"><thead><tr><th>股票</th><th>进入前十</th><th>推算价</th><th>最后在榜</th><th>推算价</th><th>持有期变动</th><th>期数</th></tr></thead><tbody>' +
      list.map(function (c) {
        var cls = c.change >= 0 ? 'pos' : 'neg';
        return '<tr><td>' + esc(c.name) + '</td><td>' + c.entryPeriod + '</td><td>' + fx(c.entryPrice) + '</td><td>' + c.exitPeriod + (c.stillHeld ? '(仍在榜)' : '') + '</td><td>' + fx(c.exitPrice) + '</td><td class="' + cls + '">' + (c.change > 0 ? '+' : '') + fx(c.change) + '%</td><td>' + c.heldQuarters + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function methodCard(title, body) { return '<div class="mcard"><h4>' + esc(title) + '</h4><p>' + body + '</p></div>'; }

  /** 带纵坐标轴 + 悬停显示的柱状图(纯 CSS, 不依赖脚本, 离线与打印都可用)。
   *  为什么要加轴: 只有相对高度看不出"到底是多少", 用户明确提出过这一点。
   *
   *  定标规则(2026-10-10 用户要求改的): **最高的柱子占画布高度的 80%**, 且纵轴随数据走。
   *  改之前的毛病: 调用方传了 max=100 把纵轴顶死, 而实际数据上限只有 86% 左右 ——
   *  于是纵轴最上面那一段永远用不到, 最高柱只到 ~65%, 整张图像"没长起来"。 */
  function bar(title, series) {
    var vals = series.map(function (s) { return s.value; }).filter(function (v) { return typeof v === 'number'; });
    if (!vals.length) return '<p class="note">' + esc(title) + ': 无可用数据。</p>';
    /* 柱高只看**数据**的上下限。原来还有个 max 参数(调用方传 100 = "权重不可能超过 100%"),
       结果纵轴被顶死、数据上限那一段永远用不到, 最高柱只到 65% —— 已去掉,
       纵轴现在完全跟着数据走(用户要求: 图的比例要随数据比例变)。 */
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var range = hi - lo;
    /* 让最高柱正好 80%, 同时给最矮的柱子留一条可见的余量:
         纵轴跨度 = 1.325 × range, 纵轴底 = lo − 0.06 × range
         → 最高柱 (1 + 0.06) / 1.325 = 80.0%
         → 最矮柱 0.06 / 1.325      = 4.5%(210px 画布里约 9px, 看得见)
       柱高与纵轴刻度**共用同一组 axisLo/axisSpan**, 否则柱子和刻度会对不上。 */
    var axisSpan = range * 1.325;
    var axisLo = lo - range * 0.06;
    var axisHi = axisLo + axisSpan;
    var ticks = 4, axis = [];
    for (var t = ticks; t >= 0; t--) axis.push(axisLo + axisSpan * t / ticks);
    var grid = axis.slice(1).map(function (v, i) {
      return '<div class="cgrid" style="bottom:' + ((i + 1) / ticks * 100) + '%"></div>';
    }).join('');
    var bars = series.map(function (s) {
      var v = typeof s.value === 'number' ? s.value : 0;
      var h = Math.max(0.6, (v - axisLo) / axisSpan * 100);
      return '<div class="cbar' + (v < 0 ? ' cbar-neg' : '') + '" style="height:' + h.toFixed(1) + '%" title="' + esc(s.label) + ' ' + fx(v) + '%">' +
        '<span class="cbv">' + fx(v) + '%</span></div>';
    }).join('');
    return '<div class="chart"><div class="chart-h"><span>' + esc(title) + '</span><span class="chart-scale">' + fx(axisLo, 1) + '% – ' + fx(axisHi, 1) + '%</span></div>' +
      '<div class="chart-plot"><div class="cyaxis">' + axis.map(function (v) { return '<span>' + fx(v, 1) + '%</span>'; }).join('') + '</div>' +
      '<div class="cplot">' + grid + bars + '</div></div>' +
      '<div class="cxaxis">' + series.map(function (s) { return '<span>' + String(s.label).replace(/^20/, '') + '</span>'; }).join('') + '</div></div>';
  }
  FC.bar = bar;

  /** 报告 HTML -> Markdown(供"导出复盘报告"与命令行生成交付物共用) */
  FC.htmlToMd = function (html) {
    return String(html)
      .replace(/<h4>/g, '### ').replace(/<\/h4>/g, '\n')
      .replace(/<li>/g, '- ').replace(/<\/li>/g, '\n')
      .replace(/<\/(p|div|tr|table|ul|h3)>/g, '\n')
      .replace(/<th>/g, ' | ').replace(/<\/th>/g, '')
      .replace(/<td>/g, ' | ').replace(/<\/td>/g, '')
      .replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  /** 把整份报告导出成 Markdown(含口径头与免责尾) */
  FC.reportToMarkdown = function (analysis, extra) {
    extra = extra || {};
    var a = analysis;
    var L = ['# ' + a.fund.name + '(' + a.fund.code + ') 持仓回溯复盘', ''];
    L.push('- 基金经理: ' + (a.fund.manager || '—') + (a.fund.managerSince ? '(' + a.fund.managerSince + ')' : ''));
    L.push('- 复盘区间: ' + a.range + ' · ' + a.quarterCount + ' 个报告期');
    L.push('- 数据口径: 仅前十大持仓(季报口径), 期末快照');
    L.push('- 结论层级: ' + a.level);
    if (extra.generatedBy) L.push('- 生成方式: ' + extra.generatedBy);
    L.push('- 生成时间: ' + new Date().toISOString());
    L.push('');
    a.report.sections.forEach(function (s) {
      L.push('## ' + s.title);
      L.push('');
      L.push(FC.htmlToMd(s.html));
      L.push('');
    });
    L.push('---');
    L.push('');
    L.push('> 全文为回溯复盘: 只陈述已发生的事实与可验证推断, 不含对未来收益的判断, 不构成投资建议, 不评价基金经理个人。');
    L.push('> 数据仅来自公开渠道(公募基金定期报告 / 天天基金 F10), 不含任何机构内部数据。');
    return L.join('\n');
  };

})(window.FC);
