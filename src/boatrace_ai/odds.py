"""公式サイト(boatrace.jp)から単勝・複勝の締切時オッズを取得する.

1レース1ページ。サーバ負荷に配慮して、並列数を絞り間隔をあける。
"""

from __future__ import annotations

import csv
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

URL = "https://www.boatrace.jp/owpc/pc/race/oddstf?rno={rno}&jcd={jcd:02d}&hd={hd:%Y%m%d}"
_POINT = re.compile(r'oddsPoint[^>]*>([^<]*)<')
HEADER = ["date", "venue", "race_no", "lane", "win_odds", "place_lo", "place_hi"]


def _num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return None


def fetch_race_odds(d: date, venue: int, race_no: int, timeout: float = 60) -> list[dict]:
    req = urllib.request.Request(URL.format(rno=race_no, jcd=venue, hd=d), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    pts = [p.strip() for p in _POINT.findall(html)]
    if len(pts) < 12:
        return []
    rows = []
    for lane in range(1, 7):
        lo, _, hi = pts[5 + lane].partition("-")
        rows.append(dict(date=f"{d:%Y-%m-%d}", venue=venue, race_no=race_no, lane=lane,
                         win_odds=_num(pts[lane - 1]), place_lo=_num(lo), place_hi=_num(hi or lo)))
    return rows


def fetch_many(races: list[tuple[date, int, int]], out_csv: Path, workers: int = 1, sleep: float = 2.0) -> None:
    """races を取得して out_csv に追記する。取得済みのレースは飛ばす."""
    out_csv = Path(out_csv)
    done = set()
    if out_csv.exists():
        with open(out_csv, encoding="utf-8") as f:
            done = {(r["date"], int(r["venue"]), int(r["race_no"])) for r in csv.DictReader(f)}
    todo = [r for r in races if (f"{r[0]:%Y-%m-%d}", r[1], r[2]) not in done]
    new_file = not out_csv.exists()
    f = open(out_csv, "a", newline="", encoding="utf-8")
    w = csv.DictWriter(f, fieldnames=HEADER)
    if new_file:
        w.writeheader()

    def job(r):
        try:
            rows = fetch_race_odds(*r)
        except Exception:
            rows = []
        time.sleep(sleep)
        return rows

    with ThreadPoolExecutor(workers) as ex:
        for i, rows in enumerate(ex.map(job, todo), 1):
            w.writerows(rows)
            f.flush()  # 途中で止めても取得済みの分は残す
    f.close()


URL_3T = "https://www.boatrace.jp/owpc/pc/race/odds3t?rno={rno}&jcd={jcd:02d}&hd={hd:%Y%m%d}"


def parse_trifecta_odds(html: str) -> dict[str, float]:
    """3連単オッズのページ -> {"1-2-3": 7.5, ...} (120通り).

    表は「1着の艇ごとの列」×「2着・3着の行」で、左上から行ごとに並んでいる。
    """
    pts = [p.strip() for p in _POINT.findall(html)]
    if len(pts) != 120:
        return {}
    out = {}
    for row in range(20):
        for col in range(6):
            first = col + 1
            seconds = [l for l in range(1, 7) if l != first]
            second = seconds[row // 4]
            thirds = [l for l in range(1, 7) if l not in (first, second)]
            third = thirds[row % 4]
            v = _num(pts[row * 6 + col])
            if v:
                out[f"{first}-{second}-{third}"] = v
    return out


def fetch_trifecta_odds(d: date, venue: int, race_no: int, timeout: float = 60) -> dict[str, float]:
    req = urllib.request.Request(URL_3T.format(rno=race_no, jcd=venue, hd=d), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return parse_trifecta_odds(resp.read().decode("utf-8", errors="replace"))
