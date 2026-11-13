"""公式サイト(boatrace.jp)のレース結果ページから、着順(上位3艇)と払戻を読む.

レースが終わったあと、1レースにつき1回だけ取りに行く(取れなければ数分おきに数回)。
夜に出る競走成績ファイル(K)が手に入れば、そちらで上書きされる。
"""

from __future__ import annotations

import re
import urllib.request
from datetime import date

URL = "https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={jcd:02d}&hd={hd:%Y%m%d}"
_NUM = re.compile(r'numberSet1_number[^>]*>([1-6])</span>')
_PAY = re.compile(r'is-payout1">&yen;([\d,]+)')


def _bet(html: str, name: str, n: int):
    """勝式 name の行から (艇番 n 個, 払戻金). なければ None."""
    i = html.find(f">{name}</td>")
    if i < 0:
        return None
    seg = html[i: html.find("</tr>", i)]
    nums, pay = _NUM.findall(seg), _PAY.search(seg)
    if len(nums) < n or not pay:
        return None
    return [int(x) for x in nums[:n]], int(pay.group(1).replace(",", ""))


def parse_raceresult(html: str) -> dict | None:
    """{order, trifecta, trifecta_pay, win_lane, win_pay}. 結果がまだ(または特払いなど)なら None."""
    tri = _bet(html, "3連単", 3)
    if not tri:
        return None
    out = dict(order=tri[0], trifecta="-".join(map(str, tri[0])), trifecta_pay=tri[1])
    win = _bet(html, "単勝", 1)
    if win:
        out["win_lane"], out["win_pay"] = win[0][0], win[1]
    return out


def fetch_raceresult(d: date, venue: int, race_no: int, timeout: float = 20) -> dict | None:
    req = urllib.request.Request(URL.format(rno=race_no, jcd=venue, hd=d), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return parse_raceresult(resp.read().decode("utf-8", errors="replace"))
