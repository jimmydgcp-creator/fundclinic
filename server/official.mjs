/* 官方定期报告通道(SOP §2 第 1 类, 最高权威)。
 *
 * 链路: f10/JJGG 列定期报告 -> pdf.dfcfw.com 取原文 PDF -> pdftotext 抽文本
 *       -> 抽「前十名股票投资明细」表 + 抽「投资策略和运作分析」(经理原话)
 *       -> 与天天基金数据逐行对账(SOP 质检要求: 排名/名称/权重 ±0.01)
 *
 * 实测(2026-09-16, 519191):
 *   40 期定期报告可取; 2026Q2 季报 PDF 525 KB; 前十大表逐行可解析;
 *   经理原话段落可解析。抽出的官方值与人工核对过的底稿完全一致。
 *
 * SOP §已知坑: 不碰 fund.eastmoney.com/gonggao/{code},{AN}.html(空壳 AJAX);
 *             巨潮 static.cninfo.com.cn 以年报为主, 季报优先走 pdf.dfcfw.com。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HJ = { 'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/' };

/* ---------------------------------------------------------- pdftotext */

/** 按当前系统给出**正确的** Poppler 安装命令。
 *
 *  为什么必须分开写(组员真实踩到): 原来这句话把 Windows 的命令写死了 ——
 *  Mac 组员照着敲 `winget ...`, 终端只会回一句 command not found: winget,
 *  然后他就卡住了。**在别人电脑上跑的东西, 不能假设别人用的是 Windows。**
 */
export function popplerInstallHint() {
  switch (process.platform) {
    case 'darwin': return 'brew install poppler';
    case 'win32': return 'winget install oschwartz10612.Poppler';
    default: return 'sudo apt-get install poppler-utils';
  }
}

/** 把安装命令包成一句人话, 连"在哪儿敲"一起说清楚。
 *
 *  macOS 那一段是照着**真实踩坑**写的(组员亲历):
 *   ① 只给 `brew install poppler` 不够 —— Homebrew 会先打印
 *      "==> Would install 40 dependencies for poppler" 再停下问
 *      "Do you want to proceed with the installation? [y/n]"。很多人以为那串列表就是
 *      正在安装, 其实它在**等回答**; 不回答就什么都没装, pdftotext 自然还是没有。
 *   ② 装了 Conda 的人其实有条更省事的路: conda-forge 里的 poppler 同样带 pdftotext,
 *      而且不用跟 Homebrew 那 40 个依赖打交道(新系统上 Homebrew 还可能是不受支持的配置)。
 */
export function popplerInstallNote() {
  const cmd = popplerInstallHint();
  if (process.platform === 'darwin') {
    return '安装方法(二选一): '
      + '① 打开"终端"执行 ' + cmd + ' —— 注意它会先列出要装的依赖, 然后问 '
      + '"Do you want to proceed with the installation?", 这时「要输入 y 再回车」才算真装; '
      + '② 如果你装了 Conda(提示符带 (base)), 更省事: 执行 conda install -c conda-forge poppler '
      + '—— 不用装那几十个依赖。装完重启一次本服务。';
  }
  if (process.platform === 'win32') {
    return `安装方法 —— 打开 PowerShell, 执行: ${cmd}`;
  }
  return `安装方法 —— 打开终端, 执行: ${cmd}`;
}

let PDFTOTEXT_CACHE;
export function findPdftotext() {
  if (PDFTOTEXT_CACHE !== undefined) return PDFTOTEXT_CACHE;
  const cands = [];
  if (process.env.PDFTOTEXT) cands.push(process.env.PDFTOTEXT);

  /* macOS: Homebrew 装完不在 PATH 里也能找到。
     为什么要写死这两个路径: 从 Finder 双击 .command / 从访达启动的进程不会读 ~/.zshrc,
     PATH 里没有 /opt/homebrew/bin, 于是"明明装了却报未找到"。实测组员是 Mac, 这里必须兜住。 */
  cands.push(
    '/opt/homebrew/bin/pdftotext',     // Apple Silicon (M 系列) 的 Homebrew
    '/usr/local/bin/pdftotext',        // Intel Mac 的 Homebrew
    '/opt/local/bin/pdftotext'         // MacPorts
  );

  /* Conda / Miniconda 也要能认出来。
     为什么: 组员机器上装了 Conda(提示符是 `(base)`), 而 conda-forge 里的 poppler
     同样带 pdftotext —— 这是一条**绕开 Homebrew** 的装机路径。
     但 conda 的 bin 目录同样不在 Finder 启动的进程的 PATH 里, 所以必须写死几个常见位置,
     否则"conda install 成功了工具还是说没找到"。 */
  const home = os.homedir();
  if (process.env.CONDA_PREFIX) cands.push(path.join(process.env.CONDA_PREFIX, 'bin', 'pdftotext'));
  for (const d of ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge']) {
    cands.push(path.join(home, d, 'bin', 'pdftotext'));
    cands.push(path.join(home, 'opt', d, 'bin', 'pdftotext'));
  }
  cands.push('/opt/homebrew/Caskroom/miniconda/base/bin/pdftotext');
  cands.push('/usr/local/Caskroom/miniconda/base/bin/pdftotext');

  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(winget)) {
      if (!/Poppler/i.test(d)) continue;
      const base = path.join(winget, d);
      for (const sub of fs.readdirSync(base)) {
        const p = path.join(base, sub, 'Library', 'bin', 'pdftotext.exe');
        if (fs.existsSync(p)) cands.push(p);
      }
    }
  } catch (e) { /* ignore */ }

  cands.push('pdftotext', '/usr/bin/pdftotext');
  for (const c of cands) {
    try {
      if (c.includes(path.sep) && !fs.existsSync(c)) continue;
      execFileSync(c, ['-v'], { stdio: ['ignore', 'ignore', 'ignore'] });
      PDFTOTEXT_CACHE = c;
      return c;
    } catch (e) { /* next */ }
  }
  PDFTOTEXT_CACHE = null;
  return null;
}

/* ------------------------------------------------------ 定期报告清单 */
export function classifyReport(title) {
  if (/第[1-4]季度报告/.test(title)) {
    const q = /第([1-4])季度报告/.exec(title)[1];
    const y = /(\d{4})年/.exec(title);
    return { kind: 'quarterly', period: y ? `${y[1]}Q${q}` : null };
  }
  if (/中期报告|半年度报告/.test(title)) {
    const y = /(\d{4})年/.exec(title);
    return { kind: 'interim', period: y ? `${y[1]}Q2` : null };
  }
  if (/年度报告/.test(title)) {
    const y = /(\d{4})年/.exec(title);
    return { kind: 'annual', period: y ? `${y[1]}Q4` : null };
  }
  return { kind: 'other', period: null };
}

export async function getReportList(code, { pages = 2, pageSize = 40 } = {}) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=${p}&pageSize=${pageSize}&type=3&_=${Date.now()}`;
    const res = await fetch(url, { headers: HJ });
    if (!res.ok) break;
    const j = JSON.parse(await res.text());
    const list = Array.isArray(j.Data) ? j.Data : [];
    if (!list.length) break;
    list.forEach(x => {
      const cls = classifyReport(x.TITLE || '');
      out.push({
        title: x.TITLE, id: x.ID, date: x.PUBLISHDATEDesc || (x.PUBLISHDATE || '').slice(0, 10),
        kind: cls.kind, period: cls.period, code: x.FUNDCODE
      });
    });
    if (list.length < pageSize) break;
  }
  return out;
}

export function reportPdfUrl(id) { return `https://pdf.dfcfw.com/pdf/H2_${id}_1.pdf`; }

export async function downloadReportPdf(id) {
  const res = await fetch(reportPdfUrl(id), { headers: HJ });
  if (!res.ok) throw new Error('官方报告 PDF 取不到: HTTP ' + res.status + ' · ' + id);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('返回的不是 PDF: ' + id);
  return buf;
}

export function pdfBufferToText(buf) {
  const bin = findPdftotext();
  if (!bin) return null;
  const tmp = path.join(os.tmpdir(), 'fc-official-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.pdf');
  const out = tmp.replace(/\.pdf$/, '.txt');
  try {
    fs.writeFileSync(tmp, buf);
    execFileSync(bin, ['-enc', 'UTF-8', '-layout', tmp, out], { stdio: ['ignore', 'pipe', 'ignore'] });
    return fs.readFileSync(out, 'utf8');
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(out); } catch (e) { /* ignore */ }
  }
}

/* ------------------------------------------------ 抽「前十名股票投资明细」 */
/** 官方 PDF 里的股票名称会带内部空格与全角字母, 必须先归一化才能与第三方名称对上。
 *  实测: "万   科Ａ" -> "万科A"; "阳 光 城" -> "阳光城"; "阿里巴巴－Ｗ" -> "阿里巴巴-W"。 */
export function normalizeStockName(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .trim();
}

/** 抽「业绩比较基准」条款。
 *  SOP §0 要求: 基准从季报抄, 且**中途调整过要标注**(基线 002910 就在 2026Q2 调整过)。
 *  实测各季报写法基本一致, 但会被折行截断, 所以要往下接一行。
 *  必须排除 "业绩比较基准收益率为 6.60%。" 这种同前缀的句子 —— 它不是基准条款。 */
export function parseBenchmark(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /业绩比较基准\s*[:：]?\s*(.{4,160})$/.exec(lines[i]);
    if (!m) continue;
    let v = m[1].trim();
    if (/^收益率/.test(v)) continue;                       // "业绩比较基准收益率为…" 不是基准条款
    if (!/指数|中债|国债|存款|活期|％|%|×|\*/.test(v)) continue;
    /* 基准条款以「。」收尾。PDF 转文本时同一行常紧跟相邻表格文字
       (如「…*20%。风险收益特征本基金为混合型基金，在通常情况下其预期风险和预期」),
       不截断的话, 相邻两期会被截到不同长度 → normalizeBenchmark 判不相等 →
       误报「区间内调整过业绩比较基准」, 进而让整节口径说明变成噪声。 */
    const dot = v.indexOf('。');
    if (dot >= 4) v = v.slice(0, dot);
    // 折行截断时往下补(最多两行)
    let j = i + 1, guard = 0;
    while (!/[%％）)]\s*$/.test(v) && j < lines.length && guard < 2) {
      const nx = (lines[j] || '').trim();
      if (!nx || /第\s*\d+\s*页|季度报告|中期报告|年度报告/.test(nx)) break;
      v += nx; j++; guard++;
    }
    return v.replace(/\s+/g, '');
  }
  return null;
}

/** 归一化基准条款, 用于跨期比较: 统一全半角、去掉空格与结尾标点。 */
export function normalizeBenchmark(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
    .replace(/[×xX＊*]/g, '*')
    .replace(/[＋+]/g, '+')
    .replace(/[％]/g, '%')
    .replace(/[。；;，,、]+$/g, '')
    .trim();
}

/** 抽季报 §3.2.1「基金份额净值增长率及其与同期业绩比较基准收益率的比较」表。
 *  这一张表同时给出 ①净值增长率 ③业绩比较基准收益率 —— 年度/季度超额表的全部数据源,
 *  也是 SOP 指定的"绩效总览对照看"的依据。实测 2015–2026 各年写法都能解析。
 *
 *  ⚠ 多份额类别的坑(实测 021967 抓到): 一只基金有 A/C 两类时, 这张表是**两块**,
 *  每块各有一行「过去三个月」。旧实现按行扫描、同名阶段直接覆盖, 结果**静默取到最后一类(通常是 C)**。
 *  后果不是崩溃而是"数字看着像对的": C 类费率更高, 逐季收益比 A 类低约 0.1pp,
 *  于是整张超额表都建立在 C 类数字上, 而报告写的却是 A 类基金。
 *  现在按类别分块解析, 并用基金简称尾字母(…混合A)定位目标类别; 定位不到就取第一类并留下 classFallback 说明。
 */
export function parsePerfTable(text, { shareClass } = {}) {
  if (!text) return null;
  const start = text.search(/基金份额净值增长率及其与同期业绩比较基准收益率的比较/);
  if (start < 0) return null;
  const chunk = text.slice(start, start + 4000);   // 要装得下 A/C 两块, 1400 不够
  const ROW = /^\s*(过去三个月|过去六个月|过去一年|过去三年|过去五年|过去七年|过去十年|自基金合同生效起至今)\s+(-?[\d.]+)%\s+([\d.]+)%\s+(-?[\d.]+)%\s+([\d.]+)%\s+(-?[\d.]+)%\s+([\d.]+)%/;
  const HEAD = /^\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{4,60}?)\s+([A-Z])\s*$/;

  const blocks = new Map();
  const order = [];
  let cur = '_';
  for (const line of chunk.split(/\r?\n/)) {
    const m = ROW.exec(line);
    if (m) {
      if (!blocks.has(cur)) { blocks.set(cur, {}); order.push(cur); }
      blocks.get(cur)[m[1]] = { nav: Number(m[2]), navSd: Number(m[3]), bench: Number(m[4]), benchSd: Number(m[5]), excess: Number(m[6]) };
      continue;
    }
    /* 类别表头形如 "西部利得均衡优选混合 A"; 排除表头行本身(含"阶段/份额净值/增长率/标准差") */
    const h = HEAD.exec(line);
    if (h && !/阶段|过去|份额净值|增长率|标准差|业绩比较|证券投资基金/.test(line)) cur = h[2];
  }

  const classes = order.filter(c => c !== '_' && Object.keys(blocks.get(c)).length);
  if (!classes.length) {
    const rows = blocks.get('_');
    return rows && Object.keys(rows).length ? rows : null;
  }
  const want = String(shareClass || '').trim().toUpperCase();
  const pick = (want && blocks.has(want) && Object.keys(blocks.get(want)).length) ? want : classes[0];
  const rows = Object.assign({}, blocks.get(pick));
  rows._shareClass = pick;
  rows._availableClasses = classes;
  if (want && pick !== want) rows._classFallback = `季报含 ${classes.join('/')} 多个份额类别, 未找到「${want}」, 已取「${pick}」`;
  return rows;
}

/* 页面装饰行(页码、报告名、分页符), 在拼回被折行的股票名时必须排除 */
const FURNITURE = /第\s*\d+\s*页|季度报告|中期报告|半年度报告|年度报告|^\s*\f|占基金资产|净值比例|公允价值|股票代码|股票名称|序号|数量（股）/;
const ROW_RE = /^\s*(\d{1,2})\s+([0-9A-Za-z]{5,6})\s*(.*?)\s+([\d,]+)\s+([\d,]+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/;

function isDataLine(l) { return ROW_RE.test(l) && !FURNITURE.test(l); }

/** 取相邻的"内容行"用于拼回被折行的股票名(如 "中国海洋石" + "油")。 */
function nearbyNameFragment(lines, idx, step, isData) {
  for (let i = idx + step, n = 0; i >= 0 && i < lines.length && n < 3; i += step, n++) {
    const l = (lines[i] || '').trim();
    if (!l) continue;
    if (isData[i]) continue;
    if (FURNITURE.test(l)) continue;
    if (/\d/.test(l)) continue;               // 名称片段不含数字
    if (!/[\u4e00-\u9fff]/.test(l)) continue; // 必须含中文
    return l;
  }
  return '';
}

/** 返回 [{rank, code, name, shares, value, weight}]。抽不到返回 []。
 *  注意: 年报里的「所有股票投资明细」不是前十, 不能当对账依据, 遇到就跳过。
 *
 *  实测过两种真实排版, 都必须能扛住:
 *   ① 519191: 标题与名称都在同一行 —— "1 601699 潞安环能 1,538,763 21,973,535.64 7.52"
 *   ② 005827: 标题被折行截断("…前十名股票投资明"/"细"), 且股票名被折到数据行上下两行
 *      ("中国海洋石" / "4 00883 58,950,000 1,040,404,777.20 5.10" / "油")。 */
export function parseOfficialTop10(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);

  // 表格起点: 标题可能被折行截断, 所以只匹配到"明"为止; 找不到就退而求其次找表头行
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/所有股票投资明细/.test(lines[i])) continue;         // 年报的全量明细不是前十
    if (/前十名股票投资明|前十名股票明细/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (/股票代码/.test(lines[i]) && /股票名称/.test(lines[i]) && /公允价值|市值/.test(lines[i])) { start = i; break; }
    }
  }
  if (start < 0) return [];

  const scanEnd = Math.min(lines.length, start + 70);
  const isData = {};
  for (let i = start; i < scanEnd; i++) isData[i] = isDataLine(lines[i]);

  const rows = [];
  for (let i = start; i < scanEnd && rows.length < 10; i++) {
    if (!isData[i]) continue;
    const m = ROW_RE.exec(lines[i]);
    if (!m) continue;
    const rank = Number(m[1]);
    if (rank !== rows.length + 1) continue;               // 序号必须连续, 防止误吃别处的数字行
    let name = normalizeStockName(m[3] || '');
    if (!name) name = normalizeStockName(nearbyNameFragment(lines, i, -1, isData) + nearbyNameFragment(lines, i, 1, isData));
    if (!name || /^[\d,.]+$/.test(name)) continue;
    rows.push({
      rank,
      code: m[2].padStart(6, '0'),
      name,
      shares: Number(m[4].replace(/,/g, '')),
      value: Number(m[5].replace(/,/g, '')),
      weight: Number(m[6])
    });
  }
  return rows.length >= 6 ? rows : [];
}

/** 抽「报告期内基金的投资策略和运作分析」(SOP 步骤 4 要的经理原话) */
export function parseOfficialManagerTalk(text, { maxChars = 1600 } = {}) {
  if (!text) return null;
  const m = /报告期内基金的投资策略和运作分析([\s\S]{40,6000}?)(?=\n\s*(?:4\.\d|5\.\d|§|四、|五、|报告期内基金的业绩表现|报告期内基金费用))/m.exec(text);
  const body = (m ? m[1] : null) || (() => {
    const i = text.search(/投资策略和运作分析/);
    return i >= 0 ? text.slice(i, i + maxChars) : null;
  })();
  if (!body) return null;
  const cleaned = body.replace(/^\s*[\d.]*\s*投资策略和运作分析/, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return cleaned.slice(0, maxChars);
}

/* ------------------------------------------------------------ 选取报告 */
/** SOP §2: 复盘区间内每 3–4 季至少 1 份法定报告原文用于核对, 首尾两季必抓。 */
export function pickReportsToVerify(reports, quarters, { everyN = 4 } = {}) {
  const withPeriod = reports.filter(r => r.period && (r.kind === 'quarterly' || r.kind === 'interim'));
  const byPeriod = {};
  // 同季度优先用季报(表更标准), 中报/年报做补充
  for (const r of withPeriod) {
    const cur = byPeriod[r.period];
    if (!cur || (cur.kind !== 'quarterly' && r.kind === 'quarterly')) byPeriod[r.period] = r;
  }
  const picked = [];
  const n = quarters.length;
  quarters.forEach((q, i) => {
    const first = i === 0, last = i === n - 1;
    const stride = (i % everyN === 0);
    if ((first || last || stride) && byPeriod[q.period]) picked.push({ ...byPeriod[q.period], reason: first ? '首季' : last ? '末季' : `每 ${everyN} 季抽样` });
  });
  return picked;
}

/* ------------------------------------------------------------ 逐行对账 */
/** SOP 质检: 官方 PDF 与天天基金接口至少重合 1 季, 逐行对账(排名/名称/权重 ±0.01)。 */
export function reconcile(officialRows, dfcfQuarter, { tolerance = 0.011 } = {}) {
  const res = {
    period: dfcfQuarter ? dfcfQuarter.period : null,
    officialCount: officialRows.length,
    providerCount: dfcfQuarter ? dfcfQuarter.top10.length : 0,
    matched: 0, diffs: [], nameAliases: [], missingInProvider: [], missingInOfficial: [],
    maxWeightDiff: 0, ok: false, note: ''
  };
  if (!officialRows.length || !dfcfQuarter) { res.note = '官方表或第三方数据缺失, 无法对账'; return res; }
  if (!Array.isArray(dfcfQuarter.top10) || !dfcfQuarter.top10.length) { res.note = '这一期没有第三方持仓数据可对(该期只有官方报告)'; return res; }

  // 以股票代码为主键对账: 代码是稳定的, 而名称会随时间变(官方用报告时点名称,
  // 第三方用当前名称, 例如官方"阳光城" vs 第三方"ST阳光城")。
  const offByCode = {}, proByCode = {}, proByName = {};
  officialRows.forEach(r => offByCode[r.code] = r);
  dfcfQuarter.top10.forEach(r => { proByCode[r.code] = r; proByName[normalizeStockName(r.name)] = r; });

  for (const o of officialRows) {
    let p = proByCode[o.code];
    if (!p) p = proByName[normalizeStockName(o.name)];
    if (!p) { res.missingInProvider.push(`官方第 ${o.rank} 名 ${o.name}(${o.code}) ${o.weight}% 在第三方数据中找不到`); continue; }
    if (normalizeStockName(p.name) !== normalizeStockName(o.name)) {
      res.nameAliases.push(`${o.code}: 官方称「${o.name}」, 第三方称「${p.name}」(同一代码, 属时点名称差异)`);
    }
    const d = Math.abs(p.weight - o.weight);
    res.maxWeightDiff = Math.max(res.maxWeightDiff, d);
    if (d <= tolerance) res.matched++;
    else res.diffs.push(`${o.name}(${o.code}): 官方 ${o.weight}% vs 第三方 ${p.weight}%(差 ${d.toFixed(2)}pp, 超出 ±${tolerance}pp)`);
  }
  for (const p of dfcfQuarter.top10) {
    if (!offByCode[p.code] && !proByName[normalizeStockName(p.name)]) res.missingInOfficial.push(`第三方第 ${p.rank} 名 ${p.name}(${p.code}) ${p.weight}% 在官方表中找不到`);
  }

  res.ok = res.diffs.length === 0 && res.missingInProvider.length === 0 && res.missingInOfficial.length === 0;
  res.note = res.ok
    ? `官方 ${officialRows.length} 行与第三方逐行一致(权重差 ≤${tolerance}pp, 最大 ${res.maxWeightDiff.toFixed(3)}pp)` +
      (res.nameAliases.length ? `; ${res.nameAliases.length} 处为时点名称差异(已按代码对齐)` : '')
    : `存在差异: ${res.diffs.length} 行权重超差 + ${res.missingInProvider.length} 行第三方缺失 + ${res.missingInOfficial.length} 行官方缺失(SOP: 对不上的以官方 PDF 为准并记录差异)`;
  return res;
}

/* ------------------------------------------------------------ 主流程 */
export async function verifyAgainstOfficial(code, quarters, opts = {}) {
  const started = Date.now();
  const result = {
    available: false, pdftotext: !!findPdftotext(), reports: [], checks: [],
    talks: [], sources: [], notes: []
  };
  if (!result.pdftotext) {
    result.notes.push('本机未找到 pdftotext(Poppler), 官方报告 PDF 无法解析 —— 官方对账这一项会标记为"未完成", 报告里不会假装对过账。' + popplerInstallNote());
    return result;
  }
  let list;
  try {
    list = await getReportList(code, { pages: opts.pages || 2 });
  } catch (e) {
    result.notes.push('定期报告清单取不到: ' + e.message);
    return result;
  }
  const picked = pickReportsToVerify(list, quarters, { everyN: opts.everyN || 4 });
  result.reports = list.map(r => ({ title: r.title, date: r.date, kind: r.kind, period: r.period, url: reportPdfUrl(r.id) }));
  if (!picked.length) {
    result.notes.push('没有匹配到复盘区间内的季度报告 / 中期报告, 官方对账未完成。');
    return result;
  }

  /* all=true: 复盘区间内**每一期**都取原文来解析。
     为什么要全取: 季度/年度超额表需要每期的 ①净值增长率 ③基准收益率, 少一期就缺一个数;
     顺带把逐行对账从"抽样 4 期"升级成"全部期", 这才是 SOP 说的 23/23 期对账。 */
  let toFetch = picked;
  if (opts.all) {
    const qPeriods = new Set(quarters.map(q => q.period));
    const chosen = new Map();
    for (const r of list) {
      if (!r.period || !qPeriods.has(r.period)) continue;
      if (r.kind !== 'quarterly' && r.kind !== 'interim') continue;
      const cur = chosen.get(r.period);
      // 同季度优先季报(表更标准)
      if (!cur || (cur.kind !== 'quarterly' && r.kind === 'quarterly')) chosen.set(r.period, r);
    }
    toFetch = quarters.map(q => {
      const rep = chosen.get(q.period);
      if (!rep) return null;
      return { ...rep, reason: '全量取原文' };
    }).filter(Boolean);
    result.missingReports = quarters.filter(q => !chosen.has(q.period)).map(q => q.period);
  }

  const maxFetch = opts.all ? toFetch.length : (opts.maxFetch || 6);
  for (const rep of toFetch.slice(0, maxFetch)) {
    const q = quarters.find(x => x.period === rep.period);
    const entry = { period: rep.period, title: rep.title, date: rep.date, url: reportPdfUrl(rep.id), reason: rep.reason };
    try {
      const buf = await downloadReportPdf(rep.id);
      entry.bytes = buf.length;
      const text = pdfBufferToText(buf);
      if (!text) { entry.error = 'PDF 文本抽取失败'; result.checks.push(entry); continue; }
      const rows = parseOfficialTop10(text);
      entry.parsedRows = rows.length;
      const rec = reconcile(rows, q);
      entry.reconcile = rec;
      const bm = parseBenchmark(text);
      if (bm) entry.benchmark = bm;
      const perf = parsePerfTable(text, { shareClass: opts.shareClass });
      if (perf) entry.perf = perf;
      const talk = parseOfficialManagerTalk(text);
      if (talk) result.talks.push({ period: rep.period, url: entry.url, text: talk });
      result.checks.push(entry);
      result.sources.push({ type: '官方定期报告 PDF', period: rep.period, title: rep.title, url: entry.url, fetchedAt: new Date().toISOString(), bytes: buf.length });
    } catch (e) {
      entry.error = e.message;
      result.checks.push(entry);
    }
  }
  result.available = result.checks.some(c => c.reconcile && c.reconcile.ok);

  /* 基准一致性: 把各期抽到的基准按报告期先后排一遍, 找出第一次变化的位置。
     这是 SOP §0「基准中途调整过要标注」的自动实现 —— 只在抽样期之间比对,
     所以说"在 X 与 Y 之间调整过", 不假装知道确切调整日。 */
  const withBm = result.checks.filter(c => c.benchmark).sort((a, b) => (a.period < b.period ? -1 : 1));
  if (withBm.length) {
    const norm = withBm.map(c => ({ period: c.period, raw: c.benchmark, n: normalizeBenchmark(c.benchmark) }));
    const changes = [];
    for (let i = 1; i < norm.length; i++) {
      if (norm[i].n !== norm[i - 1].n) changes.push({ from: norm[i - 1], to: norm[i] });
    }
    result.benchmark = {
      latest: norm[norm.length - 1].raw,
      samples: norm.map(x => ({ period: x.period, value: x.raw })),
      changed: changes.length > 0,
      changes: changes.map(c => `在 ${c.from.period} 与 ${c.to.period} 之间调整过: 「${c.from.raw}」→「${c.to.raw}」`),
      note: changes.length
        ? '⚠ 业绩比较基准在本复盘区间内调整过, 跨期比较非完全同口径 —— 已在报告"口径与证据边界"中标注。'
        : `抽样 ${norm.length} 期, 业绩比较基准未发生变化。`
    };
  }

  result.ms = Date.now() - started;
  const okCount = result.checks.filter(c => c.reconcile && c.reconcile.ok).length;
  result.notes.push(okCount
    ? `官方对账完成: ${okCount}/${result.checks.length} 期逐行一致, 共解析 ${result.checks.reduce((s, c) => s + (c.parsedRows || 0), 0)} 行官方持仓。`
    : `官方报告取到 ${result.checks.length} 份, 但逐行对账未全部通过, 详见差异清单。`);
  return result;
}
