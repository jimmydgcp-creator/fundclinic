/* 探路(第一阶段): 只抓元数据, 用于在"开跑"之前把 SOP §0 的 8 格口径确认表填好摆给用户。
 *
 * 为什么单独做一个: 完整采集要抓 10 年持仓 + 若干份官方 PDF(5–10 秒), 而"口径确认"发生在采集之前。
 * 所以探路只打三个轻接口(概况 / 经理履历 / 定期报告清单), 约 1–2 秒, 拿到:
 *   ① 基金代码/全称/简称  ② 历任经理(含共管期)  ③ 可选复盘区间(按任期切)
 *   ④ 数据截止日(最新已披露报告期)  ⑤ 业绩比较基准(概况页)
 * 剩下的(收益口径/只看前十大/产出目录)是固定或默认项, 由页面直接给出。
 */
import { getBasicInfo, getManagerHistory, getNavSeries } from './sources.mjs';
import { getReportList } from './official.mjs';

const UA_ERR = '探路失败';

/** "2026Q2" -> "2026-06-30" */
export function periodEndDate(period) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(period || ''));
  if (!m) return null;
  const y = +m[1], q = +m[2];
  const ends = ['03-31', '06-30', '09-30', '12-31'];
  return `${y}-${ends[q - 1]}`;
}

export function prevPeriod(period) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(period || ''));
  if (!m) return null;
  let y = +m[1], q = +m[2] - 1;
  if (q < 1) { q = 4; y -= 1; }
  return `${y}Q${q}`;
}

export async function probeFund(code, opts = {}) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) throw new Error('基金代码必须是 6 位数字');
  const years = Number(opts.years || 10);
  const t0 = Date.now();

  const [basic, managerHistory, reports, nav] = await Promise.all([
    getBasicInfo(c),
    getManagerHistory(c).catch(() => ({ rows: [], current: null, coManagedPeriods: [] })),
    getReportList(c, { pages: opts.pages || 4 }),
    getNavSeries(c).catch(() => null)
  ]);

  /* 报告期网格必须自己算, 不能只靠天天的"定期报告清单"。
     实测(005827): 清单只有 26 期, 而前十大持仓接口能取到 31 期 —— 清单**静默漏了 5 个季度**
     (2021Q3/2021Q4/2022Q1/2022Q3/2022Q4)。若拿清单当基准, 用户看到的"期数"就是错的。
     所以: 起点取「成立季度」与「抓取年数下限」的较晚者, 终点取清单里最新的报告期。 */
  const latestFromReports = reports.map(r => r.period).filter(Boolean).sort().pop() || null;

  // 成立日期: 净值序列的首个交易日就是成立日(实测与概况页一致), 比解析概况页可靠
  // 注意时区: 净值时间戳是北京时间零点, 直接 toISOString() 会退一天(实测 519191 差 1 天)
  const cstDate = ms => (ms ? new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10) : '');
  const navStartMs = nav && nav.accWorth.length ? nav.accWorth[0].t : null;
  const inceptionDate = cstDate(navStartMs);
  const navLastMs = nav && nav.accWorth.length ? nav.accWorth[nav.accWorth.length - 1].t : null;

  const quarterOf = d => {
    if (!d) return null;
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
  };
  const quarterEnd = q => periodEndDate(q);

  const incepQ = quarterOf(inceptionDate) || '2000Q1';
  const yearFloor = `${new Date().getFullYear() - years + 1}Q1`;
  let from = incepQ > yearFloor ? incepQ : yearFloor;
  // 若成立日晚于该季度末, 该季度没有完整数据, 往后推一季
  if (inceptionDate && quarterEnd(from) && quarterEnd(from) < inceptionDate) {
    const m = /^(\d{4})Q([1-4])$/.exec(from);
    from = (+m[2] === 4) ? `${+m[1] + 1}Q1` : `${m[1]}Q${+m[2] + 1}`;
  }
  let to = latestFromReports || quarterOf(cstDate(navLastMs)) || from;

  const grid = [];
  {
    const m = /^(\d{4})Q([1-4])$/.exec(from);
    let y = +m[1], q = +m[2];
    for (let guard = 0; guard < 200; guard++) {
      const p = `${y}Q${q}`;
      if (p > to) break;
      grid.push(p);
      q++; if (q > 4) { q = 1; y++; }
    }
  }
  if (!grid.length) throw new Error('无法推导报告期网格');
  const withDates = grid.map(p => ({ period: p, endDate: periodEndDate(p) }));

  const windowOf = (start, end) => {
    const e = end && !/至今/.test(end) ? end : null;
    const qs = withDates.filter(h => (!start || h.endDate >= start) && (!e || h.endDate <= e));
    return qs.length ? { from: qs[0].period, to: qs[qs.length - 1].period, n: qs.length } : null;
  };

  const rows = (managerHistory.rows || []).filter(r => r.start && r.managers && r.managers.length);
  const candidates = [];
  rows.slice(0, 6).forEach((r, i) => {
    const w = windowOf(r.start, r.end);
    if (!w) return;
    candidates.push({
      id: 'tenure' + i,
      label: `${r.managers.join('+')}(${r.start} ~ ${r.end})`,
      managers: r.managers,
      start: r.start, end: r.end,
      isCurrent: /至今/.test(r.end || ''),
      coManaged: !!r.coManaged,
      tenureDays: r.tenure || '',
      tenureReturn: r.returnPct,
      ...w
    });
  });
  if (withDates.length) candidates.push({ id: 'all', label: '全部可取报告期', managers: [], start: withDates[0].endDate, end: null, isCurrent: false, coManaged: false, ...windowOf(withDates[0].endDate, null) });

  // 默认推荐: 与采集阶段保持同一套规则(现任经理任期 ≥4 期 → 用它; 否则用最长的一任)
  const cur = candidates.find(x => x.isCurrent);
  const longest = candidates.filter(x => x.id !== 'all').sort((a, b) => b.n - a.n)[0];
  let recommended = null, recommendReason = '';
  if (cur && cur.n >= 4) { recommended = cur; recommendReason = `现任经理任期共 ${cur.n} 个报告期, 足以判定形态`; }
  else if (longest && longest.n >= 4) {
    recommended = longest;
    recommendReason = cur
      ? `现任经理任期仅 ${cur.n} 个报告期(不足 4 期, 无法判定形态), 建议改用任期最长的一任: ${longest.label} 共 ${longest.n} 期`
      : `未识别到现任经理任期, 建议改用可取区间最长的一段: ${longest.label} 共 ${longest.n} 期`;
  } else if (candidates.length) { recommended = candidates[candidates.length - 1]; recommendReason = `所有经理任期都不足 4 期, 建议用全部可取报告期(${recommended.n} 期), 形态会标记为"样本不足"`; }
  candidates.forEach(x => { x.recommended = !!(recommended && x.id === recommended.id); });

  const latest = withDates[withDates.length - 1];
  const managersNow = (managerHistory.current && managerHistory.current.managers) || (basic.manager ? [basic.manager] : []);

  // 清单里实际有官方报告的期数(用于提示"哪些期能直接拿官方 PDF 对账")
  const reportPeriods = [...new Set(reports.map(r => r.period).filter(Boolean))].sort();

  return {
    code: c,
    probeMs: Date.now() - t0,
    years,
    fund: {
      code: c,
      name: basic.name || (nav && nav.name) || c,
      fullName: basic.fullName || '',
      company: basic.company || '',
      type: basic.type || '',
      inception: inceptionDate || basic.inception || '',
      scale: basic.scale || '',
      manager: managersNow.join('+') || basic.manager || '',
      benchmark: basic.benchmark || ''
    },
    managers: rows.map(r => ({
      start: r.start, end: r.end, managers: r.managers, coManaged: !!r.coManaged,
      tenure: r.tenure || '', returnPct: r.returnPct
    })),
    periods: withDates,
    reportPeriodCount: reportPeriods.filter(p => grid.includes(p)).length,
    candidates,
    recommendReason,
    /** SOP §0 那 8 格的初值 */
    gate1Draft: {
      code: c,
      fundName: basic.name || (nav && nav.name) || c,
      managerLabel: recommended ? (recommended.managers || []).join('+') : managersNow.join('+'),
      rangeFrom: recommended ? recommended.from : withDates[0].period,
      rangeTo: recommended ? recommended.to : latest.period,
      dataCutoff: `${latest.period}(${latest.endDate}, 最新已披露定期报告)`,
      benchmark: basic.benchmark || '（概况页未取到, 请从季报 §2 抄录）',
      returnBasis: '分红再投总回报指数(单位净值 + 除息日分红回加)',
      scope: '只看前十大持仓(季报披露口径)',
      outputDir: `_runs/${c}`,
      rangeReason: recommendReason
    },
    notes: [
      `报告期数按"成立季度 / 抓取年数"推导的季度网格统计(共 ${withDates.length} 期), 与实际抓到前十大持仓的期数可能相差 ±1 期 —— 以开跑后的实际期数为准。`,
      reportPeriods.length < withDates.length
        ? `天天基金的定期报告清单只覆盖到 ${reportPeriods.filter(p => grid.includes(p)).length}/${withDates.length} 期(接口会静默漏掉部分季度), 因此官方 PDF 对账会挑其中可得的期来做。`
        : '定期报告清单覆盖完整。',
      '业绩比较基准以概况页为初值; 开跑后会用抽样的官方季报 PDF 再核一遍, 中途调整过会在报告里标注。'
    ]
  };
}
