/* 生成 启动_基金复诊台.bat 与 启动_基金复诊台.cmd —— 字节级精确。
 *
 * 为什么不能直接用编辑器写这个文件(踩过, 差点发出去):
 *   1) .bat 必须是 **CRLF** 换行。用 LF 时 cmd 解析 if(...) 多行块会错乱,
 *      结果把中文提示行当成命令去执行。
 *   2) .bat **不能有 BOM**。带了 BOM 之后第一行变成 "<BOM>@echo off", @echo off 失效,
 *      整个脚本回显成一团, 而且后续行的解析也跟着歪。
 *   3) 内容含中文, 所以要在开头 chcp 65001 切到 UTF-8 —— 但编码必须是"UTF-8 无 BOM",
 *      有 BOM 时 chcp 还没生效就已经读进 BOM 了。
 * 这三条只有字节级控制才靠得住, 所以用 Node 写 Buffer。
 *
 * 为什么同时出一份 .cmd(真实踩到):
 *   组员机器上装了 Geany, 它把 **.bat 的文件关联抢走了** —— 双击 bat 不是执行,
 *   而是用 Geany 打开源码。这不是包的错, 但对方会一脸懵。
 *   .cmd 和 .bat 是同一类批处理, 关联却是**分开的**, Geany 抢了 .bat 未必抢 .cmd。
 *   两份内容完全一样, 哪份能双击就用哪份, 等于给对方一个免费的后备入口。
 *
 * 用法: node tools/make_bat.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = '启动_基金复诊台';
const OUTS = ['bat', 'cmd'].map(ext => path.join(ROOT, `${BASE}.${ext}`));

const LINES = [
  '@echo off',
  'chcp 65001 >nul',
  'title 基金复诊台 FundClinic',
  'cd /d "%~dp0"',
  '',
  'echo.',
  'echo   基金复诊台 FundClinic',
  'echo   ============================================',
  '',
  'rem ---- 检查 1: 有没有装 Node ----',
  'where node >nul 2>nul',
  'if errorlevel 1 goto NO_NODE',
  '',
  'rem ---- 检查 2: 是不是只把 bat 单独拷出来了 ----',
  'if not exist "server.mjs" goto NO_FILES',
  '',
  'echo.',
  'echo   正在启动本地服务, 稍等 2-3 秒会自动打开浏览器...',
  'echo   如果浏览器没有自动打开, 请看下面窗口里打印的地址, 手动访问。',
  'echo   关闭本窗口即停止服务。',
  'echo.',
  '',
  'rem 浏览器由服务端在 listen 成功之后自己打开 —— 端口被占而顺延时,',
  'rem 打开的仍然是真实端口, 不会出现"打开了却是空白页"。',
  'set FUNDCLINIC_OPEN=1',
  'node server.mjs',
  'goto END',
  '',
  ':NO_NODE',
  'echo.',
  'echo   [缺少 Node.js] 没有找到 node 命令。',
  'echo.',
  'echo   这个工具需要一个本地 Node 服务来抓取公开数据,',
  'echo   因为浏览器直接抓天天基金 / 东方财富会被跨域安全策略拦住。',
  'echo.',
  'echo   安装方式:',
  'echo     1. 打开 https://nodejs.org',
  'echo     2. 下载 LTS 版本, 一路"下一步"装完',
  'echo     3. 关掉这个窗口, 重新双击本文件',
  'echo.',
  'echo   装好之后不需要再做任何配置。',
  'echo.',
  'pause',
  'goto END',
  '',
  ':NO_FILES',
  'echo.',
  'echo   [文件不完整] 本目录下找不到 server.mjs。',
  'echo.',
  'echo   这个 bat 只是启动器, 它需要和整个项目文件夹放在一起。',
  'echo   请不要把 bat 单独复制出来 一一 请把整个文件夹一起拷过去,',
  'echo   或者解压收到的压缩包, 再双击里面的本文件。',
  'echo.',
  'pause',
  'goto END',
  '',
  ':END',
  ''
];

/* CRLF + UTF-8 无 BOM。两份内容完全一样, 只差扩展名。 */
const buf = Buffer.from(LINES.join('\r\n'), 'utf8');
for (const o of OUTS) fs.writeFileSync(o, buf);

/* 自检: 把字节事实摆出来, 不靠"应该没问题" */
let allOk = true;
for (const o of OUTS) {
  const b = fs.readFileSync(o);
  const head = b.subarray(0, 6);
  const crlf = (b.toString('latin1').match(/\r\n/g) || []).length;
  const loneLf = (b.toString('latin1').match(/(?<!\r)\n/g) || []).length;
  const ok = head[0] !== 0xEF && loneLf === 0 && crlf > 20 && b.toString('utf8').startsWith('@echo off');
  if (!ok) allOk = false;
  console.log('\n写出 ' + o);
  console.log('  字节数           ' + b.length);
  console.log('  首 6 字节        ' + [...head].map(x => x.toString(16).padStart(2, '0')).join(' '));
  console.log('  有 BOM(EF BB BF) ' + (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF ? '有 !! 必须去掉' : '无 ✓'));
  console.log('  首行             ' + JSON.stringify(b.toString('utf8').split('\r\n')[0]));
  console.log('  CRLF 数          ' + crlf);
  console.log('  裸 LF 数         ' + loneLf + (loneLf ? '  !! 必须为 0' : '  ✓'));
  console.log('  含中文           ' + /[\u4e00-\u9fa5]/.test(b.toString('utf8')) + ' ✓ (配合 chcp 65001)');
  console.log('  与另一份一致     ' + b.equals(buf) + ' ✓');
}
console.log(allOk ? '\n字节级检查通过(bat 与 cmd 两份)。' : '\n!! 检查未通过');
