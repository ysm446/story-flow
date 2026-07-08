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
    base_scenes: list[dict] | None = None,
    start_position: int = 0,
    mode: str = "full",
) -> Iterator[dict]:
    """アンカー列（v1: FIXED のみ）を左から逐次清書し、シーン毎に dict を yield する。

    slots: [{"card": カード dict, "instruction": その作品でのシーンへの追加指示 | None}]

    部分再生成（テイクからの撮り直し）:
      base_scenes: 元テイクの story_scenes 行。指定時は position < start_position を
      コピーし、直前の state_after から生成を再開する。
      mode="single" なら start_position の 1 シーンだけ生成し、以降もコピー
      （確定事実がずれる可能性があるため stale=True を付けて返す）。

    yield するイベント:
      {"type": "delta", "position", "text"}   # 清書中の断片（ストリーミング表示用）
      {"type": "scene", "position", "total", ..., "reused", "stale"}
      {"type": "done", "story_id"}
    """
    state = StoryState.empty()
    scenes: list[dict] = []
    total = len(slots)

    for index, slot in enumerate(slots):
        card = slot["card"]
        reuse = base_scenes is not None and (
            index < start_position or (mode == "single" and index > start_position)
        )
        if reuse:
            base = base_scenes[index]
            try:
                state_snapshot = json.loads(base["state_after"]) if base["state_after"] else state.snapshot()
            except (json.JSONDecodeError, TypeError):
                state_snapshot = state.snapshot()
            # 生成再開時に直前の確定事実を引き継げるよう state も追従させる
            state = StoryState.from_dict(state_snapshot)
            scene = {
                "position": index,
                "total": total,
                "card_id": base["card_id"],
                "card_title": card.get("title", ""),
                "prose": base["prose"],
                "state_after": state_snapshot,
                "is_fixed": bool(base["is_fixed"]),
                "selection_reason": base["selection_reason"],
            }
            scenes.append(scene)
            yield {
                "type": "scene",
                **scene,
                "reused": True,
                "stale": mode == "single" and index > start_position,
            }
            continue

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
        yield {"type": "scene", **scene, "reused": False, "stale": False}

    parent_story_id = base_scenes[0]["story_id"] if base_scenes else None
    story_id = save_story(plot, target_tone, scenes, workspace_id, parent_story_id)
    yield {"type": "done", "story_id": story_id}


def save_story(
    plot: str,
    target_tone: str | None,
    scenes: list[dict],
    workspace_id: str | None = None,
    parent_story_id: str | None = None,
) -> str:
    """物語を保存する。保存のみで index はしない（spec §1.4 判断）。

    部分再生成でも上書きせず、常に新しいテイクとして保存する（後戻り可能）。
    """
    conn = get_connection()
    try:
        story_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO stories (id, plot, target_tone, workspace_id, parent_story_id, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (story_id, plot or None, target_tone, workspace_id, parent_story_id, datetime.now(timezone.utc).isoformat()),
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
