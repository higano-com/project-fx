"""番組表(B)・競走成績(K)テキストのパーサ.

mbrace の固定長テキスト(Shift_JIS)を想定。桁位置のズレに強いよう、
選手行は正規表現/トークン分割で読む。
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ENCODING = "cp932"

CLASS_MAP = {"A1": 4, "A2": 3, "B1": 2, "B2": 1}

_B_VENUE = re.compile(r"^(\d{2})BBGN")
_K_VENUE = re.compile(r"^(\d{2})KBGN")
_RACE = re.compile(r"^\s*(\d{1,2})R\s")
_DIST = re.compile(r"H(\d{3,4})m")
_B_ENTRY = re.compile(
    r"^([1-6]) (\d{4})(.{4})\s*(\d{2})(.{2})\s*(\d{2})([AB][12])\s*"
    r"(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+"
    r"(\d+)\s+(\d+\.\d+)\s+(\d+)\s+(\d+\.\d+)"
)
_K_RESULT = re.compile(r"^\s*(0[1-6]|[A-Z]\d?)\s+([1-6])\s+(\d{4})\s+(.*)$")
_TRIFECTA = re.compile(r"3連単\s+([1-6])-([1-6])-([1-6])\s+(\d+)")
_WIN = re.compile(r"^\s*単勝\s+([1-6])\s+(\d+)")
_FLOAT2 = re.compile(r"^\d?\.\d\d$")


def _nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s)


def date_from_filename(path: Path) -> date:
    """b240401.txt / k240401.txt -> date(2024, 4, 1)."""
    m = re.search(r"[bkBK](\d{6})", path.name)
    if not m:
        raise ValueError(f"cannot infer date from {path}")
    return datetime.strptime(m.group(1), "%y%m%d").date()


def read_text(path: Path) -> str:
    return Path(path).read_bytes().decode(ENCODING, errors="replace")


# --------------------------------------------------------------------------- B

def parse_program(text: str, race_date: date) -> pd.DataFrame:
    """番組表 -> 1行=1艇 の DataFrame."""
    rows = []
    venue = race_no = None
    distance = None
    for line in text.splitlines():
        if m := _B_VENUE.match(line):
            venue, race_no = int(m.group(1)), None
            continue
        norm = _nfkc(line)
        if (m := _RACE.match(norm)) and venue is not None:
            race_no = int(m.group(1))
            dm = _DIST.search(norm)
            distance = int(dm.group(1)) if dm else None
            continue
        if race_no is None:
            continue
        if m := _B_ENTRY.match(line):
            g = m.groups()
            rows.append(
                dict(
                    date=pd.Timestamp(race_date), venue=venue, race_no=race_no,
                    distance=distance, lane=int(g[0]), reg_no=int(g[1]),
                    name=g[2].replace("　", "").strip(), age=int(g[3]),
                    branch=g[4].strip(), weight=int(g[5]), grade=g[6],
                    class_num=CLASS_MAP.get(g[6], 0),
                    nat_win=float(g[7]), nat_2=float(g[8]),
                    loc_win=float(g[9]), loc_2=float(g[10]),
                    motor_no=int(g[11]), motor_2=float(g[12]),
                    boat_no=int(g[13]), boat_2=float(g[14]),
                )
            )
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- K

def _parse_result_tail(tail: str) -> dict:
    """着/艇/登番 以降(選手名, ﾓｰﾀｰ, ﾎﾞｰﾄ, 展示, 進入, ST, ﾀｲﾑ) を読む."""
    toks = tail.split()
    out = dict(exhibit=None, course=None, st=None)
    for i in range(len(toks) - 2):
        if toks[i].isdigit() and toks[i + 1].isdigit() and _FLOAT2.match(toks[i + 2]):
            out["exhibit"] = float(toks[i + 2])
            rest = toks[i + 3:]
            if rest and rest[0] in "123456" and len(rest[0]) == 1:
                out["course"] = int(rest[0])
            if len(rest) > 1 and _FLOAT2.match(rest[1]):
                out["st"] = float(rest[1])
            break
    return out


def parse_results(text: str, race_date: date) -> tuple[pd.DataFrame, pd.DataFrame]:
    """競走成績 -> (着順 DataFrame, 払戻 DataFrame)."""
    results, payouts = [], {}
    venue = race_no = None
    for line in text.splitlines():
        if m := _K_VENUE.match(line):
            venue, race_no = int(m.group(1)), None
            continue
        norm = _nfkc(line)
        if (m := _RACE.match(norm)) and venue is not None:
            race_no = int(m.group(1))
            continue
        if race_no is None:
            continue
        key = (venue, race_no)
        if m := _K_RESULT.match(norm):
            fin = m.group(1)
            row = dict(
                date=pd.Timestamp(race_date), venue=venue, race_no=race_no,
                lane=int(m.group(2)), reg_no=int(m.group(3)),
                finish=int(fin) if fin.isdigit() else None,
                finish_raw=fin,
            )
            row.update(_parse_result_tail(m.group(4)))
            results.append(row)
            continue
        if m := _TRIFECTA.search(norm):
            p = payouts.setdefault(key, {})
            p["trifecta"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            p["trifecta_pay"] = int(m.group(4))
        elif m := _WIN.match(norm):
            p = payouts.setdefault(key, {})
            p["win_lane"] = int(m.group(1))
            p["win_pay"] = int(m.group(2))

    res = pd.DataFrame(results)
    pay = pd.DataFrame(
        [dict(date=pd.Timestamp(race_date), venue=v, race_no=r, **p) for (v, r), p in payouts.items()]
    )
    return res, pay


# --------------------------------------------------------------------------- dir

def load_dir(data_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """data_dir 内の b*.txt / k*.txt を全部読む -> (programs, results, payouts)."""
    data_dir = Path(data_dir)
    progs, ress, pays = [], [], []
    for path in sorted(data_dir.glob("b*.txt")):
        progs.append(parse_program(read_text(path), date_from_filename(path)))
    for path in sorted(data_dir.glob("k*.txt")):
        r, p = parse_results(read_text(path), date_from_filename(path))
        ress.append(r)
        pays.append(p)

    def cat(dfs):
        dfs = [d for d in dfs if not d.empty]
        return pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()

    return cat(progs), cat(ress), cat(pays)
