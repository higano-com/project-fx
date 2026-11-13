"""見張りが動いていなかった日の展示・オッズを、あとから埋める.

1レースずつ、展示 → 単勝オッズ → 3連単オッズの順に取りに行く(公式サイトへは polite で1本ずつ)。
オッズは締切後の最終オッズになる(締切数分前のものではない)。
取れた分はレースごとにすぐ保存するので、途中で止めても続きからやり直せる。
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .beforeinfo import fetch_beforeinfo
from .odds import fetch_race_odds, fetch_trifecta_odds


def backfill_day(site_dir: Path, day: str, ex_predictor=None, log=print) -> int:
    """site_dir/data/<day>.json の各レースに展示・オッズを書き込む. 戻り値: 書き込んだレース数."""
    path = Path(site_dir) / "data" / f"{day}.json"
    d = date.fromisoformat(day)
    data = json.loads(path.read_text(encoding="utf-8"))
    done = 0
    for vi, v in enumerate(data["venues"]):
        for ri, r in enumerate(v["races"]):
            name = f"{v['name']}{r['no']}R"
            changed = False
            if not r.get("ex_times"):
                try:
                    info = fetch_beforeinfo(d, v["code"], r["no"], timeout=30)
                except Exception as e:
                    info = None
                    log(f"展示の取得失敗 {name}: {e}")
                if info:
                    r.update({k: val for k, val in info.items() if val is not None})
                    if ex_predictor is not None:
                        try:
                            r["p_ex"] = ex_predictor.predict(v["code"], r["no"], info["ex_times"], info.get("course_ex"), info.get("weather_ex"))
                        except Exception as e:
                            log(f"展示AIの計算に失敗 {name}: {e}")
                    changed = True
            if not r.get("odds"):
                try:
                    rows = fetch_race_odds(d, v["code"], r["no"], timeout=30)
                except Exception as e:
                    rows = []
                    log(f"単勝オッズの取得失敗 {name}: {e}")
                odds = [x["win_odds"] for x in sorted(rows, key=lambda x: x["lane"])]
                if len(odds) == 6 and any(o for o in odds):
                    r["odds"], r["odds_time"] = odds, "最終"
                    changed = True
            if not r.get("tri_odds"):
                try:
                    tri = fetch_trifecta_odds(d, v["code"], r["no"], timeout=30)
                except Exception as e:
                    tri = {}
                    log(f"3連単オッズの取得失敗 {name}: {e}")
                if len(tri) >= 100:
                    r["tri_odds"], r["odds_time"] = tri, "最終"
                    changed = True
            if changed:
                # 見張りは当日のファイルしか触らないが、念のため保存の直前に読み直して、このレースだけ書き換える
                cur = json.loads(path.read_text(encoding="utf-8"))
                cur["venues"][vi]["races"][ri] = r
                path.write_text(json.dumps(cur, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                done += 1
            log(f"{name} {'埋めた' if changed else '変化なし'}")
    return done
