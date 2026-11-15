"""中央競馬: 競走馬情報ページ(data/jra/horse/*.html.gz)を表にする。

出力:
  data/jra/horses.pkl  … 1頭1行のプロフィール(父・母・母の父・母の母・馬主・生産牧場・産地・生年月日・毛色・セリ)
  data/jra/career.pkl  … 全出走歴(手元にない古いレース・地方・海外も含む)。1走1行。

※ 賞金は「いま時点」の合計なので、過去のレースの予想に使うと未来の情報が混ざる。使わない。
※ 出走歴も未来のレースを含むので、使うときは必ず「そのレースより前の日付」だけに絞る。

使い方: python jra/parse_horse.py
"""
import gzip
import html as H
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "jra" / "horse"
OUT = ROOT / "data" / "jra"

FIELDS = {"父": "sire", "母": "dam", "母の父": "damsire", "母の母": "dam_dam", "性別": "sex_p", "馬主名": "owner",
          "生年月日": "birth", "生産牧場": "breeder", "毛色": "color", "産地": "region", "取引市場": "market"}


def text(s: str) -> str:
    s = re.sub(r'<span class="sanku">.*?</span>', "", s, flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def jdate(s: str):
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    return pd.Timestamp(int(m[1]), int(m[2]), int(m[3])) if m else pd.NaT


def profile(h: str, hid: str) -> dict:
    p = {"horse_id": hid}
    m = re.search(r'<div class="profile.*?</ul>', h, re.S)
    for dt, dd in re.findall(r"<dt>(.*?)</dt>\s*<dd>(.*?)</dd>", m.group(0) if m else "", re.S):
        k = FIELDS.get(text(dt))
        if k:
            p[k] = text(dd)
            ids = re.search(r"pw01dud(\d+)/", dd)
            if ids and k in ("sire", "dam", "damsire"):
                p[k + "_id"] = ids.group(1)
    tr = re.search(r"調教師名</dt>\s*<dd>.*?（(美浦|栗東)）", h, re.S)
    p["center"] = tr.group(1) if tr else None
    p["birth"] = jdate(p.get("birth"))
    mk = p.get("market") or ""
    p["market_name"] = re.sub(r"^\d{4}年\s*", "", mk) or None
    return p


def career(h: str, hid: str) -> list:
    rows = []
    m = re.search(r"<th[^>]*>年月日</th>.*?<tbody>(.*?)</tbody>", h, re.S)
    if not m:
        return rows
    for tr in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
        td = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(td) < 13:
            continue
        c = [text(x) for x in td]
        rid = re.search(r"pw01sde10(\d{20})/", td[2])
        sd = re.match(r"(芝|ダ|障)\D*?(\d+)", c[3])

        def num(s):
            try:
                return float(s.replace(",", ""))
            except ValueError:
                return None
        tm = re.match(r"(?:(\d+):)?(\d+\.\d)", c[11])
        rows.append(dict(
            horse_id=hid, date=jdate(c[0]), venue=c[1], rid=rid.group(1) if rid else None, race=c[2],
            surface={"芝": "芝", "ダ": "ダート", "障": "障害"}.get(sd.group(1)) if sd else None,
            dist=int(sd.group(2)) if sd else None, baba=c[4], n=num(c[5]), ninki=num(c[6]),
            finish=num(c[7]), status=None if num(c[7]) else c[7], jockey=c[8], weight=num(c[9]), body=num(c[10]),
            time=(int(tm.group(1) or 0) * 60 + float(tm.group(2))) if tm else None, winner=c[13] if len(c) > 13 else None,
            jra=bool(rid)))
    return rows


def main():
    P, C = [], []
    for f in sorted(SRC.glob("*.html.gz")):
        h = gzip.open(f, "rt", encoding="utf-8").read()
        hid = f.name.split(".")[0]
        if "プロフィール" not in h:
            continue
        P.append(profile(h, hid))
        C += career(h, hid)
    p, c = pd.DataFrame(P), pd.DataFrame(C)
    p.to_pickle(OUT / "horses.pkl")
    c.to_pickle(OUT / "career.pkl")
    print(f"馬 {len(p)}頭 / 出走歴 {len(c)}走(JRA {c.jra.sum() if len(c) else 0})")


if __name__ == "__main__":
    main()
