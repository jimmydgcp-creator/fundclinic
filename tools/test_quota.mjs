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

/* ============================================================ ⑤ 真的接进 /api/run 了吗 */
console.log('\n=== ⑤ 接线验证: 起一个云模式服务, 用 HTTP 撞 ===\n');
const PORT = 8901;
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
  }
} finally {
  stop();
  try { fs.rmSync(seeded, { force: true }); } catch (e) {}
}

/* ============================================================ ⑥ 本地模式不受影响 */
console.log('\n=== ⑥ 反证: 同样的服务不开闸门时, 不该出现 429 ===\n');
{
  const child2 = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, FUNDCLINIC_CLOUD: '1', PORT: String(PORT + 1), FUNDCLINIC_QUOTA: '0', FUNDCLINIC_ALLOW_NO_AI: '1', FUNDCLINIC_LLM_KEY: 'test-key-not-real' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out2 = '';
  child2.stdout.on('data', d => { out2 += d.toString(); });
  child2.stderr.on('data', d => { out2 += d.toString(); });
  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 15000 && !up) {
      try { const r = await fetch('http://127.0.0.1:' + (PORT + 1) + '/api/health'); if (r.ok) up = true; } catch (e) { await new Promise(r => setTimeout(r, 300)); }
    }
    ok(up, '第二个服务起来了');
    if (up) {
      const h = await (await fetch('http://127.0.0.1:' + (PORT + 1) + '/api/health')).json();
      ok(h.quota && h.quota.enabled === false, 'FUNDCLINIC_QUOTA=0 → 闸门关闭', JSON.stringify(h.quota && h.quota.enabled));
      ok(/额度:   未启用/.test(out2), '启动横幅写明"未启用"而不是装作有限额');
    }
  } finally { try { child2.kill(); } catch (e) {} }
}

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
