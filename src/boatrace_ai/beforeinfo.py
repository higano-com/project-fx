"""公式サイト(boatrace.jp)の直前情報(展示タイム・チルト・スタート展示)を取得する.

1レース1ページ。締切の少し前にだけ、間隔をあけて取りに行く。
"""

from __future__ import annotations

import re
import urllib.request
from datetime import date

URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={rno}&jcd={jcd:02d}&hd={hd:%Y%m%d}"

_ROW = re.compile(
    r'is-boatColor\d[^"]*" rowspan="4">([1-6])</td>.*?kg</td>\s*'
    r'<td rowspan="4">([\d.]*)</td>\s*<td rowspan="4">([-\d.]*)</td>',
    re.S,
)
# フライング等のときは class が増える (例: "table1_boatImage1Time is-fBold is-fColor1")
_ST = re.compile(r'table1_boatImage1Number[^"]*">([1-6])</span>.*?table1_boatImage1Time[^"]*">([^<]*)</span>', re.S)


def parse_beforeinfo(html: str) -> dict | None:
    """展示が出そろっていれば {ex_times, tilts, st_ex, course_ex}(艇番順の6要素)。まだなら None."""
    ex, tilt = {}, {}
    for lane, t, tl in _ROW.findall(html):
        if t:
            ex[int(lane)] = float(t)
        if tl:
            tilt[int(lane)] = float(tl)
    if len(ex) < 6:
        return None
    st, course = {}, {}
    for i, (lane, t) in enumerate(_ST.findall(html), 1):
        course[int(lane)] = i
        t = t.strip()
        st[int(lane)] = t  # ".18" / "F.05" / "L" などをそのまま
    return dict(
        ex_times=[ex[l] for l in range(1, 7)],
        tilts=[tilt.get(l) for l in range(1, 7)],
        st_ex=[st.get(l) for l in range(1, 7)] if len(st) == 6 else None,
        course_ex=[course.get(l) for l in range(1, 7)] if len(course) == 6 else None,
    )


def fetch_beforeinfo(d: date, venue: int, race_no: int, timeout: float = 60) -> dict | None:
    req = urllib.request.Request(URL.format(rno=race_no, jcd=venue, hd=d), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return parse_beforeinfo(resp.read().decode("utf-8", errors="replace"))
