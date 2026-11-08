"""问一句的服务端实现 —— 复刻 server/ask.mjs 的口径, 逻辑一一对应。

三道闸门(与主服务相同):
  ① 上下文只有"字段摘要", 每个字段一个 id, 模型不许用外部知识;
  ② 回答里的数字必须能在字段表里找到出处(两级白名单: 先看被引用的字段, 再看全字段表);
  ③ 预测涨跌 / 推荐买卖 / 评价基金经理个人 —— 直接拒答, 不消耗模型额度。
"""
import json
import os
import re
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent
RUNS = BASE / "data" / "runs"

REFUSAL = re.compile(
    r"预测|明天|下周|会涨|会跌|能不能买|该不该买|推荐|买入|卖出|加仓|清仓|值不值得|基金经理.*(水平|人品|能力)"
)

SYSTEM = "\n".join([
    "你是「基金复诊台」报告页里的问答助手。你的唯一任务：根据给定的字段摘要回答用户关于这只基金复盘的问题。",
    "硬规则：",
    "1. 只能使用 <字段> 里的值，不许引入任何外部知识，不许自己算新数字。",
    "2. 回答里出现的每个数字，后面必须紧跟〔字段id〕，例如 +76.80%〔perf.cumReturn〕。",
    "3. 字段里没有的，直接回答「报告里没有这项，看第 X 节原文更靠谱」，不要猜。",
    "4. 涉及未来涨跌、买卖建议、评价基金经理个人，一律拒绝，并说明这是回溯复盘、不构成投资建议。",
    "5. 中文口语，2 到 4 句，不要铺垫，不要重复问题。",
    '输出 JSON：{"answer":"...","refs":["字段id",...],"refused":false,"reason":""}',
])


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _pick(obj, *keys):
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def build_digest(code):
    """把一次运行的产出压成"字段摘要": 每个值带 id, 模型只能引用这些 id。"""
    d0 = RUNS / code
    a = _read(d0 / "analysis.json")
    if not a:
        return None
    check = _read(d0 / "check.json")
    card = _read(d0 / "card.json")
    fit = _read(d0 / "fit.json")

    d = {}

    def put(fid, v, label):
        if v is not None:
            d[fid] = {"v": v, "label": label}

    put("fund.name", _pick(a, "fund", "name"), "基金名称")
    put("fund.code", _pick(a, "fund", "code"), "基金代码")
    put("fund.manager", _pick(a, "fund", "manager"), "基金经理")
    put("range.text", a.get("range"), "复盘区间")
    put("range.quarters", a.get("quarterCount"), "报告期数")
    put("level", a.get("level"), "结论层级")
    perf = a.get("perf") or {}
    put("perf.cumReturn", perf.get("cumReturn"), "区间收益(%)")
    put("perf.maxDrawdown", perf.get("maxDrawdown"), "最大回撤(%)")
    put("perf.bestQuarter", perf.get("bestQuarter"), "最优季度")
    put("perf.exBestQuarter", perf.get("exBestQuarter"), "最优季度收益(%)")
    put("perf.bestQuarterContribution", perf.get("bestQuarterContribution"), "最优季度对区间收益的贡献(%)")

    metrics = a.get("metrics") or {}
    conc = metrics.get("conc") or {}
    put("conc.first", conc.get("first"), "首期前十合计(%)")
    put("conc.latest", conc.get("latest"), "末期前十合计(%)")
    put("conc.avg", conc.get("avg"), "前十合计均值(%)")
    put("churn.avgRetained", metrics.get("avgRetained"), "平均每期留存的旧股数")
    put("churn.avgAdded", metrics.get("avgAdded"), "平均每期新进股数")
    put("holders.totalDistinct", metrics.get("totalDistinct"), "出现过的不同股票数")

    put("form.tag", _pick(a, "card", "formTag"), "形态标签")
    put("form.confidence", _pick(a, "card", "formConfidence"), "形态置信度")
    put("card.claim", _pick(a, "card", "claim"), "核心结论")
    put("card.falsifier", _pick(a, "card", "falsifier"), "推翻条件")
    put("kind.label", _pick(a, "kind", "label"), "产品类型")

    # 拟合结果可能只落在 fit.json(还没重跑报告), 两处都认
    fd = None
    if isinstance(a.get("fit"), dict) and a["fit"].get("ok"):
        fd = a["fit"]
    elif isinstance(fit, dict) and fit.get("ok"):
        fd = fit
    if fd:
        f1 = fd.get("fit") or {}
        reg = fd.get("regression") or {}
        win = fd.get("window") or {}
        put("fit.corr", f1.get("corr"), "前十拟合相关性")
        put("fit.te", f1.get("trackingErrorAnnual"), "年化跟踪误差")
        put("fit.r2", reg.get("r2"), "回归R²")
        put("fit.alpha", reg.get("alphaAnnual"), "年化α")
        put("fit.weeks", win.get("weeks"), "拟合周数")
        ca, ct = f1.get("cumActual"), f1.get("cumTheory")
        put("fit.actual", (ca - 1) * 100 if ca is not None else None, "拟合窗口实际累计收益(%)")
        put("fit.theory", (ct - 1) * 100 if ct is not None else None, "拟合窗口理论累计收益(%)")

    if check:
        rules = check.get("rules") or check.get("items") or []
        put("check.total", len(rules) if isinstance(rules, list) and rules else check.get("total"), "质检规则数")
        put("check.fail", check.get("failCount") if check.get("failCount") is not None else _pick(check, "summary", "fail"), "未通过条数")
        put("check.verdict", check.get("verdict") or _pick(check, "summary", "verdict"), "质检结论")
    if card and card.get("check"):
        cv = card["check"]
        put("card.check", cv.get("verdict") if isinstance(cv, dict) else cv, "结论卡质检")

    sections = [s.get("title", "") for s in (a.get("report") or {}).get("sections") or []]
    return {"code": code, "fund": a.get("fund"), "range": a.get("range"),
            "digest": d, "sections": sections, "hasFit": bool(fd)}


def _num_pool(values):
    """一个字段值能接受的所有写法: v / |v| / v*100 / |v|*100, 各有 2 位、1 位、整数三种。"""
    pool = set()
    for v in values:
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        for x in (f, abs(f), f * 100, abs(f) * 100):
            pool.add("%.2f" % x)
            pool.add("%.1f" % x)
            pool.add(str(int(round(x))))
    return pool


def validate_answer(answer, refs, digest):
    """回答里的数字必须能在字段表里找到出处; 引用的 id 必须存在。

    与 server/ask.mjs 的 validateAnswer 保持一致 —— 包括三处踩过的坑:
      ① 年份(19xx/20xx)、6 位代码、一位数不参与回查(否则"2020Q4–2026Q3"会被拆成 4、3);
      ② 指数名里的数字先剔掉(沪深300 / 中证800 …);
      ③ 两级白名单: 先看被引用的字段, 再退到全字段表 —— 只认被引用字段会误杀
         "最大回撤 -32.45%〔perf.maxDrawdown〕, 这是 24 个报告期里最差的"这种回答。
    """
    problems = []
    refs_arr = [r for r in (refs or []) if r in digest]
    safe = re.sub(r"(沪深|中证|上证|创业板指?|科创|纳斯达克|标普|恒生|国证)\s*\d{2,4}", " ", str(answer or ""))
    nums = [t for t in re.findall(r"-?\d+(?:\.\d+)?", safe)
            if not re.fullmatch(r"(19|20)\d\d", t) and not re.fullmatch(r"\d{6}", t) and not re.fullmatch(r"-?\d", t)]

    def values(keys):
        out = []
        for k in keys:
            v = (digest.get(k) or {}).get("v")
            if isinstance(v, (int, float)):
                out.append(v)
        return out

    pool_cited = _num_pool(values(refs_arr if refs_arr else list(digest)))
    pool_all = _num_pool(values(list(digest))) if refs_arr else pool_cited

    def miss(n):
        f2 = "%.2f" % float(n)
        r = str(int(round(float(n))))
        hit = lambda pool: (f2 in pool) or (r in pool)
        return not hit(pool_cited) and not hit(pool_all)

    bad = [n for n in nums if miss(n)]
    if bad:
        problems.append("回答里有 %d 个数字找不到出处：%s" % (len(bad), "、".join(bad[:5])))
    if refs and not refs_arr:
        problems.append("引用的字段 id 都不存在")
    return {"ok": not problems, "problems": problems, "refs": refs_arr}


def _call_llm(cfg, system, user, timeout=60):
    url = (cfg.get("baseUrl") or "https://api.deepseek.com").rstrip("/") + "/chat/completions"
    # 密钥只从环境变量读(展台用 POST /api/secret 设置), 不写进任何文件
    key = cfg.get("key") or os.environ.get("DEEPSEEK_API_KEY", "")
    r = requests.post(
        url,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        json={
            "model": cfg.get("model") or "deepseek-v4-flash",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        },
        timeout=timeout,
    )
    if r.status_code != 200:
        raise RuntimeError("模型接口 HTTP %s: %s" % (r.status_code, r.text[:200]))
    j = r.json()
    content = (((j.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    return {"content": content, "usage": j.get("usage")}


def ask_about_run(code, question, cfg, api_key=""):
    dg = build_digest(code)
    if not dg:
        return {"ok": False, "error": "这只基金还没有预置的复盘结果，先生成报告再提问"}
    q = str(question or "").strip()
    if not q:
        return {"ok": False, "error": "问题为空"}
    if REFUSAL.search(q):
        return {
            "ok": True, "refused": True,
            "answer": "这个问题超出了回溯复盘的范围：这份报告只陈述已经发生的事，不预测涨跌、不推荐买卖、也不评价基金经理个人。"
                      "如果你想问这只基金过去怎么走的、持仓怎么变的，我可以答。",
            "refs": [], "usage": None,
        }
    if not cfg.get("hasKey"):
        return {"ok": False, "error": "服务端没有配置大模型密钥，问一句暂不可用"}

    user = ("<字段>\n" + json.dumps(dg["digest"], ensure_ascii=False, indent=1) + "\n</字段>\n\n报告小节："
            + " / ".join(dg["sections"]) + "\n\n用户问题：" + q)
    cfg2 = dict(cfg)
    cfg2["key"] = api_key or ""
    out = _call_llm(cfg2, SYSTEM, user)

    v = {}
    try:
        v = json.loads(out.get("content") or "{}")
    except Exception:
        v = {"answer": str(out.get("content") or "")[:800]}
    answer = v.get("answer") or ""
    refs = v.get("refs") or []
    if not answer:
        return {"ok": False, "error": "模型没有给出可用回答"}
    chk = validate_answer(answer, refs, dg["digest"])
    if not chk["ok"]:
        return {
            "ok": True, "refused": False, "degraded": True,
            "answer": "这条回答里有数字没能在报告字段里对上，我不敢直接给你，先把原文摆出来：\n" + answer,
            "refs": chk["refs"], "problems": chk["problems"], "usage": out.get("usage"),
        }
    return {"ok": True, "refused": bool(v.get("refused")), "answer": answer,
            "refs": chk["refs"], "usage": out.get("usage")}
