"""Vault: BGM（音楽アセット）の CRUD・検索・ファイル配信。

カードとは独立した素材（シーンではない）。説明文（曲の雰囲気）を埋め込み、
のちにムードでベクトル検索して選曲する土台にする。

- 埋め込みは description に対して計算し bgm_vec（sqlite-vec）に upsert する。
  埋め込みサーバ未起動時は埋め込み無しで保存を続行する（has_embedding=false）。
- bgm_fts は title / description をコードで同期する。
- 音声は data/library/bgm/ に sha256 命名で保存し、DB には相対パスのみ持つ。
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlite_vec import serialize_float32

from backend.db.database import EMBED_DIM, get_connection, resolve_path
from backend.services.embedding import EmbeddingUnavailable, embed_text
from backend.services.media import save_audio

router = APIRouter(tags=["bgm"])

SEMANTIC_KNN_K = 200  # ベクトル検索の一次取得件数


class BgmInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_embedding(conn: sqlite3.Connection, bgm_id: str) -> bool:
    return conn.execute("SELECT 1 FROM bgm_vec WHERE bgm_id = ?", (bgm_id,)).fetchone() is not None


def _bgm_response(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    bgm = dict(row)
    bgm["has_embedding"] = _has_embedding(conn, bgm["id"])
    return bgm


def _get_bgm_row(conn: sqlite3.Connection, bgm_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM bgm WHERE id = ?", (bgm_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="bgm not found")
    return row


def _refresh_fts(conn: sqlite3.Connection, bgm_id: str, title: str, description: str) -> None:
    conn.execute("DELETE FROM bgm_fts WHERE bgm_id = ?", (bgm_id,))
    conn.execute(
        "INSERT INTO bgm_fts (bgm_id, title, description) VALUES (?, ?, ?)",
        (bgm_id, title, description),
    )


def _refresh_embedding(conn: sqlite3.Connection, bgm_id: str, description: str) -> bool:
    """説明文の埋め込みを bgm_vec に upsert する。失敗しても保存は続行する。"""
    conn.execute("DELETE FROM bgm_vec WHERE bgm_id = ?", (bgm_id,))
    text = description.strip()
    if not text:
        return False  # 説明が空なら埋め込まない
    try:
        vector = embed_text(text)
    except EmbeddingUnavailable as error:
        print(f"[bgm] embedding skipped for {bgm_id}: {error}")
        return False
    if len(vector) != EMBED_DIM:
        print(f"[bgm] embedding dim mismatch: got {len(vector)}, expected {EMBED_DIM}")
        return False
    conn.execute(
        "INSERT INTO bgm_vec (bgm_id, embedding) VALUES (?, ?)",
        (bgm_id, serialize_float32(vector)),
    )
    return True


def _fts_match_expression(query: str) -> str:
    tokens = [token.replace('"', '""') for token in query.split() if token]
    return " ".join(f'"{token}"' for token in tokens)


@router.get("/bgm")
def list_bgm(q: str | None = None, semantic: str | None = None, limit: int = 200, offset: int = 0) -> dict:
    """一覧/検索。q=FTS、semantic=ベクトル、無指定は新しい順。"""
    conn = get_connection()
    try:
        if semantic:
            try:
                vector = embed_text(semantic)
            except EmbeddingUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error))
            rows = conn.execute(
                "SELECT bgm_id FROM bgm_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
                (serialize_float32(vector), SEMANTIC_KNN_K),
            ).fetchall()
            ordered = [row["bgm_id"] for row in rows]
        elif q:
            match = _fts_match_expression(q)
            rows = conn.execute(
                "SELECT bgm_id FROM bgm_fts WHERE bgm_fts MATCH ? ORDER BY rank",
                (match,),
            ).fetchall()
            ordered = [row["bgm_id"] for row in rows]
        else:
            rows = conn.execute("SELECT id FROM bgm ORDER BY created_at DESC").fetchall()
            ordered = [row["id"] for row in rows]

        total = len(ordered)
        page = ordered[offset : offset + limit]
        items = []
        for bgm_id in page:
            row = conn.execute("SELECT * FROM bgm WHERE id = ?", (bgm_id,)).fetchone()
            if row is not None:
                items.append(_bgm_response(conn, row))
        return {"bgm": items, "total": total}
    finally:
        conn.close()


@router.post("/bgm", status_code=201)
def create_bgm(payload: BgmInput) -> dict:
    conn = get_connection()
    try:
        bgm_id = str(uuid.uuid4())
        now = _now()
        conn.execute(
            "INSERT INTO bgm (id, title, description, media_path, created_at, updated_at)"
            " VALUES (?, ?, ?, NULL, ?, ?)",
            (bgm_id, payload.title, payload.description, now, now),
        )
        _refresh_fts(conn, bgm_id, payload.title, payload.description)
        _refresh_embedding(conn, bgm_id, payload.description)
        conn.commit()
        return _bgm_response(conn, _get_bgm_row(conn, bgm_id))
    finally:
        conn.close()


@router.get("/bgm/{bgm_id}")
def get_bgm(bgm_id: str) -> dict:
    conn = get_connection()
    try:
        return _bgm_response(conn, _get_bgm_row(conn, bgm_id))
    finally:
        conn.close()


@router.put("/bgm/{bgm_id}")
def update_bgm(bgm_id: str, payload: BgmInput) -> dict:
    conn = get_connection()
    try:
        current = _get_bgm_row(conn, bgm_id)
        description_changed = current["description"] != payload.description
        conn.execute(
            "UPDATE bgm SET title = ?, description = ?, updated_at = ? WHERE id = ?",
            (payload.title, payload.description, _now(), bgm_id),
        )
        _refresh_fts(conn, bgm_id, payload.title, payload.description)
        if description_changed or not _has_embedding(conn, bgm_id):
            _refresh_embedding(conn, bgm_id, payload.description)
        conn.commit()
        return _bgm_response(conn, _get_bgm_row(conn, bgm_id))
    finally:
        conn.close()


@router.delete("/bgm/{bgm_id}")
def delete_bgm(bgm_id: str) -> dict:
    conn = get_connection()
    try:
        _get_bgm_row(conn, bgm_id)
        conn.execute("DELETE FROM bgm WHERE id = ?", (bgm_id,))
        conn.execute("DELETE FROM bgm_fts WHERE bgm_id = ?", (bgm_id,))
        conn.execute("DELETE FROM bgm_vec WHERE bgm_id = ?", (bgm_id,))
        conn.commit()
        # 音声ファイルは残す（同一ハッシュを他 BGM が共有し得るため）
        return {"ok": True}
    finally:
        conn.close()


@router.post("/bgm/{bgm_id}/media")
async def upload_bgm_media(bgm_id: str, file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="empty file")
    try:
        media_relative = save_audio(data, file.filename or "audio.mp3")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    conn = get_connection()
    try:
        _get_bgm_row(conn, bgm_id)
        conn.execute(
            "UPDATE bgm SET media_path = ?, updated_at = ? WHERE id = ?",
            (media_relative, _now(), bgm_id),
        )
        conn.commit()
        return _bgm_response(conn, _get_bgm_row(conn, bgm_id))
    finally:
        conn.close()


@router.get("/bgm/{bgm_id}/file")
def get_bgm_file(bgm_id: str) -> FileResponse:
    conn = get_connection()
    try:
        row = _get_bgm_row(conn, bgm_id)
    finally:
        conn.close()

    media_relative = row["media_path"]
    if not media_relative:
        raise HTTPException(status_code=404, detail="bgm has no audio")
    media_path = resolve_path(media_relative)
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="audio file not found")
    return FileResponse(media_path)
