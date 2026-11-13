"""地方競馬の公式CSV(月次ファイル)を1本ずつ取得する。

keiba.go.jp の「データダウンロード」機能を使う。
- サイトは異常な件数のアクセスを遮断するので、1本ずつ・間隔をあけて取る。
- 同じ月のファイルは1日1回まで(すでに持っている月は取り直さない)。
- 取得したデータは私的な分析にだけ使う(再配布しない)。data/ は git 管理外。

使い方:
  python nar/fetch.py race 2022-01 2026-10   # レース情報(出馬表・払戻・レース一覧)
  python nar/fetch.py odds 2026-03 2026-10   # 確定オッズ(単勝・複勝・馬単だけ残す)
"""
import io
import sys
import time
import zipfile
import urllib.request
from pathlib import Path

BASE = "https://www.keiba.go.jp/KeibaWeb/DataDownload/"
OUT = Path(__file__).resolve().parent.parent / "data" / "nar"
SLEEP = 10  # 秒。1本ごとの間隔
KEEP_ODDS = ("単勝", "複勝", "馬単")


def months(a: str, b: str):
    y, m = map(int, a.split("-"))
    y2, m2 = map(int, b.split("-"))
    while (y, m) <= (y2, m2):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (personal research)"})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:  # 失敗したら間をあけて再試行
            print(f"  失敗 {e}、待って再試行", flush=True)
            time.sleep(60 * (i + 1))
    raise RuntimeError(url)


def text(zf: zipfile.ZipFile, name: str) -> str:
    return zf.read(name).decode("utf-8-sig")


def fetch_race(y: int, m: int) -> bool:
    d = OUT / "csv"
    d.mkdir(parents=True, exist_ok=True)
    tag = f"{y}{m:02d}"
    if (d / f"{tag}_horselist.csv").exists():
        return False
    data = get(f"{BASE}RaceDataDownload?type=monthly&k_year={y}&k_month={m}")
    zf = zipfile.ZipFile(io.BytesIO(data))
    for n in zf.namelist():
        (d / Path(n).name).write_text(text(zf, n), encoding="utf-8")
    print(f"race {tag}: {len(data)//1024}KB {zf.namelist()}", flush=True)
    return True


def fetch_odds(y: int, m: int) -> bool:
    d = OUT / "odds"
    d.mkdir(parents=True, exist_ok=True)
    tag = f"{y}{m:02d}"
    out = d / f"odds_{tag}.csv"
    if out.exists():
        return False
    data = get(f"{BASE}OddsDataDownload?type=monthly&k_year={y}&k_month={m}")
    zf = zipfile.ZipFile(io.BytesIO(data))
    rows = []
    for n in sorted(zf.namelist()):
        for i, line in enumerate(text(zf, n).splitlines()):
            if i == 0:
                if not rows:
                    rows.append(line)
                continue
            if line.split(",", 4)[3] in KEEP_ODDS:
                rows.append(line)
    out.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"odds {tag}: {len(data)//1024}KB → {len(rows)}行", flush=True)
    return True


def main():
    kind, a, b = sys.argv[1:4]
    fn = {"race": fetch_race, "odds": fetch_odds}[kind]
    for y, m in months(a, b):
        if fn(y, m):
            time.sleep(SLEEP)


if __name__ == "__main__":
    main()
