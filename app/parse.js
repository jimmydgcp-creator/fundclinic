/* 基金复诊台 · 输入解析
 * 职责: 把「从季报/天天基金导出的表格文本」解析成统一 schema; 解析阶段就做结构与口径校验。
 * 设计约束: file:// 下不能 fetch, 所以内置样例来自 data/funds.data.js, 用户数据来自粘贴框。
 */
window.FC = window.FC || {};
(function (FC) {
  'use strict';

  var HEADER_ALIASES = {
    period: ['报告期', '季度', '期次', 'period', 'quarter'],
    rank: ['排名', '序号', 'rank', 'no'],
    code: ['股票代码', '证券代码', '代码', 'code'],
    name: ['股票名称', '证券名称', '股票', '名称', 'name'],
    weight: ['占净值', '占净值比例', '权重', '净值占比', 'weight'],
    shares: ['持股数', '持股数量'],
    value: ['持仓市值', '公允价值', '市值'],
    theme: ['主题', '行业', '板块'],
    aum: ['净资产', '规模'],
    nav: ['单位净值', '净值']
  };

  function normKey(s) { return String(s || '').replace(/[\s()（）%％]/g, ''); }

  /** 表头识别: 打分式匹配, 避免"股票代码"被"股票"这个别名抢走。
   *  规则: 完全相等 > 更长的别名包含 > 更短的别名包含; 同一列不被两个字段占用。 */
  function detectHeader(cells) {
    var cands = [];
    cells.forEach(function (c, i) {
      var k = normKey(c);
      if (!k) return;
      Object.keys(HEADER_ALIASES).forEach(function (field) {
        HEADER_ALIASES[field].forEach(function (a) {
          var na = normKey(a);
          if (!na) return;
          if (k === na) cands.push({ field: field, idx: i, score: 1000 + na.length });
          else if (k.indexOf(na) >= 0) cands.push({ field: field, idx: i, score: na.length });
        });
      });
    });
    cands.sort(function (x, y) { return y.score - x.score; });
    var map = {}, usedIdx = {};
    cands.forEach(function (cd) {
      if (map[cd.field] !== undefined || usedIdx[cd.idx]) return;
      map[cd.field] = cd.idx;
      usedIdx[cd.idx] = 1;
    });
    return map;
  }

  function toNum(x) {
    if (x === null || x === undefined) return null;
    var s = String(x).replace(/[%％,，\s]/g, '');
    if (s === '' || s === '-' || s === '—' || s === '---') return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function splitRows(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (l) { return l.replace(/\s+$/, ''); })
      .filter(function (l) { return l.trim() !== ''; });
  }

  function splitCells(line) {
    if (line.indexOf('\t') >= 0) return line.split('\t');
    if (line.indexOf(',') >= 0) return line.split(',');
    // 空格分隔: 仅当没有制表符/逗号时尝试(中文股票名不含空格)
    return line.split(/\s{2,}|\s+/);
  }

  /** 解析粘贴文本 -> { dataset, report } */
  FC.parsePaste = function (text, meta) {
    meta = meta || {};
    var lines = splitRows(text);
    var issues = [];
    if (!lines.length) return { dataset: null, report: { ok: false, issues: [{ level: 'fail', msg: '粘贴内容为空。' }] } };

    // 找表头
    var headerIdx = -1, map = null;
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var m = detectHeader(splitCells(lines[i]));
      if (m.period !== undefined && (m.name !== undefined || m.code !== undefined) && m.weight !== undefined) {
        headerIdx = i; map = m; break;
      }
    }

    var records = [];
    if (headerIdx < 0) {
      // 无表头: 按「报告期 排名 代码 名称 权重」的位置约定解析
      map = { period: 0, rank: 1, code: 2, name: 3, weight: 4 };
      headerIdx = -1;
      issues.push({ level: 'warn', msg: '未识别到表头, 已按「报告期 | 排名 | 代码 | 名称 | 占净值%」的位置约定解析。建议补上表头。' });
    }

    for (var j = headerIdx + 1; j < lines.length; j++) {
      var cells = splitCells(lines[j]);
      var per = (cells[map.period] || '').trim();
      per = per.replace(/[（(].*$/, '').trim();
      if (!/^\d{4}\s*[Qq季]?\s*[1-4]$/.test(per) && !/^\d{4}Q[1-4]$/i.test(per)) {
        if (per && !/^20\d\d/.test(per)) continue; // 非数据行, 跳过
      }
      per = per.replace(/\s*[季]\s*/, 'Q').replace(/q/i, 'Q').toUpperCase();
      if (!/^\d{4}Q[1-4]$/.test(per)) { issues.push({ level: 'warn', msg: '第 ' + (j + 1) + ' 行报告期无法识别: "' + per + '", 已跳过。' }); continue; }
      var w = toNum(cells[map.weight]);
      if (w === null) { issues.push({ level: 'warn', msg: '第 ' + (j + 1) + ' 行权重缺失, 已跳过。' }); continue; }
      records.push({
        period: per,
        rank: toNum(cells[map.rank]) || 0,
        code: (cells[map.code] || '').trim().replace(/^'/,'').padStart(6, '0'),
        name: (cells[map.name] || '').trim(),
        weight: w,
        sharesWan: map.shares !== undefined ? toNum(cells[map.shares]) : null,
        valueWan: map.value !== undefined ? toNum(cells[map.value]) : null,
        theme: map.theme !== undefined ? (cells[map.theme] || '').trim() : '',
        aumRaw: map.aum !== undefined ? toNum(cells[map.aum]) : null,
        navRaw: map.nav !== undefined ? toNum(cells[map.nav]) : null,
        line: j + 1
      });
    }

    if (!records.length) return { dataset: null, report: { ok: false, issues: issues.concat([{ level: 'fail', msg: '没有解析出任何有效的持仓行。请检查列是否包含: 报告期 / 排名 / 股票代码 / 股票名称 / 占净值%。' }]) } };

    // 按报告期分组
    var byPeriod = {};
    records.forEach(function (r) { (byPeriod[r.period] = byPeriod[r.period] || []).push(r); });
    var periods = Object.keys(byPeriod).sort();

    var quarters = periods.map(function (p) {
      var rs = byPeriod[p];
      rs.forEach(function (r, i) { if (!r.rank) r.rank = i + 1; });
      var byWeight = rs.slice().sort(function (a, b) { return b.weight - a.weight; });
      byWeight.forEach(function (r, i) { r.rankCalc = i + 1; });
      // 以披露排名为准, 缺失则用权重排名
      var top10 = byWeight.slice(0, 10).map(function (r) {
        return { rank: r.rankCalc, code: r.code, name: r.name, weight: r.weight, sharesWan: r.sharesWan, valueWan: r.valueWan };
      });
      var themeCount = {};
      rs.forEach(function (r) { if (r.theme) themeCount[r.theme] = (themeCount[r.theme] || 0) + r.weight; });
      var themeTop = Object.keys(themeCount).sort(function (a, b) { return themeCount[b] - themeCount[a]; })[0] || '';
      var aum = rs.map(function (r) { return r.aumRaw; }).filter(function (x) { return x !== null; })[0];
      var nav = rs.map(function (r) { return r.navRaw; }).filter(function (x) { return x !== null; })[0];
      return {
        period: p, endDate: '',
        top10: top10,
        top10Sum: Math.round(top10.reduce(function (s, h) { return s + h.weight; }, 0) * 100) / 100,
        top5Sum: Math.round(top10.slice(0, 5).reduce(function (s, h) { return s + h.weight; }, 0) * 100) / 100,
        theme: themeTop, themeWeight: themeTop ? Math.round(themeCount[themeTop] * 100) / 100 : null,
        aum: aum === undefined ? null : aum, shares: null, nav: nav === undefined ? null : nav,
        stockPos: null, aumChange: '', retained: null, jaccard: null, added: [], dropped: [],
        _rowCount: rs.length
      };
    });

    if (periods.length < 2) issues.push({ level: 'warn', msg: '只解析到 1 个报告期, 无法计算留存/换手/趋势。建议至少 4 期。' });
    if (periods.length < 4) issues.push({ level: 'warn', msg: '报告期少于 4 期, 形态判定置信度会降为"样本不足"。' });

    var dupes = {};
    records.forEach(function (r) { var k = r.period + '|' + r.name; if (dupes[k]) issues.push({ level: 'fail', msg: r.period + ' 出现重复股票: ' + r.name }); dupes[k] = 1; });

    var dataset = {
      schema: 'fundclinic/1',
      fund: {
        code: meta.code || '—', name: meta.name || '用户粘贴数据', company: '', type: '',
        manager: meta.manager || '', managerSince: '', range: periods[0] + '–' + periods[periods.length - 1],
        quarterCount: periods.length
      },
      perf: null,
      prevTenure: null,
      quarters: quarters,
      sources: ['用户粘贴(来源需自行声明; 建议注明来自公开季报或天天基金 F10)']
    };

    return {
      dataset: dataset,
      report: {
        ok: true, rowCount: records.length, periodCount: periods.length,
        periods: periods, colMap: map, issues: issues
      }
    };
  };

  /** 生成粘贴模板, 方便用户按格式填 */
  FC.pasteTemplate = function () {
    return [
      '报告期\t排名\t股票代码\t股票名称\t占净值(%)\t持股数(万股)\t持仓市值(万元)\t主题',
      '2025Q1\t1\t601699\t潞安环能\t8.21\t1520000\t23100000\t煤炭',
      '2025Q1\t2\t601001\t晋控煤业\t7.85\t1180000\t21500000\t煤炭',
      '2025Q2\t1\t601699\t潞安环能\t7.92\t1530000\t22000000\t煤炭'
    ].join('\n');
  };

  FC.builtinFunds = function () {
    var d = window.FUNDCLINIC_DATA || {};
    return Object.keys(d).map(function (k) { return { code: k, name: d[k].fund.name, quarters: d[k].quarters.length, range: d[k].fund.range, hasPerf: !!d[k].perf }; });
  };

  FC.getBuiltin = function (code) {
    var d = window.FUNDCLINIC_DATA || {};
    return d[code] || null;
  };

})(window.FC);
