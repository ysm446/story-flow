"""generate — 逐次生成パイプライン（spec §6.1、中核）。

選択と清書を 1 つの左→右ループに乗せる。一括生成は禁止（spec 判断）。
v1 では GAP が存在しない（Compose はアンカーのみ）ため FIXED だけを回す。
v1.5 で GAP スロットに fill_gap（services/selection.py）を差し込む。

清書結果は stories / story_scenes に保存するが index しない（spec §1.4）。
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

from backend.db.database import get_connection
from backend.services.media import media_preview_data_url
from backend.services.state import StoryState
from backend.services.writer import write_scene_stream


def generate_stream(
    slots: list[dict],
    plot: str,
    target_tone: str | None,
    writer_base_url: str,
    system_prompt: str,
    workspace_id: str | None = None,
    scene_length: str | None = None,
    include_images: bool = False,
) -> Iterator[dict]:
    """アンカー列（v1: FIXED のみ）を左から逐次清書し、シーン毎に dict を yield する。

    slots: [{"card": カード dict, "instruction": その作品でのシーンへの追加指示 | None}]

    yield するイベント:
      {"type": "delta", "position", "text"}   # 清書中の断片（ストリーミング表示用）
      {"type": "scene", "position", "total", "card_id", "card_title", "prose", "state_after", "is_fixed"}
      {"type": "done", "story_id"}
    """
    state = StoryState.empty()
    scenes: list[dict] = []
    total = len(slots)

    for index, slot in enumerate(slots):
        card = slot["card"]
        position = "opening" if index == 0 else ("ending" if index == total - 1 else "middle")
        image_data_url = None
        if include_images and card.get("media_path"):
            image_data_url = media_preview_data_url(card["media_path"], card.get("media_type"))
        prose = ""
        for event in write_scene_stream(
            card=card,
            state=state,
            plot=plot,
            target_tone=target_tone,
            position=position,
            base_url=writer_base_url,
            system_prompt=system_prompt,
            scene_length=scene_length,
            instruction=slot.get("instruction"),
            image_data_url=image_data_url,
        ):
            if event[0] == "delta":
                yield {"type": "delta", "position": index, "text": event[1]}
            else:
                _, prose, state = event
        scene = {
            "position": index,
            "total": total,
            "card_id": card["id"],
            "card_title": card.get("title", ""),
            "prose": prose,
            "state_after": state.snapshot(),
            "is_fixed": True,  # v1 はアンカーのみ。v1.5 の穴埋めシーンで False になる
            "selection_reason": None,
        }
        scenes.append(scene)
        yield {"type": "scene", **scene}

    story_id = save_story(plot, target_tone, scenes, workspace_id)
    yield {"type": "done", "story_id": story_id}


def save_story(plot: str, target_tone: str | None, scenes: list[dict], workspace_id: str | None = None) -> str:
    """物語を保存する。保存のみで index はしない（spec §1.4 判断）。"""
    conn = get_connection()
    try:
        story_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO stories (id, plot, target_tone, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (story_id, plot or None, target_tone, workspace_id, datetime.now(timezone.utc).isoformat()),
        )
        for scene in scenes:
            conn.execute(
                "INSERT INTO story_scenes"
                " (id, story_id, position, card_id, prose, is_fixed, selection_reason, state_after)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    story_id,
                    scene["position"],
                    scene["card_id"],
                    scene["prose"],
                    1 if scene["is_fixed"] else 0,
                    scene["selection_reason"],
                    json.dumps(scene["state_after"], ensure_ascii=False),
                ),
            )
        conn.commit()
        return story_id
    finally:
        conn.close()
