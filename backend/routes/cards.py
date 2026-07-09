"""Vault: シーンカードの CRUD・検索・メディア・在庫密度（spec §8.1）。

- 埋め込みはブリーフに対して計算し card_vec（sqlite-vec）に upsert する。
  埋め込みサーバ未起動時は埋め込み無しで保存を続行する（has_embedding=false）。
- cards_fts は title / brief / tags（空白連結）をコードで同期する。
- メディアは data/library/media/ に sha256 命名で保存し、DB には相対パスのみ持つ。
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlite_vec import serialize_float32

from backend.db.database import EMBED_DIM, get_connection, resolve_path
from backend.services.embedding import EmbeddingUnavailable, embed_text
from backend.services.media import save_media, thumb_relative_for

router = APIRouter(tags=["vault"])

ROLES = ("intro", "rising", "turn", "climax", "ending")
TONES = ("happy", "bad", "bitter", "neutral")
TAG_TYPES = ("place", "time", "mood")

SEMANTIC_KNN_K = 200  # ベクトル検索の一次取得件数（フィルタ前）


class TagInput(BaseModel):
    tag_type: Literal["place", "time", "mood"]
    value: str = Field(min_length=1, max_length=50)


class CardInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    brief: str = Field(min_length=1, max_length=500)
    role: Literal["intro", "rising", "turn", "climax", "ending"] | None = None  # None = 自動/汎用
    tone: Literal["happy", "bad", "bitter", "neutral"] | None = None
    tags: list[TagInput] = Field(default_factory=list)


class CardFolderInput(BaseModel):
    folder_id: str | None = None  # None = ルート（全作品共有）へ


def _validated_folder_id(conn: sqlite3.Connection, folder_id: str | None) -> str | None:
    if folder_id is None:
        return None
    row = conn.execute("SELECT id FROM folders WHERE id = ?", (folder_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="folder not found")
    return folder_id


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_tags(conn: sqlite3.Connection, card_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT tag_type, value FROM card_tags WHERE card_id = ? ORDER BY tag_type, value",
        (card_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _has_embedding(conn: sqlite3.Connection, card_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM card_vec WHERE card_id = ?", (card_id,)).fetchone()
    return row is not None


def _card_response(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    card = dict(row)
    card["tags"] = _load_tags(conn, card["id"])
    card["has_embedding"] = _has_embedding(conn, card["id"])
    return card


def _get_card_row(conn: sqlite3.Connection, card_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="card not found")
    return row


def _replace_tags(conn: sqlite3.Connection, card_id: str, tags: list[TagInput]) -> None:
    conn.execute("DELETE FROM card_tags WHERE card_id = ?", (card_id,))
    seen: set[tuple[str, str]] = set()
    for tag in tags:
        key = (tag.tag_type, tag.value.strip())
        if not key[1] or key in seen:
            continue
        seen.add(key)
        conn.execute(
            "INSERT INTO card_tags (card_id, tag_type, value) VALUES (?, ?, ?)",
            (card_id, key[0], key[1]),
        )


def _refresh_fts(conn: sqlite3.Connection, card_id: str, title: str, brief: str) -> None:
    tags = " ".join(row["value"] for row in _load_tags(conn, card_id))
    conn.execute("DELETE FROM cards_fts WHERE card_id = ?", (card_id,))
    conn.execute(
        "INSERT INTO cards_fts (card_id, title, brief, tags) VALUES (?, ?, ?, ?)",
        (card_id, title, brief, tags),
    )


def _compute_embedding(brief: str) -> bytes | None:
    """ブリーフの埋め込みを計算する。埋め込めない場合は None（保存は続行する）。

    HTTP 呼び出しで時間がかかる（最長 EMBED_TIMEOUT）ため、必ず書き込み
    トランザクションの**外**で呼ぶこと。書き込みロックを持ったまま待つと、
    併走する保存が database is locked になる。
    """
    try:
        vector = embed_text(brief)
    except EmbeddingUnavailable as error:
        print(f"[vault] embedding skipped: {error}")
        return None
    if len(vector) != EMBED_DIM:
        print(f"[vault] embedding dim mismatch: got {len(vector)}, expected {EMBED_DIM}")
        return None
    return serialize_float32(vector)


def _store_embedding(conn: sqlite3.Connection, card_id: str, embedding: bytes) -> None:
    conn.execute("DELETE FROM card_vec WHERE card_id = ?", (card_id,))
    conn.execute("INSERT INTO card_vec (card_id, embedding) VALUES (?, ?)", (card_id, embedding))


def _fts_match_expression(query: str) -> str:
    tokens = [token.replace('"', '""') for token in query.split() if token]
    return " ".join(f'"{token}"' for token in tokens)


def _knn_card_ids(conn: sqlite3.Connection, vector: list[float], k: int) -> list[str]:
    rows = conn.execute(
        "SELECT card_id FROM card_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
        (serialize_float32(vector), k),
    ).fetchall()
    return [row["card_id"] for row in rows]


# --- 固定パスは /cards/{card_id} より先に定義する ---


@router.get("/cards/similar")
def similar_cards(card_id: str | None = None, text: str | None = None, k: int = 8) -> dict:
    """類似カード検索（作者補助: 重複検知・候補サジェスト）。"""
    if card_id is None and text is None:
        raise HTTPException(status_code=422, detail="card_id or text is required")

    conn = get_connection()
    try:
        if card_id is not None:
            row = conn.execute("SELECT embedding FROM card_vec WHERE card_id = ?", (card_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="card has no embedding yet")
            query: bytes | list[float] = row["embedding"]
        else:
            try:
                query = embed_text(text or "")
            except EmbeddingUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error))

        query_param = query if isinstance(query, bytes) else serialize_float32(query)
        rows = conn.execute(
            "SELECT card_id, distance FROM card_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (query_param, k + 1),
        ).fetchall()

        results = []
        for row in rows:
            if row["card_id"] == card_id:
                continue  # 自分自身は除外
            card_row = conn.execute("SELECT * FROM cards WHERE id = ?", (row["card_id"],)).fetchone()
            if card_row is None:
                continue
            card = _card_response(conn, card_row)
            card["distance"] = row["distance"]
            results.append(card)
        return {"cards": results[:k]}
    finally:
        conn.close()


@router.get("/vault/stats")
def vault_stats() -> dict:
    """ロール別枚数・タグ分布・埋め込み済み枚数（在庫密度 / 素材マップ）。"""
    conn = get_connection()
    try:
        by_role = {role: 0 for role in ROLES}
        unassigned = 0
        for row in conn.execute("SELECT role, COUNT(*) AS count FROM cards GROUP BY role"):
            if row["role"] is None:
                unassigned = row["count"]
            else:
                by_role[row["role"]] = row["count"]

        embedded = conn.execute(
            "SELECT COUNT(*) AS count FROM card_vec WHERE card_id IN (SELECT id FROM cards)"
        ).fetchone()["count"]

        tags: dict[str, list[dict]] = {tag_type: [] for tag_type in TAG_TYPES}
        for row in conn.execute(
            "SELECT tag_type, value, COUNT(*) AS count FROM card_tags GROUP BY tag_type, value ORDER BY count DESC, value"
        ):
            tags[row["tag_type"]].append({"value": row["value"], "count": row["count"]})

        return {
            "total": sum(by_role.values()) + unassigned,
            "by_role": by_role,
            "unassigned": unassigned,
            "embedded": embedded,
            "tags": tags,
        }
    finally:
        conn.close()


@router.get("/cards")
def list_cards(
    q: str | None = None,
    semantic: str | None = None,
    role: str | None = None,
    place: str | None = None,
    time: str | None = None,
    mood: str | None = None,
    folder: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """一覧/検索。q=FTS、semantic=ベクトル、role/place/time/mood/folder=フィルタ。

    folder: 省略 = 全部、"root" = ルート（folder_id IS NULL）、それ以外 = そのフォルダ直下。
    """
    conn = get_connection()
    try:
        # 1. role / タグ / フォルダでフィルタした許可 ID 集合
        sql = "SELECT id FROM cards WHERE 1=1"
        params: list = []
        if role:
            sql += " AND role = ?"
            params.append(role)
        if folder == "root":
            sql += " AND folder_id IS NULL"
        elif folder:
            sql += " AND folder_id = ?"
            params.append(folder)
        for tag_type, value in (("place", place), ("time", time), ("mood", mood)):
            if value:
                sql += " AND id IN (SELECT card_id FROM card_tags WHERE tag_type = ? AND value = ?)"
                params.extend([tag_type, value])
        allowed = [row["id"] for row in conn.execute(sql, params)]
        allowed_set = set(allowed)

        # 2. 並び順の決定（semantic > q > created_at desc）
        if semantic:
            try:
                vector = embed_text(semantic)
            except EmbeddingUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error))
            ordered = [cid for cid in _knn_card_ids(conn, vector, SEMANTIC_KNN_K) if cid in allowed_set]
        elif q:
            match = _fts_match_expression(q)
            rows = conn.execute(
                "SELECT card_id FROM cards_fts WHERE cards_fts MATCH ? ORDER BY rank",
                (match,),
            ).fetchall()
            ordered = [row["card_id"] for row in rows if row["card_id"] in allowed_set]
        else:
            rows = conn.execute(
                f"SELECT id FROM cards WHERE id IN ({','.join('?' * len(allowed))}) ORDER BY created_at DESC",
                allowed,
            ).fetchall() if allowed else []
            ordered = [row["id"] for row in rows]

        total = len(ordered)
        page = ordered[offset : offset + limit]
        cards = []
        for cid in page:
            row = conn.execute("SELECT * FROM cards WHERE id = ?", (cid,)).fetchone()
            if row is not None:
                cards.append(_card_response(conn, row))
        return {"cards": cards, "total": total}
    finally:
        conn.close()


@router.post("/cards", status_code=201)
def create_card(payload: CardInput) -> dict:
    embedding = _compute_embedding(payload.brief)  # トランザクション外で先に計算
    conn = get_connection()
    try:
        card_id = str(uuid.uuid4())
        now = _now()
        conn.execute(
            "INSERT INTO cards (id, title, brief, media_path, media_type, role, tone, created_at, updated_at)"
            " VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)",
            (card_id, payload.title, payload.brief, payload.role, payload.tone, now, now),
        )
        _replace_tags(conn, card_id, payload.tags)
        _refresh_fts(conn, card_id, payload.title, payload.brief)
        if embedding is not None:
            _store_embedding(conn, card_id, embedding)
        conn.commit()
        return _card_response(conn, _get_card_row(conn, card_id))
    finally:
        conn.close()


@router.get("/cards/{card_id}")
def get_card(card_id: str) -> dict:
    conn = get_connection()
    try:
        return _card_response(conn, _get_card_row(conn, card_id))
    finally:
        conn.close()


@router.put("/cards/{card_id}")
def update_card(card_id: str, payload: CardInput) -> dict:
    conn = get_connection()
    try:
        current = _get_card_row(conn, card_id)
        brief_changed = current["brief"] != payload.brief
        # ブリーフ変更時のみ再埋め込み（spec §8.1）。未埋め込みならリトライを兼ねて再計算。
        # 計算（HTTP）は書き込みの前 = トランザクション外で済ませる
        needs_embedding = brief_changed or not _has_embedding(conn, card_id)
        embedding = _compute_embedding(payload.brief) if needs_embedding else None
        conn.execute(
            "UPDATE cards SET title = ?, brief = ?, role = ?, tone = ?, updated_at = ? WHERE id = ?",
            (payload.title, payload.brief, payload.role, payload.tone, _now(), card_id),
        )
        _replace_tags(conn, card_id, payload.tags)
        _refresh_fts(conn, card_id, payload.title, payload.brief)
        if embedding is not None:
            _store_embedding(conn, card_id, embedding)
        conn.commit()
        return _card_response(conn, _get_card_row(conn, card_id))
    finally:
        conn.close()


@router.post("/cards/{card_id}/folder")
def assign_card_folder(card_id: str, payload: CardFolderInput) -> dict:
    """カードのフォルダ所属を変更する（None = ルートへ）。"""
    conn = get_connection()
    try:
        _get_card_row(conn, card_id)
        folder_id = _validated_folder_id(conn, payload.folder_id)
        conn.execute(
            "UPDATE cards SET folder_id = ?, updated_at = ? WHERE id = ?",
            (folder_id, _now(), card_id),
        )
        conn.commit()
        return _card_response(conn, _get_card_row(conn, card_id))
    finally:
        conn.close()


@router.delete("/cards/{card_id}")
def delete_card(card_id: str) -> dict:
    conn = get_connection()
    try:
        _get_card_row(conn, card_id)
        conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))  # card_tags は CASCADE
        conn.execute("DELETE FROM cards_fts WHERE card_id = ?", (card_id,))
        conn.execute("DELETE FROM card_vec WHERE card_id = ?", (card_id,))
        conn.commit()
        # メディアファイルは残す（同一ハッシュを他カードが共有し得るため）
        return {"ok": True}
    finally:
        conn.close()


@router.post("/cards/{card_id}/media")
async def upload_media(card_id: str, file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="empty file")
    try:
        media_relative, media_type = save_media(data, file.filename or "upload.bin")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    conn = get_connection()
    try:
        _get_card_row(conn, card_id)
        conn.execute(
            "UPDATE cards SET media_path = ?, media_type = ?, updated_at = ? WHERE id = ?",
            (media_relative, media_type, _now(), card_id),
        )
        conn.commit()
        return _card_response(conn, _get_card_row(conn, card_id))
    finally:
        conn.close()


@router.get("/cards/{card_id}/file")
def get_card_file(card_id: str, thumb: int = 0) -> FileResponse:
    conn = get_connection()
    try:
        row = _get_card_row(conn, card_id)
    finally:
        conn.close()

    media_relative = row["media_path"]
    if not media_relative:
        raise HTTPException(status_code=404, detail="card has no media")

    if thumb:
        thumb_path = resolve_path(thumb_relative_for(media_relative))
        if thumb_path.exists():
            return FileResponse(thumb_path)
        # サムネイル未生成の画像は原本で代替する
        if row["media_type"] != "image":
            raise HTTPException(status_code=404, detail="thumbnail not available")

    media_path = resolve_path(media_relative)
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="media file not found")
    return FileResponse(media_path)
