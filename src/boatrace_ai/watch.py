"""締切が近いレースの直前情報(展示)を見張って、予想データに書き込む.

- 締切の22分前〜締切までのレースだけ、1レースずつ間隔をあけて取りに行く
- 展示がまだ出ていなければ、3分おきに数回だけ取り直す
- レースが終わったら結果ページを1回取りに行き、的中/ハズレをすぐ出す(まだなら数分おきに数回)
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
from .odds import fetch_race_odds, fetch_trifecta_odds
from .raceresult import fetch_raceresult
from .claude_page import build_claude_page

JST = ZoneInfo("Asia/Tokyo")
WINDOW_MIN = 22      # 締切の何分前から取りに行くか
RETRY_SEC = 90       # 展示がまだの時に取り直す間隔
MAX_TRIES = 12
REQUEST_GAP = 3.0    # 公式サイトへのアクセス間隔(秒)
BATCH_SEC = 20 * 60  # 展示・結果だけの更新は、まとめて最大この時間ごとに公開する(公開の回数を減らす)
PUBLISH_BEFORE_MIN = 3.5  # オッズが取れたレースは、締切のこの分前までに公開する(近いレースをまとめて1回で)
ODDS_MAX_LEFT = 6    # 締切の何分前からオッズを取るか
ODDS_MIN_LEFT = 2    # 締切の何分前までにオッズを取るか
RESULT_AFTER_MIN = 7     # 締切の何分後から結果を取りに行くか
RESULT_RETRY_SEC = 180   # 結果がまだの時に取り直す間隔
RESULT_MAX_TRIES = 6     # これで取れなければ夜の成績ファイルにまかせる
RESULT_PER_PASS = 2      # 1回の見回りで取りに行く結果の数 (オッズ・展示を優先するため)


def _deadline(day: str, hhmm: str) -> datetime:
    return datetime.strptime(f"{day} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=JST)


def _log(msg: str) -> None:
    print(msg, flush=True)


def watch(site_dir: Path, app_html: Path, out_page: Path, day: str | None = None,
          poll_sec: float = 60, log=_log, ex_predictor=None, keep_running: bool = False) -> str:
    """戻り値: "updated"(公開が必要) / "finished"(その日の対象レースが全部終わった)."""
    site_dir = Path(site_dir)
    day = day or datetime.now(JST).strftime("%Y-%m-%d")
    path = site_dir / "data" / f"{day}.json"
    tries: dict[tuple, list] = {}
    pending: list[str] = []
    first_pending = None
    odds_due = None  # オッズを取ったレースのうち、いちばん早い締切

    while True:
        now = datetime.now(JST)
        data = json.loads(path.read_text(encoding="utf-8"))
        remaining = 0
        dirty = False
        result_budget = RESULT_PER_PASS
        for v in data["venues"]:
            for r in v["races"]:
                if not r.get("deadline"):
                    continue
                dl = _deadline(day, r["deadline"])
                key = (v["code"], r["no"])
                race_day = datetime.strptime(day, "%Y-%m-%d").date()
                if dl <= now:
                    # --- レース後の結果 (1レース1回。まだなら数分おきに数回) ---
                    # 回数はデータに記録する (見張りを再開しても取り直しすぎないように)
                    rkey = ("result",) + key
                    n, last = r.get("result_tries", 0), tries.get(rkey)
                    if r.get("result") or n >= RESULT_MAX_TRIES:
                        continue
                    remaining += 1
                    if now - dl < timedelta(minutes=RESULT_AFTER_MIN) or (last and (now - last).total_seconds() < RESULT_RETRY_SEC):
                        continue
                    if result_budget <= 0:
                        continue
                    result_budget -= 1
                    try:
                        res = fetch_raceresult(race_day, v["code"], r["no"], timeout=20)
                    except Exception as e:
                        res = None
                        log(f"結果取得失敗 {v['name']}{r['no']}R: {e}")
                    tries[rkey], r["result_tries"], dirty = now, n + 1, True
                    log(f"{now:%H:%M:%S} {v['name']}{r['no']}R 結果{'あり' if res else 'まだ'} ({n + 1}回目)")
                    time.sleep(REQUEST_GAP)
                    if res:
                        r["result"] = res
                        pending.append(f"{v['name']}{r['no']}R(結果)")
                        first_pending = first_pending or now
                    continue
                remaining += 1
                # --- 締切の数分前のオッズ (1レース1回。取れなければ1分後にもう一度) ---
                okey = ("odds",) + key
                if not r.get("odds") and timedelta(minutes=ODDS_MIN_LEFT) <= dl - now <= timedelta(minutes=ODDS_MAX_LEFT):
                    n, last = tries.get(okey, [0, None])
                    if n < 3 and not (last and (now - last).total_seconds() < 60):
                        try:
                            rows = fetch_race_odds(race_day, v["code"], r["no"], timeout=20)
                        except Exception as e:
                            rows = []
                            log(f"オッズ取得失敗 {v['name']}{r['no']}R: {e}")
                        tries[okey] = [n + 1, now]
                        time.sleep(REQUEST_GAP)
                        odds = [x["win_odds"] for x in sorted(rows, key=lambda x: x["lane"])]
                        if len(odds) == 6 and any(o for o in odds):
                            r["odds"], r["odds_time"] = odds, now.strftime("%H:%M")
                            pending.append(f"{v['name']}{r['no']}R(オッズ)")
                            first_pending = first_pending or now
                            odds_due = min(odds_due or dl, dl)
                        log(f"{now:%H:%M:%S} {v['name']}{r['no']}R オッズ{'あり' if r.get('odds') else 'まだ'}")
                # --- 締切の数分前の3連単オッズ (1レース1回) ---
                tkey = ("tri",) + key
                if not r.get("tri_odds") and timedelta(minutes=ODDS_MIN_LEFT) <= dl - now <= timedelta(minutes=ODDS_MAX_LEFT):
                    n, last = tries.get(tkey, [0, None])
                    if n < 3 and not (last and (now - last).total_seconds() < 60):
                        try:
                            tri = fetch_trifecta_odds(race_day, v["code"], r["no"], timeout=20)
                        except Exception as e:
                            tri = {}
                            log(f"3連単オッズ取得失敗 {v['name']}{r['no']}R: {e}")
                        tries[tkey] = [n + 1, now]
                        time.sleep(REQUEST_GAP)
                        if len(tri) >= 100:
                            r["tri_odds"], r["odds_time"] = tri, now.strftime("%H:%M")
                            pending.append(f"{v['name']}{r['no']}R(3連単オッズ)")
                            first_pending = first_pending or now
                            odds_due = min(odds_due or dl, dl)
                # --- 展示 ---
                if r.get("ex_times"):
                    continue
                n, last = tries.get(key, [0, None])
                if dl - now > timedelta(minutes=WINDOW_MIN) or n >= MAX_TRIES:
                    continue
                if last and (now - last).total_seconds() < RETRY_SEC:
                    continue
                try:
                    info = fetch_beforeinfo(race_day, v["code"], r["no"], timeout=20)
                except Exception as e:  # 通信エラーは次の回に
                    info = None
                    log(f"取得失敗 {v['name']}{r['no']}R: {e}")
                tries[key] = [n + 1, now]
                log(f"{now:%H:%M:%S} {v['name']}{r['no']}R 展示{'あり' if info else 'まだ'} ({n + 1}回目)")
                time.sleep(REQUEST_GAP)
                if info:
                    r.update({k: val for k, val in info.items() if val is not None})
                    if ex_predictor is not None:  # 展示を学習したAIで予想し直す
                        try:
                            r["p_ex"] = ex_predictor.predict(v["code"], r["no"], info["ex_times"], info.get("course_ex"), info.get("weather_ex"))
                        except Exception as e:
                            log(f"展示AIの計算に失敗 {v['name']}{r['no']}R: {e}")
                    pending.append(f"{v['name']}{r['no']}R")
                    first_pending = first_pending or now
        if pending or dirty:
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            due = odds_due is not None and odds_due - now <= timedelta(minutes=PUBLISH_BEFORE_MIN)
            if pending and (due or (now - first_pending).total_seconds() >= BATCH_SEC):
                build_claude_page(app_html, site_dir, out_page)
                log("反映: " + ", ".join(pending))
                if not keep_running:
                    return "updated"
                # 止まらずに取り続ける: アプリのファイルだけ作り直し、公開はボタンが押された時に行う
                pending, first_pending, odds_due = [], None, None
        if remaining == 0:
            return "finished"
        time.sleep(poll_sec)
