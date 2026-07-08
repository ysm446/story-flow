"""Generate: 逐次清書パイプラインの実行（spec §8.2）。

POST /generate は SSE（text/event-stream）でシーン単位に push する。
イベントは data 行の JSON: {"type": "scene" | "done" | "error", ...}
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.db.database import get_connection
from backend.services.llm import WRITER_BASE_URL, LlmError
from backend.services.pipeline import generate_stream
from backend.services.prompts import effective_prompt, preset_content

router = APIRouter(tags=["generate"])


class GenerateInput(BaseModel):
    card_ids: list[str] = Field(min_length=1)
    plot: str = ""
    target_tone: Literal["happy", "bad", "bitter", "neutral"] | None = None
    writer_base_url: str | None = None  # 未指定なら環境変数 STORY_FLOW_WRITER_URL
    workspace_id: str | None = None  # 生成元ワークスペース（story に紐付く）
    prompt_preset_id: str | None = None  # ワークスペースの清書プロンプト。無効/未指定なら既定側


def _load_cards(card_ids: list[str]) -> list[dict]:
    conn = get_connection()
    try:
        cards = []
        for card_id in card_ids:
            row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail=f"card not found: {card_id}")
            cards.append(dict(row))
        return cards
    finally:
        conn.close()


@router.post("/generate")
def generate_story(payload: GenerateInput) -> StreamingResponse:
    cards = _load_cards(payload.card_ids)
    writer_base_url = payload.writer_base_url or WRITER_BASE_URL
    system_prompt = None
    if payload.prompt_preset_id:
        system_prompt = preset_content("writer", payload.prompt_preset_id)
    if system_prompt is None:
        system_prompt = effective_prompt("writer")

    def event_stream():
        try:
            for event in generate_stream(
                cards=cards,
                plot=payload.plot,
                target_tone=payload.target_tone,
                writer_base_url=writer_base_url,
                system_prompt=system_prompt,
                workspace_id=payload.workspace_id,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except LlmError as error:
            yield f"data: {json.dumps({'type': 'error', 'message': str(error)}, ensure_ascii=False)}\n\n"
        except Exception as error:  # 予期しない失敗もクライアントに通知する
            yield f"data: {json.dumps({'type': 'error', 'message': f'unexpected: {error}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/generate/gap", status_code=501)
def generate_gap() -> dict:
    """単一穴埋めステップ fill_gap の対話実行（v1.5）。"""
    raise HTTPException(status_code=501, detail="not implemented yet (v1.5)")
