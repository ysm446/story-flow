"""Theater / Stories: 生成済み物語の取得・削除（spec §8.3）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.db.database import get_connection

router = APIRouter(tags=["stories"])


@router.get("/stories")
def list_stories(workspace_id: str | None = None) -> dict:
    conn = get_connection()
    try:
        if workspace_id:
            rows = conn.execute(
                "SELECT * FROM stories WHERE workspace_id = ? ORDER BY created_at DESC",
                (workspace_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM stories ORDER BY created_at DESC").fetchall()
        return {"stories": [dict(row) for row in rows]}
    finally:
        conn.close()


@router.get("/stories/{story_id}")
def get_story(story_id: str) -> dict:
    conn = get_connection()
    try:
        story = conn.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
        if story is None:
            raise HTTPException(status_code=404, detail="story not found")
        scenes = conn.execute(
            "SELECT * FROM story_scenes WHERE story_id = ? ORDER BY position",
            (story_id,),
        ).fetchall()
        return {**dict(story), "scenes": [dict(row) for row in scenes]}
    finally:
        conn.close()


@router.delete("/stories/{story_id}")
def delete_story(story_id: str) -> dict:
    conn = get_connection()
    try:
        cursor = conn.execute("DELETE FROM stories WHERE id = ?", (story_id,))
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="story not found")
        return {"ok": True}
    finally:
        conn.close()
