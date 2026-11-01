/* test_quota.mjs —— 公网用量闸门
 *
 * 为什么必须测: 这道闸门是**唯一**挡住"别人花你的 API Key 的钱"的东西。
 * 它有两种失效方式, 都会安静地发生:
 *   ① 该拦没拦 —— 写了但没接进 /api/run, 页面上一切正常, 账单来了才知道;
 *   ② 不该拦却拦了 —— 本地各自用自己的 Key, 却被限额打扰(这条会让组员以为程序坏了)。
 * 所以分成两段: 先单测闸门逻辑本身, 再真的起一个云模式服务、用 HTTP 撞一次。
 *
 * 用法: node tools/test_quota.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initQuota, quotaCheck, quotaRecord, quotaAddUsage, quotaSnapshot, _resetQuota, _quotaConfig } from '../server/quota.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

/* ============================================================ ① 本地默认: 不管
   这条是"不打扰组员"的保证 —— 本机跑各自用自己的 Key, 限额毫无意义。 */
console.log('=== ① 本地默认(不设任何变量)→ 完全不限额 ===\n');
initQuota({ enabled: false, file: '' });
_resetQuota();
for (let i = 0; i < 25; i++) {
  const r = quotaCheck('1.2.3.4');
  if (!r.ok) break;
  quotaRecord('1.2.3.4');
}
ok(_quotaConfig().enabled === false, '本地默认闸门关闭');
ok(quotaSnapshot().dayRuns === 0, '关着的时候连计数都不做(不给本机留垃圾状态)', String(quotaSnapshot().dayRuns));

/* ============================================================ ② 开了闸: 三道闸逐个验 */
console.log('\n=== ② 打开闸门: 每 IP 每小时 / 每 IP 每天 / 全站每天 ===\n');
const tmp = path.join(os.tmpdir(), 'fc-quota-test-' + Date.now() + '.json');
initQuota({ enabled: true, perIpHour: 3, perIpDay: 5, maxRunsDay: 8, file: tmp });
_resetQuota();

ok(quotaCheck('10.0.0.1').ok, '第 1 次放行');
quotaRecord('10.0.0.1');
ok(quotaCheck('10.0.0.1').ok, '第 2 次放行');
quotaRecord('10.0.0.1');
ok(quotaCheck('10.0.0.1').ok, '第 3 次放行');
quotaRecord('10.0.0.1');
const h4 = quotaCheck('10.0.0.1');
ok(!h4.ok && h4.kind === 'ipHour', '第 4 次被拦(每 IP 每小时 3 次)', h4.reason);
ok(!h4.ok && h4.retryAfterSec > 0 && h4.retryAfterSec <= 3600, '带 Retry-After 秒数', String(h4.retryAfterSec));
ok(/每小时|等约/.test(h4.reason || ''), '拦截理由是给人看的中文, 不是错误码', (h4.reason || '').slice(0, 40));
ok(quotaCheck('10.0.0.2').ok, '换一台机器不受影响(闸门是按 IP 记的)');

/* 绕过"每小时"的限制, 单独验"每 IP 每天": 每小时限 10, 每天限 5 */
initQuota({ enabled: true, perIpHour: 10, perIpDay: 5, maxRunsDay: 99, file: '' });
_resetQuota();
for (let i = 0; i < 5; i++) { quotaRecord('10.0.0.9'); }
const d6 = quotaCheck('10.0.0.9');
ok(!d6.ok && d6.kind === 'ipDay', '同一台机器第 6 次被拦(每 IP 每天 5 次)', d6.reason);

/* 全站闸: 多个不同 IP 一起把全站额度耗光 */
initQuota({ enabled: true, perIpHour: 10, perIpDay: 10, maxRunsDay: 6, file: '' });
_resetQuota();
for (let i = 0; i < 6; i++) quotaRecord('10.1.0.' + i);
const g = quotaCheck('10.2.0.1');
ok(!g.ok && g.kind === 'global', '全站额度用完 → 新访客也被拦(这才是真正兜住账单的那一道)', g.reason);
ok(quotaSnapshot().visitors === 6, '访客数按去重计数', String(quotaSnapshot().visitors));

/* ============================================================ ③ token 记账 */
console.log('\n=== ③ token 用量记账(给群主看花了多少) ===\n');
initQuota({ enabled: true, file: '' });
_resetQuota();
quotaAddUsage([{ usage: { prompt_tokens: 1200, completion_tokens: 300 } }, { usage: { prompt_tokens: 800, completion_tokens: 200 } }, { noUsage: true }]);
const snap = quotaSnapshot();
ok(snap.tokens.prompt === 2000 && snap.tokens.completion === 500 && snap.tokens.total === 2500, 'token 累加正确', JSON.stringify(snap.tokens));
/* 默认值必须写死在这儿, 因为它们是"没配也能兜住账单"的那一组数, 改了要有意识 */
ok(snap.limits.perIpHour === 3 && snap.limits.perIpDay === 8 && snap.limits.maxRunsDay === 40, '不给参数时的默认额度 = 每 IP 3/小时 · 8/天 · 全站 40/天', JSON.stringify(snap.limits));

/* ============================================================ ④ 落盘: 进程重启不白送额度 */
console.log('\n=== ④ 计数落盘 → 同一实例进程重启后额度不重置 ===\n');
initQuota({ enabled: true, perIpHour: 10, perIpDay: 10, maxRunsDay: 3, file: tmp });
_resetQuota();
quotaRecord('10.0.0.7'); quotaRecord('10.0.0.7');
ok(fs.existsSync(tmp), '计数写进了 _runs/.quota.json(测试里是临时文件)');
initQuota({ enabled: true, perIpHour: 10, perIpDay: 10, maxRunsDay: 3, file: tmp });   // 模拟进程重启
ok(quotaSnapshot().dayRuns === 2, '重启后已用次数还是 2(没有白送)', String(quotaSnapshot().dayRuns));
ok(quotaCheck('10.0.0.7').ok, '还没到全站上限时仍放行');
quotaRecord('10.0.0.7');
ok(!quotaCheck('10.0.0.8').ok, '第 3 次用完 → 全站闸拦下后来的访客');
try { fs.rmSync(tmp, { force: true }); } catch (e) {}

/* 端口不能写死。原来写死 8901, 在这台机器上被「抖音托盘」那个无关进程占着,
   服务自动顺延到 8902, 而测试还在 8901 上等 —— 表现是"服务明明起来了, 测试说没起来",
   这种"看起来像代码 bug 的机器环境问题"最容易白烧半小时。改成现取一个空闲端口。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/* ============================================================ ⑤ 真的接进 /api/run 了吗 */
console.log('\n=== ⑤ 接线验证: 起一个云模式服务, 用 HTTP 撞 ===\n');
const PORT = await freePort();
const seeded = path.join(ROOT, '_runs', '.quota-test.json');
/* 直接把当日计数写成"已满" —— 这样第一条请求就该被拦, 不用真跑一遍 20 秒的流水线 */
fs.writeFileSync(seeded, JSON.stringify({ day: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), dayRuns: 99, totalRuns: 99, promptTokens: 0, completionTokens: 0, ips: {}, hours: {} }), 'utf8');

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, FUNDCLINIC_CLOUD: '1', PORT: String(PORT), FUNDCLINIC_QUOTA: '1', FUNDCLINIC_MAX_RUNS_DAY: '5', FUNDCLINIC_QUOTA_FILE: seeded, FUNDCLINIC_ALLOW_NO_AI: '1', FUNDCLINIC_LLM_KEY: 'test-key-not-real' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOut = '';
child.stdout.on('data', d => { serverOut += d.toString(); });
child.stderr.on('data', d => { serverOut += d.toString(); });
const stop = () => { try { child.kill(); } catch (e) {} };

const base = 'http://127.0.0.1:' + PORT;
async function waitUp(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

try {
  const up = await waitUp(15000);
  ok(up, '云模式服务起来了', up ? '' : serverOut.slice(-400));
  if (up) {
    const h = await (await fetch(base + '/api/health')).json();
    ok(h.quota && h.quota.enabled === true, '/api/health 报出了额度状态', JSON.stringify(h.quota && h.quota.limits));
    ok(/监听:   0\.0\.0\.0/.test(serverOut) || /已启动\(云端模式\)/.test(serverOut), '启动横幅标了云模式');
    ok(/额度:/.test(serverOut), '启动横幅把额度说清楚了', (serverOut.match(/额度:.*/) || [''])[0].trim());

    const r = await fetch(base + '/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '519191' })
    });
    const j = await r.json().catch(() => ({}));
    ok(r.status === 429, '当日额度已满时 /api/run 直接返回 429(不是先跑 20 秒再报错)', 'HTTP ' + r.status);
    ok(!!(j.error && /额度/.test(j.error)), '429 带一句人话原因', (j.error || '').slice(0, 50));
    ok(!!j.quota, '429 里带上额度快照(页面能顺手刷新剩余次数)');
    ok(!!r.headers.get('retry-after') || j.retryAfterSec, '给了重试时间');

    /* 分桶的核心反证: 跑复盘的额度满了, 问一句和做对比不该跟着一起挂。
       以前三种入口共用一套计数, 表现是"问了两句话, 那个小时再也跑不了复盘"。 */
    const cmp = await fetch(base + '/api/compare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: ['519191'] })
    });
    ok(cmp.status !== 429, '复盘额度用完 ≠ 对比也被拦(两个桶各记各的)', 'HTTP ' + cmp.status);
    const ask = await fetch(base + '/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '519191', question: '这只基金怎么看' })
    });
    ok(ask.status !== 429, '复盘额度用完 ≠ 问一句也被拦', 'HTTP ' + ask.status);
  }
} finally {
  stop();
  try { fs.rmSync(seeded, { force: true }); } catch (e) {}
}

/* ============================================================ ⑥ 本地模式不受影响 */
console.log('\n=== ⑥ 反证: 同样的服务不开闸门时, 不该出现 429 ===\n');
{
  const P6 = await freePort();
  const child2 = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, FUNDCLINIC_CLOUD: '1', PORT: String(P6), FUNDCLINIC_QUOTA: '0', FUNDCLINIC_ALLOW_NO_AI: '1', FUNDCLINIC_LLM_KEY: 'test-key-not-real' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out2 = '';
  child2.stdout.on('data', d => { out2 += d.toString(); });
  child2.stderr.on('data', d => { out2 += d.toString(); });
  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 15000 && !up) {
      try { const r = await fetch('http://127.0.0.1:' + P6 + '/api/health'); if (r.ok) up = true; } catch (e) { await new Promise(r => setTimeout(r, 300)); }
    }
    ok(up, '第二个服务起来了');
    if (up) {
      const h = await (await fetch('http://127.0.0.1:' + P6 + '/api/health')).json();
      ok(h.quota && h.quota.enabled === false, 'FUNDCLINIC_QUOTA=0 → 闸门关闭', JSON.stringify(h.quota && h.quota.enabled));
      ok(/额度:   未启用/.test(out2), '启动横幅写明"未启用"而不是装作有限额');
    }
  } finally { try { child2.kill(); } catch (e) {} }
}

/* ============================================================ ⑦ 问答 / 对比: 各自的桶, 不抢复盘额度 */
console.log('\n=== ⑦ 问答与对比各有独立额度(三桶互不抢占) ===\n');
initQuota({
  enabled: true, perIpHour: 3, perIpDay: 8, maxRunsDay: 40,
  ask: { perIpHour: 2, perIpDay: 3, maxDay: 5 },
  compare: { perIpHour: 2, perIpDay: 4, maxDay: 0 },
  file: ''
});
_resetQuota();
ok(quotaCheck('9.9.9.9', 'ask').ok, '问一句: 第 1 次放行');
quotaRecord('9.9.9.9', 'ask');
ok(quotaCheck('9.9.9.9', 'ask').ok, '问一句: 第 2 次放行');
quotaRecord('9.9.9.9', 'ask');
const a3 = quotaCheck('9.9.9.9', 'ask');
ok(!a3.ok && a3.kind === 'ipHour', '问一句: 第 3 次被拦(每小时 2 次)', a3.reason);
ok(/问一句/.test(a3.reason || ''), '拦截理由是"问一句", 不是笼统的"额度用完"', (a3.reason || '').slice(0, 40));
/* 关键反证: 问了两次, 复盘的额度一点没动 */
ok(quotaCheck('9.9.9.9').ok, '问了两句之后, 跑复盘的额度没被动过(这就是分桶的意义)');
ok(quotaSnapshot().dayRuns === 0, '跑复盘的计数仍是 0', String(quotaSnapshot().dayRuns));
ok(quotaSnapshot().ask.usedToday === 2, '问一句的计数独立记到 ask 桶里', String(quotaSnapshot().ask.usedToday));
/* 对比是第三条线 */
ok(quotaCheck('9.9.9.9', 'compare').ok, '对比: 不受问答影响');
quotaRecord('9.9.9.9', 'compare'); quotaRecord('9.9.9.9', 'compare');
const c3 = quotaCheck('9.9.9.9', 'compare');
ok(!c3.ok && c3.kind === 'ipHour', '对比: 第 3 次被拦(每小时 2 次)', c3.reason);
ok(/对比/.test(c3.reason || ''), '拦截理由说的是"对比"', (c3.reason || '').slice(0, 40));

/* 问一句是成本最低的入口(一轮模型调用), 所以它必须有全站上限兜底 */
initQuota({ enabled: true, ask: { perIpHour: 9, perIpDay: 9, maxDay: 4 }, file: '' });
_resetQuota();
for (let i = 0; i < 4; i++) quotaRecord('9.8.8.' + i, 'ask');
const ag = quotaCheck('9.7.7.7', 'ask');
ok(!ag.ok && ag.kind === 'global', '问一句的全站上限真会拦(挡循环刷接口的那一道)', ag.reason);

/* 对比默认不设全站上限: maxDay=0 的意思是"不限", 绝不是"一次都不许" */
initQuota({ enabled: true, compare: { perIpHour: 9, perIpDay: 9, maxDay: 0 }, file: '' });
_resetQuota();
for (let i = 0; i < 50; i++) quotaRecord('9.6.6.' + i, 'compare');
ok(quotaCheck('9.5.5.5', 'compare').ok, '对比默认不设全站上限(0 = 不限, 不是"一次都不许")');
ok(quotaSnapshot().compare.limits.maxDay === 0, '快照里如实报出 maxDay=0', JSON.stringify(quotaSnapshot().compare.limits));

/* ============================================================ ⑧ 接线验证: ask / compare 真的被接进了 HTTP 路由 */
console.log('\n=== ⑧ 接线验证: /api/ask 与 /api/compare 的闸门 ===\n');
{
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const seed = path.join(ROOT, '_runs', '.quota-test2.json');
  /* 把两类各自的当日计数写成"已满": 闸门在抓任何东西之前就该拦下, 所以这条测试不需要网络 */
  fs.writeFileSync(seed, JSON.stringify({
    day: today, dayRuns: 0, totalRuns: 9, promptTokens: 0, completionTokens: 0, ips: {}, hours: {},
    kinds: {
      ask: { day: today, dayCount: 99, total: 99, ips: {}, hours: {} },
      compare: { day: today, dayCount: 99, total: 99, ips: {}, hours: {} }
    }
  }), 'utf8');

  const P8 = await freePort();
  const c3 = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    /* 刻意把两类的全站上限调到 5(低于种子里的 99), 否则默认额度够宽, 种子再怎么填也撞不上闸门
       —— 第一版就是只种了 99 而没改上限, 结果闸门没触发, 测试却看不出哪里错。 */
    env: {
      ...process.env, FUNDCLINIC_CLOUD: '1', PORT: String(P8), FUNDCLINIC_QUOTA: '1', FUNDCLINIC_QUOTA_FILE: seed,
      FUNDCLINIC_ALLOW_NO_AI: '1', FUNDCLINIC_LLM_KEY: 'test-key-not-real',
      FUNDCLINIC_MAX_ASK_DAY: '5', FUNDCLINIC_MAX_COMPARE_DAY: '5'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out3 = '';
  c3.stdout.on('data', d => { out3 += d.toString(); });
  c3.stderr.on('data', d => { out3 += d.toString(); });
  try {
    const b3 = 'http://127.0.0.1:' + P8;
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 15000 && !up) {
      try { const r = await fetch(b3 + '/api/health'); if (r.ok) up = true; } catch (e) { await new Promise(r => setTimeout(r, 300)); }
    }
    ok(up, '第三个服务起来了', up ? '' : out3.slice(-300));
    if (up) {
      const h = await (await fetch(b3 + '/api/health')).json();
      ok(h.quota && h.quota.ask && h.quota.compare, '/api/health 里能看到问答/对比各自的用量');
      ok(/问答:/.test(out3) && /对比:/.test(out3), '启动横幅把两种入口的额度都报出来了');

      const ra = await fetch(b3 + '/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '519191', question: '随便问问' })
      });
      const ja = await ra.json().catch(() => ({}));
      ok(ra.status === 429, '/api/ask 被闸门拦下(429), 而且是在调模型之前', 'HTTP ' + ra.status);
      ok(!!ja.retryAfterSec && !!ra.headers.get('retry-after'), '问答 429 带 Retry-After');
      ok(!!(ja.error && /问一句/.test(ja.error)), '问答 429 的理由是人话', (ja.error || '').slice(0, 40));

      const rc = await fetch(b3 + '/api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: ['519191', '005827'] })
      });
      const jc = await rc.json().catch(() => ({}));
      ok(rc.status === 429, '/api/compare 被闸门拦下(429), 而且是在发抓取请求之前', 'HTTP ' + rc.status);
      ok(!!jc.retryAfterSec && !!rc.headers.get('retry-after'), '对比 429 带 Retry-After');
      ok(!!(jc.error && /对比/.test(jc.error)), '对比 429 的理由是人话', (jc.error || '').slice(0, 40));
      ok(!!jc.quota && !!jc.quota.compare, '对比 429 里带上额度快照');
    }
  } finally {
    try { c3.kill(); } catch (e) {}
    try { fs.rmSync(seed, { force: true }); } catch (e) {}
  }
}

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
