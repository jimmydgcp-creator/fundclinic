/* 生成《小组作业I·场景确认_组内确认稿.docx》
 *
 * 为什么自己写 docx: 本机没有 python-docx / pandoc 之类, 也不想为一份文件装依赖。
 * docx 本质就是一个 zip + 几个 XML, 用 Node 的 zlib 就能拼出来(和 tools/zip_dist.mjs 同理)。
 *
 * 内容严格对齐平台上那 8 道必答题的**原文与顺序**(从页面快照抄下来的),
 * 每道题分三块: 平台要求原文 / 我们的草稿 / 需要组员拍板的地方。
 * 目的是发到群里让组员直接在上面改, 而不是让他们对着平台自由发挥。
 *
 * 用法: node tools/make_docx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 输出到**上一层**的 00_交作业。
   坑(这个脚本第一版踩了): ROOT 是项目目录(04_网页项目_基金复诊台),
   直接 join(ROOT,'00_交作业') 会凭空造出一个项目内的同名文件夹,
   而用户真正存放交付物的是 04 的**同级**目录。路径必须往上走一层。 */
const OUT = path.resolve(ROOT, '..', '00_交作业', '小组作业I_场景确认_组内确认稿.docx');

/* ------------------------------------------------------------ XML 小工具 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 一个段落。opt: {bold,size,color,indent,align,space} */
function P(text, opt = {}) {
  const runs = Array.isArray(text) ? text : [{ t: text, ...opt }];
  const rpr = r => {
    const font = r.mono ? 'Consolas' : 'Microsoft YaHei';
    let s = '<w:rPr>';
    s += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="Microsoft YaHei"/>`;
    if (r.bold) s += '<w:b/>';
    if (r.italic) s += '<w:i/>';
    if (r.color) s += `<w:color w:val="${r.color}"/>`;
    if (r.size) s += `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`;
    s += '</w:rPr>';
    return s;
  };
  const body = runs.map(r => `<w:r>${rpr(r)}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`).join('');
  const ppr = '<w:pPr>'
    + (opt.align ? `<w:jc w:val="${opt.align}"/>` : '')
    + (opt.indent ? `<w:ind w:left="${opt.indent}"/>` : '')
    + `<w:spacing w:before="${opt.before === undefined ? 60 : opt.before}" w:after="${opt.after === undefined ? 60 : opt.after}" w:line="300" w:lineRule="auto"/>`
    + (opt.shade ? `<w:shd w:val="clear" w:fill="${opt.shade}"/>` : '')
    + '</w:pPr>';
  return `<w:p>${ppr}${body}</w:p>`;
}

const H1 = t => P(t, { bold: true, size: 20, color: '1F3864', before: 260, after: 140 });
const H2 = t => P(t, { bold: true, size: 15, color: '1F3864', before: 200, after: 80 });
const Body = t => P(t, { size: 10.5 });
const Small = t => P(t, { size: 9, color: '666666' });
const Label = (t, c) => P(t, { bold: true, size: 10.5, color: c || '1F3864', before: 100, after: 40 });
const Code = t => P(t, { size: 9.5, mono: true, indent: 240, color: '333333' });
const Bullet = t => P('· ' + t, { size: 10.5, indent: 300 });
const Blank = () => P('', { size: 10.5, before: 40, after: 40 });

/* ------------------------------------------------------------ 内容 */
const Q = (no, title, ask, draft, todo) => [
  P(`第 ${no} 题 · ${title}`, { bold: true, size: 12, color: 'C00000', before: 260, after: 60 }),
  Label('平台怎么问的（改动无效，仅供对照）', '888888'),
  Body(ask),
  Label('我们的草稿', '1F3864'),
  ...(Array.isArray(draft) ? draft : [Body(draft)]),
  ...(todo ? [Label('← 需要组员拍板 / 补充', 'C00000'), ...(Array.isArray(todo) ? todo : [Body(todo)])] : []),
  Blank()
];

const doc = [
  P('小组作业 I · 场景确认', { bold: true, size: 24, color: '1F3864', align: 'center', before: 0, after: 60 }),
  P('第 2 组 · 组内确认稿', { size: 13, color: '666666', align: 'center', after: 60 }),
  P('提交页 https://hw.lingnan.top/mf/t/g1-scene · 截止 2026-09-23 14:20（第 2 次课上课前）',
    { size: 9, color: '888888', align: 'center' }),
  Blank(),

  H1('怎么用这份文件'),
  Bullet('下面 8 道题，就是提交平台上要填的那 8 个必答项，顺序和原文完全一致。'),
  Bullet('每道题分三块：【平台怎么问的】是原文，不用改；【我们的草稿】可以直接用，也可以改；【需要组员拍板】是我拿不准、必须你们定的地方。'),
  Bullet('请直接在文件里改动，改完发回群里。定稿后由一个人统一填到平台。'),
  P('注意：平台写着「组里任何一人提交即代表全组，交上去的是同一份，全组都看得到、可以接着改」。所以提交前务必全组看过。',
    { size: 10, color: 'C00000', indent: 280 }),
  Blank(),

  H1('一、项目'),

  ...Q(1, '项目名（提交后即为本组组名）',
    '起一个好记的名字，交上去之后它就是本组的组名，小组页和后台都会跟着换。',
    [P([{ t: '建议填：', bold: true }, { t: '基金复诊台（FundClinic）' }], { size: 10.5 }),
      Small('理由：好记、有画面感；「复诊」暗示可以按季度反复跑同一只基金，正好是项目下一步的形态。'),
      Small('备选：持仓显微镜（HoldingsScope）／基金回溯室。'),
      Small('已做过基础查重：含「基金体检」的名字已被招商基金投顾、东方财富等占用，所以避开「体检」这条路线。')],
    [Body('要不要换名字？定了就不改了（它同时是组名）。')]),

  ...Q(2, '一句话说清项目',
    '格式：给〔谁〕用，把〔什么输入〕变成〔什么结果〕。',
    [Body('给〔基民 / 基金公司初步评价考核 / FOF 初步评价〕用，把〔一只公募基金的代码 + 复盘区间〕变成〔一份可核验的「十大持仓回溯复盘报告」网页：绩效看清代价、持仓轮动看清动作、经理言论与持仓互相印证，每个数字可回溯到公开季报原文〕。'),
      Small('更短的备选：给基民用，输入基金代码，输出一份带证据链的持仓回溯复盘网页。'),
      Small('注：「基民 / 基金公司初步评价考核 / FOF 初步评价」是项目全站统一口径，别改回只写「FOF 与投研团队」——那会被理解成只服务一类人。')],
    [Body('三类用户是否都要保留？只保留一类会让范围更清晰，但也更窄。')]),

  ...Q(3, '给谁用，他们现在怎么做这件事',
    '（平台无额外提示）',
    [Bullet('用户：基民；基金公司做基金经理初步评价考核的人；FOF 做初步评价的人。'),
      Bullet('现在怎么做：手工在巨潮、证监会披露系统、基金公司官网、天天基金之间翻 20+ 期季报 PDF，逐季把前十大持仓录进 Excel，然后算收益、回撤、集中度，再翻季报原文比对「经理说了什么 vs 后来做了什么」，最后手写一份报告。'),
      Bullet('现状量化（以已跑通的案例为准）：519191 一只基金 23 个报告期，熟练的人也要 1–2 天；同一只基金换个人写，口径和结论深度都不一样。')]),

  ...Q(4, '解决什么问题',
    '说清现在的做法卡在哪一步、费在哪里。',
    [Bullet('数据环节卡点：23 期季报 PDF 加第三方接口要人肉对账，录入容易错，过程无法留痕，也无法复现。'),
      Bullet('判断环节卡点：报告质量取决于个人经验，核心判断（这个经理行不行、错在哪）没有统一方法，结论不可比。'),
      Bullet('复用环节卡点：做完一份报告，口径和经验留在个人脑子里，换个人又从头来一遍。'),
      P([{ t: '费在哪里：', bold: true }, { t: '约 70% 的时间花在「找数据 + 录数据 + 核数字」，真正的研究判断只占 30%；而只要错一个数字，整篇结论就作废。' }], { size: 10.5 })]),

  ...Q(5, '项目大致属于哪一类（单选）',
    '智能审稿或文档审核 ／ 对话问答或投研助手 ／ 数据分析与可视化 ／ 报告或材料自动生成 ／ 其他（请填写）',
    [P([{ t: '建议选：', bold: true }, { t: '报告或材料自动生成' }], { size: 10.5 }),
      Small('理由：项目的产出物就是一份结构化复盘报告 + 演示稿，和现有成果最一致。'),
      Small('如果更想突出网页问答交互，选「对话问答或投研助手」；如果更想突出图表与看板，选「数据分析与可视化」。')],
    [P('这是单选，三个都沾边。', { size: 10.5 }),
      Body('我的倾向是第一个（报告生成是主干，问答和图表是附属），但这条必须你们拍板。')]),

  H1('二、AI 模块与数据'),

  ...Q(6, 'AI 模块做什么',
    '哪一步交给大模型，输入是什么，输出是什么，错了怎么发现。',
    [P('先说分工，避免「什么都甩给大模型」的误解：', { size: 10.5, bold: true }),
      Code('抓取 / 解析 / 量化 / 建簿 / 对账   →  脚本（非大模型）'),
      Code('    基金代码 → 持仓、净值、规模结构化 JSON + Excel 底稿'),
      Code('① 季报原文抽取与结构化           →  大模型'),
      Code('    季报 PDF 文本 → 「经理本期说了什么」+ 下期动作对照表'),
      Code('② 行业主题归类                   →  大模型（人工可改）'),
      Code('    持仓股票清单 → 主题权重表'),
      Code('③ 核心判断起草                   →  大模型'),
      Code('    绩效 / 轮动 / 言论数据 → 形态标签 + 主线问题 + 一句可证伪判断 + 最大反证'),
      Code('④ 报告成文与自检                 →  大模型'),
      Code('    结构化数据 → 报告初稿 + 数字回查清单'),
      Code('门禁（口径确认 / 判断方向确认 / 终审三查）  →  人'),
      Blank(),
      P('错了怎么发现（四条）：', { size: 10.5, bold: true }),
      Bullet('官方值对账：每期持仓与收益必须和官方季报 PDF 逐行对账。已实测 519191 共 22 期、220 行权重全部一致，最大差 0.000pp。'),
      Bullet('逐期校准：用官方季报披露的「过去三个月」净值增长率反过来校准工具自己算的逐季收益。已实测 519191 共 22 期可比，最大偏差 0.01pp。'),
      Bullet('数字回查：报告里每个百分比、每个金额都要能指回数据行或季报原文，指不回去就退回重写。'),
      Bullet('措辞红线：禁止一切预判式、必胜式表述，并强制区分「披露事实 / 合理推断 / 事后解读」三级证据。')]),

  ...Q(7, '打算用什么数据',
    '写到具体来源。只用公开数据或自己造的样例数据，不用实习单位或任何机构的内部数据。',
    [P('全部为公开数据；不含任何机构或实习单位内部数据，不使用非公开信息。', { size: 10.5, bold: true }),
      Blank(),
      Code('① 官方定期报告 PDF（最高权威）'),
      Code('   巨潮资讯 static.cninfo.com.cn'),
      Code('   证监会基金信息披露 eid.csrc.gov.cn'),
      Code('   基金公司官网 / 东财公告镜像 pdf.dfcfw.com'),
      Code('② 第三方交叉验证（天天基金 F10）'),
      Code('   历史前十大 fundf10.eastmoney.com/...type=jjcc'),
      Code('   规模变动 type=gmbd ／ 资产配置 zcpz_… ／ 分红 fhsp_… ／ 基金经理 jjjl_…'),
      Code('   净值序列 fund.eastmoney.com/pingzhongdata/{基金代码}.js'),
      Code('③ 基准指数'),
      Code('   沪深300、中证全债（基准收益直接取季报披露行）'),
      Blank(),
      Small('可行性已验证：519191 案例 23/23 期官方报告全部取得，与第三方 220 行权重全一致；002910 / 163402 / 519191 三条链路已完整跑通。')]),

  ...Q(8, '第 2 次课末愿意上台讲项目设想吗（单选）',
    '约 4 组，讲完有点评。愿意的优先，不够再抽。是 / 否',
    [P([{ t: '建议填：', bold: true }, { t: '是' }], { size: 10.5 }),
      Small('理由：中期（10/13）和终展（11/11）本来就要全员上台，提前拿一次点评、把最难的问题在早期暴露出来最划算。而且项目已经有能直接演示的成品（见附件），上台成本很低。')],
    [Body('要不要上台？愿意的优先，名额有限。')]),

  H1('附件（提交时一起上传）'),
  Small('平台支持 PDF、Word、PPT、Markdown、HTML、Excel、CSV、TXT、图片和 zip，单个不超过 50MB。'),
  Small('注意：重新提交时附件是追加的，不会覆盖已传的。'),
  Bullet('成品：基金复诊台网页项目（含单文件版可离线打开）'),
  Bullet('材料来源清单'),
  Bullet('错误检查记录'),
  Bullet('运行记录'),
  Blank(),

  H1('提交前 60 秒自检'),
  Bullet('项目名已定（它同时是组名）'),
  Bullet('8 个必答全部填写，无空'),
  Bullet('类型单选已拍板'),
  Bullet('附件已挑选上传（成品 + 材料来源清单 + 错误检查记录 + 运行记录）'),
  Bullet('全文无口语化旧术语、无必胜暗示'),
  Bullet('已声明：只用公开数据、不构成投资建议'),
  Blank(),
  P('—— 以上全组确认后，由一人统一提交。', { size: 10, color: 'C00000', align: 'center' })
].join('');

/* ------------------------------------------------------------ 打包成 docx */
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
${doc}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`;

/* 极简 zip: 只存不压(文件很小, 压缩与否无所谓), 但 CRC 和结构要正确 */
function crc32(buf) { return zlib.crc32(buf); }
function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
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
const buf = zip([
  ['[Content_Types].xml', CT],
  ['_rels/.rels', RELS],
  ['word/document.xml', DOC]
]);
fs.writeFileSync(OUT, buf);

const textLen = DOC.replace(/<[^>]+>/g, '').length;
console.log('写出 ' + OUT);
console.log('  文件大小   ' + (buf.length / 1024).toFixed(1) + ' KB');
console.log('  正文可见字 ' + textLen + ' 字');
console.log('  结构自检   头签名 ' + (buf.readUInt32LE(0) === 0x04034b50 ? '✓' : '✗')
  + ' · zip 条目 ' + buf.readUInt16LE(buf.length - 22 + 10));
