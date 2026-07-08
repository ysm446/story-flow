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


class SlotInput(BaseModel):
    card_id: str
    instruction: str | None = None  # この作品でのこのシーンへの追加指示（ノードのプロパティ）


class GenerateInput(BaseModel):
    slots: list[SlotInput] = Field(min_length=1)
    plot: str = ""
    target_tone: Literal["happy", "bad", "bitter", "neutral"] | None = None
    writer_base_url: str | None = None  # 未指定なら環境変数 STORY_FLOW_WRITER_URL
    workspace_id: str | None = None  # 生成元ワークスペース（story に紐付く）
    prompt_preset_id: str | None = None  # ワークスペースの清書プロンプト。無効/未指定なら既定側
    scene_length: Literal["short", "standard", "long"] | None = None  # シーンの目安の長さ


def _load_slots(slot_inputs: list[SlotInput]) -> list[dict]:
    conn = get_connection()
    try:
        slots = []
        for slot in slot_inputs:
            row = conn.execute("SELECT * FROM cards WHERE id = ?", (slot.card_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail=f"card not found: {slot.card_id}")
            slots.append({"card": dict(row), "instruction": slot.instruction})
        return slots
    finally:
        conn.close()


@router.post("/generate")
def generate_story(payload: GenerateInput) -> StreamingResponse:
    slots = _load_slots(payload.slots)
    writer_base_url = payload.writer_base_url or WRITER_BASE_URL
    system_prompt = None
    if payload.prompt_preset_id:
        system_prompt = preset_content("writer", payload.prompt_preset_id)
    if system_prompt is None:
        system_prompt = effective_prompt("writer")

    def event_stream():
        try:
            for event in generate_stream(
                slots=slots,
                plot=payload.plot,
                target_tone=payload.target_tone,
                writer_base_url=writer_base_url,
                system_prompt=system_prompt,
                workspace_id=payload.workspace_id,
                scene_length=payload.scene_length,
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
