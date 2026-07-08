"""SQLite 接続とスキーマ初期化。

ライブラリルート（DB + メディア + サムネイル）は当面 data/library/ に置く。
のちに設定で外部フォルダを参照できるよう、パスの解決はこのモジュールに集約し、
DB に保存するメディアパスは必ずライブラリルート相対にする（image-assistant と同方式）。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import sqlite_vec

# Qwen3-Embedding-4B の次元。実装時に /v1/embeddings の返り値で実測確認して確定する
EMBED_DIM = 2560

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def get_library_root() -> Path:
    """ライブラリルート。将来ここを設定値（外部フォルダ）に差し替える。"""
    root = _REPO_ROOT / "data" / "library"
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_media_dir() -> Path:
    path = get_library_root() / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_thumbs_dir() -> Path:
    path = get_library_root() / "thumbs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return get_library_root() / "story-flow.sqlite3"


def to_relative(path: Path) -> str:
    """ライブラリルート相対の POSIX パスに正規化して DB 保存用にする。"""
    return path.resolve().relative_to(get_library_root().resolve()).as_posix()


def resolve_path(relative: str) -> Path:
    """DB に保存された相対パスを実パスへ解決する。"""
    return get_library_root() / relative


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
