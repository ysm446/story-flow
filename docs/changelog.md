# Changelog

## 未リリース

### 2026-07-08 23:51 — フェーズ 2: Generate（逐次生成）

- アンカー列を左から 1 シーンずつ清書し、確定事実（StoryState）を持ち越す生成パイプライン
- 生成は SSE でシーン毎に届き、画面にシーンが順に埋まっていく進行表示
- プロット・目標トーン（結末の着地）の指定
- 生成前に writer モデル（llama-server）を自動起動
- 清書用 system prompt の編集機能（上書き保存 / 既定に戻す。出力形式指示は自動付与）
- 物語は stories / story_scenes に保存（Theater で再生予定）

### 2026-07-08 23:14 — フェーズ 1: Vault（素材管理）

- シーンカードの登録・編集・削除（タイトル / ブリーフ / ロール / トーン / タグ 3 種）
- 画像・動画のアップロード（sha256 命名で `data/library/` に保存、サムネイル自動生成）
- キーワード検索（FTS5）と意味検索（ベクトル）、ロール絞り込み
- 在庫密度チップ（ロール別枚数）と埋め込み済み枚数の表示
- 類似カード確認（重複検知）
- 埋め込みサーバ（Qwen3-Embedding-4B）の自動起動とセットアップパネルでの起動/停止

### 2026-07-08 22:59 — フェーズ 0: アプリの足場

- Electron + React + TypeScript（electron-vite）+ FastAPI（venv）の骨格を実装
- 4 フェーズ（Vault / Compose / Generate / Theater）のタブ UI
- llama-server のアプリ内インストーラ（GitHub リリースから runtime/ へダウンロード・展開、
  進捗表示、キャンセル対応）と models/ 配下 GGUF のロード/停止 UI
- SQLite スキーマ（sqlite-vec / FTS5 含む）と Vault 在庫密度 API の初期実装
- `start.bat`（初回セットアップ + 起動）
