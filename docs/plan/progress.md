# progress.md — 進捗

作成日時: 2026-07-08 16:39
更新日時: 2026-07-09 01:03

## 現在地

**フェーズ 4（Compose）まで完了 — v1 の全フェーズが実装済み**。
Vault → Compose → Generate → Theater が一本つながった。
アプリでの通し確認と使い勝手の調整 → v1.5（穴埋め）へ。

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

- 2026-07-09: **フェーズ 3（Theater）完了**:
  - 履歴一覧（プロット・日時・トーン表示、再生 / 削除）
  - 再生ビュー: シーンごとに Ken Burns（4 方向のパン/ズームをローテーション）、
    クロスフェード（1.2s）、テキスト長に応じたオート送り（4s + 90ms/字、5〜30s クランプ）
  - 動画メディアは Ken Burns の代わりにループ再生。メディア無しカードはグラデーション背景
  - 操作: クリック/スペース = 一時停止、← → = シーン移動、Esc = 終了、
    シーンドット・⏮⏯⏭、3 秒でコントロール自動非表示、終了画面（もう一度 / 一覧へ）
  - 検証: build 成功（再生の見た目はアプリ起動での確認待ち）
- 2026-07-09: ロールの縛りへの作者懸念を plan.md の v1.5 節に記録
  （候補検索でロールをハードフィルタでなくスコアボーナスにする案を第一候補に）

- 2026-07-09: 設定画面 + Theater 本文ストリーミング（作者要望）:
  - `store/settings.tsx`（localStorage 永続の UI 設定）+ ヘッダー ⚙ から開く設定パネル
  - 「本文をストリーミング表示」チェックボックス（既定 ON、45ms/字のタイプライター演出。
    全文で高さを確保してレイアウトのずれを防止。一時停止で止まる）
- 2026-07-09: **フェーズ 4（Compose）完了 — v1 全フェーズ実装**:
  - React Flow キャンバス。カードパレット（クリックで配置）→ ノードを線で繋ぐ
  - v1 制約をキャンバス上で強制: 出力/入力とも 1 本まで + 循環禁止（= 必ず一本鎖）
  - 「この構成を Generate へ →」で並び順を composition ドラフトに反映しタブ遷移
    （Generate 側の暫定選択 UI もそのまま使える）
  - キャンバス状態は store 保持でタブ切替に耐える（ディスク永続化は今後の課題）
  - 検証: build 成功（操作感はアプリ起動での確認待ち）

- 2026-07-09: **プロンプトをプリセット管理に拡張**（作者要望: 物語の種類に合わせて変えたい）:
  - backend: `services/prompts.py` を単一上書きから名前付きプリセット（追加/編集/削除/
    アクティブ切替、data/prompts/presets.json 永続、旧上書きファイルは自動移行）に再設計。
    API: GET /prompts/{kind}, POST/PUT/DELETE /prompts/{kind}/presets, PUT /prompts/{kind}/active
  - UI: 設定画面に PromptManager（一覧 + ラジオで切替、追加、編集、削除、既定は読み取り
    専用で「複製して編集」）。Generate 画面はプリセット選択ドロップダウンに置換
  - 検証: build / py_compile / プリセット API E2E（作成→更新→切替→削除で既定に戻る）成功
- 2026-07-09: **BGM を予定に追加**（作者要望）— mp3 登録 + ムード連動再生。
  実装方向を plan.md「将来項目: BGM」に記録（data/library/bgm/ 保存、mood タグ、
  Theater でシーンの tone_so_far に合わせてクロスフェード、設定に音量/オンオフ）

- 2026-07-09: **生成の起点を Compose に集約**（作者要望: Compose で全部決めて後は生成するだけに）:
  - Compose に「生成設定」パネル（プロット / 目標トーン / 清書プロンプト選択 / 生成する）を追加
  - 「生成する →」で Generate タブへ自動遷移し、そのまま生成が自動開始する
    （spec §2 判断どおり Generate は独立フェーズのまま。UI 上は実行・進行表示専用に簡素化し、
    アンカーの手動編集 UI は撤去。構成の編集は Compose に一本化）
  - CompositionDraft に targetTone を追加（Compose ⇄ Generate で共有）

- 2026-07-09: **ワークスペース（作品単位の保存）を実装**（作者要望。spec §4.7 追加）:
  - Vault は全ワークスペース共通アセット。ワークスペースは Compose グラフ（カード ID +
    座標 + 接続のみ）・プロット・目標トーン・プロンプトプリセットを持つ
  - backend: workspaces テーブル + CRUD/複製 API。既存 DB へは条件付き ALTER で
    `stories.workspace_id` を追加。生成時に story を作品へ紐付け（削除時は紐付けだけ外す）
  - Compose: 左サイドバー上部に作品の切替/新規/名前変更/複製/削除。編集はデバウンス
    自動保存（保存状態表示付き）。グラフはカード ID から復元し、削除済みカードは落とす
  - Theater: 作品での絞り込みセレクト + 履歴行に作品名バッジ
  - プロンプトプリセットの選択は作品ごとに保存（生成はその作品のプリセットを使用）
  - Compose キャンバス永続化の積み残しはこれで解消
  - 検証: build / py_compile / workspaces API E2E（作成→更新→トーンクリア→複製→
    一覧→stories フィルタ→削除、マイグレーション込み）成功。UI はアプリ確認待ち

## 未完了（plan.md の作業順序に従う）

- [x] フェーズ 1: Vault（CRUD / メディア / タグ・ロール / 埋め込み / stats）
- [x] フェーズ 2: Generate 逐次パイプライン（穴埋めなし）
- [x] フェーズ 3: Theater
- [x] フェーズ 4: Compose（→ v1 完成。通し確認と調整は残）
- [ ] フェーズ 5: v1.5（fill_gap / 多様性 / バックトラック）

## 次の一手

1. アプリで v1 を通し確認（Vault 登録 → Compose で繋ぐ → Generate → Theater 再生）し、
   使い勝手を調整（Ken Burns の動き量、オート送り・ストリーミング速度、Compose の操作感）
2. 積み残しの検討: 埋め込み未計算カードの一括再計算
3. フェーズ 5（v1.5）: `fill_gap`（retrieve_candidates + select_card）。
   ロールはハードフィルタでなくスコアボーナス案を第一候補に（plan.md 参照）

- 起動は `start.bat`。環境注意: この PC の `python` は Store スタブのため `py` を使う
- 生成中の清書プロンプトは Generate 画面の「清書プロンプトを編集」から上書きできる

## 注意点・申し送り

- spec.md の「### 判断」ブロックは確定事項。実装時に再検討しない。
- v1 のスコープを厳守する（GAP スロット・分岐・tone 引力は実装しない。
  ただし差し込める形の関数境界にしておく）。
- spec §14 の未決事項は実装フェーズ到達時に決めて plan.md のチェックリストを更新する。
- Windows 環境。better-sqlite3 等ネイティブモジュールは `rebuild:electron` 相当の
  再ビルド手順が必要（lm-graph と同様）。
