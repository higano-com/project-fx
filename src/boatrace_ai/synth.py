"""合成データ生成器.

本物の番組表(B)・競走成績(K)と同じ書式のテキストを生成する。
ネットワークが使えない環境での動作確認・テスト用。
選手の実力・モーター性能・枠の有利不利から Plackett-Luce モデルで着順を決める。
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np

from .parse import ENCODING

LANE_ADV = np.array([1.7, 0.55, 0.4, 0.2, 0.0, -0.35])  # 1号艇が強いのは実際と同じ傾向
KANJI = list("山田中村佐藤鈴木高橋伊渡辺小林加吉松井上森池石川前原西岡本")
BRANCHES = ["東京", "群馬", "埼玉", "静岡", "愛知", "三重", "福井", "滋賀",
            "大阪", "兵庫", "徳島", "香川", "岡山", "広島", "山口", "福岡", "佐賀", "長崎"]
GRADES = ["B2", "B1", "A2", "A1"]
FW_DIGITS = str.maketrans("0123456789", "０１２３４５６７８９")


class Racer:
    def __init__(self, rng: np.random.Generator, reg_no: int):
        self.reg_no = reg_no
        self.skill = rng.normal()
        self.name = "".join(rng.choice(KANJI, 4))
        self.branch = str(rng.choice(BRANCHES))
        self.age = int(rng.integers(20, 55))
        self.weight = int(rng.integers(47, 60))
        q = np.clip(self.skill + rng.normal(0, 0.3), -3, 3)
        self.grade = GRADES[int(np.digitize(q, [-0.6, 0.3, 1.1]))]
        self.st_mean = float(np.clip(0.17 - 0.015 * self.skill + rng.normal(0, 0.01), 0.08, 0.25))


def _rates(rng, skill, base_win=5.3):
    win = float(np.clip(base_win + 1.3 * skill + rng.normal(0, 0.4), 1.0, 9.5))
    two = float(np.clip(10 * win - 20 + rng.normal(0, 4), 0.0, 90.0))
    return win, two


def _pl_prob(strength: np.ndarray, order: list[int]) -> float:
    """Plackett-Luce での order(先頭3つ) の確率."""
    w = np.exp(strength)
    remaining = w.sum()
    p = 1.0
    for idx in order:
        p *= w[idx] / remaining
        remaining -= w[idx]
    return p


def generate(out_dir: Path, start: date, days: int, seed: int = 0, venues_per_day: int = 4) -> None:
    rng = np.random.default_rng(seed)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    racers = [Racer(rng, 3000 + i) for i in range(600)]
    motors = {v: rng.normal(0, 0.45, 60) for v in range(1, 25)}
    boats = {v: rng.normal(0, 0.15, 60) for v in range(1, 25)}

    for di in range(days):
        d = start + timedelta(days=di)
        b_lines, k_lines = ["STARTB"], ["STARTK"]
        for v in sorted(rng.choice(np.arange(1, 25), venues_per_day, replace=False)):
            v = int(v)
            b_lines += [f"{v:02d}BBGN", f"ボートレース場{v:02d}　　＊＊＊　番組表　＊＊＊", ""]
            k_lines += [f"{v:02d}KBGN", f"ボートレース場{v:02d}　　＊＊＊　競走成績　＊＊＊", ""]
            for r in range(1, 13):
                entrants = rng.choice(len(racers), 6, replace=False)
                motor_ids = rng.choice(60, 6, replace=False)
                boat_ids = rng.choice(60, 6, replace=False)
                strength = np.zeros(6)
                b_lines += [
                    f"  {str(r).translate(FW_DIGITS):>3}Ｒ  予選　　　　        Ｈ１８００ｍ  電話投票締切予定１５：１７",
                    "-" * 79,
                    "艇 選手 選手  年 支 体級    全国      当地     モーター   ボート   今節成績  早",
                    "番 登番  名   齢 部 重別 勝率  2率  勝率  2率  NO  2率  NO  2率  １２３４５６見",
                    "-" * 79,
                ]
                for lane in range(6):
                    rc = racers[entrants[lane]]
                    m, b = motors[v][motor_ids[lane]], boats[v][boat_ids[lane]]
                    strength[lane] = LANE_ADV[lane] + 0.85 * rc.skill + 0.6 * m + b + rng.normal(0, 0.15)
                    nat_w, nat_2 = _rates(rng, rc.skill)
                    loc_w, loc_2 = _rates(rng, rc.skill + rng.normal(0, 0.3))
                    m2 = float(np.clip(33 + 15 * m + rng.normal(0, 3), 10, 70))
                    b2 = float(np.clip(33 + 15 * b + rng.normal(0, 3), 10, 70))
                    b_lines.append(
                        f"{lane + 1} {rc.reg_no}{rc.name}{rc.age:02d}{rc.branch}{rc.weight:02d}{rc.grade}"
                        f" {nat_w:4.2f} {nat_2:5.2f} {loc_w:4.2f} {loc_2:5.2f}"
                        f" {motor_ids[lane] + 1:2d} {m2:5.2f} {boat_ids[lane] + 1:2d} {b2:5.2f}"
                    )
                b_lines.append("")

                order = list(np.argsort(-(strength + rng.gumbel(size=6))))
                k_lines += [
                    f"   {r}R       予選                 H1800m  晴　  風  北西　 3m  波　  3cm",
                    "  着 艇 登番 　選　手　名　　ﾓｰﾀｰ ﾎﾞｰﾄ 展示 進入 ｽﾀｰﾄﾀｲﾐﾝｸ ﾚｰｽﾀｲﾑ 差し",
                    "-" * 79,
                ]
                for pos, lane in enumerate(order, 1):
                    rc = racers[entrants[lane]]
                    st = float(np.clip(rng.normal(rc.st_mean, 0.04), 0.01, 0.40))
                    ex = 6.75 - 0.05 * strength[lane] + rng.normal(0, 0.04)
                    spaced = "　".join(rc.name).ljust(8, "　")
                    k_lines.append(
                        f"  {pos:02d}  {lane + 1} {rc.reg_no} {spaced} {motor_ids[lane] + 1:2d}"
                        f"   {boat_ids[lane] + 1:2d}  {ex:4.2f}   {lane + 1}    {st:4.2f}"
                        f"     1.{48 + pos}.{rng.integers(0, 10)}"
                    )
                p_tri = _pl_prob(strength, order[:3])
                p_win = _pl_prob(strength, order[:1])
                tri_pay = max(100, int(round(75 / p_tri * rng.lognormal(0, 0.35), -1)))
                win_pay = max(100, int(round(75 / p_win * rng.lognormal(0, 0.2), -1)))
                combo = "-".join(str(x + 1) for x in order[:3])
                k_lines += [
                    "",
                    f"        単勝     {order[0] + 1}        {win_pay:>6}",
                    f"        ３連単   {combo}    {tri_pay:>7}  人気     1",
                    "",
                ]
            b_lines.append(f"{v:02d}BEND")
            k_lines.append(f"{v:02d}KEND")
        b_lines.append("FINALB")
        k_lines.append("FINALK")
        (out_dir / f"b{d:%y%m%d}.txt").write_bytes("\r\n".join(b_lines).encode(ENCODING))
        (out_dir / f"k{d:%y%m%d}.txt").write_bytes("\r\n".join(k_lines).encode(ENCODING))
