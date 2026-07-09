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
    kind: Literal["card", "gap"] = "card"  # gap = おまかせスロット（fill_gap で 1 枚選ぶ。v1.5）
    card_id: str | None = None  # kind=card のとき必須
    instruction: str | None = None  # この作品でのこのシーンへの追加指示（ノードのプロパティ）
    bgm_id: str | None = None  # このシーンの BGM 手動指名（None = 自動選曲）
    target_role: Literal["intro", "rising", "turn", "climax", "ending"] | None = None  # gap の希望ロール


class GenerateInput(BaseModel):
    slots: list[SlotInput] = Field(min_length=1)
    plot: str = ""
    target_tone: Literal["happy", "bad", "bitter", "neutral"] | None = None
    writer_base_url: str | None = None  # 未指定なら環境変数 STORY_FLOW_WRITER_URL
    workspace_id: str | None = None  # 生成元ワークスペース（story に紐付く）
    prompt_preset_id: str | None = None  # ワークスペースの清書プロンプト。無効/未指定なら既定側
    scene_length: Literal["short", "standard", "long"] | None = None  # シーンの目安の長さ
    include_images: bool = False  # カードのメディアを writer に見せる（vision 対応モデル向け）
    include_bgm: bool = True  # BGM の自動選曲を有効にする（BGM 未登録なら実質無効）
    folder_ids: list[str] | None = None  # おまかせの在庫を「ルート ∪ 指定フォルダのサブツリー」に絞る
    # 部分再生成（テイクからの撮り直し）
    base_story_id: str | None = None  # 元テイク。mode が full 以外のとき必須
    start_position: int = 0  # この位置から生成（それ以前は元テイクからコピー）
    mode: Literal["full", "from_here", "single"] = "full"


def _load_slots(slot_inputs: list[SlotInput]) -> list[dict]:
    conn = get_connection()
    try:
        slots = []
        for slot in slot_inputs:
            card = None
            if slot.kind == "card":
                if not slot.card_id:
                    raise HTTPException(status_code=422, detail="card_id is required for card slots")
                row = conn.execute("SELECT * FROM cards WHERE id = ?", (slot.card_id,)).fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail=f"card not found: {slot.card_id}")
                card = dict(row)
            # 削除済み BGM の指名（workspace graph に残った参照）は自動選曲に劣化させる。
            # そのまま通すと全シーン生成後の save_story が外部キー違反で全損する
            bgm_id = slot.bgm_id
            if bgm_id is not None:
                bgm_row = conn.execute("SELECT id FROM bgm WHERE id = ?", (bgm_id,)).fetchone()
                if bgm_row is None:
                    bgm_id = None
            slots.append(
                {
                    "kind": "gap" if slot.kind == "gap" else "fixed",
                    "card": card,
                    "instruction": slot.instruction,
                    "bgm_id": bgm_id,
                    "target_role": slot.target_role,
                }
            )
        return slots
    finally:
        conn.close()


def _load_base_scenes(base_story_id: str, expected_count: int, start_position: int) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM story_scenes WHERE story_id = ? ORDER BY position",
            (base_story_id,),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        raise HTTPException(status_code=404, detail="base story not found")
    if len(rows) != expected_count:
        raise HTTPException(status_code=422, detail="slots がテイクのシーン数と一致しません")
    if not (0 <= start_position < len(rows)):
        raise HTTPException(status_code=422, detail="start_position が範囲外です")
    return [dict(row) for row in rows]


@router.post("/generate")
def generate_story(payload: GenerateInput) -> StreamingResponse:
    # 始点・終点は必ずアンカー（spec §1.5: 作者が置いた固定点の間を埋める）
    if payload.slots[0].kind == "gap" or payload.slots[-1].kind == "gap":
        raise HTTPException(status_code=422, detail="始点と終点にはカードを置いてください（おまかせスロットは中間のみ）")
    slots = _load_slots(payload.slots)
    base_scenes: list[dict] | None = None
    if payload.mode != "full":
        if not payload.base_story_id:
            raise HTTPException(status_code=422, detail="base_story_id is required for partial regeneration")
        if any(slot["kind"] == "gap" for slot in slots):
            # 部分再生成はテイクの確定済みカード列に対して行う（穴の再抽選は新規生成で）
            raise HTTPException(status_code=422, detail="部分再生成のスロットにおまかせは指定できません")
        base_scenes = _load_base_scenes(payload.base_story_id, len(slots), payload.start_position)
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
                include_images=payload.include_images,
                include_bgm=payload.include_bgm,
                base_scenes=base_scenes,
                start_position=payload.start_position,
                mode=payload.mode,
                folder_ids=payload.folder_ids,
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
