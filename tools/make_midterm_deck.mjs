/* 生成《小组作业 II · 中期进度汇报》展示页
 *
 * 平台要求: 「汇报用的展示页做成 HTML 网页，连同素材打成 zip，课上统一用教师机播放。」
 * 所以这份必须是:
 *   ① 单文件 —— CSS / 主题 / 运行时 / 截图 全部内联, 拷到教师机上双击就能开, 断网也能开
 *   ② 固定 1280x720 画布 + 自动缩放 —— 换台电脑版面不变形
 *   ③ 可打印 —— @page 1280x720, 一页正好一张, 顺带当 PDF 备份
 *   ④ 不依赖网络字体 —— 教师机不可能装 Inter/Playfair
 *
 * 设计语言直接复用 skills/html-ppt 的 base.css + corporate-clean 主题 + deck-kit.css,
 * 和项目自己产出的演示稿是同一套, 不另发明。
 *
 * 用法: node tools/make_midterm_deck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.resolve(ROOT, '..', '00_交作业', '中期汇报_展示页');

const read = p => fs.readFileSync(p, 'utf8');
const baseCss = read(path.join(ROOT, 'skills/html-ppt/assets/base.css'))
  /* 打印安全: 渐变字在 PDF 里渲染成空白, 必须去掉 */
  .replace(/-webkit-text-fill-color:\s*transparent;?/g, '')
  .replace(/background-clip:\s*text;?/g, '');
const themeCss = read(path.join(ROOT, 'skills/html-ppt/assets/themes/corporate-clean.css'));
const kitCss = read(path.join(ROOT, 'skills/deck-kit.css'));

const shot = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'tools/_smoke', f)).toString('base64');
const SHOT_INPUT = shot('view_input.png');
const SHOT_REPORT = shot('view_report.png');

/* ------------------------------------------------------------------ 版面 CSS */
const slideCss = `
:root{
  --font-sans:'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans SC',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-display:var(--font-sans);
  --font-mono:'Consolas','SFMono-Regular',Menlo,'Courier New',monospace;
}
html,body{width:100%;height:100%;overflow:hidden;background:#0a2540}
.stage{position:fixed;left:50%;top:50%;width:1280px;height:720px;
  transform:translate(-50%,-50%) scale(var(--s,1));transform-origin:center center}
.deck{width:1280px;height:720px;overflow:hidden;background:var(--bg);
  box-shadow:0 30px 80px rgba(0,0,0,.45)}
.slide{
  position:absolute;inset:0;width:1280px;height:720px;
  padding:54px 68px;display:flex;flex-direction:column;justify-content:center;
  background:var(--bg);opacity:0;pointer-events:none;
  transition:opacity .28s var(--ease),transform .28s var(--ease);transform:translateX(24px);
}
.slide.is-active{opacity:1;pointer-events:auto;transform:none;z-index:2}
.slide.is-prev{transform:translateX(-24px)}
.slide.tight{padding:42px 60px}

/* 页码 / 页眉 */
.pg{position:absolute;right:34px;bottom:22px;font-size:12px;color:var(--text-3);
  font-variant-numeric:tabular-nums;letter-spacing:.06em}
.tagbar{position:absolute;left:68px;bottom:22px;font-size:12px;color:var(--text-3);letter-spacing:.1em}
.slide.tight .tagbar{left:60px}

/* 标题组 */
.hd{margin-bottom:22px;flex:none}
.hd .kicker{font-size:12.5px;letter-spacing:.14em;color:var(--accent-2);font-weight:700}
.hd h2{font-size:39px;line-height:1.24;font-weight:800;letter-spacing:-.02em;margin:6px 0 0;color:var(--accent)}
.hd .sub{font-size:15px;color:var(--text-2);margin-top:7px;line-height:1.62}
.body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.body.row{flex-direction:row;align-items:center;gap:22px}

/* 卡片 */
.c{border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:16px 18px}
.c.soft{background:var(--surface-2)}
.c.acc{border-left:4px solid var(--accent-2);border-radius:4px}
.c.acc-g{border-left:4px solid var(--good)}
.c.acc-w{border-left:4px solid var(--warn)}
.c.acc-b{border-left:4px solid var(--bad)}
.c h4{font-size:15.5px;font-weight:700;margin:0 0 6px;color:var(--accent)}
.c p{margin:0;font-size:13.5px;line-height:1.6;color:var(--text-2)}

/* 大数字 */
.kpi{display:flex;gap:14px}
.kpi .k{flex:1;border:1px solid var(--border);border-radius:8px;padding:14px 16px;background:var(--surface-2)}
.kpi .k .n{font-size:34px;font-weight:800;line-height:1.24;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;color:var(--accent)}
.kpi .k .n.g{color:var(--good)} .kpi .k .n.b{color:var(--bad)} .kpi .k .n.w{color:var(--warn)}
.kpi .k .l{font-size:13px;font-weight:700;margin-top:5px}
.kpi .k .s{font-size:11.5px;color:var(--text-3);margin-top:2px;line-height:1.45}

/* 表格 */
table.t{width:100%;border-collapse:collapse;font-size:13px;
  font-variant-numeric:tabular-nums}
table.t th,table.t td{padding:6.5px 9px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle}
table.t thead th{font-size:11px;letter-spacing:.06em;color:var(--text-3);font-weight:700;
  border-bottom:1.5px solid var(--border-strong);white-space:nowrap}
table.t tbody tr:last-child td{border-bottom:none}
table.t td.n,table.t th.n{text-align:right;white-space:nowrap}
table.t tr.hl-bad td{background:color-mix(in srgb,var(--bad) 7%,transparent)}
table.t tr.hl-good td{background:color-mix(in srgb,var(--good) 6%,transparent)}
.ok{color:var(--good);font-weight:700}
.no{color:var(--bad);font-weight:700}
.dim{color:var(--text-3)}

/* 徽章 */
.b{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.6;white-space:nowrap}
.b-ok{background:color-mix(in srgb,var(--good) 13%,transparent);color:var(--good)}
.b-bad{background:color-mix(in srgb,var(--bad) 11%,transparent);color:var(--bad)}
.b-warn{background:color-mix(in srgb,var(--warn) 15%,transparent);color:#a35c00}
.b-blue{background:color-mix(in srgb,var(--accent-2) 11%,transparent);color:var(--accent-2)}
.b-gray{background:var(--surface-2);color:var(--text-2);border:1px solid var(--border)}

/* 引用块 */
.q{border-left:4px solid var(--bad);background:color-mix(in srgb,var(--bad) 5%,transparent);
  border-radius:4px;padding:11px 15px;font-size:13px;line-height:1.6;color:var(--text-1)}
.q .who{font-size:11px;color:var(--text-3);letter-spacing:.06em;margin-bottom:4px;font-weight:700}

/* 截图 */
.shot{border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;box-shadow:var(--shadow-lg);background:#fff}
.shot img{display:block;width:100%}

/* 步骤 */
.steps{display:flex;flex-direction:column;gap:9px}
.step{display:flex;gap:11px;align-items:flex-start}
.step .num{flex:none;width:23px;height:23px;border-radius:50%;background:var(--accent-2);color:#fff;
  font-size:12.5px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}
.step .tx{font-size:13.5px;line-height:1.55;color:var(--text-2)}
.step .tx b{color:var(--text-1)}

/* 时间轴 */
.road{display:flex;gap:0;align-items:stretch}
.road .st{flex:1;position:relative;padding:0 9px}
.road .st .dot{width:11px;height:11px;border-radius:50%;background:var(--accent-2);margin:0 auto 9px}
.road .st .ln{position:absolute;top:5px;left:0;right:0;height:2px;background:var(--border)}
.road .st .ln span{display:block;height:2px;background:var(--accent-2)}
.road .st .box{border:1px solid var(--border);border-radius:6px;padding:10px 11px;background:var(--surface-2)}
.road .st .d{font-size:11.5px;font-weight:800;color:var(--accent-2);letter-spacing:.03em}
.road .st .t{font-size:13px;font-weight:700;margin:4px 0 4px;line-height:1.35}
.road .st .x{font-size:11.5px;color:var(--text-2);line-height:1.5}

/* 封面 */
.cover{justify-content:center;gap:0}
.cover .eyebrow{font-size:13.5px;letter-spacing:.2em;color:var(--accent-2);font-weight:700;text-transform:none}
.cover h1{font-size:74px;line-height:1.3;font-weight:800;letter-spacing:-.035em;margin:14px 0 8px;color:var(--accent)}
.cover .en{font-size:20px;letter-spacing:.24em;color:var(--text-3);font-weight:600;margin-bottom:22px}
.cover .lede{font-size:20px;line-height:1.6;color:var(--text-2);max-width:900px}
.cover .meta{margin-top:30px;display:flex;gap:12px;align-items:center;font-size:13.5px;color:var(--text-3)}
.rule2{width:76px;height:4px;background:var(--accent-2);border-radius:2px;margin:26px 0 0}

/* 尾页 */
.end{justify-content:center;text-align:center;align-items:center}
.end h1{font-size:58px;line-height:1.2;font-weight:800;color:var(--accent);letter-spacing:-.03em;margin:0 0 14px}
.end p{font-size:19px;color:var(--text-2);line-height:1.7;margin:0}

/* 进度条 */
.pbar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(10,37,64,.07);z-index:30}
.pbar > i{display:block;height:100%;width:0;background:var(--accent-2);transition:width .28s var(--ease)}

/* 帮助 */
.help{position:fixed;left:18px;bottom:14px;font-size:12px;color:rgba(255,255,255,.5);
  font-family:var(--font-mono);z-index:60;user-select:none}
@media print{ .help{display:none} }

/* ============ 打印 / 导出 PDF ============ */
@page{size:1280px 720px;margin:0}
@media print{
  html,body{overflow:visible;height:auto;background:#fff}
  .stage{position:static;transform:none;width:auto;height:auto}
  .deck{width:auto;height:auto;overflow:visible;box-shadow:none}
  .slide{position:relative;inset:auto;opacity:1!important;transform:none!important;
    pointer-events:auto;break-inside:avoid;page-break-inside:avoid;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .slide + .slide{break-before:page;page-break-before:always}
  .pbar{display:none}
}
`;

/* ------------------------------------------------------------------ 小工具 */
const P = (cls, inner) => `<section class="slide${cls ? ' ' + cls : ''}">${inner}</section>`;
const pg = (i, total, tag) => `<div class="tagbar">${tag || '基金复诊台 FundClinic · 中期进度汇报'}</div><div class="pg">${String(i).padStart(2, '0')} / ${total}</div>`;

/* 页码从 1 起, 但封面不印页码 —— 所以计数器初值给 1, 让第二张才是 "02"。
   (踩过: 初值给 0 时, 第 3 张幻灯片印的是 "02 / 14"。) */
let N = 1;
const slides = [];
const S = (cls, tag, body) => { N += 1; slides.push(P(cls, body + pg(N, 999, tag))); };

/* ---------------------------------------------------------------- 01 封面 */
// 封面不加页码
slides.push(`<section class="slide cover">
  <div class="eyebrow">金融AI智能体设计与应用 · 小组作业 II · 中期进度汇报</div>
  <h1>基金复诊台</h1>
  <div class="en">FUND CLINIC</div>
  <div class="rule2"></div>
  <p class="lede">输入一个 6 位基金代码，<br>出一份<strong>每个数字都能追到公开季报原文</strong>的持仓回溯复盘。</p>
  <div class="meta">
    <span class="b b-blue">第 2 组</span>
    <span>2026-10-14 · 第 5 次课</span>
    <span class="dim">·</span>
    <span>全员上台 · 5 分钟</span>
  </div>
</section>`);

/* ------------------------------------------------------- 02 一句话 (没变) */
S('', '定位 · 和场景确认一致', `
  <div class="hd">
    <div class="kicker">先说结论</div>
    <h2>项目定位没有变，变的是"从打算做"变成"已经能跑"</h2>
  </div>
  <div class="body">
    <div class="concl" style="margin-bottom:16px">
      给〔<b>基民 · 基金公司初步评价考核 · FOF 初步评价</b>〕用，把〔<b>一只公募基金的代码 + 复盘区间</b>〕变成〔<b>一份可核验的"十大持仓回溯复盘报告"网页 + 一份能直接发给别人的演示稿</b>〕。
    </div>
    <div class="kpi" style="margin-bottom:14px">
      <div class="k"><div class="l" style="margin:0 0 6px;color:var(--accent-2);font-size:12.5px">项目名（交上去就是组名）</div>
        <div class="s" style="font-size:13.5px;line-height:1.6;color:var(--text-1)"><b>基金复诊台 FundClinic</b></div></div>
      <div class="k"><div class="l" style="margin:0 0 6px;color:var(--accent-2);font-size:12.5px">项目类型（平台单选）</div>
        <div class="s" style="font-size:13.5px;line-height:1.6;color:var(--text-1)"><b>报告或材料自动生成</b></div></div>
      <div class="k"><div class="l" style="margin:0 0 6px;color:var(--accent-2);font-size:12.5px">场景确认</div>
        <div class="s" style="font-size:13.5px;line-height:1.6;color:var(--text-1)">2026-09-22 已提交 · <b>8 问全填</b></div></div>
    </div>
    <div class="c soft" style="padding:13px 16px">
      <p style="font-size:13px"><b>今天要讲三件事：</b>① 现在真的能跑（6 只基金实跑）② AI 模块怎么防错（实测拦下过大模型的错）③ <b>接下来 4 周做什么</b> —— 其中"公网部署"这一项 <b>10/10 已经上线了</b>，剩下的排期是多形态覆盖与成本闸门调优</p>
    </div>
  </div>
`);

/* ------------------------------------------------------- 03 双击就能跑 */
S('tight', '进度说明 · 现在能不能跑起来', `
  <div class="hd">
    <div class="kicker">进度说明 ①</div>
    <h2>能跑。双击一个文件，10 秒出全套交付物</h2>
    <div class="sub">Windows 双击 <code>.bat</code>，macOS 双击 <code>.command</code>；另有<b>零依赖单文件版</b>兜底（不用 Node、不用网、不用 Key）</div>
  </div>
  <div class="body row">
    <div style="flex:0 0 372px;display:flex;flex-direction:column;gap:11px">
      <div class="steps">
        <div class="step"><div class="num">1</div><div class="tx"><b>双击启动</b> → 浏览器自动打开本地页面</div></div>
        <div class="step"><div class="num">2</div><div class="tx"><b>输入 6 位基金代码 + 自己的 API Key</b></div></div>
        <div class="step"><div class="num">3</div><div class="tx"><b>探路（约 0.5 秒）</b>：只抓概况/历任经理/报告期网格，把 SOP §0 的<b>八格口径确认表</b>填好候选值摆出来</div></div>
        <div class="step"><div class="num">4</div><div class="tx"><b>人确认口径</b> → 点「按此口径开跑」（约 10 秒）</div></div>
      </div>
      <div class="c acc" style="padding:11px 14px">
        <p style="font-size:12.5px"><b>产出 9 件：</b>复盘报告 · 对外版 · 演示稿（模板版）· <b>演示稿（AI 深度版）</b> · 两个 PDF · 结论卡 · 错误检查记录 · 来源清单 · 底稿</p>
      </div>
      <div class="c soft" style="padding:10px 14px">
        <p style="font-size:12px"><b>回归测试：</b><span class="ok">selftest 76/76</span> · <span class="ok">smoke_page 37/37</span> · <span class="ok">server_http 13/13</span></p>
      </div>
    </div>
    <div class="shot" style="flex:1;height:400px;position:relative">
      <img src="${SHOT_INPUT}" style="width:1250px;margin-top:-42px">
    </div>
  </div>
`);

/* ------------------------------------------------------- 04 出什么 */
S('tight', '进度说明 · 成果长什么样', `
  <div class="hd">
    <div class="kicker">进度说明 ① · 接着说</div>
    <h2>出的东西长这样：结论先行、每个数字带证据级别、判断方向由人拍板</h2>
  </div>
  <div class="body row">
    <div class="shot" style="flex:1;height:402px;position:relative">
      <img src="${SHOT_REPORT}" style="width:1250px;margin-top:-30px">
    </div>
    <div style="flex:0 0 356px;display:flex;flex-direction:column;gap:10px">
      <div class="c acc" style="padding:12px 15px">
        <h4>门禁 2 · 核心判断方向（引擎给候选，报告按此成文）</h4>
        <p style="font-size:12.5px">引擎给出形态标签与置信度，<b>人可改判</b>；改判要写理由，连同理由记进结论卡的 humanOverride / humanReason（不覆盖引擎原判）。<br>
        <span class="dim">截图里：519191 判「主题坚守型」，次优解释「逐步分散型 / 单一重仓依赖型」也一并列出。</span></p>
      </div>
      <div class="c soft" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>每个数字带证据级别：</b>披露事实 / 合理推断 / 事后解读。<br>
        <b>每个判断带推翻条件：</b>"若下一期出现以下任一情况，本判断降级"。</p>
      </div>
      <div class="c acc-g" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>报告 11 节固定骨架</b>（SOP §5.3）：先说结论 → 口径与证据边界 → 总成绩也看代价 → 集中度与骨架 → 轮动主线 → 方法论拆解 → 案例审计 → 最新一期 → 跟踪与证伪 → 附录。</p>
      </div>
    </div>
  </div>
`);

/* ------------------------------------------------------- 05 六只基金 */
S('tight', '进度说明 · 实跑证据', `
  <div class="hd">
    <div class="kicker">进度说明 ②</div>
    <h2>6 只基金实跑，换基金不用改一行代码</h2>
  </div>
  <div class="body">
    <table class="t">
      <thead><tr>
        <th>代码</th><th>基金 / 经理</th><th>区间</th><th class="n">报告期</th>
        <th>官方 PDF 逐行对账</th><th>官方窗口校准</th><th class="n">区间收益</th><th class="n">最大回撤</th><th>形态标签</th>
      </tr></thead>
      <tbody>
        <tr><td>519191</td><td>万家新利 / 黄海</td><td>2020Q4–2026Q2</td><td class="n">23</td>
          <td><span class="ok">4/4 期一致</span>，40 行 · 最大差 <b>0.000pp</b></td><td>4 期 · 0.00pp</td>
          <td class="n"><b>+76.80%</b></td><td class="n">−32.45%</td><td>逐步分散型</td></tr>
        <tr><td>005827</td><td>易方达蓝筹精选 / 张坤</td><td>2018Q4–2026Q1</td><td class="n">30</td>
          <td><span class="ok">4/4 期一致</span>，40 行</td><td class="dim">—</td>
          <td class="n">+86.46%</td><td class="n">−57.91%</td><td>低换手长期持有型</td></tr>
        <tr><td>090007</td><td>大成策略回报 / 徐彦</td><td>2020Q1–2026Q2</td><td class="n">26</td>
          <td><span class="ok">4/4 期一致</span>，40 行</td><td class="dim">—</td>
          <td class="n">+112.52%</td><td class="n">−16.68%</td><td>主题漂移型</td></tr>
        <tr><td>021967</td><td>西部利得均衡优选 / 董伟炜</td><td>2025Q1–2026Q2</td><td class="n">6</td>
          <td><span class="ok">5/6 期一致</span>，60 行</td><td>5 期 · 0.00pp</td>
          <td class="n">+123.24%</td><td class="n">−12.48%</td><td>高频轮动型</td></tr>
        <tr><td>005825</td><td>申万菱信智能驱动 / 卜忠林</td><td>2026Q1–2026Q2</td><td class="n">2</td>
          <td><span class="ok">2/2 期一致</span>，20 行</td><td>2 期 · 最大 0.23pp</td>
          <td class="n">+135.52%</td><td class="n">−12.78%</td><td>样本不足（2 期）</td></tr>
        <tr class="hl-bad"><td>014564</td><td>天弘创新药精选50ETF联接 / 贺雨轩</td><td>2023Q2–2026Q2</td><td class="n">13</td>
          <td><span class="no">13/13 期不一致</span></td><td>7 期 · 最大 0.12pp</td>
          <td class="n dim">—</td><td class="n dim">—</td><td><span class="b b-bad">被阻断</span></td></tr>
      </tbody>
    </table>
    <div class="c acc-w" style="margin-top:14px;padding:11px 15px">
      <p style="font-size:12.5px">最后一行是<b>特地挑来试错的"联接基金"</b>——数据结构和前 5 只不一样，一跑就出问题。
      <b>工具在没见过的数据形态上自己报了错、拒绝出结论</b>，而不是悄悄产出一份看起来正常的报告。详见第 09 页。</p>
    </div>
  </div>
`);

/* ------------------------------------------------------- 06 六类来源 */
S('tight', '进度说明 · 数据合规', `
  <div class="hd">
    <div class="kicker">进度说明 ③</div>
    <h2>六类公开来源（严格按 SOP §2），官方 PDF 是最高权威</h2>
    <div class="sub">全部公开数据 · 不含任何机构或实习单位内部数据 · 不构成投资建议</div>
  </div>
  <div class="body row">
    <table class="t" style="flex:1">
      <thead><tr><th style="width:34px">#</th><th>来源</th><th>取到什么</th></tr></thead>
      <tbody>
        <tr><td>①</td><td><b>官方定期报告 PDF</b><br><span class="dim" style="font-size:11px">巨潮 / 证监会基金信息披露 / 公司官网 / 东财镜像</span></td><td>前十大持仓表 · <b>经理原话</b> · 期末份额净值 · 法定区间净值增长率</td></tr>
        <tr><td>②</td><td>天天基金 F10 历史前十大</td><td>逐季前十大（排名/代码/名称/占净值比/持股数/市值）</td></tr>
        <tr><td>③</td><td>天天基金 资产配置</td><td>股票 / 债券 / 现金 占净比</td></tr>
        <tr><td>④</td><td>天天基金 规模变动</td><td>期末份额 / 期末净资产</td></tr>
        <tr><td>⑤</td><td>净值序列</td><td>日频单位净值 + 累计净值（两者都要，用来还原分红）</td></tr>
        <tr><td>⑥</td><td>经理履历</td><td>历任经理 · 上任/离任日 · <b>共管搭档</b></td></tr>
      </tbody>
    </table>
    <div style="flex:0 0 352px;display:flex;flex-direction:column;gap:11px">
      <div class="c acc" style="padding:13px 15px">
        <h4>对账是自动动作，不是声明</h4>
        <p style="font-size:12.5px">自动挑<b>首季、末季、每 4 季抽样</b> → 下官方 PDF → 抽前十名股票投资明细表 → <b>按股票代码</b>逐行比对（容差 ±0.011pp）→ 对不上以官方为准并记录差异。</p>
      </div>
      <div class="c soft" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>没装 Poppler 时不假装：</b>这一项如实标"未完成"，并在页面上给出该平台对应的安装命令。</p>
      </div>
      <div class="c acc-g" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>为什么按"代码"比而不是按"名称"比：</b>同一只票 A 股和 H 股是两个名字、一个公司。按名称比会漏掉 A+H 双上市的重复行。</p>
      </div>
    </div>
  </div>
`);

/* ------------------------------------------------------- 06 AI 分工 */
S('tight', 'AI 模块 · 分工', `
  <div class="hd">
    <div class="kicker">AI 模块 ①</div>
    <h2>确定性计算归脚本，推理归纳归大模型，把关归人</h2>
  </div>
  <div class="body">
    <div style="display:flex;gap:16px;margin-bottom:15px">
      <div class="c soft" style="flex:1;border-top:3px solid var(--text-3)">
        <h4 style="color:var(--text-2)">脚本（不算错）</h4>
        <p>抓取 → 解析 → 分红复权 → 收益/回撤/集中度 → 建簿 → <b>官方逐行对账</b> → 18 条质检<br><span class="dim">大模型完全不参与数学</span></p>
      </div>
      <div class="c" style="flex:1.25;border-top:3px solid var(--accent-2)">
        <h4>大模型（4 件事）</h4>
        <p>① 季报言论抽取与结构化 ② 行业主题语义归纳 ③ 言行一致性比对与研判起草 ④ 报告与演示稿成文<br><span class="dim">输入输出都是结构化 JSON / Markdown，每一条都要过校验</span></p>
      </div>
      <div class="c soft" style="flex:1;border-top:3px solid var(--warn)">
        <h4 style="color:#a35c00">人（三道人机门禁）</h4>
        <p>门禁 1 <b>口径确认</b>（八格由人定，留一格空不许开跑）<br>门禁 2 <b>核心判断方向</b>（引擎给候选，改判要写理由）<br>门禁 3 <b>终审三查</b>（数字查/结论查/合规查，由 18 条规则结算后直接显示）</p>
      </div>
    </div>
    <div class="kpi">
      <div class="k"><div class="n">4</div><div class="l">大模型任务</div><div class="s">言论抽取 / 主题归类 / 研判起草 / 成文</div></div>
      <div class="k"><div class="n">5</div><div class="l">输出校验器</div><div class="s">覆盖率 · 数字回查 · 违禁词 · 数字守恒 · 字段完整性</div></div>
      <div class="k"><div class="n">3</div><div class="l">人工门禁</div><div class="s">口径确认 · 判断方向 · 终审三查</div></div>
      <div class="k"><div class="n">18</div><div class="l">质检规则</div><div class="s">输入层 / 计算层 / 输出层三态结果</div></div>
    </div>
  </div>
`);

/* ------------------------------------------------------- 07 实测拦截 */
S('tight', 'AI 模块 · 错了怎么发现（实测）', `
  <div class="hd">
    <div class="kicker">AI 模块 ② · 这段是实测，不是设想</div>
    <h2>"错了怎么发现"——用真实 API Key 跑出来的拦截记录</h2>
  </div>
  <div class="body">
    <table class="t">
      <thead><tr><th style="width:230px">大模型干了什么</th><th>校验器的原话（系统自动生成，非人工编写）</th><th style="width:96px">结果</th></tr></thead>
      <tbody>
        <tr><td><b>编数字</b>（核心判断）</td><td class="dim">「数字回查失败，<b>7 个数字</b>在指标包中不存在（疑似编造）：0.25、3.91、130、12.78…」</td><td><span class="b b-bad">拦截</span></td></tr>
        <tr><td><b>大量编数字</b>（深度报告）</td><td class="dim">「<b>39 个数字</b>未能在证据包中找到出处（超过 8 个，判为疑似编造，<b>退回重写</b>）」</td><td><span class="b b-bad">拦截</span></td></tr>
        <tr><td><b>违反用词红线</b></td><td class="dim">「命中违禁词：<b>高点卖出</b>」</td><td><span class="b b-bad">拦截</span></td></tr>
        <tr><td>主题归类没做完</td><td class="dim">「覆盖率仅 <b>0.0%</b>（&lt;95%）：39 只股票未被归类」</td><td><span class="b b-bad">拦截</span></td></tr>
        <tr><td>演示稿数字越界</td><td class="dim">「以下数字未在证据包白名单中（可能被改写或臆造）：67.97%、0.25pp…」</td><td><span class="b b-warn">告警</span></td></tr>
        <tr class="hl-good"><td>对外用词清洗（通过）</td><td class="dim">「<b>数字守恒</b>校验通过：259 个数字逐一比对，清洗未改动任何数字」</td><td><span class="b b-ok">放行</span></td></tr>
      </tbody>
    </table>
    <div class="c acc" style="margin-top:14px;padding:12px 16px">
      <p style="font-size:13px"><b>拦截之后不是报错结束，而是降级继续</b>——规则引擎的结论卡照用、报告照出，只是在质检页明确标出"AI 输出未通过校验，已拦截"。<b>一次接口抖动或一次模型幻觉，不会让整条流水线什么都没有。</b></p>
    </div>
  </div>
`);

/* ------------------------------------------------------- 08 抓出自己的错 */
S('tight', '进度说明 · 工具抓出了我们自己的错', `
  <div class="hd">
    <div class="kicker">进度说明 ④ · 这条最值得讲</div>
    <h2>它抓出的第一个错，是我们自己的错</h2>
  </div>
  <div class="body row">
    <div style="flex:0 0 430px;display:flex;flex-direction:column;gap:12px">
      <div class="kpi">
        <div class="k"><div class="n b" style="font-size:30px">+85.97%</div><div class="l">我们"修正"后的数字</div><div class="s">错的。而且我们一度把它写进了文档</div></div>
        <div class="k"><div class="n g" style="font-size:30px">+76.80%</div><div class="l">真实值</div><div class="s">与最初手工算的 76.77% 一致</div></div>
      </div>
      <div class="c acc-w" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>错在哪：</b>复盘区间写的是 2020Q4–2026Q2，但基准点错取了 2020-12-31（2020Q4 的<b>期末</b>），于是第一个季度自己的收益被漏掉。</p>
      </div>
      <div class="c acc-g" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>怎么钉死的：</b>如果 85.97% 是对的，每个单季收益都该比官方季报高 —— 但实测逐季与官方<b>完全吻合</b>。所以错的不是收益算法，是<b>起点</b>。改成「第一个报告期的<b>期初</b>」后逐季对账 <b>22/22 期、最大偏差 0.01pp</b>。</p>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:12px;justify-content:center">
      <div class="c" style="padding:14px 17px">
        <h4>另一个错：累计净值不能拿来做比值</h4>
        <p>累计净值 = 单位净值 + 累计分红，是<b>加法</b>累积量，做比值在数学上无意义。<br>
        改用<b>分红再投总回报指数</b>（除息日把每份分红加回去，链式相乘），并用官方季报披露的过去三年/五年/七年/十年净值增长率反向校准 —— 平均绝对偏差 <b>15.94pp → 1.07pp</b>。</p>
      </div>
      <div class="c acc" style="padding:14px 17px">
        <p style="font-size:15px;line-height:1.7"><b>这就是为什么整个流程把「官方 PDF 逐行对账」放在最高优先级 ——</b><br>不是为了让报告好看，是为了在<b>我们自己也看不出来</b>的时候，有个东西能指出来。</p>
      </div>
    </div>
  </div>
  <div class="c soft" style="margin-top:14px;padding:11px 16px">
    <p style="font-size:13.5px;color:var(--text-1)">一条教训，写在文档里也写进代码注释：<b>工具给出的数字比手工算的更好看时，恰恰是最该怀疑它的时候。</b></p>
  </div>
`);

/* ------------------------------------------------------- 09 014564 报警 */
S('tight', '进度说明 · 没见过的数据形态也会报警', `
  <div class="hd">
    <div class="kicker">进度说明 ⑤ · 本周新发现</div>
    <h2>换一只"联接基金"，它自己报了错并拒绝出结论</h2>
    <div class="sub">014564 天弘创新药精选50ETF联接A · 贺雨轩 · 2023Q2–2026Q2 · 13 个报告期</div>
  </div>
  <div class="body row">
    <div style="flex:0 0 396px;display:flex;flex-direction:column;gap:11px">
      <div class="kpi">
        <div class="k"><div class="n b" style="font-size:26px">192.89%</div><div class="l">前十合计（2023Q2）</div><div class="s">逻辑上不可能 &gt; 100%</div></div>
        <div class="k"><div class="n b" style="font-size:26px">373%</div><div class="l">前十合计（2024Q3）</div><div class="s">12 期全部超过 100%</div></div>
      </div>
      <div class="c acc-b" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>现象：</b>第三方持仓权重<b>串列</b>。2023Q2 排名第 1 的康宁杰瑞写 1.89%、排名第 2 的药明康德写 <b>60%</b>；单股最高出现 <b>99%</b>。</p>
      </div>
      <div class="c soft" style="padding:12px 15px">
        <p style="font-size:12.5px"><b>现状：</b>已确认是第三方接口在这只基金上的数据串列 / 量纲问题，<b>尚未定位到具体哪一列</b>，暂不纳入正式交付。</p>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px">
      <div class="q"><div class="who">18 条质检 · A1 单股权重 ≤ 10%（双十约束） → FAIL</div>
        「发现 <b>96 条</b>超过 10.5% 的记录，幅度过大，权重口径很可能不是"占净值比"（也可能是数据串列）。」</div>
      <div class="q"><div class="who">18 条质检 · B2 前十合计 ≤ 100% → FAIL</div>
        「有 <b>12 期</b>前十合计超过 100%，<b>逻辑上不可能</b>（权重为占净值比）。」</div>
      <div class="q"><div class="who">官方 PDF 逐行对账（独立通道） → 13/13 期不一致</div>
        「药明康德(603259)：官方 0.6% vs 第三方 60%（差 59.40pp）」… 13 期全部报出同量级偏差</div>
      <div class="c acc-b" style="padding:12px 15px">
        <p style="font-size:13.5px;color:var(--text-1)"><b>最终裁决：fail —— 有 2 项必须处理（阻断）。</b>报告仍然生成，但被明确标记为阻断、不得对外交付。</p>
      </div>
    </div>
  </div>
`);

/* ------------------------------------------------------- 10 改了什么 */
S('tight', '和场景确认比，改了什么', `
  <div class="hd">
    <div class="kicker">和场景确认比，改了什么，为什么</div>
    <h2>方向没变，把三件事做实了</h2>
    <div class="sub">场景确认（9/22 提交）定的是"报告或材料自动生成的网页项目"；之后的修改都在往同一个方向拧：<b>从"一个能出报告的网页"→"别人不用装任何东西就能用、而且自己会发现自己算错的东西"。</b></div>
  </div>
  <div class="body">
    <table class="t">
      <thead><tr><th style="width:34px">#</th><th style="width:290px">改了什么</th><th>为什么（都是跑出来的理由，不是偏好）</th></tr></thead>
      <tbody>
        <tr><td>1</td><td><b>AI 模块：可选 → 必选</b></td><td><b>主题归类没有公开接口可替代</b>——天天基金、巨潮都不给"主题"字段。缺了它，"主题坚守型 / 主题漂移型"两条形态规则直接跳过：实测 519191 缺主题只能判成"逐步分散型"，补上才判出"主题坚守型"。</td></tr>
        <tr><td>2</td><td><b>加"探路 → 口径确认表 → 开跑"两阶段</b></td><td>SOP §0 原话是「<b>任何一格留空不许开跑</b>」。原版靠 AI 口头问，现在把候选值摆出来让人点。现实价值在<b>共管期</b>：005827 现任经理 2026-05-23 才接手（仅 1 期），引擎<b>建议</b>改用张坤那一任（30 期），但最终由人拍板，不再偷偷替你换。</td></tr>
        <tr><td>3</td><td><b>演示稿：1 份 → 2 份，新增 AI 深度版</b></td><td>第一版版式写死、只把数字填进槽位，9 页长得一样、一眼是报表。现在大模型<b>先分镜、再逐页单独成文</b>（页数由内容决定，每页标题是一句主张）。<b>保底</b>：大模型失败时深度版跳过、模板版照常产出。</td></tr>
        <tr><td>4</td><td><b>交付形态：发压缩包 → 发一个文件</b></td><td>组员在 macOS 上双击 <code>.bat</code> 打不开（<code>.bat</code> 是 Windows 专用）。现在三件套：Windows <code>.bat/.cmd</code>、macOS <code>.command</code>（LF 换行 + 无 BOM + 可执行位 755，且<b>启动时自己补 PATH</b>——Finder 双击的程序不读 <code>~/.zshrc</code>）、零依赖单文件 HTML。</td></tr>
        <tr><td>5</td><td><b>报告与演示稿改成"能直接发给别人"</b></td><td>原版引用网络字体和外部资源，发到别人电脑上就散架。现在单文件 HTML（全内联、断网可看）、字体换本机字体栈、删掉会在 PDF 里渲染成空白的渐变字，另出 PDF 可直接发微信。</td></tr>
        <tr><td>6</td><td><b>收益口径与区间起点都改了</b></td><td>累计净值是加法量、做比值无意义（改分红再投指数，偏差 15.94pp → 1.07pp）；起点取"期末"会漏掉第一个季度（519191 从 76.77% 虚增到 85.97%，改"期初"后回到 76.80%，逐季对账 22/22 期）。</td></tr>
        <tr class="hl-good"><td>7</td><td><b>新增：从"本地点开"改成"公网链接人人可点"</b> <span class="b b-ok">已上线</span></td><td>平台说明写着「至少要能在本地运行，<b>部署到公网加分</b>」。原计划 10/20 前上线，<b>实际 10/10 就上线了</b>：<code>https://fundclinic.onrender.com</code>（Render 免费档 · Docker 构建）。访客只输 6 位基金代码，<b>不用装 Node、不用 VPN</b>；大模型 Key 由<b>服务端</b>持有。另加了三道用量闸门（每台 3 次/小时、8 次/天；全站 40 次/天）兜住花费。</td></tr>
        <tr class="hl-good"><td>8</td><td><b>把"请人打勾"从页面上拿掉</b> <span class="b b-ok">10/10</span></td><td>质检页原来有：12 处抽检每条的"核完"勾选框、门禁 3 三查三个勾（不勾满不让导出）、一整套"复制提示词 / 粘贴大模型返回的 JSON"的人工中转，公网页面上还有一整块"填 API Key"。问题不在麻烦，在于<b>打勾不产生任何证据</b> —— 它不改数据、不改报告，只把导出按钮从灰变亮，证明的是"有人点过鼠标"，而访客也不是这次复盘的负责人。改成：18 条规则 + 12 处回原文抽检清单实际结算，结果直接显示；Key 表单在服务端持有 Key 时整块收掉。只有在<b>没有服务端</b>的离线单文件版里才保留人工中转 —— 那条路上 AI 真的跑不了。</td></tr>
      </tbody>
    </table>
  </div>
  <div class="c soft" style="margin-top:12px;padding:10px 16px">
    <p style="font-size:12.5px"><b>没改的（也说一下）：</b>项目名、类型单选、四类目标用户、"脚本算数 / 大模型写字 / 人把关"的分工、三道人机门禁 —— 门禁本身一条没删（人该定的口径、该拍的判断方向都留着），改的只是它的形态：从"请你打勾"改成"机器结算 + 结果直接显示"（见第 8 条）。</p>
  </div>
`);

/* ------------------------------------------------------- 11 卡在哪 */
S('tight', '主要问题 · 卡在哪里，需要什么帮助', `
  <div class="hd">
    <div class="kicker">主要问题</div>
    <h2>卡在哪里，需要什么帮助</h2>
  </div>
  <div class="body" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-content:start">
    <div class="c acc" style="padding:14px 16px">
      <h4>1 · 公网部署 —— 已解决，但冒出一个新问题 <span class="b b-ok">已上线</span></h4>
      <p><b>10/10 已上线：</b><code>https://fundclinic.onrender.com</code>，并用我们自己的 Key <b>真实跑通两只基金</b>（519191 二十三期 453 秒、005825 九期 366 秒），报告 / 结论卡 / 质检 / 来源清单 / <b>AI 深度版演示稿</b>全部可下载。<br>
      <b>新问题：</b>形态变成"服务端持有我们的 Key"之后，<b>Key 就是任何点开链接的人都能花的钱</b>。所以加了三道闸门（每台 3 次/小时、8 次/天；全站 40 次/天）。<b>实测单次约 0.3 元</b>，40 次/天约 12 元封顶。<br>
      <b>需要帮助：</b>① 课堂对"部署到公网"是否另有要求 ② <b>全站每天 40 次这个额度定多少合适</b>（真钱，想听老师意见）。</p>
    </div>
    <div class="c acc" style="padding:14px 16px">
      <h4>2 · 大模型 Key 是每人自备的</h4>
      <p>AI 模块必选，一次完整跑一只基金要调很多次大模型（最长单步 87 秒），成本按量计。<br>
      <b>需要帮助：</b>课堂现场演示用谁的 Key、是否允许把 Key 填在教师机浏览器里（我们的设计：Key 不落盘、不进日志、不出现在 URL）。<br>
      <b>备选：</b>离线单文件版兜底（不用 Key、不用网）。</p>
    </div>
    <div class="c acc" style="padding:14px 16px">
      <h4>3 · 第三方数据源没有承诺，换个基金就可能换一套坑</h4>
      <p>天天基金持仓接口是网页接口，<b>没有 SLA</b>。这不是"假设"——第 6 只基金（014564）就真出问题了（权重串列，前十合计 373%）。<br>
      <b>需要帮助：</b>① 有没有更好的"字段自检"思路（我们现在靠"前十合计 &gt;100% 就报警"这类<b>逻辑不可能检测</b>）② 联接基金 / ETF 这类特殊结构，公开季报里前十大该怎么取才对。</p>
    </div>
    <div class="c acc" style="padding:14px 16px">
      <h4>4 · 方法本身有一条边界，想请教怎么补</h4>
      <p>公募季报<b>只披露前十大</b>，且是<b>期末快照</b>——期间怎么买卖看不见。这决定了我们只能做"期末结构 + 前后两期对比"，做不了"真实换手"。我们在每份报告里都写明了这条边界。<br>
      <b>需要帮助：</b>有没有公开渠道能拿到季报之外更像"过程"的证据？或者公认的做法来处理"期末快照"这个局限？<br>
      <span class="dim">另：中期是全员上台、每组 5 分钟，也想请老师给个节奏建议——我们暂定「痛点 30 秒 → 现场演示 2 分钟 → AI 模块 1 分钟 → 结果与下一步 1.5 分钟」。</span></p>
    </div>
  </div>
`);

/* ------------------------------------------------------- 12 路线图 */
S('tight', '接下来做什么、预计什么时候做完', `
  <div class="hd">
    <div class="kicker">接下来做什么、预计什么时候做完</div>
    <h2>功能主线已跑通，剩下两件事：让别人也能用 · 多覆盖几种基金形态</h2>
  </div>
  <div class="body" style="justify-content:center">
    <div class="road">
      <div class="st"><div class="ln"><span style="width:50%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/10 – 10/13</div><div class="t">中期材料定稿</div>
        <div class="x">5 分钟讲稿按「痛点 30s → 演示 2min → AI 1min → 下一步 1.5min」压缩；展示页打成 zip</div></div></div>
      <div class="st"><div class="ln"><span style="width:100%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/14 – 10/20 → <b>10/10 已提前完成</b></div><div class="t">部署到公网 <span class="b b-ok">已上线</span></div>
        <div class="x">从"本地点开"变成"发条链接谁都能点开"，同学不用装 Node、不用 VPN<br><span class="b b-ok">验收：https://fundclinic.onrender.com 已可公开访问</span></div></div></div>
      <div class="st"><div class="ln"><span style="width:100%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/14 – 10/24</div><div class="t">组员独立复跑</div>
        <div class="x">2 只全新基金，在自己电脑上从零跑（不复用任何预置结果），记录卡在哪、花多久<br><span class="b b-blue">这是中期最硬的一条证据</span></div></div></div>
      <div class="st"><div class="ln"><span style="width:100%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/25 – 11/05</div><div class="t">横向对比 + 边界页</div>
        <div class="x">用结论卡做对比页（按形态标签筛选）；补合规与边界页；修 014564 的数据源问题<br><span class="b b-blue">目标：5–8 只基金可比</span></div></div></div>
      <div class="st"><div class="ln"><span style="width:0"></span></div><div class="dot" style="background:var(--good)"></div>
        <div class="box" style="border-color:var(--good)"><div class="d" style="color:var(--good)">11/06 – 11/10</div><div class="t">终展排练与提交</div>
        <div class="x">15 分钟（12 讲 + 3 问答），全员上台分工</div></div></div>
    </div>
    <div class="c soft" style="margin-top:20px;padding:12px 16px">
      <p style="font-size:13px"><b>一句话：</b>功能主线已经跑通；剩下的是「<b>让别人也能用</b>」和「<b>多覆盖几种基金形态</b>」。<b>交付物不是 PPT，是一个别人点开就能用的网页。</b></p>
    </div>
  </div>
`);

/* ------------------------------------------------------- 13 尾页 */
slides.push(`<section class="slide end">
  <h1>现场演示</h1>
  <p>输入一个 6 位基金代码，当场出报告与演示稿。<br>
  <span class="dim" style="font-size:15px">网络不通 / 环境不对时的兜底：双击零依赖单文件版，不用 Node、不用网、不用 Key。</span></p>
  <div class="rule2" style="margin:30px auto 22px"></div>
  <p style="font-size:15px;color:var(--text-3)">基金复诊台 FundClinic · 第 2 组 · 2026-10-14</p>
</section>`);

/* ------------------------------------------------------------------ 装配 */
const total = slides.length;
const html = slides.join('\n').replace(/\/ 999</g, ' / ' + String(total).padStart(2, '0') + '<');

const DOC = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>基金复诊台 · 中期进度汇报 · 第 2 组</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${baseCss}
${themeCss}
${kitCss}
${slideCss}
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="deck" id="deck">
${html}
    <div class="pbar"><i id="pbar"></i></div>
  </div>
</div>
<div class="help">← → 翻页 · F 全屏 · P 打印/导出 PDF · O 总览</div>
<script>
(function(){
  var deck = document.getElementById('deck');
  var slides = [].slice.call(deck.querySelectorAll('.slide'));
  var pbar = document.getElementById('pbar');
  var stage = document.getElementById('stage');
  var i = 0;

  function fit(){
    var s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.setProperty('--s', s);
  }
  function show(n){
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === i && slides[i].classList.contains('is-active')) return;
    slides.forEach(function(s, k){
      s.classList.toggle('is-active', k === n);
      s.classList.toggle('is-prev', k < n);
    });
    i = n;
    pbar.style.width = ((n + 1) / slides.length * 100) + '%';
    try { location.hash = 'p' + (n + 1); } catch (e) {}
  }
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', function(e){
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown') { e.preventDefault(); show(i + 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); show(i - 1); }
    else if (k === 'Home') { show(0); }
    else if (k === 'End') { show(slides.length - 1); }
    else if (k === 'p' || k === 'P') { window.print(); }
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    }
  });
  document.addEventListener('click', function(e){
    if (e.target.closest('a')) return;
    if (e.clientX > window.innerWidth * 0.5) show(i + 1); else show(i - 1);
  });
  fit();
  var m = /^#p(\\d+)$/.exec(location.hash);
  i = -1; show(m ? Number(m[1]) - 1 : 0);
})();
</script>
</body>
</html>`;

fs.mkdirSync(OUTDIR, { recursive: true });
const outFile = path.join(OUTDIR, 'index.html');
fs.writeFileSync(outFile, DOC, 'utf8');
console.log('写出 ' + outFile);
console.log('  幻灯片    ' + total + ' 张');
console.log('  文件大小  ' + (Buffer.byteLength(DOC) / 1024 / 1024).toFixed(2) + ' MB');
/* 只数**真正的资源引用**(<link href> / <script src> / <img src> / CSS url()), 不数正文里的网址。
   踩过: 之前是 `DOC.match(/https?:\/\//g)`, 而我们刚把上线地址 https://fundclinic.onrender.com
   写进正文当内容展示 —— 于是自检报"外链引用 3 处(应为 0)", 其实是假警报。
   正文里出现网址是**要**的(就是给人看的), 会断网散架的是**资源**引用。 */
const extRefs = [
  ...(DOC.match(/<(?:link|script|img)[^>]*(?:href|src)="(?!data:)[^"]*"/g) || []),
  ...(DOC.match(/url\((?!['"]?data:)[^)]*\)/g) || [])
];
console.log('  自检      外链**资源**引用 ' + extRefs.length + ' 处（应为 0）' + (extRefs.length ? ' → ' + extRefs.slice(0, 3).join(' | ') : ''));
console.log('  自检      正文里的网址 ' + ((DOC.match(/https?:\/\//g) || []).length) + ' 处（内容展示，正常）');
console.log('  自检      base64 图 ' + ((DOC.match(/data:image\/png;base64/g) || []).length) + ' 张');
console.log('  自检      危险动画 ' + ((DOC.match(/animation[^;]*\bboth\b/g) || []).length) + ' 处（应为 0）');
console.log('  自检      渐变字   ' + ((DOC.match(/-webkit-text-fill-color:\s*transparent/g) || []).length) + ' 处（应为 0）');

