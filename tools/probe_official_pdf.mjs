/* 验证: 能否把"官方定期报告"这一路真正打通 —— 列公告 -> 拿 PDF -> 抽前十大表 -> 与天天基金逐行对账。
 * 这是 SOP §2 的最高权威来源, 也是"数据可信"的根。
 * 用法: node tools/probe_official_pdf.mjs 519191
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '_probe', 'pdf');
fs.mkdirSync(OUT, { recursive: true });

const POPPLER = 'C:\\Users\\75719\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin';
const PDFTOTEXT = path.join(POPPLER, 'pdftotext.exe');

const code = process.argv[2] || '519191';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HJ = { 'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/' };

console.log('=== 官方报告 PDF 链路验证: ' + code + ' ===\n');

// 1) 列定期报告
const res = await fetch(`https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=40&type=3&_=${Date.now()}`, { headers: HJ });
const j = JSON.parse(await res.text());
const list = Array.isArray(j.Data) ? j.Data : ((j.Data && j.Data.List) || j.List || []);
console.log('定期报告条数 = ' + list.length);
const pick = list.filter(x => /季度报告|中期报告|年度报告/.test(x.TITLE || ''));
console.log('其中定期报告 = ' + pick.length);
pick.slice(0, 5).forEach(x => console.log('  · ' + x.TITLE + '\n      ID=' + x.ID + '  date=' + (x.PUBLISHEDATE || x.NOTICEDATE || '')));

// 2) ID -> PDF URL 猜测并验证
const target = pick.find(x => /第2季度报告/.test(x.TITLE)) || pick[0];
console.log('\n取一份测试: ' + target.TITLE);
const candidates = [
  `https://pdf.dfcfw.com/pdf/H2_${target.ID}_1.pdf`,
  `https://pdf.dfcfw.com/pdf/H2_${target.ID}_1.pdf?1710000000000.pdf`
];
let pdfUrl = null, pdfBuf = null;
for (const u of candidates) {
  try {
    const r = await fetch(u, { headers: HJ });
    const b = Buffer.from(await r.arrayBuffer());
    console.log(`  [${r.status}] ${b.length}B  ${r.headers.get('content-type')}  ${u}`);
    if (r.ok && b.length > 20000 && b.slice(0, 4).toString() === '%PDF') { pdfUrl = u; pdfBuf = b; break; }
  } catch (e) { console.log('  [ERR] ' + u + ' :: ' + e.message); }
}
if (!pdfBuf) { console.log('\n没能拿到 PDF, 后续步骤无法验证'); process.exit(1); }

const pdfFile = path.join(OUT, `${code}_${target.ID}.pdf`);
fs.writeFileSync(pdfFile, pdfBuf);
console.log('  已保存 ' + path.basename(pdfFile) + '  ' + (pdfBuf.length / 1024).toFixed(0) + ' KB');

// 3) 抽取文本, 找前十大持仓表
const txtFile = path.join(OUT, `${code}_${target.ID}.txt`);
execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-layout', pdfFile, txtFile], { stdio: ['ignore', 'pipe', 'ignore'] });
const txt = fs.readFileSync(txtFile, 'utf8');
console.log('  抽出文本 ' + txt.length + ' 字符');

const secIdx = txt.search(/前十名股票投资明细|前十大股票投资明细|按公允价值占基金资产净值比例大小排序的前十名股票/);
console.log('  "前十名股票投资明细" 位置 = ' + secIdx);
if (secIdx >= 0) {
  const chunk = txt.slice(secIdx, secIdx + 1800);
  console.log('\n---- 表格原文片段 ----');
  console.log(chunk.split('\n').slice(0, 22).join('\n'));
}

// 4) 找经理原话(SOP 步骤 4 证据链要用)
const talkIdx = txt.search(/投资策略和运作分析|报告期内基金的投资策略/);
console.log('\n  "投资策略和运作分析" 位置 = ' + talkIdx);
if (talkIdx >= 0) {
  console.log('---- 经理原话片段 ----');
  console.log(txt.slice(talkIdx, talkIdx + 700).replace(/\n{2,}/g, '\n'));
}
