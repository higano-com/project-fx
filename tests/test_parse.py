from datetime import date

from boatrace_ai.parse import parse_program, parse_results

B_TEXT = "\n".join([
    "STARTB",
    "12BBGN",
    "ボートレース住之江　　＊＊＊　番組表　＊＊＊",
    "   第　３日          ２０２４年　４月　１日",
    "   １Ｒ  予選　　　　        Ｈ１８００ｍ  電話投票締切予定１５：１７",
    "-" * 79,
    "艇 選手 選手  年 支 体級    全国      当地     モーター   ボート   今節成績  早",
    "番 登番  名   齢 部 重別 勝率  2率  勝率  2率  NO  2率  NO  2率  １２３４５６見",
    "-" * 79,
    "1 4444山田太郎34東京52A1 6.50 45.00 6.80 50.00 12 35.00 34 32.00 1 2        ",
    "2 3210佐藤　花45大阪47B1 4.20 25.10 3.90 20.00  5 41.20  8 29.50",
    # 実データで見つかった、数字が隙間なく並ぶケース
    "3 3876中辻崇人47福岡52A1 7.98 72.00 9.30100.00 70 36.07111 27.94             12",
    "12BEND",
])

K_TEXT = "\n".join([
    "STARTK",
    "12KBGN",
    "   1R       予選                 H1800m  晴　  風  北西　 3m  波　  3cm",
    "  着 艇 登番 　選　手　名　　ﾓｰﾀｰ ﾎﾞｰﾄ 展示 進入 ｽﾀｰﾄﾀｲﾐﾝｸ ﾚｰｽﾀｲﾑ 差し",
    "-" * 79,
    "  01  1 4444 山　田　太　郎 12   34  6.78   1    0.15     1.50.3",
    "  02  2 3210 佐　藤　　　花  5    8  6.81   2    0.18     1.51.2",
    "  F   3 4000 鈴　木　一　郎 20   11  6.70   3    F.01     .  .",
    "",
    "        単勝     1          150",
    "        複勝     1          100  2          130  ",
    "        ２連単   1-2        460  人気     2 ",
    "        ２連複   1-2        300  人気     1 ",
    "        拡連複   1-2        150  人気     1 ",
    "                 1-4        310  人気     5 ",
    "        ３連単   1-2-4     1230  人気     3",
    "        ３連複   1-2-4      450  人気     2 ",
    "12KEND",
])


def test_parse_program():
    df = parse_program(B_TEXT, date(2024, 4, 1))
    assert len(df) == 3
    r = df.iloc[0]
    assert (r.venue, r.race_no, r.lane, r.reg_no) == (12, 1, 1, 4444)
    assert r["name"] == "山田太郎" and r.grade == "A1" and r.class_num == 4
    assert (r.nat_win, r.motor_no, r.motor_2, r.boat_2) == (6.50, 12, 35.00, 32.00)
    assert r.distance == 1800
    assert r.day_no == 3
    assert df.iloc[1].motor_no == 5 and df.iloc[1]["name"] == "佐藤花"
    r3 = df.iloc[2]
    assert (r3.loc_win, r3.loc_2, r3.motor_no, r3.boat_no, r3.boat_2) == (9.30, 100.0, 70, 111, 27.94)


def test_parse_results():
    res, pay = parse_results(K_TEXT, date(2024, 4, 1))
    assert list(res["lane"]) == [1, 2, 3]
    assert res.iloc[0].finish == 1 and res.iloc[0].st == 0.15 and res.iloc[0].course == 1
    assert res.iloc[1].exhibit == 6.81
    assert res.iloc[2].finish_raw == "F" and res.iloc[2].finish != res.iloc[2].finish  # NaN
    p = pay.iloc[0]
    assert (p.trifecta, p.trifecta_pay, p.win_lane, p.win_pay) == ("1-2-4", 1230, 1, 150)
    assert (p.trifecta_pop, p.trio, p.trio_pay, p.exacta, p.exacta_pop) == (3, "1-2-4", 450, "1-2", 2)
    assert (p.place1_lane, p.place1_pay, p.place2_lane, p.place2_pay, p.quinella_pay) == (1, 100, 2, 130, 300)
    assert (p.race_type, p.weather, p.wind_dir, p.wind, p.wave) == ("予選", "晴", "北西", 3, 3)


def test_parse_beforeinfo():
    from boatrace_ai.beforeinfo import parse_beforeinfo

    rows = "".join(
        f'<td class="is-boatColor{l} is-fs14" rowspan="4">{l}</td><td>x</td><td rowspan="2">52.0kg</td>\n'
        f'  <td rowspan="4">6.{60 + l}</td>\n  <td rowspan="4">-0.5</td>'
        for l in range(1, 7)
    )
    st = "".join(
        f'<span class="table1_boatImage1Number is-type{l}">{l}</span><span>..</span>'
        f'<span class="table1_boatImage1Time">.1{l}</span>'
        for l in (2, 1, 3, 4, 5, 6)
    )
    info = parse_beforeinfo(rows + st)
    assert info["ex_times"] == [6.61, 6.62, 6.63, 6.64, 6.65, 6.66]
    assert info["tilts"] == [-0.5] * 6
    assert info["st_ex"][:2] == [".11", ".12"] and info["course_ex"][:2] == [2, 1]
    assert parse_beforeinfo("<html>まだ</html>") is None


def test_parse_trifecta_odds():
    from boatrace_ai.odds import parse_trifecta_odds

    # 行ごとに6列(1着=1..6)。値には行番号*10+列番号を入れて、位置の対応を確かめる
    cells = "".join(f'<td class="oddsPoint ">{row * 10 + col + 1}.0</td>' for row in range(20) for col in range(6))
    o = parse_trifecta_odds(cells)
    assert len(o) == 120
    assert o["1-2-3"] == 1.0 and o["2-1-3"] == 2.0      # 0行目: 1着の列ごと
    assert o["1-2-4"] == 11.0                           # 1行目: 2着2・3着4
    assert o["1-3-2"] == 41.0                           # 4行目: 2着3・3着2
    assert parse_trifecta_odds('<td class="oddsPoint">1.0</td>') == {}


def test_parse_beforeinfo_flying_start():
    """スタート展示でフライングした艇がいても、ST と進入が読めること."""
    from boatrace_ai.beforeinfo import parse_beforeinfo

    rows = "".join(
        f'<td class="is-boatColor{l} is-fs14" rowspan="4">{l}</td><td>x</td><td rowspan="2">52.0kg</td>\n'
        f'  <td rowspan="4">6.{60 + l}</td>\n  <td rowspan="4">0.0</td>'
        for l in range(1, 7)
    )
    st = "".join(
        f'<span class="table1_boatImage1Number is-type{l}">{l}</span><span>..</span>'
        + (f'<span class="table1_boatImage1Time is-fBold is-fColor1">F.06</span>' if l == 1
           else f'<span class="table1_boatImage1Time">.1{l}</span>')
        for l in range(1, 7)
    )
    info = parse_beforeinfo(rows + st)
    assert info["st_ex"][0] == "F.06" and info["course_ex"] == [1, 2, 3, 4, 5, 6]
