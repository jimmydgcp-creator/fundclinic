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
import { initQuota, quotaCheck, quotaRecord, quotaAddUsage, quotaAddUsageOne, quotaSnapshot, quotaEnabledFromEnv } from './server/quota.mjs';
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
    /* 这一目录的结果刚被**真跑**覆盖, 它就不再是"种子"了 —— 把 seedRuns() 落的标记删掉,
       否则 /api/history 会一直把一份真跑出来的结果标成演示数据(标记只是说明, 删不掉也不影响任何主流程)。 */
    try { fs.rmSync(path.join(dir, '_seeded.json'), { force: true }); } catch (e) { /* ignore */ }
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
          hasPdf: !!run.pdf, files: Object.keys(run.files || {}).length,
          /* 这份结果是"从 _seed/ 种下来的"还是"真跑出来的": 看 seedRuns() 落的标记文件。
             读不到标记就是 false —— 前端现在还不区分(那是别人手上的活), 但接口先把字段如实给出来,
             以后要加"演示数据"角标时不用再回来改服务端。 */
          seeded: fs.existsSync(path.join(dir, '_seeded.json'))
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

/* ---------------- 预置跑批(种子): 让云端部署一起来就有东西可看 ----------------
 *
 * 要解决的问题(2026-11-01 一天内撞到两次): 每次运行的产出落在 _runs/<代码>/, 而 _runs/ 是 .gitignore 的
 * 本地过程产物; Render 免费档的容器磁盘是临时的 —— 每次重新部署、或休眠后重启, _runs/ 就清空。
 * 表现是: 演示时打开公网地址, 报告页是空的, 问一句答"这只基金还没有跑过复盘", 必须现场真跑 6–7 分钟
 * (还花 token)才有内容 —— 而这件事本该在按下"部署"的那一刻就解决。
 *
 * 解法: 仓库里放一份**只读种子** _seed/<代码>/(内容是真跑批的产物, 来龙去脉见 _seed/README.md)。
 * Dockerfile 是 COPY . ., 所以它天然会被烤进镜像; 服务起来时, 只要 _runs/<代码>/ 还不存在, 就复制一份过去。
 *
 * 为什么**只有云端(或显式开启)才种**: 本机模式下组员会突然多出两只不是自己跑的基金, 还得猜它们哪来的;
 * 而云端不种就等于每次演示都要现场烧 6–7 分钟。两边都得照顾, 所以做成开关而不是"永远种"。
 * FUNDCLINIC_SEED=0 是"云端也强制不种"的逃生阀(例如想验证全新容器到底有多空)。
 */
const SEED_DIR = path.join(ROOT, '_seed');
const SEED_ON = process.env.FUNDCLINIC_SEED === '0'
  ? false
  : (CLOUD || process.env.FUNDCLINIC_SEED === '1');

/** 把 _seed/<代码>/ 下平铺的文件复制过去。只复制一层, 不递归 —— 种子目录里就是一堆交付物,
 *  没有子目录(真有就是放错了, 跳过即可, 不该为它写一套递归逻辑)。 */
function copySeedDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    try {
      fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
    } catch (err) {
      /* 单个文件复制失败不该让整只基金失败 —— 缺哪个, 下面的 rebase 会把它从 run.json 里摘掉 */
    }
  }
}

/** 把复制过来的 run.json 里的路径改写成"实际落地的位置"。
 *
 *  为什么必须改: run.json 里存的是**生成那台机器上的绝对路径**(C:\Users\...\_runs\519191\xxx.md)。
 *  原样搬进 Linux 容器, 文件明明都在, 但每个路径都指不到 —— 结果是在线看报告 / 看演示稿 500、
 *  下载 404。数据在、链接全死, 比没有数据更糟, 因为看起来像"程序坏了"。
 *
 *  做法: 只认文件名, 拼到 _runs/<代码>/ 下面; 找不到对应文件(种子故意没带 PDF)就把这一项置空/摘掉,
 *  而不是留一条死链 —— 留死链的话页面还会画一个点了没反应的下载按钮。
 *
 *  为什么不在种子里就把路径改好: 种子是"真跑批的产物", 原样保留才有复现价值(能看出它是哪台机器、哪个目录
 *  跑出来的)。改写只发生在落地出来的副本上, 种子本身一个字都不动。 */
function rebaseSeedPaths(dir, code) {
  const rp = path.join(dir, 'run.json');
  const run = JSON.parse(fs.readFileSync(rp, 'utf8'));
  const relink = v => {
    const p = typeof v === 'string' ? v : (v && v.path);
    if (!p) return null;
    const base = path.basename(String(p));
    const dest = path.join(dir, base);
    if (!fs.existsSync(dest)) return null;   // 种子没带这个文件(例如 PDF) → 置空
    if (typeof v === 'string') return dest;
    return { ...v, path: dest, rel: path.join('_runs', code, base) };
  };
  const relinkMap = src => {
    const out = {};
    for (const [k, v] of Object.entries(src || {})) {
      const nv = relink(v);
      if (nv) out[k] = nv;
    }
    return out;
  };
  run.files = relinkMap(run.files);
  run.pdf = relink(run.pdf);
  /* summary 是 /api/result 直接回给页面的那一坨: 页面上的"PDF 下载按钮"看的是 summary.pdf,
     所以它也得跟着清, 只清顶层 run.pdf 的话按钮还在、点了必然 404。 */
  if (run.summary) {
    if (run.summary.files) run.summary.files = relinkMap(run.summary.files);
    run.summary.pdf = relink(run.summary.pdf);
  }
  fs.writeFileSync(rp, JSON.stringify(run, null, 1), 'utf8');
}

/** 启动时补种。返回 { enabled, added:[代码], existing:[代码], failed:[说明], error }。
 *  **绝不覆盖**: 目标已有 run.json 就跳过 —— 用户真跑出来的结果永远比种子重要。 */
function seedRuns() {
  const info = { enabled: SEED_ON, added: [], existing: [], failed: [], error: '' };
  if (!SEED_ON) return info;
  try {
    if (!fs.existsSync(SEED_DIR)) { info.error = '_seed/ 不存在'; return info; }
    for (const name of fs.readdirSync(SEED_DIR)) {
      if (!/^\d{6}$/.test(name)) continue;                    // README.md 之类直接跳过: 种子目录名必须是 6 位代码
      const from = path.join(SEED_DIR, name);
      const to = path.join(RUNS_DIR, name);
      try { if (!fs.statSync(from).isDirectory()) continue; } catch (e) { continue; }
      if (fs.existsSync(path.join(to, 'run.json'))) { info.existing.push(name); continue; }
      try {
        copySeedDir(from, to);
        rebaseSeedPaths(to, name);
        fs.writeFileSync(path.join(to, '_seeded.json'), JSON.stringify({
          seeded: true, from: '_seed/' + name, at: new Date().toISOString()
        }, null, 1), 'utf8');
        info.added.push(name);
      } catch (e) {
        /* 单只失败只记一行, 不影响另一只, 也不影响启动 */
        info.failed.push(name + ': ' + e.message);
      }
    }
  } catch (e) { info.error = e.message; }
  return info;
}

/** 启动横幅里的那一行。为什么非打不可: 种没种上, 只有在演示当天打开页面才会发现,
 *  而那时候已经没时间看日志了 —— 所以在启动的那一秒就说清楚。 */
function seedLine(info) {
  if (!info || !info.enabled) return '预置:   未启用(本机模式; 想种一份演示数据就 FUNDCLINIC_SEED=1)';
  const all = info.added.concat(info.existing);
  const failed = info.failed.length ? ' · 失败: ' + info.failed.join('; ') : '';
  if (!all.length) {
    if (info.failed.length) return '预置:   失败 —— ' + info.failed.join('; ');
    return '预置:   无可用种子(' + (info.error || '_seed/ 下没有 6 位数字目录') + ')';
  }
  const names = all.join(', ');
  if (!info.added.length) return '预置:   ' + all.length + ' 只已在位(' + names + '), 不覆盖' + failed;
  /* 有新增也有"已在位"时要说清这次到底种了几只 —— 只报总数会让人以为全是这次复制过来的,
     排查"为什么重启后还是旧数据"时正好指错方向。 */
  const mix = info.existing.length ? ', 本次新种 ' + info.added.length + ' 只' : '';
  return '预置:   已就位 ' + all.length + ' 只(' + names + mix + ') —— 重新部署后秒开, 不用现场跑' + failed;
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
function json(res, status, obj, headers = {}) { send(res, status, JSON.stringify(obj, null, 1), { 'Content-Type': 'application/json; charset=utf-8', ...headers }); }

/* 用量闸门的统一拒绝出口。
   run / ask / compare 三个会花钱的入口共用这个函数, 免得三处各写一遍、
   其中一处忘了带 Retry-After —— 那种不一致最难查(页面上表现只是"有时能重试有时不能")。 */
function quotaReject(res, gate) {
  return json(res, gate.status || 429, {
    error: gate.reason,
    quota: quotaSnapshot(),
    retryAfterSec: gate.retryAfterSec || null
  }, { 'Retry-After': String(gate.retryAfterSec || 600) });
}

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

    /* ---------------- 多基金对比（最多 3 只，只抓净值不跑全流程） ---------------- */
    if (pathname === '/api/compare' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const codes = (Array.isArray(body.codes) ? body.codes : String(body.codes || '').split(/[\s,，、]+/))
        .map(c => String(c || '').trim()).filter(c => /^\d{6}$/.test(c));
      if (!codes.length) return json(res, 400, { error: '请至少输入一个 6 位基金代码' });
      if (codes.length > 3) return json(res, 400, { error: '最多对比 3 只基金' });
      /* 用量闸门: 对比不调大模型, 但每次要发 1–3 个外部抓取请求, 公网上同样能被刷。
         缓存命中也照记 —— 这道闸门管的是"谁在用这个入口", 不是"这次花了多少钱"。 */
      const gate = quotaCheck(clientIp(req), 'compare');
      if (!gate.ok) return quotaReject(res, gate);
      quotaRecord(clientIp(req), 'compare');
      try {
        const { compareFunds } = await import('./server/compare.mjs');
        const r = await compareFunds(codes);
        return json(res, 200, r);
      } catch (e) {
        return json(res, 502, { error: '对比失败: ' + e.message });
      }
    }

    /* ---------------- 页面内问答（只答报告里已有的事） ---------------- */
    if (pathname === '/api/ask' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const code = String(body.code || '').replace(/[^\d]/g, '');
      if (!/^\d{6}$/.test(code)) return json(res, 400, { error: '先选一只已复盘的基金（6 位代码）' });
      /* 密钥来源：优先用服务端自己的 Key；服务端没配时才接受浏览器带来的，且只允许 https。
         不这么限制的话，公网部署后任何人都能拿本站当代理去打内网地址。 */
      const serverAi = mergeLLM({});
      let ai;
      if (serverAi.apiKey) {
        ai = serverAi;
      } else {
        const asked = body.ai || {};
        const base = String(asked.baseUrl || '').trim();
        if (base && !/^https:\/\//i.test(base)) return json(res, 400, { error: '模型地址必须是 https://' });
        ai = mergeLLM({ baseUrl: base, model: asked.model, apiKey: asked.apiKey });
      }
      if (!ai.apiKey) return json(res, 400, { error: '问答需要 API Key：填在页面设置里，或由服务端配置' });
      /* 闸门放在 Key 检查之后: 没配 Key 时该报的是"缺 Key", 不是"额度用完", 否则排查方向被带偏。
         问一句虽然只有一轮模型调用, 但它是**成本最低的入口** —— 一段循环脚本能刷几百次,
         所以单独一套额度(默认 10/小时、30/天、全站 150/天)比共用跑复盘的额度更合理。 */
      const gate = quotaCheck(clientIp(req), 'ask');
      if (!gate.ok) return quotaReject(res, gate);
      quotaRecord(clientIp(req), 'ask');
      try {
        const { askAboutRun } = await import('./server/ask.mjs');
        const r = await askAboutRun(ai, { code, question: body.question });
        quotaAddUsageOne(r && r.usage);
        /* 客户端问题(没复盘过 / 问题为空)用 400，上游模型失败才用 502，别把两种情况混成一个状态码 */
        const clientErr = r.ok === false && /还没有跑过复盘|问题为空/.test(String(r.error || ''));
        return json(res, r.ok ? 200 : (clientErr ? 400 : 502), r);
      } catch (e) {
        return json(res, 502, { error: '问答失败: ' + e.message });
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
      if (!gate.ok) return quotaReject(res, gate);

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
      // _runs 目录不对外暴露(交付物走 /api/download); _seed 是同源的种子, 一视同仁挡掉
      if (rel.startsWith('/_runs') || rel.startsWith('/_seed') || rel.startsWith('/server') || rel.startsWith('/tools')) return json(res, 403, { error: '禁止访问' });
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

function announce(port, seedInfo) {
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
  console.log('  ' + seedLine(seedInfo));
  /* 公网模式必须在启动横幅里说清额度, 否则"今天怎么跑不了"要到被拦住才发现 */
  if (QUOTA.enabled) {
    const L = QUOTA.limits;
    console.log('  额度:   每台机器 ' + L.perIpHour + ' 次/小时 · ' + L.perIpDay + ' 次/天 · 全站 ' + L.maxRunsDay + ' 次/天');
    console.log('          今天是 ' + QUOTA.day + ' · 已用 ' + QUOTA.dayRuns + '/' + L.maxRunsDay + ' 次 · 累计 ' + QUOTA.totalRuns + ' 次 · ' + QUOTA.tokens.total + ' token');
    /* 另两种入口也报出来 —— "问答没反应"和"对比转圈"这两种求助, 十有八九是被轻闸门拦住了,
       不写在横幅上就只能靠人猜。 */
    const A = QUOTA.ask && QUOTA.ask.limits, C = QUOTA.compare && QUOTA.compare.limits;
    if (A) console.log('          问答:   ' + A.perIpHour + ' 次/小时 · ' + A.perIpDay + ' 次/天/台 · 全站 ' + A.maxDay + ' 次/天(今天已用 ' + QUOTA.ask.usedToday + ')');
    if (C) console.log('          对比:   ' + C.perIpHour + ' 次/小时 · ' + C.perIpDay + ' 次/天/台(今天已用 ' + QUOTA.compare.usedToday + ')');
    console.log('          改额度: FUNDCLINIC_MAX_PER_IP_HOUR / _PER_IP_DAY / _MAX_RUNS_DAY;');
    console.log('                  以及 _ASK_PER_IP_HOUR / _ASK_PER_IP_DAY / _ASK_DAY / _COMPARE_PER_IP_HOUR / _COMPARE_PER_IP_DAY; 关掉: FUNDCLINIC_QUOTA=0');
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
server.listen(PORT, HOST, () => {
  /* 补种必须在 announce() 之前: announce() 里会 restoreAll() 把 _runs/ 恢复进内存,
     种子晚一步落地的话, 第一屏的"最近的复盘记录"还是空的(要等下次重启才出现)。
     种子是几十个文件的小复制(种子总量 ~2MB), 同步做掉, 不值得为它引入异步时序。 */
  announce(PORT, seedRuns());
});
