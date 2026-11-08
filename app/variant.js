/* 复盘台变体的少量脚本：在首屏注入一条"能力条"。
 * 只放能核对的事实（内置样例数从 FC 里取，其余是公开文档里的固定项），不放编造的运行数据。 */
(function (window) {
  'use strict';
  var FC = window.FC || (window.FC = {});

  function kpis() {
    var n = 0;
    try { n = (FC.builtinFunds ? FC.builtinFunds().length : 0); } catch (e) { n = 0; }
    return [
      { k: '内置样例', v: (n || '—') + '<small> 只</small>', s: '已与官方季报对过账' },
      { k: '公开来源', v: '6<small> 类</small>', s: '官方定期报告为最高权威' },
      { k: '质检规则', v: '18<small> 条</small>', s: '数字 / 结论 / 合规 三查' },
      { k: '自测断言', v: '76<small> 项</small>', s: '全绿才允许导出' }
    ];
  }

  function mount() {
    var host = document.querySelector('#view-input .page-head') || document.querySelector('#view-input');
    if (!host || document.querySelector('.wb-kpis')) return;
    var box = document.createElement('div');
    box.className = 'wb-kpis';
    box.innerHTML = kpis().map(function (x) {
      return '<div class="wb-kpi"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div><div class="s">' + x.s + '</div></div>';
    }).join('');
    host.parentNode.insertBefore(box, host);
  }

  function init() {
    /* 等 ui.js 把内置样例读出来再挂，最多等 1.5 秒 */
    var t = 0;
    (function tick() {
      var ready = false;
      try { ready = !!(FC.builtinFunds && FC.builtinFunds().length); } catch (e) { ready = false; }
      mount();
      if (!ready && t < 15) { t++; setTimeout(tick, 100); }
    })();
  }

  FC.initVariant = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
