"""学習・予測.

LightGBM で各艇の「1着確率」を推定し、レース内で正規化。
3連単の確率は Harville モデルで計算する:
    P(i,j,k) = p_i * p_j/(1-p_i) * p_k/(1-p_i-p_j)
"""

from __future__ import annotations

import inspect
import pickle
from itertools import permutations
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from .features import CATEGORICAL, FEATURES, RACE_KEY

DEFAULT_PARAMS = dict(
    n_estimators=600, learning_rate=0.03, num_leaves=31, min_child_samples=40,
    subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
    verbose=-1,
)


class BoatRaceModel:
    def __init__(self, params: dict | None = None):
        self.params = {**DEFAULT_PARAMS, **(params or {})}
        self.model: lgb.LGBMClassifier | None = None
        self.features = list(FEATURES)

    def fit(self, train: pd.DataFrame, valid: pd.DataFrame | None = None) -> "BoatRaceModel":
        self.model = lgb.LGBMClassifier(**self.params)
        kw = {}
        if valid is not None and len(valid):
            if "eval_X" in inspect.signature(lgb.LGBMClassifier.fit).parameters:
                kw["eval_X"], kw["eval_y"] = valid[self.features], valid["win"]
            else:  # LightGBM < 4.7
                kw["eval_set"] = [(valid[self.features], valid["win"])]
            kw["callbacks"] = [lgb.early_stopping(50, verbose=False)]
        self.model.fit(train[self.features], train["win"], categorical_feature=CATEGORICAL, **kw)
        return self

    def predict_win(self, df: pd.DataFrame) -> pd.Series:
        """レース内で合計1になるよう正規化した1着確率."""
        raw = pd.Series(self.model.predict_proba(df[self.features])[:, 1], index=df.index)
        # 自信の補正: 検証で決めた alpha 乗でレース内の確率の強弱を調整 (1.0 = 補正なし)
        raw = raw ** getattr(self, "alpha", 1.0)
        return raw / raw.groupby([df[k] for k in RACE_KEY]).transform("sum")

    def feature_importance(self) -> pd.Series:
        return pd.Series(
            self.model.booster_.feature_importance("gain"), index=self.features
        ).sort_values(ascending=False)

    def save(self, path: Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(path: Path) -> "BoatRaceModel":
        with open(path, "rb") as f:
            return pickle.load(f)


def harville_trifecta(win_probs: dict[int, float]) -> pd.DataFrame:
    """{lane: p_win} -> 3連単120通りの確率(降順)."""
    rows = []
    for i, j, k in permutations(win_probs, 3):
        pi, pj, pk = win_probs[i], win_probs[j], win_probs[k]
        denom1, denom2 = 1 - pi, 1 - pi - pj
        if denom1 <= 0 or denom2 <= 0:
            continue
        rows.append((f"{i}-{j}-{k}", pi * pj / denom1 * pk / denom2))
    out = pd.DataFrame(rows, columns=["combo", "prob"])
    return out.sort_values("prob", ascending=False, ignore_index=True)


def race_predictions(df: pd.DataFrame, p_win: pd.Series) -> dict[tuple, dict]:
    """レースごとの {win_probs, trifecta} を返す."""
    df = df.assign(p_win=p_win)
    out = {}
    for key, g in df.groupby(RACE_KEY):
        probs = dict(zip(g["lane"].astype(int), g["p_win"].astype(float)))
        out[key] = dict(win_probs=probs, trifecta=harville_trifecta(probs))
    return out


def log_loss_win(df: pd.DataFrame, p_win: pd.Series) -> float:
    """1着艇に付けた確率の負の対数尤度(レース平均)."""
    p = np.clip(p_win[df["win"] == 1].to_numpy(), 1e-9, 1)
    return float(-np.log(p).mean())
