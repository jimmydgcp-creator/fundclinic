"""展台版后端: 只提供"看报告 + 问一句 + 横向对比"三件事。

为什么要有这个文件: 本仓库的主服务是 Node(server.mjs), 展台服务器只跑 Python。
所以这里用 Flask 复刻**最小可用**的那部分接口 —— 报告数据是预置好的
(data/runs/<code>/ 下是服务端跑出来的真结果), 现场能做的是"问"和"对比", 不是"重新跑一只基金"
(跑一只要爬六类来源 + 官方 PDF 对账 + 五步模型调用, 384MB 内存和休眠策略都装不下)。

接口与主服务的契约保持一致, 前端 app/*.js 一行不改也知道怎么用:
    GET  /api/health          能力声明(caps), 前端据此决定显示什么
    GET  /api/history         预置的复盘列表
    GET  /api/result?code=    一次复盘的完整结果(analysis/check/summary)
    POST /api/ask             {"code","question"} -> 带字段校验的回答
    POST /api/compare         {"codes":[...]} -> 归一化净值曲线 + 区间指标

密钥只从环境变量读, 不写进任何文件; 展台用 POST /api/secret 设置。
"""
import json
import os
import re
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

import asksvc
import comparesvc
import probesvc

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
RUNS = BASE / "data" / "runs"

app = Flask(__name__, static_folder=None)


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def llm_cfg():
    """密钥只从环境变量读。没配时 hasKey=False, 前端的问一句会提示配置问题而不是崩。"""
    return {
        "baseUrl": os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        "hasKey": bool(os.environ.get("DEEPSEEK_API_KEY")),
        "keySource": "环境变量" if os.environ.get("DEEPSEEK_API_KEY") else "",
    }


# ---------------------------------------------------------------- 静态页面
@app.route("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.route("/<path:name>")
def static_file(name):
    return send_from_directory(STATIC, name)


# ---------------------------------------------------------------- 能力与历史
@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "version": "2.2.0-showcase",
        "cloud": True,
        "bootAt": os.environ.get("RENDER_GIT_COMMIT", "showcase"),
        # caps.run=False: 这个部署不能现场跑新基金(没有采集与模型流水线), 前端据此收掉"输入代码"
        "caps": {"run": False, "ask": True, "compare": True},
        "llm": llm_cfg(),
        "quota": {"enabled": False},
        "crawlStandard": "SOP §2 六类来源(本部署为预置结果, 不现场采集)",
    })


def list_runs():
    out = []
    if not RUNS.exists():
        return out
    # 519191 排第一: 演示时打开就该是那份内容最全的主动基金报告(13 节), 而不是 ETF 对照
    for d in sorted(RUNS.iterdir(), key=lambda x: (x.name != "519191", x.name)):
        if not d.is_dir():
            continue
        s = _read(d / "summary.json")
        if not s:
            continue
        out.append({
            "code": s.get("code", d.name),
            "name": s.get("name", ""),
            "range": s.get("range", ""),
            "quarters": s.get("quarters"),
            "formTag": s.get("formTag", ""),
            "check": (s.get("check") or {}).get("verdictText", ""),
            "at": s.get("at", ""),
            "seeded": True,
        })
    return out


@app.route("/api/history")
def history():
    return jsonify({"runs": list_runs()})


@app.route("/api/result")
def result():
    code = re.sub(r"\D", "", request.args.get("code", ""))[:6]
    d = RUNS / code
    if not code or not (d / "analysis.json").exists():
        return jsonify({"ok": False, "error": "这个代码没有预置结果"}), 404
    return jsonify({
        "ok": True,
        "analysis": _read(d / "analysis.json"),
        "check": _read(d / "check.json"),
        "datasetMeta": _read(d / "datasetMeta.json"),
        "summary": _read(d / "summary.json"),
    })


# ---------------------------------------------------------------- 探路
@app.route("/api/probe", methods=["POST"])
def probe():
    """探路: 只抓元数据(概况 / 经理履历 / 报告期网格 / 候选区间), 不碰持仓与 PDF。
    与主服务同形 —— 前端的 FC.probe 一行没改, 打的就是这个接口。"""
    body = request.get_json(silent=True) or {}
    code = re.sub(r"\D", "", str(body.get("code", "")))[:6]
    if not re.fullmatch(r"\d{6}", code):
        return jsonify({"ok": False, "error": "基金代码必须是 6 位数字"}), 400
    try:
        years = int(body.get("years") or 10)
    except Exception:
        years = 10
    try:
        p = probesvc.probe_fund(code, years)
    except Exception as e:
        return jsonify({"ok": False, "error": "探路失败: %s" % e}), 502
    return jsonify({"ok": True, "probe": p})


# ---------------------------------------------------------------- 问一句
@app.route("/api/ask", methods=["POST"])
def ask():
    body = request.get_json(silent=True) or {}
    code = re.sub(r"\D", "", str(body.get("code", "")))[:6]
    question = str(body.get("question", "") or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        return jsonify({"ok": False, "error": "先选一只已复盘的基金(6 位代码)"}), 400
    if not question:
        return jsonify({"ok": False, "error": "问题为空"}), 400
    try:
        out = asksvc.ask_about_run(code, question, llm_cfg())
    except Exception as e:  # 模型/网络层失败: 502, 客户端问题才 400
        return jsonify({"ok": False, "error": "问不了: %s" % e}), 502
    if not out.get("ok"):
        return jsonify(out), 400
    return jsonify(out)


# ---------------------------------------------------------------- 横向对比
@app.route("/api/compare", methods=["POST"])
def compare():
    body = request.get_json(silent=True) or {}
    codes = body.get("codes") or []
    if not isinstance(codes, list):
        return jsonify({"ok": False, "error": "codes 要是数组"}), 400
    try:
        r = comparesvc.compare_funds(codes)
    except Exception as e:
        return jsonify({"ok": False, "error": "对比失败: %s" % e}), 400
    return jsonify(r)


# ---------------------------------------------------------------- 交付物下载 / 在线预览
# 与主服务(Node)同名同形状: /api/download?code=&f=  /report/<code>  /deck/<code>
# 这样前端一行都不用改 —— 那排"可下载的交付物"按钮在展台上也是真能点开的。
FILE_KEYS = ("report", "reportClean", "deck", "deckT6", "card", "check", "sources", "dataset")


def _run_dir(code):
    code = re.sub(r"\D", "", str(code or ""))[:6]
    d = RUNS / code
    return d if (d / "analysis.json").exists() else None


def _deliverable(d, key):
    """包里的交付物统一存成 <key>.<ext>(ASCII 名), 见 tools/pack_showcase.mjs。"""
    files_dir = d / "files"
    if not files_dir.exists() or key not in FILE_KEYS:
        return None
    hits = sorted(files_dir.glob(key + ".*"))
    return hits[0] if hits else None


@app.route("/api/download")
def download():
    d = _run_dir(request.args.get("code", ""))
    key = str(request.args.get("f", ""))
    if d is None:
        return jsonify({"ok": False, "error": "没有这只基金的预置结果"}), 404
    f = _deliverable(d, key)
    if f is None:
        return jsonify({"ok": False, "error": "这次运行没有产出「%s」" % key}), 404
    summary = _read(d / "summary.json") or {}
    disp = ((summary.get("files") or {}).get(key) or {}).get("name") or f.name
    return send_from_directory(f.parent, f.name, as_attachment=True, download_name=disp)


@app.route("/deck/<code>")
def deck_view(code):
    """在线预览演示稿: 默认给深度版(T6), ?v=old 才给模板版 —— 与主服务一致。"""
    d = _run_dir(code)
    if d is None:
        return jsonify({"ok": False, "error": "没有这只基金的预置结果"}), 404
    want_old = str(request.args.get("v", "")) == "old"
    f = _deliverable(d, "deck" if want_old else "deckT6") or _deliverable(d, "deck")
    if f is None:
        return jsonify({"ok": False, "error": "这次运行没有产出演示稿"}), 404
    return send_from_directory(f.parent, f.name)


@app.route("/report/<code>")
def report_view(code):
    d = _run_dir(code)
    f = _deliverable(d, "report") if d else None
    if f is None:
        return jsonify({"ok": False, "error": "这次运行没有产出报告"}), 404
    md = f.read_text(encoding="utf-8")
    body = _md_to_html(md)
    code = re.sub(r"\D", "", code)[:6]
    # 注意: 不要用 % 或 str.format 拼这段 —— CSS 里全是 "width:100%" 这种 %, 会被当成格式符炸掉。
    page = (
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
        + "<title>" + code + " 复盘报告</title>"
        + '<style>body{max-width:940px;margin:0 auto;padding:40px 24px;font:16px/1.85 "Microsoft YaHei",sans-serif;color:#16202e}'
        + "h1{font-size:26px;color:#0a2540}h2{color:#0a2540;border-bottom:3px solid #1d4ed8;padding-bottom:8px;margin-top:34px}"
        + "h3{color:#14395f;margin-top:26px}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}"
        + "td,th{border:1px solid #d8e0ea;padding:6px 9px;text-align:left;vertical-align:top}"
        + "th{background:#f3f6fa}blockquote{border-left:3px solid #cbd5e1;margin:14px 0;padding:4px 14px;color:#475569}"
        + "code{background:#eef2f7;padding:1px 5px;border-radius:4px;font-size:13px}"
        + "a{color:#1d4ed8}hr{border:0;border-top:1px solid #e2e8f0;margin:26px 0}"
        + "</style></head><body>"
        + '<p style="font-size:13px;color:#7d8da3"><a href="/">← 返回基金复诊台</a> · '
        + '<a href="/deck/' + code + '">看演示稿</a> · '
        + '<a href="/api/download?code=' + code + '&amp;f=report">下载 Markdown</a></p>'
        + body
        + "</body></html>"
    )
    return page, 200, {"Content-Type": "text/html; charset=utf-8"}


def _md_to_html(md):
    """极简 Markdown → HTML: 标题 / 表格 / 列表 / 引用 / 粗体 / 行内代码 / 段落。
    够用就行 —— 展台上这份报告的主要结构就是这几样。"""
    import html as _html

    def inline(t):
        t = _html.escape(t)
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
        t = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
        return t

    out, i, lines = [], 0, md.splitlines()
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            n = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (n, inline(m.group(2)), n))
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            if len(rows) >= 2 and re.match(r"^:?-{2,}:?$", rows[1][0] or "-"):
                head, body = rows[0], rows[2:]
            else:
                head, body = None, rows
            out.append("<table>")
            if head:
                out.append("<tr>" + "".join("<th>%s</th>" % inline(c) for c in head) + "</tr>")
            for r in body:
                out.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>")
            out.append("</table>")
            continue
        if re.match(r"^[-*]\s+", s):
            out.append("<ul>")
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                out.append("<li>%s</li>" % inline(re.sub(r"^[-*]\s+", "", lines[i].strip())))
                i += 1
            out.append("</ul>")
            continue
        if s.startswith(">"):
            out.append("<blockquote>%s</blockquote>" % inline(s.lstrip("> ")))
            i += 1
            continue
        if re.match(r"^-{3,}$", s):
            out.append("<hr>")
            i += 1
            continue
        out.append("<p>%s</p>" % inline(s))
        i += 1
    return "\n".join(out)


# ---------------------------------------------------------------- 其它
@app.route("/api/<path:_any>", methods=["GET", "POST"])
def api_other(_any):
    """主服务有、但这个部署没有的接口(探路/开跑/下载/额度…)。
    明确回 404 + 人话, 让前端"失败"时能显示得像回事, 而不是挂一个 HTML 404 页。"""
    return jsonify({"ok": False, "error": "这个部署不提供该接口(展示版只开放 问一句 / 横向对比)"}), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
