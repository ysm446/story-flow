"""SQLite 接続とスキーマ初期化、ライブラリルートの解決。

ライブラリ = 作品バンドル（DB + メディア + サムネイル + プロンプト）。丸ごとコピー/共有できる。
どのライブラリを開くかはマシン設定（data/settings.json の library_root）に保存する。

- 起動時: settings.json の library_root → 無ければ旧既定 data/library/（DB があれば）
- どちらも無ければ「未オープン」状態になり、UI がライブラリピッカーを出す
- DB に保存するメディアパスは必ずライブラリルート相対にする（外部フォルダ移動に追随）
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import sqlite_vec

# Qwen3-Embedding-4B の次元（2026-07-08 実測確認済み）
EMBED_DIM = 2560

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
_SETTINGS_PATH = _REPO_ROOT / "data" / "settings.json"
_LEGACY_LIBRARY_ROOT = _REPO_ROOT / "data" / "library"

DB_FILENAME = "story-flow.sqlite3"

_current_root: Path | None = None


class LibraryNotOpen(RuntimeError):
    """ライブラリが未オープン（ピッカーで開く必要がある）。"""


def load_app_settings() -> dict:
    try:
        return json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_app_setting(key: str, value) -> None:
    """settings.json の 1 キーだけを read-modify-write で更新する（UI 設定と同居のため）。"""
    settings = load_app_settings()
    settings[key] = value
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve_initial_library_root() -> Path | None:
    """起動時のライブラリルート解決。開けるものが無ければ None（未オープン）。"""
    configured = load_app_settings().get("library_root")
    if isinstance(configured, str) and configured.strip():
        path = Path(configured)
        if (path / DB_FILENAME).exists():
            return path
    if (_LEGACY_LIBRARY_ROOT / DB_FILENAME).exists():
        return _LEGACY_LIBRARY_ROOT
    return None


def open_library(root: Path, persist: bool = True) -> None:
    """ライブラリを開く（無ければ構造を作る）。以降の接続はこのルートを使う。"""
    global _current_root
    root.mkdir(parents=True, exist_ok=True)
    (root / "media").mkdir(exist_ok=True)
    (root / "thumbs").mkdir(exist_ok=True)
    (root / "bgm").mkdir(exist_ok=True)
    _current_root = root
    init_db()
    if persist:
        save_app_setting("library_root", str(root))


def is_library_open() -> bool:
    return _current_root is not None


def get_library_root() -> Path:
    if _current_root is None:
        raise LibraryNotOpen("ライブラリが開かれていません。")
    return _current_root


def get_media_dir() -> Path:
    path = get_library_root() / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_thumbs_dir() -> Path:
    path = get_library_root() / "thumbs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_bgm_dir() -> Path:
    path = get_library_root() / "bgm"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return get_library_root() / DB_FILENAME


def to_relative(path: Path) -> str:
    """ライブラリルート相対の POSIX パスに正規化して DB 保存用にする。"""
    return path.resolve().relative_to(get_library_root().resolve()).as_posix()


def resolve_path(relative: str) -> Path:
    """DB に保存された相対パスを実パスへ解決する。"""
    return get_library_root() / relative


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # 併走する書き込み（生成結果の保存 / Compose の自動保存 / 埋め込み upsert）が
    # "database is locked" にならないよう、WAL + busy_timeout で待ち合わせる
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    return conn


def init_db() -> None:
    schema = _SCHEMA_PATH.read_text(encoding="utf-8").replace("{EMBED_DIM}", str(EMBED_DIM))
    conn = get_connection()
    try:
        conn.executescript(schema)
        _migrate_schema(conn)
        conn.commit()
    finally:
        conn.close()


def _migrate_schema(conn: sqlite3.Connection) -> None:
    """既存 DB への追加カラムを条件付き ALTER で適用する（image-assistant と同方式）。"""
    story_columns = {row["name"] for row in conn.execute("PRAGMA table_info(stories)")}
    if "workspace_id" not in story_columns:
        conn.execute("ALTER TABLE stories ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)")
    if "parent_story_id" not in story_columns:
        conn.execute("ALTER TABLE stories ADD COLUMN parent_story_id TEXT REFERENCES stories(id)")

    scene_columns = {row["name"] for row in conn.execute("PRAGMA table_info(story_scenes)")}
    if scene_columns and "bgm_id" not in scene_columns:
        conn.execute("ALTER TABLE story_scenes ADD COLUMN bgm_id TEXT REFERENCES bgm(id)")

    workspace_columns = {row["name"] for row in conn.execute("PRAGMA table_info(workspaces)")}
    if workspace_columns and "scene_length" not in workspace_columns:
        conn.execute(
            "ALTER TABLE workspaces ADD COLUMN scene_length TEXT"
            " CHECK(scene_length IN ('short','standard','long') OR scene_length IS NULL)"
        )
    if workspace_columns and "folder_ids" not in workspace_columns:
        conn.execute("ALTER TABLE workspaces ADD COLUMN folder_ids TEXT NOT NULL DEFAULT '[]'")
    if workspace_columns and "lore" not in workspace_columns:
        conn.execute("ALTER TABLE workspaces ADD COLUMN lore TEXT NOT NULL DEFAULT '[]'")

    cards_column_names = {row["name"] for row in conn.execute("PRAGMA table_info(cards)")}
    if cards_column_names and "folder_id" not in cards_column_names:
        conn.execute("ALTER TABLE cards ADD COLUMN folder_id TEXT REFERENCES folders(id)")

    # cards.role の任意化（NOT NULL 制約の除去は SQLite ではテーブル再構築が必要）
    cards_columns = list(conn.execute("PRAGMA table_info(cards)"))
    role_column = next((column for column in cards_columns if column["name"] == "role"), None)
    if role_column is not None and role_column["notnull"]:
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(
            """
            CREATE TABLE cards_new (
              id          TEXT PRIMARY KEY,
              title       TEXT NOT NULL,
              brief       TEXT NOT NULL,
              media_path  TEXT,
              media_type  TEXT CHECK(media_type IN ('image','video')),
              role        TEXT CHECK(role IN ('intro','rising','turn','climax','ending') OR role IS NULL),
              tone        TEXT CHECK(tone IN ('happy','bad','bitter','neutral') OR tone IS NULL),
              folder_id   TEXT REFERENCES folders(id),
              created_at  TEXT NOT NULL,
              updated_at  TEXT NOT NULL
            );
            INSERT INTO cards_new
              SELECT id, title, brief, media_path, media_type, role, tone, folder_id, created_at, updated_at FROM cards;
            DROP TABLE cards;
            ALTER TABLE cards_new RENAME TO cards;
            """
        )
        conn.execute("PRAGMA foreign_keys = ON")
