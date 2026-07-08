# progress.md — 進捗

作成日時: 2026-07-08 16:39
更新日時: 2026-07-08 23:14

## 現在地

**フェーズ 1（Vault）完了**。カード CRUD・メディア・検索・在庫密度が動く状態。
次はフェーズ 2（Generate の逐次パイプライン）。

## 完了済み

- 2026-07-08: 仕様書 [docs/spec.md](../spec.md) 確定（コンセプト、確定判断、データモデル、
  パイプライン設計、API 設計、スコープ境界 v1/v1.5/v2）
- 2026-07-08: エージェント向けルール `AGENTS.md` / `CLAUDE.md` 整備
- 2026-07-08: 計画ドキュメント（goals / plan / progress）作成
- 2026-07-08: 参考リポジトリ調査（`lm-graph` のフロント構成、`image-assistant` の
  メディアライブラリ構造）。要点は [plan.md](plan.md) に反映済み
- 2026-07-08: 実行環境の方針決定 — llama-server は `runtime/` に UI のインストーラで導入、
  GGUF は `models/` に配置（gemma-4-31B-it 配置済み）、バックエンド Python は venv（`.venv`）
- 2026-07-08: 追加要件 — 生成用 system prompt（writer/selector）を UI から編集可能にする
  （plan.md フェーズ 2 に反映済み）
- 2026-07-08: ライブラリ配置の方針決定 — 当面 `data/library/`（DB + メディア + サムネイル）に
  置き、のちに設定で外部フォルダを参照できるようにする（パスはライブラリルート相対で保持）
- 2026-07-08: `README.md` / `.gitignore` 作成。初回コミット（a6b2852）
- 2026-07-08: 埋め込みモデルを Ruri から **Qwen3-Embedding-4B（GGUF）** に変更決定。
  `models/Qwen3-Embedding-4B-GGUF/` に配置済み。image-assistant の `embedding_client.py`
  と同方式・同モデルのため、ほぼそのまま流用できる

- 2026-07-08: **フェーズ 0 完了** — 足場一式を実装し検証済み:
  - フロント: electron-vite + React 19 + Tailwind + CSS 変数テーマ。`electron/`（main/preload）と
    `src/`（renderer）に分離し、`src/phases/{vault,compose,generate,theater}` の 4 相構成を確立
  - Electron main: lm-graph から `llamaServer.ts` / `llamaInstaller.ts` を移植（runtime/ 専用に調整、
    embedding 用 GGUF は writer モデル一覧から除外）。`backend.ts` が venv の python で FastAPI を
    自動起動。preload は `window.storyFlow` ブリッジ
  - UI: 4 フェーズタブ + セットアップパネル（llama-server インストーラ: リリース取得 → バックエンド
    選択 → 進捗バー付きダウンロード → models/ の GGUF ロード）。未インストール時は自動で開く
  - backend: FastAPI 骨格 + `db/schema.sql`（6 テーブル、EMBED_DIM=2560 で card_vec 作成）+
    routes（cards/generate/stories。一覧・stats・stories は動作、書き込み系は 501 スタブ）+
    services（state.py は実装済み、他はシグネチャ確定済みスタブ）+ prompts 既定値
  - `start.bat`（venv / npm の初回セットアップ + 起動。py ランチャー優先）
  - 検証: `npm run build` 成功、全 .py py_compile 成功、uvicorn 起動 → /health・/vault/stats・
    /stories 疎通確認、`data/library/story-flow.sqlite3` 生成確認

- 2026-07-08: **フェーズ 1（Vault）完了**:
  - backend: `services/media.py`（sha256 先頭 16 桁命名 + Pillow サムネイル、動画は ffmpeg、
    ライブラリルート相対パス）、`services/embedding.py`（/v1/embeddings HTTP、
    サーバ未起動時は EmbeddingUnavailable で埋め込み無し保存に劣化）、
    `routes/cards.py` 本実装（CRUD / card_tags / cards_fts 同期 / card_vec upsert /
    FTS・ベクトル検索 / /cards/similar / /vault/stats / メディア配信）
  - Electron: `embeddingServer.ts`（Qwen3-Embedding GGUF を --embedding --pooling last で
    起動管理、ポート 8091〜）。backend 起動時に STORY_FLOW_EMBEDDING_URL を注入。
    アプリ起動時にベストエフォートで自動起動、SetupPanel に状態表示 + 起動/停止ボタン
  - UI: Vault 画面（カードグリッド + サムネイル、キーワード/意味検索、ロールフィルタ兼
    在庫密度チップ、埋め込み未計算の警告表示）、CardEditor（タイトル/ブリーフ/ロール/
    トーン/タグ 3 種/メディアアップロード/類似カード確認/削除）
  - 検証: npm run build / py_compile 成功。API E2E（作成→タグ→メディア→サムネイル→
    FTS 検索→stats→更新→意味検索 503 劣化→削除）全項目成功
  - 未検証: 埋め込みサーバ実起動での card_vec 書き込み（llama-server 未インストールの
    ため。UI からインストール後、カード保存時に自動計算される）

## 未完了（plan.md の作業順序に従う）

- [x] フェーズ 1: Vault（CRUD / メディア / タグ・ロール / 埋め込み / stats）
- [ ] フェーズ 2: Generate 逐次パイプライン（穴埋めなし）
- [ ] フェーズ 3: Theater
- [ ] フェーズ 4: Compose（→ v1 完成）
- [ ] フェーズ 5: v1.5（fill_gap / 多様性 / バックトラック）

## 次の一手

フェーズ 2（Generate 逐次パイプライン、穴埋めなし）:
`services/llm.py`（chat_completion_json + think ブロック除去）→ `services/writer.py`
（write_scene: prose + 更新後 state の構造化出力、prompts/writer.md 使用 + ユーザー上書き）→
`services/pipeline.py`（FIXED のみの左→右ループ、SSE generator）→ `routes/generate.py`
（POST /generate を SSE 化）→ Generate UI（アンカー選択は暫定でカード ID 列指定 or
Vault から選択、シーンが埋まる進行表示）。生成用 system prompt の編集 UI もフェーズ 2 スコープ。

- 起動は `start.bat`（初回は venv + npm install を自動セットアップ）
- 環境注意: この PC の `python` は Windows Store スタブのため `py` ランチャーを使う
- Vault の埋め込み計算を有効にするには、セットアップパネルから llama-server をインストール
  すること（embedding サーバはアプリ起動時に自動起動する）

## 注意点・申し送り

- spec.md の「### 判断」ブロックは確定事項。実装時に再検討しない。
- v1 のスコープを厳守する（GAP スロット・分岐・tone 引力は実装しない。
  ただし差し込める形の関数境界にしておく）。
- spec §14 の未決事項は実装フェーズ到達時に決めて plan.md のチェックリストを更新する。
- Windows 環境。better-sqlite3 等ネイティブモジュールは `rebuild:electron` 相当の
  再ビルド手順が必要（lm-graph と同様）。
