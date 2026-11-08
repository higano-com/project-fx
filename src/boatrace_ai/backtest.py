"""バックテスト: テスト期間で予測し、的中率・回収率を出す.

注意: 過去データに残るのは「確定した的中組の払戻」だけで、締切時オッズは無い。
そのため期待値(確率×オッズ)での購入判断はできず、ここでは
「確率上位N点を均等買い」「確率がしきい値以上のレースだけ買う」戦略を評価する。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .features import RACE_KEY
from .model import BoatRaceModel, log_loss_win, race_predictions

BET = 100  # 1点 100円


@dataclass
class Report:
    n_races: int
    top1_acc: float
    lane1_acc: float
    logloss: float
    lane_baseline_logloss: float
    win_roi: float
    trifecta: pd.DataFrame

    def __str__(self) -> str:
        lines = [
            f"テストレース数        : {self.n_races}",
            f"1着的中率 (AI本命)    : {self.top1_acc:.1%}",
            f"1着的中率 (1号艇固定) : {self.lane1_acc:.1%}",
            f"logloss  AI / 枠のみ  : {self.logloss:.4f} / {self.lane_baseline_logloss:.4f}",
            f"単勝回収率 (AI本命)   : {self.win_roi:.1%}",
            "",
            "3連単 戦略別成績:",
            self.trifecta.to_string(index=False),
        ]
        return "\n".join(lines)


def run_backtest(
    model: BoatRaceModel,
    test: pd.DataFrame,
    payouts: pd.DataFrame,
    train: pd.DataFrame,
    top_ns: tuple[int, ...] = (1, 3, 5, 10, 20),
    thresholds: tuple[float, ...] = (0.0, 0.05, 0.10, 0.15),
) -> Report:
    p_win = model.predict_win(test)
    preds = race_predictions(test, p_win)
    pay = payouts.set_index(RACE_KEY) if not payouts.empty else pd.DataFrame()

    # 1着精度
    t = test.assign(p_win=p_win)
    top = t.loc[t.groupby(RACE_KEY)["p_win"].idxmax()]
    top1_acc = float(top["win"].mean())
    lane1_acc = float(t[t["lane"] == 1]["win"].mean())

    # 枠番だけのベースライン(学習期間の枠別1着率)
    lane_rate = train.groupby("lane")["win"].mean()
    base = t["lane"].map(lane_rate)
    base = base / base.groupby([t[k] for k in RACE_KEY]).transform("sum")

    # 単勝: AI本命を毎レース100円
    win_cost = win_ret = 0
    for _, r in top.iterrows():
        key = tuple(r[k] for k in RACE_KEY)
        if key not in pay.index or pd.isna(pay.loc[key].get("win_pay", np.nan)):
            continue
        win_cost += BET
        if int(pay.loc[key, "win_lane"]) == int(r["lane"]):
            win_ret += int(pay.loc[key, "win_pay"])

    # 3連単
    rows = []
    for th in thresholds:
        for n in top_ns:
            races = hits = cost = ret = 0
            for key, pr in preds.items():
                if key not in pay.index or pd.isna(pay.loc[key].get("trifecta_pay", np.nan)):
                    continue
                tri = pr["trifecta"]
                if tri["prob"].iloc[0] < th:
                    continue
                picks = set(tri["combo"].iloc[:n])
                races += 1
                cost += BET * len(picks)
                if pay.loc[key, "trifecta"] in picks:
                    hits += 1
                    ret += int(pay.loc[key, "trifecta_pay"])
            rows.append(dict(
                本命確率下限=th, 点数=n, 購入R=races,
                的中率=f"{hits / races:.1%}" if races else "-",
                回収率=f"{ret / cost:.1%}" if cost else "-",
                収支=ret - cost,
            ))

    return Report(
        n_races=len(preds), top1_acc=top1_acc, lane1_acc=lane1_acc,
        logloss=log_loss_win(test, p_win), lane_baseline_logloss=log_loss_win(test, base),
        win_roi=win_ret / win_cost if win_cost else float("nan"),
        trifecta=pd.DataFrame(rows),
    )
