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
 * 另外两种"不跑全流程、但照样花钱或花外部请求"的入口, 各有一套独立的轻闸门(2026-11-01 加):
 *   ④ 页面内问答 /api/ask       每 IP 每小时  FUNDCLINIC_MAX_ASK_PER_IP_HOUR     默认 10
 *                              每 IP 每天    FUNDCLINIC_MAX_ASK_PER_IP_DAY      默认 30
 *                              全站每天      FUNDCLINIC_MAX_ASK_DAY             默认 150
 *   ⑤ 多基金对比 /api/compare   每 IP 每小时  FUNDCLINIC_MAX_COMPARE_PER_IP_HOUR 默认 20
 *                              每 IP 每天    FUNDCLINIC_MAX_COMPARE_PER_IP_DAY  默认 60
 *   (对比只抓净值、不调大模型, 所以只按台数记, 不设全站上限)
 *
 * 为什么必须分开记而不是共用一套: 跑一次复盘要调好几轮大模型(几分钟),
 *   问一句只要一轮(几秒), 对比只发一两个抓取请求。共用计数会出荒唐结果 ——
 *   在页面上问了两句话, 那个小时就再也跑不了复盘。分桶之后, 每类各挡各的,
 *   既拦得住刷接口的人, 又不打扰正常用的人。
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
 *   - 上限填 0 = 这一类不设该道闸(方便临时放开), 不是"一次都不许"。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const HOUR = 3600 * 1000;
const CN_OFFSET = 8 * HOUR;

const DEF_ASK = { perIpHour: 10, perIpDay: 30, maxDay: 150 };
const DEF_COMPARE = { perIpHour: 20, perIpDay: 60, maxDay: 0 };

/* 除了 run 之外的两种被计数入口。run 沿用顶层 ips/hours/dayRuns 字段,
   这样旧版本落盘的 .quota.json 还能照原样读出来。 */
const SUB_KINDS = { ask: 'ask', compare: 'compare' };
const KIND_NAME = { run: '跑一次复盘', ask: '问一句', compare: '做一次对比' };

let cfg = { enabled: false, perIpHour: 3, perIpDay: 8, maxRunsDay: 40, ask: { ...DEF_ASK }, compare: { ...DEF_COMPARE }, file: '' };
let state = blank();

/** 北京时间下的"今天"(这样额度在天亮前不会莫名其妙重置) */
function today() { return new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10); }
function blank() { return { day: today(), dayRuns: 0, totalRuns: 0, promptTokens: 0, completionTokens: 0, ips: {}, hours: {}, kinds: {} }; }
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; }
/* IP 只留短哈希 —— 防呆用的计数, 不需要知道是谁 */
function tag(ip) { return crypto.createHash('sha1').update(String(ip || 'unknown')).digest('hex').slice(0, 12); }

/** 把一小时前的计数丢掉, 免得文件越滚越大 */
function trimHours(hours) {
  const now = Date.now();
  Object.keys(hours).forEach(k => {
    const keep = (hours[k] || []).filter(t => now - Number(t) < HOUR);
    if (keep.length) hours[k] = keep; else delete hours[k];
  });
  return hours;
}

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
      state.kinds = j.kinds && typeof j.kinds === 'object' ? j.kinds : {};
      trimHours(state.hours);
      Object.keys(state.kinds).forEach(k => {
        const b = state.kinds[k];
        if (!b || typeof b !== 'object' || b.day !== state.day) { delete state.kinds[k]; return; }
        b.ips = b.ips && typeof b.ips === 'object' ? b.ips : {};
        b.hours = b.hours && typeof b.hours === 'object' ? b.hours : {};
        b.dayCount = num(b.dayCount, 0);
        b.total = num(b.total, 0);
        trimHours(b.hours);
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

/** 取某个非 run 类的当天桶(顺手清理过期数据)。run 返回 null, 走顶层字段。 */
function subBucket(kind) {
  if (!SUB_KINDS[kind]) return null;
  if (!state.kinds || typeof state.kinds !== 'object') state.kinds = {};
  let b = state.kinds[kind];
  if (!b || typeof b !== 'object') b = state.kinds[kind] = { day: today(), dayCount: 0, total: 0, ips: {}, hours: {} };
  if (b.day !== today()) { b.day = today(); b.dayCount = 0; b.ips = {}; b.hours = {}; }
  if (!b.ips || typeof b.ips !== 'object') b.ips = {};
  if (!b.hours || typeof b.hours !== 'object') b.hours = {};
  trimHours(b.hours);
  return b;
}

/** FUNDCLINIC_QUOTA 是**三态**: 1=强制开, 0=强制关, 不设=跟随 fallback(云端开 / 本地关)。
 *  写在这里而不是 server.mjs, 是因为"启动横幅说可以关、实际关不掉"这种自相矛盾最难查 ——
 *  第一次跑 test_quota 就撞上了: 横幅写着"关掉: FUNDCLINIC_QUOTA=0", 而在云端模式下它关不掉。 */
export function quotaEnabledFromEnv(fallback) {
  const v = process.env.FUNDCLINIC_QUOTA;
  return v === '0' ? false : v === '1' ? true : !!fallback;
}

/** 一组额度: 显式传入 > 环境变量 > 默认值 */
function limitsOf(o, env, def) {
  const pick = (a, b, d) => (a != null ? a : b != null ? b : d);
  return {
    perIpHour: num(pick(o.perIpHour, env.FUNDCLINIC_MAX_PER_IP_HOUR, def.perIpHour), def.perIpHour),
    perIpDay: num(pick(o.perIpDay, env.FUNDCLINIC_MAX_PER_IP_DAY, def.perIpDay), def.perIpDay),
    maxDay: num(pick(o.maxDay, env.FUNDCLINIC_MAX_DAY, def.maxDay), def.maxDay)
  };
}

/** 启动时调用一次。server.mjs 把"是否云端"这件事传进来, 避免两处各自判断平台变量而走偏。 */
export function initQuota(o = {}) {
  const env = process.env;
  cfg = {
    enabled: o.enabled != null ? !!o.enabled : quotaEnabledFromEnv(false),
    perIpHour: num(o.perIpHour != null ? o.perIpHour : env.FUNDCLINIC_MAX_PER_IP_HOUR, 3),
    perIpDay: num(o.perIpDay != null ? o.perIpDay : env.FUNDCLINIC_MAX_PER_IP_DAY, 8),
    maxRunsDay: num(o.maxRunsDay != null ? o.maxRunsDay : env.FUNDCLINIC_MAX_RUNS_DAY, 40),
    ask: limitsOf(o.ask || {}, {
      FUNDCLINIC_MAX_PER_IP_HOUR: env.FUNDCLINIC_MAX_ASK_PER_IP_HOUR,
      FUNDCLINIC_MAX_PER_IP_DAY: env.FUNDCLINIC_MAX_ASK_PER_IP_DAY,
      FUNDCLINIC_MAX_DAY: env.FUNDCLINIC_MAX_ASK_DAY
    }, DEF_ASK),
    compare: limitsOf(o.compare || {}, {
      FUNDCLINIC_MAX_PER_IP_HOUR: env.FUNDCLINIC_MAX_COMPARE_PER_IP_HOUR,
      FUNDCLINIC_MAX_PER_IP_DAY: env.FUNDCLINIC_MAX_COMPARE_PER_IP_DAY,
      FUNDCLINIC_MAX_DAY: env.FUNDCLINIC_MAX_COMPARE_DAY
    }, DEF_COMPARE),
    /* 显式传入的路径优先(server.mjs 会先看 FUNDCLINIC_QUOTA_FILE 再回落 _runs/.quota.json) */
    file: o.file || env.FUNDCLINIC_QUOTA_FILE || ''
  };
  load();
  return quotaSnapshot();
}

/** 开跑前问一句。kind: 'run'(默认) | 'ask' | 'compare'
 *  返回 {ok:true,left:{...}} 或 {ok:false,status:429,reason,retryAfterSec} */
export function quotaCheck(ip, kind) {
  if (!cfg.enabled) return { ok: true, disabled: true };
  rollDay();
  const now = Date.now();
  const k = tag(ip);
  const b = subBucket(kind);
  const act = KIND_NAME[kind] || KIND_NAME.run;

  if (b) {
    const lim = cfg[SUB_KINDS[kind]] || { perIpHour: 0, perIpDay: 0, maxDay: 0 };
    const hours = (b.hours[k] = b.hours[k] || []);
    if (lim.maxDay && b.dayCount >= lim.maxDay) {
      return {
        ok: false, status: 429, kind: 'global', retryAfterSec: 600,
        reason: `今天全站${act}的次数已用完(上限 ${lim.maxDay} 次)—— 这是为了控制 API Key 的花费。北京时间明天 0 点恢复。`
      };
    }
    const used = b.ips[k] || 0;
    if (lim.perIpDay && used >= lim.perIpDay) {
      return {
        ok: false, status: 429, kind: 'ipDay', retryAfterSec: 600,
        reason: `同一台机器今天已经${act} ${lim.perIpDay} 次, 到上限了。北京时间明天 0 点恢复。`
      };
    }
    if (lim.perIpHour && hours.length >= lim.perIpHour) {
      const waitMs = HOUR - (now - Number(hours[0]));
      const min = Math.max(1, Math.ceil(waitMs / 60000));
      return {
        ok: false, status: 429, kind: 'ipHour', retryAfterSec: Math.ceil(waitMs / 1000),
        reason: `同一台机器每小时最多${act} ${lim.perIpHour} 次, 请等约 ${min} 分钟再试。`
      };
    }
    return { ok: true, left: { hour: Math.max(0, lim.perIpHour - hours.length), day: Math.max(0, lim.perIpDay - used), global: lim.maxDay ? Math.max(0, lim.maxDay - b.dayCount) : null } };
  }

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

/** 真正开始跑了才计数(在流水线启动之前调用)。kind 同 quotaCheck。 */
export function quotaRecord(ip, kind) {
  if (!cfg.enabled) return;
  rollDay();
  const now = Date.now();
  const k = tag(ip);
  const b = subBucket(kind);
  if (b) {
    (b.hours[k] = b.hours[k] || []).push(now);
    b.ips[k] = (b.ips[k] || 0) + 1;
    b.dayCount++;
    b.total++;
    save();
    return;
  }
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

/** 只加一条 usage(问一句走这里 —— 它返回的是单个 usage, 不是 aiLog 数组) */
export function quotaAddUsageOne(usage) {
  if (!usage) return;
  state.promptTokens += num(usage.prompt_tokens, 0);
  state.completionTokens += num(usage.completion_tokens, 0);
  save();
}

function subSnapshot(kind) {
  const lim = cfg[kind] || { perIpHour: 0, perIpDay: 0, maxDay: 0 };
  const b = (state.kinds && state.kinds[kind]) || null;
  const used = (b && b.day === today()) ? b.dayCount : 0;
  return {
    limits: { perIpHour: lim.perIpHour, perIpDay: lim.perIpDay, maxDay: lim.maxDay },
    usedToday: used,
    dayLeft: lim.maxDay ? Math.max(0, lim.maxDay - used) : null,
    total: b ? (b.total || 0) : 0
  };
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
    },
    /* 另外两类入口的用量, 页面和 /api/health 都能看到 */
    ask: subSnapshot('ask'),
    compare: subSnapshot('compare')
  };
}

/** 仅供测试: 清空计数 */
export function _resetQuota() { state = blank(); if (cfg.file) { try { fs.rmSync(cfg.file, { force: true }); } catch (e) {} } }
export function _quotaConfig() { return { ...cfg }; }
