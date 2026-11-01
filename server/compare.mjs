/* 多基金对比（最多 3 只，用户输代码）：
 *   只抓"净值序列 + 概况"，不跑完整复盘 —— 对比要的是曲线和区间指标，不需要跑 6 分钟。
 *   若这只基金此前跑过完整复盘（_runs/<code>/analysis.json 存在），就顺带把形态标签与期数带出来。
 *   口径：分红再投总回报指数（与主流程一致，不用累计净值）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNavSeries, getBasicInfo, buildTotalReturnIndex, ymd } from './sources.mjs';
import { getFC } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, '..', '_runs');
const MAX_CODES = 3;

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = a => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1));
};

function trSeries(nv) {
  return buildTotalReturnIndex(nv.unitWorth, nv.accWorth).map(p => ({ d: ymd(p.t), v: p.nav }));
}

/** 缓存净值序列，避免每次对比都重抓（3 天内复用） */
async function loadSeries(code) {
  const cache = path.join(RUNS, code, 'navSeries.json');
  try {
    const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (j && Array.isArray(j.series) && j.series.length > 100 && Date.now() - (j.savedAt || 0) < 3 * 86400000) {
      return { series: j.series, cached: true };
    }
  } catch (e) { /* 没缓存就抓 */ }
  const nv = await getNavSeries(code);
  const series = trSeries(nv);
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ code, savedAt: Date.now(), series }), 'utf8');
  } catch (e) { /* 落盘失败不影响返回 */ }
  return { series, cached: false };
}

function sliceSeries(series, from, to) {
  return series.filter(p => p.d >= from && p.d <= to);
}

function metricsOf(pts) {
  if (pts.length < 20) return null;
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const cum = last / first - 1;
  const days = Math.max(1, (new Date(pts[pts.length - 1].d) - new Date(pts[0].d)) / 86400000);
  const ann = Math.pow(last / first, 365 / days) - 1;
  let peak = -Infinity, mdd = 0;
  for (const p of pts) {
    if (p.v > peak) peak = p.v;
    const dd = p.v / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  const rets = [];
  for (let i = 1; i < pts.length; i++) rets.push(pts[i].v / pts[i - 1].v - 1);
  return {
    cumReturn: cum, annualized: ann, maxDrawdown: mdd,
    volAnnual: std(rets) * Math.sqrt(252),
    points: pts.length, from: pts[0].d, to: pts[pts.length - 1].d
  };
}

/** 抽稀到 ≤ 220 个点，起点归一为 100（图上三只基金同起点） */
function normalizeSample(pts, maxPoints = 220) {
  if (!pts.length) return [];
  const base = pts[0].v;
  const step = Math.max(1, Math.ceil(pts.length / maxPoints));
  const out = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push({ d: pts[i].d, v: Math.round((pts[i].v / base) * 10000) / 100 });
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1].d !== last.d) out.push({ d: last.d, v: Math.round((last.v / base) * 10000) / 100 });
  return out;
}

export async function compareFunds(codes) {
  const FC = getFC();
  const list = [...new Set((codes || []).map(c => String(c || '').trim()).filter(c => /^\d{6}$/.test(c)))].slice(0, MAX_CODES);
  if (!list.length) throw new Error('请至少输入一个 6 位基金代码');

  const warnings = [];
  const raw = [];
  for (const code of list) {
    try {
      const [{ series }, info] = await Promise.all([loadSeries(code), getBasicInfo(code).catch(() => ({}))]);
      if (!series || series.length < 60) { warnings.push(code + '：净值序列太短，跳过'); continue; }
      let form = null, quarters = null, hadRun = false;
      try {
        const a = JSON.parse(fs.readFileSync(path.join(RUNS, code, 'analysis.json'), 'utf8'));
        form = (a.card && a.card.formTag) || (a.form && a.form.tag) || null;
        quarters = a.quarterCount || null;
        hadRun = true;
      } catch (e) { /* 没复盘过 */ }
      const kind = FC.detectFundKind({ name: info.name || code, type: info.type || '' });
      raw.push({
        code,
        name: info.name || code,
        manager: info.manager || '',
        type: info.type || '',
        kind: { code: kind.code, label: kind.label, isPassive: kind.isPassive },
        form, quarters, hadRun,
        series
      });
    } catch (e) {
      warnings.push(code + '：' + e.message);
    }
  }
  if (!raw.length) throw new Error('这几只基金都抓不到净值序列' + (warnings.length ? '（' + warnings.join('；') + '）' : ''));

  /* 共同区间取交集：不同成立时间的基金只比重叠部分，避免拿晚成立的基金"少算一段" */
  const from = raw.map(r => r.series[0].d).sort().pop();
  const to = raw.map(r => r.series[r.series.length - 1].d).sort()[0];
  if (from >= to) throw new Error('这几只基金的净值区间没有重叠（' + from + ' / ' + to + '）');

  const funds = raw.map(r => {
    const pts = sliceSeries(r.series, from, to);
    const m = metricsOf(pts);
    if (!m || m.points < 60) warnings.push(r.code + '：可比交易日只有 ' + (m ? m.points : 0) + ' 个，样本不足');
    return {
      code: r.code, name: r.name, manager: r.manager, type: r.type,
      kind: r.kind, form: r.form, quarters: r.quarters, hadRun: r.hadRun,
      metrics: m,
      series: normalizeSample(pts),
      insufficient: !m || m.points < 60
    };
  });

  const overlapDays = Math.round((new Date(to) - new Date(from)) / 86400000);
  if (overlapDays < 180) warnings.push('共同区间只有 ' + overlapDays + ' 天，结论参考价值有限');

  return {
    ok: true,
    window: { from, to, days: overlapDays },
    basis: '分红再投总回报指数，起点归一为 100',
    funds,
    warnings
  };
}
