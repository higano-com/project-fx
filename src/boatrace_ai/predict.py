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


def predict_program(model: BoatRaceModel, program_path: Path, history_dir: Path | None):
    program_path = Path(program_path)
    programs = parse_program(read_text(program_path), date_from_filename(program_path))
    history = load_dir(Path(history_dir))[1] if history_dir else None
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
