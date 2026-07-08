# progress.md — 進捗

作成日時: 2026-07-08 16:39
更新日時: 2026-07-09 05:37

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

- 2026-07-09: Vault のドラッグ&ドロップ対応（作者要望）:
  - カードエディタのメディア枠にドロップで差し替え（ドラッグ中はハイライト）
  - Vault のグリッドに画像/動画をドロップ → そのファイルをメディアにした新規カード作成を開く
  - ウィンドウ全体でファイルドロップの既定動作（ナビゲーション）を防止
- 2026-07-09: 修正 — Electron 非対応の window.prompt() を自前の名前入力ダイアログに置換、
  start.bat を ASCII + CRLF 化（UTF-8 日本語が CP932 パースで壊れていた）

- 2026-07-09: 動画サムネイルの表示対応 — 生成（ffmpeg フレーム抽出）はフェーズ 1 から
  動いていたが UI が「🎬 動画」の文字だけ出していた。Vault グリッドとカードエディタで
  サムネイル画像 + 🎬 バッジを表示（サムネ無しは非表示フォールバック）。選択直後の
  動画はその場でループプレビュー。テスト動画で生成 → 配信 200 を検証済み。
  この環境の ffmpeg は winget 導入済み（PATH 経由で backend から利用可能）

- 2026-07-09: Compose ノードにもサムネイル表示（画像限定 → 動画含む全メディア + 🎬 バッジ）。
  カード編集は保存済み動画のサムネイルクリックでインライン再生/停止（▶ ヒント表示、
  コントロール付き）。差し替えは「ファイル変更」ボタンに分離

- 2026-07-09: **シーンの長さ設定 + 長文再生対応**（作者要望）:
  - Compose 生成設定に「シーンの長さ」（短め 150 / 標準 300 / 長め 600 字 / 指定なし）。
    ワークスペースに保存（workspaces.scene_length、条件付き ALTER で移行）し、
    writer への指示に「目安の長さ」として注入。プロンプトプリセットと独立に組み合わせ可
  - Theater: 本文に最大高（38vh）を設定し、はみ出す長文はストリーミング時は追従
    スクロール、オフ時は表示時間に合わせたオートスクロール（冒頭/末尾 2 秒は静止）
  - 検証: build / py_compile / scene_length の保存・クリア API / writer プロンプトへの
    目安注入を確認済み

- 2026-07-09: **動画ループのクロスディゾルブ**（作者要望）:
  - Theater の動画シーンで、同じ動画を 2 枚重ねて終端 1 秒手前からもう片方を頭出し再生し、
    opacity フェードで継ぎ目を繋ぐ CrossfadeLoopVideo を実装（動画の再エンコード不要）
  - フェード時間の 2 倍より短い動画は通常ループにフォールバック
  - 設定画面「動画ループをクロスディゾルブ」でオン/オフ（既定オン）。
    長さもスライダーで調整可（0.2〜3.0 秒、既定 1.0 秒、リセットボタン付き）

- 2026-07-09: **ロール任意化 + ノードの追加指示**（作者と協議のうえ spec 変更）:
  - cards.role を任意に（NULL = 自動/汎用。既定は「自動（指定しない）」）。SQLite の
    NOT NULL 除去のためテーブル再構築マイグレーション。stats に unassigned 追加。
    UI の role 表示は付いている場合のみチップ表示
  - **ノードのプロパティ（追加指示）**: Compose でノードを選択すると右パネル上部に
    プロパティ（カード情報 + 指示文 textarea）。指示文は workspace graph に保存され、
    生成時に「この作品でのこのシーンへの追加指示」として writer に渡る。
    ブリーフ = 共有素材の意図 / 指示文 = 作品ごとの演出、という役割分担。
    指示ありノードには 📝 バッジ。POST /generate は card_ids → slots（card_id + instruction）に変更
  - Compose パレットにサムネイル + ブリーフ 1 行、ウィンドウをコンテンツ領域 1920×1080 に
  - 検証: build / py_compile / 既存 DB のマイグレーション（7 枚保持）/ role なし作成 /
    stats.unassigned / slots 404 / writer プロンプトへの指示文注入・ロール省略 すべて確認

- 2026-07-09: **クロスディゾルブの暗転修正** — 2 枚同時フェード（1→0 と 0→1）は中間点で
  合成不透明度が 0.75 になり黒背景が透けていた。「下は不透明のまま残し、上に重ねた
  新しい動画だけをフェードイン」方式に変更（合成は常に不透明度 1、暗転しない）
- 2026-07-09: Theater の設定を拡充（作者要望）— 文字送りの速さ（10〜150 ms/字、既定 45。
  遅い設定でも文字送り完了までシーンを送らない）、本文フォントサイズ（12〜32px、既定 16）

- 2026-07-09: 再生ステージのサイズ設定（70〜100%、黒背景中央の額縁表示）+
  **全画面再生**（⛶ ボタン / F キー、Esc は全画面解除 → 一覧の 2 段階、
  プレイヤー終了時に自動解除。Electron main に window:setFullScreen IPC 追加）
- 2026-07-09: 修正 — クロスディゾルブの z-index が本文・コントロールより上に浮いて
  動画再生中のテキストが消えていた（isolation: isolate でコンテナ内に封じ込め）

- 2026-07-09: **Generate のトークンストリーミング表示**（作者要望）:
  - llm.py にストリーミング版 chat completion と _ProseStreamExtractor
    （JSON 出力から "prose" 文字列の中身だけをエスケープ解決しつつ逐次抽出。
    キー分断・\n・\uXXXX などチャンク境界跨ぎをランダム分割 42 ケースで検証済み）
  - pipeline が {"type": "delta", position, text} を SSE に流し、Generate UI が
    清書中の本文をカーソル（▍）付きで逐次表示。完了時に確定 prose に置き換え
  - ストリーム全文のパース失敗時は非ストリーミング（リトライ付き）へ自動フォールバック。
    spec の「清書と state を単一の構造化出力で」は維持
  - 本文エリア最大高 38vh → 25vh、設定スライダーを細く（track 3px / thumb 12px）
  - 未検証: 実 LLM でのストリーミング（次回の生成実行で確認）

- 2026-07-09: **清書時にカードの画像を LLM に見せる**（作者要望、設定でオンオフ）:
  - media.py にサムネイルの base64 data URL 化（動画はサムネフレーム、
    サムネ欠落画像は原本からその場で 420px 縮小）
  - llm.py の user content を OpenAI 互換の image_url パーツ対応に。
    writer プロンプトに「画像の情景を描写に反映（説明文にはしない）」の指示を追加
  - 設定「カードの画像を清書に反映」（既定オン）。vision 非対応モデル
    （mmproj なし）のときはフロントで自動オフ
  - 検証: build / py_compile / 実カード（動画サムネ）の data URL 生成 OK。
    実 LLM での vision 生成は次回の生成実行で確認

- 2026-07-09: **Generate をキャンバス + テイクモデルに再設計**（作者要望、spec §4.5 追記）:
  - backend: 生成は常に新テイクとして保存（stories.parent_story_id で系譜、上書きしない）。
    部分再生成 API — base_story_id + start_position + mode（from_here / single）。
    直前シーンの state_after から StoryState を復元して再開し、対象外シーンはコピー
    （reused/stale フラグ付きでイベント送出）。バリデーション + コピー経路 + state 再開を
    TestClient で検証済み
  - UI: Generate を React Flow キャンバス化。Compose と同じ配置のノードに清書文が
    ストリーミングで書き込まれる（ノード内自動スクロール、状態で枠色変化）。
    各ノードに「↻ このシーンのみ」「↻ ここから最後まで」。single 再生成後の後続シーンは
    「要確認」バッジ。左サイドにテイク一覧（時刻・シーン数・↻系譜マーク、クリックで表示、
    そこから部分再生成、削除可）
  - 未検証: 実 LLM での部分再生成の通し（次回の生成実行で確認）

- 2026-07-09: 下部ステータスバー（作者要望）— 左に backend/モデル状態、右端に
  システムリソース（CPU/RAM/GPU/VRAM。lm-graph の nvidia-smi + os.cpus 方式を
  electron/main/systemResources.ts に移植、1 秒毎 push）と 📈 での表示オンオフ（設定に永続）
- 2026-07-09: Generate ノードを内部スクロールから「文章の長さに合わせて縦に伸びる」表示に変更

- 2026-07-09: **アイコンのフラット化** — 絵文字（⚙📈🎬🗑▶⛶ 等）を線画 SVG アイコンセット
  （src/components/icons.tsx、stroke: currentColor）に総入れ替え。今後アプリ内アイコンは
  必ずこのセットを使う（絵文字はカラーグリフで UI から浮くため）
- 2026-07-09: Generate ノードにサムネイル表示を追加（Compose ノードと同じヘッダ画像 + 動画バッジ）

- 2026-07-09: UI 設定の保存先を localStorage から **data/settings.json** に変更（作者要望）。
  読み書きは Electron main（uiSettings:load/save IPC）。旧 localStorage の値は初回起動時に
  自動移行して削除

- 2026-07-09: **ライブラリの外部フォルダ化 + 起動 UI**（作者要望。spec §3/§11 更新）:
  - ライブラリ = 作品バンドル（DB + media + thumbs + prompts.json）を任意の場所に置ける。
    プロンプトプリセットもライブラリ内へ移動（旧 data/prompts から自動移行）
  - backend: ルートを動的化（未設定は「未オープン」503）。GET /library、POST /library/open
    （open = 既存必須 / create = 新規作成）。場所は data/settings.json の library_root に永続化。
    旧 data/library は DB があれば自動で開く（後方互換）
  - UI: 未オープン時は起動直後にライブラリピッカー（新規作成 / 開く、Electron のフォルダ
    選択ダイアログ）。設定パネルからも切り替え可。切替後はリロードで全画面が新ライブラリに
  - 検証: E:\sample files\story-flow\sample への新規作成 → 空 stats → プロンプト移行 →
    存在しないパスの open 404 → settings 永続化 → 旧ライブラリへ復帰（カード 6 枚）まで
    TestClient で E2E 確認。リポジトリの data/ は settings.json のみが今後の正

- 2026-07-09: ライブラリ切り替えの導線改善 — ヘッダーに現在のライブラリ名
  （フォルダアイコン + フォルダ名、ホバーでフルパス）を常時表示し、クリックで
  切り替え UI が開くように。ライブラリ状態取得の失敗（旧 backend 稼働中など）が
  死活表示やピッカー表示を巻き込まないよう堅牢化

- 2026-07-09: ヘッダーに**モデル選択バー**（lm-graph 風、作者要望）— models/ の GGUF を
  ドロップダウンで選択（選択で即ロード）、状態ドット（ロード済み/未ロード/ロード中）、
  ロード ▶ / 停止 ✕ ボタン、開いたとき models/ を再スキャン（models:rescan IPC 追加）

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
