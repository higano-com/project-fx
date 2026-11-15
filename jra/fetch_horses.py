"""中央競馬: 出走した馬の「競走馬情報」ページを1頭1回ずつ取得する。

結果ページ(data/jra/html/*_r.html.gz)にある馬へのリンクを集め、まだ持っていない馬だけ取る。
血統(父・母・母の父)・馬主・生産牧場・産地・生年月日・セリ・全出走歴が載っている。
- アクセスは http_jra.py 経由(全プロセス1本ずつ・5秒以上あける)。途中から再開できる。
- 取得したデータは私的な分析にだけ使う(再配布しない)。data/ は git 管理外。

使い方: python jra/fetch_horses.py
"""
import gzip
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from http_jra import post  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "data" / "jra" / "html"
OUT = ROOT / "data" / "jra" / "horse"


def links() -> dict:
    """馬ID → CNAME。新しいレースの馬から先に取る。"""
    out = {}
    for f in sorted(HTML.glob("*_r.html.gz"), key=lambda p: p.name[12:20], reverse=True):
        for m in re.finditer(r"pw01dud(\d+)/[0-9A-F]{2}", gzip.open(f, "rt", encoding="utf-8").read()):
            out.setdefault(m.group(1), m.group(0))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    todo = {h: c for h, c in links().items() if not (OUT / f"{h}.html.gz").exists()}
    print(f"馬 {len(todo)}頭を取得します", flush=True)
    for i, (h, c) in enumerate(todo.items(), 1):
        text = post("accessU.html", c)
        with gzip.open(OUT / f"{h}.html.gz", "wt", encoding="utf-8") as f:
            f.write(text)
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}", flush=True)
    print("馬の取得おわり", flush=True)


if __name__ == "__main__":
    main()
