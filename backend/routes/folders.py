"""Vault のフォルダ階層（2026-07-10 追加。image-assistant のライブラリを参考）。

- ルート（cards.folder_id IS NULL）= 全作品共有の共通素材。フォルダに入れたカードだけが
  Compose の「使うフォルダ」選択の対象になる。
- parent_id で無制限ネスト。移動時はサーバ側でも循環参照を拒否する。
- 削除時はフォルダを「解体」する: 子フォルダと中のカードを削除フォルダの親へ昇格
  （トップレベルならルートへ）。カード自体は消さない。
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.db.database import get_connection

router = APIRouter(tags=["folders"])


class FolderCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    parent_id: str | None = None


class FolderRenameInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class FolderMoveInput(BaseModel):
    parent_id: str | None = None  # None = トップレベルへ


class FolderReorderInput(BaseModel):
    ids: list[str] = Field(min_length=1)  # 同一階層の兄弟をこの順に並べ替える


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_row(conn: sqlite3.Connection, folder_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="folder not found")
    return row


def _is_descendant(conn: sqlite3.Connection, folder_id: str, ancestor_id: str) -> bool:
    """folder_id が ancestor_id の子孫（または本人）かどうか。循環参照チェック用。"""
    current: str | None = folder_id
    seen: set[str] = set()
    while current is not None and current not in seen:
        if current == ancestor_id:
            return True
        seen.add(current)
        row = conn.execute("SELECT parent_id FROM folders WHERE id = ?", (current,)).fetchone()
        current = row["parent_id"] if row is not None else None
    return False


def expand_folder_ids(conn: sqlite3.Connection, folder_ids: list[str]) -> set[str]:
    """指定フォルダのサブツリー（子孫含む）の ID 集合。Compose の「使うフォルダ」解決用。"""
    children_of: dict[str | None, list[str]] = {}
    for row in conn.execute("SELECT id, parent_id FROM folders").fetchall():
        children_of.setdefault(row["parent_id"], []).append(row["id"])
    result: set[str] = set()
    stack = [folder_id for folder_id in folder_ids if folder_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children_of.get(current, []))
    return result


@router.get("/folders")
def list_folders() -> dict:
    """フラット配列（直下のカード数付き）。ツリー化はクライアント側で行う。"""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT f.*, (SELECT COUNT(*) FROM cards c WHERE c.folder_id = f.id) AS card_count"
            " FROM folders f ORDER BY f.sort_order, f.created_at"
        ).fetchall()
        root_count = conn.execute("SELECT COUNT(*) FROM cards WHERE folder_id IS NULL").fetchone()[0]
        return {"folders": [dict(row) for row in rows], "root_count": root_count}
    finally:
        conn.close()


@router.post("/folders", status_code=201)
def create_folder(payload: FolderCreateInput) -> dict:
    conn = get_connection()
    try:
        if payload.parent_id is not None:
            _get_row(conn, payload.parent_id)
        folder_id = str(uuid.uuid4())
        now = _now()
        # 同一階層の末尾に追加
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM folders WHERE parent_id IS ?",
            (payload.parent_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO folders (id, name, parent_id, sort_order, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (folder_id, payload.name.strip(), payload.parent_id, max_order + 1, now, now),
        )
        conn.commit()
        return dict(_get_row(conn, folder_id))
    finally:
        conn.close()


@router.put("/folders/{folder_id}")
def rename_folder(folder_id: str, payload: FolderRenameInput) -> dict:
    conn = get_connection()
    try:
        _get_row(conn, folder_id)
        conn.execute(
            "UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
            (payload.name.strip(), _now(), folder_id),
        )
        conn.commit()
        return dict(_get_row(conn, folder_id))
    finally:
        conn.close()


@router.put("/folders/{folder_id}/parent")
def move_folder(folder_id: str, payload: FolderMoveInput) -> dict:
    """フォルダの入れ子先を変更する（None = トップレベル化）。循環参照は 400。"""
    conn = get_connection()
    try:
        _get_row(conn, folder_id)
        if payload.parent_id is not None:
            _get_row(conn, payload.parent_id)
            if _is_descendant(conn, payload.parent_id, folder_id):
                raise HTTPException(status_code=400, detail="自分自身または子孫の中へは移動できません")
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM folders WHERE parent_id IS ?",
            (payload.parent_id,),
        ).fetchone()[0]
        conn.execute(
            "UPDATE folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
            (payload.parent_id, max_order + 1, _now(), folder_id),
        )
        conn.commit()
        return dict(_get_row(conn, folder_id))
    finally:
        conn.close()


@router.post("/folders/reorder")
def reorder_folders(payload: FolderReorderInput) -> dict:
    """同一階層の兄弟 ID 配列を受け取り、その順に sort_order を振り直す。"""
    conn = get_connection()
    try:
        for order, folder_id in enumerate(payload.ids, start=1):
            conn.execute(
                "UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?",
                (order, _now(), folder_id),
            )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict:
    """フォルダを解体する: 子フォルダと中のカードを親へ昇格（カードは消さない）。"""
    conn = get_connection()
    try:
        row = _get_row(conn, folder_id)
        parent_id = row["parent_id"]
        now = _now()
        conn.execute(
            "UPDATE folders SET parent_id = ?, updated_at = ? WHERE parent_id = ?",
            (parent_id, now, folder_id),
        )
        conn.execute(
            "UPDATE cards SET folder_id = ?, updated_at = ? WHERE folder_id = ?",
            (parent_id, now, folder_id),
        )
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
