# progress.md — 進捗

作成日時: 2026-07-08 16:39
更新日時: 2026-07-11 00:00

## 現在地

**v1.5 の中核 fill_gap 実装済み + 作者の実 LLM 通し確認 OK（2026-07-10「現状で上手く
いっています」）**。Vault のフォルダ整理と作品ごとの「使うフォルダ」も実装・アプリ確認済み。
2026-07-11 の変更一式（キャンセル・待ち時間・通知・サムネイル・内分点）も作者確認済み。
残りは多様性チューニング・浅いバックトラック（spec §7）と、時系列の先読み（案 A）。

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

- 2026-07-09: 修正 — カード編集で動画ドロップ後、文字入力のたびに動画プレビューが
  先頭に戻る（URL.createObjectURL をレンダー毎に生成していた）。useMemo でファイル単位に
  メモ化。revoke は「前のファイルの URL のみ」方式（effect クリーンアップでの revoke は
  StrictMode の 2 重実行で生きている URL を無効化し、プレビューが出なくなるため）

- 2026-07-09: Compose のカード追加位置を「ビューポート（カメラ）中央」に変更
  （screenToFlowPosition。既存ノードと重なる場合は 28px ずつずらす）

- 2026-07-09: Generate のノードをドラッグで移動可能に（位置オーバーライドをセッション内で
  保持。配置の正は Compose のまま）

- 2026-07-09: **モデル選択バーを lm-graph 風に刷新**（作者要望）— ヘッダー中央に配置。
  バー（CPU アイコン + モデル名 + シェブロン）を押すと一覧モーダルが開き、モデルを
  選ぶとその場でロード（モーダルにローディングオーバーレイ）。ロード済みは右に
  イジェクトボタン（停止）。`src/components/ModelBar.tsx` に分離。ヘッダーの backend
  死活ドットは撤去（下部ステータスバーに残る）。旧ドロップダウン + ▶/✕ ボタンは廃止。
  ヘッダーの「セットアップ」ボタンは設定パネル内の導線へ移動（未導入時の自動オープンは維持）
- 2026-07-09: 修正 — Generate ノードのドラッグ中に画面がちらつく/透明になる不具合。
  ノードを毎レンダー useMemo で作り直しており、React Flow が付与する measured
  （測定済みサイズ）が毎回失われ「未測定 → 一瞬 opacity:0」でちらついていた。
  Compose と同じ useNodesState / useEdgesState に変更し、シーン内容（ストリーミング）は
  既存ノードへ流し込む方式に（position と measured を引き継ぐ）。ドラッグは onNodesChange 任せ

- 2026-07-09: **Theater の縦横比・合わせ方を設定可能に**（作者要望。4:3 素材が 16:9 の
  ステージで上下トリミングされる問題）:
  - 「画面の縦横比」（自動＝ウィンドウ / 16:9 / 4:3 / 3:2 / 1:1）。比率指定時はステージを
    その額縁にしてコンテナ内最大サイズ（× stageScale）で中央配置（aspect-ratio + max-w/h）
  - 「メディアの合わせ方」（cover=埋める・切れる / contain=全体表示・余白）。img/video/
    CrossfadeLoopVideo すべてに適用。既定は現状維持（auto + cover）
  - 素材が 4:3 なら「縦横比=4:3」で切れずにぴったり収まる。混在素材は contain で無切れ

- 2026-07-09: **Compose のレイアウトを lm-chat 風に再構成**（作者要望）:
  - 左サイド: 作品（ワークスペース）を行リストで並べ、各行右に「⋯」ボタン →
    コンテキストメニュー（名前を変更 / 複製 / 削除）。旧 select + ボタン列は廃止。
    新規は上部の ＋ ボタン。メニューは fixed 配置（overlay クリック / Esc で閉じる）
  - 中央: ノードネットワーク（上）+ 下部にアセットエリア（未配置カードを横並び、
    クリックで配置）。旧 左サイドのカードパレットはアセットエリアへ移動
  - icons.tsx に IconMore（横三点）を追加
- 2026-07-09: **BGM ライブラリ Phase 1**（作者要望。plan.md「項目: BGM」参照）:
  - BGM は cards と独立したテーブル（bgm + bgm_vec + bgm_fts）。schema.sql に追加
    （IF NOT EXISTS で既存 DB にも自動作成）。音源は bgm/ に sha256 命名で保存
    （database.get_bgm_dir / media.save_audio、AUDIO_EXTS）
  - backend: routes/bgm.py（CRUD / 音源アップロード・配信 / q=FTS・semantic=ベクトル検索）。
    **曲の説明文（description）を埋め込む**（作者の意図なので spec の埋め込み原則と整合）。
    埋め込みサーバ未起動時は has_embedding=false で劣化保存
  - frontend: Vault にタブ（カード / BGM）。BgmLibrary.tsx（一覧 + プレビュー再生 +
    キーワード/意味検索 + 追加/編集/削除の右パネル）。api.ts に bgm 一式、icons に IconMusic
  - 検証: build / py_compile / TestClient E2E（作成→一覧→音源アップロード→配信→更新→
    意味検索503〔サーバ未起動時の正常劣化〕→削除）成功
- 2026-07-09: **BGM ライブラリ Phase 2**（作者要望。選定は Generate 時に確定・保存）:
  - Compose: ノードのプロパティに「BGM（自動/指名）」セレクトを追加。無指名＝自動（LLM）、
    指名すると固定。workspace graph の node に bgm_id を保存（📝 と並んで 🎵 バッジ）
  - backend: `services/bgm_select.py` — 候補検索（bgm_vec, k=6）→ LLM 選択。直前の曲を
    「継続」する選択肢を含め、切替の乱発を防ぐ。手動指名は LLM を回さず優先。埋め込み/LLM
    が使えなければ直前を継続に劣化。story_scenes に **bgm_id 列**を追加（条件付き ALTER 移行）。
    pipeline が各シーンで bgm を確定し保存、SSE の scene イベントにも載せる
  - Theater: `BgmPlayer`（2 枚の <audio> で曲変更時のみクロスフェード、一時停止/音量/
    オンオフに追従、終了で停止）。設定に「BGM を再生」+「BGM の音量」を追加
  - 検証: build / py_compile / TestClient（save_story の bgm_id 永続化、resolve_bgm の
    手動優先・埋め込み無し時の継続劣化・空クエリ継続）成功。実 LLM 自動選曲は次回生成で確認
- 2026-07-09: **修正 — テイク削除で「Failed to fetch」** が頻発する不具合。部分再生成の
  子テイクが親を parent_story_id で参照しており、親削除時に外部キー制約違反で 500 →
  レスポンスが返らず fetch 失敗になっていた。delete_story で子の parent_story_id を先に
  NULL 化（子は残す）。同様に delete_bgm で使用中シーンの bgm_id を先に NULL 化。
  TestClient で親削除→子存続・使用中 BGM 削除→シーン参照解除を確認
- 2026-07-09: **Generate ノードに選ばれた BGM を表示**（作者要望）— SSE scene イベントに
  bgm_id を追加、ノードヘッダ下に 🎵 + 曲名（テイク表示・生成中とも）。BGM 一覧を読み込み
  id→タイトルで解決（削除済みは「（削除済み BGM）」）
- 2026-07-09: Generate ノードのサムネイルを元の縦横比で表示（固定高さ + object-cover を
  やめ w-full h-auto に。サムネは元から比率保持で生成されており切れは CSS 起因だった）
- 2026-07-09: Generate ノードの重なり緩和レイアウト（作者要望）— Compose 座標を基準に
  チェーン順で x 方向の最小間隔（360px）を確保。生成時に自動適用。キャンバス右上に
  「整列」ボタン（ドラッグ上書きを捨てて並べ直し + fitView）。icons.tsx に IconGrid 追加
- 2026-07-09: 修正 — Theater の縦横比（4:3 等）でまた上下が切れていた。CSS の
  aspect-ratio + width% は横長コンテナで幅が縮まず比率が崩れるのが原因。コンテナ実寸を
  ResizeObserver で測り、比率を保った px サイズをステージに設定する方式に変更（両向き対応）
- 2026-07-09: Theater でクリック一時停止時に背景も止める（作者要望）— Ken Burns は
  animationPlayState、動画は paused に追従（CrossfadeLoopVideo に paused prop、通常ループは
  LoopVideo コンポーネント化）。再開時はアクティブな動画だけ再生
- 2026-07-09: Compose のミニマップをテーマ調整（ノード選択色/マスク/枠/角丸/影）。
  左サイド幅・右サイド幅・アセットエリア高さをドラッグでリサイズ可能に（pointer events、
  共通 startResize ヘルパー。左 180〜480 / 右 220〜520 / 高さ 90〜400 でクランプ。
  境界は見た目 1px・当たり判定は広め（透明オーバーレイ）でホバー時にアクセント色。セッション内保持）

- 2026-07-10: **プロジェクト全体レビュー + 安定性修正 6 件**（backend / frontend / Electron の
  3 領域をレビュー。spec 確定判断への違反はゼロ。検出した High 級を優先順に修正）:
  1. `npm run build` の型チェックが no-op だった（solution-style tsconfig を `tsc --noEmit` が
     辿らない → `tsc -p` を 2 プロジェクト個別実行に変更）。露見した実バグ
     `backend.ts` の未定義 `waitForExit`（終了処理が実行時 ReferenceError）も修正
  2. 生成全損の防止: 削除済み BGM の指名（workspace graph の残存参照）を生成開始時に
     自動選曲へ劣化 + 保存直前に bgm_id / workspace_id / parent_story_id を再検証して
     消えた参照は NULL に（生成中削除で save_story が FK 違反 → テイク全損だった）
  3. Compose / Generate を常時マウント化（CSS 表示切替）: 生成中のタブ切替で SSE が
     見えなくなり二重生成できた問題と、Compose のデバウンス保存がタブ切替で消える問題を
     解消。表示時にカード/BGM/テイク等を再取得して追随。done 無しのストリーム切断を
     成功と誤認しない終端イベント追跡も追加
  4. アンカー列のスナップショット廃止: Generate は常に store のグラフから
     `src/lib/chain.ts` の chainAnchors で導出（Compose 編集後に古い構成で生成される
     事故と、作品切替後にボタンが無効化される非対称を解消）。CompositionDraft から
     anchors を削除
  5. Electron: single instance lock + 起動時に runtime/ 配下の孤児 llama-server.exe を
     自動回収（異常終了 → ポート占有 → サーバ増殖で VRAM 二重消費の連鎖を遮断）+
     will-quit フォールバック + llama waitForHealthy のプロセス死亡即時検知
  6. DB: WAL + busy_timeout(15s) + 埋め込み計算（HTTP、最長 120 秒）を書き込み
     トランザクション外へ（カード保存中の並行書き込みが database is locked になっていた）
  - 検証: build（実効化した型チェック込み）/ py_compile / TestClient E2E
    （保存時の無効参照 NULL 化・WAL 確認・カード/BGM CRUD・実埋め込みサーバでの
    意味検索ヒット）すべて成功。アプリ実起動での通し確認は次回起動時に
  - ドキュメント: README の状態表記・ライブラリ説明を現状に更新、spec §8/§11 に
    実装済みルート（workspaces/bgm/prompts/library）と services を反映（Ruri 記述を削除）
  - レビューで検出した残課題（未修正。優先度 Medium 以下）は「注意点・申し送り」参照

- 2026-07-10: **LLM の思考モードを 3 層で無効化**（作者要望）:
  - llamaServer.ts の起動引数に `--reasoning-budget 0`（強制打ち切り）を追加、
    `--chat-template-kwargs` に `enable_thinking:false`（Qwen3 系）を追加
    （導入済み b9918 でフラグ対応を --help で確認済み）
  - llm.py の全リクエストに `chat_template_kwargs: {thinking:false, enable_thinking:false}`
    を付与（手動起動サーバ対策。400 なら response_format と共に外して再試行）
  - 既存の `<think>` 除去パーサは出力側の保険としてそのまま
  - 検証: build / py_compile 成功。実 LLM での生成確認は次回起動時に

- 2026-07-10: 修正 — モデルバーの名前が二重に見える（name は models/ 相対パスで
  「フォルダ名/ファイル名」。バーはファイル名のみ表示に。フルパスはツールチップ）

- 2026-07-10: Compose アセットエリアを折り返し表示に（作者要望）— 一行の横スクロール →
  flex-wrap + 縦スクロール

- 2026-07-10: **フェーズ 5（v1.5）: fill_gap 実装 — おまかせスロット**（穴の UI は
  作者選択で「おまかせノード方式」に確定。plan.md フェーズ 5 に決定記録）:
  - backend: `services/selection.py` 本実装 — `retrieve_candidates`（A/B の保存済み
    埋め込みの中点で sqlite-vec KNN、**ロールはスコアボーナス** ROLE_BONUS=0.15、
    使用済み除外、埋め込み不可時はロール優先 + ランダムに劣化）+ `select_card`
    （selector プロンプト + 出力形式指示をシステム付与、候補外 ID / LLM 失敗は
    検索最上位に劣化、temperature 0.6）+ `fill_gap`。CANDIDATE_K=6 で確定
  - pipeline: slots に kind（fixed/gap）。gap は fill_gap で 1 枚確定してから清書
    （左から 1 枚ずつ、選んだカードを used に繰り込み）。SSE に selecting / selected
    イベント追加。is_fixed=0 + selection_reason を保存。selector は
    STORY_FLOW_SELECTOR_URL で分離可（既定 writer と同一）
  - ルート検証: 始点・終点は gap 不可（422）、部分再生成のスロットに gap 不可（422。
    穴の再抽選は新規生成で行う）
  - Compose: アセットエリアの「＋ おまかせスロット」で？ノード（破線）を配置。
    プロパティで希望ロール / 追加指示 / BGM 指名。workspace graph に kind /
    target_role を保存（後方互換: kind 省略 = card）。gap ノード ID は `gap-` 接頭辞
  - Generate: 「カード選定中…」→ 選定カード + 選定理由をノードに表示（理由は
    テイク表示でも出る）。おまかせ由来のシーンはレイアウトを鎖の同位置ノードで照合
  - 検証: build（型チェック込み）/ py_compile / TestClient E2E 6 項目 PASS
    （候補検索の使用済み除外と件数、fill_gap のスタブ選定・候補外 ID 劣化、
    SSE イベント列 selecting→selected→scene、is_fixed=0 + 理由の永続化、
    端 gap / 部分再生成 gap の 422）。※埋め込みサーバ停止中だったため
    ベクトル劣化経路（ロール優先 + ランダム）で検証。実 LLM + 実ベクトルの通しは
    次回アプリ起動時に確認
  - 残: 多様性チューニング（tone のサイコロ等）、浅いバックトラック、在庫不足時の
    橋渡し逃げ道（現状は明確なエラーで停止）

- 2026-07-10: **v1.5 おまかせスロットの実 LLM 通し確認 OK**（作者確認。「現状で上手く
  いっています」）。実ベクトル + 実 LLM での選定通しはこれで確認済み

- 2026-07-10: **Vault フォルダ階層 + 作品ごとの「使うフォルダ」**（作者要望。UI は
  image-assistant のライブラリページ方式。設計: [docs/design/vault-folders.md](../design/vault-folders.md)）:
  - 原則: **ルート = 全作品共有 / フォルダ = 選択制（サブツリー含む）/ 手置きは常に有効**。
    既存カードは全部ルートなので後方互換は自動成立
  - backend: folders テーブル（parent_id 自己参照、無制限ネスト、sort_order）+
    cards.folder_id + workspaces.folder_ids（いずれも条件付き ALTER 移行）。
    CRUD / 移動（循環 400）/ 並べ替え / 解体削除（子とカードを親へ昇格）。
    /cards?folder=、/cards/{id}/folder、/generate folder_ids →
    load_inventory が「ルート ∪ サブツリー − 使用済み」に絞る
  - Vault: FolderTree.tsx — ツリー（展開状態 localStorage 永続、件数は直下のみ）、
    インライン作成/改名、⋯ メニュー、DnD 3 系統（カード投入 / Y 座標 3 分割の
    並べ替え・入れ子化 / ルートへ戻す）。フォルダを開いて新規作成 → そのフォルダへ
  - Compose: 生成設定に「使うフォルダ」チェックボックスツリー（workspace に自動保存）。
    アセットエリアがルート ∪ 選択サブツリーに絞られ、生成時に folder_ids を送信
  - 検証: build / py_compile / TestClient E2E 9 項目 PASS（階層 CRUD・直下件数・
    フォルダフィルタ・循環 400・並べ替え・在庫のサブツリー絞り込み・workspaces
    永続化と複製・/generate 経由の在庫絞り込み・解体削除・404）。UI はアプリ確認待ち
  - 保留: BGM のフォルダ対応（作者判断）、複数選択ドラッグ

- 2026-07-10: Compose アセットエリア改善（作者要望）— 既定の高さを 150 → 240px に拡大。
  アセットのカードとおまかせスロットをキャンバスへ**ドラッグ&ドロップで配置**できるように
  （独自 MIME type で OS のファイルドロップと区別、ドロップ位置にノード中心を合わせる。
  クリック配置は従来どおり）。検証: build（型チェック込み）成功。操作感はアプリ確認待ち

- 2026-07-10: Compose キャンバスのショートカット（作者要望）— **A = 全体表示（fitView）/
  F = 選択ノードにフォーカス**（padding 0.4・maxZoom 1.2・300ms アニメーション）。
  当初はキャンバス内フォーカス時のみだったが、ノード未選択でも A が効くよう window の
  keydown に変更（Compose 表示中のみ。input/textarea/select 内や修飾キー押下時は無視）。
  検証: build 成功。操作感はアプリ確認待ち

- 2026-07-10: Compose キャンバスを**左ドラッグ = 範囲選択**に変更（作者要望。複数選択して
  まとめて移動するため）— `selectionOnDrag` + `SelectionMode.Partial`（矩形に一部でも
  掛かれば選択）。パンは**中ボタン / 右ボタンのドラッグ**に移動（`panOnDrag={[1, 2]}`）。
  Shift ドラッグの範囲選択・Ctrl クリックの追加選択は React Flow 既定のまま。
  選択確定後にノード群へ残る矩形（NodesSelection）は CSS で非表示（作者確認済み。
  選択はノードのハイライトで分かり、ノードを掴めばまとめて動く）。
  検証: build 成功。操作感はアプリ確認待ち

- 2026-07-10: Compose ノードのサムネイルを元の縦横比で表示（作者要望）— 固定高さ 84px +
  object-cover をやめ Generate ノードと同じ w-full h-auto に。検証: build 成功

- 2026-07-10: 選択中のエッジをアクセント色（紫）+ stroke-width 2 に（作者要望。
  React Flow 既定の #555 は暗いキャンバスで細く・薄く見えた）。当初のクラス上書きは
  クリック選択時に灰色のままだった（クリックでエッジに :focus が付き、詳細度の高い
  既定の :focus ルールが勝つ）ため、既定ルールが参照する CSS 変数
  --xy-edge-stroke-selected の上書きに変更。検証: build 成功

- 2026-07-10: Generate のキャンバスも Compose と同じ操作系に（作者要望）— 左ドラッグ =
  範囲選択（Partial）/ パン = 中・右ボタン / A = 全体表示 / F = 選択ノードにフォーカス
  （window keydown、Generate 表示中のみ）。検証: build 成功

- 2026-07-10: **背景設定（lore）Phase 1 実装**（作者要望。goals.md「設定資料 RAG」の第一歩。
  方式は作者選択: 全文注入 / 作品ごと / タイトル付き複数メモ）:
  - backend: workspaces に lore 列（JSON 配列 [{id,title,body}]、条件付き ALTER 移行）。
    更新 API（lore 省略 = 変更なし）と複製コピー対応。生成時は POST /generate の
    workspace_id から backend が読む（`_load_lore`。部分再生成でも自動で効く）
  - writer: プロンプトに「## 背景設定（恒久設定。全シーンで一貫）」セクションを注入
    （プロットの直後・StoryState の前。body 空のメモはスキップ）。StoryState（一話内の
    動的事実）とは別レイヤ（goals.md の線引きどおり）
  - UI: Compose 生成設定に「背景設定」ブロック → LoreEditor モーダル
    （src/phases/compose/LoreEditor.tsx。左にメモ一覧 + 追加、右にタイトル/本文編集 + 削除。
    変更は即 composition に反映されデバウンス自動保存に乗る）
  - 検証: build（型チェック込み）/ py_compile / TestClient E2E 11 項目 PASS
    （マイグレーション・往復・省略時未変更・複製コピー・_load_lore・プロンプト注入・
    空 body スキップ・lore 無しでセクション無し）。実 LLM での効き具合は次回生成で確認
  - 将来: 長文化したら RAG 化（チャンク検索注入）。goals.md の RAG メモに Phase 1 済みを注記

- 2026-07-10: Compose アセットの**クリックを「即配置」から「選択」に変更**（作者要望。
  配置はドラッグ&ドロップが基本）— クリックで選択ハイライト + 右パネルに
  「カードのプロパティ」（サムネイル・タイトル・ロール・ブリーフ全文、読み取り専用。
  Vault のプロパティ画面を出したいがアセットエリア内は場所が難しいため右パネルで代替）。
  「キャンバスに配置」ボタンでクリック配置の代替も残す。ノード選択時はノードの
  プロパティが優先（アセットをクリックするとノード選択は外す）。検証: build 成功

- 2026-07-10: **Theater 本文フォントのプリセット選択**（作者要望。ADV 的ビジュアルに合う
  フォント）— 設定に「本文のフォント」ドロップダウン + 選択フォントでのプレビュー文。
  プリセット: 既定 / しっぽり明朝（文芸）/ Zen オールド明朝（文学的）/ クレー（手書き風）/
  ドットゴシック16（レトロゲーム）。すべて SIL OFL、@fontsource でローカルバンドル
  （オフライン動作、CJK は unicode-range サブセットで使った分だけロード）。
  定義は src/lib/theaterFonts.ts（プリセット追加はここに 1 行）。検証: build 成功。
  見た目はアプリ確認待ち

- 2026-07-10: **時系列の先読み（シーンのつながり改善）を設計メモとして起票**（作者アイデア。
  未実装）— writer が「未来」（次に来るカード）を知らないため、つなぎが跳ぶことがある。
  案 A = 次シーンのブリーフを予告 / 案 B = 生成前に時系列アウトラインを 1 回作成。
  **UI は設定のプルダウンで方式選択（なし〔既定〕/ 予告 / 構成メモ）とする（作者指示）**。
  詳細: [docs/design/timeline-awareness.md](../design/timeline-awareness.md)。plan.md にも項目追加

- 2026-07-10: Theater — 最終シーンをフェードアウトで終える（作者要望）。ending 状態を
  挟み、映像（既存の 1.2s レイヤートランジション）・本文（opacity 1.2s）・BGM
  （既存フェード）を暗転させてから終了画面をフェードイン（THEATER_END_FADE_MS=2s）

- 2026-07-11: **Generate にキャンセルボタン**（作者要望）— 生成中（モデル起動中も含む）に
  左パネルからキャンセル可能。fetch abort → サーバ側は切断検知で生成ジェネレータが
  閉じられ llama-server へのストリームも止まる（backend 変更なし）。キャンセル時は
  in-flight のシーンを pending に戻し、「保存されていません」の通知を表示。
  done 受信後の abort はテイク保存済みなので何もしない。検証: build 成功 +
  作者のアプリ確認 OK（2026-07-11）

- 2026-07-11: **Theater のシーン待ち時間を指定可能に**（作者要望）— 設定にチェックボックス
  「シーンの待ち時間を指定」+ 秒数スライダー（0〜30 秒、既定 3.0）。オンで
  「本文の表示が終わった時点 + 指定秒数」でオート送り（ストリーミング時は文字送り完了、
  オフ時はオートスクロール最下部到達。末尾 2 秒の静止は指定秒数に置き換え）。
  オフは従来の自動（文字数ヒューリスティックとの max）。設定キーは
  theaterFixedWaitEnabled / theaterFixedWaitSeconds。検証: build 成功 +
  作者のアプリ確認 OK（2026-07-11）

- 2026-07-11: **保存・更新アクションを下部ステータスバーに通知**（作者要望。自動保存で
  「保存されたか」が分かりにくい問題）— `src/lib/statusActions.ts`（React context を介さない
  pub/sub。reportStatusAction / onStatusAction）を新設し、StatusBar が最新アクションを
  時刻付きで表示（info 5 秒 / error 8 秒でフェードアウト、error は赤 + IconAlert）。
  発信元: Compose 自動保存の成功/失敗、カード・BGM の作成/更新、プロンプトプリセット保存。
  icons.tsx に IconCheck 追加。Compose 左上の「保存済み/保存中…」表示は従来どおり併存。
  あわせてステータスバーの backend 死活ドット + モデル名表示を撤去（作者判断。
  モデル状態はヘッダーのモデルバーにある。App.tsx の死活監視ループは
  ライブラリ状態の取得に必要なため残置、backendHealthy state のみ削除）。
  検証: build 成功 + 作者のアプリ確認 OK（2026-07-11）

- 2026-07-11: **fill_gap のクエリベクトルを内分点方式に**（作者と協議。v1.5 多様性
  チューニングの一環）— 連続する穴で毎回 A/B の中点を検索していたのを、
  t = 1/(次の固定アンカーまでの残り穴数+1) の内分点 (1-t)·A + t·B に変更
  （A〇〇〇B なら t = 1/4 → 1/3 → 1/2 と B 寄りへ滑る。単独の穴は t=1/2 で従来どおり）。
  生成順は左から逐次のまま（再帰なし）、追加の LLM・埋め込み呼び出しなし。
  pipeline に `_gaps_until_anchor`、selection に blend_toward_next / gaps_until_anchor を追加。
  設計資料 gap-fill-selection.md 更新。検証: py_compile + 穴カウント・按分式の単体確認 PASS +
  作者のアプリ確認 OK（2026-07-11）

- 2026-07-11: **Theater の物語一覧にサムネイル**（作者要望）— /stories にサブクエリで
  thumb_card_id（メディア付きカードを使う最初のシーン。削除済み・メディア無しは JOIN で
  スキップ）を追加し、一覧行の左に 96×56 のサムネイル表示（無ければグラデーション、
  読み込み失敗は非表示フォールバック）。検証: py_compile / TestClient（実ライブラリの
  3 テイクすべてで thumb_card_id 取得）/ build 成功 + 作者のアプリ確認 OK（2026-07-11）

- 2026-07-11: サムネイル選定の将来アイデアを plan.md に起票（作者アイデア。未実装）—
  構成カードの埋め込みの**重心**を仮のストーリーベクトルとし、それに最も近いカードを
  代表画像にする。詳細は plan.md「項目: 物語の代表ベクトル」

- 2026-07-11: **おまかせスロットをアセット一覧の先頭に常設**（作者要望）— ヘッダーの
  「＋」ボタンを撤去し、アセットグリッド先頭の破線「？」疑似カード（GAP_ASSET_ID）に。
  カードと同じ操作系（ドラッグ配置 / クリック選択 → 右パネルに説明 + 配置ボタン）。
  配置しても消えず何個でも置ける。検証: build 成功。見た目はアプリ確認待ち

- 2026-07-11: **修正 — 「使うフォルダ」未チェック時におまかせが全フォルダから引く**
  （作者報告）— フロントが未選択時に folder_ids を送らず（null）、load_inventory の
  「未指定 = 全カード」互換挙動に落ちていた（アセット一覧のルートのみ表示と不一致）。
  フロントは空配列を必ず送り、backend は「空リスト = ルートのみ / None = 全カード
  （API 直叩き互換）」に解釈を分離（`if folder_ids:` → `is not None`）。
  検証: py_compile / 実ライブラリで None→36 枚・[]→ルート 20 枚・フォルダ指定→
  ルート∪サブツリーを確認 / build 成功。vault-folders.md にも修正を記録

- 2026-07-11: **修正 — 画像で保存したカードを動画に差し替えると反映されないように見える**
  （作者報告）— 原因はサーバではなく Chromium の HTTP キャッシュ。メディア URL は
  差し替え後も同じで、配信レスポンスに Cache-Control が無くヒューリスティック
  キャッシュが古い内容を返していた（`&v=updated_at` バスター付きの Vault グリッド等は
  無事で、バスター無しの Compose/Generate ノード・Theater・動画原本で発症）。
  `backend/routes/media_files.py` を新設し、カード/サムネ/BGM 配信を
  no-cache + ETag 再検証（未変更は 304）に統一。検証: py_compile / TestClient で
  no-cache 付与・If-None-Match→304・画像→動画差し替え E2E すべて PASS

- 2026-07-11: **分岐ノード（選択肢）を v2 筆頭アイデアとして起票**（作者提案。未実装）—
  Compose で出力エッジ複数 = 選択肢、Theater が分岐点で選択を待つ ADV 風再生。
  最小形は「木のみ・合流なし・選択肢はエッジのプロパティ」。
  詳細: [docs/design/branch-nodes.md](../design/branch-nodes.md)、plan.md に項目追加

## 未完了（plan.md の作業順序に従う）

- [x] フェーズ 1: Vault（CRUD / メディア / タグ・ロール / 埋め込み / stats）
- [x] フェーズ 2: Generate 逐次パイプライン（穴埋めなし）
- [x] フェーズ 3: Theater
- [x] フェーズ 4: Compose（→ v1 完成。通し確認と調整は残）
- [ ] フェーズ 5: v1.5 — fill_gap 実装済み（2026-07-10）。多様性 / バックトラックが残

## 次の一手

1. **時系列の先読み（案 A）の実装**: writer に次シーンのブリーフを「予告」として渡し、
   シーンのつなぎを改善。UI は設定プルダウン（なし〔既定〕/ 予告 / 構成メモ）。
   設計: [docs/design/timeline-awareness.md](../design/timeline-awareness.md)
2. v1.5 チューニング: 選定の多様性（同じカードばかり選ばれないか）、選定理由の質、
   ROLE_BONUS / CANDIDATE_K / temperature の当たり確認（内分点は 2026-07-11 実装済み）
3. 方針待ち: Compose 左サイドの作品一覧の並び順（クリックで順序が動く件。
   作成順固定 / 名前順 / 手動並べ替え / 実編集時のみ updated_at 更新、のどれか）
4. 積み残し: 埋め込み未計算カードの一括再計算、浅いバックトラック（行き止まり対策）、
   BGM のフォルダ対応（保留中）、物語の代表ベクトル（重心）サムネイル（アイデア起票済み）

- 起動は `start.bat`。環境注意: この PC の `python` は Store スタブのため `py` を使う
- 生成中の清書プロンプトは Generate 画面の「清書プロンプトを編集」から上書きできる

## 注意点・申し送り

- 2026-07-10 レビューの残課題（Medium 以下。必要になったら着手）:
  - ストリーミング経路（llm.py の chat_completion_json_stream）に `response_format`
    未対応ビルドへのフォールバックがない（非ストリーミング側にはある）
  - `resolve_path` に封じ込め検証がない（共有ライブラリの DB に悪意あるパスがあると
    任意ファイル読み出し）。CORS 全許可 + 認証なしも同系統
  - FTS5 が既定トークナイザのため日本語の部分語検索が効かない（trigram 化を検討）
  - Theater: 動画シーンのレイヤークロスフェードが実質カット（非アクティブ側が即アンマウント）
  - Compose のノードドラッグで store 更新 → アプリ全体が再レンダー（大グラフで重い）
  - llamaInstaller: 展開失敗/キャンセル時に部分展開ディレクトリが残り、壊れたビルドが
    選ばれ続ける。start.bat は pip install 失敗後にセットアップが恒久スキップされる
  - cards テーブル再構築マイグレーションが非トランザクショナル
  - scene イベントの card_title を UI が未使用（自動開始レースでタイトルが空のまま）
- spec.md の「### 判断」ブロックは確定事項。実装時に再検討しない。
- v1 のスコープを厳守する（GAP スロット・分岐・tone 引力は実装しない。
  ただし差し込める形の関数境界にしておく）。
- spec §14 の未決事項は実装フェーズ到達時に決めて plan.md のチェックリストを更新する。
- Windows 環境。better-sqlite3 等ネイティブモジュールは `rebuild:electron` 相当の
  再ビルド手順が必要（lm-graph と同様）。
