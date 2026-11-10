"""探路(第一阶段): 只抓元数据, 约 1~2 秒, 不抓持仓、不抓 PDF。

这是 server/probe.mjs 的 Python 版 —— 展台只跑 Python, 但对齐的是同一个行为:
输入任意 6 位代码, 拿到「概况 / 历任经理(含共管期) / 报告期网格 / 候选复盘区间」,
把 SOP §0 的八格口径确认表先填好, 再决定要不要开跑。

为什么不抓持仓与 PDF: 那一步是完整流水线(10 年持仓 + 若干份官方 PDF 逐行对账 + 五步模型),
展台 384MB 内存装不下 —— 页面上的按钮文案也如实写着"不抓持仓与 PDF"。
"""
import json
import re
import time
from datetime import datetime

import requests

BASE_F10 = "https://fundf10.eastmoney.com"
BASE_FUND = "https://fund.eastmoney.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122 Safari/537.36")
HEAD = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"}
HJ = dict(HEAD, Referer="https://fund.eastmoney.com/")

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _text(url, headers=None, timeout=12):
    r = requests.get(url, headers=headers or HEAD, timeout=timeout)
    r.raise_for_status()
    r.encoding = "utf-8"
    return r.text


def _strip(s):
    return _WS.sub(" ", _TAG.sub("", s or "")).replace("&nbsp;", " ").strip()


def _num(s):
    try:
        return float(re.sub(r"[^\d.\-]", "", str(s or "")))
    except Exception:
        return None


# ---------------------------------------------------------------- 概况
def basic_info(code):
    html = _text("%s/jbgk_%s.html" % (BASE_F10, code))
    info = {}
    for m in re.finditer(r"<th[^>]*>([\s\S]*?)</th>\s*<td[^>]*>([\s\S]*?)</td>", html):
        k = _strip(m.group(1))
        # 页面上方的导航条也会命中 <th>/<td>, 它的"键"是一整段菜单文字 —— 用长度和空白过滤掉
        if not k or len(k) > 16 or len(k.split(" ")) > 3:
            continue
        if k not in info:
            info[k] = _strip(m.group(2))
    t = re.search(r"<title>([\s\S]*?)</title>", html)
    if "基金简称" not in info and t:
        info["基金简称"] = _strip(t.group(1)).split("(")[0].strip()

    # 类型 / 规模 / 成立日在页面顶部那一行(不是 th/td 表格), 单独抓
    def grab(pat):
        m = re.search(pat, html)
        return _strip(m.group(1)) if m else ""

    typ = grab(r"类型[：:]\s*(?:<[^>]*>\s*)*([^<\s（(，,]{1,20})")
    scale = info.get("净资产规模") or grab(r"净资产规模[：:]\s*([^<\n]{1,24})")
    scale = (scale or "").split("（")[0].strip()
    incep = grab(r"成立日期[：:]\s*(\d{4}-\d{2}-\d{2})")
    if not info and not typ:
        raise ValueError("基金概况页解析为空, 代码可能不存在: " + code)
    return {
        "name": info.get("基金简称") or info.get("基金全称") or code,
        "fullName": info.get("基金全称") or "",
        "type": typ or info.get("基金类型") or "",
        "company": info.get("基金管理人") or info.get("基金公司") or "",
        "manager": info.get("基金经理人") or info.get("基金经理") or "",
        "inception": incep or info.get("成立日期/规模") or "",
        "scale": scale,
        "benchmark": info.get("业绩比较基准") or "",
        "raw": info,
    }


# ---------------------------------------------------------------- 经理履历
def manager_history(code):
    html = _text("%s/jjjl_%s.html" % (BASE_F10, code))
    rows = []
    for tr in re.finditer(r"<tr>([\s\S]*?)</tr>", html):
        tds = [_strip(x) for x in re.findall(r"<td[^>]*>([\s\S]*?)</td>", tr.group(1))]
        if len(tds) < 4 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", tds[0]):
            continue
        names = [x for x in _WS.split(tds[2] or "") if x]
        rows.append({
            "start": tds[0], "end": tds[1] or "", "tenure": tds[3] or "",
            "returnPct": _num(tds[4]) if len(tds) > 4 else None,
            "managers": names, "coManaged": len(names) > 1,
        })
    rows.sort(key=lambda r: r["start"], reverse=True)
    current = next((r for r in rows if "至今" in (r["end"] or "")), rows[0] if rows else None)
    return {"rows": rows, "current": current}


# ---------------------------------------------------------------- 净值序列(只要首末时间)
def nav_head_tail(code):
    js = _text("%s/pingzhongdata/%s.js" % (BASE_FUND, code))
    name = re.search(r'fS_name\s*=\s*"([^"]*)"', js)
    m = re.search(r"var\s+Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\])\s*[;,]?\s*(?=/\*|var\s|$)", js)
    arr = []
    if m:
        try:
            arr = json.loads(m.group(1))
        except Exception:
            arr = []
    if not arr:
        return {"name": (name.group(1) if name else ""), "points": 0, "first": None, "last": None}
    return {
        "name": name.group(1) if name else "",
        "points": len(arr),
        "first": arr[0][0],
        "last": arr[-1][0],
    }


# ---------------------------------------------------------------- 定期报告清单
def _classify(title):
    m = re.search(r"第([1-4])季度报告", title or "")
    if m:
        y = re.search(r"(\d{4})年", title)
        return ("quarterly", "%sQ%s" % (y.group(1), m.group(1)) if y else None)
    if re.search(r"中期报告|半年度报告", title or ""):
        y = re.search(r"(\d{4})年", title)
        return ("interim", "%sQ2" % y.group(1) if y else None)
    if re.search(r"年度报告", title or ""):
        y = re.search(r"(\d{4})年", title)
        return ("annual", "%sQ4" % y.group(1) if y else None)
    return ("other", None)


def report_list(code, pages=2, page_size=40):
    """报告清单: 4 页并发拉 —— 串行要 6~8 秒, 而"探路约 1 秒"是页面上写着的承诺。"""
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        url = ("https://api.fund.eastmoney.com/f10/JJGG?fundcode=%s&pageIndex=%d&pageSize=%d&type=3&_=%d"
               % (code, p, page_size, int(time.time() * 1000)))
        try:
            return (requests.get(url, headers=HJ, timeout=12).json().get("Data") or [])
        except Exception:
            return []

    out = []
    with ThreadPoolExecutor(max_workers=pages) as ex:
        for lst in ex.map(one, range(1, pages + 1)):
            for x in lst:
                kind, period = _classify(x.get("TITLE") or "")
                out.append({"title": x.get("TITLE"), "id": x.get("ID"),
                            "date": x.get("PUBLISHDATEDesc") or (x.get("PUBLISHDATE") or "")[:10],
                            "kind": kind, "period": period})
    return out


# ---------------------------------------------------------------- 工具
def _period_end(period):
    m = re.fullmatch(r"(\d{4})Q([1-4])", str(period or ""))
    if not m:
        return None
    return "%s-%s" % (m.group(1), ["03-31", "06-30", "09-30", "12-31"][int(m.group(2)) - 1])


def _quarter_of(date_str):
    if not date_str:
        return None
    y, m = int(date_str[:4]), int(date_str[5:7])
    return "%dQ%d" % (y, (m - 1) // 3 + 1)


def _cst_date(ms):
    """净值时间戳是北京时间零点, 直接按 UTC 转会退一天。"""
    if not ms:
        return ""
    return time.strftime("%Y-%m-%d", time.gmtime(ms / 1000.0 + 8 * 3600))


# ---------------------------------------------------------------- 主函数
def probe_fund(code, years=10):
    code = str(code or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError("基金代码必须是 6 位数字")
    t0 = time.time()

    # 四个请求互不依赖 → 并发打, 目标"约 1 秒"(串行要 7~12 秒)
    from concurrent.futures import ThreadPoolExecutor

    def guard(fn, default):
        try:
            return fn()
        except Exception:
            return default

    with ThreadPoolExecutor(max_workers=4) as ex:
        fb = ex.submit(guard, lambda: basic_info(code), None)
        fm = ex.submit(guard, lambda: manager_history(code), {"rows": [], "current": None})
        fr = ex.submit(guard, lambda: report_list(code), [])
        fnv = ex.submit(guard, lambda: nav_head_tail(code), {"name": "", "points": 0, "first": None, "last": None})
        basic, mh, reports, nav = fb.result(), fm.result(), fr.result(), fnv.result()
    if not basic:
        raise ValueError("基金概况页取不到, 代码可能不存在: " + code)

    inception_date = _cst_date(nav.get("first"))
    latest_report = sorted([r["period"] for r in reports if r.get("period")])[-1] if reports else None

    incep_q = _quarter_of(inception_date) or "2000Q1"
    year_floor = "%dQ1" % (datetime.now().year - years + 1)
    frm = incep_q if incep_q > year_floor else year_floor
    if inception_date and _period_end(frm) and _period_end(frm) < inception_date:
        m = re.fullmatch(r"(\d{4})Q([1-4])", frm)
        frm = "%dQ1" % (int(m.group(1)) + 1) if m.group(2) == "4" else "%sQ%d" % (m.group(1), int(m.group(2)) + 1)
    to = latest_report or _quarter_of(_cst_date(nav.get("last"))) or frm

    grid = []
    m = re.fullmatch(r"(\d{4})Q([1-4])", frm)
    y, q = int(m.group(1)), int(m.group(2))
    while len(grid) < 200:
        p = "%dQ%d" % (y, q)
        if p > to:
            break
        grid.append(p)
        q += 1
        if q > 4:
            q, y = 1, y + 1
    if not grid:
        raise ValueError("无法推导报告期网格")
    with_dates = [{"period": p, "endDate": _period_end(p)} for p in grid]

    def window(start, end):
        e = None if (not end or "至今" in end) else end
        qs = [h for h in with_dates
              if (not start or h["endDate"] >= start) and (not e or h["endDate"] <= e)]
        if not qs:
            return None
        return {"from": qs[0]["period"], "to": qs[-1]["period"], "n": len(qs)}

    candidates = []
    rows = [r for r in (mh.get("rows") or []) if r.get("start") and r.get("managers")]
    for i, r in enumerate(rows[:6]):
        w = window(r["start"], r["end"])
        if not w:
            continue
        c = {"id": "tenure%d" % i, "label": "%s(%s ~ %s)" % ("+".join(r["managers"]), r["start"], r["end"]),
             "managers": r["managers"], "start": r["start"], "end": r["end"],
             "isCurrent": "至今" in (r["end"] or ""), "coManaged": bool(r.get("coManaged")),
             "tenureDays": r.get("tenure") or "", "tenureReturn": r.get("returnPct")}
        c.update(w)
        candidates.append(c)
    if with_dates:
        w = window(with_dates[0]["endDate"], None)
        if w:
            c = {"id": "all", "label": "全部可取报告期", "managers": [],
                 "start": with_dates[0]["endDate"], "end": None,
                 "isCurrent": False, "coManaged": False}
            c.update(w)
            candidates.append(c)

    cur = next((c for c in candidates if c["isCurrent"]), None)
    longest = sorted([c for c in candidates if c["id"] != "all"], key=lambda c: -c["n"])[:1]
    longest = longest[0] if longest else None
    rec, rec_reason = None, ""
    if cur and cur["n"] >= 4:
        rec = cur
        rec_reason = "现任经理任期共 %d 个报告期, 足以判定形态" % cur["n"]
    elif longest and longest["n"] >= 4:
        rec = longest
        rec_reason = ("现任经理任期仅 %d 个报告期(不足 4 期, 无法判定形态), 建议改用任期最长的一任: %s 共 %d 期"
                      % (cur["n"], longest["label"], longest["n"])) if cur else \
                     ("未识别到现任经理任期, 建议改用可取区间最长的一段: %s 共 %d 期" % (longest["label"], longest["n"]))
    elif candidates:
        rec = candidates[-1]
        rec_reason = "所有经理任期都不足 4 期, 建议用全部可取报告期(%d 期), 形态会标记为\"样本不足\"" % rec["n"]
    for c in candidates:
        c["recommended"] = bool(rec and c["id"] == rec["id"])

    latest = with_dates[-1]
    managers_now = (mh.get("current") or {}).get("managers") or ([basic["manager"]] if basic["manager"] else [])
    report_periods = sorted(set(r["period"] for r in reports if r.get("period")))
    covered = len([p for p in report_periods if p in grid])

    return {
        "code": code,
        "probeMs": int((time.time() - t0) * 1000),
        "years": years,
        "fund": {
            "code": code,
            "name": basic["name"] or nav.get("name") or code,
            "fullName": basic["fullName"],
            "company": basic["company"],
            "type": basic["type"],
            "inception": inception_date or basic["inception"],
            "scale": basic["scale"],
            "manager": "+".join(managers_now) or basic["manager"],
            "benchmark": basic["benchmark"],
        },
        "managers": [{"start": r["start"], "end": r["end"], "managers": r["managers"],
                      "coManaged": bool(r.get("coManaged")), "tenure": r.get("tenure") or "",
                      "returnPct": r.get("returnPct")} for r in rows],
        "periods": with_dates,
        "reportPeriodCount": covered,
        "candidates": candidates,
        "recommendReason": rec_reason,
        "gate1Draft": {
            "code": code,
            "fundName": basic["name"] or nav.get("name") or code,
            "managerLabel": "+".join(rec["managers"]) if rec else "+".join(managers_now),
            "rangeFrom": rec["from"] if rec else with_dates[0]["period"],
            "rangeTo": rec["to"] if rec else latest["period"],
            "dataCutoff": "%s(%s, 最新已披露定期报告)" % (latest["period"], latest["endDate"]),
            "benchmark": basic["benchmark"] or "（概况页未取到, 请从季报 §2 抄录）",
            "returnBasis": "分红再投总回报指数(单位净值 + 除息日分红回加)",
            "scope": "只看前十大持仓(季报披露口径)",
            "outputDir": "_runs/%s" % code,
            "rangeReason": rec_reason,
        },
        "notes": [
            "报告期数按\"成立季度 / 抓取年数\"推导的季度网格统计(共 %d 期), 与实际抓到前十大持仓的期数可能相差 ±1 期。" % len(with_dates),
            ("天天基金的定期报告清单只覆盖到 %d/%d 期(接口会静默漏掉部分季度), 因此官方 PDF 对账会挑其中可得的期来做。"
             % (covered, len(with_dates))) if covered < len(with_dates) else "定期报告清单覆盖完整。",
            "业绩比较基准以概况页为初值; 正式跑批时会用抽样的官方季报 PDF 再核一遍。",
        ],
    }
