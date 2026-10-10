/* 数据源探测: 确认"输入基金代码 -> 自动爬取"这条链路真的跑得通, 并摸清各接口的字段结构。
 * 用法: node tools/probe_sources.mjs [基金代码]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '_probe');
fs.mkdirSync(OUT, { recursive: true });

const code = process.argv[2] || '519191';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/' } });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  return { url, status: res.status, bytes: buf.length, ms: Date.now() - t0, text, ctype: res.headers.get('content-type') };
}

const say = (...a) => console.log(...a);

say('基金代码: ' + code + '\n');

/* ---------------- 1) 基金基本信息 ---------------- */
const jbgk = await get(`https://fundf10.eastmoney.com/jbgk_${code}.html`);
say(`[1] 基本概况 jbgk_${code}.html  ${jbgk.status} ${jbgk.bytes}B ${jbgk.ms}ms`);
fs.writeFileSync(path.join(OUT, `jbgk_${code}.html`), jbgk.text, 'utf8');
const pick = (label) => {
  const re = new RegExp('<th[^>]*>\\s*' + label + '\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>', 'i');
  const m = re.exec(jbgk.text);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null;
};
for (const k of ['基金全称', '基金简称', '基金代码', '基金类型', '成立日期', '基金公司', '基金经理人', '管理费率', '业绩比较基准']) {
  say('    ' + k + ' = ' + pick(k));
}

/* ---------------- 2) 净值序列 ---------------- */
const pz = await get(`https://fund.eastmoney.com/pingzhongdata/${code}.js`);
say(`\n[2] 净值序列 pingzhongdata/${code}.js  ${pz.status} ${pz.bytes}B ${pz.ms}ms  ${pz.ctype}`);
fs.writeFileSync(path.join(OUT, `pingzhongdata_${code}.js`), pz.text, 'utf8');
const varOf = (name) => {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*([\\s\\S]*?);\\s*(?=/\\*|var\\s|$)', 'm').exec(pz.text);
  return m ? m[1] : null;
};
say('    fS_name = ' + varOf('fS_name'));
say('    fS_code = ' + varOf('fS_code'));
const nw = varOf('Data_netWorthTrend');
if (nw) {
  try {
    const arr = JSON.parse(nw);
    say('    Data_netWorthTrend 条数 = ' + arr.length + '  首 = ' + JSON.stringify(arr[0]) + '  末 = ' + JSON.stringify(arr[arr.length - 1]));
  } catch (e) { say('    Data_netWorthTrend 解析失败: ' + e.message); }
}
const acw = varOf('Data_ACWorthTrend');
if (acw) { try { const a = JSON.parse(acw); say('    Data_ACWorthTrend 条数 = ' + a.length + '  首 = ' + JSON.stringify(a[0]) + '  末 = ' + JSON.stringify(a[a.length - 1])); } catch (e) { say('    累计净值解析失败'); } }
const gr = varOf('Data_grandTotal');
if (gr) say('    Data_grandTotal 长度 = ' + gr.length);
say('    含 syl_1n(近1年) = ' + (varOf('syl_1n') !== null) + ' , syl_6y = ' + (varOf('syl_6y') !== null));

/* ---------------- 3) 规模变动 ---------------- */
const gmbd = await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=gmbd&code=${code}&rt=0.1`);
say(`\n[3] 规模变动 gmbd  ${gmbd.status} ${gmbd.bytes}B ${gmbd.ms}ms`);
fs.writeFileSync(path.join(OUT, `gmbd_${code}.txt`), gmbd.text, 'utf8');
const gRows = [...gmbd.text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, '').trim()));
say('    数据行数 = ' + gRows.length);
gRows.slice(0, 3).forEach(r => say('    ' + JSON.stringify(r)));

/* ---------------- 4) 前十大持仓(按年) ---------------- */
say('\n[4] 前十大持仓 jjcc');
const thisYear = new Date().getFullYear();
let totalQuarters = 0, sampleQuarters = [];
for (let y = thisYear; y >= thisYear - 8; y--) {
  const r = await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${y}&month=&rt=0.1`);
  const body = r.text;
  if (y === thisYear) fs.writeFileSync(path.join(OUT, `jjcc_${code}_${y}.txt`), body, 'utf8');
  if (/<div class='box'>/.test(body) === false && body.length < 400) { say(`    ${y}: 无数据(${body.length}B)`); continue; }
  // 每季度一个 <div class='boxitem w790'> 块, 标题里含日期
  const items = [...body.matchAll(/<div class='boxitem w790'>([\s\S]*?)(?=<div class='boxitem w790'>|<\/div>\s*<\/div>|$)/g)];
  const dates = [...body.matchAll(/<h4 class='t'><label[^>]*>[\s\S]*?<\/label><label[^>]*>([\s\S]*?)<\/label>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const nRows = (body.match(/<tr>/g) || []).length;
  say(`    ${y}: ${r.bytes}B  ${r.ms}ms  季度块=${items.length}  日期标签=${JSON.stringify(dates.slice(0, 5))}  <tr>数=${nRows}`);
  totalQuarters += items.length;
  if (items.length) sampleQuarters.push({ y, first: items[0][1].slice(0, 700) });
}
say('    合计季度块 = ' + totalQuarters);
if (sampleQuarters.length) {
  say('\n    ---- 最新季度块原文片段 ----');
  say(sampleQuarters[0].first);
  fs.writeFileSync(path.join(OUT, 'jjcc_sample_block.html'), sampleQuarters[0].first, 'utf8');
}

/* ---------------- 5) 基金经理 ---------------- */
const jjjl = await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjjl&code=${code}&rt=0.1`);
say(`\n[5] 基金经理 jjjl  ${jjjl.status} ${jjjl.bytes}B ${jjjl.ms}ms`);
fs.writeFileSync(path.join(OUT, `jjjl_${code}.txt`), jjjl.text, 'utf8');
const jRows = [...jjjl.text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()));
jRows.slice(0, 4).forEach(r => say('    ' + JSON.stringify(r)));

say('\n探测文件已写入 tools/_probe/');
