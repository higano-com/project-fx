"""Claude のページ(アーティファクト)用のアプリを組み立てる.

Claude のページでは、別ファイルの読み込み・ホーム画面用の設定・Service Worker が使えない。
そこで app/index.html からそれらを外し、予想データをページに直接埋め込んだ1ファイルを作る。
"""

from __future__ import annotations

import json
import re
from pathlib import Path


def to_claude_page(html: str) -> str:
    """app/index.html を Claude のページ用に作り変える (データはまだ入れない)."""
    s = re.sub(r"<!doctype html>\s*<html lang=\"ja\">\s*<head>\s*", "", html)
    s = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", s)
    s = s.replace("<title>ボートAI</title>",
                  '<title>ボートAI</title>\n<meta name="claude:viewport-fit-sides" content="cover">')
    s = re.sub(r'<meta name="(theme-color|apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>\s*', "", s)
    s = re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*', "", s)
    s = s.replace("</head>\n<body>\n", "").replace("</body>\n</html>\n", "")
    s = s.replace("  padding-top: env(safe-area-inset-top, 0px);\n", "")
    s = s.replace('  if (!standalone && !store.get("install-hidden", false)) $("install").hidden = false;\n', "")
    s = re.sub(r'  if \("serviceWorker" in navigator\).*\n', "", s)
    return s


def build_claude_page(app_html: Path, site_dir: Path, out: Path) -> Path:
    """site_dir (boatrace-ai site の出力) のデータを埋め込んだページを out に書く."""
    site_dir = Path(site_dir)
    index = json.loads((site_dir / "days.json").read_text(encoding="utf-8"))
    days = {d["date"]: json.loads((site_dir / "data" / f"{d['date']}.json").read_text(encoding="utf-8"))
            for d in index["days"]}
    blob = json.dumps({"index": index, "days": days}, ensure_ascii=False, separators=(",", ":"))
    blob = blob.replace("</", "<\\/")  # </script> で途切れないように
    page = to_claude_page(Path(app_html).read_text(encoding="utf-8"))
    marker = "<script>\n(function () {"
    if marker not in page:
        raise ValueError("アプリ本体のスクリプトが見つかりません")
    page = page.replace(marker, f"<script>window.__BOAT_DATA__ = {blob};</script>\n{marker}", 1)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(page, encoding="utf-8")
    return Path(out)
