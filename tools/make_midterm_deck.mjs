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
/* 第 3 页用**公网形态**的截图: 那页讲的就是"别人点开就能用"。
   原来用的 view_input.png 是 file:// 离线渲染的, 图里带着"当前是离线模式 / 跨域会被拦"的提示,
   放在讲公网的页面上自相矛盾(2026-10-10 换掉)。报告页那张仍然是本机渲染的, 内容一样。 */
const SHOT_INPUT = shot('live_input.png');
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
/* 内容多的页专用: 8 行"改了什么"表 + 脚注要一起挤进 720px。
   不加这个类的话, 第 10 页的 .body 会比容器高 65px —— .deck 是 overflow:hidden,
   底部就被剪掉, 视觉上就是"表格末行 / 脚注 / 左下角页眉"叠在一起(2026-10-10 用户报的就是这个)。 */
table.t.sm{font-size:11.8px}
table.t.sm th,table.t.sm td{padding:4px 8px;line-height:1.45}
table.t.sm thead th{font-size:10.5px}
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

/* 页码：三页版没有封面，第一张就是正式内容，所以计数器从 0 起。
   (13 页版那会儿封面不印页码、初值给 1，让第二张才是 "02"。) */
let N = 0;
const slides = [];
const S = (cls, tag, body) => { N += 1; slides.push(P(cls, body + pg(N, 999, tag))); };

/* 三页版展示页（平台要求：小组进度汇报材料限 3 页 = 当前进展 / 遇到的问题 / 后续计划）
 * 这个文件只是给 tools/_patch_deck3.mjs 读的"新幻灯片正文"，不是独立脚本。
 */

S('tight', '当前进展 · 做完了什么', `
  <div class="hd">
    <div class="kicker">小组作业 II · 中期进度汇报 · 第 2 组</div>
    <h2>当前进展：一条流水线跑通了，公网也能用</h2>
    <div class="sub">基金复诊台 FundClinic · 2026-10-14 第 5 次课 · 5 人全员上台 · 5 分钟　｜　<b>打开 <code>https://fundclinic.onrender.com</code>，输 6 位基金代码就能出全套交付物</b></div>
  </div>
  <div class="body row">
    <div style="flex:0 0 424px;display:flex;flex-direction:column;gap:10px">
      <div class="steps">
        <div class="step"><div class="num">1</div><div class="tx"><b>打开 fundclinic.onrender.com</b><span class="dim">（或本机双击 .bat / .command）</span>，输 6 位基金代码</div></div>
        <div class="step"><div class="num">2</div><div class="tx"><b>探路（约 0.5 秒）</b>：抓概况 / 历任经理 / 报告期网格，把 SOP 的<b>八格口径确认表</b>摆出来</div></div>
        <div class="step"><div class="num">3</div><div class="tx"><b>人确认口径</b> → 点「按此口径开跑」<span class="dim">（预置样例约 10 秒；真抓六类来源 6–7 分钟）</span></div></div>
        <div class="step"><div class="num">4</div><div class="tx"><b>出 9 件交付物</b>：复盘报告 · 对外版 · 演示稿（模板版 + AI 深度版）· 两个 PDF · 结论卡 · 错误检查记录 · 来源清单 · 底稿</div></div>
      </div>
      <div class="c acc" style="padding:10px 13px">
        <p style="font-size:12px"><b>公网已经上线（10/10）</b>：访客只输代码，<b>不用装 Node、不用 VPN、不用填 Key</b>（Key 在服务端）。加了三道用量闸门：每台 3 次/小时、8 次/天，全站 40 次/天。</p>
      </div>
      <div class="c soft" style="padding:9px 13px">
        <p style="font-size:11.5px"><b>回归测试：</b><span class="ok">selftest 76/76</span> · <span class="ok">smoke_page 41/41</span> · <span class="ok">审计页两形态 25/25</span> · <span class="ok">公网验收全绿</span></p>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px">
      <table class="t sm">
        <thead><tr><th>代码</th><th>基金 / 经理</th><th class="n">报告期</th><th>官方 PDF 逐行对账</th><th class="n">区间收益</th><th>形态标签</th></tr></thead>
        <tbody>
          <tr><td>519191</td><td>万家新利 / 黄海</td><td class="n">23</td><td><span class="ok">4/4 期一致</span> · 40 行 · 最大差 0.000pp</td><td class="n"><b>+76.80%</b></td><td>主题坚守型</td></tr>
          <tr><td>005827</td><td>易方达蓝筹精选 / 张坤</td><td class="n">30</td><td><span class="ok">4/4 期一致</span> · 40 行</td><td class="n">+86.46%</td><td>低换手长期持有型</td></tr>
          <tr><td>090007</td><td>大成策略回报 / 徐彦</td><td class="n">26</td><td><span class="ok">4/4 期一致</span> · 40 行</td><td class="n">+112.52%</td><td>主题漂移型</td></tr>
          <tr><td>021967</td><td>西部利得均衡优选 / 董伟炜</td><td class="n">6</td><td><span class="ok">5/6 期一致</span> · 60 行</td><td class="n">+123.24%</td><td>高频轮动型</td></tr>
          <tr><td>005825</td><td>申万菱信智能驱动 / 卜忠林</td><td class="n">2</td><td><span class="ok">2/2 期一致</span> · 20 行</td><td class="n">+135.52%</td><td>样本不足（2 期）</td></tr>
        </tbody>
      </table>
      <div class="c acc-g" style="padding:10px 13px">
        <p style="font-size:12px"><b>AI 只干 4 件语言的事</b>（抽季报原话 / 归主题 / 起草研判 / 成文），算数全归脚本。<b>实测拦下过 2 次</b>：核心判断编了 7 个数字、深度报告编了 39 个（超 8 个退回重写）并写了违禁词「高点卖出」。<b>拦住不等于崩</b>：结论卡照用、报告照出，质检页标明已拦截。</p>
      </div>
      <div class="c soft" style="padding:9px 13px">
        <p style="font-size:11.5px"><b>两个口径错是我们自己抓出来的：</b>累计净值是加法量、做比值无意义（改分红再投指数：偏差 15.94pp → 1.07pp）；区间起点取「期末」会漏掉第一个季度（519191 从 76.77% 虚增到 85.97%，改「期初」后回到 76.80%，逐季对账 22/22 期）。</p>
      </div>
    </div>
  </div>
`);

S('tight', '遇到的问题 · 卡在哪、需要什么帮助', `
  <div class="hd">
    <div class="kicker">遇到的问题</div>
    <h2>遇到的问题：卡在哪、需要什么帮助</h2>
    <div class="sub">前两个最要紧；第四条是我们自己踩的坑，一并说。</div>
  </div>
  <div class="body" style="display:grid;grid-template-columns:1fr 1fr;gap:11px;align-content:start">
    <div class="c acc" style="padding:12px 14px">
      <h4>1 · Key 的花费由谁兜 <span class="b b-warn">真钱</span></h4>
      <p><b>卡点：</b>为了让"发条链接谁都能用"，Key 放在服务端，访客不用填；代价是任何点开链接的人花的都是我们的钱。加了三道闸门（每台 3 次/小时、8 次/天，全站 40 次/天），实测单次 0.3–0.5 元。<br>
      <b>需要帮助：</b>① 全站每天 40 次这个额度定多少合适 ② 课堂上用公网站演示，允不允许用我们的 Key 公开跑。</p>
    </div>
    <div class="c acc" style="padding:12px 14px">
      <h4>2 · 第三方数据源没有承诺</h4>
      <p><b>卡点：</b>天天基金是网页接口，没有 SLA、也没有版本承诺，改版或换结构就会失效。我们只把它当交叉验证，最高权威是官方季报 PDF。<br>
      <b>需要帮助：</b>① 有没有更好的"字段自检"思路（现在是 A1 单股 ≤10%、B2 前十合计 ≤100% 这类"逻辑上不可能"的检测）② <b>ETF / 联接基金</b>这类特殊结构，公开季报里前十大该怎么取。</p>
    </div>
    <div class="c acc" style="padding:12px 14px">
      <h4>3 · 季报只有前十大，而且是期末快照</h4>
      <p><b>卡点：</b>公募季报只披露前十大，期间怎么买卖看不见。所以只能做"期末结构 + 前后两期对比"，做不了"真实换手"。这条边界每份报告里都写明了。<br>
      <b>需要帮助：</b>有没有公开渠道能拿到季报之外更像"过程"的证据？或者大家公认怎么处理这个局限。</p>
    </div>
    <div class="c acc-w" style="padding:12px 14px">
      <h4>4 · 我们自己也错过：区间起点取成了「期末」</h4>
      <p>区间写的是 2020Q4–2026Q2，基准点却取成了第一个报告期的期末，漏掉第一个季度，收益从 76.77% 虚增到 <b>85.97%</b>，我们一度把它当成"修正"写进了文档。最后是官方逐季披露值把它钉死的：改「期初」后回到 <b>76.80%</b>，逐季对账 22/22 期。<br>
      <b>教训：</b>工具算出来的数字比手算的还漂亮的时候，先别高兴，先去核对。</p>
    </div>
  </div>
`);

S('tight', '后续计划 · 接下来 4 周', `
  <div class="hd">
    <div class="kicker">后续计划</div>
    <h2>后续计划：4 周，两件事</h2>
    <div class="sub">让别人也能用 · 多覆盖几种基金形态</div>
  </div>
  <div class="body" style="justify-content:center">
    <div class="road">
      <div class="st"><div class="ln"><span style="width:50%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/13 前</div><div class="t">中期材料定稿 <span class="b b-ok">已完成</span></div>
        <div class="x">展示页按平台要求压到 3 页；三个文本框填完；打成 zip 交上去</div></div></div>
      <div class="st"><div class="ln"><span style="width:100%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/14 – 10/24</div><div class="t">组员独立复跑</div>
        <div class="x">2 只全新基金，在自己电脑上从零跑（不复用任何预置结果），记录卡在哪、花多久<br><span class="b b-blue">这是中期最硬的一条证据</span></div></div></div>
      <div class="st"><div class="ln"><span style="width:100%"></span></div><div class="dot"></div>
        <div class="box"><div class="d">10/25 – 11/05</div><div class="t">横向对比 + 边界页</div>
        <div class="x">用结论卡做对比页（按形态标签筛选）；补合规与边界页；补 ETF / 联接基金这类特殊结构的取数适配<br><span class="b b-blue">目标：5–8 只基金可比</span></div></div></div>
      <div class="st"><div class="ln"><span style="width:0"></span></div><div class="dot" style="background:var(--good)"></div>
        <div class="box" style="border-color:var(--good)"><div class="d" style="color:var(--good)">11/10 前提交 · 11/11 第 9 次课</div><div class="t">终展 <span class="b b-ok">每组 10 分钟</span></div>
        <div class="x">11/10 23:59 前交终展材料（含<b>演示视频或截图</b>、<b>组内分工表</b>）；11/11 第 9 次课每组 10 分钟，含问答与换场，全员上台</div></div></div>
    </div>
    <div class="c soft" style="margin-top:16px;padding:11px 15px">
      <p style="font-size:12.5px"><b>说到底：</b>主线已经跑通，剩下的是<b>让别人也能用</b>和<b>多覆盖几种基金形态</b>。<b>我们交的不是 PPT，是一个别人点开就能用的网页。</b></p>
    </div>
  </div>
`);

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

/* ============================================================ 备用版(零脚本)
 * 正式版靠一段 JS 做"一次只显示一页 + 自动缩放"。万一教师机禁用了脚本、或者那段 JS 出错,
 * 正式版的表现是**一片空白** —— 13 页全叠在同一个坐标上, 只有封面和最后一张可见。
 * 所以再出一份**零脚本**的: 把舞台/翻页那套布局整条拆掉, 13 页竖直排下来,
 * 打开就能滚、Ctrl+P 就能打印, 不依赖任何素材、网络和脚本。
 * 两份放在同一个文件夹里: 主文件打不开时, 双击备用版即可。
 */
const FALLBACK_CSS = `
/* ---- 备用版覆盖: 拆掉 .stage 的缩放定位与 .slide 的绝对定位/透明 ---- */
html,body{height:auto !important;overflow:auto !important;background:#eef1f5 !important}
.stage{position:static !important;left:auto !important;top:auto !important;width:auto !important;height:auto !important;
  transform:none !important;padding:18px 0 26px}
.deck{width:auto !important;height:auto !important;overflow:visible !important;box-shadow:none !important;
  background:transparent !important;display:flex;flex-direction:column;align-items:center;gap:18px}
.slide{position:relative !important;inset:auto !important;opacity:1 !important;pointer-events:auto !important;
  transform:none !important;box-shadow:0 10px 28px rgba(11,32,56,.18);border-radius:6px}
.pbar,.help{display:none !important}
/* 教师机常见 1366×768: 自动缩小, 省得横向滚动 */
@media (max-width:1340px){.deck{zoom:.88}}
@media (max-width:1200px){.deck{zoom:.80}}
@media (max-width:1040px){.deck{zoom:.68}}
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{background:#fff !important}
  .stage{padding:0}
  .deck{gap:0;zoom:1}
  .slide{box-shadow:none;border-radius:0;break-after:page;page-break-after:always}
  .slide:last-child{break-after:auto;page-break-after:auto}
}`;

const FALLBACK = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>基金复诊台 · 中期进度汇报(备用版 · 零脚本)</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${baseCss}
${themeCss}
${kitCss}
${slideCss}
${FALLBACK_CSS}
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="deck" id="deck">
${html}
  </div>
</div>
</body>
</html>`;

const fbFile = path.join(OUTDIR, '备用_无需脚本版.html');
fs.writeFileSync(fbFile, FALLBACK, 'utf8');
console.log('写出 ' + fbFile);
const fbSlides = (FALLBACK.match(/<section[^>]*class="[^"]*\bslide\b/g) || []).length;
const fbExt = [
  ...(FALLBACK.match(/<(?:link|script|img)[^>]*(?:href|src)="(?!data:)[^"]*"/g) || []),
  ...(FALLBACK.match(/url\((?!['"]?data:)[^)]*\)/g) || [])
];
console.log('  自检      幻灯片 ' + fbSlides + ' 张' + (fbSlides === total ? '（与正式版一致）' : ' ← 与正式版不一致（' + total + '）'));
console.log('  自检      含 <script>: ' + /<script/i.test(FALLBACK) + '（必须为 false）');
console.log('  自检      外链**资源**引用 ' + fbExt.length + ' 处（应为 0）');
console.log('  自检      base64 图 ' + ((FALLBACK.match(/data:image\/png;base64/g) || []).length) + ' 张');

