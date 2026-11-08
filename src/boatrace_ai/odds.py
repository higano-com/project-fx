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


def fetch_many(races: list[tuple[date, int, int]], out_csv: Path, workers: int = 3, sleep: float = 1.0) -> None:
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
            if i % 20 == 0:
                f.flush()
    f.close()
