/* 生成《基金复诊台_流程图》—— SVG + Mermaid 两份。
 *
 * 为什么手搓 SVG 而不是用 mermaid 渲染: 本机没有 mermaid, 而它需要 CDN 才能渲染,
 * 离线打不开。手绘 SVG 无依赖、可缩放、能直接插进 Word 和 PPT, 也不怕对方环境。
 *
 * 泳道按「谁在做」分色, 这是本课程最关心的一点:
 *   人 / 脚本(服务端) / 大模型 / 产出
 *
 * 用法: node tools/make_flowchart.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.resolve(ROOT, '..', '00_交作业');

/* ---------------------------------------------------------------- 配色 */
const LANE = {
  human: { fill: '#FFF4E5', stroke: '#D97706', text: '#7C4A03', tag: '人' },
  script: { fill: '#EAF2FD', stroke: '#1D4ED8', text: '#123A85', tag: '脚本' },
  llm: { fill: '#F3EBFF', stroke: '#7C3AED', text: '#4C1D95', tag: '大模型' },
  out: { fill: '#E8F7EF', stroke: '#0E9F6E', text: '#065F46', tag: '产出' }
};

/* ---------------------------------------------------------------- 主流程 */
const NODES = [
  { id: 'start', lane: 'human', w: 520, title: '双击启动文件', sub: 'Windows .bat ／ macOS .command' },
  { id: 'serve', lane: 'script', w: 520, title: '本地服务启动', sub: '只监听 127.0.0.1，数据不出本机' },
  { id: 'input', lane: 'human', w: 520, title: '输入 6 位基金代码 + 自己的 API Key', sub: 'Key 只在内存过一次，不落盘、不进日志' },
  { id: 'probe', lane: 'script', w: 520, title: '探路 /api/probe（约 0.5 秒）', sub: '只抓元数据：基金概况 / 历任经理 / 报告期网格' },
  { id: 'gate', lane: 'human', w: 520, kind: 'decision', title: '口径确认表填齐了吗？', sub: 'SOP §0 八格：复盘哪一任经理、区间、数据截止、基准…' },
  { id: 'run', lane: 'script', w: 520, title: '按确认口径开跑 /api/run' },

  { id: 'src', lane: 'script', w: 780, kind: 'group', title: '六类公开来源采集（SOP §2）',
    items: ['① 官方定期报告 PDF（最高权威）', '② 天天基金 历史前十大', '③ 资产配置',
            '④ 规模变动', '⑤ 净值序列', '⑥ 基金经理履历'] },

  { id: 'clean', lane: 'script', w: 520, title: '落盘清洗（SOP 清洗三规则）', sub: '代码补零 / 权重换算 / 推算价' },
  { id: 'perf', lane: 'script', w: 520, title: '构造「分红再投」总回报指数', sub: '算区间复利 / 逐季收益 / 最大回撤' },
  { id: 'recon', lane: 'script', w: 520, title: '官方 PDF 逐行对账 + 官方窗口校准', sub: '排名 / 名称 / 权重 ±0.01；用官方季报净值增长率逐期校准' },
  { id: 'reconQ', lane: 'script', w: 520, kind: 'decision', title: '对账有差异吗？' },
  { id: 'engine', lane: 'script', w: 520, title: '规则引擎', sub: '指标 / 形态库 / 结论卡 / 报告 / 质检 18 条' },

  { id: 't1', lane: 'llm', w: 520, title: 'T1 主题归类', sub: '持仓股票清单 → 主题权重表' },
  { id: 't2', lane: 'llm', w: 520, title: 'T2 判断起草', sub: '绩效 / 轮动 / 言论 → 形态标签 + 可证伪判断 + 最大反证' },
  { id: 't5', lane: 'llm', w: 520, title: 'T5 深度复盘报告', sub: '10 节骨架 + 每个数字必须能回查到证据包' },
  { id: 'verifyQ', lane: 'script', w: 520, kind: 'decision', title: '数字回查全过吗？' },
  { id: 't6', lane: 'llm', w: 520, title: 'T6 深度演示稿', sub: '分镜 → 逐页成文 → 内联 36 套主题为单文件' },
  { id: 'pdf', lane: 'script', w: 520, title: '导出 PDF', sub: '无头浏览器，一页一张幻灯片' },

  { id: 'deliver', lane: 'out', w: 780, kind: 'group', title: '交付物',
    items: ['复盘报告 .md', '深度复盘报告 .md', '深度演示稿 .html', '模板版演示稿 .html',
            '演示稿 .pdf', '结论卡 .json', '错误检查记录 .md', '来源清单 .md', '数据底稿 .json'] },

  { id: 'final', lane: 'human', w: 520, title: '终审三查：数字 / 结论 / 合规', sub: '人签字后才对外交付' }
];

/* 右侧的旁路(拦截/退回) */
const SIDES = [
  { at: 'gate', title: '任何一格留空', sub: '不许开跑', color: LANE.human },
  { at: 'reconQ', title: '是', sub: '以官方为准\n并把差异记进\n《错误检查记录》', color: LANE.script },
  { at: 'verifyQ', title: '否', sub: '退回重写\n不改数字就不过', color: LANE.llm }
];

/* ---------------------------------------------------------------- 布局 */
const PAD_TOP = 118, GAP = 34, CENTER = 470, SIDE_X = 830, SIDE_W = 280;
/* 决策节点要留出"菱形 + 下方说明文字"两段的高度。
   第一版把说明文字放在菱形**右侧**, 结果长句子伸进右侧旁路框里造成重叠(渲染验证抓到的)。 */
const HEIGHT_OF = n => (n.kind === 'group' ? 132 : n.kind === 'decision' ? 100 : 62);

let y = PAD_TOP;
const laid = NODES.map(n => {
  const h = HEIGHT_OF(n);
  /* 决策节点不需要 520 那么宽, 收窄后右侧也腾出空间 */
  const w = n.kind === 'decision' ? Math.min(n.w, 400) : n.w;
  const node = { ...n, w, x: CENTER - w / 2, y, h };
  y += h + GAP;
  return node;
});
const byId = Object.fromEntries(laid.map(n => [n.id, n]));
const TOTAL_H = y + 40;

/* SVG 小工具 */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function box(n) {
  const c = LANE[n.lane];
  const cx = n.x + n.w / 2;
  let s = '';
  if (n.kind === 'decision') {
    /* 菱形占上方 74px, 说明文字居中放在它正下方 —— 不放右侧, 否则会伸进旁路框 */
    const dy = 74, cy = n.y + dy / 2, rx = n.w / 2, ry = dy / 2;
    s += `<polygon points="${cx},${n.y} ${cx + rx},${cy} ${cx},${n.y + dy} ${cx - rx},${cy}" `
      + `fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`;
    s += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${c.text}">${esc(n.title)}</text>`;
    if (n.sub) {
      s += `<text x="${cx}" y="${n.y + dy + 18}" text-anchor="middle" font-size="11.5" fill="#666">${esc(n.sub)}</text>`;
    }
  } else if (n.kind === 'group') {
    s += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`;
    s += `<text x="${cx}" y="${n.y + 26}" text-anchor="middle" font-size="15" font-weight="700" fill="${c.text}">${esc(n.title)}</text>`;
    const cols = n.items.length > 6 ? 3 : 2;
    const perCol = Math.ceil(n.items.length / cols);
    const colW = (n.w - 40) / cols;
    n.items.forEach((it, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      s += `<text x="${n.x + 24 + col * colW}" y="${n.y + 52 + row * 20}" font-size="12.5" fill="#333">${esc(it)}</text>`;
    });
  } else {
    s += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`;
    const hasSub = !!n.sub;
    s += `<text x="${cx}" y="${n.y + (hasSub ? 26 : 36)}" text-anchor="middle" font-size="15" font-weight="700" fill="${c.text}">${esc(n.title)}</text>`;
    if (hasSub) String(n.sub).split('\n').forEach((ln, i) => {
      s += `<text x="${cx}" y="${n.y + 45 + i * 15}" text-anchor="middle" font-size="12" fill="#555">${esc(ln)}</text>`;
    });
    s += `<text x="${n.x + 10}" y="${n.y + 16}" font-size="10" font-weight="700" fill="${c.stroke}">${c.tag}</text>`;
  }
  return s;
}

function arrow(x1, y1, x2, y2, color = '#94A3B8') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" marker-end="url(#ah)"/>`;
}

let g = '';
/* 先画所有节点框 —— 忘了这一步的后果是整个图只剩箭头和边框:
   XML 照样合法、渲染也不报错, 但一个方框都没有(第一版就是这么错的, 靠量渲染结果才发现)。 */
laid.forEach(n => { g += box(n); });

/* 主干箭头 */
for (let i = 0; i < laid.length - 1; i++) {
  const a = laid[i], b = laid[i + 1];
  const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
  g += arrow(ax, a.y + a.h, bx, b.y);
}

/* 旁路 */
for (const sd of SIDES) {
  const n = byId[sd.at];
  const cy = n.y + n.h / 2;
  const sx = n.x + n.w, sy = cy;
  g += `<path d="M ${sx} ${sy} H ${SIDE_X - 14}" stroke="${sd.color.stroke}" stroke-width="2" fill="none" marker-end="url(#ah)"/>`;
  g += `<text x="${sx + 8}" y="${sy - 8}" font-size="12" font-weight="700" fill="${sd.color.stroke}">${esc(sd.title)}</text>`;
  const lines = String(sd.sub).split('\n');
  g += `<rect x="${SIDE_X}" y="${cy - 26}" width="${SIDE_W}" height="${26 + lines.length * 16}" rx="8" fill="${sd.color.fill}" stroke="${sd.color.stroke}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  lines.forEach((ln, i) => {
    g += `<text x="${SIDE_X + 12}" y="${cy - 8 + i * 16}" font-size="12" fill="${sd.color.text}">${esc(ln)}</text>`;
  });
}

/* 图例 */
const legend = ['human', 'script', 'llm', 'out'].map((k, i) => {
  const c = LANE[k], x = 40 + i * 150;
  const label = { human: '人（做判断/门禁）', script: '脚本（服务端确定性计算）', llm: '大模型（语言工作）', out: '产出' }[k];
  return `<rect x="${x}" y="${TOTAL_H - 30}" width="14" height="14" rx="3" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`
    + `<text x="${x + 20}" y="${TOTAL_H - 18}" font-size="12" fill="#444">${esc(label)}</text>`;
}).join('');

const W = 1160;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL_H}" viewBox="0 0 ${W} ${TOTAL_H}" font-family="Microsoft YaHei, PingFang SC, sans-serif">
<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8"/>
  </marker>
</defs>
<rect width="${W}" height="${TOTAL_H}" fill="#FFFFFF"/>
<text x="${W / 2}" y="46" text-anchor="middle" font-size="26" font-weight="800" fill="#1F3864">基金复诊台 · 网页流程图</text>
<text x="${W / 2}" y="74" text-anchor="middle" font-size="13" fill="#666">输入一个基金代码 → 六类公开来源采集 → 官方季报逐行对账 → 规则引擎 + 大模型 → 可核验的报告与演示稿</text>
<text x="${W / 2}" y="96" text-anchor="middle" font-size="12" fill="#999">左侧色标 = 每一步由谁完成；右侧虚线框 = 异常分支与拦截点</text>
${g}
${legend}
</svg>`;

fs.mkdirSync(OUTDIR, { recursive: true });
const svgPath = path.join(OUTDIR, '基金复诊台_网页流程图.svg');
fs.writeFileSync(svgPath, svg, 'utf8');

/* ------------------------------------------------- Mermaid 源码(方便改) */
const MERMAID = `flowchart TD
  A["人：双击启动文件<br/>Windows .bat / macOS .command"] --> B["脚本：本地服务启动<br/>只监听 127.0.0.1"]
  B --> C["人：输入 6 位基金代码 + 自己的 API Key"]
  C --> D["脚本：探路 /api/probe（约 0.5 秒）<br/>只抓元数据"]
  D --> E{"人：口径确认表填齐了吗？<br/>SOP §0 八格"}
  E -- "任何一格留空" --> E2["不许开跑"]
  E -- "填齐" --> F["脚本：按确认口径开跑 /api/run"]
  F --> G["脚本：六类公开来源采集（SOP §2）<br/>①官方定期报告PDF ②历史前十大 ③资产配置<br/>④规模变动 ⑤净值序列 ⑥经理履历"]
  G --> H["脚本：落盘清洗（SOP 清洗三规则）"]
  H --> I["脚本：构造分红再投总回报指数<br/>区间复利 / 逐季收益 / 最大回撤"]
  I --> J["脚本：官方 PDF 逐行对账 + 官方窗口校准"]
  J --> K{"对账有差异吗？"}
  K -- "有" --> K2["以官方为准<br/>差异记进错误检查记录"]
  K -- "无" --> L["脚本：规则引擎<br/>指标 / 形态库 / 结论卡 / 报告 / 质检 18 条"]
  K2 --> L
  L --> M["大模型：T1 主题归类"]
  M --> N["大模型：T2 判断起草"]
  N --> O["大模型：T5 深度复盘报告<br/>10 节骨架，数字必须能回查"]
  O --> P{"数字回查全过吗？"}
  P -- "否" --> P2["拦截，退回规则引擎版本"]
  P -- "是" --> Q["大模型：T6 深度演示稿<br/>分镜 → 逐页成文 → 内联单文件"]
  Q --> R["脚本：导出 PDF（无头浏览器）"]
  R --> S["产出：报告 / 深度报告 / 两份演示稿 / PDF<br/>结论卡 / 错误检查记录 / 来源清单 / 数据底稿"]
  S --> T["人：终审三查（数字 / 结论 / 合规）"]

  classDef human fill:#FFF4E5,stroke:#D97706,stroke-width:2px,color:#7C4A03
  classDef script fill:#EAF2FD,stroke:#1D4ED8,stroke-width:2px,color:#123A85
  classDef llm fill:#F3EBFF,stroke:#7C3AED,stroke-width:2px,color:#4C1D95
  classDef out fill:#E8F7EF,stroke:#0E9F6E,stroke-width:2px,color:#065F46
  class A,C,E,T human
  class B,D,F,G,H,I,J,K,L,K2,R script
  class M,N,O,P,Q llm
  class S out
`;
const mdPath = path.join(OUTDIR, '基金复诊台_网页流程图.md');
fs.writeFileSync(mdPath, '# 基金复诊台 · 网页流程图（Mermaid 源码）\n\n> 把下面这段贴进支持 Mermaid 的编辑器（Typora / VS Code / Obsidian / 语雀）即可渲染。\n> 想改流程就改这里，不用动 SVG。\n\n```mermaid\n' + MERMAID + '```\n', 'utf8');

console.log('写出 ' + svgPath + '  (' + (svg.length / 1024).toFixed(1) + ' KB, ' + W + 'x' + Math.round(TOTAL_H) + ')');
console.log('写出 ' + mdPath + '  (' + (MERMAID.length / 1024).toFixed(1) + ' KB)');
console.log('  节点 ' + NODES.length + ' 个 · 旁路分支 ' + SIDES.length + ' 条');
