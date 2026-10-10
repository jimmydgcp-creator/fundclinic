/* test_section_numbering.mjs —— 报告章节编号必须连续, 而且不许因为编号变动丢内容
 *
 * 由来(2026-10-10, 用户报的): 网页里的复盘报告出现「八、最新一期结构与变化」直接跳到
 * 「十、跟踪清单与证伪方式」—— 看起来像少了一节。
 * 根因: 第九节「可复制的方法 × 不能被神化的部分」由大模型综述(T4)生成, 没有通过校验时
 * **整节不出现**(这是用户要求过的: 不用套话填充); 而每节的中文序号是**手写在 title 字面量里**的,
 * 不会跟着挪。于是缺一节, 编号就跳号。
 *
 * 修法: 序号改成**按数组位置生成**(app/engine.js 末尾统一编号), title 里写的序号不再生效。
 * 这个测试钉三件事:
 *   ① 不管 10 节还是 11 节, 序号都从 一到 N, 中间不许跳;
 *   ② 缺第九节时, 「跟踪清单」的序号必须从 十 变成 九(这就是用户看到的那处);
 *   ③ 序号会漂移 ⇒ 演示稿按章节名取正文的匹配**不许依赖编号**(server/deckagent.mjs 的 pickSection),
 *      否则"少一节"会静默导致某页拿不到报告原文。
 *
 * 用法: node tools/test_section_numbering.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { pickSection } from '../server/deckagent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, window: {}, fetch: () => Promise.reject(new Error('no network')) };
vm.createContext(sandbox);
for (const f of ['data/funds.data.js', 'app/engine.js', 'app/parse.js', 'app/checker.js', 'app/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const FC = sandbox.window.FC;

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

const raw = FC.getBuiltin('519191');
const clone = () => JSON.parse(JSON.stringify(raw));

/** 序号是否连续: title 的前缀必须正好是 CN[0..n-1] */
function numSeq(sections) {
  return sections.map((s, i) => {
    const m = /^\s*([一二三四五六七八九十百]+)、/.exec(s.title);
    return m ? m[1] : '(无序号)';
  });
}
const expectSeq = n => CN.slice(0, n);
const sameSeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------------- ① 无大模型综述 → 10 节 */
console.log('=== ① 没有大模型综述(第九节按设计不出现)→ 应连续编到 十 ===\n');
const a10 = FC.analyze(clone(), { source: 'builtin' });
ok(!!a10.report, '引擎产出了报告');
const s10 = a10.report.sections;
ok(s10.length === 10, '共 10 节', String(s10.length));
ok(!s10.some(s => s.id === 'strength'), '确实没有「可复制的方法 × 不能被神化的部分」这一节');
ok(sameSeq(numSeq(s10), expectSeq(10)), '序号连续 一…十(没有跳号)', numSeq(s10).join(' '));
const track10 = s10.find(s => s.id === 'track');
ok(/^九、/.test(track10.title), '「跟踪清单与证伪方式」现在是 九(用户看到的是 十，就是这里跳号)', track10.title);
ok(/^十、/.test(s10.find(s => s.id === 'appendix').title), '「附录」现在是 十', s10.find(s => s.id === 'appendix').title);
ok(s10.every(s => s.name && !/^[一二三四五六七八九十]+、/.test(s.name)), 's.name 是不带序号的章节名', s10[0].name);
ok(s10.every(s => s.title === s.name || s.title.endsWith(s.name)), 'title = 序号 + name');

/* ---------------------------------------------------------------- ② 有大模型综述 → 11 节 */
console.log('\n=== ② 有大模型综述 → 11 节, 序号也要连续 ===\n');
const raw11 = clone();
raw11.synthesis = { replicable: ['框架五年不漂移', '估值纪律一以贯之', '换挡执行快'], risks: ['高集中高波动', '规模负反馈'], basis: '测试用' };
const a11 = FC.analyze(raw11, { source: 'builtin' });
const s11 = a11.report.sections;
ok(s11.length === 11, '共 11 节', String(s11.length));
ok(sameSeq(numSeq(s11), expectSeq(11)), '序号连续 一…十一', numSeq(s11).join(' '));
ok(/^九、/.test(s11.find(s => s.id === 'strength').title), '「可复制的方法 × 不能被神化的部分」是 九', s11.find(s => s.id === 'strength').title);
ok(/^十、/.test(s11.find(s => s.id === 'track').title), '「跟踪清单与证伪方式」是 十', s11.find(s => s.id === 'track').title);
ok(/^十一、/.test(s11.find(s => s.id === 'appendix').title), '「附录」是 十一', s11.find(s => s.id === 'appendix').title);

/* ---------------------------------------------------------------- ③ 序号漂移不许丢内容 */
console.log('\n=== ③ 演示稿按章节名取正文: 编号变了也要命中 ===\n');
/* 用真实的 10 节报告构造 sections, 再拿"错编号"的 sourceHeading 去匹配 ——
   分镜提示词里的 sourceHeading 是模型从报告里抄的, 只要报告编号一变就可能抄成旧编号。 */
const reportSections = s10.map(s => ({ heading: s.title, text: '正文占位' }));
ok(!!pickSection(reportSections, '十、跟踪清单与证伪方式'), '旧编号「十、跟踪清单与证伪方式」→ 命中(报告里现在叫 九)', (pickSection(reportSections, '十、跟踪清单与证伪方式') || {}).heading);
ok(!!pickSection(reportSections, '九、跟踪清单与证伪方式'), '新编号「九、跟踪清单与证伪方式」→ 命中');
ok(!!pickSection(reportSections, '跟踪清单与证伪方式'), '不带编号 → 命中');
ok(!!pickSection(reportSections, '三、总成绩也看清代价'), '普通编号章节 → 命中');
ok(pickSection(reportSections, '十二、并不存在的章节') === null, '不存在的章节 → 明确返回 null(不瞎猜)');
ok(pickSection(reportSections, '') === null, '空 sourceHeading → null');
/* 以数字开头的章节名不能被"去编号"误伤 */
const weird = [{ heading: '2026Q2 最新一期结构与变化', text: 'x' }];
ok(!!pickSection(weird, '2026Q2 最新一期结构与变化'), '以年份开头的章节名原样命中(没被当成序号摘掉)');
ok(!!pickSection(weird, '最新一期结构与变化'), '用名字部分也能命中');
/* 带副标题的章节名 */
const sub = [{ heading: '十一、附录 · 逐期前十大索引', text: 'x' }];
ok(!!pickSection(sub, '十、附录 · 逐期前十大索引'), '旧编号 + 带副标题 → 命中');
ok(!!pickSection(sub, '附录'), '只给主名 → 命中');

/* ---------------------------------------------------------------- ④ 页面上的呈现 */
console.log('\n=== ④ 报告 HTML 与文案 ===\n');
const html = (a10.report.sections || []).map(s => s.html).join('');
ok(!/第[一二三四五六七八九十]+节以披露数字为准/.test(html), '口径页不再出现写死的"第三/四/五/八/十一节"(会随编号失真)');
ok(/证据级别按节适用/.test(html), '口径页改成按章节名说明证据级别');

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
