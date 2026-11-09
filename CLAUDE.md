# project-fx メモ

## コミュニケーション(最重要)
- **ユーザーに見える文章は、例外なく全部日本語で書くこと。**
  - 最終回答だけでなく、作業途中の一言(「〜を確認します」「公開しました」など)も日本語。
  - ツール実行の合間に出す短い報告も英語にしない。英語で書きかけたら日本語に直す。
  - ユーザーから何度も指摘されている。守れていないとユーザーが怒る。
- README やコードのコメントも日本語。コミットメッセージは英語でよい。

## プロジェクト概要
- ボートレース着順予測AI (`src/boatrace_ai/`)。詳細は README.md。
- データ: 公式 https://www1.mbrace.or.jp/od2/ の番組表(B)・競走成績(K)。無料公開データ。
  - HTTP ではなく **HTTPS** で取得する(クラウド環境のプロキシ都合)。
  - 取得時はサーバ負荷に配慮して間隔をあける(`--sleep`)。
- オッズ: 公式 https://www.boatrace.jp/ の過去オッズページ(`odds.py`)。
  - サイトポリシーで「大量のアクセス」が禁止されている。**1本ずつ・2秒以上の間隔**で、必要な分だけ取る。
  - 取得したオッズは私的な分析にだけ使う。アプリや GitHub に載せない(再配布しない)。
- 見張り(`watch-exhibit`): 締切22分前〜で展示、締切6〜2分前で単勝オッズを1レース1回取得し、アプリを作り直す。
  - アプリの「期待値+」= 展示込みAI確率とオッズの混合確率 × オッズ ≥ 1.0 (オッズ50倍以下)。重みは2023年3〜5月の検証で決定。
- 展示AI(`models/ex_v2.pkl`, `predict.ExPredictor`): 展示タイム・進入コースも学習したAI。展示が取れたら見張りが `p_ex` を書き込み、アプリはそれを優先して使う。
- AI本命(◎) = AIの1着確率がいちばん高い艇。3連単の期待値プラス = 展示込みAI確率(補正つき) × 3連単オッズ ≥ 1.0、確率3%以上、50倍以下。
- 毎日の更新手順(「更新して」と言われたら):
  1. その日の番組表 B と前日の成績 K を `data/live` に取得
  2. `build_site(models/base_v2.pkl, data/live, data/site_live, [前日, 当日])` → `boatrace-ai claude-page --site data/site_live --out data/site_live/index.html` → Artifact を公開
  3. `boatrace-ai watch-exhibit --site data/site_live --out data/site_live/index.html --ex-model models/ex_v2.pkl --program data/live/b<当日>.txt --history data/live` をバックグラウンドで動かし、止まるたびに公開して再開
- AI v2 (2026-11-09): 当たり外れ検証で見つけたクセを修正。レースの格(`race_cat`)・時間帯(`hour`)・風/波(展示AIのみ)を学習し、
  自信補正 `alpha`(確率を alpha 乗して正規化)を検証データで決定。朝のAI=`models/base_v2.pkl`、展示AI=`models/ex_v2.pkl`。
- 過去の直前情報(展示・ST・進入・風波)を `data/beforeinfo_hist.jsonl` に収集中(1本ずつ)。集まったら ST/チルト/展示進入/F を学習に足す。
- `data/` と `models/` は git 管理外。

## 開発
- テスト: `python -m pytest -q`
- 合成データで動作確認: `boatrace-ai synth` → `boatrace-ai train --data data/synth`
