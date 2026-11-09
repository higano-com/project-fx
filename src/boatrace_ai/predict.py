"""番組表ファイルから予測し、表示用/アプリ用の形にまとめる."""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

from .features import RACE_KEY, build_features
from .model import BoatRaceModel, race_predictions
from .parse import date_from_filename, load_dir, parse_program, read_text
from .venues import venue_name


def predict_program(model: BoatRaceModel, program_path: Path, history_dir: Path | None = None,
                    history=None):
    """番組表ファイルを予測する. history(成績DataFrame)を渡せば history_dir は読まない."""
    program_path = Path(program_path)
    programs = parse_program(read_text(program_path), date_from_filename(program_path))
    if history is None and history_dir:
        history = load_dir(Path(history_dir))[1]
    df = build_features(programs, history)
    p_win = model.predict_win(df)
    return df.assign(p_win=p_win), race_predictions(df, p_win)


def to_app_json(df, preds, model: BoatRaceModel, top: int = 10) -> dict:
    venues: dict[int, dict] = {}
    for key, g in df.groupby(RACE_KEY, sort=True):
        d, venue, race_no = key
        first = g.iloc[0]
        v = venues.setdefault(int(venue), dict(code=int(venue), name=venue_name(venue), races=[]))
        tri = preds[key]["trifecta"].head(top)
        v["races"].append(dict(
            no=int(race_no),
            name=first.get("race_name"),
            deadline=first.get("deadline"),
            distance=None if first.get("distance") is None else int(first["distance"]),
            boats=[
                dict(
                    lane=int(r.lane), name=r["name"], reg_no=int(r.reg_no), grade=r.grade,
                    age=int(r.age), branch=r.branch, nat_win=float(r.nat_win),
                    loc_win=float(r.loc_win), motor_2=float(r.motor_2),
                    p_win=round(float(r.p_win), 4),
                )
                for _, r in g.sort_values("lane").iterrows()
            ],
            trifecta=[dict(combo=c, prob=round(float(p), 4)) for c, p in tri.itertuples(index=False)],
        ))
    race_date = df["date"].iloc[0]
    return dict(
        date=f"{race_date:%Y-%m-%d}",
        generated_at=datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(timespec="minutes"),
        model=getattr(model, "meta", {}),
        venues=sorted(venues.values(), key=lambda v: v["races"][0]["deadline"] or ""),
    )


def write_app_json(data: dict, path: Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


EX_FEATURES_EXTRA = ["exhibit", "ex_diff", "ex_rank", "ex_gap_top", "course_ex", "course_shift"]


def add_exhibit_features(g):
    """1レース分(6艇)の表に、展示タイムと進入コースから作る特徴量を足す."""
    g = g.copy()
    g["ex_diff"] = g["exhibit"] - g["exhibit"].mean()
    g["ex_rank"] = g["exhibit"].rank(method="min")
    g["ex_gap_top"] = g["exhibit"] - g["exhibit"].min()
    g["course_ex"] = g["course_ex"].fillna(g["lane"])
    g["course_shift"] = g["course_ex"] - g["lane"]
    return g


class ExPredictor:
    """展示が出たレースを、展示を学習したAIで予想し直す (その日の特徴量は最初に1回だけ作る)."""

    def __init__(self, model_path: Path, program_path: Path, history_dir: Path):
        self.model = BoatRaceModel.load(Path(model_path))
        program_path = Path(program_path)
        programs = parse_program(read_text(program_path), date_from_filename(program_path))
        self.feat = build_features(programs, load_dir(Path(history_dir))[1])

    def predict(self, venue: int, race_no: int, ex_times: list, course_ex: list | None = None,
                weather: dict | None = None) -> list | None:
        g = self.feat[(self.feat["venue"] == venue) & (self.feat["race_no"] == race_no)].sort_values("lane")
        if len(g) != 6 or not ex_times or len(ex_times) != 6:
            return None
        g = g.assign(exhibit=ex_times, course_ex=course_ex if course_ex and len(course_ex) == 6 else g["lane"].tolist())
        g = add_exhibit_features(g)
        weather = weather or {}
        g["wind_f"] = float(weather["wind"]) if weather.get("wind") is not None else float("nan")
        g["wave_f"] = float(weather["wave"]) if weather.get("wave") is not None else float("nan")
        return [round(float(x), 4) for x in self.model.predict_win(g)]
