/* 证据包: 把"能核验的公开披露事实"整理成一份结构化材料, 交给 agent 写报告。
 *
 * 为什么要有这一层:
 *   以前是"规则引擎直接拼报告", 出来的是填表, 不是分析。
 *   现在反过来 —— 引擎只负责**算准 + 可核验**, 报告由 agent 写;
 *   而 agent 写出来的每一个数字, 都要能在这份证据包里找到出处, 找不到就是编造。
 *
 * 数据全部来自公开披露: 官方季报 PDF(前十大 / 绩效表 / 经理原话 / 基准) + 第三方接口(规模/申赎/净值)。
 */

const r2 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);

/** 季度网格工具 */
function nextQ(p) { const m = /^(\d{4})Q([1-4])$/.exec(p); if (!m) return null; return (+m[2] === 4) ? `${+m[1] + 1}Q1` : `${m[1]}Q${+m[2] + 1}`; }

/** 链式复利: 把若干期增长率乘起来 */
function chain(returns) {
  var acc = 1, n = 0;
  returns.forEach(r => { if (typeof r === 'number' && isFinite(r)) { acc *= (1 + r / 100); n++; } });
  return n ? r2((acc - 1) * 100) : null;
}

export function buildEvidence(dataset) {
  const qs = dataset.quarters || [];
  const official = dataset.official || null;
  const checks = (official && official.checks) || [];
  const byPeriod = {};
  checks.forEach(c => { byPeriod[c.period] = c; });

  /* ---------- 1. 逐季官方披露(基金/基准/超额) ---------- */
  const quarterly = qs.map(q => {
    const c = byPeriod[q.period];
    const p = c && c.perf && c.perf['过去三个月'];
    return {
      period: q.period, endDate: q.endDate,
      nav: p ? p.nav : null, bench: p ? p.bench : null, excess: p ? p.excess : null,
      top10Sum: q.top10Sum, aum: q.aum, shares: q.shares,
      theme: q.theme || '', hasOfficial: !!c
    };
  });

  /* ---------- 2. 年度表: 取该年 Q4 报告的"过去一年" ---------- */
  const years = [...new Set(qs.map(q => q.period.slice(0, 4)))].sort();
  const annual = [];
  years.forEach(y => {
    const c = byPeriod[`${y}Q4`];
    const p = c && c.perf && c.perf['过去一年'];
    if (p) annual.push({ year: y, nav: p.nav, bench: p.bench, excess: p.excess, source: `${y}Q4 季报 §3.2.1` });
  });
  // 当年的部分年度(用最新一期报告的"过去六个月"近似半年, 只在最后一年补)
  const lastP = qs[qs.length - 1];
  if (lastP) {
    const c = byPeriod[lastP.period];
    const half = c && c.perf && c.perf['过去六个月'];
    if (half && !annual.some(a => a.year === lastP.period.slice(0, 4))) {
      annual.push({ year: lastP.period.slice(0, 4) + 'H1', nav: half.nav, bench: half.bench, excess: half.excess, source: `${lastP.period} 季报 §3.2.1 过去六个月` });
    }
  }

  /* ---------- 3. 区间合计 ----------
     两条口径都要给, 并指明该用哪条:
     · 官方逐季链式: 每期都是官方披露值, 但**只要有一期报告缺失(实测 519191 缺 2021Q3),
       链式就会系统性低估**，所以不能直接当头条数字;
     · 分红再投指数: 覆盖全部报告期, 逐季与官方披露偏差 0.00–0.01pp(已校准), 用它当头条。 */
  const navChained = chain(quarterly.map(q => q.nav));
  const benchChained = chain(quarterly.map(q => q.bench));
  const missingPerf = quarterly.filter(q => typeof q.nav !== 'number').map(q => q.period);
  const pd = dataset.perfDetail || {};
  const rets = quarterly.filter(q => typeof q.nav === 'number');
  let best = null;
  rets.forEach(q => { if (!best || q.nav > best.nav) best = q; });
  const exBest = best ? r2((1 + navChained / 100) / (1 + best.nav / 100) * 100 - 100) : null;

  const headline = (typeof pd.cumReturn === 'number') ? pd.cumReturn : navChained;
  const headlineEx = (typeof pd.exBestQuarter === 'number') ? pd.exBestQuarter : exBest;
  const bestShare = (best && headline) ? r2((headline - headlineEx) / headline * 100) : null;

  const period = {
    range: dataset.fund.range,
    quarters: qs.length,
    quartersWithOfficialPerf: rets.length,
    /** 头条口径: 分红再投总回报指数(覆盖全部报告期; 逐季与官方披露偏差 ≤0.01pp) */
    nav: headline,
    exBestQuarter: headlineEx,
    maxDrawdown: (typeof pd.maxDrawdown === 'number') ? pd.maxDrawdown : null,
    maxDrawdownAt: pd.maxDrawdownAt || null,
    /** 交叉校验口径: 官方逐季披露值链式 —— 若与头条口径差 >1pp, 通常是某期报告缺失 */
    navChainedOfficial: navChained,
    benchChainedOfficial: benchChained,
    chainedMissingPeriods: missingPerf,
    chainedGapPp: (typeof pd.cumReturn === 'number' && navChained !== null) ? r2(pd.cumReturn - navChained) : null,
    excessVsBench: (navChained !== null && benchChained !== null && missingPerf.length === 0)
      ? r2(((1 + navChained / 100) / (1 + benchChained / 100) - 1) * 100) : null,
    bestQuarter: best ? best.period : null, bestQuarterReturn: best ? best.nav : null,
    bestQuarterContribution: bestShare,
    aumPeak: (dataset.perf && dataset.perf.aumPeak) || null,
    aumEnd: (dataset.perf && dataset.perf.aumEnd) || null,
    method: '区间收益 = 分红再投总回报指数(单位净值 + 除息日分红回加), 自第一个报告期的期初起算; ' +
      '逐季收益与官方季报"过去三个月"净值增长率逐期校准(偏差 ≤0.01pp); ' +
      '最大回撤按区间内日频指数计算。' +
      (missingPerf.length ? ` 注: 官方逐季链式口径为 ${navChained}%(因 ${missingPerf.join('、')} 报告缺失而偏低), 不作为头条数字。` : '')
  };

  /* ---------- 4. 规模与申赎轨迹 ---------- */
  const scale = qs.map(q => {
    const c = dataset.crawlLog ? null : null;
    return {
      period: q.period, aum: q.aum, shares: q.shares,
      stockPos: q.stockPos, cashPos: q.cashPos, aumChange: q.aumChange || '',
      purchase: (q.purchase !== undefined ? q.purchase : null),
      redeem: (q.redeem !== undefined ? q.redeem : null)
    };
  });
  const aums = scale.map(s => s.aum).filter(x => typeof x === 'number');
  const peakIdx = aums.length ? scale.findIndex(s => s.aum === Math.max(...aums)) : -1;
  const scaleSummary = aums.length ? {
    first: aums[0], peak: Math.max(...aums), peakPeriod: scale[peakIdx] ? scale[peakIdx].period : null,
    end: aums[aums.length - 1],
    peakToEndPct: r1((aums[aums.length - 1] / Math.max(...aums) - 1) * 100)
  } : null;

  /* ---------- 5. 持仓轮动 ---------- */
  const holdings = qs.map((q, i) => {
    const prev = qs[i - 1];
    var added = [], dropped = [];
    if (prev) {
      const pk = {}; (prev.top10 || []).forEach(h => pk[h.code || h.name] = h);
      const ck = {}; (q.top10 || []).forEach(h => ck[h.code || h.name] = h);
      added = Object.keys(ck).filter(k => !pk[k]).map(k => ({ name: ck[k].name, weight: ck[k].weight }));
      dropped = Object.keys(pk).filter(k => !ck[k]).map(k => ({ name: pk[k].name, weight: pk[k].weight }));
    }
    return {
      period: q.period, top10Sum: q.top10Sum, theme: q.theme || '',
      top10: (q.top10 || []).map(h => ({ name: h.name, weight: h.weight })),
      retained: prev ? (q.top10 || []).filter(h => (prev.top10 || []).some(p => (p.code || p.name) === (h.code || h.name))).length : null,
      added, dropped
    };
  });

  /* ---------- 6. 阶段划分(按主导主题连续段) ---------- */
  const phases = [];
  holdings.forEach(h => {
    const t = h.theme || '未归类';
    const cur = phases[phases.length - 1];
    if (cur && cur.theme === t) { cur.to = h.period; cur.periods.push(h.period); }
    else phases.push({ theme: t, from: h.period, to: h.period, periods: [h.period] });
  });
  phases.forEach(ph => {
    const rows = quarterly.filter(q => ph.periods.indexOf(q.period) >= 0);
    ph.len = ph.periods.length;
    ph.navChained = chain(rows.map(r => r.nav));
    ph.benchChained = chain(rows.map(r => r.bench));
    ph.top10SumRange = [Math.min(...rows.map(r => r.top10Sum).filter(x => typeof x === 'number')), Math.max(...rows.map(r => r.top10Sum).filter(x => typeof x === 'number'))];
    ph.firstMove = holdings.find(h => h.period === ph.from);
  });

  /* ---------- 7. 言行对照: 每期经理原话 × 下一期实际动作 ---------- */
  const talkBy = {};
  ((official && official.talks) || []).forEach(t => { talkBy[t.period] = t; });
  const talkCheck = qs.map((q, i) => {
    const t = talkBy[q.period];
    const nxt = holdings[i + 1];
    if (!t || !nxt) return null;
    return {
      period: q.period,
      said: String(t.text || '').replace(/\s+/g, ' ').slice(0, 420),
      url: t.url,
      nextPeriod: nxt.period,
      nextAdded: nxt.added.map(x => `${x.name}(${x.weight}%)`),
      nextDropped: nxt.dropped.map(x => `${x.name}(${x.weight}%)`),
      nextRetained: nxt.retained,
      nextTop10Sum: nxt.top10Sum
    };
  }).filter(Boolean);

  /* ---------- 8. 成败案例(披露口径推算价) ---------- */
  const cases = {
    note: '推算价 = 期末公允价值 ÷ 期末持股数, 未复权、不含分红; 证据级别: 合理推断',
    wins: ((dataset.cases || []).wins || []).slice(0, 5).map(c => ({ name: c.name, code: c.code, entryPeriod: c.entryPeriod, exitPeriod: c.exitPeriod, entryPrice: r2(c.entryPrice), exitPrice: r2(c.exitPrice), change: r2(c.change), heldQuarters: c.heldQuarters, stillHeld: c.stillHeld })),
    fails: ((dataset.cases || []).fails || []).slice(0, 5).map(c => ({ name: c.name, code: c.code, entryPeriod: c.entryPeriod, exitPeriod: c.exitPeriod, entryPrice: r2(c.entryPrice), exitPrice: r2(c.exitPrice), change: r2(c.change), heldQuarters: c.heldQuarters, stillHeld: c.stillHeld }))
  };

  /* ---------- 9. 对账与来源 ---------- */
  const okCount = checks.filter(c => c.reconcile && c.reconcile.ok).length;
  const maxDiff = checks.reduce((m, c) => Math.max(m, (c.reconcile && c.reconcile.maxWeightDiff) || 0), 0);
  const officialRows = checks.reduce((s, c) => s + (c.parsedRows || 0), 0);
  const reconciliation = {
    fetched: checks.length,
    reconciled: okCount,
    officialRows,
    maxWeightDiff: r2(maxDiff),
    missingReports: (official && official.missingReports) || [],
    benchmarkChanged: !!(official && official.benchmark && official.benchmark.changed),
    benchmarkChangeNote: official && official.benchmark ? (official.benchmark.changes || []) : [],
    note: `复盘区间内 ${okCount}/${checks.length} 期官方报告逐行对账一致, 共比对 ${officialRows} 行官方持仓, 权重最大差 ${r2(maxDiff)}pp`
  };

  return {
    schema: 'fundclinic/evidence/1',
    builtAt: new Date().toISOString(),
    meta: {
      code: dataset.fund.code, name: dataset.fund.name, fullName: dataset.fund.fullName,
      company: dataset.fund.company, type: dataset.fund.type,
      manager: dataset.rangeInfo && dataset.rangeInfo.managerLabel ? dataset.rangeInfo.managerLabel : dataset.fund.manager,
      managerTenure: dataset.rangeInfo ? { start: dataset.rangeInfo.managerStart, end: dataset.rangeInfo.managerEnd, coManaged: dataset.rangeInfo.managerCoManaged } : null,
      managersAll: (dataset.managerHistory || []).map(m => ({ start: m.start, end: m.end, managers: m.managers, coManaged: m.coManaged, tenure: m.tenure, returnPct: m.returnPct })),
      range: dataset.fund.range, quarters: qs.length,
      dataCutoff: (qs[qs.length - 1] || {}).endDate,
      benchmark: (dataset.rangeInfo && dataset.rangeInfo.benchmarkDeclared) || dataset.fund.benchmark || '',
      benchmarkDeclared: dataset.fund.benchmark || '',
      rangeBasis: dataset.rangeInfo ? dataset.rangeInfo.basis : ''
    },
    period, annual, quarterly, scale, scaleSummary, holdings, phases, talkCheck, cases, reconciliation,
    sources: (dataset.sources || []).map(s => ({ type: s.type, url: s.url, fetchedAt: s.fetchedAt, extra: s.period || (s.points ? s.points + ' 个交易日' : '') || (s.quarters ? s.quarters + ' 期' : '') || (s.rows ? s.rows + ' 行' : '') || '' })),
    /** 给"数字回查"用的白名单: agent 写的报告里出现的数字, 必须能在这里找到 */
    allowedNumbers: buildAllowedNumbers({ quarterly, annual, period, scale, scaleSummary, holdings, phases, cases, reconciliation })
  };
}

function buildAllowedNumbers(E) {
  const s = {};
  const add = v => { if (typeof v === 'number' && isFinite(v)) { [v, -v, Math.abs(v)].forEach(x => { s[x.toFixed(2)] = 1; s[x.toFixed(1)] = 1; s[x.toFixed(0)] = 1; s[String(Math.round(x))] = 1; }); } };
  // 结构性常数
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 25, 50, 100].forEach(add);
  E.quarterly.forEach(q => { add(q.nav); add(q.bench); add(q.excess); add(q.top10Sum); add(q.aum); add(q.shares); (q.top10 || []).forEach(h => add(h.weight)); });
  E.annual.forEach(a => { add(a.nav); add(a.bench); add(a.excess); });
  Object.keys(E.period).forEach(k => add(E.period[k]));
  E.scale.forEach(x => { add(x.aum); add(x.shares); add(x.stockPos); add(x.cashPos); add(x.purchase); add(x.redeem); });
  if (E.scaleSummary) Object.keys(E.scaleSummary).forEach(k => add(E.scaleSummary[k]));
  E.holdings.forEach(h => { add(h.retained); add(h.top10Sum); (h.top10 || []).forEach(x => add(x.weight)); (h.added || []).forEach(x => add(x.weight)); (h.dropped || []).forEach(x => add(x.weight)); });
  E.phases.forEach(p => { add(p.len); add(p.navChained); add(p.benchChained); (p.top10SumRange || []).forEach(add); });
  E.cases.wins.concat(E.cases.fails).forEach(c => { add(c.change); add(c.entryPrice); add(c.exitPrice); add(c.heldQuarters); });
  Object.keys(E.reconciliation).forEach(k => add(E.reconciliation[k]));

  /* 兜底也是最强的语义: "可溯源" = 这个数字**出现在证据包文本里**。
     证据包本身(基准条款"沪深300×50%"、口径说明里的"偏差 ≤0.01pp"等)含的数字当然算有出处。
     比逐字段枚举稳得多 —— 少枚举一个字段就会误报编造。 */
  try {
    const dump = JSON.stringify({ meta: E.meta, period: E.period, annual: E.annual, quarterly: E.quarterly, scale: E.scale, scaleSummary: E.scaleSummary, holdings: E.holdings, phases: E.phases, cases: E.cases, reconciliation: E.reconciliation });
    (dump.match(/\d+(?:\.\d+)?/g) || []).forEach(t => {
      const v = Number(t);
      if (isFinite(v)) { s[t] = 1; add(v); }
    });
  } catch (e) { /* ignore */ }

  // 年份与报告期不算数字(回查时跳过)
  return s;
}

export { chain, nextQ };
