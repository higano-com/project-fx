"""中央競馬(JRA): 公式サイトの「過去のレース結果」と確定オッズを1本ずつ取得する。

月 → 開催日 → レース結果 → 単勝・複勝オッズ の順に辿り、生のHTMLを data/jra/html/ に gzip で保存する。
- サーバに配慮して1本ずつ、5秒以上あける(http_jra.py が全プロセスで順番待ち)。取得済みのレースは飛ばす(途中から再開できる)。
- 取得したデータは私的な分析にだけ使う(再配布しない)。data/ は git 管理外。

使い方:
  python jra/fetch.py 2025-01 2026-10
"""
import gzip
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from http_jra import post  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data" / "jra" / "html"


def month_codes(html: str) -> dict:
    return dict(re.findall(r'objParam\["(\d{4})"\]="([0-9A-F]{2})"', html))


def save(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(text)


def months(a: str, b: str):
    y, m = map(int, a.split("-"))
    y2, m2 = map(int, b.split("-"))
    while (y, m) <= (y2, m2):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def main():
    a, b = sys.argv[1:3]
    codes = month_codes(post("accessS.html", "pw01skl00999999/B3"))
    for y, m in months(a, b):
        key = f"{y % 100:02d}{m:02d}"
        mhtml = post("accessS.html", f"pw01skl10{y}{m:02d}/{codes[key]}")
        days = sorted(set(re.findall(r"pw01srl\d+/[0-9A-F]{2}", mhtml)))
        n_new = 0
        for dc in days:
            dhtml = post("accessS.html", dc)
            for rc in sorted(set(re.findall(r"pw01sde\d+/[0-9A-F]{2}", dhtml))):
                rid = rc[7:].split("/")[0]  # 場(2)年(4)回(2)日(2)R(2)日付(8)
                rp, op = OUT / f"{rid}_r.html.gz", OUT / f"{rid}_o.html.gz"
                if rp.exists() and op.exists():
                    continue
                rhtml = post("accessS.html", rc)
                save(rp, rhtml)
                oc = re.search(r"pw151ou\d+Z/[0-9A-F]{2}", rhtml)
                if oc:
                    save(op, post("accessO.html", oc.group(0)))
                else:
                    save(op, "")
                n_new += 1
        print(f"{y}-{m:02d}: 開催日{len(days)} 新規{n_new}レース", flush=True)


if __name__ == "__main__":
    main()
