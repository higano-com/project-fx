# project-fx メモ

## コミュニケーション
- **ユーザーへの返答・進捗報告はすべて日本語で書くこと。** (途中経過も英語にしない)
- README やコードのコメントも日本語。コミットメッセージは英語でよい。

## プロジェクト概要
- ボートレース着順予測AI (`src/boatrace_ai/`)。詳細は README.md。
- データ: 公式 https://www1.mbrace.or.jp/od2/ の番組表(B)・競走成績(K)。無料公開データ。
  - HTTP ではなく **HTTPS** で取得する(クラウド環境のプロキシ都合)。
  - 取得時はサーバ負荷に配慮して間隔をあける(`--sleep`)。
- `data/` と `models/` は git 管理外。

## 開発
- テスト: `python -m pytest -q`
- 合成データで動作確認: `boatrace-ai synth` → `boatrace-ai train --data data/synth`
