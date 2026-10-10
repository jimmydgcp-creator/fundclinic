/* 让 Node 复用浏览器里那套引擎, 避免"服务端一份、前端一份"两份逻辑走偏。
 * app/*.js 是浏览器脚本(window.FC), 这里用 vm 造一个最小 window 环境把它们装进来。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const MODULES = ['data/funds.data.js', 'app/engine.js', 'app/parse.js', 'app/checker.js', 'app/ai.js'];

let cached = null;
export function getFC() {
  if (cached) return cached;
  const sandbox = { console, window: {}, fetch: globalThis.fetch, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  for (const f of MODULES) {
    const fp = path.join(ROOT, f);
    vm.runInContext(fs.readFileSync(fp, 'utf8'), sandbox, { filename: f });
  }
  cached = sandbox.window.FC;
  return cached;
}

export { ROOT };

/** 跑完整条"分析 + 质检"链路, 返回可 JSON 序列化的结果。 */
export function analyzeDataset(dataset, source) {
  const FC = getFC();
  const analysis = FC.analyze(dataset, { source: source || 'crawled' });
  if (analysis.error) return { error: analysis.error };
  const check = FC.runCheck(dataset, analysis);
  return { FC, analysis, check };
}
