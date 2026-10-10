/* 断言进度消息 → 阶段条的映射是对的。
 *
 * 输入是 tools/capture_progress.mjs 真实录下来的 33 条消息(原样贴在这里, 免得每次跑测试都去爬一遍)。
 * 要验的不是"代码能跑", 而是三件事:
 *   ① 7 个阶段**每一个都会被点亮** —— 有阶段永远不亮 = 用户以为卡住了;
 *   ② 阶段**只前进不后退** —— 否则进度条会来回跳;
 *   ③ 关键长尾(官方对账、导出 PDF)不能被归错阶段。
 *
 * 用法: node tools/test_stepbar.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 不能 require('app/steps.js') —— package.json 里 "type": "module" 会让 Node 把 .js 当 ESM,
   require 回来是空对象。照 server/engine.mjs 的做法: 用 vm 造个 window 把它装进来。 */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'steps.js'), 'utf8'), sandbox, { filename: 'app/steps.js' });
const steps = sandbox.FC.steps;
if (!steps || typeof steps.sequence !== 'function') {
  console.error('app/steps.js 没能在沙箱里挂上 FC.steps —— 检查它的挂载方式');
  process.exit(1);
}

/* 真实录制的进度序列(2026-10-10, 021967, mock 大模型) */
const REAL = [
  '数据采集 · 按六类公开来源抓取(含全量官方报告原文)',
  '① 抓取基金概况…',
  '⑤ 抓取累计净值序列…',
  '⑥ 抓取基金经理履历…',
  '② 抓取前十大持仓(最近 10 年)…',
  '抓取 2026 年前十大持仓…',
  '抓取 2025 年前十大持仓…',
  '抓取 2024 年前十大持仓…',
  '③ 抓取资产配置(股票/债券/现金占净比)…',
  '④ 抓取规模变动…',
  '落盘清洗(SOP 清洗三规则)…',
  '① 抓官方定期报告 PDF 并与第三方逐行对账…',
  '  官方对账完成: 5/6 期逐行一致, 共解析 60 行官方持仓。',
  '整理底稿与来源清单…',
  '官方窗口校准 · 5 期可比, 最大偏差 0pp ✓ 一致',
  '采集完成 · 6 期 · 净值 400 点 · 来源 12 类 · 6.3s',
  '规则引擎 · 指标 / 形态 / 结论卡 / 报告 / 质检',
  'AI 模块 · T1 主题归类 / T2 判断起草 / T3 用词清洗(用户自带 API Key)',
  'T1 主题归类 · 输出未通过校验, 已拦截; 主题保持为空, 形态判定会自动跳过主题类规则',
  'T2 判断起草 · 输出未通过校验, 已拦截, 沿用规则引擎的结论卡',
  'T3 用词清洗 · 输出未通过校验, 已拦截, 对外版报告不生成(原稿不受影响)',
  '生成交付物 · 报告 / 结论卡 / 演示稿 / 深度复盘报告',
  '深度复盘报告 · 整理证据包(官方逐季绩效/基准·规模申赎/轮动/经理原话×下期动作/成败案例)',
  '深度复盘报告 · 未通过校验, 已拦截 —— 详见"错误检查记录"里的 T5 明细',
  'T6 演示稿 · 按 html-ppt 技能编排: 分镜 → 逐页成文 → 内联单文件',
  'T6 演示稿 · ① 分镜(读完整报告, 决定讲几页、每页主张)',
  'T6 演示稿 · 分镜完成: 2 页, 主题 corporate-clean',
  'T6 演示稿 · ② 第 1/2 页: 封面',
  'T6 演示稿 · ② 第 2/2 页: 结论',
  'T6 演示稿 · ③ 内联打包(主题/base.css/runtime 全部内联为单文件)',
  'T6 演示稿 · 完成 2 页 · 92 KB · 校验 通过',
  'T6 演示稿 · 2 页 · 主题 corporate-clean · 92 KB · 校验通过(警告 3)',
  '导出 PDF · 演示稿_西部利得均衡优选混合A_021967_深度版.pdf'
];

let fail = 0;
const ok = (c, label, extra) => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!c) fail++;
};

console.log(`真实录制消息 ${REAL.length} 条\n`);
const seq = steps.sequence(REAL);

console.log('=== 推进序列 ===');
let prev = -1;
for (const s of seq) {
  console.log(`  ${String(s.index).padStart(2)}  ${s.step.padEnd(9)}  ← ${s.msg.slice(0, 46)}`);
}

console.log('\n=== 断言 ===');
/* ① 只前进不后退 */
const monotonic = seq.every((s, i) => i === 0 || s.index > seq[i - 1].index);
ok(monotonic, '阶段只前进不后退');

/* ② 除 probe 外(它由前端手动点亮)全部会被触发 */
const hit = new Set(seq.map(s => s.step));
const missed = steps.SEQ.filter(n => n !== 'probe' && !hit.has(n));
ok(missed.length === 0, '流水线会点亮全部阶段', missed.length ? '未触发: ' + missed.join(', ') : `${hit.size}/${steps.SEQ.length}`);

/* ③ 关键归类 */
const at = (m) => steps.indexOf(m);
ok(at('导出 PDF · xxx.pdf') === steps.SEQ.indexOf('done'), '导出 PDF → done');
ok(at('官方窗口校准 · 5 期可比') === steps.SEQ.indexOf('official'), '官方窗口校准 → official');
ok(at('  官方对账完成: 5/6 期逐行一致') === steps.SEQ.indexOf('official'), '官方对账完成 → official');
ok(at('落盘清洗(SOP 清洗三规则)…') === steps.SEQ.indexOf('parse'), '落盘清洗 → parse');
ok(at('T6 演示稿 · 完成 2 页') === steps.SEQ.indexOf('ai'), 'T6 演示稿 → ai（不能被 done 抢走）');
ok(at('生成交付物 · 报告 / 结论卡') === steps.SEQ.indexOf('ai'), '生成交付物 → ai');
ok(at('整理底稿与来源清单…') === -1, '不认识的消息返回 -1（调用方保持原状）');
ok(at('') === -1 && at(null) === -1, '空消息安全返回 -1');

console.log(fail === 0 ? '\n全部通过。' : `\n${fail} 项失败。`);
process.exit(fail === 0 ? 0 : 1);
