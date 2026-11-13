# project-fx メモ

## コミュニケーション(最重要)
- **ユーザーに見える文章は、例外なく全部日本語で書くこと。**
  - 最終回答だけでなく、作業途中の一言(「〜を確認します」「公開しました」など)も日本語。
  - ツール実行の合間に出す短い報告も英語にしない。英語で書きかけたら日本語に直す。
  - ユーザーから何度も指摘されている。守れていないとユーザーが怒る。
- 会話が長くなったら、ユーザーに「そろそろ /compact を送ってください」と一言伝える(ボタン1回ごとの容量を軽くするため)。
- README やコードのコメントも日本語。コミットメッセージは英語でよい。

## プロジェクト概要
- ボートレース着順予測AI (`src/boatrace_ai/`)。詳細は README.md。
- データ: 公式 https://www1.mbrace.or.jp/od2/ の番組表(B)・競走成績(K)。無料公開データ。
  - HTTP ではなく **HTTPS** で取得する(クラウド環境のプロキシ都合)。
  - 取得時はサーバ負荷に配慮して間隔をあける(`--sleep`)。
- オッズ: 公式 https://www.boatrace.jp/ の過去オッズページ(`odds.py`)。
  - サイトポリシーで「大量のアクセス」が禁止されている。**1本ずつ・2秒以上の間隔**で、必要な分だけ取る。
  - 取得したオッズは私的な分析にだけ使う。アプリや GitHub に載せない(再配布しない)。
- 見張り(`watch-exhibit`): 締切22分前〜で展示、締切6〜2分前で単勝・3連単オッズ、締切7分後〜で結果ページ(`raceresult.py`)を1レース1回取得し、アプリを作り直す。結果は夜の成績ファイル(K)で上書き。
  - 公開は回数を減らすためまとめる: オッズを取ったレースは締切3.5分前までに、展示・結果だけなら最大20分ごと。サイトへのアクセスは `polite.py` で全プロセス1本ずつ。取りこぼした日は `boatrace-ai backfill --day` で後から埋める。
  - アプリの「期待値+」= 展示込みAI確率とオッズの混合確率 × オッズ ≥ 1.0 (オッズ50倍以下)。重みは2023年3〜5月の検証で決定。
- 展示AI(`models/ex_v3.pkl`, `predict.ExPredictor`): 展示タイム・進入コースも学習したAI。展示が取れたら見張りが `p_ex` を書き込み、アプリはそれを優先して使う。
- AI本命(◎) = AIの1着確率がいちばん高い艇。3連単の期待値プラス = 展示込みAI確率(補正つき) × 3連単オッズ ≥ 1.0、確率3%以上、50倍以下。
- 毎日の更新手順(毎朝8:13 JST にルーティン `trig_0156KsVj5MTh7L2GBkYAeeTT` がこのセッションで自動実行。「更新して」と言われた時も同じ):
  1. その日の番組表 B と前日の成績 K を `data/live` に取得
  2. `build_site(models/base_v3.pkl, data/live, data/site_live, [前日, 当日])` → `boatrace-ai claude-page --site data/site_live --out data/site_live/index.html` → Artifact を公開
  3. 常駐の見張りを裏で起動する(私を起こさないので容量はほぼ増えない): `nohup boatrace-ai watch-exhibit --keep-running --site data/site_live --out data/site_live/index.html --ex-model models/ex_v3.pkl --program data/live/b<当日>.txt --history data/live >> data/watch.log 2>&1 &`。PID は `data/site_live/watch.pid`。その日の全レースが終わると自分で止まる。
     アプリの「最新にする」ボタン(ルーティン `trig_013oAwzS52ZmD2Enm55NcCUS`)で `watch-exhibit --once` が呼ばれると、常駐が動いていれば取得は省略してすぐアプリを作り直す。動いていなければ締切12分以内のレース+取りこぼし(単勝最終オッズ・展示・結果)を取る。その後 Artifact を公開。常駐が止まっていてレースが残っていれば、公開後に常駐を起動し直す。
- AI v2 (2026-11-09): 当たり外れ検証で見つけたクセを修正。レースの格(`race_cat`)・時間帯(`hour`)・風/波(展示AIのみ)を学習し、
  自信補正 `alpha`(確率を alpha 乗して正規化)を検証データで決定。朝のAI=`models/base_v3.pkl`、展示AI=`models/ex_v3.pkl`。
- AI v3: v2 に「モーターの最近の調子(同じ場・同じモーターの直近60日)」と「選手×進入コースの過去成績」を追加(朝は枠番で代用、展示AIは展示進入で引く)。
- 過去の直前情報(展示・ST・進入・風波)を `data/beforeinfo_hist.jsonl` に収集中(1本ずつ)。集まったら ST/チルト/展示進入/F を学習に足す。
- `data/` と `models/` は git 管理外。

## 開発
- テスト: `python -m pytest -q`
- 合成データで動作確認: `boatrace-ai synth` → `boatrace-ai train --data data/synth`
