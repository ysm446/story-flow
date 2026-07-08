"""Generate: 逐次清書パイプラインの実行（spec §8.2）。

フェーズ 2 で本実装する。POST /generate は SSE でシーン単位に push する予定。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["generate"])


@router.post("/generate", status_code=501)
def generate_story() -> dict:
    """composition(アンカー列) + plot + target_tone を受けて逐次生成する（フェーズ 2）。"""
    raise HTTPException(status_code=501, detail="not implemented yet (v1 Generate)")


@router.post("/generate/gap", status_code=501)
def generate_gap() -> dict:
    """単一穴埋めステップ fill_gap の対話実行（v1.5）。"""
    raise HTTPException(status_code=501, detail="not implemented yet (v1.5)")
