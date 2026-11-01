/* 持仓拟合：用季报前十权重 + 个股周收益，算出「如果经理一直不动，这只基金应该怎么走」，
 * 再和实际净值比。残差就是前十解释不了的部分 —— 它可以指向调仓，也可能只是非前十持仓、
 * 打新、现金、停牌估值。所以这里只出「信号 + 证伪条件」，不出「结论」。
 *
 * 用法（自测）：node server/fit.mjs 519191
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNavSeries, buildTotalReturnIndex, ymd } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, '..', '_runs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

/* 行情源用腾讯，不用东财：这台机器到 push2his.eastmoney.com 的 TLS 连接被直接掐断
 * （实测「基础连接已经关闭」，PowerShell 与 node 都一样），而 web.ifzq.gtimg.cn 正常。
 * 腾讯代码前缀: 沪 sh / 深 sz / 北 bj / 港 hk（港股 5 位） */
export function txSymbol(code) {
  const c = String(code || '').trim();
  if (/^(sh|sz|bj|hk)\d+$/i.test(c)) return c.toLowerCase();   // 已带市场前缀（如 sh000300）
  if (/^\d{5}$/.test(c)) return 'hk' + c;
  if (/^6/.test(c)) return 'sh' + c;
  if (/^[489]/.test(c)) return 'bj' + c;
  return 'sz' + c;
}

const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* 抓一次, 失败重试。
 * 为什么必须有: 腾讯这个周线接口偶尔直接回 501(不是我们请求写错, 是它那一侧在抖),
 * 而 2026-11-01 实跑时**一次 501 就把整节《持仓拟合》丢掉了** —— 用户点名要的一节,
 * 因为对方抖一下就整节消失。这里重试 3 次(退避 400ms / 1200ms), 连续失败才算真失败。 */
async function fetchJson(url, timeoutMs = 20000) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      const m = /HTTP (\d+)/.exec(String((e && e.message) || ''));
      const status = m ? Number(m[1]) : 0;
      /* 429 / 5xx / 网络抖动值得重试; 其余 4xx 是请求本身的问题, 重试也没用, 直接认输 */
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === 2) throw lastErr;
      await new Promise(r => setTimeout(r, attempt === 0 ? 400 : 1200));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}

/** 周线收盘（前复权）。返回 { code, rows: [{d, c}] }，抓不到就 rows=[] */
export async function fetchWeekly(code, beg, end) {
  const sym = txSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},week,,,700,qfq`;
  const j = await fetchJson(url);
  const node = (j && j.data && j.data[sym]) || {};
  /* 指数的 qfqweek 可能是空数组（空数组在 JS 里也是真值，别用 || 直接兜底） */
  const arr = (Array.isArray(node.qfqweek) && node.qfqweek.length) ? node.qfqweek : (node.week || []);
  return {
    code,
    name: node.qt && node.qt[0] && node.qt[0][1] || '',
    rows: arr.map(k => ({ d: String(k[0]), c: Number(k[2]) }))
      .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && isFinite(x.c) && x.c > 0
        && x.d >= beg && x.d <= end)
  };
}

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = a => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1));
};
const corr = (x, y) => {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
  }
  return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : null;
};

/* 二元 OLS: y = a + b1*x1 + b2*x2（3x3 正规方程，克莱姆法则） */
function ols2(y, x1, x2) {
  const n = y.length;
  const X = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  const S = [0, 0, 0];
  const cols = [[], [], []];
  for (let i = 0; i < n; i++) { cols[0].push(1); cols[1].push(x1[i]); cols[2].push(x2[i]); }
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += cols[a][i] * cols[b][i];
      X[a][b] = s;
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += cols[a][i] * y[i];
    S[a] = s;
  }
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det3(X);
  if (!isFinite(d) || Math.abs(d) < 1e-12) return null;
  const solve = (col) => {
    const m = X.map(r => r.slice());
    for (let i = 0; i < 3; i++) m[i][col] = S[i];
    return det3(m) / d;
  };
  const alpha = solve(0), b1 = solve(1), b2 = solve(2);
  let ssTot = 0, ssRes = 0;
  const my = mean(y);
  for (let i = 0; i < n; i++) {
    const pred = alpha + b1 * x1[i] + b2 * x2[i];
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  return { alpha, b1, b2, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, n };
}

/**
 * 拟合主函数。
 * @param {object} o
 * @param {string} o.code       基金代码
 * @param {Array}  o.quarters   datasetMeta.quarters（含 endDate / top10[{code,name,weight}] / top10Sum）
 * @param {object} [o.nav]      可复用 getNavSeries 的结果；不给就现抓
 * @param {Function} [o.onProgress]
 */
export async function fitHoldings({ code, quarters, nav, onProgress } = {}) {
  const log = m => { if (onProgress) onProgress(m); };
  const qs = (quarters || []).filter(q => q && q.endDate && Array.isArray(q.top10) && q.top10.length);
  if (qs.length < 2) return { ok: false, reason: '报告期不足 2 个，无法拟合' };

  const beg = qs[0].endDate;
  const end = addDays(qs[qs.length - 1].endDate, 5);

  log('抓净值序列');
  const nv = nav || await getNavSeries(code);
  const tr = buildTotalReturnIndex(nv.unitWorth, nv.accWorth).map(p => ({ d: ymd(p.t), v: p.nav }));
  if (tr.length < 100) return { ok: false, reason: '净值序列太短' };

  /* 周网格用沪深300 的周线日期当主时钟：A 股交易周都在里面 */
  log('抓沪深300周线（当周网格与市场代理）');
  const hs300 = await fetchWeekly('sh000300', beg, end);
  if (!hs300.rows.length) return { ok: false, reason: '沪深300 周线抓不到，无法建周网格' };
  const grid = hs300.rows.map(r => r.d);

  /* 每只股票只抓一次 */
  const codes = [...new Set(qs.flatMap(q => q.top10.map(h => h.code)))].filter(Boolean);
  const weekly = new Map();
  let fetched = 0;
  for (const c of codes) {
    try {
      const w = await fetchWeekly(c, beg, end);
      weekly.set(c, w);
      fetched++;
      if (fetched % 10 === 0) log(`已抓 ${fetched}/${codes.length} 只成分股`);
    } catch (e) {
      weekly.set(c, { code: c, rows: [] });
    }
  }

  /* 股票周收盘 → 周收益；缺周（停牌/未上市）用前值填充，收益记 0 */
  const retOf = new Map();
  const unmatched = [];
  for (const c of codes) {
    const w = weekly.get(c);
    if (!w || !w.rows.length) { unmatched.push(c); continue; }
    const byDate = new Map(w.rows.map(r => [r.d, r.c]));
    const rets = new Array(grid.length).fill(null);
    let last = null;
    for (let i = 0; i < grid.length; i++) {
      const px = byDate.has(grid[i]) ? byDate.get(grid[i]) : last;
      if (px != null && last != null && last > 0) rets[i] = px / last - 1;
      else rets[i] = 0;
      if (byDate.has(grid[i])) last = byDate.get(grid[i]);
    }
    retOf.set(c, rets);
  }

  /* 净值 → 每个周末的值（取 ≤ 该日的最近一个净值） */
  const trByDate = new Map(tr.map(x => [x.d, x.v]));
  const trDates = tr.map(x => x.d);
  const navAt = (d) => {
    let lo = 0, hi = trDates.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (trDates[mid] <= d) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best >= 0 ? trByDate.get(trDates[best]) : null;
  };

  const fundRet = new Array(grid.length).fill(null);
  let prevNav = null;
  for (let i = 0; i < grid.length; i++) {
    const v = navAt(grid[i]);
    if (v != null && prevNav != null && prevNav > 0) fundRet[i] = v / prevNav - 1;
    if (v != null) prevNav = v;
  }

  /* 每周用「最近一个已披露期末」的前十权重；披露前的周不进样本 */
  const qEnds = qs.map(q => q.endDate);
  const weightsAt = (d) => {
    let k = -1;
    for (let i = 0; i < qEnds.length; i++) if (qEnds[i] <= d) k = i; else break;
    if (k < 0) return null;
    const q = qs[k];
    const w = new Map();
    for (const h of q.top10) if (h.code) w.set(h.code, (Number(h.weight) || 0) / 100);
    let sum = 0;
    for (const v of w.values()) sum += v;
    return { w, sum: Math.min(1, sum), period: q.period, endDate: q.endDate, top10Sum: Number(q.top10Sum) || sum * 100 };
  };

  const hs300Ret = (() => {
    const out = new Array(grid.length).fill(null);
    for (let i = 1; i < grid.length; i++) {
      const a = hs300.rows[i - 1].c, b = hs300.rows[i].c;
      out[i] = b / a - 1;
    }
    return out;
  })();

  /* 逐周算：前十组合收益 / 代理拟合收益 / 残差 */
  const rows = [];
  const cover = new Set();
  for (let i = 1; i < grid.length; i++) {
    const wt = weightsAt(grid[i]);
    if (!wt || fundRet[i] == null || hs300Ret[i] == null) continue;
    let basket = 0;
    for (const [c, w] of wt.w) {
      const r = retOf.get(c);
      if (!r) continue;
      const v = r[i];
      if (v == null) continue;
      basket += w * v;
    }
    const market = hs300Ret[i];
    const fit = basket + Math.max(0, 1 - wt.sum) * market;   // 非前十部分用沪深300代理
    rows.push({
      d: grid[i], fund: fundRet[i], basket, market, fit,
      resid: fundRet[i] - fit,
      period: wt.period, top10Sum: wt.top10Sum
    });
    cover.add(wt.period);
  }
  if (rows.length < 40) return { ok: false, reason: `可用周数太少（${rows.length}），无法拟合` };

  const y = rows.map(r => r.fund), x1 = rows.map(r => r.basket), x2 = rows.map(r => r.market);
  const reg = ols2(y, x1, x2);

  const resids = rows.map(r => r.resid);
  const cum = [];
  let cAct = 1, cFit = 1, cRes = 1;
  for (const r of rows) {
    cAct *= 1 + r.fund; cFit *= 1 + r.fit; cRes *= 1 + r.resid;
    cum.push({ d: r.d, actual: cAct, theory: cFit, resid: cRes });
  }

  /* 背离最大的三周（按 |残差| 排序，且彼此至少隔 8 周，避免同一段行情占满） */
  const picked = [];
  for (const r of rows.slice().sort((a, b) => Math.abs(b.resid) - Math.abs(a.resid))) {
    if (picked.every(p => Math.abs(new Date(p.d) - new Date(r.d)) > 8 * 7 * 86400000)) picked.push(r);
    if (picked.length >= 3) break;
  }

  const trErr = std(resids) * Math.sqrt(52);
  const out = {
    ok: true,
    code,
    window: { from: rows[0].d, to: rows[rows.length - 1].d, weeks: rows.length },
    coverage: {
      quarters: cover.size,
      avgTop10Sum: Math.round(mean(rows.map(r => r.top10Sum)) * 100) / 100,
      stocks: codes.length,
      matched: codes.length - unmatched.length,
      unmatched
    },
    fit: {
      corr: corr(y, rows.map(r => r.fit)),
      trackingErrorAnnual: trErr,
      residualMeanWeekly: mean(resids),
      residualStdWeekly: std(resids),
      cumActual: cAct, cumTheory: cFit, cumResidual: cRes
    },
    regression: reg ? {
      alphaWeekly: reg.alpha, alphaAnnual: Math.pow(1 + reg.alpha, 52) - 1,
      betaBasket: reg.b1, betaMarket: reg.b2, r2: reg.r2, n: reg.n
    } : null,
    divergences: picked.map(r => ({
      d: r.d, resid: r.resid, fund: r.fund, theory: r.fit, period: r.period
    })),
    series: rows.map((r, i) => ({
      d: r.d,
      actual: Math.round(cum[i].actual * 10000) / 10000,
      theory: Math.round(cum[i].theory * 10000) / 10000,
      resid: Math.round(cum[i].resid * 10000) / 10000
    })),
    caveats: [
      '季报只披露前十、且是期末快照；非前十部分用沪深300代理，代理不等于真实持仓。',
      '残差可能来自非前十持仓、打新、现金与债券、停牌估值、分红口径，不能单独当作调仓证据。',
      '前十合计占净值比例越低，拟合的解释力越弱；请先看 coverage.avgTop10Sum。',
      '本结果只用于提出可进一步核查的假设，不构成投资建议，也不评价基金经理个人。'
    ]
  };
  return out;
}

/* ---------------- CLI 自测 ---------------- */
const argv = process.argv.slice(2);
if (argv[0] && !argv[0].startsWith('--')) {
  const code = argv[0].replace(/[^\d]/g, '');
  const metaPath = path.join(RUNS, code, 'datasetMeta.json');
  if (!fs.existsSync(metaPath)) { console.error('没有找到 ' + metaPath + '（先跑一次这只基金）'); process.exit(1); }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const t0 = Date.now();
  const r = await fitHoldings({ code, quarters: meta.quarters, onProgress: m => console.log('· ' + m) });
  if (!r.ok) { console.log('\n失败原因: ' + r.reason); process.exit(2); }
  console.log('\n结果：');
  console.log(JSON.stringify({ ok: r.ok, window: r.window, coverage: r.coverage, fit: r.fit, regression: r.regression, divergences: r.divergences }, null, 2));
  if (r.ok) {
    const out = path.join(RUNS, code, 'fit.json');
    fs.writeFileSync(out, JSON.stringify(r, null, 1), 'utf8');
    console.log('\n已写 ' + out + `（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  }
}
