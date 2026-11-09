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


_W_TEMP = re.compile(r'is-direction">.*?LabelData">([-\d.]+)℃', re.S)
_W_WEATHER = re.compile(r'is-weather">.*?LabelTitle">([^<]+)<', re.S)
_W_WIND = re.compile(r'is-wind">.*?LabelData">(\d+)m', re.S)
_W_WINDDIR = re.compile(r'is-windDirection">\s*<p class="weather1_bodyUnitImage is-wind(\d+)"', re.S)
_W_WATER = re.compile(r'is-waterTemperature">.*?LabelData">([-\d.]+)℃', re.S)
_W_WAVE = re.compile(r'is-wave">.*?LabelData">(\d+)cm', re.S)


def parse_weather(html: str) -> dict:
    """水面気象情報 (気温・天気・風速・風向・水温・波高). 取れないものは入れない."""
    out = {}
    for key, rx, conv in (("air_temp", _W_TEMP, float), ("weather", _W_WEATHER, str.strip),
                          ("wind", _W_WIND, int), ("wind_dir", _W_WINDDIR, int),
                          ("water_temp", _W_WATER, float), ("wave", _W_WAVE, int)):
        m = rx.search(html)
        if m:
            out[key] = conv(m.group(1))
    return out


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
        weather_ex=parse_weather(html) or None,
        ex_times=[ex[l] for l in range(1, 7)],
        tilts=[tilt.get(l) for l in range(1, 7)],
        st_ex=[st.get(l) for l in range(1, 7)] if len(st) == 6 else None,
        course_ex=[course.get(l) for l in range(1, 7)] if len(course) == 6 else None,
    )


def fetch_beforeinfo(d: date, venue: int, race_no: int, timeout: float = 60) -> dict | None:
    req = urllib.request.Request(URL.format(rno=race_no, jcd=venue, hd=d), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return parse_beforeinfo(resp.read().decode("utf-8", errors="replace"))


def collect(races: list[tuple], out_jsonl, sleep: float = 2.0, log=print) -> int:
    """過去レースの直前情報を1本ずつ集めて JSON Lines に追記する. 取得済みは飛ばす."""
    import json
    import time
    from pathlib import Path

    out_jsonl = Path(out_jsonl)
    done = set()
    if out_jsonl.exists():
        for line in out_jsonl.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            done.add((r["date"], r["venue"], r["race_no"]))
    n = 0
    with open(out_jsonl, "a", encoding="utf-8") as f:
        for d, venue, race_no in races:
            key = (f"{d:%Y-%m-%d}", int(venue), int(race_no))
            if key in done:
                continue
            try:
                info = fetch_beforeinfo(d, venue, race_no, timeout=30)
            except Exception as e:  # 通信エラーは飛ばして次へ (あとで再実行すれば取り直す)
                log(f"失敗 {key}: {e}")
                info = None
            if info:
                f.write(json.dumps(dict(date=key[0], venue=key[1], race_no=key[2], **info), ensure_ascii=False) + "\n")
                f.flush()
                n += 1
            time.sleep(sleep)
    return n
