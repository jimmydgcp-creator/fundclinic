/* 生成《小组作业II·中期进度汇报_组内确认稿.docx》
 *
 * 为什么还要一份 Word: 平台那三个格子是**全组共用的**, 组里任何一人提交即代表全组。
 * 发一份能直接在手机上打开、能圈能改的稿子到群里, 比在微信里贴一段长文本靠谱得多。
 *
 * 内容严格对齐平台上那三道题的**原文与顺序**(从 /api/v1/tasks/g2-progress 拉下来的),
 * 每道题分三块: 平台要求原文 / 我们的草稿 / 需要组员拍板的地方。
 *
 * 用法: node tools/make_docx_midterm.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(ROOT, '..', '00_交作业', '小组作业II_中期进度_组内确认稿.docx');

/* ------------------------------------------------------------ XML 小工具 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function P(text, opt = {}) {
  const runs = Array.isArray(text) ? text : [{ t: text, ...opt }];
  const rpr = r => {
    const font = r.mono ? 'Consolas' : 'Microsoft YaHei';
    let s = '<w:rPr>';
    s += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="Microsoft YaHei"/>`;
    if (r.bold) s += '<w:b/>';
    if (r.color) s += `<w:color w:val="${r.color}"/>`;
    if (r.size) s += `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`;
    s += '</w:rPr>';
    return s;
  };
  /* 稿件正文是照 Markdown 习惯写的, 里面会有 **强调** 标记 —— docx 不认这个语法,
     不处理的话会原样印出两个星号。这里统一剥掉。 */
  const body = runs.map(r => `<w:r>${rpr(r)}<w:t xml:space="preserve">${esc(String(r.t).replace(/\*\*/g, ''))}</w:t></w:r>`).join('');
  const ppr = '<w:pPr>'
    + (opt.align ? `<w:jc w:val="${opt.align}"/>` : '')
    + (opt.indent ? `<w:ind w:left="${opt.indent}"/>` : '')
    + `<w:spacing w:before="${opt.before === undefined ? 60 : opt.before}" w:after="${opt.after === undefined ? 60 : opt.after}" w:line="300" w:lineRule="auto"/>`
    + (opt.shade ? `<w:shd w:val="clear" w:fill="${opt.shade}"/>` : '')
    + '</w:pPr>';
  return `<w:p>${ppr}${body}</w:p>`;
}

const H1 = t => P(t, { bold: true, size: 20, color: '1F3864', before: 300, after: 140 });
const H2 = t => P(t, { bold: true, size: 15, color: '1F3864', before: 220, after: 90 });
const H3 = t => P(t, { bold: true, size: 12, color: '2E5496', before: 160, after: 60 });
const Body = t => P(t, { size: 10.5 });
const Small = t => P(t, { size: 9, color: '666666' });
const Bullet = (t, ind) => P('· ' + t, { size: 10.5, indent: ind || 300 });
const Blank = () => P('', { size: 8, before: 30, after: 30 });
const Note = t => P(t, { size: 9.5, color: '8A5A00', shade: 'FFF7E6', indent: 180, before: 90, after: 90 });

/* 表格: 边框手写, 不依赖任何样式表(自建 docx 没有 styles.xml) */
function TBL(headers, rows, weights) {
  const W = 9638;
  const cols = weights.map(w => Math.round(W * w / weights.reduce((a, b) => a + b, 0)));
  const border = c => `<w:${c} w:val="single" w:sz="4" w:space="0" w:color="B7C3D6"/>`;
  const cell = (txt, i, bold, shade) => {
    const r = { t: String(txt), size: bold ? 9.5 : 9, bold, color: bold ? '1F3864' : '222222' };
    return `<w:tc><w:tcPr><w:tcW w:w="${cols[i]}" w:type="dxa"/>`
      + (shade ? `<w:shd w:val="clear" w:fill="${shade}"/>` : '')
      + `<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`
      + `<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="252" w:lineRule="auto"/></w:pPr>`
      + `<w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>`
      + `<w:sz w:val="${r.size * 2}"/><w:szCs w:val="${r.size * 2}"/>`
      + (r.bold ? '<w:b/>' : '') + `<w:color w:val="${r.color}"/></w:rPr>`
      + `<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r></w:p></w:tc>`;
  };
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
    + `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols.map(c => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>`;
  x += '<w:tr>' + headers.map((h, i) => cell(h, i, true, 'EDF2FA')).join('') + '</w:tr>';
  for (const row of rows) x += '<w:tr>' + row.map((c, i) => cell(c, i, false)).join('') + '</w:tr>';
  return x + '</w:tbl>';
}

/* ============================================================ 正文开始 */
const doc = [];

doc.push(P('小组作业 II · 中期进度汇报', { bold: true, size: 24, color: '1F3864', align: 'center', before: 0, after: 60 }));
doc.push(P('组 内 确 认 稿', { bold: true, size: 13, color: '2E5496', align: 'center', after: 200 }));
doc.push(P('金融AI智能体设计与应用 · 中山大学岭南学院 · 张一帆 · 第 2 组', { size: 10, color: '666666', align: 'center' }));
doc.push(P('提交页 https://hw.lingnan.top/mf/t/g2-progress  ·  截止 2026-10-13 23:59  ·  第 5 次课 10/14 每组 5 分钟、全员上台',
  { size: 9.5, color: '666666', align: 'center', after: 240 }));

doc.push(H1('零、这份稿子怎么用'));
doc.push(Body('平台那三个填空是**全组共用**的：组里任何一个人提交，就代表全组，交上去的是同一份。所以先在这份 Word 上把话说定，再往平台上贴。'));
doc.push(Blank());
doc.push(Label2('需要你做的三件事：'));
doc.push(Bullet('① 通读一遍，觉得哪里说得过了、或者漏了功劳，直接在上面改（用批注/改字都行）；'));
doc.push(Bullet('② 最后那三个"待拍板"的空填一下（见第五节）；'));
doc.push(Bullet('③ 回一句"可以交"，我再往平台上填。**在你回话之前我不会提交任何东西。**'));
doc.push(Blank());
doc.push(Note('附件「展示页 zip」是平台**必交**项，缺它整次提交交不上去 —— 已经做好了，在 00_交作业\\中期汇报_展示页.zip（353 KB，14 页，双击 index.html 就能播）。'));

/* ---------------------------------------------------------------- 第一问 */
doc.push(H1('一、进度说明（必答）'));
doc.push(P('平台要求原文：做完了什么，现在能不能在本地跑起来，接下来做什么、预计什么时候做完。', { size: 9.5, color: '8A5A00', indent: 180, after: 120 }));

doc.push(H2('1. 做完了什么'));
doc.push(Body('场景确认时我们交的是"打算做"，现在交的是"已经能跑"。'));

doc.push(H3('① 一条完整流水线通了：输入 6 位基金代码 → 出全套交付物'));
doc.push(Body('双击 启动_基金复诊台.bat（Windows）/ 启动_基金复诊台.command（macOS），浏览器自动打开本地页面，输入基金代码 + 自己的大模型 API Key，点两下：'));
doc.push(Bullet('第一下「开始复盘」= 探路（约 0.5 秒）：只抓基金概况、历任经理、报告期网格，然后把 SOP 的八格口径确认表填好候选值摆出来；'));
doc.push(Bullet('人确认或改口径 → 第二下「按此口径开跑」（约 10 秒）：跑完整条流水线。'));
doc.push(Body('产出 9 件：复盘报告 · 对外版 · 演示稿（模板版）· 演示稿（AI 深度版）· 两个 PDF · 结论卡 · 错误检查记录 · 来源清单 · 底稿。'));

doc.push(H3('② 6 只基金实跑，换基金不用改一行代码'));
doc.push(TBL(
  ['#', '代码', '基金 / 经理', '区间', '报告期', '官方 PDF 逐行对账', '区间收益', '形态标签'],
  [
    ['1', '519191', '万家新利 / 黄海', '2020Q4–2026Q2', '23', '4/4 期一致·40 行·最大差 0.000pp', '+76.80%', '逐步分散型'],
    ['2', '005827', '易方达蓝筹精选 / 张坤', '2018Q4–2026Q1', '30', '4/4 期一致·40 行', '+86.46%', '低换手长期持有型'],
    ['3', '090007', '大成策略回报 / 徐彦', '2020Q1–2026Q2', '26', '4/4 期一致·40 行', '+112.52%', '主题漂移型'],
    ['4', '021967', '西部利得均衡优选 / 董伟炜', '2025Q1–2026Q2', '6', '5/6 期一致·60 行', '+123.24%', '高频轮动型'],
    ['5', '005825', '申万菱信智能驱动 / 卜忠林', '2026Q1–2026Q2', '2', '2/2 期一致·20 行', '+135.52%', '样本不足（2 期）'],
    ['6', '014564', '天弘创新药精选50ETF联接 / 贺雨轩', '2023Q2–2026Q2', '13', '13/13 期不一致（被阻断）', '—', '被阻断']
  ],
  [0.4, 0.8, 2.5, 1.6, 0.7, 2.4, 1.0, 1.4]
));
doc.push(Blank());
doc.push(Body('第 6 只是**特地挑来试错的"联接基金"** —— 数据结构和前 5 只不一样，一跑就出问题。这正是我们要的：工具在没见过的数据形态上自己报了错、拒绝出结论，而不是悄悄产出一份看起来正常的报告。详见第二问第 3 条。'));

doc.push(H3('③ 六类公开来源全部打通（严格按 SOP §2）'));
doc.push(Body('官方定期报告 PDF 为最高权威（巨潮资讯 / 证监会基金信息披露平台 / 基金公司官网 / 东财公告镜像），第三方只做交叉验证（天天基金 F10 的历史前十大、资产配置、规模变动、日频净值、经理履历）。'));
doc.push(Body('对账不是写在文档里的声明，是自动动作：自动挑首季、末季、每 4 季抽样，下载官方 PDF、抽前十名股票投资明细表，按股票代码与第三方逐行比对（容差 ±0.011pp），结果写进报告与来源清单。本机缺 Poppler 时这一项如实标"未完成"，不假装对过。'));

doc.push(H3('④ AI 模块做完了，而且用真实 API Key 跑过、拦截器真的抓到了错'));
doc.push(Body('分工是"确定性计算归脚本，推理归纳归大模型"：抓取/解析/量化/对账全部走脚本；大模型只做 4 件事（季报言论抽取与结构化 / 行业主题语义归纳 / 言行一致性比对与研判起草 / 报告与演示稿成文）。'));
doc.push(Body('关键是"错了怎么发现"不是设想，是实测。用真实 API Key 完整跑过 2 只基金，校验器抓到过这些：'));
doc.push(TBL(
  ['大模型干了什么', '校验器原话（系统自动生成）'],
  [
    ['编数字（核心判断）', '「数字回查失败，7 个数字在指标包中不存在（疑似编造）：0.25、3.91、130、12.78…」'],
    ['大量编数字（深度报告）', '「39 个数字未能在证据包中找到出处（超过 8 个，判为疑似编造，退回重写）」'],
    ['违反用词红线', '「命中违禁词：高点卖出」'],
    ['主题归类没做完', '「覆盖率仅 0.0%（<95%）：39 只股票未被归类」'],
    ['演示稿数字越界', '「以下数字未在证据包白名单中（可能被改写或臆造）：67.97%、0.25pp…」']
  ],
  [0.9, 3.1]
));
doc.push(Blank());
doc.push(Body('拦截后不是报错结束，而是**降级继续**：规则引擎的结论卡照用、报告照出，只是在质检页明确标出"AI 输出未通过校验，已拦截"。'));

doc.push(H3('⑤ 两处口径错误是工具自己抓出来的，改在代码里，不是改在文档里'));
doc.push(Bullet('收益口径：原来用累计净值算区间收益。累计净值 = 单位净值 + 累计分红，是加法累积量，做比值在数学上无意义。改用分红再投总回报指数，并用官方季报披露的过去三年/五年/七年/十年净值增长率反向校准 —— 平均绝对偏差 15.94pp → 1.07pp。'));
doc.push(Bullet('区间起点：原来取"第一个报告期的期末"，会漏掉第一个季度自己的收益。519191 因此从 +76.77% 虚增到 +85.97%，我们一度把这个错误当成"修正"写进文档；最后是官方逐季披露值把它钉死的（如果是 85.97% 对，每个单季都该比官方高，实测逐季完全吻合）。基准点改为「第一个报告期的期初」后回到 +76.80%，逐季与官方对账 22/22 期、最大偏差 0.01pp。'));
doc.push(Note('这条我们打算在课上讲：工具给出的数字比手工算的更好看时，恰恰是最该怀疑它的时候。'));

doc.push(H3('⑥ 质检页从"请人打勾"改成"直接显示核查了什么"'));
doc.push(Body('原来质检页有：12 处抽检每条挂一个"核完"勾选框、门禁 3 三查三个勾（不勾满就不让导出）、一整套"复制提示词 / 把大模型返回的 JSON 粘回来"的人工中转，公网页面上还有一整块填 API Key 的区域。'));
doc.push(Body('想通的地方是：打勾不产生任何证据 —— 它不改数据、不改报告，只是把导出按钮从灰变亮，证明的是"有人点过鼠标"，不是"有人核过数"；而公网访客也不是这次复盘的负责人。现在改成：18 条质检规则 + 12 处回原文抽检清单实际结算，结果（查了什么 / 查出什么 / 证据在哪 / 哪条不通过）直接显示；导出按钮不再需要先打勾。'));
doc.push(Body('唯一按需保留交互的是没有服务端的离线单文件版 —— 那条路上大模型真的跑不了，"复制提示词 → 去大模型网页版跑 → 粘回来"是唯一的办法，所以它只在那种场合出现。'));
doc.push(Note('这条有测试兜着：tools/test_audit_mode.mjs 同时验"有服务端→整页只读"和"没服务端→保留人工中转"两种形态 —— 只验一种的话，"把交互删干净"和"把功能删干净"看起来一模一样。'));

doc.push(H2('2. 现在能不能在本地跑起来'));
doc.push(Body('能。而且组员电脑上跑过。两条路线：'));
doc.push(TBL(
  ['路线', '怎么开', '依赖', '用途'],
  [
    ['A · 在线模式（推荐）', '双击 .bat（Windows）/ .command（macOS）', 'Node.js + 自己的大模型 API Key', '自动爬取 → 自动出报告与演示稿'],
    ['B · 离线单文件', '双击 基金复诊台_单文件版.html', '零依赖：不用 Node、不用 Key、不联网', '断网/答辩兜底，内置已对过账的样例']
  ],
  [1.3, 2.0, 2.2, 2.0]
));
doc.push(Blank());
doc.push(Body('已验证的平台覆盖：Windows 本机 + 组员 macOS 都跑起来了。macOS 上真实遇到并已修掉的两处环境问题：'));
doc.push(Bullet('找不到 pdftotext（官方 PDF 对账会整段跳过）→ 启动器现在自己补 PATH（Finder 双击的程序不读 ~/.zshrc），缺失时页面直接给出该平台对应的安装命令（macOS：brew install poppler 或 conda install -c conda-forge poppler）；'));
doc.push(Bullet('Safari 长连接中断（跑到"生成深度报告"时页面报 Load failed）→ 服务端加 12 秒心跳防连接被判定为空闲，页面加断线自动恢复（流断了会自己去问结果，跑完自动载入），服务端加全局崩溃兜底（不再静默退出）。'));
doc.push(Body('回归测试：selftest 76/76、smoke_page 37/37、server_http 13/13 全绿。'));

doc.push(H2('3. 接下来做什么、预计什么时候做完'));
doc.push(TBL(
  ['时间', '做什么', '交付 / 验收'],
  [
    ['10/10–10/13', '中期材料定稿；5 分钟讲稿压缩；展示页打成 zip', '平台提交'],
    ['~~10/14–10/20~~ 10/10 已提前完成', '部署到公网 —— 已上线：https://fundclinic.onrender.com（Render 免费档 · Docker 构建）。剩下的是把服务端 Key 值填进平台环境变量、以及手机流量实测截图', '一条可公开访问的链接 + 手机打开截图'],
    ['10/14–10/24', '组员独立复跑 2 只全新基金（不复用任何预置结果，在自己电脑上从零跑），记录卡在哪、花了多久 —— 现在可以直接让组员打开链接跑，不必先装 Node', '《组员复跑记录》：截图 + 耗时 + 卡点清单'],
    ['10/25–11/05', '用结论卡做横向对比页（按形态标签筛选/排序）；补合规与边界页；修 014564 的数据源问题', '网页可横向对比 5–8 只基金'],
    ['11/06–11/10', '15 分钟展示排练（12 分钟讲 + 3 分钟问答），全员上台分工', '终展提交']
  ],
  [1.1, 4.0, 2.2]
));
doc.push(Blank());
doc.push(Body('一句话：功能主线已经跑通，"让别人也能用"这件事也已经落地（已上线），剩下的是"多覆盖几种基金形态"与成本闸门的调优。'));
doc.push(Blank());
doc.push(H2('2.1 公网部署：已上线（10/10）'));
doc.push(Body('地址：https://fundclinic.onrender.com（Render 免费档 · 新加坡节点 · Docker 构建）。'));
doc.push(TBL(
  ['项', '状态'],
  [
    ['形态', '发一条链接，访客只输 6 位基金代码；不用装任何东西，也不用 VPN'],
    ['大模型 Key 由谁出', '服务端持有（环境变量 FUNDCLINIC_LLM_KEY），访客不用填'],
    ['官方季报 PDF 逐行对账', '云端可用（镜像里装了 poppler-utils，这是走 Docker 构建的原因）'],
    ['海外机房能否抓国内数据源', '实测能（探路成功拿到基金名与经理），热起来后探路 1–3 秒'],
    ['用量闸门', '每台机器 3 次/小时、8 次/天；全站 40 次/天 —— 防止公开链接被反复点、把 Key 的花费打爆'],
    ['免费档限制', '闲置会休眠；首次请求实测有约 145 秒冷启动惩罚 → 上台前需提前热机'],
    ['云端导出 PDF', '未装 Chromium（演示稿本身是单文件 HTML，打开按 P 就能打印）']
  ],
  [1.6, 5.6]
));
doc.push(Blank());
doc.push(Body('自检脚本 tools/test_deployed.mjs <地址> 会把"首页通不通 / 云端模式识别没有 / poppler 装了没有 / 服务端 Key 配上没有 / 闸门开没开 / 能不能抓到数据源"逐项打出来，不靠肉眼判断。'));
doc.push(Blank());
doc.push(H2('2.2 线上真实跑通（用我们自己的 Key，2026-10-10 实测）'));
doc.push(TBL(
  ['基金', '期数', '耗时', '结果'],
  [
    ['519191 万家新利（黄海）', '23 期', '453 秒', '报告 18.9 KB（十节，编号连续）/ 结论卡 / 质检记录 / 来源清单 43.6 KB / 模板版演示稿 9 页 / AI 深度版演示稿 8 页（含 8 条讲者备注）'],
    ['005825 申万菱信智能驱动（卜忠林）', '9 期', '366 秒', '同样全套交付物，浏览器端完整收到完成事件']
  ],
  [1.9, 0.6, 0.7, 4.0]
));
doc.push(Blank());
doc.push(Body('成本实测：两次跑动共消耗 107,814 token（输入 41,960 / 输出 65,854），平均约 5.4 万 token/次。按常见价位（¥2/百万输入 · ¥8/百万输出）折算，单次约 ¥0.3，全站 40 次/天上限约 ¥12/天 —— 比原先担心的低，闸门可按需放宽。'));
doc.push(Body('两条要紧的实测结论：① 一次完整复盘要 6–7.5 分钟（爬取 + 官方 PDF 抽样对账 + 六轮大模型），这对终展现场演示是硬约束 —— 15 分钟里不可能干等，建议开场就先点一下跑起来、边讲边等，或者用"提前跑好 + 当场下载"的方式展示。② 浏览器那条流可能在 7.5 分钟左右被平台掐断，但服务端照常跑完并落盘，页面的"断线自动恢复"会把它捞回来（这套机制当初是为 Safari 长连接做的，在云端同样救了一次）；演示时如果看到 Load failed，不要重跑，等十几秒页面会自己载入结果。'));

/* ---------------------------------------------------------------- 第二问 */
doc.push(H1('二、主要问题（必答）'));
doc.push(P('平台要求原文：卡在哪里，需要什么帮助。', { size: 9.5, color: '8A5A00', indent: 180, after: 120 }));

doc.push(H2('1. 公网部署 —— 已解决（10/10 上线），但冒出一个新的真问题：谁来兜住 Key 的花费'));
doc.push(Body('原来卡在哪：GitHub 与云平台账号要实名，得组内定人注册。10/10 已解决：代码推到 GitHub → Render 读 render.yaml 蓝图一键建服务 → 拿到公网地址。'));
doc.push(Body('过程中真实踩到两个坑（都已修进仓库配置）：① 启动器 .command 会被 Git 转成 CRLF，macOS 组员双击直接报错 → 加 .gitattributes 钉死 LF 与可执行位 755；② render.yaml 里必须声明 FUNDCLINIC_LLM_KEY（sync: false），否则在 Render 面板手填的 Key 每次重新部署都可能被蓝图覆盖 —— 表现是"我明明填过，怎么又提示要 Key"。'));
doc.push(Body('新冒出来的问题（这才是现在最该讨论的）：形态从"每人自备 Key"变成"服务端持有我们的 Key"之后，Key 就是任何点开链接的人都能花的钱。所以加了用量闸门：每台机器 3 次/小时、8 次/天，全站 40 次/天；被拦时返回一句中文原因，页面上也会提前显示"今天还剩几次"。'));
doc.push(Body('需要什么帮助：① 想确认课堂上对"部署到公网"是否有额外要求（是否必须挂某个域名/服务器、是否涉及备案）；② 全站每天 40 次这个数该定多少 —— 我们按"一次完整复盘要调好几轮大模型"估的，真实单价要看模型方计价，/api/health 里已能看到当日 token 累计，跑几只后会有真实数字再调。'));
doc.push(Body('影响：中期演示不受影响；终展若要现场跑，注意免费档闲置休眠、唤醒约 50 秒（首次请求实测有约 145 秒冷启动惩罚），需提前热机。'));

doc.push(H2('2. 大模型的 Key 与花费（形态已从"每人自备"改成"站方出"）'));
doc.push(Body('卡点：AI 模块是必选（主题归类没有公开接口可替代）。为满足"发条链接谁都能用"，现在 Key 放在服务端环境变量里，访客不用填；代价是成本完全由我们承担，所以必须有闸门（见上一条）。'));
doc.push(Body('已经做掉的：服务端 Key 通道 + 三道用量闸 + 页面剩余额度提示 + /api/health 的 token 记账。页面形态也跟着改了 —— 服务端持有 Key 时，整块"填 API Key"的表单会被收掉，访客只看到「① 基金代码 / 抓取年数 / ② AI 模块状态」和一个按钮；按钮的可用条件也从"填了 Key"变成"6 位代码填对"。'));
doc.push(Body('需要什么帮助：如果课上要现场演示"输入代码 → 自动出报告"，希望提前确认是否允许用我们的 Key 公开跑。如果不允许，备用形态是离线单文件版（不用 Key、不用网）兜底；以及"访客自带 Key"模式（代码已支持，改一个环境变量即可切换）。'));

doc.push(H2('3. 第三方数据源没有承诺，换个基金就可能换一套坑（真实踩到）'));
doc.push(Body('卡点：天天基金的持仓接口是网页接口，没有官方 SLA，改版/换结构就会失效。我们不是"假设"它会出问题 —— 第 6 只基金（014564，联接基金）就出问题了：'));
doc.push(TBL(
  ['', '具体'],
  [
    ['现象', '第三方持仓权重串列：2023Q2 排名第 1 的康宁杰瑞写 1.89%、排名第 2 的药明康德写 60%；前十合计 192.89%（2024Q3 是 373%）'],
    ['工具的反应', '质检 A1（单股 ≤10%）判 fail：「96 条超 10.5%，幅度过大，权重口径很可能不是"占净值比"（也可能是数据串列）」；B2（前十合计 ≤100%）判 fail：「12 期超过 100%，逻辑上不可能」；官方 PDF 对账独立报出 13/13 期不一致（官方 0.6% vs 第三方 60%）；最终裁决 fail：2 项必须处理（阻断）'],
    ['现状', '已确认是第三方接口在这个基金上的数据串列/量纲问题，尚未定位到具体哪一列，这只基金暂时不纳入正式交付']
  ],
  [1.0, 3.0]
));
doc.push(Blank());
doc.push(Body('需要什么帮助：如果有同学做过网页接口的稳定性兜底，想请教两点：① 有没有更好的"字段自检"思路（我们现在靠"前十合计 >100% 就报警"这类逻辑不可能检测，还想再加）；② 联接基金/ETF 这类特殊结构的基金，公开季报里前十大该怎么取才对。'));

doc.push(H2('4. 方法本身有一条边界，想请教怎么补'));
doc.push(Body('卡点：公募季报只披露前十大持仓，而且是期末快照 —— 期间怎么买卖是看不见的。这决定了我们只能做"期末结构 + 前后两期对比"，做不了"真实换手"。我们在每份报告里都明确写了这条边界，但想说清"我不知道什么"的同时，也想知道有没有公开数据能补。'));
doc.push(Body('需要什么帮助：中报/年报披露全部持仓（不止前十）这一点我们知道；想请教的是——有没有公开渠道能拿到季报之外更像"过程"的证据，或者有没有公认的做法来处理"期末快照"这个局限。'));

doc.push(H2('5. 5 分钟怎么分给全组'));
doc.push(Body('卡点：中期是全员上台、每组 5 分钟。4 个人分 5 分钟，如果每人讲一段功能清单，很容易讲成"我们做了 abcdefg"，反而讲不出重点。'));
doc.push(Body('需要什么帮助：想请老师给个建议的节奏 —— 我们暂定的是「痛点 30 秒 → 现场演示 2 分钟（占大头）→ AI 模块 1 分钟 → 结果与下一步 1.5 分钟」，把"讲功能"压到最短，把"演示"和"AI 模块怎么防错"放大。'));

/* ---------------------------------------------------------------- 第三问 */
doc.push(H1('三、和场景确认时比，改了什么，为什么（选答，我们填了）'));
doc.push(P('平台要求原文：没改就留空。', { size: 9.5, color: '8A5A00', indent: 180, after: 120 }));
doc.push(Body('场景确认（9/22 提交）定的是"做一个报告或材料自动生成的网页项目"。之后每一条修改都在往同一个方向拧：'));
doc.push(P([{ t: '从"一个能出报告的网页" → "一个别人电脑上不用装任何东西、点开就能用、而且自己会发现自己算错的东西"。', bold: true, size: 11.5, color: '1F3864' }], { indent: 180, before: 120, after: 120 }));
doc.push(TBL(
  ['#', '改了什么', '为什么（都是跑出来的理由，不是偏好）'],
  [
    ['1', 'AI 模块：可选 → 必选', '主题归类没有公开接口可替代（天天基金、巨潮都不给"主题"字段）。缺了它，"主题坚守型/主题漂移型"两条形态规则直接跳过：实测 519191 缺主题只能判成"逐步分散型"，补上才判出"主题坚守型"。'],
    ['2', '加"探路 → 口径确认表 → 开跑"两阶段', 'SOP §0 原话是「任何一格留空不许开跑」。原版靠 AI 口头问，现在把候选值摆出来让人点。现实价值在共管期：005827 现任经理 2026-05-23 才接手（仅 1 期），引擎建议改用张坤那一任（30 期），但最终由人拍板，不再偷偷替你换。'],
    ['3', '演示稿：1 份 → 2 份，新增 AI 深度版', '第一版版式写死、只把数字填进槽位，9 页长得一样、一眼是报表。现在大模型先分镜、再逐页单独成文（页数由内容决定，每页标题是一句主张）。保底：大模型失败时深度版跳过、模板版照常产出。'],
    ['4', '交付形态：发压缩包 → 发一个文件', '组员在 macOS 上双击 .bat 打不开（.bat 是 Windows 专用）。现在三件套：Windows .bat/.cmd、macOS .command（LF 换行 + 无 BOM + 可执行位 755，且启动时自己补 PATH），以及零依赖单文件 HTML。'],
    ['5', '报告与演示稿改成"能直接发给别人"', '原版引用网络字体和外部资源，发到别人电脑上就散架。现在单文件 HTML（全内联、断网可看）、字体换本机字体栈、删掉会在 PDF 里渲染成空白的渐变字，另出 PDF 可直接发微信。'],
    ['6', '收益口径与区间起点都改了', '累计净值是加法量、做比值无意义（改分红再投指数，偏差 15.94pp → 1.07pp）；起点取"期末"会漏掉第一个季度（519191 从 76.77% 虚增到 85.97%，改"期初"后回到 76.80%，逐季对账 22/22 期）。'],
    ['7', '新增（已完成）：从"本地点开"改成"公网链接人人可点"', '原计划 10/20 前上线，实际 10/10 就上线了：https://fundclinic.onrender.com（Render 免费档 · Docker 构建）。访客只输 6 位基金代码，不用装 Node、不用 VPN；大模型 Key 由服务端持有。同时加了用量闸门（每台 3 次/小时、8 次/天；全站 40 次/天）兜住花费。']
  ],
  [0.35, 1.9, 3.6]
));
doc.push(Blank());
doc.push(Body('没改的（也说一下）：项目名、类型单选、四类目标用户、"脚本算数 / 大模型写字 / 人把关"的分工、三道人机门禁 —— 门禁一条没删（人该定的口径、该拍的判断方向都还在），改的只是形态：从"请你打勾"改成"机器结算 + 结果直接显示"。原因是打勾不产生任何证据 —— 它不改数据、不改报告，只把导出按钮从灰变亮，而公网访客也不是这次复盘的负责人。'));

/* ---------------------------------------------------------------- 附件 */
doc.push(H1('四、附件（平台必交）'));
doc.push(P('平台要求原文：展示页（HTML，打成 zip）—— 网页演示文稿连同图片等素材，整个文件夹打成 zip。课上统一用教师机播放。',
  { size: 9.5, color: '8A5A00', indent: 180, after: 120 }));
doc.push(TBL(
  ['文件', '大小', '说明'],
  [
    ['中期汇报_展示页.zip', '353 KB', '14 页 HTML 展示页（单文件，样式/主题/运行时/截图全部内联）+ 5 分钟讲稿。上传用这个。'],
    ['中期汇报_展示页.pdf', '1.13 MB', '同内容的 PDF 备份。万一教师机浏览器有问题，用 PDF 也能讲完。'],
    ['中期汇报_展示页\\index.html', '501 KB', '解压后的展示页本体。双击就能开，断网也能开，← → 翻页，F 全屏，P 导出 PDF。']
  ],
  [2.0, 0.7, 3.3]
));
doc.push(Blank());
doc.push(Body('已做的校验：14 页逐页机械体检（内容不超出 1280×720、无互相压住、无被剪掉的文字）、零外部链接、零网络字体、打印安全（无渐变字、无危险动画）；PDF 用 pdftotext 回读 —— 14 页、6108 字、关键数字全在；zip 回读校验条目数/重复名/尾部字节，全部通过。'));

/* ---------------------------------------------------------------- 待拍板 */
doc.push(H1('五、需要组员拍板的三件事'));
doc.push(TBL(
  ['#', '事项', '为什么要现在定', '结论（请填）'],
  [
    ['1', '公网部署谁来开账号？', '已解决：账号已开、链接已上线（10/10）。地址发群里，全组都能用，同学也不需要 VPN。', ''],
    ['2', '课堂现场演示用谁的 API Key？', '现在 Key 由服务端持有（已上线就配好了），访客不用填。一次完整跑要多轮大模型，成本按量计；也可以不现场跑，用展示页截图讲（更稳）。演示前记得提前 5 分钟热机 —— 免费档会休眠。', ''],
    ['3', '5 分钟怎么分？', '现在是：① P1–P2 ② P3–P6 ③ P7–P10 ④ P11–P13，P14 全体收尾。讲稿在 zip 里。', '']
  ],
  [0.3, 1.6, 3.0, 1.4]
));

/* ---------------------------------------------------------------- 清单 */
doc.push(H1('六、提交前 60 秒清单'));
for (const t of [
  '三个文本框都填了（第三格不是必答，但我们填了）',
  '附件已上传：中期汇报_展示页.zip，单个 ≤50MB',
  '展示页在教师机上能直接双击打开并翻页（已本机实测）',
  '全文无"马后炮/抄底/逃顶/精准预测/必涨"类词',
  '组员都看过这份稿子（提交即代表全组）',
  '确认是本人操作提交（平台会显示最后是谁改的）'
]) doc.push(Bullet(t));

doc.push(Blank());
doc.push(Small('整理于 2026-10-09 · 第 2 组 · 基金复诊台 FundClinic · 本文件由 tools/make_docx_midterm.mjs 生成'));

function Label2(t) { return P(t, { bold: true, size: 10.5, color: '1F3864', before: 100, after: 40 }); }

/* ------------------------------------------------------------ 打包 docx */
const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${doc.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`;

function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0o644 << 16, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const buf = zip([['[Content_Types].xml', CT], ['_rels/.rels', RELS], ['word/document.xml', DOC]]);
fs.writeFileSync(OUT, buf);

const textLen = DOC.replace(/<[^>]+>/g, '').length;
console.log('写出 ' + OUT);
console.log('  文件大小   ' + (buf.length / 1024).toFixed(1) + ' KB');
console.log('  正文可见字 ' + textLen + ' 字');
console.log('  表格数     ' + (DOC.match(/<w:tbl>/g) || []).length);
console.log('  结构自检   头签名 ' + (buf.readUInt32LE(0) === 0x04034b50 ? '✓' : '✗')
  + ' · zip 条目 ' + buf.readUInt16LE(buf.length - 22 + 10));
