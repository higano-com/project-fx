"""中央競馬: 保存したHTML(結果+オッズ)を1頭1行の表にする。

使い方: python jra/parse.py   → data/jra/runs.pkl
"""
import gzip
import html as H
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "data" / "jra" / "html"
VENUE = {"01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
         "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉"}


def _txt(s: str) -> str:
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def _cell(row: str, cls: str) -> str:
    m = re.search(rf'<td class="{cls}"[^>]*>(.*?)</td>', row, flags=re.S)
    return m.group(1) if m else ""


def _id(s: str, kind: str) -> str:
    m = re.search(rf"{kind}(\d+)/", s)
    return m.group(1) if m else ""


def _sec(t: str):
    m = re.match(r"(\d+):(\d+\.\d)", t)
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


def race_info(page: str) -> dict:
    tb = re.search(r"<table.*?</table>", page, flags=re.S).group(0)
    cap = _txt(tb[: tb.find("<thead")])
    info = {}
    m = re.search(r"発走時刻： (\d+)時(\d+)分", cap)
    info["post_time"] = int(m.group(1)) * 100 + int(m.group(2)) if m else None
    m = re.search(r"天候 (\S+)", cap)
    info["weather"] = m.group(1) if m else ""
    m = re.search(r"(芝|ダート) (良|稍重|重|不良)", cap)
    info["baba"] = m.group(2) if m else ""
    m = re.search(r"コース： ([\d,]+) メートル （([^）]*)）", cap)
    info["dist"] = int(m.group(1).replace(",", "")) if m else None
    inner = m.group(2) if m else ""
    info["surface"] = next((x for x in ("障害", "ダート", "芝") if x in inner), "")
    info["turn"] = next((x for x in ("直線", "右", "左") if x in inner), "")
    info["outer"] = "外" in inner
    info["cls"] = next((c for c in ("新馬", "未勝利", "1勝クラス", "2勝クラス", "3勝クラス", "オープン")
                        if c in cap), "")
    info["grade"] = next((g for g in ("GⅠ", "GⅡ", "GⅢ", "Ｌ", "（L）") if g in cap), "")
    info["age_cond"] = next((a for a in ("2歳", "3歳以上", "3歳", "4歳以上") if a in cap), "")
    info["handicap"] = "ハンデ" in cap
    info["female"] = "牝" in cap.split("コース")[0]
    return info, tb


def parse_race(rid: str) -> list[dict]:
    rp = gzip.open(HTML / f"{rid}_r.html.gz", "rt", encoding="utf-8").read()
    op = gzip.open(HTML / f"{rid}_o.html.gz", "rt", encoding="utf-8").read()
    info, tb = race_info(rp)
    odds, fuku = {}, {}
    if op:
        ot = re.search(r"<table.*?</table>", op, flags=re.S)
        for row in re.findall(r"<tr>(.*?)</tr>", ot.group(0) if ot else "", flags=re.S):
            n = _txt(_cell(row, "num"))
            if n.isdigit():
                o = _txt(_cell(row, "odds_tan"))
                odds[int(n)] = float(o) if re.match(r"^\d+(\.\d+)?$", o) else None
                fm = re.search(r'class="min">([\d.]+)<', row)
                fuku[int(n)] = float(fm.group(1)) if fm else None
    body = tb[tb.find("<tbody"):]
    rows = []
    for row in re.findall(r"<tr>(.*?)</tr>", body, flags=re.S):
        num = _txt(_cell(row, "num"))
        if not num.isdigit():
            continue
        place = _txt(_cell(row, "place"))
        sa = _txt(_cell(row, "age"))
        hw = _txt(_cell(row, "h_weight"))
        hm = re.match(r"(\d+)\s*\(?([+-]?\d+|初出走|計不)?", hw)
        jk = _cell(row, "jockey")
        corner = re.findall(r"<li[^>]*>(\d+)</li>", _cell(row, "corner"))
        waku = re.search(r"枠(\d)", row)
        rows.append({
            "rid": rid, "venue": VENUE.get(rid[:2], rid[:2]), "date": rid[-8:],
            "race_no": int(rid[10:12]), **info,
            "umaban": int(num), "waku": int(waku.group(1)) if waku else None,
            "finish": int(place) if place.isdigit() else None, "status": "" if place.isdigit() else place,
            "horse_id": _id(_cell(row, "horse"), "pw01dud"),
            "horse_name": _txt(_cell(row, "horse")),
            "sex": sa[:1], "age": int(sa[1:]) if sa[1:].isdigit() else None,
            "weight": float(_txt(_cell(row, "weight")) or "nan"),
            "apprentice": "減量" in jk,
            "jockey_id": _id(jk, "pw04kmk"), "trainer_id": _id(_cell(row, "trainer"), "pw05cmk"),
            "time": _sec(_txt(_cell(row, "time"))),
            "last3f": float(_txt(_cell(row, "f_time")) or "nan") if re.match(r"^[\d.]+$", _txt(_cell(row, "f_time"))) else None,
            "corner_last": int(corner[-1]) if corner else None,
            "body": int(hm.group(1)) if hm else None,
            "body_diff": int(hm.group(2)) if hm and hm.group(2) and hm.group(2).lstrip("+-").isdigit() else None,
            "ninki": int(_txt(_cell(row, "pop"))) if _txt(_cell(row, "pop")).isdigit() else None,
            "odds": odds.get(int(num)), "fuku_min": fuku.get(int(num)),
        })
    return rows


def main():
    rids = sorted({p.name.split("_")[0] for p in HTML.glob("*_r.html.gz")})
    out, bad = [], 0
    for rid in rids:
        if not (HTML / f"{rid}_o.html.gz").exists():
            continue
        try:
            out += parse_race(rid)
        except Exception as e:  # 壊れたページは飛ばす
            bad += 1
            print("読めない", rid, e)
    df = pd.DataFrame(out)
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df.to_pickle(ROOT / "data" / "jra" / "runs.pkl")
    print(f"{df.rid.nunique()}レース {len(df)}頭 (読めない {bad})")


if __name__ == "__main__":
    main()
