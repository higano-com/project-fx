"""中央競馬: 当日の見張り(レース一覧・オッズ・結果の取得)と、複勝の期待値計算。

  python jra/live.py init   今日のレース一覧と全レースのオッズを1回ずつ取る(開催がなければ何もしない)
  python jra/live.py run    発走20分前・5分前にオッズ、発走12分後に結果を取り、アプリを作り直す(全レース終了で止まる)
  python jra/live.py once   「最新にする」ボタン用。締切が近いレースのオッズと、取りこぼした結果を取る
  python jra/live.py page   アプリ(data/jra_site/index.html)を作り直すだけ

複勝の期待値(検証中): 単勝オッズから市場の1着確率を出し、Harville式で3着以内の確率にする。
それに複勝オッズの下限を掛けたものを期待値とする(下限を使うので控えめな見積もり)。
アクセスは http_jra.py で全プロセス1本ずつ・5秒以上あける。データは私的な分析にだけ使う。
"""
import gzip
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from http_jra import post  # noqa: E402
import parse as P  # noqa: E402

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "data" / "jra" / "live"
HTML = ROOT / "data" / "jra" / "html"
SITE = ROOT / "data" / "jra_site"
PID = ROOT / "data" / "jra" / "live.pid"
EV_TH = 1.0  # 複勝期待値がこれ以上なら「候補」
SNAP_BEFORE = (20, 5)  # 発走の何分前にオッズを取るか
RESULT_AFTER = 12  # 発走の何分後から結果を取りにいくか


def now() -> datetime:
    return datetime.now(JST)


def today() -> str:
    return now().strftime("%Y%m%d")


def day_dir(d: str) -> Path:
    p = LIVE / d
    (p / "odds").mkdir(parents=True, exist_ok=True)
    return p


def load_sched(d: str) -> dict:
    f = day_dir(d) / "schedule.json"
    return json.loads(f.read_text()) if f.exists() else {}


def save_json(path: Path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False))
    tmp.replace(path)


# ---------------- 取得 ----------------

def init(d: str | None = None) -> dict:
    d = d or today()
    if load_sched(d):
        print(f"{d}: 今日のレース一覧はもう取得済み")
        return load_sched(d)
    menu = post("accessD.html", "pw01dli00/F3")
    venues = sorted(set(c for c in re.findall(r"pw01drl00\d+/[0-9A-F]{2}", menu) if c[9:].split("/")[0].endswith(d)))
    if not venues:
        print(f"{d}: 今日は開催なし")
        return {}
    races = {}
    for vc in venues:
        page = post("accessD.html", vc)
        codes = re.findall(r"pw01dde\d+/[0-9A-F]{2}", page)
        seen = []
        for c in codes:
            if c not in seen:
                seen.append(c)
        for c in seen:
            rid = c[9:].split("/")[0]
            # このレースのリンクの近くにある発走時刻を拾う
            i = page.find(c)
            m = None
            for m_ in re.finditer(r"(\d{1,2})時(\d{2})分", page[max(0, i - 3000): i + 3000]):
                m = m_ if m is None or abs(m_.start() - 3000) < abs(m.start() - 3000) else m
            races[rid] = {"rid": rid, "venue": P.VENUE.get(rid[:2], rid[:2]), "race_no": int(rid[10:12]),
                          "post": f"{int(m.group(1)):02d}:{m.group(2)}" if m else None, "entry_code": c}
    omenu = post("accessO.html", "pw15oli00/6D")
    for oc in sorted(set(c for c in re.findall(r"pw15orl00\d+/[0-9A-F]{2}", omenu) if c[9:].split("/")[0].endswith(d))):
        page = post("accessO.html", oc)
        for c in set(re.findall(r"pw151ou[A-Z0-9]\d+\d+Z/[0-9A-F]{2}", page)):
            rid = re.search(r"pw151ou[A-Z0-9]{2}(\d{20})Z", c)
            if rid and rid.group(1) in races:
                races[rid.group(1)]["odds_code"] = c
    sched = {"date": d, "races": dict(sorted(races.items(), key=lambda kv: (kv[1]["post"] or "", kv[0])))}
    save_json(day_dir(d) / "schedule.json", sched)
    print(f"{d}: {len(races)}レース ({', '.join(sorted({r['venue'] for r in races.values()}))})")
    for rid, r in sched["races"].items():
        if r.get("odds_code"):
            snap_odds(d, rid, r["odds_code"], "朝")
    return sched


def parse_odds_page(page: str) -> dict:
    t = re.search(r"<table.*?</table>", page, flags=re.S)
    horses = []
    for row in re.findall(r"<tr>(.*?)</tr>", t.group(0) if t else "", flags=re.S):
        n = P._txt(P._cell(row, "num"))
        if not n.isdigit():
            continue
        tan = P._txt(P._cell(row, "odds_tan"))
        fmin = re.search(r'class="min">([\d.]+)<', row)
        fmax = re.search(r'class="max">([\d.]+)<', row)
        horses.append({
            "no": int(n), "name": P._txt(P._cell(row, "horse")),
            "sexage": P._txt(P._cell(row, "age")), "body": P._txt(P._cell(row, "h_weight")),
            "kg": P._txt(P._cell(row, "weight")), "jockey": re.sub(r"^[▲△☆◇★]\s*", "", P._txt(P._cell(row, "jockey"))),
            "trainer": P._txt(P._cell(row, "trainer")),
            "tan": float(tan) if re.match(r"^\d+(\.\d+)?$", tan) else None,
            "fmin": float(fmin.group(1)) if fmin else None, "fmax": float(fmax.group(1)) if fmax else None,
            "status": "" if re.match(r"^\d", tan) else tan,
        })
    cap = P._txt(page[page.find("ここから本文です"):][:3000]) if "ここから本文です" in page else ""
    name = ""
    m = re.search(r"発走時刻： \d+時\d+分 (.*?) コース：", cap)
    if m:
        name = m.group(1).strip()
    course = re.search(r"コース： ([\d,]+) メートル （([^）]*)）", cap)
    return {"horses": horses, "name": name[:60],
            "course": f"{course.group(2).split('・')[0]}{course.group(1)}m" if course else ""}


def snap_odds(d: str, rid: str, code: str, label: str):
    page = post("accessO.html", code)
    o = parse_odds_page(page)
    o.update({"at": now().strftime("%H:%M"), "label": label})
    save_json(day_dir(d) / "odds" / f"{rid}_{label}.json", o)
    print(f"  オッズ {rid} {label} {len(o['horses'])}頭", flush=True)


def fetch_results(d: str, want: set) -> int:
    """結果が出ているレースの結果ページ(とその確定オッズ)を取る。戻り値: 取れた数。"""
    menu = post("accessS.html", "pw01sli00/AF")
    got = 0
    for dc in sorted(set(c for c in re.findall(r"pw01srl\d+/[0-9A-F]{2}", menu) if c[7:].split("/")[0].endswith(d))):
        page = post("accessS.html", dc)
        for rc in sorted(set(re.findall(r"pw01sde\d+/[0-9A-F]{2}", page))):
            rid = rc[7:].split("/")[0]
            if rid not in want:
                continue
            rhtml = post("accessS.html", rc)
            if "払戻金" not in rhtml:
                continue
            HTML.mkdir(parents=True, exist_ok=True)
            with gzip.open(HTML / f"{rid}_r.html.gz", "wt", encoding="utf-8") as f:
                f.write(rhtml)
            oc = re.search(r"pw151ou\d+Z/[0-9A-F]{2}", rhtml)
            ohtml = post("accessO.html", oc.group(0)) if oc else ""
            with gzip.open(HTML / f"{rid}_o.html.gz", "wt", encoding="utf-8") as f:
                f.write(ohtml)
            rows = P.parse_race(rid)
            res = {str(r["umaban"]): {"finish": r["finish"], "status": r["status"], "fuku_pay": r["fuku_pay"],
                                      "tan_final": r["odds"]} for r in rows}
            save_json(day_dir(d) / f"result_{rid}.json", res)
            print(f"  結果 {rid}", flush=True)
            got += 1
    return got


# ---------------- 計算 ----------------

def harville_top(q: list[float], k: int) -> list[float]:
    """市場の1着確率 q から、各馬が k 着以内に入る確率(Harville式)。"""
    n = len(q)
    p1 = q[:]
    p2 = [0.0] * n
    p3 = [0.0] * n
    for j in range(n):
        if q[j] <= 0 or q[j] >= 1:
            continue
        for i in range(n):
            if i != j:
                p2[i] += q[j] * q[i] / (1 - q[j])
        if k >= 3:
            for l in range(n):
                if l == j or q[l] <= 0:
                    continue
                pjl = q[j] * q[l] / (1 - q[j])
                rest = 1 - q[j] - q[l]
                if rest <= 0:
                    continue
                for i in range(n):
                    if i != j and i != l:
                        p3[i] += pjl * q[i] / rest
    return [p1[i] + p2[i] + (p3[i] if k >= 3 else 0) for i in range(n)]


def evaluate(snap: dict) -> list[dict]:
    hs = [h for h in snap["horses"] if h["tan"]]
    if len(hs) < 2:
        return []
    inv = [1 / h["tan"] for h in hs]
    s = sum(inv)
    q = [x / s for x in inv]
    k = 3 if len(hs) >= 8 else 2  # 7頭以下は複勝2着まで
    pt = harville_top(q, k)
    out = []
    for h, qi, pi in zip(hs, q, pt):
        ev = pi * h["fmin"] if h["fmin"] else None
        out.append({**h, "p_win": round(qi, 4), "p_top": round(pi, 4), "ev": round(ev, 3) if ev else None,
                    "pick": bool(ev and ev >= EV_TH)})
    return out


# ---------------- ページ ----------------

def latest_snap(d: str, rid: str):
    best = None
    for lab in ("直前", "20分前", "ボタン", "朝"):
        f = day_dir(d) / "odds" / f"{rid}_{lab}.json"
        if f.exists():
            s = json.loads(f.read_text())
            if best is None or s["at"] > best["at"]:
                best = s
    return best


def decision_snap(d: str, rid: str):
    """成績の記録に使うのは、締切にいちばん近い(発走5分前の)オッズ。なければ最新。"""
    f = day_dir(d) / "odds" / f"{rid}_直前.json"
    return json.loads(f.read_text()) if f.exists() else latest_snap(d, rid)


def day_data(d: str) -> dict:
    sched = load_sched(d)
    races = []
    for rid, r in sched.get("races", {}).items():
        snap = latest_snap(d, rid)
        dec = decision_snap(d, rid)
        rf = day_dir(d) / f"result_{rid}.json"
        res = json.loads(rf.read_text()) if rf.exists() else None
        rows = evaluate(snap) if snap else []
        picks = []
        for h in (evaluate(dec) if dec else []):
            if h["pick"]:
                pay = None
                if res:
                    rr = res.get(str(h["no"]), {})
                    pay = rr.get("fuku_pay", 0) if not rr.get("status") else 100  # 取消は返還
                picks.append({"no": h["no"], "name": h["name"], "ev": h["ev"], "fmin": h["fmin"],
                              "fmax": h["fmax"], "tan": h["tan"], "p_top": h["p_top"], "pay": pay,
                              "at": dec["at"], "label": dec["label"]})
        races.append({**{k: r[k] for k in ("rid", "venue", "race_no", "post")},
                      "name": (snap or {}).get("name", ""), "course": (snap or {}).get("course", ""),
                      "at": (snap or {}).get("at"), "label": (snap or {}).get("label"),
                      "horses": rows, "result": res, "picks": picks})
    return {"date": d, "races": races}


def build_page():
    days = sorted(p.name for p in LIVE.glob("2*") if (p / "schedule.json").exists())
    data = {"updated": now().strftime("%m/%d %H:%M"), "days": [day_data(d) for d in days]}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    tpl = (Path(__file__).resolve().parent / "app.html").read_text(encoding="utf-8")
    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / "index.html").write_text(tpl.replace("/*__DATA__*/null", blob), encoding="utf-8")
    print(f"アプリを作り直しました {data['updated']}", flush=True)


# ---------------- 見張り ----------------

def post_dt(d: str, hhmm: str) -> datetime:
    return datetime.strptime(d + hhmm, "%Y%m%d%H:%M").replace(tzinfo=JST)


def step(d: str, near_min: float | None = None) -> bool:
    """やるべき取得を1回分行う。戻り値: 何か取ったか。near_min を渡すとボタン用(締切が近いレースを今取る)。"""
    sched = load_sched(d)
    t = now()
    did = False
    for rid, r in sched.get("races", {}).items():
        if not r.get("post") or not r.get("odds_code"):
            continue
        p = post_dt(d, r["post"])
        mins = (p - t).total_seconds() / 60
        if near_min is not None:
            if 2 < mins <= near_min:
                snap_odds(d, rid, r["odds_code"], "ボタン")
                did = True
            continue
        for b in SNAP_BEFORE:
            lab = "直前" if b == 5 else f"{b}分前"
            f = day_dir(d) / "odds" / f"{rid}_{lab}.json"
            if not f.exists() and b - 1.5 < mins <= b:
                snap_odds(d, rid, r["odds_code"], lab)
                did = True
    want = {rid for rid, r in sched.get("races", {}).items()
            if r.get("post") and (t - post_dt(d, r["post"])).total_seconds() / 60 >= RESULT_AFTER
            and not (day_dir(d) / f"result_{rid}.json").exists()}
    if want:
        global _last_res
        if time.time() - _last_res > 240:  # 結果の確認は4分に1回まで
            _last_res = time.time()
            did |= fetch_results(d, want) > 0
    return did


_last_res = 0.0


def all_done(d: str) -> bool:
    sched = load_sched(d)
    return bool(sched) and all((day_dir(d) / f"result_{rid}.json").exists() for rid in sched["races"])


def run():
    if PID.exists():
        try:
            os.kill(int(PID.read_text()), 0)
            print("見張りはすでに動いています")
            return
        except (OSError, ValueError):
            pass
    PID.parent.mkdir(parents=True, exist_ok=True)
    PID.write_text(str(os.getpid()))
    d = today()
    if not load_sched(d):
        init(d)
        build_page()
    try:
        last_build = time.time()
        while not all_done(d):
            if step(d):
                build_page()
                last_build = time.time()
            if time.time() - last_build > 1800:
                build_page()
                last_build = time.time()
            time.sleep(20)
        build_page()
        print("今日の全レースが終わりました")
    finally:
        PID.unlink(missing_ok=True)


def once():
    d = today()
    if not load_sched(d):
        if not init(d):
            build_page()
            return
    running = False
    if PID.exists():
        try:
            os.kill(int(PID.read_text()), 0)
            running = True
        except (OSError, ValueError):
            pass
    if not running:
        step(d, near_min=15)
        step(d)
    build_page()
    print("見張り:", "動作中" if running else "停止中")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "page"
    {"init": lambda: init(), "run": run, "once": once, "page": build_page}[cmd]()
