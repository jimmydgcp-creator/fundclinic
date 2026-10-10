/* 校验"回官方原文抽检清单"是否"可执行"(第 8 项要求): 每条都要有具体步骤、原文链接与合格判据。
 * 2026-10-10 改名: 页面上那个"核完"勾选框已删(打勾不产生证据), 清单本身留着 —— 它是给别人照着核的说明书。
 * 用注入的 official 数据模拟"爬取路径"(它才有季报 PDF 链接)。 */
import fs from 'node:fs';
import vm from 'node:vm';

const sb = { console, window: {} };
vm.createContext(sb);
['data/funds.data.js', 'app/engine.js', 'app/parse.js', 'app/checker.js', 'app/ai.js']
  .forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: f }));
const FC = sb.window.FC;

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

const d = JSON.parse(JSON.stringify(FC.getBuiltin('519191')));
// 模拟爬取得到的官方对账结果(带每期季报 PDF 直链)
d.official = {
  available: true, pdftotext: true,
  checks: d.quarters.map(q => ({
    period: q.period, url: 'https://pdf.dfcfw.com/pdf/H2_DEMO' + q.period.replace('Q', '') + '_1.pdf',
    parsedRows: 10, reason: '抽样',
    reconcile: { ok: true, officialCount: 10, providerCount: 10, matched: 10, diffs: [], missingInProvider: [], missingInOfficial: [], maxWeightDiff: 0, note: '逐行一致' }
  })),
  notes: ['演示用'], talks: []
};
const a = FC.analyze(d, { source: 'crawled' });
const ck = FC.runCheck(d, a);

console.log('=== 抽检清单(可执行性) ===');
console.log('条数: ' + ck.manualSample.length);
const s = ck.manualSample[0];
console.log('\n第 1 条:');
console.log('  报告期 : ' + s.period);
console.log('  标的   : ' + s.item);
console.log('  引擎值 : ' + s.value);
console.log('  怎么核 : ' + s.howTo);
console.log('  原文   : ' + s.url);
console.log('');

ok(ck.manualSample.length === 12, '抽 12 条', String(ck.manualSample.length));
ok(ck.manualSample.every(x => x.howTo && x.howTo.length > 30), '每条都有可执行的核对步骤(>30 字)',
  ck.manualSample.filter(x => x.howTo && x.howTo.length > 30).length + '/' + ck.manualSample.length);
ok(ck.manualSample.every(x => !!x.url), '每条都直接给出官方季报 PDF 链接',
  ck.manualSample.filter(x => x.url).length + '/' + ck.manualSample.length);
ok(ck.manualSample.every(x => /§5\.3|逐个相加|前十名股票投资明细|公告区|巨潮/.test(x.howTo)), '每条都写清去哪一节 / 怎么取数');
ok(ck.manualSample.every(x => /容差|是否为/.test(x.howTo)), '每条都给了合格判据(容差或等式)');

const md = FC.checkToMarkdown(ck, a);
ok(md.includes('核对步骤'), '《错误检查记录》含「核对步骤」列');
ok(md.includes('怎么判定通过'), '含「怎么判定通过」总则');
ok((md.match(/\[季报 PDF\]\(https?:/g) || []).length >= 10, 'MD 里给出可点的季报 PDF 链接',
  (md.match(/\[季报 PDF\]\(https?:/g) || []).length + ' 条');
// 可复现
const ck2 = FC.runCheck(JSON.parse(JSON.stringify(d)), FC.analyze(JSON.parse(JSON.stringify(d)), { source: 'crawled' }));
ok(JSON.stringify(ck2.manualSample) === JSON.stringify(ck.manualSample), '同输入 → 同抽检清单(可复现)');

console.log('\n=== 页面第五部分 ===');
const html = fs.readFileSync('index.html', 'utf8');
ok(/data-view="about"/.test(html), '导航里加了「⑤ 这个网页做什么」');
ok(/id="view-about"/.test(html), '对应视图存在');
for (const kw of ['给谁用', '替代什么', 'AI 在哪里', '三道人机门禁', '它明确做不到什么']) ok(html.includes(kw), '含「' + kw + '」');
const ui = fs.readFileSync('app/ui.js', 'utf8');
ok(/var VIEWS = \[[^\]]*'about'[^\]]*\]/.test(ui), 'VIEWS 列表已含 about(否则点标签不切换)');

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : '全部通过。');
if (fail) process.exitCode = 1;
