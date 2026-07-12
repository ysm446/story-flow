"""ワークスペース: 作品単位の編集状態（Compose グラフ + 生成設定）の CRUD。

Vault（cards）は全ワークスペース共通。graph にはカード ID と座標だけを保存し、
カード本体は保存しない（読み込み側が cards から再構成する）。
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.db.database import get_connection

router = APIRouter(tags=["workspaces"])

EMPTY_GRAPH = {"nodes": [], "edges": []}


class WorkspaceCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class LoreMemo(BaseModel):
    """背景設定メモ（作品の恒久設定 = canon）。清書時に全文注入する（goals.md 設定資料 RAG の Phase 1）。"""

    id: str
    title: str = Field(max_length=60)
    body: str = ""


class WorkspaceUpdateInput(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    graph: dict | None = None
    plot: str | None = None
    target_tone: Literal["happy", "bad", "bitter", "neutral"] | None = None
    clear_target_tone: bool = False  # target_tone を NULL に戻すためのフラグ
    prompt_preset_id: str | None = None
    clear_prompt_preset: bool = False
    scene_length: Literal["short", "standard", "long"] | None = None
    clear_scene_length: bool = False
    gap_route: Literal["direct", "detour"] | None = None  # おまかせの経路（NULL/direct = 直行、detour = 寄り道）
    clear_gap_route: bool = False
    folder_ids: list[str] | None = None  # この作品で使うフォルダ（None = 変更なし。ルートは常時使用）
    lore: list[LoreMemo] | None = None  # 背景設定メモ（None = 変更なし）


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_workspace(row: sqlite3.Row) -> dict:
    workspace = dict(row)
    try:
        workspace["graph"] = json.loads(workspace["graph"])
    except (json.JSONDecodeError, TypeError):
        workspace["graph"] = dict(EMPTY_GRAPH)
    try:
        folder_ids = json.loads(workspace.get("folder_ids") or "[]")
        workspace["folder_ids"] = folder_ids if isinstance(folder_ids, list) else []
    except (json.JSONDecodeError, TypeError):
        workspace["folder_ids"] = []
    try:
        lore = json.loads(workspace.get("lore") or "[]")
        workspace["lore"] = lore if isinstance(lore, list) else []
    except (json.JSONDecodeError, TypeError):
        workspace["lore"] = []
    return workspace


def _get_row(conn: sqlite3.Connection, workspace_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return row


@router.get("/workspaces")
def list_workspaces() -> dict:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT w.id, w.name, w.updated_at, w.created_at,"
            " (SELECT COUNT(*) FROM stories s WHERE s.workspace_id = w.id) AS story_count"
            " FROM workspaces w ORDER BY w.updated_at DESC"
        ).fetchall()
        return {"workspaces": [dict(row) for row in rows]}
    finally:
        conn.close()


@router.post("/workspaces", status_code=201)
def create_workspace(payload: WorkspaceCreateInput) -> dict:
    conn = get_connection()
    try:
        workspace_id = str(uuid.uuid4())
        now = _now()
        conn.execute(
            "INSERT INTO workspaces (id, name, graph, plot, target_tone, prompt_preset_id, created_at, updated_at)"
            " VALUES (?, ?, ?, '', NULL, NULL, ?, ?)",
            (workspace_id, payload.name.strip(), json.dumps(EMPTY_GRAPH), now, now),
        )
        conn.commit()
        return _row_to_workspace(_get_row(conn, workspace_id))
    finally:
        conn.close()


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: str) -> dict:
    conn = get_connection()
    try:
        return _row_to_workspace(_get_row(conn, workspace_id))
    finally:
        conn.close()


@router.put("/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, payload: WorkspaceUpdateInput) -> dict:
    conn = get_connection()
    try:
        current = _get_row(conn, workspace_id)
        name = payload.name.strip() if payload.name and payload.name.strip() else current["name"]
        graph = json.dumps(payload.graph, ensure_ascii=False) if payload.graph is not None else current["graph"]
        plot = payload.plot if payload.plot is not None else current["plot"]
        if payload.clear_target_tone:
            target_tone = None
        else:
            target_tone = payload.target_tone if payload.target_tone is not None else current["target_tone"]
        if payload.clear_prompt_preset:
            prompt_preset_id = None
        else:
            prompt_preset_id = (
                payload.prompt_preset_id if payload.prompt_preset_id is not None else current["prompt_preset_id"]
            )
        if payload.clear_scene_length:
            scene_length = None
        else:
            scene_length = payload.scene_length if payload.scene_length is not None else current["scene_length"]
        if payload.clear_gap_route:
            gap_route = None
        else:
            gap_route = payload.gap_route if payload.gap_route is not None else current["gap_route"]
        folder_ids = (
            json.dumps(payload.folder_ids) if payload.folder_ids is not None else (current["folder_ids"] or "[]")
        )
        lore = (
            json.dumps([memo.model_dump() for memo in payload.lore], ensure_ascii=False)
            if payload.lore is not None
            else (current["lore"] or "[]")
        )
        conn.execute(
            "UPDATE workspaces SET name = ?, graph = ?, plot = ?, target_tone = ?, prompt_preset_id = ?,"
            " scene_length = ?, gap_route = ?, folder_ids = ?, lore = ?, updated_at = ? WHERE id = ?",
            (name, graph, plot, target_tone, prompt_preset_id, scene_length, gap_route, folder_ids, lore, _now(), workspace_id),
        )
        conn.commit()
        return _row_to_workspace(_get_row(conn, workspace_id))
    finally:
        conn.close()


@router.post("/workspaces/{workspace_id}/duplicate", status_code=201)
def duplicate_workspace(workspace_id: str, payload: WorkspaceCreateInput) -> dict:
    conn = get_connection()
    try:
        source = _get_row(conn, workspace_id)
        new_id = str(uuid.uuid4())
        now = _now()
        conn.execute(
            "INSERT INTO workspaces"
            " (id, name, graph, plot, target_tone, prompt_preset_id, scene_length, gap_route, folder_ids, lore,"
            " created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                new_id,
                payload.name.strip(),
                source["graph"],
                source["plot"],
                source["target_tone"],
                source["prompt_preset_id"],
                source["scene_length"],
                source["gap_route"],
                source["folder_ids"] or "[]",
                source["lore"] or "[]",
                now,
                now,
            ),
        )
        conn.commit()
        return _row_to_workspace(_get_row(conn, new_id))
    finally:
        conn.close()


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict:
    conn = get_connection()
    try:
        _get_row(conn, workspace_id)
        # 生成済みの物語は残す（紐付けだけ外す）
        conn.execute("UPDATE stories SET workspace_id = NULL WHERE workspace_id = ?", (workspace_id,))
        conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
