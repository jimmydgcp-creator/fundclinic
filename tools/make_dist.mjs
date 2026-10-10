/* 打一个可以直接发给组员的包。
 *
 * 为什么需要它: 启动_基金复诊台.bat 只是启动器, 它 cd 到自己所在目录再 node server.mjs ——
 * 单独把 bat 发出去, 对方双击只会报错。必须把运行时要用的文件一起打包。
 *
 * 打什么进去: 只打"跑起来需要的"。**不带任何跑好的结果** —— 这个包是让组员现场自己跑的,
 * 带上你跑过的记录, 一来对方会以为只能照着看, 二来会把你的标的和结论一起发出去。
 * 不打: tools/(开发脚本 2.4MB) 和 _runs/ 里的历史结果。
 *
 * 用法: node tools/make_dist.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, '_dist');
const PKG = path.join(OUT, '基金复诊台_发给组员');

const DIRS = ['app', 'data', 'server', 'skills'];
const FILES = ['index.html', 'server.mjs', 'README.md', 'llm.local.json.example', 'package.json',
  '启动_基金复诊台.bat', '启动_基金复诊台.cmd', '启动_基金复诊台.command',
  '基金复诊台_单文件版.html'];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;              // .active-port 之类的运行时文件不打
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* 清空输出目录。
   加 maxRetries: 之前从这个目录里启动过测试服务, 进程没退干净就会占着文件夹,
   Windows 下会直接 EPERM 让整个打包失败(踩过)。退避重试比让用户去猜"谁占用了"友好。 */
try {
  fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (e) {
  console.error('!! 无法清空输出目录: ' + OUT);
  console.error('   ' + e.message);
  console.error('   常见原因: 这个目录里的 server 进程还在跑(比如之前从包里启动过服务),');
  console.error('             或者资源管理器正开着这个文件夹。关掉后重试。');
  process.exit(1);
}
fs.mkdirSync(PKG, { recursive: true });

for (const d of DIRS) {
  const s = path.join(ROOT, d);
  if (!fs.existsSync(s)) { console.error('缺少目录: ' + d); process.exit(1); }
  copyDir(s, path.join(PKG, d));
}
for (const f of FILES) {
  const s = path.join(ROOT, f);
  if (!fs.existsSync(s)) { console.error('缺少文件: ' + f); process.exit(1); }
  fs.copyFileSync(s, path.join(PKG, f));
}
/* 空的 _runs 留着: 服务端启动和运行结果都往这里写, 没有会报错。 */
fs.mkdirSync(path.join(PKG, '_runs'), { recursive: true });

/* 「为什么要做这个」从项目里的 项目缘起_*.txt 读进来, 合并进《先读我》。
   单一来源: 想改理由就改那个 txt, 重跑打包即生效, 不会出现两份说法不一致。
   文件不在也不该让打包失败 —— 缺了就少印一节, 但要说清楚。 */
const RATIONALE_FILE = path.join(ROOT, '项目缘起_为什么做基金复诊台.txt');
let RATIONALE = '';
if (fs.existsSync(RATIONALE_FILE)) {
  let body = fs.readFileSync(RATIONALE_FILE, 'utf8').replace(/\r\n/g, '\n');
  /* 掐掉原标题**连同它下面那行 ===== 下划线**(只删标题行会剩下一条孤立的分隔线),
     以及结尾的落款 —— 在这个新语境里都是重复的。 */
  body = body
    .replace(/^基金复诊台 · 为什么要做这个\s*\n=+\s*\n/, '')
    .replace(/\n-{10,}\s*\n\s*基金复诊台 FundClinic\s*$/, '')
    .trim()
    .replace(/\n{4,}/g, '\n\n\n');
  RATIONALE = body;
} else {
  console.warn('!! 没找到 ' + RATIONALE_FILE + ' —— 包里那份《为什么要做这个.txt》会是空的');
}

const README = `基金复诊台 FundClinic · 怎么用
====================================================

输入 6 位基金代码 → 自动抓公开数据 → 出复盘报告 + 演示稿。
全部在本机跑, 只监听 127.0.0.1, 数据只存在这个文件夹里。

这份文件只讲**怎么跑起来**。想知道这工具是干什么的、为什么做,
看同目录的《为什么要做这个.txt》—— 不急, 跑通了再看也不迟。


⚠️ 先看你在哪个系统上 —— 两边的启动文件**不一样**, 互相不能通用:

  Windows   →  启动_基金复诊台.bat   (或 .cmd)
  macOS     →  启动_基金复诊台.command
  iPad/手机 →  只能看 基金复诊台_单文件版.html (见下面"关于 iPad / 手机")

.bat / .cmd 是 Windows 专有格式, 在 Mac 上双击只会用文本编辑器打开它 ——
那不是出错, 是文件类型不对。


────────────────────────────────────────
第一步 · 装 Node.js (只做一次, 5 分钟)
────────────────────────────────────────

Windows:
  1. 打开 https://nodejs.org
  2. 下载 LTS 版本(左边那个绿色按钮), 一路"下一步"装完
  3. 装完不用做任何配置

macOS:
  方法一(推荐, 不用命令行):
    打开 https://nodejs.org, 下载 LTS 版的 .pkg 文件, 双击一路"继续"装完
  方法二(装了 Homebrew 的话):
    打开"终端", 输入:  brew install node

已经有 Node 的跳过这步。


────────────────────────────────────────
第二步 · 双击启动
────────────────────────────────────────

Windows: 双击 "启动_基金复诊台.bat"

macOS:   双击 "启动_基金复诊台.command"

双击后:
  · 会弹出一个终端窗口(这是本地服务, 别关它, 关了服务就停了)
  · 2-3 秒后浏览器自动打开页面
  · 如果浏览器没自动打开, 看窗口里打印的地址, 手动访问

⚠️ 如果双击之后**打开的是文本编辑器** —— 说明用错了系统的启动文件。
   Windows 用 .bat, Mac 用 .command, 别弄混。

⚠️ macOS 上如果提示"无法打开, 因为无法验证开发者"或"无法执行该文件":
   这是因为压缩包在传输中丢了可执行权限, 或者被系统隔离了。
   打开"终端", 输入 chmod +x 然后按空格, 把 "启动_基金复诊台.command"
   从访达拖进终端窗口, 回车。之后双击就正常了。

   或者干脆不走双击, 直接在终端里跑(最可靠):
     1. 打开"终端"
     2. 输入 cd 然后按空格, 把**整个文件夹**从访达拖进终端窗口, 回车
     3. 输入 node server.mjs 回车


────────────────────────────────────────
第三步 · 填一次 API Key (只做一次)
────────────────────────────────────────

页面上有一个 API Key 输入框, 粘贴进去即可。之后浏览器会记住, 下次不用再填。

Key 从哪来(几分钟就能申请好):
  1. 打开 https://platform.deepseek.com 注册/登录
  2. 左侧 "API Keys" → 新建 → 复制那串 sk- 开头的字符
  3. 粘贴到页面的 API Key 输入框

页面里默认已经填好了, 不用改:
  Base URL = https://api.deepseek.com
  模型     = deepseek-v4-flash

为什么必须要有 Key:
  · "主题归类"这一项没有公开接口可替代(天天基金不提供"主题"字段),
    没有它, 形态库里的"主题坚守型 / 主题漂移型"两条规则会直接跳过, 结论会明显变弱。
  · 深度报告和深度演示稿都是大模型写的, 但全文每个数字都要能回查到证据包, 编造即退回。

Key 只在本次请求里用一次, 不落盘、不进日志、不外传。


────────────────────────────────────────
第四步 · 开始复盘
────────────────────────────────────────

1. 输入 6 位基金代码(例如 519191)
2. 点「开始复盘」→ 先"探路", 约 0.5 秒
3. 页面会让你确认一张表: 复盘哪一任经理、哪个区间、数据截止日、业绩比较基准…
   (这是复盘流程要求的, 任何一格留空不许开跑。表已自动填好候选值, 你看一眼或改)
4. 点「按此口径开跑」
5. 交付物: 复盘报告 / 深度报告 / 两份演示稿 / PDF / 结论卡 / 错误检查记录 / 来源清单

跑完的东西存在本文件夹的 _runs/<基金代码>/ 里, 页面顶部「最近的复盘记录」也能再打开。


⚠️ 跑的时候有两件事要知道, 不然会以为它卡死了:

  · **时间不固定**。没装 Poppler 时十几秒就跑完; 装了 Poppler 要做官方 PDF
    逐行对账, 再加上大模型深度报告和演示稿, 跑几分钟很正常。

  · **中间会有很长一段时间窗口不动**。最典型的是"深度复盘报告"那一步 ——
    大模型在写一篇几千字的报告, 期间**没有任何新日志**。这不是卡死。
    工具每 12 秒会给浏览器发一次心跳维持连接, 你什么都不用做。

  · 这段时间**不要关那个终端窗口, 也不要刷新浏览器**。让它跑完。

  · 如果你看到页面弹出「连接中断, 但结果已生成 —— 已自动载入」:
    说明连接被浏览器掐了(常见于 Safari), 但服务端其实已经跑完,
    工具会自动把结果捞回来给你。**不用重跑。**


────────────────────────────────────────
可选 · 装上这个, 报告质量会明显不同
────────────────────────────────────────

官方定期报告 PDF 是最高权威来源。工具会用 pdftotext 把 PDF 转文本,
再和第三方平台的持仓逐行对账(排名 / 名称 / 权重 ±0.01), 对不上的以官方为准并记下差异。

没装 pdftotext 也能跑, 只是这一步会跳过, 报告里会如实写"未完成"。

Windows 装法 —— PowerShell 里执行:
    winget install oschwartz10612.Poppler

macOS 装法 —— 终端里执行(需要先装 Homebrew):
    brew install poppler

装好后重启一次服务, 看窗口里那行:
  pdftotext ✓ 可用(官方 PDF 逐行对账已启用)

演示稿导出 PDF 用的是 Edge/Chrome:
  Windows  自带 Edge, 不用管
  macOS    装了 Chrome 或 Edge 就能导出; 没装也不影响, 用浏览器打开演示稿按 P 自己打印


────────────────────────────────────────
关于 iPad / 手机
────────────────────────────────────────

这个工具有一个本地服务, 而 iPad / iPhone 上**装不了也跑不了 Node 服务**,
所以完整功能只能在 Windows 或 Mac 电脑上用。

iPad / 手机上能用的是这一个:

    基金复诊台_单文件版.html

把它发到 iPad(微信/AirDrop/网盘都行), 用 Safari 打开即可。
不需要 Node、不需要联网、不需要 API Key, 里面内置了几只样例基金,
能看到: 报告长什么样、质检在查什么、演示稿的版式与主题切换。

它是**看**用的, 不能抓新数据、不能出新的基金报告。


────────────────────────────────────────
常见问题
────────────────────────────────────────

Q: 页面跳出 "Load failed"(或 "Failed to fetch")
A: 这句**不是本工具报的错**, 是浏览器在说"我跟本地服务的连接断了"。
   常见于 Safari —— 跑深度报告时会有较长一段没有新日志, 浏览器会自己把连接掐了。
   先别重跑, 按顺序试:
     1. 刷新一下页面, 看顶部「最近的复盘记录」里有没有刚才那只基金;
        有就点「载入」—— 服务端多半已经跑完并且落盘了。
     2. 新版会自动做这一步, 页面会直接提示"连接中断, 但结果已生成 —— 已自动载入"。
     3. 还是不行的话, 看跑服务那个终端窗口: 里面若有红色报错就截图发我。
        完整堆栈也会写进 _runs/_server-error.log, 把那个文件一起发我。

Q: 窗口半天没动静, 是不是卡死了
A: 大概率不是。最慢的一步是"深度复盘报告" —— 大模型在写几千字,
   期间没有任何新日志, 停一两分钟是正常的。工具每 12 秒会发一次心跳维持连接。
   这段时间别关窗口、别刷新。真出问题的话会看到红字报错, 不会静悄悄地死。

Q: 报告里「官方季报逐行对账」那一栏是空的
A: 说明本机没装 pdftotext(Poppler), 官方 PDF 解析不了, 这一步被跳过了。
   报告里会如实写"未完成", 不会假装对过账。装上就能用:
     Windows(PowerShell):  winget install oschwartz10612.Poppler
     macOS(终端):          brew install poppler
   装完重启一次服务, 看窗口里那行是不是变成了
     pdftotext ✓ 可用(官方 PDF 逐行对账已启用)

Q: 出错了想知道到底哪一步断的
A: 看两个地方:
     · 跑服务那个终端窗口(报错和堆栈都打在这里)
     · 文件夹里的 _runs/_server-error.log(服务端未捕获错误的完整堆栈)
   把这两个发我, 比描述现象有用得多。

Q: 双击启动文件, 结果打开了 Geany / 记事本 / 某个编辑器
A: 你用的是另一个系统的启动文件。Windows 要 .bat, macOS 要 .command,
   两者互不通用 —— .bat 在 Mac 上永远只会被当文本打开。

Q: 双击 bat 闪一下就没了
A: 说明没装 Node。按"第一步"装好, 关掉窗口重新双击。

Q: macOS 提示"无法执行该文件"或"无法验证开发者"
A: 压缩包传输时丢了可执行权限。终端里跑一次:
     chmod +x (空格) 再把 .command 文件拖进终端, 回车
   或者直接走终端: cd 到文件夹 → node server.mjs

Q: 提示"文件不完整"
A: 你把启动文件单独复制出来了。它只是启动器, 必须和整个文件夹在一起 ——
   不要只转发那一个文件, 要把整个文件夹(或压缩包)发过去。

Q: 浏览器打开了但是空白页
A: 等 2-3 秒刷新一次。如果窗口里显示的地址不是 8787, 就用窗口里那个地址
   (8787 被别的程序占用时, 服务会自动顺延端口, 浏览器打开的仍是对的地址)。

Q: 没有 API Key 能用吗
A: 能打开页面、能看界面, 但跑不出结果 —— 报告和演示稿都要大模型参与。
   想先看看长什么样, 用上面那个"单文件版"。

Q: 会不会把我的东西传出去
A: 不会。服务只监听 127.0.0.1(只有本机能访问), 数据来源全部是公开渠道,
   抓下来的东西只存在这个文件夹的 _runs/ 里。

Q: 怎么卸载
A: 删掉整个文件夹即可, 不留任何残留。

---
整个文件夹可以随意拷贝/转发。

跑通了、想多了解一点的话 ——
同目录下还有一份《为什么要做这个.txt》, 讲这工具是给谁用的、
解决什么问题、以及它**不做什么**(边界在哪)。不看也不影响使用。
`;

/* 为什么做这个 —— 单独一份, 不和"怎么用"混在一起。
   理由: 组员打开包的第一诉求是"怎么跑起来", 把 5000 字的缘起放在开头,
   多数人翻两页就放弃了。分开之后《先读我》只有四五屏, 一屏就能看完步骤。 */
const WHY = `基金复诊台 · 为什么要做这个
====================================================

(这是项目的缘起。急着用工具的可以先跳过, 直接看《★先读我_怎么用.txt》。
 跑通之后有兴趣再回来读, 完全不影响使用。)


${RATIONALE || '(本节缺失 —— 源文件 项目缘起_为什么做基金复诊台.txt 不在)'}


--------------------------------------------------
基金复诊台 FundClinic
`;

/* TXT 是纯文本 —— **加粗** 在记事本/文本编辑里会**原样显示星号**, 不是加粗。
   统一换成中文引号「」, 强调还在, 也不会露出一堆符号。
   放在最后统一处理, 源文件里万一写了 markdown 也不怕漏出去。 */
const txtify = s => String(s).replace(/\*\*([^*\n]+)\*\*/g, '「$1」');

fs.writeFileSync(path.join(PKG, '★先读我_怎么用.txt'), txtify(README), 'utf8');
fs.writeFileSync(path.join(PKG, '为什么要做这个.txt'), txtify(WHY), 'utf8');

/* 统计与自检 */
function walk(p, acc = []) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) walk(q, acc); else acc.push(q);
  }
  return acc;
}
const all = walk(PKG);
const total = all.reduce((a, f) => a + fs.statSync(f).size, 0);

console.log('打包目录: ' + PKG);
console.log('  文件数 ' + all.length + ' · 合计 ' + (total / 1024 / 1024).toFixed(2) + ' MB');

const runsDir = path.join(PKG, '_runs');
const runLeft = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).length : -1;
console.log('  _runs 内容: ' + (runLeft === 0 ? '空(符合预期 —— 不含任何跑好的结果)' : runLeft + ' 项 !! 不应该有'));

const must = ['启动_基金复诊台.bat', '启动_基金复诊台.cmd', '启动_基金复诊台.command',
  'server.mjs', 'index.html', '★先读我_怎么用.txt', '为什么要做这个.txt',
  'app/engine.js', 'app/online.js', 'app/styles.css', 'data/funds.data.js',
  'server/pipeline.mjs', 'server/deckagent.mjs', 'server/sources.mjs', 'server/official.mjs',
  'skills/deck-kit.css', 'skills/html-ppt/assets/base.css', 'skills/html-ppt/assets/runtime.js',
  '基金复诊台_单文件版.html'];
let bad = 0;
for (const m of must) {
  const ok = fs.existsSync(path.join(PKG, m));
  if (!ok) { bad++; console.log('  ✗ 缺失 ' + m); }
}
/* 绝不能把 Key 打进包里。
 * 不能只靠"我记得没放" —— 发出去就收不回来, 所以这里做成硬闸门:
 * 一旦发现 llm.local.json 或任何 sk- 样式的串, 直接抛错中止, 让打包失败。 */
const SECRET_RULES = [
  { id: '真实配置文件 llm.local.json', test: f => /(^|[\\/])llm\.local\.json$/i.test(f) },
  { id: 'sk- 开头的密钥', read: true, re: /sk-[A-Za-z0-9_-]{16,}/ },
  { id: 'apiKey 被赋了非空值', read: true, re: /["']?api_?key["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
  { id: 'Authorization/Bearer 带值', read: true, re: /(?:Authorization|Bearer)["'\s:]+[A-Za-z0-9_.-]{20,}/ }
];
const leaks = [];
for (const f of all) {
  for (const r of SECRET_RULES) {
    if (r.test) { if (r.test(f)) leaks.push({ rule: r.id, file: path.relative(PKG, f) }); continue; }
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const m = r.re.exec(txt);
    if (m) leaks.push({ rule: r.id, file: path.relative(PKG, f), sample: m[0].slice(0, 40) });
  }
}
if (leaks.length) {
  console.error('\n!! 打包中止: 检测到疑似密钥, 绝不能发出去');
  leaks.forEach(l => console.error('   [' + l.rule + '] ' + l.file + (l.sample ? '  → ' + l.sample : '')));
  console.error('   处理: 删掉 llm.local.json(改用页面输入或环境变量), 或把 Key 换成占位符后重跑。');
  process.exit(1);
}

console.log(bad
  ? '\n!! 有 ' + bad + ' 个问题'
  : '\n全部 ' + must.length + ' 个必需文件齐全。密钥扫描 ' + all.length + ' 个文件: 未发现任何 Key ✓');
