# progress.md — 進捗

作成日時: 2026-07-08 16:39
更新日時: 2026-07-08 23:51

## 現在地

**フェーズ 2（Generate 逐次パイプライン）完了**。アンカー列 → 逐次清書 → 保存が
実 LLM（gemma-4-31B）で動くことを確認済み。次はフェーズ 3（Theater）。

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

- 2026-07-08: 埋め込み経路を実サーバで検証 — **EMBED_DIM 実測 2560（スキーマと一致）**。
  カード保存で card_vec 書き込み、意味検索・類似検索の妥当な順位付けを確認
- 2026-07-08: **フェーズ 2（Generate）完了**:
  - backend: `services/llm.py`（chat_completion_json: response_format=json_object +
    <think> 除去 + パース失敗リトライ）、`services/prompts.py`（既定 backend/prompts/*.md、
    上書き data/prompts/*.md、出力形式指示は writer.py 側で必ず付与）、
    `services/writer.py`（write_scene: prose + 更新後 state を単一の構造化出力で取得）、
    `services/pipeline.py`（FIXED のみの左→右ループ、SSE 用 generator、save_story は
    保存のみで index しない）、`routes/generate.py`（POST /generate を SSE 化）、
    `routes/prompts.py`（GET/PUT /prompts/{writer,selector}）
  - UI: Generate 画面（アンカー列の追加/並べ替え、プロット、目標トーン、生成前に
    writer モデルを自動ロード、SSE でシーンが順に埋まる進行表示 + state_after ビュー）、
    PromptEditor（上書き保存 / 既定に戻す）
  - 検証: build / py_compile 成功。**実 LLM E2E**: gemma-4-31B で 3 シーン
    （intro→turn→ending, target_tone=bitter）を逐次生成。events が 1→2→4 と積み上がり、
    革鞄・老婦人などの確定事実が最終シーンまで矛盾なく引き継がれた。story 保存・取得・
    削除、プロンプト GET/PUT/リセットも確認

## 未完了（plan.md の作業順序に従う）

- [x] フェーズ 1: Vault（CRUD / メディア / タグ・ロール / 埋め込み / stats）
- [x] フェーズ 2: Generate 逐次パイプライン（穴埋めなし）
- [ ] フェーズ 3: Theater
- [ ] フェーズ 4: Compose（→ v1 完成）
- [ ] フェーズ 5: v1.5（fill_gap / 多様性 / バックトラック）

## 次の一手

フェーズ 3（Theater）: 生成済み story の鑑賞。履歴一覧（GET /stories）→ 再生ビュー
（Ken Burns パン/ズーム + テキスト長に応じたオート送り + クロスフェード）。
カードのメディア（/cards/{id}/file）をシーン背景に使う。シンプルに保つ（spec §10）。

その後フェーズ 4（Compose: React Flow アンカー配置）で v1 完成。
Generate 画面の暫定アンカー選択 UI は、Compose 完成後に composition ドラフトを
受け取る形へ置き換える（store/appStore の CompositionDraft は共有済み）。

- 起動は `start.bat`。環境注意: この PC の `python` は Store スタブのため `py` を使う
- 生成中の清書プロンプトは Generate 画面の「清書プロンプトを編集」から上書きできる

## 注意点・申し送り

- spec.md の「### 判断」ブロックは確定事項。実装時に再検討しない。
- v1 のスコープを厳守する（GAP スロット・分岐・tone 引力は実装しない。
  ただし差し込める形の関数境界にしておく）。
- spec §14 の未決事項は実装フェーズ到達時に決めて plan.md のチェックリストを更新する。
- Windows 環境。better-sqlite3 等ネイティブモジュールは `rebuild:electron` 相当の
  再ビルド手順が必要（lm-graph と同様）。
