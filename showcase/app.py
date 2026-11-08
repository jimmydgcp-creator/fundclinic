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
        "datasetMeta": None,
        "summary": _read(d / "summary.json"),
    })


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


# ---------------------------------------------------------------- 其它
@app.route("/api/<path:_any>", methods=["GET", "POST"])
def api_other(_any):
    """主服务有、但这个部署没有的接口(探路/开跑/下载/额度…)。
    明确回 404 + 人话, 让前端"失败"时能显示得像回事, 而不是挂一个 HTML 404 页。"""
    return jsonify({"ok": False, "error": "这个部署不提供该接口(展示版只开放 问一句 / 横向对比)"}), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
