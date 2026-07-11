# plan.md — 実装方針と作業計画

作成日時: 2026-07-08 16:39
更新日時: 2026-07-11 00:00

仕様の詳細と確定判断は [docs/spec.md](../spec.md) を正とする。
本ファイルは「どの順で・何を流用して」作るかの作業計画。

## 技術スタック（spec §3 で確定）

- フロント: Electron + React + TypeScript（`lm-graph` フォーク）。Compose は React Flow（`@xyflow/react`）。
- バックエンド: FastAPI（Python）。
- LLM 推論: llama.cpp の OpenAI 互換エンドポイント（既定 Qwen 系 instruct）。
  writer / selector はエンドポイント・モデルを分離可能にする。
- 埋め込み: Qwen3-Embedding-4B（GGUF、`models/Qwen3-Embedding-4B-GGUF/` に配置済み。
  2026-07-08 決定）。llama-server `--embedding` + `/v1/embeddings`。**ブリーフに対してのみ**計算。
- ストレージ/検索: SQLite + sqlite-vec + FTS5。メディアはディスク保存、DB にはパスのみ。
- 実行環境（2026-07-08 決定）:
  - llama-server は `runtime/` に配置し、**アプリ UI 内のインストーラ**でダウンロード・導入する。
  - GGUF モデルは `models/` に置く（現在 `gemma-4-31B-it-GGUF` を配置済み）。
  - バックエンド Python はリポジトリ直下の venv（`.venv`）+ `backend/requirements.txt` で管理する。
  - ライブラリ（DB + メディア + サムネイル）は当面 `data/library/` に置く。
    のちに設定で外部フォルダを参照できるようにする（そのためパスはライブラリルート相対で保持）。
  - `runtime/` / `models/` / `data/` / `.venv/` はコミットしない（.gitignore 済み）。

## 作業順序（spec §12。手戻り防止のためこの順を守る）

Compose から作ると楽しくて沼るが、生成が動かないうちは空箱。以下の順で進める。

### フェーズ 0: 足場づくり

1. `lm-graph` をフォークし、story-flow 用に整理する。
   - electron-vite（main / preload / renderer 3 ターゲット）、Tailwind + CSS 変数、
     ビルドスクリプト（`dev` / `build` / `rebuild:electron`）をそのまま引き継ぐ。
   - lm-graph は renderer の UI がほぼ `App.tsx`（4000 行超）に集中している。
     **フォーク時に spec §10 の `src/phases/{vault,compose,generate,theater}` 構成へ分割する**。
     グラフキャンバス部分（ReactFlow 設定・カスタムノード `GraphNodeCard`・
     `flowEdges.tsx`・`graphUtils.ts`）は Compose 用の下敷きとして残す。
   - llama-server の導入・起動管理は **Electron main に持たせる（決定済み）**。
     lm-graph の `llamaInstaller.ts`（ダウンロード/インストール、進捗イベント）と
     `llamaServer.ts`（spawn・ポート探索・`/health` 監視）を流用し、インストール先は
     `runtime/`、モデルは `models/` 配下の GGUF を列挙して選択する。
     **UI にインストーラ画面を作る**（未導入なら誘導 → ダウンロード進捗 → 完了で起動）。
     FastAPI 側は writer / selector / embedding のエンドポイント URL を設定で
     受け取るだけにし、サーバのライフサイクルには関与しない。
2. FastAPI バックエンドの骨格: `backend/main.py` + `db/schema.sql`（spec §4 の 6 テーブル）+
   `routes/` 空実装。Electron からは HTTP（生成系は SSE）で叩く。
   Python は venv（`.venv`）+ `backend/requirements.txt` で管理し、Electron から
   バックエンドを起動する場合も `.venv` の python を使う。

### フェーズ 1: Vault（実質アプリの半分。ここを確実に）

- カード CRUD + メディアアップロード + タグ/ロール + 保存時の埋め込み計算 + `/vault/stats`。
- ライブラリルートは当面 `data/library/`（`story-flow.sqlite3` + `media/` + `thumbs/` を同居）。
  image-assistant の `library_root` 設定と同様に、**のちに外部フォルダへ切り替え可能**にする。
  そのため DB に保存するパスは最初から必ずライブラリルート相対にする（v1 で設定 UI までは作らない）。
- `image-assistant` のメディアライブラリ実装（`image_library.py`）を構造の参考にする:
  - **ディスク保存 + DB は相対パスのみ**: `_to_relative()` / `_resolve()` によるルート相対
    パス正規化はほぼそのまま流用可能。
  - **sha256 先頭 16 桁 + 拡張子**の命名 + UNIQUE 制約で重複排除。ライブラリルート配下に
    原本 `media/` とサムネイル `thumbs/`（Pillow で最大 420px 程度・JPEG）の 2 系統。
    短尺動画のサムネイルは Pillow では作れないため ffmpeg でフレーム抽出に差し替える。
  - **FTS5 は external-content 方式 + INSERT/UPDATE/DELETE トリガで本体と同期**
    （`cards_fts` に適用）。
  - ハイブリッド検索の統合は Reciprocal Rank Fusion（k=60）方式を参考にする。
    ただしベクトル側は image-assistant の「BLOB + Python 総当たり」ではなく
    **sqlite-vec（spec §3 で確定）**を使う。
  - 埋め込みは「llama-server を `--embedding` で subprocess 起動 + OpenAI 互換
    `/v1/embeddings` を HTTP で叩く」方式（`embedding_client.py`）を**そのまま採用**。
    モデルも image-assistant と同じ Qwen3-Embedding-4B（配置済み）なので、
    `embedding_client.py` をほぼそのまま `backend/services/embedding.py` に移植できる。
- UI: 一覧グリッド（`image-assistant/frontend/image-library.js` の無限スクロール +
  遅延サムネ読み込みの構造を参考）、登録フォーム、在庫密度パネル（ロール別枚数）。

### フェーズ 2: Generate の逐次パイプライン（穴埋めなし）

- `backend/services/pipeline.py` の `generate()`（spec §6.1）を FIXED スロットのみで一本通す。
- `write_scene`（`services/writer.py` + `prompts/writer.md`）: 清書と**更新後 StoryState を
  同時に構造化出力**（別途抽出パスを立てない）。
- `services/state.py` の `StoryState`（spec §5）。各リストの上限を定数化。
- **生成用 system prompt はユーザー編集可能にする**（2026-07-08 追加要件）:
  - `backend/prompts/writer.md`（v1.5 で `selector.md` も）は「既定値」として扱い、
    ユーザーが上書きしたプロンプトを設定（DB or 設定ファイル）に保存して優先適用する。
  - UI に編集画面を用意する（テキストエリア + 「既定に戻す」ボタン）。
  - ただし構造化出力（JSON スキーマ部分）の指示は壊されると生成が止まるため、
    「編集可能な本文」と「システム側で必ず付与する出力形式指示」を分離して実装する。
- 手で用意した数枚のアンカー列で「順に清書 → 繋がった 1 本」が出ることを確認。
- SSE でシーン単位に push（lm-graph の main プロセスにある SSE パース実装が
  クライアント側の参考になる。story-flow では renderer が FastAPI の SSE を直接受ける想定）。

### フェーズ 3: Theater

- 生成済み story の再生のみ。Ken Burns（パン/ズーム）+ テキスト長に応じたオート送り +
  クロスフェード。シンプルに保つ。

### フェーズ 4: Compose（ここまでで v1 完成）

- React Flow で始点・中間（複数可）・終点ノードを置いて線で繋ぐ最小ビュー。
- エッジは v1 では「並び順」の意味しか持たない。分岐の意味論は v2 まで持ち込まない。
- lm-graph の流用箇所: `ReactFlowProvider` + `useNodesState`/`useEdgesState`、
  カスタムノード（`GraphNodeCard` の単一 nodeType 内で種別を出し分ける方式）、
  `RoundedSmoothStepEdge`、MiniMap / Background / スナップ設定。
  サイクル検出等の `graphUtils.ts` は v1 では一本道なのでほぼ不要（v2 で再利用）。

### フェーズ 5: v1.5（本命）

- `services/selection.py` に `retrieve_candidates` + `select_card` を実装し、
  `fill_gap`（spec §6.2 のシグネチャ確定済み）をパイプラインの GAP スロットに差し込む。
- チューニング 3 論点（spec §7）: 多様性（使用済みペナルティ・k の幅・tone のサイコロ）、
  行き止まり（浅いバックトラック or 橋渡し地の文）、在庫密度（`/vault/stats` で可視化済み）。
- **ロールの縛りを緩める**（2026-07-09 作者コメント: 「縛りを与えてしまう感じが気になる」）:
  `retrieve_candidates` の role はハードフィルタではなく**スコアのボーナス**として扱う案を
  第一候補にする（rising/turn の境界が曖昧でも破綻しない）。それでも窮屈なら
  「複数ロール可」「未指定 = 汎用カード」への緩和を検討（スキーマ変更を伴うため実測後に判断）。
- 設計資料: [docs/design/gap-fill-selection.md](../design/gap-fill-selection.md)
- **2026-07-10 実装**（fill_gap 本体。多様性チューニングと浅いバックトラックは残）:
  - **穴の UI は「おまかせノード」方式で確定**（作者選択）: Compose にプレースホルダノード
    （？）を置いてアンカーと同様に線で繋ぐ。1 ノード = 1 枚。プロパティで希望ロール・
    追加指示・BGM 指名を指定可。始点・終点はカード必須（穴は中間のみ）
  - ロールは**スコアボーナス**（ROLE_BONUS=0.15、ハードフィルタなし、未設定 = 汎用）で実装
  - クエリベクトル = A/B の保存済み埋め込みの中点（無ければ合成テキストを埋め込み、
    それも不可ならロール優先 + ランダムに劣化）。LLM 選択失敗は検索最上位に劣化
  - selector の system prompt は既定 backend/prompts/selector.md + プリセット切替
    （出力形式指示はシステム付与）。エンドポイントは STORY_FLOW_SELECTOR_URL で分離可
    （既定は writer と同一サーバ）
  - 部分再生成は「テイクの確定済みカード列」に対してのみ（穴の再抽選は新規生成で行う）

### 項目: BGM（2026-07-09 作者要望。v2 の「TTS + BGM」の具体化）

- 設計資料: [docs/design/bgm-selection.md](../design/bgm-selection.md)
- **mp3 を登録**できる BGM ライブラリを作り、**ムードに合わせて再生**する演出を入れる。
- 設計（2026-07-09 更新。当初の mood タグ案 → 自由文の説明を埋め込む方式に変更）:
  - BGM は **cards とは独立したテーブル**（`bgm` + `bgm_vec` + `bgm_fts`）。シーンではないので
    Compose/Generate のフローに混ぜない。保存はライブラリルート配下（`bgm/` + sha256 命名、
    DB にはパスのみ）。
  - **曲の雰囲気を自由文の説明（description）で書き、それを埋め込む**（作者が書く意図なので
    spec の「埋め込むのはブリーフ＝作者の意図」の原則と整合）。選曲は spec の確定パターン
    「**候補検索 → LLM 選択**」に乗せる：シーンのムード（`state_after.tone_so_far` 等）を
    クエリにベクトル検索で数件に絞り、LLM が 1 曲選ぶ。
- **Phase 1（2026-07-09 実装済み）**: Vault に BGM タブ — mp3 取り込み + タイトル + 説明 +
  埋め込み（bgm_vec）+ 一覧・プレビュー再生・キーワード/意味検索。
- **Phase 2（2026-07-09 実装済み）**: 選定は **Generate 時に各シーンへ確定し story_scenes.bgm_id
  に保存**（再生は決定的・再現可能）。Compose のノードで曲を手動指名でき、無指名は自動
  （候補検索→LLM選択。直前の曲を「継続」する選択肢を含む）。Theater は保存された曲を鳴らし、
  曲が変わったシーンでだけクロスフェード。設定に BGM オンオフ + 音量。
  - 残: 実 LLM での自動選曲の通し確認、選定プロンプトの UI 編集対応（現状は内部固定）。

### 項目: 時系列の先読み（2026-07-10 作者アイデア。未実装）

- 設計資料: [docs/design/timeline-awareness.md](../design/timeline-awareness.md)
- 現状の writer は「過去」（StoryState）しか知らず、次にどんなカードが来るかを知らずに
  書くため、シーン間の時間・場所のつなぎが跳ぶことがある。
- 方式案は 2 つ: **案 A = 次シーンのブリーフを「予告」として渡す** /
  **案 B = 生成前に時系列アウトライン（構成メモ）を 1 回作って全シーンに添える**。
- **UI はひとつに決め打ちせず、設定のプルダウンで方式を選択**（なし〔既定〕/ 予告 / 構成メモ。
  作者指示）。まず案 A から実装して効果を見る。
- 処理の重さ（2026-07-11 見積もり）: **案 A は実質ゼロ**（LLM 呼び出し増なし、
  各シーン +50〜100 入力トークンのみ）。**案 B はテイクごとに LLM +1 回**
  （シーン 1 枚分弱の先行コスト）。詳細は設計資料の「処理の重さ」参照。

### 項目: 物語の代表ベクトル = カード埋め込みの重心（2026-07-11 作者アイデア。未実装）

- Theater 一覧のサムネイルは現状「メディア付きカードを使う最初のシーン」（2026-07-11 実装）。
  これを **物語を構成するカードたちの埋め込みの重心（平均）を仮の「ストーリーベクトル」とし、
  それに最もベクトルが近いメディア付きカードを代表画像に選ぶ** 方式にするアイデア。
  物語の平均的なムードに一番近い絵がサムネイルになる。
- spec の確定判断（埋め込み対象は常にカード。stories には embedding を張らない）とは矛盾しない
  —— 既存のカード埋め込み（card_vec）を読んで合成するだけで、清書結果は埋め込まない。
- 実装するなら**生成時（save_story）に一度計算して保存**する形が現実的
  （例: stories.thumb_card_id 列）。一覧取得のたびに重心計算するのは無駄が多い。
  埋め込み未計算カードだけの物語は現行の「最初のメディア付きシーン」に劣化。
- 副産物として、この重心は将来「物語同士の類似」「ムードでの物語検索」にも使える。

## 参考リポジトリ

| リポジトリ | 参考にする点 |
|---|---|
| `D:\GitHub\lm-graph` | フォーク元。electron-vite 構成、React Flow のグラフ UI（カスタムノード/エッジ）、llama-server のインストーラ（`llamaInstaller.ts`）と起動管理（`llamaServer.ts`）、Tailwind + CSS 変数テーマ |
| `D:\GitHub\image-assistant` | Vault のメディアライブラリ構造。sha256 命名 + 相対パス保持、サムネ生成、FTS5 トリガ同期、RRF ハイブリッド検索、埋め込みサーバの HTTP ラップ |


## 未決事項（spec §14。実装前にここで確定させて記録する）

- [x] 埋め込みモデル・呼び出し方式 → **Qwen3-Embedding-4B（GGUF）** を llama-server
  subprocess + HTTP で使う（2026-07-08 決定）。`EMBED_DIM` は 2560 想定、実装時に実測確認
- [x] `CANDIDATE_K` の既定値 → **6 で確定**（2026-07-10。selection.py の定数）
- [x] `StoryState` 各リストの上限件数 → characters 8 / items 10 / events 15（state.py の定数）
- [x] 中間ノードの許容枚数の上限 → **上限なし**（おまかせノードは作者が明示配置するため
  自明に有限。制約は「始点・終点はカード必須」のみ。2026-07-10）
- [x] 未指定区間の橋渡しシーン自動挿入 → **見送り**（おまかせノードを明示配置する方式を
  採用したため不要。必要になれば v2 で再検討。2026-07-10）
- [x] writer / selector のエンドポイント → **分離可能**（`STORY_FLOW_SELECTOR_URL`。
  既定は writer と同一サーバ・同一モデル。2026-07-10）
- [x] LLM/埋め込みサーバの起動管理 → **Electron main に置く**。UI のインストーラで
  `runtime/` に導入し、`models/` の GGUF で起動する（2026-07-08 決定）
