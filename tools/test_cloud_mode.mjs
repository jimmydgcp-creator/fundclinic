/* 验证云端模式的端口/监听改动没破坏本地行为, 且云端行为真的对。
 *
 * 为什么值得单独测: 这两个变量(FUNDCLINIC_PORT / PORT)是"本地能用"和"公网能部署"
 * 的分水岭 —— 改错了要么本地双击起不来, 要么部署上去平台探活探不到(表现是 502)。
 *
 * 用法: node tools/test_cloud_mode.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function boot(env, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let done = false;
    const finish = (ok, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, out, note, child });
    };
    const timer = setTimeout(() => finish(false, '超时未启动'), 20000);
    child.stdout.on('data', b => { out += b.toString('utf8'); });
    child.stderr.on('data', b => { out += b.toString('utf8'); });
    child.on('exit', c => finish(false, '进程提前退出 code=' + c));

    (async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 400));
        if (/已启动/.test(out)) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/api/health`);
            const j = await r.json();
            return finish(r.ok && j && j.ok, 'health ok=' + (j && j.ok));
          } catch (e) { return finish(false, 'health 请求失败: ' + e.message); }
        }
      }
    })();
  });
}

const cases = [
  {
    name: '① 本地默认(不设任何变量) → 只监听 127.0.0.1:8787',
    env: {}, port: 8787,
    expect: o => /http:\/\/127\.0\.0\.1:8787/.test(o) && !/云端模式/.test(o)
  },
  {
    name: '② 本地换端口(FUNDCLINIC_PORT=8811) → 只认专用变量',
    env: { FUNDCLINIC_PORT: '8811' }, port: 8811,
    expect: o => /http:\/\/127\.0\.0\.1:8811/.test(o)
  },
  {
    name: '③ 本地**不理**通用 PORT(设 PORT=8812 但没开云模式) → 仍走 8787',
    env: { PORT: '8812' }, port: 8787,
    expect: o => /http:\/\/127\.0\.0\.1:8787/.test(o) && !/8812/.test(o)
  },
  {
    name: '④ 云端模式(FUNDCLINIC_CLOUD=1 + PORT=8813) → 认 PORT 且监听 0.0.0.0',
    env: { FUNDCLINIC_CLOUD: '1', PORT: '8813' }, port: 8813,
    expect: o => /云端模式/.test(o) && /0\.0\.0\.0:8813/.test(o)
  },
  {
    name: '⑤ 平台自报家门(RENDER=true)也能自动进云模式',
    env: { RENDER: 'true', PORT: '8814' }, port: 8814,
    expect: o => /云端模式/.test(o) && /0\.0\.0\.0:8814/.test(o)
  }
];

let bad = 0;
for (const c of cases) {
  const r = await boot(c.env, c.port);
  const pass = r.ok && c.expect(r.out);
  if (!pass) bad++;
  console.log((pass ? '  ✓ ' : '  ✗ ') + c.name + (pass ? '' : '   ← ' + r.note));
  if (!pass) console.log(r.out.split('\n').filter(l => /监听|打开|已启动|失败|Error/.test(l)).join('\n'));
  try { r.child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  await new Promise(res => setTimeout(res, 500));
}
console.log(bad === 0 ? '\n全部通过。本地行为未变，云端模式可用。' : `\n${bad} 项失败。`);
process.exit(bad === 0 ? 0 : 1);
