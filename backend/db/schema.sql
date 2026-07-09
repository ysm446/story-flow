-- story-flow スキーマ（docs/spec.md §4）
-- {EMBED_DIM} は database.py が初期化時に実次元へ置換する（Qwen3-Embedding-4B: 2560 想定）

-- 4.1 cards — シーンカード（素材）
CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,              -- 作者用の短い識別名
  brief       TEXT NOT NULL,              -- ~200字。LLMへの指示/アイデア（清書の入力）
  media_path  TEXT,                       -- ライブラリルート以下の相対パス（media/xxx）
  media_type  TEXT CHECK(media_type IN ('image','video')),
  role        TEXT                        -- 物語上の役割（任意。NULL = 自動/汎用。2026-07-09 任意化）
              CHECK(role IN ('intro','rising','turn','climax','ending') OR role IS NULL),
  tone        TEXT                        -- ending カードのみ意味を持つ（終点タグ）
              CHECK(tone IN ('happy','bad','bitter','neutral') OR tone IS NULL),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 4.2 card_tags — 意味タグ（フィルタ用に正規化）
CREATE TABLE IF NOT EXISTS card_tags (
  card_id   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_type  TEXT NOT NULL CHECK(tag_type IN ('place','time','mood')),
  value     TEXT NOT NULL,
  PRIMARY KEY (card_id, tag_type, value)
);

-- 4.3 card_vec — 埋め込み（sqlite-vec 仮想テーブル。ブリーフから計算）
CREATE VIRTUAL TABLE IF NOT EXISTS card_vec USING vec0(
  card_id TEXT PRIMARY KEY,
  embedding FLOAT[{EMBED_DIM}]
);

-- 4.4 cards_fts — 全文検索（FTS5）
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  card_id UNINDEXED,
  title,
  brief,
  tags                                  -- card_tags を空白連結して投入
);

-- 4.5 stories — 生成された物語（1 インスタンス）
-- 注: 清書結果は保存するが index しない（embedding / FTS を張らない。spec §1.4）
CREATE TABLE IF NOT EXISTS stories (
  id               TEXT PRIMARY KEY,
  plot             TEXT,                     -- 入力プロット
  target_tone      TEXT,                     -- 目標トーン（v1.5 で使用、v1 は NULL 可）
  workspace_id     TEXT REFERENCES workspaces(id),  -- 生成元ワークスペース（NULL 可）
  parent_story_id  TEXT REFERENCES stories(id),     -- 部分再生成の元テイク（NULL = 新規生成）
  created_at       TEXT NOT NULL
);

-- 4.7 workspaces — 作品単位の編集状態（spec §4.7）
-- Vault（cards）は全ワークスペース共通のアセット。構成・生成設定だけを作品ごとに持つ。
-- graph はカード ID と座標のみ（{"nodes":[{"id","x","y"}],"edges":[{"id","source","target"}]}）。
-- カード本体は保存せず、読み込み時に cards から再構成する（削除済みカードのノードは落とす）。
CREATE TABLE IF NOT EXISTS workspaces (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  graph             TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  plot              TEXT NOT NULL DEFAULT '',
  target_tone       TEXT CHECK(target_tone IN ('happy','bad','bitter','neutral') OR target_tone IS NULL),
  prompt_preset_id  TEXT,               -- NULL = 既定プロンプト
  scene_length      TEXT CHECK(scene_length IN ('short','standard','long') OR scene_length IS NULL),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- 4.8 bgm — BGM（音楽アセット）。カードとは独立した素材（シーンではない）。
-- 説明文（曲の雰囲気）を埋め込み、のちにムードでベクトル検索して選曲する。
CREATE TABLE IF NOT EXISTS bgm (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',    -- 曲の雰囲気（自由文）。これを埋め込む
  media_path   TEXT,                        -- ライブラリルート相対（bgm/xxx.mp3）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- bgm_vec — BGM 説明文の埋め込み（sqlite-vec）
CREATE VIRTUAL TABLE IF NOT EXISTS bgm_vec USING vec0(
  bgm_id TEXT PRIMARY KEY,
  embedding FLOAT[{EMBED_DIM}]
);

-- bgm_fts — BGM の全文検索（FTS5）
CREATE VIRTUAL TABLE IF NOT EXISTS bgm_fts USING fts5(
  bgm_id UNINDEXED,
  title,
  description
);

-- 4.6 story_scenes — 物語内の順序付きシーン
CREATE TABLE IF NOT EXISTS story_scenes (
  id                TEXT PRIMARY KEY,
  story_id          TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,    -- 0 始まりの並び
  card_id           TEXT NOT NULL REFERENCES cards(id),
  prose             TEXT NOT NULL,       -- このシーンの清書文
  is_fixed          INTEGER NOT NULL,    -- 1=作者が置いたアンカー / 0=LLMが埋めた(v1.5)
  selection_reason  TEXT,                -- LLM がこのカードを選んだ理由（v1.5）
  state_after       TEXT,                -- このシーン終了時点の確定事実(JSON) デバッグ/継続用
  UNIQUE(story_id, position)
);
