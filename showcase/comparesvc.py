"""横向对比的服务端实现 —— 复刻 server/compare.mjs 的口径。

数据源: 天天基金净值接口 https://fund.eastmoney.com/pingzhongdata/<code>.js
        里面 Data_netWorthTrend = [{x: 毫秒时间戳, y: 单位净值, equityReturn: 当日涨跌%}, ...]
口径: 分红再投总回报 —— 用官方给的 equityReturn 连乘(它本身就是复权后的日收益率),
      与主流程"单位净值 + 除息日分红回加"等价; 起点归一为 100, 区间取几只基金的交集。
"""
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent
RUNS = BASE / "data" / "runs"


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Referer": "https://fund.eastmoney.com/", "Accept": "*/*"}
MAX_CODES = 3
NAV_URL = "https://fund.eastmoney.com/pingzhongdata/%s.js"
INFO_URL = "https://fundf10.eastmoney.com/jbgk_%s.html"


def _get(url, timeout=20):
    r = requests.get(url, headers=HEADERS, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError("HTTP %d" % r.status_code)
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def _d(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_series(code):
    """抓净值并转成"分红再投总回报指数"(起点=1), 同时带回基金简称。

    简称从 pingzhongdata 里的 fS_name 取 —— 它和净值在同一个响应里, 不会再失败一次。
    原来靠 F10 概况页取全称, 结果展台服务器上那一步抓不到, 名称退化成代码,
    表格里就成了"519191 519191"(踩过)。
    """
    txt = _get(NAV_URL % code)
    nm = re.search(r'fS_name\s*=\s*"([^"]*)"', txt)
    short_name = nm.group(1).strip() if nm else ""
    m = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", txt, re.S)
    if not m:
        raise RuntimeError("净值序列解析失败(代码可能不存在)")
    rows = json.loads(m.group(1))
    pts = []
    tr = 1.0
    for i, row in enumerate(rows):
        if i > 0:
            try:
                tr *= 1 + float(row.get("equityReturn") or 0) / 100.0
            except (TypeError, ValueError):
                pass
        pts.append({"d": _d(row["x"]), "v": tr})
    if len(pts) < 60:
        raise RuntimeError("净值序列太短(%d 点)" % len(pts))
    return pts, short_name


def fetch_info(code):
    """基金概况: 名称 / 类型 / 经理。抓不到就退回代码, 不让整次对比失败。"""
    info = {"name": "", "type": "", "manager": ""}
    try:
        html = _get(INFO_URL % code)
    except Exception:
        return info
    pairs = re.findall(r"<th[^>]*>([\s\S]*?)</th>\s*<td[^>]*>([\s\S]*?)</td>", html)
    kv = {}
    for k, v in pairs:
        kk = re.sub(r"<[^>]+>|\s+", "", k)
        vv = re.sub(r"<[^>]+>", " ", v)
        vv = re.sub(r"&nbsp;", " ", vv)
        vv = re.sub(r"\s+", " ", vv).strip()
        if kk and kk not in kv:
            kv[kk] = vv
    if kv.get("基金简称"):
        info["name"] = kv["基金简称"]
    if kv.get("基金类型"):
        info["type"] = kv["基金类型"]
    if kv.get("基金经理"):
        info["manager"] = kv["基金经理"]
    return info


def detect_kind(name, type_):
    """简化版产品类型判定(与前端 engine.js 的口径一致: 先看是不是被动)。"""
    s = (name or "") + " " + (type_ or "")
    if re.search(r"货币", s):
        return {"code": "money", "label": "货币市场基金", "isPassive": True}
    if re.search(r"债券|纯债|短债|中短债", s) and not re.search(r"可转债", s):
        return {"code": "bond", "label": "债券型基金", "isPassive": False}
    if re.search(r"ETF联接", s):
        return {"code": "feeder", "label": "ETF 联接基金(被动)", "isPassive": True}
    if re.search(r"ETF|指数|LOF指数|增强指数", s):
        return {"code": "index", "label": "指数/ETF(被动跟踪)", "isPassive": True}
    if re.search(r"QDII|港股|全球|海外", s):
        return {"code": "qdii", "label": "跨境(QDII)", "isPassive": False}
    return {"code": "active", "label": "主动管理基金", "isPassive": False}


def _metrics(pts):
    if len(pts) < 20:
        return None
    first, last = pts[0]["v"], pts[-1]["v"]
    cum = last / first - 1
    d0 = datetime.strptime(pts[0]["d"], "%Y-%m-%d")
    d1 = datetime.strptime(pts[-1]["d"], "%Y-%m-%d")
    days = max(1, (d1 - d0).days)
    ann = (last / first) ** (365.0 / days) - 1
    peak, mdd = -1e18, 0.0
    for p in pts:
        peak = max(peak, p["v"])
        mdd = min(mdd, p["v"] / peak - 1)
    rets = [pts[i]["v"] / pts[i - 1]["v"] - 1 for i in range(1, len(pts))]
    mean = sum(rets) / len(rets) if rets else 0
    var = sum((r - mean) ** 2 for r in rets) / max(1, len(rets) - 1)
    vol = math.sqrt(var) * math.sqrt(252)
    return {"cumReturn": cum, "annualized": ann, "maxDrawdown": mdd, "volAnnual": vol,
            "points": len(pts), "from": pts[0]["d"], "to": pts[-1]["d"]}


def _sample(pts, max_points=220):
    if not pts:
        return []
    base = pts[0]["v"]
    step = max(1, math.ceil(len(pts) / max_points))
    out = []
    for i in range(0, len(pts), step):
        out.append({"d": pts[i]["d"], "v": round(pts[i]["v"] / base * 100, 2)})
    last = pts[-1]
    if out[-1]["d"] != last["d"]:
        out.append({"d": last["d"], "v": round(last["v"] / base * 100, 2)})
    return out


def _run_meta(code):
    """这只基金预置过复盘的话, 顺手把形态标签与期数带出来(对比表里更好读)。"""
    a = _read(str(RUNS / code / "analysis.json"))
    if not a:
        return None, None
    # 与报告抬头保持一致: 门禁 2 的 form.tag 优先, 结论卡里的原判兜底
    form = ((a.get("form") or {}).get("tag")) or ((a.get("card") or {}).get("formTag"))
    return form, a.get("quarterCount")


def compare_funds(codes):
    seen, code_list = set(), []
    for c in (codes or []):
        c = str(c or "").strip()
        if re.fullmatch(r"\d{6}", c) and c not in seen:
            seen.add(c)
            code_list.append(c)
    code_list = code_list[:MAX_CODES]
    if not code_list:
        raise RuntimeError("请至少输入一个 6 位基金代码")

    warnings, raw = [], []
    for code in code_list:
        try:
            series, nav_name = fetch_series(code)
            info = fetch_info(code)
            name = nav_name or info["name"] or ""
            kind = detect_kind((name or "") + " " + info["type"], info["type"])
            form, quarters = _run_meta(code)
            raw.append({"code": code, "name": name, "manager": info["manager"],
                        "type": info["type"], "kind": kind, "form": form,
                        "quarters": quarters, "hadRun": form is not None, "series": series})
        except Exception as e:
            warnings.append("%s：%s" % (code, e))
    if not raw:
        raise RuntimeError("这几只基金都抓不到净值序列" + ("（" + "；".join(warnings) + "）" if warnings else ""))

    # 共同区间取交集: 不同成立时间的基金只比重叠部分
    start = max(r["series"][0]["d"] for r in raw)
    end = min(r["series"][-1]["d"] for r in raw)
    if start >= end:
        raise RuntimeError("这几只基金的净值区间没有重叠（%s / %s）" % (start, end))

    funds = []
    for r in raw:
        pts = [p for p in r["series"] if start <= p["d"] <= end]
        met = _metrics(pts)
        if not met or met["points"] < 60:
            warnings.append("%s：可比交易日只有 %d 个，样本不足" % (r["code"], met["points"] if met else 0))
        funds.append({
            "code": r["code"], "name": r["name"], "manager": r["manager"], "type": r["type"],
            "kind": r["kind"], "form": r["form"], "quarters": r["quarters"], "hadRun": r["hadRun"],
            "metrics": met, "series": _sample(pts),
            "insufficient": (not met) or met["points"] < 60,
        })

    days = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days
    if days < 180:
        warnings.append("共同区间只有 %d 天，结论参考价值有限" % days)
    return {
        "ok": True,
        "window": {"from": start, "to": end, "days": days},
        "basis": "分红再投总回报指数，起点归一为 100",
        "warnings": warnings,
        "funds": funds,
    }
