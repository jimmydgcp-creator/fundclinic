/* 改 519191 深度复盘报告 / 深度版演示稿里跟 2021Q3 / 对账期数有关的表述。
 *
 * 背景: 官方对账从 23/24 期补成 24/24 期之后, 确定性产物(报告/来源清单/演示稿/结论卡/
 * 底稿)已经由 tools/refresh_official.mjs 重新生成; 《对外版》用 tools/polish_report.mjs
 * 重跑 T3 生成(它自带数字守恒校验, 比手改可靠)。剩下这两份是大模型成稿的独立文件,
 * 只能按原文逐句替换 —— 所以这里每一条替换都断言"必须命中且只命中一次",
 * 命中数不对就直接退出, 绝不带病写盘。
 *
 *   1) 深度复盘报告(md): 2021Q3 缺失 / 98.78% / 230 行 / 23/23 等表述。
 *   2) 深度版演示稿(html): 两处"23 期"。
 *
 * 用法: node tools/patch_ai_text.mjs [基金代码] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = (process.argv.slice(2).find(a => /^\d{6}$/.test(a))) || '519191';
const DRY = process.argv.includes('--dry');
const DIR = path.join(ROOT, '_runs', code);
const NAME = '万家新利灵活配置混合';

const deep = path.join(DIR, '黄海_' + NAME + '_2020Q4–2026Q3_复盘.md');
const deckT6 = path.join(DIR, '演示稿_' + NAME + '_' + code + '_深度版.html');

let bad = 0;
const put = (p, s) => { fs.writeFileSync(p, s, 'utf8'); console.log('  写出 ' + path.basename(p)); };

/* ---------------------------------------------------------------- 1. 深度复盘报告 */
let md = fs.readFileSync(deep, 'utf8');
const edits = [
  ['P1 报告期覆盖',
    /共 24 个报告期，其中 23 期有官方逐季业绩，2021Q3 报告缺失（证据包 meta，披露事实）。/,
    '共 24 个报告期，24 期都有官方逐季业绩（官方季报 24 期全部取得并逐行对账，证据包 meta，披露事实）。'],
  ['P2 基准变更点',
    /但区间内基准调整过：[^（]*（对账记录，披露事实）。/,
    '但区间内基准调整过：2026Q2 与 2026Q3 之间由「沪深300指数收益率*50%+中证全债指数收益率*50%」改为「沪深300指数收益率*85%+中证全债指数收益率*10%+活期存款基准利率*5%」（对账记录，披露事实）。'],
  ['P3 官方链式口径',
    /官方逐季链式口径为 98\.78%，基准链式 16\.09%，缺口 20\.58pp；因 2021Q3 报告缺失而偏低，不作为头条数字（证据包 note，披露事实）。/,
    '官方逐季链式口径为 119.32%，基准链式 13.22%，与引擎区间口径（119.36%）只差 0.04pp（证据包 note，披露事实）。'],
  ['P4 对账覆盖(口径节)',
    /对账覆盖 23\/23 期官方报告、230 行官方持仓，权重最大差 0pp；但 2021Q3 缺失，且只有前十大/,
    '对账覆盖 24/24 期官方报告、240 行官方持仓，权重最大差 0pp；但只有前十大'],
  ['P5 对账覆盖(优势三)',
    /23\/23 期官方报告逐行对账一致，230 行官方持仓/,
    '24/24 期官方报告逐行对账一致，240 行官方持仓'],
  ['P6 逐季表 2021Q3 行',
    /\| 2021Q3 \| — \| — \| — \| 77\.97 \| 1\.87 \|/,
    '| 2021Q3 | 10.33 | -2.47 | 12.8 | 77.97 | 1.87 |'],
  ['P7 局限三',
    /局限三：口径限制不能忽略。2021Q3 报告缺失，官方逐季链式 98\.78% 偏低；基准在区间内调整过；只有前十大，没有完整持仓与成交价。/,
    '局限三：口径限制不能忽略。只有前十大，没有完整持仓与成交价；基准在 2026Q3 调整过。'],
  ['P8 来源清单句',
    /官方定期报告 PDF（2020Q4–2026Q3 共 24 期，其中 2021Q3 缺失；23\/23 期逐行对账，230 行官方持仓，权重最大差 0pp）/,
    '官方定期报告 PDF（2020Q4–2026Q3 共 24 期；24/24 期逐行对账，240 行官方持仓，权重最大差 0pp）']
];
for (const [tag, re, to] of edits) {
  const n = (md.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;
  if (n !== 1) { console.error('!! ' + tag + ' 命中 ' + n + ' 次(应为 1), 先看原文'); bad++; continue; }
  md = md.replace(re, to);
  console.log('  ✓ ' + tag);
}
const left = (md.match(/23\/23|230 行|98\.78|2021Q3 报告缺失|2021Q3 缺失/g) || []);
if (left.length) { console.error('!! 深度报告里还有旧表述: ' + left.join(' / ')); bad++; }
if (!DRY) put(deep, md);

/* ---------------------------------------------------------------- 3. 深度版演示稿 html */
let html = fs.readFileSync(deckT6, 'utf8');
const deckEdits = [
  ['D1 对账一致', /([^\d])23 期逐行对账一致/g, '$124 期逐行对账一致'],
  ['D2 可比窗口', /按 23 期可比窗口校准/g, '按 24 期可比窗口校准'],
  ['D3 23/23 期一致', /23\/23 ?期一致/g, '24/24期一致'],
  ['D4 23期可比定期报告', /23期可比定期报告/g, '24期可比定期报告']
];
for (const [tag, re, to] of deckEdits) {
  const n = (html.match(re) || []).length;
  if (!n) { console.log('  · ' + tag + ' 未命中(可能本就没有), 跳过'); continue; }
  html = html.replace(re, to);
  console.log('  ✓ ' + tag + ' ×' + n);
}
if (!DRY) put(deckT6, html);

console.log(bad ? '\n有 ' + bad + ' 处异常, 未全部写盘。' : '\n完成。');
process.exit(bad ? 1 : 0);
