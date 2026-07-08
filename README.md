# story-flow

短編ストーリー生成・鑑賞デスクトップアプリ。

作者が事前に「シーンカード」（画像/短尺動画 + 短い指示文 = ブリーフ）を大量に用意しておき、
始点・終点（と任意の中間点）を置くと、ローカル LLM が在庫カードから間を埋め、
左から 1 シーンずつ清書して一本の物語に仕立て、それを鑑賞する。
同じ素材から毎回すこしずつ違う短編が生まれる**リプレイ性**が面白さの核。

> **状態**: 企画・設計フェーズ（実装未着手）。詳細は [docs/plan/progress.md](docs/plan/progress.md)。

## 4 つのフェーズ

データは一方向に流れる。

| フェーズ | 役割 |
|---|---|
| **Vault** | 素材管理。カード（メディア + ブリーフ + タグ + ロール）の登録・検索、在庫密度の可視化 |
| **Compose** | 構成。始点・中間・終点アンカーをノードで置いて繋ぐ（React Flow） |
| **Generate** | 生成。1 シーンずつ逐次清書し、確定事実（StoryState）を持ち越して一貫性を保つ |
| **Theater** | 鑑賞。Ken Burns + オート送り + クロスフェード |

## 技術スタック

- **フロント**: Electron + React + TypeScript + React Flow（`lm-graph` をフォーク）
- **バックエンド**: FastAPI（Python / venv）
- **LLM**: llama.cpp（OpenAI 互換 API）。llama-server は `runtime/` にアプリ内インストーラで導入
- **埋め込み**: Ruri（日本語最適化）
- **ストレージ**: SQLite + sqlite-vec（ベクトル検索）+ FTS5（全文検索）

## ディレクトリ

```
electron/     Electron main プロセス（llama-server の導入・起動管理を含む）
src/          renderer（phases/{vault,compose,generate,theater}）
backend/      FastAPI（routes / services / prompts / db）
data/library/ ライブラリ（DB + メディア + サムネイル。DB にはパスのみ保存）※コミット対象外
models/       GGUF モデル置き場 ※コミット対象外
runtime/      llama-server 実行環境。UI のインストーラで導入 ※コミット対象外
docs/         仕様・計画・ルール
```

## セットアップ（予定 — 実装後に確定）

```powershell
# フロントエンド
npm install
npm run dev

# バックエンド（venv 必須）
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt

# モデル
# models/ に GGUF を配置し、llama-server はアプリ UI のインストーラから runtime/ に導入する
```

## ドキュメント

- [docs/spec.md](docs/spec.md) — 仕様書（設計判断の正）
- [docs/plan/goals.md](docs/plan/goals.md) — 目的・完成形・価値基準
- [docs/plan/plan.md](docs/plan/plan.md) — 実装方針・作業順序
- [docs/plan/progress.md](docs/plan/progress.md) — 進捗
- [docs/rules/electron-design-rules.md](docs/rules/electron-design-rules.md) — UI デザインルール
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — エージェント向け作業ルール
