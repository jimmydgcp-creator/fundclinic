/* 端到端编排: 一个基金代码 -> 爬取(按 SOP §2 六类来源) -> 引擎分析 -> 质检 -> 报告 MD -> 演示稿 HTML/PDF。
 * 每一步的产物都落盘到 _runs/<代码>/, 便于"运行记录"留痕与事后复查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { crawlFund } from './sources.mjs';
import { getFC, analyzeDataset, ROOT } from './engine.mjs';
import { renderDeck } from './deck.mjs';
import { runTask, applyThemeClassification, applyJudgement } from './pipeline-llm.mjs';
import { buildEvidence } from './evidence.mjs';
import { popplerInstallNote } from './official.mjs';

const RUNS = path.join(ROOT, '_runs');
fs.mkdirSync(RUNS, { recursive: true });

export function runDir(code) {
  const d = path.join(RUNS, String(code));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 传给前端的底稿元信息(不含 230 行明细), /api/run 与落盘恢复共用同一份形状。
 *  单独导出是为了让"补建历史索引"的工具也用同一份逻辑, 避免两处形状走偏。 */
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

export function findEdge() {
  return [
    // Windows
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    // macOS: 浏览器都在 .app 包里, 真正的可执行文件在 Contents/MacOS/ 下。
    // 以前只写 /usr/bin/google-chrome(Linux 的位置), Mac 上永远找不到 →
    // 演示稿 PDF 静默不导出。组员是 Mac, 必须补上。
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].find(p => fs.existsSync(p)) || null;
}

/**
 * 主流程。
 * @param {string} code 6 位基金代码
 * @param {object} opts { years, fromPeriod, toPeriod, onProgress, ai:{enabled,baseUrl,model,apiKey,tasks}, pdf }
 */
export async function runPipeline(code, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const t0 = Date.now();
  const steps = [];
  const step = (name, detail) => { steps.push({ name, detail, at: new Date().toISOString() }); onProgress(name + (detail ? ' · ' + detail : '')); };

  // ---------- 1. 爬取(六类公开来源) ----------
  /* 深度报告要写"年度超额表 / 逐季超额表", 需要复盘区间内**每一期**的官方绩效与基准数值,
     所以只要要出深度报告, 就把官方原文从"抽样 4 期"升级为"全量取"(实测多花约 6 秒)。 */
  const wantDeep = opts.deepReport !== false;
  step('数据采集', '按六类公开来源抓取' + (wantDeep && opts.ai && opts.ai.apiKey ? '(含全量官方报告原文)' : ''));
  const crawl = await crawlFund(code, {
    years: opts.years || 10,
    fromPeriod: opts.fromPeriod, toPeriod: opts.toPeriod,
    gate1: opts.gate1 || null,
    verifyOfficial: opts.verifyOfficial !== false,
    maxFetchOfficial: opts.maxFetchOfficial || 4,
    allOfficial: opts.allOfficial === true || (wantDeep && !!(opts.ai && opts.ai.apiKey)),
    onProgress: m => onProgress(m)
  });
  const dataset = crawl.dataset;
  calibrateAgainstOfficial(dataset, step);
  step('采集完成', `${dataset.crawlLog.quarters} 期 · 净值 ${dataset.crawlLog.navPoints} 点 · 来源 ${dataset.sources.length} 类 · ${(dataset.crawlMs / 1000).toFixed(1)}s`);
  if (dataset.rangeInfo && dataset.rangeInfo.humanConfirmed) {
    step('按人工确认口径', `经理 ${dataset.rangeInfo.managerLabel} · 区间 ${dataset.rangeInfo.from}~${dataset.rangeInfo.to}` +
      (dataset.rangeInfo.managerCoManaged ? ' · 含共管期' : ''));
  }

  // ---------- 2. 引擎分析 + 质检 ----------
  step('规则引擎', '指标 / 形态 / 结论卡 / 报告 / 质检');
  let res = analyzeDataset(dataset, 'crawled');
  if (res.error) throw new Error(res.error);
  let { FC, analysis, check } = res;

  // ---------- 3. AI 模块(必选: 用用户自己的 Key) ----------
  /* 设计取舍: "必选"是产品选择 —— 主题归类这一项没有公开接口可替代(天天基金不提供"主题"字段),
     缺了它, 形态库里的"主题坚守型 / 主题漂移型"两条规则会直接跳过, 结论会明显变弱。
     所以要求必须给 Key。但大模型的**输出仍然要过校验**, 校验不过一律拦截 —— 必选的是"调用",
     不是"无条件采信"。 */
  const aiLog = [];
  const ai = opts.ai || {};
  if (!ai.apiKey && !opts.allowNoAI) {
    throw new Error('AI 模块为必选: 请填写 API Key(任意 OpenAI 兼容接口)。' +
      '若只想验证抓取与计算链路, 可在服务端设置环境变量 FUNDCLINIC_ALLOW_NO_AI=1, 或在命令行传 allowNoAI。');
  }
  if (ai.apiKey) {
    step('AI 模块', 'T1 主题归类 / T2 判断起草 / T3 用词清洗(用户自带 API Key)');
    // T1 主题归类 —— 唯一没有公开接口可替代的一步, 缺它形态判定会退化
    try {
      const r1 = await runTask('theme_classify', ai, analysis);
      aiLog.push({ task: r1.name, ok: r1.ok, latencyMs: r1.latencyMs, usage: r1.usage, issues: r1.issues });
      if (r1.ok && r1.value && r1.value.mapping) {
        const applied = applyThemeClassification(FC, dataset, r1.value.mapping);
        step('T1 主题归类', `已应用 ${applied} 期主题, 形态库的主题类规则现在可以参与判定`);
        res = analyzeDataset(dataset, 'crawled');
        ({ FC, analysis, check } = res);
      } else {
        step('T1 主题归类', '输出未通过校验, 已拦截; 主题保持为空, 形态判定会自动跳过主题类规则');
      }
    } catch (e) { aiLog.push({ task: 'T1 主题归类', ok: false, error: e.message }); step('T1 主题归类', '调用失败: ' + e.message); }

    // T2 判断起草
    try {
      const r2 = await runTask('judgement', ai, analysis);
      aiLog.push({ task: r2.name, ok: r2.ok, latencyMs: r2.latencyMs, usage: r2.usage, issues: r2.issues });
      if (r2.ok && r2.value) {
        applyJudgement(FC, analysis, r2.value, dataset.sources);
        check = FC.runCheck(dataset, analysis);
        step('T2 判断起草', '输出通过校验(形态标签在库内 / 数字全部回查得到 / 无违禁词), 已并入结论卡');
      } else {
        step('T2 判断起草', '输出未通过校验, 已拦截, 沿用规则引擎的结论卡');
      }
    } catch (e) { aiLog.push({ task: 'T2 判断起草', ok: false, error: e.message }); step('T2 判断起草', '调用失败: ' + e.message); }
  } else {
    step('AI 模块', '已按 FUNDCLINIC_ALLOW_NO_AI 跳过(仅用于链路自测, 正式出报告必须带 Key)');
  }

  const deckPayload = { analysis, dataset, check };
  const deckHtml = renderDeck(deckPayload, {});

  // T3 对外用词清洗: 对成稿全文再走一遍语言清洗, 输出"对外版", 原稿保留不动
  let reportClean = null;
  if (ai.apiKey && opts.cleanReport !== false) {
    try {
      const r3 = await runTask('polish', ai, analysis);
      aiLog.push({ task: r3.name, ok: r3.ok, latencyMs: r3.latencyMs, usage: r3.usage, issues: r3.issues });
      if (r3.ok && r3.value && r3.value.cleaned) {
        reportClean = r3.value.cleaned;
        step('T3 用词清洗', '输出通过校验(数字守恒 / 无违禁词 / 未删减), 已生成对外版报告');
      } else {
        step('T3 用词清洗', '输出未通过校验, 已拦截, 对外版报告不生成(原稿不受影响)');
      }
    } catch (e) { aiLog.push({ task: 'T3 用词清洗', ok: false, error: e.message }); step('T3 用词清洗', '调用失败: ' + e.message); }
  }

  // ---------- 4. 产出交付物 ----------
  step('生成交付物', '报告 / 结论卡 / 演示稿 / 深度复盘报告');
  const dir = runDir(code);
  const base = `${dataset.fund.name}_${code}`;

  const reportMd = FC.reportToMarkdown(analysis, {
    generatedBy: '基金复诊台 FundClinic · 自动采集 + 规则引擎' + (aiLog.some(x => x.ok) ? ' + 大模型(输出经校验)' : '')
  });
  const checkMd = FC.checkToMarkdown(check, analysis);
  const cardJson = JSON.stringify(buildCard(analysis, dataset, check), null, 2);
  const datasetJson = JSON.stringify(dataset, null, 1);

  /* ---------- 4b. 深度复盘报告(agent 主笔, 按固定 10 节骨架) ---------- */
  /* 与上面那份"引擎版报告"的分工:
     引擎版 = 结构化、每个数字带证据级别、可直接比对;
     深度版 = agent 在**同一份证据包**上写分析 —— 但全文数字必须回查得到, 编造即退回。 */
  let deepMd = null, deepCheck = null, deepEvidenceSummary = null, deepEvidence = null;
  if (opts.deepReport !== false) {
    if (!ai.apiKey) {
      step('深度复盘报告', '需要大模型主笔; 本次未提供 API Key, 跳过(引擎版报告不受影响)');
    } else {
      try {
        step('深度复盘报告', '整理证据包(官方逐季绩效/基准·规模申赎·轮动·经理原话×下期动作·成败案例)');
        const evidence = buildEvidence({ ...dataset, cases: analysis.cases });
        deepEvidence = evidence;
        deepEvidenceSummary = {
          nav: evidence.period.nav, exBestQuarter: evidence.period.exBestQuarter,
          maxDrawdown: evidence.period.maxDrawdown, annualRows: evidence.annual.length,
          quarterlyRows: evidence.quarterly.filter(q => q.nav !== null).length,
          talkPairs: evidence.talkCheck.length, phases: evidence.phases.length,
          allowedNumbers: Object.keys(evidence.allowedNumbers).length,
          chainedGapPp: evidence.period.chainedGapPp
        };
        const r5 = await runTask('deepReport', ai, analysis, { evidence });
        aiLog.push({ task: r5.name, ok: r5.ok, latencyMs: r5.latencyMs, usage: r5.usage, issues: r5.issues });
        deepCheck = r5.issues;
        if (r5.ok && r5.value && r5.value.markdown) {
          deepMd = r5.value.markdown;
          step('深度复盘报告', '已通过校验(骨架 10 节 / 数字全部回查得到 / 无前瞻无违禁词)');
        } else {
          step('深度复盘报告', '未通过校验, 已拦截 —— 详见"错误检查记录"里的 T5 明细');
        }
      } catch (e) {
        aiLog.push({ task: 'T5 深度复盘报告', ok: false, error: e.message });
        step('深度复盘报告', '调用失败: ' + e.message);
      }
    }
  }

  /* ---------- 4.5 T6 演示稿(html-ppt 技能驱动) ----------
     与旧 deck.mjs 的分工: deck.mjs 是**模板填充器**, 版式写死、只换数字, 出来一眼就是报表;
     T6 走的是"按内容编排"—— 读完整报告 → 决定讲几页每页主张什么 → 逐页单独成文,
     设计系统(36 主题 / base.css / 版面组件)由 skills/html-ppt 提供, 输出仍是单文件可直接转发。
     深度报告在时优先用它做底稿, 因为它是 agent 主笔、信息密度更高。 */
  let deckAgent = null, deckT6Html = null;
  if (opts.deckAgent !== false && ai.apiKey) {
    try {
      const { authorDeck } = await import('./deckagent.mjs');
      step('T6 演示稿', '按 html-ppt 技能编排: 分镜 → 逐页成文 → 内联单文件');
      deckAgent = await authorDeck({
        llm: ai,
        reportMd: deepMd || reportMd,
        fund: {
          code,
          name: dataset.fund.name,
          manager: (dataset.rangeInfo && dataset.rangeInfo.managerLabel) || dataset.fund.manager || '',
          range: dataset.fund.range
        },
        analysis, dataset, evidence: deepEvidence,
        theme: opts.deckTheme,
        slideHint: opts.slideHint,
        onProgress
      });
      deckT6Html = deckAgent.html;
      step('T6 演示稿', `${deckAgent.slides.length} 页 · 主题 ${deckAgent.theme} · ${(deckT6Html.length / 1024).toFixed(0)} KB · ` +
        (deckAgent.check.ok ? `校验通过(警告 ${deckAgent.check.warns})` : `校验有 ${deckAgent.check.fails} 项失败`));
      aiLog.push({ task: 'T6 演示稿', ok: true, note: `${deckAgent.slides.length} 页 / ${deckAgent.usage.calls} 次调用`, issues: deckAgent.check.issues });
    } catch (e) {
      deckAgent = { ok: false, error: e.message };
      aiLog.push({ task: 'T6 演示稿', ok: false, error: e.message });
      step('T6 演示稿', '失败(旧版演示稿仍可用): ' + e.message);
    }
  } else if (opts.deckAgent !== false) {
    step('T6 演示稿', '需要 API Key 才能由大模型编排, 跳过(旧版模板演示稿仍会生成)');
  }

  const files = {
    dataset: path.join(dir, `底稿_${base}.json`),
    report: path.join(dir, `复盘报告_${base}.md`),
    check: path.join(dir, `错误检查记录_${base}.md`),
    card: path.join(dir, `结论卡_${base}.json`),
    deck: path.join(dir, `演示稿_${base}.html`),
    sources: path.join(dir, `来源清单_${base}.md`)
  };
  if (deepMd) {
    const mgr = (dataset.rangeInfo && dataset.rangeInfo.managerLabel) || dataset.fund.manager || '';
    files.deep = path.join(dir, `${mgr}_${dataset.fund.name}_${dataset.fund.range}_复盘.md`);
  }
  if (reportClean) files.reportClean = path.join(dir, `复盘报告_${base}_对外版.md`);
  if (deckT6Html) files.deckT6 = path.join(dir, `演示稿_${base}_深度版.html`);
  fs.writeFileSync(files.dataset, datasetJson, 'utf8');
  fs.writeFileSync(files.report, reportMd, 'utf8');
  fs.writeFileSync(files.check, checkMd, 'utf8');
  fs.writeFileSync(files.card, cardJson, 'utf8');
  fs.writeFileSync(files.deck, deckHtml, 'utf8');
  fs.writeFileSync(files.sources, sourceLedger(dataset, analysis), 'utf8');
  if (deepMd) fs.writeFileSync(files.deep, deepMd, 'utf8');
  if (reportClean) fs.writeFileSync(files.reportClean, reportClean, 'utf8');
  if (deckT6Html) fs.writeFileSync(files.deckT6, deckT6Html, 'utf8');

  // ---------- 5. 演示稿 PDF(可选) ----------
  let pdf = null;
  if (opts.pdf !== false) {
    const edge = findEdge();
    if (edge) {
      try {
        /* 有 T6 深度版就印它 —— 这份才是准备拿出去讲的; 旧模板版只在没有 T6 时兜底。 */
        const srcDeck = deckT6Html ? files.deckT6 : files.deck;
        const out = path.join(dir, deckT6Html ? `演示稿_${base}_深度版.pdf` : `演示稿_${base}.pdf`);
        execFileSync(edge, [
          '--headless=new', '--disable-gpu', '--no-first-run',
          '--user-data-dir=' + path.join(os.tmpdir(), 'fc-deck-pdf'),
          '--virtual-time-budget=15000', '--no-pdf-header-footer', '--print-to-pdf-no-header',
          '--print-to-pdf=' + out,
          'file:///' + srcDeck.replace(/\\/g, '/')
        ], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 });
        if (fs.existsSync(out)) { pdf = out; step('导出 PDF', path.basename(out)); }
      } catch (e) { step('导出 PDF', '失败(可用浏览器打开演示稿后按 P 自行打印): ' + e.message); }
    } else {
      step('导出 PDF', '未找到 Edge/Chrome, 跳过(可在浏览器打开演示稿按 P 打印为 PDF)');
    }
  }

  const summary = {
    code, name: dataset.fund.name, manager: dataset.fund.manager, range: dataset.fund.range,
    quarters: dataset.fund.quarterCount, formTag: analysis.form.tag,
    perf: analysis.perf ? { cumReturn: analysis.perf.cumReturn, exBestQuarter: analysis.perf.exBestQuarter, maxDrawdown: analysis.perf.maxDrawdown } : null,
    check: check.summary,
    official: dataset.official ? {
      available: dataset.official.available,
      pdftotext: dataset.official.pdftotext,
      checks: (dataset.official.checks || []).map(c => ({ period: c.period, reason: c.reason, parsedRows: c.parsedRows, ok: c.reconcile ? c.reconcile.ok : false, maxDiff: c.reconcile ? c.reconcile.maxWeightDiff : null, diffs: c.reconcile ? c.reconcile.diffs : [], note: c.reconcile ? c.reconcile.note : (c.error || '') })),
      notes: dataset.official.notes, talks: (dataset.official.talks || []).length
    } : null,
    sources: dataset.sources,
    rangeInfo: dataset.rangeInfo,
    cleanLog: dataset.cleanLog,
    aiLog,
    aiRequired: true,
    reportCleanGenerated: !!reportClean,
    deepReportGenerated: !!deepMd,
    deckT6: deckAgent ? {
      ok: !!deckT6Html,
      pages: deckAgent.slides ? deckAgent.slides.length : 0,
      theme: deckAgent.theme || null,
      calls: deckAgent.usage ? deckAgent.usage.calls : 0,
      slides: deckAgent.slides || [],
      check: deckAgent.check || null,
      error: deckAgent.error || null
    } : null,
    deepEvidence: deepEvidenceSummary,
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { path: v, rel: path.relative(ROOT, v), bytes: fs.statSync(v).size }])),
    pdf: pdf ? { path: pdf, rel: path.relative(ROOT, pdf), bytes: fs.statSync(pdf).size } : null,
    steps, totalMs: Date.now() - t0
  };

  return { dataset, analysis, check, files, pdf, summary, reportMd, checkMd, deckHtml, cardJson };
}

/* 官方窗口校准: 引擎的逐季收益(分红再投口径) vs 官方季报 §3.2.1 披露的「过去三个月」净值增长率。
 *
 *  为什么要真跑而不是写一句话: 这句话以前是**无条件**拼进报告的 —— 官方 PDF 一期都没抓到、
 *  或者压根没开官方核验时, 报告照样写"已用官方净值增长率反向校准过"。这在金融报告里是硬伤:
 *  读者会以为数字经过独立复核。现在只有比对真的做成了才写, 并把偏差值一起写出来;
 *  没做成, 就如实写"未取得"并把原因带上。
 */
function calibrateAgainstOfficial(dataset, step) {
  const perf = dataset.perfDetail;
  const checks = (dataset.official && dataset.official.checks) || [];
  if (!perf || !perf.quarterReturns || !perf.quarterReturns.length) {
    dataset.perfCalibration = { ok: false, reason: '本次未算出逐季收益(缺净值序列), 无法与官方窗口比对', rows: [] };
    return;
  }
  const eng = new Map(perf.quarterReturns.map(r => [r.period, r.ret]));
  const rows = [];
  for (const c of checks) {
    const p3 = c.perf && c.perf['过去三个月'];
    if (!p3 || typeof p3.nav !== 'number') continue;
    if (!eng.has(c.period)) continue;
    /* 次新基金的首个报告期: 引擎从成立日起算, 官方"过去三个月"从季度初起算, 两者本来就不同口径,
       拿它做校准是错的 —— 跳过并记录, 不伪装成一致。 */
    if (perf.baseClamped && c.period === perf.quarterReturns[0].period) {
      rows.push({ period: c.period, official: p3.nav, engine: null, diff: null, skipped: '基金成立晚于季度初, 首期口径不可比' });
      continue;
    }
    const e = Math.round(eng.get(c.period) * 100) / 100;
    rows.push({ period: c.period, official: p3.nav, engine: e, diff: Math.round((e - p3.nav) * 100) / 100 });
  }
  const cmp = rows.filter(r => r.diff !== null);
  if (!cmp.length) {
    /* 说清楚**为什么**没校准。原来这里写"未开启官方报告核验", 容易被读成
       "你是不是没打开某个开关" —— 实际上最常见的原因是本机没装 pdftotext,
       官方 PDF 压根解析不了。组员在 Mac 上跑就是这个情况, 必须写明白。 */
    const offNotes = (dataset.official && dataset.official.notes) || [];
    const noPdftotext = !dataset.official || !dataset.official.pdftotext;
    dataset.perfCalibration = {
      ok: false, rows,
      reason: checks.length
        ? `已取到 ${checks.length} 期官方报告, 但其中没有可解析的「过去三个月」净值增长率, 未做窗口校准`
        : (noPdftotext
          ? '本机未找到 pdftotext(Poppler), 官方报告 PDF 无法解析, 因此没有做窗口校准 —— 本次的收益数字未经官方独立复核。装上 Poppler 后重跑即可。' + popplerInstallNote()
          : '本次未取到官方定期报告, 未做窗口校准 —— 收益数字未经官方独立复核')
    };
  } else {
    const maxAbs = Math.max(...cmp.map(r => Math.abs(r.diff)));
    dataset.perfCalibration = {
      ok: true, rows, n: cmp.length, maxAbsDiff: Math.round(maxAbs * 100) / 100,
      worst: cmp.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a)),
      /* 0.05pp 以内视为逐季口径一致(净值只披露到 4 位小数, 更小的差是舍入) */
      consistent: maxAbs <= 0.05
    };
  }

  if (dataset.perf && dataset.perf.note) {
    const c = dataset.perfCalibration;
    dataset.perf.note += c.ok
      ? `已与官方季报披露的「过去三个月」净值增长率逐期校准 ${c.n} 期, 最大偏差 ${c.maxAbsDiff}pp` +
        (c.consistent ? '(口径一致)' : `(偏差偏大, 见"${c.worst.period}" ${c.worst.diff}pp, 需人工复核)`) + '。'
      : `${c.reason}。`;
  }
  if (step) {
    const c = dataset.perfCalibration;
    step('官方窗口校准', c.ok
      ? `${c.n} 期可比, 最大偏差 ${c.maxAbsDiff}pp ${c.consistent ? '✓ 一致' : '⚠ 需人工复核'}`
      : '未完成: ' + c.reason);
  }
}

function buildCard(analysis, dataset, check) {
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

function sourceLedger(dataset, analysis) {
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
