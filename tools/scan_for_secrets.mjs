/* 密钥泄露扫描: 把要发出去的包逐文件、逐字节查一遍, 找有没有 API Key 或任何凭证。
 *
 * 为什么单独写一个而不是"我记得没放": 发出去就收不回来。要查的是**事实**, 不是记忆。
 * 查什么:
 *   ① 任何 sk- 开头的串(DeepSeek/OpenAI 风格密钥)
 *   ② apiKey / api_key / Authorization / Bearer 后面跟着非空值
 *   ③ llm.local.json 这种真实配置文件(只允许 .example 模板)
 *   ④ 长的高熵串(32 位以上无明显语义的字母数字混合) —— 兜底找漏网的 token
 *   ⑤ 本机路径里的用户名等环境痕迹
 * 用法: node tools/scan_for_secrets.mjs [目录或zip]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const target = process.argv[2] || path.join(ROOT, '_dist', '基金复诊台_发给组员');

function walk(p, acc = []) {
  const st = fs.statSync(p);
  if (st.isFile()) { acc.push(p); return acc; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) walk(path.join(p, e.name), acc);
  return acc;
}

const files = walk(target);
console.log('扫描目标: ' + target);
console.log('文件数:   ' + files.length);

/* 文本类才逐字节查; 二进制只查 sk- 字面量 */
const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|md|txt|bat|example|yml|yaml)$/i;

const RULES = [
  { id: 'sk-密钥字面量', re: /sk-[A-Za-z0-9_-]{16,}/g, level: 'fail' },
  { id: 'apiKey 被赋了非空值', re: /["']?api_?key["']?\s*[:=]\s*["'][^"'\s]{12,}["']/gi, level: 'fail' },
  { id: 'Authorization/Bearer 带值', re: /(?:Authorization|Bearer)["'\s:]+[A-Za-z0-9_.-]{20,}/g, level: 'fail' },
  { id: '疑似真实配置文件 llm.local.json', re: /^llm\.local\.json$/i, onPath: true, level: 'fail' },
  { id: '高熵长串(>=32, 字母数字混合)', re: /\b(?=[A-Za-z0-9]{32,})(?=[^A-Za-z0-9]*[A-Za-z])(?=[^A-Za-z0-9]*\d)[A-Za-z0-9]{32,}\b/g, level: 'warn' },
  { id: '本机用户名痕迹', re: /75719/g, level: 'warn' },
  { id: '本机绝对路径泄漏', re: /C:\\Users\\[^\\"'\s]+/g, level: 'warn' }
];

const hits = [];
for (const f of files) {
  const rel = path.relative(target, f);
  const isText = TEXT_EXT.test(f);
  const buf = fs.readFileSync(f);
  const text = isText ? buf.toString('utf8') : buf.toString('latin1');
  for (const r of RULES) {
    if (r.onPath) {
      if (r.re.test(path.basename(f))) hits.push({ rule: r.id, level: r.level, file: rel, sample: path.basename(f) });
      continue;
    }
    const m = text.match(r.re);
    if (m) hits.push({ rule: r.id, level: r.level, file: rel, sample: [...new Set(m)].slice(0, 3).join(' | ').slice(0, 120) });
  }
}

/* 单独看那个 example 模板到底写了什么 —— 它是最容易被误当成"无害模板"的地方 */
const ex = files.find(f => /llm\.local\.json\.example$/i.test(f));
console.log('\n--- llm.local.json.example 全文 ---');
if (ex) {
  fs.readFileSync(ex, 'utf8').split(/\r?\n/).forEach(l => console.log('  ' + l));
} else {
  console.log('  (包内没有这个文件)');
}

console.log('\n--- 扫描结果 ---');
if (!hits.length) {
  console.log('  未发现任何密钥或凭证痕迹。');
} else {
  const order = { fail: 0, warn: 1 };
  hits.sort((a, b) => order[a.level] - order[b.level]);
  for (const h of hits) console.log(`  [${h.level}] ${h.rule}\n         文件: ${h.file}\n         命中: ${h.sample}`);
}

/* 另外确认: 本项目目录里有没有真的 llm.local.json(有的话说明本机存过 Key) */
const realCfg = path.join(ROOT, 'llm.local.json');
console.log('\n--- 本机是否存在真实配置文件 ---');
console.log('  ' + realCfg + ' : ' + (fs.existsSync(realCfg) ? '存在 !!' : '不存在 ✓'));
const envKey = process.env.FUNDCLINIC_LLM_KEY || process.env.DEEPSEEK_API_KEY || '';
console.log('  环境变量里的 Key: ' + (envKey ? '有(但环境变量不会进压缩包)' : '无'));

const fails = hits.filter(h => h.level === 'fail').length;
console.log('\n结论: ' + (fails ? `!! 有 ${fails} 处必须处理` : '没有密钥会被发出去。'));
