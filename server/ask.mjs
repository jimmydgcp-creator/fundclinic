/* 页面内问答：只答"这份报告里已经有的事"。
 *   上下文 = 报告产出的字段摘要（不是整份报告），每条字段带 id；
 *   模型回答后做两道校验：① 回答里的数字必须能在字段里找到 ② 引用 id 必须真实存在；
 *   预测涨跌 / 推荐基金 / 评价基金经理个人 —— 直接拒答。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLMRaw } from './pipeline-llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, '..', '_runs');

const REFUSAL = /预测|明天|下周|会涨|会跌|能不能买|该不该买|推荐|买入|卖出|加仓|清仓|值不值得|基金经理.*(水平|人品|能力)/;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

/** 把一次运行的产出压成"字段摘要"：每个值都带 id，模型只能引用这些 id */
export function buildDigest(code) {
  const dir = path.join(RUNS, code);
  const a = readJson(path.join(dir, 'analysis.json'));
  if (!a) return null;
  const check = readJson(path.join(dir, 'check.json'));
  const cardFile = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => f.startsWith('结论卡_') && f.endsWith('.json')) : null;
  const card = cardFile ? readJson(path.join(dir, cardFile)) : null;
  const fit = readJson(path.join(dir, 'fit.json'));

  const d = {};
  const put = (id, v, label) => { if (v !== undefined && v !== null) d[id] = { v, label }; };
  put('fund.name', a.fund && a.fund.name, '基金名称');
  put('fund.code', a.fund && a.fund.code, '基金代码');
  put('fund.manager', a.fund && a.fund.manager, '基金经理');
  put('range.text', a.range, '复盘区间');
  put('range.quarters', a.quarterCount, '报告期数');
  put('level', a.level, '结论层级');
  if (a.perf) {
    put('perf.cumReturn', a.perf.cumReturn, '区间收益(%)');
    put('perf.maxDrawdown', a.perf.maxDrawdown, '最大回撤(%)');
    put('perf.bestQuarter', a.perf.bestQuarter, '最优季度');
    put('perf.exBestQuarter', a.perf.exBestQuarter, '最优季度收益(%)');
    put('perf.bestQuarterContribution', a.perf.bestQuarterContribution, '最优季度对区间收益的贡献(%)');
  }
  if (a.metrics && a.metrics.conc) {
    put('conc.first', a.metrics.conc.first, '首期前十合计(%)');
    put('conc.latest', a.metrics.conc.latest, '末期前十合计(%)');
    put('conc.avg', a.metrics.conc.avg, '前十合计均值(%)');
  }
  if (a.metrics) {
    put('churn.avgRetained', a.metrics.avgRetained, '平均每期留存的旧股数');
    put('churn.avgAdded', a.metrics.avgAdded, '平均每期新进股数');
    put('holders.totalDistinct', a.metrics.totalDistinct, '出现过的不同股票数');
  }
  put('form.tag', a.card && a.card.formTag, '形态标签');
  put('form.confidence', a.card && a.card.formConfidence, '形态置信度');
  put('card.claim', a.card && a.card.claim, '核心结论');
  put('card.falsifier', a.card && a.card.falsifier, '推翻条件');
  put('kind.label', a.kind && a.kind.label, '产品类型');
  /* 拟合结果可能只落在 fit.json（还没重跑报告），两处都认 */
  const fd = (a.fit && a.fit.ok) ? a.fit : ((fit && fit.ok) ? fit : null);
  if (fd) {
    put('fit.corr', fd.fit && fd.fit.corr, '前十拟合相关性');
    put('fit.te', fd.fit && fd.fit.trackingErrorAnnual, '年化跟踪误差');
    put('fit.r2', fd.regression && fd.regression.r2, '回归R²');
    put('fit.alpha', fd.regression && fd.regression.alphaAnnual, '年化α');
    put('fit.weeks', fd.window && fd.window.weeks, '拟合周数');
    /* 拟合窗口的"实际 vs 理论"累计收益是这一节最常被问的两个数, 之前没进字段表,
       于是问"拟合一节里实际收益是多少"必被降级。fit.json 里存的是倍数(1.3073), 这里换成百分数。 */
    put('fit.actual', fd.fit && fd.fit.cumActual != null ? (fd.fit.cumActual - 1) * 100 : null, '拟合窗口实际累计收益(%)');
    put('fit.theory', fd.fit && fd.fit.cumTheory != null ? (fd.fit.cumTheory - 1) * 100 : null, '拟合窗口理论累计收益(%)');
  }
  if (check) {
    const rules = check.rules || check.items || [];
    put('check.total', Array.isArray(rules) ? rules.length : (check.total || null), '质检规则数');
    put('check.fail', check.failCount != null ? check.failCount : (check.summary && check.summary.fail), '未通过条数');
    put('check.verdict', check.verdict || (check.summary && check.summary.verdict), '质检结论');
  }
  if (card && card.check) put('card.check', card.check.verdict || card.check, '结论卡质检');

  const sections = (a.report && a.report.sections || []).map(s => s.title);
  return { code, fund: a.fund, range: a.range, digest: d, sections, hasFit: !!fd };
}

const SYSTEM = [
  '你是「基金复诊台」报告页里的问答助手。你的唯一任务：根据给定的字段摘要回答用户关于这只基金复盘的问题。',
  '硬规则：',
  '1. 只能使用 <字段> 里的值，不许引入任何外部知识，不许自己算新数字。',
  '2. 回答里出现的每个数字，后面必须紧跟〔字段id〕，例如 +76.80%〔perf.cumReturn〕。',
  '3. 字段里没有的，直接回答「报告里没有这项，看第 X 节原文更靠谱」，不要猜。',
  '4. 涉及未来涨跌、买卖建议、评价基金经理个人，一律拒绝，并说明这是回溯复盘、不构成投资建议。',
  '5. 中文口语，2 到 4 句，不要铺垫，不要重复问题。',
  '输出 JSON：{"answer":"...","refs":["字段id",...],"refused":false,"reason":""}'
].join('\n');

/** 校验：引用 id 必须存在；回答里的数字必须能在被引用字段里找到（允许 0.01 舍入）
 *
 * 2026-11-01 线上实测修过一次, 两个坑都是"把对的答案判成错的":
 *   ① 回答里出现"2020Q4–2026Q3"这种**季度标签**, 拆出来是 4、3 这种一位数,
 *      被当成"找不到出处的数字", 于是整条回答被降级成"我不敢直接给你" —— 用户看到的是坏体验,
 *      而回答本身完全没错。所以年份、6 位基金代码、一位数都不参与回查(和主报告里的判定口径对齐)。
 *   ② 字段里存的是 -0.3245(小数), 回答写"-32.45%"或"32.45%"都合法, 但白名单只算了
 *      v 和 |v| 和 v*100, 漏了 |v|*100 —— 正好就是"最大回撤 32.45%"这一种最常见的写法。 */
export function validateAnswer(answer, refs, digest) {
  const problems = [];
  const refsArr = Array.isArray(refs) ? refs.filter(r => digest[r]) : [];
  const safeAnswer = String(answer || '').replace(/(沪深|中证|上证|创业板指?|科创|纳斯达克|标普|恒生|国证)\s*\d{2,4}/g, ' ');
  const nums = (safeAnswer.match(/-?\d+(?:\.\d+)?/g) || []).filter(t =>
    !/^(19|20)\d\d$/.test(t) && !/^\d{6}$/.test(t) && !/^-?\d$/.test(t));
  /* 两级白名单(2026-11-01 线上第三次修): 先对被引用的字段, 对不上再去**全字段表**里找。
     只认被引用字段会造成这种误杀 —— 回答写"最大回撤 -32.45%〔perf.maxDrawdown〕,
     这是 24 个报告期里最差的", 其中 24 是 range.quarters, 而 refs 只列了两个字段,
     于是 24 被判"找不到出处", 整条回答降级成"我不敢直接给你"。
     用户的真实要求是"回答里的数字必须能在报告里找到", 不是"必须能被引用的字段覆盖",
     所以两处都找不到才算编造。 */
  const makePool = keys => {
    const pool = new Set();
    for (const r of keys) {
      const v = Number(digest[r] && digest[r].v);
      const vals = [v, Math.abs(v), v * 100, Math.abs(v) * 100];
      for (const x of vals) {
        const n = Number(x);
        if (isFinite(n)) { pool.add(n.toFixed(2)); pool.add(n.toFixed(1)); pool.add(String(Math.round(n))); }
      }
    }
    return pool;
  };
  const poolCited = makePool(refsArr.length ? refsArr : Object.keys(digest));
  const poolAll = refsArr.length ? makePool(Object.keys(digest)) : poolCited;
  const bad = nums.filter(n => {
    const f2 = Number(n).toFixed(2);
    const hit = pool => pool.has(f2) || pool.has(String(Math.round(Number(n))));
    return !hit(poolCited) && !hit(poolAll);
  });
  if (bad.length) problems.push('回答里有 ' + bad.length + ' 个数字找不到出处：' + bad.slice(0, 5).join('、'));
  if (refs && refs.length && !refsArr.length) problems.push('引用的字段 id 都不存在');
  return { ok: problems.length === 0, problems, refs: refsArr };
}

export async function askAboutRun(cfg, { code, question }) {
  const dg = buildDigest(code);
  if (!dg) return { ok: false, error: '这只基金还没有跑过复盘，先生成报告再提问（或直接问对比页）' };
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: '问题为空' };
  if (REFUSAL.test(q)) {
    return {
      ok: true, refused: true,
      answer: '这个问题超出了回溯复盘的范围：这份报告只陈述已经发生的事，不预测涨跌、不推荐买卖、也不评价基金经理个人。'
        + '如果你想问这只基金过去怎么走的、持仓怎么变的，我可以答。',
      refs: [], usage: null
    };
  }

  const user = '<字段>\n' + JSON.stringify(dg.digest, null, 1) + '\n</字段>\n\n报告小节：' + dg.sections.join(' / ')
    + '\n\n用户问题：' + q;

  let out;
  try {
    out = await callLLMRaw(cfg, { system: SYSTEM, user, json: true, temperature: 0.2, timeoutMs: 60000 });
  } catch (e) {
    return { ok: false, error: '模型调用失败：' + e.message };
  }
  let v = {};
  try { v = JSON.parse(out && out.content || '{}'); } catch (e) { v = { answer: String(out && out.content || '').slice(0, 800) }; }
  const answer = (v && v.answer) || '';
  const refs = (v && v.refs) || [];
  if (!answer) return { ok: false, error: '模型没有给出可用回答' };
  const chk = validateAnswer(answer, refs, dg.digest);
  if (!chk.ok) {
    return {
      ok: true, refused: false, degraded: true,
      answer: '这条回答里有数字没能在报告字段里对上，我不敢直接给你，先把原文摆出来：\n' + answer,
      refs: chk.refs, problems: chk.problems, usage: out && out.usage || null
    };
  }
  return { ok: true, refused: !!(v && v.refused), answer, refs: chk.refs, usage: out && out.usage || null };
}
