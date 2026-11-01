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

/* 各任务的超时上限(毫秒)。默认 120 秒对短任务够, 但对**输出很长**的任务不够:
   2026-11-01 端到端实跑时 T5 深度复盘报告(10 节 Markdown)在 120 秒被掐断,
   报错是"大模型调用超时(120000 ms)", 后果是整份深度复盘报告缺失 —— 交付物少一件,
   而页面上只显示一行"调用失败", 很容易被当成网络问题忽略过去。
   长文任务给 5 分钟: 慢一点没关系, 掐断了就是白跑。 */
const TASK_TIMEOUT_MS = { deepReport: 300000, polish: 180000 };

/* 数字回查白名单的"够用"标准(2026-11-01 端到端实跑修正)。
 *
 * 早先白名单只登记少数几个指标值, 且**只登记原样写法**: 回撤 -0.3245 只出 "-0.32 / -0.3 / 0",
 * 于是模型老老实实写"最大回撤 32.45%"就被判成**疑似编造**, 两条 AI 成文任务因此长期被退回:
 *   T2 判断起草: "5 个数字在指标包中不存在: 0.45、11、32.45、1.8、519191"
 *   T5 深度报告: "23 个数字未能在证据包中找到出处: 77.08、21.60、103.27…"
 * 这些数字没一个是编的 —— 32.45 就是 -0.3245 取绝对值再换百分数, 77.08 是净值序列里算出来的累计收益。
 *
 * 所以白名单按两条规则扩:
 *   ① 同一个数允许出现为 正/负/绝对值/百分数 四种写法(模型没法反推出你存的量纲);
 *   ② 证据包/指标包里**字面出现过的数字**一律允许 —— 它本身就可溯源, 卡它没有意义。
 * 白名单变宽会略微降低"抓编造"的严格度, 但换来的是"不把合规输出误判成编造":
 * 前者是漏报(可接受, 后面还有人工复核), 后者是**误杀**(直接让交付物缺失), 代价更大。 */
function expandAllowedNumbers(base, payloadText) {
  const out = {};
  const put = v => {
    if (!isFinite(v)) return;
    [v, -v, v * 100, -v * 100].forEach(x => {
      out[x.toFixed(2)] = 1; out[x.toFixed(1)] = 1; out[String(Math.round(x))] = 1;
    });
  };
  Object.keys(base || {}).forEach(k => {
    out[k] = 1;
    const v = Number(k);
    if (isFinite(v)) put(v);
  });
  (String(payloadText || '').match(/-?\d+(?:\.\d+)?/g) || []).forEach(t => {
    out[t] = 1;
    const v = Number(t);
    if (isFinite(v)) put(v);
  });
  return out;
}

/* 校验失败后**带着失败原因重写一次**。
 *
 * 为什么要有这一步(2026-11-01 四次真跑总结): 大模型被退回时, 写的人(模型)根本不知道
 * 自己错在哪 —— 我们只把"未通过校验"记进日志, 然后整节不要了。于是:
 *   · T5 深度复盘报告 4 次全被拦(一次违禁词、一次 46 个自算数字), 交付物少一件;
 *   · T2 判断起草、T3 用词清洗在同一个模型上时好时坏, 全靠运气。
 * 而退回原因是**机器可读的**(哪个数字、哪个词、缺哪一节), 直接回灌给模型, 让它只改这些,
 * 通过率会高得多 —— 这是"修复"而不是"放宽": 数字回查、违禁词、骨架这些闸门一个没动。
 *
 * 每个任务最多重写 1 次(FUNDCLINIC_AI_REPAIR=0 可关): 再多就是烧钱, 且说明任务本身没设计好。
 * 重写失败的返回里会同时带上第一次的问题, 报告里能看出"改了一次还是不行"。 */
function repairHint(issues) {
  const fails = (issues || []).filter(i => i && i.level === 'fail');
  if (!fails.length) return '';
  return '\n\n## 上一次输出被退回(不要解释, 直接改)\n'
    + '上一份输出没有通过自动校验, 具体问题如下。请**只修这些问题**, 其余内容、结构、口径照旧, 重新输出完整 JSON:\n'
    + fails.map((f, i) => (i + 1) + '. ' + String(f.msg || '').replace(/\n/g, ' ')).join('\n')
    + '\n\n提醒: 数字只能用证据/指标包里原样出现过的写法; 派生数字用定性表述; 上面列出的违禁词一个都不要出现。';
}

function sumUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = { ...a };
  ['prompt_tokens', 'completion_tokens', 'total_tokens'].forEach(k => {
    if (a[k] != null || b[k] != null) out[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0);
  });
  return out;
}

/** 跑一个 AI 任务: 组提示词 -> 调模型 -> 解析 JSON -> 过校验 -> (没过就带着原因重写一次) -> 再过校验。
 *  返回 {ok, value, issues, raw, latencyMs, usage, repaired?, firstIssues?} */
export async function runTask(taskId, cfg, analysis, extra = {}) {
  const FC = getFC();
  const t = FC.ai.tasks[taskId];
  if (!t) throw new LLMError('未知任务: ' + taskId);
  const payload = FC.ai.buildPayload(taskId, analysis, extra);
  const prompt = FC.ai.buildPrompt(taskId, payload);
  const timeoutMs = TASK_TIMEOUT_MS[taskId] || 120000;
  const maxRepair = process.env.FUNDCLINIC_AI_REPAIR === '0' ? 0 : 1;

  const ctx = { stockList: payload.stockList, formLibrary: payload.formLibrary, original: payload.text };
  /* 数字回查白名单: 不同的任务要查不同的集合 ——
     judgement 查指标包; deepReport 查整个证据包(它引用的数据面广得多)。
     漏了这一步的后果是"每个数字都被判成编造", 报告必然退回(实测踩过)。 */
  if (taskId === 'deepReport') {
    const ev = (extra && extra.evidence) || {};
    if (!ev.allowedNumbers || !Object.keys(ev.allowedNumbers).length) throw new LLMError('证据包缺少数字白名单, 无法做数字回查 —— 拒绝出报告');
    ctx.allowedNumbers = expandAllowedNumbers(ev.allowedNumbers, JSON.stringify(ev));
  } else if (taskId === 'judgement') {
    const m = analysis.metrics;
    const s = {};
    const add = v => { if (typeof v === 'number' && isFinite(v)) { s[v.toFixed(2)] = 1; s[v.toFixed(1)] = 1; s[String(Math.round(v))] = 1; } };
    [m.conc.avg, m.conc.min, m.conc.max, m.conc.latest, m.conc.slope, m.avgRetained, m.avgAdded, m.avgJaccard,
     m.leader.avg, m.leader.max, m.totalDistinct, m.maxStreak, analysis.quarterCount].forEach(add);
    if (m.theme) add(m.theme.switches);
    if (analysis.perf) [analysis.perf.cumReturn, analysis.perf.exBestQuarter, analysis.perf.maxDrawdown, analysis.perf.bestQuarterContribution, analysis.perf.aumPeak, analysis.perf.aumEnd].forEach(add);
    /* 只用指标包与绩效的紧凑摘要来扩白名单 —— 别把整份 analysis(含 24 期逐笔持仓)丢进去,
       那样能扩出几十万个键, 既慢又失去"这是核心判断"的焦点。 */
    ctx.allowedNumbers = expandAllowedNumbers(s, JSON.stringify({ metrics: analysis.metrics, perf: analysis.perf }));
  }

  let promptNow = prompt;
  let totalMs = 0;
  let usage = null;
  let firstIssues = null;
  let lastRaw = '';
  let lastValue = null;

  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    const call = await callLLM(cfg, promptNow, { timeoutMs });
    totalMs += call.latencyMs;
    usage = sumUsage(usage, call.usage);
    lastRaw = call.content || '';

    const parsed = FC.ai.parseJSON(lastRaw);
    let issues;
    if (!parsed.ok) {
      issues = [{ level: 'fail', msg: '大模型返回的不是合法 JSON: ' + (parsed.error || '') }];
    } else {
      lastValue = parsed.value;
      const v = FC.ai.validate(taskId, parsed.value, ctx);
      if (v.ok) {
        return {
          ok: true, taskId, name: t.name, value: parsed.value, raw: lastRaw.slice(0, 1200),
          issues: v.issues, latencyMs: totalMs, usage, promptChars: prompt.length,
          repaired: attempt > 0 ? true : undefined, repairAttempts: attempt,
          firstIssues: attempt > 0 ? firstIssues : undefined
        };
      }
      issues = v.issues;
    }

    if (attempt === 0) firstIssues = issues;
    const hint = repairHint(issues);
    /* 没有失败项(只有 warn)就别重写了 —— 那本来就是要通过并留痕的 */
    if (!hint) {
      return {
        ok: false, taskId, name: t.name, value: lastValue, raw: lastRaw.slice(0, 1200),
        issues, latencyMs: totalMs, usage, promptChars: prompt.length, repairAttempts: attempt
      };
    }
    promptNow = prompt + hint;
  }

  return {
    ok: false, taskId, name: t.name, value: lastValue, raw: lastRaw.slice(0, 1200),
    issues: (firstIssues || []).concat([{ level: 'info', msg: `已按校验意见重写 ${maxRepair} 次, 仍未通过 —— 判定本节不产出(不用套话填充)。` }]),
    latencyMs: totalMs, usage, promptChars: prompt.length, repairAttempts: maxRepair,
    firstIssues
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
