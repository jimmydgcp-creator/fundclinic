/* 调试: 为什么某些基金的持仓解析会漏季度。 */
import { parseJjccYear } from '../server/sources.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const code = process.argv[2] || '005827';
const year = process.argv[3] || '2025';

const u = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${year}&month=&rt=${Math.random()}`;
const r = await fetch(u, { headers: { 'User-Agent': UA, 'Referer': 'https://fund.eastmoney.com/' } });
const t = await r.text();

const blocks = t.split("<div class='boxitem w790'>");
console.log('块数(含前缀) = ' + blocks.length + '  bytes = ' + t.length);

const blk = blocks[1] || '';
const thead = (/<thead>([\s\S]*?)<\/thead>/.exec(blk) || [])[1] || '';
console.log('\n--- thead ---');
console.log(thead.replace(/></g, '>\n<').slice(0, 1000));

const tbody = (/<tbody>([\s\S]*?)<\/tbody>/.exec(blk) || [])[1] || '';
console.log('\n--- tbody 第一行 ---');
console.log(tbody.slice(0, 800).replace(/></g, '>\n<'));

const parsed = parseJjccYear(t);
console.log('\n--- parseJjccYear 结果: ' + parsed.length + ' 期 ---');
parsed.forEach(q => console.log('  ' + q.period + ' ' + q.endDate + '  ' + q.top10.length + ' 行  ' + q.top10.slice(0, 3).map(h => h.name + ' ' + h.weight).join(' | ')));
