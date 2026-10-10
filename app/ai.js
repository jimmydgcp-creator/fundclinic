/* 基金复诊台 · AI 模块
 * 三个任务(每个都写清 输入 / 输出 / 错了怎么发现):
 *   T1 主题归类       输入: 个股清单            输出: JSON 映射        校验: 覆盖率 + 数量守恒
 *   T2 核心判断起草   输入: 结构化指标包        输出: JSON 判断卡      校验: 数字回查 + 违禁词 + 必填字段
 *   T3 对外用词清洗   输入: 报告纯文本          输出: 清洗文本         校验: 违禁词复扫
 *
 * 两条通道:
 *   通道 A · 离线规则引擎(默认, 确定性, 零配置, file:// 可用)
 *   通道 B · 大模型(直连 OpenAI 兼容接口 / 或"手动中转": 复制提示词到任意大模型, 把 JSON 贴回来)
 * 为什么要有通道 B 的手动中转: 浏览器从 file:// 直连第三方 API 会被 CORS 拦(对方不返回 Access-Control-Allow-Origin),
 *   这是环境限制而不是设计缺陷; 手动中转在任何环境都能跑通, 课堂演示不会翻车。
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var TASKS = {
    theme_classify: {
      id: 'theme_classify', name: 'T1 · 主题归类',
      input: '去重后的持仓个股清单(名称 / 代码 / 历史最高权重)',
      output: 'JSON: {"mapping":{"股票名称":"主题"}, "uncertain":["无法确定的股票名"]}',
      howToDetectError: '① 覆盖率检查: 返回的映射必须覆盖输入清单的 ≥95%; ② 数量守恒: 映射键不得出现清单之外的股票(幻觉新增即判失败); ③ 人工确认: 归类结果进报告前须由人过目, 因为"主题"是主观口径。'
    },
    judgement: {
      id: 'judgement', name: 'T2 · 核心判断起草',
      input: '引擎算出的指标包(集中度/留存/主题/龙头/规模/案例) + 结论卡模板',
      output: 'JSON: {"formTag","mainQuestion","claim","falsifier","evidenceUsed":[],"caveats":[]}',
      howToDetectError: '① 字段完整性: 五个必填字段缺一即失败; ② 数字回查: claim/falsifier 里出现的每个数字必须在指标包里存在, 否则视为编造; ③ 违禁词扫描; ④ 形态标签必须落在形态库(含兜底条款)之内, 不许自创; ⑤ 人工门禁: 判断方向由人确认后才进入报告。'
    },
    polish: {
      id: 'polish', name: 'T3 · 对外用词清洗',
      input: '报告纯文本',
      output: 'JSON: {"cleaned":"清洗后的全文","replaced":[{"from":"","to":""}]}',
      howToDetectError: '清洗结果回扫一遍违禁词表, 必须 0 命中; 且长度不得少于原文的 90%(防止大模型把内容"洗没了"); **数字守恒**: 逐个数字比对, 改掉任何一个即作废。'
    },
    synthesis: {
      id: 'synthesis', name: 'T4 · 结论提炼(可复制 × 不能被神化)',
      input: '本次复盘的指标包 + 形态标签 + 成败案例 + 跟踪清单',
      output: 'JSON: {"replicable":["…","…"],"risks":["…","…"],"basis":"一句话说明依据"}',
      howToDetectError: '① 两组各 2–5 条, 缺一即失败; ② 每条 8–110 字, 太长说明在灌水; ③ 违禁词扫描; ④ 数字回查: 条目里出现的数字必须在指标包里存在, 否则视为编造; ⑤ 禁止收益预期("预计/有望/将会/未来一年")。全部通过才写进报告, 不通过则本节**整节删除**, 不用套话填充。'
    },
    deepReport: {
      id: 'deepReport', name: 'T5 · 深度复盘报告成文(agent 主笔)',
      input: '证据包(官方逐季绩效与基准、规模与申赎轨迹、逐季前十大与轮动、经理原话与下一期动作、成败案例、对账记录)',
      output: 'JSON: {"markdown":"完整的复盘报告(Markdown, 按固定 10 节骨架)"}',
      howToDetectError: '① **数字回查**: 全文出现的每个数字都必须能在证据包里找到, 找不到即判编造并退回; ② 骨架完整: 固定 10 节逐节存在; ③ 违禁词与前瞻扫描(预计/有望/建议买入等一律不许); ④ 核心判断必须带可证伪条件与至少一条反证; ⑤ 长度下限(防止糊弄成摘要)。全部通过才落盘为正式报告。'
    }
  };

  /* ------------------------------------------------------------ 提示词 */
  var SYSTEM_RULES = [
    '你是公募基金持仓回溯复盘的分析助手, 面向基民、基金公司初步评价考核与 FOF 初步评价。',
    '硬规则:',
    '1. 只陈述已发生的事实与可验证的推断, 禁止任何对未来收益的判断、暗示或承诺;',
    '2. 禁止使用以下表述: 马后炮、抄底、逃顶、精准预测、封神、必涨、稳赚 —— 对应改写为: 回溯复盘、低位布局、高位减持、事后可核验的推断;',
    '3. 每个结论必须区分证据级别: 披露事实 / 合理推断 / 事后解读; "事后解读"必须显式标注;',
    '4. 每个判断必须给出可证伪的推翻条件, 不能只给结论;',
    '5. 只看前十大持仓(季报口径), 且是期末快照, 期间买卖不可见 —— 不许把期末持仓说成"持有了一整季";',
    '6. 严格输出 JSON, 不要输出解释性文字、不要用 markdown 代码块包裹。'
  ].join('\n');

  FC.ai = {};
  FC.ai.tasks = TASKS;

  FC.ai.buildPrompt = function (taskId, payload) {
    var t = TASKS[taskId];
    if (!t) return null;
    var body = '';
    if (taskId === 'theme_classify') {
      body = '任务: 把下列个股按申万一级/二级行业或市场通用主题归类。\n' +
        '要求: 只做归类, 不做投资评价; 拿不准的股票放进 uncertain 数组, 不要猜。\n\n' +
        '个股清单(名称 | 代码 | 历史最高权重%):\n' + payload.stockList.map(function (s) { return '- ' + s.name + ' | ' + s.code + ' | ' + s.maxWeight; }).join('\n') +
        '\n\n输出 JSON: {"mapping":{"股票名称":"主题"}, "uncertain":[]}';
    } else if (taskId === 'judgement') {
      body = '任务: 基于下面的指标包, 起草一张"结论卡"与核心判断。\n' +
        '可选形态标签(必须从中选一个, 都不合适则填"未归类形态(走兜底条款)"):\n' +
        payload.formLibrary.join('、') + '\n\n' +
        '指标包(全部为引擎确定性计算结果, 只能引用这里的数字):\n' + JSON.stringify(payload.metrics, null, 1) +
        '\n\n输出 JSON: {"formTag":"","mainQuestion":"","claim":"","falsifier":"","evidenceUsed":[],"caveats":[]}';
    } else if (taskId === 'synthesis') {
      body = '任务: 基于下面的复盘材料, 写出两组成对的结论 —— 一组是"这次复盘里方法层面可复制的部分", 一组是"不能被神化的部分(风险与局限)"。\n' +
        '硬要求:\n' +
        '· 两组各 2–5 条, 每条 8–110 字, 一条只讲一件事, 不要写成分点小作文;\n' +
        '· 每一条都必须能指回本次的数据或事实, 不许出现材料里没有的数字;\n' +
        '· 不许出现"预计/有望/将会/未来一年/建议买入"这类预期或建议;\n' +
        '· 风险组必须真实承认本次复盘的局限(样本、只看前十大、快照性质、收益集中度等), 不许写空话;\n' +
        '· 不要复述形态标签和指标本身, 要写"这意味着什么"。\n\n' +
        '复盘材料:\n' + JSON.stringify(payload.synthesisInput, null, 1) +
        '\n\n输出 JSON: {"replicable":["…"],"risks":["…"],"basis":"一句话说明依据"}';
    } else if (taskId === 'deepReport') {
      body = '任务: 写一份**深度**的基金持仓回溯复盘报告(Markdown)。这不是填表, 是分析。\n\n' +
        '## 固定骨架(逐节写, 标题用 ## 一、二、…, 不许增删节)\n' +
        '1. 先说结论: 核心判断(可证伪, 一句话) + 3–5 条支撑(每条带数字与出处) + 1 条**最大反证**\n' +
        '2. 口径与证据边界(基金与经理、复盘区间与选取依据、业绩比较基准、收益口径、持仓口径、证据分级、两条措辞禁区)\n' +
        '3. 绩效总览(全期收益 / 剔除最好一季 / 相对基准超额 / 回撤 / 规模, 对照看、不挑好看的数字; 必须含年度超额表与逐季表)\n' +
        '4. 持仓结构演变(轮动主线: 阶段表 + 留存统计, 回答"是否每季推倒重来")\n' +
        '5. 方法论拆解(框架 / 估值 / 组合 / 能力圈, 每点配证据; 重点验证**知行是否合一**——用"经理原话 × 下一期实际动作"逐组对照)\n' +
        '6. 关键调仓案例审计(成功与失误**成对**出现, 每例写 当时信号 / 动作 / 结果 / 可复制性点评)\n' +
        '7. 最新一期结构与变化\n' +
        '8. 优势与局限(最值得学习的部分 × 不能被过度解读的部分, 成对写)\n' +
        '9. 结论与跟踪(核心判断的证实/证伪落点 + 未来验证清单)\n' +
        '10. 附录(逐季前十大索引表 + 数据来源清单)\n\n' +
        '## 硬规则(违反即退回重写)\n' +
        '· **一个数字都不许编**: 报告里出现的每个百分比/金额/倍数, 必须来自下面证据包, 或由证据包里的数字做**加减乘除**得到(注明算法);\n' +
        '· 收益、超额、回撤、规模等**每个数字都要带日期与口径**(如"2022 年 +43.65%, 官方季报披露值");\n' +
        '· **禁止任何前瞻**: 不写"预计/有望/将会/未来一年/建议买入/目标价"; 回溯报告只讲已发生的事与可验证推断;\n' +
        '· 区分证据级别: 披露事实 / 合理推断 / 事后解读; 事后解读必须显式标注;\n' +
        '· 两条措辞禁区: ①"新进前十大"≠"本季度刚买入"(可能自第 11 名升入); ②"退出前十大"≠"清仓/在最高点卖出"(季报只有期末快照, 无交易日期与成交价);\n' +
        '· 判断句必须有上文数据支撑; 找不到支撑的**删掉**或标"待验证假设";\n' +
        '· 不许空洞排比与形容词堆砌; 宁可少写一条, 不许凑字数;\n' +
        '· 篇幅: 正文 3000–6000 字(不含表格)。\n\n' +
        '## 证据包(唯一事实来源)\n' + JSON.stringify(payload.evidence, null, 1) +
        '\n\n输出 JSON: {"markdown":"完整报告 Markdown, 以 # 标题开头"}';
    } else if (taskId === 'polish') {
      body = '任务: 清洗下面这份复盘报告全文的对外用词, 其余内容一字不改。\n' +
        '要求: 不得删减信息, 不得改变任何数字, 只替换违规表述。\n\n' +
        '报告全文:\n' + payload.text +
        '\n\n输出 JSON: {"cleaned":"","replaced":[{"from":"","to":""}]}';
    }
    return SYSTEM_RULES + '\n\n' + body;
  };

  /* -------------------------------------------------- 输入打包(给 LLM) */
  FC.ai.buildPayload = function (taskId, analysis, extra) {
    extra = extra || {};
    if (taskId === 'theme_classify') {
      var seen = {};
      (analysis.metrics.holders || []).forEach(function (h) {
        if (seen[h.name]) return;
        seen[h.name] = 1;
        extra.list = extra.list || [];
        extra.list.push({ name: h.name, code: h.code, maxWeight: h.maxWeight });
      });
      extra.list = (extra.list || []).sort(function (a, b) { return b.maxWeight - a.maxWeight; });
      return { stockList: extra.list };
    }
    if (taskId === 'judgement') {
      var m = analysis.metrics;
      return {
        formLibrary: ['主题坚守型', '低换手长期持有型', '高频轮动型', '主题漂移型', '逐步集中型', '逐步分散型', '高集中赌注型', '均衡分散型', '单一重仓依赖型', '个股稳定 + 主题切换型', '未归类形态(走兜底条款)'],
        metrics: {
          基金: analysis.fund.name + '(' + analysis.fund.code + ')',
          区间: analysis.range,
          报告期数: analysis.quarterCount,
          前十合计权重_均值: r2(m.conc.avg), 前十合计权重_区间: [r2(m.conc.min), r2(m.conc.max)],
          前十合计权重_最新: r2(m.conc.latest), 集中度斜率_pp每期: r2(m.conc.slope),
          相邻期平均留存_只: r2(m.avgRetained), 相邻期平均新进_只: r2(m.avgAdded), 平均Jaccard: r2(m.avgJaccard),
          主导主题序列: m.theme.known ? m.theme.runs.map(function (x) { return x.theme + '(' + x.len + '期)'; }) : '未归类',
          主题切换次数: m.theme.switches,
          第一大重仓_均值: r2(m.leader.avg), 第一大重仓_最高: r2(m.leader.max),
          全期出现过的个股数: m.totalDistinct, 最长连续在榜_期: m.maxStreak,
          规模_首期至末期_亿元: m.scale ? [r2(m.scale.first), r2(m.scale.end)] : null,
          绩效: analysis.perf ? { 区间复利: analysis.perf.cumReturn, 剔除最好一季: analysis.perf.exBestQuarter, 最大回撤: analysis.perf.maxDrawdown } : '未提供, 不得推断任何绩效结论'
        }
      };
    }
    if (taskId === 'polish') {
      return { text: (analysis.report.sections || []).map(function (s) { return '## ' + s.title + '\n' + s.html.replace(/<[^>]+>/g, ''); }).join('\n\n') };
    }
    if (taskId === 'deepReport') {
      return { evidence: (extra && extra.evidence) || null };
    }
    if (taskId === 'synthesis') {
      var m2 = analysis.metrics;
      return {
        synthesisInput: {
          基金: analysis.fund.name + '(' + analysis.fund.code + ')',
          经理: analysis.fund.manager,
          区间: analysis.range,
          报告期数: analysis.quarterCount,
          形态标签: analysis.form.tag,
          判定依据: analysis.form.reasons,
          集中度: { 均值: r2(m2.conc.avg), 区间: [r2(m2.conc.min), r2(m2.conc.max)], 斜率: r2(m2.conc.slope) },
          换手: { 平均留存: r2(m2.avgRetained), 平均新进: r2(m2.avgAdded), 名单相似度: r2(m2.avgJaccard) },
          主题: m2.theme.known ? { 切换次数: m2.theme.switches, 链条: m2.theme.runs.map(function (x) { return x.theme + '(' + x.len + '期)'; }) } : '未归类',
          个股: { 出现过: m2.totalDistinct, 最长连续在榜: m2.maxStreak },
          绩效: analysis.perf ? {
            区间收益: analysis.perf.cumReturn, 剔除最好一季: analysis.perf.exBestQuarter,
            最好一季: analysis.perf.bestQuarter, 最好一季贡献占比: r2(analysis.perf.bestQuarterContribution),
            最大回撤: analysis.perf.maxDrawdown, 规模: [analysis.perf.aumPeak, analysis.perf.aumEnd]
          } : '本次未提供净值序列, 不判定绩效',
          成败案例: {
            靠前: (analysis.cases.wins || []).slice(0, 2).map(function (c) { return c.name + ' 持有期推算价 ' + r2(c.change) + '%'; }),
            靠后: (analysis.cases.fails || []).slice(0, 2).map(function (c) { return c.name + ' 持有期推算价 ' + r2(c.change) + '%'; })
          },
          已知边界: analysis.card.caveats,
          跟踪清单: analysis.trackers.map(function (t) { return t.item; })
        }
      };
    }
    return {};
  };
  function r2(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null; }

  /* -------------------------------------------------------- 大模型调用 */
  FC.ai.callLLM = function (cfg, prompt, onLog) {
    var started = Date.now();
    var url = String(cfg.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    var body = {
      model: cfg.model || 'deepseek-chat',
      temperature: cfg.temperature === undefined ? 0.2 : cfg.temperature,
      messages: [{ role: 'system', content: '你是严谨的金融分析助手, 只输出 JSON。' }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    };
    if (onLog) onLog({ stage: 'request', url: url, model: body.model, promptChars: prompt.length });
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.apiKey || '') },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + txt.slice(0, 300));
        var j = JSON.parse(txt);
        var content = (((j.choices || [])[0] || {}).message || {}).content || '';
        return {
          ok: true, content: content, latencyMs: Date.now() - started,
          usage: j.usage || null, model: j.model || body.model
        };
      });
    }).catch(function (e) {
      var isCors = String(e && e.message || '').indexOf('Failed to fetch') >= 0 || (e && e.name === 'TypeError');
      return {
        ok: false, latencyMs: Date.now() - started,
        error: isCors
          ? '请求被浏览器拦截(最可能是 CORS: 目标接口未返回 Access-Control-Allow-Origin)。这不是代码 bug。解决方式三选一: ① 改用"手动中转"通道(推荐, 零依赖); ② 在本机用 http 服务打开本项目(如 python -m http.server), 并确认接口允许该来源; ③ 换成允许浏览器直连的服务商。'
          : String(e && e.message || e)
      };
    });
  };

  /* --------------------------------------------------- 输出校验(核心) */
  FC.ai.validate = function (taskId, parsed, ctx) {
    var issues = [];
    if (!parsed || typeof parsed !== 'object') return { ok: false, issues: [{ level: 'fail', msg: '输出不是合法 JSON 对象。' }] };

    if (taskId === 'theme_classify') {
      var list = (ctx && ctx.stockList) || [];
      var map = parsed.mapping || {};
      var names = Object.keys(map);
      var listNames = list.map(function (s) { return s.name; });
      var covered = listNames.filter(function (n) { return map[n]; });
      var extra = names.filter(function (n) { return listNames.indexOf(n) < 0; });
      var cov = listNames.length ? covered.length / listNames.length * 100 : 0;
      if (cov < 95) issues.push({ level: 'fail', msg: '覆盖率仅 ' + cov.toFixed(1) + '%(<95%): ' + (listNames.length - covered.length) + ' 只股票未被归类。' });
      if (extra.length) issues.push({ level: 'fail', msg: '出现清单之外的股票 ' + extra.length + ' 只(疑似幻觉): ' + extra.slice(0, 5).join('、') });
      if (parsed.uncertain && parsed.uncertain.length) issues.push({ level: 'warn', msg: '模型自述 ' + parsed.uncertain.length + ' 只无法确定: ' + parsed.uncertain.slice(0, 5).join('、') + ' —— 需人工归类。' });
      issues.push({ level: cov >= 95 && !extra.length ? 'pass' : 'info', msg: '覆盖率 ' + cov.toFixed(1) + '%, 映射 ' + names.length + ' 条, 超出清单 ' + extra.length + ' 条。' });
      return { ok: !issues.some(function (i) { return i.level === 'fail'; }), issues: issues, coverage: cov };
    }

    if (taskId === 'judgement') {
      var need = ['formTag', 'mainQuestion', 'claim', 'falsifier'];
      var miss = need.filter(function (k) { return !parsed[k] || String(parsed[k]).trim() === ''; });
      if (miss.length) issues.push({ level: 'fail', msg: '必填字段缺失: ' + miss.join('、') });
      var lib = (ctx && ctx.formLibrary) || [];
      if (parsed.formTag && lib.length && lib.indexOf(parsed.formTag) < 0) issues.push({ level: 'fail', msg: '形态标签"' + parsed.formTag + '"不在形态库内(不许自创标签)。' });
      var blob = [parsed.claim, parsed.falsifier, parsed.mainQuestion].join(' ');
      var vocab = FC.scanVocab(blob);
      if (vocab.length) issues.push({ level: 'fail', msg: '命中违禁词: ' + vocab.map(function (v) { return v.word; }).join('、') });
      var allowed = (ctx && ctx.allowedNumbers) || {};
      var toks = (blob.match(/\d+(?:\.\d+)?/g) || []).filter(function (t) { return !/^\d{4}$/.test(t) && !/^[1-9]$/.test(t) && t !== '10'; });
      var bad = toks.filter(function (t) { return !allowed[t]; });
      if (bad.length) issues.push({ level: 'fail', msg: '数字回查失败, ' + bad.length + ' 个数字在指标包中不存在(疑似编造): ' + bad.slice(0, 8).join('、') });
      if (!/推翻|不成立|反之|若.*则/.test(String(parsed.falsifier || ''))) issues.push({ level: 'warn', msg: '推翻条件读起来不像可证伪条件, 建议改为"若 X 未达到, 则本判断降级"。' });
      issues.push({ level: 'info', msg: '数字回查: 共校验 ' + toks.length + ' 个数字, 全部命中指标包。' });
      return { ok: !issues.some(function (i) { return i.level === 'fail'; }), issues: issues, numbersChecked: toks.length };
    }

    if (taskId === 'deepReport') {
      var md = String(parsed.markdown || '').trim();
      if (!md) { issues.push({ level: 'fail', msg: 'markdown 为空' }); return { ok: false, issues: issues }; }
      if (md.length < 2500) issues.push({ level: 'fail', msg: '正文只有 ' + md.length + ' 字, 低于 2500 字下限 —— 这不像深度报告, 更像摘要' });

      var needSec = ['先说结论', '口径与证据边界', '绩效总览', '持仓结构演变', '方法论拆解', '关键调仓案例审计', '最新一期结构与变化', '优势与局限', '结论与跟踪', '附录'];
      var missSec = needSec.filter(function (t) { return md.indexOf(t) < 0; });
      if (missSec.length) issues.push({ level: 'fail', msg: '固定骨架缺节: ' + missSec.join('、') });
      else issues.push({ level: 'pass', msg: '固定骨架 10 节齐全。' });

      var vocab = FC.scanVocab(md);
      if (vocab.length) issues.push({ level: 'fail', msg: '命中违禁词: ' + vocab.map(function (v) { return v.word; }).join('、') });
      var fwd = md.match(/预计|有望|将会|未来一年|未来两年|建议买入|建议配置|目标价|必涨|稳赚/g);
      if (fwd) issues.push({ level: 'fail', msg: '出现前瞻或建议类字样 ' + fwd.length + ' 处: ' + [].slice.call(new Set(fwd)).slice(0, 6).join('、') + ' —— 回溯报告不许给前瞻' });

      if (!/反证|推翻|证伪/.test(md)) issues.push({ level: 'fail', msg: '没有可证伪条件或反证段落 —— 核心判断必须能被打脸' });

      /* 数字回查: 全文每个数字都要能在证据包里找到。
         这是"agent 写、规则验"的关键一环 —— 大模型最危险的就是顺手编一个像样的数字。 */
      var allowed = (ctx && ctx.allowedNumbers) || {};
      var body = md.replace(/```[\s\S]*?```/g, ' ');
      var toks = body.match(/\d+(?:\.\d+)?/g) || [];
      var bad = {}, badList = [];
      toks.forEach(function (t) {
        if (/^(19|20)\d\d$/.test(t)) return;
        if (/^\d{6}$/.test(t)) return;
        if (/^\d{1,2}$/.test(t)) return;
        if (allowed[t] || bad[t]) return;
        bad[t] = 1; badList.push(t);
      });
      if (badList.length) {
        issues.push({
          level: badList.length > 8 ? 'fail' : 'warn',
          msg: '数字回查: ' + badList.length + ' 个数字未能在证据包中找到出处' + (badList.length > 8 ? '(超过 8 个, 判为疑似编造, 退回重写)' : '(少量, 请人工确认是否由证据包数字推算得出)') + ': ' + badList.slice(0, 12).join('、')
        });
      } else {
        issues.push({ level: 'pass', msg: '数字回查通过: 全文 ' + toks.length + ' 个数字全部可溯源到证据包。' });
      }
      issues.push({ level: 'info', msg: '正文 ' + md.length + ' 字; 表格 ' + ((md.match(/^\|/gm) || []).length) + ' 行' });
      return { ok: !issues.some(function (i) { return i.level === 'fail'; }), issues: issues };
    }

    if (taskId === 'synthesis') {
      var rep = parsed.replicable, rsk = parsed.risks;
      var checkList = function (arr, label) {
        if (!Array.isArray(arr)) { issues.push({ level: 'fail', msg: label + ' 不是数组' }); return []; }
        if (arr.length < 2) issues.push({ level: 'fail', msg: label + ' 少于 2 条(要成对写, 不能只讲一面)' });
        if (arr.length > 5) issues.push({ level: 'fail', msg: label + ' 多于 5 条(过散, 请收敛到最关键几条)' });
        var badLen = [];
        arr.forEach(function (t) {
          var s = String(t || '').trim();
          if (s.length < 8) badLen.push('「' + s + '」太短(不足 8 字)');
          if (s.length > 110) badLen.push('「' + s.slice(0, 16) + '…」太长(' + s.length + ' 字 > 110)');
        });
        if (badLen.length) issues.push({ level: 'fail', msg: label + ' 条目长度不合规: ' + badLen.slice(0, 3).join('; ') });
        return arr.map(function (t) { return String(t || '').trim(); }).filter(Boolean);
      };
      var A = checkList(rep, '可复制部分');
      var B = checkList(rsk, '风险部分');

      var blob = A.concat(B).join(' ');
      if (!blob) { issues.push({ level: 'fail', msg: '两组合起来是空的' }); return { ok: false, issues: issues }; }

      var vocab = FC.scanVocab(blob);
      if (vocab.length) issues.push({ level: 'fail', msg: '命中违禁词: ' + vocab.map(function (v) { return v.word; }).join('、') });

      var fwd = blob.match(/预计|有望|将会|未来一年|未来两年|即将|建议买入|建议配置|看好后市|目标价/);
      if (fwd) issues.push({ level: 'fail', msg: '出现收益预期或投资建议字样「' + fwd[0] + '」—— 复盘报告不许给前瞻' });

      var allowed = (ctx && ctx.allowedNumbers) || {};
      var toks = (blob.match(/\d+(?:\.\d+)?/g) || []).filter(function (t) { return !/^\d{4}$/.test(t) && !/^[1-9]$/.test(t) && t !== '10' && t !== '100'; });
      var badNums = toks.filter(function (t) { return !allowed[t]; });
      if (badNums.length) issues.push({ level: 'fail', msg: '数字回查失败, ' + badNums.length + ' 个数字在本次指标包里不存在(疑似编造): ' + badNums.slice(0, 8).join('、') });
      else if (toks.length) issues.push({ level: 'pass', msg: '数字回查: ' + toks.length + ' 个数字全部命中指标包。' });

      issues.push({ level: 'info', msg: '可复制 ' + A.length + ' 条 / 风险 ' + B.length + ' 条' + (parsed.basis ? '; 依据: ' + String(parsed.basis).slice(0, 60) : '') });
      return { ok: !issues.some(function (i) { return i.level === 'fail'; }), issues: issues };
    }

    if (taskId === 'polish') {
      var cleaned = String(parsed.cleaned || '');
      var orig = String((ctx && ctx.original) || '');
      if (!cleaned) issues.push({ level: 'fail', msg: 'cleaned 字段为空。' });
      var hits = FC.scanVocab(cleaned);
      if (hits.length) issues.push({ level: 'fail', msg: '清洗后仍命中违禁词: ' + hits.map(function (h) { return h.word; }).join('、') });
      if (orig && cleaned.length < orig.length * 0.9) issues.push({ level: 'fail', msg: '清洗后长度仅为原文的 ' + (cleaned.length / orig.length * 100).toFixed(0) + '%, 疑似内容被删减。' });

      /* 数字守恒: "对外用词清洗"只允许改措辞, 一个数字都不许动。
         这是大模型最容易"顺手改掉"的地方, 所以逐个数比对, 而不是只看长度。 */
      if (orig) {
        var numOf = function (s) { return (s.match(/\d+(?:\.\d+)?/g) || []).slice().sort(); };
        var na = numOf(orig), nb = numOf(cleaned);
        if (na.join('|') !== nb.join('|')) {
          var lost = na.filter(function (x) { return nb.indexOf(x) < 0; });
          var added2 = nb.filter(function (x) { return na.indexOf(x) < 0; });
          issues.push({
            level: 'fail',
            msg: '数字被改动, 清洗结果作废 —— 原文 ' + na.length + ' 个数字, 清洗后 ' + nb.length + ' 个' +
              (lost.length ? '; 丢失: ' + lost.slice(0, 8).join('、') : '') +
              (added2.length ? '; 新增: ' + added2.slice(0, 8).join('、') : '')
          });
        } else {
          issues.push({ level: 'pass', msg: '数字守恒校验通过: ' + na.length + ' 个数字逐一比对, 清洗未改动任何数字。' });
        }
      }
      issues.push({ level: 'info', msg: '原文 ' + orig.length + ' 字符 → 清洗后 ' + cleaned.length + ' 字符, 替换 ' + ((parsed.replaced || []).length) + ' 处。' });
      return { ok: !issues.some(function (i) { return i.level === 'fail'; }), issues: issues };
    }
    return { ok: false, issues: [{ level: 'fail', msg: '未知任务: ' + taskId }] };
  };

  /** 从大模型返回的文本里抠 JSON(容忍 ```json 包裹) */
  FC.ai.parseJSON = function (text) {
    var t = String(text || '').trim();
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) t = fence[1].trim();
    try { return { ok: true, value: JSON.parse(t) }; }
    catch (e) {
      var s = t.indexOf('{'), e2 = t.lastIndexOf('}');
      if (s >= 0 && e2 > s) {
        try { return { ok: true, value: JSON.parse(t.slice(s, e2 + 1)) }; } catch (e3) { /* fallthrough */ }
      }
      return { ok: false, error: String(e && e.message || e), raw: t.slice(0, 400) };
    }
  };

  /* -------------------------------------------------------- 运行记录 */
  FC.ai.runLog = [];
  FC.ai.log = function (entry) {
    FC.ai.runLog.push(Object.assign({ at: new Date().toISOString() }, entry));
    if (FC.ai.onLog) FC.ai.onLog(FC.ai.runLog);
    return entry;
  };
  FC.ai.clearLog = function () { FC.ai.runLog = []; if (FC.ai.onLog) FC.ai.onLog(FC.ai.runLog); };

  FC.ai.runLogToMarkdown = function (analysis) {
    var L = ['# AI 模块运行记录(自动生成)', ''];
    L.push('- 生成时间: ' + new Date().toISOString());
    if (analysis) L.push('- 对象: ' + analysis.fund.name + '(' + analysis.fund.code + ') · ' + analysis.range + ' · ' + analysis.quarterCount + ' 期');
    L.push('');
    /* 最后一列原来叫"人工复核", 值都是"☐ 待人工打勾" —— 打勾已经从页面上拿掉了(见 ui.js 质检页注释),
       现在这一列记的是备注(口径/拦截原因/是否改判), 所以列名也跟着改。 */
    L.push('| 时间 | 通道 | 任务 | 输入摘要 | 输出摘要 | 耗时 | 校验 | 备注 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    if (!FC.ai.runLog.length) L.push('| — | — | — | 本次未调用大模型 | — | — | — | — |');
    FC.ai.runLog.forEach(function (e) {
      L.push('| ' + e.at + ' | ' + (e.channel || '—') + ' | ' + (e.task || '—') + ' | ' + String(e.input || '').replace(/\|/g, '/').slice(0, 60) +
        ' | ' + String(e.output || '').replace(/\|/g, '/').slice(0, 80) + ' | ' + (e.latencyMs !== undefined ? e.latencyMs + ' ms' : '—') +
        ' | ' + (e.valid === undefined ? '—' : (e.valid ? '通过' : '**未通过**')) + ' | ' + (e.manual || '—') + ' |');
    });
    L.push('');
    L.push('## 通道说明');
    L.push('');
    L.push('- **通道 A · 离线规则引擎**: 确定性计算, 无网络依赖, 同一输入结果逐位相同, 可复现;');
    L.push('- **通道 B · 大模型**: 承担"主题归类 / 判断起草 / 用词清洗"三类语言任务, 全部输出经上述校验后才可进入报告;');
    L.push('- 大模型输出**不直接进入最终报告**: 每一步输出都必须先过校验(数字回查 / 覆盖率 / 违禁词 / 数字守恒), 不通过一律拦截 —— 报告中留下的是规则引擎的结论, 上面按步记录了"哪一步被拦、为什么"。');
    return L.join('\n');
  };

})(window.FC);
