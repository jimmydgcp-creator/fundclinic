/* 极简 CDP 驱动：连上已经在跑的 Edge，按 URL 发命令。
 * 不引第三方依赖 —— Node 22 自带 WebSocket。 */
import fs from 'node:fs';

export async function connect(match = 'fundclinic') {
  const list = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(match)) || list.find((t) => t.type === 'page');
  if (!page) throw new Error('没找到页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (waiting.has(i)) { waiting.delete(i); rej(new Error('timeout: ' + method)); } }, 120000);
  });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS 错误: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  };

  const goto = async (url) => {
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 3000));
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return { send, evaluate, shot, goto, sleep, close: () => ws.close() };
}
