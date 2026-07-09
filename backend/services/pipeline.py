"""generate — 逐次生成パイプライン（spec §6.1、中核）。

選択と清書を 1 つの左→右ループに乗せる。一括生成は禁止（spec 判断）。
FIXED スロットはアンカーのカードをそのまま、GAP スロット（v1.5 おまかせノード）は
fill_gap（services/selection.py。候補検索 → LLM 選択の二段）で 1 枚確定してから清書する。
穴が連続しても左から 1 枚ずつ確定し、選んだカードを直前カードに繰り込む（spec §1.5 判断）。

清書結果は stories / story_scenes に保存するが index しない（spec §1.4）。
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

from backend.db.database import get_connection
from backend.services.bgm_select import resolve_bgm
from backend.services.media import media_preview_data_url
from backend.services.selection import fill_gap, load_inventory
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
    include_bgm: bool = True,
    base_scenes: list[dict] | None = None,
    start_position: int = 0,
    mode: str = "full",
    folder_ids: list[str] | None = None,
) -> Iterator[dict]:
    """スロット列を左から逐次清書し、シーン毎に dict を yield する。

    slots: [{"kind": "fixed" | "gap", "card": カード dict | None,
             "instruction": 追加指示 | None, "bgm_id": 手動指名 | None,
             "target_role": gap の希望ロール | None}]

    部分再生成（テイクからの撮り直し）:
      base_scenes: 元テイクの story_scenes 行。指定時は position < start_position を
      コピーし、直前の state_after から生成を再開する。
      mode="single" なら start_position の 1 シーンだけ生成し、以降もコピー
      （確定事実がずれる可能性があるため stale=True を付けて返す）。

    yield するイベント:
      {"type": "selecting", "position", "total"}  # gap の候補検索 + LLM 選択中
      {"type": "selected", "position", "total", "card_id", "card_title", "reason"}
      {"type": "delta", "position", "text"}       # 清書中の断片（ストリーミング表示用）
      {"type": "scene", "position", "total", ..., "reused", "stale"}
      {"type": "done", "story_id"}
    """
    state = StoryState.empty()
    scenes: list[dict] = []
    total = len(slots)
    prev_bgm_id: str | None = None  # 直前シーンの BGM（「継続」判断の基準）
    prev_card: dict | None = None  # 直前に確定したカード（gap 選択の A）
    # 既使用カード: アンカーで確定している分は最初から除外（gap が同じカードを選ばない）
    used_ids = {slot["card"]["id"] for slot in slots if slot.get("card")}
    # selector のエンドポイント（明示指定が無ければ writer と同じサーバ）
    selector_base_url = os.environ.get("STORY_FLOW_SELECTOR_URL") or writer_base_url

    for index, slot in enumerate(slots):
        card = slot.get("card")
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
            base_bgm_id = base["bgm_id"] if "bgm_id" in base.keys() else None
            scene = {
                "position": index,
                "total": total,
                "card_id": base["card_id"],
                "card_title": card.get("title", "") if card else "",
                "prose": base["prose"],
                "state_after": state_snapshot,
                "is_fixed": bool(base["is_fixed"]),
                "selection_reason": base["selection_reason"],
                "bgm_id": base_bgm_id,
            }
            prev_bgm_id = base_bgm_id
            if card:
                prev_card = card
            scenes.append(scene)
            yield {
                "type": "scene",
                **scene,
                "reused": True,
                "stale": mode == "single" and index > start_position,
            }
            continue

        selection_reason: str | None = None
        if slot.get("kind") == "gap":
            # 穴埋め: 左から 1 枚ずつ確定（候補検索 → LLM 選択。まとめて選ばない）
            yield {"type": "selecting", "position": index, "total": total}
            card, selection_reason = fill_gap(
                state,
                prev_card,
                _next_fixed_card(slots, index),
                load_inventory(exclude=used_ids, folder_ids=folder_ids),
                slot.get("target_role"),
                target_tone,
                used_ids,
                base_url=selector_base_url,
                plot=plot,
            )
            yield {
                "type": "selected",
                "position": index,
                "total": total,
                "card_id": card["id"],
                "card_title": card.get("title", ""),
                "reason": selection_reason,
            }

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

        # BGM を確定する（手動指名 > 自動選曲 > 継続）。生成時に一度だけ決めて保存する
        bgm_id = None
        if include_bgm:
            mood_query = " ".join(
                part for part in [state.tone_so_far, target_tone, card.get("brief")] if part
            )
            bgm_id = resolve_bgm(slot.get("bgm_id"), prev_bgm_id, mood_query, writer_base_url)
        elif slot.get("bgm_id"):
            bgm_id = slot.get("bgm_id")
        prev_bgm_id = bgm_id

        scene = {
            "position": index,
            "total": total,
            "card_id": card["id"],
            "card_title": card.get("title", ""),
            "prose": prose,
            "state_after": state.snapshot(),
            "is_fixed": slot.get("kind") != "gap",  # 穴埋めで選ばれたシーンは False
            "selection_reason": selection_reason,
            "bgm_id": bgm_id,
        }
        used_ids.add(card["id"])
        prev_card = card
        scenes.append(scene)
        yield {"type": "scene", **scene, "reused": False, "stale": False}

    parent_story_id = base_scenes[0]["story_id"] if base_scenes else None
    story_id = save_story(plot, target_tone, scenes, workspace_id, parent_story_id)
    yield {"type": "done", "story_id": story_id}


def _next_fixed_card(slots: list[dict], index: int) -> dict | None:
    """index より後ろで最初に現れる固定アンカーのカード（gap 選択の B）。"""
    for slot in slots[index + 1 :]:
        if slot.get("kind") != "gap" and slot.get("card"):
            return slot["card"]
    return None


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
        # 生成には数分かかるため、その間に参照先（BGM / ワークスペース / 元テイク）が
        # 削除されている可能性がある。外部キー違反で生成結果が丸ごと失われないよう、
        # 保存直前に存在を再確認し、消えた参照は NULL に落とす
        workspace_id = _existing_id(conn, "workspaces", workspace_id)
        parent_story_id = _existing_id(conn, "stories", parent_story_id)
        valid_bgm_ids = _existing_bgm_ids(conn, scenes)

        story_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO stories (id, plot, target_tone, workspace_id, parent_story_id, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (story_id, plot or None, target_tone, workspace_id, parent_story_id, datetime.now(timezone.utc).isoformat()),
        )
        for scene in scenes:
            conn.execute(
                "INSERT INTO story_scenes"
                " (id, story_id, position, card_id, prose, is_fixed, selection_reason, state_after, bgm_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    story_id,
                    scene["position"],
                    scene["card_id"],
                    scene["prose"],
                    1 if scene["is_fixed"] else 0,
                    scene["selection_reason"],
                    json.dumps(scene["state_after"], ensure_ascii=False),
                    scene.get("bgm_id") if scene.get("bgm_id") in valid_bgm_ids else None,
                ),
            )
        conn.commit()
        return story_id
    finally:
        conn.close()


def _existing_id(conn, table: str, row_id: str | None) -> str | None:
    """行が存在すれば ID をそのまま、消えていれば None を返す（table は内部固定値のみ）。"""
    if row_id is None:
        return None
    row = conn.execute(f"SELECT id FROM {table} WHERE id = ?", (row_id,)).fetchone()
    return row_id if row is not None else None


def _existing_bgm_ids(conn, scenes: list[dict]) -> set[str]:
    bgm_ids = {scene.get("bgm_id") for scene in scenes if scene.get("bgm_id")}
    if not bgm_ids:
        return set()
    placeholders = ",".join("?" * len(bgm_ids))
    rows = conn.execute(f"SELECT id FROM bgm WHERE id IN ({placeholders})", tuple(bgm_ids)).fetchall()
    return {row["id"] for row in rows}
