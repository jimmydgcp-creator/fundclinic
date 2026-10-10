/* 把流水线发的进度消息映射到界面上的 7 个阶段。
 *
 * 为什么单独成一个文件: 这段映射必须有测试, 否则正则写错了只会表现为"进度条卡住不动",
 * 而且是在演示现场才发现。
 *
 * 怎么被加载: 和 app/ 下其它文件一样, 是**浏览器脚本**(挂到 window.FC.steps)。
 * 测试那边不能 require 它 —— 根目录 package.json 里写了 "type": "module",
 * 所以 Node 会把 .js 当成 ESM, `require()` 回来的是空对象(踩过)。
 * 正确做法是照 server/engine.mjs 的路子, 用 vm 造个 window 把它装进来。
 */
(function (root, factory) {
  root.FC = root.FC || {};
  root.FC.steps = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SEQ = ['probe', 'crawl', 'parse', 'official', 'engine', 'ai', 'done'];

  var RULES = [
    /* 「导出 PDF」必须排在 AI 规则前面: T6 演示稿的正文里也含"演示稿"三个字,
       不先拦住它, 导出阶段会被误判成大模型阶段。 */
    [/导出 PDF/, 'done'],
    [/生成交付物|AI 模块|^T[1-6]\s|深度复盘|演示稿|主题归类|判断起草|用词清洗/, 'ai'],
    [/规则引擎/, 'engine'],
    [/官方定期报告|官方对账|官方窗口校准|逐行对账|Poppler|pdftotext/, 'official'],
    [/落盘清洗|清洗三规则/, 'parse'],
    [/数据采集|抓取|采集完成|六类/, 'crawl'],
    [/探路/, 'probe']
  ];

  /** 消息 → 阶段下标; 没有匹配到返回 -1(调用方必须**保持原状态**, 不要乱跳) */
  function indexOf(msg) {
    var s = String(msg == null ? '' : msg);
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(s)) return SEQ.indexOf(RULES[i][1]);
    return -1;
  }

  /** 一串消息 → 阶段推进序列(只前进不后退), 供测试断言用 */
  function sequence(msgs) {
    var at = -1, out = [];
    for (var i = 0; i < msgs.length; i++) {
      var idx = indexOf(msgs[i]);
      if (idx < 0 || idx <= at) continue;
      out.push({ msg: msgs[i], step: SEQ[idx], index: idx });
      at = idx;
    }
    return out;
  }

  return { SEQ: SEQ, RULES: RULES, indexOf: indexOf, sequence: sequence };
});
