/* test_deployed.mjs —— 对着**已经部署好的公网地址**做验收
 *
 * 为什么单独一个脚本: 本机全绿 ≠ 公网能用。这两者之间隔着一堆只在线上的变量:
 *   · 平台注入了 PORT 吗(没注入 → 一直 502)
 *   · 容器镜像里有没有 poppler(没有 → 官方对账静默降级成"未完成")
 *   · **服务端到底配没配上 API Key**(没配上 → 访客会看到"请填 API Key", 而你以为是配好的)
 *   · 用量闸门开没开、额度是多少
 *   · 海外机房去抓天天基金/巨潮 通不通(这是唯一**必须上线才能知道**的事)
 *
 * 用法:
 *   node tools/test_deployed.mjs https://xxx.onrender.com
 *   node tools/test_deployed.mjs https://xxx.onrender.com --run 519191     # 真跑一只(花 token, 默认不跑)
 *   node tools/test_deployed.mjs http://127.0.0.1:8787                     # 本机也能用, 方便先自测脚本
 */
const args = process.argv.slice(2);
const BASE = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const runIdx = args.indexOf('--run');
const RUN_CODE = runIdx >= 0 ? (args[runIdx + 1] || '') : '';

if (!BASE) { console.error('用法: node tools/test_deployed.mjs <https://公网地址> [--run 519191]'); process.exit(2); }

let fail = 0, warn = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };
const soft = (c, l, x) => { console.log((c ? '  PASS  ' : '  WARN  ') + l + (x ? '  ' + x : '')); if (!c) warn++; };
const sec = t => console.log('\n=== ' + t + ' ===');

async function j(url, opt) {
  const r = await fetch(url, opt);
  const t = await r.text();
  let body = null;
  try { body = JSON.parse(t); } catch (e) {}
  return { r, t, body };
}

(async () => {
  console.log('验收目标: ' + BASE);
  const t0 = Date.now();

  /* ---------------- 1. 首页能打开吗 ---------------- */
  sec('1. 首页可达');
  let home = null;
  try { home = await j(BASE + '/'); } catch (e) { ok(false, '打不开首页', e.message); }
  if (home) {
    ok(home.r.ok, '首页 HTTP 200', 'HTTP ' + home.r.status + ' · ' + Math.round((Date.now() - t0) / 1000) + 's');
    ok(/基金复诊台|FundClinic/.test(home.t), '首页确实是本项目的页面(不是平台的欢迎页/404)');
    ok(/app\/online\.js/.test(home.t), '首页引用了在线模式脚本');
  }

  /* ---------------- 2. 健康检查: 这一节最容易暴露线上配置错误 ---------------- */
  sec('2. /api/health —— 线上环境的真实状态');
  const h = await j(BASE + '/api/health').catch(() => null);
  if (!h || !h.body) {
    ok(false, '/api/health 不通', h ? 'HTTP ' + h.r.status : '连接失败');
  } else {
    const b = h.body;
    ok(b.ok === true, 'health.ok');
    soft(!!b.cloud, '云端模式已识别(没识别的话说明平台变量没注入)', b.cloud ? '' : '监听地址可能仍是 127.0.0.1 → 平台探活会 502');
    ok(b.pdftotext === true, 'poppler/pdftotext 可用(官方 PDF 逐行对账才能生效)',
      b.pdftotext ? String(b.pdftotextPath || '').split(/[\\/]/).pop() : '未装 —— 最核心的质检动作会降级成"未完成"');
    soft(!!b.edge, '演示稿 PDF 导出可用(没有也能用: 演示稿本身是单文件 HTML, 打开按 P 就能打印)', b.edge ? '' : '未装 Chromium/Edge —— 页面上会如实显示"未找到"');
    const keyOk = !!(b.llm && b.llm.hasKey);
    ok(keyOk, '**服务端已配置 API Key**(访客只要输代码)', keyOk ? '来源: ' + (b.llm.keySource || '?') + ' · 模型 ' + b.llm.model : '没配上 —— 访客会看到"请先填写 API Key", 这不是你要的形态');
    if (b.quota) {
      const q = b.quota;
      soft(q.enabled === true, '用量闸门已启用(公网 + 站方出 Key 时必须开)',
        q.enabled ? `每台 ${q.limits.perIpHour}/小时 · ${q.limits.perIpDay}/天 · 全站 ${q.limits.maxRunsDay}/天 · 今天已用 ${q.dayRuns} · 累计 ${q.totalRuns} 次 / ${q.tokens.total} token` : '闸门是关的 —— 任何人都能无限花你的 Key');
    } else {
      ok(false, 'health 里没有 quota 字段', '说明跑的还是旧代码(没带上用量闸门)');
    }
    soft(b.staleCode !== true, '线上跑的就是最新代码', b.staleCode === true ? 'staleCode=true: 服务启动后代码又被改过, 平台需要重新部署' : '');
  }

  /* ---------------- 3. 探路: 只抓元数据, 不烧 token, 但能证明"能连上数据源" ---------------- */
  sec('3. /api/probe —— 线上能不能抓到数据(海外机房最常见的坑)');
  let probeOk = false;
  try {
    const p = await j(BASE + '/api/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: RUN_CODE || '519191' })
    });
    if (p.r.ok && p.body && p.body.ok !== false) {
      probeOk = true;
      /* 探路的响应形状是 {ok:true, probe:{fund:{...}, years, probeMs}} ——
         别去猜字段, 直接取 fund, 拿不到就把整个响应的键打出来, 方便一眼看出接口变了。 */
      const pr = p.body.probe || p.body;
      const f = pr.fund || {};
      ok(true, '探路成功', [f.name, f.manager, f.type, pr.probeMs ? pr.probeMs + 'ms' : ''].filter(Boolean).join(' · ')
        || ('响应键: ' + Object.keys(pr).join(', ')));
    } else {
      ok(false, '探路失败', 'HTTP ' + p.r.status + ' ' + String((p.body && p.body.error) || p.t).slice(0, 160));
    }
  } catch (e) { ok(false, '探路请求异常', e.message); }
  if (!probeOk) {
    console.log('       ↑ 这一步挂了, 十有八九是**机房 IP 被数据源限流**(天天基金/巨潮对海外 IDC 段不友好)。');
    console.log('         应对: 换香港/国内节点重部署, 或改用"离线样例 + 自带 Key"两条路给同学用。');
  }

  /* ---------------- 4. 额度闸门真的在用吗(不烧 token: 只看 429 是否会出现) ---------------- */
  sec('4. 闸门是否真的接在 /api/run 上');
  try {
    /* 注意用**格式非法**的代码(位数不对)。用 '000000' 是错的 —— 它是合法的 6 位数字,
       会一路跑到爬取再失败, 白白耗掉一次额度(第一版就写错了, 一跑就现原形)。
       这里要验的只是"闸门没把正常请求误拦", 所以故意拿一个在格式检查就被挡下的请求。 */
    const r = await fetch(BASE + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '12' }) });
    const txt = await r.text();
    ok(r.status === 400, '格式非法的代码被挡在 400(不是 429 —— 说明闸门没误拦正常请求)', 'HTTP ' + r.status + ' ' + txt.slice(0, 90).replace(/\s+/g, ' '));
    soft(r.status !== 429, '当前额度过得去(不是一上来就 429)', r.status === 429 ? '额度已经用完了' : '');
  } catch (e) { ok(false, '闸门探测请求异常', e.message); }

  /* ---------------- 5. 真跑一只(可选, 花 token) ---------------- */
  if (RUN_CODE) {
    sec('5. 真跑一只: ' + RUN_CODE + '(花 token, 用了 --run 才跑)');
    const t1 = Date.now();
    try {
      const r = await fetch(BASE + '/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: RUN_CODE })
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        ok(false, '开跑被拒', 'HTTP ' + r.status + ' · ' + (b.error || ''));
      } else {
        const reader = r.body.getReader(); const dec = new TextDecoder('utf-8');
        let buf = '', done = null, steps = [], last = Date.now();
        while (true) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop();
          for (const ln of lines) {
            if (!ln.trim()) continue;
            let ev = null; try { ev = JSON.parse(ln); } catch (e) { continue; }
            if (ev.type === 'progress') { steps.push(ev.msg); last = Date.now(); }
            if (ev.type === 'done') done = ev;
            if (ev.type === 'error') ok(false, '流水线报错', ev.error);
          }
        }
        const secs = Math.round((Date.now() - t1) / 1000);
        ok(!!done, '跑完并收到 done', secs + ' 秒 · ' + steps.length + ' 条进度');
        if (done) {
          const s = done.summary || {};
          ok(!!(s.name), '拿到基金名', [s.name, s.manager, s.range, s.quarters + ' 期'].filter(Boolean).join(' · '));
          soft(!!(done.analysis && done.analysis.report), '报告已生成', (done.analysis && done.analysis.report ? done.analysis.report.sections.length + ' 节' : ''));
          /* 下载链路: 报告 MD + 演示稿 HTML 必须能下载到(这才是"发给别人"的东西) */
          const list = await j(BASE + '/api/download?code=' + RUN_CODE + '&f=report').catch(() => null);
          ok(!!(list && list.r.ok && /先说结论/.test(list.t)), '能下载复盘报告 MD', list ? list.r.status + ' · ' + list.t.length + ' B' : '');
          /* 演示稿有两个键: deckT6 = 深度版(AI 按内容编排, 这才是要发给别人的那份),
             deck = 旧模板版兜底。两个都试, 哪个通用哪个 —— 只认一个的话,
             以后键名一改这条就会假失败。 */
          let deck = null, deckKey = '';
          for (const k of ['deckT6', 'deck']) {
            const r = await j(BASE + '/api/download?code=' + RUN_CODE + '&f=' + k).catch(() => null);
            if (r && r.r.ok) { deck = r; deckKey = k; break; }
          }
          soft(!!deck, '能下载演示稿 HTML(单文件, 打开就能讲)', deck ? deckKey + ' · ' + Math.round(deck.t.length / 1024) + ' KB' : '两个键都没下到');
          /* PDF 是服务端调无头浏览器导的 —— 容器里没装 Chromium 就没有。这不是故障:
             演示稿本身是单文件 HTML, 打开按 P 就能打印成 PDF。只提示, 不算失败。 */
          const pdf = await j(BASE + '/api/download?code=' + RUN_CODE + '&f=pdf').catch(() => null);
          soft(!!(pdf && pdf.r.ok), '演示稿 PDF 可下载(没有也不影响交付: HTML 单文件自己按 P 就能导)',
            pdf && pdf.r.ok ? Math.round(pdf.t.length / 1024) + ' KB' : '服务端未装 Chromium, 已如实跳过');
        }
      }
    } catch (e) { ok(false, '真跑异常', e.message); }
  } else {
    sec('5. 真跑一只');
    console.log('  SKIP  没给 --run <代码>; 要跑就加参数(会消耗 token 与一次额度)');
  }

  sec('结论');
  console.log('  ' + (fail ? '✗ 有 ' + fail + ' 项不通过' : '✓ 关键项全部通过') + (warn ? ' · ' + warn + ' 项提醒' : ''));
  const 用时 = Math.round((Date.now() - t0) / 1000);
  console.log('  总耗时 ' + 用时 + ' 秒');
  if (fail) {
    console.log('\n  常见对应关系:');
    console.log('   首页 502 / 不通          → 平台没注入 PORT, 或服务没监听 0.0.0.0(看部署日志的启动横幅)');
    console.log('   首页是别的页面           → 平台的 Root Directory 没指到项目根, 或没走 Docker');
    console.log('   Key 没配上               → 平台环境变量里加 FUNDCLINIC_LLM_KEY, 然后重新部署');
    console.log('   pdftotext 未找到         → 没用 Docker 构建(render.yaml 里 runtime: docker)');
    console.log('   探路失败                 → 机房 IP 被数据源限流 → 换香港/国内节点');
  }
  process.exit(fail ? 1 : 0);
})();
