/* AI 模块的服务端执行: 用用户自己提供的 API Key 调用大模型。
 *
 * 为什么放到服务端: 浏览器从 file:// 或 http://localhost 直连第三方大模型接口会被 CORS 拦
 * (对方不返回 Access-Control-Allow-Origin), 这是环境限制而不是代码问题。
 * 放到服务端就没有这个限制, 而且 Key 只在本次请求的内存里用一次, 不落盘、不进日志。
 *
 * 三个任务都遵循同一条纪律: 大模型只做语言类工作, 输出必须过校验才允许进入报告。
 */
import { getFC } from './engine.mjs';

export class LLMError extends Error {
  constructor(msg, detail) { super(msg); this.name = 'LLMError'; this.detail = detail; }
}

function endpoint(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  if (!b) throw new LLMError('未提供 API Base URL');
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
}

export const DEFAULT_LLM = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };

/** 通用调用: 自定义 system/user, 可关掉 JSON 模式。
 *  为什么需要它: 演示稿要的是 **HTML**, 不是 JSON —— response_format=json_object 会把
 *  HTML 强行塞进 JSON 字符串里, 引号与换行都要转义, 模型很容易在这里失败或截断。 */
export async function callLLMRaw(cfg, { system, user, json = true, temperature, timeoutMs = 180000 } = {}) {
  const url = endpoint(cfg.baseUrl || DEFAULT_LLM.baseUrl);
  const model = cfg.model || DEFAULT_LLM.model;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const body = {
    model,
    temperature: temperature === undefined ? (cfg.temperature === undefined ? 0.2 : cfg.temperature) : temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  if (json) body.response_format = { type: 'json_object' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.apiKey || '') },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new LLMError(`大模型接口返回 HTTP ${res.status}`, text.slice(0, 400));
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new LLMError('大模型接口返回的不是 JSON', text.slice(0, 400)); }
    const choice = ((j.choices || [])[0] || {});
    const content = (choice.message || {}).content || '';
    return {
      ok: true, content, model: j.model || model, usage: j.usage || null,
      latencyMs: Date.now() - t0, finishReason: choice.finish_reason || ''
    };
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e.name === 'AbortError') throw new LLMError('大模型调用超时(' + timeoutMs + ' ms)');
    throw new LLMError('大模型调用失败: ' + e.message, String(e.cause && e.cause.message || ''));
  } finally {
    clearTimeout(timer);
  }
}

/** 调用 OpenAI 兼容的 chat/completions 接口(DeepSeek 官方: https://platform.deepseek.com )。 */
export async function callLLM(cfg, prompt, { timeoutMs = 120000 } = {}) {
  return callLLMRaw(cfg, {
    system: '你是严谨的金融分析助手, 只输出 JSON, 不要输出解释文字。',
    user: prompt, json: true, timeoutMs
  });
}

/** 轻量探活: 用最小请求验证 Base/模型/Key 是否可用。
 *  目的: 在花 8–10 秒爬取之前就把"Key 是错的/没余额/模型名写错"这类问题挡掉。 */
export async function pingLLM(cfg) {
  const t0 = Date.now();
  try {
    const r = await callLLM(cfg, '只输出 JSON: {"ok":true}', { timeoutMs: 30000 });
    const parsed = (() => { try { return JSON.parse(r.content); } catch (e) { return null; } })();
    return {
      ok: true, model: r.model, latencyMs: Date.now() - t0,
      usage: r.usage, sampleOk: !!(parsed && parsed.ok),
      note: parsed && parsed.ok ? '模型按 JSON 格式正常应答' : '模型已应答, 但未按要求的 JSON 格式返回(不影响使用, 后续任务会做格式容错)'
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e.message, detail: e.detail || '' };
  }
}

/** 跑一个 AI 任务: 组提示词 -> 调模型 -> 解析 JSON -> 过校验。返回 {ok, value, issues, raw, latencyMs, usage} */
export async function runTask(taskId, cfg, analysis, extra = {}) {
  const FC = getFC();
  const t = FC.ai.tasks[taskId];
  if (!t) throw new LLMError('未知任务: ' + taskId);
  const payload = FC.ai.buildPayload(taskId, analysis, extra);
  const prompt = FC.ai.buildPrompt(taskId, payload);

  const call = await callLLM(cfg, prompt);
  const parsed = FC.ai.parseJSON(call.content);
  if (!parsed.ok) {
    return {
      ok: false, taskId, name: t.name, value: null, raw: call.content.slice(0, 1200),
      issues: [{ level: 'fail', msg: '大模型返回的不是合法 JSON: ' + (parsed.error || '') }],
      latencyMs: call.latencyMs, usage: call.usage
    };
  }

  const ctx = { stockList: payload.stockList, formLibrary: payload.formLibrary, original: payload.text };
  /* 数字回查白名单: 不同的任务要查不同的集合 ——
     judgement 查指标包; deepReport 查整个证据包(它引用的数据面广得多)。
     漏了这一步的后果是"每个数字都被判成编造", 报告必然退回(实测踩过)。 */
  if (taskId === 'deepReport') {
    ctx.allowedNumbers = (extra && extra.evidence && extra.evidence.allowedNumbers) || {};
    if (!Object.keys(ctx.allowedNumbers).length) throw new LLMError('证据包缺少数字白名单, 无法做数字回查 —— 拒绝出报告');
  } else if (taskId === 'judgement') {
    const m = analysis.metrics;
    const s = {};
    const add = v => { if (typeof v === 'number' && isFinite(v)) { s[v.toFixed(2)] = 1; s[v.toFixed(1)] = 1; s[String(Math.round(v))] = 1; } };
    [m.conc.avg, m.conc.min, m.conc.max, m.conc.latest, m.conc.slope, m.avgRetained, m.avgAdded, m.avgJaccard,
     m.leader.avg, m.leader.max, m.totalDistinct, m.maxStreak, analysis.quarterCount].forEach(add);
    if (m.theme) add(m.theme.switches);
    if (analysis.perf) [analysis.perf.cumReturn, analysis.perf.exBestQuarter, analysis.perf.maxDrawdown, analysis.perf.bestQuarterContribution, analysis.perf.aumPeak, analysis.perf.aumEnd].forEach(add);
    ctx.allowedNumbers = s;
  }
  const v = FC.ai.validate(taskId, parsed.value, ctx);
  return {
    ok: v.ok, taskId, name: t.name, value: parsed.value, raw: call.content.slice(0, 1200),
    issues: v.issues, latencyMs: call.latencyMs, usage: call.usage, promptChars: prompt.length
  };
}

/** 把通过校验的主题归类写回 dataset(会重算指标与质检)。 */
export function applyThemeClassification(FC, dataset, mapping) {
  let applied = 0;
  (dataset.quarters || []).forEach(q => {
    const count = {};
    (q.top10 || []).forEach(h => { const t = mapping[h.name]; if (t) count[t] = (count[t] || 0) + h.weight; });
    const keys = Object.keys(count).sort((x, y) => count[y] - count[x]);
    if (keys.length) { q.theme = keys[0]; q.themeWeight = Math.round(count[keys[0]] * 100) / 100; applied++; }
  });
  return applied;
}

/** 把通过校验的判断卡合并进 analysis(不覆盖可核验的指标, 只替换语言部分)。 */
export function applyJudgement(FC, analysis, value, sources) {
  if (value.formTag) analysis.form.tag = value.formTag;
  if (value.mainQuestion) analysis.card.mainQuestion = value.mainQuestion;
  if (value.claim) analysis.card.claim = value.claim;
  if (value.falsifier) analysis.card.falsifier = value.falsifier;
  if (Array.isArray(value.evidenceUsed) && value.evidenceUsed.length) {
    analysis.form.reasons = value.evidenceUsed.concat(analysis.form.reasons);
  }
  // 结论卡变了, 报告要重生成
  analysis.report = FC.buildReport({
    fund: analysis.fund, quarters: analysis.quarters, m: analysis.metrics, form: analysis.form,
    perf: analysis.perf, cases: analysis.cases, card: analysis.card, trackers: analysis.trackers,
    sources: sources || [], range: analysis.range
  });
  return analysis;
}
