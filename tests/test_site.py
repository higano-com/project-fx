import json
from datetime import date

from boatrace_ai.features import build_training_table
from boatrace_ai.model import BoatRaceModel
from boatrace_ai.parse import load_dir
from boatrace_ai.site import build_site
from boatrace_ai.synth import generate


def test_build_site(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "site"
    generate(raw, date(2024, 1, 1), days=12, seed=2, venues_per_day=2)
    programs, results, _ = load_dir(raw)
    model = BoatRaceModel(dict(n_estimators=30)).fit(build_training_table(programs, results))
    model.save(tmp_path / "m.pkl")

    log = build_site(tmp_path / "m.pkl", raw, out, [date(2024, 1, 11), date(2024, 1, 12), date(2024, 1, 13)])
    assert "2024-01-12 結果反映" in log
    days = json.loads((out / "days.json").read_text(encoding="utf-8"))["days"]
    assert [d["date"] for d in days] == ["2024-01-12", "2024-01-11"]  # 番組表の無い日は作らない
    day = json.loads((out / "data" / "2024-01-12.json").read_text(encoding="utf-8"))
    race = day["venues"][0]["races"][0]
    assert len(race["boats"]) == 6 and len(race["trifecta"]) == 10
    assert race["result"]["trifecta"].count("-") == 2 and race["result"]["trifecta_pay"] >= 100
    assert (out / "index.html").exists() and (out / "manifest.webmanifest").exists()

    # 2回目は予想を作り直さない
    assert build_site(tmp_path / "m.pkl", raw, out, [date(2024, 1, 12)]) == []
