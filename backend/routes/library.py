"""ライブラリ（作品バンドルフォルダ）の状態取得・新規作成・切り替え。

ライブラリ = DB + media/ + thumbs/ + prompts.json。丸ごとコピー/共有できる。
開いているライブラリの場所は data/settings.json（マシン設定）に永続化する。
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.db.database import DB_FILENAME, get_library_root, is_library_open, open_library

router = APIRouter(tags=["library"])


class LibraryOpenInput(BaseModel):
    path: str = Field(min_length=1)
    mode: Literal["open", "create"]


@router.get("/library")
def get_library() -> dict:
    return {
        "open": is_library_open(),
        "root": str(get_library_root()) if is_library_open() else None,
    }


@router.post("/library/open")
def open_library_route(payload: LibraryOpenInput) -> dict:
    root = Path(payload.path)

    if payload.mode == "open":
        if not (root / DB_FILENAME).exists():
            raise HTTPException(
                status_code=404,
                detail=f"このフォルダにライブラリ（{DB_FILENAME}）が見つかりません。「新規作成」を使ってください。",
            )
    else:  # create（既存ライブラリがあった場合はそのまま開く）
        if root.exists() and not root.is_dir():
            raise HTTPException(status_code=422, detail="フォルダではありません。")

    try:
        open_library(root)
    except OSError as error:
        raise HTTPException(status_code=422, detail=f"ライブラリを開けませんでした: {error}")

    return {"open": True, "root": str(get_library_root())}
