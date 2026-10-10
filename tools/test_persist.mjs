/* 持久化 / 历史 / 下载 三项回归:
 *   ① 跑完必须落盘, 服务重启后还在(用户报的"返回后数据消失")
 *   ② /api/history 能列出来, /api/result 能完整恢复
 *   ③ 下载响应头必须带 ASCII 回落名(只给 filename* 时部分浏览器会忽略整个头, 直接渲染 HTML)
 * 用法: node tools/test_persist.mjs [端口] [基金代码]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const port = process.argv[2] || '8787';
const code = process.argv[3] || '005827';
const base = `http://127.0.0.1:${port}`;

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('=== ① 跑一次, 确认落盘 ===');
const before = fs.existsSync(path.join(ROOT, '_runs', code, 'run.json'));
console.log('  跑之前 run.json 是否存在: ' + before);
const res = await fetch(base + '/api/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, years: 10, pdf: true, allowNoAI: true })
});
const reader = res.body.getReader(); const dec = new TextDecoder('utf-8');
let buf = '', done = null;
for (;;) {
  const c = await reader.read(); if (c.done) break;
  buf += dec.decode(c.value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
    if (ev.type === 'done') done = ev;
    if (ev.type === 'error') console.log('  [错误] ' + ev.error);
  }
}
ok(!!done, '跑完收到 done');
ok(done && done.persisted === true, 'done 事件回报 persisted=true', String(done && done.persisted));

const dir = path.join(ROOT, '_runs', code);
for (const f of ['analysis.json', 'check.json', 'datasetMeta.json', 'run.json']) {
  const p = path.join(dir, f);
  ok(fs.existsSync(p), '落盘 ' + f, fs.existsSync(p) ? (fs.statSync(p).size / 1024).toFixed(0) + ' KB' : '缺失');
}

console.log('\n=== ② 历史与恢复 ===');
const h = await (await fetch(base + '/api/history')).json();
ok(h.ok && Array.isArray(h.runs), '/api/history 返回列表');
const me = h.runs.find(x => x.code === code);
ok(!!me, '历史里有 ' + code, me ? `${me.name} · ${me.range} · ${me.quarters}期 · ${me.formTag}` : '没找到');
ok(h.runs.length && h.runs[0].at, '历史按时间倒序且带时间戳', h.runs[0] && h.runs[0].at);

const rr = await fetch(base + '/api/result?code=' + code);
const rj = await rr.json();
ok(rr.ok && rj.ok, '/api/result 可取回', 'HTTP ' + rr.status);
/* 章节数不写死 === 11: 「可复制的方法 × 不能被神化的部分」一节由大模型综述生成, 没有通过校验时
   整节不出现(用户要求: 不用套话填充), 所以无 Key 的跑法就是 10 节, 有综述才 11 节。
   判据改成"10 个必备 id 必须齐全"(2026-10-10 修 —— 这条之前一直假失败)。 */
const MUST_SEC = ['conclusion', 'scope', 'performance', 'conc', 'rotation', 'method', 'cases', 'latest', 'track', 'appendix'];
const secIds = id => ((id && id.report && id.report.sections) || []).map(s => s.id);
const missingSec = a => MUST_SEC.filter(x => secIds(a).indexOf(x) < 0);
ok(rj.analysis && rj.analysis.report && missingSec(rj.analysis).length === 0, '取回的 analysis 必备章节齐全',
  rj.analysis && rj.analysis.report ? secIds(rj.analysis).length + ' 节: ' + secIds(rj.analysis).join('/') : '缺 ' + (rj.analysis ? missingSec(rj.analysis).join(',') : 'analysis'));
ok(rj.check && rj.check.rules && rj.check.rules.length >= 15, '取回的 check 含 ≥15 条规则', String(rj.check && rj.check.rules.length));
ok(rj.datasetMeta && rj.datasetMeta.sources, '取回的 datasetMeta 含来源清单');
ok(rj.summary && rj.summary.range === (done.summary.range), '取回的 summary 与本次运行一致', rj.summary && rj.summary.range);

console.log('\n=== ③ 下载响应头 ===');
for (const [key, label] of [['deck', '演示稿 .html'], ['report', '报告 .md'], ['pdf', '演示稿 .pdf'], ['card', '结论卡 .json']]) {
  const r = await fetch(`${base}/api/download?code=${code}&f=${key}`);
  const cd = r.headers.get('Content-Disposition') || '';
  const body = Buffer.from(await r.arrayBuffer());
  const hasAscii = /filename="[^"]+"/.test(cd);
  const hasUtf8 = /filename\*=UTF-8''/.test(cd);
  const isAttach = /^attachment/.test(cd);
  ok(r.ok && body.length > 500, label + ' 可取到', body.length + ' B');
  ok(isAttach && hasAscii && hasUtf8, label + ' 响应头含 attachment + ASCII 回落名 + UTF-8 名',
    (cd.match(/filename="[^"]*"/) || [])[0] || '(无 ASCII 名)');
  ok(r.headers.get('x-content-type-options') === 'nosniff', label + ' 带 nosniff');
}

console.log('\n=== ④ 模拟"重启服务后仍可恢复" ===');
/* 直接读文件, 验证不依赖进程内存在 */
const disk = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
ok(disk.summary && disk.summary.code === code, 'run.json 里存的 summary 完整', disk.summary && disk.summary.range);
const diskAnalysis = JSON.parse(fs.readFileSync(path.join(dir, 'analysis.json'), 'utf8'));
ok(missingSec(diskAnalysis).length === 0, 'analysis.json 可直接重建页面(必备章节齐全)',
  secIds(diskAnalysis).length + ' 节' + (secIds(diskAnalysis).indexOf('strength') >= 0 ? '(含大模型综述节)' : '(无综述节, 按设计)'));
const filesOnDisk = Object.values(disk.files || {}).map(f => (f && f.path) || f);
ok(filesOnDisk.every(p => fs.existsSync(p)), 'run.json 里记录的交付物全部真实存在', filesOnDisk.length + ' 个');
ok(!!disk.pdf && fs.existsSync(disk.pdf), 'PDF 也在盘上');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过 —— 结果已落盘, 历史可恢复, 下载是"下载"不是"跳转"。');
if (fail) process.exitCode = 1;
