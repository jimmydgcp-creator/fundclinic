/* 交付物构建的纯函数(结论卡 / 来源清单)。
 * 单独成文件的原因: 工具需要复用它们, 但它们原来住在 pipeline.mjs 里,
 * 而 pipeline.mjs 会连带 import fit.mjs —— fit.mjs 有"被 import 就按 argv 跑 CLI"的
 * 顶层副作用, 任何 import pipeline 的工具都会顺手重跑一遍持仓拟合。拆出来就没有这个坑。
 */

/** 传给前端的底稿元信息(不含逐行持仓明细), /api/run 与落盘恢复共用同一份形状。 */
export function stripDataset(d) {
  return {
    fund: d.fund, rangeInfo: d.rangeInfo, sources: d.sources, cleanLog: d.cleanLog,
    crawlStandard: d.crawlStandard, crawledAt: d.crawledAt, crawlLog: d.crawlLog,
    perfDetail: d.perfDetail ? { method: d.perfDetail.method, quarterReturns: d.perfDetail.quarterReturns, maxDrawdownAt: d.perfDetail.maxDrawdownAt, baseDate: d.perfDetail.baseDate, baseClamped: d.perfDetail.baseClamped } : null,
    /* 官方窗口校准结果要一起下发: 页面上"这个收益数字到底核过没有"是个必答问题,
       不留痕的话用户只能看到报告里一句自然语言, 无从判断。 */
    perfCalibration: d.perfCalibration || null,
    official: d.official ? {
      available: d.official.available, pdftotext: d.official.pdftotext,
      checks: (d.official.checks || []).map(c => ({ period: c.period, reason: c.reason, title: c.title, url: c.url, parsedRows: c.parsedRows, reconcile: c.reconcile, benchmark: c.benchmark, error: c.error })),
      benchmark: d.official.benchmark || null,
      notes: d.official.notes, talks: (d.official.talks || []).map(t => ({ period: t.period, url: t.url, text: t.text }))
    } : null,
    managerHistory: d.managerHistory, prevTenure: d.prevTenure, quarters: d.quarters
  };
}

export function buildCard(analysis, dataset, check) {
  const r2 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
  const m = analysis.metrics;
  return {
    schema: 'fundclinic/2',
    generatedAt: new Date().toISOString(),
    generatedBy: '基金复诊台 FundClinic v2(SOP §2 自动采集 + 离线规则引擎)',
    dataProvenance: {
      standard: dataset.crawlStandard,
      crawledAt: dataset.crawledAt,
      rangeBasis: dataset.rangeInfo ? dataset.rangeInfo.basis : '',
      officialReconcile: dataset.official ? {
        available: dataset.official.available,
        checks: (dataset.official.checks || []).map(c => ({ period: c.period, rows: c.parsedRows, ok: c.reconcile ? c.reconcile.ok : false, maxWeightDiff: c.reconcile ? r2(c.reconcile.maxWeightDiff) : null, url: c.url }))
      } : null
    },
    fund: { code: analysis.fund.code, name: analysis.fund.name, manager: analysis.fund.manager || '', range: analysis.range, quarters: analysis.quarterCount },
    card: {
      formTag: analysis.form.tag, formConfidence: analysis.form.confidence,
      mainQuestion: analysis.card.mainQuestion, claim: analysis.card.claim,
      falsifier: analysis.card.falsifier, evidenceLevel: analysis.card.evidenceLevel,
      trackers: analysis.trackers, caveats: analysis.card.caveats
    },
    structure: {
      top10SumAvg: r2(m.conc.avg), top10SumRange: [r2(m.conc.min), r2(m.conc.max)], top10SumSlope: r2(m.conc.slope),
      avgRetained: r2(m.avgRetained), avgAdded: r2(m.avgAdded), avgJaccard: r2(m.avgJaccard),
      themeSwitches: m.theme.switches, themeChain: m.theme.known ? m.theme.runs.map(x => `${x.theme}(${x.len}期)`) : null,
      top1Avg: r2(m.leader.avg), distinctHoldings: m.totalDistinct, maxStreak: m.maxStreak
    },
    performance: analysis.perf ? {
      method: (dataset.perfDetail || {}).method || '', cumReturn: analysis.perf.cumReturn,
      exBestQuarter: analysis.perf.exBestQuarter, bestQuarter: analysis.perf.bestQuarter,
      bestQuarterContribution: r2(analysis.perf.bestQuarterContribution),
      maxDrawdown: analysis.perf.maxDrawdown, aumPeak: analysis.perf.aumPeak, aumEnd: analysis.perf.aumEnd
    } : null,
    check: check.summary,
    gates: { g1_口径确认: true, g2_判断方向: false, g3_终审三查: false }
  };
}

export function sourceLedger(dataset, analysis) {
  const L = [`# 来源清单 · ${dataset.fund.name}(${dataset.fund.code})`, ''];
  L.push(`- 抓取时间: ${dataset.crawledAt}`);
  L.push(`- 采集标准: ${dataset.crawlStandard}`);
  L.push(`- 复盘区间: ${dataset.fund.range}(${dataset.fund.quarterCount} 期)`);
  L.push(`- 区间选取依据: ${dataset.rangeInfo ? dataset.rangeInfo.basis : '用户指定'}`);
  L.push('');
  L.push('| # | 类型 | URL | 抓取时间 | 备注 |');
  L.push('| --- | --- | --- | --- | --- |');
  dataset.sources.forEach((s, i) => {
    const extra = [s.period && '报告期 ' + s.period, s.points && s.points + ' 个交易日', s.quarters && s.quarters + ' 期', s.rows && s.rows + ' 行', s.fields && s.fields.join('/'), s['对账']].filter(Boolean).join('; ');
    L.push(`| ${i + 1} | ${s.type} | ${s.url} | ${s.fetchedAt} | ${extra} |`);
  });
  L.push('');
  if (dataset.official) {
    L.push('## 官方报告逐行对账(SOP 质检要求)');
    L.push('');
    L.push('| 报告期 | 选取理由 | 官方行数 | 权重最大差 | 结论 |');
    L.push('| --- | --- | --- | --- | --- |');
    (dataset.official.checks || []).forEach(c => {
      L.push(`| ${c.period} | ${c.reason || ''} | ${c.parsedRows || '—'} | ${c.reconcile ? c.reconcile.maxWeightDiff.toFixed(3) + 'pp' : '—'} | ${c.reconcile ? (c.reconcile.ok ? '逐行一致' : '有差异') : (c.error || '未完成')} |`);
    });
    L.push('');
    (dataset.official.notes || []).forEach(n => L.push('> ' + n));
    if (dataset.official.talks && dataset.official.talks.length) {
      L.push('');
      L.push('## 经理原话摘录(季报"投资策略和运作分析", 供证据链使用)');
      L.push('');
      dataset.official.talks.forEach(t => {
        L.push(`### ${t.period}`);
        L.push('');
        L.push('> ' + String(t.text).replace(/\n+/g, ' ').slice(0, 900));
        L.push('');
        L.push(`来源: ${t.url}`);
        L.push('');
      });
    }
  }
  L.push('## 清洗规则触发记录(SOP 清洗三规则)');
  L.push('');
  if (!dataset.cleanLog || !dataset.cleanLog.length) L.push('本次未触发任何清洗规则(代码补零 / 权重换算 / 推算价)。');
  else dataset.cleanLog.forEach(x => L.push('- ' + x));
  L.push('');
  L.push('## 口径与免责');
  L.push('');
  L.push('- 仅使用公开渠道数据, 不含任何机构或实习单位内部数据;');
  L.push('- 只看前十大持仓(季报口径), 期末快照, 期间买卖不可见;');
  L.push('- 推算价 = 期末公允价值 ÷ 期末持股数, 未复权、不含分红, 不代表投资者实际收益;');
  /* 收益口径这句必须反映真实校准结果 —— 不能无条件写"已校准"。 */
  const cal = dataset.perfCalibration;
  L.push('- 收益口径为分红再投总回报指数' + (cal && cal.ok
    ? `, 已与官方季报披露的「过去三个月」净值增长率逐期校准 ${cal.n} 期, 最大偏差 ${cal.maxAbsDiff}pp${cal.consistent ? '(口径一致)' : '(偏差偏大, 需人工复核)'};`
    : `, ${(cal && cal.reason) || '本次未做官方窗口校准'};`));
  L.push('- 全文为回溯复盘, 不构成投资建议, 不评价基金经理个人, 不推荐任何基金。');
  return L.join('\n');
}
