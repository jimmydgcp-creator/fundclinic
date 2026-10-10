/* 基金复诊台 · 本地服务(零依赖, 只用 Node 内置模块)
 *
 * 为什么需要它: 浏览器从 file:// 页面无法跨域抓取天天基金/巨潮(CORS), 这是浏览器安全模型决定的,
 * 前端怎么写都绕不过去。所以"输入基金代码 -> 自动爬取 -> 出报告和演示稿"必须有一个本地后端。
 *
 * 启动: node server.mjs   (或双击 启动_基金复诊台.bat)
 * 然后浏览器打开 http://127.0.0.1:8787
 *
 * 端点:
 *   GET  /                        页面
 *   GET  /api/health              环境自检(pdftotext / Edge / 版本)
 *   POST /api/run                 跑完整流程, 以 NDJSON 流式回推进度与结果
 *   POST /api/llm                 用用户自己的 Key 调大模型(服务端转发, 避开 CORS)
 *   GET  /api/download?code=&f=    下载交付物
 *   GET  /deck/<code>             在线预览演示稿
 *   GET  /report/<code>           在线预览报告(Markdown 渲染)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import url from 'node:url';
import { fileURLToPath } from 'node:url';
import { runPipeline, findEdge, stripDataset } from './server/pipeline.mjs';
/* 公网用量闸门: 服务端持有 Key 时, Key 就是"任何访客都能花的钱", 必须在开跑前拦一道。
   细节与三道闸的默认值见 server/quota.mjs 顶部注释。 */
import { initQuota, quotaCheck, quotaRecord, quotaAddUsage, quotaSnapshot, quotaEnabledFromEnv } from './server/quota.mjs';
import { getFC } from './server/engine.mjs';
import { runTask, pingLLM, LLMError } from './server/pipeline-llm.mjs';
import { findPdftotext, popplerInstallNote, popplerInstallHint } from './server/official.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
/* 进程启动时点。用来检测"代码改过了但服务还在跑旧版本" ——
   engine.js 等模块被 vm 缓存, 不重启就一直用旧代码(用户实际踩过: 修好的 bug 照样出现)。
   每个响应都带上 X-FundClinic-Stale 头, 页面据此弹红条, 而不是让用户去猜。 */
const BOOT_AT = Date.now();
function newestSourceMtime() {
  let newest = 0;
  for (const d of ['app', 'server', '.']) {
    try {
      for (const f of fs.readdirSync(path.join(ROOT, d))) {
        if (!/\.(js|mjs|css|html)$/.test(f)) continue;
        const st = fs.statSync(path.join(ROOT, d, f));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
    } catch (e) { /* ignore */ }
  }
  return newest;
}
let STALE = false;
function refreshStale() { STALE = newestSourceMtime() > BOOT_AT + 1500; return STALE; }
/* 注意: 本地默认**不读**通用的 PORT 环境变量 —— 很多工具链会用它(例如 DSH 自己就占了 3080),
 * 直接读会发生端口冲突。本地只认专用变量 FUNDCLINIC_PORT。
 *
 * 云平台是唯一的例外: Render / Railway / Fly / Heroku 都会**注入 PORT**, 并且要求进程
 * 监听 0.0.0.0(监听 127.0.0.1 的话平台探活探不到, 会一直判定服务没起来)。
 * 所以只有在明确开启云模式时才认 PORT / 换 HOST —— 本地双击启动的行为一个字都没变。 */
const CLOUD = process.env.FUNDCLINIC_CLOUD === '1'
  || !!process.env.RENDER || !!process.env.DYNO || !!process.env.FLY_APP_NAME
  || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.K_SERVICE;
const BASE_PORT = Number(
  process.env.FUNDCLINIC_PORT || process.env.FC_PORT || (CLOUD ? process.env.PORT : '') || 8787
);
const HOST = process.env.FUNDCLINIC_HOST || (CLOUD ? '0.0.0.0' : '127.0.0.1');
const VERSION = '2.1.0';
let PORT = BASE_PORT;

/* AI 模块为必选。Key 可以只配置一次, 三处任选:
 *   ① 页面输入(存本机浏览器 localStorage, 可勾选"记住")
 *   ② 环境变量 FUNDCLINIC_LLM_KEY / _BASE / _MODEL
 *   ③ 本目录下 llm.local.json: {"baseUrl":"...","model":"...","apiKey":"..."}
 * 三个来源只在内存里合成 cfg, 服务端从不把 Key 写进任何文件、日志或响应。 */
const ENV_LLM = {
  baseUrl: process.env.FUNDCLINIC_LLM_BASE || process.env.FUNDCLINIC_LLM_BASEURL || '',
  model: process.env.FUNDCLINIC_LLM_MODEL || '',
  apiKey: process.env.FUNDCLINIC_LLM_KEY || process.env.FUNDCLINIC_API_KEY || ''
};
function localLlmConfig() {
  try {
    const p = path.join(ROOT, 'llm.local.json');
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { baseUrl: j.baseUrl || '', model: j.model || '', apiKey: j.apiKey || '' };
  } catch (e) { return {}; }
}
function defaultLlm() {
  const l = localLlmConfig();
  return {
    baseUrl: ENV_LLM.baseUrl || l.baseUrl || 'https://api.deepseek.com',
    model: ENV_LLM.model || l.model || 'deepseek-v4-flash',
    apiKey: ENV_LLM.apiKey || l.apiKey || '',
    source: ENV_LLM.apiKey ? '环境变量' : (l.apiKey ? 'llm.local.json' : '')
  };
}
/** 优先级: 请求里带的 > 环境变量/llm.local.json > 内置默认。空白值一律回落到下一层。 */
function mergeLLM(input) {
  const d = defaultLlm();
  const pick = (v, fb) => (v === undefined || v === null || String(v).trim() === '' ? fb : String(v).trim());
  return {
    baseUrl: pick(input.baseUrl, d.baseUrl),
    model: pick(input.model, d.model),
    apiKey: pick(input.apiKey, d.apiKey),
    temperature: input.temperature
  };
}

/* 最近一次运行的结果缓存(供 /api/llm 与预览复用)。
   注意: 光放内存是不够的 —— 页面一刷新/一回退就全没了(实测踩到), 所以同时落盘到 _runs/<代码>/,
   启动时再从磁盘恢复, 这样"输入代码跑过一次"这件事是可恢复的。 */
const lastRun = new Map();
const RUNS_DIR = path.join(ROOT, '_runs');
/* 必须在任何读写之前建好。
   坑(差点发出去才发现): zip 格式**不保存空目录**, 所以打包分发时 _runs 会整个消失;
   而 announce() 里无条件往 _runs/.active-port 写文件 —— 目录不在就 ENOENT,
   异常抛在 listen 回调里没人接, 进程直接退出。表现就是"双击 bat 黑窗口一闪而过"。
   这里先兜底建目录, 下面写文件也加 try/catch, 双保险。 */
try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch (e) { /* 交给后续报错 */ }

/* 用量闸门: **只在云端模式启用**(本地各自用自己的 Key, 不该被限额打扰)。
   三态开关: FUNDCLINIC_QUOTA=1 强制开 / =0 强制关 / 不设则跟随云端判断。
   计数落盘默认到 _runs/.quota.json, 可用 FUNDCLINIC_QUOTA_FILE 改到挂载卷上;
   云平台的判断在这里做一次传进去, 不让 quota.mjs 自己再去认一遍平台变量 —— 两处判断迟早走偏。 */
const QUOTA = initQuota({
  enabled: quotaEnabledFromEnv(CLOUD),
  file: process.env.FUNDCLINIC_QUOTA_FILE || path.join(RUNS_DIR, '.quota.json')
});

/** 取访客 IP。**必须优先看 X-Forwarded-For**: 云平台前面有反代, socket 上看到的是内网地址,
 *  照 socket 取的话所有访客会被算成同一个 IP, 一道闸门就把全班人一起挡了。 */
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = xf || (req.socket && req.socket.remoteAddress) || 'unknown';
  return raw.replace(/^::ffff:/, '');
}

/* 全局崩溃兜底。
 *
 * 为什么必须有(组员真实踩到): 进程一旦因为未捕获的异常/未处理的 Promise 退出,
 * 浏览器那边看到的只是 "Load failed"(Safari 的网络层措辞) —— 用户完全不知道
 * 发生了什么, 也不知道该看哪里。而终端窗口可能已经滚过去或者被关掉了。
 *
 * 所以: ① 打到终端(看得到) ② 同时落盘到 _runs/_server-error.log(能捞回来发给别人)
 *      ③ **不退出** —— 这是单机小工具, 一个还能用的服务远好过一个死掉的服务;
 *         真出了脏状态, 重新双击启动一次就干净了。
 */
const ERR_LOG = path.join(RUNS_DIR, '_server-error.log');
function logFatal(kind, err) {
  const when = new Date().toISOString();
  const text = `[${when}] ${kind}\n${(err && err.stack) || String(err)}\n\n`;
  console.error('\n  !! 服务端出现未捕获的错误(' + kind + '):');
  console.error('  ' + text.split('\n').filter(Boolean).slice(0, 12).join('\n  '));
  console.error('  完整堆栈已写入: ' + ERR_LOG);
  console.error('  (服务不会退出, 可以继续用; 但这次运行的结果可能不完整)\n');
  try { fs.appendFileSync(ERR_LOG, text, 'utf8'); } catch (e) { /* 日志都写不进去就算了 */ }
}
process.on('uncaughtException', e => logFatal('uncaughtException', e));
process.on('unhandledRejection', e => logFatal('unhandledRejection', e));

function persistRun(code, result) {
  try {
    const dir = path.join(RUNS_DIR, String(code));
    fs.mkdirSync(dir, { recursive: true });
    const meta = stripDataset(result.dataset);
    fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(result.analysis), 'utf8');
    fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(result.check), 'utf8');
    fs.writeFileSync(path.join(dir, 'datasetMeta.json'), JSON.stringify(meta), 'utf8');
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
      code, summary: result.summary, files: result.files, pdf: result.pdf, at: new Date().toISOString()
    }, null, 1), 'utf8');
    return true;
  } catch (e) {
    console.error('落盘运行结果失败: ' + e.message);
    return false;
  }
}

function loadRunFromDisk(code) {
  try {
    const dir = path.join(RUNS_DIR, String(code));
    const rd = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const run = rd('run.json');
    return {
      analysis: rd('analysis.json'), check: rd('check.json'), datasetMeta: rd('datasetMeta.json'),
      files: run.files, pdf: run.pdf, summary: run.summary, at: Date.parse(run.at) || Date.now(), dir
    };
  } catch (e) { return null; }
}

/** 启动时把所有跑过的基金恢复进内存, 并按时间倒序返回历史 */
function listHistory() {
  const out = [];
  try {
    for (const name of fs.readdirSync(RUNS_DIR)) {
      const dir = path.join(RUNS_DIR, name);
      let st;
      try { st = fs.statSync(dir); } catch (e) { continue; }
      if (!st.isDirectory()) continue;
      const rp = path.join(dir, 'run.json');
      if (!fs.existsSync(rp)) continue;
      try {
        const run = JSON.parse(fs.readFileSync(rp, 'utf8'));
        const s = run.summary || {};
        out.push({
          code: run.code || name, name: s.name || name, manager: s.manager || '',
          range: s.range || '', quarters: s.quarters || 0, formTag: s.formTag || '',
          at: run.at, check: s.check ? s.check.verdictText : '',
          hasPdf: !!run.pdf, files: Object.keys(run.files || {}).length
        });
        const mtime = Date.parse(run.at) || st.mtimeMs;
        out[out.length - 1]._mtime = mtime;
      } catch (e) { /* 坏文件跳过 */ }
    }
  } catch (e) { /* 目录不存在 */ }
  out.sort((a, b) => (b._mtime || 0) - (a._mtime || 0));
  return out;
}

function restoreAll() {
  let n = 0;
  listHistory().forEach(h => {
    if (lastRun.has(h.code)) return;
    const r = loadRunFromDisk(h.code);
    if (r) { lastRun.set(h.code, r); n++; }
  });
  return n;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'Content-Length': buf.length, 'Cache-Control': 'no-store',
    'X-FundClinic-Stale': refreshStale() ? '1' : '0',
    ...headers
  });
  res.end(buf);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj, null, 1), { 'Content-Type': 'application/json; charset=utf-8' }); }

function safeJoin(root, target) {
  const p = path.normalize(path.join(root, decodeURIComponent(target)));
  if (!p.startsWith(root)) return null;
  return p;
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function mdToHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inTable = false;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\|/.test(l)) {
      const cells = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (/^\|[\s:|-]+\|$/.test(l.trim())) continue;
      if (!inTable) { out.push('<table><thead><tr>' + cells.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>'); inTable = true; }
      else out.push('<tr>' + cells.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
    if (!l.trim()) { out.push(''); continue; }
    if (/^###\s/.test(l)) out.push('<h4>' + esc(l.slice(4)) + '</h4>');
    else if (/^##\s/.test(l)) out.push('<h3>' + esc(l.slice(3)) + '</h3>');
    else if (/^#\s/.test(l)) out.push('<h2>' + esc(l.slice(2)) + '</h2>');
    else if (/^>\s?/.test(l)) out.push('<blockquote>' + esc(l.replace(/^>\s?/, '')) + '</blockquote>');
    else if (/^[-*]\s/.test(l)) out.push('<li>' + esc(l.slice(2)) + '</li>');
    else out.push('<p>' + esc(l) + '</p>');
  }
  if (inTable) out.push('</tbody></table>');
  return out.join('\n').replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => '<ul>' + m + '</ul>');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    /* ---------------- 环境自检 ---------------- */
    if (pathname === '/api/health') {
      const d = defaultLlm();
      const stale = refreshStale();
      return json(res, 200, {
        ok: true, version: VERSION,
        /* 这两个是**部署验收**要看的: 平台没注入 PORT / 服务没监听 0.0.0.0 时,
           表现是平台探活一直 502, 而在容器里 curl 127.0.0.1 又是通的 —— 极难猜。
           直接报出来, tools/test_deployed.mjs 第一件事就查它。 */
        cloud: CLOUD, host: HOST, port: PORT,
        staleCode: stale,
        staleNote: stale ? '项目代码在本服务启动后被修改过, 当前进程仍在使用旧代码 —— 请关掉这个窗口重新双击「启动_基金复诊台.bat」, 否则刚才的修复不会生效。' : '',
        bootAt: new Date(BOOT_AT).toISOString(),
        newestSourceAt: new Date(newestSourceMtime()).toISOString(),
        pdftotext: !!findPdftotext(), pdftotextPath: findPdftotext(),
      /* 缺 Poppler 时, 页面上要直接给**当前系统**能用的那条命令。
         写死 winget 的话 Mac 用户照着敲只会得到 command not found。 */
      popplerHint: popplerInstallHint(),
        edge: findEdge(), cwd: ROOT,
        node: process.version,
        aiRequired: true,
        llm: { baseUrl: d.baseUrl, model: d.model, hasKey: !!d.apiKey, keySource: d.source },
        allowNoAI: process.env.FUNDCLINIC_ALLOW_NO_AI === '1',
        /* 公网模式下把用量闸门也报出来 —— 访客能看到"今天还剩几次", 群主能看到花了多少 token。
           放 health 而不是单独接口, 因为页面本来就在轮询 health。 */
        quota: quotaSnapshot(),
        crawlStandard: 'SOP §2 六类来源: ①官方定期报告PDF ②天天基金历史前十大 ③天天基金资产配置 ④天天基金规模变动 ⑤累计净值序列 ⑥经理履历'
      });
    }

    /* ---------------- Key 探活(在爬取前先验证, 免得白等 10 秒) ---------------- */
    if (pathname === '/api/llm/ping' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const cfg = mergeLLM(body);
      if (!cfg.apiKey) return json(res, 400, { error: '未提供 API Key' });
      const r = await pingLLM(cfg);
      return json(res, r.ok ? 200 : 502, r);
    }

    /* ---------------- 探路(第一阶段: 只抓元数据, 供口径确认表) ---------------- */
    if (pathname === '/api/probe' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return json(res, 400, { error: '基金代码必须是 6 位数字' });
      try {
        const { probeFund } = await import('./server/probe.mjs');
        const t0 = Date.now();
        const p = await probeFund(code, { pages: 2 });
        p.probeMs = Date.now() - t0;
        return json(res, 200, { ok: true, probe: p });
      } catch (e) {
        return json(res, 502, { error: '探路失败: ' + e.message, detail: e.detail || '' });
      }
    }

    /* ---------------- 主流程(NDJSON 流式) ---------------- */
    if (pathname === '/api/run' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return json(res, 400, { error: '基金代码必须是 6 位数字' });

      /* AI 模块为必选: 没有 Key 直接拒绝, 不进入爬取 —— 避免跑完 10 秒才告诉你缺 Key */
      const ai = mergeLLM(body.ai || {});
      const allowNoAI = body.allowNoAI === true && process.env.FUNDCLINIC_ALLOW_NO_AI === '1';
      if (!ai.apiKey && !allowNoAI) {
        return json(res, 400, {
          error: 'AI 模块为必选: 请先在页面上填写 API Key(任意 OpenAI 兼容接口)。',
          hint: '也可以在启动服务前设置环境变量 FUNDCLINIC_LLM_KEY, 或在项目目录放 llm.local.json, 这样只需配置一次。'
        });
      }

      /* 用量闸门 —— 只在公网模式(服务端持有 Key)下生效, 本地默认完全不管。
         为什么放在 Key 检查之后: 没配 Key 时该报的是"未配置 Key", 不是"额度用完", 否则排查方向会被带偏。
         为什么放在流水线之前: 一次完整复盘要调好几轮大模型(采集+官方对账+T1..T6),
         花费是真金白银, 必须在动手之前拦下来。 */
      const gate = quotaCheck(clientIp(req));
      if (!gate.ok) {
        return json(res, gate.status || 429, {
          error: gate.reason,
          quota: quotaSnapshot(),
          retryAfterSec: gate.retryAfterSec || null
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const emit = obj => { try { res.write(JSON.stringify(obj) + '\n'); } catch (e) { /* client gone */ } };
      /* 计数放在真正要开跑的那一刻 —— 探路(probe)不计数, 因为它不调大模型 */
      quotaRecord(clientIp(req));
      emit({ type: 'start', code, aiEnabled: !!ai.apiKey, aiModel: ai.model, quota: quotaSnapshot() });

      /* 心跳。为什么必须有: 深度复盘报告(T5)是一段**长时间静默**的大模型调用,
         可能一两分钟没有任何字节发出去。Safari 对这种"看起来卡住"的长连接会比
         Chrome 更早放弃, 直接掐断 —— 用户在页面上看到的就是一句
         "Load failed"(Safari 的网络层报错, 不是本程序的报错),
         而且会误以为整件事失败了, 其实服务端还在跑、结果还会落盘。
         每 12 秒发一条 ping 注释行, 连接一直是活的, 就不会被掐。 */
      const hb = setInterval(() => {
        try { res.write(JSON.stringify({ type: 'ping', t: Date.now() }) + '\n'); } catch (e) { /* client gone */ }
      }, 12000);

      try {
        const result = await runPipeline(code, {
          years: body.years || 10,
          fromPeriod: body.fromPeriod || undefined,
          toPeriod: body.toPeriod || undefined,
          verifyOfficial: body.verifyOfficial !== false,
          maxFetchOfficial: body.maxFetchOfficial || 4,
          pdf: body.pdf !== false,
          cleanReport: body.cleanReport !== false,
          allowNoAI,
          gate1: body.gate1 || null,
          ai: { enabled: !!ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, apiKey: ai.apiKey },
          onProgress: msg => emit({ type: 'progress', msg })
        });
        lastRun.set(code, {
          analysis: result.analysis, dataset: result.dataset, check: result.check,
          files: result.files, pdf: result.pdf, at: Date.now(),
          datasetMeta: stripDataset(result.dataset), summary: result.summary
        });
        const persisted = persistRun(code, result);
        /* 把这次跑的 token 累加进当日用量 —— 群主看 /api/health 就知道今天花了多少 */
        quotaAddUsage(result.summary && result.summary.aiLog);
        emit({ type: 'done', summary: result.summary, analysis: result.analysis, check: result.check, datasetMeta: stripDataset(result.dataset), persisted, quota: quotaSnapshot() });
      } catch (e) {
        emit({ type: 'error', error: e.message, detail: e.detail || '' });
      } finally {
        clearInterval(hb);
      }
      return res.end();
    }

    /* ---------------- 大模型转发(用户自带 Key) ---------------- */
    if (pathname === '/api/llm' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const cfg = { baseUrl: body.baseUrl, model: body.model, apiKey: body.apiKey, temperature: body.temperature };
      if (!cfg.apiKey) return json(res, 400, { error: '未提供 API Key' });

      // 两种用法: ① 直接转发一段提示词  ② 指定 taskId + code 走完整"调模型 + 校验"链路
      if (body.prompt && !body.taskId) {
        try {
          const { callLLM } = await import('./server/pipeline-llm.mjs');
          const r = await callLLM(cfg, body.prompt);
          return json(res, 200, r);
        } catch (e) { return json(res, 502, { error: e.message, detail: e.detail || '' }); }
      }
      const cached = lastRun.get(String(body.code || ''));
      if (!cached) return json(res, 404, { error: '请先对这个基金跑一次复盘, 再执行 AI 任务' });
      try {
        const r = await runTask(body.taskId, cfg, cached.analysis, { list: body.list });
        return json(res, 200, r);
      } catch (e) {
        return json(res, 502, { error: e.message, detail: e.detail || '' });
      }
    }

    /* ---------------- 历史与恢复 ---------------- */
    if (pathname === '/api/history') {
      return json(res, 200, { ok: true, runs: listHistory().map(({ _mtime, ...x }) => x) });
    }
    if (pathname === '/api/result') {
      const code = String(parsed.query.code || '').replace(/\D/g, '');
      let r = lastRun.get(code);
      // 内存里可能缺 summary(历史版本遗留)或已被清空, 一律回落到磁盘
      if (!r || !r.summary || !r.analysis) r = loadRunFromDisk(code);
      if (!r) return json(res, 404, { error: '没有 ' + code + ' 的运行记录' });
      lastRun.set(code, r);
      return json(res, 200, { ok: true, summary: r.summary, analysis: r.analysis, check: r.check, datasetMeta: r.datasetMeta });
    }

    /* ---------------- 下载 ---------------- */
    if (pathname === '/api/download') {
      const code = String(parsed.query.code || '');
      const key = String(parsed.query.f || '');
      const cached = lastRun.get(code) || loadRunFromDisk(code);
      if (!cached) return json(res, 404, { error: '没有该基金的运行结果, 请先跑一次复盘' });
      lastRun.set(code, cached);
      let target = null;
      if (key === 'pdf') target = cached.pdf;
      else if (cached.files && cached.files[key]) target = cached.files[key].path || cached.files[key];
      else target = key && /^[\w\u4e00-\u9fa5.\-]+$/.test(key) ? path.join(ROOT, '_runs', code, key) : null;
      if (!target || !fs.existsSync(target)) return json(res, 404, { error: '交付物不存在: ' + key });
      const ext = path.extname(target).toLowerCase();
      const name = path.basename(target);
      /* Content-Disposition 同时给 ASCII 回落名与 RFC5987 的 UTF-8 名 —— 只给 filename* 时
         部分浏览器会忽略整个头, 结果把 HTML 直接渲染出来而不是下载(实测踩到)。 */
      const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_');
      return send(res, 200, fs.readFileSync(target), {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff'
      });
    }

    /* ---------------- 预览演示稿 ---------------- */
    if (pathname.startsWith('/deck/')) {
      const code = pathname.slice('/deck/'.length).replace(/[^\d]/g, '');
      const cached = lastRun.get(code) || loadRunFromDisk(code);
      if (!cached || !cached.files) return json(res, 404, { error: '尚未生成该基金的演示稿' });
      /* 默认给 T6 深度版(按内容编排的那份); ?v=old 才看旧的模板版, 方便对照。 */
      const wantOld = String(parsed.query.v || '') === 'old';
      const f = (!wantOld && cached.files.deckT6) ? cached.files.deckT6 : cached.files.deck;
      if (!f) return json(res, 404, { error: '尚未生成该基金的演示稿' });
      lastRun.set(code, cached);
      return send(res, 200, fs.readFileSync(f.path || f), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    /* ---------------- 预览报告 ---------------- */
    if (pathname.startsWith('/report/')) {
      const code = pathname.slice('/report/'.length).replace(/[^\d]/g, '');
      const cached = lastRun.get(code);
      if (!cached || !cached.files || !cached.files.report) return json(res, 404, { error: '尚未生成该基金的报告' });
      const md = fs.readFileSync(cached.files.report.path || cached.files.report, 'utf8');
      return send(res, 200, `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${code} 复盘报告</title>
<style>body{max-width:940px;margin:0 auto;padding:40px 24px;font:16px/1.85 "Microsoft YaHei",sans-serif;color:#16202e}
h2{color:#0a2540;border-bottom:3px solid #1d4ed8;padding-bottom:10px}h3{color:#14395f;margin-top:32px}
h4{color:#14395f}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
th,td{border-bottom:1px solid #dbe3ee;padding:7px 10px;text-align:left}th{background:#f2f5fa}
blockquote{border-left:4px solid #1d4ed8;background:#f7f9fc;margin:10px 0;padding:10px 16px;color:#46586e}
code{background:#eef2f8;padding:1px 5px;border-radius:4px}</style></head>
<body><p style="font-size:13px;color:#7d8da3"><a href="/">← 返回基金复诊台</a> · <a href="/deck/${code}">看演示稿</a> · <a href="/api/download?code=${code}&f=report">下载 Markdown</a></p>${mdToHtml(md)}</body></html>`, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    /* ---------------- 静态文件 ---------------- */
    if (req.method === 'GET' || req.method === 'HEAD') {
      let rel = pathname === '/' ? '/index.html' : pathname;
      // _runs 目录不对外暴露(交付物走 /api/download)
      if (rel.startsWith('/_runs') || rel.startsWith('/server') || rel.startsWith('/tools')) return json(res, 403, { error: '禁止访问' });
      const fp = safeJoin(ROOT, rel);
      if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return json(res, 404, { error: '不存在: ' + rel });
      const ext = path.extname(fp).toLowerCase();
      return send(res, 200, fs.readFileSync(fp), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    }

    return json(res, 405, { error: '不支持的方法' });
  } catch (e) {
    return json(res, 500, { error: e.message, stack: String(e.stack || '').split('\n').slice(0, 4) });
  }
});

/* stripDataset 已移到 server/pipeline.mjs 并导出, 这里直接 import —— 避免两处形状走偏 */

function announce(port) {
  const hasPdf = !!findPdftotext(), hasEdge = !!findEdge();
  const restored = restoreAll();
  const hist = listHistory();
  console.log('');
  console.log('  基金复诊台 FundClinic v' + VERSION + '  已启动' + (CLOUD ? '(云端模式)' : ''));
  console.log('  ─────────────────────────────────────────────');
  console.log(CLOUD
    ? '  监听:   0.0.0.0:' + port + '(由平台反向代理对外提供访问)'
    : '  打开:   http://' + HOST + ':' + port);
  console.log('  数据:   SOP §2 六类来源(官方定期报告 PDF 为最高权威)');
  console.log('  环境:   pdftotext ' + (hasPdf ? '✓ 可用(官方 PDF 逐行对账已启用)' : '✗ 未找到(Poppler), 官方对账会标记为未完成'));
  if (!hasPdf) console.log('          ' + popplerInstallNote());
  console.log('          Edge/Chrome ' + (hasEdge ? '✓ 可用(可一键导出演示稿 PDF)' : '✗ 未找到(可在浏览器打开演示稿按 P 打印为 PDF)'));
  console.log('  历史:   ' + (hist.length ? `已恢复 ${restored} 份过往复盘(${hist.slice(0, 4).map(h => h.code + ' ' + h.name).join('、')}${hist.length > 4 ? ' 等' : ''})` : '暂无历史记录'));
  /* 公网模式必须在启动横幅里说清额度, 否则"今天怎么跑不了"要到被拦住才发现 */
  if (QUOTA.enabled) {
    const L = QUOTA.limits;
    console.log('  额度:   每台机器 ' + L.perIpHour + ' 次/小时 · ' + L.perIpDay + ' 次/天 · 全站 ' + L.maxRunsDay + ' 次/天');
    console.log('          今天是 ' + QUOTA.day + ' · 已用 ' + QUOTA.dayRuns + '/' + L.maxRunsDay + ' 次 · 累计 ' + QUOTA.totalRuns + ' 次 · ' + QUOTA.tokens.total + ' token');
    console.log('          改额度: FUNDCLINIC_MAX_PER_IP_HOUR / _PER_IP_DAY / _MAX_RUNS_DAY; 关掉: FUNDCLINIC_QUOTA=0');
  } else {
    console.log('  额度:   未启用(本机模式各自用自己的 Key, 不限额; 上公网会自动启用)');
  }
  console.log('  停止:   Ctrl + C');
  console.log('');
  try { fs.writeFileSync(path.join(RUNS_DIR, '.active-port'), String(port), 'utf8'); } catch (e) { /* 目录不可写不该拖垮服务 */ }

  /* 浏览器由服务端来开, 而不是由 .bat 开。
     为什么: 8787 被占时服务会顺延到 8788/8789…, 而 .bat 里写死的地址还是 8787 ——
     用户看到的是空白页或别人的程序, 完全不知道发生了什么(发给别人用必然踩到)。
     另外 .bat 在服务还没起来时就把浏览器打开, 也会先闪一个"无法连接"。
     这里在 listen 成功之后再开, 端口一定是真的, 时机也一定对。
     设 FUNDCLINIC_OPEN=1 才开, 跑测试/后台任务时不受影响。 */
  if (process.env.FUNDCLINIC_OPEN === '1') {
    const url = 'http://' + HOST + ':' + port;
    try {
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (e) { console.log('  (未能自动打开浏览器, 请手动访问上面的地址)'); }
  }
}

/* 端口被占就往后试几个, 免得用户看到 EADDRINUSE 就卡住。
 * 云端**不能顺延**: 平台只会把流量转到它分配的那个 PORT, 顺延等于自己藏起来没人找得到。 */
let attempt = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && !CLOUD && attempt < 12) {
    attempt++;
    PORT = BASE_PORT + attempt;
    console.log('  端口 ' + (PORT - 1) + ' 被占用, 改用 ' + PORT);
    server.listen(PORT, HOST);
    return;
  }
  console.error('启动失败: ' + e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => announce(PORT));
