/* 数据采集层: 输入一个基金代码, 从公开渠道抓回"和手工整理过的底稿同一套 schema"的数据。
 *
 * 只用公开接口(天天基金 F10 / 净值序列接口), 不碰任何机构内部数据。
 * 各接口实测(2026-09-16):
 *   jbgk_{code}.html                        基金概况(全称/类型/公司/经理/业绩基准)
 *   pingzhongdata/{code}.js                 日频单位净值与累计净值(3055 个交易日点)
 *   FundArchivesDatas.aspx?type=gmbd        规模变动(季度, 60 行)
 *   FundArchivesDatas.aspx?type=jjcc&year=  前十大持仓(按年返回 4 个季度块)
 *
 * 输出 schema 与项目内置样例完全一致, 因此引擎/质检/报告/演示稿全部不用改。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { verifyAgainstOfficial, findPdftotext } from './official.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_F10 = 'https://fundf10.eastmoney.com';
const BASE_FUND = 'https://fund.eastmoney.com';

export class CrawlError extends Error {
  constructor(msg, detail) { super(msg); this.name = 'CrawlError'; this.detail = detail; }
}

async function fetchText(url, { retries = 2, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': BASE_FUND + '/', 'Accept': '*/*' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      // 这些接口都是 UTF-8(实测); 若响应头声明了别的编码, 以声明为准
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      let enc = 'utf8';
      if (ct.includes('gb2312') || ct.includes('gbk')) enc = 'latin1';
      return buf.toString(enc);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw new CrawlError('抓取失败: ' + url, String(lastErr && lastErr.message || lastErr));
}

const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toNum = s => {
  const t = String(s == null ? '' : s).replace(/[%％,，\s]/g, '');
  if (t === '' || t === '-' || t === '---' || t === '—') return null;
  const v = Number(t);
  return isFinite(v) ? v : null;
};

/* ------------------------------------------------------------ 基金概况 */
export async function getBasicInfo(code) {
  const html = await fetchText(`${BASE_F10}/jbgk_${code}.html`);
  const info = {};
  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const k = stripTags(m[1]);
    if (k && info[k] === undefined) info[k] = stripTags(m[2]);
  }
  const title = (/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1];
  if (!info['基金简称'] && title) info['基金简称'] = stripTags(title).split('(')[0].trim();
  if (!Object.keys(info).length) throw new CrawlError('基金概况页解析为空, 代码可能不存在: ' + code);
  return {
    fullName: info['基金全称'] || '',
    name: info['基金简称'] || info['基金全称'] || code,
    code,
    type: info['基金类型'] || '',
    company: info['基金管理人'] || info['基金公司'] || '',
    manager: info['基金经理人'] || info['基金经理'] || '',
    inception: info['成立日期'] || '',
    scale: info['资产规模'] || '',
    benchmark: info['业绩比较基准'] || '',
    raw: info
  };
}

/* ------------------------------------------------------------ 净值序列 */
export function parsePingzhong(text) {
  const grab = name => {
    const m = new RegExp('var\\s+' + name + '\\s*=\\s*([\\s\\S]*?);\\s*(?=/\\*|var\\s|$)', 'm').exec(text);
    return m ? m[1].trim() : null;
  };
  const jsonOrNull = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const unit = jsonOrNull(grab('Data_netWorthTrend')) || [];
  const ac = jsonOrNull(grab('Data_ACWorthTrend')) || [];
  const managers = jsonOrNull(grab('Data_currentFundManager')) || [];
  return {
    name: (grab('fS_name') || '').replace(/^"|"$/g, ''),
    code: (grab('fS_code') || '').replace(/^"|"$/g, ''),
    unitWorth: unit.map(d => ({ t: d.x, nav: d.y, ret: d.equityReturn })),
    accWorth: ac.map(d => ({ t: d[0], nav: d[1] })),
    managers: managers.map(m => ({ name: m.name, workTime: m.workTime, fundSize: m.fundSize, power: m.power && m.power.avr }))
  };
}

export async function getNavSeries(code) {
  const js = await fetchText(`${BASE_FUND}/pingzhongdata/${code}.js`);
  const d = parsePingzhong(js);
  if (!d.unitWorth.length) throw new CrawlError('净值序列为空, 代码可能不存在: ' + code);
  return d;
}

/* ------------------------------------------------------------ 规模变动 */
export async function getScaleSeries(code) {
  const txt = await fetchText(`${BASE_F10}/FundArchivesDatas.aspx?type=gmbd&code=${code}&rt=${Math.random()}`);
  const rows = [];
  for (const tr of txt.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => stripTags(m[1]));
    if (tds.length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(tds[0])) continue;
    rows.push({
      date: tds[0],
      purchase: toNum(tds[1]),
      redeem: toNum(tds[2]),
      shares: toNum(tds[3]),      // 期末总份额(亿份)
      aum: toNum(tds[4]),         // 期末净资产(亿元)
      aumChange: tds[5] || ''
    });
  }
  return rows;
}

/* ------------------------------------------------------ 前十大持仓(按年) */
function periodFromDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const q = Math.floor((Number(m[2]) - 1) / 3) + 1;
  return { period: `${m[1]}Q${q}`, endDate: dateStr };
}

export function parseJjccYear(text) {
  const out = [];
  // 每个季度一个 <div class='boxitem w790'> 块
  const blocks = text.split(/<div class='boxitem w790'>/).slice(1);
  for (const blk of blocks) {
    const dateM = /截止至[：:]\s*<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/.exec(blk) || /截止至[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(blk);
    if (!dateM) continue;
    const p = periodFromDate(dateM[1]);
    if (!p) continue;

    // 列位置按表头动态识别, 避免接口调整列序后静默算错
    const thead = (/<thead>([\s\S]*?)<\/thead>/.exec(blk) || [])[1] || '';
    const heads = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => stripTags(m[1]));
    const idx = {
      rank: heads.findIndex(h => /序号/.test(h)),
      code: heads.findIndex(h => /股票代码/.test(h)),
      name: heads.findIndex(h => /股票名称/.test(h)),
      weight: heads.findIndex(h => /占净值/.test(h)),
      shares: heads.findIndex(h => /持股数/.test(h)),
      value: heads.findIndex(h => /持仓市值/.test(h))
    };
    if (idx.code < 0 || idx.name < 0 || idx.weight < 0) continue;

    const top10 = [];
    const tbody = (/<tbody>([\s\S]*?)<\/tbody>/.exec(blk) || [])[1] || blk;
    for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
      if (tds.length < 4) continue;
      const cell = i => (i >= 0 && i < tds.length ? tds[i] : '');
      const codeRaw = stripTags(cell(idx.code));
      const weight = toNum(stripTags(cell(idx.weight)));
      if (!codeRaw || weight === null) continue;
      top10.push({
        rank: toNum(stripTags(cell(idx.rank))) || top10.length + 1,
        code: codeRaw.replace(/^'/, '').padStart(6, '0'),
        name: stripTags(cell(idx.name)),
        weight,
        sharesWan: toNum(stripTags(cell(idx.shares))),
        valueWan: toNum(stripTags(cell(idx.value)))
      });
    }
    if (top10.length) {
      top10.sort((a, b) => b.weight - a.weight);
      top10.forEach((h, i) => { h.rank = i + 1; });
      out.push({ ...p, top10 });
    }
  }
  return out;
}

export async function getHoldings(code, { fromYear, toYear, onProgress } = {}) {
  const yEnd = toYear || new Date().getFullYear();
  const yStart = fromYear || (yEnd - 9);
  const all = [];
  for (let y = yEnd; y >= yStart; y--) {
    if (onProgress) onProgress(`抓取 ${y} 年前十大持仓…`);
    let txt;
    try {
      txt = await fetchText(`${BASE_F10}/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${y}&month=&rt=${Math.random()}`);
    } catch (e) { continue; }
    const qs = parseJjccYear(txt);
    all.push(...qs);
    if (!qs.length && y < yEnd) break;   // 连续空年, 提前收工
    await sleep(120);                    // 对公共接口保持克制
  }
  // 去重(同年可能重复返回)并按报告期排序
  const byPeriod = {};
  all.forEach(q => { byPeriod[q.period] = q; });
  return Object.keys(byPeriod).sort().map(p => byPeriod[p]);
}

/* ------------------------------------------------------------ 绩效计算 */
/** 构造「分红再投」总回报指数(复权净值)。
 *
 *  为什么不能直接用累计净值算收益(这是本次发现的一个真实口径错误):
 *    累计净值 = 单位净值 + 累计分红, 是**加法**累积量, 不是总回报指数。
 *    拿它做比值会把分红当成"净值的一部分"而不是"已到手的现金", 长期会严重低估收益。
 *  实测校准(519191, 2026Q2 季报披露的官方净值增长率):
 *    累计净值法  过去三年 +28.33%(官方 +35.10%) / 过去七年 +73.80%(官方 +99.93%) / 过去十年 +129.07%(官方 +175.19%)
 *    单位净值法  过去三年 +35.10%(一致)  / 过去七年 +99.93%(一致)  / 过去五年 +93.38%(官方 +93.07%)
 *  正确做法: 用单位净值, 并在除息日把当日每份分红加回去, 链式相乘:
 *    每日分红 = (累计净值 - 单位净值) 的当日增量
 *    TR_t = TR_{t-1} × (单位净值_t + 当日分红_t) / 单位净值_{t-1}
 */
export function buildTotalReturnIndex(unitWorth, accWorth) {
  const acByT = new Map();
  accWorth.forEach(p => acByT.set(p.t, p.nav));
  const out = [];
  let tr = 1, prevNav = null, prevCumDiv = 0, hasPrev = false;
  for (const p of unitWorth) {
    if (!p || typeof p.nav !== 'number') continue;
    const ac = acByT.get(p.t);
    const cumDiv = (typeof ac === 'number') ? Math.max(0, ac - p.nav) : prevCumDiv;
    const div = Math.max(0, cumDiv - prevCumDiv);
    // 累计净值只披露到 4 位小数, 低于 0.001 的增量视为噪声
    const divClean = div >= 0.001 ? div : 0;
    if (!hasPrev) { out.push({ t: p.t, nav: 1 }); }
    else { tr = tr * (p.nav + divClean) / prevNav; out.push({ t: p.t, nav: tr }); }
    prevNav = p.nav; prevCumDiv = cumDiv; hasPrev = true;
  }
  return out;
}

/** 时间戳 → 北京时间的 YYYY-MM-DD。
 *
 *  天天基金的净值时间戳是「北京时间当日 00:00」的毫秒值, 例如 1737648000000 = 2025-01-23T16:00Z
 *  = 2025-01-24 00:00+08。直接 toISOString().slice(0,10) 会取到 UTC 日, **普遍早一天**,
 *  于是成立日 2025-01-24 被写成 2025-01-23、回撤日也会错位。凡是要对外披露的日期都走这里。
 */
export const ymd = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** 日期字符串按月平移(纯日历运算, 不碰本地时区, 结果超出当月天数时取当月最后一天)。
 *  例: shiftMonthsYmd('2020-12-31', -3) === '2020-09-30' */
export function shiftMonthsYmd(ymdStr, delta) {
  const [y, m, d] = String(ymdStr).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = first.getUTCFullYear(), mm = first.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** 用总回报指数(分红再投)算区间复利、逐季收益、最大回撤。
 *
 *  区间起点必须是「第一个报告期的**期初**」, 不是期末。
 *  这里踩过一个真坑: 复盘区间写 2020Q4–2026Q2, 但基准点取了 2020-12-31(2020Q4 的期末),
 *  于是第一个季度自己的收益被漏掉, 区间收益从 +76.8% 虚增到 +85.97%。
 *  因为季报的"过去三个月"覆盖的是**整个季度**, 区间口径必须与它对齐。
 *  正确做法: 基准点取「上一个报告期的期末」(即本区间第一个季度的期初)。
 */
export function computePerfFromIndex(trIndex, quarters, { methodNote } = {}) {
  if (!trIndex.length || quarters.length < 1) return null;
  const ts = d => Date.parse(d + 'T00:00:00+08:00');
  const at = t => { let best = null; for (const p of trIndex) { if (p.t <= t) best = p; else break; } return best; };

  // 基准点: 第一个报告期之前的那一天(等价于第一个季度的期初)
  let base = at(ts(shiftMonthsYmd(quarters[0].endDate, -3)));
  let baseClamped = false;
  /* 次新基金: 成立日晚于「区间第一季度的期初」时, 回退一个季度会落到成立日之前,
     净值序列里根本不存在这一天。以前这里直接 return null, 后果是整份报告丢掉「绩效」一节,
     只剩持仓结构 —— 报告看起来"简化"了, 实际是性能块被静默吞掉。
     正确做法: 退到「成立后第一个有净值的交易日」, 并把这件事写进口径披露。 */
  if (!base && trIndex.length && trIndex[0].t <= ts(quarters[0].endDate)) {
    base = trIndex[0]; baseClamped = true;
  }
  const last = at(ts(quarters[quarters.length - 1].endDate));
  if (!base || !last || base.nav <= 0) return null;

  const cumReturn = (last.nav / base.nav - 1) * 100;

  /* 逐季收益 = 每个季度自身的收益(季初→季末), 与官方"过去三个月"可直接比对 */
  const marks = [base].concat(quarters.map(q => at(ts(q.endDate))));
  const rets = [];
  for (let i = 1; i < marks.length; i++) {
    if (!marks[i] || !marks[i - 1] || !marks[i - 1].nav) continue;
    rets.push({ period: quarters[i - 1].period, ret: (marks[i].nav / marks[i - 1].nav - 1) * 100 });
  }
  let best = null;
  rets.forEach(r => { if (!best || r.ret > best.ret) best = r; });

  const exBest = best ? ((cumReturn + 100) / (1 + best.ret / 100) - 100) : cumReturn;

  const win = trIndex.filter(p => p.t >= base.t && p.t <= last.t);
  let peak = -Infinity, mdd = 0, mddAt = null, curPeakAt = null, peakAt = null;
  for (const p of win) {
    if (p.nav > peak) { peak = p.nav; curPeakAt = p.t; }
    const dd = (p.nav / peak - 1) * 100;
    if (dd < mdd) { mdd = dd; mddAt = ymd(p.t); peakAt = curPeakAt ? ymd(curPeakAt) : null; }
  }

  return {
    cumReturn: Math.round(cumReturn * 100) / 100,
    exBestQuarter: Math.round(exBest * 100) / 100,
    bestQuarter: best ? best.period : '',
    bestQuarterReturn: best ? Math.round(best.ret * 100) / 100 : null,
    quarterReturns: rets,
    maxDrawdown: Math.round(mdd * 100) / 100,
    maxDrawdownAt: mddAt, drawdownFrom: peakAt,
    baseDate: ymd(base.t),
    baseClamped,
    indexStart: base.nav, indexEnd: last.nav,
    method: methodNote || (baseClamped
      ? '分红再投总回报指数(单位净值 + 除息日分红回加, 链式相乘); 本基金成立于复盘区间起点之后, 序列无区间前一日期, 区间起点取「成立后首个有净值的交易日」' + ymd(base.t) + ', 非报告期期初, 首个报告期收益含成立以来全段; 最大回撤按区间内日频指数计算'
      : '分红再投总回报指数(单位净值 + 除息日分红回加, 链式相乘); 区间自第一个报告期的期初(' + shiftMonthsYmd(quarters[0].endDate, -3) + ')起算; 最大回撤按区间内日频指数计算')
  };
}

/** 兼容旧签名: 只要给的是"已经是总回报指数"的序列即可。 */
export function computePerf(series, quarters) {
  return computePerfFromIndex(series, quarters);
}

/* -------------------------------------------- SOP §2-3 资产配置历史 */
/** zcpz_{code}.html → 每期 股票/债券/现金 占净比 + 净资产。
 *  实测行形如 ["2026-06-30","93.91%","---","6.39%","2.92"] */
export async function getAssetAllocation(code) {
  const html = await fetchText(`${BASE_F10}/zcpz_${code}.html`);
  const out = {};
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => stripTags(m[1]));
    if (tds.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(tds[0])) continue;
    const p = periodFromDate(tds[0]);
    if (!p) continue;
    out[p.period] = {
      endDate: tds[0],
      stockPos: toNum(tds[1]),
      bondPos: toNum(tds[2]),
      cashPos: toNum(tds[3]),
      aum: tds[4] !== undefined ? toNum(tds[4]) : null
    };
  }
  return out;
}

/* ---------------------------------------- SOP §2-6 经理履历(含共管搭档) */
/** jjjl_{code}.html → 历任经理: 起始日/结束日/经理/任职天数/任职回报。
 *  SOP 要求: 上任/离任日期、共管搭档 —— 共管期归因要用。 */
export async function getManagerHistory(code) {
  const html = await fetchText(`${BASE_F10}/jjjl_${code}.html`);
  const rows = [];
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => stripTags(m[1]));
    if (tds.length < 4) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tds[0])) continue;
    const namesRaw = tds[2] || '';
    rows.push({
      start: tds[0],
      end: tds[1] || '',
      tenure: tds[3] || '',
      returnPct: toNum(tds[4]),
      managers: namesRaw.split(/\s+/).map(s => s.trim()).filter(Boolean),
      coManaged: namesRaw.split(/\s+/).filter(Boolean).length > 1
    });
  }
  // 由近及远
  rows.sort((a, b) => (a.start < b.start ? 1 : -1));
  const current = rows.find(r => /至今/.test(r.end)) || rows[0] || null;
  const coManagedPeriods = rows.filter(r => r.coManaged);
  return { rows, current, coManagedPeriods };
}

/* -------------------------------------------------- SOP §3 清洗三规则 */
/** SOP 清洗三规则(基线踩过坑, 写死):
 *  ① 股票代码数值化后补零到 6 位;
 *  ② 权重字段 <1 视为小数要 ×100(0.0915 → 9.15%);
 *  ③ 期末价 = 市值 ÷ 持股数(推算值, 仅供轮动参考, 不是成交价证据)。 */
export function applyCleanRules(top10, log = []) {
  return top10.map(h => {
    const r = { ...h };
    // ① 代码补零
    const codeStr = String(r.code == null ? '' : r.code).replace(/[^\dA-Za-z]/g, '');
    if (codeStr.length && codeStr.length < 6) {
      const fixed = codeStr.padStart(6, '0');
      if (fixed !== codeStr) log.push(`①代码补零: ${r.name} ${codeStr} → ${fixed}`);
      r.code = fixed;
    }
    // ② 权重 <1 视为小数
    if (typeof r.weight === 'number' && r.weight > 0 && r.weight < 1) {
      const fixed = Math.round(r.weight * 1000000) / 10000;
      log.push(`②权重换算: ${r.name} ${r.weight} → ${fixed}%(疑似小数口径)`);
      r.weight = fixed;
    }
    // ③ 推算期末价(元/股) = 持仓市值(万元) ÷ 持股数(万股)
    if (r.sharesWan && r.valueWan && r.sharesWan > 0) {
      r.impliedPrice = Math.round((r.valueWan / r.sharesWan) * 10000) / 10000;
    }
    return r;
  });
}

/* ------------------------------------------------------------ 主流程 */
/** 按 SOP §2 的六类来源依次采集:
 *  ① 官方季报/年报 PDF(最高权威, 逐行对账)  ② 天天基金历史前十大  ③ 天天基金资产配置
 *  ④ 天天基金规模变动                      ⑤ 累计净值序列        ⑥ 经理履历
 *  每类都记下 URL 与抓取日期, 汇成"来源清单"(SOP §2 要求)。 */
export async function crawlFund(code, opts = {}) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) throw new CrawlError('基金代码必须是 6 位数字, 收到: ' + JSON.stringify(code));
  const onProgress = opts.onProgress || (() => {});
  const t0 = Date.now();
  const cleanLog = [];
  const sources = [];
  const src = (type, url, extra) => sources.push({ type, url, fetchedAt: new Date().toISOString(), ...extra });

  // ---- ① 基础信息(用于命名与检索) & ⑤ 净值序列 & ⑥ 经理履历
  onProgress('① 抓取基金概况…');
  const basic = await getBasicInfo(c);
  src('基金概况', `${BASE_F10}/jbgk_${c}.html`, { fields: ['全称', '类型', '管理公司', '基金经理', '业绩比较基准'] });

  onProgress('⑤ 抓取累计净值序列…');
  const nav = await getNavSeries(c);
  src('净值序列(日频)', `${BASE_FUND}/pingzhongdata/${c}.js`, { points: nav.accWorth.length });

  onProgress('⑥ 抓取基金经理履历…');
  let managerHistory = { rows: [], current: null, coManagedPeriods: [] };
  try {
    managerHistory = await getManagerHistory(c);
    src('基金经理履历', `${BASE_F10}/jjjl_${c}.html`, { rows: managerHistory.rows.length });
  } catch (e) { onProgress('  经理履历抓取失败, 跳过: ' + e.message); }

  // ---- ② 天天基金历史前十大
  const years = opts.years || 10;
  onProgress(`② 抓取前十大持仓(最近 ${years} 年)…`);
  let holdings = await getHoldings(c, { fromYear: new Date().getFullYear() - years + 1, onProgress });
  src('天天基金 F10 历史前十大', `${BASE_F10}/FundArchivesDatas.aspx?type=jjcc&code=${c}`, { quarters: holdings.length });
  if (!holdings.length) throw new CrawlError('未取到任何前十大持仓数据: ' + c);
  const allHoldings = holdings.slice();

  /* 人在口径确认表里选定的口径(SOP §0)优先: 用户明确指定了区间, 就不许引擎再自己挑一次。 */
  let rangeInfo;
  if (opts.gate1 && opts.gate1.confirmed) {
    const g = opts.gate1;
    const from = opts.fromPeriod || g.rangeFrom;
    const to = opts.toPeriod || g.rangeTo;
    rangeInfo = {
      auto: false,
      basis: `人工确认(SOP §0 口径确认表): ${g.managerLabel || '经理未标注'} · ${from} ~ ${to}` +
        (g.managerCoManaged ? ' · ⚠ 该任期含共管期, 业绩归因不能全归功于单人' : ''),
      from, to,
      humanConfirmed: true,
      confirmedAt: g.confirmedAt || null,
      managerLabel: g.managerLabel || '',
      managerStart: g.managerStart || '', managerEnd: g.managerEnd || '',
      managerCoManaged: !!g.managerCoManaged,
      benchmarkDeclared: g.benchmark || '',
      returnBasisDeclared: g.returnBasis || '',
      dataCutoffDeclared: g.dataCutoff || '',
      scopeDeclared: g.scope || '',
      outputDirDeclared: g.outputDir || '',
      candidates: []
    };
  } else {
  const rows = (managerHistory.rows || []).filter(r => r.start && r.managers && r.managers.length);
  const windowOf = (start, end) => {
    const e = end && !/至今/.test(end) ? end : null;
    const qs = allHoldings.filter(h => (!start || h.endDate >= start) && (!e || h.endDate <= e));
    return qs.length ? { from: qs[0].period, to: qs[qs.length - 1].period, n: qs.length } : null;
  };

  const candidates = [];
  rows.slice(0, 6).forEach((r, i) => {
    const w = windowOf(r.start, r.end);
    if (!w) return;
    candidates.push({
      id: 'tenure' + i,
      label: `${r.managers.join('+')}(${r.start} ~ ${r.end})`,
      isCurrent: i === 0 && /至今/.test(r.end || ''),
      coManaged: !!r.coManaged,
      tenure: r.tenure || '',
      ...w
    });
  });
  if (allHoldings.length) candidates.push({ id: 'all', label: '全部可取报告期', ...windowOf(allHoldings[0].endDate, null) });

  const cur = candidates.find(c => c.isCurrent);
  const longest = candidates.filter(c => c.id !== 'all').sort((a, b) => b.n - a.n)[0];

  let chosen = null, rangeReason = '';
  if (opts.fromPeriod) {
    chosen = { from: opts.fromPeriod, to: opts.toPeriod || null, n: null, label: '用户指定' };
    rangeReason = '用户指定区间';
  } else if (cur && cur.n >= 4) {
    chosen = cur;
    rangeReason = `现任经理任期(${cur.label})共 ${cur.n} 个报告期, 足以判定形态`;
  } else if (longest && longest.n >= 4) {
    chosen = longest;
    rangeReason = cur
      ? `现任经理任期仅 ${cur.n} 个报告期(不足 4 期, 无法判定形态), 已自动改用任期最长的一任: ${longest.label} 共 ${longest.n} 期`
      : `未识别到现任经理任期, 改用可取区间最长的一段: ${longest.label} 共 ${longest.n} 期`;
  } else if (candidates.length) {
    chosen = candidates[candidates.length - 1];
    rangeReason = `所有经理任期都不足 4 期, 改用全部可取报告期(${chosen.n} 期), 形态判定会标记为"样本不足"`;
  } else {
    throw new CrawlError('没有可用的报告期');
  }
  candidates.forEach(c => { c.recommended = chosen && c.id === chosen.id; });

  const autoRangeInfo = {
    auto: !opts.fromPeriod, basis: rangeReason, from: chosen.from, to: chosen.to || null,
    humanConfirmed: false,
    candidates: candidates.map(c => ({ id: c.id, label: c.label, from: c.from, to: c.to, n: c.n, isCurrent: !!c.isCurrent, coManaged: !!c.coManaged, recommended: !!c.recommended })),
    candidatesTotal: allHoldings.length
  };
  rangeInfo = autoRangeInfo;
  }

  const fromPeriod = rangeInfo.from;
  const toPeriod = rangeInfo.to || null;
  const requestedFrom = fromPeriod, requestedTo = toPeriod;
  holdings = holdings.filter(h => h.period >= fromPeriod);
  if (toPeriod) holdings = holdings.filter(h => h.period <= toPeriod);
  if (!holdings.length) throw new CrawlError('按区间 ' + fromPeriod + '–' + (toPeriod || '最新') + ' 过滤后没有数据');

  /* 边界对齐: 人工确认的区间端点未必都有前十大持仓数据(例如刚成立的季度只有季报没有完整持仓)。
     此时必须**如实记录被调整过**, 不能悄悄少算一期 —— 否则口径确认表写 32 期、报告出来 31 期, 人无从察觉。 */
  const actualFrom = holdings[0].period, actualTo = holdings[holdings.length - 1].period;
  if (actualFrom !== requestedFrom || (requestedTo && actualTo !== requestedTo)) {
    const why = [];
    if (actualFrom !== requestedFrom) why.push(`${requestedFrom} 无前十大持仓数据`);
    if (requestedTo && actualTo !== requestedTo) why.push(`${requestedTo} 无前十大持仓数据`);
    rangeInfo.adjusted = true;
    rangeInfo.requestedFrom = requestedFrom;
    rangeInfo.requestedTo = requestedTo;
    rangeInfo.adjustNote = `口径确认表填的是 ${requestedFrom} ~ ${requestedTo}, 但${why.join('、')}; 实际复盘区间对齐为 ${actualFrom} ~ ${actualTo}(共 ${holdings.length} 期)。`;
    rangeInfo.basis = (rangeInfo.basis || '') + ' · ' + rangeInfo.adjustNote;
  }
  rangeInfo.selected = holdings.length;
  rangeInfo.excludedBefore = allHoldings.filter(h => h.period < fromPeriod).length;

  // 区间前一季(前一任经理/共管期的末期), 报告里作为"接手前对照"
  const prevRaw = allHoldings.filter(h => h.period < fromPeriod).slice(-1)[0] || null;
  const prevTenure = prevRaw ? { period: prevRaw.period, endDate: prevRaw.endDate, top10: applyCleanRules(prevRaw.top10, cleanLog) } : null;

  // ---- ③ 资产配置
  onProgress('③ 抓取资产配置(股票/债券/现金占净比)…');
  let alloc = {};
  try {
    alloc = await getAssetAllocation(c);
    src('天天基金 资产配置', `${BASE_F10}/zcpz_${c}.html`, { periods: Object.keys(alloc).length });
  } catch (e) { onProgress('  资产配置抓取失败, 跳过: ' + e.message); }

  // ---- ④ 规模变动
  onProgress('④ 抓取规模变动…');
  const scale = await getScaleSeries(c);
  src('天天基金 规模变动', `${BASE_F10}/FundArchivesDatas.aspx?type=gmbd&code=${c}`, { rows: scale.length });
  const scaleByDate = {};
  scale.forEach(s => { scaleByDate[s.date] = s; });

  // ---- 组装季度序列(含 SOP 清洗三规则)
  onProgress('落盘清洗(SOP 清洗三规则)…');
  const quarters = holdings.map(h => {
    const sc = scaleByDate[h.endDate] || {};
    const al = alloc[h.period] || {};
    const top10 = applyCleanRules(h.top10, cleanLog);
    return {
      period: h.period,
      endDate: h.endDate,
      top10,
      top10Sum: Math.round(top10.reduce((s, x) => s + x.weight, 0) * 100) / 100,
      top5Sum: Math.round(top10.slice(0, 5).reduce((s, x) => s + x.weight, 0) * 100) / 100,
      theme: '', themeWeight: null,
      aum: sc.aum !== undefined ? sc.aum : (al.aum !== undefined ? al.aum : null),
      shares: sc.shares !== undefined ? sc.shares : null,
      purchase: sc.purchase !== undefined ? sc.purchase : null,   // 期间申购(亿份)
      redeem: sc.redeem !== undefined ? sc.redeem : null,         // 期间赎回(亿份)
      nav: null,
      stockPos: al.stockPos !== undefined ? al.stockPos : null,
      bondPos: al.bondPos, cashPos: al.cashPos,
      aumChange: sc.aumChange || '',
      retained: null, jaccard: null, added: [], dropped: []
    };
  });

  // ---- 绩效: 用「分红再投」总回报指数, 并以官方季报披露的净值增长率做校准(见 tools/calibrate_perf.mjs)
  const trIndex = buildTotalReturnIndex(nav.unitWorth, nav.accWorth);
  const perf = computePerfFromIndex(trIndex, quarters);
  const aums = quarters.map(q => q.aum).filter(x => typeof x === 'number');

  // ---- ① 官方报告 PDF: 抽取 + 逐行对账(SOP 质检的核心一条)
  let official = null;
  if (opts.verifyOfficial !== false) {
    onProgress('① 抓官方定期报告 PDF 并与第三方逐行对账…');
    try {
      official = await verifyAgainstOfficial(c, quarters, {
        everyN: opts.everyN || 4,
        maxFetch: opts.maxFetchOfficial || 4,
        all: opts.allOfficial === true,     // 全量取原文: 逐季绩效表 + 全部期逐行对账
        /* 多份额类别基金(A/C/E…)必须指名要哪一类, 否则绩效表会取到最后一类。
           简称尾字母是最可靠的线索: 页面上的"西部利得均衡优选混合A"就是 A 类。 */
        shareClass: (/([A-Z])$/.exec(String(basic.name || nav.name || '').trim()) || [, ''])[1]
      });
      official.checks.forEach(ck => {
        if (ck.url) src('官方定期报告 PDF', ck.url, { period: ck.period, bytes: ck.bytes, 对账: ck.reconcile ? (ck.reconcile.ok ? '逐行一致' : '有差异') : '未完成' });
      });
      official.notes.forEach(n => onProgress('  ' + n));
    } catch (e) {
      official = { available: false, pdftotext: !!findPdftotextSafe(), reports: [], checks: [], talks: [], sources: [], notes: ['官方对账异常: ' + e.message] };
    }
  }

  onProgress('整理底稿与来源清单…');
  const dataset = {
    schema: 'fundclinic/2',
    crawledAt: new Date().toISOString(),
    crawlMs: Date.now() - t0,
    crawlStandard: '六类公开来源: ①官方定期报告 PDF ②基金历史前十大 ③资产配置 ④规模变动 ⑤净值序列 ⑥基金经理履历',
    fund: {
      code: c,
      name: basic.name || nav.name || c,
      fullName: basic.fullName || '',
      company: basic.company || '',
      type: basic.type || '',
      manager: basic.manager || (nav.managers[0] || {}).name || '',
      managerSince: managerHistory.current ? `${managerHistory.current.start} 起` : ((nav.managers[0] || {}).workTime || ''),
      coManaged: managerHistory.coManagedPeriods.map(r => `${r.start}~${r.end} ${r.managers.join('+')}`),
      benchmark: basic.benchmark || '',
      inception: basic.inception || '',
      range: quarters[0].period + '–' + quarters[quarters.length - 1].period,
      quarterCount: quarters.length
    },
    perf: perf ? {
      cumReturn: perf.cumReturn, exBestQuarter: perf.exBestQuarter, bestQuarter: perf.bestQuarter,
      maxDrawdown: perf.maxDrawdown, aumPeak: aums.length ? Math.max(...aums) : null,
      aumEnd: aums.length ? aums[aums.length - 1] : null,
      /* 这里**不能**写"已验证/已校准"之类的断言 —— 抓取阶段还没跟官方窗口对过账。
         校准结论由 pipeline 的 calibrateAgainstOfficial() 在真正比对之后追加,
         否则就是一句无论有没有做都照写的假声明。 */
      note: perf.method + '。'
    } : null,
    perfDetail: perf,
    perfCalibration: opts.perfCalibration || null,   // 官方窗口校准结果(由 pipeline 填入)
    quarters,                       // 引擎/质检/报告的直接输入(统一 schema)
    prevTenure,                     // 区间前一季(前任/共管期末期), 作为接手前对照
    rangeInfo,                      // 复盘区间的选取依据(SOP 口径确认表要写清)
    allQuartersCount: allHoldings.length,
    managerHistory: managerHistory.rows,
    official,                       // 官方对账结果(含差异清单与经理原话)
    cleanLog,                       // SOP 清洗三规则的触发记录
    sources,                        // 来源清单: 每类带 URL + 抓取日期
    crawlLog: {
      quarters: quarters.length, navPoints: nav.accWorth.length, scaleRows: scale.length,
      allocPeriods: Object.keys(alloc).length, officialChecks: official ? official.checks.length : 0,
      cleanRulesFired: cleanLog.length, ms: Date.now() - t0
    }
  };

  return { dataset, basic, nav: { points: nav.accWorth.length, managers: nav.managers }, scaleRows: scale.length, official };
}

function findPdftotextSafe() {
  try { return !!findPdftotext(); } catch (e) { return false; }
}

