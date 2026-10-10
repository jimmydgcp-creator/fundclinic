/* 演示稿主题库:12 套可切换皮肤, 移植自原版 519191 演示稿的主题系统。
 *
 * 移植时做了三处必要改造(否则"发给别人"就会出问题):
 *   ① 字体全部换成**本机字体栈** —— 原版引用 Inter / Playfair Display / Archivo Black 等网络字体,
 *      别人电脑没装就会静默回落到默认字体, 主题看起来就"坏"了。这里只用 Windows/macOS 自带字体:
 *      中文黑体走 微软雅黑 / 苹方, 中文衬线走 宋体 / 苹方宋, 等宽走 Consolas。
 *   ② 删掉所有 -webkit-text-fill-color: transparent 的渐变字 —— 它在 PDF 里会渲染成空白。
 *      渐变改用 background-image + 背景色块 / 边框色来表达。
 *   ③ 不写任何 animation … both 的初始隐藏态 —— 打印/截图会整块丢字。
 *
 * 每套主题 = 一组 CSS 变量 + 少量结构性规则(圆角/边框/阴影/首行强调条)。
 */

const SANS = `"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif`;
const SERIF = `Georgia,"Times New Roman","Songti SC",SimSun,"Noto Serif SC",serif`;
const DISPLAY = `"Microsoft YaHei","Segoe UI","PingFang SC",sans-serif`;
const MONO = `Consolas,"Cascadia Mono",ui-monospace,monospace`;
const HEI = `"Microsoft YaHei","PingFang SC",sans-serif`;

export const THEMES = [
  {
    id: 'corporate-clean', name: '企业商务',
    vars: `
      --bg:#ffffff;--bg-soft:#f5f7fa;--surface:#ffffff;--surface-2:#f0f3f7;
      --border:rgba(10,37,64,.12);--border-strong:rgba(10,37,64,.28);
      --text-1:#0a2540;--text-2:#425466;--text-3:#8898aa;
      --accent:#0a2540;--accent-2:#1d4ed8;--accent-3:#64748b;
      --good:#0e9f6e;--warn:#d97706;--bad:#dc2626;
      --grad:linear-gradient(135deg,#0a2540,#1d4ed8);
      --grad-soft:linear-gradient(135deg,#f0f4fb,#e4ecf7);
      --radius:6px;--radius-sm:4px;--radius-lg:10px;
      --shadow:0 1px 3px rgba(10,37,64,.08),0 4px 12px rgba(10,37,64,.05);
      --shadow-lg:0 4px 12px rgba(10,37,64,.1),0 16px 40px rgba(10,37,64,.08);
      --font-sans:${SANS};--font-display:${DISPLAY};--font-serif:${SERIF};`,
    extra: `.card{border:1px solid var(--border)}
      h2{border-bottom-color:var(--accent-2)}`
  },
  {
    id: 'minimal-white', name: '极简白',
    vars: `
      --bg:#ffffff;--bg-soft:#fafafa;--surface:#ffffff;--surface-2:#f5f5f6;
      --border:rgba(17,18,22,.08);--border-strong:rgba(17,18,22,.16);
      --text-1:#0c0d10;--text-2:#55596a;--text-3:#9ca1b0;
      --accent:#111216;--accent-2:#3b3f4a;--accent-3:#6b6f7a;
      --good:#1aaf6c;--warn:#c98500;--bad:#c13a3a;
      --grad:linear-gradient(135deg,#111216,#3b3f4a);
      --grad-soft:linear-gradient(135deg,#f5f5f6,#ffffff);
      --radius:14px;--radius-sm:8px;--radius-lg:22px;
      --shadow:0 1px 2px rgba(17,18,22,.04),0 8px 24px rgba(17,18,22,.06);
      --shadow-lg:0 20px 60px rgba(17,18,22,.1);
      --font-sans:${SANS};--font-display:${DISPLAY};--font-serif:${SERIF};
      --letter-tight:-.035em;`,
    extra: `.card{background:var(--surface);border:1px solid var(--border)}
      h2{border-bottom-width:1px;border-bottom-color:var(--border-strong)}`
  },
  {
    id: 'swiss-grid', name: '瑞士网格',
    vars: `
      --bg:#ffffff;--bg-soft:#f4f4f4;--surface:#ffffff;--surface-2:#f4f4f4;
      --border:#111111;--border-strong:#111111;
      --text-1:#111111;--text-2:#444444;--text-3:#888888;
      --accent:#d6001c;--accent-2:#111111;--accent-3:#888888;
      --good:#0f8a2f;--warn:#d38a00;--bad:#d6001c;
      --grad:linear-gradient(135deg,#d6001c,#111111);
      --grad-soft:linear-gradient(135deg,#f4f4f4,#ffffff);
      --radius:0px;--radius-sm:0px;--radius-lg:0px;
      --shadow:none;--shadow-lg:none;
      --font-sans:${HEI};--font-display:${HEI};--font-serif:${SERIF};
      --letter-tight:-.04em;`,
    extra: `.card{border:none;border-top:2px solid var(--text-1);border-bottom:1px solid var(--text-1);background:var(--surface)}
      .slide{background-image:linear-gradient(90deg,rgba(0,0,0,.045) 1px,transparent 1px);background-size:calc(100%/12) 100%}
      .slide>*{position:relative;z-index:2}
      h2{border-bottom:3px solid var(--accent)}`
  },
  {
    id: 'editorial-serif', name: '杂志衬线',
    vars: `
      --bg:#faf7f2;--bg-soft:#f3efe6;--surface:#ffffff;--surface-2:#f7f2e8;
      --border:rgba(40,28,18,.12);--border-strong:rgba(40,28,18,.24);
      --text-1:#1b1410;--text-2:#5c4a3e;--text-3:#8a7868;
      --accent:#8a2a1c;--accent-2:#c97a4a;--accent-3:#1b1410;
      --good:#3f7d4f;--warn:#b07a1f;--bad:#8a2a1c;
      --grad:linear-gradient(135deg,#8a2a1c,#c97a4a);
      --grad-soft:linear-gradient(135deg,#faf7f2,#f3efe6);
      --radius:4px;--radius-sm:2px;--radius-lg:8px;
      --shadow:0 2px 12px rgba(40,28,18,.06);
      --shadow-lg:0 20px 50px rgba(40,28,18,.14);
      --font-sans:${SERIF};--font-display:${SERIF};--font-serif:${SERIF};
      --letter-tight:-.02em;`,
    extra: `body{font-family:var(--font-serif)}
      h1,h2{font-style:italic;font-weight:600}
      h2{border-bottom:2px solid var(--accent-2)}`
  },
  {
    id: 'academic-paper', name: '学术论文',
    vars: `
      --bg:#fdfcf8;--bg-soft:#f7f5ed;--surface:#ffffff;--surface-2:#f5f3ea;
      --border:rgba(20,20,20,.14);--border-strong:rgba(20,20,20,.35);
      --text-1:#0a0a0a;--text-2:#333333;--text-3:#707070;
      --accent:#1a3a7a;--accent-2:#0a0a0a;--accent-3:#8a1a1a;
      --good:#1a5a2a;--warn:#8a6a1a;--bad:#8a1a1a;
      --grad:linear-gradient(135deg,#1a3a7a,#0a0a0a);
      --grad-soft:linear-gradient(135deg,#e8edf8,#f5f3ea);
      --radius:0px;--radius-sm:0px;--radius-lg:0px;
      --shadow:none;--shadow-lg:0 1px 2px rgba(0,0,0,.1);
      --font-sans:${SERIF};--font-display:${SERIF};--font-serif:${SERIF};`,
    extra: `body{font-family:var(--font-serif)}
      h1,h2{font-family:var(--font-serif);font-weight:700}
      .card{border:1px solid var(--border);box-shadow:none}
      h2{border-bottom:2px solid var(--text-1)}
      .kicker{font-style:italic;letter-spacing:.02em}`
  },
  {
    id: 'sharp-mono', name: '锐利黑白',
    vars: `
      --bg:#ffffff;--bg-soft:#ffffff;--surface:#ffffff;--surface-2:#000000;
      --border:#000000;--border-strong:#000000;
      --text-1:#000000;--text-2:#1a1a1a;--text-3:#4a4a4a;
      --accent:#000000;--accent-2:#000000;--accent-3:#ff2200;
      --good:#008800;--warn:#ff9900;--bad:#ff0000;
      --grad:linear-gradient(135deg,#000000,#222222);
      --grad-soft:linear-gradient(135deg,#ffffff,#eeeeee);
      --radius:0;--radius-sm:0;--radius-lg:0;
      --shadow:4px 4px 0 #000000;--shadow-lg:8px 8px 0 #000000;
      --font-sans:${HEI};--font-display:${HEI};--font-serif:${SERIF};
      --letter-tight:-.04em;`,
    extra: `h1,h2{text-transform:uppercase;letter-spacing:var(--letter-tight)}
      .card{border:2px solid #000;box-shadow:var(--shadow)}
      h2{border-bottom:3px solid #000}`
  },
  {
    id: 'magazine-bold', name: '杂志大标题',
    vars: `
      --bg:#f5efe2;--bg-soft:#ebe4d2;--surface:#fbf6e8;--surface-2:#ede5d0;
      --border:rgba(10,10,10,.16);--border-strong:#0a0a0a;
      --text-1:#0a0a0a;--text-2:#2a2a2a;--text-3:#6a6458;
      --accent:#ea5a1a;--accent-2:#0a0a0a;--accent-3:#c42a10;
      --good:#2a6a2a;--warn:#ea5a1a;--bad:#c42a10;
      --grad:linear-gradient(135deg,#ea5a1a,#c42a10);
      --grad-soft:linear-gradient(135deg,#fbe4d0,#f5d6c0);
      --radius:0px;--radius-sm:0px;--radius-lg:2px;
      --shadow:none;--shadow-lg:6px 6px 0 var(--accent);
      --font-sans:${SANS};--font-display:${SERIF};--font-serif:${SERIF};`,
    extra: `h1,h2{font-family:var(--font-serif);font-weight:900;letter-spacing:-.03em}
      h2{border-bottom:6px solid var(--accent)}
      .card{border:1.5px solid var(--text-1)}
      .kicker{text-transform:uppercase;letter-spacing:.22em;font-weight:700}`
  },
  {
    id: 'japanese-minimal', name: '和风极简',
    vars: `
      --bg:#fafaf5;--bg-soft:#f2f0e6;--surface:#ffffff;--surface-2:#f5f3ea;
      --border:rgba(40,30,20,.1);--border-strong:rgba(40,30,20,.3);
      --text-1:#1a1a18;--text-2:#5c564c;--text-3:#9c958a;
      --accent:#d93a2a;--accent-2:#1a1a18;--accent-3:#c9a961;
      --good:#4a6b3e;--warn:#c9a961;--bad:#d93a2a;
      --grad:linear-gradient(135deg,#d93a2a,#1a1a18);
      --grad-soft:linear-gradient(135deg,#faeae6,#f5f3ea);
      --radius:0px;--radius-sm:0px;--radius-lg:2px;
      --shadow:none;--shadow-lg:0 1px 0 rgba(40,30,20,.12);
      --font-sans:${SANS};--font-display:${SERIF};--font-serif:${SERIF};`,
    extra: `h2{border-bottom:2px solid var(--accent);font-weight:500;letter-spacing:.04em}
      .card{border:1px solid var(--border);box-shadow:none;padding:20px 22px}
      .kicker{letter-spacing:.2em}`
  },
  {
    id: 'neo-brutalism', name: '新粗野',
    vars: `
      --bg:#fffef0;--bg-soft:#fffbd0;--surface:#ffffff;--surface-2:#fff38a;
      --border:#000000;--border-strong:#000000;
      --text-1:#000000;--text-2:#222222;--text-3:#555555;
      --accent:#ffd400;--accent-2:#ff5ca8;--accent-3:#3a7cff;
      --good:#00b36b;--warn:#ff9900;--bad:#ff3a30;
      --grad:linear-gradient(135deg,#ffd400,#ff5ca8);
      --grad-soft:linear-gradient(135deg,#fffbd0,#ffffff);
      --radius:6px;--radius-sm:4px;--radius-lg:10px;
      --shadow:6px 6px 0 #000000;--shadow-lg:10px 10px 0 #000000;
      --font-sans:${HEI};--font-display:${HEI};--font-serif:${SERIF};
      --letter-tight:-.03em;`,
    extra: `h2{border-bottom:4px solid #000;background:var(--accent);color:#000;padding:6px 12px;border:3px solid #000}
      .card{border:3px solid #000;box-shadow:var(--shadow)}
      .tag{border:2px solid #000;background:var(--accent);color:#000;font-weight:700}
      th{background:var(--accent);color:#000}`
  },
  {
    id: 'pitch-deck-vc', name: '路演风',
    vars: `
      --bg:#ffffff;--bg-soft:#fafbfc;--surface:#ffffff;--surface-2:#f5f7fa;
      --border:rgba(20,30,50,.1);--border-strong:rgba(20,30,50,.22);
      --text-1:#0b0d12;--text-2:#4a5270;--text-3:#8b93a8;
      --accent:#0070f3;--accent-2:#7928ca;--accent-3:#ff4ecb;
      --good:#0cce6b;--warn:#f5a524;--bad:#ee0000;
      --grad:linear-gradient(135deg,#0070f3,#7928ca);
      --grad-soft:linear-gradient(135deg,#e8f0ff,#f3e8ff);
      --radius:14px;--radius-sm:8px;--radius-lg:22px;
      --shadow:0 2px 8px rgba(20,30,50,.06),0 12px 32px rgba(20,30,50,.06);
      --shadow-lg:0 8px 24px rgba(20,30,50,.1),0 30px 80px rgba(20,30,50,.1);
      --font-sans:${SANS};--font-display:${DISPLAY};--font-serif:${SERIF};`,
    extra: `h1,h2{font-weight:800;letter-spacing:-.03em}
      h2{border-bottom:4px solid var(--accent);border-image:var(--grad) 1}
      .card{box-shadow:var(--shadow);border:1px solid var(--border)}
      .kicker{color:var(--accent-2);font-weight:800}`
  },
  {
    id: 'news-broadcast', name: '新闻播报',
    vars: `
      --bg:#ffffff;--bg-soft:#f4f4f4;--surface:#ffffff;--surface-2:#ececec;
      --border:rgba(0,0,0,.14);--border-strong:#0a0a0a;
      --text-1:#0a0a0a;--text-2:#3a3a3a;--text-3:#7a7a7a;
      --accent:#e11d2d;--accent-2:#0a0a0a;--accent-3:#ffd100;
      --good:#0e7c3a;--warn:#ffd100;--bad:#e11d2d;
      --grad:linear-gradient(90deg,#e11d2d,#e11d2d);
      --grad-soft:linear-gradient(135deg,#fde5e7,#f4f4f4);
      --radius:0px;--radius-sm:0px;--radius-lg:2px;
      --shadow:none;--shadow-lg:0 4px 0 var(--accent);
      --font-sans:${HEI};--font-display:${HEI};--font-serif:${SERIF};`,
    extra: `h1,h2{text-transform:uppercase;letter-spacing:-.01em;font-weight:700}
      h2{border-bottom:6px solid var(--accent)}
      .card{border:2px solid var(--text-1);box-shadow:6px 6px 0 var(--accent)}
      .kicker{background:var(--accent);color:#fff;padding:4px 12px;display:inline-block;letter-spacing:.15em}
      .slide::before{content:"";position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--accent);z-index:3}`
  },
  {
    id: 'xiaohongshu-white', name: '小红书白',
    vars: `
      --bg:#fffdfb;--bg-soft:#fff6f1;--surface:#ffffff;--surface-2:#fff1ea;
      --border:rgba(60,30,20,.1);--border-strong:rgba(60,30,20,.22);
      --text-1:#1a1210;--text-2:#4f3a32;--text-3:#a08d85;
      --accent:#ff2742;--accent-2:#ff7a90;--accent-3:#ffb38a;
      --good:#3ba55c;--warn:#f5a524;--bad:#ff2742;
      --grad:linear-gradient(135deg,#ff2742,#ff7a90 55%,#ffb38a);
      --grad-soft:linear-gradient(135deg,#fff6f1,#ffeae0);
      --radius:20px;--radius-sm:14px;--radius-lg:28px;
      --shadow:0 12px 30px rgba(255,39,66,.08);
      --shadow-lg:0 24px 60px rgba(255,39,66,.14);
      --font-sans:${SANS};--font-display:${SERIF};--font-serif:${SERIF};
      --letter-tight:-.02em;`,
    extra: `h2{border-bottom:none;border-left:6px solid var(--accent);padding-left:14px;border-radius:0}
      .card{box-shadow:var(--shadow);border:1px solid var(--border)}
      .kicker{color:var(--accent)}`
  }
];

export const DEFAULT_THEME = 'corporate-clean';

/* 幻灯片"纸面"底色。
 * 为什么单独拎出来: 12 套主题里有 10 套的 --surface 都是 #ffffff(卡片本来是白的),
 * 如果幻灯片背景直接用 --surface, 这些主题在投影上会长得几乎一样 —— 换肤就白做了。
 * 这里给每套主题显式指定纸面底色, 让"暖纸/米黄/米白"这类差异真的看得见。 */
const SLIDE_BG = {
  'corporate-clean': '#ffffff',
  'minimal-white': '#ffffff',
  'swiss-grid': '#ffffff',
  'editorial-serif': '#faf7f2',
  'academic-paper': '#fdfcf8',
  'sharp-mono': '#ffffff',
  'magazine-bold': '#f5efe2',
  'japanese-minimal': '#fafaf5',
  'neo-brutalism': '#fffef0',
  'pitch-deck-vc': '#ffffff',
  'news-broadcast': '#ffffff',
  'xiaohongshu-white': '#fffdfb'
};

/** 生成 [data-theme="x"]{...} 的整段 CSS */
export function themeCSS() {
  return THEMES.map(t => `[data-theme="${t.id}"]{--slide-bg:${SLIDE_BG[t.id] || '#ffffff'};${t.vars}\n${t.extra || ''}}`).join('\n');
}

/** 纯文本的主题清单(注入到页面, 供切换器渲染) */
export function themeList() {
  return THEMES.map(t => ({ id: t.id, name: t.name }));
}
