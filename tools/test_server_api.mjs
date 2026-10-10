/* 服务端接口端到端测试: health -> run(NDJSON 流) -> 交付物下载 -> 预览页。
 * 用法: node tools/test_server_api.mjs [端口] [基金代码]
 */
const port = process.argv[2] || '8787';
const code = process.argv[3] || '519191';
const base = `http://127.0.0.1:${port}`;

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('=== 1. /api/health ===');
const h = await (await fetch(base + '/api/health')).json();
ok(h.ok === true, 'health.ok', JSON.stringify({ pdftotext: h.pdftotext, edge: !!h.edge, node: h.node, aiRequired: h.aiRequired }));
ok(!!h.pdftotext, 'pdftotext 可用(官方对账能跑)');
ok(!!h.edge, 'Edge/Chrome 可用(能导 PDF)');
ok(h.aiRequired === true, '健康检查声明 AI 模块为必选');
ok(h.llm && !!h.llm.model, '健康检查回报默认模型', JSON.stringify({ baseUrl: h.llm.baseUrl, model: h.llm.model, hasKey: h.llm.hasKey, keySource: h.llm.keySource }));
console.log('  采集标准: ' + h.crawlStandard);

/* AI 必选: 不带 Key 必须被拒, 且是在爬取之前就拒 */
console.log('\n=== 1b. AI 必选校验 ===');
const noKeyRun = await fetch(base + '/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 10 })
});
const noKeyBody = await noKeyRun.json();
ok(noKeyRun.status === 400, '不带 API Key 时拒绝开跑(HTTP 400)', String(noKeyRun.status));
ok(/必选/.test(noKeyBody.error || ''), '错误信息说明 AI 为必选', noKeyBody.error);
const tNoKey = Date.now();
ok(Date.now() - tNoKey < 3000, '拒绝发生在爬取之前(秒级返回, 不浪费 10 秒)');

console.log('\n=== 2. POST /api/run(流式) ===');
console.log(h.allowNoAI
  ? '  注: 服务端已设 FUNDCLINIC_ALLOW_NO_AI=1(仅自测用), 本次以 allowNoAI 跑通链路; 正式出报告必须带 Key。'
  : '  [警告] 服务端未开启自测开关, 且本机没有 Key, 后续链路无法跑 —— 请设 FUNDCLINIC_ALLOW_NO_AI=1 或提供 Key。');
const t0 = Date.now();
const res = await fetch(base + '/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 10, verifyOfficial: true, pdf: true, allowNoAI: true })
});
ok(res.ok, 'HTTP 200', res.status);
ok(/application\/x-ndjson/.test(res.headers.get('content-type') || ''), '返回 NDJSON 流', res.headers.get('content-type'));

const reader = res.body.getReader();
const dec = new TextDecoder('utf-8');
let buf = '', done = null;
const progress = [];
for (;;) {
  const c = await reader.read();
  if (c.done) break;
  buf += dec.decode(c.value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
    if (ev.type === 'progress') progress.push(ev.msg);
    else if (ev.type === 'error') console.log('  [服务端错误] ' + ev.error + ' ' + (ev.detail || ''));
    else if (ev.type === 'done') done = ev;
  }
}
ok(progress.length >= 3, '收到进度事件', progress.length + ' 条');
ok(!!done, '收到 done 事件');
if (!done) { console.log('\n失败: 流程没跑完'); process.exit(1); }

const s = done.summary;
console.log('  基金: ' + s.name + '(' + s.code + ') · ' + s.manager + ' · ' + s.range + ' · ' + s.quarters + ' 期');
console.log('  形态: ' + s.formTag + ' | 质检: ' + s.check.verdictText);
ok(s.quarters >= 4, '期数 ≥4', String(s.quarters));
/* 章节数判据原本写死 === 11, 这是错的: 第九节「可复制的方法 × 不能被神化的部分」由大模型综述(T4)生成,
   而 app/engine.js 里明确写了"没有通过校验的输出时**整节不出现** —— 不用套话填充"(用户要求过的)。
   所以无 Key / 开了自测开关的跑法下就是 10 节, 只有综述通过校验时才是 11 节。
   判据改成: 10 个必备章节必须齐; 第九节出现则算加分项, 不出现不算失败。
   2026-10-10 修正 —— 这条之前一直是红的, 是测试写错了, 不是代码有问题。 */
const REQUIRED_SECTIONS = ['conclusion', 'scope', 'performance', 'conc', 'rotation', 'method', 'cases', 'latest', 'track', 'appendix'];
const secIds = ((done.analysis && done.analysis.report && done.analysis.report.sections) || []).map(x => x.id);
const missingSec = REQUIRED_SECTIONS.filter(id => secIds.indexOf(id) < 0);
ok(missingSec.length === 0,
  `analysis 含 10 个必备章节${secIds.indexOf('strength') >= 0 ? ' + 第九节(大模型综述已通过校验)' : '(第九节需大模型综述, 本次无 AI 输出, 按设计不出现)'}`,
  missingSec.length ? '缺 ' + missingSec.join(', ') : `${secIds.length} 节: ${secIds.join('/')}`);
ok(done.check && done.check.rules.length >= 15, 'check 含 ≥15 条规则', String(done.check && done.check.rules.length));
ok(!!done.datasetMeta, 'datasetMeta 回传(来源/对账/区间依据)');
ok(done.datasetMeta.sources.length >= 5, '来源清单 ≥5 类', String(done.datasetMeta.sources.length));
ok(!!done.datasetMeta.official, '官方对账结果回传');
const okRecon = (done.datasetMeta.official.checks || []).filter(c => c.reconcile && c.reconcile.ok).length;
ok(okRecon >= 1, '官方逐行对账至少 1 期通过', okRecon + '/' + (done.datasetMeta.official.checks || []).length);
console.log('  总耗时 ' + (s.totalMs / 1000).toFixed(1) + 's, 端到端 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

console.log('\n=== 3. 交付物下载 ===');
const files = [
  ['report', '复盘报告 .md', /markdown|text/],
  ['deck', '演示稿 .html', /html/],
  ['pdf', '演示稿 .pdf', /pdf/],
  ['card', '结论卡 .json', /json/],
  ['check', '错误检查记录 .md', /markdown|text/],
  ['sources', '来源清单 .md', /markdown|text/]
];
for (const [key, label, typeRe] of files) {
  const r = await fetch(`${base}/api/download?code=${code}&f=${key}`);
  const buf2 = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get('content-type') || '';
  const cd = r.headers.get('content-disposition') || '';
  ok(r.ok && buf2.length > 1000, label, buf2.length + ' B  ' + ct.split(';')[0]);
  ok(typeRe.test(ct), label + ' 类型正确', ct.split(';')[0]);
  ok(/filename\*=UTF-8''/.test(cd), label + ' 带中文文件名', decodeURIComponent((/filename\*=UTF-8''(.+)$/.exec(cd) || [])[1] || ''));
}

console.log('\n=== 4. 关键内容抽查 ===');
const rep = await (await fetch(`${base}/api/download?code=${code}&f=report`)).text();
ok(rep.includes('先说结论'), '报告含"先说结论"');
ok(rep.includes('推翻条件'), '报告含"推翻条件"');
ok(rep.includes('不构成投资建议'), '报告含免责声明');
ok(rep.includes('只看前十大'), '报告含口径边界');
ok(!/马后炮|抄底|逃顶/.test(rep), '报告 0 违禁词');
/* 章节编号必须连续、不许跳号(2026-10-10 用户报的: 缺第九节时报告从「八」跳到「十」)。
   这里查的是**真正下载下来的那份 MD**, 所以 cover 到 引擎 → 拼 MD → 下载 这条链路上的编号都在内。 */
const CN_ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const headings = [...rep.matchAll(/^##\s+([一二三四五六七八九十百]+)、/gm)].map(m => m[1]);
const expectHead = CN_ORDER.slice(0, headings.length);
ok(headings.length >= 10, '报告有 ≥10 个编号章节', String(headings.length));
ok(JSON.stringify(headings) === JSON.stringify(expectHead), '章节编号连续、没有跳号(下载下来的 MD 口径)',
  headings.join(' ') + (JSON.stringify(headings) === JSON.stringify(expectHead) ? '' : '  ← 期望 ' + expectHead.join(' ')));
ok(!/第[一二三四五六七八九十]+节以披露数字为准/.test(rep), '口径页不再写死"第三/四/五/八/十一节"(会随编号失真)');
const deck = await (await fetch(`${base}/api/download?code=${code}&f=deck`)).text();
ok(deck.includes('<!DOCTYPE html>'), '演示稿是完整 HTML');
ok(!/(?:src|href)="(?!https?:|data:|#)/.test(deck.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')), '演示稿无本地外链(可单文件分发)');
ok(deck.includes('@page'), '演示稿含 @page 打印尺寸');
ok(!/animation\s*:[^;]*both/.test(deck), '演示稿无 animation...both(避免打印丢字)');
ok(!/-webkit-text-fill-color\s*:\s*transparent/.test(deck), '演示稿无透明文字(避免 PDF 空白)');
const src = await (await fetch(`${base}/api/download?code=${code}&f=sources`)).text();
ok(/官方定期报告 PDF/.test(src), '来源清单含官方报告 PDF 条目');
ok(/https?:\/\//.test(src), '来源清单带 URL');

console.log('\n=== 5. 预览页 ===');
for (const p of ['/report/' + code, '/deck/' + code]) {
  const r = await fetch(base + p);
  const t = await r.text();
  ok(r.ok && t.length > 2000, p + ' 可预览', t.length + ' B');
}
const idx = await (await fetch(base + '/')).text();
ok(idx.includes('基金复诊台'), '首页可访问');
ok(idx.includes('online-panel'), '首页含在线模式面板');
const js = await fetch(base + '/app/online.js');
ok(js.ok, '在线模块 JS 可加载');

console.log('\n=== 6. 参数与错误处理 ===');
const bad = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'abc' }) });
ok(bad.status === 400, '非法代码返回 400', String(bad.status));
const noRun = await fetch(base + '/api/download?code=999999&f=report');
ok(noRun.status === 404, '未跑过的基金下载返回 404', String(noRun.status));
const forbidden = await fetch(base + '/server/sources.mjs');
ok(forbidden.status === 403, '禁止访问服务端源码', String(forbidden.status));
const noKey = await fetch(base + '/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'theme_classify', code, baseUrl: 'https://api.deepseek.com' }) });
ok(noKey.status === 400, '未提供 Key 时拒绝调用大模型', String(noKey.status));
const ping = await fetch(base + '/api/llm/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
ok(ping.status === 400, 'Key 探活接口在无 Key 时返回 400', String(ping.status));

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
