/* pack_showcase.mjs —— 生成"展台版"部署包(纯 Python 薄后端 + 预置复盘结果)
 *
 * 为什么要有它: 展台服务器只跑 Python, 跑不了本项目的 Node 主服务。
 * 这个包提供三件事: 看预置的完整报告 / 「问一句」 / 「横向对比」。
 * 包里绝不含密钥(密钥用 POST /api/secret 设到服务器), 也不含任何 _runs 原始 PDF。
 *
 * 用法: node tools/pack_showcase.mjs [输出 zip 路径]
 * 产物: showcase/static/index.html(由单文件版拷入)、showcase/data/runs/<code>/、以及 zip
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOW = path.join(ROOT, 'showcase');
const OUT_ZIP = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'mf02_py.zip');
const SEED = path.join(ROOT, '_seed');
const CODES = ['519191', '090007'];   // 两只主动基金: 519191(个股稳定+主题切换) / 090007(主题漂移), 形态可对照

const log = (...a) => console.log(...a);
const kb = n => (n / 1024).toFixed(0) + ' KB';

/* 1) 预置结果: analysis / check / fit / 结论卡 / summary —— 只留报告要用的, PDF 与 MD 都不带 */
const RUNS = path.join(SHOW, 'data', 'runs');

/* 交付物: 页面上那排"可下载的交付物"必须真能点开 —— 所以把它们也打进包里,
   但**改名叫 ASCII**(report.md / deck.html …): zip 里的中文条目在不同系统上会乱码,
   原始文件名记进 summary.files[key].name, 下载时用它当文件名。 */
const DELIV = {
  report: /^复盘报告_(?!.*_对外版).*\.md$/,
  reportClean: /^复盘报告_.*_对外版\.md$/,
  deck: /^演示稿_(?!.*深度版).*\.html$/,
  deckT6: /^演示稿_.*深度版\.html$/,
  card: /^结论卡_.*\.json$/,
  check: /^错误检查记录_.*\.md$/,
  sources: /^来源清单_.*\.md$/,
  dataset: /^底稿_.*\.json$/
};

fs.rmSync(path.join(SHOW, 'data'), { recursive: true, force: true });
for (const code of CODES) {
  const src = path.join(SEED, code);
  if (!fs.existsSync(path.join(src, 'analysis.json'))) { log('  ! 跳过 ' + code + '(没有 analysis.json)'); continue; }
  const dst = path.join(RUNS, code);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'analysis.json'), path.join(dst, 'analysis.json'));
  if (fs.existsSync(path.join(src, 'check.json'))) fs.copyFileSync(path.join(src, 'check.json'), path.join(dst, 'check.json'));
  if (fs.existsSync(path.join(src, 'datasetMeta.json'))) fs.copyFileSync(path.join(src, 'datasetMeta.json'), path.join(dst, 'datasetMeta.json'));
  if (fs.existsSync(path.join(src, 'fit.json'))) fs.copyFileSync(path.join(src, 'fit.json'), path.join(dst, 'fit.json'));

  /* 交付物文件(一个 run 目录里可能有 PDF, 故意不带: 3MB 起, 而且页面文案本来就写着"本站没有无头浏览器") */
  const srcFiles = fs.readdirSync(src);
  const filesDir = path.join(dst, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const fileMeta = {};
  for (const [key, re] of Object.entries(DELIV)) {
    const hit = srcFiles.find(n => re.test(n));
    if (!hit) continue;
    const ext = path.extname(hit);
    const outName = key + ext;
    fs.copyFileSync(path.join(src, hit), path.join(filesDir, outName));
    fileMeta[key] = { name: hit, file: outName, bytes: fs.statSync(path.join(filesDir, outName)).size };
  }

  /* summary: 前端"复盘完成"卡要用(code/name/range/quarters/formTag/check/perf/aiLog…) */
  const run = JSON.parse(fs.readFileSync(path.join(src, 'run.json'), 'utf8'));
  const summary = run.summary || {};
  /* 盘上那份 summary 里 files[].path / pdf.path 是**本机绝对路径**(C:\\Users\\...):
     直接下发等于把电脑上的目录结构发到公网。这里统一换成"只有名字和大小"。 */
  summary.files = fileMeta;
  summary.pdf = null;                    // 没带 PDF → 前端的文案会自动说"本站不提供 PDF"
  if (summary.deckT6 && !fileMeta.deckT6) summary.deckT6 = null;
  const leak = /[A-Za-z]:\\\\|[A-Za-z]:\\/;
  if (leak.test(JSON.stringify(summary))) {
    console.error('!! summary 里还有本机绝对路径, 不能上传');
    process.exit(1);
  }
  fs.writeFileSync(path.join(dst, 'summary.json'), JSON.stringify(summary, null, 1), 'utf8');
  const size = fs.readdirSync(dst).reduce((s, f) => {
    const p = path.join(dst, f);
    return s + (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((a, g) => a + fs.statSync(path.join(p, g)).size, 0) : fs.statSync(p).size);
  }, 0);
  log('  预置 ' + code + '  ' + (fs.readdirSync(dst).length + fs.readdirSync(filesDir).length) + ' 个文件 · ' + kb(size) +
    ' · 交付物 ' + Object.keys(fileMeta).join('/'));
}

/* 2) 静态页: 用最新单文件版(内联了全部 JS/CSS, 前端一行不用改就知道怎么调这些接口) */
const SINGLE = path.join(ROOT, '基金复诊台_单文件版.html');
if (!fs.existsSync(SINGLE)) { console.error('缺 基金复诊台_单文件版.html, 先跑 tools/build_standalone.mjs'); process.exit(1); }
fs.mkdirSync(path.join(SHOW, 'static'), { recursive: true });
fs.copyFileSync(SINGLE, path.join(SHOW, 'static', 'index.html'));
log('  静态页 index.html  ' + kb(fs.statSync(path.join(SHOW, 'static', 'index.html')).size));

/* 3) 密钥闸门: 包里出现 sk- 串会被展台整包拒收(而且真泄露)
      —— 这里先自己查一遍, 别等服务器来拒 */
const skRe = /sk-[A-Za-z0-9_-]{10,}/g;
const offenders = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'data' || !p.includes('runs')) walk(p); else walk(p); continue; }
    if (!/\.(py|json|html|txt|json)$/i.test(e.name)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    const m = txt.match(skRe);
    if (m) offenders.push(path.relative(SHOW, p) + ' × ' + m.length);
  }
};
walk(SHOW);
if (offenders.length) {
  console.error('\n!! 包里发现疑似 API 密钥串, 不能上传: ' + offenders.join('; '));
  process.exit(1);
}
log('  密钥扫描  0 处 sk- 串');

/* 4) 打包: zip 根目录直接是 deploy.json
   ⚠️ 临时目录必须放在系统临时区, 不能放在项目目录下 —— 项目路径里有中文("基金复盘_小组作业"),
      而 Windows 的 tar.exe 在中文 cwd 下会打不开输出文件(踩过一次, 报 "Failed to open")。 */
const TMP = path.join(os.tmpdir(), 'fc_show_pack');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
/* 逐文件拷贝。
   ⚠️ 不要用 fs.cpSync 递归拷目录: Node 24 + Windows 上它会以 0xC0000409 直接崩掉进程
      (本项目在 _seed 拷贝上已经踩过一次, 这里再踩一次)—— 崩得没有 stack, 只看到 exit 1。 */
function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) copyTree(path.join(src, e), path.join(dst, e));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
for (const name of ['deploy.json', 'app.py', 'asksvc.py', 'comparesvc.py', 'requirements.txt', 'static', 'data']) {
  const s = path.join(SHOW, name);
  if (!fs.existsSync(s)) continue;
  copyTree(s, path.join(TMP, name));
}
fs.rmSync(OUT_ZIP, { force: true });
/* 显式列文件而不是打 "." —— 打 "." 会让条目带上 "./" 前缀, 展台要求 deploy.json 在最外层 */
const FILES = ['deploy.json', 'app.py', 'asksvc.py', 'comparesvc.py', 'requirements.txt', 'static', 'data']
  .filter(n => fs.existsSync(path.join(TMP, n)));
execFileSync('tar', ['-a', '-c', '-f', OUT_ZIP, ...FILES], { cwd: TMP, stdio: ['ignore', 'inherit', 'inherit'] });
fs.rmSync(TMP, { recursive: true, force: true });

const size = fs.statSync(OUT_ZIP).size;
log('\n  包: ' + OUT_ZIP + '  ' + kb(size) + '  (展台限制 50MB)');
const list = execFileSync('tar', ['-tf', OUT_ZIP], { encoding: 'utf8' }).trim().split('\n');
log('  文件 ' + list.length + ' 个: ' + list.slice(0, 12).join(' ') + (list.length > 12 ? ' …' : ''));
