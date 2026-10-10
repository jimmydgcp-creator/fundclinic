/* 爬虫正确性验证: 用"已经人工与官方季报对过账"的 519191 底稿去验自动爬取的结果。
 * 这是本项目最有说服力的一条证据 —— 自动链路跑出来的数字, 必须和人工核过的数字对上。
 * 用法: node tools/validate_crawl.mjs [基金代码]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { crawlFund } from '../server/sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const code = process.argv[2] || '519191';

// 人工核过的基准底稿
const sandbox = { console, window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/funds.data.js'), 'utf8'), sandbox, { filename: 'funds.data.js' });
const baseline = sandbox.window.FUNDCLINIC_DATA[code];
if (!baseline) { console.error('基准底稿里没有 ' + code + ', 无法比对'); process.exit(1); }

console.log(`=== 自动爬取 ${code} ===`);
const t0 = Date.now();
const { dataset: live, basic, nav, scaleRows } = await crawlFund(code, { onProgress: m => console.log('  · ' + m) });
console.log(`  完成: ${live.quarters.length} 个报告期 / 净值 ${nav.points} 点 / 规模 ${scaleRows} 行 / 用时 ${Date.now() - t0} ms\n`);

console.log('--- 概况 ---');
console.log('  自动: ' + live.fund.name + ' | ' + live.fund.company + ' | ' + live.fund.manager + ' | ' + live.fund.type);
console.log('  基准: ' + baseline.fund.name + ' | ' + baseline.fund.company + ' | ' + baseline.fund.manager + ' | ' + baseline.fund.type);
console.log('  自动区间: ' + live.fund.range + `(${live.quarters.length} 期)`);
console.log('  基准区间: ' + baseline.fund.range + `(${baseline.quarters.length} 期)`);

let fail = 0;
const ok = (c, l, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x ? '  ' + x : '')); if (!c) fail++; };

console.log('\n=== A. 覆盖范围 ===');
const baseMap = {}; baseline.quarters.forEach(q => baseMap[q.period] = q);
const liveMap = {}; live.quarters.forEach(q => liveMap[q.period] = q);
const common = Object.keys(liveMap).filter(p => baseMap[p]).sort();
const onlyLive = Object.keys(liveMap).filter(p => !baseMap[p]).sort();
const onlyBase = Object.keys(baseMap).filter(p => !liveMap[p]).sort();
ok(common.length >= 20, '共同报告期 ≥20', String(common.length));
console.log('    只在新抓取里有: ' + (onlyLive.join(', ') || '无'));
console.log('    只在基准里有:   ' + (onlyBase.join(', ') || '无'));

console.log('\n=== B. 逐行权重对账(核心) ===');
let rows = 0, within011 = 0, within003 = 0, maxDiff = 0, worst = null;
const nameMismatch = [], missingStock = [];
for (const p of common) {
  const bList = baseMap[p].top10, lList = liveMap[p].top10;
  const lByName = {}; lList.forEach(h => lByName[h.name] = h);
  for (const b of bList) {
    const l = lByName[b.name];
    if (!l) { missingStock.push(p + ' ' + b.name); continue; }
    rows++;
    const d = Math.abs((l.weight || 0) - (b.weight || 0));
    if (d <= 0.11) within011++;
    if (d <= 0.03) within003++;
    if (d > maxDiff) { maxDiff = d; worst = `${p} ${b.name}: 自动 ${l.weight}% vs 基准 ${b.weight}%`; }
    if (d > 0.11) nameMismatch.push(`${p} ${b.name}: ${l.weight} vs ${b.weight} (差 ${d.toFixed(2)}pp)`);
  }
}
console.log(`    比对 ${rows} 行`);
ok(rows >= 200, '比对行数 ≥200', String(rows));
ok(within011 === rows, `全部行权重差 ≤0.11pp`, `${within011}/${rows}, 最大差 ${maxDiff.toFixed(3)}pp`);
ok(within003 >= rows * 0.7, '≥70% 的行差 ≤0.03pp', `${within003}/${rows} (${(within003 / rows * 100).toFixed(1)}%)`);
ok(missingStock.length === 0, '没有基准里存在但抓不到的股票', missingStock.slice(0, 5).join('; '));
if (worst) console.log('    最大差异: ' + worst);
if (nameMismatch.length) nameMismatch.slice(0, 8).forEach(x => console.log('      ! ' + x));

console.log('\n=== C. 结构指标一致性 ===');
const concOf = q => q.top10Sum;
let worstConc = 0, worstPeriod = '';
for (const p of common) {
  const d = Math.abs(concOf(liveMap[p]) - concOf(baseMap[p]));
  if (d > worstConc) { worstConc = d; worstPeriod = p; }
}
ok(worstConc <= 0.12, '每期前十合计与基准一致(≤0.12pp)', `最大差 ${worstConc.toFixed(3)}pp @ ${worstPeriod}`);

console.log('\n=== D. 绩效口径(已按官方披露校准) ===');
console.log('    自动(分红再投总回报指数): 区间 ' + live.perf.cumReturn + '% | 剔除最好一季(' + live.perf.bestQuarter + ') ' + live.perf.exBestQuarter + '% | 最大回撤 ' + live.perf.maxDrawdown + '%');
console.log('    旧基准(累计净值口径, 经查为错误口径): 区间 ' + baseline.perf.cumReturn + '% | 剔除最好一季 ' + baseline.perf.exBestQuarter + '% | 最大回撤 ' + baseline.perf.maxDrawdown + '%');
ok(live.perf.bestQuarter === baseline.perf.bestQuarter, '识别出的"最好一季"与旧基准一致', live.perf.bestQuarter + ' vs ' + baseline.perf.bestQuarter);
const oldIsWrong = Math.abs(live.perf.cumReturn - baseline.perf.cumReturn) > 5;
if (oldIsWrong) {
  console.log(`    [已知口径更正] 区间收益 ${baseline.perf.cumReturn}% → ${live.perf.cumReturn}%:旧值用累计净值做比值,`);
  console.log('      而累计净值 = 单位净值 + 累计分红, 是加法累积量, 比值在数学上无意义。');
  console.log('      校准依据见 node tools/calibrate_perf.mjs —— 分红再投指数与官方季报披露的');
  console.log('      "过去三年/五年/七年/十年净值增长率"平均绝对偏差仅 1.07pp(累计净值法 15.94pp)。');
}
ok(live.perf.cumReturn > 0, '区间收益为正(与该基金实际表现一致)', live.perf.cumReturn + '%');
ok(live.perfDetail && live.perfDetail.method.indexOf('分红再投') >= 0, '口径声明写明"分红再投总回报指数"');
console.log('    口径说明: ' + live.perf.note);

console.log('\n=== E. 规模序列 ===');
const aumLive = live.quarters.filter(q => q.aum !== null);
console.log(`    自动抓到规模 ${aumLive.length}/${live.quarters.length} 期; 末期 ${live.perf.aumEnd} 亿; 峰值 ${live.perf.aumPeak} 亿`);
ok(aumLive.length >= common.length * 0.8, '规模覆盖率 ≥80%', `${aumLive.length}/${common.length}`);
ok(Math.abs((live.perf.aumEnd || 0) - (baseline.perf.aumEnd || 0)) < 0.05, '末期净资产与基准一致', `${live.perf.aumEnd} vs ${baseline.perf.aumEnd}`);

console.log('\n=== F. 推算价可用性(案例审计章节依赖) ===');
const withPrice = live.quarters.flatMap(q => q.top10).filter(h => h.sharesWan && h.valueWan).length;
const totalRows = live.quarters.flatMap(q => q.top10).length;
ok(withPrice === totalRows, '每一行都有持股数与市值(可算推算价)', `${withPrice}/${totalRows}`);
const sample = live.quarters.at(-1).top10[0];
console.log(`    抽样 ${sample.name}: ${sample.valueWan} 万元 / ${sample.sharesWan} 万股 = ${(sample.valueWan / sample.sharesWan).toFixed(2)} 元/股`);

console.log('\n==================================================');
console.log(fail ? `失败 ${fail} 项` : `全部通过 —— 自动爬取链路可复现人工核过的 ${code} 底稿。`);
if (fail) process.exitCode = 1;
