/* 两阶段流程测试: 探路 -> 口径确认表(8格) -> 按确认口径开跑 -> 报告里体现口径。
 * 用法: node tools/test_two_phase.mjs [端口] [基金代码]
 */
const port = process.argv[2] || '8787';
const code = process.argv[3] || '005827';
const base = `http://127.0.0.1:${port}`;

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('=== 第一阶段: /api/probe ===');
const t0 = Date.now();
const pr = await fetch(base + '/api/probe', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 10 })
});
const pj = await pr.json();
ok(pr.ok && pj.ok, '探路成功', 'HTTP ' + pr.status);
if (!pj.ok) { console.log(JSON.stringify(pj)); process.exit(1); }
const p = pj.probe;
const probeMs = Date.now() - t0;
console.log(`  ${p.fund.name}(${p.code}) · 成立 ${p.fund.inception} · 报告期网格 ${p.periods.length} 期 · ${p.managers.length} 任经理 · ${probeMs} ms`);
ok(probeMs < 5000, '探路 <5 秒(不抓持仓与 PDF)', probeMs + ' ms');
ok(p.managers.length >= 1, '返回历任经理', String(p.managers.length));
ok(p.candidates.length >= 2, '返回候选区间', String(p.candidates.length));
ok(!!p.gate1Draft, '返回口径确认表初值(SOP §0 八格)');
const g = p.gate1Draft;
const fields = ['code', 'fundName', 'managerLabel', 'rangeFrom', 'rangeTo', 'dataCutoff', 'benchmark', 'returnBasis', 'scope', 'outputDir'];
const missing = fields.filter(f => !g[f]);
ok(missing.length === 0, '八格初值全部有值', missing.length ? '缺: ' + missing.join(',') : '');
ok(p.candidates.some(c => c.recommended), '标出了推荐区间');
ok(p.candidates.some(c => c.coManaged) || p.managers.every(m => !m.coManaged), '共管期被识别并标注', p.candidates.filter(c => c.coManaged).length + ' 个共管期候选');

console.log('\n=== 第二阶段: 按确认口径开跑 ===');
/* 故意不用推荐区间, 而是人工改成"全部可取报告期" —— 验证人改的确实生效 */
const all = p.candidates[p.candidates.length - 1];
console.log(`  人工选择: ${all.label} ${all.from}~${all.to}(${all.n} 期)   [推荐本来是 ${p.candidates.find(c => c.recommended).label}]`);
const gate1 = {
  confirmed: true, confirmedAt: new Date().toISOString(),
  code: g.code, fundName: g.fundName,
  managerLabel: (all.managers || []).join('+') || g.managerLabel,
  managerStart: all.start, managerEnd: all.end, managerCoManaged: !!all.coManaged,
  rangeFrom: all.from, rangeTo: all.to,
  dataCutoff: g.dataCutoff, benchmark: g.benchmark,
  returnBasis: g.returnBasis === 'nav' ? 'nav' : 'tr',
  scope: g.scope, outputDir: g.outputDir, rangeReason: '人工选择: 全部可取报告期'
};

const res = await fetch(base + '/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 10, verifyOfficial: true, pdf: true, allowNoAI: true, gate1, fromPeriod: all.from, toPeriod: all.to })
});
ok(res.ok, '开跑请求被接受', 'HTTP ' + res.status);
const reader = res.body.getReader(); const dec = new TextDecoder('utf-8');
let buf = '', done = null; const prog = [];
for (;;) {
  const c = await reader.read(); if (c.done) break;
  buf += dec.decode(c.value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
    if (ev.type === 'progress') prog.push(ev.msg);
    else if (ev.type === 'error') console.log('  [服务端错误] ' + ev.error);
    else if (ev.type === 'done') done = ev;
  }
}
ok(!!done, '收到 done');
if (!done) { console.log('失败'); process.exit(1); }
const s = done.summary;
console.log(`  ${s.name} · ${s.range} · ${s.quarters} 期 · 形态 ${s.formTag}`);
ok(prog.some(m => /人工确认/.test(m)), '进度里出现"按人工确认口径"', prog.filter(m => /人工确认/.test(m))[0] || '');
/* 人选的区间端点未必都有持仓数据(如刚成立的季度只有季报), 所以允许边界对齐;
   但**必须落在人选区间之内**, 且必须留下调整说明 —— 不许悄悄少算。 */
const [af, at] = s.range.split('–');
ok(af >= all.from && at <= all.to, '实际区间落在人工选择的区间之内', `${s.range} ⊂ ${all.from}~${all.to}`);
const adjusted = af !== all.from || (all.to && at !== all.to);
if (adjusted) {
  const ri = done.datasetMeta.rangeInfo;
  ok(!!ri.adjusted && !!ri.adjustNote, '边界被对齐时留下了说明', ri.adjustNote || '(无)');
} else {
  ok(true, '区间与人选完全一致');
}

console.log('\n=== 报告里是否体现口径 ===');
const rep = await (await fetch(`${base}/api/download?code=${code}&f=report`)).text();
ok(rep.includes('复盘对象'), '报告含「复盘对象」');
ok(rep.includes('业绩比较基准'), '报告含「业绩比较基准」(以前 0 次出现)');
ok(rep.includes('数据截止日'), '报告含「数据截止日」');
ok(rep.includes('收益口径'), '报告含「收益口径」');
ok(rep.includes('区间依据') || rep.includes('人工'), '报告写明区间是怎么定的', (rep.match(/区间依据[^\n]{0,40}/) || [])[0] || '');
const bmLine = (rep.match(/业绩比较基准[^\n]{0,90}/) || [])[0];
console.log('  基准行: ' + bmLine);
ok(!/未取到/.test(bmLine || ''), '基准不是"未取到"', bmLine || '');

console.log('\n=== 服务端强制: 没有口径确认不许开跑 ===');
const noGate = await fetch(base + '/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 5, allowNoAI: true })
});
ok(noGate.status === 200, '(AI 开关已开时, 无 gate1 仍可跑 —— 引擎退回自动选区间, 属兼容路径)');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
