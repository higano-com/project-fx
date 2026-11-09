"""締切が近いレースの直前情報(展示)を見張って、予想データに書き込む.

- 締切の22分前〜締切までのレースだけ、1レースずつ間隔をあけて取りに行く
- 展示がまだ出ていなければ、3分おきに数回だけ取り直す
- 新しく取れたらアプリ(Claude のページ)を作り直し、終了コード0で終わる
  (呼び出し側がページを公開し、もう一度起動する)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .beforeinfo import fetch_beforeinfo
from .claude_page import build_claude_page

JST = ZoneInfo("Asia/Tokyo")
WINDOW_MIN = 22      # 締切の何分前から取りに行くか
RETRY_SEC = 180      # 展示がまだの時に取り直す間隔
MAX_TRIES = 6
REQUEST_GAP = 3.0    # 公式サイトへのアクセス間隔(秒)
BATCH_SEC = 240      # 取れた展示をまとめて公開するまで待つ最大時間
URGENT_MIN = 12      # 締切がこれより近いレースが取れたら、すぐ公開


def _deadline(day: str, hhmm: str) -> datetime:
    return datetime.strptime(f"{day} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=JST)


def watch(site_dir: Path, app_html: Path, out_page: Path, day: str | None = None,
          poll_sec: float = 60, log=print) -> str:
    """戻り値: "updated"(公開が必要) / "finished"(その日の対象レースが全部終わった)."""
    site_dir = Path(site_dir)
    day = day or datetime.now(JST).strftime("%Y-%m-%d")
    path = site_dir / "data" / f"{day}.json"
    tries: dict[tuple, list] = {}
    pending: list[str] = []
    first_pending = None
    urgent = False

    while True:
        now = datetime.now(JST)
        data = json.loads(path.read_text(encoding="utf-8"))
        remaining = 0
        for v in data["venues"]:
            for r in v["races"]:
                if not r.get("deadline"):
                    continue
                dl = _deadline(day, r["deadline"])
                if dl <= now:
                    continue
                remaining += 1
                if r.get("ex_times"):
                    continue
                key = (v["code"], r["no"])
                n, last = tries.get(key, [0, None])
                if dl - now > timedelta(minutes=WINDOW_MIN) or n >= MAX_TRIES:
                    continue
                if last and (now - last).total_seconds() < RETRY_SEC:
                    continue
                try:
                    info = fetch_beforeinfo(now.date() if day == now.strftime("%Y-%m-%d") else datetime.strptime(day, "%Y-%m-%d").date(),
                                            v["code"], r["no"])
                except Exception as e:  # 通信エラーは次の回に
                    info = None
                    log(f"取得失敗 {v['name']}{r['no']}R: {e}")
                tries[key] = [n + 1, now]
                time.sleep(REQUEST_GAP)
                if info:
                    r.update({k: val for k, val in info.items() if val is not None})
                    pending.append(f"{v['name']}{r['no']}R")
                    first_pending = first_pending or now
                    if dl - now <= timedelta(minutes=URGENT_MIN):
                        urgent = True
        if pending:
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            if urgent or (now - first_pending).total_seconds() >= BATCH_SEC:
                build_claude_page(app_html, site_dir, out_page)
                log("展示を反映: " + ", ".join(pending))
                return "updated"
        if remaining == 0:
            return "finished"
        time.sleep(poll_sec)
