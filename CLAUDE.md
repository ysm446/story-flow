# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code 向けのガイドです。
（汎用エージェント向けの共通ルールは `AGENTS.md` にあり、本ファイルはそれを Claude Code 用に具体化したもの）

## プロジェクト概要

**story-flow** — 短編ストーリー生成・鑑賞アプリ。作者が「シーンカード」（メディア + ブリーフ）を
貯めておき、始点・終点アンカーを置くと、ローカル LLM が左から 1 シーンずつ清書して一本の
物語に仕立てる。`lm-graph` をフォークして構築する。

- フロント: Electron + React + TypeScript + React Flow（Compose 画面）
- バックエンド: FastAPI（Python）+ SQLite（sqlite-vec / FTS5）
- LLM: llama.cpp の OpenAI 互換 API。埋め込みは Qwen3-Embedding-4B（GGUF / llama-server `--embedding`）

仕様の正は [docs/spec.md](docs/spec.md)。データは `Vault → Compose → Generate → Theater` の
4 フェーズを一方向に流れる。

## 作業開始時の確認

作業前に、必ず以下を読む。

1. [docs/plan/goals.md](docs/plan/goals.md) — 目的、完成形、重視する価値
2. [docs/plan/plan.md](docs/plan/plan.md) — 実装方針、作業順序、参考リポジトリの流用方針
3. [docs/plan/progress.md](docs/plan/progress.md) — 現在の進捗、未完了作業、申し送り

今回の依頼が計画・進捗のどこに関係するかを把握してから作業する。
方針と矛盾しそうな場合は、実装前にユーザーへ確認する。

## 絶対に守る設計判断（spec.md の「### 判断」ブロック。蒸し返さない）

- **清書は全編 LLM が書く**。カード本文をそのまま並べる方式は採らない。
  ただしブリーフの意図・確定事実（名前・持ち物・既発生の出来事）は壊さない。
- **生成は逐次のみ**（1 シーンずつ + StoryState 持ち越し）。一括生成は禁止。
- **埋め込み・検索の対象は常にカード（ブリーフ）**。清書結果（`stories` / `story_scenes`）は
  保存するが、embedding 計算も FTS も張らない。
- **穴埋め（v1.5）は「候補検索 → LLM 選択」の二段**。全在庫を LLM に見せない。
- **Generate は独立フェーズ**。状態機械として必ず 4 相（Vault/Compose/Generate/Theater）に分離。
- **スコープ厳守**: まず v1 を完成させる。v1.5 / v2 の機能は差し込める設計にするが実装しない。
  迷ったら「一本道 → 逐次清書 → 鑑賞」の最小経路を優先し、多機能化しない。

## 基本方針

- このプロジェクト固有の説明、判断基準、運用ルールは日本語で書く。
- コード、コマンド、API 名、ファイルパス、識別子は既存の表記を優先し、無理に翻訳しない。
- 既存の実装方針を確認してから変更する。
- ユーザーの未コミット変更を勝手に戻さない。
- 変更は必要な範囲に留め、無関係な整形やリファクタリングを混ぜない。

## ドキュメント管理

- `docs/**/*.md` を新規作成・更新するときは、本文の先頭付近に作成日時と更新日時を
  `YYYY-MM-DD HH:MM` 形式で書く（更新時は更新日時を現在時刻にする）。
  - 例: `作成日時: 2026-07-08 16:39`
- 進捗に変化があったら `docs/plan/progress.md` を更新する。
- `docs/changelog.md` はユーザー向け変更の履歴。日本語で書き、未確定の変更は
  先頭に「未リリース」セクションを作って記録する。
- `docs/design/` は設計資料（アルゴリズム・仕様メモ・調査資料）の置き場所。

## ディレクトリ構成（目標形。spec §11）

```
story-flow/
  electron/                  # main プロセス
  src/phases/                # renderer: vault / compose / generate / theater
  src/{components,lib,store}/
  backend/
    main.py
    requirements.txt
    db/schema.sql
    routes/    {cards,generate,stories}.py
    services/  {embedding,llm,pipeline,selection,writer,state}.py
    prompts/   {writer,selector}.md   # 既定プロンプト。ユーザー編集値が優先（UI から編集可能）
  data/settings.json         # マシン設定（UI 設定 + library_root。コミットしない）
  <ライブラリフォルダ>        # 任意の場所。story-flow.sqlite3 + media/ + thumbs/ + prompts.json
  models/                    # GGUF モデル置き場（コミットしない）
  runtime/                   # llama-server 実行環境。UI のインストーラで導入（コミットしない）
  .venv/                     # Python venv（コミットしない）
```

## 実行環境の決定事項

- llama-server は `runtime/` に配置。導入はアプリ UI のインストーラから行う
  （lm-graph の `llamaInstaller.ts` / `llamaServer.ts` を流用。管理は Electron main 側）。
- GGUF モデルは `models/` に置き、UI で列挙・選択する。
- ライブラリ（DB + メディア + サムネイル + プロンプト）は**任意のフォルダ**に置ける
  （起動 UI で新規作成/切り替え。場所は data/settings.json の library_root に永続化）。
  DB のパスは常にライブラリルート相対で保持する。UI 環境設定はライブラリに含めない。
- 生成用 system prompt（writer / selector）はユーザーが UI から編集できるようにする。
  `backend/prompts/*.md` は既定値。出力形式（JSON スキーマ）指示は編集対象から分離する。

## 参考リポジトリ（ローカルにあり。読み取り参照のみ、直接変更しない）

- `D:\GitHub\lm-graph` — フォーク元。electron-vite 構成、React Flow のカスタムノード/エッジ、
  llama-server 管理、Tailwind + CSS 変数テーマ。renderer が `App.tsx` 1 枚に集中しているので、
  story-flow では `src/phases/` へ分割して取り込む。
- `D:\GitHub\image-assistant` — Vault のメディアライブラリの参考。`image_library.py`
  （sha256 命名 + 相対パス保持 + サムネ生成 + FTS5 トリガ同期 + RRF ハイブリッド検索）、
  `embedding_client.py`（埋め込みサーバの HTTP ラップ）。
  ただしベクトル検索は BLOB 総当たりではなく sqlite-vec を使う（spec で確定）。

## コマンドと検証

- ファイル検索は `rg` / `rg --files` を優先する。
- ファイル編集は Claude Code の Read / Edit / Write ツールを使う。
  テキストファイルは UTF-8（BOM なし）・改行 LF を保つ。
- バックエンド Python は**必ず venv を使う**。グローバル Python に pip install しない。
  - 構築: `python -m venv .venv` → `.venv\Scripts\python.exe -m pip install -r backend/requirements.txt`
  - 実行・検証も `.venv\Scripts\python.exe` を使う。
- PowerShell でコマンドを組むときは、使う値を先に変数で定義してから使う。`$` はエスケープしない。
- 検証:
  - フロントエンドや型に関わる変更後は、可能な限り `npm run build`（`tsc --noEmit` を含む想定）。
  - バックエンド Python の変更は、可能な限り `.venv\Scripts\python.exe -m py_compile path/to/file.py` 等で構文確認。
  - 検証できなかった場合は、その理由を作業報告に書く。

## バージョン管理

- アプリのバージョンは `package.json` の `version` を基準にする。
- ユーザー向けの明確な変更は必要に応じて `docs/changelog.md` に記録する。
