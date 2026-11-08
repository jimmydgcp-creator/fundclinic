/* test_shell_interactions.mjs —— 两栏外壳的交互回归: 用 CDP 驱动无头 Edge 真的点一遍。
 *
 * 为什么必须有这个: 前面所有校验(smoke_page / layout_audit)都是"看渲染出来的样子",
 * 而这一版改的全是**动作** —— 切视图、左栏目录跳转、历史点开、新建复盘清空、口径表折起/展开、
 * 问一句抽屉、收起左栏。这些坏掉时静态截图一张都看不出来(页面照样漂亮, 点了没反应)。
 *
 * 覆盖:
 *   A 外壳结构(左栏/右栏/右栏自己滚/已复盘有内容)
 *   B 顶栏分段控件切视图
 *   C 左栏目录跳章节(且不许把 URL hash 改成锚点 → 会被当成视图路由)
 *   D 新建复盘 = 清空代码框并聚焦
 *   E 探路 → 口径表默认折起 ④~⑧ → 展开 → 「按此口径开跑」在一屏之内
 *   F 问一句抽屉 / 收起左栏 / 汉堡叫回来
 *
 * 用法: node tools/test_shell_interactions.mjs [端口] [edge调试端口]
 *   前提: 本机服务已在跑(node server.mjs, FUNDCLINIC_PORT=端口)。
 *   E 段需要真实探路(联网抓元数据)。抓不到时**跳过并说明**, 不算失败 ——
 *   否则一次网络抖动就会让整个外壳测试变红, 久了就没人跑它了。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.argv[2] || '8811';
const DBG = Number(process.argv[3] || 9333);
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = path.join(os.tmpdir(), 'fc-cdp-profile-' + DBG);

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--window-size=1440,1000', `--remote-debugging-port=${DBG}`,
  '--user-data-dir=' + profile,
  `http://127.0.0.1:${PORT}/#input`
], { stdio: 'ignore', detached: false });

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面脚本抛错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  return r.result.value;
}

let fail = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  PASS  ' + label + (extra === undefined ? '' : '  ' + extra));
  else { fail++; console.log('  FAIL  ' + label + (extra === undefined ? '' : '  ' + extra)); }
}

async function main() {
  // 等调试端口起来
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      target = list.find(t => t.type === 'page' && /127\.0\.0\.1|localhost/.test(t.url));
      if (target) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  if (!target) throw new Error('拿不到调试目标');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', ev => {
    const j = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
    if (j.id && pending.has(j.id)) {
      const p = pending.get(j.id); pending.delete(j.id);
      j.error ? p.reject(new Error(JSON.stringify(j.error))) : p.resolve(j.result);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);   // 等 FC.init + 在线检测 + 历史恢复

  console.log('=== A. 外壳基本结构 ===');
  ok(await evalJs("!!document.querySelector('.rail') && !!document.querySelector('.stage')"), '左栏与右栏都在');
  ok(await evalJs("document.body.classList.contains('shelled')"), 'body 带 shelled(两栏布局生效)');
  ok(await evalJs("getComputedStyle(document.querySelector('#stage-main')).overflowY === 'auto'"), '右栏自己滚(整页不滚)');
  ok(await evalJs("document.querySelectorAll('#rail-history .rl-i').length >= 1"), '左栏已复盘列表有内容');

  console.log('\n=== B. 视图切换(顶栏分段控件) ===');
  await evalJs("document.querySelector('#viewseg button[data-view=ledger]').click()");
  await sleep(400);
  ok(await evalJs("document.querySelector('#view-ledger').classList.contains('active')"), '点「数据底稿」切过去了');
  ok(await evalJs("document.querySelector('#viewseg button[data-view=ledger]').classList.contains('active')"), '分段控件自身高亮同步');

  console.log('\n=== C. 左栏目录跳章节(不许改 URL#) ===');
  await evalJs("document.querySelector('#viewseg button[data-view=report]').click()");
  await sleep(500);
  const hash0 = await evalJs('location.hash');
  const dirCount = await evalJs("document.querySelectorAll('#rail-dir a').length");
  ok(dirCount > 3, '左栏目录有条目', dirCount + ' 条');
  await evalJs("document.querySelectorAll('#rail-dir a')[3].click()");
  await sleep(900);
  ok(await evalJs("document.querySelector('#stage-main').scrollTop > 100"), '正文滚起来了',
    'scrollTop=' + (await evalJs("Math.round(document.querySelector('#stage-main').scrollTop)")));
  ok((await evalJs('location.hash')) === '#report', 'URL 仍是 #report(没被目录锚点劫持)');

  console.log('\n=== D. 新建复盘 = 清空代码框并聚焦 ===');
  await evalJs("document.querySelector('#btn-new-run').click()");
  await sleep(400);
  ok((await evalJs("document.querySelector('#online-code').value")) === '', '代码框已清空');
  ok(await evalJs("document.activeElement && document.activeElement.id === 'online-code'"), '焦点在代码框上');

  console.log('\n=== E. 探路 → 口径表折起 → 展开 ===');
  await evalJs("document.querySelector('#viewseg button[data-view=input]').click()");
  await sleep(300);
  /* 两种形态都要能用: 服务端已有 Key(llm.local.json / 环境变量)时页面上没有表单, 只填代码;
     服务端没 Key 时才需要往表单里塞一个。先探一下 ai-block 是不是收起来的。 */
  const keyFormHidden = await evalJs("document.querySelector('#ai-block').classList.contains('hidden')");
  if (!keyFormHidden) {
    await evalJs("(function(){var k=document.querySelector('#ai-key');k.value='sk-dummy-1234567890abcdef';k.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
  }
  await evalJs("(function(){var c=document.querySelector('#online-code');c.value='519191';c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
  await sleep(300);
  ok(!(await evalJs("document.querySelector('#btn-online-probe').disabled")),
    '探路按钮可点了(' + (keyFormHidden ? '服务端已有 Key, 只填代码' : '代码 + 表单里的 Key') + ')');
  await evalJs("document.querySelector('#btn-online-probe').click()");
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    ready = await evalJs("!document.querySelector('#gate1-table').classList.contains('hidden')");
    if (ready) break;
  }
  if (!ready) {
    console.log('  SKIP  探路没完成(网络/行情源原因), 跳过 E 段 —— 这不代表外壳坏了, 手动跑一次再回来测');
  } else {
    console.log('  PASS  探路完成, 口径表出现了');
    ok(await evalJs("document.querySelectorAll('#gate1-body tr').length >= 4"), '口径表至少 4 行(3 核心 + 1 摘要行)',
      (await evalJs("document.querySelectorAll('#gate1-body tr').length")) + ' 行');
    ok(await evalJs("document.querySelectorAll('#gate1-body tr.gate-rest.hidden').length === 5"), '④~⑧ 默认折起(5 行隐藏)');
    ok(await evalJs("!!document.querySelector('#btn-gate-more')"), '有「展开 ④ ~ ⑧」按钮');
    const btnRect = await evalJs("(function(){var b=document.querySelector('#btn-online-run');var r=b.getBoundingClientRect();return {top:Math.round(r.top),h:innerHeight};})()");
    /* 口径表里 ② 的共管期清单、③ 的候选标签长度会随基金变化, 高度差 100~200px 是正常的;
       这里卡的是"不用翻到第二屏以后"(阈值 1.3 屏): 折叠做完前实测过 2040px(相当于两屏半), 那才是真回退。 */
    ok(btnRect.top < btnRect.h * 1.3, '「按此口径开跑」不用翻到第二屏以后',
      '按钮顶边 y=' + btnRect.top + ' / 屏高 ' + btnRect.h + ' / 上限 ' + Math.round(btnRect.h * 1.3));
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'tools', '_smoke', 'shell_gate1.png'), Buffer.from(shot1.data, 'base64'));
    await evalJs("document.querySelector('#btn-gate-more').click()");
    await sleep(300);
    ok(await evalJs("document.querySelectorAll('#gate1-body tr.gate-rest.hidden').length === 0"), '展开后 5 行都出来了');
    ok((await evalJs("document.querySelector('#btn-gate-more').textContent")).indexOf('收起') >= 0, '按钮文案变成"收起"');
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'tools', '_smoke', 'shell_gate1_open.png'), Buffer.from(shot2.data, 'base64'));
    await evalJs("document.querySelector('#btn-gate-more').click()");
  }

  console.log('\n=== F. 问一句抽屉 / 收左栏 ===');
  await evalJs("document.querySelector('#btn-ask').click()");
  await sleep(400);
  ok(await evalJs("document.querySelector('#ask-drawer').classList.contains('open')"), '点左栏「问一句」抽屉打开了');
  ok(await evalJs("getComputedStyle(document.querySelector('.ask-fab')).display === 'none'"), '悬浮球已收掉(不挡正文)');
  await evalJs("document.querySelector('#ask-x').click()");
  await sleep(300);
  await evalJs("document.querySelector('#rail-fold').click()");
  await sleep(300);
  ok(await evalJs("document.body.classList.contains('rail-collapsed')"), '左栏能收起来');
  ok(await evalJs("getComputedStyle(document.querySelector('#sb-menu')).display !== 'none'"), '收起后顶栏出现汉堡');
  await evalJs("document.querySelector('#sb-menu').click()");
  await sleep(300);
  ok(!(await evalJs("document.body.classList.contains('rail-collapsed')")), '再点一次汉堡能叫回来');

  console.log('\n====================');
  console.log(fail ? `失败 ${fail} 项` : '全部通过。');
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('驱动失败: ' + e.message); process.exitCode = 1; })
  .finally(() => { try { ws && ws.close(); } catch (e) {} try { child.kill(); } catch (e) {} });
