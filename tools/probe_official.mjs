/* 探测"官方报告 PDF + 补充数据"的可用渠道, 按 SOP §2 的顺序逐个试。
 * SOP §2 六类来源: ①官方季报/年报 PDF(最高权威) ②天天基金历史前十大 ③天天基金资产配置
 *                  ④天天基金规模变动 ⑤累计净值序列 ⑥经理履历
 * SOP §已知坑: F10 jjgg 年份滞后; 东财 fund.eastmoney.com/gonggao/{code},{AN}.html 是空壳(AJAX), 别碰。
 * 用法: node tools/probe_official.mjs 519191
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '_probe');
fs.mkdirSync(OUT, { recursive: true });

const code = process.argv[2] || '519191';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HJ = { 'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/' };

async function probe(label, url, init) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { ...init, headers: { ...HJ, ...(init && init.headers) }, signal: ctrl.signal });
    clearTimeout(t);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    console.log(`  [${res.status}] ${label}  ${buf.length}B  ${(res.headers.get('content-type') || '').slice(0, 40)}`);
    return { ok: res.ok, text, status: res.status, bytes: buf.length };
  } catch (e) {
    console.log(`  [ERR] ${label}  ${e.message}`);
    return { ok: false, text: '', error: e.message };
  }
}

console.log('=== 渠道探测: ' + code + ' ===\n');

/* ---- ① 官方报告 PDF: 逐渠道试 ---- */
console.log('[① 官方报告 PDF]');

// 1a 天天基金公告列表接口(SOP 标注年份滞后, 先看它到底给到哪年)
const jjgg = await probe('api.fund.eastmoney.com/f10/JJGG (type=3 定期报告)',
  `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=30&type=3&_=${Date.now()}`);
if (jjgg.ok) {
  fs.writeFileSync(path.join(OUT, `jjgg_${code}.json`), jjgg.text, 'utf8');
  const titles = [...jjgg.text.matchAll(/"TITLE"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const ids = [...jjgg.text.matchAll(/"ID"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  console.log('     公告条数 = ' + titles.length);
  titles.slice(0, 6).forEach((t, i) => console.log('       ' + t + (ids[i] ? '   ID=' + ids[i] : '')));
}

// 1b 东财公告 API(股票用; 基金试试)
const npAnn = await probe('np-anotice-stock.eastmoney.com/api/security/ann',
  `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list=${code}&f_node=0&s_node=0`);
if (npAnn.ok) {
  try {
    const j = JSON.parse(npAnn.text);
    const list = (j.data && j.data.list) || [];
    console.log('     公告条数 = ' + list.length);
    list.slice(0, 5).forEach(x => console.log('       ' + (x.title || '') + '   art_code=' + (x.art_code || '')));
  } catch (e) { console.log('     非 JSON: ' + npAnn.text.slice(0, 120)); }
}

// 1c 巨潮资讯 全文检索(基金定期报告的主要法定披露渠道)
const cninfo = await probe('static.cninfo.com.cn / cninfo 全文检索(POST)',
  'http://www.cninfo.com.cn/new/fulltextSearch/full?searchkey=' + encodeURIComponent(code + ' 季度报告') + '&sdate=&edate=&isfulltext=false&sortName=nothing&sortType=desc&pageNum=1',
  { headers: { 'Referer': 'http://www.cninfo.com.cn/' } });
if (cninfo.ok) {
  fs.writeFileSync(path.join(OUT, `cninfo_${code}.json`), cninfo.text, 'utf8');
  try {
    const j = JSON.parse(cninfo.text);
    const anns = (j.announcements) || [];
    console.log('     命中 = ' + anns.length);
    anns.slice(0, 6).forEach(a => console.log('       ' + (a.announcementTitle || '') + '  |  ' + (a.adjunctUrl || '')));
  } catch (e) { console.log('     非 JSON: ' + cninfo.text.slice(0, 160)); }
}

// 1d 巨潮 基金公告专用检索
const cninfoFund = await probe('cninfo 基金公告检索(POST hisAnnouncement)',
  'http://www.cninfo.com.cn/new/hisAnnouncement/query',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Referer': 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice' },
    body: `pageNum=1&pageSize=30&column=fund&tabName=fulltext&plate=&stock=&searchkey=${code}&secid=&category=&trade=&seDate=&sortName=&sortType=&isHLtitle=true`
  });
if (cninfoFund.ok) {
  fs.writeFileSync(path.join(OUT, `cninfo_fund_${code}.json`), cninfoFund.text, 'utf8');
  try {
    const j = JSON.parse(cninfoFund.text);
    const anns = (j.announcements) || [];
    console.log('     命中 = ' + anns.length);
    anns.slice(0, 8).forEach(a => console.log('       ' + (a.announcementTitle || '') + '  |  ' + (a.adjunctUrl || '')));
  } catch (e) { console.log('     非 JSON: ' + cninfoFund.text.slice(0, 200)); }
}

/* ---- ③ 资产配置 ---- */
console.log('\n[③ 资产配置 zcpz]');
const zcpz = await probe('fundf10.eastmoney.com/zcpz_' + code + '.html', `https://fundf10.eastmoney.com/zcpz_${code}.html`);
if (zcpz.ok) {
  fs.writeFileSync(path.join(OUT, `zcpz_${code}.html`), zcpz.text, 'utf8');
  const rows = [...zcpz.text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()));
  console.log('     表格行数 = ' + rows.length);
  rows.slice(0, 4).forEach(r => console.log('       ' + JSON.stringify(r)));
}

/* ---- ⑥ 经理履历 ---- */
console.log('\n[⑥ 经理履历]');
const jjjlHtml = await probe('fundf10.eastmoney.com/jjjl_' + code + '.html', `https://fundf10.eastmoney.com/jjjl_${code}.html`);
if (jjjlHtml.ok) {
  fs.writeFileSync(path.join(OUT, `jjjl_${code}.html`), jjjlHtml.text, 'utf8');
  const rows = [...jjjlHtml.text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())).filter(r => r.length >= 4);
  console.log('     表格行数 = ' + rows.length);
  rows.slice(0, 5).forEach(r => console.log('       ' + JSON.stringify(r.slice(0, 6))));
}

console.log('\n探测文件写入 tools/_probe/');
