"""Vault: シーンカードの CRUD・検索・在庫密度（spec §8.1）。

フェーズ 1 で本実装する。現状は一覧と stats のみ動く骨格。
- POST /cards は埋め込み計算（services/embedding.py）と cards_fts 投入を伴う（未実装）
- メディアアップロードは data/library/media/ への保存 + サムネイル生成（未実装）
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.db.database import get_connection

router = APIRouter(tags=["vault"])

ROLES = ("intro", "rising", "turn", "climax", "ending")


@router.get("/cards")
def list_cards() -> dict:
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM cards ORDER BY created_at DESC").fetchall()
        return {"cards": [dict(row) for row in rows]}
    finally:
        conn.close()


@router.get("/cards/{card_id}")
def get_card(card_id: str) -> dict:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="card not found")
        return dict(row)
    finally:
        conn.close()


@router.get("/vault/stats")
def vault_stats() -> dict:
    conn = get_connection()
    try:
        rows = conn.execute("SELECT role, COUNT(*) AS count FROM cards GROUP BY role").fetchall()
        by_role = {role: 0 for role in ROLES}
        for row in rows:
            by_role[row["role"]] = row["count"]
        return {"total": sum(by_role.values()), "by_role": by_role}
    finally:
        conn.close()


# --- フェーズ 1 で実装（501 スタブ） ---


@router.post("/cards", status_code=501)
def create_card() -> dict:
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Vault)")


@router.put("/cards/{card_id}", status_code=501)
def update_card(card_id: str) -> dict:
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Vault)")


@router.delete("/cards/{card_id}", status_code=501)
def delete_card(card_id: str) -> dict:
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Vault)")


@router.post("/cards/{card_id}/media", status_code=501)
def upload_media(card_id: str) -> dict:
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Vault)")


@router.get("/cards/similar", status_code=501)
def similar_cards() -> dict:
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Vault)")
