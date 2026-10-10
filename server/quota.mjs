/* quota.mjs —— 公网模式的用量闸门
 *
 * 这个模块存在的唯一理由, 是一个花钱的开放问题:
 *   本地跑的时候, 每台电脑用自己的 Key, 花销自己承担 —— 没有任何风险。
 *   但把它放上公网、并且**服务端持有你的 Key**(访客只输基金代码), 情况就反过来了:
 *   Key 变成"任何点开链接的人都能花的钱"。链接被爬虫扫到、或者同学好奇连点十次,
 *   账单都记在你头上。这不属于"要不要加"的问题, 属于"不加就别上公网"。
 *
 * 三道闸(全部可调, 不设就是保守默认):
 *   ① 同一台机器每小时 N 次   FUNDCLINIC_MAX_PER_IP_HOUR  默认 3
 *   ② 同一台机器每天   N 次   FUNDCLINIC_MAX_PER_IP_DAY   默认 8
 *   ③ 全站每天         N 次   FUNDCLINIC_MAX_RUNS_DAY     默认 40 ← 真正兜住账单的那一道
 *
 * 纪律:
 *   - **本地行为一字不变**。默认只在云端模式(平台注入的变量)下启用; 本机想试可以设
 *     FUNDCLINIC_QUOTA=1。这条和端口逻辑一样, 由 tools/test_cloud_mode.mjs 之外的
 *     tools/test_quota.mjs 单独钉住。
 *   - 计数落盘到 _runs/.quota.json, 这样同一个实例进程重启(崩溃自愈)后额度不会白送;
 *     但**平台重新部署会换新磁盘**, 所以它是"尽力而为"的防呆, 不是计费系统。真要严格,
 *     得换成外部存储 —— 那是另一个工程量, 这里不做, 写清楚。
 *   - 额度按**北京时间**跨天(受众在国内, 让人看到"明天 0 点恢复"是能对上表的)。
 *   - 只报数、不记人: 不落访客 IP 明文, 落盘用 IP 的短哈希。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const HOUR = 3600 * 1000;
const CN_OFFSET = 8 * HOUR;

let cfg = { enabled: false, perIpHour: 3, perIpDay: 8, maxRunsDay: 40, file: '' };
let state = blank();

/** 北京时间下的"今天"(这样额度在天亮前不会莫名其妙重置) */
function today() { return new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10); }
function blank() { return { day: today(), dayRuns: 0, totalRuns: 0, promptTokens: 0, completionTokens: 0, ips: {}, hours: {} }; }
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; }
/* IP 只留短哈希 —— 防呆用的计数, 不需要知道是谁 */
function tag(ip) { return crypto.createHash('sha1').update(String(ip || 'unknown')).digest('hex').slice(0, 12); }

function load() {
  state = blank();
  if (!cfg.file) return;
  try {
    const j = JSON.parse(fs.readFileSync(cfg.file, 'utf8'));
    if (j && j.day === state.day) {
      state.dayRuns = num(j.dayRuns, 0);
      state.totalRuns = num(j.totalRuns, 0);
      state.promptTokens = num(j.promptTokens, 0);
      state.completionTokens = num(j.completionTokens, 0);
      state.ips = j.ips && typeof j.ips === 'object' ? j.ips : {};
      state.hours = j.hours && typeof j.hours === 'object' ? j.hours : {};
      // 过期的整点桶直接丢掉, 免得文件越滚越大
      const now = Date.now();
      Object.keys(state.hours).forEach(k => {
        const keep = (state.hours[k] || []).filter(t => now - Number(t) < HOUR);
        if (keep.length) state.hours[k] = keep; else delete state.hours[k];
      });
    }
  } catch (e) { /* 文件坏了就当没有 —— 闸门宁可重新开始计数, 也不能因此启动失败 */ }
}
function save() {
  if (!cfg.file) return;
  try { fs.writeFileSync(cfg.file, JSON.stringify(state), 'utf8'); } catch (e) { /* 落盘失败不影响跑 */ }
}

/** 跨天就翻页(顺手清掉小时桶) */
function rollDay() {
  const d = today();
  if (state.day !== d) {
    state = { ...blank(), day: d, totalRuns: state.totalRuns, promptTokens: state.promptTokens, completionTokens: state.completionTokens };
    save();
  }
}

/** FUNDCLINIC_QUOTA 是**三态**: 1=强制开, 0=强制关, 不设=跟随 fallback(云端开 / 本地关)。
 *  写在这里而不是 server.mjs, 是因为"启动横幅说可以关、实际关不掉"这种自相矛盾最难查 ——
 *  第一次跑 test_quota 就撞上了: 横幅写着"关掉: FUNDCLINIC_QUOTA=0", 而在云端模式下它关不掉。 */
export function quotaEnabledFromEnv(fallback) {
  const v = process.env.FUNDCLINIC_QUOTA;
  return v === '0' ? false : v === '1' ? true : !!fallback;
}

/** 启动时调用一次。server.mjs 把"是否云端"这件事传进来, 避免两处各自判断平台变量而走偏。 */
export function initQuota(o = {}) {
  const env = process.env;
  cfg = {
    enabled: o.enabled != null ? !!o.enabled : quotaEnabledFromEnv(false),
    perIpHour: num(o.perIpHour != null ? o.perIpHour : env.FUNDCLINIC_MAX_PER_IP_HOUR, 3),
    perIpDay: num(o.perIpDay != null ? o.perIpDay : env.FUNDCLINIC_MAX_PER_IP_DAY, 8),
    maxRunsDay: num(o.maxRunsDay != null ? o.maxRunsDay : env.FUNDCLINIC_MAX_RUNS_DAY, 40),
    /* 显式传入的路径优先(server.mjs 会先看 FUNDCLINIC_QUOTA_FILE 再回落 _runs/.quota.json) */
    file: o.file || env.FUNDCLINIC_QUOTA_FILE || ''
  };
  load();
  return quotaSnapshot();
}

/** 开跑前问一句。返回 {ok:true,left:{...}} 或 {ok:false,status:429,reason,retryAfterSec} */
export function quotaCheck(ip) {
  if (!cfg.enabled) return { ok: true, disabled: true };
  rollDay();
  const now = Date.now();
  const k = tag(ip);
  const hours = (state.hours[k] || []).filter(t => now - Number(t) < HOUR);
  state.hours[k] = hours;

  if (state.dayRuns >= cfg.maxRunsDay) {
    return {
      ok: false, status: 429, kind: 'global', retryAfterSec: 600,
      reason: `今天全站额度已用完(上限 ${cfg.maxRunsDay} 次)—— 这是为了控制 API Key 的花费。北京时间明天 0 点恢复。`
    };
  }
  const used = state.ips[k] || 0;
  if (used >= cfg.perIpDay) {
    return {
      ok: false, status: 429, kind: 'ipDay', retryAfterSec: 600,
      reason: `同一台机器今天已跑 ${cfg.perIpDay} 次, 到上限了(全站每日 ${cfg.maxRunsDay} 次)。北京时间明天 0 点恢复。`
    };
  }
  if (hours.length >= cfg.perIpHour) {
    const waitMs = HOUR - (now - Number(hours[0]));
    const min = Math.max(1, Math.ceil(waitMs / 60000));
    return {
      ok: false, status: 429, kind: 'ipHour', retryAfterSec: Math.ceil(waitMs / 1000),
      reason: `同一台机器每小时最多 ${cfg.perIpHour} 次, 请等约 ${min} 分钟再试(每次要调好几轮大模型, 得算着花)。`
    };
  }
  return { ok: true, left: { hour: cfg.perIpHour - hours.length, day: cfg.perIpDay - used, global: cfg.maxRunsDay - state.dayRuns } };
}

/** 真正开始跑了才计数(在流水线启动之前调用) */
export function quotaRecord(ip) {
  if (!cfg.enabled) return;
  rollDay();
  const now = Date.now();
  const k = tag(ip);
  (state.hours[k] = state.hours[k] || []).push(now);
  state.ips[k] = (state.ips[k] || 0) + 1;
  state.dayRuns++;
  state.totalRuns++;
  save();
}

/** 一次跑完把 token 累加上去, 让 /api/health 能报"今天花了多少" */
export function quotaAddUsage(aiLog) {
  if (!Array.isArray(aiLog)) return;
  for (const x of aiLog) {
    const u = x && x.usage;
    if (!u) continue;
    state.promptTokens += num(u.prompt_tokens, 0);
    state.completionTokens += num(u.completion_tokens, 0);
  }
  save();
}

export function quotaSnapshot() {
  rollDay();
  return {
    enabled: cfg.enabled,
    limits: { perIpHour: cfg.perIpHour, perIpDay: cfg.perIpDay, maxRunsDay: cfg.maxRunsDay },
    day: state.day,
    dayRuns: state.dayRuns,
    dayLeft: Math.max(0, cfg.maxRunsDay - state.dayRuns),
    totalRuns: state.totalRuns,
    visitors: Object.keys(state.ips).length,
    tokens: {
      prompt: state.promptTokens,
      completion: state.completionTokens,
      total: state.promptTokens + state.completionTokens
    }
  };
}

/** 仅供测试: 清空计数 */
export function _resetQuota() { state = blank(); if (cfg.file) { try { fs.rmSync(cfg.file, { force: true }); } catch (e) {} } }
export function _quotaConfig() { return { ...cfg }; }
