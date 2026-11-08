"""スマホアプリ(静的サイト)の組み立て.

out_dir/
  index.html, sw.js, manifest.webmanifest, icons/   ← app/ からコピー
  days.json                                         ← 表示できる日付の一覧
  data/YYYY-MM-DD.json                              ← その日の予想 + 確定した結果

一度作った日の予想は上書きしない(後から学習し直したモデルで答え合わせが甘くならないように)。
結果(競走成績)は公開され次第、既存の予想ファイルに追記する。
"""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import pandas as pd

from .model import BoatRaceModel
from .parse import load_dir, parse_results, read_text
from .predict import predict_program, to_app_json

APP_DIR = Path(__file__).resolve().parents[2] / "app"  # 開発環境 (pip install -e) 用


def find_app_dir(app_dir: Path | None = None) -> Path:
    """画面ファイル(index.html など)のあるフォルダを探す. 見つからなければエラー."""
    for cand in ([Path(app_dir)] if app_dir else []) + [Path.cwd() / "app", APP_DIR]:
        if (cand / "index.html").exists():
            return cand
    raise FileNotFoundError("app/index.html が見つかりません (--app で場所を指定してください)")
STATIC_FILES = ["index.html", "sw.js", "manifest.webmanifest", "icons"]


def _results_by_race(k_path: Path, d: date) -> dict[tuple[int, int], dict]:
    res, pay = parse_results(read_text(k_path), d)
    out: dict[tuple[int, int], dict] = {}
    if res.empty:
        return out
    for (venue, race_no), g in res.groupby(["venue", "race_no"]):
        fin = g.dropna(subset=["finish"]).sort_values("finish")
        out[(int(venue), int(race_no))] = dict(order=[int(x) for x in fin["lane"]])
    if not pay.empty:
        for _, r in pay.iterrows():
            o = out.setdefault((int(r.venue), int(r.race_no)), dict(order=[]))
            for k in ("trifecta", "trifecta_pay", "win_lane", "win_pay"):
                v = r.get(k)
                if v is not None and not pd.isna(v):
                    o[k] = v if k == "trifecta" else int(v)
    return out


def attach_results(day: dict, data_dir: Path, d: date) -> bool:
    k_path = Path(data_dir) / f"k{d:%y%m%d}.txt"
    if not k_path.exists():
        return False
    results = _results_by_race(k_path, d)
    for v in day["venues"]:
        for r in v["races"]:
            res = results.get((v["code"], r["no"]))
            if res and res.get("trifecta"):
                r["result"] = res
            elif res and "result" not in r:
                r["result"] = dict(res, void=True)  # 中止・不成立など
    day["has_results"] = True
    return True


def build_site(model_path: Path, data_dir: Path, out_dir: Path, dates: list[date], keep_days: int = 30,
               app_dir: Path | None = None) -> list[str]:
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    (out_dir / "data").mkdir(parents=True, exist_ok=True)
    model = BoatRaceModel.load(Path(model_path))
    history = None
    log = []

    for d in sorted(dates):
        path = out_dir / "data" / f"{d:%Y-%m-%d}.json"
        if path.exists():
            day = json.loads(path.read_text(encoding="utf-8"))
        else:
            b_path = data_dir / f"b{d:%y%m%d}.txt"
            if not b_path.exists():
                continue
            if history is None:
                history = load_dir(data_dir)[1]
            df, preds = predict_program(model, b_path, history=history)
            day = to_app_json(df, preds, model)
            log.append(f"{d} 予想 {len(preds)}R")
        if not day.get("has_results") and attach_results(day, data_dir, d):
            log.append(f"{d} 結果反映")
        path.write_text(json.dumps(day, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 古い日を消して一覧を作る
    files = sorted((out_dir / "data").glob("*.json"))
    for f in files[:-keep_days]:
        f.unlink()
    days = []
    for f in sorted((out_dir / "data").glob("*.json"), reverse=True):
        day = json.loads(f.read_text(encoding="utf-8"))
        days.append(dict(
            date=day["date"], venues=len(day["venues"]),
            races=sum(len(v["races"]) for v in day["venues"]),
            has_results=bool(day.get("has_results")),
        ))
    (out_dir / "days.json").write_text(json.dumps(dict(days=days, model=getattr(model, "meta", {})),
                                                  ensure_ascii=False), encoding="utf-8")

    app = find_app_dir(app_dir)
    for name in STATIC_FILES:
        src = app / name
        if src.is_dir():
            shutil.copytree(src, out_dir / name, dirs_exist_ok=True)
        elif src.exists():
            shutil.copy2(src, out_dir / name)
    return log
